# Architecture — Coach COROS V3

La V3 sépare l'application permanente des objectifs temporaires.

## Entités

- `athlete` : profil permanent, disponibilités, sports, vigilance blessures.
- `heartRateZones` : référentiel COROS personnel.
- `metrics` : état / forme courante.
- `objectives[]` : défis sportifs successifs ou futurs.
- `plans[]` : plans associés aux objectifs.
- `plans[].sessions[]` : séances planifiées.
- `activities[]` : activités réellement réalisées.
- `feedback[]` : ressenti post-séance lié à une activité et, si applicable, à l'objectif actif.
- `coachMessages[]` : historique de coaching.

## Principe central

```text
Athlète permanent
   ├── Zones COROS
   ├── Historique d'activités
   ├── Feedbacks
   └── Objectifs
         ├── Objectif A → Plan A → Séances
         ├── Objectif B → Plan B → Séances
         └── ...
```

Changer d'objectif ne supprime donc ni les activités, ni les feedbacks, ni les zones, ni le profil.

## API du prototype

- `GET /api/dashboard`
- `GET /api/coros/status`
- `POST /api/objectives`
- `POST /api/objectives/:id/activate`
- `POST /api/objectives/:id/complete`
- `POST /api/feedback`
- `POST /api/coach`

## Étape production

`data/state.json` est volontairement simple pour le prototype. En production, les mêmes entités pourront être transférées vers PostgreSQL / Supabase sans refaire l'interface ni le modèle conceptuel.
