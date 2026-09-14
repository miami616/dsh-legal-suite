/**
 * 技能与工具 — 小工具 tab（律师常用测算集合）。
 *
 * 全部为纯本地计算（calc/ 引擎，无网络、无落库），即输即得：
 *   费用测算：诉讼费（受理费/执行费/保全费/申请费）· 律师费（分段/计件/计时/风险代理）
 *   利息违约金：LPR 利息 · 违约金 · 迟延履行加倍利息
 *   期限日期：期限计算（节假日顺延）· 日期差
 *   文书辅助：人民币金额大写
 *
 * 交互与可访问性（前端设计规范）：
 *   • 宽屏双栏：左侧参数卡、右侧结果卡粘性跟随，改一个数立刻看到结果；
 *   • 少量选项用分段控件（原生 radio，键盘/读屏可用），金额/费率输入带单位后缀与快捷值；
 *   • 逐字段失焦校验：错误就地显示并 aria-describedby 关联，结果错误用 role="alert" 播报；
 *   • 依据与口径折叠展示（详情按需展开），主结论单独成「结果英雄区」；
 *   • 所有可点元素有 :focus-visible 焦点环，hover 位移在 prefers-reduced-motion 下关闭。
 */
import { useMemo, useState } from 'react'
import { CALC_GROUPS, CALC_TOOLS, findCalcTool, renderResultText, runCalculator } from '../calc/registry.ts'
import type { CalcParam, CalcResult, CalcToolMeta } from '../calc/types.ts'
import { PERIOD_PRESETS } from '../calc/period.ts'
import { addDays, formatDate, parseDate, today } from '../calc/date.ts'
import { parseAmount } from '../calc/money.ts'
import {
  AlertTriangleIcon, AmountTextIcon, BackIcon, CalendarClockIcon, CalcIcon, CheckIcon, CoinIcon,
  CopyIcon, HandshakeIcon, HourglassIcon, PercentIcon, RangeIcon, ScaleIcon, SearchIcon, TrendIcon,
} from './icons.tsx'
import css from './skills-tools.module.css'

type FieldValue = string | boolean

const GROUP_ICON: Record<string, (props: { size?: number }) => React.JSX.Element> = {
  费用测算: CoinIcon,
  利息与违约金: TrendIcon,
  期限与日期: CalendarClockIcon,
  文书辅助: AmountTextIcon,
}

const TOOL_ICON: Record<string, (props: { size?: number }) => React.JSX.Element> = {
  'litigation-fee': ScaleIcon,
  'lawyer-fee': HandshakeIcon,
  interest: PercentIcon,
  penalty: AlertTriangleIcon,
  'delay-interest': HourglassIcon,
  period: CalendarClockIcon,
  'date-diff': RangeIcon,
  'rmb-uppercase': AmountTextIcon,
}

const QUICK_AMOUNTS = ['1万', '10万', '50万', '100万', '500万', '1000万']
/** 校验用：这些参数为空时提示必填（仅在整体测算报错时兜底提示，避免误报）。 */
const REQUIRED_KEYS = new Set(['amount', 'principal', 'base', 'debt', 'targetFee'])

function toolIcon(tool: CalcToolMeta): (props: { size?: number }) => React.JSX.Element {
  return TOOL_ICON[tool.id] ?? GROUP_ICON[tool.group] ?? CalcIcon
}

/* ────────────────────────────── 默认值 ────────────────────────────── */

function defaultValueFor(tool: CalcToolMeta, param: CalcParam): FieldValue {
  if (param.default !== undefined) {
    return typeof param.default === 'boolean' ? param.default : String(param.default)
  }
  if (param.type === 'boolean') return false
  if (param.type === 'date') {
    const base = today()
    if (param.key === 'end') return formatDate(tool.id === 'date-diff' ? addDays(base, 30) : base)
    if (param.key === 'start') return formatDate(tool.id === 'date-diff' ? base : addDays(base, -90))
    return formatDate(base)
  }
  return ''
}

function defaultsFor(tool: CalcToolMeta): Record<string, FieldValue> {
  const out: Record<string, FieldValue> = {}
  for (const param of tool.params) out[param.key] = defaultValueFor(tool, param)
  return out
}

