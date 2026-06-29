import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { homedir } from "node:os";
import { existsSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";

export type ChatGptBrowserKind = "chrome" | "edge" | "custom";

export interface ChatGptDesktopProfile {
  id: string;
  displayName: string;
  linkedCodexEmail: string | null;
  accountEmail: string | null;
  accountId: string | null;
  planLabel: string | null;
  browserKind: ChatGptBrowserKind | null;
  browserExecutablePath: string | null;
  browserProfileDir: string | null;
}

export interface ChatGptPortableCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  secure: boolean;
  httpOnly: boolean;
  expirationDate?: number;
  sameSite?: string;
}

export interface ChatGptOriginStorageSnapshot {
  origin: string;
  localStorage: Record<string, string>;
}

export interface ChatGptBrowserSessionSnapshot {
  cookies: ChatGptPortableCookie[];
  originStorage: ChatGptOriginStorageSnapshot[];
}

export interface ImportBrowserSessionResult {
  cookieCount: number;
  failedOriginStorage: number;
}

interface BrowserRuntime {
  profileId: string;
  profileDir: string;
  browserKind: ChatGptBrowserKind;
  executablePath: string;
  port: number;
  pid: number | null;
  launchedAt: number;
  headless: boolean;
}

interface BrowserResolution {
  browserKind: ChatGptBrowserKind;
  executablePath: string;
}

interface DevToolsVersion {
  webSocketDebuggerUrl: string;
}

interface DevToolsTarget {
  id: string;
  type: string;
  url: string;
  webSocketDebuggerUrl: string;
}

interface CdpResponse {
  id?: number;
  result?: unknown;
  error?: {
    message?: string;
  };
}

interface PendingCdpRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}

interface ChatGptApiReadResult {
  status: number;
  json?: unknown;
  unauthorized?: true;
  forbidden?: true;
}

export interface BrowserRuntimeOptions {
  initialUrl?: string;
  headless?: boolean;
}

const appDataDir = join(homedir(), ".squirrel-switch");
const browserProfilesDir = join(appDataDir, "browser-profiles");
const chatGptHomeUrl = "https://chatgpt.com";
const chatGptLoginUrl = "https://chatgpt.com/auth/login";
const chatGptStorageOrigins = ["https://chatgpt.com", "https://auth.openai.com"] as const;
const browserRuntimeByProfileId = new Map<string, BrowserRuntime>();
const cdpStartupTimeoutMs = 12_000;
const cdpRequestTimeoutMs = 10_000;

export function defaultBrowserProfileDir(profileId: string): string {
  assertSafeProfileId(profileId);
  return join(browserProfilesDir, profileId);
}

export async function openChatGptBrowserProfile(profile: ChatGptDesktopProfile): Promise<void> {
  const existing = browserRuntimeByProfileId.get(profile.id);
  const shouldReusePage = existing ? await canReachDevTools(existing.port) : false;
  const openUrl = hasKnownChatGptIdentity(profile) ? chatGptHomeUrl : chatGptLoginUrl;
  const runtime = await ensureBrowserRuntime(profile, { initialUrl: openUrl });
  if (shouldReusePage) {
    await focusOrOpenChatGptPage(runtime.port, openUrl).catch(() => undefined);
  }
}

export async function openUrlInChatGptBrowserProfile(
  profile: ChatGptDesktopProfile,
  url: string,
): Promise<void> {
  if (!isAllowedExternalProfileUrl(url)) {
    throw new Error("外部浏览器打开的链接不在允许范围内");
  }
  const runtime = await ensureBrowserRuntime(profile);
  const page = await openDevToolsPage(runtime.port, url);
  await activateDevToolsPage(runtime.port, page.id).catch(() => undefined);
}

export async function hasActiveChatGptBrowserRuntime(profileId: string): Promise<boolean> {
  const runtime = browserRuntimeByProfileId.get(profileId);
  return runtime ? canReachDevTools(runtime.port) : false;
}

