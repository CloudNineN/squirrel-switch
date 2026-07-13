import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile, chmod } from "node:fs/promises";
import { join } from "node:path";
import type { AccountView } from "./db.js";
import { AppServerClient } from "./app-server.js";
import type { AppServerNotification } from "./app-server.js";
import { CODEX_BINARY_NOT_FOUND_MESSAGE, resolveCodexBinary } from "./codex-binary.js";
import { loginSessionsDir } from "./paths.js";
import {
  findActiveReloginMatch,
  importAuthJson,
  refreshAccount,
  syncReloggedActiveAccountToDisk,
} from "./accounts.js";
import { AppError, getErrorMessage } from "./errors.js";

export type LoginSessionStatus = "running" | "imported" | "failed";

export interface PrivateBrowserLaunchView {
  attempted: boolean;
  opened: boolean;
  browserName: string | null;
  error: string | null;
}

export interface LoginSessionView {
  id: string;
  status: LoginSessionStatus;
  codexHome: string;
  startedAt: number;
  completedAt: number | null;
  message: string;
  verificationUrl: string | null;
  userCode: string | null;
  privateBrowser: PrivateBrowserLaunchView | null;
  account: AccountView | null;
}

interface LoginSessionState extends LoginSessionView {
  client: AppServerClient | null;
  loginId: string | null;
  routeErrorRetryCount: number;
  completing: boolean;
}

const sessions = new Map<string, LoginSessionState>();
const LOGIN_CLIENT_VERSION = "1.16.0";

export async function startIsolatedLogin(): Promise<LoginSessionView> {
  const codexBinary = await resolveCodexBinary();
  if (!codexBinary) {
    throw new AppError(CODEX_BINARY_NOT_FOUND_MESSAGE, 503);
  }

  const id = randomUUID();
  const codexHome = join(loginSessionsDir, id);
  await mkdir(codexHome, { recursive: true, mode: 0o700 });
  await writeFile(join(codexHome, "config.toml"), 'cli_auth_credentials_store = "file"\n', {
    mode: 0o600,
  });
  await chmod(join(codexHome, "config.toml"), 0o600);

  const state: LoginSessionState = {
    id,
    status: "running",
    codexHome,
    startedAt: Math.floor(Date.now() / 1000),
    completedAt: null,
    message: "已启动隔离 OAuth 登录；正在等待授权链接。",
    verificationUrl: null,
    userCode: null,
    privateBrowser: null,
    account: null,
    client: null,
    loginId: null,
    routeErrorRetryCount: 0,
    completing: false,
  };
  sessions.set(id, state);

  const client = new AppServerClient(
    codexBinary,
    codexHome,
    (notification) => handleLoginNotification(state, notification),
    (code) => handleAppServerExit(state, code),
  );
  state.client = client;
  await client.start();

  try {
    await initializeLoginClient(client);
    const response = await requestChatGptLogin(client);
    state.loginId = response.loginId;
    state.verificationUrl = response.authUrl;
    state.message = "已获取 OAuth 授权链接，正在打开授权页面。";
  } catch (error) {
    await failLoginSession(state, `登录流程启动失败：${getErrorMessage(error)}`);
  }

  return toView(state);
}

export async function retryLoginSessionAfterRouteError(id: string): Promise<LoginSessionView> {
  const state = sessions.get(id);
  if (!state) {
    throw new AppError("登录会话不存在", 404);
  }
  if (state.status !== "running") {
    throw new AppError("登录会话已结束，无法重新获取授权链接", 409);
  }
  if (!state.client) {
    throw new AppError("登录客户端未运行，无法重新获取授权链接", 409);
  }
  if (state.routeErrorRetryCount >= 1) {
    throw new AppError("已自动重试过一次，请关闭窗口后重新开始登录", 409);
  }

  state.routeErrorRetryCount += 1;
  state.message = "检测到 OpenAI 登录页返回异常内容，正在重新获取 OAuth 授权链接。";
  try {
    const response = await requestChatGptLogin(state.client);
    state.loginId = response.loginId;
    state.verificationUrl = response.authUrl;
    state.message = "已重新获取 OAuth 授权链接，正在重新打开授权页面。";
  } catch (error) {
    state.message = `自动重新获取授权链接失败：${getErrorMessage(error)}`;
    throw error;
  }
  return toView(state);
}

export async function getLoginSession(id: string): Promise<LoginSessionView> {
  const state = sessions.get(id);
  if (!state) {
    throw new AppError("登录会话不存在", 404);
  }
  await completeLoginSessionIfAuthJsonExists(state);
  return toView(state);
}

interface LoginAccountStartResponse {
  type: "apiKey" | "chatgptDeviceCode" | "chatgptAuthTokens";
}

interface ChatGptLoginAccountStartResponse {
  type: "chatgpt";
  loginId: string;
  authUrl: string;
}

type LoginAccountStartResult = LoginAccountStartResponse | ChatGptLoginAccountStartResponse;

