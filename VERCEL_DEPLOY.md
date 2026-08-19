# Déploiement Vercel — Coach COROS V3

Cette variante est prête pour Vercel.

## Important pour le test

- L'interface et les API fonctionnent en ligne.
- Sans `OPENAI_API_KEY`, le coach reste en mode démo.
- La persistance des changements utilise `/tmp` sur Vercel et est donc **temporaire** : Vercel peut réinitialiser les objectifs/feedbacks créés lors d'un redémarrage de fonction.
- Pour la vraie version, brancher une base durable (Postgres/KV) avant utilisation réelle.

## Variables facultatives

- `OPENAI_API_KEY`
- `OPENAI_MODEL` (défaut : `gpt-5.6-terra`)
- `APP_TIMEZONE` (défaut : `Europe/Paris`)
- `COROS_MODE` (défaut : `demo`)

## Déploiement

Importer ce dossier dans Vercel ou lancer `vercel` depuis sa racine.
