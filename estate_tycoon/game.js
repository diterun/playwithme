// estate_tycoon — 엔진 (밸런스·좌표는 data.js, 그림 교체는 assets.js, 여기는 로직만)
"use strict";

/* ═══════════════ 기본 상수 ═══════════════ */
const TILE_W = 64, TILE_H = 32;
const MAP_W = GAME_DATA.map.w, MAP_H = GAME_DATA.map.h;
const DIRS = ["SE", "SW", "NW", "NE"];        // 회전 순서 (90도씩)
const ASSET_BASE = "../assets/building/";     // 건물 PNG 기본 위치
const BTYPES = Object.keys(GAME_DATA.buildings);

const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
let DPR = 1, W = 0, H = 0;

function resize() {
  DPR = Math.min(window.devicePixelRatio || 1, 3);
  W = window.innerWidth; H = window.innerHeight;
  canvas.width = Math.round(W * DPR);
  canvas.height = Math.round(H * DPR);
}
window.addEventListener("resize", resize);
resize();

/* ═══════════════ 게임 상태 ═══════════════ */
// 건물은 "인스턴스" 배열 — 같은 종류를 여러 채 지을 수 있다.
// { iid, type, gx, gy, dir, level, queue: [작업...], accum: 집이 모은 골드 }
// 대기열 작업: 생산 = { r: 레시피번호, dur: 초, end: 완료시각(ms)|null(대기중) }
//             판매 = { res, qty, gold, dur, end }
function addBuilding(st, type, gx, gy, dir) {
  const inst = { iid: st.nextIid++, type, gx, gy, dir, level: 1, queue: [], accum: 0 };
  st.buildings.push(inst);
  return inst;
}
function freshState() {
  const st = {
    version: GAME_DATA.version,
    res: Object.assign({}, GAME_DATA.start),
    buildings: [],
    nextIid: 1,
    createdTs: Date.now(),
  };
  for (const sb of GAME_DATA.startBuildings) addBuilding(st, sb.type, sb.gx, sb.gy, sb.dir);
  return st;
}
let state = freshState();

function bdef(type) { return GAME_DATA.buildings[type]; }
function byType(type) { return state.buildings.filter(b => b.type === type); }
function byIid(iid) { return state.buildings.find(b => b.iid === iid) || null; }
function castleLevel() { const c = byType("castle")[0]; return c ? c.level : 1; }
function marketB() { return byType("market")[0] || null; }
function isHouse(type) { return !!bdef(type).house; }
function isProd(type) { return !!bdef(type).recipes; }

/* ═══════════════ 좌표·발판 ═══════════════ */
function isoX(gx, gy) { return (gx - gy) * TILE_W / 2; }
function isoY(gx, gy) { return (gx + gy) * TILE_H / 2; }

function footDims(type, dir) {
  const d = bdef(type);
  const rot = (dir === "SW" || dir === "NE");
  return { w: rot ? d.h : d.w, h: rot ? d.w : d.h };
}
function rectsOverlap(a, b) {
  return a.gx < b.gx + b.w && b.gx < a.gx + a.w && a.gy < b.gy + b.h && b.gy < a.gy + a.h;
}
// 놓을 수 있나: 맵 안 + 배치금지 칸 아님 + 다른 건물과 안 겹침 (excludeIid = 이동 중인 자기 자신)
function validPos(type, gx, gy, dir, excludeIid) {
  const f = footDims(type, dir);
  if (gx < 0 || gy < 0 || gx + f.w > MAP_W || gy + f.h > MAP_H) return false;
  for (let x = gx; x < gx + f.w; x++) {
    for (let y = gy; y < gy + f.h; y++) {
      if (tileBlocked(x, y)) return false;
    }
  }
  for (const ob of state.buildings) {
    if (ob.iid === excludeIid) continue;
    const of = footDims(ob.type, ob.dir);
    if (rectsOverlap({ gx, gy, w: f.w, h: f.h }, { gx: ob.gx, gy: ob.gy, w: of.w, h: of.h })) return false;
  }
  return true;
}

/* ═══════════════ 에셋 로드 ═══════════════ */
const IMGS = {}; // url → Image
let groundDirty = true;

function getImg(url) {
  if (!url || typeof Image === "undefined") return null; // 헤드리스 테스트 가드
  if (!IMGS[url]) {
    const img = new Image();
    img.onload = () => { img._ready = true; groundDirty = true; };
    img.src = (window.EMBEDDED_ASSETS && window.EMBEDDED_ASSETS[url]) || url;
    IMGS[url] = img;
  }
  return IMGS[url];
}
function imgOK(img) { return img && img._ready && img.naturalWidth > 0; }

function buildingImgURL(type, dir) {
  const ov = ASSET_MAP.buildings && ASSET_MAP.buildings[type];
  if (ov) {
    if (typeof ov === "string") return ov + "_" + dir + ".png";
    if (ov[dir]) return ov[dir];
  }
  return ASSET_BASE + bdef(type).img + "_" + dir + ".png";
}
function groundOverrideAt(gx, gy) {
  const g = ASSET_MAP.ground || {};
  const o = g.overrides && g.overrides[gx + "," + gy];
  if (!o) return null;
  return typeof o === "string" ? { img: o } : o;
}
function groundTileURL(gx, gy) {
  const ov = groundOverrideAt(gx, gy);
  const g = ASSET_MAP.ground || {};
  return (ov && ov.img) || g.grassDefault || null;
}

