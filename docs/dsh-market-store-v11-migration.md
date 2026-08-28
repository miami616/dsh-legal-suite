# DSH 插件市场更新失败 `ERR_PNPM_UNEXPECTED_STORE` —— 根因与一劳永逸迁移方案（已复核修正）

> 目标读者：负责执行迁移的其它 agent / 维护人员。
> ⚠️ 本文档已按「再次失败」的实测结果修正：**早期用 `.npmrc` 改 `store-dir` 的止血方案无效**（pnpm 11 忽略 `.npmrc` 的 `store-dir`），正确做法是**用 CLI 参数重新链接 store**。

---

## 一、问题现象

DSH 插件市场更新 `@changfenhuang/dsh-genui` 失败，报：

```
[error] update: @changfenhuang/dsh-genui -> @changfenhuang/dsh-genui@latest
        exit=1  err=ERR_PNPM_UNEXPECTED_STORE: Unexpected store location
```

日志：`/Users/mee/Downloads/dsh-market-log.txt`；`dsh-market: 1.31.2`；`profile: web`；错误堆栈里的 pnpm 为 homebrew `/opt/homebrew/Cellar/pnpm/11.22.0`。

> 尝试过 `.npmrc` 里写 `store-dir=/Users/mee/Library/pnpm/store/v10` 后**仍然失败**——这恰恰证实了下面第二节的关键机制。

---

## 二、根因分析（已确诊并实测验证）

### 直接原因
`node_modules` 是由 **pnpm store v10** 物化的（`.modules.yaml` 记 `storeDir=/Users/mee/Library/pnpm/store/v10`），而 dsh-market 调用的 **pnpm 11.22.0** 默认使用 **store v11**（`~/Library/pnpm/store/v11`，失败更新当天 12:50 新建）。pnpm 11 的 `checkCompatibility` 发现两者 store 不一致，拒绝任何 add/remove，抛 `ERR_PNPM_UNEXPECTED_STORE`。

### 关键机制（为何 `.npmrc` 止血无效）—— 实测确认
pnpm 11 的 store 解析规则：
1. **`store-dir` 写在项目 `.npmrc` 里会被完全忽略**。实测：在目录建 `.npmrc` 写 `store-dir=...` 后，`pnpm store path` 仍返回默认路径。
2. **只有命令行 `--config.store-dir=<path>` 才生效**。实测：`pnpm store path --config.store-dir=/tmp/x` → `/tmp/x/v11`。
3. 无 flag 时，pnpm 11 默认 store 为 **CWD 相对的 `.pnpm-store/v11`**（空目录下 `pnpm store path` → `<cwd>/.pnpm-store/v11`）。
4. 但 dsh-market 的 pnpm 实际用的是**全局默认 `~/Library/pnpm/store`**（该目录下已存在 `v10` 与 `v11`，`v11` 由市场失败运行创建）→ 说明市场侧 pnpm 解析到了 `~/Library/pnpm/store` 这个 store 根，并按布局版本追加 `/vN`。

> 结论：**不是 genui 插件、不是网络、也不是 registry 问题，而是 pnpm store 布局版本迁移（v10→v11）不兼容**。且 pnpm 11 只认 CLI 的 `--store-dir`，`.npmrc`/环境里改 store-dir 都无效——所以任何「改配置」的止血都治标不治本，必须**重新链接**。

---

## 三、正确修复方向（重新链接 store 到 v11）

dsh-market 源码（`node_modules/dshmarket/lib/pnpm-compat.js`，注释 #244）对同一错误给出的官方恢复方法（中文翻译）：

> 这个 profile 的 node_modules 链接到的 pnpm store，和当前 pnpm 默认使用的 store 不是同一个，pnpm 因此拒绝所有安装与卸载。**在 profile 目录里执行一次 `pnpm install --store-dir <上面第一个路径>` 重新链接即可**（dsh 运行时可能占用文件，必要时先退出 dsh）。

即：**把 node_modules 重新链接到 pnpm 现在实际使用的 store（v11）**，让 `.modules.yaml` 的 `storeDir` 变成 `.../store/v11`，与市场 pnpm 默认一致。

---

## 四、一劳永逸迁移步骤（迁移到 v11 store）

