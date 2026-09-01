/**
 * 会话排版（client 注入样式）。
 *
 * 两组规则，分别由设置项控制：
 *   1. 两端对齐（conversationJustify）—— AI 输出 markdown 正文与用户消息
 *      气泡 text-align: justify，段落左右边距整齐。为避免中英文混排时
 *      justify 把字间空隙撑得过大，叠加 `text-justify: inter-ideograph`
 *      （支持它的浏览器按词边界分配空隙）+ `overflow-wrap: break-word`
 *      （长英文单词/数字可断行，空隙不集中堆积）。
 *   2. 排版增强（conversationEnhance）—— 行距/段距恢复 DSH 原版节奏
 *      （16px 字号 / 28px 行高 / 16px 段距），代码/引用背景块在浅色主题下
 *      清晰可见、表格表头带主题色。
 *
 * 选择器锚定 DSH 稳定 DOM 规律（与官方 / 第三方插件的 CSS Modules 哈希无关）：
 *   - `[data-slot="conversation"]` —— 会话区 slot 出口（哈希无关的稳定锚点）
 *   - `[class$="_body"]`   —— AssistantMarkdown 的 markdown 正文容器（后缀稳定）
 *   - `[class$="_bubble"]` —— 用户消息气泡容器（纯文本 + @提及 span）；第三方
 *     dsh-recall-plugin 会用 dsh-recall-bubble 类替代渲染，选择器需同时覆盖。
 *
 * 两端对齐只作用于正文段落/列表/引用与用户气泡；代码块（pre/code）、表格、
 * 标题保持左对齐，避免被 justify 拉伸破坏排版。`text-align-last: start`
 * 确保段落最后一行不强行撑满（更符合中文阅读习惯）。
 *
 * 原版节奏说明：第三方插件（如 dsh-ui-harmonizer）会把 `--dsw-font-markdown-*`
 * 整体压到 14px 小字档（正文 14px/25px），观感松散；增强开关开启时在会话槽位
 * 重定义整组 token 为 16px 档（正文 16px/28px = 1.75，与 DSH 原生一致），
 * 段距用固定 16px（em 会随字号缩水导致段距小于原版）。
 */

