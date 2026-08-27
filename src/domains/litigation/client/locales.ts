/** Locale dictionaries for the litigation plugin. */

export interface LitigationKey {
  [key: string]: string
  'entry.label': string
  'entry.tooltip': string
  'panel.title': string
  'panel.subtitle': string
  // mobile
  'mobile.nav.cases': string
  'mobile.nav.new': string
  'mobile.nav.agent': string
  'panel.health': string
  'panel.healthError': string
  // board
  'board.totalCases': string
  'board.visible': string
  'board.closed': string
  'board.search': string
  'board.filterType': string
  'board.filterStatus': string
  'board.all': string
  'board.allStatus': string
  'board.sort': string
  'board.sortRecent': string
  'board.sortNext': string
  'board.sortId': string
  'board.sortAmount': string
  'board.gridView': string
  'board.boardView': string
  'board.import': string
  'board.newCase': string
  'board.empty': string
  'board.updatedHint': string
  'board.active': string
  'board.type': string
  'board.status': string
  'board.sortBy': string
  'board.overdue': string
  'board.pendingTasks': string
  'board.urgent': string
  'board.noMatch': string
  'board.registerFirst': string
  // card
  'card.amount': string
  'card.nextKeyDate': string
  'card.delete': string
  'card.ourSide': string
  'card.counterparty': string
  'card.caseNo': string
  'card.cause': string
  'card.today': string
  'card.tomorrow': string
  'card.daysLater': string
  'card.pending': string
  // modal
  'modal.title': string
  'modal.close': string
  'modal.name': string
  'modal.namePlaceholder': string
  'modal.type': string
  'modal.cause': string
  'modal.causePlaceholder': string
  'modal.level': string
  'modal.claimAmount': string
  'modal.amountPlaceholder': string
  'modal.court': string
  'modal.courtPlaceholder': string
  'modal.judge': string
  'modal.judgePlaceholder': string
  'modal.filingDate': string
  'modal.ourSide': string
  'modal.sidePlaintiff': string
  'modal.sideDefendant': string
  'modal.plaintiff': string
  'modal.plaintiffPlaceholder': string
  'modal.defendant': string
  'modal.defendantPlaceholder': string
  'modal.nameRequired': string
  'modal.cancel': string
  'modal.submit': string
  'modal.submitting': string
  'modal.section.category': string
  'modal.section.case': string
  'modal.section.parties': string
  'modal.section.folder': string
  'modal.folder': string
  'modal.folderPick': string
  'modal.folderPlaceholder': string
  'modal.folderHint': string
  // detail (M3)
  'detail.back': string
  'detail.deleteCase': string
  'detail.deleteConfirm': string
  'detail.tab.overview': string
  'detail.tab.tasks': string
  'detail.tab.timeline': string
  'detail.tab.schedule': string
  'detail.basicInfo': string
  'detail.parties': string
  'detail.keySchedule': string
  'detail.addSchedule': string
  'detail.noSchedule': string
  'detail.tasks': string
  'detail.overview': string
  'detail.procedureJourney': string
  'detail.noProcedure': string
  'detail.current': string
  'detail.caseTimeline': string
  'detail.ourSide': string
  'detail.folder': string
  'detail.folderBind': string
  'detail.folderChange': string
  'detail.noFolder': string
  // overview
  'overview.parties': string
  'overview.noParties': string
  'overview.summary': string
  'overview.summaryPlaceholder': string
  'overview.keyDates': string
  'overview.noKeyDates': string
  'overview.keyDateLabel': string
  'overview.addKeyDate': string
  // tasks
  'tasks.empty': string
  'tasks.addGroup': string
  'tasks.groupName': string
  'tasks.addTask': string
  'tasks.addSubtask': string
  'tasks.deleteGroup': string
  'tasks.deleteTask': string
  'tasks.deleteSubtask': string
  'tasks.moveUp': string
  'tasks.moveDown': string
  'tasks.expand': string
  'tasks.collapse': string
  'tasks.cycleStatus': string
  'tasks.checklistProgress': string
  'tasks.add': string
  'tasks.cancel': string
  'tasks.keydateBadge': string
  'tasks.keydateOn': string
  'tasks.keydateOff': string
  'tasks.keydateNeedDeadline': string
  'tasks.keydateTooltip': string
  // timeline
  'timeline.empty': string
  'timeline.addEvent': string
  'timeline.edit': string
  'timeline.delete': string
  'timeline.complete': string
  'timeline.reopen': string
  'timeline.titlePlaceholder': string
  'timeline.remindDaysPlaceholder': string
  'timeline.save': string
  'timeline.cancel': string
  // schedule
  'schedule.title': string
  'schedule.empty': string
  'schedule.urgent': string
  // import
  'import.title': string
  'import.hint': string
  'import.sourceDir': string
  'import.sourcePlaceholder': string
  'import.run': string
  'import.running': string
  'import.result': string
  // 诉讼管家 agent
  'import.skipped': string
  'import.done': string
  'agent.title': string
  'agent.launchHint': string
  // updater (settings → 插件版本与更新)
  'updater.title': string
  'updater.currentPlugin': string
  'updater.channel': string
  'updater.checkNow': string
  'updater.checking': string
  'updater.checkFailed': string
  'updater.retry': string
  'updater.updateNow': string
  'updater.upToDate': string
  'updater.updating': string
  'updater.confirm': string
  'updater.updated': string
  'updater.skipped': string
  'updater.restartHint': string
  'updater.backup': string
  'updater.recheck': string
  'updater.footer': string
  'updater.releases': string
}

