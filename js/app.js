/* ===== Application — Badminton Club de Plabennec =====
   Données : Supabase (tables tournois et tableaux, colonne data en JSON).
   Lecture publique ; écriture réservée aux comptes de la table organisateurs (RLS côté serveur). */
const S={sb:null,session:null,orga:false,preview:false,slow:false,loadErr:false,
  tournois:[],tLoaded:false,route:{v:"home",t:null,tab:null,name:null},tableaux:[],tabLoaded:false,tabSlow:false,curT:null,
  search:"",psearch:"",open:{},editP:{},sub:{},plan:null,alerted:{},notif:false};
const $app=document.getElementById("app");
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const uid=()=>Math.random().toString(36).slice(2,10)+Math.random().toString(36).slice(2,5);
const isOrga=()=>S.orga&&!S.preview;
const norm=s=>String(s||"").trim().toLowerCase().replace(/\s+/g," ");
const LS={ get(k){ try{ return localStorage.getItem(k); }catch(e){ return null; } }, set(k,v){ try{ localStorage.setItem(k,v); }catch(e){} }, del(k){ try{ localStorage.removeItem(k); }catch(e){} } };

function toast(msg){ const t=document.getElementById("toast"); t.textContent=msg; t.classList.add("on"); clearTimeout(toast._t); toast._t=setTimeout(()=>t.classList.remove("on"),3200); }

/* ---- couche de données ---- */
const tPath=id=>`tournois/${id}`;
const tabPath=(t,x)=>`tournois/${t}/tableaux/${x}`;
const strip=o=>{ const c=JSON.parse(JSON.stringify(o)); delete c.id; return c; };
function parsePath(path){ const p=path.split("/"); return p.length===2?{tbl:"tournois",id:p[1]}:{tbl:"tableaux",tid:p[1],id:p[3]}; }
const sortT=()=>S.tournois.sort((a,b)=>(b.createdAt||0)-(a.createdAt||0));
const sortX=()=>S.tableaux.sort((a,b)=>(a.createdAt||0)-(b.createdAt||0));
/* applique tout de suite le changement à l'écran (le serveur confirme ensuite en temps réel) */
function localApply(P,kind,data){
  const list=P.tbl==="tournois"?S.tournois:S.tableaux;
  if(P.tbl==="tableaux"&&P.tid!==S.curT) return;
  const i=list.findIndex(r=>r.id===P.id);
  if(kind==="delete"){ if(i>=0) list.splice(i,1); }
  else if(kind==="set"){ const row={id:P.id,...JSON.parse(JSON.stringify(data))}; if(i>=0) list[i]=row; else list.push(row); }
  else if(i>=0){ list[i]=deepMerge(JSON.parse(JSON.stringify(list[i])),JSON.parse(JSON.stringify(data))); }
  P.tbl==="tournois"?sortT():sortX();
}
const queues={};
function enqueue(key,fn){ const p=(queues[key]||Promise.resolve()).then(fn,fn); queues[key]=p.catch(()=>{}); return p; }
async function W(path,kind,data){
  if(!S.orga){ toast("Connecte-toi en organisateur pour modifier."); return false; }
  const P=parsePath(path);
  localApply(P,kind,data); render();
  try{
    await enqueue(path,async()=>{
      let r;
      if(kind==="set") r=await S.sb.from(P.tbl).upsert(P.tbl==="tableaux"?{id:P.id,tournoi_id:P.tid,data}:{id:P.id,data});
      else if(kind==="update") r=await S.sb.rpc(P.tbl==="tournois"?"patch_tournoi":"patch_tableau",{p_id:P.id,p_patch:data});
      else r=await S.sb.from(P.tbl).delete().eq("id",P.id);
      if(r.error) throw r.error;
    });
    return true;
  }catch(e){
    console.error(e);
    toast(/interdit|row-level|permission|JWT/i.test(e.message||"")?"Action refusée : ta session d'organisateur a expiré, reconnecte-toi.":"Enregistrement impossible, vérifie la connexion et réessaie.");
    await reload(); return false;
  }
}
async function loadTournois(){
  const {data,error}=await S.sb.from("tournois").select("id,data"); if(error) throw error;
  S.tournois=data.map(r=>({id:r.id,...r.data})); sortT(); S.tLoaded=true;
}
async function loadTableaux(t){
  const {data,error}=await S.sb.from("tableaux").select("id,data").eq("tournoi_id",t); if(error) throw error;
  if(t!==S.curT) return;
  S.tableaux=data.map(r=>({id:r.id,...r.data})); sortX(); S.tabLoaded=true; S.tabSlow=false;
}
async function reload(){ try{ await loadTournois(); if(S.curT) await loadTableaux(S.curT); S.loadErr=false; }catch(e){ S.loadErr=true; } render(); }
function onChange(tbl,p){
  if(p.eventType==="DELETE"){ const id=p.old&&p.old.id; if(!id) return reload();
    const list=tbl==="tournois"?S.tournois:S.tableaux; const i=list.findIndex(r=>r.id===id); if(i>=0) list.splice(i,1); }
  else { const r=p.new; if(!r) return;
    if(tbl==="tableaux"&&r.tournoi_id!==S.curT) return;
    const list=tbl==="tournois"?S.tournois:S.tableaux; const row={id:r.id,...r.data}; const i=list.findIndex(x=>x.id===r.id);
    if(i>=0) list[i]=row; else list.push(row); tbl==="tournois"?sortT():sortX(); }
  render(); checkAlerts();
}

/* ---- connexion organisateur ---- */
async function checkOrga(){
  if(!S.session){ S.orga=false; render(); return; }
  const {data}=await S.sb.from("organisateurs").select("user_id").eq("user_id",S.session.user.id).maybeSingle();
  S.orga=!!data; render();
}

/* ---- init ---- */
(async function init(){
  const cfg=window.BCP_CONFIG||{};
  if(!window.supabase||!cfg.supabaseUrl||!cfg.supabaseAnonKey||/VOTRE|YOUR/.test(cfg.supabaseUrl)){
    $app.innerHTML=`<div class="card empty"><h2>Configuration manquante</h2><p>Renseigne l'adresse et la clé publique Supabase dans <code>js/config.js</code> (voir le README).</p></div>`; return;
  }
  S.sb=window.supabase.createClient(cfg.supabaseUrl,cfg.supabaseAnonKey);
  render();
  const slow=setTimeout(()=>{ if(!S.tLoaded){ S.slow=true; render(); } },10000);
  window.addEventListener("hashchange",route);
  S.sb.auth.onAuthStateChange((ev,session)=>{ S.session=session; checkOrga(); });
  try{ const {data}=await S.sb.auth.getSession(); S.session=data.session; }catch(e){}
  await checkOrga();
  try{ await loadTournois(); clearTimeout(slow); S.slow=false; }catch(e){ S.loadErr=true; }
  S.sb.channel("bcp-live")
    .on("postgres_changes",{event:"*",schema:"public",table:"tournois"},p=>onChange("tournois",p))
    .on("postgres_changes",{event:"*",schema:"public",table:"tableaux"},p=>onChange("tableaux",p))
    .subscribe(st=>{ S.rt=st; if(st==="SUBSCRIBED") reload(); });
  route();
  /* filet de sécurité si le temps réel décroche + heure de fin/passage à jour */
  setInterval(()=>{ if(document.hidden) return; if(S.rt!=="SUBSCRIBED") reload(); else { const ae=document.activeElement; if(S.curT&&!(ae&&ae.tagName==="SELECT")) render(); } },30000);
  document.addEventListener("visibilitychange",()=>{ if(!document.hidden) reload(); });
})();

