/**
 * radar-daily.mjs — quotidien régional automatique du Radar.
 * Dernières 24 h, filtrées régionalement et classées par thématiques.
 */
import { toGamesHTML } from './radar-games.mjs';
import { buildRadarV3, mediaFor, journalistFor } from './radar-v3.mjs';
import { servicesPanel, servicesFacebookLine, SERVICES_CSS } from './radar-services-view.mjs';
import { buildSatiricalArticle } from './radar-satire.mjs';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const DATE = new Intl.DateTimeFormat('fr-FR', {
  timeZone: 'Europe/Paris', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
});
const TIME = new Intl.DateTimeFormat('fr-FR', {
  timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit'
});

const LOCAL_SOURCE = /(éclaireur de châteaubriant|eclaireur de chateaubriant|journal la mée|journal la mee|mairie de châteaubriant|mairie de chateaubriant|france 3 loire-atlantique|préfecture 44|prefecture 44)/i;
const LOCAL_URL = /(loire-atlantique(?:-44)?|chateaubriant|journal-la-mee|l-eclaireur-de-chateaubriant)/i;
const PLACE_RX = /(?:^|[^a-z])(loire[- ]atlantique|chateaubriant|derval|nozay|moisdon(?:-la-riviere)?|la meilleraye(?:-de-bretagne)?|nantes|nantais|saint[- ]nazaire|ancenis|blain|briere|reze|saint[- ]herblain|orvault|vertou|bouguenais|carquefou|guerande|la baule|pornic|clisson|pontchateau|saint[- ]brevin|montoir(?:-de-bretagne)?|savenay|coueron|heric|saffre|isse|erbray|guemene[- ]penfao|sion[- ]les[- ]mines)(?:[^a-z]|$)/i;
const fold = s => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
const hasRegionalPlace = s => PLACE_RX.test(fold(s)) || /rougé/i.test(String(s ?? ''));

export const THEMES = [
  ['Sécurité & faits divers', /(accident|incendie|feu|police|gendarmer|secours|pompiers|disparition|agression|vol\b|cambriol|justice|tribunal|condamn|sécurité|securite|alerte)/i],
  ['Mobilité & travaux', /(route|rn\s?\d+|déviation|deviation|travaux|circulation|trafic|\btrain(?:s)?\b|\bter\b|gare|\bbus\b|\bcar(?:s)?\b|tram|transport|mobilité|mobilite|voirie|piste cyclable|covoiturage|vélo|velo|cyclable)/i],
  ['Économie & emploi', /(entreprise|emploi|recrut|commerce|commerçant|commercant|industrie|usine|marché|marche|économie|economie|artisan|investissement|immobilier)/i],
  ['Environnement & agriculture', /(agricultur|élevage|elevage|ferme|pesticide|sécheresse|secheresse|\beau\b|environnement|climat|biodivers|forêt|foret|rivière|riviere|déchet|dechet|énergie|energie|éolien|eolien|solaire|co2)/i],
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
  const text = [item.title, item.summary].filter(Boolean).join(' ');
  return item.source === 'emploi'
    || item.tags?.includes('44')
    || LOCAL_SOURCE.test([item.author, item.media].filter(Boolean).join(' '))
    || LOCAL_URL.test(item.url ?? '')
    || hasRegionalPlace(text);
}

export function themeFor(item) {
  if (item.source === 'emploi') return 'Économie & emploi';
  // Le média/auteur ne doit jamais déterminer la rubrique (ex. "social.rebellion.global").
  const hay = [item.title, item.summary].filter(Boolean).join(' ');
  for (const [name, rx] of THEMES) if (rx.test(hay)) return name;
  return 'Vie locale';
}

function leadScore(item, now) {
  const ageHours = Math.max(0, (now - Date.parse(item.publishedAt)) / 36e5);
  let score = Math.max(0, 48 - ageHours);
  if (item.source === 'presse' || item.source === 'gnews') score += 80;
  if (LOCAL_SOURCE.test([item.author, item.media].filter(Boolean).join(' ')) || LOCAL_URL.test(item.url ?? '')) score += 70;
  if (item.tags?.includes('44')) score += 35;
  if (/^(mastodon|bluesky|reddit|twitter)$/i.test(item.source ?? '')) score -= 45;
  if (String(item.title ?? '').length >= 45) score += 8;
  return score;
}

