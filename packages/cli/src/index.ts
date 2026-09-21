#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises'
import { basename, resolve as resolvePath } from 'node:path'
import { parseArgs } from 'node:util'

import { createBucket, createTransferHandler, isS3ndError, type Bucket } from 's3nd'
import { createTransferClient, isTransferError, type TransferClient } from '@s3nd/protocol'

import { resolveConfiguration, type Configuration } from './config.js'
import { runChecks, type Check } from './doctor.js'
import { CliError, isCliError } from './errors.js'
import { createStyle, formatBytes, formatDuration, type Style } from './format.js'
import { assertProvider, PROVIDERS, writeStarter } from './init.js'

declare const __VERSION__: string

/** Any absolute URL works: in local mode nothing is ever put on a socket. */
const LOCAL_BASE_URL = 'http://s3nd.local/api/transfers'

const USAGE = `s3nd — move files and app state between devices through your own bucket

Usage
  s3nd <command> [options]

Commands
  put <file>           Store a file and print the code to carry. "-" reads stdin
  get <code>           Fetch what a code points at
  rm <code>            Burn a code
  doctor               Check this setup can actually store transfers
  init                 Write a starter s3nd.config.json here
  config               Print the resolved configuration, and where each value came from

Options
  -c, --config <path>    Configuration file (default: the nearest s3nd.config.json)
  -p, --profile <name>   Profile to use inside that file
      --env-file <path>  Read KEY=value pairs from this file first
      --bucket <name>    Bucket name
      --prefix <prefix>  Key prefix inside the bucket
      --region <name>    Region
      --endpoint <url>   S3-compatible endpoint: R2, MinIO, Scaleway, Wasabi…
      --expires-in <d>   Transfer lifetime: 3600, 30m, 24h, 7d, or never
      --remote <url>     Talk to a s3nd server instead of S3 directly
      --token <token>    Bearer token sent with --remote
      --name <filename>  Filename to store the transfer under
  -o, --output <path>    Where get writes. "-" is stdout
      --json             Machine-readable output
  -h, --help             This text
  -v, --version          Version

  init also takes --provider <${PROVIDERS.join('|')}> and --force.

Configuration
  A flag beats an environment variable, which beats the configuration file:
  s3nd.config.json, .s3ndrc.json or .s3ndrc, looked for from here upwards, then
  ~/.config/s3nd/config.json. \`s3nd config\` prints what won.

  S3ND_BUCKET, S3ND_REGION, S3ND_ENDPOINT, S3ND_PREFIX, S3ND_PUBLIC_URL,
  S3ND_EXPIRES_IN, S3ND_REMOTE, S3ND_TOKEN, S3ND_CONFIG, S3ND_PROFILE,
  AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_REGION

Examples
  s3nd init --provider r2 --bucket transfers
  s3nd doctor
  s3nd put ./report.pdf
  s3nd get K7QP2M4X -o ./report.pdf
  tar cz ./project | s3nd put - --name project.tar.gz
  s3nd --remote https://drop.example.com/api/transfers put ./report.pdf
`

const options = {
  config: { type: 'string', short: 'c' },
  profile: { type: 'string', short: 'p' },
  'env-file': { type: 'string' },
  bucket: { type: 'string' },
  prefix: { type: 'string' },
  region: { type: 'string' },
  endpoint: { type: 'string' },
  'expires-in': { type: 'string' },
  remote: { type: 'string' },
  token: { type: 'string' },
  name: { type: 'string' },
  output: { type: 'string', short: 'o' },
  provider: { type: 'string' },
  force: { type: 'boolean', default: false },
  json: { type: 'boolean', default: false },
  help: { type: 'boolean', short: 'h', default: false },
  version: { type: 'boolean', short: 'v', default: false },
} as const

type Flags = {
  config?: string
  profile?: string
  'env-file'?: string
  bucket?: string
  prefix?: string
  region?: string
  endpoint?: string
  'expires-in'?: string
  remote?: string
  token?: string
  name?: string
  output?: string
  provider?: string
  force: boolean
  json: boolean
  help: boolean
  version: boolean
}

const COMMANDS = ['put', 'get', 'rm', 'doctor', 'init', 'config'] as const

const styleOut = createStyle(process.stdout, process.env)
const styleErr = createStyle(process.stderr, process.env)

// `s3nd config | head` closes the pipe as soon as it has enough. That is the
// reader's business, not an error, and certainly not a stack trace.
for (const stream of [process.stdout, process.stderr]) {
  stream.on('error', (error: NodeJS.ErrnoException) => {
    if (error.code === 'EPIPE') process.exit(0)

    throw error
  })
}

