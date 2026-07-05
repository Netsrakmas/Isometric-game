"use strict";
/* ============================================================
   GRID WARRIOR — Ruins of the Meadow
   Iso 2:1 grid · Zelda-style combat · 3-phase boss
   Level data comes from JSON (levels/*.json or the editor's
   test-play slot). Rendering/assets/anim helpers in core.js.
   ============================================================ */

// ---------- level (set in boot) ----------
let LVL=null;            // Level instance (mutable during play: gates open, walls break)
let PRISTINE=null;       // untouched copy of tile data for resets
const mget=(x,y)=>LVL.get(x,y);
const mset=(x,y,t)=>LVL.set(x,y,t);

// ---------- canvas ----------
const cv=document.getElementById('game'), cx=cv.getContext('2d');
let VW=0,VH=0,DPR=1;
function resize(){DPR=Math.min(devicePixelRatio||1,2);VW=innerWidth;VH=innerHeight;
  cv.width=VW*DPR;cv.height=VH*DPR;cv.style.width=VW+'px';cv.style.height=VH+'px';}
addEventListener('resize',resize);resize();
const ellipse=(x,y,rx,ry)=>ellipsePath(cx,x,y,rx,ry);

// ---------- storage (safe fallback) ----------
const store={mem:{},get(k){try{return localStorage.getItem(k)}catch(e){return this.mem[k]||null}},
  set(k,v){try{localStorage.setItem(k,v)}catch(e){this.mem[k]=v}},
  del(k){try{localStorage.removeItem(k)}catch(e){delete this.mem[k]}}};
const LEVEL_PARAM=new URLSearchParams(location.search).get('level');
const TEST_MODE=LEVEL_PARAM==='test';
const SAVE_KEY=TEST_MODE?'gridwarrior_v1_test':'gridwarrior_v1';

// ---------- audio ----------
const AudioSys={ac:null,muted:false,musicOn:true,mNodes:[],step:0,timer:null,
 init(){if(this.ac)return;try{this.ac=new (window.AudioContext||window.webkitAudioContext)();
   this.master=this.ac.createGain();this.master.gain.value=.8;this.master.connect(this.ac.destination);
   this.startMusic();}catch(e){}},
 tone(f,d,type='square',v=.15,slide=0,delay=0){if(!this.ac||this.muted)return;const t=this.ac.currentTime+delay;
   const o=this.ac.createOscillator(),g=this.ac.createGain();o.type=type;o.frequency.setValueAtTime(f,t);
   if(slide)o.frequency.exponentialRampToValueAtTime(Math.max(20,f+slide),t+d);
   g.gain.setValueAtTime(0,t);g.gain.linearRampToValueAtTime(v,t+.008);g.gain.exponentialRampToValueAtTime(.001,t+d);
   o.connect(g);g.connect(this.master);o.start(t);o.stop(t+d+.02);},
 noise(d,v=.2,fq=1200,delay=0){if(!this.ac||this.muted)return;const t=this.ac.currentTime+delay;
   const len=this.ac.sampleRate*d,buf=this.ac.createBuffer(1,len,this.ac.sampleRate),ch=buf.getChannelData(0);
   for(let i=0;i<len;i++)ch[i]=(Math.random()*2-1)*(1-i/len);
   const s=this.ac.createBufferSource();s.buffer=buf;const f=this.ac.createBiquadFilter();f.type='lowpass';f.frequency.value=fq;
   const g=this.ac.createGain();g.gain.value=v;s.connect(f);f.connect(g);g.connect(this.master);s.start(t);},
 sfx(n){switch(n){
   case 'swing': this.noise(.09,.10,3000);this.tone(300,.08,'sawtooth',.05,-160);break;
   case 'hit':   this.noise(.06,.22,900);this.tone(160,.09,'square',.12,-60);break;
   case 'pop':   this.tone(500,.12,'sine',.16,320);this.noise(.05,.1,2500);break;
   case 'hurt':  this.tone(220,.22,'sawtooth',.16,-140);break;
   case 'coin':  this.tone(1046,.06,'square',.09);this.tone(1568,.12,'square',.09,0,.06);break;
   case 'heart': this.tone(660,.1,'sine',.14);this.tone(880,.16,'sine',.14,0,.09);break;
   case 'roll':  this.noise(.14,.09,1400);break;
   case 'gate':  this.tone(90,.5,'sawtooth',.16,-30);this.noise(.4,.14,500);break;
   case 'rune':  this.tone(784,.15,'triangle',.16);this.tone(1175,.25,'triangle',.14,0,.12);break;
   case 'roar':  this.tone(80,.7,'sawtooth',.22,-35);this.noise(.6,.2,300);break;
   case 'slam':  this.noise(.25,.3,400);this.tone(60,.3,'sine',.28,-20);break;
   case 'shoot': this.tone(420,.1,'square',.08,-150);break;
   case 'break': this.noise(.2,.24,700);this.tone(140,.15,'square',.1,-60);break;
   case 'save':  this.tone(523,.1,'sine',.13);this.tone(659,.1,'sine',.13,0,.1);this.tone(784,.2,'sine',.13,0,.2);break;
   case 'charge':this.tone(150,.5,'sawtooth',.14,200);break;
   case 'fanfare':[523,659,784,1046].forEach((f,i)=>this.tone(f,.28,'triangle',.16,0,i*.14));
                  this.tone(1318,.6,'triangle',.15,0,.6);break;
 }},
 startMusic(){if(this.timer)return;
   const bass=[131,131,98,98,110,110,98,147], lead=[0,392,330,0,440,0,392,494, 523,0,440,392,0,330,0,294];
   let i=0;const beat=.24;
   this.timer=setInterval(()=>{if(this.muted||!this.musicOn||!this.ac)return;
     const st=game&&game.state==='play';
     this.tone(bass[i%8]/2,.2,'triangle',st?.05:.04);
     const L=lead[i%16];if(L)this.tone(L,.19,'square',.028);
     if(game&&game.bossActive&&i%2===0)this.noise(.04,.05,6000);
     i++;},beat*1000);}
};

// ---------- input ----------
const keys={};let touchMode=false;
addEventListener('keydown',e=>{if(e.repeat)return;keys[e.code]=true;AudioSys.init();
  if(e.code==='KeyM'){AudioSys.muted=!AudioSys.muted;}
  if(e.code==='Escape'||e.code==='KeyP')game&&game.togglePause();
  if(['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Space'].includes(e.code))e.preventDefault();
  game&&game.keyPressed(e.code);});
addEventListener('keyup',e=>{keys[e.code]=false;});
// touch controls
const stick={active:false,id:-1,ox:0,oy:0,dx:0,dy:0};
const sz=document.getElementById('stickZone');
function setTouch(){touchMode=true;document.body.classList.add('touch');}
addEventListener('touchstart',setTouch,{once:true,passive:true});
sz.addEventListener('pointerdown',e=>{stick.active=true;stick.id=e.pointerId;stick.ox=e.clientX;stick.oy=e.clientY;stick.dx=0;stick.dy=0;AudioSys.init();});
addEventListener('pointermove',e=>{if(stick.active&&e.pointerId===stick.id){
  const dx=e.clientX-stick.ox,dy=e.clientY-stick.oy,m=Math.hypot(dx,dy)||1,c=Math.min(m,52);
  stick.dx=dx/m*c/52;stick.dy=dy/m*c/52;}});
addEventListener('pointerup',e=>{if(e.pointerId===stick.id){stick.active=false;stick.dx=0;stick.dy=0;}});
document.getElementById('btnA').addEventListener('pointerdown',e=>{e.preventDefault();AudioSys.init();game&&game.keyPressed('KeyJ');});
document.getElementById('btnB').addEventListener('pointerdown',e=>{e.preventDefault();game&&game.keyPressed('KeyK');});
cv.addEventListener('pointerdown',e=>{AudioSys.init();game&&game.canvasTap(e.clientX,e.clientY);});

// ---------- enemy factory (also used for arena waves) ----------
function makeEnemy(def){
  switch(def.type){
    case 'blob':   return new Blob_(def.x,def.y);
    case 'goblin': return new Goblin(def.x,def.y,def.px??def.x,def.py??def.y);
    case 'turret': return new Turret(def.x,def.y);
  }
  console.warn('unknown enemy type',def.type);return new Blob_(def.x,def.y);
}
// unlessFlag lets a level entry disappear once a save flag is set (e.g. heartCont)
function flagActive(g,def){return !(def.unlessFlag&&g.save[def.unlessFlag]);}

// ---------- game object ----------
let game=null;

