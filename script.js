// script.js

window.addEventListener('DOMContentLoaded', () => {
  // DOM tamamen yüklendi, artık güvenle seçebiliriz.

  // Süper Lig oyuncu verilerini JSON dosyasından HTTP üzerinden yüklemek için
  async function loadPlayerData() {
    try {
      const response = await fetch('./superlig_oyuncular.json');
      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
      const rawData = await response.json();

      // Hem eski hem yeni formatı destekle
      gameState.playerData = rawData.map(p => {
        if (p.name && p.teams_history) {
          return p;
        } else if (p.isim && Array.isArray(p.takimlar)) {
          return {
            name: p.isim,
            teams_history: p.takimlar.map(t => ({ team: t }))
          };
        } else {
          console.warn('Bilinmeyen format:', p);
          return null;
        }
      }).filter(Boolean);

    } catch (err) {
      console.error('JSON yükleme hatası:', err);
      alert('Oyun verisi yüklenemedi. Lütfen HTTP sunucusu üzerinden çalıştırın.');
    }
  }

  // Firebase konfigürasyonu
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
  const database = firebase.database();

  // Oyun durumu
  const gameState = {
    playerId: null,
    gameId: null,
    playerData: [],
    listeners: []
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
    optionBtns:     Array.from(document.querySelectorAll('.option-btn')),  // 5 button
    feedback:       document.getElementById('feedback'),
    playAgainBtn:   document.getElementById('playAgainBtn'),
    homeBtn:        document.getElementById('homeBtn')
  };

  // Yardımcılar
  function generateId() {
    return database.ref().push().key;
  }
  function findCommonTeams(p1, p2) {
    const s1 = new Set(p1.teams_history.map(t => t.team));
    return p2.teams_history.map(t => t.team).filter(t => s1.has(t));
  }
  function getAllTeams() {
    return Array.from(new Set(
      gameState.playerData.flatMap(p => p.teams_history.map(t => t.team))
    ));
  }
  function shuffle(arr) {
    return arr.sort(() => Math.random() - 0.5);
  }
  function generateQuestion() {
    // Rastgele eşleşme ve ortak bulma
    for (let i = 0; i < 100; i++) {
      const p1 = gameState.playerData[Math.floor(Math.random()*gameState.playerData.length)];
      const p2 = gameState.playerData[Math.floor(Math.random()*gameState.playerData.length)];
      if (!p1||!p2||p1.name===p2.name) continue;
      const commons = findCommonTeams(p1,p2);
      if (!commons.length) continue;

      const correct  = commons[Math.floor(Math.random()*commons.length)];
      const wrongs   = shuffle(
        getAllTeams().filter(t=>t!==correct)
      ).slice(0,4);        // 4 yanlış
      const options  = shuffle([correct, ...wrongs]);
      return {
        player1: p1.name,
        player2: p2.name,
        options,
        correctIndex: options.indexOf(correct)
      };
    }
    // Bulamazsa yeniden dene
    return generateQuestion();
  }

  // Presence & matchmaking
  function setupPresence(nick) {
    gameState.playerId = generateId();
    const ref = database.ref(`online/${gameState.playerId}`);
    ref.set({ nick, ts: firebase.database.ServerValue.TIMESTAMP });
    ref.onDisconnect().remove();
  }
  function listenOnline() {
    const oRef = database.ref('online');
    const fn   = oRef.on('value',snap=>{
      const c = snap.val()?Object.keys(snap.val()).length:0;
      elements.onlineCount.textContent=c;
      elements.searchingTitle.textContent=
        c<=1?'🔍 Rakip aranıyor':c===2?'🎯 Rakip bulundu':'🔍 Rakip aranıyor';
      elements.waitingMessage.textContent=
        c<=1?'Bekleyen yok...':c===2?'Hazırlanıyor...':`${c-1} kişi arasında...`;
    });
    gameState.listeners.push({ref:oRef,fn,event:'value'});
  }

  // Ekran güncelleme
  function updateDisplay(data) {
    const q = data.currentQuestion;
    elements.player1Name.textContent = data.player1.nickname;
    elements.player2Name.textContent = data.player2.nickname;
    elements.player1Score.textContent= data.scores.player1;
    elements.player2Score.textContent= data.scores.player2;
    elements.player1Display.textContent= q.player1;
    elements.player2Display.textContent= q.player2;

    // Butonları doldur & aktifleştir
    elements.optionBtns.forEach((btn,i)=>{
      btn.textContent = q.options[i];
      btn.disabled    = false;
      btn.className   = 'option-btn';
    });
    elements.feedback.textContent = '';
  }

  async function selectAnswer(idx) {
    const gRef = database.ref(`games/${gameState.gameId}`);
    const snap = await gRef.once('value');
    const D    = snap.val();
    if (!D || D.answers.first) return;

    // İlk işaretleyen
    await gRef.child('answers/first').set({id:gameState.playerId,idx});
    // puan
    const ok = idx===D.currentQuestion.correctIndex;
    const S  = {...D.scores};
    if (gameState.playerId===D.player1.id) S.player1 += ok?1:-1;
    else                                  S.player2 += ok?1:-1;
    await gRef.child('scores').set(S);

    // disable tüm buton
    elements.optionBtns.forEach(b=>b.disabled=true);

    // geri bildirim
    const who = D.player1.id===gameState.playerId?D.player1.nickname:D.player2.nickname;
    elements.feedback.textContent = `${who} seçti: ${D.currentQuestion.options[idx]}. ${ok?'✅ Doğru':'❌ Yanlış'}`;

    // yeni soru
    setTimeout(()=>gRef.update({
      currentQuestion: generateQuestion(),
      answers: { first: null }
    }),2000);
  }

  function listenGame(gid) {
    const ref = database.ref(`games/${gid}`);
    const fn  = ref.on('value',snap=>{
      const D=snap.val();
      if (D) updateDisplay(D);
    });
    gameState.listeners.push({ref,fn,event:'value'});
  }

  // join/create
  async function joinGame() {
    const nick = elements.nicknameInput.value.trim();
    if (!nick) return alert('Takma ad gir');
    await loadPlayerData();
    setupPresence(nick);
    listenOnline();

    const W = database.ref('waiting');
    const snap = await W.once('value');
    const wait = snap.val()||{};
    if (Object.keys(wait).length) {
      // katıl
      const gid = Object.keys(wait)[0];
      const G   = wait[gid];
      await W.child(gid).remove();
      const active = {
        player1: G.player1,
        player2: {id:gameState.playerId,nickname:nick},
        scores: {player1:0,player2:0},
        currentQuestion: generateQuestion(),
        answers: { first: null }
      };
      gameState.gameId = gid;
      await database.ref(`games/${gid}`).set(active);
      listenGame(gid);
      showScreen('game');
    } else {
      // oluştur
      const gid = generateId();
      gameState.gameId = gid;
      await W.child(gid).set({ player1:{id:gameState.playerId,nickname:nick} });
      listenGame(gid);
      showScreen('waiting');
    }
  }

  function cleanup() {
    gameState.listeners.forEach(o=>o.ref.off(o.event,o.fn));
  }

  // event’ler
  elements.joinGameBtn.addEventListener('click',joinGame);
  elements.cancelWaitBtn.addEventListener('click',()=>{
    database.ref(`waiting/${gameState.gameId}`).remove();
    cleanup();
    showScreen('nickname');
  });
  elements.playAgainBtn.addEventListener('click',()=>location.reload());
  elements.homeBtn.addEventListener('click',()=>location.reload());
  elements.optionBtns.forEach((b,i)=>b.addEventListener('click',()=>selectAnswer(i)));

  // başlangıç
  loadPlayerData();
  showScreen('nickname');
});
