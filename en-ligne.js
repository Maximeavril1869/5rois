/* En ligne — brique commune de parties entre appareils, via Supabase (même projet que Plan du jour et Mon Compte).
   Une partie = une ligne de la table `parties` : { id (code à 4 lettres), jeu, titre, etat (jsonb), version, maj }.
   Écriture « optimiste » : on n'écrit que si la version n'a pas bougé (PATCH ?version=eq.N) ; sinon l'appelant relit et rejoue son coup.
   Session partagée par tous les jeux (même origine GitHub Pages) : on se connecte une fois pour tous.
   Aucune bibliothèque : fetch uniquement. Copie identique dans chaque jeu (voir ARCHITECTURE.md). Expose window.EnLigne. */
(function (root) {
  'use strict';
  var O = root.EL_OPTIONS || {};
  var URL_ = O.url || 'https://zoyrclsppuhgnyzgodjv.supabase.co';
  var KEY = O.key || 'sb_publishable_rHeMIa4CSjCjZXpAI-0tTQ_QC1O06Ng';   // clé publique : la protection vient des règles d'accès de la table
  var SKEY = 'foyer_session_v1', TABLE = 'parties';
  var POLL = O.poll != null ? O.poll : 1500;
  var refreshing = null;

  function err(kind, msg, status) { var e = new Error(msg || kind); e.kind = kind; e.status = status; return e; }
  function rd() { try { var s = JSON.parse(localStorage.getItem(SKEY)); return s && s.at && s.rt ? s : null; } catch (e) { return null; } }
  function wr(s) { try { if (s) localStorage.setItem(SKEY, JSON.stringify(s)); else localStorage.removeItem(SKEY); } catch (e) { /* stockage indisponible */ } }
  function store(j, prev) {
    if (!j || typeof j.access_token !== 'string' || typeof j.refresh_token !== 'string') throw err('http', 'réponse inattendue');
    var u = j.user || {};
    wr({ at: j.access_token, rt: j.refresh_token, exp: Date.now() + (j.expires_in || 3600) * 1000, email: u.email || (prev && prev.email) || '', uid: u.id || (prev && prev.uid) || '' });
  }
  function net(url, opts) { return fetch(url, opts).catch(function () { throw err('reseau', 'réseau indisponible'); }); }
  function httpErr(res) { return res.text().then(function (t) { return err('http', 'erreur ' + res.status + (t ? ' : ' + t.slice(0, 120) : ''), res.status); }); }
  var enc = encodeURIComponent;

  /* ---------- Compte ---------- */
  function connecte() { return !!rd(); }
  function email() { var s = rd(); return s ? s.email : ''; }
  function uid() { var s = rd(); return s ? s.uid : ''; }
  function login(mail, pwd) {
    return net(URL_ + '/auth/v1/token?grant_type=password', { method: 'POST', headers: { apikey: KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ email: mail, password: pwd }) })
      .then(function (res) {
        if (res.status === 400 || res.status === 401 || res.status === 422) throw err('bad', 'e-mail ou mot de passe refusé', res.status);
        if (!res.ok) return httpErr(res).then(function (e) { throw e; });
        return res.json().then(function (j) { store(j, null); });
      });
  }
  function logout() { wr(null); }
  function refresh() {
    if (refreshing) return refreshing;
    var cur = rd();
    if (!cur) return Promise.reject(err('auth', 'non connecté'));
    refreshing = net(URL_ + '/auth/v1/token?grant_type=refresh_token', { method: 'POST', headers: { apikey: KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ refresh_token: cur.rt }) })
      .then(function (res) {
        if (res.status === 400 || res.status === 401 || res.status === 403) { wr(null); throw err('auth', 'session expirée', res.status); }
        if (!res.ok) return httpErr(res).then(function (e) { throw e; });
        return res.json().then(function (j) { store(j, cur); });
      });
    var done = function () { refreshing = null; };
    refreshing.then(done, done);
    return refreshing;
  }
  function api(path, opts, retried) {
    var s = rd();
    if (!s) return Promise.reject(err('auth', 'non connecté'));
    var go = function () {
      var cur = rd();
      if (!cur) throw err('auth', 'non connecté');
      var h = { apikey: KEY, 'Content-Type': 'application/json', Authorization: 'Bearer ' + cur.at };
      if (opts && opts.headers) for (var k in opts.headers) h[k] = opts.headers[k];
      return net(URL_ + '/rest/v1/' + path, { method: (opts && opts.method) || 'GET', headers: h, body: opts && opts.body }).then(function (res) {
        if (res.status === 401) {
          if (retried) { wr(null); throw err('auth', 'session expirée', 401); }
          return refresh().then(function () { return api(path, opts, true); });
        }
        return res;
      });
    };
    return Date.now() > s.exp - 60000 ? refresh().then(go) : go();
  }
  function json(res) { return res.ok ? res.json() : httpErr(res).then(function (e) { throw e; }); }

  /* ---------- Parties ---------- */
  var LETTRES = 'ABCDEFGHJKLMNPQRSTUVWXYZ';      // sans I ni O (confusion avec 1 et 0)
  function nouveauCode() { var c = '', i; for (i = 0; i < 4; i++) c += LETTRES.charAt(Math.floor(Math.random() * LETTRES.length)); return c; }
  function creer(jeu, etat, titre) {
    var essai = function (n) {
      if (n >= 6) return Promise.reject(err('http', 'aucun code libre'));
      var id = nouveauCode();
      return api(TABLE, { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ id: id, jeu: jeu, titre: titre || null, etat: etat, version: 1, maj: new Date().toISOString() }) }).then(function (res) {
        if (res.status === 201 || res.status === 204) return { id: id, version: 1 };
        if (res.status === 409) return essai(n + 1);
        return httpErr(res).then(function (e) { throw e; });
      });
    };
    return essai(0);
  }
  function lire(id) { return api(TABLE + '?id=eq.' + enc(id) + '&select=id,jeu,titre,etat,version,maj').then(json).then(function (a) { return a[0] || null; }); }
  function version(id) { return api(TABLE + '?id=eq.' + enc(id) + '&select=version').then(json).then(function (a) { return a[0] ? a[0].version : null; }); }
  // Écrit si la version distante est encore v. Rend la nouvelle version, ou false (quelqu'un a écrit entre-temps : relire et rejouer).
  function ecrire(id, v, etat, titre) {
    var body = { etat: etat, version: v + 1, maj: new Date().toISOString() };
    if (titre != null) body.titre = titre;
    return api(TABLE + '?id=eq.' + enc(id) + '&version=eq.' + v, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify(body) }).then(json).then(function (a) { return a.length ? v + 1 : false; });
  }
  function liste(jeu) { return api(TABLE + '?jeu=eq.' + enc(jeu) + '&select=id,titre,version,maj&order=maj.desc&limit=10').then(json); }
  function supprimer(id) { return api(TABLE + '?id=eq.' + enc(id), { method: 'DELETE' }).then(function (res) { if (!res.ok) return httpErr(res).then(function (e) { throw e; }); }); }

  /* ---------- Surveillance : on ne relit la partie que si sa version a changé ---------- */
  function surveiller(id, getVersion, onChange, onStatus) {
    var stopped = false, timer = null, busy = false;
    function say(s) { if (onStatus) onStatus(s); }
    function tick() {
      if (stopped || busy) return;
      clearTimeout(timer);
      if (document.hidden) { timer = setTimeout(tick, POLL); return; }
      busy = true;
      version(id).then(function (v) {
        say('ok');
        if (v == null) { stopped = true; say('supprimee'); return; }
        if (v > getVersion()) return onChange(v);
      }).catch(function (e) { say(e.kind === 'reseau' ? 'hors-ligne' : e.kind === 'auth' ? 'auth' : 'erreur'); })
        .then(function () { busy = false; if (!stopped) timer = setTimeout(tick, POLL); });
    }
    function vis() { if (!document.hidden) tick(); }
    document.addEventListener('visibilitychange', vis);
    window.addEventListener('online', tick);
    tick();
    return { poke: tick, stop: function () { stopped = true; clearTimeout(timer); document.removeEventListener('visibilitychange', vis); window.removeEventListener('online', tick); } };
  }

  root.EnLigne = { connecte: connecte, email: email, uid: uid, login: login, logout: logout, creer: creer, lire: lire, version: version, ecrire: ecrire, liste: liste, supprimer: supprimer, surveiller: surveiller };
})(window);
