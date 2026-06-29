import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  createChatGptAppConfig,
  deleteChatGptAppConfig,
  readChatGptAppConfigManagementState,
  updateChatGptAppConfig,
  updateChatGptAppSyncStatus,
} from "../lib/chatgpt-app-configs.js";

const appConfigSchema = z.object({
  type: z.enum(["official_app", "custom_mcp"]),
  name: z.string().min(1),
  description: z.string().nullable().optional(),
  officialAppUrl: z.string().nullable().optional(),
  officialAppId: z.string().nullable().optional(),
  mcpServerUrl: z.string().nullable().optional(),
  authType: z.enum(["none", "bearer", "oauth", "official", "unknown"]),
  authNote: z.string().nullable().optional(),
  scopeType: z.enum(["all_profiles", "specific_profiles"]),
  targetProfileIds: z.array(z.string()).optional(),
  enabled: z.boolean(),
});

const syncStatusSchema = z.object({
  status: z.enum(["pending", "synced", "failed", "skipped"]),
  error: z.string().nullable().optional(),
});

const configParamsSchema = z.object({ id: z.string() });
const syncParamsSchema = z.object({ id: z.string(), profileId: z.string() });

export async function chatGptAppConfigRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/platforms/chatgpt/app-configs", async () => ({
    data: readChatGptAppConfigManagementState(),
  }));

  app.post("/api/platforms/chatgpt/app-configs", async (request) => ({
    data: createChatGptAppConfig(appConfigSchema.parse(request.body)),
  }));

  app.patch("/api/platforms/chatgpt/app-configs/:id", async (request) => {
    const params = configParamsSchema.parse(request.params);
    return {
      data: updateChatGptAppConfig(params.id, appConfigSchema.parse(request.body)),
    };
  });

  app.delete("/api/platforms/chatgpt/app-configs/:id", async (request) => {
    const params = configParamsSchema.parse(request.params);
    deleteChatGptAppConfig(params.id);
    return { data: { ok: true } };
  });

  app.post("/api/platforms/chatgpt/app-configs/:id/profiles/:profileId/status", async (request) => {
    const params = syncParamsSchema.parse(request.params);
    return {
      data: updateChatGptAppSyncStatus(
        params.id,
        params.profileId,
        syncStatusSchema.parse(request.body),
      ),
    };
  });
}