// 지형지물(나무·돌) — assets.js features. 파일 수정 후 새로고침해야 반영.
const FEATURES = (function () {
  const out = [];
  const fs = ASSET_MAP.features || {};
  for (const k in fs) {
    const v = typeof fs[k] === "string" ? { img: fs[k] } : fs[k];
    const c = k.split(",");
    out.push({
      gx: +c[0], gy: +c[1],
      img: v.img || null,
      scale: v.scale || 1.0,
      foot: v.foot != null ? v.foot : 1.0,
      dx: v.dx || 0, dy: v.dy || 0,
      block: v.block !== false,
    });
  }
  return out;
})();
const FEAT_BLOCK = new Set(FEATURES.filter(f => f.block).map(f => f.gx + "," + f.gy));

function tileBlocked(gx, gy) {
  const ov = groundOverrideAt(gx, gy);
  if (ov && ov.block) return true;
  return FEAT_BLOCK.has(gx + "," + gy);
}
(function preload() {
  for (const t of BTYPES) for (const dir of DIRS) getImg(buildingImgURL(t, dir));
  const g = ASSET_MAP.ground || {};
  if (g.grassDefault) getImg(g.grassDefault);
  if (g.overrides) for (const k in g.overrides) {
    const v = g.overrides[k];
    getImg(typeof v === "string" ? v : v.img);
  }
  for (const ft of FEATURES) if (ft.img) getImg(ft.img);
})();

/* ═══════════════ 카메라 ═══════════════ */
const cam = { x: 0, y: 0, s: 1 };
(function initCam() {
  const c = byType("castle")[0] || state.buildings[0];
  const f = footDims(c.type, c.dir);
  cam.x = isoX(c.gx + f.w / 2, c.gy + f.h / 2);
  cam.y = isoY(c.gx + f.w / 2, c.gy + f.h / 2);
  cam.s = Math.max(0.45, Math.min(1.0, W / 1000));
})();
function clampCam() {
  cam.s = Math.max(0.25, Math.min(2.5, cam.s));
  cam.x = Math.max(-MAP_H * TILE_W / 2, Math.min(MAP_W * TILE_W / 2, cam.x));
  cam.y = Math.max(0, Math.min((MAP_W + MAP_H) * TILE_H / 2, cam.y));
}
function screenToWorld(sx, sy) {
  return { x: (sx - W / 2) / cam.s + cam.x, y: (sy - H / 2) / cam.s + cam.y };
}
function worldToTile(wx, wy) {
  return { gx: Math.floor(wy / TILE_H + wx / TILE_W), gy: Math.floor(wy / TILE_H - wx / TILE_W) };
}

/* ═══════════════ 지형 (오프스크린 프리렌더) ═══════════════ */
function hash2(x, y) {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = (h ^ (h >> 13)) * 1274126177 | 0;
  return ((h ^ (h >> 16)) >>> 0) / 4294967296;
}
const GPAD = 24, GSCALE = 1.5;
const G_X0 = -MAP_H * TILE_W / 2 - GPAD;
const G_Y0 = -GPAD;
const G_W = (MAP_W + MAP_H) * TILE_W / 2 + GPAD * 2;
const G_H = (MAP_W + MAP_H) * TILE_H / 2 + GPAD * 2;
let groundCanvas = null;

