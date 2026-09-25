# Radar de Niko — noyau de collecte

Registre de collecteurs pour la veille Journal 44, transposé du pattern de plugins d'ALEAPP.

## Principe

Le noyau ne connaît aucune source. Il connaît un contrat :

```js
defineCollector({
  id, name, source, version,
  requires?: ['autre_id'],   // exécuté après ces collecteurs
  mode?: 'collect' | 'enrich',
  timeout?: 20000,
  retries?: 1,
  collect(ctx) -> items[]
});
```

Un collecteur produit des items. Jamais du RSS. Le noyau normalise, déduplique,
trie et rend (RSS 2.0, JSONL, digest Markdown).

Ajouter une source = ajouter un `defineCollector()`. Rien d'autre à toucher.

## Fichiers

| Fichier | Rôle |
|---|---|
| `radar-registry.mjs` | Noyau : validation, ordonnancement, exécution, sorties |
| `radar-collectors.mjs` | Un bloc par source (Twitter, Reddit, YouTube, Exa, pertinence 44) |
| `radar-run.mjs` | Point d'entrée CLI |

## Utilisation

```bash
node radar-run.mjs --stub                      # jeu fictif, aucun réseau
node radar-run.mjs --query "Châteaubriant" --since 2026-09-01 --out ./dist
node radar-run.mjs --only reddit,exa
```

Sorties dans `--out` : `radar.xml`, `radar.jsonl`, `radar.md`.

## Clés et sources

| Source | Variable(s) | Sans clé |
|---|---|---|
| Reddit | `REDDIT_CLIENT_ID`, `REDDIT_CLIENT_SECRET` (optionnels) | JSON public — refusé (403) depuis les IP GitHub Actions |
| YouTube | `YOUTUBE_API_KEY` | ignorée |
| Exa | `EXA_API_KEY` | ignorée |
| Twitter / X | `TWITTER_BEARER_TOKEN` (API v2 recent search, offre payante) | ignorée |

En local : copier `.env.example` en `.env`, il est chargé automatiquement.
Une source sans clé est écartée avant le run, pas comptée en échec.

## CI (`.github/workflows/radar.yml`)

- `push` sur `main` : syntaxe, 3 suites de tests, run stub, validation RSS.
- Chaque jour à 6 h UTC + déclenchement manuel (requête, sources, date plancher) :
  run réel avec les secrets du dépôt, digest dans le résumé du run,
  `radar.xml` / `radar.jsonl` / `radar.md` en artefact `radar`.
- Code de sortie 3 si aucune source n'a pu tourner.

## Garanties vérifiées

- Cycle, id dupliqué, source manquante, dépendance inconnue : bloquent au démarrage
- Timeout par collecteur, avec reprises (429 + Retry-After, 5xx)
- Collecteurs I/O lancés en parallèle par niveau de dépendance
- Une source morte n'emporte pas la veille (`allSettled`)
- L'enrichissement 44 tourne dès qu'une source a produit, même si d'autres échouent ou sont filtrées
- Déduplication par URL canonique (UTM, fbclid, gclid, fragment, slash final)
- Échappement XML des titres dans le flux RSS

## Tests

```bash
npm test     # noyau + adaptateur (fetch simulé) + chaîne complète
npm run stub # run fictif, aucun réseau
```

## Limites connues

- YouTube : `viewCount` non récupéré (exigerait un appel `videos.list`, +1 unité de quota).
- Twitter : fenêtre de 7 jours imposée par l'API recent search.
