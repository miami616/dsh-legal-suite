/**
 * AgentLex NewCaseModal — Manual case registration (v1.2.1, 备忘录 #6).
 *
 * 两个提交模式：
 *  - 「智能注册」：落库后跳 agent 会话，由 agent 按 SOP 补全法院/法官/标的额/
 *    立案日期/概述等信息；
 *  - 「普通注册」：仅落库不跳会话，供纯手动登记。
 * 案件编号可编辑；用户手填后不被自动分配覆盖（备忘录 #8）。
 */

import { memo, useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { X, FolderOpen } from 'lucide-react';
import { isTauriEnvironment } from '@/utils/browserMock';
import { listenWithCleanup } from '@/utils/tauriListen';
import { pickDirectoryPath } from '@/utils/directoryPicker';
import CustomSelect from '@/components/CustomSelect';
import TagInput from '@/components/agentlex/TagInput';
import type { CaseEntry } from '@/hooks/useAgentLex';
import { CASE_TYPES, CASE_CAUSES } from '@/utils/caseTypes';
import { TAG_PRESETS } from '@/utils/caseTags';

interface NewCaseModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** 智能注册：落库后跳 agent 会话补全信息。可抛错（如编号冲突），错误在表单内展示。 */
  onSubmit: (data: CaseFormData) => Promise<void> | void;
  /** 普通注册：仅落库，不跳会话。可抛错（如编号冲突）。 */
  onSubmitPlain: (data: CaseFormData) => Promise<void> | void;
  /** Existing cases for auto-ID generation + 重复编号即时提醒 */
  existingCases?: CaseEntry[];
}


export interface CaseFormData {
  caseId: string;
  caseNumber: string;
  name: string;
  type: string;
  cause: string;
  folder: string;
  /** 当事人：我方/对方分组动态行（含角色，提交时组装 parties + 推导 ourSide）。 */
  partyRows: Array<{ side: 'our' | 'their'; role: string; name: string }>;
  tags: string[];
}

/** 当事人角色可选（编辑/新建共用：规范角色 + 常用序数变体）。 */
const PARTY_ROLE_OPTIONS = [
  '原告', '被告', '申请人', '被申请人', '上诉人', '被上诉人', '申请执行人', '被执行人', '第三人',
  '第一被申请人', '第二被申请人', '第三被申请人',
  '第一被告', '第二被告', '第三被告',
  '第一原告', '第二原告',
] as const;

const TYPE_LABELS = CASE_TYPES.filter(t => t.key !== '__all').map(t => t.key);

function generateCaseId(existingCases: CaseEntry[]): string {
  const year = String(new Date().getFullYear());
  const prefix = `${year}-`;
  const nums = existingCases
    .map(c => c.caseId)
    .filter(id => id.startsWith(prefix))
    .map(id => parseInt(id.split('-')[1] ?? '', 10))
    .filter(n => !isNaN(n));
  const next = nums.length > 0 ? Math.max(...nums) + 1 : 1;
  return `${year}-${String(next).padStart(3, '0')}`;
}