class Game{
constructor(){
  this.state='title';        // title | play | pause | dead | victory
  this.time=0;this.playTime=0;this.deaths=0;this.timeScale=1;this.shake=0;
  this.msg=null;this.msgT=0;this.fade=0;this.fadeDir=0;
  this.bossActive=false;this.bossIntro=0;
  this.cam={x:0,y:0};
  this.loadSave();
  this.resetWorld(true);
}
defaultSave(){return {checkpoint:'start',coins:0,deaths:0,heartCont:false,
  runes:LVL.arenas.map(()=>false),broken:[],playTime:0};}
loadSave(){
  let s=null;try{s=JSON.parse(store.get(SAVE_KEY));}catch(e){}
  this.save=s||this.defaultSave();
  // keep rune slots in sync with the level's arena count
  const n=LVL.arenas.length;
  if(!Array.isArray(this.save.runes)||this.save.runes.length!==n)
    this.save.runes=LVL.arenas.map((_,i)=>!!(this.save.runes&&this.save.runes[i]));
  this.hasSave=!!s;
}
persist(){this.save.playTime=this.playTime;this.save.deaths=this.deaths;
  store.set(SAVE_KEY,JSON.stringify(this.save));}
resetWorld(fromSave){
  const S=this.save;
  this.coins=S.coins;this.deaths=S.deaths||0;this.playTime=S.playTime||0;
  this.runes=S.runes.slice();this.brokenWalls=new Set(S.broken);
  // restore pristine tiles then re-apply persistent map changes
  LVL.tiles.set(PRISTINE);
  this.brokenWalls.forEach(k=>{const[x,y]=k.split(',').map(Number);mset(x,y,T.G);});
  if(LVL.boss&&this.runes.length&&this.runes.every(r=>r))mset(LVL.boss.gate.x,LVL.boss.gate.y,T.P);
  const cp=(S.checkpoint==='fountain'&&LVL.fountain)?LVL.fountain.respawn:LVL.playerStart;
  this.player=new Player(cp.x,cp.y,S.heartCont);
  this.enemies=[];this.pickups=[];this.projectiles=[];this.fx=[];this.floats=[];
  this.boss=null;this.bossActive=false;this.arenaGates=[];this.bossGateClosed=false;
  this.spawnWorld();
  this.arenas=this.makeArenas();
  this.cam.x=isoX(this.player.x,this.player.y);this.cam.y=isoY(this.player.x,this.player.y);
}
spawnWorld(){
  LVL.enemies.forEach(def=>{if(flagActive(this,def))this.enemies.push(makeEnemy(def));});
  LVL.pickups.forEach(def=>{if(flagActive(this,def))
    this.pickups.push({type:def.type,x:def.x,y:def.y,t:def.type==='coin'?Math.random()*6:0});});
  this.signs=LVL.signs;
}
makeArenas(){
  return LVL.arenas.map((a,id)=>({id,ix0:a.rect[0],iy0:a.rect[1],ix1:a.rect[2],iy1:a.rect[3],
    gates:a.gates,waves:a.waves.map(w=>()=>w.map(makeEnemy)),
    state:this.runes[id]?'cleared':'idle',wave:-1,alive:[]}));
}
// ---- flow ----
startNew(){store.del(SAVE_KEY);this.save=this.defaultSave();this.hasSave=false;
  this.playTime=0;this.resetWorld();this.state='play';
  this.showMsg('The ruins await. Find the guardian runes.',4);}
continueGame(){this.resetWorld(true);this.state='play';}
togglePause(){if(this.state==='play')this.state='pause';else if(this.state==='pause')this.state='play';}
keyPressed(code){
  const p=this.player;
  if(this.state==='title'&&(code==='Enter'||code==='Space'||code==='KeyJ')){this.hasSave?this.continueGame():this.startNew();return;}
  if(this.state==='dead'&&(code==='Enter'||code==='Space'||code==='KeyJ')){this.respawn();return;}
  if(this.state==='victory'&&code==='Enter'){this.state='title';this.loadSave();return;}
  if(this.state!=='play')return;
  if(code==='KeyJ'||code==='Space'||code==='KeyZ')p.tryAttack(this);
  if(code==='KeyK'||code==='ShiftLeft'||code==='ShiftRight'||code==='KeyX')p.tryRoll(this);
}
canvasTap(x,y){
  if(this.state==='title'){
    if(this.hasSave&&y>VH*.62+64&&y<VH*.62+116){this.startNew();return;}
    this.hasSave?this.continueGame():this.startNew();return;
  }
  if(this.state==='dead'){this.respawn();return;}
  if(this.state==='victory'){this.state='title';this.loadSave();return;}
  if(this.state==='pause'){this.state='play';return;}
  if(touchMode&&x>VW-70&&y<70)this.togglePause();
}
showMsg(t,d=3){this.msg=t;this.msgT=d;}
addFloat(x,y,text,col='#fff'){this.floats.push({x,y,text,col,t:1});}
checkpoint(){this.save.checkpoint='fountain';this.save.coins=this.coins;
  this.save.heartCont=this.player.hasCont;this.save.runes=this.runes.slice();
  this.save.broken=[...this.brokenWalls];this.persist();AudioSys.sfx('save');}
playerDied(){
  this.deaths++;this.state='dead';AudioSys.sfx('hurt');
  this.persist();
}
respawn(){this.resetWorld(true);this.state='play';}
winGame(){this.state='victory';AudioSys.sfx('fanfare');store.del(SAVE_KEY);}
// ---- update ----
update(dt){
  this.time+=dt;
  if(this.msgT>0)this.msgT-=dt;
  if(this.state!=='play')return;
  const ts=this.timeScale; const d=dt*ts;
  this.playTime+=dt;
  if(this.shake>0)this.shake=Math.max(0,this.shake-dt*30);
  if(this.timeScale<1)this.timeScale=Math.min(1,this.timeScale+dt*.6);
  const p=this.player;
  p.update(d,this);
  // camera
  let tx=isoX(p.x,p.y),ty=isoY(p.x,p.y)-30;
  this.cam.x=lerp(this.cam.x,tx,1-Math.pow(.0008,dt));
  this.cam.y=lerp(this.cam.y,ty,1-Math.pow(.0008,dt));
  // arenas
  this.arenas.forEach(a=>this.updateArena(a,d));
  // boss trigger
  const bt=LVL.boss&&LVL.boss.trigger;
  if(bt&&!this.bossActive&&!this.boss&&
     p.x>=bt[0]&&p.x<=bt[2]&&p.y>=bt[1]&&p.y<=bt[3]){
    this.startBoss();
  }
  if(this.boss)this.boss.update(d,this);
  // entities
  this.enemies.forEach(e=>e.update(d,this));
  this.enemies=this.enemies.filter(e=>!e.dead);
  this.projectiles.forEach(pr=>{
    pr.x+=pr.vx*d;pr.y+=pr.vy*d;pr.t-=d;
    if(SOLID(mget(Math.floor(pr.x),Math.floor(pr.y)))||pr.t<=0)pr.dead=true;
    if(!pr.dead&&!pr.friendly&&dist(pr,p)<.42&&p.hurt(this,pr.dmg||1,pr)){pr.dead=true;}
  });
  this.projectiles=this.projectiles.filter(pr=>!pr.dead);
  // pickups
  this.pickups.forEach(pk=>{pk.t+=d;
    const dd=dist(pk,p);
    if(pk.type==='coin'&&dd<1.1){pk.x=lerp(pk.x,p.x,10*d);pk.y=lerp(pk.y,p.y,10*d);}
    if(dd<.45){pk.dead=true;
      if(pk.type==='coin'){this.coins++;AudioSys.sfx('coin');}
      if(pk.type==='heart'){p.hp=Math.min(p.maxHp,p.hp+1);AudioSys.sfx('heart');this.addFloat(p.x,p.y,'+♥','#ff6b8d');}
      if(pk.type==='heartcont'){p.hasCont=true;p.maxHp+=2;p.hp=p.maxHp;AudioSys.sfx('fanfare');
        this.save.heartCont=true;this.save.coins=this.coins;this.persist();
        this.showMsg('Heart Container! Max health increased.',3.5);}
    }});
  this.pickups=this.pickups.filter(pk=>!pk.dead);
  // fx / floats
  this.fx.forEach(f=>{f.t-=d;f.x+=(f.vx||0)*d;f.y+=(f.vy||0)*d;if(f.grav)f.vy+=f.grav*d;
    if(f.kind==='seedArc'&&f.t<=0&&!f.landed){f.landed=true;
      const b=new Blob_(f.tx,f.ty);this.enemies.push(b);
      this.fx.push({kind:'dust',x:f.tx,y:f.ty,t:.3,max:.3});AudioSys.sfx('pop');}});
  this.fx=this.fx.filter(f=>f.t>0);
  this.floats.forEach(f=>{f.t-=dt;f.y-=dt*.8;});
  this.floats=this.floats.filter(f=>f.t>0);
  // fountain
  if(mget(Math.floor(p.x),Math.floor(p.y))===T.F){
    if(!this.atFountain){this.atFountain=true;
      if(p.hp<p.maxHp||this.save.checkpoint!=='fountain'){p.hp=p.maxHp;this.checkpoint();
        this.showMsg('Fully healed — progress saved.',2.5);}}
  } else this.atFountain=false;
}
updateArena(a,d){
  const p=this.player;
  if(a.state==='idle'){
    if(p.x>a.ix0&&p.x<a.ix1+1&&p.y>a.iy0&&p.y<a.iy1+1){
      a.state='active';a.wave=0;
      a.gates.forEach(g=>{this.arenaGates.push({x:g[0],y:g[1],a});});
      AudioSys.sfx('gate');this.shake=6;
      a.alive=a.waves[0]();a.alive.forEach(e=>{e.arena=a;this.enemies.push(e);
        this.fx.push({kind:'spawn',x:e.x,y:e.y,t:.4,max:.4});});
      this.showMsg('Guardian trial! Defeat all foes.',2.5);
    }
  } else if(a.state==='active'){
    a.alive=a.alive.filter(e=>!e.dead);
    if(a.alive.length===0){
      a.wave++;
      if(a.wave<a.waves.length){
        a.alive=a.waves[a.wave]();
        a.alive.forEach(e=>{e.arena=a;this.enemies.push(e);
          this.fx.push({kind:'spawn',x:e.x,y:e.y,t:.4,max:.4});});
      } else {
        a.state='cleared';this.runes[a.id]=true;
        this.arenaGates=this.arenaGates.filter(g=>g.a!==a);
        AudioSys.sfx('rune');this.shake=4;
        const cx2=(a.ix0+a.ix1)/2,cy2=(a.iy0+a.iy1)/2;
        this.pickups.push({type:'heart',x:cx2,y:cy2,t:0});
        for(let i=0;i<5;i++)this.pickups.push({type:'coin',x:cx2+Math.cos(i/5*6.28)*.8,y:cy2+Math.sin(i/5*6.28)*.8,t:0});
        this.save.coins=this.coins;this.save.runes=this.runes.slice();
        this.save.broken=[...this.brokenWalls];this.save.heartCont=p.hasCont;this.persist();
        const n=this.runes.filter(r=>r).length,total=this.runes.length;
        if(n<total)this.showMsg(`Rune ${n} of ${total} ignited!`,3);
        else {this.showMsg('All runes ignited — the boss gate is open!',4);
          if(LVL.boss)mset(LVL.boss.gate.x,LVL.boss.gate.y,T.P);AudioSys.sfx('gate');}
      }
    }
  }
}
gateBlocked(x,y){return this.arenaGates.some(g=>g.x===x&&g.y===y);}
startBoss(){
  this.bossActive=true;this.bossIntro=2.6;
  this.boss=new Boss(LVL.boss.spawn.x,LVL.boss.spawn.y);
  // close gate behind
  this.bossGateClosed=true;
  AudioSys.sfx('roar');this.shake=10;
  this.showMsg(LVL.boss.name||'THE GUARDIAN',3.2);
}
bossDefeated(){
  this.timeScale=.25;this.shake=8;
  AudioSys.sfx('fanfare');
  setTimeout(()=>{if(this.state==='play')this.winGame();},2600);
}
// wall breaking
tryBreakWall(x,y){
  const k=x+','+y;
  mset(x,y,T.G);this.brokenWalls.add(k);
  AudioSys.sfx('break');this.shake=5;
  for(let i=0;i<5;i++)this.pickups.push({type:'coin',x:x+.5+(Math.random()-.5)*.8,y:y+.5+(Math.random()-.5)*.8,t:0});
  for(let i=0;i<8;i++)this.fx.push({kind:'chip',x:x+.5,y:y+.3,vx:(Math.random()-.5)*3,vy:(Math.random()-.5)*3,t:.5,max:.5});
}
}

