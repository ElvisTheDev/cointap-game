/* app.js — prize boxes bigger & closer; UI tightened; menu emojis supported */

const payouts = [500,100,50,20,5,1,1,5,20,50,100,500];
const binsCount = payouts.length;

const BASE_MAX_BALLS = 100;
const BOOST_MAXI_BALLS = 500;

const ballRadius = 4;
const obstacleRadius = 4;
const gravity = 1200;
const restitution = 0.72;
const friction = 0.995;

const BASE_REGEN_SECONDS = 60;
const SPEEDSTER_MULTIPLIER = 0.5;

const centerBias = 6.4;
const EDGE_ACCEPT_PROB = 0.001;

const obstacleRows = [3,4,5,6,7,8,9,10,11,12,13,14];

const TELEGRAM = window.Telegram && window.Telegram.WebApp ? window.Telegram.WebApp : null;
if (TELEGRAM) { try { TELEGRAM.ready(); } catch(e) {} }

const canvas = document.getElementById('plinkoCanvas');
const ctx = canvas.getContext('2d');

const dom = {
  ballsCount: document.getElementById('ballsCount'),
  ballsMax: document.getElementById('ballsMax'),
  regenTimer: document.getElementById('regenTimer'),
  dropBtn: document.getElementById('dropBtn'),
  coinsCount: document.getElementById('coinsCount'),
  balance: document.getElementById('balance'),
  leaderboardList: document.getElementById('leaderboardList'),
  modal: document.getElementById('modal'),
  modalContent: document.getElementById('modalContent'),
  closeModalBtn: document.getElementById('closeModal'),
  boostList: document.getElementById('boostList')
};

function getTelegramUser() {
  const u = (TELEGRAM && TELEGRAM.initDataUnsafe && TELEGRAM.initDataUnsafe.user) || null;
  return {
    id: u?.id ? String(u.id) : 'local_' + Math.floor(Math.random() * 999999),
    first_name: u?.first_name || 'Player',
    username: u?.username || '',
    photo_url: u?.photo_url || ''
  };
}
const tgUser = getTelegramUser();

let coins = Number(localStorage.getItem('sc_coins') || 0);
let balls = Number(localStorage.getItem('sc_balls') || BASE_MAX_BALLS);
if (isNaN(balls)) balls = BASE_MAX_BALLS;
let lastRegen = Number(localStorage.getItem('sc_lastRegen') || Date.now());
let regenInterval = null, regenCountdownInterval = null;

let obstacles = [];
let bins = [];
let ballsInFlight = [];
let confettiParticles = [];

let boosts = JSON.parse(localStorage.getItem('sc_boosts') || '{}');
if (!boosts || typeof boosts !== 'object') boosts = {};
function isSpeedsterActive(){ return (boosts.speedsterUntil || 0) > Date.now(); }
function isMaxiActive(){ return (boosts.maxiUntil || 0) > Date.now(); }
function effectiveRegenSeconds(){ return isSpeedsterActive() ? BASE_REGEN_SECONDS * SPEEDSTER_MULTIPLIER : BASE_REGEN_SECONDS; }
function effectiveMaxBalls(){ return isMaxiActive() ? BOOST_MAXI_BALLS : BASE_MAX_BALLS; }
function saveBoosts(){ localStorage.setItem('sc_boosts', JSON.stringify(boosts)); }

