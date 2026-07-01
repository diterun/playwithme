// iso_colony — 엔진 (v2: 석기시대)
// 방치형 콜로니: 일꾼을 건물에 배정 → 자동 채집/식량 → 자원 축적 → 건물·중앙건물 레벨업.
// 밸런스·콘텐츠 = data.js(GAME_DATA). 여기선 그걸 읽어 굴리고 그린다.
//
// 구성: Config → Canvas/Iso → State → Economy → Workers → Render → Time → UI(탭·패널) → Loop
"use strict";

// ── Config ──────────────────────────────────────────────
const TILE_W = 64, TILE_H = 32;
const GRID = 12;
const DAY_LEN = 40, NIGHT_START = 0.68, DAWN = 0.04;
const WALK_SPEED = 2.2;

// ── Canvas / Iso ────────────────────────────────────────
const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
let VIEW_W = 0, VIEW_H = 0, DPR = 1;
let WSCALE = 1, OFFX = 0, OFFY = 0;

const MAP_TOP = 70;
const SPAN_X = GRID * TILE_W;
const SPAN_Y = 2 * (GRID - 1) * (TILE_H / 2) + TILE_H + MAP_TOP;

function resize() {
  DPR = window.devicePixelRatio || 1;
  VIEW_W = window.innerWidth; VIEW_H = window.innerHeight;
  canvas.width = Math.round(VIEW_W * DPR);
  canvas.height = Math.round(VIEW_H * DPR);
  const pad = 14, topUI = 46, botUI = 66;
  WSCALE = Math.min((VIEW_W - pad * 2) / SPAN_X, (VIEW_H - topUI - botUI) / SPAN_Y, 1.7);
  OFFX = VIEW_W / 2;
  OFFY = topUI + MAP_TOP * WSCALE;
}
window.addEventListener("resize", resize);
window.addEventListener("orientationchange", () => setTimeout(resize, 100));
resize();

function iso(gx, gy) { return { x: (gx - gy) * (TILE_W / 2), y: (gx + gy) * (TILE_H / 2) }; }
function tc(gx, gy) { const p = iso(gx, gy); return { x: p.x, y: p.y + TILE_H / 2 }; } // 타일 바닥 중심
function depth(gx, gy) { return gx + gy; }

// ── State ───────────────────────────────────────────────
const S = { stock: {}, pop: 0, level: {}, assign: {}, recruitT: 0, hungry: false };

function initState() {
  const d = GAME_DATA;
  S.stock = Object.assign({}, d.start.stock);
  S.pop = d.start.pop;
  for (const b of d.buildings) S.level[b.id] = b.startLevel;
  for (const b of d.buildings) if (b.kind === "prod") S.assign[b.id] = d.start.assign[b.id] || 0;
  S.recruitT = 0; S.hungry = false;
}

// ── Economy ─────────────────────────────────────────────
const central = () => S.level.campfire;
function maxLevel(b) { return b.kind === "central" ? GAME_DATA.era.centralMax : central(); }
function popCap() { const h = bdef("house"); return h.popBase + (S.level.house - 1) * h.popPer; }
function storageCap() { const s = bdef("store"); return s.capBase + (S.level.store - 1) * s.capPer; }
function assignedTotal() { let t = 0; for (const k in S.assign) t += S.assign[k]; return t; }
function idleWorkers() { return S.pop - assignedTotal(); }
function prodRate(b) { return b.rate * S.level[b.id] * (S.assign[b.id] || 0); } // /초 (배고픔 전)
function netRate(id) {
  let r = 0;
  for (const b of GAME_DATA.buildings) if (b.kind === "prod" && b.produces === id) r += prodRate(b);
  if (id === GAME_DATA.food.id) r -= S.pop * GAME_DATA.food.perPop;
  return r;
}
function addStock(id, amt) {
  S.stock[id] = Math.max(0, Math.min(storageCap(), (S.stock[id] || 0) + amt));
}
function canAfford(c) { for (const k in c) if ((S.stock[k] || 0) < c[k]) return false; return true; }
function pay(c) { for (const k in c) S.stock[k] -= c[k]; }

