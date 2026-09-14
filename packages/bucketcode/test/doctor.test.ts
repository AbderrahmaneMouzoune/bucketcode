import { describe, expect, it } from 'vitest'

import { createBucket } from '../src/bucket.js'
import { runChecks, type Check } from '../src/doctor.js'
import { createMemoryClient } from './helpers.js'

function find(checks: Check[], name: string): Check {
  const check = checks.find((candidate) => candidate.name === name)
  if (!check) throw new Error(`No check named "${name}" in: ${checks.map((c) => c.name).join(', ')}`)

  return check
}

describe('runChecks', () => {
  it('reports a healthy bucket', async () => {
    const memory = createMemoryClient()
    memory.setLifecycle([{ Status: 'Enabled', Expiration: { Days: 2 }, Filter: { Prefix: '' } }])

    const checks = await runChecks(createBucket({ bucket: 'transfers', client: memory.client }))

    expect(checks.every((check) => check.status === 'ok')).toBe(true)
    expect(find(checks, 'Configuration').detail).toContain('transfers')
    expect(find(checks, 'Expiry cleanup').detail).toContain('2 day')
  })

  it('never prints the whole access key', async () => {
    const memory = createMemoryClient()
    const checks = await runChecks(createBucket({ bucket: 'transfers', client: memory.client }))

    const detail = find(checks, 'Credentials').detail
    expect(detail).toContain('1234')
    expect(detail).not.toContain('AKIAEXAMPLE')
  })

  it('leaves no probe object behind', async () => {
    const memory = createMemoryClient()
    await runChecks(createBucket({ bucket: 'transfers', client: memory.client }))

    expect(memory.objects.size).toBe(0)
  })

  it('warns when nothing will ever delete an expired transfer', async () => {
    const memory = createMemoryClient()
    // setLifecycle was never called: the bucket has no configuration at all.
    const checks = await runChecks(createBucket({ bucket: 'transfers', client: memory.client }))

    const lifecycle = find(checks, 'Expiry cleanup')
    expect(lifecycle.status).toBe('warn')
    expect(lifecycle.fix).toContain('lifecycle rule')
  })

  it('warns when the rules exist but miss the prefix in use', async () => {
    const memory = createMemoryClient()
    memory.setLifecycle([{ Status: 'Enabled', Expiration: { Days: 1 }, Filter: { Prefix: 'somewhere-else/' } }])

    const checks = await runChecks(
      createBucket({ bucket: 'transfers', prefix: 'snapshots', client: memory.client }),
      'snapshots',
    )

    expect(find(checks, 'Expiry cleanup').status).toBe('warn')
  })

  it('accepts a rule whose prefix covers the one in use', async () => {
    const memory = createMemoryClient()
    memory.setLifecycle([{ Status: 'Enabled', Expiration: { Days: 1 }, Filter: { Prefix: 'snap' } }])

    const checks = await runChecks(
      createBucket({ bucket: 'transfers', prefix: 'snapshots', client: memory.client }),
      'snapshots',
    )

    expect(find(checks, 'Expiry cleanup').status).toBe('ok')
  })

  it('ignores a disabled rule', async () => {
    const memory = createMemoryClient()
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
