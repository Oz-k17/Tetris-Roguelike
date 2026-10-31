// Party bot: 2-4 bots play one co-op run together through a fake room, all in lock-step game time.
// usage: node tools/party-bot.js <cls,cls,...> <diff> <runs> [skill]     e.g. node tools/party-bot.js tank,atk normal 6 average
// Each player is the real game script in its own vm context; the placement AI is the same as balance-bot.js.
const fs=require('fs'),vm=require('vm'),path=require('path');
const HTML=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
let SRC=[...HTML.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1]).sort((a,b)=>b.length-a.length)[0].trim();
SRC=SRC.slice(SRC.indexOf('{')+1,SRC.lastIndexOf('})'));
SRC+=`;globalThis.G={get S(){return S},get NET(){return NET},collide,rot,hard,useSkill,skNeed,leaveShop,buy,W,H,
  setCls:c=>{myCls=c},setDiff:d=>{myDiff=d},setMap:m=>{myMap=m},hostStart,cheer:()=>{try{$('cheerBtn2').onclick()}catch(e){}}};`;
const SKILLS={beginner:{think:1250,err:0.5},average:{think:830,err:0.3},skilled:{think:500,err:0.1}};
let T=0;
// ---- fake room: presence is delivered at the end of each tick (like a network hop)
function makeRoomHub(){
  const rooms={};let pid=0,dirty=new Set();
  const deliver=()=>{for(const R of dirty){for(const[id,m]of R.members){const peers=[...R.members].map(([pid2,x])=>({peer:pid2,by:null,isMe:pid2===id,sameTab:pid2===id,kind:'viewer',guest:false,presence:JSON.parse(JSON.stringify(x.presence)),updatedAt:0}));m.handlers.forEach(h=>h({peers,joined:[],left:[],updated:[]}))}}dirty.clear()};
  const api=()=>({join:async name=>{const R=rooms[name]||(rooms[name]={members:new Map()});const me='p'+String(++pid).padStart(3,'0');const m={presence:{},handlers:[]};R.members.set(me,m);dirty.add(R);
    return{name,presence:async p=>{for(const k in p){if(p[k]===null)delete m.presence[k];else m.presence[k]=p[k]}dirty.add(R)},
      onPeers:fn=>{m.handlers.push(fn);dirty.add(R);return()=>{}},peers:()=>[],connected:()=>true,leave:async()=>{R.members.delete(me);dirty.add(R)}}}});
  return{api,deliver};
}
function makePlayer(roomApi,seed){
  const els={};let raf=null;const timers=[];
  const el=()=>{const t={style:{setProperty(){}},classList:{toggle(){},add(){},remove(){},contains(){return false}},dataset:{},hidden:false,textContent:'',value:'',kids:[],disabled:false,
    getContext:()=>new Proxy({},{get:(o,k)=>k==='measureText'?()=>({width:1}):k==='createLinearGradient'?()=>({addColorStop(){}}):()=>{},set:()=>true}),
    addEventListener(){},appendChild(c){t.kids.push(c)},focus(){},querySelectorAll:()=>[],querySelector:()=>null,firstChild:null,clientHeight:800,clientWidth:400,offsetHeight:60,
    getBoundingClientRect:()=>({left:0,top:0,width:0,height:0}),getClientRects:()=>[],remove(){},animate:()=>({finished:Promise.resolve(),cancel(){}})};
    return new Proxy(t,{get:(o,k)=>k in o?o[k]:undefined,set:(o,k,v)=>{if(k==='innerHTML')o.kids=[];o[k]=v;return true}})};
  const store={};
  const ctx={console:{log(){},warn(){},error(){}},Math,JSON,Date,Object,Array,String,Number,Boolean,Promise,Map,Set,WeakMap,Error,TypeError,isFinite,isNaN,parseInt,parseFloat,Proxy,Symbol,RegExp,Infinity,NaN,Intl,
    performance:{now:()=>T},requestAnimationFrame:f=>{raf=f},setTimeout:(f,ms)=>{timers.push({at:T+(ms||0),f});return timers.length},clearTimeout(){},setInterval:()=>0,clearInterval(){},
    getComputedStyle:()=>({paddingLeft:'16',paddingRight:'16',visibility:'visible'}),addEventListener(){},matchMedia:()=>({matches:false,addEventListener(){}}),
    localStorage:{getItem:k=>store[k]??null,setItem:(k,v)=>{store[k]=String(v)},removeItem:k=>{delete store[k]}},navigator:{},
    Audio:function(){return{play(){return Promise.resolve()},pause(){},load(){},addEventListener(){},loop:false,volume:0,currentTime:0,paused:true,readyState:0,style:{}}},
    document:{getElementById:id=>els[id]||(els[id]=el()),querySelector:()=>el(),querySelectorAll:()=>[],addEventListener(){},createElement:()=>el(),body:el(),hidden:false}};
  ctx.window={devicePixelRatio:1,claude:{use:async n=>n==='room'?roomApi:null}};
  vm.createContext(ctx);
  // per-player randomness so bots differ
  let s=seed>>>0;ctx.Math=Object.create(Math);ctx.Math.random=()=>{s=s+0x6D2B79F5|0;let t=Math.imul(s^s>>>15,1|s);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296};
  vm.runInContext(SRC,ctx);
  const P={ctx,els,G:ctx.G,rnd:ctx.Math.random,
    tick(){for(let i=timers.length-1;i>=0;i--)if(timers[i].at<=T){const f=timers[i].f;timers.splice(i,1);try{f()}catch(e){}}if(raf){const f=raf;raf=null;f(T)}}};
  return P;
}
// ---- placement AI (copied from balance-bot.js)
function features(b,W,H){
  let holes=0,rowT=0,colT=0,wells=0;const hts=Array(W).fill(0);
  for(let x=0;x<W;x++){let seen=false;for(let y=0;y<H;y++){if(b[y][x]){if(!seen){hts[x]=H-y;seen=true}}else if(seen)holes++}}
  for(let y=0;y<H;y++){let prev=1;for(let x=0;x<W;x++){const f=b[y][x]?1:0;if(f!==prev)rowT++;prev=f}if(!prev)rowT++}
  for(let x=0;x<W;x++){let prev=0;for(let y=0;y<H;y++){const f=b[y][x]?1:0;if(f!==prev)colT++;prev=f}if(!prev)colT++}
  for(let x=0;x<W;x++){const l=x?hts[x-1]:99,r=x<W-1?hts[x+1]:99,d=Math.min(l,r)-hts[x];if(d>0)wells+=d*(d+1)/2}
  return{holes,rowT,colT,wells,maxH:Math.max(...hts)};
}
function candidates(G){
  const S=G.S,p=S.cur,W=G.W,H=G.H,out=[];let m=p.m.map(r=>r.slice());const seen=new Set();
  const place=(b,m,x,y)=>{const nb=b.map(r=>r.slice());for(let r=0;r<m.length;r++)for(let c=0;c<m[r].length;c++)if(m[r][c]){if(y+r<0)return null;nb[y+r][x+c]='X'}
    let cleared=0;for(let yy=H-1;yy>=0;yy--){if(nb[yy].every(v=>v)){nb.splice(yy,1);nb.unshift(Array(W).fill(0));cleared++;yy++}}return{nb,cleared}};
  for(let r=0;r<4;r++){
    const key=JSON.stringify(m);
    if(!seen.has(key)){seen.add(key);
      for(let x=-3;x<W;x++){
        let y=p.y;if(G.collide(m,x,y)){y=Math.min(0,y);if(G.collide(m,x,y))continue}
        while(!G.collide(m,x,y+1))y++;
        const pl=place(S.board,m,x,y);if(!pl)continue;const {nb,cleared}=pl;const f=features(nb,W,H);
        let land=0;for(let rr=0;rr<m.length;rr++)if(m[rr].some(v=>v)){land=H-(y+rr);break}
        const score=-4.5*land+3.4*cleared-3.2*f.rowT-9.3*f.colT-7.9*f.holes-3.4*f.wells-(f.maxH>14?30:0);
        out.push({m:m.map(q=>q.slice()),x,y,r:(p.r+r)%4,score});
      }}
    m=G.rot(m,1);
  }
  return out.sort((a,b)=>b.score-a.score);
}
function act(P,opt){
  const G=P.G,S=G.S,rnd=P.rnd;if(!S)return;
  if(S.incoming){P.seenG=P.seenG||new WeakSet();for(const g of S.incoming)if(!P.seenG.has(g)){P.seenG.add(g);S.botGarb=(S.botGarb||0)+g.rows}}
  {const top=S.board.findIndex(r=>r.some(v=>v));const h=top<0?0:G.H-top;S.botMaxH=Math.max(S.botMaxH||0,h)}
  if(S.mode==='reward'){
    const btns=(P.els.cards&&P.els.cards.kids||[]).filter(c=>c.onclick&&!c.disabled);
    if(btns.length){btns[Math.floor(rnd()*Math.min(btns.length,3))].onclick();return}
  }
  if(S.mode==='shop'){
    const order=S.shop.items.map((it,i)=>({it,i})).filter(o=>!o.it.sold&&S.gold>=o.it.price);
    const healI=order.find(o=>o.it.kind==='heal');
    if(healI&&S.hp<S.maxHp*0.6){G.buy(healI.i);return}
    const rel=order.filter(o=>['relic','up','charm','weaken'].includes(o.it.kind));
    if(rel.length&&rnd()<0.8){G.buy(rel[Math.floor(rnd()*rel.length)].i);return}
    G.leaveShop();return;
  }
  if(S.mode==='over'){if(!S.botCheer||T-S.botCheer>8000){S.botCheer=T;G.cheer()}return}
  if(S.mode!=='play'||!S.cur)return;
  if((S.skCharge||0)>=G.skNeed()){
    const fight=S.boss&&!S.boss.dead;
    if(S.cls==='heal'){
      const al=(G.NET&&G.NET.others||[]).map(p=>p.presence).filter(q=>q&&q.e===S.epoch);
      const low=S.hp<S.maxHp*0.7||al.some(q=>!q.a||(+q.hp)<(+q.mh)*0.6);
      if(low)G.useSkill();
    }else if(fight)G.useSkill();
  }
  if(!S.botNext||S.botPiece!==S.cur){S.botPiece=S.cur;S.botNext=T+opt.think*(0.6+rnd()*0.8);return}
  if(T<S.botNext)return;
  const c=candidates(G);if(!c.length){G.hard();return}
  let k=0;if(rnd()<opt.err)k=Math.min(c.length-1,1+Math.floor(rnd()*4));
  const ch=c[k];S.cur.m=ch.m;S.cur.x=ch.x;S.cur.y=Math.min(S.cur.y,ch.y);S.cur.r=ch.r;S.lastRot=false;
  G.hard();S.botNext=0;
}
async function runParty(classes,diff,opt,seed){
  T=1e6;
  const hub=makeRoomHub();
  const ps=classes.map((c,i)=>makePlayer(hub.api(),seed*7919+i*104729+1));
  const flush=async()=>{for(let i=0;i<3;i++){await null;hub.deliver();await null}};
  for(const P of ps){P.tick()}await flush();
  ps.forEach((P,i)=>{P.G.setCls(classes[i]);P.G.setDiff(diff);P.G.setMap('line')});
  ps[0].els.createBtn.onclick();await flush();
  const code=ps[0].G.NET.code;
  for(const P of ps.slice(1)){P.els.codeIn.value=code;P.els.joinBtn.onclick();await flush()}
  for(let i=0;i<5;i++){T+=16;ps.forEach(P=>P.tick());await flush()}
  ps[0].G.hostStart();
  const t0=T,LIMIT=t0+75*60*1000;let n=0;const deaths=[];
  while(T<LIMIT){
    T+=16;n++;
    for(const P of ps){P.tick();act(P,opt)}
    if(n%4===0)await flush();
    if(process.env.D&&n%3750===0)console.log(Math.round((T-t0)/60000),ps.map(P=>{const S=P.G.S;return `${S.cls}:${S.mode}/${S.phase} f${S.floor} hp${S.hp} g${S.botGarb||0} hits${S.hitsTaken||0} lines${S.totalLines} hmax${S.botMaxH||0} ${S.boss?S.boss.name+(S.boss.dead?'x':'')+S.boss.hp:'-'} t${Math.round(S.timeLeft/1000)} host${P.G.NET&&P.G.NET.isHost} oth${(P.G.NET&&P.G.NET.others||[]).map(o=>o.presence&&o.presence.r+':'+(o.presence.g?o.presence.g.f+o.presence.g.ph:'-')).join(',')}`}).join(' | '));
    const Ss=ps.map(P=>P.G.S);
    Ss.forEach((S,i)=>{if(S.mode==='over'&&!S.botDead){S.botDead=1;deaths.push(`${S.cls}@F${S.floor}:${S.cause}${S.wardN?'(加護'+S.wardN+')':''}`)}if(S.mode!=='over')S.botDead=0});
    if(Ss.some(S=>S.mode==='win'))return{win:true,deaths,floor:Ss[0].floor,ps:Ss.map(S=>({cls:S.cls,lv:S.level,hits:S.hitsTaken||0,dead:S.mode==='over'})),min:Math.round((T-t0)/60000)};
    if(Ss.every(S=>S.mode==='over'))return{win:false,deaths,floor:Math.max(...Ss.map(S=>S.floor)),min:Math.round((T-t0)/60000)};
  }
  return{win:false,floor:ps[0].G.S.floor,cause:'timeout',min:75};
}
module.exports={runParty};
if(require.main===module){
  (async()=>{
    const [cls,diff='normal',runs='4',sk='average']=process.argv.slice(2);
    const classes=cls.split(','),opt=SKILLS[sk]||SKILLS.average;const rs=[];
    const off=+(process.env.SEED||0);for(let i=0;i<+runs;i++)rs.push(await runParty(classes,diff,opt,off+i+1));
    const floors=rs.map(r=>r.win?9:r.floor);
    console.log(`${cls.padEnd(19)} ${diff} ${sk}  clear ${rs.filter(r=>r.win).length}/${runs}  avgFloor ${(floors.reduce((a,b)=>a+b,0)/rs.length).toFixed(1)}  floors ${floors.join(',')}`);
    if(process.env.V)rs.forEach(r=>console.log(JSON.stringify(r)));
  })();
}
