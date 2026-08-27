export type SubscriptionVerifyFailureKind =
  | 'auth_required'
  | 'entitlement_required'
  | 'rate_limited'
  | 'network'
  | 'unknown';

export interface SubscriptionInfo {
  accountUuid?: string;
  email?: string;
  displayName?: string;
  organizationName?: string;
}

export interface SubscriptionStatus {
  available: boolean;
  path?: string;
  info?: SubscriptionInfo;
}

export interface SubscriptionVerifyResult {
  success: boolean;
  error?: string;
  detail?: string;
  failureKind?: SubscriptionVerifyFailureKind;
}

export function formatSubscriptionVerifyError(
  result: Pick<SubscriptionVerifyResult, 'error' | 'detail'>,
  fallback = 'Verification failed',
): string {
  const message = result.error?.trim() || fallback;
  const detail = result.detail?.trim();
  if (detail && detail !== message) {
    return `${message}: ${detail}`;
  }
  return message;
}

export function classifySubscriptionVerifyFailureKind(errorText: string): SubscriptionVerifyFailureKind {
  const lower = errorText.toLowerCase();
  if (
    lower.includes('invalid authentication credentials')
    || lower.includes('failed to authenticate')
    || lower.includes('unauthorized')
    || lower.includes('401')
    || lower.includes('/login')
    || lower.includes('login')
  ) {
    return 'auth_required';
  }
  if (
    lower.includes('forbidden')
    || lower.includes('403')
    || lower.includes('permission')
    || lower.includes('subscription')
    || lower.includes('billing')
    || lower.includes('quota')
  ) {
    return 'entitlement_required';
  }
  if (lower.includes('rate limit') || lower.includes('429')) {
    return 'rate_limited';
  }
  if (lower.includes('network') || lower.includes('connect') || lower.includes('timeout')) {
    return 'network';
  }
  return 'unknown';
}

export function isUserActionRequiredSubscriptionFailure(kind: SubscriptionVerifyFailureKind | undefined): boolean {
  return kind === 'auth_required' || kind === 'entitlement_required';
}
