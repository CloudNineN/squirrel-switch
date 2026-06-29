#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import { createConnection } from "node:net";
import { accessSync, constants, existsSync, mkdirSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const homeDir = homedir();
const stateDir = join(homedir(), ".squirrel-switch", "mcp-runner");
const statePath = join(stateDir, "state.json");
const mcpLogPath = join(stateDir, "coding-tools-mcp.log");
const tunnelLogPath = join(stateDir, "cloudflared.log");
const codingToolsMcpSource = "git+https://github.com/xyTom/coding-tools-mcp.git";
const defaultWorkspace = rootDir;
const defaultPort = 8765;
const defaultHost = "127.0.0.1";
const tunnelUrlPattern = /https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com/g;

const command = process.argv[2] ?? "help";
const args = process.argv.slice(3);

ensureStateDir();

try {
  if (command === "install") {
    installDependencies(parseInstallOptions(args));
  } else if (command === "start") {
    await startRunner(parseStartOptions(args));
  } else if (command === "status") {
    await printStatus();
  } else if (command === "refresh") {
    await refreshTunnel(parseRefreshOptions(args));
  } else if (command === "stop") {
    stopRunner();
  } else {
    printHelp();
  }
} catch (error) {
  console.error(`失败：${errorMessage(error)}`);
  process.exitCode = 1;
}

function printHelp() {
  console.log(`ChatGPT MCP 运行脚本

用法：
  node scripts/chatgpt-mcp-tunnel.mjs install [--dry-run] [--no-install-uv]
  node scripts/chatgpt-mcp-tunnel.mjs start [--workspace <path>] [--port <port>] [--permission-mode safe|trusted|dangerous] [--tool-profile read-only|full]
  node scripts/chatgpt-mcp-tunnel.mjs status
  node scripts/chatgpt-mcp-tunnel.mjs refresh
  node scripts/chatgpt-mcp-tunnel.mjs stop

常用：
  npm run mcp:start
  npm run mcp:status
  npm run mcp:refresh
  npm run mcp:stop

说明：
  - 默认工作区：${defaultWorkspace}
  - 默认本地 MCP：http://${defaultHost}:${defaultPort}/mcp
  - 默认公网入口：Cloudflare Quick Tunnel
  - 默认权限：permission-mode=safe，tool-profile=read-only
  - Coding Tools MCP 需要 Python 3.11+；本脚本优先使用 uv 隔离安装，不使用系统 Python 3.9 硬装。
  - 脚本只输出公网 Server URL，不保存 ChatGPT cookie、OAuth token 或 bearer token。
`);
}

function installDependencies(options) {
  console.log("检查 Coding Tools MCP...");
  if (!findCommand("coding-tools-mcp")) {
    installCodingToolsMcp(options);
  } else {
    console.log("已找到 coding-tools-mcp");
  }

  console.log("检查 cloudflared...");
  if (!findCommand("cloudflared")) {
    installCloudflared(options);
  } else {
    console.log("已找到 cloudflared");
  }
}

function installCodingToolsMcp(options) {
  let uv = findCommand("uv");
  if (!uv && options.installUv) {
    const brew = findCommand("brew");
    if (brew) {
      console.log("未找到 uv，将通过 Homebrew 安装 uv，用于创建 Python 3.11+ 隔离环境。");
      runChecked(brew, ["install", "uv"], options);
      uv = findCommand("uv") ?? (options.dryRun ? "uv" : null);
    }
  }

  if (uv) {
    runChecked(uv, ["tool", "install", "--python", "3.11", "--upgrade", codingToolsMcpSource], options);
    return;
  }

  const python = findPythonAtLeast(3, 11);
  if (python) {
    runChecked(python.command, ["-m", "pip", "install", "--user", "--upgrade", codingToolsMcpSource], options);
    return;
  }

  const currentPython = pythonVersion(findCommand("python3") ?? findCommand("python"));
  const currentPythonText = currentPython ? `当前 Python 是 ${currentPython.text}，` : "";
  throw new Error(
    `${currentPythonText}Coding Tools MCP 需要 Python 3.11+。请先运行 brew install uv 后重试，或安装 Python 3.11+ 并通过 CODING_TOOLS_MCP_PYTHON 指定。`,
  );
}

function installCloudflared(options) {
  const brew = findCommand("brew");
  if (!brew) {
    throw new Error("未找到 cloudflared，也未找到 Homebrew。请先安装 cloudflared 后重试。");
  }
  runChecked(brew, ["install", "cloudflared"], options);
}

async function startRunner(options) {
  const state = readState();
  const port = options.port;
  const workspace = resolve(options.workspace);
  const localEndpoint = `http://${defaultHost}:${port}/mcp`;

  if (!(await isPortOpen(defaultHost, port))) {
    startMcpServer({ ...options, workspace });
    await waitForLocalMcp(port);
  } else if (state.mcp?.pid && isPidAlive(state.mcp.pid)) {
    console.log(`本地 MCP 已在运行：${localEndpoint}`);
  } else {
    console.log(`本地端口 ${port} 已可访问，将复用现有服务：${localEndpoint}`);
  }

  const nextState = {
    ...readState(),
    mcp: {
      pid: readState().mcp?.pid ?? null,
      host: defaultHost,
      port,
      workspace,
      endpoint: localEndpoint,
      permissionMode: options.permissionMode,
      toolProfile: options.toolProfile,
      startedAt: readState().mcp?.startedAt ?? new Date().toISOString(),
      logPath: mcpLogPath,
    },
  };
  writeState(nextState);

  if (!nextState.tunnel?.pid || !isPidAlive(nextState.tunnel.pid)) {
    await startCloudflareTunnel(localEndpoint);
  }

  await printStatus();
}

function startMcpServer(options) {
  const commandInfo = resolveMcpCommand(options);
  const fd = openSync(mcpLogPath, "a");
  const child = spawn(commandInfo.command, commandInfo.args, {
    cwd: options.workspace,
    detached: true,
    env: {
      ...process.env,
      CODING_TOOLS_MCP_AUTH_MODE: options.authMode,
      CODING_TOOLS_MCP_TOOL_PROFILE: options.toolProfile,
    },
    stdio: ["ignore", fd, fd],
  });
  child.unref();
  writeState({
    ...readState(),
    mcp: {
      pid: child.pid ?? null,
      host: defaultHost,
      port: options.port,
      workspace: options.workspace,
      endpoint: `http://${defaultHost}:${options.port}/mcp`,
      permissionMode: options.permissionMode,
      toolProfile: options.toolProfile,
      startedAt: new Date().toISOString(),
      logPath: mcpLogPath,
    },
  });
}

function resolveMcpCommand(options) {
  const installed = findCommand("coding-tools-mcp");
  const baseArgs = [
    "--workspace",
    options.workspace,
    "--host",
    defaultHost,
    "--port",
    String(options.port),
    "--permission-mode",
    options.permissionMode,
  ];
  if (options.authMode === "oauth") {
    baseArgs.push("--oauth-mode");
  } else if (options.authMode === "bearer") {
    throw new Error("bearer 认证需要显式 token；脚本不保存 bearer token，当前请使用默认 oauth 或 noauth。");
  }

  if (installed) {
    return { command: installed, args: baseArgs };
  }

  const uvx = findCommand("uvx");
  if (uvx) {
    return { command: uvx, args: ["--python", "3.11", "--from", codingToolsMcpSource, "coding-tools-mcp", ...baseArgs] };
  }

  const uv = findCommand("uv");
  if (uv) {
    return {
      command: uv,
      args: ["tool", "run", "--python", "3.11", "--from", codingToolsMcpSource, "coding-tools-mcp", ...baseArgs],
    };
  }

  throw new Error("未找到 coding-tools-mcp、uvx 或 uv。请先运行 npm run mcp:install，或手动安装 Python 3.11+/uv 后重试。");
}

async function startCloudflareTunnel(localEndpoint) {
  const cloudflared = findCommand("cloudflared");
  if (!cloudflared) {
    throw new Error("未找到 cloudflared。请先运行 npm run mcp:install，或手动安装 cloudflared。");
  }

  writeFileSync(tunnelLogPath, "", { mode: 0o600 });
  const fd = openSync(tunnelLogPath, "a");
  const child = spawn(cloudflared, ["tunnel", "--protocol", "http2", "--url", localEndpoint], {
    cwd: rootDir,
    detached: true,
    env: process.env,
    stdio: ["ignore", fd, fd],
  });
  child.unref();

  writeState({
    ...readState(),
    tunnel: {
      pid: child.pid ?? null,
      publicBaseUrl: null,
      publicMcpUrl: null,
      startedAt: new Date().toISOString(),
      logPath: tunnelLogPath,
    },
  });

  const publicBaseUrl = await waitForTunnelUrl();
  const publicMcpUrl = `${publicBaseUrl}/mcp`;
  const publicReachable = await waitForPublicMcp(publicMcpUrl);
  writeState({
    ...readState(),
    tunnel: {
      pid: child.pid ?? null,
      publicBaseUrl,
      publicMcpUrl,
      startedAt: new Date().toISOString(),
      logPath: tunnelLogPath,
    },
  });
  if (!publicReachable) {
    console.warn(`警告：已获取公网地址，但暂未确认可访问：${publicMcpUrl}`);
  }
}

async function refreshTunnel(options) {
  const state = readState();
  const endpoint = state.mcp?.endpoint ?? `http://${defaultHost}:${options.port}/mcp`;
  if (!(await isLocalMcpReachable(endpoint))) {
    throw new Error(`本地 MCP 不可访问：${endpoint}。请先运行 npm run mcp:start。`);
  }

  const latestUrl = latestTunnelUrlFromLog();
  const currentPublicUrl = latestUrl ? `${latestUrl}/mcp` : state.tunnel?.publicMcpUrl ?? null;
  if (currentPublicUrl && (await isPublicMcpReachable(currentPublicUrl))) {
    writeState({
      ...state,
      tunnel: {
        ...(state.tunnel ?? {}),
        pid: state.tunnel?.pid ?? null,
        publicBaseUrl: latestUrl ?? state.tunnel?.publicBaseUrl ?? null,
        publicMcpUrl: currentPublicUrl,
        startedAt: state.tunnel?.startedAt ?? null,
        logPath: tunnelLogPath,
      },
    });
    console.log(`公网 MCP 地址仍可用：${currentPublicUrl}`);
    return;
  }

  if (state.tunnel?.pid && isPidAlive(state.tunnel.pid)) {
    killPid(state.tunnel.pid);
    await sleep(800);
  }

  await startCloudflareTunnel(endpoint);
  const refreshed = readState();
  console.log(`新的公网 MCP 地址：${refreshed.tunnel?.publicMcpUrl ?? "未获取到"}`);
}

async function printStatus() {
  const state = readState();
  const latestBaseUrl = latestTunnelUrlFromLog();
  const publicMcpUrl = latestBaseUrl ? `${latestBaseUrl}/mcp` : state.tunnel?.publicMcpUrl ?? null;
  const localEndpoint = state.mcp?.endpoint ?? `http://${defaultHost}:${defaultPort}/mcp`;
  const localReachable = await isLocalMcpReachable(localEndpoint);
  const publicReachable = publicMcpUrl ? await isPublicMcpReachable(publicMcpUrl) : false;

  if (latestBaseUrl && latestBaseUrl !== state.tunnel?.publicBaseUrl) {
    writeState({
      ...state,
      tunnel: {
        ...(state.tunnel ?? {}),
        pid: state.tunnel?.pid ?? null,
        publicBaseUrl: latestBaseUrl,
        publicMcpUrl,
        startedAt: state.tunnel?.startedAt ?? null,
        logPath: tunnelLogPath,
      },
    });
  }

  console.log("ChatGPT MCP 运行状态");
  console.log(`本地 MCP：${localEndpoint}`);
  console.log(`本地状态：${localReachable ? "可访问" : "不可访问"}`);
  console.log(`MCP 进程：${state.mcp?.pid && isPidAlive(state.mcp.pid) ? `运行中 pid=${state.mcp.pid}` : "未运行或未知"}`);
  console.log(`Cloudflare 进程：${state.tunnel?.pid && isPidAlive(state.tunnel.pid) ? `运行中 pid=${state.tunnel.pid}` : "未运行或未知"}`);
  console.log(`公网 MCP：${publicMcpUrl ?? "未获取到"}`);
  console.log(`公网状态：${publicMcpUrl ? (publicReachable ? "可访问" : "不可访问或已失效") : "无地址"}`);
  console.log(`MCP 日志：${mcpLogPath}`);
  console.log(`Tunnel 日志：${tunnelLogPath}`);
  if (publicMcpUrl) {
    console.log("");
    console.log("复制到 ChatGPT 自定义 MCP 的 Server URL：");
    console.log(publicMcpUrl);
  }
}

function stopRunner() {
  const state = readState();
  if (state.tunnel?.pid && isPidAlive(state.tunnel.pid)) {
    killPid(state.tunnel.pid);
    console.log(`已停止 Cloudflare tunnel：pid=${state.tunnel.pid}`);
  }
  if (state.mcp?.pid && isPidAlive(state.mcp.pid)) {
    killPid(state.mcp.pid);
    console.log(`已停止 Coding Tools MCP：pid=${state.mcp.pid}`);
  }
  writeState({});
}

function parseStartOptions(rawArgs) {
  const options = {
    workspace: defaultWorkspace,
    port: defaultPort,
    permissionMode: "safe",
    toolProfile: "read-only",
    authMode: "oauth",
  };
  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];
    const value = rawArgs[index + 1];
    if (arg === "--workspace" && value) {
      options.workspace = value;
      index += 1;
    } else if (arg === "--port" && value) {
      options.port = Number(value);
      index += 1;
    } else if (arg === "--permission-mode" && value) {
      options.permissionMode = value;
      index += 1;
    } else if (arg === "--tool-profile" && value) {
      options.toolProfile = value;
      index += 1;
    } else if (arg === "--auth-mode" && value) {
      options.authMode = value;
      index += 1;
    } else {
      throw new Error(`未知参数：${arg}`);
    }
  }
  if (!Number.isInteger(options.port) || options.port <= 0 || options.port > 65535) {
    throw new Error("端口不合法");
  }
  if (!["safe", "trusted", "dangerous"].includes(options.permissionMode)) {
    throw new Error("permission-mode 只能是 safe、trusted 或 dangerous");
  }
  if (!["read-only", "full", "compat-readonly-all"].includes(options.toolProfile)) {
    throw new Error("tool-profile 只能是 read-only、full 或 compat-readonly-all");
  }
  if (!["oauth", "noauth", "bearer"].includes(options.authMode)) {
    throw new Error("auth-mode 只能是 oauth、noauth 或 bearer");
  }
  return options;
}

