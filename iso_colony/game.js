// 콜로니 — 나무꾼과 광부 (v1)
// 아이소메트릭 뷰. 졸라맨 일꾼들이 낮엔 나무/돌 채집, 밤엔 집에서 취침, 매일 반복.
// 자원(목재·석탄)이 조금씩 쌓인다. 건설·식량은 다음 버전.
//
// 구성: Config → Iso 좌표 → World(타일·자원·집) → Worker(상태머신) → Time(낮밤) → Render → Loop
// 확장 포인트: RES 종류 추가, 건물/식량/추위 등은 여기 구조 위에 얹으면 됨.
"use strict";

// ── Config ──────────────────────────────────────────────
const TILE_W = 64, TILE_H = 32;      // 마름모 한 칸 크기(픽셀)
const GRID = 12;                     // 12x12 땅
const N_WORKERS = 4;
const DAY_LEN = 40;                  // 하루 = 실시간 40초
const NIGHT_START = 0.68;            // 이 시점부터 밤(집으로)
const DAWN = 0.04;                   // 이 시점부터 아침(기상)
const HARVEST_TIME = 2.4;            // 채집 1회 소요(초)
const RESPAWN_TIME = 7;              // 고갈된 자원 재생(초)
const WALK_SPEED = 2.2;              // 타일/초

// 집(취침 구역) 발자국: gx 0..3, gy 0..1 인 4x2 방
const HOUSE = { x0: 0, y0: 0, x1: 3, y1: 1 };

// ── Canvas ──────────────────────────────────────────────
const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
let VIEW_W = 0, VIEW_H = 0;           // CSS 픽셀 기준 화면 크기
let DPR = 1;
let WSCALE = 1, OFFX = 0, OFFY = 0;   // 맵→화면 배치(자동맞춤: 세로 화면에 꽉 차게)

const MAP_TOP = 66;                   // 나무가 위로 솟는 여유
const SPAN_X = GRID * TILE_W;                                   // 맵 가로 폭
const SPAN_Y = 2 * (GRID - 1) * (TILE_H / 2) + TILE_H + MAP_TOP; // 맵 세로 폭

function resize() {
  DPR = window.devicePixelRatio || 1;          // 폰 고해상도에서 선명하게
  VIEW_W = window.innerWidth;
  VIEW_H = window.innerHeight;
  canvas.width = Math.round(VIEW_W * DPR);
  canvas.height = Math.round(VIEW_H * DPR);
  const pad = 14, topUI = 46;
  WSCALE = Math.min((VIEW_W - pad * 2) / SPAN_X, (VIEW_H - topUI - pad) / SPAN_Y, 1.7);
  OFFX = VIEW_W / 2;                            // 맵 x중심=0 → 화면 중앙
  OFFY = topUI + MAP_TOP * WSCALE;              // 최상단 나무가 UI 아래에 오게
}
window.addEventListener("resize", resize);
window.addEventListener("orientationchange", () => setTimeout(resize, 100));
resize();

// ── Iso 좌표 변환 ────────────────────────────────────────
// 타일(gx,gy) → 맵 좌표. 화면 배치(중앙정렬·스케일)는 render에서 적용.
function iso(gx, gy) {
  return {
    x: (gx - gy) * (TILE_W / 2),
    y: (gx + gy) * (TILE_H / 2),
  };
}
function depth(gx, gy) { return gx + gy; }   // 뒤→앞 그리기 정렬 키

function inHouse(gx, gy) {
  return gx >= HOUSE.x0 && gx <= HOUSE.x1 && gy >= HOUSE.y0 && gy <= HOUSE.y1;
}

// ── World: 자원 노드 ─────────────────────────────────────
const RES = {
  tree: { give: "wood", amount: 5, color: "#4b7a34", label: "🌲" },
  rock: { give: "coal", amount: 6, color: "#7d8590", label: "⛏️" },
};
const resources = [];   // {gx,gy,type,amount,max,respawn}
const beds = [];        // 취침 자리 {gx,gy}
const stock = { wood: 0, coal: 0 };

