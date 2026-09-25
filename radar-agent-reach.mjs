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

/** Reddit — OAuth si clés, sinon JSON public. Pagination par curseur `after`. */
async function reddit({ query, since, limit = 50, signal }) {
  const cut = toEpoch(since);
  const out = [];
  let after = null;
  const token = await redditAuth(signal);
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
  return [...String(xml).matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)].map(([, it]) => {
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

/* ═══════════════════════════════════════════════════════════
   Façade
   ═══════════════════════════════════════════════════════════ */

const PLATFORMS = { gnews, reddit, youtube, exa, twitter };

/** Clés obligatoires par plateforme (Reddit : aucune, OAuth optionnel). */
const REQUIRED = {
  gnews: [],
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
