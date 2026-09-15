'use client'

import { createTransferClient, type TransferClient } from '@s3nd/protocol'
import { createContext, useContext, useMemo, type ReactNode } from 'react'

const TransferClientContext = createContext<TransferClient | null>(null)

export interface S3ndProviderProps {
  children: ReactNode
  /**
   * Where your transfer routes are mounted, e.g. `/api/transfers`. Ignored when
   * `client` is given.
   */
  baseUrl?: string
  /** Sent on every request — a bearer token, an API key. Ignored when `client` is given. */
  headers?: Record<string, string>
  /** Bring your own client, for tests or a custom fetch with retries. */
  client?: TransferClient
}

/**
 * Holds the client the hooks talk to. Put it above anything that transfers.
 *
 * Nothing under here ever sees a storage credential: the browser talks to your
 * routes, and your routes talk to the bucket.
 */
export function S3ndProvider({ children, baseUrl, headers, client }: S3ndProviderProps) {
  // `headers` is almost always an object literal, so a new reference on every
  // render. Keying the memo on its content stops that rebuilding the client.
  const headerKey = headers ? JSON.stringify(headers) : ''

  const value = useMemo(() => {
    if (client) return client

    if (!baseUrl) {
      throw new Error('S3ndProvider needs either a `baseUrl` or a `client`.')
    }

    // Reading headers back out of the key, rather than closing over the prop,
    // keeps the dependency list honest instead of suppressed.
    return createTransferClient({
      baseUrl,
      headers: headerKey ? (JSON.parse(headerKey) as Record<string, string>) : undefined,
    })
  }, [client, baseUrl, headerKey])

  return <TransferClientContext.Provider value={value}>{children}</TransferClientContext.Provider>
}

/** The client the nearest provider configured. */
export function useTransferClient(): TransferClient {
  const client = useContext(TransferClientContext)

  if (!client) {
    throw new Error('No s3nd client in context. Wrap this tree in <S3ndProvider baseUrl="/api/transfers">.')
  }

  return client
}
