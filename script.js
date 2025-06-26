// script.js

window.addEventListener('DOMContentLoaded', () => {
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
  firebase.initializeApp(firebaseConfig);
  const db = firebase.database();

  // --- Oyun Durumu ---
  const gameState = {
    playerId: null,
    gameId: null,
    isPlayer1: false,
    playerData: [],
    listeners: []
  };

  // --- Ekranlar & Elementler ---
  const screens = {
    nickname: document.getElementById('nicknameScreen'),
    waiting:  document.getElementById('waitingScreen'),
    game:     document.getElementById('gameScreen'),
    result:   document.getElementById('resultScreen')
  };
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
  
  function showScreen(name) {
    Object.values(screens).forEach(s => s.classList.remove('active'));
    screens[name].classList.add('active');
  }

  // --- Veri Yükleme & Format Dönüşümü ---
  async function loadPlayerData() {
    const res = await fetch('./superlig_oyuncular.json');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const raw = await res.json();
    gameState.playerData = raw
      .map(p => {
        if (p.name && p.teams_history) return p;
        if (p.isim && Array.isArray(p.takimlar)) {
          return {
            name: p.isim,
            teams_history: p.takimlar.map(t => ({ team: t }))
          };
        }
        return null;
      })
      .filter(Boolean);
  }

  // --- Yardımcılar ---
  function genId() { return db.ref().push().key; }
  function findCommon(a, b) {
    const s = new Set(a.teams_history.map(x => x.team));
    return b.teams_history.map(x => x.team).filter(t => s.has(t));
  }
  function allTeams() {
    return Array.from(new Set(
      gameState.playerData.flatMap(p => p.teams_history.map(t => t.team))
    ));
  }
  function shuffle(arr) {
    return arr.sort(() => Math.random() - 0.5);
  }
  function generateQuestion() {
    // 1 doğru + 4 yanlış = 5 seçenek
    while (true) {
      const p1 = gameState.playerData[Math.floor(Math.random()*gameState.playerData.length)];
      const p2 = gameState.playerData[Math.floor(Math.random()*gameState.playerData.length)];
      if (!p1 || !p2 || p1.name === p2.name) continue;
      const commons = findCommon(p1, p2);
      if (!commons.length) continue;
      const correct = commons[Math.floor(Math.random()*commons.length)];
      const wrongs = shuffle(allTeams().filter(t => t !== correct)).slice(0,4);
      const options = shuffle([correct, ...wrongs]);
      return {
        player1: p1.name,
        player2: p2.name,
        options,
        correctIndex: options.indexOf(correct)
      };
    }
  }

  // --- Presence & Matchmaking ---
  function setupPresence(nick) {
    gameState.playerId = genId();
    const ref = db.ref(`onlinePlayers/${gameState.playerId}`);
    ref.set({ nickname: nick });
    ref.onDisconnect().remove();
  }
  function listenOnline() {
    const ref = db.ref('onlinePlayers');
    const fn  = ref.on('value', snap => {
      const count = snap.val() ? Object.keys(snap.val()).length : 0;
      elements.onlineCount.textContent    = count;
      elements.searchingTitle.textContent = 
        count <= 1 ? '🔍 Rakip aranıyor' 
        : count === 2 ? '🎯 Rakip bulundu' 
        : '🔍 Rakip aranıyor';
      elements.waitingMessage.textContent =
        count <= 1 ? 'Bekleyen yok' 
        : count === 2 ? 'Hazırlanıyor...' 
        : `${count-1} kişi arasında aranıyor`;
    });
    gameState.listeners.push({ ref, event:'value', fn });
  }

  // --- Oyun Akışı ---
  async function joinGame() {
    const nick = elements.nicknameInput.value.trim();
    if (!nick) return alert('Lütfen bir takma ad gir.');
    await loadPlayerData();
    setupPresence(nick);
    listenOnline();

    const waitRef = db.ref('waitingGames');
    const waitSnap = await waitRef.once('value');
    const waiting = waitSnap.val() || {};

    if (Object.keys(waiting).length) {
      // İkinci oyuncu
      const gid = Object.keys(waiting)[0];
      const gameData = waiting[gid];
      await waitRef.child(gid).remove();
      gameState.isPlayer1 = false;
      gameState.gameId   = gid;

      const active = {
        player1: gameData.player1,
        player2: { id: gameState.playerId, nickname: nick },
        scores: { player1: 0, player2: 0 },
        currentQuestion: generateQuestion(),
        answers: { first: null }
      };
      await db.ref(`activeGames/${gid}`).set(active);
      listenToGame(gid);
      showScreen('game');

    } else {
      // Birinci oyuncu
      const gid = genId();
      gameState.isPlayer1 = true;
      gameState.gameId   = gid;
      await waitRef.child(gid).set({
        player1: { id: gameState.playerId, nickname: nick }
      });
      listenForOpponent(gid);
      showScreen('waiting');
    }
  }

  function listenForOpponent(gid) {
    const ref = db.ref(`activeGames/${gid}`);
    const fn = ref.on('value', snap => {
      const d = snap.val();
      if (d && d.player2) {
        ref.off('value', fn);
        listenToGame(gid);
        showScreen('game');
      }
    });
    gameState.listeners.push({ ref, event:'value', fn });
  }

  function listenToGame(gid) {
    const ref = db.ref(`activeGames/${gid}`);
    const fn  = ref.on('value', snap => {
      const data = snap.val();
      if (data) updateDisplay(data);
    });
    gameState.listeners.push({ ref, event:'value', fn });
  }

  function cleanup() {
    gameState.listeners.forEach(o => o.ref.off(o.event, o.fn));
    db.ref(`onlinePlayers/${gameState.playerId}`).remove();
  }

  // --- Ekranı Güncelleme ---
  function updateDisplay(data) {
    // İsim & Skor
    elements.player1Name.textContent  = data.player1.nickname;
    elements.player2Name.textContent  = data.player2.nickname;
    elements.player1Score.textContent = data.scores.player1;
    elements.player2Score.textContent = data.scores.player2;

    // Soru & Şıklar
    const q = data.currentQuestion;
    elements.player1Display.textContent = q.player1;
    elements.player2Display.textContent = q.player2;

    // Butonları sıfırla, text + event
    elements.optionBtns.forEach((btn, i) => {
      btn.textContent   = q.options[i];
      btn.disabled      = false;
      btn.classList.remove('selected','disabled');

      // Önceki listener’ı silmek için clone & replace
      const fresh = btn.cloneNode(true);
      btn.parentNode.replaceChild(fresh, btn);
      elements.optionBtns[i] = fresh;

      fresh.addEventListener('click', () => selectAnswer(i));
    });

    elements.feedback.textContent = '';
  }

  // --- Cevap İşleme ---
  async function selectAnswer(idx) {
    const ref = db.ref(`activeGames/${gameState.gameId}`);
    const snap = await ref.once('value');
    const D = snap.val();
    if (!D || D.answers.first) return;

    // İlk işaretleyeni kaydet
    await ref.child('answers/first').set({
      playerId: gameState.playerId,
      index: idx
    });

    // Butonları kilitle
    elements.optionBtns.forEach(b => {
      b.disabled = true;
      b.classList.add('disabled');
    });

    // Puan güncelle
    const correct = idx === D.currentQuestion.correctIndex;
    const newScores = { ...D.scores };
    if (gameState.playerId === D.player1.id) newScores.player1 += correct ? 1 : -1;
    else                                      newScores.player2 += correct ? 1 : -1;
    await ref.child('scores').set(newScores);

    // Geri bildirim
    const who = gameState.playerId === D.player1.id ? data.player1.nickname : data.player2.nickname;
    elements.feedback.textContent = `${who} seçti: ${D.currentQuestion.options[idx]}. ${correct ? '✅ Doğru!' : '❌ Yanlış!'}`;

    // Yeni soruya geç
    setTimeout(() => {
      ref.update({
        currentQuestion: generateQuestion(),
        answers: { first: null }
      });
    }, 2000);
  }

  // --- Event Dinleyiciler ---
  elements.joinGameBtn.addEventListener('click', joinGame);
  elements.cancelWaitBtn.addEventListener('click', () => {
    db.ref(`waitingGames/${gameState.gameId}`).remove();
    cleanup();
    showScreen('nickname');
  });
  elements.playAgainBtn.addEventListener('click', () => location.reload());
  elements.homeBtn.addEventListener('click', () => location.reload());

  // --- Başlangıç ---
  showScreen('nickname');
});
