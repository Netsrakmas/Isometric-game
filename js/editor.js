"use strict";
/* ============================================================
   GRID WARRIOR — level editor
   Paints tiles, places entities/pickups/signs/player start,
   defines arena trials (rect + gates + waves) and the boss,
   imports/exports level JSON, launches Test Play.
   Shares iso rendering + Level + assets with the game (core.js).
   ============================================================ */

let lv=new Level(44,44);

// ---------- canvas / view ----------
const cv=document.getElementById('ed'), cx=cv.getContext('2d');
let VW=0,VH=0,DPR=1;
const view={camx:isoX(22,22),camy:isoY(22,22),zoom:.55};
function resize(){DPR=Math.min(devicePixelRatio||1,2);
  const r=cv.getBoundingClientRect();VW=r.width;VH=innerHeight;
  cv.width=VW*DPR;cv.height=VH*DPR;cv.style.height=VH+'px';}
addEventListener('resize',()=>{resize();});
function worldOf(clientX,clientY){ // screen px -> iso world px
  const r=cv.getBoundingClientRect();
  return [(clientX-r.left-VW/2)/view.zoom+view.camx,(clientY-r.top-VH/2)/view.zoom+view.camy];
}
function gridOf(clientX,clientY){
  const [wx,wy]=worldOf(clientX,clientY);
  return [gridX(wx,wy),gridY(wx,wy)];
}

// ---------- state ----------
let tool='paint';           // paint | entity | pickup | sign | start | arena | bossedit | select
let paintTile=T.G, entType='blob', pickType='coin', bossMode=null;
let hover=[0,0];            // grid tile under cursor
let hoverG=[0,0];           // precise grid coords
let dragRect=null;          // {x0,y0,x1,y1} while dragging arena/trigger rects
let panning=false,panStart=null;
let painting=false;
let pendingPatrol=null;     // goblin awaiting patrol point
let gateArena=null;         // arena awaiting a gate click
let sel=null;               // {kind:'enemy'|'pickup'|'sign'|'wave', ref, list}
let selArena=-1;            // index into lv.arenas
let layer='world';          // 'world' | 'a<idx>w<idx>'
const undoStack=[];
function pushUndo(){undoStack.push(JSON.stringify(lv.toJSON()));if(undoStack.length>60)undoStack.shift();}
function undo(){if(!undoStack.length)return;lv=Level.fromJSON(JSON.parse(undoStack.pop()));
  sel=null;selArena=Math.min(selArena,lv.arenas.length-1);refreshPanel();}

// ---------- panel ----------
const $=id=>document.getElementById(id);
const TOOLS=[['paint','Paint'],['entity','Enemy'],['pickup','Pickup'],['sign','Sign'],
  ['start','Start'],['arena','Arena'],['bossedit','Boss'],['select','Select']];
