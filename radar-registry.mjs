/**
 * radar-registry.mjs — noyau du registre de collecteurs (Radar de Niko / Journal 44)
 *
 * Transposition Node ESM du pattern de plugins d'ALEAPP.
 * Le noyau ne connaît aucune source. Il connaît un contrat :
 *
 *   defineCollector({
 *     id, name, source, version,
 *     requires?: [id],        // exécuté après ces collecteurs
 *     timeout?: ms,           // défaut 20000
 *     retries?: n,            // défaut 1
 *     collect(ctx) -> items[] // sync ou async
 *   })
 *
 * ctx = { query, since, results, log, signal }
 * item brut attendu : { title, url, publishedAt, author?, summary?, score?, raw? }
 *
 * Un collecteur ne produit JAMAIS de RSS. Il produit des items.
 * Le noyau normalise, déduplique, trie, puis rend (RSS / JSONL / digest).
 */

import { createHash } from 'node:crypto';

const DEFAULT_TIMEOUT = 20000;

/* ═══════════════════════════════════════════════════════════
   Registre
   ═══════════════════════════════════════════════════════════ */

const collectors = [];
const defineErrors = [];

export function defineCollector(spec) {
  if (!spec || !spec.id) { defineErrors.push('collecteur sans id'); return; }
  if (collectors.some(c => c.id === spec.id)) {
    defineErrors.push(`id dupliqué : ${spec.id}`); return;
  }
  collectors.push({ timeout: DEFAULT_TIMEOUT, retries: 1, requires: [], mode: 'collect', ...spec });
}

export function allCollectors() { return collectors.slice(); }

export function resetRegistry() { collectors.length = 0; defineErrors.length = 0; }

export function validate() {
  const errs = [...defineErrors];
  const ids = new Set(collectors.map(c => c.id));

  for (const c of collectors) {
    if (typeof c.collect !== 'function') errs.push(`${c.id} : collect() manquant`);
    if (!['collect', 'enrich'].includes(c.mode)) errs.push(`${c.id} : mode inconnu « ${c.mode} »`);
    if (c.mode === 'enrich' && !c.requires.length) errs.push(`${c.id} : un enrichisseur doit déclarer requires`);
    if (!c.source) errs.push(`${c.id} : source manquante`);
    if (!c.version) errs.push(`${c.id} : version manquante`);
    for (const dep of c.requires) {
      if (!ids.has(dep)) errs.push(`${c.id} : dépendance inconnue « ${dep} »`);
    }
  }
  errs.push(...findCycles());
  return errs;
}

function findCycles() {
  const byId = new Map(collectors.map(c => [c.id, c]));
  const state = new Map();
  const found = [];
  const walk = (id, path) => {
    if (state.get(id) === 2) return;
    if (state.get(id) === 1) { found.push(`cycle : ${[...path, id].join(' → ')}`); return; }
    state.set(id, 1);
    for (const d of byId.get(id)?.requires ?? []) if (byId.has(d)) walk(d, [...path, id]);
    state.set(id, 2);
  };
  for (const c of collectors) walk(c.id, []);
  return found;
}

/**
 * Niveaux d'exécution : tout ce qui est dans un même niveau part en parallèle.
 * Les collecteurs sont I/O-bound (API distantes) — les sérialiser serait absurde.
 */
export function levels(list = collectors) {
  const pool = new Map(list.map(c => [c.id, c]));
  const placed = new Set();
  const out = [];
  let guard = 0;

  while (placed.size < pool.size && guard++ < 100) {
    const level = [...pool.values()].filter(c =>
      !placed.has(c.id) && c.requires.every(d => !pool.has(d) || placed.has(d))
    );
    if (!level.length) break; // cycle : déjà signalé par validate()
    level.forEach(c => placed.add(c.id));
    out.push(level);
  }
  return out;
}

/* ═══════════════════════════════════════════════════════════
   Normalisation & déduplication
   ═══════════════════════════════════════════════════════════ */

export function stableId(url) {
  return createHash('sha1').update(String(url)).digest('hex').slice(0, 16);
}

function canonicalUrl(raw) {
  try {
    const u = new URL(raw);
    // Retire le bruit de tracking : deux collecteurs qui trouvent le même article
    // avec des UTM différents doivent produire le même id.
    for (const k of [...u.searchParams.keys()]) {
      if (/^(utm_[\w-]*|fbclid|gclid|mc_cid|mc_eid|ref|si)$/i.test(k)) u.searchParams.delete(k);
    }
    u.hash = '';
    if (u.pathname.length > 1 && u.pathname.endsWith('/')) u.pathname = u.pathname.slice(0, -1);
    return u.toString();
  } catch { return String(raw || '').trim(); }
}

