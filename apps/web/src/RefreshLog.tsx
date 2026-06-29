import { useI18n } from "./i18n.js";

type BusyState = { action: string; id?: string } | null;

export type RefreshLogEntry = {
  id: string;
  accountId: string | null;
  accountName: string;
  status: "running" | "success" | "error";
  message: string;
  time: number;
};

export function RefreshProgressBar({
  logs,
  busy,
  accountCount,
}: {
  logs: RefreshLogEntry[];
  busy: BusyState;
  accountCount: number;
}) {
  const { t } = useI18n();
  if (logs.length === 0) return null;
  const summary = refreshProgressSummary(logs, busy, accountCount, t);
  return (
    <section className={`refreshProgress ${summary.running ? "running" : ""}`}>
      <div className="refreshProgressMain">
        <div className="refreshProgressText">
          <strong>{summary.title}</strong>
          <span>{summary.detail}</span>
        </div>
      </div>
      <div className="refreshProgressTrack">
        <span style={{ width: `${summary.percent}%` }} />
      </div>
    </section>
  );
}

function refreshProgressSummary(
  logs: RefreshLogEntry[],
  busy: BusyState,
  accountCount: number,
  t: (text: string, values?: Record<string, string | number>) => string,
) {
  const accountLogs = logs.filter((log) => log.accountId);
  const completedLogs = accountLogs.filter((log) => log.status !== "running");
  const successCount = accountLogs.filter((log) => log.status === "success").length;
  const failedCount = accountLogs.filter((log) => log.status === "error").length;
  const runningLog = accountLogs.find((log) => log.status === "running");
  const isRunning = Boolean(busy && (busy.action === "refresh-all" || busy.action === "refresh"));
  const total =
    busy?.action === "refresh-all"
      ? Math.max(accountCount, accountLogs.length, 1)
      : Math.max(accountLogs.length, 1);
  const completed = Math.min(completedLogs.length, total);
  const percent = isRunning ? Math.max(4, Math.round((completed / total) * 100)) : 100;

  if (isRunning) {
    return {
      running: true,
      percent,
      title:
        busy?.action === "refresh-all"
          ? t("刷新中 {completed}/{total}", { completed, total })
          : t("刷新中"),
      detail: runningLog ? `${runningLog.accountName}: ${runningLog.message}` : t("正在准备刷新"),
    };
  }

  return {
    running: false,
    percent,
    title: failedCount > 0 ? t("刷新完成，失败 {count} 个", { count: failedCount }) : t("刷新完成"),
    detail: t("成功 {success} 个，失败 {failed} 个", { success: successCount, failed: failedCount }),
  };
}
