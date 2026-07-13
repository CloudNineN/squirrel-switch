import { evaluateInChatGptBrowserProfile } from "./chatgpt-browser.js";
import type { ChatGptDesktopProfile } from "./chatgpt-browser.js";
import {
  clearChatGptBrowserTaskNotice,
  showChatGptBrowserTaskNotice,
} from "./chatgpt-browser-task-notice.js";

type DesktopSecretConfig = ChatGptAppConfigView & { oauthPassword: string | null };
type CheckOptions = { requireActive?: boolean };
type NoticeUpdater = (message: string, blocking?: boolean) => Promise<void>;

interface ChatGptAppConfigView {
  id: string;
  type: "official_app" | "custom_mcp";
  name: string;
  description: string | null;
  officialAppUrl: string | null;
  officialAppId: string | null;
  mcpServerUrl: string | null;
  authType: "none" | "bearer" | "oauth" | "official" | "unknown";
}

interface ChatGptAppConnectorLinkView {
  id: string | null;
  name: string | null;
  connectorId: string | null;
  connectorName: string | null;
  connectorType: string | null;
  authStatus: string | null;
  authType: string | null;
  visibility: string | null;
  baseUrl: string | null;
  service: string | null;
}

interface ChatGptAppSyncCheckResult {
  checkedAt: number;
  links: ChatGptAppConnectorLinkView[];
}

interface ChatGptAppConfigureResult {
  configured: boolean;
  checkedAt: number;
  message: string | null;
  links: ChatGptAppConnectorLinkView[];
}

interface AuthMetadata {
  authorization_endpoint: string;
  token_endpoint: string;
  issuer: string;
  registration_endpoint?: string | null;
  scopes_supported?: string[] | null;
  token_endpoint_auth_methods_supported?: string[] | null;
  code_challenge_methods_supported?: string[] | null;
}

interface ProtectedResourceMetadata {
  authorization_servers?: string[];
  resource?: string;
  bearer_methods_supported?: string[];
}

export async function checkChatGptAppSync(
  profile: ChatGptDesktopProfile,
  options: CheckOptions = {},
): Promise<ChatGptAppSyncCheckResult> {
  await showChatGptBrowserTaskNotice(
    profile,
    {
      message: "Squirrel Switch 正在检测 ChatGPT 应用同步状态",
      blocking: false,
    },
    { requireActive: options.requireActive === true },
  );
  try {
    return {
      checkedAt: nowSeconds(),
      links: await readConnectorLinks(profile, { requireActive: options.requireActive }),
    };
  } finally {
    await clearChatGptBrowserTaskNotice(profile);
  }
}

export async function configureChatGptAppSync(
  profile: ChatGptDesktopProfile,
  configId: string,
  serverOrigin: string,
  bridgeToken: string,
): Promise<ChatGptAppConfigureResult> {
  const updateNotice: NoticeUpdater = (message, blocking = true) =>
    showChatGptBrowserTaskNotice(profile, { message, blocking });
  await updateNotice("Squirrel Switch 正在准备 ChatGPT 应用配置，请暂时不要关闭此窗口");
  try {
    const config = await readDesktopConfig(serverOrigin, bridgeToken, configId);
    await updateNotice("Squirrel Switch 正在读取 ChatGPT 应用状态，请暂时不要关闭此窗口");
    const existing = findMatchingLink(await readConnectorLinks(profile), config);
    if (existing && isActiveLink(existing)) {
      return {
        configured: true,
        checkedAt: nowSeconds(),
        message: "ChatGPT 已存在该应用配置",
        links: await readConnectorLinks(profile),
      };
    }

    let oauthCompleted = false;
    if (config.type === "custom_mcp") {
      oauthCompleted = await createMcpConnector(profile, config, updateNotice);
    } else {
      await connectOfficialApp(profile, config, updateNotice);
    }

    await updateNotice("Squirrel Switch 正在确认 ChatGPT 应用同步结果，请暂时不要关闭此窗口");
    const links = await readConnectorLinks(profile);
    const matched = findMatchingLink(links, config);
    return {
      configured: Boolean(matched),
      checkedAt: nowSeconds(),
      message: matched
        ? oauthCompleted
          ? "应用配置已写入 ChatGPT，OAuth 授权已完成"
          : "应用配置已写入 ChatGPT"
        : "已尝试配置，但 ChatGPT 未返回可匹配的应用",
      links,
    };
  } finally {
    await clearChatGptBrowserTaskNotice(profile);
  }
}