export async function closeChatGptBrowserProfile(profileId: string): Promise<void> {
  const runtime = browserRuntimeByProfileId.get(profileId);
  if (!runtime) {
    return;
  }
  try {
    if (await canReachDevTools(runtime.port)) {
      const browserClient = await connectBrowserCdp(runtime.port);
      try {
        await browserClient.send("Browser.close");
      } catch {
        const pages = await listDevToolsPages(runtime.port).catch(() => []);
        await Promise.all(
          pages
            .filter((page) => isChatGptTargetUrl(page.url))
            .map((page) => closeDevToolsPage(runtime.port, page.id)),
        );
      } finally {
        browserClient.close();
      }
      await sleep(300);
    }
  } finally {
    browserRuntimeByProfileId.delete(profileId);
  }
}

export async function clearChatGptBrowserProfile(profile: ChatGptDesktopProfile): Promise<void> {
  const profileDir = normalizeBrowserProfileDir(profile);
  const runtime = browserRuntimeByProfileId.get(profile.id);
  if (runtime && (await canReachDevTools(runtime.port))) {
    throw new Error("请先关闭该 ChatGPT 浏览器窗口后再清除本机 Profile 数据");
  }
  browserRuntimeByProfileId.delete(profile.id);
  await rm(profileDir, { recursive: true, force: true });
}

export async function exportChatGptBrowserSession(
  profile: ChatGptDesktopProfile,
): Promise<ChatGptBrowserSessionSnapshot> {
  const runtime = await ensureBrowserRuntime(profile);
  const cookies = await readBrowserCookies(runtime.port);
  const originStorage: ChatGptOriginStorageSnapshot[] = [];
  for (const origin of chatGptStorageOrigins) {
    const snapshot = await readBrowserOriginStorage(runtime.port, origin).catch(() => null);
    if (snapshot && Object.keys(snapshot.localStorage).length > 0) {
      originStorage.push(snapshot);
    }
  }
  return { cookies, originStorage };
}

export async function importChatGptBrowserSession(
  profile: ChatGptDesktopProfile,
  snapshot: ChatGptBrowserSessionSnapshot,
): Promise<ImportBrowserSessionResult> {
  const runtime = await ensureBrowserRuntime(profile);
  const cookieCount = await writeBrowserCookies(runtime.port, snapshot.cookies);
  let failedOriginStorage = 0;
  for (const originStorage of snapshot.originStorage) {
    if (!isAllowedChatGptOrigin(originStorage.origin)) {
      continue;
    }
    await writeBrowserOriginStorage(runtime.port, originStorage).catch(() => {
      failedOriginStorage += 1;
    });
  }
  await openDevToolsPage(runtime.port, chatGptHomeUrl).catch(() => undefined);
  return { cookieCount, failedOriginStorage };
}

export async function readChatGptBrowserSessionSummary(
  profile: ChatGptDesktopProfile,
  options: BrowserRuntimeOptions = {},
): Promise<{
  hasSession: boolean;
  cookieCount: number;
  originStorageCount: number;
}> {
  const runtime = await ensureBrowserRuntime(profile, options);
  const cookies = await readBrowserCookies(runtime.port);
  return {
    hasSession: cookies.length > 0,
    cookieCount: cookies.length,
    originStorageCount: 0,
  };
}

