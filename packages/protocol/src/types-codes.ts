export interface SyncCodeOptions {
  /** Number of characters. Defaults to `8`; at most 64. */
  length?: number
  /**
   * Characters a code is drawn from. Defaults to Crockford base32. Must hold at
   * least two distinct characters, and no spaces, dashes or underscores — those
   * are stripped when a typed code is read back.
   */
  alphabet?: string
}

export interface SyncCodes {
  readonly alphabet: string
  readonly length: number
  /**
   * How much a code is worth guessing against. Eight Crockford characters is
   * 40 bits; four digits is 13.3, which is a rate limit's problem, not a code's.
   */
  readonly entropyBits: number
  /** A fresh code. */
  create(): string
  /**
   * What someone typed, turned into the canonical code: separators dropped,
   * case folded when the alphabet allows it, and confusable characters repaired
   * when the alphabet makes that unambiguous. Throws `INVALID_SYNC_CODE` on
   * anything the alphabet cannot contain.
   */
  normalize(input: string): string
}
