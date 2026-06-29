import {
  APP_VERSION,
  RECENT_VERSION_UPDATE_LOG,
  VERSION_UPDATE_LOG_LIMIT,
} from "@squirrel-switch/shared";
import { useI18n } from "./i18n.js";

export function AboutView() {
  const { t } = useI18n();
  return (
    <section className="card">
      <div className="cardBody aboutPage">
        <div className="aboutHeader">
          <h2>Squirrel Switch</h2>
          <span className="pill">V{APP_VERSION}</span>
        </div>
        <p>
          {t("本地多账号切换助手。所有凭据仅保存在本机,使用 AES-256-GCM 加密,主密钥优先存入 macOS Keychain。")}
        </p>
        <p>{t("切换账号时会原子写入 ~/.codex/auth.json 并自动重启正在运行的 Codex.app。")}</p>

        <section className="releasePanel">
          <div className="releasePanelHeader">
            <h3>{t("版本更新")}</h3>
            <span>{t("最近 {count} 个版本", { count: VERSION_UPDATE_LOG_LIMIT })}</span>
          </div>
          <div className="releaseTimeline">
            {RECENT_VERSION_UPDATE_LOG.map((entry) => (
              <article className="releaseEntry" key={entry.version}>
                <header>
                  <strong>V{entry.version}</strong>
                  <span>{entry.date}</span>
                  <em>{entry.title}</em>
                </header>
                <ul>
                  {[...entry.highlights, ...entry.fixes].map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
        </section>
      </div>
    </section>
  );
}
