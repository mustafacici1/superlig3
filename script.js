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
    isHost: false
  };

  // Ekranlar
  const screens = {
    nickname: document.getElementById('nicknameScreen'),
    waiting:  document.getElementById('waitingScreen'),
    game:     document.getElementById('gameScreen')
  };
  function showScreen(name) {
    Object.values(screens).forEach(s => s.classList.remove('active'));
    screens[name].classList.add('active');
  }

  // DOM elementleri
  const elems = {
    nicknameInput:  document.getElementById('nicknameInput'),
    joinGameBtn:    document.getElementById('joinGameBtn'),
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
    feedback:       document.getElementById('feedback')
  };

  // JSON yükleme
  async function loadPlayerData() {
    try {
      const res = await fetch('./superlig_oyuncular.json');
      const raw = await res.json();
      gameState.playerData = raw.filter(p => p.name && p.teams_history);
      console.log('Oyuncu sayısı:', gameState.playerData.length);
    } catch(err) {
      console.error('JSON yükleme hatası:', err);
      alert('Veri yüklenemedi. Lütfen sayfayı yenileyin.');
    }
  }

  function genId() { return db.ref().push().key; }

  function findCommon(p1, p2) {
    const s1 = new Set(p1.teams_history.map(t => t.team));
    return p2.teams_history.map(t => t.team).filter(t => s1.has(t));
  }
  function allTeams() {
    return Array.from(new Set(
      gameState.playerData.flatMap(p => p.teams_history.map(t => t.team))
    ));
  }
  function shuffle(a) { return a.sort(() => Math.random() - 0.5); }

  function generateQuestion() {
    // sonsuz döngü yerine güvenli bir deneme
    for (let i = 0; i < 100; i++) {
      const [p1, p2] = shuffle(gameState.playerData).slice(0,2);
      if (!p1 || !p2 || p1.name===p2.name) continue;
      const commons = findCommon(p1,p2);
      if (!commons.length) continue;
      const correct = commons[Math.floor(Math.random()*commons.length)];
      const wrongs = shuffle(allTeams().filter(t=>t!==correct)).slice(0,4);
      const opts = shuffle([correct, ...wrongs]);
      return {
        player1: p1.name,
        player2: p2.name,
        options: opts,
        correctIndex: opts.indexOf(correct)
      };
    }
    return { player1:'', player2:'', options: ['','','','',''], correctIndex:0 };
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
      const count = snap.numChildren();
      elems.onlineCount.textContent = count;
      elems.searchingTitle.textContent = count>1? '🎯 Bulundu':'🔍 Bekleniyor';
      elems.waitingMessage.textContent = count>1? 'Hazır!':'Aranıyor...';
    });
    gameState.listeners.push({ ref, fn });
  }

  function listenGame(gid) {
    const ref = db.ref(`games/${gid}`);
    const fn = ref.on('value', snap => {
      const g = snap.val();
      if (!g) return;
      if (g.player1 && g.player2) showScreen('game');
      updateDisplay(g);
    });
    gameState.listeners.push({ ref, fn });
  }

  function updateDisplay(g) {
    if (!g.currentQuestion) return;
    // skor ve isimler
    elems.player1Name.textContent = g.player1.nickname;
    elems.player2Name.textContent = g.player2.nickname;
    elems.player1Score.textContent = g.scores.player1;
    elems.player2Score.textContent = g.scores.player2;

    // soru
    elems.player1Display.textContent = g.currentQuestion.player1;
    elems.player2Display.textContent = g.currentQuestion.player2;
    // seçenekler
    elems.optionBtns.forEach((btn,i) => {
      btn.textContent = g.currentQuestion.options[i];
      btn.disabled = !!(g.answers.first && g.answers.second);
      btn.classList.remove('correct','wrong');
      // doğru cevabı işaretle
      if (g.answers.first || g.answers.second) {
        if (i===g.currentQuestion.correctIndex) btn.classList.add('correct');
      }
    });
    // geri bildirim
    if (g.answers.first) {
      const first = g.answers.first;
      const name = first.id===g.player1.id? g.player1.nickname: g.player2.nickname;
      elems.feedback.textContent = `${name} seçti: ${g.currentQuestion.options[first.idx]}`;
    } else {
      elems.feedback.textContent = '';
    }
  }

  async function selectAnswer(idx) {
    const ref = db.ref(`games/${gameState.gameId}`);
    const snap = await ref.once('value');
    const g = snap.val();
    if (!g) return;

    const isFirstDone = !!g.answers.first;
    const answerKey = isFirstDone? 'second':'first';

    // cevabı yaz
    await ref.child(`answers/${answerKey}`).set({
      id: gameState.playerId,
      idx
    });

    // puan hesapla
    const correct = g.currentQuestion.correctIndex;
    const delta = idx===correct? 1 : -1;
    const scores = {...g.scores};
    const playerNum = (gameState.playerId===g.player1.id? 'player1':'player2');
    scores[playerNum] += delta;
    await ref.child('scores').set(scores);

    // ikinci cevap da geldiyse yeni soru
    if (isFirstDone) {
      setTimeout(async () => {
        await ref.update({
          currentQuestion: generateQuestion(),
          answers: { first: null, second: null }
        });
      }, 2000);
    }
  }

  async function joinGame() {
    const nick = elems.nicknameInput.value.trim();
    if (!nick) return alert('Lütfen bir takma ad girin');
    await loadPlayerData();
    setupPresence(nick);
    listenOnline();

    const waitingRef = db.ref('waiting');
    const snap = await waitingRef.once('value');
    const list = snap.val()||{};

    if (Object.keys(list).length) {
      // bekleyen oyunu al
      const gameId = Object.keys(list)[0];
      await waitingRef.child(gameId).remove();
      const host = list[gameId].player1;
      const gameObj = {
        player1: host,
        player2: { id: gameState.playerId, nickname: nick },
        scores: { player1:0, player2:0 },
        currentQuestion: generateQuestion(),
        answers: { first:null, second:null }
      };
      gameState.gameId = gameId;
      await db.ref(`games/${gameId}`).set(gameObj);
      listenGame(gameId);
    } else {
      // yeni bekleme
      const gameId = genId();
      await waitingRef.child(gameId).set({
        player1: { id:gameState.playerId, nickname:nick }
      });
      gameState.gameId = gameId;
      gameState.isHost = true;
      listenGame(gameId);
      showScreen('waiting');
    }
  }

  elems.joinGameBtn.addEventListener('click', joinGame);
  elems.optionBtns.forEach((btn,i) => {
    btn.addEventListener('click', () => selectAnswer(i));
  });

  // başlangıç ekranı
  showScreen('nickname');
});
