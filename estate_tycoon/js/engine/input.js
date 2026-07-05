// estate_tycoon — 입력 (팬·핀치·탭·지형 칠하기·유령 드래그)
"use strict";

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

// 지형 칠하기 (그리드 칸 단위 — 브러시가 켜져 있을 때만)
function paintTileAt(gx, gy) {
  if (!paintBrush) return;
  if (gx < 0 || gy < 0 || gx >= MAP_W || gy >= MAP_H) return;
  if (!landOpen(gx, gy)) return;         // 미개간 숲에는 못 칠함
  if (buildingAtTile(gx, gy)) return;    // 건물 아래에는 못 칠함
  const k = gx + "," + gy;
  if (paintBrush === "grass") delete state.tiles[k];
  else state.tiles[k] = paintBrush;
  groundDirty = true;
}
function paintAtScreen(sx, sy) {
  const w = screenToWorld(sx, sy);
  const t = worldToTile(w.x, w.y);
  paintTileAt(t.gx, t.gy);
}
function buildingAtTile(gx, gy) {
  for (const b of state.buildings) {
    const f = footDims(b.type, b.dir);
    if (gx >= b.gx && gx < b.gx + f.w && gy >= b.gy && gy < b.gy + f.h) return b;
  }
  return null;
}

canvas.addEventListener("pointerdown", e => {
  canvas.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pointers.size === 1) {
    // 브러시가 켜져 있으면 드래그 = 칠하기 (지도 이동은 두 손가락으로)
    if (editMode && paintBrush && !moveMode) {
      drag = { mode: "paint", sx: e.clientX, sy: e.clientY, cx: cam.x, cy: cam.y, moved: true };
      paintAtScreen(e.clientX, e.clientY);
      return;
    }
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
    if (drag.mode === "paint") { paintAtScreen(e.clientX, e.clientY); return; }
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

// 해당 월드 좌표의 건물
// 1순위: 발판(바닥 칸)을 직접 탭 — 건물끼리 발판은 안 겹치므로 정확하다.
//        (큰 건물의 스프라이트 사각형이 위쪽 이웃 건물까지 덮어 클릭을 가로채는 문제 방지)
// 2순위: 발판 밖(지붕·몸통 위쪽)은 스프라이트 사각형으로 — 앞(남쪽)에 그려진 것 우선.
function buildingAt(wx, wy) {
  const t = worldToTile(wx, wy);
  const onFoot = buildingAtTile(t.gx, t.gy);
  if (onFoot) return onFoot;
  const order = state.buildings.slice().sort((a, b) => {
    const fa = footDims(a.type, a.dir), fb = footDims(b.type, b.dir);
    return (b.gx + b.gy + fb.w + fb.h) - (a.gx + a.gy + fa.w + fa.h);
  });
  for (const b of order) {
    const r = hitRect(b.type, b.gx, b.gy, b.dir);   // 그림 박스가 아니라 "터치 박스"로 판정
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
  if (b) { openPanel("building", b.iid); return; }
  // 3) 잠긴 숲 청크 탭 → 개간 시도
  const t = worldToTile(w.x, w.y);
  if (t.gx >= 0 && t.gy >= 0 && t.gx < MAP_W && t.gy < MAP_H && !landOpen(t.gx, t.gy)) {
    tryExpandChunk(Math.floor(t.gx / CHUNK), Math.floor(t.gy / CHUNK));
  }
}
