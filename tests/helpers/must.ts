/** Unwraps a value a test knows is there, failing with a clear message if it is not. */
export function must<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error('Expected a value in the test');
  return value;
}
