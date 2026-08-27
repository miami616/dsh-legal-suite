/**
 * FilePreviewModal — lightweight in-app file preview for the DSH plugin.
 *
 * The original AgentLex desktop used a heavy modal (Monaco + pdf.js +
 * docx-preview + SheetJS + pptx-renderer) that cannot be bundled into the DSH
 * web plugin. This replacement keeps the same props contract and covers the
 * three practical cases:
 *   - text-like files: the caller already fetched `content` → render in a
 *     scrollable <pre> (read-only);
 *   - rich documents (pdf/docx/xlsx/pptx): no pure-frontend parser is bundled,
 *     so the modal explains the format and offers 「用默认应用打开」 (the host
 *     opens the file in the OS default app);
 *   - loading / error states are rendered as-is.
 */
import { X, ExternalLink, FileText, Loader2 } from 'lucide-react';
import type { ReactNode } from 'react';
import OverlayBackdrop from '@/components/OverlayBackdrop';
import type { RichDocKind } from '../../shared/fileTypes';

export interface FilePreviewModalProps {
  /** File name to display. */
  name: string;
  /** Text content (already fetched by the caller for text-like files). */
  content: string;
  /** File size in bytes. */
  size: number;
  /** Relative path inside the case folder. */
  path: string;
  /** When set, render the rich-document notice instead of the text body. */
  richDocKind?: RichDocKind;
  /** Whether content is still loading. */
  isLoading?: boolean;
  /** Error message to display. */
  error?: string | null;
  /** Absolute case-folder root (unused here; kept for prop parity). */
  workspacePath?: string | null;
  /** Close the modal. */
  onClose: () => void;
  /** Open the file in the OS default app (rich docs / binary). */
  onOpenExternal?: () => void;
}

const RICH_DOC_LABEL: Record<RichDocKind, string> = {
  pdf: 'PDF 文档',
  docx: 'Word 文档',
  sheet: 'Excel 表格',
  pptx: 'PowerPoint 演示文稿',
};

export default function FilePreviewModal({
  name,
  content,
  size,
  richDocKind,
  isLoading,
  error,
  onClose,
  onOpenExternal,
}: FilePreviewModalProps): ReactNode {
  return (
    <OverlayBackdrop onClose={onClose} className="z-[210] px-4 py-6 overflow-y-auto">
      <div
        className="w-full max-w-3xl flex flex-col rounded-2xl border border-[var(--line)] bg-[var(--paper-elevated)] shadow-2xl overflow-hidden"
        style={{ maxHeight: '86vh' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-[var(--line-subtle)] bg-[var(--paper)]">
          <FileText size={15} className="shrink-0 text-[var(--ink-muted)]" />
          <span className="min-w-0 flex-1 truncate text-sm font-medium text-[var(--ink)]">{name}</span>
          {size > 0 && <span className="shrink-0 text-xs text-[var(--ink-subtle)]">{size} B</span>}
          {richDocKind && (
            <span className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--accent-warm)] bg-[var(--accent-warm-subtle)]">
              {RICH_DOC_LABEL[richDocKind] ?? richDocKind}
            </span>
          )}
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭"
            className="shrink-0 rounded-md p-1.5 text-[var(--ink-subtle)] hover:bg-[var(--paper-inset)] hover:text-[var(--ink)]"
          >
            <X size={15} />
          </button>
        </div>

        {/* Body */}
        <div className="min-h-0 flex-1 overflow-auto bg-[var(--paper)]">
          {error ? (
            <div className="flex h-40 flex-col items-center justify-center gap-2 px-6 text-center">
              <p className="text-sm text-[var(--error)]">{error}</p>
              {onOpenExternal && (
                <button
                  type="button"
                  onClick={onOpenExternal}
                  className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium text-[var(--on-accent)] bg-[var(--button-primary-bg)] hover:bg-[var(--button-primary-bg-hover)]"
                >
                  <ExternalLink size={13} />
                  用默认应用打开
                </button>
              )}
            </div>
          ) : richDocKind ? (
            // Rich documents have no bundled pure-frontend parser: show the
            // notice immediately (never a spinner — the caller cannot fetch
            // bytes for these in the DSH plugin).
            <div className="flex h-48 flex-col items-center justify-center gap-3 px-6 text-center">
              <FileText size={28} className="text-[var(--ink-subtle)]" />
              <p className="text-sm text-[var(--ink-muted)]">
                {RICH_DOC_LABEL[richDocKind] ?? '文档'}暂不支持在网页内预览
              </p>
              {onOpenExternal && (
                <button
                  type="button"
                  onClick={onOpenExternal}
                  className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium text-[var(--on-accent)] bg-[var(--button-primary-bg)] hover:bg-[var(--button-primary-bg-hover)]"
                >
                  <ExternalLink size={13} />
                  用默认应用打开
                </button>
              )}
            </div>
          ) : isLoading ? (
            <div className="flex h-40 items-center justify-center gap-2 text-sm text-[var(--ink-muted)]">
              <Loader2 size={16} className="animate-spin" />
              正在读取文件…
            </div>
          ) : (
            <pre className="whitespace-pre-wrap break-words px-4 py-3 font-mono text-[13px] leading-relaxed text-[var(--ink)]">
              {content}
            </pre>
          )}
        </div>
      </div>
    </OverlayBackdrop>
  );
}
