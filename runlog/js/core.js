/* ============================================================
   core.js — 저장소, 데이터 마이그레이션, 공용 유틸
   (가장 먼저 로드됨: DB / $ / toast 등을 다른 파일이 사용)
   ============================================================ */
const KEY = "dalyeo_v1";

function load(){ try{ return JSON.parse(localStorage.getItem(KEY)) || {}; }catch(e){ return {}; } }
function save(d){ localStorage.setItem(KEY, JSON.stringify(d)); }

/* ------------------------------------------------------------
   마이그레이션: 앱을 업데이트해도 이전 기록이 그대로 남도록,
   저장 key(dalyeo_v1)를 고정하고 '데이터를 지우지 않고 채워 넣는' 방식만 쓴다.
   새 필드가 생기면 여기서 기본값을 보태고, 옛 구조는 새 구조로 변환한다.
   ------------------------------------------------------------ */
const SCHEMA = 3;
function migrate(db){
  if(!db.runs)   db.runs = [];
  if(!db.health) db.health = { profile:{} };
  // v1: health.diseases(배열) → health.profile(객체)
  if(db.health.diseases && !db.health.profile){
    const prof = {}; db.health.diseases.forEach(id => prof[id] = {});
    db.health = { profile:prof };
  }
  if(!db.health.profile) db.health.profile = {};
  // v2: 목표(거리·시간) 필드
  if(!("goal" in db)) db.goal = null;
  // v3: 주간 목표(횟수·거리) 필드
  if(!("weekGoal" in db)) db.weekGoal = null;
  db.v = SCHEMA;
  return db;
}
let DB = migrate(load());
save(DB);   // 마이그레이션된 형태를 즉시 저장(안전)

/* ---------- 유틸 ---------- */
const $ = id => document.getElementById(id);
function pick(arr){ return arr[Math.floor(Math.random()*arr.length)]; }
function esc(s){ return String(s).replace(/[&<>]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;"}[c])); }
function toast(msg){
  const t = $("toast"); t.textContent = msg; t.classList.add("show");
  clearTimeout(t._h); t._h = setTimeout(()=>t.classList.remove("show"), 1800);
}
function fmtPace(sec, km){
  if(!km || !sec) return "-";
  const p = sec/km, m = Math.floor(p/60), s = Math.round(p%60);
  return m + "'" + String(s).padStart(2,"0") + '"';
}
// 거리: 소수점 최대 3자리, 불필요한 0은 뗌 (2.797 → "2.797", 3.5 → "3.5", 3 → "3")
function fmtKm(km){ return (Math.round(km*1000)/1000).toString(); }
// 시간: 초까지 (25분 30초, 초가 0이면 "25분")
function fmtDur(sec){ const m = Math.floor(sec/60), s = Math.round(sec%60); return s ? `${m}분 ${s}초` : `${m}분`; }
// 로컬 기준 YYYY-MM-DD (toISOString은 UTC라 새벽시간대에 날짜가 하루 밀림 → 로컬로 계산)
function ymd(d){ return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`; }
function weekStart(){
  const n = new Date(); const day = (n.getDay()+6)%7;   // 월요일 시작
  n.setHours(0,0,0,0); n.setDate(n.getDate()-day); return n;
}
// 기록 날짜문자열 → 로컬 Date (요일·간격 계산용)
function dateOf(s){ return new Date(s + "T00:00:00"); }
