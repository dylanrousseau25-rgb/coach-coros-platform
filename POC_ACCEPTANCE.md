# Coach COROS Platform — POC terminé

## Parcours validé

Le POC est considéré comme fonctionnel lorsqu'un athlète unique peut :

1. connecter COROS une fois via OAuth ;
2. synchroniser récupération, sommeil, charge, fitness et activités ;
3. créer un objectif avec distance, chrono, date de début, date cible et contraintes ;
4. obtenir **avant la génération du plan** un avis de faisabilité du Coach : réaliste, ambitieux, trop agressif ou données insuffisantes, avec estimation et chrono recommandé quand les données le permettent ;
5. choisir de suivre la recommandation du Coach ou de conserver son objectif initial en connaissance de cause ;
6. recevoir un plan complet personnalisé jusqu'à l'objectif ;
7. accepter le plan ou demander des ajustements avant application ;
8. utiliser un plan mêlant course/trail, côtes, renforcement et vélo/gravel lorsque pertinent ;
9. naviguer semaine par semaine ;
10. adapter une séance avec comparaison avant/après ;
11. importer une activité COROS et la rapprocher automatiquement d'une séance prévue quand la date et le sport sont compatibles ;
12. ajouter un ressenti et obtenir une analyse Coach structurée ;
13. recevoir un bilan hebdomadaire sous forme de proposition, jamais de modification silencieuse ;
14. réévaluer la faisabilité de l'objectif pendant la préparation à partir des nouvelles données disponibles ;
15. supprimer, activer ou reconstruire un objectif sans recréer un ancien plan au rafraîchissement sur l'appareil courant.

## Règles de sécurité produit

- Les données COROS fictives ne doivent jamais être présentées comme des données live.
- Une séance terminée ne peut plus être adaptée rétroactivement.
- Les semaines passées restent historiques ; les adaptations concernent le présent et le futur.
- Le Coach propose les changements importants, l'athlète les valide.
- Un objectif jugé trop agressif n'est pas silencieusement remplacé : le Coach explique et l'athlète décide.
- Une estimation de faisabilité doit indiquer son niveau de confiance et signaler quand les données sont insuffisantes.
- Pour un trail, un chrono ne doit pas être déclaré fiable sans éléments suffisants sur le dénivelé/terrain.
- Le rapprochement activité ↔ séance est volontairement prudent : même date et sport compatible. En cas d'ambiguïté, aucune validation automatique.
- La prévention des blessures prime sur la performance.

## Continuité du POC

La version mono-utilisateur utilise encore le stockage temporaire Vercel, complété par une continuité locale sur l'appareil pour :

- objectifs et plans ;
- suppressions ;
- versions et changements de plan ;
- ressentis ;
- messages Coach utiles.

Cette continuité est suffisante pour tester le POC sur un appareil, mais **n'est pas l'architecture de la V1 multi-compte**.

## Volontairement reporté à la V1 multi-compte

- authentification utilisateur ;
- base de données durable avec `user_id` ;
- synchronisation multi-appareils ;
- comptes multiples et isolation des données ;
- onboarding complet ;
- Garmin ;
- stockage durable des tokens fournisseurs côté serveur ;
- historique complet des activités dans la base ;
- notifications ;
- direction artistique finale / identité de marque ;
- analytics produit et administration.

## Limites COROS connues

Certaines métriques, notamment la FC seuil / zones selon le flux MCP disponible, peuvent ne pas être fournies. L'interface doit alors afficher `—` ou une explication, jamais inventer une valeur.

L'estimation de faisabilité est une aide de coaching, pas une garantie de résultat. Elle s'appuie sur les données disponibles (prédictions COROS, allure seuil, VO₂max, charge, récupération, temps de préparation et fréquence d'entraînement) et doit être réévaluée pendant le plan.

## Prochaine phase

La prochaine version doit repartir de ce contrat fonctionnel avec une architecture multi-compte et une base durable, puis appliquer la direction artistique finale sur ce socle.
