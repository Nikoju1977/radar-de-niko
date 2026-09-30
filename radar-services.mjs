/**
 * radar-services.mjs — modules "Aujourd'hui dans le 44".
 * Chaque source est indépendante : une panne ne bloque jamais le Quotidien.
 */

const PLACES = [
  { name: 'Châteaubriant', lat: 47.7167, lon: -1.3767 },
  { name: 'Nantes', lat: 47.2184, lon: -1.5536 },
  { name: 'Saint-Nazaire', lat: 47.2735, lon: -2.2137 }
];

const WMO = {
  0:'Ciel clair',1:'Plutôt clair',2:'Éclaircies',3:'Couvert',
  45:'Brouillard',48:'Brouillard givrant',51:'Bruine faible',53:'Bruine',55:'Bruine forte',
  61:'Pluie faible',63:'Pluie',65:'Pluie forte',71:'Neige faible',73:'Neige',75:'Neige forte',
  80:'Averses',81:'Averses',82:'Fortes averses',95:'Orages',96:'Orages avec grêle',99:'Orages avec forte grêle'
};

const VIGI_COLOR = { 1:'Vert', 2:'Jaune', 3:'Orange', 4:'Rouge' };
const VIGI_PHENO = { 1:'Vent',2:'Pluie-inondation',3:'Orages',4:'Crues',5:'Neige-verglas',6:'Canicule',7:'Grand froid',8:'Avalanches',9:'Vagues-submersion' };

const timeoutFetch = async (url, opts={}, ms=9000, fetchImpl=fetch) => {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), ms);
  try { return await fetchImpl(url, { ...opts, signal: ac.signal }); }
  finally { clearTimeout(timer); }
};

const getJSON = async (url, opts, fetchImpl) => {
  const r = await timeoutFetch(url, opts, 9000, fetchImpl);
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
};

const getText = async (url, opts, fetchImpl) => {
  const r = await timeoutFetch(url, opts, 9000, fetchImpl);
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.text();
};

const safe = async (name, fn) => {
  try { return { status:'ok', ...(await fn()) }; }
  catch (e) { return { status:'error', name, error:String(e?.message || e) }; }
};

function dailyAt(data, key) {
  return Array.isArray(data?.daily?.[key]) ? data.daily[key][0] : null;
}

const METNO_SYMBOLS = {
  clearsky_day:'Ciel clair', clearsky_night:'Ciel clair',
  fair_day:'Plutôt clair', fair_night:'Plutôt clair',
  partlycloudy_day:'Éclaircies', partlycloudy_night:'Éclaircies',
  cloudy:'Couvert', fog:'Brouillard',
  lightrain:'Pluie faible', rain:'Pluie', heavyrain:'Pluie forte',
  lightrainshowers_day:'Averses faibles', lightrainshowers_night:'Averses faibles',
  rainshowers_day:'Averses', rainshowers_night:'Averses',
  heavyrainshowers_day:'Fortes averses', heavyrainshowers_night:'Fortes averses',
  lightsnow:'Neige faible', snow:'Neige', heavysnow:'Neige forte',
  sleet:'Pluie et neige', thunderstorm:'Orages'
};

function metNoCondition(code='') {
  const k=String(code).replace(/_polartwilight$/,'_day');
  if (METNO_SYMBOLS[k]) return METNO_SYMBOLS[k];
  if (/thunder/.test(k)) return 'Orages';
  if (/snow/.test(k)) return 'Neige';
  if (/rain|sleet/.test(k)) return /heavy/.test(k) ? 'Pluie forte' : 'Pluie';
  return 'Variable';
}

async function openMeteoFranceFor(place, fetchImpl) {
  const u = new URL('https://api.open-meteo.com/v1/meteofrance');
  u.searchParams.set('latitude', place.lat);
  u.searchParams.set('longitude', place.lon);
  u.searchParams.set('timezone', 'Europe/Paris');
  u.searchParams.set('models', 'meteofrance_seamless');
  u.searchParams.set('forecast_days', '1');
  u.searchParams.set('current', 'temperature_2m,weather_code,wind_speed_10m,wind_gusts_10m,precipitation');
  u.searchParams.set('daily', 'temperature_2m_min,temperature_2m_max,precipitation_sum,weather_code,wind_gusts_10m_max,sunrise,sunset');
  const j = await getJSON(u, {}, fetchImpl);
  if (!Number.isFinite(Number(j.current?.temperature_2m))) throw new Error('Météo-France model data missing');
  return {
    name: place.name,
    temperature: j.current?.temperature_2m ?? null,
    condition: WMO[j.current?.weather_code] ?? 'Variable',
    wind: j.current?.wind_speed_10m ?? null,
    gust: j.current?.wind_gusts_10m ?? dailyAt(j,'wind_gusts_10m_max'),
    min: dailyAt(j,'temperature_2m_min'),
    max: dailyAt(j,'temperature_2m_max'),
    rainRisk: null,
    rainMm: dailyAt(j,'precipitation_sum'),
    sunrise: dailyAt(j,'sunrise'),
    sunset: dailyAt(j,'sunset'),
    provider:'Open-Meteo / Météo-France AROME + ARPEGE'
  };
}

