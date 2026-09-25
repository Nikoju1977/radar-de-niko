/**
 * radar-agent-reach.mjs — adaptateur de sources pour le Radar de Niko.
 *
 * Export unique attendu par radar-run.mjs :
 *   search(platform, { query, since, limit, signal }) -> items[]
 *
 * Les formes retournées ici sont exactement celles que consomme
 * radar-collectors.mjs — les deux fichiers sont alignés, plus de mapping deviné.
 *
 * Note conventions : ce fichier tourne sous Node, pas dans un navigateur.
 * La règle XHR-only du Studio vise l'origine null d'Android sur les apps
 * single-file ; côté Node il n'existe pas d'XMLHttpRequest, donc fetch natif.
 *
 * Clés lues dans l'environnement (voir .env.example) :
 *   EXA_API_KEY, YOUTUBE_API_KEY, TWITTER_BEARER_TOKEN
 *   REDDIT_CLIENT_ID + REDDIT_CLIENT_SECRET (optionnels, recommandés)
 * Reddit : OAuth application si les deux clés sont présentes, sinon endpoint
 * JSON public — ce dernier est souvent refusé (403) depuis les IP de datacenter
 * (GitHub Actions, VPS) : en CI, fournir les clés Reddit.
 */

const UA = 'radar-de-niko/1.0 (+https://github.com/Nikoju1977/radar-de-niko)';

/* ═══════════════════════════════════════════════════════════
   Transport : timeout, 429 avec Retry-After, reprises
   ═══════════════════════════════════════════════════════════ */

class HttpError extends Error {
  constructor(status, url, body) {
    super(`HTTP ${status} sur ${new URL(url).host}${body ? ` — ${String(body).slice(0, 160)}` : ''}`);
    this.status = status;
  }
}

async function request(url, { method = 'GET', headers = {}, body = null, as = 'json',
                              accept = 'application/json',
                              signal = null, retries = 2, timeout = 20000 } = {}) {
  for (let attempt = 0; ; attempt++) {
    const ac = new AbortController();
    const onAbort = () => ac.abort();
    signal?.addEventListener('abort', onAbort, { once: true });
    const timer = setTimeout(() => ac.abort(), timeout);

    try {
      const res = await fetch(url, {
        method, body, signal: ac.signal,
        headers: { 'user-agent': UA, accept, ...headers }
      });

      if (res.status === 429 || res.status >= 500) {
        const wait = Number(res.headers.get('retry-after')) * 1000
                  || Math.min(8000, 600 * 2 ** attempt);
        if (attempt < retries) {
          await new Promise(r => setTimeout(r, wait));
          continue;
        }
        throw new HttpError(res.status, url, await res.text().catch(() => ''));
      }
      if (!res.ok) throw new HttpError(res.status, url, await res.text().catch(() => ''));
      return as === 'text' ? res.text() : res.json();
    } catch (e) {
      if (e.name === 'AbortError' && !signal?.aborted) {
        if (attempt < retries) continue;
        throw new Error(`délai dépassé (${timeout} ms) sur ${new URL(url).host}`);
      }
      if (e instanceof HttpError || attempt >= retries) throw e;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    }
  }
}

const need = name => {
  const v = process.env[name];
  if (!v) throw new Error(`${name} absente de l'environnement`);
  return v;
};

const toEpoch = since => since ? Math.floor(new Date(since).getTime() / 1000) : 0;

/* ═══════════════════════════════════════════════════════════
   Clients par plateforme
   ═══════════════════════════════════════════════════════════ */

/** Jeton applicatif Reddit (client_credentials), mis en cache jusqu'à expiration. */
let redditToken = null;
/** Vide le cache d'authentification (tests, rotation de clés). */
export const resetAuth = () => { redditToken = null; bskySession = null; };
async function redditAuth(signal) {
  const id = process.env.REDDIT_CLIENT_ID, secret = process.env.REDDIT_CLIENT_SECRET;
  if (!id || !secret) return null;
  if (redditToken && redditToken.exp > Date.now() + 60e3) return redditToken.value;
  const json = await request('https://www.reddit.com/api/v1/access_token', {
    method: 'POST', signal,
    headers: {
      authorization: 'Basic ' + Buffer.from(`${id}:${secret}`).toString('base64'),
      'content-type': 'application/x-www-form-urlencoded'
    },
    body: 'grant_type=client_credentials'
  });
  if (!json?.access_token) throw new Error(`OAuth Reddit refusé${json?.error ? ` — ${json.error}` : ''}`);
  redditToken = { value: json.access_token, exp: Date.now() + (json.expires_in ?? 3600) * 1000 };
  return redditToken.value;
}

