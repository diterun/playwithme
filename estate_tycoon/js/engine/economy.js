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

/* ── 생산량 단계(소·중·대) ── */
const TIER_ORDER = ["small", "medium", "large"];
// 이 레시피가 낼 수 있는 단계 목록 (tiers:3 → 소·중·대, 2 → 소·중, 생략 → 단일 소량)
function recipeTiers(rec) {
  const n = Math.max(1, rec.tiers || 1);
  return TIER_ORDER.slice(0, n);
}
function tierDef(key) { return GAME_DATA.tiers[key] || { name: "", outMul: 1, timeMul: 1 }; }
// 단계별 투입 자원 (소량 in × outMul)
function scaledIn(rec, tierKey) {
  if (!rec.in) return null;
  const mul = tierDef(tierKey).outMul;
  const out = {};
  for (const k in rec.in) out[k] = rec.in[k] * mul;
  return out;
}
// 단계별 소요 시간 (초)
function scaledTime(rec, tierKey) { return Math.max(1, Math.round(rec.time * tierDef(tierKey).timeMul)); }

/* ── 건축(신축·레벨업 공통) ── */
// 건축 시간(초): 건물 buildBase × growth^(목표레벨-1). 레벨이 높을수록 지수로 길어진다.
function buildTimeFor(type, toLevel) {
  const c = GAME_DATA.construction || {};
  const d = bdef(type) || {};
  const base = d.buildBase != null ? d.buildBase : (c.baseDefault || 60);
  const growth = d.buildGrowth != null ? d.buildGrowth : (c.growth || 1.13);
  return Math.max(1, Math.round(base * Math.pow(growth, Math.max(0, (toLevel || 1) - 1))));
}
// 동시 건축 슬롯 수 = baseSlots + (영주성이 slotAt 임계값을 넘긴 개수)
function constructionSlots() {
  const c = GAME_DATA.construction || { baseSlots: 2, slotAt: [] };
  let n = c.baseSlots || 2;
  const cl = castleLevel();
  for (const lv of (c.slotAt || [])) if (cl >= lv) n++;
  return n;
}
function ensureConstruction() { if (!Array.isArray(state.construction)) state.construction = []; }
function activeConstructionCount() { ensureConstruction(); return state.construction.filter(j => j.end != null).length; }
function constructionJobFor(iid) { ensureConstruction(); return state.construction.find(j => j.iid === iid) || null; }
// 건축 작업을 줄에 올린다(비용은 호출부에서 이미 지불). 빈 슬롯이 있으면 processConstruction 이 곧 시작시킨다.
function enqueueConstruction(iid, kind, toLevel) {
  ensureConstruction();
  const b = byIid(iid);
  if (!b) return;
  state.construction.push({ iid, kind, toLevel, dur: buildTimeFor(b.type, toLevel), end: null });
}

function tryUpgrade(iid) {
  const b = byIid(iid);
  if (!b) return;
  const d = bdef(b.type);
  if (b.constructing) return toast("아직 짓는 중이다");
  if (constructionJobFor(iid)) return toast("이미 건축 중이다");
  const next = b.level + 1;
  if (next > d.maxLevel) return toast("이미 최고 레벨");
  if (b.type !== "castle" && next > castleLevel()) return toast(`영주성 Lv.${next} 필요`);
  const cost = costFor(b.type, next);
  if (!canAfford(cost)) return toast("자원 부족");
  pay(cost);
  enqueueConstruction(iid, "upgrade", next);
  processConstruction(Date.now());  // 빈 슬롯이 있으면 즉시 착공
  const started = constructionJobFor(iid) && constructionJobFor(iid).end != null;
  toast(started ? `${d.name} 건축 시작 (Lv.${next})` : `${d.name} 건축 대기열에 추가 (건축반 가득 참)`);
  refreshPanel(); updateHud();
}

