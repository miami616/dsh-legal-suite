export type ProviderHistoryEnv = {
  providerId?: string;
  baseUrl?: string;
  apiProtocol?: 'anthropic' | 'openai';
  model?: string;
};

export type ProviderHistoryPolicy = {
  isolatedKeys?: ReadonlySet<string>;
};

/**
 * Models/providers that cannot safely replay an SDK transcript created under
 * another model/provider belong here.
 *
 * Intentionally empty for now: the mechanism exists, but ordinary third-party
 * providers stay in the portable protocol family until a concrete
 * incompatibility is proven. Add keys in one of these exact forms:
 *
 * - `provider:<providerId>`
 * - `model:<modelId>`
 * - `endpoint:<apiProtocol>:<normalizedBaseUrl>`
 */
export const ISOLATED_PROVIDER_HISTORY_KEYS: ReadonlySet<string> = new Set<string>();

export function normalizeProviderBaseUrl(baseUrl?: string): string | undefined {
  if (!baseUrl) return undefined;
  try {
    const url = new URL(baseUrl);
    const pathname = url.pathname.replace(/\/+$/, '');
    return `${url.origin}${pathname}`;
  } catch {
    return baseUrl.replace(/\/+$/, '');
  }
}

function nonEmpty(value?: string): string | undefined {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

export function getProviderHistoryIsolationCandidates(providerEnv?: ProviderHistoryEnv): string[] {
  if (!providerEnv) return [];
  const apiProtocol = providerEnv.apiProtocol ?? 'anthropic';
  const normalizedBaseUrl = normalizeProviderBaseUrl(providerEnv.baseUrl);
  return [
    nonEmpty(providerEnv.providerId) ? `provider:${nonEmpty(providerEnv.providerId)}` : undefined,
    nonEmpty(providerEnv.model) ? `model:${nonEmpty(providerEnv.model)}` : undefined,
    normalizedBaseUrl ? `endpoint:${apiProtocol}:${normalizedBaseUrl}` : undefined,
  ].filter((candidate): candidate is string => Boolean(candidate));
}

function getProviderHistoryIsolationKey(
  providerEnv: ProviderHistoryEnv | undefined,
  policy: ProviderHistoryPolicy,
): string | undefined {
  const isolatedKeys = policy.isolatedKeys ?? ISOLATED_PROVIDER_HISTORY_KEYS;
  return getProviderHistoryIsolationCandidates(providerEnv).find(candidate => isolatedKeys.has(candidate));
}

export function getProviderHistoryIdentity(
  providerEnv?: ProviderHistoryEnv,
  policy: ProviderHistoryPolicy = {},
): string {
  const normalizedBaseUrl = normalizeProviderBaseUrl(providerEnv?.baseUrl);
  const isolatedKey = getProviderHistoryIsolationKey(providerEnv, policy);
  if (isolatedKey) {
    const apiProtocol = providerEnv?.apiProtocol ?? 'anthropic';
    const endpoint = normalizedBaseUrl ?? 'anthropic';
    const providerId = nonEmpty(providerEnv?.providerId) ?? '';
    const model = nonEmpty(providerEnv?.model) ?? '';
    return `isolated:${isolatedKey}:${apiProtocol}:${endpoint}:${providerId}:${model}`;
  }
  if (!providerEnv || !normalizedBaseUrl || normalizedBaseUrl === 'https://api.anthropic.com') {
    return 'anthropic';
  }
  // Third-party history stays portable across transport protocols. The SDK
  // transcript remains Anthropic-shaped; OpenAI-protocol providers translate at
  // the request boundary via the bridge. If a concrete provider/model/endpoint
  // cannot replay another portable transcript, quarantine that exact entry via
  // ISOLATED_PROVIDER_HISTORY_KEYS instead of splitting every protocol family.
  return 'third-party';
}

export function canResumeAcrossProviderBoundary(
  currentProviderEnv?: ProviderHistoryEnv,
  nextProviderEnv?: ProviderHistoryEnv,
  policy: ProviderHistoryPolicy = {},
): boolean {
  return getProviderHistoryIdentity(currentProviderEnv, policy) === getProviderHistoryIdentity(nextProviderEnv, policy);
}
