/** Locale dictionaries for the ideas (想法/备忘) plugin. */

export interface IdeaKey {
  [key: string]: string
  'entry.label': string
  'entry.tooltip': string
  'panel.title': string
  'panel.subtitle': string
  'add.placeholder': string
  'add.btn': string
  'add.titlePh': string
  'add.contentPh': string
  'add.casePh': string
  'add.tagsPh': string
  'add.save': string
  'add.cancel': string
  'add.editing': string
  'tab.all': string
  'tab.active': string
  'tab.done': string
  'tab.archived': string
  'filter.case': string
  'filter.allCases': string
  'filter.search': string
  'actions.done': string
  'actions.undo': string
  'actions.archive': string
  'actions.unarchive': string
  'actions.reference': string
  'actions.copyRef': string
  'actions.delete': string
  'actions.deleteConfirm': string
  'stats.total': string
  'stats.active': string
  'stats.done': string
  'stats.archived': string
  'empty': string
  'emptyNoMatch': string
  'status.active': string
  'status.done': string
  'status.archived': string
  'saved': string
  'copied': string
  'error': string
  // mobile
  'mobile.titlePh': string
  'mobile.contentPh': string
}

const zh: IdeaKey = {
  'entry.label': '想法',
  'entry.tooltip': '时刻记录想法 / 备忘，可在会话输入框用 # 引用',
  'panel.title': '想法',
  'panel.subtitle': '随手记 · 可关联案件 · 输入框 # 引用',
  'add.placeholder': '快速记一条…（回车保存）',
  'add.btn': '+ 记录',
  'add.titlePh': '标题（必填）',
  'add.contentPh': '正文…',
  'add.casePh': '关联案件编号（可选）',
  'add.tagsPh': '标签（逗号分隔）',
  'add.save': '保存',
  'add.cancel': '取消',
  'add.editing': '编辑想法',
  'tab.all': '全部',
  'tab.active': '进行中',
  'tab.done': '已完成',
  'tab.archived': '已归档',
  'filter.case': '案件',
  'filter.allCases': '全部案件',
  'filter.search': '搜索想法…',
  'actions.done': '完成',
  'actions.undo': '恢复',
  'actions.archive': '归档',
  'actions.unarchive': '移出归档',
  'actions.reference': '引用',
  'actions.copyRef': '复制引用',
  'actions.delete': '删除',
  'actions.deleteConfirm': '确定删除这条想法？',
  'stats.total': '全部',
  'stats.active': '进行中',
  'stats.done': '已完成',
  'stats.archived': '已归档',
  'empty': '还没有想法。可在上方快速记一条。',
  'emptyNoMatch': '没有匹配的想法。',
  'status.active': '进行中',
  'status.done': '已完成',
  'status.archived': '已归档',
  'saved': '已保存',
  'copied': '已复制',
  'error': '操作失败',
  'mobile.titlePh': '标题（必填）',
  'mobile.contentPh': '正文…',
}

const en: IdeaKey = {
  'entry.label': 'Ideas',
  'entry.tooltip': 'Capture ideas / notes; reference with # in the input box',
  'panel.title': 'Ideas',
  'panel.subtitle': 'Quick notes · link to cases · reference with #',
  'add.placeholder': 'Quick note… (Enter to save)',
  'add.btn': '+ Add',
  'add.titlePh': 'Title (required)',
  'add.contentPh': 'Body…',
  'add.casePh': 'Case id (optional)',
  'add.tagsPh': 'Tags (comma separated)',
  'add.save': 'Save',
  'add.cancel': 'Cancel',
  'add.editing': 'Edit idea',
  'tab.all': 'All',
  'tab.active': 'Active',
  'tab.done': 'Done',
  'tab.archived': 'Archived',
  'filter.case': 'Case',
  'filter.allCases': 'All cases',
  'filter.search': 'Search ideas…',
  'actions.done': 'Done',
  'actions.undo': 'Undo',
  'actions.archive': 'Archive',
  'actions.unarchive': 'Restore',
  'actions.reference': 'Reference',
  'actions.copyRef': 'Copy ref',
  'actions.delete': 'Delete',
  'actions.deleteConfirm': 'Delete this idea?',
  'stats.total': 'All',
  'stats.active': 'Active',
  'stats.done': 'Done',
  'stats.archived': 'Archived',
  'empty': 'No ideas yet. Add one above.',
  'emptyNoMatch': 'No matching ideas.',
  'status.active': 'Active',
  'status.done': 'Done',
  'status.archived': 'Archived',
  'saved': 'Saved',
  'copied': 'Copied',
  'error': 'Operation failed',
  'mobile.titlePh': 'Title (required)',
  'mobile.contentPh': 'Body…',
}

export { en, zh }
