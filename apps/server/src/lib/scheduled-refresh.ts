import { randomUUID } from "node:crypto";
import { getSetting, setSetting } from "./db.js";
import { AppError, getErrorMessage } from "./errors.js";
import { activateDueFiveHourWindows, refreshAllAccountsWithSummary } from "./accounts.js";
import { nowSeconds } from "./time.js";
import { writeRuntimeLog } from "./runtime-log.js";

interface ScheduledRefreshConfig {
  enabled: boolean;
  intervalMinutes: number;
  startTime: string;
  endTime: string;
  activateFiveHourWindow: boolean;
}

type ScheduledRefreshStatus = "disabled" | "waiting" | "running" | "outside-window";

interface ScheduledRefreshLastResult {
  startedAt: number;
  finishedAt: number;
  total: number;
  succeeded: number;
  failed: number;
  activated: number;
  activationSkipped: number;
  activationFailed: number;
  message: string;
}

type ScheduledRefreshExecutionStatus = "success" | "partial" | "failed";

interface ScheduledRefreshExecution {
  id: string;
  trigger: string;
  status: ScheduledRefreshExecutionStatus;
  startedAt: number;
  finishedAt: number;
  total: number;
  succeeded: number;
  failed: number;
  activated: number;
  activationSkipped: number;
  activationFailed: number;
  message: string;
}

export interface ScheduledRefreshState {
  config: ScheduledRefreshConfig;
  status: ScheduledRefreshStatus;
  nextRunAt: number | null;
  lastRunAt: number | null;
  lastFinishedAt: number | null;
  lastResult: ScheduledRefreshLastResult | null;
  executions: ScheduledRefreshExecution[];
}

interface UpdateScheduledRefreshConfigPayload {
  enabled: boolean;
  intervalMinutes: number;
  startTime: string;
  endTime: string;
  activateFiveHourWindow: boolean;
}

const MIN_INTERVAL_MINUTES = 5;
const EXECUTION_LIMIT = 20;
const DEFAULT_CONFIG: ScheduledRefreshConfig = {
  enabled: false,
  intervalMinutes: 60,
  startTime: "07:00",
  endTime: "19:00",
  activateFiveHourWindow: false,
};

let timer: ReturnType<typeof setTimeout> | null = null;
let scheduledNextRunAt: number | null = null;
let runningCount = 0;

export function startScheduledRefreshScheduler(): void {
  rebuildScheduledRefreshTimer();
}

export function stopScheduledRefreshScheduler(): void {
  clearScheduledRefreshTimer();
}

export function getScheduledRefreshState(): ScheduledRefreshState {
  const config = readScheduledRefreshConfig();
  const now = new Date();
  return {
    config,
    status: getScheduledRefreshStatus(config, now),
    nextRunAt: config.enabled ? (scheduledNextRunAt ?? calculateNextRunAt(config, now)) : null,
    lastRunAt: readOptionalNumberSetting("scheduledRefreshLastRunAt"),
    lastFinishedAt: readOptionalNumberSetting("scheduledRefreshLastFinishedAt"),
    lastResult: readLastResult(),
    executions: readExecutions(),
  };
}

export function updateScheduledRefreshConfig(
  payload: UpdateScheduledRefreshConfigPayload,
): ScheduledRefreshState {
  const next = validateScheduledRefreshConfig(payload);

  setSetting("scheduledRefreshEnabled", String(next.enabled));
  setSetting("scheduledRefreshIntervalMinutes", String(next.intervalMinutes));
  setSetting("scheduledRefreshStartTime", next.startTime);
  setSetting("scheduledRefreshEndTime", next.endTime);
  setSetting("scheduledRefreshActivateFiveHourWindow", String(next.activateFiveHourWindow));
  void writeRuntimeLog(
    "info",
    "scheduled-refresh",
    `定时刷新配置已更新：${next.enabled ? "启用" : "停用"}，${next.startTime}-${next.endTime}，间隔 ${next.intervalMinutes} 分钟，5 小时激活${next.activateFiveHourWindow ? "开启" : "关闭"}`,
  );

  rebuildScheduledRefreshTimer();
  return getScheduledRefreshState();
}

export async function runScheduledRefreshNow(): Promise<ScheduledRefreshState> {
  await executeScheduledRefresh("立即刷新", false);
  return getScheduledRefreshState();
}

