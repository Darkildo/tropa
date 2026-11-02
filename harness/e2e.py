# UI checks: real plugin code on the mocked API in Chromium. Run with: npm run e2e
import sys, http.server, socketserver, threading, functools, time, json
from playwright.sync_api import sync_playwright
S="dist/shots/"
import os; os.makedirs(S,exist_ok=True)
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self,*a): pass
h=functools.partial(Q,directory="dist/preview")
srv=socketserver.ThreadingTCPServer(("127.0.0.1",0),h); port=srv.server_address[1]
threading.Thread(target=srv.serve_forever,daemon=True).start()
URL=f"http://127.0.0.1:{port}/index.html"
def session(p,w=1440,h=900,dsf=1,query=""):
    b=p.chromium.launch(); pg=b.new_page(viewport={"width":w,"height":h},device_scale_factor=dsf)
    errs=[]; pg.on("console",lambda m: errs.append(m.text) if m.type in("error",) else None); pg.on("pageerror",lambda e: errs.append(str(e)))
    pg.goto(URL+query); pg.wait_for_selector("#center .tropa-map"); pg.wait_for_timeout(500)
    return b,pg,errs
PROG="tropa.app.vault.contents.get('Tropa/Прогресс.md')"
results=[]
def ok(name,cond,extra=""):
    results.append((name,bool(cond))); print(("PASS" if cond else "FAIL"),name,extra)