function out(line: string): void {
  process.stdout.write(`${line}\n`)
}

function note(line: string): void {
  process.stderr.write(`${line}\n`)
}

function emit(json: boolean, payload: unknown, human: () => void): void {
  if (json) out(JSON.stringify(payload, null, 2))
  else human()
}

function configure(flags: Flags): Configuration {
  return resolveConfiguration(flags, { cwd: process.cwd(), env: process.env })
}

/** The one error worth spelling out: without a bucket, nothing else can run. */
function noBucket(configuration: Configuration): CliError {
  const message = configuration.file ? `${configuration.file.path} does not name a bucket.` : 'No bucket configured.'

  return new CliError(
    message,
    [
      'Give it one, in increasing order of permanence:',
      '  s3nd --bucket <name> …       for this command',
      '  export S3ND_BUCKET=<name>    for this shell',
      '  s3nd init --bucket <name>    for this directory, in s3nd.config.json',
      '',
      'Pointing at your own server instead? Pass --remote https://…/api/transfers.',
    ].join('\n'),
  )
}

function bucketFor(configuration: Configuration): Bucket {
  const { settings } = configuration

  if (!settings.bucket) throw noBucket(configuration)

  return createBucket({
    bucket: settings.bucket,
    region: settings.region,
    endpoint: settings.endpoint,
    forcePathStyle: settings.forcePathStyle,
    prefix: settings.prefix,
    publicUrl: settings.publicUrl,
    credentials: settings.credentials,
  })
}

/**
 * The CLI has exactly one implementation of every command: the protocol client.
 * `--remote` puts it on the network; without it, the same client is wired
 * straight into the handler in this process. The two modes cannot drift apart,
 * because there is only one of them.
 */
function buildClient(configuration: Configuration): TransferClient {
  const { settings } = configuration

  if (settings.remote) {
    return createTransferClient({
      baseUrl: settings.remote,
      headers: settings.token ? { authorization: `Bearer ${settings.token}` } : undefined,
    })
  }

  const handler = createTransferHandler({
    bucket: bucketFor(configuration),
    expiresIn: settings.expiresIn,
  })

  return createTransferClient({
    baseUrl: LOCAL_BASE_URL,
    fetch: (input, init) => handler(new Request(input as string, init as RequestInit)),
  })
}

async function readSource(flags: Flags, file: string): Promise<{ bytes: Uint8Array; filename: string }> {
  if (file === '-') {
    const chunks: Buffer[] = []
    for await (const chunk of process.stdin) chunks.push(chunk as Buffer)

    const bytes = Buffer.concat(chunks)

    if (bytes.byteLength === 0) {
      throw new CliError(
        'Nothing arrived on stdin.',
        'Pipe something in: `tar cz ./project | s3nd put - --name project.tar.gz`.',
      )
    }

    return { bytes, filename: flags.name ?? 'stdin' }
  }

  const path = resolvePath(file)

  try {
    return { bytes: await readFile(path), filename: flags.name ?? basename(path) }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new CliError(`No such file: ${file}`, 'Pass "-" to read the transfer from stdin instead.')
    }

    throw error
  }
}

async function commandPut(client: TransferClient, flags: Flags, file: string): Promise<void> {
  const { bytes, filename } = await readSource(flags, file)
  const created = await client.createFile({ body: bytes, filename })

  emit(flags.json, created, () => {
    const parts = [filename, formatBytes(created.size ?? bytes.byteLength)]

    if (created.expiresAt) {
      const seconds = Math.round((new Date(created.expiresAt).getTime() - Date.now()) / 1000)
      parts.push(`expires in ${formatDuration(Math.max(seconds, 1))}`)
    } else {
      parts.push('no expiry')
    }

    note(styleErr.dim(parts.join(' · ')))
    out(styleOut.bold(created.code))

    // Only for a human at a terminal: in a pipeline this is noise, and the
    // code on stdout is the whole point.
    if (process.stderr.isTTY) note(styleErr.dim(`On the other machine: s3nd get ${created.code}`))
  })
}

