# Changelog

## 未发布（0.2.x 待定版号）

## 0.2.11 — 法定期限规则表接线 + 期限链路两个接口 bug

> 来源：2026-002 案（劳动仲裁裁决送达后进入 15 日起诉期）登记遗漏复盘
> （`docs/ISSUE-法定期限登记遗漏与期限保障建议.md`）+ 规格与实施记录 `docs/期限规则表设计.md`。
> 核心口径：**把「记得登」换成「系统算」**——管家只登记触发事由（收到什么文书、
> 哪天送达），届满日由规则表派生；**逾期只属于任务，日程过期即历史**（不改
> CaseDetailPage / index.ts 的日期分流）。

### 一、法定期限规则表（新）

- **新增 `src/shared/playbook/period-rules.ts`**：`PeriodRule` 结构化规则表（程序轨 +
  案件类型 + 我方身份 + 文书种类 → 触发文书/事实 → 期间 + 起算 + 顺延 + 规范术语 +
  法律依据 + 生效区间 + 提前量锚点）。收表原则：只收**法条直接规定期间长度**的期间；
  法院在文书中指定的期间（举证期限）不入表，仍以通知书载明日期为准。
- **删除旧 `LEGAL_PERIODS`**（名称→天数平铺、全库零消费者、无法参与计算），
  **不保留双表**（双表必然再次分叉）。
- 首批 11 条规则，法条与条号已核对现行有效版本：劳动争议调解仲裁法 §48/§49/§50、
  劳动人事争议仲裁办案规则 §31、民事诉讼法 §85（起算与顺延）/§128（答辩期）/
  §171（上诉期）/§250（申请执行期间）、刑事诉讼法 §230。其中「申请执行期间」条号
  由旧写的 §246 更正为 **§250（2023 修正）**。
- **确定性派生**：起算日（次日起算，期间开始的日不计算在内）+ 期间（日/月/年）+
  末日顺延（民诉法 §85），产出 `computeTrace` 人读计算过程（回答「为什么是这天」）。
  节假日表暂为空（只按周末顺延），接入时只需往 `HOLIDAYS` 加日期即可，trace 会记明。
- **多候选不猜**：终局裁决未定性时同时给出「15 日起诉」与「30 日申请撤裁」两条并列
  候选（`ambiguous`），交模型结合案情判断或问律师——定性是判断，不是查表。
- **锚点链补齐**：`LEAD_TIME_RULES` 新增「起诉期届满」（T-10 研读 → T-7 当事人确认 →
  T-5 定稿 → T-3 递交）与「答辩期届满」；动作截止日落在周末时**往前挪**到最近工作日
  （不能把动作留到办不了的一天）。

### 二、登记三件套（新 `src/domains/litigation/period-service.ts`）

- `planPeriodRegistration()` 只读预览；`applyPeriodRegistration()` 一次落三件套：
  **关键日程**（规范术语 + 届满日 + `ruleId`/`baseDate`/`cite`/`computeTrace` 审计字段）
  + **时间轴日程**（触发事实，如「裁判文书送达」status=done，作纪年锚点）
  + **提前量任务链**（任务才有逾期与推送，提示因此逐级精确）。
- 幂等：关键日程按 `ruleId + baseDate` 更新不新增（旧版按 label 去重，措辞一漂移就出两行）；
  事件按标题、任务按「组名+标题」去重。歧义或规则未命中一律**不落库**并说明原因。
- `KeyDate` 增审计字段；`addKeyDate(caseId, label, date, meta?)` 支持派生元数据。
- 新工具 action：`period_rules`（看表）/ `derive_deadline`（只读预览）/
  `register_service`（落三件套）；工具描述内联规则表摘要，模型据此知道表里有什么、
  **不得自行推算日期**。对应 HTTP 路由 `/period-rules`、`/derive-deadline`、`/register-service`。

### 三、修两个接口 bug（登记链路可靠性）

- **`upsert_event` 的 `eventId` 不生效**：agent 工具层 `buildBody` 发 `id`，路由只读
  `b.eventId` → id 落空 → upsert 退化成新建，同一事项出现两条日程，幂等性被破坏。
  改为两个拼写都认（`b.eventId ?? b.id`）。
- **`eventType`/`kind` 不落库**：`/event` 路由压根没把 kind 传给 `upsertItem`，事件类型
  永远为 null，期限汇总只能按 `it.type` 归类 → 上诉期/举证期被标成「开庭」。修法：
  路由落 `kind`；期限引擎（`index.ts`）与推送聚合（`push.ts`）改读 `it.kind` 兜底
  `it.type`；`eventKind()` 对期限类事件返回 `deadline`。

### 四、期限提示

- **逾期任务不再被推送窗口吞掉**：`push.ts` 的 `WINDOW_DAYS=[0,1]` 原先对所有 kind 生效，
  一个 09-24 到期未完成的「递交起诉状」在 09-25 之后就从飞书提醒里消失——最该催的事
  被静默掉。抽出 `selectPushRows()`：逾期任务（`kind==='task' && daysLeft<0`）每日重推，
  日程仍维持 `[0,1]`（日程过期即历史，不产生逾期）。飞书卡片为逾期行加醒目
  「已逾期 N 天」标签，副标题相应调整为「今日与明日到期，及逾期未完成的任务」。

### 五、体检口径（消灭「漏登记却给满分」）

- **同时检查关键日期与时间轴日程**：旧版只遍历 `record.keyDates`，而工具描述明确要求
  「已发生节点只进时间轴、不进关键日程」——按规范做法登记反而在体检里等于没登记，
  本案就是漏登日程却拿到 100 分。
- **术语按程序轨匹配规则表**：旧版硬编码 `['裁判文书送达','上诉期届满']`（诉讼中心词表），
  劳动仲裁案按正确术语登记「起诉期届满」反被判缺失——**等于把管家推向错误的「上诉期」**。
  现在按案件 level 从规则表取术语（劳动仲裁 → 起诉期届满 / 撤销裁决申请期届满）。
- **届满日校验**：届满节点带 `ruleId` 时按该规则复算，与「送达日 + 法定期间 + 顺延」
  不一致即报缺口（写错日期与漏登记同样致命）。
- `case_health` 的进程内与 HTTP 两条路径都会带上时间轴日程参与体检。

### 六、验证

- 新增 `scripts/verify-deadline-rules.mjs`（33 条断言）：规则匹配/歧义、派生计算
  （含 2026-002 案 09-11 → 自然届满 09-26 周六 → 顺延 09-28）、登记三件套与幂等、
  歧义与未命中不落库、体检三项口径、`eventKind` 归类、推送窗口选择、锚点链完整性。
- `node scripts/verify-deadline-rules.mjs` 全绿；其余 verify 脚本无回归
  （`verify-stage-expansion.mjs` 为既有失效脚本：仍在用已废弃的 stageId `trial`，与本次改动无关）。

---

### 备忘 #30：官方右边栏 —— 原生树 + 右键功能 + 案件卷宗 tab

> 本条目经历**两次方向纠正**，最终定稿如下（前两版均已废弃）：
> ① 一开始把 AgentLex 整棵文件树接管官方 `files` 页 → 用户：「不是直接把边栏嵌套在里边」；
> ② 改成只挂右键、卷宗靠「把案件文件夹设为会话工作区」→ 用户：「**原则是不能改工作区啊！！**……我要的是在原生文件树，但是能自动打开案件文件夹，也能选择文件夹，不要原来那套啊」。
> 最终：**官方原生文件树原样保留**；「案件卷宗」以**独立 tab（我们自己的渲染层）**出现，靠**会话绑定/显式请求**自动打开，**绝不触碰会话工作区**。