function buildWorld() {
  // 침대: 집 안에 균등 배치
  for (let i = 0; i < N_WORKERS; i++) {
    const bx = HOUSE.x0 + 0.5 + (i % 4) * 0.9;
    const by = HOUSE.y0 + 0.5 + Math.floor(i / 4) * 0.9;
    beds.push({ gx: bx, gy: by });
  }
  // 자원 노드: 집 밖 타일에 무작위(나무 많이, 돌 적당히)
  const spots = [];
  for (let gx = 0; gx < GRID; gx++)
    for (let gy = 0; gy < GRID; gy++)
      if (!inHouse(gx, gy) && !(gx <= HOUSE.x1 + 1 && gy <= HOUSE.y1)) spots.push({ gx, gy });
  shuffle(spots);
  let idx = 0;
  const add = (type, n) => {
    for (let k = 0; k < n && idx < spots.length; k++, idx++) {
      const s = spots[idx];
      resources.push({ gx: s.gx, gy: s.gy, type, amount: RES[type].amount, max: RES[type].amount, respawn: 0 });
    }
  };
  add("tree", 16);
  add("rock", 9);
}

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
}

// 살아있는(채집 가능) 노드 중 (gx,gy)에 가장 가까운 것
function nearestResource(gx, gy) {
  let best = null, bd = Infinity;
  for (const r of resources) {
    if (r.amount <= 0) continue;
    const d = Math.hypot(r.gx - gx, r.gy - gy);
    if (d < bd) { bd = d; best = r; }
  }
  return best;
}

// ── Worker: 상태머신 ─────────────────────────────────────
// state: "toWork" | "harvest" | "toBed" | "sleep"
class Worker {
  constructor(i) {
    const b = beds[i];
    this.gx = b.gx; this.gy = b.gy;
    this.bed = b;
    this.state = "sleep";
    this.target = null;      // 이동 목표 {gx,gy}
    this.node = null;        // 채집 중인 노드
    this.timer = 0;          // 채집 타이머
    this.phase = Math.random() * Math.PI * 2; // 걷기 애니 위상
    this.color = ["#ffe0b2", "#c8e6c9", "#bbdefb", "#f8bbd0"][i % 4];
    this.carry = null;       // 손에 든 자원(연출용)
    this._face = 1;          // 바라보는 방향(화면 x): +1 우, -1 좌
  }

  update(dt) {
    if (isNight) {
      // 밤: 침대로 가서 잔다
      if (this.state !== "sleep") {
        this.state = "toBed"; this.target = this.bed; this.node = null;
        if (this.moveTo(this.bed, dt)) this.state = "sleep";
      }
      return;
    }
    // 낮
    switch (this.state) {
      case "sleep":
      case "toBed":
        this.state = "toWork"; this.pickWork(); break;
      case "toWork":
        if (!this.node || this.node.amount <= 0) { this.pickWork(); break; }
        if (this.moveTo(this.node, dt)) { this.state = "harvest"; this.timer = HARVEST_TIME; }
        break;
      case "harvest":
        if (!this.node || this.node.amount <= 0) { this.pickWork(); break; }
        this.timer -= dt;
        this.phase += dt * 8;         // 채집 팔 휘두름 애니
        if (this.timer <= 0) {
          this.node.amount--;
          stock[RES[this.node.type].give]++;
          if (this.node.amount <= 0) this.node.respawn = RESPAWN_TIME;
          this.carry = this.node.type;
          this.pickWork();          // 다음 대상 탐색
        }
        break;
    }
  }

  pickWork() {
    this.node = nearestResource(this.gx, this.gy);
    this.state = this.node ? "toWork" : "toBed";
    this.target = this.node || this.bed;
  }

