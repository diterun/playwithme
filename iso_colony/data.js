// iso_colony — 밸런스·콘텐츠·맵 데이터 (SSOT)
// 중세 영지 콜로니. 지금은 "촌락" 단계(§DESIGN.md 2). 다음 단계(마을·성읍·성채)는 이 표에 행을 추가해 확장한다.
// 수치·좌표 조정은 이 파일에서만. game.js는 이 표를 읽어 굴리고 그린다.
// 이미지(PNG) 연결은 이 파일이 아니라 assets.js에서 한다.
"use strict";

// 비용 스케일: Lv→Lv+1 비용 = base * growth^(level-1). 즉 Lv1→2 = base.
function scaleCost(base, growth, level) {
  const o = {};
  for (const k in base) o[k] = Math.round(base[k] * Math.pow(growth, Math.max(0, level - 1)));
  return o;
}

const GAME_DATA = {
  // ── 맵 크기 ──────────────────────────────────────────────
  // 정사각형 그리드 한 변의 칸 수. 아래 buildings/roads 좌표는 전부 이 크기를 전제로 배치했다.
  // 이 값을 늘리면 맵은 넓어지지만, 기존 좌표는 그대로 왼쪽 위 구석에 남아있게 된다(자동 재배치 안 됨).
  mapSize: 34,

  // ── 단계(성채 발전 단계) ──────────────────────────────────
  stage: {
    id: "village", name: "촌락", badge: "🏘️",
    stageMax: 5,                         // 이 단계에서 영주관(중앙 건물)의 최대 레벨
    next: "마을 (준비 중 · v4)",          // 다음 단계(아직 미구현)
  },

  start: {
    pop: 3,                              // 시작 일꾼 수
    stock: { wood: 40, stone: 25, meat: 25 },
    assign: { lumber: 1, quarry: 1, hunter: 1 },  // 시작 배정
  },

  // 식량: 일꾼이 "식사 중"일 때 초당 eatCost 만큼 소비. 바닥나면 포만감을 못 채우고,
  // 포만감 0(아사 상태)인 일꾼은 생산이 starveMult 배로 떨어진다.
  food: { id: "meat", eatCost: 0.5, starveMult: 0.4 },

  // ── 일꾼 기본 스탯 (v3 기초 — 가챠·등급은 v4) ──────────────
  // 모든 일꾼은 아래 기본값에 ±variance 만큼 개체차를 갖고 태어난다.
  worker: {
    stamina: 20,        // 최대 스태미나. 근무 1초 = 1 소모. 0이 되면 숙소로 휴식하러 감
    regen: 4,           // 휴식 중 초당 스태미나 회복량 (높을수록 금방 복귀)
    satietyMax: 100,    // 최대 포만감. 시간이 지나면 계속 줄어든다
    satietyDecay: 1.2,  // 초당 포만감 감소량
    eatSpeed: 12,       // 식사 중 초당 포만감 회복량 (식당 레벨 보너스가 곱해짐)
    eatThreshold: 0.3,  // 포만감이 이 비율(30%) 밑으로 떨어지면 식당으로 밥 먹으러 감
    variance: 0.2,      // 개체차: 각 스탯이 기본값의 ±20% 안에서 랜덤
  },

  // 상시 HUD에 띄울 자원(촌락 단계=3개)
  resources: [
    { id: "wood", name: "나무", icon: "🌲" },
    { id: "stone", name: "돌", icon: "🪨" },
    { id: "meat", name: "고기", icon: "🍖" },
  ],

  // 인구 성장: 식량 여유 있으면 일정 시간마다 +1 (상한까지)
  recruit: { time: 22, minMeat: 8 },

  // ══════════════════════════════════════════════════════════
  // ★ 건물 배치 — 여기 좌표를 고치면 맵의 건물·문 위치가 바뀐다.
  // ══════════════════════════════════════════════════════════
  // 각 건물 필드:
  //   tile : [gx, gy] — 건물 정사각형 구역의 "북쪽(위쪽) 꼭짓점" 칸. 여기서 오른쪽(+gx)·아래(+gy)로
  //          size×size 칸을 차지한다. 예) tile=[18,7], size=2 → (18,7)(19,7)(18,8)(19,8) 4칸을 건물이 덮음.
  //   size : 한 변의 칸 수(정사각형). 지금은 2(집·창고·사냥터) / 3(벌목장·채석장·전당·막사) / 4(영주관) 사용 중.
  //          숫자만 바꾸면 건물이 커지고 작아진다(그 칸들이 roads와 겹치지 않는지 직접 확인할 것).
  //   door : [gx, gy] — 건물 바로 앞, 일꾼이 드나드는 도로 칸. **반드시 roads 배열에도 같은 좌표가 있어야
  //          하고, 건물 구역(tile~tile+size-1)의 가장자리 칸과 정확히 한 칸 붙어 있어야 한다.**
  // kind: central(영주관) | pop(주거) | storage(창고) | prod(생산) | locked(아직 잠김)
  buildings: [
    { id: "manor", name: "영주관", icon: "🏰", kind: "central", tile: [11, 2], size: 4, door: [15, 2], startLevel: 1,
      desc: "영지의 중심. 이 레벨이 다른 모든 건물 레벨의 상한.",
      cost: (l) => scaleCost({ wood: 60, stone: 45, meat: 30 }, 1.8, l) },

    { id: "house", name: "숙소", icon: "🛖", kind: "pop", tile: [18, 7], size: 2, door: [17, 7], startLevel: 1,
      desc: "일꾼 수용 + 휴식(스태미나 회복) 시설. 인구 상한 = 4 + (레벨-1)×2.",
      popBase: 4, popPer: 2,
      cost: (l) => scaleCost({ wood: 25, stone: 10 }, 1.6, l) },

    { id: "store", name: "창고", icon: "📦", kind: "storage", tile: [13, 10], size: 2, door: [15, 10], startLevel: 1,
      desc: "자원 저장 한도 = 150 + (레벨-1)×120.",
      capBase: 150, capPer: 120,
      cost: (l) => scaleCost({ wood: 20, stone: 20 }, 1.6, l) },

    { id: "lumber", name: "벌목장", icon: "🪓", kind: "prod", produces: "wood", tool: "axe", tile: [18, 13], size: 3, door: [17, 13], startLevel: 1,
      desc: "나무 채집. 초당 = 0.5 × 레벨 × 배정 일꾼.",
      rate: 0.5, cost: (l) => scaleCost({ wood: 15, stone: 8 }, 1.55, l) },

    { id: "quarry", name: "채석장", icon: "⛏️", kind: "prod", produces: "stone", tool: "pick", tile: [12, 17], size: 3, door: [15, 17], startLevel: 1,
      desc: "돌 채집. 초당 = 0.4 × 레벨 × 배정 일꾼.",
      rate: 0.4, cost: (l) => scaleCost({ wood: 12, stone: 12 }, 1.55, l) },

    { id: "hunter", name: "사냥터", icon: "🏹", kind: "prod", produces: "meat", tool: "spear", tile: [18, 21], size: 2, door: [17, 21], startLevel: 1,
      desc: "고기(식량) 확보. 일꾼들이 식사 때 먹는다.",
      rate: 0.45, cost: (l) => scaleCost({ wood: 18, stone: 6 }, 1.55, l) },

    { id: "mess", name: "식당", icon: "🍲", kind: "service", tile: [12, 28], size: 3, door: [15, 28], startLevel: 1,
      desc: "식사 시설 — 포만감 회복. 레벨당 식사 속도 +10%.",
      eatBonus: 0.1,
      cost: (l) => scaleCost({ wood: 20, stone: 10, meat: 5 }, 1.6, l) },

    { id: "hall", name: "영웅의 전당", icon: "🏛️", kind: "locked", tile: [12, 24], size: 3, door: [15, 24], startLevel: 0,
      desc: "영웅 뽑기·주둔. (v3 예정)" },

    { id: "barracks", name: "원정 막사", icon: "⚔️", kind: "locked", tile: [18, 28], size: 3, door: [17, 28], startLevel: 0,
      desc: "스테이지 출정. (v3 예정)" },
  ],

  // ══════════════════════════════════════════════════════════
  // ★ 도로망 — 여기 좌표를 추가/삭제하면 도로가 늘어나거나 줄어든다.
  // ══════════════════════════════════════════════════════════
  // [gx, gy] 배열 하나하나가 "도로 칸" 하나. 일꾼은 이 칸들로만 이동한다(건물 문→문 최단경로, BFS).
  // 규칙:
  //   1) 이 배열에 없는 칸은 전부 잔디로 그려진다.
  //   2) 건물이 차지한 칸(위 tile~tile+size-1 범위)과 절대 겹치면 안 된다(겹치면 도로가 건물 밑에 가려짐).
  //   3) 모든 건물의 door 좌표는 반드시 이 배열 안에 있어야 한다(없으면 그 건물에 아무도 못 감).
   //   4) 새 도로 칸을 추가할 땐 기존 도로와 최소 한 변이 맞닿게 해야 길이 끊기지 않는다(대각선 연결 안 됨).
  // 지금 구조 = 세로 간선 하나(gx=16, gy 2~30) + 건물마다 지선 1칸(문 자체가 지선).
  // 새 건물을 추가하려면: 위 buildings에 항목 추가 → 그 건물의 door 좌표를 이 배열에도 추가 →
  //   간선(gx=16)과 떨어져 있으면 그 사이 칸들도 채워서 이어준다.
  roads: [
    // 세로 간선(영주관 앞~막사 앞까지 관통)
    [16, 2], [16, 3], [16, 4], [16, 5], [16, 6], [16, 7], [16, 8], [16, 9], [16, 10],
    [16, 11], [16, 12], [16, 13], [16, 14], [16, 15], [16, 16], [16, 17], [16, 18], [16, 19], [16, 20],
    [16, 21], [16, 22], [16, 23], [16, 24], [16, 25], [16, 26], [16, 27], [16, 28], [16, 29], [16, 30],
    // 건물별 지선(= 각 건물의 door 좌표, 위 buildings와 반드시 일치)
    [15, 2],   // manor
    [17, 7],   // house
    [15, 10],  // store
    [17, 13],  // lumber
    [15, 17],  // quarry
    [17, 21],  // hunter
    [15, 24],  // hall
    [15, 28],  // mess(식당)
    [17, 28],  // barracks
  ],
};

// id로 건물 정의 찾기
function bdef(id) { return GAME_DATA.buildings.find((b) => b.id === id); }
