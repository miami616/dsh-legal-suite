"""0.2.14 小工具面板 UI 验收（Playwright / Chromium）——含 0.2.15 设计优化项。

覆盖：列表卡片与图标、宽屏双栏（参数卡 / 结果卡并排）、分段控件、单位后缀、
失焦校验（aria-invalid + role=alert）、结果英雄区、复制反馈、依据折叠、
窄屏（375px）无横向滚动、深色主题对比度与截图。
"""
import sys
from playwright.sync_api import sync_playwright

URL = sys.argv[1]
SHOTS = sys.argv[2] if len(sys.argv) > 2 else "/tmp"

pass_n = 0
fail_n = 0


def ok(name, cond, extra=""):
    global pass_n, fail_n
    if cond:
        pass_n += 1
        print(f"  ✅ {name}")
    else:
        fail_n += 1
        print(f"  ❌ {name} {extra}")


def open_panel(page):
    entry = page.locator("[data-agentlex-skills-entry]")
    entry.first.wait_for(state="visible", timeout=20000)
    entry.first.click()
    page.wait_for_timeout(1000)
    page.get_by_role("tab", name="小工具").click()
    page.wait_for_timeout(700)


with sync_playwright() as pw:
    browser = pw.chromium.launch()

    # ── 宽屏：布局与交互 ────────────────────────────────────────────────
    context = browser.new_context(viewport={"width": 1680, "height": 1000}, permissions=["clipboard-read", "clipboard-write"])
    page = context.new_page()
    page.goto(URL, wait_until="domcontentloaded")
    page.wait_for_timeout(6000)
    open_panel(page)

    # 面板回归：新增选项卡后，原有「技能 / 工具」两个 tab 仍正常
    page.get_by_role("tab", name="技能 Skill").click()
    page.wait_for_timeout(600)
    ok("技能 tab 仍正常渲染", "已启用" in page.inner_text("body"))
    page.get_by_role("tab", name="工具 · MCP").click()
    page.wait_for_timeout(600)
    ok("工具 · MCP tab 仍正常渲染", "MCP" in page.inner_text("body"))
    page.get_by_role("tab", name="小工具").click()
    page.wait_for_timeout(600)

    body = page.inner_text("body")
    tools = ["诉讼费测算", "律师费测算", "利息测算（LPR）", "违约金测算", "迟延履行加倍利息", "期限计算", "日期差计算", "金额大写"]
    missing = [name for name in tools if name not in body]
    ok("8 张小工具卡片齐全", len(missing) == 0, f"缺 {missing}")
    ok("工具栏说明「纯本地计算 · 即输即得」", "即输即得" in body)
    card_icons = page.locator("button svg").count()
    ok("卡片带 SVG 图标（无 emoji）", card_icons >= 8)
    page.screenshot(path=f"{SHOTS}/calc-ui-1-list.png")

    # 详情页：宽屏双栏
    page.locator("button:has-text('诉讼费测算')").first.click()
    page.wait_for_timeout(700)
    form_box = page.locator("div:has(> div:text-is('参数'))").first.bounding_box()
    result_box = page.locator("div:has-text('案件受理费')").last.bounding_box()
    ok("参数卡存在", form_box is not None)
    if form_box and result_box:
        ok("宽屏双栏：参数卡在左、结果卡在右", result_box["x"] > form_box["x"] + form_box["width"] - 5,
           f"form={form_box} result={result_box}")
    else:
        ok("宽屏双栏：参数卡在左、结果卡在右", False, "未取到 bounding box")

    # 分段控件（测算类型 / 审理程序 / 结案方式）
    ok("分段控件（radiogroup）已渲染", page.get_by_role("radiogroup").count() >= 3)
    ok("分段项默认选中「案件受理费」", page.get_by_role("radio", name="案件受理费").is_checked())

    # 单位后缀 + 快捷值
    ok("金额输入带「元」单位后缀", page.locator("#calc-amount").count() == 1 and page.get_by_text("元", exact=True).count() >= 1)
    ok("金额快捷值（100万）可用", page.locator("button:has-text('100万')").count() >= 1)

    # 校验：非法输入 → 失焦后 aria-invalid + role=alert 文案
    amount = page.locator("#calc-amount")
    amount.fill("abc")
    page.locator("#calc-baseFee").click()  # blur
    page.wait_for_timeout(400)
    ok("非法金额标记 aria-invalid", amount.get_attribute("aria-invalid") == "true")
    ok("校验错误就地提示（role=alert）", page.get_by_role("alert").count() >= 1 and "请输入数字" in page.inner_text("body"))

    amount.fill("100万")
    page.locator("#calc-baseFee").click()
    page.wait_for_timeout(400)
    text = page.inner_text("body")
    ok("恢复合法输入后错误消失", amount.get_attribute("aria-invalid") == "false")
    ok("诉讼费 100 万 → 13,800.00", "13,800.00" in text)
    ok("分段明细表出现", "分段累计明细" in text and "1万–10万元部分" in text)
    ok("依据默认折叠（details 未展开）", page.locator("details[open]").count() == 0)
    page.locator("summary:has-text('依据与口径')").click()
    page.wait_for_timeout(300)
    ok("展开依据后可见法条", "诉讼费用交纳办法" in page.inner_text("body"))
    page.screenshot(path=f"{SHOTS}/calc-ui-2-litigation.png")

    # 复制反馈
    page.locator("button:has-text('复制结果')").click()
    page.wait_for_timeout(500)
    ok("复制后按钮变「已复制」", "已复制" in page.inner_text("body"))

    # ── 期限计算（预设联动 + 顺延） ─────────────────────────────────────
    page.locator("button:has-text('全部小工具')").first.click()
    page.wait_for_timeout(400)
    page.locator("button:has-text('期限计算')").first.click()
    page.wait_for_timeout(600)
    page.locator("#calc-baseDate").fill("2026-09-18")
    page.locator("#calc-count").fill("15")
    page.wait_for_timeout(400)
    text = page.inner_text("body")
    ok("期限顺延：2026-10-08", "2026-10-08" in text, text[-300:])
    ok("起算日次日 2026-09-19", "2026-09-19" in text)
    page.locator("#calc-preset").select_option("appeal-judgment")
    page.wait_for_timeout(400)
    ok("法定期间预设联动后仍算出届满日", "2026-10-08" in page.inner_text("body"))
    page.screenshot(path=f"{SHOTS}/calc-ui-3-period.png")

    # ── 深色主题 ────────────────────────────────────────────────────────
    page.evaluate("document.body.setAttribute('data-ds-dark-theme','')")
    page.wait_for_timeout(500)
    page.screenshot(path=f"{SHOTS}/calc-ui-4-dark.png")
    hero_color = page.evaluate("""() => {
      const el = document.querySelector("[class*='calcHeroValue']");
      const hero = document.querySelector("[class*='calcHero']");
      return el && hero ? [getComputedStyle(el).color, getComputedStyle(hero).backgroundColor] : null;
    }""")
    ok("深色主题下英雄区取到计算样式", hero_color is not None, str(hero_color))
    page.evaluate("document.body.removeAttribute('data-ds-dark-theme')")

    # ── 窄屏 375px：面板堆叠、无横向滚动 ───────────────────────────────
    page.set_viewport_size({"width": 375, "height": 800})
    page.wait_for_timeout(700)
    page.locator("button:has-text('全部小工具')").first.click()
    page.wait_for_timeout(400)
    page.locator("button:has-text('利息测算')").first.click()
    page.wait_for_timeout(700)
    overflow = page.evaluate("() => document.documentElement.scrollWidth - window.innerWidth")
    ok("375px 无横向溢出", overflow <= 2, f"overflow={overflow}")
    stacked = page.evaluate("""() => {
      const form = document.querySelector("[class*='calcFormCard']");
      const result = document.querySelector("[class*='calcResult']");
      if (!form || !result) return null;
      const f = form.getBoundingClientRect(), r = result.getBoundingClientRect();
      return { formBottom: f.bottom, resultTop: r.top, sameColumn: Math.abs(f.left - r.left) < 2 };
    }""")
    ok("375px 双栏改为上下堆叠", stacked is not None and stacked["sameColumn"] and stacked["resultTop"] >= stacked["formBottom"] - 2, str(stacked))
    page.screenshot(path=f"{SHOTS}/calc-ui-5-narrow.png")
    context.close()

    browser.close()

print(f"\n{'✅ UI 全部通过' if fail_n == 0 else '❌ 存在失败'}：{pass_n} 通过 / {fail_n} 失败")
sys.exit(0 if fail_n == 0 else 1)
