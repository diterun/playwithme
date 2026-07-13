/* ============================================================
   health.js — 오늘 컨디션 슬라이더 + 추천 로직 + 건강 프로필 모달
   ============================================================ */

/* ---------- 오늘 컨디션 슬라이더 ---------- */
const SL     = {1:"매우 나쁨", 2:"나쁨", 3:"보통", 4:"좋음", 5:"아주 좋음"};
const SLpain = {1:"심함", 2:"조금", 3:"보통", 4:"약간", 5:"없음"};
const SLwill = {1:"전혀", 2:"별로", 3:"보통", 4:"많음", 5:"넘침"};
function bindSlider(id, lbl, map){ const s = $(id); const f = ()=>$(lbl).textContent = map[s.value]; s.oninput = f; f(); }
bindSlider("s-sleep","l-sleep",SL);
bindSlider("s-body","l-body",SL);
bindSlider("s-pain","l-pain",SLpain);
bindSlider("s-will","l-will",SLwill);

/* ---------- 회복(과훈련) 판단 ---------- */
function assessRecovery(){
  const st = currentStreak();     // records.js
  if(st >= 5) return { cap:0, tip:`최근 <b>${st}일 연속</b> 달렸어요. 오늘은 쉬면서 근육을 회복시키는 게 오히려 실력을 키워줘요.` };
  if(st === 4) return { cap:1, tip:"4일 연속 달렸어요. 오늘은 가볍게 하거나 하루 쉬어가는 걸 권해요." };
  return null;
}

/* ---------- 추천 계산 ---------- */
function tipsCard(tips){
  if(!tips.length) return "";
  const hint = tips.length > 3 ? " <span style='font-weight:400'>· 스크롤 ↕</span>" : "";
  return `<div class="card"><h2>내 상태에 맞는 주의사항 (${tips.length})${hint}</h2><div class="tips">${tips.map(t=>`<div class="tip">${t}</div>`).join("")}</div></div>`;
}
function computeReco(){
  const prof = DB.health.profile || {};
  const results = [];
  CONDITIONS.forEach(c => { if(c.id in prof){ results.push(c.evaluate(prof[c.id] || {}) || {}); } });

  const blocks = results.filter(r => r.block);
  const tips   = results.flatMap(r => r.tips || []);
  const area   = $("reco-area");

  // 1) 빨간불: 강도 추천 대신 의사 상담 안내
  if(blocks.length){
    let html = `<div class="alert"><div class="h">${pick(BLOCK_TITLES)}</div><div class="b">`;
    html += blocks.map(b => "• " + b.reason).join("<br>");
    html += `<br><br>뛰는 중 가슴 통증·심한 어지럼·호흡 곤란·다리 힘 빠짐이 느껴지면 <b>즉시 멈추세요.</b></div></div>`;
    html += tipsCard(tips);
    area.innerHTML = html;
    toast("건강 프로필을 반영했어요");
    return;
  }

  // 2) 오늘 컨디션 점수 → 원하는 강도(0~3)
  const sc = (+$("s-sleep").value + +$("s-body").value + +$("s-pain").value + +$("s-will").value) / 4;
  const desired = sc<2 ? 0 : sc<3 ? 1 : sc<4 ? 2 : 3;

  // 3) 건강 프로필의 상한(cap) + 회복(과훈련) 상한으로 강도 제한
  const caps = results.map(r=>r.cap).filter(v=> v!=null && v>=0);
  const rec = assessRecovery();
  if(rec){ if(rec.cap!=null) caps.push(rec.cap); tips.unshift("💤 " + rec.tip); }
  let level = desired;
  if(caps.length) level = Math.min(level, Math.min(...caps));

  const m = RECO[level];
  let html = `<div class="reco ${m.cls}"><div class="lvl">${pick(m.titles)}</div><div class="desc">${pick(m.bodies)}`;
  if(level < desired) html += `<br><br>💡 ${pick(LOWNOTE)}`;
  html += `</div></div>`;
  html += tipsCard(tips);
  area.innerHTML = html;
  toast("오늘 추천을 새로 계산했어요");
}
$("btn-reco").onclick = computeReco;

/* ---------- 건강 프로필 모달 ---------- */
function renderProfile(){
  const prof = DB.health.profile || {};
  const groups = {};
  CONDITIONS.forEach(c => (groups[c.group] = groups[c.group] || []).push(c));

  let html = "";
  Object.keys(groups).forEach(g => {
    html += `<div class="cond-group">${g}</div>`;
    groups[g].forEach(c => {
      const on  = c.id in prof;
      const ans = prof[c.id] || {};
      html += `<div class="cond ${on?"on":""}" data-cond="${c.id}">
        <label class="chk">
          <input type="checkbox" data-toggle="${c.id}" ${on?"checked":""}>
          <span class="t">${c.label}</span>
          ${c.tag==="red" ? '<span class="tag red">상담 권고</span>' : ""}
        </label>
        <div class="cond-q" ${on?"":"hidden"}>
          ${c.q.map(q => `
            <div class="q">
              <div class="q-lab">${q.label}</div>
              <div class="seg-sm" data-q="${q.id}">
                ${q.opts.map(o => `<button type="button" data-v="${o.v}" class="${(ans[q.id]||q.opts[0].v)===o.v?"active":""}">${o.t}</button>`).join("")}
              </div>
            </div>`).join("")}
        </div>
      </div>`;
    });
  });
  $("disease-list").innerHTML = html;
}

// 세부 옵션 선택(세그먼트) — 이벤트 위임
$("disease-list").addEventListener("click", e => {
  const btn = e.target.closest(".seg-sm button");
  if(!btn) return;
  btn.parentElement.querySelectorAll("button").forEach(b=>b.classList.remove("active"));
  btn.classList.add("active");
});
// 질병 on/off 토글 — 문항 펼치기/접기
$("disease-list").addEventListener("change", e => {
  const tg = e.target.closest("input[data-toggle]");
  if(!tg) return;
  const cond = tg.closest(".cond"), q = cond.querySelector(".cond-q");
  cond.classList.toggle("on", tg.checked);
  if(q) q.hidden = !tg.checked;
});

$("fab-health").onclick = ()=>{ renderProfile(); $("modal-health").classList.add("open"); };
$("mh-close").onclick = ()=>$("modal-health").classList.remove("open");
$("modal-health").onclick = e => { if(e.target.id==="modal-health") $("modal-health").classList.remove("open"); };
$("btn-save-health").onclick = ()=>{
  const prof = {};
  document.querySelectorAll("#disease-list .cond").forEach(cond => {
    const tg = cond.querySelector("input[data-toggle]");
    if(!tg || !tg.checked) return;
    const ans = {};
    cond.querySelectorAll(".seg-sm").forEach(seg => {
      const act = seg.querySelector("button.active") || seg.querySelector("button");
      if(act) ans[seg.dataset.q] = act.dataset.v;
    });
    prof[cond.dataset.cond] = ans;
  });
  DB.health = { profile:prof };
  save(DB);
  $("modal-health").classList.remove("open");
  toast("건강 프로필 저장됨");
};
