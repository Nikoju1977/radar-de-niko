/**
 * radar-daily.mjs — édition quotidienne régionale du Radar.
 * Sélectionne les informations des dernières 24 h liées à la Loire-Atlantique
 * et au Pays de Châteaubriant, puis les classe dans une seule rubrique.
 */

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
  ['Mobilité & travaux', /(route|rn\s?\d+|déviation|deviation|travaux|circulation|trafic|train|ter\b|gare|bus|car\b|tram|transport|mobilité|mobilite|voirie|piste cyclable|vélo|velo)/i],
  ['Économie & emploi', /(entreprise|emploi|recrut|commerce|commerçant|commercant|industrie|usine|marché|marche|économie|economie|artisan|agriculteur.*revenu|investissement|immobilier)/i],
  ['Environnement & agriculture', /(agricultur|élevage|elevage|ferme|pesticide|sécheresse|secheresse|eau\b|environnement|climat|biodivers|forêt|foret|rivière|riviere|déchet|dechet|énergie|energie|éolien|eolien)/i],
  ['Santé & solidarité', /(santé|sante|hôpital|hopital|médecin|medecin|ehpad|handicap|solidarit|social|cancer|don du sang|secours populaire|restos du cœur|restos du coeur)/i],
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
  const items = run.items.filter(i => isRegionalItem(i, now));
  const groups = new Map(THEMES.map(([name]) => [name, []]));
  for (const item of items) groups.get(themeFor(item)).push(item);
  for (const arr of groups.values()) arr.sort((a,b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt));
  return { items, groups, now };
}

export function toFacebookText(run, {
  url = 'https://nikoju1977.github.io/radar-de-niko/quotidien.html'
} = {}) {
  const d = buildDaily(run);
  const lines = [
    'LE QUOTIDIEN DU RADAR 44',
    DATE.format(new Date(d.now)),
    '',
    d.items.length + ' informations régionales relevées sur les dernières 24 h.',
    ''
  ];
  for (const [theme, items] of d.groups) {
    if (!items.length) continue;
    lines.push('• ' + theme + ' (' + items.length + ')');
    for (const i of items.slice(0, 3)) lines.push('– ' + i.title);
    lines.push('');
  }
  lines.push('Lire l’édition complète : ' + url);
  lines.push('');
  lines.push('#LoireAtlantique #Chateaubriant #Radar44');
  return lines.join('\n');
}

