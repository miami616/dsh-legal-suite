import { mkdtemp, rm } from 'node:fs/promises'; import { tmpdir } from 'node:os'; import { join } from 'node:path'
import { createCaseStore } from '../lib/domains/litigation/store/index.js'
let fails=0; const check=(n,c,e='')=>{console.log(`${c?'PASS':'FAIL'}  ${n}${e?'  ('+e+')':''}`); if(!c)fails++}
const dir=await mkdtemp(join(tmpdir(),'inst-'))
try{
  const cs=createCaseStore(dir)
  // 建案即带双方信息 → 审级节点应自动生成且双方齐
  const c=await cs.registerCase({name:'甲诉乙纠纷',type:'民商',cause:'买卖合同纠纷',status:'filing',level:'一审',
    court:'某法院',caseNumber:'（2026）某民初1号',filingDate:'2026-09-01',judge:'王法官',ourSide:'plaintiff',
    parties:{plaintiff:'甲',defendant:'乙',ourSide:'plaintiff',details:[{name:'甲',role:'原告',ourClient:true},{name:'乙',role:'被告'}]}})
  const inst=c.instances ?? []
  check('建案自动生成首个审级节点', inst.length===1, JSON.stringify(inst))
  check('节点带案号', inst[0]?.caseNo==='（2026）某民初1号', String(inst[0]?.caseNo))
  check('节点带法院/法官/日期', inst[0]?.court==='某法院' && inst[0]?.judge==='王法官' && inst[0]?.filedAt==='2026-09-01', '')
  check('节点双方原告被告齐全', inst[0]?.plaintiff==='甲' && inst[0]?.defendant==='乙', `p=${inst[0]?.plaintiff} d=${inst[0]?.defendant}`)
  // 切二审 → 新节点双方自动带上
  await cs.updateCase(c.caseId,{level:'二审',status:'appeal_filed'})
  const c2=await cs.readCase(c.caseId)
  const inst2=c2.instances ?? []
  check('切二审追加节点', inst2.length===2, `len=${inst2.length}`)
  const n2=inst2[1]
  check('二审节点双方齐全', n2.plaintiff==='甲' && n2.defendant==='乙', `p=${n2.plaintiff} d=${n2.defendant}`)
  console.log(`\n${fails===0?'ALL PASS':fails+' FAILURE(S)'}`); process.exit(fails?1:0)
}finally{await rm(dir,{recursive:true,force:true})}
