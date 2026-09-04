/**
 * Verify the 案件信息.md memory-file machinery (备忘录 #13):
 *  1. readCaseInfoFile finds nothing on an empty folder (name null).
 *  2. ensureCaseInfoFile creates 案件信息.md from the seed, idempotently
 *     (second ensure returns the same file, created=false).
 *  3. 存量「案卷信息.md」也被识别（候选名兼容），且不会重复新建 案件信息.md.
 *  4. writeTextFile can overwrite content & writes under nested dirs.
 *
 * Run: node scripts/verify-case-info.mjs
 */
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  readCaseInfoFile,
  ensureCaseInfoFile,
  writeTextFile,
  CASE_INFO_DEFAULT_FILE,
} from '../lib/domains/litigation/file-service.js'

let failures = 0
function check(name, cond, extra = '') {
  const ok = Boolean(cond)
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? `  (${extra})` : ''}`)
  if (!ok) failures++
}

const dir = await mkdtemp(join(tmpdir(), 'ls-caseinfo-'))
try {
  const seed = {
    caseId: '2026-099', caseName: '甲诉乙合同纠纷', type: '民商', cause: '合同纠纷',
    statusLabel: '立案中', level: '一审', caseNumber: '（2026）鲁01民初9号', court: '济南市历下区人民法院',
  }

  // 1. empty folder → read returns null
  const empty = await readCaseInfoFile(dir)
  check('空文件夹 read → name:null', empty.name === null, String(empty.name))

  // 2. ensure creates with template + idempotent
  const created = await ensureCaseInfoFile(dir, seed)
  check('ensure 新建文件', created.created === true && created.name === CASE_INFO_DEFAULT_FILE, created.name ?? '')
  check('模板含编号与名称', created.content.includes('2026-099') && created.content.includes('甲诉乙合同纠纷'), '')
  const again = await ensureCaseInfoFile(dir, seed)
  check('重复 ensure 幂等（不重建）', again.created === false && again.content === created.content, '')
  check('read 命中新建文件', (await readCaseInfoFile(dir)).name === CASE_INFO_DEFAULT_FILE, '')

  // 3. 存量「案卷信息.md」候选名兼容
  const dir2 = join(dir, 'legacy-folder')
  await mkdir(dir2, { recursive: true })
  await writeFile(join(dir2, '案卷信息.md'), '# 案卷信息\n\n老格式', 'utf8')
  const legacyRead = await readCaseInfoFile(dir2)
  check('识别存量 案卷信息.md', legacyRead.name === '案卷信息.md' && legacyRead.content.includes('老格式'), legacyRead.name ?? '')
  const legacyEnsure = await ensureCaseInfoFile(dir2, seed)
  check('存量存在时不新建 案件信息.md', legacyEnsure.created === false && legacyEnsure.name === '案卷信息.md', legacyEnsure.name ?? '')

  // 4. writeTextFile overwrite + nested dirs
  const nestedRel = '子目录/深一层/记录.md'
  const wrote = await writeTextFile(dir, nestedRel, '内容A')
  check('写嵌套文件成功', wrote.ok === true && wrote.name === '记录.md', wrote.name)
  const reread = await readCaseInfoFile(dir)
  check('覆盖写不污染记忆文件', reread.name === CASE_INFO_DEFAULT_FILE, reread.name ?? '')
  await writeTextFile(dir, nestedRel, '覆盖后内容')
  const { readFile } = await import('node:fs/promises')
  const finalContent = await readFile(join(dir, nestedRel), 'utf8')
  check('覆盖写生效', finalContent === '覆盖后内容', finalContent)

  console.log(`\n${failures === 0 ? 'ALL PASS' : `${failures} FAILURE(S)`}`)
  process.exit(failures === 0 ? 0 : 1)
} finally {
  await rm(dir, { recursive: true, force: true })
}
