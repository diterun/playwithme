// iso_colony — 엔진 (v3: 스탯 기반 일꾼)
// 콜로니 시뮬레이션: 일꾼을 건물에 배정 → 도로 따라 이동 → 채집 → 자원 축적 → 건물·영주관 레벨업.
// 시간표는 없다 — 일꾼은 각자의 스탯(스태미나·회복속도·포만감·먹는속도)이 시키는 대로
// 스스로 근무↔휴식(숙소)↔식사(식당)를 오간다. 밸런스·콘텐츠 = data.js(GAME_DATA).
//
// 구성: Config → Assets → Canvas/Iso → Roads → State → Economy → Workers(상태머신) → Render → UI → Loop
"use strict";

// ── Config ──────────────────────────────────────────────
const TILE_W = 64, TILE_H = 32;
const GRID = GAME_DATA.mapSize;       // 맵 한 변 칸 수(레이아웃은 data.js에서 정의)
const WALK_SPEED = 2.6;
const STATE_LABEL = { work: "🛠️ 근무", rest: "😴 휴식", eat: "🍽️ 식사", walk: "🚶 이동", idle: "💤 대기" };

// ── Assets: assets.js(ASSET_MAP)의 경로를 실제 Image로 로드 ──
// 이미지가 없거나 아직 안 실렸으면 항상 절차적(코드로 그린) 도형으로 자연스럽게 폴백한다.
function loadImg(src) {
  if (!src) return null;
  const img = new Image(); img.src = src; return img;
}
function imgReady(img) { return !!img && img.complete && img.naturalWidth > 0; }

const BUILDING_IMG = {};
for (const b of GAME_DATA.buildings) BUILDING_IMG[b.id] = loadImg(ASSET_MAP.buildings[b.id]);

const GRASS_IMG = loadImg(ASSET_MAP.ground.grassDefault);
const ROAD_IMG = loadImg(ASSET_MAP.ground.roadDefault);
const OVERRIDE_IMG = {};
for (const k in ASSET_MAP.ground.overrides) OVERRIDE_IMG[k] = loadImg(ASSET_MAP.ground.overrides[k]);

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

// 정사각형(size×size) 건물 구역의 "남쪽(앞) 꼭짓점" 칸 — 스프라이트·깊이정렬 앵커.
function footTile(b) { return [b.tile[0] + b.size - 1, b.tile[1] + b.size - 1]; }
function footAnchor(b) { const [fx, fy] = footTile(b); return tc(fx, fy); }
// 건물 내부 대략 중앙(일꾼이 모여드는 지점 계산용, 그리드 좌표)
function footCenterGrid(b) { const h = (b.size - 1) / 2; return { gx: b.tile[0] + h, gy: b.tile[1] + h }; }

// ── Roads: 도로망 · 경로탐색 ──────────────────────────────
// 도로 칸(GAME_DATA.roads)만 걸어다닐 수 있는 그래프. 일꾼은 "문(door)→도로→문" 경로로 이동하고,
// 문에서 건물 내부(작업지점 등)까진 직선 짧은 이동.
const rk = (x, y) => x + "," + y;
const ROAD = new Set(GAME_DATA.roads.map(([x, y]) => rk(x, y)));
function bfsPath(sx, sy, tx, ty) {
  if (sx === tx && sy === ty) return [];
  const startK = rk(sx, sy), goalK = rk(tx, ty);
  if (!ROAD.has(startK) || !ROAD.has(goalK)) return [{ gx: tx, gy: ty }]; // 비상 폴백(직선)
  const prev = new Map(), visited = new Set([startK]), q = [[sx, sy]];
  for (let qi = 0; qi < q.length; qi++) {
    const [cx, cy] = q[qi];
    if (cx === tx && cy === ty) break;
    for (const [nx, ny] of [[cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]]) {
      const k = rk(nx, ny);
      if (ROAD.has(k) && !visited.has(k)) { visited.add(k); prev.set(k, rk(cx, cy)); q.push([nx, ny]); }
    }
  }
  if (!visited.has(goalK)) return [{ gx: tx, gy: ty }]; // 도달 불가 폴백
  const path = []; let curK = goalK;
  while (curK !== startK) { const [cx, cy] = curK.split(",").map(Number); path.push({ gx: cx, gy: cy }); curK = prev.get(curK); }
  return path.reverse();
}

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
const manorLevel = () => S.level.manor;
function maxLevel(b) { return b.kind === "central" ? GAME_DATA.stage.stageMax : manorLevel(); }
function popCap() { const h = bdef("house"); return h.popBase + (S.level.house - 1) * h.popPer; }
function storageCap() { const s = bdef("store"); return s.capBase + (S.level.store - 1) * s.capPer; }
function assignedTotal() { let t = 0; for (const k in S.assign) t += S.assign[k]; return t; }
function idleWorkers() { return S.pop - assignedTotal(); }
// 식당 레벨 보너스가 반영된 식사 속도 배율
function eatMult() { const m = bdef("mess"); return 1 + (m.eatBonus || 0) * (S.level.mess - 1); }
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