async function metNorwayFor(place, fetchImpl) {
  const u = new URL('https://api.met.no/weatherapi/locationforecast/2.0/compact');
  u.searchParams.set('lat', Number(place.lat).toFixed(4));
  u.searchParams.set('lon', Number(place.lon).toFixed(4));
  const j = await getJSON(u, {
    headers:{
      'User-Agent':'Radar44/5.0 (+https://nikoju1977.github.io/radar-de-niko/)',
      accept:'application/json'
    }
  }, fetchImpl);
  const rows=j?.properties?.timeseries ?? [];
  if (!rows.length) throw new Error('MET Norway forecast empty');
  const first=rows[0];
  const details=first?.data?.instant?.details ?? {};
  const symbol=first?.data?.next_1_hours?.summary?.symbol_code
    ?? first?.data?.next_6_hours?.summary?.symbol_code
    ?? '';
  const dayFmt=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Paris',year:'numeric',month:'2-digit',day:'2-digit'});
  const today=dayFmt.format(new Date(first.time));
  const dayRows=rows.filter(r=>dayFmt.format(new Date(r.time))===today);
  const temps=dayRows.map(r=>Number(r?.data?.instant?.details?.air_temperature)).filter(Number.isFinite);
  const precip=dayRows.map(r=>Number(r?.data?.next_1_hours?.details?.precipitation_amount)).filter(Number.isFinite);
  const windMs=Number(details.wind_speed);
  const gustMs=Number(details.wind_speed_of_gust);
  return {
    name:place.name,
    temperature:Number.isFinite(Number(details.air_temperature))?Number(details.air_temperature):null,
    condition:metNoCondition(symbol),
    wind:Number.isFinite(windMs)?windMs*3.6:null,
    gust:Number.isFinite(gustMs)?gustMs*3.6:(Number.isFinite(windMs)?windMs*3.6:null),
    min:temps.length?Math.min(...temps):null,
    max:temps.length?Math.max(...temps):null,
    rainRisk:null,
    rainMm:precip.length?Math.round(precip.reduce((a,b)=>a+b,0)*10)/10:null,
    sunrise:null,
    sunset:null,
    provider:'MET Norway Locationforecast 2.0'
  };
}

async function weatherFor(place, fetchImpl) {
  try { return await openMeteoFranceFor(place, fetchImpl); }
  catch (primaryError) {
    const fallback=await metNorwayFor(place, fetchImpl);
    fallback.fallback=true;
    fallback.primaryError=String(primaryError?.message || primaryError);
    return fallback;
  }
}

async function collectWeather(fetchImpl) {
  const locations=await Promise.all(PLACES.map(p => weatherFor(p, fetchImpl)));
  const fallbackCount=locations.filter(x=>x.fallback).length;
  return {
    locations,
    source:fallbackCount
      ? 'Open-Meteo / Météo-France AROME + ARPEGE, secours MET Norway'
      : 'Open-Meteo / Météo-France AROME + ARPEGE',
    fallbackCount
  };
}

function aqiLabel(v) {
  if (!Number.isFinite(Number(v))) return 'Indisponible';
  v=Number(v);
  if (v<=20) return 'Bon';
  if (v<=40) return 'Correct';
  if (v<=60) return 'Moyen';
  if (v<=80) return 'Mauvais';
  if (v<=100) return 'Très mauvais';
  return 'Extrêmement mauvais';
}

async function collectAir(fetchImpl) {
  const place = PLACES[0];
  const u = new URL('https://air-quality-api.open-meteo.com/v1/air-quality');
  u.searchParams.set('latitude', place.lat);
  u.searchParams.set('longitude', place.lon);
  u.searchParams.set('timezone', 'Europe/Paris');
  u.searchParams.set('current', 'european_aqi,pm2_5,pm10,nitrogen_dioxide,ozone');
  const j = await getJSON(u, {}, fetchImpl);
  const aqi = Number(j.current?.european_aqi);
  return { place:place.name, aqi:Number.isFinite(aqi)?aqi:null, label:aqiLabel(aqi), pm25:j.current?.pm2_5 ?? null, pm10:j.current?.pm10 ?? null, source:'CAMS via Open-Meteo' };
}

