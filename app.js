/* app.js — Mobile-optimized Plinko (Telegram Mini App) with Avatar + Username Leaderboard
   - Peg rows: 3..14 (12 rows total)
   - Bins (12): [500,100,50,20,5,1,1,5,20,50,100,500]
   - Square prize boxes, ≥2px gaps, 1px gradient stroke, 500-bin glow
   - Strong Solana ball glow (purple→teal)
   - Physics + center bias + 1/1000 acceptance for 500 edge bins
   - Sounds on peg hit / land; confetti on 500
   - Leaderboard shows avatar (photo_url or initials), name, @username, score
*/

/* =================== CONFIG =================== */
const payouts = [500,100,50,20,5,1,1,5,20,50,100,500]; // 12 bins
const binsCount = payouts.length;

const ballRadius = 4;         // px
const obstacleRadius = 4;     // px
const gravity = 1200;         // px/s^2
const restitution = 0.72;
const friction = 0.995;
const maxBalls = 100;
const regenSeconds = 60;

// physics shaping
const centerBias = 6.4;          // pull toward center (reduces edge hits)
const EDGE_ACCEPT_PROB = 0.001;  // 1/1000 acceptance for 500 edge bins

// peg rows (top → bottom)
const obstacleRows = [3,4,5,6,7,8,9,10,11,12,13,14];

/* =============== TELEGRAM + DOM =============== */
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

/* ============== USER HELPER (TG) ============== */
function getTelegramUser() {
  const u = (TELEGRAM && TELEGRAM.initDataUnsafe && TELEGRAM.initDataUnsafe.user) || null;
  // Normalize fields with sensible fallbacks
  return {
    id: u?.id ? String(u.id) : 'local_' + Math.floor(Math.random() * 999999),
    first_name: u?.first_name || 'Player',
    last_name: u?.last_name || '',
    username: u?.username || '',           // may be empty
    photo_url: u?.photo_url || ''          // often empty in Mini Apps (we handle fallback)
  };
}
const tgUser = getTelegramUser();

/* =================== STATE ==================== */
let coins = Number(localStorage.getItem('sc_coins') || 0);
let balls = Number(localStorage.getItem('sc_balls') || maxBalls);
if (isNaN(balls)) balls = maxBalls;
let lastRegen = Number(localStorage.getItem('sc_lastRegen') || Date.now());
let regenInterval = null, regenCountdownInterval = null;

let obstacles = [];     // {x,y,r}
let bins = [];          // {x,y,w,h,i}
let ballsInFlight = []; // {x,y,vx,vy,r,alive}
let confettiParticles = [];

/* =================== AUDIO ==================== */
const AudioCtx = window.AudioContext || window.webkitAudioContext;
let audioCtx = null;
function ensureAudio(){ if (!audioCtx) audioCtx = new AudioCtx(); }

function playHitSound(){
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
  } catch(e){}
}

function playLandSound(isBig=false){
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
  } catch(e){}
}

/* =============== PERSISTENCE/UI =============== */
function saveState(){
  localStorage.setItem('sc_coins', String(coins));
  localStorage.setItem('sc_balls', String(balls));
  localStorage.setItem('sc_lastRegen', String(lastRegen));
}
function saveScoreLocal(){
  // Store name, username and avatar url so we can render a richer leaderboard
  const s = JSON.parse(localStorage.getItem('sc_scores') || '{}');
  const key = tgUser.id;
  s[key] = {
    name: tgUser.first_name || 'Player',
    username: tgUser.username || '',
    avatarUrl: tgUser.photo_url || '',
    coins
  };
  localStorage.setItem('sc_scores', JSON.stringify(s));
}
function updateUI(){
  dom.coinsCount.textContent = `${coins} SOLX`;
  dom.balance.textContent = `${coins} SOLX`;
  dom.ballsCount.textContent = `${balls}`;
  saveState();
  saveScoreLocal();
}

