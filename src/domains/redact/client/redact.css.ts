/**
 * redact.css.ts — 文书脱敏工具视图样式。
 *
 * 版式与相邻小工具（测算器）保持一致：同套 AgentLex warm-paper token（--lit-*）、
 * 卡片 + 双栏（左输入 / 右结果粘性跟随）、卡片头小字母、900/1180 两级响应式。
 * 形态是**嵌在「技能与工具 → 小工具」里**，所以只负责视图内部排版。
 */
export const REDACT_CSS = `
/* ---- 容器 ---- */
.redact-root {
  --rd-accent: var(--lit-accent, #c26d3a);
  --rd-accent-strong: var(--lit-accent-strong, #b05e2d);
  --rd-accent-subtle: var(--lit-accent-subtle, rgba(194, 109, 58, 0.08));
  --rd-accent-muted: var(--lit-accent-muted, rgba(194, 109, 58, 0.15));
  --rd-paper: var(--lit-paper, #f9f5ee);
  --rd-paper-elevated: var(--lit-paper-elevated, #fffcf7);
  --rd-paper-inset: var(--lit-paper-inset, #ece2d4);
  --rd-ink: var(--lit-ink, #1c1612);
  --rd-ink-muted: var(--lit-ink-muted, #6f6156);
  --rd-ink-subtle: var(--lit-ink-subtle, #a69a90);
  --rd-line: var(--lit-line, rgb(28 22 18 / 0.28));
  --rd-line-strong: var(--lit-line-strong, rgb(28 22 18 / 0.44));
  --rd-line-subtle: var(--lit-line-subtle, rgb(28 22 18 / 0.16));
  --rd-radius-md: var(--lit-radius-md, 10px);
  --rd-radius-lg: var(--lit-radius-lg, 14px);
  --rd-shadow-card: var(--lit-shadow-card, 0 1px 2px rgb(28 22 18 / 0.04));
  --rd-error: var(--lit-error, #dc2626);
  --rd-error-bg: var(--lit-error-bg, #fee2e2);
  --rd-success: var(--lit-success, #2d8a5e);
  --rd-font: var(--lit-font, -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif);
  --rd-font-mono: var(--lit-font-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
  display: flex;
  flex-direction: column;
  min-width: 0;
  font-family: var(--rd-font);
  color: var(--rd-ink);
}
.redact-root *, .redact-root *::before, .redact-root *::after { box-sizing: border-box; }

/* ---- 顶部 tab 行 ---- */
.redact-head {
  display: flex; align-items: center; gap: 12px; flex-wrap: wrap;
  padding: 12px 32px 0;
}
.redact-tabs {
  display: inline-flex; align-items: center; gap: 2px;
  padding: 3px; border-radius: 999px;
  background: var(--rd-paper-inset);
  border: 1px solid var(--rd-line-subtle);
}
.redact-tab {
  display: inline-flex; align-items: center; gap: 6px;
  height: 30px; padding: 0 16px; border: 0; border-radius: 999px;
  background: transparent; color: var(--rd-ink-muted);
  font-family: inherit; font-size: 13px; font-weight: 600; cursor: pointer;
  transition: background 0.14s ease, color 0.14s ease;
}
.redact-tab:hover { color: var(--rd-ink); }
.redact-tab--on { background: var(--rd-paper-elevated); color: var(--rd-accent-strong); box-shadow: var(--rd-shadow-card); }
.redact-head__note { font-size: 12px; color: var(--rd-ink-subtle); }

/* ---- 双栏栅格（与 .calcLayout 同规格） ---- */
.redact-grid {
  display: grid;
  grid-template-columns: minmax(330px, 440px) minmax(0, 1fr);
  gap: 20px; align-items: start;
  padding: 14px 32px 32px;
}
.redact-grid--one { grid-template-columns: minmax(0, 1fr); max-width: 760px; }
.redact-col { display: flex; flex-direction: column; gap: 16px; min-width: 0; }

/* ---- 卡片 ---- */
.redact-card {
  display: flex; flex-direction: column; gap: 12px;
  padding: 16px;
  border-radius: var(--rd-radius-lg);
  background: color-mix(in srgb, var(--rd-paper) 90%, var(--rd-paper-inset) 10%);
  border: 1px solid var(--rd-line-strong);
  box-shadow: var(--rd-shadow-card);
}
body[data-ds-dark-theme] .redact-card { background: var(--rd-paper-elevated); }
.redact-card--sticky { position: sticky; top: 10px; }
.redact-cardHead {
  display: flex; align-items: center; gap: 8px;
  font-size: 11px; font-weight: 700; letter-spacing: 0.08em;
  text-transform: uppercase; color: var(--rd-ink-subtle);
}
.redact-badge {
  display: inline-flex; align-items: center; height: 19px; padding: 0 8px;
  border-radius: 999px; font-size: 11px; font-weight: 700; letter-spacing: 0;
  text-transform: none; background: var(--rd-accent-subtle); color: var(--rd-accent-strong);
}
.redact-badge--muted { background: var(--rd-paper-inset); color: var(--rd-ink-subtle); }

/* ---- 字段与控件 ---- */
.redact-field { display: flex; flex-direction: column; gap: 5px; min-width: 0; }
.redact-label { font-size: 12px; color: var(--rd-ink-muted); }
.redact-input, .redact-select {
  width: 100%; height: 38px; padding: 0 12px;
  border-radius: var(--rd-radius-md);
  border: 1px solid var(--rd-line-strong);
  background: var(--rd-paper-elevated); color: var(--rd-ink);
  font-family: inherit; font-size: 13.5px; outline: none;
  transition: border-color 0.14s ease, box-shadow 0.14s ease;
}
.redact-input::placeholder, .redact-textarea::placeholder { color: var(--rd-ink-subtle); }
.redact-input:focus, .redact-select:focus, .redact-textarea:focus {
  border-color: var(--rd-accent); box-shadow: 0 0 0 3px var(--rd-accent-subtle);
}
.redact-textarea {
  width: 100%; min-height: 168px; padding: 12px 14px; resize: vertical;
  border-radius: var(--rd-radius-md);
  border: 1px solid var(--rd-line-strong);
  background: var(--rd-paper-elevated); color: var(--rd-ink);
  font-family: var(--rd-font-mono); font-size: 13px; line-height: 1.7; outline: none;
  transition: border-color 0.14s ease, box-shadow 0.14s ease;
}
.redact-textarea--out {
  min-height: 210px;
  background: color-mix(in srgb, var(--rd-success) 6%, var(--rd-paper-elevated));
}
.redact-actions { display: flex; flex-wrap: wrap; gap: 8px; }
.redact-btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 6px;
  min-height: 34px; padding: 0 15px; border-radius: var(--rd-radius-md);
  border: 1px solid var(--rd-line-strong); cursor: pointer;
  background: var(--rd-paper-elevated); color: var(--rd-ink-muted);
  font-family: inherit; font-size: 13px; font-weight: 600;
  transition: background 0.14s ease, color 0.14s ease, border-color 0.14s ease, opacity 0.14s ease;
}
.redact-btn:hover:not(:disabled) { color: var(--rd-ink); border-color: var(--rd-accent); }
.redact-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.redact-btn--primary { background: var(--rd-accent); border-color: var(--rd-accent); color: #fff; }
.redact-btn--primary:hover:not(:disabled) { background: var(--rd-accent-strong); border-color: var(--rd-accent-strong); color: #fff; }
.redact-check { display: inline-flex; align-items: center; gap: 7px; font-size: 13px; color: var(--rd-ink-muted); cursor: pointer; }
.redact-check input { width: 15px; height: 15px; accent-color: var(--rd-accent); cursor: pointer; }
.redact-check code { font-family: var(--rd-font-mono); font-size: 12px; color: var(--rd-ink); }

/* ---- 命中统计 / 候选 / 提示 ---- */
.redact-chips { display: flex; flex-wrap: wrap; gap: 6px; }
.redact-chip {
  display: inline-flex; align-items: center; gap: 6px;
  height: 26px; padding: 0 11px; border-radius: 999px;
  background: var(--rd-paper-inset); color: var(--rd-ink-muted);
  font-size: 12px; border: 1px solid var(--rd-line-subtle);
}
.redact-chip--hit { color: var(--rd-ink); background: var(--rd-accent-subtle); border-color: transparent; }
.redact-chip--hit b { color: var(--rd-accent-strong); font-weight: 700; }
.redact-chip--cand { border-style: dashed; }
.redact-chip__add {
  border: 0; background: transparent; padding: 0; cursor: pointer;
  font-family: inherit; font-size: 12px; font-weight: 700; color: var(--rd-accent-strong);
}
.redact-chip__add:disabled { color: var(--rd-ink-subtle); cursor: default; }
.redact-note { margin: 0; font-size: 12px; line-height: 1.6; color: var(--rd-ink-subtle); }
.redact-warn {
  padding: 9px 12px; border-radius: var(--rd-radius-md);
  background: var(--rd-error-bg); color: var(--rd-error);
  font-size: 12.5px; line-height: 1.6;
}
.redact-sub { display: flex; flex-direction: column; gap: 8px; }

/* ---- 列表 ---- */
.redact-list {
  display: flex; flex-direction: column;
  border: 1px solid var(--rd-line-subtle); border-radius: var(--rd-radius-md);
  overflow: hidden; background: var(--rd-paper-elevated);
}
.redact-item {
  display: flex; align-items: center; gap: 10px;
  padding: 10px 13px;
  border-bottom: 1px solid var(--rd-line-subtle);
}
.redact-item:last-child { border-bottom: 0; }
.redact-item__main { flex: 1; min-width: 0; }
.redact-item__value { font-size: 13.5px; color: var(--rd-ink); word-break: break-all; }
.redact-item__meta { margin-top: 2px; font-size: 11.5px; color: var(--rd-ink-subtle); }
.redact-item__alias {
  flex: none; font-family: var(--rd-font-mono); font-size: 13px;
  font-weight: 700; color: var(--rd-accent-strong);
}
.redact-del {
  flex: none; border: 0; background: transparent; cursor: pointer;
  padding: 3px 7px; border-radius: var(--rd-radius-sm, 6px);
  font-family: inherit; font-size: 12px; color: var(--rd-ink-subtle);
}
.redact-del:hover { color: var(--rd-error); background: var(--rd-error-bg); }
.redact-empty { padding: 22px 12px; text-align: center; font-size: 13px; color: var(--rd-ink-subtle); }

/* ---- toast（固定居中，短暂提示） ---- */
.redact-toast {
  position: fixed; bottom: 28px; left: 50%; transform: translateX(-50%);
  z-index: 2147483012; padding: 11px 18px; border-radius: 999px;
  font-size: 13.5px; font-weight: 600; color: #fff; background: var(--rd-ink, #1c1612);
  box-shadow: 0 10px 30px -8px rgb(0 0 0 / 0.4);
  max-width: min(460px, calc(100vw - 40px));
  animation: redact-toast-in 0.22s cubic-bezier(0.22, 0.9, 0.32, 1.2);
}
.redact-toast--ok { background: var(--rd-accent-strong, #b05e2d); }
.redact-toast--warn { background: var(--rd-error, #dc2626); }
@keyframes redact-toast-in { from { opacity: 0; transform: translate(-50%, 16px) } to { opacity: 1; transform: translate(-50%, 0) } }

/* ---- 响应式（与计算器同断点） ---- */
@media (max-width: 1180px) {
  .redact-grid { grid-template-columns: 1fr; gap: 16px; }
  .redact-card--sticky { position: static; }
}
@media (max-width: 900px) {
  .redact-head { padding: 10px 16px 0; }
  .redact-grid { padding: 12px 16px 28px; }
  .redact-grid--one { max-width: none; }
  .redact-textarea { min-height: 140px; }
}
@media (prefers-reduced-motion: reduce) {
  .redact-toast { animation: none; }
}
`
