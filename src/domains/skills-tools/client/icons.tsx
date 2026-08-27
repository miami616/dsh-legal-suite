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
