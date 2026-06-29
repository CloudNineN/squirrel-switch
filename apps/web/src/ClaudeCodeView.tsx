import { useEffect, useId, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  ChevronDown,
  Pencil,
  Play,
  Plus,
  Save,
  Settings2,
  Trash2,
  Upload,
} from "lucide-react";
import type {
  ClaudeCodeAuthHeader,
  ClaudeCodeBackupPayload,
  ClaudeCodeProfileView,
  ClaudeCodeProviderId,
  ClaudeCodeProviderTemplate,
  UpsertClaudeCodeProfilePayload,
} from "@squirrel-switch/shared";
import { api } from "./api.js";
import { useI18n } from "./i18n.js";
import type { AppLocale } from "./i18n.js";
import "./claude-code.css";

type Busy = string | null;
export type ClaudeCodeTab = "current" | "add" | "backup";

interface ClaudeCodeFormState {
  id: string | null;
  name: string;
  providerId: ClaudeCodeProviderId;
  baseUrl: string;
  mainModel: string;
  opusModel: string;
  sonnetModel: string;
  haikuModel: string;
  subagentModel: string;
  authHeader: ClaudeCodeAuthHeader;
  apiKey: string;
  clearApiKey: boolean;
  customHeadersJson: string;
  disableNonessentialTraffic: boolean;
  apiKeyHelperTtlMs: string;
}

const EMPTY_FORM: ClaudeCodeFormState = {
  id: null,
  name: "",
  providerId: "deepseek",
  baseUrl: "",
  mainModel: "",
  opusModel: "",
  sonnetModel: "",
  haikuModel: "",
  subagentModel: "",
  authHeader: "x-api-key",
  apiKey: "",
  clearApiKey: false,
  customHeadersJson: "",
  disableNonessentialTraffic: true,
  apiKeyHelperTtlMs: "300000",
};

