// estate_tycoon — 튜토리얼 (대화형: 초상 + 대사창 + 단계별 건너뛰기)
// 챕터별 흐름:
//   start      : 인트로 대화(영주+검사→왕자) → "시장을 눌러라" 안내 → 시장 열면 왕자가 시장 설명
//   production : 나무 제련소·광산을 누르면 스피어맨이 생산 설명 → 소드맨과 담당 건물 이야기
//   house      : 영주성 Lv2 되면 병사들+노움 등장, 작은 집 짓기 안내(노움은 …/!/?/🔨 로만 말함)
// 진행 상태는 localStorage(SKEY_tut)에 챕터별 완료 플래그 객체로 저장. 매 단계 건너뛰기 = 그 흐름만 완료.
// 초상: a.playwithme/assets/portraits/<이름>_left|right.png (엔진은 ../assets 로 상위 공유폴더 참조)
"use strict";

const TUT_KEY = SKEY + "_tut";                 // SKEY 는 save.js 에서 정의(먼저 로드됨)
const PORTRAIT_BASE = "../assets/portraits/";
function portraitURL(n) { return PORTRAIT_BASE + n + ".png"; }

// 초상 방향: *_left = 왼쪽 배치(오른쪽=중앙 봄), *_right = 오른쪽 배치(왼쪽 봄)
// 각 줄: { layout:"scene"|"coach", l, r, who, ava, name, text }
//   scene = 지도 위 반투명 덮개 + 좌/우 초상 마주봄 + 아래 대사창 (탭 막음)
//   coach = 덮개 없이 위쪽 대사창(+아바타)만 — 뒤의 패널(시장·생산)이 보임, 탭 통과

