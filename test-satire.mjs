import { buildSatiricalArticle, chooseSatireSubject } from './radar-satire.mjs';

let failed=0;
const ok=(n,c)=>{if(!c)failed++;console.log((c?'✓':'✗ ÉCHEC')+' '+n);};
process.on('exit',()=>{if(failed){console.error('\n'+failed+' test(s) en échec');process.exitCode=1;}else console.log('\nsatire : tout vert');});

const themeFor=i=>i.theme;
const now=Date.parse('2026-09-30T18:00:00Z');
const items=[
  {id:'grave',theme:'Mobilité & travaux',title:'Accident mortel sur une route',summary:'Une victime',url:'https://x.test/grave',publishedAt:'2026-09-30T16:00:00Z',source:'presse',tags:['44']},
  {id:'politique',theme:'Vie locale',title:'Élection municipale : le maire présente sa liste',summary:'Campagne locale',url:'https://x.test/politique',publishedAt:'2026-09-30T17:00:00Z',source:'presse',tags:['44']},
  {id:'safe',theme:'Mobilité & travaux',title:'RN171 : une déviation mise en place pour des travaux de chaussée',summary:'La circulation est déviée durant le chantier.',url:'https://x.test/safe',publishedAt:'2026-09-30T17:30:00Z',source:'presse',tags:['44'],local:true}
];

const chosen=chooseSatireSubject(items,{themeFor,now});
ok('le billet exclut faits graves et politique',chosen?.item?.id==='safe');

const article=buildSatiricalArticle(items,{themeFor,now});
ok('un article satirique est généré',article&&article.paragraphs.length>=4&&article.readMinutes>=1);
ok('le point de départ factuel est conservé',article.sourceUrl==='https://x.test/safe'&&/RN171/.test(article.sourceTitle));
ok('le texte est substantiel',article.paragraphs.join(' ').split(/\s+/).length>150);
ok('le billet satirise la situation, pas une personne',!/(maire présente sa liste|victime)/i.test(article.paragraphs.join(' ')));

const none=buildSatiricalArticle(items.filter(i=>i.id!=='safe'),{themeFor,now});
ok('aucun billet si seuls des sujets sensibles restent',none===null);