export function findMatchingLink(
  links: ChatGptAppConnectorLinkView[],
  config: ChatGptAppConfigView,
): ChatGptAppConnectorLinkView | null {
  if (config.type === "custom_mcp") {
    const target = normalizeUrl(config.mcpServerUrl);
    if (!target) return null;
    return links.find((link) => link.connectorType === "MCP" && normalizeUrl(link.baseUrl) === target) ?? null;
  }

  const officialId = normalizeText(config.officialAppId);
  if (officialId) {
    const byId = links.find((link) => link.connectorId === officialId || link.id === officialId);
    if (byId) return byId;
  }
  const urlId = connectorIdFromUrl(config.officialAppUrl);
  if (urlId) {
    const byUrl = links.find((link) => link.connectorId === urlId || link.id === urlId);
    if (byUrl) return byUrl;
  }
  const name = normalizeText(config.name)?.toLowerCase();
  return name
    ? links.find((link) => normalizeText(link.connectorName ?? link.name)?.toLowerCase() === name) ?? null
    : null;
}

async function readConnectorLinks(
  profile: ChatGptDesktopProfile,
  options: { requireActive?: boolean } = {},
): Promise<ChatGptAppConnectorLinkView[]> {
  const value = await evaluateInChatGptBrowserProfile(
    profile,
    `(${readConnectorLinksInPage.toString()})()`,
    { requireActive: options.requireActive === true },
  );
  if (isRecord(value) && typeof value.error === "string") {
    throw new Error(value.error);
  }
  if (!Array.isArray(value)) {
    throw new Error("ChatGPT 连接器列表读取失败");
  }
  return value.map(parseConnectorLink).filter((link): link is ChatGptAppConnectorLinkView => link !== null);
}

