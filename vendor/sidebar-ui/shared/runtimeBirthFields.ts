import {
  coercePermissionModeForRuntime,
  getDefaultRuntimePermissionMode,
  type RuntimeType,
} from './types/runtime';
import {
  REASONING_EFFORT_DEFAULT,
  coerceReasoningEffortSettingForRuntime,
} from './reasoningEffort';

export function coerceRuntimeBirthPermissionMode(
  value: string | null | undefined,
  runtime: RuntimeType,
): string | undefined {
  if (value === undefined || value === null) return undefined;
  return coercePermissionModeForRuntime(value, runtime)
    ?? getDefaultRuntimePermissionMode(runtime);
}

export function coerceRuntimeBirthReasoningEffort(
  value: string | null | undefined,
  runtime: RuntimeType,
): string | undefined {
  if (value === undefined || value === null) return undefined;
  return coerceReasoningEffortSettingForRuntime(value, runtime)
    ?? REASONING_EFFORT_DEFAULT;
}
