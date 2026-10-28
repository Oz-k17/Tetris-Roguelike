const {runOne}=require('./balance-bot.js');
const [diffs,runs]=[process.argv[2].split(','),+process.argv[3]];
const skills={beginner:{think:1250,err:0.5},average:{think:830,err:0.3},skilled:{think:500,err:0.1}};
for(const diff of diffs)for(const [sk,opt] of Object.entries(skills))for(const cls of ['tank','heal','buff','atk']){
  const rs=[];for(let i=0;i<runs;i++)rs.push(runOne(cls,diff,opt));
  const causes={};rs.filter(r=>!r.win).forEach(r=>causes[r.cause]=(causes[r.cause]||0)+1);
  const bt=rs.flatMap(r=>r.bossT);
  const floors=Array(9).fill(0);rs.forEach(r=>{if(!r.win)floors[r.floor]++});
  console.log(JSON.stringify({diff,skill:sk,cls,runs,clear:rs.filter(r=>r.win).length,avgFloor:+(rs.reduce((a,r)=>a+(r.win?9:r.floor),0)/runs).toFixed(2),deathByFloor:floors.slice(1),avgBossSec:bt.length?Math.round(bt.reduce((a,b)=>a+b,0)/bt.length):null,avgLv:+(rs.reduce((a,r)=>a+r.lv,0)/runs).toFixed(1),maxHit:Math.max(...rs.map(r=>r.maxHit||0)),medLateHit:(a=>a.length?a.sort((x,y)=>x-y)[a.length>>1]:0)(rs.map(r=>r.lateHit||0).filter(Boolean)),causes}));
}
