// iso_colony — 밸런스·콘텐츠 데이터 (SSOT)
// 시대별로 이 테이블에 행을 추가해 확장한다. 지금은 석기시대.
// 수치 조정은 여기서만. game.js는 이 표를 읽어 굴린다.
"use strict";

// 비용 스케일: Lv→Lv+1 비용 = base * growth^(level-1). 즉 Lv1→2 = base.
function scaleCost(base, growth, level) {
  const o = {};
  for (const k in base) o[k] = Math.round(base[k] * Math.pow(growth, Math.max(0, level - 1)));
  return o;
}

const GAME_DATA = {
  era: {
    id: "stone", name: "석기시대", badge: "🪨",
    centralMax: 5,                       // 이 시대 중앙건물 최대 레벨(다음 시대에서 확장)
    next: "청동기시대 (준비 중 · v4)",   // 시대 전환 대상(아직 미구현)
  },

  start: {
    pop: 3,                              // 시작 일꾼 수
    stock: { wood: 40, stone: 25, meat: 25 },
    assign: { lumber: 1, quarry: 1, hunter: 1 },  // 시작 배정
  },

  // 식량: 인구가 매초 소비. 떨어지면 채집 생산 감소(hungryMult).
  food: { id: "meat", perPop: 0.10, hungryMult: 0.4 },

  // 상시 HUD에 띄울 자원(석기=3개)
  resources: [
    { id: "wood", name: "나무", icon: "🌲" },
    { id: "stone", name: "돌", icon: "🪨" },
    { id: "meat", name: "고기", icon: "🍖" },
  ],

  // 인구 성장: 식량 여유 있으면 일정 시간마다 +1 (상한까지)
  recruit: { time: 22, minMeat: 8 },

  // 건물(석기). 각 타입 1개, 레벨업 방식. tile=아이소 배치 좌표.
  // kind: central | pop | storage | prod | locked
  buildings: [
    { id: "campfire", name: "화톳불", icon: "🔥", kind: "central", tile: [5, 5], startLevel: 1,
      desc: "문명의 중심. 이 레벨이 모든 건물 레벨의 상한.",
      cost: (l) => scaleCost({ wood: 60, stone: 45, meat: 30 }, 1.8, l) },

    { id: "house", name: "집", icon: "🛖", kind: "pop", tile: [3, 6], startLevel: 1,
      desc: "일꾼 수용. 인구 상한 = 4 + (레벨-1)×2.",
      popBase: 4, popPer: 2,
      cost: (l) => scaleCost({ wood: 25, stone: 10 }, 1.6, l) },

    { id: "store", name: "창고", icon: "📦", kind: "storage", tile: [8, 3], startLevel: 1,
      desc: "자원 저장 한도 = 150 + (레벨-1)×120.",
      capBase: 150, capPer: 120,
      cost: (l) => scaleCost({ wood: 20, stone: 20 }, 1.6, l) },

    { id: "lumber", name: "벌목장", icon: "🪓", kind: "prod", produces: "wood", tool: "axe", tile: [2, 8], startLevel: 1,
      desc: "나무 채집. 초당 = 0.5 × 레벨 × 배정 일꾼.",
      rate: 0.5, cost: (l) => scaleCost({ wood: 15, stone: 8 }, 1.55, l) },

    { id: "quarry", name: "채석장", icon: "⛏️", kind: "prod", produces: "stone", tool: "pick", tile: [10, 7], startLevel: 1,
      desc: "돌 채집. 초당 = 0.4 × 레벨 × 배정 일꾼.",
      rate: 0.4, cost: (l) => scaleCost({ wood: 12, stone: 12 }, 1.55, l) },

    { id: "hunter", name: "사냥터", icon: "🏹", kind: "prod", produces: "meat", tool: "spear", tile: [9, 9], startLevel: 1,
      desc: "고기(식량) 확보. 인구가 매초 먹는다.",
      rate: 0.45, cost: (l) => scaleCost({ wood: 18, stone: 6 }, 1.55, l) },

    { id: "hall", name: "영웅의 전당", icon: "🏛️", kind: "locked", tile: [6, 2], startLevel: 0,
      desc: "영웅 뽑기·주둔. (v3 예정)" },

    { id: "barracks", name: "원정 막사", icon: "⚔️", kind: "locked", tile: [3, 3], startLevel: 0,
      desc: "스테이지 출정. (v3 예정)" },
  ],
};

// id로 건물 정의 찾기
function bdef(id) { return GAME_DATA.buildings.find((b) => b.id === id); }
