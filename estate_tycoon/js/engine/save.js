// estate_tycoon — 저장 시스템 + 파일 내보내기/가져오기 + 로컬 HTML + 부팅·메인 루프
"use strict";

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
    version: GAME_DATA.version, gameVersion: GAME_DATA.gameVersion, ts: Date.now(), data,
    meta: { gold: Math.floor(state.res.gold || 0), castle: castleLevel() },
    sum: checksum(JSON.stringify(data)),
  };
}

/* ── 저장 마이그레이션 ──────────────────────────────────────────
   저장 "구조"가 바뀌어 GAME_DATA.version 을 올릴 때, 여기에 [옛version]: fn 을 추가한다.
   fn(d) = 그 version 의 data 객체를 받아 "바로 다음 version"의 data 로 바꿔 돌려준다.
   체인으로 여러 단계(4→5→6…)를 순서대로 통과시켜 옛 세이브를 현재 구조까지 끌어올린다.
   → 이렇게 하면 gameVersion 이 2.0.0 이 돼도(=구조가 몇 번 바뀌어도) 옛 세이브가 유지된다.
   지금은 비어 있음 = version 4 그대로. 구조를 바꿀 때 함수 하나만 채우면 된다.

   예) version 4 → 5 에서 농장 건물 키를 watermill → farm 으로 바꾼다면:
     4: (d) => {
       for (const b of (d.buildings || [])) if (b.type === "watermill") b.type = "farm";
       for (const b of (d.held || []))      if (b.type === "watermill") b.type = "farm";
       return d;
     },
*/
const SAVE_MIGRATIONS = {
  // (구조 변경 시 여기에 추가)
};
// 옛 저장을 현재 version 으로 끌어올린다. 변환 경로가 없거나 실패하면 null.
function migrateSave(obj) {
  let v = obj.version | 0;
  let d = obj.data;
  if (v > GAME_DATA.version) return null;   // 미래 버전 저장은 못 읽는다(다운그레이드 방지)
  while (v < GAME_DATA.version) {
    const fn = SAVE_MIGRATIONS[v];
    if (typeof fn !== "function") return null;   // 이 단계 변환이 없다 → 폐기(안전)
    try { d = fn(d); } catch (e) { return null; }
    if (!d) return null;
    v++;
  }
  return Object.assign({}, obj, { version: GAME_DATA.version, data: d });
}

