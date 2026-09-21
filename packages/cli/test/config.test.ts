import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { loadConfigFile, resolveConfiguration, type Env } from '../src/config.js'
import { CliError } from '../src/errors.js'

let root: string
let env: Env

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 's3nd-config-'))
  // Nothing in these tests may reach the machine's own configuration: an
  // XDG directory that exists and is empty is what keeps discovery inside
  // the temporary tree.
  env = { XDG_CONFIG_HOME: join(root, 'xdg') }
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

function write(path: string, contents: unknown): string {
  const full = join(root, path)
  mkdirSync(join(full, '..'), { recursive: true })
  writeFileSync(full, typeof contents === 'string' ? contents : JSON.stringify(contents), 'utf8')

  return full
}

function resolve(flags: Parameters<typeof resolveConfiguration>[0] = {}, cwd = root) {
  return resolveConfiguration(flags, { cwd, env })
}

describe('discovery', () => {
  it('reads the file next to the working directory', () => {
    const path = write('s3nd.config.json', { bucket: 'transfers', prefix: 'drops' })

    const { settings, file } = resolve()

    expect(file?.path).toBe(path)
    expect(settings.bucket).toBe('transfers')
    expect(settings.prefix).toBe('drops')
  })

  it('walks up from a nested directory, the way a project is worked in', () => {
    write('s3nd.config.json', { bucket: 'transfers' })
    mkdirSync(join(root, 'src', 'deep'), { recursive: true })

    expect(resolve({}, join(root, 'src', 'deep')).settings.bucket).toBe('transfers')
  })

  it('accepts the dotfile spellings too', () => {
    write('.s3ndrc.json', { bucket: 'from-dotfile' })

    expect(resolve().settings.bucket).toBe('from-dotfile')
  })

  it('falls back to the machine-wide file when a project has none', () => {
    write('xdg/s3nd/config.json', { bucket: 'personal' })

    expect(resolve().settings.bucket).toBe('personal')
  })

  it('refuses an explicit --config that is not there', () => {
    expect(() => resolve({ config: 'nope.json' })).toThrow(/No configuration file at/)
  })

  it('finds nothing without complaining when there is nothing to find', () => {
    const { settings, file } = resolve()

    expect(file).toBeUndefined()
    expect(settings.bucket).toBeUndefined()
    expect(settings.expiresIn).toBe(3600)
  })
})

describe('precedence', () => {
  beforeEach(() => {
    write('s3nd.config.json', { bucket: 'from-file', region: 'eu-west-3' })
  })

  it('puts a flag above an environment variable, and that above the file', () => {
    env.S3ND_BUCKET = 'from-env'

    expect(resolve().settings.bucket).toBe('from-env')
    expect(resolve({ bucket: 'from-flag' }).settings.bucket).toBe('from-flag')
    expect(resolve().settings.region).toBe('eu-west-3')
  })

  it('records where each value came from', () => {
    env.S3ND_BUCKET = 'from-env'

    const { origins } = resolve({ prefix: 'drops' })

    expect(origins.bucket).toBe('$S3ND_BUCKET')
    expect(origins.prefix).toBe('--prefix')
    expect(origins.region).toBe('s3nd.config.json')
    expect(origins.expiresIn).toBe('default')
  })

  it('names the profile in the origin, so two similar setups stay apart', () => {
    write('s3nd.config.json', { bucket: 'from-file', profiles: { work: { bucket: 'work-bucket' } } })

    expect(resolve({ profile: 'work' }).origins.bucket).toBe('s3nd.config.json (work)')
  })
})

describe('profiles', () => {
  beforeEach(() => {
    write('s3nd.config.json', {
      bucket: 'shared',
      prefix: 'transfers',
      profiles: {
        work: { bucket: 'work-transfers' },
        local: { endpoint: 'http://localhost:9000' },
      },
    })
  })

  it('overrides the root key by key', () => {
    const { settings } = resolve({ profile: 'work' })

    expect(settings.bucket).toBe('work-transfers')
    expect(settings.prefix).toBe('transfers')
  })

  it('can be selected from the environment', () => {
    env.S3ND_PROFILE = 'local'

    expect(resolve().settings.endpoint).toBe('http://localhost:9000')
  })

  it('lists the ones that exist when the name is wrong', () => {
    expect(() => resolve({ profile: 'wrok' })).toThrow(/Did you mean "work"/)
  })

  it('says so when a profile is asked for and no file was found', () => {
    rmSync(join(root, 's3nd.config.json'))

    expect(() => resolve({ profile: 'work' })).toThrow(/no configuration file was found/)
  })
})

