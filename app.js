/* app.js - Updated: smaller pegs, 500-coin end bins, center bias for center-heavy distribution,
   Solana glow on balls, WebAudio sounds for collisions/land, confetti on 500-coin hit.
   Keep index.html and style.css as before (canvas id = plinkoCanvas, etc.) */

////////////////////
// CONFIG
////////////////////
const payouts = [500,100,50,20,5,1,1,5,20,50,100,500]; // 12 bins
const binsCount = payouts.length;

const ballRadius = 4;            // px (unchanged)
const obstacleRadius = Math.max(2, Math.round(6 * 0.7)); // 6 previously, reduced by another 30% => 4.2 -> round 4
// (set to 4)
const gravity = 1200;           // px/s^2
const restitution = 0.72;
const friction = 0.995;
const maxBalls = 100;
const regenSeconds = 60;

// physics bias to encourage center landings (tuneable)
const centerBias = 6.4; // acceleration strength (px/s^2 per px from center). Increase = stronger central pull.

////////////////////
// DOM & TELEGRAM
////////////////////
const TELEGRAM = window.Telegram && window.Telegram.WebApp ? window.Telegram.WebApp : null;
if (TELEGRAM) { try { TELEGRAM.ready(); } catch(e) {} }

const canvas = document.getElementById('plinkoCanvas');
const ctx = canvas.getContext('2d');

const dom = {
  ballsCount: document.getElementById('ballsCount'),
  regenTimer: document.getElementById('regenTimer'),
  dropBtn: document.getElementById('dropBtn'),
  coinsCount: document.getElementById('coinsCount'),
  balance: document.getElementById('balance'),
  leaderboardList: document.getElementById('leaderboardList'),
  modal: document.getElementById('modal'),
  modalContent: document.getElementById('modalContent'),
  closeModalBtn: document.getElementById('closeModal')
};

////////////////////
// STATE
////////////////////
let coins = Number(localStorage.getItem('sc_coins') || 0);
let balls = Number(localStorage.getItem('sc_balls') || maxBalls);
if (isNaN(balls)) balls = maxBalls;
let lastRegen = Number(localStorage.getItem('sc_lastRegen') || Date.now());
let regenInterval = null, regenCountdownInterval = null;

let obstacles = [];   // {x,y,r}
let bins = [];        // {x,y,w,h,i}
let ballsInFlight = []; // {x,y,vx,vy,r,alive}

let confettiParticles = []; // for confetti overlay particles

let user = (TELEGRAM && TELEGRAM.initDataUnsafe && TELEGRAM.initDataUnsafe.user) ? TELEGRAM.initDataUnsafe.user : { id: 'local_'+Math.floor(Math.random()*99999), first_name: 'You' };

////////////////////
// AUDIO (WebAudio simple tones)
////////////////////
const AudioCtx = window.AudioContext || window.webkitAudioContext;
let audioCtx = null;
function ensureAudio() {
  if (!audioCtx) audioCtx = new AudioCtx();
}
function playHitSound() {
  try {
    ensureAudio();
    const t = audioCtx.currentTime;
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.type = 'square';
    o.frequency.setValueAtTime(880, t); // high feedback
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.05, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.15);
    o.connect(g); g.connect(audioCtx.destination);
    o.start(t); o.stop(t + 0.16);
  } catch(e) { /* ignore */ }
}
function playLandSound(isBig=false) {
  try {
    ensureAudio();
    const t = audioCtx.currentTime;
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(isBig ? 220 : 440, t);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(isBig ? 0.09 : 0.04, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + (isBig ? 0.7 : 0.22));
    o.connect(g); g.connect(audioCtx.destination);
    o.start(t); o.stop(t + (isBig ? 0.72 : 0.24));
  } catch(e) {}
}

////////////////////
// STORAGE helpers
////////////////////
function saveState(){
  localStorage.setItem('sc_coins', String(coins));
  localStorage.setItem('sc_balls', String(balls));
  localStorage.setItem('sc_lastRegen', String(lastRegen));
}
function saveScoreLocal(){
  const s = JSON.parse(localStorage.getItem('sc_scores') || '{}');
  s[user.id] = { name: user.first_name || 'Player', coins };
  localStorage.setItem('sc_scores', JSON.stringify(s));
}
function updateUI(){
  dom.coinsCount.textContent = `${coins} SOLX`;
  dom.balance.textContent = `${coins} SOLX`;
  dom.ballsCount.textContent = `${balls}`;
  saveState();
  saveScoreLocal();
}

