# Carnet de bord

Journal des opérations du projet, pour pouvoir le reprendre sans rien perdre. Les entrées récentes sont en bas ; l'état courant est résumé en tête.

## État courant

- Modes : contre l'ordinateur, **en ligne** (2 humains sur 2 appareils + ordinateurs), variante solitaire. Passe-passe et face à face supprimés (remplacés par l'en ligne).
- Version 6. Testé en navigateur simulé uniquement ; le mode En ligne n'a pas encore été essayé sur de vrais appareils pour ce jeu (il l'a été pour Skyjo, avec la même brique `en-ligne.js`).

## À faire

- Essayer l'en ligne sur iPhone / iPad / téléphone Android et corriger ce qui sort des essais réels.
- Le rangement manuel des cartes est perdu si on recharge la page en ligne (il est propre à l'appareil et non enregistré).
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