export function buildDaily(run, now = Date.now(), v3Graph = null) {
  const items = run.items.filter(i => isRegionalItem(i, now))
    .sort((a,b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt));
  const groups = new Map(THEMES.map(([name]) => [name, []]));
  for (const item of items) groups.get(themeFor(item)).push(item);
  const graph = v3Graph ?? buildRadarV3(run, now);
  const eventById = new Map(graph.events.map(e => [e.id, e]));
  const eventFor = i => eventById.get(graph.articleToEvent[i.id]);
  const editorialScore = i => leadScore(i, now) + Math.max(0, (eventFor(i)?.sourceCount ?? 1) - 1) * 22;
  const lead = [...items].sort((a,b) => editorialScore(b) - editorialScore(a))[0] ?? null;
  return { items, groups, now, lead, graph };
}

const SERIOUS_NEWS = /(mort|décès|deces|tué|tue|meurtre|viol\b|agression sexuelle|accident mortel|incendie mortel|disparition inquiétante|disparition inquietante)/i;
const NIKO_LINES = {
  'Mobilité & travaux': [
    'Une déviation, c’est une route qui te dit : “Tu voulais aller là ? Intéressant. Moi non plus.”',
    'Le cône orange est fascinant : il ne bouge jamais, mais c’est lui qui décide où tout le monde va.'
  ],
  'Économie & emploi': [
    'On dit que le marché bouge. Personne ne l’a jamais vu marcher, mais tout le monde court derrière.',
    'Une offre d’emploi, c’est deux inconnus qui se demandent poliment s’ils pourraient supporter de se voir cinq jours par semaine.'
  ],
  'Environnement & agriculture': [
    'La météo locale, c’est la seule chronique où un nuage peut avoir plus d’influence qu’un conseil d’administration.',
    'On parle beaucoup de la terre. Elle, de son côté, continue son truc sans avoir demandé à être invitée à la réunion.'
  ],
  'Éducation & jeunesse': [
    'À l’école, on prépare l’avenir. C’est ambitieux, surtout qu’on n’a déjà pas complètement compris mardi prochain.',
    'Les jeunes apprennent pour demain pendant que les adultes font encore semblant de savoir où ils vont.'
  ],
  'Culture & sorties': [
    'Un concert, c’est des centaines de gens qui acceptent ensemble de ressentir quelque chose sans faire de tableau Excel.',
    'Une exposition réussie, c’est quand tu regardes un objet immobile et qu’il te donne soudain l’impression que c’est toi qui n’avances plus.'
  ],
  'Sports': [
    'Le sport, c’est magnifique : on invente une ligne, puis on consacre des années à essayer d’arriver avant les autres de l’autre côté.',
    'Un match, c’est quatre-vingt-dix minutes où des adultes très sérieux poursuivent une balle comme si elle détenait enfin les réponses.'
  ],
  'Institutions & vie publique': [
    'Un dossier administratif, c’est une feuille qui a réussi à convaincre qu’elle avait besoin de dix-sept autres feuilles pour exister.',
    'La démocratie locale, c’est beaucoup de gens qui discutent longtemps pour décider où mettre quelque chose qui était déjà presque là.'
  ],
  'Vie locale': [
    'L’actualité locale est rassurante : le monde est immense, mais quelqu’un doit quand même décider où mettre le nouveau passage piéton.',
    'Dans une commune, tout peut devenir un événement. C’est peut-être ça, le vrai luxe : encore être surpris par une salle polyvalente.'
  ]
};

