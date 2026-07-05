// estate_tycoon — 맵을 돌아다니는 앰비언트 NPC
//  ① 자유 배회형(count): 빈 땅을 서성인다 (예: 왕).
//  ② 작업형(building): 건물마다 1명. 그 건물이 가동 중이면 앞으로 가서 work 애니(공격 등),
//     할 일 없으면 자유 배회. 저장 안 됨(접속할 때마다 새로 생성).
"use strict";

const NPCS = [];
let npcsReady = false;
let lastNpcTs = 0;

function npcRand(a, b) { return a + Math.random() * (b - a); }
function npcFrameURL(cfg, name) { return cfg.base + "/" + name + ".png"; }

// NPC가 밟을 수 있는 칸: 개간된 땅 + 물·지형지물·건물 아님
function npcWalkable(gx, gy) {
  if (gx < 0 || gy < 0 || gx >= MAP_W || gy >= MAP_H) return false;
  if (!landOpen(gx, gy)) return false;
  if (tileBlocked(gx, gy)) return false;      // 물·지형지물·override 차단 포함
  if (buildingAtTile(gx, gy)) return false;   // 건물 위 금지
  return true;
}
// 열린 땅 아무 빈 칸 (자유 배회형 시작 위치용)
function randomWalkable() {
  for (let t = 0; t < 300; t++) {
    const gx = Math.floor(Math.random() * MAP_W);
    const gy = Math.floor(Math.random() * MAP_H);
    if (npcWalkable(gx, gy)) return { gx, gy };
  }
  return null;
}
// 건물 "앞"(남쪽) 우선으로 걸을 수 있는 칸 하나 — 작업 자리
function workSpot(b) {
  const f = footDims(b.type, b.dir);
  const mid = b.gx + Math.floor(f.w / 2);
  const cands = [[mid, b.gy + f.h]];                                   // 앞 가운데
  for (let x = 0; x < f.w; x++) if (b.gx + x !== mid) cands.push([b.gx + x, b.gy + f.h]); // 앞 줄
  for (let y = 0; y < f.h; y++) cands.push([b.gx + f.w, b.gy + y]);    // 오른쪽
  for (let y = 0; y < f.h; y++) cands.push([b.gx - 1, b.gy + y]);      // 왼쪽
  for (let x = 0; x < f.w; x++) cands.push([b.gx + x, b.gy - 1]);      // 뒤
  for (const c of cands) if (npcWalkable(c[0], c[1])) return c;
  return null;
}
function firstOpenAround(b) {
  const f = footDims(b.type, b.dir);
  for (let x = -1; x <= f.w; x++) for (let y = -1; y <= f.h; y++)
    if (npcWalkable(b.gx + x, b.gy + y)) return [b.gx + x, b.gy + y];
  return null;
}

function makeNpc(type, gx, gy, boundIid) {
  const cfg = GAME_DATA.npcs[type];
  return {
    type, boundIid: boundIid != null ? boundIid : null,
    fx: gx, fy: gy, tx: gx, ty: gy,
    state: "idle", timer: npcRand(cfg.idleMin || 1, cfg.idleMax || 4),
    face: 1, animT: 0,
  };
}
// 자유 배회형(count) — 최초 1회만 생성
function spawnWanderers() {
  const defs = GAME_DATA.npcs || {};
  for (const type in defs) {
    const cfg = defs[type];
    if (cfg.building) continue;
    for (let i = 0; i < (cfg.count || 0); i++) {
      const s = randomWalkable();
      if (s) NPCS.push(makeNpc(type, s.gx, s.gy, null));
    }
  }
}
// 작업형(building) — 건물마다 1명. 매 틱 동기화(건물이 생기면 추가, 없어지면 제거)
function reconcileWorkers() {
  const defs = GAME_DATA.npcs || {};
  const wanted = new Set();
  for (const type in defs) {
    const cfg = defs[type];
    if (!cfg.building) continue;
    for (const b of byType(cfg.building)) {
      if (b.constructing) continue;   // 공사 중엔 일꾼 대신 노움이 붙는다
      wanted.add(b.iid);
      if (!NPCS.some(n => n.boundIid === b.iid)) {
        const s = workSpot(b) || firstOpenAround(b);
        if (s) NPCS.push(makeNpc(type, s[0], s[1], b.iid));
      }
    }
  }
  for (let i = NPCS.length - 1; i >= 0; i--) {
    const n = NPCS[i];
    if (n.boundIid != null && !wanted.has(n.boundIid)) NPCS.splice(i, 1);
  }
}

