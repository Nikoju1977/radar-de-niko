/**
 * radar-daily.mjs — quotidien régional automatique du Radar.
 * Dernières 24 h, filtrées régionalement et classées par thématiques.
 */
import { toGamesHTML } from './radar-games.mjs';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const DATE = new Intl.DateTimeFormat('fr-FR', {
  timeZone: 'Europe/Paris', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
});
const TIME = new Intl.DateTimeFormat('fr-FR', {
  timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit'
});

const REGIONAL = /(loire[- ]atlantique|châteaubriant|chateaubriant|derval|nozay|rougé|rouge|moisdon|meilleraye|nantes|ancenis|blain|brière|briere|44\b)/i;
const LOCAL_SOURCE = /(éclaireur|eclaireur|la mée|la mee|mairie de châteaubriant|chateaubriant|loire[- ]atlantique|loire océan|loire ocean|france 3.*loire|préfecture 44|prefecture 44)/i;

export const THEMES = [
  ['Sécurité & faits divers', /(accident|incendie|feu|police|gendarmer|secours|pompiers|disparition|agression|vol\b|cambriol|justice|tribunal|condamn|sécurité|securite|alerte)/i],
  ['Mobilité & travaux', /(route|rn\s?\d+|déviation|deviation|travaux|circulation|trafic|train|ter\b|gare|bus|car\b|tram|transport|mobilité|mobilite|voirie|piste cyclable)/i],
  ['Économie & emploi', /(entreprise|emploi|recrut|commerce|commerçant|commercant|industrie|usine|marché|marche|économie|economie|artisan|investissement|immobilier)/i],
  ['Environnement & agriculture', /(agricultur|élevage|elevage|ferme|pesticide|sécheresse|secheresse|eau\b|environnement|climat|biodivers|forêt|foret|rivière|riviere|déchet|dechet|énergie|energie|éolien|eolien)/i],
  ['Santé & solidarité', /(santé|sante|hôpital|hopital|médecin|medecin|ehpad|handicap|solidarit|social|cancer|don du sang)/i],
  ['Éducation & jeunesse', /(école|ecole|collège|college|lycée|lycee|élève|eleve|étudiant|etudiant|jeunesse|crèche|creche|formation|apprentissage|universit)/i],
  ['Culture & sorties', /(concert|festival|spectacle|cinéma|cinema|théâtre|theatre|exposition|expo\b|musée|musee|médiathèque|mediatheque|livre|patrimoine|foire|salon|fête|fete|agenda|sortie)/i],
  ['Sports', /(football|foot\b|rugby|basket|handball|volley|tennis|cyclisme|vélo|velo|course|marathon|trail|sport|club|match|championnat)/i],
  ['Institutions & vie publique', /(mairie|municipal|conseil municipal|préfecture|prefecture|département|departement|région|region|élection|election|sénat|senat|déput|deput|arrêté|arrete|service public|communauté de communes|communaute de communes)/i],
  ['Vie locale', /.*/]
];

export function isRegionalItem(item, now = Date.now()) {
  const t = Date.parse(item.publishedAt);
  if (!Number.isFinite(t) || t < now - 24 * 3600e3 || t > now + 5 * 60e3) return false;
  const hay = [item.title, item.summary, item.author, item.url, ...(item.tags ?? [])].filter(Boolean).join(' ');
  return item.tags?.includes('44') || LOCAL_SOURCE.test(item.author ?? '') || REGIONAL.test(hay);
}

export function themeFor(item) {
  const hay = [item.title, item.summary, item.author].filter(Boolean).join(' ');
  for (const [name, rx] of THEMES) if (rx.test(hay)) return name;
  return 'Vie locale';
}

export function buildDaily(run, now = Date.now()) {
  const items = run.items.filter(i => isRegionalItem(i, now))
    .sort((a,b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt));
  const groups = new Map(THEMES.map(([name]) => [name, []]));
  for (const item of items) groups.get(themeFor(item)).push(item);
  return { items, groups, now, lead: items[0] ?? null };
}

const slug = s => String(s).normalize('NFD').replace(/[\u0300-\u036f]/g,'')
  .toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');

