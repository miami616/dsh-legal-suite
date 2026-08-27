/**
 * POC stub for @tauri-apps/api/event.
 *
 * `listen` is only used when isTauriEnvironment() is true; in DSH plugin mode
 * it is never reached. The stub returns a no-op unlisten function so the
 * call sites type-check and bundling succeeds.
 */

export async function listen<T>(
  _event: string,
  _handler: (event: { payload: T }) => void,
): Promise<() => void> {
  return () => {}
}

/** No-op emit — never reached in DSH plugin mode (see listen above). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function emit(_event: string, _payload?: unknown): void {
  /* no-op */
}
