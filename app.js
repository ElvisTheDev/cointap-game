/* app.js - vanilla JS for Solana City tap game */
/* Optional Firebase: uncomment firebase SDK in index.html and paste your config in `firebaseConfig` below */

const TELEGRAM = window.Telegram && window.Telegram.WebApp ? window.Telegram.WebApp : null;
if (TELEGRAM) {
  try { TELEGRAM.ready(); } catch(e){}
}

// --- CONFIG: Firebase (optional) ---
// If you will use Firebase Realtime DB, paste your config here and uncomment init lines.
// const firebaseConfig = {
//   apiKey: "YOUR_API_KEY",
//   authDomain: "YOUR_AUTH_DOMAIN",
//   databaseURL: "https://your-db-url",
//   projectId: "your-project-id",
//   storageBucket: "your-bucket",
//   messagingSenderId: "xxx",
//   appId: "xxx"
// };
// let db = null;
// if (window.firebase) {
//   firebase.initializeApp(firebaseConfig);
//   db = firebase.database();
// }

const elements = {
  coinsCount: document.getElementById('coinsCount'),
  balance: document.getElementById('balance'),
  coinBtn: document.getElementById('coinBtn'),
  openLoot: document.getElementById('openLoot'),
  openLeaderboard: document.getElementById('openLeaderboard'),
  screens: {
    tap: document.getElementById('screen-tap'),
    leaderboard: document.getElementById('screen-leaderboard'),
    loot: document.getElementById('screen-loot'),
    ref: document.getElementById('screen-ref'),
  },
  leaderboardList: document.getElementById('leaderboardList'),
  navButtons: document.querySelectorAll('.nav-btn'),
  modal: document.getElementById('modal'),
  modalContent: document.getElementById('modalContent'),
  closeModal: null
};

let coins = 0;
let user = (TELEGRAM && TELEGRAM.initDataUnsafe && TELEGRAM.initDataUnsafe.user) ? TELEGRAM.initDataUnsafe.user : {id: 'local_'+Math.floor(Math.random()*99999), first_name: 'You'};

// Local leaderboard storage fallback
function saveLocalScore() {
  const scores = JSON.parse(localStorage.getItem('sc_scores') || '{}');
  scores[user.id] = { name: user.first_name || 'Player', coins };
  localStorage.setItem('sc_scores', JSON.stringify(scores));
}

function loadLocalLeaderboard(limit=10) {
  const obj = JSON.parse(localStorage.getItem('sc_scores') || '{}');
  const arr = Object.keys(obj).map(k => ({ id: k, name: obj[k].name, coins: obj[k].coins || 0 }));
  arr.sort((a,b)=>b.coins - a.coins);
  return arr.slice(0, limit);
}

// UI helpers
function updateUI() {
  elements.coinsCount.textContent = `${coins} SOLX`;
  elements.balance.textContent = `${coins} SOLX`;
}

function showScreen(key) {
  Object.keys(elements.screens).forEach(k => elements.screens[k].classList.remove('active'));
  if (elements.screens[key]) elements.screens[key].classList.add('active');
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  const active = Array.from(document.querySelectorAll('.nav-btn')).find(b => b.dataset.target === key);
  if (active) active.classList.add('active');

  if (key === 'leaderboard') renderLeaderboard();
}

function renderLeaderboard() {
  // prefer Firebase if available, else local
  if (window.firebase && db) {
    db.ref('scores').orderByChild('coins').limitToLast(10).once('value', snap => {
      const data = snap.val() || {};
      const arr = Object.values(data).sort((a,b)=>b.coins - a.coins);
      renderLeaderboardList(arr);
    });
  } else {
    const arr = loadLocalLeaderboard(10);
    renderLeaderboardList(arr);
  }
}

function renderLeaderboardList(arr) {
  elements.leaderboardList.innerHTML = '';
  if (!arr.length) {
    elements.leaderboardList.innerHTML = '<div class="muted">No scores yet — be the first!</div>';
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
    elements.leaderboardList.appendChild(row);
  });
}

// tap logic
elements.coinBtn.addEventListener('click', () => {
  coins += 1;
  updateUI();
  // small visual pulse
  elements.coinBtn.animate([{ transform: 'scale(1)' }, { transform: 'scale(.95)' }, { transform: 'scale(1)' }], { duration: 140 });

  saveLocalScore();
  // optionally send to Firebase (if db)
  if (window.firebase && db) {
    db.ref('scores/' + user.id).set({ name: user.first_name || 'Player', coins });
  }
});

// nav/buttons
document.querySelectorAll('.nav-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const tgt = btn.dataset.target;
    if (!tgt) return;
    showScreen(tgt);
  });
});
document.getElementById('openLeaderboard').addEventListener('click', ()=> showScreen('leaderboard'));
document.getElementById('backFromLeaderboard')?.addEventListener('click', ()=> showScreen('tap'));
document.getElementById('backFromLoot')?.addEventListener('click', ()=> showScreen('tap'));
document.getElementById('backFromRef')?.addEventListener('click', ()=> showScreen('tap'));

// lootbox open (uses random rewards)
document.querySelectorAll('.loot-card button').forEach(b=>{
  b.addEventListener('click', (e)=>{
    const tier = e.currentTarget.dataset.tier || 'common';
    const reward = (tier === 'legend') ? (Math.floor(Math.random()*150)+50) : (tier==='rare' ? (Math.floor(Math.random()*50)+15) : (Math.floor(Math.random()*20)+5));
    coins += reward;
    updateUI();
    saveLocalScore();
    if (window.firebase && db) db.ref('scores/' + user.id).set({ name: user.first_name || 'Player', coins });

    showModal(`<div style="font-size:20px;font-weight:800">🎉 You got ${reward} SOLX!</div><div style="margin-top:8px;color:rgba(255,255,255,0.75)">Tier: ${tier}</div>`);
  });
});

// modal
function showModal(html) {
  const modal = document.getElementById('modal');
  const modalContent = document.getElementById('modalContent');
  modalContent.innerHTML = html;
  modal.classList.remove('hidden');
}
document.getElementById('closeModal')?.addEventListener('click', ()=> document.getElementById('modal').classList.add('hidden'));

// referrals
document.getElementById('copyRef')?.addEventListener('click', async ()=>{
  const inp = document.getElementById('refLink');
  try {
    await navigator.clipboard.writeText(inp.value);
    showModal('<div style="font-weight:700">Link copied to clipboard ✅</div>');
  } catch(e){
    showModal('<div style="font-weight:700">Copy failed — select and copy manually</div>');
  }
});

// initial load
updateUI();
renderLeaderboard();
showScreen('tap');

// friendly: handle Telegram expand if running inside Telegram
if (TELEGRAM && TELEGRAM.MainButton) {
  try { TELEGRAM.MainButton.hide(); } catch(e){}
}