function refreshTools(){
  $('tools').innerHTML=TOOLS.map(([k,l])=>`<button data-t="${k}" class="${tool===k?'on':''}">${l}</button>`).join('');
  [...$('tools').children].forEach(b=>b.onclick=()=>{tool=b.dataset.t;bossMode=null;gateArena=null;pendingPatrol=null;refreshTools();});
  let o='';
  if(tool==='paint'){
    o=TILE_NAME.map((n,i)=>`<button data-i="${i}" class="${paintTile===i?'on':''}">${n}</button>`).join('');
  } else if(tool==='entity'){
    o=['blob','goblin','turret'].map(k=>`<button data-e="${k}" class="${entType===k?'on':''}">${k}</button>`).join('');
  } else if(tool==='pickup'){
    o=['coin','heart','heartcont'].map(k=>`<button data-p="${k}" class="${pickType===k?'on':''}">${k}</button>`).join('');
  } else if(tool==='arena'){
    o='<div class="hint">Drag a rect for the arena interior, then add gates from the arena list.</div>';
  } else if(tool==='bossedit'){
    o=['spawn','gate','trigger','arena'].map(k=>`<button data-b="${k}" class="${bossMode===k?'on':''}">${k}</button>`).join('')
      +'<div class="hint">spawn/gate: click a tile · trigger/arena: drag a rect</div>';
  } else if(tool==='sign'){
    o='<div class="hint">Click a tile, then type the sign text.</div>';
  } else if(tool==='select'){
    o='<div class="hint">Click a marker to select. Drag to move. Del removes.</div>';
  }
  $('toolOpts').innerHTML=o;
  [...$('toolOpts').querySelectorAll('button')].forEach(b=>b.onclick=()=>{
    if(b.dataset.i!==undefined)paintTile=+b.dataset.i;
    if(b.dataset.e)entType=b.dataset.e;
    if(b.dataset.p)pickType=b.dataset.p;
    if(b.dataset.b)bossMode=b.dataset.b;
    refreshTools();});
}
function refreshLayers(){
  const opts=['<option value="world">World</option>'];
  lv.arenas.forEach((a,i)=>a.waves.forEach((w,j)=>
    opts.push(`<option value="a${i}w${j}">Arena ${i+1} · Wave ${j+1} (${w.length})</option>`)));
  $('layerSel').innerHTML=opts.join('');
  $('layerSel').value=layer;
  if($('layerSel').value!==layer){layer='world';$('layerSel').value='world';}
}
function refreshArenas(){
  $('arenaList').innerHTML=lv.arenas.map((a,i)=>
    `<div class="arena-row"><span class="${selArena===i?'':'hint'}">Arena ${i+1} [${a.rect}] · ${a.gates.length} gate(s)</span>
     <button data-a="${i}" data-op="sel">◎</button>
     <button data-a="${i}" data-op="gate">+gate</button>
     <button data-a="${i}" data-op="del">✕</button></div>`).join('')||'<div class="hint">none — use the Arena tool</div>';
  [...$('arenaList').querySelectorAll('button')].forEach(b=>b.onclick=()=>{
    const i=+b.dataset.a;
    if(b.dataset.op==='sel'){selArena=selArena===i?-1:i;}
    if(b.dataset.op==='gate'){gateArena=i;setStatus('click a tile to toggle a gate for arena '+(i+1));}
    if(b.dataset.op==='del'){pushUndo();lv.arenas.splice(i,1);selArena=-1;layer='world';}
    refreshPanel();});
  $('bAddWave').style.display=selArena>=0?'block':'none';
  $('bAddWave').onclick=()=>{if(selArena<0)return;pushUndo();lv.arenas[selArena].waves.push([]);refreshPanel();};
}
function refreshBoss(){
  const b=lv.boss;
  $('bossBox').innerHTML=b?
    `<div class="hint">${b.name}</div>
     <div class="hint">gate ${b.gate?`(${b.gate.x},${b.gate.y})`:'—'} · spawn ${b.spawn?`(${b.spawn.x.toFixed(1)},${b.spawn.y.toFixed(1)})`:'—'}</div>
     <button id="bBossName">rename</button><button id="bBossDel">remove boss</button>`
    :'<div class="hint">none — use the Boss tool</div>';
  const n=$('bBossName');if(n)n.onclick=()=>{const v=prompt('Boss name:',b.name);if(v){pushUndo();b.name=v;refreshBoss();}};
  const d=$('bBossDel');if(d)d.onclick=()=>{pushUndo();lv.boss=null;refreshBoss();};
}
function refreshSel(){
  if(!sel){$('selBox').innerHTML='<span class="hint">nothing selected</span>';return;}
  const r=sel.ref;
  let html=`<b>${r.type||sel.kind}</b> (${(+r.x).toFixed(1)}, ${(+r.y).toFixed(1)})`;
  if(r.type==='goblin')html+=`<br>patrol → (${(+r.px).toFixed(1)}, ${(+r.py).toFixed(1)}) <button id="bPatrol">set patrol</button>`;
  if(sel.kind==='sign')html+=`<br>“${r.text}” <button id="bSignTxt">edit text</button>`;
  html+='<br><button id="bDelSel">delete</button>';
  $('selBox').innerHTML=html;
  const p=$('bPatrol');if(p)p.onclick=()=>{pendingPatrol=r;setStatus('click to set patrol point');};
  const s=$('bSignTxt');if(s)s.onclick=()=>{const v=prompt('Sign text:',r.text);if(v!==null){pushUndo();r.text=v;refreshSel();}};
  const d=$('bDelSel');if(d)d.onclick=deleteSelection;
}
function refreshPanel(){refreshTools();refreshLayers();refreshArenas();refreshBoss();refreshSel();
  $('lvName').value=lv.name;}
