/* app.js - Updated per request:
   - +2 peg rows (rows 3..14)
   - stronger Solana glow on balls (restored)
   - stronger glow on 500 coin bins
   - at least 2px visual gap between prize boxes
   - 1px gradient stroke around prize boxes (button color scheme)
   - keeps 1/1000 acceptance for 500 bins and other features from tuned version
*/

/* CONFIG */
const payouts = [500,100,50,20,5,1,1,5,20,50,100,500]; // 12 bins (unchanged)
const binsCount = payouts.length;

const ballRadius = 4;                // px
const obstacleRadius = 4;            // px
const gravity = 1200;                // px/s^2
const restitution = 0.72;
const friction = 0.995;
const maxBalls = 100;
const regenSeconds = 60;

// center bias and edge acceptance for 500 bins
const centerBias = 6.4;
const EDGE_ACCEPT_PROB = 0.001;

////////////////////
// DOM + TELEGRAM
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
let confettiParticles = [];
let user = (TELEGRAM && TELEGRAM.initDataUnsafe && TELEGRAM.initDataUnsafe.user) ? TELEGRAM.initDataUnsafe.user : { id: 'local_'+Math.floor(Math.random()*99999), first_name: 'You' };

////////////////////
// AUDIO
////////////////////
const AudioCtx = window.AudioContext || window.webkitAudioContext;
let audioCtx = null;
function ensureAudio() { if (!audioCtx) audioCtx = new AudioCtx(); }
function playHitSound() {
  try {
    ensureAudio();
    const t = audioCtx.currentTime;
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.type = 'square';
    o.frequency.setValueAtTime(880 + Math.random()*80, t);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.04, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
    o.connect(g); g.connect(audioCtx.destination);
    o.start(t); o.stop(t + 0.14);
  } catch(e) {}
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
    g.gain.exponentialRampToValueAtTime(isBig ? 0.09 : 0.035, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + (isBig ? 0.7 : 0.22));
    o.connect(g); g.connect(audioCtx.destination);
    o.start(t); o.stop(t + (isBig ? 0.72 : 0.24));
  } catch(e) {}
}

////////////////////
// STORAGE & UI
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
// CANVAS + LAYOUT (UI optimized fits screen)
////////////////////
function fitCanvas(){
  const cssWidth = Math.min(window.innerWidth * 0.92, 940);
  const cssHeight = Math.min(Math.max(340, window.innerHeight * 0.44), 520);
  canvas.style.width = cssWidth + 'px';
  canvas.style.height = cssHeight + 'px';
  const ratio = window.devicePixelRatio || 1;
  canvas.width = Math.round(cssWidth * ratio);
  canvas.height = Math.round(cssHeight * ratio);
  ctx.setTransform(ratio,0,0,ratio,0,0);
}

/* NEW: 2 extra rows added (3..14) */
const obstacleRows = [3,4,5,6,7,8,9,10,11,12,13,14]; // now 12 rows (was 10)

function buildObstaclesAndBins(){
  obstacles = [];
  bins = [];

  const W = canvas.clientWidth;
  const H = canvas.clientHeight;

  const topPadding = Math.max(14, H * 0.03);
  const bottomReserve = Math.max(96, H * 0.20);
  const usableH = H - topPadding - bottomReserve;

  const widestCount = Math.max(...obstacleRows);
  const sideMargin = Math.max(0.06 * W, 18);
  const availableWidth = W - sideMargin * 2;
  const baseSpacing = availableWidth / (widestCount + 1);
  const rowsCount = obstacleRows.length;
  const vSpacing = usableH / (rowsCount + 1);

  for (let r = 0; r < rowsCount; r++){
    const count = obstacleRows[r];
    const rowWidth = baseSpacing * (count + 1);
    const rowLeft = (W - rowWidth) / 2;
    const y = topPadding + (r + 1) * vSpacing;
    for (let i = 0; i < count; i++){
      const x = rowLeft + (i + 1) * baseSpacing;
      obstacles.push({ x, y, r: obstacleRadius });
    }
  }

  // square bins with visual gap >= 2px and 1px gradient stroke
  const binsY = canvas.clientHeight - bottomReserve + 12;
  const totalGap = Math.max(2, 2) * (binsCount - 1); // at least 2px gap each between boxes
  const rawBinAreaWidth = availableWidth - totalGap;
  const gapPx = 2;
  const binSize = Math.max(34, Math.min((rawBinAreaWidth / binsCount), bottomReserve - 28));
  const binsLeft = (W - (binSize * binsCount + gapPx * (binsCount - 1))) / 2;

  for (let i = 0; i < binsCount; i++){
    const x = binsLeft + i * (binSize + gapPx);
    const y = binsY + (bottomReserve - 12 - binSize);
    bins.push({ x, y, w: binSize, h: binSize, i });
  }
}

////////////////////
// COLLISIONS
////////////////////
function collidingCircleCircle(a, b){
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dist2 = dx*dx + dy*dy;
  const minR = (a.r + b.r);
  return dist2 < (minR * minR);
}
function resolveCircleCollision(ball, obs){
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
  ball.vx += (Math.random() - 0.5) * 8;
  playHitSound();
}

