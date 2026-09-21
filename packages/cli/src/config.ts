import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join, resolve as resolvePath } from 'node:path'

import { CliError } from './errors.js'
import { parseDuration } from './format.js'

export type Env = Record<string, string | undefined>

export interface Credentials {
  accessKeyId: string
  secretAccessKey: string
  sessionToken?: string
}

/** Everything a configuration file can say, profiles aside. */
export interface ConfigValues {
  bucket?: string
  region?: string
  endpoint?: string
  forcePathStyle?: boolean
  prefix?: string
  publicUrl?: string
  /** Seconds, a duration like `"24h"`, or `null` for transfers that never expire. */
  expiresIn?: number | string | null
  credentials?: Credentials
  /** Talk to a s3nd server instead of S3 — the credentials then live there. */
  remote?: string
  token?: string
  /** Read this env file before expanding `${…}` references. Relative to the config file. */
  envFile?: string
}

export interface ConfigFile extends ConfigValues {
  /** Accepted and ignored, so an editor can be pointed at a schema. */
  $schema?: string
  profiles?: Record<string, ConfigValues>
}

/** Looked for on the way up from the working directory, in this order. */
export const FILE_NAMES = ['s3nd.config.json', '.s3ndrc.json', '.s3ndrc']

type ValueKind = 'string' | 'boolean' | 'duration' | 'credentials'

const VALUE_KEYS: Record<keyof ConfigValues, ValueKind> = {
  bucket: 'string',
  region: 'string',
  endpoint: 'string',
  forcePathStyle: 'boolean',
  prefix: 'string',
  publicUrl: 'string',
  expiresIn: 'duration',
  credentials: 'credentials',
  remote: 'string',
  token: 'string',
  envFile: 'string',
}

const FILE_KEYS = [...Object.keys(VALUE_KEYS), 'profiles', '$schema']

export interface LoadedConfig {
  /** Absolute path of the file that was read, when one was found. */
  path?: string
  /** The profile in force, when one was asked for. */
  profile?: string
  /** Every profile the file declares — for `s3nd config`, and for error messages. */
  profiles: string[]
  /** The file's values, profile merged in and `${…}` expanded. */
  values: Omit<ConfigValues, 'expiresIn'> & { expiresIn?: number | null }
}

export interface LoadOptions {
  cwd: string
  env: Env
  /** `--config`, or `$S3ND_CONFIG`. Must exist: an explicit path that is not there is an error. */
  path?: string
  /** `--profile`, or `$S3ND_PROFILE`. */
  profile?: string
  /** `--env-file`, resolved against the working directory rather than the config file. */
  envFile?: string
}

/**
 * Finds the configuration file, reads it, and hands back what it says.
 *
 * Discovery walks up from the working directory — so a config next to the
 * project is found from any directory inside it — and falls back to
 * `~/.config/s3nd/config.json` for the machine-wide one. The first file
 * found wins outright: two files being merged is the kind of thing nobody can
 * debug from the outside.
 */
export function loadConfigFile(options: LoadOptions): LoadedConfig {
  const { cwd, env } = options
  const explicit = options.path ?? env.S3ND_CONFIG
  const profile = options.profile ?? env.S3ND_PROFILE

  const path = explicit ? requireFile(resolvePath(cwd, explicit)) : discover(cwd, env)

  if (!path) {
    if (profile) {
      throw new CliError(
        `--profile "${profile}" was given, but no configuration file was found.`,
        `Run \`s3nd init\` to write one, or point at it with --config <path>.`,
      )
    }

    if (options.envFile) applyEnvFile(env, resolvePath(cwd, options.envFile), true)

    return { profiles: [], values: {} }
  }

  const file = parseFile(path)
  const profiles = Object.keys(file.profiles ?? {})
  const selected = selectProfile(file, profile, path)

  // The env file is read before anything is expanded: its whole purpose is to
  // hold the values the `${…}` references point at. One the file merely
  // declares may be missing — the variables can just as well be exported, and
  // a machine that has them should not need an empty `.env` to humour us.
  const envFile = options.envFile
    ? resolvePath(cwd, options.envFile)
    : selected.envFile
      ? resolvePath(dirname(path), selected.envFile)
      : undefined

  if (envFile) applyEnvFile(env, envFile, options.envFile != null)

  const { expiresIn, ...values } = expand(selected, env, path, envFile)

  return {
    path,
    ...(profile ? { profile } : {}),
    profiles,
    // `null` is a real answer here — "never expires" — so an absent key is the
    // only thing that may leave `expiresIn` off the resolved values.
    values: {
      ...values,
      ...(expiresIn !== undefined ? { expiresIn: parseDuration(expiresIn, `"expiresIn" in ${path}`) } : {}),
    },
  }
}