async function createMcpConnector(
  profile: ChatGptDesktopProfile,
  config: DesktopSecretConfig,
  updateNotice?: NoticeUpdater,
): Promise<boolean> {
  if (!config.mcpServerUrl) {
    throw new Error("自定义 MCP 缺少 Server URL");
  }
  if (config.authType === "bearer") {
    throw new Error("Bearer MCP 自动配置暂未支持，请改用 OAuth 或无认证 MCP");
  }
  if (config.authType === "oauth" && !config.oauthPassword) {
    throw new Error("该 MCP 使用 OAuth，但未保存授权密码");
  }
  let metadata: { auth: AuthMetadata; resource: ProtectedResourceMetadata } | null = null;
  if (config.authType === "oauth") {
    await updateNotice?.("Squirrel Switch 正在读取 MCP OAuth 元数据，请暂时不要关闭此窗口");
    metadata = await discoverMcpOAuth(config.mcpServerUrl);
  }
  const payload = {
    name: config.name,
    mcp_url: config.mcpServerUrl,
    description: config.description ?? config.name,
    logo_url: null,
    auth_request: metadata
      ? {
          supported_auth: [
            {
              type: "OAUTH",
              authorization_url: metadata.auth.authorization_endpoint,
              token_url: metadata.auth.token_endpoint,
              registration_url: metadata.auth.registration_endpoint ?? null,
              revocation_url: null,
              custom_redirect_url_params: null,
              custom_token_request_params: null,
              pkce_required: true,
              pkce_methods: metadata.auth.code_challenge_methods_supported ?? ["S256"],
              allow_http_redirect: true,
              supports_domain_restriction: false,
              authorization_server_base: metadata.auth.issuer,
              base_scopes: [],
              default_scopes: [],
              resource: metadata.resource.resource ?? metadata.auth.issuer,
              scopes_supported: metadata.auth.scopes_supported ?? null,
              token_endpoint_auth_methods_supported: metadata.auth.token_endpoint_auth_methods_supported ?? ["none"],
              oidc_configuration_url: null,
              oidc_enabled: false,
              use_cimd: null,
              oidc_scopes_supported: null,
              oidc_userinfo_endpoint: null,
              client_id_metadata_document_supported: null,
            },
          ],
          oauth_client_params: {
            client_id: "chatgpt-squirrel-switch",
            client_secret: "",
            token_endpoint_auth_method: "none",
          },
        }
      : {
          supported_auth: [],
          oauth_client_params: null,
        },
  };
  await ensureChatGptDeveloperMode(profile, updateNotice);
  await updateNotice?.("Squirrel Switch 正在创建或复用 ChatGPT MCP 应用，请暂时不要关闭此窗口");
  let result = await runChatGptBackendRequest(profile, "/backend-api/aip/connectors/mcp", {
    method: "POST",
    body: payload,
  });
  if (isDeveloperModeRequired(result)) {
    await ensureChatGptDeveloperMode(profile, updateNotice, true);
    await updateNotice?.("Squirrel Switch 正在重新创建 ChatGPT MCP 应用，请暂时不要关闭此窗口");
    result = await runChatGptBackendRequest(profile, "/backend-api/aip/connectors/mcp", {
      method: "POST",
      body: payload,
    });
  }
  const connectorId = findConnectorId(result.json);
  if (result.status === 409) {
    if (!connectorId) {
      throw new Error(responseError(result, "ChatGPT 已存在同 URL MCP，但未返回应用 ID"));
    }
  } else if (result.status < 200 || result.status >= 300) {
    throw new Error(responseError(result, "ChatGPT MCP 自动配置失败"));
  }
  if (config.authType !== "oauth" || !config.oauthPassword) {
    return false;
  }
  if (!connectorId) {
    throw new Error("ChatGPT MCP 自动配置失败：未返回应用 ID");
  }
  await updateNotice?.("Squirrel Switch 正在发起 ChatGPT MCP OAuth 连接，请暂时不要关闭此窗口");
  const authorizeUrl = await createChatGptOAuthLink(profile, connectorId, config.name);
  if (!authorizeUrl) {
    throw new Error("ChatGPT MCP OAuth 连接初始化失败：未返回授权地址");
  }
  await updateNotice?.("Squirrel Switch 正在提交 MCP OAuth 授权，请暂时不要关闭此窗口");
  const callbackUrl = await authorizeMcpWithPassword(authorizeUrl, config.oauthPassword);
  await updateNotice?.("Squirrel Switch 正在后台完成 ChatGPT OAuth 回调", false);
  await completeChatGptOAuthCallback(profile, callbackUrl);
  await updateNotice?.("Squirrel Switch 正在确认 MCP 连接状态，请暂时不要关闭此窗口");
  await waitForMatchingMcpLink(profile, config.mcpServerUrl);
  await leaveChatGptOAuthCallbackPage(profile);
  return true;
}

