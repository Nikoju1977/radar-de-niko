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

let failed = 0;
const ok = (n, c) => { if (!c) failed++; console.log((c ? '✓' : '✗ ÉCHEC') + ' ' + n); };
process.on('exit', () => {
  if (failed) { console.error(`\n${failed} test(s) en échec`); process.exitCode = 1; }
  else console.log('\nchaîne complète : tout vert');
});

process.env.EXA_API_KEY = 'k';
process.env.YOUTUBE_API_KEY = 'k';
process.env.TWITTER_BEARER_TOKEN = 'k';

const iso = h => new Date(Date.now() - h * 36e5).toISOString();

globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  const reply = body => ({
    ok: true, status: 200, headers: new Map(),
    json: async () => body, text: async () => ''
  });

  if (u.includes('reddit.com')) return reply({ data: { after: null, children: [
    { data: { title: 'Travaux RN171 à Nozay', url: 'https://ouest-france.fr/rn171?utm_source=reddit',
              permalink: '/r/nantes/comments/a', created_utc: Date.now() / 1000 - 7200,
              author: 'local44', selftext: 'Déviation jusqu\'en octobre.', score: 41 } }
  ] } });

  if (u.includes('googleapis.com')) return reply({ items: [
    { id: { videoId: 'vid1' }, snippet: { title: 'Reportage Châteaubriant',
      publishedAt: iso(5), channelTitle: 'TéléNantes', description: 'sujet local' } }
  ] });

  if (u.includes('api.exa.ai')) return reply({ results: [
    { title: 'Médiathèque de La Meilleraye-de-Bretagne',
      url: 'https://actu.fr/mediatheque', publishedDate: iso(3),
      author: 'actu.fr', text: 'Ouverture samedi.', score: 0.8 },
    // même article que Reddit, URL polluée différemment : doit fusionner
    { title: 'Travaux RN171 à Nozay', url: 'https://ouest-france.fr/rn171?fbclid=zz',
      publishedDate: iso(1), author: 'ouest-france.fr', text: '', score: 0.4 }
  ] });

  if (u.includes('api.twitter.com')) return reply({
    data: [{ id: '111', author_id: 'u1', text: 'Budget voirie voté à Châteaubriant',
             created_at: iso(4), public_metrics: { like_count: 8, retweet_count: 2 } }],
    includes: { users: [{ id: 'u1', username: 'ouestfrance44' }] }, meta: {} });

  throw new Error('route non simulée : ' + u);
};

setReach((platform, opts) => search(platform, opts));

const run = await runRegistry({ query: 'Loire-Atlantique', since: null });
const byId = Object.fromEntries(run.reports.map(r => [r.collector.id, r]));

ok('les 4 sources répondent',
   ['reach_twitter', 'reach_reddit', 'reach_youtube', 'reach_exa']
     .every(id => byId[id].status === 'ok'));

ok('aucun item écarté à la normalisation',
   run.reports.every(r => !r.dropped));

ok('titres non vides après mapping',
   run.items.every(i => typeof i.title === 'string' && i.title.length > 3));

ok('dates valides après mapping',
   run.items.every(i => !isNaN(new Date(i.publishedAt))));

ok('URLs absolues après mapping',
   run.items.every(i => /^https?:\/\//.test(i.url)));

ok('doublon inter-sources fusionné (utm vs fbclid)',
   run.dupes.length === 1 && run.items.filter(i => i.url.includes('rn171')).length === 1);

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

console.log(`\n${run.items.length} items, ${run.dupes.length} doublon(s) fusionné(s)`);
