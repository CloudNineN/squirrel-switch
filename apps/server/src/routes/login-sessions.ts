import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  getLoginSession,
  retryLoginSessionAfterRouteError,
  startIsolatedLogin,
} from "../lib/login-sessions.js";

export async function loginSessionRoutes(app: FastifyInstance): Promise<void> {
  app.post("/api/login-sessions", async () => ({
    data: await startIsolatedLogin(),
  }));

  app.get("/api/login-sessions/:id", async (request) => {
    const params = z.object({ id: z.string() }).parse(request.params);
    return { data: await getLoginSession(params.id) };
  });

  app.post("/api/login-sessions/:id/retry-route-error", async (request) => {
    const params = z.object({ id: z.string() }).parse(request.params);
    return { data: await retryLoginSessionAfterRouteError(params.id) };
  });
}
