/**
 * test-pwa.mjs — vérifie la PWA publiée dans de vrais moteurs de navigateur.
 *
 *   node radar-run.mjs --stub --out ./dist && node test-pwa.mjs ./dist
 *
 * Profils : Chrome desktop (Chromium), Safari iPhone (WebKit), Chrome iPhone (WebKit + UA CriOS).
 * Moteur absent de la machine → profil signalé « non testé », jamais compté vert.
 * Captures dans ./pwa-shots/.
 */

import http from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { chromium, webkit, devices } from 'playwright';

const ROOT = process.argv[2] ?? './dist';
const STRICT = process.env.PWA_STRICT === '1';     // CI : un moteur manquant = échec
let failed = 0, untested = 0;
const GHA = process.env.GITHUB_ACTIONS === 'true';
const ok = (n, c) => { if (!c) { failed++; if (GHA) console.log(`::error title=PWA::${n}`); } console.log((c ? '✓' : '✗ ÉCHEC') + ' ' + n); };
const skip = n => { untested++; if (GHA) console.log(`::warning title=PWA non testé::${n}`); console.log('○ non testé : ' + n); };

/* ─── Serveur statique (types MIME corrects, comme GitHub Pages) ─── */
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.webmanifest': 'application/manifest+json',
  '.png': 'image/png', '.xml': 'application/rss+xml', '.jsonl': 'application/jsonl', '.md': 'text/markdown' };
let override = null;   // permet de simuler une nouvelle veille publiée
let down = false;      // serveur injoignable : connexion coupée net (zone blanche)
const server = http.createServer(async (req, res) => {
  if (down) { req.socket.destroy(); return; }
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p.endsWith('/')) p += 'index.html';
  const file = normalize(join(ROOT, p));
  try {
    let body = await readFile(file);
    if (override && p === '/index.html') body = Buffer.from(override);
    res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream', 'cache-control': 'max-age=600' });
    res.end(body);
  } catch { res.writeHead(404); res.end('404'); }
});
await new Promise(r => server.listen(0, r));
const BASE = `http://localhost:${server.address().port}/`;
await mkdir('pwa-shots', { recursive: true });

