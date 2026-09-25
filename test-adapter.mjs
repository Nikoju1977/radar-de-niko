/**
 * test-adapter.mjs — vérifie radar-agent-reach.mjs sans réseau.
 *
 * fetch est remplacé par un simulateur qui rejoue des charges utiles
 * conformes aux vraies APIs. Ça couvre le transport (pagination, 429,
 * 500, timeout) et le mapping des champs, pas la conformité des APIs
 * elles-mêmes — seul un run avec clés peut valider ce dernier point.
 */

import { search, missingKeys, parseRSS } from './radar-agent-reach.mjs';

delete process.env.REDDIT_CLIENT_ID; delete process.env.REDDIT_CLIENT_SECRET;

let failed = 0;
const ok = (n, c) => { if (!c) failed++; console.log((c ? '✓' : '✗ ÉCHEC') + ' ' + n); };
process.on('exit', () => {
  if (failed) { console.error(`\n${failed} test(s) en échec`); process.exitCode = 1; }
  else console.log('\nadaptateur : tout vert');
});

const realFetch = globalThis.fetch;
let calls = [];

/** routes : [ [motif d'URL, handler(url, init, appelN)] ] */
function mockFetch(routes) {
  calls = [];
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    for (const [pattern, handler] of routes) {
      if (String(url).includes(pattern)) {
        const n = calls.filter(c => c.url.includes(pattern)).length;
        const r = await handler(String(url), init, n);
        return {
          ok: r.status ? r.status < 400 : true,
          status: r.status ?? 200,
          headers: new Map(Object.entries(r.headers ?? {})),
          json: async () => r.body,
          text: async () => JSON.stringify(r.body ?? '')
        };
      }
    }
    throw new Error('route non simulée : ' + url);
  };
}
const restore = () => { globalThis.fetch = realFetch; };

const env = (k, v) => { if (v === null) delete process.env[k]; else process.env[k] = v; };

/* ─── Reddit ─────────────────────────────────────────────── */

mockFetch([['reddit.com/search.json', (url, init, n) => ({
  headers: {},
  body: n === 1
    ? { data: { after: 't3_page2', children: [
        { data: { title: 'Conseil municipal Blain', url: 'https://ouest-france.fr/a',
                  permalink: '/r/nantes/comments/a', created_utc: 1789000000,
                  author: 'local44', selftext: 'texte', score: 12 } },
        { data: { title: 'Lien interne', url: '/r/nantes/comments/b',
                  permalink: '/r/nantes/comments/b', created_utc: 1788999000,
                  author: 'x', selftext: '', score: 3 } }
      ] } }
    : { data: { after: null, children: [
        { data: { title: 'Vieux post', url: 'https://ex.com/vieux',
                  permalink: '/r/nantes/comments/c', created_utc: 1500000000,
                  author: 'y', selftext: '', score: 1 } }
      ] } }
})]]);

let r = await search('reddit', { query: 'Blain', limit: 10 });
ok('reddit : pagination suivie (2 appels)', calls.length === 2);
ok('reddit : 3 items récupérés', r.length === 3);
ok('reddit : URL externe conservée', r[0].url === 'https://ouest-france.fr/a');
ok('reddit : permalink reconstruit en absolu',
   r[1].url === 'https://www.reddit.com/r/nantes/comments/b');
ok('reddit : auteur préfixé u/', r[0].author === 'u/local44');
ok('reddit : raw_json demandé', calls[0].url.includes('raw_json=1'));

r = await search('reddit', { query: 'Blain', since: '2026-01-01', limit: 10 });
ok('reddit : coupure sur since', r.every(i => i.created_utc >= 1767225600));

/* ─── YouTube ────────────────────────────────────────────── */

env('YOUTUBE_API_KEY', null);
let threw = null;
try { await search('youtube', { query: 'x' }); } catch (e) { threw = e.message; }
ok('youtube : clé absente signalée', /YOUTUBE_API_KEY/.test(threw ?? ''));

