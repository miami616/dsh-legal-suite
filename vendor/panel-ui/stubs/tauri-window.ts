/**
 * POC stub for @tauri-apps/api/window inside the DSH plugin build.
 *
 * The real Tauri window api resolves as a package but calling it in a DSH web
 * renderer (no Tauri runtime) throws. ThemeRuntime calls getCurrentWindow() at
 * runtime; this stub returns a safe no-op handle so theme resolution never
 * crashes the web panel.
 */

export interface WindowStub {
  minimize(): Promise<void>
  maximize(): Promise<void>
  unmaximize(): Promise<void>
  toggleMaximize(): Promise<void>
  setFullscreen(flag: boolean): Promise<void>
  setTitle(title: string): Promise<void>
  close(): Promise<void>
  destroy(): Promise<void>
  isMaximized(): Promise<boolean>
  onCloseRequested(handler: (e: unknown) => void): Promise<() => void>
  center(): Promise<void>
  setSize(_size: unknown): Promise<void>
  setPosition(_pos: unknown): Promise<void>
}

const noop = async (): Promise<void> => { /* no-op */ }

export function getCurrentWindow(): WindowStub {
  return {
    minimize: noop,
    maximize: noop,
    unmaximize: noop,
    toggleMaximize: noop,
    setFullscreen: noop,
    setTitle: noop,
    close: noop,
    destroy: noop,
    isMaximized: async () => false,
    onCloseRequested: async () => () => {},
    center: noop,
    setSize: noop,
    setPosition: noop,
  }
}

export class Window { /* eslint-disable-line @typescript-eslint/no-extraneous-class */ }
