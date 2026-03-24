const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

const rooms = {};
// Daha geniş kelime havuzu
const WORDS = ["ELMA", "ARABA", "BİLGİSAYAR", "KEDİ", "KÖPEK", "GÜNEŞ", "AĞAÇ", "TELEFON", "UÇAK", "DENİZ", "GÖZLÜK", "SAAT", "KİTAP", "AYAKKABI", "KALEM", "BİSİKLET", "ŞEMSİYE", "GÖMLEK", "KELEBEK", "KAPLUMBAĞA"];

io.on('connection', (socket) => {
    
    socket.on('createRoom', (username) => {
        const roomCode = Math.random().toString(36).substring(2, 6).toUpperCase();
        rooms[roomCode] = { 
            host: socket.id, 
            players: [{ id: socket.id, name: username, score: 0, guessed: false }], 
            settings: { rounds: 3, time: 80 }, 
            state: 'lobby',
            interval: null // Zamanlayıcı için eklendi
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

    socket.on('startGame', (roomCode) => {
        const room = rooms[roomCode];
        if (room && room.host === socket.id && room.players.length >= 2) {
            room.state = 'playing'; room.currentRound = 1; room.drawerIndex = 0;
            startTurn(roomCode);
        } else {
            socket.emit('menuError', 'Başlamak için en az 2 kişi olmalı!');
        }
    });

    // TUR BAŞLATMA DÖNGÜSÜ
    function startTurn(roomCode) {
        const room = rooms[roomCode];
        if (!room) return;

        clearInterval(room.interval); // Eski sayacı temizle
        room.players.forEach(p => p.guessed = false); // Herkesin tahmin durumunu sıfırla
        room.timeLeft = room.settings.time; // Süreyi başa al
        
        const drawer = room.players[room.drawerIndex];
        const shuffled = [...WORDS].sort(() => 0.5 - Math.random());
        const wordChoices = shuffled.slice(0, 3);
        
        io.to(roomCode).emit('gameStarted', { round: room.currentRound, totalRounds: room.settings.rounds, drawerName: drawer.name });
        io.to(drawer.id).emit('chooseWord', wordChoices);
    }

    socket.on('wordChosen', (data) => {
        const { roomCode, word } = data;
        const room = rooms[roomCode];
        if(room) {
            room.currentWord = word;
            const hiddenWord = word.replace(/./g, '_ '); 
            
            io.to(roomCode).emit('clearCanvas');
            io.to(roomCode).emit('updateScoreboard', room.players);
            io.to(roomCode).emit('roundStarted', { time: room.settings.time, hiddenWord: hiddenWord, drawerId: room.players[room.drawerIndex].id });
            io.to(room.players[room.drawerIndex].id).emit('youAreDrawing', word);

            // ZAMANLAYICIYI BAŞLAT
            room.interval = setInterval(() => {
                room.timeLeft--;
                io.to(roomCode).emit('timeUpdate', room.timeLeft); // Her saniye süreyi gönder

                // Herkes bildi mi kontrolü (Çizer hariç)
                const guessers = room.players.filter(p => p.id !== room.players[room.drawerIndex].id);
                const allGuessed = guessers.every(p => p.guessed);

                // Süre biterse VEYA herkes bilirse turu bitir
                if (room.timeLeft <= 0 || allGuessed) {
                    endTurn(roomCode);
                }
            }, 1000);
        }
    });

    // TUR BİTİRME DÖNGÜSÜ
    function endTurn(roomCode) {
        const room = rooms[roomCode];
        if (!room) return;
        
        clearInterval(room.interval);
        io.to(roomCode).emit('turnEnded', { word: room.currentWord }); // Kelimeyi herkese açıkla

        // 5 saniye bekle ve yeni tura / oyuna geç
        setTimeout(() => {
            if(!rooms[roomCode]) return; // Oda biz beklerken silindiyse iptal et

            room.drawerIndex++; // Sıradaki çizere geç
            
            // Herkes bir kere çizdiyse yeni tura (round) geç
            if (room.drawerIndex >= room.players.length) {
                room.drawerIndex = 0;
                room.currentRound++;
            }

            // Turlar bittiyse oyunu bitir, bitmediyse yeni turu başlat
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
            
            if (room.players[room.drawerIndex].id === socket.id) {
                return socket.emit('systemMessage', 'Kendi çizdiğin kelimeyi sohbete yazamazsın!');
            }
            if (player.guessed) {
                return socket.emit('systemMessage', 'Zaten bildin! İpucu verme :)');
            }
            
            player.guessed = true;
            // Erken bilen ekstra puan alır!
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
            if (rooms[roomCode]) {
                const isDrawer = (rooms[roomCode].state === 'playing' && rooms[roomCode].players[rooms[roomCode].drawerIndex]?.id === socket.id);
                rooms[roomCode].players = rooms[roomCode].players.filter(p => p.id !== socket.id);
                
                if (rooms[roomCode].players.length === 0) {
                    clearInterval(rooms[roomCode].interval);
                    delete rooms[roomCode];
                } else {
                    if (rooms[roomCode].host === socket.id) {
                        rooms[roomCode].host = rooms[roomCode].players[0].id;
                        io.to(rooms[roomCode].host).emit('hostPromoted');
                    }
                    io.to(roomCode).emit('updatePlayerList', rooms[roomCode].players);
                    io.to(roomCode).emit('updateScoreboard', rooms[roomCode].players);
                    
                    // Çizer oyundan çıkarsa turu iptal edip sonrakine atla
                    if (isDrawer && rooms[roomCode].state === 'playing') {
                        io.to(roomCode).emit('systemMessage', '⚠️ Çizen oyuncu ayrıldı! Tur bitiriliyor...');
                        endTurn(roomCode);
                    }
                }
            }
        });
    });
});

// Eğer sunucu bir port verirse onu kullan, vermezse 3000'i kullan
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => { console.log(`🚀 Sunucu ${PORT} portunda başarıyla çalışıyor!`); });