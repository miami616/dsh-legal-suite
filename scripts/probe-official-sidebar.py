#!/usr/bin/env python3
"""Playwright smoke check for the official right-sidebar integration (备忘 #30).

Enters a real session, flips the AgentLex「工作区右边栏」module toggle **in the
page only** (a synthetic `agentlex:toggles-changed` event — no settings write),
expands the OFFICIAL right sidebar, then asserts the CORRECT design:

  * the OFFICIAL native file tree is still there and untouched;
  * AgentLex does NOT render its own tree in place of it;
  * the native rows carry AgentLex's right-click menu;
  * the first-open width is narrowed to ~380px.

Usage: python3 scripts/probe-official-sidebar.py <base-url> <token> [out.png]
"""
import sys
from playwright.sync_api import sync_playwright

base = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:3081"
token = sys.argv[2] if len(sys.argv) > 2 else ""
out = sys.argv[3] if len(sys.argv) > 3 else "/tmp/official-sidebar.png"
url = f"{base}/?token={token}" if token else base


def enable_toggle(page):
    page.evaluate("""() => window.dispatchEvent(new CustomEvent('agentlex:toggles-changed', {
        detail: { workspaceSidebarEnabled: true, openReferencesInSidebar: true },
    }))""")


with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={"width": 1600, "height": 1000})
    logs = []
    page.on("console", lambda m: logs.append(f"[{m.type}] {m.text}"[:400]))
    page.on("pageerror", lambda e: logs.append(f"[pageerror] {e}"[:400]))
    page.goto(url, wait_until="domcontentloaded")
    page.wait_for_timeout(6000)

    entered = ""
    for sel in ["text=#30 #31 #32", "[class*='session'][class*='row']"]:
        try:
            loc = page.locator(sel).first
            if loc.count() > 0 and loc.is_visible():
                entered = (loc.inner_text() or "").strip()[:40]
                loc.click()
                break
        except Exception as exc:  # noqa: BLE001
            logs.append(f"[probe] session click via {sel} failed: {exc}")
    page.wait_for_timeout(6000)

    enable_toggle(page)
    page.wait_for_timeout(4000)

    # Expand the official right sidebar (its button sits in the conversation header corner).
    expanded = False
    for sel in [
        "[data-slot='conversation.session.header.corner'] button",
        "button[aria-label*='右侧']",
        "button[aria-label*='右栏']",
        "[class*='_headerActions'] button:last-child",
    ]:
        try:
            loc = page.locator(sel)
            n = loc.count()
            if n > 0:
                loc.nth(n - 1).click()
                expanded = True
                page.wait_for_timeout(4000)
                break
        except Exception:  # noqa: BLE001
            pass

    # Right-click the first native row to prove the menu is ours.
    row = page.locator("li[data-files-entry][data-files-path]").first
    row.click(button="right")
    page.wait_for_timeout(800)
    menu_items = page.evaluate(
        "() => { const m = document.querySelector('[data-agentlex-tree-menu]');"
        " return m ? Array.from(m.querySelectorAll('button')).map((b) => b.textContent) : null }")

    page.screenshot(path=out, full_page=False)
    print({
        "entered_session": entered,
        "clicked_expand": expanded,
        "native_tree_present": page.locator("[data-files-state='tree']").count() > 0,
        "native_rows": page.locator("li[data-files-entry][data-files-path]").count(),
        "agentlex_tree_in_rightbar": page.locator(
            "[class*='rightbarCol'] [data-agentlex-workspace-root]").count(),
        "selfdrawn_host": page.locator("[data-agentlex-workspace-host]").count(),
        "rightbar_width": page.locator("[class*='rightbarCol']").first.bounding_box()["width"]
                          if page.locator("[class*='rightbarCol']").count() else 0,
        "tree_menu_items": menu_items,
        "link_menu_also_open": page.locator("[data-agentlex-link-menu]").count() > 0,
    })
    print("--- diagnostics ---")
    for line in logs:
        if any(k in line for k in ("agentlex-workspace", "sidebarRight", "case-files", "pageerror")):
            print(line)
    browser.close()