// ── 챕터 1: 시작 대화 ──
const TUT_INTRO = [
  { layout: "scene", l: "king_left", r: "sword_right", who: "left",  name: "영주", text: "드디어 우리 영지가 문을 열었다. 오늘부터 이 땅은 우리의 터전이다." },
  { layout: "scene", l: "king_left", r: "sword_right", who: "right", name: "검사", text: "영주님, 감축드립니다! 이 한 몸 바쳐 영지를 지키겠습니다." },
  { layout: "scene", l: "king_left", r: "sword_right", who: "left",  name: "영주", text: "든든하구나. 함께 이 땅을 훌륭히 일으켜 보자꾸나." },
  { layout: "scene", l: "king_left", r: "prince_right", who: "right", name: "왕자", text: "아버지! 아버지—!" },
  { layout: "scene", l: "king_left", r: "prince_right", who: "left",  name: "영주", text: "허허, 이 녀석. 사람들 앞에서는 아버지가 아니라 '영주님'이라 불러야지." },
  { layout: "scene", l: "king_left", r: "prince_right", who: "right", name: "왕자", text: "네, 네… 영주님. …그래도 아버지는 아버지인걸요, 헤헤." },
  { layout: "scene", l: "king_left", r: "prince_right", who: "left",  name: "영주", text: "말본새 하고는. 좋다, 이제 영지 살림의 심장인 시장을 둘러보러 가자." },
  { layout: "scene", l: "king_left", r: "prince_right", who: "right", name: "왕자", text: "시장이요? 제가 안내해 드릴게요! 절 따라오세요, 영주님." },
];
// ── 챕터 2: 시장 설명 (왕자 혼자, 시장 패널 위) ──
const TUT_MARKET = [
  { layout: "coach", ava: "prince_right", name: "왕자", text: "여기가 시장이에요. 우리가 만든 물건을 여기서 팔아 골드를 벌 수 있죠." },
  { layout: "coach", ava: "prince_right", name: "왕자", text: "📤 매도는 물건을 파는 거고, 📥 매수는 필요한 걸 사 오는 거예요." },
  { layout: "coach", ava: "prince_right", name: "왕자", text: "가격은 시간마다 오르내려요(▲▼). 그래프를 보고 비쌀 때 팔면 이득이죠!" },
  { layout: "coach", ava: "prince_right", name: "왕자", text: "1차·2차·3차 탭에서 원하는 자원을 골라 거래하시면 돼요." },
  { layout: "coach", ava: "prince_right", name: "왕자", text: "이제 영지를 직접 경영해 보세요, 영주님. 무운을 빕니다!" },
];
// ── 챕터 3: 생산 설명 (스피어맨 → 소드맨과 담당 건물) ──
const TUT_PROD = [
  { layout: "coach", ava: "spear_right", name: "스피어맨", text: "오, 영주님! 생산 시설을 살펴보고 계시는군요. 여기서 원자재를 캐고 가공해 값진 물건을 만듭니다." },
  { layout: "coach", ava: "spear_right", name: "스피어맨", text: "만들 물건을 고르고 소·중·대량 중 양을 정하면 돼요. 양이 많을수록 오래 걸리지만 한 번에 많이 나오죠." },
  { layout: "coach", ava: "spear_right", name: "스피어맨", text: "재료가 있어야 생산이 시작됩니다. 완성품은 창고(📦 자원)에 쌓이고, 시장에 내다 팔 수 있어요." },
  { layout: "coach", ava: "spear_right", name: "스피어맨", text: "생산칸은 줄서기예요. 앞엣것이 끝나면 다음이 이어서 시작되죠. 건물 레벨을 올리면 칸이 더 늘어나요." },
  { layout: "scene", l: "sword_left", r: "spear_right", who: "right", name: "스피어맨", text: "저는 이 나무 제련소를 맡아, 나무를 베고 판자로 다듬는 일을 합니다." },
  { layout: "scene", l: "sword_left", r: "spear_right", who: "left",  name: "소드맨", text: "나는 광산을 지키며 땅속의 석재와 광석을 캐낸다. …허나 우리 둘로는 벅찬 일이지." },
  { layout: "scene", l: "sword_left", r: "spear_right", who: "right", name: "스피어맨", text: "그러니 영주님! 앞으로 더 많은 건물을 짓고, 더 많은 동료를 만나 함께 영지를 키워 나가요!" },
];
// ── 챕터 4: 작은 집 짓기 (병사들 + 노움. 노움은 기호로만 말함) ──
const TUT_HOUSE = [
  { layout: "scene", l: "spear_left", r: "sword_right", who: "right", name: "소드맨", text: "영주님, 영주성이 2레벨이 되었습니다. 드디어 백성이 살 '집'을 지을 수 있게 됐어요." },
  { layout: "scene", l: "gnome_left", r: "sword_right", who: "left",  name: "노움", text: "…?! 🔨🔨!" },
  { layout: "scene", l: "gnome_left", r: "sword_right", who: "right", name: "소드맨", text: "하하, 노움이 신났군요. 이 작은 요정은 건축을 명하면 어디든 달려가 뚝딱 지어 준답니다." },
  { layout: "scene", l: "spear_left", r: "sword_right", who: "left",  name: "스피어맨", text: "집을 지으려면 아래 🏗️ 건설 탭을 여세요. '작은 집'을 골라 자리를 정하면 노움이 건축을 시작해요." },
  { layout: "scene", l: "spear_left", r: "sword_right", who: "left",  name: "스피어맨", text: "집에 백성이 들면 시간마다 세금(골드)이 쌓여요. 건물 위에 💰이 뜨면 탭해서 거두면 되죠." },
  { layout: "scene", l: "gnome_left", r: "spear_right", who: "left",  name: "노움", text: "…! 🏗️✨" },
  { layout: "scene", l: "spear_left", r: "sword_right", who: "right", name: "소드맨", text: "자, 영주님. 건설 탭에서 첫 집을 지어 백성을 맞이해 봅시다!" },
];
// ── 건물 해금 소개 (영주성 레벨 도달 시). 항상 소드맨·스피어맨이 기본 소개, 담당 동료 있으면 등장 ──
// 농장(성2) — 담당 동료(horse) 초상이 없어 기능만 소개
const TUT_FARM = [
  { layout: "scene", l: "spear_left", r: "sword_right", who: "left",  name: "스피어맨", text: "영주님, 이제 농장을 지을 수 있어요! 농장에선 밀과 감자를 기르고, 돼지·젖소 같은 가축도 키운답니다." },
  { layout: "scene", l: "spear_left", r: "sword_right", who: "right", name: "소드맨", text: "곡식과 가축은 방앗간과 교회의 귀한 재료가 되지. 영지의 먹거리가 바로 여기서 시작된다." },
];
// 대장간(성3) — 담당 동료(cavalier) 초상이 없어 기능만 소개
const TUT_BLACKSMITH = [
  { layout: "scene", l: "spear_left", r: "sword_right", who: "right", name: "소드맨", text: "영주님, 대장간을 지을 수 있게 됐습니다. 광산에서 캔 광석을 여기서 녹여 철괴·동괴, 그리고 도구를 만들죠." },
  { layout: "scene", l: "spear_left", r: "sword_right", who: "left",  name: "스피어맨", text: "좋은 도구가 있어야 더 값진 물건도 만들 수 있어요. 광산과 대장간은 단짝이랍니다." },
];
// 방앗간(성5) — 담당 동료 archer 등장
const TUT_WINDMILL = [
  { layout: "scene", l: "spear_left",  r: "sword_right", who: "left",  name: "스피어맨", text: "영주님, 이제 방앗간을 지을 수 있어요! 마침 새 동료도 막 도착했네요." },
  { layout: "scene", l: "archer_left", r: "sword_right", who: "left",  name: "아처", text: "반갑습니다, 영주님! 저는 궁수랍니다. 방앗간을 맡아 밀을 빻아 밀가루로, 또 빵으로 만들지요." },
  { layout: "scene", l: "archer_left", r: "sword_right", who: "right", name: "소드맨", text: "빵과 소시지, 우유까지 — 방앗간이 있어야 백성들이 비로소 배불리 먹는다네." },
];
// 교회(성10) — 담당 동료 mage 등장
const TUT_CHURCH = [
  { layout: "scene", l: "spear_left", r: "sword_right", who: "right", name: "소드맨", text: "영주님, 드디어 교회를 지을 수 있게 됐습니다. 저기, 현자 한 분이 오시는군요." },
  { layout: "scene", l: "mage_left",  r: "sword_right", who: "left",  name: "메이지", text: "영주님을 뵙습니다. 저는 마법사입니다. 교회에선 밀주와 치즈, 그리고 조각상·예술품 같은 귀한 것들을 다루지요." },
  { layout: "scene", l: "mage_left",  r: "sword_right", who: "right", name: "소드맨", text: "예술품은 값이 어마어마하다더군. 교회는 우리 영지의 자랑이 되겠어." },
];
// 성11 — 모든 건물 해금. "진짜 시작" 회고 + 다 함께 화이팅 (스토리 마지막)
const TUT_FINALE = [
  { layout: "scene", l: "king_left",   r: "prince_right", who: "left",  name: "영주", text: "영주성이 어느새 11레벨에 이르렀구나. …돌이켜보면, 작은 오두막 몇 채로 시작한 영지였지." },
  { layout: "scene", l: "king_left",   r: "prince_right", who: "left",  name: "영주", text: "제련소와 광산에서 시작해 농장·대장간·방앗간, 그리고 교회까지. 이제 세울 수 있는 모든 건물이 우리 손에 들어왔다." },
  { layout: "scene", l: "king_left",   r: "prince_right", who: "right", name: "왕자", text: "아버… 아니, 영주님! 여기까지 오시느라 정말 고생 많으셨어요." },
  { layout: "scene", l: "king_left",   r: "prince_right", who: "left",  name: "영주", text: "허허. 허나 이건 끝이 아니라 진짜 시작이다. 영지를 더 크고 화려하게 키울 일이 아직 산더미처럼 남았지." },
  { layout: "scene", l: "sword_left",  r: "spear_right",  who: "left",  name: "소드맨", text: "명령만 내리십시오, 영주님! 저희가 앞장서겠습니다." },
  { layout: "scene", l: "archer_left", r: "mage_right",   who: "left",  name: "아처", text: "저희도 함께해요! 방앗간도 교회도, 아직 보여드릴 게 많은걸요." },
  { layout: "scene", l: "king_left",   r: "prince_right", who: "all",   name: "영주", text: "좋다, 모두들! 우리 영지의 찬란한 앞날을 위하여—" },
  { layout: "scene", l: "king_left",   r: "prince_right", who: "all",   name: "다 함께", text: "영지를 위하여! 화이팅! 🙌🎉" },
];

