/** Locale dictionaries for the non-litigation plugin. */

export interface NonLitigationKey {
  [key: string]: string
  'entry.label': string
  'entry.tooltip': string
  'panel.title': string
  'panel.subtitle': string
  // mobile
  'mobile.nav.projects': string
  'mobile.nav.services': string
  'mobile.nav.newProject': string
  'service.projects': string
  'service.services': string
  'board.totalProjects': string
  'board.active': string
  'board.completed': string
  'board.overdue': string
  'board.expiring': string
  'board.type': string
  'board.status': string
  'board.sortBy': string
  'board.sortRecent': string
  'board.sortNext': string
  'board.sortId': string
  'board.sortProgress': string
  'board.search': string
  'board.import': string
  'board.newProject': string
  'board.empty': string
  'board.registerFirst': string
  'board.noMatch': string
  'board.updatedHint': string
  'card.lead': string
  'card.period': string
  'card.scope': string
  'card.daysLeft': string
  'card.today': string
  'card.tomorrow': string
  'card.daysLater': string
  'card.delete': string
  'modal.title': string
  'modal.subtitle': string
  'modal.name': string
  'modal.namePh': string
  'modal.type': string
  'modal.typeRetainer': string
  'modal.typeSpecial': string
  'modal.typeConsult': string
  'modal.status': string
  'modal.statusActive': string
  'modal.statusRetained': string
  'modal.statusCompleted': string
  'modal.lead': string
  'modal.periodStart': string
  'modal.periodEnd': string
  'modal.scope': string
  'modal.scopePh': string
  'modal.folder': string
  'modal.folderPick': string
  'modal.folderPh': string
  'modal.cancel': string
  'modal.create': string
  'modal.submitting': string
  'detail.back': string
  'detail.updated': string
  'detail.lead': string
  'detail.daysLeft': string
  'detail.expired': string
  'detail.taskProgress': string
  'detail.tabOverview': string
  'detail.tabTasks': string
  'detail.tabDates': string
  'detail.tabRelated': string
  'detail.basic': string
  'detail.id': string
  'detail.type': string
  'detail.status': string
  'detail.period': string
  'detail.folder': string
  'detail.folderBind': string
  'detail.folderChange': string
  'detail.scope': string
  'detail.summary': string
  'detail.noSummary': string
  'detail.noTasks': string
  'detail.untitledGroup': string
  'detail.noDates': string
  'detail.noRelated': string
  'detail.contracts': string
  'detail.research': string
  'detail.contract': string
  'detail.researchItem': string
  'detail.done': string
  'detail.overdue': string
  'detail.today': string
  'detail.days': string
  'delete.title': string
  'delete.confirm': string
  'delete.confirmBtn': string
  'svc.done': string
}

const zh: NonLitigationKey = {
  'entry.label': '非诉项目',
  'entry.tooltip': '项目 / 合同审查 / 法律研究 / 常法服务',
  'panel.title': '非诉项目',
  'panel.subtitle': 'AgentLex 非诉业务管理',
  'mobile.nav.projects': '项目',
  'mobile.nav.services': '常法',
  'mobile.nav.newProject': '新建项目',
  'service.projects': '项目',
  'service.services': '常法服务',
  'board.totalProjects': '项目',
  'board.active': '进行中',
  'board.completed': '已完成',
  'board.overdue': '逾期任务',
  'board.expiring': '临近到期',
  'board.type': '类型',
  'board.status': '状态',
  'board.sortBy': '排序·',
  'board.sortRecent': '最近更新',
  'board.sortNext': '最近节点',
  'board.sortId': '编号',
  'board.sortProgress': '进度',
  'board.search': '搜索项目 / 客户 / 负责人…',
  'board.import': '导入',
  'board.newProject': '新建项目',
  'board.empty': '暂无项目',
  'board.registerFirst': '登记第一个项目',
  'board.noMatch': '没有匹配的项目',
  'board.updatedHint': '最近更新',
  'card.lead': '负责人',
  'card.period': '服务期',
  'card.scope': '范围',
  'card.daysLeft': '{n}天后到期',
  'card.today': '今天',
  'card.tomorrow': '明天',
  'card.daysLater': '{n}天后',
  'card.delete': '删除项目',
  'modal.title': '新建项目',
  'modal.subtitle': '登记一个非诉项目（常法 / 专项 / 咨询）',
  'modal.name': '项目 / 客户名称',
  'modal.namePh': '例如：某某公司常年法律顾问',
  'modal.type': '类型',
  'modal.typeRetainer': '常法',
  'modal.typeSpecial': '专项',
  'modal.typeConsult': '咨询',
  'modal.status': '状态',
  'modal.statusActive': '进行中',
  'modal.statusRetained': '已签约',
  'modal.statusCompleted': '已完成',
  'modal.lead': '主办律师',
  'modal.periodStart': '服务开始',
  'modal.periodEnd': '服务结束',
  'modal.scope': '服务范围',
  'modal.scopePh': '如：合同审查 / 法律研究（空格分隔）',
  'modal.folder': '文件夹',
  'modal.folderPick': '选择…',
  'modal.folderPh': '项目文件夹路径',
  'modal.cancel': '取消',
  'modal.create': '创建项目',
  'modal.submitting': '创建中…',
  'detail.back': '← 返回',
  'detail.updated': '更新于',
  'detail.lead': '主办律师：',
  'detail.daysLeft': '{n}天后续费',
  'detail.expired': '服务期已结束',
  'detail.taskProgress': '任务 {done}/{total}',
  'detail.tabOverview': '概览',
  'detail.tabTasks': '任务组',
  'detail.tabDates': '关键日期',
  'detail.tabRelated': '关联',
  'detail.basic': '基本信息',
  'detail.id': '项目编号',
  'detail.type': '类型',
  'detail.status': '状态',
  'detail.period': '服务期',
  'detail.folder': '文件夹',
  'detail.folderBind': '绑定',
  'detail.folderChange': '更换',
  'detail.scope': '服务范围',
  'detail.summary': '项目摘要',
  'detail.noSummary': '暂无摘要',
  'detail.noTasks': '暂无任务组',
  'detail.untitledGroup': '未命名任务组',
  'detail.noDates': '暂无关键日期',
  'detail.noRelated': '暂无关联的合同或研究条目',
  'detail.contracts': '关联合同',
  'detail.research': '关联研究',
  'detail.contract': '合同',
  'detail.researchItem': '研究',
  'detail.done': '已完成',
  'detail.overdue': '已逾期',
  'detail.today': '今天',
  'detail.days': '{n}天后',
  'delete.title': '删除项目',
  'delete.confirm': '确定删除项目「{name}」？此操作不可撤销。',
  'delete.confirmBtn': '删除项目',
  'svc.done': '导入完成：新增项目 {added}，更新 {updated}，服务 {services}',
}

