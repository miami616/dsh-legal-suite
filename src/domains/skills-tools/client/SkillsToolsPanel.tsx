/**
 * 技能与工具 — 侧栏面板（与诉讼/非诉/任务面板同一套 AgentLex 设计语言）。
 *
 * 顶部：标题 + 副标题 + 关闭（单行 header，与业务面板一致）；
 * Sticky 选项卡：「技能」/「工具 · MCP」。
 * 技能 tab：toolbar（搜索 + 创建技能）→ 卡片网格（编辑/启停/删除）。
 * 工具 tab：toolbar（搜索 + 添加 MCP）→ 服务器列表行（编辑/启停/删除）。
 * 创建/编辑技能、添加/编辑 MCP 走模态表单；删除走确认弹窗。
 */
import { useEffect, useRef, useState } from 'react'
import { useSkillsToolsState, setState } from './store.ts'
import {
  addMcp,
  createSkill,
  readSkill,
  removeMcp,
  removeSkill,
  toggleMcp,
  toggleSkill,
  updateSkill,
  parseSkillUpload,
  renameGroup,
  mcpSetGroup,
} from './api.ts'
import { OPEN_PANEL_EVENT, type SkillsToolsTab } from './summon.ts'
import type { McpServerEntry, SkillSummary } from '../types.ts'
import {
  SkillIcon,
  SearchIcon,
  CloseIcon,
  TrashIcon,
  EditIcon,
  PlusIcon,
  UploadIcon,
  ServerIcon,
  GlobeIcon,
  ChevronDownIcon,
  AuthorIcon,
} from './icons.tsx'
import css from './skills-tools.module.css'

export interface SkillsToolsPanelProps {
  /** 初始选项卡（输入框/命令唤起时指定）。 */
  initialTab?: SkillsToolsTab
  onClose: () => void
}