////////////////////
// CANVAS setup & pyramid builder (centered)
////////////////////
function fitCanvas(){
  const cssWidth = Math.min(window.innerWidth * 0.92, 940);
  const cssHeight = Math.max(420, window.innerHeight * 0.56);
  canvas.style.width = cssWidth + 'px';
  canvas.style.height = cssHeight + 'px';
  const ratio = window.devicePixelRatio || 1;
  canvas.width = Math.round(cssWidth * ratio);
  canvas.height = Math.round(cssHeight * ratio);
  ctx.setTransform(ratio,0,0,ratio,0,0);
}

const obstacleRows = [3,4,5,6,7,8,9,10,11,12]; // 10 rows retained

function buildObstaclesAndBins(){
  obstacles = [];
  bins = [];

  const W = canvas.clientWidth;
  const H = canvas.clientHeight;

  const topPadding = Math.max(18, H * 0.04);
  const bottomReserve = Math.max(100, H * 0.18);
  const usableH = H - topPadding - bottomReserve;

  // widest row count
  const widestCount = Math.max(...obstacleRows);
  const sideMargin = Math.max(0.06 * W, 24);
  const availableWidth = W - sideMargin * 2;
  const baseSpacing = availableWidth / (widestCount + 1);
  const rowsCount = obstacleRows.length;
  const vSpacing = usableH / (rowsCount + 1);

  for (let r = 0; r < rowsCount; r++){
    const count = obstacleRows[r];
    // center row with same spacing
    const rowWidth = baseSpacing * (count + 1);
    const rowLeft = (W - rowWidth) / 2;
    const y = topPadding + (r + 1) * vSpacing;
    for (let i = 0; i < count; i++){
      const x = rowLeft + (i + 1) * baseSpacing;
      obstacles.push({ x, y, r: obstacleRadius });
    }
  }

  // bins: center under pyramid spanning availableWidth
  const binsY = canvas.clientHeight - bottomReserve + 12;
  const binWidth = availableWidth / binsCount;
  const binsLeft = (W - availableWidth) / 2;
  for (let i = 0; i < binsCount; i++){
    const x = binsLeft + i * binWidth;
    bins.push({ x, y: binsY, w: Math.max(24, binWidth - 6), h: Math.max(60, bottomReserve - 24), i });
  }
}

////////////////////
// COLLISION helpers (circle-vs-circle)
////////////////////
function collidingCircleCircle(a, b){
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dist2 = dx*dx + dy*dy;
  const minR = (a.r + b.r);
  return dist2 < (minR * minR);
}

function resolveCircleCollision(ball, obs){
  // normal
  let nx = ball.x - obs.x;
  let ny = ball.y - obs.y;
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
  // small randomness to break symmetry
  ball.vx += (Math.random() - 0.5) * 10;
  // sound on hit
  playHitSound();
}

