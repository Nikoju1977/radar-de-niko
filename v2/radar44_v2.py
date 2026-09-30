#!/usr/bin/env python3
"""
Radar44 V2 core:
- normalize authors
- classify origin type
- infer probable source/origin inside an event
- prepare PostgreSQL/Supabase upserts

This file has no hard dependency on Supabase.
If DATABASE_URL is present and psycopg is installed, use --persist.
Otherwise it can run entirely on JSON.
"""

from __future__ import annotations
import argparse, json, os, re, hashlib, unicodedata
from pathlib import Path
from urllib.parse import urlsplit

AGENCY_MARKERS = [
    "afp", "agence france-presse", "reuters", "associated press", "ap "
]

PRESS_RELEASE_MARKERS = [
    "communiqué de presse", "communique de presse",
    "selon un communiqué", "dans un communiqué",
    "la préfecture annonce", "la mairie annonce",
    "nantes métropole annonce", "le département annonce",
    "la région annonce"
]

INSTITUTIONAL_DOMAINS = [
    "loire-atlantique.fr",
    "nantes.fr",
    "metropole.nantes.fr",
    "paysdelaloire.fr",
    "loire-atlantique.gouv.fr"
]

OPINION_MARKERS = [
    "tribune", "opinion", "édito", "editorial", "chronique"
]

AGENDA_MARKERS = [
    "agenda", "ce week-end", "sorties", "concert", "exposition", "spectacle"
]

def fold(value: str) -> str:
    value = unicodedata.normalize("NFKD", value or "")
    value = "".join(c for c in value if not unicodedata.combining(c))
    return re.sub(r"\s+", " ", value.lower()).strip()

def normalize_author_name(name: str) -> str:
    name = re.sub(r"\s+", " ", (name or "").strip())
    name = re.sub(r"^(par|by)\s+", "", name, flags=re.I)
    name = re.sub(r"\s*[|/]\s*.*$", "", name)
    return name.strip(" ,;-")

def normalized_author_key(name: str) -> str:
    n = fold(normalize_author_name(name))
    n = re.sub(r"[^a-z0-9 ]", "", n)
    return re.sub(r"\s+", " ", n).strip()

def classify_origin(article: dict) -> tuple[str, float]:
    title = fold(article.get("title", ""))
    excerpt = fold(article.get("excerpt", ""))
    content = fold(article.get("content", ""))
    text = " ".join([title, excerpt, content])
    domain = urlsplit(article.get("canonical_url") or article.get("url","")).netloc.lower()

    if any(d in domain for d in INSTITUTIONAL_DOMAINS):
        return "INSTITUTIONAL", 0.98
    if any(m in text for m in AGENCY_MARKERS):
        return "AGENCY", 0.90
    if any(m in text for m in PRESS_RELEASE_MARKERS):
        return "PRESS_RELEASE", 0.82
    if any(m in title for m in OPINION_MARKERS):
        return ("TRIBUNE" if "tribune" in title else "OPINION"), 0.88
    if any(m in title for m in AGENDA_MARKERS):
        return "AGENDA", 0.72

    # Syndication hint: copied text / explicit republishing language.
    if "avec afp" in text or "source afp" in text or "reproduction" in text:
        return "SYNDICATED", 0.80

    return "UNKNOWN", 0.45

def title_signature(title: str) -> set[str]:
    stop = {"le","la","les","de","des","du","un","une","et","a","au","aux","en","dans",
            "sur","pour","par","avec","sans","ce","cette","ces","son","sa","ses","plus",
            "apres","avant","qui","que","est","sont","nantes","loire","atlantique"}
    t = fold(title)
    t = re.sub(r"[^a-z0-9 ]", " ", t)
    return {x for x in t.split() if len(x) > 2 and x not in stop}

def jaccard(a: set[str], b: set[str]) -> float:
    if not a or not b:
        return 0.0
    return len(a & b) / len(a | b)

