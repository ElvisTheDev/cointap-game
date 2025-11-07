/* app.js — header rename, Buy Drops bottom-sheet, Earn compact spacing, bin hit animation, balance moved to top */

const BOT_USERNAME = 'your_bot'; // <-- CHANGE to your bot username (without @)

const payouts = [100,50,20,10,5,1,1,5,10,20,50,100];
const binsCount = payouts.length;

const BASE_MAX_BALLS = 100;
const BOOST_MAX_BALLS = 500;

/* Physics tuned for middle bias */
const ballRadius = 4;
const obstacleRadius = 4;
const gravity = 1400;
const restitution = 0.60;
const friction = 0.985;
let centerBias = 12.0;

/* Regen / boosts */
const BASE_REGEN_SECONDS = 60;
const SPEEDSTER_MULTIPLIER = 0.5;

const obstacleRows = [3,4,5,6,7,8,9,10,11,12,13,14];

const BIN_CORNER = 4;
const BINS_EXTRA_DROP = 15;

const TELEGRAM = window.Telegram && window.Telegram.WebApp ? window.Telegram.WebApp : null;
if (TELEGRAM) { try { TELEGRAM.ready(); } catch(e) {} }

const canvas = document.getElementById('plinkoCanvas');
const ctx = canvas.getContext('2d');

const dom = {
  ballsCount: document.getElementById('ballsCount'),
  ballsMax: document.getElementById('ballsMax'),
  regenTimer: document.getElementById('regenTimer'),
  dropBtn: document.getElementById('dropBtn'),
  coinsCount: document.getElementById('coinsCount'), // not used on top now, keep for safety
  balance: document.getElementById('balance'),
  leaderboardList: document.getElementById('leaderboardList'),
  modal: document.getElementById('modal'),
  modalContent: document.getElementById('modalContent'),
  closeModalBtn: document.getElementById('closeModal'),
  boostList: document.getElementById('boostList'),
  invitedCount: document.getElementById('invitedCount'),
  earnFriendsList: document.getElementById('earnFriendsList'),
  inviteTopList: document.getElementById('inviteTopList'),
  refLink: document.getElementById('refLink'),
  copyRef: document.getElementById('copyRef'),
  buyDropsBtn: document.getElementById('buyDropsBtn'),
  buySheet: document.getElementById('buySheet'),
  sheetClose: document.getElementById('sheetClose')
};

function getTelegramUser(){
  const u = (TELEGRAM && TELEGRAM.initDataUnsafe && TELEGRAM.initDataUnsafe.user) || null;
  return {
    id: u?.id ? String(u.id) : 'local_' + Math.floor(Math.random()*999999),
    first_name: u?.first_name || 'Player',
    username: u?.username || '',
    photo_url: u?.photo_url || ''
  };
}
const tgUser = getTelegramUser();

/* State */
let coins = Number(localStorage.getItem('sc_coins') || 0);
let balls = Number(localStorage.getItem('sc_balls') || BASE_MAX_BALLS);
if (isNaN(balls)) balls = BASE_MAX_BALLS;
let lastRegen = Number(localStorage.getItem('sc_lastRegen') || Date.now());
let regenInterval = null, regenCountdownInterval = null;

let obstacles = [];
let bins = [];
let ballsInFlight = [];

/* Boosts (Speedster, Maxi, Spender, Nuke) */
let boosts = JSON.parse(localStorage.getItem('sc_boosts') || '{}');
if (!boosts || typeof boosts !== 'object') boosts = {};
function isSpeedster(){ return (boosts.speedsterUntil || 0) > Date.now(); }
function isMaxi(){ return (boosts.maxiUntil || 0) > Date.now(); }
function isNuke(){ return (boosts.nukeUntil || 0) > Date.now(); }

function regenSeconds(){ return isSpeedster() ? BASE_REGEN_SECONDS * SPEEDSTER_MULTIPLIER : BASE_REGEN_SECONDS; }
function maxBalls(){ return isMaxi() ? BOOST_MAX_BALLS : BASE_MAX_BALLS; }
function saveBoosts(){ localStorage.setItem('sc_boosts', JSON.stringify(boosts)); }

