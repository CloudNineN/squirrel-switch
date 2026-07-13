import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { writeRuntimeLog } from "./runtime-log.js";

const execFileAsync = promisify(execFile);

export interface CodexAppRestartView {
  attempted: boolean;
  restarted: boolean;
  error: string | null;
}

const MACOS_APP_NAME = "ChatGPT";
const MACOS_APP_DISPLAY_NAME = "ChatGPT/Codex";
const MACOS_BUNDLE_ID = "com.openai.codex";
const WINDOWS_APP_ID_FALLBACK = "OpenAI.Codex_2p2nqsd0c76g0!App";
const QUIT_POLL_INTERVAL_MS = 200;
const QUIT_GRACEFUL_TIMEOUT_MS = 6000;
const WINDOWS_FORCE_QUIT_TIMEOUT_MS = 5000;
const OPEN_WAIT_TIMEOUT_MS = 5000;
const OPEN_RETRY_ATTEMPTS = 3;
const OPEN_RETRY_DELAY_MS = 800;

async function isCodexAppRunning(): Promise<boolean> {
  if (process.platform === "win32") {
    return (await listWindowsCodexAppProcesses()).length > 0;
  }
  if (process.platform !== "darwin") return false;
  try {
    const { stdout } = await execFileAsync("/usr/bin/pgrep", ["-x", MACOS_APP_NAME]);
    return stdout.trim().length > 0;
  } catch {
    // pgrep 未匹配进程时退出码为 1,在此视为未运行。
    return false;
  }
}

export interface CodexAppQuitResult {
  wasRunning: boolean;
  stopped: boolean;
  error: string | null;
}

/**
 * 若 ChatGPT（旧 Codex）正在运行则优雅退出并等待其停止;否则直接返回。
 * 退出超时不强制结束,而是返回 error 提示需要手动关闭。
 */
export async function quitCodexAppIfRunning(): Promise<CodexAppQuitResult> {
  if (process.platform === "win32") {
    const processes = await listWindowsCodexAppProcesses();
    if (processes.length === 0) {
      return { wasRunning: false, stopped: true, error: null };
    }

    let quitError: string | null = null;
    try {
      await closeWindowsMainWindows(processes.map((proc) => proc.pid));
    } catch (error) {
      quitError = error instanceof Error ? error.message : String(error);
    }

    let stopped = await waitUntilStopped(QUIT_GRACEFUL_TIMEOUT_MS);
    if (!stopped) {
      void writeRuntimeLog("warn", "account", "Windows Codex.app 优雅退出超时，尝试强制停止 Codex 进程");
      try {
        await forceStopWindowsCodexAppProcesses();
      } catch (error) {
        quitError = error instanceof Error ? error.message : String(error);
      }
      stopped = await waitUntilStopped(WINDOWS_FORCE_QUIT_TIMEOUT_MS);
    }

    return {
      wasRunning: true,
      stopped,
      error: stopped
        ? null
        : quitError ??
          `Codex.app 未在 ${Math.round(QUIT_GRACEFUL_TIMEOUT_MS / 1000)} 秒内退出,请手动关闭 Codex 后再重新打开以加载新账号`,
    };
  }

  if (process.platform !== "darwin") {
    return { wasRunning: false, stopped: true, error: null };
  }
  if (!(await isCodexAppRunning())) {
    return { wasRunning: false, stopped: true, error: null };
  }

  let quitError: string | null = null;
  try {
    await execFileAsync("/usr/bin/osascript", [
      "-e",
      `tell application "${MACOS_APP_NAME}" to quit`,
    ]);
  } catch (error) {
    quitError = error instanceof Error ? error.message : String(error);
  }

  const stopped = await waitUntilStopped(QUIT_GRACEFUL_TIMEOUT_MS);
  return {
    wasRunning: true,
    stopped,
    error: stopped
      ? null
      : quitError ??
        `${MACOS_APP_DISPLAY_NAME}.app 未在 ${Math.round(QUIT_GRACEFUL_TIMEOUT_MS / 1000)} 秒内退出,请手动关闭应用后再重新打开以加载新账号`,
  };
}