function route(){
  const parts=location.hash.replace(/^#\/?/,"").split("/").filter(Boolean).map(p=>{ try{ return decodeURIComponent(p); }catch(e){ return p; } });
  let r={v:"home",t:null,tab:null,name:null};
  if(parts[0]==="orga") r.v="login";
  else if(parts[0]==="t"&&parts[1]){ r.t=parts[1]; if(parts[2]==="qr") r.v="qr"; else { r.v="tournoi"; r.tab=parts[2]||null; } }
  else if(parts[0]==="j"&&parts[1]){ r.t=parts[1]; r.v="joueur"; r.name=parts[2]||null;
    if(!r.name){ const saved=LS.get("bcp-joueur-"+r.t); if(saved&&!S.choosing){ location.replace(`#/j/${encodeURIComponent(r.t)}/${encodeURIComponent(saved)}`); return; } } }
  S.choosing=false;
  if(r.t!==S.curT){
    S.curT=r.t; S.tableaux=[]; S.tabLoaded=false; S.tabSlow=false;
    if(r.t){ const t=r.t; setTimeout(()=>{ if(!S.tabLoaded&&S.curT===t){ S.tabSlow=true; render(); } },10000);
      loadTableaux(t).then(()=>{ render(); checkAlerts(true); }).catch(()=>{ S.loadErr=true; render(); }); }
  }
  S.route=r;
  render(); window.scrollTo(0,0);
}
const go=(t,tab)=>{ const h=t?`#/t/${encodeURIComponent(t)}${tab?"/"+encodeURIComponent(tab):""}`:"#/"; if(location.hash===h) route(); else location.hash=h; };
const goHash=h=>{ if(location.hash===h) route(); else location.hash=h; };

/* ---- rendu avec préservation des saisies ---- */
function render(){
  if(!S.sb) return;
  const keep={}; $app.querySelectorAll("input[id],textarea[id],select[id]").forEach(el=>{ if(el.dataset.live!=="1"&&el.type!=="password") keep[el.id]=el.value; });
  const ae=document.activeElement, aid=ae&&ae.id&&$app.contains(ae)?ae.id:null, sel=aid&&ae.selectionStart!=null?[ae.selectionStart,ae.selectionEnd]:null;
  computePlan();
  $app.innerHTML=view();
  Object.entries(keep).forEach(([id,v])=>{ const el=document.getElementById(id); if(el&&el.dataset.live!=="1"&&el.type!=="checkbox") el.value=v; });
  if(aid){ const el=document.getElementById(aid); if(el){ el.focus(); if(sel&&el.setSelectionRange){ try{el.setSelectionRange(sel[0],sel[1]);}catch(e){} } } }
  renderMode();
}
function renderMode(){
  const b=document.getElementById("modeBox"); const t=S.curT;
  const pl= t&&S.route.v!=="joueur" ? `<a class="btn sm" href="#/j/${encodeURIComponent(t)}">Espace joueur</a>` : "";
  if(S.orga) b.innerHTML=`<span class="row">${pl}<span class="pill ${S.preview?"view":"orga"}">${S.preview?"Vue publique":"Organisateur"}</span><button class="btn sm" data-act="preview">${S.preview?"Mode orga":"Vue publique"}</button><button class="btn sm" data-act="logout" title="Se déconnecter">Déconnexion</button></span>`;
  else b.innerHTML=`<span class="row">${pl}<span class="pill view">● En direct</span></span>`;
}

function view(){
  if(S.route.v==="login") return viewLogin();
  if(S.loadErr&&!S.tLoaded) return `<div class="notice err">Impossible de charger les données pour le moment. <button class="btn sm" data-act="reload">Réessayer</button></div>`;
  if(!S.tLoaded) return `<div class="card empty">${S.slow?"Les données ne répondent pas encore… vérifie ta connexion.":"Chargement…"}</div>`;
  if(S.route.v==="joueur") return viewJoueur();
  if(S.route.v==="qr") return viewQR();
  if(S.route.t) return viewTournoi();
  return viewHome();
}

function viewLogin(){
  if(S.orga) return `<div class="card" style="max-width:420px;margin:30px auto"><h2>Connecté</h2><p class="muted">Tu es connecté en organisateur (${esc(S.session.user.email)}).</p><div class="row"><a class="btn pri" href="#/">Aller aux tournois</a><button class="btn" data-act="logout">Se déconnecter</button></div></div>`;
  return `<form class="card col" data-form="login" style="max-width:420px;margin:30px auto;gap:12px">
    <h2>Accès organisateur</h2>
    <div class="small muted">Réservé aux organisateurs du club. Les comptes sont créés par l'administrateur.</div>
    ${S.session&&!S.orga?`<div class="notice err">Ce compte (${esc(S.session.user.email)}) n'est pas autorisé comme organisateur.</div>`:""}
    <label class="f">E-mail<input type="text" id="lg-mail" autocomplete="username" inputmode="email" required></label>
    <label class="f">Mot de passe<input type="password" id="lg-pw" autocomplete="current-password" required></label>
    <div class="err-txt" id="lg-err"></div>
    <button class="btn pri" type="submit">Se connecter</button>
  </form>`;
}

/* ---- QR codes ---- */
function baseUrl(){ return location.origin+location.pathname; }
function qrSvg(text){ try{ const q=qrcode(0,"M"); q.addData(text); q.make(); return q.createSvgTag({cellSize:6,margin:2,scalable:true}); }catch(e){ return `<div class="small muted">QR indisponible</div>`; } }
function allPlayers(){
  const m=new Map();
  S.tableaux.forEach(x=>Object.values(x.entrees||{}).forEach(e=>[e.j1,e.j2].filter(Boolean).forEach(n=>{ const k=norm(n); if(!m.has(k)) m.set(k,{nom:n.trim(),club:e.club||"",tabs:new Set()}); m.get(k).tabs.add(x.nom); })));
  return [...m.values()].sort((a,b)=>a.nom.localeCompare(b.nom,"fr"));
}
function viewQR(){
  const t=curTournoi(); if(!t) return `<div class="card empty">Tournoi introuvable. <a href="#/">Retour</a></div>`;
  const url=`${baseUrl()}#/j/${encodeURIComponent(t.id)}`;
  let h=`<div class="noprint row" style="justify-content:space-between;margin-bottom:12px"><a href="#/t/${encodeURIComponent(t.id)}" class="small">← Retour au tournoi</a>
    <div class="row"><label class="small row" style="gap:6px"><input type="checkbox" id="qr-all" data-live="1" ${S.qrAll?"checked":""} data-act="qrAll"> QR individuel par joueur</label><button class="btn pri" data-act="print">Imprimer</button></div></div>
  <div class="qr-main card">
    <div class="clubname" style="color:var(--brand)">Badminton Club de Plabennec</div>
    <h2 style="font-size:34px">${esc(t.nom)}</h2>
    <div class="qr-big">${qrSvg(url)}</div>
    <div class="qr-txt">Scanne pour ton <b>espace joueur</b></div>
    <div class="muted">Tes matchs, ton heure de passage, ton terrain et tes résultats en direct</div>
    <div class="small muted" style="margin-top:8px;word-break:break-all">${esc(url)}</div>
  </div>`;
  if(S.qrAll){
    if(!S.tabLoaded) return h+`<div class="card empty">Chargement…</div>`;
    const ps=allPlayers();
    h+=`<div class="qr-sheet">${ps.map(p=>`<div class="qrc"><div class="qr-sm">${qrSvg(`${baseUrl()}#/j/${encodeURIComponent(t.id)}/${encodeURIComponent(p.nom)}`)}</div><div><b>${esc(p.nom)}</b><div class="small muted">${esc([...p.tabs].join(" · "))}</div></div></div>`).join("")}</div>`;
  }
  return h;
}

/* ---- espace joueur ---- */
function playerTeams(name){
  const n=norm(name), out=[];
  S.tableaux.forEach(x=>Object.entries(x.entrees||{}).forEach(([eid,e])=>{ if(norm(e.j1)===n||norm(e.j2)===n) out.push({x,eid,e}); }));
  return out;
}
function teamMatches(x,eid){
  return Object.entries(x.matchs||{}).filter(([,m])=>!m.bye&&(m.a===eid||m.b===eid)).map(([id,m])=>({x,id,m}))
    .sort((p,q)=> (p.m.type===q.m.type?0:(p.m.type==="poule"?-1:1)) || (p.m.type==="poule"?p.m.ordre-q.m.ordre:((p.m.br||"f")>(q.m.br||"f")?1:-1)||p.m.round-q.m.round));
}
function oppLabel(x,m,side){
  const o=side==="a"?"b":"a";
  if(m[o]) return esc(nm(x,m[o]));
  if(m.round===0) return `<span class="tbd">${esc(slotLabel(m["s"+o],x.poules||[]))}</span>`;
  const fd=x.matchs[`${m.br||"f"}${m.round-1}m${2*m.idx+(o==="a"?0:1)}`];
  if(fd&&fd.bye&&(fd.sa||fd.sb)) return `<span class="tbd">${esc(slotLabel(fd.sa||fd.sb,x.poules||[]))}</span>`;
  if(fd&&fd.a&&fd.b) return `<span class="tbd">vainqueur de ${esc(nm(x,fd.a))} – ${esc(nm(x,fd.b))}</span>`;
  return `<span class="tbd">à déterminer</span>`;
}
function myMatches(name){
  const out=[]; playerTeams(name).forEach(tm=>teamMatches(tm.x,tm.eid).forEach(r=>out.push({...r,eid:tm.eid,side:r.m.a===tm.eid?"a":"b"}))); return out;
}
function startOf(r){ return S.plan&&S.plan.starts[`${r.x.id}/${r.id}`]; }
function viewJoueur(){
  const t=curTournoi(); if(!t) return `<div class="card empty">Tournoi introuvable. <a href="#/">Retour aux tournois</a></div>`;
  if(!S.tabLoaded) return `<div class="card empty">Chargement…</div>`;
  const name=S.route.name;
  if(!name){
    const q=norm(S.psearch), ps=allPlayers().filter(p=>!q||norm(p.nom).includes(q));
    return `<div class="card" style="max-width:560px;margin:0 auto">
      <div class="clubname" style="color:var(--brand)">${esc(t.nom)}</div><h2 style="font-size:28px;margin:4px 0 8px">Ton espace joueur</h2>
      <div class="muted small" style="margin-bottom:10px">Choisis ton nom : ton téléphone s'en souviendra.</div>
      <input type="text" id="psearch" data-live="1" placeholder="Tape ton nom…" value="${esc(S.psearch)}" style="width:100%;font-size:17px;padding:12px">
      <div class="plist">${ps.slice(0,60).map(p=>`<button class="pitem" data-act="pickJ" data-n="${esc(p.nom)}"><b>${esc(p.nom)}</b><span class="small muted">${esc([...p.tabs].join(" · "))}</span></button>`).join("")||`<div class="empty">Aucun joueur trouvé.</div>`}</div></div>`;
  }
  const teams=playerTeams(name);
  if(!teams.length) return `<div class="card empty">Le nom « ${esc(name)} » n'est (plus) inscrit à ce tournoi.<br><br><button class="btn pri" data-act="changeJ">Choisir mon nom</button></div>`;
  const ms=myMatches(name);
  const live=ms.filter(r=>r.m.statut==="en_cours");
  const todo=ms.filter(r=>r.m.statut==="a_jouer").sort((p,q)=>(startOf(p)??Infinity)-(startOf(q)??Infinity));
  let h=`<div class="row" style="justify-content:space-between;align-items:flex-end;margin-bottom:12px">
    <div><div class="clubname" style="color:var(--brand)">${esc(t.nom)}</div><h2 style="font-size:30px;margin-top:2px">${esc(teams[0].e.j1&&norm(teams[0].e.j1)===norm(name)?teams[0].e.j1:teams[0].e.j2||name)}</h2></div>
    <div class="row"><a class="btn sm" href="#/t/${encodeURIComponent(t.id)}">Tout le tournoi</a><button class="btn sm" data-act="changeJ">Ce n'est pas moi</button></div></div>`;
  live.forEach(r=>{ h+=`<div class="callout"><div class="big">🏸 C'est à toi ! ${r.m.terrain?`Terrain ${r.m.terrain}`:""}</div><div>${esc(r.x.nom)} · ${esc(matchLabel(r.x,r.m))} — contre ${oppLabel(r.x,r.m,r.side)}</div></div>`; });
  if(!live.length&&todo.length){
    const r=todo[0], st=startOf(r);
    h+=`<div class="nextm"><div class="est-lbl">Ton prochain match</div>
      <div class="nm-when">${st?(st<=Date.now()+60000?"Dès qu'un terrain se libère":`vers ${hm(new Date(st))}`):"Horaire à venir"}</div>
      <div>${esc(r.x.nom)} · ${esc(matchLabel(r.x,r.m))} — contre <b>${oppLabel(r.x,r.m,r.side)}</b></div>
      <div class="small muted" style="margin-top:4px">Heure estimée, elle s'ajuste en direct. Reste près des terrains un peu avant.</div></div>`;
  }
  if(!live.length&&!todo.length) h+=`<div class="nextm"><div class="est-lbl">Ton prochain match</div><div>Pas de match prévu pour l'instant${teams.some(tm=>tm.x.phase==="inscriptions")?" : les poules ne sont pas encore faites":""}.</div></div>`;
  if("Notification" in window&&Notification.permission!=="granted") h+=`<button class="btn sm" data-act="notif" style="margin:10px 0">🔔 Me prévenir quand mon match est lancé</button>`;
  else if("Notification" in window) h+=`<div class="small muted" style="margin:10px 0">🔔 Alerte activée : garde cette page ouverte.</div>`;
  teams.forEach(({x,eid,e})=>{
    const pi=(x.poules||[]).findIndex(p=>p.entrees.includes(eid));
    h+=`<div class="card" style="margin-top:14px"><div class="row" style="justify-content:space-between"><h3 style="font-size:22px">${esc(x.nom)}</h3><span class="disc">${esc(x.discipline)}</span></div>
      <div class="muted small" style="margin-bottom:8px">${esc(e.j1)}${e.j2?` / ${esc(e.j2)}`:""}${e.club?` · ${esc(e.club)}`:""}</div>`;
    if(pi>=0){
      const st=standings(x,pi), Q=x.qualif||2, done=pouleIsDone(x.matchs||{},pi), rank=st.findIndex(s=>s.id===eid);
      h+=`<div class="phase" style="margin:6px 0">Poule ${esc(x.poules[pi].nom)} ${done?`· terminée — tu finis ${rank+1}${rank===0?"er":"e"} → ${rank<Q?"tableau principal":"consolante"}`:""}</div>
        <table class="st"><tbody>${st.map((s,i)=>`<tr class="${s.id===eid?"me":""} ${i<Q?"qual":""}"><td class="rk">${i+1}</td><td>${esc(nm(x,s.id))}</td><td>${s.V} V</td><td>${sgn(s.sw-s.sl)} sets</td></tr>`).join("")}</tbody></table>`;
    }
    const tm=teamMatches(x,eid);
    if(tm.length) h+=`<div class="mlist">${tm.map(r=>{ const side=r.m.a===eid?"a":"b", fin=r.m.statut==="termine", won=fin&&r.m.vainqueur===side, liv=r.m.statut==="en_cours";
      return `<div class="m ${liv?"live":""}"><div class="who">${fin?(won?`<b class="win-t">Victoire</b>`:`<b class="loss-t">Défaite</b>`):""} contre ${oppLabel(x,r.m,side)}<div class="small muted">${esc(matchLabel(x,r.m))}${liv&&r.m.terrain?` · <span class="livetag">Terrain ${r.m.terrain}</span>`:""}</div></div>
        <div class="sc">${fin?esc(scoreText(r.m,side==="b")):eta(x.id,r.id,r.m)}</div></div>`; }).join("")}</div>`;
    else if(x.phase!=="inscriptions") h+=`<div class="small muted">Aucun match pour l'instant.</div>`;
    h+=`</div>`;
  });
  return h;
}
/* alerte quand un match du joueur passe « en cours » */
function checkAlerts(initial){
  if(S.route.v!=="joueur"||!S.route.name) return;
  myMatches(S.route.name).filter(r=>r.m.statut==="en_cours").forEach(r=>{
    const k=`${r.x.id}/${r.id}`; if(S.alerted[k]) return; S.alerted[k]=1; if(initial) return;
    try{ navigator.vibrate&&navigator.vibrate([300,150,300,150,500]); }catch(e){}
    try{ if("Notification" in window&&Notification.permission==="granted") new Notification("🏸 C'est à toi !",{body:`${r.x.nom} — ${r.m.terrain?`terrain ${r.m.terrain}`:"ton match est lancé"}`}); }catch(e){}
  });
}

/* ---- accueil ---- */
function viewHome(){
  const o=isOrga();
  let h=`${S.slow?`<div class="notice">Affichage possiblement pas à jour (connexion lente).</div><br>`:""}`;
  h+=`<div class="sec-title"><h2>Tournois</h2></div>`;
  if(!S.tournois.length) h+=`<div class="card empty">${o?"Aucun tournoi pour l'instant. Crée le premier ci-dessous.":"Aucun tournoi publié pour l'instant."}</div>`;
  else h+=`<div class="grid g-cards">${S.tournois.map(t=>`
    <div class="card tcard" data-act="open" data-t="${esc(t.id)}">
      <div class="phase">${t.date?esc(fmtDate(t.date)):"Date à venir"}</div>
      <h3>${esc(t.nom)}</h3>
      <div class="muted small">${t.lieu?esc(t.lieu)+" · ":""}${t.terrains||0} terrain${(t.terrains||0)>1?"s":""}</div>
    </div>`).join("")}</div>`;
  if(o) h+=`<div class="sec-title"><h2>Nouveau tournoi</h2></div>
    <form class="card" data-form="newT">
      <div class="row" style="align-items:flex-end">
        <label class="f" style="flex:2;min-width:200px">Nom du tournoi<input type="text" id="nt-nom" required placeholder="Tournoi interne de Noël"></label>
        <label class="f" style="flex:1;min-width:140px">Date<input type="date" id="nt-date"></label>
        <label class="f" style="flex:1.4;min-width:160px">Lieu<input type="text" id="nt-lieu" placeholder="Gymnase…"></label>
        <label class="f" style="width:110px">Terrains<input type="number" id="nt-ter" min="1" max="30" value="7"></label>
        <label class="f" style="width:110px">Début<input type="time" id="nt-h" value="09:00"></label>
        <label class="f" style="width:130px">Durée d'un match<select id="nt-dur">${[15,20,25,30,35,40,45].map(m=>`<option value="${m}" ${m===30?"selected":""}>${m} min</option>`).join("")}</select></label>
        <button class="btn pri" type="submit">Créer</button>
      </div>
    </form>`;
  return h;
}
function fmtDate(d){ try{ return new Date(d+"T12:00:00").toLocaleDateString("fr-FR",{weekday:"long",day:"numeric",month:"long",year:"numeric"}); }catch(e){ return d; } }

/* ---- tournoi ---- */
function curTournoi(){ return S.tournois.find(t=>t.id===S.route.t); }
function viewTournoi(){
  const t=curTournoi();
  if(!t) return `<div class="card empty">Ce tournoi n'existe pas (ou plus). <a href="#/" data-act="home">Retour aux tournois</a></div>`;
  const o=isOrga();
  const live=allMatches().some(x=>x.m.statut==="en_cours");
  const tab=S.route.tab||"direct";
  let h=`<div class="row" style="justify-content:space-between">
    <div><a href="#/" data-act="home" class="small">← Tous les tournois</a>
      <h2 style="font-size:30px;margin-top:4px">${esc(t.nom)}</h2>
      <div class="muted">${t.date?esc(fmtDate(t.date)):""}${t.lieu?" · "+esc(t.lieu):""}</div></div>
    <div class="row">${o?`<a class="btn" href="#/t/${encodeURIComponent(t.id)}/qr">QR codes</a><button class="btn" data-act="editT">Paramètres du tournoi</button>`:`<a class="btn pri" href="#/j/${encodeURIComponent(t.id)}">Mon espace joueur</a>`}</div>
  </div>`;
  if(S.tabLoaded&&S.tableaux.length) h+=viewEstimate(t);
  if(S.tabSlow) h+=`<br><div class="notice">Les données mettent du temps à arriver, l'affichage peut être incomplet.</div>`;
  h+=`<div class="tabs">
    <button class="tab ${tab==="direct"?"on":""}" data-act="tab" data-tab="direct">${live?`<span class="dot"></span>`:""}Direct</button>
    ${S.tableaux.map(x=>`<button class="tab ${tab===x.id?"on":""}" data-act="tab" data-tab="${esc(x.id)}">${esc(x.nom)}</button>`).join("")}
    ${o?`<button class="tab" data-act="newTab">+ Tableau</button>`:""}
  </div>`;
  if(!S.tabLoaded) return h+`<div class="card empty">Chargement…</div>`;
  if(tab==="direct") return h+viewDirect(t);
  const x=S.tableaux.find(x=>x.id===tab);
  if(!x) return h+`<div class="card empty">Tableau introuvable.</div>`;
  return h+viewTableau(t,x);
}

function allMatches(){
  const out=[];
  S.tableaux.forEach(x=>Object.entries(x.matchs||{}).forEach(([id,m])=>{ if(!m.bye&&(x.phase==="poules"||x.phase==="finale"||x.phase==="termine")) out.push({x,id,m}); }));
  return out;
}
function nm(x,id){ const e=(x.entrees||{})[id]; if(!e) return null; return e.j2?`${e.j1} / ${e.j2}`:e.j1; }
function clubOf(x,id){ const e=(x.entrees||{})[id]; return e&&e.club?e.club:""; }
const brR=(x,m)=>(finInfo(x)[m.br||"f"]||{}).R||1;
function matchLabel(x,m){ return m.type==="poule"?`Poule ${x.poules[m.poule]?.nom||""}`:roundName(m.round,brR(x,m),false)+((m.br||"f")==="c"?" · consolante":""); }

function hm(d){ return d.toLocaleTimeString("fr-FR",{hour:"2-digit",minute:"2-digit"}).replace(":","h"); }
function startDate(t){ if(!t.heure) return null; const day=t.date||new Date().toISOString().slice(0,10); const d=new Date(`${day}T${t.heure}:00`); return isNaN(d)?null:d; }
function measuredAvg(){
  const ds=[]; S.tableaux.forEach(x=>Object.values(x.matchs||{}).forEach(m=>{ if(m.statut==="termine"&&m.startedAt&&m.doneAt&&!m.wo){ const min=(m.doneAt-m.startedAt)/60000; if(min>=3&&min<=120) ds.push(min); } }));
  return ds.length>=3?{avg:Math.round(ds.reduce((a,b)=>a+b,0)/ds.length),n:ds.length}:null;
}
function planBase(t){
  const now=new Date(), st=startDate(t);
  const started=S.tableaux.some(x=>Object.values(x.matchs||{}).some(m=>!m.bye&&m.statut!=="a_jouer"));
  return (!started&&st&&st>now)?st:now;
}
function computePlan(){
  S.plan=null; const t=S.route.t&&curTournoi(); if(!t||!S.tabLoaded||!(t.terrains>0)) return;
  try{ const base=planBase(t); S.plan={base,...schedule(S.tableaux,t.terrains,t.duree||30,base.getTime())}; }catch(e){ S.plan=null; }
}
/* Heure de passage prévue d'un match à jouer */
function eta(xid,mid,m){
  if(!S.plan||!m||m.statut!=="a_jouer"||m.bye) return "";
  const st=S.plan.starts[`${xid}/${mid}`]; if(st===undefined) return "";
  if(st<=Date.now()+60000) return `<span class="eta now">maintenant</span>`;
  const d=new Date(st), sameDay=d.toDateString()===new Date(S.plan.base).toDateString();
  return `<span class="eta">vers ${sameDay?"":d.toLocaleDateString("fr-FR",{weekday:"short"})+" "}${hm(d)}</span>`;
}
function viewEstimate(t){
  const o=isOrga(), dur=t.duree||30, ter=t.terrains||0;
  if(!ter) return o?`<div class="notice" style="margin-top:12px">Indique le nombre de terrains dans les paramètres pour avoir l'heure de fin estimée.</div>`:"";
  const e=estimateTournoi(S.tableaux,ter);
  if(e.restants<=0) return `<div class="est"><b>Tournoi terminé</b></div>`;
  const now=new Date(), st=startDate(t);
  const started=S.tableaux.some(x=>Object.values(x.matchs||{}).some(m=>!m.bye&&m.statut!=="a_jouer"));
  const base=(!started&&st&&st>now)?st:now;
  let endMs=base.getTime()+e.tours*dur*60000;
  if(S.plan){ const insc=S.tableaux.filter(x=>x.phase==="inscriptions"||!(x.poules||[]).length); const ei=estimateTournoi(insc,ter); endMs=S.plan.end+Math.ceil(ei.restants/ter)*dur*60000; if(!S.tableaux.some(x=>x.phase!=="inscriptions")) endMs=base.getTime()+e.tours*dur*60000; }
  const end=new Date(endMs);
  const sameDay=end.toDateString()===base.toDateString();
  const lenMin=Math.max(0,Math.round((endMs-base.getTime())/60000)), len=`${Math.floor(lenMin/60)}h${String(lenMin%60).padStart(2,"0")}`;
  const meas=measuredAvg();
  const rest=Math.ceil(e.restants);
  return `<div class="est">
    <div class="est-main"><span class="est-lbl">Fin estimée</span><span class="est-time">${sameDay?"":end.toLocaleDateString("fr-FR",{weekday:"short",day:"numeric"})+" "}${hm(end)}</span></div>
    <div class="small muted">${base===st?`Début ${hm(st)} · `:""}encore ≈ ${len} de jeu · ${rest} match${rest>1?"s":""} restant${rest>1?"s":""} · ${ter} terrain${ter>1?"s":""} · ${dur} min par match</div>
    ${meas?`<div class="small" style="margin-top:4px">Durée réelle mesurée : <b>${meas.avg} min</b> sur ${meas.n} matchs${o&&meas.avg!==dur?` <button class="btn sm" data-act="useAvg" data-v="${meas.avg}">Utiliser ${meas.avg} min</button>`:""}</div>`:""}
    ${o?`<button class="btn ghost sm est-cfg" data-act="editT">Régler</button>`:""}
  </div>`;
}
function viewDirect(t){
  const o=isOrga(), q=S.search.trim().toLowerCase();
  const all=allMatches().filter(r=>r.m.a&&r.m.b);
  const match=r=>!q||((nm(r.x,r.m.a)||"")+" "+(nm(r.x,r.m.b)||"")+" "+clubOf(r.x,r.m.a)+" "+clubOf(r.x,r.m.b)).toLowerCase().includes(q);
  const enCours=all.filter(r=>r.m.statut==="en_cours");
  const aVenir=all.filter(r=>r.m.statut==="a_jouer").sort((p,q)=> (p.m.type===q.m.type?0:(p.m.type==="poule"?-1:1)) || (p.m.type==="poule"?(p.m.ordre-q.m.ordre)||(p.m.poule-q.m.poule):(p.m.round-q.m.round)) );
  const fini=all.filter(r=>r.m.statut==="termine").sort((p,q)=>(q.m.doneAt||0)-(p.m.doneAt||0));
  let h="";
  if(!S.tableaux.length) return `<div class="card empty">${o?"Commence par créer un tableau (simple, double ou mixte) avec le bouton « + Tableau ».":"Les tableaux n'ont pas encore été créés."}</div>`;
  const nT=t.terrains||0;
  if(nT){
    h+=`<div class="sec-title"><h2>Terrains</h2></div><div class="terrains">`;
    for(let i=1;i<=nT;i++){
      const r=enCours.find(r=>r.m.terrain===i);
      h+= r ? `<div class="ter busy ${o?"click":""}" ${o?`data-act="match" data-x="${esc(r.x.id)}" data-m="${esc(r.id)}" style="cursor:pointer"`:""}><b class="tn">Terrain ${i} <span class="livetag">● en cours</span></b>${esc(nm(r.x,r.m.a))}<br><span class="muted">contre</span> ${esc(nm(r.x,r.m.b))}<div class="small muted">${esc(r.x.nom)} · ${esc(matchLabel(r.x,r.m))}</div></div>`
            : `<div class="ter"><b class="tn">Terrain ${i}</b><span class="muted">Libre</span></div>`;
    }
    h+=`</div>`;
  }
  h+=`<div class="sec-title"><h2>Matchs</h2><input type="text" id="search" data-live="1" placeholder="Chercher un joueur ou un club…" value="${esc(S.search)}" style="min-width:240px"></div>`;
  const line=r=>{
    const live=r.m.statut==="en_cours", done=r.m.statut==="termine";
    const A=esc(nm(r.x,r.m.a)), B=esc(nm(r.x,r.m.b));
    const who= done ? (r.m.vainqueur==="a"?`<b>${A}</b> bat ${B}`:`<b>${B}</b> bat ${A}`) : `${A} <span class="muted">vs</span> ${B}`;
    return `<div class="m ${o?"click":""} ${live?"live":""}" ${o?`data-act="match" data-x="${esc(r.x.id)}" data-m="${esc(r.id)}"`:""}>
      <div class="who">${who}<div class="small muted"><span class="disc">${esc(r.x.discipline)}</span> ${esc(r.x.nom)} · ${esc(matchLabel(r.x,r.m))}${live&&r.m.terrain?` · <span class="livetag">Terrain ${r.m.terrain}</span>`:""}</div></div>
      <div class="sc">${done?esc(scoreText(r.m,r.m.vainqueur==="b")):eta(r.x.id,r.id,r.m)}</div></div>`;
  };
  const sec=(title,list,max)=>{ const l=list.filter(match); if(!l.length) return ""; return `<h3 style="font-size:18px;margin:14px 0 6px">${title} <span class="muted small">(${l.length})</span></h3><div class="mlist">${l.slice(0,max||l.length).map(line).join("")}</div>${max&&l.length>max?`<div class="small muted" style="margin-top:6px">… et ${l.length-max} autres${q?"":" (utilise la recherche pour filtrer)"}</div>`:""}`; };
  const body=sec("En cours",enCours)+sec("Phase finale : prêts à jouer",aVenir.filter(r=>r.m.type==="finale"))+sec("Poules : à jouer",aVenir.filter(r=>r.m.type==="poule"),q?0:15)+sec("Derniers résultats",fini,q?0:12);
  h+= body || `<div class="card empty">${q?"Aucun match trouvé pour cette recherche.":"Pas encore de match : les poules n'ont pas été générées."}</div>`;
  return h;
}

/* ---- tableau ---- */
function viewTableau(t,x){
  const o=isOrga();
  const phaseTxt={inscriptions:"Inscriptions",poules:"Phase de poules",finale:"Phase finale",termine:"Terminé"}[x.phase]||"";
  let h=`<div class="row" style="justify-content:space-between;margin-bottom:6px">
    <div class="row"><span class="disc">${esc(x.discipline)}</span><span class="muted">${esc(DISC[x.discipline]||"")}</span><span class="phase">· ${phaseTxt}</span>
    <span class="small muted">· ${x.sg===1?"1 set":"2 sets gagnants"} de ${x.pts||21} pts</span></div>
    ${o?`<div class="row"><button class="btn sm" data-act="renTab" data-x="${esc(x.id)}">Renommer</button><button class="btn sm dan" data-act="delTab" data-x="${esc(x.id)}">Supprimer</button></div>`:""}
  </div>`;
  if(x.phase==="inscriptions") return h+viewInscriptions(x);
  const FI=finInfo(x);
  const champs=[["f","Vainqueur du tableau principal"],["c","Vainqueur de la consolante"]].map(([br,lbl])=>{
    const inf=FI[br]; const fm=inf&&x.matchs&&x.matchs[`${br}${inf.R-1}m0`];
    if(!fm||fm.statut!=="termine"||!fm.vainqueur) return "";
    const w=fm[fm.vainqueur];
    return `<div class="champ" style="${br==="c"?"background:linear-gradient(120deg,#2a2a2a,#5a5a5a)":""};flex:1;min-width:260px;margin:0"><svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2"><path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 01-10 0V4zM17 5h3v2a3 3 0 01-3 3M7 5H4v2a3 3 0 003 3"/></svg><div><div class="small" style="opacity:.8">${lbl}</div><div class="big">${esc(nm(x,w))}</div>${clubOf(x,w)?`<div class="small" style="opacity:.8">${esc(clubOf(x,w))}</div>`:""}</div></div>`;
  }).join("");
  if(champs) h+=`<div class="row" style="margin-bottom:14px;align-items:stretch">${champs}</div>`;
  const sub=S.sub[x.id]||"poules";
  const pDone=(x.poules||[]).filter((_,pi)=>pouleIsDone(x.matchs||{},pi)).length, pTot=(x.poules||[]).length;
  const ready=Object.values(x.matchs||{}).filter(m=>m.type==="finale"&&!m.bye&&m.a&&m.b&&m.statut!=="termine").length;
  h+=`<div class="tabs" style="margin:6px 0 4px">
    <button class="tab ${sub==="poules"?"on":""}" data-act="sub" data-x="${esc(x.id)}" data-s="poules">Poules <span class="small" style="opacity:.75">${pDone}/${pTot}</span></button>
    <button class="tab ${sub==="finale"?"on":""}" data-act="sub" data-x="${esc(x.id)}" data-s="finale">Phase finale${ready?` <span class="tds">${ready} prêt${ready>1?"s":""}</span>`:""}</button>
    <button class="tab ${sub==="equipes"?"on":""}" data-act="sub" data-x="${esc(x.id)}" data-s="equipes">Équipes</button></div>`;
  if(sub==="finale") return h+viewFinaleTab(x);
  if(sub==="equipes") return h+viewTeams(x);
  /* poules */
  const editing=o&&S.editP[x.id];
  const unplaced=unplacedOf(x);
  const remaining=Object.values(x.matchs||{}).filter(m=>m.type==="poule"&&m.statut!=="termine").length;
  if(editing){
    const locked=finaleStarted(x);
    h+=`<div class="sec-title"><h2>Modifier les poules</h2><div class="row">
      <button class="btn sm" data-act="addPoule" data-x="${esc(x.id)}" ${locked?"disabled":""}>+ Poule</button>
      ${unplaced.length&&(x.poules||[]).length&&!locked?`<button class="btn sm" data-act="autoFill" data-x="${esc(x.id)}">Répartir les non placés</button>`:""}
      <button class="btn pri" data-act="editPoules" data-x="${esc(x.id)}">Terminer</button></div></div>`;
    h+= locked ? `<div class="notice" style="margin-bottom:10px">Des matchs de phase finale sont déjà lancés ou joués : la composition des poules ne peut plus changer (le tableau final en dépend). Tu peux toujours remplacer un joueur avec ✎. Pour recomposer quand même, réinitialise la phase finale dans son onglet.</div>`
      : `<div class="small muted" style="margin:-4px 0 10px">Déplace les équipes avec le menu de chacune, ou corrige un joueur avec ✎ (les scores sont conservés). Les matchs déjà joués entre deux équipes qui restent dans la même poule sont conservés. Le tableau final est recalculé automatiquement.</div>`;
    return h+viewPoulesEdit(x,unplaced,locked);
  }
  h+=`<div class="sec-title"><h2>Poules</h2>${o?`<div class="row">
      <button class="btn dan sm" data-act="resetPoules" data-x="${esc(x.id)}">Réinitialiser</button>
      <button class="btn sm" data-act="editPoules" data-x="${esc(x.id)}">Modifier les poules</button></div>`:""}</div>`;
  if(o&&unplaced.length) h+=`<div class="notice" style="margin-bottom:10px">${unplaced.length} équipe${unplaced.length>1?"s":""} pas encore placée${unplaced.length>1?"s":""} dans une poule (donc absente${unplaced.length>1?"s":""} de la phase finale). Clique sur « Modifier les poules » pour les placer.</div>`;
  const qq=x.qualif||2;
  h+=`<div class="small muted" style="margin:-4px 0 10px">Personne n'est éliminé : les ${qq} premier${qq>1?"s":""} de chaque poule (surlignés) vont dans le tableau principal, les autres dans la consolante. Dès qu'une poule est terminée, ses équipes sont placées dans la phase finale${remaining?` · encore ${remaining} match${remaining>1?"s":""} de poule`:""}.</div>`;
  return h+viewPoules(x);
}
function viewFinaleTab(x){
  const o=isOrga(), FI=finInfo(x);
  if(!FI.f) return `<div class="card empty">${o?`Le tableau final n'existe pas encore pour ce tableau.<br><br><button class="btn acc" data-act="rebuildFinale" data-x="${esc(x.id)}">Préparer la phase finale</button>`:"La phase finale n'est pas encore prête."}</div>`;
  let h=`<div class="small muted" style="margin:10px 0">Le tableau se remplit au fur et à mesure : dès qu'une poule est terminée, ses équipes prennent leur place. Un match peut être lancé dès que les deux équipes sont connues, sans attendre la fin des autres poules.</div>`;
  h+=`<div class="sec-title"><h2>Tableau principal</h2>${o?`<button class="btn sm dan" data-act="undoFinale" data-x="${esc(x.id)}">Réinitialiser la phase finale</button>`:""}</div>`;
  h+=viewBracket(x,"f");
  if(FI.c) h+=`<div class="sec-title"><h2>Consolante</h2></div>`+viewBracket(x,"c");
  return h;
}

function viewInscriptions(x){
  const o=isOrga(), ents=sortedEntries(x), dbl=isDouble(x.discipline), n=ents.length;
  const P=Math.max(1,Math.min(x.nbPoules||1,Math.floor(n/2)||1));
  let h="";
  if(o){
    const sizes=n?distribute(ents.map(e=>e.id),P).map(p=>p.length):[];
    const q=Math.min(x.qualif||2, Math.min(...(sizes.length?sizes:[0])));
    const nq=sizes.reduce((s,l)=>s+Math.min(l,x.qualif||2),0), nc=n-nq;
    h+=`<div class="card" style="margin-bottom:14px"><div class="row" style="align-items:flex-end">
      <label class="f">Format des matchs<select id="cfg-fmt-${x.id}" data-chg="cfg" data-x="${esc(x.id)}" data-k="fmt" data-live="1">
        ${[["21-2","2 sets gagnants de 21 pts (officiel)"],["21-1","1 set de 21 pts"],["15-2","2 sets gagnants de 15 pts"],["11-2","2 sets gagnants de 11 pts"]].map(([v,l])=>`<option value="${v}" ${`${x.pts||21}-${x.sg||2}`===v?"selected":""}>${l}</option>`).join("")}
      </select></label>
      <label class="f" style="width:130px">Nombre de poules<input type="number" min="1" max="26" id="cfg-np-${x.id}" data-live="1" data-chg="cfg" data-x="${esc(x.id)}" data-k="nbPoules" value="${x.nbPoules||1}"></label>
      <label class="f">Qualifiés par poule (principal)<select id="cfg-q-${x.id}" data-live="1" data-chg="cfg" data-x="${esc(x.id)}" data-k="qualif">${[1,2,3,4].map(v=>`<option ${v===(x.qualif||2)?"selected":""}>${v}</option>`).join("")}</select></label>
      <span class="sp" style="flex:1"></span>
      <button class="btn" data-act="manualPoules" data-x="${esc(x.id)}" ${n<2?"disabled":""}>Composer les poules à la main</button>
      <button class="btn acc" data-act="genPoules" data-x="${esc(x.id)}" ${n<2?"disabled":""}>Générer les poules</button>
    </div>
    <div class="small muted" style="margin-top:10px">${n<2?"Ajoute au moins 2 inscrits.":`${n} inscrit${n>1?"s":""} → ${P} poule${P>1?"s":""} de ${[...new Set(sizes)].sort().join(" ou ")} · tableau principal : ${nq} (tableau de ${nextPow2(nq)}${nextPow2(nq)>nq?`, ${nextPow2(nq)-nq} exempt${nextPow2(nq)-nq>1?"s":""} au 1er tour`:""}) · consolante : ${nc}${nc>=2?` (tableau de ${nextPow2(nc)}${nextPow2(nc)>nc?`, ${nextPow2(nc)-nc} exempt${nextPow2(nc)-nc>1?"s":""}`:""})`:""}.${nc===1?` <b style="color:var(--warn)">Attention : 1 seul joueur en consolante, il n'aurait pas d'adversaire. Change le nombre de qualifiés ou de poules.</b>`:""} Conseil : ${Math.max(1,Math.round(n/4))} poule${Math.round(n/4)>1?"s":""} pour des poules de 4.`}</div>
    <div class="small muted">Les premiers de la liste sont les têtes de série : ils sont répartis dans des poules différentes (serpentin).</div>
    </div>`;
  }
  h+=`<div class="grid" style="grid-template-columns:${o?"minmax(0,1.3fr) minmax(0,1fr)":"1fr"}">`;
  h+=`<div class="card"><div class="row" style="justify-content:space-between"><h3 style="font-size:20px">Inscrits (${n})</h3>${o&&n>1?`<button class="btn sm" data-act="shuffle" data-x="${esc(x.id)}">Mélanger l'ordre</button>`:""}</div>`;
  if(!n) h+=`<div class="empty">Personne n'est encore inscrit.</div>`;
  ents.forEach((e,i)=>{
    h+=`<div class="entry"><span class="n">${i+1}</span><div>${esc(e.j1)}${e.j2?` / ${esc(e.j2)}`:""}${o&&i<P&&P>1?`<span class="tds">TdS</span>`:""}${e.club?`<div class="club">${esc(e.club)}</div>`:""}</div>
      ${o?`<div class="row" style="gap:2px"><button class="btn ghost sm" title="Monter" data-act="mv" data-d="-1" data-x="${esc(x.id)}" data-e="${esc(e.id)}" ${i===0?"disabled":""}>▲</button><button class="btn ghost sm" title="Descendre" data-act="mv" data-d="1" data-x="${esc(x.id)}" data-e="${esc(e.id)}" ${i===n-1?"disabled":""}>▼</button><button class="btn ghost sm" title="Modifier" data-act="editE" data-x="${esc(x.id)}" data-e="${esc(e.id)}">✎</button><button class="btn ghost sm" style="color:var(--danger)" title="Retirer" data-act="delE" data-x="${esc(x.id)}" data-e="${esc(e.id)}">✕</button></div>`:"<span></span>"}</div>`;
  });
  h+=`</div>`;
  if(o){
    h+=`<div class="col" style="gap:14px"><form class="card col" data-form="addE" data-x="${esc(x.id)}">
      <h3 style="font-size:20px">Ajouter ${dbl?"une paire":"un joueur"}</h3>
      <input type="text" id="ae1-${x.id}" placeholder="${dbl?"Joueur 1":"Nom du joueur"}" required>
      ${dbl?`<input type="text" id="ae2-${x.id}" placeholder="Joueur 2" required>`:""}
      <input type="text" id="aec-${x.id}" placeholder="Club (optionnel)">
      <button class="btn pri" type="submit">Ajouter</button></form>
    <form class="card col" data-form="bulk" data-x="${esc(x.id)}">
      <h3 style="font-size:20px">Ajout en masse</h3>
      <div class="small muted">Une ${dbl?"paire":"entrée"} par ligne${dbl?", partenaires séparés par « / »":""}. Club entre parenthèses (optionnel).<br>Ex. : <code>${dbl?"Marie Le Gall / Paul Tanguy (BCB)":"Marie Le Gall (BCB)"}</code></div>
      <textarea id="bulk-${x.id}" placeholder="${dbl?"Marie Le Gall / Paul Tanguy (BCB)\nLéa Morvan / Yann Kerbrat":"Marie Le Gall (BCB)\nYann Kerbrat"}"></textarea>
      <button class="btn" type="submit">Ajouter la liste</button></form></div>`;
  }
  return h+`</div>`;
}

function unplacedOf(x){ const inP=new Set((x.poules||[]).flatMap(p=>p.entrees)); return sortedEntries(x).filter(e=>!inP.has(e.id)); }
function teamLabel(e){ return `${esc(e.j1)}${e.j2?` / ${esc(e.j2)}`:""}`; }
function playedIn(x,eid){ return Object.values(x.matchs||{}).filter(m=>m.type==="poule"&&m.statut!=="a_jouer"&&(m.a===eid||m.b===eid)).length; }
function moveSelect(x,eid,cur,locked){
  return `<select ${locked?"disabled":""} data-chg="moveE" data-live="1" data-x="${esc(x.id)}" data-e="${esc(eid)}" style="padding:4px 6px;font-size:13px" title="Déplacer">
    ${(x.poules||[]).map((p,pi)=>`<option value="${pi}" ${pi===cur?"selected":""}>Poule ${esc(p.nom)}</option>`).join("")}
    <option value="-1" ${cur===-1?"selected":""}>Non placée</option></select>`;
}
function viewPoulesEdit(x,unplaced,locked){
  const E=x.entrees||{};
  let h=`<div class="grid g-poules">`;
  (x.poules||[]).forEach((p,pi)=>{
    h+=`<div class="card"><div class="row" style="justify-content:space-between;margin-bottom:6px"><h3 style="font-size:21px">Poule ${esc(p.nom)} <span class="small muted">(${p.entrees.length})</span></h3>
      ${p.entrees.length||locked?"":`<button class="btn sm dan" data-act="delPoule" data-x="${esc(x.id)}" data-p="${pi}">Supprimer la poule</button>`}</div>`;
    if(!p.entrees.length) h+=`<div class="muted small" style="padding:10px 0">Poule vide : place des équipes ici avec leur menu.</div>`;
    p.entrees.forEach(id=>{ const e=E[id]; if(!e) return; const pl=playedIn(x,id);
      h+=`<div class="entry" style="grid-template-columns:1fr auto auto"><div>${teamLabel(e)}${e.club?`<div class="club">${esc(e.club)}</div>`:""}${pl?`<div class="club">${pl} match${pl>1?"s":""} joué${pl>1?"s":""}</div>`:""}</div>
        <button class="btn ghost sm" title="Modifier l'équipe" data-act="editE" data-x="${esc(x.id)}" data-e="${esc(id)}">✎</button>${moveSelect(x,id,pi,locked)}</div>`; });
    h+=`</div>`;
  });
  h+=`<div class="card" style="border-style:dashed"><h3 style="font-size:21px;margin-bottom:6px">Non placées <span class="small muted">(${unplaced.length})</span></h3>`;
  if(!unplaced.length) h+=`<div class="muted small" style="padding:6px 0">Toutes les équipes sont dans une poule.</div>`;
  unplaced.forEach(e=>{ h+=`<div class="entry" style="grid-template-columns:1fr auto auto auto"><div>${teamLabel(e)}${e.club?`<div class="club">${esc(e.club)}</div>`:""}</div>
    <button class="btn ghost sm" title="Modifier l'équipe" data-act="editE" data-x="${esc(x.id)}" data-e="${esc(e.id)}">✎</button>
    <button class="btn ghost sm" style="color:var(--danger)" title="Supprimer l'équipe" data-act="delE" data-x="${esc(x.id)}" data-e="${esc(e.id)}">✕</button>${moveSelect(x,e.id,-1,locked)}</div>`; });
  const dbl=isDouble(x.discipline);
  h+=`<form class="col" data-form="addE" data-x="${esc(x.id)}" style="margin-top:12px;gap:6px"><div class="small muted" style="font-weight:600">Ajouter une équipe</div>
    <input type="text" id="ae1-${x.id}" placeholder="${dbl?"Joueur 1":"Nom du joueur"}" required>${dbl?`<input type="text" id="ae2-${x.id}" placeholder="Joueur 2" required>`:""}
    <input type="text" id="aec-${x.id}" placeholder="Club (optionnel)"><button class="btn sm" type="submit">Ajouter aux non placées</button></form></div>`;
  return h+`</div>`;
}
function viewTeams(x){
  const o=isOrga(), ents=sortedEntries(x);
  const where={}; (x.poules||[]).forEach(p=>p.entrees.forEach(id=>where[id]=p.nom));
  return `<div class="card" style="margin-top:10px"><div class="row" style="justify-content:space-between"><h3 style="font-size:20px">Équipes (${ents.length})</h3></div>
    ${o?`<div class="small muted" style="margin:4px 0 6px">Un joueur ne peut plus jouer ? Remplace-le avec ✎ : l'équipe garde sa place, ses matchs et ses scores.</div>`:""}
    ${ents.map(e=>`<div class="entry" style="grid-template-columns:1fr auto auto"><div>${teamLabel(e)}${e.club?`<div class="club">${esc(e.club)}</div>`:""}</div><span class="small muted">${where[e.id]?`Poule ${esc(where[e.id])}`:"Non placée"}</span>${o?`<button class="btn ghost sm" data-act="editE" data-x="${esc(x.id)}" data-e="${esc(e.id)}">✎ Modifier</button>`:"<span></span>"}</div>`).join("")}</div>`;
}
function editEntry(xid,eid){
  const x=S.tableaux.find(t=>t.id===xid); const e=x&&(x.entrees||{})[eid]; if(!e) return; const dbl=isDouble(x.discipline);
  openModal(`<h3>Modifier ${dbl?"l'équipe":"le joueur"}</h3><div class="small muted">L'équipe garde sa place dans les poules et le tableau, avec tous ses scores.</div>
    <form data-form="editE" data-x="${esc(xid)}" data-e="${esc(eid)}" class="col" style="gap:10px;margin-top:12px">
    <label class="f">${dbl?"Joueur 1":"Nom"}<input type="text" id="ee1" value="${esc(e.j1)}" required></label>
    ${dbl?`<label class="f">Joueur 2<input type="text" id="ee2" value="${esc(e.j2||"")}" required></label>`:""}
    <label class="f">Club<input type="text" id="eec" value="${esc(e.club||"")}"></label>
    <div class="row" style="justify-content:flex-end"><button type="button" class="btn" data-act="close">Annuler</button><button class="btn pri">Enregistrer</button></div></form>`);
}
/* Applique la synchro du tableau final à des changements de matchs de poule (modifie upd) */
function pouleSync(x,upd){
  const merged=deepMerge(JSON.parse(JSON.stringify(x.matchs||{})),JSON.parse(JSON.stringify(upd)));
  const sy=syncFinale(x,merged); if(sy.err) return sy;
  Object.entries(sy.upd).forEach(([k,v])=>{ upd[k]={...(upd[k]||{}),...v}; });
  return {};
}
async function saveDoc(x,doc,msg){ const c=strip(doc); const ok=await W(tabPath(S.curT,x.id),"set",c); if(ok&&msg) toast(msg); return ok; }
async function savePoules(x,poules,msg){
  if(finaleStarted(x)){ toast("Des matchs de phase finale sont déjà lancés : réinitialise d'abord la phase finale."); render(); return; }
  poules=poules.map((p,i)=>({nom:POULE_NAMES[i],entrees:p.entrees}));
  const pm={}; Object.entries(rebuildMatches(x,poules)).forEach(([k,m])=>{ if(m.type==="poule") pm[k]=m; });
  await saveDoc(x,withFinale(x,poules,pm),msg);
}
function viewPoules(x){
  const o=isOrga(), Q=x.qualif||2, locked=false;
  return `<div class="grid g-poules">${(x.poules||[]).map((p,pi)=>{
    const st=standings(x,pi);
    const ms=Object.entries(x.matchs||{}).filter(([,m])=>m.type==="poule"&&m.poule===pi).sort((a,b)=>a[1].ordre-b[1].ordre);
    const done=ms.filter(([,m])=>m.statut==="termine").length;
    return `<div class="card"><div class="row" style="justify-content:space-between;margin-bottom:6px"><h3 style="font-size:21px">Poule ${esc(p.nom)}</h3>${done===ms.length?`<span class="pill" style="background:var(--q);color:var(--brand)">✓ Terminée</span>`:`<span class="small muted">${done}/${ms.length} matchs</span>`}</div>
      <table class="st"><thead><tr><th></th><th>${isDouble(x.discipline)?"Paire":"Joueur"}</th><th title="Victoires">V</th><th title="Défaites">D</th><th title="Différence de sets">Sets</th><th title="Différence de points">Pts</th></tr></thead><tbody>
      ${st.map((s,i)=>`<tr class="${i<Q?"qual":""}"><td class="rk">${i+1}</td><td>${esc(nm(x,s.id))}${clubOf(x,s.id)?`<div class="club">${esc(clubOf(x,s.id))}</div>`:""}</td><td>${s.V}</td><td>${s.D}</td><td>${sgn(s.sw-s.sl)}</td><td>${sgn(s.pw-s.pl)}</td></tr>`).join("")}
      </tbody></table>
      <div class="mlist">${ms.map(([id,m])=>{
        const live=m.statut==="en_cours", fin=m.statut==="termine";
        const A=esc(nm(x,m.a)),B=esc(nm(x,m.b));
        const clk=o&&!locked;
        return `<div class="m ${clk?"click":""} ${live?"live":""}" ${clk?`data-act="match" data-x="${esc(x.id)}" data-m="${esc(id)}"`:""}>
          <div class="who">${fin&&m.vainqueur==="a"?`<b>${A}</b>`:A} <span class="muted">–</span> ${fin&&m.vainqueur==="b"?`<b>${B}</b>`:B}${live?` <span class="livetag">● ${m.terrain?"T"+m.terrain:"en cours"}</span>`:""}</div>
          <div class="sc">${fin?esc(scoreText(m)):eta(x.id,id,m)}</div></div>`;
      }).join("")}</div></div>`;
  }).join("")}</div>`;
}
const sgn=v=>v>0?`+${v}`:`${v}`;

function viewBracket(x,br){
  const o=isOrga(), inf=finInfo(x)[br]; if(!inf) return ""; const R=inf.R;
  let h=`<div class="bracket">`;
  for(let r=0;r<R;r++){
    const cnt=inf.size/2**(r+1);
    h+=`<div class="round"><h4>${roundName(r,R,true)}</h4><div class="slots">`;
    for(let i=0;i<cnt;i++){
      const id=`${br}${r}m${i}`, m=x.matchs[id]; if(!m) continue;
      const fin=m.statut==="termine", live=m.statut==="en_cours";
      const clk=o&&m.a&&m.b&&!m.bye;
      const side=(s)=>{ const e=m[s]; const w=fin&&m.vainqueur===s;
        let ph="à venir";
        if(r===0){ const sl=m["s"+s]; ph= sl?slotLabel(sl,x.poules||[]) : (m.bye?"exempt":"à venir"); }
        else { const fd=x.matchs[`${br}${r-1}m${2*i+(s==="a"?0:1)}`]; if(fd&&fd.bye&&(fd.sa||fd.sb)) ph=slotLabel(fd.sa||fd.sb,x.poules||[]); }
        const label= e?esc(nm(x,e)) : `<span class="tbd">${esc(ph)}</span>`;
        const sc= fin&&!m.bye ? (m.wo?(w?"WO":""):(m.scores||[]).map(p=>s==="a"?p[0]:p[1]).join(" ")) : "";
        return `<div class="ln ${w&&!m.bye?"win":""}"><span class="nm" title="${e?esc(nm(x,e)):""}">${label}</span><span class="s">${sc}</span></div>`; };
      h+=`<div class="bm ${clk?"click":""} ${live?"live":""}" ${clk?`data-act="match" data-x="${esc(x.id)}" data-m="${id}"`:""}>${side("a")}${side("b")}${live?`<div class="meta"><span class="livetag">● ${m.terrain?"Terrain "+m.terrain:"en cours"}</span></div>`:(eta(x.id,id,m)?`<div class="meta">${eta(x.id,id,m)}</div>`:"")}</div>`;
    }
    h+=`</div></div>`;
  }
  return h+`</div>`;
}

/* ---- modale ---- */
const $modal=document.getElementById("modal"), $dlg=document.getElementById("dlg");
let modalCtx=null;
function openModal(html,ctx){ modalCtx=ctx||null; $dlg.innerHTML=html; $modal.classList.add("on"); const f=$dlg.querySelector("input,select,textarea"); if(f) setTimeout(()=>f.focus(),30); }
function closeModal(){ $modal.classList.remove("on"); $dlg.innerHTML=""; modalCtx=null; }
function refreshModal(){ /* si le match ouvert a été modifié par quelqu'un d'autre, on garde la saisie : rien à faire */ }
$modal.addEventListener("mousedown",e=>{ if(e.target===$modal) closeModal(); });
document.addEventListener("keydown",e=>{ if(e.key==="Escape"&&$modal.classList.contains("on")) closeModal(); });

function confirmDlg(title,text,okLabel,fn,danger=true){
  openModal(`<h3>${esc(title)}</h3><p class="muted">${text}</p><div class="row" style="justify-content:flex-end"><button class="btn" data-act="close">Annuler</button><button class="btn ${danger?"dan":"pri"}" data-act="ok">${esc(okLabel)}</button></div>`,{ok:fn});
}

function openMatch(xid,mid){
  const x=S.tableaux.find(t=>t.id===xid); if(!x) return; const m=x.matchs[mid]; if(!m) return;
  const t=curTournoi(); const sg=x.sg||2, rows=sg*2-1;
  const A=nm(x,m.a), B=nm(x,m.b);
  const busy=new Set(allMatches().filter(r=>r.m.statut==="en_cours"&&!(r.x.id===xid&&r.id===mid)).map(r=>r.m.terrain));
  let setsH=`<div class="setgrid"><span></span><span class="hd" title="${esc(A)}">${esc(A)}</span><span class="hd" title="${esc(B)}">${esc(B)}</span>`;
  for(let i=0;i<rows;i++){ const s=(m.scores||[])[i]||["",""]; setsH+=`<span class="small muted" style="font-weight:600">Set ${i+1}</span><input type="number" inputmode="numeric" min="0" max="30" id="s${i}a" value="${s[0]}"><input type="number" inputmode="numeric" min="0" max="30" id="s${i}b" value="${s[1]}">`; }
  setsH+=`</div>`;
  const nT=t?.terrains||0;
  openModal(`<div class="phase">${esc(x.nom)} · ${esc(matchLabel(x,m))}</div>
    <h3>${esc(A)} <span class="muted">vs</span> ${esc(B)}</h3>
    ${m.statut!=="termine"&&nT?`<div class="row" style="margin:12px 0;padding:10px;background:#f7f9f7;border-radius:10px">
      <label class="f" style="flex-direction:row;align-items:center;gap:8px">Terrain<select id="mter">${Array.from({length:nT},(_,i)=>i+1).map(i=>`<option value="${i}" ${m.terrain===i?"selected":""} ${busy.has(i)?"disabled":""}>${i}${busy.has(i)?" (occupé)":""}</option>`).join("")}</select></label>
      ${m.statut==="en_cours"?`<span class="livetag">● en cours</span><button class="btn sm" data-act="mPause">Remettre en attente</button><button class="btn sm" data-act="mLaunch">Changer de terrain</button>`:`<button class="btn sm pri" data-act="mLaunch">Lancer sur ce terrain</button>`}
    </div>`:""}
    ${setsH}
    <label class="f" style="flex-direction:row;align-items:center;gap:8px;color:var(--ink)"><input type="checkbox" id="mwo" ${m.wo?"checked":""}> Forfait ou abandon</label>
    <div id="mwoBox" style="display:${m.wo?"flex":"none"};gap:8px;margin-top:8px" class="row"><span class="small muted">Vainqueur :</span>
      <label class="small"><input type="radio" name="mwow" value="a" ${m.wo&&m.vainqueur==="a"?"checked":""}> ${esc(A)}</label>
      <label class="small"><input type="radio" name="mwow" value="b" ${m.wo&&m.vainqueur==="b"?"checked":""}> ${esc(B)}</label></div>
    <div class="err-txt" id="merr"></div>
    <div class="row" style="justify-content:space-between;margin-top:6px">
      ${m.statut==="termine"?`<button class="btn dan sm" data-act="mClear">Effacer le résultat</button>`:"<span></span>"}
      <div class="row"><button class="btn" data-act="close">Fermer</button><button class="btn pri" data-act="mSave">Enregistrer le score</button></div>
    </div>`,{xid,mid});
  document.getElementById("mwo").addEventListener("change",e=>{ document.getElementById("mwoBox").style.display=e.target.checked?"flex":"none"; });
}
function readSets(rows){
  const out=[]; for(let i=0;i<rows;i++){ const a=document.getElementById(`s${i}a`).value.trim(), b=document.getElementById(`s${i}b`).value.trim();
    if(a===""&&b==="") continue; if(a===""||b==="") return {err:`Set ${i+1} : il manque un score`}; out.push([parseInt(a,10),parseInt(b,10)]); }
  return {sets:out};
}
async function saveMatch(){
  const {xid,mid}=modalCtx; const x=S.tableaux.find(t=>t.id===xid); const m=x&&x.matchs[mid]; if(!m) return closeModal();
  const err=document.getElementById("merr"); const sg=x.sg||2, pts=x.pts||21;
  const r=readSets(sg*2-1); if(r.err){ err.textContent=r.err; return; }
  const wo=document.getElementById("mwo").checked; let winner;
  if(wo){ const w=$dlg.querySelector('input[name="mwow"]:checked'); if(!w){ err.textContent="Choisis le vainqueur par forfait / abandon"; return; } winner=w.value;
    for(const [a,b] of r.sets){ if(!Number.isInteger(a)||!Number.isInteger(b)||a<0||b<0){ err.textContent="Scores invalides"; return; } } }
  else { const v=validateMatch(r.sets,pts,sg); if(v.err){ err.textContent=v.err; return; } winner=v.winner; }
  const upd={[mid]:{scores:r.sets,vainqueur:winner,wo,statut:"termine",doneAt:Date.now()}};
  if(m.type==="finale"){
    const nx=nextOf(m,brR(x,m));
    if(nx){ const nm_=x.matchs[nx.id], wid=m[winner];
      if(nm_[nx.slot]&&nm_[nx.slot]!==wid&&nm_.statut!=="a_jouer"){ err.textContent="Le match suivant a déjà commencé avec l'ancien vainqueur : efface d'abord son résultat."; return; }
      upd[nx.id]={[nx.slot]:wid}; }
  }
  if(m.type==="poule"){ const sy=pouleSync(x,upd); if(sy.err){ err.textContent=sy.err; return; } }
  const data={matchs:upd};
  closeModal();
  const placed=m.type==="poule"&&Object.keys(upd).some(k=>k[0]!=="p");
  if(await W(tabPath(S.curT,xid),"update",data)) toast(placed?`Score enregistré · poule ${x.poules[m.poule].nom} terminée, équipes placées en phase finale`:"Score enregistré");
}
async function clearMatch(){
  const {xid,mid}=modalCtx; const x=S.tableaux.find(t=>t.id===xid); const m=x&&x.matchs[mid]; if(!m) return closeModal();
  const upd={[mid]:{scores:[],vainqueur:null,wo:false,statut:"a_jouer",terrain:null,doneAt:null}};
  if(m.type==="finale"){ const nx=nextOf(m,brR(x,m));
    if(nx){ const n2=x.matchs[nx.id]; if(n2.statut!=="a_jouer"){ document.getElementById("merr").textContent="Le match suivant est déjà lancé ou joué : efface-le d'abord."; return; } upd[nx.id]={[nx.slot]:null}; } }
  if(m.type==="poule"){ const sy=pouleSync(x,upd); if(sy.err){ document.getElementById("merr").textContent=sy.err; return; } }
  const data={matchs:upd};
  closeModal(); if(await W(tabPath(S.curT,xid),"update",data)) toast("Résultat effacé");
}
async function launchMatch(pause){
  const {xid,mid}=modalCtx; const ter=document.getElementById("mter");
  const data= pause ? {statut:"a_jouer",terrain:null,startedAt:null} : {statut:"en_cours",terrain:parseInt(ter.value,10),startedAt:(()=>{ const x=S.tableaux.find(t=>t.id===xid); const m=x&&x.matchs[mid]; return m&&m.statut==="en_cours"&&m.startedAt?m.startedAt:Date.now(); })()};
  closeModal(); if(await W(tabPath(S.curT,xid),"update",{matchs:{[mid]:data}})) toast(pause?"Match remis en attente":`Match lancé sur le terrain ${data.terrain}`);
}

/* ---- actions ---- */
document.addEventListener("click",async e=>{
  const el=e.target.closest("[data-act]"); if(!el) return;
  const a=el.dataset.act, d=el.dataset;
  if(el.tagName==="A") e.preventDefault();
  switch(a){
    case "home": go(null); break;
    case "reload": await reload(); break;
    case "logout": await S.sb.auth.signOut(); S.orga=false; S.preview=false; toast("Déconnecté"); goHash("#/"); break;
    case "pickJ": LS.set("bcp-joueur-"+S.curT,d.n); S.psearch=""; goHash(`#/j/${encodeURIComponent(S.curT)}/${encodeURIComponent(d.n)}`); break;
    case "changeJ": LS.del("bcp-joueur-"+S.curT); S.choosing=true; goHash(`#/j/${encodeURIComponent(S.curT)}`); break;
    case "notif": try{ const p=await Notification.requestPermission(); toast(p==="granted"?"Alerte activée : garde la page ouverte":"Notifications refusées par le navigateur"); }catch(e){ toast("Notifications non disponibles sur ce navigateur"); } render(); break;
    case "print": window.print(); break;
    case "qrAll": S.qrAll=el.checked; render(); break;
    case "open": go(d.t); break;
    case "tab": go(S.curT, d.tab==="direct"?null:d.tab); break;
    case "preview": S.preview=!S.preview; render(); break;
    case "close": closeModal(); break;
    case "ok": { const fn=modalCtx&&modalCtx.ok; closeModal(); if(fn) await fn(); break; }
    case "match": if(isOrga()) openMatch(d.x,d.m); break;
    case "mSave": await saveMatch(); break;
    case "mClear": await clearMatch(); break;
    case "mLaunch": await launchMatch(false); break;
    case "mPause": await launchMatch(true); break;
    case "editT": editTournoi(); break;
    case "useAvg": { const t=curTournoi(); if(await W(tPath(t.id),"update",{duree:parseInt(d.v,10)})) toast(`Durée moyenne réglée sur ${d.v} min`); break; }
    case "newTab": newTableau(); break;
    case "renTab": renTableau(d.x); break;
    case "delTab": { const x=S.tableaux.find(t=>t.id===d.x); confirmDlg("Supprimer ce tableau ?",`« ${esc(x.nom)} » et tous ses matchs seront supprimés définitivement.`,"Supprimer",async()=>{ go(S.curT); await W(tabPath(S.curT,d.x),"delete"); }); break; }
    case "mv": await moveEntry(d.x,d.e,parseInt(d.d,10)); break;
    case "delE": { const x=S.tableaux.find(t=>t.id===d.x); const c=strip(x); delete c.entrees[d.e]; await W(tabPath(S.curT,d.x),"set",c); break; }
    case "shuffle": { const x=S.tableaux.find(t=>t.id===d.x); const ids=sortedEntries(x).map(e=>e.id); for(let i=ids.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[ids[i],ids[j]]=[ids[j],ids[i]];} const ent={}; ids.forEach((id,i)=>ent[id]={ordre:i+1}); await W(tabPath(S.curT,d.x),"update",{entrees:ent}); break; }
    case "editE": editEntry(d.x,d.e); break;
    case "editPoules": S.editP[d.x]=!S.editP[d.x]; render(); break;
    case "manualPoules": { const x=S.tableaux.find(t=>t.id===d.x); const P=Math.max(1,x.nbPoules||1); S.editP[d.x]=true;
      await savePoules(x,Array.from({length:P},()=>({entrees:[]})),"Poules vides créées : place les équipes"); break; }
    case "addPoule": { const x=S.tableaux.find(t=>t.id===d.x); if((x.poules||[]).length>=26) return; await savePoules(x,[...(x.poules||[]),{entrees:[]}]); break; }
    case "delPoule": { const x=S.tableaux.find(t=>t.id===d.x); const pi=+d.p; if(x.poules[pi].entrees.length) return; await savePoules(x,x.poules.filter((_,i)=>i!==pi)); break; }
    case "autoFill": { const x=S.tableaux.find(t=>t.id===d.x); const ps=x.poules.map(p=>({entrees:p.entrees.slice()}));
      unplacedOf(x).forEach(e=>{ let best=0; ps.forEach((p,i)=>{ if(p.entrees.length<ps[best].entrees.length) best=i; }); ps[best].entrees.push(e.id); });
      await savePoules(x,ps,"Équipes réparties"); break; }
    case "sub": S.sub[d.x]=d.s; render(); break;
    case "rebuildFinale": { const x=S.tableaux.find(t=>t.id===d.x); const pm={}; Object.entries(x.matchs||{}).forEach(([k,m])=>{ if(m.type==="poule") pm[k]=m; }); await saveDoc(x,withFinale(x,x.poules||[],pm),"Phase finale préparée"); break; }
    case "genPoules": { const x=S.tableaux.find(t=>t.id===d.x); const {poules,matchs}=buildPoules(x); if(await saveDoc(x,withFinale(x,poules,matchs))) toast(`${poules.length} poule${poules.length>1?"s":""} générée${poules.length>1?"s":""}`); break; }
    case "resetPoules": confirmDlg("Réinitialiser les poules ?","Tous les scores de poule seront effacés et le tableau revient aux inscriptions (les inscrits sont conservés).","Réinitialiser",async()=>{ const x=S.tableaux.find(t=>t.id===d.x); const c=strip(x); c.poules=[]; c.matchs={}; c.phase="inscriptions"; c.finale=null; await W(tabPath(S.curT,d.x),"set",c); }); break;
    case "genFinale": { const x=S.tableaux.find(t=>t.id===d.x); if(!pouleDone(x)) return;
      let seeds=qualifiers(x), cons=consolants(x);
      if(cons.length===1){ seeds=seeds.concat(cons); cons=[]; } /* personne n'est éliminé */
      if(seeds.length<2){ toast("Il faut au moins 2 qualifiés."); return; }
      const P=buildFinale(seeds,"f"), C=cons.length>=2?buildFinale(cons,"c"):null;
      const c=strip(x); Object.keys(c.matchs).forEach(k=>{ if(c.matchs[k].type==="finale") delete c.matchs[k]; });
      Object.assign(c.matchs,P.matchs,C?C.matchs:{}); c.finale={f:P.finale,...(C?{c:C.finale}:{})}; c.phase="finale";
      if(await W(tabPath(S.curT,d.x),"set",c)) toast(C?"Tableau principal et consolante générés":"Phase finale générée"); break; }
    case "undoFinale": confirmDlg("Réinitialiser la phase finale ?","Tous les scores du tableau principal et de la consolante seront effacés. Les résultats des poules sont conservés et les équipes des poules terminées sont replacées automatiquement.","Réinitialiser",async()=>{ const x=S.tableaux.find(t=>t.id===d.x); const pm={}; Object.entries(x.matchs||{}).forEach(([k,m])=>{ if(m.type==="poule") pm[k]=m; }); await saveDoc(x,withFinale(x,x.poules||[],pm),"Phase finale réinitialisée"); }); break;
    case "delT": { const t=curTournoi(); confirmDlg("Supprimer le tournoi ?",`« ${esc(t.nom)} », ses tableaux et tous les résultats seront supprimés définitivement.`,"Supprimer le tournoi",async()=>{ const ids=S.tableaux.map(x=>x.id), tid=t.id; go(null); for(const id of ids) await W(tabPath(tid,id),"delete"); await W(tPath(tid),"delete"); toast("Tournoi supprimé"); }); break; }
  }
});
document.addEventListener("toggle",e=>{ const k=e.target&&e.target.dataset&&e.target.dataset.key; if(k) S.open[k]=e.target.open; },true);
document.addEventListener("input",e=>{ if(e.target.id==="search"){ S.search=e.target.value; render(); } if(e.target.id==="psearch"){ S.psearch=e.target.value; render(); } });
document.addEventListener("change",async e=>{
  const el=e.target;
  if(el.dataset.chg==="moveE"){
    const x=S.tableaux.find(t=>t.id===el.dataset.x); if(!x) return; const eid=el.dataset.e, to=parseInt(el.value,10);
    const ps=x.poules.map(p=>({entrees:p.entrees.filter(id=>id!==eid)})); if(to>=0) ps[to].entrees.push(eid);
    const pl=playedIn(x,eid), from=x.poules.findIndex(p=>p.entrees.includes(eid));
    if(pl&&from!==to){ const e_=x.entrees[eid]; confirmDlg("Déplacer cette équipe ?",`${teamLabel(e_)} a déjà ${pl} match${pl>1?"s":""} saisi${pl>1?"s":""} dans sa poule : ${pl>1?"ils seront supprimés":"il sera supprimé"}.`,"Déplacer",()=>savePoules(x,ps)); render(); }
    else await savePoules(x,ps);
    return;
  }
  if(el.dataset.chg!=="cfg") return;
  const x=S.tableaux.find(t=>t.id===el.dataset.x); if(!x) return; const k=el.dataset.k; let data={};
  if(k==="fmt"){ const [p,s]=el.value.split("-").map(Number); data={pts:p,sg:s}; }
  else { const v=parseInt(el.value,10); if(!v||v<1) return; data={[k]:v}; }
  await W(tabPath(S.curT,x.id),"update",data);
});
document.addEventListener("submit",async e=>{
  const f=e.target.closest("form[data-form]"); if(!f) return; e.preventDefault();
  const kind=f.dataset.form, v=id=>{ const el=document.getElementById(id); return el?el.value.trim():""; };
  if(kind==="login"){
    const err=document.getElementById("lg-err"); err.textContent="";
    const {error}=await S.sb.auth.signInWithPassword({email:v("lg-mail"),password:document.getElementById("lg-pw").value});
    if(error){ err.textContent="E-mail ou mot de passe incorrect."; return; }
    const {data}=await S.sb.auth.getSession(); S.session=data.session; await checkOrga();
    if(S.orga){ toast("Connecté en organisateur"); goHash("#/"); } else render();
    return;
  }
  if(kind==="newT"){
    const nom=v("nt-nom"); if(!nom) return; const id=uid();
    const ok=await W(tPath(id),"set",{nom,date:v("nt-date")||null,lieu:v("nt-lieu")||"",terrains:Math.max(0,parseInt(v("nt-ter"),10)||0),heure:v("nt-h")||null,duree:parseInt(v("nt-dur"),10)||30,createdAt:Date.now()});
    if(ok){ ["nt-nom","nt-date","nt-lieu"].forEach(i=>document.getElementById(i).value=""); go(id); }
  }
  else if(kind==="addE"){
    const xid=f.dataset.x, x=S.tableaux.find(t=>t.id===xid); const j1=v(`ae1-${xid}`), j2=isDouble(x.discipline)?v(`ae2-${xid}`):"", club=v(`aec-${xid}`);
    if(!j1||(isDouble(x.discipline)&&!j2)) return;
    const max=Math.max(0,...sortedEntries(x).map(e=>e.ordre||0));
    if(await W(tabPath(S.curT,xid),"update",{entrees:{[uid()]:{j1,j2:j2||null,club,ordre:max+1}}})){
      [`ae1-${xid}`,`ae2-${xid}`].forEach(i=>{ const el=document.getElementById(i); if(el) el.value=""; }); document.getElementById(`ae1-${xid}`).focus(); }
  }
  else if(kind==="bulk"){
    const xid=f.dataset.x, x=S.tableaux.find(t=>t.id===xid), dbl=isDouble(x.discipline);
    let max=Math.max(0,...sortedEntries(x).map(e=>e.ordre||0)); const ent={}; let bad=0;
    v(`bulk-${xid}`).split(/\n/).map(l=>l.trim()).filter(Boolean).forEach(l=>{
      let club=""; const m=l.match(/\(([^)]*)\)\s*$/); if(m){ club=m[1].trim(); l=l.slice(0,m.index).trim(); }
      const parts=l.split(/\s*[\/;]\s*|\s+-\s+|\s+et\s+/i).map(s=>s.trim()).filter(Boolean);
      if(dbl&&parts.length<2){ bad++; return; }
      ent[uid()]={j1:parts[0],j2:dbl?parts[1]:null,club,ordre:++max};
    });
    const n=Object.keys(ent).length; if(!n){ toast(bad?"Format non reconnu : sépare les partenaires par « / ».":"Liste vide"); return; }
    if(await W(tabPath(S.curT,xid),"update",{entrees:ent})){ document.getElementById(`bulk-${xid}`).value=""; toast(`${n} ajouté${n>1?"s":""}${bad?` · ${bad} ligne${bad>1?"s":""} ignorée${bad>1?"s":""} (partenaire manquant)`:""}`); }
  }
  else if(kind==="editT"){
    const t=curTournoi(); const data={nom:v("et-nom")||t.nom,date:v("et-date")||null,lieu:v("et-lieu"),terrains:Math.max(0,parseInt(v("et-ter"),10)||0),heure:v("et-h")||null,duree:Math.max(5,parseInt(v("et-dur"),10)||30)};
    closeModal(); if(await W(tPath(t.id),"update",data)) toast("Tournoi mis à jour");
  }
  else if(kind==="newTab"){
    const disc=document.getElementById("nx-d").value; const nom=v("nx-nom")||DISC[disc]; const id=uid();
    closeModal(); if(await W(tabPath(S.curT,id),"set",{nom,discipline:disc,pts:21,sg:2,nbPoules:2,qualif:2,phase:"inscriptions",entrees:{},poules:[],matchs:{},finale:null,createdAt:Date.now()})) go(S.curT,id);
  }
  else if(kind==="editE"){
    const xid=f.dataset.x, eid=f.dataset.e, x=S.tableaux.find(t=>t.id===xid); const j1=v("ee1"), j2=isDouble(x.discipline)?v("ee2"):null;
    if(!j1||(isDouble(x.discipline)&&!j2)) return;
    closeModal(); if(await W(tabPath(S.curT,xid),"update",{entrees:{[eid]:{j1,j2,club:v("eec")}}})) toast("Équipe modifiée");
  }
  else if(kind==="renTab"){
    const xid=f.dataset.x, nom=v("rn-nom"); closeModal(); if(nom) await W(tabPath(S.curT,xid),"update",{nom});
  }
});
async function moveEntry(xid,eid,dir){
  const x=S.tableaux.find(t=>t.id===xid); const ents=sortedEntries(x); const i=ents.findIndex(e=>e.id===eid), j=i+dir;
  if(i<0||j<0||j>=ents.length) return;
  const upd={}; ents.forEach((e,k)=>{ const pos=k===i?j:k===j?i:k; if((e.ordre||0)!==pos+1) upd[e.id]={ordre:pos+1}; });
  await W(tabPath(S.curT,xid),"update",{entrees:upd});
}
function editTournoi(){
  const t=curTournoi();
  openModal(`<h3>Paramètres du tournoi</h3><form data-form="editT" class="col" style="gap:10px;margin-top:10px">
    <label class="f">Nom<input type="text" id="et-nom" value="${esc(t.nom)}" required></label>
    <div class="row"><label class="f" style="flex:1">Date<input type="date" id="et-date" value="${esc(t.date||"")}"></label><label class="f" style="width:110px">Terrains<input type="number" id="et-ter" min="0" max="30" value="${t.terrains||0}"></label></div>
    <div class="row"><label class="f" style="flex:1">Heure de début<input type="time" id="et-h" value="${esc(t.heure||"")}"></label><label class="f" style="flex:1">Durée moyenne d'un match (min)<input type="number" id="et-dur" min="5" max="120" value="${t.duree||30}"></label></div>
    <label class="f">Lieu<input type="text" id="et-lieu" value="${esc(t.lieu||"")}"></label>
    <div class="row" style="justify-content:space-between;margin-top:6px"><button type="button" class="btn dan sm" data-act="delT">Supprimer le tournoi</button><div class="row"><button type="button" class="btn" data-act="close">Annuler</button><button class="btn pri">Enregistrer</button></div></div>
  </form>`);
}
function newTableau(){
  openModal(`<h3>Nouveau tableau</h3><form data-form="newTab" class="col" style="gap:10px;margin-top:10px">
    <label class="f">Discipline<select id="nx-d">${Object.entries(DISC).map(([k,l])=>`<option value="${k}">${l}</option>`).join("")}</select></label>
    <label class="f">Nom affiché (optionnel)<input type="text" id="nx-nom" placeholder="ex. Double mixte P10-NC"></label>
    <div class="small muted">Tu pourras régler le format des matchs, le nombre de poules et les qualifiés juste après.</div>
    <div class="row" style="justify-content:flex-end"><button type="button" class="btn" data-act="close">Annuler</button><button class="btn pri">Créer le tableau</button></div>
  </form>`);
}
function renTableau(xid){
  const x=S.tableaux.find(t=>t.id===xid);
  openModal(`<h3>Renommer le tableau</h3><form data-form="renTab" data-x="${esc(xid)}" class="col" style="gap:10px;margin-top:10px">
    <input type="text" id="rn-nom" value="${esc(x.nom)}" required>
    <div class="row" style="justify-content:flex-end"><button type="button" class="btn" data-act="close">Annuler</button><button class="btn pri">Renommer</button></div></form>`);
}
