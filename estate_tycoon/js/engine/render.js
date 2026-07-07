// estate_tycoon — 그리기 (바닥 프리렌더 + 건물·지형지물·유령·발판 렌더)
"use strict";

/* ═══════════════ 지형 (오프스크린 프리렌더) ═══════════════ */
function hash2(x, y) {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = (h ^ (h >> 13)) * 1274126177 | 0;
  return ((h ^ (h >> 16)) >>> 0) / 4294967296;
}
const GPAD = 24, GSCALE = 1.5;
const G_X0 = -MAP_H * TILE_W / 2 - GPAD;
const G_Y0 = -GPAD;
const G_W = (MAP_W + MAP_H) * TILE_W / 2 + GPAD * 2;
const G_H = (MAP_W + MAP_H) * TILE_H / 2 + GPAD * 2;
let groundCanvas = null;

function buildGround() {
  if (typeof document.createElement !== "function") return;
  const gc = document.createElement("canvas");
  gc.width = Math.round(G_W * GSCALE); gc.height = Math.round(G_H * GSCALE);
  const g = gc.getContext("2d");
  if (!g) return;
  g.setTransform(GSCALE, 0, 0, GSCALE, -G_X0 * GSCALE, -G_Y0 * GSCALE);
  const cols = ["#4c7a3f", "#527f43", "#478040", "#4a7d45"];
  const gset = ASSET_MAP.ground || {};
  const tsc = gset.tileScale || 1.0;
  const tft = gset.tileFoot != null ? gset.tileFoot : 1.0;
  const tanchor = gset.tileAnchor || "bottom";
  for (let gy = 0; gy < MAP_H; gy++) {
    for (let gx = 0; gx < MAP_W; gx++) {
      const cx = isoX(gx, gy), cy = isoY(gx, gy);
      // 우선순위: 플레이어가 칠한 지형 → assets.js 칸별 override → 기본 잔디 → 절차적
      const painted = state.tiles[gx + "," + gy];
      // 오토타일(물·도로): 이웃을 보고 연결표(assets.js waterAuto/landAuto.tiles)에서 그림을 고른다 (+오목 모서리 조각)
      const acfg = painted && AUTO_KEY[painted] ? autoCfg(painted) : null;
      if (acfg) {
        const m = autoMaskAt(painted, gx, gy);
        const cm = autoCornerMaskAt(painted, gx, gy);
        const tw = TILE_W * tsc;
        // 1순위: 모서리 조합까지 구워진 파일 ({접두어}_o{변}_c{모서리}.png)
        const comp = cm ? getImg(autoCompositeFile(acfg, m, cm)) : null;
        if (imgOK(comp)) {
          g.drawImage(comp, cx - tw / 2, cy, tw, tw * (comp.naturalHeight / comp.naturalWidth));
          continue;
        }
        // 2순위: 기본 타일 + 오목 조각 실시간 겹치기
        const base = getImg(autoTileFile(acfg, m));
        if (imgOK(base)) {
          g.drawImage(base, cx - tw / 2, cy, tw, tw * (base.naturalHeight / base.naturalWidth));
          for (let i = 0; i < AUTO_NIBS.length; i++) {
            if (cm & (1 << i)) {
              const nib = getImg(autoNibFile(acfg, AUTO_NIBS[i][0]));
              if (imgOK(nib)) g.drawImage(nib, cx - tw / 2, cy, tw, tw * (nib.naturalHeight / nib.naturalWidth));
            }
          }
          continue;
        }
      }
      const ov = painted ? null : groundOverrideAt(gx, gy);
      const url = painted ? paintTileURL(painted) : groundTileURL(gx, gy);
      const timg = getImg(url);
      if (imgOK(timg)) {
        const sc = (ov && ov.scale) || tsc;
        const anchor = (ov && ov.anchor) || tanchor;
        const ft = (ov && ov.foot != null) ? ov.foot : tft;
        const tw = TILE_W * sc;
        const th = tw * (timg.naturalHeight / timg.naturalWidth);
        let ty = anchor === "top" ? cy : cy + TILE_H - th * ft;
        // 물은 아래로 가라앉혀 그린다 — 북쪽 이웃의 흙벽이 드러나 웅덩이처럼 보임
        if (painted === "water") ty += gset.waterSink != null ? gset.waterSink : 10;
        g.drawImage(timg, cx - tw / 2, ty, tw, th);
        continue;
      }
      if (painted) {
        // 그림이 아직 안 실렸으면 색으로 표시
        const sink = painted === "water" ? (gset.waterSink != null ? gset.waterSink : 10) : 0;
        g.fillStyle = painted === "water" ? "#3f6fae" : "#b99a6c";
        g.beginPath();
        g.moveTo(cx, cy + sink);
        g.lineTo(cx + TILE_W / 2, cy + TILE_H / 2 + sink);
        g.lineTo(cx, cy + TILE_H + sink);
        g.lineTo(cx - TILE_W / 2, cy + TILE_H / 2 + sink);
        g.closePath();
        g.fill();
        continue;
      }
      g.fillStyle = cols[Math.floor(hash2(gx, gy) * cols.length)];
      g.beginPath();
      g.moveTo(cx, cy);
      g.lineTo(cx + TILE_W / 2, cy + TILE_H / 2);
      g.lineTo(cx, cy + TILE_H);
      g.lineTo(cx - TILE_W / 2, cy + TILE_H / 2);
      g.closePath();
      g.fill();
      if (hash2(gx * 7 + 3, gy * 5 + 1) > 0.72) {
        const tx = cx + (hash2(gx, gy * 3) - 0.5) * 30;
        const ty2 = cy + TILE_H / 2 + (hash2(gx * 2, gy) - 0.5) * 10;
        g.strokeStyle = "#3a6631"; g.lineWidth = 1.2;
        g.beginPath();
        g.moveTo(tx - 2, ty2 + 3); g.lineTo(tx - 3, ty2 - 3);
        g.moveTo(tx, ty2 + 3); g.lineTo(tx, ty2 - 4);
        g.moveTo(tx + 2, ty2 + 3); g.lineTo(tx + 3, ty2 - 3);
        g.stroke();
      }
    }
  }
  g.strokeStyle = "rgba(255,255,255,0.25)"; g.lineWidth = 2;
  g.beginPath();
  g.moveTo(isoX(0, 0), isoY(0, 0));
  g.lineTo(isoX(MAP_W, 0), isoY(MAP_W, 0));
  g.lineTo(isoX(MAP_W, MAP_H), isoY(MAP_W, MAP_H));
  g.lineTo(isoX(0, MAP_H), isoY(0, MAP_H));
  g.closePath();
  g.stroke();
  groundCanvas = gc;
}

