/**
 * builtinMediaResult — single source of truth for parsing the **text** results
 * of the builtin media MCP tools (edge-tts / gemini-image).
 *
 * PRD 0.2.30 → 0.2.31 cleanup. The tools emit a human-readable `key: value`
 * text block (which the model sees and which is persisted for history). Three
 * call sites used to parse that text independently and had begun to drift
 * (e.g. server used `??` vs frontend `||` for the gemini description). This
 * module is the ONE parser, consumed by:
 *   - server  `runtimes/builtin-media-attachments.ts` (→ ToolAttachment specs)
 *   - renderer `components/tools/EdgeTtsTool.tsx`     (→ collapsible card meta)
 *   - renderer `components/tools/GeminiImageTool.tsx` (→ collapsible card meta)
 *
 * Pure (no fs / SDK / DOM) so it lives in `src/shared/` and is consumed by both
 * the Node sidecar (esbuild) and the renderer (Vite). All functions are total —
 * malformed input yields empty/`undefined` fields, never throws.
 */

import type { ToolAttachmentKind } from './types/tool-attachment';

export const EDGE_TTS_TOOL = 'mcp__edge-tts__text_to_speech';
export const GEMINI_GENERATE_TOOL = 'mcp__gemini-image__generate_image';
export const GEMINI_EDIT_TOOL = 'mcp__gemini-image__edit_image';

const MEDIA_TOOLS = new Set<string>([EDGE_TTS_TOOL, GEMINI_GENERATE_TOOL, GEMINI_EDIT_TOOL]);

const AUDIO_MIME: Record<string, string> = {
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  opus: 'audio/opus',
  webm: 'audio/webm',
  aac: 'audio/aac',
  m4a: 'audio/mp4',
};

const IMAGE_MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
};

function extOf(p: string): string {
  return p.split('.').pop()?.toLowerCase() ?? '';
}

/** Infer audio MIME from a file path's extension (default audio/mpeg). */
export function audioMimeFromPath(p: string): string {
  return AUDIO_MIME[extOf(p)] ?? 'audio/mpeg';
}

/** Infer image MIME from a file path's extension (default image/png). */
export function imageMimeFromPath(p: string): string {
  return IMAGE_MIME[extOf(p)] ?? 'image/png';
}

/**
 * Unwrap an MCP content-array result back to plain text. MCP tool results often
 * arrive serialized as `[{"type":"text","text":"..."}]` (either via the sidecar's
 * `JSON.stringify(content)` or the renderer's raw result). Non-array input is
 * returned as-is.
 */
export function unwrapMcpResult(result: string): string {
  // Tolerate leading whitespace before the `[` (the pre-refactor server parser
  // used `trimStart().startsWith('[')`; dropping it would skip parsing for a
  // result like "\n[...]" — exactly the kind of `??`/`||`-class drift this
  // unification exists to kill). `JSON.parse` already ignores leading space.
  if (!result.trimStart().startsWith('[')) return result;
  try {
    const parsed = JSON.parse(result) as unknown[];
    const texts = parsed
      .filter(
        (c): c is { text: string } =>
          typeof c === 'object' &&
          c !== null &&
          'text' in c &&
          typeof (c as { text: unknown }).text === 'string',
      )
      .map(c => c.text);
    if (texts.length > 0) return texts.join('\n');
  } catch {
    /* not JSON — fall through */
  }
  return result;
}

/** Parse `key: value` lines (value = rest of line, so paths with spaces / drive colons are safe). */
function parseFields(text: string): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const line of text.split('\n')) {
    const match = line.match(/^(\w+):\s*(.+)$/);
    if (match) fields[match[1]] = match[2].trim();
  }
  return fields;
}

export interface EdgeTtsResult {
  filePath?: string;
  voice?: string;
  duration?: string;
  format?: string;
  size?: string;
  rate?: string;
  volume?: string;
  pitch?: string;
  textPreview?: string;
  error?: string;
  isVoiceList: boolean;
}

