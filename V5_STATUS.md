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

### V5-D — premier dashboard isolé
- `GET /api/v5/dashboard`
- toutes les requêtes portent le `user_id` authentifié
- état, objectifs, plan et activités chargés uniquement pour le compte courant

## Lancer le socle

1. Créer une base MySQL/MariaDB.
2. Renseigner les variables `DATABASE_*` et `SESSION_SECRET`.
3. `npm install`
4. `npm run migrate:v5`
5. Renseigner `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `ADMIN_NAME`.
6. `npm run create-admin:v5`
7. Renseigner `MIGRATION_USER_EMAIL` avec l'email admin.
8. `npm run migrate-v4:v5`
9. `npm run create-invite:v5 -- 1 14`
10. `npm run start:v5`

## Routes disponibles

- `GET /health`
- `POST /auth/register`
- `POST /auth/login`
- `POST /auth/logout`
- `GET /auth/me`
- `GET /api/v5/bootstrap`
- `GET /api/v5/dashboard`

## Important

Le serveur V4 reste le `npm start` par défaut. Aucune production n'a été remplacée.

### Préparation V5-E/F
- tokens provider chiffrés en AES-256-GCM
- repository générique COROS/Garmin
- stockage / révocation / état provider
- startup `v5-start.js` compatible o2switch Passenger
- procédure de staging o2switch documentée

Prochain verrou externe: obtenir les credentials développeur COROS et fixer l'URL HTTPS de staging pour le callback OAuth.
