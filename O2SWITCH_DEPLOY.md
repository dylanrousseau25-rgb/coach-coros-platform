# Déploiement V5 sur o2switch Cloud

La V5 n'est pas encore destinée à remplacer la V4 de production. Ce document prépare un environnement **staging**.

## 1. Domaine

Créer un sous-domaine de staging, par exemple:

`staging-coach.example.fr`

Garder le domaine de production séparé.

## 2. Base MySQL / MariaDB

Dans cPanel:

1. créer une base dédiée au staging;
2. créer un utilisateur SQL dédié;
3. attribuer tous les droits à cet utilisateur sur cette base uniquement.

Reporter ces valeurs dans les variables `DATABASE_*`.

## 3. Setup Node.js App

Dans cPanel > Setup Node.js App:

- Node.js version: **24**
- Application mode: **Production**
- Application root: dossier privé contenant le dépôt, par exemple `coach-v5-staging`
- Application URL: le sous-domaine staging
- Application startup file: `v5-start.js`
- Passenger log file: un fichier hors document root, par exemple `logs/coach-v5-staging.log`

Ne pas placer le code source dans le document root public du domaine.

## 4. Variables d'environnement

Ajouter au minimum:

- `NODE_ENV=production`
- `APP_URL=https://<sous-domaine-staging>`
- `APP_TIMEZONE=Europe/Paris`
- `DATABASE_HOST`
- `DATABASE_PORT=3306`
- `DATABASE_NAME`
- `DATABASE_USER`
- `DATABASE_PASSWORD`
- `SESSION_SECRET`
- `TOKEN_ENCRYPTION_KEY`
- `SESSION_TTL_DAYS=30`
- `OPENAI_API_KEY`
- `OPENAI_MODEL=gpt-5.6-luna`

Les secrets doivent être de longues valeurs aléatoires et ne doivent jamais être commités.

## 5. Installation

Dans l'environnement Node.js o2switch:

```bash
npm install
npm run migrate:v5
```

Puis créer le compte administrateur avec des variables temporaires `ADMIN_*`:

```bash
npm run create-admin:v5
```

Migrer ensuite les données V4:

```bash
npm run migrate-v4:v5
```

## 6. Vérification

- `GET /health` doit renvoyer `database: connected`
- login admin
- `GET /auth/me`
- `GET /api/v5/dashboard`

## 7. COROS

La demande COROS doit utiliser une redirect URI HTTPS exacte correspondant au futur callback, par exemple:

`https://<sous-domaine-staging>/api/providers/coros/callback`

Ne pas coder les endpoints OAuth COROS avant réception de leur documentation / Client ID / Secret.

## 8. Production

Le basculement de la V4 vers la V5 ne sera fait qu'après:
- test avec deux comptes;
- contrôle anti-fuite de `user_id`;
- synchronisation COROS réelle;
- sauvegarde DB;
- test de rollback.
