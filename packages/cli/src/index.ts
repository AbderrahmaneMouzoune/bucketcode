#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises'
import { basename, resolve as resolvePath } from 'node:path'
import { parseArgs } from 'node:util'

import { createBucket, createTransferHandler, isBucketCodeError } from 'bucketcode'
import { createTransferClient, isTransferError, type TransferClient } from '@bucketcode/protocol'

import { runChecks, type Check } from './doctor.js'

declare const __VERSION__: string

/** Any absolute URL works: in local mode nothing is ever put on a socket. */
const LOCAL_BASE_URL = 'http://bucketcode.local/api/transfers'

const USAGE = `bucketcode — move files and app state between devices through your own bucket

Usage
  bucketcode put <file>            Store a file, print the code to carry
  bucketcode get <code>            Fetch what a code points at
  bucketcode rm <code>             Burn a code
  bucketcode doctor                Check this environment can actually store transfers

Options
  --remote <url>       Talk to a bucketcode server instead of S3 directly
  --token <token>      Bearer token sent with --remote
  --bucket <name>      Bucket name (default: $BUCKETCODE_BUCKET)
  --prefix <prefix>    Key prefix inside the bucket
  --expires-in <secs>  Transfer lifetime, 0 for none (default: 3600)
  -o, --output <path>  Where to write (get). "-" is stdout
  --json               Machine-readable output
  -h, --help           This text
  -v, --version        Version

Environment
  BUCKETCODE_BUCKET, BUCKETCODE_REGION, BUCKETCODE_ENDPOINT, BUCKETCODE_PUBLIC_URL
  AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_REGION

Examples
  bucketcode put ./report.pdf
  bucketcode get K7QP2M4X -o ./report.pdf
  bucketcode --remote https://drop.example.com/api/transfers put ./report.pdf
`

const options = {
  remote: { type: 'string' },
  token: { type: 'string' },
  bucket: { type: 'string' },
  prefix: { type: 'string' },
  'expires-in': { type: 'string' },
  output: { type: 'string', short: 'o' },
  json: { type: 'boolean', default: false },
  help: { type: 'boolean', short: 'h', default: false },
  version: { type: 'boolean', short: 'v', default: false },
} as const

type Flags = {
  remote?: string
  token?: string
  bucket?: string
  prefix?: string
  'expires-in'?: string
  output?: string
  json: boolean
  help: boolean
  version: boolean
}

class UsageError extends Error {}

function out(line: string): void {
  process.stdout.write(`${line}\n`)
}

function emit(json: boolean, payload: unknown, human: () => void): void {
  if (json) out(JSON.stringify(payload, null, 2))
  else human()
}

function parseExpiresIn(raw: string | undefined): number | null {
  if (raw == null) return 3600

  const value = Number(raw)
  if (!Number.isFinite(value) || value < 0) {
    throw new UsageError(`--expires-in must be a non-negative number of seconds (received "${raw}").`)
  }

  return value === 0 ? null : value
}

/**
 * The CLI has exactly one implementation of every command: the protocol client.
 * `--remote` puts it on the network; without it, the same client is wired
 * straight into the handler in this process. The two modes cannot drift apart,
 * because there is only one of them.
 */
function buildClient(flags: Flags): { client: TransferClient; local: boolean } {
  if (flags.remote) {
    return {
      client: createTransferClient({
        baseUrl: flags.remote,
        headers: flags.token ? { authorization: `Bearer ${flags.token}` } : undefined,
      }),
      local: false,
    }
  }

  const handler = createTransferHandler({
    bucket: createBucket({ bucket: flags.bucket, prefix: flags.prefix }),
    expiresIn: parseExpiresIn(flags['expires-in']),
  })

  return {
    client: createTransferClient({
      baseUrl: LOCAL_BASE_URL,
      fetch: (input, init) => handler(new Request(input as string, init as RequestInit)),
    }),
    local: true,
  }
}

async function commandPut(client: TransferClient, flags: Flags, file: string): Promise<void> {
  const path = resolvePath(file)
  const filename = basename(path)
  const bytes = await readFile(path)

  const created = await client.createFile({ body: bytes, filename })

  emit(flags.json, created, () => {
    out(created.code)
    const expiry = created.expiresAt ? `, expires ${new Date(created.expiresAt).toLocaleString()}` : ''
    process.stderr.write(`${filename}, ${created.size ?? bytes.byteLength} bytes${expiry}\n`)
  })
}

