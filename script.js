/* ============================================================
   通用工具
   ============================================================ */
const STORE_KEY = 'listening_lab_progress_v1';
function loadStore(){ try { return JSON.parse(localStorage.getItem(STORE_KEY)) || {}; } catch(e){ return {}; } }
function saveStore(s){ try { localStorage.setItem(STORE_KEY, JSON.stringify(s)); } catch(e){} }
function fmt(t){
  t = Math.max(0, Math.floor(t));
  const m = Math.floor(t/60), s = t%60;
  return m + ':' + String(s).padStart(2,'0');
}
function fmtDur(t){
  const m = Math.round(t/60);
  return m >= 1 ? m + ' 分钟' : Math.round(t) + ' 秒';
}
let toastTimer = null;
function toast(msg){
  let el = document.getElementById('toast');
  if (!el){
    el = document.createElement('div'); el.id='toast';
    el.style.cssText='position:fixed;left:50%;bottom:36px;transform:translateX(-50%) translateY(12px);background:rgba(29,29,46,.92);color:#fff;font-size:13px;padding:9px 18px;border-radius:999px;opacity:0;transition:all .25s;z-index:99;pointer-events:none;';
    document.body.appendChild(el);
  }
  el.textContent=msg;
  requestAnimationFrame(()=>{ el.style.opacity='1'; el.style.transform='translateX(-50%) translateY(0)'; });
  clearTimeout(toastTimer);
  toastTimer=setTimeout(()=>{ el.style.opacity='0'; el.style.transform='translateX(-50%) translateY(12px)'; },1800);
}

const COURSES = window.COURSES || [];

/* ============================================================
   首页渲染
   ============================================================ */
function courseProgress(c){
  const s = loadStore()[c.id];
  if (!s || !s.duration) return 0;
  const ratio = s.time / s.duration;
  return ratio >= 0.985 ? 1 : ratio; // 看完视为完成
}

function renderHome(){
  const totalSent = COURSES.reduce((a,c)=>a+(c.subtitles?c.subtitles.length:0),0);
  const totalMin = Math.round(COURSES.reduce((a,c)=>a+c.duration,0)/60);
  const done = COURSES.filter(c=>courseProgress(c)===1).length;
  document.getElementById('heroStats').innerHTML =
    stat(COURSES.length,'节','实景课程') +
    stat(totalSent,'句','双语字幕') +
    stat(totalMin,'分钟','总时长') +
    stat(done,'节','已完成');

  const grid = document.getElementById('courseGrid');
  grid.innerHTML = COURSES.map((c,i)=>{
    const p = courseProgress(c);
    const pct = Math.round(p*100);
    let foot;
    if (p===1) foot = '<div class="cc-progress-txt">已完成 · 可复习</div>';
    else if (p>0.02) foot =
      '<div class="cc-progress"><div class="cc-progress-bar"><div class="cc-progress-fill" style="width:'+pct+'%"></div></div>'+
      '<div class="cc-progress-txt">已学 '+pct+'%</div></div>';
    else foot = '<div class="cc-progress"><div class="cc-progress-bar"></div><div class="cc-progress-txt">未开始</div></div>';
    const cta = p>0.02 && p<1 ? '继续学习' : (p===1?'复习本课':'开始学习');
    const tags = (c.tags||[]).map(t=>'<span class="cc-tag">'+t+'</span>').join('');
    return ''+
    '<a class="course-card" href="#/player/'+c.id+'">'+
      '<div class="cc-cover">'+
        '<span class="cc-no">LESSON '+(i+1)+'</span>'+
        '<img src="'+c.cover+'" alt="'+c.title+'" loading="lazy">'+
        '<span class="cc-dur">'+fmt(c.duration)+'</span>'+
        '<span class="cc-play"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg></span>'+
      '</div>'+
      '<div class="cc-body">'+
        '<div class="cc-title">'+c.title+'</div>'+
        '<div class="cc-desc">'+c.desc+'</div>'+
        '<div class="cc-tags">'+tags+'</div>'+
        '<div class="cc-foot">'+foot+
          '<span class="cc-cta">'+cta+'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18l6-6-6-6"/></svg></span>'+
        '</div>'+
      '</div>'+
    '</a>';
  }).join('');
}
function stat(n,unit,lab){
  return '<div class="stat"><div class="num">'+n+'<span class="unit">'+unit+'</span></div><div class="lab">'+lab+'</div></div>';
}

