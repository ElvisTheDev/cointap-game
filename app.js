/* app.js - Triangular plinko with circle obstacles and physics collisions */

/* CONFIG */
const payouts = [100,50,20,5,1,1,5,20,50,100]; // 10 bins (unchanged)
const binsCount = payouts.length;
const obstacleRows = [3,4,5,6,7,8,9,10,11]; // exactly as requested: row1=3, row2=4, ... row9=11
const ballRadius = 8;            // px
const obstacleRadius = 8;       // px (same visual size)
const gravity = 1200;           // px / s^2 (feel free to tweak)
const restitution = 0.72;       // bounce energy retention
const friction = 0.995;         // air friction per frame (0-1)
const maxBalls = 100;
const regenSeconds = 60;

/* Telegram init (same as before) */
const TELEGRAM = window.Telegram && window.Telegram.WebApp ? window.Telegram.WebApp : null;
if (TELEGRAM) { try { TELEGRAM.ready(); } catch(e) {} }

/* DOM */
const canvas = document.getElementById('plinkoCanvas');
const ctx = canvas.getContext('2d');
const dom = {
  ballsCount: document.getElementById('ballsCount'),
  regenTimer: document.getElementById('regenTimer'),
  dropBtn: document.getElementById('dropBtn'),
  coinsCount: document.getElementById('coinsCount'),
  balance: document.getElementById('balance'),
  openLoot: document.getElementById('openLoot'),
  openLeaderboard: document.getElementById('openLeaderboard'),
  leaderboardList: document.getElementById('leaderboardList'),
  modal: document.getElementById('modal'),
  modalContent: document.getElementById('modalContent'),
  closeModalBtn: document.getElementById('closeModal')
};

/* state */
let coins = Number(localStorage.getItem('sc_coins') || 0);
let balls = Number(localStorage.getItem('sc_balls') || maxBalls);
if (isNaN(balls)) balls = maxBalls;
let lastRegen = Number(localStorage.getItem('sc_lastRegen') || Date.now());
let regenInterval = null, regenCountdownInterval = null;
let obstacles = [];   // {x,y,r}
let bins = [];        // bin rects
let ballsInFlight = []; // {x,y,vx,vy,r,alive}
let user = (TELEGRAM && TELEGRAM.initDataUnsafe && TELEGRAM.initDataUnsafe.user) ? TELEGRAM.initDataUnsafe.user : { id: 'local_'+Math.floor(Math.random()*99999), first_name: 'You' };

/* helpers */
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

/* UI */
function updateUI(){
  dom.coinsCount.textContent = `${coins} SOLX`;
  dom.balance.textContent = `${coins} SOLX`;
  dom.ballsCount.textContent = `${balls}`;
  saveState();
  saveScoreLocal();
}

/* resize canvas to CSS size * devicePixelRatio */
function fitCanvas(){
  const cssWidth = Math.min(window.innerWidth * 0.92, 720);
  const cssHeight = Math.max(360, window.innerHeight * 0.46);
  canvas.style.width = cssWidth + 'px';
  canvas.style.height = cssHeight + 'px';
  const ratio = window.devicePixelRatio || 1;
  canvas.width = Math.round(cssWidth * ratio);
  canvas.height = Math.round(cssHeight * ratio);
  ctx.setTransform(ratio,0,0,ratio,0,0);
}

/* Build triangular obstacle grid using obstacleRows */
function buildObstaclesAndBins(){
  obstacles = [];
  bins = [];
  const W = canvas.clientWidth;
  const H = canvas.clientHeight;
  const topPadding = 28;
  const bottomArea = 88;
  const usableH = H - topPadding - bottomArea;

  // for each row create given count, center them horizontally
  for (let r = 0; r < obstacleRows.length; r++){
    const count = obstacleRows[r];
    const y = topPadding + (r / (obstacleRows.length - 1)) * usableH;
    for (let i = 0; i < count; i++){
      // spread pegs across width but keep outer margins
      const leftMargin = W * 0.08;
      const rightMargin = W * 0.92;
      const x = leftMargin + ((i + 1) / (count + 1)) * (rightMargin - leftMargin);
      obstacles.push({ x, y, r: obstacleRadius });
    }
  }

  // bins: divide bottom width into binsCount equal buckets
  const binsY = H - bottomArea + 8;
  const binWidth = (W - 16) / binsCount;
  for (let i = 0; i < binsCount; i++){
    const x = 8 + i * binWidth;
    bins.push({ x, y: binsY, w: binWidth - 4, h: bottomArea - 16, i });
  }
}

/* physics helpers */
function collidingCircleCircle(a, b){
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dist2 = dx*dx + dy*dy;
  const minR = (a.r + b.r);
  return dist2 < (minR * minR);
}
function resolveCircleCollision(ball, obs){
  // vector from obstacle to ball
  let nx = ball.x - obs.x;
  let ny = ball.y - obs.y;
  const dist = Math.hypot(nx, ny) || 0.0001;
  // normalize
  nx /= dist; ny /= dist;
  // push ball out so just touching
  const overlap = (ball.r + obs.r) - dist;
  ball.x += nx * (overlap + 0.5);
  ball.y += ny * (overlap + 0.5);
  // reflect velocity across normal
  const vdotn = ball.vx * nx + ball.vy * ny;
  ball.vx = ball.vx - 2 * vdotn * nx;
  ball.vy = ball.vy - 2 * vdotn * ny;
  // apply restitution and small random spin
  ball.vx *= restitution;
  ball.vy *= restitution;
  // add tiny random lateral velocity to avoid infinite loops
  ball.vx += (Math.random() - 0.5) * 20;
}

