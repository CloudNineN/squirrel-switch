import { app, BrowserWindow, dialog, ipcMain, session as electronSession, shell } from "electron";
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { createServer } from "node:net";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  exportChatGptBackup,
  importChatGptBackup,
  parseExportBackupRequest,
  parseImportBackupRequest,
} from "./chatgpt-backup.js";
import {
  emptyChatGptAccountStatus,
  normalizeChatGptAccountStatus,
} from "./chatgpt-account-status.js";
import type { ChatGptAccountStatus } from "./chatgpt-account-status.js";
import {
  clearChatGptBrowserProfile,
  closeChatGptBrowserProfile,
  collectChatGptAccountStatusFromBrowserProfile,
  hasActiveChatGptBrowserRuntime,
  openChatGptBrowserProfile,
  openUrlInChatGptBrowserProfile,
  readChatGptBrowserSessionSummary,
} from "./chatgpt-browser.js";
import type { ChatGptBrowserKind, ChatGptDesktopProfile } from "./chatgpt-browser.js";

let mainWindow: BrowserWindow | null = null;
let serverProcess: ReturnType<typeof spawn> | null = null;
let serverOrigin: string | null = null;

const __dirname = dirname(fileURLToPath(import.meta.url));
const bundledRootDir = join(process.resourcesPath, "app");
const isBundledApp = existsSync(join(bundledRootDir, "package.json"));
const rootDir = isBundledApp ? bundledRootDir : resolve(__dirname, "../../..");
const serverEntry = join(rootDir, "apps/server/dist/index.js");
const serverCwd = isBundledApp ? join(rootDir, "apps/server") : rootDir;
const nodeBinary = resolveNodeBinary();
const appIconFileName = process.platform === "win32" ? "app-icon.ico" : "app-icon.png";
const appIconPath = isBundledApp
  ? join(process.resourcesPath, appIconFileName)
  : join(rootDir, "apps/desktop/assets", appIconFileName);
const preloadPath = join(__dirname, "preload.cjs");
const loginPartition = "persist:squirrel-switch-login";
const loginUserAgent = `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${process.versions.chrome} Safari/537.36`;

async function createMainWindow(): Promise<void> {
  const port = await findOpenPort(3210);
  serverOrigin = `http://127.0.0.1:${port}`;
  await startServer(port);

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 800,
    minWidth: 1120,
    minHeight: 640,
    title: "Squirrel Switch",
    icon: appIconPath,
    backgroundColor: "#f5f7f4",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: preloadPath,
    },
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isOpenAiAuthUrl(url)) {
      void openLoginWindow({ sessionId: null, url });
      return { action: "deny" };
    }
    void shell.openExternal(url);
    return { action: "deny" };
  });

  await mainWindow.loadURL(`http://127.0.0.1:${port}`);
}

ipcMain.handle("login:open-url", async (_event, url: unknown) => {
  const request = parseOpenLoginUrlRequest(url);
  if (!request || !isOpenAiAuthUrl(request.url)) {
    return { opened: false, error: "授权链接不合法" };
  }
  try {
    await openLoginWindow(request);
    return { opened: true, error: null };
  } catch (error) {
    return { opened: false, error: error instanceof Error ? error.message : String(error) };
  }
});

ipcMain.handle("chatgpt:open", async (_event, input: unknown) => {
  const profile = parseChatGptDesktopProfile(input);
  if (!profile) {
    return { opened: false, error: "ChatGPT 会话参数不合法" };
  }
  try {
    await openChatGptBrowserProfile(profile);
    return { opened: true, error: null };
  } catch (error) {
    return { opened: false, error: errorMessage(error) };
  }
});

ipcMain.handle("chatgpt:open-url", async (_event, input: unknown) => {
  const request = parseChatGptOpenUrlRequest(input);
  if (!request || !isAllowedChatGptProfileUrl(request.url)) {
    return { opened: false, error: "ChatGPT 外部浏览器链接不合法" };
  }
  try {
    await openUrlInChatGptBrowserProfile(request.profile, request.url);
    return { opened: true, error: null };
  } catch (error) {
    return { opened: false, error: errorMessage(error) };
  }
});

