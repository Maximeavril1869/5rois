/* 5 Rois — interface. Tout est local : la partie est sauvegardée dans le navigateur (localStorage).
   Quatre modes : contre l'ordinateur ('solo'), à deux en se passant l'appareil ('passe'),
   à deux face à face sur un iPad posé à plat ('duo'), et la variante solitaire à une personne ('seul'). */
(function () {
  'use strict';
  var E = window.Engine;
  var SAVE_KEY = 'cinqrois_partie_v1', PREF_KEY = 'cinqrois_prefs_v1';
  var BOT_NAMES = ['Camille', 'Hugo', 'Léa', 'Noé', 'Inès', 'Louis'];   // jusqu'à 6 adversaires (7 joueurs)

  var G = null;              // état de la partie (sérialisable)
  var selected = null;       // id de la carte sélectionnée (joueur dont c'est le tour)
  var running = false;       // boucle des adversaires en cours
  var reveal = [false, false]; // mode face à face : main visible ou cachée par siège
  var lastNewId = null;
  var seulHints = null;      // variante solitaire : pénalité atteignable par main avec la carte révélée
  var arrOn = {}, arrSel = {}; // rangement manuel : mode actif et première carte touchée, par joueur
  var prefs = { aide: true, opp: 2, mode: 'solo', n1: 'Joueur 1', n2: 'Joueur 2' };

  function $(id) { return document.getElementById(id); }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function mode() { return (G && G.mode) || 'solo'; }

  /* ---------- Sauvegarde ---------- */
  function save() { try { localStorage.setItem(SAVE_KEY, JSON.stringify(G)); } catch (e) {} }
  function loadSave() { try { var s = localStorage.getItem(SAVE_KEY); return s ? JSON.parse(s) : null; } catch (e) { return null; } }
  function clearSave() { try { localStorage.removeItem(SAVE_KEY); } catch (e) {} }
  function savePrefs() { try { localStorage.setItem(PREF_KEY, JSON.stringify(prefs)); } catch (e) {} }
  function loadPrefs() {
    try {
      var p = JSON.parse(localStorage.getItem(PREF_KEY));
      if (p) {
        prefs.aide = p.aide !== false; prefs.opp = Math.min(6, Math.max(1, p.opp || 2));
        if (p.mode === 'passe' || p.mode === 'duo' || p.mode === 'seul') prefs.mode = p.mode;
        if (p.n1) prefs.n1 = p.n1; if (p.n2) prefs.n2 = p.n2;
      }
    } catch (e) {}
  }

  /* ---------- Cartes en HTML ---------- */
  function cardHTML(c, o) {
    o = o || {};
    var cls = ['card'];
    var wr = o.wr !== undefined ? o.wr : G.wild;   // valeur de joker de la manche (propre à chaque main en solitaire)
    if (c.rank === 0) cls.push('joker');
    if (E.isWild(c, wr)) cls.push('wild');
    if (o.sel) cls.push('sel');
    if (o.sug) cls.push('sug');
    if (o.lock) cls.push('lock');
    if (o.pop) cls.push('pop');
    if (o.dual) cls.push('dual');
    var inner;
    if (c.rank === 0) {
      inner = '<div class="tl">JOKER</div><div class="mid">♛</div>';
    } else {
      var s = E.SUITS[c.suit];
      var idx = E.rankLabel(c.rank) + '<span>' + s.sym + '</span>';
      inner = '<div class="tl" style="color:' + s.color + '">' + idx + '</div>' +
              (o.dual ? '<div class="tl br" style="color:' + s.color + '">' + idx + '</div>' : '') +
              '<div class="mid" style="color:' + s.color + '">' + s.sym + '</div>';
    }
    return '<div class="' + cls.join(' ') + '" data-id="' + c.id + '">' + inner + '</div>';
  }
  function sortHand(cards, wr) {
    if (wr === undefined) wr = G.wild;
    return cards.slice().sort(function (a, b) {
      var wa = E.isWild(a, wr) ? 1 : 0, wb = E.isWild(b, wr) ? 1 : 0;
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

  /* ---------- Qui regarde ? ---------- */
  function viewer() {
    if (mode() === 'passe') return G.turn;
    for (var i = 0; i < G.n; i++) if (G.human[i]) return i;
    return 0;
  }
  function isTurnOf(p) { return !!G && !G.roundEnded && G.turn === p && G.human[p]; }
  function veilOn() { return mode() === 'passe' && !!G.veil && !G.roundEnded; }

  /* ---------- Éléments communs ---------- */
  function msgFor(p) {
    if (G.roundEnded) return { txt: 'Manche terminée', alert: false };
    var txt, alert = false;
    if (isTurnOf(p)) {
      txt = G.phase === 'draw' ? (G.last ? G.last + ' ' : '') + 'À toi : pioche ou prends la défausse.' : 'Choisis une carte à défausser.';
      if (G.outBy >= 0 && G.outBy !== p) { txt = G.names[G.outBy] + ' est sorti ! Dernier tour pour toi. ' + txt; alert = true; }
    } else {
      txt = G.human[G.turn] ? 'Au tour de ' + G.names[G.turn] + '…' : (G.last || 'Au tour de ' + G.names[G.turn] + '…');
      if (G.outBy === p) { txt = 'Tu es sorti ! Dernier tour des autres. ' + txt; alert = true; }
      else if (G.outBy >= 0) alert = true;
    }
    return { txt: txt, alert: alert };
  }

  function renderPiles(ids) {
    var canDraw = !G.roundEnded && G.human[G.turn] && G.phase === 'draw' && !veilOn();
    $(ids.deck).innerHTML = '<div class="cardback"></div><span class="count">' + G.deck.length + '</span>';
    var top = G.discard[G.discard.length - 1];
    $(ids.disc).innerHTML = top ? cardHTML(top, { dual: mode() === 'duo' }) : '<div class="emptyslot"></div>';
    $(ids.bdeck).classList.toggle('can', canDraw);
    $(ids.bdisc).classList.toggle('can', canDraw && !!top);
  }

  /* ---------- Rangement manuel : on touche deux cartes pour les échanger ---------- */
  // Ordre personnalisé du joueur p (G.order[p] = liste d'identifiants), ou null si le tri est automatique.
  function customOrder(p) {
    var o = G.order && G.order[p];
    if (!o) return null;
    var hand = G.hands[p], byId = {}, res = [], seen = {};
    hand.forEach(function (c) { byId[c.id] = c; });
    o.forEach(function (id) { if (byId[id] && !seen[id]) { res.push(byId[id]); seen[id] = 1; } });
    hand.forEach(function (c) { if (!seen[c.id]) res.push(c); });   // cartes piochées depuis : à la fin
    G.order[p] = res.map(function (c) { return c.id; });
    return res;
  }
  function initOrder(p) {                 // point de départ = ce que le joueur voit déjà
    var hand = G.hands[p], list = [];
    if (prefs.aide) {
      var sol = E.solveHand(hand, G.wild);
      sol.groups.forEach(function (g) { g.cards.forEach(function (c) { list.push(c); }); });
      sortHand(sol.rest).forEach(function (c) { list.push(c); });
    } else list = sortHand(hand);
    return list.map(function (c) { return c.id; });
  }
  function toggleArrange(p) {
    if (arrOn[p]) { arrOn[p] = false; arrSel[p] = null; renderAll(); return; }
    if (!G.order) G.order = [];
    if (!customOrder(p)) G.order[p] = initOrder(p);
    arrOn[p] = true; arrSel[p] = null; selected = null;
    save(); renderAll();
  }
  function autoSort(p) {
    if (G.order) G.order[p] = null;
    arrOn[p] = false; arrSel[p] = null;
    save(); renderAll();
  }
  function arrangeTap(p, id) {
    var cur = arrSel[p];
    if (cur == null) { arrSel[p] = id; renderAll(); return; }
    if (cur === id) { arrSel[p] = null; renderAll(); return; }
    var o = G.order[p], a = o.indexOf(cur), b = o.indexOf(id);
    if (a >= 0 && b >= 0) { o[a] = id; o[b] = cur; }
    arrSel[p] = null;
    save(); renderAll();
  }

  // Remplit la main du joueur p. hidden = cartes face cachée. bar = barre des boutons de rangement.
  function renderHandInto(p, handEl, infoEl, hidden, bar) {
    var hand = G.hands[p], h = '', info = '', i;
    if (hidden) {
      for (i = 0; i < hand.length; i++) h += '<div class="cardback"></div>';
      handEl.innerHTML = '<div class="group rest">' + h + '</div>';
      infoEl.textContent = 'Main cachée';
      if (bar) bar.hidden = true;
      return;
    }
    var cust = customOrder(p), arranging = !!arrOn[p] && !!cust;
    if (bar) {
      bar.hidden = !!G.roundEnded;
      bar.querySelector('.js-arr').textContent = arranging ? '✓ Terminé' : '⇄ Ranger';
      bar.querySelector('.js-arr').classList.toggle('on', arranging);
      bar.querySelector('.js-auto').hidden = !cust;
    }
    var choosing = isTurnOf(p) && G.phase === 'discard';
    var sug = null, selCard = null, layout;
    if (prefs.aide) {
      if (choosing && selected != null) hand.forEach(function (c) { if (c.id === selected) selCard = c; });
      var base = selCard ? hand.filter(function (c) { return c !== selCard; }) : hand;
      var sol = E.solveHand(base, G.wild);
      layout = { groups: sol.groups, rest: sortHand(sol.rest), penalty: sol.penalty };
      if (choosing) sug = E.bestDiscard(hand, G.wild, G.noDiscard).card.id;
    } else {
      layout = { groups: [], rest: sortHand(hand), penalty: null };
    }
    function opts(c) {
      return { sel: arranging ? c.id === arrSel[p] : choosing && c.id === selected, sug: !arranging && c.id === sug,
               lock: choosing && c.id === G.noDiscard, pop: c.id === lastNewId };
    }
    if (cust) {
      // rangement personnalisé : les cartes restent dans l'ordre choisi, sans regroupement automatique
      h = '<div class="group rest flat' + (arranging ? ' arr' : '') + '">';
      cust.forEach(function (c) { h += cardHTML(c, opts(c)); });
      h += '</div>';
    } else {
      layout.groups.forEach(function (g) {
        h += '<div class="group ' + g.kind + '">';
        g.cards.forEach(function (c) { h += cardHTML(c, opts(c)); });
        h += '</div>';
      });
      if (layout.rest.length) {
        if (prefs.aide) h += '<div class="group rest">';
        layout.rest.forEach(function (c) { h += cardHTML(c, opts(c)); });
        if (prefs.aide) h += '</div>';
      }
      if (selCard) h += '<div class="group out">' + cardHTML(selCard, opts(selCard)) + '</div>';
    }
    handEl.innerHTML = h;

    if (arranging) {
      info = arrSel[p] != null ? 'Touche la carte avec laquelle l’échanger' : 'Touche deux cartes pour les échanger de place';
      if (prefs.aide) info += ' · isolées : <b>' + E.solveHand(hand, G.wild).penalty + ' pts</b>';
    } else if (prefs.aide) {
      if (choosing) {
        if (selCard) info = layout.penalty === 0 ? '<b>Tu peux sortir</b> en défaussant cette carte' : 'En défaussant cette carte, il te resterait <b>' + layout.penalty + ' pts</b>';
        else info = 'Le point doré marque la défausse conseillée';
      } else info = 'Cartes isolées : <b>' + layout.penalty + ' pts</b>';
    }
    infoEl.innerHTML = info;
  }

  function fillAction(p, btn, hidden) {
    btn.disabled = true; btn.textContent = '…';
    if (G.roundEnded) { btn.textContent = 'Voir les résultats'; btn.disabled = false; return; }
    if (!isTurnOf(p)) { btn.textContent = 'Au tour de ' + G.names[G.turn] + '…'; return; }
    if (G.phase === 'draw') { btn.textContent = 'Touche la pioche ou la défausse'; return; }
    if (hidden) { btn.textContent = 'Affiche ta main pour choisir'; return; }
    var card = null;
    G.hands[p].forEach(function (c) { if (c.id === selected) card = c; });
    if (!card) { selected = null; btn.textContent = 'Choisis une carte à défausser'; return; }
    var rest = G.hands[p].filter(function (c) { return c.id !== selected; });
    var out = G.outBy < 0 && E.solveHand(rest, G.wild).penalty === 0;
    btn.textContent = out ? 'Sortir en défaussant ' + E.cardName(card) : 'Défausser ' + E.cardName(card);
    btn.disabled = false;
  }

  /* ---------- Affichage : contre l'ordinateur / passe-passe ---------- */
  function renderSolo() {
    var v = viewer();
    $('roundTitle').textContent = 'Manche ' + (G.round + 1) + ' / 11';
    $('roundSub').textContent = G.cards + ' cartes · ' + (mode() === 'solo' ? 'toi' : G.names[v]) + ' : ' + G.scores[v] + ' pts';
    $('wildBadge').textContent = '♛ ' + E.rankLabel(G.wild) + ' = joker';
    var h = '';
    for (var p = 0; p < G.n; p++) {
      if (p === v) continue;
      var n = G.hands[p].length, fan = '';
      for (var k = 0; k < Math.min(n, 14); k++) fan += '<i></i>';
      h += '<div class="opp' + (G.turn === p && !G.roundEnded ? ' turn' : '') + '">' +
           '<div class="nm"><span>' + esc(G.names[p]) + '</span>' + (G.outBy === p ? '<span class="tag">SORTI</span>' : '') + '</div>' +
           '<div class="sc">' + G.scores[p] + ' pts</div><div class="fan">' + fan + '</div></div>';
    }
    $('opps').innerHTML = h;
    $('opps').className = 'opps' + (G.n > 4 ? ' many' : '');
    renderPiles({ deck: 'deckVisual', disc: 'discardVisual', bdeck: 'pileDeck', bdisc: 'pileDiscard' });
    var m = msgFor(v);
    $('msg').textContent = m.txt; $('msg').className = 'msg' + (m.alert ? ' alert' : '');
    renderHandInto(v, $('hand'), $('handInfo'), veilOn(), $('arrbar'));
    fillAction(v, $('btnAction'), false);
    // voile « passe l'appareil »
    var vl = veilOn();
    $('veil').hidden = !vl;
    if (vl) {
      $('veilTitle').textContent = 'À ' + G.names[G.turn] + ' de jouer';
      $('veilLast').textContent = G.last || '';
      $('btnVeil').textContent = 'Je suis ' + G.names[G.turn];
    }
  }

  /* ---------- Affichage : face à face ---------- */
  function renderDuo() {
    for (var p = 0; p < 2; p++) {
      var seat = $('seat' + p);
      var wild = '♛ ' + E.rankLabel(G.wild) + ' = joker';
      seat.querySelector('.seathead').innerHTML =
        '<div class="who"><b class="serif">' + esc(G.names[p]) + '</b><span>' + G.scores[p] + ' pts' + (G.outBy === p ? ' · <em>SORTI</em>' : '') + '</span></div>' +
        '<span class="wildbadge">' + wild + '</span>' +
        '<span class="rd">Manche ' + (G.round + 1) + '/11</span>' +
        '<button class="iconbtn js-scores" aria-label="Scores">☰</button>';
      seat.classList.toggle('turn', isTurnOf(p));
      var m = msgFor(p), me = seat.querySelector('.msg');
      me.textContent = m.txt; me.className = 'msg' + (m.alert ? ' alert' : '');
      var hidden = !reveal[p];
      renderHandInto(p, seat.querySelector('.hand'), seat.querySelector('.handinfo'), hidden, seat.querySelector('.arrbar'));
      seat.querySelector('.js-reveal').textContent = hidden ? '👁 Voir ma main' : '🙈 Cacher ma main';
      fillAction(p, seat.querySelector('.js-action'), hidden);
    }
    renderPiles({ deck: 'duoDeckVisual', disc: 'duoDiscardVisual', bdeck: 'duoPileDeck', bdisc: 'duoPileDiscard' });
  }

  function renderAll() {
    if (!G) return;
    if (mode() === 'seul') renderSeul();
    else if (mode() === 'duo') renderDuo();
    else renderSolo();
  }

  /* ---------- Variante solitaire ---------- */
  // Aide : pour chaque main non retournée, points isolés atteignables si on y place la carte révélée.
  function seulHintsFor() {
    if (!prefs.aide || G.phase !== 'place' || !G.drawn) return null;
    if (seulHints && seulHints.id === G.drawn.id && seulHints.turn === G.turns) return seulHints.v;
    var v = [];
    for (var i = 0; i < 11; i++) {
      if (G.flipped[i]) { v.push(null); continue; }
      var cur = E.solveHand(G.hands[i], i + 3).penalty;
      var adv = E.soloAdvice(G.hands[i].concat([G.drawn]), i + 3);
      v.push({ cur: cur, next: adv.penalty });
    }
    seulHints = { id: G.drawn.id, turn: G.turns, v: v };
    return v;
  }
  function plural(n, one, many) { return n + ' ' + (n > 1 ? many : one); }

  function seulTile(i, hints) {
    var hand = G.hands[i], wr = i + 3, done = G.flipped[i];
    var isT = G.phase === 'discard' && G.target === i;
    var canPlace = G.phase === 'place' && !done && !G.over;
    var hint = hints ? hints[i] : null;
    var cls = 'htile' + (done ? ' done' : '') + (isT ? ' target' : '') + (canPlace ? ' can' : '');
    if (canPlace && hint && hint.next === 0) cls += ' flip';

    var selCard = null, sug = null, st = '';
    if (isT) {
      hand.forEach(function (c) { if (c.id === selected) selCard = c; });
      if (!selCard) selected = null;
      if (prefs.aide) sug = E.soloAdvice(hand, wr).card.id;
    }
    var base = selCard ? hand.filter(function (c) { return c !== selCard; }) : hand;
    var layout;
    if (done || prefs.aide) {
      var sol = E.solveHand(base, wr);
      layout = { groups: sol.groups, rest: sortHand(sol.rest, wr), penalty: sol.penalty };
    } else {
      layout = { groups: [], rest: sortHand(base, wr), penalty: null };
    }

    if (done) st = '<span class="st ok">✓ retournée</span>';
    else if (isT) {
      if (prefs.aide && selCard) st = layout.penalty === 0 ? '<span class="st gold">Se retourne !</span>' : '<span class="st">il resterait ' + layout.penalty + ' pts</span>';
      else if (prefs.aide) st = '<span class="st">point doré : conseil</span>';
    } else if (canPlace && hint) {
      st = hint.next === 0 ? '<span class="st gold">Se retourne !</span>' : '<span class="st">' + hint.cur + ' → ' + hint.next + ' pts</span>';
    } else if (prefs.aide) st = '<span class="st">isolées : ' + layout.penalty + ' pts</span>';

    function copt(c) { return { wr: wr, sel: isT && c.id === selected, sug: c.id === sug, pop: c.id === lastNewId }; }
    var h = '<div class="' + cls + '" data-h="' + i + '"><div class="hh"><b>' + (i + 3) + ' cartes</b>' +
            '<span class="wildbadge sm">♛ ' + E.rankLabel(wr) + ' = joker</span>' + st + '</div><div class="cards">';
    layout.groups.forEach(function (g) {
      h += '<div class="group small ' + g.kind + '">';
      g.cards.forEach(function (c) { h += cardHTML(c, copt(c)); });
      h += '</div>';
    });
    if (layout.rest.length) {
      h += '<div class="group rest small">';
      layout.rest.forEach(function (c) { h += cardHTML(c, copt(c)); });
      h += '</div>';
    }
    if (selCard) h += '<div class="group out small">' + cardHTML(selCard, copt(selCard)) + '</div>';
    return h + '</div></div>';
  }

  function renderSeul() {
    var nFlip = G.flipped.filter(Boolean).length;
    $('sSub').textContent = nFlip + ' / 11 mains retournées · pioche : ' + G.deck.length;

    // table : pioche, carte révélée, défausse
    $('sDeck').innerHTML = G.deck.length ? '<div class="cardback"></div><span class="count">' + G.deck.length + '</span>' : '<div class="emptyslot"></div>';
    if (G.drawn) { $('sDrawn').innerHTML = cardHTML(G.drawn, { wr: null, pop: G.drawn.id === lastNewId }); $('sDrawnLbl').textContent = 'Carte révélée'; }
    else { $('sDrawn').innerHTML = '<div class="emptyslot"></div>'; $('sDrawnLbl').textContent = G.phase === 'discard' ? 'Carte placée' : ''; }
    var top = G.discard[G.discard.length - 1];
    $('sDisc').innerHTML = top ? cardHTML(top, { wr: null }) + '<span class="count">' + G.discard.length + '</span>' : '<div class="emptyslot"></div>';

    // message
    var msg, alert = false, t = G.target;
    if (G.over) { msg = G.won ? 'Gagné ! Les 11 mains sont retournées.' : 'Perdu : la pioche est épuisée.'; alert = true; }
    else if (G.phase === 'place') {
      msg = (G.last ? G.last + ' ' : '') + 'Touche la main où placer ' + E.cardName(G.drawn) + '.';
      alert = /retournée/.test(G.last || '');
    } else msg = 'Main de ' + (t + 3) + ' cartes : choisis la carte à défausser.';
    $('sMsg').textContent = msg; $('sMsg').className = 'msg' + (alert ? ' alert' : '');

    // mains (on conserve la position de défilement)
    var hints = seulHintsFor(), box = $('sHands'), y = box.scrollTop, h = '';
    for (var i = 0; i < 11; i++) h += seulTile(i, hints);
    box.innerHTML = h;
    box.scrollTop = y;

    // boutons
    var act = $('sAction'), undo = $('sUndo');
    undo.hidden = G.phase !== 'discard';
    act.className = 'btn gold'; act.disabled = false;
    if (G.over) { act.textContent = 'Voir le résultat'; }
    else if (G.phase === 'place') {
      act.className = 'btn ghost';
      act.textContent = 'Défausser ' + E.cardName(G.drawn) + ' sans la jouer';
    } else {
      var card = null;
      G.hands[t].forEach(function (c) { if (c.id === selected) card = c; });
      if (!card) { act.textContent = 'Choisis une carte'; act.disabled = true; }
      else {
        var rest = G.hands[t].filter(function (c) { return c !== card; });
        var out = E.solveHand(rest, t + 3).penalty === 0;
        act.textContent = out ? 'Retourner la main en défaussant ' + E.cardName(card) : 'Défausser ' + E.cardName(card);
      }
    }
  }

  function seulEndHTML() {
    var n = G.flipped.filter(Boolean).length;
    var h = '<h2 class="serif">' + (G.won ? 'Gagné !' : 'Perdu') + '</h2>';
    if (G.won) h += '<p>Les 11 mains sont retournées en ' + G.turns + ' tours.</p>';
    else {
      var left = [];
      G.flipped.forEach(function (f, i) { if (!f) left.push(i + 3); });
      h += '<p>La pioche est épuisée : ' + plural(n, 'main retournée', 'mains retournées') + ' sur 11.</p>' +
           '<p>Mains restantes : ' + left.join(', ') + ' cartes.</p>';
    }
    return h + '<button class="btn gold js-again">Nouvelle partie</button><button class="btn ghost js-home">Accueil</button>';
  }
  function showEndSeul() {
    if (!G || !G.over || mode() !== 'seul') return;
    $('roundBody').innerHTML = seulEndHTML();
    if (!$('dlgRound').open) $('dlgRound').showModal();
  }

  function seulPlace(i) {
    if (!G || G.over || G.phase !== 'place' || G.flipped[i]) return;
    var id = G.drawn.id;
    if (!E.soloPlace(G, i)) return;
    selected = null; lastNewId = id; G.last = '';
    save(); renderAll(); lastNewId = null;
    var tile = $('sHands').querySelector('.htile[data-h="' + i + '"]');
    if (tile && tile.scrollIntoView) tile.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
  function seulDiscard() {
    if (!G || G.over || G.phase !== 'discard' || selected == null) return;
    var r = E.soloDiscard(G, selected);
    if (!r) return;
    selected = null;
    G.last = r.flipped ? 'Main de ' + (r.hand + 3) + ' cartes retournée !'
                       : 'Tu as défaussé ' + E.cardName(r.card) + '.';
    lastNewId = G.drawn ? G.drawn.id : null;
    save(); renderAll(); lastNewId = null;
    if (G.over) setTimeout(showEndSeul, 700);
  }
  function seulPass() {
    if (!G || G.over || G.phase !== 'place') return;
    var r = E.soloPass(G);
    if (!r) return;
    selected = null; G.last = 'Tu as défaussé ' + E.cardName(r.card) + '.';
    lastNewId = G.drawn ? G.drawn.id : null;
    save(); renderAll(); lastNewId = null;
    if (G.over) setTimeout(showEndSeul, 700);
  }

  /* ---------- Actions ---------- */
  function humanDraw(src) {
    if (!G || G.roundEnded || !G.human[G.turn] || G.phase !== 'draw' || veilOn()) return;
    if (src === 'discard' && !G.discard.length) return;
    var p = G.turn;
    var card = E.draw(G, src);
    lastNewId = card.id; selected = null; G.last = '';
    if (mode() === 'duo') reveal[p] = true;
    save(); renderAll();
    lastNewId = null;
  }
  function humanDiscard() {
    if (!G || G.roundEnded || !G.human[G.turn] || G.phase !== 'discard' || selected == null) return;
    var p = G.turn;
    var r = E.discard(G, selected);
    if (!r) return;
    selected = null;
    var solo = mode() === 'solo';
    G.last = r.wentOut ? (solo ? 'Tu es sorti !' : G.names[p] + ' est sorti !')
                       : (solo ? 'Tu as défaussé ' : G.names[p] + ' a défaussé ') + E.cardName(r.card) + '.';
    if (mode() === 'duo') reveal[p] = false;
    if (mode() === 'passe' && !G.roundEnded) G.veil = true;
    save(); renderAll();
    afterMove();
  }
  function afterMove() {
    if (mode() === 'seul') return;
    if (G.roundEnded) { setTimeout(showRound, 700); return; }
    tick();
  }
  function flash(el, txt) { el.textContent = txt; }

  function onHandClick(e, p, msgEl) {
    var el = e.target.closest('.card'); if (!el) return;
    if (veilOn() || G.roundEnded) return;
    if (mode() === 'duo' && !reveal[p]) return;
    if (arrOn[p] && customOrder(p)) { arrangeTap(p, +el.dataset.id); return; }   // mode rangement : on échange
    if (!isTurnOf(p) || G.phase !== 'discard') return;
    var id = +el.dataset.id;
    if (id === G.noDiscard) { flash(msgEl, 'Tu ne peux pas rejeter la carte que tu viens de prendre dans la défausse.'); return; }
    selected = (selected === id) ? null : id;
    renderAll();
  }

  /* ---------- Tours des adversaires ---------- */
  function describe(r) {
    var nm = G.names[r.p];
    if (r.wentOut) return nm + ' sort en défaussant ' + E.cardName(r.discarded) + ' !';
    return nm + (r.src === 'discard' ? ' a pris ' + E.cardName(r.drawn) + ' dans la défausse' : ' a pioché') + ' et défaussé ' + E.cardName(r.discarded) + '.';
  }
  async function tick() {
    if (running || !G || mode() === 'seul') return;
    running = true;
    try {
      while (G && !G.roundEnded && !G.human[G.turn]) {
        renderAll();
        await sleep(G.n > 4 ? 650 : 950);
        if (!G) break;
        var r = E.botPlay(G);
        G.last = describe(r);
        save(); renderAll();
      }
    } finally { running = false; }
    if (G && G.roundEnded) setTimeout(showRound, 900);
    else if (G) renderAll();
  }

  /* ---------- Scores, fin de manche, fin de partie ---------- */
  function scoresTable() {
    var h = '<table class="sc' + (G.n > 4 ? ' many' : '') + '"><tr><th></th>', p;
    for (p = 0; p < G.n; p++) h += '<th>' + esc(G.names[p]) + '</th>';
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
  function showScores(rot) {
    $('scoresBody').innerHTML = scoresTable();
    $('dlgScores').style.transform = rot ? 'rotate(180deg)' : '';
    $('dlgScores').showModal();
  }

  function roundHTML(compact) {
    var h = '', p;
    if (G.over) {
      var order = G.scores.map(function (s, i) { return { s: s, i: i }; }).sort(function (a, b) { return a.s - b.s; });
      h += '<h2 class="serif">Fin de partie</h2>';
      order.forEach(function (o, k) {
        var tie = k > 0 && o.s === order[0].s;
        var medal = (k === 0 || tie) ? '🏆' : (k + 1) + '.';
        h += '<div class="rank' + ((k === 0 || tie) ? ' win' : '') + '"><span class="pos">' + medal + '</span><span class="n">' + esc(G.names[o.i]) + '</span><b>' + o.s + ' pts</b></div>';
      });
      var w = order[0].i;
      var tied = order.length > 1 && order[1].s === order[0].s;
      h += '<p>' + (tied ? 'Égalité !' : (mode() === 'solo' && G.human[w]) ? 'Bravo, tu gagnes la partie !' : esc(G.names[w]) + ' gagne la partie.') + '</p>';
      if (!compact) h += scoresTable();
      h += '<button class="btn gold js-again">Nouvelle partie</button><button class="btn ghost js-home">Accueil</button>';
    } else {
      h += '<h2 class="serif">Manche ' + (G.round + 1) + ' terminée</h2>';
      G.results.forEach(function (r, q) {
        h += '<div class="resrow"><div class="hd"><span>' + esc(G.names[q]) + (r.out ? ' · sorti' : '') + '</span><span class="pts' + (r.penalty === 0 ? ' zero' : '') + '">+' + r.penalty + ' pts</span></div><div class="minihand">';
        r.groups.forEach(function (g) { h += groupHTML(g, true); });
        if (r.rest.length) { h += '<div class="group rest small">'; sortHand(r.rest).forEach(function (c) { h += cardHTML(c); }); h += '</div>'; }
        h += '</div></div>';
      });
      if (compact) {
        h += '<div class="totline">' + G.names.map(function (n, q) { return esc(n) + ' <b>' + G.scores[q] + '</b>'; }).join(' · ') + '</div>';
      } else h += scoresTable();
      h += '<button class="btn gold js-next">Manche suivante</button>';
    }
    return h;
  }
  function showRound() {
    if (!G || !G.roundEnded) return;
    if (mode() === 'duo') {
      $('rpTop').innerHTML = roundHTML(true);
      $('rpBottom').innerHTML = roundHTML(true);
      $('duoRound').hidden = false;
    } else {
      $('roundBody').innerHTML = roundHTML(false);
      if (!$('dlgRound').open) $('dlgRound').showModal();
    }
  }
  function closeRound() {
    $('duoRound').hidden = true;
    if ($('dlgRound').open) $('dlgRound').close();
  }

  /* ---------- Navigation ---------- */
  function showGame() {
    $('home').hidden = true;
    $('game').hidden = mode() === 'duo' || mode() === 'seul';
    $('duo').hidden = mode() !== 'duo';
    $('seul').hidden = mode() !== 'seul';
  }
  function goHome() {
    if (G && G.over) clearSave();
    G = null; selected = null; seulHints = null; arrOn = {}; arrSel = {};
    $('game').hidden = true; $('duo').hidden = true; $('seul').hidden = true; $('veil').hidden = true; $('duoRound').hidden = true;
    $('home').hidden = false; refreshHome();
  }
  function startNew() {
    var names, human, i;
    if (prefs.mode === 'seul') {
      G = E.newSolitaire();
      selected = null; seulHints = null; arrOn = {}; arrSel = {};
      save(); showGame(); renderAll();
      if (G.over) showEndSeul();
      return;
    }
    if (prefs.mode === 'solo') {
      names = ['Toi']; human = [true];
      for (i = 0; i < prefs.opp; i++) { names.push(BOT_NAMES[i]); human.push(false); }
    } else {
      var a = (prefs.n1 || '').trim() || 'Joueur 1', b = (prefs.n2 || '').trim() || 'Joueur 2';
      if (a === b) b += ' (2)';
      names = [a, b]; human = [true, true];
    }
    G = E.newGame(names, human);
    G.mode = prefs.mode;
    G.veil = prefs.mode === 'passe';
    selected = null; reveal = [false, false]; arrOn = {}; arrSel = {};
    save(); showGame(); renderAll(); afterMove();
  }
  function refreshHome() {
    var s = loadSave();
    $('btnResume').hidden = !(s && !s.over);
    document.querySelectorAll('#segOpp button').forEach(function (b) { b.classList.toggle('on', +b.dataset.n === prefs.opp); });
    document.querySelectorAll('#segMode button').forEach(function (b) { b.classList.toggle('on', b.dataset.m === prefs.mode); });
    $('optSolo').hidden = prefs.mode !== 'solo';
    $('optNames').hidden = prefs.mode !== 'passe' && prefs.mode !== 'duo';
    $('n1').value = prefs.n1; $('n2').value = prefs.n2;
    $('swAide').classList.toggle('on', prefs.aide);
    $('swAide2').classList.toggle('on', prefs.aide);
  }
  function setAide(v) {
    prefs.aide = v; savePrefs();
    $('swAide').classList.toggle('on', v); $('swAide2').classList.toggle('on', v);
    if (G) renderAll();
  }

  /* ---------- Branchements ---------- */
  function bind() {
    loadPrefs();
    document.querySelectorAll('#segOpp button').forEach(function (b) {
      b.onclick = function () { prefs.opp = +b.dataset.n; savePrefs(); refreshHome(); };
    });
    document.querySelectorAll('#segMode button').forEach(function (b) {
      b.onclick = function () { prefs.mode = b.dataset.m; savePrefs(); refreshHome(); };
    });
    $('n1').oninput = function () { prefs.n1 = this.value.slice(0, 14); savePrefs(); };
    $('n2').oninput = function () { prefs.n2 = this.value.slice(0, 14); savePrefs(); };
    $('swAide').onclick = function () { setAide(!prefs.aide); };
    $('swAide2').onclick = function () { setAide(!prefs.aide); };
    $('btnNew').onclick = function () {
      var s = loadSave();
      if (s && !s.over && !confirm('Une partie est en cours. La remplacer par une nouvelle ?')) return;
      startNew();
    };
    $('btnResume').onclick = function () {
      G = loadSave(); if (!G) return;
      selected = null; reveal = [false, false]; seulHints = null; arrOn = {}; arrSel = {};
      showGame(); renderAll();
      if (mode() === 'seul') { if (G.over) showEndSeul(); return; }
      if (G.roundEnded) showRound(); else tick();
    };
    $('btnRules').onclick = function () { $('dlgRules').showModal(); };
    $('btnMenuRules').onclick = function () { $('dlgMenu').close(); $('dlgRules').showModal(); };
    $('btnScores').onclick = function () { showScores(false); };
    $('btnMenu').onclick = function () { $('dlgMenu').showModal(); };
    $('btnMenuDuo').onclick = function () { $('dlgMenu').showModal(); };
    $('btnMenuSeul').onclick = function () { $('dlgMenu').showModal(); };
    $('btnQuit').onclick = function () { $('dlgMenu').close(); goHome(); };
    $('dlgScores').addEventListener('close', function () { this.style.transform = ''; });
    document.querySelectorAll('[data-close]').forEach(function (b) { b.onclick = function () { b.closest('dialog').close(); }; });

    // piles (deux jeux de boutons : vue normale et vue face à face)
    ['pileDeck', 'duoPileDeck'].forEach(function (id) { $(id).onclick = function () { humanDraw('deck'); }; });
    ['pileDiscard', 'duoPileDiscard'].forEach(function (id) { $(id).onclick = function () { humanDraw('discard'); }; });

    // vue normale
    $('hand').onclick = function (e) { onHandClick(e, viewer(), $('msg')); };
    $('btnAction').onclick = function () { if (G.roundEnded) showRound(); else humanDiscard(); };
    $('btnVeil').onclick = function () { G.veil = false; save(); renderAll(); };

    // variante solitaire
    $('sHands').onclick = function (e) {
      if (!G || mode() !== 'seul' || G.over) return;
      var tile = e.target.closest('.htile'); if (!tile) return;
      var i = +tile.dataset.h;
      if (G.phase === 'place') seulPlace(i);
      else if (G.phase === 'discard' && i === G.target) {
        var el = e.target.closest('.card'); if (!el) return;
        var id = +el.dataset.id;
        selected = (selected === id) ? null : id;
        renderAll();
      }
    };
    $('sAction').onclick = function () {
      if (!G || mode() !== 'seul') return;
      if (G.over) showEndSeul();
      else if (G.phase === 'place') seulPass();
      else seulDiscard();
    };
    $('sUndo').onclick = function () {
      if (!G || mode() !== 'seul' || !E.soloUndo(G)) return;
      selected = null; G.last = '';
      save(); renderAll();
    };

    // vue face à face (délégation sur chaque siège)
    [0, 1].forEach(function (p) {
      var seat = $('seat' + p);
      seat.querySelector('.hand').onclick = function (e) { onHandClick(e, p, seat.querySelector('.msg')); };
      seat.querySelector('.js-reveal').onclick = function () { reveal[p] = !reveal[p]; renderAll(); };
      seat.querySelector('.js-action').onclick = function () {
        if (G.roundEnded) { showRound(); return; }
        if (G.turn === p) humanDiscard();
      };
      seat.querySelector('.seathead').onclick = function (e) {
        if (e.target.closest('.js-scores')) showScores(p === 1);
      };
    });

    // boutons de rangement (vue normale et sièges du face à face)
    document.addEventListener('click', function (e) {
      var b = e.target.closest('.js-arr, .js-auto');
      if (!b || !G || mode() === 'seul' || G.roundEnded) return;
      var seat = b.closest('.seat'), p = seat ? (seat.id === 'seat1' ? 1 : 0) : viewer();
      if (b.classList.contains('js-arr')) toggleArrange(p); else autoSort(p);
    });

    // boutons de fin de manche / de partie (dialogue et vue face à face)
    document.addEventListener('click', function (e) {
      var t = e.target.closest('.js-next, .js-again, .js-home');
      if (!t || !G) return;
      if (t.classList.contains('js-next')) {
        closeRound(); E.nextRound(G); G.order = []; arrOn = {}; arrSel = {}; selected = null; reveal = [false, false];
        if (mode() === 'passe') G.veil = true;
        save(); renderAll(); afterMove();
      } else if (t.classList.contains('js-again')) { closeRound(); startNew(); }
      else { closeRound(); goHome(); }
    });

    document.addEventListener('visibilitychange', function () {
      if (!document.hidden && G && mode() !== 'seul' && !G.roundEnded && !G.human[G.turn]) tick();
    });

    refreshHome();
    if ('serviceWorker' in navigator && location.protocol.indexOf('http') === 0) {
      navigator.serviceWorker.register('sw.js').catch(function () {});
    }
  }
  bind();
})();
