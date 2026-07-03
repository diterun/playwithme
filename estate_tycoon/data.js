// estate_tycoon — 밸런스·배치 SSOT (여기 숫자만 고치면 게임 전체에 반영된다)
//
// ★ 좌표 규칙:
//   맵은 map.w × map.h 칸. gx는 0 ~ map.w-1, gy는 0 ~ map.h-1.
//   건물 위치의 gx / gy 는 건물이 차지하는 구역의 "북쪽 꼭짓점(왼쪽 위)" 칸이다.
//   예) w:4,h:4 건물이 gx:8,gy:4 면 → gx 8~11, gy 4~7 을 차지한다.
//   dir 은 건물이 바라보는 방향 이미지: "SE" | "SW" | "NW" | "NE"
//   (SE·NW = 원래 폭(w)×깊이(h), SW·NE = 90도 회전이라 폭과 깊이가 서로 바뀐다)
//
// ★ 이미지 보정값 (건물 그림이 발판 칸과 안 맞을 때 만지는 4개):
//   imgScale : 그림 크기 배율. 1.0 = 발판 폭에 딱 맞춤
//   imgFoot  : 그림 바닥이 이미지 세로의 몇 % 지점인지. 키우면 그림이 아래로 내려간다
//   imgDX    : 그림을 좌우로 밀기(픽셀). +는 오른쪽, -는 왼쪽
//   imgDY    : 그림을 위아래로 밀기(픽셀). +는 아래, -는 위
//   → 맞추는 요령: 맨 아래 debug.footprints 를 true 로 켜면 노란 테두리(발판)와
//     빨간 점(기준 꼭짓점 gx,gy)이 맵에 보인다. 그걸 보면서 숫자를 맞춰라.
//
// ★ 방향(회전)마다 어긋남이 다를 때: 네 값 모두 숫자 대신 방향별 객체로 쓸 수 있다.
//   예) imgDX: { SE: 0, SW: -6, NW: 0, NE: 6 },  imgDY: { SE: 0, SW: 4, NW: 0, NE: 0 }
//   객체에서 빠진 방향은 조정 전 기본값(imgScale 1.5 / imgFoot 0.9 / imgDX·imgDY 0)으로
//   돌아가니, 방향별 객체로 갈 거면 네 방향을 전부 적어주는 게 안전하다.
//
// ★ 레벨업 비용 공식 (2단 곡선 — 10렙까지 쉽고 그 뒤 가파르게):
//   cost.base = 2레벨로 올리는 비용.
//   easyUntil(생략하면 10)레벨까지는 레벨마다 ×growth (완만),
//   그 뒤는 레벨마다 ×growthLate (가파름). growthLate 를 생략하면 계속 growth.
//   예) base {gold:200}, growth 1.25, growthLate 1.45
//       → 10렙 1,192골드 / 11렙 1,728골드 / 20렙 48,000골드쯤 / 30렙 200만골드쯤
//
// ★ 대기열(큐) 방식: 생산·판매는 칸이 나란히 도는 게 아니라 "줄을 선다".
//   맨 앞 하나만 진행되고, 끝나면 다음 것이 자동으로 시작된다.
//   queueUnlock = 대기열 칸이 열리는 건물 레벨 목록. 예) [1, 5, 15] = 1렙 1칸, 5렙 2칸, 15렙 3칸.
//
// ★ 타일 그림·건물 그림 교체는 assets.js 에서 한다 (여기는 크기·위치만).
"use strict";

