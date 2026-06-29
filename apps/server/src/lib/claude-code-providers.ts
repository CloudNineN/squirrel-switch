export type ClaudeCodeProviderId =
  | "anthropic"
  | "glm-global"
  | "glm-china"
  | "deepseek"
  | "kimi"
  | "openrouter";

export type ClaudeCodeAuthHeader = "x-api-key" | "authorization-bearer";

export interface ClaudeCodeProviderTemplate {
  id: ClaudeCodeProviderId;
  displayName: string;
  defaultBaseUrl: string;
  authHeader: ClaudeCodeAuthHeader;
  defaultModels: {
    main?: string;
    opus?: string;
    sonnet?: string;
    haiku?: string;
    subagent?: string;
  };
  modelOptions: string[];
  notes?: string;
}

export const CLAUDE_CODE_PROVIDERS: ClaudeCodeProviderTemplate[] = [
  {
    id: "anthropic",
    displayName: "Anthropic API",
    defaultBaseUrl: "https://api.anthropic.com",
    authHeader: "x-api-key",
    defaultModels: {
      main: "claude-sonnet-4-20250514",
      opus: "claude-opus-4-1-20250805",
      sonnet: "claude-sonnet-4-20250514",
      haiku: "claude-3-5-haiku-20241022",
    },
    modelOptions: [
      "claude-opus-4-1-20250805",
      "claude-opus-4-20250514",
      "claude-sonnet-4-20250514",
      "claude-3-7-sonnet-20250219",
      "claude-3-5-haiku-20241022",
    ],
  },
  {
    id: "glm-global",
    displayName: "GLM Global",
    defaultBaseUrl: "https://api.z.ai/api/anthropic",
    authHeader: "authorization-bearer",
    defaultModels: {
      main: "glm-4.7",
      opus: "glm-4.7",
      sonnet: "glm-4.7",
      haiku: "glm-4.5-air",
      subagent: "glm-4.7",
    },
    modelOptions: ["glm-5", "glm-4.7", "glm-4.6", "glm-4.5", "glm-4.5-air"],
    notes: "Z.ai Anthropic 兼容入口，模型名可按控制台实际可用项调整。",
  },
  {
    id: "glm-china",
    displayName: "GLM China",
    defaultBaseUrl: "https://open.bigmodel.cn/api/anthropic",
    authHeader: "authorization-bearer",
    defaultModels: {
      main: "glm-4.7",
      opus: "glm-4.7",
      sonnet: "glm-4.7",
      haiku: "glm-4.5-air",
      subagent: "glm-4.7",
    },
    modelOptions: ["glm-5", "glm-4.7", "glm-4.6", "glm-4.5", "glm-4.5-air"],
  },
  {
    id: "deepseek",
    displayName: "DeepSeek",
    defaultBaseUrl: "https://api.deepseek.com/anthropic",
    authHeader: "authorization-bearer",
    defaultModels: {
      main: "deepseek-v4-pro[1m]",
      opus: "deepseek-v4-pro[1m]",
      sonnet: "deepseek-v4-pro[1m]",
      haiku: "deepseek-v4-flash",
      subagent: "deepseek-v4-flash",
    },
    modelOptions: ["deepseek-v4-pro[1m]", "deepseek-v4-pro", "deepseek-v4-flash"],
    notes: "DeepSeek 官方 Claude Code 接入使用 Anthropic 兼容入口和 Bearer Token。",
  },
  {
    id: "kimi",
    displayName: "Kimi",
    defaultBaseUrl: "https://api.moonshot.ai/anthropic",
    authHeader: "x-api-key",
    defaultModels: {
      main: "kimi-k2.5",
      sonnet: "kimi-k2.5",
      subagent: "kimi-k2.5",
    },
    modelOptions: ["kimi-k2.6", "kimi-k2.5", "moonshot-v1-128k", "moonshot-v1-32k"],
  },
  {
    id: "openrouter",
    displayName: "OpenRouter",
    defaultBaseUrl: "https://openrouter.ai/api/anthropic",
    authHeader: "authorization-bearer",
    defaultModels: {
      main: "anthropic/claude-sonnet-4",
      sonnet: "anthropic/claude-sonnet-4",
      haiku: "anthropic/claude-3.5-haiku",
    },
    modelOptions: [
      "anthropic/claude-opus-4.1",
      "anthropic/claude-sonnet-4",
      "anthropic/claude-3.7-sonnet",
      "anthropic/claude-3.5-haiku",
    ],
  },
];

export function getClaudeCodeProvider(id: string): ClaudeCodeProviderTemplate {
  const provider = CLAUDE_CODE_PROVIDERS.find((candidate) => candidate.id === id);
  if (!provider) {
    throw new Error("不支持的 Claude Code provider 模板");
  }
  return provider;
}
