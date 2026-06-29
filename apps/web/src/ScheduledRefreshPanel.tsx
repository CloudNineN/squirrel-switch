import { useEffect, useState } from "react";
import type { CSSProperties } from "react";
import { CalendarClock, Play, RefreshCcw, Save } from "lucide-react";
import type {
  AccountView,
  RuntimeStatus,
  ScheduledRefreshExecution,
  ScheduledRefreshState,
  UpdateScheduledRefreshConfigPayload,
} from "@squirrel-switch/shared";
import { api } from "./api.js";
import { useI18n } from "./i18n.js";
import type { AppLocale } from "./i18n.js";
import "./scheduled-refresh.css";

interface ScheduledRefreshPanelProps {
  onAccountsChanged: (accounts: AccountView[], runtime: RuntimeStatus) => void;
}

const DEFAULT_FORM: UpdateScheduledRefreshConfigPayload = {
  enabled: false,
  intervalMinutes: 60,
  startTime: "07:00",
  endTime: "19:00",
  activateFiveHourWindow: false,
};
const DAY_MINUTES = 24 * 60;
const TIMELINE_MAX = DAY_MINUTES - 5;
const MIN_WINDOW_MINUTES = 5;

export function ScheduledRefreshPanel({ onAccountsChanged }: ScheduledRefreshPanelProps) {
  const { t, locale } = useI18n();
  const [state, setState] = useState<ScheduledRefreshState | null>(null);
  const [form, setForm] = useState<UpdateScheduledRefreshConfigPayload>(DEFAULT_FORM);
  const [busyAction, setBusyAction] = useState<"save" | "run-now" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const validationError = validateScheduledRefreshForm(form, locale);
  const lastResult = state?.lastResult ?? null;

  useEffect(() => {
    void loadScheduledRefresh();
  }, []);

  async function loadScheduledRefresh() {
    setError(null);
    try {
      applyState(await api.scheduledRefresh());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  function applyState(next: ScheduledRefreshState) {
    setState(next);
    setForm(next.config);
  }

  function updateForm(patch: Partial<UpdateScheduledRefreshConfigPayload>) {
    setForm((current) => ({ ...current, ...patch }));
  }

  function updateWindow(startMinutes: number, endMinutes: number) {
    setForm((current) => ({
      ...current,
      startTime: minutesToClock(startMinutes),
      endTime: minutesToClock(endMinutes),
    }));
  }

  async function saveConfig() {
    setBusyAction("save");
    setError(null);
    setNotice(null);
    try {
      applyState(await api.updateScheduledRefresh(form));
      setNotice(t("定时刷新配置已保存"));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyAction(null);
    }
  }

  async function runNow() {
    setBusyAction("run-now");
    setError(null);
    setNotice(null);
    try {
      const nextState = await api.runScheduledRefreshNow();
      applyState(nextState);
      const [accounts, runtime] = await Promise.all([api.accounts(), api.runtime()]);
      onAccountsChanged(accounts, runtime);
      setNotice(nextState.lastResult?.message ?? t("定时刷新已完成"));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyAction(null);
    }
  }

  return (
    <>
      <section className="card scheduledRefreshCard">
        <header className="cardHeader">
          <div className="left">
            <CalendarClock size={16} />
            <h2>{t("定时刷新")}</h2>
            <span className={`pill ${scheduledRefreshStatusClass(state?.status)}`}>
              {scheduledRefreshStatusLabel(state?.status, locale)}
            </span>
          </div>
          <div className="actions">
            <button disabled={busyAction === "run-now"} onClick={() => void runNow()}>
              <RefreshCcw className={busyAction === "run-now" ? "spin" : undefined} size={14} />
              {t("立即刷新")}
            </button>
            <button
              className="primary"
              disabled={busyAction === "save" || Boolean(validationError)}
              onClick={() => void saveConfig()}
            >
              <Save size={14} />
              {t("保存")}
            </button>
          </div>
        </header>
        <div className="cardBody scheduledRefreshBody">
          <div className="scheduledRefreshControls">
            <label className="toggleField">
              <span>{t("启用定时刷新")}</span>
              <button
                className={`toggleSwitch ${form.enabled ? "on" : ""}`}
                type="button"
                role="switch"
                aria-checked={form.enabled}
                onClick={() => updateForm({ enabled: !form.enabled })}
              >
                <span />
              </button>
            </label>
            <label className="formField intervalField">
              <span>{t("刷新间隔")}</span>
              <span className="intervalInputWrap">
                <input
                  type="number"
                  min={5}
                  step={5}
                  value={form.intervalMinutes}
                  onChange={(event) => updateForm({ intervalMinutes: Number(event.target.value) })}
                />
                <em>{t("分钟")}</em>
              </span>
            </label>
            <label className="toggleField">
              <span>{t("同时激活 5 小时额度")}</span>
              <button
                className={`toggleSwitch ${form.activateFiveHourWindow ? "on" : ""}`}
                type="button"
                role="switch"
                aria-checked={form.activateFiveHourWindow}
                onClick={() =>
                  updateForm({ activateFiveHourWindow: !form.activateFiveHourWindow })
                }
              >
                <span />
              </button>
            </label>
          </div>
          <TimeRangeEditor
            startTime={form.startTime}
            endTime={form.endTime}
            onChange={updateWindow}
          />
        </div>
        <div className="scheduledRefreshMeta">
          <MetaItem label={t("下次刷新")} value={formatTime(state?.nextRunAt, locale)} />
          <MetaItem label={t("上次开始")} value={formatTime(state?.lastRunAt, locale)} />
          <MetaItem label={t("上次完成")} value={formatTime(state?.lastFinishedAt, locale)} />
          <MetaItem
            label={t("上次结果")}
            value={
              lastResult
                ? t("{succeeded}/{total} 成功，{failed} 失败", {
                    succeeded: lastResult.succeeded,
                    total: lastResult.total,
                    failed: lastResult.failed,
                  })
                : "—"
            }
          />
        </div>
        {validationError && <div className="inlineError">{validationError}</div>}
        {error && <div className="inlineError">{error}</div>}
        {notice && <div className="scheduledRefreshResult">{notice}</div>}
      </section>

      <ExecutionList executions={state?.executions ?? []} locale={locale} />
    </>
  );
}

function TimeRangeEditor({
  startTime,
  endTime,
  onChange,
}: {
  startTime: string;
  endTime: string;
  onChange: (startMinutes: number, endMinutes: number) => void;
}) {
  const { t } = useI18n();
  const startMinutes = clockMinutes(startTime);
  const endMinutes = clockMinutes(endTime);
  const timelineStyle = {
    "--start-percent": `${(startMinutes / TIMELINE_MAX) * 100}%`,
    "--end-percent": `${(endMinutes / TIMELINE_MAX) * 100}%`,
  } as CSSProperties;

  function changeStart(value: number) {
    onChange(Math.min(value, endMinutes - MIN_WINDOW_MINUTES), endMinutes);
  }

  function changeEnd(value: number) {
    onChange(startMinutes, Math.max(value, startMinutes + MIN_WINDOW_MINUTES));
  }

  return (
    <div className="timeRangeEditor" style={timelineStyle}>
      <div className="timeRangeHeader">
        <div>
          <span>{t("开始时间")}</span>
          <strong>{startTime}</strong>
        </div>
        <div>
          <span>{t("结束时间")}</span>
          <strong>{endTime}</strong>
        </div>
      </div>
      <div className="timeRangeSurface">
        <div className="timeRangeTrack" />
        <div className="timeRangeSelected" />
        <div className="timeRangePointer start" />
        <div className="timeRangePointer end" />
        <div className="timeRangeLabel start">{startTime}</div>
        <div className="timeRangeLabel end">{endTime}</div>
        <input
          className="timeRangeInput start"
          type="range"
          min={0}
          max={TIMELINE_MAX}
          step={5}
          value={startMinutes}
          onChange={(event) => changeStart(Number(event.target.value))}
          aria-label={t("开始时间")}
        />
        <input
          className="timeRangeInput end"
          type="range"
          min={MIN_WINDOW_MINUTES}
          max={TIMELINE_MAX}
          step={5}
          value={endMinutes}
          onChange={(event) => changeEnd(Number(event.target.value))}
          aria-label={t("结束时间")}
        />
      </div>
      <div className="timeRangeTicks">
        <span>00:00</span>
        <span>06:00</span>
        <span>12:00</span>
        <span>18:00</span>
        <span>24:00</span>
      </div>
    </div>
  );
}

function ExecutionList({ executions, locale }: { executions: ScheduledRefreshExecution[]; locale: AppLocale }) {
  const { t } = useI18n();
  return (
    <section className="card">
      <header className="cardHeader">
        <div className="left">
          <Play size={16} />
          <h2>{t("执行列表")}</h2>
          <span className="count">{t("最近 {count} 条", { count: executions.length })}</span>
        </div>
      </header>
      <div className="cardBody tight">
        {executions.length === 0 ? (
          <div className="empty">{t("暂无定时刷新执行记录")}</div>
        ) : (
          <div className="scheduledExecutionList">
            {executions.map((execution) => (
              <div key={execution.id} className="scheduledExecution">
                <span className={`pill ${executionStatusClass(execution.status)}`}>
                  {executionStatusLabel(execution.status, locale)}
                </span>
                <div className="scheduledExecutionMain">
                  <strong>{execution.trigger}</strong>
                  <span>{execution.message}</span>
                </div>
                <div className="scheduledExecutionStats">
                  <span>{formatTime(execution.startedAt, locale)}</span>
                  <strong>
                    {t("{succeeded}/{total} 成功", { succeeded: execution.succeeded, total: execution.total })}
                  </strong>
                  <span>{t("{failed} 失败", { failed: execution.failed })}</span>
                  {(execution.activated > 0 || execution.activationFailed > 0) && (
                    <span>
                      {t("5小时激活 {activated} 个，跳过 {skipped} 个，失败 {failed} 个", {
                        activated: execution.activated,
                        skipped: execution.activationSkipped,
                        failed: execution.activationFailed,
                      })}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function MetaItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="scheduledRefreshMetaItem">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function validateScheduledRefreshForm(form: UpdateScheduledRefreshConfigPayload, locale: AppLocale): string | null {
  if (!Number.isInteger(form.intervalMinutes) || form.intervalMinutes < 5) {
    return locale === "en-US" ? "Refresh interval cannot be less than 5 minutes" : "刷新间隔不能小于 5 分钟";
  }
  if (!isClock(form.startTime) || !isClock(form.endTime)) {
    return locale === "en-US" ? "Time format must be HH:mm" : "时间格式必须为 HH:mm";
  }
  if (clockMinutes(form.endTime) <= clockMinutes(form.startTime)) {
    return locale === "en-US" ? "Overnight time windows are not supported" : "不支持跨天时间区间";
  }
  return null;
}

function scheduledRefreshStatusLabel(status: ScheduledRefreshState["status"] | undefined, locale: AppLocale) {
  const map: Record<ScheduledRefreshState["status"], string> = {
    disabled: locale === "en-US" ? "Disabled" : "已停用",
    waiting: locale === "en-US" ? "Waiting" : "等待触发",
    running: locale === "en-US" ? "Running" : "运行中",
    "outside-window": locale === "en-US" ? "Outside window" : "区间外",
  };
  return status ? map[status] : locale === "en-US" ? "Loading" : "读取中";
}

function scheduledRefreshStatusClass(status: ScheduledRefreshState["status"] | undefined) {
  if (status === "running") return "active";
  if (status === "outside-window") return "warn";
  return "";
}

function executionStatusLabel(status: ScheduledRefreshExecution["status"], locale: AppLocale) {
  const map: Record<ScheduledRefreshExecution["status"], string> = {
    success: locale === "en-US" ? "Success" : "成功",
    partial: locale === "en-US" ? "Partial" : "部分失败",
    failed: locale === "en-US" ? "Failed" : "失败",
  };
  return map[status];
}

function executionStatusClass(status: ScheduledRefreshExecution["status"]) {
  if (status === "success") return "active";
  return "warn";
}

function isClock(value: string): boolean {
  return /^([01]\d|2[0-3]):([0-5]\d)$/.test(value);
}

function clockMinutes(value: string): number {
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

function minutesToClock(value: number) {
  const clamped = Math.max(0, Math.min(TIMELINE_MAX, value));
  const hours = Math.floor(clamped / 60);
  const minutes = clamped % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function formatTime(value: number | null | undefined, locale: AppLocale) {
  if (!value) return "—";
  return new Intl.DateTimeFormat(locale, {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value * 1000));
}