export function SkillsToolsPanel({ initialTab, onClose }: SkillsToolsPanelProps): React.JSX.Element {
  const state = useSkillsToolsState()
  const [tab, setTab] = useState<SkillsToolsTab>(initialTab ?? 'skills')
  const [notice, setNotice] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)
  const [confirm, setConfirm] = useState<{ title: string; text: string; confirmLabel: string; onConfirm: () => void } | null>(null)

  // 外部事件（输入框按钮 / 命令）切换选项卡
  useEffect(() => {
    const onOpen = (event: Event): void => {
      const target = (event as CustomEvent<SkillsToolsTab>).detail
      if (target === 'tools' || target === 'skills') setTab(target)
    }
    window.addEventListener(OPEN_PANEL_EVENT, onOpen)
    return () => window.removeEventListener(OPEN_PANEL_EVENT, onOpen)
  }, [])

  const flash = (kind: 'ok' | 'error', text: string): void => {
    setNotice({ tone: kind, text })
    window.setTimeout(() => setNotice(null), 3200)
  }

  const handleToggleSkill = async (skill: SkillSummary): Promise<void> => {
    try {
      setState(await toggleSkill(skill.name, !skill.enabled))
    } catch (error) {
      flash('error', String((error as Error)?.message ?? error))
    }
  }

  const handleRemoveSkill = (skill: SkillSummary): void => {
    setConfirm({
      title: '删除技能',
      text: `确定删除技能「${skill.name}」吗？技能目录将被移除，操作不可撤销。`,
      confirmLabel: '删除',
      onConfirm: () => {
        void removeSkill(skill.name)
          .then((next) => { setState(next); flash('ok', `技能「${skill.name}」已删除`) })
          .catch((error) => flash('error', String((error as Error)?.message ?? error)))
          .finally(() => setConfirm(null))
      },
    })
  }

  const handleToggleMcp = async (server: McpServerEntry): Promise<void> => {
    try {
      const source = server.id.startsWith('cordis:') ? 'cordis' : 'user'
      setState(await toggleMcp({
        id: server.id,
        entryId: server.id.startsWith('cordis:') ? server.id.slice('cordis:'.length) : undefined,
        source,
        enabled: !server.enabled,
      }))
    } catch (error) {
      flash('error', String((error as Error)?.message ?? error))
    }
  }

  const handleRemoveMcp = (server: McpServerEntry): void => {
    if (server.id.startsWith('cordis:')) {
      flash('error', 'cordis.patch.yml 内置服务器不能删除，可停用或编辑该文件')
      return
    }
    setConfirm({
      title: '删除 MCP 服务器',
      text: `确定删除 MCP 服务器「${server.serverName}」吗？该操作会立即断开连接。`,
      confirmLabel: '删除',
      onConfirm: () => {
        void removeMcp(server.id)
          .then((next) => { setState(next); flash('ok', `MCP 服务器「${server.serverName}」已删除`) })
          .catch((error) => flash('error', String((error as Error)?.message ?? error)))
          .finally(() => setConfirm(null))
      },
    })
  }

  return (
    <div className={css.panel}>
      <header className={css.header}>
        <h1 className={css.title}>技能与工具</h1>
        <span className={css.subtitle}>管理技能（Skill）与 MCP 工具，即加即用</span>
        <button className={css.close} type="button" aria-label="关闭技能与工具" title="关闭" onClick={onClose}>
          <CloseIcon size={14} />
        </button>
      </header>

      {/* Sticky 选项卡 */}
      <nav className={css.tabs} role="tablist" aria-label="技能与工具导航">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'skills'}
          className={tab === 'skills' ? `${css.tab} ${css.tabActive}` : css.tab}
          onClick={() => setTab('skills')}
        >
          技能 Skill
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'tools'}
          className={tab === 'tools' ? `${css.tab} ${css.tabActive}` : css.tab}
          onClick={() => setTab('tools')}
        >
          工具 · MCP
        </button>
      </nav>

      {notice !== null && (
        <div className={notice.tone === 'ok' ? `${css.notice} ${css.noticeOk}` : `${css.notice} ${css.noticeError}`}>
          {notice.text}
        </div>
      )}

      <div className={css.body}>
        {tab === 'skills' && (
          <SkillsSection
            skills={state.skills}
            onToggle={(s) => { void handleToggleSkill(s) }}
            onRemove={handleRemoveSkill}
            onNotice={flash}
          />
        )}
        {tab === 'tools' && (
          <McpSection
            servers={state.mcp}
            onToggle={(s) => { void handleToggleMcp(s) }}
            onRemove={handleRemoveMcp}
            onNotice={flash}
          />
        )}
      </div>

      {confirm !== null && (
        <div className={css.modalOverlay} onClick={() => setConfirm(null)}>
          <div className={css.confirmBox} onClick={(e) => e.stopPropagation()} role="alertdialog" aria-modal="true" aria-label={confirm.title}>
            <p className={css.confirmText}>{confirm.text}</p>
            <div className={css.confirmActions}>
              <button className={css.ghostBtn} type="button" onClick={() => setConfirm(null)}>取消</button>
              <button className={css.dangerBtn} type="button" onClick={confirm.onConfirm}>{confirm.confirmLabel}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// =====================================================================
// 技能 tab
// =====================================================================
interface SkillsSectionProps {
  skills: SkillSummary[]
  onToggle(skill: SkillSummary): void
  onRemove(skill: SkillSummary): void
  onNotice(kind: 'ok' | 'error', text: string): void
}

function SkillsSection({ skills, onToggle, onRemove, onNotice }: SkillsSectionProps): React.JSX.Element {
  const [query, setQuery] = useState('')
  const [form, setForm] = useState<{ mode: 'create' | 'edit'; skill: SkillSummary | null } | null>(null)
  const [rename, setRename] = useState<string | null>(null)
  /** 折叠的分组（点击分组标题切换）。 */
  const [collapsedGroups, setCollapsedGroups] = useState<ReadonlySet<string>>(new Set())
  const toggleGroup = (group: string): void => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev)
      if (next.has(group)) next.delete(group)
      else next.add(group)
      return next
    })
  }

  const enabledCount = skills.filter((s) => s.enabled).length
  const q = query.trim().toLowerCase()
  const visible = q === ''
    ? skills
    : skills.filter((s) => s.name.toLowerCase().includes(q) || (s.description ?? '').toLowerCase().includes(q))
  // 按来源分组（frontmatter group ?? metadata.author ?? 未分组）
  const groups = groupBy(visible, (s) => s.group || '未分组')

  return (
    <section className={css.section}>
      <div className={css.toolbar}>
        <div className={css.searchBox}>
          <span className={css.searchIcon}><SearchIcon size={13} /></span>
          <input
            className={css.searchInput}
            placeholder="搜索技能…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="搜索技能"
          />
          {query !== '' && (
            <button className={css.clearSearch} type="button" aria-label="清除搜索" onClick={() => setQuery('')}>✕</button>
          )}
        </div>
        <div className={css.toolbarActions}>
          <span className={css.sectionHint}>已启用 {enabledCount} / {skills.length}</span>
          <button className={css.primaryBtn} type="button" onClick={() => setForm({ mode: 'create', skill: null })}>
            <PlusIcon size={13} /> 创建技能
          </button>
        </div>
      </div>

      {groups.map(({ group, items }) => (
        <div key={group}>
          <div
            className={css.groupTitle}
            role="button"
            tabIndex={0}
            title={collapsedGroups.has(group) ? '展开分组' : '折叠分组'}
            onClick={() => toggleGroup(group)}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') toggleGroup(group) }}
          >
            <ChevronDownIcon size={15} folded={collapsedGroups.has(group)} />
            <span className={css.groupName}>{group}</span>
            <span className={css.groupCount}>{items.length}</span>
            <span className={css.groupSpacer} />
            <button type="button" className={css.groupEdit} title="重命名分组 / 移动条目" aria-label={`重命名分组 ${group}`} onClick={(e) => { e.stopPropagation(); setRename(group) }}>
              <EditIcon size={11} />
            </button>
          </div>
          {collapsedGroups.has(group) ? null : (
          <div className={css.grid}>
            {items.map((skill) => (
              <div key={skill.name} className={css.card}>
                <div className={css.cardTop}>
                  <span className={css.cardIcon}><SkillIcon size={14} /></span>
                  <h4 className={css.cardName}>{skill.name}</h4>
                  <span className={skill.enabled ? css.badgeOn : css.badgeOff}>{skill.enabled ? '已启用' : '已停用'}</span>
                </div>
                <p className={css.cardDesc}>{skill.description || '（暂无描述）'}</p>
                {skill.author !== undefined && skill.author !== '' && (
                  <p className={css.cardAuthor}><AuthorIcon size={11} /> {skill.author}</p>
                )}
                <div className={css.cardActions}>
                  <button
                    type="button"
                    className={css.smallBtn}
                    onClick={() => {
                      void readSkill(skill.name)
                        .then((doc) => setForm({ mode: 'edit', skill: { ...skill, name: doc.name, description: doc.description, instructions: doc.instructions, group: doc.group } }))
                        .catch((error) => onNotice('error', String((error as Error)?.message ?? error)))
                    }}
                  >
                    <EditIcon size={12} /> 编辑
                  </button>
                  <span className={css.cardSwitch}>
                    <Switch checked={skill.enabled} onChange={() => onToggle(skill)} label={`${skill.enabled ? '停用' : '启用'}技能 ${skill.name}`} />
                  </span>
                  <button type="button" className={`${css.iconBtn} ${css.iconBtnDanger}`} title="删除" aria-label={`删除 ${skill.name}`} onClick={() => onRemove(skill)}>
                    <TrashIcon size={13} />
                  </button>
                </div>
              </div>
            ))}
          </div>
          )}
        </div>
      ))}
      {visible.length === 0 && (
        <p className={css.emptyHint}>{q === '' ? '还没有技能，点击「创建技能」添加（或上传 zip 技能包）。' : '没有匹配的技能。'}</p>
      )}

      {form !== null && (
        <SkillFormModal
          mode={form.mode}
          skill={form.skill}
          onClose={() => setForm(null)}
          onNotice={onNotice}
        />
      )}
      {rename !== null && (
        <GroupRenameModal
          kind="skill"
          group={rename}
          onClose={() => setRename(null)}
          onNotice={onNotice}
        />
      )}
    </section>
  )
}

