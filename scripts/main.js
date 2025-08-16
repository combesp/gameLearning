/* =============================================================
   MAGICAL SOUNDS — Reading Practice Game
   -------------------------------------------------------------
   • Single-file HTML/CSS/JS (works on desktop & mobile)
   • Web Speech API (TTS) to announce the sound in French
   • 4 big options per round, click/tap the correct grapheme
   • Timer with selectable duration (5/10/20/30 seconds)
   • Speed-based scoring + streak bonus
   • Encouraging feedback; confetti on success
   • Leitner (5 boxes) spaced repetition within the session
   • Progressive difficulty: starts with [on, ou, an, ai], then
     unlocks one new sound every 5 correct answers
   • Clean, commented code (English) for maintainability
   ============================================================= */

// ---------- Data: graphemes and their "phoneme family" ----------
// Family is used to avoid offering equivalent graphemes together
// in the same question (e.g., an/en belong to the same nasal sound).
const SOUNDS_ORDERED = [
  // Initial set (level 1)
  { g: 'ch', fam: 'ch' },
  { g: 'ou', fam: 'ou' },
  { g: 'on', fam: 'on' },
  { g: 'fr', fam: 'fr' },
  { g: 'cl', fam: 'cl' },
  // Progressive unlocks (each added later)
  { g: 'in', fam: 'in' },
  { g: 'oi', fam: 'oi' },
  { g: 'ai', fam: 'ai' },
  { g: 'ei', fam: 'ai' },
  { g: 'an', fam: 'an' },
  { g: 'en', fam: 'an' },
  { g: 'ph', fam: 'ph' }, // pronounced /f/
  { g: 'au', fam: 'au' },
  { g: 'eu', fam: 'eu' },
  { g: 'gn', fam: 'gn' },
  { g: 'er', fam: 'et' },
  { g: 'un', fam: 'un' },
  { g: 'ill', fam: 'ill' },
  { g: 'ien', fam: 'ien' },
  { g: 'ain', fam: 'in' },
  { g: 'et', fam: 'et' },
  { g: 'ein', fam: 'in' },
  { g: 'am', fam: 'an' },
  { g: 'em', fam: 'an' },
  { g: 'ez', fam: 'et' },
  { g: 'um', fam: 'un' },
  { g: 'eau', fam: 'au' },
  { g: 'œu', fam: 'eu' },
];

// How to pronounce each grapheme with TTS (French). Some are adjusted
// so the synthetic voice says the intended sound (e.g., "ill" -> "ille").
const PRONOUNCE = {
  'fr': 'freu',
  'in': 'hin',
  'eu': 'eux',
  'cl': 'cleu',
  'an': 'en',
  'ill': 'iille',
  'ph': 'feu',
  'œu': 'eux',
  'oi': 'oie',
  'au': 'o',
  'eau': 'o',
  'ch': 'cheu',
  'gn': 'gneu',
  'ien': 'hien',
  'ain': 'in',
  'ein': 'in',
  'am': 'en',
  'em': 'en',
  'um': 'un',
  // default: use grapheme itself
};

// Encouragement/correction messages (French kid-friendly)
const PRAISE = [
  'Bravo ! 🦄✨', 'Super ! 👑', 'Génial ! 🌈', 'Magnifique ! 🧚‍♀️', 'Tu es un champion ! 💫'
];
const ENCOURAGE = [
  'Presque ! On réessaie ! 💪', 'Pas grave, tu vas y arriver ! 🌟', 'Courage, tu progresses ! 🦄', 'On continue, tu es fort ! 👑'
];

// Leitner box intervals in *questions*, randomized in range for variety
const BOX_INTERVALS = {
  1: [1, 2],   // show again very soon
  2: [3, 5],
  3: [7, 12],
  4: [15, 24],
  5: [28, 40], // fairly spaced
};