export async function collectChatGptAccountStatusFromBrowserProfile(
  profile: ChatGptDesktopProfile,
  savedAccountId: string | null,
  options: BrowserRuntimeOptions = {},
): Promise<unknown> {
  const runtime = await ensureBrowserRuntime(profile, options);
  const page = await waitForExistingChatGptPage(runtime.port);
  const pageClient = await CdpClient.connect(page.webSocketDebuggerUrl);
  try {
    await waitForPageOrigin(pageClient, "https://chatgpt.com");
    const timezoneOffsetMin = new Date().getTimezoneOffset();
    const normalizedSavedAccountId =
      typeof savedAccountId === "string" && savedAccountId.trim() && isBillingAccountId(savedAccountId.trim())
        ? savedAccountId.trim()
        : null;
    const subscriptionPath = (accountId: string) =>
      `/backend-api/subscriptions?account_id=${encodeURIComponent(accountId)}`;
    const authSession = await readChatGptJsonFromPage(pageClient, "/api/auth/session");
    const accessToken = firstStringByKeys([authSession?.json], ["accessToken"]);
    const savedSubscription = normalizedSavedAccountId
      ? await readChatGptJsonFromPage(pageClient, subscriptionPath(normalizedSavedAccountId), accessToken)
      : null;
    if (savedSubscription?.json) {
      return {
        authSession,
        accountCheck: null,
        resolvedAccountId: normalizedSavedAccountId,
        subscription: savedSubscription,
      };
    }
    const accountCheck = await readChatGptJsonFromPage(
      pageClient,
      `/backend-api/accounts/check/v4-2023-04-27?timezone_offset_min=${timezoneOffsetMin}`,
      accessToken,
    );
    const checkedAccountId = accountIdFromAccountsCheck(accountCheck?.json);
    const subscriptionAccountIds = uniqueStrings([
      checkedAccountId,
      ...collectBillingAccountIds(accountCheck?.json),
      ...collectBillingAccountIds(authSession?.json),
      normalizedSavedAccountId,
    ]);
    let subscriptionAccountId: string | null = checkedAccountId ?? normalizedSavedAccountId;
    let fallbackSubscription: ChatGptApiReadResult | null = null;
    for (const candidateAccountId of subscriptionAccountIds) {
      if (candidateAccountId === normalizedSavedAccountId && savedSubscription) continue;
      const candidateSubscription = await readChatGptJsonFromPage(
        pageClient,
        subscriptionPath(candidateAccountId),
        accessToken,
      );
      if (candidateSubscription?.json) {
        subscriptionAccountId = candidateAccountId;
        fallbackSubscription = candidateSubscription;
        break;
      }
    }
    return {
      authSession,
      accountCheck,
      resolvedAccountId: subscriptionAccountId,
      subscription: fallbackSubscription ?? savedSubscription,
    };
  } finally {
    pageClient.close();
  }
}

async function ensureBrowserRuntime(
  profile: ChatGptDesktopProfile,
  options: BrowserRuntimeOptions = {},
): Promise<BrowserRuntime> {
  const initialUrl = options.initialUrl ?? chatGptHomeUrl;
  const headless = options.headless === true;
  const existing = browserRuntimeByProfileId.get(profile.id);
  if (existing && existing.headless === headless && (await canReachDevTools(existing.port))) {
    return existing;
  }
  if (existing) {
    browserRuntimeByProfileId.delete(profile.id);
  }

  const profileDir = normalizeBrowserProfileDir(profile);
  await mkdir(profileDir, { recursive: true, mode: 0o700 });
  const browser = resolveBrowser(profile);
  const port = await findOpenPort(43000);
  const args = [
    `--user-data-dir=${profileDir}`,
    `--remote-debugging-port=${port}`,
    "--remote-debugging-address=127.0.0.1",
    "--no-first-run",
    ...(headless ? ["--headless=new", "--disable-gpu"] : ["--new-window"]),
    initialUrl,
  ];
  const child = spawn(browser.executablePath, args, {
    detached: true,
    stdio: "ignore",
  });
  child.unref();

  const runtime: BrowserRuntime = {
    profileId: profile.id,
    profileDir,
    browserKind: browser.browserKind,
    executablePath: browser.executablePath,
    port,
    pid: child.pid ?? null,
    launchedAt: Date.now(),
    headless,
  };
  child.once("exit", () => {
    const current = browserRuntimeByProfileId.get(profile.id);
    if (current?.port === port) {
      browserRuntimeByProfileId.delete(profile.id);
    }
  });
  await waitForDevTools(port).catch((error) => {
    browserRuntimeByProfileId.delete(profile.id);
    throw new Error(
      `${errorMessage(error)}。如果该 ChatGPT Profile 已在浏览器中打开，请关闭对应窗口后重试`,
    );
  });
  browserRuntimeByProfileId.set(profile.id, runtime);
  return runtime;
}

