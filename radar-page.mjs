/**
 * radar-page.mjs — page publique statique (GitHub Pages).
 * Rendue côté Node à chaque run : aucune requête réseau dans le navigateur,
 * les items sont inscrits dans le HTML. Le petit script ne fait que filtrer.
 */

const esc = s => String(s ?? '').replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const LABEL = {
  presse: 'Presse', gnews: 'Google News', bing: 'Bing News', bluesky: 'Bluesky',
  mastodon: 'Mastodon', reddit: 'Reddit', youtube: 'YouTube', exa: 'Exa', twitter: 'X'
};
const label = s => LABEL[s] ?? s;

const hourFmt = new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit' });
const clockFmt = new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit' });
const stampFmt = new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });

/** Bande de balayage : 24 h en abscisse (maintenant à droite), une ligne par source. */
function sweep(items, sources, now) {
  const pos = t => (100 - Math.max(0, Math.min(1, (now - t) / 864e5)) * 100).toFixed(2);
  const rows = sources.map(s => {
    const blips = items.filter(i => i.source === s && now - Date.parse(i.publishedAt) <= 864e5)
      .map(i => `<a href="#${esc(i.id)}" class="blip${i.new ? ' new' : i.tags?.includes('44') ? ' l44' : ''}" style="left:${pos(Date.parse(i.publishedAt))}%" title="${esc(clockFmt.format(new Date(i.publishedAt)))} — ${esc(i.title)}"><span class="sr">${esc(i.title)}</span></a>`).join('');
    return `<div class="lane"><span class="ln">${esc(label(s))}</span><div class="track">${blips}</div></div>`;
  }).join('');
  const ticks = [24, 18, 12, 6, 0].map(h => `<span>${h ? `−${h} h` : 'maintenant'}</span>`).join('');
  return `<figure class="sweep" aria-label="Informations des dernières 24 heures, par source">${rows}<div class="lane axis"><span class="ln"></span><div class="ticks">${ticks}</div></div></figure>`;
}