// Game state (in-memory only — no persistence in v1)
const state = {
  activeCount: 4,              // starts with 4 sounds (on, ou, an, ai)
  correctSinceUnlock: 0,       // every 5 correct answers unlocks 1 new sound
  deck: [],                    // array of Card objects
  questionIndex: 0,            // counts asked questions to compute due
  current: null,               // current Card
  lastTargetG: null,           // avoid same target twice in a row
  timerTotal: 10 * 1000,       // ms (default 10s)
  timerLeft: 0,
  timerTick: null,
  score: 0,
  asked: 0,
  right: 0,
  streak: 0,
  muted: false,
  showingSoundOnScreen: false,
  castleStage: 0,
};

// Background music (gentle loop)
const bgm = new Audio('Media/Rainbow Dreams.mp3');
bgm.loop = true;
bgm.volume = 0.2; // keep low so speech remains clear

// Card object factory
function makeCard({ g, fam }){
  return {
    g, fam,
    box: 1,
    dueAt: 0,        // next question index when this card is due
    stats: { asked: 0, correct: 0 },
  };
}

// Initialize deck with the first N sounds
function initDeck(){
  state.deck = SOUNDS_ORDERED.slice(0, state.activeCount).map(makeCard);
  state.correctSinceUnlock = 0;
  state.questionIndex = 0;
  state.current = null;
  state.lastTargetG = null;
  state.score = 0; state.asked = 0; state.right = 0; state.streak = 0;
  state.castleStage = 0;
  updateHUD();
}

// Unlock one additional sound (if available)
function unlockNext(){
  if(state.activeCount >= SOUNDS_ORDERED.length) return false;
  const next = SOUNDS_ORDERED[state.activeCount];
  state.deck.push(makeCard(next));
  state.activeCount += 1;
  state.correctSinceUnlock = 0;
  pulseLevelBar();
  return true;
}

// Utility: random int in [a, b]
const rnd = (a,b)=> Math.floor(Math.random()*(b-a+1))+a;

// Schedule next dueAt based on Leitner box
function schedule(card){
  const [minQ, maxQ] = BOX_INTERVALS[card.box] || [3,6];
  const offset = rnd(minQ, maxQ);
  card.dueAt = state.questionIndex + offset;
}

// Choose next target card (prefer those due; if none, pick closest
// and prefer lower box numbers so "weak" items show up more often)
function pickNextCard(){
  // candidates: due or closest
  const due = state.deck.filter(c => c.dueAt <= state.questionIndex);
  if(due.length){
    // Prefer lowest box among due, avoid same as last target
    due.sort((a,b)=> a.box - b.box || a.dueAt - b.dueAt);
    const choices = due.filter(c=> c.g !== state.lastTargetG);
    return (choices[0] || due[0]);
  }
  // Otherwise, pick the soonest due; tie-breaker lower box
  const soonest = [...state.deck].sort((a,b)=> (a.dueAt - b.dueAt) || (a.box - b.box));
  const choices = soonest.filter(c=> c.g !== state.lastTargetG);
  return (choices[0] || soonest[0]);
}

// Build 3 distractors from other families (to avoid ambiguous pairs)
function buildOptions(target){
  const pool = state.deck.filter(c => c.g !== target.g && c.fam !== target.fam);
  // If pool has less than 3 (early levels), take from full catalog excluding same family
  let extra = [];
  if(pool.length < 3){
    extra = SOUNDS_ORDERED
      .filter(s => s.g !== target.g && s.fam !== target.fam && !state.deck.some(c => c.g === s.g));
  }
  const totalPool = [...pool, ...extra];
  // Pick 3 unique distractors with distinct families
  const distractors = [];
  const famUsed = new Set([target.fam]);
  while(distractors.length < 3 && totalPool.length){
    const i = rnd(0, totalPool.length - 1);
    const pick = totalPool.splice(i,1)[0];
    if(!famUsed.has(pick.fam)){
      distractors.push(pick);
      famUsed.add(pick.fam);
    }
  }
  // In the very unlikely case we still have <3 (extremely early), backfill from anything not same g
  while(distractors.length < 3){
    const any = SOUNDS_ORDERED[rnd(0, SOUNDS_ORDERED.length-1)];
    if(any.g !== target.g && !distractors.some(d=>d.g===any.g)) distractors.push(any);
  }
  // Assemble and shuffle
  const options = [target.g, ...distractors.map(d=>d.g)];
  for(let i=options.length-1; i>0; i--){
    const j = Math.floor(Math.random()*(i+1));
    [options[i], options[j]] = [options[j], options[i]];
  }
  return options;
}

