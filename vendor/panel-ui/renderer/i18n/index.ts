import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

import { resolveEffectiveLocale, type SupportedLocale } from '../../shared/i18n';
import appEn from './locales/en-US/app.json';
import chatEn from './locales/en-US/chat.json';
import commonEn from './locales/en-US/common.json';
import launcherEn from './locales/en-US/launcher.json';
import settingsEn from './locales/en-US/settings.json';
import taskEn from './locales/en-US/task.json';
import appZh from './locales/zh-CN/app.json';
import chatZh from './locales/zh-CN/chat.json';
import commonZh from './locales/zh-CN/common.json';
import launcherZh from './locales/zh-CN/launcher.json';
import settingsZh from './locales/zh-CN/settings.json';
import taskZh from './locales/zh-CN/task.json';

export const resources = {
  'zh-CN': {
    app: appZh,
    chat: chatZh,
    common: commonZh,
    launcher: launcherZh,
    settings: settingsZh,
    task: taskZh,
  },
  'en-US': {
    app: appEn,
    chat: chatEn,
    common: commonEn,
    launcher: launcherEn,
    settings: settingsEn,
    task: taskEn,
  },
} as const;

export const DEFAULT_I18N_NAMESPACE = 'common';

export function getBrowserSystemLocale(): string | undefined {
  if (typeof navigator === 'undefined') return undefined;
  return navigator.languages?.[0] ?? navigator.language;
}

export function getInitialLocale(): SupportedLocale {
  const systemLocale = getBrowserSystemLocale();
  return systemLocale ? resolveEffectiveLocale('system', systemLocale) : 'zh-CN';
}

void i18n
  .use(initReactI18next)
  .init({
    resources,
    lng: getInitialLocale(),
    fallbackLng: 'zh-CN',
    defaultNS: DEFAULT_I18N_NAMESPACE,
    ns: ['common', 'app', 'settings', 'chat', 'launcher', 'task'],
    interpolation: {
      escapeValue: false,
    },
    react: {
      useSuspense: false,
    },
  });

export { i18n };
