/**
 * ToolAttachment — 工具产物（图片/音频/PDF/文件）一等公民通道。
 *
 * 由 Sidecar 落盘后通过 UnifiedEvent.tool_result.attachments[] 送达前端，
 * 前端通过 ToolAttachmentGallery 统一渲染。任意 Runtime（builtin / Codex /
 * Gemini / CC）+ 任意工具的图片产物都走这条通道，不再"按工具名前缀分发到
 * 专门 React 组件"。
 *
 * 详见 specs/prd/prd_0.2.15_codex_tool_outputs_normalization.md。
 */

export type ToolAttachmentKind = 'image' | 'audio' | 'pdf' | 'file';

export interface ToolAttachment {
  kind: ToolAttachmentKind;

  /** MIME 类型，如 'image/png' / 'audio/mpeg' / 'application/pdf' */
  mimeType: string;

  /**
   * **相对**路径形态。形如 `/api/attachment/tool/<sessionId>/<turnId>/<filename>`，
   * 前端运行时拼当前 sidecar base URL — Tab/Session sidecar 端口 dynamic，
   * 落盘绝对 URL 在 session resume 后端口已变，老 URL 全坏。
   */
  refPath: string;

  /**
   * 落盘绝对路径，**仅在 Tauri 桌面 sidecar 写**（沿用 sessionOwner sidecar 信任根，
   * 读取/导出字节时走 `refPath` + `cmd_read_tool_attachment_bytes` /
   * `cmd_export_tool_attachment`，由 session sidecar attachment endpoint 反查注册表）。
   * IM Bot / Cron Sidecar 不写此字段，强制走 refPath HTTP 路径避免跨 sidecar 直读。
   */
  savedPath?: string;

  /**
   * 原始产物路径（PRD 0.2.31）。`savedPath` 是 trusted-root 的**副本**（用于渲染/重启可解析）；
   * `sourcePath` 是工具实际写出的**原始**文件（如 `~/.myagents/generated_audio/xxx.mp3`），
   * 也是工具卡 meta 展示的那条路径。「在文件管理器中显示 / 用默认应用打开」优先用它，
   * 让"看到的路径"和"打开的路径"一致。仅 builtin 媒体附件设置；其它来源留空。
   */
  sourcePath?: string;

  sizeBytes?: number;

  /** 图片像素宽（如已知） */
  width?: number;

  /** 图片像素高（如已知） */
  height?: number;

  /**
   * 工具产物描述。**字符串硬上限 4KB**——防 unbounded 入侵 SSE 256KB 红线。
   * 如 OpenAI image_generation 的 revisedPrompt、edge-tts 的合成文本。
   */
  caption?: string;

  /** 调试/审计：来源工具标识。如 'codex.image_generation' / 'mcp.gemini-image.generate_image'。 */
  producedBy?: string;

  /**
   * Placeholder 模式：base64 落盘异步进行时先 emit 占位 attachment，落盘成功后
   * 通过 `chat:tool-attachment-update` SSE 事件 patch 填充 refPath/savedPath/sizeBytes。
   * 前端识别该字段，渲染 loading 骨架直到 patch 抵达。
   */
  pendingId?: string;

  /**
   * 展示语义（#293 / PRD 0.2.33）：
   *  - `'artifact'`（默认，含 undefined / 历史数据）— 交付物（gemini-image 产图、
   *    edge-tts 音频等用户点名要的产出），渲染为对话流内始终可见的独立卡片
   *    （Message.tsx per-BlockGroup hoist，PRD 0.2.30 行为不变）。
   *  - `'process'` — 过程产物（Playwright / computer-use 截图等 AI 的"眼睛"），
   *    渲染进折叠工具条内部（ProcessRow 展开体），折叠条上以图片角标提示。
   *    重度浏览任务一轮几十张截图不再刷屏对话流。
   * 由 server 侧按工具名判定（classifyToolAttachmentPresentation），只在 'process'
   * 时显式写入 — 省略即 artifact，老持久化数据无需迁移。
   */
  presentation?: 'artifact' | 'process';
}

/** 占位 attachment 的硬性最大字节数（25MB，对齐 workspace_files download 红线）。 */
export const MAX_TOOL_ATTACHMENT_BYTES = 25 * 1024 * 1024;

/** caption 字符串硬上限（4KB）。 */
export const MAX_TOOL_ATTACHMENT_CAPTION_BYTES = 4 * 1024;