/* ============================================================
   播放器
   ============================================================ */
const video = document.getElementById('video');
const capList = document.getElementById('capList');
const nowSub = document.getElementById('nowSub');
const nowEn = document.getElementById('nowEn');
const nowZh = document.getElementById('nowZh');

const SPEEDS=[0.75,1.0,1.25,1.5];
const FONTS=[{key:'small',label:'字号 小'},{key:'',label:'字号 默认'},{key:'large',label:'字号 大'}];
const PLAY_SVG='<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>';
const LOOP_SVG='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 2l4 4-4 4"/><path d="M3 11v-1a4 4 0 014-4h14"/><path d="M7 22l-4-4 4-4"/><path d="M21 13v1a4 4 0 01-4 4H3"/></svg>';

let cur=null;           // 当前课程对象
let state=null;         // 当前课程的播放状态
let lastSave=0;

function newState(){
  return { mode:'bilingual', current:-1, autoFollow:true, pauseAtSentenceEnd:false,
           loopIndex:-1, speedIndex:1, fontIndex:1, seekedResume:false };
}

function findIndex(time){
  const subs=cur.subtitles;
  for (let i=0;i<subs.length;i++){ if(time>=subs[i].start && time<subs[i].end) return i; }
  if(time<subs[0].start) return -1;
  for(let i=0;i<subs.length-1;i++){ if(time>=subs[i].end && time<subs[i+1].start) return i; }
  return subs.length-1;
}

function renderList(){
  const subs=cur.subtitles;
  const frag=document.createDocumentFragment();
  subs.forEach((s,i)=>{
    const card=document.createElement('div');
    card.className='cap'; card.dataset.index=i;
    card.innerHTML=
      '<div class="cap-meta">'+
        '<span class="cap-time">'+fmt(s.start)+' – '+fmt(s.end)+'</span>'+
        '<button class="cap-loop" title="单句循环">'+LOOP_SVG+'循环</button>'+
        '<button class="cap-play" title="播放该句">'+PLAY_SVG+'</button>'+
      '</div>'+
      '<div class="cap-en">'+s.en+'</div>'+
      '<div class="cap-zh">'+s.zh+'</div>';
    frag.appendChild(card);
  });
  capList.innerHTML=''; capList.appendChild(frag);
}

function seekToIndex(i,autoplay){
  const subs=cur.subtitles;
  if(i<0||i>=subs.length) return;
  video.currentTime=subs[i].start+0.01;
  if(autoplay!==false){ const p=video.play(); if(p&&p.catch)p.catch(()=>{}); }
  setActive(i);
}

function setActive(i){
  if(state.current===i) return;
  state.current=i;
  const cards=capList.children;
  for(let k=0;k<cards.length;k++) cards[k].classList.toggle('active',k===i);
  const subs=cur.subtitles;
  if(i>=0){ nowSub.classList.remove('empty'); nowEn.textContent=subs[i].en; nowZh.textContent=subs[i].zh; }
  else { nowSub.classList.add('empty'); nowEn.textContent='点击播放，开始精听练习'; nowZh.textContent=''; }
  if(state.autoFollow && i>=0 && cards[i]) cards[i].scrollIntoView({behavior:'smooth',block:'nearest'});
}

function saveProgress(force){
  const now=Date.now();
  if(!force && now-lastSave<1500) return;
  lastSave=now;
  if(!video.duration) return;
  const all=loadStore();
  all[cur.id]={ time:video.currentTime, duration:video.duration, idx:state.current, updated:now };
  saveStore(all);
}

