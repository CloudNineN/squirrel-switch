import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Fastify from "fastify";
import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import { ZodError } from "zod";
import { ensureAppDataDir } from "./lib/paths.js";
import { migrate } from "./lib/db.js";
import { accountRoutes } from "./routes/accounts.js";
import { chatGptAppConfigRoutes } from "./routes/chatgpt-app-configs.js";
import { chatGptProfileRoutes } from "./routes/chatgpt-profiles.js";
import { claudeCodeRoutes } from "./routes/claude-code.js";
import { loginSessionRoutes } from "./routes/login-sessions.js";
import { promptManagementRoutes } from "./routes/prompt-management.js";
import { runtimeRoutes } from "./routes/runtime.js";
import { scheduledRefreshRoutes } from "./routes/scheduled-refresh.js";
import { AppError, getErrorMessage } from "./lib/errors.js";
import { writeRuntimeLog } from "./lib/runtime-log.js";
import {
  startScheduledRefreshScheduler,
  stopScheduledRefreshScheduler,
} from "./lib/scheduled-refresh.js";

await ensureAppDataDir();
migrate();
await writeRuntimeLog("info", "server", "Squirrel Switch 服务启动");

const app = Fastify({
  logger: {
    level: process.env.LOG_LEVEL || "info",
    redact: ["req.headers.authorization", "*.access_token", "*.refresh_token", "*.id_token"],
  },
});

await app.register(cors, {
  origin: ["http://127.0.0.1:5173", "http://localhost:5173"],
});

app.setErrorHandler((error, _request, reply) => {
  const maybeError = error as { statusCode?: unknown };
  const statusCode = typeof maybeError.statusCode === "number" ? maybeError.statusCode : 500;
  if (error instanceof AppError) {
    reply.status(error.statusCode).send({ error: { message: error.message } });
    return;
  }
  if (error instanceof ZodError) {
    reply.status(400).send({ error: { message: "请求参数不合法", details: error.issues } });
    return;
  }
  if (statusCode >= 500) {
    app.log.error({ err: error }, "request failed");
  }
  void writeRuntimeLog("error", "request", getErrorMessage(error));
  reply.status(statusCode).send({ error: { message: getErrorMessage(error) } });
});

app.addHook("onResponse", async (request, reply) => {
  const method = request.method;
  const url = request.url.split("?")[0] ?? request.url;
  if (url === "/api/runtime/logs") {
    return;
  }
  await writeRuntimeLog(
    reply.statusCode >= 400 ? "warn" : "info",
    "request",
    `${method} ${url} ${reply.statusCode}`,
  );
});

await app.register(accountRoutes);
await app.register(chatGptAppConfigRoutes);
await app.register(chatGptProfileRoutes);
await app.register(claudeCodeRoutes);
await app.register(loginSessionRoutes);
await app.register(promptManagementRoutes);
await app.register(runtimeRoutes);
await app.register(scheduledRefreshRoutes);

app.addHook("onClose", async () => {
  stopScheduledRefreshScheduler();
});

const webDist = join(dirname(fileURLToPath(import.meta.url)), "../../web/dist");
if (existsSync(webDist)) {
  await app.register(fastifyStatic, {
    root: webDist,
    prefix: "/",
    decorateReply: false,
  });
}

const port = Number(process.env.PORT || 3210);
await app.listen({ host: "127.0.0.1", port });
startScheduledRefreshScheduler();