/* ------ Audio ------ */
const AudioCtx = window.AudioContext || window.webkitAudioContext;
let audioCtx = null;
function ensureAudio(){ if (!audioCtx) audioCtx = new AudioCtx(); }
function playHitSound(){ try{ ensureAudio(); const t=audioCtx.currentTime,o=audioCtx.createOscillator(),g=audioCtx.createGain(); o.type='square'; o.frequency.setValueAtTime(880+Math.random()*80,t); g.gain.setValueAtTime(0.0001,t); g.gain.exponentialRampToValueAtTime(0.04,t+0.004); g.gain.exponentialRampToValueAtTime(0.0001,t+0.12); o.connect(g); g.connect(audioCtx.destination); o.start(t); o.stop(t+0.14);}catch(e){} }
function playLandSound(big=false){ try{ ensureAudio(); const t=audioCtx.currentTime,o=audioCtx.createOscillator(),g=audioCtx.createGain(); o.type='sine'; o.frequency.setValueAtTime(big?220:440,t); g.gain.setValueAtTime(0.0001,t); g.gain.exponentialRampToValueAtTime(big?0.09:0.035,t+0.008); g.gain.exponentialRampToValueAtTime(0.0001,t+(big?0.7:0.22)); o.connect(g); g.connect(audioCtx.destination); o.start(t); o.stop(t+(big?0.72:0.24)); }catch(e){} }

/* ------ Persistence/UI ------ */
function saveState(){
  localStorage.setItem('sc_coins', String(coins));
  localStorage.setItem('sc_balls', String(balls));
  localStorage.setItem('sc_lastRegen', String(lastRegen));
}
function saveScoreLocal(){
  const s = JSON.parse(localStorage.getItem('sc_scores') || '{}');
  s[tgUser.id] = { name: tgUser.first_name || 'Player', username: tgUser.username || '', avatarUrl: tgUser.photo_url || '', coins };
  localStorage.setItem('sc_scores', JSON.stringify(s));
}
function updateUI(){
  if (dom.balance) dom.balance.textContent = `${coins} SOLX`;
  if (dom.ballsCount) dom.ballsCount.textContent = `${balls}`;
  if (dom.ballsMax) dom.ballsMax.textContent = `${maxBalls()}`;
  renderEarn();
  saveState(); saveScoreLocal(); saveBoosts();
  renderBoosts();
}

/* ------ Start params & Referrals ------ */
function getStartParam(){
  const fromTG = TELEGRAM?.initDataUnsafe?.start_param;
  if (fromTG) return fromTG;
  const sp = new URLSearchParams(window.location.search);
  return sp.get('startapp') || sp.get('start') || '';
}

function handleReferralOnOpen(){
  const param = getStartParam();
  if (!param || !/^ref_/i.test(param)) return;
  const inviterId = String(param.replace(/^ref_/i, ''));
  if (!inviterId || inviterId === tgUser.id) return;
  const claimedKey = `sc_ref_claimed_${inviterId}`;
  if (localStorage.getItem(claimedKey)) return;

  coins += 200;
  balls = Math.min(maxBalls(), balls + 100);

  localStorage.setItem('sc_inviter_id', inviterId);
  localStorage.setItem(claimedKey, '1');

  updateUI();
  showToast('🎁 +200 coins & +100 drops for joining!');
}

function setReferralLink(){
  if (!dom.refLink) return;
  const code = `ref_${tgUser.id}`;
  const link = `https://t.me/${BOT_USERNAME}?startapp=${encodeURIComponent(code)}`;
  dom.refLink.value = link;
}

/* ------ Layout sizing ------ */
function fitCanvas(){
  const navH = 58;
  const headerH = 50;
  const appH = window.innerHeight - navH - 11;
  const topH = 56;
  const actionsH = 96;
  const canvasAvail = Math.max(240, appH - headerH - topH - actionsH);

  const cssWidth = Math.min(window.innerWidth * 0.92, 940);
  const cssHeight = Math.min(canvasAvail, 520);

  canvas.style.width = cssWidth + 'px';
  canvas.style.height = cssHeight + 'px';
  const ratio = window.devicePixelRatio || 1;
  canvas.width = Math.round(cssWidth * ratio);
  canvas.height = Math.round(cssHeight * ratio);
  ctx.setTransform(ratio,0,0,ratio,0,0);
}

