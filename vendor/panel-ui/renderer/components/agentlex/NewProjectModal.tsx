/**
 * NewProjectModal — create a non-litigation project (v1.1.0).
 *
 * Two project types: 常法（retainer）and 专项（special）.
 * After creation, the system auto-generates initial task groups and timeline
 * events based on the project type.
 */

import { memo, useState, useEffect, useRef, useMemo } from 'react';
import { X, FolderOpen } from 'lucide-react';
import { pickDirectoryPath } from '@/utils/directoryPicker';
import { useAgentLex, type ProjectEntry, type ProjectType } from '@/hooks/useAgentLex';
import TagInput from '@/components/agentlex/TagInput';
import { TAG_PRESETS } from '@/utils/caseTags';

export interface ProjectFormData {
  projectId: string;
  name: string;
  projectType: ProjectType;
  servicePeriod: { start: string; end: string };
  serviceScope: string[];
  leadLawyer: string;
  team: string[];
  contractAmount: string;
  folder: string;
}

interface NewProjectModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: ProjectFormData) => void;
  existingProjects: ProjectEntry[];
}

const SERVICE_OPTIONS = [
  { value: 'review', label: '合同审查' },
  { value: 'draft-contract', label: '合同起草' },
  { value: 'regulation-review', label: '规章制度审查' },
  { value: 'opinion', label: '法律意见书' },
  { value: 'lawyer_letter', label: '律师函' },
  { value: 'other', label: '其他文书' },
];

// Generate initial task groups based on project type
function generateInitialTaskGroups(projectType: ProjectType) {
  const now = new Date().toISOString();
  if (projectType === 'retainer') {
    return [
      {
        id: `tg-retainer-service-${Date.now()}`,
        title: '月度服务',
        order: 0,
        tasks: [],
        createdAt: now,
        updatedAt: now,
      },
      {
        id: `tg-retainer-extra-${Date.now()}`,
        title: '临时事务',
        order: 1,
        tasks: [],
        createdAt: now,
        updatedAt: now,
      },
      {
        id: `tg-retainer-summary-${Date.now()}`,
        title: '年度总结',
        order: 2,
        tasks: [],
        createdAt: now,
        updatedAt: now,
      },
    ];
  }
  // special
  return [
    {
      id: `tg-dd-prep-${Date.now()}`,
      title: '尽调准备',
      order: 0,
      tasks: [
        {
          id: `task-prep-1-${Date.now()}`,
          title: '组建项目团队',
          status: 'todo' as const,
          priority: 'high' as const,
          subtasks: [],
          checklist: [],
          createdAt: now,
          updatedAt: now,
        },
        {
          id: `task-prep-2-${Date.now()}`,
          title: '制定尽调清单',
          status: 'todo' as const,
          priority: 'high' as const,
          subtasks: [],
          checklist: [],
          createdAt: now,
          updatedAt: now,
        },
      ],
      createdAt: now,
      updatedAt: now,
    },
    {
      id: `tg-dd-field-${Date.now()}`,
      title: '现场尽调',
      order: 1,
      tasks: [],
      createdAt: now,
      updatedAt: now,
    },
    {
      id: `tg-dd-report-${Date.now()}`,
      title: '报告撰写',
      order: 2,
      tasks: [],
      createdAt: now,
      updatedAt: now,
    },
    {
      id: `tg-dd-review-${Date.now()}`,
      title: '审核定稿',
      order: 3,
      tasks: [],
      createdAt: now,
      updatedAt: now,
    },
  ];
}

