# Coach COROS V5 — état du chantier

Branche: `v5-multi-user`

## Phase actuelle

### V5-A — socle MySQL
- pool MySQL/MariaDB via `mysql2`
- migrations versionnées
- tables `users`, `sessions`, `invite_codes`
- scripts de migration et bootstrap

### V5-B — authentification privée
- inscription sur invitation
- login / logout / `me`
- mots de passe avec `crypto.scrypt`
- session opaque stockée sous forme de hash
- cookie `HttpOnly`, `SameSite=Lax`, `Secure` en production
- expiration configurable

## Lancer localement

1. Créer une base MySQL/MariaDB.
2. Copier `.env.example` vers un fichier d'environnement géré hors Git.
3. Renseigner `DATABASE_*` et `SESSION_SECRET`.
4. Installer: `npm install`
5. Migrer: `npm run migrate:v5`
6. Créer le premier admin: `npm run create-admin:v5`
7. Créer une invitation: `npm run create-invite:v5 -- 1 14`
8. Démarrer: `npm run start:v5`

Le serveur V5 écoute par défaut sur le port 8788.

## Routes disponibles

- `GET /health`
- `POST /auth/register`
- `POST /auth/login`
- `POST /auth/logout`
- `GET /auth/me`
- `GET /api/v5/bootstrap` (authentifié)

## Important

Le serveur V4 reste le `npm start` par défaut tant que les données sportives n'ont pas été migrées. La V5 n'est pas encore la production.

Prochaine phase: V5-C — schéma sportif + migration des données V4 vers le compte admin.
