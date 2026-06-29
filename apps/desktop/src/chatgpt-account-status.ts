export type ChatGptSessionStatus = "unchecked" | "available" | "invalid" | "reauth_required";

export interface ChatGptAccountStatus {
  status: ChatGptSessionStatus;
  accountEmail: string | null;
  accountName: string | null;
  accountId: string | null;
  planType: string | null;
  planLabel: string | null;
  subscriptionExpiresAt: number | null;
  subscriptionRenewsAt: number | null;
  checkedAt: number;
  error: string | null;
}

export interface ChatGptApiReadResult {
  status: number;
  json?: unknown;
  unauthorized?: true;
  forbidden?: true;
}

export function firstStringByKeys(candidates: unknown[], keys: string[]): string | null {
  for (const candidate of candidates) {
    const value = deepFindByKeys(candidate, keys);
    const text = readString(value);
    if (text) {
      return text;
    }
  }
  return null;
}

export function accountIdFromAccountsCheck(value: unknown): string | null {
  if (!isRecord(value)) return null;
  const accounts = value.accounts;
  if (!isRecord(accounts)) return null;
  for (const [key, accountValue] of Object.entries(accounts)) {
    if (isBillingAccountId(key)) return key;
    if (!isRecord(accountValue)) continue;
    const account = accountValue.account;
    if (!isRecord(account)) continue;
    const accountId = account.account_id;
    if (typeof accountId === "string" && isBillingAccountId(accountId)) return accountId;
    const accountUserId = account.account_user_id;
    if (typeof accountUserId === "string") {
      const userAccountId = accountUserId.split("__").at(-1);
      if (userAccountId && isBillingAccountId(userAccountId)) return userAccountId;
    }
  }
  return null;
}

export function collectBillingAccountIds(value: unknown): string[] {
  const results = new Set<string>();
  const visit = (node: unknown, depth: number) => {
    if (depth > 8 || node === null || node === undefined) return;
    if (typeof node === "string") {
      const matches = node.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi);
      for (const match of matches ?? []) {
        results.add(match);
      }
      return;
    }
    if (Array.isArray(node)) {
      for (const item of node.slice(0, 20)) {
        visit(item, depth + 1);
      }
      return;
    }
    if (!isRecord(node)) return;
    for (const child of Object.values(node)) {
      visit(child, depth + 1);
    }
  };
  visit(value, 0);
  return [...results];
}

export function uniqueStrings(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => typeof value === "string" && value.trim().length > 0))];
}

export function isBillingAccountId(accountId: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(accountId);
}