export default memo(function NewProjectModal({
  isOpen, onClose, onSubmit, existingProjects,
}: NewProjectModalProps) {
  const { addProject, addProjectTimelineEvent } = useAgentLex();
  const [name, setName] = useState('');
  const [projectType, setProjectType] = useState<ProjectType>('retainer');
  const [serviceStart, setServiceStart] = useState('');
  const [serviceEnd, setServiceEnd] = useState('');
  const [serviceScope, setServiceScope] = useState<string[]>([]);
  const [leadLawyer, setLeadLawyer] = useState('');
  const [teamStr, setTeamStr] = useState('');
  const [contractAmount, setContractAmount] = useState('');
  const [folder, setFolder] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const nameRef = useRef<HTMLInputElement>(null);
  useEffect(() => { if (isOpen) setTimeout(() => nameRef.current?.focus(), 50); }, [isOpen]);

  const tagSuggestions = useMemo(
    () => [...new Set(existingProjects.flatMap(p => p.tags ?? []))].sort((a, b) => a.localeCompare(b)),
    [existingProjects],
  );

  if (!isOpen) return null;

  const genProjectId = () => {
    const typePrefix = projectType === 'retainer' ? 'CF' : 'ZX';
    const year = new Date().getFullYear();
    const existing = existingProjects.filter(p => p.projectId.startsWith(`${typePrefix}-${year}`));
    const nextNum = existing.reduce((max, p) => {
      const match = p.projectId.match(/-(\d+)$/);
      return match ? Math.max(max, parseInt(match[1], 10)) : max;
    }, 0) + 1;
    return `${typePrefix}-${year}-${String(nextNum).padStart(3, '0')}`;
  };

  const handleSubmit = async () => {
    if (!name.trim()) return;
    setSubmitting(true);
    try {
      const projectId = genProjectId();
      const now = new Date().toISOString();
      const team = teamStr.split(/[,，、]/).map(s => s.trim()).filter(Boolean);

      const taskGroups = generateInitialTaskGroups(projectType);

      const entry: ProjectEntry = {
        projectId,
        name: name.trim(),
        projectType,
        status: 'active',
        servicePeriod: { start: serviceStart || now.slice(0, 10), end: serviceEnd || '' },
        serviceScope: serviceScope.map(v => SERVICE_OPTIONS.find(o => o.value === v)?.label ?? v),
        leadLawyer,
        team,
        contractAmount,
        folder,
        keyDates: [],
        boundSessions: [],
        taskGroups,
        linkedContracts: [],
        linkedResearch: [],
        tags,
        createdAt: now,
        updatedAt: now,
      };

      await addProject(entry);

      // Close modal immediately — timeline event is secondary
      onSubmit({ projectId, name: name.trim(), projectType, servicePeriod: { start: serviceStart || now.slice(0, 10), end: serviceEnd || '' }, serviceScope, leadLawyer, team, contractAmount, folder });

      // Auto-generate initial timeline events (best-effort)
      if (serviceEnd) {
        addProjectTimelineEvent({
          id: '',
          caseId: projectId,
          caseName: name.trim(),
          type: 'deadline',
          label: projectType === 'retainer' ? '服务到期' : '项目截止',
          date: serviceEnd,
          source: 'agent',
          status: 'pending',
          remindRules: [{ type: 'before_event', minutes: 10080, enabled: true }],
          createdAt: now,
          createdBy: '诉讼管家',
          updatedAt: now,
        }).catch(() => {});
      }

    } finally {
      setSubmitting(false);
    }
  };

  // 绑定项目文件夹：DSH web 走插件 client 发布的原生目录选择桥，桌面端仍用
  // Tauri 对话框；不可用时用户可留空稍后绑定。
  const handleBindFolder = async () => {
    try {
      const selected = await pickDirectoryPath('选择项目文件夹', folder);
      if (selected && typeof selected === 'string') setFolder(selected);
    } catch (e) { console.warn('[NewProjectModal] Folder picker:', e); }
  };

  const toggleScope = (v: string) => {
    setServiceScope(prev => prev.includes(v) ? prev.filter(x => x !== v) : [...prev, v]);
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center" data-agentlex-modal="">
      <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-2xl bg-[var(--paper-elevated)] shadow-2xl border border-[var(--paper-inset)] p-6 space-y-4" data-agentlex-modal-box="">
        {/* Header */}
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-[var(--ink)]">新建非诉项目</h2>
          <button onClick={onClose} className="p-1 rounded-md hover:bg-[var(--paper-inset)] text-[var(--ink-muted)] hover:text-[var(--ink)] transition-colors">
            <X size={16} />
          </button>
        </div>

        {/* Project type */}
        <div>
          <label className="text-xs font-semibold text-[var(--ink-muted)] mb-1.5 block">项目类型</label>
          <div className="flex gap-2">
            <button type="button" onClick={() => setProjectType('retainer')}
              className={`flex-1 px-4 py-2.5 rounded-xl text-sm font-medium transition-all ${
                projectType === 'retainer'
                  ? 'bg-blue-50 text-blue-600 ring-2 ring-blue-200'
                  : 'bg-[var(--paper)] text-[var(--ink-muted)] hover:bg-[var(--paper-inset)]'
              }`}>
              常年法律顾问
            </button>
            <button type="button" onClick={() => setProjectType('special')}
              className={`flex-1 px-4 py-2.5 rounded-xl text-sm font-medium transition-all ${
                projectType === 'special'
                  ? 'bg-orange-50 text-orange-600 ring-2 ring-orange-200'
                  : 'bg-[var(--paper)] text-[var(--ink-muted)] hover:bg-[var(--paper-inset)]'
              }`}>
              专项法律服务
            </button>
          </div>
        </div>

        {/* Project name */}
        <div>
          <label className="text-xs font-semibold text-[var(--ink-muted)] mb-1.5 block">项目名称 *</label>
          <input ref={nameRef} type="text" value={name} onChange={e => setName(e.target.value)}
            placeholder={projectType === 'retainer' ? '例：XX集团2026年度常年法律顾问' : '例：XX公司并购尽职调查'}
            className="w-full px-3 py-2.5 rounded-xl bg-[var(--paper)] border border-[var(--paper-inset)] text-sm text-[var(--ink)] placeholder:text-[var(--ink-subtle)] outline-none focus:border-[var(--ink-subtle)]" />
        </div>

        {/* Service period */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-semibold text-[var(--ink-muted)] mb-1.5 block">开始日期</label>
            <input type="date" value={serviceStart} onChange={e => setServiceStart(e.target.value)}
              className="w-full px-3 py-2.5 rounded-xl bg-[var(--paper)] border border-[var(--paper-inset)] text-sm text-[var(--ink)] outline-none focus:border-[var(--ink-subtle)]" />
          </div>
          <div>
            <label className="text-xs font-semibold text-[var(--ink-muted)] mb-1.5 block">结束日期</label>
            <input type="date" value={serviceEnd} onChange={e => setServiceEnd(e.target.value)}
              className="w-full px-3 py-2.5 rounded-xl bg-[var(--paper)] border border-[var(--paper-inset)] text-sm text-[var(--ink)] outline-none focus:border-[var(--ink-subtle)]" />
          </div>
        </div>

        {/* Service scope */}
        <div>
          <label className="text-xs font-semibold text-[var(--ink-muted)] mb-1.5 block">服务范围</label>
          <div className="flex flex-wrap gap-1.5">
            {SERVICE_OPTIONS.map(o => (
              <button key={o.value} type="button" onClick={() => toggleScope(o.value)}
                className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                  serviceScope.includes(o.value)
                    ? 'bg-[var(--ink)] text-[var(--paper)]'
                    : 'bg-[var(--paper-inset)] text-[var(--ink-muted)] hover:bg-[var(--paper-elevated)]'
                }`}>
                {o.label}
              </button>
            ))}
          </div>
        </div>

        {/* Lead lawyer + team */}
        <div>
          <label className="text-xs font-semibold text-[var(--ink-muted)] mb-1.5 block">主办律师</label>
          <input type="text" value={leadLawyer} onChange={e => setLeadLawyer(e.target.value)}
            placeholder="主办律师姓名"
            className="w-full px-3 py-2.5 rounded-xl bg-[var(--paper)] border border-[var(--paper-inset)] text-sm text-[var(--ink)] placeholder:text-[var(--ink-subtle)] outline-none focus:border-[var(--ink-subtle)]" />
        </div>
        <div>
          <label className="text-xs font-semibold text-[var(--ink-muted)] mb-1.5 block">团队（用逗号分隔）</label>
          <input type="text" value={teamStr} onChange={e => setTeamStr(e.target.value)}
            placeholder="例：张三、李四、王五"
            className="w-full px-3 py-2.5 rounded-xl bg-[var(--paper)] border border-[var(--paper-inset)] text-sm text-[var(--ink)] placeholder:text-[var(--ink-subtle)] outline-none focus:border-[var(--ink-subtle)]" />
        </div>

        {/* Contract amount */}
        <div>
          <label className="text-xs font-semibold text-[var(--ink-muted)] mb-1.5 block">合同标的额（元）</label>
          <input type="text" value={contractAmount} onChange={e => setContractAmount(e.target.value)}
            placeholder="例：200000"
            className="w-full px-3 py-2.5 rounded-xl bg-[var(--paper)] border border-[var(--paper-inset)] text-sm text-[var(--ink)] placeholder:text-[var(--ink-subtle)] outline-none focus:border-[var(--ink-subtle)]" />
        </div>

        {/* Folder */}
        <div>
          <label className="text-xs font-semibold text-[var(--ink-muted)] mb-1.5 block">项目文件夹</label>
          <button type="button" onClick={handleBindFolder}
            className="w-full flex items-center gap-2 px-3 py-2.5 rounded-xl bg-[var(--paper)] border border-[var(--paper-inset)] text-sm text-[var(--ink-muted)] hover:text-[var(--ink)] hover:border-[var(--ink-subtle)] transition-all">
            <FolderOpen size={14} />
            <span className="flex-1 text-left truncate">{folder || '选择文件夹（可选）'}</span>
          </button>
        </div>

        {/* Tags */}
        <div>
          <label className="text-xs font-semibold text-[var(--ink-muted)] mb-1.5 block">标签（可选）</label>
          <div className="px-3 py-2 rounded-xl bg-[var(--paper)] border border-[var(--paper-inset)]">
            <TagInput
              value={tags}
              onChange={setTags}
              suggestions={tagSuggestions}
              presets={TAG_PRESETS}
              placeholder="高净值 / 异地 / 系列案…"
            />
          </div>
        </div>

        {/* Submit */}
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose}
            className="px-4 py-2 rounded-xl text-sm text-[var(--ink-muted)] hover:bg-[var(--paper-inset)] transition-colors">取消</button>
          <button type="button" onClick={handleSubmit} disabled={!name.trim() || submitting}
            className="px-5 py-2 rounded-xl bg-[var(--ink)] text-[var(--paper)] text-sm font-medium hover:opacity-90 disabled:opacity-40 transition-all">
            {submitting ? '创建中...' : '创建项目'}
          </button>
        </div>
      </div>
    </div>
  );
});