async function connectOfficialApp(
  profile: ChatGptDesktopProfile,
  config: DesktopSecretConfig,
  updateNotice?: NoticeUpdater,
): Promise<void> {
  const connectorId = normalizeText(config.officialAppId) ?? connectorIdFromUrl(config.officialAppUrl);
  if (!connectorId) {
    throw new Error("官方应用缺少可识别的应用 ID");
  }
  await updateNotice?.("Squirrel Switch 正在连接 ChatGPT 官方应用，请暂时不要关闭此窗口");
  const candidates = [
    { path: "/backend-api/aip/connectors/links", body: { connector_id: connectorId } },
    { path: "/backend-api/aip/connectors/links/create", body: { connector_id: connectorId } },
    { path: `/backend-api/aip/connectors/${encodeURIComponent(connectorId)}/links`, body: {} },
  ];
  let lastError = "官方应用自动连接接口不可用";
  for (const candidate of candidates) {
    const result = await runChatGptBackendRequest(profile, candidate.path, {
      method: "POST",
      body: candidate.body,
    });
    if (result.status >= 200 && result.status < 300) {
      return;
    }
    lastError = responseError(result, lastError);
  }
  throw new Error(lastError);
}

async function ensureChatGptDeveloperMode(
  profile: ChatGptDesktopProfile,
  updateNotice?: NoticeUpdater,
  force = false,
): Promise<void> {
  if (!force) {
    await updateNotice?.("Squirrel Switch 正在确认 ChatGPT 开发人员模式，请暂时不要关闭此窗口");
    const current = await runChatGptBackendRequest(profile, "/backend-api/settings/user", { method: "GET" });
    if (current.status >= 200 && current.status < 300 && readDeveloperModeEnabled(current.json) === true) {
      return;
    }
  }

  await updateNotice?.("Squirrel Switch 正在开启 ChatGPT 开发人员模式，请暂时不要关闭此窗口");
  const enable = await runChatGptBackendRequest(
    profile,
    "/backend-api/settings/account_user_setting?feature=developer_mode&value=true",
    { method: "PATCH" },
  );
  if (enable.status < 200 || enable.status >= 300) {
    throw new Error(responseError(enable, "ChatGPT 开发人员模式自动开启失败"));
  }
  if (readDeveloperModeEnabled(enable.json) === true) {
    return;
  }

  const verified = await runChatGptBackendRequest(profile, "/backend-api/settings/user", { method: "GET" });
  if (verified.status >= 200 && verified.status < 300 && readDeveloperModeEnabled(verified.json) === true) {
    return;
  }
  throw new Error("ChatGPT 开发人员模式自动开启失败：接口未确认已开启");
}

async function runChatGptBackendRequest(
  profile: ChatGptDesktopProfile,
  path: string,
  request: { method: "GET" | "POST" | "PATCH"; body?: unknown },
): Promise<{ status: number; json: unknown }> {
  const value = await evaluateInChatGptBrowserProfile(
    profile,
    `(${backendRequestInPage.toString()})(${JSON.stringify(path)}, ${JSON.stringify(request)})`,
  );
  if (!isRecord(value) || typeof value.status !== "number") {
    throw new Error("ChatGPT 接口返回异常");
  }
  return { status: value.status, json: value.json };
}

async function createChatGptOAuthLink(
  profile: ChatGptDesktopProfile,
  connectorId: string,
  name: string,
): Promise<string | null> {
  const result = await runChatGptBackendRequest(profile, "/backend-api/aip/connectors/links/oauth", {
    method: "POST",
    body: {
      connector_id: connectorId,
      name,
      callback_url: "https://chatgpt.com/connector/oauth",
    },
  });
  if (result.status < 200 || result.status >= 300) {
    throw new Error(responseError(result, "ChatGPT MCP OAuth 连接初始化失败"));
  }
  return readOAuthAuthorizeUrl(result.json);
}

async function readDesktopConfig(
  serverOrigin: string,
  bridgeToken: string,
  configId: string,
): Promise<DesktopSecretConfig> {
  const response = await fetch(`${serverOrigin}/api/platforms/chatgpt/app-configs/${encodeURIComponent(configId)}/desktop-secret`, {
    headers: { "x-squirrel-desktop-token": bridgeToken },
  });
  if (!response.ok) {
    throw new Error(`读取应用配置失败：HTTP ${response.status}`);
  }
  const payload = (await response.json()) as { data?: DesktopSecretConfig };
  if (!payload.data) {
    throw new Error("读取应用配置失败");
  }
  return payload.data;
}

