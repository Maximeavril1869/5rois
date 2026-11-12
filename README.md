# 5 Rois

Rami à 5 couleurs, 11 manches. Trois modes : contre l'ordinateur (1 à 6 adversaires, jusqu'à 7 joueurs), **en ligne** (2 humains, chacun sur son appareil, 0 à 5 ordinateurs en complément) et la variante solitaire à une personne. Le mode contre l'ordinateur et le solitaire fonctionnent en local et hors ligne.

## Mode en ligne

Il faut un compte (le même que pour les autres applications). On crée une partie, on reçoit un code à 4 lettres, l'autre joueur le tape après avoir choisi « En ligne ». La main de chacun n'est affichée que sur son appareil (les mains sont cachées à l'écran, pas chiffrées : le jeu repose sur la confiance entre les deux joueurs). Les anciens modes « on se passe l'appareil » et « face à face » ont été remplacés par l'en ligne.

Rangement manuel : « ⇄ Ranger » puis on touche deux cartes pour les échanger ; « ↺ Tri auto » revient au tri automatique.

## Variante solitaire

11 mains étalées face visible (3 à 13 cartes), 28 cartes de pioche. À chaque tour : la carte du dessus est révélée, on la place dans une main, puis on défausse une carte de cette main. Une main entièrement rangée en brelans/suites est retournée. Gagné quand les 11 mains sont retournées, perdu si la pioche s'épuise avant.


## Développement

```
python3 -m http.server 8123                 # depuis la racine du dépôt
python3 tests/e2e/solo_seul.py              # essai de fumée : solo et solitaire
python3 tests/e2e/en_ligne.py               # deux appareils simulés + faux Supabase (37 vérifications)
```

Voir `ARCHITECTURE.md` (structure) et `CARNET_DE_BORD.md` (historique et suite).

## Licence

Tous droits réservés © Maximeavril1869. Code publié pour consultation uniquement ; toute réutilisation exige l'autorisation écrite de l'auteur. Voir le fichier `LICENSE`.