async function commandGet(client: TransferClient, flags: Flags, code: string): Promise<void> {
  const metadata = await client.read(code)
  if (!metadata) throw unknownCode(code)

  if (metadata.kind === 'snapshot') {
    const json = JSON.stringify(metadata.data, null, 2)

    if (flags.output && flags.output !== '-') {
      const destination = resolvePath(flags.output)
      await writeFile(destination, json)

      emit(flags.json, { ...metadata, writtenTo: destination }, () => note(styleErr.dim(`Wrote ${destination}`)))
      return
    }

    out(json)
    return
  }

  const bytes = await client.readBytes(code)
  if (!bytes) throw unknownCode(code)

  if (flags.output === '-') {
    process.stdout.write(bytes)
    return
  }

  const destination = resolvePath(flags.output ?? flags.name ?? metadata.filename ?? code)
  await writeFile(destination, bytes)

  emit(flags.json, { ...metadata, writtenTo: destination }, () =>
    note(styleErr.dim(`Wrote ${destination} · ${formatBytes(bytes.byteLength)}`)),
  )
}

function unknownCode(code: string): CliError {
  return new CliError(
    `No transfer behind "${code}" — unknown, or expired.`,
    'Codes are case-insensitive and ignore dashes, so a typo is the likelier half of that.',
  )
}

async function commandRm(client: TransferClient, flags: Flags, code: string): Promise<void> {
  await client.remove(code)

  emit(flags.json, { code, removed: true }, () => note(styleErr.dim(`Burned ${code}`)))
}

const SYMBOL: Record<Check['status'], (style: Style) => string> = {
  ok: (style) => style.green('✓'),
  warn: (style) => style.yellow('!'),
  fail: (style) => style.red('✗'),
}

async function commandDoctor(flags: Flags): Promise<void> {
  const configuration = configure(flags)
  const { settings } = configuration

  const checks = settings.remote
    ? await remoteChecks(configuration)
    : await runChecks(bucketFor(configuration), settings.prefix)

  const failed = checks.filter((check) => check.status === 'fail')

  emit(flags.json, { config: configuration.file ?? null, checks, ok: failed.length === 0 }, () => {
    if (configuration.file) note(styleErr.dim(`Using ${describeFile(configuration)}`))

    for (const check of checks) {
      out(`${SYMBOL[check.status](styleOut)} ${check.name}: ${check.detail}`)
      if (check.fix) out(styleOut.dim(`  → ${check.fix}`))
    }

    out('')
    out(
      failed.length === 0
        ? styleOut.green('Ready to store transfers.')
        : styleOut.red(`${failed.length} check(s) failed.`),
    )
  })

  if (failed.length > 0) process.exitCode = 1
}