function upgrade(id) {
  const b = bdef(id), l = S.level[id];
  if (l >= maxLevel(b)) return;
  const c = b.cost(l);
  if (!canAfford(c)) return;
  pay(c); S.level[id] = l + 1;
  refreshPanel();
}
function setAssign(id, delta) {
  const cur = S.assign[id] || 0, next = cur + delta;
  if (next < 0) return;
  if (delta > 0 && idleWorkers() <= 0) return;
  S.assign[id] = next; reassignJobs(); refreshPanel();
}

function economyStep(dt) {
  if (isNight) return;                       // 밤엔 취침(생산 정지)
  const hMult = S.hungry ? GAME_DATA.food.hungryMult : 1;
  for (const b of GAME_DATA.buildings) {
    if (b.kind !== "prod") continue;
    let r = prodRate(b);
    if (b.produces !== GAME_DATA.food.id) r *= hMult;   // 배고프면 채집만 감소
    addStock(b.produces, r * dt);
  }
  addStock(GAME_DATA.food.id, -S.pop * GAME_DATA.food.perPop * dt);
  S.hungry = (S.stock[GAME_DATA.food.id] || 0) <= 0;
  // 인구 성장
  if (S.pop < popCap() && S.stock[GAME_DATA.food.id] > GAME_DATA.recruit.minMeat) {
    S.recruitT += dt;
    if (S.recruitT >= GAME_DATA.recruit.time) { S.recruitT = 0; S.pop++; syncWorkers(); refreshPanel(); }
  } else S.recruitT = 0;
}

// ── Workers ─────────────────────────────────────────────
const workers = [];
function ringOffset(i, r) { const a = i * 2.399; return { x: Math.cos(a) * r, y: Math.sin(a) * r }; } // 황금각 분산

class Worker {
  constructor(i) {
    const o = ringOffset(i, 0.4), h = bdef("house").tile;
    this.i = i; this.gx = h[0] + o.x; this.gy = h[1] + o.y;
    this.bed = { gx: h[0] + o.x, gy: h[1] + o.y };
    this.job = null; this.state = "idle"; this.phase = Math.random() * 6.28;
    this.color = ["#ffe0b2", "#c8e6c9", "#bbdefb", "#f8bbd0", "#ffccbc", "#d1c4e9"][i % 6];
    this._face = 1;
  }
  target() {
    const o = ringOffset(this.i, 0.55);
    if (this.job) { const t = bdef(this.job).tile; return { gx: t[0] + o.x, gy: t[1] + o.y }; }
    const c = bdef("campfire").tile; const o2 = ringOffset(this.i, 1.2);
    return { gx: c[0] + o2.x, gy: c[1] + o2.y };
  }
  tool() { return this.job ? bdef(this.job).tool : null; }
  update(dt) {
    if (isNight) {
      if (this.state !== "sleep") { this.state = "toBed"; if (this.moveTo(this.bed, dt)) this.state = "sleep"; }
      return;
    }
    const tg = this.target();
    if (this.moveTo(tg, dt)) this.state = this.job ? "work" : "idle";
    else this.state = "walk";
    if (this.state === "work") this.phase += dt * 8;
  }
  moveTo(t, dt) {
    const dx = t.gx - this.gx, dy = t.gy - this.gy, d = Math.hypot(dx, dy), step = WALK_SPEED * dt;
    if (d <= step || d < 0.02) { this.gx = t.gx; this.gy = t.gy; return true; }
    this.gx += dx / d * step; this.gy += dy / d * step; this.phase += dt * 10; return false;
  }
}
function syncWorkers() {
  while (workers.length < S.pop) workers.push(new Worker(workers.length));
  while (workers.length > S.pop) workers.pop();
  reassignJobs();
}
function reassignJobs() {
  const list = [];
  for (const b of GAME_DATA.buildings)
    if (b.kind === "prod") for (let k = 0; k < (S.assign[b.id] || 0); k++) list.push(b.id);
  workers.forEach((w, i) => (w.job = list[i] || null));
}

// ── Time ────────────────────────────────────────────────
let t = DAWN * DAY_LEN + 0.01, day = 1, isNight = false;
function timeStep(dt) {
  t += dt; if (t >= DAY_LEN) { t -= DAY_LEN; day++; }
  const p = t / DAY_LEN;
  isNight = p >= NIGHT_START || p < DAWN;
}
function clockStr() {
  const p = t / DAY_LEN, hh = Math.floor(p * 24), mm = Math.floor((p * 24 % 1) * 60);
  return String(hh).padStart(2, "0") + ":" + String(mm).padStart(2, "0");
}