// 진행 중 건축 처리: 완료된 것 반영 → 빈 슬롯에 대기 작업 착공(오프라인 연쇄도 시각 순서대로 정확히)
function processConstruction(now) {
  ensureConstruction();
  let changed = false;
  // 사라진 건물(보관·삭제)의 작업은 버린다
  for (let i = state.construction.length - 1; i >= 0; i--) {
    if (!byIid(state.construction[i].iid)) { state.construction.splice(i, 1); changed = true; }
  }
  // 빈 슬롯에 대기 작업 착공 (착공 시각 t 기준)
  const startWaiting = (t) => {
    const slots = constructionSlots();
    for (const j of state.construction) {
      if (state.construction.filter(x => x.end != null).length >= slots) break;
      if (j.end == null) { j.end = t + j.dur * 1000; changed = true; }
    }
  };
  startWaiting(now);
  // 완료를 시각 순으로 처리하고, 그때마다 빈 슬롯을 다시 채운다(오프라인 따라잡기)
  for (let guard = 0; guard < 10000; guard++) {
    let next = null;
    for (const j of state.construction) if (j.end != null && j.end <= now && (!next || j.end < next.end)) next = j;
    if (!next) break;
    const b = byIid(next.iid);
    const t = next.end;
    if (b) {
      if (next.kind === "build") { b.level = 1; b.constructing = false; toast(`🏗️ ${bdef(b.type).name} 건설 완료!`); }
      else { b.level = Math.min(bdef(b.type).maxLevel, next.toLevel); toast(`🏗️ ${bdef(b.type).name} Lv.${b.level} 건축 완료!`); }
    }
    state.construction.splice(state.construction.indexOf(next), 1);
    changed = true;
    startWaiting(t);
  }
  if (changed) { updateHud(); refreshPanel(); }
}

// 생산량 = 레시피 기본 × 단계배율(outMul) × (1 + outBonus×(레벨-1))
function prodOut(type, level, rIdx, tierKey) {
  const d = bdef(type);
  const mul = tierDef(tierKey).outMul * (1 + (d.outBonus || 0) * (level - 1));
  const out = {};
  for (const k in d.recipes[rIdx].out) {
    out[k] = Math.floor(d.recipes[rIdx].out[k] * mul);
  }
  return out;
}

// 생산 명령 → 대기열 뒤에 줄 세움 (투입 자원은 즉시 차감). tierKey = "small"|"medium"|"large"
function enqueueRecipe(iid, rIdx, tierKey) {
  const b = byIid(iid);
  if (!b || !isProd(b.type)) return;
  const rec = bdef(b.type).recipes[rIdx];
  if (b.level < (rec.unlock || 1)) return toast(`${bdef(b.type).name} Lv.${rec.unlock} 필요`);
  if (b.queue.length >= capacityOf(b.type, b.level)) return toast("대기열이 가득 찼다");
  const tk = recipeTiers(rec).includes(tierKey) ? tierKey : "small";
  const inn = scaledIn(rec, tk);
  if (inn) {
    if (!canAfford(inn)) return toast("투입 자원 부족");
    pay(inn);
  }
  b.queue.push({ r: rIdx, tier: tk, dur: scaledTime(rec, tk), end: null });
  refreshPanel(); updateHud();
}