export function normalizeChatGptAccountStatus(
  value: unknown,
  checkedAt: number,
): ChatGptAccountStatus {
  if (!isRecord(value)) {
    return emptyChatGptAccountStatus("available", checkedAt, "会员信息不可用");
  }

  const authSession = isRecord(value.authSession) ? value.authSession : null;
  const accountCheck = isRecord(value.accountCheck) ? value.accountCheck : null;
  const subscription = isRecord(value.subscription) ? value.subscription : null;
  const resolvedAccountId = readString(value.resolvedAccountId);
  const statusResponses = [
    authSession,
    accountCheck,
    subscription,
  ].filter((item) => item !== null);
  const hasSuccessfulResponse = statusResponses.some((item) => item.json !== undefined);
  if (
    !hasSuccessfulResponse &&
    statusResponses.some((item) => item.unauthorized === true)
  ) {
    return emptyChatGptAccountStatus("invalid", checkedAt, "ChatGPT 会话已失效");
  }
  if (
    !hasSuccessfulResponse &&
    statusResponses.some((item) => item.forbidden === true)
  ) {
    return emptyChatGptAccountStatus("reauth_required", checkedAt, "需要重新验证");
  }

  const candidates = [
    subscription?.json,
    authSession?.json,
    accountCheck?.json,
  ].filter((item) => item !== undefined);
  const subscriptionCandidates = subscriptionStatusCandidates(candidates);
  const accountEmail = firstStringByKeys(candidates, ["email", "account_email", "accountEmail"]);
  const accountName = firstStringByKeys(candidates, ["name", "display_name", "displayName"]);
  const accountId =
    resolvedAccountId ??
    firstStringByKeys(candidates, [
      "account_id",
      "accountId",
      "chatgpt_account_id",
      "chatgptAccountId",
    ]);
  const planType = normalizePlanType(
    firstStringByKeys(candidates, [
      "plan_type",
      "planType",
      "chatgpt_plan_type",
      "subscription_plan_type",
      "subscriptionPlanType",
      "type",
    ]),
  );
  const rawPlanLabel =
    firstStringByKeys(candidates, [
      "plan_label",
      "planLabel",
      "plan_name",
      "planName",
      "product_name",
      "productName",
      "subscription_plan",
      "subscriptionPlan",
      "plan",
    ]) ?? planType;
  const planLabel = normalizePlanLabel(rawPlanLabel, planType);
  const cancellationExpiresAt = firstTimeByKeys(subscriptionCandidates, [
    "subscription_cancel_at",
    "subscriptionCancelAt",
    "cancel_at",
    "cancelAt",
    "cancels_at",
    "cancelsAt",
    "cancellation_effective_date",
    "cancellationEffectiveDate",
  ]);
  const currentPeriodEnd = firstTimeByKeys(subscriptionCandidates, [
    "subscription_current_period_end",
    "subscriptionCurrentPeriodEnd",
    "current_period_end",
    "currentPeriodEnd",
    "current_period_end_at",
    "currentPeriodEndAt",
    "active_until",
    "activeUntil",
    "expires_at",
    "expiresAt",
  ]);
  const cancelsAtPeriodEnd = firstBooleanByKeys(subscriptionCandidates, [
    "subscription_cancel_at_period_end",
    "subscriptionCancelAtPeriodEnd",
    "cancel_at_period_end",
    "cancelAtPeriodEnd",
  ]);
  const willRenew = firstBooleanByKeys(subscriptionCandidates, ["will_renew", "willRenew"]);
  const subscriptionExpiresAt =
    cancellationExpiresAt ?? (cancelsAtPeriodEnd || willRenew === false ? currentPeriodEnd : null);
  const subscriptionRenewsAt = subscriptionExpiresAt
    ? null
    : firstTimeByKeys(subscriptionCandidates, [
        "subscription_renews_at",
        "subscriptionRenewsAt",
        "renews_at",
        "renewsAt",
        "renewal_date",
        "renewalDate",
        "next_billing_date",
        "nextBillingDate",
        "next_invoice_at",
        "nextInvoiceAt",
      ]) ?? currentPeriodEnd;

  const normalizedPlanType = planType ?? normalizePlanType(planLabel);
  const normalizedPlanLabel = planLabel ?? friendlyPlanLabel(normalizedPlanType);

  return {
    status: "available",
    accountEmail,
    accountName,
    accountId,
    planType: normalizedPlanType,
    planLabel: normalizedPlanLabel,
    subscriptionExpiresAt,
    subscriptionRenewsAt,
    checkedAt,
    error: normalizedPlanLabel || accountEmail ? null : "会员信息不可用",
  };
}

export function emptyChatGptAccountStatus(
  status: ChatGptSessionStatus,
  checkedAt: number,
  error: string | null,
): ChatGptAccountStatus {
  return {
    status,
    accountEmail: null,
    accountName: null,
    accountId: null,
    planType: null,
    planLabel: null,
    subscriptionExpiresAt: null,
    subscriptionRenewsAt: null,
    checkedAt,
    error,
  };
}

function firstTimeByKeys(candidates: unknown[], keys: string[]): number | null {
  for (const candidate of candidates) {
    const value = deepFindByKeys(candidate, keys);
    const parsed = parseTimeValue(value);
    if (parsed !== null) {
      return parsed;
    }
  }
  return null;
}