function applySave(obj) {
  if (!obj || !obj.data) return false;
  // 저장 구조 버전이 다르면 마이그레이션으로 현재 구조까지 끌어올린다(안 되면 거부).
  if (obj.version !== GAME_DATA.version) {
    obj = migrateSave(obj);
    if (!obj) return false;
  }
  const d = obj.data;
  // 영주성은 맵 또는 보관함(held) 어디엔가 있어야 유효한 저장
  const heldSrc = Array.isArray(d.held) ? d.held : [];
  const allSrc = (Array.isArray(d.buildings) ? d.buildings : []).concat(heldSrc);
  if (!Array.isArray(d.buildings) || !allSrc.some(b => b && b.type === "castle")) return false;
  const fresh = freshState();
  fresh.res = Object.assign(fresh.res, d.res || {});
  fresh.buildings = [];
  fresh.held = [];
  let maxIid = 0;
  const sanitize = (src) => {
    if (!bdef(src.type)) return null; // 모르는 건물은 버림 (버전업 대비)
    const constructing = !!src.constructing;
    const b = {
      iid: src.iid || ++maxIid, type: src.type,
      gx: src.gx | 0, gy: src.gy | 0,
      dir: DIRS.includes(src.dir) ? src.dir : "SE",
      // 신축 공사 중이면 0레벨 유지, 아니면 최소 1레벨
      level: constructing ? 0 : Math.max(1, Math.min(src.level | 0 || 1, bdef(src.type).maxLevel)),
      queue: Array.isArray(src.queue) ? src.queue : [],
      accum: +src.accum || 0,
    };
    if (constructing) b.constructing = true;
    maxIid = Math.max(maxIid, b.iid);
    return b;
  };
  for (const src of d.buildings) { const b = sanitize(src); if (b) fresh.buildings.push(b); }
  for (const src of heldSrc) { const b = sanitize(src); if (b) fresh.held.push(b); }
  fresh.nextIid = Math.max(d.nextIid || 1, maxIid + 1);
  // 진행 중 건축 복원 (건물이 남아 있는 작업만). end 는 절대시각이라 오프라인도 processConstruction 이 정확히 이어감
  fresh.construction = [];
  if (Array.isArray(d.construction)) {
    for (const j of d.construction) {
      if (!j || (j.kind !== "build" && j.kind !== "upgrade")) continue;
      const iid = j.iid | 0;
      if (!fresh.buildings.some(b => b.iid === iid)) continue;
      fresh.construction.push({
        iid, kind: j.kind,
        toLevel: Math.max(1, j.toLevel | 0 || 1),
        dur: Math.max(1, +j.dur || 1),
        end: (j.end == null || !isFinite(+j.end)) ? null : +j.end,
      });
    }
  }
  if (Array.isArray(d.land) && d.land.length) fresh.land = d.land.filter(k => typeof k === "string");
  if (d.tiles && typeof d.tiles === "object") fresh.tiles = d.tiles;
  // 동적 가격 상태 복원(있으면). 없으면 freshState의 기본(배수 전부 1)
  if (d.market && typeof d.market === "object") {
    const dm = d.market;
    fresh.market = {
      mult: {}, hist: {}, pending: [],
      step: dm.step | 0,
      seed: (dm.seed >>> 0) || fresh.market.seed,
      ts: +dm.ts || Date.now(),
    };
    if (dm.mult && typeof dm.mult === "object") for (const k in dm.mult) { const v = +dm.mult[k]; if (isFinite(v) && v > 0) fresh.market.mult[k] = v; }
    if (dm.hist && typeof dm.hist === "object") for (const k in dm.hist) if (Array.isArray(dm.hist[k])) fresh.market.hist[k] = dm.hist[k].map(Number).filter(isFinite);
    if (Array.isArray(dm.pending)) fresh.market.pending = dm.pending.filter(p => p && GAME_DATA.market.prices[p.res] != null && isFinite(+p.amount)).map(p => ({ res: p.res, amount: +p.amount, at: p.at | 0 }));
  }
  fresh.createdTs = d.createdTs || Date.now();
  state = fresh;
  syncLand();
  groundDirty = true;  // 칠한 지형이 바뀌었으니 바닥 다시 그림
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

/* ── 배경음(BGM) ──
   HTMLAudio 로 루프 재생. 브라우저 자동재생 정책 때문에 접속 후 "첫 사용자 입력"에서 시작한다.
   켜기/끄기 상태는 localStorage 에 저장(기본 켜짐). standalone 때는 EMBEDDED_ASSETS 에서 데이터를 찾는다. */
const BGM_KEY = SKEY + "_bgm";
let bgmAudio = null;
function bgmSrc() {
  const p = (GAME_DATA.audio && GAME_DATA.audio.bgm) || "";
  return (window.EMBEDDED_ASSETS && window.EMBEDDED_ASSETS[p]) || p;
}
function bgmEnabled() {
  const v = lsGet(BGM_KEY);
  return v == null ? true : v === "on";  // 저장 없으면 기본 켜짐
}
function ensureBgm() {
  if (bgmAudio || typeof Audio === "undefined") return;  // 헤드리스 테스트 가드
  const cfg = GAME_DATA.audio;
  if (!cfg || !cfg.bgm) return;
  bgmAudio = new Audio();
  bgmAudio.loop = true;
  bgmAudio.volume = cfg.volume != null ? cfg.volume : 0.4;
  bgmAudio.preload = "auto";
  bgmAudio.src = bgmSrc();
}
function playBgm() {
  ensureBgm();
  if (!bgmAudio) return;
  const pr = bgmAudio.play();
  if (pr && pr.catch) pr.catch(() => {});  // 자동재생 차단 시 조용히 무시(다음 입력에서 재시도)
}
function pauseBgm() { if (bgmAudio) bgmAudio.pause(); }
function setBgm(on) {
  lsSet(BGM_KEY, on ? "on" : "off");
  if (on) playBgm(); else pauseBgm();
  refreshPanel();
  toast(on ? "🔊 배경음 켜짐" : "🔇 배경음 꺼짐");
}
// 첫 사용자 입력에서 (켜져 있으면) 배경음 시작 — 모바일 자동재생 제약 회피
function armBgmAutostart() {
  if (typeof window === "undefined" || !window.addEventListener) return;
  const start = () => {
    window.removeEventListener("pointerdown", start);
    window.removeEventListener("keydown", start);
    window.removeEventListener("touchstart", start);
    if (bgmEnabled()) playBgm();
  };
  window.addEventListener("pointerdown", start);
  window.addEventListener("keydown", start);
  window.addEventListener("touchstart", start);
}

/* ── 편집 시 터치영역 보기 옵션 (기본 꺼짐) ── */
const HITBOX_KEY = SKEY + "_hitbox";
function hitBoxEnabled() { return lsGet(HITBOX_KEY) === "on"; }
function setHitBox(on) {
  lsSet(HITBOX_KEY, on ? "on" : "off");
  refreshPanel();
  toast(on ? "편집 시 터치영역 표시 켬" : "편집 시 터치영역 표시 끔");
}

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
// ⚙️ 옵션 패널 — 설정(배경음·터치영역)만. 저장 관련은 아래 saveTabHTML(💾 저장 탭)로 분리했다.
function optionTabHTML() {
  const bgmOn = bgmEnabled();
  let html = `<div class="card"><div class="name" style="margin-bottom:6px">🎵 배경음</div>
    <div class="note">잔잔한 배경 음악을 켜고 끈다.</div>
    <button class="btn ${bgmOn ? "" : "alt"} wide" data-act="bgm:toggle">${bgmOn ? "🔊 배경음 켜짐 — 누르면 끔" : "🔇 배경음 꺼짐 — 누르면 켬"}</button></div>`;
  const hbOn = hitBoxEnabled();
  html += `<div class="card"><div class="name" style="margin-bottom:6px">🎯 편집 시 터치영역 보기</div>
    <div class="note">편집 모드에서 건물의 터치(탭) 영역을 청록 박스로 보여준다. 터치 영역을 손볼 때만 켜면 된다.</div>
    <button class="btn ${hbOn ? "" : "alt"} wide" data-act="hitbox">${hbOn ? "🎯 터치영역 표시 켬 — 누르면 끔" : "⬜ 터치영역 표시 꺼짐 — 누르면 켬"}</button></div>`;
  return html;
}
// 💾 저장 탭 — 자동저장·슬롯·파일 백업·로컬 HTML·초기화
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
  html += `<div class="note" style="text-align:center;margin-top:4px;opacity:0.7">버전 v${GAME_DATA.gameVersion}</div>`;
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

/* ── 로컬 단일 HTML 내보내기 ──
   index.html 안의 <script src="..."> 태그를 순서대로 읽어 전부 인라인한다.
   (파일을 더 쪼개거나 이름을 바꿔도 index.html만 맞으면 자동으로 따라간다) */
async function exportStandalone() {
  toast("파일 생성 중…");
  try {
    const fetchText = f => fetch(f).then(r => { if (!r.ok) throw new Error(f); return r.text(); });
    const html = await fetchText("index.html");
    const css = await fetchText("style.css");
    const scripts = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map(m => m[1]);
    const texts = await Promise.all(scripts.map(fetchText));

    // 게임이 쓰는 모든 그림을 base64로 수집
    const urls = new Set();
    for (const t of BTYPES) for (const dir of DIRS) urls.add(buildingImgURL(t, dir));
    for (const dir of DIRS) { urls.add(stageImgURL("stage_A", dir)); urls.add(stageImgURL("stage_B", dir)); }  // 건축 단계 그림
    if (typeof gnomeFrameList === "function") for (const u of gnomeFrameList()) urls.add(u);                    // 노움 프레임
    const gset = ASSET_MAP.ground || {};
    if (gset.grassDefault) urls.add(gset.grassDefault);
    if (gset.overrides) for (const k in gset.overrides) {
      const v = gset.overrides[k];
      const u = typeof v === "string" ? v : v.img;
      if (u) urls.add(u);
    }
    for (const ft of FEATURES) if (ft.img) urls.add(ft.img);
    for (const u of COIN_URLS) urls.add(u);
    for (const u of npcFileList()) urls.add(u);
    for (const dir of DIRS) urls.add(GAME_DATA.land.treeImg + "_" + dir + ".png");
    if (gset.roadDefault) urls.add(gset.roadDefault);
    if (gset.waterDefault) urls.add(gset.waterDefault);
    for (const t of AUTO_TYPES) {
      const acfg = autoCfg(t);
      if (acfg) for (const f of autoFileList(acfg)) urls.add(f);
    }
    if (GAME_DATA.audio && GAME_DATA.audio.bgm) urls.add(GAME_DATA.audio.bgm);  // 배경음도 임베드
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
    let out = html.replace(/<link[^>]*style\.css[^>]*\/?>/, () => "<style>\n" + css + "\n</style>");
    scripts.forEach((f, i) => {
      const inline = (i === 0 ? inject + "\n" : "") + "<script>\n" + escJs(texts[i]) + "\n<\/script>";
      out = out.replace('<script src="' + f + '"></script>', () => inline);
    });
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
  // 보관함에 안 놓은 건물이 남아 있으면 편집 모드로 복귀시켜 배치하게 한다
  if ((state.held || []).length) {
    setEditMode(true);
    toast("보관함에 놓지 않은 건물이 있다 — 배치해 주세요");
  }
  // 배경음: 켜져 있으면 재생 시도(자동재생 차단 대비 첫 입력에서도 시작)
  if (bgmEnabled()) playBgm();
  armBgmAutostart();
})();

document.addEventListener("visibilitychange", () => { if (document.hidden) autoSave(); });
window.addEventListener("pagehide", autoSave);

let lastPanelRefresh = 0;
function frame() {
  const now = Date.now();
  if (groundDirty) { groundDirty = false; buildGround(); }
  economyTick(now);
  updateNpcs(now);
  if (typeof tutorialTick === "function") tutorialTick();   // 영주성 Lv2 → 집 튜토리얼 등 조건 감지
  if (now - lastAutoTs > GAME_DATA.save.autosaveSec * 1000) autoSave();
  // 타이머·수량 표시 갱신 (패널 열려 있을 때 0.5초마다)
  if (panelKind && panelKind !== "option" && panelKind !== "save" && now - lastPanelRefresh > 500) {
    lastPanelRefresh = now;
    if (!document.activeElement || document.activeElement.tagName !== "INPUT") renderPanel();
  }
  render();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