function buildGround() {
  if (typeof document.createElement !== "function") return;
  const gc = document.createElement("canvas");
  gc.width = Math.round(G_W * GSCALE); gc.height = Math.round(G_H * GSCALE);
  const g = gc.getContext("2d");
  if (!g) return;
  g.setTransform(GSCALE, 0, 0, GSCALE, -G_X0 * GSCALE, -G_Y0 * GSCALE);
  const cols = ["#4c7a3f", "#527f43", "#478040", "#4a7d45"];
  const gset = ASSET_MAP.ground || {};
  const tsc = gset.tileScale || 1.0;
  const tft = gset.tileFoot != null ? gset.tileFoot : 1.0;
  const tanchor = gset.tileAnchor || "bottom";
  for (let gy = 0; gy < MAP_H; gy++) {
    for (let gx = 0; gx < MAP_W; gx++) {
      const cx = isoX(gx, gy), cy = isoY(gx, gy);
      const ov = groundOverrideAt(gx, gy);
      const timg = getImg(groundTileURL(gx, gy));
      if (imgOK(timg)) {
        const sc = (ov && ov.scale) || tsc;
        const anchor = (ov && ov.anchor) || tanchor;
        const ft = (ov && ov.foot != null) ? ov.foot : tft;
        const tw = TILE_W * sc;
        const th = tw * (timg.naturalHeight / timg.naturalWidth);
        const ty = anchor === "top" ? cy : cy + TILE_H - th * ft;
        g.drawImage(timg, cx - tw / 2, ty, tw, th);
        continue;
      }
      g.fillStyle = cols[Math.floor(hash2(gx, gy) * cols.length)];
      g.beginPath();
      g.moveTo(cx, cy);
      g.lineTo(cx + TILE_W / 2, cy + TILE_H / 2);
      g.lineTo(cx, cy + TILE_H);
      g.lineTo(cx - TILE_W / 2, cy + TILE_H / 2);
      g.closePath();
      g.fill();
      if (hash2(gx * 7 + 3, gy * 5 + 1) > 0.72) {
        const tx = cx + (hash2(gx, gy * 3) - 0.5) * 30;
        const ty2 = cy + TILE_H / 2 + (hash2(gx * 2, gy) - 0.5) * 10;
        g.strokeStyle = "#3a6631"; g.lineWidth = 1.2;
        g.beginPath();
        g.moveTo(tx - 2, ty2 + 3); g.lineTo(tx - 3, ty2 - 3);
        g.moveTo(tx, ty2 + 3); g.lineTo(tx, ty2 - 4);
        g.moveTo(tx + 2, ty2 + 3); g.lineTo(tx + 3, ty2 - 3);
        g.stroke();
      }
    }
  }
  g.strokeStyle = "rgba(255,255,255,0.25)"; g.lineWidth = 2;
  g.beginPath();
  g.moveTo(isoX(0, 0), isoY(0, 0));
  g.lineTo(isoX(MAP_W, 0), isoY(MAP_W, 0));
  g.lineTo(isoX(MAP_W, MAP_H), isoY(MAP_W, MAP_H));
  g.lineTo(isoX(0, MAP_H), isoY(0, MAP_H));
  g.closePath();
  g.stroke();
  groundCanvas = gc;
}

/* ═══════════════ 그리기 ═══════════════ */
// moveMode: 기존 건물 이동 = { iid, type, gx, gy, dir }
//           새 건물 배치   = { iid: null, type, gx, gy, dir, cost, buildIdx }
let moveMode = null;
// 편집 모드: 켜지면 발판·배치금지 칸이 보이고, 건물을 탭해 이동·회전한다.
// 왼쪽 위 [편집] 버튼 또는 건물 길게 누르기로 진입. 건설(짓기)도 자동으로 켠다.
let editMode = false;

function footDiamond(g, gx, gy, fw, fh) {
  g.beginPath();
  g.moveTo(isoX(gx, gy), isoY(gx, gy));
  g.lineTo(isoX(gx + fw, gy), isoY(gx + fw, gy));
  g.lineTo(isoX(gx + fw, gy + fh), isoY(gx + fw, gy + fh));
  g.lineTo(isoX(gx, gy + fh), isoY(gx, gy + fh));
  g.closePath();
}
function dirVal(v, dir, def) {
  if (v == null) return def;
  if (typeof v === "object") return v[dir] != null ? v[dir] : def;
  return v;
}
function spriteRect(type, gx, gy, dir) {
  const d = bdef(type);
  const f = footDims(type, dir);
  const isoW = (f.w + f.h) * TILE_W / 2;
  const tw = isoW * dirVal(d.imgScale, dir, 1.5);
  const th = tw; // 렌더 PNG는 정사각형
  const cx = (isoX(gx + f.w, gy) + isoX(gx, gy + f.h)) / 2;
  const footY = isoY(gx + f.w, gy + f.h);
  return {
    x: cx - tw / 2 + dirVal(d.imgDX, dir, 0),
    y: footY - th * dirVal(d.imgFoot, dir, 0.9) + dirVal(d.imgDY, dir, 0),
    w: tw, h: th, cx, footY, f,
  };
}
function drawB(g, type, gx, gy, dir, alpha, invalid) {
  const d = bdef(type);
  const r = spriteRect(type, gx, gy, dir);
  g.globalAlpha = alpha;
  if (invalid !== undefined) {
    // 이동 중인 유령: 발판 색칠 + debug식 테두리·기준점
    g.fillStyle = invalid ? "rgba(220,60,60,0.4)" : "rgba(80,220,110,0.35)";
    footDiamond(g, gx, gy, r.f.w, r.f.h);
    g.fill();
    g.strokeStyle = "#ffe14d"; g.lineWidth = 2 / cam.s;
    footDiamond(g, gx, gy, r.f.w, r.f.h);
    g.stroke();
    g.fillStyle = "#ff5d5d";
    g.beginPath();
    g.arc(isoX(gx, gy), isoY(gx, gy), 4 / cam.s, 0, Math.PI * 2);
    g.fill();
  }
  const img = getImg(buildingImgURL(type, dir));
  if (imgOK(img)) {
    g.drawImage(img, r.x, r.y, r.w, r.h);
  } else {
    g.fillStyle = "rgba(90,80,60,0.85)";
    footDiamond(g, gx, gy, r.f.w, r.f.h);
    g.fill();
    g.fillStyle = "#fff";
    g.font = "28px sans-serif"; g.textAlign = "center"; g.textBaseline = "middle";
    g.fillText(d.icon, r.cx, r.footY - (r.f.w + r.f.h) * TILE_H / 4);
  }
  g.globalAlpha = 1;
}
function drawFeature(g, ft) {
  const img = ft.img ? getImg(ft.img) : null;
  const cx = isoX(ft.gx, ft.gy);
  const by = isoY(ft.gx, ft.gy) + TILE_H;
  if (imgOK(img)) {
    const tw = TILE_W * ft.scale;
    const th = tw * (img.naturalHeight / img.naturalWidth);
    g.drawImage(img, cx - tw / 2 + ft.dx, by - th * ft.foot + ft.dy, tw, th);
  } else if (ft.img) {
    g.fillStyle = "rgba(60,90,50,0.6)";
    footDiamond(g, ft.gx, ft.gy, 1, 1);
    g.fill();
  }
}

