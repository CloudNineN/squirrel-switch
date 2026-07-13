interface SortableAccount {
  name: string;
  planType: string | null;
  subscriptionPlan: string | null;
  subscriptionExpiresAt: number | null;
}

const PLAN_RANKS: Record<string, number> = {
  enterprise: 0,
  enterprise_cbp_usage_based: 0,
  business: 1,
  self_serve_business_usage_based: 1,
  team: 2,
  pro: 3,
  prolite: 4,
  plus: 5,
  go: 6,
  free: 7,
  unknown: 8,
};

export function compareAccountsByMembershipAndExpiry(a: SortableAccount, b: SortableAccount): number {
  const planDelta = planRank(a) - planRank(b);
  if (planDelta !== 0) {
    return planDelta;
  }

  const aExpiry = a.subscriptionExpiresAt ?? Number.MAX_SAFE_INTEGER;
  const bExpiry = b.subscriptionExpiresAt ?? Number.MAX_SAFE_INTEGER;
  if (aExpiry !== bExpiry) {
    return aExpiry - bExpiry;
  }

  return a.name.localeCompare(b.name, "zh-CN");
}

function planRank(account: SortableAccount): number {
  const plan = (account.planType || account.subscriptionPlan || "unknown").trim().toLowerCase();
  return PLAN_RANKS[plan] ?? 8;
}