function resolveBrowser(profile: ChatGptDesktopProfile): BrowserResolution {
  if (profile.browserKind === "custom") {
    const customPath = profile.browserExecutablePath?.trim();
    if (!customPath || !existsSync(customPath)) {
      throw new Error("自定义浏览器路径不可用");
    }
    return { browserKind: "custom", executablePath: customPath };
  }

  const candidates = [
    ...(profile.browserKind === "edge" ? [edgeCandidate()] : []),
    ...(profile.browserKind === "chrome" || !profile.browserKind ? [chromeCandidate()] : []),
    ...(!profile.browserKind ? [edgeCandidate()] : []),
  ].filter((candidate): candidate is BrowserResolution => candidate !== null);
  const resolved = candidates.find((candidate) => existsSync(candidate.executablePath));
  if (!resolved) {
    throw new Error("未找到 Chrome 或 Edge，请安装浏览器或配置自定义路径");
  }
  return resolved;
}

function chromeCandidate(): BrowserResolution | null {
  if (process.platform === "darwin") {
    return {
      browserKind: "chrome",
      executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    };
  }
  if (process.platform === "win32") {
    const base = process.env.PROGRAMFILES ?? "C:\\Program Files";
    return { browserKind: "chrome", executablePath: join(base, "Google", "Chrome", "Application", "chrome.exe") };
  }
  return { browserKind: "chrome", executablePath: "/usr/bin/google-chrome" };
}

