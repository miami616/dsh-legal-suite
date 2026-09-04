# Changelog

## 0.2.1（2026-09-04）

0.2.0 统一事项模型的收尾修复批次（备忘录 5 项 + 分叉根治 + 当事人模型重构）。

### 当事人「我方」模型重构（多次返工后定稿）

- **「我方」= 律所实际代理的具体当事人主体**（可多人），绝不由 ourSide（程序地位/
  原告系·被告系）推断；同侧多个主体（如劳动仲裁多个被申请人）只有显式标记的才是
  我方。数据字段：`parties.ourClientName` + `details[].ourClient: true`。
- **服务端 party-vocab.ts**：规范角色词表（含序数变体 canonical 识别）、写入时同名
  主体去重合并（role 并集进 roles[]，不重复列当事人）、ourSide 中文化归一。
- **详情页**：当事人信息右上角一个紧凑下拉选我方（选项=下方当事人，角色·名字）；
  行内 myClient 高亮「我方」；顶部原「我方诉讼地位」下拉移除。
- **新建案件**：废弃孤立「我方立场」下拉 →「我方当事人/对方当事人」两组动态行
  （角色下拉含序数变体 + 姓名，可增删）；我方组填的人自动 ourClient:true，ourSide
  由我方首行角色自动推导。
- **修复浏览器端丢标记**：useAgentLex normalizeParties 此前丢弃 ourClient/ourClientName
  → UI 永远拿不到我方指认（"一个我方都没有"）；已透传并补类型。
- **修复读取重复补行**：normalizeParties 的 legacy auto-populate 此前用精确字符串
  判定，把「申请人/第一被申请人」误判为缺原告/被告而补行 → 003 变 5 行；改为
  details 非空不补 + canonical 侧判定 + 顿号串（多人旧写法）不补。
- 卡片/详情「我方·对方」按阵营展示（我方多人逐行列出），角色编辑下拉固定规范词表。

### 备忘录其余项

- 审级自动追加节点回填案件已有信息（caseNo/court/judge/filedAt/我方当事人）。
- 推送设置模板预览改中性示例（去掉真实案号/当事人）；push 运行时实时解析投递渠道，
  不再因配置缺 channel 而把飞书走成普通文字。
- 内置 seed 演示减为诉讼/非诉各 2 个 + 磁盘播种标记（删光演示重启不复活）。
- 删除案件/项目级联清理 items/task-groups/legacy timeline/schedules（删除彻底）。
- 任务管理 hero「今日日程」→「今日事项」（事件 + 到期任务合并展示）。

### 统一事项模型收尾（split-brain 根治）

- 读路径 / 检查项 / 子任务 / 任务组 / 事件 toggle-delete 全部切 items.json，与写
  路径同源（list_events/deadlines/upsert_check/upsert_subtask/delete_event…）；
- items ownerType（litigation/nonlitigation/standalone）区分同号案件/项目，避免
  诉讼 2026-001 与非诉 2026-001 事项互串（suite 聚合按 ownerType 归属）。

---
## 0.2.0（2026-09-04）

### P0 · 统一事项模型重构（事件/任务统一为一个 Item）

彻底重构「关键日程 / 时间轴 / 任务」三个概念，统一为「事项 Item」模型：

- **一个事项一次登记，type 自动分流**：Item 有 `type: event/task/both`，登记一次
  自动分流到日程/时间轴（event/both）与任务树（task/both）。纯事件（立案）只进
  日程/时间轴，纯任务（起草起诉状）只进任务树，双重事项（开庭）两者都进。
- **新增统一事项域 `src/domains/item/`**：item store（items.json 扁平列表）+
  task-groups store + REST 路由 `/api/agentlex-item/*`。
- **数据源统一**：`/api/agentlex/read` 聚合、`/api/agentlex-task/unified` 聚合、
  期限推送 `collectAllDeadlines` 全部改为从 items.json 生成（替代从 case-timeline
  + case-registry taskGroups + standalone-tasks 三源读取）。
- **写路径统一**：useAgentLex 的 addTask/updateTask/deleteTask、addTimelineEvent/
  updateTimelineEvent/deleteTimelineEvent、addStandaloneTask/updateStandaloneTask、
  addTaskGroup/updateTaskGroup/deleteTaskGroup 全部重定向到 items.json；诉讼/非诉
  管家 upsert_event/apply_stage_template/task 路由改写 items。
- **登记入口统一**：TaskManager（类型选择 任务/事件/事件+任务）、CaseDetailPage
  新建事件、备忘任务 tab（MemoTaskTab，类型选择）→ 写统一事项。
- **推送去重**：both 事项在同一 deadline 只推一次（作为事件），不再重复。
- **修复（3081 实测）**：
  - upsert_event/apply_stage_template 写 items.json，时间轴/任务树数据源一致
  - upsert_task 透传 status（todo→pending/doing→doing/done→done）
  - 审级历程生成 instances（level 有值时生成 [{level,status}]），面板不恒为空
  - 审级历程「当前」标记 bug（reverse 后 i===arr.length-1 → i===0）
  - case_health ourSide 校验兼容 parties.ourSide
  - update_case 设 level 自动同步 instances（幂等），管家审级敏感
- 说明：本机现有数据已备份重建，本版为新模型设计，不含旧数据迁移。

## 0.1.26（2026-09-03）

### P0 · 三模块时间体系补全（统一 time 字段）

- **任务管理面板日历**：任务条目在日历里也能显示具体时间（此前只显示事件/关键日程
  的时间，任务漏传 time）。
- **诉讼/非诉模块任务条目**（CaseTaskTree）：任务行显示「截止日期 + 具体时间」；
  溢出菜单的截止日期旁新增「时间」输入框，可设置 time（HH:mm）。诉讼与非诉共用
  该组件，一处修改两模块同时生效。
- **诉讼管家 / 非诉管家工具**：`upsert_task` 增加 `time` 参数（HH:mm，与 deadline
  分开存），agent 能感知并写入任务的具体时间；host 侧透传到 task store。

## 0.1.25（2026-09-03）

### P0 · 修复期限推送独立任务不显示具体时间

