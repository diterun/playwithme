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
    // 골드·나무·석재는 항상, 나머지는 1개 이상 보유 시에만 표시
    const always = ["gold", "wood", "stone"];
    chips.innerHTML = Object.entries(GAME_DATA.resources)
      .filter(([k]) => always.includes(k) || (state.res[k] || 0) >= 1)
      .map(([k, r]) => `<div class="chip"><span class="ico">${r.icon}</span>${fmtNum(state.res[k] || 0)}</div>`).join("");
  }
  const lv = document.getElementById("castle-lv");
  if (lv) lv.textContent = `🏰 Lv.${castleLevel()}`;
}

/* ═══════════════ 패널 ═══════════════ */
let panelKind = null, panelArg = null;
const sellForm = { res: "wood", qty: 10 };

function tabOf(kind) { return kind === "building" ? "estate" : kind; }
function openPanel(kind, arg) {
  panelKind = kind; panelArg = arg;
  document.getElementById("panel").classList.remove("hidden");
  renderPanel();
  document.querySelectorAll("#tabbar .tab").forEach(t => {
    t.classList.toggle("active", t.dataset.tab === tabOf(kind));
  });
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
    if (tab === "estate") closePanel();
    else openPanel(tab);
  });
});

/* ── 패널 조각들 ── */
function upgradeCardHTML(b) {
  const d = bdef(b.type);
  const next = b.level + 1;
  if (next > d.maxLevel) {
    return `<div class="card"><div class="row"><div class="info"><div class="name">레벨업</div>
      <div class="desc">최고 레벨(${d.maxLevel}) 달성.</div></div></div></div>`;
  }
  const cost = costFor(b.type, next);
  const gated = b.type !== "castle" && next > castleLevel();
  const dis = gated || !canAfford(cost);
  return `<div class="card"><div class="row">
    <div class="info"><div class="name">Lv.${b.level} → Lv.${next}</div>
      <div class="cost">${fmtCost(cost)}</div>
      ${gated ? `<div class="desc">영주성 Lv.${next} 필요</div>` : ""}</div>
    <button class="btn" data-act="upgrade:${b.iid}" ${dis ? "disabled" : ""}>레벨업</button>
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
      ? `${GAME_DATA.resources[job.res].icon}×${fmtNum(job.qty)} → 🪙${fmtNum(job.gold)}`
      : (() => {
          const out = prodOut(b.type, b.level, job.r);
          const outStr = Object.entries(out).map(([k, v]) => `${GAME_DATA.resources[k].icon}${fmtNum(v)}`).join(" ");
          return `${esc(d.recipes[job.r].name)} ${outStr}`;
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
  return `<div class="recipebtns">${d.recipes.map((r, ri) => {
    const locked = b.level < (r.unlock || 1);
    const out = prodOut(b.type, b.level, ri);
    const outStr = Object.entries(out).map(([k, v]) => `${GAME_DATA.resources[k].icon}${fmtNum(v)}`).join(" ");
    const inStr = r.in ? Object.entries(r.in).map(([k, v]) => `${GAME_DATA.resources[k].icon}${fmtNum(v)}`).join(" ") + " → " : "";
    const noRes = r.in && !canAfford(r.in);
    if (locked) {
      return `<button class="btn" disabled><span>🔒 ${esc(r.name)}</span><span class="t">Lv.${r.unlock}</span></button>`;
    }
    return `<button class="btn" data-act="recipe:${b.iid}:${ri}" ${full || noRes ? "disabled" : ""}>
      <span>${inStr}${esc(r.name)} ${outStr}</span><span class="t">${fmtDur(r.time)}</span></button>`;
  }).join("")}</div>`;
}
function marketPanelHTML(now) {
  const mk = marketB();
  if (!mk) return "<div class='note'>시장이 없다</div>";
  const owned = Math.floor(state.res[sellForm.res] || 0);
  sellForm.qty = Math.max(1, Math.min(sellForm.qty, Math.max(owned, 1)));
  const q = sellQuote(sellForm.res, sellForm.qty);
  const full = mk.queue.length >= capacityOf("market", mk.level);
  const sellable = Object.keys(GAME_DATA.market.prices);
  let html = `<div class="note">${bdef("market").desc}</div>`;
  html += queueHTML(mk, now);
  html += `<div class="slot"><div class="slothead"><span>판매 명령</span><span class="tleft">보유 ${fmtNum(owned)}</span></div>
    <div class="sellform">
      <div class="pickrow">${sellable.map(rk =>
        `<button class="pick ${sellForm.res === rk ? "on" : ""}" data-act="sellres:${rk}">${GAME_DATA.resources[rk].icon} ${GAME_DATA.resources[rk].name}</button>`).join("")}</div>
      <div class="qtyrow">
        <button data-act="qty:-100">−100</button><button data-act="qty:-10">−10</button>
        <span class="amt">${fmtNum(sellForm.qty)}</span>
        <button data-act="qty:10">+10</button><button data-act="qty:100">+100</button>
      </div>
      <div class="pctrow">
        <button data-act="qtypct:25">25%</button><button data-act="qtypct:50">50%</button>
        <button data-act="qtypct:75">75%</button><button data-act="qtypct:100">최대</button>
      </div>
      <div class="sellinfo"><span>받는 골드 🪙${fmtNum(q.gold)}</span><span>판매 시간 ${fmtDur(q.time)}</span></div>
      <button class="btn wide" data-act="sell" ${owned < 1 || full ? "disabled" : ""}>${full ? "판매칸이 가득 참" : "판매 대기열에 추가"}</button>
    </div></div>`;
  html += upgradeCardHTML(mk) + editHintHTML();
  return html;
}
function buildPanelHTML() {
  let html = `<div class="card"><div class="row"><div class="bico">🌲</div>
    <div class="info"><div class="name">영지 확장 (개간)</div>
    <div class="desc">맵의 빽빽한 숲(4×4)을 탭하면 개간해서 건설 가능한 땅이 된다. 내 땅과 붙어 있는 숲만 가능.</div>
    <div class="cost">다음 개간 비용 ${fmtCost({ gold: landCost() })}</div></div></div></div>`;
  html += `<div class="note" style="margin-bottom:8px">영주성 레벨이 오르면 새 건설 허가가 열린다. 같은 종류는 위에서부터 순서대로.</div>`;
  GAME_DATA.extraBuilds.forEach((e, i) => {
    const d = bdef(e.type);
    const st = buildStatus(i);
    let right = "", desc = "";
    if (st === "built") { right = `<span class="tleft">✅ 건설됨</span>`; }
    else if (st === "ready") {
      right = `<button class="btn" data-act="build:${i}" ${canAfford(e.cost) ? "" : "disabled"}>짓기</button>`;
      desc = `<div class="cost">${fmtCost(e.cost)}</div>`;
    }
    else if (st === "levelLock") { right = `<span class="tleft">🔒 영주성 Lv.${e.castle}</span>`; }
    else { right = `<span class="tleft">🔒 이전 허가 먼저</span>`; }
    html += `<div class="card"><div class="row">
      <div class="bico">${d.icon}</div>
      <div class="info"><div class="name">${d.name}</div>${desc}</div>
      ${right}</div></div>`;
  });
  return html;
}
function housePanelHTML(b) {
  const h = bdef(b.type).house;
  const cap = houseCap(b);
  const pct = Math.min(100, 100 * b.accum / cap);
  return `<div class="slot"><div class="slothead"><span>모인 세금 🪙${fmtNum(b.accum)} / ${fmtNum(cap)}</span>
      <span class="tleft">+${(houseRate(b) * 60).toFixed(1)}/분</span></div>
    <div class="prog"><div style="width:${pct.toFixed(1)}%"></div></div>
    ${b.accum >= 1 ? `<button class="btn wide" data-act="collect">모든 집 세금 수거</button>` : ""}
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
    html = `<div class="reslist">${Object.entries(GAME_DATA.resources).map(([k, r]) =>
      `<div class="resrow"><span class="ico">${r.icon}</span><span class="nm">${r.name}</span><span class="amt">${fmtNum(state.res[k] || 0)}</span></div>`).join("")}</div>`;
  } else if (panelKind === "build") {
    title.textContent = "🏗️ 건설";
    html = buildPanelHTML();
  } else if (panelKind === "market") {
    const mk = marketB();
    title.textContent = `🛒 시장 Lv.${mk ? mk.level : "-"}`;
    html = marketPanelHTML(now);
  } else if (panelKind === "option") {
    title.textContent = "⚙️ 옵션";
    html = saveTabHTML();
  } else if (panelKind === "building") {
    const b = byIid(panelArg);
    if (!b) { closePanel(); return; }
    const d = bdef(b.type);
    title.textContent = `${d.icon} ${d.name} Lv.${b.level}`;
    if (b.type === "market") {
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
    case "recipe": enqueueRecipe(+p[1], +p[2]); break;
    case "sellres": sellForm.res = p[1]; refreshPanel(); break;
    case "qty": {
      const owned = Math.max(1, Math.floor(state.res[sellForm.res] || 0));
      sellForm.qty = Math.max(1, Math.min(owned, sellForm.qty + parseInt(p[1], 10)));
      refreshPanel(); break;
    }
    case "qtypct": {
      const owned = Math.floor(state.res[sellForm.res] || 0);
      sellForm.qty = Math.max(1, Math.floor(owned * (+p[1]) / 100));
      refreshPanel(); break;
    }
    case "sell": enqueueSell(sellForm.res, sellForm.qty); break;
    case "collect": collectHouses(); break;
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
        setEditMode(false); closePanel(); updateHud();
        toast("초기화 완료 — 새 영지 시작");
      }
      break;
  }
}
