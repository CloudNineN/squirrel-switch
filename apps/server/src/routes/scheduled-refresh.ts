import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  getScheduledRefreshState,
  runScheduledRefreshNow,
  updateScheduledRefreshConfig,
} from "../lib/scheduled-refresh.js";

const updateScheduledRefreshConfigSchema = z.object({
  enabled: z.boolean(),
  intervalMinutes: z.number().int().min(5),
  startTime: z.string(),
  endTime: z.string(),
  activateFiveHourWindow: z.boolean().default(false),
});

export async function scheduledRefreshRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/scheduled-refresh", async () => ({ data: getScheduledRefreshState() }));

  app.put("/api/scheduled-refresh", async (request) => ({
    data: updateScheduledRefreshConfig(
      updateScheduledRefreshConfigSchema.parse(request.body),
    ),
  }));

  app.post("/api/scheduled-refresh/run-now", async () => ({
    data: await runScheduledRefreshNow(),
  }));
}