- **修复**：期限推送（重要日程提醒）聚合独立任务时漏读 `task.time` 字段，导致
  独立任务即便设了具体时间也不显示（只有诉讼开庭等带 timeline time 的才显示）。
  现统一为 `timePart(deadline) ?? task.time ?? extractTimeFromDetail(detail)`，
  与诉讼/非诉任务一致。三个模块（诉讼/非诉/独立任务）的时间体系统一：deadline
  只存纯日期，具体时间存 `time` 字段（HH:mm），兜底从 detail 提取。

## 0.1.24（2026-09-03）

### P0 · 备忘录入口快速新增任务 + 任务时间字段 + 多项修复

- **备忘录面板新增「任务」tab（#6）**：备忘录面板顶部新增「备忘录 / 任务」两个
  并列大 tab，点「任务」可快速新增 **临时 / 诉讼 / 非诉**三类任务；诉讼可关联
  案件、非诉可关联项目（下拉带编号），支持设置子项、截止日、具体时间、优先级。
  任务写穿到对应案件/项目 taskGroups，与既有任务面板数据互通。
- **任务新增独立的「时间」字段**：`deadline` 只存纯日期（既有约定），新增
  `time` 字段（HH:mm）单独存具体时间。任务管理面板新建行、任务详情（移动端
  抽屉）、备忘录「任务」tab 三处统一提供**日期 + 时间**输入；任务列表与期限
  推送统一显示具体时间。
- **修复诉讼任务写穿新建报错**：统一写穿路由 `/api/agentlex-task/task` 此前对
  litigation/nonlitigation 强校验 `id`，导致新建任务报 `source write-through
  requires sourceId/groupId/id`。现 `id` 可缺省（缺省=新建，由来源 store 生成 id）。
- **修复诉讼案件状态标签（#5）**：`normalizeStatus` 此前未带审级（level），
  二审/执行案的状态被按一审套误归一（如「上诉立案」被改成「庭前准备」，且
  用户改完状态一刷新又变回去）。现按审级分套归一，并修正「立案/诉前」等
  自由文本到规范 id 的映射。
- **修复备忘按钮在 Chrome 上消失（#7）**：浮动按钮位置钳制回当前视口（旧坐标
  在窗口/分辨率变化后可能落在视口外）；按钮被外部从 DOM 移除时自动重建；
  默认给半透明底，浅色背景上也可见。
- **修复非诉/独立任务不显示具体时间点（#8）**：任务行现在显示实际截止日期
  与具体时间（优先 `time` 字段，无则从 detail 提取），不再只显示「X d」倒计时。
- **修复输入框 `#` 备忘引用不可用**：`findComposer` 选择器清单扩充到与
  chat-input-bridge 同款（覆盖 textarea[role=textbox] / chatInput / inputArea /
  autocomplete 等形态），适配当前 DSH harness DOM。

## 0.1.23（2026-09-03）

### P0 · 期限推送增强：三源聚合 + 飞书卡片 + 样式优化

- **三源聚合**：推送提醒覆盖**诉讼 + 非诉 + 独立任务**三个数据源（`collectAllDeadlines`），
  不再只基于诉讼。
- **时间解析统一**：独立任务/非诉 deadline 只存纯日期，具体时间在 detail 字段；
  新增 `extractTimeFromDetail` 解析中文时间（下午3点10分→15:10、下午2点半→14:30），
  与诉讼（timeline time 字段）统一按具体时间提前 24 小时提醒。
- **飞书卡片渲染**：飞书渠道改用 interactive 卡片（加粗标题/分区/分隔线/大字体），
  复用 feishu_push.py 的分区卡片逻辑（`feishu-card.ts`）；其他渠道保持纯文本。
- **样式优化**：去掉 emoji 图标（用户嫌丑），案号/法院/法庭逐行显示，独立任务不重复案件名。
- **修复**：`syncTimerJob` 不再依赖 dsh-im 服务可见性（嵌套插件作用域下会误禁用定时任务），
  只取决于用户开关；PATCH 同时校正 command/args 指向本实例 push-cli。

## 0.1.22（2026-09-03）

### P0 · 期限 IM 推送（关键日期快到期 → dsh-im 主动投递）

- **新增 push 域**（`src/domains/push/`）：关键日期快到期（**提前 1 天 + 当天**）时，向用户
  配置的 dsh-im 投递目标推送固定模板提醒。
- **定时复用 dsh-timer-agent**：自动注册一个 command 任务「期限IM推送」（`*/5 * * * *`），
  每次触发扫描所有案件期限；**按固定标题幂等**（timer-agent 不接受客户端 id，按标题查找更新，
  并清理历史重复任务），面板永远只占一行。
- **推送复用 @xmanrui/dsh-im 主动投递**：优先进程内 `ctx.get('dshIm')`，不可见时回退 HTTP
  `POST /api/dsh-im/delivery/messages`（实测 cordis 服务作用域隔离，HTTP 是可靠路径）。
- **固定推送模板**（决策 3）：`📌 重要日程提醒 · {N} 项待办`，每条含案件名/案号/法院/
  **时间（几点几分）**/**法庭（地点）**/日期，emoji + 结构化字段，任何渠道/时间格式一致，
  不含当事人隐私细节。
- **时间/法庭继承**：开庭的时间/法庭常记在已完成的 timeline 事件里，keyDate 只记日期；
  现在 keyDate 自动继承同案同日的 timeline 事件的时间/法庭，不再丢失。
- **去重台账**：`push-ledger.json` 记录已推 key（caseId|date|label），同一日期只推一次；
  推送失败不记录，下次 tick 重试。
- **设置 UI**：AgentLex 设置页新增「IM 推送」块（`agentlex.workbench.item` 槽位）——总开关 +
  Bot ID/Target ID（下拉枚举或手动粘贴）+ 标题前缀 + 模板预览 + 保存/测试/立即执行。
- **粘贴修复**：Bot ID/Target ID 输入框加 `onPaste` 强制文本粘贴，防御全局 paste 处理器
  把文本粘贴替换成图片路径。
- **依赖声明**（决策 4）：不声明 peer 依赖，README/设置页说明需安装 dsh-im 与 dsh-timer-agent，
  缺席时降级提示不崩溃。

