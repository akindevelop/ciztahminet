// --- ÇİZİM MOTORU (PC + MOBİL UYUMLU) ---
const canvas = document.getElementById('board');
const ctx = canvas.getContext('2d');
const colorPicker = document.getElementById('color-picker');
const brushSize = document.getElementById('brush-size');
const btnClear = document.getElementById('btn-clear');
const btnEraser = document.getElementById('btn-eraser');

// Çözünürlük her zaman 800x600 kalacak (kalite için), ama CSS onu mobilde küçültecek.
canvas.width = 800; canvas.height = 600;
let isDrawing = false; let lastX = 0; let lastY = 0; let currentColor = '#000000';

colorPicker.addEventListener('input', (e) => currentColor = e.target.value);
btnEraser.addEventListener('click', () => currentColor = '#FFFFFF');

// SİHİRLİ FONKSİYON: Ekran küçülse bile çizginin tam parmağının/imlecinin ucundan çıkmasını sağlar
function getCoords(e) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    let clientX = e.clientX;
    let clientY = e.clientY;

    // Eğer dokunmatik bir cihazdan (telefondan) geliyorsa koordinatları oradan al
    if (e.touches && e.touches.length > 0) {
        clientX = e.touches[0].clientX;
        clientY = e.touches[0].clientY;
    }

    return {
        x: (clientX - rect.left) * scaleX,
        y: (clientY - rect.top) * scaleY
    };
}

function startPosition(e) {
    if (myRole !== 'drawer') return;
    isDrawing = true;
    const coords = getCoords(e);
    lastX = coords.x; lastY = coords.y;
}

function draw(e) {
    if (!isDrawing || myRole !== 'drawer') return;
    e.preventDefault(); // KRİTİK: Mobilde çizerken ekranın yenilenmesini veya kaymasını engeller!
    
    const coords = getCoords(e);
    const currentX = coords.x; const currentY = coords.y; const size = brushSize.value;
    
    drawLine(lastX, lastY, currentX, currentY, currentColor, size);
    socket.emit('draw', { roomCode: currentRoom, x0: lastX, y0: lastY, x1: currentX, y1: currentY, color: currentColor, size: size });
    lastX = currentX; lastY = currentY;
}

function stopPosition() { isDrawing = false; }

// --- MOUSE OLAYLARI (BİLGİSAYAR İÇİN) ---
canvas.addEventListener('mousedown', startPosition);
canvas.addEventListener('mousemove', draw);
canvas.addEventListener('mouseup', stopPosition);
canvas.addEventListener('mouseout', stopPosition);

// --- DOKUNMATİK OLAYLARI (MOBİL İÇİN) ---
canvas.addEventListener('touchstart', startPosition, { passive: false });
canvas.addEventListener('touchmove', draw, { passive: false });
canvas.addEventListener('touchend', stopPosition);
canvas.addEventListener('touchcancel', stopPosition);

// Çizgi Çekme İşlemi (Aynı Kaldı)
function drawLine(x0, y0, x1, y1, color, size) {
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1);
    ctx.strokeStyle = color; ctx.lineWidth = size; ctx.lineCap = 'round';
    ctx.stroke(); ctx.closePath();
}

socket.on('draw', (data) => drawLine(data.x0, data.y0, data.x1, data.y1, data.color, data.size));

btnClear.addEventListener('click', () => {
    if (myRole !== 'drawer') return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    socket.emit('clearCanvas', currentRoom);
});
socket.on('clearCanvas', () => ctx.clearRect(0, 0, canvas.width, canvas.height));
