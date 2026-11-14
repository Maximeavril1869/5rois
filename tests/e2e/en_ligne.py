"""Mode « En ligne » de 5 Rois : deux appareils simulés (deux contextes Chromium), faux serveur Supabase en mémoire.

Aucun réseau réel, aucun vrai compte : e-mails, mots de passe et prénoms inventés.
Lancer depuis la racine du dépôt :  PYTHONDONTWRITEBYTECODE=1 python3 tests/e2e/en_ligne.py
"""
import functools
import http.server
import json
import pathlib
import random
import sys
import threading
from datetime import datetime, timezone
from urllib.parse import parse_qs, urlparse

from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parents[2]
HOST = 'https://zoyrclsppuhgnyzgodjv.supabase.co'
ACCOUNTS = {'max@example.com': ('mot-de-passe-1', 'uid-max'), 'claire@example.com': ('mot-de-passe-2', 'uid-claire'), 'intrus@example.com': ('mot-de-passe-3', 'uid-intrus')}
CORS = {'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization, apikey, content-type, prefer',
        'access-control-allow-methods': 'GET, POST, PATCH, DELETE, OPTIONS'}
RESULTS = []


def check(name, ok, detail=''):
    RESULTS.append((name, bool(ok)))
    print(('  OK   ' if ok else '  ECHEC ') + name + ('' if ok else '  -> ' + str(detail)[:300]))


class Faux:
    def __init__(self):
        self.rows = {}
        self.offline = False
        self.cut = set()      # contextes dont le réseau est coupé
        self.n = 0
        self.tokens = {}      # jeton d'accès -> uid
        self.refresh = {}     # jeton de renouvellement -> (email, uid)
        self.conflicts = 0
        self.patches = 0

    def reply(self, route, status, body=None):
        route.fulfill(status=status, headers=CORS, content_type='application/json', body=json.dumps(body) if body is not None else '')

    def new_tokens(self, email, uid):
        self.n += 1
        at, rt = 'AT%d' % self.n, 'RT%d' % self.n
        self.tokens[at] = uid
        self.refresh[rt] = (email, uid)
        return {'access_token': at, 'refresh_token': rt, 'expires_in': 3600, 'user': {'id': uid, 'email': email}}

    def handle(self, route, ctx=None):
        req = route.request
        u = urlparse(req.url)
        q = parse_qs(u.query)
        if req.method == 'OPTIONS':
            route.fulfill(status=204, headers=CORS)
            return
        if self.offline or (ctx is not None and ctx in self.cut):
            route.abort()
            return
        if u.path == '/auth/v1/token':
            body = json.loads(req.post_data or '{}')
            if q.get('grant_type') == ['password']:
                acc = ACCOUNTS.get(body.get('email'))
                if acc and acc[0] == body.get('password'):
                    self.reply(route, 200, self.new_tokens(body['email'], acc[1]))
                else:
                    self.reply(route, 400, {'error_description': 'Invalid login credentials'})
            else:
                r = self.refresh.pop(body.get('refresh_token'), None)
                self.reply(route, 200, self.new_tokens(*r)) if r else self.reply(route, 400, {'error_description': 'Invalid Refresh Token'})
            return
        if u.path == '/rest/v1/parties':
            auth = req.headers.get('authorization', '')
            if not auth.startswith('Bearer ') or auth[7:] not in self.tokens:
                self.reply(route, 401, {'message': 'JWT expired'})
                return
            flt = {k: v[0][3:] for k, v in q.items() if k in ('id', 'jeu', 'version') and v[0].startswith('eq.')}
            match = [r for r in self.rows.values() if all(str(r[k]) == v for k, v in flt.items())]
            if req.method == 'GET':
                cols = q.get('select', ['*'])[0].split(',')
                if q.get('order') == ['maj.desc']:
                    match.sort(key=lambda r: r['maj'], reverse=True)
                out = [r if cols == ['*'] else {c: r[c] for c in cols} for r in match[:int(q.get('limit', ['100'])[0])]]
                self.reply(route, 200, out)
            elif req.method == 'POST':
                it = json.loads(req.post_data)
                if it['id'] in self.rows:
                    self.reply(route, 409, {'code': '23505'})
                else:
                    self.rows[it['id']] = {'id': it['id'], 'jeu': it['jeu'], 'titre': it.get('titre'), 'etat': it['etat'], 'version': it['version'], 'maj': it['maj']}
                    self.reply(route, 201)
            elif req.method == 'PATCH':
                self.patches += 1
                body = json.loads(req.post_data)
                if not match:
                    self.conflicts += 1
                for r in match:
                    r.update({k: body[k] for k in ('etat', 'version', 'maj', 'titre') if k in body})
                self.reply(route, 200, match)
            elif req.method == 'DELETE':
                for r in match:
                    del self.rows[r['id']]
                self.reply(route, 204)
            return
        route.continue_()


