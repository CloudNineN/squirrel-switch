import type { AccountView } from "@squirrel-switch/shared";
import type { AppLocale } from "./i18n.js";
import { translate } from "./i18n.js";

const DAY_SECONDS = 24 * 60 * 60;
const MAX_USAGE_AGE_SECONDS = 2 * 60 * 60;
const MIN_USABLE_DAYS = 0.25;

type RecommendationCandidate = {
  account: AccountView;
  secondaryUsableSeconds: number;
  secondaryUsableUntil: number;
  primaryRemaining: number;
  secondaryRemaining: number;
  resetAvailableCount: number;
  resetCountsTowardRecommendation: boolean;
  recommendationScore: number;
};

export function getRecommendedAccountId(
  accounts: AccountView[],
  now = Math.floor(Date.now() / 1000),
) {
  const recommended = accounts
    .map((account) => getRecommendationCandidate(account, now))
    .filter((candidate): candidate is RecommendationCandidate => candidate !== null)
    .sort(compareRecommendationCandidates)[0];

  return recommended?.account.id ?? null;
}

export function formatRecommendationReason(account: AccountView, locale: AppLocale) {
  const primaryRemaining = account.usage?.primary?.remainingPercent;
  const secondaryRemaining = account.usage?.secondary?.remainingPercent;
  if (typeof primaryRemaining !== "number" || typeof secondaryRemaining !== "number") {
    return translate("推荐使用：额度数据完整度不足", locale);
  }
  const resetAvailableCount = account.usage?.resetAvailableCount ?? 0;
  if (resetAvailableCount > 0) {
    if (
      typeof account.subscriptionExpiresAt === "number" &&
      account.subscriptionExpiresAt > Math.floor(Date.now() / 1000)
    ) {
      return translate(
        "推荐使用：周/月限额 {secondary}%，可用重置 {resetCount} 次按会员到期计入，5 小时限额 {primary}%",
        locale,
        {
          secondary: Math.round(secondaryRemaining),
          resetCount: resetAvailableCount,
          primary: Math.round(primaryRemaining),
        },
      );
    }
    return translate(
      "推荐使用：周/月限额 {secondary}%，可用重置 {resetCount} 次仅展示未计入推荐，5 小时限额 {primary}%",
      locale,
      {
        secondary: Math.round(secondaryRemaining),
        resetCount: resetAvailableCount,
        primary: Math.round(primaryRemaining),
      },
    );
  }
  if (
    typeof account.subscriptionExpiresAt === "number" &&
    account.subscriptionExpiresAt > Math.floor(Date.now() / 1000)
  ) {
    return translate(
      "推荐使用：周/月限额 {secondary}%，5 小时限额 {primary}%，已纳入会员到期时间",
      locale,
      {
        secondary: Math.round(secondaryRemaining),
        primary: Math.round(primaryRemaining),
      },
    );
  }
  return translate("推荐使用：周/月限额 {secondary}%，5 小时限额 {primary}%", locale, {
    secondary: Math.round(secondaryRemaining),
    primary: Math.round(primaryRemaining),
  });
}

function getRecommendationCandidate(
  account: AccountView,
  now: number,
): RecommendationCandidate | null {
  const usage = account.usage;
  if (
    !usage ||
    usage.error ||
    usage.stale ||
    typeof usage.fetchedAt !== "number" ||
    now - usage.fetchedAt > MAX_USAGE_AGE_SECONDS
  ) {
    return null;
  }

  const primaryRemaining = usage.primary?.remainingPercent;
  const secondaryRemaining = usage.secondary?.remainingPercent;
  const secondaryResetsAt = usage.secondary?.resetsAt;
  const resetAvailableCount = usage.resetAvailableCount ?? 0;
  if (
    typeof primaryRemaining !== "number" ||
    typeof secondaryRemaining !== "number" ||
    typeof secondaryResetsAt !== "number"
  ) {
    return null;
  }
  if (primaryRemaining <= 0 || secondaryRemaining <= 0 || secondaryResetsAt <= now) return null;

  const subscriptionExpiresAt = account.subscriptionExpiresAt;
  const secondaryUsableUntil =
    typeof subscriptionExpiresAt === "number" && subscriptionExpiresAt > now
      ? Math.min(secondaryResetsAt, subscriptionExpiresAt)
      : secondaryResetsAt;
  const secondaryUsableSeconds = Math.max(
    secondaryUsableUntil - now,
    MIN_USABLE_DAYS * DAY_SECONDS,
  );
  const secondaryPressure = secondaryRemaining / secondaryUsableSeconds;
  const resetCountsTowardRecommendation =
    resetAvailableCount > 0 &&
    typeof subscriptionExpiresAt === "number" &&
    subscriptionExpiresAt > now;
  const resetPressure = resetCountsTowardRecommendation
    ? (resetAvailableCount * 100) /
      Math.max(subscriptionExpiresAt - now, MIN_USABLE_DAYS * DAY_SECONDS)
    : 0;
  return {
    account,
    secondaryUsableSeconds,
    secondaryUsableUntil,
    primaryRemaining,
    secondaryRemaining,
    resetAvailableCount,
    resetCountsTowardRecommendation,
    recommendationScore: secondaryPressure + resetPressure,
  };
}

function compareRecommendationCandidates(a: RecommendationCandidate, b: RecommendationCandidate) {
  const urgencyDelta = b.recommendationScore - a.recommendationScore;
  if (urgencyDelta !== 0) return urgencyDelta;

  const usableUntilDelta = a.secondaryUsableUntil - b.secondaryUsableUntil;
  if (usableUntilDelta !== 0) return usableUntilDelta;

  const primaryDelta = b.primaryRemaining - a.primaryRemaining;
  if (primaryDelta !== 0) return primaryDelta;

  const secondaryDelta = b.secondaryRemaining - a.secondaryRemaining;
  if (secondaryDelta !== 0) return secondaryDelta;

  const resetCountsDelta =
    Number(b.resetCountsTowardRecommendation) - Number(a.resetCountsTowardRecommendation);
  if (resetCountsDelta !== 0) return resetCountsDelta;

  const resetCountDelta = b.resetAvailableCount - a.resetAvailableCount;
  if (resetCountDelta !== 0) return resetCountDelta;

  return a.account.id.localeCompare(b.account.id);
}