async function collectVigilance(fetchImpl, env) {
  const token = env.METEOFRANCE_API_TOKEN || env.METEO_FRANCE_TOKEN;
  if (!token) return { status:'unconfigured', source:'Météo-France', message:'Ajouter METEOFRANCE_API_TOKEN pour activer le niveau départemental.' };
  const url='https://public-api.meteofrance.fr/public/DPVigilance/v1/cartevigilance/encours';
  const j=await getJSON(url,{headers:{Authorization:'Bearer '+token,accept:'application/json'}},fetchImpl);
  const periods=j?.product?.periods ?? [];
  const today=periods.find(p=>p.echeance==='J') ?? periods[0];
  const domains=today?.timelaps?.domain_ids ?? [];
  const dep=domains.find(d=>String(d.domain_id)==='44');
  if(!dep) return { status:'ok', color:'Vert', colorId:1, phenomena:[], source:'Météo-France' };
  const phenomena=(dep.phenomenon_items ?? []).map(p=>({
    name:VIGI_PHENO[Number(p.phenomenon_id)] ?? ('Phénomène '+p.phenomenon_id),
    color:VIGI_COLOR[Number(p.phenomenon_max_color_id)] ?? 'Inconnu',
    colorId:Number(p.phenomenon_max_color_id)||1
  })).filter(p=>p.colorId>1);
  return { status:'ok', color:VIGI_COLOR[Number(dep.max_color_id)] ?? 'Vert', colorId:Number(dep.max_color_id)||1, phenomena, source:'Météo-France' };
}

const VIGICRUES_44_CODES = new Set(['ML14','ML15','ML18','BT6']);

async function collectFloods(fetchImpl) {
  // La documentation Vigicrues v1.1 référence InfoVigiCru via /services/1/.
  // Le serveur redirige actuellement vers /services/InfoVigiCru.geojson.
  const j=await getJSON('https://www.vigicrues.gouv.fr/services/1/InfoVigiCru.geojson',{},fetchImpl);
  const relevant=(j.features ?? [])
    .filter(f=>VIGICRUES_44_CODES.has(String(f?.properties?.CdEntCru ?? '')))
    .map(f=>{
      const p=f.properties ?? {};
      const level=Number(p.NivInfViCr ?? 1);
      return {
        code:String(p.CdEntCru ?? ''),
        name:p.lbentcru ?? p.LbEntVigiCru ?? p.name ?? 'Tronçon',
        level:Number.isFinite(level)?level:1,
        color:VIGI_COLOR[Number.isFinite(level)?level:1] ?? 'Vert'
      };
    });
  const max=relevant.length ? Math.max(...relevant.map(x=>x.level)) : 1;
  return {
    level:max,
    color:VIGI_COLOR[max] ?? 'Vert',
    count:relevant.length,
    names:relevant.map(x=>x.name),
    sections:relevant,
    source:'Vigicrues',
    url:'https://www.vigicrues.gouv.fr/'
  };
}

