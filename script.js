// script.js

// Süper Lig oyuncu verilerini JSON dosyasından HTTP üzerinden yüklemek için
async function loadPlayerData() {
  try {
    const response = await fetch('./superlig_oyuncular.json');
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
    const rawData = await response.json();

    // Eğer JSON öğeleri { isim, takimlar } formatındaysa, dönüştürelim
    gameState.playerData = rawData.map(p => {
      if (p.name && p.teams_history) {
        return p; // zaten doğru formatta
      } else if (p.isim && Array.isArray(p.takimlar)) {
        return {
          name: p.isim,
          teams_history: p.takimlar.map(t => ({ team: t }))
        };
      } else {
        console.warn('Bilinmeyen oyuncu formatı:', p);
        return null;
      }
    }).filter(Boolean);

  } catch (err) {
    console.error('superlig_oyuncular.json yüklenirken hata:', err);
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

// Firebase'i başlat
firebase.initializeApp(firebaseConfig);
const database = firebase.database();

// Oyun durumu nesnesi
const gameState = {
  playerId: null,
  gameId: null,
  playerData: [],
  currentQuestion: null,
  presenceRef: null,
  listeners: []
};

// DOM öğeleri
const screens = {
  nickname: document.getElementById('nicknameScreen'),
  waiting:  document.getElementById('waitingScreen'),
  game:     document.getElementById('gameScreen'),
  result:   document.getElementById('resultScreen')
};
const elements = {
  nicknameInput:   document.getElementById('nicknameInput'),
  joinGameBtn:     document.getElementById('joinGameBtn'),
  cancelWaitBtn:   document.getElementById('cancelWaitBtn'),
  onlineCount:     document.getElementById('onlineCount'),
  searchingTitle:  document.getElementById('searchingTitle'),
  waitingMessage:  document.getElementById('waitingMessage'),
  player1Name:     document.getElementById('player1Name'),
  player2Name:     document.getElementById('player2Name'),
  player1Score:    document.getElementById('player1Score'),
  player2Score:    document.getElementById('player2Score'),
  player1Display:  document.getElementById('player1Display'),
  player2Display:  document.getElementById('player2Display'),
  optionBtns:      Array.from(document.querySelectorAll('.option-btn')), // *5* buton
  feedback:        document.getElementById('feedback'),
  playAgainBtn:    document.getElementById('playAgainBtn'),
  homeBtn:         document.getElementById('homeBtn')
};

// Yardımcı fonksiyonlar
function showScreen(name) {
  Object.values(screens).forEach(s => s.classList.remove('active'));
  screens[name].classList.add('active');
}
function generateId() {
  return database.ref().push().key;
}
function findCommonTeams(p1, p2) {
  const set1 = new Set(p1.teams_history.map(t => t.team));
  return p2.teams_history
           .map(t => t.team)
           .filter(team => set1.has(team));
}
function getAllTeams() {
  return Array.from(
    new Set(
      gameState.playerData.flatMap(p => p.teams_history.map(t => t.team))
    )
  );
}
function shuffle(arr) {
  return arr.sort(() => Math.random() - 0.5);
}
function generateQuestion() {
  for (let i = 0; i < 100; i++) {
    const p1 = gameState.playerData[Math.floor(Math.random() * gameState.playerData.length)];
    const p2 = gameState.playerData[Math.floor(Math.random() * gameState.playerData.length)];
    if (!p1 || !p2 || p1.name === p2.name) continue;

    const commons = findCommonTeams(p1, p2);
    if (commons.length === 0) continue;

    const correctTeam = commons[Math.floor(Math.random() * commons.length)];
    const wrongs = shuffle(
      getAllTeams().filter(t => t !== correctTeam && !commons.includes(t))
    ).slice(0, 4);

    const options = shuffle([correctTeam, ...wrongs]);
    return {
      player1: p1.name,
      player2: p2.name,
      options,                // 5 öğe
      correctTeam,
      correctIndex: options.indexOf(correctTeam)
    };
  }
  // hiçe denk gelirse yeniden başlat
  return generateQuestion();
}

// Çevrimiçi varlık ekleme
function setupPresence(nickname) {
  gameState.playerId = generateId();
  const presRef = database.ref(`onlinePlayers/${gameState.playerId}`);
  gameState.presenceRef = presRef;
  presRef.set({
    nickname,
    timestamp: firebase.database.ServerValue.TIMESTAMP,
    status: 'online'
  });
  presRef.onDisconnect().remove();
}
function listenOnline() {
  const oRef = database.ref('onlinePlayers');
  const listener = oRef.on('value', snap => {
    const count = snap.val() ? Object.keys(snap.val()).length : 0;
    elements.onlineCount.textContent = count;
    elements.searchingTitle.textContent =
      count <= 1 ? '🔍 Rakip aranıyor'
      : count === 2 ? '🎯 Rakip bulundu'
      : '🔍 Rakip aranıyor';
    elements.waitingMessage.textContent =
      count <= 1
        ? 'Senin dışında kimse yok...'
        : count === 2
          ? 'Oyuna hazırlanıyor...'
          : `${count - 1} oyuncu arasında aranıyor...`;
  });
  gameState.listeners.push({ ref: oRef, event: 'value', fn: listener });
}

// Oyun akışı
async function joinGame() {
  const nickname = elements.nicknameInput.value.trim();
  if (!nickname) return alert('Lütfen takma ad girin');

  await loadPlayerData();
  setupPresence(nickname);
  listenOnline();

  const waitRef = database.ref('waitingGames');
  const snap = await waitRef.once('value');
  const waiting = snap.val() || {};

  if (Object.keys(waiting).length) {
    // Katılma
    const gid = Object.keys(waiting)[0];
    const gameData = waiting[gid];
    await waitRef.child(gid).remove();

    const active = {
      player1: gameData.player1,
      player2: { id: gameState.playerId, nickname },
      scores: { player1: 0, player2: 0 },
      currentQuestion: generateQuestion(),
      answers: { first: null }
    };
    await database.ref(`activeGames/${gid}`).set(active);
    listenToGame(gid);
    showScreen('game');
  } else {
    // Oluşturma
    const gid = generateId();
    await waitRef.child(gid).set({
      player1: { id: gameState.playerId, nickname },
      createdAt: firebase.database.ServerValue.TIMESTAMP
    });
    listenForOpponent(gid);
    showScreen('waiting');
  }
}

function listenForOpponent(gid) {
  const gRef = database.ref(`activeGames/${gid}`);
  const listener = gRef.on('value', snap => {
    const d = snap.val();
    if (d && d.player2) {
      gRef.off('value', listener);
      listenToGame(gid);
      showScreen('game');
    }
  });
  gameState.listeners.push({ ref: gRef, event: 'value', fn: listener });
}

function listenToGame(gid) {
  const gRef = database.ref(`activeGames/${gid}`);
  const listener = gRef.on('value', snap => {
    const data = snap.val();
    if (data) updateDisplay(data);
  });
  gameState.listeners.push({ ref: gRef, event: 'value', fn: listener });
}

function updateDisplay(data) {
  // İsim ve skor
  elements.player1Name.textContent = data.player1.nickname;
  elements.player2Name.textContent = data.player2.nickname;
  elements.player1Score.textContent = data.scores.player1;
  elements.player2Score.textContent = data.scores.player2;

  // Soruyu göster
  elements.player1Display.textContent = data.currentQuestion.player1;
  elements.player2Display.textContent = data.currentQuestion.player2;

  // Butonları resetle & etkinleştir
  elements.optionBtns.forEach((btn, i) => {
    btn.textContent = data.currentQuestion.options[i] || '';
    btn.disabled = false;
    btn.className = 'option-btn';
  });
  elements.feedback.textContent = '';
}

async function selectAnswer(idx) {
  const gRef = database.ref(`activeGames/${gameState.gameId}`);
  const snap = await gRef.once('value');
  const data = snap.val();
  if (!data || data.answers.first) return;

  // İlk işaretleyen
  await gRef.child('answers/first').set({
    playerId: gameState.playerId,
    index: idx
  });

  // Skor güncelle
  const correct = idx === data.currentQuestion.correctIndex;
  const newScores = { ...data.scores };
  if (gameState.playerId === data.player1.id) {
    newScores.player1 += correct ? 1 : -1;
  } else {
    newScores.player2 += correct ? 1 : -1;
  }
  await gRef.child('scores').set(newScores);

  // Geri bildirimi göster
  const first = data.player1.id === gameState.playerId ? data.player1 : data.player2;
  elements.feedback.textContent =
    `${first.nickname} seçti: ${data.currentQuestion.options[idx]}. ${correct ? '✅ Doğru!' : '❌ Yanlış!'}`;

  // Yeni soruyu 2s sonra gönder
  setTimeout(async () => {
    await gRef.update({
      currentQuestion: generateQuestion(),
      answers: { first: null },
      lastActivity: firebase.database.ServerValue.TIMESTAMP
    });
  }, 2000);
}

// Event listener’lar
elements.optionBtns.forEach((btn, i) =>
  btn.addEventListener('click', () => selectAnswer(i))
);
elements.joinGameBtn.addEventListener('click', joinGame);
elements.cancelWaitBtn.addEventListener('click', () => {
  database.ref(`waitingGames/${gameState.gameId}`).remove();
  cleanup();
  showScreen('nickname');
});
elements.playAgainBtn.addEventListener('click', () => location.reload());
elements.homeBtn.addEventListener('click', () => location.reload());

// Cleanup
function cleanup() {
  gameState.listeners.forEach(({ ref, event, fn }) => ref.off(event, fn));
  if (gameState.presenceRef) gameState.presenceRef.remove();
}

// Başlat
loadPlayerData();
showScreen('nickname');
