import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  type PromptPlatformId,
  readPromptManagementState,
  updatePlatformPrompt,
  updateSystemPrompt,
} from "../lib/prompt-management.js";

const platformIdSchema = z.enum(["codex", "claude-code"]);
const updatePromptSchema = z.object({
  content: z.string(),
});

export async function promptManagementRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/prompt-management", async () => ({
    data: await readPromptManagementState(),
  }));

  app.put("/api/prompt-management/system", async (request) => {
    const body = updatePromptSchema.parse(request.body);
    return { data: await updateSystemPrompt(body.content) };
  });

  app.put("/api/prompt-management/platforms/:platformId", async (request) => {
    const params = z.object({ platformId: platformIdSchema }).parse(request.params);
    const body = updatePromptSchema.parse(request.body);
    const platform = await updatePlatformPrompt(params.platformId as PromptPlatformId, body.content);
    return { data: platform };
  });
}
