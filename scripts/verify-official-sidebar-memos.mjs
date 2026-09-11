/**
 * 备忘 #30 / #31 / #32 的结构验证 —— 只断言「接线还在」，不管视觉。
 *
 *   #30 官方右边栏接入：自绘面板退役 + 接管官方 files 页 + 会话绑定卷宗优先
 *   #31 案件详情页法官联系电话：字段贯穿 store → 路由 → 工具 → 前端
 *   #32 管家按钮会话数：归档集合进页面即预取（不是点开才纠正）
 *
 * 跑一次 1 秒：node scripts/verify-official-sidebar-memos.mjs
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = process.cwd()
let failures = 0
const check = (name, cond, extra = '') => {
  const ok = Boolean(cond)
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? `  (${extra})` : ''}`)
  if (!ok) failures++
}
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8')

console.log('── #30 官方右边栏：原生树 + 右键功能 + 案件卷宗 tab ──')
const official = read('src/domains/workspace-sidebar/client/official-sidebar.tsx')
check('official-sidebar 模块存在', official.length > 0)
check('**不接管**官方 files kind', !/kind:\s*'files'/.test(official))
check('案件卷宗走独立 kind', /CASE_FILES_KIND = 'agentlex-case-files'/.test(official))
check('案件卷宗 tab 不给引导入口（否则默认页变罗盘）', !/guide:\s*\[/.test(official))
check('正文注册 key = 类型 id', /name: 'sidebar\.right\.pane\.tab', key: CASE_FILES_ID/.test(official))
check('★ 案件卷宗正文包了我们的主题层（套进来才不变样）', /ThemeRuntimeProvider/.test(official))
check('★ 案件卷宗正文用精简工具条', /minimalChrome/.test(official))
const menuSrc = read('src/domains/workspace-sidebar/client/native-tree-menu.tsx')
check('原生树锚点：树容器 + 行', menuSrc.includes('NATIVE_TREE_SELECTOR') && menuSrc.includes('NATIVE_ROW_SELECTOR'))
check('右键事件代理在 document capture', /addEventListener\('contextmenu', onContextMenu, true\)/.test(menuSrc))
for (const route of ['create-file', 'create-folder', 'rename', 'delete', 'open-path']) {
  check(`右键菜单接 /api/agentlex-workspace/${route}`, menuSrc.includes(`/api/agentlex-workspace/${route}`))
}
check('改动后触发原生树自己刷新', menuSrc.includes("'[data-files-reload]'"))
check('宽度自适应：逐帧 settle 收敛（不再依赖 whenStable）', official.includes('startSettle'))
check('会话绑定 → 静默带上卷宗 tab（不抢官方焦点）', official.includes('addCaseTabQuietly') && official.includes('sidebarRight.focus?.('))
check('观察右边栏开合后补绑定检查', official.includes('data-rightbar-collapsed') && official.includes('MutationObserver'))
check('详情页「在侧边栏打开」可定向任意卷宗', official.includes('setFolderOverride'))

console.log('\n── #30 二次反馈的五项 ──')
const official2 = read('src/domains/workspace-sidebar/client/official-sidebar.tsx')
check('① 手动切换目录不再被 caseFolder 顶回', /caseFolder=\{!minimalChrome && rootSource === 'auto'/.test(read('src/domains/workspace-sidebar/client/WorkspacePanel.tsx')))
check('② 文件打开走 DSH 原生预览（资源地址）', official2.includes('dsh-resource://file/session/') && official2.includes('openResource'))
check('② 自带预览弹层关闭（onFilePreviewExternal）', read('src/domains/workspace-sidebar/client/WorkspacePanel.tsx').includes('onFilePreviewExternal={onOpenFileNative'))
check('② DirectoryPanel 全部预览入口让位原生', (read('src/domains/workspace-sidebar/client/DirectoryPanel.tsx').match(/onOpenFileNative/g) ?? []).length >= 5)
check('② 相对路径拼绝对（否则原生预览找不到文件）', official2.includes('toAbsolute') || read('src/domains/workspace-sidebar/client/WorkspacePanel.tsx').includes('function toAbsolute'))
check('③ 宽度自适应控制器在位', official2.includes('installAdaptiveRightbarWidth') && official2.includes('NARROW_WIDTH') && official2.includes('WIDE_MIN'))
check('③ 活动 tab 判定限定在右边栏列内（会话 tab 条也含 _tabActive）', official2.includes("rightbarCol") && official2.includes('activeTabTitle'))
check('③ 用户手动拖过就交还控制权', official2.includes('userTookOver'))
check('④ 控件簇常驻「案件卷宗」图标按钮', official2.includes('mountCaseTabButton') && official2.includes('dataset.agentlexCaseTab'))
check('④ 按钮在 React 重建 tab 条后自愈', official2.includes('setInterval(ensure'))
check('⑤ 设置项已适配新语义（右侧文件栏 / 自动打开案件卷宗）', read('src/domains/skin/client/settings-section.tsx').includes('自动打开案件卷宗'))
const skinIndex = read('src/domains/skin/index.ts')
check('⑤ 新键 autoOpenCaseTab + 旧键仅作回退', skinIndex.includes('autoOpenCaseTab') && skinIndex.includes('config.openReferencesInSidebar ?? true'))
check('⑤ 设置页不再写旧键', !read('src/domains/skin/client/settings-section.tsx').includes('commitSetting(\'openReferencesInSidebar\''))

console.log('\n── #30 三次反馈：标题 / 原生预览不被打断 / 图标按钮 ──')
const wsPanel2 = read('src/domains/workspace-sidebar/client/WorkspacePanel.tsx')
check('① 标题跟随当前根（不再恒显案件名）', wsPanel2.includes('currentBase') && /currentRoot === binding\.folder/.test(wsPanel2))
check('① 「返回卷宗」会清掉外部根覆盖', wsPanel2.includes('onClearPreferredRoot'))
check('② 会话链接拦截不再吃掉右边栏内的点击（md 打不开的根因）',
  read('src/domains/workspace-sidebar/client/conversation-links.ts').includes('[class*="rightbarCol"]'))
const nativeMenu = read('src/domains/workspace-sidebar/client/native-tree-menu.tsx')
check('② 原生树右键菜单已独立成模块（防再次误删）', nativeMenu.includes('export function mountNativeTreeContextMenu'))
check('② official-sidebar 从独立模块引入', read('src/domains/workspace-sidebar/client/official-sidebar.tsx').includes("from './native-tree-menu.tsx'"))
check('③ 「案件卷宗」按钮改为图标按钮（无文字）', !/button\.textContent = '案件卷宗'/.test(read('src/domains/workspace-sidebar/client/official-sidebar.tsx')))
check('③ 按钮放进官方控件簇 _stripChrome', read('src/domains/workspace-sidebar/client/official-sidebar.tsx').includes('_stripChrome'))

console.log('\n── #30 四次反馈：单一右键菜单 / 会话菜单加入口 ──')
const linkSrc = read('src/domains/workspace-sidebar/client/conversation-links.ts')
check('① 卷宗树里不再叠第二个右键菜单（按右栏列整体排除）',
  (linkSrc.match(/\[class\*="rightbarCol"\]/g) ?? []).length >= 2)
check('① 自己的卷宗面板也排除', linkSrc.includes("target.closest('[data-agentlex-workspace-root]')"))
check('② 会话右键菜单新增「在侧边栏打开」', linkSrc.includes("item('在侧边栏打开'"))
check('② 「在侧边栏打开」对任意路径都可用（不再只 md）',
  /el\.appendChild\(item\('在侧边栏打开'/.test(linkSrc))
check('② 去掉重复的「在边栏预览」（与「在侧边栏打开」同义）',
  !linkSrc.includes("在边栏预览"))
check('② 文件一步到位：直接开原生预览（不再等 tab 挂载）',
  official2.includes('openNativeResource') && !official2.includes('openNativeFileRef'))
check('② 卷宗面板静默补入（不抢焦点）', official2.includes('addCaseTabQuietly()') && /addCaseTabQuietly[\s\S]*openNativeResource/.test(official2))
check('② 文件路径解析：裸文件名先在绑定卷宗里找', official2.includes('resolveRevealPath') && official2.includes('queryBinding'))
check('② 文件 → 树根落所在目录 + 送进原生预览', official2.includes('openNativeResource') && /resolved\.slice\(0, lastSlash\)/.test(official2))

console.log('\n── #30 六次反馈：一步开文件 / 菜单统一 / 首开无闪宽 ──')
const official3 = read('src/domains/workspace-sidebar/client/official-sidebar.tsx')
const menu3 = read('src/domains/workspace-sidebar/client/native-tree-menu.tsx')
check('① 会话点 md 只开文件（不再先开卷宗面板）',
  /isFileLike && lastSlash > 0[\s\S]{0,400}openNativeResource/.test(official3) &&
  !/isFileLike && lastSlash > 0[\s\S]{0,400}addCaseTabQuietly/.test(official3))
check('① reveal 期间抑制「自动带卷宗 tab」', official3.includes('revealInFlight'))
check('② 原生树右键改用与卷宗面板同一套类名', menu3.includes('min-w-[160px] rounded-xl border border-[var(--line)] bg-[var(--paper-elevated)]'))
check('② 原生树右键改用中文菜单项（与卷宗面板一致）',
  menu3.includes("label: '预览'") && menu3.includes("label: '引用'") && menu3.includes("label: '重命名'"))
check('② 原生树右键带 lucide 图标', menu3.includes("from 'lucide-react'"))
check('② 卷宗面板语言钉到中文（否则两套菜单一中一英）',
  read('src/domains/workspace-sidebar/client/WorkspacePanel.tsx').includes("changeLanguage('zh-CN')"))
check('③ frame 独立解析（收起时也拿得到，才能抢在展开前定宽）',
  official3.includes('resolveFrame') && official3.includes('resolveHandle'))
check('③ 逐帧 settle 收敛循环 + 保险丝', official3.includes('startSettle') && official3.includes('fuse'))
check('③ 展开前先禁过渡（官方属性），但**绝不直接改 frame 的 grid**',
  official3.includes('armInstant') && !/gridTemplateColumns\s*=/.test(official3))
check('③ 目标宽度按窗口实际空间夹取（避免收敛不了空转）',
  official3.includes('const available =') && official3.includes('Math.max(300'))
check('③ 活动 tab 感知有 400ms 轮询兜底（官方 tab 条会重建）', official3.includes('watchTimer'))
check('③ 用户手动拖拽仍交还控制权', official3.includes('userTookOver') && official3.includes('agentlexSelfDrag'))
check('③ 只 arm 不重置目标（panel-open 与 reveal 成对派发）',
  /onPanelOpen = \(\): void => \{[\s\S]{0,600}widthControl\.arm\(\)/.test(official3))

console.log('\n── #30 侧栏打开的文件：停靠在右侧面板（不做浮动弹窗）──')
const official4 = read('src/domains/workspace-sidebar/client/official-sidebar.tsx')
check('不再使用官方浮动面板（用户 2026-09-11 否决弹窗）',
  !official4.includes('openFileAsFloat') && !official4.includes('defaultFloatRect') && !/\.float\?\(/.test(official4))
check('文件仍以 DSH 原生预览打开', official4.includes('sidebarRight.openResource?.(') && official4.includes('fileAddress'))
check('两条入口都走同一打开路径（会话链接 + 卷宗树）',
  (official4.match(/openResource\?\.\(fileAddress/g) ?? []).length >= 2)

console.log('\n── #30 回归防线：绝不动会话工作区 ──')
const litLaunch = read('src/domains/litigation/client/launch-manager.ts')
const nonlitLaunch = read('src/domains/nonlitigation/client/launch-manager.ts')
check('诉讼 launcher 不接受案件文件夹当工作区', !/caseFolder/.test(litLaunch))
check('非诉 launcher 不接受项目文件夹当工作区', !/projectFolder/.test(nonlitLaunch))
const litPanel = read('src/domains/litigation/client/OriginalLitigationPanel.tsx')
check('案件面板不再把卷宗塞进 createBusinessSession', !/caseFolder:/.test(litPanel))

const wsIndex = read('src/domains/workspace-sidebar/client/index.tsx')
check('index 优先官方、缺席才退回自绘面板', wsIndex.includes('mountOfficialSidebarFiles') && wsIndex.includes('mountWorkspacePanel'))
const wsPanel = read('src/domains/workspace-sidebar/client/WorkspacePanel.tsx')
for (const needle of ['preferBindingFolder', 'minimalChrome', 'hideRootSwitcher', 'canReturnToCase']) {
  check(`WorkspacePanel 支持 ${needle}`, wsPanel.includes(needle))
}
const dirPanel = read('src/domains/workspace-sidebar/client/DirectoryPanel.tsx')
check('精简模式隐藏「工作区/案件文件夹」根切换', dirPanel.includes('hideRootSwitcher'))

const linkCtx = read('src/domains/workspace-sidebar/client/conversation-links.ts')
check('会话链接右键菜单避让原生树（不叠两层）', linkCtx.includes('[data-agentlex-tree-menu]') && linkCtx.includes('data-files-state'))
const nonlitPanel = read('src/domains/nonlitigation/client/OriginalNonLitigationPanel.tsx')
check('非诉项目卷宗同样走「在侧边栏打开」通道', nonlitPanel.includes('handleOpenProjectFolder'))
const nonlitDetail = read('vendor/panel-ui/renderer/pages/NonLitigationDetailPage.tsx')
check('非诉项目详情页有「在侧边栏打开」', nonlitDetail.includes('在侧边栏打开'))

console.log('\n── #31 法官联系电话 ──')
const storeTypes = read('src/domains/litigation/store/types.ts')
check('store 类型有 judgePhone', /judgePhone\?: string/.test(storeTypes))
check('registerCase 写入 judgePhone', read('src/domains/litigation/store/case-store.ts').includes('judgePhone:'))
const tools = read('src/domains/litigation/tools.ts')
check('agent 工具 schema 有 judgePhone', /judgePhone: \{ type: 'string'/.test(tools))
check('update_case 白名单含 judgePhone', (tools.match(/'judge', 'judgePhone'/g) ?? []).length >= 2)
check('HTTP 执行体白名单含 judgePhone', tools.includes("'judge', 'judgePhone', 'level', 'claimAmount'"))
check('案件信息.md 模板含法官电话', read('src/domains/litigation/file-service.ts').includes('法官联系电话'))
const vendorHooks = read('vendor/panel-ui/renderer/hooks/useAgentLex.ts')
check('CaseEntry 有 judgePhone', /judgePhone\?: string;/.test(vendorHooks))
check('DiskCase 有 judgePhone', /judgePhone\?: string; claimAmount/.test(vendorHooks))
check('normalizeCase 映射 judgePhone', vendorHooks.includes('judgePhone: dc.judgePhone'))
const caseDetail = read('vendor/panel-ui/renderer/pages/CaseDetailPage.tsx')
check('案件详情页渲染「法官联系电话」', caseDetail.includes('法官联系电话') && caseDetail.includes("field: 'judgePhone'"))

console.log('\n── #32 管家按钮会话数（归档不计数）──')
for (const rel of [
  'vendor/panel-ui/renderer/pages/CaseDetailPage.tsx',
  'vendor/panel-ui/renderer/pages/NonLitigationDetailPage.tsx',
]) {
  const src = read(rel)
  const tag = rel.includes('NonLitigation') ? '非诉' : '诉讼'
  check(`${tag}: 归档集合可为「未取回」状态`, src.includes('useState<ReadonlySet<string> | null>(null)'))
  check(`${tag}: 进页面即预取归档集合`, /refreshArchived\(\); \}, \[refreshArchived, boundSessions\]/.test(src))
  check(`${tag}: 数量徽标等集合取回后才显示`, src.includes('archivedIds !== null && mySessions.length > 0'))
  check(`${tag}: 计数已扣除归档会话`, src.includes("!(archivedIds?.has(s.sessionId) ?? false)"))
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILED`)
process.exit(failures === 0 ? 0 : 1)