function loadProgress(){
  const s=loadStore()[cur.id];
  if(s && s.duration && s.time>5 && s.time < s.duration-3){
    return s.time;
  }
  return null;
}

/* 加载并初始化某一课 */
function loadCourse(id){
  cur = COURSES.find(c=>c.id===id);
  if(!cur){ location.hash='#/'; return; }
  state = newState();

  document.getElementById('videoTitle').textContent = cur.title;
  const idx = COURSES.indexOf(cur);
  document.getElementById('coursePos').textContent = (idx+1)+' / '+COURSES.length;
  const pc=document.getElementById('prevCourseBtn'), nc=document.getElementById('nextCourseBtn');
  pc.disabled = idx===0; nc.disabled = idx===COURSES.length-1;
  pc.onclick = ()=>{ if(idx>0) location.hash='#/player/'+COURSES[idx-1].id; };
  nc.onclick = ()=>{ if(idx<COURSES.length-1) location.hash='#/player/'+COURSES[idx+1].id; };

  // 重置控件 UI
  const followBtn=document.getElementById('followBtn');
  followBtn.classList.add('on'); followBtn.lastChild.textContent=' 自动跟随';
  const pauseBtn=document.getElementById('pauseSentenceBtn');
  pauseBtn.classList.remove('on'); pauseBtn.textContent='单句暂停';
  document.getElementById('speedBtn').textContent='倍速 1.0x';
  document.getElementById('fontBtn').textContent='字号 默认';
  document.body.classList.remove('fs-small','fs-large');
  document.body.dataset.mode='bilingual';
  document.querySelectorAll('.tab').forEach((t,k)=>t.classList.toggle('on',k===0));
  nowSub.classList.remove('collapsed');

  if(!cur.subtitles || !cur.subtitles.length){
    capList.innerHTML='<div class="empty-state">本课字幕准备中</div>';
    nowSub.classList.add('empty'); nowEn.textContent='点击播放，开始精听练习'; nowZh.textContent='';
  } else {
    renderList();
    state.current=-2;      // 强制重置，避免切课时当前句卡片残留上一课内容
    setActive(-1);
    capList.scrollTop=0;
  }

  // 加载视频并续播
  state.seekedResume=false;
  video.playbackRate=1.0;
  video.src=cur.src;
  video.load();
  const onMeta=()=>{
    const t=loadProgress();
    if(t!=null){
      video.currentTime=t; state.seekedResume=true;
      toast('已从上次位置 '+fmt(t)+' 继续');
    }
    video.removeEventListener('loadedmetadata',onMeta);
  };
  video.addEventListener('loadedmetadata',onMeta);
  if(video.readyState>=1) onMeta();

  window.scrollTo(0,0);
}

/* ============== 播放器事件（只绑定一次） ============== */
capList.addEventListener('click',(e)=>{
  const card=e.target.closest('.cap'); if(!card||!cur) return;
  const i=Number(card.dataset.index);
  if(e.target.closest('.cap-loop')){
    e.stopPropagation();
    state.loopIndex=(state.loopIndex===i)?-1:i;
    syncLoopUI();
    if(state.loopIndex===i){ toast('已开启该句循环'); seekToIndex(i); } else toast('已取消循环');
    return;
  }
  if(e.target.closest('.cap-play')){ e.stopPropagation(); seekToIndex(i); return; }
  seekToIndex(i);
});
function syncLoopUI(){
  const cards=capList.children;
  for(let k=0;k<cards.length;k++) cards[k].classList.toggle('looping',k===state.loopIndex);
}

video.addEventListener('timeupdate',()=>{
  if(!cur) return;
  const t=video.currentTime, subs=cur.subtitles;
  if(state.loopIndex>=0){
    const s=subs[state.loopIndex];
    if(s && (t>=s.end || t<s.start-0.3)){ video.currentTime=s.start+0.01; return; }
  }
  const idx=findIndex(t);
  if(state.pauseAtSentenceEnd && state.current>=0 && idx>state.current){
    video.pause(); video.currentTime=subs[state.current].start+0.01; setActive(state.current); return;
  }
  if(idx!==state.current) setActive(idx);
  saveProgress(false);
});
video.addEventListener('pause',()=>saveProgress(true));
video.addEventListener('ended',()=>{
  if(state.loopIndex<0){ setActive(cur.subtitles.length-1); saveProgress(true); }
});