  // target까지 dt만큼 이동. 도착하면 true.
  moveTo(t, dt) {
    const dx = t.gx - this.gx, dy = t.gy - this.gy;
    const d = Math.hypot(dx, dy);
    const step = WALK_SPEED * dt;
    if (d <= step || d < 0.02) { this.gx = t.gx; this.gy = t.gy; return true; }
    this.gx += (dx / d) * step; this.gy += (dy / d) * step;
    this.phase += dt * 10;
    return false;
  }
}

const workers = [];

// ── Time: 낮/밤 ─────────────────────────────────────────
let t = DAWN * DAY_LEN + 0.01;   // 첫 시작은 아침 직후
let day = 1;
let isNight = false;

function updateTime(dt) {
  t += dt;
  if (t >= DAY_LEN) { t -= DAY_LEN; day++; }
  const p = t / DAY_LEN;
  isNight = p >= NIGHT_START || p < DAWN;
  // HUD
  document.getElementById("day").textContent = day;
  const hh = Math.floor(p * 24), mm = Math.floor((p * 24 % 1) * 60);
  document.getElementById("clock").textContent =
    String(hh).padStart(2, "0") + ":" + String(mm).padStart(2, "0");
  document.getElementById("phase").textContent =
    p < DAWN ? "새벽" : p < 0.28 ? "아침" : p < 0.5 ? "한낮" : p < NIGHT_START ? "오후" : "밤";
  document.getElementById("wood").textContent = stock.wood;
  document.getElementById("coal").textContent = stock.coal;
}

function updateResources(dt) {
  for (const r of resources) {
    if (r.amount <= 0 && r.respawn > 0) {
      r.respawn -= dt;
      if (r.respawn <= 0) r.amount = r.max;
    }
  }
}

// ── Render ──────────────────────────────────────────────
function drawTileFloor(gx, gy, top, side1, side2) {
  const p = iso(gx, gy);
  // 마름모 윗면
  ctx.beginPath();
  ctx.moveTo(p.x, p.y);
  ctx.lineTo(p.x + TILE_W / 2, p.y + TILE_H / 2);
  ctx.lineTo(p.x, p.y + TILE_H);
  ctx.lineTo(p.x - TILE_W / 2, p.y + TILE_H / 2);
  ctx.closePath();
  ctx.fillStyle = top; ctx.fill();
  ctx.strokeStyle = "rgba(0,0,0,0.08)"; ctx.stroke();
}

function drawGround() {
  for (let s = 0; s <= 2 * (GRID - 1); s++) {
    for (let gx = 0; gx < GRID; gx++) {
      const gy = s - gx;
      if (gy < 0 || gy >= GRID) continue;
      const shade = (gx + gy) % 2 === 0 ? "#6b9b45" : "#638f40";
      drawTileFloor(gx, gy, shade);
    }
  }
}