async function commandGet(client: TransferClient, flags: Flags, code: string): Promise<void> {
  const metadata = await client.read(code)
  if (!metadata) throw new UsageError(`No transfer behind "${code}" — unknown, or expired.`)

  if (metadata.kind === 'snapshot') {
    const json = JSON.stringify(metadata.data, null, 2)

    if (flags.output && flags.output !== '-') {
      await writeFile(resolvePath(flags.output), json)
      emit(flags.json, metadata, () => process.stderr.write(`Wrote ${flags.output}\n`))
      return
    }

    out(json)
    return
  }

  const bytes = await client.readBytes(code)
  if (!bytes) throw new UsageError(`No transfer behind "${code}" — unknown, or expired.`)

  if (flags.output === '-') {
    process.stdout.write(bytes)
    return
  }

  const destination = resolvePath(flags.output ?? metadata.filename ?? code)
  await writeFile(destination, bytes)

  emit(flags.json, { ...metadata, writtenTo: destination }, () =>
    process.stderr.write(`Wrote ${destination} (${bytes.byteLength} bytes)\n`),
  )
}

async function commandRm(client: TransferClient, flags: Flags, code: string): Promise<void> {
  await client.remove(code)
  emit(flags.json, { code, removed: true }, () => process.stderr.write(`Burned ${code}\n`))
}

const SYMBOL: Record<Check['status'], string> = { ok: '✓', warn: '!', fail: '✗' }

async function commandDoctor(flags: Flags): Promise<void> {
  const checks = flags.remote
    ? await remoteChecks(flags)
    : await runChecks(createBucket({ bucket: flags.bucket, prefix: flags.prefix }), flags.prefix)
  const failed = checks.filter((check) => check.status === 'fail')

  emit(flags.json, { checks, ok: failed.length === 0 }, () => {
    for (const check of checks) {
      out(`${SYMBOL[check.status]} ${check.name}: ${check.detail}`)
      if (check.fix) out(`  → ${check.fix}`)
    }

    out('')
    out(failed.length === 0 ? 'Ready to store transfers.' : `${failed.length} check(s) failed.`)
  })

  if (failed.length > 0) process.exitCode = 1
}

/** Against a server, the only meaningful check is a real round trip. */
async function remoteChecks(flags: Flags): Promise<Check[]> {
  const { client } = buildClient(flags)
  const probe = { bucketcode: 'doctor', at: new Date().toISOString() }

  try {
    const created = await client.createSnapshot({ data: probe, device: 'bucketcode doctor' })
    const readBack = await client.read(created.code)
    await client.remove(created.code)

    const intact = JSON.stringify(readBack?.data) === JSON.stringify(probe)

    return [
      { name: 'Server', status: 'ok', detail: `${flags.remote} answered` },
      {
        name: 'Create, read, delete',
        status: intact ? 'ok' : 'fail',
        detail: intact ? `round-tripped code ${created.code}` : 'the probe did not read back intact',
      },
    ]
  } catch (error) {
    return [
      {
        name: 'Server',
        status: 'fail',
        detail: error instanceof Error ? error.message : String(error),
        fix: 'Check --remote points at the transfer routes, and --token if the server requires one.',
      },
    ]
  }
}

async function main(argv: string[]): Promise<void> {
  const { values, positionals } = parseArgs({ args: argv, options, allowPositionals: true })
  const flags = values as Flags

  if (flags.version) return out(__VERSION__)
  if (flags.help || positionals.length === 0) return out(USAGE)

  const [command, argument] = positionals

  if (command === 'doctor') return commandDoctor(flags)

  // Everything the caller got wrong is reported before any bucket is resolved:
  // a typo should not come back as "no bucket configured".
  if (command !== 'put' && command !== 'get' && command !== 'rm') {
    throw new UsageError(`Unknown command "${command}". Run \`bucketcode --help\`.`)
  }

  if (!argument) {
    throw new UsageError(
      command === 'put'
        ? 'put needs a file: bucketcode put ./report.pdf'
        : `${command} needs a code: bucketcode ${command} K7QP2M4X`,
    )
  }

  const { client } = buildClient(flags)

  switch (command) {
    case 'put':
      return commandPut(client, flags, argument)
    case 'get':
      return commandGet(client, flags, argument)
    case 'rm':
      return commandRm(client, flags, argument)
  }
}

main(process.argv.slice(2)).catch((error: unknown) => {
  // Three kinds of failure, three different things the reader should do about
  // them — so they do not all print the same way.
  if (error instanceof UsageError) {
    process.stderr.write(`${error.message}\n`)
  } else if (isTransferError(error)) {
    process.stderr.write(`${error.code}: ${error.message}\n`)
  } else if (isBucketCodeError(error)) {
    process.stderr.write(`${error.code}: ${error.message}\n`)
  } else {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  }

  process.exitCode = 1
})