export const zh: LitigationKey = {
  'entry.label': '诉讼案件',
  'entry.tooltip': '案件看板 / 任务树 / 时间轴 / 日程',
  'panel.title': '诉讼案件',
  'panel.subtitle': 'AgentLex 案件管理',
  'mobile.nav.cases': '案件',
  'mobile.nav.new': '新建',
  'mobile.nav.agent': '管家',
  'panel.health': '宿主状态',
  'panel.healthError': '宿主半未响应',
  // board
  'board.totalCases': '全部案件',
  'board.visible': '当前视图',
  'board.closed': '已结案',
  'board.search': '搜索案名 / 编号 / 当事人 / 法院…',
  'board.filterType': '类型筛选',
  'board.filterStatus': '状态筛选',
  'board.all': '全部',
  'board.allStatus': '全部状态',
  'board.sort': '排序',
  'board.sortRecent': '最近更新',
  'board.sortNext': '下次关键节点',
  'board.sortId': '编号（倒序）',
  'board.sortAmount': '诉讼标的',
  'board.gridView': '网格视图',
  'board.boardView': '看板视图',
  'board.import': '导入数据',
  'board.newCase': '新建案件',
  'board.empty': '暂无案件。点击「新建案件」登记第一个案件，或从 AgentLex 导入已有数据。',
  'board.updatedHint': '数据更新于',
  'board.active': '在办',
  'board.type': '类型',
  'board.status': '状态',
  'board.sortBy': '排序 · ',
  'board.overdue': '项逾期',
  'board.pendingTasks': '项待办',
  'board.urgent': '紧急日程',
  'board.noMatch': '没有符合条件的案件',
  'board.registerFirst': '注册第一个案件 →',
  // card
  'card.amount': '标的',
  'card.nextKeyDate': '下次节点',
  'card.delete': '删除案件',
  'card.ourSide': '我方',
  'card.counterparty': '对方',
  'card.caseNo': '案号',
  'card.cause': '案由',
  'card.today': '今天',
  'card.tomorrow': '明天',
  'card.daysLater': '{n}天后',
  'card.pending': '待定',
  // modal
  'modal.title': '新建案件',
  'modal.close': '关闭',
  'modal.name': '案件名称',
  'modal.namePlaceholder': '如：张三诉李四合同纠纷案',
  'modal.type': '案件类型',
  'modal.cause': '案由',
  'modal.causePlaceholder': '选择案由',
  'modal.level': '审级',
  'modal.claimAmount': '诉讼标的',
  'modal.amountPlaceholder': '如 100000 或 10万',
  'modal.court': '受理法院',
  'modal.courtPlaceholder': '如：海淀区人民法院',
  'modal.judge': '承办法官',
  'modal.judgePlaceholder': '如：王法官',
  'modal.filingDate': '立案日期',
  'modal.ourSide': '我方身份',
  'modal.sidePlaintiff': '原告',
  'modal.sideDefendant': '被告',
  'modal.plaintiff': '原告名称',
  'modal.plaintiffPlaceholder': '如：张三',
  'modal.defendant': '被告名称',
  'modal.defendantPlaceholder': '如：李四公司',
  'modal.nameRequired': '请填写案件名称',
  'modal.cancel': '取消',
  'modal.submit': '登记案件',
  'modal.submitting': '登记中…',
  'modal.section.category': '案件分类',
  'modal.section.case': '办案信息',
  'modal.section.parties': '当事人',
  'modal.section.folder': '卷宗文件夹',
  'modal.folder': '文件夹路径',
  'modal.folderPick': '选择…',
  'modal.folderPlaceholder': '如：/Users/yourname/案件卷宗/2025-003 或留空',
  'modal.folderHint': '选填。绑定案件卷宗目录后，AgentLex 可读取其中的文书与证据材料。',
  // detail (M3)
  'detail.back': '返回看板',
  'detail.deleteCase': '删除案件',
  'detail.deleteConfirm': '确定删除案件「{name}」？此操作不可撤销。',
  'detail.tab.overview': '总览',
  'detail.tab.tasks': '任务树',
  'detail.tab.timeline': '时间轴',
  'detail.tab.schedule': '日程',
  'detail.basicInfo': '案件基本信息',
  'detail.parties': '当事人信息',
  'detail.keySchedule': '关键日程',
  'detail.addSchedule': '添加日程',
  'detail.noSchedule': '暂无未来日程',
  'detail.tasks': '任务拆解',
  'detail.overview': '案件概述',
  'detail.procedureJourney': '审级历程',
  'detail.noProcedure': '暂无审级记录',
  'detail.current': '当前',
  'detail.caseTimeline': '办案时间轴',
  'detail.ourSide': '我方',
  'detail.folder': '卷宗文件夹',
  'detail.folderBind': '绑定文件夹',
  'detail.folderChange': '更换',
  'detail.noFolder': '尚未绑定卷宗文件夹。绑定后 AgentLex 可读取其中的文书与证据。',
  // overview
  'overview.parties': '当事人',
  'overview.noParties': '尚未登记当事人。',
  'overview.summary': '案情摘要',
  'overview.summaryPlaceholder': '输入案情摘要，失焦自动保存…',
  'overview.keyDates': '关键日期',
  'overview.noKeyDates': '尚未添加关键日期。',
  'overview.keyDateLabel': '日期名称，如：开庭',
  'overview.addKeyDate': '添加',
  // tasks
  'tasks.empty': '尚未创建任务。点击下方「添加阶段」建立任务树。',
  'tasks.addGroup': '添加阶段',
  'tasks.groupName': '阶段名称，如：一审阶段',
  'tasks.addTask': '添加任务…',
  'tasks.addSubtask': '子任务',
  'tasks.deleteGroup': '删除阶段',
  'tasks.deleteTask': '删除任务',
  'tasks.deleteSubtask': '删除子任务',
  'tasks.moveUp': '上移',
  'tasks.moveDown': '下移',
  'tasks.expand': '展开',
  'tasks.collapse': '收起',
  'tasks.cycleStatus': '切换状态（待办→进行中→已完成）',
  'tasks.checklistProgress': '检查项进度',
  'tasks.add': '添加',
  'tasks.cancel': '取消',
  'tasks.keydateBadge': '已挂提醒 {date}',
  'tasks.keydateOn': '挂提醒',
  'tasks.keydateOff': '解除提醒',
  'tasks.keydateNeedDeadline': '需先为任务设置截止日期',
  'tasks.keydateTooltip': '该任务已挂关键日期提醒（{date}），随任务双向联动',
  // timeline
  'timeline.empty': '暂无时间轴事件。点击「添加事件」记录立案、开庭、送达等节点。',
  'timeline.addEvent': '添加事件',
  'timeline.edit': '编辑',
  'timeline.delete': '删除',
  'timeline.complete': '已完成',
  'timeline.reopen': '重新打开',
  'timeline.titlePlaceholder': '事件名称，如：第一次开庭',
  'timeline.remindDaysPlaceholder': '提醒（天数）',
  'timeline.save': '保存',
  'timeline.cancel': '取消',
  // schedule
  'schedule.title': '日程',
  'schedule.empty': '暂无日程。时间轴事件、任务期限与关键日期会自动汇入此处。',
  'schedule.urgent': '临近',
  // import
  'import.title': '从 AgentLex 导入',
  'import.hint': '将读取 ~/.myagents/agentlex/ 的案件与时间轴数据（只读，不修改源文件），按案件编号幂等合并到本插件。',
  'import.sourceDir': '数据目录',
  'import.sourcePlaceholder': '留空使用默认 ~/.myagents/agentlex',
  'import.run': '开始导入',
  'import.running': '导入中…',
  'import.result': '导入完成：新增 {added} 个案件，更新 {updated} 个，导入 {events} 个时间轴事件。',
  'import.skipped': '跳过 {skipped} 个草稿/无效案件。',
  'import.done': '完成',
  'agent.title': '诉讼管家',
  'agent.launchHint': '打开诉讼管家（系统 Agent 会话，预设已应用）',
  'updater.title': '插件版本与更新',
  'updater.currentPlugin': '当前插件 v{version}',
  'updater.channel': '发布通道：公共 npm registry',
  'updater.checking': '正在检测新版本',
  'updater.checkNow': '检查更新',
  'updater.checkFailed': '检测失败',
  'updater.retry': '重新检查',
  'updater.updateNow': '立即更新（{n} 个包）',
  'updater.upToDate': '所有插件已是最新版本',
  'updater.updating': '正在下载并更新插件',
  'updater.confirm': '将更新 {n} 个插件：更新前会先备份旧版本到 agentlex-backups，更新完成后需重启 DSH 生效。确认继续？',
  'updater.updated': '已更新 {n} 个插件',
  'updater.skipped': '另有 {n} 个包已是最新，跳过',
  'updater.restartHint': '更新完成。请重启 DSH（关闭并重新打开桌面端，或重启 dsh web 服务）后生效。',
  'updater.backup': '旧版本备份于：{dir}',
  'updater.recheck': '再次检查',
  'updater.footer': '版本检测与更新通过公共 npm registry 完成；发布说明与更新历史见：',
  'updater.releases': '版本发布记录',
  // 诉讼管家 agent
}

