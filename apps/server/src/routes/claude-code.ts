import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { CLAUDE_CODE_PROVIDERS } from "../lib/claude-code-providers.js";
import {
  applyClaudeCodeProfile,
  createClaudeCodeProfile,
  deleteClaudeCodeProfile,
  exportClaudeCodeBackup,
  importClaudeCodeBackup,
  listClaudeCodeApplications,
  listClaudeCodeProfiles,
  readClaudeCodeApiKey,
  revertClaudeCodeApplication,
  updateClaudeCodeProfile,
} from "../lib/claude-code.js";

const providerIdSchema = z.enum([
  "anthropic",
  "glm-global",
  "glm-china",
  "deepseek",
  "kimi",
  "openrouter",
]);

const authHeaderSchema = z.enum(["x-api-key", "authorization-bearer"]);

const profileSchema = z.object({
  name: z.string().min(1),
  providerId: providerIdSchema,
  baseUrl: z.string().optional(),
  mainModel: z.string().optional(),
  opusModel: z.string().optional(),
  sonnetModel: z.string().optional(),
  haikuModel: z.string().optional(),
  subagentModel: z.string().optional(),
  authHeader: authHeaderSchema,
  apiKey: z.string().optional(),
  clearApiKey: z.boolean().optional(),
  customHeadersJson: z.string().optional(),
  disableNonessentialTraffic: z.boolean(),
  apiKeyHelperTtlMs: z.number().int().nullable().optional(),
});

const applySchema = z.object({
  target: z.discriminatedUnion("type", [
    z.object({ type: z.literal("user-settings") }),
    z.object({ type: z.literal("project-local-settings"), projectPath: z.string().min(1) }),
    z.object({
      type: z.literal("project-shared-settings"),
      projectPath: z.string().min(1),
      confirmShared: z.literal(true),
    }),
    z.object({ type: z.literal("launch-env"), workingDirectory: z.string().optional() }),
  ]),
});

const revertSchema = z.object({
  force: z.boolean().optional(),
});

const backupSchema = z.object({
  app: z.literal("squirrel-switch"),
  platform: z.literal("claude-code"),
  v: z.literal(1),
  exportedAt: z.string().optional(),
  includesApiKeys: z.boolean(),
  profiles: z.array(
    z.object({
      name: z.string().min(1),
      providerId: providerIdSchema,
      baseUrl: z.string(),
      mainModel: z.string(),
      opusModel: z.string(),
      sonnetModel: z.string(),
      haikuModel: z.string(),
      subagentModel: z.string(),
      authHeader: authHeaderSchema,
      apiKey: z.string().optional(),
      customHeadersJson: z.string(),
      disableNonessentialTraffic: z.boolean(),
      apiKeyHelperTtlMs: z.number().int().nullable(),
    }),
  ),
});

export async function claudeCodeRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/platforms", async () => ({
    data: [
      {
        id: "codex",
        displayName: "Codex",
        capabilities: ["credentialProfile", "usageRefresh", "backupExport"],
      },
      {
        id: "chatgpt",
        displayName: "ChatGPT",
        capabilities: ["webSession", "backupExport"],
      },
      {
        id: "claude-code",
        displayName: "Claude Code",
        capabilities: ["credentialProfile", "configSwitch", "backupExport", "launcher"],
      },
    ],
  }));

  app.get("/api/platforms/claude-code/providers", async () => ({ data: CLAUDE_CODE_PROVIDERS }));

  app.get("/api/platforms/claude-code/profiles", async () => ({
    data: listClaudeCodeProfiles(),
  }));

  app.post("/api/platforms/claude-code/profiles", async (request) => ({
    data: await createClaudeCodeProfile(profileSchema.parse(request.body)),
  }));

  app.patch("/api/platforms/claude-code/profiles/:id", async (request) => {
    const params = z.object({ id: z.string() }).parse(request.params);
    return {
      data: await updateClaudeCodeProfile(params.id, profileSchema.parse(request.body)),
    };
  });

  app.delete("/api/platforms/claude-code/profiles/:id", async (request) => {
    const params = z.object({ id: z.string() }).parse(request.params);
    deleteClaudeCodeProfile(params.id);
    return { data: { ok: true } };
  });

  app.post("/api/platforms/claude-code/profiles/:id/apply", async (request) => {
    const params = z.object({ id: z.string() }).parse(request.params);
    return { data: await applyClaudeCodeProfile(params.id, applySchema.parse(request.body)) };
  });

  app.post("/api/platforms/claude-code/profiles/:id/launch", async (request) => {
    const params = z.object({ id: z.string() }).parse(request.params);
    const body = z.object({ workingDirectory: z.string().optional() }).parse(request.body);
    return {
      data: await applyClaudeCodeProfile(params.id, {
        target: { type: "launch-env", workingDirectory: body.workingDirectory },
      }),
    };
  });

  app.get("/api/platforms/claude-code/profiles/:id/api-key-helper", async (request, reply) => {
    const params = z.object({ id: z.string() }).parse(request.params);
    const apiKey = await readClaudeCodeApiKey(params.id);
    return reply.type("text/plain").send(apiKey);
  });

  app.get("/api/platforms/claude-code/applications", async () => ({
    data: listClaudeCodeApplications(),
  }));

  app.post("/api/platforms/claude-code/applications/:id/revert", async (request) => {
    const params = z.object({ id: z.string() }).parse(request.params);
    return {
      data: await revertClaudeCodeApplication(params.id, revertSchema.parse(request.body ?? {})),
    };
  });

  app.get("/api/platforms/claude-code/export-backup", async (request) => {
    const query = z.object({ includeApiKeys: z.string().optional() }).parse(request.query);
    return { data: await exportClaudeCodeBackup(query.includeApiKeys === "1") };
  });

  app.post("/api/platforms/claude-code/import-backup", async (request) => {
    const backup = backupSchema.parse(request.body);
    return {
      data: await importClaudeCodeBackup({
        ...backup,
        exportedAt: backup.exportedAt ?? new Date().toISOString(),
      }),
    };
  });
}
