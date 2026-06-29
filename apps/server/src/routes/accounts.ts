import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  activateAccount,
  deleteAccount,
  exportAccountBackup,
  importAccountBackup,
  importAuthJson,
  importCurrentAccount,
  listAccounts,
  refreshAccount,
  refreshAllAccounts,
  updateAccount,
} from "../lib/accounts.js";

const importAuthJsonSchema = z.object({
  name: z.string().optional(),
  authJson: z.union([z.string(), z.record(z.string(), z.unknown())]),
});

const accountBackupSchema = z.object({
  app: z.literal("squirrel-switch"),
  v: z.literal(1),
  exportedAt: z.string().optional(),
  accounts: z
    .array(
      z.object({
        name: z.string().optional(),
        authJson: z.union([z.string(), z.record(z.string(), z.unknown())]),
      }),
    )
    .min(1),
});

const exportBackupSchema = z.object({
  accountIds: z.array(z.string().min(1)).min(1),
});

const updateAccountSchema = z.object({
  name: z.string().min(1),
});

export async function accountRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/accounts", async () => ({ data: listAccounts() }));

  app.post("/api/accounts/import-current", async () => ({
    data: await importCurrentAccount(),
  }));

  app.post("/api/accounts/import-auth-json", async (request) => ({
    data: await importAuthJson(importAuthJsonSchema.parse(request.body)),
  }));

  app.post("/api/accounts/export-backup", async (request) => ({
    data: await exportAccountBackup(exportBackupSchema.parse(request.body)),
  }));

  app.post("/api/accounts/import-backup", async (request) => ({
    data: await importAccountBackup(accountBackupSchema.parse(request.body)),
  }));

  app.patch("/api/accounts/:id", async (request) => {
    const params = z.object({ id: z.string() }).parse(request.params);
    const body = updateAccountSchema.parse(request.body);
    return { data: updateAccount(params.id, body.name) };
  });

  app.delete("/api/accounts/:id", async (request) => {
    const params = z.object({ id: z.string() }).parse(request.params);
    deleteAccount(params.id);
    return { data: { ok: true } };
  });

  app.post("/api/accounts/:id/activate", async (request) => {
    const params = z.object({ id: z.string() }).parse(request.params);
    return { data: await activateAccount(params.id) };
  });

  app.post("/api/accounts/:id/refresh", async (request) => {
    const params = z.object({ id: z.string() }).parse(request.params);
    return { data: await refreshAccount(params.id) };
  });

  app.post("/api/accounts/refresh-all", async () => ({
    data: await refreshAllAccounts(),
  }));

  app.get("/api/accounts/:id/usage", async (request) => {
    const params = z.object({ id: z.string() }).parse(request.params);
    const account = listAccounts().find((candidate) => candidate.id === params.id);
    return { data: account?.usage ?? null };
  });
}
