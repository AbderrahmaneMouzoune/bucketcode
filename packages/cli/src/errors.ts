/**
 * An error the reader can do something about: a typo, a missing file, a value
 * the configuration cannot hold. It prints as its message and nothing else —
 * no stack, no class name — because everything it says is already the answer.
 */
export class CliError extends Error {
  constructor(
    message: string,
    /** Printed under the message, indented: the command that fixes it. */
    readonly hint?: string,
  ) {
    super(message)
    this.name = 'CliError'
  }
}

export function isCliError(error: unknown): error is CliError {
  return error instanceof CliError
}