function requireFile(path: string): string {
  if (!existsSync(path)) {
    throw new CliError(`No configuration file at ${path}.`, 'Run `s3nd init` to write one.')
  }

  return path
}

function discover(cwd: string, env: Env): string | undefined {
  let directory = resolvePath(cwd)

  for (;;) {
    for (const name of FILE_NAMES) {
      const candidate = join(directory, name)
      if (existsSync(candidate)) return candidate
    }

    const parent = dirname(directory)
    if (parent === directory) break
    directory = parent
  }

  const home = env.XDG_CONFIG_HOME
    ? join(env.XDG_CONFIG_HOME, 's3nd', 'config.json')
    : join(homedir(), '.config', 's3nd', 'config.json')

  return existsSync(home) ? home : undefined
}

function parseFile(path: string): ConfigFile {
  let raw: unknown

  try {
    raw = JSON.parse(readFileSync(path, 'utf8'))
  } catch (error) {
    throw new CliError(
      `${path} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
      'It is plain JSON — no comments, no trailing commas.',
    )
  }

  const file = assertObject(raw, path, 'the configuration')

  for (const key of Object.keys(file)) {
    if (FILE_KEYS.includes(key)) continue

    throw new CliError(
      `Unknown key "${key}" in ${path}.${didYouMean(key, FILE_KEYS)}`,
      `Keys: ${FILE_KEYS.join(', ')}.`,
    )
  }

  if (file.profiles !== undefined) {
    const profiles = assertObject(file.profiles, path, '"profiles"')

    for (const [name, values] of Object.entries(profiles)) {
      assertValues(values, path, `profile "${name}"`)
    }
  }

  assertValues(file, path, 'the configuration')

  return file as ConfigFile
}

function assertObject(value: unknown, path: string, where: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new CliError(`${where} in ${path} must be an object.`)
  }

  return value as Record<string, unknown>
}

function assertValues(raw: unknown, path: string, where: string): void {
  const values = assertObject(raw, path, where)

  for (const [key, value] of Object.entries(values)) {
    if (key === 'profiles' || key === '$schema') continue

    const kind = VALUE_KEYS[key as keyof ConfigValues]
    if (!kind) {
      throw new CliError(
        `Unknown key "${key}" in ${where}, in ${path}.${didYouMean(key, Object.keys(VALUE_KEYS))}`,
        `Keys: ${Object.keys(VALUE_KEYS).join(', ')}.`,
      )
    }

    if (value === undefined) continue

    if (kind === 'string' && (typeof value !== 'string' || value.trim().length === 0)) {
      throw new CliError(`"${key}" in ${path} must be a non-empty string.`)
    }

    if (kind === 'boolean' && typeof value !== 'boolean') {
      throw new CliError(`"${key}" in ${path} must be true or false.`)
    }

    if (kind === 'duration' && value !== null && typeof value !== 'number' && typeof value !== 'string') {
      throw new CliError(`"${key}" in ${path} must be a number of seconds, a duration like "24h", or null.`)
    }

    if (kind === 'credentials') {
      const credentials = assertObject(value, path, `"${key}"`)

      for (const field of ['accessKeyId', 'secretAccessKey']) {
        if (typeof credentials[field] !== 'string' || (credentials[field] as string).length === 0) {
          throw new CliError(`"credentials.${field}" in ${path} must be a non-empty string.`)
        }
      }

      if (credentials.sessionToken !== undefined && typeof credentials.sessionToken !== 'string') {
        throw new CliError(`"credentials.sessionToken" in ${path} must be a string.`)
      }
    }
  }
}

function selectProfile(file: ConfigFile, profile: string | undefined, path: string): ConfigValues {
  const { $schema: _schema, profiles, ...root } = file

  if (!profile) return root

  const values = profiles?.[profile]

  if (!values) {
    const known = Object.keys(profiles ?? {})

    throw new CliError(
      `No profile "${profile}" in ${path}.${didYouMean(profile, known)}`,
      known.length > 0 ? `Profiles: ${known.join(', ')}.` : 'That file declares no profiles.',
    )
  }

  // A profile overrides key by key, credentials included: half a key pair,
  // inherited from two places, is not a thing anyone means to configure.
  return { ...root, ...values }
}

const REFERENCE = /\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g

/**
 * Expands `${VAR}` in every string the file holds, so a configuration can be
 * committed and the secrets it points at cannot.
 */
function expand(values: ConfigValues, env: Env, path: string, envFile?: string): ConfigValues {
  const expanded: Record<string, unknown> = {}
  const hint = envFile
    ? `Set it in ${envFile}, or export it before running s3nd.`
    : 'Export it, or put it in an env file and point "envFile" at that file.'

  for (const [key, value] of Object.entries(values)) {
    if (typeof value === 'string') {
      expanded[key] = expandString(value, env, `"${key}" in ${path}`, hint)
      continue
    }

    if (key === 'credentials' && value && typeof value === 'object') {
      const credentials: Record<string, unknown> = {}

      for (const [field, raw] of Object.entries(value as Record<string, unknown>)) {
        credentials[field] =
          typeof raw === 'string' ? expandString(raw, env, `"credentials.${field}" in ${path}`, hint) : raw
      }

      expanded[key] = credentials
      continue
    }

    expanded[key] = value
  }

  return expanded as ConfigValues
}

function expandString(value: string, env: Env, where: string, hint: string): string {
  return value.replace(REFERENCE, (_match, name: string) => {
    const resolved = env[name]

    if (resolved == null || resolved.length === 0) {
      throw new CliError(`${where} references \${${name}}, which is not set.`, hint)
    }

    return resolved
  })
}

/**
 * Reads `KEY=value` lines into the environment without overwriting anything
 * already there — the shell stays the last word, the way `--env-file` behaves.
 */
export function applyEnvFile(env: Env, path: string, required: boolean): void {
  if (!existsSync(path)) {
    if (!required) return

    throw new CliError(`No env file at ${path}.`)
  }

  for (const [key, value] of Object.entries(parseEnvFile(readFileSync(path, 'utf8')))) {
    if (env[key] == null) env[key] = value
  }
}

export function parseEnvFile(contents: string): Record<string, string> {
  const values: Record<string, string> = {}

  for (const line of contents.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (trimmed.length === 0 || trimmed.startsWith('#')) continue

    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(trimmed)
    if (!match) continue

    const raw = match[2]!.trim()
    const quoted = /^(["'])([\s\S]*)\1$/.exec(raw)

    values[match[1]!] = quoted ? quoted[2]! : raw.replace(/\s+#.*$/, '').trim()
  }

  return values
}

/** Cheap edit distance, only ever run on a key somebody already got wrong. */
function distance(a: string, b: string): number {
  const previous = Array.from({ length: b.length + 1 }, (_value, index) => index)

  for (let i = 1; i <= a.length; i += 1) {
    let diagonal = previous[0]!
    previous[0] = i

    for (let j = 1; j <= b.length; j += 1) {
      const current = previous[j]!
      previous[j] = Math.min(previous[j]! + 1, previous[j - 1]! + 1, diagonal + (a[i - 1] === b[j - 1] ? 0 : 1))
      diagonal = current
    }
  }

  return previous[b.length]!
}

function didYouMean(value: string, candidates: string[]): string {
  const lowered = value.toLowerCase()
  const [best] = candidates
    .map((candidate) => ({ candidate, score: distance(lowered, candidate.toLowerCase()) }))
    .filter(({ score }) => score <= Math.max(2, Math.floor(value.length / 3)))
    .sort((a, b) => a.score - b.score)

  return best ? ` Did you mean "${best.candidate}"?` : ''
}

export interface Settings {
  bucket?: string
  region?: string
  endpoint?: string
  forcePathStyle?: boolean
  prefix?: string
  publicUrl?: string
  credentials?: Credentials
  /** `null` is a transfer that does not expire. */
  expiresIn: number | null
  remote?: string
  token?: string
}

export interface Configuration {
  settings: Settings
  /** Where each setting came from — a flag, an environment variable, the file, the default. */
  origins: Record<string, string>
  file?: { path: string; profile?: string; profiles: string[] }
}

export interface ConfigFlags {
  config?: string
  profile?: string
  'env-file'?: string
  bucket?: string
  region?: string
  endpoint?: string
  prefix?: string
  'expires-in'?: string
  remote?: string
  token?: string
}

const DEFAULT_EXPIRES_IN = 3600

/**
 * Flags beat environment variables, which beat the configuration file. Nothing
 * here reaches into `createBucket`'s own environment fallbacks: every value is
 * resolved once, in one order, so `s3nd config` can say where each one came
 * from without guessing.
 */
export function resolveConfiguration(flags: ConfigFlags, options: { cwd: string; env: Env }): Configuration {
  const { cwd, env } = options

  const file = loadConfigFile({
    cwd,
    env,
    ...(flags.config ? { path: flags.config } : {}),
    ...(flags.profile ? { profile: flags.profile } : {}),
    ...(flags['env-file'] ? { envFile: flags['env-file'] } : {}),
  })

  const origins: Record<string, string> = {}
  // Short, because it is repeated down a column; the full path is printed once,
  // on its own line, by `s3nd config`.
  const label = file.path ? `${basename(file.path)}${file.profile ? ` (${file.profile})` : ''}` : 'the config file'

  function text(
    name: string,
    flag: { value: string | undefined; name: string },
    envNames: string[],
    fromFile: string | undefined,
  ): string | undefined {
    if (flag.value !== undefined) {
      origins[name] = flag.name
      return flag.value
    }

    for (const variable of envNames) {
      const value = env[variable]
      if (value != null && value.length > 0) {
        origins[name] = `$${variable}`
        return value
      }
    }

    if (fromFile !== undefined) {
      origins[name] = label
      return fromFile
    }

    return undefined
  }

  function expiry(): number | null {
    if (flags['expires-in'] !== undefined) {
      origins.expiresIn = '--expires-in'
      return parseDuration(flags['expires-in'], '--expires-in')
    }

    if (env.S3ND_EXPIRES_IN) {
      origins.expiresIn = '$S3ND_EXPIRES_IN'
      return parseDuration(env.S3ND_EXPIRES_IN, '$S3ND_EXPIRES_IN')
    }

    if (file.values.expiresIn !== undefined) {
      origins.expiresIn = label
      return file.values.expiresIn
    }

    origins.expiresIn = 'default'
    return DEFAULT_EXPIRES_IN
  }

  const credentials = file.values.credentials
  if (credentials) origins.credentials = label
  else if (env.AWS_ACCESS_KEY_ID) origins.credentials = '$AWS_ACCESS_KEY_ID'
  else origins.credentials = 'the AWS provider chain'

  if (file.values.forcePathStyle !== undefined) origins.forcePathStyle = label

  const settings: Settings = {
    bucket: text('bucket', { value: flags.bucket, name: '--bucket' }, ['S3ND_BUCKET', 'S3_BUCKET'], file.values.bucket),
    region: text(
      'region',
      { value: flags.region, name: '--region' },
      ['S3ND_REGION', 'AWS_REGION', 'AWS_DEFAULT_REGION'],
      file.values.region,
    ),
    endpoint: text(
      'endpoint',
      { value: flags.endpoint, name: '--endpoint' },
      ['S3ND_ENDPOINT', 'S3_ENDPOINT'],
      file.values.endpoint,
    ),
    forcePathStyle: file.values.forcePathStyle,
    prefix: text('prefix', { value: flags.prefix, name: '--prefix' }, ['S3ND_PREFIX'], file.values.prefix),
    publicUrl: text(
      'publicUrl',
      { value: undefined, name: '' },
      ['S3ND_PUBLIC_URL', 'S3_PUBLIC_URL'],
      file.values.publicUrl,
    ),
    credentials,
    expiresIn: expiry(),
    remote: text('remote', { value: flags.remote, name: '--remote' }, ['S3ND_REMOTE'], file.values.remote),
    token: text('token', { value: flags.token, name: '--token' }, ['S3ND_TOKEN'], file.values.token),
  }

  return {
    settings,
    origins,
    ...(file.path ? { file: { path: file.path, profile: file.profile, profiles: file.profiles } } : {}),
  }
}