/* ═══════════════ 그리기 조각 ═══════════════ */
function footDiamond(g, gx, gy, fw, fh) {
  g.beginPath();
  g.moveTo(isoX(gx, gy), isoY(gx, gy));
  g.lineTo(isoX(gx + fw, gy), isoY(gx + fw, gy));
  g.lineTo(isoX(gx + fw, gy + fh), isoY(gx + fw, gy + fh));
  g.lineTo(isoX(gx, gy + fh), isoY(gx, gy + fh));
  g.closePath();
}
function dirVal(v, dir, def) {
  if (v == null) return def;
  if (typeof v === "object") return v[dir] != null ? v[dir] : def;
  return v;
}
function spriteRect(type, gx, gy, dir) {
  const d = bdef(type);
  const f = footDims(type, dir);
  const isoW = (f.w + f.h) * TILE_W / 2;
  const tw = isoW * dirVal(d.imgScale, dir, 1.5);
  const th = tw; // 렌더 PNG는 정사각형
  const cx = (isoX(gx + f.w, gy) + isoX(gx, gy + f.h)) / 2;
  const footY = isoY(gx + f.w, gy + f.h);
  return {
    x: cx - tw / 2 + dirVal(d.imgDX, dir, 0),
    y: footY - th * dirVal(d.imgFoot, dir, 0.9) + dirVal(d.imgDY, dir, 0),
    w: tw, h: th, cx, footY, f,
  };
}
// 터치(탭) 판정용 사각형 — 그림 크기(spriteRect)와 별개로 조절한다.
//   hitScale(=hitScaleX·hitScaleY 기본값) : 그림 박스 대비 터치 박스 비율(1=그림 그대로, 0.6=60%로 축소)
//   hitDX / hitDY : 터치 박스를 픽셀 단위로 옮기기(건물 몸통 쪽으로). 방향별 객체도 가능(imgDX와 동일 규칙).
// ★ 그림은 그대로 두고 "잡히는 면적"만 바뀐다. 발판(바닥 칸) 탭은 이 값과 무관하게 항상 잡힌다.
function hitRect(type, gx, gy, dir) {
  const d = bdef(type);
  const r = spriteRect(type, gx, gy, dir);
  const hs = dirVal(d.hitScale, dir, 1);
  const w = r.w * dirVal(d.hitScaleX, dir, hs);
  const h = r.h * dirVal(d.hitScaleY, dir, hs);
  const cx = r.x + r.w / 2 + dirVal(d.hitDX, dir, 0);      // 가로 중앙
  const bottom = r.y + r.h + dirVal(d.hitDY, dir, 0);      // 그림 박스 바닥 기준(건물이 바닥에 앉으므로)
  return { x: cx - w / 2, y: bottom - h, w, h };            // hitScale 줄이면 아래쪽(몸통)만 남는다
}
function drawB(g, type, gx, gy, dir, alpha, invalid, imgUrl) {
  const d = bdef(type);
  const r = spriteRect(type, gx, gy, dir);
  g.globalAlpha = alpha;
  if (invalid !== undefined) {
    // 이동 중인 유령: 발판 색칠 + debug식 테두리·기준점
    g.fillStyle = invalid ? "rgba(220,60,60,0.4)" : "rgba(80,220,110,0.35)";
    footDiamond(g, gx, gy, r.f.w, r.f.h);
    g.fill();
    g.strokeStyle = "#ffe14d"; g.lineWidth = 2 / cam.s;
    footDiamond(g, gx, gy, r.f.w, r.f.h);
    g.stroke();
    g.fillStyle = "#ff5d5d";
    g.beginPath();
    g.arc(isoX(gx, gy), isoY(gx, gy), 4 / cam.s, 0, Math.PI * 2);
    g.fill();
  }
  const img = getImg(imgUrl || buildingImgURL(type, dir));
  if (imgOK(img)) {
    g.drawImage(img, r.x, r.y, r.w, r.h);
  } else {
    g.fillStyle = "rgba(90,80,60,0.85)";
    footDiamond(g, gx, gy, r.f.w, r.f.h);
    g.fill();
    g.fillStyle = "#fff";
    g.font = "28px sans-serif"; g.textAlign = "center"; g.textBaseline = "middle";
    g.fillText(d.icon, r.cx, r.footY - (r.f.w + r.f.h) * TILE_H / 4);
  }
  g.globalAlpha = 1;
}
// 잠긴 청크의 숲: 4×4 청크 하나에 2×2 나무 뭉치 4개 (방향은 칸 해시로 섞음)
function drawTreeQuad(g, qx, qy) {
  const di = Math.floor(hash2(qx * 3 + 7, qy * 5 + 11) * 4);
  const img = getImg(GAME_DATA.land.treeImg + "_" + DIRS[di] + ".png");
  const cx = (isoX(qx + 2, qy) + isoX(qx, qy + 2)) / 2;
  const footY = isoY(qx + 2, qy + 2);
  if (imgOK(img)) {
    const tw = 2 * TILE_W * (GAME_DATA.land.treeScale || 1.4);
    g.drawImage(img, cx - tw / 2, footY - tw * (GAME_DATA.land.treeFoot || 0.9), tw, tw);
  } else {
    g.fillStyle = "rgba(38,84,46,0.9)";
    footDiamond(g, qx, qy, 2, 2);
    g.fill();
  }
}