- **原生树 + 我们的右键菜单**（官方 `files` 页保持原样、不接管、不改写它的 DOM）：`mountNativeTreeContextMenu` 在 `document` capture 阶段代理 `contextmenu`，只认官方锚点（`[data-files-state="tree"]`、`li[data-files-entry][data-files-path]`）。菜单项 —— 文件：插入 `@引用`／用默认应用打开／在 Finder 中显示／复制路径／复制相对路径／重命名／删除；文件夹：插入 `@引用`／新建文件／新建文件夹／在 Finder 中打开／复制路径／复制相对路径／重命名／删除；空白区：新建文件／新建文件夹／复制根路径／在 Finder 中打开／刷新。改动后点官方树自己的刷新控件重列目录。
- **「案件卷宗」独立 tab**（kind `agentlex-case-files`，标题「案件卷宗」）：
  - **自动打开**：会话绑定诉讼案件 / 非诉项目时，右边栏一展开就**静默带上**这个 tab（先记 active，开完 `focus` 回去，不抢官方「文件」页）；观察官方 frame 的 `data-rightbar-collapsed` 判定展开，每个会话只补一次。
  - **选择/定向文件夹**：案件/项目详情页文件夹那行的「在侧边栏打开」把该目录设为 tab 根（**该案是否绑定当前会话都成立**），非诉项目页本轮补上这个入口。
  - **外观与我们自己的右边栏一致**：tab 正文外层补上 `ThemeRuntimeProvider`（上一版漏了这层，落回 vendored 默认皮肤，才出现「套进来就变样 / 背景发黄」）；工具条走 `minimalChrome` —— 只留「搜索 / 切换目录（+ 定向后一个『返回卷宗』）」，去掉「案件·项目」跳转 chip、「回到工作区」以及 DirectoryPanel 自带的「工作区／案件文件夹」根切换。
  - ⚠ 刻意**不给引导入口**：官方默认页按「引导入口数」决议，多注册一个入口会让官方默认页从原生文件树退化成引导罗盘。
- **绝不改会话工作区**（用户红线，已加回归断言锁死）：`caseFolder`/`projectFolder` 这套「把卷宗当会话工作区」的写法**已完整撤销**（`git diff` 为空），launcher 回到模块数据目录。
- **首次打开宽度收窄**：官方默认窗宽 45%（1600px = 720px）。复用官方**拖拽把手**合成 `pointerdown → pointermove → pointerup` 让它的 store 写下 380px。⚠ 坑：把手把位移施加在 store 的**偏好宽度**上，而 `getBoundingClientRect()` 读的是**渲染宽度**——打开有 CSS 过渡，中途读会偏小（实测 440 vs 720）→ 必须等宽度稳定（连续两帧一致）再拖 + 拖后校验重试；另带 `nudge()`，很晚才首次展开也照样收窄（实测 40 秒后打开仍是 380px）。
- **修掉菜单叠加**：会话链接右键菜单原先在原生树上也会弹，与树菜单叠成两层；现让它在 `[data-side="rightbar"] / [data-files-state] / [data-agentlex-tree-menu]` 内直接放行。
- **验证**：`node scripts/verify-official-sidebar-memos.mjs`（含「绝不动会话工作区」回归防线）；`python3 scripts/probe-official-sidebar.py http://127.0.0.1:3081 <token>`（原生树在、我们的树 0 个、右键只出一个菜单、宽度 380px）；端到端实测根菜单**新建文件**落盘并在原生树刷出该行、右键删除后从磁盘消失（测试文件已清理）。

### 备忘 #30 二次反馈：五项修复（切换目录 / 原生预览 / 自适应宽度 / 常驻入口 / 设置适配）

- **① 切换目录没反应** —— 根因：`WorkspacePanel` 把绑定卷宗作为 `caseFolder` 传给 `DirectoryPanel`，而 DirectoryPanel 的 `effectiveRoot = viewMode==='case' && caseFolder ? caseFolder : agentDir` 会**把树根顶回卷宗**，用户选的目录被忽略。修法：精简档（右边栏）**不再传 caseFolder**，树根完全由 `agentDir`（= 我们解析出的 currentRoot）决定。实测：定向到 `docs/` 后树根随即跟随。
- **② 文件用 DSH 原生预览打开** —— 我插件不再自带预览：`DirectoryPanel` 新增 `onOpenFileNative`，文本/图片/富文档/搜索命中四条预览入口全部让位；`WorkspacePanel` 用 `onFilePreviewExternal` 关掉内置弹层，并把该回调指向原生打开；资源地址按官方 `dsh-resource://file/session/<sid>/<path>` 拼装。⚠ 坑：DirectoryPanel 的 `node.path` 是**相对树根**的，直接拼地址会到会话工作区里找同名文件（实测报「File not found」），必须先 `toAbsolute(root, path)`。实测：案件卷宗里点 `案件信息.md` → 右边栏新开原生预览 tab 并渲染出正文。
- **③ 宽度自适应** —— 官方默认 45% 窗宽（1600px = 720px）：看树太宽、看文件太窄。新增 `installAdaptiveRightbarWidth`：**树类 tab（官方 Files / 案件卷宗）→ 380px；预览/编辑类 tab → 视口一半（560–1040px）**；复用官方拖拽把手写宽度（等渲染稳定再拖 + 拖后校验）。用户一旦亲手拖过把手即**交还控制权**。⚠ 坑：会话区的 tab 条也用 `_tabActive` 类，全局查询会读到「Chat」把右边栏误判成预览类撑到半屏 —— 必须**限定在右边栏列内**查询。实测：树 380px ↔ 预览 800px 来回切换正常。
- **④ 卷宗面板关掉后没有入口** —— tab 条上常驻一枚「案件卷宗」按钮（`data-agentlex-case-tab`），一键开回；只**追加**自己的按钮、不改官方 DOM，React 重建 tab 条后由 body 观察者 + 低频兜底自愈。实测：关掉「案件卷宗」→ 点按钮 → 回到 tab 条。
- **⑤ 设置项适配** —— 「工作区右边栏」改名**「右侧文件栏」**（描述：官方右边栏：原生文件树 + 案件卷宗面板）；「侧边栏打开文件/链接」改成**「自动打开案件卷宗」**（新键 `autoOpenCaseTab`，默认 true；旧键 `openReferencesInSidebar` 仅作迁移回退读取，设置页不再写它）。会话内文件链接拦截改由总开关控制（它是右边栏本体能力）。
- **验证**：`node scripts/verify-official-sidebar-memos.mjs` 新增 13 条断言覆盖这五项；Playwright 端到端逐项实测通过。

### 备忘 #30 三次反馈：标题 / md 打不开（真根因）/ 按钮形态

- **① 切换目录后标题不变** —— 根因：标题写死成 `binding?.kind === 'case' ? binding.name : baseName(currentRoot)`，只要会话绑了案件就恒显**案件名**，与当前树根无关。修法：标题跟随**当前根**（根 == 绑定卷宗时用案件名，否则用目录名）。实测：卷宗 → `docs` → 返回卷宗，标题逐次跟随。
  顺带修掉一个连带的：「返回卷宗」原先只切 `rootSource`，但外部**根覆盖**还在（`preferredRoot`），auto 又把根解析回那个目录 —— 现在按钮同时清覆盖。