def infer_event_origin(articles: list[dict]) -> dict:
    """
    Conservative inference:
    - earliest explicit ORIGINAL_REPORTING wins if present;
    - then earliest non-agency/non-syndicated article;
    - if several very similar articles appear shortly after an institutional/press-release item,
      mark the later copies as probable derivatives.
    """
    def ts(a):
        return a.get("published_at") or "9999"
    ordered = sorted(articles, key=ts)
    if not ordered:
        return {"origin_article_external_key": None, "confidence": 0.0}

    for a in ordered:
        if a.get("origin_type") == "ORIGINAL_REPORTING":
            return {"origin_article_external_key": a.get("external_key"), "confidence": 0.95}

    candidates = [a for a in ordered if a.get("origin_type") not in {"AGENCY","SYNDICATED"}]
    origin = candidates[0] if candidates else ordered[0]

    # Institutional/press release source followed by near-identical headlines is a strong clue.
    base_sig = title_signature(origin.get("title",""))
    derivative_hits = 0
    for later in ordered[1:]:
        if jaccard(base_sig, title_signature(later.get("title",""))) >= 0.55:
            derivative_hits += 1

    confidence = 0.72
    if origin.get("origin_type") in {"PRESS_RELEASE","INSTITUTIONAL"} and derivative_hits:
        confidence = 0.90
    elif derivative_hits >= 2:
        confidence = 0.82

    return {
        "origin_article_external_key": origin.get("external_key"),
        "confidence": confidence
    }

def enrich_articles(payload: dict) -> dict:
    articles = payload.get("articles", [])
    for a in articles:
        raw_author = a.get("author") or a.get("author_raw") or ""
        a["author_raw"] = raw_author
        a["author_name"] = normalize_author_name(raw_author)
        a["author_key"] = normalized_author_key(raw_author)

        origin_type, confidence = classify_origin(a)
        # Preserve stronger upstream classification if present.
        if a.get("origin_type") in {
            "ORIGINAL_REPORTING","AGENCY","PRESS_RELEASE","INSTITUTIONAL",
            "SYNDICATED","OPINION","TRIBUNE","AGENDA"
        }:
            pass
        else:
            a["origin_type"] = origin_type
        a["origin_confidence"] = max(float(a.get("origin_confidence") or 0), confidence)

        content_material = (a.get("content") or a.get("excerpt") or "")
        a["content_hash"] = hashlib.sha256(content_material.encode("utf-8")).hexdigest() if content_material else None
        a["title_hash"] = hashlib.sha256(fold(a.get("title","")).encode("utf-8")).hexdigest()
        a["external_key"] = a.get("id") or hashlib.sha1(
            ((a.get("canonical_url") or a.get("url","")) + "|" + a.get("title","")).encode("utf-8")
        ).hexdigest()

    event_map = {}
    for a in articles:
        event_map.setdefault(a.get("event_id") or "__none__", []).append(a)

    event_origins = {}
    for event_id, group in event_map.items():
        if event_id == "__none__":
            continue
        event_origins[event_id] = infer_event_origin(group)

    payload["event_origins"] = event_origins
    return payload