function drawFeature(g, ft) {
  const img = ft.img ? getImg(ft.img) : null;
  const cx = isoX(ft.gx, ft.gy);
  const by = isoY(ft.gx, ft.gy) + TILE_H;
  if (imgOK(img)) {
    const tw = TILE_W * ft.scale;
    const th = tw * (img.naturalHeight / img.naturalWidth);
    g.drawImage(img, cx - tw / 2 + ft.dx, by - th * ft.foot + ft.dy, tw, th);
  } else if (ft.img) {
    g.fillStyle = "rgba(60,90,50,0.6)";
    footDiamond(g, ft.gx, ft.gy, 1, 1);
    g.fill();
  }
}

// 집 위 💰 표시 위치 (그리기·탭 판정 공용, 월드 좌표)
function houseIconPos(b) {
  const r = spriteRect(b.type, b.gx, b.gy, b.dir);
  return { x: r.x + r.w / 2, y: r.y + r.h * 0.12 };
}
function houseIconVisible(b) {
  return isHouse(b.type) && b.accum >= bdef(b.type).house.showAt;
}

// 신축(공사판) 건물이 지금 보여줄 그림: 진행도에 따라 stage_A → stage_B → 완성 건물
function constructStageURL(b) {
  const job = (typeof constructionJobFor === "function") ? constructionJobFor(b.iid) : null;
  let pct = 0;
  if (job && job.end != null) pct = 1 - (job.end - Date.now()) / 1000 / job.dur;
  if (pct < 1 / 3) return stageImgURL("stage_A", b.dir);   // 초반: 기초 공사
  if (pct < 2 / 3) return stageImgURL("stage_B", b.dir);   // 중반: 골조
  return buildingImgURL(b.type, b.dir);                    // 후반: 완성 건물 모습
}

