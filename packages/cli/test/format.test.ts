import { describe, expect, it } from 'vitest'

import { createStyle, formatBytes, formatDuration, parseDuration } from '../src/format.js'

describe('formatBytes', () => {
  it('reads the way a person checks a file', () => {
    expect(formatBytes(284)).toBe('284 B')
    expect(formatBytes(284_137)).toBe('284 kB')
    expect(formatBytes(1_500)).toBe('1.5 kB')
    expect(formatBytes(12_300_000)).toBe('12 MB')
  })

  it('says so rather than printing NaN', () => {
    expect(formatBytes(undefined)).toBe('unknown size')
  })
})

describe('parseDuration', () => {
  it('takes seconds and the suffixes people write', () => {
    expect(parseDuration(3600, 'x')).toBe(3600)
    expect(parseDuration('90s', 'x')).toBe(90)
    expect(parseDuration('30m', 'x')).toBe(1800)
    expect(parseDuration('24h', 'x')).toBe(86_400)
    expect(parseDuration('7d', 'x')).toBe(604_800)
  })

  it('reads every spelling of "does not expire" the same way', () => {
    expect(parseDuration(0, 'x')).toBeNull()
    expect(parseDuration('0', 'x')).toBeNull()
    expect(parseDuration('never', 'x')).toBeNull()
    expect(parseDuration(null, 'x')).toBeNull()
  })

  it('names the flag it was given, since that is what has to change', () => {
    expect(() => parseDuration('5 weeks', '--expires-in')).toThrow(/--expires-in must be a duration/)
    expect(() => parseDuration(-1, '--expires-in')).toThrow(/--expires-in/)
  })
})

describe('formatDuration', () => {
  it('rounds to the unit it was probably written in', () => {
    expect(formatDuration(3600)).toBe('1 hour')
    expect(formatDuration(86_400)).toBe('1 day')
    expect(formatDuration(1800)).toBe('30 minutes')
    expect(formatDuration(45)).toBe('45 seconds')
  })
})

describe('createStyle', () => {
  it('leaves output alone when nothing is there to read the colours', () => {
    const style = createStyle({ isTTY: false }, {})

    expect(style.green('ok')).toBe('ok')
  })

  it('honours NO_COLOR even at a terminal', () => {
    expect(createStyle({ isTTY: true }, { NO_COLOR: '1' }).red('bad')).toBe('bad')
    expect(createStyle({ isTTY: true }, { TERM: 'dumb' }).red('bad')).toBe('bad')
  })

  it('colours when a terminal is reading', () => {
    expect(createStyle({ isTTY: true }, {}).green('ok')).toBe('\u001B[32mok\u001B[39m')
  })
})
