// script.js

window.addEventListener('DOMContentLoaded', () => {
  console.log('DOM yüklendi, script başlıyor.');

  // Firebase ayarları
  const firebaseConfig = {
    apiKey: "AIzaSyBJzRpMjBJ08zdbm8rPiYvr2UuE7taO0X4",
    authDomain: "futbolsite-7494b.firebaseapp.com",
    databaseURL: "https://futbolsite-7494b-default-rtdb.europe-west1.firebasedatabase.app",
    projectId: "futbolsite-7494b",
    storageBucket: "futbolsite-7494b.appspot.com",
    messagingSenderId: "307816905692",
    appId: "1:307816905692:web:7ee735beccab7a48512d19",
    measurementId: "G-RFWMEVQ639"
  };
  
  // Firebase kontrolü
  if (!firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
  }
  const db = firebase.database();

  // Oyun durumu
  const gameState = {
    playerId: null,
    gameId: null,
    playerData: [],
    listeners: [],
    isHost: false,
    hasAnswered: false
  };

  // Ekranlar
  const screens = {
    nickname: document.getElementById('nicknameScreen'),
    waiting:  document.getElementById('waitingScreen'),
    game:     document.getElementById('gameScreen'),
    result:   document.getElementById('resultScreen')
  };
  
  function showScreen(name) {
    Object.values(screens).forEach(s => s.classList.remove('active'));
    screens[name].classList.add('active');
    console.log('Ekran:', name);
  }

  // DOM elementleri
  const elements = {
    nicknameInput:  document.getElementById('nicknameInput'),
    joinGameBtn:    document.getElementById('joinGameBtn'),
    cancelWaitBtn:  document.getElementById('cancelWaitBtn'),
    onlineCount:    document.getElementById('onlineCount'),
    searchingTitle: document.getElementById('searchingTitle'),
    waitingMessage: document.getElementById('waitingMessage'),
    player1Name:    document.getElementById('player1Name'),
    player2Name:    document.getElementById('player2Name'),
    player1Score:   document.getElementById('player1Score'),
    player2Score:   document.getElementById('player2Score'),
    player1Display: document.getElementById('player1Display'),
    player2Display: document.getElementById('player2Display'),
    optionBtns:     Array.from(document.querySelectorAll('.option-btn')),
    feedback:       document.getElementById('feedback'),
    playAgainBtn:   document.getElementById('playAgainBtn'),
    homeBtn:        document.getElementById('homeBtn')
  };
  
  // Butonları başlangıçta devre dışı bırak
  elements.optionBtns.forEach(btn => btn.disabled = true);

  // JSON yükleme
  async function loadPlayerData() {
    try {
      const res = await fetch('./superlig_oyuncular.json');
      const raw = await res.json();
      gameState.playerData = raw
        .map(p => {
          if (p.name && p.teams_history) return p;
          if (p.isim && Array.isArray(p.takimlar)) {
            return { name: p.isim, teams_history: p.takimlar.map(t => ({team: t})) };
          }
          return null;
        })
        .filter(Boolean);
      console.log('Oyuncu sayısı:', gameState.playerData.length);
    } catch(err) {
      console.error('JSON yükleme hatası:', err);
      alert('Veri yüklenemedi. Lütfen sayfayı yenileyin.');
    }
  }

  // ID üretici
  function genId() { return db.ref().push().key; }

  // Takım bulma
  function findCommon(p1, p2) {
    if (!p1 || !p2 || !p1.teams_history || !p2.teams_history) return [];
    const s = new Set(p1.teams_history.map(t => t.team));
    return p2.teams_history.map(t => t.team).filter(t => s.has(t));
  }

  function allTeams() {
    return Array.from(new Set(
      gameState.playerData.flatMap(p => 
        p.teams_history ? p.teams_history.map(t => t.team) : []
      )
    ));
  }

  function shuffle(a) { 
    return a.sort(() => Math.random() - 0.5); 
  }

  // Soru üretme
  function generateQuestion() {
    for (let i = 0; i < 100; i++) {
      const p1 = gameState.playerData[Math.floor(Math.random() * gameState.playerData.length)];
      const p2 = gameState.playerData[Math.floor(Math.random() * gameState.playerData.length)];
      
      if (!p1 || !p2 || p1.name === p2.name) continue;
      
      const commons = findCommon(p1, p2);
      if (commons.length === 0) continue;
      
      const correct = commons[Math.floor(Math.random() * commons.length)];
      const all = allTeams();
      const wrongs = shuffle(all.filter(t => t !== correct)).slice(0, 4);
      
      const opts = shuffle([correct, ...wrongs]);
      return {
        player1: p1.name,
        player2: p2.name,
        options: opts,
        correctIndex: opts.indexOf(correct)
      };
    }
    return generateQuestion();
  }

  // Presence & Matchmaking
  function setupPresence(nick) {
    gameState.playerId = genId();
    const ref = db.ref(`online/${gameState.playerId}`);
    ref.set({ nick, ts: firebase.database.ServerValue.TIMESTAMP });
    ref.onDisconnect().remove();
  }

  function listenOnline() {
    const ref = db.ref('online');
    const fn = ref.on('value', snap => {
      const onlinePlayers = snap.val() || {};
      const count = Object.keys(onlinePlayers).length;
      
      elements.onlineCount.textContent = count;
      elements.searchingTitle.textContent = count <= 1 ? '🔍 Bekleniyor' : '🎯 Bulundu';
      elements.waitingMessage.textContent = count <= 1 ? 'Aranıyor...' : 'Hazır!';
    });
    gameState.listeners.push({ ref, fn, event: 'value' });
  }

  // Oyun dinle ve göster
  function listenGame(gid) {
    const ref = db.ref(`games/${gid}`);
    const fn = ref.on('value', snap => {
      const gameData = snap.val();
      if (!gameData) return;

      // Oyun başladıysa ekranı değiştir
      if (gameData.player1 && gameData.player2) {
        showScreen('game');
      }
      
      updateDisplay(gameData);
    });
    gameState.listeners.push({ ref, fn, event: 'value' });
  }

  function updateDisplay(gameData) {
    // Oyun verileri yüklenene kadar bekle
    if (!gameData || !gameData.currentQuestion) return;

    const q = gameData.currentQuestion;
    
    // Oyuncu bilgileri
    elements.player1Name.textContent = gameData.player1.nickname;
    elements.player2Name.textContent = gameData.player2.nickname;
    elements.player1Score.textContent = gameData.scores.player1;
    elements.player2Score.textContent = gameData.scores.player2;
    
    // Soru bilgileri
    elements.player1Display.textContent = q.player1;
    elements.player2Display.textContent = q.player2;

    // Butonları güncelle
    elements.optionBtns.forEach((btn, i) => {
      btn.textContent = q.options[i] || '---';
      
      // Cevap verildiyse butonları kilitle
      if (gameData.answers.first || gameData.answers.second) {
        btn.disabled = true;
      } else {
        btn.disabled = false;
      }
    });
    
    // Geri bildirim
    if (gameData.answers.first) {
      const firstAnswer = gameData.answers.first;
      const isCorrect = firstAnswer.idx === q.correctIndex;
      const playerName = firstAnswer.id === gameData.player1.id 
        ? gameData.player1.nickname 
        : gameData.player2.nickname;
      
      elements.feedback.textContent = `${playerName} seçti: ${q.options[firstAnswer.idx]}. ${isCorrect ? '✅ Doğru' : '❌ Yanlış'}`;
    }
    
    // İkinci cevap verildiyse
    if (gameData.answers.first && gameData.answers.second) {
      setTimeout(() => {
        db.ref(`games/${gameState.gameId}`).update({
          currentQuestion: generateQuestion(),
          answers: { first: null, second: null }
        });
      }, 2000);
    }
  }

  async function selectAnswer(idx) {
    // Kendi cevabımızı işaretle
    gameState.hasAnswered = true;
    
    const ref = db.ref(`games/${gameState.gameId}`);
    const snap = await ref.once('value');
    const gameData = snap.val();
    
    // Oyun verisi yoksa iptal et
    if (!gameData || !gameData.answers) return;
    
    // İlk cevap daha verilmediyse
    if (!gameData.answers.first) {
      await ref.child('answers/first').set({
        id: gameState.playerId,
        idx
      });
      
      // Puan güncelle
      const isCorrect = idx === gameData.currentQuestion.correctIndex;
      const scores = { ...gameData.scores };
      
      if (gameState.playerId === gameData.player1.id) {
        scores.player1 += isCorrect ? 1 : -1;
      } else {
        scores.player2 += isCorrect ? 1 : -1;
      }
      
      await ref.child('scores').set(scores);
    } 
    // İlk cevap verilmiş ama ikinci cevap verilmemişse
    else if (!gameData.answers.second) {
      await ref.child('answers/second').set({
        id: gameState.playerId,
        idx
      });
      
      // Puan güncelle (sadece ikinci oyuncu için)
      const isCorrect = idx === gameData.currentQuestion.correctIndex;
      const scores = { ...gameData.scores };
      
      if (gameState.playerId === gameData.player1.id) {
        scores.player1 += isCorrect ? 1 : -1;
      } else {
        scores.player2 += isCorrect ? 1 : -1;
      }
      
      await ref.child('scores').set(scores);
    }
    
    // Butonları kilitle
    elements.optionBtns.forEach(btn => btn.disabled = true);
  }

  async function joinGame() {
    const nick = elements.nicknameInput.value.trim();
    if (!nick) return alert('Lütfen bir takma ad girin');
    
    await loadPlayerData();
    setupPresence(nick);
    listenOnline();

    const waitingRef = db.ref('waiting');
    const snapshot = await waitingRef.once('value');
    const waitingGames = snapshot.val() || {};

    // Bekleyen oyun var mı kontrol et
    const waitingGameIds = Object.keys(waitingGames);
    
    if (waitingGameIds.length > 0) {
      const gameId = waitingGameIds[0];
      const waitingGame = waitingGames[gameId];
      
      // Bekleyen oyunu kaldır
      await waitingRef.child(gameId).remove();
      
      // Yeni oyun oluştur
      const gameData = {
        player1: waitingGame.player1,
        player2: { id: gameState.playerId, nickname: nick },
        scores: { player1: 0, player2: 0 },
        currentQuestion: generateQuestion(),
        answers: { first: null, second: null }
      };
      
      gameState.gameId = gameId;
      await db.ref(`games/${gameId}`).set(gameData);
      listenGame(gameId);
      showScreen('game');
    } else {
      // Yeni bekleme oluştur
      const gameId = genId();
      await waitingRef.child(gameId).set({
        player1: { id: gameState.playerId, nickname: nick }
      });
      
      gameState.gameId = gameId;
      gameState.isHost = true;
      listenGame(gameId);
      showScreen('waiting');
    }
  }

  function cleanup() {
    // Tüm dinleyicileri temizle
    gameState.listeners.forEach(listener => {
      listener.ref.off(listener.event, listener.fn);
    });
    
    // Online durumu kaldır
    if (gameState.playerId) {
      db.ref(`online/${gameState.playerId}`).remove();
    }
    
    // Bekleme durumunu temizle
    if (gameState.isHost && gameState.gameId) {
      db.ref(`waiting/${gameState.gameId}`).remove();
    }
    
    // Oyun durumunu sıfırla
    gameState.listeners = [];
  }

  // Event'ler
  elements.joinGameBtn.addEventListener('click', joinGame);
  
  elements.cancelWaitBtn.addEventListener('click', () => {
    cleanup();
    showScreen('nickname');
  });
  
  elements.playAgainBtn.addEventListener('click', () => location.reload());
  elements.homeBtn.addEventListener('click', () => location.reload());
  
  elements.optionBtns.forEach((btn, index) => {
    btn.addEventListener('click', () => selectAnswer(index));
  });

  // Başlangıç
  showScreen('nickname');
});