ipcMain.handle("chatgpt:clear-session", async (_event, input: unknown) => {
  const profile = parseChatGptDesktopProfile(input);
  if (!profile) {
    return { cleared: false, error: "ChatGPT 会话参数不合法" };
  }
  try {
    await clearChatGptBrowserProfile(profile);
    return { cleared: true, error: null };
  } catch (error) {
    return { cleared: false, error: errorMessage(error) };
  }
});

ipcMain.handle("chatgpt:session-summary", async (_event, input: unknown) => {
  const profile = parseChatGptDesktopProfile(input);
  if (!profile) {
    return { summary: null, error: "ChatGPT 会话参数不合法" };
  }
  try {
    return {
      summary: await readChatGptBrowserSessionSummary(profile),
      error: null,
    };
  } catch (error) {
    return { summary: null, error: errorMessage(error) };
  }
});

ipcMain.handle("chatgpt:account-status", async (_event, input: unknown) => {
  const request = parseAccountStatusRequest(input);
  if (!request) {
    return { status: null, error: "ChatGPT 会话参数不合法" };
  }
  try {
    return {
      status: await readChatGptAccountStatus(request.profile, request.accountId, request.closeAfterCheck),
      error: null,
    };
  } catch (error) {
    return { status: null, error: errorMessage(error) };
  }
});

ipcMain.handle("chatgpt:export-backup", async (_event, input: unknown) => {
  const request = parseExportBackupRequest(input);
  if (!request) {
    return { result: null, error: "ChatGPT 导出参数不合法" };
  }
  try {
    return { result: await exportChatGptBackup(request), error: null };
  } catch (error) {
    return { result: null, error: errorMessage(error) };
  }
});

ipcMain.handle("chatgpt:import-backup", async (_event, input: unknown) => {
  const request = parseImportBackupRequest(input);
  if (!request) {
    return { result: null, error: "ChatGPT 导入参数不合法" };
  }
  try {
    return { result: await importChatGptBackup(request), error: null };
  } catch {
    return { result: null, error: "无法解密或写入 ChatGPT 备份，请确认密码和文件是否正确" };
  }
});

async function readChatGptAccountStatus(
  profile: ChatGptDesktopProfile,
  savedAccountId: string | null,
  closeAfterCheck: boolean,
): Promise<ChatGptAccountStatus> {
  const checkedAt = Math.floor(Date.now() / 1000);
  const shouldCloseAfterCheck = closeAfterCheck && !(await hasActiveChatGptBrowserRuntime(profile.id));
  const browserOptions = shouldCloseAfterCheck ? { headless: true, initialUrl: "about:blank" } : {};
  try {
    const summary = await readChatGptBrowserSessionSummary(profile, browserOptions);
    if (!summary.hasSession) {
      return emptyChatGptAccountStatus("invalid", checkedAt, "未找到 ChatGPT 登录 cookie");
    }
    if (shouldCloseAfterCheck) {
      return emptyChatGptAccountStatus("available", checkedAt, "已检测到本地 ChatGPT 登录 cookie");
    }

    try {
      const value = await collectChatGptAccountStatusFromBrowserProfile(profile, savedAccountId, browserOptions);
      return normalizeChatGptAccountStatus(value, checkedAt);
    } catch {
      return emptyChatGptAccountStatus("available", checkedAt, "会员信息不可用");
    }
  } finally {
    if (shouldCloseAfterCheck) {
      await closeChatGptBrowserProfile(profile.id).catch(() => undefined);
    }
  }
}

