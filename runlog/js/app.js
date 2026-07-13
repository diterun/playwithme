/* ============================================================
   app.js — 탭 전환, 화면 테마, 데이터 백업, PWA 설치, 부팅
   (마지막에 로드: render/renderProfile 등 앞 파일의 함수 사용)
   ============================================================ */

/* ---------- 탭 전환 ---------- */
document.querySelectorAll("nav button").forEach(b => {
  b.onclick = ()=>{
    document.querySelectorAll("nav button").forEach(x=>x.classList.remove("active"));
    document.querySelectorAll(".view").forEach(x=>x.classList.remove("active"));
    b.classList.add("active");
    $(b.dataset.view).classList.add("active");
    $("fab").style.display        = b.dataset.view==="v-log"    ? "block" : "none";
    $("fab-health").style.display = b.dataset.view==="v-health" ? "block" : "none";
    if(b.dataset.view==="v-set") refreshInstallUI();
  };
});

/* ---------- 화면 테마 ---------- */
function applyTheme(t){
  document.documentElement.dataset.theme = t;
  localStorage.setItem("dalyeo_theme", t);
  document.querySelectorAll("#theme-seg button").forEach(b=>b.classList.toggle("active", b.dataset.theme===t));
}
document.querySelectorAll("#theme-seg button").forEach(b => b.onclick = ()=>applyTheme(b.dataset.theme));
applyTheme(localStorage.getItem("dalyeo_theme") || "dark");

/* ---------- 데이터 백업/복원/삭제 ---------- */
$("btn-export").onclick = ()=>{
  const blob = new Blob([JSON.stringify(DB,null,2)], {type:"application/json"});
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "dalyeo-backup-" + ymd(new Date()) + ".json";
  a.click(); URL.revokeObjectURL(a.href);
  toast("백업 파일을 내보냈어요");
};
$("btn-import").onclick = ()=>$("file-in").click();
$("file-in").onchange = e => {
  const f = e.target.files[0]; if(!f) return;
  const r = new FileReader();
  r.onload = ()=>{
    try{
      const d = JSON.parse(r.result);
      if(!d.runs) throw 0;
      DB = migrate(d);
      save(DB); render(); fillGoalInputs(); fillWeekGoalInputs(); toast("불러오기 완료!");
    }catch(err){ toast("파일을 읽을 수 없어요"); }
  };
  r.readAsText(f); e.target.value = "";
};
$("btn-csv").onclick = exportCSV;
$("btn-clear").onclick = ()=>{
  if(confirm("모든 달리기 기록을 지울까요? 되돌릴 수 없어요.\n(건강 프로필·목표는 유지됩니다)")){
    DB.runs = []; save(DB); render(); toast("전체 기록을 삭제했어요");
  }
};

/* ---------- 주간 목표 ---------- */
function fillWeekGoalInputs(){
  $("wg-runs").value = DB.weekGoal && DB.weekGoal.runs ? DB.weekGoal.runs : "";
  $("wg-km").value   = DB.weekGoal && DB.weekGoal.km   ? DB.weekGoal.km   : "";
}
$("wg-save").onclick = ()=>{
  const runs = parseInt($("wg-runs").value) || 0, km = parseFloat($("wg-km").value) || 0;
  if(!(runs>0) && !(km>0)){ toast("횟수나 거리 중 하나는 입력해주세요"); return; }
  DB.weekGoal = { runs, km }; save(DB); render();
  toast("주간 목표를 저장했어요 🔥");
};
$("wg-clear").onclick = ()=>{
  DB.weekGoal = null; save(DB); fillWeekGoalInputs(); render();
  toast("주간 목표를 지웠어요");
};

/* ---------- PWA 설치 ---------- */
let deferredPrompt = null;
const isStandalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) && !window.MSStream;

function refreshInstallUI(){
  const card = $("install-card"), banner = $("install-banner");
  ["install-btn","install-ios","install-hint","install-done"].forEach(id=>$(id).style.display="none");
  banner.classList.remove("show");
  card.style.display = "block";
  if(isStandalone){ $("install-done").style.display = "block"; return; }
  if(deferredPrompt){
    $("install-btn").style.display = "block";
    if(localStorage.getItem("dalyeo_ib_off") !== "1") banner.classList.add("show");
  } else if(isIOS){
    $("install-ios").style.display = "block";
  } else {
    $("install-hint").style.display = "block";
  }
}
async function doInstall(){
  if(!deferredPrompt) return;
  deferredPrompt.prompt();
  const { outcome } = await deferredPrompt.userChoice;
  deferredPrompt = null;
  if(outcome==="accepted") toast("설치를 시작했어요 📲");
  refreshInstallUI();
}
window.addEventListener("beforeinstallprompt", e => { e.preventDefault(); deferredPrompt = e; refreshInstallUI(); });
window.addEventListener("appinstalled", ()=>{ deferredPrompt=null; localStorage.setItem("dalyeo_ib_off","1"); toast("앱이 설치됐어요 🎉"); refreshInstallUI(); });
$("install-btn").onclick = doInstall;
$("ib-yes").onclick = doInstall;
$("ib-no").onclick = ()=>{ localStorage.setItem("dalyeo_ib_off","1"); $("install-banner").classList.remove("show"); };

/* ---------- 부팅 ---------- */
render();
fillGoalInputs();
fillWeekGoalInputs();
refreshInstallUI();

/* ---------- 서비스워커 등록 (http(s) 에서만) ---------- */
if("serviceWorker" in navigator && location.protocol.indexOf("http")===0){
  window.addEventListener("load", ()=>navigator.serviceWorker.register("sw.js").catch(()=>{}));
}
