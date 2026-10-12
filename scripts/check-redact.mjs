#!/usr/bin/env node
/**
 * 脱敏引擎自测（纯 node，跑 lib 产物）。
 *
 * 语料纪律：全部 fixtures 为**合成**数据（假姓名/测试号），可入 git；
 * 真实卷宗抽样另跑本地脚本，语料路径进 .gitignore。
 *
 * 用法：npx tsc -p tsconfig.build.json && node scripts/check-redact.mjs
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  collectRuleSpans, isValidCreditCode, isValidIdCard, maskPhone,
} from '../lib/domains/redact/engine/rules.js'
import { redactText, restoreText } from '../lib/domains/redact/engine/redact.js'
import { collectCandidates } from '../lib/domains/redact/engine/heuristic.js'
import { readTextFile, BinaryFileError } from '../lib/domains/redact/files.js'

let passed = 0
let failed = 0
const failures = []

function check(name, condition, detail = '') {
  if (condition) { passed += 1; return }
  failed += 1
  failures.push(`${name}${detail === '' ? '' : ` — ${detail}`}`)
}

function eq(name, actual, expected) {
  check(name, actual === expected, `实际=${JSON.stringify(actual)} 期望=${JSON.stringify(expected)}`)
}

/** 合成词条。 */
const entry = (value, kind, scope = 'global', source = 'test', note) =>
  ({ value, kind, scopes: [scope], source, ...(note === undefined ? {} : { note }) })

/* ---------------------------------------------------------------- 层① 规则 */
const VALID_ID = '11010519491231002X'
const INVALID_ID = '110105194912310021'
const VALID_CC = '91350100M000100Y43'

check('身份证校验位：真号通过', isValidIdCard(VALID_ID))
check('身份证校验位：改校验位即不通过', !isValidIdCard(INVALID_ID))
check('信用代码校验位：真号通过', isValidCreditCode(VALID_CC))
eq('手机号掩码', maskPhone('13812345678'), '138****5678')

{
  const text = `身份证 ${VALID_ID}，手机 13812345678。`
  const spans = collectRuleSpans(text)
  const kinds = spans.map((s) => s.kind).sort()
  eq('规则命中类别', kinds.join(','), 'idCard,phone')
  eq('身份证掩码形态', spans.find((s) => s.kind === 'idCard').replacement, '110***********002X')
}
{
  const text = `伪造号 ${INVALID_ID} 不应命中`
  eq('无效身份证零误报', collectRuleSpans(text).length, 0)
}
{
  const withoutContext = collectRuleSpans('编号 6228480123456789 归档').length
  const withContext = collectRuleSpans('银行账号 6228480123456789 用于收款').length
  eq('银行卡无上下文不动', withoutContext, 0)
  eq('银行卡有上下文才动', withContext, 1)
}
{
  const text = '合同金额 120000 元'
  eq('金额默认不打码', collectRuleSpans(text).length, 0)
  eq('金额可配置打码', collectRuleSpans(text, { maskAmounts: true }).length, 1)
}

/* ---------------------------------------------------------------- 层② 词典 */
const entries = [
  entry('张玉军', 'person', '2026-001', 'litigation.party', '原告'),
  entry('山东广播电视台', 'org', '2026-001', 'litigation.party', '被告'),
  entry('（2026）鲁01民初1234号', 'caseNumber', '2026-001', 'litigation.case'),
  entry('（2026）鲁01民初9999号', 'caseNumber', '2026-002', 'litigation.case'),
]

const original = '原告张玉军诉被告山东广播电视台，案号（2026）鲁01民初1234号，承办法官电话 13812345678。'
const first = redactText({ text: original, scope: '2026-001', mode: 'reversible', entries, now: '2026-10-04T00:00:00.000Z' })

check('词典：人名变假名', first.text.includes('张某'), first.text)
check('词典：机构变假名', first.text.includes('机构A'), first.text)
check('词典：案号变假名', first.text.includes('案号A'), first.text)
check('词典：手机号被掩码', first.text.includes('138****5678'), first.text)
check('词典：原文人名已不在结果中', !first.text.includes('张玉军'))
check('词典：他案案号未命中（scope 过滤）', !first.text.includes('案号B'))
eq('报告命中数', first.report.totalHits, 4)
eq('新分配假名数', first.report.newAliases.length, 3)

