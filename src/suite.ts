// @ts-nocheck
import z from 'schemastery';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { syncShippedPreset } from './shared/preset-sync.ts';
export const name = 'dsh-legal-suite';
export const inject = ['webServer', 'settings'];
export const AGENTLEX_SUITE_SETTINGS_NS = 'agentlex-legal-suite' as const;
export const Config: Schemastery<Schemastery.ObjectS<{ enabled: boolean; userName: string; brandEn: string; brandZh: string }>, { enabled: boolean; userName: string; brandEn: string; brandZh: string }> = z.object({
    enabled: z.boolean().default(true),
    userName: z.string().default('User'),
    brandEn: z.string().default('AgentLex'),
    brandZh: z.string().default('超级律师助理'),
});
function sendJson(res, body) {
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(body));
}

/* ---------------- 适配器消化：跨域聚合 /api/agentlex/read ---------------- */
// 旧渲染层的组合注册表（cases + projects + schedules + timeline +
// standaloneTasks）在套件层聚合：经本机 webServer 调用三个插件的原生路由，
// 再归一为 legacy 形状。域内单条 legacy 路由已按域归位到各插件。
async function internalCall(ctx, path, body = {}) {
    const res = await fetch(`http://127.0.0.1:${ctx.webServer.port}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || json.success === false) {
        throw new Error(json.error ?? `internal route HTTP ${res.status}: ${path}`);
    }
    return json.data;
}

function toLegacyStatus(status) {
    if (status === 'doing') return 'in_progress';
    return String(status ?? 'todo');
}

function normalizeTask(task) {
    const t = { ...task };
    t.status = toLegacyStatus(t.status);
    if (Array.isArray(t.subtasks)) {
        t.subtasks = t.subtasks.map((s) => {
            const sub = { ...s };
            if (sub.done !== undefined && sub.status === undefined) {
                sub.status = sub.done === true ? 'done' : 'todo';
            }
            sub.status = toLegacyStatus(sub.status);
            return sub;
        });
    }
    return t;
}

function normalizeGroup(group) {
    const g = { ...group };
    if (g.name !== undefined && g.title === undefined) g.title = g.name;
    if (Array.isArray(g.tasks)) g.tasks = g.tasks.map((t) => normalizeTask(t));
    return g;
}

function toLegacyCase(record) {
    // 审级历程：前端依赖 instances 数组渲染审级历程面板。若 record 无
    // instances（或为空）但 level 有值，生成一个含当前审级的 instances，
    // 否则审级历程恒为空（即使 level 有值也不显示）。
    let instances = Array.isArray(record.instances) ? record.instances : [];
    if (instances.length === 0 && record.level) {
        instances = [{ level: record.level, status: record.status ?? 'pending' }];
    }
    return {
        ...record,
        instances,
        alias: Array.isArray(record.alias) ? record.alias : [],
        keyDates: Array.isArray(record.keyDates) ? record.keyDates : [],
        boundSessions: Array.isArray(record.boundSessions) ? record.boundSessions : [],
        linkedContracts: Array.isArray(record.linkedContracts) ? record.linkedContracts : [],
        linkedResearch: Array.isArray(record.linkedResearch) ? record.linkedResearch : [],
        taskGroups: Array.isArray(record.taskGroups) ? record.taskGroups : [],
        tags: Array.isArray(record.tags) ? record.tags : [],
    };
}

function toLegacyProject(record) {
    return {
        ...record,
        team: Array.isArray(record.team) ? record.team : [],
        serviceScope: Array.isArray(record.serviceScope) ? record.serviceScope : [],
        keyDates: Array.isArray(record.keyDates) ? record.keyDates : [],
        boundSessions: Array.isArray(record.boundSessions) ? record.boundSessions : [],
        taskGroups: Array.isArray(record.taskGroups) ? record.taskGroups : [],
        linkedContracts: Array.isArray(record.linkedContracts) ? record.linkedContracts : [],
        linkedResearch: Array.isArray(record.linkedResearch) ? record.linkedResearch : [],
        tags: Array.isArray(record.tags) ? record.tags : [],
    };
}

function toLegacySchedule(item) {
    return {
        id: String(item.id ?? ''),
        title: String(item.title ?? ''),
        date: String(item.date ?? ''),
        time: item.time === undefined ? undefined : String(item.time),
        caseId: item.caseId === undefined || item.caseId === null ? null : String(item.caseId),
        caseName: item.caseName === undefined ? undefined : String(item.caseName),
        priority: item.priority === undefined ? undefined : String(item.priority),
        completed: Boolean(item.completed ?? item.done ?? false),
        source: item.source === undefined ? 'manual' : String(item.source),
        createdAt: item.createdAt === undefined ? undefined : String(item.createdAt),
        reminderLeadMinutes: item.reminderLeadMinutes === undefined ? undefined : Number(item.reminderLeadMinutes),
        taskId: item.taskId === undefined ? undefined : String(item.taskId),
        externalId: item.externalId === undefined ? undefined : String(item.externalId),
        externalSystem: item.externalSystem === undefined ? undefined : String(item.externalSystem),
    };
}

function toLegacyTimelineEvent(event) {
    return {
        ...event,
        id: String(event.id ?? ''),
        caseId: String(event.caseId ?? ''),
        type: String(event.type ?? 'case_event'),
        date: String(event.date ?? ''),
        status: event.status === undefined ? 'pending' : String(event.status),
        remindRules: Array.isArray(event.remindRules) ? event.remindRules : [],
    };
}

function toLegacyStandaloneTask(task) {
    return {
        ...task,
        id: String(task.id ?? ''),
        title: String(task.title ?? ''),
        status: task.status === undefined ? 'todo' : String(task.status),
        priority: task.priority === undefined ? 'medium' : String(task.priority),
        subtasks: Array.isArray(task.subtasks) ? task.subtasks : [],
        checklist: Array.isArray(task.checklist) ? task.checklist : [],
    };
}
const require = createRequire(import.meta.url);
// 合包版：presets 已并入本包（presets/ 目录），不再从 dsh-legal-suite/litigation 等子包读取。
const PRESET_SOURCES = [
    { pkg: 'dsh-legal-suite', presets: ['litigation-manager'] },
    { pkg: 'dsh-legal-suite', presets: ['nonlitigation-manager'] },
];
async function ensureAgentPresets() {
    const home = process.env.DSH_HOME ?? join(homedir(), '.dsh');
    const userPresetRoot = join(home, '.agent-presets');
    let count = 0;
    for (const { pkg, presets } of PRESET_SOURCES) {
        let pkgRoot;
        try {
            pkgRoot = dirname(require.resolve(`${pkg}/package.json`));
        }
        catch {
            console.warn(`[agentlex-suite] ${pkg} not installed — skipping its presets`);
            continue;
        }
        for (const preset of presets) {
            const src = join(pkgRoot, 'presets', preset);
            const dst = join(userPresetRoot, preset);
            try {
                // 先清空旧目录再整目录复制（同步时把预设的 name 裸包名改写为本包
                // 绝对入口 URL，见 src/shared/preset-sync.ts）：避免历史残留（如
                // Finder 生成的 .DS_Store、半同步状态）导致 cp 叠加出损坏预设或
                // rmdir ENOTEMPTY（issue:「非诉管家 agent 预设提示错误」），同时
                // 修复「预设无法挂载：Cannot find package 'dsh-legal-suite'」。
                await syncShippedPreset(src, dst);
                count++;
            }
            catch (error) {
                console.warn(`[agentlex-suite] preset ${preset} install failed: ${error instanceof Error ? error.message : String(error)}`);
            }
        }
    }
    if (count > 0) console.log(`[agentlex-suite] ${count} agent preset(s) ready in ${userPresetRoot}`);
}
export function apply(ctx, config = {}) {
    // The full AgentLex 配置 lives under one settings namespace
    // 'agentlex-legal-suite', owned by the skin domain (full schema: theme,
    // module toggles, brand copy). This aggregate mount previously ALSO
    // `installSection`'d the same namespace with a small schema — under the
    // alpha2 harness `ctx.settings.installSection` fails LOUD on a duplicate
    // namespace, which aborted the SKIN domain's apply and dropped its
    // /api/agentlex-skin/config route (404). Fix: this mount no longer
    // registers the namespace; it only READS it per-request via the provider
    // (non-registering get) so /api/agentlex-suite/config stays live.
    const disposeRoute = ctx.webServer.register({
        kind: 'exact',
        path: '/api/agentlex-suite/config',
        handler: async (_req, res) => {
            const value = (ctx.settings.get(AGENTLEX_SUITE_SETTINGS_NS) || {});
            const v = (typeof value === 'object' && value !== null) ? value : {};
            sendJson(res, { success: true, data: {
                enabled: v.enabled ?? config.enabled ?? true,
                userName: v.userName ?? config.userName ?? 'User',
                brandEn: v.brandEn ?? config.brandEn ?? 'AgentLex',
                brandZh: v.brandZh ?? config.brandZh ?? '超级律师助理',
            } });
        },
    });
    ctx.effect(() => () => disposeRoute(), 'dsh-legal-suite: config route');

    // 跨域会话的工作区根：套件数据根（$DSH_HOME/agentlex）。
    const disposeDataDirRoute = ctx.webServer.register({
        kind: 'exact',
        path: '/api/agentlex-suite/data-dir',
        handler: async (_req, res) => {
            const home = process.env.DSH_HOME ?? join(homedir(), '.dsh');
            sendJson(res, { success: true, data: { dataDir: join(home, 'agentlex') } });
        },
    });
    ctx.effect(() => () => disposeDataDirRoute(), 'dsh-legal-suite: data-dir route');

    // 适配器消化：跨域聚合 legacy 注册表（/api/agentlex/read）。
    const disposeReadRoute = ctx.webServer.register({
        kind: 'exact',
        path: '/api/agentlex/read',
        handler: async (_req, res) => {
            try {
                const [caseReg, projectReg, taskList, timeline, schedules, itemLegacy] = await Promise.all([
                    internalCall(ctx, '/api/agentlex-case/read'),
                    internalCall(ctx, '/api/agentlex-nonlitigation/projects'),
                    internalCall(ctx, '/api/agentlex-task/tasks'),
                    internalCall(ctx, '/api/agentlex-case/events'),
                    internalCall(ctx, '/api/agentlex-case/schedules'),
                    internalCall(ctx, '/api/agentlex-item/legacy'),
                ]);
                // 统一事项：从 items.json 生成 timeline + taskGroups（数据源统一）。
                // ownerType（litigation/nonlitigation/standalone）区分同号案件/项目：
                // 案件只吃 litigation 归属的事项，项目只吃 nonlitigation（2026-09-04）。
                const itemTimeline = (itemLegacy?.timeline ?? {}) as Record<string, { ownerType?: string; [k: string]: unknown }>;
                const itemTaskGroups = (itemLegacy?.taskGroups ?? []) as Array<{ ownerId?: string; ownerType?: string; id: string; title: string; order: number; tasks: unknown[] }>;
                const cases = {};
                for (const [id, c] of Object.entries(caseReg.cases ?? {})) {
                    const legacy = toLegacyCase(c);
                    // 任务的 taskGroups 从统一事项生成（按 group 的 ownerId + ownerType 归属）。
                    const ownGroups = itemTaskGroups.filter((g) => String(g.ownerId ?? '') === id && (g.ownerType ?? 'litigation') === 'litigation');
                    if (ownGroups.length > 0) {
                        legacy.taskGroups = ownGroups.map((g) => normalizeGroup(g));
                    } else if (Array.isArray(legacy.taskGroups)) {
                        legacy.taskGroups = legacy.taskGroups.map((g) => normalizeGroup(g));
                    }
                    cases[id] = legacy;
                }
                const projects = {};
                for (const [id, p] of Object.entries(projectReg.projects ?? {})) {
                    const legacy = toLegacyProject(p);
                    // 非诉项目的 taskGroups 也从统一事项生成（只吃 nonlitigation 归属）。
                    const projGroups = itemTaskGroups.filter((g) => String(g.ownerId ?? '') === id && (g.ownerType ?? 'nonlitigation') === 'nonlitigation');
                    if (projGroups.length > 0) {
                        legacy.taskGroups = projGroups.map((g) => normalizeGroup(g));
                    } else if (Array.isArray(legacy.taskGroups)) {
                        legacy.taskGroups = legacy.taskGroups.map((g) => normalizeGroup(g));
                    }
                    projects[id] = legacy;
                }
                // timeline 从统一事项生成（替代 case-timeline.json）。
                // 按 ownerType 归属：案件只取 litigation；其余（非诉事件/独立）不进案件聚合。
                const timelineMap = {};
                for (const [eid, e] of Object.entries(itemTimeline)) {
                    if (e.ownerType !== undefined && e.ownerType !== '' && e.ownerType !== 'litigation') continue;
                    timelineMap[eid] = toLegacyTimelineEvent(e);
                }
                const standaloneMap = {};
                for (const t of taskList ?? []) {
                    const legacy = toLegacyStandaloneTask(t);
                    standaloneMap[legacy.id] = legacy;
                }
                sendJson(res, {
                    success: true,
                    data: {
                        cases,
                        projects,
                        schedules: (schedules ?? []).map((s) => toLegacySchedule(s)),
                        timeline: timelineMap,
                        standaloneTasks: standaloneMap,
                    },
                });
            } catch (error) {
                res.writeHead(400, { 'content-type': 'application/json; charset=utf-8' });
                res.end(JSON.stringify({
                    success: false,
                    error: error instanceof Error ? error.message : String(error),
                }));
            }
        },
    });
    ctx.effect(() => () => disposeReadRoute(), 'dsh-legal-suite: legacy /read aggregate');
    void ensureAgentPresets().catch((error) => console.warn('[agentlex-suite] preset install failed', error));
}
//# sourceMappingURL=index.js.map