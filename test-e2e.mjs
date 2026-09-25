/**
 * test-e2e.mjs — chaîne complète : adaptateur réel → collecteurs → noyau → sorties.
 *
 * C'est le test qui ferme le trou signalé au départ : les mappings de
 * radar-collectors.mjs sont confrontés aux formes réellement produites par
 * radar-agent-reach.mjs. Le réseau est simulé, les APIs elles-mêmes ne le sont pas.
 */

import { search } from './radar-agent-reach.mjs';
import { setReach } from './radar-collectors.mjs';
import { runRegistry, toRSS } from './radar-registry.mjs';
import { toHTML } from './radar-page.mjs';

let failed = 0;
const ok = (n, c) => { if (!c) failed++; console.log((c ? '✓' : '✗ ÉCHEC') + ' ' + n); };
process.on('exit', code => {
  if (code && !failed) failed = 1;  // un crash n'est jamais « tout vert »
  if (failed) { console.error(`\n${failed} test(s) en échec`); process.exitCode = 1; }
  else console.log('\nchaîne complète : tout vert');
});

process.env.EXA_API_KEY = 'k';
process.env.YOUTUBE_API_KEY = 'k';
process.env.TWITTER_BEARER_TOKEN = 'k';

const iso = h => new Date(Date.now() - h * 36e5).toISOString();

const RSS = (items) => `<?xml version="1.0"?><rss><channel>${items.map(i =>
  `<item><title>${i.t}</title><link>${i.u}</link><pubDate>${new Date(Date.now() - i.h * 36e5).toUTCString()}</pubDate>${i.s ? `<source url="x">${i.s}</source>` : ''}<description>${i.d ?? ''}</description></item>`).join('')}</channel></rss>`;
const ATOM = (items) => `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom">${items.map(i =>
  `<entry><title>${i.t}</title><link href="${i.u}"/><updated>${iso(i.h)}</updated><author><name>/u/${i.a}</name></author><content type="html">${i.d ?? ''}</content></entry>`).join('')}</feed>`;

globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  const reply = body => ({
    ok: true, status: 200, headers: new Map(),
    json: async () => body, text: async () => typeof body === 'string' ? body : JSON.stringify(body)
  });

  if (u.includes('news.google.com')) return reply(RSS([
    { t: 'Châteaubriant : le marché du mercredi déplacé - Ouest-France', u: 'https://www.ouest-france.fr/marche', h: 1, s: 'Ouest-France' }]));
  if (u.includes('bing.com/news')) return reply(RSS([
    { t: 'Blain : le château rouvre', u: 'http://www.bing.com/news/apiclick.aspx?url=https%3a%2f%2factu.fr%2fblain-chateau&c=1', h: 2 }]));
  if (u.includes('actu.fr/l-eclaireur')) return reply(RSS([
    { t: 'Derval : nouvelle boulangerie', u: 'https://actu.fr/derval-boulangerie', h: 3 }]));
  if (u.includes('france3-regions')) return reply(RSS([
    { t: 'Marché de Châteaubriant déplacé', u: 'https://www.ouest-france.fr/marche?utm_source=f3', h: 1 }]));
  if (u.includes('francebleu') || u.includes('ouest-france.fr/rss') || u.includes('franceinfo.fr')) return reply(RSS([]));
  if (u.includes('reddit.com/r/nantes')) return reply(ATOM([]));
  if (u.includes('reddit.com/search.rss')) return reply(ATOM([
    { t: 'Travaux RN171 à Nozay', u: 'https://www.reddit.com/r/nantes/comments/rn171/', h: 4, a: 'local44', d: '&lt;p&gt;Déviation&lt;/p&gt;' }]));
  if (u.includes('api.bsky.app')) return reply({ posts: [
    { uri: 'at://did:plc:x/app.bsky.feed.post/3kabc', author: { handle: 'nantes.bsky.social' },
      record: { text: 'Grève TAN demain à Nantes\nTrams perturbés', createdAt: iso(1.5) }, likeCount: 4, repostCount: 1 }] });
  if (u.includes('/api/v1/timelines/tag/')) return reply(u.includes('mastodon.social/api/v1/timelines/tag/nantes') ? [
    { url: 'https://mastodon.social/@a/1', created_at: iso(2.5), visibility: 'public', reblog: null,
      content: '<p>Concert gratuit ce soir à <a href="x">#Nantes</a></p>', account: { acct: 'a' }, favourites_count: 2, reblogs_count: 0 }] : []);
  if (u.includes('googleapis.com')) return reply({ items: [
    { id: { videoId: 'v1' }, snippet: { title: 'Reportage Ancenis', publishedAt: iso(5), channelTitle: 'TV44', description: 'Ancenis' } }] });
  if (u.includes('api.exa.ai')) return reply({ results: [
    { title: 'La Meilleraye-de-Bretagne inaugure sa médiathèque', url: 'https://actu.fr/meilleraye?fbclid=zz', publishedDate: iso(6), score: 0.8 }] });
  if (u.includes('api.twitter.com')) return reply({
    data: [{ id: '1', text: 'Conseil municipal de Châteaubriant ce soir', created_at: iso(0.5), author_id: 'u1',
             public_metrics: { like_count: 3, retweet_count: 1 } }],
    includes: { users: [{ id: 'u1', username: 'ouestfrance44' }] }, meta: {} });

  throw new Error('route non simulée : ' + u);
};