/* simulate step for all balls */
let lastTime = null;
function step(now){
  if (!lastTime) lastTime = now;
  const dt = Math.min(0.032, (now - lastTime) / 1000); // cap dt ~32ms
  lastTime = now;

  // physics per ball
  for (let bi = ballsInFlight.length - 1; bi >= 0; bi--){
    const b = ballsInFlight[bi];
    if (!b.alive) { ballsInFlight.splice(bi,1); continue; }

    // integrate velocity
    b.vy += gravity * dt;
    b.vx *= Math.pow(friction, dt*60); // friction scaled by FPS
    b.vy *= Math.pow(friction, dt*60);

    b.x += b.vx * dt;
    b.y += b.vy * dt;

    // wall collision (left/right)
    const W = canvas.clientWidth;
    if (b.x - b.r < 4){
      b.x = 4 + b.r;
      b.vx = Math.abs(b.vx) * restitution;
    }
    if (b.x + b.r > W - 4){
      b.x = W - 4 - b.r;
      b.vx = -Math.abs(b.vx) * restitution;
    }

    // obstacle collisions
    for (let oi = 0; oi < obstacles.length; oi++){
      const obs = obstacles[oi];
      if (collidingCircleCircle(b, obs)){
        resolveCircleCollision(b, obs);
      }
    }

    // bottom detection: if ball.y > threshold -> compute bin and award then remove
    const H = canvas.clientHeight;
    const bottomTrigger = H - 96; // if ball passes this, we consider it in bins area
    if (b.y + b.r >= bottomTrigger){
      // map x to bin index
      const W2 = canvas.clientWidth;
      let binIndex = Math.floor((b.x / W2) * binsCount);
      binIndex = Math.max(0, Math.min(binsCount - 1, binIndex));
      // award
      const reward = payouts[binIndex] || 0;
      coins += reward;
      // remove ball (silent)
      ballsInFlight.splice(bi, 1);
      // Save & update, but no modal
      updateUI();
      continue;
    }
  }

  // render
  render();

  // next frame
  requestAnimationFrame(step);
}

/* render function draws obstacles, bins and balls */
function render(){
  const W = canvas.clientWidth;
  const H = canvas.clientHeight;
  ctx.clearRect(0,0,W,H);

  // subtle background gradient already on canvas CSS; draw slight vignette
  // draw obstacles
  ctx.fillStyle = 'rgba(255,255,255,0.14)';
  for (let o of obstacles){
    ctx.beginPath();
    ctx.arc(o.x, o.y, o.r, 0, Math.PI*2);
    ctx.fill();
  }

  // draw bins
  for (let i = 0; i < bins.length; i++){
    const b = bins[i];
    // draw bin box
    ctx.fillStyle = 'rgba(255,255,255,0.03)';
    ctx.fillRect(b.x, b.y, b.w, b.h);
    // draw payout label
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.font = 'bold 12px Inter, system-ui';
    ctx.textAlign = 'center';
    ctx.fillText(String(payouts[i]), b.x + b.w/2, b.y + b.h/2 + 6);
  }

  // draw balls in flight
  for (let b of ballsInFlight){
    ctx.beginPath();
    ctx.fillStyle = '#fff';
    ctx.arc(b.x, b.y, b.r, 0, Math.PI*2);
    ctx.fill();
  }

  // draw top drop indicator (optional)
  // draw separators for bins
  ctx.strokeStyle = 'rgba(255,255,255,0.04)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 1; i < bins.length; i++){
    const bx = bins[0].x + i * (bins[0].w + 4);
    ctx.moveTo(bx, bins[0].y);
    ctx.lineTo(bx, H);
  }
  ctx.stroke();
}

/* drop a ball - spawn with initial velocity near zero */
function dropBall(){
  if (balls <= 0) {
    showModal('<div style="font-weight:700">No balls left — wait for regen</div>');
    return;
  }
  balls -= 1;
  updateUI();
  // spawn ball near top middle
  const W = canvas.clientWidth;
  const startX = W * 0.5 + (Math.random() - 0.5) * 18; // small jitter
  const startY = 24;
  const initVx = (Math.random() - 0.5) * 80;
  const initVy = 40 + Math.random() * 40;
  ballsInFlight.push({ x: startX, y: startY, vx: initVx, vy: initVy, r: ballRadius, alive: true });
}

/* regen logic */
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

/* modal helper */
function showModal(html){
  dom.modalContent.innerHTML = html;
  dom.modal.classList.remove('hidden');
}
function hideModal(){ dom.modal.classList.add('hidden'); }

/* leaderboard local fallback */
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

/* event bindings */
document.getElementById('dropBtn').addEventListener('click', dropBall);
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
document.getElementById('copyRef').addEventListener('click', async ()=> {
  const inp = document.getElementById('refLink');
  try { await navigator.clipboard.writeText(inp.value); showModal('<div style="font-weight:700">Link copied ✅</div>'); }
  catch(e){ showModal('<div style="font-weight:700">Copy failed — select manually</div>'); }
});
dom.closeModalBtn && dom.closeModalBtn.addEventListener('click', hideModal);

/* screen helper */
function showScreen(k){
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById('screen-' + (k==='plinko' ? 'plinko' : k)).classList.add('active');
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  const active = Array.from(document.querySelectorAll('.nav-btn')).find(b => b.dataset.target === k);
  if (active) active.classList.add('active');
  if (k === 'leaderboard') renderLeaderboard();
}

/* init */
function init(){
  fitCanvas();
  buildObstaclesAndBins();
  updateUI();
  renderLeaderboard();
  startRegen();

  // start physics loop
  requestAnimationFrame(step);
}
window.addEventListener('resize', ()=> { fitCanvas(); buildObstaclesAndBins(); });
init();