/** Against a server, the only meaningful check is a real round trip. */
async function remoteChecks(configuration: Configuration): Promise<Check[]> {
  const client = buildClient(configuration)
  const probe = { s3nd: 'doctor', at: new Date().toISOString() }

  try {
    const created = await client.createSnapshot({ data: probe, device: 's3nd doctor' })
    const readBack = await client.read(created.code)
    await client.remove(created.code)

    const intact = JSON.stringify(readBack?.data) === JSON.stringify(probe)

    return [
      { name: 'Server', status: 'ok', detail: `${configuration.settings.remote} answered` },
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

function describeFile(configuration: Configuration): string {
  const { file } = configuration
  if (!file) return 'no configuration file'

  return `${file.path}${file.profile ? ` (profile "${file.profile}")` : ''}`
}

function commandInit(flags: Flags): void {
  const provider = assertProvider(flags.provider ?? 'aws')

  const { path, next } = writeStarter({
    cwd: process.cwd(),
    provider,
    bucket: flags.bucket ?? 'my-bucket',
    ...(flags.config ? { path: flags.config } : {}),
    force: flags.force,
  })

  if (flags.json) return out(JSON.stringify({ path, provider, next }, null, 2))

  note(styleErr.dim(`Wrote ${path}`))
  note('')

  for (const line of next) note(line)

  note('')
  note(styleErr.dim('`s3nd config` prints what this file resolves to.'))

  // The path on stdout, the prose on stderr: `cat $(s3nd init)` should work.
  out(path)
}

/**
 * Where every value came from, which is the question that makes a
 * misconfiguration obvious: not "what is the bucket" but "why is it that one".
 */
function commandConfig(flags: Flags): void {
  const configuration = configure(flags)
  const { settings, origins } = configuration

  if (flags.json) {
    out(
      JSON.stringify(
        {
          file: configuration.file ?? null,
          settings: {
            ...settings,
            // A configuration dump lands in issues and in CI logs.
            credentials: settings.credentials ? { accessKeyId: mask(settings.credentials.accessKeyId) } : null,
            token: settings.token ? 'set' : null,
          },
          origins,
        },
        null,
        2,
      ),
    )

    return
  }

  const rows: [string, string, string][] = []
  const add = (label: string, value: string | undefined, origin?: string) => {
    if (value == null) return
    rows.push([label, value, origin ?? ''])
  }

  add('file', describeFile(configuration))
  if (configuration.file && configuration.file.profiles.length > 0) {
    add('profiles', configuration.file.profiles.join(', '))
  }
  add('mode', settings.remote ? `${settings.remote} (over HTTP)` : 'straight to S3')

  rows.push(['', '', ''])

  add('bucket', settings.bucket ?? '— not set —', origins.bucket)
  add('region', settings.region, origins.region)
  add('endpoint', settings.endpoint, origins.endpoint)
  add(
    'path style',
    settings.forcePathStyle == null ? undefined : String(settings.forcePathStyle),
    origins.forcePathStyle,
  )
  add('prefix', settings.prefix, origins.prefix)
  add('public URL', settings.publicUrl, origins.publicUrl)
  add(
    'credentials',
    settings.credentials ? mask(settings.credentials.accessKeyId) : 'resolved at call time',
    origins.credentials,
  )
  add('expires in', settings.expiresIn == null ? 'never' : formatDuration(settings.expiresIn), origins.expiresIn)
  add('token', settings.token ? 'set' : undefined, origins.token)

  const width = Math.max(...rows.map(([label]) => label.length))
  // Only the rows that carry an origin share a column, so a long path in the
  // header does not push every origin off the right of the terminal.
  const valueWidth = Math.max(...rows.filter(([, , origin]) => origin).map(([, value]) => value.length))

  for (const [label, value, origin] of rows) {
    if (label === '') {
      out('')
      continue
    }

    const line = `${label.padEnd(width)}  ${origin ? value.padEnd(valueWidth) : value}`
    out(origin ? `${line}  ${styleOut.dim(origin)}` : line)
  }

  if (!settings.bucket && !settings.remote) {
    note('')
    note(styleErr.dim('No bucket yet: `s3nd init` writes a configuration file here.'))
  }
}

function mask(accessKeyId: string): string {
  return `…${accessKeyId.slice(-4)}`
}

function parse(argv: string[]): { values: Flags; positionals: string[] } {
  try {
    const { values, positionals } = parseArgs({ args: argv, options, allowPositionals: true })

    return { values: values as Flags, positionals }
  } catch (error) {
    // Node's message names the offending option, which is the useful half; the
    // sentence it appends about `--option=value` is not.
    const message = error instanceof Error ? error.message : String(error)

    throw new CliError(message.split('. ')[0]!.trim() + '.', 'Run `s3nd --help` to see what this takes.')
  }
}

async function main(argv: string[]): Promise<void> {
  const { values: flags, positionals } = parse(argv)

  if (flags.version) return out(__VERSION__)

  const [command, argument] = positionals

  if (flags.help || command === undefined || command === 'help') return out(USAGE)

  // Everything the caller got wrong is reported before any bucket is resolved:
  // a typo should not come back as "no bucket configured".
  if (!(COMMANDS as readonly string[]).includes(command)) {
    throw new CliError(`Unknown command "${command}".`, `Commands: ${COMMANDS.join(', ')}. Run \`s3nd --help\`.`)
  }

  if (command === 'init') return commandInit(flags)
  if (command === 'config') return commandConfig(flags)
  if (command === 'doctor') return commandDoctor(flags)

  if (!argument) {
    throw new CliError(
      command === 'put' ? 'put needs a file.' : `${command} needs a code.`,
      command === 'put' ? 'For example: s3nd put ./report.pdf' : `For example: s3nd ${command} K7QP2M4X`,
    )
  }

  const client = buildClient(configure(flags))

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
  // Four kinds of failure, four different things the reader should do about
  // them — so they do not all print the same way.
  if (isCliError(error)) {
    note(styleErr.red(error.message))
    if (error.hint) note(styleErr.dim(error.hint))
  } else if (isTransferError(error)) {
    note(`${styleErr.red(error.code)}: ${error.message}`)
  } else if (isS3ndError(error)) {
    note(`${styleErr.red(error.code)}: ${error.message}`)
    if (error.code === 'INVALID_CONFIG') note(styleErr.dim('`s3nd config` prints what this setup resolves to.'))
  } else {
    note(styleErr.red(error instanceof Error ? error.message : String(error)))
  }

  process.exitCode = 1
})
