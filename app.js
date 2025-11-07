/* app.js - Plinko mechanics + UI interactions */

/* Optional Firebase: paste config in firebaseConfig and uncomment init lines near top */

// TELEGRAM
const TELEGRAM = window.Telegram && window.Telegram.WebApp ? window.Telegram.WebApp : null;
if (TELEGRAM) {
  try { TELEGRAM.ready(); } catch (e) {}
}

// --- Optional Firebase setup (uncomment to use) ---
// const firebaseConfig = { /* paste your firebase config */ };
// let db = null;
// if (window.firebase) { firebase.initializeApp(firebaseConfig); db = firebase.database(); }

const payouts = [100,50,20,5,1,1,5,20,50,100]; // bins 0..9
const binsCount = payouts.length;
const rows = binsCount - 1; // plinko rows for binomial-style distribution

// elements
const el = {
  ballsCount: document.getElementById('ballsCount'),
  regenTimer: document.getElementById('regenTimer'),
  dropBtn: document.getElementById('dropBtn'),
  plinkoBoard: document.getElementById('plinkoBoard'),
  coinsCount: document.getElementById('coinsCount'),
  balance: document.getElementById('balance'),
  openLoot: document.getElementById('openLoot'),
  openLeaderboard: document.getElementById('openLeaderboard'),
  leaderboardList: document.getElementById('leaderboardList'),
  modal: document.getElementById('modal'),
  modalContent: document.getElementById('modalContent'),
  closeModalBtn: document.getElementById('closeModal')
};

// state
let coins = Number(localStorage.getItem('sc_coins') || 0);
let balls = Number(localStorage.getItem('sc_balls') || 100);
if (isNaN(balls)) balls = 100;
const maxBalls = 100;
let lastRegen = Number(localStorage.getItem('sc_lastRegen') || Date.now());
let regenInterval = null;
let regenCountdownInterval = null;
let user = (TELEGRAM && TELEGRAM.initDataUnsafe && TELEGRAM.initDataUnsafe.user) ? TELEGRAM.initDataUnsafe.user : { id: 'local_'+Math.floor(Math.random()*99999), first_name: 'You'};

// persist helpers
function saveState() {
  localStorage.setItem('sc_coins', String(coins));
  localStorage.setItem('sc_balls', String(balls));
  localStorage.setItem('sc_lastRegen', String(lastRegen));
}
function saveScoreToLocal() {
  const scores = JSON.parse(localStorage.getItem('sc_scores') || '{}');
  scores[user.id] = { name: user.first_name || 'Player', coins };
  localStorage.setItem('sc_scores', JSON.stringify(scores));
}

// UI updates
function updateUI() {
  el.coinsCount.textContent = `${coins} SOLX`;
  el.balance.textContent = `${coins} SOLX`;
  el.ballsCount.textContent = `${balls}`;
  saveState();
  saveScoreToLocal();
}

// build a simple visual plinko board (pegs + bins)
function buildBoard() {
  el.plinkoBoard.innerHTML = ''; // clear
  const board = document.createElement('div');
  board.style.position = 'relative';
  board.style.width = '100%';
  board.style.height = '100%';
  el.plinkoBoard.appendChild(board);

  // pegs per row: rows 1..rows with alternating offsets
  const boardRect = el.plinkoBoard.getBoundingClientRect();
  const boardWidth = boardRect.width || 600;
  const boardHeight = boardRect.height || 320;
  const topPadding = 12;
  const usableHeight = boardHeight - 80; // reserve bottom for bins

  for (let r = 0; r < rows; r++) {
    const pegsInRow = binsCount - Math.abs(r % 2 ? 1 : 0); // alternate count
    const y = topPadding + (r / (rows - 1)) * (usableHeight * 0.9);
    for (let p = 0; p < binsCount - (r % 2 ? 1 : 0); p++) {
      const x = ((p + (r % 2 ? 0.5 : 0)) / (binsCount - (r % 2 ? 1 : 0))) * 100;
      const peg = document.createElement('div');
      peg.className = 'plinko-peg';
      peg.style.left = `${x}%`;
      peg.style.top = `${y}px`;
      board.appendChild(peg);
    }
  }

  // bins container
  const bins = document.createElement('div');
  bins.className = 'plinko-bins';
  for (let i = 0; i < binsCount; i++) {
    const bin = document.createElement('div');
    bin.className = 'plinko-bin';
    bin.dataset.index = String(i);
    bin.style.flex = '1';
    bin.style.margin = '0 4px';
    bin.textContent = `${payouts[i]}`;
    bins.appendChild(bin);
  }
  el.plinkoBoard.appendChild(bins);
}