## 0.1.21（2026-09-01）

### P0 · 会话轨迹导航（TurnNavigator）Codex 风格美化 + 数据源

- **轨迹导航美化**（`conversation-navigation.ts`）：把 DSH 原生 TurnNavigator 改造成
  dsh-codex-timeline 视觉风格——
  - 轨道透明、去掉竖线，只保留低对比短横标记；
  - 悬停标记扩展为 39px，邻近形成 30/21/15px 分级波动（`:has()` 相邻兄弟）；
  - 预览卡沿用原生外观（原生 10px 圆角/边框/阴影，不覆盖背景色）。
- **预览卡数据源**（新增 `conversation-turn-data.ts`）：卡片内容从「位置 + 标题 + 内容」
  增强为「位置 + 时间 + 状态 + 指标 + 两行摘要」，匹配参考插件——
  - 时间：从会话 DOM 回合 `timeStart` 标记按回合读取；
  - 状态：已完成/进行中；
  - 指标：`session.projections.faceOf('sessionStats')` 折算平均 TTFT + tok/s
    （与会话 footer 一致，如 "TTFT 3.4s · 292 tok/s"）。
- **hover 检测修复**：原生 mark 按钮 `pointer-events:none`，`pointerenter` 不触发，
  改为在 nav 上监听 `pointermove` + `elementFromPoint` 定位；tooltip 内容更新是
  characterData 变化，MutationObserver 加 `characterData:true` 才能捕获后续 hover 切换。
- **设置项**：新增「会话轨迹导航美化」开关（关闭恢复 DSH 原生轨迹导航）+ 位置选择
  （右侧/左侧，去掉「隐藏」选项）。

## 0.1.20（2026-09-01）

### P0 · 检查更新交互重构 + 排队消息横条修复

- **检查更新交互**（参考 dsh-bridge）：
  - 「插件版本与更新」块放回设置页底部（套件区）。
  - 新版本刚发布被 pnpm `minimumReleaseAge` 拦截时，新增**「强制一键安装最新版」**按钮
    （改用 npm 安装绕开发布冷却，刚发布即可更新）。
  - 更新完成后提供**「重启 DSH（使新版本生效）」**（宿主自重启：守护/PM2 退出拉起、
    常规模式派生子进程接管）与**「刷新页面」**两个按钮，不再只刷新浏览器。
  - 新增宿主重启能力 `restartDshProcess()` + 端点 `POST /api/agentlex-case/plugin-restart`。
- **排队消息横条（QueueDock）修复**：输入框上方带「编辑/删除/插话发送」按钮的排队横条，
  被「会话排版增强」的 `[class$="_body"] ul,ol{margin:20px 0;padding-left:1.5em}` 命中
  `<ul>` 列表，高度从 40px 撑到 80px（翻倍）；同时被两端对齐 `text-align:justify` +
  负字距拉宽文字。修复=QueueDock 排除里把 ul/ol 的 margin/padding 还原为 0、文字还原为
  左对齐 + 正常字距（均 `!important`）。验证：隔离测试 profile(3081) dockH 从 80px 恢复 40px。

## 0.1.19（2026-09-01）

### P0 · 备忘编号引用 + `#` 补全弹层重构 + 备忘录开关

- **备忘条目编号 + `#编号` 引用**：备忘 `ref` 改为稳定数字编号（1、2、3…，删除后空缺号复用，
  不因删除漂移），旧版正文 slug ref 自动迁移重编号。列表条目与 `#` 补全统一显示 `#N`，
  `#` 后输入编号即可选中/引用；新建备忘自动递增。
- **agent 自动解析 `#编号`**：新增 memo 系统提示（systemPrompt），明确指示模型在消息中出现
  `#数字` 时调用 `memo_read`（传 ref=该数字）取回备忘正文并据此应答，不再把 `#N` 当普通文本。
- **`#` 补全弹层重构**：改为与 DSH 原生 `/` 命令菜单同款——不透明实底（浅色 #fff / 深色 #1d1d20）、
  12px 圆角、原生投影；紧贴光标定位（视口内 clamp、下方空间不足自动翻到上方）。修复了弹层 div
  缺 `data-agentlex-memo-root` 属性导致样式从未生效、背景一直透明的根因。
- **点击外部关闭弹层**：弹层可见时点击其外部任意处即关闭（弹层内部点选 / composer 内部继续
  改 `#` 不误关），不再"弹了关不掉"。
- **备忘录开关**：AgentLex 设置页「功能模块」新增「备忘录」开关（默认开），关闭后 memo 浮动
  按钮、`#` 补全、面板全部停用，联动 AgentLex 总开关。
- **selectionchange 监听泄漏修复**：`subscribeComposer` 的 selectionchange 监听原为匿名函数
  无法移除，memo 关闭后仍泄漏触发 `#` 补全（表现为"关掉备忘开关 `#` 还乱"）。改为具名函数并
  in dispose 一并移除。

## 0.1.18（2026-09-01）

### P0 · 备忘交互与移动端适配 + settings 跨 API 兼容

- **纯拖动浮动按钮不再误打开备忘面板**：原实现用 `dragging` 标志，在 `pointerup`
  （早于 `click` 派发）就清掉，导致拖动结束的 `click` 仍触发 `togglePanel`。改为记录
  按下起点 + 位移阈值（`DRAG_THRESHOLD=6px`），仅位移超过阈值才算拖动，`click` 时
  位移未超阈才打开面板。Puppeteer 真实 Chrome 实测：拖动(移动 80,40px)后面板数=0
  （未误开），点击后=1（正常打开）。
- **移动端备忘输入框与条目文字过浅**：新增 `@media(max-width:640px)` 强制高对比
  （浅色下主文字 `#1a1a1c`、深色下 `#f2f2f4`），面板几乎全宽不溢出、放大输入框字号。
  390px iPhone 视口实测：输入框/条目/面板均为 `#1a1a1c`，panelWidth 366 < 390 无横向
  溢出。
