import { useEffect, useRef, useState } from 'react';
import { Map as MarineMap, Marker, NavigationControl, ScaleControl, setWorkerUrl } from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import type { FeatureCollection, Polygon } from 'geojson';
import { ArrowDownToLine, ArrowUpRight, Check, ChevronDown, Layers, MapPin, RotateCcw, Waves, X } from 'lucide-react';

setWorkerUrl(workerUrl);
const directory = '/data/habitat/regional-seabed/';
const fill = 'dmr-fill', line = 'dmr-line', selectedLine = 'dmr-selected';
const centre: [number,number] = [100.8125,13.155];

interface Manifest {
  source: string; fetchedAt: string; featureCount: number; geojsonUrl: string;
  coverage: {radiusKm: number; bboxWgs84: [number,number,number,number]; geometry: Polygon};
  countsByClass: Record<string,number>; classes: Record<string,{nameTh:string;nameEn:string;color:string}>;
  mapScale?: string|null;
  catalogueMetadata?: {catalogueUrl:string;dataUpdatedAt:string;collectionMethod:string;licenseTitle:string};
}
interface SelectedPoint {longitude:number;latitude:number;featureId:string|null}

function downloadedAt(value:string) {
  return new Date(value).toLocaleString('th-TH',{timeZone:'Asia/Bangkok',day:'numeric',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'});
}
function downloadJson(name:string,data:unknown) {
  const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/geo+json;charset=utf-8'}));
  const link=document.createElement('a');link.href=url;link.download=name;link.click();
  window.setTimeout(()=>URL.revokeObjectURL(url),1000);
}

export default function DMRApp() {
  const container=useRef<HTMLDivElement>(null), marker=useRef<Marker|null>(null);
  const [map,setMap]=useState<MarineMap|null>(null),[mapRetry,setMapRetry]=useState(0);
  const [manifest,setManifest]=useState<Manifest|null>(null),[data,setData]=useState<FeatureCollection|null>(null);
  const [loading,setLoading]=useState(true),[dataError,setDataError]=useState(''),[mapError,setMapError]=useState('');
  const [retry,setRetry]=useState(0),[filter,setFilter]=useState('all'),[opacity,setOpacity]=useState(0.65);
  const [visible,setVisible]=useState(true),[selected,setSelected]=useState<SelectedPoint|null>(null);
  const [legendOpen,setLegendOpen]=useState(()=>window.innerWidth>=720),[sourceOpen,setSourceOpen]=useState(false);
  const pointHeading=useRef<HTMLHeadingElement>(null);
  const selectedFeature=data?.features.find(f=>f.properties?.id===selected?.featureId);
  const properties=selectedFeature?.properties;
  const displayedCount=filter==='all'?manifest?.featureCount??0:manifest?.countsByClass[filter]??0;

  useEffect(()=>{
    const controller=new AbortController();setLoading(true);setDataError('');
    void (async()=>{
      const response=await fetch(directory+'dmr-manifest.json',{signal:controller.signal,cache:'no-cache'});
      if(!response.ok)throw new Error('โหลดข้อมูลที่มาของ DMR ไม่สำเร็จ');
      const meta=await response.json() as Manifest;
      if(meta.geojsonUrl!==directory+'dmr-sediment.geojson' || !meta.coverage?.geometry || !meta.classes)
        throw new Error('รายละเอียดชุดข้อมูล DMR ไม่ครบ');
      const geometryResponse=await fetch(meta.geojsonUrl,{signal:controller.signal,cache:'no-cache'});
      if(!geometryResponse.ok)throw new Error('โหลดแผนที่ตะกอน DMR ไม่สำเร็จ');
      const collection=await geometryResponse.json() as FeatureCollection;
      if(collection.type!=='FeatureCollection' || !Array.isArray(collection.features) || collection.features.length!==meta.featureCount ||
        new Set(collection.features.map(f=>f.properties?.id)).size!==meta.featureCount)
        throw new Error('ขอบเขตข้อมูล DMR ไม่ครบหรือซ้ำกัน');
      if(!controller.signal.aborted){setManifest(meta);setData(collection);setSelected(null);setFilter('all');}
    })().catch(error=>{if(!controller.signal.aborted)setDataError(error instanceof Error?error.message:'โหลดข้อมูลไม่สำเร็จ');})
      .finally(()=>{if(!controller.signal.aborted)setLoading(false);});
    return()=>controller.abort();
  },[retry]);

  useEffect(()=>{
    if(!container.current)return;
    setMapError('');
    const instance=new MarineMap({container:container.current,style:'https://tiles.openfreemap.org/styles/liberty',
      center:centre,zoom:11.5,minZoom:5,maxZoom:18,attributionControl:{compact:true}});
    let loaded=false,disposed=false;
    instance.addControl(new NavigationControl({showCompass:false}),'top-right');
    instance.addControl(new ScaleControl({unit:'metric'}),'bottom-left');
    const timeout=window.setTimeout(()=>{if(!disposed && !loaded)setMapError('แผนที่พื้นหลังโหลดช้า กรุณาลองเชื่อมต่อใหม่');},20000);
    instance.on('load',()=>{if(!disposed){loaded=true;window.clearTimeout(timeout);setMap(instance);}});
    instance.on('error',event=>{
      console.warn('DMR map source unavailable',event.error.message);
      if(!disposed && !loaded)setMapError('เชื่อมต่อแผนที่พื้นหลังไม่ได้');
    });
    return()=>{
      disposed=true;window.clearTimeout(timeout);marker.current?.remove();marker.current=null;
      setMap(current=>current===instance?null:current);instance.remove();
    };
  },[mapRetry]);

  useEffect(()=>{
    if(!map || !data || !manifest)return;
    map.addSource('dmr',{type:'geojson',data,attribution:'กรมทรัพยากรธรณี · ชนิดตะกอนพื้นท้องทะเล'});
    map.addLayer({id:fill,type:'fill',source:'dmr',paint:{'fill-color':['get','color'],'fill-opacity':0.65}});
    map.addLayer({id:line,type:'line',source:'dmr',paint:{'line-color':['get','color'],'line-opacity':0.9,'line-width':1.3}});
    map.addLayer({id:selectedLine,type:'line',source:'dmr',filter:['==',['get','id'],''],
      paint:{'line-color':'#123b5d','line-width':3,'line-opacity':0.9}});
    map.addSource('dmr-coverage',{type:'geojson',data:{type:'Feature',properties:{},geometry:manifest.coverage.geometry}});
    map.addLayer({id:'dmr-coverage-line',type:'line',source:'dmr-coverage',
      paint:{'line-color':'#237fa7','line-width':1.5,'line-dasharray':[4,4],'line-opacity':0.6}});
    const click=(event:import('maplibre-gl').MapMouseEvent)=>{
      const feature=map.queryRenderedFeatures(event.point,{layers:[fill]})[0];
      setSelected({longitude:event.lngLat.lng,latitude:event.lngLat.lat,featureId:feature?.properties?.id?String(feature.properties.id):null});
    };
    const enter=()=>{map.getCanvas().style.cursor='pointer';},leave=()=>{map.getCanvas().style.cursor='';};
    map.on('click',click);map.on('mouseenter',fill,enter);map.on('mouseleave',fill,leave);
    return()=>{
      map.off('click',click);map.off('mouseenter',fill,enter);map.off('mouseleave',fill,leave);
      if(map.getStyle()){
        for(const id of ['dmr-coverage-line',selectedLine,line,fill])if(map.getLayer(id))map.removeLayer(id);
        for(const id of ['dmr-coverage','dmr'])if(map.getSource(id))map.removeSource(id);
      }
    };
  },[map,data,manifest]);

  useEffect(()=>{
    if(!map?.getLayer(fill))return;
    const expression=filter==='all'?null:['==',['get','classKey'],filter] as import('maplibre-gl').FilterSpecification;
    for(const id of [fill,line]){map.setFilter(id,expression);map.setLayoutProperty(id,'visibility',visible?'visible':'none');}
    map.setLayoutProperty(selectedLine,'visibility',visible?'visible':'none');
    map.setPaintProperty(fill,'fill-opacity',opacity);
  },[map,data,filter,visible,opacity]);

  useEffect(()=>{
    marker.current?.remove();marker.current=null;
    if(!map?.getLayer(selectedLine))return;
    map.setFilter(selectedLine,['==',['get','id'],selected?.featureId??'']);
    if(selected){
      const element=document.createElement('div');element.className='dmr-point-marker';
      marker.current=new Marker({element}).setLngLat([selected.longitude,selected.latitude]).addTo(map);
    }
    return()=>{marker.current?.remove();marker.current=null;};
  },[map,data,selected]);
  useEffect(()=>{if(selected)pointHeading.current?.focus({preventScroll:true});},[selected]);
  useEffect(()=>{
    const close=(event:KeyboardEvent)=>{if(event.key==='Escape'){setSelected(null);setSourceOpen(false);}};
    window.addEventListener('keydown',close);return()=>window.removeEventListener('keydown',close);
  },[]);

  function selectClass(key:string){setFilter(key);setVisible(true);setSelected(null);}
  function fitAll(){
    if(!map || !manifest)return;
    const b=manifest.coverage.bboxWgs84;
    map.fitBounds([[b[0],b[1]],[b[2],b[3]]],{padding:window.innerWidth>=720?{top:40,bottom:65,left:320,right:45}:55,duration:650});
  }
  function exportVisible(){
    if(!data || !manifest)return;
    downloadJson('dmr-sichang-sediment.geojson',{
      ...data,features:data.features.filter(f=>filter==='all' || f.properties?.classKey===filter),
      exportMetadata:{source:manifest.source,sourceFetchedAt:manifest.fetchedAt,filter,exportedAt:new Date().toISOString()},
    });
  }

  return <div className="dmr-app">
    <header className="dmr-header">
      <div className="dmr-brand"><span className="dmr-brand-icon"><Waves size={24}/></span><div><b>Seabed</b><span>แผนที่ตะกอนพื้นทะเล · DMR</span></div></div>
      <div className="dmr-location"><MapPin size={15}/><span>เกาะสีชัง <i/> รัศมี {manifest?.coverage.radiusKm??100} กม.</span></div>
      <div className="dmr-header-actions"><button className="dmr-secondary" disabled={loading} onClick={()=>setRetry(v=>v+1)} title="โหลดชุดข้อมูลที่บันทึกไว้ใหม่"><RotateCcw size={15} className={loading?'dmr-spin':''}/><span>โหลดแผนที่ใหม่</span></button>
        <button className="dmr-primary" disabled={!data || loading} onClick={exportVisible}><ArrowDownToLine size={16}/><span>ดาวน์โหลด</span></button></div>
    </header>
    <main className="dmr-map-workspace" aria-label="สำรวจชนิดตะกอนรอบเกาะสีชัง">
      <div ref={container} className="dmr-map" aria-label="แผนที่ตะกอนพื้นทะเล กรมทรัพยากรธรณี"/>
      <aside className={`dmr-legend ${legendOpen?'expanded':''}`}>
        <button className="dmr-legend-heading" aria-expanded={legendOpen} onClick={()=>setLegendOpen(v=>!v)}><span><Layers size={17}/> ชนิดตะกอนพื้นทะเล</span><ChevronDown size={17}/></button>
        <div className="dmr-legend-body">
          <p className="dmr-intro">สำรวจพื้นทะเลจากแผนที่ของ<br/>กรมทรัพยากรธรณี</p>
          <div className="dmr-class-list" aria-label="กรองชนิดตะกอน">
            <button className={filter==='all'?'active':''} aria-pressed={filter==='all'} onClick={()=>selectClass('all')}><span className="dmr-all-icon"><Layers size={14}/></span><span>ทุกประเภท</span><em>{manifest?.featureCount??'—'}</em>{filter==='all'&&<Check size={13}/>}</button>
            {manifest && Object.entries(manifest.classes).map(([key,info])=><button key={key} className={filter===key?'active':''} aria-pressed={filter===key} onClick={()=>selectClass(key)}><i style={{background:info.color}}/><span>{info.nameTh.replaceAll('ตะกอน','').replaceAll('ทะเล','')}</span><em>{manifest.countsByClass[key]}</em>{filter===key&&<Check size={13}/>}</button>)}
          </div>
          <div className="dmr-display-settings"><label className="dmr-visible"><input type="checkbox" checked={visible} onChange={e=>{setVisible(e.target.checked);setSelected(null);}}/> แสดงสีตะกอน</label>
            <label className="dmr-opacity">ความเข้มสี <span>{Math.round(opacity*100)}%</span><input aria-label="ความเข้มสีตะกอน" type="range" min="0.15" max="0.9" step="0.05" value={opacity} onChange={e=>setOpacity(Number(e.target.value))}/></label></div>
          <div className="dmr-data-count"><b>{displayedCount}</b><span>ขอบเขต{filter==='all'?'ในชุดข้อมูล':'ของประเภทที่เลือก'}</span><small>คลิกพื้นที่สีเพื่อดูรายละเอียด</small></div>
          <button className="dmr-source-button" onClick={()=>setSourceOpen(true)}>ที่มาและข้อจำกัด <ArrowUpRight size={15}/></button>
        </div>
      </aside>
      <div className="dmr-view-actions"><button disabled={!map} onClick={()=>map?.flyTo({center:centre,zoom:11.5,duration:650})}><MapPin size={15}/> เกาะสีชัง</button><button disabled={!map || !manifest} onClick={fitAll}><Layers size={15}/> ทั้งพื้นที่</button></div>
      {(loading || (!map && !mapError)) && <div className="dmr-loading" role="status"><span className="dmr-loader"/>{loading?'กำลังโหลดข้อมูล DMR':'กำลังเปิดแผนที่'}</div>}
      {(dataError || mapError) && <div className="dmr-error" role="alert"><b>{dataError || mapError}</b><button onClick={()=>{if(dataError)setRetry(v=>v+1);if(mapError)setMapRetry(v=>v+1);}}>ลองใหม่</button></div>}
      {selected && <aside className="dmr-point-card" aria-label="รายละเอียดตำแหน่งที่เลือก">
        <button className="dmr-close" aria-label="ปิดรายละเอียด" onClick={()=>setSelected(null)}><X size={18}/></button>
        <span className="dmr-eyebrow">ตำแหน่งที่เลือก</span>
        <h2 ref={pointHeading} tabIndex={-1}>{properties?String(properties.SS_NAME_T).replaceAll('ตะกอน','').replaceAll('ทะเล',''):'ยังไม่มีข้อมูลตะกอน'}</h2>
        <p className="dmr-coordinates"><MapPin size={14}/>{selected.latitude.toFixed(5)}° N, {selected.longitude.toFixed(5)}° E</p>
        {properties?<><div className="dmr-selected-class"><i style={{background:String(properties.color)}}/><span>{String(properties.SS_NAME_E)}</span></div>
          <dl><div><dt>จังหวัด</dt><dd>{String(properties.PROVINCE_T || 'ไม่ระบุ')}</dd></div><div><dt>รหัสพื้นที่</dt><dd>{String(properties.SS_ID || properties.OBJECTID)}</dd></div>
            <div><dt>พื้นที่ขอบเขตในกรอบข้อมูล</dt><dd>{(Number(properties.clippedAreaM2)/1000000).toLocaleString('th-TH',{maximumFractionDigits:2})} ตร.กม.</dd></div><div><dt>มาตราส่วนชุดข้อมูล</dt><dd>{manifest?.mapScale??'ยังไม่ระบุ'}</dd></div><div><dt>วันที่สำรวจขอบเขตนี้</dt><dd>ไม่ระบุในชุดข้อมูล</dd></div></dl>
          <button className="dmr-point-export" onClick={()=>downloadJson(`${properties.id}.geojson`,{type:'FeatureCollection',features:[selectedFeature],sourceMetadata:manifest})}><ArrowDownToLine size={15}/> ดาวน์โหลดขอบเขตนี้</button>
        </>:<p className="dmr-no-data">{!visible?'เปิดการแสดงสีตะกอนเพื่อเลือกพื้นที่':filter!=='all'?'ไม่พบตะกอนประเภทที่เลือกตรงตำแหน่งนี้ ลองเลือกทุกประเภท':'ไม่มีขอบเขต DMR แสดงตรงตำแหน่งนี้ พื้นที่ว่างยังไม่ทราบชนิดตะกอน'}</p>}
        <p className="dmr-point-note">ข้อมูลชนิดตะกอนใช้ประกอบการสำรวจ ยังไม่ยืนยันว่าเหมาะกับการปล่อยปู</p>
      </aside>}
      <div className="dmr-bottom-note"><span className="dmr-status-dot"/>ข้อมูลแผนที่ DMR{manifest?` · ดึง ${downloadedAt(manifest.fetchedAt)}`:''}<button onClick={()=>setSourceOpen(true)}>รายละเอียด</button></div>
    </main>
    {sourceOpen && <div className="dmr-modal-backdrop" onClick={()=>setSourceOpen(false)}><section className="dmr-source-dialog" role="dialog" aria-modal="true" aria-labelledby="dmr-source-title" onClick={e=>e.stopPropagation()}>
      <button className="dmr-close" aria-label="ปิดที่มา" onClick={()=>setSourceOpen(false)}><X size={19}/></button><span className="dmr-eyebrow">เกี่ยวกับข้อมูล</span><h2 id="dmr-source-title">แผนที่ชนิดตะกอนพื้นท้องทะเล</h2>
      <p>กรมทรัพยากรธรณี (DMR) · {manifest?.featureCount??'—'} ขอบเขตภายในรัศมี {manifest?.coverage.radiusKm??100} กม. รอบเกาะสีชัง</p>
      <ul><li>ข้อมูลที่แสดงเป็นชุดที่ดาวน์โหลดไว้ {manifest?downloadedAt(manifest.fetchedAt):''}</li>
        {manifest?.catalogueMetadata&&<><li>บัญชีข้อมูล DMR ระบุมาตราส่วน {manifest.mapScale} · เก็บตัวอย่างตะกอนแบบลาก วิเคราะห์ขนาดเม็ดตะกอน และจำแนกตาม Shepard (1954)</li><li>บัญชีข้อมูลระบุปรับปรุงชุดข้อมูล {new Date(manifest.catalogueMetadata.dataUpdatedAt).toLocaleDateString('th-TH',{timeZone:'Asia/Bangkok',day:'numeric',month:'long',year:'numeric'})} · วันปรับปรุงชุดข้อมูลไม่ใช่วันที่สำรวจแต่ละจุด</li></>}
        <li>วันที่สำรวจแต่ละขอบเขตและค่าความแม่นยำจำแนกเฉพาะเกาะสีชังยังไม่ยืนยัน มาตราส่วนไม่ใช่การรับรองความแม่นยำทุกพิกัด</li><li>พื้นที่ไม่มีสีคือยังไม่มีข้อมูลจำแนกแสดงในชุดนี้</li><li>ชนิดตะกอนยังไม่บอกความลึก อาหาร ที่หลบซ่อน หรือการพบปูวัยอ่อน</li></ul>
      <p className="dmr-license">{manifest?.catalogueMetadata?'บัญชีข้อมูลระบุ Creative Commons Attributions โดยไม่ระบุเวอร์ชัน · ':''}โปรดระบุกรมทรัพยากรธรณีเป็นแหล่งที่มาเมื่อใช้ข้อมูล</p>
      <div className="dmr-source-links"><a href="https://gisportal.dmr.go.th/arcgis/rest/services/ENVI/SEAFLOOR_SURFICIAL_SEDIMENT/MapServer" target="_blank" rel="noreferrer">บริการข้อมูลต้นทาง <ArrowUpRight size={14}/></a><a href={directory+'dmr-manifest.json'} download>ดาวน์โหลดข้อมูลที่มา <ArrowDownToLine size={14}/></a></div>
      {manifest?.catalogueMetadata&&<div className="dmr-source-links"><a href={manifest.catalogueMetadata.catalogueUrl} target="_blank" rel="noreferrer">รายละเอียดชุดข้อมูลจาก DMR <ArrowUpRight size={14}/></a></div>}
      <small>แผนที่พื้นหลัง: OpenFreeMap / OpenStreetMap · สีตะกอน: กรมทรัพยากรธรณี</small>
    </section></div>}
  </div>;
}
