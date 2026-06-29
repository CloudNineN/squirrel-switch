import { createContext, useContext, useEffect, useMemo, useState } from "react";

export type AppLocale = "zh-CN" | "en-US";

type I18nContextValue = {
  locale: AppLocale;
  setLocale: (locale: AppLocale) => void;
  t: (text: string, values?: Record<string, string | number>) => string;
};

const STORAGE_KEY = "squirrel-switch-locale";

const EN: Record<string, string> = {
  "多账号切换": "Account switcher",
  "主导航": "Main navigation",
  "Codex 账号管理": "Codex Accounts",
  "全部账号": "Accounts",
  "添加账号": "Add Account",
  "导入导出": "Import / Export",
  "定时刷新": "Scheduled Refresh",
  "ChatGPT 网页会话": "ChatGPT Sessions",
  "ChatGPT": "ChatGPT",
  "管理本机隔离网页会话与迁移备份": "Manage isolated local web sessions and migration backups",
  "全部会话": "Sessions",
  "管理本机隔离 ChatGPT 网页会话": "Manage isolated local ChatGPT web sessions",
  "创建 ChatGPT 会话并绑定 Codex 账号": "Create ChatGPT sessions and link Codex accounts",
  "创建 ChatGPT 会话并按邮箱自动关联 Codex": "Create ChatGPT sessions and auto-link Codex by email",
  "加密迁移 ChatGPT 网页登录态": "Encrypt and migrate ChatGPT web sign-in state",
  "Claude Code 配置管理": "Claude Code",
  "全部配置": "Profiles",
  "添加配置": "Add Profile",
  "提示词管理": "Prompt Management",
  "系统": "System",
  "运行时": "Runtime",
  "运行日志": "Runtime Logs",
  "关于": "About",
  "版本 V{version}": "Version {version}",
  "Codex Home 读取中…": "Reading Codex Home...",
  "当前: {name}": "Current: {name}",
  "未启用任何已保存账号": "No saved account is active",
  "导入或登录新的 Codex 账号": "Import or sign in to a Codex account",
  "导出或导入跨 Mac 迁移备份": "Export or import migration backups across Macs",
  "按每日时间区间刷新全部账号限额": "Refresh all account limits within a daily window",
  "已保存 {count} 个网页会话": "{count} web sessions saved",
  "已保存 {count} 个 ChatGPT 账号": "{count} ChatGPT accounts saved",
  "还没有 ChatGPT 会话": "No ChatGPT sessions yet",
  "还没有 ChatGPT 账号": "No ChatGPT accounts yet",
  "每个账号使用独立 Chrome/Edge 浏览器 Profile，打开或刷新后按邮箱自动关联 Codex。":
    "Each account uses an isolated Chrome/Edge browser profile and auto-links Codex by email after opening or refresh.",
  "检查本机会话": "Check Local Session",
  "添加会话": "Add Session",
  "刷新全部 ChatGPT": "Refresh All ChatGPT",
  "ChatGPT 会话": "ChatGPT Sessions",
  "选择": "Select",
  "本机会话": "Local Session",
  "浏览器": "Browser",
  "自定义": "Custom",
  "登录状态": "Sign-in",
  "会话": "Session",
  "绑定 Codex": "Linked Codex",
  "最后打开": "Last Opened",
  "上次导出": "Last Export",
  "未检查": "Unchecked",
  "上次检查": "Last Check",
  "有会话": "Session Found",
  "需登录": "Needs Login",
  "失效": "Invalid",
  "需验证": "Verification Required",
  "未绑定": "Unlinked",
  "已绑定": "Linked",
  "打开": "Open",
  "打开 ChatGPT": "Open ChatGPT",
  "打开绑定的 ChatGPT": "Open Linked ChatGPT",
  "检查登录状态": "Check Sign-in",
  "管理 ChatGPT 会话": "Manage ChatGPT Session",
  "清除本机会话": "Clear Local Session",
  "暂无 ChatGPT 会话": "No ChatGPT sessions yet",
  "添加 ChatGPT 会话": "Add ChatGPT Session",
  "创建独立 ChatGPT 网页会话，可选择绑定一个已保存 Codex 账号。":
    "Create an isolated ChatGPT web session and optionally link a saved Codex account.",
  "创建独立 ChatGPT 网页会话，登录后按账号邮箱自动关联本机 Codex。":
    "Create an isolated ChatGPT web session. After sign-in, it auto-links local Codex by account email.",
  "创建独立 Chrome/Edge 浏览器 Profile，登录后按账号邮箱自动关联本机 Codex。":
    "Create an isolated Chrome/Edge browser profile. After sign-in, it auto-links local Codex by account email.",
  "会话名称": "Session name",
  "不绑定 Codex 账号": "Do not link a Codex account",
  "创建并打开": "Create and Open",
  "单独创建 GPT": "Create GPT Only",
  "添加组合账号": "Add Combined Account",
  "先创建 ChatGPT 浏览器 Profile，再继续 Codex OAuth 完成账号绑定。":
    "Create a ChatGPT browser profile first, then continue Codex OAuth to finish linking.",
  "先登录 ChatGPT，随后自动在同一浏览器继续 Codex OAuth。":
    "Sign in to ChatGPT first, then automatically continue Codex OAuth in the same browser.",
  "推荐：组合登录": "Recommended: Combined Sign-in",
  "先登录 ChatGPT，再自动复用同一浏览器完成 Codex OAuth。":
    "Sign in to ChatGPT first, then automatically reuse the same browser for Codex OAuth.",
  "创建组合会话": "Create Combined Session",
  "组合登录 GPT+Codex": "Sign in to GPT + Codex",
  "待关联 Codex": "Codex To Link",
  "这些 Codex 账号还没有绑定 ChatGPT 会话，可直接补一个组合登录。":
    "These Codex accounts do not have linked ChatGPT sessions yet. Add one with combined sign-in.",
  "暂无待关联 Codex 账号": "No Codex accounts to link",
  "补 GPT": "Add GPT",
  "等待 ChatGPT 登录完成": "Waiting for ChatGPT sign-in",
  "等待 ChatGPT 登录完成后，在同一浏览器继续 Codex":
    "After ChatGPT sign-in completes, continue Codex in the same browser",
  "等待 ChatGPT 登录完成，随后会自动打开 Codex OAuth":
    "Waiting for ChatGPT sign-in, then Codex OAuth opens automatically",
  "继续 Codex OAuth": "Continue Codex OAuth",
  "同浏览器继续 Codex OAuth": "Continue Codex OAuth in Same Browser",
  "手动打开 Codex OAuth": "Open Codex OAuth Manually",
  "选择导出会话": "Select Sessions to Export",
  "导出 ChatGPT 备份": "Export ChatGPT Backup",
  "导入 ChatGPT 备份": "Import ChatGPT Backup",
  "备份会加密保存网页登录态，只适合在你自己的设备之间迁移。":
    "The backup encrypts web sign-in state and is only intended for your own devices.",
  "导入后会写入新的独立浏览器 Profile，检查状态时按邮箱自动关联本机 Codex。":
    "Import writes new isolated browser profiles and auto-links local Codex by email during status checks.",
  "备份密码": "Backup password",
  "导出选中会话": "Export Selected Sessions",
  "ChatGPT cookie、localStorage 和备份均属于敏感登录态；Squirrel Switch 不会展示、复制或记录明文内容。":
    "ChatGPT cookies, localStorage, and backups are sensitive sign-in state; Squirrel Switch does not display, copy, or log plaintext values.",
  "ChatGPT 网页会话只能在 Squirrel Switch 桌面版中使用":
    "ChatGPT web sessions are only available in the Squirrel Switch desktop app.",
  "已创建并打开 ChatGPT 会话": "Created and opened the ChatGPT session",
  "已创建并打开 ChatGPT，会在检查状态后按邮箱自动关联 Codex":
    "Created and opened ChatGPT. It will auto-link Codex by email after a status check.",
  "已创建未绑定 ChatGPT 会话": "Created an unlinked ChatGPT session",
  "已打开绑定的 ChatGPT 会话": "Opened the linked ChatGPT session",
  "ChatGPT 登录完成后，可继续完成 Codex OAuth 绑定":
    "After ChatGPT sign-in completes, continue Codex OAuth to link the account.",
  "ChatGPT 登录完成后，可在同一浏览器继续 Codex OAuth":
    "After ChatGPT sign-in completes, continue Codex OAuth in the same browser.",
  "ChatGPT 登录完成后会自动继续 Codex OAuth":
    "After ChatGPT sign-in completes, Codex OAuth will continue automatically.",
  "已检测到 ChatGPT 登录，正在自动打开 Codex OAuth":
    "ChatGPT sign-in detected. Opening Codex OAuth automatically.",
  "ChatGPT 窗口打开失败": "Failed to open ChatGPT window",
  "ChatGPT 状态检查失败": "Failed to check ChatGPT status",
  "会员信息不可用": "Subscription unavailable",
  "正在后台检查 ChatGPT 登录状态：{name}": "Checking ChatGPT sign-in in the background: {name}",
  "正在后台检查全部 ChatGPT 会话": "Checking all ChatGPT sessions in the background",
  "ChatGPT 检查成功：{name}": "ChatGPT check succeeded: {name}",
  "ChatGPT 检查失败：{reason}": "ChatGPT check failed: {reason}",
  "已检查全部 ChatGPT 会话：{success} 个可用，{failed} 个失败":
    "Checked all ChatGPT sessions: {success} available, {failed} failed",
  "ChatGPT 会话已重命名": "ChatGPT session renamed",
  "ChatGPT 备注已更新": "ChatGPT note updated",
  "已更新绑定关系": "Link updated",
  "已取消绑定": "Link removed",
  "确认清除「{name}」的本机 ChatGPT 网页会话？": "Clear local ChatGPT web session \"{name}\"?",
  "清除 ChatGPT 会话失败": "Failed to clear ChatGPT session",
  "已清除本机会话": "Local session cleared",
  "确认删除 ChatGPT 会话「{name}」？本机会话数据也会被清除。":
    "Delete ChatGPT session \"{name}\"? Local session data will also be cleared.",
  "确认删除 ChatGPT 账号「{name}」？本机会话数据也会被清除。":
    "Delete ChatGPT account \"{name}\"? Local session data will also be cleared.",
  "ChatGPT 会话已删除": "ChatGPT session deleted",
  "请先创建组合 ChatGPT 会话": "Create a combined ChatGPT session first",
  "组合账号已保存，首次限额已刷新":
    "Combined account saved. Initial limits refreshed.",
  "组合账号已保存，首次限额刷新失败：{message}":
    "Combined account saved. Initial limit refresh failed: {message}",
  "组合账号已保存并绑定": "Combined account saved and linked",
  "组合账号已保存，检查状态后会按邮箱自动关联":
    "Combined account saved. It will auto-link by email after a status check.",
  "若浏览器询问是否打开 Codex.app，请选择取消；Squirrel Switch 会自动导入登录态。":
    "If the browser asks whether to open Codex.app, choose Cancel; Squirrel Switch imports the session automatically.",
  "Codex OAuth 登录失败": "Codex OAuth sign-in failed",
  "Codex 授权窗口打开失败": "Failed to open Codex authorization window",
  "请选择要导出的 ChatGPT 会话": "Select ChatGPT sessions to export",
  "请输入备份密码": "Enter a backup password",
  "ChatGPT 备份导出失败": "Failed to export ChatGPT backup",
  "ChatGPT 备份导入失败": "Failed to import ChatGPT backup",
  "已导出 {count} 个 ChatGPT 会话": "Exported {count} ChatGPT sessions",
  "已导入 {count} 个 ChatGPT 会话": "Imported {count} ChatGPT sessions",
  "已导入 {count} 个 ChatGPT 会话，{failed} 个写入失败":
    "Imported {count} ChatGPT sessions, {failed} failed to write",
  "已导入 {count} 个 ChatGPT 会话，{partial} 个 localStorage 恢复不完整":
    "Imported {count} ChatGPT sessions, {partial} had incomplete localStorage restore",
  "已导入 {count} 个 ChatGPT 会话，{failed} 个写入失败，{partial} 个 localStorage 恢复不完整":
    "Imported {count} ChatGPT sessions, {failed} failed to write, {partial} had incomplete localStorage restore",
  "正在导入…": "Importing...",
  "{count} 个 cookie": "{count} cookies",
  "Claude Code provider profile 与 settings 切换": "Switch Claude Code provider profiles and settings",
  "添加或编辑 Claude Code provider profile": "Add or edit Claude Code provider profiles",
  "导入导出 Claude Code profile": "Import or export Claude Code profiles",
  "管理本机官方默认全局提示词文件": "Manage official local default global prompt files",
  "本地环境诊断与文件路径": "Local diagnostics and file paths",
  "本机服务、账号和刷新任务记录": "Local service, account, and refresh task records",
  "Squirrel Switch · 本地多账号切换助手": "Squirrel Switch · Local account switcher",
  "刷新全部": "Refresh All",
  "当前账号": "Current Account",
  "未识别": "Unknown",
  "计划": "Plan",
  "5 小时限额": "5H Limit",
  "周/月限额": "Week/Month Limit",
  "订阅信息不可用": "Subscription unavailable",
  "无数据": "No data",
  "{count} 个": "{count}",
  "暂无账号,请前往“添加账号”导入": "No accounts yet. Import one from Add Account.",
  "状态": "Status",
  "账号": "Account",
  "重置": "Reset",
  "剩余时长": "Remaining",
  "准确日期": "Exact date",
  "切换为准确日期": "Switch to exact date",
  "切换为剩余时长": "Switch to remaining time",
  "上次刷新": "Last Refresh",
  "会员到期": "Subscription",
  "操作": "Actions",
  "保存": "Save",
  "取消": "Cancel",
  "重命名": "Rename",
  "备注": "Note",
  "编辑备注": "Edit note",
  "推荐": "Recommended",
  "启用": "Activate",
  "刷新": "Refresh",
  "编辑名称": "Edit name",
  "删除": "Delete",
  "到期 {time}": "Expires {time}",
  "续费 {time}": "Renews {time}",
  "当前未启用任何已保存账号,可在下方列表中选择一个启用。":
    "No saved account is active. Pick one from the list below.",
  "当前": "Current",
  "需检查": "Needs check",
  "可用": "Available",
  "无法获取": "Unavailable",
  "到期未知": "Expiry unknown",
  "接口不可用": "API unavailable",
  "未刷新": "Never",
  "刚刚": "Just now",
  "{count} 分钟前": "{count} min ago",
  "{count} 小时前": "{count}h ago",
  "{count} 天前": "{count}d ago",
  "现在": "Now",
  "1 分钟后": "in 1 min",
  "{count} 分钟后": "in {count} min",
  "{count} 小时后": "in {count}h",
  "{count} 天后": "in {count}d",
  "5H限额": "5H limit",
  "月限额": "Monthly",
  "周限额": "Weekly",
  "重置时间无法获取": "Reset time unavailable",
  "导入当前 Codex 登录态": "Import Current Codex Session",
  "从 ~/.codex/auth.json 读取当前已登录的账号,保存到本工具。":
    "Read the signed-in account from ~/.codex/auth.json and save it locally.",
  "导入当前": "Import Current",
  "登录新账号": "Sign In New Account",
  "在隔离的 CODEX_HOME 中启动 OAuth 登录,授权页会在应用内临时窗口打开。":
    "Start OAuth login in an isolated CODEX_HOME. The authorization page opens in a temporary app window.",
  "开始登录": "Start Login",
  "单独登录 Codex": "Sign in to Codex only",
  "粘贴 auth.json": "Paste auth.json",
  "从其他设备复制现成的 auth.json,粘贴后保存为新账号。":
    "Paste an auth.json copied from another device and save it as a new account.",
  "备注名(可选)": "Name (optional)",
  "保存账号": "Save Account",
  "auth.json 属于敏感凭据,本工具仅在本机以 AES-256-GCM 加密保存,不会上传任何服务器。订阅信息接口失败时不影响账号切换。":
    "auth.json is sensitive. Squirrel Switch only stores it locally with AES-256-GCM encryption and never uploads it. Subscription API failures do not block account switching.",
  "等待应用内授权": "Waiting for in-app authorization",
  "登录成功并已导入": "Login succeeded and imported",
  "登录失败": "Login failed",
  "打开窗口": "Open Window",
  "复制链接": "Copy Link",
  "导出账号备份": "Export Account Backup",
  "勾选要迁移的 Codex 登录态，只导出选中的账号。":
    "Select the Codex sessions to migrate. Only selected accounts are exported.",
  "已选 {selected} / {total} 个": "{selected} / {total} selected",
  "全选": "Select All",
  "清空": "Clear",
  "暂无可导出的账号": "No accounts to export",
  "未读取邮箱": "Email unavailable",
  "导出选中账号": "Export Selected Accounts",
  "导出已保存的 Codex 登录态备份，用于导入到另一台 Mac。":
    "Export saved Codex sessions for import on another Mac.",
  "导出备份": "Export Backup",
  "导入账号备份": "Import Account Backup",
  "选择从另一台 Mac 导出的 Squirrel Switch 备份文件，导入后会在本机重新加密保存。":
    "Choose a Squirrel Switch backup exported from another Mac. Imported credentials are re-encrypted locally.",
  "选择备份": "Choose Backup",
  "备份文件包含可直接登录的 auth.json 凭据，只用于你自己的设备迁移；导入成功后建议删除传输过程中的副本。":
    "Backups contain auth.json credentials that can sign in directly. Use them only for your own device migration and delete transit copies after import.",
  "已存在": "Exists",
  "不存在": "Missing",
  "codex 二进制": "codex binary",
  "未找到": "Not found",
  "可调用": "Callable",
  "不可用": "Unavailable",
  "可访问": "Accessible",
  "回退到本地密钥": "Local key fallback",
  "路径与配置": "Paths and Config",
  "auth.json 路径": "auth.json path",
  "数据库": "Database",
  "运行日志路径读取中…": "Reading runtime log path...",
  "暂无运行日志": "No runtime logs",
  "{count} 条": "{count}",
  "复制": "Copy",
  "上一页": "Previous page",
  "下一页": "Next page",
  "第 {current} / {total} 页": "Page {current} / {total}",
  "信息": "Info",
  "警告": "Warning",
  "错误": "Error",
  "切换账号": "Switch Account",
  "删除账号": "Delete Account",
  "确认切换": "Switch",
  "确认删除": "Delete",
  "请确认后继续": "Confirm to continue",
  "确认切换到账号「{name}」？当前 Codex 登录态会被替换，并会尝试重启正在运行的 Codex.app。":
    "Switch to account \"{name}\"? The current Codex session will be replaced and Squirrel Switch will try to restart Codex.app.",
  "确认删除账号「{name}」？这只会删除本工具保存的账号记录，不会删除当前 Codex 登录态。":
    "Delete account \"{name}\"? This only removes the record saved by Squirrel Switch and does not delete the current Codex session.",
  "Codex.app 已自动重启,新账号已生效": "Codex.app restarted automatically. The new account is active.",
  "Codex.app 未能自动重启,请手动关闭并重新打开 Codex 以加载新账号":
    "Codex.app could not restart automatically. Close and reopen Codex to load the new account.",
  "已导出 {count} 个账号": "Exported {count} accounts",
  "已导入 {count} 个账号": "Imported {count} accounts",
  "正在读取限额与订阅信息": "Reading limits and subscription",
  "刷新成功": "Refresh succeeded",
  "{name} 已刷新": "{name} refreshed",
  "{name} 刷新失败：{message}": "{name} refresh failed: {message}",
  "开始刷新 {count} 个账号": "Refreshing {count} accounts",
  "刷新完成：成功 {success} 个，失败 {failed} 个": "Refresh complete: {success} succeeded, {failed} failed",
  "运行日志已复制": "Runtime logs copied",
  "推荐使用：额度数据完整度不足": "Recommended: quota data is incomplete",
  "推荐使用：周/月限额 {secondary}%，可用重置 {resetCount} 次按会员到期计入，5 小时限额 {primary}%":
    "Recommended: {secondary}% weekly/monthly limit, {resetCount} reset(s) counted against subscription expiry, {primary}% 5H limit",
  "推荐使用：周/月限额 {secondary}%，可用重置 {resetCount} 次仅展示未计入推荐，5 小时限额 {primary}%":
    "Recommended: {secondary}% weekly/monthly limit, {resetCount} reset(s) shown only and not counted, {primary}% 5H limit",
  "推荐使用：周/月限额 {secondary}%，5 小时限额 {primary}%，已纳入会员到期时间":
    "Recommended: {secondary}% weekly/monthly limit, {primary}% 5H limit; subscription expiry included",
  "推荐使用：周/月限额 {secondary}%，5 小时限额 {primary}%":
    "Recommended: {secondary}% weekly/monthly limit, {primary}% 5H limit",
  "刷新中": "Refreshing",
  "刷新中 {completed}/{total}": "Refreshing {completed}/{total}",
  "正在准备刷新": "Preparing refresh",
  "刷新完成，失败 {count} 个": "Refresh complete, {count} failed",
  "刷新完成": "Refresh complete",
  "成功 {success} 个，失败 {failed} 个": "{success} succeeded, {failed} failed",
  "本地多账号切换助手。所有凭据仅保存在本机,使用 AES-256-GCM 加密,主密钥优先存入 macOS Keychain。":
    "A local multi-account switching assistant. Credentials stay on your machine, encrypted with AES-256-GCM, with the master key stored in macOS Keychain when available.",
  "切换账号时会原子写入 ~/.codex/auth.json 并自动重启正在运行的 Codex.app。":
    "When switching accounts, Squirrel Switch atomically writes ~/.codex/auth.json and restarts Codex.app if it is running.",
  "版本更新": "Release Notes",
  "最近 {count} 个版本": "Latest {count} versions",
  "定时刷新配置已保存": "Scheduled refresh settings saved",
  "定时刷新已完成": "Scheduled refresh completed",
  "立即刷新": "Run Now",
  "启用定时刷新": "Enable scheduled refresh",
  "同时激活 5 小时额度": "Also activate 5-hour limit",
  "刷新间隔": "Refresh interval",
  "分钟": "minutes",
  "下次刷新": "Next refresh",
  "上次开始": "Last started",
  "上次完成": "Last finished",
  "上次结果": "Last result",
  "{succeeded}/{total} 成功，{failed} 失败": "{succeeded}/{total} succeeded, {failed} failed",
  "开始时间": "Start time",
  "结束时间": "End time",
  "执行列表": "Executions",
  "最近 {count} 条": "Latest {count}",
  "暂无定时刷新执行记录": "No scheduled refresh executions yet",
  "{succeeded}/{total} 成功": "{succeeded}/{total} succeeded",
  "{failed} 失败": "{failed} failed",
  "5小时激活 {activated} 个，跳过 {skipped} 个，失败 {failed} 个":
    "5H activated {activated}, skipped {skipped}, failed {failed}",
  "系统提示词已保存": "System prompt saved",
  "已保存到 {name}": "Saved to {name}",
  "提示词平台": "Prompt platform",
  "内部默认提示词": "Internal default prompt",
  "系统级提示词": "System-level prompt",
  "保存到 {name}": "Save to {name}",
  "保存系统提示词": "Save System Prompt",
  "输入全局提示词...": "Enter a global prompt...",
  "位置": "Location",
  "Squirrel Switch 内部配置": "Squirrel Switch internal config",
  "保存行为": "Save behavior",
  "同步到空内容或跟随系统的文件": "Syncs to empty files or files following the system prompt",
  "目标路径": "Target path",
  "文件状态": "File status",
  "来源": "Source",
  "更新时间": "Updated",
  "未创建": "Not created",
  "可读取": "Readable",
  "无法读取": "Unreadable",
  "可写入": "Writable",
  "不可写": "Not writable",
  "为空": "Empty",
  "请先粘贴 API key": "Paste an API key first",
  "Claude Code profile 已更新": "Claude Code profile updated",
  "Claude Code profile 已创建": "Claude Code profile created",
  "已保存并应用到用户级配置：{name}": "Saved and applied to user settings: {name}",
  "已保存并启动 Claude Code：{name}": "Saved and launched Claude Code: {name}",
  "确认删除「{name}」？": "Delete \"{name}\"?",
  "Claude Code profile 已删除": "Claude Code profile deleted",
  "已应用到用户级 settings：{name}": "Applied to user settings: {name}",
  "项目路径": "Project path",
  "已应用到项目本地 settings：{name}": "Applied to project-local settings: {name}",
  "已在 Terminal 启动 Claude Code：{name}": "Launched Claude Code in Terminal: {name}",
  "备份将包含 Claude Code API key，确认继续？": "The backup will include Claude Code API keys. Continue?",
  "已导出 {count} 个 profile，包含 API key": "Exported {count} profiles with API keys",
  "已导出 {count} 个 profile，不含 API key": "Exported {count} profiles without API keys",
  "已导入 {count} 个 Claude Code profile": "Imported {count} Claude Code profiles",
  "当前 API": "Current API",
  "未指定模型": "No model specified",
  "应用到全局": "Apply Globally",
  "启动 Claude Code": "Launch Claude Code",
  "编辑": "Edit",
  "还没有可用 API": "No API yet",
  "添加一个 provider API key 后即可切换 Claude Code。": "Add a provider API key to switch Claude Code.",
  "添加 API": "Add API",
  "已保存 API": "Saved APIs",
  "暂无 Claude Code profile": "No Claude Code profiles yet",
  "名称": "Name",
  "模型": "Model",
  "密钥": "Key",
  "备用": "Standby",
  "未覆盖": "Not overridden",
  "已保存": "Saved",
  "缺失": "Missing",
  "应用到用户级配置": "Apply to user settings",
  "应用到项目本地配置": "Apply to project-local settings",
  "快速添加": "Quick Add",
  "编辑 {name}": "Edit {name}",
  "选择服务商，粘贴 API key": "Choose a provider and paste an API key",
  "新建": "New",
  "自定义模型": "Custom model",
  "留空则继续使用已保存密钥": "Leave blank to keep the saved key",
  "粘贴 provider API key": "Paste provider API key",
  "备注名": "Display name",
  "默认使用服务商名称": "Defaults to the provider name",
  "启动目录": "Launch directory",
  "留空使用用户目录": "Leave blank to use the home directory",
  "保存并应用": "Save and Apply",
  "保存并启动": "Save and Launch",
  "高级配置": "Advanced Settings",
  "鉴权": "Auth",
  "主模型": "Main model",
  "禁用非必要流量": "Disable nonessential traffic",
  "清空已保存 API key": "Clear saved API key",
  "自定义 headers": "Custom headers",
  "导出配置备份": "Export Config Backup",
  "导出已保存的 Claude Code 配置，用于导入到另一台 Mac。":
    "Export saved Claude Code profiles for import on another Mac.",
  "包含 API key": "Include API keys",
  "导入配置备份": "Import Config Backup",
  "选择从另一台 Mac 导出的 Claude Code 配置备份，导入后会在本机重新加密保存。":
    "Choose a Claude Code config backup exported from another Mac. Imported keys are re-encrypted locally.",
  "备份默认不包含 API key；勾选包含 API key 后，备份文件只适合在你自己的设备之间迁移。":
    "Backups do not include API keys by default. If included, use the backup only between your own devices.",
  "语言": "Language",
  "中文": "中文",
  "English": "English",
};

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<AppLocale>(() => readInitialLocale());

  useEffect(() => {
    document.documentElement.lang = locale;
    window.localStorage.setItem(STORAGE_KEY, locale);
  }, [locale]);

  const value = useMemo<I18nContextValue>(
    () => ({
      locale,
      setLocale: setLocaleState,
      t: (text, values) => interpolate(locale === "en-US" ? EN[text] ?? text : text, values),
    }),
    [locale],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const context = useContext(I18nContext);
  if (!context) {
    throw new Error("useI18n must be used inside I18nProvider");
  }
  return context;
}

export function translate(text: string, locale: AppLocale, values?: Record<string, string | number>) {
  return interpolate(locale === "en-US" ? EN[text] ?? text : text, values);
}

export function currentLocale(): AppLocale {
  return readInitialLocale();
}

function readInitialLocale(): AppLocale {
  const saved = window.localStorage.getItem(STORAGE_KEY);
  if (saved === "zh-CN" || saved === "en-US") return saved;
  return navigator.language.toLowerCase().startsWith("zh") ? "zh-CN" : "en-US";
}

function interpolate(text: string, values?: Record<string, string | number>) {
  if (!values) return text;
  return text.replace(/\{(\w+)\}/g, (_, key: string) => String(values[key] ?? `{${key}}`));
}
