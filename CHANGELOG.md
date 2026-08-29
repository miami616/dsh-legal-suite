# Changelog

## 0.1.9（2026-08-29）

诉讼管家 upsert 语义修复 + 内置参考用例 + 任务模块双向同步。

- **upsert 契约统一**：`upsert_group` / `upsert_task` / `upsert_subtask` / `upsert_check` 统一为「id 存在则更新，不存在（或省略 id）则新建——显式 id 按该 id 创建」。此前 `upsert_subtask` / `upsert_check` 传入不存在的 id 会**静默 no-op**（返回 `ok:true` 但数据未落盘），`upsert_task` 会抛 `TypeError`，`upsert_group` 会抛「task group not found」，均违背 upsert 语义
- **新建字段透传**：`upsert_subtask` / `upsert_check` 新建时补全 `detail` / `deadline` / `done` 字段透传（此前被丢弃）
- **工具参数说明修正**：`subtaskId` / `checklistId` 改为「可选——省略则自动生成 id（`sub-`/`chk-` 前缀）；delete/toggle 类仍必填已有 id」，消除「按文档用必错」陷阱
- **内置参考用例**：全新安装（空数据目录）时自动播种一份信息完整的诉讼参考案件（买卖合同纠纷：当事人/标的/法院/任务树/子任务/检查项/关键日期/时间轴/日程）与一份非诉参考项目（常法服务：任务树/关键日期/服务记录），新用户开箱即见完整演示；仅空 registry 播种一次，绝不覆盖已有数据
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