function normalizeItem(item, collector) {
  if (!item) return null;
  const url = canonicalUrl(item.url ?? item.link);
  const title = String(item.title ?? '').trim();
  if (!url || !title) return null;            // item inexploitable : écarté, pas d'exception

  let published = item.publishedAt ?? item.date ?? item.created_at ?? null;
  const d = published ? new Date(published) : null;
  published = d && !isNaN(d) ? d.toISOString() : new Date().toISOString();

  return {
    id: stableId(url),
    title,
    url,
    publishedAt: published,
    source: collector.source,
    collector: collector.id,
    author: item.author ?? item.user ?? null,
    summary: typeof item.summary === 'string' ? item.summary.trim().slice(0, 800)
           : typeof item.text === 'string' ? item.text.trim().slice(0, 800) : null,
    score: Number.isFinite(item.score) ? item.score : null
  };
}

function dedupe(items) {
  const seen = new Map();
  const dupes = [];
  for (const it of items) {
    const prev = seen.get(it.id);
    if (!prev) { seen.set(it.id, it); continue; }
    dupes.push({ id: it.id, kept: prev.collector, dropped: it.collector });
    // On garde la version la plus ancienne (première publication) et on note la reprise.
    if (new Date(it.publishedAt) < new Date(prev.publishedAt)) seen.set(it.id, it);
  }
  return { items: [...seen.values()], dupes };
}

/* ═══════════════════════════════════════════════════════════
   Exécution
   ═══════════════════════════════════════════════════════════ */

function withTimeout(promise, ms, label) {
  let t;
  return Promise.race([
    promise,
    new Promise((_, rej) => { t = setTimeout(() => rej(new Error(`${label} : délai dépassé (${ms} ms)`)), ms); })
  ]).finally(() => clearTimeout(t));
}

async function runOne(c, ctx) {
  const started = Date.now();
  let lastErr = null;

  for (let attempt = 0; attempt <= c.retries; attempt++) {
    const ac = new AbortController();
    try {
      const raw = await withTimeout(
        Promise.resolve(c.collect({ ...ctx, signal: ac.signal })),
        c.timeout, c.id
      );
      const list = Array.isArray(raw) ? raw : (raw?.items ?? []);

      if (c.mode === 'enrich') {
        const patches = list.filter(p => p && p.id && p.patch);
        return {
          collector: c, status: patches.length ? 'ok' : 'empty',
          items: [], patches, dropped: list.length - patches.length,
          attempts: attempt + 1, ms: Date.now() - started
        };
      }

      const items = list.map(i => normalizeItem(i, c)).filter(Boolean);
      return {
        collector: c, status: items.length ? 'ok' : 'empty',
        items, patches: [], dropped: list.length - items.length,
        attempts: attempt + 1, ms: Date.now() - started
      };
    } catch (e) {
      lastErr = e;
      ac.abort();
      if (attempt < c.retries) await new Promise(r => setTimeout(r, 400 * (attempt + 1)));
    }
  }
  return {
    collector: c, status: 'error', error: String(lastErr?.message ?? lastErr),
    items: [], patches: [], dropped: 0, attempts: c.retries + 1, ms: Date.now() - started
  };
}