/** 两端对齐规则。 */
export const CONVERSATION_TYPOGRAPHY_CSS = `
/* —— 会话排版：AI 输出 markdown 正文两端对齐（负字距抵消 justify 撑开的
 * 字间空隙，避免中文被拉得松散） —— */
[data-slot="conversation"] [class$="_body"] p,
[data-slot="conversation"] [class$="_body"] li,
[data-slot="conversation"] [class$="_body"] blockquote,
[data-slot="conversation"] [class$="_body"] dd {
  text-align: justify;
  text-align-last: start;
  text-justify: inter-ideograph;
  letter-spacing: -0.03em;
  overflow-wrap: break-word;
}
/* —— 会话排版：用户消息气泡两端对齐 ——
 * 官方气泡类名以 _bubble 结尾；第三方 dsh-recall-plugin 会把用户消息
 * 渲染成 dsh-recall-bubble 类（同样消费 --dsw-specific-bubble token），
 * 一并覆盖，否则用户消息保持左对齐。 */
[data-slot="conversation"] [class$="_bubble"],
[data-slot="conversation"] [class*="dsh-recall-bubble"] {
  text-align: justify;
  text-align-last: start;
  text-justify: inter-ideograph;
  letter-spacing: -0.03em;
  overflow-wrap: break-word;
}
/* —— 排队/等待消息面板排除：输入框上方「排队中」的待处理消息（PendingSteering /
 * PendingSubmission）用 data-pending-steering / data-submission-echo 标记，其
 * 内容容器同样命中 [class$="_body"] / [class$="_bubble"]，会被上面的两端对齐/
 * 负字距规则拉宽。这里还原为左对齐 + 正常字距，避免排队消息被拉成"拉宽版"。 —— */
[data-slot="conversation"] [data-pending-steering] [class$="_body"] p,
[data-slot="conversation"] [data-pending-steering] [class$="_body"] li,
[data-slot="conversation"] [data-pending-steering] [class$="_body"] blockquote,
[data-slot="conversation"] [data-pending-steering] [class$="_body"] dd,
[data-slot="conversation"] [data-submission-echo] [class$="_body"] p,
[data-slot="conversation"] [data-submission-echo] [class$="_body"] li,
[data-slot="conversation"] [data-submission-echo] [class$="_body"] blockquote,
[data-slot="conversation"] [data-submission-echo] [class$="_body"] dd,
[data-slot="conversation"] [data-pending-steering] [class$="_bubble"],
[data-slot="conversation"] [data-submission-echo] [class$="_bubble"] {
  text-align: left;
  text-align-last: start;
  text-justify: auto;
  letter-spacing: normal;
  overflow-wrap: break-word;
}
/* —— 代码、表格、标题保持左对齐（不被两端拉伸） —— */
[data-slot="conversation"] [class$="_body"] h1,
[data-slot="conversation"] [class$="_body"] h2,
[data-slot="conversation"] [class$="_body"] h3,
[data-slot="conversation"] [class$="_body"] h4,
[data-slot="conversation"] [class$="_body"] h5,
[data-slot="conversation"] [class$="_body"] h6,
[data-slot="conversation"] [class$="_body"] pre,
[data-slot="conversation"] [class$="_body"] code,
[data-slot="conversation"] [class$="_body"] table,
[data-slot="conversation"] [class$="_body"] th {
  text-align: left;
}
/* —— 含代码块/表格的段落、列表项、引用、定义项整体回退左对齐 ——
 * 仅把 pre/table 本身设 left 不够：当代码块或表格嵌在 p/li/blockquote/dd
 * 内部时，外层容器的 justify 仍会把容器内其余文字（以及代码块首尾的
 * 说明文字）拉散。用 :has() 命中「包含块级代码/表格」的容器，让整个
 * 容器回到左对齐，避免两端对齐把文字撑出大空隙。 */
[data-slot="conversation"] [class$="_body"] p:has(pre),
[data-slot="conversation"] [class$="_body"] p:has(table),
[data-slot="conversation"] [class$="_body"] li:has(pre),
[data-slot="conversation"] [class$="_body"] li:has(table),
[data-slot="conversation"] [class$="_body"] blockquote:has(pre),
[data-slot="conversation"] [class$="_body"] blockquote:has(table),
[data-slot="conversation"] [class$="_body"] dd:has(pre),
[data-slot="conversation"] [class$="_body"] dd:has(table) {
  text-align: left;
  text-align-last: start;
}

/* —— composer 排除：上面这些规则以 [class$="_body"] 锚定，会同时命中包裹
 * composer 的会话根 .wSkVaW_body（含英雄页）。composer 编辑区是唯一的
 * [data-lexical-editor]（Lexical 富文本），消息正文不含它。CSS 无法用
 * :not(X *) 做「祖先排除」（_body :not(X *) p 仍会命中 p），故用同特异性
 * 的 [data-lexical-editor] 覆盖规则把它们还原，且必须置于消息规则之后以
 * 保证顺序覆盖 —— 避免两端对齐/负字距/换行/段距套到输入框内部 <p> 上。 —— */
[data-slot="conversation"] [data-lexical-editor] p,
[data-slot="conversation"] [data-lexical-editor] li,
[data-slot="conversation"] [data-lexical-editor] blockquote,
[data-slot="conversation"] [data-lexical-editor] dd {
  text-align: inherit;
  text-align-last: inherit;
  text-justify: auto;
  letter-spacing: normal;
  overflow-wrap: anywhere;
  margin: 0;
}
[data-slot="conversation"] [data-lexical-editor] p + p,
[data-slot="conversation"] [data-lexical-editor] li + li {
  margin-top: 0;
}
/* —— 排队消息面板（QueueDock）排除：输入框上方的「排队中」横条会被
 * [class$="_body"] 锚定的两端对齐（justify + 负字距）与增强规则命中，
 * 导致排队消息文字被拉宽/错乱。这里用 !important 强制还原为左对齐 +
 * 正常字距 + dock 自身排版，并随 composer 卡片宽度居中。 —— */
[data-queue-dock],
[data-queue-dock] p,
[data-queue-dock] li,
[data-queue-dock] blockquote,
[data-queue-dock] dd,
[data-queue-dock] span {
  text-align: left !important;
  text-align-last: start !important;
  text-justify: auto !important;
  letter-spacing: normal !important;
  overflow-wrap: break-word !important;
}
[data-queue-dock] {
  max-width: var(--dsh-composer-card-max-width, 720px);
  margin-left: auto;
  margin-right: auto;
}
`.trim()