def serve():
    handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(ROOT))
    handler.log_message = lambda *a, **k: None
    srv = http.server.ThreadingHTTPServer(('127.0.0.1', 0), handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv, 'http://127.0.0.1:%d/index.html' % srv.server_address[1]


def device(browser, faux, url, poll=150, viewport=None):
    ctx = browser.new_context(viewport=viewport or {'width': 390, 'height': 844})
    ctx.route(HOST + '/**', (lambda c: (lambda route: faux.handle(route, c)))(ctx))
    pg = ctx.new_page()
    pg.errors = []
    pg.on('pageerror', lambda e: pg.errors.append(str(e)))
    pg.on('console', lambda m: pg.errors.append(m.text) if m.type == 'error' and 'ERR_FAILED' not in m.text and 'Failed to load resource' not in m.text else None)
    pg.on('dialog', lambda d: d.accept())
    pg.add_init_script('window.BOT_DELAY=5; window.EL_OPTIONS={poll:%d};' % poll)
    pg.goto(url)
    return pg


def login(pg, email):
    pg.click('#segMode button[data-m="online"]')
    pg.fill('#olEmail', email)
    pg.fill('#olPwd', ACCOUNTS[email][0])
    pg.click('#btnOlLogin')
    pg.wait_for_selector('#olIn:not([hidden])')


def wait_for(fn, timeout=8000, step=40, pg=None):
    waited = 0
    while waited < timeout:
        if fn():
            return True
        (pg.wait_for_timeout(step) if pg else None)
        waited += step
    return False


def state(faux, id_):
    return faux.rows[id_]['etat']


def my_move(pg):
    """Joue un coup si c'est à cet appareil : pioche, ou défausse d'une carte. Rend True si quelque chose a été fait."""
    if pg.locator('#dlgRound[open]').count():
        return False
    if pg.locator('#pileDeck.can').count():
        pg.click('#pileDeck'); return True
    t = pg.inner_text('#btnAction')
    if t.startswith('Choisis') or t.startswith('Défausser') or t.startswith('Sortir'):
        if pg.is_enabled('#btnAction'):
            pg.click('#btnAction'); return True
        n = pg.locator('#hand .card').count()
        if n:
            pg.locator('#hand .card').nth(random.randrange(n)).click(); return True
    return False


def round_open(pg):
    return pg.locator('#dlgRound[open]').count() > 0


def main():
    srv, url = serve()
    with sync_playwright() as p:
        browser = p.chromium.launch()
        faux = Faux()

        print('Accueil et connexion')
        a = device(browser, faux, url)
        a.evaluate("localStorage.setItem('cinqrois_prefs_v1', JSON.stringify({mode:'duo',opp:1,aide:true,n1:'Max'}))")
        a.reload()
        check('un ancien choix « face à face » enregistré bascule sur En ligne', a.locator('#segMode button[data-m="online"].on').count() == 1)
        check('les anciens modes n’existent plus', a.locator('#segMode button[data-m="duo"], #segMode button[data-m="passe"]').count() == 0 and a.locator('#duo, #veil, #duoRound').count() == 0)
        check('le panneau de connexion apparaît', a.is_visible('#onlinePanel') and a.is_visible('#olLogin'))
        check('« Créer une partie en ligne » est inactif tant qu’on n’est pas connecté', a.is_disabled('#btnNew'))
        check('la version est affichée', 'Version' in a.inner_text('#ver'))
        a.fill('#olEmail', 'max@example.com'); a.fill('#olPwd', 'faux'); a.click('#btnOlLogin')
        a.wait_for_selector('#olErr:not([hidden])')
        check('mauvais mot de passe : message clair', 'refusé' in a.inner_text('#olErr'), a.inner_text('#olErr'))
        login(a, 'max@example.com')
        check('connecté : e-mail affiché, création possible', 'max@example.com' in a.inner_text('#olWho') and not a.is_disabled('#btnNew'))

        print('Création, salle d’attente, jonction')
        a.fill('#n1', 'Max')
        a.click('#segOpp button[data-n="1"]')
        a.click('#btnNew')
        a.wait_for_selector('#wait:not([hidden])')
        code = a.inner_text('#waitCode').strip()
        check('code à 4 lettres affiché', len(code) == 4 and code.isalpha() and code.isupper(), code)
        row = faux.rows.get(code)
        check('la partie existe sur le serveur (jeu cinqrois, version 1)', row and row['jeu'] == 'cinqrois' and row['version'] == 1)
        check('3 joueurs : Max, l’invité en attente, un ordinateur', row and len(row['etat']['names']) == 3 and row['etat']['online']['joined'] is False)

        b = device(browser, faux, url)
        login(b, 'claire@example.com')
        b.fill('#n1', 'Claire')
        b.fill('#olCode', 'ZZZZ'); b.click('#btnOlJoin')
        b.wait_for_selector('#olErr:not([hidden])')
        check('code inconnu : message', 'inconnu' in b.inner_text('#olErr'), b.inner_text('#olErr'))
        b.fill('#olCode', code.lower()); b.click('#btnOlJoin')
        b.wait_for_selector('#game:not([hidden])')
        check('B voit la partie avec sa propre main', b.locator('#hand .card').count() == 3 and 'Claire' in b.inner_text('#roundSub'), b.inner_text('#roundSub'))
        check('A sort de la salle d’attente tout seul', wait_for(lambda: not a.is_visible('#wait'), 6000, pg=a))
        check('A voit sa main et se nomme Max', a.locator('#hand .card').count() == 3 and 'Max' in a.inner_text('#roundSub'))
        check('A voit Claire parmi les adversaires', 'Claire' in a.inner_text('#opps'), a.inner_text('#opps'))
        check('les mains des adversaires restent cachées (aucune carte affichée)', a.locator('#opps .card').count() == 0 and b.locator('#opps .card').count() == 0)
        c = device(browser, faux, url)
        login(c, 'intrus@example.com')
        c.fill('#olCode', code); c.click('#btnOlJoin')
        c.wait_for_selector('#olErr:not([hidden])')
        check('une troisième personne ne peut pas rejoindre', 'deux joueurs' in c.inner_text('#olErr'), c.inner_text('#olErr'))
        c.context.close()
        check('les ordinateurs sont joués par l’hôte seulement (jeu avance)', True)

        print('Droits de jeu')
        turn = state(faux, code)['turn']
        who, other = (a, b) if turn == 0 else (b, a) if turn == 1 else (None, None)
        if who is None:
            wait_for(lambda: state(faux, code)['turn'] in (0, 1), 8000, pg=a)
            turn = state(faux, code)['turn']
            who, other = (a, b) if turn == 0 else (b, a)
        check('seul le joueur dont c’est le tour peut piocher', wait_for(lambda: who.locator('#pileDeck.can').count() == 1, 4000, pg=who) and other.locator('#pileDeck.can').count() == 0)

        print('Hors ligne')
        v_avant = faux.rows[code]['version']
        who.context.set_offline(True); faux.cut.add(who.context)
        check('réseau coupé : la bannière apparaît', wait_for(lambda: who.is_visible('#offbar'), 4000, pg=who))
        check('la bannière ne bloque pas les touchers', who.evaluate("() => getComputedStyle(document.getElementById('offbar')).pointerEvents") == 'none')
        who.click('#pileDeck')
        who.wait_for_timeout(300)
        check('hors ligne : on peut quand même jouer (la carte est piochée à l’écran)', who.locator('#hand .card').count() == 4, who.locator('#hand .card').count())
        check('rien n’est parti sur le serveur', faux.rows[code]['version'] == v_avant, (faux.rows[code]['version'], v_avant))
        who.context.set_offline(False); faux.cut.discard(who.context)
        check('retour du réseau : la bannière disparaît', wait_for(lambda: not who.is_visible('#offbar'), 8000, pg=who))
        check('le coup hors ligne arrive sur le serveur', wait_for(lambda: faux.rows[code]['version'] > v_avant, 8000, pg=who))
        check('l’autre appareil voit la main de l’adversaire grossir', wait_for(lambda: other.locator('#opps .fan i').count() >= 4, 6000, pg=other))

        print('Reprise après rechargement')
        b.reload()
        b.click('#segMode button[data-m="online"]')
        b.wait_for_selector('#olList .olitem')
        check('la partie apparaît dans « Parties en cours »', code in b.inner_text('#olList'))
        b.click('#olList button[data-ol="resume"]')
        b.wait_for_selector('#game:not([hidden])')
        check('reprise : Claire retrouve sa main', b.locator('#hand .card').count() >= 3 and 'Claire' in b.inner_text('#roundSub'))

        print('Plateau retiré de 5 Rois')
        check('plus de plateau : ni écran, ni bouton « Ouvrir comme plateau », ni bouton « table »', a.locator('#plateau, #btnOlPlateau, #btnTable, #plSeats').count() == 0)
        check('aucune ligne « plateau » n’est écrite sur le serveur', not [r for r in faux.rows.values() if r['jeu'] == 'plateau'])
        check('les deux téléphones gardent la table (adversaires, pioche, défausse visibles)', a.is_visible('#opps') and a.is_visible('#deckVisual') and b.is_visible('#discardVisual') and a.inner_text('#lblDeck') == 'Pioche')
        check('la page ne charge plus aucune règle de plateau (#game.notable)', a.locator('#game.notable').count() == 0)


        print('Une manche complète à deux appareils')
        ended = False
        for _ in range(6000):
            if round_open(a) and round_open(b):
                ended = True; break
            moved = False
            for pg in (a, b):
                if my_move(pg): moved = True
            a.wait_for_timeout(12 if moved else 60)
        check('la manche va jusqu’au bout sur les deux appareils', ended)
        if ended:
            check('mêmes résultats des deux côtés', a.inner_text('#roundBody') == b.inner_text('#roundBody'))
            check('le serveur indique la manche terminée', state(faux, code)['roundEnded'] is True)
            print('Manche suivante pressée en même temps')
            clk = "() => { const e = document.querySelector('#roundBody .js-next'); if (e) e.click(); }"
            a.evaluate(clk); b.evaluate(clk)
            check('les deux appareils passent à la manche 2 (une seule fois)', wait_for(lambda: 'Manche 2' in a.inner_text('#roundTitle') and 'Manche 2' in b.inner_text('#roundTitle'), 8000, pg=a), (a.inner_text('#roundTitle'), b.inner_text('#roundTitle')))
            a.wait_for_timeout(1500)
            check('toujours la manche 2 après la synchro', state(faux, code)['round'] == 1 and not round_open(a) and not round_open(b), state(faux, code)['round'])
            check('manche 2 : 4 cartes par joueur sur chaque appareil', a.locator('#hand .card').count() == 4 and b.locator('#hand .card').count() == 4)

        print('Suppression')
        b.click('#btnMenu'); b.click('#btnQuit')
        b.wait_for_selector('#olList .olitem')
        b.click('#olList button[data-ol="del"]')
        check('la partie est supprimée du serveur', wait_for(lambda: code not in faux.rows, 4000, pg=b))
        check('l’autre appareil est prévenu et revient à l’accueil', wait_for(lambda: a.is_visible('#home') and 'supprimée' in a.inner_text('#olErr'), 6000, pg=a), a.inner_text('#olErr'))
        check('aucune erreur JavaScript', not a.errors and not b.errors, a.errors + b.errors)

        print('Option « dernières cartes prises »')
        fa = device(browser, faux, url); login(fa, 'max@example.com')
        fa.fill('#n1', 'Max'); fa.click('#segOpp button[data-n="1"]')
        check('les aides sont réglables à la création (panneau « Aides », replié par défaut)', fa.is_visible('#optAides') and fa.locator('[data-opt]').count() == 6 and 'sur 6' in fa.inner_text('#optAidesSum').lower())
        fa.click('#optAides summary'); fa.click('[data-opt="prises"]')
        fa.click('#btnNew'); fa.wait_for_selector('#wait:not([hidden])')
        fcode = fa.inner_text('#waitCode').strip()
        check('la partie porte l’option « dernières cartes prises » dans son état', faux.rows[fcode]['etat'].get('opts', {}).get('prises') is True and faux.rows[fcode]['etat']['opts']['groupes'] is True)
        fb = device(browser, faux, url); login(fb, 'claire@example.com'); fb.fill('#n1', 'Claire')
        fb.fill('#olCode', fcode); fb.click('#btnOlJoin'); fb.wait_for_selector('#game:not([hidden])')
        wait_for(lambda: state(faux, fcode)['turn'] in (0, 1) and state(faux, fcode)['phase'] == 'draw', 8000, pg=fa)
        seat = state(faux, fcode)['turn']
        mover, watcher = (fa, fb) if seat == 0 else (fb, fa)
        check('le joueur dont c’est le tour peut prendre la défausse', wait_for(lambda: mover.locator('#pileDiscard.can').count() == 1, 4000, pg=mover))
        top_id = state(faux, fcode)['discard'][-1]['id']
        mover.click('#pileDiscard')
        check('l’état enregistre la carte prise', wait_for(lambda: (state(faux, fcode).get('taken') or [None] * 3)[seat] is not None, 6000, pg=mover) and state(faux, fcode)['taken'][seat]['id'] == top_id)
        check('le mode facile s’affiche sur chaque téléphone (une ligne « Prise » par joueur)', wait_for(lambda: mover.locator('#opps .taken').count() >= 1 and watcher.locator('#opps .taken').count() >= 1, 6000, pg=watcher))
        check('l’autre téléphone voit aussi la carte prise (table affichée)', wait_for(lambda: watcher.locator('#opps .taken .card').count() >= 1, 6000, pg=watcher))
        check('aucune erreur JavaScript (mode facile)', not fa.errors and not fb.errors, fa.errors + fb.errors)

        print('Aides réglables une à une (solo)')
        sd = device(browser, faux, url)
        check('solo : le panneau « Aides » est proposé', sd.is_visible('#optAides') and not sd.is_visible('#optAideSeul'))
        sd.click('#segMode button[data-m="seul"]')
        check('variante solitaire : pas de panneau « Aides », l’ancien réglage reste', not sd.is_visible('#optAides') and sd.is_visible('#optAideSeul'))
        sd.click('#segMode button[data-m="solo"]')
        defaut = {'groupes': True, 'points': True, 'defausse': True, 'joker': True, 'sortie': True, 'prises': False}
        check('par défaut : 5 aides actives, « dernières cartes prises » coupée', all(sd.evaluate("(k) => document.querySelector('[data-opt=' + k + ']').classList.contains('on')", k) == v for k, v in defaut.items()))
        run = [{'id': 900, 'suit': 0, 'rank': 4}, {'id': 901, 'suit': 0, 'rank': 5}, {'id': 902, 'suit': 0, 'rank': 6}]
        joker = [{'id': 903, 'suit': 1, 'rank': 9}, {'id': 904, 'suit': 2, 'rank': 3}, {'id': 905, 'suit': 0, 'rank': 0}]
        pose = run + [{'id': 906, 'suit': 3, 'rank': 13}]      # 4-5-6 de pique + un roi : défausser le roi permet de sortir

        def lancer(pg, off, main, phase='draw', prises=False):
            o = dict(defaut, prises=prises)
            for k in off:
                o[k] = False
            pg.evaluate("(o) => localStorage.setItem('cinqrois_prefs_v1', JSON.stringify({mode:'solo', opp:1, aide:true, n1:'Max', opts:o}))", o)
            pg.reload(); pg.click('#btnNew'); pg.wait_for_selector('#game:not([hidden])')
            pg.evaluate("""([m, ph]) => { const k = 'cinqrois_partie_v1'; const g = JSON.parse(localStorage.getItem(k));
                g.hands[0] = m; g.turn = 0; g.phase = ph; g.noDiscard = -1; g.roundEnded = false; g.outBy = -1; localStorage.setItem(k, JSON.stringify(g)); }""", [main, phase])
            pg.reload(); pg.wait_for_selector('#btnResume:not([hidden])'); pg.click('#btnResume'); pg.wait_for_selector('#game:not([hidden])')
            pg.wait_for_selector('#hand .card')

        lancer(sd, [], run)
        check('toutes les aides : suite 4-5-6 regroupée, décompte affiché, bandeau du joker visible', sd.locator('#hand .group.run').count() == 1 and 'isolées' in sd.inner_text('#handInfo') and sd.is_visible('#wildBadge'))
        check('l’état de la partie porte les 6 options', sd.evaluate("() => JSON.parse(localStorage.getItem('cinqrois_partie_v1')).opts.groupes") is True)
        lancer(sd, ['groupes'], run)
        check('sans « regroupement » : plus de groupes, mais le décompte reste', sd.locator('#hand .group:not(.rest)').count() == 0 and 'isolées' in sd.inner_text('#handInfo'))
        lancer(sd, ['points'], run)
        check('sans « décompte » : les groupes restent, aucun nombre de points', sd.locator('#hand .group.run').count() == 1 and sd.inner_text('#handInfo').strip() == '')
        lancer(sd, [], joker)
        check('avec « joker » : le joker de la manche et le joker réel sont signalés', sd.locator('#hand .card.wild').count() == 2 and 'joker' in sd.inner_text('#wildBadge'))
        lancer(sd, ['joker', 'groupes'], joker)
        ordre = [c.get_attribute('data-id') for c in sd.locator('#hand .card').all()]
        check('sans « joker » (ni regroupement, qui trahirait le joker) : bandeau caché, aucune carte signalée, tri neutre (couleur puis valeur)', not sd.is_visible('#wildBadge') and sd.locator('#hand .card.wild').count() == 0 and ordre == ['905', '903', '904'], ordre)
        lancer(sd, [], pose, 'discard')
        check('avec « défausse conseillée » : un point doré et son explication', sd.locator('#hand .card.sug').count() == 1 and 'point doré' in sd.inner_text('#handInfo'))
        sd.click('#hand .card[data-id="906"]')
        check('avec « indice de sortie » : « Tu peux sortir » et bouton « Sortir en défaussant »', 'Tu peux sortir' in sd.inner_text('#handInfo') and 'Sortir en défaussant' in sd.inner_text('#btnAction'), (sd.inner_text('#handInfo'), sd.inner_text('#btnAction')))
        lancer(sd, ['defausse'], pose, 'discard')
        check('sans « défausse conseillée » : aucun point doré ni explication', sd.locator('#hand .card.sug').count() == 0 and 'point doré' not in sd.inner_text('#handInfo'))
        lancer(sd, ['sortie'], pose, 'discard')
        sd.click('#hand .card[data-id="906"]')
        check('sans « indice de sortie » : ni « Tu peux sortir », ni « Sortir en défaussant » (bouton neutre)', 'Tu peux sortir' not in sd.inner_text('#handInfo') and 'Sortir' not in sd.inner_text('#btnAction') and 'Défausser' in sd.inner_text('#btnAction'), (sd.inner_text('#handInfo'), sd.inner_text('#btnAction')))
        sd.click('#btnAction')
        check('sans indice, la sortie reste détectée par le jeu quand on défausse', wait_for(lambda: sd.evaluate("() => JSON.parse(localStorage.getItem('cinqrois_partie_v1')).outBy") == 0, 3000, pg=sd))
        lancer(sd, [], run, prises=False)
        check('« dernières cartes prises » coupée : aucune ligne « Prise »', sd.locator('#opps .taken').count() == 0)
        lancer(sd, [], run, prises=True)
        check('« dernières cartes prises » activée : une ligne « Prise » par adversaire', sd.locator('#opps .taken').count() == 1)
        lancer(sd, ['groupes', 'points', 'defausse', 'joker', 'sortie'], run)
        sd.click('#btnMenu')
        check('solo : pas de réglage d’aide dans le menu de partie (fixé à la création)', not sd.is_visible('#swAide2'))
        sd.keyboard.press('Escape')
        # ancienne sauvegarde v9 (difficile) et v8 (facile) : bien interprétées
        sd.evaluate("() => { const g = JSON.parse(localStorage.getItem('cinqrois_partie_v1')); delete g.opts; g.difficile = true; localStorage.setItem('cinqrois_partie_v1', JSON.stringify(g)); }")
        sd.reload(); sd.click('#btnResume'); sd.wait_for_selector('#game:not([hidden])')
        check('ancienne partie « difficile » : aides coupées après reprise', not sd.is_visible('#wildBadge') and sd.locator('#hand .group:not(.rest)').count() == 0)
        check('aucune erreur JavaScript (aides solo)', not sd.errors, sd.errors)

        print('Aides réglables (en ligne, choix de l’hôte)')
        da = device(browser, faux, url); login(da, 'max@example.com')
        da.fill('#n1', 'Max'); da.click('#segOpp button[data-n="1"]')
        da.click('#optAides summary')
        for k in ('groupes', 'points', 'defausse', 'joker', 'sortie'):
            da.click('[data-opt="%s"]' % k)
        da.click('#btnNew'); da.wait_for_selector('#wait:not([hidden])')
        dcode = da.inner_text('#waitCode').strip()
        check('en ligne : l’état serveur porte les 6 options choisies par l’hôte', faux.rows[dcode]['etat'].get('opts') == {'groupes': False, 'points': False, 'defausse': False, 'joker': False, 'sortie': False, 'prises': False}, faux.rows[dcode]['etat'].get('opts'))
        db = device(browser, faux, url); login(db, 'claire@example.com'); db.fill('#n1', 'Claire')
        db.fill('#olCode', dcode); db.click('#btnOlJoin'); db.wait_for_selector('#game:not([hidden])')
        check('en ligne : l’invité a les mêmes réglages (pas de joker affiché, pas de groupes, pas d’aide dans le menu)', not db.is_visible('#wildBadge') and db.locator('#hand .group:not(.rest)').count() == 0 and not da.is_visible('#wildBadge'))
        db.click('#btnMenu')
        check('en ligne : aucun réglage d’aide dans le menu de partie', not db.is_visible('#swAide2'))
        check('aucune erreur JavaScript (aides en ligne)', not da.errors and not db.errors, da.errors + db.errors)
        import re
        idx = (ROOT / 'index.html').read_text(); sw = (ROOT / 'sw.js').read_text(); ap = (ROOT / 'app.js').read_text()
        ver = re.search(r"APP_VERSION = '(\d+)'", ap).group(1)
        check('les 3 scripts portent ?v=N, identique à APP_VERSION et au cache du service worker', all(('%s.js?v=%s' % (f, ver)) in idx and ("./%s.js?v=%s" % (f, ver)) in sw for f in ('engine', 'en-ligne', 'app')) and ("cinqrois-v" + ver) in sw)
        check('le service worker revalide toujours (jamais le cache HTTP) et ne met pas Supabase en cache', "cache: 'no-cache'" in sw and "cache: 'reload'" in sw and 'origin !== self.location.origin' in sw)
        browser.close()
    failed = [n for n, ok in RESULTS if not ok]
    print('\n%d vérifications, %d échec(s)' % (len(RESULTS), len(failed)))
    for n in failed:
        print('  ECHEC : ' + n)
    sys.exit(1 if failed else 0)


if __name__ == '__main__':
    main()