function edgeCandidate(): BrowserResolution | null {
  if (process.platform === "darwin") {
    return {
      browserKind: "edge",
      executablePath: "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    };
  }
  if (process.platform === "win32") {
    const base = process.env.PROGRAMFILES ?? "C:\\Program Files (x86)";
    return { browserKind: "edge", executablePath: join(base, "Microsoft", "Edge", "Application", "msedge.exe") };
  }
  return { browserKind: "edge", executablePath: "/usr/bin/microsoft-edge" };
}

function normalizeBrowserProfileDir(profile: ChatGptDesktopProfile): string {
  const candidate = resolve(profile.browserProfileDir?.trim() || defaultBrowserProfileDir(profile.id));
  const root = resolve(browserProfilesDir);
  const pathFromRoot = relative(root, candidate);
  if (!pathFromRoot || pathFromRoot === ".." || pathFromRoot.startsWith(`..${sep}`)) {
    throw new Error("ChatGPT 浏览器 Profile 目录不合法");
  }
  return candidate;
}

async function readBrowserCookies(port: number): Promise<ChatGptPortableCookie[]> {
  const browserClient = await connectBrowserCdp(port);
  try {
    const result = await browserClient.send("Storage.getCookies");
    const cookies = isRecord(result) && Array.isArray(result.cookies) ? result.cookies : [];
    return cookies
      .map(parseCdpCookie)
      .filter((cookie): cookie is ChatGptPortableCookie => cookie !== null)
      .filter((cookie) => isOpenAiCookie(cookie.domain) && !isCloudflareCookie(cookie.name));
  } finally {
    browserClient.close();
  }
}

async function writeBrowserCookies(
  port: number,
  cookies: ChatGptPortableCookie[],
): Promise<number> {
  const allowedCookies = cookies.filter(
    (cookie) => isOpenAiCookie(cookie.domain) && !isCloudflareCookie(cookie.name),
  );
  if (allowedCookies.length === 0) {
    return 0;
  }
  const browserClient = await connectBrowserCdp(port);
  try {
    await browserClient.send("Storage.setCookies", {
      cookies: allowedCookies.map((cookie) => ({
        name: cookie.name,
        value: cookie.value,
        domain: cookie.domain,
        path: cookie.path || "/",
        secure: cookie.secure,
        httpOnly: cookie.httpOnly,
        ...(cookie.expirationDate ? { expires: cookie.expirationDate } : {}),
        ...(toCdpSameSite(cookie.sameSite) ? { sameSite: toCdpSameSite(cookie.sameSite) } : {}),
      })),
    });
    return allowedCookies.length;
  } finally {
    browserClient.close();
  }
}

async function readBrowserOriginStorage(
  port: number,
  origin: string,
): Promise<ChatGptOriginStorageSnapshot | null> {
  const page = await openDevToolsPage(port, origin);
  const client = await CdpClient.connect(page.webSocketDebuggerUrl);
  try {
    await waitForPageOrigin(client, origin);
    const value = await evaluateOnPage(
      client,
      `(() => ({
        origin: window.location.origin,
        localStorage: Object.fromEntries(Array.from({ length: localStorage.length }, (_, index) => {
          const key = localStorage.key(index);
          return key === null ? null : [key, localStorage.getItem(key) ?? ""];
        }).filter(Boolean))
      }))()`,
    );
    return parseOriginStorageSnapshot(value);
  } finally {
    client.close();
    await closeDevToolsPage(port, page.id).catch(() => undefined);
  }
}

async function writeBrowserOriginStorage(
  port: number,
  snapshot: ChatGptOriginStorageSnapshot,
): Promise<void> {
  const page = await openDevToolsPage(port, snapshot.origin);
  const client = await CdpClient.connect(page.webSocketDebuggerUrl);
  try {
    await waitForPageOrigin(client, snapshot.origin);
    await evaluateOnPage(
      client,
      `(() => {
        if (window.location.origin !== ${JSON.stringify(snapshot.origin)}) return false;
        const localItems = ${JSON.stringify(snapshot.localStorage)};
        localStorage.clear();
        for (const [key, value] of Object.entries(localItems)) localStorage.setItem(key, String(value));
        return true;
      })()`,
    );
  } finally {
    client.close();
    await closeDevToolsPage(port, page.id).catch(() => undefined);
  }
}

async function readChatGptJsonFromPage(
  pageClient: CdpClient,
  path: string,
  accessToken?: string | null,
): Promise<ChatGptApiReadResult | null> {
  try {
    const value = await evaluateOnPage(
      pageClient,
      `fetch(${JSON.stringify(path)}, {
        credentials: "include",
        headers: ${JSON.stringify({
          accept: "application/json",
          referer: `${chatGptHomeUrl}/`,
          ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
        })}
      }).then(async (response) => ({
        status: response.status,
        ok: response.ok,
        unauthorized: response.status === 401,
        forbidden: response.status === 403,
        json: response.ok ? await response.json().catch(() => null) : null
      })).catch(() => null)`,
    );
    if (!isRecord(value)) {
      return null;
    }
    const status = typeof value.status === "number" ? value.status : 0;
    if (value.unauthorized === true) return { status, unauthorized: true };
    if (value.forbidden === true) return { status, forbidden: true };
    if (value.ok !== true) return { status };
    return { status, json: value.json };
  } catch {
    return null;
  }
}

async function connectBrowserCdp(port: number): Promise<CdpClient> {
  const version = await readDevToolsVersion(port);
  return CdpClient.connect(version.webSocketDebuggerUrl);
}

async function readDevToolsVersion(port: number): Promise<DevToolsVersion> {
  const value = await readJson(`http://127.0.0.1:${port}/json/version`);
  if (!isRecord(value) || typeof value.webSocketDebuggerUrl !== "string") {
    throw new Error("浏览器调试端点不可用");
  }
  return { webSocketDebuggerUrl: value.webSocketDebuggerUrl };
}

async function openDevToolsPage(port: number, url: string): Promise<DevToolsTarget> {
  const value = await readJson(
    `http://127.0.0.1:${port}/json/new?${encodeURIComponent(url)}`,
    { method: "PUT" },
  );
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    typeof value.type !== "string" ||
    typeof value.url !== "string" ||
    typeof value.webSocketDebuggerUrl !== "string"
  ) {
    throw new Error("无法创建 ChatGPT 页面目标");
  }
  return {
    id: value.id,
    type: value.type,
    url: value.url,
    webSocketDebuggerUrl: value.webSocketDebuggerUrl,
  };
}

