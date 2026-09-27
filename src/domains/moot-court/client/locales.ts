/**
 * dsh-legal-suite/moot-court — 面板文案字典（zh / en）。
 *
 * 与其它域同构：MootKey 既提供索引签名（缺 key 回退为 key 本身），又逐条声明
 * 实际用到的 key，保证 en 与 zh 完全对齐。程序 / 模式 / 状态 / 法庭组成等
 * 领域名词走 store/types.ts 的 PROCEDURE_LABEL 等常量，不进本表。
 */

export interface MootKey {
  [key: string]: string
  // 入口
  'entry.label': string
  'entry.tooltip': string
  // 面板骨架
  'panel.title': string
  'panel.subtitle': string
  /** 实验性标记（标题旁徽标）。 */
  'panel.experimental': string
  /** 实验性说明（面板顶部一行提示）。 */
  'panel.experimentalNotice': string
  'panel.close': string
  'panel.refresh': string
  'panel.disclaimerLabel': string
  // 顶部视图切换
  'tab.list': string
  'tab.wizard': string
  'tab.live': string
  'tab.report': string
  // 通用
  'common.loading': string
  'common.retry': string
  'common.back': string
  'common.next': string
  'common.cancel': string
  'common.delete': string
  'common.add': string
  'common.remove': string
  'common.none': string
  'common.optional': string
  'common.working': string
  // 列表视图
  'list.empty': string
  'list.emptyHint': string
  'list.new': string
  'list.open': string
  'list.report': string
  'list.resume': string
  'list.start': string
  'list.delete': string
  'list.deleteConfirm': string
  'list.updated': string
  'list.round': string
  'list.phase': string
  'list.tokens': string
  'list.loadFailed': string
  // 向导
  'wizard.title': string
  'wizard.stepOf': string
  'wizard.step1': string
  'wizard.step2': string
  'wizard.step3': string
  'wizard.step4': string
  'wizard.filterCases': string
  'wizard.noCases': string
  'wizard.caseCount': string
  'wizard.hasCaseInfo': string
  'wizard.noCaseInfo': string
  'wizard.manual': string
  'wizard.manualHint': string
  'wizard.selectedCase': string
  'wizard.procedure': string
  'wizard.mode': string
  'wizard.modeStressHint': string
  'wizard.modeAutoHint': string
  'wizard.modeRehearsalHint': string
  'wizard.tribunal': string
  'wizard.arbRules': string
  'arb.cietac': string
  'arb.bac': string
  'arb.shiac': string
  'arb.generic': string
  'wizard.loadCasesFailed': string
  'wizard.dossierLoading': string
  'wizard.dossierFailed': string
  'wizard.claims': string
  'wizard.claimsHint': string
  'wizard.facts': string
  'wizard.brief': string
  'wizard.evidence': string
  'wizard.evidenceNo': string
  'wizard.evidenceName': string
  'wizard.evidencePurpose': string
  'wizard.addEvidence': string
  'wizard.noEvidence': string
  'wizard.priorJudgment': string
  'wizard.appealGrounds': string
  'wizard.appealGroundsHint': string
  'wizard.caseMaterials': string
  'wizard.caseMaterialsHint': string
  'wizard.noMaterials': string
  'wizard.check': string
  'wizard.checking': string
  'wizard.prepareFailed': string
  'wizard.ready': string
  'wizard.notReady': string
  'wizard.blocking': string
  'wizard.nonBlocking': string
  'wizard.warnings': string
  'wizard.sessionTitle': string
  'wizard.sessionTitlePlaceholder': string
  'wizard.judgeModel': string
  'wizard.opponentModel': string
  'wizard.sameAsJudge': string
  'wizard.retrieval': string
  'wizard.retrievalHint': string
  'wizard.retrievalProvince': string
  'wizard.retrievalProvincePlaceholder': string
  'wizard.maxRounds': string
  'wizard.tokenBudget': string
  'wizard.maxTokensPerTurn': string
  'wizard.opponentTemperature': string
  'wizard.modelsFailed': string
  'wizard.create': string
  'wizard.creating': string
  'wizard.createFailed': string
  'wizard.needCase': string
  'wizard.needDossier': string
  // 直播视图
  'live.phase': string
  'live.currentPhase': string
  'live.transcript': string
  'live.noEntries': string
  'live.citations': string
  'live.citationArticle': string
  'live.citationCase': string
  'live.start': string
  'live.pause': string
  'live.resume': string
  'live.abort': string
  'live.fastforward': string
  'live.abortConfirm': string
  'live.viewReport': string
  'live.controlFailed': string
  'live.rehearsalHint': string
  'live.intervenePlaceholder': string
  'live.submit': string
  'live.submitting': string
  'live.submitFailed': string
  'live.emptyText': string
  'live.status': string
  'live.round': string
  'live.tokensUsed': string
  'live.retrievalOn': string
  'live.retrievalDegraded': string
  // 发言主体兜底标签（transcript 自带 roleLabel，缺失时用）
  'actor.clerk': string
  'actor.judge': string
  'actor.opponent': string
  'actor.self': string
  'actor.user': string
  'actor.panel': string
  // 报告视图
  'report.loading': string
  'report.loadFailed': string
  'report.verdict': string
  'report.leaning': string
  'report.usWinRate': string
  'report.confidence': string
  'report.leaningUs': string
  'report.leaningThem': string
  'report.leaningPartial': string
  'report.leaningUnclear': string
  'report.confidenceHigh': string
  'report.confidenceMedium': string
  'report.confidenceLow': string
  'report.issues': string
  'report.noIssues': string
  'report.ourClaims': string
  'report.theirClaims': string
  'report.weakPoints': string
  'report.evidenceRefs': string
  'report.anchors': string
  'report.articles': string
  'report.cases': string
  'report.score': string
  'report.attacks': string
  'report.noAttacks': string
  'report.attackFromOpponent': string
  'report.attackFromJudge': string
  'report.severityHigh': string
  'report.severityMedium': string
  'report.severityLow': string
  'report.gaps': string
  'report.noGaps': string
  'report.gapReason': string
  'report.suggestions': string
  'report.noSuggestions': string
  'report.priorityHigh': string
  'report.priorityMedium': string
  'report.priorityLow': string
  'report.kindEvidence': string
  'report.kindDocument': string
  'report.kindStrategy': string
  'report.proceduralNotes': string
  'report.boundaries': string
  'report.judgment': string
  'report.judgmentEmpty': string
  'report.retrieval': string
  'report.retrievalOn': string
  'report.retrievalOff': string
  'report.retrievalDegraded': string
  'report.budget': string
  'report.budgetTruncated': string
  'report.generatedAt': string
  'report.writeback': string
  'report.writebacking': string
  'report.writebackHint': string
  'report.writebackDone': string
  'report.writebackFailed': string
  'report.writebackDisabled': string
  'report.tasks': string
  'report.notFound': string
  'report.refresh': string
}

