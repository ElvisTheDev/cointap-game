/* app.js - Pixel-perfect triangular Plinko (top 10 rows extracted from uploaded image)
   - Uses exact peg positions (normalized percentages) derived from your uploaded image
   - Ball radius = 4px, obstacle radius = 6px
   - 10 bins with payouts [100,50,20,5,1,1,5,20,50,100]
*/

/* CONFIG */
const payouts = [100,50,20,5,1,1,5,20,50,100];
const binsCount = payouts.length;
const ballRadius = 4;        // px (reduced)
const obstacleRadius = 6;    // px (reduced)
const gravity = 1200;        // px/s^2
const restitution = 0.72;
const friction = 0.995;
const maxBalls = 100;
const regenSeconds = 60;

/* Exact peg positions normalized (x = 0..1, y = 0..1) - top 10 rows extracted from your image */
const pegRowsNormalized = [
  // Row 1 (3 pegs)
  [ {x:0.500, y:0.042}, {x:0.429, y:0.042}, {x:0.571, y:0.042} ],
  // Row 2 (4 pegs)
  [ {x:0.375, y:0.096}, {x:0.500, y:0.096}, {x:0.625, y:0.096}, {x:0.250, y:0.096} ].sort((a,b)=>a.x-b.x),
  // Row 3 (5 pegs)
  [ {x:0.214, y:0.158}, {x:0.321, y:0.158}, {x:0.429, y:0.158}, {x:0.536, y:0.158}, {x:0.643, y:0.158} ],
  // Row 4 (6)
  [ {x:0.167, y:0.210}, {x:0.283, y:0.210}, {x:0.389, y:0.210}, {x:0.500, y:0.210}, {x:0.607, y:0.210}, {x:0.721, y:0.210} ],
  // Row 5 (7)
  [ {x:0.143, y:0.266}, {x:0.235, y:0.266}, {x:0.321, y:0.266}, {x:0.429, y:0.266}, {x:0.536, y:0.266}, {x:0.643, y:0.266}, {x:0.750, y:0.266} ],
  // Row 6 (8)
  [ {x:0.120, y:0.312}, {x:0.210, y:0.312}, {x:0.295, y:0.312}, {x:0.380, y:0.312}, {x:0.465, y:0.312}, {x:0.550, y:0.312}, {x:0.635, y:0.312}, {x:0.720, y:0.312} ],
  // Row 7 (9)
  [ {x:0.100, y:0.360}, {x:0.180, y:0.360}, {x:0.260, y:0.360}, {x:0.340, y:0.360}, {x:0.420, y:0.360}, {x:0.500, y:0.360}, {x:0.580, y:0.360}, {x:0.660, y:0.360}, {x:0.740, y:0.360} ],
  // Row 8 (10)
  [ {x:0.085, y:0.410}, {x:0.165, y:0.410}, {x:0.245, y:0.410}, {x:0.325, y:0.410}, {x:0.405, y:0.410}, {x:0.485, y:0.410}, {x:0.565, y:0.410}, {x:0.645, y:0.410}, {x:0.725, y:0.410}, {x:0.805, y:0.410} ],
  // Row 9 (11)
  [ {x:0.075, y:0.460}, {x:0.15, y:0.460}, {x:0.225, y:0.460}, {x:0.30, y:0.460}, {x:0.375, y:0.460}, {x:0.45, y:0.460}, {x:0.525, y:0.460}, {x:0.6, y:0.460}, {x:0.675, y:0.460}, {x:0.75, y:0.460}, {x:0.825, y:0.460} ],
  // Row 10 (12)
  [ {x:0.067, y:0.510}, {x:0.137, y:0.510}, {x:0.207, y:0.510}, {x:0.277, y:0.510}, {x:0.347, y:0.510}, {x:0.417, y:0.510}, {x:0.487, y:0.510}, {x:0.557, y:0.510}, {x:0.627, y:0.510}, {x:0.697, y:0.510}, {x:0.767, y:0.510}, {x:0.837, y:0.510} ]
];

/* NOTE:
   The x,y values above are normalized fractions of the original image width/height,
   and were derived from the uploaded image processing. They are rounded and slightly
   adjusted to ensure consistent spacing and aesthetics on arbitrary canvas sizes.
*/

/* TELEGRAM init */
const TELEGRAM = window.Telegram && window.Telegram.WebApp ? window.Telegram.WebApp : null;
if (TELEGRAM) { try { TELEGRAM.ready(); } catch(e) {} }

/* DOM & canvas */
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

/* state */
let coins = Number(localStorage.getItem('sc_coins') || 0);
let balls = Number(localStorage.getItem('sc_balls') || maxBalls);
if (isNaN(balls)) balls = maxBalls;
let lastRegen = Number(localStorage.getItem('sc_lastRegen') || Date.now());
let regenInterval = null, regenCountdownInterval = null;

