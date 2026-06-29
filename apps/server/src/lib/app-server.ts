import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeAuthJsonAtomic } from "./files.js";
import { getErrorMessage } from "./errors.js";
import { authJsonPath } from "./paths.js";
import { nowSeconds } from "./time.js";

const APP_VERSION = "1.12.0";

interface AppServerResponse<T> {
  id: number;
  result?: T;
  error?: { code: number; message: string };
}

export interface AppServerNotification {
  method: string;
  params?: unknown;
}

export interface RateLimitWindow {
  usedPercent: number;
  windowDurationMins: number | null;
  resetsAt: number | null;
}

export interface RateLimitSnapshot {
  limitId: string | null;
  limitName: string | null;
  primary: RateLimitWindow | null;
  secondary: RateLimitWindow | null;
  credits: unknown;
  planType: string | null;
  rateLimitReachedType: string | null;
}

export interface RateLimitResetCredits {
  availableCount: number;
}

export interface RateLimitsResponse {
  rateLimits: RateLimitSnapshot;
  rateLimitsByLimitId: Record<string, RateLimitSnapshot | undefined> | null;
  rateLimitResetCredits: RateLimitResetCredits | null;
}

export interface AccountReadResponse {
  account: { type: string; email?: string; planType?: string } | null;
  requiresOpenaiAuth: boolean;
}

export interface AppServerReadResult {
  rateLimits: RateLimitsResponse | null;
  rateLimitsError: string | null;
  account: AccountReadResponse | null;
  updatedAuthJson: string;
}

export interface AppServerFiveHourActivationResult {
  rateLimits: RateLimitsResponse | null;
  rateLimitsError: string | null;
  completedAt: number;
  updatedAuthJson: string;
}

export async function readAccountFromAuthJson(
  codexBinary: string,
  authJson: string,
): Promise<AppServerReadResult> {
  const tempHome = await mkdtemp(join(tmpdir(), "squirrel-switch-"));
  const authPath = join(tempHome, "auth.json");

  try {
    await writeAuthJsonAtomic(authPath, authJson);
    const client = new AppServerClient(codexBinary, tempHome);
    await client.start();
    try {
      return await readWithInitializedClient(client, authPath);
    } finally {
      await client.stop();
    }
  } finally {
    await rm(tempHome, { recursive: true, force: true }).catch(() => undefined);
  }
}

export async function activateFiveHourWindowFromAuthJson(
  codexBinary: string,
  authJson: string,
): Promise<AppServerFiveHourActivationResult> {
  const tempHome = await mkdtemp(join(tmpdir(), "squirrel-switch-"));
  const authPath = join(tempHome, "auth.json");

  try {
    await writeAuthJsonAtomic(authPath, authJson);
    const client = new AppServerClient(codexBinary, tempHome);
    await client.start();
    try {
      return await activateFiveHourWindowWithInitializedClient(client, authPath, tempHome);
    } finally {
      await client.stop();
    }
  } finally {
    await rm(tempHome, { recursive: true, force: true }).catch(() => undefined);
  }
}

export async function readAccountFromCodexHome(
  codexBinary: string,
  codexHome: string,
): Promise<AppServerReadResult> {
  const client = new AppServerClient(codexBinary, codexHome);
  await client.start();
  try {
    return await readWithInitializedClient(client, authJsonPath(codexHome));
  } finally {
    await client.stop();
  }
}

async function readWithInitializedClient(
  client: AppServerClient,
  authPath: string,
): Promise<AppServerReadResult> {
  await initializeClient(client);

  let account: AccountReadResponse | null = null;
  let accountError: string | null = null;
  try {
    account = await client.request<AccountReadResponse>("account/read", { refreshToken: true });
  } catch (error) {
    accountError = normalizeAppServerError(error);
  }

  let rateLimits: RateLimitsResponse | null = null;
  let rateLimitsError: string | null = null;
  try {
    rateLimits = await client.request<RateLimitsResponse>("account/rateLimits/read", null);
  } catch (error) {
    rateLimitsError = normalizeAppServerError(error);
  }

  if (isRevokedAuthError(accountError) || isRevokedAuthError(rateLimitsError)) {
    throw new Error(revokedAuthMessage());
  }

  if (!account?.account && !rateLimits) {
    throw new Error(accountError ?? rateLimitsError ?? "Codex app-server 未返回账号或额度信息");
  }

  return {
    account,
    rateLimits,
    rateLimitsError,
    updatedAuthJson: await readFile(authPath, "utf8"),
  };
}

