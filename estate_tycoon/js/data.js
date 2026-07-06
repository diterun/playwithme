// estate_tycoon — 밸런스·규칙 SSOT (★ 여기 숫자만 고치면 게임 전체 밸런스가 바뀐다)
//
// 이 파일은 "게임의 규칙"만 담는다: 건물 성능, 레벨업 비용, 레시피(생산품·시간·양),
//   판매가, 개간 비용 곡선, 저장 설정.
// "새 게임의 초기 상태"(맵 크기·시작 자원·시작 건물 배치·처음 열린 땅)는 start.js 에서 고친다.
// 그림 교체(건물 PNG·타일)는 assets.js 에서 한다.
//
// ★ 건물 추가하는 법: 아래 buildings 에 새 키를 하나 더 넣으면 된다(생산건물이면 recipes,
//   집이면 house, 시장류면 queueUnlock/priceBonus). start.js 시작 배치나 extraBuilds 건설
//   허가에서 그 키를 쓰면 게임에 나온다. 엔진 코드는 안 건드려도 된다.
//   건물 그림은 assets/building/<img>_<방향>.png 를 자동으로 찾는다(img 값이 파일 접두어).
//
// ★ 이미지 보정값 (건물 그림이 발판 칸과 안 맞을 때 만지는 4개):
//   imgScale : 그림 크기 배율. 1.0 = 발판 폭에 딱 맞춤
//   imgFoot  : 그림 바닥이 이미지 세로의 몇 % 지점인지. 키우면 그림이 아래로 내려간다
//   imgDX    : 그림을 좌우로 밀기(픽셀). +는 오른쪽, -는 왼쪽
//   imgDY    : 그림을 위아래로 밀기(픽셀). +는 아래, -는 위
//   → 맞추는 요령: 맨 아래 debug.footprints 를 true 로 켜면 노란 테두리(발판)와
//     빨간 점(기준 꼭짓점 gx,gy)이 맵에 보인다. 그걸 보면서 숫자를 맞춰라.
//   방향(회전)마다 어긋남이 다르면 네 값 모두 숫자 대신 방향별 객체로 쓸 수 있다.
//   예) imgDX: { SE: 0, SW: -6, NW: 0, NE: 6 }  (빠진 방향은 0으로 취급)
//
// ★ 터치(탭) 면적 보정값 — ⚠️ 그림 크기와 무관하게 "잡히는 영역"만 바꾼다 (위 imgScale 은 그림 자체가 커/작아짐):
//   hitScale  : 그림 박스 대비 터치 박스 비율. 1.0 = 그림 그대로(기본), 0.6 = 60%로 축소. (가로·세로 동시)
//               ★ 축소는 "바닥(건물이 앉은 쪽)" 기준 — 줄이면 위(지붕/빈 공간)가 잘리고 아래 몸통만 남는다.
//   hitScaleX / hitScaleY : 가로·세로를 따로 줄일 때 (없으면 hitScale 사용)
//   hitDX / hitDY : 터치 박스를 픽셀 단위로 옮기기(+오른쪽/+아래). 건물 몸통 쪽으로 맞출 때.
//   → 편집 모드에서 회색 점선=그림 박스, 청록 박스=터치 박스. 발판(바닥 칸) 탭은 이 값과 무관하게 항상 잡힌다.
//   네 값 모두 방향별 객체로도 쓸 수 있다. 예) hitScale: { SE: 0.6, NW: 0.7 }
//
// ★ 레벨업 비용 공식 (지수 곡선 — 렙이 오를수록 다음 렙이 급격히 비싸진다):
//   cost.base = 2레벨로 올리는 비용. 이후 레벨마다 ×growth 로 곱해진다 → 비용 = base × growth^(렙-2).
//   즉 매 레벨 growth배씩 커지는 지수함수. 1→50렙까지 매끈하게 가팔라진다. (예: growth 1.2 면 50렙 ≈ base의 6300배)
//   (선택) growthLate + easyUntil 을 주면 easyUntil 레벨 이후부터 ×growthLate 로 더 가파르게 꺾을 수도 있다.
//
// ★ 대기열(큐) 방식: 생산·판매는 "줄을 선다". 맨 앞 하나만 진행되고 끝나면 다음이 시작.
//   queueUnlock = 대기열 칸이 열리는 건물 레벨 목록. 예) [1, 5, 15] = 1렙 1칸, 5렙 2칸, 15렙 3칸.
//
// ★ 생산량 단계 (소량/중량/대량) — tiers:
//   레시피 하나에 tiers:3 을 주면 소·중·대 세 가지로 만들 수 있고, tiers:2 면 소·중만.
//   레시피의 in/out/time 은 "소량" 기준이고, 중·대는 아래 tiers 표의 배율(outMul·timeMul)이
//   투입·산출·시간에 곱해진다. (1차 생산품=원재료 없음→3단계, 2차 이상=2단계 라고 스펙이 정함)
"use strict";

