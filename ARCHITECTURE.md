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
tests/e2e/en_ligne.py           Deux appareils simulés (Chromium) + faux Supabase en mémoire (71 vérifications)
tests/e2e/solo_seul.py          Essai de fumée : contre l'ordinateur et solitaire
```

Ordre de chargement : `engine.js`, `en-ligne.js`, `app.js`. Règle : changer `APP_VERSION` (app.js) et `CACHE` (sw.js) ensemble à chaque livraison.

## Moteur (`engine.js`)

`newGame(names, human)` crée l'état `g` et distribue la manche 0 ; `startRound`, `draw(g, src)`, `discard(g, id)` (sortie si la main est complète : `outBy`, dernier tour pour les autres), `endRound`, `nextRound`, `botPlay` (un tour d'ordinateur). `solveHand(hand, wild)` trouve les brelans/suites et la pénalité minimale. Manche `r` (0 à 10) : `r + 3` cartes, l'atout est `r + 3`. Contient aussi la variante solitaire (`newSolitaire`, `solo*`).

Les distributions et le mélange sont aléatoires : l'état complet est donc recopié tel quel entre appareils (pas de rejeu d'actions).

## État de partie (`G`)

`n, names[], human[], scores[], history[], over, round, cards, wild, dealer, hands[][], deck[], discard[], turn, phase ('draw'|'discard'), noDiscard, outBy, finalLeft, roundEnded, results, last, mode ('solo'|'online'|'seul'), taken[], opts`. `taken[p]` = dernière carte prise dans la défausse par le joueur p (remis à zéro à chaque manche, mis à jour par `Engine.draw`) ; `opts` = aides de la partie, choisies à la création (solo et en ligne, jamais en solitaire) : `{groupes, points, defausse, joker, sortie, prises}` (booléens ; défaut : tout vrai sauf `prises`). Lues par `opt(k)` : `groupes` (regroupement de la main), `points` (décompte), `defausse` (point doré), `joker` (bandeau, classe `wild`, tri qui range les jokers en fin), `sortie` (« Tu peux sortir » et libellé du bouton ; la sortie reste détectée par `Engine.discard`), `prises` (affiche `taken`). Les parties créées en v8 (`facile`) ou v9 (`difficile`) sont converties à la lecture (`curOpts`). En ligne, l'état serveur porte `opts` : l'hôte décide pour les deux appareils. Le menu de partie n'a plus de réglage d'aide (sauf en solitaire, qui garde `prefs.aide`). En ligne : `G.online = {uids:[uid hôte, uid invité|null], joined}`. `G.order` (rangement manuel des cartes) est **propre à chaque appareil** : jamais envoyé au serveur, conservé quand l'état distant est repris.

## Modes

| Mode | Appareils | Détails |
|---|---|---|
| `solo` | 1 | toi + 1 à 6 ordinateurs, sauvegarde locale |
| `online` | 2 humains + 0 à 5 ordinateurs | synchro Supabase, voir ci-dessous |
| `seul` | 1 | variante solitaire, sauvegarde locale |

## Mode en ligne

Fournisseur : Supabase (projet « plan-du-jour », table `parties`, accès réservé aux comptes connectés). Requêtes `fetch` seulement. `en-ligne.js` expose `login, logout, creer(jeu, etat, titre), lire, version, ecrire(id, versionAttendue, etat, titre) → nouvelleVersion | false, liste(jeu), supprimer, surveiller(...)`. Le jeu est `cinqrois`. Session partagée sous `foyer_session_v1`.

**Synchro par état complet avec contrôle de version** : à chaque coup, `save()` marque l'état « à envoyer » et `pushState()` écrit tout `G` si la version du serveur est celle qu'on connaît. En cas de conflit (l'autre appareil a écrit avant), **son état l'emporte** et notre action est annulée avec un message. Cela suffit car un seul joueur agit à la fois ; le seul cas simultané est « Manche suivante » pressé par les deux, où le premier gagne. Un coup joué hors ligne reste en attente et part au retour du réseau (bannière `#offbar`, `pointer-events:none`).

**Surveillance** : toutes les 1,5 s la version est lue ; si elle a changé, l'état est relu (`onRemote` → `takeRemote` → `onlineShow`).

**Rôles** : siège 0 = hôte, c'est lui seul qui joue les ordinateurs (`tick()` ne s'exécute pas chez l'invité). `viewer()` = siège de l'appareil ; `canAct()` exige que ce soit son tour. Avant l'arrivée de l'invité, l'hôte voit la salle d'attente (`#wait`) et rien ne se joue.

**Mains cachées** : l'état contient toutes les mains ; l'interface n'affiche que celle de l'appareil (les autres joueurs sont montrés par un éventail de dos). Choix assumé : pas de protection contre la lecture du réseau.

## Plateau : retiré (v9)

Le plateau iPad (affichage commun, signe de vie `jeu = 'plateau'`) a été retiré de 5 Rois en v9 à la demande de l'auteur : il n'apportait rien. Les deux téléphones gardent la table. Les lignes `plateau` éventuellement restées sur le serveur par la v8 ne sont plus lues.

## Sauvegardes (localStorage)

| Clé | Contenu |
|---|---|
| `cinqrois_partie_v1` | partie locale (solo ou solitaire) |
| `cinqrois_prefs_v1` | mode, nombre d'adversaires, aide, prénom |
| `cinqrois_online_v1` | partie en ligne → siège de cet appareil |
| `foyer_session_v1` | session de connexion (partagée entre les jeux) |