// 집 위 💰 표시 위치 (그리기·탭 판정 공용, 월드 좌표)
function houseIconPos(b) {
  const r = spriteRect(b.type, b.gx, b.gy, b.dir);
  return { x: r.x + r.w / 2, y: r.y + r.h * 0.12 };
}
function houseIconVisible(b) {
  return isHouse(b.type) && b.accum >= bdef(b.type).house.showAt;
}

function render() {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = "#1a2438";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.setTransform(DPR * cam.s, 0, 0, DPR * cam.s, DPR * (W / 2 - cam.x * cam.s), DPR * (H / 2 - cam.y * cam.s));
  ctx.imageSmoothingEnabled = true;

  if (groundCanvas) ctx.drawImage(groundCanvas, G_X0, G_Y0, G_W, G_H);

  // 건물 + 지형지물을 남쪽 깊이 순으로 함께 그림
  const items = [];
  for (const b of state.buildings) {
    const f = footDims(b.type, b.dir);
    items.push({
      depth: b.gx + b.gy + f.w + f.h,
      draw: () => drawB(ctx, b.type, b.gx, b.gy, b.dir, moveMode && moveMode.iid === b.iid ? 0.25 : 1),
    });
  }
  for (const ft of FEATURES) {
    items.push({ depth: ft.gx + ft.gy + 2, draw: () => drawFeature(ctx, ft) });
  }
  items.sort((a, b) => a.depth - b.depth);
  for (const it of items) it.draw();

  // 집 위 💰 표시
  ctx.font = "30px sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
  for (const b of state.buildings) {
    if (!houseIconVisible(b)) continue;
    const p = houseIconPos(b);
    ctx.fillText("💰", p.x, p.y + Math.sin(Date.now() / 300) * 3);
  }

  if (moveMode) {
    const ok = validPos(moveMode.type, moveMode.gx, moveMode.gy, moveMode.dir, moveMode.iid);
    drawB(ctx, moveMode.type, moveMode.gx, moveMode.gy, moveMode.dir, 0.75, !ok);
  }
  // 발판·기준점·배치금지 칸 표시 — 편집 모드이거나 data.js debug.footprints
  if (editMode || (GAME_DATA.debug && GAME_DATA.debug.footprints)) {
    const gov = (ASSET_MAP.ground && ASSET_MAP.ground.overrides) || {};
    ctx.fillStyle = "rgba(230,60,60,0.35)";
    for (const k in gov) {
      const v = gov[k];
      if (!(typeof v === "object" && v.block)) continue;
      const c = k.split(",");
      footDiamond(ctx, +c[0], +c[1], 1, 1);
      ctx.fill();
    }
    for (const ft of FEATURES) {
      if (!ft.block) continue;
      footDiamond(ctx, ft.gx, ft.gy, 1, 1);
      ctx.fill();
    }
    for (const b of state.buildings) {
      const f = footDims(b.type, b.dir);
      ctx.strokeStyle = "#ffe14d"; ctx.lineWidth = 2 / cam.s;
      footDiamond(ctx, b.gx, b.gy, f.w, f.h);
      ctx.stroke();
      ctx.fillStyle = "#ff5d5d";
      ctx.beginPath();
      ctx.arc(isoX(b.gx, b.gy), isoY(b.gx, b.gy), 4 / cam.s, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}

/* ═══════════════ 입력 (팬·핀치·탭) ═══════════════ */
const pointers = new Map();
let drag = null, pinch0 = null;

// 길게 누르기(0.5초) → 그 건물 편집 모드
let lpTimer = null;
function clearLp() { if (lpTimer) { clearTimeout(lpTimer); lpTimer = null; } }

// 이동 중인 유령 건물을 눌렀나 (드래그로 옮기기 판정)
function ghostHit(wx, wy) {
  if (!moveMode) return false;
  const r = spriteRect(moveMode.type, moveMode.gx, moveMode.gy, moveMode.dir);
  return wx >= r.x && wx <= r.x + r.w && wy >= r.y && wy <= r.y + r.h;
}
// 유령 건물을 화면 좌표(손가락) 아래로 끌어다 놓기
function dragGhostTo(sx, sy) {
  if (!moveMode) return;
  const w = screenToWorld(sx, sy);
  const t = worldToTile(w.x, w.y);
  const f = footDims(moveMode.type, moveMode.dir);
  moveMode.gx = Math.max(0, Math.min(MAP_W - f.w, t.gx - Math.floor(f.w / 2)));
  moveMode.gy = Math.max(0, Math.min(MAP_H - f.h, t.gy - Math.floor(f.h / 2)));
  updateMoveCtl();
}

canvas.addEventListener("pointerdown", e => {
  canvas.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pointers.size === 1) {
    // 유령 건물 위에서 시작한 드래그 = 건물 옮기기, 그 외 = 지도 이동
    const w0 = screenToWorld(e.clientX, e.clientY);
    const mode = ghostHit(w0.x, w0.y) ? "ghost" : "pan";
    drag = { mode, sx: e.clientX, sy: e.clientY, cx: cam.x, cy: cam.y, moved: false };
    clearLp();
    if (!editMode && !moveMode) {
      const px = e.clientX, py = e.clientY;
      lpTimer = setTimeout(() => {
        lpTimer = null;
        if (!drag || drag.moved || pointers.size !== 1) return;
        const w = screenToWorld(px, py);
        const b = buildingAt(w.x, w.y);
        if (b) {
          setEditMode(true);
          enterMove(b.iid);
          // 손가락을 떼지 않고 그대로 끌면 건물이 따라온다
          drag = { mode: "ghost", sx: px, sy: py, cx: cam.x, cy: cam.y, moved: true };
        }
      }, 500);
    }
  } else if (pointers.size === 2) {
    drag = null;
    clearLp();
    const pts = [...pointers.values()];
    const mid = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
    pinch0 = { d: Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y), s: cam.s, wm: screenToWorld(mid.x, mid.y) };
  }
});
canvas.addEventListener("pointermove", e => {
  if (!pointers.has(e.pointerId)) return;
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pointers.size === 2 && pinch0) {
    const pts = [...pointers.values()];
    const d = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
    cam.s = pinch0.s * (d / Math.max(pinch0.d, 1));
    clampCam();
    const mid = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
    cam.x = pinch0.wm.x - (mid.x - W / 2) / cam.s;
    cam.y = pinch0.wm.y - (mid.y - H / 2) / cam.s;
    clampCam();
  } else if (pointers.size === 1 && drag) {
    const dx = e.clientX - drag.sx, dy = e.clientY - drag.sy;
    if (Math.hypot(dx, dy) > 7) { drag.moved = true; clearLp(); }
    if (!drag.moved) return;
    if (drag.mode === "ghost") {
      dragGhostTo(e.clientX, e.clientY);   // 건물이 손가락을 따라온다
    } else {
      cam.x = drag.cx - dx / cam.s;
      cam.y = drag.cy - dy / cam.s;
      clampCam();
    }
  }
});
function pointerEnd(e) {
  clearLp();
  if (pointers.has(e.pointerId) && pointers.size === 1 && drag && !drag.moved) {
    onTap(e.clientX, e.clientY);
  }
  pointers.delete(e.pointerId);
  if (pointers.size < 2) pinch0 = null;
  if (pointers.size === 0) drag = null;
}
canvas.addEventListener("pointerup", pointerEnd);
canvas.addEventListener("pointercancel", e => { clearLp(); pointers.delete(e.pointerId); pinch0 = null; drag = null; });
canvas.addEventListener("wheel", e => {
  e.preventDefault();
  const wm = screenToWorld(e.clientX, e.clientY);
  cam.s *= e.deltaY < 0 ? 1.12 : 0.89;
  clampCam();
  cam.x = wm.x - (e.clientX - W / 2) / cam.s;
  cam.y = wm.y - (e.clientY - H / 2) / cam.s;
  clampCam();
}, { passive: false });