/* ── 이동 헬퍼 ── */
function npcFaceToward(n, gx, gy) {  // 화면상 좌우: screen dx ∝ (dgx - dgy)
  const sdx = (gx - n.fx) - (gy - n.fy);
  if (Math.abs(sdx) > 0.001) n.face = sdx > 0 ? 1 : -1;
}
function stepMove(n, spd) {          // 목표(tx,ty)로 이동. 도착하면 true
  const ddx = n.tx - n.fx, ddy = n.ty - n.fy;
  const dist = Math.hypot(ddx, ddy);
  if (dist <= spd || dist < 1e-6) { n.fx = n.tx; n.fy = n.ty; return true; }
  n.fx += ddx / dist * spd; n.fy += ddy / dist * spd; return false;
}
function stepTileToward(n, gx, gy) { // 목표에 가까워지는 이웃 칸 하나
  const cx = Math.round(n.fx), cy = Math.round(n.fy);
  let best = null, bestD = Infinity;
  for (const d of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const nx = cx + d[0], ny = cy + d[1];
    if (!npcWalkable(nx, ny)) continue;
    const dd = Math.abs(nx - gx) + Math.abs(ny - gy);
    if (dd < bestD) { bestD = dd; best = [nx, ny]; }
  }
  return best;
}
function randWanderTile(n) {         // 걸을 수 있는 이웃 칸 하나 랜덤
  const cx = Math.round(n.fx), cy = Math.round(n.fy);
  const opts = [];
  for (const d of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (npcWalkable(cx + d[0], cy + d[1])) opts.push([cx + d[0], cy + d[1]]);
  return opts.length ? opts[Math.floor(Math.random() * opts.length)] : null;
}

function updateNpcOne(n, dt) {
  const cfg = GAME_DATA.npcs[n.type];
  n.animT += dt;
  const b = n.boundIid != null ? byIid(n.boundIid) : null;
  const working = !!(b && b.queue && b.queue.length > 0);
  const spot = working ? workSpot(b) : null;

  // 이동 중이면 계속 이동 (도착 못 했으면 여기서 끝)
  if (n.state === "walk" && !stepMove(n, (cfg.speed || 1) * dt)) {
    npcFaceToward(n, n.tx, n.ty);
    return;
  }

  if (working && spot) {
    // 건물 가동 중 → 작업 자리로 가서 work
    if (Math.round(n.fx) === spot[0] && Math.round(n.fy) === spot[1]) {
      n.fx = spot[0]; n.fy = spot[1];
      n.state = "work";
      const f = footDims(b.type, b.dir);
      npcFaceToward(n, b.gx + f.w / 2, b.gy + f.h / 2);  // 건물 쪽 바라봄
      return;
    }
    const nx = stepTileToward(n, spot[0], spot[1]);
    if (nx) { n.tx = nx[0]; n.ty = nx[1]; n.state = "walk"; npcFaceToward(n, nx[0], nx[1]); }
    else { n.state = "idle"; n.timer = 0.4; }  // 길 막힘: 잠깐 뒤 재시도
    return;
  }

  // 할 일 없음 → 자유 배회
  if (n.state !== "idle") { n.state = "idle"; n.timer = npcRand(cfg.idleMin || 1, cfg.idleMax || 4); }
  n.timer -= dt;
  if (n.timer <= 0) {
    const t = randWanderTile(n);
    if (t) { n.tx = t[0]; n.ty = t[1]; n.state = "walk"; npcFaceToward(n, t[0], t[1]); }
    else n.timer = npcRand(cfg.idleMin || 1, cfg.idleMax || 4);
  }
}

function updateNpcs(now) {
  reconcileWorkers();  // 건물 작업 NPC 매 틱 동기화
  if (!npcsReady) { spawnWanderers(); npcsReady = true; lastNpcTs = now; return; }
  let dt = (now - lastNpcTs) / 1000;
  lastNpcTs = now;
  if (dt <= 0) return;
  if (dt > 0.25) dt = 0.25;  // 탭 복귀·오프라인 등 큰 점프에서 순간이동 방지
  for (const n of NPCS) updateNpcOne(n, dt);
}

// 렌더는 깊이 정렬 목록에 섞여 그려진다 (render.js에서 호출)
function drawNpc(g, n) {
  const cfg = GAME_DATA.npcs[n.type];
  const frames = n.state === "work" ? (cfg.work || cfg.idle)
    : n.state === "walk" ? (cfg.walk || cfg.idle)
      : cfg.idle;
  const idx = frames && frames.length ? Math.floor(n.animT * (cfg.fps || 6)) % frames.length : 0;
  const img = frames && frames.length ? getImg(npcFrameURL(cfg, frames[idx])) : null;
  const cx = isoX(n.fx + 0.5, n.fy + 0.5);
  const footY = isoY(n.fx + 0.5, n.fy + 0.5) + TILE_H / 2;  // 타일 앞쪽 바닥
  const tw = TILE_W * (cfg.scale || 1.2);
  const th = imgOK(img) ? tw * (img.naturalHeight / img.naturalWidth) : tw;
  const x = cx - tw / 2, y = footY - th;
  if (imgOK(img)) {
    if (n.face < 0) {
      g.save(); g.translate(x + tw, y); g.scale(-1, 1);
      g.drawImage(img, 0, 0, tw, th); g.restore();
    } else {
      g.drawImage(img, x, y, tw, th);
    }
  } else {
    g.fillStyle = "rgba(230,200,60,0.9)";
    g.beginPath(); g.arc(cx, footY - th / 2, tw * 0.2, 0, Math.PI * 2); g.fill();
  }
}
