#!/usr/bin/env node
/**
 * radar-run.mjs — point d'entrée.
 *
 *   node radar-run.mjs --query "Châteaubriant" --since 2026-09-01 --out ./dist
 *   node radar-run.mjs --stub            # jeu de données fictif, aucun réseau
 *   node radar-run.mjs --only reddit,exa # filtre de collecteurs
 */

import { writeFile, mkdir } from 'node:fs/promises';
import { runRegistry, toRSS, toJSONL, toDigest, allCollectors } from './radar-registry.mjs';
import { setReach } from './radar-collectors.mjs';

const argv = process.argv.slice(2);
const arg = (name, fallback = null) => {
  const i = argv.indexOf(`--${name}`);
  return i !== -1 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : fallback;
};
const flag = name => argv.includes(`--${name}`);

const query = arg('query', 'Châteaubriant Loire-Atlantique');
const since = arg('since');
const outDir = arg('out', './dist');
const only = arg('only');

/* ─── Branchement d'Agent Reach ──────────────────────────────── */

if (flag('stub')) {
  const now = Date.now();
  const FIXTURES = {
    twitter: [
      { id: '1', username: 'ouestfrance44', text: 'Conseil municipal de Châteaubriant : le budget voirie voté',
        url: 'https://x.com/ouestfrance44/status/1?utm_source=tw', created_at: new Date(now - 36e5).toISOString(),
        like_count: 12, retweet_count: 3 }
    ],
    reddit: [
      { title: 'Travaux RN171 entre Nozay et Blain', url: 'https://reddit.com/r/nantes/comments/x1',
        created_utc: (now - 72e5) / 1000, author: 'u/local44', selftext: 'Déviation en place jusqu\'en octobre.', score: 41 },
      { title: 'Sans titre exploitable', url: '', created_utc: now / 1000, author: 'u/bot', score: 0 }
    ],
    youtube: [],
    exa: [
      { title: 'La Meilleraye-de-Bretagne inaugure sa médiathèque',
        url: 'https://actu.fr/pays-de-la-loire/article?fbclid=abc', publishedDate: new Date(now - 108e5).toISOString(),
        author: 'actu.fr', text: 'Le bâtiment ouvre ses portes samedi.', score: 0.82 },
      { title: 'Conseil municipal de Châteaubriant : le budget voirie voté',
        url: 'https://x.com/ouestfrance44/status/1', publishedDate: new Date(now - 30e5).toISOString(),
        author: 'x.com', score: 0.4 }
    ]
  };
  setReach(async (platform) => {
    if (platform === 'youtube') throw new Error('quota API atteint');   // panne simulée
    await new Promise(r => setTimeout(r, 60));
    return FIXTURES[platform] ?? [];
  });
} else {
  // ⚠️ Remplacer par ton adaptateur réel.
  const mod = await import('./radar-agent-reach.mjs').catch(() => null);
  if (!mod?.search) {
    console.error('radar-agent-reach.mjs introuvable ou sans export search(). Utilise --stub pour tester.');
    process.exit(1);
  }
  setReach((platform, opts) => mod.search(platform, opts));
}

/* ─── Exécution ──────────────────────────────────────────────── */

const filter = only
  ? c => only.split(',').some(k => c.id.includes(k.trim()) || c.source === k.trim())
  : null;

console.log(`${allCollectors().length} collecteurs déclarés · requête « ${query} »`);

let run;
try {
  run = await runRegistry({ query, since, filter, log: console.error });
} catch (e) {
  console.error(e.message);
  process.exit(2);
}

await mkdir(outDir, { recursive: true });
await writeFile(`${outDir}/radar.xml`, toRSS(run.items));
await writeFile(`${outDir}/radar.jsonl`, toJSONL(run.items));
await writeFile(`${outDir}/radar.md`, toDigest(run));

console.log(toDigest(run));

const failed = run.reports.filter(r => r.status === 'error');
console.log(`→ ${outDir}/radar.xml · radar.jsonl · radar.md`);
if (failed.length) console.log(`⚠ ${failed.length} source(s) en échec — la veille reste exploitable.`);