/** Reddit sans clé — flux Atom de recherche, accepté depuis GitHub Actions. */
async function redditRSS({ query, since, limit = 50, signal }) {
  const u = new URL('https://www.reddit.com/search.rss');
  u.searchParams.set('q', query); u.searchParams.set('sort', 'new'); u.searchParams.set('limit', String(Math.min(100, limit)));
  const xml = await request(u.toString(), { signal, accept: FEED_ACCEPT, as: 'text' });
  return recent(parseRSS(xml), since).slice(0, limit).map(e => ({
    title: e.title,
    url: e.url,
    created_utc: e.pubDate ? Date.parse(e.pubDate) / 1000 : null,
    author: e.source ? `u/${e.source.replace(/^\/?u\//, '')}` : null,
    selftext: e.description,
    score: null
  }));
}

/** Reddit — OAuth si clés, sinon flux Atom. Pagination par curseur `after`. */
async function reddit({ query, since, limit = 50, signal }) {
  const cut = toEpoch(since);
  const out = [];
  let after = null;
  const token = await redditAuth(signal);
  if (!token) return redditRSS({ query, since, limit, signal });
  const base = token ? 'https://oauth.reddit.com/search' : 'https://www.reddit.com/search.json';
  const headers = token ? { authorization: `Bearer ${token}` } : {};

  while (out.length < limit) {
    const u = new URL(base);
    u.searchParams.set('q', query);
    u.searchParams.set('sort', 'new');
    u.searchParams.set('limit', String(Math.min(100, limit - out.length)));
    u.searchParams.set('raw_json', '1');
    if (after) u.searchParams.set('after', after);

    let json;
    try {
      json = await request(u.toString(), { signal, headers });
    } catch (e) {
      if (e.status === 403 && !token) {
        throw new Error('Reddit refuse l\'accès anonyme depuis cette IP (403) — renseigner REDDIT_CLIENT_ID et REDDIT_CLIENT_SECRET');
      }
      throw e;
    }
    const children = json?.data?.children ?? [];
    if (!children.length) break;

    for (const { data: p } of children) {
      if (cut && p.created_utc < cut) return out;   // tri décroissant : on peut couper
      out.push({
        title: p.title,
        url: p.url?.startsWith('http') ? p.url : `https://www.reddit.com${p.permalink}`,
        created_utc: p.created_utc,
        author: p.author ? `u/${p.author}` : null,
        selftext: p.selftext || null,
        score: p.score
      });
    }
    after = json.data.after;
    if (!after) break;
  }
  return out.slice(0, limit);
}

/** YouTube Data API v3 — quota 100 unités par recherche, d'où le plafond serré. */
async function youtube({ query, since, limit = 30, signal }) {
  const key = need('YOUTUBE_API_KEY');
  const out = [];
  let pageToken = null;

  while (out.length < limit) {
    const u = new URL('https://www.googleapis.com/youtube/v3/search');
    u.searchParams.set('part', 'snippet');
    u.searchParams.set('q', query);
    u.searchParams.set('type', 'video');
    u.searchParams.set('order', 'date');
    u.searchParams.set('maxResults', String(Math.min(50, limit - out.length)));
    u.searchParams.set('key', key);
    if (since) u.searchParams.set('publishedAfter', new Date(since).toISOString());
    if (pageToken) u.searchParams.set('pageToken', pageToken);

    const json = await request(u.toString(), { signal });
    for (const it of json.items ?? []) {
      out.push({
        videoId: it.id?.videoId,
        title: it.snippet?.title,
        url: it.id?.videoId ? `https://www.youtube.com/watch?v=${it.id.videoId}` : null,
        publishedAt: it.snippet?.publishedAt,
        channelTitle: it.snippet?.channelTitle,
        description: it.snippet?.description,
        viewCount: null                            // exigerait un appel videos.list séparé
      });
    }
    pageToken = json.nextPageToken;
    if (!pageToken) break;
  }
  return out.slice(0, limit);
}