// 집: 지붕 없는 방(바닥 나무 + 뒤쪽 두 벽 + 침대) — 내부가 보인다
function drawHouse() {
  // 바닥(나무 널)
  for (let gx = HOUSE.x0; gx <= HOUSE.x1; gx++)
    for (let gy = HOUSE.y0; gy <= HOUSE.y1; gy++)
      drawTileFloor(gx, gy, "#a9773f");
  const wallH = 26;
  // 뒤-왼 벽 (gy = y0 모서리, gx 축을 따라)
  const a = iso(HOUSE.x0, HOUSE.y0), b = iso(HOUSE.x1 + 1, HOUSE.y0);
  wallQuad(a, b, wallH, "#8a5a2b", "#75491f");
  // 뒤-오른 벽 (gx = x0 모서리, gy 축을 따라)
  const c = iso(HOUSE.x0, HOUSE.y0), d = iso(HOUSE.x0, HOUSE.y1 + 1);
  wallQuad(c, d, wallH, "#7a4e24", "#66401d");
  // 침대
  for (const bd of beds) drawBed(bd.gx, bd.gy);
}
function wallQuad(p1, p2, h, faceCol, topCol) {
  ctx.beginPath();
  ctx.moveTo(p1.x, p1.y);
  ctx.lineTo(p2.x, p2.y);
  ctx.lineTo(p2.x, p2.y - h);
  ctx.lineTo(p1.x, p1.y - h);
  ctx.closePath();
  ctx.fillStyle = faceCol; ctx.fill();
  ctx.strokeStyle = topCol; ctx.stroke();
}
function drawBed(gx, gy) {
  const p = iso(gx, gy);
  ctx.fillStyle = "#c96f4a";       // 매트
  diamond(p.x, p.y, 26, 14);
  ctx.fillStyle = "#eee";          // 베개
  diamond(p.x - 6, p.y - 3, 12, 7);
}
function diamond(cx, cy, w, h) {
  ctx.beginPath();
  ctx.moveTo(cx, cy - h / 2);
  ctx.lineTo(cx + w / 2, cy);
  ctx.lineTo(cx, cy + h / 2);
  ctx.lineTo(cx - w / 2, cy);
  ctx.closePath();
  ctx.fill();
}