async function discoverMcpOAuth(mcpUrl: string): Promise<{ auth: AuthMetadata; resource: ProtectedResourceMetadata }> {
  const url = new URL(mcpUrl);
  const origin = url.origin;
  const resourceResponse = await fetch(`${origin}/.well-known/oauth-protected-resource`);
  const resource = resourceResponse.ok ? await resourceResponse.json() as ProtectedResourceMetadata : {};
  const authBase = resource.authorization_servers?.[0] ?? origin;
  const authResponse = await fetch(`${authBase}/.well-known/oauth-authorization-server`);
  if (!authResponse.ok) {
    throw new Error("MCP OAuth 元数据读取失败");
  }
  const auth = await authResponse.json() as AuthMetadata;
  if (!auth.authorization_endpoint || !auth.token_endpoint || !auth.issuer) {
    throw new Error("MCP OAuth 元数据不完整");
  }
  return { auth, resource };
}

async function authorizeMcpWithPassword(authorizeUrl: string, password: string): Promise<string> {
  const parsed = new URL(authorizeUrl);
  const authorizePage = await fetch(authorizeUrl, {
    headers: { accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8" },
    redirect: "manual",
  });
  if (authorizePage.status < 200 || authorizePage.status >= 300) {
    throw new Error(`MCP OAuth 授权页打开失败：HTTP ${authorizePage.status}`);
  }
  const cookie = cookieHeaderFromResponse(authorizePage);
  const body = new URLSearchParams(parsed.searchParams);
  body.set("password", password);
  const response = await fetch(`${parsed.origin}${parsed.pathname}`, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      origin: parsed.origin,
      referer: authorizeUrl,
      ...(cookie ? { cookie } : {}),
    },
    body,
    redirect: "manual",
  });
  const location = response.headers.get("location");
  if (response.status < 300 || response.status >= 400 || !location) {
    throw new Error(`MCP OAuth 授权失败：HTTP ${response.status}`);
  }
  const callbackUrl = new URL(location, parsed).toString();
  const callback = new URL(callbackUrl);
  if (callback.protocol !== "https:" || callback.hostname !== "chatgpt.com") {
    throw new Error("MCP OAuth 回调地址不在 ChatGPT 允许范围内");
  }
  return callback.toString();
}

function readOAuthAuthorizeUrl(value: unknown): string | null {
  return collectStrings(value).find((item) => isOAuthAuthorizeUrl(item)) ?? null;
}

function isOAuthAuthorizeUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.pathname.endsWith("/oauth/authorize") && parsed.searchParams.get("response_type") === "code";
  } catch {
    return false;
  }
}

function cookieHeaderFromResponse(response: Response): string | null {
  const pairs = setCookieHeaders(response.headers)
    .map(cookiePair)
    .filter((item): item is string => Boolean(item));
  return pairs.length > 0 ? pairs.join("; ") : null;
}

function setCookieHeaders(headers: Headers): string[] {
  const withGetter = headers as Headers & { getSetCookie?: () => string[] };
  const values = withGetter.getSetCookie?.();
  if (values && values.length > 0) {
    return values;
  }
  const value = headers.get("set-cookie");
  return value ? [value] : [];
}

function cookiePair(value: string): string | null {
  const pair = value.split(";", 1)[0]?.trim();
  return pair && pair.includes("=") ? pair : null;
}

async function completeChatGptOAuthCallback(profile: ChatGptDesktopProfile, callbackUrl: string): Promise<void> {
  const value = await evaluateInChatGptBrowserProfile(
    profile,
    `(${completeChatGptOAuthCallbackInPage.toString()})(${JSON.stringify(callbackUrl)})`,
  );
  if (!isRecord(value) || value.ok !== true) {
    const status = isRecord(value) && typeof value.status === "number" ? value.status : 0;
    throw new Error(`ChatGPT OAuth 回调失败：HTTP ${status}`);
  }
  await delay(500);
}