// ── Render: 기본 도형 ────────────────────────────────────
function diamond(cx, cy, w, h) {
  ctx.beginPath(); ctx.moveTo(cx, cy - h / 2); ctx.lineTo(cx + w / 2, cy);
  ctx.lineTo(cx, cy + h / 2); ctx.lineTo(cx - w / 2, cy); ctx.closePath();
}
function tile(gx, gy, col) {
  const p = iso(gx, gy);
  ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x + TILE_W / 2, p.y + TILE_H / 2);
  ctx.lineTo(p.x, p.y + TILE_H); ctx.lineTo(p.x - TILE_W / 2, p.y + TILE_H / 2); ctx.closePath();
  ctx.fillStyle = col; ctx.fill(); ctx.strokeStyle = "rgba(0,0,0,0.08)"; ctx.stroke();
}
function drawGround() {
  for (let s = 0; s <= 2 * (GRID - 1); s++)
    for (let gx = 0; gx < GRID; gx++) {
      const gy = s - gx; if (gy < 0 || gy >= GRID) continue;
      tile(gx, gy, (gx + gy) % 2 === 0 ? "#6b9b45" : "#638f40");
    }
}

// ── Render: 건물 스프라이트 ──────────────────────────────
function drawBuilding(b) {
  const c = tc(b.tile[0], b.tile[1]);
  const lv = S.level[b.id];
  switch (b.id) {
    case "campfire": {
      // 돌 화덕 + 통나무 + 흔들리는 불꽃(레벨=크기)
      const s = 1 + (lv - 1) * 0.12;
      ctx.fillStyle = "#5b5148"; diamond(c.x, c.y, 30 * s, 16 * s); ctx.fill();
      ctx.strokeStyle = "#6b4a2b"; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.moveTo(c.x - 8, c.y + 2); ctx.lineTo(c.x + 8, c.y - 2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(c.x - 8, c.y - 2); ctx.lineTo(c.x + 8, c.y + 2); ctx.stroke();
      const fl = 12 + Math.sin(t * 9 + b.tile[0]) * 3;
      const grd = ctx.createLinearGradient(c.x, c.y - fl * s, c.x, c.y);
      grd.addColorStop(0, "#ffe27a"); grd.addColorStop(1, "#e8631d");
      ctx.fillStyle = grd;
      ctx.beginPath(); ctx.moveTo(c.x, c.y - fl * s); ctx.quadraticCurveTo(c.x + 8 * s, c.y - 6, c.x, c.y - 2);
      ctx.quadraticCurveTo(c.x - 8 * s, c.y - 6, c.x, c.y - fl * s); ctx.fill();
      break;
    }
    case "house": drawHut(c.x, c.y, "#8a5a2b", "#6b4423"); break;
    case "store": {
      ctx.fillStyle = "#7a5230"; ctx.strokeStyle = "#5c3d22"; ctx.lineWidth = 1.5;
      for (const [ox, oy] of [[-8, 2], [8, 2], [0, -6]]) { ctx.fillRect(c.x + ox - 9, c.y + oy - 14, 18, 16); ctx.strokeRect(c.x + ox - 9, c.y + oy - 14, 18, 16); }
      break;
    }
    case "lumber": {
      drawHut(c.x + 6, c.y, "#7d5a34", "#5e4326");
      ctx.fillStyle = "#8a6a3a"; // 통나무 더미
      for (const oy of [0, -6, -3]) { ctx.beginPath(); ctx.ellipse(c.x - 14, c.y + oy, 8, 4, 0, 0, 7); ctx.fill(); }
      break;
    }
    case "quarry": {
      ctx.fillStyle = "#9aa1ab"; ctx.beginPath(); ctx.ellipse(c.x, c.y - 6, 16, 12, 0, 0, 7); ctx.fill();
      ctx.fillStyle = "#7d848d"; ctx.beginPath(); ctx.ellipse(c.x + 8, c.y, 10, 7, 0, 0, 7); ctx.fill();
      ctx.fillStyle = "#b3bac2"; ctx.beginPath(); ctx.ellipse(c.x - 8, c.y - 2, 8, 6, 0, 0, 7); ctx.fill();
      break;
    }
    case "hunter": {
      ctx.fillStyle = "#8d6e4b"; ctx.beginPath(); // 천막
      ctx.moveTo(c.x, c.y - 26); ctx.lineTo(c.x + 15, c.y + 2); ctx.lineTo(c.x - 15, c.y + 2); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = "#5e4a30"; ctx.lineWidth = 2; ctx.beginPath();
      ctx.moveTo(c.x, c.y - 26); ctx.lineTo(c.x, c.y + 2); ctx.stroke();
      break;
    }
    case "hall": case "barracks": {
      ctx.globalAlpha = 0.5; drawHut(c.x, c.y, "#4b556b", "#39415260"); ctx.globalAlpha = 1;
      ctx.fillStyle = "#cdd6e6"; ctx.font = "14px sans-serif"; ctx.textAlign = "center";
      ctx.fillText("🔒", c.x, c.y - 8); ctx.textAlign = "left";
      break;
    }
  }
}
// 아이소 오두막(바닥+벽2+박공지붕)
function drawHut(x, y, wall, roof) {
  ctx.fillStyle = "#a9773f"; diamond(x, y, 30, 16); ctx.fill();
  ctx.fillStyle = wall;
  ctx.fillRect(x - 13, y - 16, 26, 16);
  ctx.fillStyle = roof;
  ctx.beginPath(); ctx.moveTo(x - 16, y - 15); ctx.lineTo(x, y - 28); ctx.lineTo(x + 16, y - 15); ctx.closePath(); ctx.fill();
}

// ── Render: 도구 + 졸라맨(관절형) ────────────────────────
function limb(x0, y0, x1, y1, bend, width) {
  const dx = x1 - x0, dy = y1 - y0, len = Math.hypot(dx, dy) || 1;
  const jx = (x0 + x1) / 2 + (-dy / len) * bend, jy = (y0 + y1) / 2 + (dx / len) * bend;
  ctx.lineWidth = width; ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(jx, jy); ctx.lineTo(x1, y1); ctx.stroke();
}
function drawAxe(gx, gy, ex, ey) {
  const dx = ex - gx, dy = ey - gy, L = Math.hypot(dx, dy) || 1, ux = dx / L, uy = dy / L, px = -uy, py = ux;
  ctx.strokeStyle = "#6b4a2b"; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(gx, gy); ctx.lineTo(ex, ey); ctx.stroke();
  ctx.fillStyle = "#cdd4dc"; ctx.strokeStyle = "#8b939d"; ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(ex - ux * 5 + px * 7, ey - uy * 5 + py * 7); ctx.lineTo(ex + ux * 6 + px * 5, ey + uy * 6 + py * 5);
  ctx.lineTo(ex + ux * 6 - px * 5, ey + uy * 6 - py * 5); ctx.lineTo(ex - ux * 5 - px * 7, ey - uy * 5 - py * 7);
  ctx.closePath(); ctx.fill(); ctx.stroke();
}
function drawPick(gx, gy, ex, ey) {
  const dx = ex - gx, dy = ey - gy, L = Math.hypot(dx, dy) || 1, ux = dx / L, uy = dy / L, px = -uy, py = ux;
  ctx.strokeStyle = "#6b4a2b"; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(gx, gy); ctx.lineTo(ex, ey); ctx.stroke();
  ctx.strokeStyle = "#b9c0c9"; ctx.lineWidth = 3.5; ctx.lineCap = "round";
  ctx.beginPath(); ctx.moveTo(ex + px * 9 - ux * 3, ey + py * 9 - uy * 3);
  ctx.quadraticCurveTo(ex + ux * 2, ey + uy * 2, ex - px * 9 - ux * 3, ey - py * 9 - uy * 3); ctx.stroke();
}
function drawSpear(gx, gy, ex, ey) {
  const dx = ex - gx, dy = ey - gy, L = Math.hypot(dx, dy) || 1, ux = dx / L, uy = dy / L, px = -uy, py = ux;
  ctx.strokeStyle = "#7d5a34"; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.moveTo(gx, gy); ctx.lineTo(ex, ey); ctx.stroke();
  ctx.fillStyle = "#d7dde4"; ctx.beginPath(); // 삼각 창끝
  ctx.moveTo(ex + ux * 7, ey + uy * 7); ctx.lineTo(ex + px * 3, ey + py * 3); ctx.lineTo(ex - px * 3, ey - py * 3);
  ctx.closePath(); ctx.fill();
}
function drawWorker(w) {
  const p = iso(w.gx, w.gy), cx = p.x, gy = p.y + TILE_H / 2;
  if (w.state === "sleep") {
    ctx.strokeStyle = "#222"; ctx.lineWidth = 3; ctx.lineCap = "round"; ctx.fillStyle = w.color;
    ctx.beginPath(); ctx.arc(cx - 10, gy - 5, 4.5, 0, 7); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx - 6, gy - 5); ctx.lineTo(cx + 10, gy - 4); ctx.stroke();
    ctx.fillStyle = "#cfe0ff"; ctx.font = "italic 11px sans-serif"; ctx.fillText("z", cx + 3, gy - 13);
    return;
  }
  let fx = null; const tg = w.target(); if (tg) fx = iso(tg.gx, tg.gy).x;
  if (w.state === "work") fx = iso(w.job ? bdef(w.job).tile[0] : w.gx, w.job ? bdef(w.job).tile[1] : w.gy).x;
  if (fx !== null && Math.abs(fx - cx) > 0.5) w._face = fx >= cx ? 1 : -1;
  const face = w._face, hipY = gy - 14, shY = gy - 27, headY = gy - 34;
  const moving = w.state === "walk" || w.state === "toBed", working = w.state === "work";
  ctx.lineCap = "round"; ctx.strokeStyle = "#2b2b2b";

  let fLx, fLy, fRx, fRy;
  if (moving) {
    const ph = w.phase;
    fLx = cx + Math.sin(ph) * 6 * face; fLy = gy - Math.max(0, Math.cos(ph)) * 4;
    fRx = cx + Math.sin(ph + Math.PI) * 6 * face; fRy = gy - Math.max(0, Math.cos(ph + Math.PI)) * 4;
  } else { fLx = cx - 4; fLy = gy; fRx = cx + 5; fRy = gy; }
  limb(cx - 1, hipY, fLx, fLy, -face * 3, 3);
  limb(cx + 1, hipY, fRx, fRy, -face * 3, 3);

  const lean = working ? face * 3 : (moving ? face * 1.5 : 0), shX = cx + lean;
  ctx.lineWidth = 3.5; ctx.beginPath(); ctx.moveTo(cx, hipY); ctx.lineTo(shX, shY); ctx.stroke();

  if (working && w.tool()) {
    const raise = (Math.cos(w.phase) + 1) / 2, ang = -2.3 + 2.9 * (1 - raise);
    const gxp = shX + Math.cos(ang) * 12 * face, gyp = shY + Math.sin(ang) * 12;
    const ex = gxp + Math.cos(ang) * 16 * face, ey = gyp + Math.sin(ang) * 16;
    limb(shX - 2, shY, gxp, gyp, face * 3, 3); limb(shX + 2, shY, gxp, gyp, face * 3, 3);
    const tl = w.tool(); tl === "pick" ? drawPick(gxp, gyp, ex, ey) : tl === "spear" ? drawSpear(gxp, gyp, ex, ey) : drawAxe(gxp, gyp, ex, ey);
    ctx.strokeStyle = "#2b2b2b";
  } else {
    const sw = moving ? Math.sin(w.phase) * 5 * face : 0;
    limb(shX, shY, shX - sw, shY + 12, -face * 4, 3); limb(shX, shY, shX + sw, shY + 12, face * 4, 3);
  }
  ctx.fillStyle = w.color; ctx.beginPath(); ctx.arc(shX, headY, 5.5, 0, 7); ctx.fill();
  ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(shX, headY, 5.5, 0, 7); ctx.stroke();
}