// ---------- movement helper ----------
function moveEntity(e,dx,dy,r,g){
  // slide against solid tiles + arena gates + boss gate closed
  const bg=LVL.boss&&LVL.boss.gate;
  const solidAt=(x,y)=>{
    const t=mget(Math.floor(x),Math.floor(y));
    if(SOLID(t))return true;
    if(g&&g.gateBlocked(Math.floor(x),Math.floor(y)))return true;
    if(g&&g.bossGateClosed&&bg&&Math.floor(x)===bg.x&&Math.floor(y)===bg.y)return true;
    return false;
  };
  let nx=e.x+dx;
  if(!solidAt(nx+Math.sign(dx)*r,e.y-r*.7)&&!solidAt(nx+Math.sign(dx)*r,e.y+r*.7))e.x=nx;
  let ny=e.y+dy;
  if(!solidAt(e.x-r*.7,ny+Math.sign(dy)*r)&&!solidAt(e.x+r*.7,ny+Math.sign(dy)*r))e.y=ny;
  e.x=clamp(e.x,.5,LVL.w-.5);e.y=clamp(e.y,.5,LVL.h-.5);
}

// ---------- Player ----------
class Player{
constructor(x,y,hasCont){
  this.x=x;this.y=y;this.r=.32;
  this.hasCont=!!hasCont;this.maxHp=6+(hasCont?2:0);this.hp=this.maxHp;
  this.fx=1;this.fy=1;                 // facing (grid dir)
  this.speed=3.5;this.moving=false;this.animT=0;
  this.attackT=0;this.combo=0;this.comboReset=0;this.swungHit=false;
  this.rollT=0;this.rollCd=0;this.rvx=0;this.rvy=0;
  this.inv=0;this.kbx=0;this.kby=0;this.hurtT=0;
  this.animator=new Animator('player');
}
get rolling(){return this.rollT>0;}
get attacking(){return this.attackT>0;}
tryAttack(g){
  if(this.rolling||this.attackT>0.08)return;
  if(this.comboReset<=0)this.combo=0;
  this.attackT=.3;this.comboReset=.75;this.swungHit=false;
  this.animator.set('attack');this.animator.t=0;   // restart even mid-combo
  AudioSys.sfx('swing');
  const a=Math.atan2(this.fy,this.fx);
  g.fx.push({kind:'slash',x:this.x+this.fx*.75,y:this.y+this.fy*.75,ang:a,t:.16,max:.16,big:this.combo===2});
  // resolve hits shortly after start (mid-swing)
  const dmg=this.combo===2?2:1;
  const hx=this.x+this.fx*1.0,hy=this.y+this.fy*1.0;
  // enemies
  g.enemies.forEach(e=>{
    if(Math.hypot(e.x-hx,e.y-hy)<1.15+ (e.r||.3)){e.takeHit(g,dmg,this);}
  });
  // boss
  if(g.boss&&!g.boss.dead&&Math.hypot(g.boss.x-hx,g.boss.y-hy)<1.6+1.2){g.boss.takeHit(g,dmg);}
  // deflect projectiles
  g.projectiles.forEach(pr=>{if(!pr.friendly&&Math.hypot(pr.x-hx,pr.y-hy)<1.25){pr.dead=true;
    AudioSys.sfx('pop');g.fx.push({kind:'spark',x:pr.x,y:pr.y,t:.2,max:.2});}});
  // cracked walls
  for(let ox=-1;ox<=1;ox++)for(let oy=-1;oy<=1;oy++){
    const tx=Math.floor(hx+ox*.4),ty=Math.floor(hy+oy*.4);
    if(mget(tx,ty)===T.C)g.tryBreakWall(tx,ty);
  }
  this.combo=(this.combo+1)%3;
}
tryRoll(g){
  if(this.rolling||this.rollCd>0)return;
  this.rollT=.4;this.rollCd=1.2;this.inv=Math.max(this.inv,.55);
  let mx=this.mx||this.fx,my=this.my||this.fy;
  const m=Math.hypot(mx,my)||1;
  this.rvx=mx/m*6.25;this.rvy=my/m*6.25;
  AudioSys.sfx('roll');
}
hurt(g,dmg,src){
  if(this.inv>0||this.rolling||g.state!=='play')return false;
  if(g.boss&&g.boss.dead)return false;   // the fight is won — no deaths during the victory slow-mo
  this.hp-=dmg*2>=1?Math.round(dmg*2):1; // dmg in hearts → halves
  this.hp=Math.max(0,this.hp);
  this.inv=.9;this.hurtT=.35;g.shake=7;
  AudioSys.sfx('hurt');
  const dx=this.x-(src?src.x:this.x),dy=this.y-(src?src.y:this.y),m=Math.hypot(dx,dy)||1;
  this.kbx=dx/m*7;this.kby=dy/m*7;
  g.addFloat(this.x,this.y,'-'+(dmg),'#ff5b5b');
  if(this.hp<=0)g.playerDied();
  return true;
}
update(d,g){
  this.inv=Math.max(0,this.inv-d);this.hurtT=Math.max(0,this.hurtT-d);
  this.rollCd=Math.max(0,this.rollCd-d);this.comboReset=Math.max(0,this.comboReset-d);
  if(this.attackT>0)this.attackT-=d;
  // input vector (screen space → grid space)
  let sx=0,sy=0;
  if(keys.KeyW||keys.ArrowUp)sy-=1; if(keys.KeyS||keys.ArrowDown)sy+=1;
  if(keys.KeyA||keys.ArrowLeft)sx-=1; if(keys.KeyD||keys.ArrowRight)sx+=1;
  if(stick.active){sx+=stick.dx;sy+=stick.dy;}
  // screen dir → grid dir  (screen right = +gx -gy ; screen down = +gx +gy)
  let gx=sx+sy, gy=sy-sx;
  const m=Math.hypot(gx,gy);
  this.moving=m>.15&&!this.attacking;
  if(m>.15){gx/=m;gy/=m;this.mx=gx;this.my=gy;
    if(!this.attacking){this.fx=gx;this.fy=gy;}}
  else {this.mx=0;this.my=0;}
  let vx=0,vy=0;
  if(this.rolling){this.rollT-=d;vx=this.rvx;vy=this.rvy;}
  else if(this.moving){vx=gx*this.speed;vy=gy*this.speed;}
  // knockback
  vx+=this.kbx;vy+=this.kby;
  this.kbx*=Math.pow(.0001,d);this.kby*=Math.pow(.0001,d);
  moveEntity(this,vx*d,vy*d,this.r,g);
  if(this.moving)this.animT+=d*8;
  // animation state
  let an='idle';
  if(this.hurtT>0)an='hurt';
  else if(this.rolling)an='roll';
  else if(this.attacking)an='attack';
  else if(this.moving)an='walk';
  this.animator.set(an);this.animator.update(d);
  // contact damage from enemies
  g.enemies.forEach(e=>{if(!e.dead&&e.contact&&dist(e,this)<(e.r+this.r))this.hurt(g,e.contact,e);});
  // no boss contact damage while it's stunned/exposed — that's the punish window
  if(g.boss&&!g.boss.dead&&g.boss.state!=='stunned'&&g.boss.exposed<=0&&
     dist(g.boss,this)<1.35)this.hurt(g,1,g.boss);
}
}