////////////////////
// RENDER helpers (ball glow + scene)
////////////////////
function render(){
  const W = canvas.clientWidth;
  const H = canvas.clientHeight;
  ctx.clearRect(0,0,W,H);

  // pegs (soft)
  for (let o of obstacles){
    ctx.beginPath();
    ctx.fillStyle = 'rgba(255,255,255,0.14)';
    ctx.arc(o.x, o.y, o.r, 0, Math.PI*2);
    ctx.fill();
  }

  // bins
  for (let i = 0; i < bins.length; i++){
    const b = bins[i];
    ctx.fillStyle = 'rgba(255,255,255,0.03)';
    ctx.fillRect(b.x, b.y, b.w, b.h);
    ctx.fillStyle = 'rgba(255,255,255,0.78)';
    ctx.font = '700 13px Inter, system-ui';
    ctx.textAlign = 'center';
    ctx.fillText(String(payouts[i]), b.x + b.w/2, b.y + b.h/2 + 6);
  }

  // separators
  ctx.strokeStyle = 'rgba(255,255,255,0.04)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 1; i < bins.length; i++){
    const bx = bins[0].x + i * (bins[0].w + 6);
    ctx.moveTo(bx, bins[0].y);
    ctx.lineTo(bx, H);
  }
  ctx.stroke();

  // balls with Solana glow (radial gradient purple -> teal)
  for (let b of ballsInFlight){
    // draw glow
    const grad = ctx.createRadialGradient(b.x, b.y, b.r * 0.2, b.x, b.y, b.r * 6);
    grad.addColorStop(0, 'rgba(153,69,255,0.95)'); // purple start
    grad.addColorStop(0.35, 'rgba(153,69,255,0.5)');
    grad.addColorStop(0.6, 'rgba(10,189,227,0.3)'); // teal
    grad.addColorStop(1, 'rgba(10,189,227,0)');
    ctx.beginPath();
    ctx.fillStyle = grad;
    ctx.arc(b.x, b.y, b.r * 6, 0, Math.PI*2);
    ctx.fill();

    // shadow
    ctx.beginPath();
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.arc(b.x + 2.5, b.y + 3.5, b.r + 2.2, 0, Math.PI*2);
    ctx.fill();

    // ball core
    ctx.beginPath();
    ctx.fillStyle = '#ffffff';
    ctx.arc(b.x, b.y, b.r, 0, Math.PI*2);
    ctx.fill();
  }
}

////////////////////
// CONFETTI effect (canvas overlay using many particles)
////////////////////
function startConfetti() {
  // spawn many particles across the canvas area
  const W = canvas.getBoundingClientRect().width;
  const H = canvas.getBoundingClientRect().height;
  const count = 120;
  for (let i = 0; i < count; i++) {
    const p = {
      x: canvas.getBoundingClientRect().left + Math.random() * W,
      y: canvas.getBoundingClientRect().top + Math.random() * 40,
      vx: (Math.random() - 0.5) * 600,
      vy: 200 + Math.random() * 300,
      size: 6 + Math.random() * 8,
      life: 1200 + Math.random() * 1200,
      color: (Math.random() < 0.5) ? '#9945FF' : '#14F195',
      born: performance.now()
    };
    confettiParticles.push(p);
  }
  // start DOM animation loop for confetti overlay
  requestAnimationFrame(drawConfetti);
}