function isVisible(param: CalcParam, values: Record<string, FieldValue>): boolean {
  if (param.showWhen === undefined) return true
  const actual = String(values[param.showWhen.key] ?? '')
  return param.showWhen.in.includes(actual)
}

/** 单字段格式校验（失焦时提示；空值不报错，交由结果区整体提示）。 */
function validateField(param: CalcParam, value: FieldValue): string | null {
  const text = String(value ?? '').trim()
  if (text === '') return null
  if (param.type === 'amount') {
    const parsed = parseAmount(text)
    if (parsed === null) return '请输入数字，支持「100万」「1.5亿」写法'
    if (parsed < 0) return '金额不能为负数'
    return null
  }
  if (param.type === 'number') {
    const parsed = Number(text.replace(/[,\s]/g, ''))
    if (!Number.isFinite(parsed)) return '请输入数字'
    if (parsed < 0) return '数值不能为负数'
    return null
  }
  if (param.type === 'date') {
    return parseDate(text) === null ? '日期格式应为 YYYY-MM-DD' : null
  }
  return null
}

const PRESET_LOOKUP: Record<string, { count: number; unit: string }> = (() => {
  const out: Record<string, { count: number; unit: string }> = {}
  for (const preset of PERIOD_PRESETS) out[preset.id] = { count: preset.count, unit: preset.unit }
  return out
})()

/* ────────────────────────────── 列表视图 ────────────────────────────── */

/** 小工具 tab 主体。 */
export function CalculatorsSection(): React.JSX.Element {
  const [activeId, setActiveId] = useState<string | null>(null)
  const [query, setQuery] = useState('')

  if (activeId !== null) {
    const tool = findCalcTool(activeId)
    if (tool !== undefined) {
      return <CalcDetail key={tool.id} tool={tool} onBack={() => setActiveId(null)} />
    }
  }

  const q = query.trim().toLowerCase()
  const visible = q === ''
    ? CALC_TOOLS
    : CALC_TOOLS.filter((tool) =>
      tool.name.toLowerCase().includes(q) ||
      tool.desc.toLowerCase().includes(q) ||
      tool.group.toLowerCase().includes(q))

  return (
    <section className={css.section}>
      <div className={css.toolbar}>
        <div className={css.searchBox}>
          <span className={css.searchIcon}><SearchIcon size={13} /></span>
          <input
            className={css.searchInput}
            placeholder="搜索小工具（诉讼费、律师费、利息、期限…）"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="搜索小工具"
          />
          {query !== '' && (
            <button className={css.clearSearch} type="button" aria-label="清除搜索" onClick={() => setQuery('')}>✕</button>
          )}
        </div>
        <div className={css.toolbarActions}>
          <span className={css.calcToolbarNote}>{CALC_TOOLS.length} 个工具 · 纯本地计算 · 即输即得</span>
        </div>
      </div>

      {CALC_GROUPS.map((group) => {
        const items = visible.filter((tool) => tool.group === group)
        if (items.length === 0) return null
        const GroupIcon = GROUP_ICON[group] ?? CalcIcon
        return (
          <div key={group}>
            <div className={`${css.groupTitle} ${css.calcGroupTitle}`}>
              <span className={css.groupName}>{group}</span>
              <span className={css.groupCount}>{items.length}</span>
            </div>
            <div className={css.calcGrid}>
              {items.map((tool) => {
                const Icon = toolIcon(tool)
                return (
                  <button
                    key={tool.id}
                    type="button"
                    className={css.calcCard}
                    onClick={() => setActiveId(tool.id)}
                  >
                    <span className={css.calcCardHead}>
                      <span className={css.cardIcon}><Icon size={15} /></span>
                      <span className={css.calcCardName}>{tool.name}</span>
                      <span className={css.calcCardArrow} aria-hidden="true">
                        <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="m6.2 3.4 4.6 4.6-4.6 4.6" /></svg>
                      </span>
                    </span>
                    <span className={css.calcCardDesc}>{tool.desc}</span>
                    <span className={css.calcCardBasis} title={`依据：${tool.basis}`}>依据：{tool.basis}</span>
                  </button>
                )
              })}
            </div>
          </div>
        )
      })}
      {visible.length === 0 && <p className={css.emptyHint}>没有匹配的小工具。</p>}
    </section>
  )
}