let tutMode = null;   // null | "intro" | "market-wait" | "market" | "production" | "house"
let tutSeq = null;
let tutIdx = 0;
let tutFlow = null;   // "start" | "production" | "house" — 건너뛰기 범위

/* ── 진행 상태(챕터별 완료 플래그) 저장 ── */
let _tut = null;
function tutData() {
  if (_tut) return _tut;
  const v = lsGet(TUT_KEY);                 // lsGet/lsSet 은 save.js (JSON 왕복)
  if (v && typeof v === "object") _tut = v;
  else if (v === "done") _tut = { intro: true, market: true };   // 구버전 문자열
  else if (v === "market") _tut = { intro: true };               // 구버전: 인트로만 끝
  else _tut = {};
  return _tut;
}
function isDone(ch) { return !!tutData()[ch]; }
function setDone(ch) { tutData()[ch] = true; lsSet(TUT_KEY, tutData()); }
function clearTut() { _tut = {}; try { localStorage.removeItem(TUT_KEY); } catch (e) {} }

/* ── DOM 만들기 (한 번만) ── */
let tutBuilt = false;
function buildTut() {
  if (tutBuilt || typeof document === "undefined" || !document.body) return;
  tutBuilt = true;
  const ov = document.createElement("div");
  ov.id = "tut"; ov.className = "hidden";
  ov.innerHTML =
    '<div id="tut-scene">' +
      '<img id="tut-pl" class="tut-por left" alt="">' +
      '<img id="tut-pr" class="tut-por right" alt="">' +
    '</div>' +
    '<div id="tut-box">' +
      '<img id="tut-ava" alt="">' +
      '<div id="tut-name"></div>' +
      '<div id="tut-text"></div>' +
      '<div id="tut-ctl">' +
        '<button id="tut-skip">건너뛰기</button>' +
        '<button id="tut-next">다음 ▶</button>' +
      '</div>' +
    '</div>';
  document.body.appendChild(ov);

  const hint = document.createElement("div");
  hint.id = "tut-hint"; hint.className = "hidden";
  hint.innerHTML = '<span id="tut-hint-txt"></span><button id="tut-hint-skip">건너뛰기</button>';
  document.body.appendChild(hint);

  ov.addEventListener("click", () => { if (tutSeq) tutNext(); });
  document.getElementById("tut-next").addEventListener("click", e => { e.stopPropagation(); tutNext(); });
  document.getElementById("tut-skip").addEventListener("click", e => { e.stopPropagation(); skipTut(); });
  document.getElementById("tut-hint-skip").addEventListener("click", e => { e.stopPropagation(); skipTut(); });
}

