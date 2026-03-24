const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

const rooms = {};
const WORDS = ["ELMA", "ARABA", "BİLGİSAYAR", "KEDİ", "KÖPEK", "GÜNEŞ", "AĞAÇ", "TELEFON", "UÇAK", "DENİZ", "GÖZLÜK", "SAAT", "KİTAP", "AYAKKABI", "KALEM", "BİSİKLET", "ŞEMSİYE", "GÖMLEK", "KELEBEK", "KAPLUMBAĞA"];

io.on('connection', (socket) => {
    
    socket.on('createRoom', (username) => {
        const roomCode = Math.random().toString(36).substring(2, 6).toUpperCase();
        rooms[roomCode] = { 
            host: socket.id, 
            players: [{ id: socket.id, name: username, score: 0, guessed: false }], 
            settings: { rounds: 3, time: 80 }, 
            state: 'lobby',
            interval: null,
            turnActive: false // Çifte tetiklenmeyi önleyecek kilit
        };
        socket.join(roomCode);
        socket.emit('roomJoined', { roomCode, isHost: true, players: rooms[roomCode].players });
    });

    socket.on('joinRoom', (data) => {
        const { username, roomCode } = data;
        const room = rooms[roomCode];
        if (!room) return socket.emit('menuError', 'Oda bulunamadı!');
        if (room.state !== 'lobby') return socket.emit('menuError', 'Oyun zaten başlamış!');
        if (room.players.length >= 8) return socket.emit('menuError', 'Oda dolu!');

        room.players.push({ id: socket.id, name: username, score: 0, guessed: false });
        socket.join(roomCode);
        socket.emit('roomJoined', { roomCode, isHost: false, players: room.players });
        socket.to(roomCode).emit('updatePlayerList', room.players);
    });

    // YENİ: Lobi ayarlarını da alıyoruz
    socket.on('startGame', (data) => {
        const { roomCode, rounds, time } = data;
        const room = rooms[roomCode];
        if (room && room.host === socket.id && room.players.length >= 2) {
            room.settings.rounds = rounds;
            room.settings.time = time;
            room.state = 'playing'; 
            room.currentRound = 1; 
            room.drawerIndex = 0;
            startTurn(roomCode);
        }
    });

    function startTurn(roomCode) {
        const room = rooms[roomCode];
        if (!room) return;

        clearInterval(room.interval);
        room.turnActive = true; // Tur kilidini aç
        room.currentWord = null; // Eski kelimeyi hafızadan sil
        room.players.forEach(p => p.guessed = false);
        room.timeLeft = room.settings.time;
        
        const drawer = room.players[room.drawerIndex];
        if (!drawer) { endTurn(roomCode); return; } // Güvenlik ağı

        const shuffled = [...WORDS].sort(() => 0.5 - Math.random());
        const wordChoices = shuffled.slice(0, 3);
        
        io.to(roomCode).emit('gameStarted', { round: room.currentRound, totalRounds: room.settings.rounds, drawerName: drawer.name });
        io.to(drawer.id).emit('chooseWord', wordChoices);
    }

    socket.on('wordChosen', (data) => {
        const { roomCode, word } = data;
        const room = rooms[roomCode];
        if(room && room.turnActive) {
            room.currentWord = word;
            const hiddenWord = word.replace(/./g, '_ '); 
            
            io.to(roomCode).emit('clearCanvas');
            io.to(roomCode).emit('updateScoreboard', room.players);
            io.to(roomCode).emit('roundStarted', { time: room.settings.time, hiddenWord: hiddenWord, drawerId: room.players[room.drawerIndex].id });
            io.to(room.players[room.drawerIndex].id).emit('youAreDrawing', word);

            room.interval = setInterval(() => {
                room.timeLeft--;
                io.to(roomCode).emit('timeUpdate', room.timeLeft);

                const guessers = room.players.filter(p => p.id !== room.players[room.drawerIndex]?.id);
                const allGuessed = guessers.length > 0 && guessers.every(p => p.guessed);

                if (room.timeLeft <= 0 || allGuessed) {
                    endTurn(roomCode);
                }
            }, 1000);
        }
    });

    function endTurn(roomCode) {
        const room = rooms[roomCode];
        if (!room || !room.turnActive) return; // Çifte tetiklenme koruması!
        room.turnActive = false; // Kilidi kapat

        clearInterval(room.interval);
        io.to(roomCode).emit('turnEnded', { word: room.currentWord || "Seçilmedi" });

        setTimeout(() => {
            if(!rooms[roomCode]) return;

            room.drawerIndex++;
            if (room.drawerIndex >= room.players.length) {
                room.drawerIndex = 0;
                room.currentRound++;
            }

            if (room.currentRound > room.settings.rounds) {
                io.to(roomCode).emit('gameEnded', room.players);
                room.state = 'lobby'; 
            } else {
                startTurn(roomCode);
            }
        }, 5000);
    }

    socket.on('draw', (data) => { socket.to(data.roomCode).emit('draw', data); });
    socket.on('clearCanvas', (roomCode) => { socket.to(roomCode).emit('clearCanvas'); });

    socket.on('chatMessage', (data) => {
        const { roomCode, message } = data;
        const room = rooms[roomCode];
        if (!room) return;

        const player = room.players.find(p => p.id === socket.id);
        if (!player) return;

        if (room.state === 'playing' && room.currentWord && message.trim().toUpperCase() === room.currentWord.toUpperCase()) {
            if (room.players[room.drawerIndex]?.id === socket.id) {
                return socket.emit('systemMessage', 'Kendi çizdiğin kelimeyi sohbete yazamazsın!');
            }
            if (player.guessed) {
                return socket.emit('systemMessage', 'Zaten bildin! İpucu verme :)');
            }
            
            player.guessed = true;
            const timeBonus = Math.floor(room.timeLeft / 5);
            player.score += (10 + timeBonus); 
            room.players[room.drawerIndex].score += 5; 
            
            io.to(roomCode).emit('systemMessage', `🎉 ${player.name} kelimeyi BİLDİ!`);
            io.to(roomCode).emit('updateScoreboard', room.players);
        } else {
            io.to(roomCode).emit('chatMessage', { name: player.name, text: message });
        }
    });

    socket.on('disconnecting', () => {
        const currentRooms = Array.from(socket.rooms);
        currentRooms.forEach(roomCode => {
            const room = rooms[roomCode];
            if (room) {
                const currentDrawerId = room.state === 'playing' ? room.players[room.drawerIndex]?.id : null;
                const isDrawerLeaving = (currentDrawerId === socket.id);

                room.players = room.players.filter(p => p.id !== socket.id);
                
                if (room.players.length === 0) {
                    clearInterval(room.interval);
                    delete rooms[roomCode];
                } else {
                    if (room.host === socket.id) {
                        room.host = room.players[0].id;
                        io.to(room.host).emit('hostPromoted');
                    }
                    io.to(roomCode).emit('updatePlayerList', room.players);
                    io.to(roomCode).emit('updateScoreboard', room.players);
                    
                    if (room.state === 'playing') {
                        if (isDrawerLeaving) {
                            io.to(roomCode).emit('systemMessage', '⚠️ Çizen oyuncu ayrıldı! Tur bitiriliyor...');
                            // Çıkan çizerin yerini dolduracak yeni kişi için index'i koru
                            room.drawerIndex--; 
                            endTurn(roomCode);
                        } else {
                            // Çıkan kişi çizer değilse index kaymasını düzelt
                            const newDrawerIndex = room.players.findIndex(p => p.id === currentDrawerId);
                            if(newDrawerIndex !== -1) room.drawerIndex = newDrawerIndex;

                            // Kalan herkes kelimeyi bilmiş mi diye tekrar kontrol et
                            const guessers = room.players.filter(p => p.id !== currentDrawerId);
                            if (guessers.length > 0 && guessers.every(p => p.guessed)) {
                                endTurn(roomCode);
                            }
                        }
                    }
                }
            }
        });
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => { console.log(`🚀 Sunucu ${PORT} portunda çalışıyor.`); });