export function toDailyHTML(run, {
  title = 'Le Quotidien du Radar 44',
  home = './',
  facebookUrl = 'facebook.txt'
} = {}) {
  const d = buildDaily(run);
  const sections = [...d.groups.entries()].filter(([, items]) => items.length).map(([theme, items]) => `
<section class="theme">
  <h2>${esc(theme)} <span>${items.length}</span></h2>
  <ol>${items.map(i => `
    <li>
      <time datetime="${esc(i.publishedAt)}">${esc(TIME.format(new Date(i.publishedAt)))}</time>
      <div>
        <a href="${esc(i.url)}" target="_blank" rel="noopener">${esc(i.title)}</a>
        <p>${esc(i.author || i.source)}${i.summary ? ' — ' + esc(i.summary.slice(0, 220)) : ''}</p>
      </div>
    </li>`).join('')}
  </ol>
</section>`).join('');

  const shareText = toFacebookText(run).replace(/<\/script/gi, '<\\/script').replace(/&/g, '\\u0026').replace(/</g, '\\u003c').replace(/>/g, '\\u003e');

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
<meta name="theme-color" content="#f5f0e6">
<style>
:root{--paper:#f5f0e6;--ink:#151515;--muted:#665f55;--rule:#b9ad9d;--accent:#8f1d14}
*{box-sizing:border-box}html{background:#d8d0c4;color:var(--ink);font:16px/1.5 Georgia,serif}
body{max-width:980px;margin:0 auto;background:var(--paper);min-height:100vh;padding:28px clamp(18px,4vw,52px) 60px}
header{border-bottom:4px double var(--ink);padding-bottom:16px;margin-bottom:24px}
.kicker{font:700 12px/1.2 Arial,sans-serif;letter-spacing:.18em;text-transform:uppercase;color:var(--accent)}
h1{font:900 clamp(42px,8vw,78px)/.9 Georgia,serif;margin:8px 0}
.deck{color:var(--muted);font-style:italic;margin:8px 0}
.actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:14px}
.actions a,.actions button{font:700 14px Arial,sans-serif;border:1px solid var(--ink);background:transparent;color:var(--ink);padding:9px 12px;text-decoration:none;cursor:pointer}
.actions .primary{background:var(--ink);color:var(--paper)}
.theme{break-inside:avoid;margin:0 0 30px}
.theme h2{font:800 28px/1.1 Georgia,serif;border-bottom:2px solid var(--ink);padding-bottom:5px;margin:0 0 4px}
.theme h2 span{float:right;font:700 13px Arial,sans-serif;color:var(--muted);margin-top:9px}
ol{list-style:none;margin:0;padding:0}
li{display:grid;grid-template-columns:54px 1fr;gap:14px;border-bottom:1px solid var(--rule);padding:12px 0}
time{font:700 12px Arial,sans-serif;color:var(--accent);padding-top:4px}
li a{font:700 19px/1.25 Georgia,serif;color:var(--ink);text-decoration:none}
li a:hover{text-decoration:underline}
li p{color:var(--muted);margin:5px 0 0;font-size:14px}
.empty{padding:50px 0;color:var(--muted)}
footer{border-top:4px double var(--ink);padding-top:12px;color:var(--muted);font-size:13px}
.toast{position:fixed;right:16px;bottom:16px;background:var(--ink);color:var(--paper);padding:10px 14px;font:700 13px Arial,sans-serif}
@media print{html{background:#fff}body{max-width:none;padding:0;background:#fff}.actions{display:none}.theme{break-inside:auto}.theme li{break-inside:avoid}.toast{display:none}}
</style>
</head><body>
<header>
  <div class="kicker">Loire-Atlantique · Pays de Châteaubriant · édition automatique</div>
  <h1>${esc(title)}</h1>
  <p class="deck">${esc(DATE.format(new Date(d.now)))} · ${d.items.length} informations des dernières 24 heures · classées par thématiques</p>
  <div class="actions">
    <a href="${esc(home)}">← Radar en direct</a>
    <button type="button" class="primary" id="copy">Copier pour Facebook</button>
    <button type="button" id="share">Partager</button>
    <button type="button" onclick="print()">Imprimer / PDF</button>
    <a href="${esc(facebookUrl)}" download>Texte Facebook</a>
  </div>
</header>
<main>${sections || '<p class="empty">Aucune information régionale des dernières 24 heures pour cette édition.</p>'}</main>
<footer>Édition générée automatiquement à ${esc(TIME.format(new Date(d.now)))} par Radar de Niko. Les titres et liens renvoient vers leurs sources d’origine.</footer>
<script>
(function(){
  var text=${JSON.stringify(shareText)};
  var copy=document.getElementById('copy'),share=document.getElementById('share');
  function toast(t){var x=document.createElement('div');x.className='toast';x.textContent=t;document.body.appendChild(x);setTimeout(function(){x.remove();},2200);}
  copy.addEventListener('click',async function(){try{await navigator.clipboard.writeText(text);toast('Texte Facebook copié');}catch(e){toast('Copie non disponible');}});
  share.addEventListener('click',async function(){if(navigator.share){try{await navigator.share({title:'Le Quotidien du Radar 44',text:text,url:location.href});}catch(e){}}else{try{await navigator.clipboard.writeText(text);toast('Texte copié : colle-le dans Facebook');}catch(e){}}});
})();
</script>
</body></html>`;
}