- **② md 等文件点不开（真根因）** —— 不是原生预览没接上（上一轮已接通，实测能开），而是**我们自己的会话链接拦截把点击吃掉了**：`mountConversationLinkHandler` 在 document capture 阶段把树里的文件名 `案件信息.md` 当成「会话里的文件路径」，`preventDefault + stopPropagation` 后树行自己的打开逻辑根本收不到事件。修法：该拦截器**跳过官方右边栏列（`rightbarCol`）与我们的卷宗面板（`data-agentlex-workspace-root`）内的点击**。实测：真实鼠标点击 md 行 → 右边栏新开原生预览 tab 并渲染正文。
  ⚠ 附带教训：这段「原生树右键菜单」逻辑两次被我做区间替换时误删，导致 `mountNativeTreeContextMenu is not defined` + **插件整包加载失败**。现已**拆成独立模块 `native-tree-menu.ts`**，不再与别的改动共处一文件，并加了断言。
- **③ 「案件卷宗」按钮形态** —— 原先是一枚 4 字文字按钮、夹在 tab 胶囊之间（看着像多了一个 tab）。现改为**28×28 图标按钮**（folder 线性图标 + 悬浮提示「案件卷宗」），放进官方**控件簇 `_stripChrome`**（全屏/折叠按钮那一组），与官方 iconButton 同尺寸同 hover 表现。实测：`28×28`、无文字、位于 `_stripChrome`。
- **验证**：`verify-official-sidebar-memos.mjs` 共 70 条断言全绿（含本轮 7 条）；Playwright 逐项实测：标题跟随、md 真实点击开原生预览、图标按钮位置/尺寸、关 tab 后图标按钮开回、原生树右键菜单仍在。

### 备忘 #30 四次反馈：卷宗树只剩一套右键菜单 + 会话右键加「在侧边栏打开」

- **① 案件卷宗树里冒出两套右键菜单** —— 根因：会话链接右键处理器（`mountConversationLinkContextMenu`）的**点击**拦截早已排除右栏，但**右键**拦截只排了 `[data-side="rightbar"]` 与 `[data-files-state]`；而我们的「案件卷宗」面板（DirectoryPanel）两者都没有 → 它自带的右键菜单与链接菜单同时弹出。修法：右键处理器与点击处理器对齐，**按整个右栏列 `[class*="rightbarCol"]` 排除**，另加 `[data-agentlex-workspace-root]`。实测：卷宗树右键只剩 DirectoryPanel 自带那套（Preview / Quote / Open / …）；官方原生树的菜单不受影响。
- **② 会话右键菜单新增「在侧边栏打开」** —— 原先只有 md 才有「在边栏预览」。现在**任何**路径（文件或目录）都有「在侧边栏打开」，md 额外保留「在边栏预览」。
  并且把它做对：**目录 → 作为卷宗面板的树根；文件 → 树根落到它所在目录 + 把文件送进 DSH 原生预览**（把文件本身当树根会得到一棵空树）。
  另修掉一个路径解析坑：会话正文里常只写裸文件名（`案件信息.md`），按会话工作区解析会指到数据目录（`~/.dsh/agentlex/litigation/案件信息.md`）→ 原生预览报 "File not found"。现在先 `local-check` 原路径，不存在则**在会话绑定的案件/项目卷宗里按文件名查找**，再退回会话工作区。实测：点「在侧边栏打开」→ 卷宗面板定位到 058 卷宗 + 原生预览渲染出 `案件信息.md` 正文。
- **验证**：`verify-official-sidebar-memos.mjs` 全绿（本轮 +6 条断言）；Playwright 实测两处右键各只出一套菜单、会话菜单四项功能、文件正确落到卷宗目录并预览。

### 备忘 #30 五次反馈：合并重复入口 + 打开不再两段式（并补构建防呆）

- **①「在侧边栏打开」与「在边栏预览」是同一件事** —— 直接合并：会话右键菜单现在只有「在侧边栏打开 / 用系统打开 / 复制路径」三项（md 不再单独多一项）。
- **② 打开是两段式（先闪一下卷宗面板，文件才慢一步出来）** —— 根因：上一版为了等「案件卷宗」tab 正文挂载拿到回调，写了 `openCaseTab() → setTimeout(1000) → 打开文件`。现在改成**一步到位**：文件路径直接 `openResource` 打开 DSH 原生预览并聚焦，卷宗面板用 `addCaseTabQuietly()` **静默**补进 tab 条（开完把焦点还回去，不抢）。实测：点击后 **+200ms** 文件预览已是活动 tab 且正文已渲染，没有中间的卷宗面板闪烁。
- **⚠ 构建防呆（本轮真正的坑）** —— 我连着两次用 `pnpm run build | grep ...` 之类的管道，把构建错误吃掉了；`pnpm pack` 随之失败，于是**静默部署了旧 tarball**，用户看到的仍是老行为（这就是「为什么还是一样」的原因）。已新增 `scripts/deploy-test-instance.sh`：构建失败即停并打印日志尾部、确认产物存在、按给定特征串校验（`bash scripts/deploy-test-instance.sh "在侧边栏打开"`）、再打包/部署/重启，最后直接打印带 token 的验收地址。**以后一律用这个脚本部署，不再手工管道。**
- **验证**：`verify-official-sidebar-memos.mjs` 79 条断言全绿（本轮 +4 条：无重复入口、一步到位、静默补 tab、文件落所在目录）；Playwright 实测会话右键三项、+200ms 文件预览已渲染、卷宗树右键仍只一套菜单。

### 备忘 #30 六次反馈：点 md 只开文件 / 两处右键统一 / 首次打开宽度不再闪

- **① 会话里点 md 会「先开卷宗面板、再开 md」** —— 两处原因叠加：
  1. 打开文件前会 `addCaseTabQuietly()` 把卷宗面板补进 tab 条（我上一轮加的），虽然随后切回焦点，但仍会闪一下 → **去掉**，文件路径现在**只开文件预览**（卷宗根仍然记下，用户下次点卷宗 tab 就是对的目录）；
  2. `panel-open` 事件里调了 `refresh()`（无参数会把目标重置成「按当前活动 tab 推断」= 树=窄），而 `panel-open` 与 `reveal-request` 是成对派发的 —— 于是先缩到 380、再撑到 800。改为 **`panel-open` 只 `arm()` 不设目标**。
  3. 另加 `revealInFlight`：reveal 进行中抑制「会话绑定自动带卷宗 tab」，不抢用户的目标。
- **② 原生树右键与卷宗面板右键不一致** —— 真因是**两套来源**：原生树那套是我手写 DOM 的（英文/自研样式），卷宗面板那套是 vendored ContextMenu（走 i18n）。修法：
  - 原生树菜单改用**与卷宗面板完全相同的类名**（`min-w-[160px] rounded-xl border border-[var(--line)] bg-[var(--paper-elevated)] py-1.5 shadow-lg` + `text-sm` + lucide 图标 + 同样的 hover/danger 色），并改成**中文菜单项**（预览/引用/打开/打开所在文件夹/复制文件路径/复制相对路径/重命名/删除 + 文件夹的新建/复制文件夹路径/刷新）；
  - 顺手修掉面板菜单**英文**的根因：vendored i18n 的初始语言取 `navigator.language`（英文环境就出英文，于是同一栏里一中一英）。现在把卷宗面板语言**钉到中文**（AgentLex 业务界面本就是中文产品）。
