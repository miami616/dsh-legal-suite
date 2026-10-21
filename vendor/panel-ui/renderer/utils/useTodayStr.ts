/**
 * 响应式「今天」（YYYY-MM-DD，本地时区）。
 *
 * 为什么不用模块级常量：TaskManager 曾经在模块顶层写 `const todayStr = localTodayStr()`，
 * 面板是常驻的 SPA 页面，用户很少刷新——跨过 0 点后这个值就永远停在昨天。结果：
 *   ① 昨天已过期的开庭/日程仍按「date >= todayStr」通过过滤，继续留在「未来日程」；
 *   ② 日历上「今天」的高亮圈停在昨天；
 *   ③ 而 daysUntil() 内部又用新的今天计算，于是同一条已过期的开庭被判成
 *      「≤3 天 → 紧急」，显示成红色（用户 2026-10-20 反馈 10/19 开庭仍红着）。
 *
 * 这里每次重新读本地日期，并在三种时机触发更新：定时轮询（跨 0 点）、
 * 页面重新可见、窗口重新获得焦点。轮询只是字符串比较，代价可以忽略。
 */
import { useEffect, useState } from 'react';
import { localTodayStr } from './taskAggregation';

/** 轮询间隔：跨 0 点最迟 30 秒内纠正，够用作息表上的日期切换。 */
const TICK_MS = 30_000;

export function useTodayStr(): string {
  const [today, setToday] = useState<string>(localTodayStr);

  useEffect(() => {
    const sync = () => {
      const next = localTodayStr();
      // 只在日期真的变了时 setState，避免每 30 秒触发一次整页重渲染。
      setToday(prev => (prev === next ? prev : next));
    };
    const timer = window.setInterval(sync, TICK_MS);
    const onVisible = () => { if (document.visibilityState === 'visible') sync(); };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', sync);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', sync);
    };
  }, []);

  return today;
}