function setStatus(t){$('status').textContent=t;}

// ---------- placement helpers ----------
function currentEnemyList(){
  if(layer==='world')return lv.enemies;
  const m=layer.match(/^a(\d+)w(\d+)$/);
  if(m&&lv.arenas[+m[1]]&&lv.arenas[+m[1]].waves[+m[2]])return lv.arenas[+m[1]].waves[+m[2]];
  return lv.enemies;
}
function allMarkers(){ // for select tool: [{x,y,kind,ref,list}]
  const out=[];
  lv.enemies.forEach(e=>out.push({x:e.x,y:e.y,kind:'enemy',ref:e,list:lv.enemies}));
  lv.arenas.forEach(a=>a.waves.forEach(w=>w.forEach(e=>out.push({x:e.x,y:e.y,kind:'enemy',ref:e,list:w}))));
  lv.pickups.forEach(p=>out.push({x:p.x,y:p.y,kind:'pickup',ref:p,list:lv.pickups}));
  lv.signs.forEach(s=>out.push({x:s.x,y:s.y,kind:'sign',ref:s,list:lv.signs}));
  return out;
}
function deleteSelection(){
  if(!sel)return;
  pushUndo();
  const i=sel.list.indexOf(sel.ref);
  if(i>=0)sel.list.splice(i,1);
  sel=null;refreshPanel();
}

