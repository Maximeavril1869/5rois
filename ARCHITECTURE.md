# Architecture

Application web statique (PWA), sans compilation ni serveur : HTML + JavaScript « classique ». Aucune bibliothèque tierce. Hébergée sur GitHub Pages.

## Fichiers

```
index.html            Écrans (accueil, partie, solitaire), styles, modales (règles, scores, manche, menu), salle d'attente, bannière « Hors ligne »
engine.js             Moteur pur : cartes, manches, scores, solveur de mains, ordinateur, variante solitaire (window.Engine)
en-ligne.js           Brique commune « En ligne » (copie de celle de Skyjo) : connexion, parties, synchro (window.EnLigne)
app.js                Interface et logique des modes (solo, en ligne, solitaire)
sw.js                 Service worker : cache hors ligne (réseau d'abord)
manifest.webmanifest, icons/    PWA
tests/e2e/en_ligne.py           Deux appareils + plateau simulés (Chromium) + faux Supabase en mémoire (66 vérifications)
tests/e2e/solo_seul.py          Essai de fumée : contre l'ordinateur et solitaire
```

Ordre de chargement : `engine.js`, `en-ligne.js`, `app.js`. Règle : changer `APP_VERSION` (app.js) et `CACHE` (sw.js) ensemble à chaque livraison.

## Moteur (`engine.js`)

`newGame(names, human)` crée l'état `g` et distribue la manche 0 ; `startRound`, `draw(g, src)`, `discard(g, id)` (sortie si la main est complète : `outBy`, dernier tour pour les autres), `endRound`, `nextRound`, `botPlay` (un tour d'ordinateur). `solveHand(hand, wild)` trouve les brelans/suites et la pénalité minimale. Manche `r` (0 à 10) : `r + 3` cartes, l'atout est `r + 3`. Contient aussi la variante solitaire (`newSolitaire`, `solo*`).

Les distributions et le mélange sont aléatoires : l'état complet est donc recopié tel quel entre appareils (pas de rejeu d'actions).

## État de partie (`G`)

`n, names[], human[], scores[], history[], over, round, cards, wild, dealer, hands[][], deck[], discard[], turn, phase ('draw'|'discard'), noDiscard, outBy, finalLeft, roundEnded, results, last, mode ('solo'|'online'|'seul'), taken[], facile`. `taken[p]` = dernière carte prise dans la défausse par le joueur p (remis à zéro à chaque manche, mis à jour par `Engine.draw`) ; `facile` = option choisie à la création (en ligne seulement) qui affiche `taken` (plateau et table des téléphones). En ligne : `G.online = {uids:[uid hôte, uid invité|null], joined}`. `G.order` (rangement manuel des cartes) est **propre à chaque appareil** : jamais envoyé au serveur, conservé quand l'état distant est repris.

## Modes

| Mode | Appareils | Détails |
|---|---|---|
| `solo` | 1 | toi + 1 à 6 ordinateurs, sauvegarde locale |
| `online` | 2 humains + 0 à 5 ordinateurs (+ un plateau optionnel) | synchro Supabase, voir ci-dessous |
| `seul` | 1 | variante solitaire, sauvegarde locale |

## Mode en ligne

Fournisseur : Supabase (projet « plan-du-jour », table `parties`, accès réservé aux comptes connectés). Requêtes `fetch` seulement. `en-ligne.js` expose `login, logout, creer(jeu, etat, titre), lire, version, ecrire(id, versionAttendue, etat, titre) → nouvelleVersion | false, liste(jeu), supprimer, surveiller(...)`. Le jeu est `cinqrois`. Session partagée sous `foyer_session_v1`.

**Synchro par état complet avec contrôle de version** : à chaque coup, `save()` marque l'état « à envoyer » et `pushState()` écrit tout `G` si la version du serveur est celle qu'on connaît. En cas de conflit (l'autre appareil a écrit avant), **son état l'emporte** et notre action est annulée avec un message. Cela suffit car un seul joueur agit à la fois ; le seul cas simultané est « Manche suivante » pressé par les deux, où le premier gagne. Un coup joué hors ligne reste en attente et part au retour du réseau (bannière `#offbar`, `pointer-events:none`).

**Surveillance** : toutes les 1,5 s la version est lue ; si elle a changé, l'état est relu (`onRemote` → `takeRemote` → `onlineShow`).

**Rôles** : siège 0 = hôte, c'est lui seul qui joue les ordinateurs (`tick()` ne s'exécute pas chez l'invité). `viewer()` = siège de l'appareil ; `canAct()` exige que ce soit son tour. Avant l'arrivée de l'invité, l'hôte voit la salle d'attente (`#wait`) et rien ne se joue.

**Mains cachées** : l'état contient toutes les mains ; l'interface n'affiche que celle de l'appareil (les autres joueurs sont montrés par un éventail de dos). Choix assumé : pas de protection contre la lecture du réseau.

## Plateau (iPad en affichage seul)

Écran `#plateau`, ouvert depuis le panneau En ligne (« Ouvrir comme plateau »). Il ne prend aucun siège et n'écrit jamais dans la ligne de la partie (sinon, avec la synchro par état complet où « l'autre gagne », il pourrait faire perdre un coup). Il la lit seulement (`surveiller` → `plRemote` → `plRender`) : joueurs (dos de cartes, nombre de cartes, scores, tour), pioche, défausse, résultats de fin de manche (`roundHTML(false, true)` : sans boutons), historique des scores, et la ligne « Prise » en mode facile.

**Signe de vie** : le plateau écrit dans une ligne séparée de la table `parties` (`jeu = 'plateau'`, `titre` = code de la partie), au lancement, 1,5 s après, puis toutes les 10 s (`plBeat`). Il réutilise la ligne existante de même titre ; il la supprime en quittant. **Côté téléphone** (`platWatch`) : toutes les 5 s, `EL.liste('plateau')` ; si la version de la ligne de la partie a changé depuis moins de 30 s, `ONL.plat.present` passe à vrai et `#game.notable` cache les adversaires et les piles (les deux piles deviennent les boutons « Piocher » / « Prendre la défausse »). Le premier passage note seulement la version (un reste d'une séance précédente ne cache donc pas la table). Pas de comparaison d'horloges entre appareils. `ONL.plat.override` (bouton « Afficher la table ») force la table ; il retombe quand le plateau disparaît. Réglages de test : `window.PLATEAU_POLL`, `PLATEAU_BEAT`, `PLATEAU_FRESH`.

Hypothèse à vérifier sur le vrai Supabase : la table `parties` accepte `jeu = 'plateau'` (rien ne l'interdit dans les autres jeux). Sinon les téléphones gardent simplement la table, sans erreur.

## Sauvegardes (localStorage)

| Clé | Contenu |
|---|---|
| `cinqrois_partie_v1` | partie locale (solo ou solitaire) |
| `cinqrois_prefs_v1` | mode, nombre d'adversaires, aide, prénom |
| `cinqrois_online_v1` | partie en ligne → siège de cet appareil |
| `foyer_session_v1` | session de connexion (partagée entre les jeux) |
