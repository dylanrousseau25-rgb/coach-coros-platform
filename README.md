# Coach COROS — V3 Platform

V3 transforme le prototype centré sur une préparation 20 km en une **application de coaching permanente et multi-objectifs**.

Le 20 km du 11 octobre 2026 est désormais simplement le premier objectif actif de l'athlète.

## Ce que la V3 change

- Écran **Aujourd'hui** : état COROS + objectif actif + séance du jour.
- Écran **Plan** : affiche le plan lié à l'objectif actif.
- Écran **Objectifs** : crée de nouveaux objectifs et active celui sur lequel travailler.
- Écran **Progrès** : zones COROS, métriques, activités et feedbacks restent indépendants d'un plan.
- Écran **Coach** : reçoit le profil permanent + l'objectif / plan actif + les données récentes.
- **Profil permanent** : disponibilités, sports, vigilance blessures et zones FC COROS.
- PWA avec service worker pour une installation ultérieure sur téléphone.

## Démonstration multi-objectifs

Dans l'écran **Objectifs**, appuie sur `+` pour créer un autre défi, par exemple un semi-marathon.

Le nouvel objectif est créé en statut `Prévu`. Tu peux ensuite l'activer. L'ancien plan est mis en pause mais l'historique d'activités, les feedbacks, les zones COROS et le profil restent en place.

## Lancer localement

Prérequis : Node.js 20+.

```bash
npm start
```

Puis :

```text
http://localhost:8787
```

## Tests

```bash
npm test
```

Le test vérifie notamment qu'un deuxième objectif peut être créé et activé sans perte du profil et de l'historique.

## OpenAI

Le mode démo fonctionne sans clé.

Pour connecter un modèle OpenAI :

```bash
export OPENAI_API_KEY="..."
export OPENAI_MODEL="..."
npm start
```

## COROS

Les valeurs COROS du prototype sont actuellement stockées dans `data/state.json`, notamment les zones FC personnelles :

- Z1 : < 134 bpm
- Z2 : 134–151 bpm
- Z3 : 152–160 bpm
- Z4 : 161–171 bpm
- Z5 : 172–178 bpm
- Z6 : > 178 bpm
- FC seuil : 168 bpm

L'intégration COROS réelle pourra remplacer cette source locale sans modifier la structure générale de l'app.

Voir aussi `ARCHITECTURE.md`.