// 해당 월드 좌표의 건물 (앞에 그려진 것 우선)
function buildingAt(wx, wy) {
  const order = state.buildings.slice().sort((a, b) => {
    const fa = footDims(a.type, a.dir), fb = footDims(b.type, b.dir);
    return (b.gx + b.gy + fb.w + fb.h) - (a.gx + a.gy + fa.w + fa.h);
  });
  for (const b of order) {
    const r = spriteRect(b.type, b.gx, b.gy, b.dir);
    if (wx >= r.x && wx <= r.x + r.w && wy >= r.y && wy <= r.y + r.h) return b;
  }
  return null;
}

function onTap(sx, sy) {
  const w = screenToWorld(sx, sy);
  if (moveMode) {
    dragGhostTo(sx, sy);  // 탭한 칸으로 건물 이동
    return;
  }
  // 편집 모드: 건물 탭 = 그 건물 이동·회전 시작
  if (editMode) {
    const b = buildingAt(w.x, w.y);
    if (b) enterMove(b.iid);
    return;
  }
  // 1) 집 💰 표시 탭 → 전 가구 골드 수거
  for (const b of state.buildings) {
    if (!houseIconVisible(b)) continue;
    const p = houseIconPos(b);
    if (Math.abs(w.x - p.x) < 26 && Math.abs(w.y - p.y) < 26) {
      collectHouses();
      return;
    }
  }
  // 2) 건물 탭 → 정보 패널
  const b = buildingAt(w.x, w.y);
  if (b) openPanel("building", b.iid);
}