/* ------ Build pegs + bins ------ */
function buildObstaclesAndBins(){
  obstacles = [];
  bins = [];

  const W = canvas.clientWidth;
  const H = canvas.clientHeight;

  const topPadding = Math.max(12, H * 0.03);
  const bottomReserve = Math.max(78, H * 0.18);
  const usableH = H - topPadding - bottomReserve;

  const widest = Math.max(...obstacleRows);
  const sideMargin = Math.max(0.06 * W, 18);
  const availableWidth = W - sideMargin * 2;
  const baseSpacing = availableWidth / (widest + 1);
  const rows = obstacleRows.length;
  const vSpacing = usableH / (rows + 1);

  let lastPegY = topPadding;
  for (let r = 0; r < rows; r++){
    const count = obstacleRows[r];
    const rowWidth = baseSpacing * (count + 1);
    const rowLeft = (W - rowWidth) / 2;
    const y = topPadding + (r + 1) * vSpacing;
    for (let i = 0; i < count; i++){
      const x = rowLeft + (i + 1) * baseSpacing;
      obstacles.push({ x, y, r: obstacleRadius });
    }
    lastPegY = y;
  }

  const baseBinsTop = H - bottomReserve + 10;
  const raisedTop = lastPegY + 0.3 * (baseBinsTop - lastPegY);
  const binsTop = raisedTop + BINS_EXTRA_DROP;

  const minGap = 2;
  const maxFromHeight = Math.max(24, (H - binsTop) - 14);
  const maxFromWidth  = (availableWidth - minGap*(binsCount - 1)) / binsCount;
  const vwTarget = Math.max(26, Math.min(42, Math.floor(window.innerWidth * 0.07)));
  const boxSize = Math.max(24, Math.min(vwTarget, maxFromWidth, maxFromHeight));

  const totalRowWidth = boxSize * binsCount + minGap * (binsCount - 1);
  const left = (W - totalRowWidth) / 2;

  for (let i = 0; i < binsCount; i++){
    bins.push({ x: left + i * (boxSize + minGap), y: binsTop, w: boxSize, h: boxSize, i, _hitAt: 0 });
  }
}

/* ------ Collision helpers ------ */
function collidingCircleCircle(a,b){
  const dx = a.x - b.x, dy = a.y - b.y;
  const minR = (a.r + b.r);
  return (dx*dx + dy*dy) < (minR*minR);
}
function resolveCircleCollision(ball, obs){
  let nx = ball.x - obs.x, ny = ball.y - obs.y;
  const dist = Math.hypot(nx, ny) || 0.0001;
  nx/=dist; ny/=dist;
  const overlap = (ball.r + obs.r) - dist;
  ball.x += nx * (overlap + 0.5);
  ball.y += ny * (overlap + 0.5);
  const vdotn = ball.vx*nx + ball.vy*ny;
  ball.vx = ball.vx - 2*vdotn*nx;
  ball.vy = ball.vy - 2*vdotn*ny;
  ball.vx *= (restitution * 0.92);
  ball.vy *= (restitution * 0.92);
  ball.vx += (Math.random()-0.5)*6;
  playHitSound();
}

/* ------ Render ------ */
function drawRoundedRect(x,y,w,h,r){
  ctx.beginPath();
  const rr = Math.min(r, w/2, h/2);
  ctx.moveTo(x+rr, y);
  ctx.arcTo(x+w, y, x+w, y+h, rr);
  ctx.arcTo(x+w, y+h, x, y+h, rr);
  ctx.arcTo(x, y+h, x, y, rr);
  ctx.arcTo(x, y, x+w, y, rr);
  ctx.closePath();
}

