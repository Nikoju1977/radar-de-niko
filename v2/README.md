# Radar44 V2

V2 ajoute une vraie couche de données pour PostgreSQL / Supabase.

## Architecture

```text
RSS / Atom
   ↓
Radar44 V1
   ↓
articles normalisés + événements
   ↓
Radar44 V2
   ├── media
   ├── journalists
   ├── articles
   ├── events
   └── probable_origin_article
```

## Nouveautés

### Journalistes
Une signature RSS telle que :

```text
Alain Moreau
```

devient une entité `journalists` liée au média.

La clé de rapprochement V2 est volontairement prudente :

```text
normalized_name + media_id
```

Ainsi deux journalistes homonymes travaillant dans deux médias ne sont pas fusionnés automatiquement.

### Origine d'une information

Chaque article peut être classé :

- `ORIGINAL_REPORTING`
- `AGENCY`
- `PRESS_RELEASE`
- `INSTITUTIONAL`
- `SYNDICATED`
- `OPINION`
- `TRIBUNE`
- `AGENDA`
- `UNKNOWN`

La V2 n'affirme pas automatiquement qu'un média a "copié" un autre.
Elle stocke un **probable_origin_article_id** et un score de confiance.

### Qui a publié en premier ?

La vue :

```sql
event_first_publishers
```

renvoie le premier article daté connu de chaque événement.

Attention : cela signifie **premier parmi les sources ingérées par Radar44**, pas nécessairement premier dans le monde réel.

## Supabase

1. Créer un projet Supabase.
2. Ouvrir SQL Editor.
3. Exécuter `schema.sql`.
4. Facultatif : exécuter `seed.sql`.
5. Copier l'URL PostgreSQL dans `DATABASE_URL`.

Exemple :

```bash
export DATABASE_URL='postgresql://...'
pip install 'psycopg[binary]'
```

Puis :

```bash
python radar44_v2.py \
  --input radar44_output.json \
  --sources radar44_sources_v1.json \
  --persist
```

## Cycle complet

```bash
python radar44_pipeline.py \
  --sources radar44_sources_v1.json \
  --communes communes_44.json \
  --output radar44_output.json

python radar44_v2.py \
  --input radar44_output.json \
  --sources radar44_sources_v1.json \
  --output radar44_v2_output.json \
  --persist
```

## Principe éditorial important

Radar44 doit distinguer :

> "Premier article détecté par Radar44"

de :

> "Source originale de l'information"

Le premier est mesurable objectivement.
Le second est une inférence qui doit rester accompagnée d'un score de confiance.

## V3 recommandé

- embeddings pour clustering sémantique ;
- extraction de personnes/organisations ;
- géocodage quartiers/lieux-dits ;
- interface web de validation des clusters ;
- page publique `/journalistes`;
- page `/evenement/:id` montrant la chronologie des publications ;
- tâches planifiées pour ingestion régulière ;
- journal d'audit des corrections humaines.