const AudioCtx = window.AudioContext || window.webkitAudioContext;
let audioCtx = null;
function ensureAudio(){ if (!audioCtx) audioCtx = new AudioCtx(); }
function playHitSound(){ try{ ensureAudio(); const t=audioCtx.currentTime, o=audioCtx.createOscillator(), g=audioCtx.createGain(); o.type='square'; o.frequency.setValueAtTime(880+Math.random()*80,t); g.gain.setValueAtTime(0.0001,t); g.gain.exponentialRampToValueAtTime(0.04,t+0.004); g.gain.exponentialRampToValueAtTime(0.0001,t+0.12); o.connect(g); g.connect(audioCtx.destination); o.start(t); o.stop(t+0.14);}catch(e){}}
function playLandSound(big=false){ try{ ensureAudio(); const t=audioCtx.currentTime, o=audioCtx.createOscillator(), g=audioCtx.createGain(); o.type='sine'; o.frequency.setValueAtTime(big?220:440,t); g.gain.setValueAtTime(0.0001,t); g.gain.exponentialRampToValueAtTime(big?0.09:0.035,t+0.008); g.gain.exponentialRampToValueAtTime(0.0001,t+(big?0.7:0.22)); o.connect(g); g.connect(audioCtx.destination); o.start(t); o.stop(t+(big?0.72:0.24)); }catch(e){}}

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
  if (dom.coinsCount) dom.coinsCount.textContent = `${coins} SOLX`;
  if (dom.balance) dom.balance.textContent = `${coins} SOLX`;
  if (dom.ballsCount) dom.ballsCount.textContent = `${balls}`;
  if (dom.ballsMax) dom.ballsMax.textContent = `${effectiveMaxBalls()}`;
  saveState(); saveScoreLocal(); saveBoosts();
  renderBoosts();
}

/* ---------- sizing to avoid scroll ---------- */
function fitCanvas(){
  const navH = 72; // match CSS var
  const headerH = 56;
  const appH = window.innerHeight - navH - 10 - 20; // 10px menu lift + padding guard
  const statsH = 72;
  const actionsH = 80; // slightly tighter so actions sit higher
  const canvasAvail = Math.max(260, appH - headerH - statsH - actionsH);

  const cssWidth = Math.min(window.innerWidth * 0.92, 940);
  const cssHeight = Math.min(canvasAvail, 520);

  canvas.style.width = cssWidth + 'px';
  canvas.style.height = cssHeight + 'px';
  const ratio = window.devicePixelRatio || 1;
  canvas.width = Math.round(cssWidth * ratio);
  canvas.height = Math.round(cssHeight * ratio);
  ctx.setTransform(ratio,0,0,ratio,0,0);
}

