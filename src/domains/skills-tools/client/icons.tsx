/**
 * 技能与工具 — SVG 图标集（Lucide 风格线条图标，16/14px 视口）。
 * 规范：图标一律用 SVG，不用 emoji。
 */

interface IconProps {
  size?: number
  className?: string
}

function base(size: number): { width: number; height: number; viewBox: string; fill: string; stroke: string; strokeWidth: number; strokeLinecap: 'round' | 'butt' | 'square' | 'inherit'; strokeLinejoin: 'round' | 'miter' | 'bevel' | 'inherit' } {
  return {
    width: size,
    height: size,
    viewBox: '0 0 16 16',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.4,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
  }
}

/** 星芒（技能：能力闪光，主星 + 辅星）。 */
export function SkillIcon({ size = 16, className }: IconProps): React.JSX.Element {
  return (
    <svg {...base(size)} className={className} aria-hidden="true">
      <path d="M8 1.8 9.5 6.5 14.2 8 9.5 9.5 8 14.2 6.5 9.5 1.8 8 6.5 6.5z" />
      <path d="M12.7 9.7l.7 1.9 1.9.7-1.9.7-.7 1.9-.7-1.9-1.9-.7 1.9-.7z" opacity="0.55" />
    </svg>
  )
}

/** 工具箱（技能与工具 / 侧边栏入口）。 */
export function ToolboxIcon({ size = 16, className }: IconProps): React.JSX.Element {
  return (
    <svg {...base(size)} className={className} aria-hidden="true">
      <rect x="2.5" y="6.5" width="11" height="7" rx="1.5" />
      <path d="M5.5 6.5V5.2a1.7 1.7 0 0 1 1.7-1.7h1.6a1.7 1.7 0 0 1 1.7 1.7v1.3" />
      <path d="M2.5 9.5h11" />
    </svg>
  )
}

/** 扳手（工具/MCP）。 */
export function WrenchIcon({ size = 16, className }: IconProps): React.JSX.Element {
  return (
    <svg {...base(size)} className={className} aria-hidden="true">
      <path d="M13.2 5.2a3.4 3.4 0 0 1-4.4 4.4L4.6 13.8a1.5 1.5 0 0 1-2.1-2.1l4.2-4.2a3.4 3.4 0 0 1 4.4-4.4L9 5.2l1.8 1.8z" />
    </svg>
  )
}

/** 搜索。 */
export function SearchIcon({ size = 14, className }: IconProps): React.JSX.Element {
  return (
    <svg {...base(size)} className={className} aria-hidden="true">
      <circle cx="7" cy="7" r="4.5" />
      <path d="m10.5 10.5 3 3" />
    </svg>
  )
}

/** 关闭（×）。 */
export function CloseIcon({ size = 14, className }: IconProps): React.JSX.Element {
  return (
    <svg {...base(size)} className={className} aria-hidden="true">
      <path d="m4 4 8 8M12 4l-8 8" />
    </svg>
  )
}

/** 垃圾桶（删除）。 */
export function TrashIcon({ size = 14, className }: IconProps): React.JSX.Element {
  return (
    <svg {...base(size)} className={className} aria-hidden="true">
      <path d="M2.5 4h11M6 4V2.8A.8.8 0 0 1 6.8 2h2.4a.8.8 0 0 1 .8.8V4M3.5 4l.6 9a1 1 0 0 0 1 .9h5.8a1 1 0 0 0 1-.9l.6-9M6.5 7v4M9.5 7v4" />
    </svg>
  )
}

/** 编辑（铅笔）。 */
export function EditIcon({ size = 14, className }: IconProps): React.JSX.Element {
  return (
    <svg {...base(size)} className={className} aria-hidden="true">
      <path d="M11.3 1.9a1.4 1.4 0 0 1 2 2L5.5 11.7l-2.8.8.8-2.8z" />
    </svg>
  )
}

/** 加号。 */
export function PlusIcon({ size = 14, className }: IconProps): React.JSX.Element {
  return (
    <svg {...base(size)} className={className} aria-hidden="true">
      <path d="M8 3v10M3 8h10" />
    </svg>
  )
}

/** 上传（向上箭头 + 横线）。 */
export function UploadIcon({ size = 14, className }: IconProps): React.JSX.Element {
  return (
    <svg {...base(size)} className={className} aria-hidden="true">
      <path d="M8 11V3M5 6l3-3 3 3M3 12.5h10" />
    </svg>
  )
}


/** 服务器（MCP stdio）。 */
export function ServerIcon({ size = 16, className }: IconProps): React.JSX.Element {
  return (
    <svg {...base(size)} className={className} aria-hidden="true">
      <rect x="2.5" y="2.5" width="11" height="4" rx="1" />
      <rect x="2.5" y="9.5" width="11" height="4" rx="1" />
      <path d="M5 4.5h.01M5 11.5h.01" />
    </svg>
  )
}

