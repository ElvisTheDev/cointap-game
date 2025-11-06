Telegram.WebApp.ready();
const user = Telegram.WebApp.initDataUnsafe.user;

let coins = 0;

const tapBtn = document.getElementById('tapBtn');
const coinsDiv = document.getElementById('coins');
const leaderboardDiv = document.getElementById('leaderboard');
const lootboxBtn = document.getElementById('lootboxBtn');

tapBtn.addEventListener('click', () => {
    coins++;
    coinsDiv.textContent = `Coins: ${coins}`;
    animateCoin();
    updateLeaderboard();
});

lootboxBtn.addEventListener('click', () => {
    const reward = Math.floor(Math.random() * 20) + 5;
    coins += reward;
    coinsDiv.textContent = `Coins: ${coins}`;
    alert(`🎉 You got ${reward} coins!`);
    updateLeaderboard();
});

function animateCoin() {
    const coin = document.createElement('div');
    coin.textContent = '💰';
    coin.style.position = 'absolute';
    coin.style.left = Math.random() * window.innerWidth + 'px';
    coin.style.top = Math.random() * window.innerHeight + 'px';
    coin.style.fontSize = '24px';
    document.body.appendChild(coin);
    setTimeout(() => coin.remove(), 1000);
}

function updateLeaderboard() {
    leaderboardDiv.innerHTML = `
        1. Player1: ${coins + 5} coins<br>
        2. Player2: ${coins + 3} coins<br>
        3. You: ${coins} coins
    `;
}
