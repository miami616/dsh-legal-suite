/**
 * POC stub for @tauri-apps/api/core inside the DSH plugin build.
 *
 * The original AgentLex renderer calls Tauri commands only when
 * `isTauriEnvironment()` is true. Inside DSH web GUI it is always false, so
 * these stubs are never reached at runtime; they exist so the client bundle
 * can resolve the imports without shipping the real Tauri runtime.
 */

export async function invoke<T = unknown>(
  _cmd: string,
  _args?: Record<string, unknown>,
): Promise<T> {
  throw new Error('[agentlex-dsh] Tauri invoke is unavailable in DSH plugin mode')
}

/** Message channel stub (used by config services / agent channels). */
export class Channel<T = unknown> {
  onmessage?: (message: T) => void
}

/** Generic resource handle stub. */
export class Resource {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  close(_data?: unknown): void {
    /* no-op */
  }
}
