// Generates levels/meadow.json — a faithful serialization of the prototype's
// hand-authored buildMap() + spawn arrays + arenas + boss config.
// Run: node tools/build_meadow.mjs
import fs from 'fs';

const MW=44,MH=44;
const T={G:0,P:1,W:2,R:3,B:4,C:5,GATE:6,F:7};
const TILE_CHAR='GPWRBCXF';
const map=new Uint8Array(MW*MH);
const mset=(x,y,t)=>{if(x>=0&&y>=0&&x<MW&&y<MH)map[y*MW+x]=t;};
const fillRect=(x0,y0,x1,y1,t)=>{for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++)mset(x,y,t);};
const ringRect=(x0,y0,x1,y1,t)=>{for(let x=x0;x<=x1;x++){mset(x,y0,t);mset(x,y1,t);}
  for(let y=y0;y<=y1;y++){mset(x0,y,t);mset(x1,y,t);}};

map.fill(T.G);
fillRect(0,0,MW-1,1,T.W);fillRect(0,MH-2,MW-1,MH-1,T.W);
fillRect(0,0,1,MH-1,T.W);fillRect(MW-2,0,MW-1,MH-1,T.W);
// river
fillRect(18,2,20,41,T.W);
fillRect(18,26,20,26,T.B); fillRect(18,12,20,12,T.B);   // two bridges
// start clearing paths
fillRect(8,32,10,38,T.P);
fillRect(9,26,9,32,T.P);
fillRect(9,26,17,26,T.P);            // to bridge 1
fillRect(21,26,23,26,T.P);
// west branch to heart room
fillRect(5,25,9,25,T.P); fillRect(5,21,5,25,T.P);
ringRect(3,16,8,21,T.R); mset(5,21,T.P); // entrance south
fillRect(4,17,7,20,T.G);
// east ruins paths
fillRect(23,22,23,30,T.P);
fillRect(23,30,24,33,T.P);
fillRect(23,22,26,22,T.P);
fillRect(26,18,26,22,T.P);
fillRect(29,15,33,15,T.P);
fillRect(33,12,36,15,T.P);
fillRect(36,10,36,12,T.P);
fillRect(30,23,33,23,T.P);
// Arena A (south-east)
ringRect(24,30,30,36,T.R); mset(24,33,T.G);
fillRect(25,31,29,35,T.G);
// Arena B (east)
ringRect(33,20,39,26,T.R); mset(33,23,T.G);
fillRect(34,21,38,25,T.G);
// Arena C (north, past river)
ringRect(23,12,29,18,T.R); mset(26,18,T.G);
fillRect(24,13,28,17,T.G);  mset(29,15,T.G); // keep path clear
mset(26,18,T.P);
// fountain plaza
fillRect(33,12,35,14,T.F);
// boss wall + gate + arena
fillRect(30,3,30,10,T.R);
fillRect(30,10,41,10,T.R);
mset(36,10,T.GATE);
fillRect(31,2,41,9,T.G);
// scattered ruins
[[14,30],[22,31],[31,28],[25,20],[31,17],[37,17],[29,27],[13,22],[15,20]].forEach(p=>mset(p[0],p[1],T.R));
// cracked (breakable) walls
[[12,34],[31,25],[38,28]].forEach(p=>mset(p[0],p[1],T.C));

const rows=[];
for(let y=0;y<MH;y++){let r='';for(let x=0;x<MW;x++)r+=TILE_CHAR[map[y*MW+x]];rows.push(r);}

const blob=(x,y)=>({type:'blob',x,y});
const goblin=(x,y,px,py)=>({type:'goblin',x,y,px,py});
const turret=(x,y)=>({type:'turret',x,y});

const enemies=[
  ...[[9,30],[7.5,28],[12,27.5],[22.5,30],[23,21],[31,27],[35,28],[15,24.5]].map(p=>blob(p[0],p[1])),
  {...goblin(5,17.5,5,20),unlessFlag:'heartCont'},
  {...goblin(7,20,7,17.5),unlessFlag:'heartCont'},
  goblin(27,25,31,25),
  goblin(34.5,17,37.5,19),
  ...[[22,24],[22,28],[30,20],[13,25]].map(p=>turret(p[0],p[1])),
];

const coinSpots=[[9,34],[9,31],[9,28],[11,26],[13,26],[15,26],[19,26],[21,26],
  [23,24],[23,28],[23,31],[26,21],[26,19],[30,23],[32,23],[29,15],[31,15],[33,15],
  [7,25],[5,23],[35,13],[36,12],[16,22],[14,28],[24,34],[33,26]];
const pickups=[
  {type:'heartcont',x:5.5,y:18.5,unlessFlag:'heartCont'},
  ...coinSpots.map(p=>({type:'coin',x:p[0],y:p[1]})),
];

const signs=[
  {x:8,y:34,text:'Move with WASD / arrows (or the stick).'},
  {x:10,y:33,text:'Attack with J or SPACE — chain 3 swings!'},
  {x:9,y:31,text:'Dodge-roll with K or SHIFT. You are invincible mid-roll.'},
  {x:16,y:25,text:'Slash incoming seeds to knock them away!'},
  {x:35,y:14,text:'A healing fountain. Your progress is saved here.'},
];

const arenas=[
  {rect:[25,31,29,35],gates:[[24,33]],waves:[
    [blob(26,32),blob(28,32),blob(27,34)],
    [blob(25.5,31.5),blob(28.5,31.5),blob(27,35)]]},
  {rect:[34,21,38,25],gates:[[33,23]],waves:[
    [blob(35,22),blob(37,24),goblin(37,22,35,24)],
    [goblin(35,21.5,38,21.5),goblin(38,24.5,35,24.5)]]},
  {rect:[24,13,28,17],gates:[[26,18],[29,15]],waves:[
    [turret(24.5,13.5),turret(27.5,13.5),goblin(26,16,26,14)],
    [goblin(24.5,16.5,27.5,16.5),goblin(27.5,14,24.5,16)]]},
];

const level={
  name:'Ruins of the Meadow',
  width:MW,height:MH,
  tiles:rows,
  playerStart:{x:9.5,y:36.5},
  fountain:{x:34,y:13.5,respawn:{x:34.5,y:13.5}},
  signs,enemies,pickups,arenas,
  boss:{
    name:'GRUBTHORN — THE RUIN TENDER',
    gate:{x:36,y:10},
    spawn:{x:36.5,y:4.8},
    trigger:[30.5,2,42,9.6],
    arena:[31.7,2.7,40.3,8.3],
  },
};

fs.mkdirSync('levels',{recursive:true});
fs.writeFileSync('levels/meadow.json',JSON.stringify(level,null,1)+'\n');
console.log('wrote levels/meadow.json');
