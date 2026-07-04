// estate_tycoon — 에셋 매니페스트
// ★ 여기에 이미지 경로만 채우면 게임에 바로 반영된다(고친 뒤 새로고침). 비워두면(null) 코드가 그린 기본 그림 사용.
// 경로는 이 폴더(estate_tycoon) 기준 상대경로. 예: "../assets/tile/grass.png"
"use strict";

var grass = "../assets/tile/grass.png"
var land = "../assets/tile/land_auto/land_o15.png"  // 폴백용(도로 오토타일 끌 때만 사용)
var water = "../assets/tile/water_auto/water_o15.png"  // 폴백용(오토타일 끌 때만 사용)

const ASSET_MAP = {
  // ── 건물 이미지 교체 ─────────────────────────────────────
  // null           = 기본값 사용: ../assets/building/<건물이미지>_<방향>.png (지금 쓰는 렌더 PNG)
  // "경로/접두어"   = 방향이 자동으로 붙는다: "../assets/building2/castle" → castle_SE.png, castle_SW.png ...
  // 방향별 객체     = 방향마다 다른 파일: { SE: "a.png", SW: "b.png", NW: "c.png", NE: "d.png" }
  buildings: {
    castle: null,
    market: null,
    lumbermill: null,
    mine: null,
  },

  // ── 효과 이미지 ──────────────────────────────────────────
  // coin : 집 위에 도는 금화 애니메이션 프레임(배열, 순서대로 재생).
  //        null이면 기본(../assets/fx/coin_0.png ~ coin_11.png 12장) 사용.
  fx: {
    coin: null,  // 예: ["my/coin_a.png", "my/coin_b.png", ...]
  },

  // ── 지형 타일 (바닥만: 풀·땅·물·물가·도로) ────────────────
  // 나무·돌 같은 자연물은 바닥이 아니다 — 아래 features(지형지물)에 넣는다.
  //
  // grassDefault : 모든 칸의 기본 타일. null이면 코드가 그리는 얼룩 잔디.
  // tileAnchor : "top"    = 그림의 "윗면"을 칸에 맞춤 — 두께 있는 블록 타일(지금 grass/land/water)용.
  //              "bottom" = 그림 맨 아래를 칸의 남쪽 꼭짓점에 맞춤 — 두께 없는 평면 타일용.
  // tileScale  : 타일 그림 폭 배율. 1.0 = 칸 폭(64px)에 딱.
  // tileFoot   : "bottom" 모드에서만. 그림 바닥 기준점(1.0 = 맨 아래).
  ground: {
    grassDefault: grass,
    // 편집 모드 지형 브러시가 쓰는 그림: 🌿 땅 = grassDefault, 🛣️ 도로 = roadDefault, 🌊 물 = waterDefault
    roadDefault: land,
    waterDefault: water,
    // ── 물 오토타일 연결표 ──────────────────────────────────
    // 물을 칠하면 "어느 방향에 물이 이어지는가"를 보고 아래 표에서 그림을 고른다.
    // ★ 연결이 어긋나 보이면 이 표의 파일명을 서로 바꿔가며 직접 맞춰라 (새로고침으로 확인).
    // 방향 비트: NE(오른쪽 위)=1, SE(오른쪽 아래)=2, SW(왼쪽 아래)=4, NW(왼쪽 위)=8
    // 번호 = 물이 이어진 방향 비트의 합. 예) 5 = NE(1)+SW(4) = 대각선 방향 직선 수로.
    // waterAuto 전체를 null로 바꾸면 waterDefault 한 장 + waterSink 방식으로 돌아간다.
    waterAuto: {
      base: "../assets/tile/water_auto",  // 그림 폴더
      tiles: {
        0:  "water_o0.png",   // 이어진 물 없음 → 1칸 웅덩이(사방 잔디)
        1:  "water_o1.png",   // NE만
        2:  "water_o2.png",   // SE만
        3:  "water_o3.png",   // NE+SE (꺾임)
        4:  "water_o4.png",   // SW만
        5:  "water_o5.png",   // NE+SW (직선)
        6:  "water_o6.png",   // SE+SW (꺾임)
        7:  "water_o7.png",   // NE+SE+SW (NW만 잔디)
        8:  "water_o8.png",   // NW만
        9:  "water_o9.png",   // NE+NW (꺾임)
        10: "water_o10.png",  // SE+NW (직선)
        11: "water_o11.png",  // NE+SE+NW (SW만 잔디)
        12: "water_o12.png",  // SW+NW (꺾임)
        13: "water_o13.png",  // NE+SW+NW (SE만 잔디)
        14: "water_o14.png",  // SE+SW+NW (NE만 잔디)
        15: "water_o15.png",  // 사방 물 (호수 한가운데)
      },
      // 오목 모서리 조각(물 칸 위에 덧그리는 잔디 귀퉁이). N=위, E=오른쪽, S=아래, W=왼쪽 꼭짓점.
      // 조건: 그 꼭짓점의 양쪽 변이 다 물인데 대각선 칸은 물이 아닐 때.
      nibs: { N: "water_nib_N.png", E: "water_nib_E.png", S: "water_nib_S.png", W: "water_nib_W.png" },
    },
    // ── 도로 오토타일 연결표 ────────────────────────────────
    // 물과 같은 규칙 — 번호 = 도로가 이어진 방향 비트의 합 (NE=1, SE=2, SW=4, NW=8).
    // 모서리 조합 파일(land_o변_c모서리.png)은 파일명 규칙으로 자동 탐색된다.
    // landAuto 전체를 null로 바꾸면 roadDefault 한 장 방식으로 돌아간다.
    landAuto: {
      base: "../assets/tile/land_auto",  // 그림 폴더
      tiles: {
        0:  "land_o0.png",   // 이어진 도로 없음 → 흙 마당 한 칸
        1:  "land_o1.png",   // NE만
        2:  "land_o2.png",   // SE만
        3:  "land_o3.png",   // NE+SE (꺾임)
        4:  "land_o4.png",   // SW만
        5:  "land_o5.png",   // NE+SW (직선)
        6:  "land_o6.png",   // SE+SW (꺾임)
        7:  "land_o7.png",   // NE+SE+SW (NW만 잔디)
        8:  "land_o8.png",   // NW만
        9:  "land_o9.png",   // NE+NW (꺾임)
        10: "land_o10.png",  // SE+NW (직선)
        11: "land_o11.png",  // NE+SE+NW (SW만 잔디)
        12: "land_o12.png",  // SW+NW (꺾임)
        13: "land_o13.png",  // NE+SW+NW (SE만 잔디)
        14: "land_o14.png",  // SE+SW+NW (NE만 잔디)
        15: "land_o15.png",  // 사방 도로 (광장 한가운데)
      },
      nibs: { N: "land_nib_N.png", E: "land_nib_E.png", S: "land_nib_S.png", W: "land_nib_W.png" },
    },
    // (waterAuto가 null일 때만) 물을 몇 픽셀 아래로 가라앉혀 그릴지.
    waterSink: 10,
    tileAnchor: "top",
    tileScale: 1.0,
    tileFoot: 1.0,
    overrides: {
      // "gx,gy": 경로                        → 그 칸 바닥 교체 (건물 배치 가능. 땅·도로용)
      // "gx,gy": { img: 경로, block: true }  → 건물 못 놓는 바닥 (물용)
      // 칸별로 그리기 설정을 다르게: { img: 경로, scale: 1.1, anchor: "bottom", foot: 1.0 }
      // 예)
      // "2,11": { img: water, block: true },
      // "6,20": land,
    },
  },

  // ── 지형지물 (나무·돌·수풀 같은 자연물) ───────────────────
  // 타일 "위에" 얹혀서, 건물과 함께 깊이 정렬되어 그려진다(남쪽 지형지물이 건물을 가릴 수 있음).
  //
  // "gx,gy": 경로  또는  "gx,gy": { img: 경로, scale: 1.0, foot: 1.0, dx: 0, dy: 0, block: true }
  //   block : 기본값 true — 그 칸에 건물 배치 금지. 순수 장식(위에 지어도 됨)이면 block: false.
  //   scale : 그림 폭 배율 (1.0 = 칸 폭 64px. 큰 나무는 1.3~2.0)
  //   foot  : 그림 바닥 기준점 (1.0 = 그림 맨 아래가 칸의 남쪽 꼭짓점)
  //   dx/dy : 픽셀 단위 밀기 (+x 오른쪽, +y 아래)
  //
  // ★ 같은 설정 재사용 요령: 파일 위에 var tree = { img: "../assets/feature/tree.png", scale: 1.4 }
  //   라고 만들어두고 → "3,4": tree, "5,6": tree, "7,8": tree 처럼 여러 칸에 쓴다.
  features: {
    // "7,20": { img: "../assets/feature/tree.png", scale: 1.4 },
    // "8,22": { img: "../assets/feature/rock.png" },
  },
};
