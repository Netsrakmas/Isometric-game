"use strict";
/* ============================================================
   GRID WARRIOR — shared core
   Used by BOTH the game (index.html) and the editor (editor.html):
   iso math · tile enum · Level data + JSON · asset loading with
   animation strips · shared tile drawing.
   ============================================================ */

// ---------- iso constants ----------
const TW=128, TH=64, HW=64, HH=32;            // tile screen size
const T={G:0,P:1,W:2,R:3,B:4,C:5,GATE:6,F:7}; // grass path water ruin bridge cracked gate fountain
const SOLID=t=>(t===T.W||t===T.R||t===T.C||t===T.GATE);
const TILE_CHAR='GPWRBCXF';                   // level JSON: one char per tile, index = tile id
const CHAR_TILE={};[...TILE_CHAR].forEach((c,i)=>CHAR_TILE[c]=i);
const TILE_NAME=['Grass','Path','Water','Ruin wall','Bridge','Cracked wall','Rune gate','Fountain'];

function isoX(x,y){return (x-y)*HW;}
function isoY(x,y){return (x+y)*HH;}
// screen(px, relative to origin) -> grid
function gridX(px,py){return (px/HW+py/HH)/2;}
function gridY(px,py){return (py/HH-px/HW)/2;}
function tileVariant(x,y){const h=((x*73856093)^(y*19349663))>>>0;return h%3;}
const clamp=(v,a,b)=>v<a?a:v>b?b:v;
const lerp=(a,b,t)=>a+(b-a)*t;
const dist=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);

// ---------- level ----------
class Level{
  constructor(w,h){
    this.name='Untitled';this.w=w;this.h=h;
    this.tiles=new Uint8Array(w*h).fill(T.G);
    this.playerStart={x:w/2,y:h/2};
    this.fountain=null;      // {x,y,respawn:{x,y}} | null
    this.signs=[];           // {x,y,text}
    this.enemies=[];         // {type:'blob'|'goblin'|'turret',x,y,px?,py?,unlessFlag?}
    this.pickups=[];         // {type:'coin'|'heart'|'heartcont',x,y,unlessFlag?}
    this.arenas=[];          // {rect:[x0,y0,x1,y1],gates:[[x,y]],waves:[[enemyDef]]}
    this.boss=null;          // {name,gate:{x,y},spawn:{x,y},trigger:[x0,y0,x1,y1],arena:[x0,y0,x1,y1]}
  }
  get(x,y){return (x<0||y<0||x>=this.w||y>=this.h)?T.W:this.tiles[y*this.w+x];}
  set(x,y,t){if(x>=0&&y>=0&&x<this.w&&y<this.h)this.tiles[y*this.w+x]=t;}
  toJSON(){
    const rows=[];
    for(let y=0;y<this.h;y++){let r='';for(let x=0;x<this.w;x++)r+=TILE_CHAR[this.tiles[y*this.w+x]];rows.push(r);}
    return {name:this.name,width:this.w,height:this.h,tiles:rows,
      playerStart:this.playerStart,fountain:this.fountain,signs:this.signs,
      enemies:this.enemies,pickups:this.pickups,arenas:this.arenas,boss:this.boss};
  }
  static fromJSON(j){
    const lv=new Level(j.width,j.height);
    lv.name=j.name||'Untitled';
    (j.tiles||[]).forEach((row,y)=>{[...row].forEach((c,x)=>{lv.tiles[y*lv.w+x]=CHAR_TILE[c]??T.G;});});
    if(j.playerStart)lv.playerStart=j.playerStart;
    lv.fountain=j.fountain||null;
    lv.signs=j.signs||[];lv.enemies=j.enemies||[];lv.pickups=j.pickups||[];
    lv.arenas=j.arenas||[];lv.boss=j.boss||null;
    return lv;
  }
}
async function fetchLevel(url){
  const r=await fetch(url);
  if(!r.ok)throw new Error('level fetch failed: '+url);
  return Level.fromJSON(await r.json());
}

// ---------- assets ----------
/* Loose files under assets/, listed in assets/manifest.json (plain filename array).
   Animation strips: one horizontal strip per anim per direction, frame count in the
   filename — e.g. player_walk_sw_8.png = 8 frames. A trailing _<digits> is ONLY
   parsed as a frame count when preceded by an underscore, so legacy names like
   pl_walk_ne2 or tile_grass1 stay single images.
   IMG[key] = {img, frames, fw, fh}. If the same key is loaded twice, the entry
   with more frames wins (lets a real strip supersede a static placeholder). */
const IMG={};
async function loadAssets(base='assets/'){
  const files=await fetch(base+'manifest.json').then(r=>r.json());
  await Promise.all(files.map(f=>new Promise(res=>{
    const stem=f.replace(/\.(webp|png)$/i,'');
    const m=stem.match(/^(.+)_(\d+)$/);
    const key=m?m[1]:stem, frames=m?Math.max(1,+m[2]):1;
    const im=new Image();
    im.onload=()=>{if(!IMG[key]||frames>IMG[key].frames)
      IMG[key]={img:im,frames,fw:im.width/frames,fh:im.height};res();};
    im.onerror=()=>{console.warn('asset failed to load:',f);res();};
    im.src=base+f;})));
}
// draw one frame of an entry, horizontally centered on sx, anchored at anchorY fraction of its height
function drawFrame(ctx,e,fi,sx,sy,drawW,anchorY,flip){
  if(!e)return;
  const s=drawW/e.fw,h=e.fh*s;
  ctx.save();
  if(flip){ctx.translate(sx,0);ctx.scale(-1,1);ctx.translate(-sx,0);}
  ctx.drawImage(e.img,(fi%e.frames)*e.fw,0,e.fw,e.fh,sx-drawW/2,sy-h*anchorY,drawW,h);
  ctx.restore();
}

