// estate_tycoon — 시작 상태 세팅 (★ 여기 값을 바꾸면 "새 게임"의 초기 상태가 바뀐다)
//
// 이 파일은 게임을 처음 시작하거나 [초기화]했을 때의 상태만 정한다.
//   - 맵 크기, 시작 보유 자원, 처음 열려 있는 땅, 미리 놓여 있는 건물
// 밸런스(레벨업 비용·생산량·해금 레벨·판매가 등)는 data.js 에서 고친다.
//
// ★ 좌표 규칙 (data.js 와 동일):
//   gx는 0 ~ map.w-1, gy는 0 ~ map.h-1.
//   건물의 gx/gy = 건물이 차지하는 구역의 "북쪽 꼭짓점(왼쪽 위)" 칸.
//   dir = 바라보는 방향: "SE" | "SW" | "NW" | "NE"
"use strict";

const START = {
  // 맵 크기(칸). 바꾸면 개간 청크 격자도 자동으로 맞춰진다.
  map: { w: 40, h: 40 },

  // 게임 시작 시 보유 자원. (없는 자원은 0으로 둬도 되고 빼도 된다)
  resources: { gold: 300, wood: 0, stone: 0, plank: 0, furniture: 0, copper: 0, silver: 0, goldore: 0 },

  // 시작할 때 열려 있는(개간된) 4×4 청크 목록. 청크 좌표 = 타일좌표 ÷ 4.
  // 아래는 북쪽 구석 4×4 청크 = 타일 (0,0)~(15,15)의 16×16 영역.
  // 나머지 청크는 빽빽한 숲이라 골드를 내고 개간해야 쓸 수 있다.
  openChunks: [
    [0, 0], [1, 0], [2, 0], [3, 0],
    [0, 1], [1, 1], [2, 1], [3, 1],
    [0, 2], [1, 2], [2, 2], [3, 2],
    [0, 3], [1, 3], [2, 3], [3, 3],
  ],

  // 시작할 때 이미 배치돼 있는 건물들 (위 openChunks 영역 안에 둘 것).
  // type 은 data.js buildings 의 키. 새 건물 종류를 data.js 에 추가하면 여기서도 쓸 수 있다.
  buildings: [
    { type: "castle",      gx: 1,  gy: 1,  dir: "SE" },
    { type: "market",      gx: 6,  gy: 3,  dir: "SE" },
    { type: "mine",        gx: 11, gy: 0,  dir: "SE" },
    { type: "lumbermill",  gx: 0,  gy: 12, dir: "SW" },
    { type: "house_small", gx: 0,  gy: 6,  dir: "SW" },
    { type: "house_small", gx: 0,  gy: 9,  dir: "SW" },
  ],

  // 시작할 때 이미 칠해져 있는 지형. "gx,gy": "water"(물) | "road"(도로).
  // 게임 편집 모드에서 칠한 걸 그대로 내보낸 것. 기본 잔디는 여기 없으면 된다.
  // (물은 건물 배치 금지, 도로는 배치 가능. 오토타일이 이웃을 보고 자동으로 이어 그린다)
  tiles: {
    // 물
    "0,0": "water", "0,1": "water", "0,2": "water", "0,3": "water", "0,4": "water", "0,5": "water",
    "1,0": "water", "2,0": "water", "3,0": "water", "4,0": "water", "5,0": "water",
    "5,1": "water", "5,2": "water", "5,3": "water", "5,4": "water", "5,5": "water", "1,5": "water",
    "4,5": "water", "3,7": "water", "4,7": "water", "5,7": "water",
    "3,8": "water", "3,9": "water", "3,10": "water",
    "4,10": "water", "5,10": "water", "6,10": "water", "6,9": "water", "6,8": "water", "6,7": "water",
    "8,9": "water", "9,9": "water", "10,9": "water", "8,10": "water", "9,10": "water", "10,10": "water",
    "10,11": "water", "11,11": "water", "12,11": "water", "13,11": "water",
    "11,10": "water", "12,10": "water", "13,10": "water",
    "13,12": "water", "14,12": "water", "14,11": "water",
    // 도로
    "2,5": "road", "3,5": "road", "2,6": "road", "2,7": "road", "2,8": "road", "2,9": "road",
    "2,10": "road", "2,11": "road", "3,6": "road", "3,11": "road", "3,12": "road", "3,13": "road",
    "4,6": "road", "5,6": "road", "6,6": "road", "7,6": "road", "8,6": "road", "9,6": "road",
    "10,6": "road", "11,6": "road", "12,6": "road", "12,3": "road", "12,4": "road", "12,5": "road",
    "4,11": "road", "5,11": "road", "6,11": "road", "7,11": "road",
    "7,7": "road", "7,8": "road", "7,9": "road", "7,10": "road",
  },
};
