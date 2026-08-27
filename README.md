# AgentLex Legal Suite

法律事务 DSH（DeepSeek Harness）插件：**诉讼案件 · 非诉项目 · 任务中心 · 皮肤 · 工作区右边栏** 合一的单包插件。

- **单包架构**：一个 entry、一个版本，无任何外部私有依赖；发布到公共 npm registry。
- **双端一体**：宿主侧（cordis 服务：数据存储 / HTTP 路由 / 期限引擎）与浏览器侧（面板 UI / client bundle）随同一 tarball 交付。
- **数据本地**：案件数据存于 `$DSH_HOME/agentlex/`，不依赖外部服务。

> 包名与服务标识目前使用惯例占位 `dsh-legal-suite`；正式开源发布前如果确定新的包名/scope，只需在 `package.json`（name）、`src/**`（`dsh-legal-suite/…` 运行时标识字符串，见下）与 `cordis.patch.yml` 中统一替换即可。

## 功能

| 域 | 说明 |
|---|---|
| 诉讼案件 | 案件登记 / 当事人 / 案由 / 法院 / 标的 / 进度，任务树（阶段→任务→子任务→检查项），时间轴（开庭 / 举证 / 上诉等节点与期限提醒），日程 |
| 非诉项目 | 项目 / 检查项管理 |
| 任务中心 | 任务看板与多形态视图 |
| 皮肤 | 品牌 / 侧边栏 / 主题（`/api/agentlex-skin/config`） |
| 工作区右边栏 | 目录树 / 文件预览 / Monaco 编辑 / 搜索 |
| 技能工具 | skills-tools 域（套件聚合入口） |

自更新：设置页可检测公共 npm registry 上的最新版，经 pnpm 一键升级（完成后重启 DSH 生效）。
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

```bash
pnpm build
pnpm publish            # 公共 npm（.npmrc 已指向 registry.npmjs.org）
```

## License

[GPL-3.0](./LICENSE)