function drawTree(gx, gy) {
  const p = iso(gx, gy);
  const bx = p.x, by = p.y + TILE_H / 2;
  // 기둥
  ctx.fillStyle = "#6b4a2b";
  ctx.fillRect(bx - 4, by - 26, 8, 28);
  // 잎(겹친 타원 3단, 톤 차이)
  const leaves = [["#3f6b2e", 0, 0, 30, 20], ["#4b7d38", 0, -14, 26, 17], ["#568c40", 0, -26, 20, 13]];
  for (const [c, ox, oy, w, h] of leaves) {
    ctx.fillStyle = c;
    ctx.beginPath();
    ctx.ellipse(bx + ox, by - 30 + oy, w / 2, h / 2, 0, 0, Math.PI * 2);
    ctx.fill();
  }
}
function drawRock(gx, gy) {
  const p = iso(gx, gy);
  const bx = p.x, by = p.y + TILE_H / 2 - 4;
  const chunks = [["#8b929b", -8, 2, 20, 13], ["#6f767f", 6, 4, 16, 11], ["#a3aab3", -2, -6, 15, 10]];
  for (const [c, ox, oy, w, h] of chunks) {
    ctx.fillStyle = c;
    ctx.beginPath();
    ctx.ellipse(bx + ox, by + oy, w / 2, h / 2, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  // 석탄 알갱이
  ctx.fillStyle = "#2b2b30";
  ctx.beginPath(); ctx.arc(bx - 3, by - 2, 2.5, 0, 7); ctx.fill();
  ctx.beginPath(); ctx.arc(bx + 4, by + 2, 2, 0, 7); ctx.fill();
}

// 2관절 팔다리: (x0,y0)어깨/엉덩 → 관절 → (x1,y1)손/발. bend=관절 꺾임 offset.
function limb(x0, y0, x1, y1, bend, width) {
  const dx = x1 - x0, dy = y1 - y0, len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len, ny = dx / len;                 // 수직 방향
  const jx = (x0 + x1) / 2 + nx * bend, jy = (y0 + y1) / 2 + ny * bend;  // 관절 위치
  ctx.lineWidth = width;
  ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(jx, jy); ctx.lineTo(x1, y1); ctx.stroke();
}

// 도끼: 손잡이 + 삼각 날
function drawAxe(gx, gy, ex, ey) {
  const dx = ex - gx, dy = ey - gy, L = Math.hypot(dx, dy) || 1;
  const ux = dx / L, uy = dy / L, px = -uy, py = ux;
  ctx.strokeStyle = "#6b4a2b"; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(gx, gy); ctx.lineTo(ex, ey); ctx.stroke();
  ctx.fillStyle = "#cdd4dc"; ctx.strokeStyle = "#8b939d"; ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(ex - ux * 5 + px * 7, ey - uy * 5 + py * 7);
  ctx.lineTo(ex + ux * 6 + px * 5, ey + uy * 6 + py * 5);
  ctx.lineTo(ex + ux * 6 - px * 5, ey + uy * 6 - py * 5);
  ctx.lineTo(ex - ux * 5 - px * 7, ey - uy * 5 - py * 7);
  ctx.closePath(); ctx.fill(); ctx.stroke();
}

// 곡괭이: 손잡이 + 양쪽 뾰족 머리
function drawPickaxe(gx, gy, ex, ey) {
  const dx = ex - gx, dy = ey - gy, L = Math.hypot(dx, dy) || 1;
  const ux = dx / L, uy = dy / L, px = -uy, py = ux;
  ctx.strokeStyle = "#6b4a2b"; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(gx, gy); ctx.lineTo(ex, ey); ctx.stroke();
  ctx.strokeStyle = "#b9c0c9"; ctx.lineWidth = 3.5; ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(ex + px * 9 - ux * 3, ey + py * 9 - uy * 3);
  ctx.quadraticCurveTo(ex + ux * 2, ey + uy * 2, ex - px * 9 - ux * 3, ey - py * 9 - uy * 3);
  ctx.stroke();
}

// 졸라맨(관절형). 낮=걷기/채집(도끼·곡괭이), 밤=취침.
function drawWorker(w) {
  const p = iso(w.gx, w.gy);
  const cx = p.x, gy = p.y + TILE_H / 2;

  // 취침
  if (w.state === "sleep") {
    ctx.strokeStyle = "#222"; ctx.lineWidth = 3; ctx.lineCap = "round"; ctx.fillStyle = w.color;
    ctx.beginPath(); ctx.arc(cx - 12, gy - 6, 5, 0, 7); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx - 8, gy - 6); ctx.lineTo(cx + 11, gy - 5); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx + 11, gy - 5); ctx.lineTo(cx + 16, gy - 9); ctx.stroke(); // 다리 접힘
    ctx.fillStyle = "#cfe0ff"; ctx.font = "italic 12px sans-serif";
    ctx.fillText("z", cx + 4, gy - 15); ctx.fillText("Z", cx + 10, gy - 22);
    return;
  }

  // 바라보는 방향 갱신
  let fx = null;
  if (w.state === "harvest" && w.node) fx = iso(w.node.gx, w.node.gy).x;
  else if (w.target) fx = iso(w.target.gx, w.target.gy).x;
  if (fx !== null && Math.abs(fx - cx) > 0.5) w._face = fx >= cx ? 1 : -1;
  const face = w._face;

  const hipY = gy - 15, shY = gy - 29, headY = gy - 36;
  const moving = (w.state === "toWork" || w.state === "toBed");
  const harvesting = w.state === "harvest";

  ctx.lineCap = "round"; ctx.strokeStyle = "#2b2b2b";

  // ── 다리 ──
  let footLX, footLY, footRX, footRY;
  if (moving) {
    const ph = w.phase;
    footLX = cx + Math.sin(ph) * 6 * face;      footLY = gy - Math.max(0, Math.cos(ph)) * 4;
    footRX = cx + Math.sin(ph + Math.PI) * 6 * face; footRY = gy - Math.max(0, Math.cos(ph + Math.PI)) * 4;
  } else {
    footLX = cx - 4; footLY = gy; footRX = cx + 5; footRY = gy;   // 선 자세
  }
  limb(cx - 1, hipY, footLX, footLY, -face * 3, 3);   // 뒷다리
  limb(cx + 1, hipY, footRX, footRY, -face * 3, 3);   // 앞다리

  // ── 몸통 ──
  const leanX = harvesting ? face * 3 : (moving ? face * 1.5 : 0);
  ctx.lineWidth = 3.5;
  ctx.beginPath(); ctx.moveTo(cx, hipY); ctx.lineTo(cx + leanX, shY); ctx.stroke();
  const shX = cx + leanX;

  // ── 팔 + 도구 ──
  if (harvesting) {
    // 두 손으로 도구를 쥐고 머리 위→아래로 내리침
    const raise = (Math.cos(w.phase) + 1) / 2;          // 1=치켜듦, 0=내리침
    const ang = (-2.3) + (2.9) * (1 - raise);           // 스윙 각(위→아래)
    const gxp = shX + Math.cos(ang) * 12 * face;
    const gyp = shY + Math.sin(ang) * 12;
    // 도구 끝
    const ex = gxp + Math.cos(ang) * 16 * face, ey = gyp + Math.sin(ang) * 16;
    limb(shX - 2, shY, gxp, gyp, face * 3, 3);          // 양팔이 그립으로
    limb(shX + 2, shY, gxp, gyp, face * 3, 3);
    if (w.node && w.node.type === "rock") drawPickaxe(gxp, gyp, ex, ey);
    else drawAxe(gxp, gyp, ex, ey);
    ctx.strokeStyle = "#2b2b2b";
  } else {
    const sw = moving ? Math.sin(w.phase) * 5 * face : 0;
    limb(shX, shY, shX - sw, shY + 12, -face * 4, 3);   // 뒤팔
    limb(shX, shY, shX + sw, shY + 12, face * 4, 3);    // 앞팔
  }

  // ── 머리 ──
  ctx.fillStyle = w.color;
  ctx.beginPath(); ctx.arc(shX, headY, 5.5, 0, 7); ctx.fill();
  ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(shX, headY, 5.5, 0, 7); ctx.stroke();
}

