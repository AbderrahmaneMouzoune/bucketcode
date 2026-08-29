import { customAlphabet } from 'nanoid'

import { BucketCodeError } from './errors.js'
import type { SyncCodeOptions, SyncCodes } from './types.js'

/**
 * Ready-made alphabets. Pass your own if none of these fit — the only rule is
 * that a code has to survive being read off one screen and typed into another.
 */
export const syncCodeAlphabets = {
  /**
   * [Crockford base32](https://www.crockford.com/base32.html). No `I`, `L`, `O`
   * or `U`: the first three are the characters people misread, and dropping `U`
   * keeps a random code from spelling something unfortunate.
   */
  crockford: '0123456789ABCDEFGHJKMNPQRSTVWXYZ',
  /** Digits only. Short and phone-keyboard friendly, at 3.32 bits per character. */
  digits: '0123456789',
  /** Every uppercase letter and digit, confusable ones included. */
  alphanumeric: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',
} as const

const DEFAULT_ALPHABET = syncCodeAlphabets.crockford
const DEFAULT_LENGTH = 8
const MAX_LENGTH = 64
/** Stripped before matching, so a code can be shown grouped: "K7QP 2M4X". */
const SEPARATORS = /[\s\-_]+/g

function assertValidAlphabet(alphabet: string): void {
  if (typeof alphabet !== 'string' || alphabet.length < 2) {
    throw new BucketCodeError('INVALID_CONFIG', 'A sync code alphabet needs at least two characters.')
  }

  if (SEPARATORS.test(alphabet)) {
    SEPARATORS.lastIndex = 0
    throw new BucketCodeError(
      'INVALID_CONFIG',
      'A sync code alphabet must not contain spaces, dashes or underscores: those are stripped when a code is read back.',
    )
  }

  SEPARATORS.lastIndex = 0

  if (new Set(alphabet).size !== alphabet.length) {
    throw new BucketCodeError('INVALID_CONFIG', 'A sync code alphabet must not repeat a character.')
  }
}

function assertValidLength(length: number): void {
  if (!Number.isInteger(length) || length < 1 || length > MAX_LENGTH) {
    throw new BucketCodeError('INVALID_CONFIG', `A sync code length must be an integer between 1 and ${MAX_LENGTH}.`)
  }
}

/**
 * Which misreadings this alphabet lets us repair. Folding `O` to zero is only
 * safe when the alphabet has a zero and no letter O to confuse it with — which
 * is exactly the property Crockford base32 was designed around, and which digit
 * alphabets have for free.
 */
function buildFoldMap(alphabet: string): Map<string, string> {
  const has = (character: string) => alphabet.includes(character)
  const folds = new Map<string, string>()

  if (has('0') && !has('O')) folds.set('O', '0')
  if (has('1')) {
    if (!has('I')) folds.set('I', '1')
    if (!has('L')) folds.set('L', '1')
  }

  return folds
}

/**
 * Pairs code generation with the normalization that reads codes back, so the
 * two can never disagree about the alphabet.
 */
export function createSyncCodes(options: SyncCodeOptions = {}): SyncCodes {
  const alphabet = options.alphabet ?? DEFAULT_ALPHABET
  const length = options.length ?? DEFAULT_LENGTH

  assertValidAlphabet(alphabet)
  assertValidLength(length)

  const generate = customAlphabet(alphabet, length)
  const folds = buildFoldMap(alphabet)
  // Upper-casing what someone typed only helps when the alphabet has one case.
  const foldCase = !/[a-z]/.test(alphabet)

  return {
    alphabet,
    length,
    entropyBits: Math.log2(alphabet.length) * length,

    create: () => generate(),

    normalize(input: string): string {
      if (typeof input !== 'string') {
        throw new BucketCodeError('INVALID_SYNC_CODE', 'A sync code must be a string.')
      }

      let normalized = input.trim().replace(SEPARATORS, '')
      if (foldCase) normalized = normalized.toUpperCase()

      normalized = [...normalized].map((character) => folds.get(character) ?? character).join('')

      if (normalized.length === 0) {
        throw new BucketCodeError('INVALID_SYNC_CODE', 'A sync code must not be empty.')
      }

      for (const character of normalized) {
        if (!alphabet.includes(character)) {
          throw new BucketCodeError(
            'INVALID_SYNC_CODE',
            `"${input}" is not a valid sync code: "${character}" is not one of ${alphabet}.`,
          )
        }
      }

      return normalized
    },
  }
}

const defaultCodes = createSyncCodes()

/** A code with the default scheme: eight Crockford base32 characters. */
export function createSyncCode(options?: SyncCodeOptions): string {
  return options ? createSyncCodes(options).create() : defaultCodes.create()
}

/**
 * Turns what someone typed into the canonical code. Configure the scheme once
 * on `createBucket()` and use `store.codes.normalize()` instead when your codes
 * are not the default shape.
 */
export function normalizeSyncCode(input: string, options?: SyncCodeOptions): string {
  return options ? createSyncCodes(options).normalize(input) : defaultCodes.normalize(input)
}
