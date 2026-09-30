/**
 * radar-collectors.mjs — un bloc autonome par source.
 * Ajouter une source = ajouter un defineCollector(). Rien d'autre à toucher.
 *
 * ⚠️ L'appel réel à Agent Reach est isolé dans reach() ci-dessous.
 * C'est le SEUL endroit à remplacer par le code de ton radar-agent-reach.mjs.
 */

import { defineCollector } from './radar-registry.mjs';

/* ─── Adapter Agent Reach (point d'injection unique) ─────────── */

let reachImpl = null;

/** Branche ton implémentation réelle : setReach(async (platform, opts) => items[]) */
export function setReach(fn) { reachImpl = fn; }

async function reach(platform, opts) {
  if (!reachImpl) throw new Error(`Agent Reach non branché (setReach) — plateforme ${platform}`);
  return reachImpl(platform, opts);
}

/* ─── Sources ────────────────────────────────────────────────── */

defineCollector({
  id: 'reach_twitter',
  name: 'Twitter / X',
  source: 'twitter',
  version: '1.0',
  timeout: 25000,
  retries: 2,
  collect: async ({ query, since, signal }) => {
    const raw = await reach('twitter', { query, since, limit: 50, signal });
    return raw.map(t => ({
      title: (t.text ?? '').split('\n')[0].slice(0, 180),
      url: t.url ?? `https://x.com/${t.username}/status/${t.id}`,
      publishedAt: t.created_at,
      author: t.username,
      summary: t.text,
      imageUrl: t.imageUrl,
      score: (t.like_count ?? 0) + 2 * (t.retweet_count ?? 0)
    }));
  }
});

defineCollector({
  id: 'reach_reddit',
  name: 'Reddit',
  source: 'reddit',
  version: '1.0',
  retries: 2,
  collect: async ({ query, since, signal }) => {
    const raw = await reach('reddit', { query, since, limit: 50, signal });
    return raw.map(p => ({
      title: p.title,
      url: p.url ?? p.permalink,
      publishedAt: p.created_utc ? new Date(p.created_utc * 1000).toISOString() : null,
      author: p.author,
      summary: p.selftext,
      imageUrl: p.imageUrl,
      score: p.score
    }));
  }
});

defineCollector({
  id: 'reach_youtube',
  name: 'YouTube',
  source: 'youtube',
  version: '1.0',
  collect: async ({ query, since, signal }) => {
    const raw = await reach('youtube', { query, since, limit: 30, signal });
    return raw.map(v => ({
      title: v.title,
      url: v.url ?? `https://www.youtube.com/watch?v=${v.videoId}`,
      publishedAt: v.publishedAt,
      author: v.channelTitle,
      summary: v.description,
      imageUrl: v.thumbnail,
      score: v.viewCount
    }));
  }
});

defineCollector({
  id: 'reach_exa',
  name: 'Exa (web)',
  source: 'exa',
  version: '1.0',
  timeout: 30000,
  collect: async ({ query, since, signal }) => {
    const raw = await reach('exa', { query, since, limit: 40, signal });
    return raw.map(r => ({
      title: r.title,
      url: r.url,
      publishedAt: r.publishedDate,
      author: r.author,
      summary: r.text ?? r.highlights?.join(' … '),
      imageUrl: r.imageUrl,
      score: r.score != null ? Math.round(r.score * 100) : null
    }));
  }
});

defineCollector({
  id: 'reach_gnews',
  name: 'Google News',
  source: 'gnews',
  version: '1.0',
  retries: 2,
  collect: async ({ query, since, signal }) => {
    const raw = await reach('gnews', { query, since, limit: 60, signal });
    return raw.map(n => ({
      title: n.title,
      url: n.url,
      publishedAt: n.pubDate && !isNaN(Date.parse(n.pubDate)) ? new Date(n.pubDate).toISOString() : null,
      author: n.source,
      summary: n.description,
      imageUrl: n.imageUrl
    }));
  }
});

