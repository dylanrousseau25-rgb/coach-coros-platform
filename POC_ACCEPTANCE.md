# Coach COROS Platform — POC terminé

## Parcours validé

Le POC est considéré comme fonctionnel lorsqu'un athlète unique peut :

1. connecter COROS une fois via OAuth ;
2. synchroniser récupération, sommeil, charge, fitness et activités ;
3. créer un objectif avec distance, chrono, date de début, date cible et contraintes ;
4. recevoir un plan complet personnalisé jusqu'à l'objectif ;
5. accepter le plan ou demander des ajustements avant application ;
6. utiliser un plan mêlant course/trail, côtes, renforcement et vélo/gravel lorsque pertinent ;
7. naviguer semaine par semaine ;
8. adapter une séance avec comparaison avant/après ;
9. importer une activité COROS et la rapprocher automatiquement d'une séance prévue quand la date et le sport sont compatibles ;
10. ajouter un ressenti et obtenir une analyse Coach structurée ;
11. recevoir un bilan hebdomadaire sous forme de proposition, jamais de modification silencieuse ;
12. supprimer, activer ou reconstruire un objectif sans recréer un ancien plan au rafraîchissement sur l'appareil courant.

## Règles de sécurité produit

- Les données COROS fictives ne doivent jamais être présentées comme des données live.
- Une séance terminée ne peut plus être adaptée rétroactivement.
- Les semaines passées restent historiques ; les adaptations concernent le présent et le futur.
- Le Coach propose les changements importants, l'athlète les valide.
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

## Prochaine phase

La prochaine version doit repartir de ce contrat fonctionnel avec une architecture multi-compte et une base durable, puis appliquer la direction artistique finale sur ce socle.
