/** Locale dictionaries for the task-management plugin. */

export interface TaskKey {
  [key: string]: string
  'entry.label': string
  'entry.tooltip': string
  'panel.title': string
  'panel.subtitle': string
  'add.placeholder': string
  'add.btn': string
  'stats.total': string
  'stats.todo': string
  'stats.doing': string
  'stats.done': string
  'stats.overdue': string
  'board.source': string
  'board.status': string
  'board.sortBy': string
  'board.sortRecent': string
  'board.sortDeadline': string
  'board.sortPriority': string
  'board.search': string
  'board.all': string
  'source.standalone': string
  'source.litigation': string
  'source.nonlitigation': string
  'status.todo': string
  'status.doing': string
  'status.done': string
  'status.all': string
  'empty': string
  'emptyNoMatch': string
  'detail.today': string
  // mobile
  'mobile.task.edit': string
  'mobile.task.detail': string
  'mobile.task.close': string
  'mobile.task.readonly': string
  'mobile.task.title': string
  'mobile.task.titleRequired': string
  'mobile.task.detailPh': string
  'mobile.task.priority': string
  'mobile.task.deadline': string
  'mobile.task.save': string
  'mobile.task.saving': string
  'mobile.task.delete': string
  'mobile.task.deleting': string
  'mobile.task.markDone': string
  'mobile.task.markDoing': string
  'mobile.task.markTodo': string
  'priority.low': string
  'priority.medium': string
  'priority.high': string
}

const zh: TaskKey = {
  'entry.label': '任务管理',
  'entry.tooltip': '独立任务 / 统一任务视图',
  'panel.title': '任务管理',
  'panel.subtitle': 'AgentLex 统一任务中心',
  'add.placeholder': '新增独立任务…（回车添加）',
  'add.btn': '+ 添加',
  'stats.total': '任务',
  'stats.todo': '待办',
  'stats.doing': '进行中',
  'stats.done': '已完成',
  'stats.overdue': '逾期',
  'board.source': '来源',
  'board.status': '状态',
  'board.sortBy': '排序·',
  'board.sortRecent': '最近更新',
  'board.sortDeadline': '截止日期',
  'board.sortPriority': '优先级',
  'board.search': '搜索任务…',
  'board.all': '全部',
  'source.standalone': '独立',
  'source.litigation': '诉讼',
  'source.nonlitigation': '非诉',
  'status.todo': '待办',
  'status.doing': '进行中',
  'status.done': '已完成',
  'status.all': '全部状态',
  'empty': '暂无任务。可在上方输入框新增独立任务。',
  'emptyNoMatch': '没有匹配的任务。',
  'detail.today': '今天',
  'mobile.task.edit': '编辑任务',
  'mobile.task.detail': '任务详情',
  'mobile.task.close': '关闭',
  'mobile.task.readonly': '该任务来自{{source}}，请在其对应面板中操作。',
  'mobile.task.title': '标题',
  'mobile.task.titleRequired': '标题不能为空',
  'mobile.task.detailPh': '补充说明…',
  'mobile.task.priority': '优先级',
  'mobile.task.deadline': '截止日期',
  'mobile.task.save': '保存',
  'mobile.task.saving': '保存中…',
  'mobile.task.delete': '删除任务',
  'mobile.task.deleting': '删除中…',
  'mobile.task.markDone': '标记已完成',
  'mobile.task.markDoing': '标记进行中',
  'mobile.task.markTodo': '标记待办',
  'priority.low': '低',
  'priority.medium': '中',
  'priority.high': '高',
}

const en: TaskKey = {
  'entry.label': 'Tasks',
  'entry.tooltip': 'Standalone tasks / Unified task view',
  'panel.title': 'Tasks',
  'panel.subtitle': 'AgentLex unified task center',
  'add.placeholder': 'New standalone task… (Enter to add)',
  'add.btn': '+ Add',
  'stats.total': 'Tasks',
  'stats.todo': 'To do',
  'stats.doing': 'Doing',
  'stats.done': 'Done',
  'stats.overdue': 'Overdue',
  'board.source': 'Source',
  'board.status': 'Status',
  'board.sortBy': 'Sort·',
  'board.sortRecent': 'Recently updated',
  'board.sortDeadline': 'Deadline',
  'board.sortPriority': 'Priority',
  'board.search': 'Search tasks…',
  'board.all': 'All',
  'source.standalone': 'Standalone',
  'source.litigation': 'Litigation',
  'source.nonlitigation': 'Non-litigation',
  'status.todo': 'To do',
  'status.doing': 'Doing',
  'status.done': 'Done',
  'status.all': 'All statuses',
  'empty': 'No tasks yet. Add a standalone task above.',
  'emptyNoMatch': 'No matching tasks.',
  'detail.today': 'Today',
  'mobile.task.edit': 'Edit task',
  'mobile.task.detail': 'Task details',
  'mobile.task.close': 'Close',
  'mobile.task.readonly': 'This task belongs to {{source}} — manage it in that panel.',
  'mobile.task.title': 'Title',
  'mobile.task.titleRequired': 'Title is required',
  'mobile.task.detailPh': 'Add details…',
  'mobile.task.priority': 'Priority',
  'mobile.task.deadline': 'Due date',
  'mobile.task.save': 'Save',
  'mobile.task.saving': 'Saving…',
  'mobile.task.delete': 'Delete task',
  'mobile.task.deleting': 'Deleting…',
  'mobile.task.markDone': 'Mark done',
  'mobile.task.markDoing': 'Mark doing',
  'mobile.task.markTodo': 'Mark to do',
  'priority.low': 'Low',
  'priority.medium': 'Medium',
  'priority.high': 'High',
}

export { en, zh }
