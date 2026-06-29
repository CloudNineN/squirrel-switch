import { constants } from "node:fs";
import { access, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { getEffectiveCodexHome, getSetting, setSetting } from "./db.js";
import { AppError, getErrorMessage } from "./errors.js";
import { readTextFile, writeTextFileAtomic } from "./files.js";
import { defaultCodexHome } from "./paths.js";
import { writeRuntimeLog } from "./runtime-log.js";

const SYSTEM_PROMPT_SETTING_KEY = "promptManagement.systemPrompt";

export type PromptPlatformId = "codex" | "claude-code";

type PromptPlatformSource = "platform" | "system" | "empty";

type PromptPlatformWarningCode = "codex-override" | "unreadable" | "not-writable";

interface PromptPlatformWarning {
  code: PromptPlatformWarningCode;
  message: string;
  path?: string;
}

export interface PromptPlatformState {
  id: PromptPlatformId;
  name: string;
  path: string;
  exists: boolean;
  empty: boolean;
  readable: boolean;
  writable: boolean;
  source: PromptPlatformSource;
  content: string;
  warnings: PromptPlatformWarning[];
  updatedAt: number | null;
}

export interface PromptManagementState {
  systemPrompt: string;
  platforms: PromptPlatformState[];
}

interface PromptPlatformDefinition {
  id: PromptPlatformId;
  name: string;
  targetFileName: string;
  resolveDir(): string;
  resolveWarnings?(targetPath: string): Promise<PromptPlatformWarning[]>;
}

const PROMPT_PLATFORMS: PromptPlatformDefinition[] = [
  {
    id: "codex",
    name: "Codex",
    targetFileName: "AGENTS.md",
    resolveDir: () => getEffectiveCodexHome(defaultCodexHome()),
    resolveWarnings: async (targetPath) => {
      const overridePath = join(dirname(targetPath), "AGENTS.override.md");
      if (!(await pathExists(overridePath))) {
        return [];
      }
      return [
        {
          code: "codex-override",
          message: "Codex 当前存在 override 文件，实际优先生效。",
          path: overridePath,
        },
      ];
    },
  },
  {
    id: "claude-code",
    name: "Claude Code",
    targetFileName: "CLAUDE.md",
    resolveDir: () => join(homedir(), ".claude"),
  },
];

export async function readPromptManagementState(): Promise<PromptManagementState> {
  const systemPrompt = getSystemPrompt();
  const platforms = await Promise.all(
    PROMPT_PLATFORMS.map((platform) => readPlatformState(platform, systemPrompt)),
  );
  return { systemPrompt, platforms };
}

export async function updateSystemPrompt(content: string): Promise<PromptManagementState> {
  const previousSystemPrompt = getSystemPrompt();
  await syncSystemPromptToEmptyPlatforms(content, previousSystemPrompt);
  setSetting(SYSTEM_PROMPT_SETTING_KEY, content);
  return readPromptManagementState();
}

export async function updatePlatformPrompt(
  platformId: PromptPlatformId,
  content: string,
): Promise<PromptPlatformState> {
  const platform = findPlatform(platformId);
  const targetPath = resolveTargetPath(platform);
  const systemPrompt = getSystemPrompt();
  const contentToWrite = content.trim().length === 0 && systemPrompt.length > 0 ? systemPrompt : content;
  try {
    await writeTextFileAtomic(targetPath, contentToWrite);
  } catch (error) {
    await writeRuntimeLog(
      "error",
      "prompt-management",
      `${platform.name} 提示词保存失败: ${targetPath}: ${getErrorMessage(error)}`,
    );
    throw new AppError("写入失败，请检查目录权限或磁盘状态。", 500);
  }

  await writeRuntimeLog("info", "prompt-management", `${platform.name} 提示词已保存: ${targetPath}`);
  return readPlatformState(platform, systemPrompt);
}

function getSystemPrompt(): string {
  return getSetting(SYSTEM_PROMPT_SETTING_KEY) ?? "";
}

async function syncSystemPromptToEmptyPlatforms(
  systemPrompt: string,
  previousSystemPrompt: string,
): Promise<void> {
  await Promise.all(
    PROMPT_PLATFORMS.map(async (platform) => {
      const targetPath = resolveTargetPath(platform);
      const base = await inspectTargetPath(targetPath);
      const isEmptyTarget = !base.exists || (base.readable && base.content.trim().length === 0);
      const followsPreviousSystem =
        previousSystemPrompt.length > 0 && base.readable && base.content === previousSystemPrompt;
      if ((!isEmptyTarget || systemPrompt.length === 0) && !followsPreviousSystem) {
        return;
      }

      try {
        await writeTextFileAtomic(targetPath, systemPrompt);
      } catch (error) {
        await writeRuntimeLog(
          "error",
          "prompt-management",
          `${platform.name} 系统提示词同步失败: ${targetPath}: ${getErrorMessage(error)}`,
        );
        throw new AppError(`${platform.name} 同步失败，请检查目录权限或磁盘状态。`, 500);
      }

      await writeRuntimeLog(
        "info",
        "prompt-management",
        `${platform.name} 已同步系统提示词: ${targetPath}`,
      );
    }),
  );
}

async function readPlatformState(
  platform: PromptPlatformDefinition,
  systemPrompt: string,
): Promise<PromptPlatformState> {
  const targetPath = resolveTargetPath(platform);
  const base = await inspectTargetPath(targetPath);
  const warnings = [...base.warnings, ...(await platform.resolveWarnings?.(targetPath) ?? [])];
  const source = sourceFor(base.content, base.readable, systemPrompt);
  return {
    id: platform.id,
    name: platform.name,
    path: targetPath,
    exists: base.exists,
    empty: base.empty,
    readable: base.readable,
    writable: base.writable,
    source,
    content: contentForSource(source, base.content, systemPrompt),
    warnings,
    updatedAt: base.updatedAt,
  };
}

function resolveTargetPath(platform: PromptPlatformDefinition): string {
  return join(platform.resolveDir(), platform.targetFileName);
}

async function inspectTargetPath(path: string): Promise<{
  exists: boolean;
  empty: boolean;
  readable: boolean;
  writable: boolean;
  content: string;
  updatedAt: number | null;
  warnings: PromptPlatformWarning[];
}> {
  const fileStat = await stat(path).catch(() => null);
  const exists = fileStat?.isFile() ?? false;
  const updatedAt = fileStat ? Math.floor(fileStat.mtimeMs / 1000) : null;
  const writable = exists ? await canAccess(path, constants.W_OK) : await canWriteMissingTarget(path);
  const warnings: PromptPlatformWarning[] = [];

  if (!exists) {
    if (!writable) {
      warnings.push({
        code: "not-writable",
        message: "目标目录当前不可写，保存时可能失败。",
        path,
      });
    }
    return { exists, empty: true, readable: true, writable, content: "", updatedAt, warnings };
  }

  const readable = await canAccess(path, constants.R_OK);
  if (!readable) {
    warnings.push({
      code: "unreadable",
      message: "目标文件无法读取，请检查文件权限。",
      path,
    });
  }
  if (!writable) {
    warnings.push({
      code: "not-writable",
      message: "目标文件当前不可写，保存时可能失败。",
      path,
    });
  }

  const content = readable ? await readTextFile(path).catch(() => "") : "";
  return {
    exists,
    empty: readable ? content.trim().length === 0 : false,
    readable,
    writable,
    content,
    updatedAt,
    warnings,
  };
}

function sourceFor(
  platformContent: string,
  readable: boolean,
  systemPrompt: string,
): PromptPlatformState["source"] {
  if (readable && systemPrompt.length > 0 && platformContent === systemPrompt) {
    return "system";
  }
  if (readable && platformContent.trim().length > 0) {
    return "platform";
  }
  if (systemPrompt.length > 0) {
    return "system";
  }
  return "empty";
}

function contentForSource(
  source: PromptPlatformState["source"],
  platformContent: string,
  systemPrompt: string,
): string {
  if (source === "platform") {
    return platformContent;
  }
  if (source === "system") {
    return systemPrompt;
  }
  return "";
}

function findPlatform(platformId: PromptPlatformId): PromptPlatformDefinition {
  const platform = PROMPT_PLATFORMS.find((item) => item.id === platformId);
  if (!platform) {
    throw new AppError("不支持的提示词平台", 404);
  }
  return platform;
}

async function canAccess(path: string, mode: number): Promise<boolean> {
  try {
    await access(path, mode);
    return true;
  } catch {
    return false;
  }
}

async function canWriteMissingTarget(targetPath: string): Promise<boolean> {
  let current = dirname(targetPath);
  while (true) {
    const currentStat = await stat(current).catch(() => null);
    if (currentStat?.isDirectory()) {
      return canAccess(current, constants.W_OK);
    }
    const parent = dirname(current);
    if (parent === current) {
      return false;
    }
    current = parent;
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}