// ── Render: 밤 + 합성 ────────────────────────────────────
function drawNight() {
  const p = t / DAY_LEN; let a = 0;
  if (p >= NIGHT_START) a = Math.min(0.55, (p - NIGHT_START) / (1 - NIGHT_START) * 0.7);
  else if (p < DAWN) a = 0.55;
  else if (p < DAWN + 0.06) a = 0.55 * (1 - (p - DAWN) / 0.06);
  if (a > 0.01) { ctx.fillStyle = `rgba(18,26,54,${a})`; ctx.fillRect(0, 0, VIEW_W, VIEW_H); }
}
function render() {
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0); ctx.clearRect(0, 0, VIEW_W, VIEW_H);
  ctx.setTransform(DPR * WSCALE, 0, 0, DPR * WSCALE, OFFX * DPR, OFFY * DPR);
  drawGround();
  const tall = [];
  for (const b of GAME_DATA.buildings) tall.push({ d: depth(b.tile[0], b.tile[1]) + 0.1, y: tc(b.tile[0], b.tile[1]).y, fn: () => drawBuilding(b) });
  for (const w of workers) tall.push({ d: depth(w.gx, w.gy), y: iso(w.gx, w.gy).y, fn: () => drawWorker(w) });
  tall.sort((a, b) => a.d - b.d || a.y - b.y);
  for (const o of tall) o.fn();
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0); drawNight();
}

