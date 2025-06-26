// script.js

window.addEventListener('DOMContentLoaded', () => {
  console.log('DOM yüklendi, script başlıyor.');

  // --- Firebase Ayarları ---
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
  if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
  const db = firebase.database();

  // --- Oyun Durumu ---
  const gameState = {
    playerId: null,
    gameId: null,
    isHost: false,
    playerData: [],
    listeners: []
  };

  // --- Ekran Yönetimi ---
  const screens = {
    nickname:  document.getElementById('nicknameScreen'),
    waiting:   document.getElementById('waitingScreen'),
    game:      document.getElementById('gameScreen'),
    result:    document.getElementById('resultScreen')
  };
  function showScreen(name) {
    Object.values(screens).forEach(s => s.classList.remove('active'));
    screens[name].classList.add('active');
  }

  // --- DOM Öğeleri ---
  const elems = {
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
    homeBtn:        document.getElementById('homeBtn'),
    resultTitle:    document.getElementById('resultTitle'),
    finalScores:    document.getElementById('finalScores')
  };

  // --- Yardımcı Fonksiyonlar ---
  function genId() {
    return db.ref().push().key;
  }

  async function loadPlayerData() {
    try {
      const res = await fetch('./superlig_oyuncular.json');
      const raw = await res.json();
      gameState.playerData = raw.filter(p => p.name && p.teams_history);
      console.log('Oyuncu sayısı:', gameState.playerData.length);
    } catch (err) {
      console.error('JSON yükleme hatası:', err);
      alert('Veri yüklenemedi. Lütfen sayfayı yenileyin.');
    }
  }

  function shuffle(arr) {
    return arr.sort(() => Math.random() - 0.5);
  }

  function allTeams() {
    return Array.from(new Set(
      gameState.playerData.flatMap(p => p.teams_history.map(t => t.team))
    ));
  }

  function findCommon(p1, p2) {
    const set1 = new Set(p1.teams_history.map(t => t.team));
    return p2.teams_history.map(t => t.team).filter(team => set1.has(team));
  }

  function generateQuestion() {
    for (let i = 0; i < 100; i++) {
      const [p1, p2] = shuffle(gameState.playerData).slice(0, 2);
      if (!p1 || !p2 || p1.name === p2.name) continue;
      const commons = findCommon(p1, p2);
      if (!commons.length) continue;
      const correct = commons[Math.floor(Math.random() * commons.length)];
      const wrongs = shuffle(
        allTeams().filter(t => t !== correct)
      ).slice(0, 4);
      const options = shuffle([correct, ...wrongs]);
      return {
        player1: p1.name,
        player2: p2.name,
        options,
        correctIndex: options.indexOf(correct)
      };
    }
    // Yeterli soru yoksa boş dön
    return {
      player1: '', player2: '',
      options: ['', '', '', '', ''],
      correctIndex: 0
    };
  }

  // --- Presence & Matchmaking ---
  function setupPresence(nick) {
    gameState.playerId = genId();
    const ref = db.ref(`online/${gameState.playerId}`);
    ref.set({ nick, ts: firebase.database.ServerValue.TIMESTAMP });
    ref.onDisconnect().remove();
  }

  function listenOnline() {
    const ref = db.ref('online');
    const fn = ref.on('value', snap => {
      const count = snap.numChildren();
      elems.onlineCount.textContent = count;
      elems.searchingTitle.textContent = count > 1 ? '🎯 Rakip Bulundu' : '🔍 Rakip Aranıyor';
      elems.waitingMessage.textContent = count > 1 ? 'Hazır!' : 'Bekleniyor...';
    });
    gameState.listeners.push({ ref, fn });
  }

  function listenGame(gameId) {
    const ref = db.ref(`games/${gameId}`);
    const fn = ref.on('value', snap => {
      const data = snap.val();
      if (!data) return;
      // Oyuna geç
      if (data.player1 && data.player2) showScreen('game');
      updateDisplay(data);
    });
    gameState.listeners.push({ ref, fn });
  }

  function cleanup() {
    gameState.listeners.forEach(l => l.ref.off('value', l.fn));
    if (gameState.playerId) {
      db.ref(`online/${gameState.playerId}`).remove();
    }
    if (gameState.isHost && gameState.gameId) {
      db.ref(`waiting/${gameState.gameId}`).remove();
    }
    gameState.listeners = [];
  }

  // --- Ekranı Güncelle ---
  function updateDisplay(data) {
    // İsimler & skorlar
    elems.player1Name.textContent = data.player1.nickname;
    elems.player2Name.textContent = data.player2.nickname;
    elems.player1Score.textContent = data.scores.player1;
    elems.player2Score.textContent = data.scores.player2;

    // Player display
    elems.player1Display.textContent = data.currentQuestion.player1;
    elems.player2Display.textContent = data.currentQuestion.player2;

    // Şıklar
    const bothAnswered = data.answers.first && data.answers.second;
    elems.optionBtns.forEach((btn, idx) => {
      btn.textContent = data.currentQuestion.options[idx];
      btn.disabled = bothAnswered;
      btn.classList.remove('correct', 'incorrect');
      // Eğer bir cevap verilmişse doğruyu işaretle
      if (data.answers.first || data.answers.second) {
        if (idx === data.currentQuestion.correctIndex) {
          btn.classList.add('correct');
        }
      }
    });

    // Geri bildirim
    if (data.answers.first) {
      const ans = data.answers.first;
      const name = ans.id === data.player1.id
        ? data.player1.nickname
        : data.player2.nickname;
      const isCorrect = ans.idx === data.currentQuestion.correctIndex;
      elems.feedback.textContent = `${name} seçti: ${data.currentQuestion.options[ans.idx]} – ${isCorrect ? '✅ Doğru' : '❌ Yanlış'}`;
      elems.feedback.className = `feedback ${isCorrect ? 'correct' : 'incorrect'}`;
    } else {
      elems.feedback.textContent = '';
      elems.feedback.className = 'feedback';
    }
  }

  // --- Cevap Seçimi ---
  async function selectAnswer(idx) {
    const ref = db.ref(`games/${gameState.gameId}`);
    const snap = await ref.once('value');
    const data = snap.val();
    if (!data) return;

    const target = data.answers.first ? 'second' : 'first';
    // Cevabı kaydet
    await ref.child(`answers/${target}`).set({
      id: gameState.playerId,
      idx
    });

    // Puan güncelle
    const correct = data.currentQuestion.correctIndex;
    const delta = idx === correct ? 1 : -1;
    const key = gameState.playerId === data.player1.id ? 'player1' : 'player2';
    const newScores = { ...data.scores };
    newScores[key] += delta;
    await ref.child('scores').set(newScores);

    // Eğer ikinci cevapsa yeni soruya geç
    if (target === 'second') {
      setTimeout(() => {
        ref.update({
          currentQuestion: generateQuestion(),
          answers: { first: null, second: null }
        });
      }, 2000);
    }
  }

  // --- Oyuna Katıl / Eşleştirme ---
  async function joinGame() {
    const nick = elems.nicknameInput.value.trim();
    if (!nick) return alert('Lütfen bir takma ad girin.');

    await loadPlayerData();
    setupPresence(nick);
    listenOnline();

    const waitingRef = db.ref('waiting');
    const snap = await waitingRef.once('value');
    const list = snap.val() || {};

    if (Object.keys(list).length) {
      // Mevcut bekleyen oyunu al
      const gameId = Object.keys(list)[0];
      const host = list[gameId].player1;
      await waitingRef.child(gameId).remove();

      const gameData = {
        player1: host,
        player2: { id: gameState.playerId, nickname: nick },
        scores: { player1: 0, player2: 0 },
        currentQuestion: generateQuestion(),
        answers: { first: null, second: null }
      };
      gameState.gameId = gameId;
      await db.ref(`games/${gameId}`).set(gameData);
      listenGame(gameId);
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

  // --- Event Listeners ---
  elems.joinGameBtn.addEventListener('click', joinGame);
  elems.cancelWaitBtn.addEventListener('click', () => {
    cleanup();
    showScreen('nickname');
  });
  elems.optionBtns.forEach((btn, idx) =>
    btn.addEventListener('click', () => selectAnswer(idx))
  );
  elems.playAgainBtn.addEventListener('click', () => location.reload());
  elems.homeBtn.addEventListener('click', () => location.reload());

  // Başlangıç ekranı
  showScreen('nickname');
});