/** 排版增强规则：原版行距段距 + 可见背景块 + 彩色表头。 */
export const CONVERSATION_ENHANCE_CSS = `
/* —— 恢复原版排版节奏：字号/行高钉回 16px 档（正文 16px/28px = 原生 1.75）——
 * 【不指定字体族】：官方 markdown 用 font 简写消费 --dsw-font-markdown-*，
 * 第三方字体插件（harmonizer 等）正是改这组 token 换字体；本插件若重定义
 * token 会连 family 一起绑定、令用户字体设置失效。因此这里只用非简写
 * 属性覆盖 size/line-height（优先级高于 .markdown 的 font 简写），
 * 字体族完全跟随 DSH 原生 / 用户字体插件的页面级设置。
 * 关闭增强开关后回到第三方/官方排版，互不污染。 */
[data-slot="conversation"] [class$="_body"] {
  font-size: 16px;
  line-height: 28px;
}
[data-slot="conversation"] [class$="_body"] h1 {
  font-size: 24px;
  line-height: 34px;
}
[data-slot="conversation"] [class$="_body"] h2 {
  font-size: 22px;
  line-height: 32px;
}
[data-slot="conversation"] [class$="_body"] h3 {
  font-size: 20px;
  line-height: 30px;
}
[data-slot="conversation"] [class$="_body"] h4 {
  font-size: 16px;
  line-height: 28px;
}
/* —— 用户气泡恢复原版 16px/24px（同样不指定字体族；body 前缀提升特异性；
 * 含 dsh-recall-plugin 的 dsh-recall-bubble 类） —— */
body [data-slot="conversation.session"] [class$="_bubble"],
body [data-slot="conversation.session"] [class*="dsh-recall-bubble"] {
  font-size: 16px;
  line-height: 24px;
}

/* —— 正文文字加深：官方 markdown 正文偏浅，统一到各主题主文字色 ——
 * （--lit-ink 由皮肤按主题注入：warm 深棕 / jade 墨绿 / ink 藏蓝…；
 * 链接用原生灰色（label-secondary），与文件链接 chip 一致，不抢主题色。） */
[data-slot="conversation"] [class$="_body"] {
  color: var(--lit-ink, var(--dsw-alias-label-primary, #221b15));
}
[data-slot="conversation"] [class$="_body"] a {
  color: var(--dsw-alias-label-secondary, #5c6370);
}

/* —— 段距：大段之间 p 24px、段内连续子段 p+p 28px（更透气，避免拥挤）；
 * li+li 10px、ul/ol 20px（固定 px，不随字号缩水） —— */
[data-slot="conversation"] [class$="_body"] p {
  margin: 24px 0;
}
[data-slot="conversation"] [class$="_body"] p + p {
  margin-top: 28px;
}
[data-slot="conversation"] [class$="_body"] li {
  margin: 0;
}
[data-slot="conversation"] [class$="_body"] li + li {
  margin-top: 10px;
}
[data-slot="conversation"] [class$="_body"] ul,
[data-slot="conversation"] [class$="_body"] ol {
  margin: 20px 0;
  padding-left: 1.5em;
}

/* —— 背景块（代码/引用）浅色主题下清晰可见 —— */
html:not([data-ds-dark-theme]) [data-slot="conversation"] [class$="_body"] pre,
html:not([data-ds-dark-theme]) [data-slot="conversation"] [class$="_body"] blockquote {
  background: rgba(0, 0, 0, 0.016);
}
html[data-ds-dark-theme] [data-slot="conversation"] [class$="_body"] pre,
html[data-ds-dark-theme] [data-slot="conversation"] [class$="_body"] blockquote {
  background: rgba(255, 255, 255, 0.07);
}
[data-slot="conversation"] [class$="_body"] pre {
  border-radius: 8px;
  padding: 10px 12px;
}

/* —— 引用块：彩色左边框（活泼） —— */
[data-slot="conversation"] [class$="_body"] blockquote {
  border-left: 3px solid var(--lit-accent-strong, #b05e2d);
  padding-left: 12px;
}

/* —— 分隔线加深 —— */
[data-slot="conversation"] [class$="_body"] hr {
  border-top-color: rgba(0, 0, 0, 0.22);
}
html[data-ds-dark-theme] [data-slot="conversation"] [class$="_body"] hr {
  border-top-color: rgba(255, 255, 255, 0.28);
}

/* —— markdown 标题带主题色（与表头/标题栏呼应，活泼） —— */
[data-slot="conversation"] [class$="_body"] h1,
[data-slot="conversation"] [class$="_body"] h2,
[data-slot="conversation"] [class$="_body"] h3,
[data-slot="conversation"] [class$="_body"] h4,
[data-slot="conversation"] [class$="_body"] h5,
[data-slot="conversation"] [class$="_body"] h6 {
  color: var(--lit-accent-strong, #b05e2d);
}
html[data-ds-dark-theme] [data-slot="conversation"] [class$="_body"] h1,
html[data-ds-dark-theme] [data-slot="conversation"] [class$="_body"] h2,
html[data-ds-dark-theme] [data-slot="conversation"] [class$="_body"] h3,
html[data-ds-dark-theme] [data-slot="conversation"] [class$="_body"] h4,
html[data-ds-dark-theme] [data-slot="conversation"] [class$="_body"] h5,
html[data-ds-dark-theme] [data-slot="conversation"] [class$="_body"] h6 {
  color: var(--lit-accent, #d4803f);
}

/* —— 行内代码：原版中性灰底（markdown-inline-code + 正文色文字），不再用主题色浅底。
 * 选择器 :not(pre) > code 只命中行内代码，不碰 pre>code 块。
 * 关键修复：DSH 核心把 code 设成 display:inline-flex，行内代码会被当成「不可拆分的
 * 原子盒」——超出行宽时整块跳到下一行（而非在行内断词），上一行变短后被 justify
 * 把字间空隙撑散，很难看。这里用 display:inline 覆盖，让行内代码像普通文字参与换行；
 * overflow-wrap:break-word 作为兜底（无分隔符的超长串仅在溢出时断行），「自然边界断行」
 * 由 conversation-inline-code.ts 在 / . _ - 后注入的 <wbr> 负责，避免把目录名从中间劈开；
 * box-decoration-break:clone 保证跨多行时每段都带圆角+背景，而非只有外框圆角。 —— */
[data-slot="conversation"] [class$="_body"] :not(pre) > code {
  display: inline;
  background: var(--dsw-alias-markdown-inline-code, rgba(0, 0, 0, 0.06));
  color: var(--dsw-alias-label-primary, inherit);
  border-radius: 6px;
  padding: 1px 6px;
  font-size: 0.88em;
  white-space: normal;
  overflow-wrap: break-word;
  word-break: break-word;
  box-decoration-break: clone;
  -webkit-box-decoration-break: clone;
}
html[data-ds-dark-theme] [data-slot="conversation"] [class$="_body"] :not(pre) > code {
  background: var(--dsw-alias-markdown-inline-code, rgba(255, 255, 255, 0.08));
  color: var(--dsw-alias-label-primary, inherit);
}

/* —— 表格：外框/单元格边框加深，表头主题色（86%，活泼但不浓） —— */
[data-slot="conversation"] [class$="_body"] table {
  border-collapse: collapse;
  border-radius: 8px;
  overflow: hidden;
  border: 1px solid rgba(0, 0, 0, 0.16);
}
html[data-ds-dark-theme] [data-slot="conversation"] [class$="_body"] table {
  border-color: rgba(255, 255, 255, 0.24);
}
[data-slot="conversation"] [class$="_body"] table th {
  background: var(--lit-accent-strong, #b05e2d);
  background: color-mix(in srgb, var(--lit-accent-strong, #b05e2d) 86%, transparent);
  color: var(--lit-on-accent, #fff);
  font-weight: 600;
  text-align: left;
  padding: 7px 12px;
  border-bottom: 2px solid color-mix(in srgb, var(--lit-accent-strong, #b05e2d) 65%, transparent);
}
html[data-ds-dark-theme] [data-slot="conversation"] [class$="_body"] table th {
  background: var(--lit-accent-strong, #b05e2d);
  background: color-mix(in srgb, var(--lit-accent-strong, #b05e2d) 86%, transparent);
}

/* —— 代码块：容器边框加深；标题栏（语言标签 + 复制按钮）与表头同色（86%） ——
 * primitives 的 CSS Modules 类名中间含 _banner_（本地名在中间），
 * 故用子串匹配 [class*="_banner_"]（不会误中 _bannerWrap_）。 */
[data-slot="conversation"] [class$="_body"] .md-code-block {
  border: 1px solid rgba(0, 0, 0, 0.16);
  border-radius: 8px;
}
html[data-ds-dark-theme] [data-slot="conversation"] [class$="_body"] .md-code-block {
  border-color: rgba(255, 255, 255, 0.24);
}
[data-slot="conversation"] [class$="_body"] .md-code-block [class*="_banner_"] {
  background: var(--lit-accent-strong, #b05e2d);
  background: color-mix(in srgb, var(--lit-accent-strong, #b05e2d) 86%, transparent);
  border-radius: 8px 8px 0 0;
}
[data-slot="conversation"] [class$="_body"] .md-code-block [class*="_banner_"],
[data-slot="conversation"] [class$="_body"] .md-code-block [class*="_banner_"] * {
  color: var(--lit-on-accent, #fff);
}
html[data-ds-dark-theme] [data-slot="conversation"] [class$="_body"] .md-code-block [class*="_banner_"] {
  background: var(--lit-accent-strong, #b05e2d);
  background: color-mix(in srgb, var(--lit-accent-strong, #b05e2d) 86%, transparent);
}
[data-slot="conversation"] [class$="_body"] table td {
  padding: 6px 12px;
  border: 1px solid rgba(0, 0, 0, 0.16);
}
html[data-ds-dark-theme] [data-slot="conversation"] [class$="_body"] table td {
  border-color: rgba(255, 255, 255, 0.24);
}
[data-slot="conversation"] [class$="_body"] table tr:nth-child(2n) td {
  background: rgba(0, 0, 0, 0.025);
}
html[data-ds-dark-theme] [data-slot="conversation"] [class$="_body"] table tr:nth-child(2n) td {
  background: rgba(255, 255, 255, 0.03);
}

/* ---- 移动端输入框：光标对齐修复 ----
 * 根因：官方 composer 的 textarea 文字是透明的（color:#0000），实际显示
 * 靠 backdrop 镜像层，但 backdrop 有 padding（4px 12px 0 16px）而 textarea
 * 无 padding（inset:0）—— 文字起点相差 16px，光标（在 textarea 内）与
 * 显示文字水平错位，看起来「前面有很多空格」。
 * 修复：移动端让 textarea 与 backdrop 的 padding 完全一致。 */
@media (max-width: 767px) {
  [data-pane="conversation"] textarea,
  [data-slot="conversation"] textarea,
  [data-pane="conversation"] [data-input-backdrop],
  [data-slot="conversation"] [data-input-backdrop] {
    box-sizing: border-box;
    padding: 4px 12px !important;
    line-height: 22px !important;
    letter-spacing: normal !important;
    word-spacing: normal !important;
    text-indent: 0 !important;
  }
}

/* —— composer 排除：还原增强规则套到 [data-lexical-editor]（composer 编辑区）
 * 上的字号/行高/段距/列表缩进，避免输入框被 _body 锚定的规则影响。
 * 置于全部增强规则之后（同特异性靠顺序覆盖）。 —— */
[data-slot="conversation"] [data-lexical-editor] {
  font-size: var(--dsh-content-font-size, 14px);
  line-height: calc(24px + var(--dsh-content-font-delta, 0px));
}
[data-slot="conversation"] [data-lexical-editor] p,
[data-slot="conversation"] [data-lexical-editor] li,
[data-slot="conversation"] [data-lexical-editor] blockquote,
[data-slot="conversation"] [data-lexical-editor] dd {
  margin: 0;
  font-size: inherit;
  line-height: inherit;
  color: inherit;
}
[data-slot="conversation"] [data-lexical-editor] p + p,
[data-slot="conversation"] [data-lexical-editor] li + li {
  margin-top: 0;
}
/* —— 排队消息面板（QueueDock）排除：它位于 composer 上方的 input.dock 槽位，
 * 会被上面 [class$="_body"] 锚定的增强规则（16px/28px 字号行高、p 段距、正文
 * 加深）命中，导致排队横条被拉宽/错乱。这里用 !important 强制还原为 dock
 * 自身排版（尤其 line-height 28px 会把横条高度撑高一倍）。 —— */
[data-queue-dock] {
  font-size: 13px !important;
  line-height: 20px !important;
  text-align: left !important;
  text-align-last: start !important;
  text-justify: auto !important;
  letter-spacing: normal !important;
}
[data-queue-dock] p,
[data-queue-dock] li,
[data-queue-dock] span {
  margin: 0 !important;
  font-size: inherit !important;
  line-height: inherit !important;
  color: inherit !important;
  text-align: inherit !important;
  letter-spacing: inherit !important;
}
/* —— QueueDock 的 <ul> 列表会被增强规则 ul/ol{margin:20px 0;padding-left:1.5em}
 * 命中，把排队横条高度撑高一倍。这里还原为 dock 自身列表排版。 —— */
[data-queue-dock] ul,
[data-queue-dock] ol {
  margin: 0 !important;
  padding: 0 !important;
}
`.trim()

/**
 * 会话页标题字号（随皮肤启用，不单设开关）。
 *
 * 锚定规律与哈希无关：`[data-slot="conversation.session"]` 是会话视图的
 * slot 出口；标题文本元素统一以 `_title` 后缀结尾（CSS Modules 命名约定），
 * 且位于 titleRow / titleCluster 行容器内。官方默认 14px 偏小，放大到
 * 25px 并加粗，行高同步放大避免挤压，让会话标题更醒目。
 */
export const CONVERSATION_TITLE_CSS = `
html[data-agentlex-theme] [data-slot="conversation.session"] :is([class*="_titleRow"], [class*="titleCluster"]) [class$="_title"],
html[data-agentlex-theme] [data-slot="conversation.session"] [class*="_titleRow"][class$="_title"],
html[data-agentlex-theme] [data-slot="conversation.session"] [class*="titleCluster"][class$="_title"] {
  font-size: 30px !important;
  line-height: 40px !important;
  font-weight: 700 !important;
  letter-spacing: 0.01em !important;
}
`.trim()
