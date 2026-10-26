/**
 * 周报图片版：把周一「本周重点工作」/ 周五「本周总结与下周重点」渲染成 PNG。
 *
 * 与每日提醒图片版同一链路（HTML 模板 → 无头浏览器整页截图），只是版式不同：
 * 周报分区多、一行两列（时间 + 事项），1080px 宽整页截图，手机点开可放大。
 *
 * 运行链路：
 *   push 周报 → 写 data.json → spawn node scripts/render-weekly-image.mjs
 *   → Playwright/Chrome 整页截图 → PNG → 飞书图片上传 → 交互卡片
 *
 * 失败一律抛错，由调用方回退文字卡；绝不影响周报是否送达。
 */

import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import type { WeeklyPayload } from './weekly.ts'

const execFileAsync = promisify(execFile)

/** 渲染脚本路径（lib/domains/push → 包根 → scripts）。 */
const SCRIPT = fileURLToPath(new URL('../../../scripts/render-weekly-image.mjs', import.meta.url))

/** 渲染一张周报 PNG，返回文件路径；调用方负责删除。 */
export async function renderWeeklyImage(payload: WeeklyPayload, now: number = Date.now()): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'agentlex-weekly-img-'))
  const dataPath = join(dir, 'data.json')
  const outPath = join(dir, 'weekly.png')
  const data = {
    now,
    kind: payload.kind,
    weekKey: payload.weekKey,
    rangeLabel: payload.rangeLabel,
    weekLabel: payload.weekLabel,
    total: payload.total,
    worst: payload.worst,
    sections: payload.sections.map((section) => ({
      title: section.title,
      note: section.note,
      rows: section.rows.map((row) => ({
        label: row.label,
        when: row.when,
        caseName: row.caseName,
        detail: row.detail,
        tag: row.tag,
        tagColor: row.tagColor,
        severity: row.severity,
      })),
    })),
  }
  await writeFile(dataPath, JSON.stringify(data), 'utf8')
  try {
    await execFileAsync(process.execPath, [
      SCRIPT,
      '--data', dataPath,
      '--out', outPath,
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
export async function cleanupWeeklyImage(path: string): Promise<void> {
  await rm(dirname(path), { recursive: true, force: true }).catch(() => {})
}
