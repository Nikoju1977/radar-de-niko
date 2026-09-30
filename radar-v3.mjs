/**
 * radar-v3.mjs — couche événementielle statique de Radar44.
 *
 * Transforme les items du noyau en :
 * article → événement → média → journaliste → commune.
 * Fonctionne sans base externe et publie directement sur GitHub Pages.
 */
import { createHash } from 'node:crypto';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const fold = s => String(s ?? '').normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '').toLowerCase();

const STOP = new Set(('a au aux avec ce ces dans de des du elle en et eux il ils je la le les leur lui ma mais me meme mes moi mon ne nos notre nous on ou par pas pour que qui sa se ses son sur ta te tes toi ton tu un une vos votre vous est sont ete etre plus apres avant contre chez vers entre loire atlantique nantes').split(' '));

const PLACES = [
  'Châteaubriant','Nantes','Saint-Nazaire','Ancenis-Saint-Géréon','La Baule-Escoublac',
  'Guérande','Pornic','Clisson','Rezé','Saint-Herblain','Orvault','Vertou','Bouguenais',
  'Carquefou','La Chapelle-sur-Erdre','Couëron','Sainte-Luce-sur-Loire','Blain','Savenay',
  'Pontchâteau','Machecoul-Saint-Même','Vallet','Nort-sur-Erdre','Treillières','Héric',
  'Nozay','Derval','Guémené-Penfao','La Meilleraye-de-Bretagne','Moisdon-la-Rivière',
  'Rougé','Issé','Erbray','Saffré','Sion-les-Mines','Saint-Brevin-les-Pins','Montoir-de-Bretagne'
];

const TOPICS = [
  ['Sécurité & faits divers', /(accident|incendie|police|gendarmer|secours|agression|cambriol|justice|tribunal|disparition)/i],
  ['Mobilité & travaux', /(route|rn\s?\d+|travaux|circulation|trafic|train|ter\b|gare|bus|tram|transport|vélo|velo|voirie)/i],
  ['Économie & emploi', /(entreprise|emploi|recrut|commerce|industrie|usine|économie|economie|artisan|investissement)/i],
  ['Environnement & agriculture', /(agricultur|élevage|elevage|environnement|climat|biodivers|eau\b|énergie|energie|éolien|eolien|solaire)/i],
  ['Santé & solidarité', /(santé|sante|hôpital|hopital|médecin|medecin|solidarit|social|ehpad)/i],
  ['Éducation & jeunesse', /(école|ecole|collège|college|lycée|lycee|jeunesse|étudiant|etudiant|formation)/i],
  ['Culture & sorties', /(concert|festival|spectacle|cinéma|cinema|théâtre|theatre|exposition|médiathèque|mediatheque|patrimoine|foire|fête|fete)/i],
  ['Sports', /(football|rugby|basket|handball|tennis|cyclisme|course|sport|match|championnat)/i],
  ['Institutions & vie publique', /(mairie|municipal|conseil municipal|préfecture|prefecture|département|departement|région|region|élection|election|service public)/i],
  ['Vie locale', /.*/]
];

const SOCIAL = new Set(['twitter','reddit','mastodon','bluesky','youtube']);
const GENERIC_AUTHORS = /^(rédaction|redaction|la rédaction|la redaction|actu|actualités|actualites|admin)$/i;

const tokenSet = title => new Set(
  fold(title).replace(/[^a-z0-9 ]/g, ' ').split(/\s+/)
    .filter(x => x.length > 2 && !STOP.has(x))
);

const jaccard = (a,b) => {
  if (!a.size || !b.size) return 0;
  let n=0; for (const x of a) if (b.has(x)) n++;
  return n / (a.size + b.size - n);
};

export function mediaFor(item) {
  if (item.media) return String(item.media).trim();
  if (item.source === 'presse' || item.source === 'gnews' || item.source === 'bing') return item.author || item.source;
  return item.source;
}

export function journalistFor(item) {
  const a=String(item.author ?? '').trim();
  if (!a || GENERIC_AUTHORS.test(a)) return null;
  const m=String(mediaFor(item) ?? '').trim();
  if (fold(a) === fold(m)) return null;
  if (SOCIAL.has(item.source)) return null;
  if (/^(https?:|www\.|actu\.fr|ouest-france|france ?3|ici loire|mairie|préfecture|prefecture)/i.test(a)) return null;
  return a;
}

