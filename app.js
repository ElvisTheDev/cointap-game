/* app.js — SOLMAS Plinko (Telegram Mini App)
   Aesthetics + Boosts + Mobile
   - Galaxy background (dark Solana)
   - Buttons: bold white text with black outline
   - Title: "SOLMAS Plinko"; Subtitle: "Every drop is a win"
   - Balance counter in smooth translucent boxes
   - Rounded prize boxes, ≥2px gaps, gradient stroke, 500 glow
   - Loot -> Boost (🚀). "Open Lootbox" -> "Boosters" (routes to Boost)
   - Boosts:
       ⚡️ Speedster: regen x2 for 24h (500)
       ☄️ Maxi: max balls 500 for 24h (5000)
       🪙 Spender: +100 balls (2500)
   - Physics + center bias + 1/1000 edge jackpot acceptance
   - Sounds on hits/land; confetti on 500
   - Leaderboard shows avatar + @username + name + score
*/

/* =================== CONFIG =================== */
const payouts = [500,100,50,20,5,1,1,5,20,50,100,500]; // 12 bins
const binsCount = payouts.length;

const BASE_MAX_BALLS = 100;
const BOOST_MAXI_BALLS = 500;

const ballRadius = 4;
const obstacleRadius = 4;
const gravity = 1200;
const restitution = 0.72;
const friction = 0.995;

const BASE_REGEN_SECONDS = 60;     // 1 per minute
const SPEEDSTER_MULTIPLIER = 0.5;  // x2 faster => half the seconds

// physics shaping
const centerBias = 6.4;            // pull toward center
const EDGE_ACCEPT_PROB = 0.001;    // 1/1000 for 500 bins

// peg rows (top → bottom) with +2 extra rows
const obstacleRows = [3,4,5,6,7,8,9,10,11,12,13,14];

/* =============== TELEGRAM + DOM =============== */
const TELEGRAM = window.Telegram && window.Telegram.WebApp ? window.Telegram.WebApp : null;
if (TELEGRAM) { try { TELEGRAM.ready(); } catch(e) {} }

const canvas = document.getElementById('plinkoCanvas');
const ctx = canvas.getContext('2d');

const dom = {
  // existing ids from your HTML
  ballsCount: document.getElementById('ballsCount'),
  regenTimer: document.getElementById('regenTimer'),
  dropBtn: document.getElementById('dropBtn'),
  coinsCount: document.getElementById('coinsCount'),
  balance: document.getElementById('balance'),
  leaderboardList: document.getElementById('leaderboardList'),
  modal: document.getElementById('modal'),
  modalContent: document.getElementById('modalContent'),
  closeModalBtn: document.getElementById('closeModal'),

  // optional/expected ids for headings and nav
  title: document.getElementById('titleText'),
  subtitle: document.getElementById('subtitleText'),
  chadSantaText: document.getElementById('chadSantaText'),

  // nav buttons (may exist from your template)
  openLeaderboard: document.getElementById('openLeaderboard'),
  backFromLeaderboard: document.getElementById('backFromLeaderboard'),
  backFromLoot: document.getElementById('backFromLoot'),
  backFromRef: document.getElementById('backFromRef'),
  openLoot: document.getElementById('openLoot'),          // will route to boost
  openLootbox: document.getElementById('openLootbox'),    // “Boosters” -> boost
  // boost screen container (must exist in HTML as screen-boost)
  boostList: document.getElementById('boostList'),
  boostersBtn: document.getElementById('boostersBtn'),
  balanceBox: document.getElementById('balanceBox') // wrapper for balance
};

/* ============== USER HELPER (TG) ============== */
function getTelegramUser() {
  const u = (TELEGRAM && TELEGRAM.initDataUnsafe && TELEGRAM.initDataUnsafe.user) || null;
  return {
    id: u?.id ? String(u.id) : 'local_' + Math.floor(Math.random() * 999999),
    first_name: u?.first_name || 'Player',
    last_name: u?.last_name || '',
    username: u?.username || '',
    photo_url: u?.photo_url || ''
  };
}
const tgUser = getTelegramUser();

