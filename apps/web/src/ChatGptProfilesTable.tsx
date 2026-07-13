import type React from "react";
import {
  Link2,
  MessageSquare,
  Pencil,
  RefreshCcw,
  Trash2,
} from "lucide-react";
import type {
  ChatGptAppConfigView,
  ChatGptProfileView,
} from "@squirrel-switch/shared";
import { useI18n } from "./i18n.js";
import type { AppLocale } from "./i18n.js";
import { ProfileAppSyncButton } from "./chatgpt-app-sync.js";

type Busy = string | null;

export function ProfilesTable({
  appConfigs,
  busy,
  editingProfileId,
  editingProfileName,
  locale,
  onCancelRename,
  onBindCodex,
  onDelete,
  onEditingProfileNameChange,
  onOpen,
  onOpenAppSync,
  onRefreshAll,
  onSaveRename,
  onStartRename,
  profiles,
}: {
  appConfigs: ChatGptAppConfigView[];
  busy: Busy;
  editingProfileId: string | null;
  editingProfileName: string;
  locale: AppLocale;
  onCancelRename: () => void;
  onBindCodex: (profile: ChatGptProfileView) => void;
  onDelete: (profile: ChatGptProfileView) => void;
  onEditingProfileNameChange: (value: string) => void;
  onOpen: (profile: ChatGptProfileView) => void;
  onOpenAppSync: (profile: ChatGptProfileView) => void;
  onRefreshAll: () => void;
  onSaveRename: (profile: ChatGptProfileView) => void;
  onStartRename: (profile: ChatGptProfileView) => void;
  profiles: ChatGptProfileView[];
}) {
  const { t } = useI18n();
  return (
    <section className="card">
      <header className="cardHeader">
        <div className="left">
          <h2>{t("ChatGPT 会话")}</h2>
          <span className="count">{t("{count} 个", { count: profiles.length })}</span>
        </div>
        <div className="actions">
          <button className="primary" disabled={profiles.length === 0 || Boolean(busy)} onClick={onRefreshAll}>
            <RefreshCcw size={14} />
            {t("批量检查")}
          </button>
        </div>
      </header>
      <div className="cardBody tight">
        {profiles.length === 0 ? (
          <div className="empty">{t("暂无 ChatGPT 会话")}</div>
        ) : (
          <div className="tableWrap">
            <table className="table chatgptProfilesTable">
              <thead>
                <tr>
                  <th>{t("状态")}</th>
                  <th>{t("账号")}</th>
                  <th>{t("计划")}</th>
                  <th>{t("会员到期")}</th>
                  <th>{t("浏览器")}</th>
                  <th>{t("绑定 Codex")}</th>
                  <th>{t("应用同步")}</th>
                  <th>{t("上次检查")}</th>
                  <th style={{ textAlign: "right" }}>{t("操作")}</th>
                </tr>
              </thead>
              <tbody>
                {profiles.map((profile) => (
                  <tr key={profile.id}>
                    <td>
                      <SessionPill profile={profile} />
                    </td>
                    <td>
                      {editingProfileId === profile.id ? (
                        <span className="rename">
                          <input
                            autoFocus
                            value={editingProfileName}
                            onChange={(event) => onEditingProfileNameChange(event.target.value)}
                          />
                          <button onClick={() => onSaveRename(profile)}>{t("保存")}</button>
                          <button className="ghost" onClick={onCancelRename}>
                            {t("取消")}
                          </button>
                        </span>
                      ) : (
                        <AccountCell profile={profile} />
                      )}
                    </td>
                    <td>{formatPlan(profile, locale)}</td>
                    <td>{formatSubscription(profile, locale)}</td>
                    <td>{formatBrowser(profile, t)}</td>
                    <td>
                      <LinkedCodexCell profile={profile} />
                    </td>
                    <td>
                      <ProfileAppSyncButton
                        configs={appConfigs}
                        disabled={Boolean(busy)}
                        profile={profile}
                        onOpen={onOpenAppSync}
                      />
                    </td>
                    <td>{formatTime(profile.lastCheckedAt, locale)}</td>
                    <td>
                      <div className="rowActions">
                        <IconButton title={t("打开 ChatGPT")} disabled={Boolean(busy)} onClick={() => onOpen(profile)}>
                          <MessageSquare size={14} />
                        </IconButton>
                        {canBindCodex(profile) ? (
                          <IconButton title={t("绑定 Codex 账号")} disabled={Boolean(busy)} onClick={() => onBindCodex(profile)}>
                            <Link2 size={14} />
                          </IconButton>
                        ) : null}
                        <IconButton title={t("编辑备注")} disabled={Boolean(busy)} onClick={() => onStartRename(profile)}>
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

function canBindCodex(profile: ChatGptProfileView): boolean {
  return (
    profile.sessionStatus === "available" &&
    !profile.linkedCodexAccountId &&
    Boolean(profile.accountEmail || profile.accountId)
  );
}

export function profileDisplayLabel(profile: ChatGptProfileView, t: (text: string) => string): string {
  return profile.accountEmail ?? profile.accountName ?? profile.linkedCodexEmail ?? profile.displayName ?? t("未识别");
}

export function readablePlanLabel(planType: string | null, planLabel: string | null): string | null {
  const normalizedType = planType?.trim().toLowerCase() ?? null;
  if (normalizedType) {
    if (normalizedType === "plus") return "Plus";
    if (normalizedType === "pro") return "Pro";
    if (normalizedType === "team") return "Team";
    if (normalizedType === "enterprise") return "Enterprise";
    if (normalizedType === "free") return "Free";
  }
  const label = planLabel?.trim();
  if (!label || /^chatgpt[a-z0-9_-]*plan$/i.test(label)) {
    return null;
  }
  return label;
}

function SessionPill({ profile }: { profile: ChatGptProfileView }) {
  const { t } = useI18n();
  if (profile.sessionStatus === "available") {
    return <span className="pill active">{t("可用")}</span>;
  }
  if (profile.sessionStatus === "invalid") {
    return <span className="pill danger" title={profile.lastCheckError ?? undefined}>{t("失效")}</span>;
  }
  if (profile.sessionStatus === "reauth_required") {
    return <span className="pill warn" title={profile.lastCheckError ?? undefined}>{t("需验证")}</span>;
  }
  return <span className="pill warn">{t("未检查")}</span>;
}

function AccountCell({ profile }: { profile: ChatGptProfileView }) {
  const { t } = useI18n();
  const primary = profile.accountEmail ?? profile.accountName ?? profile.linkedCodexEmail;
  return (
    <span className="identity">
      <span className="identityNameRow">
        <strong>{profile.displayName}</strong>
      </span>
      <span className="identityMetaRow">
        <small>{primary ?? t("未识别")}</small>
      </span>
    </span>
  );
}

function LinkedCodexCell({ profile }: { profile: ChatGptProfileView }) {
  const { t } = useI18n();
  const name = profile.linkedCodexAccountName ?? profile.linkedCodexEmail;
  if (!profile.linkedCodexAccountId && !name) {
    return <span className="pill">{t("未绑定")}</span>;
  }
  return (
    <span className="identity">
      <strong>{name ?? t("已绑定")}</strong>
      {profile.linkedCodexEmail && name !== profile.linkedCodexEmail ? (
        <small>{profile.linkedCodexEmail}</small>
      ) : null}
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

function formatPlan(profile: ChatGptProfileView, locale: AppLocale) {
  return (
    readablePlanLabel(profile.planType, profile.planLabel) ??
    (locale === "en-US" ? "Unavailable" : "会员信息不可用")
  );
}

function formatSubscription(profile: ChatGptProfileView, locale: AppLocale) {
  if (isNonExpiringPlan(profile)) {
    return "-";
  }
  if (profile.subscriptionRenewsAt) {
    return formatTime(profile.subscriptionRenewsAt, locale);
  }
  if (profile.subscriptionExpiresAt) {
    return formatTime(profile.subscriptionExpiresAt, locale);
  }
  return locale === "en-US" ? "Unavailable" : "会员信息不可用";
}

function isNonExpiringPlan(profile: ChatGptProfileView): boolean {
  const values = [profile.planType, profile.planLabel]
    .map((value) => value?.trim().toLowerCase())
    .filter((value): value is string => Boolean(value));
  return values.some((value) => value === "free" || value === "guest");
}

function formatBrowser(profile: ChatGptProfileView, t: (text: string) => string): string {
  if (profile.browserKind === "edge") {
    return "Edge";
  }
  if (profile.browserKind === "custom") {
    return t("自定义");
  }
  return "Chrome";
}

function formatTime(value: number | null | undefined, locale: AppLocale) {
  if (!value) {
    return locale === "en-US" ? "Never" : "从未";
  }
  return new Intl.DateTimeFormat(locale, {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value * 1000));
}
