const PENDING_PROFILE_NAME = "ChatGPT";

export function initialChatGptProfileName(
  requestedName: string | null | undefined,
  accountEmail: string | null | undefined,
): string {
  return normalizeText(requestedName) ?? normalizeText(accountEmail) ?? PENDING_PROFILE_NAME;
}

export function resolvedChatGptProfileName(
  currentName: string,
  previousAccountEmail: string | null,
  nextAccountEmail: string | null,
): string {
  if (!nextAccountEmail || !isAutomaticProfileName(currentName, previousAccountEmail)) {
    return currentName;
  }
  return nextAccountEmail;
}

function isAutomaticProfileName(name: string, accountEmail: string | null): boolean {
  const normalized = name.trim();
  return (
    normalized === PENDING_PROFILE_NAME ||
    /^ChatGPT 账号 \d+$/.test(normalized) ||
    Boolean(accountEmail && normalized.toLowerCase() === accountEmail.trim().toLowerCase())
  );
}

function normalizeText(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed || null;
}
