/**
 * AgentLex brand components for DSH shell slots.
 *
 *  - 侧边栏：AgentLex 英文 + 超级律师助理 中文
 *  - 新会话 Hero：参考原 AgentLex 首页 —— 时间/天气 + 按时段问候 + 可自定义称呼
 */
import React, { useEffect, useState } from 'react'
import { useSkinConfig } from './config.ts'

/** The AgentLex compact icon, sized to sit comfortably in the brand row. */
export function AgentLexBrandMark({ size, className }: { size: number; className?: string }): React.JSX.Element {
  const displaySize = Math.round(size * 1.6)
  return (
    <svg
      width={displaySize}
      height={displaySize}
      viewBox="0 0 1024 1024"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="AgentLex"
      className={className}
    >
      <defs>
        <linearGradient id="agentlex-skin-bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#0f766e" />
          <stop offset="1" stopColor="#6d28d9" />
        </linearGradient>
      </defs>
      <rect x="64" y="64" width="896" height="896" rx="192" fill="url(#agentlex-skin-bg)" />
      <path d="M320 320 L320 620 L560 620" fill="none" stroke="#FFFFFF" strokeWidth="150" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="612" cy="320" r="62" fill="#F4B13C" />
      <circle cx="688" cy="320" r="28" fill="#F4B13C" opacity="0.55" />
    </svg>
  )
}

/** Sidebar brand: English + Chinese. */
export function AgentLexBrandName(): React.JSX.Element {
  const config = useSkinConfig()
  return (
    <span
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 10,
        minWidth: 0,
      }}
    >
      <span
        style={{
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          lineHeight: 1.12,
          whiteSpace: 'nowrap',
        }}
      >
        <span
          style={{
            fontFamily: 'var(--dsw-font-family, system-ui, sans-serif)',
            fontSize: 17,
            fontWeight: 700,
            letterSpacing: '0.01em',
            color: 'var(--dsw-alias-label-primary)',
          }}
        >
          {config.brandEn}
        </span>
        <span
          style={{
            marginTop: 1,
            fontFamily: 'var(--dsw-font-family, system-ui, sans-serif)',
            fontSize: 12,
            fontWeight: 500,
            letterSpacing: '0.05em',
            color: 'var(--dsw-alias-label-tertiary)',
          }}
        >
          {config.brandZh}
        </span>
      </span>
      {/* 原生 DSH 风格的黑色小标签：靠上对齐英文行，与文字保持一定距离 */}
      <span
        style={{
          flex: 'none',
          alignSelf: 'flex-start',
          marginTop: 3,
          background: 'var(--dsw-alias-label-primary)',
          color: 'var(--dsw-alias-label-primary-inverted)',
          fontSize: 9,
          fontWeight: 600,
          lineHeight: 1.3,
          padding: '2px 5px',
          borderRadius: 4,
          letterSpacing: '0.02em',
          whiteSpace: 'nowrap',
        }}
      >
        dsh版
      </span>
    </span>
  )
}

/** Time-based greeting, same as the original AgentLex launcher. */
function greeting(): string {
  const h = new Date().getHours()
  if (h < 6) return '夜深了'
  if (h < 12) return '上午好'
  if (h < 14) return '中午好'
  if (h < 18) return '下午好'
  return '晚上好'
}

/**
 * 欢迎副题池：按外观主题的气质分组（玄墨朱砂=卷宗感 / 墨玉鎏金=庄重贵气 /
 * 青瓷竹绿=清雅书房），其余主题共用默认池。随「日期×6 小时时段」轮换——
 * Hero 每分钟因时钟重渲染，取模种子必须慢变，否则文案会每分钟跳变。
 */
const WELCOME_LINES: Record<string, string[]> = {
  cinnabar: [
    '卷宗已就位，今天从哪件案子开始？',
    '受人之托，忠人之事 —— 先看今日日程。',
    '打开卷宗，今天的日程一目了然。',
  ],
  onyx: [
    '鎏金时刻 —— 今日的要点已经梳理好了。',
    '重要的事不着急，一件一件来。',
    '夜色正好，把今天的收尾工作做完。',
  ],
  codex: [
    '泡杯茶，把最难写的文书今天写完。',
    '从容开始 —— 日程与期限都已备好。',
    '阅卷或写作，我在旁边帮你。',
  ],
}
const WELCOME_LINES_DEFAULT = [
  '今天有什么可以帮你的？',
  '工作还是聊天，从这里开始吧！',
  '有新的进展需要记录吗？',
]