/* ======== obstacles & bins (bigger, closer) ======== */
function buildObstaclesAndBins(){
  obstacles = [];
  bins = [];

  const W = canvas.clientWidth;
  const H = canvas.clientHeight;

  const topPadding = Math.max(12, H * 0.03);
  const bottomReserve = Math.max(78, H * 0.18); // slightly tighter footer band
  const usableH = H - topPadding - bottomReserve;

  const widestCount = Math.max(...obstacleRows);
  const sideMargin = Math.max(0.06 * W, 18);
  const availableWidth = W - sideMargin * 2;
  const baseSpacing = availableWidth / (widestCount + 1);
  const rowsCount = obstacleRows.length;
  const vSpacing = usableH / (rowsCount + 1);

  let lastPegY = topPadding;
  for (let r = 0; r < rowsCount; r++){
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

  // Original bins top (aligned near bottom band)
  const baseBinsTop = H - bottomReserve + 10;

  // Move bins ~70% closer to the last peg row:
  // newTop = lastPegY + 0.3 * (baseTop - lastPegY)  (i.e., compress the gap by 70%)
  const binsTop = lastPegY + 0.3 * (baseBinsTop - lastPegY);

  // Bigger, squarer bins:
  const minGap = 2;
  const maxBoxFromHeight = Math.max(24, (H - binsTop) - 14);  // ensure fits below computed top
  const maxBoxFromWidth  = (availableWidth - minGap*(binsCount - 1)) / binsCount;
  const vwTarget = Math.max(26, Math.min(42, Math.floor(window.innerWidth * 0.07))); // ~7vw, clamped wider
  const boxSize = Math.max(24, Math.min(vwTarget, maxBoxFromWidth, maxBoxFromHeight));

  const totalRowWidth = boxSize * binsCount + minGap * (binsCount - 1);
  const binsLeft = (W - totalRowWidth) / 2;

  for (let i = 0; i < binsCount; i++){
    const x = binsLeft + i * (boxSize + minGap);
    const y = binsTop; // top-aligned to our raised top
    bins.push({ x, y, w: boxSize, h: boxSize, i });
  }
}

function collidingCircleCircle(a, b){
  const dx = a.x - b.x, dy = a.y - b.y;
  const dist2 = dx*dx + dy*dy;
  const minR = (a.r + b.r);
  return dist2 < (minR * minR);
}
function resolveCircleCollision(ball, obs){
  let nx = ball.x - obs.x, ny = ball.y - obs.y;
  const dist = Math.hypot(nx, ny) || 0.0001;
  nx /= dist; ny /= dist;
  const overlap = (ball.r + obs.r) - dist;
  ball.x += nx * (overlap + 0.5);
  ball.y += ny * (overlap + 0.5);
  const vdotn = ball.vx * nx + ball.vy * ny;
  ball.vx = ball.vx - 2 * vdotn * nx;
  ball.vy = ball.vy - 2 * vdotn * ny;
  ball.vx *= restitution;
  ball.vy *= restitution;
  ball.vx += (Math.random() - 0.5) * 8;
  playHitSound();
}

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
  for (let o of obstacles){
    ctx.beginPath();
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    ctx.arc(o.x, o.y, o.r, 0, Math.PI*2);
    ctx.fill();
  }

  // bins (rounded, gradient border, glow on 500)
  for (let i = 0; i < bins.length; i++){
    const b = bins[i];

    const gradStroke = ctx.createLinearGradient(b.x, b.y, b.x + b.w, b.y + b.h);
    gradStroke.addColorStop(0, '#9945FF');
    gradStroke.addColorStop(1, '#0ABDE3');

    if (payouts[i] === 500){
      ctx.save();
      ctx.shadowColor = 'rgba(153,69,255,0.28)';
      ctx.shadowBlur = 20;
      ctx.fillStyle = 'rgba(255,255,255,0.05)';
      drawRoundedRect(b.x, b.y, b.w, b.h, 10);
      ctx.fill();
      ctx.restore();
    } else {
      ctx.fillStyle = 'rgba(255,255,255,0.035)';
      drawRoundedRect(b.x, b.y, b.w, b.h, 10);
      ctx.fill();
    }

    ctx.lineWidth = 1;
    ctx.strokeStyle = gradStroke;
    drawRoundedRect(b.x + 0.5, b.y + 0.5, b.w - 1, b.h - 1, 10);
    ctx.stroke();

    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    const labelSize = Math.max(11, Math.min(14, Math.floor(b.w * 0.34))); // scale with bigger boxes
    ctx.font = `700 ${labelSize}px Inter, system-ui`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(payouts[i]), b.x + b.w/2, b.y + b.h/2);
  }

  // balls with glow
  for (let b of ballsInFlight){
    const glowR = Math.max(b.r * 4.5, 18);
    const grad = ctx.createRadialGradient(b.x, b.y, b.r*0.2, b.x, b.y, glowR);
    grad.addColorStop(0, 'rgba(153,69,255,0.95)');
    grad.addColorStop(0.35, 'rgba(153,69,255,0.55)');
    grad.addColorStop(0.65, 'rgba(10,189,227,0.45)');
    grad.addColorStop(1, 'rgba(10,189,227,0)');
    ctx.beginPath(); ctx.fillStyle = grad; ctx.arc(b.x, b.y, glowR, 0, Math.PI*2); ctx.fill();

    ctx.beginPath(); ctx.fillStyle = 'rgba(0,0,0,0.20)';
    ctx.arc(b.x + 2, b.y + 3, b.r + 1.8, 0, Math.PI*2); ctx.fill();

    ctx.beginPath(); ctx.fillStyle = '#ffffff';
    ctx.arc(b.x, b.y, b.r, 0, Math.PI*2); ctx.fill();
  }
}