export function toFacebookText(run, {
  url = 'https://nikoju1977.github.io/radar-de-niko/quotidien.html'
} = {}) {
  const d = buildDaily(run);
  const lines = [
    '📰 LE QUOTIDIEN DU RADAR 44',
    DATE.format(new Date(d.now)),
    '',
    d.items.length + ' informations régionales relevées sur les dernières 24 h.',
    ''
  ];
  if (d.lead) lines.push('À LA UNE — ' + d.lead.title, '');
  for (const [theme, items] of d.groups) {
    if (!items.length) continue;
    lines.push('▸ ' + theme + ' (' + items.length + ')');
    for (const i of items.slice(0, 2)) lines.push('• ' + i.title);
    lines.push('');
  }
  lines.push('📖 Lire le journal complet : ' + url);
  lines.push('');
  lines.push('#LoireAtlantique #Chateaubriant #Radar44');
  return lines.join('\n');
}

function articleRow(i, leadId=null) {
  if (i.id === leadId) return '';
  return `<article class="story">
    <div class="story-meta"><time datetime="${esc(i.publishedAt)}">${esc(TIME.format(new Date(i.publishedAt)))}</time><span>${esc(i.author || i.source)}</span></div>
    <h3><a href="${esc(i.url)}" target="_blank" rel="noopener">${esc(i.title)}</a></h3>
    ${i.summary ? `<p>${esc(i.summary.slice(0, 300))}</p>` : ''}
  </article>`;
}