async function completeChatGptOAuthCallbackInPage(callbackUrl: string): Promise<{ ok: boolean; status: number }> {
  try {
    window.setTimeout(() => {
      window.location.assign(callbackUrl);
    }, 0);
    return { ok: true, status: 202 };
  } catch {
    return { ok: false, status: 0 };
  }
}

async function leaveChatGptOAuthCallbackPage(profile: ChatGptDesktopProfile): Promise<void> {
  await evaluateInChatGptBrowserProfile(
    profile,
    `(() => {
      if (window.location.hostname === "chatgpt.com" && window.location.pathname.startsWith("/connector/oauth/")) {
        window.location.replace("https://chatgpt.com/");
      }
      return true;
    })()`,
  ).catch(() => undefined);
}

async function waitForMatchingMcpLink(profile: ChatGptDesktopProfile, mcpServerUrl: string): Promise<void> {
  const target = normalizeUrl(mcpServerUrl);
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    await delay(1_000);
    const links = await readConnectorLinks(profile).catch(() => []);
    const link = links.find((item) => item.connectorType === "MCP" && normalizeUrl(item.baseUrl) === target);
    if (link?.authStatus === "ACTIVE") {
      return;
    }
  }
  throw new Error("ChatGPT OAuth 回调完成后未检测到已授权 MCP");
}

async function readConnectorLinksInPage() {
  const session = await fetch("/api/auth/session", { credentials: "include" })
    .then((sessionResponse) => sessionResponse.json())
    .catch(() => null);
  const accessToken = typeof session?.accessToken === "string" ? session.accessToken : null;
  if (!accessToken) {
    return { error: "ChatGPT accessToken 不可用，请确认该 Profile 已登录" };
  }
  const response = await fetch("/backend-api/aip/connectors/links/list_accessible", {
    method: "POST",
    credentials: "include",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ principals: [], link_refresh_strategy: "NONE" }),
  });
  const json = await response.json().catch(() => null);
  if (!response.ok) {
    return { error: `ChatGPT 连接器列表读取失败：HTTP ${response.status}` };
  }
  if (!Array.isArray(json?.links)) {
    return { error: "ChatGPT 连接器列表返回格式异常" };
  }
  return Promise.all(json.links.map(async (link: Record<string, unknown>) => {
    let detail: Record<string, unknown> | null = null;
    const connectorId = typeof link.connector_id === "string" ? link.connector_id : null;
    if (connectorId) {
      detail = await fetch(`/backend-api/aip/connectors/${encodeURIComponent(connectorId)}`, {
        credentials: "include",
        headers: { authorization: `Bearer ${accessToken}` },
      }).then((detailResponse) => detailResponse.ok ? detailResponse.json() : null).catch(() => null);
    }
    return {
      id: typeof link.id === "string" ? link.id : null,
      name: typeof link.name === "string" ? link.name : null,
      connectorId,
      connectorName: typeof link.connector_name === "string" ? link.connector_name : null,
      connectorType: typeof link.connector_type === "string" ? link.connector_type : null,
      authStatus: typeof link.auth_status === "string" ? link.auth_status : null,
      authType: typeof link.auth_type === "string" ? link.auth_type : null,
      visibility: typeof link.visibility === "string" ? link.visibility : null,
      baseUrl: typeof detail?.base_url === "string" ? detail.base_url : null,
      service: typeof detail?.service === "string" ? detail.service : null,
    };
  }));
}

