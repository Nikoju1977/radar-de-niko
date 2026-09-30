import { defineCollector, resetRegistry, validate, runRegistry, toRSS, levels, stableId } from './radar-registry.mjs';
let failed=0;
const ok=(n,c)=>{ if(!c) failed++; console.log((c?'✓':'✗ ÉCHEC')+' '+n); };
process.on('exit', code => {
  if (code && !failed) failed = 1; /* un crash n est jamais tout vert */
  if(failed){ console.error(`\n${failed} test(s) en échec`); process.exitCode=1; } else console.log('\nnoyau : tout vert'); });

// 1. cycle
resetRegistry();
defineCollector({id:'a',name:'A',source:'s',version:'1',requires:['b'],collect:()=>[]});
defineCollector({id:'b',name:'B',source:'s',version:'1',requires:['a'],collect:()=>[]});
ok('détection de cycle', validate().some(e=>e.startsWith('cycle')));

// 2. id dupliqué + champs manquants
resetRegistry();
defineCollector({id:'x',name:'X',source:'s',version:'1',collect:()=>[]});
defineCollector({id:'x',name:'X2',source:'s',version:'1',collect:()=>[]});
defineCollector({id:'y',name:'Y',version:'1',collect:()=>[]});
defineCollector({id:'z',name:'Z',source:'s',version:'1',requires:['inconnu'],collect:()=>[]});
const v=validate();
ok('id dupliqué', v.some(e=>e.includes('dupliqué')));
ok('source manquante', v.some(e=>e.includes('source manquante')));
ok('dépendance inconnue', v.some(e=>e.includes('inconnue')));

// 3. timeout réel
resetRegistry();
defineCollector({id:'lent',name:'Lent',source:'s',version:'1',timeout:150,retries:0,
  collect:()=>new Promise(r=>setTimeout(()=>r([]),2000))});
let t0=Date.now();
let r=await runRegistry({});
ok('timeout déclenché', r.reports[0].status==='error' && /délai/.test(r.reports[0].error));
ok('timeout ne bloque pas ('+(Date.now()-t0)+' ms)', Date.now()-t0 < 900);

// 4. filtre since
resetRegistry();
defineCollector({id:'s1',name:'S1',source:'s',version:'1',collect:()=>[
  {title:'vieux',url:'https://ex.com/1',publishedAt:'2020-01-01T00:00:00Z'},
  {title:'récent',url:'https://ex.com/2',publishedAt:'2026-09-10T00:00:00Z'}]});
r=await runRegistry({since:'2026-01-01'});
ok('filtre --since', r.items.length===1 && r.items[0].title==='récent');

// 5. filtre de collecteurs
resetRegistry();
defineCollector({id:'aa',name:'AA',source:'sa',version:'1',collect:()=>[{title:'a',url:'https://ex.com/a'}]});
defineCollector({id:'bb',name:'BB',source:'sb',version:'1',collect:()=>[{title:'b',url:'https://ex.com/b'}]});
r=await runRegistry({filter:c=>c.id==='aa'});
ok('filtre de collecteurs', r.reports.length===1 && r.reports[0].collector.id==='aa');

// 6. parallélisme réel
resetRegistry();
for (const id of ['p1','p2','p3']) defineCollector({id,name:id,source:'s',version:'1',
  collect:()=>new Promise(res=>setTimeout(()=>res([{title:id,url:'https://ex.com/'+id}]),300))});
t0=Date.now(); await runRegistry({});
const dt=Date.now()-t0;
ok('3 collecteurs en parallèle ('+dt+' ms, séquentiel = 900)', dt<500);

// 7. échappement XML dans le RSS
resetRegistry();
defineCollector({id:'xss',name:'X',source:'s',version:'1',collect:()=>[
  {title:'Titre & <script>alert(1)</script> "guillemets"',url:'https://ex.com/x',publishedAt:'2026-09-01T00:00:00Z',
   summary:'Accessibilité, Commu' + String.fromCharCode(2) + 'nication ' + String.fromCharCode(0xD800)}]});
r=await runRegistry({});
const xml=toRSS(r.items);
ok('échappement XML', !xml.includes('<script>') && xml.includes('&amp;') && xml.includes('&lt;script&gt;'));
ok('caractères interdits XML supprimés',
   !xml.includes(String.fromCharCode(2)) && !xml.includes(String.fromCharCode(0xD800)));

// 8. date invalide
resetRegistry();
defineCollector({id:'bad',name:'B',source:'s',version:'1',collect:()=>[
  {title:'t',url:'https://ex.com/t',publishedAt:'pas-une-date'}]});