export const en: LitigationKey = {
  'entry.label': 'Litigation',
  'entry.tooltip': 'Case board / task tree / timeline / schedule',
  'panel.title': 'Litigation',
  'panel.subtitle': 'AgentLex case management',
  'mobile.nav.cases': 'Cases',
  'mobile.nav.new': 'New',
  'mobile.nav.agent': 'Agent',
  'panel.health': 'Host status',
  'panel.healthError': 'Host half not responding',
  // board
  'board.totalCases': 'All cases',
  'board.visible': 'Shown',
  'board.closed': 'Closed',
  'board.search': 'Search name / id / party / court…',
  'board.filterType': 'Type filter',
  'board.filterStatus': 'Status filter',
  'board.all': 'All',
  'board.allStatus': 'All statuses',
  'board.sort': 'Sort',
  'board.sortRecent': 'Recently updated',
  'board.sortNext': 'Next key date',
  'board.sortId': 'Id (desc)',
  'board.sortAmount': 'Claim amount',
  'board.gridView': 'Grid',
  'board.boardView': 'Board',
  'board.import': 'Import',
  'board.newCase': 'New case',
  'board.empty': 'No cases yet. Register your first case, or import existing data from AgentLex.',
  'board.updatedHint': 'Data updated',
  'board.active': 'Active',
  'board.type': 'Type',
  'board.status': 'Status',
  'board.sortBy': 'Sort · ',
  'board.overdue': ' overdue',
  'board.pendingTasks': ' pending',
  'board.urgent': 'urgent dates',
  'board.noMatch': 'No matching cases',
  'board.registerFirst': 'Register your first case →',
  // card
  'card.amount': 'Amt',
  'card.nextKeyDate': 'Next',
  'card.delete': 'Delete case',
  'card.ourSide': 'Ours',
  'card.counterparty': 'Theirs',
  'card.caseNo': 'Case no.',
  'card.cause': 'Cause',
  'card.today': 'today',
  'card.tomorrow': 'tomorrow',
  'card.daysLater': 'in {n}d',
  'card.pending': 'TBD',
  // modal
  'modal.title': 'New case',
  'modal.close': 'Close',
  'modal.name': 'Case name',
  'modal.namePlaceholder': 'e.g. Zhang v. Li contract dispute',
  'modal.type': 'Type',
  'modal.cause': 'Cause',
  'modal.causePlaceholder': 'Choose a cause',
  'modal.level': 'Procedure',
  'modal.claimAmount': 'Claim amount',
  'modal.amountPlaceholder': 'e.g. 100000',
  'modal.court': 'Court',
  'modal.courtPlaceholder': 'e.g. Haidian District Court',
  'modal.judge': 'Judge',
  'modal.judgePlaceholder': 'e.g. Judge Wang',
  'modal.filingDate': 'Filing date',
  'modal.ourSide': 'Our side',
  'modal.sidePlaintiff': 'Plaintiff',
  'modal.sideDefendant': 'Defendant',
  'modal.plaintiff': 'Plaintiff',
  'modal.plaintiffPlaceholder': 'e.g. Zhang San',
  'modal.defendant': 'Defendant',
  'modal.defendantPlaceholder': 'e.g. Li Si Co.',
  'modal.nameRequired': 'Case name is required',
  'modal.cancel': 'Cancel',
  'modal.submit': 'Register case',
  'modal.submitting': 'Registering…',
  'modal.section.category': 'Category',
  'modal.section.case': 'Case info',
  'modal.section.parties': 'Parties',
  'modal.section.folder': 'Case folder',
  'modal.folder': 'Folder path',
  'modal.folderPick': 'Browse…',
  'modal.folderPlaceholder': 'e.g. /Users/yourname/cases/2025-003 or leave empty',
  'modal.folderHint': 'Optional. Bind the case folder so AgentLex can read its documents and evidence.',
  // detail (M3)
  'detail.back': 'Back to board',
  'detail.deleteCase': 'Delete case',
  'detail.deleteConfirm': 'Delete case "{name}"? This cannot be undone.',
  'detail.tab.overview': 'Overview',
  'detail.tab.tasks': 'Tasks',
  'detail.tab.timeline': 'Timeline',
  'detail.tab.schedule': 'Schedule',
  'detail.basicInfo': 'Case info',
  'detail.parties': 'Parties',
  'detail.keySchedule': 'Key schedule',
  'detail.addSchedule': 'Add',
  'detail.noSchedule': 'No upcoming dates',
  'detail.tasks': 'Tasks',
  'detail.overview': 'Overview',
  'detail.procedureJourney': 'Procedure',
  'detail.noProcedure': 'No procedure records',
  'detail.current': 'current',
  'detail.caseTimeline': 'Timeline',
  'detail.ourSide': 'Ours',
  'detail.folder': 'Case folder',
  'detail.folderBind': 'Bind folder',
  'detail.folderChange': 'Change',
  'detail.noFolder': 'No case folder bound. Binding lets AgentLex read its documents and evidence.',
  // overview
  'overview.parties': 'Parties',
  'overview.noParties': 'No parties registered yet.',
  'overview.summary': 'Summary',
  'overview.summaryPlaceholder': 'Enter a case summary; auto-saves on blur…',
  'overview.keyDates': 'Key dates',
  'overview.noKeyDates': 'No key dates yet.',
  'overview.keyDateLabel': 'Label, e.g. hearing',
  'overview.addKeyDate': 'Add',
  // tasks
  'tasks.empty': 'No tasks yet. Click "Add stage" to build the task tree.',
  'tasks.addGroup': 'Add stage',
  'tasks.groupName': 'Stage name, e.g. first instance',
  'tasks.addTask': 'Add task…',
  'tasks.addSubtask': 'Subtask',
  'tasks.deleteGroup': 'Delete stage',
  'tasks.deleteTask': 'Delete task',
  'tasks.deleteSubtask': 'Delete subtask',
  'tasks.moveUp': 'Move up',
  'tasks.moveDown': 'Move down',
  'tasks.expand': 'Expand',
  'tasks.collapse': 'Collapse',
  'tasks.cycleStatus': 'Cycle status (todo → doing → done)',
  'tasks.checklistProgress': 'Checklist progress',
  'tasks.add': 'Add',
  'tasks.cancel': 'Cancel',
  'tasks.keydateBadge': 'Reminder {date}',
  'tasks.keydateOn': 'Set reminder',
  'tasks.keydateOff': 'Clear reminder',
  'tasks.keydateNeedDeadline': 'Set a deadline first',
  'tasks.keydateTooltip': 'This task carries a key-date reminder ({date}), synced with the task',
  // timeline
  'timeline.empty': 'No timeline events yet. Add filing, hearing, service…',
  'timeline.addEvent': 'Add event',
  'timeline.edit': 'Edit',
  'timeline.delete': 'Delete',
  'timeline.complete': 'Done',
  'timeline.reopen': 'Reopen',
  'timeline.titlePlaceholder': 'Event title, e.g. first hearing',
  'timeline.remindDaysPlaceholder': 'Remind (days)',
  'timeline.save': 'Save',
  'timeline.cancel': 'Cancel',
  // schedule
  'schedule.title': 'Schedule',
  'schedule.empty': 'No schedule yet. Timeline events, task deadlines and key dates merge here.',
  'schedule.urgent': 'Soon',
  // import
  'import.title': 'Import from AgentLex',
  'import.hint': 'Reads ~/.myagents/agentlex/ cases and timeline (read-only; source files untouched) and merges idempotently by case id.',
  'import.sourceDir': 'Data directory',
  'import.sourcePlaceholder': 'Leave empty for default ~/.myagents/agentlex',
  'import.run': 'Start import',
  'import.running': 'Importing…',
  'import.result': 'Done: {added} added, {updated} updated, {events} timeline events imported.',
  'import.skipped': 'Skipped {skipped} drafts / invalid cases.',
  'import.done': 'Done',
  'agent.title': 'Litigation Manager',
  'agent.launchHint': 'Open the litigation manager (system agent session with the preset applied)',
  'updater.title': 'Plugin version & updates',
  'updater.currentPlugin': 'Litigation plugin v{version}',
  'updater.channel': 'Channel: public npm registry',
  'updater.checking': 'Checking for updates',
  'updater.checkNow': 'Check for updates',
  'updater.checkFailed': 'Update check failed',
  'updater.retry': 'Check again',
  'updater.updateNow': 'Update now ({n} packages)',
  'updater.upToDate': 'All plugins are up to date',
  'updater.updating': 'Downloading and updating plugins',
  'updater.confirm': 'Update {n} plugins? Old versions are backed up to agentlex-backups first; DSH must be restarted afterwards. Continue?',
  'updater.updated': 'Updated {n} plugins',
  'updater.skipped': '{n} other packages already up to date, skipped',
  'updater.restartHint': 'Update complete. Restart DSH (quit and reopen the desktop app, or restart the dsh web service) to apply.',
  'updater.backup': 'Backup: {dir}',
  'updater.recheck': 'Check again',
  'updater.footer': 'Version checks and updates run through the public npm registry; release notes and history:',
  'updater.releases': 'release history',
  // 诉讼管家 agent
}