- **AgentLex 设置页移动端适配**：根容器改 `width:100%` 防窄屏溢出。
- **settings 跨 API 兼容（防御性加固）**：新增 `src/shared/settings-adapter.ts` 的
  `installSettingsSection()`，按宿主实际 API 选 `register → installSection → 兜底 entry`，
  绝不抛出；5 域（诉讼/非诉/任务/备忘/皮肤）统一改用，杜绝 settings 注册失败中断路由
  注册（曾导致备忘/案件/非诉/任务路由 404）。兼容全局 alpha.2（`installSection` 存在，
  内部转发 `register`），不影响其现有行为。

## 0.1.17（2026-08-31）

### P1 · 新增「备忘录」域（随手记 / 标签 / 归档 / 会话 `#` 引用）

- **新业务域 `memo`**：集合进 `dsh-legal-suite`，提供桌面浮动按钮（可拖拽调位、默认
  透明 hover 显色）→ 居中弹窗创建/编辑备忘；每条可自定义标签并按标签筛选、可归档/
  恢复/删除/彻底删除；可一键「引用到输入框」插入 `#ref`。
- **会话 `#` 自动补全**：在会话输入框输入 `#` 弹出已有备忘供选择（鼠标或 ↑/↓ +
  Enter 均可），底部「＋ 新建备忘」；选中的 `#ref` 经 Lexical `beforeinput` 注入，
  可靠地被 composer 收敛（避免外部改 DOM 被 Lexical 回写覆盖）。
- **Agent 工具** `memo_read` / `memo_search`：让模型把会话里的 `#ref` 解析回备忘正文，
  或按关键字/标签搜索备忘。
- **存储**：host 用 `JsonFileStore` 持久化到 `~/.dsh/agentlex/memos/memos.json`，
  REST `/api/agentlex-memo/*`（CRUD + 归档 + 健康），client 经轻量轮询联动刷新（弃用
  EventSource SSE，规避其在 headless 等环境阻塞同源 fetch 写请求）。
- **UI 反馈**：保存/归档/删除/恢复/引用均有自动消失的 toast；保存支持 Cmd/Ctrl+Enter
  或「保存」按钮；点击空白遮罩关闭并自动保存未提交草稿；弹窗背景实色不透明、随主题
  深浅，680×720 扁平单列设计。

## 0.1.16（2026-08-31）

### P0 · 兼容修复：与 bridge / IM 等第三方插件共存

- **移动端导航边栏被 bridge 遮罩盖住、无法点击（与 @wenbin_wb/dsh-bridge 同开时）**：
  我们插件注入的两份全局 CSS（`original-styles.ts` / `generated-workspace-css.ts`）含
  `#root{z-index:1}`，在 `#root` 建 stacking context，把 bridge 移动端侧边栏(10000) 困在
  z:1 层内、被其 backdrop(9999) 盖住。修复：两处 `#root` 规则去掉 `z-index:1`。
- **远程登录设置页空白 / 加载中（bridge 远程）**：`AgentLexSettingsSection` 的 config 原依赖
  client-runtime settingsScope 服务（远程不可用）。修复：渲染改用本地 `useSkinConfig()`
  （恒有值），删除 `if(!scope||!config)` 阻塞；写入改走 `commitSetting`（scope 可用时
  `scope.set` + 恒 `setSkinConfig` 更新本地并驱动模块启停），远程下设置项点击也有即时反馈。
- **污染其它插件设置页/组件（如 @xmanrui/dsh-im 渠道选择条 dim-rail 横向化）**：
  `sidebar.css.ts` 的页面级规则 `[role="tablist"]`/`[role="tab"]`、`[class*="bubble"]`、
  `pre[class*="code"]`/`[class*="codeBlock"]`、`[class*="headlineText"/previewBadge]`、
  `[class*="headline"]` 用通用 ARIA 角色/类名子串全局匹配，篡改所有插件同名组件（IM 的
  dim-rail 被从 grid 覆盖成 flex→横向）。修复：全部收窄限定到会话区
  `[data-slot="conversation"]`，仅美化 harness 会话/hero/轨迹，不再影响设置页及其它插件。

## 未发布（0.1.15 预览）

### P0 · 修复 0.1.14 回归：会话排版（两端对齐 / 排版增强）失效

- **回归根因**：0.1.14 在修复 composer 输入框被撑宽时，把 `CONVERSATION_TYPOGRAPHY_CSS`
  与 `CONVERSATION_ENHANCE_CSS` 的所有正文规则选择器从 `[class$="_body"]` 收紧为
  `[class$="_body"] [class$="_markdown"]`。但 harness 的消息正文**并不存在
  `_markdown` 类名**（该锚点是错的），导致所有规则不再命中 → 两端对齐 / 排版增强
  全部失效。
- **修复**：还原为 `[class$="_body"]`（消息正文规则恢复命中），改为**显式排除
  composer**：composer 编辑区是会话内唯一的 `[data-lexical-editor]`（Lexical 富文本，
  消息正文不含它），新增同特异性、置于消息规则之后的 `[data-lexical-editor]`
  覆盖规则，把 `p/li/blockquote/dd` 的 `text-align`/`letter-spacing`/`margin`/
  `overflow-wrap` 乃至 `font-size`/`line-height` 全部还原，避免排版规则套到输入框
  内部 `<p>` 上（不再拉宽输入框 / placeholder 上浮）。
- **验证**：Playwright 注入真实构建 CSS 后，composer `<p>` 计算样式 margin=0、
  text-align=start、letter-spacing=normal，输入框不受影响；消息正文仍由 `[class$="_body"]`
  获得两端对齐与排版增强。

## 未发布（0.1.14 预览）

### P1 · 适配 alpha2 harness + 修复 composer 输入框撑宽 + 修复 skin 配置路由 404

- **alpha2 settings API 迁移**：host 半 5 处 `installSettingsSection` 静态调用改为
  `ctx.settings.installSection(owner, ns, schema, entry, hooks)`，`'settings'` 加入各域
  inject 与聚合根并集，`settingsNamespace('x')` 改 `as const` 字面量。编译基线保持
  rc.2 devDeps + 本地 `src/host-settings-alpha.d.ts` shim（alpha2 依赖图 pre-release
  无法干净整树升级），运行时由 alpha2 harness 提供 `installSection`；profile 不再需要
  固定 rc.2 host-half deps。
