const socket = io();

// -- EKRANLAR VE MENÜLER --
const screenMenu = document.getElementById('screen-menu');
const screenLobby = document.getElementById('screen-lobby');
const screenGame = document.getElementById('screen-game');
const usernameInput = document.getElementById('username-input');
const roomCodeInput = document.getElementById('room-code-input');
const btnCreateRoom = document.getElementById('btn-create-room');
const btnJoinRoom = document.getElementById('btn-join-room');
const menuError = document.getElementById('menu-error');
const lobbyRoomCode = document.getElementById('lobby-room-code');
const lobbyPlayers = document.getElementById('lobby-players');
const playerCount = document.getElementById('player-count');
const hostSettings = document.getElementById('host-settings');
const btnLeaveLobby = document.getElementById('btn-leave-lobby');
const btnStartGame = document.getElementById('btn-start-game'); 

const wordSelectionOverlay = document.getElementById('word-selection-overlay');
const wordOptions = document.getElementById('word-options');
const wordHint = document.getElementById('word-hint');
const drawingTools = document.getElementById('drawing-tools');
const gameRound = document.getElementById('game-round');
const gamePlayersList = document.getElementById('game-players');
const gameTimeDisplay = document.getElementById('game-time'); 

let currentRoom = null;
let isHost = false;
let myRole = 'guesser'; 

function showScreen(screen) {
    screenMenu.classList.add('hidden'); 
    screenLobby.classList.add('hidden'); 
    screenGame.classList.add('hidden');
    screen.classList.remove('hidden');
}

btnCreateRoom.addEventListener('click', () => {
    const username = usernameInput.value.trim();
    if (!username) return menuError.textContent = "Lütfen kullanıcı adı girin.";
    socket.emit('createRoom', username);
});

btnJoinRoom.addEventListener('click', () => {
    const username = usernameInput.value.trim(); 
    const roomCode = roomCodeInput.value.trim().toUpperCase();
    if (!username || !roomCode) return menuError.textContent = "Eksik bilgi girdiniz.";
    socket.emit('joinRoom', { username, roomCode });
});

btnLeaveLobby.addEventListener('click', () => window.location.reload());

socket.on('menuError', (errorMsg) => { menuError.textContent = errorMsg; alert(errorMsg); });

socket.on('roomJoined', (data) => {
    currentRoom = data.roomCode; 
    isHost = data.isHost; 
    lobbyRoomCode.textContent = currentRoom;
    hostSettings.style.display = isHost ? 'block' : 'none'; 
    updateLobbyPlayers(data.players); 
    showScreen(screenLobby); // LOBİYE GEÇİŞ BURADA YAPILIYOR
});

socket.on('updatePlayerList', (players) => updateLobbyPlayers(players));
socket.on('hostPromoted', () => { isHost = true; hostSettings.style.display = 'block'; });

function updateLobbyPlayers(players) {
    lobbyPlayers.innerHTML = ''; playerCount.textContent = players.length;
    players.forEach((p, index) => {
        const li = document.createElement('li'); li.textContent = p.name;
        if (index === 0) { const span = document.createElement('span'); span.className = 'host-badge'; span.textContent = 'Kurucu'; li.appendChild(span); }
        lobbyPlayers.appendChild(li);
    });
}

// --- OYUN AKIŞI ---
btnStartGame.addEventListener('click', () => { 
    if (currentRoom && isHost) {
        const rounds = parseInt(document.getElementById('setting-rounds').value) || 3;
        const time = parseInt(document.getElementById('setting-time').value) || 80;
        socket.emit('startGame', { roomCode: currentRoom, rounds: rounds, time: time }); 
    }
});

socket.on('gameStarted', (data) => {
    showScreen(screenGame); // OYUN EKRANINA GEÇİŞ BURADA YAPILIYOR
    gameRound.textContent = `${data.round}/${data.totalRounds}`;
    wordHint.textContent = `${data.drawerName} kelime seçiyor...`; 
    drawingTools.style.display = 'none';
    chatMessages.innerHTML = ''; // Yeni oyunda chat'i temizle
});

socket.on('chooseWord', (words) => {
    wordOptions.innerHTML = '';
    words.forEach(w => {
        const btn = document.createElement('button'); btn.className = 'word-btn'; btn.textContent = w;
        btn.onclick = () => { socket.emit('wordChosen', { roomCode: currentRoom, word: w }); wordSelectionOverlay.classList.add('hidden'); };
        wordOptions.appendChild(btn);
    });
    wordSelectionOverlay.classList.remove('hidden');
});

socket.on('roundStarted', (data) => {
    myRole = (socket.id === data.drawerId) ? 'drawer' : 'guesser';
    if (myRole === 'guesser') { drawingTools.style.display = 'none'; wordHint.textContent = data.hiddenWord; }
    gameTimeDisplay.textContent = data.time;
});

socket.on('youAreDrawing', (word) => { drawingTools.style.display = 'flex'; wordHint.textContent = `Çiziyorsun: ${word}`; });
socket.on('timeUpdate', (time) => { gameTimeDisplay.textContent = time; });

