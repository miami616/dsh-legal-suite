/**
 * CaseBoard — 案件数据看板（默认收起，工具栏「案件看板」按钮展开）。
 * 律师关心的汇总数据：今年新收 / 总标的额 / 收费 / 在办·已结·归档 / 常年顾问 / 任务逾期 / 类型分布。
 * 全部基于 cases（含归档）计算，与当前筛选/归档开关无关。
 * 2026-08 重设计：由「深海军蓝霓虹控制台」改为主题化温暖面板（paper-elevated + 语义数字），
 * 随明暗主题切换；数字只在语义处上色（accent 新收 / success 已结·收费 / error 逾期 / warning 待办）。
 */
import { memo, useMemo } from 'react';
import type { ReactNode } from 'react';
import {
  Sparkles, X, TrendingUp, Scale, Briefcase, Check, Archive, AlertTriangle, ListChecks, Coins, Boxes, Building2,
} from 'lucide-react';
import type { CaseEntry } from '@/hooks/useAgentLex';
import { todayStr, parseAmountValue } from '@/utils/caseFormat';
import { normalizeCaseType, CASE_TYPE_DEFS } from '@/utils/caseTypes';
import { normalizeStatus } from '@/utils/caseStatus';

interface CaseBoardProps {
  cases: CaseEntry[];
  onClose: () => void;
}

interface MetricDef {
  icon: ReactNode;
  label: string;
  value: string;
  sub?: string;
  color: string; // 数字颜色（主题语义色 var / 中性 ink）
  dim?: boolean; // 数据未接入的占位卡
}

/** 大额标的压缩为 万/亿（看板用，避免溢出卡片）。 */
function fmtCompact(n: number): string {
  if (n >= 100000000) return `${(n / 100000000).toFixed(1)} 亿`;
  if (n >= 10000) return `${Math.round(n / 10000)} 万`;
  return n.toLocaleString('zh-CN');
}

function MetricCard({ m }: { m: MetricDef }) {
  return (
    <div className={`rounded-xl px-3.5 py-3 min-w-0 ${m.dim ? 'opacity-60' : 'bg-[var(--hover-bg)]'}`}>
      <div className="flex items-center gap-1.5 text-[var(--ink-muted)]">
        {m.icon}
        <span className="text-xs tracking-[0.14em] uppercase font-semibold truncate">{m.label}</span>
      </div>
      <p className="mt-1.5 text-2xl font-extrabold tabular-nums leading-none truncate" style={{ color: m.color }}>{m.value}</p>
      {m.sub && <p className="mt-1.5 text-xs text-[var(--ink-subtle)] truncate">{m.sub}</p>}
    </div>
  );
}

