import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  createChatGptProfile,
  deleteChatGptProfile,
  importChatGptProfiles,
  listChatGptProfiles,
  markChatGptProfileExported,
  touchChatGptProfileOpened,
  updateChatGptProfile,
  updateChatGptProfileStatus,
} from "../lib/chatgpt-profiles.js";

const profileSchema = z.object({
  id: z.string().optional(),
  displayName: z.string().optional(),
  linkedCodexAccountId: z.string().nullable().optional(),
  browserKind: z.enum(["chrome", "edge", "custom"]).nullable().optional(),
  browserExecutablePath: z.string().nullable().optional(),
  browserProfileDir: z.string().nullable().optional(),
  sessionHash: z.string().nullable().optional(),
  linkedCodexEmailHint: z.string().nullable().optional(),
  accountEmailHint: z.string().nullable().optional(),
  planLabelHint: z.string().nullable().optional(),
});

const updateProfileSchema = z.object({
  displayName: z.string().optional(),
  linkedCodexAccountId: z.string().nullable().optional(),
  browserKind: z.enum(["chrome", "edge", "custom"]).nullable().optional(),
  browserExecutablePath: z.string().nullable().optional(),
});

const importProfilesSchema = z.object({
  profiles: z
    .array(
      z.object({
        id: z.string().optional(),
        displayName: z.string().min(1),
        browserKind: z.enum(["chrome", "edge", "custom"]).nullable().optional(),
        browserExecutablePath: z.string().nullable().optional(),
        browserProfileDir: z.string().nullable().optional(),
        sessionHash: z.string().nullable(),
        linkedCodexEmailHint: z.string().nullable(),
        accountEmailHint: z.string().nullable().optional().transform((value) => value ?? null),
        planLabelHint: z.string().nullable().optional().transform((value) => value ?? null),
      }),
    )
    .min(1),
});

const markExportedSchema = z.object({
  sessionHash: z.string().nullable().optional(),
});

const accountStatusSchema = z.object({
  status: z.enum(["unchecked", "available", "invalid", "reauth_required"]),
  accountEmail: z.string().nullable(),
  accountName: z.string().nullable(),
  accountId: z.string().nullable(),
  planType: z.string().nullable(),
  planLabel: z.string().nullable(),
  subscriptionExpiresAt: z.number().nullable(),
  subscriptionRenewsAt: z.number().nullable(),
  error: z.string().nullable(),
});

export async function chatGptProfileRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/platforms/chatgpt/profiles", async () => ({
    data: listChatGptProfiles(),
  }));

  app.post("/api/platforms/chatgpt/profiles", async (request) => ({
    data: createChatGptProfile(profileSchema.parse(request.body)),
  }));

  app.post("/api/platforms/chatgpt/profiles/import", async (request) => ({
    data: importChatGptProfiles(importProfilesSchema.parse(request.body).profiles),
  }));

  app.patch("/api/platforms/chatgpt/profiles/:id", async (request) => {
    const params = z.object({ id: z.string() }).parse(request.params);
    return {
      data: updateChatGptProfile(params.id, updateProfileSchema.parse(request.body)),
    };
  });

  app.post("/api/platforms/chatgpt/profiles/:id/check", async (request) => {
    const params = z.object({ id: z.string() }).parse(request.params);
    return {
      data: updateChatGptProfileStatus(params.id, accountStatusSchema.parse(request.body)),
    };
  });

  app.post("/api/platforms/chatgpt/profiles/:id/opened", async (request) => {
    const params = z.object({ id: z.string() }).parse(request.params);
    return { data: touchChatGptProfileOpened(params.id) };
  });

  app.post("/api/platforms/chatgpt/profiles/:id/exported", async (request) => {
    const params = z.object({ id: z.string() }).parse(request.params);
    const body = markExportedSchema.parse(request.body ?? {});
    return { data: markChatGptProfileExported(params.id, body.sessionHash ?? null) };
  });

  app.delete("/api/platforms/chatgpt/profiles/:id", async (request) => {
    const params = z.object({ id: z.string() }).parse(request.params);
    deleteChatGptProfile(params.id);
    return { data: { ok: true } };
  });
}