// 还原往返
const mappingDoc = {
  version: '1.0', scope: '2026-001', mode: 'reversible', restorable: true,
  entities: first.entities, createdAt: '2026-10-04T00:00:00.000Z',
}
const restored = restoreText(first.text, mappingDoc)
check('还原：逐字回到原文', restored.text === original, restored.text)
eq('还原：还原处数', restored.restored, 4)
eq('还原：无残留误报（某某类连写不算 missing）', restored.missing.length, 0)

// 跨次稳定：用既有映射再脱一次，假名不变、无新增
const second = redactText({
  text: original, scope: '2026-001', mode: 'reversible', entries,
  existing: first.entities, now: '2026-10-04T01:00:00.000Z',
})
eq('稳定性：二次脱敏结果一致', second.text, first.text)
eq('稳定性：无新增假名', second.report.newAliases.length, 0)

// 追加新实体 → 只追加，不改旧假名
const third = redactText({
  text: `${original} 第三人李明。`, scope: '2026-001', mode: 'reversible',
  entries: [...entries, entry('李明', 'person', '2026-001')],
  existing: first.entities, now: '2026-10-04T02:00:00.000Z',
})
check('追加：旧假名不变', third.text.includes('张某') && third.text.includes('机构A'))
check('追加：新实体拿到下一个姓假名', third.text.includes('李某'), third.text)

// 长词优先 + 不回扫
{
  const longFirst = redactText({
    text: '张伟民与张伟', scope: 'global', mode: 'reversible',
    entries: [entry('张伟民', 'person'), entry('张伟', 'person')],
  })
  eq('长词优先：两实体各得假名（短者取基名）', longFirst.text, '张某2与张某')
  const covered = redactText({
    text: '张伟民', scope: 'global', mode: 'reversible',
    entries: [entry('张伟民', 'person'), entry('张伟', 'person')],
  })
  eq('被长词覆盖的短词不留幽灵映射', covered.text, '张某')
  eq('被覆盖短词不分配假名', covered.report.newAliases.length, 1)
}

// masked 模式：不可还原
{
  const masked = redactText({ text: original, scope: '2026-001', mode: 'masked', entries })
  eq('masked：标记不可还原', masked.report.restorable, false)
  let threw = false
  try {
    restoreText(masked.text, {
      version: '1.0', scope: '2026-001', mode: 'masked', restorable: false,
      entities: masked.entities, createdAt: '2026-10-04T00:00:00.000Z',
    })
  } catch { threw = true }
  check('masked：restore 明确拒绝', threw)
}

// global scope：无案件上下文时用全库词条
{
  const global = redactText({ text: '张玉军', scope: 'global', mode: 'reversible', entries })
  check('global scope：全库词条生效', global.text === '张某', global.text)
}

/* -------------------------------------------------- 回归：中文紧随人名 */
{
  const followed = collectCandidates('被告：王小明到庭，原告李明诉请。', {})
  const displays = followed.map((c) => c.display).sort()
  eq('启发：人名后接中文也能识别（尾字裁掉）', displays.join(','), '李**,王**')
  eq('启发：不把「到庭」吃进名字', followed.find((c) => c.display === '王**').count, 1)
}
/* -------------------------------------------- 回归：掩码含 X 的 missing */
{
  const outcome = redactText({
    text: '身份证 11010519491231002X', scope: 'global', mode: 'reversible', entries: [],
  })
  const doc = {
    version: '1.0', scope: 'global', mode: 'reversible', restorable: true,
    entities: outcome.entities, createdAt: '2026-10-04T00:00:00.000Z',
  }
  const back = restoreText(outcome.text, doc)
  eq('还原：含 X 的身份证掩码不误报 missing', back.missing.length, 0)
  check('还原：含 X 身份证可还原', back.text === '身份证 11010519491231002X', back.text)
}