async function focusOrOpenChatGptPage(port: number, targetUrl = chatGptHomeUrl): Promise<void> {
  const page = await findExistingChatGptPage(port);
  if (page && targetUrl === chatGptLoginUrl && isChatGptHomePageUrl(page.url)) {
    await openDevToolsPage(port, targetUrl);
    return;
  }
  if (page) {
    await activateDevToolsPage(port, page.id);
    return;
  }
  await openDevToolsPage(port, targetUrl);
}

async function waitForExistingChatGptPage(port: number): Promise<DevToolsTarget> {
  const deadline = Date.now() + cdpStartupTimeoutMs;
  while (Date.now() < deadline) {
    const page = await findExistingChatGptPage(port).catch(() => null);
    if (page) {
      return page;
    }
    await sleep(250);
  }
  throw new Error("未找到已打开的 ChatGPT 页面，跳过静默状态检查");
}

async function findExistingChatGptPage(port: number): Promise<DevToolsTarget | null> {
  const targets = await listDevToolsPages(port);
  return targets.find((target) => isChatGptTargetUrl(target.url)) ?? null;
}

async function listDevToolsPages(port: number): Promise<DevToolsTarget[]> {
  const value = await readJson(`http://127.0.0.1:${port}/json/list`);
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map(parseDevToolsTarget)
    .filter((target): target is DevToolsTarget => target !== null && target.type === "page");
}

function parseDevToolsTarget(value: unknown): DevToolsTarget | null {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    typeof value.type !== "string" ||
    typeof value.url !== "string" ||
    typeof value.webSocketDebuggerUrl !== "string"
  ) {
    return null;
  }
  return {
    id: value.id,
    type: value.type,
    url: value.url,
    webSocketDebuggerUrl: value.webSocketDebuggerUrl,
  };
}

async function activateDevToolsPage(port: number, targetId: string): Promise<void> {
  await fetch(`http://127.0.0.1:${port}/json/activate/${encodeURIComponent(targetId)}`).catch(() => null);
}

async function closeDevToolsPage(port: number, targetId: string): Promise<void> {
  await fetch(`http://127.0.0.1:${port}/json/close/${encodeURIComponent(targetId)}`).catch(() => null);
}

async function evaluateOnPage(client: CdpClient, expression: string): Promise<unknown> {
  const result = await client.send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (!isRecord(result) || !isRecord(result.result)) {
    throw new Error("ChatGPT 页面脚本返回异常");
  }
  if ("exceptionDetails" in result) {
    throw new Error("ChatGPT 页面脚本执行失败");
  }
  return result.result.value;
}

async function waitForPageOrigin(client: CdpClient, expectedOrigin: string): Promise<void> {
  const deadline = Date.now() + cdpStartupTimeoutMs;
  while (Date.now() < deadline) {
    const origin = await evaluateOnPage(client, "window.location.origin").catch(() => null);
    if (origin === expectedOrigin) {
      return;
    }
    await sleep(250);
  }
  throw new Error(`ChatGPT 页面未能进入允许来源：${expectedOrigin}`);
}

async function readJson(url: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(url, init);
  if (!response.ok) {
    throw new Error(`浏览器调试请求失败：HTTP ${response.status}`);
  }
  return response.json() as Promise<unknown>;
}

async function waitForDevTools(port: number): Promise<void> {
  const deadline = Date.now() + cdpStartupTimeoutMs;
  while (Date.now() < deadline) {
    if (await canReachDevTools(port)) {
      return;
    }
    await sleep(250);
  }
  throw new Error("浏览器启动后无法连接调试端点");
}

async function canReachDevTools(port: number): Promise<boolean> {
  return readDevToolsVersion(port)
    .then(() => true)
    .catch(() => false);
}