// plinko physics (random walk) -> pick bin index
function simulateDrop() {
  // Simulate a simple Galton board (binomial). Start at 0, each row step +0 or +1 with 50% chance; result between 0..rows
  let pos = 0;
  for (let i = 0; i < rows; i++) {
    pos += Math.random() < 0.5 ? 0 : 1;
  }
  // pos in 0..rows -> map to binsCount range (0..binsCount-1)
  let binIndex = Math.min(binsCount - 1, pos);
  return binIndex;
}

// animate ball falling to bin visually
function animateBallToBin(binIndex, onComplete) {
  const boardRect = el.plinkoBoard.getBoundingClientRect();
  const binEls = el.plinkoBoard.querySelectorAll('.plinko-bin');
  const targetBin = binEls[binIndex];
  if (!targetBin) { onComplete && onComplete(); return; }

  const ball = document.createElement('div');
  ball.textContent = '⚪';
  ball.style.position = 'absolute';
  ball.style.left = '50%';
  ball.style.top = '8px';
  ball.style.transform = 'translate(-50%, 0)';
  ball.style.fontSize = '20px';
  ball.style.transition = 'transform 900ms cubic-bezier(.2,.8,.2,1), top 900ms linear';
  ball.style.zIndex = 9999;
  el.plinkoBoard.appendChild(ball);

  // compute target coords relative to board
  const binsRect = targetBin.getBoundingClientRect();
  const boardLeft = boardRect.left;
  const boardTop = boardRect.top;

  const targetX = (binsRect.left + binsRect.width / 2) - boardLeft;
  const targetY = (binsRect.top + binsRect.height / 2) - boardTop - 12; // slightly above

  // animate using requestAnimationFrame small wobble
  setTimeout(() => {
    ball.style.left = `${targetX}px`;
    ball.style.top = `${targetY}px`;
    ball.style.transform = `translate(-50%, 0) scale(1.1)`;
  }, 20);

  setTimeout(() => {
    // landing effect
    ball.remove();
    onComplete && onComplete();
  }, 950);
}

// drop logic
function dropBall() {
  if (balls <= 0) {
    showModal(`<div style="font-weight:700">No balls left — wait for regen or buy more</div>`);
    return;
  }
  balls -= 1;
  updateUI();
  const bin = simulateDrop();
  animateBallToBin(bin, () => {
    const reward = payouts[bin] || 0;
    coins += reward;
    updateUI();
    showModal(`<div style="font-weight:800">🎉 Landed in bin ${bin} — You won ${reward} SOLX!</div>`);
    // push to firebase if configured
    if (window.firebase && typeof db !== 'undefined' && db) {
      db.ref('scores/' + user.id).set({ name: user.first_name || 'Player', coins });
    }
  });
}

// regeneration: +1 ball every 60s up to maxBalls
function startRegen() {
  // compute how many seconds passed since lastRegen, add accordingly (in case app closed)
  const now = Date.now();
  const elapsed = Math.floor((now - lastRegen) / 1000);
  if (elapsed >= 60) {
    const add = Math.floor(elapsed / 60);
    balls = Math.min(maxBalls, balls + add);
    lastRegen = lastRegen + add * 60 * 1000;
    if (balls >= maxBalls) lastRegen = Date.now();
    updateUI();
  }
  // every second update countdown
  if (regenCountdownInterval) clearInterval(regenCountdownInterval);
  regenCountdownInterval = setInterval(() => {
    const secs = Math.max(0, 60 - Math.floor((Date.now() - lastRegen) / 1000));
    el.regenTimer.textContent = `${secs}s`;
  }, 1000);

  // every 60s add ball
  if (regenInterval) clearInterval(regenInterval);
  regenInterval = setInterval(() => {
    if (balls < maxBalls) {
      balls += 1;
      lastRegen = Date.now();
      updateUI();
    } else {
      // if full, update lastRegen so countdown resets
      lastRegen = Date.now();
    }
  }, 60 * 1000);
}