// =====================================================================
// 工具 · MCP tab
// =====================================================================
interface McpSectionProps {
  servers: McpServerEntry[]
  onToggle(server: McpServerEntry): void
  onRemove(server: McpServerEntry): void
  onNotice(kind: 'ok' | 'error', text: string): void
}

function McpSection({ servers, onToggle, onRemove, onNotice }: McpSectionProps): React.JSX.Element {
  const [query, setQuery] = useState('')
  const [form, setForm] = useState<{ mode: 'add' | 'edit'; server: McpServerEntry | null } | null>(null)
  const [rename, setRename] = useState<string | null>(null)
  /** 折叠的分组。 */
  const [collapsedGroups, setCollapsedGroups] = useState<ReadonlySet<string>>(new Set())
  const toggleGroup = (group: string): void => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev)
      if (next.has(group)) next.delete(group)
      else next.add(group)
      return next
    })
  }

  const connected = servers.filter((s) => s.status === 'connected').length
  const q = query.trim().toLowerCase()
  const visible = q === ''
    ? servers
    : servers.filter((s) => s.serverName.toLowerCase().includes(q) || (s.url ?? '').toLowerCase().includes(q) || (s.command ?? '').toLowerCase().includes(q))
  // 按来源分组（内置 / URL 域名 / 命令基名）
  const groups = groupBy(visible, (s) => s.group || '其他')

  return (
    <section className={css.section}>
      <div className={css.toolbar}>
        <div className={css.searchBox}>
          <span className={css.searchIcon}><SearchIcon size={13} /></span>
          <input
            className={css.searchInput}
            placeholder="搜索 MCP 服务器…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="搜索 MCP 服务器"
          />
          {query !== '' && (
            <button className={css.clearSearch} type="button" aria-label="清除搜索" onClick={() => setQuery('')}>✕</button>
          )}
        </div>
        <div className={css.toolbarActions}>
          <span className={css.sectionHint}>已连接 {connected} / {servers.length}</span>
          <button className={css.primaryBtn} type="button" onClick={() => setForm({ mode: 'add', server: null })}>
            <PlusIcon size={13} /> 添加 MCP
          </button>
        </div>
      </div>

      {groups.map(({ group, items }) => (
        <div key={group}>
          <div
            className={css.groupTitle}
            role="button"
            tabIndex={0}
            title={collapsedGroups.has(group) ? '展开分组' : '折叠分组'}
            onClick={() => toggleGroup(group)}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') toggleGroup(group) }}
          >
            <ChevronDownIcon size={15} folded={collapsedGroups.has(group)} />
            <span className={css.groupName}>{group}</span>
            <span className={css.groupCount}>{items.length}</span>
            <span className={css.groupSpacer} />
            <button type="button" className={css.groupEdit} title="重命名分组 / 移动条目" aria-label={`重命名分组 ${group}`} onClick={(e) => { e.stopPropagation(); setRename(group) }}>
              <EditIcon size={11} />
            </button>
          </div>
          {collapsedGroups.has(group) ? null : (
          <div className={css.grid}>
            {items.map((server) => (
              <div key={server.id} className={css.card}>
                <div className={css.cardTop}>
                  <span className={css.cardIcon}>
                    {server.transport === 'stdio' ? <ServerIcon size={14} /> : <GlobeIcon size={14} />}
                  </span>
                  <h4 className={css.cardName}>{server.serverName}</h4>
                  {server.id.startsWith('cordis:') && <span className={css.badgeBuiltin}>内置</span>}
                  <StatusBadge status={server.status} />
                </div>
                <p className={css.cardDesc}>
                  {server.transport === 'stdio'
                    ? `${server.command ?? ''} ${(server.args ?? []).join(' ')}`.trim() || 'stdio'
                    : server.url ?? 'streamable-http'}
                </p>
                {server.error !== undefined && server.error !== null && <p className={css.mcpError}>{server.error}</p>}
                <div className={css.cardActions}>
                  <button type="button" className={css.smallBtn} onClick={() => setForm({ mode: 'edit', server })}>
                    <EditIcon size={12} /> 编辑
                  </button>
                  <span className={css.cardSwitch}>
                    <Switch checked={server.enabled} onChange={() => onToggle(server)} label={`${server.enabled ? '停用' : '启用'}MCP ${server.serverName}`} />
                  </span>
                  <button type="button" className={`${css.iconBtn} ${css.iconBtnDanger}`} title="删除" aria-label={`删除 ${server.serverName}`} onClick={() => onRemove(server)}>
                    <TrashIcon size={13} />
                  </button>
                </div>
              </div>
            ))}
          </div>
          )}
        </div>
      ))}
      {visible.length === 0 && (
        <p className={css.emptyHint}>{q === '' ? '还没有 MCP 服务器，点击「添加 MCP」粘贴 JSON 配置。' : '没有匹配的服务器。'}</p>
      )}

      {form !== null && (
        <McpFormModal
          mode={form.mode}
          server={form.server}
          onClose={() => setForm(null)}
          onNotice={onNotice}
        />
      )}
      {rename !== null && (
        <GroupRenameModal
          kind="mcp"
          group={rename}
          onClose={() => setRename(null)}
          onNotice={onNotice}
        />
      )}
    </section>
  )
}

