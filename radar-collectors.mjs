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
      score: r.score != null ? Math.round(r.score * 100) : null
    }));
  }
});

/* ─── Collecteur dépendant : ne tourne qu'après les sources ──── */

defineCollector({
  id: 'local_relevance',
  name: 'Pertinence Loire-Atlantique',
  source: 'radar',
  version: '2.0',
  mode: 'enrich',                       // patche les items retenus, n'en crée aucun
  requires: ['reach_twitter', 'reach_reddit', 'reach_youtube', 'reach_exa'],
  collect: ({ results }) => {
    const TERMS = /(loire-atlantique|nantes|châteaubriant|chateaubriant|ancenis|blain|nozay|meilleraye|derval|guémené|guemene|\b44\b)/i;
    const pool = ['reach_twitter', 'reach_reddit', 'reach_youtube', 'reach_exa']
      .flatMap(id => results.get(id)?.items ?? []);

    return pool
      .filter(i => TERMS.test(`${i.title} ${i.summary ?? ''}`))
      .map(i => ({ id: i.id, patch: { tags: ['44'], local: true } }));
  }
});
