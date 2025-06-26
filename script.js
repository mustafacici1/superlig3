// script.js

window.addEventListener('DOMContentLoaded', () => {
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
  if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
  const db = firebase.database();

  // Oyun durumu
  const gameState = {
    playerId: null,
    gameId: null,
    isHost: false,
    playerData: [],
    listeners: []
  };

  // Ekranlar
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

  // DOM elemanları
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

  // Yardımcı fonksiyonlar
  function genId() {
    return db.ref().push().key;
  }
  async function loadPlayerData() {
    const res = await fetch('./superlig_oyuncular.json');
    const raw = await res.json();
    gameState.playerData = raw
      .filter(p => p.isim && Array.isArray(p.takimlar))
      .map(p => ({
        name: p.isim,
        teams_history: p.takimlar.map(t => ({ team: t }))
      }));
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
    const s = new Set(p1.teams_history.map(t => t.team));
    return p2.teams_history.map(t => t.team).filter(team => s.has(team));
  }
  function generateQuestion() {
    for (let i = 0; i < 100; i++) {
      const [p1, p2] = shuffle(gameState.playerData).slice(0,2);
      if (!p1 || !p2 || p1.name === p2.name) continue;
      const commons = findCommon(p1, p2);
      if (!commons.length) continue;
      const correct = commons[Math.floor(Math.random()*commons.length)];
      const wrongs = shuffle(allTeams().filter(t => t !== correct)).slice(0,4);
      const options = shuffle([correct, ...wrongs]);
      return { player1: p1.name, player2: p2.name, options, correctIndex: options.indexOf(correct) };
    }
    return { player1:'', player2:'', options:['','','','',''], correctIndex:0 };
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
      const cnt = snap.numChildren();
      elems.onlineCount.textContent = cnt;
      elems.searchingTitle.textContent = cnt>1?'🎯 Rakip Bulundu':'🔍 Rakip Aranıyor';
      elems.waitingMessage.textContent = cnt>1?'Hazır!':'Bekleniyor...';
    });
    gameState.listeners.push({ ref, fn });
  }
  function listenGame(id) {
    const ref = db.ref(`games/${id}`);
    const fn = ref.on('value', snap => {
      const data = snap.val();
      if (!data) return;
      if (data.player1 && data.player2) showScreen('game');
      updateDisplay(data);
    });
    gameState.listeners.push({ ref, fn });
  }
  function cleanup() {
    gameState.listeners.forEach(l => l.ref.off('value', l.fn));
    if (gameState.playerId) db.ref(`online/${gameState.playerId}`).remove();
    if (gameState.isHost && gameState.gameId) db.ref(`waiting/${gameState.gameId}`).remove();
    gameState.listeners = [];
  }

  // Ekranı güncelle
  function updateDisplay(data) {
    const answers = data.answers || { first: null };
    elems.player1Name.textContent = data.player1.nickname;
    elems.player2Name.textContent = data.player2.nickname;
    elems.player1Score.textContent = data.scores.player1;
    elems.player2Score.textContent = data.scores.player2;
    elems.player1Display.textContent = data.currentQuestion.player1;
    elems.player2Display.textContent = data.currentQuestion.player2;

    const locked = !!answers.first;
    elems.optionBtns.forEach((btn, idx) => {
      btn.textContent = data.currentQuestion.options[idx];
      btn.disabled = locked;
      btn.classList.remove('correct','incorrect');
      if (answers.first) {
        if (idx === data.currentQuestion.correctIndex) btn.classList.add('correct');
        else if (idx === answers.first.idx) btn.classList.add('incorrect');
      }
    });

    if (answers.first) {
      const who = answers.first.id===data.player1.id?data.player1.nickname:data.player2.nickname;
      const isCorrect = answers.first.idx===data.currentQuestion.correctIndex;
      elems.feedback.textContent = `${who} seçti: ${data.currentQuestion.options[answers.first.idx]} – ${isCorrect? '✅':'❌'}`;
      elems.feedback.className = `feedback ${isCorrect?'correct':'incorrect'}`;
    } else {
      elems.feedback.textContent = '';
      elems.feedback.className = 'feedback';
    }
  }

  // Cevap seçimi
  async function selectAnswer(idx) {
    const ref = db.ref(`games/${gameState.gameId}`);
    const snap = await ref.once('value');
    const data = snap.val();
    if (!data) return;

    // sadece bir kez
    if (data.answers && data.answers.first) return;

    await ref.child('answers/first').set({ id: gameState.playerId, idx });
    const correct = data.currentQuestion.correctIndex;
    const delta = idx===correct?1:-1;
    const key = gameState.playerId===data.player1.id?'player1':'player2';
    const newScores = {...data.scores};
    newScores[key] += delta;
    await ref.child('scores').set(newScores);

    setTimeout(()=>{
      ref.update({
        currentQuestion: generateQuestion(),
        answers: { first: null }
      });
    }, 2000);
  }

  // Oyuna katıl
  async function joinGame() {
    const nick = elems.nicknameInput.value.trim();
    if (!nick) return alert('Takma ad girin');
    await loadPlayerData();
    setupPresence(nick);
    listenOnline();

    const waitingRef = db.ref('waiting');
    const snap = await waitingRef.once('value');
    const list = snap.val()||{};
    if (Object.keys(list).length) {
      const id = Object.keys(list)[0];
      const host = list[id].player1;
      await waitingRef.child(id).remove();
      const gd = {
        player1: host,
        player2: { id:gameState.playerId, nickname:nick },
        scores: { player1:0, player2:0 },
        currentQuestion: generateQuestion(),
        answers: { first:null }
      };
      gameState.gameId = id;
      await db.ref(`games/${id}`).set(gd);
      listenGame(id);
    } else {
      const id = genId();
      await waitingRef.child(id).set({ player1:{ id:gameState.playerId, nickname:nick }});
      gameState.gameId = id;
      gameState.isHost = true;
      listenGame(id);
      showScreen('waiting');
    }
  }

  // Event listenerlar
  elems.joinGameBtn.addEventListener('click', joinGame);
  elems.cancelWaitBtn.addEventListener('click',()=>{
    cleanup();
    showScreen('nickname');
  });
  elems.optionBtns.forEach((btn,i)=>btn.addEventListener('click',()=>selectAnswer(i)));
  elems.playAgainBtn.addEventListener('click',()=>location.reload());
  elems.homeBtn.addEventListener('click',()=>location.reload());

  showScreen('nickname');
});