/* ═══════════════ 경제 로직 ═══════════════ */
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
  return GAME_DATA.startBuildings.filter(s => s.type === type).length;
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
  moveMode = { iid: null, type: e.type, gx: Math.floor(MAP_W / 2), gy: Math.floor(MAP_H / 2), dir: "SE", cost: e.cost, buildIdx: i };
  closePanel();
  document.getElementById("move-ctl").classList.remove("hidden");
  updateMoveCtl();
  toast("놓을 자리를 탭해라");
}

/* ═══════════════ 편집 모드 ═══════════════ */
function setEditMode(on) {
  editMode = on;
  const btn = document.getElementById("edit-btn");
  if (btn) {
    btn.textContent = on ? "✅ 완료" : "🔧 편집";
    btn.classList.toggle("on", on);
  }
  if (on) {
    closePanel();
    toast("편집 모드 — 건물을 탭해서 이동·회전");
  } else {
    exitMove();
  }
}
document.getElementById("edit-btn").addEventListener("click", () => setEditMode(!editMode));

/* ═══════════════ 이동·회전 ═══════════════ */
function enterMove(iid) {
  const b = byIid(iid);
  if (!b) return;
  moveMode = { iid, type: b.type, gx: b.gx, gy: b.gy, dir: b.dir };
  closePanel();
  document.getElementById("move-ctl").classList.remove("hidden");
  updateMoveCtl();
}
function exitMove() {
  moveMode = null;
  document.getElementById("move-ctl").classList.add("hidden");
}
function updateMoveCtl() {
  const ok = moveMode && validPos(moveMode.type, moveMode.gx, moveMode.gy, moveMode.dir, moveMode.iid);
  document.getElementById("mv-ok").disabled = !ok;
}
function rotateDir(dir) { return DIRS[(DIRS.indexOf(dir) + 1) % DIRS.length]; }

function confirmMove() {
  if (!moveMode || !validPos(moveMode.type, moveMode.gx, moveMode.gy, moveMode.dir, moveMode.iid)) return;
  if (moveMode.iid != null) {
    const b = byIid(moveMode.iid);
    b.gx = moveMode.gx; b.gy = moveMode.gy; b.dir = moveMode.dir;
    toast("배치 완료");
  } else {
    if (!canAfford(moveMode.cost)) { toast("자원 부족"); exitMove(); return; }
    pay(moveMode.cost);
    addBuilding(state, moveMode.type, moveMode.gx, moveMode.gy, moveMode.dir);
    toast(`${bdef(moveMode.type).name} 건설 완료!`);
    updateHud();
  }
  exitMove();
}
document.getElementById("mv-rotate").addEventListener("click", () => {
  if (!moveMode) return;
  moveMode.dir = rotateDir(moveMode.dir);
  const f = footDims(moveMode.type, moveMode.dir);
  moveMode.gx = Math.max(0, Math.min(MAP_W - f.w, moveMode.gx));
  moveMode.gy = Math.max(0, Math.min(MAP_H - f.h, moveMode.gy));
  updateMoveCtl();
});
// 방향 패드: 화면 기준 대각선 = 그리드 한 칸 (↗=gy-1, ↘=gx+1, ↙=gy+1, ↖=gx-1)
function nudgeMove(dgx, dgy) {
  if (!moveMode) return;
  const f = footDims(moveMode.type, moveMode.dir);
  moveMode.gx = Math.max(0, Math.min(MAP_W - f.w, moveMode.gx + dgx));
  moveMode.gy = Math.max(0, Math.min(MAP_H - f.h, moveMode.gy + dgy));
  updateMoveCtl();
}
document.getElementById("mv-ne").addEventListener("click", () => nudgeMove(0, -1));
document.getElementById("mv-se").addEventListener("click", () => nudgeMove(1, 0));
document.getElementById("mv-sw").addEventListener("click", () => nudgeMove(0, 1));
document.getElementById("mv-nw").addEventListener("click", () => nudgeMove(-1, 0));
document.getElementById("mv-ok").addEventListener("click", confirmMove);
document.getElementById("mv-cancel").addEventListener("click", exitMove);

function tryRotate(iid) {
  const b = byIid(iid);
  if (!b) return;
  const nd = rotateDir(b.dir);
  if (validPos(b.type, b.gx, b.gy, nd, b.iid)) {
    b.dir = nd;
    toast("회전 완료");
    refreshPanel();
  } else {
    toast("여기서는 회전할 자리가 없다 — 이동으로 옮겨라");
  }
}

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
  let html = `<div class="note" style="margin-bottom:8px">영주성 레벨이 오르면 새 건설 허가가 열린다. 같은 종류는 위에서부터 순서대로.</div>`;
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
        lastEcoTs = Date.now();
        setEditMode(false); closePanel(); updateHud();
        toast("초기화 완료 — 새 영지 시작");
      }
      break;
  }
}

/* ═══════════════ 저장 시스템 ═══════════════ */
const SKEY = GAME_DATA.save.key;
let lastAutoTs = 0;