function render(){
  const W = canvas.clientWidth, H = canvas.clientHeight;
  ctx.clearRect(0,0,W,H);

  // pegs
  for (const o of obstacles){
    ctx.beginPath();
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    ctx.arc(o.x, o.y, o.r, 0, Math.PI*2);
    ctx.fill();
  }

  // bins (with hit animation)
  const now = performance.now();
  for (let i = 0; i < bins.length; i++){
    const b = bins[i];
    // hit flash (120ms)
    const t = Math.max(0, 1 - (now - b._hitAt) / 120);
    const scale = 1 + 0.08 * t; // slight grow
    const cx = b.x + b.w/2, cy = b.y + b.h/2;
    const w = b.w * scale, h = b.h * scale;
    const x = cx - w/2, y = cy - h/2;

    const gradStroke = ctx.createLinearGradient(x, y, x + w, y + h);
    gradStroke.addColorStop(0, '#9945FF');
    gradStroke.addColorStop(1, '#0ABDE3');

    // glow on hit or 100 bins
    if (t > 0 || payouts[i] === 100){
      ctx.save();
      ctx.shadowColor = t > 0 ? 'rgba(20,241,149,0.45)' : 'rgba(153,69,255,0.28)';
      ctx.shadowBlur = t > 0 ? 24 : 18;
      ctx.fillStyle = 'rgba(255,255,255,0.06)';
      drawRoundedRect(x, y, w, h, BIN_CORNER);
      ctx.fill();
      ctx.restore();
    } else {
      ctx.fillStyle = 'rgba(255,255,255,0.035)';
      drawRoundedRect(x, y, w, h, BIN_CORNER);
      ctx.fill();
    }

    ctx.lineWidth = 1;
    ctx.strokeStyle = gradStroke;
    drawRoundedRect(x + 0.5, y + 0.5, w - 1, h - 1, BIN_CORNER);
    ctx.stroke();

    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    const labelSize = Math.max(11, Math.min(14, Math.floor(b.w * 0.34)));
    ctx.font = `700 ${labelSize}px Inter, system-ui`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(payouts[i]), cx, cy);
  }

  // balls
  for (const bl of ballsInFlight){
    const glowR = Math.max(bl.r * 4.5, 18);
    const grad = ctx.createRadialGradient(bl.x, bl.y, bl.r*0.2, bl.x, bl.y, glowR);
    grad.addColorStop(0, 'rgba(153,69,255,0.95)');
    grad.addColorStop(0.35, 'rgba(153,69,255,0.55)');
    grad.addColorStop(0.65, 'rgba(10,189,227,0.45)');
    grad.addColorStop(1, 'rgba(10,189,227,0)');
    ctx.beginPath(); ctx.fillStyle = grad; ctx.arc(bl.x, bl.y, glowR, 0, Math.PI*2); ctx.fill();

    ctx.beginPath(); ctx.fillStyle = 'rgba(0,0,0,0.20)';
    ctx.arc(bl.x + 2, bl.y + 3, bl.r + 1.8, 0, Math.PI*2); ctx.fill();

    ctx.beginPath(); ctx.fillStyle = '#ffffff';
    ctx.arc(bl.x, bl.y, bl.r, 0, Math.PI*2); ctx.fill();
  }
}

/* ------ Toast (small, non-blocking) ------ */
function showToast(text){
  const el = document.createElement('div');
  el.textContent = text;
  Object.assign(el.style,{
    position:'fixed', left:'50%', bottom:'90px', transform:'translateX(-50%)',
    background:'rgba(0,0,0,0.8)', color:'#fff', fontWeight:'700',
    padding:'10px 12px', borderRadius:'10px', zIndex:9999
  });
  document.body.appendChild(el);
  requestAnimationFrame(()=>{ el.style.transition='opacity 600ms'; el.style.opacity='1'; });
  setTimeout(()=>{ el.style.opacity='0'; setTimeout(()=>el.remove(), 650); }, 1400);
}

/* ------ Leaderboard (coins) ------ */
function getInitials(n){ const p=(n||'').trim().split(/\s+/); return ((p[0]||'').charAt(0)+(p[1]||'').charAt(0)).toUpperCase()||'P'; }
function renderLeaderboard(){
  const list = document.getElementById('leaderboardList'); if (!list) return;
  const obj = JSON.parse(localStorage.getItem('sc_scores') || '{}');
  const arr = Object.keys(obj).map(k => ({ id:k, name:obj[k].name||'Player', username:obj[k].username||'', avatarUrl:obj[k].avatarUrl||'', coins:obj[k].coins||0 }));
  arr.sort((a,b)=>b.coins-a.coins);
  list.innerHTML = '';
  if (!arr.length){ list.innerHTML = '<div class="muted">No scores yet — be the first!</div>'; return; }

  arr.slice(0,20).forEach((p,i)=>{
    const row=document.createElement('div');
    Object.assign(row.style,{display:'flex',alignItems:'center',justifyContent:'space-between',gap:'10px',padding:'8px 10px',borderRadius:'12px',background:'rgba(255,255,255,0.04)'});

    const left=document.createElement('div'); Object.assign(left.style,{display:'flex',alignItems:'center',gap:'10px'});
    const rank=document.createElement('div'); rank.textContent=String(i+1); Object.assign(rank.style,{width:'28px',textAlign:'center',fontWeight:'800',color:i===0?'#14F195':'rgba(255,255,255,0.9)'});

    const av=document.createElement('div'); Object.assign(av.style,{width:'36px',height:'36px',borderRadius:'50%',overflow:'hidden',display:'flex',alignItems:'center',justifyContent:'center',background:'linear-gradient(90deg,#9945FF,#0ABDE3)'});
    if (p.avatarUrl){ const img=new Image(); img.src=p.avatarUrl; img.alt=p.name; img.width=36; img.height=36; img.style.objectFit='cover'; img.referrerPolicy='no-referrer'; av.appendChild(img); }
    else { const init=document.createElement('div'); init.textContent=getInitials(p.name); Object.assign(init.style,{fontWeight:'800',fontSize:'14px',color:'#000',width:'100%',height:'100%',display:'flex',alignItems:'center',justifyContent:'center',background:'#fff'}); av.appendChild(init); }

    const nameBox=document.createElement('div'); Object.assign(nameBox.style,{display:'flex',flexDirection:'column',lineHeight:'1.1'});
    const name=document.createElement('div'); name.textContent=p.name; Object.assign(name.style,{fontWeight:'700',color:'rgba(255,255,255,0.95)'});
    nameBox.appendChild(name);
    if (p.username){ const u=document.createElement('div'); u.textContent='@'+p.username; Object.assign(u.style,{fontSize:'12px',color:'rgba(255,255,255,0.55)'}); nameBox.appendChild(u); }

    const score=document.createElement('div'); score.textContent=`${p.coins} SOLX`; Object.assign(score.style,{fontWeight:'800',color:'rgba(255,255,255,0.95)'});

    left.appendChild(rank); left.appendChild(av); left.appendChild(nameBox);
    row.appendChild(left); row.appendChild(score);
    list.appendChild(row);
  });
}

