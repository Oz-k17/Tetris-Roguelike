// Balance bot: plays full solo runs of the game headlessly and reports how far each class/difficulty gets.
// usage: node tools/balance-bot.js <cls|all> <diff> <runs> [pps] [err]
// also: node tools/balance-matrix.js easy,normal,hard 20   /   node tools/balance-rare.js <cls> <relic|none> <runs> <skill> <diff>
const fs=require('fs');
// reads the game straight from index.html (the largest inline <script>)
const HTML=fs.readFileSync(require('path').join(__dirname,'..','index.html'),'utf8');
const SRC=[...HTML.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1]).sort((a,b)=>b.length-a.length)[0];
// ---- stub DOM that remembers buttons appended to a container, so overlays can be "clicked"
const el=()=>{const t={style:{setProperty(){}},classList:{toggle(){},add(){},remove(){},contains(){return false}},dataset:{},hidden:false,textContent:'',value:'',kids:[],
  getContext:()=>new Proxy({},{get:(o,k)=>k==='measureText'?()=>({width:1}):k==='createLinearGradient'?()=>({addColorStop(){}}):()=>{},set:()=>true}),
  addEventListener(){},appendChild(c){t.kids.push(c)},focus(){},querySelectorAll:()=>[],querySelector:()=>null,firstChild:null,clientHeight:800,clientWidth:400,offsetHeight:60,getBoundingClientRect:()=>({left:0,top:0,width:0,height:0}),getClientRects:()=>[],remove(){}};
  return new Proxy(t,{get:(o,k)=>k in o?o[k]:undefined,set:(o,k,v)=>{if(k==='innerHTML')o.kids=[];o[k]=v;return true}})};
const els={};
let t=0;const timers=[];
global.document={getElementById:id=>els[id]||(els[id]=el()),querySelector:()=>el(),querySelectorAll:()=>[],addEventListener(){},createElement:()=>el(),body:el(),hidden:false};
global.window={devicePixelRatio:1};global.addEventListener=()=>{};global.getComputedStyle=()=>({paddingLeft:'16',paddingRight:'16',visibility:'visible'});
global.localStorage={getItem:()=>null,setItem(){}};global.performance={now:()=>t};global.navigator={};global.matchMedia=()=>({matches:false});
global.setTimeout=(f,ms)=>{timers.push({at:t+(ms||0),f});return timers.length};global.clearTimeout=()=>{};global.setInterval=()=>0;global.clearInterval=()=>{};
let raf;global.requestAnimationFrame=f=>{raf=f};global.Audio=function(){return{play(){return Promise.resolve()},pause(){},load(){},addEventListener(){},loop:false,volume:0,currentTime:0,paused:true,readyState:0}};
let src=SRC.trim();src=src.slice(src.indexOf('{')+1,src.lastIndexOf('})'));
src+=`;global.G={get S(){return S},newRun,collide,rot,hard,useSkill,skNeed,leaveShop,buy,DIFFS,CLASSES,RELICS,FINAL,W,H,lv,strikeDmg,bossBaseHp:typeof bossBaseHp==='function'?bossBaseHp:null};`;
(0,eval)(src);
const W=G.W,H=G.H;
// ---- placement search (El-Tetris style features)
function features(b){
  let holes=0,rowT=0,colT=0,wells=0;const hts=Array(W).fill(0);
  for(let x=0;x<W;x++){let seen=false;for(let y=0;y<H;y++){if(b[y][x]){if(!seen){hts[x]=H-y;seen=true}}else if(seen)holes++}}
  for(let y=0;y<H;y++){let prev=1;for(let x=0;x<W;x++){const f=b[y][x]?1:0;if(f!==prev)rowT++;prev=f}if(!prev)rowT++}
  for(let x=0;x<W;x++){let prev=0;for(let y=0;y<H;y++){const f=b[y][x]?1:0;if(f!==prev)colT++;prev=f}if(!prev)colT++}
  for(let x=0;x<W;x++){const l=x?hts[x-1]:99,r=x<W-1?hts[x+1]:99,d=Math.min(l,r)-hts[x];if(d>0)wells+=d*(d+1)/2}
  return{holes,rowT,colT,wells,maxH:Math.max(...hts)};
}
function place(b,m,x,y){const nb=b.map(r=>r.slice());for(let r=0;r<m.length;r++)for(let c=0;c<m[r].length;c++)if(m[r][c]){if(y+r<0)return null;nb[y+r][x+c]='X'}
  let cleared=0;for(let yy=H-1;yy>=0;yy--){if(nb[yy].every(v=>v)){nb.splice(yy,1);nb.unshift(Array(W).fill(0));cleared++;yy++}}return{nb,cleared}}
