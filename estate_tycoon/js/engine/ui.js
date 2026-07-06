// estate_tycoon — UI (숫자·시간 표시, 토스트, HUD, 패널, 버튼 동작)
"use strict";

/* ═══════════════ UI 헬퍼 ═══════════════ */
function fmtNum(n) { return Math.floor(n).toLocaleString("ko-KR"); }
function fmtDur(sec) {
  sec = Math.max(0, Math.ceil(sec));
  const h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), s = sec % 60;
  if (h) return m ? `${h}시간 ${m}분` : `${h}시간`;
  if (m) return s ? `${m}분 ${s}초` : `${m}분`;
  return `${s}초`;
}
function fmtCost(cost) {
  return Object.entries(cost).map(([k, v]) => {
    const ok = (state.res[k] || 0) >= v;
    return `<span class="${ok ? "" : "no"}">${GAME_DATA.resources[k].icon}${fmtNum(v)}</span>`;
  }).join(" ");
}
function esc(s) { return String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }

let toastTimer = null;
function toast(msg) {
  const el = document.getElementById("toast");
  if (!el) return;
  el.textContent = msg;
  el.classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add("hidden"), 1800);
}

function updateHud() {
  const chips = document.getElementById("res-chips");
  if (chips) {
    // 메인 화면 상단에는 골드만 (나머지 자원은 📦 자원 탭에서 1/2/3차로 확인)
    const g = GAME_DATA.resources.gold;
    chips.innerHTML = `<div class="chip"><span class="ico">${g.icon}</span>${fmtNum(state.res.gold || 0)}</div>`;
  }
}

/* ═══════════════ 패널 ═══════════════ */
let panelKind = null, panelArg = null;
let resTabIdx = 0;   // 📦 자원 탭의 현재 1/2/3차 서브탭
const sellForm = { res: "wood", qty: 10, tab: 0, mode: "sell" };
// 현재 모드에서 거래 가능한 최대 수량 (매도=보유량 / 매수=골드로 살 수 있는 만큼)
function tradeMax() {
  const res = sellForm.res;
  if ((sellForm.mode || "sell") === "buy") {
    const unit = unitPrice(res) * spreadFor(res).buy;
    return Math.max(0, Math.floor((state.res.gold || 0) / Math.max(1, unit)));
  }
  return Math.floor(state.res[res] || 0);
}
// 판매 탭 목록 (data.js 에 있으면 사용, 없으면 전체를 한 탭으로)
function sellTabs() {
  const t = GAME_DATA.market.tabs;
  if (t && t.length) return t.map(tb => ({ name: tb.name, items: tb.items.filter(k => k in GAME_DATA.market.prices) }));
  return [{ name: "전체", items: Object.keys(GAME_DATA.market.prices) }];
}

function tabOf(kind) { return kind === "building" ? "estate" : kind; }
function openPanel(kind, arg) {
  panelKind = kind; panelArg = arg;
  document.getElementById("panel").classList.remove("hidden");
  renderPanel();
  document.querySelectorAll("#tabbar .tab").forEach(t => {
    t.classList.toggle("active", t.dataset.tab === tabOf(kind));
  });
  if (typeof tutorialOnPanel === "function") tutorialOnPanel(kind, arg);
}
function closePanel() {
  panelKind = null; panelArg = null;
  document.getElementById("panel").classList.add("hidden");
  document.querySelectorAll("#tabbar .tab").forEach(t => t.classList.toggle("active", t.dataset.tab === "estate"));
}
function refreshPanel() { if (panelKind) renderPanel(); }

document.getElementById("panel-close").addEventListener("click", closePanel);
document.querySelectorAll("#tabbar .tab").forEach(t => {
  t.addEventListener("click", () => {
    const tab = t.dataset.tab;
    // 영지 = 항상 닫기. 나머지는 토글: 이미 열려 있는 탭을 다시 누르면 내려간다.
    if (tab === "estate") closePanel();
    else if (panelKind && tabOf(panelKind) === tab) closePanel();
    else openPanel(tab);
  });
});
// 옵션은 하단 오른쪽 버튼 → 중앙 모달 창 (하단 시트 패널 아님)
document.getElementById("option-btn").addEventListener("click", () => openOptions());

