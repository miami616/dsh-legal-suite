import type { Provider, ProviderVerifyStatus } from './config-types';
import {
  isBuiltinSubscriptionProviderId,
  isProviderEnabled,
  XAI_SUBSCRIPTION_PROVIDER_ID,
  type BuiltinSubscriptionProviderId,
} from './config-types';

export type ProviderRoute =
  | {
      kind: 'provider';
      providerId: string;
      model: string;
    }
  | {
      kind: 'subscription';
      providerId: BuiltinSubscriptionProviderId;
      model: string;
    }
  | {
      kind: 'unknown-legacy';
      model?: string;
      reason:
        | 'missing-model'
        | 'missing-provider-id'
        | 'provider-deleted'
        | 'provider-disabled'
        | 'provider-model-mismatch'
        | 'no-credentialed-provider'
        | 'ambiguous-model';
      candidateProviderIds?: string[];
    };

export interface ProviderRouteCredentialState {
  apiKeys?: Record<string, string | null | undefined>;
  verifyStatus?: Record<string, ProviderVerifyStatus | undefined>;
}

type ProviderForRoute = Pick<Provider, 'id' | 'type' | 'models' | 'enabled'>;

function nonEmpty(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export function providerDeclaresModel(
  provider: Pick<Provider, 'models'> | null | undefined,
  model: string | null | undefined,
): boolean {
  const modelId = nonEmpty(model);
  if (!modelId) return false;
  return provider?.models?.some(entry => entry.model === modelId) ?? false;
}

export function hasProviderRouteCredential(
  provider: ProviderForRoute,
  credentials: ProviderRouteCredentialState,
): boolean {
  if (provider.type === 'subscription') {
    if (!isBuiltinSubscriptionProviderId(provider.id)) return false;
    const status = credentials.verifyStatus?.[provider.id];
    if (provider.id === XAI_SUBSCRIPTION_PROVIDER_ID) {
      return status?.status === 'valid';
    }
    return (
      status?.status === 'valid'
      || !!nonEmpty(status?.accountEmail)
      || !!nonEmpty(status?.verifiedAt)
    );
  }

  return !!nonEmpty(credentials.apiKeys?.[provider.id]);
}

export function getCredentialConfiguredProviderCandidates<T extends ProviderForRoute>(
  providers: ReadonlyArray<T>,
  model: string | null | undefined,
  credentials: ProviderRouteCredentialState,
): T[] {
  const modelId = nonEmpty(model);
  if (!modelId) return [];
  return providers.filter(provider =>
    providerDeclaresModel(provider, modelId)
    && hasProviderRouteCredential(provider, credentials),
  );
}

function concreteRoute(provider: ProviderForRoute, model: string): ProviderRoute {
  if (provider.type === 'subscription' && isBuiltinSubscriptionProviderId(provider.id)) {
    return { kind: 'subscription', providerId: provider.id, model };
  }
  return { kind: 'provider', providerId: provider.id, model };
}

export function resolveExplicitProviderRoute(args: {
  providerId: string | null | undefined;
  model: string | null | undefined;
  providers: ReadonlyArray<ProviderForRoute>;
}): ProviderRoute {
  const providerId = nonEmpty(args.providerId);
  const model = nonEmpty(args.model);
  if (!model) return { kind: 'unknown-legacy', reason: 'missing-model' };
  if (!providerId) {
    return { kind: 'unknown-legacy', model, reason: 'missing-provider-id' };
  }

  const provider = args.providers.find(candidate => candidate.id === providerId);
  if (!provider) return { kind: 'unknown-legacy', model, reason: 'provider-deleted' };
  if (!isProviderEnabled(provider)) return { kind: 'unknown-legacy', model, reason: 'provider-disabled' };
  if (!providerDeclaresModel(provider, model)) {
    return { kind: 'unknown-legacy', model, reason: 'provider-model-mismatch' };
  }
  return concreteRoute(provider, model);
}

export function resolveLegacyModelOnlyProviderRoute(args: {
  model: string | null | undefined;
  providers: ReadonlyArray<ProviderForRoute>;
  credentials: ProviderRouteCredentialState;
}): ProviderRoute {
  const model = nonEmpty(args.model);
  if (!model) return { kind: 'unknown-legacy', reason: 'missing-model' };

  const candidates = getCredentialConfiguredProviderCandidates(
    args.providers,
    model,
    args.credentials,
  );
  if (candidates.length === 1) return concreteRoute(candidates[0], model);

  return {
    kind: 'unknown-legacy',
    model,
    reason: candidates.length === 0 ? 'no-credentialed-provider' : 'ambiguous-model',
    ...(candidates.length > 0 ? { candidateProviderIds: candidates.map(provider => provider.id) } : {}),
  };
}

export function isConcreteProviderRoute(
  route: ProviderRoute | null | undefined,
): route is Extract<ProviderRoute, { kind: 'provider' | 'subscription' }> {
  if (!route || typeof route !== 'object') return false;
  if (route.kind === 'provider') {
    return !!nonEmpty(route.providerId) && !!nonEmpty(route.model);
  }
  if (route.kind === 'subscription') {
    return isBuiltinSubscriptionProviderId(route.providerId) && !!nonEmpty(route.model);
  }
  return false;
}

export function providerRouteMirrorProviderId(
  route: ProviderRoute | null | undefined,
): string | undefined {
  return isConcreteProviderRoute(route) ? route.providerId : undefined;
}

export function createConcreteProviderRoute(providerId: string, model: string): ProviderRoute {
  if (isBuiltinSubscriptionProviderId(providerId)) {
    return { kind: 'subscription', providerId, model };
  }
  return { kind: 'provider', providerId, model };
}