socket.on('turnEnded', (data) => {
    drawingTools.style.display = 'none'; 
    wordHint.textContent = `TUR BİTTİ! Kelime: ${data.word}`;
    chatMessages.innerHTML += `<div style="padding:5px; color:#e74c3c; font-weight:bold; text-align:center;">⏱️ Tur bitti! Doğru cevap: ${data.word}</div>`;
    chatMessages.scrollTop = chatMessages.scrollHeight;
});

socket.on('gameEnded', (players) => {
    const sorted = players.sort((a, b) => b.score - a.score);
    const winner = sorted[0];
    alert(`🏆 OYUN BİTTİ!\n\nBirinci: ${winner.name} (${winner.score} Puan)\n\nOynadığınız için teşekkürler!`);
    window.location.reload(); 
});

// --- ÇİZİM MOTORU (MOBİL UYUMLU) ---
const canvas = document.getElementById('board');
const ctx = canvas.getContext('2d');
const colorPicker = document.getElementById('color-picker');
const brushSize = document.getElementById('brush-size');
const btnClear = document.getElementById('btn-clear');
const btnEraser = document.getElementById('btn-eraser');

canvas.width = 800; canvas.height = 600;
let isDrawing = false; let lastX = 0; let lastY = 0; let currentColor = '#000000';

colorPicker.addEventListener('input', (e) => currentColor = e.target.value);
btnEraser.addEventListener('click', () => currentColor = '#FFFFFF');

function getCoords(e) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    let clientX = e.clientX; let clientY = e.clientY;
    if (e.touches && e.touches.length > 0) { clientX = e.touches[0].clientX; clientY = e.touches[0].clientY; }
    return { x: (clientX - rect.left) * scaleX, y: (clientY - rect.top) * scaleY };
}

function startPosition(e) {
    if (myRole !== 'drawer') return;
    isDrawing = true; const coords = getCoords(e); lastX = coords.x; lastY = coords.y;
}

function draw(e) {
    if (!isDrawing || myRole !== 'drawer') return;
    if(e.cancelable) e.preventDefault(); // Sayfa kaymasını engeller
    const coords = getCoords(e); const currentX = coords.x; const currentY = coords.y; const size = brushSize.value;
    drawLine(lastX, lastY, currentX, currentY, currentColor, size);
    socket.emit('draw', { roomCode: currentRoom, x0: lastX, y0: lastY, x1: currentX, y1: currentY, color: currentColor, size: size });
    lastX = currentX; lastY = currentY;
}

function stopPosition() { isDrawing = false; }

canvas.addEventListener('mousedown', startPosition);
canvas.addEventListener('mousemove', draw);
canvas.addEventListener('mouseup', stopPosition);
canvas.addEventListener('mouseout', stopPosition);
canvas.addEventListener('touchstart', startPosition, { passive: false });
canvas.addEventListener('touchmove', draw, { passive: false });
canvas.addEventListener('touchend', stopPosition);
canvas.addEventListener('touchcancel', stopPosition);

function drawLine(x0, y0, x1, y1, color, size) {
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1);
    ctx.strokeStyle = color; ctx.lineWidth = size; ctx.lineCap = 'round'; ctx.stroke(); ctx.closePath();
}

socket.on('draw', (data) => drawLine(data.x0, data.y0, data.x1, data.y1, data.color, data.size));

btnClear.addEventListener('click', () => {
    if (myRole !== 'drawer') return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    socket.emit('clearCanvas', currentRoom);
});
socket.on('clearCanvas', () => ctx.clearRect(0, 0, canvas.width, canvas.height));

// --- SOHBET VE PUAN TABLOSU ---
const chatInput = document.getElementById('chat-input');
const btnSend = document.getElementById('btn-send');
const chatMessages = document.getElementById('chat-messages');

function sendMessage() {
    const msg = chatInput.value.trim();
    if (msg && currentRoom) {
        socket.emit('chatMessage', { roomCode: currentRoom, message: msg });
        chatInput.value = '';
    }
}
btnSend.addEventListener('click', sendMessage);
chatInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') sendMessage(); });

socket.on('chatMessage', (data) => {
    chatMessages.innerHTML += `<div style="padding:5px; border-bottom:1px solid var(--border-color);"><strong>${data.name}:</strong> ${data.text}</div>`;
    chatMessages.scrollTop = chatMessages.scrollHeight;
});

socket.on('systemMessage', (msg) => {
    chatMessages.innerHTML += `<div style="padding:5px; color:var(--primary); font-weight:bold;">${msg}</div>`;
    chatMessages.scrollTop = chatMessages.scrollHeight;
});

socket.on('updateScoreboard', (players) => {
    gamePlayersList.innerHTML = '';
    const sorted = players.sort((a, b) => b.score - a.score);
    sorted.forEach(p => {
        const li = document.createElement('li');
        li.innerHTML = `${p.name} <span style="float:right; font-weight:bold; color:var(--primary);">${p.score} P</span>`;
        gamePlayersList.appendChild(li);
    });
});

// --- TEMA MOTORU ---
const themeSelect = document.getElementById('theme-select');
const savedTheme = localStorage.getItem('cizimOyunuTema') || 'theme-classic';
document.body.className = savedTheme;
if(themeSelect) themeSelect.value = savedTheme;

if(themeSelect) {
    themeSelect.addEventListener('change', (e) => {
        const selectedTheme = e.target.value;
        document.body.className = selectedTheme; 
        localStorage.setItem('cizimOyunuTema', selectedTheme); 
    });
}
