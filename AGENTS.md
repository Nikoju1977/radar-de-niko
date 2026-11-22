# Instructions pour agents — Radar de Niko

Référentiel : https://github.com/GoogleChrome/modern-web-guidance

Le moteur est un générateur Node.js ; modifier les templates `radar-page.mjs`, `radar-daily.mjs` et `radar-v3.mjs` pour les corrections de présentation, **pas uniquement les fichiers HTML générés dans dist/**. Pour chaque tâche web, consulter un guide adapté (par exemple via `npx modern-web-guidance@latest search "responsive data tables"`, puis `retrieve` avec un ID réellement trouvé).

- Respecter le HTML sémantique, les tableaux accessibles, le contraste, le focus, le comportement mobile et les chargements efficaces.
- Préserver la provenance et les dates ; ne jamais fabriquer d'articles ni faire passer les résultats `--stub` pour de vraies nouvelles.
- Tenir compte des erreurs réseau, des quotas, des fournisseurs absents et des restrictions de licences/robots.
- Garder les secrets hors des fichiers publics et des sorties générées.
- Ne pas exécuter de tests ni de collectes réelles sans demande expresse. Distinguer code modifié, génération de sortie et déploiement effectif.