/* =============== CANVAS + LAYOUT ============== */
function fitCanvas(){
  const cssWidth = Math.min(window.innerWidth * 0.92, 940);
  const isPhone = window.innerWidth <= 420;
  const cssHeight = isPhone
    ? Math.min(Math.max(320, window.innerHeight * 0.40), 480)
    : Math.min(Math.max(340, window.innerHeight * 0.44), 520);

  canvas.style.width = cssWidth + 'px';
  canvas.style.height = cssHeight + 'px';
  const ratio = window.devicePixelRatio || 1;
  canvas.width = Math.round(cssWidth * ratio);
  canvas.height = Math.round(cssHeight * ratio);
  ctx.setTransform(ratio,0,0,ratio,0,0);
}

function buildObstaclesAndBins(){
  obstacles = [];
  bins = [];

  const W = canvas.clientWidth;
  const H = canvas.clientHeight;

  const topPadding = Math.max(14, H * 0.03);
  const bottomReserve = Math.max(88, H * 0.20);
  const usableH = H - topPadding - bottomReserve;

  // ---- Peg pyramid (centered) ----
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

  // ---- Mobile-optimized square bins ----
  // Keep ≥2px gaps, auto-scale so all boxes fit on one row.
  const binsY = H - bottomReserve + 10;
  const minGap = 2; // ≥2px visual gap
  const maxBoxFromHeight = (bottomReserve - 22);
  const maxBoxFromWidth  = (availableWidth - minGap*(binsCount - 1)) / binsCount;
  const vwTarget = Math.max(22, Math.min(34, Math.floor(window.innerWidth * 0.06))); // ~6vw, clamped
  const boxSize = Math.max(22, Math.min(vwTarget, maxBoxFromWidth, maxBoxFromHeight));

  const totalRowWidth = boxSize * binsCount + minGap * (binsCount - 1);
  const binsLeft = (W - totalRowWidth) / 2;

  for (let i = 0; i < binsCount; i++){
    const x = binsLeft + i * (boxSize + minGap);
    const y = binsY + (bottomReserve - 10 - boxSize);
    bins.push({ x, y, w: boxSize, h: boxSize, i });
  }
}

/* ================= COLLISIONS ================= */
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