export default memo(function NewCaseModal({
  isOpen, onClose, onSubmit, onSubmitPlain, existingCases,
}: NewCaseModalProps) {
  const [form, setForm] = useState<CaseFormData>({
    caseId: '', caseNumber: '', name: '', type: '民商', cause: '', folder: '',
    partyRows: [
      { side: 'our', role: '', name: '' },
      { side: 'their', role: '', name: '' },
    ],
    tags: [],
  });

  // Aggregate tag pool from existing cases for autocomplete.
  const tagSuggestions = useMemo(
    () => [...new Set((existingCases ?? []).flatMap(c => c.tags ?? []))].sort((a, b) => a.localeCompare(b)),
    [existingCases],
  );

  // 自动分配编号（仅空时）；caseIdTouchedRef 防「手填被自动生成覆盖」（#8）。
  // 组件常驻挂载（关闭只返回 null），state 跨开合保留 → 关闭时重置 touched，
  // 重开时若仍空才重新自动分配；用户手填过的编号绝不因 existingCases 刷新而改写。
  const caseIdTouchedRef = useRef(false);

  useEffect(() => {
    if (isOpen) {
      setForm(prev => {
        if (caseIdTouchedRef.current) return prev
        if (prev.caseId !== undefined && prev.caseId.trim() !== '') return prev
        return { ...prev, caseId: generateCaseId(existingCases ?? []) }
      })
    } else {
      caseIdTouchedRef.current = false
      setSubmitError(null)
      setSubmitting(false)
    }
  }, [isOpen, existingCases])

  // ---- Folder picker ----
  // DSH web 下没有 Tauri 运行时：优先走插件 client 发布的 DSH 原生目录选择
  // 桥（workspaces.pickDirectory，宿主机器上的原生目录框），桌面端仍用 Tauri
  // 对话框。注意：isRemoteBackend() 在 web 模式下恒为 true（同源 Web 也被旧
  // 代码视为"远程"），若用它拦截会把 DSH web 的本地选择器一并禁掉——不再拦截；
  // 选择器不可用/取消时用户直接在手填输入框填写主机端路径。
  const handlePickFolder = useCallback(async () => {
    try {
      const selected = await pickDirectoryPath('选择案件文件夹', form.folder);
      if (selected !== null && selected !== '') {
        setForm(prev => ({ ...prev, folder: selected }));
      }
    } catch (e) { console.warn('[NewCaseModal] Folder picker:', e); }
  }, []);

  // ---- Tauri drag-drop listener（仅桌面端监听；web 下无此事件） ----
  useEffect(() => {
    if (!isTauriEnvironment() || !isOpen) return;
    const ac = new AbortController();
    void listenWithCleanup<{ paths: string[] }>('tauri://drag-drop', (event) => {
      const paths = event.payload.paths;
      if (paths.length > 0) {
        setForm(prev => ({ ...prev, folder: paths[0] }));
      }
    }, ac.signal);
    return () => ac.abort();
  }, [isOpen]);

  // ---- Manual form handlers ----
  const canSubmit = form.caseId !== '' && form.name !== '';
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // 编号重复即时提醒（基于已有案件；手填或自动号都提示）。
  const idTaken = (form.caseId !== '') && (existingCases ?? []).some(c => c.caseId === form.caseId);

  const doSubmit = async (mode: 'smart' | 'plain') => {
    if (!canSubmit || submitting) return;
    // 客户端先拦重复编号（服务器同样会拦截，双保险）。
    if (idTaken) {
      setSubmitError(`案件编号 ${form.caseId} 已存在，请更换编号后再注册`);
      return;
    }
    setSubmitting(true);
    setSubmitError(null);
    try {
      if (mode === 'smart') await onSubmit(form);
      else await onSubmitPlain(form);
      onClose();
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void doSubmit('smart');
  };

  const update = (field: keyof CaseFormData, value: string) => {
    if (field === 'caseId') caseIdTouchedRef.current = true
    setForm(prev => ({ ...prev, [field]: value }));
  };

  const inputCls = 'w-full px-3 py-2 rounded-lg bg-[var(--paper-inset)] text-[var(--ink)] text-sm placeholder:text-[var(--ink-subtle)] outline-none focus:ring-2 focus:ring-blue-400/30';

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center" data-agentlex-modal="">
      <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-lg bg-[var(--paper-elevated)] rounded-xl shadow-2xl border border-[var(--paper-inset)] overflow-hidden max-h-[90vh] flex flex-col" data-agentlex-modal-box="">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--paper-inset)] shrink-0">
          <h2 className="text-lg font-semibold text-[var(--ink)]">注册新案件</h2>
          <button onClick={onClose} className="p-1 rounded hover:bg-[var(--paper-inset)]">
            <X size={18} className="text-[var(--ink-muted)]" />
          </button>
        </div>

        {/* Body — scrollable */}
        <div className="overflow-y-auto flex-1">
          <form onSubmit={handleSubmit} className="p-5 space-y-4">
            {/* Case ID — 必填，可编辑 */}
            <div>
              <label className="block text-xs font-medium text-[var(--ink-muted)] mb-1">
                案件编号 <span className="text-red-400">*</span>
              </label>
              <input
                type="text"
                value={form.caseId}
                onChange={e => update('caseId', e.target.value)}
                placeholder="如: 2026-033"
                className={inputCls}
                required
              />
              {/* 重复编号即时提醒：绝不静默覆盖既有案件（备忘录 #8 后续要求） */}
              {idTaken && (
                <p className="mt-1.5 text-xs text-red-500">
                  编号 {form.caseId} 已被使用（{existingCases?.find(c => c.caseId === form.caseId)?.name}），请更换编号
                </p>
              )}
            </div>

            {/* Case Number + Name */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-[var(--ink-muted)] mb-1">法院案号</label>
                <input type="text" value={form.caseNumber} onChange={e => update('caseNumber', e.target.value)}
                  placeholder="如: (2026)鲁01民初123号"
                  className={inputCls} />
              </div>
              <div>
                <label className="block text-xs font-medium text-[var(--ink-muted)] mb-1">
                  案件名称 <span className="text-red-400">*</span>
                </label>
                <input type="text" value={form.name} onChange={e => update('name', e.target.value)}
                  placeholder="如: 张三诉李四合同纠纷"
                  className={inputCls} required />
              </div>
            </div>

            {/* Type + Cause */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-[var(--ink-muted)] mb-1">案件类型</label>
                <CustomSelect value={form.type}
                  options={TYPE_LABELS.map(t => ({ value: t, label: t }))}
                  onChange={(value) => { update('type', value); update('cause', ''); }} />
              </div>
              <div>
                <label className="block text-xs font-medium text-[var(--ink-muted)] mb-1">案由</label>
                <CustomSelect value={form.cause}
                  options={(CASE_CAUSES[form.type] || CASE_CAUSES['其他']).map(c => ({ value: c, label: c }))}
                  onChange={(value) => update('cause', value)} />
              </div>
            </div>

            {/* Tags */}
            <div>
              <label className="block text-xs font-medium text-[var(--ink-muted)] mb-1">标签（可选）</label>
              <div className="px-3 py-2 rounded-lg bg-[var(--paper-inset)]">
                <TagInput
                  value={form.tags}
                  onChange={tags => setForm(prev => ({ ...prev, tags }))}
                  suggestions={tagSuggestions}
                  presets={TAG_PRESETS}
                  placeholder="高净值 / 异地 / 系列案…"
                />
              </div>
            </div>

            {/* 当事人：我方 / 对方 两组动态行（角色下拉 + 姓名，可增删） */}
            <div className="space-y-3">
              {([
                { side: 'our' as const, title: '我方当事人' },
                { side: 'their' as const, title: '对方当事人' },
              ]).map(group => {
                const rows = form.partyRows.filter(r => r.side === group.side);
                const setRow = (localIdx: number, patch: Partial<{ role: string; name: string }>) => {
                  const globalStart = form.partyRows.findIndex(r => r.side === group.side);
                  setForm(prev => {
                    const next = [...prev.partyRows];
                    const gi = globalStart + localIdx;
                    next[gi] = { ...next[gi], ...patch };
                    return { ...prev, partyRows: next };
                  });
                };
                const addRow = () => {
                  setForm(prev => ({ ...prev, partyRows: [...prev.partyRows, { side: group.side, role: '', name: '' }] }));
                };
                const removeRow = (localIdx: number) => {
                  if (rows.length <= 1) return; // 至少保留一行
                  const globalStart = form.partyRows.findIndex(r => r.side === group.side);
                  setForm(prev => ({ ...prev, partyRows: prev.partyRows.filter((_, gi) => gi !== globalStart + localIdx) }));
                };
                return (
                  <div key={group.side}>
                    <div className="flex items-center justify-between">
                      <label className="block text-xs font-medium text-[var(--ink-muted)]">{group.title}</label>
                      <button type="button" onClick={addRow}
                        className="text-xs text-[var(--ink-muted)] hover:text-[var(--ink)] px-1 py-0.5">＋ 添加当事人</button>
                    </div>
                    <div className="space-y-1.5 mt-1">
                      {rows.map((row, ri) => (
                        <div key={`${group.side}-${ri}`} className="flex items-center gap-2">
                          <CustomSelect
                            value={row.role}
                            placeholder="角色"
                            options={PARTY_ROLE_OPTIONS.map(o => ({ value: o, label: o }))}
                            onChange={v => setRow(ri, { role: v })}
                            size="sm"
                            className="w-[160px] shrink-0"
                          />
                          <input type="text" value={row.name} onChange={e => setRow(ri, { name: e.target.value })}
                            placeholder={group.side === 'our' ? '我方当事人名称' : '对方名称'}
                            className={`flex-1 min-w-0 ${inputCls}`} />
                          {rows.length > 1 && (
                            <button type="button" onClick={() => removeRow(ri)}
                              className="shrink-0 p-1 rounded text-[var(--ink-subtle)] hover:text-red-500" title="删除">
                              <X size={13} />
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Folder */}
            <div>
              <label className="block text-xs font-medium text-[var(--ink-muted)] mb-1">案件文件夹（可选）</label>
              <div className="flex items-center gap-2">
                <input type="text" value={form.folder} onChange={e => update('folder', e.target.value)}
                  placeholder="选择案件文件夹路径..."
                  className={`flex-1 ${inputCls}`} />
                <button type="button" onClick={handlePickFolder}
                  className="p-2 rounded-lg bg-[var(--paper-inset)] hover:bg-[var(--paper)] text-[var(--ink-muted)]" title="浏览文件夹">
                  <FolderOpen size={16} />
                </button>
              </div>
              <p className="text-xs text-[var(--ink-subtle)] mt-1">
                文件夹可在 SynologyDrive 上的诉讼目录中选择，也可留空稍后绑定
              </p>
            </div>

            {/* 提交错误（如编号冲突/服务器拒绝）—— 弹窗保持打开，不覆盖数据 */}
            {submitError && (
              <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600" role="alert">
                {submitError}
              </div>
            )}

            {/* Submit */}
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={onClose}
                className="px-4 py-2 rounded-lg text-sm text-[var(--ink-muted)] hover:bg-[var(--paper-inset)]">
                取消
              </button>
              <button type="button" onClick={() => void doSubmit('plain')}
                className="px-4 py-2 rounded-lg bg-[var(--paper-inset)] text-[var(--ink)] text-sm font-medium hover:bg-[var(--paper)] disabled:opacity-50"
                disabled={!canSubmit || submitting || idTaken}>
                普通注册
              </button>
              <button type="submit"
                className="px-4 py-2 rounded-lg bg-[var(--ink)] text-[var(--paper)] text-sm font-medium hover:opacity-90 disabled:opacity-50"
                disabled={!canSubmit || submitting || idTaken}>
                {submitting ? '提交中…' : '智能注册'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
});