// ---------- pointer handling ----------
cv.addEventListener('contextmenu',e=>e.preventDefault());
cv.addEventListener('wheel',e=>{
  e.preventDefault();
  const f=e.deltaY<0?1.15:1/1.15;
  const [wx,wy]=worldOf(e.clientX,e.clientY);
  view.zoom=clamp(view.zoom*f,.12,2.5);
  const [wx2,wy2]=worldOf(e.clientX,e.clientY);
  view.camx+=wx-wx2;view.camy+=wy-wy2;
},{passive:false});
cv.addEventListener('pointerdown',e=>{
  cv.setPointerCapture(e.pointerId);
  if(e.button===2||e.button===1){panning=true;panStart={x:e.clientX,y:e.clientY,cx:view.camx,cy:view.camy};return;}
  const [gx,gy]=gridOf(e.clientX,e.clientY);
  const tx=Math.floor(gx),ty=Math.floor(gy);
  if(pendingPatrol){pushUndo();pendingPatrol.px=+gx.toFixed(2);pendingPatrol.py=+gy.toFixed(2);
    pendingPatrol=null;setStatus('patrol set');refreshSel();return;}
  if(gateArena!==null){
    const a=lv.arenas[gateArena];if(a){pushUndo();
      const i=a.gates.findIndex(g=>g[0]===tx&&g[1]===ty);
      if(i>=0)a.gates.splice(i,1);else a.gates.push([tx,ty]);}
    gateArena=null;refreshPanel();return;}
  switch(tool){
    case 'paint':pushUndo();painting=true;lv.set(tx,ty,paintTile);break;
    case 'entity':{pushUndo();
      const def=entType==='goblin'?{type:'goblin',x:+gx.toFixed(2),y:+gy.toFixed(2),px:+gx.toFixed(2),py:+gy.toFixed(2)}
        :{type:entType,x:+gx.toFixed(2),y:+gy.toFixed(2)};
      const list=currentEnemyList();list.push(def);
      sel={kind:'enemy',ref:def,list};
      if(entType==='goblin'){pendingPatrol=def;setStatus('click to set patrol point');}
      refreshPanel();break;}
    case 'pickup':pushUndo();lv.pickups.push({type:pickType,x:+gx.toFixed(2),y:+gy.toFixed(2)});break;
    case 'sign':{const txt=prompt('Sign text:');if(txt){pushUndo();
      const s={x:tx,y:ty,text:txt};lv.signs.push(s);sel={kind:'sign',ref:s,list:lv.signs};refreshPanel();}break;}
    case 'start':pushUndo();lv.playerStart={x:+gx.toFixed(2),y:+gy.toFixed(2)};break;
    case 'arena':dragRect={x0:tx,y0:ty,x1:tx,y1:ty,mode:'newArena'};break;
    case 'bossedit':{
      if(!bossMode){setStatus('pick a boss sub-tool first');break;}
      if(!lv.boss)lv.boss={name:'THE GUARDIAN',gate:null,spawn:null,trigger:null,arena:null};
      if(bossMode==='spawn'){pushUndo();lv.boss.spawn={x:+gx.toFixed(2),y:+gy.toFixed(2)};refreshBoss();}
      else if(bossMode==='gate'){pushUndo();lv.boss.gate={x:tx,y:ty};lv.set(tx,ty,T.GATE);refreshBoss();}
      else dragRect={x0:tx,y0:ty,x1:tx,y1:ty,mode:bossMode==='trigger'?'bossTrigger':'bossArena'};
      break;}
    case 'select':{
      const [px,py]=[gx,gy];
      let best=null,bd=.8;
      allMarkers().forEach(mk=>{const dd=Math.hypot(mk.x-px,mk.y-py);if(dd<bd){bd=dd;best=mk;}});
      sel=best;refreshSel();
      if(sel)sel.dragging=true;
      break;}
  }
});
cv.addEventListener('pointermove',e=>{
  const [gx,gy]=gridOf(e.clientX,e.clientY);
  hoverG=[gx,gy];hover=[Math.floor(gx),Math.floor(gy)];
  if(panning&&panStart){
    view.camx=panStart.cx-(e.clientX-panStart.x)/view.zoom;
    view.camy=panStart.cy-(e.clientY-panStart.y)/view.zoom;return;}
  if(painting&&tool==='paint')lv.set(hover[0],hover[1],paintTile);
  if(dragRect){dragRect.x1=hover[0];dragRect.y1=hover[1];}
  if(sel&&sel.dragging){sel.ref.x=+gx.toFixed(2);sel.ref.y=+gy.toFixed(2);sel.x=gx;sel.y=gy;}
  setStatus(`tile ${hover[0]},${hover[1]} · ${TILE_NAME[lv.get(hover[0],hover[1])]||''} · zoom ${view.zoom.toFixed(2)}`);
});
addEventListener('pointerup',e=>{
  panning=false;painting=false;
  if(sel&&sel.dragging){sel.dragging=false;refreshSel();}
  if(dragRect){
    const r=[Math.min(dragRect.x0,dragRect.x1),Math.min(dragRect.y0,dragRect.y1),
             Math.max(dragRect.x0,dragRect.x1),Math.max(dragRect.y0,dragRect.y1)];
    pushUndo();
    if(dragRect.mode==='newArena'){
      lv.arenas.push({rect:r,gates:[],waves:[[]]});selArena=lv.arenas.length-1;
      setStatus('arena added — now add gate tiles and fill its waves');
    } else if(dragRect.mode==='bossTrigger'){lv.boss.trigger=[r[0],r[1],r[2]+1,r[3]+1];}
    else if(dragRect.mode==='bossArena'){lv.boss.arena=[r[0],r[1],r[2]+1,r[3]+1];}
    dragRect=null;refreshPanel();
  }
});
addEventListener('keydown',e=>{
  if(e.target.tagName==='INPUT'||e.target.tagName==='SELECT')return;
  if((e.code==='Delete'||e.code==='Backspace')&&sel)deleteSelection();
  if(e.ctrlKey&&e.code==='KeyZ')undo();
});

