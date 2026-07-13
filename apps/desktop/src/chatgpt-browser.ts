import { execFile, spawn } from "node:child_process";
import { createServer } from "node:net";
import { homedir } from "node:os";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import { writeDesktopRuntimeLog } from "./runtime-log.js";

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
}

interface BrowserRuntimeMarker {
  version: 2;
  profileId: string;
  profileDir: string;
  browserKind: ChatGptBrowserKind;
  executablePath: string;
  port: number;
  pid: number | null;
  launchedAt: number;
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
  preferFastIdentity?: boolean;
  requireActive?: boolean;
}

const appDataDir = join(homedir(), ".squirrel-switch");
const browserProfilesDir = join(appDataDir, "browser-profiles");
const browserRuntimeMarkerFile = ".squirrel-switch-runtime.json";
const chatGptHomeUrl = "https://chatgpt.com";
const chatGptLoginUrl = "https://chatgpt.com/auth/login";
const chatGptStorageOrigins = ["https://chatgpt.com", "https://auth.openai.com"] as const;
const browserRuntimeByProfileId = new Map<string, BrowserRuntime>();
const loggedBrowserUrlsByProfileId = new Map<string, string>();
const navigationLogTimersByProfileId = new Map<string, NodeJS.Timeout>();
const cdpStartupTimeoutMs = 12_000;
const cdpRequestTimeoutMs = 30_000;
const chatGptPageFetchTimeoutMs = 4_000;
const navigationLogDurationMs = 180_000;

export function defaultBrowserProfileDir(profileId: string): string {
  assertSafeProfileId(profileId);
  return join(browserProfilesDir, profileId);
}

export async function openChatGptBrowserProfile(profile: ChatGptDesktopProfile): Promise<void> {
  const openUrl = hasKnownChatGptIdentity(profile) ? chatGptHomeUrl : chatGptLoginUrl;
  const runtime = await ensureBrowserRuntime(profile, { initialUrl: openUrl });
  startBrowserNavigationLog(runtime);
  await focusOrOpenChatGptPage(runtime.port, openUrl).catch(() => undefined);
}

export async function openUrlInChatGptBrowserProfile(
  profile: ChatGptDesktopProfile,
  url: string,
): Promise<void> {
  if (!isAllowedExternalProfileUrl(url)) {
    throw new Error("外部浏览器打开的链接不在允许范围内");
  }
  const runtime = await ensureBrowserRuntime(profile);
  const existingPage = await findExistingPageByUrl(runtime.port, url).catch(() => null);
  const page = existingPage ?? await openDevToolsPage(runtime.port, url);
  startBrowserNavigationLog(runtime);
  await activateDevToolsPage(runtime.port, page.id).catch(() => undefined);
}

export async function hasActiveChatGptBrowserRuntime(profile: ChatGptDesktopProfile): Promise<boolean> {
  const profileDir = normalizeBrowserProfileDir(profile);
  const runtime = await findReachableBrowserRuntime(profile, profileDir);
  if (!runtime) {
    return false;
  }
  return (await findExistingChatGptPage(runtime.port).catch(() => null)) !== null;
}

export async function hasReachableChatGptBrowserRuntime(profile: ChatGptDesktopProfile): Promise<boolean> {
  const profileDir = normalizeBrowserProfileDir(profile);
  return (await findReachableBrowserRuntime(profile, profileDir)) !== null;
}

export async function closeChatGptBrowserProfile(profile: ChatGptDesktopProfile): Promise<void> {
  const profileDir = normalizeBrowserProfileDir(profile);
  const runtime = await findReachableBrowserRuntime(profile, profileDir);
  if (!runtime) {
    return;
  }
  try {
    await closeBrowserRuntime(runtime);
  } finally {
    browserRuntimeByProfileId.delete(profile.id);
    loggedBrowserUrlsByProfileId.delete(profile.id);
    stopBrowserNavigationLog(profile.id);
    await clearBrowserRuntimeMarkerIfCurrent(runtime).catch(() => undefined);
  }
}

