# Changelog

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