/* ─── Contrôles indépendants du navigateur ─── */
const html = await readFile(join(ROOT, 'index.html'), 'utf8');
const manifest = JSON.parse(await readFile(join(ROOT, 'manifest.webmanifest'), 'utf8'));
ok('manifeste : display standalone', manifest.display === 'standalone');
ok('manifeste : start_url et scope relatifs (sous-dossier Pages)', !manifest.start_url.startsWith('/') && !manifest.scope.startsWith('/'));
ok('manifeste : icônes 192 et 512', ['192x192', '512x512'].every(s => manifest.icons.some(i => i.sizes === s)));
ok('manifeste : icône maskable', manifest.icons.some(i => i.purpose?.includes('maskable')));
const hrefs = [...manifest.icons.map(i => i.src),
  ...[...html.matchAll(/<link rel="(?:apple-touch-icon|apple-touch-startup-image|icon|manifest)"[^>]*href="([^"]+)"/g)].map(m => m[1])];
const statuses = await Promise.all(hrefs.map(h => fetch(new URL(h, BASE)).then(r => r.status)));
ok(`ressources PWA toutes servies (${hrefs.length} : icônes, écrans de démarrage iOS, manifeste)`, statuses.every(s => s === 200));
ok('iOS : apple-mobile-web-app-capable', /apple-mobile-web-app-capable" content="yes"/.test(html));
ok('iOS : viewport-fit=cover (encoche)', /viewport-fit=cover/.test(html));
ok('iOS : marges safe-area', /safe-area-inset-top/.test(html) && /safe-area-inset-bottom/.test(html));
ok('rafraîchissement JS (pas de meta refresh active qui coupe la lecture)', !/^<meta http-equiv="refresh"/m.test(html) && /PERIODE=\d+\*60000/.test(html));

/* ─── Profils navigateur ─── */
const CRIOS = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/129.0 Mobile/15E148 Safari/604.1';
const PROFILES = [
  { name: 'Chrome desktop', engine: chromium, ctx: { viewport: { width: 1200, height: 900 } }, ios: false },
  { name: 'Safari iPhone', engine: webkit, ctx: { ...devices['iPhone 14'] }, ios: 'safari' },
  { name: 'Chrome iPhone', engine: webkit, ctx: { ...devices['iPhone 14'], userAgent: CRIOS }, ios: 'chrome' }
];

for (const P of PROFILES) {
  let browser;
  try { browser = await P.engine.launch(P.engine === chromium && process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}); }
  catch (e) { (STRICT ? ok : (n => skip(n)))(`${P.name} — moteur indisponible (${e.message.split('\n')[0]})`, false); continue; }
  const ctx = await browser.newContext(P.ctx);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));

  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForTimeout(300);
  ok(`${P.name} : aucune erreur JavaScript${errors.length ? ` — ${errors.join(' | ').slice(0, 200)}` : ''}`, errors.length === 0);
  ok(`${P.name} : liste de la veille affichée`, await page.locator('#liste li').count() > 0);
  ok(`${P.name} : pas de défilement horizontal`, await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));

  const iosVisible = await page.locator('#ios').isVisible();
  if (P.ios) {
    ok(`${P.name} : aide d'installation affichée`, iosVisible);
    const txt = await page.locator('#iostxt').innerText();
    ok(`${P.name} : consigne adaptée au navigateur`, P.ios === 'chrome' ? /Chrome ou Edge/.test(txt) : /Partager/.test(txt) && !/Chrome/.test(txt));
    await page.screenshot({ path: `pwa-shots/${P.name.replace(/\s/g, '-')}.png` });
    await page.click('#iosx');
    await page.reload();
    ok(`${P.name} : aide fermée ne revient pas`, !(await page.locator('#ios').isVisible()));
  } else {
    ok(`${P.name} : pas d'aide iOS hors iPhone`, !iosVisible);
    await page.screenshot({ path: `pwa-shots/${P.name.replace(/\s/g, '-')}.png` });
  }

  /* Service worker : contrôle de la page, hors ligne, fraîcheur en ligne */
  const hasSW = await page.evaluate(() => 'serviceWorker' in navigator);
  if (!hasSW) { skip(`${P.name} : service worker (API absente dans ce moteur de test)`); await browser.close(); continue; }
  const registered = await page.evaluate(() => Promise.race([
    navigator.serviceWorker.ready.then(() => true), new Promise(r => setTimeout(() => r(false), 5000))]));
  ok(`${P.name} : service worker enregistré`, registered);
  await page.reload(); await page.waitForTimeout(300);
  const controlled = await page.evaluate(() => !!navigator.serviceWorker.controller);
  if (!controlled) { skip(`${P.name} : hors ligne (service worker non contrôlant dans ce moteur de test)`); await browser.close(); continue; }

  override = html.replace('</h1>', '</h1><span id="fraiche"></span>');
  await page.reload(); await page.waitForTimeout(200);
  ok(`${P.name} : en ligne, la nouvelle veille remplace l'ancienne`, await page.locator('#fraiche').count() === 1);
  override = null;

  const cached = await page.evaluate(async () => {
    const out = [];
    for (const k of await caches.keys()) for (const r of await (await caches.open(k)).keys()) out.push(new URL(r.url).pathname + new URL(r.url).search);
    return out;
  });
  ok(`${P.name} : page mise en cache par le service worker (${cached.length} entrées)`, cached.includes('/'));

  // 1. Réseau coupé côté serveur : la requête atteint le SW et échoue → repli cache
  down = true;
  let blancheOk = false;
  try { await page.goto(BASE + '?f=l44'); blancheOk = await page.locator('#liste li').count() > 0; } catch (e) { console.log('   ', e.message.split('\n')[0]); }
  ok(`${P.name} : réseau coupé, dernière veille lisible`, blancheOk);
  down = false;
  await page.goto(BASE);

  // 2. Mode avion émulé par le moteur de test
  await ctx.setOffline(true);
  let offlineOk = false;
  try { await page.goto(BASE + '?f=new'); offlineOk = await page.locator('#liste li').count() > 0; } catch {}
  if (!offlineOk && P.engine === webkit && blancheOk) {
    skip(`${P.name} : mode avion émulé (setOffline de Playwright ne passe pas par le service worker sous WebKit ; repli cache déjà prouvé réseau coupé)`);
  } else {
    ok(`${P.name} : mode avion, dernière veille lisible`, offlineOk);
    ok(`${P.name} : bandeau hors ligne visible`, offlineOk && await page.locator('#off').isVisible());
  }
  await ctx.setOffline(false);
  await browser.close();
}

server.close();
if (GHA) console.log(`::notice title=PWA::${failed ? `${failed} échec(s)` : 'tout vert'}${untested ? ` · ${untested} non testé(s)` : ''}`);
console.log(`\nPWA : ${failed ? `${failed} échec(s)` : 'tout vert'}${untested ? ` · ${untested} point(s) non testé(s)` : ''}`);
process.exitCode = failed ? 1 : 0;
process.exit();
