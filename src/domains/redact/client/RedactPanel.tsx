/**
 * RedactPanel.tsx — 文书脱敏工具视图（嵌在「技能与工具 → 小工具」里）。
 *
 * 版式对齐相邻测算工具：左栏参数（归属 / 输入 / 选项），右栏结果卡粘性跟随；
 * 三个 tab：脱敏（工作台）/ 词条 / 映射。
 * 全部识别与替换在 host 侧本机完成，本视图只做展示与操作。
 */
import React from 'react'
import {
  redactApi, TERM_KINDS,
  type MappingDocView, type RedactConfigView, type RedactMode, type RedactReport, type TermEntryView,
} from './api.ts'

interface RedactPanelProps {
  /** 请求关闭（独立弹出时用；嵌入小工具时由宿主面板返回按钮负责）。 */
  onClose?(): void
  /** 嵌入模式：不渲染「关闭」按钮。 */
  embedded?: boolean
}

type Tab = 'work' | 'terms' | 'mappings'

interface Toast { text: string; kind: 'ok' | 'warn' | 'info' }
const TOAST_MS = 2800

const TABS: Array<[Tab, string]> = [['work', '脱敏'], ['terms', '词条'], ['mappings', '映射']]

/** 命中统计 chips（类别 + 数量，鼠标悬停看打码样例）。 */
function StatChips({ report }: { report: RedactReport }): React.ReactElement {
  if (report.byKind.length === 0) return <p className="redact-note">未命中任何敏感信息。</p>
  return (
    <div className="redact-chips">
      {report.byKind.map((stat) => (
        <span key={stat.kind} className="redact-chip redact-chip--hit" title={stat.samples.join('、')}>
          {stat.label} <b>{stat.count}</b>
        </span>
      ))}
    </div>
  )
}