/** 地球（MCP HTTP）。 */
export function GlobeIcon({ size = 16, className }: IconProps): React.JSX.Element {
  return (
    <svg {...base(size)} className={className} aria-hidden="true">
      <circle cx="8" cy="8" r="5.5" />
      <path d="M2.5 8h11M8 2.5c1.8 1.6 1.8 9.4 0 11M8 2.5c-1.8 1.6-1.8 9.4 0 11" />
    </svg>
  )
}

/** 面板（打开技能与工具）。 */
export function PanelIcon({ size = 14, className }: IconProps): React.JSX.Element {
  return (
    <svg {...base(size)} className={className} aria-hidden="true">
      <rect x="2.5" y="3" width="11" height="10" rx="1.5" />
      <path d="M2.5 6.5h11" />
    </svg>
  )
}

/** 折叠指示 chevron（folded=true 时旋转 -90°）。 */
export function ChevronDownIcon({ size = 14, folded = false, className }: IconProps & { folded?: boolean }): React.JSX.Element {
  return (
    <svg
      {...base(size)}
      className={className}
      style={{ transform: folded ? 'rotate(-90deg)' : 'none', transition: 'transform 140ms ease' }}
      aria-hidden="true"
    >
      <path d="M4 6l4 4 4-4" />
    </svg>
  )
}

/** 作者小图标（人形）。 */
export function AuthorIcon({ size = 12, className }: IconProps): React.JSX.Element {
  return (
    <svg {...base(size)} className={className} aria-hidden="true">
      <circle cx="8" cy="5.2" r="2.6" />
      <path d="M2.8 13.4c.7-2.6 2.8-3.9 5.2-3.9s4.5 1.3 5.2 3.9" />
    </svg>
  )
}

/** 计算器（小工具）。 */
export function CalcIcon({ size = 16, className }: IconProps): React.JSX.Element {
  return (
    <svg {...base(size)} className={className} aria-hidden="true">
      <rect x="3" y="2.2" width="10" height="11.6" rx="1.4" />
      <path d="M5.4 4.8h5.2M5.6 8h.01M8 8h.01M10.4 8h.01M5.6 10.6h.01M8 10.6h.01M10.4 10.6h.01" />
    </svg>
  )
}

/** 钱币（费用类）。 */
export function CoinIcon({ size = 16, className }: IconProps): React.JSX.Element {
  return (
    <svg {...base(size)} className={className} aria-hidden="true">
      <circle cx="8" cy="8" r="5.6" />
      <path d="M8 4.8v6.4M6.2 6.4h3.1a1.1 1.1 0 0 1 0 2.2H6.4a1.1 1.1 0 0 0 0 2.2h3.2" />
    </svg>
  )
}

/** 上升曲线（利息 / 违约金）。 */
export function TrendIcon({ size = 16, className }: IconProps): React.JSX.Element {
  return (
    <svg {...base(size)} className={className} aria-hidden="true">
      <path d="M2.5 11.5 6 8l2.6 2.4L13.5 4.5" />
      <path d="M10.6 4.5h2.9v2.9" />
    </svg>
  )
}

/** 日历（期限 / 日期）。 */
export function CalendarIcon({ size = 16, className }: IconProps): React.JSX.Element {
  return (
    <svg {...base(size)} className={className} aria-hidden="true">
      <rect x="2.5" y="3.5" width="11" height="10" rx="1.4" />
      <path d="M2.5 6.6h11M5.5 2.2v2.6M10.5 2.2v2.6" />
    </svg>
  )
}

/** 文字（文书辅助）。 */
export function TextIcon({ size = 16, className }: IconProps): React.JSX.Element {
  return (
    <svg {...base(size)} className={className} aria-hidden="true">
      <path d="M3.5 4.2h9M8 4.2v8.4M5.8 12.6h4.4" />
    </svg>
  )
}

/** 返回（小工具详情 → 列表）。 */
export function BackIcon({ size = 14, className }: IconProps): React.JSX.Element {
  return (
    <svg {...base(size)} className={className} aria-hidden="true">
      <path d="M7 3.5 3.5 8 7 12.5M3.9 8h8.6" />
    </svg>
  )
}

/** 复制。 */
export function CopyIcon({ size = 13, className }: IconProps): React.JSX.Element {
  return (
    <svg {...base(size)} className={className} aria-hidden="true">
      <rect x="5.5" y="2.5" width="8" height="9" rx="1.2" />
      <path d="M10.5 13.5h-8v-9" />
    </svg>
  )
}