// 생산: "지금 근무 중인" 일꾼만 만든다. 아사 상태(포만감 0)면 starveMult 배.
function economyStep(dt) {
  const food = GAME_DATA.food;
  for (const w of workers) {
    if (w.state !== "work" || !w.job) continue;
    const b = bdef(w.job);
    const mult = w.satiety <= 0 ? food.starveMult : 1;
    addStock(b.produces, b.rate * S.level[b.id] * mult * dt);
  }
  S.hungry = (S.stock[food.id] || 0) <= 0.5;
  // 인구 성장(식량 여유 시)
  if (S.pop < popCap() && S.stock[food.id] > GAME_DATA.recruit.minMeat) {
    S.recruitT += dt;
    if (S.recruitT >= GAME_DATA.recruit.time) { S.recruitT = 0; S.pop++; syncWorkers(); refreshPanel(); }
  }
}
// 자원 탭 표시용: 현재 순간 생산·소비율
function liveRate(id) {
  let r = 0;
  const food = GAME_DATA.food;
  for (const w of workers) {
    if (w.state === "work" && w.job && bdef(w.job).produces === id)
      r += bdef(w.job).rate * S.level[w.job] * (w.satiety <= 0 ? food.starveMult : 1);
    if (id === food.id && w.state === "eat" && (S.stock[food.id] || 0) > 0) r -= food.eatCost;
  }
  return r;
}

// ── Workers: 스탯 기반 상태머신 ──────────────────────────
// [근무] 스태미나 0 → [휴식](숙소, regen으로 충전) → 가득 차면 복귀
// [근무] 포만감 30% 밑 → [식사](식당, eatSpeed로 충전 + 식량 소비) → 가득 차면 복귀
// (배정 없음) → [대기](영주관 앞)
const workers = [];
function ringOffset(i, r) { const a = i * 2.399; return { x: Math.cos(a) * r, y: Math.sin(a) * r }; } // 황금각 분산
// 개체차: 기본값 × (1 ± variance)
function rollStat(base) {
  const v = GAME_DATA.worker.variance;
  return base * (1 + (Math.random() * 2 - 1) * v);
}

