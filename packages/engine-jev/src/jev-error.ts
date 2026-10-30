/** Any failure to get answers from Jev: invalid questions, timeout, or an API error (see `cause`). */
export class JevError extends Error {
  override name = "JevError";

  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
  }
}
