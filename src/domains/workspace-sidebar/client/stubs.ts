/**
 * Minimal stubs for app contexts/hooks that the ported DirectoryPanel no
 * longer needs in the DSH plugin.
 */

export function useTabApi(): Record<string, never> {
  return {}
}

export function useWorkspaceChangeSignal(..._args: unknown[]): number {
  return 0
}

export function useImagePreview(): { openPreview: (dataUrl: string, name?: string) => void } {
  return {
    openPreview: () => {
      // Preview is delegated to dsh-better-sidebar via onFilePreviewExternal.
    },
  }
}