export function RedactPanel({ onClose, embedded = false }: RedactPanelProps): React.ReactElement {
  const [tab, setTab] = React.useState<Tab>('work')
  const [scope, setScope] = React.useState('')
  /** 输入方式：文本（粘贴）/ 文件（docx、pdf、图片）/ 目录（整卷批量）。 */
  const [inputMode, setInputMode] = React.useState<'text' | 'file' | 'dir'>('text')
  const [filePath, setFilePath] = React.useState('')
  const [dirPath, setDirPath] = React.useState('')
  const [outPath, setOutPath] = React.useState('')
  const [outPaths, setOutPaths] = React.useState<string[]>([])
  const [notes, setNotes] = React.useState<string[]>([])
  const [batchResults, setBatchResults] = React.useState<Array<{ file: string; outPaths: string[]; hits: number; error?: string }>>([])
  const [mode, setMode] = React.useState<RedactMode>('reversible')
  const [input, setInput] = React.useState('')
  const [output, setOutput] = React.useState('')
  const [report, setReport] = React.useState<RedactReport | null>(null)
  const [busy, setBusy] = React.useState<'' | 'scan' | 'redact' | 'restore'>('')
  const [config, setConfig] = React.useState<RedactConfigView | null>(null)
  const [terms, setTerms] = React.useState<{ global: TermEntryView[]; caseTerms: TermEntryView[] }>({ global: [], caseTerms: [] })
  const [newTerm, setNewTerm] = React.useState('')
  const [newKind, setNewKind] = React.useState('')
  const [scopes, setScopes] = React.useState<string[]>([])
  const [mappingDoc, setMappingDoc] = React.useState<MappingDocView | null>(null)
  const [toast, setToast] = React.useState<Toast | null>(null)
  const toastTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null)

  const showToast = React.useCallback((text: string, kind: Toast['kind'] = 'info'): void => {
    if (toastTimer.current !== null) clearTimeout(toastTimer.current)
    setToast({ text, kind })
    toastTimer.current = setTimeout(() => setToast(null), TOAST_MS)
  }, [])
  const fail = React.useCallback((error: unknown): void => {
    showToast(error instanceof Error ? error.message : String(error), 'warn')
  }, [showToast])

  /** 当前归属（空 = 全库词条）。 */
  const scopeKey = scope.trim()
  const currentTerms = scopeKey === '' ? terms.global : terms.caseTerms

  const loadTerms = React.useCallback(async (): Promise<void> => {
    try {
      const view = await redactApi.terms(scopeKey)
      setTerms(view.terms)
      setScopes(view.mappingScopes)
    } catch (error) { fail(error) }
  }, [scopeKey, fail])

  React.useEffect(() => {
    redactApi.config().then(setConfig).catch(fail)
  }, [fail])

  // 归属变化 → 重新取该归属的词条（防抖，避免逐字请求）。
  React.useEffect(() => {
    const timer = setTimeout(() => { void loadTerms() }, 300)
    return () => clearTimeout(timer)
  }, [loadTerms])

  React.useEffect(() => {
    if (embedded || onClose === undefined) return
    const onEsc = (e: KeyboardEvent): void => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onEsc)
    return () => window.removeEventListener('keydown', onEsc)
  }, [onClose, embedded])

  React.useEffect(() => () => { if (toastTimer.current !== null) clearTimeout(toastTimer.current) }, [])

  const onScan = async (): Promise<void> => {
    if (inputMode === 'dir') return showToast('目录模式只能批量脱敏（预检请逐个文件）', 'warn')
    if (inputMode === 'file' && filePath.trim() === '') return showToast('先填文件路径', 'warn')
    if (inputMode === 'text' && input.trim() === '') return showToast('先粘贴要处理的内容', 'warn')
    setBusy('scan')
    try {
      const request = inputMode === 'file'
        ? { scope: scopeKey, path: filePath.trim(), reveal: true }
        : { scope: scopeKey, text: input, reveal: true }
      const result = await redactApi.scan(request)
      setReport(result.report)
      showToast(`预检完成：命中 ${result.report.totalHits} 处 · 词典 ${result.lexiconCount} 条`, 'ok')
    } catch (error) { fail(error) } finally { setBusy('') }
  }

  const onRedact = async (): Promise<void> => {
    if (inputMode === 'text' && input.trim() === '') return showToast('先粘贴要处理的内容', 'warn')
    if (inputMode === 'file' && filePath.trim() === '') return showToast('先填文件路径', 'warn')
    if (inputMode === 'dir' && dirPath.trim() === '') return showToast('先填目录路径', 'warn')
    setBusy('redact')
    try {
      if (inputMode === 'dir') {
        const result = await redactApi.batch(dirPath.trim(), { scope: scopeKey, mode })
        setBatchResults(result.results)
        setNotes(result.notes ?? [])
        setOutPaths([])
        setOutput('')
        setReport(null)
        const ok = result.results.filter((item) => item.error === undefined).length
        showToast(`批量完成：${ok}/${result.results.length} 个文件已脱敏`, 'ok')
        void loadTerms()
        return
      }
      const request = inputMode === 'file'
        ? { scope: scopeKey, mode, path: filePath.trim(), outPath: outPath.trim() === '' ? undefined : outPath.trim(), includeText: true, reveal: true }
        : { scope: scopeKey, mode, text: input, reveal: true }
      const result = await redactApi.redact(request)
      setOutput(result.text ?? '')
      setOutPaths(result.outPaths ?? [])
      setNotes(result.notes ?? [])
      setBatchResults([])
      setReport(result.report)
      showToast(mode === 'masked'
        ? `已按「对外单向」脱敏 ${result.report.totalHits} 处（不可还原）`
        : `已脱敏 ${result.report.totalHits} 处${inputMode === 'file' ? '，已产出副本' : ''}`, 'ok')
      void loadTerms()
    } catch (error) { fail(error) } finally { setBusy('') }
  }

  const onRestore = async (): Promise<void> => {
    if (inputMode === 'dir') return showToast('目录模式不支持还原（还原请指定单个文件或用文本模式）', 'warn')
    if (inputMode === 'file' && filePath.trim() === '') return showToast('先填文件路径', 'warn')
    if (inputMode === 'text' && input.trim() === '') return showToast('把要还原的文本粘到「待处理内容」里', 'warn')
    setBusy('restore')
    try {
      const request = inputMode === 'file'
        ? { scope: scopeKey, path: filePath.trim(), includeText: true }
        : { scope: scopeKey, text: input }
      const result = await redactApi.restore(request)
      setOutput(result.text ?? '')
      setOutPaths(result.outPaths ?? [])
      setNotes(result.notes ?? [])
      showToast(`已还原 ${result.restored} 处${result.missing.length > 0 ? ` · ${result.missing.length} 处未还原` : ''}`, 'ok')
    } catch (error) { fail(error) } finally { setBusy('') }
  }

  const onCopy = async (): Promise<void> => {
    const text = output === '' ? input : output
    if (text === '') return showToast('没有可复制的内容', 'warn')
    try {
      await navigator.clipboard.writeText(text)
      showToast('已复制到剪贴板', 'ok')
    } catch { showToast('复制失败：请手动选中复制', 'warn') }
  }

  const addTerm = async (value: string, kind?: string): Promise<void> => {
    const trimmed = value.trim()
    if (trimmed === '') return
    try {
      await redactApi.addTerms(scopeKey, [{ value: trimmed, ...(kind === undefined || kind === '' ? {} : { kind }) }])
      setNewTerm('')
      await loadTerms()
      showToast(`已加入词条：${trimmed}`, 'ok')
    } catch (error) { fail(error) }
  }

  const removeTerm = async (target: string, termScope: string): Promise<void> => {
    try {
      await redactApi.removeTerms(termScope, [target])
      await loadTerms()
    } catch (error) { fail(error) }
  }

  const saveConfig = async (patch: Partial<Pick<RedactConfigView, 'maskAmounts' | 'heuristic' | 'crossScope'>>): Promise<void> => {
    try { setConfig(await redactApi.saveConfig(patch)) } catch (error) { fail(error) }
  }

  const openMapping = async (target: string): Promise<void> => {
    try { setMappingDoc(await redactApi.mapping(target)) } catch (error) { fail(error) }
  }

  const scopeHint = scopeKey === ''
    ? '留空 = 用全库词条（跨案匹配）。填案件编号更准：只匹配该案的当事人、案号、法官、法院。'
    : `只用「${scopeKey}」的词条（+ 全局词条）与它的映射表。`

  return (
    <div className="redact-root">
      <div className="redact-head">
        <div className="redact-tabs" role="tablist">
          {TABS.map(([key, label]) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={tab === key}
              className={`redact-tab${tab === key ? ' redact-tab--on' : ''}`}
              onClick={() => { setTab(key); if (key === 'mappings') void loadTerms() }}
            >
              {label}
            </button>
          ))}
        </div>
        <span className="redact-head__note">
          {scopeKey === '' ? '全库词条' : scopeKey} · {terms.global.length + terms.caseTerms.length} 条自定义词条
        </span>
        {embedded || onClose === undefined ? null : (
          <button type="button" className="redact-btn" onClick={onClose}>关闭</button>
        )}
      </div>

      {tab === 'work' ? (
        <div className="redact-grid">
          {/* 左栏：归属 / 输入 / 选项 */}
          <div className="redact-col">
            <div className="redact-card">
              <div className="redact-cardHead">归属与模式</div>
              <div className="redact-field">
                <label className="redact-label">归属（案件编号 / 项目 id）</label>
                <input
                  className="redact-input"
                  placeholder="如 2026-056；留空 = 全库词条"
                  value={scope}
                  onChange={(e) => setScope(e.target.value)}
                />
              </div>
              <div className="redact-field">
                <label className="redact-label">输入方式</label>
                <select className="redact-select" value={inputMode} onChange={(e) => setInputMode(e.target.value === 'file' ? 'file' : e.target.value === 'dir' ? 'dir' : 'text')}>
                  <option value="text">文本（粘贴）</option>
                  <option value="file">文件（docx / pdf / 图片）</option>
                  <option value="dir">目录（整卷批量）</option>
                </select>
              </div>
              <div className="redact-field">
                <label className="redact-label">脱敏模式</label>
                <select className="redact-select" value={mode} onChange={(e) => setMode(e.target.value === 'masked' ? 'masked' : 'reversible')}>
                  <option value="reversible">可还原（内部流转，映射存本机）</option>
                  <option value="masked">对外单向（不可还原）</option>
                </select>
              </div>
              <p className="redact-note">{scopeHint}</p>
            </div>

            <div className="redact-card">
              <div className="redact-cardHead">{inputMode === 'file' ? '待处理文件' : inputMode === 'dir' ? '待处理目录' : '待处理内容'}</div>
              {inputMode === 'text' ? (
                <textarea
                  className="redact-textarea"
                  placeholder="把要外发的材料粘到这里（纯文本）：起诉状、答辩状、合同、证据清单……"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                />
              ) : null}
              {inputMode === 'file' ? (
                <>
                  <div className="redact-field">
                    <label className="redact-label">文件路径</label>
                    <input
                      className="redact-input"
                      placeholder="如 /Users/me/…/起诉状.docx（Finder 里 ⌥⌘C 复制路径）"
                      value={filePath}
                      onChange={(e) => setFilePath(e.target.value)}
                    />
                  </div>
                  <div className="redact-field">
                    <label className="redact-label">输出路径（可留空）</label>
                    <input
                      className="redact-input"
                      placeholder="留空 = 同目录 <原名>.redacted.docx / .redacted.txt"
                      value={outPath}
                      onChange={(e) => setOutPath(e.target.value)}
                    />
                  </div>
                  <p className="redact-note">.docx 出**保格式副本**（版式、表格、批注不动）+ 脱敏文本；.pdf/.txt 出脱敏文本；图片与无文字层 PDF 自动走本机 OCR。原件不动。</p>
                </>
              ) : null}
              {inputMode === 'dir' ? (
                <>
                  <div className="redact-field">
                    <label className="redact-label">目录路径</label>
                    <input
                      className="redact-input"
                      placeholder="如 /Users/me/…/2026-056 案卷目录"
                      value={dirPath}
                      onChange={(e) => setDirPath(e.target.value)}
                    />
                  </div>
                  <p className="redact-note">目录内所有可处理文件逐个脱敏（整卷对外提供用）；同一归属共用一张映射表，假名跨文件一致。原件不动。</p>
                </>
              ) : null}
              <div className="redact-actions">
                <button type="button" className="redact-btn redact-btn--primary" disabled={busy !== ''} onClick={() => void onRedact()}>
                  {busy === 'redact' ? '处理中…' : inputMode === 'file' ? '脱敏这个文件' : inputMode === 'dir' ? '批量脱敏目录' : '脱敏'}
                </button>
                <button type="button" className="redact-btn" disabled={busy !== ''} onClick={() => void onScan()}>
                  {busy === 'scan' ? '预检中…' : '预检命中'}
                </button>
                <button type="button" className="redact-btn" disabled={busy !== ''} onClick={() => void onRestore()}>
                  {busy === 'restore' ? '还原中…' : inputMode === 'file' ? '还原这个文件' : '还原'}
                </button>
              </div>
            </div>

            <div className="redact-card">
              <div className="redact-cardHead">选项</div>
              <label className="redact-check">
                <input type="checkbox" checked={config?.maskAmounts === true} onChange={(e) => void saveConfig({ maskAmounts: e.target.checked })} />
                给金额也打码（默认不打——金额常是案件要素）
              </label>
              <label className="redact-check">
                <input type="checkbox" checked={config?.heuristic !== false} onChange={(e) => void saveConfig({ heuristic: e.target.checked })} />
                启发层候选（只报告、不替换）
              </label>
              <label className="redact-check">
                <input type="checkbox" checked={config?.crossScope === true} onChange={(e) => void saveConfig({ crossScope: e.target.checked })} />
                跨案并入全库词条
              </label>
              <p className="redact-note">
                全部识别在本机完成，不联网、不上传。映射表在 <code>$DSH_HOME/agentlex/redact/mappings/</code>，
                含原文，属本机机密，勿外发或推送。
              </p>
            </div>
          </div>

          {/* 右栏：结果卡（粘性跟随） */}
          <div className="redact-col">
            <div className="redact-card redact-card--sticky">
              <div className="redact-cardHead">
                结果
                <span className="redact-badge">{mode === 'masked' ? '对外单向' : '可还原'}</span>
                {output === '' ? null : <span className="redact-badge redact-badge--muted">可复制</span>}
              </div>
              <textarea
                className="redact-textarea redact-textarea--out"
                placeholder="点「脱敏」后这里出现可外发的版本；点「还原」则出现原文。"
                value={output}
                onChange={(e) => setOutput(e.target.value)}
              />
              <div className="redact-actions">
                <button type="button" className="redact-btn redact-btn--primary" onClick={() => void onCopy()}>复制结果</button>
                <button type="button" className="redact-btn" onClick={() => { setInput(''); setOutput(''); setReport(null); setOutPaths([]); setNotes([]); setBatchResults([]) }}>清空</button>
              </div>
              {outPaths.length > 0 ? (
                <div className="redact-sub">
                  <div className="redact-cardHead">产物</div>
                  {outPaths.map((item) => <div key={item} className="redact-item__value" style={{ fontFamily: 'var(--rd-font-mono)', fontSize: 12.5 }}>{item}</div>)}
                </div>
              ) : null}
              {batchResults.length > 0 ? (
                <div className="redact-sub">
                  <div className="redact-cardHead">批量结果</div>
                  <div className="redact-list">
                    {batchResults.map((item) => (
                      <div key={item.file} className="redact-item">
                        <div className="redact-item__main">
                          <div className="redact-item__value">{item.file}</div>
                          <div className="redact-item__meta">{item.error === undefined ? `${item.hits} 处命中` : item.error}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
              {notes.length > 0 ? (
                <div className="redact-sub">
                  {notes.map((note) => <p key={note} className="redact-note">{note}</p>)}
                </div>
              ) : null}

              {report === null ? null : (
                <div className="redact-sub">
                  <div className="redact-cardHead" style={{ marginTop: 4 }}>命中统计 · {report.totalHits} 处</div>
                  <StatChips report={report} />
                  {report.candidates.length === 0 ? null : (
                    <>
                      <p className="redact-note">
                        以下候选**未替换**（启发层只报告）。确认是真人名/实体后点「加入词条」，下次脱敏即精确命中：
                      </p>
                      <div className="redact-chips">
                        {report.candidates.map((candidate) => (
                          <span key={candidate.display} className="redact-chip redact-chip--cand" title={`锚点：${candidate.anchor}`}>
                            {candidate.display} ×{candidate.count}
                            <button
                              type="button"
                              className="redact-chip__add"
                              disabled={candidate.value === undefined}
                              title={candidate.value === undefined ? '原文未随响应返回，请到「词条」手动添加' : `加入词条：${candidate.value}`}
                              onClick={() => void addTerm(candidate.value ?? '', 'person')}
                            >
                              加入词条
                            </button>
                          </span>
                        ))}
                      </div>
                    </>
                  )}
                  {report.warnings.length === 0 ? null : (
                    <div className="redact-warn">
                      {report.warnings.map((warning) => <div key={warning}>{warning}</div>)}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      ) : null}

      {tab === 'terms' ? (
        <div className="redact-grid redact-grid--one">
          <div className="redact-card">
            <div className="redact-cardHead">新增词条 · {scopeKey === '' ? '全局' : scopeKey}</div>
            <div className="redact-field">
              <label className="redact-label">名字 / 名称</label>
              <input
                className="redact-input"
                placeholder="如 王小明、某某科技有限公司"
                value={newTerm}
                onChange={(e) => setNewTerm(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') void addTerm(newTerm, newKind) }}
              />
            </div>
            <div className="redact-field">
              <label className="redact-label">类别</label>
              <select className="redact-select" value={newKind} onChange={(e) => setNewKind(e.target.value)}>
                {TERM_KINDS.map((kind) => <option key={kind.value} value={kind.value}>{kind.label}</option>)}
              </select>
            </div>
            <div className="redact-actions">
              <button type="button" className="redact-btn redact-btn--primary" onClick={() => void addTerm(newTerm, newKind)}>添加</button>
            </div>
            <p className="redact-note">
              「自动判断」按名字形态归类：中文二三字 → 人名池（张某）；像公司/机关 → 机构池（机构A）。
            </p>
          </div>

          <div className="redact-card">
            <div className="redact-cardHead">
              {scopeKey === '' ? '全局词条' : `「${scopeKey}」词条`}
              <span className="redact-badge redact-badge--muted">{currentTerms.length}</span>
            </div>
            <div className="redact-list">
              {currentTerms.length === 0
                ? <div className="redact-empty">暂无词条</div>
                : currentTerms.map((term) => (
                  <div key={term.value} className="redact-item">
                    <div className="redact-item__main">
                      <div className="redact-item__value">{term.value}</div>
                      <div className="redact-item__meta">
                        {TERM_KINDS.find((k) => k.value === term.kind)?.label ?? term.kind}
                        {term.note === undefined ? '' : ` · ${term.note}`}
                      </div>
                    </div>
                    <button type="button" className="redact-del" onClick={() => void removeTerm(term.value, scopeKey)}>删除</button>
                  </div>
                ))}
            </div>
          </div>

          {scopeKey === '' || terms.global.length === 0 ? null : (
            <div className="redact-card">
              <div className="redact-cardHead">
                全局词条（对所有案件生效）
                <span className="redact-badge redact-badge--muted">{terms.global.length}</span>
              </div>
              <div className="redact-list">
                {terms.global.map((term) => (
                  <div key={term.value} className="redact-item">
                    <div className="redact-item__main"><div className="redact-item__value">{term.value}</div></div>
                    <button type="button" className="redact-del" onClick={() => void removeTerm(term.value, 'global')}>删除</button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      ) : null}

      {tab === 'mappings' ? (
        <div className="redact-grid redact-grid--one">
          <div className="redact-card">
            <div className="redact-warn">
              映射表含**原文**，仅本机查看；请勿复制、截图或发送给任何人。
            </div>
          </div>

          <div className="redact-card">
            <div className="redact-cardHead">
              已脱敏的归属
              <span className="redact-badge redact-badge--muted">{scopes.length}</span>
            </div>
            <div className="redact-list">
              {scopes.length === 0
                ? <div className="redact-empty">还没有脱敏记录</div>
                : scopes.map((item) => (
                  <div key={item} className="redact-item">
                    <div className="redact-item__main"><div className="redact-item__value">{item}</div></div>
                    <button type="button" className="redact-btn" onClick={() => void openMapping(item)}>查看对照</button>
                  </div>
                ))}
            </div>
          </div>

          {mappingDoc === null ? null : (
            <div className="redact-card">
              <div className="redact-cardHead">
                {mappingDoc.scope} · 对照表
                <span className="redact-badge redact-badge--muted">{Object.keys(mappingDoc.entities).length} 条</span>
                <span className="redact-badge">{mappingDoc.restorable ? '可还原' : '对外单向'}</span>
              </div>
              <div className="redact-list">
                {Object.entries(mappingDoc.entities).map(([original, entity]) => (
                  <div key={original} className="redact-item">
                    <div className="redact-item__main">
                      <div className="redact-item__value">{original}</div>
                      <div className="redact-item__meta">{entity.note ?? entity.source ?? ''}</div>
                    </div>
                    <span className="redact-item__alias">{entity.alias}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      ) : null}

      {toast === null ? null : (
        <div className={`redact-toast${toast.kind === 'ok' ? ' redact-toast--ok' : toast.kind === 'warn' ? ' redact-toast--warn' : ''}`}>
          {toast.text}
        </div>
      )}
    </div>
  )
}