export function nikoNote(d) {
  const safe = d.items.filter(i => !SERIOUS_NEWS.test([i.title, i.summary].filter(Boolean).join(' ')));
  if (!safe.length && d.items.length) return 'Aujourd’hui, l’actualité appelle surtout à la sobriété. La note de Niko garde son sourire pour demain.';
  if (!d.items.length) return 'Aujourd’hui, le Radar capte surtout le calme. Même les notifications semblent avoir pris leur après-midi.';
  const counts = new Map();
  for (const i of safe) {
    const t = themeFor(i);
    if (t === 'Sécurité & faits divers' || t === 'Santé & solidarité') continue;
    counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  const theme = [...counts.entries()].sort((a,b) => b[1] - a[1])[0]?.[0] ?? 'Vie locale';
  const lines = NIKO_LINES[theme] ?? NIKO_LINES['Vie locale'];
  const day = Number(new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Paris',day:'2-digit'}).format(new Date(d.now))) || 1;
  return lines[day % lines.length];
}

const slug = s => String(s).normalize('NFD').replace(/[\u0300-\u036f]/g,'')
  .toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');

export function toFacebookText(run, {
  url = 'https://nikoju1977.github.io/radar-de-niko/quotidien.html',
  v3Graph = null,
  services = null
} = {}) {
  const d = buildDaily(run, Date.now(), v3Graph);
  const lines = [
    '📰 LE QUOTIDIEN DU RADAR 44',
    DATE.format(new Date(d.now)),
    '',
    d.items.length + ' informations régionales relevées sur les dernières 24 h.',
    ''
  ];
  if (d.lead) lines.push('À LA UNE — ' + d.lead.title, '');
  const practicalLine = servicesFacebookLine(services);
  if (practicalLine) lines.push(practicalLine, '');
  lines.push('LA NOTE DE NIKO — ' + nikoNote(d), '');
  const satire = buildSatiricalArticle(d.items, { themeFor, now:d.now });
  if (satire) lines.push('LE BILLET SATIRIQUE — ' + satire.headline, '');
  const seenEvents = new Set();
  for (const [theme, items] of d.groups) {
    const unique = [];
    for (const i of items) {
      const eid = d.graph.articleToEvent[i.id] ?? i.id;
      if (seenEvents.has(eid)) continue;
      seenEvents.add(eid);
      const event = d.graph.events.find(e => e.id === eid);
      unique.push({ item:i, event });
    }
    if (!unique.length) continue;
    lines.push('▸ ' + theme + ' (' + unique.length + ')');
    for (const { item, event } of unique.slice(0, 2)) {
      lines.push('• ' + item.title + (event?.multiSource ? ' [' + event.sourceCount + ' sources]' : ''));
    }
    lines.push('');
  }
  lines.push('📖 Lire le journal complet : ' + url);
  lines.push('');
  lines.push('#LoireAtlantique #Chateaubriant #Radar44');
  return lines.join('\n');
}

function storyPhoto(i, cls="story-photo", eager=false) {
  if (!i?.imageUrl) return "";
  return `<figure class="${cls}"><img src="${esc(i.imageUrl)}" alt="${esc(i.title)}" loading="${eager ? "eager" : "lazy"}" decoding="async" referrerpolicy="no-referrer" onerror="this.parentElement.remove()"></figure>`;
}

function articleRow(i, leadId=null, showPhoto=true, event=null) {
  if (i.id === leadId) return '';
  const media = mediaFor(i);
  const journalist = journalistFor(i);
  return `<article class="story">
    ${showPhoto ? storyPhoto(i) : ''}
    <div class="story-meta"><time datetime="${esc(i.publishedAt)}">${esc(TIME.format(new Date(i.publishedAt)))}</time><span>${esc(media)}${journalist ? ' · ' + esc(journalist) : ''}</span>${event?.multiSource ? `<a class="multi" href="v3/#${esc(event.id)}">${event.sourceCount} sources</a>` : ''}</div>
    <h3><a href="${esc(i.url)}" target="_blank" rel="noopener">${esc(i.title)}</a></h3>
    ${i.summary ? `<p>${esc(i.summary.slice(0, 300))}</p>` : ''}
  </article>`;
}

export function toDailyHTML(run, {
  title = 'Le Quotidien du Radar 44',
  home = './',
  facebookUrl = 'facebook.txt',
  v3Graph = null,
  services = null
} = {}) {
  const d = buildDaily(run, Date.now(), v3Graph);
  const lead = d.lead;
  const note = nikoNote(d);
  const satire = buildSatiricalArticle(d.items, { themeFor, now:d.now });
  const eventById = new Map(d.graph.events.map(e => [e.id, e]));
  const eventFor = i => eventById.get(d.graph.articleToEvent[i.id]);
  const leadEvent = lead ? eventFor(lead) : null;
  const renderedEvents = new Set(leadEvent ? [leadEvent.id] : []);
  let photoBudget = 8;
  const sectionData = [...d.groups.entries()].map(([theme, items]) => {
    const localSeen = new Set();
    const unique = [];
    for (const i of items) {
      const event = eventFor(i);
      const key = event?.id ?? i.id;
      if (localSeen.has(key)) continue;
      localSeen.add(key);
      unique.push({ item:i, event, key });
    }
    return [theme, unique];
  });
  const sections = sectionData.map(([theme, entries]) => {
    const visible = entries.filter(({ item, key }) => item.id !== lead?.id && !renderedEvents.has(key));
    if (!visible.length) return '';
    const body = visible.map(({ item:i, event, key }) => {
      renderedEvents.add(key);
      const usePhoto = Boolean(i.imageUrl) && photoBudget > 0;
      if (usePhoto) photoBudget--;
      return articleRow(i, lead?.id, usePhoto, event);
    }).join('');
    return `<section class="theme" id="${slug(theme)}"><h2>${esc(theme)} <span>${visible.length}</span></h2><div class="columns">${body}</div></section>`;
  }).join('');
  const toc = sectionData.map(([theme, entries]) => {
    const count = entries.filter(({ item, key }) => item.id !== lead?.id && key !== leadEvent?.id).length;
    return count ? `<a href="#${slug(theme)}">${esc(theme)} <b>${count}</b></a>` : '';
  }).join('');
  const dayKey=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Paris',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(d.now));
  const shareJson=JSON.stringify(toFacebookText(run, { v3Graph: d.graph, services })).replace(/<\//g,'<\\/');

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
${SERVICES_CSS}
*{box-sizing:border-box}html{background:#d6cec1;color:var(--ink);font:16px/1.52 Georgia,"Times New Roman",serif}
body{max-width:1120px;margin:0 auto;background:var(--paper);min-height:100vh;padding:24px clamp(16px,4vw,54px) 64px}
.topline{display:flex;justify-content:space-between;gap:16px;border-block:1px solid var(--ink);padding:6px 0;font:700 11px/1.2 Arial,sans-serif;text-transform:uppercase;letter-spacing:.12em}
.mast{text-align:center;padding:17px 0 12px;border-bottom:5px double var(--ink)}
.brand-mark{width:48px;height:48px;display:block;margin:0 auto 8px;border-radius:10px;object-fit:cover}
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
.lead-photo{grid-column:1/-1;margin:0 0 4px;overflow:hidden;background:#ddd;aspect-ratio:16/7}
.lead-photo img,.story-photo img{display:block;width:100%;height:100%;object-fit:cover}
.story-photo{margin:0 0 9px;overflow:hidden;background:#ddd;aspect-ratio:16/9}
.lead-side{border-left:1px solid var(--rule);padding-left:20px}
.lead-side strong{display:block;font:800 12px Arial,sans-serif;text-transform:uppercase;color:var(--red);margin-bottom:8px}
.lead-side p{color:var(--muted);margin:0 0 12px}
.theme{margin:30px 0 0;break-inside:avoid}
.theme>h2{font:900 30px/1 Georgia,serif;border-block:3px solid var(--ink);padding:7px 0;margin:0 0 13px}
.theme>h2 span{float:right;font:700 12px Arial,sans-serif;color:var(--muted);margin-top:9px}
.columns{columns:2 330px;column-gap:28px;column-rule:1px solid var(--rule)}
.story{break-inside:avoid;padding:0 0 16px;margin:0 0 16px;border-bottom:1px solid var(--rule)}
.story-meta{display:flex;gap:9px;flex-wrap:wrap;align-items:center;color:var(--red);font:700 10px Arial,sans-serif;text-transform:uppercase;letter-spacing:.04em}
.story-meta .multi{border:1px solid var(--red);padding:2px 5px;text-decoration:none;color:var(--red)}
.edition-stats{display:grid;grid-template-columns:repeat(4,1fr);gap:1px;background:var(--ink);border:1px solid var(--ink);margin:0 0 20px}.edition-stats div{background:var(--cream);padding:10px;text-align:center;font:700 11px Arial,sans-serif;text-transform:uppercase}.edition-stats b{display:block;font:900 24px Georgia,serif;color:var(--red)}
.niko-note{margin:22px 0 28px;border:3px double var(--ink);padding:16px 20px;background:var(--cream);position:relative}.niko-note:before{content:'N';position:absolute;right:14px;top:-8px;font:900 74px/1 Georgia,serif;color:rgba(152,42,32,.08)}.niko-note h2{font:900 25px/1 Georgia,serif;margin:3px 0 8px}.niko-note p{font:italic 18px/1.5 Georgia,serif;margin:0;max-width:850px}.satire{margin:34px 0;padding:26px clamp(18px,4vw,42px);background:#171512;color:#fbf7ed;border-top:7px double #fbf7ed;border-bottom:7px double #fbf7ed}.satire .kicker{color:#e4a69c}.satire h2{font:900 clamp(34px,5vw,58px)/.98 Georgia,serif;letter-spacing:-.035em;margin:7px 0 10px;max-width:900px}.satire .satire-deck{font:italic 18px/1.45 Georgia,serif;color:#d8d0c3;max-width:820px;margin:0 0 20px}.satire .satire-body{columns:2 340px;column-gap:34px}.satire .satire-body p{font-size:17px;line-height:1.62;margin:0 0 16px;break-inside:avoid}.satire .satire-meta{display:flex;gap:12px;flex-wrap:wrap;align-items:center;border-top:1px solid #5c554d;padding-top:13px;margin-top:8px;font:700 10px Arial,sans-serif;text-transform:uppercase;letter-spacing:.06em;color:#d8d0c3}.satire .satire-meta a{color:#fbf7ed}.satire .satire-label{border:1px solid #e4a69c;color:#e4a69c;padding:3px 6px}
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
@media(max-width:720px){.satire .satire-body{columns:1}.lead{grid-template-columns:1fr}.lead-side{border-left:0;border-top:1px solid var(--rule);padding:12px 0 0}.game-grid{grid-template-columns:1fr}.game.wide{grid-column:auto}.columns{columns:1}.topline{font-size:9px}.edition-stats{grid-template-columns:repeat(2,1fr)}}
@page{size:A4;margin:11mm 10mm 13mm}
@media print{
  *{-webkit-print-color-adjust:exact;print-color-adjust:exact}
  html{background:#fff;font-size:10pt}body{max-width:none;padding:0;background:#fff;line-height:1.36}
  .actions,.toc,.toast{display:none!important}.mast{padding:4mm 0 3mm}.satire{break-inside:avoid;background:#fff;color:#000;border-color:#000;padding:5mm}.satire .kicker,.satire .satire-label{color:#000;border-color:#000}.satire .satire-deck,.satire .satire-meta{color:#333}.satire .satire-body{columns:2}.satire .satire-meta a{color:#000}.brand-mark{width:12mm;height:12mm;margin-bottom:2mm}.edition-stats{margin-bottom:4mm}.niko-note{break-inside:avoid;padding:4mm;margin:5mm 0}
  h1{font-size:38pt;line-height:.88}.deck{font-size:9.5pt}.topline{font-size:7.5pt}
  .lead{gap:5mm;padding:4mm 0 5mm}.lead h2{font-size:27pt}.lead .summary{font-size:11pt;line-height:1.4}.lead-photo{max-height:62mm;aspect-ratio:16/7}
  .theme{break-inside:auto;margin-top:6mm}.theme>h2{font-size:18pt;padding:2mm 0;margin-bottom:3mm}
  .columns{columns:initial;display:grid;grid-template-columns:1fr 1fr;column-gap:7mm;column-rule:0}
  .story{break-inside:avoid;page-break-inside:avoid;padding-bottom:3mm;margin-bottom:3mm}.story h3{font-size:13pt}.story p{font-size:9pt;line-height:1.35}.story-photo{height:31mm;aspect-ratio:auto}
  .games{page-break-before:always;margin-top:0;padding-top:4mm}.game{break-inside:avoid;page-break-inside:avoid}
  footer{margin-top:7mm;font-size:7.5pt}a{color:#000!important;text-decoration:none!important}
}
</style>
</head><body>
<div class="topline"><span>Loire-Atlantique · Pays de Châteaubriant</span><span>Édition automatique · ${esc(TIME.format(new Date(d.now)))}</span></div>
<header class="mast">
  <img class="brand-mark" src="icons/icon-192.png" alt="Radar 44" width="48" height="48">
  <div class="kicker">Toute l’actualité régionale des dernières 24 heures</div>
  <h1>${esc(title)}</h1>
  <p class="deck">${esc(DATE.format(new Date(d.now)))} · ${d.items.length} articles regroupés en ${d.graph.stats.events} sujets</p>
  <div class="actions">
    <a href="${esc(home)}">← Radar en direct</a>
    <a href="v3/">◎ Événements V3</a>
    <button type="button" class="primary" id="copy">Copier pour Facebook</button>
    <button type="button" id="share">Partager</button>
    <button type="button" id="pdf">Exporter PDF</button>
    <a href="${esc(facebookUrl)}" download>Texte Facebook</a>
    ${satire ? '<a href="#billet-niko">Billet satirique ↓</a>' : ''}
    <a href="#jeux">Jeux du jour ↓</a>
  </div>
</header>
<nav class="toc" aria-label="Sommaire">${toc}</nav>
<section class="edition-stats" aria-label="Indicateurs de l'édition"><div><b>${d.graph.stats.events}</b>sujets</div><div><b>${d.graph.stats.multiSourceEvents}</b>multi-sources</div><div><b>${d.graph.stats.media}</b>médias</div><div><b>${d.graph.stats.journalists}</b>signatures</div></section>
${servicesPanel(services)}
${lead ? `<section class="lead">${storyPhoto(lead, "lead-photo", true)}<div><div class="kicker">À la une</div><h2><a href="${esc(lead.url)}" target="_blank" rel="noopener">${esc(lead.title)}</a></h2><p class="summary">${esc(lead.summary || 'Retrouvez l’article complet auprès de la source originale.')}</p></div><aside class="lead-side"><strong>${esc(themeFor(lead))}</strong><p>${esc(mediaFor(lead))}${journalistFor(lead) ? ' · ' + esc(journalistFor(lead)) : ''}</p><p>Publié à ${esc(TIME.format(new Date(lead.publishedAt)))}</p>${eventFor(lead)?.multiSource ? `<p><a href="v3/#${esc(eventFor(lead).id)}">${eventFor(lead).sourceCount} sources suivent ce sujet →</a></p>` : ''}<a href="${esc(lead.url)}" target="_blank" rel="noopener">Lire la source →</a></aside></section>` : ''}
<aside class="niko-note"><div class="kicker">Chronique légère</div><h2>La note de Niko</h2><p>${esc(note)}</p></aside>
${satire ? `<section class="satire" id="billet-niko"><div class="kicker">Le billet satirique du jour</div><h2>${esc(satire.headline)}</h2><p class="satire-deck">${esc(satire.deck)}</p><div class="satire-body">${satire.paragraphs.map(p=>`<p>${esc(p)}</p>`).join('')}</div><div class="satire-meta"><span class="satire-label">Satire · ${satire.readMinutes} min</span><span>${esc(satire.theme)}</span><a href="${esc(satire.sourceUrl)}" target="_blank" rel="noopener">Point de départ factuel : ${esc(satire.sourceTitle)} →</a></div></section>` : ''}
<main>${sections || '<p class="empty">Aucune information régionale des dernières 24 heures pour cette édition.</p>'}</main>
${toGamesHTML(dayKey)}
<footer>Le Quotidien du Radar 44 est une édition automatique de veille. Les titres, extraits et liens renvoient vers leurs sources d’origine. Les données pratiques proviennent de services ouverts ou officiels et peuvent être temporairement indisponibles. « La note de Niko » est une touche humoristique générée à partir des thèmes de l’édition et désactivée sur les sujets graves. Le « billet satirique du jour » est une chronique clairement séparée de l’information factuelle ; il ne sélectionne ni sujets graves, ni affaires judiciaires, ni santé, ni politique. Jeux générés localement pour cette édition.</footer>
<script>
(function(){
  var text=${shareJson};
  var copy=document.getElementById('copy'),share=document.getElementById('share'),pdf=document.getElementById('pdf');
  function toast(t){var x=document.createElement('div');x.className='toast';x.textContent=t;document.body.appendChild(x);setTimeout(function(){x.remove();},2200);}
  copy.addEventListener('click',async function(){try{await navigator.clipboard.writeText(text);toast('Texte Facebook copié');}catch(e){toast('Copie non disponible');}});
  share.addEventListener('click',async function(){if(navigator.share){try{await navigator.share({title:'Le Quotidien du Radar 44',text:text,url:location.href});}catch(e){}}else{try{await navigator.clipboard.writeText(text);toast('Texte copié : colle-le dans Facebook');}catch(e){toast('Partage non disponible');}}});
  var oldTitle=document.title;
  async function exportPdf(){
    if(!pdf)return; pdf.disabled=true; toast('Préparation du PDF…');
    var imgs=[].slice.call(document.querySelectorAll('.lead-photo img,.story-photo img'));
    imgs.forEach(function(img){img.loading='eager';try{img.fetchPriority='high';}catch(e){}});
    var ready=Promise.all(imgs.map(function(img){if(img.complete)return Promise.resolve();return new Promise(function(resolve){img.addEventListener('load',resolve,{once:true});img.addEventListener('error',resolve,{once:true});});}));
    await Promise.race([ready,new Promise(function(resolve){setTimeout(resolve,2500);})]);
    document.title='Radar-44-'+new Date().toISOString().slice(0,10);
    window.print();
  }
  if(pdf)pdf.addEventListener('click',exportPdf);
  window.addEventListener('afterprint',function(){document.title=oldTitle;if(pdf)pdf.disabled=false;});
})();
</script>
</body></html>`;
}