export function toDailyHTML(run, {
  title = 'Le Quotidien du Radar 44',
  home = './',
  facebookUrl = 'facebook.txt'
} = {}) {
  const d = buildDaily(run);
  const lead = d.lead;
  const sections = [...d.groups.entries()].filter(([, items]) => items.some(i => i.id !== lead?.id)).map(([theme, items]) => {
    const body=items.map(i=>articleRow(i,lead?.id)).join('');
    return `<section class="theme" id="${slug(theme)}"><h2>${esc(theme)} <span>${items.length}</span></h2><div class="columns">${body}</div></section>`;
  }).join('');
  const toc=[...d.groups.entries()].filter(([,items])=>items.length).map(([theme,items])=>
    `<a href="#${slug(theme)}">${esc(theme)} <b>${items.length}</b></a>`).join('');
  const dayKey=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Paris',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(d.now));
  const shareJson=JSON.stringify(toFacebookText(run)).replace(/<\//g,'<\\/');

  return `<!doctype html>
<html lang="fr"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} — ${esc(DATE.format(new Date(d.now)))}</title>
<meta name="description" content="${d.items.length} informations régionales des dernières 24 heures, classées par thèmes.">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${d.items.length} informations régionales des dernières 24 heures, classées par thèmes.">
<meta property="og:type" content="article">
<meta property="og:url" content="https://nikoju1977.github.io/radar-de-niko/quotidien.html">
<meta name="theme-color" content="#f2ecdf">
<style>
:root{--paper:#f2ecdf;--ink:#171512;--muted:#6b6258;--rule:#b5a898;--red:#982a20;--cream:#fbf7ed}
*{box-sizing:border-box}html{background:#d6cec1;color:var(--ink);font:16px/1.52 Georgia,"Times New Roman",serif}
body{max-width:1120px;margin:0 auto;background:var(--paper);min-height:100vh;padding:24px clamp(16px,4vw,54px) 64px}
.topline{display:flex;justify-content:space-between;gap:16px;border-block:1px solid var(--ink);padding:6px 0;font:700 11px/1.2 Arial,sans-serif;text-transform:uppercase;letter-spacing:.12em}
.mast{text-align:center;padding:17px 0 12px;border-bottom:5px double var(--ink)}
.kicker{font:700 11px Arial,sans-serif;letter-spacing:.2em;text-transform:uppercase;color:var(--red)}
h1{font:900 clamp(46px,9vw,92px)/.82 Georgia,serif;letter-spacing:-.055em;margin:8px 0}
.deck{margin:9px auto 0;max-width:760px;color:var(--muted);font-style:italic}
.actions{display:flex;justify-content:center;gap:7px;flex-wrap:wrap;margin-top:15px}
.actions a,.actions button{font:700 12px Arial,sans-serif;border:1px solid var(--ink);background:transparent;color:var(--ink);padding:9px 11px;text-decoration:none;cursor:pointer}
.actions .primary{background:var(--ink);color:var(--cream)}
.toc{display:grid;grid-template-columns:repeat(auto-fit,minmax(165px,1fr));border-bottom:1px solid var(--ink);margin-bottom:20px}
.toc a{display:flex;justify-content:space-between;gap:8px;color:var(--ink);text-decoration:none;padding:8px 9px;border-right:1px solid var(--rule);font:700 11px Arial,sans-serif;text-transform:uppercase}
.toc b{color:var(--red)}
.lead{display:grid;grid-template-columns:minmax(0,1.55fr) minmax(220px,.65fr);gap:24px;padding:18px 0 26px;border-bottom:3px solid var(--ink)}
.lead h2{font:900 clamp(34px,5vw,60px)/.98 Georgia,serif;letter-spacing:-.035em;margin:4px 0 12px}
.lead h2 a{color:var(--ink);text-decoration:none}
.lead .summary{font-size:18px;line-height:1.55;margin:0}
.lead-side{border-left:1px solid var(--rule);padding-left:20px}
.lead-side strong{display:block;font:800 12px Arial,sans-serif;text-transform:uppercase;color:var(--red);margin-bottom:8px}
.lead-side p{color:var(--muted);margin:0 0 12px}
.theme{margin:30px 0 0;break-inside:avoid}
.theme>h2{font:900 30px/1 Georgia,serif;border-block:3px solid var(--ink);padding:7px 0;margin:0 0 13px}
.theme>h2 span{float:right;font:700 12px Arial,sans-serif;color:var(--muted);margin-top:9px}
.columns{columns:2 330px;column-gap:28px;column-rule:1px solid var(--rule)}
.story{break-inside:avoid;padding:0 0 16px;margin:0 0 16px;border-bottom:1px solid var(--rule)}
.story-meta{display:flex;gap:9px;flex-wrap:wrap;color:var(--red);font:700 10px Arial,sans-serif;text-transform:uppercase;letter-spacing:.04em}
.story h3{font:800 21px/1.13 Georgia,serif;margin:5px 0}
.story h3 a{color:var(--ink);text-decoration:none}.story h3 a:hover{text-decoration:underline}
.story p{color:var(--muted);margin:6px 0 0;font-size:14px}
.games{margin-top:48px;padding-top:22px;border-top:7px double var(--ink);page-break-before:always}
.games-head{text-align:center;border-bottom:2px solid var(--ink);padding-bottom:12px;margin-bottom:20px}
.games-head span{font:800 11px Arial,sans-serif;text-transform:uppercase;letter-spacing:.2em;color:var(--red)}
.games-head h2{font:900 clamp(38px,6vw,60px)/.9 Georgia,serif;margin:5px 0}
.games-head p{color:var(--muted);margin:0}
.game-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:30px}
.game{break-inside:avoid}.game.wide{grid-column:1/-1}.game h3{font:900 28px/1 Georgia,serif;border-bottom:2px solid var(--ink);padding-bottom:5px;margin:0 0 7px}
.game>p{color:var(--muted);font-size:14px}
.sudoku,.crossword,.wordsearch{border-collapse:collapse;margin:14px auto}
.sudoku td{width:36px;height:36px;text-align:center;border:1px solid #777;font:700 20px Arial,sans-serif;background:var(--cream)}
.sudoku td.br{border-right:3px solid var(--ink)}.sudoku td.bb{border-bottom:3px solid var(--ink)}
.crossword td{position:relative;width:28px;height:28px;border:1px solid #777;background:var(--cream);text-align:center;font:700 15px Arial,sans-serif}
.crossword td.blk{background:var(--ink)}.crossword td span{position:absolute;left:2px;top:1px;font:700 8px Arial,sans-serif}
.crossword.small td{font-size:11px}.clues{display:grid;grid-template-columns:1fr 1fr;gap:18px}.clues h4{margin:6px 0}.clues ol{padding-left:22px;margin:0}.clues li{margin:5px 0;font-size:13px}
.wordsearch td{width:30px;height:30px;text-align:center;font:700 17px Arial,sans-serif}.wordbank{text-align:center;font:700 12px Arial,sans-serif;letter-spacing:.05em}
details{margin-top:12px;border-top:1px solid var(--rule);padding-top:8px}summary{cursor:pointer;font:700 12px Arial,sans-serif;text-transform:uppercase}
.empty{padding:50px 0;color:var(--muted)}
footer{margin-top:50px;border-top:5px double var(--ink);padding-top:12px;color:var(--muted);font-size:12px}
.toast{position:fixed;right:16px;bottom:16px;background:var(--ink);color:var(--cream);padding:10px 14px;font:700 13px Arial,sans-serif;z-index:10}
@media(max-width:720px){.lead{grid-template-columns:1fr}.lead-side{border-left:0;border-top:1px solid var(--rule);padding:12px 0 0}.game-grid{grid-template-columns:1fr}.game.wide{grid-column:auto}.columns{columns:1}.topline{font-size:9px}}
@media print{html{background:#fff}body{max-width:none;padding:0;background:#fff}.actions{display:none}.toc{break-after:avoid}.theme{break-inside:auto}.story{break-inside:avoid}.games{page-break-before:always}.toast{display:none}a{color:#000!important}}
</style>
</head><body>
<div class="topline"><span>Loire-Atlantique · Pays de Châteaubriant</span><span>Édition automatique · ${esc(TIME.format(new Date(d.now)))}</span></div>
<header class="mast">
  <div class="kicker">Toute l’actualité régionale des dernières 24 heures</div>
  <h1>${esc(title)}</h1>
  <p class="deck">${esc(DATE.format(new Date(d.now)))} · ${d.items.length} informations retenues et classées par thématiques</p>
  <div class="actions">
    <a href="${esc(home)}">← Radar en direct</a>
    <button type="button" class="primary" id="copy">Copier pour Facebook</button>
    <button type="button" id="share">Partager</button>
    <button type="button" onclick="print()">Imprimer / PDF</button>
    <a href="${esc(facebookUrl)}" download>Texte Facebook</a>
    <a href="#jeux">Jeux du jour ↓</a>
  </div>
</header>
<nav class="toc" aria-label="Sommaire">${toc}</nav>
${lead ? `<section class="lead"><div><div class="kicker">À la une</div><h2><a href="${esc(lead.url)}" target="_blank" rel="noopener">${esc(lead.title)}</a></h2><p class="summary">${esc(lead.summary || 'Retrouvez l’article complet auprès de la source originale.')}</p></div><aside class="lead-side"><strong>${esc(themeFor(lead))}</strong><p>${esc(lead.author || lead.source)}</p><p>Publié à ${esc(TIME.format(new Date(lead.publishedAt)))}</p><a href="${esc(lead.url)}" target="_blank" rel="noopener">Lire la source →</a></aside></section>` : ''}
<main>${sections || '<p class="empty">Aucune information régionale des dernières 24 heures pour cette édition.</p>'}</main>
${toGamesHTML(dayKey)}
<footer>Le Quotidien du Radar 44 est une édition automatique de veille. Les titres, extraits et liens renvoient vers leurs sources d’origine. Jeux générés localement pour cette édition.</footer>
<script>
(function(){
  var text=${shareJson};
  var copy=document.getElementById('copy'),share=document.getElementById('share');
  function toast(t){var x=document.createElement('div');x.className='toast';x.textContent=t;document.body.appendChild(x);setTimeout(function(){x.remove();},2200);}
  copy.addEventListener('click',async function(){try{await navigator.clipboard.writeText(text);toast('Texte Facebook copié');}catch(e){toast('Copie non disponible');}});
  share.addEventListener('click',async function(){if(navigator.share){try{await navigator.share({title:'Le Quotidien du Radar 44',text:text,url:location.href});}catch(e){}}else{try{await navigator.clipboard.writeText(text);toast('Texte copié : colle-le dans Facebook');}catch(e){toast('Partage non disponible');}}});
})();
</script>
</body></html>`;
}
