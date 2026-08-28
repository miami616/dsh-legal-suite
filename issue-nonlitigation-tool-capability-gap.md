# Issue: 非诉管家工具层能力缺失，与诉讼管家不对齐

> **修复状态（2026-08-28）**：P0（工具层补齐）+ P1（关键日期后端补齐）已实现，typecheck 通过。
> - `src/domains/nonlitigation/tools.ts`：ACTIONS 从 5 扩到 23 个（任务树 11 + 关键日期 3 + 服务 3 + 导入 1 + 原有 5），`update_project` 已转发 `serviceScope`/`servicePeriod`/`summary`。
> - `src/domains/nonlitigation/store/project-store.ts`：新增 `upsertKeyDate`/`toggleKeyDate`/`deleteKeyDate`。
> - `src/domains/nonlitigation/routes.ts`：新增 `/keydate` `/toggle-keydate` `/delete-keydate` 路由。
> - `src/domains/nonlitigation/store/types.ts`：`keyDates` 类型补 `createdAt`/`updatedAt`。
> - 待办：本机新端口实测验证（按开发流程硬性规则，未验证前不 commit/push/publish）。

## 摘要

`dsh-legal-suite` 的非诉管家（`nonlitigation` Agent 工具）目前只暴露 5 个基础 action
（`list_projects` / `get_project` / `register_project` / `update_project` / `delete_project`），
而其后端 store + HTTP 路由**已经完整实现了诉讼管家那套任务树能力**，还多了诉讼没有的
「服务记录」库。由于工具层停留在 POC，后端已做好的能力全部未对模型开放，导致非诉管家
无法建任务组/排任务/勾检查项/记服务台账，也无法写入 `serviceScope` / `servicePeriod` / `summary`。

**结论：绝大多数差距在工具层（`tools.ts`），不在后端；补工具层即可在不改后端的前提下
让非诉管家获得与诉讼管家对等的任务树 + 台账能力。**

---

## 证据（已核对源码）

### 1. 后端路由已存在但未暴露
文件：`src/domains/nonlitigation/routes.ts`
```
/group            upsertTaskGroup
/delete-group     deleteTaskGroup
/reorder-groups   reorderTaskGroups
/task             upsertTask
/delete-task      deleteTask
/move-task        moveTask
/subtask          upsertSubtask
/delete-subtask   deleteSubtask
/add-checklist    addChecklistItem
/check            toggleChecklist
/delete-checklist deleteChecklistItem
/services         listServices
/service          upsertService
/delete-service   deleteService
/import           importFromAgentLex
```

### 2. 后端 store 方法已存在
文件：`src/domains/nonlitigation/store/project-store.ts`
- `upsertTaskGroup` / `deleteTaskGroup` / `reorderTaskGroups`
- `upsertTask` / `deleteTask` / `moveTask`
- `upsertSubtask` / `deleteSubtask`
- `addChecklistItem` / `toggleChecklist` / `deleteChecklistItem`

文件：`src/domains/nonlitigation/store/service-store.ts`
- `listServices` / `upsertService` / `deleteService`

### 3. 工具层只接了 5 个 action
文件：`src/domains/nonlitigation/tools.ts`
- `ACTIONS` 数组仅 5 项；`HTTP_ROUTE` 仅 5 条；`parameters` 仅有
  `projectId/name/projectType/status/leadLawyer/contractAmount/folder`。
- `execute` 中 `update_project` 只转发上述 6 个标量字段，**丢弃了**
  `serviceScope` / `servicePeriod` / `summary` / `keyDates` 等（后端 `updateProject`
  实际接受任意 patch，传了就能存）。

### 4. 对照：诉讼管家工具（`src/domains/litigation/tools.ts`）有 21 个 action
含 `upsert_group` / `upsert_task` / `upsert_subtask` / `upsert_check` / `toggle_check` /
`move_task` / `add_keydate` / `toggle_keydate` / `upsert_event` / `deadlines` 等，
参数含 `groupId/taskId/subtaskId/checklistId/label/date/deadline/priority` 等完整 id 链。