// ── UI: HUD + 탭 + 패널 ──────────────────────────────────
const $ = (s) => document.querySelector(s);
const panel = $("#panel"), panelBody = $("#panel-body"), panelTitle = $("#panel-title");
let curTab = "village";

function fmt(n) { return Math.floor(n).toLocaleString("en-US"); }
function costHTML(c) {
  return Object.keys(c).map((k) => {
    const r = GAME_DATA.resources.find((x) => x.id === k);
    const ok = (S.stock[k] || 0) >= c[k];
    return `<span class="${ok ? "" : "no"}">${r ? r.icon : k} ${fmt(c[k])}</span>`;
  }).join("  ");
}

function updateHUD() {
  const chips = GAME_DATA.resources.map((r) =>
    `<div class="chip"><span class="ico">${r.icon}</span>${fmt(S.stock[r.id] || 0)}<span class="cap">/${fmt(storageCap())}</span></div>`
  ).join("");
  $("#res-chips").innerHTML = chips + (S.hungry ? `<div class="chip" style="color:#e06a6a">⚠️식량부족</div>` : "");
  $("#era").textContent = `${GAME_DATA.era.badge} ${GAME_DATA.era.name} · Lv${central()}`;
  $("#clock").textContent = (isNight ? "🌙 " : "☀️ ") + clockStr();
}