/* =================== STATE ==================== */
let coins = Number(localStorage.getItem('sc_coins') || 0);
let balls = Number(localStorage.getItem('sc_balls') || BASE_MAX_BALLS);
if (isNaN(balls)) balls = BASE_MAX_BALLS;
let lastRegen = Number(localStorage.getItem('sc_lastRegen') || Date.now());
let regenInterval = null, regenCountdownInterval = null;

let obstacles = [];     // {x,y,r}
let bins = [];          // {x,y,w,h,i}
let ballsInFlight = []; // {x,y,vx,vy,r,alive}
let confettiParticles = [];

/* ====== BOOSTS (timed & instant) ======
  speedsterUntil: timestamp (ms) when expires (regen x2)
  maxiUntil:      timestamp (ms) when expires (max=500)
  no timer for spender (instant purchase +100 balls)
*/
let boosts = JSON.parse(localStorage.getItem('sc_boosts') || '{}');
if (!boosts || typeof boosts !== 'object') boosts = {};
function isSpeedsterActive(){ return (boosts.speedsterUntil || 0) > Date.now(); }
function isMaxiActive(){ return (boosts.maxiUntil || 0) > Date.now(); }
function effectiveRegenSeconds(){ return isSpeedsterActive() ? BASE_REGEN_SECONDS * SPEEDSTER_MULTIPLIER : BASE_REGEN_SECONDS; }
function effectiveMaxBalls(){ return isMaxiActive() ? BOOST_MAXI_BALLS : BASE_MAX_BALLS; }
function saveBoosts(){
  localStorage.setItem('sc_boosts', JSON.stringify(boosts));
}

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
  dom.coinsCount && (dom.coinsCount.textContent = `${coins} SOLX`);
  dom.balance && (dom.balance.textContent = `${coins} SOLX`);
  dom.ballsCount && (dom.ballsCount.textContent = `${balls}`);
  saveState(); saveScoreLocal(); saveBoosts();
  renderBoosts(); // keep statuses fresh
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

  // Peg pyramid (centered)
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

  // Square bins with ≥2px gaps, rounded corners
  const binsY = H - bottomReserve + 10;
  const minGap = 2;
  const maxBoxFromHeight = (bottomReserve - 22);
  const maxBoxFromWidth  = (availableWidth - minGap*(binsCount - 1)) / binsCount;
  const vwTarget = Math.max(22, Math.min(34, Math.floor(window.innerWidth * 0.06)));
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

