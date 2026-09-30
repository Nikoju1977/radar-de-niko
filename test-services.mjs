import { collectDailyServices } from './radar-services.mjs';
import { servicesPanel, servicesFacebookLine } from './radar-services-view.mjs';

let failed=0;
const ok=(n,c)=>{if(!c)failed++;console.log((c?'✓':'✗ ÉCHEC')+' '+n);};
process.on('exit',()=>{if(failed){console.error('\n'+failed+' test(s) en échec');process.exitCode=1;}else console.log('\nservices V4 : tout vert');});

const json = body => ({ok:true,status:200,json:async()=>body,text:async()=>JSON.stringify(body)});
const text = body => ({ok:true,status:200,json:async()=>JSON.parse(body),text:async()=>body});

const fetchImpl=async url=>{
  const u=String(url);
  if(u.includes('api.open-meteo.com/v1/meteofrance')) return json({
    current:{temperature_2m:15.4,weather_code:2,wind_speed_10m:18,wind_gusts_10m:31,precipitation:0},
    daily:{temperature_2m_min:[9.2],temperature_2m_max:[18.6],precipitation_sum:[3.4],weather_code:[2],wind_gusts_10m_max:[39],sunrise:['2026-09-30T07:58'],sunset:['2026-09-30T19:45']}
  });
  if(u.includes('air-quality-api.open-meteo.com')) return json({current:{european_aqi:27,pm2_5:7,pm10:12,nitrogen_dioxide:8,ozone:64}});
  if(u.includes('marine-api.open-meteo.com')) return json({hourly:{
    time:['2026-09-30T00:00','2026-09-30T01:00','2026-09-30T02:00','2026-09-30T03:00','2026-09-30T04:00','2026-09-30T05:00','2026-09-30T06:00'],
    sea_level_height_msl:[0,1,2,1,0,-1,0]
  }});
  if(u.includes('vigicrues.gouv.fr/services/1/InfoVigiCru.geojson')) return json({features:[
    {properties:{CdEntCru:'ML14',lbentcru:'Loire aval',NivInfViCr:2}},
    {properties:{CdEntCru:'ML15',lbentcru:'Loire estuaire',NivInfViCr:1}},
    {properties:{CdEntCru:'ML18',lbentcru:'Sèvre Nantaise aval',NivInfViCr:1}},
    {properties:{CdEntCru:'BT6',lbentcru:'Vilaine aval',NivInfViCr:1}},
    {properties:{CdEntCru:'XX1',lbentcru:'Bassin hors 44',NivInfViCr:4}}
  ]});
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
ok('météo utilise le couple AROME/ARPEGE',s.weather.locations.every(w=>/AROME \+ ARPEGE/.test(w.provider))&&s.weather.fallbackCount===0);
ok('météo affiche le cumul de pluie',s.weather.locations.every(w=>w.rainMm===3.4));
ok('soleil inclus dans la météo',Boolean(s.weather.locations[0].sunrise&&s.weather.locations[0].sunset));
ok('air européen',s.air.status==='ok'&&s.air.aqi===27&&s.air.label==='Correct');
ok('vigilance dégrade proprement sans secret',s.vigilance.status==='unconfigured');
ok('Vigicrues connecté',s.floods.status==='ok'&&s.floods.count===4&&s.floods.level===2);
ok('Vigicrues limité aux tronçons utiles au 44',s.floods.names.includes('Loire aval')&&s.floods.names.includes('Loire estuaire')&&s.floods.names.includes('Sèvre Nantaise aval')&&s.floods.names.includes('Vilaine aval')&&!s.floods.names.includes('Bassin hors 44'));
ok('transport SNCF + Radar',s.transport.status==='ok'&&s.transport.alerts.length>=1&&s.transport.radar.length>=1);
ok('trafic détecté',s.traffic.status==='ok'&&s.traffic.items.length>=1);
ok('carburants officiels agrégés',s.fuel.status==='ok'&&s.fuel.fuels.some(x=>x.name==='Gazole'&&x.min===1.68));
ok('marées indicatives pour les trois ports',s.tides.status==='ok'&&s.tides.ports.length===3&&s.tides.ports.every(p=>p.extrema.some(e=>e.type==='PM')&&p.extrema.some(e=>e.type==='BM')));
ok('agenda / emploi / services',s.agenda.items.length&&s.jobs.items.length&&s.services.items.length);
const html=servicesPanel(s);
ok('rendu Aujourd’hui dans le 44',html.includes('Aujourd’hui dans le 44')&&html.includes('Marées · estimation')&&html.includes('PM')&&html.includes('BM')&&html.includes('horaires officiels SHOM')&&html.includes('Carburants 44'));
ok('ligne Facebook météo',/MÉTÉO/.test(servicesFacebookLine(s)));

const fallbackFetch=async url=>{
  const u=String(url);
  if(u.includes('api.open-meteo.com/v1/meteofrance')) return {ok:false,status:503,json:async()=>({}),text:async()=>''};
  if(u.includes('api.met.no/weatherapi/locationforecast/2.0/compact')) return json({
    properties:{timeseries:[
      {time:'2026-09-30T06:00:00Z',data:{instant:{details:{air_temperature:11,wind_speed:4,wind_speed_of_gust:7}},next_1_hours:{summary:{symbol_code:'partlycloudy_day'},details:{precipitation_amount:0.2}}}},
      {time:'2026-09-30T12:00:00Z',data:{instant:{details:{air_temperature:17,wind_speed:5,wind_speed_of_gust:8}},next_1_hours:{summary:{symbol_code:'rainshowers_day'},details:{precipitation_amount:1.1}}}},
      {time:'2026-09-30T18:00:00Z',data:{instant:{details:{air_temperature:13,wind_speed:3,wind_speed_of_gust:6}},next_1_hours:{summary:{symbol_code:'cloudy'},details:{precipitation_amount:0.4}}}}
    ]}
  });
  return fetchImpl(url);
};
const sf=await collectDailyServices(run,{now,fetchImpl:fallbackFetch,env:{}});
ok('MET Norway prend le relais automatiquement',sf.weather.status==='ok'&&sf.weather.fallbackCount===3&&sf.weather.locations.every(w=>w.fallback&&/MET Norway/.test(w.provider)));
ok('fallback conserve température, vent et pluie',sf.weather.locations.every(w=>w.min===11&&w.max===17&&w.rainMm===1.7&&w.wind>0));