/* ================= Confetti ================= */
function startConfetti() {
  const W = canvas.getBoundingClientRect().width;
  const count = 140;
  for (let i = 0; i < count; i++) {
    const p = {
      x: canvas.getBoundingClientRect().left + Math.random() * W,
      y: canvas.getBoundingClientRect().top + Math.random() * 40,
      vx: (Math.random() - 0.5) * 600,
      vy: 200 + Math.random() * 380,
      size: 6 + Math.random() * 8,
      life: 1300 + Math.random() * 1400,
      color: (Math.random() < 0.5) ? '#9945FF' : '#14F195',
      born: performance.now()
    };
    confettiParticles.push(p);
  }
  requestAnimationFrame(drawConfetti);
}
function drawConfetti(now){
  let overlay = document.getElementById('confettiOverlay');
  if (!overlay) {
    overlay = document.createElement('canvas');
    overlay.id = 'confettiOverlay';
    overlay.style.position = 'fixed';
    overlay.style.left = '0'; overlay.style.top = '0';
    overlay.style.pointerEvents = 'none'; overlay.style.zIndex = 9998;
    document.body.appendChild(overlay);
  }
  const ratio = window.devicePixelRatio || 1;
  overlay.width = window.innerWidth * ratio;
  overlay.height = window.innerHeight * ratio;
  overlay.style.width = window.innerWidth + 'px';
  overlay.style.height = window.innerHeight + 'px';
  const octx = overlay.getContext('2d');
  octx.setTransform(ratio,0,0,ratio,0,0);
  octx.clearRect(0,0,window.innerWidth,window.innerHeight);

  confettiParticles = confettiParticles.filter(p => (now - p.born) < p.life);
  for (let p of confettiParticles) {
    p.x += p.vx * (1/60);
    p.y += p.vy * (1/60);
    p.vy += 900 * (1/60);
    octx.fillStyle = p.color;
    octx.fillRect(p.x, p.y, p.size, p.size * 0.6);
  }
  if (confettiParticles.length > 0) requestAnimationFrame(drawConfetti);
  else setTimeout(()=> { const el = document.getElementById('confettiOverlay'); if (el) el.remove(); }, 600);
}

/* ----- Leaderboard (avatar + username) ----- */
function getInitials(name){ const parts=(name||'').trim().split(/\s+/); return ((parts[0]||'').charAt(0)+(parts[1]||'').charAt(0)).toUpperCase()||'P'; }
function renderLeaderboard(){
  const list = document.getElementById('leaderboardList');
  if (!list) return;
  const obj = JSON.parse(localStorage.getItem('sc_scores') || '{}');
  const arr = Object.keys(obj).map(k => ({ id:k, name:obj[k].name||'Player', username:obj[k].username||'', avatarUrl:obj[k].avatarUrl||'', coins:obj[k].coins||0 }));
  arr.sort((a,b)=>b.coins-a.coins);

  list.innerHTML='';
  if (!arr.length){ list.innerHTML='<div class="muted">No scores yet — be the first!</div>'; return; }

  arr.slice(0,20).forEach((p,i)=>{
    const row=document.createElement('div');
    row.style.display='flex'; row.style.alignItems='center'; row.style.justifyContent='space-between';
    row.style.gap='10px'; row.style.padding='8px 10px'; row.style.borderRadius='12px';
    row.style.background='rgba(255,255,255,0.04)'; row.style.marginBottom='6px';

    const left=document.createElement('div'); left.style.display='flex'; left.style.alignItems='center'; left.style.gap='10px';

    const rank=document.createElement('div'); rank.textContent=String(i+1); rank.style.width='28px';
    rank.style.textAlign='center'; rank.style.fontWeight='800';
    rank.style.color=i===0?'#14F195':'rgba(255,255,255,0.9)';

    const avatar=document.createElement('div'); Object.assign(avatar.style,{width:'36px',height:'36px',borderRadius:'50%',overflow:'hidden',display:'flex',alignItems:'center',justifyContent:'center',background:'linear-gradient(90deg,#9945FF,#0ABDE3)'});
    if (p.avatarUrl){ const img=new Image(); img.src=p.avatarUrl; img.alt=p.name; img.width=36; img.height=36; img.style.objectFit='cover'; img.referrerPolicy='no-referrer'; avatar.appendChild(img); }
    else { const init=document.createElement('div'); init.textContent=getInitials(p.name); Object.assign(init.style,{fontWeight:'800',fontSize:'14px',color:'#000',width:'100%',height:'100%',display:'flex',alignItems:'center',justifyContent:'center',background:'#fff'}); avatar.appendChild(init); }

    const nameBlock=document.createElement('div'); nameBlock.style.display='flex'; nameBlock.style.flexDirection='column'; nameBlock.style.lineHeight='1.1';
    const name=document.createElement('div'); name.textContent=p.name; name.style.fontWeight='700'; name.style.color='rgba(255,255,255,0.95)';
    nameBlock.appendChild(name);
    if (p.username){ const u=document.createElement('div'); u.textContent='@'+p.username; u.style.fontSize='12px'; u.style.color='rgba(255,255,255,0.55)'; nameBlock.appendChild(u); }

    const score=document.createElement('div'); score.textContent=`${p.coins} SOLX`; score.style.fontWeight='800'; score.style.color='rgba(255,255,255,0.95)';

    left.appendChild(rank); left.appendChild(avatar); left.appendChild(nameBlock);
    row.appendChild(left); row.appendChild(score);
    list.appendChild(row);
  });
}

