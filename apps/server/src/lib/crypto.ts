import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { getMasterKey } from "./keychain.js";

const algorithm = "aes-256-gcm";

export async function encryptText(plainText: string): Promise<Buffer> {
  const { key } = await getMasterKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv(algorithm, key, iv);
  const encrypted = Buffer.concat([cipher.update(plainText, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.from(
    JSON.stringify({
      v: 1,
      iv: iv.toString("base64"),
      tag: authTag.toString("base64"),
      data: encrypted.toString("base64"),
    }),
    "utf8",
  );
}

export async function decryptText(payload: Buffer): Promise<string> {
  const { key } = await getMasterKey();
  const parsed = JSON.parse(payload.toString("utf8")) as {
    v: number;
    iv: string;
    tag: string;
    data: string;
  };
  if (parsed.v !== 1) {
    throw new Error("不支持的密文版本");
  }
  const decipher = createDecipheriv(algorithm, key, Buffer.from(parsed.iv, "base64"));
  decipher.setAuthTag(Buffer.from(parsed.tag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(parsed.data, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

export function sha256Text(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function stableJson(value: unknown): string {
  return `${JSON.stringify(value, sortKeys, 2)}\n`;
}

function sortKeys(_key: string, value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return value;
  }

  return Object.keys(value as Record<string, unknown>)
    .sort()
    .reduce<Record<string, unknown>>((sorted, key) => {
      sorted[key] = (value as Record<string, unknown>)[key];
      return sorted;
    }, {});
}
