/**
 * AgentLex NewCaseModal — Manual case registration (v1.2.1).
 *
 * AI 智能注册模式已移除，仅保留手动注册表单。表单只采集核心卡片信息，
 * 法院/法官/标的额/立案日期/概述交给注册后的 agent 会话按 SOP 补全。
 */

import { memo, useState, useCallback, useEffect, useMemo } from 'react';
import { X, FolderOpen } from 'lucide-react';
import { isTauriEnvironment } from '@/utils/browserMock';
import { listenWithCleanup } from '@/utils/tauriListen';
import { pickDirectoryPath } from '@/utils/directoryPicker';
import CustomSelect from '@/components/CustomSelect';
import TagInput from '@/components/agentlex/TagInput';
import type { CaseEntry } from '@/hooks/useAgentLex';
import { CASE_TYPES, CASE_CAUSES } from '@/utils/caseTypes';
import { TAG_PRESETS } from '@/utils/caseTags';
import { partyRoleForOurSide } from '@/utils/caseFormat';

interface NewCaseModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: CaseFormData) => void;
  /** Existing cases for auto-ID generation */
  existingCases?: CaseEntry[];
}

export type OurSide = 'plaintiff' | 'applicant' | 'defendant' | 'respondent' | 'appellant' | 'appellee' | 'executionApplicant' | 'executionRespondent' | 'unknown';

export interface CaseFormData {
  caseId: string;
  caseNumber: string;
  name: string;
  type: string;
  cause: string;
  folder: string;
  plaintiff: string;
  defendant: string;
  appellant: string;
  appellee: string;
  ourSide: OurSide;
  tags: string[];
}

const TYPE_LABELS = CASE_TYPES.filter(t => t.key !== '__all').map(t => t.key);

/** 我方立场下拉选项（原告/申请人、被告/被申请人 各自独立列，含执行程序主体）。 */
const OUR_SIDE_OPTIONS: { value: OurSide; label: string }[] = [
  { value: 'plaintiff', label: '原告' },
  { value: 'applicant', label: '申请人' },
  { value: 'defendant', label: '被告' },
  { value: 'respondent', label: '被申请人' },
  { value: 'appellant', label: '上诉人' },
  { value: 'appellee', label: '被上诉人' },
  { value: 'executionApplicant', label: '申请执行人' },
  { value: 'executionRespondent', label: '被执行人' },
  { value: 'unknown', label: '待确认' },
];

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
  isOpen, onClose, onSubmit, existingCases,
}: NewCaseModalProps) {
  const [form, setForm] = useState<CaseFormData>({
    caseId: '', caseNumber: '', name: '', type: '民商', cause: '', folder: '',
    plaintiff: '', defendant: '', appellant: '', appellee: '', ourSide: 'unknown', tags: [],
  });

  // Aggregate tag pool from existing cases for autocomplete.
  const tagSuggestions = useMemo(
    () => [...new Set((existingCases ?? []).flatMap(c => c.tags ?? []))].sort((a, b) => a.localeCompare(b)),
    [existingCases],
  );

  // Auto-generate case ID on open
  useEffect(() => {
    if (isOpen) {
      setForm(prev => ({
        ...prev,
        caseId: generateCaseId(existingCases ?? []),
      }));
    }
  }, [isOpen, existingCases]);

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
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.caseId || !form.name) return;
    onSubmit(form);
    onClose();
  };

  const update = (field: keyof CaseFormData, value: string) => {
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

            {/* Parties — 含上诉人/被上诉人 */}
            <div>
              <label className="block text-xs font-medium text-[var(--ink-muted)] mb-1">当事人</label>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <input type="text" value={form.plaintiff} onChange={e => update('plaintiff', e.target.value)}
                    placeholder={partyRoleForOurSide(form.ourSide).first} className={inputCls} />
                </div>
                <div>
                  <input type="text" value={form.defendant} onChange={e => update('defendant', e.target.value)}
                    placeholder={partyRoleForOurSide(form.ourSide).second} className={inputCls} />
                </div>
                <div>
                  <input type="text" value={form.appellant} onChange={e => update('appellant', e.target.value)}
                    placeholder="上诉人" className={inputCls} />
                </div>
                <div>
                  <input type="text" value={form.appellee} onChange={e => update('appellee', e.target.value)}
                    placeholder="被上诉人" className={inputCls} />
                </div>
              </div>
            </div>

            {/* Our side — 下拉 */}
            <div>
              <label className="block text-xs font-medium text-[var(--ink-muted)] mb-1">我方立场</label>
              <CustomSelect
                value={form.ourSide}
                options={OUR_SIDE_OPTIONS.map(o => ({ value: o.value, label: o.label }))}
                onChange={(value) => update('ourSide', value)}
              />
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

            {/* Submit */}
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={onClose}
                className="px-4 py-2 rounded-lg text-sm text-[var(--ink-muted)] hover:bg-[var(--paper-inset)]">
                取消
              </button>
              <button type="submit"
                className="px-4 py-2 rounded-lg bg-[var(--ink)] text-[var(--paper)] text-sm font-medium hover:opacity-90 disabled:opacity-50"
                disabled={!form.caseId || !form.name}>
                注册案件
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
});
