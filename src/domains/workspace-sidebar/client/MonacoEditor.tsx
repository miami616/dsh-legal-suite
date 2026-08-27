/**
 * MonacoEditor — DSH 版替代（Phase 3 预览的代码/编辑宿主）。
 *
 * 原版用 monaco-editor 本地
 * bundle + Vite `?worker` 导入（editor/json/css/html/ts 五个 worker）。
 * tsdown/rolldown 无法解析 `?worker`（构建期改不了 Vite sugar），按
 * RESTART-PLAN §5.3 的降级路径处理：
 *   - 只读预览 → react-syntax-highlighter（Prism）高亮，无 worker、无大包；
 *   - 可编辑   → 原生 <textarea>（monospace），保留 自动保存(onChange) +
 *     Cmd/Ctrl+S(onSave)，去掉了 Monaco 的多模型/边框/最小化图等重能力。
 * 与 FilePreviewModal 传参兼容：value/language/wordWrap/readOnly/onSave/
 * initialLineNumber/focusTarget/onQuote。
 */
import { useEffect, useMemo, useRef } from 'react'
import SyntaxHighlighter from 'react-syntax-highlighter'
import { oneDark } from 'react-syntax-highlighter/dist/cjs/styles/prism'
import { oneLight } from 'react-syntax-highlighter/dist/cjs/styles/prism'

export interface MonacoEditorProps {
  value?: string
  onChange?(value: string): void
  language?: string
  wordWrap?: 'on' | 'off'
  readOnly?: boolean
  onSave?(): void
  initialLineNumber?: number
  focusTarget?: { requestId: number; line: number; column?: number } | null
  onQuote?(): void
  options?: Record<string, unknown>
  theme?: string
  height?: string | number
  path?: string
  onMount?(editor: unknown, monaco: unknown): void
}

const MONACO_TO_PRISM: Record<string, string> = {
  typescript: 'typescript',
  javascript: 'javascript',
  jsx: 'jsx',
  tsx: 'tsx',
  json: 'json',
  html: 'markup',
  css: 'css',
  scss: 'scss',
  less: 'less',
  markdown: 'markdown',
  python: 'python',
  java: 'java',
  c: 'c',
  cpp: 'cpp',
  go: 'go',
  rust: 'rust',
  sql: 'sql',
  shell: 'bash',
  yaml: 'yaml',
  xml: 'markup',
  plaintext: 'text',
}

function prismLang(language: string | undefined): string {
  return MONACO_TO_PRISM[(language ?? '').toLowerCase()] ?? 'text'
}

function isDarkTheme(): boolean {
  const doc = document.documentElement
  return doc.dataset.dsDarkTheme === 'true' || doc.getAttribute('data-ds-dark-theme') === 'true' ||
    doc.dataset.agentlexTheme === 'dark' || document.body.classList.contains('dark')
}

/** 行号 + 高亮只读预览。 */
function ReadOnlyHighlight({ value, language, showLines }: { value: string; language: string; showLines: boolean }): React.JSX.Element {
  const dark = isDarkTheme()
  return (
    <div className="h-full w-full overflow-auto bg-transparent" style={{ fontSize: 13, lineHeight: 1.6 }}>
      <SyntaxHighlighter
        language={prismLang(language)}
        style={dark ? oneDark : oneLight}
        showLineNumbers={showLines}
        wrapLongLines={false}
        customStyle={{ margin: 0, padding: '12px 16px', background: 'transparent', height: '100%', overflow: 'auto' }}
        codeTagProps={{ style: { fontFamily: 'var(--dsw-alias-font-mono, var(--font-mono, ui-monospace, monospace))', fontSize: 13 } }}
      >
        {value}
      </SyntaxHighlighter>
    </div>
  )
}

/** 可编辑：textarea（monospace）保留自动保存 + Cmd/Ctrl+S。 */
function EditableTextarea(props: MonacoEditorProps): React.JSX.Element {
  const ref = useRef<HTMLTextAreaElement | null>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const onKey = (e: KeyboardEvent): void => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault()
        props.onSave?.()
      }
    }
    el.addEventListener('keydown', onKey)
    return () => el.removeEventListener('keydown', onKey)
  }, [props.onSave])

  return (
    <textarea
      ref={ref}
      className="h-full w-full resize-none border-0 bg-transparent p-3 outline-none"
      value={props.value ?? ''}
      spellCheck={false}
      autoCapitalize="off"
      autoComplete="off"
      style={{
        fontFamily: 'var(--dsw-alias-font-mono, var(--font-mono, ui-monospace, monospace))',
        fontSize: 13,
        lineHeight: 1.6,
        color: 'var(--dsw-alias-label-primary, var(--ink))',
        whiteSpace: 'pre',
        tabSize: 2,
      }}
      onChange={(e) => props.onChange?.(e.target.value)}
      onBlur={() => props.onSave?.()}
      data-agentlex-code-editor
    />
  )
}

export default function MonacoEditor(props: MonacoEditorProps): React.JSX.Element {
  const { readOnly, value, language, focusTarget } = props
  const showLines = useMemo(() => language !== 'markdown', [language])

  // focusTarget: 尽力滚到目标行（textarea 无内联跳转，定位简单滚动）。
  useEffect(() => {
    if (!focusTarget || !focusTarget.line) return
    const el = document.querySelector<HTMLTextAreaElement>('[data-agentlex-code-editor]')
    if (el) el.scrollTop = (focusTarget.line - 1) * (13 * 1.6)
  }, [focusTarget])

  if (readOnly) {
    return <ReadOnlyHighlight value={value ?? ''} language={language ?? 'plaintext'} showLines={showLines} />
  }
  return <EditableTextarea {...props} />
}