/* ===== Logique pure (testable) ===== */
const DISC = {SH:"Simple hommes",SD:"Simple dames",DH:"Double hommes",DD:"Double dames",DX:"Double mixte"};
const isDouble = d => d && d[0]==="D";
const POULE_NAMES = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
function capFor(pts){ return pts===21?30 : pts===15?21 : 15; }

function validateSet(x,y,pts){
  const cap=capFor(pts);
  if(!Number.isInteger(x)||!Number.isInteger(y)||x<0||y<0) return "Scores invalides";
  const hi=Math.max(x,y), lo=Math.min(x,y);
  if(hi>cap) return `Un set ne dépasse pas ${cap} points`;
  if(hi<pts) return `Set incomplet (${x}-${y})`;
  if(hi===pts && lo<=pts-2) return null;
  if(hi>pts && hi-lo===2) return null;
  if(hi===cap && lo===cap-1) return null;
  return `Score de set impossible (${x}-${y})`;
}
/* sets: [[a,b],...] ; renvoie {err} ou {winner:'a'|'b'} */
function validateMatch(sets,pts,sg){
  if(!sets.length) return {err:"Aucun set saisi"};
  let wa=0,wb=0;
  for(let i=0;i<sets.length;i++){
    if(wa===sg||wb===sg) return {err:"Trop de sets : le match était déjà terminé"};
    const [a,b]=sets[i]; const e=validateSet(a,b,pts);
    if(e) return {err:`Set ${i+1} : ${e}`};
    if(a>b) wa++; else wb++;
  }
  if(wa<sg&&wb<sg) return {err:`Match incomplet : il faut ${sg} set${sg>1?"s":""} gagnant${sg>1?"s":""}`};
  return {winner: wa>wb?"a":"b"};
}
/* Round robin (méthode du cercle) -> liste de paires [i,j] */
function roundRobin(ids){
  const a=ids.slice(); if(a.length%2) a.push(null);
  const n=a.length, out=[];
  for(let r=0;r<n-1;r++){
    for(let i=0;i<n/2;i++){ const x=a[i], y=a[n-1-i]; if(x!==null&&y!==null) out.push(r%2?[y,x]:[x,y]); }
    a.splice(1,0,a.pop());
  }
  return out;
}
function sortedEntries(tab){
  return Object.entries(tab.entrees||{}).map(([id,e])=>({id,...e})).sort((p,q)=>(p.ordre||0)-(q.ordre||0));
}
/* Répartition en serpentin des entrées (ordonnées = têtes de série en premier) */
function distribute(ids,P){
  const poules=Array.from({length:P},()=>[]);
  ids.forEach((id,i)=>{ const row=Math.floor(i/P), col=i%P; poules[row%2===0?col:P-1-col].push(id); });
  return poules;
}
function buildPoules(tab){
  const ids=sortedEntries(tab).map(e=>e.id);
  const P=Math.max(1,Math.min(tab.nbPoules||1,Math.floor(ids.length/2)));
  const poules=distribute(ids,P).map((entrees,pi)=>({nom:POULE_NAMES[pi],entrees}));
  const matchs={};
  poules.forEach((p,pi)=>{ roundRobin(p.entrees).forEach(([x,y],k)=>{ matchs[`p${pi}m${k}`]={type:"poule",poule:pi,ordre:k,a:x,b:y,scores:[],vainqueur:null,statut:"a_jouer",wo:false,terrain:null}; }); });
  return {poules,matchs};
}
function matchStats(m,pts,sg){
  /* renvoie {sa,sb,pa,pb} */
  if(m.wo){ const aw=m.vainqueur==="a"; return {sa:aw?sg:0,sb:aw?0:sg,pa:aw?pts*sg:0,pb:aw?0:pts*sg}; }
  let sa=0,sb=0,pa=0,pb=0;
  (m.scores||[]).forEach(([a,b])=>{ pa+=a; pb+=b; if(a>b) sa++; else if(b>a) sb++; });
  return {sa,sb,pa,pb};
}
function standings(tab,pi){
  const p=tab.poules[pi]; const pts=tab.pts||21, sg=tab.sg||2;
  const st={}; p.entrees.forEach(id=>st[id]={id,J:0,V:0,D:0,sw:0,sl:0,pw:0,pl:0});
  const ms=Object.values(tab.matchs||{}).filter(m=>m.type==="poule"&&m.poule===pi);
  ms.forEach(m=>{
    if(m.statut!=="termine"||!m.vainqueur||!st[m.a]||!st[m.b]) return;
    const s=matchStats(m,pts,sg), A=st[m.a], B=st[m.b];
    A.J++;B.J++;
    if(m.vainqueur==="a"){A.V++;B.D++;}else{B.V++;A.D++;}
    A.sw+=s.sa;A.sl+=s.sb;B.sw+=s.sb;B.sl+=s.sa;
    A.pw+=s.pa;A.pl+=s.pb;B.pw+=s.pb;B.pl+=s.pa;
  });
  const arr=Object.values(st);
  const h2h=(x,y)=>{ const m=ms.find(m=>m.statut==="termine"&&((m.a===x&&m.b===y)||(m.a===y&&m.b===x))); if(!m) return 0; const wid=m.vainqueur==="a"?m.a:m.b; return wid===x?-1:1; };
  arr.sort((x,y)=> y.V-x.V || ((y.sw-y.sl)-(x.sw-x.sl)) || ((y.pw-y.pl)-(x.pw-x.pl)) || (p.entrees.indexOf(x.id)-p.entrees.indexOf(y.id)));
  /* départage à deux : confrontation directe */
  for(let i=0;i<arr.length;i++){
    let j=i; while(j+1<arr.length&&arr[j+1].V===arr[i].V) j++;
    if(j-i===1){ if(h2h(arr[i].id,arr[j].id)===1){ const t=arr[i]; arr[i]=arr[j]; arr[j]=t; } }
    i=j;
  }
  return arr;
}
/* Recalcule les matchs de poule après modification des poules : les matchs déjà existants entre deux équipes toujours dans la même poule sont conservés */
function rebuildMatches(tab,poules){
  const key=(a,b)=>[a,b].sort().join("|"), old={}, matchs={};
  Object.entries(tab.matchs||{}).forEach(([k,m])=>{ if(m.type==="poule") old[key(m.a,m.b)]=m; else matchs[k]=m; });
  poules.forEach((p,pi)=>roundRobin(p.entrees).forEach(([x,y],k)=>{
    const o=old[key(x,y)];
    matchs[`p${pi}m${k}`]= o ? {...o,poule:pi,ordre:k} : {type:"poule",poule:pi,ordre:k,a:x,b:y,scores:[],vainqueur:null,statut:"a_jouer",wo:false,terrain:null};
  }));
  return matchs;
}
function pouleDone(tab){
  return Object.values(tab.matchs||{}).filter(m=>m.type==="poule").every(m=>m.statut==="termine");
}
function seedOrder(size){ let a=[1]; while(a.length<size){ const m=a.length*2+1; a=a.flatMap(s=>[s,m-s]); } return a; }
function nextPow2(n){ let s=1; while(s<n) s*=2; return s; }
/* Ordre de classement : tous les 1ers, puis tous les 2es… (de from à to exclus) */
function byRank(tab,from,to){
  const out=[]; const sts=tab.poules.map((_,pi)=>standings(tab,pi));
  const max=Math.max(0,...sts.map(s=>s.length));
  for(let r=from;r<Math.min(to,max);r++) sts.forEach(s=>{ if(s[r]) out.push(s[r].id); });
  return out;
}
function qualifiers(tab){ return byRank(tab,0,tab.qualif||2); }
function consolants(tab){ return byRank(tab,tab.qualif||2,Infinity); }
/* Construit un tableau à élimination directe : br = "f" (principal) ou "c" (consolante) */
function buildFinale(seeds,br="f"){
  const n=seeds.length, size=nextPow2(n), R=Math.log2(size);
  const order=seedOrder(size), matchs={};
  for(let r=0;r<R;r++){ const cnt=size/2**(r+1); for(let i=0;i<cnt;i++) matchs[`${br}${r}m${i}`]={type:"finale",br,round:r,idx:i,a:null,b:null,scores:[],vainqueur:null,statut:"a_jouer",wo:false,bye:false,terrain:null}; }
  for(let i=0;i<size/2;i++){
    const m=matchs[`${br}0m${i}`];
    const sa=order[2*i], sb=order[2*i+1];
    m.a = sa<=n ? seeds[sa-1] : null;
    m.b = sb<=n ? seeds[sb-1] : null;
    if(!m.a||!m.b){
      m.bye=true; m.statut="termine"; m.vainqueur=m.a?"a":"b";
      if(R>1){ const nx=matchs[`${br}1m${Math.floor(i/2)}`]; nx[i%2===0?"a":"b"]=m.a||m.b; }
    }
  }
  return {finale:{size,R},matchs};
}
/* ===== Phase finale progressive =====
   Le tableau est créé dès les poules avec des places réservées {p: poule, r: rang}.
   Dès qu'une poule est terminée, ses équipes prennent leur place. */
