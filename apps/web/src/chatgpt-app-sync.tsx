import type React from "react";
import { useState } from "react";
import {
  Clipboard,
  Wand2,
} from "lucide-react";
import type {
  ChatGptAppConnectorLinkView,
  ChatGptAppConfigView,
  ChatGptAppSyncCheckResult,
  ChatGptAppSyncStateView,
  ChatGptDesktopProfileInput,
  ChatGptProfileView,
  UpdateChatGptAppSyncStatusPayload,
} from "@squirrel-switch/shared";
import { api } from "./api.js";
import { useI18n } from "./i18n.js";
import type { AppLocale } from "./i18n.js";
import "./chatgpt-apps.css";

export interface ProfileAppSyncSummary {
  synced: number;
  total: number;
  pending: number;
  failed: number;
  unchecked: number;
}

interface ProfileAppSyncRow {
  config: ChatGptAppConfigView;
  state: ChatGptAppSyncStateView;
}

export function profileAppSyncSummary(
  configs: ChatGptAppConfigView[],
  profile: ChatGptProfileView,
): ProfileAppSyncSummary {
  const rows = profileAppSyncRows(configs, profile);
  return {
    synced: rows.filter((row) => row.state.status === "synced").length,
    total: rows.length,
    pending: rows.filter((row) => row.state.status === "pending").length,
    failed: rows.filter((row) => row.state.status === "failed").length,
    unchecked: rows.filter((row) => row.state.status === "unchecked").length,
  };
}

export function profileAppSyncRows(
  configs: ChatGptAppConfigView[],
  profile: ChatGptProfileView,
): ProfileAppSyncRow[] {
  if (!isProfileAppSyncEligible(profile)) {
    return [];
  }
  return configs.flatMap((config) => {
    const state = config.syncStates.find((item) => item.profileId === profile.id);
    if (!state || state.status === "skipped") {
      return [];
    }
    return [{ config, state }];
  });
}

export function appConfigStatusCounts(config: ChatGptAppConfigView) {
  const rows = config.syncStates.filter((state) => state.status !== "skipped");
  return {
    total: rows.length,
    synced: rows.filter((state) => state.status === "synced").length,
    pending: rows.filter((state) => state.status === "pending").length,
    failed: rows.filter((state) => state.status === "failed").length,
  };
}

export async function applyChatGptAppSyncCheckResult(
  profile: ChatGptProfileView,
  configs: ChatGptAppConfigView[],
  result: ChatGptAppSyncCheckResult,
  onChanged: (config: ChatGptAppConfigView) => void,
): Promise<number> {
  let changed = 0;
  for (const row of profileAppSyncRows(configs, profile)) {
    const payload = appSyncPayloadFromLinks(row.config, result.links);
    const updated = await api.updateChatGptAppSyncStatus(row.config.id, profile.id, payload);
    onChanged(updated);
    changed += 1;
  }
  return changed;
}

export function isProfileAppSyncEligible(profile: ChatGptProfileView): boolean {
  return (
    profile.sessionStatus === "available" &&
    !isGuestPlan(profile) &&
    Boolean(profile.accountEmail || profile.accountId)
  );
}

export function appSyncPayloadFromLinks(
  config: ChatGptAppConfigView,
  links: ChatGptAppConnectorLinkView[],
): UpdateChatGptAppSyncStatusPayload {
  const link = matchingLinkForConfig(config, links);
  if (!link) {
    return {
      status: "failed",
      error: config.type === "custom_mcp"
        ? "ChatGPT 未找到该应用/MCP，可能已被手动删除"
        : "ChatGPT 未找到该官方应用，可能尚未连接或已被手动删除",
    };
  }
  if (link.authStatus && link.authStatus !== "ACTIVE") {
    return {
      status: "failed",
      error: `ChatGPT 应用授权未完成：${link.authStatus}`,
      remoteConnectorId: link.connectorId,
      remoteLinkId: link.id,
    };
  }
  return {
    status: "synced",
    error: null,
    remoteConnectorId: link.connectorId,
    remoteLinkId: link.id,
  };
}