function rebuildScheduledRefreshTimer(): void {
  clearScheduledRefreshTimer();
  const config = readScheduledRefreshConfig();
  if (!config.enabled) {
    return;
  }

  const nextRunAt = calculateNextRunAt(config, new Date());
  scheduledNextRunAt = nextRunAt;
  const delayMs = Math.max(0, nextRunAt * 1000 - Date.now());
  timer = setTimeout(() => {
    scheduledNextRunAt = null;
    void executeScheduledRefresh("到点刷新", true);
  }, delayMs);

  if (isWithinWindow(config, new Date())) {
    void writeRuntimeLog(
      "info",
      "scheduled-refresh",
      `定时刷新等待下一次触发：${formatLocalTime(nextRunAt)}`,
    );
  } else {
    void writeRuntimeLog(
      "info",
      "scheduled-refresh",
      `当前不在刷新时间区间，等待下一次开始：${formatLocalTime(nextRunAt)}`,
    );
  }
}

function clearScheduledRefreshTimer(): void {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  scheduledNextRunAt = null;
}

async function executeScheduledRefresh(reason: string, rebuildAfterFinish: boolean): Promise<void> {
  runningCount += 1;
  const startedAt = nowSeconds();
  setSetting("scheduledRefreshLastRunAt", String(startedAt));
  void writeRuntimeLog("info", "scheduled-refresh", `定时刷新已启动：${reason}`);

  try {
    const summary = await refreshAllAccountsWithSummary("scheduled");
    const activation = readScheduledRefreshConfig().activateFiveHourWindow
      ? await activateDueFiveHourWindows()
      : { total: summary.total, due: 0, activated: 0, skipped: summary.total, failed: 0 };
    const finishedAt = nowSeconds();
    const result: ScheduledRefreshLastResult = {
      startedAt,
      finishedAt,
      total: summary.total,
      succeeded: summary.succeeded,
      failed: summary.failed,
      activated: activation.activated,
      activationSkipped: activation.skipped,
      activationFailed: activation.failed,
      message: buildScheduledRefreshResultMessage(summary, activation),
    };
    writeLastResult(
      result,
      reason,
      summary.failed > 0 || activation.failed > 0 ? "partial" : "success",
    );
    void writeRuntimeLog(
      summary.failed > 0 || activation.failed > 0 ? "warn" : "info",
      "scheduled-refresh",
      result.message,
    );
  } catch (error) {
    const finishedAt = nowSeconds();
    const message = `定时刷新失败：${getErrorMessage(error)}`;
    writeLastResult({
      startedAt,
      finishedAt,
      total: 0,
      succeeded: 0,
      failed: 1,
      activated: 0,
      activationSkipped: 0,
      activationFailed: 0,
      message,
    }, reason, "failed");
    void writeRuntimeLog("error", "scheduled-refresh", message);
  } finally {
    runningCount -= 1;
    if (rebuildAfterFinish) {
      rebuildScheduledRefreshTimer();
    }
  }
}

function writeLastResult(
  result: ScheduledRefreshLastResult,
  trigger: string,
  status: ScheduledRefreshExecutionStatus,
): void {
  setSetting("scheduledRefreshLastFinishedAt", String(result.finishedAt));
  setSetting("scheduledRefreshLastResult", JSON.stringify(result));
  appendExecution({
    id: randomUUID(),
    trigger,
    status,
    ...result,
  });
}

function readScheduledRefreshConfig(): ScheduledRefreshConfig {
  return {
    enabled: getSetting("scheduledRefreshEnabled") === "true",
    intervalMinutes:
      readOptionalNumberSetting("scheduledRefreshIntervalMinutes") ??
      DEFAULT_CONFIG.intervalMinutes,
    startTime: getSetting("scheduledRefreshStartTime") ?? DEFAULT_CONFIG.startTime,
    endTime: getSetting("scheduledRefreshEndTime") ?? DEFAULT_CONFIG.endTime,
    activateFiveHourWindow: getSetting("scheduledRefreshActivateFiveHourWindow") === "true",
  };
}

function validateScheduledRefreshConfig(
  payload: UpdateScheduledRefreshConfigPayload,
): ScheduledRefreshConfig {
  const config: ScheduledRefreshConfig = {
    enabled: payload.enabled,
    intervalMinutes: payload.intervalMinutes,
    startTime: payload.startTime,
    endTime: payload.endTime,
    activateFiveHourWindow: payload.activateFiveHourWindow,
  };
  if (!Number.isInteger(config.intervalMinutes) || config.intervalMinutes < MIN_INTERVAL_MINUTES) {
    throw new AppError("刷新间隔不能小于 5 分钟");
  }
  const startMinutes = parseClockMinutes(config.startTime);
  const endMinutes = parseClockMinutes(config.endTime);
  if (endMinutes <= startMinutes) {
    throw new AppError("不支持跨天时间区间，结束时间必须晚于开始时间");
  }
  return config;
}

function getScheduledRefreshStatus(
  config: ScheduledRefreshConfig,
  now: Date,
): ScheduledRefreshStatus {
  if (!config.enabled) {
    return "disabled";
  }
  if (runningCount > 0) {
    return "running";
  }
  return isWithinWindow(config, now) ? "waiting" : "outside-window";
}

