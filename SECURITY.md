# Sécurité du projet

## Signaler un problème en privé

Ne pas divulguer publiquement les failles exploitables, secrets, données d'utilisateurs ou médias privés. Utiliser la fonction de signalement privé de vulnérabilité GitHub lorsqu'elle est disponible ; sinon, contacter le mainteneur par un moyen privé depuis son profil. Ne jamais transmettre de clés API ou d'informations personnelles réelles.

Décrire avec des **données fictives** le composant, les étapes minimales de reproduction, la version concernée et l'impact estimé. Aucun délai de prise en charge n'est garanti.

## Risques spécifiques

Collecte de données externes et automatisations : se protéger contre l'injection de contenus, la manipulation de liens, le SSRF dans les URL non fiables, les volumes excessifs et les fuites de tokens d'API. Limiter l'accès en écriture des workflows et respecter les règles des sources.

## Avant déploiement

- Garder clés, jetons et fichiers `.env` hors de l'historique Git et des interfaces publiques.
- Vérifier l'accès, l'origine des dépendances, les traitements côté serveur, les appels réseau et les autorisations navigateur.
- Tester sur une branche dédiée, examiner le diff et consigner les limitations.
- Ne pas confondre une démonstration publiée avec une application auditée ou certifiée.

[Catalogue Studio Niko Design](https://github.com/Nikoju1977).