export function matchingLinkForConfig(
  config: ChatGptAppConfigView,
  links: ChatGptAppConnectorLinkView[],
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

export function ProfileAppSyncButton({
  configs,
  disabled,
  profile,
  onOpen,
}: {
  configs: ChatGptAppConfigView[];
  disabled?: boolean;
  profile: ChatGptProfileView;
  onOpen: (profile: ChatGptProfileView) => void;
}) {
  const { t } = useI18n();
  const eligible = isProfileAppSyncEligible(profile);
  const summary = profileAppSyncSummary(configs, profile);
  const tone = summary.failed > 0 ? "danger" : summary.pending > 0 || summary.unchecked > 0 ? "warn" : "active";
  return (
    <button
      className={`profileAppSyncButton ${tone}`}
      disabled={disabled || !eligible || summary.total === 0}
      onClick={() => onOpen(profile)}
      type="button"
    >
      {!eligible
        ? t("不适用")
        : summary.total === 0
        ? t("无适用应用")
        : t("已同步 {synced}/{total}", { synced: summary.synced, total: summary.total })}
    </button>
  );
}

export function ChatGptAppSyncDialog({
  configs,
  locale,
  onChanged,
  onClose,
  onError,
  onNotice,
  profile,
}: {
  configs: ChatGptAppConfigView[];
  locale: AppLocale;
  onChanged: (config: ChatGptAppConfigView) => void;
  onClose: () => void;
  onError: (message: string) => void;
  onNotice: (message: string) => void;
  profile: ChatGptProfileView;
}) {
  const { t } = useI18n();
  const [busy, setBusy] = useState<string | null>(null);
  const rows = profileAppSyncRows(configs, profile);

  async function run(label: string, task: () => Promise<void>) {
    setBusy(label);
    onError("");
    try {
      await task();
    } catch (err) {
      onError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  async function configureTarget(row: ProfileAppSyncRow) {
    const desktop = window.squirrelSwitchDesktop;
    if (!desktop) {
      onError(t("ChatGPT 应用同步需要在 Squirrel Switch 桌面版中打开目标 Profile"));
      return;
    }
    await run(`configure-${row.config.id}`, async () => {
      onNotice(t("正在配置 ChatGPT 应用同步：{name}", { name: row.config.name }));
      const result = await desktop.configureChatGptAppSync({
        profile: toDesktopProfile(profile),
        configId: row.config.id,
      });
      if (!result.result) {
        throw new Error(result.error ?? t("ChatGPT 应用自动配置失败"));
      }
      const updated = await api.updateChatGptAppSyncStatus(
        row.config.id,
        profile.id,
        appSyncPayloadFromLinks(row.config, result.result.links),
      );
      onChanged(updated);
      onNotice(result.result.message || t("已完成 ChatGPT 应用配置检测"));
    });
  }

  async function copyConfigInfo(config: ChatGptAppConfigView) {
    await run(`copy-${config.id}`, async () => {
      await navigator.clipboard.writeText(appConfigClipboardText(config, locale));
      onNotice(t("填表信息已复制"));
    });
  }

  return (
    <div className="modalOverlay">
      <section className="modal appSyncDialog" role="dialog" aria-modal="true" aria-labelledby="app-sync-title">
        <header className="modalHeader">
          <div>
            <h2 id="app-sync-title">{t("应用同步明细")}</h2>
            <small>{profileLabel(profile, t)}</small>
          </div>
          <div className="modalActions">
            <button className="ghost" disabled={Boolean(busy)} onClick={onClose}>
              {t("关闭")}
            </button>
          </div>
        </header>
        <div className="cardBody tight">
          {rows.length === 0 ? (
            <div className="empty">{t("暂无适用于该会话的应用配置")}</div>
          ) : (
            <div className="tableWrap">
              <table className="table appSyncTable">
                <thead>
                  <tr>
                    <th>{t("应用")}</th>
                    <th>{t("类型")}</th>
                    <th>{t("状态")}</th>
                    <th>{t("上次同步")}</th>
                    <th>{t("错误")}</th>
                    <th style={{ textAlign: "right" }}>{t("操作")}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={`${row.config.id}-${profile.id}`}>
                      <td>
                        <span className="identity">
                          <strong>{row.config.name}</strong>
                          <small>{configEntryUrl(row.config)}</small>
                        </span>
                      </td>
                      <td>{typeLabel(row.config.type, locale)}</td>
                      <td><span className={`pill ${row.state.status}`}>{syncStatusLabel(row.state.status, locale)}</span></td>
                      <td>{formatAppSyncTime(row.state.lastSyncedAt, locale)}</td>
                      <td>{row.state.error || "-"}</td>
                      <td>
                        <span className="rowActions">
                          <IconButton title={t("一键配置")} disabled={Boolean(busy)} onClick={() => void configureTarget(row)}>
                            <Wand2 size={14} />
                          </IconButton>
                          <IconButton title={t("复制填表信息")} disabled={Boolean(busy)} onClick={() => void copyConfigInfo(row.config)}>
                            <Clipboard size={14} />
                          </IconButton>
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

export function typeLabel(type: ChatGptAppConfigView["type"], locale: AppLocale): string {
  if (type === "official_app") return locale === "en-US" ? "Official app" : "官方应用";
  return locale === "en-US" ? "Custom MCP" : "自定义 MCP";
}

export function syncStatusLabel(status: string, locale: AppLocale): string {
  const zh: Record<string, string> = {
    failed: "失败",
    pending: "待同步",
    skipped: "跳过",
    synced: "已同步",
    unchecked: "未检查",
  };
  const en: Record<string, string> = {
    failed: "Failed",
    pending: "Pending",
    skipped: "Skipped",
    synced: "Synced",
    unchecked: "Unchecked",
  };
  return (locale === "en-US" ? en : zh)[status] ?? status;
}

export function scopeLabel(config: ChatGptAppConfigView, profileCount: number, locale: AppLocale): string {
  if (config.scopeType === "all_profiles") {
    return locale === "en-US" ? `All ${profileCount}` : `全部 ${profileCount} 个`;
  }
  return locale === "en-US" ? `${config.targetProfileIds.length} selected` : `指定 ${config.targetProfileIds.length} 个`;
}

export function configEntryUrl(config: ChatGptAppConfigView): string {
  return config.type === "custom_mcp" ? config.mcpServerUrl ?? "-" : config.officialAppUrl ?? "-";
}

export function authTypeLabel(config: ChatGptAppConfigView, locale: AppLocale): string {
  if (config.type === "official_app") {
    return locale === "en-US" ? "Official" : "官方授权";
  }
  const labels: Record<string, string> = {
    bearer: "Bearer",
    none: locale === "en-US" ? "None" : "无",
    oauth: "OAuth",
    official: locale === "en-US" ? "Official" : "官方授权",
    unknown: locale === "en-US" ? "Unknown" : "未知",
  };
  const base = labels[config.authType] ?? config.authType;
  if (config.authType === "oauth") {
    return config.hasOAuthPassword
      ? `${base} / ${locale === "en-US" ? "Password saved" : "已保存密码"}`
      : `${base} / ${locale === "en-US" ? "No password" : "未保存密码"}`;
  }
  return base;
}

export function appConfigClipboardText(config: ChatGptAppConfigView, locale: AppLocale): string {
  return config.type === "custom_mcp"
    ? customMcpClipboardText(config, locale)
    : officialAppClipboardText(config, locale);
}

export function targetUrl(config: ChatGptAppConfigView): string {
  if (config.type === "custom_mcp") {
    return "https://chatgpt.com/apps#settings/Connectors";
  }
  return config.officialAppUrl || "https://chatgpt.com/apps";
}

function connectorIdFromUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const parsed = new URL(value);
    const parts = parsed.pathname.split("/").map((part) => part.trim()).filter(Boolean);
    return parts.find((part) => part.startsWith("connector_") || part.startsWith("asdk_app_")) ?? null;
  } catch {
    return null;
  }
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

function isGuestPlan(profile: ChatGptProfileView): boolean {
  const values = [profile.planType, profile.planLabel]
    .map((value) => value?.trim().toLowerCase())
    .filter((value): value is string => Boolean(value));
  return values.some((value) => value === "guest");
}

export function formatAppSyncTime(value: number | null | undefined, locale: AppLocale): string {
  if (!value) return "-";
  return new Intl.DateTimeFormat(locale, {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value * 1000));
}

function officialAppClipboardText(config: ChatGptAppConfigView, locale: AppLocale): string {
  const labels = locale === "en-US"
    ? { name: "Name", url: "Official app URL", appId: "App ID", note: "Note" }
    : { name: "名称", url: "官方应用 URL", appId: "应用 ID", note: "说明" };
  return [
    `${labels.name}: ${config.name}`,
    `${labels.url}: ${config.officialAppUrl ?? "-"}`,
    `${labels.appId}: ${config.officialAppId ?? "-"}`,
    `${labels.note}: ${config.description ?? "-"}`,
  ].join("\n");
}

function customMcpClipboardText(config: ChatGptAppConfigView, locale: AppLocale): string {
  const labels = locale === "en-US"
    ? { name: "Name", description: "Description", url: "Server URL", auth: "Auth", note: "Auth note" }
    : { name: "名称", description: "描述", url: "Server URL", auth: "认证方式", note: "认证备注" };
  return [
    `${labels.name}: ${config.name}`,
    `${labels.description}: ${config.description ?? "-"}`,
    `${labels.url}: ${config.mcpServerUrl ?? "-"}`,
    `${labels.auth}: ${config.authType}`,
    `${labels.note}: ${config.authNote ?? "-"}`,
  ].join("\n");
}

function toDesktopProfile(profile: ChatGptProfileView): ChatGptDesktopProfileInput {
  return {
    id: profile.id,
    displayName: profile.accountEmail ?? profile.accountName ?? profile.linkedCodexEmail ?? profile.displayName,
    linkedCodexEmail: profile.linkedCodexEmail,
    accountEmail: profile.accountEmail,
    accountId: profile.accountId,
    planLabel: profile.planLabel,
    browserKind: profile.browserKind,
    browserExecutablePath: profile.browserExecutablePath,
    browserProfileDir: profile.browserProfileDir,
  };
}

function profileLabel(profile: ChatGptProfileView, t: (text: string) => string): string {
  return profile.accountEmail ?? profile.accountName ?? profile.linkedCodexEmail ?? profile.displayName ?? t("未识别");
}

function IconButton({
  className,
  title,
  "aria-label": ariaLabel,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const label = ariaLabel ?? (typeof title === "string" ? title : undefined);
  return (
    <button
      className={`iconButton ${className ?? ""}`.trim()}
      title={title}
      aria-label={label}
      data-tooltip={label}
      {...props}
    />
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
