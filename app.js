/* app.js - Triangular Plinko board with bounce animation, no popup on each drop */

/* Optional Firebase: paste config in firebaseConfig and uncomment init lines near top */

// TELEGRAM init
const TELEGRAM = window.Telegram && window.Telegram.WebApp ? window.Telegram.WebApp : null;
if (TELEGRAM) { try { TELEGRAM.ready(); } catch (e) {} }

// --- CONFIG ---
const payouts = [100,50,20,5,1,1,5,20,50,100]; // 10 bins
const binsCount = payouts.length;
const pegRows = [1,3,5,7,9,11]; // triangular rows (configurable)
const maxBalls = 100;
const regenSeconds = 60;

// DOM refs
const dom = {
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
let balls = Number(localStorage.getItem('sc_balls') || maxBalls);
if (isNaN(balls)) balls = maxBalls;
let lastRegen = Number(localStorage.getItem('sc_lastRegen') || Date.now());
let regenInterval = null, regenCountdownInterval = null;
let pegPositions = []; // array of rows with peg coords for animation
let user = (TELEGRAM && TELEGRAM.initDataUnsafe && TELEGRAM.initDataUnsafe.user) ? TELEGRAM.initDataUnsafe.user : { id: 'local_'+Math.floor(Math.random()*99999), first_name: 'You' };

// persist
function saveState() {
  localStorage.setItem('sc_coins', String(coins));
  localStorage.setItem('sc_balls', String(balls));
  localStorage.setItem('sc_lastRegen', String(lastRegen));
}
function saveLocalScore() {
  const scores = JSON.parse(localStorage.getItem('sc_scores') || '{}');
  scores[user.id] = { name: user.first_name || 'Player', coins };
  localStorage.setItem('sc_scores', JSON.stringify(scores));
}

// UI updates
function updateUI() {
  dom.coinsCount.textContent = `${coins} SOLX`;
  dom.balance.textContent = `${coins} SOLX`;
  dom.ballsCount.textContent = `${balls}`;
  saveState();
  saveLocalScore();
}

// Build triangular board: rows defined by pegRows (1,3,5...)
function buildBoard() {
  dom.plinkoBoard.innerHTML = '';
  pegPositions = [];

  const board = document.createElement('div');
  board.style.position = 'relative';
  board.style.width = '100%';
  board.style.height = '100%';
  dom.plinkoBoard.appendChild(board);

  const boardRect = dom.plinkoBoard.getBoundingClientRect();
  const boardWidth = boardRect.width || 520;
  const boardHeight = boardRect.height || 360;
  const topPadding = 20;
  const bottomReserve = 80; // bins area
  const usableHeight = boardHeight - topPadding - bottomReserve;

  // create each row of pegs
  for (let r = 0; r < pegRows.length; r++) {
    const pegCount = pegRows[r];
    const y = topPadding + (r / (pegRows.length - 1)) * (usableHeight * 0.92);
    const rowPositions = [];
    // spread pegs centered
    for (let p = 0; p < pegCount; p++) {
      const xPercent = ((p + 1) / (pegCount + 1)) * 100; // 1..pegCount in between edges
      const peg = document.createElement('div');
      peg.className = 'plinko-peg';
      peg.style.left = `${xPercent}%`;
      peg.style.top = `${y}px`;
      board.appendChild(peg);
      rowPositions.push({ leftPercent: xPercent, topPx: y });
    }
    pegPositions.push(rowPositions);
  }

  // bins
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
  dom.plinkoBoard.appendChild(bins);
}

// Given pegPositions, compute animation path for one drop using random choices
function computePathAndFinalBin() {
  // We'll simulate starting at the horizontal center (50%), then for each row
  // choose a small left/right offset towards nearest peg in that row.
  // This produces a bouncy unpredictable path.
  let path = [];
  let curX = 50; // percent
  for (let r = 0; r < pegPositions.length; r++) {
    const row = pegPositions[r];
    // pick peg in row that is closest to curX +/- jitter with randomness
    // Add random jitter to cause unpredictability
    const jitter = (Math.random() - 0.5) * (100 / (row.length * 6)); // small jitter
    const targetCandidates = row.map((p, idx) => ({ idx, dx: Math.abs(p.leftPercent - (curX + jitter)) }));
    // randomly prefer left/right sometimes
    if (Math.random() < 0.25) {
      // 25% chance to bias left or right strongly
      const bias = Math.random() < 0.5 ? -1 : 1;
      targetCandidates.sort((a,b) => ((a.dx + bias * (a.idx)) - (b.dx + bias * (b.idx))));
    } else {
      targetCandidates.sort((a,b) => a.dx - b.dx);
    }
    const chosen = row[targetCandidates[0].idx];
    curX = chosen.leftPercent + (Math.random() - 0.5) * 2; // slight position randomness
    path.push({ leftPercent: chosen.leftPercent, topPx: chosen.topPx });
  }

  // final horizontal position maps to bin index
  // get bin elements to compute widths
  const binsEls = dom.plinkoBoard.querySelectorAll('.plinko-bin');
  if (!binsEls.length) {
    // fallback to mapping center-to-bins
    const binIndex = Math.max(0, Math.min(binsCount - 1, Math.round((curX / 100) * (binsCount - 1))));
    return { path, binIndex };
  }

  // compute final client X coordinate
  const boardRect = dom.plinkoBoard.getBoundingClientRect();
  const finalClientX = boardRect.left + (curX / 100) * boardRect.width;
  // find bin whose center is closest
  let closestIdx = 0; let closestDist = Infinity;
  binsEls.forEach((b, i) => {
    const br = b.getBoundingClientRect();
    const centerX = br.left + br.width / 2;
    const dist = Math.abs(centerX - finalClientX);
    if (dist < closestDist) { closestDist = dist; closestIdx = i; }
  });

  return { path, binIndex: closestIdx };
}

// animate ball along path (sequence of peg coords) then drop to bin; calls onComplete with binIndex
function animateBallPath(path, binIndex, onComplete) {
  const boardRect = dom.plinkoBoard.getBoundingClientRect();
  const ball = document.createElement('div');
  ball.textContent = '⚪';
  ball.style.position = 'absolute';
  ball.style.left = '50%';
  ball.style.top = '8px';
  ball.style.transform = 'translate(-50%, 0)';
  ball.style.fontSize = '20px';
  ball.style.zIndex = 9999;
  ball.style.transition = 'left 180ms linear, top 180ms linear, transform 180ms linear';
  dom.plinkoBoard.appendChild(ball);

  // helper to convert percent/top to px coords inside board
  const toCoords = (item) => {
    const x = (item.leftPercent / 100) * boardRect.width;
    const y = item.topPx;
    return { x, y };
  };

  // sequential animate through pegs
  let step = 0;
  function nextStep() {
    if (step < path.length) {
      const coords = toCoords(path[step]);
      ball.style.left = `${coords.x}px`;
      ball.style.top = `${coords.y}px`;
      ball.style.transform = `translate(-50%,-50%) scale(1)`;
      step++;
      setTimeout(nextStep, 140 + Math.random() * 80); // variable timing for bounce feel
      return;
    }
    // final drop to bin: compute center of target bin
    const binEls = dom.plinkoBoard.querySelectorAll('.plinko-bin');
    const target = binEls[binIndex];
    if (!target) {
      ball.remove();
      onComplete && onComplete(binIndex);
      return;
    }
    const br = target.getBoundingClientRect();
    const boardLeft = boardRect.left;
    const targetX = (br.left + br.width / 2) - boardLeft;
    const targetY = (br.top + br.height / 2) - boardRect.top - 6;
    // animate drop
    ball.style.transition = 'left 420ms cubic-bezier(.2,.9,.2,1), top 420ms cubic-bezier(.2,.9,.2,1), transform 420ms';
    setTimeout(() => {
      ball.style.left = `${targetX}px`;
      ball.style.top = `${targetY}px`;
      ball.style.transform = 'translate(-50%,-50%) scale(.95)';
    }, 60);
    setTimeout(() => {
      // landing effect (small scale)
      ball.remove();
      onComplete && onComplete(binIndex);
    }, 540);
  }
  // start
  nextStep();
}

// drop logic (consumes 1 ball, runs simulate+animation, awards coins quietly)
function dropBall() {
  if (balls <= 0) {
    // just show tiny modal/feedback once (not on each win) - use modal only for errors or lootboxes
    showModal(`<div style="font-weight:700">No balls left — wait for regen</div>`);
    return;
  }
  balls -= 1;
  updateUI();

  const { path, binIndex } = computePathAndFinalBin();
  animateBallPath(path, binIndex, (finalBin) => {
    const reward = payouts[finalBin] || 0;
    coins += reward;
    updateUI();
    // do NOT show popup per drop (requirement) — silent update only
    // persist to firebase if configured
    if (window.firebase && typeof db !== 'undefined' && db) {
      db.ref('scores/' + user.id).set({ name: user.first_name || 'Player', coins });
    }
  });
}

// regen logic + timer
function startRegen() {
  const now = Date.now();
  const elapsed = Math.floor((now - lastRegen) / 1000);
  if (elapsed >= regenSeconds) {
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
    else { lastRegen = Date.now(); }
  }, regenSeconds * 1000);
}