function parseChatGptDesktopProfile(value: unknown): ChatGptDesktopProfile | null {
  if (!isRecord(value)) {
    return null;
  }
  const {
    id,
    displayName,
    linkedCodexEmail,
    accountEmail,
    accountId,
    planLabel,
    browserKind,
    browserExecutablePath,
    browserProfileDir,
  } = value;
  if (
    typeof id !== "string" ||
    typeof displayName !== "string" ||
    !(typeof linkedCodexEmail === "string" || linkedCodexEmail === null) ||
    !(typeof accountEmail === "string" || accountEmail === null) ||
    !(typeof accountId === "string" || accountId === null) ||
    !(typeof planLabel === "string" || planLabel === null) ||
    !(isBrowserKind(browserKind) || browserKind === null) ||
    !(typeof browserExecutablePath === "string" || browserExecutablePath === null) ||
    !(typeof browserProfileDir === "string" || browserProfileDir === null)
  ) {
    return null;
  }
  return {
    id,
    displayName,
    linkedCodexEmail,
    accountEmail,
    accountId,
    planLabel,
    browserKind,
    browserExecutablePath,
    browserProfileDir,
  };
}

function parseAccountStatusRequest(
  value: unknown,
): { profile: ChatGptDesktopProfile; accountId: string | null; closeAfterCheck: boolean } | null {
  if (typeof value === "string") {
    return null;
  }
  const profile = parseChatGptDesktopProfile(value);
  if (!isRecord(value) || !profile) {
    return null;
  }
  if (!(typeof value.accountId === "string" || value.accountId === null || value.accountId === undefined)) {
    return null;
  }
  const accountId = typeof value.accountId === "string" && value.accountId.trim()
    ? value.accountId.trim()
    : null;
  return { profile, accountId, closeAfterCheck: value.closeAfterCheck === true };
}