/* ── 화면 갱신 ── */
function setPor(img, name, active) {
  if (!name) { img.style.display = "none"; return; }
  img.style.display = "block";
  const url = portraitURL(name);
  if (img.getAttribute("src") !== url) img.setAttribute("src", url);
  img.classList.toggle("dim", !active);
  img.classList.toggle("small", name.indexOf("gnome") === 0);   // 노움은 훨씬 작게
}
function showLineObj(line) {
  buildTut();
  const layout = line.layout || "scene";
  const ov = document.getElementById("tut");
  ov.classList.remove("hidden", "scene", "coach");
  ov.classList.add(layout);
  if (layout === "scene") {
    const all = line.who === "all";   // 다 함께(화이팅) — 양쪽 다 밝게
    setPor(document.getElementById("tut-pl"), line.l, all || line.who === "left");
    setPor(document.getElementById("tut-pr"), line.r, all || line.who === "right");
  } else {
    document.getElementById("tut-ava").setAttribute("src", portraitURL(line.ava || "prince_right"));
  }
  document.getElementById("tut-name").textContent = line.name || "";
  document.getElementById("tut-text").textContent = line.text || "";
}
function hideOverlay() { const ov = document.getElementById("tut"); if (ov) ov.classList.add("hidden"); }
function showHint(txt) {
  buildTut();
  document.getElementById("tut-hint-txt").textContent = txt;
  document.getElementById("tut-hint").classList.remove("hidden");
}
function hideHint() { const h = document.getElementById("tut-hint"); if (h) h.classList.add("hidden"); }

/* ── 흐름 ── */
function runSeq(seq, mode, flow) {
  tutSeq = seq; tutMode = mode; tutFlow = flow; tutIdx = 0;
  hideHint();
  showLineObj(seq[0]);
}
function tutNext() {
  if (!tutSeq) return;
  tutIdx++;
  if (tutIdx >= tutSeq.length) { endSeq(); return; }
  showLineObj(tutSeq[tutIdx]);
}
function endSeq() {
  const mode = tutMode;
  tutSeq = null;
  if (mode === "intro") { setDone("intro"); startMarketWait(); return; }
  // 그 밖(market/production/house/farm/blacksmith/windmill/church/finale)은 mode 이름 = 완료 챕터
  if (mode) setDone(mode);
  finishFlow();
}
function finishFlow() { tutMode = null; tutSeq = null; tutFlow = null; hideOverlay(); hideHint(); }

