// iso_colony — 에셋 매니페스트
// ★여기에 이미지 경로만 채워 넣으면 게임에 바로 반영된다(새로고침만 하면 됨).
// 경로가 null이거나 파일을 못 찾으면 game.js의 절차적(코드로 그린) 도형이 자동으로 대신 그려진다 —
// 즉 언제든 비워둔 채로 실행해도 안전하다. 이미지 파일은 이 폴더(iso_colony) 기준 상대경로로 적는다.
// 예) "assets/buildings/manor.png" 라고 적으면 iso_colony/assets/buildings/manor.png 를 읽는다.
"use strict";

const ASSET_MAP = {
  // ── 건물 이미지 ──────────────────────────────────────────
  // data.js의 건물 id 하나당 이미지 하나. 건물은 정사각형 구역(size×size 칸) 전체에 걸쳐 그려지며,
  // 이미지의 "가로 폭 중앙 아래쪽 끝"이 그 구역의 남쪽(앞쪽) 꼭짓점에 맞춰진다(발밑에 서는 느낌).
  // 세로로 긴 이미지도 문제없음 — 위로 자연스럽게 솟아오르게 그려진다.
  buildings: {
    manor: null,      // 예: "assets/buildings/manor.png"      (영주관, 4x4)
    house: null,      // 예: "assets/buildings/house.png"      (오두막, 2x2)
    store: null,      // 예: "assets/buildings/store.png"      (창고, 2x2)
    lumber: null,     // 예: "assets/buildings/lumber.png"     (벌목장, 3x3)
    quarry: null,     // 예: "assets/buildings/quarry.png"     (채석장, 3x3)
    hunter: null,     // 예: "assets/buildings/hunter.png"     (사냥터, 2x2)
    mess: null,       // 예: "assets/buildings/mess.png"       (식당, 3x3) — KayKit tavern 렌더 후보
    hall: null,       // 예: "assets/buildings/hall.png"       (영웅의 전당, 3x3) — 잠김 상태에도 이 그림 위에 자물쇠가 얹힘
    barracks: null,   // 예: "assets/buildings/barracks.png"   (원정 막사, 3x3) — 위와 동일
  },

  // ── 지형 타일 이미지 ─────────────────────────────────────
  // grassDefault / roadDefault : 맵 전체 기본값. 비워두면 코드가 그리는 얼룩무늬 잔디·황토색 도로 사용.
  // overrides : 특정 칸(gx,gy) 하나만 다른 그림으로 바꾸고 싶을 때. "gx,gy" 문자열 키로 추가한다.
  //             예) "5,5": "assets/tiles/special_rock.png"  → (5,5) 칸만 이 그림으로 덮어씀.
  //             도로 칸이든 잔디 칸이든 상관없이 적용된다(가장 먼저 확인함).
  ground: {
    grassDefault: null,   // 예: "assets/tiles/grass.png"
    roadDefault: null,    // 예: "assets/tiles/road.png"
    overrides: {
      // "16,2": "assets/tiles/gate.png",
    },
  },
};
