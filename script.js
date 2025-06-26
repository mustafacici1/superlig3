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
  firebase.initializeApp(firebaseConfig);
  const db = firebase.database();

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
    optionBtns:     Array.from(document.querySelectorAll('.option-btn')),  // burada 5 olması lazım
    feedback:       document.getElementById('feedback'),
    playAgainBtn:   document.getElementById('playAgainBtn'),
    homeBtn:        document.getElementById('homeBtn')
  };
  console.log('Buton sayısı:', elements.optionBtns.length);

  // JSON yükleme
  async function loadPlayerData() {
    try {
      const res = await fetch('./superlig_oyuncular.json');
      const raw = await res.json();
      gameState.playerData = raw
        .map(p => {
          if (p.name && p.teams_history) return p;
          if (p.isim && Array.isArray(p.takimlar)) {
            return { name: p.isim, teams_history: p.takimlar.map(t=>({team:t})) };
          }
          return null;
        })
        .filter(Boolean);
      console.log('Oyuncu sayısı:', gameState.playerData.length);
    } catch(err) {
      console.error('JSON yükleme hatası:', err);
      alert('Veri yüklenemedi.');
    }
  }

  // ID üretici
  function genId() { return db.ref().push().key; }

  // Takım bulma
  function findCommon(p1,p2){
    const s=new Set(p1.teams_history.map(t=>t.team));
    return p2.teams_history.map(t=>t.team).filter(t=>s.has(t));
  }
  function allTeams(){
    return Array.from(new Set(
      gameState.playerData.flatMap(p=>p.teams_history.map(t=>t.team))
    ));
  }
  function shuffle(a){ return a.sort(()=>Math.random()-0.5); }

  // Soru üretme
  function generateQuestion(){
    for(let i=0;i<100;i++){
      const p1=gameState.playerData[Math.floor(Math.random()*gameState.playerData.length)];
      const p2=gameState.playerData[Math.floor(Math.random()*gameState.playerData.length)];
      if(!p1||!p2||p1.name===p2.name) continue;
      const commons=findCommon(p1,p2);
      if(commons.length===0) continue;
      const correct=commons[Math.floor(Math.random()*commons.length)];
      const wrongs=shuffle(allTeams().filter(t=>t!==correct)).slice(0,4);
      const opts=shuffle([correct,...wrongs]);
      console.log('New Question:', p1.name, p2.name, opts);
      return {
        player1:p1.name,
        player2:p2.name,
        options:opts,
        correctIndex:opts.indexOf(correct)
      };
    }
    return generateQuestion();
  }

  // Presence & Matchmaking
  function setupPresence(nick){
    gameState.playerId=genId();
    const ref=db.ref(`online/${gameState.playerId}`);
    ref.set({nick,ts:firebase.database.ServerValue.TIMESTAMP});
    ref.onDisconnect().remove();
  }
  function listenOnline(){
    const ref=db.ref('online');
    const fn=ref.on('value',snap=>{
      const c=snap.val()?Object.keys(snap.val()).length:0;
      elements.onlineCount.textContent=c;
      elements.searchingTitle.textContent= c<=1?'🔍 Bekleniyor':c===2?'🎯 Bulundu':'🔍 Bekleniyor';
      elements.waitingMessage.textContent= c<=1?'Yok':c===2?'Hazır':'Aranıyor';
    });
    gameState.listeners.push({ref,fn,event:'value'});
  }

  // Oyun dinle ve göster
  function listenGame(gid){
    const ref=db.ref(`games/${gid}`);
    const fn=ref.on('value',snap=>{
      const D=snap.val();
      if(D) updateDisplay(D);
    });
    gameState.listeners.push({ref,fn,event:'value'});
  }

  function updateDisplay(D){
    const q=D.currentQuestion;
    elements.player1Name.textContent=D.player1.nickname;
    elements.player2Name.textContent=D.player2.nickname;
    elements.player1Score.textContent=D.scores.player1;
    elements.player2Score.textContent=D.scores.player2;
    elements.player1Display.textContent=q.player1;
    elements.player2Display.textContent=q.player2;

    // Butonları mutlaka resetle
    elements.optionBtns.forEach((btn,i)=>{
      btn.textContent = q.options[i] || '---';
      btn.disabled = false;
      btn.classList.add('option-btn');
    });
    elements.feedback.textContent='';
  }

  async function selectAnswer(idx){
    const ref=db.ref(`games/${gameState.gameId}`);
    const snap=await ref.once('value');
    const D=snap.val(); if(!D||D.answers.first) return;
    await ref.child('answers/first').set({id:gameState.playerId,idx});
    const ok= idx===D.currentQuestion.correctIndex;
    const S={...D.scores};
    if(gameState.playerId===D.player1.id) S.player1+=ok?1:-1;
    else                                 S.player2+=ok?1:-1;
    await ref.child('scores').set(S);

    // Hepsini kilitle
    elements.optionBtns.forEach(b=>b.disabled=true);

    const who = (D.player1.id===gameState.playerId?D.player1.nickname:D.player2.nickname);
    elements.feedback.textContent=`${who} seçti: ${D.currentQuestion.options[idx]}. ${ok?'✅ Doğru':'❌ Yanlış'}`;

    setTimeout(()=>ref.update({
      currentQuestion:generateQuestion(),
      answers:{first:null}
    }),2000);
  }

  async function joinGame(){
    const nick=elements.nicknameInput.value.trim();
    if(!nick) return alert('Takma ad gir');
    await loadPlayerData();
    setupPresence(nick);
    listenOnline();

    const W=db.ref('waiting');
    const snap=await W.once('value');
    const wait=snap.val()||{};
    if(Object.keys(wait).length){
      const gid=Object.keys(wait)[0], G=wait[gid];
      await W.child(gid).remove();
      const active={
        player1:G.player1,
        player2:{id:gameState.playerId,nickname:nick},
        scores:{player1:0,player2:0},
        currentQuestion:generateQuestion(),
        answers:{first:null}
      };
      gameState.gameId=gid;
      await db.ref(`games/${gid}`).set(active);
      listenGame(gid);
      showScreen('game');
    } else {
      const gid=genId();
      await W.child(gid).set({player1:{id:gameState.playerId,nickname:nick}});
      gameState.gameId=gid;
      listenGame(gid);
      showScreen('waiting');
    }
  }

  function cleanup(){
    gameState.listeners.forEach(o=>o.ref.off(o.event,o.fn));
  }

  // Event’ler
  elements.joinGameBtn.addEventListener('click',joinGame);
  elements.cancelWaitBtn.addEventListener('click',()=>{
    db.ref(`waiting/${gameState.gameId}`).remove();
    cleanup();
    showScreen('nickname');
  });
  elements.playAgainBtn.addEventListener('click',()=>location.reload());
  elements.homeBtn.addEventListener('click',()=>location.reload());
  elements.optionBtns.forEach((b,i)=>b.addEventListener('click',()=>selectAnswer(i)));

  // Başlangıç ekranı
  loadPlayerData();
  showScreen('nickname');
});
