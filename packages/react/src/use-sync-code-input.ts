'use client'

import { createSyncCodes, isS3ndError, type SyncCodeOptions } from '@s3nd/protocol'
import { useCallback, useMemo, useState, type ChangeEvent } from 'react'

export interface SyncCodeInputProps {
  value: string
  onChange: (event: ChangeEvent<HTMLInputElement>) => void
  autoComplete: string
  autoCapitalize: string
  autoCorrect: string
  spellCheck: false
  inputMode: 'text' | 'numeric'
}

export interface SyncCodeInput {
  /** What the user typed, unchanged — so the field does not fight them. */
  value: string
  setValue: (next: string) => void
  /** The canonical code, or `null` while what is typed cannot be one. */
  code: string | null
  /** True once `code` is the full configured length: the moment to submit. */
  isComplete: boolean
  /** Set when the input holds a character the alphabet cannot contain. */
  error: string | null
  reset: () => void
  /** Spread onto an `<input>` for the keyboard and autofill behaviour a code wants. */
  inputProps: SyncCodeInputProps
}

/**
 * Drives the field where someone types the code from their other device.
 *
 * The repair happens here, in the browser, before any request: separators
 * dropped, case folded, and `O`/`I`/`L` read as `0`/`1`/`1` where the alphabet
 * makes that unambiguous. Pass the same `syncCode` options the server uses.
 *
 * What the user typed is kept verbatim in `value`; the normalized form is
 * `code`. Rewriting the field under the cursor as they type is the one thing
 * that makes these inputs miserable to use.
 */
export function useSyncCodeInput(options: SyncCodeOptions = {}): SyncCodeInput {
  const [value, setValue] = useState('')

  const { length, alphabet } = options
  const codes = useMemo(() => createSyncCodes({ length, alphabet }), [length, alphabet])

  const { code, error } = useMemo(() => {
    if (value.trim().length === 0) return { code: null, error: null }

    try {
      return { code: codes.normalize(value), error: null }
    } catch (caught) {
      if (isS3ndError(caught) && caught.code === 'INVALID_SYNC_CODE') {
        return { code: null, error: caught.message }
      }

      throw caught
    }
  }, [codes, value])

  const reset = useCallback(() => setValue(''), [])
  const onChange = useCallback((event: ChangeEvent<HTMLInputElement>) => setValue(event.target.value), [])

  return {
    value,
    setValue,
    code,
    isComplete: code != null && code.length === codes.length,
    error,
    reset,
    inputProps: {
      value,
      onChange,
      // A transfer code is a one-time code; browsers offer to fill it from SMS
      // and, more usefully here, stop offering unrelated saved values.
      autoComplete: 'one-time-code',
      autoCapitalize: 'characters',
      autoCorrect: 'off',
      spellCheck: false,
      inputMode: /^[0-9]+$/.test(codes.alphabet) ? 'numeric' : 'text',
    },
  }
}