function checksum(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}
function serialize() {
  const data = JSON.parse(JSON.stringify(state));
  return {
    version: GAME_DATA.version, ts: Date.now(), data,
    meta: { gold: Math.floor(state.res.gold || 0), castle: castleLevel() },
    sum: checksum(JSON.stringify(data)),
  };
}
function applySave(obj) {
  if (!obj || !obj.data || obj.version !== GAME_DATA.version) return false;
  const d = obj.data;
  if (!Array.isArray(d.buildings) || !d.buildings.some(b => b.type === "castle")) return false;
  const fresh = freshState();
  fresh.res = Object.assign(fresh.res, d.res || {});
  fresh.buildings = [];
  let maxIid = 0;
  for (const src of d.buildings) {
    if (!bdef(src.type)) continue; // 모르는 건물은 버림 (버전업 대비)
    const b = {
      iid: src.iid || ++maxIid, type: src.type,
      gx: src.gx | 0, gy: src.gy | 0,
      dir: DIRS.includes(src.dir) ? src.dir : "SE",
      level: Math.max(1, Math.min(src.level | 0 || 1, bdef(src.type).maxLevel)),
      queue: Array.isArray(src.queue) ? src.queue : [],
      accum: +src.accum || 0,
    };
    maxIid = Math.max(maxIid, b.iid);
    fresh.buildings.push(b);
  }
  fresh.nextIid = Math.max(d.nextIid || 1, maxIid + 1);
  fresh.createdTs = d.createdTs || Date.now();
  state = fresh;
  // 오프라인 동안 집 세금 적립 (대기열은 절대시각이라 processQueues가 알아서 처리)
  const now = Date.now();
  const elapsed = Math.max(0, (now - (obj.ts || now)) / 1000);
  for (const b of state.buildings) {
    if (isHouse(b.type)) b.accum = Math.min(houseCap(b), b.accum + houseRate(b) * elapsed);
  }
  lastEcoTs = now;
  exitMove(); updateHud(); refreshPanel();
  return true;
}
function lsSet(key, obj) { try { localStorage.setItem(key, JSON.stringify(obj)); return true; } catch (e) { return false; } }
function lsGet(key) { try { const s = localStorage.getItem(key); return s ? JSON.parse(s) : null; } catch (e) { return null; } }

function autoSave() {
  if (lsSet(SKEY + "_auto", serialize())) lastAutoTs = Date.now();
}
function saveToSlot(n) {
  if (lsSet(`${SKEY}_slot${n}`, serialize())) { toast(`슬롯 ${n}에 저장 완료`); refreshPanel(); }
  else toast("저장 실패 (저장 공간 문제)");
}
function loadFromSlot(n) {
  const obj = lsGet(n === "auto" ? SKEY + "_auto" : `${SKEY}_slot${n}`);
  if (applySave(obj)) toast("불러오기 완료");
  else toast("이 슬롯에는 저장된 게임이 없다 (또는 옛 버전)");
}
function slotMetaHTML(label, obj, n, canSave) {
  const meta = obj && (obj.meta || (obj.data && obj.data.res ? { gold: Math.floor(obj.data.res.gold || 0), castle: "?" } : null));
  const t2 = obj && meta
    ? `${new Date(obj.ts).toLocaleString("ko-KR")} · 🪙${fmtNum(meta.gold)} 🏰Lv.${meta.castle}`
    : "비어 있음";
  return `<div class="saveslot"><div class="meta"><div class="t1">${label}</div><div class="t2">${t2}</div></div>
    ${canSave ? `<button class="btn" data-act="saveslot:${n}">저장</button>` : ""}
    <button class="btn alt" data-act="loadslot:${n}" ${obj ? "" : "disabled"}>불러오기</button></div>`;
}
function saveTabHTML() {
  let html = `<div class="note" style="margin-bottom:8px">자동저장: ${GAME_DATA.save.autosaveSec}초마다${lastAutoTs ? ` · 마지막 ${new Date(lastAutoTs).toLocaleTimeString("ko-KR")}` : ""}</div>`;
  html += slotMetaHTML("⏱️ 자동저장", lsGet(SKEY + "_auto"), "auto", false);
  for (let n = 1; n <= GAME_DATA.save.slots; n++) {
    html += slotMetaHTML(`슬롯 ${n}`, lsGet(`${SKEY}_slot${n}`), n, true);
  }
  html += `<div class="card"><div class="name" style="margin-bottom:6px">파일 백업</div>
    <div class="note">저장 파일을 폰/PC에 내려받아 반영구 보관한다. 브라우저 데이터를 지워도 살아남는다.</div>
    <div class="btnrow"><button class="btn alt" data-act="export">📤 파일로 내보내기</button>
    <button class="btn alt" data-act="import">📥 파일 불러오기</button></div></div>`;
  html += `<div class="card"><div class="name" style="margin-bottom:6px">로컬 게임으로 저장</div>
    <div class="note">게임 전체(그림 포함)+현재 진행상황을 HTML 파일 하나로 만든다. 인터넷 없이 파일만 열면 이어서 플레이 가능. (GitHub Pages로 접속 중일 때만 작동)</div>
    <button class="btn alt wide" data-act="standalone">💽 HTML 파일 만들기</button></div>`;
  html += `<div class="card"><div class="name" style="margin-bottom:6px">초기화</div>
    <div class="note">게임을 처음부터 다시 시작한다. 저장 슬롯·내보낸 파일은 지우지 않는다.</div>
    <button class="btn danger wide" data-act="reset">🔄 처음부터 다시 시작</button></div>`;
  return html;
}

