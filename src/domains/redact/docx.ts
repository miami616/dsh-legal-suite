/**
 * docx 读写：把 Word 文档拆成「纯文本 + run 位置图」，脱敏后写回**保留原格式**的副本。
 *
 * 为什么自己解析：docx 就是 zip + OOXML。一个名字常被 Word 拆进多个 `<w:t>` run
 * （改过字体/拼写检查就会拆），所以要按 run 建字符位置图，替换时把跨 run 的命中
 * 合并到首个 run，其余清空——版式、表格、批注、样式一字不动。
 *
 * 只处理文本容器：document.xml / header*.xml / footer*.xml / footnotes / endnotes / comments。
 */
import type { Span } from './engine/types.ts'

/** 一个 `<w:t>` run：解码后的文本 + 它在 XML 里的内容区间。 */
export interface DocxRun {
  text: string
  /** 在所属 part 纯文本里的起止（含头不含尾）。 */
  textStart: number
  textEnd: number
  /** `xmlStart..xmlEnd` 是 XML 中该 run 的**内容**区间（不含标签）。 */
  xmlStart: number
  xmlEnd: number
}

export interface DocxParagraph {
  textStart: number
  textEnd: number
  runs: DocxRun[]
}

export interface DocxPart {
  /** zip 内的路径，如 word/document.xml。 */
  name: string
  xml: string
  text: string
  paragraphs: DocxParagraph[]
}

/** XML 文本节点解码（只处理 OOXML 里会出现的实体）。 */
export function decodeXml(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, '\'')
    .replace(/&#(\d+);/g, (_m, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, code: string) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&amp;/g, '&')
}

export function encodeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

/** 段落（`<w:p>`，非 `<w:pPr>`）区块正则。 */
const PARAGRAPH_RE = /<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g
/** 文本 run（`<w:t>`，非 `<w:tbl>`/`<w:tc>`/`<w:tab/>`）。 */
const RUN_RE = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g

/**
 * 解析一个 part：产出纯文本（段落用 \n 连接）与 run 位置图。
 *
 * 位置语义：`paragraph.textStart/textEnd` 与本 part 的 `text` 对齐；run 的
 * `xmlStart/xmlEnd` 是 XML 中 `<w:t>` **内容**区间，可直接做字符串替换。
 */
export function parsePart(name: string, xml: string): DocxPart {
  const paragraphs: DocxParagraph[] = []
  const texts: string[] = []
  let offset = 0
  PARAGRAPH_RE.lastIndex = 0
  for (;;) {
    const para = PARAGRAPH_RE.exec(xml)
    if (para === null) break
    const block = para[0]
    const base = para.index
    const runs: DocxRun[] = []
    RUN_RE.lastIndex = 0
    for (;;) {
      const match = RUN_RE.exec(block)
      if (match === null) break
      const inner = match[1] ?? ''
      const decoded = decodeXml(inner)
      const innerStart = match.index + (match[0].length - '</w:t>'.length - inner.length)
      runs.push({
        text: decoded,
        textStart: 0,
        textEnd: 0,
        xmlStart: base + innerStart,
        xmlEnd: base + innerStart + inner.length,
      })
    }
    if (runs.length === 0) continue
    let cursor = offset
    for (const run of runs) {
      run.textStart = cursor
      cursor += run.text.length
      run.textEnd = cursor
    }
    texts.push(runs.map((run) => run.text).join(''))
    paragraphs.push({ textStart: offset, textEnd: cursor, runs })
    offset = cursor + 1 // 段落之间用 \n 连接
  }
  return { name, xml, text: texts.join('\n'), paragraphs }
}

/** 判断某段纯文本是否值得跑规则（空段跳过，省时间）。 */
export function isBlankPartText(text: string): boolean {
  return text.trim() === ''
}

export interface ApplyResult {
  xml: string
  /** 实际写回的命中。 */
  applied: Span[]
  /** 跨越段落/找不到落点的命中（报告给用户人工处理）。 */
  skipped: Span[]
}

/**
 * 把命中区间写回 XML。
 *
 * 关键约束（踩过的坑）：**每个 run 只能产出一条编辑**。早期版本让每个命中各自
 * 整段重写所属 run，同一 run 有多个命中时，后一条会按旧偏移切已被改短的字符串，
 * 把 `</w:t>` 标签啃掉。现在按 run 归并：把该 run 内的命中从后往前应用到 run 文本上，
 * 只产出一次编辑；跨 run 的命中在首 run 落替换文本、后续 run 删掉覆盖部分。
 */
export function applySpansToPart(part: DocxPart, spans: readonly Span[]): ApplyResult {
  interface Edit { xmlStart: number; xmlEnd: number; text: string }
  const edits: Edit[] = []
  const applied: Span[] = []
  const skipped: Span[] = []

  const byParagraph = new Map<DocxParagraph, Span[]>()
  for (const span of spans) {
    const paragraph = part.paragraphs.find((p) => span.start >= p.textStart && span.end <= p.textEnd)
    if (paragraph === undefined) { skipped.push(span); continue }
    const list = byParagraph.get(paragraph)
    if (list === undefined) byParagraph.set(paragraph, [span])
    else list.push(span)
    applied.push(span)
  }

  for (const [paragraph, paraSpans] of byParagraph) {
    for (const run of paragraph.runs) {
      const covering = paraSpans.filter((span) => span.end > run.textStart && span.start < run.textEnd)
      if (covering.length === 0) continue
      let text = run.text
      for (const span of [...covering].sort((a, b) => b.start - a.start)) {
        const localStart = Math.max(0, span.start - run.textStart)
        const localEnd = Math.min(run.text.length, span.end - run.textStart)
        const carriesReplacement = span.start >= run.textStart && span.start < run.textEnd
        text = text.slice(0, localStart) + (carriesReplacement ? span.replacement : '') + text.slice(localEnd)
      }
      edits.push({ xmlStart: run.xmlStart, xmlEnd: run.xmlEnd, text })
    }
  }

  let xml = part.xml
  for (const edit of edits.sort((a, b) => b.xmlStart - a.xmlStart)) {
    xml = xml.slice(0, edit.xmlStart) + encodeXml(edit.text) + xml.slice(edit.xmlEnd)
  }
  return { xml, applied, skipped }
}
