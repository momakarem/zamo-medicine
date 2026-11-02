/**
 * Minimal Result type used across modules so that expected failures
 * (invalid OTP, denied permission, illegal state transition) are returned
 * as values rather than thrown — thrown errors are reserved for bugs.
 */
export type Ok<T> = { ok: true; value: T };
export type Err<E> = { ok: false; error: E };
export type Result<T, E = string> = Ok<T> | Err<E>;

export const ok = <T>(value: T): Ok<T> => ({ ok: true, value });
export const err = <E>(error: E): Err<E> => ({ ok: false, error });

export function unwrap<T, E>(r: Result<T, E>): T {
  if (!r.ok) throw new Error(`unwrap() on Err: ${JSON.stringify(r.error)}`);
  return r.value;
}