export function toHTML(run, { title = 'Radar de Niko', feedUrl = 'radar.xml', every = 15 } = {}) {
  const now = Date.now();
  const items = run.items;
  const sources = [...new Set(items.map(i => i.source))];
  const fresh = items.filter(i => i.new).length;
  const local = items.filter(i => i.tags?.includes('44')).length;

  const groups = new Map();
  for (const i of items) {
    const k = hourFmt.format(new Date(i.publishedAt));
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(i);
  }

  const list = [...groups.entries()].map(([h, arr]) => `
    <section class="hour"><h2>${esc(h.replace(' à ', ', '))}</h2><ol>${arr.map(i => `
      <li id="${esc(i.id)}" data-src="${esc(i.source)}"${i.new ? ' data-new' : ''}${i.tags?.includes('44') ? ' data-l44' : ''}>
        <time datetime="${esc(i.publishedAt)}">${esc(clockFmt.format(new Date(i.publishedAt)))}</time>
        <div><a href="${esc(i.url)}" rel="noopener" target="_blank">${esc(i.title)}</a>
        <p>${esc(label(i.source))}${i.author ? `, ${esc(i.author)}` : ''}${i.new ? ' <b class="nv">nouveau</b>' : ''}${i.tags?.includes('44') ? ' <b class="t44">44</b>' : ''}</p></div>
      </li>`).join('')}</ol></section>`).join('');

  const chips = [['all', `Tout (${items.length})`], ['new', `Nouveaux (${fresh})`], ['l44', `Loire-Atlantique (${local})`],
    ...sources.map(s => [`src:${s}`, `${label(s)} (${items.filter(i => i.source === s).length})`])]
    .map(([v, t], n) => `<button type="button" data-f="${esc(v)}" aria-pressed="${n === 0}">${esc(t)}</button>`).join('');

  return `<!doctype html>
<html lang="fr"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta http-equiv="refresh" content="${every * 60}">
<title>${esc(title)} · veille Loire-Atlantique</title>
<link rel="alternate" type="application/rss+xml" title="${esc(title)}" href="${esc(feedUrl)}">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Share+Tech+Mono&display=swap" rel="stylesheet">
<style>
:root{--fond:#06120f;--nappe:#0b1f1a;--phos:#3dffb0;--ambre:#ffb547;--texte:#d3ebe1;--sourd:#6f8f84;--trait:#173a31}
*{box-sizing:border-box}
html{background:var(--fond);color:var(--texte);font:15px/1.55 "Share Tech Mono",ui-monospace,monospace;-webkit-text-size-adjust:100%}
body{margin:0;padding:max(20px,env(safe-area-inset-top)) max(18px,env(safe-area-inset-right)) max(40px,env(safe-area-inset-bottom)) max(18px,env(safe-area-inset-left));max-width:900px;margin-inline:auto}
header{display:flex;flex-wrap:wrap;align-items:baseline;justify-content:space-between;gap:6px 20px;border-bottom:1px solid var(--trait);padding-bottom:10px}
h1{font:400 clamp(44px,9vw,76px)/.9 "Bebas Neue",Impact,sans-serif;letter-spacing:.01em;margin:0;color:var(--phos)}
.meta{color:var(--sourd);margin:0}
.meta a{color:var(--texte)}
.sweep{margin:18px 0 6px;padding:10px 12px 6px;background:var(--nappe);border-radius:3px}
.lane{display:grid;grid-template-columns:92px 1fr;align-items:center;min-height:20px}
.ln{color:var(--sourd);font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.track{position:relative;height:20px;border-left:1px solid var(--trait);border-right:1px solid var(--trait);background:linear-gradient(90deg,transparent 25%,var(--trait) 25%,var(--trait) calc(25% + 1px),transparent calc(25% + 1px),transparent 50%,var(--trait) 50%,var(--trait) calc(50% + 1px),transparent calc(50% + 1px),transparent 75%,var(--trait) 75%,var(--trait) calc(75% + 1px),transparent calc(75% + 1px)),linear-gradient(90deg,transparent 94%,rgba(61,255,176,.08))}
.blip{position:absolute;top:50%;width:7px;height:7px;margin:-3.5px 0 0 -3.5px;border-radius:50%;background:var(--sourd)}
.blip.l44{background:var(--phos)}
.blip.new{width:11px;height:11px;margin:-5.5px 0 0 -5.5px;background:var(--ambre);z-index:1}
.blip:focus-visible{outline:2px solid #fff;outline-offset:1px}
.ticks{display:flex;justify-content:space-between;color:var(--sourd);font-size:11px;padding-top:4px}
.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}
.legend{color:var(--sourd);font-size:13px;margin:0 0 18px}
.legend i{display:inline-block;width:9px;height:9px;border-radius:50%;margin:0 4px 0 12px;vertical-align:0}
.filters{display:flex;flex-wrap:wrap;gap:6px;margin:0 0 22px}
.filters button{font:inherit;font-size:14px;color:var(--texte);background:transparent;border:1px solid var(--trait);border-radius:2px;padding:6px 10px;min-height:36px;cursor:pointer}
.filters button[aria-pressed=true]{background:var(--phos);color:var(--fond);border-color:var(--phos)}
.filters button:focus-visible,a:focus-visible{outline:2px solid var(--ambre);outline-offset:2px}
.hour h2{font:400 24px/1 "Bebas Neue",Impact,sans-serif;color:var(--sourd);margin:26px 0 8px;letter-spacing:.02em}
.hour ol{list-style:none;margin:0;padding:0}
li{display:grid;grid-template-columns:52px 1fr;gap:12px;padding:9px 0;border-top:1px solid var(--trait)}
li time{color:var(--sourd)}
li a{color:var(--texte);text-decoration:none;font-size:16px;line-height:1.4}
li a:hover{color:var(--phos);text-decoration:underline}
li p{margin:3px 0 0;color:var(--sourd);font-size:13px}
li[data-new] time{color:var(--ambre)}
b.nv,b.t44{font-weight:400;font-size:12px;padding:0 5px;border-radius:2px;margin-left:6px}
b.nv{background:var(--ambre);color:var(--fond)}
b.t44{border:1px solid var(--phos);color:var(--phos)}
.hide{display:none}
.vide{color:var(--sourd);padding:30px 0}
footer{margin-top:40px;color:var(--sourd);font-size:13px;border-top:1px solid var(--trait);padding-top:12px}
footer a{color:var(--texte)}
@media (prefers-reduced-motion:no-preference){.blip.new{animation:p 2.4s ease-in-out infinite}@keyframes p{50%{opacity:.35}}}
</style>
</head><body>
<header>
  <h1>${esc(title)}</h1>
  <p class="meta">Mis à jour le ${esc(stampFmt.format(new Date(now)))}, rafraîchi toutes les ${every} min. <a href="${esc(feedUrl)}">Flux RSS</a></p>
</header>
${sweep(items, sources, now)}
<p class="legend">Dernières 24 h, une ligne par source :<i style="background:var(--ambre)"></i>nouveau<i style="background:var(--phos)"></i>Loire-Atlantique<i style="background:var(--sourd)"></i>autre</p>
<nav class="filters" aria-label="Filtrer">${chips}</nav>
<main id="liste">${list || '<p class="vide">Aucune information collectée à ce run. Le prochain passage a lieu dans moins de ' + every + ' minutes.</p>'}</main>
<p class="vide hide" id="rien">Rien pour ce filtre sur ce run.</p>
<footer>Veille automatique ${esc(title)} · Journal 44 — Studio Niko Design. ${items.length} informations, ${run.dupes?.length ?? 0} doublons fusionnés. Sources : ${sources.map(s => esc(label(s))).join(', ')}.</footer>
<script>
(function(){
  var btns=document.querySelectorAll('.filters button'),lis=document.querySelectorAll('#liste li'),secs=document.querySelectorAll('#liste .hour'),rien=document.getElementById('rien');
  function apply(f){
    var n=0;
    for(var i=0;i<lis.length;i++){var li=lis[i],show=f==='all'||(f==='new'&&li.hasAttribute('data-new'))||(f==='l44'&&li.hasAttribute('data-l44'))||(f.indexOf('src:')===0&&li.getAttribute('data-src')===f.slice(4));li.classList.toggle('hide',!show);if(show)n++;}
    for(var j=0;j<secs.length;j++)secs[j].classList.toggle('hide',!secs[j].querySelector('li:not(.hide)'));
    rien.classList.toggle('hide',n>0);
  }
  for(var k=0;k<btns.length;k++)btns[k].addEventListener('click',function(){for(var m=0;m<btns.length;m++)btns[m].setAttribute('aria-pressed','false');this.setAttribute('aria-pressed','true');apply(this.getAttribute('data-f'));});
})();
</script>
</body></html>
`;
}
