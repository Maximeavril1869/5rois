/* 5 Rois — interface. Tout est local : la partie est sauvegardée dans le navigateur (localStorage).
   Trois modes : contre l'ordinateur ('solo'), en ligne à deux sur deux appareils ('online'), et la variante
   solitaire à une personne ('seul'). Le mode en ligne synchronise l'état complet via Supabase (voir en-ligne.js).
   Aides réglables une à une (solo et en ligne, choisies à la création ; en ligne, l'hôte décide pour les deux) : groupes, décompte des points,
   défausse conseillée, affichage du joker, indice de sortie, dernières cartes prises. */
(function () {
  'use strict';
  var E = window.Engine;
  var SAVE_KEY = 'cinqrois_partie_v1', PREF_KEY = 'cinqrois_prefs_v1', OKEY = 'cinqrois_online_v1', APP_VERSION = '15';
  var EL = window.EnLigne;
  var ONL = null;            // partie en ligne : { id, me, version, dirty, pushing, status, watch, retry }
  var BOT_NAMES = ['Camille', 'Hugo', 'Léa', 'Noé', 'Inès', 'Louis'];   // jusqu'à 6 adversaires (7 joueurs)

  var G = null;              // état de la partie (sérialisable)
  var selected = null;       // id de la carte sélectionnée (joueur dont c'est le tour)
  var running = false;       // boucle des adversaires en cours
  var lastNewId = null;
  var seulHints = null;      // variante solitaire : pénalité atteignable par main avec la carte révélée
  var arrOn = {}, arrSel = {}; // rangement manuel : mode actif et première carte touchée, par joueur
  var OPT_DEF = { groupes: true, points: true, defausse: true, joker: true, sortie: true, prises: false };
  var prefs = { aide: true, opp: 2, mode: 'solo', n1: 'Joueur 1', opts: copyOpts(OPT_DEF) };   // aide : variante solitaire seulement
  function copyOpts(o) { var r = {}; Object.keys(OPT_DEF).forEach(function (k) { r[k] = o && o[k] !== undefined ? !!o[k] : OPT_DEF[k]; }); return r; }

  function $(id) { return document.getElementById(id); }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function mode() { return (G && G.mode) || 'solo'; }

  /* ---------- Sauvegarde ---------- */
  function save() {
    if (G && G.mode === 'online') { if (ONL) { ONL.dirty = true; pushState(); } return; }   // une partie en ligne vit sur le serveur
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(G)); } catch (e) {}
  }
  function loadSave() { try { var s = localStorage.getItem(SAVE_KEY); return s ? JSON.parse(s) : null; } catch (e) { return null; } }
  function clearSave() { try { localStorage.removeItem(SAVE_KEY); } catch (e) {} }
  function savePrefs() { try { localStorage.setItem(PREF_KEY, JSON.stringify(prefs)); } catch (e) {} }
  function loadPrefs() {
    try {
      var p = JSON.parse(localStorage.getItem(PREF_KEY));
      if (p) {
        prefs.aide = p.aide !== false; prefs.opp = Math.min(6, Math.max(1, p.opp || 2));
        if (p.mode === 'passe' || p.mode === 'duo') prefs.mode = 'online'; else if (p.mode === 'online' || p.mode === 'seul') prefs.mode = p.mode;
        if (p.n1) prefs.n1 = p.n1;
        if (p.opts) prefs.opts = copyOpts(p.opts);
        else {                 // anciens réglages (v8 / v9)
          if (p.aide === false) prefs.opts.groupes = prefs.opts.points = prefs.opts.defausse = false;
          if (p.difficile) prefs.opts.groupes = prefs.opts.points = prefs.opts.defausse = prefs.opts.joker = prefs.opts.sortie = false;
          if (p.facile) prefs.opts.prises = true;
        }
      }
    } catch (e) {}
  }

  /* ---------- Cartes en HTML ---------- */
  function cardHTML(c, o) {
    o = o || {};
    var cls = ['card'];
    var wr = o.wr !== undefined ? o.wr : G.wild;   // valeur de joker de la manche (propre à chaque main en solitaire)
    if (c.rank === 0) cls.push('joker');
    if (E.isWild(c, wr) && showJoker()) cls.push('wild');
    if (o.sel) cls.push('sel');
    if (o.sug) cls.push('sug');
    if (o.lock) cls.push('lock');
    if (o.pop) cls.push('pop');
    if (o.dual) cls.push('dual');
    if (o.gone) cls.push('gone');
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
      var wa = showJoker() && E.isWild(a, wr) ? 1 : 0, wb = showJoker() && E.isWild(b, wr) ? 1 : 0;   // joker non affiché : aucun indice par le tri
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

  // Options d'aide de la partie (G.opts, fixées à la création). Anciennes parties : v8 « facile » / v9 « difficile » converties.
  function curOpts() {
    if (G && G.opts) return G.opts;
    var d = copyOpts(OPT_DEF);
    if (G && G.difficile) d.groupes = d.points = d.defausse = d.joker = d.sortie = false;
    if (G && G.facile) d.prises = true;
    return d;
  }
  function opt(k) { return !!curOpts()[k]; }
  function showJoker() { return mode() === 'seul' || opt('joker'); }

  /* ---------- Qui regarde ? ---------- */
  function viewer() {
    if (mode() === 'online') return ONL ? ONL.me : 0;
    for (var i = 0; i < G.n; i++) if (G.human[i]) return i;
    return 0;
  }
  function isTurnOf(p) { return !!G && !G.roundEnded && G.turn === p && G.human[p] && (mode() !== 'online' || p === viewer()); }
  function canAct() { return !!G && !G.roundEnded && G.human[G.turn] && (mode() !== 'online' || G.turn === viewer()); }

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

  // Option « dernières cartes prises » : dernière carte prise dans la défausse par le joueur p (estompée si elle n'est plus dans sa main)
  function takenHTML(p) {
    if (!G || !opt('prises')) return '';
    var c = G.taken && G.taken[p];
    if (!c) return '<div class="taken">Prise : —</div>';
    var gone = !G.hands[p].some(function (x) { return x.id === c.id; });
    return '<div class="taken">Prise :' + cardHTML(c, { gone: gone }) + '</div>';
  }
  function renderPiles(ids) {
    var canDraw = canAct() && G.phase === 'draw';
    $(ids.deck).innerHTML = '<div class="cardback"></div><span class="count">' + G.deck.length + '</span>';
    var top = G.discard[G.discard.length - 1];
    $(ids.disc).innerHTML = top ? cardHTML(top) : '<div class="emptyslot"></div>';
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
    if (opt('groupes')) {
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
    if (choosing && selected != null) hand.forEach(function (c) { if (c.id === selected) selCard = c; });
    var base = selCard ? hand.filter(function (c) { return c !== selCard; }) : hand;
    var sol = E.solveHand(base, G.wild);
    layout = opt('groupes') ? { groups: sol.groups, rest: sortHand(sol.rest), penalty: sol.penalty } : { groups: [], rest: sortHand(hand), penalty: sol.penalty };
    if (choosing && opt('defausse')) sug = E.bestDiscard(hand, G.wild, G.noDiscard).card.id;
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
        if (opt('groupes')) h += '<div class="group rest">';
        layout.rest.forEach(function (c) { h += cardHTML(c, opts(c)); });
        if (opt('groupes')) h += '</div>';
      }
      if (selCard && opt('groupes')) h += '<div class="group out">' + cardHTML(selCard, opts(selCard)) + '</div>';
    }
    handEl.innerHTML = h;

    if (arranging) {
      info = arrSel[p] != null ? 'Touche la carte avec laquelle l’échanger' : 'Touche deux cartes pour les échanger de place';
      if (opt('points')) info += ' · isolées : <b>' + E.solveHand(hand, G.wild).penalty + ' pts</b>';
    } else if (choosing) {
      if (selCard) {
        if (layout.penalty === 0 && opt('sortie')) info = '<b>Tu peux sortir</b> en défaussant cette carte';
        else if (opt('points')) info = 'En défaussant cette carte, il te resterait <b>' + layout.penalty + ' pts</b>';
      } else if (opt('defausse')) info = 'Le point doré marque la défausse conseillée';
    } else if (opt('points')) info = 'Cartes isolées : <b>' + layout.penalty + ' pts</b>';
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
    var out = opt('sortie') && G.outBy < 0 && E.solveHand(rest, G.wild).penalty === 0;
    btn.textContent = out ? 'Sortir en défaussant ' + E.cardName(card) : 'Défausser ' + E.cardName(card);
    btn.disabled = false;
  }

  /* ---------- Affichage : contre l'ordinateur / en ligne ---------- */
  function renderSolo() {
    var v = viewer();
    $('roundTitle').textContent = 'Manche ' + (G.round + 1) + ' / 11';
    $('roundSub').textContent = G.cards + ' cartes · ' + (mode() === 'solo' ? 'toi' : G.names[v]) + ' : ' + G.scores[v] + ' pts';
    $('wildBadge').hidden = !opt('joker');
    $('wildBadge').textContent = opt('joker') ? '♛ ' + E.rankLabel(G.wild) + ' = joker' : '';
    var h = '';
    for (var p = 0; p < G.n; p++) {
      if (p === v) continue;
      var n = G.hands[p].length, fan = '';
      for (var k = 0; k < Math.min(n, 14); k++) fan += '<i></i>';
      h += '<div class="opp' + (G.turn === p && !G.roundEnded ? ' turn' : '') + '">' +
           '<div class="nm"><span>' + esc(G.names[p]) + '</span>' + (G.outBy === p ? '<span class="tag">SORTI</span>' : '') + '</div>' +
           '<div class="sc">' + G.scores[p] + ' pts</div><div class="fan">' + fan + '</div>' + takenHTML(p) + '</div>';
    }
    $('opps').innerHTML = h;
    $('opps').className = 'opps' + (G.n > 4 ? ' many' : '');
    renderPiles({ deck: 'deckVisual', disc: 'discardVisual', bdeck: 'pileDeck', bdisc: 'pileDiscard' });
    var m = msgFor(v);
    $('msg').textContent = m.txt; $('msg').className = 'msg' + (m.alert ? ' alert' : '');
    renderHandInto(v, $('hand'), $('handInfo'), false, $('arrbar'));
    fillAction(v, $('btnAction'), false);
  }

  function renderAll() {
    if (!G) return;
    $('swAide2').parentNode.hidden = mode() !== 'seul';   // solo / en ligne : aides fixées à la création
    if (mode() === 'seul') renderSeul();
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
    if (!canAct() || G.phase !== 'draw') return;
    if (src === 'discard' && !G.discard.length) return;
    var p = G.turn;
    var card = E.draw(G, src);
    lastNewId = card.id; selected = null; G.last = '';
    save(); renderAll();
    lastNewId = null;
  }
  function humanDiscard() {
    if (!canAct() || G.phase !== 'discard' || selected == null) return;
    var p = G.turn;
    var r = E.discard(G, selected);
    if (!r) return;
    selected = null;
    var solo = mode() === 'solo';
    G.last = r.wentOut ? (solo ? 'Tu es sorti !' : G.names[p] + ' est sorti !')
                       : (solo ? 'Tu as défaussé ' : G.names[p] + ' a défaussé ') + E.cardName(r.card) + '.';
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
    if (G.roundEnded) return;
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
    if (mode() === 'online' && (!ONL || ONL.me !== 0 || !G.online.joined)) return;   // en ligne : seul l'hôte joue les ordinateurs
    running = true;
    try {
      while (G && !G.roundEnded && !G.human[G.turn]) {
        renderAll();
        await sleep(window.BOT_DELAY != null ? window.BOT_DELAY : (G.n > 4 ? 650 : 950));
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
    $('roundBody').innerHTML = roundHTML(false);
    if (!$('dlgRound').open) $('dlgRound').showModal();
  }
  function closeRound() {
    if ($('dlgRound').open) $('dlgRound').close();
  }

  /* ---------- Navigation ---------- */
  function showGame() {
    $('home').hidden = true;
    $('game').hidden = mode() === 'seul';
    $('seul').hidden = mode() !== 'seul';
  }
  function goHome() {
    if (ONL) onlineStop();
    else if (G && G.over) clearSave();
    G = null; selected = null; seulHints = null; arrOn = {}; arrSel = {};
    $('game').hidden = true; $('seul').hidden = true; closeRound();
    $('home').hidden = false; refreshHome();
  }
  function startNew() {
    var names, human, i;
    if (prefs.mode === 'online') { onlineCreate(); return; }
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
    }
    G = E.newGame(names, human);
    G.mode = prefs.mode;
    G.opts = copyOpts(prefs.opts);
    selected = null; arrOn = {}; arrSel = {};
    save(); showGame(); renderAll(); afterMove();
  }
  function refreshHome() {
    var s = loadSave();
    $('btnResume').hidden = !(s && !s.over && (s.mode === 'solo' || s.mode === 'seul'));
    document.querySelectorAll('#segOpp button').forEach(function (b) { b.classList.toggle('on', +b.dataset.n === prefs.opp); });
    document.querySelectorAll('#segMode button').forEach(function (b) { b.classList.toggle('on', b.dataset.m === prefs.mode); });
    var onl = prefs.mode === 'online';
    $('optSolo').hidden = prefs.mode !== 'solo' && !onl;
    $('optNames').hidden = !onl;
    $('optAides').hidden = prefs.mode === 'seul'; $('optAideSeul').hidden = prefs.mode !== 'seul';
    document.querySelectorAll('[data-opt]').forEach(function (b) { b.classList.toggle('on', !!prefs.opts[b.dataset.opt]); });
    $('optAidesSum').textContent = 'Aides · ' + Object.keys(OPT_DEF).filter(function (k) { return prefs.opts[k]; }).length + ' sur 6 actives';
    $('onlinePanel').hidden = !onl;
    document.querySelector('#segOpp [data-n="0"]').hidden = !onl;
    document.querySelector('#segOpp [data-n="6"]').hidden = onl;
    var lo = onl ? 0 : 1, hi = onl ? 5 : 6;
    prefs.opp = Math.max(lo, Math.min(hi, prefs.opp | 0));
    document.querySelectorAll('#segOpp button').forEach(function (b) { b.classList.toggle('on', +b.dataset.n === prefs.opp); });
    $('btnNew').textContent = onl ? 'Créer une partie en ligne' : 'Nouvelle partie';
    $('btnNew').disabled = onl && !EL.connecte();
    $('btnResume').hidden = onl || $('btnResume').hidden;
    $('n1').value = prefs.n1;
    $('ver').textContent = 'Version ' + APP_VERSION;
    if (onl) olRender();
    $('swAide').classList.toggle('on', prefs.aide);
    $('swAide2').classList.toggle('on', prefs.aide);
  }
  function setAide(v) {
    prefs.aide = v; savePrefs();
    $('swAide').classList.toggle('on', v); $('swAide2').classList.toggle('on', v);
    if (G) renderAll();
  }

  /* ---------- En ligne ---------- */
  function olMsg(t) { var e = $('olErr'); e.hidden = !t; e.textContent = t || ''; }
  function olError(e) {
    if (e && e.kind === 'auth') { olMsg('Session expirée : reconnecte-toi.'); olRender(); }
    else if (e && e.kind === 'reseau') olMsg('Pas de réseau : impossible de joindre le service pour l\'instant.');
    else olMsg('Erreur : ' + (e && e.message ? e.message : 'inconnue'));
  }
  function olRender() {
    var inn = EL.connecte();
    $('olLogin').hidden = inn; $('olIn').hidden = !inn;
    $('btnNew').disabled = !inn;
    if (inn) { $('olWho').textContent = EL.email(); olList(); }
  }
  function olList() {
    EL.liste('cinqrois').then(function (a) {
      var h = '';
      a.forEach(function (r) {
        h += '<div class="olitem"><div class="t"><b>' + esc(r.id) + '</b><small>' + esc(r.titre || '') + '</small></div>' +
          '<button data-ol="resume" data-id="' + esc(r.id) + '">Reprendre</button><button data-ol="del" data-id="' + esc(r.id) + '" aria-label="Supprimer la partie ' + esc(r.id) + '">✕</button></div>';
      });
      $('olList').innerHTML = h || '<p class="olwho" style="margin:0">Aucune pour l\'instant.</p>';
    }).catch(olError);
  }
  function getMap() { try { return JSON.parse(localStorage.getItem(OKEY)) || {}; } catch (e) { return {}; } }
  function setMap(id, me) { var m = getMap(); m[id] = me; try { localStorage.setItem(OKEY, JSON.stringify(m)); } catch (e) { /* rien */ } }
  function titre() {
    return G.names.filter(function (n, i) { return G.human[i] && n !== '…'; }).join(' et ') + ' · ' + (G.online && G.online.joined ? 'manche ' + (G.round + 1) : 'en attente') + (G.over ? ' (terminée)' : '');
  }
  function stateForServer() {      // l'ordre de rangement des cartes reste propre à chaque appareil
    var o = G.order; delete G.order;
    var c = JSON.parse(JSON.stringify(G));
    if (o) G.order = o;
    return c;
  }
  function onlineStart(id, me, version) {
    onlineStop();
    ONL = { id: id, me: me, version: version, dirty: false, pushing: false, status: 'ok', watch: null, retry: null };
    setMap(id, me);
    ONL.watch = EL.surveiller(id, function () { return ONL ? ONL.version : 0; }, onRemote, onStatus);
  }
  function onlineStop() {
    if (ONL) { if (ONL.watch) ONL.watch.stop(); clearTimeout(ONL.retry); }
    ONL = null;
    $('offbar').hidden = true; $('wait').hidden = true;
  }
  function onStatus(st) {
    if (!ONL) return;
    ONL.status = st;
    $('offbar').hidden = st !== 'hors-ligne';
    if (st === 'supprimee') { goHome(); olMsg('Cette partie a été supprimée.'); return; }
    if (st === 'auth') { goHome(); olError({ kind: 'auth' }); return; }
    if (st === 'ok' && ONL.dirty && !ONL.pushing) pushState();
  }
  function onlineShow() {          // affiche G selon son avancement : salle d'attente ou partie
    if (!G.online.joined) { $('waitCode').textContent = ONL.id; $('wait').hidden = false; return; }
    $('wait').hidden = true;
    showGame();
    if (!G.roundEnded) closeRound();
    renderAll();
    if (G.roundEnded) showRound(); else tick();
  }
  function takeRemote(row) {       // l'état du serveur remplace le nôtre (nos rangements de cartes sont conservés)
    var ord = G && G.order;
    G = row.etat; G.order = ord || [];
    ONL.version = row.version; selected = null;
  }
  function onRemote() {
    var o = ONL;
    if (!o || o.pushing || o.dirty) return;
    return EL.lire(o.id).then(function (row) {
      if (ONL !== o || !row || row.version <= o.version || o.pushing || o.dirty) return;
      takeRemote(row);
      onlineShow();
    });
  }
  function pushState() {
    var o = ONL;
    if (!o || o.pushing || !o.dirty) return;
    o.pushing = true; o.dirty = false;
    EL.ecrire(o.id, o.version, stateForServer(), titre()).then(function (nv) {
      if (ONL !== o) return;
      o.pushing = false;
      if (nv) { o.version = nv; if (o.status === 'hors-ligne') onStatus('ok'); if (o.dirty) pushState(); return; }
      // conflit : l'autre appareil a écrit avant nous. Son état l'emporte, notre action est annulée.
      return EL.lire(o.id).then(function (row) {
        if (ONL !== o || !row) return;
        o.dirty = false; takeRemote(row);
        if (G.online.uids.indexOf(EL.uid()) < 0) { goHome(); olMsg('Cette partie a déjà ses deux joueurs.'); return; }
        if (!G.roundEnded) G.last = 'Ton action a été annulée : l\'autre appareil a joué en même temps.';
        onlineShow();
      });
    }).catch(function (e) {
      if (ONL !== o) return;
      o.pushing = false; o.dirty = true;
      onStatus(e && e.kind === 'reseau' ? 'hors-ligne' : 'erreur');
      if (e && e.kind === 'auth') return;
      clearTimeout(o.retry);
      o.retry = setTimeout(function () { if (ONL === o) pushState(); }, 2000);
    });
  }
  function onlineCreate() {
    var nm = (prefs.n1 || '').trim() || 'Joueur 1', names = [nm, '…'], human = [true, true], i;
    for (i = 0; i < prefs.opp; i++) { names.push(BOT_NAMES[i]); human.push(false); }
    var g = E.newGame(names, human);
    g.mode = 'online'; g.online = { uids: [EL.uid(), null], joined: false }; g.opts = copyOpts(prefs.opts);
    EL.creer('cinqrois', g, nm + ' · en attente').then(function (r) {
      G = g; onlineStart(r.id, 0, r.version); onlineShow();
    }).catch(olError);
  }
  function restartOnline() {       // « Nouvelle partie » en ligne : même code, mêmes joueurs, scores remis à zéro
    var o = G.online, op = copyOpts(curOpts()), ng = E.newGame(G.names.slice(), G.human.slice());
    G = ng; G.mode = 'online'; G.online = o; G.opts = op; G.order = []; selected = null; arrOn = {}; arrSel = {};
    save(); onlineShow();
  }
  function seatFor(id, g) {
    var m = getMap(), me = m[id];
    if (me == null && g.online) { var k = g.online.uids.indexOf(EL.uid()); if (k >= 0) me = k; }
    return me;
  }
  function onlineJoin(code) {
    code = (code || '').trim().toUpperCase();
    if (code.length !== 4) { olMsg('Le code a 4 lettres.'); return; }
    olMsg('');
    EL.lire(code).then(function (row) {
      if (!row || row.jeu !== 'cinqrois') { olMsg('Code inconnu.'); return; }
      var g = row.etat, me = seatFor(code, g);
      if (me != null && (g.online.joined || me === 0)) { G = g; onlineStart(code, me, row.version); G.order = []; onlineShow(); return; }
      if (g.online.joined) { olMsg('Cette partie a déjà ses deux joueurs.'); return; }
      var nm = (prefs.n1 || '').trim() || 'Joueur 2';
      if (nm === g.names[0]) nm += ' (2)';
      G = g; G.order = []; onlineStart(code, 1, row.version);
      G.names[1] = nm; G.online.uids[1] = EL.uid(); G.online.joined = true;
      save(); onlineShow();
    }).catch(olError);
  }
  function onlineResume(id) {
    olMsg('');
    EL.lire(id).then(function (row) {
      if (!row) { olMsg('Partie introuvable.'); olList(); return; }
      var me = seatFor(id, row.etat);
      G = row.etat; G.order = []; onlineStart(row.id, me != null ? me : 0, row.version); onlineShow();
    }).catch(olError);
  }
  window.addEventListener('offline', function () { if (ONL) onStatus('hors-ligne'); });
  window.addEventListener('online', function () { if (ONL && ONL.watch) ONL.watch.poke(); });
  $('btnOlLogin').addEventListener('click', function () {
    olMsg('');
    EL.login($('olEmail').value.trim(), $('olPwd').value).then(function () { $('olPwd').value = ''; olRender(); }).catch(function (e) {
      olMsg(e.kind === 'bad' ? 'E-mail ou mot de passe refusé.' : e.kind === 'reseau' ? 'Pas de réseau.' : 'Erreur : ' + e.message);
    });
  });
  $('btnOlLogout').addEventListener('click', function () { EL.logout(); olMsg(''); olRender(); });
  $('btnOlJoin').addEventListener('click', function () { onlineJoin($('olCode').value); });
  $('olList').addEventListener('click', function (ev) {
    var b = ev.target.closest('button[data-ol]'); if (!b) return;
    var id = b.getAttribute('data-id');
    if (b.getAttribute('data-ol') === 'resume') onlineResume(id);
    else if (confirm('Supprimer la partie ' + id + ' pour les deux joueurs ?')) EL.supprimer(id).then(olList).catch(olError);
  });
  $('btnWaitCancel').addEventListener('click', function () {
    var id = ONL && ONL.id;
    goHome();
    if (id && confirm('Supprimer la partie ' + id + ' ?')) EL.supprimer(id).catch(function () { /* déjà partie */ });
  });
  $('btnWaitHome').addEventListener('click', goHome);

  /* ---------- Branchements ---------- */
  function bind() {
    loadPrefs();
    document.querySelectorAll('#segOpp button').forEach(function (b) {
      b.onclick = function () { prefs.opp = +b.dataset.n; savePrefs(); refreshHome(); };
    });
    document.querySelectorAll('#segMode button').forEach(function (b) {
      b.onclick = function () { prefs.mode = b.dataset.m; savePrefs(); olMsg(''); refreshHome(); };
    });
    $('n1').oninput = function () { prefs.n1 = this.value.slice(0, 14); savePrefs(); };
    $('swAide').onclick = function () { setAide(!prefs.aide); };
    $('swAide2').onclick = function () { setAide(!prefs.aide); };
    document.querySelectorAll('[data-opt]').forEach(function (b) {
      b.onclick = function () { prefs.opts[b.dataset.opt] = !prefs.opts[b.dataset.opt]; savePrefs(); refreshHome(); };
    });
    $('btnNew').onclick = function () {
      var s = loadSave();
      if (prefs.mode !== 'online' && s && !s.over && !confirm('Une partie est en cours. La remplacer par une nouvelle ?')) return;
      startNew();
    };
    $('btnResume').onclick = function () {
      G = loadSave(); if (!G) return;
      selected = null; seulHints = null; arrOn = {}; arrSel = {};
      showGame(); renderAll();
      if (mode() === 'seul') { if (G.over) showEndSeul(); return; }
      if (G.roundEnded) showRound(); else tick();
    };
    $('btnRules').onclick = function () { $('dlgRules').showModal(); };
    $('btnMenuRules').onclick = function () { $('dlgMenu').close(); $('dlgRules').showModal(); };
    $('btnScores').onclick = function () { showScores(false); };
    $('btnMenu').onclick = function () { $('dlgMenu').showModal(); };
    $('btnMenuSeul').onclick = function () { $('dlgMenu').showModal(); };
    $('btnQuit').onclick = function () { $('dlgMenu').close(); goHome(); };
    $('dlgScores').addEventListener('close', function () { this.style.transform = ''; });
    document.querySelectorAll('[data-close]').forEach(function (b) { b.onclick = function () { b.closest('dialog').close(); }; });

    // piles (deux jeux de boutons : vue normale et vue face à face)
    $('pileDeck').onclick = function () { humanDraw('deck'); };
    $('pileDiscard').onclick = function () { humanDraw('discard'); };

    // vue normale
    $('hand').onclick = function (e) { onHandClick(e, viewer(), $('msg')); };
    $('btnAction').onclick = function () { if (G.roundEnded) showRound(); else humanDiscard(); };

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

    // boutons de rangement (vue normale et sièges du face à face)
    document.addEventListener('click', function (e) {
      var b = e.target.closest('.js-arr, .js-auto');
      if (!b || !G || mode() === 'seul' || G.roundEnded) return;
      var p = viewer();
      if (b.classList.contains('js-arr')) toggleArrange(p); else autoSort(p);
    });

    // boutons de fin de manche / de partie (dialogue et vue face à face)
    document.addEventListener('click', function (e) {
      var t = e.target.closest('.js-next, .js-again, .js-home');
      if (!t || !G) return;
      if (t.classList.contains('js-next')) {
        closeRound(); E.nextRound(G); G.order = []; arrOn = {}; arrSel = {}; selected = null;
        save(); renderAll(); afterMove();
      } else if (t.classList.contains('js-again')) { closeRound(); if (mode() === 'online') restartOnline(); else startNew(); }
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