async function initializeLoginClient(client: AppServerClient): Promise<void> {
  await client.request("initialize", {
    clientInfo: { name: "squirrel-switch", title: "Squirrel Switch", version: LOGIN_CLIENT_VERSION },
    capabilities: {
      experimentalApi: true,
      requestAttestation: false,
      optOutNotificationMethods: [],
    },
  });
}

async function requestChatGptLogin(client: AppServerClient): Promise<ChatGptLoginAccountStartResponse> {
  const response = await client.request<LoginAccountStartResult>("account/login/start", {
    type: "chatgpt",
    codexStreamlinedLogin: true,
  });
  if (response.type !== "chatgpt") {
    throw new Error("Codex app-server 未返回普通 OAuth 授权链接");
  }
  return response;
}

function handleLoginNotification(
  state: LoginSessionState,
  notification: AppServerNotification,
): void {
  if (notification.method !== "account/login/completed") {
    return;
  }
  if (!isLoginCompletedParams(notification.params)) {
    return;
  }
  if (notification.params.loginId && state.loginId && notification.params.loginId !== state.loginId) {
    return;
  }
  if (!notification.params.success) {
    void failLoginSession(
      state,
      `登录授权失败：${notification.params.error ?? "Codex app-server 未返回具体原因"}`,
    );
    return;
  }
  void completeLoginSession(state);
}

function isLoginCompletedParams(
  value: unknown,
): value is { loginId: string | null; success: boolean; error: string | null } {
  return (
    typeof value === "object" &&
    value !== null &&
    "success" in value &&
    typeof value.success === "boolean" &&
    (!("loginId" in value) || typeof value.loginId === "string" || value.loginId === null) &&
    (!("error" in value) || typeof value.error === "string" || value.error === null)
  );
}

function handleAppServerExit(state: LoginSessionState, code: number | null): void {
  if (state.status !== "running" || state.completing) {
    return;
  }
  state.status = "failed";
  state.completedAt = Math.floor(Date.now() / 1000);
  state.message = `Codex app-server 已退出：${code ?? "unknown"}`;
}

async function completeLoginSession(state: LoginSessionState): Promise<void> {
  if (state.status !== "running" || state.completing) {
    return;
  }
  state.completing = true;

  state.completedAt = Math.floor(Date.now() / 1000);
  const authPath = join(state.codexHome, "auth.json");
  if (!(await waitForAuthJson(authPath))) {
    state.status = "failed";
    state.message = "隔离登录已结束，但未生成 auth.json。请确认是否打开链接并完成授权。";
    await state.client?.stop();
    return;
  }

  try {
    const authJson = await readFile(authPath, "utf8");
    const activeReloginMatch = findActiveReloginMatch(authJson);
    state.account = await importAuthJson({ authJson });
    state.message = `已导入账号：${state.account.name}`;
    await state.client?.stop();
    state.client = null;

    if (activeReloginMatch) {
      try {
        const restart = await syncReloggedActiveAccountToDisk(activeReloginMatch.accountId);
        const tail = restart.attempted
          ? restart.restarted
            ? "，已重启 Codex"
            : "，请手动重启 Codex 以加载新登录态"
          : "";
        state.message = `已重新登录当前账号：${activeReloginMatch.accountName}，登录态已写回${tail}`;
      } catch (syncError) {
        state.message = `已导入账号：${state.account.name}，但写回当前登录态失败：${getErrorMessage(syncError)}`;
      }
    }

    const importedMessage = state.message;
    try {
      state.account = await refreshAccount(state.account.id);
      state.message = `${importedMessage}；首次限额已刷新`;
    } catch (refreshError) {
      state.message = `${importedMessage}；首次限额刷新失败：${getErrorMessage(refreshError)}`;
    }
    state.status = "imported";
  } catch (error) {
    state.status = "failed";
    state.message = `导入隔离 auth.json 失败：${getErrorMessage(error)}`;
  } finally {
    await state.client?.stop();
    state.client = null;
  }
}

async function completeLoginSessionIfAuthJsonExists(state: LoginSessionState): Promise<void> {
  if (state.status !== "running") {
    return;
  }
  if (!existsSync(join(state.codexHome, "auth.json"))) {
    return;
  }
  await completeLoginSession(state);
}

async function waitForAuthJson(authPath: string): Promise<boolean> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (existsSync(authPath)) {
      return true;
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 150));
  }
  return false;
}

async function failLoginSession(state: LoginSessionState, message: string): Promise<void> {
  if (state.status !== "running") {
    return;
  }
  state.status = "failed";
  state.completedAt = Math.floor(Date.now() / 1000);
  state.message = message;
  await state.client?.stop();
  state.client = null;
}

function toView(state: LoginSessionState): LoginSessionView {
  return {
    id: state.id,
    status: state.status,
    codexHome: state.codexHome,
    startedAt: state.startedAt,
    completedAt: state.completedAt,
    message: state.message,
    verificationUrl: state.verificationUrl,
    userCode: state.userCode,
    privateBrowser: state.privateBrowser,
    account: state.account,
  };
}
