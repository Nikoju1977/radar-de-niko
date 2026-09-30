-- Useful example queries for Radar44 UI.

-- Latest local events
select *
from radar_event_cards
order by coalesce(first_published_at, started_at) desc
limit 100;

-- Events in Châteaubriant
select *
from radar_event_cards
where 'Châteaubriant' = any(communes)
order by coalesce(first_published_at, started_at) desc;

-- Journalists most active over the last 30 days
select
    j.canonical_name,
    m.name as media,
    count(*) as articles
from articles a
join journalists j on j.id = a.journalist_id
join media m on m.id = a.media_id
where a.published_at >= now() - interval '30 days'
group by j.canonical_name, m.name
order by articles desc;

-- Events picked up by at least 3 different media
select *
from radar_event_cards
where source_count >= 3
order by first_published_at desc;

-- Likely press release / institutional stories
select
    a.title,
    m.name as media,
    a.origin_type,
    a.origin_confidence,
    a.url,
    a.published_at
from articles a
join media m on m.id = a.media_id
where a.origin_type in ('PRESS_RELEASE','INSTITUTIONAL')
order by a.published_at desc;
