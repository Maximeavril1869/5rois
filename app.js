/* 5 Rois — interface. Tout est local : la partie est sauvegardée dans le navigateur (localStorage). */
(function () {
  'use strict';
  var E = window.Engine;
  var SAVE_KEY = 'cinqrois_partie_v1', PREF_KEY = 'cinqrois_prefs_v1';
  var BOT_NAMES = ['Camille', 'Hugo', 'Léa'];

  var G = null;            // état de la partie
  var selected = null;     // id de la carte sélectionnée
  var running = false;     // boucle des bots en cours
  var prefs = { aide: true, opp: 2 };
  var lastNewId = null;    // dernière carte piochée par le joueur (animation)

  function $(id) { return document.getElementById(id); }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  /* ---------- Sauvegarde ---------- */
  function save() { try { localStorage.setItem(SAVE_KEY, JSON.stringify(G)); } catch (e) {} }
  function loadSave() { try { var s = localStorage.getItem(SAVE_KEY); return s ? JSON.parse(s) : null; } catch (e) { return null; } }
  function clearSave() { try { localStorage.removeItem(SAVE_KEY); } catch (e) {} }
  function savePrefs() { try { localStorage.setItem(PREF_KEY, JSON.stringify(prefs)); } catch (e) {} }
  function loadPrefs() { try { var p = JSON.parse(localStorage.getItem(PREF_KEY)); if (p) { prefs.aide = p.aide !== false; prefs.opp = p.opp || 2; } } catch (e) {} }

  /* ---------- Cartes en HTML ---------- */
  function cardHTML(c, o) {
    o = o || {};
    var cls = ['card'];
    var wild = E.isWild(c, G.wild);
    if (c.rank === 0) cls.push('joker');
    if (wild) cls.push('wild');
    if (o.sel) cls.push('sel');
    if (o.sug) cls.push('sug');
    if (o.lock) cls.push('lock');
    if (o.pop) cls.push('pop');
    var inner;
    if (c.rank === 0) {
      inner = '<div class="tl">JOKER</div><div class="mid">♛</div>';
    } else {
      var s = E.SUITS[c.suit];
      inner = '<div class="tl" style="color:' + s.color + '">' + E.rankLabel(c.rank) + '<span>' + s.sym + '</span></div>' +
              '<div class="mid" style="color:' + s.color + '">' + s.sym + '</div>';
    }
    return '<div class="' + cls.join(' ') + '" data-id="' + c.id + '">' + inner + '</div>';
  }
  function sortHand(cards) {
    return cards.slice().sort(function (a, b) {
      var wa = E.isWild(a, G.wild) ? 1 : 0, wb = E.isWild(b, G.wild) ? 1 : 0;
      if (wa !== wb) return wa - wb;
      if (a.suit !== b.suit) return a.suit - b.suit;
      return a.rank - b.rank;
    });
  }
  function groupHTML(grp, small) {
    var h = '<div class="group ' + grp.kind + (small ? ' small' : '') + '">';
    grp.cards.forEach(function (c) { h += cardHTML(c); });
    return h + '</div>';
  }

  /* ---------- Affichage de la partie ---------- */
  function me() { for (var i = 0; i < G.n; i++) if (G.human[i]) return i; return 0; }
  function isMyTurn() { return G && !G.roundEnded && G.human[G.turn]; }

  function renderTop() {
    $('roundTitle').textContent = 'Manche ' + (G.round + 1) + ' / 11';
    $('roundSub').textContent = G.cards + ' cartes · toi : ' + G.scores[me()] + ' pts';
    $('wildBadge').textContent = '♛ ' + E.rankLabel(G.wild) + ' = joker';
  }
  function renderOpps() {
    var h = '';
    for (var p = 0; p < G.n; p++) {
      if (G.human[p]) continue;
      var n = G.hands[p].length, fan = '';
      for (var k = 0; k < Math.min(n, 14); k++) fan += '<i></i>';
      h += '<div class="opp' + (G.turn === p && !G.roundEnded ? ' turn' : '') + '">' +
           '<div class="nm"><span>' + esc(G.names[p]) + '</span>' + (G.outBy === p ? '<span class="tag">SORTI</span>' : '') + '</div>' +
           '<div class="sc">' + G.scores[p] + ' pts</div><div class="fan">' + fan + '</div></div>';
    }
    $('opps').innerHTML = h;
  }
  function renderTable() {
    var canDraw = isMyTurn() && G.phase === 'draw';
    $('deckVisual').innerHTML = '<div class="cardback"></div><span class="count">' + G.deck.length + '</span>';
    var top = G.discard[G.discard.length - 1];
    $('discardVisual').innerHTML = top ? cardHTML(top) : '<div class="emptyslot"></div>';
    $('pileDeck').classList.toggle('can', canDraw);
    $('pileDiscard').classList.toggle('can', canDraw && !!top);
  }
  function renderMsg() {
    var m = $('msg'), alert = false, txt = '';
    if (G.roundEnded) txt = 'Manche terminée';
    else if (isMyTurn()) {
      if (G.phase === 'draw') txt = (G.last ? G.last + ' ' : '') + 'À toi : pioche ou prends la défausse.';
      else txt = 'Choisis une carte à défausser.';
      if (G.outBy >= 0 && G.outBy !== me()) { txt = G.names[G.outBy] + ' est sorti ! Dernier tour pour toi. ' + txt; alert = true; }
    } else {
      txt = G.last || ('Au tour de ' + G.names[G.turn] + '…');
      if (G.outBy >= 0) alert = true;
    }
    m.textContent = txt; m.className = 'msg' + (alert ? ' alert' : '');
  }

  function renderHand() {
    var p = me(), hand = G.hands[p], h = '', info = '';
    var sug = null, selCard = null, layout;
    var choosing = isMyTurn() && G.phase === 'discard';
    if (prefs.aide) {
      if (choosing && selected != null) {
        hand.forEach(function (c) { if (c.id === selected) selCard = c; });
      }
      var base = selCard ? hand.filter(function (c) { return c !== selCard; }) : hand;
      var sol = E.solveHand(base, G.wild);
      layout = { groups: sol.groups, rest: sortHand(sol.rest), penalty: sol.penalty };
      if (choosing) sug = E.bestDiscard(hand, G.wild, G.noDiscard).card.id;
    } else {
      layout = { groups: [], rest: sortHand(hand), penalty: null };
    }
    function opts(c) {
      return { sel: c.id === selected, sug: c.id === sug, lock: c.id === G.noDiscard && G.phase === 'discard', pop: c.id === lastNewId };
    }
    layout.groups.forEach(function (g) {
      h += '<div class="group ' + g.kind + '">';
      g.cards.forEach(function (c) { h += cardHTML(c, opts(c)); });
      h += '</div>';
    });
    if (layout.rest.length) {
      var wrap = prefs.aide;
      if (wrap) h += '<div class="group rest">';
      layout.rest.forEach(function (c) { h += cardHTML(c, opts(c)); });
      if (wrap) h += '</div>';
    }
    if (selCard) h += '<div class="group out">' + cardHTML(selCard, opts(selCard)) + '</div>';
    $('hand').innerHTML = h;

    if (prefs.aide) {
      if (choosing) {
        if (selCard) info = layout.penalty === 0 ? '<b>Tu peux sortir</b> en défaussant cette carte' : 'En défaussant cette carte, il te resterait <b>' + layout.penalty + ' pts</b>';
        else info = 'Le point doré marque la défausse conseillée';
      } else info = 'Cartes isolées : <b>' + layout.penalty + ' pts</b>';
    }
    $('handInfo').innerHTML = info;
  }

  function renderAction() {
    var b = $('btnAction'), p = me();
    b.disabled = true; b.textContent = '…';
    if (G.roundEnded) { b.textContent = 'Voir les résultats'; b.disabled = false; return; }
    if (!isMyTurn()) { b.textContent = 'Au tour de ' + G.names[G.turn] + '…'; return; }
    if (G.phase === 'draw') { b.textContent = 'Touche la pioche ou la défausse'; return; }
    if (selected == null) { b.textContent = 'Choisis une carte à défausser'; return; }
    var card = G.hands[p].filter(function (c) { return c.id === selected; })[0];
    if (!card) { selected = null; b.textContent = 'Choisis une carte à défausser'; return; }
    var rest = G.hands[p].filter(function (c) { return c.id !== selected; });
    var out = G.outBy < 0 && E.solveHand(rest, G.wild).penalty === 0;
    b.textContent = out ? 'Sortir en défaussant ' + E.cardName(card) : 'Défausser ' + E.cardName(card);
    b.disabled = false;
  }

  function renderAll() {
    renderTop(); renderOpps(); renderTable(); renderMsg(); renderHand(); renderAction();
  }

  /* ---------- Actions du joueur ---------- */
  function humanDraw(src) {
    if (!isMyTurn() || G.phase !== 'draw') return;
    if (src === 'discard' && !G.discard.length) return;
    var card = E.draw(G, src);
    lastNewId = card.id; selected = null;
    G.last = '';
    save(); renderAll();
    lastNewId = null;
  }
  function humanDiscard() {
    if (!isMyTurn() || G.phase !== 'discard' || selected == null) return;
    var name = G.names[me()];
    var r = E.discard(G, selected);
    if (!r) return;
    selected = null;
    G.last = r.wentOut ? 'Tu es sorti !' : 'Tu as défaussé ' + E.cardName(r.card) + '.';
    save(); renderAll();
    afterMove();
  }
  function afterMove() {
    if (G.roundEnded) { setTimeout(showRound, 700); return; }
    tick();
  }

  /* ---------- Tours des adversaires ---------- */
  function describe(r) {
    var nm = G.names[r.p];
    var s = nm + (r.src === 'discard' ? ' a pris ' + E.cardName(r.drawn) + ' dans la défausse' : ' a pioché');
    s += ' et défaussé ' + E.cardName(r.discarded) + '.';
    if (r.wentOut) s = nm + ' sort en défaussant ' + E.cardName(r.discarded) + ' !';
    return s;
  }
  async function tick() {
    if (running || !G) return;
    running = true;
    try {
      while (G && !G.roundEnded && !G.human[G.turn]) {
        renderAll();
        await sleep(950);
        if (!G) break;
        var r = E.botPlay(G);
        G.last = describe(r);
        save(); renderAll();
      }
    } finally { running = false; }
    if (G && G.roundEnded) { setTimeout(showRound, 900); }
    else if (G) renderAll();
  }

  /* ---------- Fin de manche / de partie ---------- */
  function scoresTable() {
    var h = '<table class="sc"><tr><th></th>';
    for (var p = 0; p < G.n; p++) h += '<th>' + esc(G.names[p]) + '</th>';
    h += '</tr>';
    G.history.forEach(function (row, i) {
      var min = Math.min.apply(null, row);
      h += '<tr><td>M' + (i + 1) + '</td>';
      row.forEach(function (v) { h += '<td' + (v === min ? ' class="best"' : '') + '>' + v + '</td>'; });
      h += '</tr>';
    });
    h += '<tr class="tot"><td>Total</td>';
    var mn = Math.min.apply(null, G.scores);
    G.scores.forEach(function (v) { h += '<td' + (v === mn && G.history.length ? ' class="best"' : '') + '>' + v + '</td>'; });
    return h + '</tr></table>';
  }
  function showScores() { $('scoresBody').innerHTML = scoresTable(); $('dlgScores').showModal(); }

  function showRound() {
    if (!G || !G.roundEnded) return;
    var d = $('dlgRound'), b = $('roundBody'), h = '';
    if (G.over) {
      var order = G.scores.map(function (s, i) { return { s: s, i: i }; }).sort(function (a, b) { return a.s - b.s; });
      h += '<h2 class="serif">Fin de partie</h2>';
      order.forEach(function (o, k) {
        var medal = k === 0 ? '🏆' : (k + 1) + '.';
        h += '<div class="rank' + (k === 0 ? ' win' : '') + '"><span class="pos">' + medal + '</span><span class="n">' + esc(G.names[o.i]) + '</span><b>' + o.s + ' pts</b></div>';
      });
      var winner = order[0].i;
      h += '<p>' + (G.human[winner] ? 'Bravo, tu gagnes la partie !' : esc(G.names[winner]) + ' gagne la partie.') + '</p>';
      h += scoresTable();
      h += '<button class="btn gold" id="btnAgain">Nouvelle partie</button><button class="btn ghost" id="btnHomeEnd">Accueil</button>';
    } else {
      h += '<h2 class="serif">Manche ' + (G.round + 1) + ' terminée</h2>';
      G.results.forEach(function (r, p) {
        h += '<div class="resrow"><div class="hd"><span>' + esc(G.names[p]) + (r.out ? ' · sorti' : '') + '</span><span class="pts' + (r.penalty === 0 ? ' zero' : '') + '">+' + r.penalty + ' pts</span></div><div class="minihand">';
        r.groups.forEach(function (g) { h += groupHTML(g, true); });
        if (r.rest.length) { h += '<div class="group rest small">'; sortHand(r.rest).forEach(function (c) { h += cardHTML(c); }); h += '</div>'; }
        h += '</div></div>';
      });
      h += scoresTable();
      h += '<button class="btn gold" id="btnNext">Manche suivante</button>';
    }
    b.innerHTML = h;
    if (!d.open) d.showModal();
    var bn = $('btnNext'), ba = $('btnAgain'), bh = $('btnHomeEnd');
    if (bn) bn.onclick = function () { d.close(); E.nextRound(G); selected = null; save(); renderAll(); afterMove(); };
    if (ba) ba.onclick = function () { d.close(); startNew(prefs.opp); };
    if (bh) bh.onclick = function () { d.close(); goHome(); };
  }

  /* ---------- Navigation ---------- */
  function showGame() { $('home').hidden = true; $('game').hidden = false; }
  function goHome() {
    if (G && G.over) clearSave();
    G = null;
    $('game').hidden = true; $('home').hidden = false; refreshHome();
  }
  function startNew(nOpp) {
    var names = ['Toi'], human = [true], i;
    for (i = 0; i < nOpp; i++) { names.push(BOT_NAMES[i]); human.push(false); }
    G = E.newGame(names, human);
    selected = null; save(); showGame(); renderAll(); afterMove();
  }
  function refreshHome() {
    var s = loadSave();
    $('btnResume').hidden = !(s && !s.over);
    document.querySelectorAll('#segOpp button').forEach(function (b) { b.classList.toggle('on', +b.dataset.n === prefs.opp); });
    $('swAide').classList.toggle('on', prefs.aide);
    $('swAide2').classList.toggle('on', prefs.aide);
  }
  function setAide(v) {
    prefs.aide = v; savePrefs();
    $('swAide').classList.toggle('on', v); $('swAide2').classList.toggle('on', v);
    if (G && !$('game').hidden) renderAll();
  }

  /* ---------- Branchements ---------- */
  function bind() {
    loadPrefs();
    document.querySelectorAll('#segOpp button').forEach(function (b) {
      b.onclick = function () { prefs.opp = +b.dataset.n; savePrefs(); refreshHome(); };
    });
    $('swAide').onclick = function () { setAide(!prefs.aide); };
    $('swAide2').onclick = function () { setAide(!prefs.aide); };
    $('btnNew').onclick = function () {
      var s = loadSave();
      if (s && !s.over && !confirm('Une partie est en cours. La remplacer par une nouvelle ?')) return;
      startNew(prefs.opp);
    };
    $('btnResume').onclick = function () {
      G = loadSave(); if (!G) return;
      selected = null; showGame(); renderAll();
      if (G.roundEnded) showRound(); else tick();
    };
    $('btnRules').onclick = function () { $('dlgRules').showModal(); };
    $('btnMenuRules').onclick = function () { $('dlgMenu').close(); $('dlgRules').showModal(); };
    $('btnScores').onclick = showScores;
    $('btnMenu').onclick = function () { $('dlgMenu').showModal(); };
    $('btnQuit').onclick = function () { $('dlgMenu').close(); goHome(); };
    document.querySelectorAll('[data-close]').forEach(function (b) { b.onclick = function () { b.closest('dialog').close(); }; });

    $('pileDeck').onclick = function () { humanDraw('deck'); };
    $('pileDiscard').onclick = function () { humanDraw('discard'); };
    $('hand').onclick = function (e) {
      var el = e.target.closest('.card'); if (!el) return;
      if (!isMyTurn() || G.phase !== 'discard') return;
      var id = +el.dataset.id;
      if (id === G.noDiscard) { G.last = ''; $('msg').textContent = 'Tu ne peux pas rejeter la carte que tu viens de prendre dans la défausse.'; return; }
      selected = (selected === id) ? null : id;
      renderHand(); renderAction();
    };
    $('btnAction').onclick = function () {
      if (G.roundEnded) { showRound(); return; }
      humanDiscard();
    };
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden && G && !$('game').hidden && !G.roundEnded && !G.human[G.turn]) tick();
    });

    refreshHome();
    if ('serviceWorker' in navigator && location.protocol.indexOf('http') === 0) {
      navigator.serviceWorker.register('sw.js').catch(function () {});
    }
  }
  bind();
})();
