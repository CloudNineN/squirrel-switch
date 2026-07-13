import { evaluateInTrustedChatGptBrowserProfilePage } from "./chatgpt-browser.js";
import type { ChatGptDesktopProfile } from "./chatgpt-browser.js";
import { writeDesktopRuntimeLog } from "./runtime-log.js";

export interface ChatGptBrowserTaskNotice {
  message: string;
  blocking: boolean;
}

interface TaskNoticeOptions {
  minVisibleMs?: number;
  preferredUrl?: string;
  requireActive?: boolean;
}

interface TaskNoticeState {
  generation: number;
  shownAt: number | null;
}

const defaultMinVisibleMs = 900;
const noticeStateByProfileId = new Map<string, TaskNoticeState>();

export async function showChatGptBrowserTaskNotice(
  profile: ChatGptDesktopProfile,
  notice: ChatGptBrowserTaskNotice,
  options: TaskNoticeOptions = {},
): Promise<void> {
  const current = noticeStateByProfileId.get(profile.id);
  const generation = (current?.generation ?? 0) + 1;
  noticeStateByProfileId.set(profile.id, {
    generation,
    shownAt: null,
  });
  await updateChatGptBrowserTaskNotice(profile, notice, options);
  const latest = noticeStateByProfileId.get(profile.id);
  if (latest?.generation === generation && latest.shownAt === null) {
    latest.shownAt = Date.now();
  }
}

export async function clearChatGptBrowserTaskNotice(
  profile: ChatGptDesktopProfile,
  options: TaskNoticeOptions = {},
): Promise<void> {
  const state = noticeStateByProfileId.get(profile.id);
  if (state?.shownAt !== null && state?.shownAt !== undefined) {
    const minVisibleMs = options.minVisibleMs ?? defaultMinVisibleMs;
    const remainingMs = state.shownAt + minVisibleMs - Date.now();
    if (remainingMs > 0) {
      await delay(remainingMs);
    }
    if (noticeStateByProfileId.get(profile.id)?.generation !== state.generation) {
      return;
    }
  }
  await updateChatGptBrowserTaskNotice(profile, null, { ...options, requireActive: options.requireActive ?? true });
  noticeStateByProfileId.delete(profile.id);
}

async function updateChatGptBrowserTaskNotice(
  profile: ChatGptDesktopProfile,
  notice: ChatGptBrowserTaskNotice | null,
  options: TaskNoticeOptions,
): Promise<void> {
  const safeNotice = notice
    ? {
        message: notice.message.slice(0, 120),
        blocking: notice.blocking,
      }
    : null;
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await evaluateInTrustedChatGptBrowserProfilePage(
        profile,
        `(${applyTaskNoticeInPage.toString()})(${JSON.stringify(safeNotice)})`,
        {
          preferredUrl: options.preferredUrl,
          requireActive: options.requireActive === true,
        },
      );
      return;
    } catch (error) {
      lastError = error;
      if (attempt === 2 || !isRetriableNoticeError(error)) {
        break;
      }
      await delay(350);
    }
  }
  const error = lastError;
  if (options.requireActive === true && isInactiveProfileError(error)) {
    return;
  }
  await writeDesktopRuntimeLog(
    "warn",
    "chatgpt-browser",
    `ChatGPT 任务提示更新失败：${errorMessage(error)}`,
  );
}

async function applyTaskNoticeInPage(notice: ChatGptBrowserTaskNotice | null): Promise<boolean> {
  const bannerId = "squirrel-switch-task-notice";
  const styleId = "squirrel-switch-task-notice-style";
  const state = window as unknown as {
    __squirrelSwitchTaskNoticeBeforeUnload?: (event: BeforeUnloadEvent) => void;
  };
  const removeBeforeUnload = () => {
    const handler = state.__squirrelSwitchTaskNoticeBeforeUnload;
    if (handler) {
      window.removeEventListener("beforeunload", handler);
      delete state.__squirrelSwitchTaskNoticeBeforeUnload;
    }
  };

  if (!notice) {
    document.getElementById(bannerId)?.remove();
    document.getElementById(styleId)?.remove();
    removeBeforeUnload();
    return true;
  }

  if (!document.head || !document.body) {
    await new Promise<void>((resolve) => {
      const finish = () => resolve();
      window.setTimeout(finish, 1500);
      document.addEventListener("DOMContentLoaded", finish, { once: true });
    });
  }

  let style = document.getElementById(styleId);
  if (!style) {
    style = document.createElement("style");
    style.id = styleId;
    style.textContent = `
      #${bannerId} {
        position: fixed;
        top: 14px;
        left: 50%;
        transform: translateX(-50%);
        z-index: 2147483647;
        display: flex;
        align-items: center;
        gap: 10px;
        max-width: min(720px, calc(100vw - 32px));
        padding: 10px 14px;
        border-radius: 8px;
        background: rgba(17, 24, 39, 0.96);
        color: #fff;
        box-shadow: 0 12px 36px rgba(15, 23, 42, 0.24);
        font: 13px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        letter-spacing: 0;
        pointer-events: auto;
      }
      #${bannerId} .squirrel-switch-task-spinner {
        width: 14px;
        height: 14px;
        border: 2px solid rgba(255, 255, 255, 0.35);
        border-top-color: #fff;
        border-radius: 999px;
        animation: squirrel-switch-task-spin 0.8s linear infinite;
        flex: 0 0 auto;
      }
      #${bannerId} .squirrel-switch-task-text {
        min-width: 0;
        overflow-wrap: anywhere;
      }
      @keyframes squirrel-switch-task-spin {
        to { transform: rotate(360deg); }
      }
    `;
    document.head.appendChild(style);
  }

  let banner = document.getElementById(bannerId);
  if (!banner) {
    banner = document.createElement("div");
    banner.id = bannerId;
    banner.setAttribute("role", "status");
    banner.setAttribute("aria-live", "polite");
    banner.innerHTML = '<span class="squirrel-switch-task-spinner"></span><span class="squirrel-switch-task-text"></span>';
    document.body.appendChild(banner);
  }
  const text = banner.querySelector(".squirrel-switch-task-text");
  if (text) {
    text.textContent = notice.message;
  }

  removeBeforeUnload();
  if (notice.blocking) {
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    state.__squirrelSwitchTaskNoticeBeforeUnload = handler;
    window.addEventListener("beforeunload", handler);
  }
  return true;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isInactiveProfileError(error: unknown): boolean {
  return errorMessage(error).includes("ChatGPT Profile 当前未打开");
}

function isRetriableNoticeError(error: unknown): boolean {
  const message = errorMessage(error);
  return (
    message.includes("Execution context was destroyed") ||
    message.includes("Cannot find context") ||
    message.includes("Target closed") ||
    message.includes("页面脚本执行失败")
  );
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