- **修复 composer 输入框被撑宽 / placeholder 上浮**：`conversation-typography` 的
  ENHANCE/TYPOGRAPHY CSS 原用 `[class$="_body"]` 选择器，会误匹配会话根 `.wSkVaW_body`
  与 hero `.pXSMma_body`（包裹 composer），把消息正文规则套到输入框内部 `<p>` 与
  占位符 `:after` 上。收紧为 `[class$="_body"] [class$="_markdown"] <elem>`，仅作用于
  真实 AI 消息正文；用户气泡 `_bubble` 规则保留。
- **修复 `/api/agentlex-skin/config` 404**：`suite.ts` 与 `skin/index.ts` 都 `installSection`
  同一命名空间 `'agentlex-legal-suite'`，alpha2 对重复注册 fail loud，skin 的 apply 中断
  导致路由未注册。suite 改为路由时用 `ctx.settings.get` 非注册读现取，skin 独占注册并
  try/catch 防御；同时删除 suite apply 末尾悬垂的 `sync()` 调用。
- **hero 欢迎块布局加固**：`alignSelf`/`width`/`overflow` 约束，避免参与父 flex 拉伸。
- `*.tgz` 加入 `.gitignore`。

## 未发布（0.1.13 预览）

### P1 · 诉讼状态阶梯按审级/程序分立

- **状态阶梯按审级分套**（用户需求：一审/二审/执行各有独立状态标签体系）：
  - `playbook/litigation.ts` 的 `STATUS_LADDERS` 定义三套：一审 8 档（不变）；**二审 6 档**（收案→上诉立案→审查中→待开庭→二审判决→已结案）；**执行 5 档**（收案→财产查控→处置中→分配发还→已结案）；再审/仲裁回退一审套
  - 校验与取值函数 `isLitigationStatus` / `getLitigationStatus` / `getStatusLadder` 增加 **level 感知**
- **适配层同步**：`case-status.ts` 导出多套阶梯 + `getStatusDef(statusId, level?)`；`tools` 状态参数说明按审级列出各套合法值；`health` / `stage-expansion` 按 `record.level` 取值
- **旧面板显示层（vendor）**：`caseStatus.ts` 同样三套阶梯；`StatusBadge` 徽章与可编辑下拉按案件 `level` 取阶梯（卡片列表/详情页均传入 level）；`normalizeStatus` 审级感知
- **数据与回归**：seed 执行参考案状态 `execution`→`investigation`（语义归位到执行阶梯）；verify-seed-sync / verify-case-health 改为按审级校验，四个回归脚本全过

## 未发布（0.1.12 预览）

### P1 · 面板体系收敛 + 老版 harness 兼容补丁

- **面板体系收敛为单一旧渲染层**：删除 src 新面板体系全部 23 个文件（`LitigationPanel`/`NonLitigationPanel`/`CaseBoard`/`CaseCard`/`ProjectBoard`/`ProjectCard`/`NewCaseModal`/`NewProjectModal`/`ImportModal`/`detail/CaseDetailPage`/`ProjectDetail`/`TaskTree`/`Timeline` 及对应 css、`use-mobile`）——中心面板与「案件详情页」tab 统一走 vendor 旧渲染层（`Original*Panel`+mount+case-detail-view），共享层（api/store/controller/launch-manager/session-bridge/locales 等）与 task/skills 域不受影响
- **老版 harness（rc.2/rc.8）兼容**：
  - `inject` 移除 `remote` 系列（`remote`/`remote.session`/`remote.workspace` 仅 v0.1.2-alpha.1 及以后存在，老版等待不存在的服务会挂起）——gateway remote 改由 session-bridge 运行时 root-first 解析
  - `slots.inject` 加老版存在性守卫：品牌/设置/skills 槽注册在无 inject 方法的旧 harness 上回退直接注册
  - 会话创建升级为三级降级：`remote.session.create`（新）→ `ctx.sessions.create`（新）→ `connection.api.sessions.create`（rc 世代老路径，已加回）
- **preset 同步全局串行化**：`syncShippedPreset` 内置模块级写队列，消除 suite 与各域并发同步同一预设目录的 `ENOTEMPTY: rmdir` 竞态（issue:「非诉管家 agent 预设提示错误」）

## 未发布（0.1.11 预览）

### P1 · 适配 harness v0.1.2-alpha.1 全量（品牌 / 管家会话 / 旧面板兼容）

0.1.2-alpha.1 对客户端契约做了大重构（RPC 模型、插槽声明、gateway remote、设置 scope、会话端点），以下逐项适配并在 0.1.2-alpha.1 全量回归：

- **品牌/欢迎词恢复（root cause：官方品牌占槽 + 槽声明机制）**：0.1.2-alpha.1 起官方 `dsh-client-ui-brand-official` 通过 `slots.inject` 占用 `sidebar.brand.mark/name` 与 `conversation.hero.brand.mark` 三个 single 槽（第三方直接注册会抛 `already has a registration`），且新 slots 机制要求「父条目 children 表已声明该槽」（直接注册抛 `not declared`）。修复：插件自带 bundle patch（`cordis.patch.yml`）禁用官方品牌插件（loader 条目 id 为短 id `ui-brand-official`；目标不存在时 applyEntryPatches 仅告警跳过，旧版 harness 安全）；品牌/设置/技能槽注册全部改走官方同款 `ctx.slots.inject`（延迟到槽渲染时注册，声明必就绪）
- **管家按钮恢复（root cause：客户端 RPC 模型重构）**：`connection.api.sessions/workspace`（旧 IApiClient）已移除，会话/工作区改走 typert gateway `remote` 命名空间（`RemoteResult { ok, value }`）；gateway `remote` 是严格代理，需 root ctx 解析（子 fiber 注入在打包合并后不生效，访问即抛 `cannot get property "..." without inject`）。修复：`session-bridge` 的 remote/sessions/workspaces 全部 **root-first 解析**（先 `ctx.root` 后回退当前 ctx），会话创建优先 `remote.session.create`（带管家 preset）、失败自动降级 `ctx.sessions.create`（保证按钮必可用），重命名/播种经 session face 降级
- **旧渲染层（vendor 面板）`/sessions 404` 治理**：旧面板 `getSessions()` 请求的 `GET /sessions` 端点在 0.1.2-alpha.1 已移除（影响「过期绑定会话清理」）。修复：插件挂 `window.__agentlexListSessions` 会话快照桥（从 `sessions.list` 快照读取，root-first），vendor `getSessions` 非 Tauri 时优先走桥，桥缺失回退原端点
- **inject 补齐**：诉讼/非诉域 inject 增加 `connection`、`remote`、`remote.session`、`remote.workspace`（官方 remote 使用方同样声明这些子命名空间）
- **面板维持旧版渲染层**：中心面板与「案件详情页」tab 保持 vendor 旧 UI（用户指定）；0.1.10 的新面板进度组件保留但不再默认挂载

