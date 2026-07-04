// estate_tycoon — 엔진 코어 (상태·좌표·에셋 로드·오토타일)
// 밸런스는 data.js, 시작 상태는 start.js, 그림 연결은 assets.js. 여기는 로직만.
"use strict";

/* ═══════════════ 기본 상수 ═══════════════ */
const TILE_W = 64, TILE_H = 32;
const MAP_W = START.map.w, MAP_H = START.map.h;
const DIRS = ["SE", "SW", "NW", "NE"];        // 회전 순서 (90도씩)
const ASSET_BASE = "../assets/building/";     // 건물 PNG 기본 위치
const BTYPES = Object.keys(GAME_DATA.buildings);

const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
let DPR = 1, W = 0, H = 0;

function resize() {
  DPR = Math.min(window.devicePixelRatio || 1, 3);
  // 캔버스가 화면에 실제로 렌더된 크기를 기준으로 잡는다.
  // window.innerHeight를 쓰면 모바일에서 주소창 높이만큼 CSS(100vh/dvh)와 어긋나
  // 그림과 터치 좌표가 세로로 밀린다.
  const r = canvas.getBoundingClientRect ? canvas.getBoundingClientRect() : null;
  W = (r && r.width) || window.innerWidth;
  H = (r && r.height) || window.innerHeight;
  canvas.width = Math.round(W * DPR);
  canvas.height = Math.round(H * DPR);
}
window.addEventListener("resize", resize);
// 모바일 주소창이 나타나거나 사라질 때도 다시 맞춘다
if (window.visualViewport) window.visualViewport.addEventListener("resize", resize);
resize();

/* ═══════════════ 모드 상태 (편집·이동·브러시) ═══════════════ */
// moveMode: 기존 건물 이동 = { iid, type, gx, gy, dir }
//           새 건물 배치   = { iid: null, type, gx, gy, dir, cost, buildIdx }
let moveMode = null;
// editMode: 켜지면 발판·배치금지 칸이 보이고, 건물을 탭해 이동·회전한다.
let editMode = false;
// paintBrush: null(선택 모드) | "grass"(지우기=기본 잔디) | "road" | "water"
let paintBrush = null;

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
    // 모든 자원키를 0으로 깔고 START.resources 로 덮어쓴다(data.js에 자원을 추가해도 안 깨지게)
    res: Object.assign(
      Object.fromEntries(Object.keys(GAME_DATA.resources).map(k => [k, 0])),
      START.resources
    ),
    buildings: [],
    nextIid: 1,
    land: START.openChunks.map(([cx, cy]) => cx + "," + cy), // 개방된 청크 키
    // 칠한 지형: "gx,gy" → "road" | "water". 시작 지형(START.tiles)을 복사해서 깐다.
    tiles: Object.assign({}, START.tiles || {}),
    held: [],   // 편집 모드 보관함에 담긴 건물들 (맵에서 잠시 치운 것)
    // 동적 가격 상태: 배수(mult)·이전 스텝 기록(hist)·시차 전파 예약(pending)·스텝수·시드(결정론)·마지막 스텝 시각
    market: { mult: {}, hist: {}, pending: [], step: 0, seed: (Date.now() >>> 0) || 1, ts: Date.now() },
    createdTs: Date.now(),
  };
  for (const sb of START.buildings) addBuilding(st, sb.type, sb.gx, sb.gy, sb.dir);
  return st;
}
let state = freshState();