function planSlots(tab){
  const Q=tab.qualif||2, sizes=(tab.poules||[]).map(p=>p.entrees.length), max=Math.max(0,...sizes);
  let main=[], cons=[];
  for(let r=0;r<max;r++) sizes.forEach((s,p)=>{ if(r<s) (r<Q?main:cons).push({p,r}); });
  if(cons.length===1||main.length<2){ main=main.concat(cons); cons=[]; } /* personne n'est éliminé */
  return {main,cons};
}
function buildBracket(slots,br){
  const n=slots.length, size=nextPow2(n), R=Math.log2(size), order=seedOrder(size), matchs={};
  for(let r=0;r<R;r++){ const cnt=size/2**(r+1); for(let i=0;i<cnt;i++) matchs[`${br}${r}m${i}`]={type:"finale",br,round:r,idx:i,a:null,b:null,sa:null,sb:null,scores:[],vainqueur:null,statut:"a_jouer",wo:false,bye:false,terrain:null}; }
  for(let i=0;i<size/2;i++){
    const m=matchs[`${br}0m${i}`], s1=order[2*i], s2=order[2*i+1];
    m.sa = s1<=n ? slots[s1-1] : null; m.sb = s2<=n ? slots[s2-1] : null;
    if(!m.sa||!m.sb) m.bye=true;
  }
  return {info:{size,R},matchs};
}
function buildFinales(tab){
  const {main,cons}=planSlots(tab); if(main.length<2) return {finale:null,matchs:{}};
  const P=buildBracket(main,"f"), C=cons.length>=2?buildBracket(cons,"c"):null;
  return {finale:{f:P.info,...(C?{c:C.info}:{})}, matchs:{...P.matchs,...(C?C.matchs:{})}};
}
function pouleIsDone(matchs,pi){ return Object.values(matchs).filter(m=>m.type==="poule"&&m.poule===pi).every(m=>m.statut==="termine"); }
function deepMerge(t,s){ for(const [k,v] of Object.entries(s)){ if(v&&typeof v==="object"&&!Array.isArray(v)&&t[k]&&typeof t[k]==="object"&&!Array.isArray(t[k])) deepMerge(t[k],v); else t[k]=v; } return t; }
/* Calcule les mises à jour du tableau final selon l'état des poules.
   matchs = tous les matchs (avec les changements en attente). Renvoie {upd} ou {err}. */
