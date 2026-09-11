#!/usr/bin/env bash
# E2E verification of 0.2.11 against the 3081 test instance (real HTTP routes).
# Creates a scratch case, exercises the fixed/added routes, then deletes it.
# Live data is snapshotted/restored by the caller.
set -uo pipefail
BASE=http://127.0.0.1:3081
JAR=/tmp/jar.txt
api() { # api <route> <json>
  curl -s -b "$JAR" -X POST "$BASE/api/agentlex-case/$1" -H 'content-type: application/json' -d "$2"
}
pass=0; fail=0
chk() { if [ "$2" = "1" ]; then echo "PASS  $1"; pass=$((pass+1)); else echo "FAIL  $1  ($3)"; fail=$((fail+1)); fi; }

CASE=$(api register-case '{"name":"[E2E] 期限链路验证案","type":"劳动争议","level":"劳动仲裁","status":"post_trial"}' | python3 -c 'import sys,json;print(json.load(sys.stdin)["data"]["caseId"])')
echo "scratch caseId=$CASE"

# ── Bug 1: upsert_event 的 eventId/id 不生效 ─────────────────────────
NEW=$(api event "{\"caseId\":\"$CASE\",\"title\":\"起诉期届满\",\"date\":\"2026-09-28\",\"type\":\"appeal_deadline\",\"status\":\"pending\"}")
EID=$(echo "$NEW" | python3 -c 'import sys,json;print(json.load(sys.stdin)["data"]["id"])')
api event "{\"caseId\":\"$CASE\",\"id\":\"$EID\",\"title\":\"起诉期届满（改名）\",\"date\":\"2026-09-28\",\"type\":\"appeal_deadline\"}" > /dev/null
# 建案会自动落「收案」事件，断言只看目标事件。
CNT=$(api events "{\"caseId\":\"$CASE\"}" | python3 -c 'import sys,json;print(sum(1 for e in json.load(sys.stdin)["data"] if str(e["title"]).startswith("起诉期届满")))')
chk "Bug1 传 id 更新既有事件（不新增）" "$([ "$CNT" = "1" ] && echo 1 || echo 0)" "matched=$CNT"
TITLE=$(api events "{\"caseId\":\"$CASE\"}" | python3 -c 'import sys,json;print([e["title"] for e in json.load(sys.stdin)["data"] if str(e["title"]).startswith("起诉期届满")][0])')
chk "Bug1 更新的是同一条（标题已变）" "$([ "$TITLE" = "起诉期届满（改名）" ] && echo 1 || echo 0)" "title=$TITLE"

# ── Bug 2: kind/eventType 落库 ──────────────────────────────────────
KIND=$(api events "{\"caseId\":\"$CASE\"}" | python3 -c 'import sys,json;print([e.get("type") for e in json.load(sys.stdin)["data"] if str(e["title"]).startswith("起诉期届满")][0])')
chk "Bug2 eventType 落库（appeal_deadline）" "$([ "$KIND" = "appeal_deadline" ] && echo 1 || echo 0)" "type=$KIND"

# ── 新路由：period-rules ────────────────────────────────────────────
RC=$(api period-rules '{"procedure":"劳动仲裁"}' | python3 -c 'import sys,json;print(json.load(sys.stdin)["data"]["count"])')
chk "period-rules 返回劳动仲裁规则" "$([ "$RC" -ge 3 ] && echo 1 || echo 0)" "count=$RC"

# ── 新路由：derive-deadline（只读预览） ─────────────────────────────
DR=$(api derive-deadline "{\"caseId\":\"$CASE\",\"doc\":\"仲裁裁决书\",\"serviceDate\":\"2026-09-11\",\"docKind\":\"非终局裁决\"}")
DUE=$(echo "$DR" | python3 -c 'import sys,json;print(json.load(sys.stdin)["data"]["matched"]["dueDate"])')
TERM=$(echo "$DR" | python3 -c 'import sys,json;print(json.load(sys.stdin)["data"]["matched"]["term"])')
chk "derive-deadline 派生 2026-09-28" "$([ "$DUE" = "2026-09-28" ] && echo 1 || echo 0)" "due=$DUE"
chk "derive-deadline 术语=起诉期届满" "$([ "$TERM" = "起诉期届满" ] && echo 1 || echo 0)" "term=$TERM"
CNT2=$(api events "{\"caseId\":\"$CASE\"}" | python3 -c 'import sys,json;print(len(json.load(sys.stdin)["data"]))')
KD2=$(api read-case "{\"caseId\":\"$CASE\"}" | python3 -c 'import sys,json;print(sum(1 for k in (json.load(sys.stdin)["data"].get("keyDates") or []) if k.get("ruleId")))')
chk "derive-deadline 不落库（无新事件、无派生关键日程）" "$([ "$CNT2" = "2" ] && [ "$KD2" = "0" ] && echo 1 || echo 0)" "events=$CNT2 derivedKeyDates=$KD2"

# ── 新路由：register-service（落三件套） ────────────────────────────
RS=$(api register-service "{\"caseId\":\"$CASE\",\"doc\":\"仲裁裁决书\",\"serviceDate\":\"2026-09-11\",\"docKind\":\"非终局裁决\"}")
TK=$(echo "$RS" | python3 -c 'import sys,json;print(len(json.load(sys.stdin)["data"]["applied"]["taskIds"]))')
chk "register-service 落 4 条提前量任务" "$([ "$TK" = "4" ] && echo 1 || echo 0)" "tasks=$TK"
KD=$(api read-case "{\"caseId\":\"$CASE\"}" | python3 -c '
import sys,json
d=json.load(sys.stdin)["data"]
kd=[k for k in (d.get("keyDates") or []) if k.get("ruleId")]
print((kd[0]["label"]+" "+kd[0]["date"]+" "+kd[0]["cite"]) if kd else "none")')
chk "register-service 关键日程带 ruleId/cite" "$(echo "$KD" | grep -q "起诉期届满 2026-09-28 劳动争议调解仲裁法 §50" && echo 1 || echo 0)" "$KD"

# ── 体检：期限登记后该项不再报缺口 ──────────────────────────────────
GAP=$(api case-health "{\"caseId\":\"$CASE\"}" | python3 -c '
import sys,json
d=json.load(sys.stdin)["data"]
print(sum(1 for g in d["completeness"]["gaps"] if g["field"]=="keyDate:裁判文书送达"))')
chk "case-health 已登记期限 → 期限项无缺口" "$([ "$GAP" = "0" ] && echo 1 || echo 0)" "gap=$GAP"

# ── 清理 ────────────────────────────────────────────────────────────
api delete-case "{\"caseId\":\"$CASE\"}" > /dev/null
LEFT=$(api read '{}' | python3 -c "import sys,json;print(sum(1 for c in json.load(sys.stdin)['data']['cases'].values() if c['caseId']=='$CASE'))")
chk "清理：临时案件已删除" "$([ "$LEFT" = "0" ] && echo 1 || echo 0)" "left=$LEFT"

echo
echo "== E2E: $pass passed, $fail failed =="
exit $([ "$fail" = "0" ] && echo 0 || echo 1)
