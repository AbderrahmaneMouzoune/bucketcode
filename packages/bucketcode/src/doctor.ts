import { GetBucketLifecycleConfigurationCommand, HeadBucketCommand } from '@aws-sdk/client-s3'
import { randomUUID } from 'node:crypto'

import type { Bucket } from './bucket.js'

export type CheckStatus = 'ok' | 'warn' | 'fail'

export interface Check {
  name: string
  status: CheckStatus
  detail: string
  /** What to do about it, when there is something to do. */
  fix?: string
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * The failures this catches are the ones that cost an afternoon: credentials
 * that resolve to nothing, a region the endpoint disagrees with, and — the one
 * nobody discovers until a bucket has silently filled up for months — expiring
 * transfers with no lifecycle rule to actually delete them.
 */
export async function runChecks(bucket: Bucket, prefix?: string): Promise<Check[]> {
  const checks: Check[] = []

  const client = bucket.client
  // A caller can hand in their own S3Client, which need not expose `config` the
  // way the SDK's does — so nothing here assumes it is there.
  const config = (client as unknown as { config?: Record<string, unknown> }).config
  const region = await resolve(config?.region)
  const endpoint = await resolveEndpoint(config?.endpoint)

  checks.push({
    name: 'Configuration',
    status: 'ok',
    detail: [`bucket "${bucket.bucket}"`, region ? `region "${region}"` : undefined, endpoint]
      .filter(Boolean)
      .join(', '),
  })

  // The SDK resolves credentials lazily, so a missing profile only surfaces on
  // the first call. Forcing it here turns that into a named check.
  let hasCredentials = false
  try {
    const provider = config?.credentials
    if (typeof provider !== 'function') throw new Error('the client exposes no credentials provider')

    const credentials = (await provider()) as { accessKeyId?: string }
    hasCredentials = Boolean(credentials?.accessKeyId)

    checks.push({
      name: 'Credentials',
      status: hasCredentials ? 'ok' : 'fail',
      detail: hasCredentials
        ? `resolved, key ends in ${credentials.accessKeyId!.slice(-4)}`
        : 'the provider chain returned nothing',
      fix: hasCredentials ? undefined : 'Set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY, or configure a profile.',
    })
  } catch (error) {
    checks.push({
      name: 'Credentials',
      status: 'fail',
      detail: describe(error),
      fix: 'Set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY, or configure a profile.',
    })
  }

  if (!hasCredentials) return checks

  try {
    await client.send(new HeadBucketCommand({ Bucket: bucket.bucket }))
    checks.push({ name: 'Bucket reachable', status: 'ok', detail: 'HeadBucket succeeded' })
  } catch (error) {
    checks.push({
      name: 'Bucket reachable',
      status: 'fail',
      detail: describe(error),
      fix: 'Check the bucket name, the region, and that these credentials can see it.',
    })

    return checks
  }

  // A permissions check that actually exercises the three verbs bucketcode
  // needs, rather than trusting a policy document to say what it means.
  const probeKey = `__bucketcode-doctor/${randomUUID()}`
  try {
    await bucket.put(probeKey, 'bucketcode doctor', { contentType: 'text/plain' })
    const readBack = await bucket.get(probeKey)
    const body = readBack ? await readBack.text() : undefined
    await bucket.delete(probeKey)

    checks.push({
      name: 'Write, read, delete',
      status: body === 'bucketcode doctor' ? 'ok' : 'fail',
      detail: body === 'bucketcode doctor' ? 'round-tripped a probe object' : 'the probe did not read back intact',
    })
  } catch (error) {
    checks.push({
      name: 'Write, read, delete',
      status: 'fail',
      detail: describe(error),
      fix: 'Grant s3:PutObject, s3:GetObject and s3:DeleteObject on this bucket.',
    })
  }

  checks.push(await checkLifecycle(bucket, prefix))

  return checks
}

/**
 * `expiresIn` stops a transfer being *handed over*; it does not remove the
 * object. Only a lifecycle rule does that, and forgetting it is the single
 * most common way a bucketcode bucket goes wrong.
 */
async function checkLifecycle(bucket: Bucket, prefix?: string): Promise<Check> {
  const scope = prefix ? `the "${prefix}" prefix` : 'the bucket'
  const suggestion =
    'Add an S3 lifecycle rule that expires objects under ' +
    (prefix ? `"${prefix}/"` : 'this bucket') +
    ' after a day or two. Without it, expired transfers stay stored and billed.'

  try {
    const response = await bucket.client.send(new GetBucketLifecycleConfigurationCommand({ Bucket: bucket.bucket }))

    const rules = (response.Rules ?? []).filter((rule) => rule.Status === 'Enabled' && rule.Expiration != null)

    if (rules.length === 0) {
      return { name: 'Expiry cleanup', status: 'warn', detail: 'no enabled expiration rule', fix: suggestion }
    }

    const covering = rules.filter((rule) => {
      const rulePrefix = rule.Filter?.Prefix ?? rule.Prefix ?? ''
      return prefix ? prefix.startsWith(rulePrefix) || rulePrefix === '' : rulePrefix === ''
    })

    if (covering.length === 0) {
      return {
        name: 'Expiry cleanup',
        status: 'warn',
        detail: `${rules.length} expiration rule(s), none covering ${scope}`,
        fix: suggestion,
      }
    }

    const days = covering
      .map((rule) => rule.Expiration?.Days)
      .filter((value): value is number => typeof value === 'number')

    return {
      name: 'Expiry cleanup',
      status: 'ok',
      detail: days.length > 0 ? `expires after ${Math.min(...days)} day(s)` : 'an expiration rule covers ' + scope,
    }
  } catch (error) {
    // R2 and MinIO answer NoSuchLifecycleConfiguration; some gateways answer
    // NotImplemented. Neither is a failure of this bucket's configuration.
    const name = (error as { name?: string })?.name

    if (name === 'NoSuchLifecycleConfiguration') {
      return { name: 'Expiry cleanup', status: 'warn', detail: 'no lifecycle configuration', fix: suggestion }
    }

    return {
      name: 'Expiry cleanup',
      status: 'warn',
      detail: `could not be read (${describe(error)})`,
      fix: 'Grant s3:GetLifecycleConfiguration to check this automatically, or verify the rule by hand.',
    }
  }
}

async function resolve(value: unknown): Promise<string | undefined> {
  if (typeof value === 'function') return resolve(await (value as () => Promise<string>)())
  return typeof value === 'string' ? value : undefined
}

async function resolveEndpoint(value: unknown): Promise<string | undefined> {
  if (value == null) return undefined
  if (typeof value === 'function') return resolveEndpoint(await (value as () => Promise<unknown>)())
  if (typeof value === 'string') return `endpoint ${value}`

  const url = value as { hostname?: string; protocol?: string }
  return url?.hostname ? `endpoint ${url.protocol ?? 'https:'}//${url.hostname}` : undefined
}
