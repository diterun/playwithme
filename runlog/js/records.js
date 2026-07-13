/* ============================================================
   records.js — 달리기 기록 목록/통계/차트 + 기록 추가·삭제
   ============================================================ */
function render(){
  DB.runs.sort((a,b)=> a.date<b.date ? 1 : -1);

  renderWeek();

  // 기록 리스트
  const list = $("run-list");
  if(!DB.runs.length){
    list.innerHTML = '<div class="empty">아직 기록이 없어요.<br>오른쪽 아래 ＋ 로 첫 달리기를 남겨보세요! 🏃</div>';
  } else {
    list.innerHTML = DB.runs.map(r => `
      <div class="run">
        <div class="d">${r.mood || "🏃"}</div>
        <div class="info">
          <div class="top">${fmtKm(r.km)} km · ${fmtDur(r.sec)}</div>
          <div class="meta">${r.env && ENV_MAP[r.env] ? ENV_MAP[r.env].ic + " " : ""}${r.date} · 페이스 ${fmtPace(r.sec, r.km)}/km</div>
          ${r.note ? `<div class="note">📝 ${esc(r.note)}</div>` : ""}
        </div>
        <button class="edit" data-eid="${r.id}" aria-label="수정">✏️</button>
        <button class="del" data-id="${r.id}">🗑️</button>
      </div>`).join("");
  }

  // 전체 통계
  const tot = DB.runs.reduce((s,r)=>({km:s.km+r.km, sec:s.sec+r.sec}), {km:0, sec:0});
  $("t-cnt").textContent  = DB.runs.length;
  $("t-dist").textContent = tot.km.toFixed(1);
  $("t-time").textContent = Math.round(tot.sec/60);
  $("t-pace").textContent = fmtPace(tot.sec, tot.km);

  renderGoal();
  renderStats();
}

/* ============================================================
   통계: 평균 페이스 추이 그래프 + 월별 달력
   ============================================================ */
const ZOOMS = [5, 10, 20, 40, Infinity];   // 한 번에 보이는 기록 수
let zoomIdx = 1;                            // 기본 최근 10개
const _now = new Date();
let calY = _now.getFullYear(), calM = _now.getMonth();

function renderStats(){ renderPR(); renderChartChips(); renderPaceChart(); renderMonthly(); renderWeekday(); renderCalendar(); }

/* ---------- 페이스 그래프 환경 필터 칩 ---------- */
let chartEnv = "all";
function renderChartChips(){
  const box = $("chart-chips");
  const present = new Set(DB.runs.filter(r=>r.km>0 && r.sec>0).map(r => r.env || "none"));
  const chips = [{ v:"all", t:"전체" }];
  ENVS.forEach(e => { if(present.has(e.v)) chips.push({ v:e.v, t:e.ic + e.t }); });
  if(chips.length <= 1){ box.innerHTML = ""; box.style.display = "none"; return; }  // 태그된 기록 없으면 숨김
  box.style.display = "flex";
  if(chartEnv !== "all" && !present.has(chartEnv)) chartEnv = "all";
  box.innerHTML = chips.map(c => `<button data-env="${c.v}" class="chip ${chartEnv===c.v?"active":""}">${c.t}</button>`).join("");
}
$("chart-chips").onclick = e => {
  const b = e.target.closest("button[data-env]"); if(!b) return;
  chartEnv = b.dataset.env; renderChartChips(); renderPaceChart();
};