/* ================== RENDER ==================== */
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

  // bins: fill + 1px gradient stroke + 500 glow + centered label
  for (let i = 0; i < bins.length; i++){
    const b = bins[i];

    // gradient stroke (button colors)
    const gradStroke = ctx.createLinearGradient(b.x, b.y, b.x + b.w, b.y + b.h);
    gradStroke.addColorStop(0, '#9945FF');
    gradStroke.addColorStop(1, '#0ABDE3');

    // 500-bin glow
    if (payouts[i] === 500){
      ctx.save();
      ctx.shadowColor = 'rgba(153,69,255,0.28)';
      ctx.shadowBlur = 20;
      ctx.fillStyle = 'rgba(255,255,255,0.04)';
      ctx.fillRect(b.x, b.y, b.w, b.h);
      ctx.restore();
    } else {
      ctx.fillStyle = 'rgba(255,255,255,0.03)';
      ctx.fillRect(b.x, b.y, b.w, b.h);
    }

    // 1px stroke
    ctx.lineWidth = 1;
    ctx.strokeStyle = gradStroke;
    ctx.strokeRect(b.x + 0.5, b.y + 0.5, b.w - 1, b.h - 1);

    // label (dynamic size for small boxes)
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    const labelSize = Math.max(10, Math.min(13, Math.floor(b.w * 0.36)));
    ctx.font = `700 ${labelSize}px Inter, system-ui`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(payouts[i]), b.x + b.w/2, b.y + b.h/2);
  }

  // balls with strong Solana glow (purple → teal)
  for (let b of ballsInFlight){
    const glowR = Math.max(b.r * 4.5, 18);
    const grad = ctx.createRadialGradient(b.x, b.y, b.r*0.2, b.x, b.y, glowR);
    grad.addColorStop(0, 'rgba(153,69,255,0.95)');
    grad.addColorStop(0.35, 'rgba(153,69,255,0.55)');
    grad.addColorStop(0.65, 'rgba(10,189,227,0.45)');
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

/* ================= CONFETTI =================== */
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

/* ========== LEADERBOARD RENDERING ============ */
// Helpers for avatar initials
function getInitials(name) {
  const parts = (name || '').trim().split(/\s+/);
  const a = (parts[0] || '').charAt(0);
  const b = (parts[1] || '').charAt(0);
  return (a + b).toUpperCase() || 'P';
}

function renderLeaderboard(){
  const obj = JSON.parse(localStorage.getItem('sc_scores') || '{}');
  const arr = Object.keys(obj).map(k => ({
    id: k,
    name: obj[k].name || 'Player',
    username: obj[k].username || '',
    avatarUrl: obj[k].avatarUrl || '',
    coins: obj[k].coins || 0
  }));
  arr.sort((a,b) => b.coins - a.coins);

  dom.leaderboardList.innerHTML = '';
  if (!arr.length) {
    dom.leaderboardList.innerHTML = '<div class="muted">No scores yet — be the first!</div>';
    return;
  }

  // Build rows with avatar + name + @username + score
  arr.slice(0, 20).forEach((p, i) => {
    const row = document.createElement('div');
    row.style.display = 'flex';
    row.style.alignItems = 'center';
    row.style.justifyContent = 'space-between';
    row.style.gap = '10px';
    row.style.padding = '8px 10px';
    row.style.borderRadius = '10px';
    row.style.background = 'rgba(255,255,255,0.03)';
    row.style.marginBottom = '6px';

    // Left side: rank + avatar + name + username
    const left = document.createElement('div');
    left.style.display = 'flex';
    left.style.alignItems = 'center';
    left.style.gap = '10px';

    const rank = document.createElement('div');
    rank.textContent = String(i + 1);
    rank.style.width = '28px';
    rank.style.textAlign = 'center';
    rank.style.fontWeight = '800';
    rank.style.color = i === 0 ? '#14F195' : 'rgba(255,255,255,0.9)';

    // Avatar container
    const avatarWrap = document.createElement('div');
    avatarWrap.style.width = '36px';
    avatarWrap.style.height = '36px';
    avatarWrap.style.borderRadius = '50%';
    avatarWrap.style.overflow = 'hidden';
    avatarWrap.style.display = 'flex';
    avatarWrap.style.alignItems = 'center';
    avatarWrap.style.justifyContent = 'center';
    avatarWrap.style.background = 'linear-gradient(90deg,#9945FF,#0ABDE3)';

    if (p.avatarUrl) {
      const img = document.createElement('img');
      img.src = p.avatarUrl;
      img.alt = p.name;
      img.width = 36; img.height = 36;
      img.style.objectFit = 'cover';
      img.referrerPolicy = 'no-referrer';
      avatarWrap.appendChild(img);
    } else {
      const init = document.createElement('div');
      init.textContent = getInitials(p.name);
      init.style.fontWeight = '800';
      init.style.fontSize = '14px';
      init.style.color = '#000';
      init.style.width = '100%';
      init.style.height = '100%';
      init.style.display = 'flex';
      init.style.alignItems = 'center';
      init.style.justifyContent = 'center';
      init.style.background = '#fff';
      avatarWrap.appendChild(init);
    }

    const nameBlock = document.createElement('div');
    nameBlock.style.display = 'flex';
    nameBlock.style.flexDirection = 'column';
    nameBlock.style.lineHeight = '1.1';

    const name = document.createElement('div');
    name.textContent = p.name;
    name.style.fontWeight = '700';
    name.style.color = 'rgba(255,255,255,0.95)';

    const uname = document.createElement('div');
    if (p.username) {
      uname.textContent = '@' + p.username;
      uname.style.fontSize = '12px';
      uname.style.color = 'rgba(255,255,255,0.55)';
    }

    nameBlock.appendChild(name);
    if (p.username) nameBlock.appendChild(uname);

    left.appendChild(rank);
    left.appendChild(avatarWrap);
    left.appendChild(nameBlock);

    // Right side: score
    const score = document.createElement('div');
    score.textContent = `${p.coins} SOLX`;
    score.style.fontWeight = '800';
    score.style.color = 'rgba(255,255,255,0.95)';

    row.appendChild(left);
    row.appendChild(score);

    dom.leaderboardList.appendChild(row);
  });
}

/* ================== PHYSICS =================== */
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

    // center bias acceleration (steers toward center)
    const dxCenter = (centerX - b.x);
    const axCenter = dxCenter * centerBias * 0.001;
    b.vx += axCenter * dt;

    // integrate gravity + damping
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

    // peg collisions
    for (let oi = 0; oi < obstacles.length; oi++){
      const obs = obstacles[oi];
      if (collidingCircleCircle(b, obs)){
        resolveCircleCollision(b, obs);
      }
    }

    // landing
    const bottomTrigger = H - (bins[0] ? (bins[0].h + 24) : 88);
    if (b.y + b.r >= bottomTrigger){
      // map to bin index by x inside bins span
      const firstLeft = bins[0].x;
      const lastRight = bins[bins.length-1].x + bins[bins.length-1].w;
      const span = lastRight - firstLeft;
      let relX = (b.x - firstLeft) / span;
      relX = Math.max(0, Math.min(0.9999, relX));
      let rawBinIndex = Math.floor(relX * binsCount);
      rawBinIndex = Math.max(0, Math.min(binsCount - 1, rawBinIndex));
      let finalBin = rawBinIndex;

      // enforce 1/1000 edge jackpot acceptance
      if (payouts[rawBinIndex] === 500) {
        if (Math.random() < EDGE_ACCEPT_PROB) {
          finalBin = rawBinIndex;
        } else {
          if (rawBinIndex === 0) finalBin = 1;
          else if (rawBinIndex === binsCount - 1) finalBin = binsCount - 2;
        }
      }

      const reward = payouts[finalBin] || 0;
      coins += reward;
      playLandSound(reward >= 100 ? true : false);
      if (reward === 500) startConfetti();

      spawnFloatingReward(b.x, bottomTrigger - 18, `+${reward}`);
      ballsInFlight.splice(bi, 1);
      updateUI();
    }
  }

  render();
  requestAnimationFrame(step);
}

