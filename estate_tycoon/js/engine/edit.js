// estate_tycoon — 편집 모드 + 건물 이동·회전
"use strict";

/* ═══════════════ 편집 모드 ═══════════════ */
function updateEditUI() {
  const show = editMode && !moveMode;
  const pb = document.getElementById("paint-bar");
  if (pb) pb.classList.toggle("hidden", !show);
  const bb = document.getElementById("box-bar");
  if (bb) bb.classList.toggle("hidden", !show);
  updateBoxBar();
}
// 보관함 바 다시 그리기 (담긴 건물 = 탭하면 꺼내서 배치)
function updateBoxBar() {
  const box = document.getElementById("box-items");
  if (!box) return;
  const held = state.held || [];
  box.innerHTML = held.map((h, i) =>
    `<button data-box="${i}">${bdef(h.type).icon} ${bdef(h.type).name} Lv.${h.level}</button>`).join("");
  box.querySelectorAll("[data-box]").forEach(el =>
    el.addEventListener("click", () => placeFromBox(+el.dataset.box)));
}
function setBrush(b) {
  paintBrush = b || null;
  document.querySelectorAll("#paint-bar button").forEach(x =>
    x.classList.toggle("active", (x.dataset.brush || null) === paintBrush));
}
function setEditMode(on) {
  // 보관함이 비어야 편집을 끝낼 수 있다 (담아둔 건물을 잃지 않게)
  if (!on && (state.held || []).length) { toast("보관함을 비워야 편집을 끝낼 수 있다"); return; }
  editMode = on;
  const btn = document.getElementById("edit-btn");
  if (btn) {
    btn.textContent = on ? "✅ 완료" : "🔧 편집";
    btn.classList.toggle("on", on);
  }
  if (on) {
    closePanel();
    toast("편집 모드 — 건물 탭=이동·회전, 아래 브러시=지형 칠하기");
  } else {
    setBrush(null);
    exitMove();
  }
  updateEditUI();
}
document.getElementById("edit-btn").addEventListener("click", () => setEditMode(!editMode));
document.querySelectorAll("#paint-bar button").forEach(btn =>
  btn.addEventListener("click", () => setBrush(btn.dataset.brush || null)));

/* ═══════════════ 이동·회전 ═══════════════ */
function enterMove(iid) {
  const b = byIid(iid);
  if (!b) return;
  moveMode = { iid, type: b.type, gx: b.gx, gy: b.gy, dir: b.dir };
  closePanel();
  document.getElementById("move-ctl").classList.remove("hidden");
  updateMoveCtl(); updateEditUI();
}
function exitMove() {
  moveMode = null;
  document.getElementById("move-ctl").classList.add("hidden");
  updateEditUI();
}
function updateMoveCtl() {
  const ok = moveMode && validPos(moveMode.type, moveMode.gx, moveMode.gy, moveMode.dir, moveMode.iid);
  document.getElementById("mv-ok").disabled = !ok;
  // [📦 보관] 버튼은 "맵에 있는 기존 건물을 옮기는 중"일 때만 (새 건설·보관함 배치 중엔 숨김)
  const store = document.getElementById("mv-store");
  if (store) store.style.display = (moveMode && moveMode.iid != null && !moveMode.fromBox && moveMode.cost == null) ? "" : "none";
}
function rotateDir(dir) { return DIRS[(DIRS.indexOf(dir) + 1) % DIRS.length]; }

function confirmMove() {
  if (!moveMode || !validPos(moveMode.type, moveMode.gx, moveMode.gy, moveMode.dir, moveMode.iid)) return;
  if (moveMode.fromBox) {
    // 보관함에서 꺼내 배치 (레벨·대기열·세금 그대로 유지)
    const h = moveMode.heldRef;
    const i = state.held.indexOf(h);
    if (i >= 0) state.held.splice(i, 1);
    h.gx = moveMode.gx; h.gy = moveMode.gy; h.dir = moveMode.dir;
    state.buildings.push(h);
    toast(`${bdef(h.type).name} 배치 완료`);
    updateHud();
  } else if (moveMode.iid != null) {
    const b = byIid(moveMode.iid);
    b.gx = moveMode.gx; b.gy = moveMode.gy; b.dir = moveMode.dir;
    toast("배치 완료");
  } else {
    if (!canAfford(moveMode.cost)) { toast("자원 부족"); exitMove(); return; }
    pay(moveMode.cost);
    // 신축도 "건축"이다 — 0레벨 공사판으로 놓고 노움이 지어 올린다(끝나면 1레벨)
    const inst = addBuilding(state, moveMode.type, moveMode.gx, moveMode.gy, moveMode.dir);
    inst.level = 0; inst.constructing = true;
    enqueueConstruction(inst.iid, "build", 1);
    processConstruction(Date.now());  // 빈 슬롯이 있으면 즉시 착공
    const started = constructionJobFor(inst.iid) && constructionJobFor(inst.iid).end != null;
    toast(started ? `${bdef(moveMode.type).name} 건설 시작!` : `${bdef(moveMode.type).name} 건설 대기 (건축반 가득 참)`);
    updateHud();
  }
  exitMove();
}

// 맵의 건물을 보관함에 넣기 (그 자리가 비어 바닥을 꾸밀 수 있게 됨)
function storeBuilding(iid) {
  const b = byIid(iid);
  if (!b) return;
  if (b.constructing || constructionJobFor(iid)) { toast("건축이 끝나야 보관할 수 있다"); return; }
  const i = state.buildings.indexOf(b);
  if (i < 0) return;
  state.buildings.splice(i, 1);
  (state.held || (state.held = [])).push(b);
  exitMove();  // updateEditUI → updateBoxBar 로 박스 갱신됨
  toast(`${bdef(b.type).name} 보관함에 넣음`);
}
// 보관함에서 꺼내 배치 시작 (카메라 중앙 근처에 유령을 띄운다)
function placeFromBox(idx) {
  const h = (state.held || [])[idx];
  if (!h) return;
  if (!editMode) setEditMode(true);
  const t = worldToTile(cam.x, cam.y);
  const f = footDims(h.type, h.dir);
  const gx = Math.max(0, Math.min(MAP_W - f.w, t.gx));
  const gy = Math.max(0, Math.min(MAP_H - f.h, t.gy));
  moveMode = { iid: h.iid, type: h.type, gx, gy, dir: h.dir, fromBox: true, heldRef: h };
  closePanel();
  document.getElementById("move-ctl").classList.remove("hidden");
  updateMoveCtl(); updateEditUI();
  toast("놓을 자리를 탭해라");
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
document.getElementById("mv-store").addEventListener("click", () => {
  if (moveMode && moveMode.iid != null && !moveMode.fromBox && moveMode.cost == null) storeBuilding(moveMode.iid);
});

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