export async function clearChatGptBrowserProfile(profile: ChatGptDesktopProfile): Promise<void> {
  const profileDir = normalizeBrowserProfileDir(profile);
  const runtime = await findReachableBrowserRuntime(profile, profileDir);
  if (runtime) {
    throw new Error("请先关闭该 ChatGPT 浏览器窗口后再清除本机 Profile 数据");
  }
  browserRuntimeByProfileId.delete(profile.id);
  loggedBrowserUrlsByProfileId.delete(profile.id);
  stopBrowserNavigationLog(profile.id);
  await rm(profileDir, { recursive: true, force: true });
}

export async function exportChatGptBrowserSession(
  profile: ChatGptDesktopProfile,
): Promise<ChatGptBrowserSessionSnapshot> {
  const runtime = await ensureBrowserRuntime(profile);
  const cookies = await readBrowserCookies(runtime);
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
  const cookies = await readBrowserCookies(runtime);
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
    const pageSession = await readChatGptPageSessionState(pageClient);
    const timezoneOffsetMin = new Date().getTimezoneOffset();
    const normalizedSavedAccountId =
      typeof savedAccountId === "string" && savedAccountId.trim() && isBillingAccountId(savedAccountId.trim())
        ? savedAccountId.trim()
        : null;
    const subscriptionPath = (accountId: string) =>
      `/backend-api/subscriptions?account_id=${encodeURIComponent(accountId)}`;
    const authSession = await readChatGptJsonFromPage(pageClient, "/api/auth/session");
    const accessToken = firstStringByKeys([authSession?.json], ["accessToken"]);
    if (options.preferFastIdentity === true && hasChatGptIdentity(authSession?.json)) {
      return {
        pageSession,
        authSession,
        accountCheck: null,
        resolvedAccountId: normalizedSavedAccountId,
        subscription: null,
      };
    }
    const savedSubscription = normalizedSavedAccountId
      ? await readChatGptJsonFromPage(pageClient, subscriptionPath(normalizedSavedAccountId), accessToken)
      : null;
    if (savedSubscription?.json) {
      return {
        pageSession,
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
      pageSession,
      authSession,
      accountCheck,
      resolvedAccountId: subscriptionAccountId,
      subscription: fallbackSubscription ?? savedSubscription,
    };
  } finally {
    pageClient.close();
  }
}

async function readChatGptPageSessionState(pageClient: CdpClient): Promise<{
  sessionExpired: boolean;
  loginRequired: boolean;
  hasAccessToken: boolean | null;
}> {
  const value = await evaluateOnPage(
    pageClient,
    `(
      async () => {
        const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        let text = "";
        for (let attempt = 0; attempt < 12; attempt += 1) {
          text = document.body?.innerText || "";
          if (/你的会话已过期|Your session has expired|请重新登录以继续使用此应用|Please log in again to continue using this app/i.test(text)) {
            break;
          }
          if (text.length > 800 && !/Loading|正在加载|请稍候|Just a moment/i.test(text)) {
            break;
          }
          await sleep(500);
        }
        let hasAccessToken = null;
        try {
          const controller = new AbortController();
          const timer = window.setTimeout(() => controller.abort(), ${chatGptPageFetchTimeoutMs});
          try {
            const response = await fetch("/api/auth/session", { credentials: "include", signal: controller.signal });
            const json = response.ok ? await response.json().catch(() => null) : null;
            hasAccessToken = Boolean(json && typeof json === "object" && typeof json.accessToken === "string" && json.accessToken.length > 0);
          } finally {
            window.clearTimeout(timer);
          }
        } catch {
          hasAccessToken = null;
        }
        const compact = text.replace(/\\s+/g, " ").trim();
        return {
          sessionExpired: /你的会话已过期|Your session has expired|请重新登录以继续使用此应用|Please log in again to continue using this app/i.test(text),
          loginRequired: /登录|Log in|Sign in/i.test(compact.slice(0, 1200)),
          hasAccessToken,
        };
      }
    )()`,
  );
  if (!isRecord(value)) {
    return { sessionExpired: false, loginRequired: false, hasAccessToken: null };
  }
  return {
    sessionExpired: value.sessionExpired === true,
    loginRequired: value.loginRequired === true,
    hasAccessToken: typeof value.hasAccessToken === "boolean" ? value.hasAccessToken : null,
  };
}