### P0 · 适配 harness v0.1.2-alpha.1（升级回归修复，首发于 0.1.10）

- **修复前端 half 挂载崩溃**：harness 在 rc.8 → v0.1.2-alpha.1 之间移除了渲染端 `ctx.sessions.currentProvideInfo`（无兼容壳、未进 changelog），导致插件启动时 `WorkspacePanel` 挂载即 `Cannot read properties of undefined (reading 'subscribe')`、整插件加载失败。改为从当前契约读取：`ctx.sessions.list.current`（当前 staged 会话 id）+ `ctx.sessions.list.byId[id].cwd`（工作目录），订阅也只保留 `list.subscribe`。该读法在 rc.8 与 v0.1.2-alpha.1 两种契约下都不抛错（缺失时优雅降级为「无会话」视图，不再崩溃）
- **收敛会话作用域读取**：抽出 `src/domains/workspace-sidebar/client/session-scope.ts` 的 `readSessionScope()`，`mount.tsx` 与 `conversation-links.ts` 共用，统一对 `ctx.sessions` 做结构性 cast（`as unknown as { list?: {...} }`）+ 可选链守卫，杜绝未来 harness API 再变动导致的同类崩溃。`case-detail-view.tsx` 早已迁移到 `list.current`，本次补齐剩余两处

### P2 · 0.1.10 功能（已于 0.1.10 发行版包含）

- **新增共享实务 playbook**：`src/shared/playbook/litigation.ts` 与 `nonlitigation.ts` 成为术语与阶段任务的唯一事实源——管家 persona、工具参数说明、内置参考案例、界面状态徽章四处强制同源，从机制上消除「同一件事两种说法」
- **统一状态阶梯**：诉讼 5 档 → 8 档（收案/诉前/立案中/庭前准备/待开庭/庭后管理/执行中/已结案），新增 `tone-warning` 徽章；非诉统一为 5 档（已签约/进行中/已暂停/已完成/已归档）。修复两处静默漂移：诉讼 `status` 传枚举外的值（如「审理中」）会回落成「收案」；非诉工具文档写 `active/inactive/closed` 而界面渲染另外 5 个值
- **管家人格重写**：两个管家补齐各自领域的实务知识——诉讼侧含 8 档程序阶梯、6 个阶段的标准任务与阶段独有安排（诉前的时效与管辖核查、一审的举证期限、二审的不变期间、执行的财产线索与续查封）、11 条法定期限、四类锚点的排期提前量；非诉侧含常法/专项/咨询三类阶段模板、服务台账规范、响应时效与提醒提前量
- **表述一致性硬性规范**：任务名统一「写动作不写状态」（用「出庭参加庭审」而非「等待开庭」），附动词白名单、禁用词表、口语归一映射、关键日期规范标签与阶段命名格式；管家接到口语化输入先归一再落库
- **渐进式建案原则**：两个管家均明确禁止新案件一次铺满全流程——只建当前阶段，下一阶段至多 1–2 条占位预告；信息未产生即留空，不得编造
- **参考用例 1+1 → 3+3**：诉讼三组覆盖三种状态（诉前 / 待开庭 / 执行），非诉三组覆盖三种状态（已签约专项 / 进行中常法 / 已完成专项）。各组阶段任务完全不同，执行案演示财产线索、查控、执行谈话等阶段独有安排；常法案演示续约提醒主线；专项案演示「已完成 ≠ 已归档」
- **术语一致性机器校验**：`scripts/verify-seed-sync.mjs` 断言从 19 项扩到 32 项，新增「案件/项目状态必须取自规范阶梯」「任务名必须通过规范性检查」「关键日期标签必须取自规范词表」等断言——内置案例本身必须是用词规范的示范
- **工具参数同源**：`litigation`/`nonlitigation` 的 `status` 参数描述改为从 playbook 动态生成，工具 DESCRIPTION 注入写入纪律，杜绝文档与实现再次漂移

### P1 · 阶段模板能力与阶段推进自动化

- **`apply_stage_template`（诉讼/非诉各一套）**：把 playbook 的阶段模板实例化到具体案件或项目——`dryRun=true` 只出计划不落库（先预览再展开）、`only`/`skip` 按案情裁剪、`anchorDate` 按模板提前量自动推算 deadline、子任务与检查项一并创建。实现落在 `src/domains/litigation/stage-expansion.ts` 与 `src/domains/nonlitigation/stage-expansion.ts`
- **模板是骨架不是枷锁**：任务带 `templateTitle` 溯源字段，管家把「出庭参加庭审」改成「出庭参加第二次庭审」后，重复展开不会插入原名副本；模板只约束「标准动作怎么说」，不限制「模板之外还能加什么任务」——按案情增删改用一直被允许
- **`stage_suggestions` 只读检测**：当前阶段任务全部完成 → 建议展开下一阶段并给出目标状态；当前阶段无任务 → 建议展开当前阶段；立案后缺法院/案号/立案日期、待开庭缺「开庭」关键日期 → 提示补登记；常法另含服务期届满前 60 天续约提醒与台账超 30 天未登记提醒；结项任务完成 → 建议改为已归档
- **同回合钩子**：`update_case`/`update_project` 只要改了 `status`，响应里就内联返回 `stageSuggestions`，管家在同一轮对话里即可接着问用户是否展开，无需等待下一次体检
- **会话开场自检**：两个管家 persona 写入固定触发时机——会话开场、用户问「有什么要做的」时先跑一次 `stage_suggestions`。DSH 的 agent 是会话驱动、无常驻后台，因此「每次会话开场先体检」是平台上最接近自动巡检的机制；检测只提建议，落库仍由用户确认
- **修复任务 `detail` 被静默丢弃**：`upsertTask` 新建分支此前未透传 `detail`（诉讼侧），非诉侧连更新时也丢弃——建案/建项目时写的任务说明全部丢失，内置参考案例的任务详情因此为空。两处一并修复并补上 `templateTitle` 透传
- 新增回归脚本 `scripts/verify-stage-expansion.mjs`（32 项断言：dryRun 不落库、锚点推算 T-N、幂等、改名后不重建、only/skip 裁剪、五类建议触发时机、常法续约与台账断更）
- 产品方案文档 `docs/案件信息渐进式更新方案.md` 新增「在 DSH 上怎么做自动化」：四层触发（同回合钩子 / 确定性检测+会话开场自检 / 浏览器提示点 / 定时巡检）与「为何不做后台静默改数据」的取舍说明

