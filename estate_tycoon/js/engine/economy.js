// estate_tycoon — 경제 로직 (레벨업·생산·판매·집 세금·대기열) + 추가 건설
"use strict";

function canAfford(cost) {
  for (const k in cost) if ((state.res[k] || 0) < cost[k]) return false;
  return true;
}
function pay(cost) { for (const k in cost) state.res[k] -= cost[k]; }

// 레벨업 비용: easyUntil(기본 10)레벨까지는 레벨마다 ×growth(완만),
// 그 뒤는 레벨마다 ×growthLate(가파름). growthLate 없으면 growth 그대로.
function costFor(type, level) {
  const c = bdef(type).cost;
  const easy = c.easyUntil != null ? c.easyUntil : 10;
  const g2 = c.growthLate || c.growth;
  const mult = Math.pow(c.growth, Math.min(level, easy) - 2) * Math.pow(g2, Math.max(0, level - easy));
  const out = {};
  for (const k in c.base) out[k] = Math.floor(c.base[k] * mult);
  return out;
}
// 대기열 칸 수 = queueUnlock 중 현재 레벨 이하인 항목 수
function capacityOf(type, level) {
  const q = bdef(type).queueUnlock || [];
  let n = 0;
  for (const lv of q) if (level >= lv) n++;
  return n;
}

function tryUpgrade(iid) {
  const b = byIid(iid);
  if (!b) return;
  const d = bdef(b.type);
  const next = b.level + 1;
  if (next > d.maxLevel) return toast("이미 최고 레벨");
  if (b.type !== "castle" && next > castleLevel()) return toast(`영주성 Lv.${next} 필요`);
  const cost = costFor(b.type, next);
  if (!canAfford(cost)) return toast("자원 부족");
  pay(cost);
  b.level = next;
  toast(`${d.name} Lv.${next} 달성!`);
  refreshPanel(); updateHud();
}

// 생산량 = 레시피 기본 × (1 + outBonus×(레벨-1))
function prodOut(type, level, rIdx) {
  const d = bdef(type);
  const out = {};
  for (const k in d.recipes[rIdx].out) {
    out[k] = Math.floor(d.recipes[rIdx].out[k] * (1 + (d.outBonus || 0) * (level - 1)));
  }
  return out;
}

// 생산 명령 → 대기열 뒤에 줄 세움 (투입 자원은 즉시 차감)
function enqueueRecipe(iid, rIdx) {
  const b = byIid(iid);
  if (!b || !isProd(b.type)) return;
  const rec = bdef(b.type).recipes[rIdx];
  if (b.level < (rec.unlock || 1)) return toast(`${bdef(b.type).name} Lv.${rec.unlock} 필요`);
  if (b.queue.length >= capacityOf(b.type, b.level)) return toast("대기열이 가득 찼다");
  if (rec.in) {
    if (!canAfford(rec.in)) return toast("투입 자원 부족");
    pay(rec.in);
  }
  b.queue.push({ r: rIdx, dur: rec.time, end: null });
  refreshPanel(); updateHud();
}

// 판매 견적
function sellQuote(res, qty) {
  const M = GAME_DATA.market;
  const mk = marketB();
  const lv = mk ? mk.level : 1;
  const bonus = 1 + (bdef("market").priceBonus || 0) * (lv - 1);
  const gold = Math.floor(qty * M.prices[res] * bonus);
  const time = Math.ceil(M.sellBase + gold * M.sellPerGold);
  return { gold, time };
}
// 판매 명령 → 시장 대기열 뒤에 줄 세움 (자원 즉시 차감)
function enqueueSell(res, qty) {
  const mk = marketB();
  if (!mk) return;
  if (mk.queue.length >= capacityOf("market", mk.level)) return toast("판매칸이 가득 찼다");
  qty = Math.max(1, Math.min(qty, Math.floor(state.res[res] || 0)));
  if (qty < 1) return toast("팔 자원이 없다");
  const q = sellQuote(res, qty);
  state.res[res] -= qty;
  mk.queue.push({ res, qty, gold: q.gold, dur: q.time, end: null });
  refreshPanel(); updateHud();
}