// ---------- Enemies ----------
class Blob_{
constructor(x,y){this.x=x;this.y=y;this.hp=2;this.r=.34;this.contact=.5;
  this.hopT=Math.random()*1;this.dead=false;this.flash=0;this.kb={x:0,y:0};this.squish=0;}
takeHit(g,dmg,src){this.hp-=dmg;this.flash=.12;AudioSys.sfx('hit');g.shake=Math.max(g.shake,3);
  const dx=this.x-src.x,dy=this.y-src.y,m=Math.hypot(dx,dy)||1;this.kb={x:dx/m*8,y:dy/m*8};
  g.addFloat(this.x,this.y,dmg,'#ffe36b');
  if(this.hp<=0)this.die(g);}
die(g){this.dead=true;AudioSys.sfx('pop');
  for(let i=0;i<6;i++)g.fx.push({kind:'goo',x:this.x,y:this.y,vx:(Math.random()-.5)*4,vy:(Math.random()-.5)*4,t:.5,max:.5});
  const r=Math.random();if(r<.2)g.pickups.push({type:'heart',x:this.x,y:this.y,t:0});
  else if(r<.8)g.pickups.push({type:'coin',x:this.x,y:this.y,t:0});}
update(d,g){
  this.flash=Math.max(0,this.flash-d);
  this.x+=this.kb.x*d;this.y+=this.kb.y*d;this.kb.x*=Math.pow(.001,d);this.kb.y*=Math.pow(.001,d);
  const p=g.player,dd=dist(this,p);
  this.hopT-=d;
  if(this.hopT<=0){
    this.hopT=.8+Math.random()*.4;this.squish=.35;
    if(dd<6){const dx=p.x-this.x,dy=p.y-this.y,m=Math.hypot(dx,dy)||1;
      this.vx=dx/m*2.6;this.vy=dy/m*2.6;}
    else {const a=Math.random()*6.28;this.vx=Math.cos(a)*.8;this.vy=Math.sin(a)*.8;}
    this.vt=.35;
  }
  this.squish=Math.max(0,this.squish-d*1.4);
  if(this.vt>0){this.vt-=d;moveEntity(this,(this.vx||0)*d,(this.vy||0)*d,this.r,g);}
}
}
class Goblin{
constructor(x,y,px,py){this.x=x;this.y=y;this.hp=4;this.r=.36;this.contact=0;
  this.pa={x,y};this.pb={x:px,y:py};this.tgt=this.pb;this.state='patrol';this.t=0;
  this.dead=false;this.flash=0;this.kb={x:0,y:0};this.fx=1;this.fy=0;this.lx=0;this.ly=0;}
takeHit(g,dmg,src){this.hp-=dmg;this.flash=.12;AudioSys.sfx('hit');g.shake=Math.max(g.shake,3);
  const dx=this.x-src.x,dy=this.y-src.y,m=Math.hypot(dx,dy)||1;this.kb={x:dx/m*6,y:dy/m*6};
  g.addFloat(this.x,this.y,dmg,'#ffe36b');
  if(this.hp<=0){this.dead=true;AudioSys.sfx('pop');
    for(let i=0;i<8;i++)g.fx.push({kind:'chip',x:this.x,y:this.y,vx:(Math.random()-.5)*4,vy:(Math.random()-.5)*4,t:.5,max:.5});
    const r=Math.random();if(r<.25)g.pickups.push({type:'heart',x:this.x,y:this.y,t:0});
    else if(r<.85)g.pickups.push({type:'coin',x:this.x,y:this.y,t:0});}}
update(d,g){
  this.flash=Math.max(0,this.flash-d);
  this.x+=this.kb.x*d;this.y+=this.kb.y*d;this.kb.x*=Math.pow(.001,d);this.kb.y*=Math.pow(.001,d);
  const p=g.player,dd=dist(this,p);this.t-=d;
  const face=(tx,ty)=>{const dx=tx-this.x,dy=ty-this.y,m=Math.hypot(dx,dy)||1;this.fx=dx/m;this.fy=dy/m;return m;};
  switch(this.state){
    case 'patrol':{
      const m=face(this.tgt.x,this.tgt.y);
      if(m<.2)this.tgt=this.tgt===this.pa?this.pb:this.pa;
      moveEntity(this,this.fx*1.5*d,this.fy*1.5*d,this.r,g);
      if(dd<7)this.state='chase';
      break;}
    case 'chase':{
      const m=face(p.x,p.y);
      if(m>9){this.state='patrol';break;}
      if(m<2.2){this.state='tele';this.t=.5;this.lx=this.fx;this.ly=this.fy;}
      else moveEntity(this,this.fx*2.4*d,this.fy*2.4*d,this.r,g);
      break;}
    case 'tele':
      if(this.t<=0){this.state='lunge';this.t=.28;AudioSys.sfx('swing');}
      break;
    case 'lunge':{
      moveEntity(this,this.lx*8*d,this.ly*8*d,this.r,g);
      if(dist(this,p)<.85)p.hurt(g,1,this);
      if(this.t<=0){this.state='recover';this.t=1.4;}
      break;}
    case 'recover':
      if(this.t<=0)this.state='chase';
      break;
  }
}
}
class Turret{
constructor(x,y){this.x=x+.0;this.y=y+.0;this.hp=3;this.r=.38;this.contact=.5;
  this.cd=1+Math.random();this.dead=false;this.flash=0;this.shootAnim=0;}
takeHit(g,dmg,src){this.hp-=dmg;this.flash=.12;AudioSys.sfx('hit');
  g.addFloat(this.x,this.y,dmg,'#ffe36b');
  if(this.hp<=0){this.dead=true;AudioSys.sfx('pop');
    for(let i=0;i<7;i++)g.fx.push({kind:'goo',x:this.x,y:this.y,vx:(Math.random()-.5)*4,vy:(Math.random()-.5)*4,t:.5,max:.5,green:true});
    if(Math.random()<.7)g.pickups.push({type:'coin',x:this.x,y:this.y,t:0});}}
update(d,g){
  this.flash=Math.max(0,this.flash-d);this.shootAnim=Math.max(0,this.shootAnim-d);
  const p=g.player,dd=dist(this,p);
  this.cd-=d;
  if(dd<8&&this.cd<=0){
    this.cd=2.5;this.shootAnim=.3;AudioSys.sfx('shoot');
    const dx=p.x-this.x,dy=p.y-this.y,m=Math.hypot(dx,dy)||1;
    g.projectiles.push({x:this.x,y:this.y-.1,vx:dx/m*5,vy:dy/m*5,t:2.4,dmg:.5,seed:true});
  }
}
}