const en: NonLitigationKey = {
  'entry.label': 'Non-litigation',
  'entry.tooltip': 'Projects / Contract review / Research / Services',
  'panel.title': 'Non-litigation',
  'panel.subtitle': 'AgentLex non-litigation management',
  'mobile.nav.projects': 'Projects',
  'mobile.nav.services': 'Retainer',
  'mobile.nav.newProject': 'New Project',
  'service.projects': 'Projects',
  'service.services': 'Services',
  'board.totalProjects': 'Projects',
  'board.active': 'Active',
  'board.completed': 'Completed',
  'board.overdue': 'Overdue',
  'board.expiring': 'Expiring',
  'board.type': 'Type',
  'board.status': 'Status',
  'board.sortBy': 'Sort·',
  'board.sortRecent': 'Recently updated',
  'board.sortNext': 'Next date',
  'board.sortId': 'Project ID',
  'board.sortProgress': 'Progress',
  'board.search': 'Search projects / clients / lawyers…',
  'board.import': 'Import',
  'board.newProject': 'New project',
  'board.empty': 'No projects yet',
  'board.registerFirst': 'Register your first project',
  'board.noMatch': 'No matching projects',
  'board.updatedHint': 'Last updated',
  'card.lead': 'Lead',
  'card.period': 'Period',
  'card.scope': 'Scope',
  'card.daysLeft': '{n}d to expiry',
  'card.today': 'Today',
  'card.tomorrow': 'Tomorrow',
  'card.daysLater': 'in {n}d',
  'card.delete': 'Delete project',
  'modal.title': 'New project',
  'modal.subtitle': 'Register a non-litigation engagement',
  'modal.name': 'Project / client name',
  'modal.namePh': 'e.g. ABC Company retainer',
  'modal.type': 'Type',
  'modal.typeRetainer': 'Retainer',
  'modal.typeSpecial': 'Special',
  'modal.typeConsult': 'Consult',
  'modal.status': 'Status',
  'modal.statusActive': 'Active',
  'modal.statusRetained': 'Retained',
  'modal.statusCompleted': 'Completed',
  'modal.lead': 'Lead lawyer',
  'modal.periodStart': 'Start',
  'modal.periodEnd': 'End',
  'modal.scope': 'Service scope',
  'modal.scopePh': 'e.g. Contract review (space separated)',
  'modal.folder': 'Folder',
  'modal.folderPick': 'Browse…',
  'modal.folderPh': 'Project folder path',
  'modal.cancel': 'Cancel',
  'modal.create': 'Create project',
  'modal.submitting': 'Creating…',
  'detail.back': '← Back',
  'detail.updated': 'Updated',
  'detail.lead': 'Lead: ',
  'detail.daysLeft': '{n}d to renew',
  'detail.expired': 'Service period ended',
  'detail.taskProgress': 'Tasks {done}/{total}',
  'detail.tabOverview': 'Overview',
  'detail.tabTasks': 'Task groups',
  'detail.tabDates': 'Key dates',
  'detail.tabRelated': 'Related',
  'detail.basic': 'Basic info',
  'detail.id': 'Project ID',
  'detail.type': 'Type',
  'detail.status': 'Status',
  'detail.period': 'Period',
  'detail.folder': 'Folder',
  'detail.folderBind': 'Bind',
  'detail.folderChange': 'Change',
  'detail.scope': 'Service scope',
  'detail.summary': 'Summary',
  'detail.noSummary': 'No summary yet',
  'detail.noTasks': 'No task groups',
  'detail.untitledGroup': 'Untitled group',
  'detail.noDates': 'No key dates',
  'detail.noRelated': 'No related contracts or research',
  'detail.contracts': 'Linked contracts',
  'detail.research': 'Linked research',
  'detail.contract': 'Contract',
  'detail.researchItem': 'Research',
  'detail.done': 'Done',
  'detail.overdue': 'Overdue',
  'detail.today': 'Today',
  'detail.days': 'in {n}d',
  'delete.title': 'Delete project',
  'delete.confirm': 'Delete project "{name}"? This cannot be undone.',
  'delete.confirmBtn': 'Delete project',
  'svc.done': 'Imported: {added} added, {updated} updated, {services} services',
}

export { en, zh }