export function placesFor(item) {
  const hay=' '+fold([item.title,item.summary].filter(Boolean).join(' '))+' ';
  return PLACES.filter(p => {
    const n=fold(p);
    const short=n.replace(/-saint-gereon$/,'').replace(/-de-bretagne$/,'');
    return hay.includes(n) || (short.length > 5 && hay.includes(short));
  });
}

export function topicFor(item) {
  if (item.source === 'emploi') return 'Économie & emploi';
  const hay=[item.title,item.summary].filter(Boolean).join(' ');
  for (const [name,rx] of TOPICS) if (rx.test(hay)) return name;
  return 'Vie locale';
}

function eventMatch(a,b) {
  const ta=Date.parse(a.publishedAt), tb=Date.parse(b.publishedAt);
  if (Number.isFinite(ta) && Number.isFinite(tb) && Math.abs(ta-tb)>60*3600e3) return false;
  const sim=jaccard(a._tokens,b._tokens);
  const samePlace=a.places.some(p=>b.places.includes(p));
  const sameTopic=a.topic===b.topic;
  if (sim>=.70) return true;
  if (sim>=.52 && samePlace) return true;
  if (sim>=.47 && samePlace && sameTopic) return true;
  return false;
}

function enrichItem(item) {
  const places=placesFor(item);
  const media=mediaFor(item);
  const journalist=journalistFor(item);
  return { ...item, media, journalist, places, topic: topicFor(item), _tokens: tokenSet(item.title) };
}

function eventId(title, first) {
  return 'evt-'+createHash('sha1').update(fold(title)+'|'+String(first ?? '')).digest('hex').slice(0,12);
}

export function buildRadarV3(run, now=Date.now()) {
  const sourceItems=(run.items ?? [])
    .filter(i => i.tags?.includes('44') || i.local || i.source === 'emploi')
    .map(enrichItem)
    .sort((a,b)=>Date.parse(a.publishedAt)-Date.parse(b.publishedAt));

  const events=[];
  for (const item of sourceItems) {
    let evt=null;
    for (let n=events.length-1;n>=Math.max(0,events.length-180);n--) {
      if (eventMatch(item,events[n]._representative)) { evt=events[n]; break; }
    }
    if (!evt) {
      evt={ id:eventId(item.title,item.publishedAt), title:item.title, topic:item.topic,
        places:[...item.places], items:[], media:[], journalists:[],
        firstPublishedAt:item.publishedAt, lastPublishedAt:item.publishedAt, _representative:item };
      events.push(evt);
    }
    evt.items.push(item);
    if (!evt.media.includes(item.media)) evt.media.push(item.media);
    if (item.journalist && !evt.journalists.includes(item.journalist)) evt.journalists.push(item.journalist);
    for (const p of item.places) if (!evt.places.includes(p)) evt.places.push(p);
    if (Date.parse(item.publishedAt)<Date.parse(evt.firstPublishedAt)) evt.firstPublishedAt=item.publishedAt;
    if (Date.parse(item.publishedAt)>Date.parse(evt.lastPublishedAt)) evt.lastPublishedAt=item.publishedAt;
  }

  for (const e of events) {
    e.items.sort((a,b)=>Date.parse(a.publishedAt)-Date.parse(b.publishedAt));
    e.sourceCount=e.media.length;
    e.articleCount=e.items.length;
    e.multiSource=e.sourceCount>1;
    delete e._representative;
    for (const i of e.items) delete i._tokens;
  }
  events.sort((a,b)=>Date.parse(b.lastPublishedAt)-Date.parse(a.lastPublishedAt));

  const journalistMap=new Map(), placeMap=new Map(), mediaMap=new Map(), articleToEvent={};
  for (const e of events) for (const i of e.items) {
    articleToEvent[i.id]=e.id;
    const mk=i.media || i.source;
    const m=mediaMap.get(mk) ?? {name:mk,articles:0,events:new Set(),lastPublishedAt:null};
    m.articles++; m.events.add(e.id);
    if (!m.lastPublishedAt || Date.parse(i.publishedAt)>Date.parse(m.lastPublishedAt)) m.lastPublishedAt=i.publishedAt;
    mediaMap.set(mk,m);
    if (i.journalist) {
      const key=fold(i.journalist)+'|'+fold(mk);
      const j=journalistMap.get(key) ?? {name:i.journalist,media:mk,articles:0,events:new Set(),lastPublishedAt:null};
      j.articles++; j.events.add(e.id);
      if (!j.lastPublishedAt || Date.parse(i.publishedAt)>Date.parse(j.lastPublishedAt)) j.lastPublishedAt=i.publishedAt;
      journalistMap.set(key,j);
    }
    for (const p of i.places) {
      const x=placeMap.get(p) ?? {name:p,articles:0,events:new Set(),lastPublishedAt:null};
      x.articles++; x.events.add(e.id);
      if (!x.lastPublishedAt || Date.parse(i.publishedAt)>Date.parse(x.lastPublishedAt)) x.lastPublishedAt=i.publishedAt;
      placeMap.set(p,x);
    }
  }

  const finalize=x=>[...x.values()].map(v=>({...v,events:v.events.size}))
    .sort((a,b)=>b.articles-a.articles || a.name.localeCompare(b.name,'fr'));

  return { generatedAt:new Date(now).toISOString(), stats:{ articles:sourceItems.length, events:events.length,
      multiSourceEvents:events.filter(e=>e.multiSource).length, journalists:journalistMap.size,
      media:mediaMap.size, places:placeMap.size }, events, journalists:finalize(journalistMap),
      media:finalize(mediaMap), places:finalize(placeMap), articleToEvent };
}

