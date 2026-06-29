import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Clipboard,
  ExternalLink,
  ListChecks,
  Plus,
  Save,
  SkipForward,
  Trash2,
} from "lucide-react";
import type {
  ChatGptAppAuthType,
  ChatGptAppConfigManagementState,
  ChatGptAppConfigProfileView,
  ChatGptAppConfigType,
  ChatGptAppConfigView,
  ChatGptAppScopeType,
  ChatGptAppSyncStateView,
  ChatGptDesktopProfileInput,
  UpsertChatGptAppConfigPayload,
} from "@squirrel-switch/shared";
import { api } from "./api.js";
import { useI18n } from "./i18n.js";
import type { AppLocale } from "./i18n.js";
import "./chatgpt-apps.css";

type Busy = string | null;

interface FormState {
  id: string | null;
  type: ChatGptAppConfigType;
  name: string;
  description: string;
  officialAppUrl: string;
  officialAppId: string;
  mcpServerUrl: string;
  authType: ChatGptAppAuthType;
  authNote: string;
  scopeType: ChatGptAppScopeType;
  targetProfileIds: string[];
  enabled: boolean;
}

const emptyForm: FormState = {
  id: null,
  type: "custom_mcp",
  name: "",
  description: "",
  officialAppUrl: "",
  officialAppId: "",
  mcpServerUrl: "",
  authType: "none",
  authNote: "",
  scopeType: "all_profiles",
  targetProfileIds: [],
  enabled: true,
};