// ---------- Boss ----------
class Boss{
constructor(x,y){
  this.x=x;this.y=y;this.hp=40;this.maxHp=40;this.r=1.25;
  this.state='intro';this.t=2.4;this.pose='idle';this.dead=false;
  this.flash=0;this.exposed=0;this.slams=0;this.target=null;this.ring=null;
  this.cvx=0;this.cvy=0;this.thorns=false;this.facing=1;
  this.poseT=0;this.lastPose='idle';
}
phase(){return this.hp>this.maxHp*.66?1:this.hp>this.maxHp*.33?2:3;}
arena(){return (LVL.boss&&LVL.boss.arena)||[0,0,LVL.w,LVL.h];}
takeHit(g,dmg){
  if(this.dead||this.state==='intro')return;
  const mult=(this.exposed>0||this.state==='stunned')?2:1;
  this.hp-=dmg*mult;this.flash=.12;AudioSys.sfx('hit');g.shake=Math.max(g.shake,4);
  g.addFloat(this.x,this.y-1.5,dmg*mult,mult>1?'#ffd83d':'#ffe36b');
  if(this.hp<=0){this.hp=0;this.dead=true;this.pose='dead';
    for(let i=0;i<26;i++)g.fx.push({kind:'petal',x:this.x+(Math.random()-.5)*2.4,y:this.y+(Math.random()-.5)*2,
      vx:(Math.random()-.5)*2,vy:-Math.random()*2,grav:1.5,t:2.2,max:2.2});
    g.bossDefeated();}
  else if(this.phase()===3&&!this.thorns){this.thorns=true;AudioSys.sfx('roar');
    g.showMsg('The arena sprouts thorns — stay off the edges!',3);}
}
update(d,g){
  if(this.dead)return;
  this.flash=Math.max(0,this.flash-d);this.exposed=Math.max(0,this.exposed-d);
  const p=g.player;
  this.facing=(isoX(p.x,p.y)>isoX(this.x,this.y))?1:-1;
  this.t-=d;
  const ph=this.phase();
  const ar=this.arena();
  // thorn damage
  if(this.thorns){
    if(p.x<ar[0]||p.x>ar[2]||p.y<ar[1]||p.y>ar[3]){if(p.hurt(g,.5,{x:p.x-0.01,y:p.y})){} }
  }
  switch(this.state){
    case 'intro':
      this.pose='idle';
      if(this.t<=0){this.state='walk';this.t=1.4;}
      break;
    case 'walk':{
      this.pose='idle';
      const dx=p.x-this.x,dy=p.y-this.y,m=Math.hypot(dx,dy)||1;
      const sp=ph===1?1.1:1.5;
      moveEntity(this,dx/m*sp*d,dy/m*sp*d,.9,g);
      if(this.t<=0){
        // choose attack
        const opts=['slam','stomp'];
        if(ph>=2)opts.push('barrage');
        if(ph>=3)opts.push('charge','charge');
        const pick=opts[Math.floor(Math.random()*opts.length)];
        if(pick==='slam'){this.state='slamTele';this.t=.9;this.slams=0;
          this.target={x:p.x,y:p.y};this.pose='raise';}
        if(pick==='stomp'){this.state='stompTele';this.t=.7;this.pose='stomp';}
        if(pick==='barrage'){this.state='barrage';this.t=1.1;this.pose='barrage';AudioSys.sfx('roar');
          this.thrown=0;}
        if(pick==='charge'){this.state='chargeTele';this.t=.8;this.pose='charge';AudioSys.sfx('charge');}
      }
      break;}
    case 'slamTele':
      this.pose='raise';
      if(this.t<=0){
        this.state='slamHit';this.t=.35;this.pose='slam';
        AudioSys.sfx('slam');g.shake=10;
        const tg=this.target;
        for(let i=0;i<10;i++)g.fx.push({kind:'chip',x:tg.x,y:tg.y,vx:(Math.random()-.5)*5,vy:(Math.random()-.5)*5,t:.5,max:.5});
        if(dist(tg,p)<2&&!p.rolling)p.hurt(g,1,tg);
        this.slams++;
      }
      break;
    case 'slamHit':
      if(this.t<=0){
        const maxSlams=ph>=2?3:1;
        if(this.slams<maxSlams){this.state='slamTele';this.t=.75;this.target={x:p.x,y:p.y};this.pose='raise';}
        else {this.exposed=2;this.state='rest';this.t=2;this.pose='stun';
          g.addFloat(this.x,this.y-2,'CORE EXPOSED!','#ffd83d');}
      }
      break;
    case 'stompTele':
      if(this.t<=0){this.state='rest';this.t=1.1;this.pose='stomp';
        AudioSys.sfx('slam');g.shake=8;
        this.ring={x:this.x,y:this.y,r:0};g.fx.push({kind:'dust',x:this.x,y:this.y,t:.4,max:.4});
        if(!this.ringHint){this.ringHint=true;g.showMsg('Roll through the shockwave ring!',2.8);}}
      break;
    case 'barrage':
      if(this.thrown<5&&this.t<1.1-(this.thrown+1)*.18){
        this.thrown++;
        const a=Math.random()*6.28,dd2=1.5+Math.random()*3;
        const lx=clamp(p.x+Math.cos(a)*dd2*.4+(Math.random()-.5)*2,ar[0]-.1,ar[2]+.1);
        const ly=clamp(p.y+Math.sin(a)*dd2*.4+(Math.random()-.5)*2,ar[1]-.1,ar[3]+.1);
        g.fx.push({kind:'seedArc',x:this.x,y:this.y-1.6,tx:lx,ty:ly,t:.9,max:.9,g});
        AudioSys.sfx('shoot');
      }
      if(this.t<=0){this.state='walk';this.t=1.2;}
      break;
    case 'chargeTele':
      if(this.t<=0){
        const dx=p.x-this.x,dy=p.y-this.y,m=Math.hypot(dx,dy)||1;
        this.cvx=dx/m*7.5;this.cvy=dy/m*7.5;
        this.state='charging';this.t=3;AudioSys.sfx('roar');
      }
      break;
    case 'charging':{
      this.pose='charge';
      const ox=this.x,oy=this.y;
      moveEntity(this,this.cvx*d,this.cvy*d,.9,g);
      if(dist(this,p)<1.5&&!p.rolling)p.hurt(g,1,this);
      const moved=Math.hypot(this.x-ox,this.y-oy), want=Math.hypot(this.cvx,this.cvy)*d;
      if((want>0&&moved<want*.45)||this.t<=0){
        this.state='stunned';this.t=3;this.pose='stun';AudioSys.sfx('slam');g.shake=12;
        g.addFloat(this.x,this.y-2.2,'STUNNED!','#ffd83d');
      }
      break;}
    case 'stunned':
      this.pose='stun';
      if(this.t<=0){this.state='walk';this.t=1.2;}
      break;
    case 'rest':
      if(this.pose!=='stun')this.pose='idle';
      if(this.t<=0){this.state='walk';this.t=ph===1?1.6:1.1;}
      break;
  }
  // ring expansion — slower than run speed (3.5) and the roll (6.25), so both
  // running and rolling in ANY direction escape it; only standing still is punished
  if(this.ring){
    this.ring.r+=d*3.3;
    const dd=dist(this.ring,p);
    if(Math.abs(dd-this.ring.r)<.35&&!p.rolling&&p.inv<=0)p.hurt(g,.5,this.ring);
    if(this.ring.r>6.5)this.ring=null;
  }
  if(this.pose==='idle'&&ph>=2)this.pose='p2idle';
  // pose animation timer (drives multi-frame boss strips when present)
  if(this.pose!==this.lastPose){this.poseT=0;this.lastPose=this.pose;}
  this.poseT+=d;
}
}

// ---------- drawing ----------
function tileScreen(x,y,cam){return [isoX(x,y)-cam.x+VW/2, isoY(x,y)-cam.y+VH/2];}

function render(g){
  cx.setTransform(DPR,0,0,DPR,0,0);
  cx.imageSmoothingEnabled=true;
  // bg
  const grd=cx.createLinearGradient(0,0,0,VH);
  grd.addColorStop(0,'#7ec4e8');grd.addColorStop(1,'#4a7fb5');
  cx.fillStyle=grd;cx.fillRect(0,0,VW,VH);
  if(g.state==='title'){renderTitle(g);return;}
  const cam={x:g.cam.x,y:g.cam.y};
  if(g.shake>0){cam.x+=(Math.random()-.5)*g.shake;cam.y+=(Math.random()-.5)*g.shake;}
  // visible tile range (loose)
  const cgx=(cam.x/HW+cam.y/HH)/2, cgy=(cam.y/HH-cam.x/HW)/2;
  const range=Math.ceil(Math.max(VW/TW,VH/TH))+6;
  const x0=clamp(Math.floor(cgx-range),0,LVL.w-1),x1=clamp(Math.ceil(cgx+range),0,LVL.w-1);
  const y0=clamp(Math.floor(cgy-range),0,LVL.h-1),y1=clamp(Math.ceil(cgy+range),0,LVL.h-1);
  // ---- floor pass ----
  for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++){
    const [sx,sy]=tileScreen(x,y,cam);
    if(sx<-TW||sx>VW+TW||sy<-TH*2||sy>VH+TH*2)continue;
    drawFloorTile(cx,LVL,x,y,sx,sy);
  }
  // ---- object pass (depth-sorted) ----
  const items=[];
  for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++){
    const t=mget(x,y);
    if(t===T.R)items.push({d:x+y,draw:()=>{const[sx,sy]=tileScreen(x,y,cam);drawWallTile(cx,LVL,x,y,sx,sy);}});
    if(t===T.C)items.push({d:x+y,draw:()=>{const[sx,sy]=tileScreen(x,y,cam);drawCrackedTile(cx,x,y,sx,sy);}});
    if(t===T.GATE)items.push({d:x+y,draw:()=>{const[sx,sy]=tileScreen(x,y,cam);drawGateTile(cx,sx,sy,g.runes);}});
    if(t===T.B)items.push({d:x+y-0.3,draw:()=>{const[sx,sy]=tileScreen(x,y,cam);drawBridgeTile(cx,sx,sy);}});
  }
  if(g.bossGateClosed&&g.bossActive&&LVL.boss){const bg=LVL.boss.gate;
    items.push({d:bg.x+bg.y,draw:()=>{const[sx,sy]=tileScreen(bg.x,bg.y,cam);drawGateTile(cx,sx,sy,g.runes);}});}
  g.arenaGates.forEach(gt=>items.push({d:gt.x+gt.y,draw:()=>drawThornGate(gt.x,gt.y,cam,g)}));
  g.signs.forEach(s=>items.push({d:s.x+s.y,draw:()=>drawSign(s,cam,g)}));
  if(LVL.fountain){const f=LVL.fountain;
    items.push({d:f.x+f.y-1,draw:()=>drawFountain(f.x,f.y,cam,g)});}
  g.pickups.forEach(p=>items.push({d:p.x+p.y,draw:()=>drawPickup(p,cam,g)}));
  g.enemies.forEach(e=>items.push({d:e.x+e.y,draw:()=>drawEnemy(e,cam,g)}));
  if(g.boss)items.push({d:g.boss.x+g.boss.y+1,draw:()=>drawBoss(g.boss,cam,g)});
  items.push({d:g.player.x+g.player.y,draw:()=>drawPlayer(g.player,cam,g)});
  g.fx.forEach(f=>items.push({d:f.x+f.y+2,draw:()=>drawFx(f,cam,g)}));
  items.sort((a,b)=>a.d-b.d);
  items.forEach(i=>i.draw());
  // boss telegraphs above all for clarity
  if(g.boss&&!g.boss.dead){
    const b=g.boss;
    if(b.state==='slamTele'&&b.target){
      const [sx,sy]=tileScreen(b.target.x,b.target.y,cam);
      const pr=1-Math.max(0,b.t)/0.9;
      cx.strokeStyle='rgba(255,60,60,.85)';cx.lineWidth=4;
      ellipse(sx,sy,2*HW,2*HH);cx.stroke();
      cx.fillStyle='rgba(255,60,60,.18)';ellipse(sx,sy,2*HW*pr,2*HH*pr);cx.fill();
    }
    if(b.ring){
      const [sx,sy]=tileScreen(b.ring.x,b.ring.y,cam);
      cx.strokeStyle='rgba(180,255,120,.9)';cx.lineWidth=7;
      ellipse(sx,sy,b.ring.r*HW,b.ring.r*HH);cx.stroke();
      cx.strokeStyle='rgba(255,255,255,.5)';cx.lineWidth=2;
      ellipse(sx,sy,b.ring.r*HW,b.ring.r*HH);cx.stroke();
    }
    if(b.thorns)drawThorns(cam,g);
  }
  // projectiles above
  g.projectiles.forEach(pr=>{
    const [sx,sy]=tileScreen(pr.x,pr.y,cam);
    cx.fillStyle='#7cc24a';cx.strokeStyle='#2d4d17';cx.lineWidth=2.5;
    cx.beginPath();cx.arc(sx,sy-14,9,0,6.28);cx.fill();cx.stroke();
    cx.fillStyle='#b6e88a';cx.beginPath();cx.arc(sx-3,sy-17,3,0,6.28);cx.fill();
  });
  // floats
  g.floats.forEach(f=>{
    const [sx,sy]=tileScreen(f.x,f.y,cam);
    cx.font='bold 20px Trebuchet MS';cx.textAlign='center';
    cx.strokeStyle='rgba(0,0,0,.6)';cx.lineWidth=4;cx.strokeText(f.text,sx,sy-60);
    cx.fillStyle=f.col;cx.fillText(f.text,sx,sy-60);
  });
  renderHUD(g);
  if(g.state==='pause')renderOverlayMenu(g);
  if(g.state==='dead')renderDead(g);
  if(g.state==='victory')renderVictory(g);
}