// modal helpers (used only for lootboxes / errors)
function showModal(html) {
  dom.modalContent.innerHTML = html;
  dom.modal.classList.remove('hidden');
}
function hideModal() { dom.modal.classList.add('hidden'); }

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
  dom.leaderboardList.innerHTML = '';
  if (!arr.length) {
    dom.leaderboardList.innerHTML = '<div class="muted">No scores yet — be the first!</div>';
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
    dom.leaderboardList.appendChild(row);
  });
}

// nav & events
function showScreen(key) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById('screen-' + (key==='plinko' ? 'plinko' : key)).classList.add('active');
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  const active = Array.from(document.querySelectorAll('.nav-btn')).find(b => b.dataset.target === key);
  if (active) active.classList.add('active');
  if (key === 'leaderboard') renderLeaderboard();
}

dom.dropBtn.addEventListener('click', dropBall);
dom.openLeaderboard.addEventListener('click', ()=> showScreen('leaderboard'));
document.getElementById('backFromLeaderboard').addEventListener('click', ()=> showScreen('plinko'));
document.getElementById('backFromLoot').addEventListener('click', ()=> showScreen('plinko'));
document.getElementById('backFromRef').addEventListener('click', ()=> showScreen('plinko'));
document.querySelectorAll('.nav-btn').forEach(btn => { btn.addEventListener('click', ()=> { showScreen(btn.dataset.target); }); });

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
  try { await navigator.clipboard.writeText(inp.value); showModal('<div style="font-weight:700">Link copied to clipboard ✅</div>'); }
  catch(e){ showModal('<div style="font-weight:700">Copy failed — select and copy manually</div>'); }
});

dom.closeModalBtn && dom.closeModalBtn.addEventListener('click', hideModal);
document.getElementById('closeModal') && document.getElementById('closeModal').addEventListener('click', hideModal);

// init
buildBoard();
updateUI();
renderLeaderboard();
startRegen();

// rebuild board on resize so peg coords recalc
window.addEventListener('resize', () => { buildBoard(); });
