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

## Branchement d'Agent Reach

Le seul point d'injection est `setReach()` dans `radar-collectors.mjs`.
Déposer `radar-agent-reach.mjs` à la racine, avec un export `search(platform, opts) -> items[]`.

## Garanties vérifiées

- Cycle, id dupliqué, source manquante, dépendance inconnue : bloquent au démarrage
- Timeout par collecteur, avec reprises
- Collecteurs I/O lancés en parallèle par niveau de dépendance
- Une source morte n'emporte pas la veille (`allSettled`)
- Déduplication par URL canonique (UTM, fbclid, gclid, fragment, slash final)
- Échappement XML des titres dans le flux RSS

## Limites connues

- Les mappings de champs des collecteurs sont déduits des formes habituelles des APIs,
  pas d'un adaptateur Agent Reach réel — à valider au premier run branché.
- Pas de pagination ni de gestion de quota par plateforme.
