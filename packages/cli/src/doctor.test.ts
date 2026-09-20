import { describe, expect, it, vi } from 'vitest'

import { createBucket } from 's3nd'
import type { S3Client } from '@aws-sdk/client-s3'

import { runChecks, type Check } from './doctor.js'

/**
 * A stand-in shaped to exactly what `doctor` exercises: the three object verbs,
 * HeadBucket, and the lifecycle configuration. Purpose-built rather than shared
 * with the core package's test helpers, so the CLI's tests do not depend on
 * another package's test internals.
 */
function createDoctorClient() {
  const objects = new Map<string, Buffer>()
  let lifecycle: Record<string, any>[] | undefined

  const send = vi.fn(async (command: any) => {
    const name = command.constructor.name
    const { Key, Body } = command.input ?? {}

    if (name === 'HeadBucketCommand') return {}

    if (name === 'PutObjectCommand') {
      objects.set(Key, Buffer.from(Body))
      return { ETag: '"etag"' }
    }

    if (name === 'GetObjectCommand') {
      const stored = objects.get(Key)
      if (!stored) {
        throw Object.assign(new Error('missing'), { name: 'NoSuchKey', $metadata: { httpStatusCode: 404 } })
      }

      return {
        Body: {
          transformToByteArray: async () => stored,
          transformToString: async () => stored.toString('utf8'),
        },
        ContentType: 'text/plain',
        ContentLength: stored.byteLength,
        Metadata: {},
        ETag: '"etag"',
      }
    }

    if (name === 'DeleteObjectCommand') {
      objects.delete(Key)
      return {}
    }

    if (name === 'GetBucketLifecycleConfigurationCommand') {
      if (lifecycle === undefined) {
        throw Object.assign(new Error('none'), {
          name: 'NoSuchLifecycleConfiguration',
          $metadata: { httpStatusCode: 404 },
        })
      }

      return { Rules: lifecycle }
    }

    throw new Error(`Unexpected command: ${name}`)
  })

  return {
    client: {
      send,
      destroy: vi.fn(),
      config: {
        region: 'eu-west-3',
        credentials: async () => ({ accessKeyId: 'AKIAEXAMPLE1234', secretAccessKey: 'secret' }),
      },
    } as unknown as S3Client,
    objects,
    setLifecycle(rules: Record<string, any>[] | undefined) {
      lifecycle = rules
    },
  }
}

function find(checks: Check[], name: string): Check {
  const check = checks.find((candidate) => candidate.name === name)
  if (!check) throw new Error(`No check named "${name}" in: ${checks.map((c) => c.name).join(', ')}`)

  return check
}

describe('runChecks', () => {
  it('reports a healthy bucket', async () => {
    const memory = createDoctorClient()
    memory.setLifecycle([{ Status: 'Enabled', Expiration: { Days: 2 }, Filter: { Prefix: '' } }])

    const checks = await runChecks(createBucket({ bucket: 'transfers', client: memory.client }))

    expect(checks.every((check) => check.status === 'ok')).toBe(true)
    expect(find(checks, 'Configuration').detail).toContain('transfers')
    expect(find(checks, 'Expiry cleanup').detail).toContain('2 day')
  })

  it('never prints the whole access key', async () => {
    const memory = createDoctorClient()
    const checks = await runChecks(createBucket({ bucket: 'transfers', client: memory.client }))

    const detail = find(checks, 'Credentials').detail
    expect(detail).toContain('1234')
    expect(detail).not.toContain('AKIAEXAMPLE')
  })

  it('leaves no probe object behind', async () => {
    const memory = createDoctorClient()
    await runChecks(createBucket({ bucket: 'transfers', client: memory.client }))

    expect(memory.objects.size).toBe(0)
  })

  it('warns when nothing will ever delete an expired transfer', async () => {
    const memory = createDoctorClient()
    // setLifecycle was never called: the bucket has no configuration at all.
    const checks = await runChecks(createBucket({ bucket: 'transfers', client: memory.client }))

    const lifecycle = find(checks, 'Expiry cleanup')
    expect(lifecycle.status).toBe('warn')
    expect(lifecycle.fix).toContain('lifecycle rule')
  })

  it('warns when the rules exist but miss the prefix in use', async () => {
    const memory = createDoctorClient()
    memory.setLifecycle([{ Status: 'Enabled', Expiration: { Days: 1 }, Filter: { Prefix: 'somewhere-else/' } }])

    const checks = await runChecks(
      createBucket({ bucket: 'transfers', prefix: 'snapshots', client: memory.client }),
      'snapshots',
    )

    expect(find(checks, 'Expiry cleanup').status).toBe('warn')
  })

  it('accepts a rule whose prefix covers the one in use', async () => {
    const memory = createDoctorClient()
    memory.setLifecycle([{ Status: 'Enabled', Expiration: { Days: 1 }, Filter: { Prefix: 'snap' } }])

    const checks = await runChecks(
      createBucket({ bucket: 'transfers', prefix: 'snapshots', client: memory.client }),
      'snapshots',
    )

    expect(find(checks, 'Expiry cleanup').status).toBe('ok')
  })

  it('ignores a disabled rule', async () => {
    const memory = createDoctorClient()
    memory.setLifecycle([{ Status: 'Disabled', Expiration: { Days: 1 }, Filter: { Prefix: '' } }])

    const checks = await runChecks(createBucket({ bucket: 'transfers', client: memory.client }))

    expect(find(checks, 'Expiry cleanup').status).toBe('warn')
  })

  it('stops at the first blocking failure instead of cascading', async () => {
    const client = { send: async () => ({}), destroy: () => {} } as never
    const checks = await runChecks(createBucket({ bucket: 'transfers', client }))

    // No credentials provider on this client, so nothing past that is meaningful.
    expect(find(checks, 'Credentials').status).toBe('fail')
    expect(checks.some((check) => check.name === 'Bucket reachable')).toBe(false)
  })
})
