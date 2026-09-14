import { useCallback, useEffect, useRef, useState } from 'react'

export type AsyncStatus = 'idle' | 'pending' | 'success' | 'error'

function isAbort(error: unknown): boolean {
  return error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError')
}

/**
 * The bookkeeping every hook here needs, in one place: a status, the last
 * error, and three things that are easy to get wrong on their own.
 *
 * A run aborts the one before it, so a user hammering a button does not end up
 * with whichever request happened to finish last. A late reply from a
 * superseded run is dropped rather than published. And nothing is written after
 * unmount.
 *
 * Failures land in `error` instead of rejecting: these are called from event
 * handlers, where an unhandled rejection is noise rather than a signal. The
 * return value is `null` on failure for callers that want to branch.
 */
export function useAsyncTask<T>() {
  const [data, setData] = useState<T | null>(null)
  const [status, setStatus] = useState<AsyncStatus>('idle')
  const [error, setError] = useState<Error | null>(null)

  const mounted = useRef(true)
  const inFlight = useRef<AbortController | null>(null)
  const latest = useRef(0)

  useEffect(() => {
    mounted.current = true

    return () => {
      mounted.current = false
      inFlight.current?.abort()
    }
  }, [])

  const run = useCallback(async (task: (signal: AbortSignal) => Promise<T>): Promise<T | null> => {
    inFlight.current?.abort()

    const controller = new AbortController()
    inFlight.current = controller
    const id = (latest.current += 1)

    const current = () => mounted.current && id === latest.current

    setStatus('pending')
    setError(null)

    try {
      const result = await task(controller.signal)

      if (current()) {
        setData(result)
        setStatus('success')
      }

      return result
    } catch (caught) {
      // An abort means someone else took over, or we unmounted. Neither is a
      // failure the interface should show.
      if (isAbort(caught) || !current()) return null

      setData(null)
      setError(caught instanceof Error ? caught : new Error(String(caught)))
      setStatus('error')

      return null
    }
  }, [])

  const reset = useCallback(() => {
    inFlight.current?.abort()
    latest.current += 1

    setData(null)
    setStatus('idle')
    setError(null)
  }, [])

  return { data, status, error, run, reset }
}