/* ── 패널 조각들 ── */
function upgradeCardHTML(b) {
  const d = bdef(b.type);
  // 건축(신축·레벨업) 진행 중이면 진행바/대기 표시
  const job = constructionJobFor(b.iid);
  if (job || b.constructing) {
    const now = Date.now();
    const kindTxt = (job && job.kind === "upgrade")
      ? `Lv.${b.level} → Lv.${job.toLevel} 건축`
      : "건설";
    if (job && job.end != null) {
      const left = (job.end - now) / 1000;
      const pct = Math.min(100, 100 * (1 - left / job.dur));
      return `<div class="card"><div class="slot">
        <div class="slothead"><span>🔨 ${kindTxt} 중</span><span class="tleft">${fmtDur(left)}</span></div>
        <div class="prog"><div style="width:${Math.max(0, pct).toFixed(1)}%"></div></div></div></div>`;
    }
    return `<div class="card"><div class="slot">
      <div class="slothead"><span>🔨 ${kindTxt} 대기</span><span class="tleft">건축반 기다림 (${fmtDur(job ? job.dur : buildTimeFor(b.type, 1))})</span></div>
      <div class="note">동시 건축 ${constructionSlots()}칸이 다 찼다. 앞 건축이 끝나면 착공한다.</div></div></div>`;
  }
  const next = b.level + 1;
  if (next > d.maxLevel) {
    return `<div class="card"><div class="row"><div class="info"><div class="name">레벨업</div>
      <div class="desc">최고 레벨(${d.maxLevel}) 달성.</div></div></div></div>`;
  }
  const cost = costFor(b.type, next);
  const gated = b.type !== "castle" && next > castleLevel();
  const dis = gated || !canAfford(cost);
  const time = buildTimeFor(b.type, next);
  const free = activeConstructionCount() < constructionSlots();
  return `<div class="card"><div class="row">
    <div class="info"><div class="name">Lv.${b.level} → Lv.${next}</div>
      <div class="cost">${fmtCost(cost)}</div>
      <div class="desc">🔨 건축 시간 ${fmtDur(time)}${free ? "" : " · 건축반 가득(대기열로)"}</div>
      ${gated ? `<div class="desc">영주성 Lv.${next} 필요</div>` : ""}</div>
    <button class="btn" data-act="upgrade:${b.iid}" ${dis ? "disabled" : ""}>${gated ? "레벨업" : "🔨 건축"}</button>
  </div></div>`;
}
// 이동·회전은 편집 모드에서만 — 패널에는 안내만 남긴다
function editHintHTML() {
  return `<div class="note" style="margin-top:6px">🔧 이동·회전은 왼쪽 위 [편집] 버튼 (건물을 길게 눌러도 된다)</div>`;
}
// 대기열 표시 (생산·판매 공용)
function queueHTML(b, now) {
  const cap = capacityOf(b.type, b.level);
  const d = bdef(b.type);
  let html = "";
  for (let i = 0; i < Math.max(cap, b.queue.length); i++) {
    const job = b.queue[i];
    if (!job) {
      html += `<div class="slot"><div class="slothead"><span>${b.type === "market" ? "판매칸" : "생산칸"} ${i + 1}</span><span class="tleft">비어 있음</span></div></div>`;
      continue;
    }
    const label = b.type === "market"
      ? (job.buy
          ? `🪙${fmtNum(job.gold)} → ${GAME_DATA.resources[job.res].icon}×${fmtNum(job.qty)}`
          : `${GAME_DATA.resources[job.res].icon}×${fmtNum(job.qty)} → 🪙${fmtNum(job.gold)}`)
      : (() => {
          const out = prodOut(b.type, b.level, job.r, job.tier);
          const outStr = Object.entries(out).map(([k, v]) => `${GAME_DATA.resources[k].icon}${fmtNum(v)}`).join(" ");
          const tn = tierDef(job.tier).name;
          return `${esc(d.recipes[job.r].name)}${tn ? `(${tn})` : ""} ${outStr}`;
        })();
    if (i === 0 && job.end != null) {
      const left = (job.end - now) / 1000;
      const pct = Math.min(100, 100 * (1 - left / job.dur));
      html += `<div class="slot"><div class="slothead"><span>${label}</span><span class="tleft">${fmtDur(left)}</span></div>
        <div class="prog"><div style="width:${Math.max(0, pct).toFixed(1)}%"></div></div></div>`;
    } else {
      html += `<div class="slot"><div class="slothead"><span>${label}</span><span class="tleft">대기 중 (${fmtDur(job.dur)})</span></div></div>`;
    }
  }
  // 다음 칸이 열리는 레벨 안내
  const q = d.queueUnlock || [];
  if (cap < q.length) html += `<div class="note" style="margin-top:6px">다음 칸: Lv.${q[cap]}에 열림</div>`;
  return html;
}
function recipeButtonsHTML(b) {
  const d = bdef(b.type);
  const full = b.queue.length >= capacityOf(b.type, b.level);
  return d.recipes.map((r, ri) => {
    const locked = b.level < (r.unlock || 1);
    const outIcons = Object.keys(r.out).map(k => GAME_DATA.resources[k].icon).join("");
    if (locked) {
      return `<div class="recipe locked"><div class="rname"><span>🔒 ${outIcons} ${esc(r.name)}</span>
        <span class="t">Lv.${r.unlock}에 열림</span></div></div>`;
    }
    // 단계별 버튼 (소·중·대). 각 버튼에 산출·시간 표시.
    const tiers = recipeTiers(r).map(tk => {
      const inn = scaledIn(r, tk);
      const out = prodOut(b.type, b.level, ri, tk);
      const outStr = Object.entries(out).map(([k, v]) => `${GAME_DATA.resources[k].icon}${fmtNum(v)}`).join(" ");
      const noRes = inn && !canAfford(inn);
      const tn = tierDef(tk).name;
      return `<button class="tbtn" data-act="recipe:${b.iid}:${ri}:${tk}" ${full || noRes ? "disabled" : ""}>
        <span class="tt">${tn}</span><span class="to">${outStr}</span><span class="td">${fmtDur(scaledTime(r, tk))}</span></button>`;
    }).join("");
    // 재료: 이모티콘(이름)×수량 칩. 길면 다음 줄로 넘어간다(모바일 배려). 수량은 소량 기준(중·대량은 배율만큼).
    const matsHTML = r.in
      ? Object.entries(r.in).map(([k, v]) => `<span class="mat">${GAME_DATA.resources[k].icon}(${esc(GAME_DATA.resources[k].name)})×${fmtNum(v)}</span>`).join("")
        + `<span class="mat hint">소량 기준</span>`
      : `<span class="mat none">원재료 없음</span>`;
    return `<div class="recipe"><div class="rname"><span>${outIcons} ${esc(r.name)}</span></div>
      <div class="rmats">${matsHTML}</div>
      <div class="tierbtns">${tiers}</div></div>`;
  }).join("");
}
// 시세 그래프(최근 histLen시간). 기록이 모자라면 과거를 합성해 채운다.
function priceGraphHTML(res) {
  const h = priceHistory(res);
  const w = 300, ht = 56, pad = 6;
  const min = Math.min(...h), max = Math.max(...h);
  const rng = (max - min) || (max * 0.1) || 1;
  const X = i => pad + i * (w - 2 * pad) / (h.length - 1);
  const Y = v => pad + (ht - 2 * pad) * (1 - (v - min) / rng);
  const pts = h.map((v, i) => `${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join(" ");
  const up = h[h.length - 1] >= h[0];
  const stroke = up ? "#6fcf7f" : "#e06a6a";
  const baseY = (min <= 1 && 1 <= max) ? Y(1).toFixed(1) : null;  // 기준가(×1.0) 선
  const pct = Math.round((h[h.length - 1] / h[0] - 1) * 100);
  return `<div class="pgraphwrap">
    <svg viewBox="0 0 ${w} ${ht}" preserveAspectRatio="none" class="pgraph">
      ${baseY ? `<line x1="0" y1="${baseY}" x2="${w}" y2="${baseY}" style="stroke:#4a5878;stroke-width:1;stroke-dasharray:3 3"/>` : ""}
      <polyline points="${pts}" style="fill:none;stroke:${stroke};stroke-width:2;stroke-linejoin:round"/>
    </svg>
    <div class="pglabel">최근 ${h.length}시간 ${pct >= 0 ? "+" : ""}${pct}% <span class="${up ? "up" : "down"}">${up ? "▲" : "▼"}</span></div>
  </div>`;
}
function marketPanelHTML(now) {
  const mk = marketB();
  if (!mk) return "<div class='note'>시장이 없다</div>";
  const dyn = GAME_DATA.market.dynamic || {};
  const mode = sellForm.mode === "buy" ? "buy" : "sell";
  // 탭(1차/2차/3차) — 현재 탭 밖의 품목이 선택돼 있으면 그 탭의 첫 품목으로 맞춘다
  const tabs = sellTabs();
  sellForm.tab = Math.max(0, Math.min(sellForm.tab, tabs.length - 1));
  const curItems = tabs[sellForm.tab].items;
  if (!curItems.includes(sellForm.res)) sellForm.res = curItems[0];
  const res = sellForm.res;
  const producible = canProduce(res);
  const spread = spreadFor(res);
  const full = mk.queue.length >= capacityOf("market", mk.level);
  const unitDisp = rk => Math.floor(unitPrice(rk));
  const trend = rk => { const m = priceMultOf(rk); return m > 1.03 ? `<span class="up">▲</span>` : m < 0.97 ? `<span class="down">▼</span>` : ``; };
  // 거래 가능 최대 수량 (매도=보유량, 매수=살 수 있는 만큼)
  const owned = Math.floor(state.res[res] || 0);
  const buyUnit = unitPrice(res) * spread.buy;
  const maxAfford = Math.floor((state.res.gold || 0) / Math.max(1, buyUnit));
  const tmax = mode === "buy" ? maxAfford : owned;
  sellForm.qty = Math.max(1, Math.min(sellForm.qty, Math.max(tmax, 1)));
  const sq = sellQuote(res, sellForm.qty), bq = buyQuote(res, sellForm.qty);

  let html = `<div class="note">${bdef("market").desc} 시세가 시간마다 오르내린다(▲/▼). 생산 가능한 품목만 거래된다. 시장 레벨↑ → 스프레드 개선(현재 이 품목: 매수 ×${spread.buy.toFixed(2)} / 매도 ×${spread.sell.toFixed(2)}).</div>`;
  html += queueHTML(mk, now);
  html += `<div class="slot">
    <div class="modetoggle">
      <button class="mtog ${mode === "sell" ? "on" : ""}" data-act="trademode:sell">📤 매도</button>
      <button class="mtog buy ${mode === "buy" ? "on" : ""}" data-act="trademode:buy">📥 매수</button>
    </div>
    <div class="sellform">
      <div class="subtabs">${tabs.map((tb, ti) =>
        `<button class="subtab ${sellForm.tab === ti ? "on" : ""}" data-act="selltab:${ti}">${tb.name}</button>`).join("")}</div>
      <div class="pickrow">${curItems.map(rk =>
        `<button class="pick ${res === rk ? "on" : ""} ${canProduce(rk) ? "" : "cantmake"}" data-act="sellres:${rk}">${GAME_DATA.resources[rk].icon} ${GAME_DATA.resources[rk].name}<span class="pprice">🪙${fmtNum(unitDisp(rk))}${trend(rk)}</span></button>`).join("")}</div>
      <div class="psel"><span class="pname">${GAME_DATA.resources[res].icon} ${GAME_DATA.resources[res].name}</span>
        <span class="pnow">기준 🪙${fmtNum(unitDisp(res))} · 매수 🪙${fmtNum(Math.ceil(buyUnit))} · 매도 🪙${fmtNum(Math.floor(unitPrice(res) * spread.sell))}</span></div>
      ${priceGraphHTML(res)}`;
  if (!producible) {
    html += `<div class="note" style="margin-top:8px">🔒 이 품목을 생산할 수 있는 건물이 없어 <b>거래할 수 없다</b>. 시세만 열람할 수 있다.</div>`;
  } else {
    html += `
      <div class="slothead" style="margin-top:8px"><span>${mode === "buy" ? "매수 명령" : "매도 명령"}</span><span class="tleft">${mode === "buy" ? `보유 🪙${fmtNum(Math.floor(state.res.gold || 0))}` : `보유 ${fmtNum(owned)}`}</span></div>
      <div class="qtyrow">
        <button data-act="qty:-100">−100</button><button data-act="qty:-10">−10</button>
        <span class="amt">${fmtNum(sellForm.qty)}</span>
        <button data-act="qty:10">+10</button><button data-act="qty:100">+100</button>
      </div>
      <div class="pctrow">
        <button data-act="qtypct:25">25%</button><button data-act="qtypct:50">50%</button>
        <button data-act="qtypct:75">75%</button><button data-act="qtypct:100">최대</button>
      </div>`;
    if (mode === "buy") {
      html += `<div class="sellinfo"><span>드는 골드 🪙${fmtNum(bq.gold)}</span><span>입고 시간 ${fmtDur(bq.time)}</span></div>
        <button class="btn wide alt" data-act="buy" ${maxAfford < 1 || full ? "disabled" : ""}>${full ? "시장 대기열이 가득 참" : "매수 대기열에 추가"}</button>`;
    } else {
      html += `<div class="sellinfo"><span>받는 골드 🪙${fmtNum(sq.gold)}</span><span>판매 시간 ${fmtDur(sq.time)}</span></div>
        <button class="btn wide" data-act="sell" ${owned < 1 || full ? "disabled" : ""}>${full ? "시장 대기열이 가득 참" : "매도 대기열에 추가"}</button>`;
    }
  }
  html += `</div></div>`;
  html += upgradeCardHTML(mk) + editHintHTML();
  return html;
}
function buildPanelHTML() {
  let html = `<div class="card"><div class="row"><div class="bico">🌲</div>
    <div class="info"><div class="name">영지 확장 (개간)</div>
    <div class="desc">맵의 빽빽한 숲(4×4)을 탭하면 개간해서 건설 가능한 땅이 된다. 내 땅과 붙어 있는 숲만 가능.</div>
    <div class="cost">다음 개간 비용 ${fmtCost({ gold: landCost() })}</div></div></div></div>`;
  // 동시 건축(건축반) 현황
  const slots = constructionSlots(), busy = activeConstructionCount();
  const waiting = (state.construction || []).filter(j => j.end == null).length;
  html += `<div class="note" style="margin-bottom:8px">🔨 건축반 ${busy}/${slots} 가동${waiting ? ` · 대기 ${waiting}` : ""} — 신축·레벨업 모두 시간이 든다(노움이 짓는다).
    영주성 Lv.10·20·30에 건축반이 1칸씩 늘어난다. 영주성 레벨이 오르면 새 건설 허가도 열린다.</div>`;
  // 정렬: 작은집 → 큰집 → 생산시설. "이전 허가 먼저"(orderLock)인 항목은 숨긴다.
  const cat = t => (t === "house_small" ? 0 : t === "house_big" ? 1 : 2);
  const list = GAME_DATA.extraBuilds
    .map((e, i) => ({ e, i, st: buildStatus(i) }))
    .filter(x => x.st !== "orderLock")
    .sort((a, b) => cat(a.e.type) - cat(b.e.type) || a.i - b.i);
  for (const { e, i, st } of list) {
    const d = bdef(e.type);
    let right = "", desc = "";
    if (st === "built") { right = `<span class="tleft">✅ 건설됨</span>`; }
    else if (st === "ready") {
      right = `<button class="btn" data-act="build:${i}" ${canAfford(e.cost) ? "" : "disabled"}>짓기</button>`;
      desc = `<div class="cost">${fmtCost(e.cost)}</div><div class="desc">🔨 건축 시간 ${fmtDur(buildTimeFor(e.type, 1))}</div>`;
    }
    else if (st === "levelLock") { right = `<span class="tleft">🔒 영주성 Lv.${e.castle}</span>`; }
    html += `<div class="card"><div class="row">
      <div class="bico">${d.icon}</div>
      <div class="info"><div class="name">${d.name}</div>${desc}</div>
      ${right}</div></div>`;
  }
  return html;
}
function housePanelHTML(b) {
  const h = bdef(b.type).house;
  const cap = houseCap(b);
  const pct = Math.min(100, 100 * b.accum / cap);
  const dem = houseDemand(b);
  const fed = b.fed || 0;
  const effRate = houseRate(b) * (dem ? (1 + dem.boost * fed) : 1);
  let demHTML = "";
  if (dem) {
    const r = GAME_DATA.resources[dem.item];
    const have = Math.floor(state.res[dem.item] || 0);
    const fedTxt = have > 0 ? `공급 중 (세금 ×${(1 + dem.boost * fed).toFixed(1)})` : `재고 없음 — 기본 세금`;
    demHTML = `<div class="note" style="margin-top:6px">🍽️ 주민 소비 ${r.icon}${r.name} (보유 ${fmtNum(have)}) — ${fedTxt}.
      가득 공급하면 세금 최대 ×${(1 + dem.boost).toFixed(1)}.</div>`;
  } else {
    const next = (h.demand || []).find(d => d.from > b.level);
    if (next) demHTML = `<div class="note" style="margin-top:6px">Lv.${next.from}부터 ${GAME_DATA.resources[next.item].icon}${GAME_DATA.resources[next.item].name} 소비 → 세금 보너스.</div>`;
  }
  return `<div class="slot"><div class="slothead"><span>모인 세금 🪙${fmtNum(b.accum)} / ${fmtNum(cap)}</span>
      <span class="tleft">+${(effRate * 60).toFixed(1)}/분</span></div>
    <div class="prog"><div style="width:${pct.toFixed(1)}%"></div></div>
    ${b.accum >= 1 ? `<button class="btn wide" data-act="collect">모든 집 세금 수거</button>` : ""}
    ${demHTML}
    <div class="note" style="margin-top:6px">상한에 닿으면 수거 전까지 더 안 쌓인다. 💰 표시는 ${fmtNum(h.showAt)}골드부터.</div></div>`;
}

function renderPanel() {
  const body = document.getElementById("panel-body");
  const title = document.getElementById("panel-title");
  const scroll = body.scrollTop;
  const now = Date.now();
  let html = "";

  if (panelKind === "res") {
    title.textContent = "📦 자원";
    // 1/2/3차 탭 (market.tabs 그대로 사용 — 골드는 여기 없어 자동 제외). 각 탭의 자원만 나열.
    const tabs = GAME_DATA.market.tabs || [{ name: "전체", items: Object.keys(GAME_DATA.resources).filter(k => k !== "gold") }];
    resTabIdx = Math.max(0, Math.min(resTabIdx, tabs.length - 1));
    const items = tabs[resTabIdx].items;
    html = `<div class="subtabs">${tabs.map((tb, ti) =>
      `<button class="subtab ${resTabIdx === ti ? "on" : ""}" data-act="restab:${ti}">${tb.name}</button>`).join("")}</div>`;
    html += `<div class="reslist">${items.map(k => {
      const r = GAME_DATA.resources[k];
      return `<div class="resrow"><span class="ico">${r.icon}</span><span class="nm">${r.name}</span><span class="amt">${fmtNum(state.res[k] || 0)}</span></div>`;
    }).join("")}</div>`;
  } else if (panelKind === "build") {
    title.textContent = "🏗️ 건설";
    html = buildPanelHTML();
  } else if (panelKind === "market") {
    const mk = marketB();
    title.textContent = `🛒 시장 Lv.${mk ? mk.level : "-"}`;
    html = marketPanelHTML(now);
  } else if (panelKind === "save") {
    title.textContent = "💾 저장";
    html = saveTabHTML();
  } else if (panelKind === "building") {
    const b = byIid(panelArg);
    if (!b) { closePanel(); return; }
    const d = bdef(b.type);
    title.textContent = `${d.icon} ${d.name} Lv.${b.level}`;
    if (b.constructing) {
      // 신축 공사판(0레벨) — 생산·세금 UI 대신 건축 현황만
      title.textContent = `${d.icon} ${d.name} (건설 중)`;
      html = `<div class="note">${d.desc}</div>` + upgradeCardHTML(b) + editHintHTML();
    } else if (b.type === "market") {
      html = marketPanelHTML(now);
    } else {
      html = `<div class="note">${d.desc}</div>`;
      if (isProd(b.type)) html += queueHTML(b, now) + recipeButtonsHTML(b);
      if (isHouse(b.type)) html += housePanelHTML(b);
      html += upgradeCardHTML(b) + editHintHTML();
    }
  }

  body.innerHTML = html;
  body.scrollTop = scroll;
  body.querySelectorAll("[data-act]").forEach(el => {
    el.addEventListener("click", () => handleAct(el.dataset.act));
  });
}

function handleAct(act) {
  const p = act.split(":");
  switch (p[0]) {
    case "upgrade": tryUpgrade(+p[1]); break;
    case "recipe": enqueueRecipe(+p[1], +p[2], p[3]); break;
    case "restab": resTabIdx = +p[1]; refreshPanel(); break;
    case "hitbox": setHitBox(!hitBoxEnabled()); break;
    case "selltab": {
      sellForm.tab = +p[1];
      const items = sellTabs()[sellForm.tab].items;
      if (!items.includes(sellForm.res)) sellForm.res = items[0];
      refreshPanel(); break;
    }
    case "trademode": sellForm.mode = p[1] === "buy" ? "buy" : "sell"; sellForm.qty = 1; refreshPanel(); break;
    case "sellres": sellForm.res = p[1]; refreshPanel(); break;
    case "qty": {
      const mx = Math.max(1, tradeMax());
      sellForm.qty = Math.max(1, Math.min(mx, sellForm.qty + parseInt(p[1], 10)));
      refreshPanel(); break;
    }
    case "qtypct": {
      sellForm.qty = Math.max(1, Math.floor(tradeMax() * (+p[1]) / 100));
      refreshPanel(); break;
    }
    case "sell": enqueueSell(sellForm.res, sellForm.qty); break;
    case "buy": enqueueBuy(sellForm.res, sellForm.qty); break;
    case "collect": collectHouses(); break;
    case "bgm": setBgm(!bgmEnabled()); break;
    case "build": startBuild(+p[1]); break;
    case "saveslot": saveToSlot(p[1]); break;
    case "loadslot": loadFromSlot(p[1]); break;
    case "export": exportFile(); break;
    case "import": document.getElementById("import-file").click(); break;
    case "standalone": exportStandalone(); break;
    case "reset":
      if (confirm("게임을 처음부터 다시 시작한다. 저장 슬롯과 내보낸 파일은 그대로 남는다. 진행할까?")) {
        state = freshState();
        syncLand();
        groundDirty = true;  // 칠한 지형도 처음 땅으로 되돌아가게 바닥 다시 그림
        lastEcoTs = Date.now();
        setEditMode(false); closePanel();
        if (typeof closeOptions === "function") closeOptions();   // 옵션 창에서 눌렀으면 닫기
        updateHud();
        if (typeof clearTut === "function") { clearTut(); tutorialBoot(); }  // 새 영지 → 튜토리얼도 처음부터
        toast("초기화 완료 — 새 영지 시작");
      }
      break;
  }
}
