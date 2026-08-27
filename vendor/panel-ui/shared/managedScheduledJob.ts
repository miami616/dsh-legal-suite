import type { ManagedTaskKind } from './types/task';

export const MANAGED_KIND_MEMORY_GARDENER = 'memory_gardener';
export const MANAGED_KIND_MEMORY_MOLT = 'memory_molt';
export const MANAGED_KIND_MEMORY_AUTO_UPDATE_BATCH = 'memory_auto_update_batch';

export const MANAGED_SCHEDULED_JOB_KINDS = [
  MANAGED_KIND_MEMORY_GARDENER,
  MANAGED_KIND_MEMORY_MOLT,
  MANAGED_KIND_MEMORY_AUTO_UPDATE_BATCH,
] as const satisfies readonly ManagedTaskKind[];

export type SystemMaintenanceSessionKind =
  | typeof MANAGED_KIND_MEMORY_GARDENER
  | typeof MANAGED_KIND_MEMORY_MOLT;

export const SYSTEM_MAINTENANCE_SESSION_KINDS = [
  MANAGED_KIND_MEMORY_GARDENER,
  MANAGED_KIND_MEMORY_MOLT,
] as const satisfies readonly SystemMaintenanceSessionKind[];

const MANAGED_SCHEDULED_JOB_KIND_SET = new Set<string>(MANAGED_SCHEDULED_JOB_KINDS);
const SYSTEM_MAINTENANCE_SESSION_KIND_SET = new Set<string>(SYSTEM_MAINTENANCE_SESSION_KINDS);

function normalizeString(value: unknown): string | undefined {
  return typeof value === 'string' ? value.trim() : undefined;
}

function readManagedKind(value: unknown): unknown {
  if (!value || typeof value !== 'object') return value;
  const row = value as { managedKind?: unknown; managed_kind?: unknown };
  return row.managedKind ?? row.managed_kind;
}

function readSystemMaintenanceKind(value: unknown): unknown {
  if (!value || typeof value !== 'object') return value;
  const row = value as { systemMaintenanceKind?: unknown; system_maintenance_kind?: unknown };
  return row.systemMaintenanceKind ?? row.system_maintenance_kind;
}

export function normalizeManagedScheduledJobKind(value: unknown): ManagedTaskKind | undefined {
  const raw = normalizeString(readManagedKind(value));
  if (!raw || !MANAGED_SCHEDULED_JOB_KIND_SET.has(raw)) return undefined;
  return raw as ManagedTaskKind;
}

export function isManagedScheduledJob(value: unknown): boolean {
  return normalizeManagedScheduledJobKind(value) !== undefined;
}

export function normalizeSystemMaintenanceKind(value: unknown): SystemMaintenanceSessionKind | undefined {
  const raw = normalizeString(readSystemMaintenanceKind(value));
  if (!raw || !SYSTEM_MAINTENANCE_SESSION_KIND_SET.has(raw)) return undefined;
  return raw as SystemMaintenanceSessionKind;
}

export function isSystemMaintenanceKind(value: unknown): value is SystemMaintenanceSessionKind {
  return normalizeSystemMaintenanceKind(value) !== undefined;
}

export function isSystemMaintenanceSession(value: unknown): boolean {
  return normalizeSystemMaintenanceKind(value) !== undefined;
}
