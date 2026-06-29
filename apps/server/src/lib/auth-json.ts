import { randomUUID } from "node:crypto";

export interface ParsedAuthJson {
  id: string;
  name: string;
  email: string | null;
  accountId: string | null;
  workspaceId: string | null;
  planType: string | null;
  accessToken: string | null;
  subscriptionExpiresAt: number | null;
}

export function parseAuthJson(raw: string | Record<string, unknown>, name?: string): {
  normalized: string;
  parsed: ParsedAuthJson;
} {
  const value = typeof raw === "string" ? JSON.parse(raw) : raw;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("auth.json 必须是 JSON 对象");
  }

  const normalized = `${JSON.stringify(value, null, 2)}\n`;
  const accessToken = findString(value, [
    "access_token",
    "accessToken",
    "OPENAI_ACCESS_TOKEN",
    "openai_access_token",
  ]);
  const idToken = findString(value, ["id_token", "idToken", "OPENAI_ID_TOKEN", "openai_id_token"]);
  const idTokenOpenAiAuth = readJwtObjectClaim(idToken, ["https://api.openai.com/auth"]);
  const accessTokenOpenAiAuth = readJwtObjectClaim(accessToken, ["https://api.openai.com/auth"]);
  const accountId =
    findString(value, ["account_id", "accountId", "chatgpt_account_id", "chatgptAccountId"]) ??
    stringAt(idTokenOpenAiAuth, "chatgpt_account_id") ??
    stringAt(accessTokenOpenAiAuth, "chatgpt_account_id") ??
    readJwtClaim(accessToken, ["chatgpt_account_id", "account_id"]) ??
    null;
  const workspaceId =
    findString(value, ["workspace_id", "workspaceId"]) ??
    stringAt(idTokenOpenAiAuth, "workspace_id") ??
    stringAt(accessTokenOpenAiAuth, "workspace_id") ??
    readJwtClaim(accessToken, ["workspace_id", "organization_id"]) ??
    null;
  const email =
    findString(value, ["email", "user_email", "userEmail"]) ??
    readJwtClaim(idToken, ["email", "https://api.openai.com/auth/email"]) ??
    readJwtClaim(accessToken, ["email", "https://api.openai.com/auth/email"]) ??
    null;
  const planType =
    findString(value, ["plan_type", "planType"]) ??
    stringAt(idTokenOpenAiAuth, "chatgpt_plan_type") ??
    stringAt(accessTokenOpenAiAuth, "chatgpt_plan_type") ??
    readJwtClaim(accessToken, ["plan_type"]) ??
    null;
  const subscriptionExpiresAt = timestampAt(idTokenOpenAiAuth, [
    "chatgpt_subscription_active_until",
  ]);
  const inferredName =
    name?.trim() ||
    email ||
    (accountId ? `Codex ${accountId.slice(0, 8)}` : `Codex ${randomUUID().slice(0, 8)}`);

  return {
    normalized,
    parsed: {
      id: randomUUID(),
      name: inferredName,
      email,
      accountId,
      workspaceId,
      planType,
      accessToken,
      subscriptionExpiresAt,
    },
  };
}

function findString(value: unknown, keys: string[]): string | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (keys.includes(key) && typeof child === "string" && child.length > 0) {
      return child;
    }
    const nested = findString(child, keys);
    if (nested) {
      return nested;
    }
  }

  return null;
}

function readJwtClaim(token: string | null, names: string[]): string | null {
  const claims = readJwtClaims(token);
  if (!claims) {
    return null;
  }

  for (const name of names) {
    const value = claims[name];
    if (typeof value === "string" && value.length > 0) {
      return value;
    }
  }

  return null;
}

function readJwtObjectClaim(token: string | null, names: string[]): Record<string, unknown> | null {
  const claims = readJwtClaims(token);
  if (!claims) {
    return null;
  }

  for (const name of names) {
    const value = claims[name];
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
  }

  return null;
}

function readJwtClaims(token: string | null): Record<string, unknown> | null {
  if (!token || !token.includes(".")) {
    return null;
  }

  try {
    const payload = token.split(".")[1];
    if (!payload) {
      return null;
    }
    return JSON.parse(Buffer.from(toBase64(payload), "base64").toString("utf8")) as Record<
      string,
      unknown
    >;
  } catch {
    return null;
  }
}

function toBase64(base64Url: string): string {
  const padded = base64Url.replace(/-/g, "+").replace(/_/g, "/");
  return padded.padEnd(Math.ceil(padded.length / 4) * 4, "=");
}

function stringAt(value: Record<string, unknown> | null, key: string): string | null {
  const child = value?.[key];
  return typeof child === "string" && child.length > 0 ? child : null;
}

function timestampAt(value: Record<string, unknown> | null, keys: string[]): number | null {
  for (const key of keys) {
    const child = value?.[key];
    if (typeof child === "string" && child.length > 0) {
      const parsed = Date.parse(child);
      if (!Number.isNaN(parsed)) {
        return Math.floor(parsed / 1000);
      }
    }
  }
  return null;
}
