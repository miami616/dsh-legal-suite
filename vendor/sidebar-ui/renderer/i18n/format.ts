import { i18n } from './index';
import { isSupportedLocale, type SupportedLocale } from '../../shared/i18n';

export function currentSupportedLocale(): SupportedLocale {
  return isSupportedLocale(i18n.language) ? i18n.language : 'zh-CN';
}

export function formatAbsoluteDateTime(
  date: Date,
  locale: SupportedLocale = currentSupportedLocale(),
  now: Date = new Date(),
): string {
  const sameYear = date.getFullYear() === now.getFullYear();
  return new Intl.DateTimeFormat(locale, {
    ...(sameYear ? {} : { year: 'numeric' }),
    month: 'short',
    day: 'numeric',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
}

export function formatCalendarDate(
  date: Date,
  locale: SupportedLocale = currentSupportedLocale(),
): string {
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(date);
}

export function formatFutureDistance(
  deltaMs: number,
  locale: SupportedLocale = currentSupportedLocale(),
): string {
  const mins = Math.round(deltaMs / 60_000);
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'always' });
  if (mins < 1) {
    return locale === 'zh-CN' ? '不到 1 分钟' : 'less than 1 minute';
  }
  if (mins < 60) return rtf.format(mins, 'minute').replace(/^in /, '');
  const hours = Math.round(mins / 60);
  if (hours < 24) return rtf.format(hours, 'hour').replace(/^in /, '');
  const days = Math.round(hours / 24);
  return rtf.format(days, 'day').replace(/^in /, '');
}

export function formatPastRelativeTime(
  timestampMs: number,
  locale: SupportedLocale = currentSupportedLocale(),
  nowMs: number = Date.now(),
): string {
  if (!timestampMs) return '';
  const diff = nowMs - timestampMs;
  const mins = Math.floor(diff / 60_000);
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  if (mins < 1) return locale === 'zh-CN' ? '刚刚' : 'just now';
  if (mins < 60) return rtf.format(-mins, 'minute');
  const hours = Math.floor(mins / 60);
  if (hours < 24) return rtf.format(-hours, 'hour');
  const days = Math.floor(hours / 24);
  if (days < 7) return rtf.format(-days, 'day');
  return new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric' }).format(new Date(timestampMs));
}