export async function evaluateInChatGptBrowserProfile(
  profile: ChatGptDesktopProfile,
  expression: string,
  options: BrowserRuntimeOptions = {},
): Promise<unknown> {
  if (options.requireActive === true && !(await hasActiveChatGptBrowserRuntime(profile))) {
    throw new Error("ChatGPT Profile 当前未打开");
  }
  const browserOptions: BrowserRuntimeOptions = {
    initialUrl: options.initialUrl,
    preferFastIdentity: options.preferFastIdentity,
  };
  const runtime = await ensureBrowserRuntime(profile, browserOptions);
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const page = await waitForExistingChatGptPage(runtime.port);
    const pageClient = await CdpClient.connect(page.webSocketDebuggerUrl);
    try {
      await waitForPageOrigin(pageClient, "https://chatgpt.com");
      return await evaluateOnPage(pageClient, expression);
    } catch (error) {
      lastError = error;
      if (!isRetriableCdpError(error) || attempt === 2) {
        throw error;
      }
      await sleep(500);
    } finally {
      pageClient.close();
    }
  }
  throw lastError instanceof Error ? lastError : new Error("ChatGPT 页面脚本执行失败");
}

export async function evaluateInTrustedChatGptBrowserProfilePage(
  profile: ChatGptDesktopProfile,
  expression: string,
  options: BrowserRuntimeOptions & { preferredUrl?: string } = {},
): Promise<unknown> {
  if (options.requireActive === true && !(await hasActiveTrustedBrowserPage(profile))) {
    throw new Error("ChatGPT Profile 当前未打开");
  }
  const preferredUrl = options.preferredUrl;
  const browserOptions: BrowserRuntimeOptions = {
    initialUrl: options.initialUrl,
    preferFastIdentity: options.preferFastIdentity,
  };
  const runtime = await ensureBrowserRuntime(profile, browserOptions);
  const page = await waitForExistingTrustedPage(runtime.port, preferredUrl);
  const pageClient = await CdpClient.connect(page.webSocketDebuggerUrl);
  try {
    return await evaluateOnPage(pageClient, expression);
  } finally {
    pageClient.close();
  }
}

async function hasActiveTrustedBrowserPage(profile: ChatGptDesktopProfile): Promise<boolean> {
  const profileDir = normalizeBrowserProfileDir(profile);
  const runtime = await findReachableBrowserRuntime(profile, profileDir);
  if (!runtime) {
    return false;
  }
  return (await findExistingTrustedPage(runtime.port).catch(() => null)) !== null;
}

async function ensureBrowserRuntime(
  profile: ChatGptDesktopProfile,
  options: BrowserRuntimeOptions = {},
): Promise<BrowserRuntime> {
  const initialUrl = options.initialUrl ?? chatGptHomeUrl;
  const profileDir = normalizeBrowserProfileDir(profile);
  const recovered = await findReachableBrowserRuntime(profile, profileDir);
  if (recovered) {
    return recovered;
  }

  await mkdir(profileDir, { recursive: true, mode: 0o700 });
  const browser = resolveBrowser(profile);
  const port = await findOpenPort(43000);
  const args = [
    `--user-data-dir=${profileDir}`,
    `--remote-debugging-port=${port}`,
    "--remote-debugging-address=127.0.0.1",
    "--no-first-run",
    "--new-window",
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
  };
  child.once("exit", () => {
    const current = browserRuntimeByProfileId.get(profile.id);
    if (current?.port === port) {
      browserRuntimeByProfileId.delete(profile.id);
      void clearBrowserRuntimeMarkerIfCurrent(runtime).catch(() => undefined);
    }
  });
  await waitForDevTools(port).catch((error) => {
    browserRuntimeByProfileId.delete(profile.id);
    throw new Error(
      `${errorMessage(error)}。如果该 ChatGPT Profile 已在浏览器中打开，请关闭对应窗口后重试`,
    );
  });
  browserRuntimeByProfileId.set(profile.id, runtime);
  await writeBrowserRuntimeMarker(runtime).catch(() => undefined);
  return runtime;
}

