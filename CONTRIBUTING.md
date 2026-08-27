# 贡献指南

欢迎为 AgentLex Legal Suite 贡献代码、文档或建议！以下是参与方式。

## 开发环境

```bash
corepack enable && pnpm install   # 安装依赖（pnpm 版本见 packageManager）
pnpm build                        # tsc（lib/）+ tsdown（client/）+ banner 规范化
pnpm typecheck                    # 类型检查
```

> 注意：`pnpm typecheck` 会包含 `client/` 与 `vendor/` 下部分文件，其中一些历史类型警告不影响 `build` 与发布（`tsconfig.build.json` 已排除 client 侧）。

## 提交规范

提交信息建议遵循 [Conventional Commits](https://www.conventionalcommits.org/)：

- `feat: ...` 新功能
- `fix: ...` 缺陷修复
- `docs: ...` 文档
- `refactor: ...` 重构
- `chore: ...` 杂项

## 分支与 PR 流程

1. 从 `main` 新建功能分支
2. 完成改动并本地验证（`pnpm typecheck`、`pnpm build`）
3. 提交并推送分支
4. 提交 Pull Request，填写 [PR 模板](../../.github/pull_request_template.md)

## 目录结构

```
src/            # 宿主侧源码（cordis 插件）
  domains/      # 业务域（litigation / nonlitigation / task / skin / workspace-sidebar / skills-tools）
client/         # 浏览器侧 bundle（构建产物）
lib/            # 宿主侧编译产物（构建产物）
presets/        # agent 预设（诉讼管家 / 非诉管家）
vendor/         # 内置 UI 渲染层快照（自包含，不进 tarball）
scripts/        # 构建辅助脚本
```

## 代码规范

- TypeScript strict 模式
- 遵循项目现有的代码风格与结构
- 新功能请同步更新 README（如适用）

## 行为准则

请保持友善、专业，尊重所有参与者。
