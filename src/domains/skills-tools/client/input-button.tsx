/**
 * 技能与工具 — 会话输入框选择按钮（conversation.input.left 槽位）。
 *
 * 参考 codex-ui「专家」按钮设计：输入框工具行左侧胶囊按钮（图标 + 文字），
 * 点击展开菜单：
 *   • 技能项：写入一行简短指令（技能名 + 引导语）——DSH 的技能由模型按需
 *     加载，agent 看到指令会自动调用对应技能，无需把 SKILL.md 全文带入；
 *   • 工具 · MCP 项：写入一行简短指令（服务器名）——MCP 工具已在模型工具
 *     列表中，指明名称 agent 即可调用；
 *   • 底部管理入口：添加技能 / 添加 MCP（打开面板对应选项卡）。
 */
import { useEffect, useRef, useState } from 'react'
import { useSkillsToolsState } from './store.ts'
import { openPanel } from './summon.ts'
import type { McpServerEntry, SkillSummary } from '../types.ts'
import { SkillIcon, PlusIcon, ServerIcon, GlobeIcon, ChevronDownIcon } from './icons.tsx'
// 输入框 DOM 桥：读当前草稿（官方 inputActions 只有 setDraft 整值写，没有读，
// 直接 setDraft 会把用户已输入内容整个覆盖——先读现值再拼接保留）。
import { chatInputBridge } from '../../workspace-sidebar/client/chat-input-bridge.ts'
import css from './skills-tools.module.css'

export interface SkillsToolsPickerProps {
  /** 会话输入动作（写入草稿）。 */
  inputActions?: { setDraft(text: string): void }
  [key: string]: unknown
}

/** 技能简短指令：只点名技能，agent 按需加载并执行。 */
export function skillDraftText(skill: SkillSummary): string {
  return `请使用【${skill.name}】技能处理：\n`
}

/** MCP 简短指令：只点名服务器，agent 直接调用其工具。 */
export function mcpDraftText(server: McpServerEntry): string {
  return `请调用【${server.serverName}】MCP 工具：\n`
}

/**
 * 输入框「技能与工具」选择按钮 + 菜单。
 * @param props - conversation.input.left 槽位注入的 props（inputActions 等）。
 */
export function SkillsToolsPicker(props: SkillsToolsPickerProps): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const state = useSkillsToolsState()
  const wrapRef = useRef<HTMLDivElement | null>(null)
  // 技能分组折叠状态：默认全部折叠（找起来不费劲），点击组头展开。
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(() => new Set())

  // 点击菜单/按钮之外或按 Esc 时自动关闭
  useEffect(() => {
    if (!open) return
    const onDocClick = (event: MouseEvent): void => {
      if (wrapRef.current !== null && !wrapRef.current.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('click', onDocClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('click', onDocClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const go = (tab: 'skills' | 'tools'): void => {
    setOpen(false)
    openPanel(tab)
  }

  const insert = (text: string): void => {
    setOpen(false)
    try {
      // 保留输入框已有内容：指令追加到末尾（整值 setDraft 前先经 DOM 桥读现值）。
      const current = chatInputBridge.getValue().trimEnd()
      props.inputActions?.setDraft(current === '' ? text : `${current}\n${text}`)
    } catch (error) {
      console.warn('[agentlex-skills] setDraft failed:', error)
    }
  }

  const toggleGroup = (group: string): void => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev)
      if (next.has(group)) next.delete(group)
      else next.add(group)
      return next
    })
  }

  const enabledSkills = state.skills.filter((s) => s.enabled)
  // 菜单只列启用的 MCP(停用/禁用的在面板里管理)
  const enabledServers = state.mcp.filter((s) => s.enabled)

  // 按 group 分组技能（frontmatter group ?? metadata.author ?? 未分组），
  // 保持组内原有顺序；组按名称排序，未分组放最后。
  const skillGroups = new Map<string, SkillSummary[]>()
  for (const skill of enabledSkills) {
    const key = skill.group?.trim() || '未分组'
    const list = skillGroups.get(key)
    if (list) list.push(skill)
    else skillGroups.set(key, [skill])
  }
  const orderedGroups = [...skillGroups.entries()].sort(([a], [b]) => {
    if (a === '未分组') return 1
    if (b === '未分组') return -1
    return a.localeCompare(b, 'zh')
  })

  return (
    <div className={css.pickerWrap} ref={wrapRef}>
      <button
        type="button"
        className={css.pickerBtn}
        title="技能与工具 · 技能 / MCP"
        aria-label="技能与工具"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className={css.pickerIcon}><SkillIcon size={13} /></span>
        <span className={css.pickerLabel}>技能</span>
      </button>
      {open && (
        <div className={css.pickerMenu} role="menu">
          {enabledSkills.length > 0 && <div className={css.pickerGroupLabel}>选择技能</div>}
          {orderedGroups.map(([group, skills]) => {
            const collapsed = collapsedGroups.has(group)
            return (
              <div key={group} className={css.pickerSkillGroup}>
                <button
                  type="button"
                  className={css.pickerGroupHeader}
                  aria-expanded={!collapsed}
                  onClick={() => toggleGroup(group)}
                >
                  <ChevronDownIcon size={12} folded={collapsed} />
                  <span className={css.pickerGroupHeaderName}>{group}</span>
                  <span className={css.pickerGroupHeaderCount}>{skills.length}</span>
                </button>
                {!collapsed && skills.map((skill) => (
                  <button key={skill.name} type="button" role="menuitem" className={css.pickerItem} onClick={() => insert(skillDraftText(skill))}>
                    <span className={css.pickerItemIcon}><SkillIcon size={14} /></span>
                    <span className={css.pickerItemName}>{skill.name}</span>
                    <span className={css.pickerItemHint}>{skill.description?.slice(0, 16) ?? ''}</span>
                  </button>
                ))}
              </div>
            )
          })}

          {enabledServers.length > 0 && <div className={css.pickerDivider} />}
          {enabledServers.length > 0 && <div className={css.pickerGroupLabel}>选择工具 · MCP</div>}
          {enabledServers.map((server) => (
            <button key={server.id} type="button" role="menuitem" className={css.pickerItem} onClick={() => insert(mcpDraftText(server))}>
              <span className={css.pickerItemIcon}>{server.transport === 'stdio' ? <ServerIcon size={14} /> : <GlobeIcon size={14} />}</span>
              <span className={css.pickerItemName}>{server.serverName}</span>
              <span className={css.pickerItemHint}>{server.status === 'connected' ? '已连接' : server.status === 'connecting' ? '连接中' : server.enabled ? '异常' : '已停用'}</span>
            </button>
          ))}

          <div className={css.pickerDivider} />
          <div className={css.pickerGroupLabel}>管理</div>
          <button type="button" role="menuitem" className={css.pickerItem} onClick={() => go('skills')}>
            <span className={css.pickerItemIcon}><PlusIcon size={14} /></span>
            <span className={css.pickerItemName}>添加技能（上传 zip / .skill / .md）</span>
          </button>
          <button type="button" role="menuitem" className={css.pickerItem} onClick={() => go('tools')}>
            <span className={css.pickerItemIcon}><PlusIcon size={14} /></span>
            <span className={css.pickerItemName}>添加 MCP（粘贴 JSON）</span>
          </button>
        </div>
      )}
    </div>
  )
}