/* ── 파일 내보내기/가져오기 ── */
function downloadBlob(blob, filename) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}
function exportFile() {
  const obj = serialize();
  const d = new Date(obj.ts);
  const pad = n => String(n).padStart(2, "0");
  const name = `estate_save_${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}.json`;
  downloadBlob(new Blob([JSON.stringify(obj, null, 2)], { type: "application/json" }), name);
  toast("저장 파일 내려받기 시작");
}
document.getElementById("import-file").addEventListener("change", e => {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file) return;
  const fr = new FileReader();
  fr.onload = () => {
    try {
      const obj = JSON.parse(fr.result);
      if (obj.sum && obj.sum !== checksum(JSON.stringify(obj.data))) {
        toast("파일이 손상됐다 — 불러오기 취소");
        return;
      }
      if (applySave(obj)) { toast("파일에서 불러오기 완료"); autoSave(); }
      else toast("맞지 않는 저장 파일이다");
    } catch (err) { toast("저장 파일을 읽을 수 없다"); }
  };
  fr.readAsText(file);
});

/* ── 로컬 단일 HTML 내보내기 ── */
async function exportStandalone() {
  toast("파일 생성 중…");
  try {
    const fetchText = f => fetch(f).then(r => { if (!r.ok) throw new Error(f); return r.text(); });
    const [html, css, dataJs, assetsJs, gameJs] =
      await Promise.all(["index.html", "style.css", "data.js", "assets.js", "game.js"].map(fetchText));
    const urls = new Set();
    for (const t of BTYPES) for (const dir of DIRS) urls.add(buildingImgURL(t, dir));
    const gset = ASSET_MAP.ground || {};
    if (gset.grassDefault) urls.add(gset.grassDefault);
    if (gset.overrides) for (const k in gset.overrides) {
      const v = gset.overrides[k];
      const u = typeof v === "string" ? v : v.img;
      if (u) urls.add(u);
    }
    for (const ft of FEATURES) if (ft.img) urls.add(ft.img);
    const assets = {};
    await Promise.all([...urls].map(async u => {
      const blob = await fetch(u).then(r => { if (!r.ok) throw new Error(u); return r.blob(); });
      assets[u] = await new Promise((res, rej) => {
        const fr = new FileReader();
        fr.onload = () => res(fr.result);
        fr.onerror = rej;
        fr.readAsDataURL(blob);
      });
    }));
    const escJs = s => s.replace(/<\/script/gi, "<\\/script");
    const inject = "<script>window.EMBEDDED_ASSETS=" + JSON.stringify(assets) +
      ";window.EMBEDDED_SAVE=" + JSON.stringify(serialize()) + ";<\/script>";
    const out = html
      .replace(/<link[^>]*style\.css[^>]*\/?>/, () => "<style>\n" + css + "\n</style>")
      .replace(/<script src="data\.js"><\/script>/, () => inject + "\n<script>\n" + escJs(dataJs) + "\n<\/script>")
      .replace(/<script src="assets\.js"><\/script>/, () => "<script>\n" + escJs(assetsJs) + "\n<\/script>")
      .replace(/<script src="game\.js"><\/script>/, () => "<script>\n" + escJs(gameJs) + "\n<\/script>");
    downloadBlob(new Blob([out], { type: "text/html" }), "estate_tycoon_local.html");
    toast("로컬 게임 파일 완성 — 다운로드 확인");
  } catch (e) {
    toast("실패 — GitHub Pages로 접속했을 때만 가능하다");
  }
}

/* ═══════════════ 부팅·메인 루프 ═══════════════ */
(function boot() {
  const auto = lsGet(SKEY + "_auto");
  if (auto && applySave(auto)) {
    toast("자동저장에서 이어서 시작");
  } else if (window.EMBEDDED_SAVE && applySave(window.EMBEDDED_SAVE)) {
    toast("내장 저장에서 이어서 시작");
  }
  updateHud();
})();

document.addEventListener("visibilitychange", () => { if (document.hidden) autoSave(); });
window.addEventListener("pagehide", autoSave);

let lastPanelRefresh = 0;
function frame() {
  const now = Date.now();
  if (groundDirty) { groundDirty = false; buildGround(); }
  economyTick(now);
  if (now - lastAutoTs > GAME_DATA.save.autosaveSec * 1000) autoSave();
  // 타이머·수량 표시 갱신 (패널 열려 있을 때 0.5초마다)
  if (panelKind && panelKind !== "option" && now - lastPanelRefresh > 500) {
    lastPanelRefresh = now;
    if (!document.activeElement || document.activeElement.tagName !== "INPUT") renderPanel();
  }
  render();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
