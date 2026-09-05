import { mkdtemp, rm } from 'node:fs/promises'; import { tmpdir } from 'node:os'; import { join } from 'node:path'
import { createCaseStore } from '../lib/domains/litigation/store/index.js'
import { planStageExpansion } from '../lib/domains/litigation/stage-expansion.js'
const dir=await mkdtemp(join(tmpdir(),'execB-')); try{
  const cs=createCaseStore(dir)
  // 我方=被执行人
  const b=await cs.registerCase({name:'某公司被执行案',type:'民商',cause:'借款合同纠纷',status:'executing',level:'首次执行',ourSide:'executionRespondent'})
  const pB=await planStageExpansion(cs,b.caseId,'exec_ctrl',{dryRun:true})
  console.log('B侧执行中任务:', pB.tasks.map(t=>t.title).join(' | '))
  console.log('B侧不含 申请执行人 动作:', !pB.tasks.some(t=>t.title.includes('申请限制消费')||t.title.includes('跟进执行回款')))
  // 我方=申请执行人
  const a=await cs.registerCase({name:'某公司申请执行案',type:'民商',cause:'借款合同纠纷',status:'executing',level:'首次执行',ourSide:'executionApplicant'})
  const pA=await planStageExpansion(cs,a.caseId,'exec_ctrl',{dryRun:true})
  console.log('A侧执行中任务:', pA.tasks.map(t=>t.title).join(' | '))
  console.log('A侧不含 被执行人 动作:', !pA.tasks.some(t=>t.title.includes('应对财产查控')||t.title.includes('执行行为异议')))
  process.exit(0)
}finally{await rm(dir,{recursive:true,force:true})}