const GAME_DATA = {
  // ── 버전 ────────────────────────────────────────────────
  // gameVersion = 사람이 보는 버전(semver). patch(1.0.x)=버그수정·자잘한 개선, minor(1.x.0)=★큰 기능★ 추가, major(x.0.0)=대개편.
  //   ★ 저장 파일과 무관 — 이 값은 얼마든지 올려도 세이브가 유지된다. 원하는 대로 올려라.
  gameVersion: "1.0.3",
  // version = 저장 "구조" 버전(정수). 저장 데이터의 모양이 바뀔 때만 +1 한다.
  //   ★ 올릴 때는 반드시 save.js 의 SAVE_MIGRATIONS 에 [옛version]: (d)=>… 변환 함수를 추가한다.
  //     그러면 옛 세이브가 자동으로 새 구조로 올라와 유지된다(그래서 gameVersion 2.0.0 이 돼도 세이브가 산다).
  //   변환 함수 없이 올리면 옛 세이브는 폐기된다(호환 불가일 때만 일부러 그렇게).
  version: 4,

  // ── 생산량 단계 배율 (소·중·대) ─────────────────────────────
  // 레시피의 소량(기본) 값에 이 배율을 곱한다. outMul = 투입·산출 배율, timeMul = 시간 배율.
  // ★ 의도: 소량=빠르고 적게 / 중량=적당 / 대량=오래·많이. 단 "소량을 계속" 하는 편이 초당 생산량이
  //   제일 좋다(중량>대량). 즉 부지런히 소량 반복 = 효율, 대량 = 오래 방치(오프라인)용.
  //   예) 소량 10개/1분 → 중량 50개/10분 → 대량 200개/1시간 (초당: 0.167 > 0.083 > 0.056)
  tiers: {
    small:  { name: "소량", outMul: 1,  timeMul: 1  },
    medium: { name: "중량", outMul: 5,  timeMul: 10 },
    large:  { name: "대량", outMul: 20, timeMul: 60 },
  },

  // ── 건축(신축·레벨업 공통) ────────────────────────────────
  // 신축·레벨업 모두 "건축"이며 시간이 든다. 노움이 그 자리에 붙어 점프한다.
  // 건축 시간(초) = 건물의 buildBase × growth^(목표레벨-1). 목표레벨=신축이면 1, 레벨업이면 올릴 레벨.
  //   → 레벨이 높을수록 다음 레벨 건축이 점점 오래 걸린다(지수). growth 는 건물별 buildGrowth 로 덮을 수 있다.
  // baseSlots = 동시에 진행 가능한 건축 수. slotAt = 영주성이 이 레벨이 되면 슬롯 +1 (여기선 10/20/30 → 최대 5).
  // (건물별 buildBase 는 각 건물 정의 안에 있다: 제련소·광산·농장·작은집이 빠르고, 큰집→대장간→방앗간→교회 순으로 느리다)
  construction: {
    baseSlots: 2,
    slotAt: [10, 20, 30],
    growth: 1.13,       // 건물별 buildGrowth 없으면 이 값 사용
    baseDefault: 60,    // 건물에 buildBase 없을 때 기본
  },

  // ── 자원 정의 (표시용 이름·아이콘) ───────────────────────
  resources: {
    gold:       { name: "골드",     icon: "🪙" },
    // 1차 — 나무·채굴·농사
    wood:       { name: "나무",     icon: "🪵" },
    stone:      { name: "석재",     icon: "🪨" },
    iron_ore:   { name: "철광석",   icon: "⛰️" },
    coal:       { name: "석탄",     icon: "🌑" },
    copper_ore: { name: "동광석",   icon: "🟤" },
    silver_ore: { name: "은광석",   icon: "⚪" },
    gold_ore:   { name: "금광석",   icon: "🟡" },
    wheat:      { name: "밀",       icon: "🌾" },
    yeast:      { name: "효모",     icon: "🫧" },
    potato:     { name: "감자",     icon: "🥔" },
    // 2차 — 제련·가공
    plank:      { name: "판자",     icon: "🪚" },
    iron_bar:   { name: "철괴",     icon: "🔩" },
    copper_bar: { name: "동괴",     icon: "🥉" },
    silver_bar: { name: "은괴",     icon: "🥈" },
    gold_bar:   { name: "금괴",     icon: "🥇" },
    tool:       { name: "도구",     icon: "🔨" },
    flour:      { name: "밀가루",   icon: "🥣" },
    pig:        { name: "돼지",     icon: "🐖" },
    cow:        { name: "젖소",     icon: "🐄" },
    mead:       { name: "밀주",     icon: "🍺" },
    // 3차 이상 — 완성품·사치품
    furniture:  { name: "가구",     icon: "🪑" },
    table:      { name: "테이블",   icon: "🛋️" },
    bread:      { name: "빵",       icon: "🍞" },
    sausage:    { name: "소시지",   icon: "🌭" },
    milk:       { name: "우유",     icon: "🥛" },
    cheese:     { name: "치즈",     icon: "🧀" },
    bow:        { name: "활",       icon: "🏹" },
    bow_ward:   { name: "파마의 활", icon: "☄️" },
    bow_gold:   { name: "금장식 활", icon: "🏆" },
    statue:     { name: "조각상",   icon: "🗿" },
    mirror:     { name: "동판 거울", icon: "🪞" },
    artwork:    { name: "예술품",   icon: "🖼️" },
  },

  // ── 영지 개간 규칙 (땅 확장 비용·숲 그림) ─────────────────
  land: {
    chunkSize: 4,
    cost: { base: 400, growth: 1.35 },
    treeImg: "../assets/deco/trees_A_large",
    treeScale: 1.4,
    treeFoot: 0.9,
  },

  // ── 건물 정의 ────────────────────────────────────────────
  // w×h = 발판 칸 크기, maxLevel = 레벨 상한(영주성 제외 전부 영주성 레벨에도 묶임),
  // cost = 레벨업 비용 곡선, recipes = 생산 레시피, house = 집 경제, queueUnlock = 대기열 칸.
  // recipes 각 항목: name(=생산품 이름), in(투입, 없으면 생략), out(산출), time(소량 기준 초),
  //   unlock(이 레시피 열리는 건물 레벨), tiers(3=소·중·대 / 2=소·중, 생략하면 1=단일).
  buildings: {
    castle: {
      name: "영주성", icon: "🏰",
      w: 4, h: 4, maxLevel: 50,
      img: "castle", imgScale: 1.3, imgFoot: 1, imgDX: 0, imgDY: 0,
      hitScaleX: 0.45, hitScaleY: 0.82, hitDX: 0, hitDY: -10,   // 터치 박스(그림 크기와 별개). 편집 모드 청록 박스 보며 조정
      desc: "영지의 심장. 다른 모든 건물의 레벨 상한이 영주성 레벨이다. 최대 50렙.",
      buildBase: 60,   // 건축 기본 시간(초). 영주성은 규모가 커 느린 편.
      cost: { base: { gold: 500, wood: 40, stone: 40 }, growth: 1.22 },  // 단일 지수곡선 (50렙 ≈ ×14000)
    },

    market: {
      name: "시장", icon: "🛒",
      w: 4, h: 3, maxLevel: 50,
      img: "market", imgScale: 1.05, imgFoot: 1,
      imgDX: { SE: 5, SW: 0, NW: 0, NE: 0 }, imgDY: { SE: 25, SW: 27, NW: 25, NE: 25 },
      hitScaleX: 0.78, hitScaleY: 0.58, hitDX: -4, hitDY: -37,
      desc: "자원을 사고판다(대기열 2칸 고정). 레벨이 오르면 스프레드가 좋아진다.",
      buildBase: 45,
      queueUnlock: [1, 1],   // 항상 2칸 (레벨 올려도 안 늘어남)
      cost: { base: { gold: 300, wood: 30 }, growth: 1.20 },
    },

    lumbermill: {
      name: "나무 제련소", icon: "🪵",
      w: 3, h: 3, maxLevel: 50,
      img: "lumbermill", imgScale: 1.2, imgFoot: 1,
      imgDX: { SE: 0, SW: 10, NW: 0, NE: 0 }, imgDY: { SE: 10, SW: 10, NW: 3, NE: 8 },
      hitScaleX: 0.57, hitScaleY: 0.76, hitDX: { SE: 10, SW: -10, NW: -10, NE: 10 }, hitDY: -20,
      desc: "나무를 켠다. 레벨이 오르면 판자·가구, 그리고 활 계열 가공이 열린다.",
      buildBase: 30,   // 빠른 편
      queueUnlock: [1, 1, 10, 20, 35],  // 1렙 2칸 → 10렙 3 → 20렙 4 → 35렙 5
      outBonus: 0.25,
      recipes: [
        { name: "나무",       time: 30,   out: { wood: 15 },     unlock: 1,  tiers: 3 },  // 1차: 대량 300개/30분
        { name: "판자",       time: 600,  in: { wood: 4 },       out: { plank: 20 },     unlock: 3,  tiers: 2 },  // 2차 소량 = 1차 중량(10분)
        { name: "가구",       time: 3600, in: { plank: 4 },      out: { furniture: 12 }, unlock: 8,  tiers: 2 },  // 3차 소량 = 1차 대량(1시간)
        { name: "활",         time: 3600, in: { wood: 6, tool: 2 },                 out: { bow: 6 },      unlock: 15, tiers: 2 },
        { name: "파마의 활",  time: 3600, in: { wood: 6, tool: 2, silver_bar: 2 }, out: { bow_ward: 4 }, unlock: 25, tiers: 2 },
        { name: "금장식 활",  time: 3600, in: { wood: 6, tool: 2, gold_bar: 2 },   out: { bow_gold: 3 }, unlock: 40, tiers: 2 },
      ],
      cost: { base: { gold: 250, stone: 25 }, growth: 1.20 },
    },

    mine: {
      name: "광산", icon: "⛏️",
      w: 3, h: 3, maxLevel: 50,
      img: "mine", imgScale: 1.05, imgFoot: 1,
      imgDX: { SE: 7, SW: -5, NW: 7, NE: -5 }, imgDY: { SE: 15, SW: 15, NW: 17, NE: 20 },
      hitScaleX: 0.63, hitScaleY: 0.61, hitDX: 0, hitDY: -28,
      desc: "광물을 캔다. 레벨이 오르면 석탄·동·은·금광석이 차례로 열린다.",
      buildBase: 30,   // 빠른 편
      queueUnlock: [1, 1, 10, 20, 35],
      outBonus: 0.25,
      recipes: [
        { name: "석재",   time: 18, out: { stone: 15 },     unlock: 1,  tiers: 3 },
        { name: "철광석", time: 24, out: { iron_ore: 12 },  unlock: 1,  tiers: 3 },
        { name: "석탄",   time: 40, out: { coal: 10 },      unlock: 5,  tiers: 3 },
        { name: "동광석", time: 96, out: { copper_ore: 10 }, unlock: 5,  tiers: 3 },  // 대량 200개/1.6시간 (5큐 ≈ 8시간)
        { name: "은광석", time: 180, out: { silver_ore: 6 }, unlock: 10, tiers: 3 },
        { name: "금광석", time: 288, out: { gold_ore: 4 },   unlock: 15, tiers: 3 },  // 대량 80개/4.8시간 (5큐 ≈ 24시간)
      ],
      cost: { base: { gold: 280, wood: 25 }, growth: 1.20 },
    },

    blacksmith: {
      name: "대장간", icon: "⚒️",
      w: 3, h: 3, maxLevel: 50,
      img: "blacksmith", imgScale: 1.2, imgFoot: 1, imgDX: 0, imgDY: 8,
      hitScale: 0.64, hitDX: { SE: 0, SW: 0, NW: 0, NE: 0 }, hitDY: -25,
      desc: "광석을 녹여 괴·도구로 만든다. 판자·석재로 가구류도 짠다.",
      buildBase: 90,   // 느린 편
      queueUnlock: [1, 1, 10, 20, 35],
      outBonus: 0.25,
      recipes: [
        { name: "철괴",   time: 600,  in: { iron_ore: 3 },              out: { iron_bar: 20 },   unlock: 1,  tiers: 2 },   // 2차 = 1차 중량
        { name: "동괴",   time: 600,  in: { copper_ore: 3, coal: 1 },   out: { copper_bar: 15 }, unlock: 5,  tiers: 2 },
        { name: "테이블", time: 3600, in: { plank: 2, stone: 2 },       out: { table: 12 },      unlock: 10, tiers: 2 },   // 3차 = 1차 대량
        { name: "은괴",   time: 600,  in: { silver_ore: 3, coal: 1 },   out: { silver_bar: 12 }, unlock: 15, tiers: 2 },
        { name: "도구",   time: 600,  in: { iron_bar: 2, coal: 1 },     out: { tool: 12 },       unlock: 15, tiers: 2 },
        { name: "금괴",   time: 600,  in: { gold_ore: 3, coal: 1 },     out: { gold_bar: 8 },    unlock: 20, tiers: 2 },
      ],
      cost: { base: { gold: 350, stone: 30 }, growth: 1.20 },
    },

    watermill: {  // 농장
      name: "농장", icon: "🌾",
      w: 3, h: 3, maxLevel: 50,
      img: "watermill", imgScale: 1.2, imgFoot: 1, imgDX: 0, imgDY: 8,
      hitScaleX: 0.63, hitScaleY: 0.77, hitDX: 0, hitDY: -15,
      desc: "밀·감자를 기르고 가축을 친다. 밀·효모·감자는 소·중·대량으로.",
      buildBase: 30,   // 빠른 편
      queueUnlock: [1, 1, 10, 20, 35],
      outBonus: 0.25,
      recipes: [
        { name: "밀",   time: 20,  out: { wheat: 15 },  unlock: 1,  tiers: 3 },
        { name: "효모", time: 30,  out: { yeast: 10 },  unlock: 2,  tiers: 3 },
        { name: "감자", time: 25,  out: { potato: 15 }, unlock: 5,  tiers: 3 },
        { name: "돼지", time: 600, in: { potato: 4 },            out: { pig: 10 }, unlock: 8,  tiers: 2 },  // 2차 = 1차 중량
        { name: "젖소", time: 600, in: { wheat: 4, potato: 4 },  out: { cow: 8 },  unlock: 12, tiers: 2 },
      ],
      cost: { base: { gold: 260, wood: 25 }, growth: 1.20 },
    },

    windmill: {  // 방앗간
      name: "방앗간", icon: "🌬️",
      w: 3, h: 3, maxLevel: 50,
      img: "windmill", imgScale: 1.2, imgFoot: 1, imgDX: 0, imgDY: 8,
      hitScaleX: 0.58, hitScaleY: 0.71, hitDX: 0, hitDY: -15,
      desc: "밀을 빻고 가축을 가공한다. 밀가루·빵·소시지·우유.",
      buildBase: 120,   // 더 느림
      queueUnlock: [1, 1, 10, 20, 35],
      outBonus: 0.25,
      recipes: [
        { name: "밀가루", time: 600,  in: { wheat: 3 }, out: { flour: 25 },   unlock: 1,  tiers: 2 },  // 2차 = 1차 중량
        { name: "빵",     time: 3600, in: { flour: 3 }, out: { bread: 30 },   unlock: 3,  tiers: 2 },  // 3차 = 1차 대량
        { name: "소시지", time: 3600, in: { pig: 1 },   out: { sausage: 20 }, unlock: 5,  tiers: 2 },
        { name: "우유",   time: 3600, in: { cow: 1 },   out: { milk: 30 },    unlock: 10, tiers: 2 },
      ],
      cost: { base: { gold: 300, plank: 15 }, growth: 1.20 },
    },

    church: {  // 교회
      name: "교회", icon: "⛪",
      w: 3, h: 3, maxLevel: 50,
      img: "church", imgScale: 1.25, imgFoot: 1, imgDX: 0, imgDY: 6,
      hitScaleX: 0.61, hitScaleY: 0.67, hitDX: 0, hitDY: -10,
      desc: "술·치즈를 빚고, 예술과 사치품을 만든다.",
      buildBase: 180,   // 가장 느림
      queueUnlock: [1, 1, 10, 20, 35],
      outBonus: 0.25,
      recipes: [
        { name: "밀주",      time: 600,  in: { wheat: 3, yeast: 1 },                  out: { mead: 12 },   unlock: 1,  tiers: 2 },  // 2차 = 1차 중량
        { name: "치즈",      time: 3600, in: { milk: 3 },                             out: { cheese: 15 }, unlock: 10, tiers: 2 },  // 3차 = 1차 대량
        { name: "조각상",    time: 3600, in: { stone: 4, tool: 1 },                   out: { statue: 8 },  unlock: 15, tiers: 2 },
        { name: "동판 거울", time: 3600, in: { copper_bar: 2, tool: 1 },              out: { mirror: 6 },  unlock: 20, tiers: 2 },
        { name: "예술품",    time: 3600, in: { furniture: 1, silver_bar: 2, gold_bar: 2 }, out: { artwork: 4 }, unlock: 35, tiers: 2 },
      ],
      cost: { base: { gold: 500, stone: 40 }, growth: 1.21 },
    },

    house_small: {
      name: "작은 집", icon: "🏠",
      w: 2, h: 2, maxLevel: 20,
      img: "home_A", imgScale: 1.3, imgFoot: 0.95, imgDX: 0, imgDY: 0,
      hitScaleX: 0.7, hitScaleY: 0.72, hitDX: 0, hitDY: -13,
      desc: "주민이 세금을 낸다. 쌓인 골드는 💰 표시를 눌러 수거.",
      buildBase: 20,   // 가장 빠름
      // rate = 초당 골드. rateBonus = 레벨당 배수(+). capPerLevel = 저장 상한(×레벨). showAt = 💰 뜨는 액수.
      // demand = 주민 소비: 이 레벨 이상이면 item 을 초당 rate 만큼 먹고, 배부른 만큼 세금이 ×(1+boost).
      //   재고가 없으면 그냥 기본 세금(마이너스는 없음). from 이 높은 것이 우선(고레벨일수록 고급품 소비).
      house: {
        rate: 0.3, rateBonus: 0.5, capPerLevel: 500, showAt: 100,
        demand: [
          { from: 10, item: "bread",  rate: 1 / 60, boost: 1.0 },
          { from: 15, item: "cheese", rate: 1 / 90, boost: 1.6 },
        ],
      },
      cost: { base: { gold: 200 }, growth: 1.28 },
    },

    house_big: {
      name: "큰 집", icon: "🏡",
      w: 3, h: 3, maxLevel: 20,
      img: "home_B", imgScale: 1.2, imgFoot: 0.95, imgDX: 0, imgDY: 0,
      hitScaleX: 0.60, hitScaleY: 0.75, hitDX: 0, hitDY: -15,
      desc: "부유한 주민이 산다. 세금이 훨씬 많다.",
      buildBase: 60,   // 작은집보다 느림
      house: {
        rate: 1.2, rateBonus: 0.5, capPerLevel: 2000, showAt: 400,
        demand: [
          { from: 10, item: "sausage", rate: 1 / 60, boost: 1.2 },
          { from: 15, item: "mead",    rate: 1 / 80, boost: 2.0 },
        ],
      },
      cost: { base: { gold: 800 }, growth: 1.28 },
    },
  },

  // ── 추가 건설 허가 (건설 탭) ─────────────────────────────
  // castle = 영주성이 이 레벨이 되면 목록에 열린다. 같은 종류는 위에서부터 순서대로 지어진다.
  // (시작부터 놓여 있는 건물은 여기가 아니라 start.js buildings 에서 정한다)
  // ★ 같은 종류의 허가는 반드시 castle 오름차순으로 나열할 것(먼저 것부터 소모된다).
  extraBuilds: [
    // 작은 집 (start.js 에 2채 → 최대 10채까지, 영주성 30렙 안에서)
    { type: "house_small", castle: 2,  cost: { gold: 400 } },
    { type: "house_small", castle: 4,  cost: { gold: 900 } },
    { type: "house_small", castle: 7,  cost: { gold: 2000,   plank: 20 } },
    { type: "house_small", castle: 10, cost: { gold: 5000,   plank: 40 } },
    { type: "house_small", castle: 13, cost: { gold: 12000,  furniture: 5 } },
    { type: "house_small", castle: 16, cost: { gold: 25000,  furniture: 12 } },
    { type: "house_small", castle: 20, cost: { gold: 60000,  table: 8 } },
    { type: "house_small", castle: 26, cost: { gold: 150000, table: 20 } },
    // 큰 집 (최대 6채)
    { type: "house_big",   castle: 6,  cost: { gold: 3000,   wood: 300 } },
    { type: "house_big",   castle: 9,  cost: { gold: 8000,   plank: 60 } },
    { type: "house_big",   castle: 13, cost: { gold: 20000,  furniture: 10 } },
    { type: "house_big",   castle: 18, cost: { gold: 50000,  table: 15 } },
    { type: "house_big",   castle: 24, cost: { gold: 120000, mirror: 5 } },
    { type: "house_big",   castle: 30, cost: { gold: 300000, artwork: 3 } },
    // 나무 제련소 (start.js 에 1채)
    { type: "lumbermill",  castle: 5,  cost: { gold: 1500,   wood: 200 } },
    { type: "lumbermill",  castle: 15, cost: { gold: 20000,  stone: 1000 } },
    { type: "lumbermill",  castle: 25, cost: { gold: 80000,  iron_bar: 100 } },
    { type: "lumbermill",  castle: 35, cost: { gold: 250000, gold_bar: 30 } },
    // 광산 (start.js 에 1채)
    { type: "mine",        castle: 3,  cost: { gold: 2500,   wood: 150 } },
    { type: "mine",        castle: 10, cost: { gold: 8000,   plank: 80 } },
    { type: "mine",        castle: 15, cost: { gold: 25000,  iron_bar: 50 } },
    { type: "mine",        castle: 20, cost: { gold: 60000,  tool: 40 } },
    { type: "mine",        castle: 25, cost: { gold: 150000, silver_bar: 40 } },
    // 대장간
    { type: "blacksmith",  castle: 3,  cost: { gold: 3000,   stone: 200 } },
    { type: "blacksmith",  castle: 9,  cost: { gold: 10000,  plank: 100 } },
    { type: "blacksmith",  castle: 15, cost: { gold: 30000,  iron_bar: 60 } },
    { type: "blacksmith",  castle: 35, cost: { gold: 400000, gold_bar: 40 } },
    // 농장
    { type: "watermill",   castle: 2,  cost: { gold: 1200,   wood: 120 } },
    { type: "watermill",   castle: 5,  cost: { gold: 4000,   plank: 40 } },
    { type: "watermill",   castle: 13, cost: { gold: 20000,  iron_bar: 40 } },
    { type: "watermill",   castle: 23, cost: { gold: 90000,  tool: 50 } },
    { type: "watermill",   castle: 35, cost: { gold: 350000, artwork: 2 } },
    // 방앗간
    { type: "windmill",    castle: 5,  cost: { gold: 5000,   plank: 60 } },
    { type: "windmill",    castle: 12, cost: { gold: 18000,  iron_bar: 30 } },
    { type: "windmill",    castle: 23, cost: { gold: 90000,  tool: 40 } },
    { type: "windmill",    castle: 39, cost: { gold: 500000, gold_bar: 50 } },
    // 교회
    { type: "church",      castle: 10, cost: { gold: 15000,  stone: 500, plank: 100 } },
    { type: "church",      castle: 19, cost: { gold: 70000,  silver_bar: 40 } },
    { type: "church",      castle: 41, cost: { gold: 700000, artwork: 5 } },
  ],

  // ── 시장 판매 공식 ───────────────────────────────────────
  // 받는 골드 = 개수 × prices[자원] × (1 + 시장.priceBonus×(시장레벨-1))
  // 판매 시간(초) = sellBase + 받는 골드 × sellPerGold
  // (prices 에 있는 자원만 판매 목록에 뜬다)
  market: {
    // ★ 상위 tier일수록 가격이 크게 뛴다(제작에 오래 걸리고 재료가 물려 있으니).
    prices: {
      // 1차
      wood: 3, stone: 3, iron_ore: 5, coal: 5, copper_ore: 10, silver_ore: 25, gold_ore: 70,
      wheat: 3, yeast: 8, potato: 4,
      // 2차
      plank: 40, iron_bar: 80, copper_bar: 130, silver_bar: 350, gold_bar: 900, tool: 250,
      flour: 40, pig: 200, cow: 350, mead: 300,
      // 3차
      furniture: 1200, table: 900, bread: 300, sausage: 500, milk: 350, cheese: 900,
      bow: 3000, bow_ward: 9000, bow_gold: 22000,
      statue: 4000, mirror: 5500, artwork: 40000,
    },
    // 판매 화면 탭(1차/2차/3차). 품목이 많아 단계별로 나눠 보여준다. (여기 자원은 prices 에도 있어야 뜬다)
    tabs: [
      { name: "1차", items: ["wood", "stone", "iron_ore", "coal", "copper_ore", "silver_ore", "gold_ore", "wheat", "yeast", "potato"] },
      { name: "2차", items: ["plank", "iron_bar", "copper_bar", "silver_bar", "gold_bar", "tool", "flour", "pig", "cow", "mead"] },
      { name: "3차", items: ["furniture", "table", "bread", "sausage", "milk", "cheese", "bow", "bow_ward", "bow_gold", "statue", "mirror", "artwork"] },
    ],
    // 거래(매수·매도) 소요 시간 = base + 개수×perItem, 단 max 에서 잘림.
    // ★ 골드 가치와 무관 — 비싼 물건을 대량 거래해도 시간이 폭주하지 않는다(생산 시간과 완전 별개).
    trade: { base: 5, perItem: 0.4, max: 120 },  // 예) 10개 9초 / 100개 45초 / 1000개 120초(상한)

    // ── 동적 가격(인플레/디플레) ──────────────────────────────
    // 각 자원의 기준가(prices)에 "배수(mult)"가 붙어 오르내린다. stepSec 마다 한 스텝 진행.
    // 원료가 움직이면 그걸 재료로 쓰는 제품(consumer)·같은 건물의 형제 자원(sibling)이 일부 따라 움직여
    // "연동"되고, 동시에 매 스텝 무작위 흔들림 + 가끔 큰 충격이 있어 패턴을 못 읽게 한다.
    // 결국 reversion 으로 1.0(기준가) 쪽으로 서서히 되돌아온다. band 로 폭주 방지. 오프라인도 진행(catchUpMax 스텝까지).
    dynamic: {
      enabled: true,
      stepSec: 7200,          // 2시간마다 가격 한 스텝 (그래프가 "최근 10시간"이 되도록)
      reversion: 0.08,        // 매 스텝 기준가(×1.0) 쪽으로 8% 회귀
      drift: 0.04,            // 매 스텝 ±4% 잔잔한 흔들림 (전 품목)
      shockChance: 0.12,      // 매 스텝, 품목마다 큰 충격이 올 확률
      shockMag: 0.30,         // 큰 충격 크기 ±30% (이유 없는 인플레/디플레)
      propagate: 0.5,         // 원료 변화가 소비 제품으로 전파되는 비율
      sibling: 0.3,           // 같은 생산라인 형제 자원 동조율
      chainDelaySteps: 2,     // 원료 변화가 제품에 전파되기까지 지연(스텝=시간). 예: 나무↑ → 2시간 뒤 판자↑
      siblingDelaySteps: 1,   // 형제 자원 동조 지연
      band: [0.5, 2.2],       // 기준가 대비 배수 하한·상한
      histLen: 10,            // 시세 그래프에 그릴 스텝 수(=최근 10시간)
      catchUpMax: 720,        // 접속 시 오프라인 최대 진행 스텝(≈30일)
    },

    // ── 매수/매도 스프레드 (시장 레벨 + 생산 tier에 따라 좋아진다) ──────
    // 매수가 = 기준가(변동 시세) × buy, 매도가 = 기준가 × sell.
    // 최악(worst) 1.10/0.90 에서 시작해 시장 레벨이 오르며 해당 tier가 최선(best) 1.05/0.95 로 개선된다.
    // windows[tab] = [시작렙, 최선도달렙]. tab 0=1차·1=2차·2=3차 (market.tabs 순서). 40렙이면 전부 최선.
    // (레벨당 판매가 +5% 같은 보너스는 없앰 — 레벨의 이득은 오직 "스프레드 개선"과 "거래 가능 품목 증가")
    spread: {
      worst: { buy: 1.10, sell: 0.90 },
      best:  { buy: 1.05, sell: 0.95 },
      windows: [[1, 15], [15, 30], [30, 40]],
    },
  },

  // ── 맵을 돌아다니는 NPC (앰비언트 — 저장 안 됨, 접속할 때마다 새로 생성) ──
  // base = 프레임 PNG 폴더. idle/walk/work = 그 폴더 안 파일명(확장자 빼고), 순서대로 재생.
  // speed = 걷기 속도(초당 타일). fps = 애니 속도. scale = 그림 크기(타일 폭 배율).
  // 두 종류: ① count 만 주면 빈 땅을 배회(king). ② building:"<키>" 면 그 건물마다 1명 붙어
  //   생산/판매 중이면 건물 앞에서 work 애니, 아니면 배회한다.
  npcs: {
    king: {
      base: "../assets/mini_humans/king",
      idle: ["r0c0", "r0c1", "r0c2", "r0c3"],
      walk: ["r1c0", "r1c1", "r1c2", "r1c3", "r1c4"],
      count: 1, speed: 1.3, fps: 6, scale: 1.4, idleMin: 1.5, idleMax: 5.0,
    },
    // 광산 — 소드맨
    sword: {
      base: "../assets/mini_humans/sword", building: "mine",
      idle: ["r0c0", "r0c1", "r0c2", "r0c3"],
      walk: ["r1c0", "r1c1", "r1c2", "r1c3", "r1c4", "r1c5"],
      work: ["r3c0", "r3c1", "r3c2", "r3c3", "r3c4", "r3c5"],
      speed: 1.4, fps: 7, scale: 1.4, idleMin: 1.5, idleMax: 5.0,
    },
    // 나무 제련소 — 스피어맨
    spear: {
      base: "../assets/mini_humans/spear", building: "lumbermill",
      idle: ["r0c0", "r0c1", "r0c2", "r0c3"],
      walk: ["r1c0", "r1c1", "r1c2", "r1c3", "r1c4", "r1c5"],
      work: ["r3c0", "r3c1", "r3c2", "r3c3", "r3c4", "r3c5", "r3c6"],
      speed: 1.4, fps: 7, scale: 1.4, idleMin: 1.5, idleMax: 5.0,
    },
    // 시장 — 프린스
    prince: {
      base: "../assets/mini_humans/prince", building: "market",
      idle: ["r0c0", "r0c1", "r0c2", "r0c3"],
      walk: ["r1c0", "r1c1", "r1c2", "r1c3", "r1c4", "r1c5"],
      work: ["r3c0", "r3c1", "r3c2", "r3c3", "r3c4", "r3c5"],
      speed: 1.4, fps: 7, scale: 1.4, idleMin: 1.5, idleMax: 5.0,
    },
    // 대장간 — 카발리에
    cavalier: {
      base: "../assets/mini_humans/cavalier", building: "blacksmith",
      idle: ["r0c0", "r0c1", "r0c2", "r0c3"],
      walk: ["r1c0", "r1c1", "r1c2", "r1c3", "r1c4", "r1c5"],
      work: ["r3c0", "r3c1", "r3c2"],
      speed: 1.4, fps: 7, scale: 1.4, idleMin: 1.5, idleMax: 5.0,
    },
    // 농장 — 말(horse)
    horse: {
      base: "../assets/mini_humans/horse", building: "watermill",
      idle: ["r0c0", "r0c1", "r0c2", "r0c3"],
      walk: ["r1c0", "r1c1", "r1c2", "r1c3", "r1c4", "r1c5"],
      work: ["r3c0", "r3c1", "r3c2"],
      speed: 1.5, fps: 7, scale: 1.5, idleMin: 1.5, idleMax: 5.0,
    },
    // 방앗간 — 궁수(archer)
    archer: {
      base: "../assets/mini_humans/archer", building: "windmill",
      idle: ["r0c0", "r0c1", "r0c2", "r0c3"],
      walk: ["r1c0", "r1c1", "r1c2", "r1c3", "r1c4", "r1c5"],
      work: ["r3c0", "r3c1", "r3c2", "r3c3", "r3c4", "r3c5", "r3c6", "r3c7", "r3c8", "r3c9", "r3c10"],
      speed: 1.4, fps: 8, scale: 1.4, idleMin: 1.5, idleMax: 5.0,
    },
    // 교회 — 마법사(mage)
    mage: {
      base: "../assets/mini_humans/mage", building: "church",
      idle: ["r0c0", "r0c1", "r0c2", "r0c3"],
      walk: ["r1c0", "r1c1", "r1c2", "r1c3", "r1c4", "r1c5"],
      work: ["r3c0", "r3c1", "r3c2", "r3c3", "r3c4", "r3c5", "r3c6", "r3c7", "r3c8", "r3c9", "r3c10"],
      speed: 1.3, fps: 8, scale: 1.4, idleMin: 1.5, idleMax: 5.0,
    },
  },

  // ── 배경음(BGM) ──────────────────────────────────────────
  // bgm = index.html 기준 상대경로의 오디오 파일. volume = 0~1. (옵션에서 켜기/끄기 가능, 기본 켜짐)
  // standalone(HTML 하나로 내보내기) 때는 이 파일이 base64로 함께 박힌다.
  audio: {
    bgm: "bgm/hearthfire_small.mp3",
    volume: 0.4,
  },

  // ── 저장 설정 ────────────────────────────────────────────
  save: {
    key: "estate_tycoon_v1",
    autosaveSec: 10,
    slots: 3,
  },

  // ★ 정렬 확인용 디버그: true 로 켜면 건물 발판(노란 테두리)·기준점(빨간 점)이 보인다.
  debug: { footprints: false },
};
