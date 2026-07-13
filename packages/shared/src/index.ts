export const APP_VERSION = "1.16.0";

export interface VersionUpdateLogEntry {
  version: string;
  date: string;
  title: string;
  highlights: string[];
  fixes: string[];
}

export const VERSION_UPDATE_LOG_LIMIT = 5;

export const VERSION_UPDATE_LOG: VersionUpdateLogEntry[] = [
  {
    version: "1.16.0",
    date: "2026-07-11",
    title: "OpenAI 账号管理一致性修复",
    highlights: [
      "Codex 账号列表改为按会员等级从高到低、同等级按会员到期日从早到晚稳定排序。",
      "Codex OAuth 登录成功后统一自动刷新一次首次限额，单独登录和组合登录行为保持一致。",
      "ChatGPT 账号识别邮箱后直接使用邮箱作为默认名称，不再继续生成重复的账号编号。",
    ],
    fixes: [
      "修复 Codex 限额已返回 Free，但账号计划仍被旧 account/read 或令牌值覆盖为 Plus 的问题。",
      "修复 Free 账号继续显示旧会员到期日，以及前后端重复排序导致列表顺序不一致的问题。",
      "已有 ChatGPT 默认编号名称会在识别到邮箱后自动更新，同时保留用户手动设置的备注。",
    ],
  },
  {
    version: "1.15.9",
    date: "2026-07-02",
    title: "ChatGPT 检查入口收口",
    highlights: [
      "移除 ChatGPT 单账号检查登录状态按钮，避免把只能读取已打开窗口的能力误解为离线检查。",
      "批量检查改为逐个打开可见浏览器窗口、读取登录和订阅状态、检测应用同步后关闭窗口。",
      "无法检查返回的 unchecked 不再写入数据库，避免覆盖已有可用、Plus 或需重新登录状态。",
    ],
    fixes: [
      "修复单账号检查按钮闪一下后把列表状态改成未检查的问题。",
      "修复批量检查不主动打开 Profile 时只能依赖既有窗口、结果不稳定的问题。",
      "补充前端到桌面端的关闭 ChatGPT Profile 能力，批量检查完成后自动收尾。",
    ],
  },
  {
    version: "1.15.8",
    date: "2026-07-02",
    title: "检查登录状态不再污染账号状态",
    highlights: [
      "检查登录状态按钮明确为检查已打开的 ChatGPT 窗口；未打开时只提示用户先打开窗口。",
      "无法检查返回的 unchecked 不再写入数据库，避免覆盖已有可用、Plus 或需重新登录状态。",
      "自动登录轮询遇到 Profile 未打开会立即停止，不再每 8 秒反复检查和刷提示。",
    ],
    fixes: [
      "修复点击检查登录状态后，已知 Plus 会话被快速改成未检查的问题。",
      "修复自动状态刷新在目标浏览器窗口关闭后持续写入 unchecked 日志的问题。",
      "修复按钮文案过于笼统，导致用户误以为未打开浏览器也能完成真实登录检查的问题。",
    ],
  },
  {
    version: "1.15.7",
    date: "2026-07-02",
    title: "浏览器后台任务前台可见",
    highlights: [
      "ChatGPT 自动登录检查、应用同步检测、备份导入导出和 OAuth 推进都会在主界面显示正在执行的具体任务。",
      "应用同步自动检测不再使用静默语义，未打开 Profile 时会明确提示跳过。",
      "ChatGPT 备份读写会在受控浏览器页面注入任务提示，说明 Squirrel Switch 正在导出或导入会话。",
    ],
    fixes: [
      "修复浏览器后台动作只在内部执行、前台缺少透明提示的问题。",
      "修复从账号列表打开绑定 ChatGPT 会话时，浏览器动作开始前没有状态提示的问题。",
      "统一浏览器状态检查文案，避免继续使用静默检查表述。",
    ],
  },
  {
    version: "1.15.6",
    date: "2026-07-02",
    title: "ChatGPT 后台检查提速与提示修复",
    highlights: [
      "ChatGPT 登录状态检查优先读取已打开页面的登录身份，账号已登录时先返回结果，不再被订阅接口拖住。",
      "页面内 ChatGPT 接口请求增加短超时，Cloudflare 或网络阻塞时会快速降级为会员信息不可用。",
      "点击打开 ChatGPT 后会显示正在后台检查登录状态，和手动检查的前台提示保持一致。",
    ],
    fixes: [
      "修复检查失败或未打开 Profile 时，界面仍残留“正在后台检查 ChatGPT 登录状态”的问题。",
      "修复手动检查弱结果重试三轮导致等待时间过长的问题。",
      "补充桌面端后台检查耗时日志，方便后续从 runtime.log 定位慢点。",
    ],
  },
  {
    version: "1.15.5",
    date: "2026-07-02",
    title: "ChatGPT 浏览器改为全可见模式",
    highlights: [
      "ChatGPT 受控浏览器链路不再启动无头 Chrome/Edge，统一使用可见浏览器窗口。",
      "后台状态检查只复用已打开的可见 ChatGPT 页面；未打开时提示先打开 Profile 后再检查。",
      "运行时标记升级为可见浏览器格式，旧无头运行时不会再被恢复使用。",
    ],
    fixes: [
      "降低无头浏览器触发 Cloudflare 风控后误判账号掉线或需验证的概率。",
      "修复后台检查为了读取 cookie 自动启动无头浏览器的行为。",
      "修复旧无头运行时标记可能继续参与 Profile 恢复的问题。",
    ],
  },
  {
    version: "1.15.4",
    date: "2026-07-02",
    title: "ChatGPT 会话过期实测修复",
    highlights: [
      "检查 ChatGPT 状态时会读取页面中的会话过期和未登录提示，不再只依赖 cookie 或账号接口返回。",
      "会话过期或未登录的 Profile 会降为 guest 并提示需重新登录，会员到期和应用同步状态同步失效。",
      "Profile 状态更新后会立即重算应用同步行，避免数据库里残留已同步状态。",
    ],
    fixes: [
      "修复页面显示“你的会话已过期”时，列表仍显示可用、Free 和已同步的问题。",
      "修复未登录 guest 页面仍被保存为可用会话的问题。",
      "修复 ChatGPT Profile 计划变为 guest 后，应用同步表可能继续残留 synced 的问题。",
    ],
  },
  {
    version: "1.15.3",
    date: "2026-07-02",
    title: "ChatGPT guest 状态与后台检查修复",
    highlights: [
      "guest 和 free 计划不再展示会员到期时间，避免沿用旧订阅日期造成误导。",
      "guest 会话不再参与应用同步聚合、明细和自动检测，列表中显示为不适用。",
      "后台检查遇到残留浏览器进程但没有 ChatGPT 页面时只做清理或提示，不再自动打开可见浏览器窗口。",
    ],
    fixes: [
      "修复 guest 会话仍显示会员到期时间和“已同步 1/1”的问题。",
      "修复检查登录状态或后台应用同步可能反复打开 ChatGPT 浏览器窗口的严重回归。",
      "修复 Browser context management is not supported 兜底读取 cookie 时可能创建可见 about:blank 页的问题。",
    ],
  },
  {
    version: "1.15.2",
    date: "2026-07-02",
    title: "ChatGPT 空页面进程恢复",
    highlights: [
      "检查 ChatGPT 登录状态时会区分浏览器调试端口可达和 ChatGPT 页面真正可用，残留空进程会先恢复页面再检查。",
      "受控浏览器 cookie 读取兼容 Chrome 在无页面目标时返回的 Browser context management 限制。",
    ],
    fixes: [
      "修复 ChatGPT Profile 浏览器进程仍在但页面已关闭时，检查登录状态长时间等待后报 Browser context management is not supported 的问题。",
      "修复应用同步静默检测把空浏览器进程误判为可操作页面，导致后台任务提示反复写入失败日志的问题。",
    ],
  },
  {
    version: "1.15.1",
    date: "2026-07-02",
    title: "ChatGPT Profile 调试端点恢复",
    highlights: [
      "检查 ChatGPT 登录状态前会恢复已打开的受控浏览器调试端口，应用重启后也能复用原 Profile 窗口。",
      "受控浏览器启动后写入本地运行时标记，减少重复启动同一 Profile 导致的调试端点连接失败。",
    ],
    fixes: [
      "修复 ChatGPT Profile 已在浏览器中打开时，点击检查登录状态仍可能提示无法连接调试端点的问题。",
      "修复清除 ChatGPT 本机会话前漏判仍在运行的外部浏览器 Profile 的问题。",
    ],
  },
  {
    version: "1.15.0",
    date: "2026-07-02",
    title: "ChatGPT 会话绑定 Codex",
    highlights: [
      "ChatGPT 会话列表新增绑定 Codex 入口，已登录但未绑定的 GPT 会话可直接补充 Codex 绑定。",
      "绑定时优先匹配本机同邮箱 Codex 账号；存在匹配时直接写入绑定关系，不再启动 OAuth。",
      "无本机匹配账号时复用当前 GPT 浏览器 Profile 打开 Codex OAuth，授权成功后自动回写绑定关系。",
    ],
    fixes: [
      "修复组合登录期间自动状态读取可能干扰 ChatGPT 登录页邮箱提交的问题。",
      "修复重复点击手动打开 Codex OAuth 按钮可能创建多个登录会话的问题。",
    ],
  },
  {
    version: "1.14.9",
    date: "2026-06-30",
    title: "MCP OAuth 顶层回调修复",
    highlights: [
      "ChatGPT MCP OAuth 回调改为顶层页面导航执行，以匹配 ChatGPT 网页真实连接流程。",
      "检测到 MCP 连接 ACTIVE 后自动把受控页面带回 ChatGPT 首页，避免停留在回调错误页。",
      "继续保留连接状态轮询，只有 ChatGPT 返回目标 MCP link 后才回写已同步。",
    ],
    fixes: [
      "修复 fetch 或隐藏 iframe 回调完成后 ChatGPT 仍不生成 MCP link 的问题。",
      "修复目标账号已创建开发者 MCP 但一键配置持续报未检测到已授权 MCP 的问题。",
    ],
  },
  {
    version: "1.14.8",
    date: "2026-06-30",
    title: "MCP OAuth 回调导航修复",
    highlights: [
      "ChatGPT MCP OAuth 回调改为在受控页面中用隐藏 iframe 完成导航。",
      "继续保持用户可见 ChatGPT 页面不跳转到回调错误页。",
      "保留回调后的 ACTIVE 连接状态校验，避免只凭回调页面加载判断成功。",
    ],
    fixes: [
      "修复 fetch 回调完成但 ChatGPT 连接列表仍没有生成 MCP link，导致一键配置停在确认连接状态的问题。",
      "修复目标账号中已创建开发者 MCP 但未被添加到 ChatGPT 时的自动连接失败问题。",
    ],
  },
  {
    version: "1.14.7",
    date: "2026-06-30",
    title: "MCP OAuth 自动连接修复",
    highlights: [
      "一键配置自定义 MCP 时只使用 ChatGPT 应用 ID，不再把版本 ID 当成连接器 ID。",
      "MCP OAuth 授权提交前会先加载授权页并继承页面 cookie，更接近真实网页登录表单流程。",
      "ChatGPT 页面顶部任务提示的最短展示时间改为从提示成功注入后开始计算。",
    ],
    fixes: [
      "修复已有 MCP 应用但尚未连接时，一键配置可能停在确认连接状态并被判定为未找到的问题。",
      "修复任务提示在页面刚打开或文案快速切换时可能一闪而过的问题。",
    ],
  },
  {
    version: "1.14.6",
    date: "2026-06-30",
    title: "MCP 同步状态口径修正",
    highlights: [
      "自定义 MCP 同步状态改为只按 Server URL 和连接授权状态判断。",
      "本地名称、描述和认证备注变化不再让已连接的 MCP 变成待同步。",
      "保存应用配置后的提示改为中性文案，避免误导用户认为所有编辑都会重新同步。",
    ],
    fixes: [
      "修复修改自定义 MCP 名称后应用同步摘要从 1/1 变成 0/1 的问题。",
      "同步设计文档明确自定义 MCP 的远端身份为 Server URL。",
    ],
  },
  {
    version: "1.14.5",
    date: "2026-06-30",
    title: "OAuth 回调后台完成",
    highlights: [
      "ChatGPT MCP OAuth 回调改为在受控页面上下文中后台完成，不再把可见页面导航到回调 URL。",
      "回调后继续以 ChatGPT 连接器状态确认是否 ACTIVE，避免只凭回调请求判断成功。",
      "一键配置成功后不再让用户停留在 ChatGPT 回调错误页。",
    ],
    fixes: [
      "修复 MCP 实际已可用但页面显示“建立连接时发生意外错误”的误导体验。",
      "减少 OAuth 回调页面渲染错误对自动配置结果感知的干扰。",
    ],
  },
  {
    version: "1.14.4",
    date: "2026-06-30",
    title: "任务提示注入修复",
    highlights: [
      "ChatGPT 应用一键配置继续保持后台自动配置，不再为了显示提示强制跳转设置页。",
      "受控 ChatGPT 页面顶部任务提示的注入脚本改为自包含，避免引用页面中不存在的 helper。",
      "保留页面加载瞬间的短重试和更明确的 CDP 异常日志，方便后续排查。",
    ],
    fixes: [
      "修复任务提示注入时报 waitForDocumentContainer is not defined，导致网页顶部没有提示条的问题。",
      "撤回 1.14.3 中先打开并绑定设置页的错误修复方向。",
    ],
  },
  {
    version: "1.14.3",
    date: "2026-06-30",
    title: "应用同步提示修复",
    highlights: [
      "ChatGPT 应用一键配置会先打开并绑定目标设置页，再执行后台检测、创建和授权动作。",
      "一键配置期间的顶部任务提示固定注入到目标 ChatGPT 页面，减少多标签页或页面刚打开时提示丢失。",
      "任务提示注入遇到 ChatGPT 页面导航中的上下文切换时会短重试。",
    ],
    fixes: [
      "修复一键配置实际成功但受控 ChatGPT 页面没有显示后台任务提示的问题。",
      "运行日志中的 ChatGPT 页面脚本执行失败会记录更具体的 CDP 异常摘要，便于后续排查。",
    ],
  },
  {
    version: "1.14.2",
    date: "2026-06-30",
    title: "MCP 自动开启开发模式",
    highlights: [
      "自定义 MCP 一键配置会在创建前自动确认 ChatGPT 开发人员模式。",
      "如果目标账号尚未开启开发人员模式，Squirrel Switch 会在受控 ChatGPT Profile 中自动开启后继续创建 MCP。",
      "自动开启开发人员模式阶段接入顶部任务提示，提醒用户不要关闭受控浏览器窗口。",
    ],
    fixes: [
      "修复开发人员模式关闭时 ChatGPT MCP 自动配置失败并提示 Developer mode is required 的问题。",
      "如果创建接口仍返回开发人员模式错误，会强制开启并重试一次，避免状态不同步导致的误失败。",
    ],
  },
  {
    version: "1.14.1",
    date: "2026-06-30",
    title: "后台提示体验补齐",
    highlights: [
      "GPT+Codex 组合登录的 Codex OAuth 链路接入受控浏览器顶部任务提示。",
      "获取 Codex OAuth 链接、打开授权页、等待授权结果和导入后首次限额刷新都会显示当前后台阶段。",
      "任务提示支持 ChatGPT 页面和 OpenAI 授权页，授权页提示默认不启用关闭确认，避免干扰 OAuth 跳转。",
    ],
    fixes: [
      "所有受控浏览器任务提示增加最短显示时间，避免快速检测或跳转时一闪而过。",
      "清理提示时支持指定目标授权页，减少多个受控标签页同时存在时清错页面的情况。",
    ],
  },
  {
    version: "1.14.0",
    date: "2026-06-30",
    title: "ChatGPT 后台任务提示",
    highlights: [
      "ChatGPT 受控浏览器执行账号状态读取、应用同步检测和 MCP 自动配置时，会在页面顶部显示当前后台任务。",
      "自定义 MCP 创建、同 URL 复用、OAuth 授权和官方应用连接阶段增加防误关保护，降低中途关闭导致配置失败的概率。",
      "OAuth 回调跳转阶段会临时取消防误关保护，避免授权回调被浏览器离开确认拦截。",
    ],
    fixes: [
      "静默检测不会为了显示任务提示额外打开新的 ChatGPT 窗口。",
      "任务完成或失败后会清理受控浏览器顶部提示，用户关闭窗口时清理失败不会影响同步结果。",
    ],
  },
  {
    version: "1.13.0",
    date: "2026-06-29",
    title: "应用同步自动配置",
    highlights: [
      "应用同步接入 ChatGPT 当前 Profile 的真实连接器状态检测，自动识别官方应用和自定义 MCP 是否已连接。",
      "应用同步明细支持一键配置自定义 MCP，并对密码型 OAuth MCP 自动完成授权回调。",
      "OAuth MCP 密码按敏感凭据加密保存，列表只展示是否已保存，不展示、不复制明文。",
    ],
    fixes: [
      "移除应用同步明细里的人工标记已同步和跳过按钮，状态改为依赖真实检测结果。",
      "修复侧栏滚动条、底部版本块、启用状态样式和明细表格自适应体验问题。",
    ],
  },
  {
    version: "1.12.1",
    date: "2026-06-29",
    title: "应用同步界面修复",
    highlights: [
      "应用同步配置新增和编辑统一使用弹窗表单，表单操作按钮固定在弹窗底部。",
      "ChatGPT 会话列表的应用同步明细弹窗保留默认宽度，明细表格按弹窗宽度自适应。",
    ],
    fixes: [
      "修复应用同步操作列按钮样式和 tooltip 表现不一致的问题。",
      "修复应用同步明细表格受全局表格最小宽度影响导致布局不稳定的问题。",
    ],
  },
  {
    version: "1.12.0",
    date: "2026-06-28",
    title: "ChatGPT 应用同步",
    highlights: [
      "新增 ChatGPT 应用同步页面，集中管理官方应用和自定义 MCP 配置。",
      "配置支持全部或指定 ChatGPT Profile，并记录每个 Profile 的待同步、已同步、失败和跳过状态。",
      "自定义 MCP 的 Server URL 变化后，只需更新中心配置，相关账号会自动标记为待同步。",
    ],
    fixes: [
      "新增账号会自动纳入已有应用配置同步台账，减少多账号漏配官方应用或 MCP 的情况。",
      "打开应用页复用既有 ChatGPT 外部浏览器 Profile 能力，不读取聊天内容或保存第三方授权 token。",
    ],
  },
  {
    version: "1.11.9",
    date: "2026-06-28",
    title: "ChatGPT 后台检查热修",
    highlights: [
      "后台检查只确认本地 ChatGPT cookie 是否存在，不再用无界面浏览器请求 ChatGPT 页面接口。",
      "检查结果缺少账号详情时，会保留列表中已保存的邮箱、账号 ID 和计划信息。",
    ],
    fixes: [
      "修复 1.11.8 后台检查可能把 ChatGPT 会话误判为需验证，并清空已识别身份展示的问题。",
    ],
  },
  {
    version: "1.11.8",
    date: "2026-06-28",
    title: "ChatGPT 会话后台检查",
    highlights: [
      "手动刷新 ChatGPT 会话时改为后台静默检查，不再弹出检查用网页。",
      "打开后的补查、自动状态刷新补查和组合导入后的补查统一走后台检查路径。",
    ],
    fixes: [
      "修复关闭检查网页后，后续补查又重新打开网页才提示检查成功的问题。",
    ],
  },
  {
    version: "1.11.7",
    date: "2026-06-28",
    title: "组合登录首次限额刷新",
    highlights: [
      "GPT+Codex 组合登录导入 Codex 账号后，会立即读取一次该账号限额。",
      "移除无法可靠阻止浏览器外部协议弹窗的授权页关闭尝试，保留明确提示。",
    ],
    fixes: [
      "修复组合登录成功后账号列表首次显示限额仍为未刷新的问题。",
    ],
  },
  {
    version: "1.11.6",
    date: "2026-06-28",
    title: "ChatGPT 登录页直达修复",
    highlights: [
      "新建或未识别身份的 ChatGPT Profile 会直接打开 ChatGPT 登录路由。",
      "组合登录第一步不再依赖 ChatGPT 首页登录按钮触发跳转。",
    ],
    fixes: [
      "修复 ChatGPT 首页登录按钮无响应时，组合登录无法继续完成网页端登录的问题。",
    ],
  },
  {
    version: "1.11.5",
    date: "2026-06-28",
    title: "组合登录误触发修复",
    highlights: [
      "组合登录自动继续 Codex OAuth 前，会先确认 ChatGPT Profile 已读到账号邮箱或账号 ID。",
      "仅有浏览器 cookie 或会员信息不可用状态时，会继续等待用户完成 ChatGPT 登录。",
    ],
    fixes: [
      "修复新建组合账号后 ChatGPT 尚未真正登录，就直接进入 Codex OAuth 的问题。",
    ],
  },
  {
    version: "1.11.4",
    date: "2026-06-28",
    title: "组合登录自动推进",
    highlights: [
      "组合登录会在检测到 ChatGPT 登录完成后自动打开同一浏览器 Profile 中的 Codex OAuth。",
      "添加账号页将 GPT+Codex 组合登录提升为推荐主入口，单独登录 Codex 改为副链路。",
    ],
    fixes: [
      "修复 GPT 登录完成后流程停滞、仍需回到应用手动点击继续 Codex OAuth 的体验断点。",
      "Codex OAuth 导入成功后会尝试关闭授权页，并提示浏览器外部协议弹窗选择取消不影响导入。",
    ],
  },
  {
    version: "1.11.3",
    date: "2026-06-28",
    title: "组合登录联动测试版",
    highlights: [
      "本机测试版安装包包含 GPT+Codex 组合登录外部浏览器联动改动。",
      "组合登录继续 Codex OAuth 时会复用刚创建的 ChatGPT Chrome/Edge Profile。",
    ],
    fixes: [
      "便于验证 Codex 授权页是否能复用刚完成的 ChatGPT 网页端登录态。",
    ],
  },
  {
    version: "1.11.2",
    date: "2026-06-28",
    title: "ChatGPT 会话检查收敛修复",
    highlights: [
      "组合登录 GPT+Codex 时，Codex OAuth 会复用刚创建的外部 Chrome/Edge Profile 打开。",
      "手动检查 ChatGPT 登录状态时会给出明确成功或失败提示。",
      "检查临时拉起的 Chrome/Edge Profile 会在检查结束后自动关闭。",
    ],
    fixes: [
      "修复组合登录中 GPT 网页端和 Codex OAuth 分别落在外部浏览器与内置窗口，无法复用登录态的问题。",
      "修复手动检查后 ChatGPT 检查网页停留不关闭的问题。",
      "修复检查结果缺少提示、容易误以为后台持续循环检查的问题。",
    ],
  },
  {
    version: "1.11.1",
    date: "2026-06-26",
    title: "重置次数推荐计分修正",
    highlights: [
      "账号推荐算法改为分项计算周/月额度压力与一次性重置次数压力，避免过早放大可用重置次数。",
      "可用重置次数只在会员到期时间明确时参与推荐；会员到期未知时仍展示次数但不计入推荐分数。",
    ],
    fixes: [
      "修正可用重置次数直接并入当前周/月额度后按周重置时间计算，可能提前推荐一次性重置资源的问题。",
      "推荐说明会区分重置次数已按会员到期计入，或仅展示未计入推荐。",
    ],
  },
  {
    version: "1.11.0",
    date: "2026-06-26",
    title: "额度重置次数推荐",
    highlights: [
      "账号额度读取会识别 Codex 返回的可用重置次数，并在账号列表重置列和悬停说明中展示。",
      "推荐账号算法会把可用重置次数折算为额外周/月额度，避免临近到期账号的可重置额度被浪费。",
    ],
    fixes: [
      "推荐说明会显示有效周/月限额、当前剩余额度和可用重置次数，方便核对推荐依据。",
      "清理桌面端 ChatGPT 备份导入的未使用异常参数，保持 ESLint 检查通过。",
    ],
  },
  {
    version: "1.10.1",
    date: "2026-06-22",
    title: "定时刷新 5 小时激活修复",
    highlights: [
      "定时刷新“同时激活 5 小时额度”会按当前 Codex app-server schema 发起最小 turn。",
      "旧版写入的未确认激活记录不会再阻止后续定时刷新重新触发。",
    ],
    fixes: [
      "修正 5 小时激活未被 Codex 确认时仍写入本地到期时间，导致后续定时刷新跳过真正激活的问题。",
      "修正最小 turn 未完成时仍被当作激活成功的问题。",
      "修正滚动的 5 小时重置占位值被误判为已激活的问题。",
    ],
  },
  {
    version: "1.10.0",
    date: "2026-06-22",
    title: "定时刷新可选激活 5 小时额度",
    highlights: [
      "定时刷新配置新增“同时激活 5 小时额度”开关，可在刷新时发送最小 Codex 请求开启 5 小时窗口。",
      "激活记录会保存到本地账号数据中，窗口到期前后续定时刷新只读取额度，不重复触发激活。",
      "定时刷新执行记录新增 5 小时激活、跳过和失败统计，便于判断后台刷新结果。",
    ],
    fixes: [
      "修正单纯读取额度不会启动 5 小时窗口导致重置时间始终显示约 5 小时后的行为预期。",
    ],
  },
  {
    version: "1.9.0",
    date: "2026-06-17",
    title: "GPT+Codex 组合登录入口",
    highlights: [
      "Codex 添加账号页新增“单独登录 Codex”和“组合登录 GPT+Codex”两个入口。",
      "ChatGPT 添加会话页合并单独 GPT 与组合账号操作，并新增待关联 Codex 账号列表。",
      "待关联 Codex 账号可直接补 GPT 会话，账号较多时列表会在卡片内滚动。",
    ],
    fixes: [
      "统一 Codex 与 ChatGPT 添加入口的信息架构，减少组合账号能力被遗忘或隐藏的问题。",
    ],
  },
  {
    version: "1.8.2",
    date: "2026-06-12",
    title: "ChatGPT 窗口复用修复",
    highlights: [
      "ChatGPT 后台状态同步改为复用已经打开的 ChatGPT 页面，不再每次检查都创建新的可见窗口。",
      "再次打开同一个 ChatGPT Profile 时会激活已有页面，避免重复打开多个窗口或标签。",
    ],
    fixes: [
      "修复登录后自动同步每隔数秒打开新窗口、随后又自动关闭部分窗口的问题。",
      "修复状态检查完成后关闭新建页面导致窗口数量在 3-4 个之间波动的体验问题。",
    ],
  },
  {
    version: "1.8.1",
    date: "2026-06-11",
    title: "ChatGPT 登录后自动同步",
    highlights: [
      "新建或打开 ChatGPT 浏览器 Profile 后会在后台延迟检查登录状态，登录完成后自动写回账号、计划和会员信息。",
      "自动同步会在读到会员到期或续费时间前继续补充刷新，减少刚登录后仍显示会员信息不可用的情况。",
    ],
    fixes: [
      "后台自动检查不会把登录前的未登录状态写入管理列表，避免刚打开时误显示失效或会员信息不可用。",
      "组合账号保存后会继续触发 ChatGPT 信息同步，管理列表能更快看到已登录账号信息。",
    ],
  },
  {
    version: "1.8.0",
    date: "2026-06-11",
    title: "ChatGPT 外部浏览器 Profile",
    highlights: [
      "ChatGPT 账号改为使用独立 Chrome/Edge 浏览器 Profile，真实网页交互交给外部浏览器承载。",
      "新建和导入的 ChatGPT profile 会写入本机独立浏览器目录，不再依赖 Electron 内嵌窗口。",
    ],
    fixes: [
      "备份导入导出和状态检查改为通过本机 CDP 读写允许域名 cookie 与 localStorage。",
      "移除旧 Electron 内嵌 ChatGPT 窗口路径，统一使用外部浏览器 Profile。",
    ],
  },
  {
    version: "1.7.3",
    date: "2026-06-11",
    title: "ChatGPT 会员日期修复",
    highlights: [
      "ChatGPT 订阅接口读取会携带当前会话 access token，匹配网页端真实请求能力。",
      "会员日期读取会从可用账号候选中自动选择 subscriptions 返回成功的 account ID。",
    ],
    fixes: [
      "修复 subscriptions 仅带 Cookie 时返回 401，导致会员信息仍显示不可用的问题。",
      "修复 ChatGPT 返回多个 UUID 候选时只取固定字段导致漏读真实 billing account ID 的问题。",
    ],
  },
  {
    version: "1.7.2",
    date: "2026-06-11",
    title: "ChatGPT 会员到期修复",
    highlights: [
      "ChatGPT 会话状态检查会重新识别真实 billing account ID，再读取订阅信息。",
      "继续保留全应用纯图标按钮的悬停说明与可访问标签。",
    ],
    fixes: [
      "修复 accounts/check 返回 default 包装键时，错误保存 default 导致 subscriptions 无法读取会员日期的问题。",
      "修复旧数据中 default 或 user ID 被当作订阅 account_id 继续复用的问题。",
    ],
  },
  {
    version: "1.7.1",
    date: "2026-06-11",
    title: "ChatGPT 会话列表优化",
    highlights: [
      "ChatGPT 会话列表账号列改为上方备注、下方账号，减少重复列占用。",
      "刷新全部按钮改为黑底白字，并统一显示为“刷新全部”。",
    ],
    fixes: [
      "操作列改为纯图标按钮，保留悬停提示，默认窗口下更容易完整显示。",
      "去除独立备注列后收窄表格最小宽度，降低横向滚动概率。",
      "修复 ChatGPT 用户 ID 被误当作订阅 account_id 保存，导致会员到期仍显示不可用的问题。",
    ],
  },
  {
    version: "1.7.0",
    date: "2026-06-11",
    title: "ChatGPT 会员到期读取优化",
    highlights: [
      "ChatGPT 会话状态检查改为优先读取明确的订阅接口，提升会员到期和续费时间的准确性。",
      "已保存 ChatGPT 账号 ID 的会话会直接读取订阅信息，减少不必要的账号检查请求。",
    ],
    fixes: [
      "修复部分账号无法从 Codex 登录态或通用账号检查接口读取会员到期时间的问题。",
      "保留账号检查接口作为缺失账号 ID 或订阅接口不可用时的兜底来源。",
    ],
  },
  {
    version: "1.6.4",
    date: "2026-06-10",
    title: "ChatGPT 备份迁移修复",
    highlights: [
      "ChatGPT 备份加密改为异步派生密钥，降低导出时主窗口卡顿和闪退风险。",
      "ChatGPT 备份只迁移 cookies 和 localStorage，不再打包临时 sessionStorage。",
    ],
    fixes: [
      "导入备份时单个 cookie 写入失败不再导致整个会话写入失败。",
      "拆分桌面端 ChatGPT 备份逻辑，避免主进程文件继续膨胀。",
    ],
  },
  {
    version: "1.6.3",
    date: "2026-06-10",
    title: "ChatGPT 会员到期修复",
    highlights: [
      "ChatGPT 会话列表的会员时间不再额外显示“到期”或“续费”前缀。",
      "读取会员时间时只使用接口 JSON 中明确的订阅或账单字段。",
    ],
    fixes: [
      "避免把 ChatGPT 账号接口中的泛化 expires、paid_until 或 active_until 字段误判为会员到期。",
      "接口未返回明确订阅或账单日期字段时，会显示会员信息不可用而不是猜测日期。",
    ],
  },
  {
    version: "1.6.2",
    date: "2026-06-10",
    title: "ChatGPT 会话状态修复",
    highlights: [
      "ChatGPT 会话页打开后会自动检查未检查账号，打开已有会话后也会刷新登录状态。",
      "刷新全部 ChatGPT 移到会话表格右上角，全部会话页不再显示重复的添加会话按钮。",
    ],
    fixes: [
      "计划名会过滤 ChatGPT 内部值，优先显示 Plus、Pro、Team、Enterprise、Free 等可读名称。",
      "会员到期和续费时间解析补充更多字段来源，账号和备注列不再展示不明技术小字。",
    ],
  },
  {
    version: "1.6.1",
    date: "2026-06-10",
    title: "ChatGPT 账号自动关联",
    highlights: [
      "ChatGPT 添加账号不再要求填写会话名称或手动选择绑定 Codex。",
      "检查 ChatGPT 登录状态读取到邮箱后，会自动关联本机同邮箱 Codex 账号。",
    ],
    fixes: [
      "ChatGPT 会话名称降级为备注，列表优先展示真实账号邮箱或名称。",
      "组合账号和备份导入说明统一为按邮箱自动关联，减少手动绑定心智负担。",
    ],
  },
  {
    version: "1.6.0",
    date: "2026-06-10",
    title: "ChatGPT 网页会话",
    highlights: [
      "新增 ChatGPT 网页会话模块，可隔离多个 ChatGPT 登录态。",
      "ChatGPT 会话支持绑定已保存 Codex 账号，并拆分为全部会话、添加会话和导入导出入口。",
    ],
    fixes: [
      "ChatGPT 网页登录态迁移备份使用密码加密，导入时写入新的独立会话目录。",
      "修正 Web 预览启动方式，避免 React Refresh 重复注入导致页面编译失败。",
    ],
  },
  {
    version: "1.5.4",
    date: "2026-06-10",
    title: "额度表头与表格排版修正",
    highlights: [
      "中文界面将 5 小时和周/月额度表头统一改为限额表述。",
      "账号列表撤回固定列宽，恢复自适应列宽和横向滚动体验。",
    ],
    fixes: [
      "重置列表头和 5H 限额行内容使用同一单元格起点对齐。",
      "保留长账号名省略保护，避免覆盖其它列。",
    ],
  },
  {
    version: "1.5.3",
    date: "2026-06-10",
    title: "账号列表与刷新触发修复",
    highlights: [
      "账号列表改为稳定列宽并允许横向滚动，长账号名不会覆盖其它列。",
      "定时刷新不再因应用或服务启动处于刷新窗口而立即执行。",
    ],
    fixes: [
      "账号名和邮箱改为块级省略显示，Recommended 标记不会挤占列外空间。",
      "刷新入口收敛为手动刷新和定时任务到点刷新，不保留启动即时刷新。",
    ],
  },
  {
    version: "1.5.2",
    date: "2026-06-10",
    title: "英文列表排版修复",
    highlights: [
      "英文界面将 5 小时额度标题统一显示为 5H Limit。",
      "账号列表保留 Recommended 标记，但不再挤占账号名称显示空间。",
    ],
    fixes: [
      "修正 reset 列英文 5 小时额度标签过窄导致文字拥挤的问题。",
      "推荐账号徽标移动到账号元信息行，账号名称保持独立省略显示。",
    ],
  },
  {
    version: "1.5.1",
    date: "2026-06-10",
    title: "本机版本更新",
    highlights: [
      "应用版本同步到 1.5.1，本机安装包可直接覆盖更新。",
      "版本同步脚本适配当前 README 版本文案，后续发版不再卡在旧中文匹配规则。",
    ],
    fixes: [
      "补齐 app-server、登录会话客户端和共享版本元数据的 1.5.1 标识。",
      "关于页更新日志新增 1.5.1 记录，便于确认当前安装版本。",
    ],
  },
  {
    version: "1.5.0",
    date: "2026-06-09",
    title: "账号选择导出",
    highlights: [
      "账号迁移页支持勾选要导出的 Codex 账号，不再默认导出全部登录态。",
      "导出卡片新增全选、清空和已选数量，迁移多个账号时可以控制备份范围。",
    ],
    fixes: [
      "后端导出接口改为接收账号 ID 列表，只解密并写入选中账号。",
      "备份 JSON 结构保持不变，已有备份导入流程继续兼容。",
    ],
  },
  {
    version: "1.4.5",
    date: "2026-06-08",
    title: "登录账号识别修复",
    highlights: [
      "添加账号完成后会先确认是否真的是当前账号重新登录，再决定是否写回当前 Codex。",
      "不同邮箱的新账号只会保存到账号库，不会直接替换当前 Codex 登录态。",
    ],
    fixes: [
      "修复不同邮箱登录态可能解析出相同账号 ID，导致误判为当前账号并重启 Codex 的问题。",
      "账号导入不再单独按账号 ID 合并记录，避免不同邮箱账号互相覆盖。",
    ],
  },
  {
    version: "1.4.4",
    date: "2026-06-08",
    title: "重置提示体验修正",
    highlights: [
      "账号列表保持动态列宽，延续原有自适应展示体验。",
      "重置列整块区域都可以触发悬停提示，更容易查看另一种重置时间。",
    ],
    fixes: [
      "修复重置提示只在具体文字上悬停才可能触发的问题。",
      "悬停提示只展示当前模式的反向重置时间，不再重复显示剩余百分比或当前模式信息。",
      "当前显示剩余时长时，悬停提示直接显示日期时间，不再额外显示“准确时间”文字。",
    ],
  },
  {
    version: "1.4.3",
    date: "2026-06-08",
    title: "窗口尺寸与重置提示",
    highlights: [
      "应用主窗口默认尺寸调整为 1400 x 800，更贴近日常使用宽度。",
      "账号列表重置列悬停时会一次性显示 5 小时限额和周/月限额的完整信息。",
    ],
    fixes: [
      "修正 1.4.2 默认窗口过宽的问题。",
      "恢复账号列表动态列宽，撤回固定列布局。",
      "重置列不再只给单行时间加提示，悬停整块即可看到剩余比例、剩余重置时间和准确重置时间。",
    ],
  },
  {
    version: "1.4.2",
    date: "2026-06-08",
    title: "登录错误页检测增强",
    highlights: [
      "应用主窗口默认宽度加大，账号列表操作列默认更容易完整显示。",
      "普通 OAuth 授权窗口会监听 OpenAI 错误页标题，并在页面渲染后多次复查正文。",
    ],
    fixes: [
      "修复部分 OpenAI Route Error 页面已显示但自动重试没有触发的问题。",
      "账号列表改为固定列布局，减少默认窗口宽度下需要横向滚动才能看到操作按钮的情况。",
    ],
  },
  {
    version: "1.4.1",
    date: "2026-06-08",
    title: "登录异常自动重试",
    highlights: [
      "添加 Codex 新账号仍然使用普通 OAuth 登录，不新增其他备用入口。",
      "应用内授权窗口遇到 OpenAI Route Error 时，会自动重新获取一次授权链接并重开窗口。",
    ],
    fixes: [
      "减少首次登录被 Cloudflare 前置页面打断后，需要手动关闭窗口再点一次开始登录的情况。",
      "自动重试沿用同一个隔离登录会话，避免前端轮询和最终 auth.json 导入状态脱节。",
    ],
  },
  {
    version: "1.4.0",
    date: "2026-06-08",
    title: "账号使用推荐",
    highlights: [
      "全部账号列表会自动标记当前更推荐使用的账号，减少多账号额度调度的心智负担。",
      "推荐基于周/月剩余额度、距离重置时间和 5 小时额度可用状态，只使用本地已刷新数据计算。",
    ],
    fixes: [
      "修复推荐算法按毫秒比较秒级重置时间，导致推荐徽标无法显示的问题。",
      "推荐徽标悬停会展示周/月剩余和 5 小时剩余，方便快速确认推荐依据。",
    ],
  },
  {
    version: "1.3.6",
    date: "2026-06-08",
    title: "普通登录风控修复",
    highlights: [
      "登录新账号继续使用普通 OAuth 授权流程，不新增其他备用登录入口。",
      "应用内授权窗口改为保留 Cloudflare 验证态，同时清理 OpenAI 账号会话，降低重复人机验证概率。",
    ],
    fixes: [
      "修复密码确认后容易出现 Invalid content type: text/html 并反复触发 Cloudflare 的登录体验问题。",
      "授权窗口使用 Chrome-like User-Agent，减少 Electron 浏览器指纹触发官方登录风控的概率。",
    ],
  },
  {
    version: "1.3.4",
    date: "2026-06-08",
    title: "登录完成兜底导入",
    highlights: [
      "添加 Codex 账号完成授权后，即使官方登录通知没有返回，也会检测隔离目录中的 auth.json 并完成导入。",
      "同账号重新登录后，新登录态会自动覆盖已保存账号记录，无需手动导入隔离文件。",
    ],
    fixes: [
      "修复授权目录已生成 auth.json 但登录会话仍停留在 running，导致旧登录态继续刷新失败的问题。",
      "修复同账号重登后账号列表没有真正写入新登录态的漏导入路径。",
    ],
  },
  {
    version: "1.3.3",
    date: "2026-06-08",
    title: "同账号重登状态修复",
    highlights: [
      "同一 Codex 账号重新登录导入成功后，会更新已保存账号的登录态。",
      "重登后会清理该账号旧的刷新失败状态，避免继续显示已失效令牌提示。",
    ],
    fixes: [
      "修复刷新令牌被官方拒绝后，同账号重新登录仍显示旧失败提示的问题。",
      "账号凭据更新和旧失败快照清理在同一事务中完成，避免列表状态与保存登录态不一致。",
    ],
  },
  {
    version: "1.3.2",
    date: "2026-06-05",
    title: "定时刷新自动同步",
    highlights: [
      "应用会检测定时刷新完成时间变化，并自动同步全部账号列表。",
      "停留在全部账号页时，后台定时刷新完成后也会更新额度和上次刷新时间。",
    ],
    fixes: [
      "修复定时任务后台完成后，全部账号列表不会自动刷新最新账号数据的问题。",
      "账号列表同步仅在定时刷新完成时间变化时触发，避免持续拉取账号详情。",
    ],
  },
  {
    version: "1.3.1",
    date: "2026-06-05",
    title: "账号刷新时间同步",
    highlights: [
      "进入全部账号页时会重新同步账号列表，展示最新的账号刷新时间。",
      "定时刷新后台完成后，再切回全部账号可以看到服务端最新记录。",
    ],
    fixes: [
      "修复全部账号页复用旧前端状态，导致上次刷新时间与实际定时任务执行不一致的问题。",
      "版本同步脚本补齐登录会话客户端版本字段，避免发版时遗漏。",
    ],
  },
  {
    version: "1.3.0",
    date: "2026-06-05",
    title: "官方 app-server 登录",
    highlights: [
      "添加 Codex 新账号改为调用官方 app-server 的 account/login/start 获取 OAuth 授权链接。",
      "授权页继续由 Squirrel Switch 应用内临时窗口承接，不再执行 codex login。",
    ],
    fixes: [
      "从根源避免 Codex CLI 自动打开 Edge 等系统默认浏览器。",
      "授权链接操作按钮移到链接框上方，链接框固定高度滚动，避免非全屏时纵向拉长。",
    ],
  },
  {
    version: "1.2.3",
    date: "2026-06-05",
    title: "授权窗口阻断修复",
    highlights: [
      "添加 Codex 新账号时，桌面版会优先用应用内窗口承接 OAuth 授权链接。",
      "授权链接出现后提供“打开窗口”和“复制链接”两个明确操作。",
    ],
    fixes: [
      "阻断 Codex CLI 自己调用系统默认浏览器打开 OpenAI 账号选择页。",
      "修复添加账号页长 URL 和登录状态文字撑破卡片的问题。",
    ],
  },
  {
    version: "1.2.2",
    date: "2026-06-05",
    title: "应用内授权窗口",
    highlights: [
      "添加 Codex 新账号时，OAuth 授权页改为在 Squirrel Switch 应用内临时窗口打开。",
      "临时授权窗口使用独立非持久会话，不复用系统默认浏览器窗口。",
    ],
    fixes: [
      "修复默认浏览器先打开普通 OpenAI 选号页，然后再打开其他隐私窗口的双开问题。",
      "服务端不再直接调用外部浏览器，授权链接由桌面壳统一处理。",
    ],
  },
  {
    version: "1.2.1",
    date: "2026-06-05",
    title: "无痕窗口修复",
    highlights: [
      "添加 Codex 新账号仍使用普通 OAuth 授权流程。",
      "打开授权链接时强制浏览器新实例接收无痕/隐私参数，避免复用已有普通窗口。",
    ],
    fixes: [
      "修复 Edge 已在运行时授权页仍进入默认普通窗口的问题。",
      "继续保留自动打开失败时只展示复制链接、不回退普通浏览器的安全边界。",
    ],
  },
  {
    version: "1.2.0",
    date: "2026-06-05",
    title: "无痕 OAuth 登录",
    highlights: [
      "添加 Codex 新账号继续使用普通 OAuth 授权流程，保留原有登录体验。",
      "授权链接由 Squirrel Switch 接管后优先在 Chrome、Edge 或 Brave 的无痕/隐私窗口打开。",
    ],
    fixes: [
      "阻止 Codex CLI 自动打开系统默认普通浏览器，降低误复用已有 OpenAI 登录态的风险。",
      "自动打开失败时只展示授权链接和复制按钮，不回退到普通浏览器外链。",
    ],
  },
  {
    version: "1.1.0",
    date: "2026-06-05",
    title: "定时刷新",
    highlights: [
      "Codex 账号管理在导入导出下新增定时刷新入口，支持运行期自动刷新全部账号限额。",
      "定时刷新页支持滑块开关、刷新间隔、时间轴区间调整和最近执行列表。",
    ],
    fixes: [
      "刷新间隔改为标签、输入框和分钟单位横向并排，控制区布局更紧凑。",
      "时间轴手柄和执行列表样式完成打磨，避免占用全部账号主页面空间。",
    ],
  },
  {
    version: "1.0.11",
    date: "2026-06-02",
    title: "免费账号月额度",
    highlights: [
      "Codex 免费账号返回月度额度窗口时，账号列表会归入周/月剩余列展示。",
      "已有额度快照可从原始响应回显月度窗口，不需要重新刷新账号才看到数据。",
    ],
    fixes: [
      "修复免费账号刷新成功但只返回 43200 分钟窗口时，额度仍显示无法获取的问题。",
      "周/月重置时间按实际窗口显示为 1 周或 1 月，避免把月额度误标成周额度。",
    ],
  },
  {
    version: "1.0.10",
    date: "2026-06-01",
    title: "登录态磁盘与库一致性",
    highlights: [
      "重新登录命中当前账号时，会自动退出 Codex、回写最新 auth.json 并重新打开，使磁盘登录态立即生效。",
      "刷新当前账号额度时磁盘登录态优先，磁盘失效会自动回退到已保存登录态并当场修复磁盘。",
    ],
    fixes: [
      "修复重新登录当前账号后磁盘 auth.json 仍是旧凭据、刷新额度持续报 401 的问题。",
      "切换账号回收当前登录态前先校验有效性，避免用已失效凭据覆盖数据库中更可信的记录。",
    ],
  },
  {
    version: "1.0.9",
    date: "2026-05-30",
    title: "切换前回收登录态",
    highlights: [
      "启用目标账号前会先尝试回收当前 Codex 最新登录态，降低刷新令牌轮换后旧副本失效的概率。",
      "回收时只在确认当前 auth.json 属于已激活账号后才加密回写，避免误写其他账号凭据。",
    ],
    fixes: [
      "修复 Codex 使用过程中轮换登录态后，切换账号会覆盖掉当前账号最新 auth.json 副本的问题。",
      "回收失败或身份不匹配时改为记录运行日志并继续切换，不阻断正常账号启用。",
    ],
  },
  {
    version: "1.0.8",
    date: "2026-05-28",
    title: "登录态验证修复",
    highlights: [
      "账号启用时将账号读取与额度读取分离，额度接口临时失败不再阻断可用账号启用。",
      "失效登录态会显示重新登录提示，避免展示后端原始错误正文。",
    ],
    fixes: [
      "修复 chatgpt.com 额度接口临时请求失败导致已写入 auth.json 后仍误报验证失败的问题。",
      "修复 refresh token 被重复使用或 token_revoked 时错误提示过长、不够可操作的问题。",
    ],
  },
  {
    version: "1.0.7",
    date: "2026-05-26",
    title: "账号刷新时间",
    highlights: [
      "Codex 全部账号列表新增上次刷新时间列，方便直接判断额度数据新旧。",
      "上次刷新时间以“几分钟前、几小时前、几天前”的相对时间显示。",
    ],
    fixes: [
      "新增列后适当增加账号表格最小宽度，避免操作区被挤压。",
    ],
  },
  {
    version: "1.0.6",
    date: "2026-05-25",
    title: "页面反馈与卡片布局修复",
    highlights: [
      "刷新进度、成功提示和错误提示改为只在触发操作的当前页面显示。",
      "Codex 与 Claude Code 的导入导出卡片按钮统一固定在卡片底部。",
    ],
    fixes: [
      "修复 Codex 刷新完成和刷新失败提示切到 Claude Code 页面后仍全局显示的问题。",
      "修复 Claude Code 添加配置、导入导出，以及 Codex 添加账号、导入导出卡片按钮因文案高度不同导致不对齐的问题。",
    ],
  },
  {
    version: "1.0.5",
    date: "2026-05-24",
    title: "刷新体验优化",
    highlights: [
      "刷新全部账号时，账号会在单条刷新完成后立即更新显示，不再等待全部完成。",
      "账号列表优先按计划排序为 Pro、Plus、Free，同计划内再按周重置时间排序。",
      "刷新全部改为小并发执行，并为刷新完成的行加入从左到右的纯白高光扫过动画。",
    ],
    fixes: [
      "修正刷新完成高光被表格列拆成多段的问题。",
      "降低刷新完成高光动画速度，让扫过效果更自然。",
    ],
  },
  {
    version: "1.0.4",
    date: "2026-05-23",
    title: "提示词管理",
    highlights: [
      "新增提示词管理页，集中编辑系统级提示词、Codex AGENTS.md 和 Claude Code CLAUDE.md。",
      "平台提示词会直接保存到官方默认文件，缺失时可使用系统级提示词作为默认内容。",
    ],
    fixes: [
      "Codex 存在 AGENTS.override.md 时会提示实际优先生效，避免误判保存结果。",
      "提示词保存日志只记录平台和路径，不记录提示词正文。",
    ],
  },
  {
    version: "1.0.3",
    date: "2026-05-23",
    title: "迁移修复与日志分页",
    highlights: [
      "运行日志新增分页展示，每页 50 条，长日志查看更稳定。",
      "私有项目文档中的历史命名统一为 Squirrel Switch。",
    ],
    fixes: [
      "修复新库已创建时历史账号和额度快照未合并的问题。",
      "关于页只保留版本卡片，移除重复公告文本，并限制展示最近 5 个版本。",
      "账号迁移页导出和导入按钮对齐到底部，视觉布局更整齐。",
    ],
  },
  {
    version: "1.0.2",
    date: "2026-05-23",
    title: "额度展示与发版日志",
    highlights: [
      "关于页新增版本更新日志，后续发版内容可直接在应用内查看。",
      "版本更新日志由共享版本数据生成，发版时同步维护。",
    ],
    fixes: [
      "修复免费账号只返回周额度窗口时，周剩余被误显示为 5 小时剩余的问题。",
    ],
  },
  {
    version: "1.0.1",
    date: "2026-05-22",
    title: "Squirrel Switch 品牌与桌面体验",
    highlights: [
      "应用名称、包名、macOS 打包产物和本地数据目录统一为 Squirrel Switch。",
      "新增关于页、运行日志页、账号启用和删除前二次确认。",
      "打包产物加入应用图标，支持生成 Squirrel Switch.app。",
    ],
    fixes: [
      "兼容历史数据目录、Keychain 主密钥和备份标识迁移。",
      "优化账号排序和额度刷新流程，订阅信息获取失败时不阻塞主流程。",
    ],
  },
];