class Worker {
  constructor(i) {
    const d = bdef("house").door;
    this.i = i; this.gx = d[0]; this.gy = d[1];
    this.curBuilding = "house";       // 마지막으로 "도착"한 건물(다음 경로의 출발 문)
    this.pendingBuilding = null;      // 지금 향하는 목적지 건물
    this.path = [];                   // 도로 위 남은 경유칸(BFS 결과)
    this.finalTarget = null;          // 문 → 건물 내부 최종 지점
    this.job = null; this.state = "idle"; this.phase = Math.random() * 6.28;
    this.color = ["#ffe0b2", "#c8e6c9", "#bbdefb", "#f8bbd0", "#ffccbc", "#d1c4e9"][i % 6];
    this._face = 1;
    // ── 4스탯 (개체차 포함) ──
    const W = GAME_DATA.worker;
    this.staminaMax = rollStat(W.stamina);
    this.regen = rollStat(W.regen);
    this.satietyMax = rollStat(W.satietyMax);
    this.eatSpeed = rollStat(W.eatSpeed);
    this.stamina = this.staminaMax;
    this.satiety = this.satietyMax;
    this.need = null;                 // 현재 욕구: "eat" | "rest" | null (히스테리시스)
  }
  desiredBuilding() {
    if (this.need === "eat") return "mess";
    if (this.need === "rest") return "house";
    return this.job || "manor";        // 배정된 직장, 미배정이면 영주관 앞에서 대기
  }
  interiorSpot(buildingId) {
    const b = bdef(buildingId), center = footCenterGrid(b);
    const o = ringOffset(this.i, (buildingId === "manor" ? 0.35 : 0.28) * b.size);
    return { gx: center.gx + o.x, gy: center.gy + o.y };
  }
  tool() { return this.job ? bdef(this.job).tool : null; }
  // 욕구 판정: 포만감이 먼저(임계값), 다음 스태미나(바닥)
  updateNeeds() {
    const W = GAME_DATA.worker;
    if (!this.need) {
      if (this.satiety <= this.satietyMax * W.eatThreshold) this.need = "eat";
      else if (this.stamina <= 0) this.need = "rest";
    }
  }
  ensureRoute() {
    const want = this.desiredBuilding();
    if (this.pendingBuilding === want) return;               // 이미 그쪽으로 가는 중이거나 도착해 있음
    const from = bdef(this.curBuilding).door, to = bdef(want).door;
    this.path = bfsPath(from[0], from[1], to[0], to[1]);
    this.finalTarget = null;
    this.pendingBuilding = want;
  }
  update(dt) {
    // 포만감은 항상 조금씩 줄어든다
    this.satiety = Math.max(0, this.satiety - GAME_DATA.worker.satietyDecay * dt);
    this.updateNeeds();
    this.ensureRoute();
    if (this.path.length) {                                  // 1단계: 문→문 도로 이동
      if (this.moveTo(this.path[0], dt)) this.path.shift();
      this.state = "walk"; return;
    }
    if (!this.finalTarget) this.finalTarget = this.interiorSpot(this.pendingBuilding);
    const arrived = this.moveTo(this.finalTarget, dt);        // 2단계: 문→건물 내부 짧은 이동
    this.curBuilding = this.pendingBuilding;
    if (!arrived) { this.state = "walk"; return; }

    // 도착 — 상태별 행동
    if (this.need === "eat" && this.curBuilding === "mess") {
      this.state = "eat";
      const food = GAME_DATA.food;
      if ((S.stock[food.id] || 0) > 0) {                     // 식량이 있어야 먹는다
        const gain = this.eatSpeed * eatMult() * dt;
        this.satiety = Math.min(this.satietyMax, this.satiety + gain);
        addStock(food.id, -food.eatCost * dt);
      }
      if (this.satiety >= this.satietyMax * 0.999) this.need = null;   // 다 먹었으면 복귀
    } else if (this.need === "rest" && this.curBuilding === "house") {
      this.state = "rest";
      this.stamina = Math.min(this.staminaMax, this.stamina + this.regen * dt);
      if (this.stamina >= this.staminaMax * 0.999) this.need = null;   // 다 쉬었으면 복귀
    } else if (this.job && this.curBuilding === this.job) {
      this.state = "work";
      this.stamina = Math.max(0, this.stamina - dt);          // 근무 1초 = 스태미나 1
    } else {
      this.state = "idle";
    }
    const sp = { work: 8, eat: 6 }[this.state]; if (sp) this.phase += dt * sp;
  }
  moveTo(t, dt) {
    const dx = t.gx - this.gx, dy = t.gy - this.gy, d = Math.hypot(dx, dy), step = WALK_SPEED * dt;
    if (d <= step || d < 0.02) { this.gx = t.gx; this.gy = t.gy; return true; }
    this.gx += dx / d * step; this.gy += dy / d * step; this.phase += dt * 10;
    const fx = iso(t.gx, t.gy).x, cx = iso(this.gx, this.gy).x;
    if (Math.abs(fx - cx) > 0.5) this._face = fx >= cx ? 1 : -1;
    return false;
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

// ── Render: 기본 도형 ────────────────────────────────────
let animT = 0; // 장식 애니메이션용(깃발 등)
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
// 칸 좌표 기반 결정적 해시(프레임마다 안 흔들리는 얼룩·잔디술 배치용)
function hash2(gx, gy) {
  let h = (gx * 374761393 + gy * 668265263) ^ (gx * 2246822519);
  h = (h ^ (h >>> 13)) * 1274126177; return (h ^ (h >>> 16)) >>> 0;
}
const GRASS_SHADES = ["#6b9b45", "#5f8f3d", "#76a852", "#639148"];
// 타일 이미지를 마름모 폭에 맞춰 그린다(위쪽 꼭짓점 기준 앵커).
function drawTileImg(img, gx, gy) {
  const p = iso(gx, gy), s = TILE_W / img.naturalWidth, dw = img.naturalWidth * s, dh = img.naturalHeight * s;
  ctx.drawImage(img, p.x - dw / 2, p.y, dw, dh);
}
function drawGrassTile(gx, gy) {
  if (imgReady(GRASS_IMG)) { drawTileImg(GRASS_IMG, gx, gy); return; }
  const h = hash2(gx, gy);
  tile(gx, gy, GRASS_SHADES[h % GRASS_SHADES.length]);
  const p = iso(gx, gy);
  ctx.fillStyle = "rgba(35,60,25,0.35)";
  for (let k = 0; k < 2; k++) {
    const hh = hash2(gx * 131 + k * 17, gy * 89 + k * 31);
    const ox = ((hh % 100) / 100 - 0.5) * TILE_W * 0.55;
    const oy = TILE_H * 0.25 + (((hh >>> 8) % 100) / 100) * TILE_H * 0.5;
    ctx.beginPath(); ctx.ellipse(p.x + ox, p.y + oy, 2.4, 1.3, 0.3, 0, 7); ctx.fill();
  }
}
function drawRoadTile(gx, gy) {
  if (imgReady(ROAD_IMG)) { drawTileImg(ROAD_IMG, gx, gy); return; }
  tile(gx, gy, "#b99a6c");
  const p = iso(gx, gy);
  ctx.strokeStyle = "rgba(94,68,38,0.35)"; ctx.lineWidth = 2; ctx.lineCap = "round";
  ctx.beginPath(); ctx.moveTo(p.x - TILE_W * 0.22, p.y + TILE_H * 0.5); ctx.lineTo(p.x + TILE_W * 0.22, p.y + TILE_H * 0.5); ctx.stroke();
}
function drawGround() {
  for (let s = 0; s <= 2 * (GRID - 1); s++)
    for (let gx = 0; gx < GRID; gx++) {
      const gy = s - gx; if (gy < 0 || gy >= GRID) continue;
      const ov = OVERRIDE_IMG[rk(gx, gy)];
      if (imgReady(ov)) { drawTileImg(ov, gx, gy); continue; }
      ROAD.has(rk(gx, gy)) ? drawRoadTile(gx, gy) : drawGrassTile(gx, gy);
    }
}

// ── Render: 건물 스프라이트 ──────────────────────────────
// 실제 이미지가 있으면 그걸 쓰고(assets.js), 없으면 절차적 도형으로 자리만 잡아둔다(플레이스홀더).
function drawBuilding(b) {
  const anchor = footAnchor(b);
  const img = BUILDING_IMG[b.id];
  const locked = b.kind === "locked";
  ctx.save();
  if (locked) ctx.globalAlpha = 0.55;
  if (imgReady(img)) {
    const targetW = b.size * TILE_W * 0.95;
    const s = targetW / img.naturalWidth, dw = img.naturalWidth * s, dh = img.naturalHeight * s;
    ctx.drawImage(img, anchor.x - dw / 2, anchor.y - dh + TILE_H * 0.2, dw, dh);
  } else {
    ctx.translate(anchor.x, anchor.y);
    ctx.scale(b.size, b.size);
    drawBuildingShape(b, S.level[b.id]);
  }
  ctx.restore();
  if (locked) {
    ctx.fillStyle = "#f4f6fa"; ctx.font = `${16 + b.size * 3}px sans-serif`; ctx.textAlign = "center";
    ctx.fillText("🔒", anchor.x, anchor.y - 12 * b.size); ctx.textAlign = "left";
  }
}
// 자리(0,0)를 발밑 삼아 그리는 1칸짜리 플레이스홀더. (바깥에서 이미 translate·scale함)
function drawBuildingShape(b, lv) {
  switch (b.id) {
    case "manor": {
      // 돌 성채 실루엣 + 흔들리는 깃발(레벨=크기)
      const s = 1 + (lv - 1) * 0.12;
      ctx.fillStyle = "#6b6a63"; diamond(0, 0, 30 * s, 16 * s); ctx.fill();
      ctx.fillStyle = "#8b8a82";
      ctx.fillRect(-14 * s, -30 * s, 28 * s, 30 * s);
      ctx.fillStyle = "#5f5e57";
      for (const ox of [-14, 14]) { ctx.fillRect(ox * s - 3 * s, -36 * s, 6 * s, 8 * s); }
      const wave = Math.sin(animT * 6 + b.tile[0]) * 3;
      ctx.strokeStyle = "#4a4940"; ctx.lineWidth = 2; ctx.beginPath();
      ctx.moveTo(0, -30 * s); ctx.lineTo(0, -42 * s); ctx.stroke();
      ctx.fillStyle = "#3a6bd1";
      ctx.beginPath(); ctx.moveTo(0, -42 * s); ctx.lineTo(10 * s + wave, -38 * s); ctx.lineTo(0, -34 * s); ctx.closePath(); ctx.fill();
      break;
    }
    case "house": drawHut(0, 0, "#8a5a2b", "#6b4423"); break;
    case "store": {
      ctx.fillStyle = "#7a5230"; ctx.strokeStyle = "#5c3d22"; ctx.lineWidth = 1.5;
      for (const [ox, oy] of [[-8, 2], [8, 2], [0, -6]]) { ctx.fillRect(ox - 9, oy - 14, 18, 16); ctx.strokeRect(ox - 9, oy - 14, 18, 16); }
      break;
    }
    case "lumber": {
      drawHut(6, 0, "#7d5a34", "#5e4326");
      ctx.fillStyle = "#8a6a3a"; // 통나무 더미
      for (const oy of [0, -6, -3]) { ctx.beginPath(); ctx.ellipse(-14, oy, 8, 4, 0, 0, 7); ctx.fill(); }
      break;
    }
    case "quarry": {
      ctx.fillStyle = "#9aa1ab"; ctx.beginPath(); ctx.ellipse(0, -6, 16, 12, 0, 0, 7); ctx.fill();
      ctx.fillStyle = "#7d848d"; ctx.beginPath(); ctx.ellipse(8, 0, 10, 7, 0, 0, 7); ctx.fill();
      ctx.fillStyle = "#b3bac2"; ctx.beginPath(); ctx.ellipse(-8, -2, 8, 6, 0, 0, 7); ctx.fill();
      break;
    }
    case "hunter": {
      ctx.fillStyle = "#8d6e4b"; ctx.beginPath(); // 천막
      ctx.moveTo(0, -26); ctx.lineTo(15, 2); ctx.lineTo(-15, 2); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = "#5e4a30"; ctx.lineWidth = 2; ctx.beginPath();
      ctx.moveTo(0, -26); ctx.lineTo(0, 2); ctx.stroke();
      break;
    }
    case "mess": {
      // 식당: 오두막 + 김 나는 솥
      drawHut(4, 0, "#9a6a38", "#7a4e28");
      ctx.fillStyle = "#4a4a52"; ctx.beginPath(); ctx.ellipse(-12, -2, 6, 4, 0, 0, 7); ctx.fill();
      ctx.strokeStyle = "rgba(230,230,230,0.7)"; ctx.lineWidth = 1.5;
      const s2 = Math.sin(animT * 3) * 2;
      ctx.beginPath(); ctx.moveTo(-12, -7); ctx.quadraticCurveTo(-14 + s2, -12, -12, -17); ctx.stroke();
      break;
    }
    case "hall": drawHut(0, 0, "#5a4a7a", "#453868"); break;
    case "barracks": drawHut(0, 0, "#4b5a3f", "#39412f"); break;
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
  if (w.state === "rest") {
    // 휴식: 누워서 스태미나 충전 (머리 위 z)
    ctx.strokeStyle = "#222"; ctx.lineWidth = 3; ctx.lineCap = "round"; ctx.fillStyle = w.color;
    ctx.beginPath(); ctx.arc(cx - 10, gy - 5, 4.5, 0, 7); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx - 6, gy - 5); ctx.lineTo(cx + 10, gy - 4); ctx.stroke();
    ctx.fillStyle = "#cfe0ff"; ctx.font = "italic 11px sans-serif"; ctx.fillText("z", cx + 3, gy - 13);
    return;
  }
  if (w.state === "work" && w.job) {                          // 작업 중엔 자원 쪽을 바라봄
    const ct = footCenterGrid(bdef(w.job)), fx = iso(ct.gx, ct.gy).x;
    if (Math.abs(fx - cx) > 0.5) w._face = fx >= cx ? 1 : -1;
  }
  const face = w._face, hipY = gy - 14, shY = gy - 27, headY = gy - 34;
  const moving = w.state === "walk", working = w.state === "work", eating = w.state === "eat";
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
  } else if (eating) {
    // 한 손을 입으로 반복(식사 모션) + 음식 알갱이
    limb(shX, shY, shX - 3 * face, shY + 11, -face * 4, 3);           // 반대 팔은 내림
    const bite = Math.max(0, Math.sin(w.phase)) * 4;
    const hx = shX + 4 * face, hy = headY + 3 - bite;
    limb(shX, shY, hx, hy, face * 4, 3);                             // 입으로
    ctx.fillStyle = "#c98a3a"; ctx.beginPath(); ctx.arc(hx, hy, 2, 0, 7); ctx.fill();
  } else {
    const sw = moving ? Math.sin(w.phase) * 5 * face : 0;
    limb(shX, shY, shX - sw, shY + 12, -face * 4, 3); limb(shX, shY, shX + sw, shY + 12, face * 4, 3);
  }
  ctx.fillStyle = w.color; ctx.beginPath(); ctx.arc(shX, headY, 5.5, 0, 7); ctx.fill();
  ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(shX, headY, 5.5, 0, 7); ctx.stroke();
  // 아사 상태 표시
  if (w.satiety <= 0) { ctx.fillStyle = "#e06a6a"; ctx.font = "10px sans-serif"; ctx.fillText("!", shX + 7, headY - 5); }
}

function render() {
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0); ctx.clearRect(0, 0, VIEW_W, VIEW_H);
  ctx.setTransform(DPR * WSCALE, 0, 0, DPR * WSCALE, OFFX * DPR, OFFY * DPR);
  drawGround();
  const tall = [];
  for (const b of GAME_DATA.buildings) { const [fx, fy] = footTile(b); tall.push({ d: depth(fx, fy) + 0.1, y: tc(fx, fy).y, fn: () => drawBuilding(b) }); }
  for (const w of workers) tall.push({ d: depth(w.gx, w.gy), y: iso(w.gx, w.gy).y, fn: () => drawWorker(w) });
  tall.sort((a, b) => a.d - b.d || a.y - b.y);
  for (const o of tall) o.fn();
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
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
function stateCounts() {
  const c = { work: 0, rest: 0, eat: 0, walk: 0, idle: 0 };
  for (const w of workers) c[w.state] = (c[w.state] || 0) + 1;
  return c;
}

function updateHUD() {
  const chips = GAME_DATA.resources.map((r) =>
    `<div class="chip"><span class="ico">${r.icon}</span>${fmt(S.stock[r.id] || 0)}<span class="cap">/${fmt(storageCap())}</span></div>`
  ).join("");
  $("#res-chips").innerHTML = chips + (S.hungry ? `<div class="chip" style="color:#e06a6a">⚠️식량부족</div>` : "");
  $("#era").textContent = `${GAME_DATA.stage.badge} ${GAME_DATA.stage.name} · Lv${manorLevel()}`;
  $("#pop").textContent = `👥 ${S.pop}/${popCap()}`;
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
    const net = liveRate(r.id), sign = net >= 0 ? "+" : "";
    const col = net >= 0 ? "#7fd18a" : "#e06a6a";
    return `<div class="resrow"><span class="ico">${r.icon}</span><span class="nm">${r.name}</span>
      <span class="amt">${fmt(S.stock[r.id] || 0)} / ${fmt(storageCap())}</span>
      <span class="rate" style="color:${col}">${sign}${net.toFixed(2)}/s</span></div>`;
  }).join("");
  const c = stateCounts();
  return `<div class="reslist">${rows}</div>
    <p class="note" style="margin-top:12px">인구 <b>${S.pop} / ${popCap()}</b> · 배정 ${assignedTotal()} · 유휴 ${idleWorkers()}<br>
    지금: ${STATE_LABEL.work} ${c.work} · ${STATE_LABEL.rest} ${c.rest} · ${STATE_LABEL.eat} ${c.eat} · ${STATE_LABEL.walk} ${c.walk} · ${STATE_LABEL.idle} ${c.idle}<br>
    ${S.hungry ? "⚠️ 식량이 바닥났습니다. 배곯은 일꾼은 생산이 뚝 떨어집니다 — 사냥터에 일꾼을 늘리세요." : "식량이 충분합니다. 인구가 서서히 늘어납니다."}<br>
    일꾼은 각자 스탯대로 삽니다 — 스태미나가 바닥나면 숙소에서 쉬고, 배고프면 식당에서 먹고, 다시 일터로 돌아갑니다. (수치는 현재 순간 기준)</p>`;
}