async function activateFiveHourWindowWithInitializedClient(
  client: AppServerClient,
  authPath: string,
  cwd: string,
): Promise<AppServerFiveHourActivationResult> {
  await initializeClient(client);
  const thread = await client.request<unknown>("thread/start", { cwd });
  const threadId = extractThreadId(thread);
  if (!threadId) {
    throw new Error("Codex app-server 未返回预热线程 ID");
  }

  const waitForCompletion = client.waitForNotification("turn/completed", 120000);
  await client.request<unknown>(
    "turn/start",
    {
      threadId,
      input: [{ type: "text", text: "请只回复 OK，不要调用工具。", text_elements: [] }],
      cwd,
      approvalPolicy: "never",
      sandboxPolicy: { type: "readOnly", networkAccess: true },
    },
    120000,
  );
  assertTurnCompleted(await waitForCompletion);

  let rateLimits: RateLimitsResponse | null = null;
  let rateLimitsError: string | null = null;
  try {
    rateLimits = await client.request<RateLimitsResponse>("account/rateLimits/read", null);
  } catch (error) {
    rateLimitsError = normalizeAppServerError(error);
  }

  if (isRevokedAuthError(rateLimitsError)) {
    throw new Error(revokedAuthMessage());
  }

  return {
    rateLimits,
    rateLimitsError,
    completedAt: nowSeconds(),
    updatedAuthJson: await readFile(authPath, "utf8"),
  };
}

async function initializeClient(client: AppServerClient): Promise<void> {
  await client.request("initialize", {
    clientInfo: { name: "squirrel-switch", title: "Squirrel Switch", version: APP_VERSION },
    capabilities: {
      experimentalApi: true,
      requestAttestation: false,
      optOutNotificationMethods: [],
    },
  });
  client.notify("initialized", {});
}

function extractThreadId(value: unknown): string | null {
  if (!isRecord(value)) {
    return null;
  }
  if (typeof value.threadId === "string") {
    return value.threadId;
  }
  if (isRecord(value.thread)) {
    if (typeof value.thread.id === "string") {
      return value.thread.id;
    }
    if (typeof value.thread.threadId === "string") {
      return value.thread.threadId;
    }
  }
  return null;
}

function assertTurnCompleted(notification: AppServerNotification): void {
  const params = notification.params;
  if (!isRecord(params) || !isRecord(params.turn)) {
    throw new Error("Codex app-server 未返回 5 小时激活 turn 结果");
  }

  if (params.turn.status === "completed") {
    return;
  }

  const error = isRecord(params.turn.error) ? params.turn.error.message : null;
  const message = typeof error === "string" && error.trim() ? `：${error}` : "";
  throw new Error(`Codex 5 小时激活 turn 未完成${message}`);
}

function normalizeAppServerError(error: unknown): string {
  const message = getErrorMessage(error);
  if (isRevokedAuthError(message)) {
    return revokedAuthMessage();
  }
  if (
    message.includes("failed to fetch codex rate limits") &&
    message.includes("error sending request")
  ) {
    return "Codex 额度接口暂不可用，请稍后重试。";
  }
  return message;
}

function isRevokedAuthError(message: string | null): boolean {
  if (!message) {
    return false;
  }
  return (
    message.includes("token_revoked") ||
    message.includes("token_invalidated") ||
    message.includes("invalidated oauth token") ||
    message.includes("has been invalidated") ||
    message.includes("refresh token was already used")
  );
}

function revokedAuthMessage(): string {
  return "登录态已失效：刷新令牌已被官方拒绝，请在 Codex 中重新登录后重新导入该账号。";
}

export class AppServerClient {
  private child: ReturnType<typeof spawn> | null = null;
  private nextId = 1;
  private buffer = "";
  private readonly notificationWaiters: Array<{
    method: string;
    resolve: (notification: AppServerNotification) => void;
    reject: (reason?: unknown) => void;
    timer: NodeJS.Timeout;
  }> = [];
  private readonly pending = new Map<
    number,
    {
      resolve: (value: unknown) => void;
      reject: (reason?: unknown) => void;
      timer: NodeJS.Timeout;
    }
  >();

  constructor(
    private readonly codexBinary: string,
    private readonly codexHome: string,
    private readonly onNotification?: (notification: AppServerNotification) => void,
    private readonly onExit?: (code: number | null) => void,
  ) {}