function candidates(){
  const S=G.S,p=S.cur,out=[];let m=p.m.map(r=>r.slice());const seen=new Set();
  for(let r=0;r<4;r++){
    const key=JSON.stringify(m);
    if(!seen.has(key)){seen.add(key);
      for(let x=-3;x<W;x++){
        let y=p.y;if(G.collide(m,x,y)){y=Math.min(0,y);if(G.collide(m,x,y))continue}
        while(!G.collide(m,x,y+1))y++;
        const pl=place(S.board,m,x,y);if(!pl)continue;const {nb,cleared}=pl;const f=features(nb);
        let land=0;for(let rr=0;rr<m.length;rr++)if(m[rr].some(v=>v)){land=H-(y+rr);break}
        const score=-4.5*land+3.4*cleared-3.2*f.rowT-9.3*f.colT-7.9*f.holes-3.4*f.wells-(f.maxH>14?30:0);
        out.push({m:m.map(q=>q.slice()),x,y,r:(p.r+r)%4,score});
      }}
    m=G.rot(m,1);
  }
  return out.sort((a,b)=>b.score-a.score);
}
// ---- bot policy
function act(opt){
  const S=G.S;
  // overlays: click something sensible
  const cards=els.cards&&els.cards.kids||[];
  if(S.mode==='reward'){
    const btns=cards.filter(c=>c.onclick&&!c.disabled);
    if(btns.length){const pick=btns[Math.floor(Math.random()*Math.min(btns.length,3))];pick.onclick();return}
  }
  if(S.mode==='shop'){
    const items=S.shop.items;
    const order=items.map((it,i)=>({it,i})).filter(o=>!o.it.sold&&S.gold>=o.it.price);
    const healI=order.find(o=>o.it.kind==='heal');
    if(healI&&S.hp<S.maxHp*0.6){G.buy(healI.i);return}
    const rel=order.filter(o=>o.it.kind==='relic'||o.it.kind==='up'||o.it.kind==='charm'||o.it.kind==='weaken');
    if(rel.length&&Math.random()<(S.relics.coinbeat?0.15:0.8)){G.buy(rel[Math.floor(Math.random()*rel.length)].i);return}
    G.leaveShop();return;
  }
  if(S.mode!=='play'||!S.cur)return;
  // class skill
  if((S.skCharge||0)>=G.skNeed()){
    const fight=S.boss&&!S.boss.dead;
    if(S.cls==='heal'?S.hp<S.maxHp*0.7:fight)G.useSkill();
  }
  if(!S.botNext||S.botPiece!==S.cur){S.botPiece=S.cur;S.botNext=t+opt.think*(0.6+Math.random()*0.8);return}
  if(t<S.botNext)return;
  const c=candidates();if(!c.length){G.hard();return}
  // skill noise: usually the best spot, sometimes a worse one
  let k=0;if(Math.random()<opt.err)k=Math.min(c.length-1,1+Math.floor(Math.random()*4));
  const ch=c[k];S.cur.m=ch.m;S.cur.x=ch.x;S.cur.y=Math.min(S.cur.y,ch.y);S.cur.r=ch.r;S.lastRot=false;
  G.hard();S.botNext=0;
}
function runOne(cls,diff,opt){
  t+=100000;timers.length=0;
  G.newRun(false,0,cls,diff,false,'line');
  const S=G.S,res={cls,diff,floor:1,kills:0,lv:1,cause:'',win:false,bossT:[],gameT:0};
  let bossStart=0,curBoss=null;const t0=t,LIMIT=t0+60*60*1000;
  while(t<LIMIT){
    t+=16;
    for(let i=timers.length-1;i>=0;i--)if(timers[i].at<=t){const f=timers[i].f;timers.splice(i,1);try{f()}catch(e){}}
    if(opt.grant&&!S.granted&&S.floor>=opt.grant.floor&&S.mode==='play'){S.granted=1;S.relics[opt.grant.k]=1}
    raf(t);act(opt);if(opt.debug&&(t-t0)%10000<16)console.log(Math.round((t-t0)/1000),S.mode,S.floor,S.hp,S.boss&&S.boss.hp,S.cur&&S.cur.t);
    if(S.boss&&S.boss===curBoss){const d=S.boss.myDmg-(curBoss.lastSeen||0);if(d>0){res.maxHit=Math.max(res.maxHit||0,d);if(S.floor>=6)res.lateHit=Math.max(res.lateHit||0,d)}curBoss.lastSeen=S.boss.myDmg}
    if(S.boss&&S.boss!==curBoss){curBoss=S.boss;bossStart=t;curBoss.lastSeen=S.boss.myDmg}
    if(curBoss&&curBoss.dead&&!curBoss.counted){curBoss.counted=true;res.bossT.push(Math.round((t-bossStart)/1000));(res.bossTF=res.bossTF||[]).push([S.floor,Math.round((t-bossStart)/1000),S.gold])}
    if(S.mode==='over'){res.cause=S.cause||'?';break}
    if(S.mode==='win'){res.win=true;break}
  }
  res.core=S.core;res.coreN=S.coreN;res.floor=S.floor;res.kills=S.bossKills;res.lv=S.level;res.gameT=Math.round((t-t0)/1000);res.hpMax=S.maxHp;res.relics=Object.keys(S.relics).length;
  return res;
}
module.exports={runOne,G};
if(require.main===module){
  const [cls='all',diff='easy',runs='10',pps='1.4',err='0.25']=process.argv.slice(2);
  const opt={think:1000/+pps,err:+err};
  const classes=cls==='all'?['tank','heal','buff','atk']:[cls];
  for(const c of classes){
    const rs=[];for(let i=0;i<+runs;i++)rs.push(runOne(c,diff,opt));
    const wins=rs.filter(r=>r.win).length,avgF=(rs.reduce((a,r)=>a+r.floor,0)/rs.length).toFixed(1);
    const causes={};rs.filter(r=>!r.win).forEach(r=>causes[r.cause]=(causes[r.cause]||0)+1);
    const bt=rs.flatMap(r=>r.bossT);const avgBT=bt.length?(bt.reduce((a,b)=>a+b,0)/bt.length).toFixed(0):'-';
    const floors=Array(9).fill(0);rs.forEach(r=>floors[r.win?8:r.floor]++);
    console.log(JSON.stringify({cls:c,diff,runs:rs.length,clear:wins,avgFloor:+avgF,deathFloors:floors.slice(1).join(' '),avgBossSec:+avgBT,avgLv:+(rs.reduce((a,r)=>a+r.lv,0)/rs.length).toFixed(1),causes}));
  }
}