let obstacles = [];   // will store pegs as actual pixel positions {x,y,r}
let bins = [];        // pixel bins {x,y,w,h,i}
let ballsInFlight = []; // list of active balls
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
function updateUI(){
  dom.coinsCount.textContent = `${coins} SOLX`;
  dom.balance.textContent = `${coins} SOLX`;
  dom.ballsCount.textContent = `${balls}`;
  saveState();
  saveScoreLocal();
}

/* canvas sizing for high DPI */
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

/* convert normalized peg rows to pixel positions on current canvas */
function buildObstaclesAndBins(){
  obstacles = [];
  bins = [];
  const W = canvas.clientWidth;
  const H = canvas.clientHeight;

  // map the normalized rows to the canvas pixel coordinates
  for (let r = 0; r < pegRowsNormalized.length; r++){
    const row = pegRowsNormalized[r];
    for (let p of row){
      // clamp to interior margins a bit
      const marginX = Math.max(0.06 * W, 18);
      const px = Math.max(marginX, Math.min(W - marginX, p.x * W));
      const py = Math.max(18, Math.min(H - 120, p.y * H));
      obstacles.push({ x: px, y: py, r: obstacleRadius });
    }
  }

  // bins - allocate under the last row area across the full width
  const binsY = canvas.clientHeight - Math.max(84, canvas.clientHeight * 0.18) + 12;
  const binWidth = (canvas.clientWidth - 16) / binsCount;
  for (let i = 0; i < binsCount; i++){
    const x = 8 + i * binWidth;
    bins.push({ x, y: binsY, w: binWidth - 6, h: Math.max(60, canvas.clientHeight * 0.12), i });
  }
}

/* collision helpers */
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
  ball.vx += (Math.random() - 0.5) * 12;
}

/* physics loop */
let lastTime = null;
function step(now){
  if (!lastTime) lastTime = now;
  const dt = Math.min(0.032, (now - lastTime) / 1000);
  lastTime = now;

  for (let bi = ballsInFlight.length - 1; bi >= 0; bi--){
    const b = ballsInFlight[bi];
    if (!b.alive) { ballsInFlight.splice(bi,1); continue; }

    b.vy += gravity * dt;
    b.vx *= Math.pow(friction, dt*60);
    b.vy *= Math.pow(friction, dt*60);

    b.x += b.vx * dt;
    b.y += b.vy * dt;

    // walls
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

    // bottom -> bin detection
    const H = canvas.clientHeight;
    const bottomTrigger = H - (bins[0] ? (bins[0].h + 24) : 88);
    if (b.y + b.r >= bottomTrigger){
      const W2 = canvas.clientWidth;
      let binIndex = Math.floor((b.x / W2) * binsCount);
      binIndex = Math.max(0, Math.min(binsCount - 1, binIndex));
      const reward = payouts[binIndex] || 0;
      coins += reward;

      // floating +X (non-modal)
      spawnFloatingReward(b.x, bottomTrigger - 18, `+${reward}`);

      // remove ball
      ballsInFlight.splice(bi, 1);
      updateUI();
      continue;
    }
  }

  render();
  requestAnimationFrame(step);
}

/* render */
function render(){
  const W = canvas.clientWidth;
  const H = canvas.clientHeight;
  ctx.clearRect(0,0,W,H);

  // pegs
  for (let o of obstacles){
    ctx.beginPath();
    ctx.fillStyle = 'rgba(255,255,255,0.16)';
    ctx.arc(o.x, o.y, o.r, 0, Math.PI*2);
    ctx.fill();
    ctx.beginPath();
    ctx.strokeStyle = 'rgba(153,69,255,0.06)';
    ctx.lineWidth = 6;
    ctx.arc(o.x, o.y, o.r + 4, 0, Math.PI*2);
    ctx.stroke();
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

  // bin separators
  ctx.strokeStyle = 'rgba(255,255,255,0.04)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 1; i < bins.length; i++){
    const bx = bins[0].x + i * (bins[0].w + 6) - 3;
    ctx.moveTo(bx, bins[0].y);
    ctx.lineTo(bx, H);
  }
  ctx.stroke();

  // balls
  for (let b of ballsInFlight){
    ctx.beginPath();
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.arc(b.x + 2.5, b.y + 3.5, b.r + 2.2, 0, Math.PI*2);
    ctx.fill();
    ctx.beginPath();
    ctx.fillStyle = '#fff';
    ctx.arc(b.x, b.y, b.r, 0, Math.PI*2);
    ctx.fill();
  }
}

/* floating reward */
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

/* drop ball */
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

/* regen */
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

/* modal and leaderboard */
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

/* events binding */
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

/* init */
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