/** 对勾（复制成功 / 校验通过）。 */
export function CheckIcon({ size = 13, className }: IconProps): React.JSX.Element {
  return (
    <svg {...base(size)} className={className} aria-hidden="true">
      <path d="m3.2 8.4 3.2 3.2 6.4-7.2" />
    </svg>
  )
}

/** 小工具：诉讼费（天平）。 */
export function ScaleIcon({ size = 16, className }: IconProps): React.JSX.Element {
  return (
    <svg {...base(size)} className={className} aria-hidden="true">
      <path d="M8 2.6v10.8M4 13.4h8M8 4.4 3.6 6.2M8 4.4l4.4 1.8" />
      <path d="M1.8 9.6 3.6 6.2l1.8 3.4a2 2 0 0 1-3.6 0ZM10.6 9.6l1.8-3.4 1.8 3.4a2 2 0 0 1-3.6 0Z" />
    </svg>
  )
}

/** 小工具：律师费（握手）。 */
export function HandshakeIcon({ size = 16, className }: IconProps): React.JSX.Element {
  return (
    <svg {...base(size)} className={className} aria-hidden="true">
      <path d="M1.8 6.4 4.6 4h2.2l1.6 1.4L10 4h1.4l2.8 2.4" />
      <path d="M1.8 6.4v3.2l3.4 3 1.6-1.6 1.4 1.4 1.4-1.4 3.2-3V6.4" />
      <path d="M7.4 7.2 5.6 8.8a1 1 0 0 0 1.4 1.4" />
    </svg>
  )
}

/** 小工具：利息（利率百分号）。 */
export function PercentIcon({ size = 16, className }: IconProps): React.JSX.Element {
  return (
    <svg {...base(size)} className={className} aria-hidden="true">
      <path d="M12.4 3.6 3.6 12.4" />
      <circle cx="5.2" cy="5.2" r="1.9" />
      <circle cx="10.8" cy="10.8" r="1.9" />
    </svg>
  )
}

/** 小工具：违约金（警示三角）。 */
export function AlertTriangleIcon({ size = 16, className }: IconProps): React.JSX.Element {
  return (
    <svg {...base(size)} className={className} aria-hidden="true">
      <path d="M8 2.6 14.2 13H1.8z" />
      <path d="M8 6.4v3.4M8 11.6h.01" />
    </svg>
  )
}

/** 小工具：迟延履行加倍利息（沙漏）。 */
export function HourglassIcon({ size = 16, className }: IconProps): React.JSX.Element {
  return (
    <svg {...base(size)} className={className} aria-hidden="true">
      <path d="M4.2 2.6h7.6M4.2 13.4h7.6" />
      <path d="M5 2.6c0 2.4 3 3.2 3 5.4s-3 3-3 5.4M11 2.6c0 2.4-3 3.2-3 5.4s3 3 3 5.4" />
    </svg>
  )
}

/** 小工具：期限计算（日历 + 时钟）。 */
export function CalendarClockIcon({ size = 16, className }: IconProps): React.JSX.Element {
  return (
    <svg {...base(size)} className={className} aria-hidden="true">
      <path d="M13.4 7.6V4.4a1.2 1.2 0 0 0-1.2-1.2H3.8a1.2 1.2 0 0 0-1.2 1.2v7.2a1.2 1.2 0 0 0 1.2 1.2h4" />
      <path d="M2.6 6.4h10.8M5.2 2.2v2.4M11 2.2v2.4" />
      <circle cx="11.4" cy="11.2" r="2.9" />
      <path d="M11.4 9.8v1.5l1 .8" />
    </svg>
  )
}

/** 小工具：日期差（区间日历）。 */
export function RangeIcon({ size = 16, className }: IconProps): React.JSX.Element {
  return (
    <svg {...base(size)} className={className} aria-hidden="true">
      <path d="M5.4 8h5.2M6.6 6.2 4.8 8l1.8 1.8M9.4 6.2 11.2 8l-1.8 1.8" />
      <path d="M3.2 3.4h9.6a1.2 1.2 0 0 1 1.2 1.2v7a1.2 1.2 0 0 1-1.2 1.2H3.2A1.2 1.2 0 0 1 2 11.6v-7a1.2 1.2 0 0 1 1.2-1.2Z" />
    </svg>
  )
}

/** 小工具：金额大写（字 + 撇）。 */
export function AmountTextIcon({ size = 16, className }: IconProps): React.JSX.Element {
  return (
    <svg {...base(size)} className={className} aria-hidden="true">
      <path d="M2.6 4.2h6.2M5.7 4.2v7.6M3.9 11.8h3.6" />
      <path d="M11 4.6 13.6 6l-2.6 1.4M13.6 6v4.2M11.6 11.4h4" />
    </svg>
  )
}