function parseChatGptOpenUrlRequest(
  value: unknown,
): { profile: ChatGptDesktopProfile; url: string } | null {
  if (!isRecord(value)) {
    return null;
  }
  const profile = parseChatGptDesktopProfile(value.profile);
  if (!profile || typeof value.url !== "string") {
    return null;
  }
  return { profile, url: value.url };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isBrowserKind(value: unknown): value is ChatGptBrowserKind {
  return value === "chrome" || value === "edge" || value === "custom";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

interface OpenLoginWindowRequest {
  sessionId: string | null;
  url: string;
}

function parseOpenLoginUrlRequest(value: unknown): OpenLoginWindowRequest | null {
  if (typeof value === "string") {
    return { sessionId: null, url: value };
  }
  if (typeof value !== "object" || value === null || !("url" in value)) {
    return null;
  }
  const candidate = value as { sessionId?: unknown; url?: unknown };
  if (typeof candidate.url !== "string") {
    return null;
  }
  return {
    sessionId: typeof candidate.sessionId === "string" ? candidate.sessionId : null,
    url: candidate.url,
  };
}

async function openLoginWindow(request: OpenLoginWindowRequest): Promise<void> {
  const partition = loginPartition;
  const authSession = electronSession.fromPartition(partition);
  await prepareLoginSession(authSession);
  authSession.setUserAgent(loginUserAgent);
  let routeErrorRetryStarted = false;

  const loginWindow = new BrowserWindow({
    width: 1080,
    height: 760,
    minWidth: 760,
    minHeight: 560,
    title: "Squirrel Switch 登录授权",
    icon: appIconPath,
    backgroundColor: "#ffffff",
    parent: mainWindow ?? undefined,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      partition,
    },
  });

  loginWindow.webContents.setWindowOpenHandler(({ url: nextUrl }) => {
    if (isTrustedLoginWindowUrl(nextUrl)) {
      void loginWindow.loadURL(nextUrl, { userAgent: loginUserAgent });
    } else {
      void shell.openExternal(nextUrl);
    }
    return { action: "deny" };
  });
  loginWindow.webContents.on("will-redirect", (_event, nextUrl) => {
    closeAfterCallback(loginWindow, nextUrl);
  });
  loginWindow.webContents.on("did-navigate", (_event, nextUrl) => {
    closeAfterCallback(loginWindow, nextUrl);
    scheduleRouteErrorChecks();
  });
  loginWindow.webContents.on("page-title-updated", (_event, title) => {
    if (isOpenAiRouteErrorTitle(title)) {
      void triggerRouteErrorRetry(true);
    }
  });
  loginWindow.webContents.on("did-finish-load", () => {
    scheduleRouteErrorChecks();
  });

  await loginWindow.loadURL(request.url, { userAgent: loginUserAgent });

  function scheduleRouteErrorChecks(): void {
    for (const delayMs of [0, 300, 900, 1800, 3200]) {
      setTimeout(() => {
        void triggerRouteErrorRetry(false);
      }, delayMs);
    }
  }

  async function triggerRouteErrorRetry(force: boolean): Promise<void> {
    if (routeErrorRetryStarted || !request.sessionId || loginWindow.isDestroyed()) {
      return;
    }
    if (!force && !(await isOpenAiRouteErrorPage(loginWindow))) {
      return;
    }

    routeErrorRetryStarted = true;
    const retried = await requestRouteErrorRetry(request.sessionId);
    if (!retried) {
      routeErrorRetryStarted = false;
      return;
    }
    setTimeout(() => {
      if (!loginWindow.isDestroyed()) {
        loginWindow.close();
      }
    }, 300);
  }
}

async function requestRouteErrorRetry(sessionId: string): Promise<boolean> {
  if (!serverOrigin) {
    return false;
  }
  const response = await fetch(
    `${serverOrigin}/api/login-sessions/${encodeURIComponent(sessionId)}/retry-route-error`,
    { method: "POST" },
  ).catch(() => null);
  return response?.ok === true;
}

async function isOpenAiRouteErrorPage(loginWindow: BrowserWindow): Promise<boolean> {
  const snapshot = await readLoginPageSnapshot(loginWindow);
  if (!snapshot) {
    return false;
  }
  const content = `${snapshot.title}\n${snapshot.text}`;
  return isOpenAiRouteErrorTitle(snapshot.title) || isOpenAiRouteErrorBody(content);
}

function isOpenAiRouteErrorTitle(title: string): boolean {
  return title.includes("Oops, an error occurred") && title.includes("OpenAI");
}

function isOpenAiRouteErrorBody(content: string): boolean {
  return content.includes("Oops, an error occurred") && content.includes("Invalid content type: text/html");
}

interface LoginPageSnapshot {
  title: string;
  text: string;
}

async function readLoginPageSnapshot(loginWindow: BrowserWindow): Promise<LoginPageSnapshot | null> {
  const value = (await loginWindow.webContents
    .executeJavaScript(
      `({ title: document.title, text: document.body ? document.body.innerText.slice(0, 2000) : "" })`,
      true,
    )
    .catch(() => null)) as unknown;
  if (
    typeof value !== "object" ||
    value === null ||
    !("title" in value) ||
    !("text" in value)
  ) {
    return null;
  }
  const snapshot = value as { title: unknown; text: unknown };
  if (typeof snapshot.title !== "string" || typeof snapshot.text !== "string") {
    return null;
  }
  return { title: snapshot.title, text: snapshot.text };
}

async function prepareLoginSession(authSession: Electron.Session): Promise<void> {
  const cookies = await authSession.cookies.get({});
  await Promise.all(
    cookies
      .filter((cookie) => cookie.domain && isOpenAiCookie(cookie.domain) && !isCloudflareCookie(cookie.name))
      .map((cookie) => authSession.cookies.remove(cookieUrl(cookie), cookie.name).catch(() => undefined)),
  );
}

function isOpenAiCookie(domain: string): boolean {
  const normalized = domain.replace(/^\./, "");
  return (
    normalized === "openai.com" ||
    normalized === "chatgpt.com" ||
    normalized.endsWith(".openai.com") ||
    normalized.endsWith(".chatgpt.com")
  );
}

function isCloudflareCookie(name: string): boolean {
  return name === "cf_clearance" || name.startsWith("__cf") || name.startsWith("cf_");
}

function cookieUrl(cookie: Electron.Cookie): string {
  const host = cookie.domain?.replace(/^\./, "") ?? "";
  const path = cookie.path || "/";
  return `https://${host}${path.startsWith("/") ? path : `/${path}`}`;
}

function closeAfterCallback(loginWindow: BrowserWindow, url: string): void {
  if (!isCodexLoginCallbackUrl(url)) {
    return;
  }
  setTimeout(() => {
    if (!loginWindow.isDestroyed()) {
      loginWindow.close();
    }
  }, 1500);
}

function isOpenAiAuthUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && parsed.hostname === "auth.openai.com";
  } catch {
    return false;
  }
}