env('YOUTUBE_API_KEY', 'clef-test');
mockFetch([['googleapis.com/youtube', (url, init, n) => ({
  body: n === 1
    ? { nextPageToken: 'PAGE2', items: [{ id: { videoId: 'abc123' }, snippet: {
        title: 'Reportage Châteaubriant', publishedAt: '2026-09-10T12:00:00Z',
        channelTitle: 'TéléNantes', description: 'desc' } }] }
    : { items: [{ id: { videoId: 'def456' }, snippet: {
        title: 'Suite', publishedAt: '2026-09-09T12:00:00Z',
        channelTitle: 'TéléNantes', description: '' } }] }
})]]);

r = await search('youtube', { query: 'Châteaubriant', since: '2026-09-01', limit: 2 });
ok('youtube : URL de vidéo construite', r[0].url === 'https://www.youtube.com/watch?v=abc123');
ok('youtube : publishedAfter transmis', calls[0].url.includes('publishedAfter='));
ok('youtube : clé dans la requête', calls[0].url.includes('key=clef-test'));
ok('youtube : limite respectée', r.length === 2);

/* ─── Exa ────────────────────────────────────────────────── */

env('EXA_API_KEY', 'exa-test');
mockFetch([['api.exa.ai/search', () => ({ body: { results: [
  { title: 'Médiathèque inaugurée', url: 'https://actu.fr/x',
    publishedDate: '2026-09-11T08:00:00Z', author: 'actu.fr',
    text: 'contenu', highlights: ['phrase'], score: 0.81 }
] } })]]);

r = await search('exa', { query: 'La Meilleraye', since: '2026-09-01', limit: 5 });
const exaBody = JSON.parse(calls[0].init.body);
ok('exa : méthode POST', calls[0].init.method === 'POST');
ok('exa : clé en en-tête x-api-key', calls[0].init.headers['x-api-key'] === 'exa-test');
ok('exa : startPublishedDate transmis', !!exaBody.startPublishedDate);
ok('exa : score conservé', r[0].score === 0.81);

/* ─── Twitter ────────────────────────────────────────────── */

env('TWITTER_BEARER_TOKEN', 'bearer-test');
mockFetch([['api.twitter.com', (url, init, n) => ({
  body: n === 1
    ? { data: [{ id: '111', author_id: 'u1', text: 'Budget voirie voté',
                 created_at: '2026-09-12T09:00:00Z',
                 public_metrics: { like_count: 8, retweet_count: 2 } }],
        includes: { users: [{ id: 'u1', username: 'ouestfrance44' }] },
        meta: { next_token: 'NEXT' } }
    : { data: [], meta: {} }
})]]);

r = await search('twitter', { query: 'Châteaubriant', limit: 10 });
ok('twitter : bearer en en-tête',
   calls[0].init.headers.authorization === 'Bearer bearer-test');
ok('twitter : username résolu depuis includes', r[0].username === 'ouestfrance44');
ok('twitter : URL construite', r[0].url === 'https://x.com/ouestfrance44/status/111');
ok('twitter : retweets exclus de la requête', calls[0].url.includes('-is%3Aretweet'));

/* ─── Transport ──────────────────────────────────────────── */

mockFetch([['api.exa.ai', (url, init, n) => n === 1
  ? { status: 429, headers: { 'retry-after': '0' }, body: {} }
  : { body: { results: [] } }]]);
r = await search('exa', { query: 'x' });
ok('429 : rejoué après Retry-After', calls.length === 2 && Array.isArray(r));

mockFetch([['api.exa.ai', () => ({ status: 500, body: { message: 'boom' } })]]);
threw = null;
try { await search('exa', { query: 'x' }); } catch (e) { threw = e.message; }
ok('500 : reprises épuisées puis erreur', calls.length === 3 && /HTTP 500/.test(threw ?? ''));

mockFetch([['api.exa.ai', () => ({ status: 401, body: { message: 'clé invalide' } })]]);
threw = null;
try { await search('exa', { query: 'x' }); } catch (e) { threw = e.message; }
ok('401 : pas de reprise inutile', calls.length === 1 && /HTTP 401/.test(threw ?? ''));

/* ─── Façade ─────────────────────────────────────────────── */