function viewBuild() {
  let html = `<p class="note">인구 <b>${S.pop}/${popCap()}</b> · 유휴 <b>${idleWorkers()}</b> · 건물 레벨 상한 = 영주관 Lv<b>${manorLevel()}</b></p>`;
  for (const b of GAME_DATA.buildings) {
    const lv = S.level[b.id];
    const locked = b.kind === "locked";
    const maxed = !locked && lv >= maxLevel(b);
    const capped = !locked && b.kind !== "central" && lv >= manorLevel() && lv < GAME_DATA.stage.stageMax;
    const c = locked ? null : b.cost(lv);
    let effect = "";
    if (b.kind === "pop") effect = `인구 상한 ${b.popBase + (lv - 1) * b.popPer} → ${b.popBase + lv * b.popPer}`;
    else if (b.kind === "storage") effect = `저장 한도 ${fmt(b.capBase + (lv - 1) * b.capPer)} → ${fmt(b.capBase + lv * b.capPer)}`;
    else if (b.kind === "prod") effect = `생산 ${(b.rate * lv).toFixed(2)} → ${(b.rate * (lv + 1)).toFixed(2)} /s·일꾼`;
    else if (b.kind === "service") effect = `식사 속도 +${Math.round((b.eatBonus || 0) * (lv - 1) * 100)}% → +${Math.round((b.eatBonus || 0) * lv * 100)}%`;
    else if (b.kind === "central") effect = `모든 건물 레벨 상한 ${lv} → ${lv + 1}`;

    let btn;
    if (locked) btn = `<button class="btn" disabled>🔒 잠김</button>`;
    else if (maxed) btn = `<button class="btn" disabled>${b.kind === "central" ? "이 단계 최대" : "최대"}</button>`;
    else if (capped) btn = `<button class="btn" disabled>영주관 먼저</button>`;
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
  html += `<p class="note">다음 단계: <b>${GAME_DATA.stage.next}</b> — 관문 스테이지·승급 비용은 원정과 함께 열립니다.</p>`;
  return html;
}

function viewExpedition() {
  return `<div class="card"><div class="row"><div class="bico">🏛️</div><div class="info">
    <div class="name">영웅의 전당</div><div class="desc">영웅을 뽑아 주둔시킵니다.</div></div></div></div>
    <div class="card"><div class="row"><div class="bico">⚔️</div><div class="info">
    <div class="name">원정 막사</div><div class="desc">영웅을 스테이지로 출정시켜 적을 격파하고 승급 관문을 엽니다.</div></div></div></div>
    <p class="note">⚔️ 전투·영웅 시스템은 <b>v5</b>에서 열립니다. 지금은 자원을 모으고 마을을 키워두세요.</p>`;
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
  animT += dt;
  economyStep(dt);
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