/* ═══════════════ 하늘 배경 (화면 고정 + 흐르는 구름) ═══════════════ */
// 구름 한 덩이 = 겹치는 타원 뭉치 (dx, dy, rx, ry) — 기준 픽셀(스케일·DPR 곱함).
const CLOUD_SHAPES = [
  [[0, 0, 60, 40], [46, 8, 50, 34], [-46, 10, 48, 32], [22, -22, 42, 34], [-20, -16, 40, 30]],
  [[0, 0, 70, 44], [60, 8, 52, 34], [-56, 10, 50, 32], [12, -26, 46, 34]],
  [[0, 0, 50, 34], [38, 6, 44, 30], [-38, 8, 42, 28], [0, -20, 40, 28]],
];
// 여러 모양·크기·높이·속도의 구름 (y·speed·phase 는 화면 비율/px 기준)
const CLOUDS = [
  { shape: 0, y: 0.10, scale: 1.00, speed: 8.0,  alpha: 0.95, phase: 0.00 },
  { shape: 1, y: 0.22, scale: 0.70, speed: 5.0,  alpha: 0.88, phase: 0.37 },
  { shape: 2, y: 0.06, scale: 1.30, speed: 11.0, alpha: 0.82, phase: 0.62 },
  { shape: 1, y: 0.33, scale: 0.55, speed: 4.0,  alpha: 0.80, phase: 0.14 },
  { shape: 0, y: 0.29, scale: 0.90, speed: 6.5,  alpha: 0.90, phase: 0.80 },
  { shape: 2, y: 0.17, scale: 0.62, speed: 9.5,  alpha: 0.85, phase: 0.50 },
];
function drawClouds(g, w, h) {
  const t = Date.now() / 1000;
  const span = w + 340 * DPR;   // 화면 밖에서 다시 들어오도록 여유 폭
  for (const c of CLOUDS) {
    const shape = CLOUD_SHAPES[c.shape];
    const sc = c.scale * DPR;
    let x = (c.phase * span - t * c.speed * DPR) % span;   // 오른쪽→왼쪽으로 흐름, wrap
    if (x < 0) x += span;
    x -= 170 * DPR;
    const y = c.y * h;
    g.save();
    g.globalAlpha = c.alpha;
    g.fillStyle = "#ffffff";
    g.beginPath();                 // 한 경로에 타원들을 모아 한 번만 fill → 겹침 이음새 없음
    for (const p of shape) {
      const ex = x + p[0] * sc, ey = y + p[1] * sc, rx = p[2] * sc, ry = p[3] * sc;
      g.moveTo(ex + rx, ey);
      if (g.ellipse) g.ellipse(ex, ey, rx, ry, 0, 0, Math.PI * 2);
    }
    g.fill();
    g.restore();
  }
}
function drawSky(g) {
  const w = canvas.width, h = canvas.height;
  // 하늘 그라데이션 (위=진한 하늘, 아래=옅은 지평선). 헤드리스 스텁이면 단색 폴백.
  // ★ 물 타일(≈#9dd5e3, 청록빛)과 헷갈리지 않게 하늘은 초록기 뺀 진한 azure 블루로.
  const grd = g.createLinearGradient && g.createLinearGradient(0, 0, 0, h);
  if (grd && grd.addColorStop) {
    grd.addColorStop(0, "#3f83db");   // 위: 진한 azure
    grd.addColorStop(1, "#a9cdf3");   // 아래(지평선): 옅은 azure — 물보다 파랗고 명도도 다름
    g.fillStyle = grd;
  } else {
    g.fillStyle = "#6ba3e8";
  }
  g.fillRect(0, 0, w, h);
  drawClouds(g, w, h);
}

