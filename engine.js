/* 5 Rois — moteur de jeu : cartes, solveur de combinaisons, IA, déroulement d'une partie.
   Aucune dépendance. Fonctionne dans le navigateur (window.Engine) et sous Node (module.exports). */
(function (root) {
  'use strict';

  var SUITS = [
    { id: 0, sym: '♠', name: 'Piques',   color: '#1f2937' },
    { id: 1, sym: '♣', name: 'Trèfles',  color: '#15803d' },
    { id: 2, sym: '♥', name: 'Cœurs',    color: '#dc2626' },
    { id: 3, sym: '♦', name: 'Carreaux', color: '#2563eb' },
    { id: 4, sym: '★', name: 'Étoiles',  color: '#9333ea' }
  ];

  function rankLabel(r) {
    return r === 11 ? 'V' : r === 12 ? 'D' : r === 13 ? 'R' : String(r);
  }
  function cardName(c) {
    return c.rank === 0 ? 'Joker' : rankLabel(c.rank) + SUITS[c.suit].sym;
  }

  /* ---------- Paquet : 2 jeux de 5 couleurs (3 à Roi) + 6 jokers = 116 cartes ---------- */
  function makeDeck() {
    var d = [], id = 0, copy, s, r, j;
    for (copy = 0; copy < 2; copy++)
      for (s = 0; s < 5; s++)
        for (r = 3; r <= 13; r++) d.push({ id: id++, suit: s, rank: r });
    for (j = 0; j < 6; j++) d.push({ id: id++, suit: -1, rank: 0 });
    return d;
  }
  function shuffle(a) {
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  /* ---------- Jokers et points ---------- */
  function isWild(c, wr) { return c.rank === 0 || c.rank === wr; }
  function points(c, wr) {
    if (c.rank === 0) return 50;
    if (c.rank === wr) return 20;
    return c.rank;
  }

  /* ---------- Solveur : meilleure répartition d'une main en brelans/suites ----------
     Brelan : 3 cartes ou + de même valeur. Suite : 3 cartes ou + consécutives de même couleur.
     Les jokers (vrais jokers + cartes de la valeur de la manche) remplacent n'importe quelle carte.
     Retourne { penalty, groups:[{kind,cards}], rest:[cartes isolées] }. */
  function solveHand(hand, wr) {
    var cnt = new Array(55), stacks = [], wilds = [], wpen = 0, i;
    for (i = 0; i < 55; i++) { cnt[i] = 0; stacks.push([]); }
    hand.forEach(function (c) {
      if (isWild(c, wr)) { wilds.push(c); wpen += points(c, wr); }
      else { var k = c.suit * 11 + (c.rank - 3); cnt[k]++; stacks[k].push(c); }
    });
    var memo = new Map();
    function keyOf(w, m) { return cnt.join('') + '|' + w + (m ? 'm' : 'n'); }

    function rec(w, melded) {
      var first = -1, i;
      for (i = 0; i < 55; i++) if (cnt[i] > 0) { first = i; break; }
      if (first < 0) return (melded || w >= 3) ? 0 : wpen;
      var key = keyOf(w, melded);
      var hit = memo.get(key);
      if (hit) return hit.pen;
      var s0 = (first / 11) | 0, r0 = 3 + (first % 11);
      var best, move;

      cnt[first]--;
      best = r0 + rec(w, melded);
      move = { t: 'skip' };
      cnt[first]++;

      var base = r0 - 3, avail = [], takes = [0, 0, 0, 0, 0], s;
      for (s = 0; s < 5; s++) avail.push(cnt[s * 11 + base]);
      (function enumTakes(s, k) {
        if (s === 5) {
          if (k < 1) return;
          var need = Math.max(0, 3 - k);
          if (need > w) return;
          var t;
          for (t = 0; t < 5; t++) cnt[t * 11 + base] -= takes[t];
          var v = rec(w - need, true);
          for (t = 0; t < 5; t++) cnt[t * 11 + base] += takes[t];
          if (v < best) { best = v; move = { t: 'book', base: base, takes: takes.slice(), need: need }; }
          return;
        }
        var lo = (s === s0) ? 1 : 0, t2;
        for (t2 = lo; t2 <= avail[s]; t2++) { takes[s] = t2; enumTakes(s + 1, k + t2); }
        takes[s] = 0;
      })(0, 0);

      var a, b, q;
      for (a = 3; a <= r0; a++) {
        for (b = Math.max(r0, a + 2); b <= 13; b++) {
          var len = b - a + 1, need2 = 0;
          for (q = a; q <= b; q++) if (q !== r0 && cnt[s0 * 11 + q - 3] === 0) need2++;
          if (need2 > w) continue;
          if (len > 3) {
            if (a < r0) continue;
            if (b > r0 && cnt[s0 * 11 + b - 3] === 0) continue;
          }
          var used = [];
          for (q = a; q <= b; q++) {
            var idx = s0 * 11 + q - 3;
            if (cnt[idx] > 0) { cnt[idx]--; used.push(idx); }
          }
          var v2 = rec(w - need2, true);
          for (q = 0; q < used.length; q++) cnt[used[q]]++;
          if (v2 < best) { best = v2; move = { t: 'run', s0: s0, a: a, b: b, need: need2 }; }
        }
      }
      memo.set(key, { pen: best, move: move });
      return best;
    }

    var total = rec(wilds.length, false);

    // Reconstruction de la répartition choisie
    var groups = [], rest = [], pool = wilds.slice(), w = wilds.length, melded = false;
    for (;;) {
      var first = -1;
      for (i = 0; i < 55; i++) if (cnt[i] > 0) { first = i; break; }
      if (first < 0) break;
      var mv = memo.get(keyOf(w, melded)).move, cards, t, k, q;
      if (mv.t === 'skip') {
        rest.push(stacks[first].pop()); cnt[first]--;
      } else if (mv.t === 'book') {
        cards = [];
        for (t = 0; t < 5; t++) for (k = 0; k < mv.takes[t]; k++) { cards.push(stacks[t * 11 + mv.base].pop()); cnt[t * 11 + mv.base]--; }
        for (k = 0; k < mv.need; k++) cards.push(pool.pop());
        w -= mv.need; melded = true;
        groups.push({ kind: 'book', cards: cards });
      } else {
        cards = [];
        for (q = mv.a; q <= mv.b; q++) {
          var ix = mv.s0 * 11 + q - 3;
          if (cnt[ix] > 0) { cards.push(stacks[ix].pop()); cnt[ix]--; }
          else cards.push(pool.pop());
        }
        w -= mv.need; melded = true;
        groups.push({ kind: 'run', cards: cards });
      }
    }
    if (groups.length) { groups[groups.length - 1].cards = groups[groups.length - 1].cards.concat(pool); }
    else if (pool.length >= 3) groups.push({ kind: 'book', cards: pool });
    else rest = rest.concat(pool);

    var pen = 0;
    rest.forEach(function (c) { pen += points(c, wr); });
    return { penalty: pen, groups: groups, rest: rest, _check: total };
  }

  /* ---------- IA ---------- */
  function synergy(unmatched, hand, wr) {
    var s = 0;
    unmatched.forEach(function (u) {
      if (isWild(u, wr)) return;
      hand.forEach(function (v) {
        if (v === u || isWild(v, wr)) return;
        if (v.rank === u.rank) s += 3;
        else if (v.suit === u.suit) {
          var d = Math.abs(v.rank - u.rank);
          if (d === 1) s += 3; else if (d === 2) s += 1.5;
        }
      });
    });
    return s;
  }
  function handCost(hand, wr) {
    var sol = solveHand(hand, wr);
    return { cost: sol.penalty - 0.15 * synergy(sol.rest, hand, wr), penalty: sol.penalty, sol: sol };
  }
  // hand : N+1 cartes ; renvoie la carte à défausser (jamais noId) et le résultat
  function bestDiscard(hand, wr, noId) {
    var seen = {}, best = null;
    for (var i = 0; i < hand.length; i++) {
      var c = hand[i];
      if (c.id === noId) continue;
      var sig = c.suit + ':' + c.rank;
      if (seen[sig]) continue;
      seen[sig] = 1;
      var rest = hand.filter(function (_, j) { return j !== i; });
      var hc = handCost(rest, wr);
      var cost = hc.cost;
      if (!best || cost < best.cost - 1e-9 || (Math.abs(cost - best.cost) < 1e-9 && points(c, wr) > points(best.card, wr))) {
        best = { card: c, cost: cost, penalty: hc.penalty, sol: hc.sol };
      }
    }
    if (!best) { // cas extrême : on ne peut défausser que la carte interdite
      var cc = hand[0];
      best = { card: cc, cost: 0, penalty: 0, sol: null };
    }
    return best;
  }
  function aiDraw(hand, top, wr) {
    if (!top) return 'deck';
    if (isWild(top, wr)) return 'discard';
    var cost0 = handCost(hand, wr).cost;
    var cost1 = bestDiscard(hand.concat([top]), wr, top.id).cost;
    return cost1 < cost0 - 0.3 ? 'discard' : 'deck';
  }

  /* ---------- Déroulement d'une partie (état sérialisable) ---------- */
  function newGame(names, human) {
    var n = names.length;
    var g = { n: n, names: names, human: human, scores: [], history: [], over: false };
    for (var i = 0; i < n; i++) g.scores.push(0);
    startRound(g, 0);
    return g;
  }
  function startRound(g, round) {
    g.round = round; g.cards = round + 3; g.wild = round + 3;
    g.dealer = round % g.n;
    var deck = shuffle(makeDeck());
    g.hands = [];
    var p, k;
    for (p = 0; p < g.n; p++) g.hands.push([]);
    for (k = 0; k < g.cards; k++) for (p = 0; p < g.n; p++) g.hands[p].push(deck.pop());
    g.discard = [deck.pop()];
    g.deck = deck;
    g.turn = (g.dealer + 1) % g.n;
    g.phase = 'draw';
    g.noDiscard = null;
    g.outBy = -1; g.finalLeft = 0;
    g.roundEnded = false; g.results = null;
    g.last = '';
  }
  function reshuffle(g) {
    var top = g.discard.pop();
    g.deck = shuffle(g.discard);
    g.discard = top ? [top] : [];
  }
  function draw(g, src) {
    var p = g.turn, card;
    if (src === 'discard' && g.discard.length) {
      card = g.discard.pop(); g.noDiscard = card.id;
    } else {
      if (!g.deck.length) reshuffle(g);
      if (!g.deck.length) { card = g.discard.pop(); g.noDiscard = null; }
      else { card = g.deck.pop(); g.noDiscard = null; }
    }
    g.hands[p].push(card);
    g.phase = 'discard';
    return card;
  }
  function discard(g, id) {
    var p = g.turn, hand = g.hands[p];
    var i = -1;
    for (var k = 0; k < hand.length; k++) if (hand[k].id === id) { i = k; break; }
    if (i < 0 || id === g.noDiscard) return null;
    var c = hand.splice(i, 1)[0];
    g.discard.push(c);
    var wentOut = false;
    if (g.outBy < 0) {
      if (solveHand(hand, g.wild).penalty === 0) { g.outBy = p; g.finalLeft = g.n - 1; wentOut = true; }
    } else {
      g.finalLeft--;
    }
    g.phase = 'draw'; g.noDiscard = null;
    if (g.outBy >= 0 && g.finalLeft <= 0) endRound(g);
    else g.turn = (g.turn + 1) % g.n;
    return { card: c, wentOut: wentOut };
  }
  function endRound(g) {
    var res = [], row = [];
    for (var p = 0; p < g.n; p++) {
      var sol = solveHand(g.hands[p], g.wild);
      res.push({ penalty: sol.penalty, groups: sol.groups, rest: sol.rest, out: p === g.outBy });
      row.push(sol.penalty);
      g.scores[p] += sol.penalty;
    }
    g.results = res;
    g.history.push(row);
    g.roundEnded = true;
    if (g.round >= 10) g.over = true;
  }
  function nextRound(g) { startRound(g, g.round + 1); }

  function botPlay(g) {
    var p = g.turn, hand = g.hands[p];
    var top = g.discard[g.discard.length - 1];
    var src = aiDraw(hand, top, g.wild);
    var drawn = draw(g, src);
    var bd = bestDiscard(g.hands[p], g.wild, g.noDiscard);
    var r = discard(g, bd.card.id);
    return { p: p, src: src, drawn: drawn, discarded: r.card, wentOut: r.wentOut };
  }

  var api = {
    SUITS: SUITS, rankLabel: rankLabel, cardName: cardName, makeDeck: makeDeck, shuffle: shuffle,
    isWild: isWild, points: points, solveHand: solveHand, bestDiscard: bestDiscard, aiDraw: aiDraw,
    newGame: newGame, startRound: startRound, draw: draw, discard: discard, endRound: endRound,
    nextRound: nextRound, botPlay: botPlay
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Engine = api;
})(typeof window !== 'undefined' ? window : this);
