import type { S3Client } from '@aws-sdk/client-s3'
import { vi } from 'vitest'

export interface StubCall {
  command: { constructor: { name: string }; input: Record<string, any> }
  options?: { abortSignal?: AbortSignal }
}

/**
 * Minimal stand-in for `S3Client`: records the commands it is handed and
 * replies with a canned response. Keeps the tests offline and dependency-free.
 */
export function createStubClient(response: Record<string, unknown> = {}, error?: Error) {
  const calls: StubCall[] = []

  const send = vi.fn(async (command: any, options?: any) => {
    calls.push({ command, options })
    if (error) throw error
    return response
  })

  return { client: { send, destroy: vi.fn() } as unknown as S3Client, calls, send }
}

/** Removes every environment variable bucketcode reads, so tests are hermetic. */
export function clearBucketEnv(): void {
  for (const name of [
    'BUCKETCODE_BUCKET',
    'S3_BUCKET',
    'BUCKETCODE_REGION',
    'AWS_REGION',
    'AWS_DEFAULT_REGION',
    'BUCKETCODE_ENDPOINT',
    'S3_ENDPOINT',
    'BUCKETCODE_PUBLIC_URL',
    'S3_PUBLIC_URL',
  ]) {
    vi.stubEnv(name, undefined)
  }
}

/** Mimics the body of a `GetObject` response, with the AWS SDK stream helpers. */
export function s3Body(content: string) {
  const bytes = new TextEncoder().encode(content)

  return {
    transformToByteArray: async () => bytes,
    transformToString: async () => content,
  }
}

/** The error the AWS SDK raises when the key does not exist. */
export function notFoundError(): Error {
  return Object.assign(new Error('The specified key does not exist.'), {
    name: 'NoSuchKey',
    $metadata: { httpStatusCode: 404 },
  })
}

/**
 * A miniature S3: keeps objects in a Map and honours the conditional headers,
 * so a snapshot can genuinely round-trip without a network.
 */
export function createMemoryClient() {
  const objects = new Map<
    string,
    { body: Uint8Array; contentType?: string; metadata?: Record<string, string>; etag: string }
  >()
  let counter = 0

  function precondition(message: string): Error {
    return Object.assign(new Error(message), {
      name: 'PreconditionFailed',
      $metadata: { httpStatusCode: 412 },
    })
  }

  const send = vi.fn(async (command: any) => {
    const name = command.constructor.name
    const input = command.input
    const stored = objects.get(input.Key)

    if (name === 'PutObjectCommand') {
      if (input.IfNoneMatch === '*' && stored) {
        throw precondition('At least one of the pre-conditions you specified did not hold')
      }

      if (input.IfMatch != null && (!stored || input.IfMatch !== `"${stored.etag}"`)) {
        throw precondition('At least one of the pre-conditions you specified did not hold')
      }

      counter += 1
      const etag = `etag-${counter}`
      objects.set(input.Key, {
        body: Buffer.from(input.Body),
        contentType: input.ContentType,
        metadata: input.Metadata,
        etag,
      })

      return { ETag: `"${etag}"` }
    }

    if (name === 'GetObjectCommand') {
      if (!stored) {
        throw Object.assign(new Error('The specified key does not exist.'), {
          name: 'NoSuchKey',
          $metadata: { httpStatusCode: 404 },
        })
      }

      return {
        Body: {
          transformToByteArray: async () => stored.body,
          transformToString: async () => Buffer.from(stored.body).toString('utf8'),
        },
        ContentType: stored.contentType,
        ContentLength: stored.body.byteLength,
        Metadata: stored.metadata ?? {},
        ETag: `"${stored.etag}"`,
      }
    }

    if (name === 'DeleteObjectCommand') {
      objects.delete(input.Key)
      return {}
    }

    throw new Error(`Unexpected command: ${name}`)
  })

  return { client: { send, destroy: vi.fn() } as unknown as S3Client, objects, send }
}