r=await runRegistry({});
ok('date invalide remplacée', !isNaN(new Date(r.items[0].publishedAt)));

// 9. enrichisseur orphelin
resetRegistry();
defineCollector({id:'src',name:'S',source:'s',version:'1',collect:()=>[{title:'t',url:'https://ex.com/1'}]});
defineCollector({id:'enr',name:'E',source:'s',version:'1',mode:'enrich',requires:['src'],
  collect:()=>[{id:'inexistant',patch:{tags:['zz']}}]});
r=await runRegistry({});
ok('patch orphelin compté sans crash', r.reports[1].orphan===1);

// 10. enrichisseur : une source morte ne prive pas les autres
resetRegistry();
defineCollector({id:'vivante',name:'V',source:'v',version:'1',collect:()=>[{title:'Nantes',url:'https://ex.com/v'}]});
defineCollector({id:'morte',name:'M',source:'m',version:'1',retries:0,collect:()=>{ throw new Error('clé absente'); }});
defineCollector({id:'tag',name:'T',source:'t',version:'1',mode:'enrich',requires:['vivante','morte'],
  collect:({results})=>(results.get('vivante')?.items??[]).map(i=>({id:i.id,patch:{tags:['44']}}))});
r=await runRegistry({});
ok('enrichissement appliqué malgré une source en échec', r.items[0]?.tags?.includes('44'));

// 11. enrichisseur : dépendance filtrée (--only) ignorée
r=await runRegistry({filter:c=>c.id!=='morte'});
ok('enrichissement appliqué avec dépendance hors sélection', r.items[0]?.tags?.includes('44'));

// 12. enrichisseur : toutes ses sources mortes → skipped, pas d'erreur
resetRegistry();
defineCollector({id:'morte',name:'M',source:'m',version:'1',retries:0,collect:()=>{ throw new Error('x'); }});
defineCollector({id:'tag',name:'T',source:'t',version:'1',mode:'enrich',requires:['morte'],collect:()=>[]});
r=await runRegistry({});
ok('enrichisseur sauté si aucune source vivante', r.reports.find(x=>x.collector.id==='tag').status==='skipped');


// 13. doublons d'un même média avec URLs différentes
resetRegistry();
const duplicateUrlA = 'https://aggregator.test/article-123';
const duplicateUrlB = 'https://media.test/article-123';
defineCollector({id:'agg',name:'Agrégateur',source:'gnews',version:'1',collect:()=>[
  {title:'Derval : une nouvelle boulangerie ouvre ses portes',url:duplicateUrlA,
   media:'Le Journal Test',author:'Le Journal Test',publishedAt:'2026-09-30T08:00:00Z'}]});
defineCollector({id:'direct',name:'Flux direct',source:'presse',version:'1',collect:()=>[
  {title:'Derval : une nouvelle boulangerie ouvre ses portes',url:duplicateUrlB,
   media:'Le Journal Test',author:'Alice Reporter',publishedAt:'2026-09-30T08:05:00Z',
   summary:'Ouverture annoncée ce matin à Derval.'}]});
defineCollector({id:'alias-tag',name:'Alias tag',source:'tag',version:'1',mode:'enrich',requires:['agg','direct'],
  collect:()=>[{id:stableId(duplicateUrlA),patch:{tags:['alias-ok']}}]});
r=await runRegistry({});
ok('déduplication même média malgré deux URLs', r.items.length===1 && r.dupes.length===1);
ok('déduplication conserve la version directe la plus riche',
   r.items[0].source==='presse' && r.items[0].author==='Alice Reporter' && /Ouverture/.test(r.items[0].summary));
ok('patch d\'un URL dupliqué redirigé vers l\'article conservé',
   r.items[0].tags?.includes('alias-ok'));
ok('raison de doublon exposée',
   r.dupes[0]?.reason==='same-media-title');

// 14. deux médias différents couvrant le même événement restent distincts
resetRegistry();
defineCollector({id:'media-a',name:'A',source:'presse',version:'1',collect:()=>[
  {title:'Nantes : le pont Bellevue fermé après un incident',url:'https://a.test/pont',
   media:'Média A',publishedAt:'2026-09-30T08:00:00Z'}]});
defineCollector({id:'media-b',name:'B',source:'presse',version:'1',collect:()=>[
  {title:'Incident à Nantes : le pont Bellevue est fermé',url:'https://b.test/pont',
   media:'Média B',publishedAt:'2026-09-30T08:10:00Z'}]});
r=await runRegistry({});
ok('multi-source préservé : deux médias ne sont pas dédupliqués',
   r.items.length===2 && r.dupes.length===0);