setReach((platform, opts) => search(platform, opts));

const run = await runRegistry({ query: 'Loire-Atlantique', since: null });
const byId = Object.fromEntries(run.reports.map(r => [r.collector.id, r]));

const SRC = ['reach_gnews', 'reach_bing', 'reach_feeds', 'reach_bluesky', 'reach_mastodon',
             'reach_twitter', 'reach_reddit', 'reach_youtube', 'reach_exa'];
for (const id of SRC) ok(`${id} répond`, byId[id]?.status === 'ok');

ok('aucun item écarté à la normalisation',
   run.reports.every(r => !r.dropped));

ok('titres non vides après mapping',
   run.items.every(i => typeof i.title === 'string' && i.title.length > 3));

ok('dates valides après mapping',
   run.items.every(i => !isNaN(new Date(i.publishedAt))));

ok('URLs absolues après mapping',
   run.items.every(i => /^https?:\/\//.test(i.url)));

ok('doublon inter-sources fusionné (Google News vs flux France 3 avec utm)',
   run.dupes.length === 1 && run.items.filter(i => i.url.includes('ouest-france.fr/marche')).length === 1);

ok('Bing : lien réel extrait de la redirection', run.items.some(i => i.url === 'https://actu.fr/blain-chateau'));
ok('Mastodon : HTML retiré du texte', run.items.some(i => i.source === 'mastodon' && !/[<>]/.test(i.title)));
ok('Bluesky : URL de post reconstruite', run.items.some(i => i.url === 'https://bsky.app/profile/nantes.bsky.social/post/3kabc'));
ok('Reddit sans clé : lu via Atom', run.items.some(i => i.source === 'reddit' && i.title.includes('RN171')));
ok('flux presse : nom du journal conservé', run.items.some(i => i.source === 'presse' && i.author === "L'Éclaireur de Châteaubriant"));

ok('enrichissement 44 appliqué',
   run.items.some(i => i.tags?.includes('44')));

ok('sources correctement étiquetées',
   new Set(run.items.map(i => i.source)).size >= 3);

ok('tri antichronologique',
   run.items.every((i, n) => n === 0 ||
     new Date(run.items[n - 1].publishedAt) >= new Date(i.publishedAt)));

const xml = toRSS(run.items);
ok('flux RSS contient tous les items',
   (xml.match(/<item>/g) ?? []).length === run.items.length);

run.items[0].title = '<script>alert(1)</script> & co';
const html = toHTML(run);
ok('page : un <li> par item', (html.match(/<li id=/g) ?? []).length === run.items.length);
ok('page : titres échappés (pas d\'injection)', !html.includes('<script>alert(1)') && html.includes('&lt;script&gt;'));
const browserFetches = html.match(/\\bfetch\\(/g) ?? [];
ok('page : seul le déclenchement manuel utilise fetch côté navigateur',
   browserFetches.length === 1 &&
   html.includes("fetch('https://radar-de-niko-backend-nikoju1977s-projects.vercel.app/api/refresh'") &&
   !/XMLHttpRequest/.test(html));
ok('page : un seul identifiant par item', new Set(html.match(/<li id="[^"]+"/g)).size === run.items.length);

ok('pwa : manifeste, service worker et icône iOS référencés',
   html.includes('rel="manifest"') && html.includes("register('sw.js')") && html.includes('apple-touch-icon'));
ok('pwa iOS : mode plein écran et écrans de démarrage', html.includes('apple-mobile-web-app-capable') && (html.match(/apple-touch-startup-image/g) ?? []).length >= 10);
{
  const { readFileSync, existsSync } = await import('node:fs');
  const man = JSON.parse(readFileSync(new URL('./public/manifest.webmanifest', import.meta.url), 'utf8'));
  ok('pwa : icônes du manifeste présentes (dont maskable)',
     man.icons.every(i => existsSync(new URL('./public/' + i.src, import.meta.url))) && man.icons.some(i => i.purpose === 'maskable'));
  ok('pwa : écrans de démarrage iOS présents', [...html.matchAll(/apple-touch-startup-image[^>]*href="([^"]+)"/g)]
     .every(([, f]) => existsSync(new URL('./public/' + f, import.meta.url))));
}

console.log(`\n${run.items.length} items, ${run.dupes.length} doublon(s) fusionné(s)`);
