# Carnet de bord

Journal des opérations du projet, pour pouvoir le reprendre sans rien perdre. Les entrées récentes sont en bas ; l'état courant est résumé en tête.

## État courant

- Modes : contre l'ordinateur, **en ligne** (2 humains sur 2 appareils + ordinateurs), variante solitaire. Passe-passe et face à face supprimés (remplacés par l'en ligne).
- Version 9 (plateau retiré, mode difficile ajouté ; mode facile conservé). Testé en navigateur simulé uniquement ; le mode En ligne n'a pas encore été essayé sur de vrais appareils pour ce jeu (il l'a été pour Skyjo, avec la même brique `en-ligne.js`).

## À faire

- Essayer l'en ligne sur iPhone / iPad / téléphone Android et corriger ce qui sort des essais réels.
- Le rangement manuel des cartes est perdu si on recharge la page en ligne (il est propre à l'appareil et non enregistré).
- (obsolète depuis v9 : plateau retiré) Essayer le plateau sur un vrai iPad avec deux téléphones, et vérifier que le vrai Supabase accepte la ligne `jeu = 'plateau'` (les téléphones gardent la table sinon).
- Déployer ensuite l'en ligne dans les autres jeux (6 qui prend, Flip 7, Le Contrat, Bataille navale, EnqueteManoir).

## Historique avant 2026-11-12

Rami à 5 couleurs, solo contre l'ordinateur (1 à 6 adversaires), passe-passe, face à face iPad, variante solitaire, rangement manuel des cartes, aide au regroupement, licence « Tous droits réservés ». Ce carnet n'existait pas encore : cet historique est reconstitué à partir des commits.

## 2026-11-12 — Mode « En ligne » (version 6)

Décisions de l'auteur : seulement les jeux à plusieurs ; 2 humains maximum ; ordinateurs possibles ; l'en ligne remplace passe-passe et face à face ; mains cachées par confiance ; pas de plateau commun pour ce jeu (le plateau iPad en affichage seul n'existe que dans Skyjo).

Opérations :

1. `en-ligne.js` copié de Skyjo ; `index.html` : bouton « En ligne », panneau compte / code / parties en cours, salle d'attente, bannière « Hors ligne », version affichée ; `sw.js` : cache `cinqrois-v6`.
2. `app.js` : suppression de tout le code passe-passe / face à face (voile, sièges, `reveal`, `renderDuo`) ; ajout du bloc En ligne : synchro d'état complet avec contrôle de version, conflit = l'état distant l'emporte, hôte seul à jouer les ordinateurs, `restartOnline()` pour « Nouvelle partie », reprise depuis la liste, suppression vue par l'autre appareil.
3. Choix technique différent de Skyjo : pas de rejeu d'actions, car les distributions sont aléatoires et un seul joueur agit à la fois.
4. `window.BOT_DELAY` (tests) pour accélérer les ordinateurs.
5. Tests : `tests/e2e/en_ligne.py` (37 vérifications : connexion, code inconnu, 3e personne refusée, mains cachées, droits de jeu, hors ligne puis envoi, reprise, manche complète identique des deux côtés, « Manche suivante » pressé en même temps, suppression) et `tests/e2e/solo_seul.py` (solo et solitaire).
6. Corrigé pendant les essais : attentes de test (3 cartes en manche 1), serveur de test qui servait un autre dépôt.
7. Création de ce carnet et de `ARCHITECTURE.md`.

## Version 7 (13/11/2026)
- Service worker : les requêtes d'une autre origine (Supabase) ne passent plus par le cache (avant, une coupure réseau était masquée par une réponse mise en cache).

## Version 8 (13/11/2026) — Plateau et mode facile

Décisions de l'auteur : le plateau (iPad en affichage commun, personne ne joue dessus) est indispensable pour les jeux à main cachée ; quand il est branché, le téléphone cache la table commune et garde la main + ses boutons ; mode facile choisi à la création (entraînement à faire attention) : dernières cartes prises dans la défausse par chacun ; pas de mode facile pour 6 qui prend ni pour Skyjo (abandonné).

Opérations :

1. `engine.js` : `g.taken[p]` = dernière carte prise dans la défausse (remise à zéro à chaque manche).
2. `index.html` : écran `#plateau`, bouton « Ouvrir comme plateau », interrupteur « Mode facile » (panneau En ligne), bouton « Afficher la table » (téléphone), styles `#game.notable`.
3. `app.js` : plateau en lecture seule (`plStart…` : `plateauStart`, `plRender`, `plRemote`, `plStatus`, `plStop`) ; signe de vie dans une ligne séparée `jeu = 'plateau'` (`plBeat`) pour ne jamais entrer en conflit avec les coups ; détection côté téléphone (`platWatch`, `noTable`) ; `roundHTML(compact, view)` sans boutons pour le plateau ; `takenHTML` (mode facile) ; l'option `facile` survit à « Nouvelle partie ».
4. Choix retenu : détection automatique + bouton de secours, sans signe de vie dans la ligne de la partie (la synchro par état complet fait gagner l'autre en cas de conflit : un plateau qui y écrirait ferait perdre des coups).
5. Tests : 66 vérifications (29 nouvelles : plateau, masquage et retour de la table, plateau fermé sans prévenir puis rouvert (ligne réutilisée), fin de manche sur le plateau, mode facile de bout en bout). `solo_seul.py` inchangé et vert.
6. `APP_VERSION` 8, cache `cinqrois-v8`.

## Version 9 (14/11/2026) — Plateau retiré, mode difficile

Décisions de l'auteur (après essai de la v8) : le plateau « ne sert pas à grand-chose » → retiré de 5 Rois. Nouveau **mode difficile** : joker de la manche non indiqué, aucune aide aux groupes ni à la défausse, solo et en ligne, choisi à la création (l'hôte décide pour les deux en ligne). Non appliqué à la variante solitaire (non demandé).

Opérations :

1. `app.js` : suppression du plateau (`plateauStart`, `plRender`, `plRemote`, `plStatus`, `plStop`, `plBeat`, `platWatch`, `noTable`), du bouton « Afficher la table » et de `roundHTML(…, view)`. Plus aucune lecture ni écriture de ligne `plateau`.
2. `index.html` : suppression de `#plateau`, de `#btnOlPlateau`, de `#btnTable` et des styles `.notable` / `#plateau` ; ajout du panneau « Mode difficile » (`#optDifficile`, `#swDifficile`).
3. `app.js` : `G.difficile` (posé à la création solo / en ligne, conservé par « Nouvelle partie » en ligne) ; `aideOn()` ; pas de classe `wild` ; `sortHand` sans indice ; bandeau joker caché ; libellé de sortie neutre ; réglage d'aide caché dans le menu de partie ; « · difficile » dans le sous-titre.
4. Tests : 64 vérifications (plateau remplacé par « plateau retiré » ; facile sans plateau ; difficile : mains fabriquées, avec et sans aide, tri, état serveur, invité en difficile).
5. `APP_VERSION` 9, cache `cinqrois-v9`.