// ---------- file ops ----------
$('lvName').addEventListener('change',()=>{lv.name=$('lvName').value;});
$('layerSel').addEventListener('change',()=>{layer=$('layerSel').value;});
$('bNew').onclick=()=>{
  const w=+prompt('Width (tiles):','44')||44,h=+prompt('Height (tiles):','44')||44;
  pushUndo();lv=new Level(clamp(w,8,128),clamp(h,8,128));
  // solid water border like the meadow
  for(let x=0;x<lv.w;x++){lv.set(x,0,T.W);lv.set(x,1,T.W);lv.set(x,lv.h-1,T.W);lv.set(x,lv.h-2,T.W);}
  for(let y=0;y<lv.h;y++){lv.set(0,y,T.W);lv.set(1,y,T.W);lv.set(lv.w-1,y,T.W);lv.set(lv.w-2,y,T.W);}
  view.camx=isoX(lv.w/2,lv.h/2);view.camy=isoY(lv.w/2,lv.h/2);
  sel=null;selArena=-1;layer='world';refreshPanel();};
$('bOpen').onclick=async()=>{try{pushUndo();lv=await fetchLevel('levels/meadow.json');
  view.camx=isoX(lv.w/2,lv.h/2);view.camy=isoY(lv.w/2,lv.h/2);
  sel=null;selArena=-1;layer='world';refreshPanel();}catch(err){alert(err.message);}};
$('bImport').onclick=()=>$('fImport').click();
$('fImport').addEventListener('change',e=>{
  const f=e.target.files[0];if(!f)return;
  const rd=new FileReader();
  rd.onload=()=>{try{pushUndo();lv=Level.fromJSON(JSON.parse(rd.result));
    sel=null;selArena=-1;layer='world';refreshPanel();}catch(err){alert('Bad level JSON: '+err.message);}};
  rd.readAsText(f);e.target.value='';});
$('bExport').onclick=()=>{
  lv.name=$('lvName').value;
  const blob=new Blob([JSON.stringify(lv.toJSON(),null,1)],{type:'application/json'});
  const a=document.createElement('a');a.href=URL.createObjectURL(blob);
  a.download=(lv.name.toLowerCase().replace(/[^a-z0-9]+/g,'_')||'level')+'.json';
  a.click();URL.revokeObjectURL(a.href);};
$('bTest').onclick=()=>{
  lv.name=$('lvName').value;
  try{localStorage.setItem('gridwarrior_testlevel',JSON.stringify(lv.toJSON()));
    localStorage.removeItem('gridwarrior_v1_test');}catch(err){alert('localStorage unavailable: '+err.message);return;}
  window.open('index.html?level=test','gw_test');};