function syncFinale(tab,matchs){
  const upd={}, FI=finInfo(tab), view={...tab,matchs};
  const st=(tab.poules||[]).map((_,pi)=>pouleIsDone(matchs,pi)?standings(view,pi):null);
  const cur=id=>({...matchs[id],...(upd[id]||{})});
  const put=(id,o)=>{ upd[id]={...(upd[id]||{}),...o}; };
  const ids=Object.keys(matchs).filter(id=>{ const m=matchs[id]; return m.type==="finale"&&m.round===0&&(m.sa||m.sb); }).sort();
  for(const id of ids){
    const m=matchs[id];
    for(const side of ["a","b"]){
      const s=m["s"+side]; if(!s) continue;
      const want=st[s.p]?(st[s.p][s.r]?st[s.p][s.r].id:null):null;
      if((m[side]||null)!==want){
        if(!m.bye&&m.statut!=="a_jouer") return {err:`Ce changement modifie le classement de la poule ${tab.poules[s.p].nom}, déjà utilisé en phase finale (match lancé ou joué). Efface d'abord ce match de phase finale.`};
        put(id,{[side]:want});
      }
    }
    if(m.bye){
      const real=m.sa?"a":"b", want=cur(id)[real]||null, R=(FI[m.br||"f"]||{}).R||1, nx=nextOf(m,R);
      const stat=want?"termine":"a_jouer", win=want?real:null;
      if(m.statut!==stat||m.vainqueur!==win) put(id,{statut:stat,vainqueur:win});
      if(nx&&(matchs[nx.id][nx.slot]||null)!==want){
        if(matchs[nx.id].statut!=="a_jouer") return {err:`Ce changement modifie le classement de la poule ${tab.poules[(m.sa||m.sb).p].nom}, déjà utilisé en phase finale (match lancé ou joué). Efface d'abord ce match de phase finale.`};
        put(nx.id,{[nx.slot]:want});
      }
    }
  }
  return {upd};
}
/* Document complet d'un tableau avec ses poules et un tableau final neuf, déjà synchronisé */
function withFinale(tab,poules,pouleMatchs){
  const base={...tab,poules,matchs:pouleMatchs};
  const F=buildFinales(base);
  const matchs={...pouleMatchs,...F.matchs};
  const doc={...base,matchs,finale:F.finale,phase:"poules"};
  const s=syncFinale(doc,matchs); if(s.upd) deepMerge(doc.matchs,JSON.parse(JSON.stringify(s.upd)));
  return doc;
}
function finaleStarted(tab){ return Object.values(tab.matchs||{}).some(m=>m.type==="finale"&&!m.bye&&m.statut!=="a_jouer"); }
/* ===== Estimation de la durée restante =====
   Renvoie {restants, vagues} : restants = matchs à jouer (en cours = 0,5),
   vagues = nombre minimum de « tours » imposé par l'enchaînement (une équipe ne joue qu'un match à la fois,
   un tour de tableau attend le précédent). */
