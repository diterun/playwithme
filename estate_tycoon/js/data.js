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
"use strict";

const GAME_DATA = {
  version: 3,  // 저장 형식 버전 (구조가 바뀌면 올린다 — 옛 저장과 호환 안 됨)

  // ── 자원 정의 (표시용 이름·아이콘) ───────────────────────
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

  // ── 영지 개간 규칙 (땅 확장 비용·숲 그림) ─────────────────
  // 맵은 chunkSize×chunkSize(4×4) 청크로 나뉜다. 개방 안 된 청크는 빽빽한 숲이라 건물을 못 짓는다.
  // 내 땅과 붙어 있는 숲 청크를 맵에서 탭하면 골드를 내고 개간한다.
  // n번째 개간 비용 = cost.base × cost.growth^(n-1) 골드. (처음 열린 땅은 start.js openChunks)
  land: {
    chunkSize: 4,
    cost: { base: 400, growth: 1.35 },
    // 숲 그림: 잠긴 청크 하나에 2×2짜리 나무 뭉치 4개가 깔린다. 방향(_SE 등)은 자동으로 섞인다.
    treeImg: "../assets/deco/trees_A_large",
    treeScale: 1.4,   // 나무 그림 폭 배율 (1.0 = 2×2 발판 폭에 딱)
    treeFoot: 0.9,    // 그림 바닥 기준점 (건물 imgFoot과 동일한 의미)
  },

  // ── 건물 정의 ────────────────────────────────────────────
  // w×h = 발판 칸 크기, maxLevel = 레벨 상한(영주성 제외 전부 영주성 레벨에도 묶임),
  // cost = 레벨업 비용 곡선, recipes = 생산 레시피, house = 집 경제, queueUnlock = 대기열 칸.
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
      // unlock = 이 레시피가 열리는 건물 레벨. in = 투입 자원(명령 시 바로 차감). time = 초.
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

  // ── 추가 건설 허가 (건설 탭) ─────────────────────────────
  // castle = 영주성이 이 레벨이 되면 목록에 열린다. 같은 종류는 위에서부터 순서대로 지어진다.
  // (시작부터 놓여 있는 건물은 여기가 아니라 start.js buildings 에서 정한다)
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

  // ── 시장 판매 공식 ───────────────────────────────────────
  // 받는 골드 = 개수 × prices[자원] × (1 + 시장.priceBonus×(시장레벨-1))
  // 판매 시간(초) = sellBase + 받는 골드 × sellPerGold  (많이·비싸게 팔수록 오래)
  market: {
    prices: { wood: 2, stone: 3, plank: 12, furniture: 150, copper: 10, silver: 30, goldore: 80 },
    sellBase: 2,
    sellPerGold: 0.2,
  },

  // ── 맵을 돌아다니는 NPC (앰비언트 — 저장 안 됨, 접속할 때마다 새로 생성) ──
  // 건물이 아니라 그냥 빈 땅을 서성이는 캐릭터다. 가만히 서 있다가 이웃 칸으로 조금씩 옮겨다닌다.
  // base   = 프레임 PNG 폴더 (스프라이트시트를 잘라 넣은 곳).
  // idle/walk = 그 폴더 안 파일명(확장자 빼고). 순서대로 애니메이션으로 재생된다.
  // count  = 몇 명 돌아다니나. speed = 걷기 속도(초당 타일). fps = 애니 속도. scale = 그림 크기(타일 폭 배율).
  // idleMin/idleMax = 한 칸 이동 후 멈춰 쉬는 시간(초) 범위.
  // ★ 다른 캐릭터 추가: 스프라이트시트를 32px 칸으로 잘라 assets/mini_humans/<직업>/ 에 넣고 여기 항목 추가.
  npcs: {
    king: {
      base: "../assets/mini_humans/king",
      idle: ["r0c0", "r0c1", "r0c2", "r0c3"],
      walk: ["r1c0", "r1c1", "r1c2", "r1c3", "r1c4"],
      count: 1, speed: 1.3, fps: 6, scale: 1.4,
      idleMin: 1.5, idleMax: 5.0,
    },
  },

  // ── 저장 설정 ────────────────────────────────────────────
  save: {
    key: "estate_tycoon_v1",  // localStorage 키 접두어 (바꾸면 옛 저장을 못 읽는다)
    autosaveSec: 60,          // 자동저장 주기(초)
    slots: 3,                 // 수동 저장 슬롯 수
  },

  // ★ 정렬 확인용 디버그: true 로 바꾸면 건물 발판(노란 테두리)과
  //   기준 꼭짓점 gx,gy(빨간 점)가 맵 위에 표시된다. 그림 위치 맞출 때만 켜라.
  debug: { footprints: false },
};