def node(pg,title): return pg.locator(f'.tropa-node:has(.tropa-node-title:text-is("{title}"))')
def state(pg,title): return node(pg,title).get_attribute("class")
with sync_playwright() as p:
    # --- core learning loop
    b,pg,errs=session(p)
    pg.screenshot(path=S+"10-start-light.png")
    node(pg,"Градиент").click(); pg.wait_for_timeout(150)
    ok("inspector opens", pg.locator(".tropa-side .tropa-title").inner_text()=="Градиент")
    pg.screenshot(path=S+"11-detail.png")
    pg.click('.tropa-side button:text-is("Начать изучение")'); pg.wait_for_timeout(200)
    ok("learning state", "state-learning" in state(pg,"Градиент"))
    pg.click('.tropa-side button:text-is("Отметить освоенным")'); pg.wait_for_timeout(250)
    ok("mastered state", "state-mastered" in state(pg,"Градиент"))
    ok("unlock toast", "Открыто: Градиентный спуск" in pg.locator(".tropa-toast").inner_text(), pg.locator(".tropa-toast").inner_text())
    ok("next unlocked", "state-available" in state(pg,"Градиентный спуск"))
    pg.screenshot(path=S+"12-unlocked.png")
    pg.wait_for_timeout(300)
    ok("saved to progress file", "[[Градиент]]" in pg.evaluate(PROG), pg.evaluate(PROG)[:300])
    ok("note files untouched by progress", "learning-progress" not in pg.evaluate("tropa.app.vault.contents.get('Tropa/Пример/Концепты/Градиент.md')"))
    pg.click('.tropa-toast button'); pg.wait_for_timeout(300)
    ok("undo restores", "state-mastered" not in state(pg,"Градиент"))
    # material checkbox and persistence through reload of state
    node(pg,"Токенизация").click(); pg.wait_for_timeout(150)
    pg.locator('.tropa-material input').first.check(); pg.wait_for_timeout(250)
    ok("done material starts concept", "state-learning" in state(pg,"Токенизация"))
    # back to route, keyboard
    pg.keyboard.press("Escape"); pg.wait_for_timeout(100)
    node(pg,"Токенизация").focus(); pg.keyboard.press("ArrowUp"); pg.wait_for_timeout(60)
    ok("arrow keys move focus", pg.evaluate("document.activeElement.dataset.id||''")!="" )
    node(pg,"Цепное правило").focus(); pg.keyboard.press("m"); pg.wait_for_timeout(200)
    ok("m key masters", "state-mastered" in state(pg,"Цепное правило"))
    pg.keyboard.press("Enter"); pg.wait_for_timeout(100)
    ok("enter selects", pg.locator(".tropa-side .tropa-title").inner_text()=="Цепное правило")
    # all map + materials
    pg.keyboard.press("Escape")
    pg.click('button:text-is("Вся карта")'); pg.wait_for_timeout(500)
    ok("all map shows off-route", node(pg,"Свёрточные сети").count()==1)
    pg.screenshot(path=S+"13-all.png")
    pg.click('.tropa-toggle-sources'); pg.wait_for_timeout(500)
    ok("materials shown", pg.locator(".tropa-node.is-source").count()==12, str(pg.locator(".tropa-node.is-source").count()))
    pg.screenshot(path=S+"14-materials.png")
    pg.click('.tropa-toggle-sources'); pg.wait_for_timeout(300)
    # goal change
    pg.click('.tropa-goal'); pg.wait_for_timeout(100)
    pg.keyboard.type("Свёрт"); pg.wait_for_timeout(100); pg.keyboard.press("Enter"); pg.wait_for_timeout(1500)
    ok("goal switched", pg.locator(".tropa-goal-label").inner_text()=="Свёрточные сети")
    pg.wait_for_timeout(300)
    ok("goal persisted", "Свёрточные сети" in pg.evaluate(PROG))
    pg.click('button:text-is("Маршрут")'); pg.wait_for_timeout(500)
    ok("route excludes transformer", node(pg,"Трансформер").count()==0)
    pg.click('button:text-is("Вся карта")'); pg.wait_for_timeout(500)
    # drag connect: valid link
    a=node(pg,"Эмбеддинги"); c=node(pg,"Свёрточные сети")
    a.scroll_into_view_if_needed(); a.hover()
    bx=a.locator(".tropa-port").bounding_box(); cb=c.bounding_box()
    pg.mouse.move(bx['x']+bx['width']/2,bx['y']+bx['height']/2); pg.mouse.down()
    pg.mouse.move(cb['x']+cb['width']/2,cb['y']+cb['height']/2,steps=8); pg.wait_for_timeout(80)
    pg.screenshot(path=S+"15-connect.png")
    pg.mouse.up(); pg.wait_for_timeout(350)
    ok("drag creates link", "[[Эмбеддинги]]" in pg.evaluate("tropa.app.vault.contents.get('Tropa/Пример/Концепты/Свёрточные сети.md')"))
    # drag connect: cycle refused
    pg.click('[aria-label="Показать всю карту"]'); pg.wait_for_timeout(450)
    a=node(pg,"Трансформер"); c=node(pg,"Эмбеддинги")
    a.hover(); bx=a.locator(".tropa-port").bounding_box(); cb=c.bounding_box()
    pg.mouse.move(bx['x']+bx['width']/2,bx['y']+bx['height']/2); pg.mouse.down()
    pg.mouse.move(cb['x']+cb['width']/2,cb['y']+cb['height']/2,steps=8); pg.wait_for_timeout(60)
    pg.mouse.up(); pg.wait_for_timeout(250)
    ok("cycle refused", any("цикл" in n for n in pg.evaluate("tropa.notices")), str(pg.evaluate("tropa.notices")))
    ok("cycle not written", "Трансформер" not in pg.evaluate("tropa.app.vault.contents.get('Tropa/Пример/Концепты/Эмбеддинги.md')"))
    # add material by link
    node(pg,"Вероятность").click(); pg.wait_for_timeout(200)
    pg.click('.tropa-side button:has-text("Добавить материал")'); pg.wait_for_timeout(100)
    pg.keyboard.type("Seeing Theory"); pg.wait_for_timeout(100); pg.keyboard.press("Enter"); pg.wait_for_timeout(200)
    pg.screenshot(path=S+"16-source-modal.png")
    pg.locator('.modal input[placeholder="https://"]').fill("https://www.youtube.com/watch?v=x")
    ok("format guessed", pg.locator(".modal select").input_value()=="video")
    pg.locator('.modal input[type=number]').fill("30")
    pg.click('.modal button:text-is("Добавить материал")'); pg.wait_for_timeout(350)
    ok("material attached", pg.locator('.tropa-material:has-text("Seeing Theory")').count()==1)
    pg.locator('.tropa-material:has-text("Seeing Theory") button[aria-label^="Отвязать"]').click(force=True); pg.wait_for_timeout(300)
    ok("material detached", pg.locator('.tropa-material:has-text("Seeing Theory")').count()==0)
    # add prerequisite + create new
    pg.click('.tropa-side button:has-text("Добавить требование")'); pg.wait_for_timeout(100)
    pg.keyboard.type("Комбинаторика"); pg.wait_for_timeout(100); pg.keyboard.press("Enter"); pg.wait_for_timeout(400)
    ok("new prerequisite node", node(pg,"Комбинаторика").count()==1)
    ok("no console errors", not errs, str(errs))
    b.close()

    # --- cycle + ghost + off-map note
    b,pg,errs=session(p,query="?scenario=cycle&panel=1")
    pg.wait_for_timeout(200)
    ok("cycle banner", pg.locator(".tropa-side .tropa-callout.is-danger").count()==1)
    ok("cycle state", "state-cycle" in state(pg,"A"))
    ok("ghost node", "is-ghost" in state(pg,"Заметки ещё нет"))
    pg.screenshot(path=S+"20-cycle.png")
    node(pg,"Заметки ещё нет").click(); pg.wait_for_timeout(120)
    pg.click('.tropa-side button:text-is("Создать заметку")'); pg.wait_for_timeout(350)
    ok("ghost materialised", pg.evaluate("tropa.app.vault.files.has('Tropa/Концепты/Заметки ещё нет.md')"))
    ok("ghost becomes real node", "is-ghost" not in state(pg,"Заметки ещё нет"))
    pg.evaluate("(()=>{const f=tropa.app.vault.files.get('Свободная заметка.md'); tropa.app.workspace.setActive(f)})()"); pg.wait_for_timeout(120)
    ok("offmap prompt", pg.locator("#right .tropa-offmap").count()==1)
    pg.click('#right .tropa-offmap button:has-text("Концепт")'); pg.wait_for_timeout(350)
    ok("note added to map", node(pg,"Свободная заметка").count()==1)
    ok("panel follows note", pg.locator("#right .tropa-title").first.inner_text()=="Свободная заметка")
    ok("no console errors (cycle)", not errs, str(errs))
    b.close()

    # --- empty vault onboarding
    b,pg,errs=session(p,query="?scenario=empty")
    ok("empty state", pg.locator(".tropa-empty").count()==1)
    pg.screenshot(path=S+"30-empty.png")
    pg.click('.tropa-empty button:text-is("Показать пример")'); pg.wait_for_timeout(1200)
    ok("sample installed", pg.locator(".tropa-node").count()>=15, str(pg.locator(".tropa-node").count()))
    ok("sample route", pg.locator(".tropa-goal-label").inner_text()=="Трансформер")
    ok("no console errors (empty)", not errs, str(errs))
    b.close()

    # --- dark, narrow, phone
    b,pg,errs=session(p,query="?theme=dark",dsf=2)
    node(pg,"Токенизация").click(); pg.wait_for_timeout(200)
    pg.screenshot(path=S+"40-dark.png"); b.close()
    b,pg,errs=session(p,w=420,h=860,query="?theme=dark")
    pg.screenshot(path=S+"41-narrow.png")
    ok("no horizontal overflow", pg.evaluate("document.documentElement.scrollWidth<=innerWidth"))
    ok("narrow class", pg.locator(".tropa-map.is-narrow").count()==1)
    b.close()

    # --- large graph performance
    b,pg,errs=session(p,query="?scenario=large&n=400")
    t=pg.evaluate("(()=>{const t=performance.now(); const v=tropa.app.workspace.center.view; v.layoutKey=''; v.render(); return performance.now()-t})()")
    print("400 nodes render ms",round(t)); pg.screenshot(path=S+"50-large.png")
    ok("large graph renders", pg.locator(".tropa-node").count()==400)
    b.close()
print(sum(1 for _,r in results if r),"/",len(results))
