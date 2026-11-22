# Radar de Niko — veille Journal 44

Moteur Node.js de collecte et de restitution pour la veille territoriale autour de Châteaubriant / Loire-Atlantique. Le dépôt **n'héberge pas une page web directement à la racine** : les pages HTML sont générées par `radar-run.mjs` dans `dist/`.

## Architecture présente dans le code

- `radar-run.mjs` : point d'entrée CLI, paramètres et génération des fichiers.
- `radar-registry.mjs` : registre et orchestrateur des collecteurs.
- `radar-agent-reach.mjs` : adaptateurs et sources externes (configuration et autorisations potentiellement nécessaires).
- `radar-page.mjs`, `radar-daily.mjs`, `radar-v3.mjs` : HTML de restitution et visualisations.
- `radar-services.mjs` : collecte de services quotidiens.
- `public/` : ressources PWA copiées dans le répertoire de sortie.

## Commande de génération (exemple documentaire, non exécuté)

```bash
node radar-run.mjs --query "Châteaubriant" --out ./dist
```

Le script produit notamment : `dist/index.html`, `dist/quotidien.html`, `dist/radar.xml`, `dist/radar.jsonl`, `dist/radar.md`, `dist/v3/index.html`, `dist/v3/radar-v3.json` et `dist/facebook.txt`. Certains fichiers additionnels, comme `services.json`, dépendent du mode.

## Attention à la provenance

`node radar-run.mjs --stub` produit **uniquement des données fictives de démonstration**. Ne jamais publier ces résultats comme des actualités réelles. En mode normal, les collecteurs nécessitent des services externes accessibles et, selon les plateformes, des clés ou quotas. Les sources non configurées peuvent être ignorées et une collecte peut échouer.

`--only` limite les sources ; `--since` filtre les dates ; `--state` mémorise les éléments déjà vus entre deux exécutions. Les dates et les liens doivent conserver leur provenance. Aucun accès permanent aux plateformes externes n'est garanti.

## Révision web et sécurité

Voir `AGENTS.md` : Modern Web Guidance s'applique à la génération HTML/PWA, au responsive, à l'accessibilité et à la performance. Ne jamais committer `.env`, secrets de fournisseurs ni jetons.

**État de la présente révision :** documentation reconstituée après lecture des modules, sans exécution du collecteur, sans vérification des APIs et sans publication de sortie.
