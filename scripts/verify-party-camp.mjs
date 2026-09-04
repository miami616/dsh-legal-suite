/**
 * 阵营逻辑验证 —— 复刻 vendor/panel-ui/renderer/utils/caseFormat.ts 的
 * ourPartyList / theirPartyList 语义（Node 内联实现），用 live 真实数据结构
 * （002/003 含重复行/序数角色、无 ourClient）验证：
 *  1. 我方 = 与 ourSide 同侧的所有主体（同人跨称呼只算一个主体，但 details 重复
 *     行是读侧兜底——写入侧会去重，这里验证读侧按名字去重后的展示）；
 *  2. 对方 = 对侧所有主体；
 *  3. 卡片不再空白、不再错配。
 */

// ---- 复刻 caseFormat 阵营函数（与 vendor 版同逻辑） ----
const CANONICAL_ROLES = ['原告', '被告', '申请人', '被申请人', '上诉人', '被上诉人', '申请执行人', '被执行人', '第三人'];
function canonicalPartyRole(role) {
  const r = (role ?? '').trim();
  if (CANONICAL_ROLES.includes(r)) return r;
  const stripped = r.replace(/^(一审|二审|再审|原审|终审|重审)/, '').replace(/(第?[一二三四五六七八九十百\d]+)/, '');
  return CANONICAL_ROLES.includes(stripped) ? stripped : r;
}
function sideOfCanonical(c) { if (['原告','申请人','上诉人','申请执行人'].includes(c)) return 'A'; if (['被告','被申请人','被上诉人','被执行人'].includes(c)) return 'B'; return ''; }
function sideOfOurSide(os) { if (['plaintiff','applicant','appellant','executionApplicant'].includes(os)) return 'A'; if (['defendant','respondent','appellee','executionRespondent'].includes(os)) return 'B'; return ''; }
function rowHasSide(d, side) { if (side === '') return false; const roles = Array.isArray(d.roles) ? d.roles : (d.role ? [d.role] : []); return roles.some(r => sideOfCanonical(canonicalPartyRole(r ?? '')) === side); }
function ourPartyList(c) {
  const ourSide = c.ourSide ?? c.parties?.ourSide ?? '';
  const details = c.parties?.details ?? [];
  const side = sideOfOurSide(ourSide);
  if (side === '') return [];
  const ours = details.filter(d => rowHasSide(d, side));
  if (ours.length > 0) return ours.map(d => ({ name: d.name ?? '', role: d.role ?? '' }));
  const primary = ourSideRoleLabel(ourSide);
  const fallback = side === 'A' ? c.parties?.plaintiff : c.parties?.defendant;
  return primary && fallback ? [{ name: fallback, role: primary }] : [];
}
function theirPartyList(c) {
  const ourSide = c.ourSide ?? c.parties?.ourSide ?? '';
  const details = c.parties?.details ?? [];
  const side = sideOfOurSide(ourSide);
  const opp = side === 'A' ? 'B' : side === 'B' ? 'A' : '';
  if (opp === '') return [];
  const theirs = details.filter(d => rowHasSide(d, opp));
  if (theirs.length > 0) return theirs.map(d => ({ name: d.name ?? '', role: d.role ?? '' }));
  const primary = oppositeRoleOf(ourSide);
  const fallback = side === 'A' ? c.parties?.defendant : c.parties?.plaintiff;
  return primary && fallback ? [{ name: fallback, role: primary }] : [];
}
const ROLE_OF = { plaintiff:'原告', applicant:'申请人', defendant:'被告', respondent:'被申请人', appellant:'上诉人', appellee:'被上诉人', executionApplicant:'申请执行人', executionRespondent:'被执行人' };
function ourSideRoleLabel(os) { return ROLE_OF[os] ?? ''; }
const OPP = { plaintiff:'被告', applicant:'被申请人', defendant:'原告', respondent:'申请人', appellant:'被上诉人', appellee:'上诉人', executionApplicant:'被执行人', executionRespondent:'申请执行人' };
function oppositeRoleOf(os) { return OPP[os] ?? ''; }
/** 读侧展示去重：同名同人合并展示（主体唯一），角色并集。 */
function dedupeForDisplay(rows) {
  const map = new Map();
  for (const r of rows) {
    const k = r.name;
    if (!map.has(k)) map.set(k, { ...r, roles: r.role ? [r.role] : [] });
    else { const e = map.get(k); if (r.role && !e.roles.includes(r.role)) e.roles.push(r.role); e.role = e.roles[0]; }
  }
  return [...map.values()];
}