describe('validation', () => {
  it('suggests the key that was meant', () => {
    write('s3nd.config.json', { buckett: 'transfers' })

    expect(() => resolve()).toThrow(/Did you mean "bucket"/)
  })

  it('rejects a value of the wrong type', () => {
    write('s3nd.config.json', { bucket: 42 })

    expect(() => resolve()).toThrow(/must be a non-empty string/)
  })

  it('rejects half a credential pair rather than failing at the first request', () => {
    write('s3nd.config.json', { bucket: 'transfers', credentials: { accessKeyId: 'AKIA' } })

    expect(() => resolve()).toThrow(/credentials.secretAccessKey/)
  })

  it('explains invalid JSON in terms of the file it is in', () => {
    write('s3nd.config.json', '{ "bucket": "transfers", }')

    expect(() => resolve()).toThrow(/is not valid JSON/)
  })

  it('validates profiles as strictly as the root', () => {
    write('s3nd.config.json', { bucket: 'transfers', profiles: { work: { bukcet: 'x' } } })

    expect(() => resolve()).toThrow(/profile "work"/)
  })
})

describe('environment references', () => {
  it('expands ${VAR} so the file can be committed and the secret cannot', () => {
    write('s3nd.config.json', {
      bucket: 'transfers',
      endpoint: 'https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com',
      credentials: { accessKeyId: '${R2_KEY}', secretAccessKey: '${R2_SECRET}' },
    })

    env.R2_ACCOUNT_ID = 'abc123'
    env.R2_KEY = 'key'
    env.R2_SECRET = 'secret'

    const { settings } = resolve()

    expect(settings.endpoint).toBe('https://abc123.r2.cloudflarestorage.com')
    expect(settings.credentials).toEqual({ accessKeyId: 'key', secretAccessKey: 'secret' })
  })

  it('names the variable that is missing, and where to put it', () => {
    write('s3nd.config.json', { bucket: 'transfers', endpoint: 'https://${R2_ACCOUNT_ID}.example.com' })

    expect(() => resolve()).toThrow(/\$\{R2_ACCOUNT_ID\}, which is not set/)
  })

  it('reads the env file the configuration points at', () => {
    write('s3nd.config.json', { bucket: 'transfers', envFile: '.env', token: '${DROP_TOKEN}' })
    write('.env', 'DROP_TOKEN=from-file\n# a comment\nQUOTED="with spaces"\n')

    expect(resolve().settings.token).toBe('from-file')
    expect(env.QUOTED).toBe('with spaces')
  })

  it('leaves a variable the shell already set alone', () => {
    write('s3nd.config.json', { bucket: 'transfers', envFile: '.env', token: '${DROP_TOKEN}' })
    write('.env', 'DROP_TOKEN=from-file\n')
    env.DROP_TOKEN = 'from-shell'

    expect(resolve().settings.token).toBe('from-shell')
  })

  it('tolerates a declared env file that is not there, but not one that was asked for', () => {
    write('s3nd.config.json', { bucket: 'transfers', envFile: '.env' })

    expect(resolve().settings.bucket).toBe('transfers')
    expect(() => resolve({ 'env-file': 'missing.env' })).toThrow(/No env file at/)
  })
})

describe('expiry', () => {
  it('reads a duration the way it is written', () => {
    write('s3nd.config.json', { bucket: 'transfers', expiresIn: '24h' })

    expect(resolve().settings.expiresIn).toBe(86_400)
  })

  it('takes null, 0 and "never" as "does not expire"', () => {
    write('s3nd.config.json', { bucket: 'transfers', expiresIn: null })

    expect(resolve().settings.expiresIn).toBeNull()
    expect(resolve({ 'expires-in': '0' }).settings.expiresIn).toBeNull()
    expect(resolve({ 'expires-in': 'never' }).settings.expiresIn).toBeNull()
  })

  it('defaults to an hour, and says that is where it came from', () => {
    const { settings, origins } = resolve()

    expect(settings.expiresIn).toBe(3600)
    expect(origins.expiresIn).toBe('default')
  })

  it('refuses a duration it cannot read', () => {
    expect(() => resolve({ 'expires-in': '5 weeks' })).toThrow(CliError)
  })
})

describe('loadConfigFile', () => {
  it('reports the profiles a file declares, for the ones nobody remembers', () => {
    write('s3nd.config.json', { bucket: 'transfers', profiles: { work: {}, home: {} } })

    expect(loadConfigFile({ cwd: root, env }).profiles).toEqual(['work', 'home'])
  })
})
