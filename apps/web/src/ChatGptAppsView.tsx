import type React from "react";
import { useEffect, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Clipboard,
  Pencil,
  Plus,
  Save,
  Trash2,
} from "lucide-react";
import type {
  ChatGptAppAuthType,
  ChatGptAppConfigManagementState,
  ChatGptAppConfigProfileView,
  ChatGptAppConfigType,
  ChatGptAppConfigView,
  ChatGptAppScopeType,
  UpsertChatGptAppConfigPayload,
} from "@squirrel-switch/shared";
import { api } from "./api.js";
import { useI18n } from "./i18n.js";
import {
  appConfigClipboardText,
  appConfigStatusCounts,
  authTypeLabel,
  configEntryUrl,
  formatAppSyncTime,
  scopeLabel,
  typeLabel,
} from "./chatgpt-app-sync.js";
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
  hasOAuthPassword: boolean;
  oauthPassword: string;
  clearOAuthPassword: boolean;
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
  hasOAuthPassword: false,
  oauthPassword: "",
  clearOAuthPassword: false,
  scopeType: "all_profiles",
  targetProfileIds: [],
  enabled: true,
};

export function ChatGptAppsView() {
  const { t, locale } = useI18n();
  const [state, setState] = useState<ChatGptAppConfigManagementState | null>(null);
  const [form, setForm] = useState<FormState | null>(null);
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const configs = state?.configs ?? [];
  const profiles = state?.profiles ?? [];

  useEffect(() => {
    void load();
  }, []);

  async function load() {
    setError(null);
    try {
      setState(await api.chatGptAppConfigs());
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
    setForm({ ...emptyForm });
    setError(null);
    setNotice(null);
  }

  function startEditConfig(config: ChatGptAppConfigView) {
    setForm(formFromConfig(config));
    setError(null);
    setNotice(null);
  }

  async function saveConfig() {
    if (!form) {
      return;
    }
    await run("save-config", async () => {
      const payload = payloadFromForm(form);
      if (form.id) {
        await api.updateChatGptAppConfig(form.id, payload);
      } else {
        await api.createChatGptAppConfig(payload);
      }
      setNotice(t("ChatGPT 应用配置已保存"));
      setForm(null);
      await load();
    });
  }

  async function deleteConfig(config: ChatGptAppConfigView) {
    if (!window.confirm(t("确认删除应用配置「{name}」？同步台账会一并删除。", { name: config.name }))) {
      return;
    }
    await run("delete-config", async () => {
      await api.deleteChatGptAppConfig(config.id);
      setNotice(t("ChatGPT 应用配置已删除"));
      setForm((current) => (current?.id === config.id ? null : current));
      await load();
    });
  }

  async function copyConfigInfo(config: ChatGptAppConfigView) {
    await navigator.clipboard.writeText(appConfigClipboardText(config, locale));
    setNotice(t("填表信息已复制"));
  }

  function updateForm(patch: Partial<FormState>) {
    setForm((current) => (current ? { ...current, ...patch } : current));
  }

  function toggleTargetProfile(profileId: string) {
    setForm((current) => {
      if (!current) {
        return current;
      }
      return {
        ...current,
        targetProfileIds: current.targetProfileIds.includes(profileId)
          ? current.targetProfileIds.filter((id) => id !== profileId)
          : [...current.targetProfileIds, profileId],
      };
    });
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

      <section className="card">
        <header className="cardHeader">
          <div className="left">
            <h2>{t("中心配置")}</h2>
            <span className="count">{t("{count} 个", { count: configs.length })}</span>
          </div>
          <button className="primary" disabled={Boolean(busy)} onClick={startNewConfig}>
            <Plus size={14} />
            {t("新增")}
          </button>
        </header>
        <div className="cardBody tight">
          {configs.length === 0 ? (
            <div className="empty">{t("暂无 ChatGPT 应用配置")}</div>
          ) : (
            <div className="tableWrap">
              <table className="table appConfigTable">
                <thead>
                  <tr>
                    <th>{t("名称")}</th>
                    <th>{t("类型")}</th>
                    <th>{t("URL/入口")}</th>
                    <th>{t("认证")}</th>
                    <th>{t("适用范围")}</th>
                    <th>{t("启用")}</th>
                    <th>{t("同步状态")}</th>
                    <th>{t("更新时间")}</th>
                    <th style={{ textAlign: "right" }}>{t("操作")}</th>
                  </tr>
                </thead>
                <tbody>
                  {configs.map((config) => (
                    <tr key={config.id}>
                      <td>
                        <span className="identity">
                          <strong>{config.name}</strong>
                          <small>{config.description || "-"}</small>
                        </span>
                      </td>
                      <td>{typeLabel(config.type, locale)}</td>
                      <td className="appConfigUrl">{configEntryUrl(config)}</td>
                      <td>{authTypeLabel(config, locale)}</td>
                      <td>{scopeLabel(config, profiles.length, locale)}</td>
                      <td>
                        <span className={`readonlyStatus ${config.enabled ? "enabled" : "disabled"}`}>
                          {config.enabled ? t("启用") : t("停用")}
                        </span>
                      </td>
                      <td><ConfigStatusSummary config={config} /></td>
                      <td>{formatAppSyncTime(config.updatedAt, locale)}</td>
                      <td>
                        <span className="rowActions">
                          <IconButton title={t("编辑")} disabled={Boolean(busy)} onClick={() => startEditConfig(config)}>
                            <Pencil size={14} />
                          </IconButton>
                          <IconButton title={t("复制填表信息")} disabled={Boolean(busy)} onClick={() => void copyConfigInfo(config)}>
                            <Clipboard size={14} />
                          </IconButton>
                          <IconButton className="danger" title={t("删除")} disabled={Boolean(busy)} onClick={() => void deleteConfig(config)}>
                            <Trash2 size={14} />
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

      {form && (
        <ConfigFormDialog
          busy={busy}
          form={form}
          profiles={profiles}
          onCancel={() => setForm(null)}
          onChange={updateForm}
          onSave={() => void saveConfig()}
          onToggleTargetProfile={toggleTargetProfile}
        />
      )}
    </div>
  );
}

function ConfigFormDialog({
  busy,
  form,
  onCancel,
  onChange,
  onSave,
  onToggleTargetProfile,
  profiles,
}: {
  busy: Busy;
  form: FormState;
  onCancel: () => void;
  onChange: (patch: Partial<FormState>) => void;
  onSave: () => void;
  onToggleTargetProfile: (profileId: string) => void;
  profiles: ChatGptAppConfigProfileView[];
}) {
  const { t } = useI18n();
  return (
    <div className="modalOverlay">
      <section className="modal appConfigModal" role="dialog" aria-modal="true" aria-labelledby="app-config-form-title">
        <header className="modalHeader">
          <div>
            <h2 id="app-config-form-title">{form.id ? t("编辑配置") : t("新增配置")}</h2>
            <small>{t("维护 ChatGPT 应用或自定义 MCP 的中心配置")}</small>
          </div>
        </header>
        <div className="cardBody appConfigForm">
          <label>
            <span>{t("类型")}</span>
            <select value={form.type} onChange={(event) => onChange({ type: event.target.value as ChatGptAppConfigType })}>
              <option value="official_app">{t("官方应用")}</option>
              <option value="custom_mcp">{t("自定义 MCP")}</option>
            </select>
          </label>
          <label>
            <span>{t("名称")}</span>
            <input value={form.name} onChange={(event) => onChange({ name: event.target.value })} placeholder={t("自定义工具")} />
          </label>
          <label className="full">
            <span>{t("描述")}</span>
            <textarea value={form.description} onChange={(event) => onChange({ description: event.target.value })} placeholder={t("用于区分这个应用或 MCP 的作用")} />
          </label>
          {form.type === "official_app" ? (
            <>
              <label>
                <span>{t("官方应用 URL")}</span>
                <input value={form.officialAppUrl} onChange={(event) => onChange({ officialAppUrl: event.target.value })} placeholder="https://chatgpt.com/apps" />
              </label>
              <label>
                <span>{t("官方应用 ID")}</span>
                <input value={form.officialAppId} onChange={(event) => onChange({ officialAppId: event.target.value })} placeholder={t("可选")} />
              </label>
            </>
          ) : (
            <>
              <label>
                <span>{t("MCP Server URL")}</span>
                <input value={form.mcpServerUrl} onChange={(event) => onChange({ mcpServerUrl: event.target.value })} placeholder="https://example.trycloudflare.com/mcp" />
              </label>
              <label>
                <span>{t("认证方式")}</span>
                <select value={form.authType} onChange={(event) => onChange({ authType: event.target.value as ChatGptAppAuthType })}>
                  <option value="none">{t("无")}</option>
                  <option value="bearer">Bearer</option>
                  <option value="oauth">OAuth</option>
                  <option value="unknown">{t("未知")}</option>
                </select>
              </label>
              <label className="full">
                <span>{t("认证备注")}</span>
                <input value={form.authNote} onChange={(event) => onChange({ authNote: event.target.value })} placeholder={t("只记录提示，不保存密钥")} />
              </label>
              {form.authType === "oauth" && (
                <>
                  <label>
                    <span>{t("OAuth 密码")}</span>
                    <input
                      type="password"
                      value={form.oauthPassword}
                      onChange={(event) => onChange({ oauthPassword: event.target.value, clearOAuthPassword: false })}
                      placeholder={form.hasOAuthPassword ? t("留空保持已保存密码") : t("输入授权密码")}
                      autoComplete="new-password"
                    />
                    <small>{form.hasOAuthPassword ? t("已保存密码；不会展示、复制或写入日志") : t("未保存密码")}</small>
                  </label>
                  <label className="checkLine">
                    <input
                      type="checkbox"
                      checked={form.clearOAuthPassword}
                      disabled={!form.hasOAuthPassword}
                      onChange={(event) => onChange({
                        clearOAuthPassword: event.target.checked,
                        oauthPassword: event.target.checked ? "" : form.oauthPassword,
                      })}
                    />
                    <span>{t("清除已保存密码")}</span>
                  </label>
                </>
              )}
            </>
          )}
          <label>
            <span>{t("适用范围")}</span>
            <select value={form.scopeType} onChange={(event) => onChange({ scopeType: event.target.value as ChatGptAppScopeType })}>
              <option value="all_profiles">{t("全部 ChatGPT Profile")}</option>
              <option value="specific_profiles">{t("指定 Profile")}</option>
            </select>
          </label>
          <label className="checkLine">
            <input type="checkbox" checked={form.enabled} onChange={(event) => onChange({ enabled: event.target.checked })} />
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
                      onChange={() => onToggleTargetProfile(profile.id)}
                    />
                    <span>{profileDisplayName(profile)}</span>
                  </label>
                ))
              )}
            </div>
          )}
        </div>
        <footer className="modalFooter">
          <button className="ghost" disabled={Boolean(busy)} onClick={onCancel}>
            {t("取消")}
          </button>
          <button className="primary" disabled={Boolean(busy)} onClick={onSave}>
            <Save size={14} />
            {t("保存")}
          </button>
        </footer>
      </section>
    </div>
  );
}

function ConfigStatusSummary({ config }: { config: ChatGptAppConfigView }) {
  const { t } = useI18n();
  const counts = appConfigStatusCounts(config);
  return (
    <span className="statusSummary">
      <span>{t("{count} 已同步", { count: counts.synced })}</span>
      <span>{t("{count} 待同步", { count: counts.pending })}</span>
      <span>{t("{count} 失败", { count: counts.failed })}</span>
    </span>
  );
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
    hasOAuthPassword: config.hasOAuthPassword,
    oauthPassword: "",
    clearOAuthPassword: false,
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
    oauthPassword: form.type === "custom_mcp" && form.authType === "oauth"
      ? nullableText(form.oauthPassword)
      : null,
    clearOAuthPassword: form.type === "custom_mcp" && form.authType === "oauth"
      ? form.clearOAuthPassword
      : false,
    scopeType: form.scopeType,
    targetProfileIds: form.scopeType === "specific_profiles" ? form.targetProfileIds : [],
    enabled: form.enabled,
  };
}

function profileDisplayName(profile: ChatGptAppConfigProfileView): string {
  return profile.accountEmail || profile.accountName || profile.displayName;
}

function nullableText(value: string): string | null {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