let failures = 0;
const check = (name, cond, extra='') => { console.log(`${cond?'PASS':'FAIL'}  ${name}${extra?'  ('+extra+')':''}`); if(!cond) failures++; };

// ---- 真实数据结构 ----
const cases = {
  '2026-001': { ourSide: 'appellant', parties: { ourSide: 'appellant', details: [
    { name: '山东体育频道发展有限公司', role: '上诉人' },
    { name: '山东万鲜润供应链管理有限公司', role: '被上诉人' },
  ]}},
  '2026-002': { ourSide: 'respondent', parties: { ourSide: 'respondent', details: [
    { name: '高歌', role: '申请人' },
    { name: '山东龙视天下传媒集团有限公司', role: '被申请人' },
    { name: '山东龙视天下传媒集团有限公司', role: '被告' },
    { name: '高歌', role: '原告' },
  ]}},
  '2026-003': { ourSide: 'respondent', parties: { ourSide: 'respondent', details: [
    { name: '刘玉军', role: '申请人' },
    { name: '山东广播电视台', role: '第一被申请人' },
    { name: '济南邦得人力资源有限公司', role: '第二被申请人' },
    { name: '刘玉军', role: '原告' },
  ]}},
};

// 001: 上诉人(我方) vs 被上诉人(对方)
let ours = dedupeForDisplay(ourPartyList(cases['2026-001']));
let theirs = dedupeForDisplay(theirPartyList(cases['2026-001']));
check('001 我方=体育频道(上诉人)', ours.length===1 && ours[0].name==='山东体育频道发展有限公司' && ours[0].role==='上诉人', JSON.stringify(ours));
check('001 对方=万鲜润(被上诉人)', theirs.length===1 && theirs[0].name==='山东万鲜润供应链管理有限公司', JSON.stringify(theirs));

// 002: ourSide=respondent → 我方=B 侧（被申请人/被告系）；龙视传媒 B 侧 → 我方
ours = dedupeForDisplay(ourPartyList(cases['2026-002']));
theirs = dedupeForDisplay(theirPartyList(cases['2026-002']));
check('002 我方=龙视传媒（B侧，被申请人+被告 去重为1主体）', ours.length===1 && ours[0].name==='山东龙视天下传媒集团有限公司', JSON.stringify(ours));
check('002 我方主角色=被申请人', ours[0].role==='被申请人', JSON.stringify(ours));
check('002 对方=高歌（A侧，申请人+原告 去重为1主体）', theirs.length===1 && theirs[0].name==='高歌', JSON.stringify(theirs));

// 003: 我方=B 侧 → 电视台(第一被申请人)+邦得人力(第二被申请人) = 两个主体都是我方的
ours = dedupeForDisplay(ourPartyList(cases['2026-003']));
theirs = dedupeForDisplay(theirPartyList(cases['2026-003']));
check('003 我方=电视台+邦得人力（B侧 2 主体）', ours.length===2 && ours.some(p=>p.name==='山东广播电视台') && ours.some(p=>p.name==='济南邦得人力资源有限公司'), JSON.stringify(ours.map(p=>p.name)));
check('003 对方=刘玉军（A侧）', theirs.length===1 && theirs[0].name==='刘玉军', JSON.stringify(theirs));

// 无 ourSide → 空（不臆断）
const noSide = { ourSide:'', parties:{ ourSide:'', details:[{name:'甲',role:'原告'},{name:'乙',role:'被告'}] }};
check('ourSide 空 → 我方/对方为空（不臆断）', ourPartyList(noSide).length===0 && theirPartyList(noSide).length===0);

console.log(`\n${failures===0?'ALL PASS':failures+' FAILURE(S)'}`);
process.exit(failures===0?0:1);