/* ---------------- Physics ---------------- */
let lastTime = null;
function step(now){
  if (!lastTime) lastTime = now;
  const dt = Math.min(0.032, (now - lastTime) / 1000);
  lastTime = now;

  const W = canvas.clientWidth, H = canvas.clientHeight, centerX = W * 0.5;

  for (let bi = ballsInFlight.length - 1; bi >= 0; bi--){
    const b = ballsInFlight[bi];
    if (!b.alive){ ballsInFlight.splice(bi,1); continue; }

    const axCenter = (centerX - b.x) * centerBias * 0.001;
    b.vx += axCenter * dt;

    b.vy += gravity * dt;
    b.vx *= Math.pow(friction, dt*60);
    b.vy *= Math.pow(friction, dt*60);

    b.x += b.vx * dt; b.y += b.vy * dt;

    if (b.x - b.r < 4){ b.x = 4 + b.r; b.vx = Math.abs(b.vx) * restitution; }
    if (b.x + b.r > W - 4){ b.x = W - 4 - b.r; b.vx = -Math.abs(b.vx) * restitution; }

    for (let oi = 0; oi < obstacles.length; oi++){
      const obs = obstacles[oi];
      if (collidingCircleCircle(b, obs)) resolveCircleCollision(b, obs);
    }

    const binsTop = bins.length ? bins[0].y : H - 80;
    if (b.y + b.r >= binsTop){
      // map x to bin index
      const firstLeft = bins[0].x;
      const lastRight = bins[bins.length-1].x + bins[bins.length-1].w;
      const span = lastRight - firstLeft;
      let relX = (b.x - firstLeft) / span; relX = Math.max(0, Math.min(0.9999, relX));
      let rawBinIndex = Math.floor(relX * binsCount);
      rawBinIndex = Math.max(0, Math.min(binsCount - 1, rawBinIndex));
      let finalBin = rawBinIndex;

      if (payouts[rawBinIndex] === 500) {
        if (Math.random() < EDGE_ACCEPT_PROB) finalBin = rawBinIndex;
        else { if (rawBinIndex === 0) finalBin = 1; else if (rawBinIndex === binsCount - 1) finalBin = binsCount - 2; }
      }

      const reward = payouts[finalBin] || 0;
      coins += reward;
      playLandSound(reward >= 100);
      if (reward === 500) startConfetti();
      spawnFloatingReward(b.x, binsTop - 18, `+${reward}`);
      ballsInFlight.splice(bi, 1);
      updateUI();
    }
  }

  render();
  requestAnimationFrame(step);
}

function spawnFloatingReward(x, y, text){
  const el = document.createElement('div');
  el.textContent = text;
  Object.assign(el.style, {
    position: 'fixed',
    left: (canvas.getBoundingClientRect().left + x - 20) + 'px',
    top: (canvas.getBoundingClientRect().top + y - 10) + 'px',
    padding: '6px 8px',
    background: 'linear-gradient(90deg,#14F195,#0ABDE3)',
    color: '#000', fontWeight: '800', borderRadius: '8px',
    pointerEvents: 'none', zIndex: 9999, transform: 'translateY(0)', opacity: '1',
  });
  document.body.appendChild(el);
  requestAnimationFrame(()=>{ el.style.transition='transform 900ms ease-out, opacity 900ms'; el.style.transform='translateY(-48px)'; el.style.opacity='0'; });
  setTimeout(()=> el.remove(), 950);
}

