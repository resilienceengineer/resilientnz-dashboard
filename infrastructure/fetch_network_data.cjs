/* Fetch public Auckland utility geometry for the prototype. No credentials used. */
const fs = require('node:fs');
const path = require('node:path');
const outDir = path.join(__dirname, 'data');
const cacheDir = path.join(__dirname, '.network-cache');
async function json(url, options = {}) {
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(45000) });
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${url.split('?')[0]}`);
  const value = await response.json();
  if (value.error) throw new Error(JSON.stringify(value.error));
  return value;
}
async function inspect() {
  const sources = {
    transpower: 'https://transpower.maps.arcgis.com/sharing/rest/content/items/2c31897a0a674b22b646ddd9f3caa6b5/data?f=json',
    watercare: 'https://watercare.maps.arcgis.com/sharing/rest/content/items/f446779c3ede43b9a1890208a4810a69/data?f=json',
    powerLines: 'https://services3.arcgis.com/AkUq3zcWf7TVqyR9/ArcGIS/rest/services/TransmissionLines/FeatureServer/0?f=json',
    powerSites: 'https://services3.arcgis.com/AkUq3zcWf7TVqyR9/ArcGIS/rest/services/Sites/FeatureServer/0?f=json',
    waterLayers: 'https://wslgis.water.co.nz/arcgis/rest/services/Public/Network/MapServer/layers?f=json'
  };
  fs.mkdirSync(cacheDir, { recursive: true });
  const results = await Promise.allSettled(Object.entries(sources).map(async ([name, url]) => {
    const data = await json(url);
    fs.writeFileSync(path.join(cacheDir, `${name}-map-config.json`), JSON.stringify(data, null, 2));
    const layers = list => list?.map(l => ({ title: l.title, url: l.url, id: l.id, layers: layers(l.layers) }));
    console.log(name, JSON.stringify({ map: data.map, layers: data.layers?.map(l => ({ id:l.id, name:l.name, type:l.geometryType, fields:l.fields?.map(f=>f.name) })) || layers(data.operationalLayers), fields: data.fields?.map(f => ({ name: f.name, alias: f.alias })), copyrightText: data.copyrightText }));
  }));
  results.forEach((r, i) => { if (r.status === 'rejected') console.log(Object.keys(sources)[i], r.reason.message); });
}
const bbox = [174.55, -37.05, 175.00, -36.70];
const waterBase = 'https://wslgis.water.co.nz/arcgis/rest/services/Public/Network/MapServer';
const powerBase = 'https://services3.arcgis.com/AkUq3zcWf7TVqyR9/ArcGIS/rest/services';
const specs = [
  { id:'water-mains', provider:'Watercare', sector:'Water and wastewater', url:`${waterBase}/2`,
    where:"STATUS IN ('OP','OPNV') AND NOM_DIA_MM >= 300", fields:'OBJECTID,GIS_ID,NOM_DIA_MM,STATUS', kind:'water main', pathway:'water-flexible' },
  { id:'wastewater-mains', provider:'Watercare', sector:'Water and wastewater', url:`${waterBase}/9`,
    where:"STATUS IN ('OP','OPNV') AND NOM_DIA_MM >= 450", fields:'OBJECTID,GIS_ID,NOM_DIA_MM,STATUS', kind:'wastewater main', pathway:'water-inflow' },
  ...[[3,'water-pumps','water pump station','water-pumps'],[4,'reservoirs','reservoir','water-storage'],
    [5,'water-treatment','water treatment plant','water-pumps'],[10,'wastewater-pumps','wastewater pump station','water-pumps'],
    [11,'wastewater-treatment','wastewater treatment plant','water-inflow']].map(([layer,id,kind,pathway]) => ({
      id, provider:'Watercare', sector:'Water and wastewater', url:`${waterBase}/${layer}`,
      where:"STATUS IN ('OP','OPNV')", fields:'OBJECTID,GIS_ID,FAC_DESC,STATUS', kind, pathway, point:true })),
  { id:'transmission-lines', provider:'Transpower', sector:'Power infrastructure', url:`${powerBase}/TransmissionLines/FeatureServer/0`,
    where:'1=1', fields:'OBJECTID,MXLOCATION,description,type,status,designvolt', kind:'transmission line', pathway:'power-feeders' },
  { id:'substations', provider:'Transpower', sector:'Power infrastructure', url:`${powerBase}/Sites/FeatureServer/0`,
    where:'1=1', fields:'OBJECTID,MXLOCATION,description,type,status', kind:'substation', pathway:'power-substations', point:true }
];
function urlFor(spec, extra) {
  return spec.url + '/query?' + new URLSearchParams({ f:'json', where:spec.where,
    geometry:bbox.join(','), geometryType:'esriGeometryEnvelope', inSR:'4326', spatialRel:'esriSpatialRelIntersects', ...extra });
}
function clipSegment(a, b) {
  let start=0, end=1;
  const dx=b[0]-a[0], dy=b[1]-a[1];
  const p=[-dx,dx,-dy,dy], q=[a[0]-bbox[0],bbox[2]-a[0],a[1]-bbox[1],bbox[3]-a[1]];
  for (let i=0;i<4;i++) {
    if (p[i]===0) { if(q[i]<0) return null; }
    else { const t=q[i]/p[i]; if(p[i]<0) start=Math.max(start,t); else end=Math.min(end,t); if(start>end) return null; }
  }
  return [[a[0]+start*dx,a[1]+start*dy],[a[0]+end*dx,a[1]+end*dy]];
}
function clipLine(line) {
  const parts=[]; let part=[];
  for (let i=1;i<line.length;i++) {
    const segment=clipSegment(line[i-1],line[i]);
    if (!segment) { if(part.length>1) parts.push(part); part=[]; continue; }
    const [a,b]=segment, previous=part.at(-1);
    if(previous && Math.hypot(previous[0]-a[0],previous[1]-a[1])>1e-9) { if(part.length>1) parts.push(part); part=[]; }
    if(!part.length) part.push(a);
    part.push(b);
  }
  if(part.length>1) parts.push(part);
  return parts;
}
function roundCoordinates(c) {
  return typeof c[0]==='number' ? c.slice(0,2).map(v=>+v.toFixed(6)) : c.map(roundCoordinates);
}
function geometryFor(geometry, point) {
  if (!geometry) return null;
  if (point && geometry.type !== 'Point') {
    const positions=geometry.coordinates.flat(geometry.type==='MultiPolygon'?2:1);
    return {type:'Point',coordinates:[positions.reduce((s,c)=>s+c[0],0)/positions.length,positions.reduce((s,c)=>s+c[1],0)/positions.length].map(v=>+v.toFixed(6))};
  }
  if (geometry.type.includes('LineString')) {
    const parts=(geometry.type==='LineString'?[geometry.coordinates]:geometry.coordinates).flatMap(clipLine);
    if(!parts.length) return null;
    return {type:parts.length===1?'LineString':'MultiLineString',coordinates:roundCoordinates(parts.length===1?parts[0]:parts)};
  }
  return {type:geometry.type,coordinates:roundCoordinates(geometry.coordinates)};
}
async function fetchLayer(spec) {
  const cacheFile=path.join(cacheDir,`${spec.id}-snapshot.geojson`);
  if(fs.existsSync(cacheFile) && !process.argv.includes('--refresh')) {
    const cached=JSON.parse(fs.readFileSync(cacheFile,'utf8'));
    console.log(`${spec.id}: ${cached.features.length} cached features`);
    return {spec,features:cached.features};
  }
  const ids=await json(urlFor(spec,{returnIdsOnly:'true'}));
  const checkpointFile=path.join(cacheDir,`${spec.id}-checkpoint.json`);
  const checkpoint=fs.existsSync(checkpointFile) && !process.argv.includes('--refresh') ? JSON.parse(fs.readFileSync(checkpointFile,'utf8')) : {offset:0,features:[],omitted:0};
  const features=checkpoint.features;
  const objectIds=(ids.objectIds||[]).sort((a,b)=>a-b);
  if (objectIds.length>50000) throw new Error(`${spec.id}: unexpectedly large download`);
  let omitted=checkpoint.omitted;
  for (let i=checkpoint.offset;i<objectIds.length;i+=100) {
    const request=urlFor(spec,{f:'json',objectIds:objectIds.slice(i,i+100).join(','),outFields:spec.fields,
      outSR:'4326',returnGeometry:'true'});
    let data;
    try { data=await json(request); }
    catch(error) {
      await new Promise(resolve=>setTimeout(resolve,750));
      try { data=await json(request); }
      catch { omitted+=Math.min(100,objectIds.length-i); console.log(`${spec.id}: omitted unavailable batch ${i}`); data={features:[]}; }
    }
    for(const raw of data.features||[]) {
      const g=raw.geometry;
      const feature={properties:raw.attributes,geometry:!g?null:g.x!==undefined?{type:'Point',coordinates:[g.x,g.y]}:
        g.paths?{type:g.paths.length===1?'LineString':'MultiLineString',coordinates:g.paths.length===1?g.paths[0]:g.paths}:
        g.rings?{type:'Polygon',coordinates:g.rings}:null};
      const p=feature.properties||{};
      if (/decommission|removed|proposed/i.test(p.status||'')) continue;
      const geometry=geometryFor(feature.geometry,spec.point);
      if(!geometry) continue;
      features.push({type:'Feature',geometry,properties:{
        name:p.FAC_DESC||p.description||`${spec.kind} ${p.GIS_ID||p.MXLOCATION||p.OBJECTID}`,
        asset_type:spec.kind, city:'Auckland', source:spec.provider, source_id:String(p.GIS_ID||p.MXLOCATION||p.OBJECTID),
        diameter_mm:p.NOM_DIA_MM||null, voltage:p.designvolt||null, status:p.STATUS||p.status||'',
        pathway:spec.pathway, label:''
      }});
    }
    fs.writeFileSync(checkpointFile,JSON.stringify({offset:i+100,features,omitted}));
  }
  console.log(`${spec.id}: ${features.length} features`);
  fs.writeFileSync(cacheFile,JSON.stringify({type:'FeatureCollection',features}));
  return {spec:{...spec,omitted},features};
}
async function probe() {
  for (const spec of specs.slice(0,2)) {
    const ids=await json(urlFor(spec,{returnIdsOnly:'true'}));
    console.log(spec.id,'IDs',ids.objectIds?.length,ids.objectIdFieldName);
    for(const format of ['geojson','json']) {
      try {
        const d=await json(urlFor(spec,{f:format,objectIds:ids.objectIds.slice(0,5).join(','),outFields:spec.fields,outSR:'4326',returnGeometry:'true'}));
        console.log(format,JSON.stringify({count:d.features?.length,properties:d.features?.[0]?.properties||d.features?.[0]?.attributes,geometryType:d.features?.[0]?.geometry?.type||d.geometryType}));
      } catch(error) { console.log(format,error.message); }
    }
  }
}
async function download() {
  fs.mkdirSync(outDir,{recursive:true});
  fs.mkdirSync(cacheDir,{recursive:true});
  const results=[];
  for(let i=0;i<specs.length;i+=3) results.push(...await Promise.all(specs.slice(i,i+3).map(fetchLayer)));
  const sectors={};
  for(const sector of ['Water and wastewater','Power infrastructure']) {
    const data={type:'FeatureCollection',features:results.filter(r=>r.spec.sector===sector).flatMap(r=>r.features)};
    sectors[sector]=data;
    fs.writeFileSync(path.join(outDir,sector.startsWith('Water')?'auckland-water.geojson':'auckland-power.geojson'),JSON.stringify(data));
  }
  const metadata={city:'Auckland',bbox,retrievedAt:new Date().toISOString(),
    providers:{Watercare:{label:'Watercare Services Limited',url:'https://www.watercare.co.nz/builders-and-developers/tools-fees-and-resources/gis-maps',license:'CC BY 4.0'},
      Transpower:{label:'Transpower New Zealand Limited',url:'https://www.transpower.co.nz/our-work/industry/our-grid/maps-and-gis-data'}},
    layers:results.map(({spec,features})=>({id:spec.id,url:spec.url,filter:spec.where,count:features.length})),
    processing:'Selected operating water mains >=300 mm and wastewater mains >=450 mm. Polygon facility footprints represented by centre points. Linework rounded and clipped to the demo extent. Transmission mapping is not a complete local distribution grid.'};
  fs.writeFileSync(path.join(outDir,'network-sources.json'),JSON.stringify(metadata,null,2));
  fs.writeFileSync(path.join(__dirname,'network_data.js'),'// Public Auckland network snapshots. See data/network-sources.json.\nconst NETWORK_DATA = '+JSON.stringify({Auckland:sectors})+';\nconst NETWORK_META = '+JSON.stringify(metadata)+';\n');
  console.log('Saved Auckland utility snapshots and classic-script bundle.');
}
(process.argv.includes('--probe')?probe():process.argv.includes('--inspect')?inspect():download()).catch(error => { console.error(error.message); process.exitCode = 1; });