function firstBooleanByKeys(candidates: unknown[], keys: string[]): boolean | null {
  for (const candidate of candidates) {
    const value = deepFindByKeys(candidate, keys);
    if (typeof value === "boolean") {
      return value;
    }
  }
  return null;
}

function subscriptionStatusCandidates(candidates: unknown[]): unknown[] {
  const matches: unknown[] = [];
  for (const candidate of candidates) {
    collectSubscriptionStatusCandidates(candidate, "", matches, 0);
  }
  return matches;
}

function collectSubscriptionStatusCandidates(
  value: unknown,
  contextKey: string,
  matches: unknown[],
  depth: number,
): void {
  if (!isRecord(value) || depth > 5) {
    return;
  }
  if (isSubscriptionContextKey(contextKey) || hasSubscriptionStatusShape(value)) {
    matches.push(value);
  }
  for (const [key, child] of Object.entries(value)) {
    if (Array.isArray(child)) {
      for (const item of child.slice(0, 10)) {
        collectSubscriptionStatusCandidates(item, key, matches, depth + 1);
      }
      continue;
    }
    collectSubscriptionStatusCandidates(child, key, matches, depth + 1);
  }
}

function isSubscriptionContextKey(key: string): boolean {
  return /subscription|entitlement|billing/i.test(key);
}

function hasSubscriptionStatusShape(value: Record<string, unknown>): boolean {
  const keys = new Set(Object.keys(value));
  return [
    "subscription_id",
    "subscriptionId",
    "subscription_plan",
    "subscriptionPlan",
    "has_active_subscription",
    "hasActiveSubscription",
    "cancel_at_period_end",
    "cancelAtPeriodEnd",
    "current_period_end",
    "currentPeriodEnd",
    "will_renew",
    "willRenew",
  ].some((key) => keys.has(key));
}

function parseTimeValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value > 10_000_000_000 ? Math.floor(value / 1000) : Math.floor(value);
  }
  const text = readString(value);
  if (text) {
    return parseTimestampText(text);
  }
  if (isRecord(value)) {
    return (
      parseTimeValue(value.timestamp) ??
      parseTimeValue(value.seconds) ??
      parseTimeValue(value.value) ??
      parseTimeValue(value.date) ??
      parseTimeValue(value.iso)
    );
  }
  return null;
}

function deepFindByKeys(value: unknown, keys: string[], depth = 0): unknown {
  if (!isRecord(value) || depth > 4) {
    return null;
  }
  for (const key of keys) {
    if (key in value) {
      return value[key];
    }
  }
  for (const item of Object.values(value)) {
    if (Array.isArray(item)) {
      for (const child of item.slice(0, 5)) {
        const found = deepFindByKeys(child, keys, depth + 1);
        if (found !== null && found !== undefined) {
          return found;
        }
      }
      continue;
    }
    const found = deepFindByKeys(item, keys, depth + 1);
    if (found !== null && found !== undefined) {
      return found;
    }
  }
  return null;
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizePlanType(value: string | null): string | null {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) {
    return null;
  }
  if (normalized.includes("enterprise")) return "enterprise";
  if (normalized.includes("team") || normalized.includes("business")) return "team";
  if (normalized.includes("pro")) return "pro";
  if (normalized.includes("plus")) return "plus";
  if (normalized.includes("free")) return "free";
  return normalized.replace(/[^a-z0-9_-]+/g, "_").replace(/^_+|_+$/g, "") || null;
}

function normalizePlanLabel(value: string | null, planType: string | null): string | null {
  const label = value?.trim() ?? "";
  if (!label || /^chatgpt[a-z0-9_-]*plan$/i.test(label)) {
    return friendlyPlanLabel(planType);
  }
  return label;
}

function friendlyPlanLabel(planType: string | null): string | null {
  if (planType === "plus") return "Plus";
  if (planType === "pro") return "Pro";
  if (planType === "team") return "Team";
  if (planType === "enterprise") return "Enterprise";
  if (planType === "free") return "Free";
  return planType;
}

function parseTimestampText(text: string): number | null {
  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? Math.floor(parsed / 1000) : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