defineCollector({
  id: 'reach_bing', name: 'Bing News', source: 'bing', version: '1.0', retries: 2,
  collect: async ({ query, since, signal }) => {
    const raw = await reach('bing', { query, since, limit: 40, signal });
    return raw.map(n => ({
      title: n.title, url: n.url, author: n.source, summary: n.description, imageUrl: n.imageUrl,
      publishedAt: n.pubDate && !isNaN(Date.parse(n.pubDate)) ? new Date(n.pubDate).toISOString() : null
    }));
  }
});

defineCollector({
  id: 'reach_feeds', name: 'Presse locale & nationale (flux)', source: 'presse', version: '1.0',
  timeout: 40000, retries: 1,
  collect: async ({ query, since, signal, log }) => {
    const raw = await reach('feeds', { query, since, limit: 300, signal });
    if (raw.failedFeeds?.length) log?.(`flux en échec : ${raw.failedFeeds.join(' ; ')}`);
    return raw.map(n => ({
      title: n.title, url: n.url, author: n.feed, summary: n.description, imageUrl: n.imageUrl,
      publishedAt: n.pubDate && !isNaN(Date.parse(n.pubDate)) ? new Date(n.pubDate).toISOString() : null
    }));
  }
});

defineCollector({
  id: 'reach_bluesky', name: 'Bluesky', source: 'bluesky', version: '1.0', retries: 2,
  collect: async ({ query, since, signal }) => {
    const raw = await reach('bluesky', { query, since, limit: 50, signal });
    return raw.map(p => ({
      title: p.text.split('\n')[0].slice(0, 180), url: p.url, publishedAt: p.createdAt,
      author: p.handle, summary: p.text, imageUrl: p.imageUrl, score: p.likeCount + 2 * p.repostCount
    }));
  }
});

defineCollector({
  id: 'reach_mastodon', name: 'Mastodon', source: 'mastodon', version: '1.0', retries: 1,
  collect: async ({ query, since, signal }) => {
    const raw = await reach('mastodon', { query, since, limit: 60, signal });
    return raw.map(p => ({
      title: p.text.slice(0, 180), url: p.url, publishedAt: p.createdAt,
      author: p.acct, summary: p.text, imageUrl: p.imageUrl, score: p.favourites + 2 * p.reblogs
    }));
  }
});

const SOURCES = ['reach_gnews', 'reach_bing', 'reach_feeds', 'reach_bluesky', 'reach_mastodon', 'reach_twitter', 'reach_reddit', 'reach_youtube', 'reach_exa'];

/* ─── Collecteur dépendant : ne tourne qu'après les sources ──── */

defineCollector({
  id: 'local_relevance',
  name: 'Pertinence Loire-Atlantique',
  source: 'radar',
  version: '2.0',
  mode: 'enrich',                       // patche les items retenus, n'en crée aucun
  requires: SOURCES,
  collect: ({ results }) => {
    const TERMS = /(?:^|[^a-z])(loire[- ]atlantique|nantes|nantais|saint[- ]nazaire|chateaubriant|ancenis|blain|nozay|meilleraye|derval|guemene|moisdon|isse|erbray|sion[- ]les[- ]mines|saffre|heric|clisson|pornic|la baule|guerande|reze|saint[- ]herblain|orvault|vertou|bouguenais|carquefou|pontchateau|saint[- ]brevin|montoir|savenay|coueron|loireatlantique|44)(?:[^a-z]|$)/i;
    const pool = SOURCES
      .flatMap(id => results.get(id)?.items ?? []);

    return pool
      .filter(i => {
        const raw = `${i.title} ${i.summary ?? ''}`;
        const folded = raw.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
        return TERMS.test(folded) || /rougé/i.test(raw);
      })
      .map(i => ({ id: i.id, patch: { tags: ['44'], local: true } }));
  }
});