function parseInstallOptions(rawArgs) {
  const options = {
    dryRun: false,
    installUv: true,
  };
  for (const arg of rawArgs) {
    if (arg === "--dry-run") {
      options.dryRun = true;
    } else if (arg === "--no-install-uv") {
      options.installUv = false;
    } else {
      throw new Error(`未知参数：${arg}`);
    }
  }
  return options;
}

function parseRefreshOptions(rawArgs) {
  const options = { port: defaultPort };
  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];
    const value = rawArgs[index + 1];
    if (arg === "--port" && value) {
      options.port = Number(value);
      index += 1;
    } else {
      throw new Error(`未知参数：${arg}`);
    }
  }
  return options;
}

async function waitForLocalMcp(port) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 15_000) {
    if (await isPortOpen(defaultHost, port)) {
      return;
    }
    await sleep(250);
  }
  throw new Error(`本地 MCP 启动超时，请查看日志：${mcpLogPath}`);
}

async function waitForTunnelUrl() {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 45_000) {
    const url = latestTunnelUrlFromLog();
    if (url) {
      return url;
    }
    await sleep(500);
  }
  throw new Error(`Cloudflare tunnel 未输出公网地址，请查看日志：${tunnelLogPath}`);
}

async function waitForPublicMcp(endpoint) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 30_000) {
    if (await isPublicMcpReachable(endpoint)) {
      return true;
    }
    await sleep(1000);
  }
  return false;
}