function startIntro() { runSeq(TUT_INTRO, "intro", "start"); }
function startMarketWait() {
  tutMode = "market-wait"; tutFlow = "start"; tutSeq = null;
  hideOverlay();
  showHint("🛒 아래 지도에서 시장을 눌러 보세요");
  centerCameraOnMarket();
}
function skipTut() {
  const flow = tutFlow;
  if (flow === "start") { setDone("intro"); setDone("market"); }   // 시작 흐름 = 인트로+시장
  else if (flow) setDone(flow);                                    // 그 밖 흐름은 이름 = 완료 챕터
  finishFlow();
  if (typeof toast === "function") toast("튜토리얼을 건너뛰었다");
}

// 시장이 화면 밖일 수 있으니 카메라를 시장으로 맞춘다
function centerCameraOnMarket() {
  if (typeof byType !== "function" || typeof isoX !== "function") return;
  const m = byType("market")[0];
  if (!m) return;
  const f = footDims(m.type, m.dir);
  cam.x = isoX(m.gx + f.w / 2, m.gy + f.h / 2);
  cam.y = isoY(m.gx + f.w / 2, m.gy + f.h / 2);
  clampCam();
}

/* ── 트리거: 패널이 열릴 때 ui.js 가 불러 준다 ── */
function tutorialOnPanel(kind, arg) {
  // 시장 대기 중 → 시장을 열면 시장 설명 시작
  if (tutMode === "market-wait") {
    let isMarket = kind === "market";
    if (!isMarket && kind === "building" && typeof byIid === "function") {
      const b = byIid(arg); isMarket = !!(b && b.type === "market");
    }
    if (isMarket) runSeq(TUT_MARKET, "market", "start");
    return;
  }
  // 다른 튜토리얼이 안 떠 있고, 시작 흐름이 끝났으며, 생산 튜토리얼 전이면
  // 나무 제련소·광산을 누를 때 생산 설명 시작
  if (tutMode === null && isDone("market") && !isDone("production") && kind === "building" && typeof byIid === "function") {
    const b = byIid(arg);
    if (b && (b.type === "lumbermill" || b.type === "mine")) runSeq(TUT_PROD, "production", "production");
  }
}

/* ── 트리거: 매 프레임 체크 (save.js 루프에서 호출) — 영주성 레벨에 따라 순서대로 ──
   같은 레벨에 여럿이면 목록 순서대로 하나씩(앞엣것 끝나면 다음 프레임에 다음 것). */
const CASTLE_TUTS = [
  { ch: "house",      lv: 2,  seq: TUT_HOUSE },       // 작은 집 (병사들 + 노움)
  { ch: "farm",       lv: 2,  seq: TUT_FARM },        // 농장 (기능 소개)
  { ch: "blacksmith", lv: 3,  seq: TUT_BLACKSMITH },  // 대장간 (기능 소개)
  { ch: "windmill",   lv: 5,  seq: TUT_WINDMILL },    // 방앗간 (동료 archer)
  { ch: "church",     lv: 10, seq: TUT_CHURCH },      // 교회 (동료 mage)
  { ch: "finale",     lv: 11, seq: TUT_FINALE },      // 모든 건물 해금 — 진짜 시작 (스토리 끝)
];
function tutorialTick() {
  if (tutMode !== null) return;
  if (!isDone("market")) return;                       // 시작 흐름부터 끝난 뒤
  if (typeof castleLevel !== "function") return;
  const lv = castleLevel();
  for (const t of CASTLE_TUTS) {
    if (!isDone(t.ch) && lv >= t.lv) { runSeq(t.seq, t.ch, t.ch); return; }
  }
}

/* ── 부팅: 시작 흐름만 진행 상태에 따라 재개(생산·집은 각자 트리거로) ── */
function tutorialBoot() {
  if (typeof document === "undefined" || !document.body) return;
  if (!isDone("intro")) startIntro();
  else if (!isDone("market")) startMarketWait();
  // 자주 쓰는 초상 미리 받아두기
  if (typeof Image !== "undefined") {
    ["prince_right", "spear_right", "spear_left", "sword_left", "sword_right", "gnome_left", "archer_left", "mage_left"]
      .forEach(n => { const im = new Image(); im.src = portraitURL(n); });
  }
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", tutorialBoot);
  else tutorialBoot();
}