function drawThornGate(x,y,cam){
  const [sx,sy]=tileScreen(x,y,cam);
  cx.strokeStyle='#5a3a1e';cx.fillStyle='#7a5230';cx.lineWidth=3;
  for(let i=-2;i<=2;i++){
    const bx=sx+i*20,by=sy+HH+8;
    cx.beginPath();cx.moveTo(bx-7,by);cx.lineTo(bx,by-42-Math.abs(i)*-6);cx.lineTo(bx+7,by);cx.closePath();
    cx.fill();cx.stroke();
  }
}
function drawSign(s,cam,g){
  const [sx,sy]=tileScreen(s.x,s.y,cam);
  cx.fillStyle='#7a5230';cx.fillRect(sx-3,sy+2,6,26);
  cx.fillStyle='#a9743f';cx.strokeStyle='#5a3a1e';cx.lineWidth=3;
  cx.beginPath();cx.roundRect(sx-26,sy-22,52,28,6);cx.fill();cx.stroke();
  cx.fillStyle='#5a3a1e';cx.fillRect(sx-18,sy-14,36,3);cx.fillRect(sx-18,sy-8,28,3);
  if(dist(s,g.player)<1.8){
    cx.font='15px Trebuchet MS';
    const w2=cx.measureText(s.text).width+24;
    cx.fillStyle='rgba(20,26,40,.92)';
    cx.beginPath();cx.roundRect(sx-w2/2,sy-78,w2,34,10);cx.fill();
    cx.strokeStyle='rgba(255,255,255,.35)';cx.lineWidth=1.5;cx.stroke();
    cx.fillStyle='#fff';cx.textAlign='center';cx.fillText(s.text,sx,sy-56);
  }
}
function drawFountain(x,y,cam,g){
  const [sx,sy]=tileScreen(x,y,cam);
  const t=performance.now()/1000;
  cx.fillStyle='#9aa4b5';cx.strokeStyle='#5c6675';cx.lineWidth=4;
  ellipse(sx,sy+8,58,29);cx.fill();cx.stroke();
  cx.fillStyle='#3fa9f5';ellipse(sx,sy+8,46,22);cx.fill();
  cx.fillStyle='#8fd4ff';ellipse(sx,sy+7,46*.7,22*.7);cx.fill();
  // pillar + spray
  cx.fillStyle='#b6c0d0';cx.fillRect(sx-7,sy-38,14,44);
  cx.strokeStyle='#5c6675';cx.strokeRect(sx-7,sy-38,14,44);
  for(let i=0;i<5;i++){
    const a=t*3+i;
    cx.fillStyle='rgba(180,225,255,.8)';
    cx.beginPath();cx.arc(sx+Math.sin(a)*14,sy-40-((t*40+i*17)%34),3.2,0,6.28);cx.fill();
  }
  cx.fillStyle='rgba(255,255,255,'+(.4+.2*Math.sin(t*4))+')';
  cx.beginPath();cx.arc(sx+20,sy-30,2.5,0,6.28);cx.fill();
}
function drawPickup(p,cam,g){
  const [sx,sy]=tileScreen(p.x,p.y,cam);
  const bob=Math.sin(p.t*4)*4;
  if(p.type==='coin'){
    const sq=Math.abs(Math.sin(p.t*3.5));
    cx.fillStyle='#ffd23d';cx.strokeStyle='#a06a00';cx.lineWidth=2.5;
    ellipse(sx,sy-14+bob,9*Math.max(.25,sq),10);cx.fill();cx.stroke();
    cx.fillStyle='#fff2b0';ellipse(sx-2*sq,sy-17+bob,2.5*sq,2.5);cx.fill();
  } else if(p.type==='heart'||p.type==='heartcont'){
    const s2=p.type==='heartcont'?1.7:1;
    drawHeart(sx,sy-16+bob,11*s2,'#ff5b7d','#8d1330');
    if(p.type==='heartcont'){cx.strokeStyle='rgba(255,255,255,.7)';cx.lineWidth=2;
      ellipse(sx,sy-16+bob,20,20);cx.stroke();}
  }
}
function drawHeart(x,y,s,fill,stroke){
  cx.fillStyle=fill;cx.strokeStyle=stroke;cx.lineWidth=Math.max(2,s*.18);
  cx.beginPath();
  cx.moveTo(x,y+s*.85);
  cx.bezierCurveTo(x-s*1.2,y,x-s*.7,y-s*.9,x,y-s*.25);
  cx.bezierCurveTo(x+s*.7,y-s*.9,x+s*1.2,y,x,y+s*.85);
  cx.closePath();cx.fill();cx.stroke();
}
function drawEnemy(e,cam,g){
  const [sx,sy]=tileScreen(e.x,e.y,cam);
  cx.save();
  if(e.flash>0){cx.filter='brightness(2.2)';}
  if(e instanceof Blob_){
    const sq=1+e.squish*.7, sqh=1-e.squish*.5;
    cx.fillStyle='rgba(0,0,0,.22)';ellipse(sx,sy+2,16,7);cx.fill();
    cx.fillStyle='#5fc94e';cx.strokeStyle='#245c1a';cx.lineWidth=3;
    ellipse(sx,sy-11*sqh,15*sq,13*sqh);cx.fill();cx.stroke();
    cx.fillStyle='#a5eb8f';ellipse(sx-4,sy-16*sqh,5,4);cx.fill();
    cx.fillStyle='#16290f';
    cx.beginPath();cx.arc(sx-5,sy-11*sqh,2.4,0,6.28);cx.arc(sx+5,sy-11*sqh,2.4,0,6.28);cx.fill();
  } else if(e instanceof Goblin){
    cx.fillStyle='rgba(0,0,0,.22)';ellipse(sx,sy+2,15,7);cx.fill();
    const tele=e.state==='tele';
    // body
    cx.fillStyle=tele&&Math.floor(performance.now()/90)%2?'#ff6a5a':'#c05545';
    cx.strokeStyle='#5c1e14';cx.lineWidth=3;
    ellipse(sx,sy-15,12,14);cx.fill();cx.stroke();
    // ears
    cx.beginPath();cx.moveTo(sx-10,sy-24);cx.lineTo(sx-19,sy-30);cx.lineTo(sx-8,sy-29);cx.closePath();cx.fill();cx.stroke();
    cx.beginPath();cx.moveTo(sx+10,sy-24);cx.lineTo(sx+19,sy-30);cx.lineTo(sx+8,sy-29);cx.closePath();cx.fill();cx.stroke();
    // eyes
    cx.fillStyle='#ffe36b';cx.beginPath();cx.arc(sx-4,sy-19,2.6,0,6.28);cx.arc(sx+4,sy-19,2.6,0,6.28);cx.fill();
    // spear
    const sdx=(e.fx-e.fy)/1.4, sdy=(e.fx+e.fy)/2.8;
    const lun=e.state==='lunge'?12:0;
    cx.strokeStyle='#7a5230';cx.lineWidth=4;
    cx.beginPath();cx.moveTo(sx+sdx*4,sy-12+sdy*4);cx.lineTo(sx+sdx*(34+lun),sy-12+sdy*(34+lun));cx.stroke();
    cx.fillStyle='#c9d4e2';cx.beginPath();
    const tx=sx+sdx*(38+lun),ty=sy-12+sdy*(38+lun);
    cx.moveTo(tx,ty);cx.lineTo(tx-sdy*5-sdx*8,ty+sdx*2.5-sdy*8);cx.lineTo(tx+sdy*5-sdx*8,ty-sdx*2.5-sdy*8);
    cx.closePath();cx.fill();
  } else if(e instanceof Turret){
    cx.fillStyle='rgba(0,0,0,.22)';ellipse(sx,sy+2,17,8);cx.fill();
    // pot leaves
    cx.fillStyle='#3f8f33';cx.strokeStyle='#1d4a14';cx.lineWidth=3;
    for(let i=0;i<5;i++){const a=i/5*6.28+.5;
      cx.beginPath();cx.ellipse(sx+Math.cos(a)*13,sy-4+Math.sin(a)*5,10,5,a,0,6.28);cx.fill();cx.stroke();}
    // head
    const open=e.shootAnim>0?1.4:1;
    cx.fillStyle='#d95fa4';cx.strokeStyle='#6e1d4a';
    ellipse(sx,sy-20,11*open,12);cx.fill();cx.stroke();
    cx.fillStyle='#5c1038';ellipse(sx,sy-18,5*open,5);cx.fill();
    cx.fillStyle='#ffd6ec';ellipse(sx-4,sy-25,3.4,3);cx.fill();
  }
  cx.restore();
}
/* Legacy static-pose picker — fallback while no real animation strips exist.
   9 static poses flip-booked + a sine bob (the thing the anim strips will replace). */