const GAME_DATA = {
  version: 2,  // 저장 형식 버전 (구조가 바뀌면 올린다 — 옛 저장과 호환 안 됨)

  map: { w: 20, h: 40 },

  start: { gold: 300, wood: 0, stone: 0, plank: 0, furniture: 0, copper: 0, silver: 0, goldore: 0 },

  resources: {
    gold:      { name: "골드",   icon: "🪙" },
    wood:      { name: "나무",   icon: "🪵" },
    stone:     { name: "석재",   icon: "🪨" },
    plank:     { name: "판자",   icon: "🪚" },
    furniture: { name: "가구",   icon: "🪑" },
    copper:    { name: "동광석", icon: "🥉" },
    silver:    { name: "은광석", icon: "🥈" },
    goldore:   { name: "금광석", icon: "🥇" },
  },

  buildings: {
    castle: {
      name: "영주성", icon: "🏰",
      w: 4, h: 4, maxLevel: 30,
      img: "castle", imgScale: 1.3, imgFoot: 1, imgDX: 0, imgDY: 0,
      desc: "영지의 심장. 다른 모든 건물의 레벨 상한이 영주성 레벨이다.",
      cost: { base: { gold: 300, wood: 30 }, growth: 1.3, growthLate: 1.55 },
    },

    market: {
      name: "시장", icon: "🛒",
      w: 4, h: 3, maxLevel: 30,
      img: "market", imgScale: 1.05, imgFoot: 1,
      imgDX: { SE: 5, SW: 0, NW: 0, NE: 0 }, imgDY: { SE: 25, SW: 27, NW: 25, NE: 25 },
      desc: "자원을 골드로 판다. 판매 명령은 대기열에 줄을 서서 순서대로 팔린다.",
      queueUnlock: [1, 1, 5, 10, 20],  // 판매칸: 1렙 2칸, 5렙 3칸, 10렙 4칸, 20렙 5칸
      priceBonus: 0.05,                // 레벨당 판매가 +5%
      cost: { base: { gold: 200 }, growth: 1.25, growthLate: 1.45 },
    },

    lumbermill: {
      name: "나무 제련소", icon: "🪵",
      w: 3, h: 3, maxLevel: 30,
      img: "lumbermill", imgScale: 1.2, imgFoot: 1,
      imgDX: { SE: 0, SW: 10, NW: 0, NE: 0 }, imgDY: { SE: 10, SW: 10, NW: 3, NE: 8 },
      desc: "나무를 생산한다. 높은 레벨에서 판자·가구 가공이 열린다.",
      queueUnlock: [1, 5, 15],  // 생산칸: 1렙 1칸, 5렙 2칸, 15렙 3칸
      outBonus: 0.25,           // 레벨당 생산량 +25%
      // unlock = 이 레시피가 열리는 건물 레벨. in = 투입 자원(명령 시 바로 차감).
      recipes: [
        { name: "통나무 손질", time: 10,   out: { wood: 1 },      unlock: 1 },
        { name: "목재 다발",   time: 300,  out: { wood: 40 },     unlock: 1 },  // 5분
        { name: "대량 벌목",   time: 1200, out: { wood: 200 },    unlock: 1 },  // 20분
        { name: "판자 켜기",   time: 120,  in: { wood: 20 },  out: { plank: 5 },     unlock: 10 },
        { name: "가구 만들기", time: 600,  in: { plank: 10 }, out: { furniture: 1 }, unlock: 20 },
      ],
      cost: { base: { gold: 150, wood: 15 }, growth: 1.25, growthLate: 1.45 },
    },

    mine: {
      name: "광산", icon: "⛏️",
      w: 3, h: 3, maxLevel: 30,
      img: "mine", imgScale: 1.05, imgFoot: 1,
      imgDX: { SE: 7, SW: -5, NW: 7, NE: -5 }, imgDY: { SE: 15, SW: 15, NW: 17, NE: 20 },
      desc: "석재를 캔다. 높은 레벨에서 동·은·금광석이 열린다.",
      queueUnlock: [1, 5, 20],  // 생산칸: 1렙 1칸, 5렙 2칸, 20렙 3칸
      outBonus: 0.25,
      recipes: [
        { name: "돌 줍기",     time: 20,   out: { stone: 1 },    unlock: 1 },
        { name: "석재 채굴",   time: 600,  out: { stone: 35 },   unlock: 1 },   // 10분
        { name: "대규모 채굴", time: 3600, out: { stone: 250 },  unlock: 1 },   // 1시간
        { name: "동광석 채굴", time: 300,  out: { copper: 10 },  unlock: 15 },  // 5분
        { name: "은광석 채굴", time: 900,  out: { silver: 10 },  unlock: 25 },  // 15분
        { name: "금광석 채굴", time: 1800, out: { goldore: 10 }, unlock: 30 },  // 30분
      ],
      cost: { base: { gold: 180, wood: 20 }, growth: 1.25, growthLate: 1.45 },
    },

    house_small: {
      name: "작은 집", icon: "🏠",
      w: 2, h: 2, maxLevel: 10,
      img: "home_A", imgScale: 1.3, imgFoot: 0.95, imgDX: 0, imgDY: 0,
      desc: "주민이 세금을 낸다. 쌓인 골드는 💰 표시를 눌러 수거.",
      // rate = 초당 골드. rateBonus = 레벨당 +25%. capPerLevel = 저장 상한(×레벨).
      // showAt = 이만큼 쌓이면 💰 표시가 뜬다.
      house: { rate: 0.15, rateBonus: 0.25, capPerLevel: 200, showAt: 50 },
      cost: { base: { gold: 100 }, growth: 1.35 },
    },

    house_big: {
      name: "큰 집", icon: "🏡",
      w: 3, h: 3, maxLevel: 10,
      img: "home_B", imgScale: 1.2, imgFoot: 0.95, imgDX: 0, imgDY: 0,
      desc: "부유한 주민이 산다. 세금이 훨씬 많다.",
      house: { rate: 0.5, rateBonus: 0.25, capPerLevel: 800, showAt: 150 },
      cost: { base: { gold: 500 }, growth: 1.35 },
    },
  },

  // ── 게임 시작 시 배치돼 있는 건물들 ──────────────────────
  startBuildings: [
    { type: "castle",      gx: 8,  gy: 4,  dir: "SE" },
    { type: "market",      gx: 4,  gy: 14, dir: "SE" },
    { type: "lumbermill",  gx: 13, gy: 14, dir: "SW" },
    { type: "mine",        gx: 13, gy: 24, dir: "SW" },
    { type: "house_small", gx: 4,  gy: 20, dir: "SE" },
    { type: "house_small", gx: 7,  gy: 20, dir: "SE" },
  ],

  // ── 추가 건설 허가 (건설 탭) ─────────────────────────────
  // castle = 영주성이 이 레벨이 되면 목록에 열린다. 같은 종류는 위에서부터 순서대로 지어진다.
  extraBuilds: [
    { type: "house_small", castle: 2,  cost: { gold: 400 } },
    { type: "lumbermill",  castle: 5,  cost: { gold: 1500,  wood: 200 } },
    { type: "house_big",   castle: 6,  cost: { gold: 3000,  wood: 300 } },
    { type: "mine",        castle: 8,  cost: { gold: 3000,  stone: 300 } },
    { type: "house_small", castle: 10, cost: { gold: 5000 } },
    { type: "house_big",   castle: 12, cost: { gold: 12000, plank: 50 } },
    { type: "lumbermill",  castle: 15, cost: { gold: 20000, stone: 1000 } },
    { type: "mine",        castle: 20, cost: { gold: 40000, plank: 100 } },
  ],

  // 시장 판매 공식: 받는 골드 = 개수 × 단가 × (1 + priceBonus×(시장레벨-1))
  //                판매 시간(초) = sellBase + 받는 골드 × sellPerGold
  market: {
    prices: { wood: 2, stone: 3, plank: 12, furniture: 150, copper: 10, silver: 30, goldore: 80 },
    sellBase: 2,
    sellPerGold: 0.2,
  },

  save: {
    key: "estate_tycoon_v1",  // localStorage 키 접두어 (바꾸면 옛 저장을 못 읽는다)
    autosaveSec: 60,          // 자동저장 주기(초)
    slots: 3,                 // 수동 저장 슬롯 수
  },

  // ★ 정렬 확인용 디버그: true 로 바꾸면 건물 발판(노란 테두리)과
  //   기준 꼭짓점 gx,gy(빨간 점)가 맵 위에 표시된다. 그림 위치 맞출 때만 켜라.
  debug: { footprints: false },
};