async function findOpenPort(startPort: number): Promise<number> {
  for (let port = startPort; port < startPort + 1000; port += 1) {
    const available = await new Promise<boolean>((resolvePort) => {
      const server = createServer();
      server.once("error", () => resolvePort(false));
      server.once("listening", () => {
        server.close(() => resolvePort(true));
      });
      server.listen(port, "127.0.0.1");
    });
    if (available) {
      return port;
    }
  }
  throw new Error("未找到可用浏览器调试端口");
}

class CdpClient {
  private readonly pending = new Map<number, PendingCdpRequest>();
  private sequence = 1;

  private constructor(private readonly socket: WebSocket) {
    this.socket.addEventListener("message", (event) => {
      const text = typeof event.data === "string" ? event.data : "";
      if (!text) {
        return;
      }
      const message = JSON.parse(text) as CdpResponse;
      if (typeof message.id !== "number") {
        return;
      }
      const pending = this.pending.get(message.id);
      if (!pending) {
        return;
      }
      this.pending.delete(message.id);
      if (message.error) {
        pending.reject(new Error(message.error.message || "CDP 请求失败"));
        return;
      }
      pending.resolve(message.result ?? {});
    });
    this.socket.addEventListener("close", () => {
      for (const request of this.pending.values()) {
        request.reject(new Error("CDP 连接已关闭"));
      }
      this.pending.clear();
    });
  }

  static connect(url: string): Promise<CdpClient> {
    if (typeof WebSocket === "undefined") {
      return Promise.reject(new Error("当前运行环境不支持 WebSocket CDP"));
    }
    return new Promise((resolveClient, rejectClient) => {
      const socket = new WebSocket(url);
      const timer = setTimeout(() => {
        socket.close();
        rejectClient(new Error("连接浏览器调试端点超时"));
      }, cdpRequestTimeoutMs);
      socket.addEventListener("open", () => {
        clearTimeout(timer);
        resolveClient(new CdpClient(socket));
      }, { once: true });
      socket.addEventListener("error", () => {
        clearTimeout(timer);
        rejectClient(new Error("连接浏览器调试端点失败"));
      }, { once: true });
    });
  }

  send(method: string, params?: Record<string, unknown>): Promise<Record<string, unknown>> {
    const id = this.sequence;
    this.sequence += 1;
    const payload = params === undefined ? { id, method } : { id, method, params };
    return new Promise((resolveRequest, rejectRequest) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        rejectRequest(new Error("CDP 请求超时"));
      }, cdpRequestTimeoutMs);
      this.pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer);
          resolveRequest(isRecord(value) ? value : {});
        },
        reject: (error) => {
          clearTimeout(timer);
          rejectRequest(error);
        },
      });
      this.socket.send(JSON.stringify(payload));
    });
  }

  close(): void {
    this.socket.close();
  }
}

function parseCdpCookie(value: unknown): ChatGptPortableCookie | null {
  if (
    !isRecord(value) ||
    typeof value.name !== "string" ||
    typeof value.value !== "string" ||
    typeof value.domain !== "string"
  ) {
    return null;
  }
  return {
    name: value.name,
    value: value.value,
    domain: value.domain,
    path: typeof value.path === "string" ? value.path : "/",
    secure: value.secure === true,
    httpOnly: value.httpOnly === true,
    ...(typeof value.expires === "number" && value.expires > 0 ? { expirationDate: value.expires } : {}),
    ...(typeof value.sameSite === "string" ? { sameSite: value.sameSite } : {}),
  };
}

function parseOriginStorageSnapshot(value: unknown): ChatGptOriginStorageSnapshot | null {
  if (!isRecord(value) || typeof value.origin !== "string" || !isAllowedChatGptOrigin(value.origin)) {
    return null;
  }
  return {
    origin: value.origin,
    localStorage: parseStringRecord(value.localStorage),
  };
}

function parseStringRecord(value: unknown): Record<string, string> {
  if (!isRecord(value)) {
    return {};
  }
  return Object.entries(value).reduce<Record<string, string>>((record, [key, item]) => {
    if (typeof item === "string") {
      record[key] = item;
    }
    return record;
  }, {});
}

