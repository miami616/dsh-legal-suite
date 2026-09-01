/**
 * memo.css.ts — 备忘录 UI 样式（扁平现代风，跟随 DSH 主题深/浅）。
 *
 * 修复点：
 *   - 弹窗/浮层背景一律用【不透明】实色（--paper-elevated / --dsw-alias-bg-layer-1
 *     若解析成透明则回退为字面量色），杜绝透明背景。
 *   - 增大弹窗尺寸与字号、行距，条目改「单列扁平列表 + 分隔线」，不再是一组组卡片。
 *   - 加 3D 按压/悬停/聚焦反馈，所有交互有可见状态。
 * 选择器全部限定在 [data-agentlex-memo-root]，避免污染其它插件。
 */
export const MEMO_CSS = `
[data-agentlex-memo-root] {
  --memo-accent: var(--alx-accent, var(--accent, #c26d3a));
  --memo-accent-strong: color-mix(in srgb, var(--memo-accent) 82%, #000 0%);
  --memo-accent-soft: color-mix(in srgb, var(--memo-accent) 13%, transparent);
  /* 背景用不透明实色：优先主题层色，回退字面量，杜绝透明 */
  --memo-bg: var(--dsw-alias-bg-layer-1, var(--paper-elevated, #ffffff));
  --memo-bg-solid: var(--paper-elevated, #ffffff);
  --memo-bg-inset: var(--paper-inset, #f5f4f1);
  --memo-bg-inset-solid: var(--paper-inset, #f5f4f1);
  --memo-fg: var(--dsw-alias-label-primary, var(--ink, #1c1c1e));
  --memo-fg-muted: var(--dsw-alias-label-secondary, var(--ink-muted, #6b6b74));
  --memo-fg-subtle: var(--dsw-alias-label-tertiary, var(--ink-subtle, #9b9ba4));
  --memo-border: var(--dsw-alias-border-l2, var(--line, #ececef));
  --memo-danger: #dc2626;
  --memo-radius: 16px;
  --memo-shadow: 0 22px 60px -20px rgb(0 0 0 / 0.32), 0 6px 24px -10px rgb(0 0 0 / 0.16);
  color-scheme: var(--dsw-color-scheme, light);
  font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", Roboto, "PingFang SC", "Microsoft YaHei", sans-serif;
  box-sizing: border-box;
}
[data-agentlex-memo-root] *, [data-agentlex-memo-root] *::before, [data-agentlex-memo-root] *::after { box-sizing: border-box; }

/* 深色下确保背景实色不透明 */
html[data-color-scheme="dark"] [data-agentlex-memo-root] {
  --memo-bg: #1d1d20;
  --memo-bg-solid: #1d1d20;
  --memo-bg-inset: #26262a;
  --memo-bg-inset-solid: #26262a;
  --memo-fg: #f0f0f2;
  --memo-fg-muted: #b6b6bf;
  --memo-fg-subtle: #7f7f8a;
  --memo-border: #34343a;
}

/* ---- 浮动入口按钮（默认低调透明，hover 才显色） ---- */
.memo-float[data-agentlex-memo-root] {
  display: flex; align-items: center; justify-content: center;
  width: 46px; height: 46px;
  border: 0; border-radius: 50%;
  cursor: pointer;
  position: fixed; z-index: 2147483005;
  color: var(--memo-fg-muted);           /* 图标默认灰 */
  background: transparent;               /* 默认透明 */
  box-shadow: none;
  transition: color 180ms ease, background 180ms ease, transform 160ms ease, box-shadow 180ms ease;
  touch-action: none;
}
.memo-float[data-agentlex-memo-root]:hover,
.memo-float[data-agentlex-memo-root]:focus-visible {
  color: #fff;                           /* hover 图标转白 */
  background: linear-gradient(135deg, var(--alx-accent, var(--accent, #c26d3a)), color-mix(in srgb, var(--alx-accent, var(--accent, #c26d3a)) 70%, #d97706));
  box-shadow: 0 16px 42px -14px rgb(0 0 0 / 0.35), 0 0 0 1px rgb(255 255 255 / 0.14) inset;
  transform: translateY(-1px);
}
.memo-float[data-agentlex-memo-root]:active { transform: scale(0.92); }
.memo-float[data-agentlex-memo-root]:focus-visible { outline: none; }

/* ---- 全屏遮罩 ---- */
.memo-overlay[data-agentlex-memo-root] {
  position: fixed; inset: 0; z-index: 2147483006;
  background: rgb(0 0 0 / 0.32);
  backdrop-filter: blur(2px);
  display: flex; align-items: center; justify-content: center;
  animation: memo-fade 180ms ease;
}
@keyframes memo-fade { from { opacity: 0 } to { opacity: 1 } }

/* ---- 弹窗主体 ---- */
.memo-panel[data-agentlex-memo-root] {
  width: min(680px, calc(100vw - 56px));
  max-height: min(720px, calc(100vh - 72px));
  display: flex; flex-direction: column;
  border-radius: var(--memo-radius);
  background: var(--memo-bg-solid);   /* 实色不透明 */
  color: var(--memo-fg);
  border: 1px solid var(--memo-border);
  box-shadow: var(--memo-shadow);
  overflow: hidden;
  animation: memo-pop 200ms cubic-bezier(0.22, 0.9, 0.32, 1.15);
}
@keyframes memo-pop {
  from { opacity: 0; transform: translateY(10px) scale(0.97); }
  to { opacity: 1; transform: none; }
}

/* ---- 头部 ---- */
.memo-panel__header {
  display: flex; align-items: center; gap: 12px;
  padding: 18px 22px 12px;
}
.memo-panel__title {
  display: flex; align-items: center; gap: 8px;
  font-size: 17px; font-weight: 700; color: var(--memo-fg);
  white-space: nowrap; letter-spacing: 0.01em;
}
.memo-panel__title svg { color: var(--memo-accent); }
.memo-panel__count {
  min-width: 22px; height: 22px; padding: 0 7px;
  border-radius: 11px; font-size: 12px; font-weight: 700; line-height: 22px;
  text-align: center; background: var(--memo-accent-soft); color: var(--memo-accent);
}
.memo-search {
  flex: 1; min-width: 0;
  height: 38px; padding: 0 14px;
  border: 1.5px solid var(--memo-border); border-radius: 10px;
  background: var(--memo-bg-inset-solid); color: var(--memo-fg);
  font-size: 14.5px; outline: none;
  transition: border-color 140ms ease, box-shadow 140ms ease, background 140ms ease;
}
.memo-search:hover { border-color: color-mix(in srgb, var(--memo-accent) 35%, var(--memo-border)); }
.memo-search:focus { border-color: var(--memo-accent); box-shadow: 0 0 0 3px var(--memo-accent-soft); background: var(--memo-bg-solid); }
.memo-search::placeholder { color: var(--memo-fg-subtle); }
.memo-icon-btn {
  flex: none; display: inline-flex; align-items: center; justify-content: center;
  width: 38px; height: 38px; border: 0; border-radius: 10px;
  background: transparent; color: var(--memo-fg-muted); cursor: pointer;
  transition: background 140ms ease, color 140ms ease, transform 100ms ease;
}
.memo-icon-btn:hover { background: var(--memo-bg-inset-solid); color: var(--memo-fg); }
.memo-icon-btn:active { transform: scale(0.9); }

/* ---- 新建/编辑框 ---- */
.memo-draft { padding: 4px 22px 12px; }
.memo-draft--edit { background: var(--memo-accent-soft); border-radius: 12px; margin: 0 22px 12px; padding: 14px; }
.memo-draft__input {
  width: 100%; resize: vertical; min-height: 76px; max-height: 200px;
  padding: 13px 15px;
  border: 1.5px solid var(--memo-border); border-radius: 12px;
  background: var(--memo-bg-inset-solid); color: var(--memo-fg);
  font-size: 15.5px; line-height: 1.6; outline: none;
  transition: border-color 140ms ease, box-shadow 140ms ease, background 140ms ease;
}
.memo-draft__input:focus { border-color: var(--memo-accent); box-shadow: 0 0 0 3px var(--memo-accent-soft); background: var(--memo-bg-solid); }
.memo-draft__input::placeholder { color: var(--memo-fg-subtle); }
.memo-draft__tags { display: flex; align-items: center; gap: 10px; margin-top: 10px; }
.memo-draft__tags-input {
  flex: 1; min-width: 0; height: 40px; padding: 0 14px;
  border: 1.5px solid var(--memo-border); border-radius: 10px;
  background: var(--memo-bg-inset-solid); color: var(--memo-fg);
  font-size: 14.5px; outline: none;
  transition: border-color 140ms ease, box-shadow 140ms ease, background 140ms ease;
}
.memo-draft__tags-input:focus { border-color: var(--memo-accent); box-shadow: 0 0 0 3px var(--memo-accent-soft); background: var(--memo-bg-solid); }
.memo-draft__tags-input::placeholder { color: var(--memo-fg-subtle); }
.memo-draft__hint { font-size: 12px; color: var(--memo-fg-subtle); margin-right: 2px; }
.memo-draft__actions { display: flex; gap: 8px; flex: none; }

.memo-btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 6px;
  height: 40px; padding: 0 18px;
  border-radius: 10px; border: 1px solid transparent;
  font-size: 14.5px; font-weight: 600; cursor: pointer;
  transition: filter 140ms ease, background 140ms ease, border-color 140ms ease, transform 100ms ease;
}
.memo-btn:active { transform: scale(0.96); }
.memo-btn--primary { background: var(--memo-accent); color: #fff; }
.memo-btn--primary:hover { filter: brightness(1.05); }
.memo-btn--primary:disabled { opacity: 0.5; cursor: not-allowed; transform: none; }
.memo-btn--primary.memo-btn--busy { position: relative; pointer-events: none; }
.memo-btn--primary.memo-btn--busy::after {
  content: ''; position: absolute; inset: 0; border-radius: inherit;
  background: color-mix(in srgb, #000 30%, transparent);
}
.memo-btn--muted { background: var(--memo-bg-inset-solid); color: var(--memo-fg-muted); border-color: var(--memo-border); }
.memo-btn--muted:hover { color: var(--memo-fg); }

/* ---- 标签筛选栏 ---- */
.memo-tags-bar {
  display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
  padding: 6px 22px 12px;
  border-bottom: 1px solid var(--memo-border);
}
.memo-tags-bar__label { font-size: 13px; color: var(--memo-fg-subtle); margin-right: 2px; }
.memo-tags-bar__empty { font-size: 13px; color: var(--memo-fg-subtle); }
.memo-tag {
  display: inline-flex; align-items: center; gap: 5px;
  height: 30px; padding: 0 12px;
  border-radius: 15px; border: 1px solid transparent;
  background: var(--memo-bg-inset-solid); color: var(--memo-fg-muted);
  font-size: 13.5px; cursor: pointer; white-space: nowrap;
  transition: all 140ms ease;
}
.memo-tag:hover { color: var(--memo-fg); border-color: var(--memo-border); }
.memo-tag__n { font-size: 11.5px; opacity: 0.65; }
.memo-tag--filter.memo-tag--on { background: var(--memo-accent); color: #fff; border-color: var(--memo-accent); }

/* ---- tab 切换 ---- */
.memo-tabs {
  display: flex; gap: 2px; padding: 12px 22px 0;
  border-bottom: 1px solid var(--memo-border);
  padding-bottom: 0;
}
.memo-tab {
  display: inline-flex; align-items: center; gap: 7px;
  height: 38px; padding: 0 16px; margin-bottom: -1px;
  border: 1px solid transparent; border-bottom: 0; border-radius: 10px 10px 0 0;
  background: transparent; color: var(--memo-fg-muted);
  font-size: 14.5px; font-weight: 600; cursor: pointer;
  transition: background 140ms ease, color 140ms ease;
}
.memo-tab:hover { color: var(--memo-fg); background: var(--memo-bg-inset-solid); }
.memo-tab--on { background: var(--memo-bg-solid); color: var(--memo-accent); border-color: var(--memo-border); position: relative; }
.memo-tab--on::after { content: ''; position: absolute; left: 0; right: 0; bottom: -1px; height: 2px; background: var(--memo-accent); }
.memo-tab__n {
  min-width: 20px; height: 20px; padding: 0 6px;
  border-radius: 10px; font-size: 12px; font-weight: 700; line-height: 20px;
  text-align: center; background: var(--memo-accent-soft); color: inherit;
}

/* ---- 列表（单列扁平 + 分隔线，非分组卡片） ---- */
.memo-list {
  flex: 1; overflow-y: auto; overscroll-behavior: contain;
  padding: 4px 0 8px;
  display: flex; flex-direction: column;
}
.memo-empty {
  padding: 48px 20px; text-align: center;
  color: var(--memo-fg-subtle); font-size: 14.5px;
}
.memo-item {
  display: flex; align-items: flex-start; gap: 12px;
  padding: 16px 22px;
  border-bottom: 1px solid color-mix(in srgb, var(--memo-border) 60%, transparent);
  background: transparent;
  transition: background 120ms ease;
}
.memo-item:hover { background: var(--memo-bg-inset-solid); }
.memo-item:last-child { border-bottom: 0; }
.memo-item__main { flex: 1; min-width: 0; }
.memo-item__content {
  font-size: 15.5px; line-height: 1.65; color: var(--memo-fg);
  white-space: pre-wrap; word-break: break-word; overflow-wrap: anywhere;
}
.memo-item--archived .memo-item__content { color: var(--memo-fg-muted); }
.memo-item__meta {
  display: flex; flex-wrap: wrap; align-items: center; gap: 7px; margin-top: 8px;
}
.memo-item__ref {
  font-size: 12.5px; font-weight: 600; color: var(--memo-accent);
  background: var(--memo-accent-soft); border-radius: 6px; padding: 2px 8px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}
.memo-item__tag {
  font-size: 12.5px; color: var(--memo-fg-muted); background: var(--memo-bg-inset-solid);
  border-radius: 6px; padding: 2px 8px; border: 1px solid var(--memo-border);
}
.memo-item__date { font-size: 12.5px; color: var(--memo-fg-subtle); margin-left: auto; }
.memo-item__actions { display: flex; align-items: center; gap: 2px; flex: none; }
.memo-act {
  display: inline-flex; align-items: center; justify-content: center;
  width: 34px; height: 34px; border: 0; border-radius: 9px;
  background: transparent; color: var(--memo-fg-muted); cursor: pointer;
  transition: background 120ms ease, color 120ms ease, transform 100ms ease;
}
.memo-act:hover { background: var(--memo-bg-inset-solid); color: var(--memo-fg); }
.memo-act:active { transform: scale(0.9); }
.memo-act--danger:hover { background: color-mix(in srgb, var(--memo-danger) 12%, transparent); color: var(--memo-danger); }

/* ---- 底部操作条 ---- */
.memo-footer {
  display: flex; align-items: center; gap: 8px;
  padding: 12px 22px;
  border-top: 1px solid var(--memo-border);
  font-size: 13px; color: var(--memo-fg-subtle);
}

/* ---- 提示 toast（自动消失） ---- */
.memo-toast {
  position: fixed; bottom: 28px; left: 50%; transform: translateX(-50%);
  z-index: 2147483012;
  display: inline-flex; align-items: center; gap: 8px;
  padding: 12px 20px; border-radius: 12px;
  font-size: 14.5px; font-weight: 600; color: #fff;
  background: var(--memo-fg, #222);
  box-shadow: 0 10px 30px -8px rgb(0 0 0 / 0.4);
  animation: memo-toast-in 220ms cubic-bezier(0.22, 0.9, 0.32, 1.2);
  max-width: min(420px, calc(100vw - 40px));
}
.memo-toast--ok { background: var(--memo-accent); }
.memo-toast--warn { background: var(--memo-danger); }
@keyframes memo-toast-in {
  from { opacity: 0; transform: translate(-50%, 16px) }
  to { opacity: 1; transform: translate(-50%, 0) }
}

/* ---- # 自动补全弹层（与 DSH 原生 / 命令菜单同款：不透明实底、原生阴影、12px 圆角） ---- */
.memo-suggest[data-agentlex-memo-root] {
  position: fixed; z-index: 2147483010;
  min-width: 300px; max-width: 380px; max-height: 320px; overflow-y: auto;
  padding: 4px;
  border-radius: 12px;
  /* 与 / 命令菜单一致：不透明实色 + 原生投影，不依赖可能透明的主题变量 */
  background: #ffffff;
  box-shadow: rgba(0, 0, 0, 0.2) 0 0 1px 0, rgba(0, 0, 0, 0.02) 0 0 4px 0, rgba(0, 0, 0, 0.08) 0 12px 32px 0;
  border: 1px solid rgba(0, 0, 0, 0.08);
  display: flex; flex-direction: column; gap: 1px;
}
html[data-color-scheme="dark"] .memo-suggest[data-agentlex-memo-root] {
  background: #1d1d20;
  border-color: rgba(255, 255, 255, 0.12);
  box-shadow: rgba(0, 0, 0, 0.5) 0 0 1px 0, rgba(0, 0, 0, 0.4) 0 12px 32px 0;
}
.memo-suggest__head {
  padding: 6px 10px 7px; font-size: 12px; font-weight: 700;
  color: #6b6b74; letter-spacing: 0.04em;
  border-bottom: 1px solid rgba(0, 0, 0, 0.08); margin-bottom: 2px;
  display: flex; align-items: center; justify-content: space-between;
}
html[data-color-scheme="dark"] .memo-suggest__head { color: #b6b6bf; border-bottom-color: rgba(255,255,255,0.1); }
.memo-suggest__head .memo-suggest__hint { font-weight: 400; font-size: 11px; color: #9b9ba4; }
.memo-suggest__item {
  display: flex; align-items: center; gap: 10px;
  padding: 9px 11px; border-radius: 8px;
  cursor: pointer; transition: background 110ms ease;
  border: 0; background: transparent; color: #1c1c1e; text-align: left; width: 100%;
  font: inherit;
}
html[data-color-scheme="dark"] .memo-suggest__item { color: #f0f0f2; }
.memo-suggest__item:hover, .memo-suggest__item--sel {
  background: rgba(194, 109, 58, 0.13); /* 强调色 13% 的浅底，与原生 hover 一致 */
}
html[data-color-scheme="dark"] .memo-suggest__item:hover,
html[data-color-scheme="dark"] .memo-suggest__item--sel { background: rgba(255,255,255,0.09); }
.memo-suggest__ref {
  flex: none; font-size: 13px; font-weight: 800; color: #c26d3a;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  min-width: 44px; text-align: center;
  background: rgba(194, 109, 58, 0.12); border-radius: 6px; padding: 3px 8px;
  letter-spacing: 0.02em;
}
html[data-color-scheme="dark"] .memo-suggest__ref { color: #e8a06a; background: rgba(232,160,106,0.16); }
.memo-suggest__txt {
  flex: 1; min-width: 0; font-size: 14px;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  color: #4a4a52; line-height: 1.4;
}
html[data-color-scheme="dark"] .memo-suggest__txt { color: #d6d6dc; }
.memo-suggest__tag {
  flex: none; font-size: 12px; color: var(--memo-fg-muted);
  background: var(--memo-bg-inset-solid); border-radius: 5px;
  padding: 1px 7px; border: 1px solid var(--memo-border);
}
.memo-suggest__new {
  border-top: 1px solid var(--memo-border); margin-top: 6px; padding-top: 6px;
  color: var(--memo-accent); font-weight: 600;
  display: flex; align-items: center; gap: 8px;
}

/* ---- 移动端适配（窄屏）----
 * 移动端（如手机 / 窄屏 Web App wrapper）主题变量可能解析出过浅的灰阶文字，
 * 导致输入框与条目内容几乎看不清。这里在窄屏下强制提高对比度、放宽面板到
 * 几乎全宽、收紧留白，保证窄屏可读且不溢出。
 */
@media (max-width: 640px) {
  /* 文字对比度：主文字→深近黑/近白，次级→足够深/浅，不再用很浅的 tertiary */
  [data-agentlex-memo-root] {
    --memo-fg: #1a1a1c;                /* 主文字：深近黑，保证可读 */
    --memo-fg-muted: #4a4a52;          /* 次级：足够深 */
    --memo-fg-subtle: #5f5f6a;         /* 弱化：仍清晰，不再过浅 */
    --memo-bg: var(--paper-elevated, #ffffff);
    --memo-bg-inset: var(--paper-inset, #f5f4f1);
    color-scheme: light;
  }
  html[data-color-scheme="dark"] [data-agentlex-memo-root] {
    --memo-fg: #f2f2f4;                /* 深色下主文字近白 */
    --memo-fg-muted: #d6d6dc;          /* 次级不再过灰 */
    --memo-fg-subtle: #c2c2ca;
  }
  /* 面板几乎占满可用宽度，保证窄屏不溢出 */
  .memo-panel[data-agentlex-memo-root] {
    width: calc(100vw - 24px);
    max-width: calc(100vw - 24px);
    max-height: calc(100dvh - 32px);
    border-radius: 14px;
  }
  /* 头部/列表等减少大段留白，放大字号便于移动阅读 */
  .memo-panel__header { padding: 14px 16px 10px; gap: 8px; }
  .memo-draft { padding: 4px 16px 10px; }
  .memo-draft--edit { margin: 0 16px 10px; padding: 12px; }
  .memo-tags-bar { padding: 4px 16px 10px; }
  .memo-tabs { padding: 10px 16px 0; }
  .memo-item { padding: 13px 16px; gap: 8px; }
  .memo-item__content { font-size: 16px; }
  .memo-draft__input { font-size: 16px; min-height: 64px; }
  .memo-draft__tags-input { font-size: 15px; height: 44px; }
  .memo-footer { padding: 10px 16px; }
  .memo-act { width: 38px; height: 38px; }
}
`

/* 预留空导出满足 ESM 类型 */
export const FLOAT_CSS = MEMO_CSS
