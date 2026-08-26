# Coach COROS V5 — état du chantier

Branche: `v5-multi-user`

## Terminé

### V5-A — socle MySQL
- pool MySQL/MariaDB via `mysql2`
- migrations versionnées
- scripts de migration

### V5-B — authentification privée
- inscription sur invitation
- login / logout / `me`
- mots de passe `crypto.scrypt`
- session opaque hashée en base
- cookie `HttpOnly`, `SameSite=Lax`, `Secure` en production
- bootstrap admin + codes d'invitation

### V5-C — données sportives persistantes
- `athlete_profiles`
- `provider_connections`
- `daily_metrics`
- `activities`
- `objectives`
- `training_plans`
- `plan_sessions`
- `activity_feedback`
- `coach_threads` / `coach_messages`
- `sync_jobs`
- script idempotent `data/state.json` → compte V5

### V5-D — dashboard isolé et contrat API normalisé
- `GET /api/v5/dashboard`
- toutes les requêtes portent le `user_id` authentifié
- données SQL normalisées vers le contrat frontend (`avgHr`, `date`, `hrTarget`, etc.)
- `todaySession` exige une date exactement égale à aujourd'hui
- `metricsFresh` indique explicitement si les métriques sont datées d'aujourd'hui
- aucune ancienne séance n'est recyclée via `status = today`

### V5-RC1 — interface et premières mutations
- le serveur V5 sert directement l'interface mobile existante
- `/app.js` est remplacé côté serveur V5 par `public/v5-app.js`
- écran connexion / création de compte sur invitation
- compte connecté visible dans le profil + déconnexion
- statut COROS/Garmin visible dans le profil
- création et activation d'objectifs persistantes
- `J'ai terminé` persiste la séance en `completed`
- feedback post-activité persistant
- Coach IA isolé par utilisateur et conversations persistées
- les métriques non fraîches sont masquées / explicitement signalées
- états vides pour absence de séance, activité ou plan
- rafraîchissement au retour dans l'app et au changement de date

### Préparation providers
- tokens provider chiffrés en AES-256-GCM
- repository générique COROS/Garmin
- stockage / révocation / état provider
- startup `v5-start.js` compatible o2switch Passenger

## Routes disponibles

- `GET /health`
- `POST /auth/register`
- `POST /auth/login`
- `POST /auth/logout`
- `GET /auth/me`
- `GET /api/v5/bootstrap`
- `GET /api/v5/dashboard`
- `GET /api/v5/providers`
- `POST /api/v5/objectives`
- `POST /api/v5/objectives/:id/activate`
- `POST /api/v5/sessions/:id/complete`
- `POST /api/v5/activities/:id/feedback`
- `POST /api/v5/coach`
- `POST /api/v5/providers/:provider/disconnect`

## Vérifications

- `npm run test:v5` vérifie les invariants de fraîcheur, le branchement `/api/v5` et l'isolation `user_id`
- les nouveaux fichiers serveur/client passent `node --check`

## Reste avant "clean / prête pour staging"

1. Exécuter migrations + tests avec une vraie base MySQL locale/staging de test.
2. Tester deux comptes distincts et les tentatives d'accès croisé par ID.
3. Ajouter la validation explicite des propositions d'adaptation (`proposer → appliquer/refuser`) au lieu d'une simple réponse Coach.
4. Finaliser la navigation réelle entre semaines du plan.
5. Ajouter protections anti-abus (login + Coach) et contrôle d'origine des mutations.
6. Nettoyer README / variables d'environnement / scripts et faire une revue secrets.
7. Obtenir ensuite les credentials développeur COROS et implémenter le callback OAuth.

## Lancer le socle

1. Créer une base MySQL/MariaDB de test.
2. Renseigner les variables `DATABASE_*`, `SESSION_SECRET` et `TOKEN_ENCRYPTION_KEY`.
3. `npm install`
4. `npm run migrate:v5`
5. Renseigner `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `ADMIN_NAME`.
6. `npm run create-admin:v5`
7. Renseigner `MIGRATION_USER_EMAIL` avec l'email admin.
8. `npm run migrate-v4:v5`
9. `npm run create-invite:v5 -- 1 14`
10. `npm run test:v5`
11. `npm run start:v5`

## Important

Le serveur V4 reste le `npm start` par défaut. La V5 n'a pas remplacé la production.
Le déploiement o2switch reste volontairement en pause jusqu'à validation RC1.