function accountIdFromAccountsCheck(value: unknown): string | null {
  if (!isRecord(value)) return null;
  const accounts = value.accounts;
  if (!isRecord(accounts)) return null;
  for (const [key, accountValue] of Object.entries(accounts)) {
    if (isBillingAccountId(key)) return key;
    if (!isRecord(accountValue)) continue;
    const account = accountValue.account;
    if (!isRecord(account)) continue;
    const accountId = account.account_id;
    if (typeof accountId === "string" && isBillingAccountId(accountId)) return accountId;
    const accountUserId = account.account_user_id;
    if (typeof accountUserId === "string") {
      const userAccountId = accountUserId.split("__").at(-1);
      if (userAccountId && isBillingAccountId(userAccountId)) return userAccountId;
    }
  }
  return null;
}

function collectBillingAccountIds(value: unknown): string[] {
  const results = new Set<string>();
  const visit = (node: unknown, depth: number) => {
    if (depth > 8 || node === null || node === undefined) return;
    if (typeof node === "string") {
      const matches = node.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi);
      for (const match of matches ?? []) {
        results.add(match);
      }
      return;
    }
    if (Array.isArray(node)) {
      for (const item of node.slice(0, 20)) {
        visit(item, depth + 1);
      }
      return;
    }
    if (!isRecord(node)) return;
    for (const child of Object.values(node)) {
      visit(child, depth + 1);
    }
  };
  visit(value, 0);
  return [...results];
}

function firstStringByKeys(candidates: unknown[], keys: string[]): string | null {
  for (const candidate of candidates) {
    const value = deepFindByKeys(candidate, keys);
    const text = readString(value);
    if (text) {
      return text;
    }
  }
  return null;
}

function deepFindByKeys(value: unknown, keys: string[], depth = 0): unknown {
  if (!isRecord(value) || depth > 4) {
    return null;
  }
  for (const key of keys) {
    if (key in value) {
      return value[key];
    }
  }
  for (const item of Object.values(value)) {
    if (Array.isArray(item)) {
      for (const child of item.slice(0, 5)) {
        const found = deepFindByKeys(child, keys, depth + 1);
        if (found !== null && found !== undefined) {
          return found;
        }
      }
      continue;
    }
    const found = deepFindByKeys(item, keys, depth + 1);
    if (found !== null && found !== undefined) {
      return found;
    }
  }
  return null;
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => typeof value === "string" && value.trim().length > 0))];
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function isBillingAccountId(accountId: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(accountId);
}

function isAllowedChatGptOrigin(origin: string): boolean {
  try {
    const parsed = new URL(origin);
    return parsed.origin === origin && isTrustedLoginHost(parsed);
  } catch {
    return false;
  }
}

function isChatGptTargetUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" && parsed.hostname === "chatgpt.com";
  } catch {
    return false;
  }
}

function isAllowedExternalProfileUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "https:") {
      return false;
    }
    return parsed.hostname === "auth.openai.com" || (parsed.hostname === "chatgpt.com" && parsed.pathname.startsWith("/apps"));
  } catch {
    return false;
  }
}

function hasKnownChatGptIdentity(profile: ChatGptDesktopProfile): boolean {
  return Boolean(profile.accountEmail || profile.accountId);
}

function isChatGptHomePageUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" && parsed.hostname === "chatgpt.com" && parsed.pathname === "/";
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
    host.endsWith(".chatgpt.com") ||
    host.endsWith(".openai.com")
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

function toCdpSameSite(value: string | undefined): "Strict" | "Lax" | "None" | null {
  if (!value) {
    return null;
  }
  const normalized = value.toLowerCase();
  if (normalized === "strict") return "Strict";
  if (normalized === "lax") return "Lax";
  if (normalized === "none" || normalized === "no_restriction") return "None";
  return null;
}

function assertSafeProfileId(profileId: string): void {
  if (!/^[a-zA-Z0-9_-]+$/.test(profileId)) {
    throw new Error("ChatGPT profile id 不合法");
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