/* ======== Floating +X reward tag (non-modal) ======== */
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

/* ================== GAMEPLAY =================== */
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

/* ======= Modal + Leaderboard (fallback local) ======= */
function showModal(html){ dom.modalContent.innerHTML = html; dom.modal.classList.remove('hidden'); }
function hideModal(){ dom.modal.classList.add('hidden'); }

// screen nav helper (if you have multiple screens)
function showScreen(k){
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById('screen-' + (k==='plinko' ? 'plinko' : k)).classList.add('active');
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  const active = Array.from(document.querySelectorAll('.nav-btn')).find(b => b.dataset.target === k);
  if (active) active.classList.add('active');
  if (k === 'leaderboard') renderLeaderboard();
}

/* ================== EVENTS ==================== */
document.getElementById('dropBtn')?.addEventListener('click', dropBall);
document.getElementById('openLeaderboard')?.addEventListener('click', ()=> showScreen('leaderboard'));
document.getElementById('backFromLeaderboard')?.addEventListener('click', ()=> showScreen('plinko'));
document.getElementById('backFromLoot')?.addEventListener('click', ()=> showScreen('plinko'));
document.getElementById('backFromRef')?.addEventListener('click', ()=> showScreen('plinko'));

document.querySelectorAll('.nav-btn').forEach(b => b.addEventListener('click', ()=> showScreen(b.dataset.target)));
document.querySelectorAll('.loot-open').forEach(b => b.addEventListener('click', e => {
  const tier = e.currentTarget.dataset.tier;
  const reward = tier === 'legend' ? (Math.floor(Math.random()*150)+50)
                 : (tier==='rare' ? (Math.floor(Math.random()*50)+15)
                 : (Math.floor(Math.random()*20)+5));
  coins += reward; updateUI(); showModal(`<div style="font-size:18px;font-weight:800">🎉 You got ${reward} SOLX!</div>`);
}));

document.getElementById('copyRef')?.addEventListener('click', async ()=> {
  const inp = document.getElementById('refLink');
  try { await navigator.clipboard.writeText(inp.value); showModal('<div style="font-weight:700">Link copied ✅</div>'); }
  catch(e){ showModal('<div style="font-weight:700">Copy failed — select manually</div>'); }
});
dom.closeModalBtn && dom.closeModalBtn.addEventListener('click', hideModal);

/* =================== INIT ===================== */
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
