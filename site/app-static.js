const state = { env: "Lab-S", memory: null, projection: null, selectedObject: null, session: 1, visible: true };
const ids = [
  "viewer","loader","cloudStats","objectSelect","objectName","eventBadge","stateValue","locationValue",
  "lastObservedValue","volatilityValue","confidenceValue","observationFigure","observationImage",
  "observationCaption","observedCountValue","historyList","sessionRange","sessionLabel","sessionTicks",
  "eventTimeline","questionButtons","answerText","toggleCloud","resetView","answerEvidence","answerStatus",
  "mapEvidenceCue","sceneModeLabel"
];
const el = Object.fromEntries(ids.map(id => [id, document.getElementById(id)]));
let mapImage, labelLayer, pathSvg;

function asset(path) { return "./assets/" + path; }
function rowFor(object, session) { return object.sessions["s" + session]; }
function markerState(object, session) {
  const row = rowFor(object, session);
  if (row?.present && row.position) return { row, ghost: false };
  for (let i=session-1;i>=1;i--) {
    const prior=rowFor(object,i);
    if (prior?.present && prior.position) return { row: prior, ghost: true };
  }
  return null;
}
function project(position) {
  const p=[position[0],-position[1],position[2]], m=state.projection;
  const rel=p.map((v,i)=>v-m.center[i]);
  const dot=a=>rel.reduce((sum,v,i)=>sum+v*a[i],0);
  const u=dot(m.right), v=dot(m.up), lo=m.bounds.min, hi=m.bounds.max;
  return [100*(u-lo[0])/(hi[0]-lo[0]),100*(hi[1]-v)/(hi[1]-lo[1])];
}
function ensureStaticViewer() {
  el.viewer.querySelectorAll(".static-map,.static-paths,.static-label-layer").forEach(n=>n.remove());
  mapImage=document.createElement("img");
  mapImage.className="static-map";
  mapImage.alt=state.env+" aligned 3D map";
  pathSvg=document.createElementNS("http://www.w3.org/2000/svg","svg");
  pathSvg.setAttribute("class","static-paths");
  pathSvg.setAttribute("viewBox","0 0 100 100");
  pathSvg.setAttribute("preserveAspectRatio","none");
  labelLayer=document.createElement("div");
  labelLayer.className="static-label-layer";
  el.viewer.prepend(mapImage,pathSvg,labelLayer);
}
function renderMap() {
  const meta=state.projection;
  mapImage.onload=()=>el.loader.classList.add("hidden");
  mapImage.src=asset(meta.image);
  mapImage.hidden=!state.visible;
  pathSvg.hidden=!state.visible;
  labelLayer.hidden=!state.visible;
  el.sceneModeLabel.textContent="Pre-rendered aligned 3D map";
  el.cloudStats.textContent="Instant view · WebGL-free";
  pathSvg.innerHTML="";
  labelLayer.innerHTML="";
  const selected=state.memory.objects[state.selectedObject];
  const trajectory=[];
  for(let i=1;i<=10;i++){
    const row=rowFor(selected,i);
    if(row?.present && row.position && row.event!=="NONE") trajectory.push(project(row.position));
  }
  if(trajectory.length>1){
    const line=document.createElementNS("http://www.w3.org/2000/svg","polyline");
    line.setAttribute("points",trajectory.map(p=>p.join(",")).join(" "));
    line.setAttribute("class","static-trajectory");
    pathSvg.append(line);
  }
  for(const [name,object] of Object.entries(state.memory.objects)){
    const marker=markerState(object,state.session);
    if(!marker) continue;
    const [x,y]=project(marker.row.position);
    const button=document.createElement("button");
    button.type="button";
    button.className="static-object-label"+(name===state.selectedObject?" selected":"")+(marker.ghost?" ghost":"");
    button.style.left=x+"%"; button.style.top=y+"%";
    button.textContent=name+(marker.ghost?" · last":"");
    button.onclick=()=>selectObject(name);
    labelLayer.append(button);
  }
}
function renderTicks(){
  el.sessionTicks.innerHTML="";
  for(let i=1;i<=10;i++){
    const b=document.createElement("button"); b.textContent="S"+i; b.className=i===state.session?"active":"";
    b.onclick=()=>setSession(i); el.sessionTicks.append(b);
  }
}
function renderTimeline(){
  const object=state.memory.objects[state.selectedObject];
  el.eventTimeline.innerHTML="";
  for(let i=1;i<=10;i++){
    const event=rowFor(object,i).event;
    const chip=document.createElement("button");
    chip.className="event-chip "+String(event).toLowerCase()+(i===state.session?" active":"");
    chip.textContent="S"+i+" · "+event; chip.onclick=()=>setSession(i);
    el.eventTimeline.append(chip);
  }
}
function renderCard(){
  const object=state.memory.objects[state.selectedObject], row=rowFor(object,state.session);
  el.objectName.textContent=object.name;
  el.eventBadge.textContent=row.event; el.eventBadge.className="event-badge "+String(row.event).toLowerCase();
  el.stateValue.textContent=row.present?"Present":"Not observed";
  el.locationValue.textContent=row.position?row.position.map(v=>Number(v).toFixed(2)).join(", "):"—";
  const observed=Object.entries(object.sessions).filter(([,r])=>r.present);
  el.lastObservedValue.textContent=observed.length?observed.at(-1)[0].toUpperCase():"—";
  el.volatilityValue.textContent=row.volatility==null?"—":Number(row.volatility).toFixed(3);
  el.confidenceValue.textContent=row.observationConfidence==null?"—":(100*row.observationConfidence).toFixed(1)+"%";
  el.observedCountValue.textContent=observed.length+" / 10 sessions";
  if(row.observationImage){
    el.observationImage.src=asset(row.observationImage); el.observationImage.alt=object.name+" observation";
    el.observationCaption.textContent="Actual RGB observation · S"+state.session+" · frame "+row.observationFrame;
    el.observationFigure.classList.remove("hidden");
  } else el.observationFigure.classList.add("hidden");
  el.historyList.innerHTML="";
  for(let i=1;i<=10;i++){
    const r=rowFor(object,i), li=document.createElement("li");
    const pos=r.position?r.position.map(v=>Number(v).toFixed(2)).join(", "):"—";
    li.innerHTML="<span class='history-session'>S"+i+"</span><span class='history-event'>"+r.event+"</span><span class='history-position'>"+pos+"</span>";
    el.historyList.append(li);
  }
}
function renderQuestions(){
  const object=state.memory.objects[state.selectedObject];
  const questions=[
    ["last","Where was "+object.name+" last observed?"],
    ["history","How has "+object.name+" changed over time?"],
    ["changes","What changed in Session "+state.session+"?"],
    ["volatile","Which object is most volatile?"]
  ];
  el.questionButtons.innerHTML="";
  for(const [id,label] of questions){
    const b=document.createElement("button"); b.type="button"; b.textContent=label;
    b.onclick=()=>answer(id); el.questionButtons.append(b);
  }
}
function answer(id){
  const object=state.memory.objects[state.selectedObject], rows=Object.entries(object.sessions);
  let text="";
  if(id==="last"){
    const last=rows.filter(([,r])=>r.present).at(-1);
    text=object.name+" was last observed in "+last[0].toUpperCase()+" at "+last[1].position.map(v=>Number(v).toFixed(2)).join(", ")+".";
  } else if(id==="history"){
    const changes=rows.filter(([,r])=>r.event!=="NONE").map(([s,r])=>s.toUpperCase()+" "+r.event);
    text=object.name+" change sequence: "+(changes.join(" → ")||"no recorded changes")+".";
  } else if(id==="changes"){
    const changed=Object.values(state.memory.objects).filter(o=>rowFor(o,state.session).event!=="NONE");
    text=changed.length?"Session "+state.session+": "+changed.map(o=>o.name+" "+rowFor(o,state.session).event).join(", ")+".":"No recorded changes in Session "+state.session+".";
  } else {
    const objects=Object.values(state.memory.objects);
    const winner=objects.sort((a,b)=>Math.max(...Object.values(b.sessions).map(r=>r.volatility||0))-Math.max(...Object.values(a.sessions).map(r=>r.volatility||0)))[0];
    text=winner.name+" has the highest recorded volatility.";
  }
  el.answerStatus.textContent="Ready"; el.answerText.textContent=text; el.answerEvidence.innerHTML="";
}
function renderAll(){ renderMap(); renderTicks(); renderTimeline(); renderCard(); renderQuestions(); el.sessionLabel.textContent="Session "+state.session; }
function setSession(session){ state.session=session; el.sessionRange.value=String(session); renderAll(); }
function selectObject(name){ state.selectedObject=name; el.objectSelect.value=name; renderAll(); }
async function loadEnvironment(env){
  el.loader.classList.remove("hidden"); state.env=env; state.session=1; el.sessionRange.value="1";
  document.querySelectorAll(".env-button").forEach(b=>b.classList.toggle("active",b.dataset.env===env));
  const index=await fetch(asset("manifest-index.json"),{cache:"no-store"}).then(r=>r.json());
  const config=index.environments[env];
  state.memory=await fetch(asset(config.memory.path),{cache:"no-store"}).then(r=>r.json());
  const projections=await fetch(asset("static-maps/projection.json"),{cache:"no-store"}).then(r=>r.json());
  state.projection=projections[env]; state.selectedObject=Object.keys(state.memory.objects)[0];
  el.objectSelect.innerHTML="";
  for(const name of Object.keys(state.memory.objects)){const o=document.createElement("option");o.value=name;o.textContent=name;el.objectSelect.append(o);}
  ensureStaticViewer(); renderAll();
}
document.querySelectorAll(".env-button").forEach(b=>b.onclick=()=>loadEnvironment(b.dataset.env));
el.objectSelect.onchange=()=>selectObject(el.objectSelect.value);
el.sessionRange.oninput=()=>setSession(Number(el.sessionRange.value));
el.toggleCloud.onclick=()=>{state.visible=!state.visible;renderMap();el.toggleCloud.textContent=state.visible?"Map":"Show map";};
el.resetView.onclick=()=>renderMap();
["densityMode","pointSmaller","pointLarger"].forEach(id=>{const n=document.getElementById(id);if(n)n.hidden=true;});
loadEnvironment(state.env).catch(error=>{
  console.error(error); el.loader.innerHTML="<strong>Could not load the map.</strong><small>"+error.message+"</small>";
});
