#!/usr/bin/env node
/**
 * radar-run.mjs — point d'entrée.
 *
 *   node radar-run.mjs --query "Châteaubriant" --since 2026-09-01 --out ./dist
 *   node radar-run.mjs --stub            # jeu de données fictif, aucun réseau
 *   node radar-run.mjs --only reddit,exa # filtre de collecteurs
 */

import { writeFile, mkdir, readFile } from 'node:fs/promises';

/* ─── .env local (optionnel) — les variables déjà définies priment ─ */
try {
  for (const line of (await readFile(new URL('./.env', import.meta.url), 'utf8')).split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/i);
    if (m && !line.trim().startsWith('#') && m[2] && process.env[m[1]] === undefined) {
      process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
    }
  }
} catch { /* pas de .env : normal en CI */ }
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

const unavailable = new Set();

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
    gnews: [
      { title: 'Derval : la foire d\'automne attire 3 000 visiteurs', url: 'https://www.ouest-france.fr/derval-foire?utm_medium=rss',
        pubDate: new Date(now - 54e5).toUTCString(), source: 'Ouest-France', description: 'Record battu cette année.' }
    ],
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
  const mod = await import('./radar-agent-reach.mjs').catch(() => null);
  if (!mod?.search) {
    console.error('radar-agent-reach.mjs introuvable ou sans export search(). Utilise --stub pour tester.');
    process.exit(1);
  }
  setReach((platform, opts) => mod.search(platform, opts));
  // Sources sans clé : écartées proprement au lieu d'échouer en boucle.
  for (const p of mod.platforms()) {
    const miss = mod.missingKeys(p);
    if (miss.length) { unavailable.add(p); console.log(`⏭ ${p} ignoré — ${miss.join(', ')} absente(s)`); }
  }
}

/* ─── Exécution ──────────────────────────────────────────────── */

const wanted = only ? only.split(',').map(k => k.trim()).filter(Boolean) : null;
// Les enrichisseurs suivent toujours : --only ne restreint que les sources.
const filter = c => c.mode === 'enrich' || (
  !unavailable.has(c.source) &&
  (!wanted || wanted.some(k => c.id.includes(k) || c.source === k))
);

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

// Annotations GitHub Actions : chaque panne visible dans l'interface du run.
if (process.env.GITHUB_ACTIONS === 'true' && !flag('stub')) {
  const esc = t => String(t).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
  for (const p of unavailable) console.log(`::notice title=${p} ignoré::clé absente des secrets du dépôt`);
  for (const r of failed) console.log(`::error title=${r.collector.id}::${esc(r.error)}`);
}

// Code de sortie : 3 si aucune source n'a pu tourner avec succès (veille vide par panne).
const sources = run.reports.filter(r => r.collector.mode !== 'enrich');
if (!flag('stub') && sources.length && !sources.some(r => r.status === 'ok' || r.status === 'empty')) {
  console.error('✗ aucune source opérationnelle');
  process.exitCode = 3;
}