/* ---------- 이번 주: 스트릭 + 주간 목표 진행 ---------- */
function currentStreak(){
  const days = new Set(DB.runs.map(r => r.date));
  if(!days.size) return 0;
  const d = new Date(); d.setHours(0,0,0,0);
  if(!days.has(ymd(d))) d.setDate(d.getDate()-1);   // 오늘 안 뛰었어도 어제까지 이어졌으면 유지
  let s = 0;
  while(days.has(ymd(d))){ s++; d.setDate(d.getDate()-1); }
  return s;
}
function renderWeek(){
  const ws = ymd(weekStart());
  const wk = DB.runs.filter(r => r.date >= ws);
  const dist = wk.reduce((s,r)=>s+r.km, 0), cnt = wk.length;
  const g = DB.weekGoal || {};
  const st = currentStreak();
  $("streak").innerHTML = st > 0
    ? `<div class="streak-b">🔥 <b>${st}일</b> 연속 달리는 중!</div>`
    : `<div class="streak-b off">오늘 달리면 연속 기록이 시작돼요 🏃</div>`;
  const row = (label, valTxt, cur, target, targetTxt) => {
    if(target > 0){
      const pct = Math.min(100, Math.round(cur/target*100));
      return `<div class="wk-row"><div class="wk-top"><span>${label}</span><span>${valTxt} <b>/ ${targetTxt}</b></span></div><div class="goal-bar"><i style="width:${pct}%"></i></div></div>`;
    }
    return `<div class="wk-row"><div class="wk-top"><span>${label}</span><span>${valTxt}</span></div></div>`;
  };
  $("week-prog").innerHTML =
    row("거리", `${fmtKm(dist)} km`, dist, g.km, `${fmtKm(g.km||0)} km`) +
    row("횟수", `${cnt}회`, cnt, g.runs, `${g.runs||0}회`);
}

/* ---------- 개인 기록(PR) ---------- */
function prStats(runs){
  const rs = runs.filter(r => r.km>0 && r.sec>0);
  if(!rs.length) return null;
  return {
    dist: Math.max(...rs.map(r=>r.km)),
    time: Math.max(...rs.map(r=>r.sec)),
    pace: Math.min(...rs.filter(r=>r.km>=1).map(r=>r.sec/r.km).concat(Infinity)),
  };
}
function renderPR(){
  const box = $("pr-grid");
  const pr = prStats(DB.runs);
  if(!pr){ box.className=""; box.innerHTML = '<div class="empty">기록이 쌓이면 개인 기록이 표시돼요</div>'; return; }
  box.className = "pr-grid";
  const paceTxt = isFinite(pr.pace) ? fmtPace(pr.pace,1) : "-";
  box.innerHTML =
    `<div class="pr"><div class="pn">${fmtKm(pr.dist)}<span style="font-size:11px"> km</span></div><div class="pl">최장 거리</div></div>` +
    `<div class="pr"><div class="pn">${fmtDur(pr.time)}</div><div class="pl">최장 시간</div></div>` +
    `<div class="pr"><div class="pn">${paceTxt}</div><div class="pl">최고 페이스</div></div>`;
}