/* ────────────────────────────── 详情视图 ────────────────────────────── */

/** 单个小工具的测算面板（左侧参数 / 右侧结果）。 */
function CalcDetail({ tool, onBack }: { tool: CalcToolMeta; onBack: () => void }): React.JSX.Element {
  const [values, setValues] = useState<Record<string, FieldValue>>(() => defaultsFor(tool))
  const [touched, setTouched] = useState<Record<string, boolean>>({})
  const [copied, setCopied] = useState(false)

  const result = useMemo(() => runCalculator(tool.id, values), [tool.id, values])
  const fields = tool.params.filter((param) => isVisible(param, values))

  const fieldErrors = useMemo(() => {
    const out: Record<string, string> = {}
    for (const param of fields) {
      const error = validateField(param, values[param.key] ?? '')
      if (error !== null) out[param.key] = error
    }
    // 结果报错且没有格式错误时，兜底指出空着的必填金额字段
    if (result.error !== undefined && Object.keys(out).length === 0) {
      const empty = fields.find((param) => REQUIRED_KEYS.has(param.key) && String(values[param.key] ?? '').trim() === '')
      if (empty !== undefined) out[empty.key] = '请填写此项'
    }
    return out
  }, [fields, values, result.error])

  const set = (key: string, value: FieldValue): void => {
    setCopied(false)
    setValues((prev) => {
      const next = { ...prev, [key]: value }
      // 期限工具：选中法定期间预设时同步长度与单位
      if (tool.id === 'period' && key === 'preset' && typeof value === 'string' && value !== '') {
        const preset = PRESET_LOOKUP[value]
        if (preset !== undefined) {
          next.count = String(preset.count)
          next.unit = preset.unit
        }
      }
      return next
    })
  }

  const copy = (): void => {
    const text = renderResultText(result)
    const done = (): void => {
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2200)
    }
    // 剪贴板 API 不可用或被拒时回退到 execCommand（含 http 非安全上下文）
    const fallback = (): void => {
      try {
        const area = document.createElement('textarea')
        area.value = text
        area.setAttribute('readonly', '')
        area.style.position = 'fixed'
        area.style.opacity = '0'
        document.body.appendChild(area)
        area.select()
        document.execCommand('copy')
        area.remove()
        done()
      } catch {
        /* 环境不允许复制：保持按钮原状 */
      }
    }
    if (navigator.clipboard?.writeText !== undefined) {
      navigator.clipboard.writeText(text).then(done).catch(fallback)
    } else {
      fallback()
    }
  }

  const Icon = toolIcon(tool)

  return (
    <section className={css.section}>
      <div className={css.calcDetailHead}>
        <button className={css.calcBack} type="button" onClick={onBack}>
          <BackIcon size={13} /> 全部小工具
        </button>
        <div className={css.calcDetailTitleRow}>
          <span className={css.calcDetailIcon}><Icon size={18} /></span>
          <div className={css.calcDetailTitleCol}>
            <h3 className={css.calcDetailTitle}>{tool.name}</h3>
            <p className={css.calcDetailDesc}>{tool.desc}</p>
          </div>
        </div>
        <p className={css.calcDetailBasis}>依据：{tool.basis}</p>
      </div>

      <div className={css.calcLayout}>
        <div className={css.calcFormCard}>
          <div className={css.calcFormCardHead}>参数</div>
          <div className={css.calcForm}>
            {fields.map((param) => {
              // 失焦后才提示格式错误；整体测算失败时立即提示（避免"改了没反应"）
              const raw = fieldErrors[param.key]
              const showError = raw !== undefined && (touched[param.key] === true || result.error !== undefined)
              return (
                <CalcField
                  key={param.key}
                  param={param}
                  value={values[param.key] ?? ''}
                  error={showError ? raw : null}
                  onChange={(next) => set(param.key, next)}
                  onBlur={() => setTouched((prev) => ({ ...prev, [param.key]: true }))}
                />
              )
            })}
          </div>
        </div>

        <CalcResultView result={result} onCopy={copy} copied={copied} />
      </div>
    </section>
  )
}