export function ChatGptAppsView() {
  const { t, locale } = useI18n();
  const [state, setState] = useState<ChatGptAppConfigManagementState | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const configs = state?.configs ?? [];
  const profiles = state?.profiles ?? [];
  const selectedConfig = useMemo(
    () => configs.find((config) => config.id === selectedId) ?? null,
    [configs, selectedId],
  );

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    if (!selectedConfig) {
      return;
    }
    setForm(formFromConfig(selectedConfig));
  }, [selectedConfig]);

  async function load(nextSelectedId = selectedId) {
    setError(null);
    try {
      const next = await api.chatGptAppConfigs();
      setState(next);
      const resolvedId = nextSelectedId && next.configs.some((config) => config.id === nextSelectedId)
        ? nextSelectedId
        : next.configs[0]?.id ?? null;
      setSelectedId(resolvedId);
      setForm(resolvedId ? formFromConfig(next.configs.find((config) => config.id === resolvedId)!) : emptyForm);
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  async function run(label: string, task: () => Promise<void>) {
    setBusy(label);
    setError(null);
    setNotice(null);
    try {
      await task();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  function startNewConfig() {
    setSelectedId(null);
    setForm(emptyForm);
    setError(null);
    setNotice(null);
  }

  async function saveConfig() {
    await run("save-config", async () => {
      const payload = payloadFromForm(form);
      const saved = form.id
        ? await api.updateChatGptAppConfig(form.id, payload)
        : await api.createChatGptAppConfig(payload);
      setNotice(t("ChatGPT 应用配置已保存，适用账号已标记为待同步"));
      await load(saved.id);
    });
  }

  async function deleteConfig(config: ChatGptAppConfigView) {
    if (!window.confirm(t("确认删除应用配置「{name}」？同步台账会一并删除。", { name: config.name }))) {
      return;
    }
    await run("delete-config", async () => {
      await api.deleteChatGptAppConfig(config.id);
      setNotice(t("ChatGPT 应用配置已删除"));
      await load(null);
    });
  }

  async function markStatus(
    config: ChatGptAppConfigView,
    stateRow: ChatGptAppSyncStateView,
    status: "synced" | "skipped",
  ) {
    await run(`${status}-${config.id}-${stateRow.profileId}`, async () => {
      const updated = await api.updateChatGptAppSyncStatus(config.id, stateRow.profileId, { status });
      setState((current) => replaceConfig(current, updated));
      setNotice(status === "synced" ? t("已标记为同步完成") : t("已标记为跳过"));
    });
  }

  async function openTarget(config: ChatGptAppConfigView, stateRow: ChatGptAppSyncStateView) {
    const profile = profiles.find((item) => item.id === stateRow.profileId);
    if (!profile) {
      setError(t("ChatGPT Profile 不存在"));
      return;
    }
    const desktop = window.squirrelSwitchDesktop;
    if (!desktop) {
      setError(t("ChatGPT 应用同步需要在 Squirrel Switch 桌面版中打开目标 Profile"));
      return;
    }
    await run(`open-${config.id}-${profile.id}`, async () => {
      const result = await desktop.openUrlInChatGpt(toDesktopProfile(profile), targetUrl(config));
      if (!result.opened) {
        throw new Error(result.error ?? t("ChatGPT 应用页打开失败"));
      }
      setNotice(t("已打开目标 ChatGPT Profile"));
    });
  }

  async function copyConfigInfo(config: ChatGptAppConfigView) {
    const text = config.type === "custom_mcp" ? customMcpClipboardText(config, locale) : officialAppClipboardText(config, locale);
    await navigator.clipboard.writeText(text);
    setNotice(t("填表信息已复制"));
  }

  return (
    <div className="chatgptAppsPage">
      {error && (
        <section className="notice error">
          <AlertTriangle size={16} />
          <span>{error}</span>
        </section>
      )}
      {notice && !error && (
        <section className="notice success">
          <CheckCircle2 size={16} />
          <span>{notice}</span>
        </section>
      )}

      <section className="chatgptAppsLayout">
        <aside className="card appConfigList">
          <header className="cardHeader">
            <div className="left">
              <ListChecks size={16} />
              <h2>{t("中心配置")}</h2>
            </div>
            <button onClick={startNewConfig}>
              <Plus size={14} />
              {t("新增")}
            </button>
          </header>
          <div className="cardBody tight">
            {configs.length === 0 ? (
              <div className="empty">{t("暂无 ChatGPT 应用配置")}</div>
            ) : (
              <div className="appConfigItems">
                {configs.map((config) => (
                  <button
                    className={`appConfigItem ${selectedId === config.id ? "active" : ""}`}
                    key={config.id}
                    onClick={() => setSelectedId(config.id)}
                  >
                    <strong>{config.name}</strong>
                    <small>{typeLabel(config.type, locale)} · {scopeLabel(config, profiles.length, locale)}</small>
                    <StatusSummary config={config} />
                  </button>
                ))}
              </div>
            )}
          </div>
        </aside>

        <section className="card appConfigEditor">
          <header className="cardHeader">
            <div className="left">
              <h2>{form.id ? t("编辑配置") : t("新增配置")}</h2>
            </div>
            <div className="actions">
              {selectedConfig && (
                <button disabled={Boolean(busy)} onClick={() => void deleteConfig(selectedConfig)}>
                  <Trash2 size={14} />
                  {t("删除")}
                </button>
              )}
              <button className="primary" disabled={Boolean(busy)} onClick={() => void saveConfig()}>
                <Save size={14} />
                {t("保存")}
              </button>
            </div>
          </header>
          <div className="cardBody appConfigForm">
            <label>
              <span>{t("类型")}</span>
              <select value={form.type} onChange={(event) => updateForm({ type: event.target.value as ChatGptAppConfigType })}>
                <option value="official_app">{t("官方应用")}</option>
                <option value="custom_mcp">{t("自定义 MCP")}</option>
              </select>
            </label>
            <label>
              <span>{t("名称")}</span>
              <input value={form.name} onChange={(event) => updateForm({ name: event.target.value })} placeholder={t("自定义工具")} />
            </label>
            <label className="full">
              <span>{t("描述")}</span>
              <textarea value={form.description} onChange={(event) => updateForm({ description: event.target.value })} placeholder={t("用于区分这个应用或 MCP 的作用")} />
            </label>
            {form.type === "official_app" ? (
              <>
                <label>
                  <span>{t("官方应用 URL")}</span>
                  <input value={form.officialAppUrl} onChange={(event) => updateForm({ officialAppUrl: event.target.value })} placeholder="https://chatgpt.com/apps" />
                </label>
                <label>
                  <span>{t("官方应用 ID")}</span>
                  <input value={form.officialAppId} onChange={(event) => updateForm({ officialAppId: event.target.value })} placeholder={t("可选")} />
                </label>
              </>
            ) : (
              <>
                <label>
                  <span>{t("MCP Server URL")}</span>
                  <input value={form.mcpServerUrl} onChange={(event) => updateForm({ mcpServerUrl: event.target.value })} placeholder="https://example.trycloudflare.com/mcp" />
                </label>
                <label>
                  <span>{t("认证方式")}</span>
                  <select value={form.authType} onChange={(event) => updateForm({ authType: event.target.value as ChatGptAppAuthType })}>
                    <option value="none">{t("无")}</option>
                    <option value="bearer">Bearer</option>
                    <option value="oauth">OAuth</option>
                    <option value="unknown">{t("未知")}</option>
                  </select>
                </label>
                <label className="full">
                  <span>{t("认证备注")}</span>
                  <input value={form.authNote} onChange={(event) => updateForm({ authNote: event.target.value })} placeholder={t("只记录提示，不保存密钥")} />
                </label>
              </>
            )}
            <label>
              <span>{t("适用范围")}</span>
              <select value={form.scopeType} onChange={(event) => updateForm({ scopeType: event.target.value as ChatGptAppScopeType })}>
                <option value="all_profiles">{t("全部 ChatGPT Profile")}</option>
                <option value="specific_profiles">{t("指定 Profile")}</option>
              </select>
            </label>
            <label className="checkLine">
              <input type="checkbox" checked={form.enabled} onChange={(event) => updateForm({ enabled: event.target.checked })} />
              <span>{t("启用配置")}</span>
            </label>
            {form.scopeType === "specific_profiles" && (
              <div className="profileScope full">
                {profiles.length === 0 ? (
                  <div className="empty small">{t("暂无 ChatGPT Profile")}</div>
                ) : (
                  profiles.map((profile) => (
                    <label className="profileScopeRow" key={profile.id}>
                      <input
                        type="checkbox"
                        checked={form.targetProfileIds.includes(profile.id)}
                        onChange={() => toggleTargetProfile(profile.id)}
                      />
                      <span>{profileDisplayName(profile)}</span>
                    </label>
                  ))
                )}
              </div>
            )}
          </div>
        </section>
      </section>

      <section className="card">
        <header className="cardHeader">
          <div className="left">
            <h2>{t("账号同步状态")}</h2>
            {selectedConfig && <span className="count">{shortHash(selectedConfig.configHash)}</span>}
          </div>
          {selectedConfig && (
            <button onClick={() => void copyConfigInfo(selectedConfig)}>
              <Clipboard size={14} />
              {t("复制填表信息")}
            </button>
          )}
        </header>
        <div className="cardBody tight">
          {!selectedConfig ? (
            <div className="empty">{t("选择或新增一个配置后查看同步台账")}</div>
          ) : selectedConfig.syncStates.length === 0 ? (
            <div className="empty">{t("暂无可同步的 ChatGPT Profile")}</div>
          ) : (
            <div className="tableWrap">
              <table className="table appSyncTable">
                <thead>
                  <tr>
                    <th>{t("Profile")}</th>
                    <th>{t("状态")}</th>
                    <th>{t("已同步版本")}</th>
                    <th>{t("上次同步")}</th>
                    <th>{t("错误")}</th>
                    <th style={{ textAlign: "right" }}>{t("操作")}</th>
                  </tr>
                </thead>
                <tbody>
                  {selectedConfig.syncStates.map((row) => (
                    <tr key={`${row.configId}-${row.profileId}`}>
                      <td>
                        <span className="identity">
                          <strong>{row.profileName}</strong>
                          <small>{row.profileEmail || row.linkedCodexEmail || t("未识别")}</small>
                        </span>
                      </td>
                      <td><span className={`pill ${row.status}`}>{syncStatusLabel(row.status, locale)}</span></td>
                      <td className="mono">{shortHash(row.syncedConfigHash)}</td>
                      <td>{formatTime(row.lastSyncedAt, locale)}</td>
                      <td>{row.error || "-"}</td>
                      <td>
                        <span className="rowActions">
                          <button title={t("打开应用页")} onClick={() => void openTarget(selectedConfig, row)}>
                            <ExternalLink size={14} />
                          </button>
                          <button title={t("标记已同步")} onClick={() => void markStatus(selectedConfig, row, "synced")}>
                            <CheckCircle2 size={14} />
                          </button>
                          <button title={t("标记跳过")} onClick={() => void markStatus(selectedConfig, row, "skipped")}>
                            <SkipForward size={14} />
                          </button>
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

  function updateForm(patch: Partial<FormState>) {
    setForm((current) => ({ ...current, ...patch }));
  }

  function toggleTargetProfile(profileId: string) {
    setForm((current) => ({
      ...current,
      targetProfileIds: current.targetProfileIds.includes(profileId)
        ? current.targetProfileIds.filter((id) => id !== profileId)
        : [...current.targetProfileIds, profileId],
    }));
  }
}

function formFromConfig(config: ChatGptAppConfigView): FormState {
  return {
    id: config.id,
    type: config.type,
    name: config.name,
    description: config.description ?? "",
    officialAppUrl: config.officialAppUrl ?? "",
    officialAppId: config.officialAppId ?? "",
    mcpServerUrl: config.mcpServerUrl ?? "",
    authType: config.authType,
    authNote: config.authNote ?? "",
    scopeType: config.scopeType,
    targetProfileIds: config.targetProfileIds,
    enabled: config.enabled,
  };
}

function payloadFromForm(form: FormState): UpsertChatGptAppConfigPayload {
  return {
    type: form.type,
    name: form.name,
    description: nullableText(form.description),
    officialAppUrl: nullableText(form.officialAppUrl),
    officialAppId: nullableText(form.officialAppId),
    mcpServerUrl: nullableText(form.mcpServerUrl),
    authType: form.type === "official_app" ? "official" : form.authType,
    authNote: nullableText(form.authNote),
    scopeType: form.scopeType,
    targetProfileIds: form.scopeType === "specific_profiles" ? form.targetProfileIds : [],
    enabled: form.enabled,
  };
}

function replaceConfig(
  state: ChatGptAppConfigManagementState | null,
  config: ChatGptAppConfigView,
): ChatGptAppConfigManagementState | null {
  if (!state) return state;
  return {
    ...state,
    configs: state.configs.map((item) => (item.id === config.id ? config : item)),
  };
}

function targetUrl(config: ChatGptAppConfigView): string {
  if (config.type === "custom_mcp") {
    return "https://chatgpt.com/apps#settings/Connectors";
  }
  return config.officialAppUrl || "https://chatgpt.com/apps";
}

function toDesktopProfile(profile: ChatGptAppConfigProfileView): ChatGptDesktopProfileInput {
  return {
    id: profile.id,
    displayName: profile.displayName,
    linkedCodexEmail: profile.linkedCodexEmail,
    accountEmail: profile.accountEmail,
    accountId: profile.accountId,
    planLabel: profile.planLabel,
    browserKind: profile.browserKind,
    browserExecutablePath: profile.browserExecutablePath,
    browserProfileDir: profile.browserProfileDir,
  };
}

function StatusSummary({ config }: { config: ChatGptAppConfigView }) {
  const pending = config.syncStates.filter((state) => state.status === "pending").length;
  const synced = config.syncStates.filter((state) => state.status === "synced").length;
  const failed = config.syncStates.filter((state) => state.status === "failed").length;
  return (
    <span className="statusSummary">
      <span>{synced} 已同步</span>
      <span>{pending} 待同步</span>
      <span>{failed} 失败</span>
    </span>
  );
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

function profileDisplayName(profile: ChatGptAppConfigProfileView): string {
  return profile.accountEmail || profile.accountName || profile.displayName;
}

function typeLabel(type: ChatGptAppConfigType, locale: AppLocale): string {
  if (type === "official_app") return locale === "en-US" ? "Official app" : "官方应用";
  return locale === "en-US" ? "Custom MCP" : "自定义 MCP";
}

function scopeLabel(config: ChatGptAppConfigView, profileCount: number, locale: AppLocale): string {
  if (config.scopeType === "all_profiles") {
    return locale === "en-US" ? `All ${profileCount}` : `全部 ${profileCount} 个`;
  }
  return locale === "en-US" ? `${config.targetProfileIds.length} selected` : `指定 ${config.targetProfileIds.length} 个`;
}

function syncStatusLabel(status: string, locale: AppLocale): string {
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

function nullableText(value: string): string | null {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function shortHash(value: string | null): string {
  return value ? value.slice(0, 8) : "-";
}

function formatTime(value: number | null | undefined, locale: AppLocale): string {
  if (!value) return "-";
  return new Intl.DateTimeFormat(locale, {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value * 1000));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