- **③ 首次打开右边栏先按原生 45% 撑开再缩进** —— 三个真问题：
  1. 早先 `frame` 是用 `handle.parentElement` 推出来的，而**收起态没有把手** → `armInstant()` 直接 return，从未生效；
  2. 官方 `setRightbar` 没有暴露（`binding.actions` 是 dockkit 的 tab 动作，不含它），所以只能在「把手出现」后写 store，中间那一帧必须自己抢：现在**展开前**就把目标宽度写到 frame 的 inline 网格上，且在 `MutationObserver` 的**微任务阶段**（早于本帧绘制）把 React 覆写的值再纠回来；
  3. 事件驱动的 `whenStable` 太脆 → 重写为**逐帧 settle 收敛循环**（有把手就 drag 写 store、没把手就抢 inline；到位即收工、1.2s 保险丝兜底恢复过渡）。
  4. 事件顺序也修了：`panel-open`（只 arm）与 `reveal-request`（带目标宽度）原先顺序不利，现在**先 reveal 再 panel-open**，且 reveal 内**同步**先按「像不像文件」定宽（路径解析是异步的，晚 10–50ms），避免先按树宽收一下；
  5. 活动 tab 感知改用**400ms 轻量轮询**（官方 tab 条增删 tab 时会被整体重建，挂在旧节点上的 MutationObserver 会失效 —— 实测「点文件开了预览 tab、宽度却停在树宽」）；
  6. 收敛完成后加 600ms 冷却（刚打开时官方 tab 条的活动标记可能还没落定，立刻重推会把 800 误判回 380）。
  实测（逐帧采样右列宽）：首开 = `0,0,0,380,380…`（**不再出现 720**）；会话点 md 首开 = `0,0,0,800,800…`（直接就是预览宽）；点文件切预览 / 切回树 = `380 ↔ 800` 自适应。
- **验证**：`verify-official-sidebar-memos.mjs` 全绿（本轮 +12 条断言）；Playwright 逐帧采样、两处右键菜单文案/样式比对、菜单开合均实测。

### 备忘 #30 事故与回退：绝不直接改官方 frame 的网格

- **事故（2026-09-11）**：为消掉「首次打开先按官方 45% 撑开再缩进」那一帧，我在上一轮加了 `paintInline()` —— 把目标宽度**直接写到官方 frame 的 inline `gridTemplateColumns`** 上占位，并在 MutationObserver 的微任务里反复盖回去。问题是：**官方 layout store 并未提交**，于是 frame 上出现了一个官方不知情的第三轨道（例如 800px），中心列被压到最小、右边栏像覆盖层一样压在会话上。用户实测到「打开右边栏直接成了覆盖在会话上的且宽度巨大的边栏」。
- **回退**：`paintInline` 与 observer 里的纠偏**全部删除**。宽度**只能**由官方把手（它自己的 drag 流程）写进官方 store；拿不到把手就放弃本次调整。宁可首帧按官方宽度闪一下，也不越过官方改布局。
  - 新增不变量并锁进断言：`official-sidebar.tsx` 里**不得出现** `gridTemplateColumns =`。
- **保留的**：把官方 `data-rightbar-instant` 打开（官方自己的「禁过渡」属性）→ 我们写宽度时不会被动画播出中间值；逐帧 settle 收敛 + 1.2s 保险丝；活动 tab 感知的 400ms 轮询兜底；收敛后 600ms 冷却。
- **新增**：目标宽度按窗口**实际可给空间**夹取（官方中心列最少留 400px），避免窄窗口下目标永远达不到、settle 白转满保险丝。
- **实测（布局完整性）**：1600 / 1280 / 1100 三种窗口下，frame 三列宽度**恰好等于窗口宽度**（280+940+380 / 280+620+380 / 280+440+380），无溢出、无覆盖，`data-rightbar-collapsed` 状态正确。

### 备忘 #30：侧栏打开的文件 **停靠在右侧面板**（弹窗方案已撤销）

- **需求变更**（2026-09-11）：先要求「以弹窗方式出来」，实现后用户改主意 ——「算了不用弹窗了，还是侧面板吧」。已**完整撤销**浮动面板方案。
- **现状**：文件仍以 **DSH 原生预览**打开，并**停靠在右侧面板**里（官方 tab，非浮动窗）。两条入口一致：会话里的文件链接、以及「案件卷宗」树里点文件。
- **撤销内容**：删除 `openFileAsFloat()` / `defaultFloatRect()` / 控制器上的 `float?()` 声明；不再调用官方 `sidebarRight.float()`。断言同步改成「不许再出现 float 弹窗」。
- **实测**：打开文件后右侧栏 `280 + 520 + 800 = 1600`（会话区让位、不覆盖），浮动弹窗数 **0**，tab 条 `Files / 案件信息.md`，正文正常渲染。
- **验证**：`verify-official-sidebar-memos.mjs` 95 条全绿（含「不再使用官方浮动面板」这条反向断言，防止以后又冒出来）。

### 备忘 #31：案件详情页增加「法官联系电话」

- 字段 `judgePhone` 全程打通：`CaseRecord`（`store/types.ts`）→ `registerCase` 写入（`case-store.ts`）→ agent 工具 schema 与两处字段白名单（`tools.ts`）→ 案件信息.md 模板新增「承办法官 / 法官联系电话」两行（`file-service.ts` + routes/tools 的 ensure 调用点传值）→ vendor `CaseEntry`/`DiskCase`/`normalizeCase` → 案件详情页「案件基本信息」的「承办法官」旁新增可编辑单元格「法官联系电话」（占位「未填写」）。
- **验证**：`node scripts/verify-judge-phone-store.mjs` 在**临时目录**跑真实 store 的 register → read → update（不碰用户卷宗数据），全绿；Playwright 实测案件详情页渲染出「法官联系电话 / 未填写」。

### 备忘 #32：管家按钮会话数不再把已归档会话算进去

- 根因：`AgentSessionButton`（诉讼 `CaseDetailPage` / 非诉 `NonLitigationDetailPage`）的归档集合初值是**空集**，只在**点开按钮时**才去取；于是按钮上的 `(N)` 含已归档会话，点开后 `mySessions` 被重算，数字「立刻掉回」真实值。
- 修法：归档集合改为 `ReadonlySet<string> | null`（null = 未取回），**进页面即预取**（绑定变化、窗口重新聚焦时刷新），取回前不显示数量徽标；计数与下拉列表用同一份过滤结果。取函数经 ref 持有，避免父级内联函数造成的重复请求。归档集合取自 `workspaces.list` 快照（纯内存读，无网络开销）。
- **验证**：Playwright 实测案件 2026-058（2 条绑定会话、其中 1 条已归档）——**点击前**徽标已是 `诉讼管家(1)`，点开后仍为 `(1)`，不再出现「点开就掉数」。

### 前端：只留一套面板 + 深色模式接线（视觉一律不动）

> 说明：本版曾尝试重做三业务模块的卡面/配色/标签体系，**用户看过全部否决，已完整还原到原版观感**。
> 下面只列最终保留的、肉眼看不见的改动。