export function ClaudeCodeView({
  activeTab,
  onTabChange,
  onProfileCountChange,
}: {
  activeTab: ClaudeCodeTab;
  onTabChange: (next: ClaudeCodeTab) => void;
  onProfileCountChange?: (count: number) => void;
}) {
  const { t, locale } = useI18n();
  const [providers, setProviders] = useState<ClaudeCodeProviderTemplate[]>([]);
  const [profiles, setProfiles] = useState<ClaudeCodeProfileView[]>([]);
  const [form, setForm] = useState<ClaudeCodeFormState | null>(null);
  const [launchPath, setLaunchPath] = useState("");
  const [includeApiKeys, setIncludeApiKeys] = useState(false);
  const [busy, setBusy] = useState<Busy>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const backupInputRef = useRef<HTMLInputElement | null>(null);

  const providerMap = useMemo(
    () => new Map(providers.map((provider) => [provider.id, provider])),
    [providers],
  );

  useEffect(() => {
    void load();
  }, []);

  async function load() {
    setError(null);
    try {
      const [nextProviders, nextProfiles] = await Promise.all([
        api.claudeCodeProviders(),
        api.claudeCodeProfiles(),
      ]);
      setProviders(nextProviders);
      setProfiles(nextProfiles);
      onProfileCountChange?.(nextProfiles.length);
      setForm((current) => current ?? initialForm(nextProviders));
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
      await load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  function startCreate() {
    setForm(initialForm(providers));
    onTabChange("add");
  }

  function startEdit(profile: ClaudeCodeProfileView) {
    setForm({
      id: profile.id,
      name: profile.name,
      providerId: profile.providerId,
      baseUrl: profile.baseUrl,
      mainModel: profile.mainModel,
      opusModel: profile.opusModel,
      sonnetModel: profile.sonnetModel,
      haikuModel: profile.haikuModel,
      subagentModel: profile.subagentModel,
      authHeader: profile.authHeader,
      apiKey: "",
      clearApiKey: false,
      customHeadersJson: profile.customHeadersJson,
      disableNonessentialTraffic: profile.disableNonessentialTraffic,
      apiKeyHelperTtlMs: String(profile.apiKeyHelperTtlMs ?? 300000),
    });
    onTabChange("add");
  }

  function updateForm(patch: Partial<ClaudeCodeFormState>) {
    setForm((current) => (current ? { ...current, ...patch } : current));
  }

  function changeProvider(providerId: ClaudeCodeProviderId) {
    const provider = providerMap.get(providerId);
    setForm((current) => (current && provider ? applyProviderTemplate(current, provider) : current));
  }

  async function saveProfile() {
    if (!form) return;
    const payload = formToPayload(form);
    if (!payload.apiKey && !form.id) {
      setError(t("请先粘贴 API key"));
      return;
    }
    await run("save-profile", async () => {
      if (form.id) {
        await api.updateClaudeCodeProfile(form.id, payload);
        setNotice(t("Claude Code profile 已更新"));
      } else {
        await api.createClaudeCodeProfile(payload);
        setNotice(t("Claude Code profile 已创建"));
      }
      onTabChange("current");
    });
  }

  async function saveProfileForAction(action: "user-settings" | "launch") {
    if (!form) return;
    const payload = formToPayload(form);
    if (!payload.apiKey && !form.id) {
      setError(t("请先粘贴 API key"));
      return;
    }
    await run(`save-${action}`, async () => {
      const profile = form.id
        ? await api.updateClaudeCodeProfile(form.id, payload)
        : await api.createClaudeCodeProfile(payload);
      if (action === "user-settings") {
        await api.applyClaudeCodeProfile(profile.id, { target: { type: "user-settings" } });
        setNotice(t("已保存并应用到用户级配置：{name}", { name: profile.name }));
      } else {
        await api.launchClaudeCodeProfile(profile.id, launchPath.trim() || undefined);
        setNotice(t("已保存并启动 Claude Code：{name}", { name: profile.name }));
      }
      setForm(initialForm(providers));
      onTabChange("current");
    });
  }

  async function deleteProfile(profile: ClaudeCodeProfileView) {
    if (!window.confirm(t("确认删除「{name}」？", { name: profile.name }))) return;
    await run(`delete-${profile.id}`, async () => {
      await api.deleteClaudeCodeProfile(profile.id);
      setNotice(t("Claude Code profile 已删除"));
    });
  }

  async function applyUser(profile: ClaudeCodeProfileView) {
    await run(`apply-user-${profile.id}`, async () => {
      await api.applyClaudeCodeProfile(profile.id, { target: { type: "user-settings" } });
      setNotice(t("已应用到用户级 settings：{name}", { name: profile.name }));
    });
  }

  async function applyProject(profile: ClaudeCodeProfileView) {
    const trimmed = window.prompt(t("项目路径"), "")?.trim() ?? "";
    if (!trimmed) return;
    await run(`apply-project-${profile.id}`, async () => {
      await api.applyClaudeCodeProfile(profile.id, {
        target: { type: "project-local-settings", projectPath: trimmed },
      });
      setNotice(t("已应用到项目本地 settings：{name}", { name: profile.name }));
    });
  }

  async function launch(profile: ClaudeCodeProfileView) {
    await run(`launch-${profile.id}`, async () => {
      await api.launchClaudeCodeProfile(profile.id, launchPath.trim() || undefined);
      setNotice(t("已在 Terminal 启动 Claude Code：{name}", { name: profile.name }));
    });
  }

  async function exportBackup() {
    if (includeApiKeys && !window.confirm(t("备份将包含 Claude Code API key，确认继续？"))) return;
    await run("export-claude-backup", async () => {
      const backup = await api.exportClaudeCodeBackup(includeApiKeys);
      downloadJson(
        backup,
        `squirrel-switch-claude-code-${new Date().toISOString().slice(0, 10)}.json`,
      );
      setNotice(
        includeApiKeys
          ? t("已导出 {count} 个 profile，包含 API key", { count: backup.profiles.length })
          : t("已导出 {count} 个 profile，不含 API key", { count: backup.profiles.length }),
      );
    });
  }

  async function importBackupFile(file: File) {
    await run("import-claude-backup", async () => {
      const backup = JSON.parse(await file.text()) as ClaudeCodeBackupPayload;
      const result = await api.importClaudeCodeBackup(backup);
      setNotice(t("已导入 {count} 个 Claude Code profile", { count: result.imported }));
    });
  }

  return (
    <div className="claudePage">
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

      {activeTab === "current" && (
        <CurrentConfigPanel
          profiles={profiles}
          busy={busy}
          onCreate={startCreate}
          onApplyUser={(profile) => void applyUser(profile)}
          onApplyProject={(profile) => void applyProject(profile)}
          onLaunch={(profile) => void launch(profile)}
          onEdit={startEdit}
          onDelete={(profile) => void deleteProfile(profile)}
          locale={locale}
        />
      )}

      {activeTab === "add" && form && (
        <ProfileEditor
          form={form}
          providers={providers}
          busy={busy}
          launchPath={launchPath}
          onChange={updateForm}
          onLaunchPathChange={setLaunchPath}
          onProviderChange={changeProvider}
          onReset={startCreate}
          onSave={() => void saveProfile()}
          onSaveAndApply={() => void saveProfileForAction("user-settings")}
          onSaveAndLaunch={() => void saveProfileForAction("launch")}
        />
      )}

      {activeTab === "backup" && (
        <BackupPanel
          busy={busy}
          includeApiKeys={includeApiKeys}
          profileCount={profiles.length}
          inputRef={backupInputRef}
          onIncludeApiKeysChange={setIncludeApiKeys}
          onExport={() => void exportBackup()}
          onPickImport={() => backupInputRef.current?.click()}
          onImportFile={(file) => void importBackupFile(file)}
        />
      )}

    </div>
  );
}

function CurrentConfigPanel({
  profiles,
  busy,
  onCreate,
  onApplyUser,
  onApplyProject,
  onLaunch,
  onEdit,
  onDelete,
  locale,
}: {
  profiles: ClaudeCodeProfileView[];
  busy: Busy;
  onCreate: () => void;
  onApplyUser: (profile: ClaudeCodeProfileView) => void;
  onApplyProject: (profile: ClaudeCodeProfileView) => void;
  onLaunch: (profile: ClaudeCodeProfileView) => void;
  onEdit: (profile: ClaudeCodeProfileView) => void;
  onDelete: (profile: ClaudeCodeProfileView) => void;
  locale: AppLocale;
}) {
  const { t } = useI18n();
  const activeProfile = profiles.find((profile) => profile.isActive) ?? profiles[0] ?? null;
  return (
    <section className="currentConfigGrid">
      <div className="currentConfigHero">
        <span className="eyebrow">{t("当前 API")}</span>
        {activeProfile ? (
          <>
            <h2>{activeProfile.name}</h2>
            <p>
              {activeProfile.providerName} · {activeProfile.mainModel || t("未指定模型")}
            </p>
            <div className="quickActions">
              <button className="primary" disabled={Boolean(busy)} onClick={() => onApplyUser(activeProfile)}>
                <Settings2 size={14} />
                {t("应用到全局")}
              </button>
              <button disabled={Boolean(busy)} onClick={() => onLaunch(activeProfile)}>
                <Play size={14} />
                {t("启动 Claude Code")}
              </button>
              <button disabled={Boolean(busy)} onClick={() => onEdit(activeProfile)}>
                <Pencil size={14} />
                {t("编辑")}
              </button>
            </div>
          </>
        ) : (
          <>
            <h2>{t("还没有可用 API")}</h2>
            <p>{t("添加一个 provider API key 后即可切换 Claude Code。")}</p>
            <button className="primary" onClick={onCreate}>
              <Plus size={14} />
              {t("添加 API")}
            </button>
          </>
        )}
      </div>

      <ProfilesTable
        profiles={profiles}
        busy={busy}
        onApplyUser={onApplyUser}
        onApplyProject={onApplyProject}
        onLaunch={onLaunch}
        onEdit={onEdit}
        onDelete={onDelete}
        locale={locale}
      />
    </section>
  );
}

function ProfilesTable({
  profiles,
  busy,
  onApplyUser,
  onApplyProject,
  onLaunch,
  onEdit,
  onDelete,
  locale,
}: {
  profiles: ClaudeCodeProfileView[];
  busy: Busy;
  onApplyUser: (profile: ClaudeCodeProfileView) => void;
  onApplyProject: (profile: ClaudeCodeProfileView) => void;
  onLaunch: (profile: ClaudeCodeProfileView) => void;
  onEdit: (profile: ClaudeCodeProfileView) => void;
  onDelete: (profile: ClaudeCodeProfileView) => void;
  locale: AppLocale;
}) {
  const { t } = useI18n();
  return (
    <section className="card">
      <header className="cardHeader">
        <div className="left">
          <h2>{t("已保存 API")}</h2>
          <span className="count">{t("{count} 个", { count: profiles.length })}</span>
        </div>
      </header>
      <div className="cardBody tight">
        {profiles.length === 0 ? (
          <div className="empty">{t("暂无 Claude Code profile")}</div>
        ) : (
          <div className="tableWrap">
            <table className="table claudeProfilesTable">
              <thead>
                <tr>
                  <th>{t("状态")}</th>
                  <th>{t("名称")}</th>
                  <th>Provider</th>
                  <th>Base URL</th>
                  <th>{t("模型")}</th>
                  <th>{t("密钥")}</th>
                  <th style={{ textAlign: "right" }}>{t("操作")}</th>
                </tr>
              </thead>
              <tbody>
                {profiles.map((profile) => (
                  <tr key={profile.id} className={profile.isActive ? "active" : undefined}>
                    <td>{profile.isActive ? <span className="pill active">{t("当前")}</span> : <span className="pill">{t("备用")}</span>}</td>
                    <td>
                      <span className="identity">
                        <strong>{profile.name}</strong>
                        <small>{formatTime(profile.lastAppliedAt, locale)}</small>
                      </span>
                    </td>
                    <td>{profile.providerName}</td>
                    <td className="monoCell">{profile.baseUrl || "—"}</td>
                    <td>
                      <span className="identity">
                        <strong>{profile.mainModel || "—"}</strong>
                        <small>{profile.sonnetModel || profile.subagentModel || t("未覆盖")}</small>
                      </span>
                    </td>
                    <td>{profile.hasApiKey ? <span className="pill active">{t("已保存")}</span> : <span className="pill warn">{t("缺失")}</span>}</td>
                    <td>
                      <div className="rowActions">
                        <IconButton title={t("应用到用户级配置")} disabled={Boolean(busy)} onClick={() => onApplyUser(profile)}>
                          <Settings2 size={14} />
                        </IconButton>
                        <IconButton title={t("应用到项目本地配置")} disabled={Boolean(busy)} onClick={() => onApplyProject(profile)}>
                          <Save size={14} />
                        </IconButton>
                        <IconButton title={t("启动 Claude Code")} disabled={Boolean(busy)} onClick={() => onLaunch(profile)}>
                          <Play size={14} />
                        </IconButton>
                        <IconButton title={t("编辑")} disabled={Boolean(busy)} onClick={() => onEdit(profile)}>
                          <Pencil size={14} />
                        </IconButton>
                        <IconButton className="danger" title={t("删除")} disabled={Boolean(busy)} onClick={() => onDelete(profile)}>
                          <Trash2 size={14} />
                        </IconButton>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}

function ProfileEditor({
  form,
  providers,
  busy,
  launchPath,
  onChange,
  onLaunchPathChange,
  onProviderChange,
  onReset,
  onSave,
  onSaveAndApply,
  onSaveAndLaunch,
}: {
  form: ClaudeCodeFormState;
  providers: ClaudeCodeProviderTemplate[];
  busy: Busy;
  launchPath: string;
  onChange: (patch: Partial<ClaudeCodeFormState>) => void;
  onLaunchPathChange: (value: string) => void;
  onProviderChange: (providerId: ClaudeCodeProviderId) => void;
  onReset: () => void;
  onSave: () => void;
  onSaveAndApply: () => void;
  onSaveAndLaunch: () => void;
}) {
  const { t } = useI18n();
  const provider = providers.find((candidate) => candidate.id === form.providerId);
  return (
    <section className="card claudeQuickStart">
      <div className="quickIntro">
        <div>
          <span className="eyebrow">{t("快速添加")}</span>
          <h2>{form.id ? t("编辑 {name}", { name: form.name }) : t("选择服务商，粘贴 API key")}</h2>
        </div>
        <button className="ghost" onClick={onReset}>
          <Plus size={14} />
          {t("新建")}
        </button>
      </div>

      <div className="providerGrid">
        {providers.map((item) => (
          <button
            key={item.id}
            className={`providerCard ${form.providerId === item.id ? "active" : ""}`}
            onClick={() => onProviderChange(item.id)}
          >
            <strong>{item.displayName}</strong>
            <small>{item.defaultModels.main || t("自定义模型")}</small>
          </button>
        ))}
      </div>

      <div className="quickKeyRow">
        <Field label="API key">
          <input
            type="password"
            value={form.apiKey}
            onChange={(event) => onChange({ apiKey: event.target.value })}
            placeholder={form.id ? t("留空则继续使用已保存密钥") : t("粘贴 provider API key")}
            autoComplete="off"
          />
        </Field>
        <Field label={t("备注名")}>
          <input
            value={form.name}
            onChange={(event) => onChange({ name: event.target.value })}
            placeholder={provider?.displayName ?? t("默认使用服务商名称")}
          />
        </Field>
        <Field label={t("启动目录")}>
          <input
            value={launchPath}
            onChange={(event) => onLaunchPathChange(event.target.value)}
            placeholder={t("留空使用用户目录")}
          />
        </Field>
      </div>

      <div className="quickActions">
        <button disabled={busy === "save-profile"} onClick={onSave}>
          <Save size={14} />
          {t("保存")}
        </button>
        <button className="primary" disabled={busy === "save-user-settings"} onClick={onSaveAndApply}>
          <Settings2 size={14} />
          {t("保存并应用")}
        </button>
        <button disabled={busy === "save-launch"} onClick={onSaveAndLaunch}>
          <Play size={14} />
          {t("保存并启动")}
        </button>
      </div>

      <details className="advancedSettings">
        <summary>
          <ChevronDown size={14} />
          {t("高级配置")}
        </summary>
        <div className="claudeFormGrid">
          <Field label="Base URL">
            <input
              value={form.baseUrl}
              onChange={(event) => onChange({ baseUrl: event.target.value })}
            />
          </Field>
          <Field label={t("鉴权")}>
            <select
              value={form.authHeader}
              onChange={(event) =>
                onChange({ authHeader: event.target.value as ClaudeCodeAuthHeader })
              }
            >
              <option value="x-api-key">X-Api-Key</option>
              <option value="authorization-bearer">Bearer Token</option>
            </select>
          </Field>
          <Field label={t("主模型")}>
            <ModelInput
              value={form.mainModel}
              options={provider?.modelOptions ?? []}
              onChange={(value) => onChange({ mainModel: value })}
            />
          </Field>
          <Field label="Opus">
            <ModelInput
              value={form.opusModel}
              options={provider?.modelOptions ?? []}
              onChange={(value) => onChange({ opusModel: value })}
            />
          </Field>
          <Field label="Sonnet">
            <ModelInput
              value={form.sonnetModel}
              options={provider?.modelOptions ?? []}
              onChange={(value) => onChange({ sonnetModel: value })}
            />
          </Field>
          <Field label="Haiku">
            <ModelInput
              value={form.haikuModel}
              options={provider?.modelOptions ?? []}
              onChange={(value) => onChange({ haikuModel: value })}
            />
          </Field>
          <Field label="Subagent">
            <ModelInput
              value={form.subagentModel}
              options={provider?.modelOptions ?? []}
              onChange={(value) => onChange({ subagentModel: value })}
            />
          </Field>
          <Field label="Helper TTL">
            <input
              value={form.apiKeyHelperTtlMs}
              onChange={(event) => onChange({ apiKeyHelperTtlMs: event.target.value })}
            />
          </Field>
          <label className="checkRow">
            <input
              type="checkbox"
              checked={form.disableNonessentialTraffic}
              onChange={(event) => onChange({ disableNonessentialTraffic: event.target.checked })}
            />
            <span>{t("禁用非必要流量")}</span>
          </label>
          {form.id && (
            <label className="checkRow">
              <input
                type="checkbox"
                checked={form.clearApiKey}
                onChange={(event) => onChange({ clearApiKey: event.target.checked })}
              />
              <span>{t("清空已保存 API key")}</span>
            </label>
          )}
          <Field label={t("自定义 headers")} wide>
            <textarea
              value={form.customHeadersJson}
              onChange={(event) => onChange({ customHeadersJson: event.target.value })}
              placeholder='{ "HTTP-Referer": "https://example.com" }'
            />
          </Field>
        </div>
      </details>
    </section>
  );
}

function BackupPanel({
  busy,
  includeApiKeys,
  profileCount,
  inputRef,
  onIncludeApiKeysChange,
  onExport,
  onPickImport,
  onImportFile,
}: {
  busy: Busy;
  includeApiKeys: boolean;
  profileCount: number;
  inputRef: React.RefObject<HTMLInputElement | null>;
  onIncludeApiKeysChange: (value: boolean) => void;
  onExport: () => void;
  onPickImport: () => void;
  onImportFile: (file: File) => void;
}) {
  const { t } = useI18n();
  return (
    <>
      <section className="addGrid transferGrid">
        <div className="addCard transferCard">
          <div className="icon">
            <Download size={18} />
          </div>
          <h3>{t("导出配置备份")}</h3>
          <p>{t("导出已保存的 Claude Code 配置，用于导入到另一台 Mac。")}</p>
          <label className="checkRow">
            <input
              type="checkbox"
              checked={includeApiKeys}
              onChange={(event) => onIncludeApiKeysChange(event.target.checked)}
            />
            <span>{t("包含 API key")}</span>
          </label>
          <button className="primary" disabled={profileCount === 0 || busy === "export-claude-backup"} onClick={onExport}>
            <Download size={14} />
            {t("导出备份")}
          </button>
        </div>

        <div className="addCard transferCard">
          <div className="icon">
            <Upload size={18} />
          </div>
          <h3>{t("导入配置备份")}</h3>
          <p>{t("选择从另一台 Mac 导出的 Claude Code 配置备份，导入后会在本机重新加密保存。")}</p>
          <input
            ref={inputRef}
            className="hiddenFileInput"
            type="file"
            accept="application/json,.json"
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              event.currentTarget.value = "";
              if (file) onImportFile(file);
            }}
          />
          <button disabled={busy === "import-claude-backup"} onClick={onPickImport}>
            <Upload size={14} />
            {t("选择备份")}
          </button>
        </div>
      </section>

      <div className="hint">
        <AlertTriangle size={14} />
        <span>
          {t("备份默认不包含 API key；勾选包含 API key 后，备份文件只适合在你自己的设备之间迁移。")}
        </span>
      </div>
    </>
  );
}

function Field({
  label,
  wide,
  children,
}: {
  label: string;
  wide?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className={`field ${wide ? "wide" : ""}`}>
      <span>{label}</span>
      {children}
    </label>
  );
}

function ModelInput({
  value,
  options,
  onChange,
}: {
  value: string;
  options: string[];
  onChange: (value: string) => void;
}) {
  const listId = useId();
  return (
    <>
      <input value={value} onChange={(event) => onChange(event.target.value)} list={listId} />
      <datalist id={listId}>
        {options.map((option) => (
          <option key={option} value={option} />
        ))}
      </datalist>
    </>
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

function applyProviderTemplate(
  current: ClaudeCodeFormState,
  provider: ClaudeCodeProviderTemplate,
): ClaudeCodeFormState {
  return {
    ...current,
    providerId: provider.id,
    name: current.id ? current.name : "",
    baseUrl: provider.defaultBaseUrl,
    mainModel: provider.defaultModels.main ?? "",
    opusModel: provider.defaultModels.opus ?? "",
    sonnetModel: provider.defaultModels.sonnet ?? "",
    haikuModel: provider.defaultModels.haiku ?? "",
    subagentModel: provider.defaultModels.subagent ?? "",
    authHeader: provider.authHeader,
  };
}

function formToPayload(form: ClaudeCodeFormState): UpsertClaudeCodeProfilePayload {
  const displayName = providerDisplayName(form.providerId);
  return {
    name: form.name.trim() || displayName,
    providerId: form.providerId,
    baseUrl: form.baseUrl,
    mainModel: form.mainModel,
    opusModel: form.opusModel,
    sonnetModel: form.sonnetModel,
    haikuModel: form.haikuModel,
    subagentModel: form.subagentModel,
    authHeader: form.authHeader,
    apiKey: form.apiKey || undefined,
    clearApiKey: form.clearApiKey,
    customHeadersJson: form.customHeadersJson,
    disableNonessentialTraffic: form.disableNonessentialTraffic,
    apiKeyHelperTtlMs: Number(form.apiKeyHelperTtlMs) || 300000,
  };
}

function initialForm(providers: ClaudeCodeProviderTemplate[]): ClaudeCodeFormState | null {
  const preferred =
    providers.find((provider) => provider.id === "deepseek") ??
    providers.find((provider) => provider.id === "glm-global") ??
    providers[0];
  return preferred ? applyProviderTemplate({ ...EMPTY_FORM }, preferred) : null;
}

function providerDisplayName(providerId: ClaudeCodeProviderId) {
  const map: Record<ClaudeCodeProviderId, string> = {
    anthropic: "Anthropic API",
    "glm-global": "GLM Global",
    "glm-china": "GLM China",
    deepseek: "DeepSeek",
    kimi: "Kimi",
    openrouter: "OpenRouter",
  };
  return map[providerId];
}

function downloadJson(payload: unknown, filename: string) {
  const blob = new Blob([`${JSON.stringify(payload, null, 2)}\n`], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function formatTime(value: number | null | undefined, locale: AppLocale) {
  if (!value) return locale === "en-US" ? "Not applied" : "未应用";
  return new Intl.DateTimeFormat(locale, {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value * 1000));
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