function rrRounds(k){ return k<2?0:(k%2?k:k-1); }
function estimateTableau(tab){
  const ms=Object.values(tab.matchs||{});
  if(tab.phase==="inscriptions"||!(tab.poules||[]).length){
    const n=Object.keys(tab.entrees||{}).length; if(n<2) return {restants:0,vagues:0};
    const P=Math.max(1,Math.min(tab.nbPoules||1,Math.floor(n/2)));
    const sizes=distribute(Array.from({length:n},(_,i)=>i),P).map(p=>p.length);
    const fake={qualif:tab.qualif,poules:sizes.map(s=>({entrees:Array(s).fill(0)}))};
    const {main,cons}=planSlots(fake);
    const restants=sizes.reduce((a,k)=>a+k*(k-1)/2,0)+Math.max(0,main.length-1)+Math.max(0,cons.length-1);
    const vagues=Math.max(...sizes.map(rrRounds))+Math.max(Math.ceil(Math.log2(Math.max(1,main.length))),Math.ceil(Math.log2(Math.max(1,cons.length))));
    return {restants,vagues};
  }
  let restants=0;
  ms.forEach(m=>{ if(m.bye||m.statut==="termine") return; restants+= m.statut==="en_cours"?0.5:1; });
  /* poules : matchs restants de l'équipe la plus chargée */
  const left={}; ms.forEach(m=>{ if(m.type==="poule"&&m.statut!=="termine"){ left[m.a]=(left[m.a]||0)+1; left[m.b]=(left[m.b]||0)+1; } });
  const pv=Math.max(0,...Object.values(left));
  /* tableaux : tours pas encore terminés */
  const FI=finInfo(tab); let bv=0;
  Object.entries(FI).forEach(([br,inf])=>{ let r=0; for(let k=0;k<inf.R;k++){ const rm=ms.filter(m=>m.type==="finale"&&(m.br||"f")===br&&m.round===k); if(rm.every(m=>m.statut==="termine")) r++; else break; } bv=Math.max(bv,inf.R-r); });
  return {restants,vagues:pv+bv};
}
function estimateTournoi(tableaux,terrains){
  let restants=0,vagues=0;
  tableaux.forEach(t=>{ const e=estimateTableau(t); restants+=e.restants; vagues=Math.max(vagues,e.vagues); });
  const tours=Math.max(Math.ceil(restants/Math.max(1,terrains||1)),vagues);
  return {restants,vagues,tours};
}
/* ===== Planning prévisionnel =====
   Simule la suite du tournoi : chaque terrain libre prend le prochain match jouable
   (équipes connues ou poule précédente terminée, joueurs libres — un joueur inscrit dans deux tableaux
   ne joue pas deux matchs en même temps). Renvoie {starts:{"tab/match":ms}, end:ms}. */