### P2 · 信息完整度与缺口清单

- **`case_health` / `project_health`（诉讼/非诉各一套）**：只读体检，一次返回四项——信息完整度、缺口清单（含「为什么这个阶段需要它」）、阶段进度、阶段推进建议；非诉另含台账时效与服务期剩余天数。实现落在 `src/domains/litigation/health.ts` 与 `nonlitigation/health.ts`
- **完整度按阶段动态计算**：字段规则带起始状态次序，诉前案件不会因为还没案号被扣分，立案之后才计入。低分一定意味着「当下该有的信息缺了」，不会用尚未产生的信息制造噪音
- **关键日期规则是区间而非「从此往后」**：「开庭关键日期」只在待开庭要求，「裁判文书送达」只在庭后管理要求——案件进入执行后再要求待办的开庭日期纯属噪音（裁决执行等情形从未经开庭），此为第一版实现踩到并修掉的问题
- **非诉按类型分叉**：常法必查服务范围、服务期与「服务期届满」关键日期；专项必查交付物里程碑；两者都查负责人与合同金额；另含台账超 30 天未登记的 stale 标记与服务期剩余天数
- **会话开场自检统一到一次调用**：两个管家 persona 改为开场跑 `case_health` / `project_health`（不带 id 则扫描全部、按完整度升序），并给出对用户的展示格式；只有单独看阶段建议时才用 `stage_suggestions`
- 新增回归脚本 `scripts/verify-case-health.mjs`（28 项断言：阶段差异化的完整度、缺口随补齐消失、阶段进度、扫描排序与跳过已结案、内置参考案例不被「未立案」拖累、常法/专项缺口与台账时效）

## 0.1.9（2026-08-29）

诉讼管家 upsert 语义修复 + 内置参考用例 + 任务模块双向同步。

- **upsert 契约统一**：`upsert_group` / `upsert_task` / `upsert_subtask` / `upsert_check` 统一为「id 存在则更新，不存在（或省略 id）则新建——显式 id 按该 id 创建」。此前 `upsert_subtask` / `upsert_check` 传入不存在的 id 会**静默 no-op**（返回 `ok:true` 但数据未落盘），`upsert_task` 会抛 `TypeError`，`upsert_group` 会抛「task group not found」，均违背 upsert 语义
- **新建字段透传**：`upsert_subtask` / `upsert_check` 新建时补全 `detail` / `deadline` / `done` 字段透传（此前被丢弃）
- **工具参数说明修正**：`subtaskId` / `checklistId` 改为「可选——省略则自动生成 id（`sub-`/`chk-` 前缀）；delete/toggle 类仍必填已有 id」，消除「按文档用必错」陷阱
- **内置参考用例**：全新安装（空数据目录）时自动播种一份信息完整的诉讼参考案件（买卖合同纠纷：当事人/标的/法院/任务树/子任务/检查项/关键日期/时间轴/日程）与一份非诉参考项目（常法服务：任务树/关键日期/服务记录），新用户开箱即见完整演示；仅空 registry 播种一次，绝不覆盖已有数据
- **非诉项目编号规范化**：`register_project` 自动生成的 projectId 由随机串（`proj-…`）改为与诉讼一致的按年数字编号（`YYYY-NNN`，如 `2026-001`），导入/显式 id 仍保留原值
- **任务模块双向同步**：任务中心统一视图中的诉讼/非诉任务现在可**直接切换状态**，写回源案件/项目 store（`litigation`/`nonlitigation` 任务不再只读）；诉讼/非诉里处理的任务在任务中心实时同步，任务中心切换状态也同步回源
- **回归测试**：新增 `scripts/verify-upsert-fix.mjs`（14 项断言）与 `scripts/verify-seed-sync.mjs`（19 项断言，覆盖播种幂等与双向写回）

## 0.1.8（2026-08-29）

会话排版优化 + 移除「想法/备忘」模块。

- **会话排版**：行内代码按自然边界断行（`white-space: normal` + 断词），不再拉散整段文字；加大会话段间距
- **移除「想法/备忘」模块**：删除 `src/domains/ideas/` 全部代码（host + client + store + routes + tools）与相关注册/开关（`module-toggles`、skin 配置、设置页开关），侧边栏不再出现「想法」入口
- **内部文档移出公开仓库**：`docs/` 与 `issue-*.md` 不再跟踪，保留本地

## 0.1.7（2026-08-28）

UI 样式与主题优化 + 非诉工具能力补齐。