/** Exa — recherche neuronale, POST avec x-api-key. */
async function exa({ query, since, limit = 40, signal }) {
  const key = need('EXA_API_KEY');
  const json = await request('https://api.exa.ai/search', {
    method: 'POST',
    headers: { 'x-api-key': key, 'content-type': 'application/json' },
    body: JSON.stringify({
      query,
      numResults: Math.min(100, limit),
      type: 'auto',
      contents: { text: { maxCharacters: 800 }, highlights: { numSentences: 2 } },
      ...(since ? { startPublishedDate: new Date(since).toISOString() } : {})
    }),
    signal, timeout: 30000
  });

  return (json.results ?? []).map(r => ({
    title: r.title,
    url: r.url,
    publishedDate: r.publishedDate,
    author: r.author,
    text: r.text,
    highlights: r.highlights,
    score: r.score
  }));
}

/** Twitter / X — API v2 recent search, fenêtre de 7 jours côté fournisseur. */
async function twitter({ query, since, limit = 50, signal }) {
  const bearer = need('TWITTER_BEARER_TOKEN');
  const out = [];
  let next = null;

  while (out.length < limit) {
    const u = new URL('https://api.twitter.com/2/tweets/search/recent');
    u.searchParams.set('query', `${query} -is:retweet lang:fr`);
    u.searchParams.set('max_results', String(Math.max(10, Math.min(100, limit - out.length))));
    u.searchParams.set('tweet.fields', 'created_at,public_metrics,author_id');
    u.searchParams.set('expansions', 'author_id');
    u.searchParams.set('user.fields', 'username');
    if (since) u.searchParams.set('start_time', new Date(since).toISOString());
    if (next) u.searchParams.set('next_token', next);

    const json = await request(u.toString(), {
      headers: { authorization: `Bearer ${bearer}` }, signal
    });

    const users = new Map((json.includes?.users ?? []).map(x => [x.id, x.username]));
    for (const t of json.data ?? []) {
      const username = users.get(t.author_id) ?? null;
      out.push({
        id: t.id,
        username,
        text: t.text,
        url: username ? `https://x.com/${username}/status/${t.id}` : null,
        created_at: t.created_at,
        like_count: t.public_metrics?.like_count ?? 0,
        retweet_count: t.public_metrics?.retweet_count ?? 0
      });
    }
    next = json.meta?.next_token;
    if (!next) break;
  }
  return out.slice(0, limit);
}

/** Google News — flux RSS de recherche, sans clé. */
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
const decode = t => String(t ?? '')
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  .replace(/&(#x?[0-9a-f]+|\w+);/gi, (m, e) => e[0] === '#'
    ? String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : +e.slice(1))
    : ENT[e.toLowerCase()] ?? m);