- **删除被取代的原生重复面板实现**：三个业务模块早已统一挂载原 AgentLex（`vendor/panel-ui`）渲染层，原生那套已无人引用，删除 `task/client/TaskPanel.tsx`、`TaskDetailDrawer.tsx`、`mobile.module.css`、`use-mobile.ts`、`api.ts`、`nonlitigation/client/board.module.css`（含 `api.ts` / `format.ts` / `project-taxonomy.ts`）、`litigation/client/{case-format,case-taxonomy,party}.ts`、`litigation/client/detail/{tasktree,timeline}.module.css`、`skin/client/embed.ts` 及 3 个空目录；5 份完全相同的 `sidebar-entry-core.ts`（168 行/份）合并为 `src/shared/sidebar-entry-core.ts`。三个 `panel.module.css` **保持原样不动**（里面承载着不含类名的全局激活规则，见下方事故记录）。
- **深色模式接线**（浅色下零差异）：三个 `Original*Panel` 原本写死 `data-color-scheme="light"`，改为 `useColorScheme()`（`src/shared/color-scheme.ts`）跟随 DSH 的 `data-ds-dark-theme`（同时观察 `html` 与 `body`）；皮肤侧 `applyLitVars` 同样补上 body 观察，避免深色下 `--lit-*` 仍是浅色导致「深卡片 + 深字」。
- **新增防回归脚本** `scripts/verify-ui-consistency.mjs`：只断言结构与接线（面板激活规则仍在 / 只保留 vendor 一套面板 / 深色接线在位），**不断言任何视觉设计**。`node scripts/verify-ui-consistency.mjs`，1 秒跑完，失败退出码 1。
- ⚠️ **事故记录（务必保留）**：曾按「未引用类名」脚本剪枝三个 `panel.module.css`，把同一文件里**不含类名的全局规则**（`[data-dsh-*-view]{display:none}`、`html[data-dsh-*-active] …{display:block}`、会话列隐藏、`:root` 的 `--lit-*` token 块）当死代码删掉，三个侧栏入口点击毫无反应（面板 `display` 永远 none）。已 `git checkout` 还原；这些文件不再脚本化清理。

## 0.2.10（2026-09-10）

### 适配 DSH 0.1.5-rc.1：会话区 data-slot 变更（conversation → main.conversation）

- **根因**：0.1.5-rc.1 将顶层 `conversation` slot 迁移为 `main.conversation`，slot 渲染器注入的 `data-slot` 从 `"conversation"` 变为 `"main.conversation"`，皮肤 CSS 的 164 处 `[data-slot="conversation"]` 锚点（轮次导航 / 会话排版 / 会话头部 / 行内代码 / 侧栏会话区样式）全部失效，导航条美化等不生效。
- **修复**：全部改为 `:is([data-slot="conversation"], [data-slot="main.conversation"])` 双锚点（含 3 处 JS querySelector），兼容 0.1.3 与 0.1.5；子 slot（`conversation.session` / `conversation.session.header` / `conversation.composer.bar`）data-slot 值不变，未动。
- 已在 3081 测试实例（0.1.5-rc.1）目测验证通过。

## 0.2.9（2026-09-10）

### 期限提醒自包含化（不再依赖 dsh-timer-agent / dsh-im）

- **内置定时器**：每天按配置时间（pushTime，默认 08:30，设置页可改）推送一次「今日 + 明日」到期的日程与任务；删除对 dsh-timer-agent 的依赖（删 syncTimerJob / push-cli.mjs / copy-push-cli.mjs）。
- **固定飞书卡片**：直连飞书 open API 发结构化卡片（加粗标题 + 彩色「今天/明天」text_tag 标签 + 案件名/元信息/详情分层 + 日期副标题 + 来源 note），删除对 dsh-im 的依赖。
- **飞书凭据自包含配置**：设置页「期限提醒」新增「飞书机器人」表单（App ID / App Secret / 接收人 Open ID），写入 `$DSH_HOME/integrations/dsh-feishu/config.json` + `.credentials.yaml`（与每日早报同一套格式）；secret 只写不读回。新用户无需安装 dsh-im。
- **推送内容修正**：案件名按 ownerId 从 case/project-registry 补全（items ownerName 大量缺失）、detail 完整展示时间地点、按日期+时间排序。
- **去重按推送日**：台账只认今天的记录，次日 8:30 重新推送窗口内期限；手动「立即执行一次」force 绕过台账推全部（自动=去重，手动=全量）。
- **设置项归类**：期限提醒设置并入「日程与提醒」分区（PushSettings 直接渲染进 settings-section.tsx，删除独立 workbench item 与 workbench-slot.ts）。
- 卡片文案统一为「重要日程与任务提醒」。

## 0.2.8（2026-09-09）

### 融合 dsh-ui-harmonizer 设计：圆角卡片 + 会话页融合设计 + 段距调大

#### 圆角卡片（设置项 centerCard，默认关）

- 对话区域显示为左上圆角卡片（附投影），随侧栏宽度/详情列自适应（ResizeObserver 几何跟踪）。
- 分面绘制模型：会话 header（z-21）画卡片顶边（inset hairline + 18px 左上圆角），
  overlay 透明盒子只投 `--dsw-shadow-lv3` 阴影（含左侧溢出到侧栏的投影），零像素分割、无双重描边。
- 实现：`src/domains/skin/client/center-card.tsx`（`mountCenterCard` 手动挂 body 盒子 +
  ResizeObserver；因 0.1.5-alpha.1 slots 包 SlotMap 无 `shell.overlay` 槽，不用槽方案）。
- 独立类名 `html.agentlex-center-card-on`，与 dsh-ui-harmonizer 的 `enhc-center-card-on` 互不干扰。

#### 会话页融合设计（设置项 conversationHeader，默认开）

- header 单行化：会话/轨迹切换 tab 行搬进标题行（`_titleCluster`），header 折叠成一行；
  去官方分隔线与伪元素装饰，不透明表面 + z-21 抬升。
- tabs 胶囊化：28px 胶囊（radius 14px），激活态品牌蓝底白字（`#fff`，暗色主题下不黑字）。
- 实现：`src/domains/skin/client/conversation-header.ts`（`CONVERSATION_HEADER_CSS` +
  `mountConversationHeader` tabs 重定位，幂等检查与 harmonizer 并存不重复插入）。
- 锚点全部类名后缀匹配（`_titleCluster`/`_headerActions`/`_tabs`）+ data-slot，0.1.5 的
  `wSkVaW_*` 类名实测有效；不设 header `margin-right`（那是 harmonizer 给 better-sidebar
  toggle cluster 留位，本套件不依赖）。

#### 会话排版段距调大（备忘 #22）

- 排版增强段距：`p` 24→32px、`p+p` 28→36px、`ul/ol` 20→28px、`li+li` 10→12px（固定 px 不随字号缩水）。

#### 案件看板位置修复（备忘 #23）

- 诉讼页「案件看板」（CaseBoard 数据看板：新收/标的/收费/在办/逾期/类型分布）原渲染在
  案件卡片网格**下方**，改为渲染在工具栏下方、卡片网格**上方**——先看总览再看明细。
- 改动：`vendor/panel-ui/renderer/components/agentlex/CaseDashboard.tsx`（CaseBoard 块从
  卡片网格后移到工具栏与卡片网格之间）。

#### 紧急日程弹窗（范围可切换：未来 7 天 / 一个月 / 全部）
- 诉讼页统计区「紧急日程」按钮点击改为**弹窗**展示重要时间节点（日期 + 倒计时 + 日程类型 + 案件名），
  不再直接打开任务面板；弹窗内注释「默认显示未来 7 天的重要时间节点，可切换查看范围」。
- 弹窗内范围切换：**未来 7 天**（5 条）/ **未来一个月**（10 条）/ **全部**（不限）；按钮角标计数固定为未来 7 天。
- 点击日程条目**跳转该案案件详情**（`onOpenCase`），弹窗自动关闭；支持 backdrop/关闭按钮/Cmd+W 关闭。
- 改动：`vendor/panel-ui/renderer/components/agentlex/CaseDashboard.tsx`（urgentRange state +
  urgentWeekCount 角标 + OverlayBackdrop 弹窗）、`src/domains/litigation/client/locales.ts`。

#### 日程同步 Apple 日历（设置项 calendarSyncEnabled，默认关）

