# AgentLex Legal Suite

[![npm version](https://img.shields.io/npm/v/dsh-legal-suite.svg?style=flat-square)](https://www.npmjs.com/package/dsh-legal-suite)
[![npm downloads](https://img.shields.io/npm/dm/dsh-legal-suite.svg?style=flat-square)](https://www.npmjs.com/package/dsh-legal-suite)
[![GitHub release](https://img.shields.io/github/v/release/miami616/dsh-legal-suite.svg?style=flat-square)](https://github.com/miami616/dsh-legal-suite/releases)
[![License: GPL-3.0](https://img.shields.io/badge/License-GPL--3.0-blue.svg?style=flat-square)](./LICENSE)
[![GitHub Repo](https://img.shields.io/badge/GitHub-miami616%2Fdsh--legal--suite-181717.svg?logo=github&style=flat-square)](https://github.com/miami616/dsh-legal-suite)

**AI 驱动的法律行业案件管理与 Agent 工具** —— 面向律师与法律工作者的智能工作台，运行于 DeepSeek Harness（DSH）之上。

AgentLex Legal Suite 不是传统意义上的"案件台账软件"，而是一套**以 AI Agent 为核心**的法律事务操作系统：案件数据、任务树、期限引擎与 Agent 预设深度耦合，让模型能直接读写案件、盯防期限、落盘文书，把"记录案件"升级为"AI 帮你办案"。

- **Agent 驱动**：内置「诉讼管家」「非诉管家」专属 Agent 预设，模型可直接调用案件工具完成查询 / 登记 / 更新 / 期限盯防，工具变更实时刷新界面。
- **单包架构**：一个 entry、一个版本，无任何外部私有依赖；发布到公共 npm registry。
- **双端一体**：宿主侧（cordis 服务：数据存储 / HTTP 路由 / 期限引擎）与浏览器侧（面板 UI / client bundle）随同一 tarball 交付。
- **数据本地**：案件数据存于 `$DSH_HOME/agentlex/`，不依赖外部服务，隐私可控。

> 包名与服务标识目前使用惯例占位 `dsh-legal-suite`；正式开源发布前如果确定新的包名/scope，只需在 `package.json`（name）、`src/**`（`dsh-legal-suite/…` 运行时标识字符串，见下）与 `cordis.patch.yml` 中统一替换即可。

## 为什么是 Agent 驱动？

传统案件管理工具要求律师手动录入、手动翻台账、手动记期限。AgentLex 把 AI 放进办案流程：

- **自然语言办案**：直接对 Agent 说"登记一起买卖合同纠纷""下周开庭的案子有哪些""举证期还剩几天"，模型自动完成数据读写。
- **期限智能盯防**：任务树中的关键日期可一键生成提醒，时间轴自动汇总近期到期事项，法定期限不再靠人脑记。
- **文书自动落盘**：Agent 可调用文件工具把报告、起诉状、答辩状直接写入工作目录或桌面。
- **技能与 MCP 扩展**：内置技能管理（上传 / 解析 / 启停）与 MCP 热加载，随时接入更多法律数据源与工具。

## 功能

| 域 | 说明 |
|---|---|
| 诉讼案件 | 案件登记 / 当事人 / 案由 / 法院 / 标的 / 进度，任务树（阶段→任务→子任务→检查项），时间轴（开庭 / 举证 / 上诉等节点与期限提醒），日程 |
| 非诉项目 | 项目 / 检查项管理 |
| 任务中心 | 任务看板与多形态视图 |
| 皮肤 | 品牌 / 侧边栏 / 主题（`/api/agentlex-skin/config`） |
| 工作区右边栏 | 目录树 / 文件预览 / Monaco 编辑 / 搜索 |
| 技能工具 | 技能落盘 + MCP 热加载 + CRUD 路由（套件聚合入口） |

### Agent 预设

随包发布两个专属 Agent，安装后自动装入 `$DSH_HOME/.agent-presets/`：

- **诉讼管家**：专属诉讼案件管理助手——查询 / 登记 / 更新案件、维护当事人与案由、安排任务树、盯防关键日期与期限、记录时间轴节点，并挂载文件读写 / 目录访问工具以便落盘产出文档。
- **非诉管家**：专属非诉项目管理助手，覆盖项目 / 合同 / 研究 / 常法场景。

## 自更新

设置页可检测公共 npm registry 上的最新版，经 pnpm 一键升级（完成后重启 DSH 生效）。
版本检测走 Node `fetch` 直连 registry（不读取 shell 代理变量）；部署在必须经代理访问 npm 的环境时，请以 `pnpm config set proxy/https-proxy` 或全局 agent 保证出网（升级本身由 pnpm 完成，跟随其网络配置）。

## 安装

```bash
# 在目标 DSH profile 中安装
dsh plugin --profile <name> add dsh-legal-suite
# 或手动：把 "dsh-legal-suite" 加入 profile package.json 的 dependencies，
# 并在 dsh.profile.bundles 列表追加 dsh-legal-suite
```

安装后（首次启动）自动把 `presets/` 下的 agent 预设（诉讼管家 / 非诉管家）装入 `$DSH_HOME/.agent-presets/`；也可手动补装：

```bash
node node_modules/dsh-legal-suite/scripts/install-suite-presets.mjs
```

## 开发

```bash
corepack enable && pnpm install     # pnpm 版本见 packageManager
pnpm build                          # tsc（lib/）+ tsdown（client/）+ banner 规范化
pnpm typecheck
pnpm pack --dry-run                  # 发布前核对 tarball 内容
```

构建产物约定：

- `lib/` — 宿主侧编译产物（tsc）
- `client/` — 浏览器侧单文件 bundle（tsdown + rolldown）
- `vendor/` — 两个内置 UI 渲染层（业务面板层 / 工作区右边栏层）的自包含快照，**不进 tarball**（`files` 白名单排除）
- `presets/` — agent 预设，随包发布

## 发布

本项目为开源项目，托管于 GitHub：[miami616/dsh-legal-suite](https://github.com/miami616/dsh-legal-suite)，发布到公共 npm registry。

### 发布到 npm

```bash
pnpm build
pnpm publish            # 公共 npm（.npmrc 已指向 registry.npmjs.org）
```

### 打 GitHub Release

```bash
git tag v0.1.2
git push origin v0.1.2
```

在 [GitHub Releases 页面](https://github.com/miami616/dsh-legal-suite/releases) 填写版本说明并发布。

## License

[GPL-3.0](./LICENSE)