function latestTunnelUrlFromLog() {
  if (!existsSync(tunnelLogPath)) {
    return null;
  }
  const content = readFileSync(tunnelLogPath, "utf8");
  const matches = [...content.matchAll(tunnelUrlPattern)].map((match) => match[0]);
  return matches.at(-1) ?? null;
}

async function isLocalMcpReachable(endpoint) {
  try {
    const parsed = new URL(endpoint);
    if (parsed.hostname === defaultHost || parsed.hostname === "localhost") {
      return isPortOpen(parsed.hostname, Number(parsed.port || 80));
    }
  } catch {
    return false;
  }
  return false;
}

async function isPublicMcpReachable(endpoint) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    const response = await fetch(endpoint, { method: "GET", signal: controller.signal });
    clearTimeout(timer);
    return response.status > 0 && response.status < 500;
  } catch {
    return false;
  }
}

function isPortOpen(host, port) {
  return new Promise((resolvePort) => {
    const socket = createConnection({ host, port, timeout: 1000 });
    socket.once("connect", () => {
      socket.destroy();
      resolvePort(true);
    });
    socket.once("timeout", () => {
      socket.destroy();
      resolvePort(false);
    });
    socket.once("error", () => resolvePort(false));
  });
}

function findCommand(name) {
  const result = spawnSync("/usr/bin/env", ["bash", "-lc", `command -v ${shellQuote(name)}`], {
    encoding: "utf8",
  });
  const found = result.stdout.trim();
  if (found) {
    return found;
  }

  for (const candidate of commandCandidates(name)) {
    if (isExecutable(candidate)) {
      return candidate;
    }
  }

  return null;
}

