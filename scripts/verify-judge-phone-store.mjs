/**
 * 备忘 #31 字段写路径实测 —— 在**临时目录**里跑一遍 register → read → update，
 * 不碰用户真实卷宗数据（$DSH_HOME/agentlex/litigation）。
 *
 *   node scripts/verify-judge-phone-store.mjs
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createCaseStore } from '../lib/domains/litigation/store/case-store.js'

let failures = 0
const check = (name, cond, extra = '') => {
  const ok = Boolean(cond)
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? `  (${extra})` : ''}`)
  if (!ok) failures++
}

const dir = mkdtempSync(join(tmpdir(), 'agentlex-judge-phone-'))
try {
  const store = createCaseStore(dir)
  const created = await store.registerCase({
    caseId: '2099-001',
    name: '法官电话字段实测案',
    type: '民商',
    court: '测试人民法院',
    judge: '测试法官',
    judgePhone: '0531-12345678',
    level: '一审',
  })
  check('registerCase 落库 judgePhone', created.judgePhone === '0531-12345678', String(created.judgePhone))

  const reread = await store.readCase('2099-001')
  check('readCase 读回 judgePhone', reread?.judgePhone === '0531-12345678', String(reread?.judgePhone))

  const updated = await store.updateCase('2099-001', { judgePhone: '0531-87654321' })
  check('updateCase 改写 judgePhone', updated.judgePhone === '0531-87654321', String(updated.judgePhone))

  const after = await store.readCase('2099-001')
  check('改写后读回一致', after?.judgePhone === '0531-87654321', String(after?.judgePhone))
  check('同案其他字段未被破坏', after?.judge === '测试法官' && after?.court === '测试人民法院')
} finally {
  rmSync(dir, { recursive: true, force: true })
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILED`)
process.exit(failures === 0 ? 0 : 1)