- **非诉管家工具层补齐**：工具 ACTIONS 5→23——任务树（11）＋关键日期（3）＋服务能力（3）＋导入（1），`update_project` 转发 `serviceScope/servicePeriod/summary`；store 新增 `upsertKeyDate/toggleKeyDate/deleteKeyDate`，路由新增 `/keydate /toggle-keydate /delete-keydate`，与诉讼管家对齐
- **卡片内容区改纯白**：诉讼/非诉卡片内容区与详情页模块背景统一白色（内联 `var(--biz-card-bg)`），新增深浅色自适应变量——浅色 `#ffffff`、深色模式自动变 `#242018`
- **详情页样式优化**：模块边框加深（`ink-subtle`）、模块标题加大加粗（`text-sm font-bold`）、标签文字加深一档；左右栏模块背景统一白色
- **状态/审级标签鲜亮化**：状态徽章用主题语义色（收案蓝/庭前绿/待开庭橙/庭后黄/已结绿）；审级标签用各自身份色（一审蓝/二审紫/再审粉/劳仲绿/商仲青…）
- **三模块页面布局**：区块间距与卡片间隙拉大（`space-y-6` / `gap-6`）；全屏下响应式宽度（`xl:max-w-6xl 2xl:max-w-7xl`）；诉讼标题区对齐下方模组
- **删除「靛青政务」主题**：从 `AGENTLEX_THEMES` 移除 INK，历史保存该主题自动回退暖陶
- **会话排版**：会话页标题字号 25→30px；行内代码支持跨行（`white-space: normal` + 断词），不再拉散整段文字
- **字体**：三模块页 `--lit-font` 字体栈 `'Microsoft YaHei'` 提到首位

## 0.1.6（2026-08-27）

预设挂载修复 + Windows 兼容 + 非诉写链路修复。

- **修复「诉讼管家/非诉管家」预设无法挂载**：`Cannot find package 'dsh-legal-suite'`。根因是 agent 预设加载器解析 `name:` 的基准是 App 安装树而非 profile 的 node_modules，裸包名在 Windows/桌面安装下解析不到。修复：预设同步（`src/shared/preset-sync.ts`）在把预设复制到 `$DSH_HOME/.agent-presets/` 时，把插件行 `name` 改写为本包自身的绝对入口 URL（`file://…/lib/index.js`），随包自动生效、每次同步自动修正
- **非诉管家写链路修复**：`register_project` / `update_project` / `delete_project` 全部空转（返回空 registry）——工具层 `execute()` 写入 `body.path` 而 `api()` 读取 `body.route`，所有写操作实际都打到 list 接口。键名统一为 `route` 后真实落库
- **Windows 文档读取修复**：预设补挂 `tool-pwsh`（Windows 下 PowerShell 提供 shell 提取能力，与 DSH standard 预设一致），persona 文档读取改为能力探测 + 降级（无 shell 时走 read_image/转存纯文本）
- **数据目录文案对齐**：`tool-fs` 注释与 persona 不再承诺「桌面在白名单」，如实描述沙箱白名单以宿主策略为准
- **边栏**：AGENTLEX 组三个子项行间距 2px → 5px，视觉更分明

## 0.1.5（2026-08-27）

- **工作区右边栏**：新用户首次进入时默认关闭（不再默认展开），避免新会话页面被面板占据；用户手动打开过或会话内点击文件/链接触发「在侧边栏打开」时仍正常打开

## 0.1.4（2026-08-27）

UI 精简与修复。

- **设置**：移除「桌面」设置项（Profile 切换 / 桌面通知），对应实现一并删除
- **会话页标题**：字号 16px → 25px 并加粗，更醒目
- **首页欢迎称呼**：修复设置「欢迎语称呼」后刷新回退为默认 user 的问题——品牌/欢迎称呼持久化到 localStorage，刷新时先本地恢复再同步服务器，避免 settings 水合竞态覆盖

## 0.1.3（2026-08-27）

UI 与交互修复 + client 源码纳入版本管理。

- **边栏**：AGENTLEX 组三个子项（诉讼/非诉/任务）缩进 15px、行间距 2px、行高/颜色与大类一致，仅字号小一档
- **会话排版**：含代码块/表格的段落回退左对齐，避免两端对齐把文字拉散
- **右边栏「切换目录」**：本地运行时优先弹系统原生目录选择框（macOS Finder），远程/不可用时自动退回应用内浏览框
- **输入框技能选项**：技能按分组折叠显示（默认折叠），找起来更方便
- **非诉管家**：修复点击后创建会话但不跳转新会话的问题（inject 补 `sessions`、等会话进列表再 open、启动后关闭面板）
- **目录选择**：workspaces 服务不可用时退回应用内浏览框，保证任何环境可用
- **工程**：修复 `.gitignore` 的 `client/` 误伤源码目录，client 源码（118 个文件）纳入 git 跟踪

## 0.1.2（2026-08-27）

Agent 预设升级：让「诉讼管家」「非诉管家」能读取 Word/PDF/Excel 等法律文书。

- 根因修复：`dsh-tool-fs` 的 `read` 只解码 UTF-8 文本，无法解析 .docx（ZIP 封装的 OOXML 二进制）
- 为两个 agent 预设挂载 `dsh-tool-bash`（shell），可执行 pandoc / unzip / python 等文本提取命令
- 为两个 agent 预设挂载 `dsh-skill-filesystem` + `dsh-tool-skill`，暴露 word-docx / pdf-image-text-extractor / excel-xlsx 等文档技能
- 更新 persona 系统提示，教 agent 按「加载技能 → bash 提取 → 登记案件 → 落盘文书」流程读取文档
- 更新 preset.yml 描述，标注文档读取能力

## 0.1.1（2026-08-27）

定位与介绍更新：明确本项目为 **AI 驱动的法律行业案件管理与 Agent 工具**。

- 项目介绍重写：突出 Agent 驱动办案（自然语言办案 / 期限智能盯防 / 文书自动落盘 / 技能与 MCP 扩展）
- 补充「诉讼管家」「非诉管家」Agent 预设说明
- `package.json` description 与 keywords 更新（新增 legal-tech / case-management / legal-agent / ai-agent / litigation 等标签）

## 0.1.0（2026-08-26）

开源起点版本，首个独立单包发布（原内部开发历史不再追溯）。

- 单包合一：诉讼 / 非诉 / 任务 / 皮肤 / 工作区右边栏 / 技能工具 六域随一个 entry 装配
- 自更新改为公共 npm registry 通道（移除私有源 token / 代理配置）
- 数据完全本地（`$DSH_HOME/agentlex/`）
- 随包发布 agent 预设（诉讼管家 / 非诉管家）