/* app.js - Centered pyramid peg placement (same rows/counts preserved)
   - Rows: [3,4,5,6,7,8,9,10,11,12]
   - Ball r = 4px, Peg r = 6px
   - Physics: gravity, restitution, friction, circle collisions
   - Pixel-friendly, responsive, and centered in the mini app
*/

/* CONFIG */
const payouts = [100,50,20,5,1,1,5,20,50,100];
const binsCount = payouts.length;
const ballRadius = 4;        // px
const obstacleRadius = 6;    // px
const gravity = 1200;        // px/s^2
const restitution = 0.72;
const friction = 0.995;
const maxBalls = 100;
const regenSeconds = 60;

/* Peg counts per row (top -> bottom). Keeps same totals as before. */
const obstacleRows = [3,4,5,6,7,8,9,10,11,12]; // 10 rows

/* TELEGRAM init (safe no-op outside Telegram) */
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
let bins = [];        // {x,y,w,h,i}
let ballsInFlight = []; // {x,y,vx,vy,r,alive}
let user = (TELEGRAM && TELEGRAM.initDataUnsafe && TELEGRAM.initDataUnsafe.user) ? TELEGRAM.initDataUnsafe.user : { id: 'local_'+Math.floor(Math.random()*99999), first_name: 'You' };

/* Persistence helpers */
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

/* UI update */
function updateUI(){
  dom.coinsCount.textContent = `${coins} SOLX`;
  dom.balance.textContent = `${coins} SOLX`;
  dom.ballsCount.textContent = `${balls}`;
  saveState();
  saveScoreLocal();
}

/* Canvas sizing (high-DPI aware) */
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

/* Build a centered pyramid:
   - Uses obstacleRows counts
   - Calculates horizontal spacing based on the widest row (bottom)
   - Centers each row horizontally
   - Even vertical spacing between rows
*/
function buildObstaclesAndBins(){
  obstacles = [];
  bins = [];

  const W = canvas.clientWidth;
  const H = canvas.clientHeight;

  const topPadding = Math.max(18, H * 0.04);
  const bottomReserve = Math.max(84, H * 0.18);
  const usableH = H - topPadding - bottomReserve;

  // widest row (bottom) determines horizontal spacing
  const widestCount = Math.max(...obstacleRows);
  // leave side margins so pegs aren't at the very edges
  const sideMargin = Math.max(0.06 * W, 24);
  // available width for pegs
  const availableWidth = W - sideMargin * 2;
  // horizontal spacing between peg centers for the bottom row
  const baseSpacing = availableWidth / (widestCount + 1); // +1 to create margin on both sides

  // vertical spacing evenly across rows
  const rowsCount = obstacleRows.length;
  const vSpacing = usableH / (rowsCount + 1); // +1 to leave top breathing room

  for (let r = 0; r < rowsCount; r++){
    const count = obstacleRows[r];
    // spacing for this row: keep same baseSpacing but center row so it's narrower near top
    const rowWidth = baseSpacing * (count + 1);
    const rowLeft = (W - rowWidth) / 2;
    const y = topPadding + (r + 1) * vSpacing;

    for (let i = 0; i < count; i++){
      const x = rowLeft + (i + 1) * baseSpacing;
      obstacles.push({ x, y, r: obstacleRadius });
    }
  }

  // bins: center under pyramid, spanning same availableWidth as pegs
  const binsY = H - bottomReserve + 12;
  const binWidth = availableWidth / binsCount;
  // left-most bin x coordinate (match pyramid centering)
  const binsLeft = (W - availableWidth) / 2;
  for (let i = 0; i < binsCount; i++){
    const x = binsLeft + i * binWidth;
    bins.push({ x, y: binsY, w: Math.max(24, binWidth - 6), h: Math.max(60, bottomReserve - 24), i });
  }
}

/* Collision helpers */
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

/* Physics loop */
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

    // left/right wall collisions
    const W = canvas.clientWidth;
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

    // bottom detection -> bin
    const H = canvas.clientHeight;
    const bottomTrigger = H - (bins[0] ? (bins[0].h + 24) : 88);
    if (b.y + b.r >= bottomTrigger){
      const W2 = canvas.clientWidth;
      // map to bins with the same centered availableWidth
      const binsLeft = bins[0] ? bins[0].x : 8;
      const availableWidth = (bins[bins.length-1].x + bins[bins.length-1].w) - binsLeft;
      let relX = (b.x - binsLeft) / availableWidth;
      relX = Math.max(0, Math.min(0.9999, relX));
      let binIndex = Math.floor(relX * binsCount);
      binIndex = Math.max(0, Math.min(binsCount - 1, binIndex));
      const reward = payouts[binIndex] || 0;
      coins += reward;

      // floating +X animation
      spawnFloatingReward(b.x, bottomTrigger - 18, `+${reward}`);

      ballsInFlight.splice(bi, 1);
      updateUI();
      continue;
    }
  }

  render();
  requestAnimationFrame(step);
}

/* Render everything */
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

  // bins (centered)
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
    const prev = bins[0];
    const bx = prev.x + i * (prev.w + 6);
    ctx.moveTo(bx, prev.y);
    ctx.lineTo(bx, H);
  }
  ctx.stroke();

  // balls
  for (let b of ballsInFlight){
    // shadow
    ctx.beginPath();
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.arc(b.x + 2.5, b.y + 3.5, b.r + 2.2, 0, Math.PI*2);
    ctx.fill();
    // ball
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

/* spawn ball */
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

/* modal & leaderboard */
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

/* events */
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