> ⚠️ **硬性前置规则（血泪教训）**：**绝不对正在运行的 DSH live profile 执行 `pnpm install`**。迁移前必须**停止所有运行该 profile 的 DSH 进程**（`dsh web` 3080 与 `DSH Desktop.app` 共享 `~/.dsh/profiles/web/node_modules`），否则可能改写 `.modules.yaml` 破坏 hoisted 布局、导致服务/网关崩溃。

### 步骤 0：备份（必做）
```bash
cd ~/.dsh/profiles/web
TS=$(date +%Y%m%d-%H%M%S)
cp -p .npmrc              .npmrc.bak.$TS
cp -p pnpm-lock.yaml      pnpm-lock.yaml.bak.$TS
cp -p package.json        package.json.bak.$TS
cp -p pnpm-workspace.yaml pnpm-workspace.yaml.bak.$TS
cp -p node_modules/.modules.yaml .modules.yaml.bak.$TS
# 可选但最稳妥：完整备份 node_modules
# cp -a node_modules node_modules.bak.$TS
```

### 步骤 1：停止所有共享该 profile 的 DSH 进程
```bash
# 停 dsh web(3080)
lsof -nP -iTCP:3080 -sTCP:LISTEN
kill <web_pid>
# 停 DSH Desktop（若在跑）
pkill -f "DSH Desktop" 2>/dev/null
# 确认无残留进程读写该 profile 的 node_modules
pgrep -fl "dsh|ds-market" | grep -v grep
```

### 步骤 2：重新链接 store 到 v11（核心修复）
```bash
cd ~/.dsh/profiles/web
pnpm install --store-dir /Users/mee/Library/pnpm/store/v11
```
- 该命令让 pnpm 以 v11 store 重装/重链 node_modules，`.modules.yaml` 的 `storeDir` 将变为 `.../store/v11`，与市场 pnpm 默认一致。
- 若因旧 lockfile/store 版本残留仍报错，则先清空虚拟 store 再装：
  ```bash
  rm -rf node_modules/.pnpm
  pnpm install --store-dir /Users/mee/Library/pnpm/store/v11
  ```
  （`pnpm-workspace.yaml` 用 `nodeLinker: hoisted`，重装后保持 hoisted 布局。）

### 步骤 3：验证
```bash
cd ~/.dsh/profiles/web
grep storeDir node_modules/.modules.yaml   # 期望 .../store/v11
ls node_modules/@changfenhuang/dsh-genui/package.json
ls node_modules/dsh-legal-suite/package.json
ls node_modules/dsh-mnemon/package.json
```

### 步骤 4：重启 DSH 并回归
```bash
# 按惯用方式启动 dsh web（恢复 3080）
```
回归：
1. `127.0.0.1:3080` GUI 正常，插件市场 bundles 全部 `ok`。
2. 对 `@changfenhuang/dsh-genui` 点「更新」，确认不再报 `ERR_PNPM_UNEXPECTED_STORE`。
3. 抽查核心插件（dsh-legal-suite / dsh-mnemon / dsh-passwords）功能正常。

### 步骤 5（可选）：清理
- 确认无其它 profile 还用 v10（`grep -rl "store/v10" ~/.dsh/profiles/*/node_modules/.modules.yaml`）后，再决定是否清理 `/Users/mee/Library/pnpm/store/v10` 与迁移临时备份。

---

## 五、回滚方案

```bash
cd ~/.dsh/profiles/web
# 还原备份
cp .npmrc.bak.$TS .npmrc
cp pnpm-lock.yaml.bak.$TS pnpm-lock.yaml
cp pnpm-workspace.yaml.bak.$TS pnpm-workspace.yaml
# 若曾备份 node_modules
# rm -rf node_modules && cp -a node_modules.bak.$TS node_modules
# 重启 DSH 验证
```

---

## 六、参考资料

- 日志：`/Users/mee/Downloads/dsh-market-log.txt`
- profile：`~/.dsh/profiles/web/`
- store 根：`/Users/mee/Library/pnpm/store/`（含 `v10`、`v11`）
- pnpm：homebrew `pnpm 11.22.0`（`/opt/homebrew/bin/pnpm`）
- 市场恢复逻辑源码：`~/.dsh/profiles/web/node_modules/dshmarket/lib/pnpm-compat.js`（#244）
- 涉及共享 profile 的实例：`dsh web`(127.0.0.1:3080)、`DSH Desktop.app`(harness 与 `~/.dsh/profiles/web` 同源)
