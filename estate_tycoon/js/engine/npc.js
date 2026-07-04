// estate_tycoon — 맵을 돌아다니는 앰비언트 NPC (예: 왕이 빈 땅을 산책)
// 저장에 안 들어간다(접속할 때마다 새로 생성). 건물·경제와 무관한 순수 장식.
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
// 열린 땅 아무 빈 칸 (시작 위치용)
function randomWalkable() {
  for (let t = 0; t < 300; t++) {
    const gx = Math.floor(Math.random() * MAP_W);
    const gy = Math.floor(Math.random() * MAP_H);
    if (npcWalkable(gx, gy)) return { gx, gy };
  }
  return null;
}

function spawnNpcs() {
  NPCS.length = 0;
  const defs = GAME_DATA.npcs || {};
  for (const type in defs) {
    const cfg = defs[type];
    for (let i = 0; i < (cfg.count || 0); i++) {
      const spot = randomWalkable();
      if (!spot) continue;
      NPCS.push({
        type, fx: spot.gx, fy: spot.gy,   // 실수 위치(타일 좌표)
        tx: spot.gx, ty: spot.gy,          // 목표 칸
        state: "idle", timer: npcRand(cfg.idleMin || 1, cfg.idleMax || 4),
        face: 1,                            // 1=오른쪽, -1=왼쪽
        animT: 0,
      });
    }
  }
  npcsReady = true;
}

// 인접 4칸 중 밟을 수 있는 곳 하나를 목표로 (건물 사이로 못 지나가게 한 칸씩 이동)
function pickNpcTarget(n) {
  const gx = Math.round(n.fx), gy = Math.round(n.fy);
  const opts = [];
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    if (npcWalkable(gx + dx, gy + dy)) opts.push([gx + dx, gy + dy]);
  }
  if (!opts.length) return false;
  const [tx, ty] = opts[Math.floor(Math.random() * opts.length)];
  n.tx = tx; n.ty = ty; n.state = "walk";
  // 화면상 좌우 이동 방향으로 바라봄: screen dx ∝ (dgx - dgy)
  const sdx = (tx - gx) - (ty - gy);
  if (sdx !== 0) n.face = sdx > 0 ? 1 : -1;
  return true;
}

function updateNpcs(now) {
  if (!npcsReady) { spawnNpcs(); lastNpcTs = now; return; }
  let dt = (now - lastNpcTs) / 1000;
  lastNpcTs = now;
  if (dt <= 0) return;
  if (dt > 0.25) dt = 0.25;   // 탭 복귀·오프라인 등 큰 점프에서 순간이동 방지
  for (const n of NPCS) {
    const cfg = GAME_DATA.npcs[n.type];
    n.animT += dt;
    if (n.state === "idle") {
      n.timer -= dt;
      if (n.timer <= 0 && !pickNpcTarget(n)) n.timer = npcRand(cfg.idleMin || 1, cfg.idleMax || 4);
    } else {
      const spd = (cfg.speed || 1) * dt;
      const ddx = n.tx - n.fx, ddy = n.ty - n.fy;
      const dist = Math.hypot(ddx, ddy);
      if (dist <= spd || dist < 0.001) {
        n.fx = n.tx; n.fy = n.ty;
        n.state = "idle"; n.timer = npcRand(cfg.idleMin || 1, cfg.idleMax || 4);
      } else {
        n.fx += ddx / dist * spd;
        n.fy += ddy / dist * spd;
      }
    }
  }
}

// 렌더는 깊이 정렬 목록에 섞여 그려진다 (render.js에서 호출)
function drawNpc(g, n) {
  const cfg = GAME_DATA.npcs[n.type];
  const frames = (n.state === "walk" ? cfg.walk : cfg.idle) || cfg.idle;
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