function dropBall(){
  if (balls <= 0){ showModal('<div style="font-weight:700">No balls left — wait for regen</div>'); return; }
  balls -= 1; updateUI();
  const W = canvas.clientWidth;
  const startX = W * 0.5 + (Math.random() - 0.5) * 18;
  const startY = Math.max(18, canvas.clientHeight * 0.04);
  const initVx = (Math.random() - 0.5) * 40;
  const initVy = 40 + Math.random() * 40;
  ballsInFlight.push({ x: startX, y: startY, vx: initVx, vy: initVy, r: ballRadius, alive: true });
}

/* ---------------- Boosts ---------------- */
function msToHMS(ms){ const s=Math.max(0,Math.floor(ms/1000)); const h=Math.floor(s/3600), m=Math.floor((s%3600)/60), ss=s%60; return `${h}h ${m}m ${ss}s`; }

function renderBoosts(){
  const wrap = dom.boostList || document.getElementById('boostList'); if (!wrap) return;
  wrap.innerHTML = '';
  const cards = [
    { key:'speedster', title:'⚡️ Speedster', desc:'Balls regenerate 2× faster for 24 hours.', cost:500, active:isSpeedsterActive(), expiresAt:boosts.speedsterUntil||0, action: buySpeedster },
    { key:'maxi', title:'☄️ Maxi', desc:'Max balls increases to 500/500 for 24 hours.', cost:5000, active:isMaxiActive(), expiresAt:boosts.maxiUntil||0, action: buyMaxi },
    { key:'spender', title:'🪙 Spender', desc:'Purchase 100 ball drops instantly.', cost:2500, active:false, expiresAt:0, action: buySpender }
  ];
  cards.forEach(card=>{
    const C = document.createElement('div'); Object.assign(C.style,{background:'rgba(255,255,255,0.05)',border:'1px solid rgba(255,255,255,0.06)',borderRadius:'16px',padding:'14px',display:'flex',flexDirection:'column',gap:'8px',alignItems:'center',textAlign:'center'});
    const T = document.createElement('div'); T.textContent = card.title; Object.assign(T.style,{fontWeight:'800',color:'rgba(255,255,255,0.95)',textShadow:'0 0 2px #000, 0 0 2px #000'});
    const D = document.createElement('div'); D.textContent = card.desc; Object.assign(D.style,{color:'rgba(255,255,255,0.8)',fontSize:'13px'});
    const status = document.createElement('div'); status.style.fontWeight='700'; status.style.fontSize='12px'; status.style.color=card.active?'#14F195':'rgba(255,255,255,0.55)'; status.textContent = card.active ? `Active • ${msToHMS((card.expiresAt||0)-Date.now())} left` : `Cost: ${card.cost} SOLX`;
    const btn = document.createElement('button'); btn.textContent = card.active ? 'Active' : 'Buy'; btn.disabled = card.active || coins < card.cost; stylePrimaryButton(btn); btn.style.minWidth='140px'; btn.addEventListener('click',()=>{ if(!btn.disabled) card.action(card.cost); });
    C.appendChild(T); C.appendChild(D); C.appendChild(status); C.appendChild(btn); wrap.appendChild(C);
  });
  if (!renderBoosts._timer){
    renderBoosts._timer = setInterval(()=>{ if (document.getElementById('screen-boost')?.classList.contains('active')) renderBoosts(); },1000);
  }
}

function buySpeedster(cost){ if (coins < cost) return; coins -= cost; boosts.speedsterUntil = Date.now() + 24*3600*1000; updateUI(); showModal('<div style="font-weight:800;font-size:16px">⚡️ Speedster activated for 24h!</div>'); }
function buyMaxi(cost){ if (coins < cost) return; coins -= cost; boosts.maxiUntil = Date.now() + 24*3600*1000; if (balls > effectiveMaxBalls()) balls = effectiveMaxBalls(); updateUI(); showModal('<div style="font-weight:800;font-size:16px">☄️ Maxi activated: Max 500 for 24h!</div>'); }
function buySpender(cost){ if (coins < cost) return; coins -= cost; balls = Math.min(effectiveMaxBalls(), balls + 100); updateUI(); showModal('<div style="font-weight:800;font-size:16px">🪙 +100 balls added!</div>'); }