function schedule(tableaux,terrains,dur,base){
  const D=dur*60000, norm=s=>String(s||"").trim().toLowerCase();
  const nodes={}, pending=[], ends={}, playerFree={}, starts={};
  const terr=Array(Math.max(1,terrains)).fill(base);
  const players=(x,eid)=>{ const e=(x.entrees||{})[eid]; return e?[e.j1,e.j2].filter(Boolean).map(norm):[]; };
  const pouleKey=(x,p)=>`P:${x.id}/${p}`;
  const pouleOpen={}; /* clé de poule -> liste des matchs non terminés */
  tableaux.forEach((x,ti)=>{
    if(x.phase==="inscriptions") return;
    const M=x.matchs||{};
    Object.entries(M).forEach(([id,m])=>{ if(m.type==="poule"&&m.statut!=="termine"){ (pouleOpen[pouleKey(x,m.poule)]=pouleOpen[pouleKey(x,m.poule)]||[]).push(`${x.id}/${id}`); } });
    Object.entries(M).forEach(([id,m])=>{
      if(m.bye||m.statut==="termine") return;
      const key=`${x.id}/${id}`, deps=[];
      const pl=(m.a&&m.b)?[...players(x,m.a),...players(x,m.b)]:[];
      if(m.type==="finale"){
        ["a","b"].forEach((side,si)=>{
          if(m[side]) { pl.push(...players(x,m[side])); return; }
          if(m.round===0){ const sl=m["s"+side]; if(sl) deps.push(pouleKey(x,sl.p)); return; }
          const fd=M[`${m.br||"f"}${m.round-1}m${2*m.idx+si}`]; if(!fd) return;
          if(fd.bye){ const sl=fd.sa||fd.sb; if(sl) deps.push(pouleKey(x,sl.p)); }
          else if(fd.statut!=="termine") deps.push(`${x.id}/${m.br||"f"}${m.round-1}m${2*m.idx+si}`);
        });
      }
      const prio= m.type==="finale" ? [0,m.round,ti,m.idx] : [1,m.ordre,ti,m.poule];
      const n={key,deps,pl:[...new Set(pl)],prio};
      nodes[key]=n;
      if(m.statut==="en_cours"){
        const st=Math.min(m.startedAt||base,base), en=Math.max(st+D,base+5*60000);
        ends[key]=en; starts[key]=st;
        const k=terr.indexOf(Math.min(...terr)); terr[k]=Math.max(terr[k],en);
        n.pl.forEach(p=>playerFree[p]=Math.max(playerFree[p]||0,en));
      } else pending.push(n);
    });
  });
  const depEnd=d=>{ if(d.startsWith("P:")){ const l=pouleOpen[d]||[]; let mx=0; for(const k of l){ if(ends[k]===undefined) return Infinity; mx=Math.max(mx,ends[k]); } return mx; }
    return ends[d]===undefined?(nodes[d]?Infinity:0):ends[d]; };
  const readyAt=n=>{ let t=0; for(const d of n.deps){ t=Math.max(t,depEnd(d)); if(t===Infinity) return t; } for(const p of n.pl) t=Math.max(t,playerFree[p]||0); return t; };
  const cmp=(a,b)=>{ for(let i=0;i<4;i++){ if(a.prio[i]!==b.prio[i]) return a.prio[i]-b.prio[i]; } return 0; };
  pending.sort(cmp);
  let guard=0;
  while(pending.length&&guard++<5000){
    const k=terr.indexOf(Math.min(...terr)), T=terr[k];
    let pick=-1, next=Infinity;
    for(let i=0;i<pending.length;i++){ const r=readyAt(pending[i]); if(r<=T){ pick=i; break; } next=Math.min(next,r); }
    if(pick<0){ if(next===Infinity) break; terr[k]=next; continue; }
    const n=pending.splice(pick,1)[0];
    starts[n.key]=T; ends[n.key]=T+D; terr[k]=T+D;
    n.pl.forEach(p=>playerFree[p]=T+D);
  }
  const end=Math.max(base,...Object.values(ends));
  return {starts,end};
}
function slotLabel(s,poules){ if(!s) return ""; return `${s.r+1}${s.r===0?"er":"e"} poule ${(poules[s.p]||{}).nom||"?"}`; }
/* Infos des tableaux finaux, compatible avec l'ancien format {size,R} */
function finInfo(tab){ const f=tab.finale; if(!f) return {}; if(f.size) return {f}; return f; }
function nextOf(m,R){
  if(m.type!=="finale"||m.round>=R-1) return null;
  return {id:`${m.br||"f"}${m.round+1}m${Math.floor(m.idx/2)}`, slot: m.idx%2===0?"a":"b"};
}
function roundName(r,R,plural){
  const left=R-r;
  if(left===1) return "Finale";
  if(left===2) return plural?"Demi-finales":"Demi-finale";
  if(left===3) return plural?"Quarts de finale":"Quart de finale";
  const k=2**(left-1); return plural?`${k}es de finale`:`${k}e de finale`;
}
function scoreText(m, flip){
  if(m.bye) return "";
  if(m.wo) return "WO";
  return (m.scores||[]).map(([a,b])=>flip?`${b}-${a}`:`${a}-${b}`).join("  ");
}
if(typeof module!=="undefined") module.exports={validateSet,validateMatch,roundRobin,distribute,buildPoules,standings,seedOrder,buildFinale,rebuildMatches,schedule,estimateTableau,estimateTournoi,planSlots,buildFinales,syncFinale,withFinale,finaleStarted,deepMerge,qualifiers,consolants,finInfo,nextOf,roundName,pouleDone};