/** 中文（默认）。 */
export const zh: MootKey = {
  'entry.label': '模拟法庭',
  'entry.tooltip': '模拟法庭：AI 庭审演练与文书压力测试',
  'panel.title': '模拟法庭',
  'panel.subtitle': 'AI 庭审演练 · 仅供律师内部参考',
  'panel.experimental': '实验性',
  'panel.experimentalNotice': '实验性功能：模拟结论仅供内部参考，不构成对裁判结果的预测或承诺；如需关闭，请到「AgentLex 设置 → 功能模块」取消勾选「模拟法庭（实验性）」。',
  'panel.close': '关闭',
  'panel.refresh': '刷新',
  'panel.disclaimerLabel': '免责声明',
  'tab.list': '模拟列表',
  'tab.wizard': '新建模拟',
  'tab.live': '庭审直播',
  'tab.report': '模拟报告',
  'common.loading': '加载中…',
  'common.retry': '重试',
  'common.back': '上一步',
  'common.next': '下一步',
  'common.cancel': '取消',
  'common.delete': '删除',
  'common.add': '添加',
  'common.remove': '移除',
  'common.none': '无',
  'common.optional': '可选',
  'common.working': '处理中…',
  'list.empty': '暂无模拟记录',
  'list.emptyHint': '新建一次模拟庭审，对案件做压力测试或单方预演。',
  'list.new': '新建模拟',
  'list.open': '打开',
  'list.report': '报告',
  'list.resume': '续跑',
  'list.start': '开庭',
  'list.delete': '删除',
  'list.deleteConfirm': '删除模拟「{title}」及其全部记录？此操作不可恢复。',
  'list.updated': '更新于 {time}',
  'list.round': '第 {n} 轮',
  'list.phase': '阶段：{phase}',
  'list.tokens': '{n} tokens',
  'list.loadFailed': '加载模拟列表失败：{error}',
  'wizard.title': '新建模拟庭审',
  'wizard.stepOf': '第 {step} / 4 步',
  'wizard.step1': '选择案件',
  'wizard.step2': '程序与模式',
  'wizard.step3': '材料确认',
  'wizard.step4': '模型与预算',
  'wizard.filterCases': '按名称/案由筛选',
  'wizard.noCases': '未找到匹配的案件',
  'wizard.caseCount': '共 {n} 个案件',
  'wizard.hasCaseInfo': '有案件信息',
  'wizard.noCaseInfo': '缺少案件信息.md',
  'wizard.manual': '不用案件，手工填写',
  'wizard.manualHint': '手工填写模式下，材料快照由你在下一步直接编辑。',
  'wizard.selectedCase': '已选：{name}',
  'wizard.procedure': '审理程序',
  'wizard.mode': '模拟模式',
  'wizard.modeStressHint': '双方均由模型扮演，重点攻击我方文书与论证。',
  'wizard.modeAutoHint': '裁判者与双方均由模型扮演，完整推演一遍庭审。',
  'wizard.modeRehearsalHint': '我方发言由你亲自输入，模型只扮演裁判者与对方。',
  'wizard.tribunal': '法庭组成',
  'wizard.arbRules': '仲裁规则',
  'arb.cietac': '中国国际经济贸易仲裁委员会规则（贸仲）',
  'arb.bac': '北京仲裁委员会规则（北仲）',
  'arb.shiac': '上海国际仲裁中心规则（上仲）',
  'arb.generic': '一般商事仲裁规则',
  'wizard.loadCasesFailed': '加载案件失败：{error}',
  'wizard.dossierLoading': '正在构建材料快照…',
  'wizard.dossierFailed': '构建材料快照失败：{error}',
  'wizard.claims': '诉讼/仲裁请求',
  'wizard.claimsHint': '每行一条请求。',
  'wizard.facts': '事实摘要',
  'wizard.brief': '我方策略简报',
  'wizard.evidence': '证据清单',
  'wizard.evidenceNo': '编号',
  'wizard.evidenceName': '证据名称',
  'wizard.evidencePurpose': '证明目的',
  'wizard.addEvidence': '添加证据',
  'wizard.noEvidence': '暂无证据，可点「添加证据」补录。',
  'wizard.priorJudgment': '一审裁判文书',
  'wizard.appealGrounds': '上诉请求与理由',
  'wizard.appealGroundsHint': '每行一条。',
  'wizard.caseMaterials': '案件材料',
  'wizard.caseMaterialsHint': '仅登记引用与提要，不复制卷宗文件。',
  'wizard.noMaterials': '该案件未发现可勾选的材料。',
  'wizard.check': '重新校验材料',
  'wizard.checking': '校验中…',
  'wizard.prepareFailed': '材料校验失败：{error}',
  'wizard.ready': '材料就绪，可进入下一步。',
  'wizard.notReady': '材料尚未就绪：还有 {n} 项必填缺失。',
  'wizard.blocking': '必填缺失',
  'wizard.nonBlocking': '可选缺口',
  'wizard.warnings': '提示',
  'wizard.sessionTitle': '模拟标题',
  'wizard.sessionTitlePlaceholder': '留空则自动命名（案件名 + 程序）',
  'wizard.judgeModel': '裁判者模型',
  'wizard.opponentModel': '对方代理人模型',
  'wizard.sameAsJudge': '同裁判者路由',
  'wizard.retrieval': '启用元典法条/类案锚定',
  'wizard.retrievalHint': '关闭时判决与报告会标注「未锚定」。',
  'wizard.retrievalProvince': '检索地域（省，可空）',
  'wizard.retrievalProvincePlaceholder': '如：山东；留空为全国',
  'wizard.maxRounds': '最大辩论轮次',
  'wizard.tokenBudget': '总 token 预算',
  'wizard.maxTokensPerTurn': '单条发言 maxTokens',
  'wizard.opponentTemperature': '对方温度（{value}）',
  'wizard.modelsFailed': '加载模型列表失败：{error}',
  'wizard.create': '创建并开庭',
  'wizard.creating': '创建中…',
  'wizard.createFailed': '创建模拟失败：{error}',
  'wizard.needCase': '请先选择一个案件，或改用「手工填写」。',
  'wizard.needDossier': '材料快照尚未就绪，请稍候或重新校验。',
  'live.phase': '庭审阶段',
  'live.currentPhase': '当前阶段',
  'live.transcript': '庭审记录',
  'live.noEntries': '尚无庭审记录。点击「开庭」开始模拟。',
  'live.citations': '引证 {n} 条',
  'live.citationArticle': '法条',
  'live.citationCase': '类案',
  'live.start': '开庭',
  'live.pause': '暂停',
  'live.resume': '继续',
  'live.abort': '中止',
  'live.fastforward': '快进',
  'live.abortConfirm': '中止本次模拟？已产生的记录会保留。',
  'live.viewReport': '查看报告',
  'live.controlFailed': '控制失败：{error}',
  'live.rehearsalHint': '轮到你发言：以我方代理人身份写下本条发言。',
  'live.intervenePlaceholder': '我方发言…',
  'live.submit': '提交我方发言',
  'live.submitting': '提交中…',
  'live.submitFailed': '提交失败：{error}',
  'live.emptyText': '（空）',
  'live.status': '状态',
  'live.round': '轮次 {n}',
  'live.tokensUsed': '已用 {used} / 预算 {budget} tokens',
  'live.retrievalOn': '检索锚定：已启用',
  'live.retrievalDegraded': '锚定降级：{reason}',
  'actor.clerk': '书记员',
  'actor.judge': '裁判者',
  'actor.opponent': '对方代理人',
  'actor.self': '我方代理人',
  'actor.user': '我方代理人',
  'actor.panel': '仲裁庭',
  'report.loading': '正在加载报告…',
  'report.loadFailed': '加载报告失败：{error}',
  'report.verdict': '倾向性结论',
  'report.leaning': '倾向',
  'report.usWinRate': '我方胜算',
  'report.confidence': '置信度',
  'report.leaningUs': '我方占优',
  'report.leaningThem': '对方占优',
  'report.leaningPartial': '部分支持',
  'report.leaningUnclear': '难以判断',
  'report.confidenceHigh': '高',
  'report.confidenceMedium': '中',
  'report.confidenceLow': '低',
  'report.issues': '争点分析',
  'report.noIssues': '本次模拟未生成争点。',
  'report.ourClaims': '我方主张',
  'report.theirClaims': '对方主张',
  'report.weakPoints': '薄弱环节',
  'report.evidenceRefs': '关联证据',
  'report.anchors': '锚定',
  'report.articles': '法条',
  'report.cases': '类案',
  'report.score': '评分',
  'report.attacks': '攻击线路',
  'report.noAttacks': '未识别到明显攻击线路。',
  'report.attackFromOpponent': '对方视角',
  'report.attackFromJudge': '裁判者视角',
  'report.severityHigh': '高',
  'report.severityMedium': '中',
  'report.severityLow': '低',
  'report.gaps': '证据与文书缺口',
  'report.noGaps': '未发现明显缺口。',
  'report.gapReason': '原因',
  'report.suggestions': '改进建议',
  'report.noSuggestions': '暂无建议。',
  'report.priorityHigh': '高优先',
  'report.priorityMedium': '中优先',
  'report.priorityLow': '低优先',
  'report.kindEvidence': '证据',
  'report.kindDocument': '文书',
  'report.kindStrategy': '策略',
  'report.proceduralNotes': '程序性提示',
  'report.boundaries': '模拟边界',
  'report.judgment': '模拟判决书',
  'report.judgmentEmpty': '本次模拟未生成判决书。',
  'report.retrieval': '检索锚定',
  'report.retrievalOn': '已启用，锚定 {n} 条',
  'report.retrievalOff': '未启用（未锚定）',
  'report.retrievalDegraded': '锚定降级：{reason}',
  'report.budget': 'token 用量',
  'report.budgetTruncated': '（预算超限，已截断）',
  'report.generatedAt': '生成于 {time}',
  'report.writeback': '回写为案件任务',
  'report.writebacking': '回写中…',
  'report.writebackHint': '只写任务记录，不产生文件。',
  'report.writebackDone': '已回写 {n} 条任务。',
  'report.writebackFailed': '回写失败：{error}',
  'report.writebackDisabled': '本次模拟未关联案件，无法回写任务。',
  'report.tasks': '已创建任务',
  'report.notFound': '未找到该会话的报告。',
  'report.refresh': '刷新报告',
}

