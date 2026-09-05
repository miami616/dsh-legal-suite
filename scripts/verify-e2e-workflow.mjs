import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createCaseStore } from '../lib/domains/litigation/store/index.js'
import { createItemStore } from '../lib/domains/item/store/item-store.js'
import { applyStageExpansion, planStageExpansion, detectStageSuggestions } from '../lib/domains/litigation/stage-expansion.js'
import { hydrateRegistryTaskGroups } from '../lib/domains/litigation/task-view.js'
import { computeCaseHealth } from '../lib/domains/litigation/health.js'

let fails=0
const check=(n,c,e='')=>{console.log(`${c?'PASS':'FAIL'}  ${n}${e?'  ('+e+')':''}`); if(!c)fails++}
const dir=await mkdtemp(join(tmpdir(),'ls-e2e-'))
try{
  const cs=createCaseStore(dir)
  const items=createItemStore(dir)
  // 模拟：用户收传票建案（我方被告，民商）
  const c=await cs.registerCase({name:'甲诉乙买卖合同案',type:'民商',cause:'买卖合同纠纷',status:'filing',level:'一审',ourSide:'defendant',court:'XX法院',caseNumber:'(2026)民初1号',filingDate:'2026-09-01'})
  check('建案返回 level', c.level==='一审', c.level)
  // 管家登记举证期限/开庭关键日期（不再派任务）
  const kd=await cs.addKeyDate(c.caseId,'举证期限届满','2026-09-30')
  const kd2=await cs.addKeyDate(c.caseId,'开庭','2026-10-20')
  check('举证期限关键日期已登记', kd.keyDates.some(k=>k.label==='举证期限届满'), '')
  // 无登记类任务被创建
  const reg1=await cs.readRegistry()
  const hyd1=await hydrateRegistryTaskGroups(reg1,cs,items)
  const allTasks=Object.values(hyd1.cases).flatMap(r=>(r.taskGroups??[]).flatMap(g=>g.tasks.map(t=>t.title)))
  check('未给律师派 登记类任务', !allTasks.includes('登记举证期限与开庭安排') && !allTasks.includes('锁定三大期限并倒排'), JSON.stringify(allTasks))
  // 展开庭前准备（被告视角：含答辩状不含原告向）——先推进 status 到 pretrial 再展开/体检
  await cs.updateCase(c.caseId,{status:'pretrial'})
  await applyStageExpansion(cs,c.caseId,'pretrial',{anchorDate:'2026-10-20'},items)
  const reg2=await cs.readRegistry(); const hyd2=await hydrateRegistryTaskGroups(reg2,cs,items)
  const rec2=Object.values(hyd2.cases)[0]
  const g=rec2.taskGroups.find(x=>x.name==='一审 · 庭前准备')
  const titles=g.tasks.map(t=>t.title)
  check('被告展开含提交答辩状', titles.includes('提交答辩状'), titles.join(','))
  check('被告展开不含查阅对方答辩状', !titles.includes('查阅对方答辩状'), '')
  // case_health 看阶段进度
  const h=await computeCaseHealth(Object.values(hyd2.cases)[0])
  check('health 阶段=庭前准备', h.stage.name==='一审 · 庭前准备', h.stage.name)
  check('health 开庭/举证 keydate 缺口已补', h.completeness.gaps.filter(x=>x.label.includes('开庭')).length===0, JSON.stringify(h.completeness.gaps.map(x=>x.label)))
  // 判决后转二审：level=二审 status=appeal_filed → 二审轨展开
  await cs.updateCase(c.caseId,{level:'二审',status:'appeal_filed'})
  await applyStageExpansion(cs,c.caseId,'appeal_filed',{},items)
  const reg3=await cs.readRegistry(); const hyd3=await hydrateRegistryTaskGroups(reg3,cs,items)
  const rec3=Object.values(hyd3.cases)[0]
  check('instances 记录二审', rec3.instances.some(i=>i.level==='二审'), JSON.stringify(rec3.instances))
  const g2=rec3.taskGroups.find(x=>x.name==='二审 · 上诉立案')
  check('二审组含提交上诉状', g2?.tasks.some(t=>t.title==='提交上诉状')===true, JSON.stringify(g2?.tasks.map(t=>t.title)))
  check('旧一审组保留', rec3.taskGroups.some(x=>x.name==='一审 · 庭前准备'), rec3.taskGroups.map(x=>x.name).join('|'))
  console.log(`\n${fails===0?'ALL PASS':fails+' FAILURE(S)'}`)
  process.exit(fails?1:0)
}finally{await rm(dir,{recursive:true,force:true})}