function welcomeLine(themeKey: string | undefined, now: Date): string {
  const pool = WELCOME_LINES[themeKey ?? ''] ?? WELCOME_LINES_DEFAULT
  const bucket = Math.floor(now.getHours() / 6)
  return pool[(now.getDate() * 4 + bucket) % pool.length] ?? WELCOME_LINES_DEFAULT[0]!
}

/** Translate common English weather descriptions to Chinese. */
function translateWeather(desc: string): string {
  const map: Record<string, string> = {
    'Sunny': '晴天',
    'Clear': '晴',
    'Partly cloudy': '多云',
    'Cloudy': '阴天',
    'Overcast': '阴',
    'Mist': '薄雾',
    'Fog': '雾',
    'Freezing fog': '冻雾',
    'Patchy rain nearby': '局部有雨',
    'Patchy rain possible': '可能有雨',
    'Light rain': '小雨',
    'Light rain shower': '小阵雨',
    'Moderate rain': '中雨',
    'Heavy rain': '大雨',
    'Heavy rain shower': '大阵雨',
    'Torrential rain': '暴雨',
    'Patchy snow nearby': '局部有雪',
    'Light snow': '小雪',
    'Moderate snow': '中雪',
    'Heavy snow': '大雪',
    'Light sleet': '小冻雨',
    'Moderate or heavy sleet': '冻雨',
    'Patchy light snow': '零星小雪',
    'Thundery outbreaks': '雷阵雨',
    'Thundery outbreaks possible': '可能有雷阵雨',
    'Light drizzle': '毛毛雨',
    'Patchy light drizzle': '零星小雨',
    'Haze': '霾',
    'Smoke': '烟霾',
    'Windy': '大风',
  }
  const lower = desc.toLowerCase()
  if (map[desc]) return map[desc]
  for (const [en, zh] of Object.entries(map)) {
    if (lower.includes(en.toLowerCase())) return zh
  }
  return desc
}

function formatDate(d: Date): string {
  const weekdays = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六']
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 ${weekdays[d.getDay()]} ${hh}:${mm}`
}

/** New-session hero: AgentLex-style welcome with date, weather and greeting. */
export function AgentLexHeroMark(_props: { size?: number; className?: string }): React.JSX.Element {
  const config = useSkinConfig()
  const [now, setNow] = useState(() => new Date())
  const [weather, setWeather] = useState<string | null>(null)
  const [weatherTemp, setWeatherTemp] = useState<string | null>(null)

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    let cancelled = false
    fetch('https://wttr.in/?format=j1')
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return
        const cc = data?.current_condition?.[0]
        if (cc) {
          setWeather(translateWeather(cc.weatherDesc?.[0]?.value ?? ''))
          setWeatherTemp(`${cc.temp_C}°C`)
        }
      })
      .catch(() => { /* silently ignore — weather is non-critical */ })
    return () => { cancelled = true }
  }, [])

  const userName = config.userName?.trim() || 'User'
  const dateTimeText = formatDate(now)
  const greetingText = `${greeting()}，${userName}`
  const subtitle = welcomeLine(config.theme, now)

  return (
    <div
      className="agentlex-hero-welcome"
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        alignSelf: 'center',
        justifySelf: 'center',
        boxSizing: 'border-box',
        width: '100%',
        minWidth: 0,
        maxWidth: 640,
        overflow: 'hidden',
        gap: 8,
        padding: '8px 4px',
      }}
    >
      <div
        className="agentlex-hero-meta"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexWrap: 'wrap',
          gap: 8,
          fontFamily: 'var(--dsw-font-family, system-ui, sans-serif)',
          fontSize: 12,
          color: 'var(--dsw-alias-label-tertiary)',
        }}
      >
        <span>{dateTimeText}</span>
        {weather && weatherTemp && (
          <>
            <span style={{ opacity: 0.5 }}>|</span>
            <span>{weather} {weatherTemp}</span>
          </>
        )}
      </div>
      <div
        className="agentlex-hero-greeting"
        style={{
          fontFamily: 'var(--dsw-font-family, system-ui, sans-serif)',
          fontSize: 32,
          fontWeight: 600,
          letterSpacing: '-0.02em',
          lineHeight: 1.2,
          whiteSpace: 'nowrap',
          maxWidth: '100%',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
      >
        {greetingText}
      </div>
      <div
        className="agentlex-hero-subtitle"
        style={{
          fontFamily: 'var(--dsw-font-family, system-ui, sans-serif)',
          fontSize: 15,
          fontWeight: 500,
          color: 'var(--dsw-alias-label-secondary)',
        }}
      >
        {subtitle}
      </div>
    </div>
  )
}