- **所有有日期的日程**（诉讼/非诉/独立的事件与任务）建立时自动写入 Apple 日历（macOS），iCloud 同步到 iPhone。
- 机制（参考 smart-calendar）：osascript 直接调用 Apple Calendar 创建事件，纯 Node child_process + AppleScript，零第三方依赖。
- 统一触发：item-store 层对「有 date 的 event/task」广播 `agentlex:calendar-sync`（建立/更新）与 `agentlex:calendar-sync-delete`（删除），litigation 域监听执行——诉讼/非诉/独立三条创建路径自动覆盖，无日期任务与子项不触发。
- 幂等：itemId → Apple 事件 uid 映射存 `$DSH_HOME/agentlex/calendar-sync-map.json`，事件更新时按 uid 更新（不重复创建），删除时按 uid 删除；AppleScript 的 uid 查询必须指定日历（全局查询失败）。
- 兜底：Calendar 未运行（-600）时自动 `open -a Calendar` 拉起重试；首次调用需在 系统设置 → 隐私与安全性 → 自动化 授权。
- 目标日历名可配置（默认「个人」）；设置页「功能模块」区诉讼案件子项开关。
- **同步范围可配置**：主开关「日程同步 Apple 日历」+ 两个子开关「同步事件」（默认开）/「同步带日期任务」（默认关），按 type 过滤（事件走 calendarSyncEvents、任务走 calendarSyncTasks）。
- 改动：`src/domains/calendar-sync/index.ts`（新）、`src/domains/item/store/item-store.ts`（广播）、`src/domains/litigation/index.ts`（监听 + Config）、`settings-section.tsx`（开关）。

#### 验证

- 3081 测试实例（0.1.5-alpha.1）实测：host API 返回新字段、设置页开关可操作、
  header 样式生效（borderBottom 0 / padding 12px 20px / z-21）、圆角卡片盒子几何正确
  （56px/700px/468px/z-20）、开关关闭干净卸载可逆、段距新值注入生效。
- 0.1.5 适配性核对：新代码全用既有模式 + 纯 DOM，无 0.1.5 不兼容 API。

## 0.2.7（2026-09-08）

### DSH 0.1.3-alpha.2 适配 + agent-preset persona 字段修复

#### agent-preset persona 字段修复（text → prefix）

- **`dsh-persona` 在 DSH 0.1.3-alpha.2 把配置字段从 `text` 改名为 `prefix`（必填）**，
  插件自带 preset 模板 `presets/*/agent.cordis.yml` 未跟上，导致诉讼管家/非诉管家
  preset 装配报 `$.prefix missing required value`。已把两个模板的 persona 配置
  `config.text` 改为 `config.prefix`；插件 apply 同步 preset 时自动带出修复。
- 验证：用 0.1.3-alpha.2 的 `dsh-persona` `Config` schema 校验——`prefix` 配置通过、
  `text` 配置报 `$.prefix missing required value`（精确复现原报错）；3081 测试实例
  （dsh-latest 0.1.3-alpha.2 + ~/.dsh-ls-test）插件宿主 API 200、preset 同步为 `prefix`。

#### DSH 客户端运行时拆分适配（dsh-client-runtime 退役）

- **`@deepseek-ai/dsh-client-runtime` 在 DSH 0.1.3-alpha.2 拆销**（无该版本发布），其
  类型与能力迁往独立包。本插件 18 处 `dsh-client-runtime/client` 类型导入全部迁移：
  - `ClientContext` → `Context as ClientContext` 改自 `@deepseek-ai/cordis`；
  - `ISessions` → `@deepseek-ai/dsh-api-session-controller/client`；
  - `IWorkspaces` → 由 `@deepseek-ai/dsh-api-workspace-controller/client` 提供，但该接口
    **不再含 `pickDirectory()`**（迁至 `ctx.uiWorkspace.pickDirectory()`），目录选择改走
    `dsh-client-ui-workspace` 的 `uiWorkspace` 服务（设置页数据目录选择 + 案件/项目文件夹
    选择两处同步适配，含 `ctx.get('uiWorkspace')` 惰性解析回退）；
  - `SettingsScope` → `@deepseek-ai/dsh-settings`。
- **依赖版本**：11 个 `@deepseek-ai/dsh-*` 依赖从 `0.1.1-rc.2` 升至 `0.1.3-alpha.2`
  （与 dsh-latest 官方最新 alpha 对齐），新增 `@deepseek-ai/dsh-api-session-controller`、
  `@deepseek-ai/dsh-api-workspace-controller`、`@deepseek-ai/dsh-util-values`；
  移除 `@deepseek-ai/dsh-client-runtime`；`dsh-mcp-client` peer/dep 升 `^0.1.3-alpha.2`。
- **`JsonValue`** 从 `@deepseek-ai/dsh-tools` 迁至 `@deepseek-ai/dsh-util-values`（memo
  域工具返回类型随之改源）。
- **`dsh.client.inject` 精简**：移除已退役的 `@deepseek-ai/dsh-client-runtime`，保留其余
  client runtime 包；`tsdown.config.ts` 的 `CLIENT_EXTERNALS` 同步替换为新的控制器子路径。
- 运行时兼容性已逐一核对：`sessions`/`workspaces`/`uiWorkspace`/`connection`/
  `inputTriggers`/`theme`/`settingsScope`/`locale`/`slots` 在 0.1.3-alpha.2 客户端 Context
  上均仍提供；`defineTool`、`settingsScope.bind`、`ISessions.list` 契约未变。
- **验证**：`tsc -p tsconfig.build.json`（宿主）+ `tsdown`（client bundle）构建通过，产出
  `lib/index.js` 与 `client/client.js`。运行时冒烟需在隔离 profile（agentlex-ls-test，
  端口 3081，需 0.1.3-alpha.2 DSH）回归，经用户确认后再 commit/push。

## 0.2.6（2026-09-08）

### 民商一审阶段对齐 + 事件纪年规则 + 状态变更三态展开（confirm/agent/off）

- **民商一审阶段模型按实务对齐**（user 逐条校正）：
  - 阶段流：收案 → 诉前准备 → 立案中 → 庭前准备 → 庭后管理 → 上诉期；
  - 收案：核查利益冲突 / **初步研判诉讼可行性并确定诉讼方案**（新增）/ 签订委托代理合同 / 风险告知与收费确认；
  - 诉前准备（立案前材料准备）：梳理案情并核查时效与管辖 / 起草起诉状 / 整理证据材料并编制证据清单；
  - 立案中（用诉前备好材料申请立案）：提交网上立案申请 / 跟进立案审查结果；
  - 庭前准备：**准备答辩状**（原「提交答辩状」，不预设提交对象；删除「查阅对方答辩状」）/ 答辩·举证·保全·庭审准备；
  - 庭后管理：「领取裁判文书」→「**确认裁判文书**」；
  - 上诉期（独立阶段）：分析判决并出具上诉研判意见 / 确认当事人上诉意向 / 起草·提交上诉状（条件）。
- **事件「是否随状态切换自动落盘」规则（`EventTemplate.auto`）**：只有日期能自主确定的事件
  （收案、立案、执行立案）随状态/建案自动落盘；日期依赖外部信息（**开庭需传票、答辩期/举证期
  需送达日/举证通知书、裁判文书送达/上诉期届满需送达回执**）一律**不自动落盘**，由管家收到
  对应文书后手动 `upsert_event` 登记（传票三件套流程）。开庭/出庭等庭审行为归入「开庭」旁路
  阶段的子任务（核对原件、举证质证、签庭审笔录）。
- **立案时间轴事件联动**（立案中→庭前准备 = 已立案）：进入庭前准备自动落「立案」事件；
  无受理通知→立案日期=进入阶段日期；已有/后续补录受理通知→以受理通知日期为准并修正立案日期。