/* ---------------- Regen ---------------- */
function startRegen(){
  if (balls > effectiveMaxBalls()) balls = effectiveMaxBalls();
  const now = Date.now();
  const elapsed = Math.floor((now - lastRegen) / 1000);
  const stepSecs = effectiveRegenSeconds();

  if (elapsed >= stepSecs){
    const add = Math.floor(elapsed / stepSecs);
    balls = Math.min(effectiveMaxBalls(), balls + add);
    lastRegen = lastRegen + add * stepSecs * 1000;
    if (balls >= effectiveMaxBalls()) lastRegen = Date.now();
    updateUI();
  }

  if (regenCountdownInterval) clearInterval(regenCountdownInterval);
  regenCountdownInterval = setInterval(() => {
    const secs = Math.max(0, Math.floor(effectiveRegenSeconds() - (Date.now() - lastRegen)/1000));
    if (dom.regenTimer) dom.regenTimer.textContent = `${secs}s`;
  }, 1000);

  if (regenInterval) clearInterval(regenInterval);
  regenInterval = setInterval(() => {
    if (balls < effectiveMaxBalls()) { balls += 1; lastRegen = Date.now(); updateUI(); }
    else lastRegen = Date.now();
  }, effectiveRegenSeconds() * 1000);
}

/* ---------------- Modal & Nav ---------------- */
function showModal(html){ if (!dom.modal) return; dom.modalContent.innerHTML = html; dom.modal.classList.remove('hidden'); }
function hideModal(){ dom.modal?.classList.add('hidden'); }

function showScreen(k){
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  const id = 'screen-' + k;
  document.getElementById(id)?.classList.add('active');
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  const active = Array.from(document.querySelectorAll('.nav-btn')).find(b => b.dataset.target === k);
  if (active) active.classList.add('active');
  if (k === 'leaderboard') renderLeaderboard();
  if (k === 'boost') renderBoosts();
}

/* ---------------- Theme ---------------- */
function initTheme(){
  Object.assign(document.body.style, {
    background: 'radial-gradient(1200px 700px at 80% -10%, rgba(20,241,149,0.12), rgba(0,0,0,0)),'+
                'radial-gradient(900px 500px at 0% 120%, rgba(153,69,255,0.14), rgba(0,0,0,0)),'+
                'linear-gradient(180deg, #0b0b12 0%, #05060a 100%)',
    backgroundAttachment: 'fixed',
    color: 'rgba(255,255,255,0.95)'
  });
  stylePrimaryButton(dom.dropBtn);
}

function stylePrimaryButton(btn){
  if (!btn) return;
  btn.style.background = 'linear-gradient(90deg,#9945FF,#0ABDE3)';
  btn.style.border = 'none';
  btn.style.borderRadius = '16px';
  btn.style.padding = '16px 24px';
  btn.style.fontWeight = '800';
  btn.style.fontSize = '16px';
  btn.style.color = '#fff';
  btn.style.cursor = 'pointer';
  btn.style.textShadow = '0 0 2px #000, 0 0 2px #000';
}

/* ---------------- Events ---------------- */
document.getElementById('dropBtn')?.addEventListener('click', dropBall);
document.getElementById('copyRef')?.addEventListener('click', async ()=> {
  const inp = document.getElementById('refLink');
  try { await navigator.clipboard.writeText(inp.value); showModal('<div style="font-weight:700">Link copied ✅</div>'); }
  catch(e){ showModal('<div style="font-weight:700">Copy failed — select manually</div>'); }
});
dom.closeModalBtn && dom.closeModalBtn.addEventListener('click', hideModal);
document.querySelectorAll('.nav-btn').forEach(b => b.addEventListener('click', ()=> showScreen(b.dataset.target)));

/* ---------------- INIT ---------------- */
let loopStarted = false;
function init(){
  initTheme();
  fitCanvas();
  buildObstaclesAndBins();
  if (balls > effectiveMaxBalls()) balls = effectiveMaxBalls();
  updateUI();
  renderLeaderboard();
  renderBoosts();
  startRegen();
  if (!loopStarted) { loopStarted = true; requestAnimationFrame(step); }
}
window.addEventListener('resize', ()=> { fitCanvas(); buildObstaclesAndBins(); });
init();