// ---------- animation state machine ----------
const ANIM_DEF={ // fps + looping per anim name; anything unlisted: {fps:10,loop:true}
  idle:{fps:4,loop:true}, walk:{fps:10,loop:true},
  attack:{fps:15,loop:false}, roll:{fps:12,loop:false},
  hurt:{fps:10,loop:false}, victory:{fps:6,loop:true},
};
class Animator{
  constructor(prefix){this.prefix=prefix;this.name='idle';this.t=0;}
  set(name){if(name!==this.name){this.name=name;this.t=0;}}
  update(d){this.t+=d;}
  /* Try to resolve a real animation strip `prefix_name_dir` (e.g. player_walk_sw).
     Returns {entry,frame} or null so the caller can fall back to legacy statics. */
  resolve(dir){
    const e=IMG[this.prefix+'_'+this.name+(dir?'_'+dir:'')];
    if(!e)return null;
    const def=ANIM_DEF[this.name]||{fps:10,loop:true};
    let f=Math.floor(this.t*def.fps);
    f=def.loop?f%e.frames:Math.min(f,e.frames-1);
    return {entry:e,frame:f};
  }
}

// ---------- shared tile drawing (game render + editor share these) ----------
const FLOOR_INFO={
  [T.G]:{keys:['tile_grass1','tile_grass2','tile_grass3'],top:7},
  [T.P]:{keys:['tile_dirt'],top:4},
  [T.W]:{keys:['tile_water'],top:2},
  [T.F]:{keys:['tile_dirt'],top:4},
  [T.B]:{keys:['tile_water'],top:2},
};
function diamondPath(ctx,sx,sy){ctx.beginPath();ctx.moveTo(sx,sy);ctx.lineTo(sx+HW,sy+HH);
  ctx.lineTo(sx,sy+TH);ctx.lineTo(sx-HW,sy+HH);ctx.closePath();}
function ellipsePath(ctx,x,y,rx,ry){ctx.beginPath();ctx.ellipse(x,y,Math.max(0,rx),Math.max(0,ry),0,0,6.28);}

function drawFloorTile(ctx,lv,x,y,sx,sy){
  const t=lv.get(x,y);
  const info=FLOOR_INFO[t]||FLOOR_INFO[T.G];
  const key=info.keys[t===T.G?tileVariant(x,y):0];
  const e=IMG[key];
  if(e)ctx.drawImage(e.img,sx-HW,sy-info.top,TW,TW*e.fh/e.fw);
  if(t===T.F){ctx.fillStyle='rgba(160,190,255,.14)';diamondPath(ctx,sx,sy);ctx.fill();}
}
function drawWallTile(ctx,lv,x,y,sx,sy){
  const e=IMG.tile_wallruin;if(!e)return;
  const flip=(lv.get(x,y-1)===T.R||lv.get(x,y+1)===T.R)&&!(lv.get(x-1,y)===T.R||lv.get(x+1,y)===T.R);
  const w=152,h=e.fh/e.fw*w;
  ctx.save();
  if(flip){ctx.translate(sx,0);ctx.scale(-1,1);ctx.translate(-sx,0);}
  ctx.drawImage(e.img,sx-w/2,sy+TH-h+6,w,h);
  ctx.restore();
}
function drawCrackedTile(ctx,x,y,sx,sy){
  const e=IMG.tile_wallgate;if(!e)return;
  const w=132,h=e.fh/e.fw*w;
  ctx.drawImage(e.img,sx-w/2,sy+TH-h+4,w,h);
  const t=performance.now()/400+x;
  ctx.fillStyle='rgba(255,255,190,'+(0.4+0.3*Math.sin(t))+')';
  ctx.beginPath();ctx.arc(sx+14,sy+8,3,0,6.28);ctx.fill();
}
function drawGateTile(ctx,sx,sy,runes){
  const e=IMG.tile_wallgate;if(!e)return;
  const w=170,h=e.fh/e.fw*w;
  const top=sy+TH-h+4;
  ctx.drawImage(e.img,sx-w/2,top,w,h);
  const n=runes?runes.length:3;
  for(let i=0;i<n;i++){
    const lit=runes?runes[i]:false;
    const rx=sx+(i-(n-1)/2)*30,ry=top+h*.18+Math.sin(performance.now()/300+i)*3;
    ctx.fillStyle=lit?'#ffd83d':'rgba(40,50,70,.8)';
    ctx.strokeStyle=lit?'#fff':'#222';ctx.lineWidth=2;
    ctx.beginPath();ctx.arc(rx,ry,8,0,6.28);ctx.fill();ctx.stroke();
    if(lit){ctx.fillStyle='rgba(255,216,61,.3)';ctx.beginPath();ctx.arc(rx,ry,14,0,6.28);ctx.fill();}
  }
}
function drawBridgeTile(ctx,sx,sy){
  // self-contained one-tile platform: align its deck diamond to the tile diamond
  const e=IMG.tile_bridge;if(!e)return;
  const w=138,h=e.fh/e.fw*w;
  ctx.drawImage(e.img,sx-w/2,sy-h*.13,w,h);
}