- **事件纪年·头尾补齐**：事件词表新增 `engagement`（收案）/ `close`（结案）/ `archive`（归档）；
  建案自动落「收案」（原「收案/委托」）事件（kind=engagement，status=done）；
  `Item` 补回 `kind` 字段（0.2.2 并库时事件类型被硬编码的信息缺口修复）。
- **状态变更三态展开**：`expandOnStatus`（case 级，默认 confirm）——confirm（改状态后挂起
  `pendingExpand`，确认后再展开）/ agent（交管家按纪律自主处理）/ off（不展开）。所有改状态
  入口（工具 `update_case`、路由 `update-case` + legacy `/api/agentlex/update-case`，**UI 详情页
  手动改同样触发**）统一经 `handleStatusTransition`；`resolve_pending_expand`
  （expand 落任务+事件 / ignore 仅清除）收尾；读侧透出 `pendingExpand` 兜底。
- **UI 确认弹窗**（`PendingExpandBar` 由顶部条改为 modal）：改状态后弹出「状态已推进，是否展开
  阶段任务？」，[展开] / [忽略]；详情页视图挂当前案件、诉讼面板挂全部，监听
  `agentlex:registry-changed` 实时刷新。
- 工具 `eventType` 放开为自由词表；新增 `resolve_pending_expand` action；DESCRIPTION 补
  「事件纪年」「状态变更→阶段展开三态」纪律。

## 0.2.5（2026-09-07）

### 备忘录 #20–#21（独立任务修复 + 案件卡片排序 + 详情页实时联动 + 任务表单布局）

- **#20 ① 独立任务勾选完成方框不可用**：`updateStandaloneTask` 双写
  （standalone-tasks.json + items.json）并透传 status，忽略新建任务不在
  standalone-tasks.json 的 not found 错误（items.json 为真相源）；
  `/api/agentlex/read` 的 standaloneTasks 聚合 items.json 独立任务
  （ownerId 空 + ownerType standalone），新建独立任务不再不显示。
- **#20 ② 详情页自定义更改不实时更新**：CaseDetailPage `updateParty` 在我方
  当事人角色变化时同步推导 `ourSide`，「我方/对方」分组与诉讼地位标签实时更新；
  `setOurParty` 复用公共 `ourSideOfRole`，消除重复逻辑。
- **#21 新建任务后案件卡片排序不变**：litigation 路由（task/event/delete/toggle）
  与 task 域写穿路径（/api/agentlex-task/task、delete-task）增删改后 bump
  案件/项目 `updatedAt`，卡片按「最近更新」置顶。
- **布局**：详情页任务树溢出菜单 date/time 横排溢出 → 改竖排各占整行。

## 0.2.4（2026-09-05）

### 阶段状态按修正稿对齐 + 管家自适应升级 + 备忘录 #14–#19

- **状态标签全面对齐修正稿 docx 六套**（GUI 与服务端两处数据源同步）：
  - 民商一审：收案 → 诉前准备 → 立案中 → 庭前准备（含答辩/举证/开庭） → 庭后管理（含裁判送达） → 上诉期 → 二审中 → 已结案；
  - 民商二审：收案 → 诉前准备 → 上诉立案 → 庭前准备 → 庭后管理 → 已结案；
  - 执行：收案 → 立案 → 执行中 → 终本 → 恢复执行 → 已结案；
  - 再审 / 劳动仲裁（含起诉期）/ 商事仲裁（含组庭答辩）/ 刑事 均按修正稿独立成轨。
  一审不再有独立「待开庭/执行中」档（庭前准备含开庭、执行走执行轨）；二审不再有
  「二审审理/二审裁判」档。存量旧档位经 `normalizeStatusId` 自动归并（待开庭→庭前准备、
  审查中/二审审理→二审庭前/庭后、财产查控/处置/分配→执行中），存量案件不掉状态。
- **按案件自适应选轨与裁任务**：展开/体检按 案件 level（选轨）→ status（选阶段）
  → type + ourSide（裁任务）三级自适应。任务模板新增 `side`（原告/被告侧）与 `appliesTo`
  （案件类型）。一审模板按 docx 合并：开庭动作并入「庭前准备」组、裁判送达动作并入
  「庭后管理」组，`stageId` 参数可空（省略=自动展开当前阶段）。
- **备忘录 #14 审级历程缺信息**：register_case 建案即自动生成首个审级节点（原来不建 →
  面板常空）；节点回填 案号/法院/法官/立案日期 + **双方**当事人（原告/被告都从 parties
  抽取，不再只填我方一侧）；update_case 切审级追加节点同样双方齐全。
- **备忘录 #15 读取纪律省 token**：persona 新增——建案/补信息优先只读 案件信息.md，
  确需文书只读相关一份，不读证据册/扫描整册/视频音频/超大型文件，先 folder-search 定位。
- **备忘录 #16 任务面板「含已完成」默认关闭**：TaskManager 默认隐藏已完成，聚焦待办。
- **备忘录 #17 案由体系按 2026 案由规定重写**：CASE_CAUSES 按《民事案件案由规定》
  （2026-01-01 施行版）覆盖高频案由——民商含合同/公司/物权/侵权/婚姻家事等细分与新增
  数据/个人信息/网络虚拟财产纠纷；刑事按罪名、劳动含新就业形态用工、知产含数据权益等。
- **备忘录 #18 执行轨 A/B 双视角**：我方=申请执行人 展开申请/查控/回款/恢复；我方=被执行人
  展开 应对执行通知/核对执行金额/应对查封/执行异议/协商和解/终本后解除限高失信——不再照搬
  申请执行模板。
- **备忘录 #19 管家主动建任务**：register_case 响应内联返回 `nextStage`（当前阶段任务清单
  预览+提示）；persona 建案节硬规则——登记后立即 apply_stage_template 铺当前阶段任务并汇报，
  不等用户提醒。
- **GUI 状态数据源（vendor panel-ui）**：caseStatus.ts 阶梯与 shared playbook 同步 docx 档位
  + 存量归并；CaseDashboard 状态筛选菜单改为按审级联动显示完整阶梯（不再硬编码 5 档）。
- **测试**：新增 verify-adaptive-stages / verify-e2e-workflow / verify-exec-side /
  verify-instance-node；verify-optional-tasks / verify-seed-sync / verify-case-health /
  verify-owner-type 更新到 docx 语义；全量 14 个 verify 脚本通过。

## 0.2.3（2026-09-05）

### 备忘录 #10–#13（管家阶段智能 + 详情页精简 + 任务联动 + 案件记忆文件）

- **#10 任务模板去噪 + 管家阶段判定修复**：模板层把「收到触发才做的事」从固定
  任务改为 **optional 条件任务**——立案阶段删掉「计算并缴纳诉讼费」「领取受理
  通知书与举证通知书」两条噪音（缴费改为收到缴费通知后按需建；受理/举证通知书
  大多电子送达，改为「登记举证期限与开庭安排」，把举证期限落成关键日期而非
  「领取」任务）；庭后管理「分析上诉可行性/确认当事人上诉意向/提交上诉状」全部
  改为 optional，只有裁判对我方不利、确需评估上诉时才用 `only` 点名展开——我方
  全胜或调解结案的案件不再自动铺「上诉三件套」。stage-expansion 默认展开跳过
  optional（only 点名才建），预览同样过滤。**阶段判定**：把散落在「未分组」/自建
  组但 templateTitle 属本阶段模板的任务计入本阶段（管家直写 upsert_task 不再被
  误判成「阶段为空」而反复建议展开当前阶段）；case_health 阶段进度与建议共用
  同一判定。实测 2026-010：立案组 5/5 完成 → 正确建议展开「一审 · 庭前准备」。
  persona / 工具描述 / LITIGATION_GUIDANCE 同步「条件任务 + 电子送达 + 不铺上诉」
  指引；TASK_VERBS 增补「登记」。