  async start(): Promise<void> {
    const child = spawn(this.codexBinary, ["app-server", "--listen", "stdio://"], {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, CODEX_HOME: this.codexHome },
    });
    this.child = child;
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => this.onData(chunk));
    child.stderr.on("data", () => undefined);
    child.on("error", (error) => this.rejectAll(error));
    child.on("exit", (code) => {
      this.onExit?.(code);
      if (this.pending.size > 0) {
        this.rejectAll(new Error(`codex app-server 已退出：${code ?? "unknown"}`));
      }
    });
  }

  async stop(): Promise<void> {
    if (!this.child) {
      return;
    }
    if (!this.child.killed) {
      this.child.kill("SIGTERM");
    }
    this.child = null;
  }

  request<T>(method: string, params: unknown, timeoutMs = 15000): Promise<T> {
    const child = this.child;
    if (!child?.stdin?.writable) {
      return Promise.reject(new Error("codex app-server 未启动"));
    }

    const id = this.nextId++;
    const payload = params === undefined ? { id, method } : { id, method, params };
    const promise = new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} 请求超时`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject,
        timer,
      });
    });
    child.stdin.write(`${JSON.stringify(payload)}\n`);
    return promise;
  }

  notify(method: string, params: unknown): void {
    const child = this.child;
    if (!child?.stdin?.writable) {
      throw new Error("codex app-server 未启动");
    }

    const payload = params === undefined ? { method } : { method, params };
    child.stdin.write(`${JSON.stringify(payload)}\n`);
  }

  waitForNotification(method: string, timeoutMs: number): Promise<AppServerNotification> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.removeNotificationWaiter(method, resolve);
        reject(new Error(`${method} 等待超时`));
      }, timeoutMs);
      this.notificationWaiters.push({ method, resolve, reject, timer });
    });
  }

  private onData(chunk: string): void {
    this.buffer += chunk;
    for (;;) {
      const newlineIndex = this.buffer.indexOf("\n");
      if (newlineIndex < 0) {
        return;
      }
      const line = this.buffer.slice(0, newlineIndex).trim();
      this.buffer = this.buffer.slice(newlineIndex + 1);
      if (!line) {
        continue;
      }
      this.handleLine(line);
    }
  }

  private handleLine(line: string): void {
    let message: AppServerResponse<unknown> | Record<string, unknown>;
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }

    if ("method" in message && typeof message.method === "string" && typeof message.id !== "number") {
      const notification = {
        method: message.method,
        params: "params" in message ? message.params : undefined,
      };
      this.resolveNotificationWaiters(notification);
      this.onNotification?.(notification);
      return;
    }

    if (typeof message.id !== "number") {
      return;
    }

    if ("method" in message) {
      const stdin = this.child?.stdin;
      if (stdin?.writable) {
        stdin.write(
          `${JSON.stringify({
            id: message.id,
            error: { code: -32601, message: "squirrel-switch 不处理服务端回调" },
          })}\n`,
        );
      }
      return;
    }

    const pending = this.pending.get(message.id);
    if (!pending) {
      return;
    }
    clearTimeout(pending.timer);
    this.pending.delete(message.id);

    const response = message as AppServerResponse<unknown>;
    if (response.error) {
      pending.reject(new Error(response.error.message));
      return;
    }
    pending.resolve(response.result);
  }

  private rejectAll(error: unknown): void {
    const message = new Error(getErrorMessage(error));
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      this.pending.delete(id);
      pending.reject(message);
    }
    for (const waiter of this.notificationWaiters.splice(0)) {
      clearTimeout(waiter.timer);
      waiter.reject(message);
    }
  }

  private resolveNotificationWaiters(notification: AppServerNotification): void {
    for (const waiter of [...this.notificationWaiters]) {
      if (waiter.method !== notification.method) {
        continue;
      }
      this.removeNotificationWaiter(waiter.method, waiter.resolve);
      clearTimeout(waiter.timer);
      waiter.resolve(notification);
    }
  }

  private removeNotificationWaiter(
    method: string,
    resolve: (notification: AppServerNotification) => void,
  ): void {
    const index = this.notificationWaiters.findIndex(
      (waiter) => waiter.method === method && waiter.resolve === resolve,
    );
    if (index >= 0) {
      this.notificationWaiters.splice(index, 1);
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
