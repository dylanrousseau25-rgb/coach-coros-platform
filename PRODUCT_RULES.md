# Coach COROS Platform — Règles produit

Ce document est la référence fonctionnelle de l'application. L'IA réfléchit et propose ; l'application contrôle les dates, le stockage, l'historique et l'application des changements.

## 1. Philosophie
Le produit est un coach personnel d'endurance, pas un simple calendrier. Priorités : prévention des blessures, régularité, progression, performance.

## 2. Profil athlète
Le profil est permanent. Il conserve sports, disponibilités, contraintes, préférences, vigilances/blessures, activités COROS, ressentis et historique.

## 3. COROS
COROS fournit les données sportives réelles. Une donnée non disponible s'affiche `—`. Une donnée de démonstration ne doit jamais être présentée comme actuelle. Les plans et adaptations utilisent le contexte COROS live quand il est disponible.

## 4. Objectif et plan
Un objectif décrit le résultat recherché. Le plan est la réponse du Coach. Pour une course/trail : sport, distance, date, temps visé, nombre de séances, jour de sortie longue et notes. L'allure cible est calculée automatiquement.

## 5. Plan complet jusqu'au jour J
Le Coach construit tout le plan jusqu'à l'objectif avec des phases adaptées au temps disponible : Base, Développement, Spécifique, Affûtage, Objectif. Les semaines passées ne sont jamais réécrites.

## 6. Diversité des séances
Pour un objectif course/trail, le Coach peut utiliser : endurance fondamentale, sortie longue, allure spécifique, tempo/seuil, intervalles, côtes, renforcement, mobilité, vélo/gravel, récupération et repos. Le nombre de séances demandé représente le volume total d'entraînement, pas uniquement le nombre de sorties course.

## 7. Plan proposé, pas imposé
La création produit un plan proposé. L'ancien plan reste actif jusqu'à acceptation. L'athlète peut : Accepter, Ajuster avec le Coach, ou Décider plus tard.

## 8. Gérer mon plan
L'athlète peut modifier : séances/semaine, sorties course/semaine, renforcement, cross-training, côtes, volume, difficulté, nombre maximal de séances difficiles, jour et durée max de sortie longue, ainsi qu'une note libre. Le Coach doit expliquer les compromis et signaler les demandes qu'il déconseille.

## 9. Validation des changements
Aucune modification importante du plan n'est silencieuse. Le Coach produit une proposition avec un diff Avant/Après. L'athlète choisit Appliquer ou Garder mon plan.

## 10. Révision hebdomadaire
À chaque nouvelle semaine, l'app propose un bilan de la semaine terminée. Il s'appuie sur : séances prévues/réalisées, ressentis, douleur, récupération, charge et données COROS disponibles. Le Coach peut proposer de progresser, maintenir ou alléger. L'athlète valide avant application.

## 11. Versions et explications
Chaque changement appliqué crée une version du plan avec date, raison, résumé et diff. L'app doit pouvoir répondre à « Pourquoi mon plan a changé ? ».

## 12. Aujourd'hui
La séance du jour est strictement celle datée du jour. Un jour sans séance dans un plan est un jour de repos/récupération, pas une erreur. Sans plan actif, l'app affiche explicitement qu'aucune séance n'est planifiée.

## 13. Adaptation quotidienne
Le Coach peut proposer une adaptation à partir de COROS et du ressenti. L'athlète garde ou applique. Une séance terminée ne peut plus être réécrite.

## 14. Après activité
L'app importe l'activité COROS, compare prévu/réalisé, recueille le ressenti et explique l'impact éventuel sur la suite du plan.

## 15. Suppression
Supprimer un objectif actif supprime son plan mais conserve profil, activités, ressentis et historique sportif. Aucun autre objectif ne devient actif silencieusement. L'interface passe immédiatement en état « Aucun objectif actif / Aucun plan actif ».

## 16. Plusieurs objectifs
Un seul objectif principal est actif. D'autres objectifs peuvent être proposés, planifiés ou futurs. Ils n'influencent pas le calendrier actif tant qu'ils ne sont pas acceptés/activés.

## 17. Persistance du prototype
Tant que le backend Vercel utilise `/tmp`, l'app maintient une continuité locale sur l'appareil pour les objectifs/plans et les suppressions, puis restaure le backend après recyclage d'instance. Cette continuité n'est pas un substitut à une future base de données multi-appareils.
