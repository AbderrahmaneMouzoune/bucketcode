import { CliError } from './errors.js'

const UNITS = ['B', 'kB', 'MB', 'GB', 'TB']

/** What a person checks a transfer against is "284 kB", never 284_137. */
export function formatBytes(bytes: number | undefined): string {
  if (bytes == null || !Number.isFinite(bytes)) return 'unknown size'

  let value = bytes
  let unit = 0

  while (value >= 1000 && unit < UNITS.length - 1) {
    value /= 1000
    unit += 1
  }

  return `${unit === 0 ? value : value.toFixed(value < 10 ? 1 : 0)} ${UNITS[unit]}`
}

const MINUTE = 60
const HOUR = 3600
const DAY = 86_400

/** The inverse of `parseDuration`, rounded to the unit a person would say. */
export function formatDuration(seconds: number): string {
  if (seconds % DAY === 0) return plural(seconds / DAY, 'day')
  if (seconds % HOUR === 0) return plural(seconds / HOUR, 'hour')
  if (seconds % MINUTE === 0) return plural(seconds / MINUTE, 'minute')

  return plural(seconds, 'second')
}

function plural(value: number, unit: string): string {
  return `${value} ${unit}${value === 1 ? '' : 's'}`
}

const DURATION = /^(\d+(?:\.\d+)?)\s*(s|m|h|d)?$/i

const MULTIPLIER: Record<string, number> = { s: 1, m: MINUTE, h: HOUR, d: DAY }

/**
 * Seconds, or a duration a person would write: `30m`, `24h`, `7d`. `0`, `null`
 * and `never` all mean a transfer that does not expire — which is the answer to
 * "what is 0 seconds supposed to be", the one reading of it nobody wants.
 */
export function parseDuration(raw: string | number | null | undefined, label: string): number | null {
  if (raw == null) return null
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw) || raw < 0) throw invalidDuration(label, String(raw))
    return raw === 0 ? null : raw
  }

  const trimmed = raw.trim()
  if (trimmed.toLowerCase() === 'never') return null

  const match = DURATION.exec(trimmed)
  if (!match) throw invalidDuration(label, raw)

  const value = Number(match[1]) * MULTIPLIER[(match[2] ?? 's').toLowerCase()]!

  return value === 0 ? null : value
}

function invalidDuration(label: string, received: string): CliError {
  return new CliError(
    `${label} must be a duration: seconds, or a number followed by s, m, h or d (received "${received}").`,
    'Examples: 90s, 30m, 24h, 7d — or "never" for a transfer that does not expire.',
  )
}

export interface Style {
  green(text: string): string
  yellow(text: string): string
  red(text: string): string
  bold(text: string): string
  dim(text: string): string
}

const PLAIN: Style = {
  green: (text) => text,
  yellow: (text) => text,
  red: (text) => text,
  bold: (text) => text,
  dim: (text) => text,
}

/**
 * Colour when a terminal is reading and not otherwise: piping `s3nd put` into
 * anything, or running it in CI, should not produce escape codes. `NO_COLOR` is
 * honoured because <https://no-color.org> asks, and because it is one `if`.
 */
export function createStyle(stream: { isTTY?: boolean }, env: Record<string, string | undefined>): Style {
  const enabled = Boolean(stream.isTTY) && !env.NO_COLOR && env.TERM !== 'dumb'
  if (!enabled) return PLAIN

  const wrap = (open: number, close: number) => (text: string) => `\u001B[${open}m${text}\u001B[${close}m`

  return {
    green: wrap(32, 39),
    yellow: wrap(33, 39),
    red: wrap(31, 39),
    bold: wrap(1, 22),
    dim: wrap(2, 22),
  }
}