// 밤 오버레이
function drawNightOverlay() {
  const p = t / DAY_LEN;
  let a = 0;
  if (p >= NIGHT_START) a = Math.min(0.55, (p - NIGHT_START) / (1 - NIGHT_START) * 0.7);
  else if (p < DAWN) a = 0.55;
  else if (p < DAWN + 0.06) a = 0.55 * (1 - (p - DAWN) / 0.06);
  if (a > 0.01) { ctx.fillStyle = `rgba(18,26,54,${a})`; ctx.fillRect(0, 0, VIEW_W, VIEW_H); }
}

function render() {
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ctx.clearRect(0, 0, VIEW_W, VIEW_H);
  // 맵 배치: 중앙정렬 + 자동맞춤 스케일
  ctx.setTransform(DPR * WSCALE, 0, 0, DPR * WSCALE, OFFX * DPR, OFFY * DPR);
  drawGround();
  drawHouse();
  // 키 큰 오브젝트(자원·일꾼) 깊이 정렬 후 그리기
  const tall = [];
  for (const r of resources) {
    if (r.amount <= 0) continue;
    tall.push({ d: depth(r.gx, r.gy), y: iso(r.gx, r.gy).y, fn: () => r.type === "tree" ? drawTree(r.gx, r.gy) : drawRock(r.gx, r.gy) });
  }
  for (const w of workers)
    tall.push({ d: depth(w.gx, w.gy), y: iso(w.gx, w.gy).y, fn: () => drawWorker(w) });
  tall.sort((a, b) => a.d - b.d || a.y - b.y);
  for (const o of tall) o.fn();
  // 밤 오버레이는 화면 전체(스케일 해제)
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  drawNightOverlay();
}

// ── Loop ────────────────────────────────────────────────
let last = 0;
function frame(ts) {
  const dt = Math.min(0.05, (ts - last) / 1000 || 0);
  last = ts;
  updateTime(dt);
  updateResources(dt);
  for (const w of workers) w.update(dt);
  render();
  requestAnimationFrame(frame);
}

// ── Init ────────────────────────────────────────────────
buildWorld();
for (let i = 0; i < N_WORKERS; i++) workers.push(new Worker(i));
requestAnimationFrame(frame);