/* ────────────────────────────── 表单控件 ────────────────────────────── */

interface CalcFieldProps {
  param: CalcParam
  value: FieldValue
  error: string | null
  onChange(next: FieldValue): void
  onBlur(): void
}

/** 单个参数控件（分段 / 开关 / 带单位后缀输入 + 金额快捷值）。 */
function CalcField({ param, value, error, onChange, onBlur }: CalcFieldProps): React.JSX.Element {
  const errorId = `calc-${param.key}-error`
  const labelId = `calc-${param.key}-label`
  const showQuick = param.type === 'amount' && ['amount', 'targetFee', 'principal', 'base', 'debt'].includes(param.key)
  const errorNode = error !== null
    ? <span className={css.calcFieldError} id={errorId} role="alert">{error}</span>
    : null

  // 布尔项：整行即开关
  if (param.type === 'boolean') {
    return (
      <div className={css.calcField}>
        <label className={css.calcSwitch}>
          <input
            id={`calc-${param.key}`}
            type="checkbox"
            className={css.calcSwitchInput}
            checked={value === true}
            onChange={(e) => onChange(e.target.checked)}
          />
          <span className={css.calcSwitchTrack} aria-hidden="true"><span className={css.calcSwitchThumb} /></span>
          <span className={css.calcSwitchLabel}>{param.label}</span>
        </label>
        {param.hint !== undefined && <span className={css.calcFieldHint}>{param.hint}</span>}
      </div>
    )
  }

  // 少量选项：分段控件（原生 radio，方向键可切换）
  if (param.type === 'select' && param.display === 'segment') {
    return (
      <div className={css.calcField}>
        <span className={css.fieldLabel} id={labelId}>{param.label}</span>
        <div className={css.calcSegment} role="radiogroup" aria-labelledby={labelId}>
          {(param.options ?? []).map((option) => {
            const checked = String(value) === option.value
            return (
              <label key={option.value} className={checked ? `${css.calcSegmentItem} ${css.calcSegmentItemOn}` : css.calcSegmentItem}>
                <input
                  type="radio"
                  name={`calc-${param.key}`}
                  className={css.calcSegmentInput}
                  value={option.value}
                  checked={checked}
                  onChange={() => onChange(option.value)}
                />
                <span>{option.label}</span>
              </label>
            )
          })}
        </div>
        {param.hint !== undefined && <span className={css.calcFieldHint}>{param.hint}</span>}
      </div>
    )
  }

  const isNumericField = param.type === 'amount' || param.type === 'number'
  const input = (
    <>
      <input
        id={`calc-${param.key}`}
        className={isNumericField ? `${css.calcInput} ${css.calcInputNumeric}` : css.calcInput}
        type={param.type === 'date' ? 'date' : 'text'}
        inputMode={param.type === 'date' || param.type === 'text' ? undefined : 'decimal'}
        value={String(value)}
        placeholder={param.placeholder ?? ''}
        aria-invalid={error !== null}
        aria-describedby={error !== null ? errorId : undefined}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
      />
      {param.unit !== undefined && String(value).trim() !== '' && (
        <span className={css.calcUnit} aria-hidden="true">{param.unit}</span>
      )}
    </>
  )

  return (
    <div className={css.calcField}>
      <label className={css.fieldLabel} htmlFor={`calc-${param.key}`}>{param.label}</label>
      {param.type === 'select'
        ? (
          <span className={`${css.calcInputWrap} ${css.calcSelectWrap}`}>
            <select
              id={`calc-${param.key}`}
              className={`${css.calcInput} ${css.calcSelect}`}
              value={String(value)}
              onChange={(e) => onChange(e.target.value)}
            >
              {(param.options ?? []).map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
            <span className={css.calcSelectChevron} aria-hidden="true">
              <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="m4 6.2 4 4 4-4" /></svg>
            </span>
          </span>
        )
        : <span className={css.calcInputWrap}>{input}</span>}
      {showQuick && (
        <span className={css.calcQuick}>
          {QUICK_AMOUNTS.map((amount) => {
            const active = String(value) === amount
            return (
              <button
                key={amount}
                type="button"
                className={active ? `${css.calcChip} ${css.calcChipOn}` : css.calcChip}
                onClick={() => onChange(amount)}
              >
                {amount}
              </button>
            )
          })}
          {String(value) !== '' && (
            <button type="button" className={`${css.calcChip} ${css.calcChipClear}`} onClick={() => onChange('')}>清空</button>
          )}
        </span>
      )}
      {param.hint !== undefined && <span className={css.calcFieldHint}>{param.hint}</span>}
      {errorNode}
    </div>
  )
}

/* ────────────────────────────── 结果视图 ────────────────────────────── */

/** 结果视图：英雄区（主结论）+ 指标网格 + 明细表 + 折叠的依据/口径。 */
function CalcResultView({ result, onCopy, copied }: {
  result: CalcResult
  onCopy(): void
  copied: boolean
}): React.JSX.Element {
  const [notesOpen, setNotesOpen] = useState(false)

  if (result.error !== undefined) {
    return (
      <div className={css.calcResult} role="alert">
        <div className={css.calcResultHead}>
          <span className={css.calcResultTitle}>无法测算</span>
        </div>
        <p className={css.calcError}>{result.error}</p>
      </div>
    )
  }

  const main = result.summary.find((row) => row.emphasis === true) ?? result.summary[0]
  const stats = result.summary.filter((row) => row !== main)
  const notes = result.notes ?? []

  return (
    <div className={css.calcResult}>
      <div className={css.calcResultHead}>
        <span className={css.calcResultTitle}>{result.title}</span>
        <button className={copied ? `${css.calcCopy} ${css.calcCopyDone}` : css.calcCopy} type="button" onClick={onCopy}>
          {copied ? <CheckIcon size={12} /> : <CopyIcon size={12} />}
          {copied ? '已复制' : '复制结果'}
        </button>
        <span className={css.calcLive} role="status" aria-live="polite">{copied ? '结果已复制到剪贴板' : ''}</span>
      </div>

      {main !== undefined && (
        <div className={css.calcHero}>
          <span className={css.calcHeroLabel}>{main.label}</span>
          <span className={css.calcHeroValue}>{main.value}</span>
          {main.hint !== undefined && <span className={css.calcHeroHint}>{main.hint}</span>}
        </div>
      )}

      {stats.length > 0 && (
        <div className={css.calcStats}>
          {stats.map((row, index) => (
            <div key={`${row.label}-${index}`} className={css.calcStat}>
              <span className={css.calcStatLabel}>{row.label}</span>
              <span className={css.calcStatValue}>{row.value}</span>
              {row.hint !== undefined && <span className={css.calcStatHint}>{row.hint}</span>}
            </div>
          ))}
        </div>
      )}

      {(result.tables ?? []).map((table, index) => (
        <div key={`table-${index}`} className={css.calcTableWrap}>
          {table.caption !== undefined && <p className={css.calcTableCaption}>{table.caption}</p>}
          <table className={css.calcTable}>
            <thead>
              <tr>{table.columns.map((column, ci) => <th key={ci} className={ci === 0 ? css.calcThLeft : undefined} scope="col">{column}</th>)}</tr>
            </thead>
            <tbody>
              {table.rows.map((row, ri) => (
                <tr key={ri}>
                  {row.map((cell, ci) => (ci === 0
                    ? <td key={ci} className={css.calcTdLeft}>{cell}</td>
                    : <td key={ci}>{cell}</td>))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}

      {notes.length > 0 && (
        <details className={css.calcNotes} open={notesOpen} onToggle={(e) => setNotesOpen((e.currentTarget as HTMLDetailsElement).open)}>
          <summary className={css.calcNotesSummary}>依据与口径 · {notes.length} 条</summary>
          <ul className={css.calcNotesList}>
            {notes.map((note, index) => <li key={index}>{note}</li>)}
          </ul>
        </details>
      )}
    </div>
  )
}