function commandCandidates(name) {
  return [
    join(homeDir, ".local", "bin", name),
    join(homeDir, ".cargo", "bin", name),
    join(homeDir, "Library", "Python", "3.13", "bin", name),
    join(homeDir, "Library", "Python", "3.12", "bin", name),
    join(homeDir, "Library", "Python", "3.11", "bin", name),
    join("/opt/homebrew/bin", name),
    join("/usr/local/bin", name),
  ];
}

function findPythonAtLeast(major, minor) {
  const configured = process.env.CODING_TOOLS_MCP_PYTHON ? [process.env.CODING_TOOLS_MCP_PYTHON] : [];
  const candidates = [
    ...configured,
    findCommand("python3.13"),
    findCommand("python3.12"),
    findCommand("python3.11"),
    findCommand("python3"),
    findCommand("python"),
  ].filter(Boolean);

  for (const commandPath of candidates) {
    const version = pythonVersion(commandPath);
    if (version && isVersionAtLeast(version, major, minor)) {
      return { command: commandPath, version };
    }
  }

  return null;
}

function pythonVersion(commandPath) {
  if (!commandPath) {
    return null;
  }
  const result = spawnSync(commandPath, ["-c", "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}')"], {
    encoding: "utf8",
  });
  if (result.status !== 0) {
    return null;
  }
  const text = result.stdout.trim();
  const [major, minor, patch] = text.split(".").map((part) => Number(part));
  if (!Number.isInteger(major) || !Number.isInteger(minor) || !Number.isInteger(patch)) {
    return null;
  }
  return { major, minor, patch, text };
}

function isVersionAtLeast(version, major, minor) {
  return version.major > major || (version.major === major && version.minor >= minor);
}

function isExecutable(path) {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function runChecked(commandPath, commandArgs, options = { dryRun: false }) {
  if (options.dryRun) {
    console.log(`[dry-run] ${commandPath} ${commandArgs.map(shellQuote).join(" ")}`);
    return;
  }
  const result = spawnSync(commandPath, commandArgs, {
    cwd: rootDir,
    stdio: "inherit",
    env: process.env,
  });
  if (result.status !== 0) {
    throw new Error(`${commandPath} ${commandArgs.join(" ")} 执行失败`);
  }
}

function readState() {
  if (!existsSync(statePath)) {
    return {};
  }
  try {
    return JSON.parse(readFileSync(statePath, "utf8"));
  } catch {
    return {};
  }
}

function writeState(state) {
  writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
}

function ensureStateDir() {
  mkdirSync(stateDir, { recursive: true, mode: 0o700 });
}

function isPidAlive(pid) {
  if (!pid) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function killPid(pid) {
  try {
    process.kill(pid, "SIGTERM");
  } catch {
    // 进程可能已经退出，停止命令保持幂等。
  }
}

function sleep(ms) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

function shellQuote(value) {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
