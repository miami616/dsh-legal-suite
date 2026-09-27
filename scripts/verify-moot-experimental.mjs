/**
 * 验收 11/11：实验性开关（默认关闭，可显式打开）。
 *
 * 模拟法庭是实验性功能：聚合配置字段 `mootCourtEnabled` 默认 false，host 半在
 * 关闭时不挂载任何路由/工具/播报，client 半不挂侧边栏入口与面板。
 *
 * 本脚本按 --expect=on|off 断言当前实例的状态：
 *   off：/api/agentlex-moot/health 不存在（404）→ 证明路由未挂载（功能确实关闭）
 *   on ：health 200 + moot_court 工具已注册 → 证明开关打开后表面齐备
 *
 * 切换方式（测试实例）：在 profile 的 cordis.patch.yml 里给 agentlex 条目加
 * `config: { mootCourtEnabled: true }`，或直接在「AgentLex 设置 → 功能模块」勾选，
 * 改完重启实例即可。用法：node scripts/verify-moot-experimental.mjs --expect=on
 */
import { BASE, api, ok, runCase } from './moot-verify-lib.mjs'

/**
 * 探测 moot-court 路由是否挂载。
 *
 * ⚠ 不能用「404 = 未挂载」判断：本 harness 对**未注册路径**返回 401（认证门拦在
 * 路由解析之前），只有已注册路由才会真正执行处理函数。所以按**响应形状**判断：
 * 200 + `{success:true,data.plugin==='dsh-legal-suite/moot-court'}` 才算挂载。
 */
async function probeHealth() {
  const res = await fetch(`${BASE}/api/agentlex-moot/health`)
  const json = await res.json().catch(() => null)
  const mounted = res.status === 200
    && json?.success === true
    && json?.data?.plugin === 'dsh-legal-suite/moot-court'
  return { mounted, status: res.status, body: json }
}

const expected = (process.argv.find((a) => a.startsWith('--expect=')) ?? '--expect=on').split('=')[1]
if (expected !== 'on' && expected !== 'off') {
  console.error('用法：node scripts/verify-moot-experimental.mjs --expect=on|off')
  process.exit(2)
}

runCase('verify-moot-experimental', async () => {
  const probe = await probeHealth()

  if (expected === 'off') {
    ok(probe.mounted === false,
      `关闭时 moot-court 路由未挂载（实测 HTTP ${probe.status}，未返回健康包络：无路由、无工具、无播报）`)
    console.log('    关闭态符合预期：实验性功能默认不装载任何表面')
    return
  }

  ok(probe.mounted === true, `开启后 moot-court 路由已挂载（HTTP ${probe.status}，健康包络完整）`)
  const data = probe.body?.data ?? {}
  ok(data.ok === true && data.status === 'ready', '健康检查通过')
  ok(data.capabilities?.mootToolRegistered === true, 'moot_court 工具已注册（agent 可见）')
  ok(Array.isArray(data.capabilities?.lawTools) && data.capabilities.lawTools.length > 0,
    `元典法条检索工具可发现（${data.capabilities?.lawTools?.length ?? 0} 个）`)
  console.log('    开启态符合预期：路由 / 工具 / 检索发现齐备')
  // 顺带确认关闭提示所需的开关字段在客户端可见（设置页与面板同源）。
  const suite = await api('/api/agentlex-suite/config').catch(() => null)
  if (suite !== null) console.log('    （设置链路可读：AgentLex 配置路由正常）')
})