function calculateNextRunAt(config: ScheduledRefreshConfig, now: Date): number {
  const startMinutes = parseClockMinutes(config.startTime);
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  if (isWithinWindow(config, now)) {
    return Math.floor(now.getTime() / 1000) + config.intervalMinutes * 60;
  }

  const next = dateAtLocalMinutes(now, startMinutes);
  if (nowMinutes >= startMinutes) {
    next.setDate(next.getDate() + 1);
  }
  return Math.floor(next.getTime() / 1000);
}

function isWithinWindow(config: ScheduledRefreshConfig, now: Date): boolean {
  const minutes = now.getHours() * 60 + now.getMinutes();
  return minutes >= parseClockMinutes(config.startTime) && minutes < parseClockMinutes(config.endTime);
}

function parseClockMinutes(value: string): number {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value);
  if (!match) {
    throw new AppError("时间格式必须为 HH:mm");
  }
  return Number(match[1]) * 60 + Number(match[2]);
}

function dateAtLocalMinutes(base: Date, minutes: number): Date {
  const date = new Date(base);
  date.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
  return date;
}

function readOptionalNumberSetting(key: string): number | null {
  const value = getSetting(key);
  if (!value) {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function readLastResult(): ScheduledRefreshLastResult | null {
  const value = getSetting("scheduledRefreshLastResult");
  if (!value) {
    return null;
  }
  try {
    const parsed = JSON.parse(value) as Partial<ScheduledRefreshLastResult>;
    if (
      typeof parsed.startedAt === "number" &&
      typeof parsed.finishedAt === "number" &&
      typeof parsed.total === "number" &&
      typeof parsed.succeeded === "number" &&
      typeof parsed.failed === "number" &&
      typeof parsed.message === "string"
    ) {
      return {
        startedAt: parsed.startedAt,
        finishedAt: parsed.finishedAt,
        total: parsed.total,
        succeeded: parsed.succeeded,
        failed: parsed.failed,
        activated: typeof parsed.activated === "number" ? parsed.activated : 0,
        activationSkipped:
          typeof parsed.activationSkipped === "number" ? parsed.activationSkipped : 0,
        activationFailed:
          typeof parsed.activationFailed === "number" ? parsed.activationFailed : 0,
        message: parsed.message,
      };
    }
  } catch {
    return null;
  }
  return null;
}

function appendExecution(execution: ScheduledRefreshExecution): void {
  setSetting(
    "scheduledRefreshExecutions",
    JSON.stringify([execution, ...readExecutions()].slice(0, EXECUTION_LIMIT)),
  );
}

function readExecutions(): ScheduledRefreshExecution[] {
  const value = getSetting("scheduledRefreshExecutions");
  if (!value) {
    return [];
  }
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .map((item) => parseExecution(item))
      .filter((item): item is ScheduledRefreshExecution => item !== null)
      .slice(0, EXECUTION_LIMIT);
  } catch {
    return [];
  }
}

function parseExecution(value: unknown): ScheduledRefreshExecution | null {
  if (!isRecord(value)) {
    return null;
  }
  if (
    typeof value.id !== "string" ||
    typeof value.trigger !== "string" ||
    (value.status !== "success" && value.status !== "partial" && value.status !== "failed") ||
    typeof value.startedAt !== "number" ||
    typeof value.finishedAt !== "number" ||
    typeof value.total !== "number" ||
    typeof value.succeeded !== "number" ||
    typeof value.failed !== "number" ||
    typeof value.message !== "string"
  ) {
    return null;
  }
  return {
    id: value.id,
    trigger: value.trigger,
    status: value.status,
    startedAt: value.startedAt,
    finishedAt: value.finishedAt,
    total: value.total,
    succeeded: value.succeeded,
    failed: value.failed,
    activated: typeof value.activated === "number" ? value.activated : 0,
    activationSkipped: typeof value.activationSkipped === "number" ? value.activationSkipped : 0,
    activationFailed: typeof value.activationFailed === "number" ? value.activationFailed : 0,
    message: value.message,
  };
}

function buildScheduledRefreshResultMessage(
  refresh: { succeeded: number; failed: number },
  activation: { activated: number; skipped: number; failed: number },
): string {
  if (activation.activated === 0 && activation.failed === 0) {
    return `定时刷新完成：成功 ${refresh.succeeded} 个，失败 ${refresh.failed} 个`;
  }
  return `定时刷新完成：成功 ${refresh.succeeded} 个，失败 ${refresh.failed} 个；5 小时激活 ${activation.activated} 个，跳过 ${activation.skipped} 个，失败 ${activation.failed} 个`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function formatLocalTime(value: number): string {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value * 1000));
}