async function findReachableBrowserRuntime(
  profile: ChatGptDesktopProfile,
  profileDir: string,
): Promise<BrowserRuntime | null> {
  const existing = browserRuntimeByProfileId.get(profile.id);
  if (existing && runtimeMatches(existing, profileDir)) {
    if (await canReachDevTools(existing.port)) {
      return existing;
    }
    browserRuntimeByProfileId.delete(profile.id);
  }

  const persisted = await readBrowserRuntimeMarker(profile.id, profileDir);
  if (persisted && runtimeMatches(persisted, profileDir)) {
    if (await canReachDevTools(persisted.port)) {
      browserRuntimeByProfileId.set(profile.id, persisted);
      return persisted;
    }
    await clearBrowserRuntimeMarkerIfCurrent(persisted).catch(() => undefined);
  }

  const processRuntime = await findBrowserRuntimeFromProcessList(profile, profileDir);
  if (processRuntime) {
    browserRuntimeByProfileId.set(profile.id, processRuntime);
    await writeBrowserRuntimeMarker(processRuntime).catch(() => undefined);
    return processRuntime;
  }

  return null;
}

function runtimeMatches(runtime: BrowserRuntime, profileDir: string): boolean {
  return resolve(runtime.profileDir) === profileDir;
}

async function findBrowserRuntimeFromProcessList(
  profile: ChatGptDesktopProfile,
  profileDir: string,
): Promise<BrowserRuntime | null> {
  if (process.platform === "win32") {
    return null;
  }

  const output = await execFileText("ps", ["-axo", "pid=,command="]).catch(() => null);
  if (!output) {
    return null;
  }

  const userDataArg = `--user-data-dir=${profileDir}`;
  for (const line of output.split("\n")) {
    if (!line.includes(userDataArg)) {
      continue;
    }
    const pidMatch = line.trimStart().match(/^(\d+)\s+(.*)$/);
    const portMatch = line.match(/--remote-debugging-port=(\d+)/);
    if (!pidMatch || !portMatch) {
      continue;
    }
    const command = pidMatch[2];
    if (command.includes(" --type=")) {
      continue;
    }
    const port = Number(portMatch[1]);
    if (
      !Number.isInteger(port) ||
      port <= 0 ||
      port > 65535 ||
      command.includes("--head" + "less")
    ) {
      continue;
    }
    if (!(await canReachDevTools(port))) {
      continue;
    }
    return {
      profileId: profile.id,
      profileDir,
      browserKind: inferBrowserKindFromCommand(profile, command),
      executablePath: inferBrowserExecutablePath(profile, command),
      port,
      pid: Number(pidMatch[1]),
      launchedAt: Date.now(),
    };
  }

  return null;
}

function execFileText(file: string, args: string[]): Promise<string> {
  return new Promise((resolveText, rejectText) => {
    execFile(file, args, { timeout: 1500, maxBuffer: 1024 * 1024 }, (error, stdout) => {
      if (error) {
        rejectText(error);
        return;
      }
      resolveText(stdout);
    });
  });
}

function inferBrowserKindFromCommand(
  profile: ChatGptDesktopProfile,
  command: string,
): ChatGptBrowserKind {
  if (profile.browserKind) {
    return profile.browserKind;
  }
  return command.includes("Microsoft Edge") ? "edge" : "chrome";
}

function inferBrowserExecutablePath(profile: ChatGptDesktopProfile, command: string): string {
  if (profile.browserExecutablePath?.trim()) {
    return profile.browserExecutablePath.trim();
  }
  const userDataIndex = command.indexOf(" --user-data-dir=");
  if (userDataIndex > 0) {
    return command.slice(0, userDataIndex).replace(/^\d+\s+/, "").trim();
  }
  return resolveBrowser(profile).executablePath;
}