export async function runRegistry({ query = '', since = null, filter = null, log = () => {} } = {}) {
  const errs = validate();
  if (errs.length) {
    const e = new Error('Registre invalide :\n- ' + errs.join('\n- '));
    e.validation = errs;
    throw e;
  }

  const selected = filter ? collectors.filter(filter) : collectors;
  const plan = levels(selected);
  const byId = new Map();
  const reports = [];
  const ctx = { query, since, results: byId, log };

  for (const level of plan) {
    const runnable = [];
    for (const c of level) {
      // Dépendances hors sélection (--only) : ignorées, elles ne tourneront pas.
      const deps = c.requires.filter(d => selected.some(x => x.id === d));
      const missing = deps.filter(d => byId.get(d)?.status !== 'ok');
      // Un enrichisseur tourne dès qu'au moins une de ses sources a produit :
      // une source morte ne doit pas priver les autres de l'enrichissement.
      const blocked = c.mode === 'enrich'
        ? deps.length === 0 || missing.length === deps.length
        : missing.length > 0;
      if (blocked) {
        const r = { collector: c, status: 'skipped',
                    reason: deps.length ? `dépend de ${missing.join(', ')}` : 'aucune source sélectionnée', items: [], patches: [], ms: 0 };
        reports.push(r); byId.set(c.id, r);
      } else {
        runnable.push(c);
      }
    }
    // allSettled : une source morte n'emporte jamais le reste de la veille.
    const settled = await Promise.allSettled(runnable.map(c => runOne(c, ctx)));
    settled.forEach((s, i) => {
      const r = s.status === 'fulfilled'
        ? s.value
        : { collector: runnable[i], status: 'error',
            error: String(s.reason?.message ?? s.reason), items: [], patches: [], ms: 0 };
      reports.push(r); byId.set(r.collector.id, r);
    });
  }

  reports.sort((a, b) =>
    collectors.indexOf(a.collector) - collectors.indexOf(b.collector));

  let items = reports.flatMap(r => r.items);
  if (since) {
    const cut = new Date(since);
    items = items.filter(i => new Date(i.publishedAt) >= cut);
  }
  const { items: unique, dupes } = dedupe(items);

  // Les enrichisseurs patchent les items retenus, ils n'en créent pas de nouveaux.
  const index = new Map(unique.map(i => [i.id, i]));
  let applied = 0, orphan = 0;
  for (const r of reports) {
    for (const p of r.patches ?? []) {
      const target = index.get(p.id);
      if (!target) { orphan++; continue; }
      const tags = new Set([...(target.tags ?? []), ...(p.patch.tags ?? [])]);
      Object.assign(target, p.patch, { tags: [...tags] });
      applied++;
    }
    if (r.collector.mode === 'enrich') { r.applied = applied; r.orphan = orphan; }
  }

  unique.sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));

  return { items: unique, reports, dupes, plan: plan.map(l => l.map(c => c.id)) };
}

/* ═══════════════════════════════════════════════════════════
   Sorties — découplées des collecteurs
   ═══════════════════════════════════════════════════════════ */

const xml = s => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&apos;');

export function toRSS(items, {
  title = 'Radar de Niko — Journal 44',
  link = 'https://radar-de-niko.vercel.app/',
  description = 'Veille locale Loire-Atlantique'
} = {}) {
  const now = new Date().toUTCString();
  const entries = items.map(i => `    <item>
      <title>${xml(i.title)}</title>
      <link>${xml(i.url)}</link>
      <guid isPermaLink="false">${xml(i.id)}</guid>
      <pubDate>${new Date(i.publishedAt).toUTCString()}</pubDate>
      <category>${xml(i.source)}</category>${i.author ? `
      <dc:creator>${xml(i.author)}</dc:creator>` : ''}${i.summary ? `
      <description>${xml(i.summary)}</description>` : ''}
    </item>`).join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/">
  <channel>
    <title>${xml(title)}</title>
    <link>${xml(link)}</link>
    <description>${xml(description)}</description>
    <language>fr-FR</language>
    <lastBuildDate>${now}</lastBuildDate>
${entries}
  </channel>
</rss>
`;
}

export const toJSONL = items => items.map(i => JSON.stringify(i)).join('\n') + '\n';

export function toDigest({ items, reports, dupes }) {
  const bySource = new Map();
  for (const i of items) bySource.set(i.source, (bySource.get(i.source) ?? 0) + 1);

  const lines = [
    `# Radar — ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`,
    '',
    `${items.length} items retenus · ${dupes.length} doublons fusionnés`,
    '',
    '## Collecte',
    ...reports.map(r => {
      const head = `- ${r.collector.id} v${r.collector.version} · ${r.status}`;
      if (r.status === 'error') return `${head} — ${r.error} (${r.attempts} tentative(s))`;
      if (r.status === 'skipped') return `${head} — ${r.reason}`;
      if (r.collector.mode === 'enrich')
        return `${head} · ${r.applied ?? 0} item(s) enrichi(s)${r.orphan ? `, ${r.orphan} sans cible` : ''} · ${r.ms} ms`;
      return `${head} · ${r.items.length} item(s)${r.dropped ? `, ${r.dropped} écarté(s)` : ''} · ${r.ms} ms`;
    }),
    '',
    '## Par source',
    ...[...bySource.entries()].map(([s, n]) => `- ${s} : ${n}`),
    '',
    '## Items',
    ...items.slice(0, 40).map(i =>
      `- [${i.source}]${i.tags?.length ? ' ' + i.tags.map(t => `#${t}`).join(' ') : ''} ${i.title}\n  ${i.url}\n  ${i.publishedAt}`)
  ];
  return lines.join('\n') + '\n';
}
