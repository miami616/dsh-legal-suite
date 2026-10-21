/**
 * 图片版提醒：把本轮实际要推送的条目交给 HTML 模板渲染成 PNG。
 *
 * 为什么不在 Node 里画：版式（行高/换行/分隔线/字体）用 CSS 调最快；复用
 * `scripts/reminder-card.template.html`，同一份模板还能在浏览器直接打开预览。
 *
 * 运行链路：
 *   push 摘要 → 写 data.json → spawn node scripts/render-reminder-image.mjs
 *   → Playwright/Chrome 整页截图 → PNG → 飞书图片上传 → 交互卡片
 *
 * 失败一律抛错，由调用方回退文字卡；绝不影响提醒是否送达。
 */

import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import type { ReminderEntry, SuppressedSummary } from './reminder-plan.ts'

const execFileAsync = promisify(execFile)

/** 渲染脚本路径（lib/domains/push → 包根 → scripts）。 */
const SCRIPT = fileURLToPath(new URL('../../../scripts/render-reminder-image.mjs', import.meta.url))

/** 渲染图片所需的数据。 */
export interface ReminderImageInput {
  entries: ReminderEntry[]
  now: number
  pushTime?: string
  /** 计划总条数（含被限额折叠的），用于「共 N 项」。 */
  total: number
  suppressed?: SuppressedSummary
  /** 只渲染概览（今日全列、明日/提前各 3 条）。 */
  compact?: boolean
  /** 摘要 / 即将开始。 */
  kind?: 'digest' | 'intraday'
}

/** 渲染一张 PNG，返回文件路径；调用方负责删除。 */
export async function renderReminderImage(input: ReminderImageInput): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'agentlex-reminder-img-'))
  const dataPath = join(dir, 'data.json')
  const outPath = join(dir, 'reminder.png')
  const data = {
    now: input.now,
    total: input.total,
    items: input.entries.map((entry) => ({
      label: entry.item.label,
      caseName: entry.item.caseName,
      date: entry.item.date,
      time: entry.item.time,
      phaseLabel: entry.phaseLabel,
      severity: entry.severity,
      cls: entry.cls,
      section: entry.section,
      consequence: entry.consequence,
    })),
    suppressed: input.suppressed ?? { overdue: 0, ahead: 0 },
    pushTime: input.pushTime ?? '08:30',
    kind: input.kind ?? 'digest',
  }
  await writeFile(dataPath, JSON.stringify(data), 'utf8')
  try {
    await execFileAsync(process.execPath, [
      SCRIPT,
      '--data', dataPath,
      '--out', outPath,
      ...(input.compact === true ? ['--compact'] : []),
    ], {
      timeout: 45_000,
      env: process.env,
      maxBuffer: 2 * 1024 * 1024,
    })
    return outPath
  } catch (error) {
    await rm(dir, { recursive: true, force: true }).catch(() => {})
    throw error instanceof Error ? error : new Error(String(error))
  }
}

/** 删除渲染临时文件。 */
export async function cleanupReminderImage(path: string): Promise<void> {
  await rm(dirname(path), { recursive: true, force: true }).catch(() => {})
}