// ---------- render ----------
function tileScreenE(x,y){return [isoX(x,y),isoY(x,y)];} // world space; transform handles the rest
function isoRect(r,close=true){ // rect [x0,y0,x1,y1] inclusive tiles -> path
  const c=[[r[0],r[1]],[r[2]+1,r[1]],[r[2]+1,r[3]+1],[r[0],r[3]+1]];
  cx.beginPath();
  c.forEach(([x,y],i)=>{const px=isoX(x,y),py=isoY(x,y);i?cx.lineTo(px,py):cx.moveTo(px,py);});
  if(close)cx.closePath();
}
function marker(x,y,col,label){
  const [sx,sy]=tileScreenE(x,y);
  cx.fillStyle='rgba(0,0,0,.35)';ellipsePath(cx,sx,sy+2,14,7);cx.fill();
  cx.fillStyle=col;cx.strokeStyle='#10131c';cx.lineWidth=2.5;
  cx.beginPath();cx.arc(sx,sy-12,12,0,6.28);cx.fill();cx.stroke();
  cx.fillStyle='#10131c';cx.font='bold 13px Trebuchet MS';cx.textAlign='center';
  cx.fillText(label,sx,sy-7.5);
}
function render(){
  cx.setTransform(DPR,0,0,DPR,0,0);
  cx.fillStyle='#1a2333';cx.fillRect(0,0,VW,VH);
  cx.setTransform(DPR*view.zoom,0,0,DPR*view.zoom,
    DPR*(VW/2-view.camx*view.zoom),DPR*(VH/2-view.camy*view.zoom));
  cx.imageSmoothingEnabled=true;
  // floor
  for(let y=0;y<lv.h;y++)for(let x=0;x<lv.w;x++){
    const [sx,sy]=tileScreenE(x,y);
    drawFloorTile(cx,lv,x,y,sx,sy);
  }
  // objects, depth sorted
  const items=[];
  for(let y=0;y<lv.h;y++)for(let x=0;x<lv.w;x++){
    const t=lv.get(x,y);
    if(t===T.R)items.push({d:x+y,f:()=>{const[sx,sy]=tileScreenE(x,y);drawWallTile(cx,lv,x,y,sx,sy);}});
    if(t===T.C)items.push({d:x+y,f:()=>{const[sx,sy]=tileScreenE(x,y);drawCrackedTile(cx,x,y,sx,sy);}});
    if(t===T.GATE)items.push({d:x+y,f:()=>{const[sx,sy]=tileScreenE(x,y);drawGateTile(cx,sx,sy,null);}});
    if(t===T.B)items.push({d:x+y-.3,f:()=>{const[sx,sy]=tileScreenE(x,y);drawBridgeTile(cx,sx,sy);}});
  }
  items.sort((a,b)=>a.d-b.d).forEach(i=>i.f());
  // grid (faint)
  cx.strokeStyle='rgba(255,255,255,.07)';cx.lineWidth=1/view.zoom;
  for(let y=0;y<lv.h;y++)for(let x=0;x<lv.w;x++){
    const [sx,sy]=tileScreenE(x,y);diamondPath(cx,sx,sy);cx.stroke();
  }
  // arena overlays
  lv.arenas.forEach((a,i)=>{
    cx.lineWidth=3/view.zoom;
    cx.strokeStyle=i===selArena?'#ffd83d':'rgba(255,150,40,.85)';
    isoRect(a.rect);cx.stroke();
    cx.fillStyle=i===selArena?'rgba(255,216,61,.10)':'rgba(255,150,40,.06)';isoRect(a.rect);cx.fill();
    a.gates.forEach(g=>{const [sx,sy]=tileScreenE(g[0]+.5,g[1]+.5);
      cx.strokeStyle='#ff9628';cx.lineWidth=3/view.zoom;diamondPath(cx,sx,sy-HH);cx.stroke();
      cx.fillStyle='#ff9628';cx.font='bold 12px Trebuchet MS';cx.textAlign='center';cx.fillText('gate',sx,sy);});
    const [lx,ly]=tileScreenE(a.rect[0],a.rect[1]);
    cx.fillStyle='#ffb060';cx.font='bold 16px Trebuchet MS';cx.textAlign='center';
    cx.fillText('Arena '+(i+1),lx,ly-8);
    a.waves.forEach((w,wi)=>w.forEach(e=>markerEnemy(e,`${wi+1}`)));
  });
  // boss overlays
  if(lv.boss){
    if(lv.boss.trigger){cx.strokeStyle='rgba(255,70,70,.9)';cx.setLineDash([10,7]);cx.lineWidth=2.5/view.zoom;
      isoRectF(lv.boss.trigger);cx.stroke();cx.setLineDash([]);
      labelAt(lv.boss.trigger[0],lv.boss.trigger[1],'#ff6a6a','boss trigger');}
    if(lv.boss.arena){cx.strokeStyle='rgba(200,90,255,.9)';cx.lineWidth=2.5/view.zoom;
      isoRectF(lv.boss.arena);cx.stroke();
      labelAt(lv.boss.arena[0],lv.boss.arena[1],'#c85aff','boss arena');}
    if(lv.boss.spawn)marker(lv.boss.spawn.x,lv.boss.spawn.y,'#c85aff','B');
    if(lv.boss.gate){const [sx,sy]=tileScreenE(lv.boss.gate.x+.5,lv.boss.gate.y+.5);
      cx.strokeStyle='#ffd83d';cx.lineWidth=3/view.zoom;diamondPath(cx,sx,sy-HH);cx.stroke();}
  }
  // world enemies / pickups / signs / start
  lv.enemies.forEach(e=>markerEnemy(e,''));
  lv.pickups.forEach(p=>marker(p.x,p.y,p.type==='coin'?'#ffd23d':p.type==='heart'?'#ff5b7d':'#ff9ecb',
    p.type==='coin'?'¢':p.type==='heart'?'♥':'♥+'));
  lv.signs.forEach(s=>marker(s.x+.5,s.y+.5,'#a9743f','✎'));
  marker(lv.playerStart.x,lv.playerStart.y,'#54d16a','P');
  // selection halo
  if(sel){const [sx,sy]=tileScreenE(sel.ref.x,sel.ref.y);
    cx.strokeStyle='#fff';cx.lineWidth=2.5/view.zoom;
    cx.beginPath();cx.arc(sx,sy-12,16,0,6.28);cx.stroke();}
  // drag rect preview
  if(dragRect){
    const r=[Math.min(dragRect.x0,dragRect.x1),Math.min(dragRect.y0,dragRect.y1),
             Math.max(dragRect.x0,dragRect.x1),Math.max(dragRect.y0,dragRect.y1)];
    cx.strokeStyle='#fff';cx.lineWidth=2/view.zoom;isoRect(r);cx.stroke();
  }
  // hover tile
  {const [sx,sy]=tileScreenE(hover[0],hover[1]);
   cx.strokeStyle='rgba(255,255,255,.8)';cx.lineWidth=2/view.zoom;diamondPath(cx,sx,sy);cx.stroke();}
  requestAnimationFrame(render);
}
function markerEnemy(e,suffix){
  const col=e.type==='blob'?'#5fc94e':e.type==='goblin'?'#c05545':'#d95fa4';
  marker(e.x,e.y,col,(e.type==='blob'?'B':e.type==='goblin'?'G':'T')+suffix);
  if(e.type==='goblin'&&(e.px!==e.x||e.py!==e.y)){
    const [ax,ay]=tileScreenE(e.x,e.y),[bx,by]=tileScreenE(e.px,e.py);
    cx.strokeStyle='rgba(255,255,255,.5)';cx.lineWidth=2/view.zoom;cx.setLineDash([6,6]);
    cx.beginPath();cx.moveTo(ax,ay-8);cx.lineTo(bx,by-8);cx.stroke();cx.setLineDash([]);
  }
}
function isoRectF(r){ // float rect [x0,y0,x1,y1] in grid coords (exclusive-ish)
  const c=[[r[0],r[1]],[r[2],r[1]],[r[2],r[3]],[r[0],r[3]]];
  cx.beginPath();
  c.forEach(([x,y],i)=>{const px=isoX(x,y),py=isoY(x,y);i?cx.lineTo(px,py):cx.moveTo(px,py);});
  cx.closePath();
}
function labelAt(x,y,col,text){
  const [sx,sy]=tileScreenE(x,y);
  cx.fillStyle=col;cx.font='bold 14px Trebuchet MS';cx.textAlign='center';cx.fillText(text,sx,sy-6);
}

// ---------- boot ----------
async function boot(){
  resize();
  await loadAssets('assets/');
  try{lv=await fetchLevel('levels/meadow.json');}catch(e){/* start blank if missing */}
  view.camx=isoX(lv.w/2,lv.h/2);view.camy=isoY(lv.w/2,lv.h/2);
  refreshPanel();
  window.ED={get level(){return lv;},view};   // debug/test hook
  requestAnimationFrame(render);
}
boot();
