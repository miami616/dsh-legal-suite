/**
 * InstanceForm — modal add/edit for a case's 审级历程 (procedural instance).
 *
 * Instances live on the case record (`instances[]`); this form patches them via
 * updateCase. Used by the 审级历程 card on the detail page.
 */
import { memo, useState } from 'react';
import { X } from 'lucide-react';
import CustomSelect from '@/components/CustomSelect';

export interface InstanceData {
  level: string;
  caseNo: string;
  court: string;
  plaintiff: string;
  defendant: string;
  judge?: string;
  filedAt?: string;
  result?: string;
}

const LEVEL_OPTS = ['一审', '二审', '再审', '劳动仲裁', '商事仲裁', '首次执行', '恢复执行'];

interface InstanceFormProps {
  initial?: InstanceData;
  onSubmit: (data: InstanceData) => void;
  onDelete?: () => void;
  onCancel: () => void;
}

const field = 'w-full px-2.5 py-1.5 rounded-lg bg-[var(--paper-elevated)] text-sm text-[var(--ink)] placeholder:text-[var(--ink-subtle)] outline-none ring-1 ring-[var(--paper-inset)] focus:ring-[var(--ink-subtle)]';
const label = 'block text-xs font-medium text-[var(--ink-muted)] mb-1';

export default memo(function InstanceForm({ initial, onSubmit, onDelete, onCancel }: InstanceFormProps) {
  const [level, setLevel] = useState(initial?.level ?? '一审');
  const [caseNo, setCaseNo] = useState(initial?.caseNo ?? '');
  const [court, setCourt] = useState(initial?.court ?? '');
  const [plaintiff, setPlaintiff] = useState(initial?.plaintiff ?? '');
  const [defendant, setDefendant] = useState(initial?.defendant ?? '');
  const [judge, setJudge] = useState(initial?.judge ?? '');
  const [filedAt, setFiledAt] = useState(initial?.filedAt ?? '');
  const [result, setResult] = useState(initial?.result ?? '');

  const canSubmit = caseNo.trim() !== '' || plaintiff.trim() !== '' || defendant.trim() !== '';

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={onCancel} />
      <div className="relative w-full max-w-lg bg-[var(--paper-elevated)] rounded-xl shadow-2xl border border-[var(--paper-inset)] overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--paper-inset)]">
          <h2 className="text-lg font-semibold text-[var(--ink)]">{initial ? '编辑审级' : '新增审级'}</h2>
          <button onClick={onCancel} className="p-1 rounded hover:bg-[var(--paper-inset)]"><X size={18} className="text-[var(--ink-muted)]" /></button>
        </div>
        <div className="p-5 space-y-3 max-h-[70vh] overflow-y-auto">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <span className={label}>审级</span>
              <CustomSelect size="sm" value={level} options={LEVEL_OPTS.map(v => ({ value: v, label: v }))} onChange={setLevel} />
            </div>
            <div>
              <span className={label}>案号</span>
              <input type="text" value={caseNo} onChange={e => setCaseNo(e.target.value)} placeholder="(2026)鲁01民初1号" className={field} />
            </div>
          </div>
          <div>
            <span className={label}>审理法院</span>
            <input type="text" value={court} onChange={e => setCourt(e.target.value)} placeholder="法院名称" className={field} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <span className={label}>原告/申请人</span>
              <input type="text" value={plaintiff} onChange={e => setPlaintiff(e.target.value)} className={field} />
            </div>
            <div>
              <span className={label}>被告/被申请人</span>
              <input type="text" value={defendant} onChange={e => setDefendant(e.target.value)} className={field} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <span className={label}>承办法官</span>
              <input type="text" value={judge} onChange={e => setJudge(e.target.value)} className={field} />
            </div>
            <div>
              <span className={label}>立案日期</span>
              <input type="date" value={filedAt} onChange={e => setFiledAt(e.target.value)} className={field} />
            </div>
          </div>
          <div>
            <span className={label}>结果</span>
            <textarea value={result} onChange={e => setResult(e.target.value)} rows={2} placeholder="判决/调解/撤诉等结果摘要" className={`${field} resize-none`} />
          </div>
        </div>
        <div className="flex items-center justify-between px-5 py-4 border-t border-[var(--paper-inset)]">
          <div>
            {initial && onDelete && (
              <button onClick={onDelete} className="px-3 py-1.5 rounded-lg text-xs font-medium text-red-500 hover:bg-red-50">删除该审级</button>
            )}
          </div>
          <div className="flex gap-2">
            <button onClick={onCancel} className="px-4 py-2 rounded-lg text-sm text-[var(--ink-muted)] hover:bg-[var(--paper-inset)]">取消</button>
            <button disabled={!canSubmit} onClick={() => onSubmit({ level, caseNo: caseNo.trim(), court: court.trim(), plaintiff: plaintiff.trim(), defendant: defendant.trim(), judge: judge.trim() || undefined, filedAt: filedAt || undefined, result: result.trim() || undefined })}
              className="px-4 py-2 rounded-lg bg-[var(--ink)] text-[var(--paper)] text-sm font-medium hover:opacity-90 disabled:opacity-50">
              {initial ? '保存' : '新增'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
});