/* ------ Earn (referrals UI placeholders) ------ */
function renderEarn(){
  if (!dom.invitedCount || !dom.earnFriendsList || !dom.inviteTopList) return;

  const invited = JSON.parse(localStorage.getItem('sc_invited_friends') || '[]');
  dom.invitedCount.textContent = invited.length;

  const list = dom.earnFriendsList;
  list.innerHTML = '';
  if (!invited.length){
    list.innerHTML = '<div class="muted">No friends yet — share your link!</div>';
  } else {
    invited.forEach((f)=>{
      const row=document.createElement('div');
      Object.assign(row.style,{display:'flex',alignItems:'center',gap:'10px',padding:'8px 10px',borderRadius:'12px',background:'rgba(255,255,255,0.04)'});
      const av=document.createElement('div'); Object.assign(av.style,{width:'32px',height:'32px',borderRadius:'50%',overflow:'hidden',display:'flex',alignItems:'center',justifyContent:'center',background:'linear-gradient(90deg,#9945FF,#0ABDE3)'});
      if (f.photo_url){ const img=new Image(); img.src=f.photo_url; img.width=32; img.height=32; img.style.objectFit='cover'; img.referrerPolicy='no-referrer'; av.appendChild(img); }
      else { const init=document.createElement('div'); init.textContent=(f.name||'F').charAt(0).toUpperCase(); Object.assign(init.style,{fontWeight:'800',fontSize:'12px',color:'#000',width:'100%',height:'100%',display:'flex',alignItems:'center',justifyContent:'center',background:'#fff'}); av.appendChild(init); }
      const name=document.createElement('div'); name.textContent = f.username ? `${f.name||'Friend'} (@${f.username})` : (f.name||'Friend');
      name.style.fontWeight='700';
      row.appendChild(av); row.appendChild(name);
      list.appendChild(row);
    });
  }

  const top = JSON.parse(localStorage.getItem('sc_invite_global') || '[]');
  const topList = dom.inviteTopList;
  topList.innerHTML = '';
  if (!top.length){
    topList.innerHTML = '<div class="muted">No data yet.</div>';
  } else {
    top.sort((a,b)=>b.invites-a.invites);
    top.slice(0,100).forEach((p,i)=>{
      const row=document.createElement('div');
      Object.assign(row.style,{display:'flex',alignItems:'center',justifyContent:'space-between',gap:'10px',padding:'8px 10px',borderRadius:'12px',background:'rgba(255,255,255,0.04)'});
      const left=document.createElement('div'); Object.assign(left.style,{display:'flex',alignItems:'center',gap:'10px'});
      const rank=document.createElement('div'); rank.textContent=String(i+1); Object.assign(rank.style,{width:'24px',textAlign:'center',fontWeight:'800',color:i===0?'#14F195':'rgba(255,255,255,0.9)'});
      const av=document.createElement('div'); Object.assign(av.style,{width:'28px',height:'28px',borderRadius:'50%',overflow:'hidden',display:'flex',alignItems:'center',justify-content:'center',background:'linear-gradient(90deg,#9945FF,#0ABDE3)'});
      if (p.photo_url){ const img=new Image(); img.src=p.photo_url; img.width=28; img.height=28; img.style.objectFit='cover'; img.referrerPolicy='no-referrer'; av.appendChild(img); }
      else { const init=document.createElement('div'); init.textContent=(p.name||'U').charAt(0).toUpperCase(); Object.assign(init.style,{fontWeight:'800',fontSize:'12px',color:'#000',width:'100%',height:'100%',display:'flex',alignItems:'center',justify-content:'center',background:'#fff'}); av.appendChild(init); }
      const name=document.createElement('div'); name.textContent = p.username ? `${p.name||'User'} (@${p.username})` : (p.name||'User');
      name.style.fontWeight='700';
      const invites=document.createElement('div'); invites.textContent = `${p.invites} invited`; invites.style.fontWeight='800';
      left.appendChild(rank); left.appendChild(av); left.appendChild(name);
      row.appendChild(left); row.appendChild(invites);
      topList.appendChild(row);
    });
  }
}