/** 打开 ChatGPT（旧 Codex）应用(若已在运行,macOS 的 open 不会重复启动)。 */
export async function openCodexApp(): Promise<{ opened: boolean; error: string | null }> {
  if (process.platform === "win32") {
    try {
      const appId = await resolveWindowsCodexAppId();
      await execFileAsync("explorer.exe", [`shell:AppsFolder\\${appId}`], {
        windowsHide: true,
      });
      const opened = await waitUntilRunning(OPEN_WAIT_TIMEOUT_MS);
      return {
        opened,
        error: opened ? null : "Codex.app 已请求打开,但未检测到 Codex 主进程",
      };
    } catch (error) {
      return {
        opened: false,
        error: `Codex.app 重新打开失败:${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  if (process.platform !== "darwin") {
    return { opened: false, error: null };
  }
  const errors: string[] = [];
  for (let attempt = 1; attempt <= OPEN_RETRY_ATTEMPTS; attempt += 1) {
    if (attempt > 1) {
      await delay(OPEN_RETRY_DELAY_MS);
    }

    try {
      await execFileAsync("/usr/bin/open", ["-b", MACOS_BUNDLE_ID]);
      const opened = await waitUntilRunning(OPEN_WAIT_TIMEOUT_MS);
      if (opened) return { opened: true, error: null };
      errors.push(`${MACOS_APP_DISPLAY_NAME}.app 已请求打开,但未检测到主进程`);
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }

  return {
    opened: false,
    error: `${MACOS_APP_DISPLAY_NAME}.app 重新打开失败:${errors.at(-1) ?? "未知错误"}`,
  };
}

async function waitUntilStopped(timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!(await isCodexAppRunning())) return true;
    await delay(QUIT_POLL_INTERVAL_MS);
  }
  return !(await isCodexAppRunning());
}

async function waitUntilRunning(timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isCodexAppRunning()) return true;
    await delay(QUIT_POLL_INTERVAL_MS);
  }
  return isCodexAppRunning();
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface WindowsCodexAppProcess {
  pid: number;
}

async function listWindowsCodexAppProcesses(): Promise<WindowsCodexAppProcess[]> {
  const script = `
$ErrorActionPreference = 'SilentlyContinue'
Get-Process |
  Where-Object { $_.ProcessName -ceq 'Codex' } |
  ForEach-Object { [PSCustomObject]@{ Id = $_.Id } } |
  ConvertTo-Json -Compress
`;

  try {
    const { stdout } = await execFileAsync("powershell.exe", [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      script,
    ]);
    const trimmed = stdout.trim();
    if (!trimmed) return [];

    const parsed = JSON.parse(trimmed) as unknown;
    const rows = Array.isArray(parsed) ? parsed : [parsed];
    return rows
      .map((row) =>
        typeof row === "object" && row !== null && "Id" in row
          ? Number((row as { Id: unknown }).Id)
          : NaN,
      )
      .filter((pid) => Number.isInteger(pid) && pid > 0)
      .map((pid) => ({ pid }));
  } catch {
    return [];
  }
}

async function closeWindowsMainWindows(pids: number[]): Promise<void> {
  const ids = pids.filter((pid) => Number.isInteger(pid) && pid > 0);
  if (ids.length === 0) return;

  const script = `
$ids = @(${ids.join(",")})
foreach ($id in $ids) {
  $process = Get-Process -Id $id -ErrorAction SilentlyContinue
  if ($process) {
    [void]$process.CloseMainWindow()
  }
}
`;

  await execFileAsync("powershell.exe", [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-Command",
    script,
  ]);
}

async function forceStopWindowsCodexAppProcesses(): Promise<void> {
  const script = `
$ErrorActionPreference = 'Stop'
Get-Process |
  Where-Object { $_.ProcessName -ceq 'Codex' } |
  Stop-Process -Force
`;

  await execFileAsync("powershell.exe", [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-Command",
    script,
  ]);
}

async function resolveWindowsCodexAppId(): Promise<string> {
  const script = `
$ErrorActionPreference = 'SilentlyContinue'
Get-StartApps |
  Where-Object { $_.AppID -like 'OpenAI.Codex_*' -or $_.Name -eq 'Codex' } |
  Select-Object -First 1 -ExpandProperty AppID
`;

  try {
    const { stdout } = await execFileAsync("powershell.exe", [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      script,
    ]);
    const appId = stdout.trim().split(/\r?\n/)[0]?.trim();
    return appId || WINDOWS_APP_ID_FALLBACK;
  } catch {
    return WINDOWS_APP_ID_FALLBACK;
  }
}