export const toV3JSON = graph => JSON.stringify(graph,null,2)+'\n';

const CLOCK=new Intl.DateTimeFormat('fr-FR',{timeZone:'Europe/Paris',hour:'2-digit',minute:'2-digit'});
const DATE=new Intl.DateTimeFormat('fr-FR',{timeZone:'Europe/Paris',weekday:'long',day:'numeric',month:'long',year:'numeric'});

function eventCard(e) {
  const timeline=e.items.map(i=>`<li><time>${esc(CLOCK.format(new Date(i.publishedAt)))}</time><div><b>${esc(i.media)}</b>${i.journalist?` · ${esc(i.journalist)}`:''}<br><a href="${esc(i.url)}" target="_blank" rel="noopener">${esc(i.title)}</a></div></li>`).join('');
  return `<article class="event" id="${esc(e.id)}" data-topic="${esc(e.topic)}" data-multi="${e.multiSource?'1':'0'}">
    <div class="event-top"><span>${esc(e.topic)}</span><span>${e.sourceCount} source${e.sourceCount>1?'s':''}</span></div>
    <h2>${esc(e.title)}</h2><p class="where">${e.places.length?esc(e.places.join(' · ')):'Loire-Atlantique'} · ${e.articleCount} article${e.articleCount>1?'s':''}</p>
    <ol class="timeline">${timeline}</ol></article>`;
}