/** English. */
export const en: MootKey = {
  'entry.label': 'Moot Court',
  'entry.tooltip': 'Moot court — AI trial rehearsal and document stress testing',
  'panel.title': 'Moot Court',
  'panel.subtitle': 'AI trial rehearsal · internal reference only',
  'panel.experimental': 'Experimental',
  'panel.experimentalNotice': 'Experimental feature: simulated outcomes are for internal reference only and are not a prediction or commitment as to any judgment. To turn it off, uncheck "Moot Court (Experimental)" under AgentLex Settings → Modules.',
  'panel.close': 'Close',
  'panel.refresh': 'Refresh',
  'panel.disclaimerLabel': 'Disclaimer',
  'tab.list': 'Sessions',
  'tab.wizard': 'New session',
  'tab.live': 'Live',
  'tab.report': 'Report',
  'common.loading': 'Loading…',
  'common.retry': 'Retry',
  'common.back': 'Back',
  'common.next': 'Next',
  'common.cancel': 'Cancel',
  'common.delete': 'Delete',
  'common.add': 'Add',
  'common.remove': 'Remove',
  'common.none': 'None',
  'common.optional': 'optional',
  'common.working': 'Working…',
  'list.empty': 'No moot sessions yet',
  'list.emptyHint': 'Create a session to stress-test a case or rehearse one side.',
  'list.new': 'New session',
  'list.open': 'Open',
  'list.report': 'Report',
  'list.resume': 'Resume',
  'list.start': 'Start',
  'list.delete': 'Delete',
  'list.deleteConfirm': 'Delete session "{title}" and all its records? This cannot be undone.',
  'list.updated': 'Updated {time}',
  'list.round': 'Round {n}',
  'list.phase': 'Phase: {phase}',
  'list.tokens': '{n} tokens',
  'list.loadFailed': 'Failed to load sessions: {error}',
  'wizard.title': 'New moot session',
  'wizard.stepOf': 'Step {step} of 4',
  'wizard.step1': 'Select case',
  'wizard.step2': 'Procedure & mode',
  'wizard.step3': 'Materials',
  'wizard.step4': 'Models & budget',
  'wizard.filterCases': 'Filter by name or cause of action',
  'wizard.noCases': 'No matching case',
  'wizard.caseCount': '{n} cases',
  'wizard.hasCaseInfo': 'Case info available',
  'wizard.noCaseInfo': 'No case info file',
  'wizard.manual': 'No case — fill in manually',
  'wizard.manualHint': 'In manual mode you edit the dossier directly in the next step.',
  'wizard.selectedCase': 'Selected: {name}',
  'wizard.procedure': 'Procedure',
  'wizard.mode': 'Mode',
  'wizard.modeStressHint': 'Both sides are played by the model, focusing its attack on our documents and arguments.',
  'wizard.modeAutoHint': 'Judge and both sides are played by the model for a full run-through.',
  'wizard.modeRehearsalHint': 'You write our statements; the model plays only the judge and the opponent.',
  'wizard.tribunal': 'Tribunal',
  'wizard.arbRules': 'Arbitration rules',
  'arb.cietac': 'CIETAC arbitration rules',
  'arb.bac': 'Beijing Arbitration Commission rules',
  'arb.shiac': 'Shanghai International Arbitration Center rules',
  'arb.generic': 'Generic commercial arbitration rules',
  'wizard.loadCasesFailed': 'Failed to load cases: {error}',
  'wizard.dossierLoading': 'Building dossier snapshot…',
  'wizard.dossierFailed': 'Failed to build the dossier: {error}',
  'wizard.claims': 'Claims / relief sought',
  'wizard.claimsHint': 'One claim per line.',
  'wizard.facts': 'Facts summary',
  'wizard.brief': 'Our strategy brief',
  'wizard.evidence': 'Evidence list',
  'wizard.evidenceNo': 'No.',
  'wizard.evidenceName': 'Name',
  'wizard.evidencePurpose': 'Purpose of proof',
  'wizard.addEvidence': 'Add evidence',
  'wizard.noEvidence': 'No evidence yet; use “Add evidence” to enter it.',
  'wizard.priorJudgment': 'First-instance judgment',
  'wizard.appealGrounds': 'Appeal requests and grounds',
  'wizard.appealGroundsHint': 'One per line.',
  'wizard.caseMaterials': 'Case materials',
  'wizard.caseMaterialsHint': 'References and notes only — case files are never copied.',
  'wizard.noMaterials': 'No selectable materials found in this case.',
  'wizard.check': 'Re-check materials',
  'wizard.checking': 'Checking…',
  'wizard.prepareFailed': 'Material check failed: {error}',
  'wizard.ready': 'Materials ready — you can continue.',
  'wizard.notReady': 'Not ready: {n} blocking items are still missing.',
  'wizard.blocking': 'Blocking',
  'wizard.nonBlocking': 'Optional',
  'wizard.warnings': 'Warnings',
  'wizard.sessionTitle': 'Session title',
  'wizard.sessionTitlePlaceholder': 'Auto-named (case + procedure) when empty',
  'wizard.judgeModel': 'Judge model',
  'wizard.opponentModel': 'Opponent model',
  'wizard.sameAsJudge': 'Same as judge route',
  'wizard.retrieval': 'Enable statutory / case anchoring',
  'wizard.retrievalHint': 'When off, the judgment and report are marked “unanchored”.',
  'wizard.retrievalProvince': 'Retrieval region (province, optional)',
  'wizard.retrievalProvincePlaceholder': 'e.g. Shandong; empty = nationwide',
  'wizard.maxRounds': 'Max debate rounds',
  'wizard.tokenBudget': 'Total token budget',
  'wizard.maxTokensPerTurn': 'Max tokens per turn',
  'wizard.opponentTemperature': 'Opponent temperature ({value})',
  'wizard.modelsFailed': 'Failed to load models: {error}',
  'wizard.create': 'Create & start',
  'wizard.creating': 'Creating…',
  'wizard.createFailed': 'Failed to create the session: {error}',
  'wizard.needCase': 'Select a case first, or switch to manual mode.',
  'wizard.needDossier': 'The dossier is not ready yet.',
  'live.phase': 'Phases',
  'live.currentPhase': 'Current phase',
  'live.transcript': 'Transcript',
  'live.noEntries': 'No transcript yet. Press “Start” to begin.',
  'live.citations': '{n} citations',
  'live.citationArticle': 'Statute',
  'live.citationCase': 'Case',
  'live.start': 'Start',
  'live.pause': 'Pause',
  'live.resume': 'Resume',
  'live.abort': 'Abort',
  'live.fastforward': 'Fast-forward',
  'live.abortConfirm': 'Abort this session? Records already produced are kept.',
  'live.viewReport': 'View report',
  'live.controlFailed': 'Control failed: {error}',
  'live.rehearsalHint': 'Your turn: write this statement as our counsel.',
  'live.intervenePlaceholder': 'Our statement…',
  'live.submit': 'Submit statement',
  'live.submitting': 'Submitting…',
  'live.submitFailed': 'Submit failed: {error}',
  'live.emptyText': '(empty)',
  'live.status': 'Status',
  'live.round': 'Round {n}',
  'live.tokensUsed': '{used} / {budget} tokens used',
  'live.retrievalOn': 'Retrieval anchoring: enabled',
  'live.retrievalDegraded': 'Anchoring degraded: {reason}',
  'actor.clerk': 'Clerk',
  'actor.judge': 'Judge',
  'actor.opponent': 'Opposing counsel',
  'actor.self': 'Our counsel',
  'actor.user': 'Our counsel',
  'actor.panel': 'Panel',
  'report.loading': 'Loading report…',
  'report.loadFailed': 'Failed to load the report: {error}',
  'report.verdict': 'Tentative conclusion',
  'report.leaning': 'Leaning',
  'report.usWinRate': 'Our win rate',
  'report.confidence': 'Confidence',
  'report.leaningUs': 'Favours us',
  'report.leaningThem': 'Favours them',
  'report.leaningPartial': 'Partially supported',
  'report.leaningUnclear': 'Unclear',
  'report.confidenceHigh': 'high',
  'report.confidenceMedium': 'medium',
  'report.confidenceLow': 'low',
  'report.issues': 'Issues',
  'report.noIssues': 'No issues were produced by this simulation.',
  'report.ourClaims': 'Our position',
  'report.theirClaims': 'Their position',
  'report.weakPoints': 'Weak points',
  'report.evidenceRefs': 'Evidence refs',
  'report.anchors': 'Anchors',
  'report.articles': 'Statutes',
  'report.cases': 'Cases',
  'report.score': 'Score',
  'report.attacks': 'Attack vectors',
  'report.noAttacks': 'No notable attack vectors identified.',
  'report.attackFromOpponent': 'From opponent',
  'report.attackFromJudge': 'From judge',
  'report.severityHigh': 'high',
  'report.severityMedium': 'medium',
  'report.severityLow': 'low',
  'report.gaps': 'Evidence & document gaps',
  'report.noGaps': 'No notable gaps.',
  'report.gapReason': 'Reason',
  'report.suggestions': 'Suggestions',
  'report.noSuggestions': 'No suggestions.',
  'report.priorityHigh': 'High priority',
  'report.priorityMedium': 'Medium priority',
  'report.priorityLow': 'Low priority',
  'report.kindEvidence': 'Evidence',
  'report.kindDocument': 'Document',
  'report.kindStrategy': 'Strategy',
  'report.proceduralNotes': 'Procedural notes',
  'report.boundaries': 'Simulation boundaries',
  'report.judgment': 'Simulated judgment',
  'report.judgmentEmpty': 'No judgment was generated for this session.',
  'report.retrieval': 'Retrieval anchoring',
  'report.retrievalOn': 'Enabled, {n} citations',
  'report.retrievalOff': 'Disabled (unanchored)',
  'report.retrievalDegraded': 'Anchoring degraded: {reason}',
  'report.budget': 'Token usage',
  'report.budgetTruncated': '(truncated at budget)',
  'report.generatedAt': 'Generated {time}',
  'report.writeback': 'Write back as case tasks',
  'report.writebacking': 'Writing back…',
  'report.writebackHint': 'Writes task records only — no files are created.',
  'report.writebackDone': 'Wrote back {n} tasks.',
  'report.writebackFailed': 'Write-back failed: {error}',
  'report.writebackDisabled': 'No case is linked, so there is nothing to write back.',
  'report.tasks': 'Created tasks',
  'report.notFound': 'No report found for this session.',
  'report.refresh': 'Refresh report',
}