/* ── 동적 가격(인플레/디플레) ── */
// 공급망 그래프(레시피에서 자동 도출): 원료 → 그 원료를 쓰는 제품(consumer), 같은 건물 산출끼리 형제(sibling)
const MKT_CONSUMERS = {}, MKT_SIBLINGS = {};
(function buildPriceGraph() {
  for (const bk in GAME_DATA.buildings) {
    const recs = GAME_DATA.buildings[bk].recipes;
    if (!recs) continue;
    const outs = new Set();
    for (const r of recs) {
      for (const o in r.out) outs.add(o);
      if (r.in) for (const i in r.in) for (const o in r.out) {
        (MKT_CONSUMERS[i] = MKT_CONSUMERS[i] || []); if (!MKT_CONSUMERS[i].includes(o)) MKT_CONSUMERS[i].push(o);
      }
    }
    const arr = [...outs];
    for (const a of arr) for (const b of arr) if (a !== b) {
      (MKT_SIBLINGS[a] = MKT_SIBLINGS[a] || []); if (!MKT_SIBLINGS[a].includes(b)) MKT_SIBLINGS[a].push(b);
    }
  }
})();
function priceMultOf(res) {
  const m = state.market && state.market.mult ? state.market.mult[res] : undefined;
  return (typeof m === "number" && m > 0) ? m : 1;
}
function freshMarket() { return { mult: {}, hist: {}, pending: [], step: 0, seed: (Date.now() >>> 0) || 1, ts: Date.now() }; }
function ensureMarket() { if (!state.market) state.market = freshMarket(); if (!state.market.pending) state.market.pending = []; if (!state.market.hist) state.market.hist = {}; if (!state.market.seed) state.market.seed = 1; }
// 시드 PRNG(mulberry32) — 시드를 state에 저장해 오프라인 따라잡기가 결정론적으로 재현된다
function seededRand() {
  ensureMarket();
  let s = (state.market.seed + 0x6D2B79F5) >>> 0;
  state.market.seed = s;
  let t = s;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
function hashStr(s) { let h = 2166136261 >>> 0; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }

// 가격 한 스텝(=1시간) 진행: 예약된 시차충격 적용 → 회귀·흔들림·큰충격 → 변화량을 소비제품·형제에 시차 예약 → 클램프 → 기록
function stepMarketOnce() {
  const cfg = GAME_DATA.market.dynamic;
  if (!cfg || !cfg.enabled) return;
  ensureMarket();
  const M = state.market.mult, keys = Object.keys(GAME_DATA.market.prices);
  const step = state.market.step || 0;
  const lo = cfg.band[0], hi = cfg.band[1];
  const old = {};
  for (const k of keys) old[k] = (typeof M[k] === "number" && M[k] > 0) ? M[k] : 1;
  // 1) 이번 스텝에 도달한 시차 전파(원료→제품, 형제) 적용
  const still = [];
  for (const p of state.market.pending) {
    if (p.at <= step) { if (GAME_DATA.market.prices[p.res] != null) M[p.res] = (old[p.res] != null ? M[p.res] : 1) + p.amount; }
    else still.push(p);
  }
  state.market.pending = still;
  // 2) 회귀 + 잔잔한 흔들림 + 이유 없는 큰 충격 (시드 기반)
  for (const k of keys) {
    let m = (typeof M[k] === "number" && M[k] > 0) ? M[k] : 1;
    m += (1 - m) * cfg.reversion;
    m *= 1 + cfg.drift * (seededRand() * 2 - 1);
    if (seededRand() < cfg.shockChance) m *= 1 + cfg.shockMag * (seededRand() * 2 - 1);
    M[k] = m;
  }
  // 3) 이번 변화량 → 소비제품·형제에 "시차"를 두고 예약(연쇄 파급). 제품 변화도 다음 스텝 delta가 되어 또 하류로 번진다
  for (const k of keys) {
    const delta = M[k] - old[k];
    if (Math.abs(delta) < 1e-6) continue;
    for (const c of (MKT_CONSUMERS[k] || [])) state.market.pending.push({ res: c, amount: delta * cfg.propagate, at: step + (cfg.chainDelaySteps || 1) });
    for (const sb of (MKT_SIBLINGS[k] || [])) state.market.pending.push({ res: sb, amount: delta * cfg.sibling, at: step + (cfg.siblingDelaySteps || 1) });
  }
  // 4) 밴드 클램프
  for (const k of keys) M[k] = Math.max(lo, Math.min(hi, M[k]));
  // 5) 기록(그래프용, 최근 histLen 스텝)
  const H = state.market.hist, hl = cfg.histLen || 10;
  for (const k of keys) { (H[k] = H[k] || []).push(+M[k].toFixed(4)); if (H[k].length > hl) H[k].shift(); }
  state.market.step = step + 1;
}

// 그래프용 시세 배열(길이 histLen). 실제 기록이 모자라면 과거를 그럴듯하게 합성해 채운다(표시 전용, 결정론적).
function priceHistory(res) {
  const cfg = GAME_DATA.market.dynamic, hl = cfg.histLen || 10;
  ensureMarket();
  const real = state.market.hist[res] || [];
  let series = real.slice();
  series.push(+priceMultOf(res).toFixed(4));  // 마지막 = 현재
  if (series.length < hl) {                    // 과거 합성(오래된 쪽으로 채움)
    let s = (hashStr(res) ^ (state.market.seed >>> 0)) >>> 0;
    let v = series[0];
    const back = [];
    for (let i = series.length; i < hl; i++) {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      const r = (s / 4294967296) * 2 - 1;
      v = Math.max(cfg.band[0], Math.min(cfg.band[1], v * (1 - cfg.drift * r)));
      back.unshift(+v.toFixed(4));
    }
    series = back.concat(series);
  }
  return series.slice(-hl);
}

/* ── 매수·매도 (생산 가능한 품목만 거래) ── */
// 기준 단가 = 정가 × 변동 시세 배수. (레벨 보너스 없음 — 레벨 이득은 스프레드 개선으로)
function unitPrice(res) { return GAME_DATA.market.prices[res] * priceMultOf(res); }
// res가 속한 시장 탭(0=1차,1=2차,2=3차)
function resTab(res) {
  const tabs = GAME_DATA.market.tabs || [];
  for (let i = 0; i < tabs.length; i++) if (tabs[i].items.includes(res)) return i;
  return 0;
}
// 이 품목의 현재 스프레드 {buy, sell} — 시장 레벨이 오르며 tier별 구간에서 worst→best 로 선형 개선
function spreadFor(res) {
  const sp = GAME_DATA.market.spread;
  if (!sp) return { buy: 1, sell: 1 };
  const mk = marketB(); const lv = mk ? mk.level : 1;
  const win = sp.windows[resTab(res)] || sp.windows[sp.windows.length - 1] || [1, 1];
  const t = Math.max(0, Math.min(1, (lv - win[0]) / Math.max(1, win[1] - win[0])));
  return {
    buy: sp.worst.buy + (sp.best.buy - sp.worst.buy) * t,
    sell: sp.worst.sell + (sp.best.sell - sp.worst.sell) * t,
  };
}
// 이 자원을 지금 만들 수 있나 = 그 자원을 산출하는 레시피가 열린 건물을 보유
function canProduce(res) {
  for (const b of state.buildings) {
    const d = bdef(b.type); if (!d.recipes) continue;
    for (const r of d.recipes) if (r.out && r.out[res] != null && b.level >= (r.unlock || 1)) return true;
  }
  return false;
}
// 경과 시간만큼 스텝 진행(오프라인 포함, catchUpMax 로 상한). 변화가 있으면 true.
function stepMarket(now) {
  const cfg = GAME_DATA.market.dynamic;
  if (!cfg || !cfg.enabled) return false;
  if (!state.market) state.market = { mult: {}, ts: now };
  const stepMs = cfg.stepSec * 1000;
  const raw = Math.floor((now - state.market.ts) / stepMs);
  if (raw <= 0) return false;
  const steps = Math.min(raw, cfg.catchUpMax);
  for (let i = 0; i < steps; i++) stepMarketOnce();
  state.market.ts = raw > cfg.catchUpMax ? now : state.market.ts + steps * stepMs;
  return true;
}

// 거래 소요 시간(초): 개수 기준 + 상한. 골드 가치와 무관 → 비싼 물건 대량 거래도 안 터진다.
function tradeTime(qty) {
  const t = GAME_DATA.market.trade || { base: 5, perItem: 0.4, max: 120 };
  return Math.min(t.max, Math.ceil(t.base + Math.max(1, qty) * t.perItem));
}
// 판매 견적 (기준 단가 × 매도 스프레드)
function sellQuote(res, qty) {
  const gold = Math.floor(qty * unitPrice(res) * spreadFor(res).sell);
  return { gold, time: tradeTime(qty) };
}
// 매수 견적 (기준 단가 × 매수 스프레드)
function buyQuote(res, qty) {
  const gold = Math.ceil(qty * unitPrice(res) * spreadFor(res).buy);
  return { gold, time: tradeTime(qty) };
}
// 판매 명령 → 시장 대기열 뒤에 줄 세움 (자원 즉시 차감, 완료 시 골드 입금)
function enqueueSell(res, qty) {
  const mk = marketB();
  if (!mk) return;
  if (!canProduce(res)) return toast("생산할 수 없는 품목은 거래할 수 없다");
  if (mk.queue.length >= capacityOf("market", mk.level)) return toast("시장 대기열이 가득 찼다");
  qty = Math.max(1, Math.min(qty, Math.floor(state.res[res] || 0)));
  if (qty < 1) return toast("팔 자원이 없다");
  const q = sellQuote(res, qty);
  state.res[res] -= qty;
  mk.queue.push({ res, qty, gold: q.gold, dur: q.time, end: null });
  refreshPanel(); updateHud();
}
// 매수 명령 → 시장 대기열 뒤에 줄 세움 (골드 즉시 차감, 완료 시 물품 입고)
function enqueueBuy(res, qty) {
  const mk = marketB();
  if (!mk) return;
  if (!canProduce(res)) return toast("생산할 수 없는 품목은 거래할 수 없다");
  if (mk.queue.length >= capacityOf("market", mk.level)) return toast("시장 대기열이 가득 찼다");
  qty = Math.max(1, Math.floor(qty));
  const q = buyQuote(res, qty);
  if ((state.res.gold || 0) < q.gold) return toast("골드 부족");
  state.res.gold -= q.gold;
  mk.queue.push({ buy: true, res, qty, gold: q.gold, dur: q.time, end: null });
  refreshPanel(); updateHud();
}

// 대기열 작업 취소 (idx번째). 생산=투입 재료 전액 반환 / 매도=자원 반환 / 매수=골드 반환.
// 진행 중이던 맨 앞을 취소하면 다음 작업이 지금부터 다시 시작한다.
function cancelJob(iid, idx) {
  const b = byIid(iid);
  if (!b || !b.queue || idx < 0 || idx >= b.queue.length) return;
  const job = b.queue[idx];
  if (b.type === "market") {
    if (job.buy) { state.res.gold += job.gold; toast(`매수 취소 — 골드 반환 +${fmtNum(job.gold)} 🪙`); }
    else { state.res[job.res] = (state.res[job.res] || 0) + job.qty; toast(`매도 취소 — ${GAME_DATA.resources[job.res].icon}${fmtNum(job.qty)} 반환`); }
  } else {
    const rec = bdef(b.type).recipes[job.r];
    const inn = rec ? scaledIn(rec, job.tier) : null;
    if (inn) for (const k in inn) state.res[k] = (state.res[k] || 0) + inn[k];
    toast(inn ? "생산 취소 — 재료 반환" : "생산 취소");
  }
  const wasFirst = idx === 0;
  b.queue.splice(idx, 1);
  if (wasFirst && b.queue.length) b.queue[0].end = null;  // 다음 것이 processQueues에서 now 기준으로 재시작
  refreshPanel(); updateHud();
}

// 집 골드 속도(기본, 소비 보너스 제외)·상한
function houseRate(b) {
  const h = bdef(b.type).house;
  return h.rate * (1 + h.rateBonus * (b.level - 1));
}
function houseCap(b) { return bdef(b.type).house.capPerLevel * b.level; }

// 이 집이 지금 요구하는 소비품(레벨대에서 from 이 가장 높은 것 하나). 없으면 null.
function houseDemand(b) {
  const list = (bdef(b.type).house.demand) || [];
  let pick = null;
  for (const d of list) if (b.level >= d.from && (!pick || d.from > pick.from)) pick = d;
  return pick;
}

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
    if (b.constructing || !b.queue.length) continue;
    if (b.queue[0].end == null) b.queue[0].end = now + b.queue[0].dur * 1000;
    while (b.queue.length && now >= b.queue[0].end) {
      const job = b.queue.shift();
      const doneT = job.end;
      if (b.type === "market") {
        if (job.buy) {
          state.res[job.res] = (state.res[job.res] || 0) + job.qty;
          toast(`매수 완료 +${fmtNum(job.qty)} ${GAME_DATA.resources[job.res].icon}`);
        } else {
          state.res.gold += job.gold;
          toast(`판매 완료 +${fmtNum(job.gold)} 🪙`);
        }
      } else {
        const out = prodOut(b.type, b.level, job.r, job.tier);
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
  let stockDirty = false;
  for (const b of state.buildings) {
    if (b.constructing || !isHouse(b.type)) continue;
    // 주민 소비: 요구품이 있으면 재고에서 먹고, 배부른 비율만큼 세금이 늘어난다.
    let mult = 1;
    const dem = houseDemand(b);
    if (dem) {
      const want = dem.rate * dt;
      const have = state.res[dem.item] || 0;
      const use = Math.min(want, have);
      if (use > 0) {
        const before = Math.floor(have);
        state.res[dem.item] = have - use;
        if (Math.floor(state.res[dem.item]) !== before) stockDirty = true;
      }
      const frac = want > 0 ? use / want : 0;
      b.fed = frac;
      mult = 1 + dem.boost * frac;
    } else {
      b.fed = 0;
    }
    b.accum = Math.min(houseCap(b), b.accum + houseRate(b) * mult * dt);
  }
  if (stockDirty) { updateHud(); refreshPanel(); }
  if (stepMarket(now)) refreshPanel();  // 가격이 갱신되면 시장 패널 다시 그림
  processConstruction(now);
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