/* -------------------------------------------------------------- 层③ 启发 */
{
  const candidates = collectCandidates('被告：王小明，另案原告：王小明', {})
  eq('启发：候选去重计数', candidates.length, 1)
  eq('启发：候选打码展示', candidates[0].display, '王**')
  eq('启发：计数', candidates[0].count, 2)
  const outcome = redactText({ text: '被告：王小明', scope: 'global', mode: 'reversible', entries: [] })
  check('启发：只报告不替换', outcome.text.includes('王小明'))
  eq('启发：候选进报告', outcome.report.candidates.length, 1)
}

/* ---------------------------------------------------------- docx 写回 */
{
  const { parsePart, applySpansToPart } = await import('../lib/domains/redact/docx.js')
  // 名字被 Word 拆进两个 run + 同段两个命中 —— 都是真实会遇到的形态
  const xml = '<w:body><w:p><w:r><w:t>原告张</w:t></w:r><w:r><w:t>玉军，电话13812345678。</w:t></w:r></w:p>'
    + '<w:p><w:r><w:t>被告某某科技有限公司。</w:t></w:r></w:p></w:body>'
  const part = parsePart('word/document.xml', xml)
  eq('docx：段落文本拼接正确', part.text, '原告张玉军，电话13812345678。\n被告某某科技有限公司。')
  const spans = [
    { start: 2, end: 5, matched: '张玉军', kind: 'person', replacement: '张某', origin: 'lexicon' },      // 跨两个 run
    { start: 8, end: 19, matched: '13812345678', kind: 'phone', replacement: '138****5678', origin: 'rule' }, // 同一 run 的第二个命中
    { start: 23, end: 31, matched: '某某科技有限公司', kind: 'org', replacement: '机构A', origin: 'lexicon' },
  ]
  const applied = applySpansToPart(part, spans)
  eq('docx：三个命中全部写回', applied.applied.length, 3)
  eq('docx：无跳过', applied.skipped.length, 0)
  check('docx：跨 run 命中落进首 run', applied.xml.includes('<w:t>原告张某</w:t>') && applied.xml.includes('<w:t>，电话138****5678。</w:t>'), applied.xml)
  check('docx：机构命中写回', applied.xml.includes('<w:t>被告机构A。</w:t>'), applied.xml)
  check('docx：标签未被打坏（结尾结构完整）', applied.xml.endsWith('</w:p></w:body>') && (applied.xml.match(/<\/w:t>/g) ?? []).length === 3, applied.xml)
  const reread = parsePart('word/document.xml', applied.xml)
  eq('docx：写回后可再次解析出正确文本', reread.text, '原告张某，电话138****5678。\n被告机构A。')
}

/* ------------------------------------------------------------ 文件 I/O */
{
  const dir = await mkdtemp(join(tmpdir(), 'agentlex-redact-'))
  try {
    const textPath = join(dir, 'a.txt')
    await writeFile(textPath, '原告张玉军', 'utf8')
    eq('文件：读文本', await readTextFile(textPath), '原告张玉军')

    const binPath = join(dir, 'b.pdf')
    await writeFile(binPath, Buffer.from([0x25, 0x50, 0x44, 0x46, 0x00, 0x01, 0x02]))
    let binaryThrew = false
    try { await readTextFile(binPath) } catch (error) { binaryThrew = error instanceof BinaryFileError }
    check('文件：二进制被拒', binaryThrew)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

/* ------------------------------------------------------ 类别推断（词条） */
{
  const { inferKind } = await import('../lib/domains/redact/lexicon-source.js')
  eq('推断：中文二三字人名', inferKind('李四'), 'person')
  eq('推断：三字人名', inferKind('王小明'), 'person')
  eq('推断：公司名', inferKind('某某科技有限公司'), 'org')
  eq('推断：法院名', inferKind('济南市历下区人民法院'), 'org')
  eq('推断：其他归 custom', inferKind('ABC-123'), 'custom')
}

/* ---------------------------------------------------------------- 汇总 */
console.log(`\n通过 ${passed} / 失败 ${failed}`)
if (failed > 0) {
  console.log('\n失败项：')
  for (const item of failures) console.log(`  ✗ ${item}`)
  process.exit(1)
}
console.log('脱敏引擎自测全部通过 ✓')