function render() {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  drawSky(ctx);
  ctx.setTransform(DPR * cam.s, 0, 0, DPR * cam.s, DPR * (W / 2 - cam.x * cam.s), DPR * (H / 2 - cam.y * cam.s));
  ctx.imageSmoothingEnabled = true;

  if (groundCanvas) ctx.drawImage(groundCanvas, G_X0, G_Y0, G_W, G_H);

  // 건물 + 지형지물을 남쪽 깊이 순으로 함께 그림
  const items = [];
  for (const b of state.buildings) {
    const f = footDims(b.type, b.dir);
    const alpha = (moveMode && moveMode.iid === b.iid) ? 0.25 : 1;
    // 신축 공사 중이면 진행 단계 그림(stage_A→B→완성)으로 그린다
    const imgUrl = b.constructing ? constructStageURL(b) : null;
    items.push({
      depth: b.gx + b.gy + f.w + f.h,
      draw: () => drawB(ctx, b.type, b.gx, b.gy, b.dir, alpha, undefined, imgUrl),
    });
  }
  // 건축 중(착공된) 건물마다 노움이 앞에서 점프
  if (typeof drawGnome === "function" && Array.isArray(state.construction)) {
    for (const j of state.construction) {
      if (j.end == null) continue;                 // 착공된 것만(슬롯 대기 중엔 안 보임)
      const b = byIid(j.iid);
      if (!b) continue;
      const f = footDims(b.type, b.dir);
      const gx = b.gx + f.w / 2, gy = b.gy + f.h;   // 건물 앞 가운데
      const gcx = isoX(gx, gy), gfy = isoY(gx, gy);
      // 노움은 건물 "앞"에 서므로 자기 건물보다 항상 나중에(위에) 그린다 — stage_B·완성 그림에 안 가리게
      items.push({ depth: b.gx + b.gy + f.w + f.h + 0.5, draw: () => drawGnome(ctx, gcx, gfy, 1.3, Date.now() / 1000 + j.iid) });
    }
  }
  for (const ft of FEATURES) {
    items.push({ depth: ft.gx + ft.gy + 2, draw: () => drawFeature(ctx, ft) });
  }
  // 돌아다니는 NPC (건물·지형지물과 같은 깊이 정렬에 섞어 그린다)
  // 작업형 NPC가 자기 건물 근처(작업 자리)에 있으면 방향에 따라 앞(SE·SW)/뒤(NE·NW)로 고정 배치.
  if (typeof NPCS !== "undefined") for (const n of NPCS) {
    let depth = n.fx + n.fy + 1;
    const bb = n.boundIid != null ? byIid(n.boundIid) : null;
    if (bb && !bb.constructing) {
      const bf = footDims(bb.type, bb.dir);
      const near = n.fx >= bb.gx - 1 && n.fx <= bb.gx + bf.w && n.fy >= bb.gy - 1 && n.fy <= bb.gy + bf.h;
      if (near) {
        const front = (bb.dir === "SE" || bb.dir === "SW");   // 앞=건물 위로, 뒤=건물에 가림
        depth = front ? (bb.gx + bb.gy + bf.w + bf.h + 0.7) : (bb.gx + bb.gy - 0.7);
      }
    }
    items.push({ depth, draw: () => drawNpc(ctx, n) });
  }
  // 잠긴 청크의 숲 (화면에 보이는 것만 — 컬링)
  const vhw = W / (2 * cam.s) + 200, vhh = H / (2 * cam.s) + 250;
  for (let cy = 0; cy < CHUNKS_Y; cy++) {
    for (let cx = 0; cx < CHUNKS_X; cx++) {
      if (LAND.has(cx + "," + cy)) continue;
      const bx = cx * CHUNK, by = cy * CHUNK;
      const px = isoX(bx + 2, by + 2), py = isoY(bx + 2, by + 2);
      if (px < cam.x - vhw || px > cam.x + vhw || py < cam.y - vhh || py > cam.y + vhh) continue;
      for (const [ox, oy] of [[0, 0], [2, 0], [0, 2], [2, 2]]) {
        const qx = bx + ox, qy = by + oy;
        items.push({ depth: qx + qy + 4, draw: () => drawTreeQuad(ctx, qx, qy) });
      }
    }
  }
  items.sort((a, b) => a.depth - b.depth);
  for (const it of items) it.draw();

  // 집 위 금화 표시: 회전 프레임 애니메이션 (이미지 없으면 💰 폴백)
  const coinImg = getImg(COIN_URLS[Math.floor(Date.now() / 80) % COIN_URLS.length]);
  ctx.font = "30px sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
  for (const b of state.buildings) {
    if (!houseIconVisible(b)) continue;
    const p = houseIconPos(b);
    const bob = Math.sin(Date.now() / 300) * 3;
    if (imgOK(coinImg)) {
      const cw = 38;
      ctx.drawImage(coinImg, p.x - cw / 2, p.y - cw / 2 + bob, cw, cw);
    } else {
      ctx.fillText("💰", p.x, p.y + bob);
    }
  }

  // 건물 이름·레벨 라벨 (옵션 켜짐 시). 카메라 변환 안이라 폰트를 1/cam.s로 보정해 화면상 크기 고정.
  if (typeof labelEnabled === "function" && labelEnabled()) {
    const fs = 11 / cam.s;
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.font = "700 " + fs + "px 'Malgun Gothic',sans-serif";
    for (const b of state.buildings) {
      if (b.constructing) continue;
      const d = bdef(b.type), f = footDims(b.type, b.dir);
      const wx = isoX(b.gx + f.w / 2, b.gy + f.h / 2);
      const wy = isoY(b.gx, b.gy) - 8 / cam.s;
      const text = d.name + " Lv." + b.level;
      const m = ctx.measureText ? ctx.measureText(text) : null;
      const tw2 = (m && m.width) ? m.width : text.length * fs * 0.62;   // 헤드리스 스텁 대비 폴백
      const bw = tw2 + 10 / cam.s, bh = fs + 6 / cam.s;
      ctx.fillStyle = "rgba(10,14,26,0.72)";
      if (ctx.roundRect) { ctx.beginPath(); ctx.roundRect(wx - bw / 2, wy - bh / 2, bw, bh, 4 / cam.s); ctx.fill(); }
      else ctx.fillRect(wx - bw / 2, wy - bh / 2, bw, bh);
      ctx.fillStyle = "#eef2f7";
      ctx.fillText(text, wx, wy);
    }
  }

  if (moveMode) {
    const ok = validPos(moveMode.type, moveMode.gx, moveMode.gy, moveMode.dir, moveMode.iid);
    drawB(ctx, moveMode.type, moveMode.gx, moveMode.gy, moveMode.dir, 0.75, !ok);
  }
  // 발판·기준점·배치금지 칸 표시 — 편집 모드이거나 data.js debug.footprints
  if (editMode || (GAME_DATA.debug && GAME_DATA.debug.footprints)) {
    const gov = (ASSET_MAP.ground && ASSET_MAP.ground.overrides) || {};
    ctx.fillStyle = "rgba(230,60,60,0.35)";
    for (const k in gov) {
      const v = gov[k];
      if (!(typeof v === "object" && v.block)) continue;
      const c = k.split(",");
      footDiamond(ctx, +c[0], +c[1], 1, 1);
      ctx.fill();
    }
    for (const ft of FEATURES) {
      if (!ft.block) continue;
      footDiamond(ctx, ft.gx, ft.gy, 1, 1);
      ctx.fill();
    }
    for (const k in state.tiles) {
      if (state.tiles[k] !== "water") continue;
      const c = k.split(",");
      footDiamond(ctx, +c[0], +c[1], 1, 1);
      ctx.fill();
    }
    // 터치영역(그림 박스·터치 박스)은 옵션이 켜졌을 때만 (기본은 안 보임)
    const showHit = (typeof hitBoxEnabled === "function") ? hitBoxEnabled() : false;
    for (const b of state.buildings) {
      const f = footDims(b.type, b.dir);
      if (showHit) {
        // 그림 박스(회색 점선) = 이미지가 차지하는 영역(참고용). 터치 박스(청록) = 실제 탭 판정 영역.
        //   그림은 그대로 두고 data.js hitScale/hitScaleX/hitScaleY/hitDX/hitDY 로 청록 박스만 조절.
        //   (탭 우선순위: ① 발판 칸은 항상 → ② 이 청록 터치 박스)
        const sr = spriteRect(b.type, b.gx, b.gy, b.dir);
        ctx.strokeStyle = "rgba(180,190,200,0.5)"; ctx.lineWidth = 1 / cam.s;
        ctx.setLineDash([3 / cam.s, 3 / cam.s]);
        ctx.strokeRect(sr.x, sr.y, sr.w, sr.h);
        ctx.setLineDash([]);
        const r = hitRect(b.type, b.gx, b.gy, b.dir);
        ctx.fillStyle = "rgba(70,200,220,0.15)";
        ctx.fillRect(r.x, r.y, r.w, r.h);
        ctx.strokeStyle = "#46c8dc"; ctx.lineWidth = 1.5 / cam.s;
        ctx.strokeRect(r.x, r.y, r.w, r.h);
      }
      // 발판(노란 마름모) + 기준점(빨간 점)
      ctx.strokeStyle = "#ffe14d"; ctx.lineWidth = 2 / cam.s;
      footDiamond(ctx, b.gx, b.gy, f.w, f.h);
      ctx.stroke();
      ctx.fillStyle = "#ff5d5d";
      ctx.beginPath();
      ctx.arc(isoX(b.gx, b.gy), isoY(b.gx, b.gy), 4 / cam.s, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}
