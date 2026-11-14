# 5 Rois

Rami à 5 couleurs, 11 manches. Trois modes : contre l'ordinateur (1 à 6 adversaires, jusqu'à 7 joueurs), **en ligne** (2 humains, chacun sur son appareil, 0 à 5 ordinateurs en complément) et la variante solitaire à une personne. Le mode contre l'ordinateur et le solitaire fonctionnent en local et hors ligne.

## Mode en ligne

Il faut un compte (le même que pour les autres applications). On crée une partie, on reçoit un code à 4 lettres, l'autre joueur le tape après avoir choisi « En ligne ». La main de chacun n'est affichée que sur son appareil (les mains sont cachées à l'écran, pas chiffrées : le jeu repose sur la confiance entre les deux joueurs). Les anciens modes « on se passe l'appareil » et « face à face » ont été remplacés par l'en ligne.

**Mode difficile** (choix à la création de la partie, en solo comme en ligne ; l'hôte décide pour les deux joueurs en ligne) : le joker de la manche n'est pas indiqué (ni bandeau, ni carte surlignée, ni tri qui trahit les jokers), aucune aide aux groupes ni à la défausse conseillée, et le bouton ne dit pas si tu peux sortir. À toi de retenir la valeur du joker ; si tu la rates, tant pis. La sortie reste détectée automatiquement par le jeu. Sans effet dans la variante solitaire.

**Mode facile** (choix à la création de la partie) : affiche pour chaque joueur la dernière carte qu'il a prise dans la défausse.

Rangement manuel : « ⇄ Ranger » puis on touche deux cartes pour les échanger ; « ↺ Tri auto » revient au tri automatique.

## Variante solitaire

11 mains étalées face visible (3 à 13 cartes), 28 cartes de pioche. À chaque tour : la carte du dessus est révélée, on la place dans une main, puis on défausse une carte de cette main. Une main entièrement rangée en brelans/suites est retournée. Gagné quand les 11 mains sont retournées, perdu si la pioche s'épuise avant.


## Développement

```
python3 -m http.server 8123                 # depuis la racine du dépôt
python3 tests/e2e/solo_seul.py              # essai de fumée : solo et solitaire
python3 tests/e2e/en_ligne.py               # deux appareils simulés + faux Supabase (64 vérifications)
```

Voir `ARCHITECTURE.md` (structure) et `CARNET_DE_BORD.md` (historique et suite).

## Licence

Tous droits réservés © Maximeavril1869. Code publié pour consultation uniquement ; toute réutilisation exige l'autorisation écrite de l'auteur. Voir le fichier `LICENSE`.
