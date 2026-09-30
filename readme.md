# Radar de Niko — noyau de collecte

**Veille en direct :** https://nikoju1977.github.io/radar-de-niko/ · **Flux RSS :** https://nikoju1977.github.io/radar-de-niko/radar.xml · **JSONL :** https://nikoju1977.github.io/radar-de-niko/radar.jsonl

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
| `radar-collectors.mjs` | Un bloc par source (Google News, Twitter, Reddit, YouTube, Exa, pertinence 44) |
| `radar-agent-reach.mjs` | Clients HTTP des plateformes (reprises, OAuth Reddit, parseur RSS) |
| `radar-run.mjs` | Point d'entrée CLI |
| `radar-page.mjs` | Page publique statique (balayage 24 h, filtres) |
| `radar-daily.mjs` | Quotidien régional : une, thèmes, multi-sources, jeux et « La note de Niko » |
| `radar-v3.mjs` | V3 : événements, chronologies, médias, journalistes et lieux |
| `radar-services.mjs` | V4 : météo, air, vigilance, crues, trafic, transports, carburants, agenda, emploi et services |
| `radar-services-view.mjs` | Rendu du bandeau « Aujourd’hui dans le 44 » |
| `public/` | PWA : manifeste, service worker (lecture hors ligne), icônes, écrans de démarrage iOS |
| `radar-sources.json` | Flux RSS fixes et hashtags Mastodon |

## Utilisation

```bash
node radar-run.mjs --stub                      # jeu fictif, aucun réseau
node radar-run.mjs --query "Châteaubriant" --since 2026-09-01 --out ./dist
node radar-run.mjs --only reddit,exa
```

Sorties dans `--out` : `radar.xml`, `radar.jsonl`, `radar.md`, `quotidien.html`, `v3/index.html`, `v3/radar-v3.json` et, lors d’un run connecté, `services.json`.

## Application (PWA)

Installable depuis https://nikoju1977.github.io/radar-de-niko/ :
- **Android / Chrome / Edge** : bouton « Installer l'app » dans l'en-tête.
- **iPhone / iPad** : dans Safari, Partager → « Sur l'écran d'accueil » (une aide s'affiche au premier passage).

Hors ligne, la dernière veille reçue reste lisible. Raccourcis : `?f=new` (nouveautés), `?f=l44` (Loire-Atlantique).
Badge d'icône = nombre de nouveautés (Android ; iOS 16.4+ si les notifications sont autorisées).

### Radar44 V3

La vue `/v3/` regroupe les articles proches en **événements** et montre leur chronologie par média. Elle expose également les signatures journalistes détectées dans les flux RSS, les médias et les communes citées. Le regroupement est volontairement conservateur : il s'agit d'une aide à la lecture, pas d'une affirmation qu'un média a copié un autre.

### Quotidien régional

Le Quotidien affiche les indicateurs V3, les sujets suivis par plusieurs médias et un lien vers leur chronologie. **« La note de Niko »** ajoute une phrase humoristique déterministe liée au thème dominant du jour ; elle bascule vers une formulation sobre lorsque l'édition est dominée par des faits graves.

#### Quotidien V4 — Aujourd’hui dans le 44

Le bandeau pratique regroupe météo pour Châteaubriant/Nantes/Saint-Nazaire, lever et coucher du soleil, AQI européen, vigilance Météo-France, Vigicrues, accès aux marées officielles SHOM, circulation, perturbations SNCF, carburants, agenda, emploi et services/travaux. Chaque source est isolée : une API indisponible dégrade uniquement sa carte, jamais l’édition entière.

## Clés et sources

| Source | Variable(s) | Sans clé |
|---|---|---|
| Google News (RSS) | aucune | fonctionne partout |
| Bing News (RSS) | aucune | fonctionne partout |
| Presse locale & nationale (`radar-sources.json`) | aucune | Actu44, Actu Nantes, L'Éclaireur de Châteaubriant, Pays de Retz, Presqu'île, Sèvre-et-Maine, France 3 PDL, ICI Loire Océan, Ouest-France, 20 Minutes Nantes, franceinfo, r/nantes |
| Bluesky | `BSKY_HANDLE`, `BSKY_APP_PASSWORD` (optionnels, compte gratuit) | API publique, deux endpoints en repli — 403 intermittent depuis certaines IP GitHub |
| Mastodon (fils par hashtag, instances et tags dans `radar-sources.json`) | aucune | fonctionne partout |
| Reddit | `REDDIT_CLIENT_ID`, `REDDIT_CLIENT_SECRET` (optionnels) | flux Atom de recherche — fonctionne depuis GitHub Actions |
| YouTube | `YOUTUBE_API_KEY` | ignorée |
| Exa | `EXA_API_KEY` | ignorée |
| Twitter / X | `TWITTER_BEARER_TOKEN` (API v2 recent search, offre payante) | ignorée |
| Vigilance Météo-France | `METEOFRANCE_API_TOKEN` | carte affichée comme non configurée ; le reste de la V4 fonctionne |
| Météo / soleil / air | aucune | Open-Meteo / CAMS |
| Vigicrues | aucune | API publique Vigicrues |
| Trafic Nantes | aucune | Nantes Métropole Open Data |
| SNCF temps réel | aucune | SIRI Lite via transport.data.gouv.fr |
| Carburants | aucune | DGCCRF / data.economie.gouv.fr |
| Marées | aucune | extrema indicatifs via Open-Meteo marine + lien vers le SHOM, référence officielle ; ne pas utiliser pour la navigation |

En local : copier `.env.example` en `.env`, il est chargé automatiquement.
Une source sans clé est écartée avant le run, pas comptée en échec.

## CI (`.github/workflows/radar.yml`)

- `pull_request` vers `main` et `push` sur `main` : syntaxe, suites de tests, run stub, validation RSS et PWA.
- Toutes les 15 minutes + déclenchement manuel (requête, sources, date plancher) :
  run réel avec les secrets du dépôt, digest dans le résumé du run,
  `radar.xml` / `radar.jsonl` / `radar.md` / `index.html` en artefact `radar`, puis publiés sur GitHub Pages.
- Mémoire de 14 jours entre runs (cache Actions) : chaque item jamais vu est marqué 🆕 et remonte en tête du digest.
- Code de sortie 3 si aucune source n'a pu tourner.

## Garanties vérifiées

- Cycle, id dupliqué, source manquante, dépendance inconnue : bloquent au démarrage
- Timeout par collecteur, avec reprises (429 + Retry-After, 5xx)
- Collecteurs I/O lancés en parallèle par niveau de dépendance
- Une source morte n'emporte pas la veille (`allSettled`)
- L'enrichissement 44 tourne dès qu'une source a produit, même si d'autres échouent ou sont filtrées
- Déduplication par URL canonique (UTM, fbclid, gclid, fragment, slash final)
- Échappement XML des titres dans le flux RSS

## Ajouter une source gratuite

Un flux RSS/Atom : une ligne dans `radar-sources.json`. Un hashtag Mastodon : une entrée dans `mastodon.tags`.
Sources testées et **refusées** depuis GitHub Actions (sept. 2026) : GDELT (429), Presse Océan (403), RSSHub public (403).

## Tests

```bash
npm test     # noyau + adaptateur (fetch simulé) + chaîne complète
npm run stub # run fictif, aucun réseau
```

## Limites connues

- YouTube : `viewCount` non récupéré (exigerait un appel `videos.list`, +1 unité de quota).
- Twitter : fenêtre de 7 jours imposée par l'API recent search.
