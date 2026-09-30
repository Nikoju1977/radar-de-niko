import { collectDailyServices } from './radar-services.mjs';
import { servicesPanel, servicesFacebookLine } from './radar-services-view.mjs';

let failed=0;
const ok=(n,c)=>{if(!c)failed++;console.log((c?'✓':'✗ ÉCHEC')+' '+n);};
process.on('exit',()=>{if(failed){console.error('\n'+failed+' test(s) en échec');process.exitCode=1;}else console.log('\nservices V4 : tout vert');});

const json = body => ({ok:true,status:200,json:async()=>body,text:async()=>JSON.stringify(body)});
const text = body => ({ok:true,status:200,json:async()=>JSON.parse(body),text:async()=>body});

const fetchImpl=async url=>{
  const u=String(url);
  if(u.includes('api.open-meteo.com/v1/forecast')) return json({
    current:{temperature_2m:15.4,weather_code:2,wind_speed_10m:18,wind_gusts_10m:31,precipitation:0},
    daily:{temperature_2m_min:[9.2],temperature_2m_max:[18.6],precipitation_probability_max:[35],weather_code:[2],wind_gusts_10m_max:[39],sunrise:['2026-09-30T07:58'],sunset:['2026-09-30T19:45']}
  });
  if(u.includes('air-quality-api.open-meteo.com')) return json({current:{european_aqi:27,pm2_5:7,pm10:12,nitrogen_dioxide:8,ozone:64}});
  if(u.includes('vigicrues.gouv.fr')) return json({features:[{properties:{NomEntVigiCru:'Loire aval',NivVigi:2}},{properties:{name:'Autre bassin',NivVigi:1}}]});
  if(u.includes('sncf-siri-lite-situation-exchange')) return text('<Siri><PtSituationElement><Summary>Perturbation TER Nantes Saint-Nazaire</Summary><Description>Retard de 15 minutes</Description></PtSituationElement></Siri>');
  if(u.includes('fluidite-axes-routiers')) return json({total_count:889,results:[{etat:'fluide'}]});
  if(u.includes('prix-des-carburants')) return json({results:[
    {gazole_prix:1.70,e10_prix:1.74,sp98_prix:1.91},
    {gazole_prix:1.68,e10_prix:1.72,sp98_prix:1.89}
  ]});
  throw new Error('route simulée absente: '+u);
};

const now=Date.now();
const run={items:[
  {id:'a',title:'Travaux sur la RN171 à Nozay',summary:'Circulation alternée',url:'https://x.test/a',publishedAt:new Date(now-3600e3).toISOString(),source:'presse'},
  {id:'b',title:'Concert ce soir à Châteaubriant',summary:'Festival',url:'https://x.test/b',publishedAt:new Date(now-2*3600e3).toISOString(),source:'presse'},
  {id:'c',title:'Agent technique à Derval',summary:'Offre emploi',url:'https://x.test/c',publishedAt:new Date(now-3*3600e3).toISOString(),source:'emploi'},
  {id:'d',title:'Coupure d’eau à Châteaubriant',summary:'Service public',url:'https://x.test/d',publishedAt:new Date(now-4*3600e3).toISOString(),source:'presse'},
  {id:'e',title:'TER Nantes Saint-Nazaire perturbé',summary:'Train retardé',url:'https://x.test/e',publishedAt:new Date(now-5*3600e3).toISOString(),source:'presse'}
]};

const s=await collectDailyServices(run,{now,fetchImpl,env:{}});
ok('météo multi-villes',s.weather.status==='ok'&&s.weather.locations.length===3);
ok('soleil inclus dans la météo',Boolean(s.weather.locations[0].sunrise&&s.weather.locations[0].sunset));
ok('air européen',s.air.status==='ok'&&s.air.aqi===27&&s.air.label==='Correct');
ok('vigilance dégrade proprement sans secret',s.vigilance.status==='unconfigured');
ok('Vigicrues connecté',s.floods.status==='ok'&&s.floods.count>=1);
ok('transport SNCF + Radar',s.transport.status==='ok'&&s.transport.alerts.length>=1&&s.transport.radar.length>=1);
ok('trafic détecté',s.traffic.status==='ok'&&s.traffic.items.length>=1);
ok('carburants officiels agrégés',s.fuel.status==='ok'&&s.fuel.fuels.some(x=>x.name==='Gazole'&&x.min===1.68));
ok('agenda / emploi / services',s.agenda.items.length&&s.jobs.items.length&&s.services.items.length);
const html=servicesPanel(s);
ok('rendu Aujourd’hui dans le 44',html.includes('Aujourd’hui dans le 44')&&html.includes('Marées · SHOM')&&html.includes('Carburants 44'));
ok('ligne Facebook météo',/MÉTÉO/.test(servicesFacebookLine(s)));