// 집 골드 속도·상한
function houseRate(b) {
  const h = bdef(b.type).house;
  return h.rate * (1 + h.rateBonus * (b.level - 1));
}
function houseCap(b) { return bdef(b.type).house.capPerLevel * b.level; }

// 💰 하나 누르면 모든 집 수거
function collectHouses() {
  let total = 0;
  for (const b of state.buildings) {
    if (!isHouse(b.type)) continue;
    const take = Math.floor(b.accum);
    total += take;
    b.accum -= take;
  }
  if (total > 0) {
    state.res.gold += total;
    toast(`세금 수거 +${fmtNum(total)} 🪙`);
    updateHud(); refreshPanel();
  }
}

// 대기열 진행: 맨 앞 것만 돌아가고, 끝나면 다음 것이 그 시각부터 이어서 시작 (오프라인도 정확)
function processQueues(now) {
  let changed = false;
  for (const b of state.buildings) {
    if (!b.queue.length) continue;
    if (b.queue[0].end == null) b.queue[0].end = now + b.queue[0].dur * 1000;
    while (b.queue.length && now >= b.queue[0].end) {
      const job = b.queue.shift();
      const doneT = job.end;
      if (b.type === "market") {
        state.res.gold += job.gold;
        toast(`판매 완료 +${fmtNum(job.gold)} 🪙`);
      } else {
        const out = prodOut(b.type, b.level, job.r);
        const parts = [];
        for (const k in out) { state.res[k] += out[k]; parts.push(`+${fmtNum(out[k])} ${GAME_DATA.resources[k].icon}`); }
        toast(parts.join("  "));
      }
      if (b.queue.length) b.queue[0].end = doneT + b.queue[0].dur * 1000;
      changed = true;
    }
  }
  if (changed) { updateHud(); refreshPanel(); }
}

// 매 틱: 집 골드 적립 + 대기열 진행
let lastEcoTs = Date.now();
function economyTick(now) {
  const dt = Math.max(0, (now - lastEcoTs) / 1000);
  lastEcoTs = now;
  for (const b of state.buildings) {
    if (!isHouse(b.type)) continue;
    b.accum = Math.min(houseCap(b), b.accum + houseRate(b) * dt);
  }
  processQueues(now);
}

/* ═══════════════ 건설 (추가 건물) ═══════════════ */
function initialCount(type) {
  return START.buildings.filter(s => s.type === type).length;
}
// extraBuilds의 i번째 항목 상태: "built" | "ready" | "levelLock" | "orderLock"
function buildStatus(i) {
  const e = GAME_DATA.extraBuilds[i];
  let ordinal = 0; // 같은 종류 중 몇 번째 허가인가
  for (let j = 0; j < i; j++) if (GAME_DATA.extraBuilds[j].type === e.type) ordinal++;
  const extra = byType(e.type).length - initialCount(e.type);
  if (ordinal < extra) return "built";
  if (ordinal > extra) return "orderLock";
  return castleLevel() >= e.castle ? "ready" : "levelLock";
}
function startBuild(i) {
  const e = GAME_DATA.extraBuilds[i];
  if (buildStatus(i) !== "ready") return toast("아직 지을 수 없다");
  if (!canAfford(e.cost)) return toast("자원 부족");
  if (!editMode) setEditMode(true); // 건설은 편집 모드에서
  moveMode = { iid: null, type: e.type, gx: 6, gy: 6, dir: "SE", cost: e.cost, buildIdx: i };
  closePanel();
  document.getElementById("move-ctl").classList.remove("hidden");
  updateMoveCtl(); updateEditUI();
  toast("놓을 자리를 탭해라");
}