document.getElementById('followBtn').addEventListener('click',(e)=>{
  state.autoFollow=!state.autoFollow;
  const b=e.currentTarget; b.classList.toggle('on',state.autoFollow);
  b.lastChild.textContent=state.autoFollow?' 自动跟随':' 跟随关';
  toast(state.autoFollow?'自动跟随已开启':'自动跟随已关闭');
});
document.getElementById('prevBtn').addEventListener('click',()=>{ if(!cur)return; const i=state.current<=0?0:state.current-1; seekToIndex(i); });
document.getElementById('nextBtn').addEventListener('click',()=>{ if(!cur)return; const i=state.current<0?0:Math.min(state.current+1,cur.subtitles.length-1); seekToIndex(i); });
document.getElementById('pauseSentenceBtn').addEventListener('click',(e)=>{
  state.pauseAtSentenceEnd=!state.pauseAtSentenceEnd;
  const b=e.currentTarget; b.classList.toggle('on',state.pauseAtSentenceEnd);
  b.textContent=state.pauseAtSentenceEnd?'单句暂停 开':'单句暂停';
  toast(state.pauseAtSentenceEnd?'单句暂停已开启，每句播完自动暂停':'单句暂停已关闭');
});
document.getElementById('speedBtn').addEventListener('click',(e)=>{
  state.speedIndex=(state.speedIndex+1)%SPEEDS.length;
  const v=SPEEDS[state.speedIndex]; video.playbackRate=v;
  e.currentTarget.textContent='倍速 '+v.toFixed(2).replace(/0$/,'')+'x';
});
document.getElementById('fontBtn').addEventListener('click',(e)=>{
  state.fontIndex=(state.fontIndex+1)%FONTS.length;
  const f=FONTS[state.fontIndex];
  document.body.classList.remove('fs-small','fs-large');
  if(f.key) document.body.classList.add('fs-'+f.key);
  e.currentTarget.textContent=f.label;
});
document.getElementById('restartBtn').addEventListener('click',()=>{
  if(!cur)return;
  const all=loadStore(); delete all[cur.id]; saveStore(all);
  video.currentTime=0; setActive(-1);
  toast('已回到开头，重新学习');
});
document.getElementById('collapseBtn').addEventListener('click',()=>nowSub.classList.toggle('collapsed'));

document.querySelectorAll('.tab').forEach(tab=>{
  tab.addEventListener('click',()=>{
    document.querySelectorAll('.tab').forEach(t=>t.classList.remove('on'));
    tab.classList.add('on');
    state.mode=tab.dataset.mode; document.body.dataset.mode=state.mode;
    if(state.current>=0 && capList.children[state.current]) capList.children[state.current].scrollIntoView({block:'nearest'});
  });
});

document.addEventListener('keydown',(e)=>{
  if(document.body.dataset.view!=='player'||!cur) return;
  if(e.target.tagName==='INPUT'||e.target.tagName==='TEXTAREA') return;
  if(e.code==='ArrowLeft') document.getElementById('prevBtn').click();
  else if(e.code==='ArrowRight') document.getElementById('nextBtn').click();
  else if(e.code==='Space'){ e.preventDefault(); video.paused?video.play():video.pause(); }
});

/* ============================================================
   Hash 路由
   ============================================================ */
function route(){
  const h=location.hash||'';
  const m=h.match(/^#\/player\/(.+)$/);
  if(m){
    document.body.dataset.view='player';
    loadCourse(decodeURIComponent(m[1]));
  } else {
    document.body.dataset.view='home';
    renderHome();
  }
}
window.addEventListener('hashchange',route);
route();
