import type { RefObject } from "react";
import { AlertTriangle, Download, Upload } from "lucide-react";
import type { AccountView } from "@squirrel-switch/shared";
import { useI18n } from "./i18n.js";
import "./transfer.css";

interface TransferViewProps {
  accounts: AccountView[];
  selectedAccountIds: string[];
  inputRef: RefObject<HTMLInputElement | null>;
  isExporting: boolean;
  isImporting: boolean;
  onExport: () => void;
  onPickImport: () => void;
  onImportFile: (file: File) => void;
  onToggleAccount: (accountId: string) => void;
  onSelectAll: () => void;
  onClearSelection: () => void;
}

export function TransferView({
  accounts,
  selectedAccountIds,
  inputRef,
  isExporting,
  isImporting,
  onExport,
  onPickImport,
  onImportFile,
  onToggleAccount,
  onSelectAll,
  onClearSelection,
}: TransferViewProps) {
  const { t } = useI18n();
  const selectedCount = selectedAccountIds.length;

  return (
    <>
      <section className="addGrid transferGrid">
        <div className="addCard transferCard exportAccountCard">
          <div className="icon">
            <Download size={18} />
          </div>
          <h3>{t("导出账号备份")}</h3>
          <p>{t("勾选要迁移的 Codex 登录态，只导出选中的账号。")}</p>

          <div className="exportAccountHeader">
            <span>{t("已选 {selected} / {total} 个", { selected: selectedCount, total: accounts.length })}</span>
            <div>
              <button type="button" disabled={accounts.length === 0} onClick={onSelectAll}>
                {t("全选")}
              </button>
              <button type="button" disabled={selectedCount === 0} onClick={onClearSelection}>
                {t("清空")}
              </button>
            </div>
          </div>

          <div className="exportAccountList">
            {accounts.length === 0 ? (
              <div className="exportAccountEmpty">{t("暂无可导出的账号")}</div>
            ) : (
              accounts.map((account) => (
                <label key={account.id} className="exportAccountItem">
                  <input
                    type="checkbox"
                    checked={selectedAccountIds.includes(account.id)}
                    onChange={() => onToggleAccount(account.id)}
                  />
                  <span className="exportAccountText">
                    <strong>{account.name}</strong>
                    <small>
                      {account.email || t("未读取邮箱")} · {planLabel(account.planType || account.subscriptionPlan)}
                      {account.isActive ? ` · ${t("当前")}` : ""}
                    </small>
                  </span>
                </label>
              ))
            )}
          </div>

          <button
            className="primary"
            disabled={selectedCount === 0 || isExporting}
            onClick={onExport}
          >
            <Download size={14} />
            {t("导出选中账号")}
          </button>
        </div>

        <div className="addCard transferCard">
          <div className="icon">
            <Upload size={18} />
          </div>
          <h3>{t("导入账号备份")}</h3>
          <p>{t("选择从另一台 Mac 导出的 Squirrel Switch 备份文件，导入后会在本机重新加密保存。")}</p>
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
          <button disabled={isImporting} onClick={onPickImport}>
            <Upload size={14} />
            {t("选择备份")}
          </button>
        </div>
      </section>

      <div className="hint">
        <AlertTriangle size={14} />
        <span>
          {t("备份文件包含可直接登录的 auth.json 凭据，只用于你自己的设备迁移；导入成功后建议删除传输过程中的副本。")}
        </span>
      </div>
    </>
  );
}

function planLabel(value: string | null | undefined) {
  if (!value) return "Unknown";
  const map: Record<string, string> = {
    free: "Free",
    go: "Go",
    plus: "Plus",
    pro: "Pro",
    prolite: "Pro Lite",
    team: "Team",
    business: "Business",
    enterprise: "Enterprise",
    edu: "Edu",
    unknown: "Unknown",
  };
  return map[value.toLowerCase()] ?? value;
}