/** Parse an edge-tts `text_to_speech` / `list_voices` tool result. */
export function parseEdgeTtsResult(result: string | undefined): EdgeTtsResult {
  if (!result) return { isVoiceList: false };

  const text = unwrapMcpResult(result);

  // list_voices result.
  if (text.includes('Found ') && text.includes('voice(s)')) {
    return { isVoiceList: true };
  }
  // Error branch (edge-tts returns "Error: ...").
  if (text.startsWith('Error')) {
    return { error: text, isVoiceList: false };
  }

  const fields = parseFields(text);
  return {
    filePath: fields['filePath'],
    voice: fields['voice'],
    duration: fields['duration'],
    format: fields['format'],
    size: fields['size'],
    rate: fields['rate'],
    volume: fields['volume'],
    pitch: fields['pitch'],
    textPreview: fields['textPreview'],
    error: undefined,
    isVoiceList: false,
  };
}

export interface GeminiImageResult {
  contextId?: string;
  filePath?: string;
  resolution?: string;
  aspectRatio?: string;
  model?: string;
  description?: string;
  editCount?: number;
  isEdit: boolean;
  error?: string;
}

/** Parse a gemini-image `generate_image` / `edit_image` tool result. */
export function parseGeminiImageResult(result: string | undefined): GeminiImageResult {
  if (!result) return { isEdit: false };

  const text = unwrapMcpResult(result);
  const fields = parseFields(text);

  // Extract edit count from "图片已编辑（第 N 次修改）".
  const editMatch = text.match(/第\s*(\d+)\s*次修改/);
  const editCount = editMatch ? parseInt(editMatch[1], 10) : undefined;
  const isEdit = text.includes('图片已编辑');
  const isError = text.startsWith('Error');

  // Description after "图片描述:" line, else the `description` field.
  const descMatch = text.match(/图片描述:\s*(.+?)(?:\n\n|$)/s);
  const description = descMatch?.[1]?.trim() || fields['description'];

  return {
    contextId: fields['contextId'],
    filePath: fields['filePath'],
    resolution: fields['resolution']?.split('|')[0]?.trim(),
    aspectRatio: fields['aspectRatio'] || fields['resolution']?.split('|')[1]?.replace('aspectRatio:', '')?.trim(),
    model: fields['model'],
    description,
    editCount,
    isEdit,
    error: isError ? text : undefined,
  };
}

export interface BuiltinMediaSpec {
  filePath: string;
  mimeType: string;
  kind: ToolAttachmentKind;
  caption?: string;
  producedBy: string;
}

/**
 * Server-facing: derive the rich-media attachment spec(s) from a builtin media
 * tool result. Non-media tools / errors / list-voices / missing filePath → `[]`.
 * Built on the same `parse*Result` functions the renderer cards use, so the
 * attachment caption and the card meta never drift.
 */
export function parseBuiltinMediaToolResult(toolName: string, contentStr: string): BuiltinMediaSpec[] {
  if (!contentStr || !MEDIA_TOOLS.has(toolName)) return [];

  if (toolName === EDGE_TTS_TOOL) {
    const r = parseEdgeTtsResult(contentStr);
    if (r.error || r.isVoiceList || !r.filePath) return [];
    const caption = [r.voice, r.textPreview].filter(Boolean).join(' · ') || undefined;
    return [
      {
        filePath: r.filePath,
        mimeType: audioMimeFromPath(r.filePath),
        kind: 'audio',
        caption,
        producedBy: 'mcp.edge-tts.text_to_speech',
      },
    ];
  }

  // gemini-image generate / edit
  const r = parseGeminiImageResult(contentStr);
  if (r.error || !r.filePath) return [];
  return [
    {
      filePath: r.filePath,
      mimeType: imageMimeFromPath(r.filePath),
      kind: 'image',
      caption: r.description,
      producedBy: toolName === GEMINI_EDIT_TOOL ? 'mcp.gemini-image.edit_image' : 'mcp.gemini-image.generate_image',
    },
  ];
}