/* ------ Physics loop (no remap) ------ */
let lastTime = null;
function step(now){
  if (!lastTime) lastTime = now;
  const dt = Math.min(0.032, (now - lastTime) / 1000);
  lastTime = now;

  const W = canvas.clientWidth, H = canvas.clientHeight, centerX = W*0.5;

  for (let i = ballsInFlight.length-1; i >= 0; i--){
    const b = ballsInFlight[i];
    if (!b.alive){ ballsInFlight.splice(i,1); continue; }

    const yNorm = Math.min(1, Math.max(0, (b.y / (H || 1))));
    const centerPull = centerBias * (0.6 + 0.9 * yNorm);
    const axCenter = (centerX - b.x) * centerPull * 0.001;
    b.vx += axCenter * dt;

    b.vy += gravity * dt;
    b.vx *= Math.pow(friction, dt*60);
    b.vy *= Math.pow(friction, dt*60);

    b.x += b.vx * dt; b.y += b.vy * dt;

    if (b.x - b.r < 4){
      b.x = 4 + b.r;
      b.vx = Math.abs(b.vx) * (restitution * 0.6);
    }
    if (b.x + b.r > W - 4){
      b.x = W - 4 - b.r;
      b.vx = -Math.abs(b.vx) * (restitution * 0.6);
    }

    for (const obs of obstacles){
      if (collidingCircleCircle(b, obs)) resolveCircleCollision(b, obs);
    }

    const binsTop = bins.length ? bins[0].y : (H - 80);
    if (b.y + b.r >= binsTop){
      const firstLeft = bins[0].x;
      const lastRight = bins[bins.length-1].x + bins[bins.length-1].w;
      const span = lastRight - firstLeft;
      let relX = (b.x - firstLeft) / span; relX = Math.max(0, Math.min(0.9999, relX));
      let idx = Math.floor(relX * binsCount);
      idx = Math.max(0, Math.min(binsCount-1, idx));

      const finalIdx = idx; // physics decides
      const reward = payouts[finalIdx] || 0;

      // mark bin hit for animation
      bins[finalIdx]._hitAt = performance.now();

      coins += reward;
      playLandSound(reward >= 50);
      if (reward === 100) startConfetti();
      spawnFloatingReward(b.x, binsTop - 18, `+${reward}`);
      ballsInFlight.splice(i,1);
      updateUI();
    }
  }

  render();
  requestAnimationFrame(step);
}

/* Floating reward pop */
function spawnFloatingReward(x,y,text){
  const el = document.createElement('div');
  el.textContent = text;
  Object.assign(el.style,{
    position:'fixed',
    left:(canvas.getBoundingClientRect().left + x - 20)+'px',
    top:(canvas.getBoundingClientRect().top + y - 10)+'px',
    padding:'6px 8px',
    background:'linear-gradient(90deg,#14F195,#0ABDE3)',
    color:'#000', fontWeight:'800', borderRadius:'8px',
    pointerEvents:'none', zIndex:9999, transform:'translateY(0)', opacity:'1'
  });
  document.body.appendChild(el);
  requestAnimationFrame(()=>{ el.style.transition='transform 900ms ease-out, opacity 900ms'; el.style.transform='translateY(-48px)'; el.style.opacity='0'; });
  setTimeout(()=> el.remove(), 950);
}

/* ------ Gameplay (Nuke aware) ------ */
function dropBall(){
  if (balls <= 0){ showToast('No balls left — wait for regen'); return; }
  const W = canvas.clientWidth;
  const drops = isNuke() ? 10 : 1;
  const canDrop = Math.min(drops, balls);
  balls -= canDrop;
  updateUI();
  for (let i=0;i<canDrop;i++){
    const startX = W * 0.5 + (Math.random() - 0.5) * 8;
    const startY = Math.max(18, canvas.clientHeight * 0.03);
    const initVx = (Math.random() - 0.5) * 12;
    const initVy = 28 + Math.random() * 26;
    ballsInFlight.push({ x:startX, y:startY, vx:initVx, vy:initVy, r:ballRadius, alive:true });
  }
}