function StatusBadge({ status }: { status: McpServerEntry['status'] }): React.JSX.Element {
  if (status === 'connected') return <span className={css.badgeOn}>已连接</span>
  if (status === 'connecting') return <span className={css.badgeConnecting}>连接中</span>
  if (status === 'disabled') return <span className={css.badgeOff}>已停用</span>
  return <span className={css.badgeError}>连接失败</span>
}

/** 全局开关（Switch）：每个技能 / MCP 的启停。 */
function Switch({ checked, onChange, label }: { checked: boolean; onChange: () => void; label: string }): React.JSX.Element {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      title={checked ? '停用' : '启用'}
      className={`${css.switch} ${checked ? css.switchOn : ''}`}
      onClick={onChange}
    >
      <span className={css.switchKnob} />
    </button>
  )
}

// =====================================================================
// 创建/编辑技能模态
// =====================================================================
interface SkillFormModalProps {
  mode: 'create' | 'edit'
  skill: SkillSummary | null
  onClose(): void
  onNotice(kind: 'ok' | 'error', text: string): void
}

function SkillFormModal({ mode, skill, onClose, onNotice }: SkillFormModalProps): React.JSX.Element {
  const [name, setName] = useState(skill?.name ?? '')
  const [description, setDescription] = useState(skill?.description ?? '')
  const [instructions, setInstructions] = useState(skill?.instructions ?? '')
  const [groupChoice, setGroupChoice] = useState<string>(skill?.group && skill.group !== '未分组' ? skill.group : '')
  const [newGroupName, setNewGroupName] = useState('')
  const skillsState = useSkillsToolsState()
  const groupOptions = [...new Set(skillsState.skills.map((x) => x.group).filter((g): g is string => typeof g === 'string' && g !== '未分组'))]
  const groupValue = groupChoice === '__new__' ? newGroupName.trim() : groupChoice
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const fileRef = useRef<HTMLInputElement | null>(null)

  const onUpload = async (file: File): Promise<void> => {
    setBusy(true)
    setError('')
    try {
      const dataBase64 = await fileToBase64(file)
      const parsed = await parseSkillUpload(file.name, dataBase64)
      if (parsed.name) setName(parsed.name)
      if (parsed.description) setDescription(parsed.description)
      if (parsed.instructions) setInstructions(parsed.instructions)
      onNotice('ok', `已识别 SKILL.md 并自动填充表单（${file.name}）`)
    } catch (err) {
      setError(String((err as Error)?.message ?? err))
    } finally {
      setBusy(false)
    }
  }

  const submit = async (): Promise<void> => {
    if (name.trim() === '') { setError('请填写技能名称'); return }
    if (instructions.trim() === '') { setError('请填写技能指令'); return }
    setBusy(true)
    setError('')
    try {
      if (mode === 'edit' && skill) {
        const next = await updateSkill({
          name: skill.name,
          newName: name,
          description,
          instructions,
          group: groupValue,
        })
        setState(next)
        onNotice('ok', `技能「${skill.name}」已更新`)
      } else {
        const { name: created } = await createSkill({ name, description, instructions, group: groupValue })
        onNotice('ok', `技能「${created}」创建成功，即时生效`)
      }
      onClose()
    } catch (err) {
      setError(String((err as Error)?.message ?? err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={css.modalOverlay} onClick={onClose}>
      <div className={css.modal} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={mode === 'create' ? '创建技能' : '编辑技能'}>
        <header className={css.modalHeader}>
          <h2 className={css.modalTitle}>{mode === 'create' ? '创建技能' : '编辑技能'}</h2>
          <button className={css.closeBtn} type="button" onClick={onClose} aria-label="关闭"><CloseIcon size={13} /></button>
        </header>

        <div className={css.modalBody}>
          {mode === 'create' && (
            <div className={css.uploadRow}>
              <input
                ref={fileRef}
                type="file"
                accept=".zip,.skill,.md"
                className={css.fileInput}
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  if (file) void onUpload(file)
                }}
              />
              <button type="button" className={css.uploadBtn} disabled={busy} onClick={() => fileRef.current?.click()}>
                <UploadIcon size={13} /> {busy ? '解析中…' : '上传 zip / .skill / .md'}
              </button>
              <span className={css.uploadHint}>自动识别 SKILL.md 并回填表单</span>
            </div>
          )}

          <label className={css.field}>
            <span className={css.fieldLabel}>技能名称 *</span>
            <input
              className={css.input}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例如 codemap（自动规范化为小写连字符）"
              autoFocus
            />
            <span className={css.fieldHint}>仅支持小写字母、数字与连字符，将自动规范化</span>
          </label>

          <label className={css.field}>
            <span className={css.fieldLabel}>描述</span>
            <input
              className={css.input}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="该技能应在何时使用？"
            />
          </label>

          <label className={css.field}>
            <span className={css.fieldLabel}>分组</span>
            <select className={css.select} value={groupChoice} onChange={(e) => setGroupChoice(e.target.value)}>
              <option value="">未分组</option>
              {groupOptions.map((g) => <option key={g} value={g}>{g}</option>)}
              <option value="__new__">＋ 新建分组…</option>
            </select>
            {groupChoice === '__new__' && (
              <input
                className={css.input}
                value={newGroupName}
                onChange={(e) => setNewGroupName(e.target.value)}
                placeholder="新分组名"
              />
            )}
            <span className={css.fieldHint}>同来源的技能会聚合显示在同一分组下</span>
          </label>

          <label className={css.field}>
            <span className={css.fieldLabel}>指令 *</span>
            <textarea
              className={css.textarea}
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              placeholder={'定义技能激活时模型应如何行为。例如：\n# 技能名\n## 何时使用\n## 输出规范'}
              rows={6}
            />
          </label>

          {error !== '' && <p className={css.modalError}>{error}</p>}
        </div>

        <footer className={css.modalFooter}>
          <button className={css.ghostBtn} type="button" onClick={onClose}>取消</button>
          <button className={css.primaryBtn} type="button" disabled={busy} onClick={() => void submit()}>
            {busy ? '保存中…' : mode === 'create' ? '创建技能' : '保存修改'}
          </button>
        </footer>
      </div>
    </div>
  )
}

// =====================================================================
// 添加/编辑 MCP 模态
// =====================================================================
interface McpFormModalProps {
  mode: 'add' | 'edit'
  server: McpServerEntry | null
  onClose(): void
  onNotice(kind: 'ok' | 'error', text: string): void
}

function McpFormModal({ mode, server, onClose, onNotice }: McpFormModalProps): React.JSX.Element {
  const [json, setJson] = useState(server !== null ? mcpToJson(server) : '')
  const [groupChoice, setGroupChoice] = useState<string>(server?.group && server.group !== '其他' && server.group !== '内置' ? server.group : '')
  const [newGroupName, setNewGroupName] = useState('')
  const mcpState = useSkillsToolsState()
  const groupOptions = [...new Set(mcpState.mcp.map((x) => x.group).filter((g): g is string => typeof g === 'string' && g !== '其他' && g !== '内置'))]
  const groupValue = groupChoice === '__new__' ? newGroupName.trim() : groupChoice
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const submit = async (): Promise<void> => {
    let value: unknown
    try {
      value = JSON.parse(json)
    } catch (err) {
      setError(`JSON 格式错误：${(err as Error)?.message ?? err}`)
      return
    }
    setBusy(true)
    setError('')
    try {
      const { results, state } = await addMcp(value)
      // 编辑模式:应用用户分组(空 = 回退自动派生)
      if (mode === 'edit' && server) {
        setState(await mcpSetGroup(server.id, groupValue))
      } else {
        setState(state)
      }
      const names = results.map((r) => r.serverName).join('、')
      onNotice('ok', `MCP 已${results.some((r) => r.updated) ? '更新' : '添加'}：${names}，即时生效`)
      onClose()
    } catch (err) {
      setError(String((err as Error)?.message ?? err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={css.modalOverlay} onClick={onClose}>
      <div className={css.modal} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={mode === 'add' ? '添加 MCP 服务器' : '编辑 MCP 服务器'}>
        <header className={css.modalHeader}>
          <h2 className={css.modalTitle}>{mode === 'add' ? '添加 MCP 服务器' : '编辑 MCP 服务器'}</h2>
          <button className={css.closeBtn} type="button" onClick={onClose} aria-label="关闭"><CloseIcon size={13} /></button>
        </header>

        <div className={css.modalBody}>
          <p className={css.fieldHint}>
            粘贴 JSON 配置，后台自动转换为可运行的 MCP 连接，立即生效。支持单个服务器对象或标准
            {'{ "mcpServers": {...} }'} 格式：stdio 用 command（字符串或数组）/args，HTTP 用 url；
            type 支持 stdio / local / streamable-http / sse。
          </p>
          {mode === 'edit' && server !== null && !server.id.startsWith('cordis:') && (
            <label className={css.field}>
              <span className={css.fieldLabel}>分组</span>
              <select className={css.select} value={groupChoice} onChange={(e) => setGroupChoice(e.target.value)}>
                <option value="">未分组</option>
                {groupOptions.map((g) => <option key={g} value={g}>{g}</option>)}
                <option value="__new__">＋ 新建分组…</option>
              </select>
              {groupChoice === '__new__' && (
                <input
                  className={css.input}
                  value={newGroupName}
                  onChange={(e) => setNewGroupName(e.target.value)}
                  placeholder="新分组名"
                />
              )}
            </label>
          )}
          <label className={css.field}>
            <span className={css.fieldLabel}>MCP 配置（JSON）</span>
            <textarea
              className={css.jsonTextarea}
              value={json}
              onChange={(e) => setJson(e.target.value)}
              placeholder={'{\n  "mcpServers": {\n    "my-server": { "command": "cmd", "args": ["--flag"] }\n  }\n}'}
              rows={8}
              spellCheck={false}
            />
          </label>
          {error !== '' && <p className={css.modalError}>{error}</p>}
        </div>

        <footer className={css.modalFooter}>
          <button className={css.ghostBtn} type="button" onClick={onClose}>取消</button>
          <button className={css.primaryBtn} type="button" disabled={busy} onClick={() => void submit()}>
            {busy ? '连接中…' : mode === 'add' ? '添加并连接' : '保存修改'}
          </button>
        </footer>
      </div>
    </div>
  )
}

/** 把服务器条目转回可编辑 JSON（mcpServers 单对象形状）。 */
function mcpToJson(server: McpServerEntry): string {
  const cfg: Record<string, unknown> = { transport: server.transport }
  if (server.transport === 'stdio') {
    cfg.command = server.command ?? ''
    if (server.args && server.args.length > 0) cfg.args = server.args
    if (server.cwd) cfg.cwd = server.cwd
    if (server.env && Object.keys(server.env).length > 0) cfg.env = server.env
  } else {
    cfg.url = server.url ?? ''
    if (server.headers && Object.keys(server.headers).length > 0) cfg.headers = server.headers
  }
  if (server.toolCallTimeoutMs) cfg.toolCallTimeoutMs = server.toolCallTimeoutMs
  return JSON.stringify({ mcpServers: { [server.serverName]: cfg } }, null, 2)
}

/** 分组重命名模态（技能/MCP 通用）：改组名 = 组内条目批量迁移；输入新名字即创建新分组。 */
function GroupRenameModal({ kind, group, onClose, onNotice }: {
  kind: 'skill' | 'mcp'
  group: string
  onClose(): void
  onNotice(kind: 'ok' | 'error', text: string): void
}): React.JSX.Element {
  const [name, setName] = useState(group === '未分组' || group === '其他' ? '' : group)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const submit = async (): Promise<void> => {
    const to = name.trim()
    if (to === group) { onClose(); return }
    setBusy(true)
    setError('')
    try {
      setState(await renameGroup(kind, group, to))
      onNotice('ok', to === '' ? `已把「${group}」移入未分组` : `分组「${group}」→「${to}」`)
      onClose()
    } catch (err) {
      setError(String((err as Error)?.message ?? err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={css.modalOverlay} onClick={onClose}>
      <div className={css.confirmBox} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="重命名分组">
        <p className={css.confirmText}>
          重命名分组「{group}」：组内 {kind === 'skill' ? '技能' : 'MCP 服务器'} 将整体迁移；
          输入新名字可创建新分组，留空则移入未分组。
        </p>
        <input
          className={css.input}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="新分组名（留空 = 未分组）"
          autoFocus
        />
        {error !== '' && <p className={css.modalError}>{error}</p>}
        <div className={css.confirmActions}>
          <button className={css.ghostBtn} type="button" onClick={onClose}>取消</button>
          <button className={css.primaryBtn} type="button" disabled={busy} onClick={() => void submit()}>
            {busy ? '迁移中…' : '确认重命名'}
          </button>
        </div>
      </div>
    </div>
  )
}

/** 按 key 分组并排序（「未分组/其他」最后，其余按名称）。 */
function groupBy<T>(items: T[], keyOf: (item: T) => string): Array<{ group: string; items: T[] }> {
  const map = new Map<string, T[]>()
  for (const item of items) {
    const key = keyOf(item)
    const list = map.get(key)
    if (list === undefined) map.set(key, [item])
    else list.push(item)
  }
  const keys = [...map.keys()].sort((a, b) => {
    const aOther = a === '未分组' || a === '其他'
    const bOther = b === '未分组' || b === '其他'
    if (aOther && !bOther) return 1
    if (!aOther && bOther) return -1
    return a.localeCompare(b)
  })
  return keys.map((group) => ({ group, items: map.get(group)! }))
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = String(reader.result ?? '')
      const at = result.indexOf(',')
      resolve(at >= 0 ? result.slice(at + 1) : result)
    }
    reader.onerror = () => reject(reader.error ?? new Error('读取文件失败'))
    reader.readAsDataURL(file)
  })
}