export default memo(function CaseBoard({ cases, onClose }: CaseBoardProps) {
  const year = String(new Date().getFullYear());

  const stats = useMemo(() => {
    const total = cases.length;
    const archived = cases.filter(c => c.archived).length;
    const active = cases.filter(c => normalizeStatus(c.status) !== 'closed').length;
    const closed = total - active;

    const yearNew = cases.filter(c => (c.filingDate || c.createdAt || '').slice(0, 4) === year);

    const amountOf = (list: CaseEntry[]) => list.reduce((s, c) => s + parseAmountValue(c.claimAmount), 0);
    const totalAmount = amountOf(cases);
    const yearNewAmount = amountOf(yearNew);
    const activeAmount = amountOf(cases.filter(c => normalizeStatus(c.status) !== 'closed'));
    const closedAmount = amountOf(cases.filter(c => normalizeStatus(c.status) === 'closed'));

    // 任务逾期 / 待办：基于全部案件的 taskGroups（含归档）。
    const today = todayStr();
    let overdueTasks = 0;
    let pendingTasks = 0;
    for (const c of cases) {
      for (const g of (Array.isArray(c.taskGroups) ? c.taskGroups : [])) {
        for (const t of g.tasks) {
          if (t.status !== 'done') {
            pendingTasks++;
            if (t.deadline && t.deadline < today) overdueTasks++;
          }
        }
      }
    }

    const typeDist = CASE_TYPE_DEFS
      .map(d => ({ key: d.key, label: d.label, dot: d.dot, count: cases.filter(c => normalizeCaseType(c.type) === d.key).length }))
      .filter(t => t.count > 0);

    // 收费 / 常年顾问（fee 自由字符串；retainerUnit 对接非诉常法项目名或手填）。
    const hasFee = cases.some(c => parseAmountValue(c.fee) > 0);
    const totalFee = cases.reduce((s, c) => s + parseAmountValue(c.fee), 0);
    const retainerCases = cases.filter(c => (c.retainerUnit ?? '').trim());
    const retainerCount = retainerCases.length;
    const retainerFee = retainerCases.reduce((s, c) => s + parseAmountValue(c.fee), 0);
    const unitCounts = new Map<string, number>();
    for (const c of retainerCases) {
      const u = (c.retainerUnit ?? '').trim();
      unitCounts.set(u, (unitCounts.get(u) ?? 0) + 1);
    }
    const retainerUnits = [...unitCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);

    return { total, archived, active, closed, yearNew, yearNewAmount, totalAmount, activeAmount, closedAmount, overdueTasks, pendingTasks, hasFee, totalFee, retainerCount, retainerFee, retainerUnits, typeDist };
  }, [cases, year]);

  const retainerPct = stats.total > 0 ? Math.round((stats.retainerCount / stats.total) * 100) : 0;

  const metrics: MetricDef[] = [
    { icon: <TrendingUp size={12} />, label: '今年新收', value: String(stats.yearNew.length), sub: `标的 ${fmtCompact(stats.yearNewAmount)} 元`, color: 'var(--accent-warm)' },
    { icon: <Scale size={12} />, label: '总标的额', value: fmtCompact(stats.totalAmount), sub: `在办 ${fmtCompact(stats.activeAmount)} · 已结 ${fmtCompact(stats.closedAmount)}`, color: 'var(--ink)' },
    { icon: <Coins size={12} />, label: '收费情况', value: stats.hasFee ? `${fmtCompact(stats.totalFee)} 元` : '未录入', sub: stats.hasFee ? `常年顾问 ${fmtCompact(stats.retainerFee)} 元` : '在案件详情页填写收费金额', color: 'var(--success)', dim: !stats.hasFee },
    { icon: <Briefcase size={12} />, label: '在办案件', value: String(stats.active), color: 'var(--ink-secondary)' },
    { icon: <Check size={12} />, label: '已结', value: String(stats.closed), color: 'var(--success)' },
    { icon: <Archive size={12} />, label: '归档', value: String(stats.archived), color: 'var(--ink-subtle)' },
    { icon: <Building2 size={12} />, label: '常年顾问', value: String(stats.retainerCount), sub: `占全部 ${retainerPct}%`, color: 'var(--ink)' },
    { icon: <AlertTriangle size={12} />, label: '逾期任务', value: String(stats.overdueTasks), color: 'var(--error)' },
    { icon: <ListChecks size={12} />, label: '待办任务', value: String(stats.pendingTasks), color: 'var(--warning)' },
  ];

  return (
    <div className="relative overflow-hidden rounded-2xl border border-[var(--line-subtle)] bg-[var(--paper-elevated)] shadow-sm">
      <div className="relative p-5 space-y-4">
        <div className="flex items-center gap-2">
          <Sparkles size={14} className="text-[var(--accent-warm)]" />
          <h3 className="text-xs font-semibold tracking-[0.3em] text-[var(--ink-muted)] uppercase">案件看板 · Case Telemetry</h3>
          <span className="ml-auto flex items-center gap-1.5 font-mono text-xs text-[var(--ink-subtle)]">
            <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent-warm)] animate-pulse" aria-hidden />
            {year}
          </span>
          <button onClick={onClose} title="收起" className="p-1 rounded text-[var(--ink-subtle)] hover:text-[var(--ink)] hover:bg-[var(--paper-inset)] transition-colors"><X size={14} /></button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          {metrics.map(m => <MetricCard key={m.label} m={m} />)}
        </div>

        {stats.typeDist.length > 0 && (
          <div className="rounded-xl bg-[var(--hover-bg)] px-4 py-3">
            <div className="flex items-center gap-1.5 text-[var(--ink-muted)]">
              <Boxes size={12} />
              <span className="text-xs tracking-[0.14em] uppercase font-semibold">案件类型分布</span>
            </div>
            <div className="flex gap-5 mt-3 flex-wrap">
              {stats.typeDist.map(t => (
                <div key={t.key} className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ background: t.dot }} aria-hidden />
                  <span className="text-xs text-[var(--ink-muted)]">{t.label}</span>
                  <span className="text-sm font-bold text-[var(--ink-secondary)] tabular-nums">{t.count}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {stats.retainerUnits.length > 0 && (
          <div className="rounded-xl bg-[var(--hover-bg)] px-4 py-3">
            <div className="flex items-center gap-1.5 text-[var(--ink-muted)]">
              <Building2 size={12} />
              <span className="text-xs tracking-[0.14em] uppercase font-semibold">顾问单位分布</span>
            </div>
            <div className="flex gap-5 mt-3 flex-wrap">
              {stats.retainerUnits.map(([name, count]) => (
                <div key={name} className="flex items-center gap-2">
                  <span className="text-xs text-[var(--ink-muted)] max-w-[220px] truncate">{name}</span>
                  <span className="text-sm font-bold text-[var(--ink-secondary)] tabular-nums">{count}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
});