async function closeBrowserRuntime(runtime: BrowserRuntime): Promise<void> {
  if (!(await canReachDevTools(runtime.port))) {
    return;
  }
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

async function readBrowserRuntimeMarker(
  profileId: string,
  profileDir: string,
): Promise<BrowserRuntime | null> {
  const text = await readFile(runtimeMarkerPath(profileDir), "utf8").catch(() => null);
  if (!text) {
    return null;
  }
  try {
    return parseBrowserRuntimeMarker(JSON.parse(text), profileId, profileDir);
  } catch {
    return null;
  }
}

function parseBrowserRuntimeMarker(
  value: unknown,
  profileId: string,
  profileDir: string,
): BrowserRuntime | null {
  const version = isRecord(value) ? value.version : null;
  if (
    !isRecord(value) ||
    (version !== 1 && version !== 2) ||
    value.profileId !== profileId ||
    resolve(String(value.profileDir ?? "")) !== profileDir ||
    !isBrowserKind(value.browserKind) ||
    typeof value.executablePath !== "string" ||
    typeof value.port !== "number" ||
    !Number.isInteger(value.port) ||
    value.port <= 0 ||
    value.port > 65535 ||
    !(typeof value.pid === "number" || value.pid === null) ||
    typeof value.launchedAt !== "number"
  ) {
    return null;
  }
  if (version === 1 && value["head" + "less"] !== false) {
    return null;
  }
  return {
    profileId,
    profileDir,
    browserKind: value.browserKind,
    executablePath: value.executablePath,
    port: value.port,
    pid: value.pid,
    launchedAt: value.launchedAt,
  };
}

async function writeBrowserRuntimeMarker(runtime: BrowserRuntime): Promise<void> {
  const marker: BrowserRuntimeMarker = {
    version: 2,
    profileId: runtime.profileId,
    profileDir: runtime.profileDir,
    browserKind: runtime.browserKind,
    executablePath: runtime.executablePath,
    port: runtime.port,
    pid: runtime.pid,
    launchedAt: runtime.launchedAt,
  };
  await writeFile(runtimeMarkerPath(runtime.profileDir), `${JSON.stringify(marker)}\n`, { mode: 0o600 });
}

async function clearBrowserRuntimeMarkerIfCurrent(runtime: BrowserRuntime): Promise<void> {
  const marker = await readBrowserRuntimeMarker(runtime.profileId, runtime.profileDir);
  if (!marker || marker.port !== runtime.port) {
    return;
  }
  await unlink(runtimeMarkerPath(runtime.profileDir)).catch(() => undefined);
}

function runtimeMarkerPath(profileDir: string): string {
  return join(profileDir, browserRuntimeMarkerFile);
}

function isBrowserKind(value: unknown): value is ChatGptBrowserKind {
  return value === "chrome" || value === "edge" || value === "custom";
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

async function readBrowserCookies(runtime: BrowserRuntime): Promise<ChatGptPortableCookie[]> {
  return readBrowserCookiesFromBrowserTarget(runtime.port);
}

async function readBrowserCookiesFromBrowserTarget(port: number): Promise<ChatGptPortableCookie[]> {
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
      `(
        async () => {
          const controller = new AbortController();
          const timer = window.setTimeout(() => controller.abort(), ${chatGptPageFetchTimeoutMs});
          try {
            const response = await fetch(${JSON.stringify(path)}, {
              credentials: "include",
              signal: controller.signal,
              headers: ${JSON.stringify({
                accept: "application/json",
                referer: `${chatGptHomeUrl}/`,
                ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
              })}
            });
            return {
              status: response.status,
              ok: response.ok,
              unauthorized: response.status === 401,
              forbidden: response.status === 403,
              json: response.ok ? await response.json().catch(() => null) : null
            };
          } catch {
            return null;
          } finally {
            window.clearTimeout(timer);
          }
        }
      )()`,
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
  throw new Error("未找到已打开的 ChatGPT 页面，跳过浏览器状态检查");
}

async function waitForExistingTrustedPage(port: number, preferredUrl?: string): Promise<DevToolsTarget> {
  const deadline = Date.now() + cdpStartupTimeoutMs;
  const preferred = preferredUrl?.trim() || null;
  while (Date.now() < deadline) {
    const pages = await listDevToolsPages(port).catch(() => []);
    const page =
      pages.find((target) => preferred !== null && target.url === preferred) ??
      pages.find((target) => isTrustedBrowserTargetUrl(target.url));
    if (page) return page;
    await sleep(250);
  }
  throw new Error("未找到已打开的 ChatGPT 或 OpenAI 授权页面");
}

async function findExistingChatGptPage(port: number): Promise<DevToolsTarget | null> {
  const targets = await listDevToolsPages(port);
  return targets.find((target) => isChatGptTargetUrl(target.url)) ?? null;
}

async function findExistingTrustedPage(port: number): Promise<DevToolsTarget | null> {
  const targets = await listDevToolsPages(port);
  return targets.find((target) => isTrustedBrowserTargetUrl(target.url)) ?? null;
}

async function findExistingPageByUrl(port: number, url: string): Promise<DevToolsTarget | null> {
  const targets = await listDevToolsPages(port);
  return targets.find((target) => target.url === url) ?? null;
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

function startBrowserNavigationLog(runtime: BrowserRuntime): void {
  stopBrowserNavigationLog(runtime.profileId);
  const startedAt = Date.now();

  const tick = async () => {
    const current = browserRuntimeByProfileId.get(runtime.profileId);
    if (
      current?.port !== runtime.port ||
      Date.now() - startedAt > navigationLogDurationMs ||
      !(await canReachDevTools(runtime.port).catch(() => false))
    ) {
      stopBrowserNavigationLog(runtime.profileId);
      return;
    }

    await logCurrentBrowserUrls(runtime).catch(() => undefined);
    const timer = setTimeout(() => void tick(), 1000);
    timer.unref();
    navigationLogTimersByProfileId.set(runtime.profileId, timer);
  };

  void tick();
}

function stopBrowserNavigationLog(profileId: string): void {
  const timer = navigationLogTimersByProfileId.get(profileId);
  if (timer) {
    clearTimeout(timer);
    navigationLogTimersByProfileId.delete(profileId);
  }
}

async function logCurrentBrowserUrls(runtime: BrowserRuntime): Promise<void> {
  const urls = (await listDevToolsPages(runtime.port))
    .map((page) => sanitizeUrlForRuntimeLog(page.url))
    .filter((url): url is string => url !== null)
    .sort();
  if (urls.length === 0) {
    return;
  }

  const value = urls.join(", ");
  if (loggedBrowserUrlsByProfileId.get(runtime.profileId) === value) {
    return;
  }
  loggedBrowserUrlsByProfileId.set(runtime.profileId, value);
  await writeDesktopRuntimeLog("info", "chatgpt-browser", `ChatGPT 受控浏览器导航：${value}`);
}

function sanitizeUrlForRuntimeLog(value: string): string | null {
  try {
    const parsed = new URL(value);
    if (isCodexLoginCallbackUrl(parsed)) {
      return `${parsed.hostname}${parsed.pathname}`;
    }
    if (parsed.protocol !== "https:" || !isTrustedLoginHost(parsed)) {
      return null;
    }
    return `${parsed.hostname}${parsed.pathname}`;
  } catch {
    return null;
  }
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
    throw new Error(`ChatGPT 页面脚本执行失败：${JSON.stringify(result.exceptionDetails).slice(0, 300)}`);
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

function hasChatGptIdentity(value: unknown): boolean {
  return Boolean(
    hasAccessToken(value) ||
      firstStringByKeys([value], ["email", "account_email", "accountEmail", "name", "display_name", "displayName"]),
  );
}

function hasAccessToken(value: unknown): boolean {
  return isRecord(value) && typeof value.accessToken === "string" && value.accessToken.length > 0;
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

function isTrustedBrowserTargetUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return isTrustedLoginHost(parsed) || isCodexLoginCallbackUrl(parsed);
  } catch {
    return false;
  }
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
    host === "login.openai.com" ||
    host === "platform.openai.com" ||
    host.endsWith(".chatgpt.com") ||
    host.endsWith(".openai.com")
  );
}

function isCodexLoginCallbackUrl(url: URL): boolean {
  return (
    (url.hostname === "localhost" || url.hostname === "127.0.0.1") &&
    url.pathname === "/auth/callback"
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

function isRetriableCdpError(error: unknown): boolean {
  const message = errorMessage(error);
  return (
    message.includes("CDP 连接已关闭") ||
    message.includes("Execution context was destroyed") ||
    message.includes("Cannot find context") ||
    message.includes("Target closed")
  );
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