/* ---------- 월별 거리 막대 (최근 6개월) ---------- */
function renderMonthly(){
  const box = $("mchart");
  if(!DB.runs.length){ box.innerHTML = '<div class="empty" style="width:100%">기록이 쌓이면 월별 거리가 보여요</div>'; return; }
  const now = new Date();
  const months = [];
  for(let i=5; i>=0; i--){
    const d = new Date(now.getFullYear(), now.getMonth()-i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`;
    const km = DB.runs.filter(r => r.date.startsWith(key)).reduce((s,r)=>s+r.km, 0);
    months.push({ label:`${d.getMonth()+1}월`, km });
  }
  const max = Math.max(...months.map(m=>m.km), 1);
  box.innerHTML = months.map(m =>
    `<div class="col"><div class="v">${m.km>0?fmtKm(m.km):""}</div><div class="bar" style="height:${Math.max(2, m.km/max*90)}%"></div><div class="l">${m.label}</div></div>`
  ).join("");
}

/* ---------- 요일별 패턴 (총 거리) ---------- */
function renderWeekday(){
  const box = $("wdchart");
  if(!DB.runs.length){ box.innerHTML = '<div class="empty" style="width:100%">기록이 쌓이면 요일별 패턴이 보여요</div>'; return; }
  const sums = [0,0,0,0,0,0,0];   // 월~일
  DB.runs.forEach(r => { const wd = (dateOf(r.date).getDay()+6)%7; sums[wd] += r.km; });
  const names = ["월","화","수","목","금","토","일"];
  const max = Math.max(...sums, 1);
  box.innerHTML = sums.map((km,i) =>
    `<div class="col"><div class="v">${km>0?fmtKm(km):""}</div><div class="bar" style="height:${Math.max(2, km/max*90)}%"></div><div class="l ${i>=5?"we":""}">${names[i]}</div></div>`
  ).join("");
}

/* ---------- CSV 내보내기 ---------- */
function exportCSV(){
  const head = ["날짜","환경","거리(km)","시간(분:초)","페이스(/km)","느낌","메모"];
  const rows = [head];
  [...DB.runs].sort((a,b)=> a.date<b.date ? -1 : 1).forEach(r => {
    const mm = Math.floor(r.sec/60), ss = r.sec%60;
    const env = r.env && ENV_MAP[r.env] ? ENV_MAP[r.env].t : "";
    rows.push([ r.date, env, fmtKm(r.km), `${mm}:${String(ss).padStart(2,"0")}`, fmtPace(r.sec,r.km), r.mood||"", r.note||"" ]);
  });
  const csv = rows.map(row => row.map(c => `"${String(c).replace(/"/g,'""')}"`).join(",")).join("\r\n");
  const blob = new Blob(["﻿"+csv], {type:"text/csv;charset=utf-8"});   // BOM: 엑셀 한글 깨짐 방지
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "dalyeo-" + ymd(new Date()) + ".csv";
  a.click(); URL.revokeObjectURL(a.href);
  toast("CSV 파일을 내보냈어요");
}

