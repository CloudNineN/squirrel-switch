import { existsSync } from "node:fs";
import type { FastifyInstance } from "fastify";
import { authJsonPath, databasePath, defaultCodexHome } from "../lib/paths.js";
import { getEffectiveCodexHome } from "../lib/db.js";
import { resolveCodexBinary } from "../lib/codex-binary.js";
import { isKeychainAvailable } from "../lib/keychain.js";
import { readRuntimeLogPage, runtimeLogPath } from "../lib/runtime-log.js";

export async function runtimeRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/runtime/status", async () => {
    const codexHome = getEffectiveCodexHome(defaultCodexHome());
    const codexBinaryPath = await resolveCodexBinary();
    return {
      data: {
        codexHome,
        authJsonExists: existsSync(authJsonPath(codexHome)),
        codexBinaryAvailable: codexBinaryPath !== null,
        codexBinaryPath,
        appServerAvailable: codexBinaryPath !== null,
        keychainAvailable: await isKeychainAvailable(),
        databasePath,
        runtimeLogPath,
      },
    };
  });

  app.get("/api/runtime/logs", async (request) => {
    const query = request.query as { page?: string | number; pageSize?: string | number };
    const page = numberQuery(query.page);
    const pageSize = numberQuery(query.pageSize);
    return { data: await readRuntimeLogPage(page, pageSize) };
  });
}

function numberQuery(value: string | number | undefined): number | undefined {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : undefined;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}