export const RECENT_VERSION_UPDATE_LOG = VERSION_UPDATE_LOG.slice(0, VERSION_UPDATE_LOG_LIMIT);

export type {
  ChatGptAppAuthType,
  ChatGptAppConfigManagementState,
  ChatGptAppConfigProfileView,
  ChatGptAppConfigType,
  ChatGptAppConfigView,
  ChatGptAppConfigureResult,
  ChatGptAppConnectorLinkView,
  ChatGptAppScopeType,
  ChatGptAppSyncCheckResult,
  ChatGptAppSyncStateView,
  ChatGptAppSyncStatus,
  UpdateChatGptAppSyncStatusPayload,
  UpsertChatGptAppConfigPayload,
} from "./chatgpt-app-configs.js";

export type PlanType =
  | "free"
  | "go"
  | "plus"
  | "pro"
  | "prolite"
  | "team"
  | "business"
  | "enterprise"
  | "edu"
  | "unknown";

export interface RateLimitWindowView {
  usedPercent: number | null;
  remainingPercent: number | null;
  windowMinutes: number | null;
  resetsAt: number | null;
}

export interface UsageSnapshotView {
  id: string;
  source: string;
  primary: RateLimitWindowView | null;
  secondary: RateLimitWindowView | null;
  resetAvailableCount: number | null;
  rawJson: unknown;
  stale: boolean;
  error: string | null;
  fetchedAt: number;
}