// modal helpers
function showModal(html) {
  el.modalContent.innerHTML = html;
  el.modal.classList.remove('hidden');
}
function hideModal() {
  el.modal.classList.add('hidden');
}

// leaderboard rendering (local fallback)
function renderLeaderboard() {
  if (window.firebase && typeof db !== 'undefined' && db) {
    db.ref('scores').orderByChild('coins').limitToLast(10).once('value', snap => {
      const data = snap.val() || {};
      const arr = Object.values(data).sort((a,b)=>b.coins - a.coins);
      renderLeaderboardList(arr);
    });
  } else {
    const obj = JSON.parse(localStorage.getItem('sc_scores') || '{}');
    const arr = Object.keys(obj).map(k => ({ id: k, name: obj[k].name, coins: obj[k].coins || 0 }));
    arr.sort((a,b)=>b.coins - a.coins);
    renderLeaderboardList(arr.slice(0,10));
  }
}
function renderLeaderboardList(arr) {
  el.leaderboardList.innerHTML = '';
  if (!arr.length) {
    el.leaderboardList.innerHTML = '<div class="muted">No scores yet — be the first!</div>';
    return;
  }
  arr.forEach((p, i) => {
    const row = document.createElement('div');
    row.className = 'row';
    row.innerHTML = `
      <div class="meta">
        <div class="rank ${i===0? 'first' : ''}">${i+1}</div>
        <div><div style="font-weight:700">${p.name}</div><div style="font-size:12px;color:rgba(255,255,255,0.6)">Solana City</div></div>
      </div>
      <div style="font-weight:800">${p.coins} SOLX</div>
    `;
    el.leaderboardList.appendChild(row);
  });
}

// nav helpers
function showScreen(key) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById('screen-' + (key==='plinko' ? 'plinko' : key)).classList.add('active');
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  const active = Array.from(document.querySelectorAll('.nav-btn')).find(b => b.dataset.target === key);
  if (active) active.classList.add('active');
  if (key === 'leaderboard') renderLeaderboard();
}

// event bindings
el.dropBtn.addEventListener('click', dropBall);
el.openLeaderboard.addEventListener('click', ()=> showScreen('leaderboard'));
document.getElementById('backFromLeaderboard').addEventListener('click', ()=> showScreen('plinko'));
document.getElementById('backFromLoot').addEventListener('click', ()=> showScreen('plinko'));
document.getElementById('backFromRef').addEventListener('click', ()=> showScreen('plinko'));

document.querySelectorAll('.nav-btn').forEach(btn => {
  btn.addEventListener('click', ()=> {
    const t = btn.dataset.target;
    // mapping names: 'plinko' -> 'plinko', 'leaderboard' -> 'leaderboard', 'loot' -> 'loot', 'ref' -> 'ref'
    showScreen(t);
  });
});

document.querySelectorAll('.loot-open').forEach(b=>{
  b.addEventListener('click', (ev) => {
    const tier = ev.currentTarget.dataset.tier;
    const reward = tier === 'legend' ? (Math.floor(Math.random()*150)+50) : (tier==='rare' ? (Math.floor(Math.random()*50)+15) : (Math.floor(Math.random()*20)+5));
    coins += reward;
    updateUI();
    showModal(`<div style="font-size:18px;font-weight:800">🎉 You got ${reward} SOLX!</div>`);
  });
});

document.getElementById('copyRef').addEventListener('click', async () => {
  const inp = document.getElementById('refLink');
  try {
    await navigator.clipboard.writeText(inp.value);
    showModal('<div style="font-weight:700">Link copied to clipboard ✅</div>');
  } catch(e){
    showModal('<div style="font-weight:700">Copy failed — select and copy manually</div>');
  }
});

el.closeModalBtn && el.closeModalBtn.addEventListener('click', hideModal);
document.getElementById('closeModal') && document.getElementById('closeModal').addEventListener('click', hideModal);

// initial render
buildBoard();
updateUI();
renderLeaderboard();
startRegen();

// resize -> rebuild board so pegs align
window.addEventListener('resize', ()=> {
  buildBoard();
});