- **#11 案件详情页概述精简**：右栏「案件概述」长文本默认折叠 3 行（line-clamp +
  内联 WebkitLineClamp 双保险），「展开全文/收起」切换，hover 露「编辑」。
- **#12 逾期/待办/紧急日程点击关联任务模块**：CaseDashboard（诉讼 + 非诉）顶部
  「N 项逾期 / N 项待办 / N 紧急日程」统计按钮原 onClick=onOpenCalendar 空实现
  → 现派发 `agentlex:open-task-panel`，任务管理 mount 监听后打开任务面板（面板
  互斥激活由既有 data-attr/CSS 保证），点击有实际反应。
- **#13 案件文件夹 案件信息.md 记忆文件**：file-service 增 writeTextFile（safeResolve
  约束 + 自动建父目录）与 readCaseInfoFile / ensureCaseInfoFile（兼容存量
  「案件信息.md」「案卷信息.md」两种叫法，新建统一「案件信息.md」并按登记信息
  生成骨架模板）；新增 `/api/agentlex-case/file-write` 与 `/api/agentlex-case/case-info`
  路由（read/ensure，caseId 自动解析 folder 或显式 path）；litigation 工具新增
  `case_info` action；persona「案件记忆文件」章节 + 工具描述 + LITIGATION_GUIDANCE
  指引管家：处理案件前先 case_info 读、没有则 ensure、有新进展用 file-write 同步
  补写。
- 验证：新增 scripts/verify-case-info.mjs、scripts/verify-optional-tasks.mjs 全过；
  既有 9 个 verify 脚本回归全过；3081 实测 case-health（2026-010 阶段推进建议）、
  case-info read/ensure、file-write E2E 通过。

## 0.2.2（2026-09-04）

### 备忘录新问题 5 项 + 字体（#6–#9 + 重复编号防护 + 卡片编号字体）

- **#6 新建案件拆双按钮**：表单按钮由单一「注册案件」改为「智能注册」（落库后跳
  agent 会话，由 agent 按 SOP 补全法院/法官/标的额等）与「普通注册」（仅落库、
  不跳会话，供纯手动登记）。CaseManager 新增 handleCaseSubmitPlain 分支，共用
  buildCaseEntry 纯函数；NewCaseModal 增加 onSubmitPlain prop 与双提交按钮。
- **#7 任务面板「全部」等数字基数 = 待办**：hero 时间排「全部 N」改为只计未完成
  任务（status ≠ done），不再把已完成混入待办基数。
- **#8 新建案件编号不被自动生成覆盖 + 重复编号防护**：NewCaseModal 之前每次打开/
  现有案件变化都会用 generateCaseId 重置编号 → 用户手填后也被改成自动号。现加
  caseIdTouchedRef 守卫：用户编辑过编号就不再自动分配（关闭重开才复位），自动
  生成仅在编号为空时。**重复编号绝不覆盖数据**：编号输入框下方即时红字提醒（已被
  哪个案件占用）、冲突时提交按钮禁用；`useAgentLex.addCase` 移除「冲突时静默回落
  update-case」的危险逻辑，改为一律抛错提示换号（服务端 register 冲突同样拦截），
  弹窗保持打开展示错误。
- **#9 日历点日弹窗点击外部自动关闭**：TaskManager 增加 document pointerdown 捕获
  ——弹层打开后点弹层外任意处（天格按钮除外）自动关闭，不再只能点 X。天格加
  `data-calday` 标记防误关。修复任务面板白屏：TaskManager 新用 useEffect 但 import
  遗漏 → 运行时 ReferenceError，补上 `useEffect` import。
- **案件卡片/详情页编号字体改微软雅黑**：案件总览卡片左轨编号（年份+序号）与案件
  详情页大标题编号由等宽 font-mono 改为微软雅黑（内联 fontFamily 保证生效）。

### 存储：task-groups.json 退役，并入 items.json（单文件单源）

- `items.json` 文档扩为 `{ groups: [...], items: [...] }`：任务组（阶段）壳与
  任务/事件正文同文件存储，磁盘上不再有第二套任务数据文件。
- 启动自动迁移旧 `task-groups.json` → `items.json.groups`（按 id 去重、已存在优先，
  补 ownerType），成功后旧文件改名 `.legacy` 退役。
- 读入兼容：旧 items.json（只有 items、无 groups 键）读写自动归一化，升级不断档。

### 老数据彻底下岗：一次性并库迁移（启动自动，磁盘标记只跑一次）

- `merge-legacy.ts`（诉讼）+ `merge-legacy.ts`（非诉）：把 case-registry 每案
  残留的 taskGroups 镜像（组 + 任务正文，含 deadline/time/subtasks/checklist/
  keyDateId）与 case-timeline.json 旧事件并入 items（按 id 去重、只补不覆盖，
  零丢失）。
- 迁移成功后剥离 registry 每案的 taskGroups（registry 只留案件元信息 + keyDates），
  case-timeline.json 改名 `.legacy` 退役。
- 迁移前先做数据快照（~/.dsh/agentlex-backups/），失败仅告警不致命、可重试。

### 读侧统一（不再从 registry taskGroups 计数/判存在）

- `/api/agentlex/read`（suite）、`/read-case`、legacy `/read-case`、`get_case`：
  任务组一律从 items 实时聚合（含未分组兜底，组行 name+title 双写兼容 health 与旧 GUI）。
- `case_health` / `stage_suggestions` / `update_case` 同回合建议：先重建 items 任务
  视图再计算 → **修复「展开任务成功但体检阶段任务数=0、反复建议展开当前阶段」**。
- `planStageExpansion` 已存在/已展开判断改读 items（幂等判断与写路径同源）。

### 写侧统一（全部落 items）

- litigation 原生路由 `/group /delete-group /reorder-groups /move-task /subtask
  /checklist /check` 的 itemStore 分支补全；`/set-task-keydate` 任务本体写 items、
  keyDates（案件字段）仍归 case-store 维护、item 记 keyDateId 链接。
- legacy-compat GUI 写路由（诉讼 + 非诉）：组/任务/子任务/检查项增删改、
  移动、排序全部改 itemStore → **修复 GUI 勾子任务/检查项写回旧库再分裂**；
  时间轴事件 add/update/delete/toggle 也改 items。
- 非诉原生路由同款 items 化（group/reorder/task/move/subtask/check/add-checklist/
  delete-checklist/health/stage）。
- 任务域写穿 `/api/agentlex-task/task`（source=litigation/nonlitigation）改
  upsertItem（items），`delete-task` 同步按 source 走 items 删除 → 任务面板勾选
  状态/编辑真正落到统一事项。
- 导入工具（AgentLex 迁移）：案件任务搬入 items（不再写 registry taskGroups），
  事件照旧入 items。

### 其他

- 工具/路由任务 upsert 补 groupName/templateTitle 溯源（幂等展开依据完整）。
- deleteGroup 一并清理组内任务（0.2.2 store 语义），删组不留孤儿。
- 验证：新增 `scripts/verify-unified-022.mjs`（并库/单文件/退役/展开→体检全链路），
  全量既有 verify 脚本回归通过；真实 live 数据克隆演练通过（2026-015 展开后
  体检阶段任务数=5、dryRun 正确跳过已存在 5 条）。

---
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