/* ── 영지 개간(땅 잠금) ── */
const CHUNK = GAME_DATA.land.chunkSize;
const CHUNKS_X = Math.ceil(START.map.w / CHUNK), CHUNKS_Y = Math.ceil(START.map.h / CHUNK);
let LAND = new Set(state.land); // 빠른 조회용 (state.land이 바뀌면 syncLand)
function syncLand() { LAND = new Set(state.land); }
function chunkKeyOf(gx, gy) { return Math.floor(gx / CHUNK) + "," + Math.floor(gy / CHUNK); }
function landOpen(gx, gy) { return LAND.has(chunkKeyOf(gx, gy)); }
function chunkAdjacent(cx, cy) {
  return LAND.has((cx + 1) + "," + cy) || LAND.has((cx - 1) + "," + cy) ||
    LAND.has(cx + "," + (cy + 1)) || LAND.has(cx + "," + (cy - 1));
}
// n번째 개간 비용 = base × growth^(n-1)
function landCost() {
  const L = GAME_DATA.land;
  const n = state.land.length - START.openChunks.length;
  return Math.floor(L.cost.base * Math.pow(L.cost.growth, n));
}
function tryExpandChunk(cx, cy) {
  const key = cx + "," + cy;
  if (LAND.has(key) || cx < 0 || cy < 0 || cx >= CHUNKS_X || cy >= CHUNKS_Y) return;
  if (!chunkAdjacent(cx, cy)) return toast("내 땅과 붙어 있는 숲만 개간할 수 있다");
  const cost = landCost();
  if ((state.res.gold || 0) < cost) return toast(`골드 부족 — 개간 비용 🪙${fmtNum(cost)}`);
  if (!confirm(`이 숲(4×4)을 개간해서 건설 가능한 땅으로 만든다.\n비용: ${fmtNum(cost)} 골드. 진행할까?`)) return;
  state.res.gold -= cost;
  state.land.push(key);
  syncLand();
  toast(`개간 완료! 다음 개간 비용 🪙${fmtNum(landCost())}`);
  updateHud(); refreshPanel();
}

function bdef(type) { return GAME_DATA.buildings[type]; }
function byType(type) { return state.buildings.filter(b => b.type === type); }
function byIid(iid) { return state.buildings.find(b => b.iid === iid) || null; }
// 영주성은 보관함에 있을 수도 있으니 맵·보관함 양쪽에서 찾는다
function castleB() { return byType("castle")[0] || (state.held || []).find(b => b.type === "castle") || null; }
function castleLevel() { const c = castleB(); return c ? c.level : 1; }
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
  if (!landOpen(gx, gy)) return true;                    // 개간 안 한 숲
  if (state.tiles[gx + "," + gy] === "water") return true; // 칠한 물
  const ov = groundOverrideAt(gx, gy);
  if (ov && ov.block) return true;
  return FEAT_BLOCK.has(gx + "," + gy);
}
// 지형 브러시가 쓰는 그림 경로
function paintTileURL(type) {
  const g = ASSET_MAP.ground || {};
  if (type === "road") return g.roadDefault || null;
  if (type === "water") return g.waterDefault || null;
  return g.grassDefault || null;
}