function openTab(tab) {
  curTab = tab;
  document.querySelectorAll("#tabbar .tab").forEach((el) => el.classList.toggle("active", el.dataset.tab === tab));
  if (tab === "village") { panel.classList.add("hidden"); return; }
  panel.classList.remove("hidden");
  panelTitle.textContent = { res: "📦 자원", build: "🏗️ 건설", expedition: "⚔️ 원정" }[tab];
  renderPanel();
}
function closePanel() { openTab("village"); }
function refreshPanel() { updateHUD(); if (curTab !== "village" && !panel.classList.contains("hidden")) renderPanel(); }

function renderPanel() {
  const sc = panelBody.scrollTop;
  if (curTab === "res") panelBody.innerHTML = viewRes();
  else if (curTab === "build") panelBody.innerHTML = viewBuild();
  else if (curTab === "expedition") panelBody.innerHTML = viewExpedition();
  bindPanel();
  panelBody.scrollTop = sc;
}

function viewRes() {
  const rows = GAME_DATA.resources.map((r) => {
    const net = netRate(r.id), sign = net >= 0 ? "+" : "";
    const col = net >= 0 ? "#7fd18a" : "#e06a6a";
    return `<div class="resrow"><span class="ico">${r.icon}</span><span class="nm">${r.name}</span>
      <span class="amt">${fmt(S.stock[r.id] || 0)} / ${fmt(storageCap())}</span>
      <span class="rate" style="color:${col}">${sign}${net.toFixed(2)}/s</span></div>`;
  }).join("");
  return `<div class="reslist">${rows}</div>
    <p class="note" style="margin-top:12px">인구 <b>${S.pop} / ${popCap()}</b> · 배정 ${assignedTotal()} · 유휴 ${idleWorkers()}<br>
    ${S.hungry ? "⚠️ 식량이 바닥나 채집 속도가 느려집니다. 사냥터에 일꾼을 늘리세요." : "식량이 충분합니다. 인구가 서서히 늘어납니다."}<br>
    밤에는 일꾼이 자며 생산이 멈춥니다.</p>`;
}