function pickPlayerSprite(p){
  // screen-space facing
  const sdx=p.fx-p.fy, sdy=(p.fx+p.fy)/2;
  const back=sdy<-.15, left=sdx<0;
  let key,flip=false;
  if(p.hurtT>0){key='pl_hurt';flip=!left;}
  else if(p.rolling){key='pl_roll';flip=!left;}
  else if(back){
    if(p.moving){const f=Math.floor(p.animT)%2;
      key=left?(f?'pl_back_nw':'pl_walk_sw'):(f?'pl_walk_ne':'pl_walk_ne2');}
    else key=left?'pl_back_nw':'pl_walk_ne';
  } else {
    if(p.moving){const f=Math.floor(p.animT)%2;key=f?'pl_walk_se':'pl_idle_se';}
    else key='pl_idle_se';
    flip=!left;
  }
  return {entry:IMG[key],flip};
}
// Draw size for real animation strips (128px frame canvas, feet ~8px above bottom center)
const PLAYER_STRIP_DRAW_W=108, PLAYER_STRIP_ANCHOR=0.9375;
function drawPlayer(p,cam,g){
  const [sx,sy]=tileScreen(p.x,p.y,cam);
  cx.save();
  if(p.inv>0&&Math.floor(performance.now()/80)%2)cx.globalAlpha=.45;
  // preferred: real animation strip (player_<anim>_<dir>_<frames>.png)
  const sdx=p.fx-p.fy, sdy=(p.fx+p.fy)/2;
  const back=sdy<-.15, left=sdx<0;
  const res=p.animator.resolve(back?'nw':'sw');
  if(res){
    drawFrame(cx,res.entry,res.frame,sx,sy+6,PLAYER_STRIP_DRAW_W,PLAYER_STRIP_ANCHOR,!left);
  } else {
    // fallback: legacy static poses + bob
    const {entry,flip}=pickPlayerSprite(p);
    if(entry){
      const bob=p.moving&&!p.rolling?Math.abs(Math.sin(p.animT*3.2))*3:0;
      drawFrame(cx,entry,0,sx,sy+6-bob,entry.fw/104*88,.96,flip);
    }
  }
  cx.restore();
}
const BOSS_LOOP_POSES={idle:1,p2:1,charge:1,stun:1};
function drawBoss(b,cam,g){
  const [sx,sy]=tileScreen(b.x,b.y,cam);
  const key='boss_'+(b.pose==='p2idle'?'p2':b.pose);
  const e=IMG[key]||IMG.boss_idle;if(!e)return;
  cx.save();
  if(b.flash>0)cx.filter='brightness(2)';
  cx.fillStyle='rgba(0,0,0,.25)';ellipse(sx,sy+8,80,32);cx.fill();
  const h=b.dead?190:235;
  const w=e.fw/e.fh*h;
  let fi=Math.floor(b.poseT*8);
  fi=BOSS_LOOP_POSES[b.pose==='p2idle'?'p2':b.pose]?fi%e.frames:Math.min(fi,e.frames-1);
  drawFrame(cx,e,fi,sx,sy+16,w,.97,b.facing<0);
  cx.restore();
  if(b.exposed>0&&!b.dead){
    cx.fillStyle='rgba(255,216,61,'+(.3+.3*Math.sin(performance.now()/90))+')';
    cx.beginPath();cx.arc(sx,sy-95,20,0,6.28);cx.fill();
  }
}
function drawThorns(cam,g){
  const t=performance.now()/500;
  const ar=g.boss.arena();
  cx.fillStyle='rgba(90,58,30,.9)';
  for(let x=Math.floor(ar[0]);x<=Math.ceil(ar[2]);x+=1)for(const y of [ar[1]-.3,ar[3]+.3]){
    const [sx,sy]=tileScreen(x,y,cam);
    for(let i=-1;i<=1;i++){
      cx.beginPath();cx.moveTo(sx+i*16-6,sy+10);cx.lineTo(sx+i*16,sy-16-4*Math.sin(t+x+i));cx.lineTo(sx+i*16+6,sy+10);cx.closePath();cx.fill();
    }}
  for(const x of [ar[0]-.3,ar[2]+.3])for(let y=Math.ceil(ar[1]);y<=Math.floor(ar[3]);y+=1){
    const [sx,sy]=tileScreen(x,y,cam);
    for(let i=-1;i<=1;i++){
      cx.beginPath();cx.moveTo(sx+i*14-6,sy+10);cx.lineTo(sx+i*14,sy-14-4*Math.sin(t+y+i));cx.lineTo(sx+i*14+6,sy+10);cx.closePath();cx.fill();
    }}
}
function drawFx(f,cam,g){
  const [sx,sy]=tileScreen(f.x,f.y,cam);
  const pr=f.t/f.max;
  if(f.kind==='slash'){
    const sa=Math.atan2((Math.cos(f.ang)+Math.sin(f.ang))/2,(Math.cos(f.ang)-Math.sin(f.ang)));
    cx.save();cx.translate(sx,sy-24);cx.rotate(sa);
    cx.strokeStyle='rgba(255,255,255,'+(pr*.95)+')';
    cx.lineWidth=f.big?12:8;cx.lineCap='round';
    cx.beginPath();cx.arc(0,0,f.big?46:36,-1.15,1.15);cx.stroke();
    cx.strokeStyle='rgba(180,225,255,'+(pr*.6)+')';cx.lineWidth=3;
    cx.beginPath();cx.arc(0,0,(f.big?46:36)+7,-1,1);cx.stroke();
    cx.restore();
  } else if(f.kind==='goo'){
    cx.fillStyle=f.green?'rgba(120,200,90,'+pr+')':'rgba(95,201,78,'+pr+')';
    cx.beginPath();cx.arc(sx,sy-8,6*pr+2,0,6.28);cx.fill();
  } else if(f.kind==='chip'){
    cx.fillStyle='rgba(150,150,160,'+pr+')';
    cx.fillRect(sx-3,sy-10,6,6);
  } else if(f.kind==='spark'){
    cx.strokeStyle='rgba(255,240,150,'+pr+')';cx.lineWidth=3;
    for(let i=0;i<4;i++){const a=i*1.57+.6;
      cx.beginPath();cx.moveTo(sx+Math.cos(a)*4,sy-12+Math.sin(a)*4);
      cx.lineTo(sx+Math.cos(a)*14*(1-pr+.4),sy-12+Math.sin(a)*14*(1-pr+.4));cx.stroke();}
  } else if(f.kind==='spawn'){
    cx.strokeStyle='rgba(255,255,255,'+pr+')';cx.lineWidth=3;
    ellipse(sx,sy,40*(1-pr),20*(1-pr));cx.stroke();
  } else if(f.kind==='dust'){
    cx.fillStyle='rgba(200,190,160,'+(pr*.6)+')';
    ellipse(sx,sy,60*(1-pr)+20,25*(1-pr)+8);cx.fill();
  } else if(f.kind==='petal'){
    cx.fillStyle=['#ff9ecb','#ffd83d','#fff','#c58bff'][Math.floor(f.x*7)%4];
    cx.globalAlpha=Math.min(1,pr*2);
    cx.beginPath();cx.arc(sx,sy-20,5,0,6.28);cx.fill();cx.globalAlpha=1;
  } else if(f.kind==='seedArc'){
    // parametric arc; on land spawn blob
    const k=1-pr;
    const ax=lerp(f.x,f.tx,k),ay=lerp(f.y,f.ty,k);
    const [px,py]=tileScreen(ax,ay,cam);
    const arcH=90*Math.sin(k*Math.PI);
    cx.fillStyle='#6b8f3a';cx.strokeStyle='#2d4d17';cx.lineWidth=2.5;
    cx.beginPath();cx.arc(px,py-14-arcH,10,0,6.28);cx.fill();cx.stroke();
    // shadow target
    cx.fillStyle='rgba(255,80,80,.35)';ellipse(...tileScreen(f.tx,f.ty,cam),22,11);cx.fill();
  }
}

