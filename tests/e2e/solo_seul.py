"""Essai de fumée : contre l'ordinateur (quelques tours) et variante solitaire, sans erreur JavaScript.
Lancer : python3 -m http.server 8123 (depuis la racine du dépôt), puis python3 tests/e2e/solo_seul.py"""
import random
from playwright.sync_api import sync_playwright

URL = 'http://127.0.0.1:8123/index.html'
with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page(viewport={'width': 390, 'height': 844})
    errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.on('dialog', lambda d: d.accept())
    pg.add_init_script('window.BOT_DELAY=5;')
    pg.goto(URL)
    pg.screenshot(path='/tmp/r_home.png')
    pg.click('#segMode button[data-m="solo"]'); pg.click('#btnNew')
    tours = 0
    for _ in range(400):
        if pg.locator('#dlgRound[open] .js-next').count():
            pg.click('#dlgRound[open] .js-next')
        elif pg.locator('#pileDeck.can').count():
            pg.click('#pileDeck'); tours += 1
        else:
            t = pg.inner_text('#btnAction')
            if (t.startswith('Défausser') or t.startswith('Sortir')) and pg.is_enabled('#btnAction'):
                pg.click('#btnAction')
            elif t.startswith('Choisis'):
                n = pg.locator('#hand .card').count(); pg.locator('#hand .card').nth(random.randrange(n)).click()
        pg.wait_for_timeout(15)
        if tours >= 12: break
    print('solo : tours joués', tours, 'erreurs', errs[:3])
    assert tours >= 12 and not errs
    pg.click('#btnMenu'); pg.click('#btnQuit')
    pg.click('#segMode button[data-m="seul"]'); pg.click('#btnNew')
    pg.wait_for_timeout(300)
    print('seul : écran visible', pg.is_visible('#seul'), 'erreurs', errs[:3])
    assert pg.is_visible('#seul') and not errs
    pg.screenshot(path='/tmp/r_seul.png')
    b.close()
print('OK')
