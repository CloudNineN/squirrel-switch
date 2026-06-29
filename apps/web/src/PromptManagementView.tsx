import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, FileText, Save } from "lucide-react";
import type {
  PromptManagementState,
  PromptPlatformId,
  PromptPlatformSource,
  PromptPlatformState,
} from "@squirrel-switch/shared";
import { api } from "./api.js";
import { useI18n } from "./i18n.js";
import type { AppLocale } from "./i18n.js";
import "./prompt-management.css";

type PromptTab = "system" | PromptPlatformId;

export function PromptManagementView() {
  const { t, locale } = useI18n();
  const [state, setState] = useState<PromptManagementState | null>(null);
  const [activeTab, setActiveTab] = useState<PromptTab>("system");
  const [content, setContent] = useState("");
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const activePlatform = useMemo(
    () => state?.platforms.find((platform) => platform.id === activeTab) ?? null,
    [activeTab, state],
  );

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    if (dirty || !state) return;
    setContent(activePlatform ? activePlatform.content : state.systemPrompt);
  }, [activePlatform, dirty, state]);

  async function load() {
    setError(null);
    try {
      const next = await api.promptManagement();
      setState(next);
      setContent(contentForTab(activeTab, next));
      setDirty(false);
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  function changeTab(nextTab: PromptTab) {
    setActiveTab(nextTab);
    if (!state) return;
    setContent(contentForTab(nextTab, state));
    setDirty(false);
    setError(null);
    setNotice(null);
  }

  function changeContent(nextContent: string) {
    setContent(nextContent);
    setDirty(true);
  }

  async function save() {
    if (!state) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      if (activeTab === "system") {
        const next = await api.updateSystemPrompt({ content });
        setState(next);
        setContent(next.systemPrompt);
        setNotice(t("系统提示词已保存"));
      } else {
        const platform = await api.updatePlatformPrompt(activeTab, { content });
        setState((current) => mergePlatform(current, platform));
        setContent(platform.content);
        setNotice(t("已保存到 {name}", { name: platform.name }));
      }
      setDirty(false);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="promptPage">
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

      <section className="promptLayout">
        <aside className="promptTabs" aria-label={t("提示词平台")}>
          <PromptTabButton
            active={activeTab === "system"}
            title={t("系统")}
            subtitle={t("内部默认提示词")}
            onClick={() => changeTab("system")}
          />
          {state?.platforms.map((platform) => (
            <PromptTabButton
              key={platform.id}
              active={activeTab === platform.id}
              title={platform.name}
              subtitle={sourceLabel(platform.source, locale)}
              onClick={() => changeTab(platform.id)}
            />
          ))}
        </aside>

        <section className="card promptEditor">
          <header className="cardHeader">
            <div className="left">
              <FileText size={16} />
              <h2>{activePlatform ? activePlatform.name : t("系统级提示词")}</h2>
            </div>
            <button className="primary" disabled={busy || !state} onClick={() => void save()}>
              <Save size={14} />
              {activePlatform ? t("保存到 {name}", { name: activePlatform.name }) : t("保存系统提示词")}
            </button>
          </header>
          <div className="cardBody promptEditorBody">
            {activePlatform ? <PlatformStatus platform={activePlatform} locale={locale} /> : <SystemStatus />}
            <textarea
              className="promptTextarea"
              value={content}
              placeholder={t("输入全局提示词...")}
              onChange={(event) => changeContent(event.target.value)}
            />
          </div>
        </section>
      </section>
    </div>
  );
}

function PromptTabButton({
  active,
  title,
  subtitle,
  onClick,
}: {
  active: boolean;
  title: string;
  subtitle: string;
  onClick: () => void;
}) {
  return (
    <button className={`promptTab ${active ? "active" : ""}`} onClick={onClick}>
      <strong>{title}</strong>
      <small>{subtitle}</small>
    </button>
  );
}

function SystemStatus() {
  const { t } = useI18n();
  return (
    <div className="promptMetaGrid">
      <MetaItem label={t("位置")} value={t("Squirrel Switch 内部配置")} />
      <MetaItem label={t("保存行为")} value={t("同步到空内容或跟随系统的文件")} />
    </div>
  );
}

function PlatformStatus({ platform, locale }: { platform: PromptPlatformState; locale: AppLocale }) {
  const { t } = useI18n();
  return (
    <div className="promptStatusStack">
      <div className="promptMetaGrid">
        <MetaItem label={t("目标路径")} value={platform.path} mono />
        <MetaItem label={t("文件状态")} value={fileStatusLabel(platform, locale)} />
        <MetaItem label={t("来源")} value={sourceLabel(platform.source, locale)} />
        <MetaItem label={t("更新时间")} value={formatTime(platform.updatedAt, locale)} />
      </div>
      <div className="promptPills">
        <span className={`pill ${platform.exists ? "active" : ""}`}>
          {platform.exists ? t("已存在") : t("未创建")}
        </span>
        <span className={`pill ${platform.readable ? "active" : "warn"}`}>
          {platform.readable ? t("可读取") : t("无法读取")}
        </span>
        <span className={`pill ${platform.writable ? "active" : "warn"}`}>
          {platform.writable ? t("可写入") : t("不可写")}
        </span>
        {platform.empty && <span className="pill">{t("为空")}</span>}
      </div>
      {platform.warnings.map((warning) => (
        <section className="notice info promptWarning" key={`${warning.code}-${warning.path ?? ""}`}>
          <AlertTriangle size={15} />
          <span>
            {warning.message}
            {warning.path ? ` ${warning.path}` : ""}
          </span>
        </section>
      ))}
    </div>
  );
}

function MetaItem({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="promptMetaItem">
      <span>{label}</span>
      <strong className={mono ? "mono" : undefined}>{value}</strong>
    </div>
  );
}

function contentForTab(tab: PromptTab, state: PromptManagementState): string {
  if (tab === "system") {
    return state.systemPrompt;
  }
  return state.platforms.find((platform) => platform.id === tab)?.content ?? "";
}

function mergePlatform(
  current: PromptManagementState | null,
  platform: PromptPlatformState,
): PromptManagementState | null {
  if (!current) {
    return current;
  }
  return {
    ...current,
    platforms: current.platforms.map((item) => (item.id === platform.id ? platform : item)),
  };
}

function fileStatusLabel(platform: PromptPlatformState, locale: AppLocale): string {
  if (!platform.exists) {
    return locale === "en-US" ? "Not created" : "未创建";
  }
  if (!platform.readable) {
    return locale === "en-US" ? "Unreadable" : "无法读取";
  }
  if (platform.empty) {
    return locale === "en-US" ? "Empty" : "为空";
  }
  return locale === "en-US" ? "Exists" : "已存在";
}

function sourceLabel(source: PromptPlatformSource, locale: AppLocale): string {
  const labels: Record<PromptPlatformSource, string> = {
    platform: locale === "en-US" ? "Platform prompt" : "平台提示词",
    system: locale === "en-US" ? "Using system prompt" : "使用系统提示词",
    empty: locale === "en-US" ? "Empty" : "空内容",
  };
  return labels[source];
}

function formatTime(value: number | null, locale: AppLocale): string {
  if (!value) {
    return locale === "en-US" ? "None" : "无";
  }
  return new Date(value * 1000).toLocaleString(locale);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