function drawConfetti(now){
  // create overlay canvas if not exists
  let overlay = document.getElementById('confettiOverlay');
  if (!overlay) {
    overlay = document.createElement('canvas');
    overlay.id = 'confettiOverlay';
    overlay.style.position = 'fixed';
    overlay.style.left = '0';
    overlay.style.top = '0';
    overlay.style.pointerEvents = 'none';
    overlay.style.zIndex = 9998;
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

  const TTL = 2500;
  confettiParticles = confettiParticles.filter(p => (now - p.born) < p.life);
  for (let p of confettiParticles) {
    p.x += p.vx * (1/60);
    p.y += p.vy * (1/60);
    p.vy += 800 * (1/60); // gravity on confetti
    octx.fillStyle = p.color;
    octx.fillRect(p.x, p.y, p.size, p.size * 0.6);
  }
  if (confettiParticles.length > 0) requestAnimationFrame(drawConfetti);
  else {
    // cleanup overlay after a short delay
    setTimeout(()=> { const el = document.getElementById('confettiOverlay'); if (el) el.remove(); }, 600);
  }
}

////////////////////
// PHYSICS loop
////////////////////
let lastTime = null;
function step(now){
  if (!lastTime) lastTime = now;
  const dt = Math.min(0.032, (now - lastTime) / 1000);
  lastTime = now;

  const W = canvas.clientWidth;
  const H = canvas.clientHeight;
  const centerX = W * 0.5;

  for (let bi = ballsInFlight.length - 1; bi >= 0; bi--){
    const b = ballsInFlight[bi];
    if (!b.alive) { ballsInFlight.splice(bi,1); continue; }

    // center bias acceleration toward center (makes edges rarer)
    const dxCenter = (centerX - b.x);
    const axCenter = dxCenter * centerBias * 0.001; // scale down: px * bias -> px/s^2
    b.vx += axCenter * dt;

    // integrate gravity and friction
    b.vy += gravity * dt;
    b.vx *= Math.pow(friction, dt*60);
    b.vy *= Math.pow(friction, dt*60);

    b.x += b.vx * dt;
    b.y += b.vy * dt;

    // walls
    if (b.x - b.r < 4){
      b.x = 4 + b.r;
      b.vx = Math.abs(b.vx) * restitution;
    }
    if (b.x + b.r > W - 4){
      b.x = W - 4 - b.r;
      b.vx = -Math.abs(b.vx) * restitution;
    }

    // obstacles collisions
    for (let oi = 0; oi < obstacles.length; oi++){
      const obs = obstacles[oi];
      if (collidingCircleCircle(b, obs)){
        resolveCircleCollision(b, obs);
      }
    }

    // bottom -> bin detection
    const bottomTrigger = H - (bins[0] ? (bins[0].h + 24) : 88);
    if (b.y + b.r >= bottomTrigger){
      // map relative to binsLeft / availableWidth
      const binsLeft = bins[0] ? bins[0].x : 8;
      const availableWidth = (bins[bins.length-1].x + bins[bins.length-1].w) - binsLeft;
      let relX = (b.x - binsLeft) / availableWidth;
      relX = Math.max(0, Math.min(0.9999, relX));
      let binIndex = Math.floor(relX * binsCount);
      binIndex = Math.max(0, Math.min(binsCount - 1, binIndex));
      const reward = payouts[binIndex] || 0;
      coins += reward;

      // play land sound; bigger sound for big reward
      playLandSound(reward >= 100 ? true : false);

      // confetti & special on 500 bins
      if (reward === 500) {
        startConfetti();
      }

      // spawn floating reward
      spawnFloatingReward(b.x, bottomTrigger - 18, `+${reward}`);

      ballsInFlight.splice(bi, 1);
      updateUI();
      continue;
    }
  }

  render();
  requestAnimationFrame(step);
}

////////////////////
// spawn floating reward (non-modal)
////////////////////
function spawnFloatingReward(x, y, text){
  const el = document.createElement('div');
  el.textContent = text;
  Object.assign(el.style, {
    position: 'fixed',
    left: (canvas.getBoundingClientRect().left + x - 20) + 'px',
    top: (canvas.getBoundingClientRect().top + y - 10) + 'px',
    padding: '6px 8px',
    background: 'linear-gradient(90deg,#14F195,#0ABDE3)',
    color: '#000',
    fontWeight: '800',
    borderRadius: '8px',
    pointerEvents: 'none',
    zIndex: 9999,
    transform: 'translateY(0)',
    opacity: '1',
  });
  document.body.appendChild(el);
  requestAnimationFrame(()=> {
    el.style.transition = 'transform 900ms ease-out, opacity 900ms';
    el.style.transform = 'translateY(-48px)';
    el.style.opacity = '0';
  });
  setTimeout(()=> el.remove(), 950);
}

////////////////////
// spawn ball
////////////////////
function dropBall(){
  if (balls <= 0){
    showModal('<div style="font-weight:700">No balls left — wait for regen</div>');
    return;
  }
  balls -= 1;
  updateUI();
  const W = canvas.clientWidth;
  const startX = W * 0.5 + (Math.random() - 0.5) * 18;
  const startY = Math.max(20, canvas.clientHeight * 0.04);
  const initVx = (Math.random() - 0.5) * 40;
  const initVy = 40 + Math.random() * 40;
  ballsInFlight.push({ x: startX, y: startY, vx: initVx, vy: initVy, r: ballRadius, alive: true });
}

////////////////////
// regen logic and UI helpers
////////////////////
function startRegen(){
  const now = Date.now();
  const elapsed = Math.floor((now - lastRegen) / 1000);
  if (elapsed >= regenSeconds){
    const add = Math.floor(elapsed / regenSeconds);
    balls = Math.min(maxBalls, balls + add);
    lastRegen = lastRegen + add * regenSeconds * 1000;
    if (balls >= maxBalls) lastRegen = Date.now();
    updateUI();
  }
  if (regenCountdownInterval) clearInterval(regenCountdownInterval);
  regenCountdownInterval = setInterval(() => {
    const secs = Math.max(0, regenSeconds - Math.floor((Date.now() - lastRegen) / 1000));
    dom.regenTimer.textContent = `${secs}s`;
  }, 1000);

  if (regenInterval) clearInterval(regenInterval);
  regenInterval = setInterval(() => {
    if (balls < maxBalls) { balls += 1; lastRegen = Date.now(); updateUI(); }
    else lastRegen = Date.now();
  }, regenSeconds * 1000);
}

////////////////////
// modal & leaderboard (unchanged)
////////////////////
function showModal(html){ dom.modalContent.innerHTML = html; dom.modal.classList.remove('hidden'); }
function hideModal(){ dom.modal.classList.add('hidden'); }

function renderLeaderboard(){
  const obj = JSON.parse(localStorage.getItem('sc_scores') || '{}');
  const arr = Object.keys(obj).map(k => ({ id: k, name: obj[k].name, coins: obj[k].coins || 0 }));
  arr.sort((a,b) => b.coins - a.coins);
  dom.leaderboardList.innerHTML = '';
  if (!arr.length) { dom.leaderboardList.innerHTML = '<div class="muted">No scores yet — be the first!</div>'; return; }
  arr.slice(0,10).forEach((p,i) => {
    const row = document.createElement('div');
    row.className = 'row';
    row.innerHTML = `<div class="meta"><div class="rank ${i===0?'first':''}">${i+1}</div><div><div style="font-weight:700">${p.name}</div><div style="font-size:12px;color:rgba(255,255,255,0.6)">Solana City</div></div></div><div style="font-weight:800">${p.coins} SOLX</div>`;
    dom.leaderboardList.appendChild(row);
  });
}

////////////////////
// events binding
////////////////////
document.getElementById('dropBtn').addEventListener('click', () => { dropBall(); if (!audioCtx) { /* touch to enable audio on mobile */ }});
document.getElementById('openLeaderboard').addEventListener('click', ()=> showScreen('leaderboard'));
document.getElementById('backFromLeaderboard').addEventListener('click', ()=> showScreen('plinko'));
document.getElementById('backFromLoot').addEventListener('click', ()=> showScreen('plinko'));
document.getElementById('backFromRef').addEventListener('click', ()=> showScreen('plinko'));
document.querySelectorAll('.nav-btn').forEach(b => b.addEventListener('click', ()=> showScreen(b.dataset.target)));
document.querySelectorAll('.loot-open').forEach(b => b.addEventListener('click', e => {
  const tier = e.currentTarget.dataset.tier;
  const reward = tier === 'legend' ? (Math.floor(Math.random()*150)+50) : (tier==='rare' ? (Math.floor(Math.random()*50)+15) : (Math.floor(Math.random()*20)+5));
  coins += reward; updateUI(); showModal(`<div style="font-size:18px;font-weight:800">🎉 You got ${reward} SOLX!</div>`);
}));
document.getElementById('copyRef')?.addEventListener('click', async ()=> {
  const inp = document.getElementById('refLink');
  try { await navigator.clipboard.writeText(inp.value); showModal('<div style="font-weight:700">Link copied ✅</div>'); } catch(e){ showModal('<div style="font-weight:700">Copy failed — select manually</div>'); }
});
dom.closeModalBtn && dom.closeModalBtn.addEventListener('click', hideModal);

function showScreen(k){
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById('screen-' + (k==='plinko' ? 'plinko' : k)).classList.add('active');
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  const active = Array.from(document.querySelectorAll('.nav-btn')).find(b => b.dataset.target === k);
  if (active) active.classList.add('active');
  if (k === 'leaderboard') renderLeaderboard();
}

////////////////////
// INIT
////////////////////
let loopStarted = false;
function init(){
  fitCanvas();
  buildObstaclesAndBins();
  updateUI();
  renderLeaderboard();
  startRegen();
  if (!loopStarted) { loopStarted = true; requestAnimationFrame(step); }
}
window.addEventListener('resize', ()=> { fitCanvas(); buildObstaclesAndBins(); });
init();