export interface AccountView {
  id: string;
  name: string;
  email: string | null;
  accountId: string | null;
  workspaceId: string | null;
  planType: PlanType | string | null;
  subscriptionPlan: string | null;
  subscriptionExpiresAt: number | null;
  subscriptionRenewsAt: number | null;
  subscriptionError: string | null;
  isActive: boolean;
  lastActivatedAt: number | null;
  lastRefreshedAt: number | null;
  fiveHourActivationStartedAt: number | null;
  fiveHourActivationUntil: number | null;
  fiveHourActivationSource: string | null;
  fiveHourActivationError: string | null;
  createdAt: number;
  updatedAt: number;
  usage: UsageSnapshotView | null;
}

export interface ChatGptProfileView {
  id: string;
  displayName: string;
  linkedCodexAccountId: string | null;
  linkedCodexAccountName: string | null;
  linkedCodexEmail: string | null;
  browserKind: ChatGptBrowserKind | null;
  browserExecutablePath: string | null;
  browserProfileDir: string | null;
  sessionHash: string | null;
  accountEmail: string | null;
  accountName: string | null;
  accountId: string | null;
  planType: string | null;
  planLabel: string | null;
  subscriptionExpiresAt: number | null;
  subscriptionRenewsAt: number | null;
  sessionStatus: ChatGptSessionStatus;
  lastCheckedAt: number | null;
  lastCheckError: string | null;
  lastOpenedAt: number | null;
  lastExportedAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export type ChatGptSessionStatus = "unchecked" | "available" | "invalid" | "reauth_required";
export type ChatGptBrowserKind = "chrome" | "edge" | "custom";

export interface UpsertChatGptProfilePayload {
  displayName?: string;
  linkedCodexAccountId?: string | null;
  browserKind?: ChatGptBrowserKind | null;
  browserExecutablePath?: string | null;
}

export interface ChatGptAccountStatusInput {
  status: ChatGptSessionStatus;
  accountEmail: string | null;
  accountName: string | null;
  accountId: string | null;
  planType: string | null;
  planLabel: string | null;
  subscriptionExpiresAt: number | null;
  subscriptionRenewsAt: number | null;
  error: string | null;
}

export interface ChatGptAccountStatusView extends ChatGptAccountStatusInput {
  profileId: string;
  checkedAt: number;
}

export interface CreateChatGptProfilePayload extends UpsertChatGptProfilePayload {
  id?: string;
  browserKind?: ChatGptBrowserKind | null;
  browserExecutablePath?: string | null;
  browserProfileDir?: string | null;
  sessionHash?: string | null;
  linkedCodexEmailHint?: string | null;
  accountEmailHint?: string | null;
  planLabelHint?: string | null;
}

export interface ImportChatGptProfileDescriptor {
  id?: string;
  displayName: string;
  browserKind?: ChatGptBrowserKind | null;
  browserExecutablePath?: string | null;
  browserProfileDir?: string | null;
  sessionHash: string | null;
  linkedCodexEmailHint: string | null;
  accountEmailHint: string | null;
  planLabelHint: string | null;
}

export interface ImportChatGptProfilesPayload {
  profiles: ImportChatGptProfileDescriptor[];
}

export interface ImportChatGptProfilesResult {
  imported: number;
  profiles: ChatGptProfileView[];
}

export interface ChatGptDesktopProfileInput {
  id: string;
  displayName: string;
  linkedCodexEmail: string | null;
  accountEmail: string | null;
  accountId: string | null;
  planLabel: string | null;
  browserKind: ChatGptBrowserKind | null;
  browserExecutablePath: string | null;
  browserProfileDir: string | null;
}

export interface ChatGptSessionSummary {
  hasSession: boolean;
  cookieCount: number;
  originStorageCount: number;
}

export interface ChatGptAccountStatusResult extends ChatGptAccountStatusInput {
  checkedAt: number;
}

export interface ChatGptExportBackupResult {
  backup: ChatGptBackupFile;
  exported: Array<{
    id: string;
    displayName: string;
    sessionHash: string | null;
    cookieCount: number;
    originStorageCount: number;
  }>;
}

export interface ChatGptImportBackupResult {
  profiles: ImportChatGptProfileDescriptor[];
  failed: number;
  partialFailed: number;
}

export interface ChatGptBackupFile {
  format: "squirrel-switch-chatgpt-backup";
  schemaVersion: 1 | 2;
  createdAt: string;
  appVersion: string;
  kdf: {
    name: "scrypt";
    salt: string;
    N: number;
    r: number;
    p: number;
  };
  cipher: {
    name: "aes-256-gcm";
    iv: string;
    tag: string;
    ciphertext: string;
  };
}

export interface RuntimeStatus {
  codexHome: string;
  authJsonExists: boolean;
  codexBinaryAvailable: boolean;
  codexBinaryPath: string | null;
  appServerAvailable: boolean;
  keychainAvailable: boolean;
  databasePath: string;
  runtimeLogPath: string;
}

export interface RuntimeLogView {
  id: string;
  time: number;
  level: "info" | "warn" | "error";
  scope: string;
  message: string;
}

export interface RuntimeLogPageView {
  logs: RuntimeLogView[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface ScheduledRefreshConfig {
  enabled: boolean;
  intervalMinutes: number;
  startTime: string;
  endTime: string;
  activateFiveHourWindow: boolean;
}

export type ScheduledRefreshStatus = "disabled" | "waiting" | "running" | "outside-window";

export interface ScheduledRefreshLastResult {
  startedAt: number;
  finishedAt: number;
  total: number;
  succeeded: number;
  failed: number;
  activated: number;
  activationSkipped: number;
  activationFailed: number;
  message: string;
}

export type ScheduledRefreshExecutionStatus = "success" | "partial" | "failed";

export interface ScheduledRefreshExecution {
  id: string;
  trigger: string;
  status: ScheduledRefreshExecutionStatus;
  startedAt: number;
  finishedAt: number;
  total: number;
  succeeded: number;
  failed: number;
  activated: number;
  activationSkipped: number;
  activationFailed: number;
  message: string;
}

export interface ScheduledRefreshState {
  config: ScheduledRefreshConfig;
  status: ScheduledRefreshStatus;
  nextRunAt: number | null;
  lastRunAt: number | null;
  lastFinishedAt: number | null;
  lastResult: ScheduledRefreshLastResult | null;
  executions: ScheduledRefreshExecution[];
}

export interface UpdateScheduledRefreshConfigPayload {
  enabled: boolean;
  intervalMinutes: number;
  startTime: string;
  endTime: string;
  activateFiveHourWindow: boolean;
}

export type PromptPlatformId = "codex" | "claude-code";

export type PromptPlatformSource = "platform" | "system" | "empty";

export type PromptPlatformWarningCode = "codex-override" | "unreadable" | "not-writable";

export interface PromptPlatformWarning {
  code: PromptPlatformWarningCode;
  message: string;
  path?: string;
}

export interface PromptPlatformState {
  id: PromptPlatformId;
  name: string;
  path: string;
  exists: boolean;
  empty: boolean;
  readable: boolean;
  writable: boolean;
  source: PromptPlatformSource;
  content: string;
  warnings: PromptPlatformWarning[];
  updatedAt: number | null;
}

export interface PromptManagementState {
  systemPrompt: string;
  platforms: PromptPlatformState[];
}

export interface UpdateSystemPromptParams {
  content: string;
}

export interface UpdatePlatformPromptParams {
  content: string;
}

export interface LoginSessionView {
  id: string;
  status: "running" | "imported" | "failed";
  codexHome: string;
  startedAt: number;
  completedAt: number | null;
  message: string;
  verificationUrl: string | null;
  userCode: string | null;
  privateBrowser: {
    attempted: boolean;
    opened: boolean;
    browserName: string | null;
    error: string | null;
  } | null;
  account: AccountView | null;
}

export interface CodexAppRestartView {
  attempted: boolean;
  restarted: boolean;
  error: string | null;
}

export interface ActivateAccountResult {
  account: AccountView;
  codexRestart: CodexAppRestartView;
}

export interface ImportAuthJsonPayload {
  name?: string;
  authJson: string | Record<string, unknown>;
}

export interface AccountBackupItem {
  name: string;
  authJson: Record<string, unknown>;
}

export interface AccountBackupPayload {
  app: "squirrel-switch";
  v: 1;
  exportedAt: string;
  accounts: AccountBackupItem[];
}

export interface ExportAccountBackupPayload {
  accountIds: string[];
}

export interface ImportAccountBackupResult {
  imported: number;
  accounts: AccountView[];
}

export interface UpdateAccountPayload {
  name?: string;
}

export type PlatformId = "codex" | "chatgpt" | "claude-code";

export interface PlatformView {
  id: PlatformId;
  displayName: string;
  capabilities: Array<
    | "credentialProfile"
    | "webSession"
    | "configSwitch"
    | "usageRefresh"
    | "backupExport"
    | "launcher"
  >;
}

export type ClaudeCodeProviderId =
  | "anthropic"
  | "glm-global"
  | "glm-china"
  | "deepseek"
  | "kimi"
  | "openrouter";

export type ClaudeCodeAuthHeader = "x-api-key" | "authorization-bearer";

export interface ClaudeCodeModelDefaults {
  main?: string;
  opus?: string;
  sonnet?: string;
  haiku?: string;
  subagent?: string;
}

export interface ClaudeCodeProviderTemplate {
  id: ClaudeCodeProviderId;
  displayName: string;
  defaultBaseUrl: string;
  authHeader: ClaudeCodeAuthHeader;
  defaultModels: ClaudeCodeModelDefaults;
  modelOptions: string[];
  notes?: string;
}

export interface ClaudeCodeProfileView {
  id: string;
  name: string;
  providerId: ClaudeCodeProviderId;
  providerName: string;
  baseUrl: string;
  mainModel: string;
  opusModel: string;
  sonnetModel: string;
  haikuModel: string;
  subagentModel: string;
  authHeader: ClaudeCodeAuthHeader;
  hasApiKey: boolean;
  customHeadersJson: string;
  disableNonessentialTraffic: boolean;
  apiKeyHelperTtlMs: number | null;
  isActive: boolean;
  lastAppliedAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface UpsertClaudeCodeProfilePayload {
  name: string;
  providerId: ClaudeCodeProviderId;
  baseUrl?: string;
  mainModel?: string;
  opusModel?: string;
  sonnetModel?: string;
  haikuModel?: string;
  subagentModel?: string;
  authHeader: ClaudeCodeAuthHeader;
  apiKey?: string;
  clearApiKey?: boolean;
  customHeadersJson?: string;
  disableNonessentialTraffic: boolean;
  apiKeyHelperTtlMs?: number | null;
}

export type ClaudeCodeApplyTarget =
  | { type: "user-settings" }
  | { type: "project-local-settings"; projectPath: string }
  | { type: "project-shared-settings"; projectPath: string; confirmShared: true }
  | { type: "launch-env"; workingDirectory?: string };

export interface ApplyClaudeCodeProfilePayload {
  target: ClaudeCodeApplyTarget;
}

export interface ClaudeCodeApplicationView {
  id: string;
  profileId: string;
  profileName: string;
  targetType: ClaudeCodeApplyTarget["type"];
  targetPath: string;
  appliedPatch: Record<string, unknown>;
  appliedAt: number;
  revertedAt: number | null;
  error: string | null;
}

export interface RevertClaudeCodeApplicationPayload {
  force?: boolean;
}

export interface ClaudeCodeBackupProfile {
  name: string;
  providerId: ClaudeCodeProviderId;
  baseUrl: string;
  mainModel: string;
  opusModel: string;
  sonnetModel: string;
  haikuModel: string;
  subagentModel: string;
  authHeader: ClaudeCodeAuthHeader;
  apiKey?: string;
  customHeadersJson: string;
  disableNonessentialTraffic: boolean;
  apiKeyHelperTtlMs: number | null;
}

export interface ClaudeCodeBackupPayload {
  app: "squirrel-switch";
  platform: "claude-code";
  v: 1;
  exportedAt: string;
  includesApiKeys: boolean;
  profiles: ClaudeCodeBackupProfile[];
}

export interface ImportClaudeCodeBackupResult {
  imported: number;
  profiles: ClaudeCodeProfileView[];
}

export interface ApiResult<T> {
  data: T;
}
