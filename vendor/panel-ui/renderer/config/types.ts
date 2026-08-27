// Barrel re-export for backwards compatibility.
//
// The actual definitions live in `src/shared/config-types.ts` so the
// Sidecar can read PRESET_PROVIDERS / PRESET_MCP_SERVERS / etc. without
// the dependency-cruiser `sidecar-no-import-renderer` boundary rule
// firing. Renderer code keeps its existing `from '@/config/types'` /
// `from './types'` imports unchanged via this barrel.
//
// History: this file used to BE the source of truth (~996 lines). The
// architectural problem was that renderer/ owned config-data constants
// that the Sidecar legitimately needed at runtime (model capabilities,
// preset providers, MCP defaults). The fix is "data lives in shared,
// renderer + sidecar both import from shared." This barrel preserves
// the migration's zero churn for renderer callers.
export * from '../../shared/config-types';
