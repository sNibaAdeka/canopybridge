(async function(){
const $=s=>document.querySelector(s);
const url=(window.CONFIG&&CONFIG.DATA_URL)||"data/attendance.json";
let data;
try{ data=await (await fetch(url,{cache:"no-store"})).json(); }
catch(e){ $("#banner").hidden=false; $("#banner").textContent="Не удалось загрузить данные: "+e.message; return; }
if(data.demo){ $("#banner").hidden=false; $("#banner").textContent="Демо-данные. Подключите Apps Script (см. README), чтобы здесь появились реальные уроки из Google Meet."; }
$("#updated").textContent=data.updatedAt?"Обновлено "+new Date(data.updatedAt).toLocaleString("ru-RU",{dateStyle:"medium",timeStyle:"short"}):"";

const norm=s=>(s||"").toLowerCase().replace(/ё/g,"е").replace(/\s+/g," ").trim();
const fmt=d=>new Date(d).toLocaleDateString("ru-RU",{day:"2-digit",month:"short"});
const sessions=[...data.sessions].sort((a,b)=>a.date.localeCompare(b.date));

// matching: email or name/alias → roster student
function find(p){
  const e=norm(p.email), n=norm(p.name);
  return data.students.find(s=>(e&&norm(s.email)===e)||[s.name,...(s.aliases||[])].some(a=>norm(a)===n));
}
function minutesOf(sess){ const m={}; (sess.attendees||[]).forEach(p=>{const s=find(p); if(s) m[s.id]=(m[s.id]||0)+(p.minutes||0);}); return m; }
const mins=sessions.map(minutesOf);

function status(sIdx,stu,thr){
  const m=mins[sIdx][stu.id]||0, need=(sessions[sIdx].duration||60)*thr;
  return m>=need?"p":m>0?"l":"a";
}
function render(){
  const thr=+$("#thr").value, q=norm($("#q").value);
  const rows=data.students.filter(s=>!q||norm(s.name).includes(q)).map(s=>{
    const st=sessions.map((_,i)=>status(i,s,thr)); const pr=st.filter(x=>x==="p").length;
    return {s,st,pr,pct:sessions.length?Math.round(pr/sessions.length*100):0};
  });
  $("#matrix").innerHTML="<thead><tr><th>Ученик</th>"+sessions.map(x=>`<th title="${x.title||""}">${fmt(x.date)}</th>`).join("")+"<th>Итого</th></tr></thead><tbody>"+
    rows.map(r=>`<tr><td>${r.s.name}</td>${r.st.map((x,i)=>`<td title="${mins[i][r.s.id]||0} мин"><i class="d ${x}"></i></td>`).join("")}<td>${sessions.length?`<span class="pct ${r.pct>=80?"hi":r.pct>=60?"mid":"lo"}">${r.pct}%</span>`:'<span class="muted">—</span>'}</td></tr>`).join("")+"</tbody>";
  window._rows=rows;
}
function stats(){
  const thr=+$("#thr").value, tot=data.students.length*sessions.length;
  const present=data.students.reduce((a,s)=>a+sessions.filter((_,i)=>status(i,s,thr)==="p").length,0);
  const avg=tot?Math.round(present/tot*100):0;
  const last=sessions.length-1, lastP=last>=0?data.students.filter(s=>status(last,s,thr)==="p").length:0;
  $("#stats").innerHTML=[[data.students.length,"учеников"],[sessions.length,"уроков проведено"],[sessions.length?avg+"%":"—","средняя посещаемость"],[last>=0?`${lastP}/${data.students.length}`:"—","на последнем уроке"]]
    .map(([a,b])=>`<div class="stat"><b>${a}</b><span>${b}</span></div>`).join("");
}
function sessionList(){
  const thr=+$("#thr").value;
  $("#sessions").innerHTML=[...sessions].reverse().map(x=>{
    const i=sessions.indexOf(x), here=data.students.filter(s=>status(i,s,thr)==="p"), gone=data.students.filter(s=>status(i,s,thr)!=="p");
    const pct=data.students.length?Math.round(here.length/data.students.length*100):0;
    return `<div class="s"><div class="s-h"><div><b>${x.title||"Урок"}</b><div class="muted">${new Date(x.date).toLocaleDateString("ru-RU",{weekday:"long",day:"numeric",month:"long"})} · ${x.duration||"?"} мин · ${here.length}/${data.students.length}</div></div>${x.notesUrl?`<a href="${x.notesUrl}" target="_blank" rel="noopener">Заметки Gemini →</a>`:`<span class="muted">заметок нет</span>`}</div>
    <div class="bar"><i style="width:${pct}%"></i></div>${x.summary?`<p>${x.summary}</p>`:""}
    ${gone.length?`<div class="chips">${gone.map(s=>`<span class="chip x">${s.name}</span>`).join("")}</div>`:""}</div>`;
  }).join("")||'<div class="s muted">Пока нет уроков</div>';
}
function all(){render();stats();sessionList();}
$("#q").oninput=render; $("#thr").onchange=all;
$("#csv").onclick=()=>{
  const head=["Ученик",...sessions.map(s=>s.date),"%"];
  const lines=[head,...window._rows.map(r=>[r.s.name,...r.st.map(x=>x==="p"?1:x==="l"?0.5:0),r.pct])].map(l=>l.map(c=>`"${c}"`).join(","));
  const a=document.createElement("a"); a.href=URL.createObjectURL(new Blob(["﻿"+lines.join("\n")],{type:"text/csv"})); a.download="stem-orta-attendance.csv"; a.click();
};
all();
})();