const strip = h => decode(h).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const tag = (xml, name) => xml.match(new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`, 'i'))?.[1] ?? null;

export function parseRSS(xml) {
  const src = String(xml);
  // Atom (Reddit, YouTube…) : <entry> avec <link href="…"/>
  if (!/<item\b/i.test(src) && /<entry\b/i.test(src)) {
    return [...src.matchAll(/<entry\b[^>]*>([\s\S]*?)<\/entry>/gi)].map(([, e]) => ({
      title: strip(tag(e, 'title')),
      url: decode(e.match(/<link\b[^>]*rel=["']alternate["'][^>]*href=["']([^"']+)/i)?.[1]
                ?? e.match(/<link\b[^>]*href=["']([^"']+)/i)?.[1] ?? '') || null,
      pubDate: decode(tag(e, 'published') ?? tag(e, 'updated')).trim() || null,
      source: strip(tag(tag(e, 'author') ?? '', 'name')) || null,
      description: strip(tag(e, 'content') ?? tag(e, 'summary')).slice(0, 800) || null
    }));
  }
  return [...src.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)].map(([, it]) => {
    const source = strip(tag(it, 'source'));
    let title = strip(tag(it, 'title'));
    if (source && title.endsWith(` - ${source}`)) title = title.slice(0, -source.length - 3);
    return {
      title,
      url: decode(tag(it, 'link')).trim() || null,
      pubDate: decode(tag(it, 'pubDate')).trim() || null,
      source: source || null,
      description: strip(tag(it, 'description')) || null
    };
  });
}

async function gnews({ query, since, limit = 50, signal }) {
  const u = new URL('https://news.google.com/rss/search');
  u.searchParams.set('q', since ? `${query} after:${new Date(since).toISOString().slice(0, 10)}` : query);
  u.searchParams.set('hl', 'fr'); u.searchParams.set('gl', 'FR'); u.searchParams.set('ceid', 'FR:fr');
  const xml = await request(u.toString(), { signal, accept: 'application/rss+xml, application/xml' , as: 'text' });
  return parseRSS(xml).slice(0, limit);
}

const FEED_ACCEPT = 'application/rss+xml, application/atom+xml, application/xml;q=0.9, */*;q=0.5';
const cutoff = since => since ? new Date(since).getTime() : 0;
const recent = (items, since) => items.filter(i => !since || !i.pubDate || Date.parse(i.pubDate) >= cutoff(since));

/** Bing News — RSS de recherche, sans clé. */
async function bing({ query, since, limit = 40, signal }) {
  const u = new URL('https://www.bing.com/news/search');
  u.searchParams.set('q', query); u.searchParams.set('format', 'rss');
  u.searchParams.set('setlang', 'fr'); u.searchParams.set('cc', 'FR'); u.searchParams.set('qft', 'sortbydate="1"');
  const xml = await request(u.toString(), { signal, accept: FEED_ACCEPT, as: 'text' });
  return recent(parseRSS(xml), since).slice(0, limit).map(i => ({
    ...i,
    // Bing encapsule le lien réel dans un paramètre url=
    url: (() => { try { return new URL(i.url).searchParams.get('url') || i.url; } catch { return i.url; } })()
  }));
}

/** Flux fixes (radar-sources.json) — lus en parallèle, un flux mort n'emporte pas les autres. */
let sourcesCfg = null;
export async function loadSources() {
  if (sourcesCfg) return sourcesCfg;
  const { readFile } = await import('node:fs/promises');
  sourcesCfg = JSON.parse(await readFile(new URL('./radar-sources.json', import.meta.url), 'utf8'));
  return sourcesCfg;
}
export function setSources(cfg) { sourcesCfg = cfg; }

async function feeds({ since, limit = 200, signal }) {
  const { feeds: list = [] } = await loadSources();
  const settled = await Promise.allSettled(list.map(async f => {
    const xml = await request(f.url, { signal, accept: FEED_ACCEPT, as: 'text', retries: 1 });
    return parseRSS(xml).map(i => ({ ...i, source: i.source && !/^\/?u\//.test(i.source) ? i.source : f.name,
                                     author: i.source, feed: f.name }));
  }));
  const failed = settled.map((s, i) => s.status === 'rejected' ? `${list[i].name} (${s.reason?.message ?? s.reason})` : null).filter(Boolean);
  if (failed.length === list.length && list.length) throw new Error(`tous les flux en échec : ${failed.join(' ; ')}`);
  const out = settled.flatMap(s => s.status === 'fulfilled' ? s.value : []);
  out.failedFeeds = failed;
  return recent(out, since).slice(0, limit);
}

/** Session Bluesky (compte gratuit + mot de passe d'application), mise en cache. */
let bskySession = null;
async function bskyAuth(signal) {
  const id = process.env.BSKY_HANDLE, pw = process.env.BSKY_APP_PASSWORD;
  if (!id || !pw) return null;
  if (bskySession && bskySession.exp > Date.now()) return bskySession.jwt;
  const json = await request('https://bsky.social/xrpc/com.atproto.server.createSession', {
    method: 'POST', signal, headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ identifier: id, password: pw })
  });
  if (!json?.accessJwt) throw new Error('session Bluesky refusée');
  bskySession = { jwt: json.accessJwt, exp: Date.now() + 60 * 60e3 };
  return bskySession.jwt;
}

/**
 * Bluesky — compte gratuit si BSKY_HANDLE + BSKY_APP_PASSWORD, sinon AppView publique.
 * Les endpoints publics filtrent une partie des IP de datacenter (403 intermittent) :
 * on les essaie tour à tour.
 */
async function bluesky({ query, since, limit = 50, signal }) {
  const params = new URLSearchParams({ q: query, sort: 'latest', limit: String(Math.min(100, limit)) });
  if (since) params.set('since', new Date(since).toISOString());
  const jwt = await bskyAuth(signal);
  const hosts = jwt ? ['https://bsky.social'] : ['https://api.bsky.app', 'https://public.api.bsky.app'];
  let json = null, lastErr = null;
  for (const h of hosts) {
    try {
      json = await request(`${h}/xrpc/app.bsky.feed.searchPosts?${params}`, {
        signal, retries: 1, headers: jwt ? { authorization: `Bearer ${jwt}` } : {}
      });
      break;
    } catch (e) { lastErr = e; if (e.status !== 403 && e.status !== 401) throw e; }
  }
  if (!json) throw new Error(`Bluesky refuse cette IP (${lastErr?.status ?? '?'}) — renseigner BSKY_HANDLE et BSKY_APP_PASSWORD (compte gratuit)`);
  return (json.posts ?? []).map(p => {
    const rkey = String(p.uri ?? '').split('/').pop();
    return {
      text: p.record?.text ?? '',
      url: p.author?.handle && rkey ? `https://bsky.app/profile/${p.author.handle}/post/${rkey}` : null,
      createdAt: p.record?.createdAt ?? p.indexedAt,
      handle: p.author?.handle ?? null,
      likeCount: p.likeCount ?? 0,
      repostCount: p.repostCount ?? 0
    };
  });
}