threw = null;
try { await search('mastodon', {}); } catch (e) { threw = e.message; }
ok('plateforme inconnue rejetée', /inconnue/.test(threw ?? ''));

restore();

/* ─── Reddit : OAuth applicatif et diagnostic 403 ─────────────── */
mockFetch([['reddit.com/search.json', () => ({ status: 403, body: 'blocked' })]]);
try { await search('reddit', { query: 'x', limit: 5 }); ok('reddit 403 anonyme : erreur attendue', false); }
catch (e) { ok('reddit 403 anonyme : message actionnable', /REDDIT_CLIENT_ID/.test(e.message)); }

process.env.REDDIT_CLIENT_ID = 'cid'; process.env.REDDIT_CLIENT_SECRET = 'sec';
mockFetch([
  ['/api/v1/access_token', (u, init) => ({ body: {
    access_token: init.headers.authorization === 'Basic ' + Buffer.from('cid:sec').toString('base64') ? 'TOK' : null,
    expires_in: 3600 } })],
  ['oauth.reddit.com/search', (u, init) => ({ body: { data: { after: null, children: init.headers.authorization === 'Bearer TOK'
    ? [{ data: { title: 'OAuth ok', permalink: '/r/nantes/comments/z', created_utc: 1e9, author: 'a', score: 1 } }] : [] } } })]
]);
r = await search('reddit', { query: 'Blain', limit: 5 });
ok('reddit OAuth : jeton Basic puis Bearer', r.length === 1 && r[0].title === 'OAuth ok');
r = await search('reddit', { query: 'Blain', limit: 5 });
ok('reddit OAuth : jeton mis en cache', calls.filter(c => c.url.includes('access_token')).length === 1);
delete process.env.REDDIT_CLIENT_ID; delete process.env.REDDIT_CLIENT_SECRET;

ok('missingKeys : reddit sans clé requise', missingKeys('reddit', {}).length === 0);
ok('missingKeys : exa signale sa clé', missingKeys('exa', {})[0] === 'EXA_API_KEY');
ok('missingKeys : twitter satisfait', missingKeys('twitter', { TWITTER_BEARER_TOKEN: 't' }).length === 0);
globalThis.fetch = realFetch;

/* ─── Google News RSS ─────────────────────────────────────────── */
const RSS = `<?xml version="1.0"?><rss><channel><title>x</title>
<item><title>Nozay : la gare rouvre &amp; le bus suit - Ouest-France</title>
<link>https://news.google.com/rss/articles/abc?oc=5</link><pubDate>Thu, 24 Sep 2026 08:00:00 GMT</pubDate>
<description><![CDATA[<a href="x">Nozay : la gare rouvre</a>&nbsp;<font>Ouest-France</font>]]></description>
<source url="https://www.ouest-france.fr">Ouest-France</source></item>
<item><title>Titre &#233;l&#xE9;ment</title><link>https://ex.com/2</link><pubDate>n'importe quoi</pubDate></item>
</channel></rss>`;
const parsed = parseRSS(RSS);
ok('rss : 2 items', parsed.length === 2);
ok('rss : suffixe « - Source » retiré, entités décodées', parsed[0].title === 'Nozay : la gare rouvre & le bus suit');
ok('rss : source extraite', parsed[0].source === 'Ouest-France');
ok('rss : description CDATA nettoyée du HTML', !/[<>]/.test(parsed[0].description));
ok('rss : entités numériques', parsed[1].title === 'Titre élément');

mockFetch([['news.google.com/rss/search', (u, init) => ({ body: null, text: RSS, _u: u, _a: init.headers.accept })]]);
globalThis.fetch = (orig => async (u, i) => { const r = await orig(u, i); r.text = async () => RSS; return r; })(globalThis.fetch);
r = await search('gnews', { query: 'Nozay', since: '2026-09-01', limit: 10 });
ok('gnews : items récupérés sans clé', r.length === 2);
ok('gnews : paramètres FR + filtre after:', /hl=fr/.test(calls[0].url) && /after%3A2026-09-01/.test(calls[0].url));
globalThis.fetch = realFetch;