### 5. 关键日期存在真正后端缺口
`src/domains/nonlitigation/store/types.ts` 的 `ProjectRecord` 已预留
`keyDates?: Array<{ id; label; date; done? }>`，但 `project-store.ts` 没有任何读写方法，
`routes.ts` 也无对应路由。诉讼的 `add_keydate` / `toggle_keydate` 在此完全无对应物。

---

## 能力对照表

| 能力 | 诉讼管家 | 非诉后端 | 非诉工具层 | 状态 |
|---|---|:--:|:--:|---|
| 列表/查询 | list/get_case | ✅ | ✅ | 已对齐 |
| 登记/更新/删除 | register/update/delete_case | ✅ | ✅(缺字段转发) | 需补转发 |
| 任务组(阶段) | upsert/delete_group | ✅ | ❌ | 工具层缺失 |
| 任务 | upsert/delete/move_task | ✅ | ❌ | 工具层缺失 |
| 子任务 | upsert/delete_subtask | ✅ | ❌ | 工具层缺失 |
| 检查项 | upsert/toggle_check | ✅ | ❌ | 工具层缺失 |
| 关键日期 | add/toggle_keydate | ⚠️仅类型预留 | ❌ | **需补后端** |
| 时间轴 | event 系列 + list_events | ❌ | ❌ | 非诉可不同形态 |
| 期限汇总 | deadlines 引擎 | ❌ | ❌ | 非诉可轻量化 |
| 服务记录 | 无对应(诉讼没有) | ✅serviceStore | ❌ | 工具层缺失(非诉独有) |
| 导入 | 有 | ✅/import | ❌ | 工具层缺失 |

---

## 建议方案

### P0 — 工具层补齐（零后端风险，后端路由全在）
在 `src/domains/nonlitigation/tools.ts` 中：
1. 扩展 `ACTIONS` 与 `HTTP_ROUTE`，新增以下 action（路由名已与 `routes.ts` 核对）：
   - 任务树：`upsert_group` / `delete_group` / `reorder_groups` /
     `upsert_task` / `delete_task` / `move_task` /
     `upsert_subtask` / `delete_subtask` /
     `add_checklist` / `toggle_check` / `delete_checklist`
   - 服务记录：`list_services` / `upsert_service` / `delete_service`
   - 导入：`import_projects`
2. 新增参数：`groupId` / `groupName` / `taskId` / `taskTitle` / `deadline` / `priority` /
   `subtaskId` / `subtaskTitle` / `checklistId` / `checklistText` / `toGroupId` /
   `orderedIds` / `serviceId` / `kind` / `client` / `note` / `sourceDir` 等。
3. `execute` 中 `update_project` 增加 `serviceScope` / `servicePeriod` / `summary` 转发。

### P1 — 关键日期后端补齐（常法续约/年审提醒刚需）
- `project-store.ts` 增加 `upsertKeyDate` / `toggleKeyDate` / `deleteKeyDate`。
- `routes.ts` 增加 `/keydate` / `/toggle-keydate` / `/delete-keydate`。
- 工具层暴露 `add_keydate` / `toggle_keydate` / `delete_keydate`，对齐诉讼。

### P2 — 轻量期限汇总（可选，不必照搬诉讼引擎）
基于 `servicePeriod.end` + `task.deadline` + `keyDates` 提供 `deadlines` 风格汇总，
语义与诉讼的举证期/上诉期不同，做常法视角即可。

---

## 验收标准
- [x] 非诉管家可建/删任务组、建/删/移动任务、建/删/勾检查项（对话即可操作，UI 实时刷新）。
- [x] 非诉管家可登记/查询/删除服务记录（常法服务台账）。
- [x] `update_project` 可写入 `serviceScope` / `servicePeriod` / `summary`。
- [x] 关键日期可登记/提醒（P1）。
- [ ] 用 `CF-2026-001` 端到端验证一轮任务树 + 服务记录写入（待实测）。

---

## 备注（实施路径）
- `node_modules` 内的 `dsh-legal-suite` 为打包源码，本地改动能即时生效验证，但插件更新会被覆盖；
  稳妥做法是将改动落到插件源码仓库并走发布流程。
- 参考实现可直接对照 `src/domains/litigation/tools.ts` 的参数表与 `buildBody` 字段映射。