// Speak the sound using Web Speech API in fr-FR
function speak(grapheme){
  if(state.muted) return;
  const text = PRONOUNCE[grapheme] || grapheme;
  if('speechSynthesis' in window){
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'fr-FR';
    u.rate = 0.9; // slightly slower for clarity
    u.pitch = 1.0;
    u.volume = 1.0;
    window.speechSynthesis.speak(u);
  }
}

// Optionally speak encouragement/correction
function speakShort(text){
  if(state.muted) return null;
  if('speechSynthesis' in window){
    const clean = text.replace(/[^\p{L}\p{N}\s!'?,.-]/gu, '').trim();
    const u = new SpeechSynthesisUtterance(clean);
    u.lang = 'fr-FR'; u.rate = 1.0; u.pitch = 1.0; u.volume = 1.0;
    window.speechSynthesis.speak(u);
    return u;
  }
  return null;
}

// Render HUD (castle, streak, accuracy, level, timer bar)
function updateHUD(){
  updateCastle();
  document.getElementById('streak').textContent = state.streak;
  const acc = state.asked ? Math.round((state.right/state.asked)*100) : 0;
  document.getElementById('accuracy').textContent = acc + '%';
  document.getElementById('levelLabel').textContent = state.activeCount + ' sons';
  // Level progress is fraction of sounds unlocked vs total
  const pct = Math.round((state.activeCount / SOUNDS_ORDERED.length) * 100);
  document.getElementById('levelProgress').style.width = pct + '%';
}

function updateCastle(){
  const el = document.getElementById('castle');
  el.className = 'castle stage' + state.castleStage;
}

function spawnCritters(){
  const uni = document.createElement('div');
  uni.className = 'unicorn';
  uni.style.top = (20 + Math.random()*60) + 'vh';
  document.body.appendChild(uni);
  setTimeout(()=> uni.remove(), 6000);
}

// Visual pulse on level bar when unlocking a new sound
function pulseLevelBar(){
  const bar = document.getElementById('levelProgress');
  bar.animate([
    { transform: 'scaleY(1)' },
    { transform: 'scaleY(1.8)' },
    { transform: 'scaleY(1)' },
  ], { duration: 600, easing: 'ease-out' });
  updateHUD();
}

// Start timer per question
function startTimer(){
  clearInterval(state.timerTick);
  state.timerLeft = state.timerTotal;
  setTimerBar(100);
  document.getElementById('timerText').textContent = Math.round(state.timerTotal / 1000);
  const startedAt = performance.now();
  state.timerTick = setInterval(()=>{
    const elapsed = performance.now() - startedAt;
    state.timerLeft = Math.max(0, state.timerTotal - elapsed);
    const p = Math.max(0, Math.round((state.timerLeft / state.timerTotal) * 100));
    setTimerBar(p);
    document.getElementById('timerText').textContent = Math.ceil(state.timerLeft / 1000);
    if(state.timerLeft <= 0){
      clearInterval(state.timerTick);
      timesUp();
    }
  }, 100);
}

function setTimerBar(pct){
  const t = document.querySelector('#timer i');
  t.style.width = pct + '%';
  // Optionally animate hue as time decreases (subtle)
  t.style.filter = `hue-rotate(${(100-pct)*2}deg)`;
}

// Handle timeout as incorrect answer
function timesUp(){
  lockOptions();
  showFeedback(false, `Temps écoulé ⏰ — la bonne réponse était “${state.current.g}”.`);
  // Reset card to box 1 and reschedule soon
  state.current.box = 1; schedule(state.current);
  state.streak = 0;
  state.asked++;
  updateHUD();
  // Next question after a short pause
  setTimeout(nextQuestion, 1400);
}

// Render a question round
function renderQuestion(){
  const prompt = document.getElementById('promptText');
  const optionsEl = document.getElementById('options');
  optionsEl.innerHTML = '';

  // Prompt text (may hide actual grapheme if toggle off)
  prompt.textContent = state.showingSoundOnScreen ? `Quel est le son “${state.current.g}” ?` : 'Écoute et choisis le bon son…';

  // Build option buttons
  const opts = buildOptions(state.current);
  for(const g of opts){
    const b = document.createElement('button');
    b.className = 'opt'; b.textContent = g; b.dataset.g = g;
    b.addEventListener('click', onAnswerClick, { passive: true });
    optionsEl.appendChild(b);
  }

  // Speak the target sound
  speak(state.current.g);

  // Start the timer now that everything is ready
  startTimer();

  // Clear feedback
  const fb = document.getElementById('feedback');
  fb.className = 'feedback'; fb.textContent = '';
}

function onAnswerClick(ev){
  const chosen = ev.currentTarget.dataset.g;
  lockOptions();
  clearInterval(state.timerTick);

  // Mark buttons
  document.querySelectorAll('.opt').forEach(btn=>{
    if(btn.dataset.g === state.current.g) btn.classList.add('correct');
    if(btn.dataset.g === chosen && chosen !== state.current.g) btn.classList.add('wrong');
  });

  // Update stats and deck scheduling (Leitner)
  const timeFrac = Math.max(0, Math.min(1, state.timerLeft / state.timerTotal));
  const base = 100; const speedBonus = Math.round(100 * timeFrac);
  let gained = 0;

  state.current.stats.asked++;
  state.asked++;

  let utter = null;
  if(chosen === state.current.g){
    state.current.stats.correct++;
    state.right++;
    state.streak++;
    // Move up a box, reschedule later
    state.current.box = Math.min(5, state.current.box + 1);
    schedule(state.current);

    // Scoring: base + speed bonus, streak multiplier (max +30%)
    const streakMult = 1 + Math.min(0.30, state.streak * 0.05);
    gained = Math.round((base + speedBonus) * streakMult);
    state.score += gained;

    // Feedback + confetti
    const praise = PRAISE[rnd(0, PRAISE.length-1)];
    showFeedback(true, `${praise} +${gained} pts`);
    celebrate();
    utter = speakShort(praise);

    // Unlock progression: every 5 correct answers → +1 sound
    state.correctSinceUnlock++;
    if(state.correctSinceUnlock >= 5){
      const did = unlockNext();
      if(did){ showFeedback(true, '✨ Nouveau son débloqué !'); }
    }
    state.castleStage = Math.min(8, state.castleStage + 1);
  } else {
    // Wrong: send back to box 1, reschedule soon
    state.streak = 0;
    state.current.box = 1; schedule(state.current);
    const penalty = 20; state.score = Math.max(0, state.score - penalty);
    const encourage = ENCOURAGE[rnd(0, ENCOURAGE.length-1)];
    showFeedback(false, `${encourage}  (Bonne réponse : “${state.current.g}”)`);
    utter = speakShort(encourage);
    state.castleStage = Math.max(0, state.castleStage - 1);
  }

  updateHUD();
  if(utter){
    utter.addEventListener('end', ()=> setTimeout(nextQuestion, 200), { once:true });
  } else {
    setTimeout(nextQuestion, 1200);
  }
}

function lockOptions(){
  document.querySelectorAll('.opt').forEach(b=> b.disabled = true);
}

function showFeedback(ok, text){
  const el = document.getElementById('feedback');
  el.className = 'feedback ' + (ok ? 'ok' : 'bad');
  el.textContent = text;
}

// Confetti animation (tiny, no dependency)
function celebrate(){
  const cvs = document.getElementById('confetti');
  const ctx = cvs.getContext('2d');
  const W = cvs.width = window.innerWidth; const H = cvs.height = window.innerHeight;
  const pieces = Array.from({length: 80}, ()=>({
    x: Math.random()*W,
    y: -20 - Math.random()*H*0.2,
    s: 4 + Math.random()*6,
    vy: 2 + Math.random()*3,
    vx: -1 + Math.random()*2,
    rot: Math.random()*Math.PI,
    vr: -0.2 + Math.random()*0.4,
  }));
  let alive = true;
  const t0 = performance.now();
  function step(){
    ctx.clearRect(0,0,W,H);
    for(const p of pieces){
      p.x += p.vx; p.y += p.vy; p.rot += p.vr;
      ctx.save();
      ctx.translate(p.x, p.y); ctx.rotate(p.rot);
      ctx.fillStyle = ['#ff69b4','#ffd166','#06d6a0','#118ab2','#ef476f'][p.s % 5];
      ctx.fillRect(-p.s/2, -p.s/2, p.s, p.s*0.6);
      ctx.restore();
    }
    if(performance.now() - t0 < 1100){ requestAnimationFrame(step); }
    else { ctx.clearRect(0,0,W,H); alive = false; }
  }
  step();
  // auto-clean (safety)
  setTimeout(()=>{ if(alive){ ctx.clearRect(0,0,W,H); } }, 1400);
}

// Create a new round
function nextQuestion(){
  state.questionIndex++;
  if(state.questionIndex % 5 === 0){ spawnCritters(); }
  // Pick next due card; if deck empty (shouldn't happen), re-init
  const card = pickNextCard();
  state.current = card; state.lastTargetG = card.g;
  renderQuestion();
}

// ---------------------- UI bindings -------------------------
const startBtn = document.getElementById('startBtn');
const replayBtn = document.getElementById('replayBtn');
const muteBtn = document.getElementById('muteBtn');

startBtn.addEventListener('click', ()=>{
  bgm.muted = state.muted;
  bgm.play().catch(()=>{});
  // Ensure voices are allowed on iOS by starting after a user gesture
  initDeck();
  nextQuestion();
}, { passive: true });

replayBtn.addEventListener('click', ()=>{
  if(state.current) speak(state.current.g);
}, { passive: true });

muteBtn.addEventListener('click', ()=>{
  state.muted = !state.muted;
  muteBtn.textContent = state.muted ? '🔇 Son off' : '🔈 Muet';
  if(state.muted && 'speechSynthesis' in window) window.speechSynthesis.cancel();
  bgm.muted = state.muted;
}, { passive: true });

document.querySelectorAll('input[name="timer"]').forEach(r=>{
  r.addEventListener('change', ()=>{
    const v = parseInt(r.value, 10);
    if(r.checked){ state.timerTotal = v * 1000; }
  }, { passive: true });
});

document.getElementById('showSoundToggle').addEventListener('change', (e)=>{
  state.showingSoundOnScreen = !!e.currentTarget.checked;
  // If a question is on-screen, update prompt text immediately
  if(state.current){
    const prompt = document.getElementById('promptText');
    prompt.textContent = state.showingSoundOnScreen ? `Quel est le son “${state.current.g}” ?` : 'Écoute et choisis le bon son…';
  }
}, { passive: true });

// Accessibility: replay sound with keyboard "R"
window.addEventListener('keydown', (e)=>{
  if(e.key.toLowerCase() === 'r'){ if(state.current) speak(state.current.g); }
});

// On resize, update confetti canvas size if it exists
window.addEventListener('resize', ()=>{
  const cvs = document.getElementById('confetti');
  if(cvs){ cvs.width = window.innerWidth; cvs.height = window.innerHeight; }
});

// Gentle reminder if Web Speech API missing
if(!('speechSynthesis' in window)){
  const fb = document.getElementById('feedback');
  fb.className = 'feedback bad';
  fb.textContent = '⚠️ La synthèse vocale n\'est pas disponible sur ce navigateur. Le jeu reste jouable, mais sans voix.';
}