export function toV3HTML(graph,{home='../',daily='../quotidien.html'}={}) {
  const cards=graph.events.map(eventCard).join('');
  const journalists=graph.journalists.slice(0,60).map(j=>`<li><b>${esc(j.name)}</b><span>${esc(j.media)} · ${j.articles} article${j.articles>1?'s':''}</span></li>`).join('');
  const places=graph.places.slice(0,40).map(p=>`<li><b>${esc(p.name)}</b><span>${p.events} sujet${p.events>1?'s':''}</span></li>`).join('');
  const media=graph.media.slice(0,30).map(m=>`<li><b>${esc(m.name)}</b><span>${m.articles} article${m.articles>1?'s':''}</span></li>`).join('');
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Radar44 V3 · événements, médias et journalistes</title><meta name="theme-color" content="#06120f"><style>
:root{--bg:#06120f;--panel:#0b1f1a;--line:#21453a;--green:#3dffb0;--amber:#ffb547;--txt:#d8ebe3;--muted:#7fa095}*{box-sizing:border-box}html{background:var(--bg);color:var(--txt);font:15px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace}body{margin:0 auto;max-width:1180px;padding:24px}a{color:inherit}header{border-bottom:1px solid var(--line);padding-bottom:18px}h1{font:700 clamp(38px,7vw,72px)/.95 system-ui,sans-serif;margin:5px 0;color:var(--green);letter-spacing:-.04em}nav{display:flex;gap:8px;flex-wrap:wrap}nav a{border:1px solid var(--line);padding:7px 10px;text-decoration:none}.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px;margin:18px 0}.stat{background:var(--panel);padding:13px}.stat b{font-size:25px;color:var(--green);display:block}.layout{display:grid;grid-template-columns:minmax(0,2fr) minmax(250px,.75fr);gap:22px}.event{border-top:1px solid var(--line);padding:18px 0}.event-top{display:flex;justify-content:space-between;color:var(--amber);font-size:12px;text-transform:uppercase}.event h2{font:750 25px/1.15 system-ui,sans-serif;margin:6px 0}.where{color:var(--muted)}.timeline{list-style:none;padding:0;margin:12px 0}.timeline li{display:grid;grid-template-columns:48px 1fr;gap:10px;border-left:2px solid var(--line);padding:7px 0 7px 12px}.timeline time{color:var(--muted)}.timeline a{text-decoration:none}.timeline a:hover{color:var(--green)}aside section{background:var(--panel);padding:14px;margin-bottom:14px}aside h2{font:700 20px system-ui,sans-serif;margin:0 0 10px}aside ul{list-style:none;margin:0;padding:0}aside li{display:flex;justify-content:space-between;gap:10px;padding:7px 0;border-top:1px solid var(--line)}aside li span{color:var(--muted);font-size:12px;text-align:right}.filters{display:flex;gap:6px;flex-wrap:wrap;margin:8px 0 18px}.filters button{font:inherit;color:var(--txt);background:none;border:1px solid var(--line);padding:7px 10px;cursor:pointer}.filters button.on{background:var(--green);color:var(--bg);border-color:var(--green)}.note{color:var(--muted)}@media(max-width:800px){.layout{grid-template-columns:1fr}body{padding:16px}}</style></head><body>
<header><div class="note">Radar44 · couche événementielle · ${esc(DATE.format(new Date(graph.generatedAt)))}</div><h1>Radar44 V3</h1><p>Une même information peut apparaître dans plusieurs médias : la V3 la regroupe en un événement et conserve sa chronologie.</p><nav><a href="${esc(home)}">← Radar en direct</a><a href="${esc(daily)}">📰 Quotidien régional</a><a href="radar-v3.json">JSON V3</a></nav></header>
<div class="stats"><div class="stat"><b>${graph.stats.events}</b>sujets</div><div class="stat"><b>${graph.stats.multiSourceEvents}</b>multi-sources</div><div class="stat"><b>${graph.stats.media}</b>médias</div><div class="stat"><b>${graph.stats.journalists}</b>signatures</div><div class="stat"><b>${graph.stats.places}</b>lieux</div></div>
<div class="filters"><button class="on" data-f="all">Tous</button><button data-f="multi">Multi-sources</button>${TOPICS.slice(0,-1).map(([t])=>`<button data-f="${esc(t)}">${esc(t)}</button>`).join('')}</div>
<div class="layout"><main>${cards || '<p>Aucun événement local détecté.</p>'}</main><aside><section><h2>Journalistes</h2><ul>${journalists || '<li>Aucune signature disponible</li>'}</ul></section><section><h2>Médias</h2><ul>${media}</ul></section><section><h2>Lieux</h2><ul>${places || '<li>Aucun lieu détecté</li>'}</ul></section></aside></div>
<script>document.querySelectorAll('.filters button').forEach(function(b){b.onclick=function(){document.querySelectorAll('.filters button').forEach(function(x){x.classList.remove('on')});b.classList.add('on');var f=b.dataset.f;document.querySelectorAll('.event').forEach(function(e){e.hidden=!(f==='all'||(f==='multi'&&e.dataset.multi==='1')||e.dataset.topic===f);});}});if(location.hash){var e=document.querySelector(location.hash);if(e)e.scrollIntoView({block:'start'});}</script></body></html>`;
}