/** Mastodon — fils publics par hashtag, sans compte, sur plusieurs instances. */
const slugTag = t => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
async function mastodon({ query, since, limit = 60, signal }) {
  const cfg = (await loadSources()).mastodon ?? {};
  const instances = cfg.instances ?? ['mastodon.social'];
  const tags = [...new Set([...(cfg.tags ?? []), slugTag(query.replace(/\s+/g, ''))].filter(Boolean))];
  const jobs = instances.flatMap(host => tags.map(t => ({ host, t })));
  const settled = await Promise.allSettled(jobs.map(({ host, t }) =>
    request(`https://${host}/api/v1/timelines/tag/${encodeURIComponent(t)}?limit=40`, { signal, retries: 1 })));
  if (jobs.length && settled.every(s => s.status === 'rejected')) throw settled[0].reason;
  const html = h => strip(h);
  const out = settled.flatMap(s => s.status === 'fulfilled' && Array.isArray(s.value) ? s.value : [])
    .filter(st => !st.reblog && st.visibility === 'public')
    .map(st => ({
      text: html(st.content),
      url: st.url ?? st.uri,
      createdAt: st.created_at,
      acct: st.account?.acct ?? null,
      favourites: st.favourites_count ?? 0,
      reblogs: st.reblogs_count ?? 0
    }));
  return out.filter(i => !since || Date.parse(i.createdAt) >= cutoff(since))
            .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)).slice(0, limit);
}

/* ═══════════════════════════════════════════════════════════
   Façade
   ═══════════════════════════════════════════════════════════ */

const PLATFORMS = { gnews, bing, feeds, bluesky, mastodon, reddit, youtube, exa, twitter };

/** Clés obligatoires par plateforme (Reddit : aucune, OAuth optionnel). */
const REQUIRED = {
  gnews: [], bing: [], feeds: [], bluesky: [], mastodon: [],
  reddit: [],
  youtube: ['YOUTUBE_API_KEY'],
  exa: ['EXA_API_KEY'],
  twitter: ['TWITTER_BEARER_TOKEN']
};

/** Variables manquantes pour une plateforme — [] si elle peut tourner. */
export const missingKeys = (platform, env = process.env) =>
  (REQUIRED[platform] ?? []).filter(k => !env[k]);

export async function search(platform, opts = {}) {
  const fn = PLATFORMS[platform];
  if (!fn) throw new Error(`plateforme inconnue : ${platform}`);
  const items = await fn(opts);
  return Array.isArray(items) ? items : [];
}

export const platforms = () => Object.keys(PLATFORMS);
export { request, HttpError };
export default { search, platforms, missingKeys };