/* ------ Boosts UI ------ */
function msToHMS(ms){ const s=Math.max(0,Math.floor(ms/1000)); const h=Math.floor(s/3600), m=Math.floor((s%3600)/60), ss=s%60; return `${h}h ${m}m ${ss}s`; }

function renderBoosts(){
  const wrap = dom.boostList || document.getElementById('boostList'); if (!wrap) return;
  wrap.innerHTML = '';
  const cards = [
    { key:'speedster', title:'⚡️ Speedster', desc:'Balls regenerate 2× faster for 24 hours.', cost:500, active:isSpeedster(), expiresAt:boosts.speedsterUntil||0, action: buySpeedster },
    { key:'maxi', title:'☄️ Maxi', desc:'Max balls increases to 500/500 for 24 hours.', cost:5000, active:isMaxi(), expiresAt:boosts.maxiUntil||0, action: buyMaxi },
    { key:'spender', title:'🪙 Spender', desc:'Purchase 100 ball drops instantly.', cost:2500, active:false, expiresAt:0, action: buySpender },
    { key:'nuke', title:'💥 Nuke', desc:'Drop 10 balls per tap for 24 hours.', cost:500, active:isNuke(), expiresAt:boosts.nukeUntil||0, action: buyNuke }
  ];
  cards.forEach(card=>{
    const C = document.createElement('div');
    Object.assign(C.style,{background:'rgba(255,255,255,0.05)',border:'1px solid rgba(255,255,255,0.06)',borderRadius:'16px',padding:'14px',display:'flex',flexDirection:'column',gap:'8px',alignItems:'center',textAlign:'center'});
    const T = document.createElement('div'); T.textContent = card.title; Object.assign(T.style,{fontWeight:'800',color:'rgba(255,255,255,0.95)',textShadow:'0 0 2px #000, 0 0 2px #000'});
    const D = document.createElement('div'); D.textContent = card.desc; Object.assign(D.style,{color:'rgba(255,255,255,0.8)',fontSize:'13px'});
    const status = document.createElement('div'); status.style.fontWeight='700'; status.style.fontSize='12px'; status.style.color=card.active?'#14F195':'rgba(255,255,255,0.55)';
    status.textContent = card.active ? `Active • ${msToHMS((card.expiresAt||0)-Date.now())} left` : `Cost: ${card.cost} SOLX`;
    const btn = document.createElement('button'); btn.textContent = card.active ? 'Active' : 'Buy'; btn.disabled = card.active || coins < card.cost; stylePrimary(btn); btn.style.minWidth='140px';
    btn.addEventListener('click', ()=>{ if (!btn.disabled) card.action(card.cost); });
    C.appendChild(T); C.appendChild(D); C.appendChild(status); C.appendChild(btn);
    wrap.appendChild(C);
  });
  if (!renderBoosts._timer){
    renderBoosts._timer = setInterval(()=>{ if (document.getElementById('screen-boost')?.classList.contains('active')) renderBoosts(); }, 1000);
  }
}

function buySpeedster(cost){ if (coins < cost) return; coins -= cost; boosts.speedsterUntil = Date.now() + 24*3600*1000; updateUI(); showToast('⚡️ Speedster 24h active'); }
function buyMaxi(cost){ if (coins < cost) return; coins -= cost; boosts.maxiUntil = Date.now() + 24*3600*1000; if (balls > maxBalls()) balls = maxBalls(); updateUI(); showToast('☄️ Maxi 24h active'); }
function buySpender(cost){ if (coins < cost) return; coins -= cost; balls = Math.min(maxBalls(), balls + 100); updateUI(); showToast('🪙 +100 balls'); }
function buyNuke(cost){ if (coins < cost) return; coins -= cost; boosts.nukeUntil = Date.now() + 24*3600*1000; updateUI(); showToast('💥 Nuke 24h active'); }

