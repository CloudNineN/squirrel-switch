import { AlertTriangle } from "lucide-react";
import { useI18n } from "./i18n.js";

export function ConfirmDialog({
  title,
  description,
  confirmLabel,
  tone = "default",
  disabled,
  onCancel,
  onConfirm,
}: {
  title: string;
  description: string;
  confirmLabel: string;
  tone?: "default" | "danger";
  disabled?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const { t } = useI18n();
  const confirmStyle =
    tone === "danger"
      ? { background: "var(--danger)", borderColor: "var(--danger)", color: "#ffffff" }
      : undefined;

  return (
    <div className="modalOverlay">
      <section className="modal" role="dialog" aria-modal="true" aria-labelledby="confirm-title">
        <header className="modalHeader">
          <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
            <AlertTriangle
              size={18}
              color={tone === "danger" ? "var(--danger)" : "var(--warning)"}
            />
            <div>
              <h2 id="confirm-title">{title}</h2>
              <small>{t("请确认后继续")}</small>
            </div>
          </div>
          <div className="modalActions">
            <button className="ghost" disabled={disabled} onClick={onCancel}>
              {t("取消")}
            </button>
            <button
              className="primary"
              style={confirmStyle}
              disabled={disabled}
              onClick={onConfirm}
            >
              {confirmLabel}
            </button>
          </div>
        </header>
        <div
          className="cardBody"
          style={{ color: "var(--text-secondary)", fontSize: 13, lineHeight: 1.6 }}
        >
          {description}
        </div>
      </section>
    </div>
  );
}