/* ═══════════════ 오토타일 (물·도로 공용) ═══════════════ */
// 이웃 4방향 중 같은 지형인 곳을 비트로 (NE=1, SE=2, SW=4, NW=8) 읽어 그림을 고른다.
const AUTO_TYPES = ["water", "road"];                      // 오토타일 지원하는 칠 타입
const AUTO_KEY = { water: "waterAuto", road: "landAuto" }; // 칠 타입 → assets.js ground 설정 키
const AUTO_PREFIX = { water: "water", road: "land" };      // 기본 파일명 접두어
function isPaintedType(type, gx, gy) {
  if (gx < 0 || gy < 0 || gx >= MAP_W || gy >= MAP_H) return false;
  return state.tiles[gx + "," + gy] === type;
}
function autoMaskAt(type, gx, gy) {
  return (isPaintedType(type, gx, gy - 1) ? 1 : 0) | (isPaintedType(type, gx + 1, gy) ? 2 : 0) |
    (isPaintedType(type, gx, gy + 1) ? 4 : 0) | (isPaintedType(type, gx - 1, gy) ? 8 : 0);
}
// 오목 모서리 조각: [이름, 필요한 열린 변 비트, 대각 이웃 dx, dy]
const AUTO_NIBS = [
  ["N", 9, -1, -1], ["E", 3, 1, -1], ["S", 6, 1, 1], ["W", 12, -1, 1],
];
// 오토타일 설정 통일: 문자열(폴더만)이든 객체(연결표 포함)든 같은 형태로
function autoCfg(type) {
  const a = (ASSET_MAP.ground || {})[AUTO_KEY[type]];
  if (!a) return null;
  const cfg = typeof a === "string" ? { base: a } : a;
  return { base: cfg.base, tiles: cfg.tiles || null, nibs: cfg.nibs || null, prefix: AUTO_PREFIX[type] };
}
function autoTileFile(cfg, mask) {
  return cfg.base + "/" + ((cfg.tiles && cfg.tiles[mask]) || (cfg.prefix + "_o" + mask + ".png"));
}
function autoNibFile(cfg, nm) {
  return cfg.base + "/" + ((cfg.nibs && cfg.nibs[nm]) || (cfg.prefix + "_nib_" + nm + ".png"));
}
// 오목 모서리 마스크 (비트: N=1, E=2, S=4, W=8) — 양쪽 변이 이어졌는데 대각선은 아닌 꼭짓점
function autoCornerMaskAt(type, gx, gy) {
  const m = autoMaskAt(type, gx, gy);
  let c = 0;
  for (let i = 0; i < AUTO_NIBS.length; i++) {
    const need = AUTO_NIBS[i][1], dx2 = AUTO_NIBS[i][2], dy2 = AUTO_NIBS[i][3];
    if ((m & need) === need && !isPaintedType(type, gx + dx2, gy + dy2)) c |= (1 << i);
  }
  return c;
}
// 구운 조합 파일명: 기본 파일명 뒤에 _c모서리비트 (예: water_o15_c15.png = 십자 교차점)
function autoCompositeFile(cfg, mask, cmask) {
  return autoTileFile(cfg, mask).replace(/\.png$/i, "_c" + cmask + ".png");
}
// 게임이 쓰는 오토타일 그림 전체 목록 (미리 읽기·로컬 HTML 포함용)
function autoFileList(cfg) {
  const files = [];
  for (let m = 0; m < 16; m++) {
    files.push(autoTileFile(cfg, m));
    let avail = 0;
    for (let i = 0; i < AUTO_NIBS.length; i++) {
      if ((m & AUTO_NIBS[i][1]) === AUTO_NIBS[i][1]) avail |= (1 << i);
    }
    for (let c = 1; c <= 15; c++) {
      if ((c & avail) === c) files.push(autoCompositeFile(cfg, m, c));
    }
  }
  for (const [nm] of AUTO_NIBS) files.push(autoNibFile(cfg, nm));
  return files;
}

// 금화 회전 프레임 (집 위 표시). assets.js fx.coin으로 교체 가능.
const COIN_URLS = (ASSET_MAP.fx && ASSET_MAP.fx.coin) ||
  Array.from({ length: 12 }, (_, i) => "../assets/fx/coin_" + i + ".png");

// 돌아다니는 NPC의 모든 프레임 URL (미리 읽기·로컬 HTML 포함용)
function npcFileList() {
  const out = [];
  const npcs = GAME_DATA.npcs || {};
  for (const type in npcs) {
    const n = npcs[type];
    for (const nm of [].concat(n.idle || [], n.walk || [], n.work || [])) out.push(n.base + "/" + nm + ".png");
  }
  return out;
}

(function preload() {
  for (const t of BTYPES) for (const dir of DIRS) getImg(buildingImgURL(t, dir));
  for (const u of COIN_URLS) getImg(u);
  for (const dir of DIRS) getImg(GAME_DATA.land.treeImg + "_" + dir + ".png");
  getImg(paintTileURL("road")); getImg(paintTileURL("water"));
  for (const t of AUTO_TYPES) {
    const acfg = autoCfg(t);
    if (acfg) for (const f of autoFileList(acfg)) getImg(f);
  }
  const g = ASSET_MAP.ground || {};
  if (g.grassDefault) getImg(g.grassDefault);
  if (g.overrides) for (const k in g.overrides) {
    const v = g.overrides[k];
    getImg(typeof v === "string" ? v : v.img);
  }
  for (const ft of FEATURES) if (ft.img) getImg(ft.img);
  for (const u of npcFileList()) getImg(u);
})();

/* ═══════════════ 카메라·좌표 변환 ═══════════════ */
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