/* ------ Regen ------ */
function startRegen(){
  if (balls > maxBalls()) balls = maxBalls();
  const now = Date.now();
  const elapsed = Math.floor((now - lastRegen)/1000);
  const stepSecs = regenSeconds();

  if (elapsed >= stepSecs){
    const add = Math.floor(elapsed / stepSecs);
    balls = Math.min(maxBalls(), balls + add);
    lastRegen = lastRegen + add * stepSecs * 1000;
    if (balls >= maxBalls()) lastRegen = Date.now();
    updateUI();
  }
  if (regenCountdownInterval) clearInterval(regenCountdownInterval);
  regenCountdownInterval = setInterval(()=>{
    const secs = Math.max(0, Math.floor(regenSeconds() - (Date.now() - lastRegen)/1000));
    if (dom.regenTimer) dom.regenTimer.textContent = `${secs}s`;
  }, 1000);

  if (regenInterval) clearInterval(regenInterval);
  regenInterval = setInterval(()=>{
    if (balls < maxBalls()) { balls += 1; lastRegen = Date.now(); updateUI(); }
    else lastRegen = Date.now();
  }, regenSeconds() * 1000);
}

/* ------ Modal (not used now) & Nav ------ */
function showModal(html){
  // Fallback mini modal in case you still have it in DOM from earlier versions
  let modal = dom.modal;
  if (!modal){
    const m = document.createElement('div');
    m.id='modal';
    m.style.position='fixed'; m.style.inset='0'; m.style.display='grid'; m.style.placeItems='center';
    m.style.background='rgba(0,0,0,0.5)'; m.style.zIndex='10001';
    const card = document.createElement('div'); card.style.background='rgba(18,18,26,0.9)'; card.style.border='1px solid rgba(255,255,255,0.12)'; card.style.borderRadius='16px'; card.style.padding='16px'; card.style.color='#fff';
    card.innerHTML = html;
    m.appendChild(card);
    document.body.appendChild(m);
    setTimeout(()=> m.remove(), 1400);
  } else {
    dom.modalContent.innerHTML = html; modal.classList.remove('hidden');
  }
}
function hideModal(){ dom.modal?.classList.add('hidden'); }

function showScreen(k){
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById('screen-'+k)?.classList.add('active');
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  const active = Array.from(document.querySelectorAll('.nav-btn')).find(b => b.dataset.target === k);
  if (active) active.classList.add('active');

  if (k==='leaderboard') renderLeaderboard();
  if (k==='boost') renderBoosts();
  if (k==='earn') renderEarn();
}

/* ------ Theme / Buttons ------ */
function stylePrimary(btn){
  if (!btn) return;
  btn.style.background='linear-gradient(90deg,#9945FF,#0ABDE3)';
  btn.style.border='none';
  btn.style.borderRadius='16px';
  btn.style.padding='16px 24px';
  btn.style.fontWeight='800';
  btn.style.fontSize='16px';
  btn.style.color='#fff';
  btn.style.cursor='pointer';
  btn.style.textShadow='0 0 2px #000, 0 0 2px #000';
}

/* ------ Buy Drops bottom sheet ------ */
function openSheet(){ dom.buySheet?.classList.add('open'); }
function closeSheet(){ dom.buySheet?.classList.remove('open'); }
window.appBuyDrops = function(qty){
  // Hook into Stars/checkout later; for now just demo
  const cost = Math.ceil(qty / 2); // placeholder price logic
  showToast(`Pretend purchased ${qty} drops for ${cost} SOLX`);
  balls = Math.min(maxBalls(), balls + qty);
  updateUI();
  closeSheet();
};

/* ------ Events & Init ------ */
dom.copyRef && dom.copyRef.addEventListener('click', async ()=>{
  if (!dom.refLink) return;
  try{ await navigator.clipboard.writeText(dom.refLink.value); showToast('Link copied ✅'); }
  catch(e){ showToast('Copy failed'); }
});
dom.closeModalBtn && dom.closeModalBtn.addEventListener('click', hideModal);
document.getElementById('dropBtn')?.addEventListener('click', dropBall);
document.querySelectorAll('.nav-btn').forEach(b => b.addEventListener('click', ()=> showScreen(b.dataset.target)));
dom.buyDropsBtn && dom.buyDropsBtn.addEventListener('click', openSheet);
dom.sheetClose && dom.sheetClose.addEventListener('click', closeSheet);

let loopStarted = false;
function init(){
  fitCanvas();
  buildObstaclesAndBins();
  setReferralLink();
  handleReferralOnOpen();
  if (balls > maxBalls()) balls = maxBalls();
  updateUI();
  renderLeaderboard();
  renderBoosts();
  renderEarn();
  startRegen();
  if (!loopStarted){ loopStarted = true; requestAnimationFrame(step); }
}
window.addEventListener('resize', ()=>{ fitCanvas(); buildObstaclesAndBins(); });
init();