/* ================ RENDER HELPERS =============== */
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
  const W = canvas.clientWidth;
  const H = canvas.clientHeight;
  ctx.clearRect(0,0,W,H);

  // (1) Background behind canvas is set on body via JS (see initTheme()).

  // pegs
  for (let o of obstacles){
    ctx.beginPath();
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    ctx.arc(o.x, o.y, o.r, 0, Math.PI*2);
    ctx.fill();
  }

  // bins: rounded fill + 1px gradient stroke + 500 glow + centered label
  for (let i = 0; i < bins.length; i++){
    const b = bins[i];

    // gradient stroke (button colors)
    const gradStroke = ctx.createLinearGradient(b.x, b.y, b.x + b.w, b.y + b.h);
    gradStroke.addColorStop(0, '#9945FF');
    gradStroke.addColorStop(1, '#0ABDE3');

    // fill
    if (payouts[i] === 500){
      ctx.save();
      ctx.shadowColor = 'rgba(153,69,255,0.28)';
      ctx.shadowBlur = 20;
      ctx.fillStyle = 'rgba(255,255,255,0.04)';
      drawRoundedRect(b.x, b.y, b.w, b.h, 10);
      ctx.fill();
      ctx.restore();
    } else {
      ctx.fillStyle = 'rgba(255,255,255,0.03)';
      drawRoundedRect(b.x, b.y, b.w, b.h, 10);
      ctx.fill();
    }

    // 1px stroke
    ctx.lineWidth = 1;
    ctx.strokeStyle = gradStroke;
    drawRoundedRect(b.x + 0.5, b.y + 0.5, b.w - 1, b.h - 1, 10);
    ctx.stroke();

    // label
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    const labelSize = Math.max(10, Math.min(13, Math.floor(b.w * 0.36)));
    ctx.font = `700 ${labelSize}px Inter, system-ui`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(payouts[i]), b.x + b.w/2, b.y + b.h/2);
  }

  // balls with strong Solana glow
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

    // shadow + core
    ctx.beginPath();
    ctx.fillStyle = 'rgba(0,0,0,0.20)';
    ctx.arc(b.x + 2, b.y + 3, b.r + 1.8, 0, Math.PI*2);
    ctx.fill();
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

  const list = dom.leaderboardList;
  if (!list) return;
  list.innerHTML = '';
  if (!arr.length) {
    list.innerHTML = '<div class="muted">No scores yet — be the first!</div>';
    return;
  }

  arr.slice(0, 20).forEach((p, i) => {
    const row = document.createElement('div');
    row.style.display = 'flex';
    row.style.alignItems = 'center';
    row.style.justifyContent = 'space-between';
    row.style.gap = '10px';
    row.style.padding = '8px 10px';
    row.style.borderRadius = '12px';
    row.style.background = 'rgba(255,255,255,0.04)';
    row.style.marginBottom = '6px';

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

    if (p.username) {
      const uname = document.createElement('div');
      uname.textContent = '@' + p.username;
      uname.style.fontSize = '12px';
      uname.style.color = 'rgba(255,255,255,0.55)';
      nameBlock.appendChild(name);
      nameBlock.appendChild(uname);
    } else {
      nameBlock.appendChild(name);
    }

    const score = document.createElement('div');
    score.textContent = `${p.coins} SOLX`;
    score.style.fontWeight = '800';
    score.style.color = 'rgba(255,255,255,0.95)';

    left.appendChild(rank);
    left.appendChild(avatarWrap);
    left.appendChild(nameBlock);

    row.appendChild(left);
    row.appendChild(score);
    list.appendChild(row);
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

    // center bias
    const dxCenter = (centerX - b.x);
    const axCenter = dxCenter * centerBias * 0.001;
    b.vx += axCenter * dt;

    // integrate
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

/* =================== BOOSTS ==================== */
function msToHMS(ms){
  const s = Math.max(0, Math.floor(ms/1000));
  const h = Math.floor(s/3600);
  const m = Math.floor((s%3600)/60);
  const ss = s%60;
  return `${h}h ${m}m ${ss}s`;
}

function renderBoosts(){
  const wrap = dom.boostList || document.getElementById('boostList');
  if (!wrap) return;
  wrap.innerHTML = '';

  const cards = [
    {
      key: 'speedster',
      title: '⚡️ Speedster',
      desc: 'Balls regenerate 2× faster for 24 hours.',
      cost: 500,
      active: isSpeedsterActive(),
      expiresAt: boosts.speedsterUntil || 0,
      action: buySpeedster
    },
    {
      key: 'maxi',
      title: '☄️ Maxi',
      desc: 'Max balls increases to 500/500 for 24 hours.',
      cost: 5000,
      active: isMaxiActive(),
      expiresAt: boosts.maxiUntil || 0,
      action: buyMaxi
    },
    {
      key: 'spender',
      title: '🪙 Spender',
      desc: 'Purchase 100 ball drops instantly.',
      cost: 2500,
      active: false,
      expiresAt: 0,
      action: buySpender
    }
  ];

  cards.forEach(card => {
    const C = document.createElement('div');
    C.style.background = 'rgba(255,255,255,0.05)';
    C.style.border = '1px solid rgba(255,255,255,0.06)';
    C.style.borderRadius = '16px';
    C.style.padding = '14px';
    C.style.display = 'flex';
    C.style.flexDirection = 'column';
    C.style.gap = '8px';
    C.style.alignItems = 'center';
    C.style.textAlign = 'center';
    C.style.marginBottom = '10px';

    const T = document.createElement('div');
    T.textContent = card.title;
    T.style.fontWeight = '800';
    T.style.color = 'rgba(255,255,255,0.95)';
    T.style.textShadow = '0 0 2px #000, 0 0 2px #000';

    const D = document.createElement('div');
    D.textContent = card.desc;
    D.style.color = 'rgba(255,255,255,0.8)';
    D.style.fontSize = '13px';

    const status = document.createElement('div');
    status.style.color = card.active ? '#14F195' : 'rgba(255,255,255,0.55)';
    status.style.fontWeight = '700';
    status.style.fontSize = '12px';
    status.textContent = card.active
      ? `Active • ${msToHMS((card.expiresAt || 0) - Date.now())} left`
      : `Cost: ${card.cost} SOLX`;

    const btn = document.createElement('button');
    btn.textContent = card.active ? 'Active' : 'Buy';
    btn.disabled = card.active || coins < card.cost;
    stylePrimaryButton(btn); // same colors as Drop
    btn.style.minWidth = '140px';
    btn.addEventListener('click', () => {
      if (btn.disabled) return;
      card.action(card.cost);
    });

    C.appendChild(T); C.appendChild(D); C.appendChild(status); C.appendChild(btn);
    wrap.appendChild(C);
  });

  // Update every second to refresh countdowns if visible
  if (!renderBoosts._timer){
    renderBoosts._timer = setInterval(()=> {
      if (document.getElementById('screen-boost')?.classList.contains('active')){
        renderBoosts();
      }
    }, 1000);
  }
}

function buySpeedster(cost){
  if (coins < cost) return;
  coins -= cost;
  boosts.speedsterUntil = Date.now() + 24*3600*1000;
  updateUI();
  showModal('<div style="font-weight:800;font-size:16px">⚡️ Speedster activated for 24h!</div>');
}

function buyMaxi(cost){
  if (coins < cost) return;
  coins -= cost;
  boosts.maxiUntil = Date.now() + 24*3600*1000;
  // if new max < current balls? (won’t happen, it increases) — ensure cap next expiry
  if (balls > effectiveMaxBalls()) balls = effectiveMaxBalls();
  updateUI();
  showModal('<div style="font-weight:800;font-size:16px">☄️ Maxi activated: Max 500 for 24h!</div>');
}

function buySpender(cost){
  if (coins < cost) return;
  coins -= cost;
  balls = Math.min(effectiveMaxBalls(), balls + 100);
  updateUI();
  showModal('<div style="font-weight:800;font-size:16px">🪙 +100 balls added!</div>');
}

/* ================== REGEN ===================== */
function startRegen(){
  // normalize lastRegen if max has changed
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

  // countdown text
  if (regenCountdownInterval) clearInterval(regenCountdownInterval);
  regenCountdownInterval = setInterval(() => {
    const secs = Math.max(0, Math.floor(effectiveRegenSeconds() - (Date.now() - lastRegen)/1000));
    dom.regenTimer && (dom.regenTimer.textContent = `${secs}s`);
  }, 1000);

  // tick to add balls
  if (regenInterval) clearInterval(regenInterval);
  regenInterval = setInterval(() => {
    if (balls < effectiveMaxBalls()) { balls += 1; lastRegen = Date.now(); updateUI(); }
    else lastRegen = Date.now();
  }, effectiveRegenSeconds() * 1000);
}

/* ======= Modal (existing) ======= */
function showModal(html){ if (!dom.modal) return; dom.modalContent.innerHTML = html; dom.modal.classList.remove('hidden'); }
function hideModal(){ dom.modal?.classList.add('hidden'); }

/* ======= Screen nav helper ======= */
function showScreen(k){
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  const id = 'screen-' + (k==='plinko' ? 'plinko' : k);
  document.getElementById(id)?.classList.add('active');
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  const active = Array.from(document.querySelectorAll('.nav-btn')).find(b => b.dataset.target === k);
  if (active) active.classList.add('active');

  if (k === 'leaderboard') renderLeaderboard();
  if (k === 'boost') renderBoosts();
}

/* ======= THEME / AESTHETICS ======= */
function initTheme(){
  // 1) Galaxy / Solana background (very dark)
  Object.assign(document.body.style, {
    background: 'radial-gradient(1200px 700px at 80% -10%, rgba(20,241,149,0.12), rgba(0,0,0,0)),'+
                'radial-gradient(900px 500px at 0% 120%, rgba(153,69,255,0.14), rgba(0,0,0,0)),'+
                'linear-gradient(180deg, #0b0b12 0%, #05060a 100%)',
    backgroundAttachment: 'fixed',
    color: 'rgba(255,255,255,0.95)'
  });

  // 2) Button text outline (white bold with black outline)
  // Apply to primary buttons we can access
  if (dom.dropBtn) {
    stylePrimaryButton(dom.dropBtn);
    dom.dropBtn.style.textShadow = '0 0 2px #000, 0 0 2px #000';
  }
  // Balance counter box aesthetics
  const boxTargets = [dom.coinsCount, dom.balance];
  boxTargets.forEach(el => {
    if (!el) return;
    el.style.fontWeight = '800';
    el.style.color = '#fff';
    el.style.textShadow = '0 0 2px #000, 0 0 2px #000';
    if (el.parentElement){
      el.parentElement.style.background = 'rgba(255,255,255,0.06)';
      el.parentElement.style.border = '1px solid rgba(255,255,255,0.14)';
      el.parentElement.style.borderRadius = '14px';
      el.parentElement.style.padding = '8px 12px';
      el.parentElement.style.backdropFilter = 'blur(4px)';
    }
  });

  // 3) Headings/subheadings text changes
  if (dom.title) dom.title.textContent = 'SOLMAS Plinko';
  if (dom.subtitle) dom.subtitle.textContent = 'Every drop is a win';
  if (dom.chadSantaText && dom.chadSantaText.remove) dom.chadSantaText.remove(); // remove placeholder line

  // 4) Rename Loot -> Boost; “Open Lootbox” -> “Boosters” and route to Boost
  document.querySelectorAll('.nav-btn').forEach(b => {
    if (b.textContent?.toLowerCase().includes('loot')) {
      b.textContent = '🚀 Boost';
      b.dataset.target = 'boost';
      styleSecondaryButton(b);
    }
  });
  if (dom.openLoot) { dom.openLoot.textContent = '🚀 Boost'; dom.openLoot.dataset.target = 'boost'; }
  if (dom.openLootbox) { dom.openLootbox.textContent = 'Boosters'; dom.openLootbox.onclick = () => showScreen('boost'); }
  if (dom.boostersBtn) { dom.boostersBtn.onclick = () => showScreen('boost'); }

  // Make other buttons text outlined too
  document.querySelectorAll('button').forEach(btn=>{
    btn.style.fontWeight = '800';
    btn.style.color = '#fff';
    btn.style.textShadow = '0 0 2px #000, 0 0 2px #000';
  });
}

// primary button style (same palette as Drop)
function stylePrimaryButton(btn){
  if (!btn) return;
  btn.style.background = 'linear-gradient(90deg,#9945FF,#0ABDE3)';
  btn.style.border = 'none';
  btn.style.borderRadius = '14px';
  btn.style.padding = '10px 16px';
  btn.style.fontWeight = '800';
  btn.style.color = '#fff';
  btn.style.cursor = 'pointer';
}
function styleSecondaryButton(btn){
  if (!btn) return;
  btn.style.background = 'rgba(255,255,255,0.06)';
  btn.style.border = '1px solid rgba(255,255,255,0.14)';
  btn.style.borderRadius = '12px';
  btn.style.padding = '8px 12px';
  btn.style.fontWeight = '800';
  btn.style.color = '#fff';
}

/* ================== EVENTS ==================== */
document.getElementById('dropBtn')?.addEventListener('click', dropBall);
dom.openLeaderboard?.addEventListener('click', ()=> showScreen('leaderboard'));
dom.backFromLeaderboard?.addEventListener('click', ()=> showScreen('plinko'));
dom.backFromLoot?.addEventListener('click', ()=> showScreen('plinko'));
dom.backFromRef?.addEventListener('click', ()=> showScreen('plinko'));
document.querySelectorAll('.nav-btn').forEach(b => b.addEventListener('click', ()=> showScreen(b.dataset.target)));

// “Loot” -> “Boost”
dom.openLoot?.addEventListener('click', ()=> showScreen('boost'));
dom.openLootbox?.addEventListener('click', ()=> showScreen('boost'));
dom.boostersBtn?.addEventListener('click', ()=> showScreen('boost'));

dom.closeModalBtn && dom.closeModalBtn.addEventListener('click', hideModal);

/* =================== INIT ===================== */
let loopStarted = false;
function init(){
  initTheme();
  fitCanvas();
  buildObstaclesAndBins();
  // ensure caps consistent if boosts active on load
  if (balls > effectiveMaxBalls()) balls = effectiveMaxBalls();
  updateUI();
  renderLeaderboard();
  renderBoosts();
  startRegen();
  if (!loopStarted) { loopStarted = true; requestAnimationFrame(step); }
}
window.addEventListener('resize', ()=> { fitCanvas(); buildObstaclesAndBins(); });
init();
