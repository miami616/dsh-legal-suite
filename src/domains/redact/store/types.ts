/**
 * 脱敏域持久化类型。
 *
 * 文件布局（$DSH_HOME/agentlex/redact/）：
 *   - mappings/<scope>.json  假名↔原名映射（**机密**：0600，禁外发/禁推送）
 *   - custom-terms.json      自定义词条（global + byCase 两级）
 *   - redact-config.json     行为配置
 */
import type { EntityKind, RedactMode } from '../engine/types.ts'

/** 一个实体的映射记录（原值作为 JSON key）。 */
export interface MappingEntity {
  /** 替换后的假名/掩码。 */
  alias: string
  kind: EntityKind | string
  /** 来源（litigation.party / rule:idcard / custom …）。 */
  source?: string
  /** 备注（法定代表人/承办法官…）。 */
  note?: string
  createdAt: string
}

/** 一个 scope（案件/项目/global）的映射文档。 */
export interface MappingDoc {
  version: '1.0'
  scope: string
  /** 首次建表时的模式（masked 一经使用即永久单向）。 */
  mode: RedactMode
  /**
   * 是否可还原。**单调收缩**：一旦在 masked 模式下用过就永远 false。
   * 还原出口以此为准，不靠调用方自觉。
   */
  restorable: boolean
  entities: Record<string, MappingEntity>
  createdAt: string
  lastUpdated?: string
}

/** 自定义词条。 */
export interface TermEntry {
  value: string
  kind: EntityKind
  note?: string
  createdAt: string
}

export interface CustomTermsDoc {
  version: '1.0'
  global: TermEntry[]
  byCase: Record<string, TermEntry[]>
  lastUpdated?: string
}

/** 行为配置。 */
export interface RedactConfigDoc {
  version: '1.0'
  /** 金额是否打码（默认 false：金额多为案件要素）。 */
  maskAmounts: boolean
  /** 是否跑启发层候选（默认 true，只报告不替换）。 */
  heuristic: boolean
  /** 是否跨案并入全库词条（默认 false）。 */
  crossScope: boolean
  lastUpdated?: string
}

export interface ApiResponse<T = unknown> {
  success: boolean
  data?: T
  error?: string
}
