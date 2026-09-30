-- Radar44 V2 — PostgreSQL / Supabase schema
-- PostgreSQL 15+ compatible

create extension if not exists pgcrypto;
create extension if not exists unaccent;

create table if not exists media (
    id text primary key,
    name text not null,
    slug text unique,
    media_type text,
    territory text[] default '{}',
    website text,
    rss_url text,
    muckrack_url text,
    priority smallint default 3 check (priority between 1 and 5),
    ingestion_mode text,
    reuse_status text default 'unknown',
    active boolean default true,
    created_at timestamptz default now(),
    updated_at timestamptz default now()
);

create table if not exists journalists (
    id uuid primary key default gen_random_uuid(),
    canonical_name text not null,
    normalized_name text not null,
    media_id text references media(id) on delete set null,
    profile_url text,
    muckrack_url text,
    city text,
    territory text[] default '{}',
    specialties text[] default '{}',
    verified boolean default false,
    first_seen_at timestamptz default now(),
    last_seen_at timestamptz default now(),
    unique (normalized_name, media_id)
);

create table if not exists events (
    id uuid primary key default gen_random_uuid(),
    fingerprint text unique,
    title text not null,
    summary text,
    communes text[] default '{}',
    topics text[] default '{}',
    started_at timestamptz,
    last_seen_at timestamptz,
    source_count integer default 0,
    article_count integer default 0,
    confidence numeric(4,3) default 0.5,
    created_at timestamptz default now(),
    updated_at timestamptz default now()
);

create table if not exists articles (
    id uuid primary key default gen_random_uuid(),
    external_key text unique not null,
    media_id text not null references media(id) on delete cascade,
    journalist_id uuid references journalists(id) on delete set null,
    event_id uuid references events(id) on delete set null,

    title text not null,
    url text not null,
    canonical_url text not null,
    guid text,
    author_raw text,
    published_at timestamptz,
    fetched_at timestamptz default now(),

    excerpt text,
    content_hash text,
    title_hash text,
    communes text[] default '{}',
    topics text[] default '{}',

    origin_type text default 'UNKNOWN'
        check (origin_type in (
            'ORIGINAL_REPORTING',
            'AGENCY',
            'PRESS_RELEASE',
            'INSTITUTIONAL',
            'SYNDICATED',
            'OPINION',
            'TRIBUNE',
            'AGENDA',
            'UNKNOWN'
        )),
    origin_confidence numeric(4,3) default 0.5,
    probable_origin_article_id uuid references articles(id) on delete set null,

    created_at timestamptz default now(),
    updated_at timestamptz default now()
);

create index if not exists idx_articles_published_at on articles(published_at desc);
create index if not exists idx_articles_event_id on articles(event_id);
create index if not exists idx_articles_media_id on articles(media_id);
create index if not exists idx_articles_journalist_id on articles(journalist_id);
create index if not exists idx_articles_communes_gin on articles using gin(communes);
create index if not exists idx_articles_topics_gin on articles using gin(topics);
create index if not exists idx_events_started_at on events(started_at desc);
create index if not exists idx_events_communes_gin on events using gin(communes);
create index if not exists idx_events_topics_gin on events using gin(topics);

-- "Qui a publié en premier ?" : premier article connu de chaque événement.
create or replace view event_first_publishers as
select distinct on (a.event_id)
    a.event_id,
    a.id as article_id,
    a.media_id,
    m.name as media_name,
    a.journalist_id,
    j.canonical_name as journalist_name,
    a.title,
    a.url,
    a.published_at,
    a.origin_type,
    a.origin_confidence
from articles a
join media m on m.id = a.media_id
left join journalists j on j.id = a.journalist_id
where a.event_id is not null
order by a.event_id, a.published_at asc nulls last, a.fetched_at asc;

-- Vue principale pour les cartes Radar44.
create or replace view radar_event_cards as
select
    e.id,
    e.title,
    e.summary,
    e.communes,
    e.topics,
    e.started_at,
    e.last_seen_at,
    e.source_count,
    e.article_count,
    e.confidence,
    fp.media_name as first_media,
    fp.journalist_name as first_journalist,
    fp.published_at as first_published_at,
    fp.url as first_url
from events e
left join event_first_publishers fp on fp.event_id = e.id;

-- Comptage des journalistes par média.
create or replace view journalist_activity as
select
    j.id,
    j.canonical_name,
    j.media_id,
    m.name as media_name,
    count(a.id) as article_count,
    max(a.published_at) as last_article_at
from journalists j
left join media m on m.id = j.media_id
left join articles a on a.journalist_id = j.id
group by j.id, j.canonical_name, j.media_id, m.name;