def persist_postgres(payload: dict, source_registry: dict | None = None):
    try:
        import psycopg
    except ImportError as exc:
        raise SystemExit("Install psycopg: pip install 'psycopg[binary]'") from exc

    url = os.environ.get("DATABASE_URL")
    if not url:
        raise SystemExit("DATABASE_URL is not set")

    with psycopg.connect(url) as conn:
        with conn.cursor() as cur:
            # Media
            if source_registry:
                for s in source_registry.get("sources", []):
                    cur.execute("""
                        insert into media
                            (id,name,slug,media_type,territory,rss_url,priority,ingestion_mode,reuse_status)
                        values (%s,%s,%s,%s,%s,%s,%s,%s,%s)
                        on conflict (id) do update set
                            name=excluded.name,
                            media_type=excluded.media_type,
                            territory=excluded.territory,
                            rss_url=excluded.rss_url,
                            priority=excluded.priority,
                            ingestion_mode=excluded.ingestion_mode,
                            reuse_status=excluded.reuse_status,
                            updated_at=now()
                    """, (
                        s["id"], s["name"], s["id"], s.get("type"),
                        s.get("territory", []), s.get("feed_url"),
                        s.get("priority",3), s.get("ingestion"),
                        s.get("status","unknown")
                    ))

            journalist_ids = {}
            for a in payload.get("articles", []):
                author_key = a.get("author_key")
                media_id = a.get("source_id")
                if author_key:
                    cur.execute("""
                        insert into journalists (canonical_name, normalized_name, media_id, last_seen_at)
                        values (%s,%s,%s,now())
                        on conflict (normalized_name, media_id) do update set
                            canonical_name=excluded.canonical_name,
                            last_seen_at=now()
                        returning id
                    """, (a.get("author_name") or a.get("author_raw"), author_key, media_id))
                    journalist_ids[(author_key,media_id)] = cur.fetchone()[0]

            # Create/update events first.
            event_db_ids = {}
            for e in payload.get("events", []):
                fingerprint = e.get("id") or hashlib.sha1(e.get("title","").encode()).hexdigest()
                cur.execute("""
                    insert into events
                        (fingerprint,title,communes,topics,started_at,last_seen_at,source_count,article_count,confidence)
                    values (%s,%s,%s,%s,%s,%s,%s,%s,%s)
                    on conflict (fingerprint) do update set
                        title=excluded.title,
                        communes=excluded.communes,
                        topics=excluded.topics,
                        started_at=least(events.started_at, excluded.started_at),
                        last_seen_at=greatest(events.last_seen_at, excluded.last_seen_at),
                        source_count=excluded.source_count,
                        article_count=excluded.article_count,
                        confidence=excluded.confidence,
                        updated_at=now()
                    returning id
                """, (
                    fingerprint, e.get("title"), e.get("communes",[]), e.get("topics",[]),
                    e.get("first_published_at"), e.get("last_published_at"),
                    e.get("source_count",0), e.get("article_count",0),
                    float(e.get("confidence") or 0.65)
                ))
                event_db_ids[e.get("id")] = cur.fetchone()[0]

            article_db_ids = {}
            for a in payload.get("articles", []):
                jid = journalist_ids.get((a.get("author_key"), a.get("source_id")))
                eid = event_db_ids.get(a.get("event_id"))
                cur.execute("""
                    insert into articles
                        (external_key,media_id,journalist_id,event_id,title,url,canonical_url,guid,author_raw,
                         published_at,excerpt,content_hash,title_hash,communes,topics,origin_type,origin_confidence)
                    values (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                    on conflict (external_key) do update set
                        journalist_id=excluded.journalist_id,
                        event_id=excluded.event_id,
                        title=excluded.title,
                        canonical_url=excluded.canonical_url,
                        author_raw=excluded.author_raw,
                        published_at=excluded.published_at,
                        excerpt=excluded.excerpt,
                        content_hash=excluded.content_hash,
                        title_hash=excluded.title_hash,
                        communes=excluded.communes,
                        topics=excluded.topics,
                        origin_type=excluded.origin_type,
                        origin_confidence=excluded.origin_confidence,
                        updated_at=now()
                    returning id
                """, (
                    a["external_key"], a["source_id"], jid, eid,
                    a["title"], a["url"], a.get("canonical_url") or a["url"], a.get("guid"),
                    a.get("author_raw"), a.get("published_at"), a.get("excerpt"),
                    a.get("content_hash"), a.get("title_hash"),
                    a.get("communes",[]), a.get("topics",[]),
                    a.get("origin_type","UNKNOWN"), float(a.get("origin_confidence") or 0.5)
                ))
                article_db_ids[a["external_key"]] = cur.fetchone()[0]

            # Link probable origin article to each article in an event.
            for event_id, origin in payload.get("event_origins", {}).items():
                origin_ext = origin.get("origin_article_external_key")
                origin_db_id = article_db_ids.get(origin_ext)
                if not origin_db_id:
                    continue
                cur.execute("""
                    update articles
                    set probable_origin_article_id=%s
                    where event_id=%s and id<>%s
                """, (origin_db_id, event_db_ids.get(event_id), origin_db_id))
        conn.commit()

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--input", type=Path, required=True)
    ap.add_argument("--output", type=Path, default=Path("radar44_v2_output.json"))
    ap.add_argument("--sources", type=Path)
    ap.add_argument("--persist", action="store_true")
    args = ap.parse_args()

    payload = json.loads(args.input.read_text(encoding="utf-8"))
    payload = enrich_articles(payload)
    args.output.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")

    registry = None
    if args.sources and args.sources.exists():
        registry = json.loads(args.sources.read_text(encoding="utf-8"))

    if args.persist:
        persist_postgres(payload, registry)

    print(json.dumps({
        "articles": len(payload.get("articles", [])),
        "events": len(payload.get("events", [])),
        "event_origins": len(payload.get("event_origins", {})),
        "output": str(args.output)
    }, ensure_ascii=False, indent=2))

if __name__ == "__main__":
    main()
