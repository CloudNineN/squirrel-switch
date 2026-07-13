export function selectCodexPlanType(
  rateLimitPlanType: string | null | undefined,
  accountPlanType: string | null | undefined,
  tokenPlanType: string | null | undefined,
): string | null {
  const candidates = [rateLimitPlanType, accountPlanType, tokenPlanType].map(normalizePlanType);
  return candidates.find((value) => value && value !== "unknown") ?? candidates.find(Boolean) ?? null;
}

export function resolveSubscriptionExpiresAt(
  planType: string | null,
  observedExpiresAt: number | null,
  storedExpiresAt: number | null,
): number | null {
  if (planType?.trim().toLowerCase() === "free") {
    return null;
  }
  return observedExpiresAt ?? storedExpiresAt;
}

function normalizePlanType(value: string | null | undefined): string | null {
  const normalized = value?.trim().toLowerCase();
  return normalized || null;
}
