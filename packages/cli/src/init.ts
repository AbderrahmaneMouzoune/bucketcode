import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve as resolvePath } from 'node:path'

import type { ConfigFile } from './config.js'
import { CliError } from './errors.js'

export const PROVIDERS = ['aws', 'r2', 'minio', 'scaleway', 'wasabi', 'remote'] as const

export type Provider = (typeof PROVIDERS)[number]

export interface Starter {
  config: ConfigFile
  /** What still has to happen before `s3nd doctor` can pass. */
  next: string[]
}

const DOCTOR = 'Run `s3nd doctor` — it performs the operations s3nd needs and reports what happened.'

/**
 * A starting point per provider, written with `${…}` references rather than
 * secrets: the file is meant to be committed, the env file it points at is not.
 */
export function starter(provider: Provider, bucket: string): Starter {
  switch (provider) {
    case 'r2':
      return {
        config: {
          bucket,
          region: 'auto',
          endpoint: 'https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com',
          prefix: 'transfers',
          expiresIn: '24h',
          envFile: '.env',
          credentials: {
            accessKeyId: '${R2_ACCESS_KEY_ID}',
            secretAccessKey: '${R2_SECRET_ACCESS_KEY}',
          },
        },
        next: [
          'Put the three values in .env, and keep it out of git:',
          '  R2_ACCOUNT_ID=…',
          '  R2_ACCESS_KEY_ID=…',
          '  R2_SECRET_ACCESS_KEY=…',
          'The R2 API token needs Object Read & Write on this bucket, and nothing else.',
          'Give the bucket a lifecycle rule that deletes objects under "transfers/" after a day or two.',
          DOCTOR,
        ],
      }

    case 'minio':
      return {
        config: {
          bucket,
          endpoint: 'http://localhost:9000',
          forcePathStyle: true,
          prefix: 'transfers',
          expiresIn: '1h',
          credentials: { accessKeyId: 'minioadmin', secretAccessKey: 'minioadmin' },
        },
        next: [
          'Start MinIO:',
          '  docker run -p 9000:9000 -p 9001:9001 \\',
          '    -e MINIO_ROOT_USER=minioadmin -e MINIO_ROOT_PASSWORD=minioadmin \\',
          '    quay.io/minio/minio server /data --console-address ":9001"',
          `Create the "${bucket}" bucket from the console on http://localhost:9001.`,
          DOCTOR,
        ],
      }

    case 'scaleway':
      return {
        config: {
          bucket,
          region: 'fr-par',
          endpoint: 'https://s3.fr-par.scw.cloud',
          prefix: 'transfers',
          expiresIn: '24h',
          envFile: '.env',
          credentials: {
            accessKeyId: '${SCW_ACCESS_KEY}',
            secretAccessKey: '${SCW_SECRET_KEY}',
          },
        },
        next: ['Put SCW_ACCESS_KEY and SCW_SECRET_KEY in .env.', DOCTOR],
      }

    case 'wasabi':
      return {
        config: {
          bucket,
          region: 'eu-central-1',
          endpoint: 'https://s3.eu-central-1.wasabisys.com',
          prefix: 'transfers',
          expiresIn: '24h',
          envFile: '.env',
          credentials: {
            accessKeyId: '${WASABI_ACCESS_KEY}',
            secretAccessKey: '${WASABI_SECRET_KEY}',
          },
        },
        next: ['Put WASABI_ACCESS_KEY and WASABI_SECRET_KEY in .env.', DOCTOR],
      }

    case 'remote':
      return {
        config: {
          remote: 'https://drop.example.com/api/transfers',
          token: '${S3ND_TOKEN}',
          envFile: '.env',
        },
        next: [
          'Point "remote" at your deployment of the transfer routes.',
          'Put its token in .env as S3ND_TOKEN. This machine needs no S3 credentials at all.',
          DOCTOR,
        ],
      }

    case 'aws':
      return {
        config: { bucket, region: 'eu-west-3', prefix: 'transfers', expiresIn: '24h' },
        next: [
          'Credentials come from the AWS chain: AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY, a shared',
          'profile, or an instance role. Add a "credentials" block only if you want to pin them here.',
          'Give the bucket a lifecycle rule that deletes objects under "transfers/" after a day or two.',
          DOCTOR,
        ],
      }
  }
}

export function assertProvider(value: string): Provider {
  if ((PROVIDERS as readonly string[]).includes(value)) return value as Provider

  throw new CliError(`Unknown provider "${value}".`, `Providers: ${PROVIDERS.join(', ')}.`)
}

export interface WriteStarterOptions {
  cwd: string
  provider: Provider
  bucket: string
  /** Where to write. Defaults to `s3nd.config.json` in the working directory. */
  path?: string
  force: boolean
}

/** Writes the starter file, and refuses to overwrite one that already exists. */
export function writeStarter(options: WriteStarterOptions): { path: string; next: string[] } {
  const path = resolvePath(options.cwd, options.path ?? 's3nd.config.json')

  if (existsSync(path) && !options.force) {
    throw new CliError(
      `${path} already exists.`,
      'Pass --force to overwrite it, or --config <path> to write elsewhere.',
    )
  }

  const { config, next } = starter(options.provider, options.bucket)

  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`, 'utf8')

  return { path, next }
}
