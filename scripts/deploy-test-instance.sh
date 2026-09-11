#!/usr/bin/env bash
#
# 一键「构建 → 打包 → 部署到测试实例 → 重启」。
#
# ⚠ 这个脚本存在的理由：2026-09-11 我连着两次因为 `pnpm run build | grep ...`
# 的管道把构建错误吞掉，打包失败后**静默部署了旧 tarball**，用户看到的还是老
# 行为。所以这里每一步都必须显式成功，任一失败立即退出，绝不留半成品。
#
# 用法：bash scripts/deploy-test-instance.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROFILE="${DSH_TEST_PROFILE:-agentlex-ls-test}"
PORT="${DSH_TEST_PORT:-3081}"
LOG="${DSH_TEST_LOG:-/tmp/dsh-${PORT}.log}"
cd "$ROOT"

step() { printf '\n\033[1m== %s\033[0m\n' "$1"; }

step "1/5 构建（失败即停）"
if ! pnpm run build > /tmp/agentlex-build.log 2>&1; then
  echo "构建失败 —— 后面不再执行。日志尾部："
  tail -30 /tmp/agentlex-build.log
  exit 1
fi
tail -3 /tmp/agentlex-build.log

# 构建成功也再确认产物真的在（防止「命令成功但没写文件」）。
test -f client/client.js || { echo "构建未产出 client/client.js"; exit 1; }

step "2/5 校验产物已含本轮改动（按你给的 --expect 串）"
if [ "$#" -gt 0 ]; then
  for needle in "$@"; do
    if ! grep -qF -- "$needle" client/client.js; then
      echo "产物里找不到：$needle —— 大概率改动没进 bundle，停止部署。"
      exit 1
    fi
    echo "  ✓ $needle"
  done
fi

step "3/5 打包"
pnpm pack --pack-destination /tmp > /tmp/agentlex-pack.log 2>&1 || { tail -20 /tmp/agentlex-pack.log; exit 1; }
TARBALL="/tmp/dsh-legal-suite-$(node -p "require('./package.json').version").tgz"
test -f "$TARBALL" || { echo "没找到 tarball：$TARBALL"; exit 1; }
echo "  $TARBALL"

step "4/5 部署到测试 profile（$PROFILE）"
DEST="$HOME/.dsh/profiles/$PROFILE/node_modules/dsh-legal-suite"
test -d "$DEST" || { echo "测试 profile 未安装本插件：$DEST"; exit 1; }
tar -xzf "$TARBALL" -C "$DEST" --strip-components=1

step "5/5 重启测试实例（端口 $PORT）"
lsof -tiTCP:"$PORT" -sTCP:LISTEN | xargs kill 2>/dev/null || true
sleep 2
cd "$HOME/.dsh/profiles/$PROFILE"
nohup dsh --profile "$PROFILE" --port "$PORT" --no-open > "$LOG" 2>&1 &
sleep 12

TOKEN="$(grep -o 'token=[A-Za-z0-9_-]*' "$LOG" | head -1 | cut -d= -f2 || true)"
CODE="$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT/" || true)"
printf '\n测试实例：http://127.0.0.1:%s/?token=%s  (HTTP %s)\n' "$PORT" "$TOKEN" "$CODE"
echo "（桌面浏览器打开上面这个带 token 的地址即可验收）"
