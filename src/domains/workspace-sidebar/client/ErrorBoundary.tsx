/**
 * ErrorBoundary — 让工作区面板在内部模块（如文件预览链）崩溃时，
 * 不整块白屏，而是就地显示可恢复的错误提示。
 *
 * 触发场景：点文件 → app/ 的 FilePreviewModal（经 `@` 别名打包进本插件）
 * 懒加载 MonacoEditor / richdoc 链时，模块作用域读取 `.d` 打到 undefined
 * 抛未捕获错误 —— 原先整个面板随之空白。这里兜底，把错误收口到面板内。
 */
import { Component, type ReactNode } from 'react'

interface ErrorBoundaryProps {
  children: ReactNode
  /** 可选：自定义错误提示标题 */
  title?: string
}

interface ErrorBoundaryState {
  error: Error | null
  componentStack: string | null
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null, componentStack: null }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { error }
  }

  componentDidCatch(error: Error, info: { componentStack?: string }): void {
    console.error('[agentlex-workspace] 面板组件错误', error, info?.componentStack ?? '')
    this.setState({ componentStack: info?.componentStack ?? null })
  }

  private reset = (): void => {
    this.setState({ error: null, componentStack: null })
  }

  render(): ReactNode {
    if (this.state.error === null) return this.props.children
    const e = this.state.error
    const msg = e instanceof Error ? e.message : String(e)
    const stack = e instanceof Error && e.stack ? e.stack : ''
    const compStack = this.state.componentStack ?? ''
    return (
      <div className="flex h-full min-h-0 flex-col items-center justify-center gap-3 px-6 text-center">
        <div className="text-sm font-medium text-[var(--dsw-alias-label-primary, var(--ink))]">
          {this.props.title ?? '这部分内容加载出错了'}
        </div>
        <div className="max-w-[90%] text-xs leading-relaxed text-[var(--dsw-alias-label-tertiary, var(--ink-muted))]">
          把下方错误原文发我即可定位。
        </div>
        <pre className="max-w-[92%] max-h-40 overflow-auto whitespace-pre-wrap break-all rounded-md bg-[var(--dsw-alias-bg-layer-2, var(--paper-inset))] px-3 py-2 text-left text-[11px] leading-relaxed text-[var(--dsw-alias-label-secondary, var(--ink-muted))]">
          {msg}
          {'\n\n'}
          {stack}
          {'\n\n'}
          {compStack ? `组件栈:\n${compStack}` : ''}
        </pre>
        <button
          type="button"
          onClick={this.reset}
          className="rounded-md px-3 py-1.5 text-xs text-[var(--dsw-alias-label-primary, var(--ink))] transition-colors hover:bg-[var(--dsw-alias-bg-layer-2, var(--paper-inset))]"
        >
          重试
        </button>
      </div>
    )
  }
}