function backendRequestInPage(path: string, request: { method: "GET" | "POST" | "PATCH"; body?: unknown }) {
  return fetch("/api/auth/session", { credentials: "include" })
    .then((sessionResponse) => sessionResponse.json())
    .then((session) => {
      const accessToken = typeof session?.accessToken === "string" ? session.accessToken : null;
      return fetch(path, {
        method: request.method,
        credentials: "include",
        headers: {
          "content-type": "application/json",
          ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
        },
        ...(request.body === undefined ? {} : { body: JSON.stringify(request.body) }),
      });
    })
    .then(async (response) => ({
      status: response.status,
      json: await response.json().catch(() => null),
    }))
    .catch((error) => ({ status: 0, json: { detail: String(error) } }));
}

function parseConnectorLink(value: unknown): ChatGptAppConnectorLinkView | null {
  if (!isRecord(value)) return null;
  return {
    id: readString(value.id),
    name: readString(value.name),
    connectorId: readString(value.connectorId),
    connectorName: readString(value.connectorName),
    connectorType: readString(value.connectorType),
    authStatus: readString(value.authStatus),
    authType: readString(value.authType),
    visibility: readString(value.visibility),
    baseUrl: readString(value.baseUrl),
    service: readString(value.service),
  };
}

function responseError(result: { status: number; json: unknown }, fallback: string): string {
  const detail = isRecord(result.json) ? result.json.detail : null;
  if (typeof detail === "string") return `${fallback}：${detail}`;
  if (Array.isArray(detail)) {
    const message = detail
      .map((item) => isRecord(item) ? readString(item.msg) ?? readString(item.type) : null)
      .filter((item): item is string => Boolean(item))
      .join("；");
    if (message) return `${fallback}：${message}`;
  }
  if (isRecord(detail)) {
    const message = readString(detail.developer_message) ?? readString(detail.message) ?? readString(detail.type);
    if (message) return `${fallback}：${message}`;
  }
  return `${fallback}：HTTP ${result.status}`;
}

function isDeveloperModeRequired(result: { json: unknown }): boolean {
  return collectStrings(result.json).some((value) => value.toLowerCase().includes("developer mode is required"));
}

function readDeveloperModeEnabled(value: unknown): boolean | null {
  if (!isRecord(value)) return null;
  if (typeof value.developer_mode === "boolean") return value.developer_mode;
  const settings = value.settings;
  return isRecord(settings) && typeof settings.developer_mode === "boolean" ? settings.developer_mode : null;
}

function collectStrings(value: unknown): string[] {
  const strings: string[] = [];
  const seen = new Set<unknown>();
  const stack: unknown[] = [value];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current || seen.has(current)) continue;
    if (typeof current === "string") {
      strings.push(current);
      continue;
    }
    if (Array.isArray(current)) {
      seen.add(current);
      stack.push(...current);
      continue;
    }
    if (isRecord(current)) {
      seen.add(current);
      stack.push(...Object.values(current));
    }
  }
  return strings;
}

function isActiveLink(link: ChatGptAppConnectorLinkView): boolean {
  return !link.authStatus || link.authStatus === "ACTIVE";
}

function findConnectorId(value: unknown): string | null {
  const seen = new Set<unknown>();
  const stack: unknown[] = [value];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current || seen.has(current)) continue;
    if (typeof current === "string") {
      if (isConnectorIdCandidate(current)) {
        return current;
      }
      continue;
    }
    if (Array.isArray(current)) {
      seen.add(current);
      stack.push(...current);
      continue;
    }
    if (isRecord(current)) {
      seen.add(current);
      stack.push(...Object.values(current));
    }
  }
  return null;
}

function connectorIdFromUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const parsed = new URL(value);
    const parts = parsed.pathname.split("/").map((part) => part.trim()).filter(Boolean);
    return parts.find(isConnectorIdCandidate) ?? null;
  } catch {
    return null;
  }
}

function isConnectorIdCandidate(value: string): boolean {
  return value.startsWith("connector_") || (value.startsWith("asdk_app_") && !value.startsWith("asdk_app_v_"));
}

function normalizeUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    return new URL(value).toString();
  } catch {
    return null;
  }
}

function normalizeText(value: string | null): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
