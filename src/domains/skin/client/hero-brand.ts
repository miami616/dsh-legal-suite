/**
 * 新会话 Hero：隐藏 DSH 原生品牌文案，只留 AgentLex 自己的问候。
 *
 * 空会话页的 Hero 由两段内容拼成：
 *   ① 我们注册到 `conversation.hero.brand.mark` 槽的 `AgentLexHeroMark`
 *      （日期时间 + 天气 + 按时段问候 + 副标题）；
 *   ② DSH 原生 HeroShell 自己写死的品牌文案 `探索未至之境` + `预览版` 徽标
 *      （不走槽，无法用「不注册」的方式去掉，只能盖）。
 * 本模块只摘掉 ②，① 原样保留。
 *
 * 选择器策略（别改成裸类名）：原生类名是宿主 CSS Module 生成物
 * （`pXSMma_titleGroup`，hash 随宿主构建变化），稳定锚点只有 `_titleGroup`
 * 后缀 —— 与皮肤其它地方用 `[class$="_body"]` / `[class$="_card"]` 同一套做法。
 * 再用 `:has(> [class$="_previewBadge"])` 把作用域收到「确实含原生预览徽标的
 * 那个 titleGroup」，避免误伤别处同名元素。
 *
 * 原生 Hero 里的工作区选择行是功能件（当前版本该页不渲染它），不做隐藏。
 */
export const HERO_BRAND_CSS = `
:is([class$="_titleGroup"]):has(> [class$="_previewBadge"]) {
  display: none !important;
}
`.trim()