function renderPaceChart(){
  const box = $("chart");
  let runs = DB.runs.filter(r => r.km>0 && r.sec>0);
  if(chartEnv !== "all") runs = runs.filter(r => (r.env || "none") === chartEnv);
  runs = runs.slice().sort((a,b)=> a.date<b.date ? -1 : 1);
  const n = ZOOMS[zoomIdx];
  $("zoom-lbl").textContent = n===Infinity ? "전체" : `최근 ${n}개`;
  const data = (n===Infinity || n>=runs.length) ? runs : runs.slice(runs.length - n);
  if(data.length < 2){
    box.innerHTML = '<div class="empty" style="width:100%">기록이 2개 이상 쌓이면 페이스 추이가 보여요</div>';
    $("chart-cap").textContent = "";
    return;
  }
  const paces = data.map(r => r.sec / r.km);            // 초/km (작을수록 빠름)
  const min = Math.min(...paces), max = Math.max(...paces);
  // 세로축을 '분' 눈금(60초 단위)에 맞춰 아래위로 한 칸씩 여유를 둔다
  const loM = Math.max(0, Math.floor(min/60) - 1);
  const hiMraw = Math.ceil(max/60) + 1;
  const hiM = hiMraw > loM ? hiMraw : loM + 1;
  const lo = loM*60, hi = hiM*60;                       // 초/km 단위 세로 범위
  const W=320, H=170, mL=30, mR=8, mT=12, mB=24;
  const X = i => mL + (W-mL-mR) * (data.length===1 ? 0.5 : i/(data.length-1));
  const Y = p => mT + (H-mT-mB) * ((p - lo)/(hi - lo)); // 빠름(작은값)=위

  // 분 단위 가로 눈금선 + 왼쪽 라벨 (5분, 6분, 7분 …)
  const step = (hiM - loM) > 7 ? 2 : 1;
  let grid = "";
  for(let m=loM; m<=hiM; m+=step){
    const y = Y(m*60).toFixed(1);
    grid += `<line class="grid-l" x1="${mL}" y1="${y}" x2="${W-mR}" y2="${y}"/>`;
    grid += `<text class="axis-t" x="${mL-4}" y="${(+y+3).toFixed(1)}" text-anchor="end">${m}분</text>`;
  }

  const pts  = paces.map((p,i)=>`${X(i).toFixed(1)},${Y(p).toFixed(1)}`).join(" ");
  const dots = paces.map((p,i)=>`<circle class="pace-dot ${i===paces.length-1?"last":""}" cx="${X(i).toFixed(1)}" cy="${Y(p).toFixed(1)}" r="${i===paces.length-1?3.6:2.4}"/>`).join("");
  const labIdx = [...new Set([0, Math.floor((data.length-1)/2), data.length-1])];
  const xlabs = labIdx.map(i=>{
    const anc = i===0 ? "start" : i===data.length-1 ? "end" : "middle";
    return `<text class="axis-t" x="${X(i).toFixed(1)}" y="${H-8}" text-anchor="${anc}">${data[i].date.slice(5)}</text>`;
  }).join("");

  box.innerHTML = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet">
    <defs><linearGradient id="pg" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="var(--accent2)"/><stop offset="1" stop-color="var(--accent)"/></linearGradient></defs>
    ${grid}<polyline class="pace-poly" points="${pts}"/>${dots}${xlabs}</svg>`;

  const diff = paces[0] - paces[paces.length-1];        // + 면 지금이 더 빠름
  $("chart-cap").innerHTML =
    `가장 빠름 ${fmtPace(min,1)} · 느림 ${fmtPace(max,1)}<br>` + (
    Math.abs(diff) < 1 ? "이 구간 페이스가 비슷하게 유지되고 있어요." :
    diff > 0 ? `처음보다 1km당 ${Math.round(diff)}초 빨라졌어요! 🎉` :
               `처음보다 1km당 ${Math.round(-diff)}초 느려졌어요. 무리 말고 꾸준히 💪`);
}
$("zoom-in").onclick  = ()=>{ if(zoomIdx>0){ zoomIdx--; renderPaceChart(); } };            // 확대(더 적게)
$("zoom-out").onclick = ()=>{ if(zoomIdx<ZOOMS.length-1){ zoomIdx++; renderPaceChart(); } }; // 축소(더 많이)

function renderCalendar(){
  const mm = String(calM+1).padStart(2,"0");
  const prefix = `${calY}-${mm}`;
  const mRuns = DB.runs.filter(r => r.date.startsWith(prefix));
  const runDays = {};
  mRuns.forEach(r => { const d = +r.date.slice(8,10); (runDays[d] = runDays[d] || []).push(r); });
  const dist = mRuns.reduce((s,r)=>s+r.km, 0), totSec = mRuns.reduce((s,r)=>s+r.sec, 0);

  $("cal-title").textContent = `${calY}.${mm}`;
  $("cal-summary").innerHTML = mRuns.length
    ? `이 달 <b>${fmtKm(dist)} km</b> · ${mRuns.length}회 · 평균 페이스 <b>${fmtPace(totSec, dist)}/km</b>`
    : "이 달 기록이 아직 없어요";

  const startDay = (new Date(calY, calM, 1).getDay() + 6) % 7;   // 월요일 시작
  const daysIn = new Date(calY, calM+1, 0).getDate();
  const today = new Date();
  const isThisMonth = today.getFullYear()===calY && today.getMonth()===calM;

  const wd = ["월","화","수","목","금","토","일"];
  let html = wd.map((w,i)=>`<div class="wd ${i>=5?"we":""}">${w}</div>`).join("");
  for(let i=0;i<startDay;i++) html += `<div class="cell other"></div>`;
  for(let d=1; d<=daysIn; d++){
    const cls = ["cell"];
    if(runDays[d]) cls.push("run");
    if(isThisMonth && d===today.getDate()) cls.push("today");
    html += `<div class="${cls.join(" ")}">${d}${runDays[d] ? '<span class="stamp">👟</span>' : ""}</div>`;
  }
  $("calendar").innerHTML = html;
}
$("cal-prev").onclick = ()=>{ if(--calM < 0){ calM=11; calY--; } renderCalendar(); };
$("cal-next").onclick = ()=>{ if(++calM > 11){ calM=0; calY++; } renderCalendar(); };

/* 년·월 선택기 (제목 클릭 → 원하는 년월 선택). 앱을 껐다 켜면 calY/calM이
   새로 new Date()로 초기화되므로 자동으로 오늘 년월로 돌아온다. */
let pkYear = calY;
function renderPicker(){
  $("pk-year").textContent = pkYear + "년";
  $("pk-months").innerHTML = Array.from({length:12}, (_,m)=>
    `<button data-m="${m}" class="${(pkYear===calY && m===calM) ? "active" : ""}">${m+1}월</button>`).join("");
}
$("cal-title").onclick = ()=>{
  const p = $("cal-picker");
  if(p.hidden){ pkYear = calY; renderPicker(); p.hidden = false; }
  else p.hidden = true;
};
$("pk-py").onclick = ()=>{ pkYear--; renderPicker(); };
$("pk-ny").onclick = ()=>{ pkYear++; renderPicker(); };
$("pk-months").onclick = e => {
  const b = e.target.closest("button[data-m]"); if(!b) return;
  calY = pkYear; calM = +b.dataset.m;
  $("cal-picker").hidden = true;
  renderCalendar();
};

/* ============================================================
   목표 (거리·시간) — 기록 화면 상단에 표시
   ============================================================ */
function renderGoal(){
  const box = $("goal-card"), g = DB.goal;
  if(!g || !(g.km>0) || !(g.min>0)){
    box.innerHTML = `<div class="card goal-empty">🎯 아직 목표가 없어요. <b>설정 › 목표</b>에서 목표 거리·시간을 정해보세요.</div>`;
    return;
  }
  const targetPace = g.min*60 / g.km;                          // 목표 초/km
  const eligible = DB.runs.filter(r => r.km>0 && r.sec>0 && r.km >= g.km*0.95);
  let body;
  if(!eligible.length){
    body = `<div class="g-d">아직 <b>${fmtKm(g.km)}km</b>를 뛴 기록이 없어요. 먼저 거리를 채워봐요!</div>`;
  } else {
    const best = Math.min(...eligible.map(r => r.sec/r.km));    // 최고(가장 빠른) 페이스
    if(best <= targetPace){
      body = `<div class="g-d">🏅 <b>목표 달성!</b> 최고 페이스 <b>${fmtPace(best,1)}/km</b>로 해냈어요. 대단해요!</div>`;
    } else {
      const gap = best - targetPace;
      const prog = Math.max(0, Math.min(100, Math.round(targetPace/best*100)));
      body = `<div class="goal-bar"><i style="width:${prog}%"></i></div>`
           + `<div class="g-d">현재 최고 <b>${fmtPace(best,1)}/km</b> · 목표까지 1km당 <b>${Math.round(gap)}초</b> 더! 조금만 더 힘내요 💪</div>`;
    }
  }
  box.innerHTML = `<div class="goal"><div class="g-t">🎯 목표: ${fmtKm(g.km)}km을 ${g.min}분에 <span style="color:var(--dim);font-weight:600">(페이스 ${fmtPace(targetPace,1)}/km)</span></div>${body}</div>`;
}
function fillGoalInputs(){
  $("g-km").value  = DB.goal && DB.goal.km  ? DB.goal.km  : "";
  $("g-min").value = DB.goal && DB.goal.min ? DB.goal.min : "";
}
$("g-save").onclick = ()=>{
  const km = parseFloat($("g-km").value), min = parseFloat($("g-min").value);
  if(!(km>0) || !(min>0)){ toast("목표 거리와 시간을 입력해주세요"); return; }
  DB.goal = { km, min }; save(DB); renderGoal();
  toast("목표를 저장했어요 🎯");
};
$("g-clear").onclick = ()=>{
  DB.goal = null; save(DB); fillGoalInputs(); renderGoal();
  toast("목표를 지웠어요");
};

/* ---------- 기록 추가·수정 모달 ---------- */
let editId = null;
function setEnv(v){ $("m-env").querySelectorAll("button").forEach(b => b.classList.toggle("active", b.dataset.v===v)); }
$("m-env").onclick = e => { const b = e.target.closest("button[data-v]"); if(b) setEnv(b.dataset.v); };
function openRunModal(run){
  editId = run ? run.id : null;
  $("m-title").textContent = run ? "기록 수정" : "달리기 기록";
  $("m-date").value = run ? run.date : ymd(new Date());
  $("m-dist").value = run ? run.km : "";
  $("m-min").value  = run ? Math.floor(run.sec/60) : "";
  $("m-sec").value  = run ? run.sec%60 : "";
  $("m-mood").value = run ? (run.mood || "🙂") : "🙂";
  $("m-note").value = run ? (run.note || "") : "";
  setEnv(run ? (run.env || "mill") : (localStorage.getItem("dalyeo_lastenv") || "mill"));
  $("modal").classList.add("open");
}
$("fab").onclick = ()=>openRunModal();
$("m-close").onclick = ()=>$("modal").classList.remove("open");
$("modal").onclick = e => { if(e.target.id==="modal") $("modal").classList.remove("open"); };
$("m-save").onclick = ()=>{
  const km = parseFloat($("m-dist").value), date = $("m-date").value;
  const min = parseFloat($("m-min").value) || 0, sec = parseFloat($("m-sec").value) || 0;
  const totSec = Math.round(min*60 + sec);
  if(!date){ toast("날짜를 골라주세요"); return; }
  if(!(km>0)){ toast("거리를 입력해주세요"); return; }
  if(!(totSec>0)){ toast("시간(분·초)을 입력해주세요"); return; }
  const envBtn = $("m-env").querySelector("button.active");
  const env = envBtn ? envBtn.dataset.v : "mill";
  localStorage.setItem("dalyeo_lastenv", env);   // 다음 입력 기본값으로 기억
  const data = { date, km, sec:totSec, env, mood:$("m-mood").value, note:$("m-note").value.trim() };

  if(editId){
    const r = DB.runs.find(x => x.id===editId);
    if(r) Object.assign(r, data);
    save(DB); render();
    $("modal").classList.remove("open");
    toast("기록을 수정했어요 ✏️");
  } else {
    const before = prStats(DB.runs);                       // 추가 전 개인기록
    DB.runs.push({ id:Date.now()+"", ...data });
    save(DB); render();
    $("modal").classList.remove("open");
    // 신기록 축하
    const msgs = [];
    if(!before || km > before.dist)  msgs.push(`최장 거리 ${fmtKm(km)}km`);
    if(!before || totSec > before.time) msgs.push(`최장 시간 ${fmtDur(totSec)}`);
    if(km>=1 && (!before || !isFinite(before.pace) || totSec/km < before.pace)) msgs.push(`최고 페이스 ${fmtPace(totSec,km)}/km`);
    toast(msgs.length ? `🎉 신기록! ${msgs.join(" · ")}` : "기록 저장! 잘했어요 👏");
  }
};
$("run-list").onclick = e => {
  const ed = e.target.closest(".edit");
  if(ed){ const r = DB.runs.find(x => x.id===ed.dataset.eid); if(r) openRunModal(r); return; }
  const b = e.target.closest(".del");
  if(b && confirm("이 기록을 지울까요?")){ DB.runs = DB.runs.filter(r=>r.id!==b.dataset.id); save(DB); render(); toast("삭제했어요"); }
};