const XML_TEXT = s => String(s??'').replace(/<[^>]+>/g,' ').replace(/&amp;/g,'&').replace(/&#39;/g,"'").replace(/&quot;/g,'"').replace(/\s+/g,' ').trim();

async function collectTransport(fetchImpl, run) {
  const localRx=/(Nantes|Saint-Nazaire|Châteaubriant|Ancenis|Redon|Savenay|Clisson|Loire-Atlantique)/i;
  const alerts=[];
  try {
    const xml=await getText('https://proxy.transport.data.gouv.fr/resource/sncf-siri-lite-situation-exchange',{},fetchImpl);
    const blocks=xml.match(/<PtSituationElement\b[\s\S]*?<\/PtSituationElement>/gi) ?? [];
    for(const b of blocks){
      const text=XML_TEXT(b);
      if(localRx.test(text)) alerts.push(text.slice(0,260));
      if(alerts.length>=5) break;
    }
  } catch {}
  const radar=(run.items ?? []).filter(i=>/(train|ter\b|gare|bus\b|car\b|tram|naolib|aléop|aleop)/i.test([i.title,i.summary].join(' '))).slice(0,5);
  return { alerts, radar, source:'transport.data.gouv.fr / SNCF + Radar44' };
}

async function collectTraffic(fetchImpl, run) {
  const u='https://data.nantesmetropole.fr/api/explore/v2.1/catalog/datasets/244400404_fluidite-axes-routiers-nantes-metropole/records?limit=1';
  let total=null;
  try { const j=await getJSON(u,{},fetchImpl); total=j.total_count ?? j.total ?? null; } catch {}
  const items=(run.items ?? []).filter(i=>/(circulation|trafic|bouchon|route|rn\s?\d+|déviation|deviation|pont|travaux routiers)/i.test([i.title,i.summary].join(' '))).slice(0,5);
  return { nantesTrackedSegments:total, items, source:'Nantes Métropole Open Data + Radar44' };
}

const num = v => {
  const n=Number(String(v??'').replace(',','.'));
  return Number.isFinite(n) && n>0 && n<5 ? n : null;
};


const TIDE_PORTS = [
  {name:'Saint-Nazaire',lat:47.258,lon:-2.200},
  {name:'Pornic',lat:47.105,lon:-2.092},
  {name:'Le Croisic',lat:47.294,lon:-2.513}
];

function tideExtrema(times, values) {
  const out=[];
  for(let i=1;i<values.length-1;i++){
    const a=Number(values[i-1]), b=Number(values[i]), c=Number(values[i+1]);
    if(![a,b,c].every(Number.isFinite)) continue;
    if(b>a && b>c) out.push({type:'PM',time:times[i],height:b});
    if(b<a && b<c) out.push({type:'BM',time:times[i],height:b});
  }
  return out.slice(0,5);
}

async function collectTides(fetchImpl) {
  const ports=[];
  for(const port of TIDE_PORTS){
    const u=new URL('https://marine-api.open-meteo.com/v1/marine');
    u.searchParams.set('latitude',port.lat);
    u.searchParams.set('longitude',port.lon);
    u.searchParams.set('hourly','sea_level_height_msl');
    u.searchParams.set('timezone','Europe/Paris');
    u.searchParams.set('forecast_days','1');
    const j=await getJSON(u,{},fetchImpl);
    ports.push({name:port.name,extrema:tideExtrema(j.hourly?.time??[],j.hourly?.sea_level_height_msl??[])});
  }
  return {
    ports,
    officialUrl:'https://maree.shom.fr/',
    source:'Open-Meteo marine (estimation) + SHOM (référence officielle)',
    disclaimer:'Estimation indicative du niveau marin, non adaptée à la navigation. Vérifier les horaires officiels du SHOM.'
  };
}

async function collectFuel(fetchImpl) {
  const u=new URL('https://data.economie.gouv.fr/api/explore/v2.1/catalog/datasets/prix-des-carburants-en-france-flux-instantane-v2/records');
  u.searchParams.set('where','code_departement="44"');
  u.searchParams.set('limit','100');
  const j=await getJSON(u,{},fetchImpl);
  const rows=j.results ?? j.records ?? [];
  const fuels=[['Gazole','gazole_prix'],['E10','e10_prix'],['SP95','sp95_prix'],['SP98','sp98_prix'],['E85','e85_prix'],['GPLc','gplc_prix']];
  const stats=[];
  for(const [name,key] of fuels){
    const vals=rows.map(r=>num((r.fields??r)[key])).filter(Boolean);
    if(vals.length) stats.push({name,min:Math.min(...vals),avg:vals.reduce((a,b)=>a+b,0)/vals.length,count:vals.length});
  }
  return { stations:rows.length, fuels:stats, source:'DGCCRF / prix-carburants.gouv.fr' };
}

function recent(run, rx, now, max=6) {
  return (run.items ?? []).filter(i=>{
    const t=Date.parse(i.publishedAt);
    return Number.isFinite(t) && t>=now-36*3600e3 && rx.test([i.title,i.summary,i.author,i.media].filter(Boolean).join(' '));
  }).slice(0,max);
}

function collectLocal(run, now) {
  const jobs=(run.items ?? []).filter(i=>i.source==='emploi' && Date.parse(i.publishedAt)>=now-7*8640e4).slice(0,6);
  const agenda=recent(run,/(agenda|concert|festival|spectacle|expo|exposition|fête|fete|atelier|marché|marche|sortie)/i,now);
  const services=recent(run,/(fermeture|travaux|coupure|eau|électricité|electricite|déchet|dechet|service public|mairie|préfecture|prefecture)/i,now);
  return { jobs, agenda, services };
}

export async function collectDailyServices(run, { now=Date.now(), fetchImpl=fetch, env=process.env }={}) {
  const [weather,air,vigilance,floods,transport,traffic,fuel,tides]=await Promise.all([
    safe('weather',()=>collectWeather(fetchImpl)),
    safe('air',()=>collectAir(fetchImpl)),
    collectVigilance(fetchImpl,env).catch(e=>({status:'error',name:'vigilance',error:String(e.message||e)})),
    safe('floods',()=>collectFloods(fetchImpl)),
    safe('transport',()=>collectTransport(fetchImpl,run)),
    safe('traffic',()=>collectTraffic(fetchImpl,run)),
    safe('fuel',()=>collectFuel(fetchImpl)),
    safe('tides',()=>collectTides(fetchImpl))
  ]);
  const local=collectLocal(run,now);
  return {
    generatedAt:new Date(now).toISOString(),
    weather, air, vigilance, floods, transport, traffic, fuel, tides,
    agenda:{ status:'ok', items:local.agenda },
    jobs:{ status:'ok', items:local.jobs },
    services:{ status:'ok', items:local.services }
  };
}

export const servicesJSON = services => JSON.stringify(services,null,2)+'\n';
