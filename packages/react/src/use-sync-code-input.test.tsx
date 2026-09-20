import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { useSyncCodeInput } from './index.js'

describe('useSyncCodeInput', () => {
  it('starts empty, with nothing to submit', () => {
    const { result } = renderHook(() => useSyncCodeInput())

    expect(result.current.value).toBe('')
    expect(result.current.code).toBeNull()
    expect(result.current.isComplete).toBe(false)
    expect(result.current.error).toBeNull()
  })

  it('keeps what the user typed and normalizes alongside it', () => {
    const { result } = renderHook(() => useSyncCodeInput())

    act(() => result.current.setValue('k7-qp2m4x'))

    // The field must not rewrite itself under the cursor.
    expect(result.current.value).toBe('k7-qp2m4x')
    expect(result.current.code).toBe('K7QP2M4X')
    expect(result.current.isComplete).toBe(true)
  })

  it('repairs the characters people misread', () => {
    const { result } = renderHook(() => useSyncCodeInput())

    act(() => result.current.setValue('OIL5ABCD'))

    expect(result.current.code).toBe('0115ABCD')
  })

  it('is incomplete until the code is the full length', () => {
    const { result } = renderHook(() => useSyncCodeInput())

    act(() => result.current.setValue('K7QP'))

    expect(result.current.code).toBe('K7QP')
    expect(result.current.isComplete).toBe(false)
  })

  it('reports a character the alphabet cannot hold, without throwing', () => {
    const { result } = renderHook(() => useSyncCodeInput())

    act(() => result.current.setValue('K7QP2M4!'))

    expect(result.current.code).toBeNull()
    expect(result.current.error).toContain('!')
  })

  it('follows a configured scheme', () => {
    const { result } = renderHook(() => useSyncCodeInput({ length: 4, alphabet: '0123456789' }))

    act(() => result.current.setValue('81 43'))

    expect(result.current.code).toBe('8143')
    expect(result.current.isComplete).toBe(true)
    expect(result.current.inputProps.inputMode).toBe('numeric')
  })

  it('asks for a text keyboard when the alphabet has letters', () => {
    const { result } = renderHook(() => useSyncCodeInput())

    expect(result.current.inputProps.inputMode).toBe('text')
    expect(result.current.inputProps.autoComplete).toBe('one-time-code')
  })

  it('clears on reset', () => {
    const { result } = renderHook(() => useSyncCodeInput())

    act(() => result.current.setValue('K7QP2M4X'))
    act(() => result.current.reset())

    expect(result.current.value).toBe('')
    expect(result.current.code).toBeNull()
  })

  it('drives an input through inputProps', () => {
    const { result } = renderHook(() => useSyncCodeInput())

    act(() => {
      result.current.inputProps.onChange({ target: { value: 'k7qp2m4x' } } as never)
    })

    expect(result.current.code).toBe('K7QP2M4X')
  })
})
