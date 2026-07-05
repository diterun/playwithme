// estate_tycoon — 노움(건축 일꾼) 렌더러
//  기본은 assets/mini_humans/gnome/gnome_0..5.png 프레임을 재생한다(점프 사이클).
//  그림이 아직 안 실렸거나 없으면 캔버스에 직접 그리는 절차적 픽셀아트로 폴백한다(같은 모양).
//  뾰족 빨간 모자·머리·몸통·두 팔·두 다리가 구분되고, 얼굴은 검은 점 눈 두 개뿐이다.
//  건축 중인 건물 앞에 붙어 점프한다.
"use strict";

const GNOME_DIR = "../assets/mini_humans/gnome/";
const GNOME_FRAMES = 6;   // 점프 한 사이클 프레임 수
const GNOME_FPS = 8;
function gnomeFrameURL(i) { return GNOME_DIR + "gnome_" + (i % GNOME_FRAMES) + ".png"; }
function gnomeFrameList() { const a = []; for (let i = 0; i < GNOME_FRAMES; i++) a.push(gnomeFrameURL(i)); return a; }
// 프레임 i의 점프 높이 비율(0=착지, 1=최고점). 프레임 포즈와 점프 오프셋을 같은 값으로 맞춘다.
function gnomeJf(i) { return Math.abs(Math.sin(Math.PI * (i % GNOME_FRAMES) / GNOME_FRAMES)); }

// 색 팔레트 (도트 느낌의 낮은 채도) — PNG 생성기와 동일해야 한다
const GNOME_COL = {
  hat: "#c0392b", hat2: "#e05a4a",
  skin: "#f1c9a5", hand: "#e9bd97",
  eye: "#1a1a1a",
  tunic: "#2f6fb0", tunic2: "#255a90",
  belt: "#6b4a2b",
  pants: "#39394d", boot: "#432b18",
};

// (g=ctx, cx=발 중앙 월드X, footY=지면 월드Y, s=크기배율, t=애니 시각(초))
function drawGnome(g, cx, footY, s, t) {
  const i = Math.floor(t * GNOME_FPS) % GNOME_FRAMES;
  const jf = gnomeJf(i);
  const jump = jf * 9 * s;

  // 바닥 그림자 (지면 고정, 뜨면 작아짐)
  g.fillStyle = "rgba(0,0,0,0.22)";
  g.beginPath();
  if (g.ellipse) g.ellipse(cx, footY, 6.2 * s * (1 - jf * 0.35), 2.6 * s * (1 - jf * 0.35), 0, 0, Math.PI * 2);
  g.fill();

  // 1순위: PNG 프레임 (다른 mini_humans NPC와 동일한 방식으로 그린다 — 32×32 스프라이트)
  const img = (typeof getImg === "function") ? getImg(gnomeFrameURL(i)) : null;
  if (typeof imgOK === "function" && imgOK(img)) {
    const tw = TILE_W * s;                                     // NPC scale 과 같은 기준
    const th = tw * (img.naturalHeight / img.naturalWidth);    // 32×32 → 정사각
    g.drawImage(img, cx - tw / 2, (footY - jump) - th, tw, th);
    return;
  }
  // 폴백: 절차적 픽셀아트 (그림자는 위에서 이미 그림)
  drawGnomeProc(g, cx, footY, s, jf);
}

// 절차적 픽셀아트 본체(그림자 제외). jf = 점프 높이 비율
function drawGnomeProc(g, cx, footY, s, jf) {
  const u = 2.3 * s;
  const jump = jf * 9 * s;
  const baseY = footY - jump;
  const legRaise = jf * 1.6;
  const armUp = jf;
  const C = GNOME_COL;
  const P = (ax, top, w, h, col) => { g.fillStyle = col; g.fillRect(cx + ax * u, baseY - top * u, w * u, h * u); };

  const lb = legRaise;
  for (const dx of [-2.6, 0.4]) {
    P(dx, lb + 4.2, 2.2, 4.2, C.pants);
    P(dx, lb + 1.4, 2.2, 1.4, C.boot);
  }
  const by = lb + 4.2;
  P(-3, by + 6, 6, 6, C.tunic);
  P(-3, by + 2, 6, 1, C.belt);
  const shoulder = by + 5.4, armThick = 1.5;
  const vLen = 3.6 * (1 - armUp) + 0.6;
  const handX = 3.0 + armUp * 1.6;
  const handY = shoulder - 3.6 + armUp * 6.0;
  P(-3 - armThick, shoulder, armThick, vLen, C.tunic2);
  P(-handX - 1.4, handY, 1.5, 1.5, C.hand);
  P(3, shoulder, armThick, vLen, C.tunic2);
  P(handX - 0.1, handY, 1.5, 1.5, C.hand);
  const hy = by + 6;
  P(-2.5, hy + 4.6, 5.0, 4.6, C.skin);
  P(-1.6, hy + 3.3, 1.0, 1.1, C.eye);
  P(0.6, hy + 3.3, 1.0, 1.1, C.eye);
  const top0 = hy + 4.6;
  P(-3.2, top0 + 1.2, 6.4, 1.2, C.hat);
  let yy = top0 + 1.2;
  for (let k = 0; k < 5; k++) {
    const w = 5.0 - k * 0.9;
    yy += 1.1;
    P(-w / 2, yy, w, 1.1, k % 2 ? C.hat2 : C.hat);
  }
  P(-0.6, yy + 1.0, 1.2, 1.0, C.hat2);
}

// 노움 프레임 미리 읽기 (engine.js getImg 뒤에 로드되므로 안전)
if (typeof getImg === "function") for (const u of gnomeFrameList()) getImg(u);
