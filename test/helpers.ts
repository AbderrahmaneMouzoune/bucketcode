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