////////////////////
// RENDER (restored strong ball glow + 500 box glow + 1px gradient stroke + 2px gaps)
////////////////////
function render(){
  const W = canvas.clientWidth;
  const H = canvas.clientHeight;
  ctx.clearRect(0,0,W,H);

  // pegs
  for (let o of obstacles){
    ctx.beginPath();
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    ctx.arc(o.x, o.y, o.r, 0, Math.PI*2);
    ctx.fill();
  }

  // draw bins: fill, stroke gradient border, and 500 glow
  for (let i = 0; i < bins.length; i++){
    const b = bins[i];

    // create stroke gradient matching button colors (purple -> teal)
    const gradStroke = ctx.createLinearGradient(b.x, b.y, b.x + b.w, b.y + b.h);
    gradStroke.addColorStop(0, '#9945FF'); // purple
    gradStroke.addColorStop(1, '#0ABDE3'); // teal

    // 500-bin glow (stronger)
    if (payouts[i] === 500){
      ctx.save();
      ctx.shadowColor = 'rgba(153,69,255,0.28)'; // purple-ish glow
      ctx.shadowBlur = 20;
      ctx.fillStyle = 'rgba(255,255,255,0.04)';
      ctx.fillRect(b.x, b.y, b.w, b.h);
      ctx.restore();
    } else {
      ctx.fillStyle = 'rgba(255,255,255,0.03)';
      ctx.fillRect(b.x, b.y, b.w, b.h);
    }

    // stroke (1px) using gradient
    ctx.lineWidth = 1;
    ctx.strokeStyle = gradStroke;
    ctx.strokeRect(b.x + 0.5, b.y + 0.5, b.w - 1, b.h - 1); // 0.5 to align crisp 1px

    // draw payout label
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.font = '700 12px Inter, system-ui';
    ctx.textAlign = 'center';
    ctx.fillText(String(payouts[i]), b.x + b.w/2, b.y + b.h/2 + 4);
  }

  // balls with restored (stronger) Solana glow
  for (let b of ballsInFlight){
    // stronger glow radius & alpha
    const glowR = Math.max(b.r * 4.5, 18); // significant glow
    const grad = ctx.createRadialGradient(b.x, b.y, b.r*0.2, b.x, b.y, glowR);
    grad.addColorStop(0, 'rgba(153,69,255,0.95)'); // purple dense
    grad.addColorStop(0.35, 'rgba(153,69,255,0.55)');
    grad.addColorStop(0.65, 'rgba(10,189,227,0.45)'); // teal outer
    grad.addColorStop(1, 'rgba(10,189,227,0)');
    ctx.beginPath();
    ctx.fillStyle = grad;
    ctx.arc(b.x, b.y, glowR, 0, Math.PI*2);
    ctx.fill();

    // shadow
    ctx.beginPath();
    ctx.fillStyle = 'rgba(0,0,0,0.20)';
    ctx.arc(b.x + 2, b.y + 3, b.r + 1.8, 0, Math.PI*2);
    ctx.fill();

    // ball core
    ctx.beginPath();
    ctx.fillStyle = '#ffffff';
    ctx.arc(b.x, b.y, b.r, 0, Math.PI*2);
    ctx.fill();
  }
}

////////////////////
// CONFETTI (unchanged)
////////////////////
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

////////////////////
// PHYSICS LOOP + 1/1000 acceptance
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

    const dxCenter = (centerX - b.x);
    const axCenter = dxCenter * centerBias * 0.001;
    b.vx += axCenter * dt;

    b.vy += gravity * dt;
    b.vx *= Math.pow(friction, dt*60);
    b.vy *= Math.pow(friction, dt*60);

    b.x += b.vx * dt;
    b.y += b.vy * dt;

    if (b.x - b.r < 4){
      b.x = 4 + b.r;
      b.vx = Math.abs(b.vx) * restitution;
    }
    if (b.x + b.r > W - 4){
      b.x = W - 4 - b.r;
      b.vx = -Math.abs(b.vx) * restitution;
    }

    for (let oi = 0; oi < obstacles.length; oi++){
      const obs = obstacles[oi];
      if (collidingCircleCircle(b, obs)){
        resolveCircleCollision(b, obs);
      }
    }

    const bottomTrigger = H - (bins[0] ? (bins[0].h + 24) : 88);
    if (b.y + b.r >= bottomTrigger){
      const binsLeft = bins[0] ? bins[0].x : 8;
      const lastRight = bins[bins.length-1].x + bins[bins.length-1].w;
      const availableWidth = lastRight - binsLeft;
      let relX = (b.x - binsLeft) / availableWidth;
      relX = Math.max(0, Math.min(0.9999, relX));
      let rawBinIndex = Math.floor(relX * binsCount);
      rawBinIndex = Math.max(0, Math.min(binsCount - 1, rawBinIndex));
      let finalBin = rawBinIndex;

      // post-process 500 acceptance
      if (payouts[rawBinIndex] === 500) {
        if (Math.random() < EDGE_ACCEPT_PROB) {
          finalBin = rawBinIndex;
        } else {
          if (rawBinIndex === 0) finalBin = 1;
          else if (rawBinIndex === binsCount - 1) finalBin = binsCount - 2;
          else finalBin = rawBinIndex;
        }
      }

      const reward = payouts[finalBin] || 0;
      coins += reward;
      playLandSound(reward >= 100 ? true : false);
      if (reward === 500) startConfetti();

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
// spawn floating reward
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
// drop ball
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
  const startY = Math.max(18, canvas.clientHeight * 0.04);
  const initVx = (Math.random() - 0.5) * 40;
  const initVy = 40 + Math.random() * 40;
  ballsInFlight.push({ x: startX, y: startY, vx: initVx, vy: initVy, r: ballRadius, alive: true });
}

////////////////////
// regen & UI
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
// modal & leaderboard
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
// events
////////////////////
document.getElementById('dropBtn').addEventListener('click', () => { dropBall(); });
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
// init
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
