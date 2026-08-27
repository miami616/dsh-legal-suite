# Changelog

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