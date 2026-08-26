# Coach V5 — RC1 clean before deploy

Objectif: aucune mise en staging o2switch avant que la V5 soit utilisable de bout en bout et que les données affichées soient correctement isolées et datées.

## P0 — fraîcheur et vérité des données

- [x] Backend V5: `todaySession` uniquement si `scheduled_date === today`.
- [x] Backend V5: `meta.metricsDate` et `meta.metricsFresh` exposés.
- [ ] Frontend V5: utiliser `meta.metricsFresh` pour récupération / sommeil / charge.
- [ ] Frontend V5: afficher la date de dernière synchro lorsqu'une donnée n'est pas fraîche.
- [ ] Frontend V5: ne jamais recycler une ancienne séance comme séance du jour.
- [ ] Tests: provider connecté + métriques d'hier => métriques du jour masquées.
- [ ] Tests: aucune séance datée aujourd'hui => état vide propre.
- [ ] Rechargement au `pageshow`, `focus`, `visibilitychange` et changement de date locale.

## P0 — multi-utilisateur

- [x] MySQL/MariaDB + migrations.
- [x] Register/login/logout/me.
- [x] Sessions opaques hashées et cookies sécurisés.
- [x] Toutes les tables sportives principales possèdent un `user_id`.
- [x] Dashboard filtré par l'utilisateur authentifié.
- [ ] Tests d'accès croisé compte A / compte B sur toutes les ressources.

## P1 — interface complète V5

- [ ] Écran connexion.
- [ ] Création de compte par invitation.
- [ ] Déconnexion / profil du compte.
- [ ] Brancher Aujourd'hui sur `/api/v5/dashboard`.
- [ ] Brancher Plan sur les données SQL V5.
- [ ] Brancher Progrès sur les données SQL V5.
- [ ] Brancher Coach sur le contexte du compte connecté.
- [ ] Écran Connexions COROS/Garmin.
- [ ] États loading / empty / error cohérents.

## P1 — actions persistantes

- [ ] Ajouter / activer / terminer un objectif.
- [ ] Marquer une séance terminée.
- [ ] Ajouter le ressenti post-activité.
- [ ] Historique Coach persistant.
- [ ] Adaptation: proposition => accepter/refuser => modification réelle du plan.
- [ ] Navigation semaines du plan.

## P1 — providers

- [x] Stockage générique des connexions provider.
- [x] Chiffrement AES-256-GCM préparé pour les tokens.
- [ ] COROS OAuth réel.
- [ ] Synchronisation activités.
- [ ] Synchronisation métriques quotidiennes.
- [ ] Renouvellement automatique du token.
- [ ] Déconnexion / révocation.
- [ ] Garmin après validation COROS.

## P1 — sécurité et qualité

- [ ] Rate limiting auth et Coach.
- [ ] Validation stricte des payloads.
- [ ] Vérification qu'aucun secret n'est commité.
- [ ] Aucun token dans les logs.
- [ ] Tests auth / DB / dashboard / objectifs / feedback / Coach.
- [ ] Service worker/cache version V5.
- [ ] README V5 final.
- [ ] `.env.example` final.

## Gate de déploiement

La V5 devient `RC1` uniquement quand tous les P0 et tous les P1 nécessaires au parcours principal sont validés. Ensuite seulement: staging o2switch, COROS OAuth, test avec un second compte, puis production.