function isAllowedChatGptProfileUrl(url: string): boolean {
  if (isOpenAiAuthUrl(url)) {
    return true;
  }
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && parsed.hostname === "chatgpt.com" && parsed.pathname.startsWith("/apps");
  } catch {
    return false;
  }
}

function isCodexLoginCallbackUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return (
      (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1") &&
      parsed.pathname === "/auth/callback"
    );
  } catch {
    return false;
  }
}

function isTrustedLoginWindowUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return isTrustedLoginHost(parsed) || isCodexLoginCallbackUrl(url);
  } catch {
    return false;
  }
}

function isTrustedLoginHost(url: URL): boolean {
  if (url.protocol !== "https:") {
    return false;
  }
  const host = url.hostname;
  return (
    host === "chatgpt.com" ||
    host === "auth.openai.com" ||
    host === "login.openai.com" ||
    host === "platform.openai.com" ||
    host.endsWith(".chatgpt.com") ||
    host.endsWith(".openai.com")
  );
}

async function startServer(port: number): Promise<void> {
  serverProcess = spawn(nodeBinary, [serverEntry], {
    cwd: serverCwd,
    env: { ...process.env, PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"],
  });

  serverProcess.stderr?.on("data", (chunk: Buffer) => {
    const message = chunk.toString("utf8");
    if (message.trim()) {
      console.error(message);
    }
  });

  await waitForServer(port);
}

async function waitForServer(port: number): Promise<void> {
  const url = `http://127.0.0.1:${port}/api/runtime/status`;
  const startedAt = Date.now();
  while (Date.now() - startedAt < 10_000) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }
    } catch {
      await delay(150);
    }
  }
  throw new Error("本地服务启动超时");
}

async function findOpenPort(start: number): Promise<number> {
  for (let port = start; port < start + 30; port += 1) {
    if (await canListen(port)) {
      return port;
    }
  }
  throw new Error("没有可用端口");
}

function canListen(port: number): Promise<boolean> {
  return new Promise((resolvePort) => {
    const server = createServer();
    server.once("error", () => resolvePort(false));
    server.once("listening", () => {
      server.close(() => resolvePort(true));
    });
    server.listen(port, "127.0.0.1");
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

function resolveNodeBinary(): string {
  if (process.env.SQUIRREL_SWITCH_NODE_BINARY) {
    return process.env.SQUIRREL_SWITCH_NODE_BINARY;
  }
  if (isBundledApp) {
    return join(process.resourcesPath, "bin", process.platform === "win32" ? "node.exe" : "node");
  }
  if (process.env.npm_node_execpath) {
    return process.env.npm_node_execpath;
  }

  const result = spawnSync("/usr/bin/env", ["node", "-p", "process.execPath"], {
    encoding: "utf8",
  });
  const resolved = result.stdout.trim();
  return resolved || "node";
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  if (serverProcess && !serverProcess.killed) {
    serverProcess.kill("SIGTERM");
  }
});

app
  .whenReady()
  .then(createMainWindow)
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    void dialog.showErrorBox("Squirrel Switch 启动失败", message);
    app.quit();
  });