function viewBuild() {
  let html = `<p class="note">인구 <b>${S.pop}/${popCap()}</b> · 유휴 <b>${idleWorkers()}</b> · 건물 레벨 상한 = 화톳불 Lv<b>${central()}</b></p>`;
  for (const b of GAME_DATA.buildings) {
    const lv = S.level[b.id];
    const locked = b.kind === "locked";
    const maxed = !locked && lv >= maxLevel(b);
    const capped = !locked && b.kind !== "central" && lv >= central() && lv < GAME_DATA.era.centralMax;
    const c = locked ? null : b.cost(lv);
    let effect = "";
    if (b.kind === "pop") effect = `인구 상한 ${b.popBase + (lv - 1) * b.popPer} → ${b.popBase + lv * b.popPer}`;
    else if (b.kind === "storage") effect = `저장 한도 ${fmt(b.capBase + (lv - 1) * b.capPer)} → ${fmt(b.capBase + lv * b.capPer)}`;
    else if (b.kind === "prod") effect = `생산 ${(b.rate * lv).toFixed(2)} → ${(b.rate * (lv + 1)).toFixed(2)} /s·일꾼`;
    else if (b.kind === "central") effect = `모든 건물 레벨 상한 ${lv} → ${lv + 1}`;

    let btn;
    if (locked) btn = `<button class="btn" disabled>🔒 잠김</button>`;
    else if (maxed) btn = `<button class="btn" disabled>${b.kind === "central" ? "이 시대 최대" : "최대"}</button>`;
    else if (capped) btn = `<button class="btn" disabled>화톳불 먼저</button>`;
    else btn = `<button class="btn js-up" data-id="${b.id}" ${canAfford(c) ? "" : "disabled"}>레벨업</button>`;

    const assign = b.kind === "prod" ? `<div class="assign"><span class="note">배정 일꾼</span>
      <div class="stepper"><button class="js-dec" data-id="${b.id}" ${(S.assign[b.id] || 0) <= 0 ? "disabled" : ""}>−</button>
      <span class="amt">${S.assign[b.id] || 0} 명</span>
      <button class="js-inc" data-id="${b.id}" ${idleWorkers() <= 0 ? "disabled" : ""}>＋</button></div></div>` : "";

    html += `<div class="card"><div class="row">
      <div class="bico">${b.icon}</div>
      <div class="info"><div class="name">${b.name}${locked ? "" : `<span class="lv">Lv ${lv}</span>`}</div>
      <div class="desc">${b.desc}</div>
      ${locked ? "" : `<div class="desc">${effect}</div>`}
      ${c ? `<div class="cost">비용 ${costHTML(c)}</div>` : ""}</div>
      <div>${btn}</div></div>${assign}</div>`;
  }
  html += `<p class="note">다음 시대: <b>${GAME_DATA.era.next}</b> — 관문 스테이지·전환 비용은 원정(v3)과 함께 열립니다.</p>`;
  return html;
}

function viewExpedition() {
  return `<div class="card"><div class="row"><div class="bico">🏛️</div><div class="info">
    <div class="name">영웅의 전당</div><div class="desc">영웅을 뽑아 주둔시킵니다.</div></div></div></div>
    <div class="card"><div class="row"><div class="bico">⚔️</div><div class="info">
    <div class="name">원정 막사</div><div class="desc">영웅을 스테이지로 출정시켜 적을 격파하고 전리품·시대 관문을 엽니다.</div></div></div></div>
    <p class="note">⚔️ 전투·영웅 시스템은 <b>v3</b>에서 열립니다. 지금은 자원을 모으고 마을을 키워두세요.</p>`;
}

function bindPanel() {
  panelBody.querySelectorAll(".js-up").forEach((el) => el.onclick = () => upgrade(el.dataset.id));
  panelBody.querySelectorAll(".js-inc").forEach((el) => el.onclick = () => setAssign(el.dataset.id, +1));
  panelBody.querySelectorAll(".js-dec").forEach((el) => el.onclick = () => setAssign(el.dataset.id, -1));
}

document.querySelectorAll("#tabbar .tab").forEach((el) => el.onclick = () => openTab(el.dataset.tab));
$("#panel-close").onclick = closePanel;

// ── Loop ────────────────────────────────────────────────
let last = 0, uiT = 0;
function frame(ts) {
  const dt = Math.min(0.05, (ts - last) / 1000 || 0); last = ts;
  timeStep(dt); economyStep(dt);
  for (const w of workers) w.update(dt);
  render();
  uiT += dt; if (uiT >= 0.25) { uiT = 0; updateHUD(); if (curTab !== "village") refreshPanel(); }
  requestAnimationFrame(frame);
}

// ── Init ────────────────────────────────────────────────
initState();
syncWorkers();
updateHUD();
requestAnimationFrame(frame);