// ---------- HUD & screens ----------
function renderHUD(g){
  const p=g.player;
  // hearts
  for(let i=0;i<p.maxHp/2;i++){
    const x=34+i*34,y=34;
    const full=p.hp>=(i+1)*2, half=!full&&p.hp===i*2+1;
    drawHeart(x,y,13,'rgba(30,30,45,.55)','rgba(0,0,0,.5)');
    if(full)drawHeart(x,y,13,'#ff4d6f','#7d0f28');
    else if(half){
      cx.save();cx.beginPath();cx.rect(x-16,y-16,16,32);cx.clip();
      drawHeart(x,y,13,'#ff4d6f','#7d0f28');cx.restore();
    }
  }
  // coins
  cx.fillStyle='#ffd23d';cx.strokeStyle='#a06a00';cx.lineWidth=2.5;
  cx.beginPath();cx.arc(40,74,11,0,6.28);cx.fill();cx.stroke();
  cx.font='bold 20px Trebuchet MS';cx.textAlign='left';
  cx.strokeStyle='rgba(0,0,0,.6)';cx.lineWidth=4;
  cx.strokeText('× '+g.coins,58,81);cx.fillStyle='#fff';cx.fillText('× '+g.coins,58,81);
  // runes
  for(let i=0;i<g.runes.length;i++){
    cx.fillStyle=g.runes[i]?'#ffd83d':'rgba(30,30,45,.55)';
    cx.strokeStyle=g.runes[i]?'#fff':'rgba(0,0,0,.5)';cx.lineWidth=2;
    cx.beginPath();cx.arc(34+i*26,108,8,0,6.28);cx.fill();cx.stroke();
  }
  // boss bar
  if(g.boss&&g.bossActive&&!g.boss.dead){
    const w=Math.min(560,VW-80),x=VW/2-w/2,y=28;
    cx.fillStyle='rgba(0,0,0,.55)';cx.beginPath();cx.roundRect(x-4,y-4,w+8,26,8);cx.fill();
    cx.fillStyle='#5a1d28';cx.fillRect(x,y,w,18);
    cx.fillStyle='#e8433f';cx.fillRect(x,y,w*g.boss.hp/g.boss.maxHp,18);
    cx.fillStyle='#ffd83d';cx.fillRect(x,y,w*g.boss.hp/g.boss.maxHp,4);
    cx.font='bold 15px Trebuchet MS';cx.textAlign='center';cx.fillStyle='#fff';
    cx.fillText(LVL.boss.name||'THE GUARDIAN',VW/2,y+38);
  }
  // message
  if(g.msg&&g.msgT>0){
    cx.font='bold 21px Trebuchet MS';cx.textAlign='center';
    const w=cx.measureText(g.msg).width+44;
    const a=Math.min(1,g.msgT*2);
    cx.globalAlpha=a;
    cx.fillStyle='rgba(20,26,40,.9)';
    cx.beginPath();cx.roundRect(VW/2-w/2,VH-118,w,44,12);cx.fill();
    cx.strokeStyle='rgba(255,216,61,.6)';cx.lineWidth=2;cx.stroke();
    cx.fillStyle='#fff';cx.fillText(g.msg,VW/2,VH-89);
    cx.globalAlpha=1;
  }
  // test-play badge
  if(TEST_MODE){
    cx.font='bold 13px Trebuchet MS';cx.textAlign='left';
    cx.fillStyle='rgba(255,216,61,.9)';cx.fillText('TEST PLAY — '+LVL.name,16,VH-14);
  }
  // pause hint / touch pause btn
  if(touchMode){
    cx.fillStyle='rgba(255,255,255,.2)';cx.beginPath();cx.roundRect(VW-62,16,46,46,10);cx.fill();
    cx.fillStyle='#fff';cx.fillRect(VW-50,28,8,22);cx.fillRect(VW-36,28,8,22);
  } else {
    cx.font='13px Trebuchet MS';cx.textAlign='right';cx.fillStyle='rgba(255,255,255,.55)';
    cx.fillText('ESC pause · M mute',VW-16,VH-14);
  }
}
function bigPanel(title,lines,footer){
  cx.fillStyle='rgba(10,14,26,.75)';cx.fillRect(0,0,VW,VH);
  cx.textAlign='center';
  cx.font='bold 52px Trebuchet MS';
  cx.strokeStyle='rgba(0,0,0,.7)';cx.lineWidth=8;cx.strokeText(title,VW/2,VH*.34);
  cx.fillStyle='#ffd83d';cx.fillText(title,VW/2,VH*.34);
  cx.font='22px Trebuchet MS';cx.fillStyle='#fff';
  lines.forEach((l,i)=>cx.fillText(l,VW/2,VH*.34+52+i*34));
  if(footer){cx.font='17px Trebuchet MS';cx.fillStyle='rgba(255,255,255,.7)';
    cx.fillText(footer,VW/2,VH*.34+52+lines.length*34+40);}
}
function renderOverlayMenu(g){bigPanel('PAUSED',['Coins: '+g.coins+'   ·   Runes: '+g.runes.filter(r=>r).length+'/'+g.runes.length,
  'Time: '+fmtTime(g.playTime)],touchMode?'Tap to resume':'ESC to resume · M to mute');}
function renderDead(g){bigPanel('YOU FELL...',['The ruins reclaim another hero.',
  'You will wake at the last checkpoint.'],touchMode?'Tap to continue':'Press ENTER to continue');}
function renderVictory(g){
  bigPanel('VICTORY!',[
    'Grubthorn crumbles into a bed of flowers.',
    'Time: '+fmtTime(g.playTime)+'    Coins: '+g.coins+'    Falls: '+g.deaths,
    'The meadow ruins are at peace once more.'],
    touchMode?'Tap for title screen':'Press ENTER for title screen');
  const e=IMG.pl_victory;
  if(e){const h=170,w=e.fw/e.fh*h;
    drawFrame(cx,e,0,VW/2,VH*.34+180+h,w, 1,false);}
}
function fmtTime(t){const m=Math.floor(t/60),s=Math.floor(t%60);return m+':'+String(s).padStart(2,'0');}
function renderTitle(g){
  // animated iso grid bg
  const t=performance.now()/1000;
  cx.save();cx.translate(VW/2,VH/2-40);
  for(let y=-7;y<=7;y++)for(let x=-9;x<=9;x++){
    const sx=(x-y)*HW*.8,sy=(x+y)*HH*.8+Math.sin(t*1.3+x*.7+y*.5)*5;
    if(sx<-VW/2-TW||sx>VW/2+TW)continue;
    const v=tileVariant(x+20,y+20);
    cx.globalAlpha=.85;
    const e=IMG[['tile_grass1','tile_grass2','tile_grass3'][v]];
    if(e)cx.drawImage(e.img,sx-HW*.8,sy,TW*.8,TW*.8*e.fh/e.fw);
  }
  cx.restore();cx.globalAlpha=1;
  cx.fillStyle='rgba(12,18,34,.45)';cx.fillRect(0,0,VW,VH);
  // hero
  const hero=IMG.pl_victory;
  if(hero){const h=Math.min(240,VH*.3),w=hero.fw/hero.fh*h;
    cx.drawImage(hero.img,VW/2-w/2,VH*.16,w,h);}
  cx.textAlign='center';
  cx.font='900 64px Trebuchet MS';
  cx.strokeStyle='rgba(0,0,0,.75)';cx.lineWidth=10;cx.strokeText('GRID WARRIOR',VW/2,VH*.52);
  const gr=cx.createLinearGradient(0,VH*.45,0,VH*.55);
  gr.addColorStop(0,'#fff');gr.addColorStop(1,'#ffd83d');
  cx.fillStyle=gr;cx.fillText('GRID WARRIOR',VW/2,VH*.52);
  cx.font='italic 22px Trebuchet MS';cx.fillStyle='#cfe3ff';
  cx.fillText(LVL.name,VW/2,VH*.52+36);
  // buttons
  const bw=260,bx=VW/2-bw/2;
  const btn=(y,label,hot)=>{
    cx.fillStyle=hot?'#ffd83d':'rgba(255,255,255,.14)';
    cx.strokeStyle=hot?'#fff':'rgba(255,255,255,.5)';cx.lineWidth=3;
    cx.beginPath();cx.roundRect(bx,y,bw,52,14);cx.fill();cx.stroke();
    cx.font='bold 24px Trebuchet MS';cx.fillStyle=hot?'#3a2a00':'#fff';
    cx.fillText(label,VW/2,y+35);};
  btn(VH*.62,g.hasSave?'CONTINUE':'START ADVENTURE',true);
  if(g.hasSave)btn(VH*.62+64,'NEW GAME',false);
  cx.font='16px Trebuchet MS';cx.fillStyle='rgba(255,255,255,.65)';
  cx.fillText(touchMode?'Stick to move · ⚔ attack · ➜ roll':'WASD move · J / SPACE attack · K / SHIFT roll · ENTER start',VW/2,VH*.62+(g.hasSave?150:96));
  cx.fillStyle='rgba(255,255,255,.4)';cx.font='13px Trebuchet MS';
  cx.fillText('Defeat the guardian trials, then face the boss.',VW/2,VH-24);
}

// ---------- main loop ----------
let last=0,acc=0;const STEP=1/60;
function loop(ts){
  requestAnimationFrame(loop);
  if(!last)last=ts;
  let dt=Math.min(.1,(ts-last)/1000);last=ts;
  acc+=dt;
  while(acc>=STEP){game.update(STEP);acc-=STEP;}
  render(game);
}
async function boot(){
  if(TEST_MODE){
    const j=store.get('gridwarrior_testlevel');
    if(j)LVL=Level.fromJSON(JSON.parse(j));
    else {alert('No test level found — use Test Play from the editor.');return;}
  } else {
    LVL=await fetchLevel(LEVEL_PARAM||'levels/meadow.json');
  }
  PRISTINE=LVL.tiles.slice();
  await loadAssets('assets/');
  game=new Game();
  window.GW=game;  // debug/test hook
  window.GW_warpBoss=()=>{if(!LVL.boss)return;game.state='play';
    game.runes=game.runes.map(()=>true);mset(LVL.boss.gate.x,LVL.boss.gate.y,T.P);
    game.player.x=LVL.boss.gate.x+.5;game.player.y=LVL.boss.gate.y+1.4;};
  requestAnimationFrame(loop);
}
boot();
addEventListener('blur',()=>{if(game&&game.state==='play')game.state='pause';});
