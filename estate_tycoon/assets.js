// estate_tycoon — 에셋 매니페스트
// ★ 여기에 이미지 경로만 채우면 게임에 바로 반영된다(고친 뒤 새로고침). 비워두면(null) 코드가 그린 기본 그림 사용.
// 경로는 이 폴더(estate_tycoon) 기준 상대경로. 예: "../assets/tile/grass.png"
"use strict";

var grass = "../assets/tile/grass.png"
var land = "../assets/tile/land.png"
var water = "../assets/tile/water.png"

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
