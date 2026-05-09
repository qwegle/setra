// ═══════════════════════════════════════════════════════
//  SERPENTINE — Enterprise Snake  |  script.js
// ═══════════════════════════════════════════════════════

"use strict";

// ─── Constants ───────────────────────────────────────
const GRID       = 20;          // cells per row/col
const CELL       = 24;          // px per cell (canvas 480 / 20)
const CANVAS_PX  = GRID * CELL; // 480

const DIFF = {
  easy:   { ms: 200, bonus: 1   },
  normal: { ms: 130, bonus: 1.5 },
  hard:   { ms: 80,  bonus: 2   },
  insane: { ms: 50,  bonus: 3   },
};

const THEMES = {
  neon: { head:'#00ff99', body:'#00cc77', tail:'#006644', glow:'rgba(0,255,153,', eye:'#06060f', food:'#ff3366', bonus:'#ffcc00', shield:'#00ccff' },
  fire: { head:'#ff6600', body:'#cc3300', tail:'#660000', glow:'rgba(255,102,0,', eye:'#fff',    food:'#ffee00', bonus:'#ff00ff', shield:'#00aaff' },
  ice:  { head:'#aaddff', body:'#5599cc', tail:'#223366', glow:'rgba(100,200,255,', eye:'#06060f',food:'#ff6699', bonus:'#ffcc00', shield:'#00ff99' },
  gold: { head:'#ffd700', body:'#cc9900', tail:'#664400', glow:'rgba(255,215,0,', eye:'#06060f', food:'#ff3366', bonus:'#00ff99', shield:'#00ccff' },
};

const FOOD_TYPES = ['normal','normal','normal','bonus','shield'];

// ─── State ───────────────────────────────────────────
let state = {
  screen: 'menu',
  difficulty: 'normal',
  theme: 'neon',
  score: 0, best: 0, level: 1, combo: 0,
  snake: [], dir: {x:1,y:0}, nextDir: {x:1,y:0},
  food: null, foodType: 'normal',
  particles: [],
  shieldActive: false, shieldTimer: 0,
  gameLoop: null,
  gamesPlayed: 0,
  leaderboard: [],
};

// ─── Persistence ─────────────────────────────────────
function loadSave() {
  try {
    const s = JSON.parse(localStorage.getItem('serpentine_v2') || '{}');
    state.best        = s.best || 0;
    state.gamesPlayed = s.games || 0;
    state.leaderboard = s.lb || [];
  } catch {}
}
function save() {
  try {
    localStorage.setItem('serpentine_v2', JSON.stringify({
      best: state.best, games: state.gamesPlayed, lb: state.leaderboard.slice(0,10),
    }));
  } catch {}
}

// ─── DOM refs ────────────────────────────────────────
const $ = id => document.getElementById(id);
const gc  = $('game-canvas');
const bgc = $('bg-canvas');
const ctx = gc.getContext('2d');
const bgx = bgc.getContext('2d');

// ─── Audio (Web Audio API) ───────────────────────────
const AC = new (window.AudioContext || window.webkitAudioContext)();
function beep(freq, dur, type='square', vol=0.08) {
  try {
    const o = AC.createOscillator(), g = AC.createGain();
    o.connect(g); g.connect(AC.destination);
    o.type = type; o.frequency.value = freq;
    g.gain.setValueAtTime(vol, AC.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, AC.currentTime + dur);
    o.start(); o.stop(AC.currentTime + dur);
  } catch {}
}
function sfxEat()       { beep(660, .08, 'sine', .1); }
function sfxBonus()     { beep(880, .05,'sine',.1); setTimeout(()=>beep(1100,.08,'sine',.1),60); }
function sfxDie()       { beep(120, .4, 'sawtooth', .12); }
function sfxCountdown() { beep(440, .1, 'square', .06); }
function sfxGo()        { beep(880, .05,'sine',.1); setTimeout(()=>beep(1100,.12,'sine',.12),80); }
function sfxShield()    { beep(330,.08,'triangle',.08); setTimeout(()=>beep(500,.12,'sine',.1),60); }
function resumeAudio()  { if (AC.state === 'suspended') AC.resume(); }

// ─── Background animation ────────────────────────────
const bgParticles = Array.from({length: 60}, () => ({
  x: Math.random() * innerWidth, y: Math.random() * innerHeight,
  vx: (Math.random()-.5)*.3, vy: (Math.random()-.5)*.3,
  r: Math.random()*1.5+.5, a: Math.random(),
}));
function animateBg() {
  bgc.width = innerWidth; bgc.height = innerHeight;
  bgx.clearRect(0,0,innerWidth,innerHeight);
  const t = THEMES[state.theme];
  bgParticles.forEach(p => {
    p.x += p.vx; p.y += p.vy;
    if (p.x < 0) p.x = innerWidth; if (p.x > innerWidth) p.x = 0;
    if (p.y < 0) p.y = innerHeight; if (p.y > innerHeight) p.y = 0;
    bgx.beginPath(); bgx.arc(p.x,p.y,p.r,0,Math.PI*2);
    bgx.fillStyle = t.head + '60';
    bgx.fill();
  });
  requestAnimationFrame(animateBg);
}
animateBg();

// ─── Logo canvas ─────────────────────────────────────
function drawLogo() {
  const lc = $('logo-canvas'), lx = lc.getContext('2d');
  const w = 320, h = 120;
  lx.clearRect(0,0,w,h);
  const t = THEMES[state.theme];
  const g = lx.createLinearGradient(0,0,w,0);
  g.addColorStop(0, t.head); g.addColorStop(1, t.glow.replace('rgba(','#').slice(0,7) + 'ff');
  lx.font = 'bold 56px "Segoe UI",system-ui,sans-serif';
  lx.textAlign = 'center'; lx.textBaseline = 'middle';
  lx.shadowColor = t.head; lx.shadowBlur = 24;
  lx.fillStyle = g; lx.fillText('SERPENTINE', w/2, h/2);
}

// ─── Grid texture (drawn once per game start) ────────
let gridPattern = null;
function buildGridPattern() {
  const oc = document.createElement('canvas');
  oc.width = CELL; oc.height = CELL;
  const ox = oc.getContext('2d');
  ox.fillStyle = '#0a0a18'; ox.fillRect(0,0,CELL,CELL);
  ox.strokeStyle = 'rgba(255,255,255,.03)';
  ox.strokeRect(0,0,CELL,CELL);
  gridPattern = ctx.createPattern(oc,'repeat');
}

// ─── Particle system ─────────────────────────────────
function spawnParticles(cx, cy, color, count=12) {
  for (let i=0; i<count; i++) {
    const angle = (Math.PI*2/count)*i + Math.random()*.4;
    const speed = 2 + Math.random()*3;
    state.particles.push({
      x: cx, y: cy, vx: Math.cos(angle)*speed, vy: Math.sin(angle)*speed,
      r: 2+Math.random()*3, life:1, color,
    });
  }
}
function updateParticles() {
  state.particles = state.particles.filter(p => {
    p.x += p.vx; p.y += p.vy;
    p.vx *= .92; p.vy *= .92;
    p.life -= .04;
    return p.life > 0;
  });
}
function drawParticles() {
  state.particles.forEach(p => {
    ctx.save();
    ctx.globalAlpha = p.life;
    ctx.beginPath(); ctx.arc(p.x,p.y,p.r,0,Math.PI*2);
    ctx.fillStyle = p.color; ctx.fill();
    ctx.restore();
  });
}

// ─── Snake drawing ───────────────────────────────────
function drawSnake() {
  const t = THEMES[state.theme];
  const len = state.snake.length;
  state.snake.forEach((seg, i) => {
    const ratio = i / len; // 0=head, 1=tail
    const px = seg.x * CELL, py = seg.y * CELL;
    const pad = 1;
    const size = CELL - pad*2;

    // color gradient head→tail
    const r = (color1, color2, r) => {
      const h = parseInt(color1.slice(1,3),16), t = parseInt(color2.slice(1,3),16);
      return h + (t-h)*r | 0;
    };
    // Use simple interpolation neon→body→tail
    let fillColor;
    if (i === 0) {
      fillColor = t.head;
    } else {
      fillColor = ratio < 0.5 ? t.body : t.tail;
    }

    // Shield shimmer
    if (state.shieldActive && i === 0) {
      ctx.save();
      ctx.shadowColor = '#00ccff'; ctx.shadowBlur = 18;
    }

    // Rounded rect for each segment
    const radius = i === 0 ? 8 : 5;
    ctx.beginPath();
    ctx.roundRect(px+pad, py+pad, size, size, radius);
    const sg = ctx.createLinearGradient(px,py,px+CELL,py+CELL);
    sg.addColorStop(0, fillColor);
    sg.addColorStop(1, shadeColor(fillColor, -30));
    ctx.fillStyle = sg;

    // glow on head
    if (i === 0) {
      ctx.shadowColor = t.head; ctx.shadowBlur = 14;
    } else {
      ctx.shadowBlur = 0;
    }
    ctx.fill();

    if (state.shieldActive && i === 0) ctx.restore();

    // scale pattern on body (every other)
    if (i > 0 && i % 2 === 0) {
      ctx.save();
      ctx.globalAlpha = 0.12;
      ctx.beginPath(); ctx.arc(px+CELL/2, py+CELL/2, CELL*0.28, 0, Math.PI*2);
      ctx.fillStyle = '#fff'; ctx.fill();
      ctx.restore();
    }

    // Eyes on head
    if (i === 0) {
      const d = state.dir;
      const ex = d.x===0 ? [px+CELL*.3, px+CELL*.7] : d.x>0 ? [px+CELL*.7] : [px+CELL*.3];
      const ey = d.y===0 ? [py+CELL*.3, py+CELL*.7] : d.y>0 ? [py+CELL*.7] : [py+CELL*.3];
      const eyes = d.x!==0 ? [{x:px+CELL*(d.x>0?.72:.28), y:py+CELL*.35},{x:px+CELL*(d.x>0?.72:.28),y:py+CELL*.65}]
                             : [{x:px+CELL*.35, y:py+CELL*(d.y>0?.72:.28)},{x:px+CELL*.65,y:py+CELL*(d.y>0?.72:.28)}];
      eyes.forEach(e => {
        ctx.beginPath(); ctx.arc(e.x, e.y, 3.5, 0, Math.PI*2);
        ctx.fillStyle = t.eye; ctx.shadowBlur=0; ctx.fill();
        ctx.beginPath(); ctx.arc(e.x+.8, e.y-.8, 1.2, 0, Math.PI*2);
        ctx.fillStyle = '#fff4'; ctx.fill();
      });
    }
  });
}

function shadeColor(hex, pct) {
  const n = parseInt(hex.replace('#',''),16);
  const r = Math.min(255,Math.max(0,((n>>16)&255)+pct));
  const g = Math.min(255,Math.max(0,((n>>8)&255)+pct));
  const b = Math.min(255,Math.max(0,(n&255)+pct));
  return `#${r.toString(16).padStart(2,'0')}${g.toString(16).padStart(2,'0')}${b.toString(16).padStart(2,'0')}`;
}

// ─── Food drawing ─────────────────────────────────────
function drawFood() {
  if (!state.food) return;
  const t = THEMES[state.theme];
  const px = state.food.x*CELL + CELL/2;
  const py = state.food.y*CELL + CELL/2;
  const pulse = Math.sin(Date.now()*.006)*2;
  const r = CELL/2 - 3 + pulse;
  const type = state.foodType;

  ctx.save();

  if (type === 'bonus') {
    // Star shape for bonus
    ctx.shadowColor = t.bonus; ctx.shadowBlur = 20;
    ctx.fillStyle = t.bonus;
    drawStar(ctx, px, py, 5, r, r*.45);
    // inner highlight
    ctx.shadowBlur = 0;
    ctx.globalAlpha = .5;
    ctx.fillStyle = '#fff';
    drawStar(ctx, px-1, py-1, 5, r*.4, r*.2);
  } else if (type === 'shield') {
    ctx.shadowColor = t.shield; ctx.shadowBlur = 20;
    ctx.strokeStyle = t.shield; ctx.lineWidth = 2.5; ctx.fillStyle = t.shield+'44';
    ctx.beginPath(); ctx.arc(px,py,r,0,Math.PI*2); ctx.fill(); ctx.stroke();
    ctx.shadowBlur = 0; ctx.fillStyle = t.shield;
    ctx.font = `bold ${CELL*.55}px sans-serif`; ctx.textAlign='center'; ctx.textBaseline='middle';
    ctx.fillText('🛡', px, py+1);
  } else {
    // Radial gradient fruit
    const fg = ctx.createRadialGradient(px-r*.3,py-r*.3,r*.1,px,py,r);
    fg.addColorStop(0,'#fff'); fg.addColorStop(.3, t.food); fg.addColorStop(1, shadeColor(t.food,-40));
    ctx.shadowColor = t.food; ctx.shadowBlur = 18;
    ctx.fillStyle = fg;
    ctx.beginPath(); ctx.arc(px,py,r,0,Math.PI*2); ctx.fill();
    // shine
    ctx.shadowBlur = 0; ctx.globalAlpha=.5; ctx.fillStyle='#fff';
    ctx.beginPath(); ctx.ellipse(px-r*.25, py-r*.25, r*.22, r*.14, -Math.PI/4, 0, Math.PI*2); ctx.fill();
  }
  ctx.restore();
}

function drawStar(ctx, cx, cy, spikes, outerR, innerR) {
  let rot = (Math.PI/2)*3, step = Math.PI/spikes;
  ctx.beginPath();
  ctx.moveTo(cx, cy - outerR);
  for (let i=0; i<spikes; i++) {
    ctx.lineTo(cx + Math.cos(rot)*outerR, cy + Math.sin(rot)*outerR); rot += step;
    ctx.lineTo(cx + Math.cos(rot)*innerR, cy + Math.sin(rot)*innerR); rot += step;
  }
  ctx.closePath(); ctx.fill();
}

// ─── Level bar ────────────────────────────────────────
function drawLevelBar() {
  const t = THEMES[state.theme];
  const foodPerLevel = 5;
  const progress = (state.score % (foodPerLevel * state.level * 10)) / (foodPerLevel * state.level * 10);
  ctx.save();
  ctx.fillStyle = 'rgba(255,255,255,.04)';
  ctx.fillRect(0, CANVAS_PX-4, CANVAS_PX, 4);
  const gbar = ctx.createLinearGradient(0,0,CANVAS_PX*progress,0);
  gbar.addColorStop(0, t.head); gbar.addColorStop(1, t.glow.replace('rgba(','#').slice(0,7)+'ff');
  ctx.fillStyle = gbar;
  ctx.fillRect(0, CANVAS_PX-4, CANVAS_PX * Math.min(progress,1), 4);
  ctx.restore();
}

// ─── Main render ─────────────────────────────────────
function render() {
  ctx.clearRect(0,0,CANVAS_PX,CANVAS_PX);

  // Grid background
  if (gridPattern) { ctx.fillStyle = gridPattern; ctx.fillRect(0,0,CANVAS_PX,CANVAS_PX); }

  drawFood();
  drawSnake();
  updateParticles();
  drawParticles();
  drawLevelBar();
}

// ─── Game logic ───────────────────────────────────────
function randomCell(avoid=[]) {
  let pos;
  do {
    pos = { x: Math.floor(Math.random()*GRID), y: Math.floor(Math.random()*GRID) };
  } while (avoid.some(a => a.x===pos.x && a.y===pos.y));
  return pos;
}

function spawnFood() {
  state.food = randomCell(state.snake);
  const typeRoll = FOOD_TYPES[Math.floor(Math.random()*FOOD_TYPES.length)];
  state.foodType = typeRoll;
}

function initGame() {
  const mid = Math.floor(GRID/2);
  state.snake = [
    {x:mid,   y:mid},
    {x:mid-1, y:mid},
    {x:mid-2, y:mid},
  ];
  state.dir     = {x:1, y:0};
  state.nextDir = {x:1, y:0};
  state.score   = 0;
  state.level   = 1;
  state.combo   = 0;
  state.particles = [];
  state.shieldActive = false;
  state.shieldTimer  = 0;
  spawnFood();
  buildGridPattern();
  updateHUD();
}

function tick() {
  state.dir = state.nextDir;

  // Shield countdown
  if (state.shieldActive) {
    state.shieldTimer--;
    if (state.shieldTimer <= 0) state.shieldActive = false;
  }

  const head = state.snake[0];
  const nx = (head.x + state.dir.x + GRID) % GRID;
  const ny = (head.y + state.dir.y + GRID) % GRID;
  const newHead = {x:nx, y:ny};

  // Collision with self
  const hitSelf = state.snake.some(s => s.x===nx && s.y===ny);
  if (hitSelf) {
    if (state.shieldActive) {
      state.shieldActive = false;
      sfxShield();
      // Remove the segment collided with
      const idx = state.snake.findIndex(s => s.x===nx && s.y===ny);
      if (idx > 0) state.snake.splice(idx, 1);
      state.snake.unshift(newHead);
      render(); return;
    }
    endGame(); return;
  }

  // Eat food
  const ate = state.food && nx===state.food.x && ny===state.food.y;
  state.snake.unshift(newHead);
  if (!ate) state.snake.pop();

  if (ate) {
    const t = THEMES[state.theme];
    state.combo++;
    const basePoints = state.foodType==='bonus' ? 50 : 10;
    const comboMult  = state.foodType==='bonus' ? DIFF[state.difficulty].bonus * 2 : DIFF[state.difficulty].bonus;
    const earned = Math.round(basePoints * comboMult * Math.min(state.combo, 5));
    state.score += earned;
    if (state.score > state.best) state.best = state.score;

    // level up every 100 pts
    state.level = Math.max(1, Math.floor(state.score / 100) + 1);

    const foodColor = state.foodType==='bonus' ? t.bonus : state.foodType==='shield' ? t.shield : t.food;
    spawnParticles(nx*CELL+CELL/2, ny*CELL+CELL/2, foodColor, 14);

    if (state.foodType === 'shield') {
      state.shieldActive = true;
      state.shieldTimer  = 40;
      sfxShield();
    } else if (state.foodType === 'bonus') {
      sfxBonus();
    } else {
      sfxEat();
    }

    if (state.combo > 1) showCombo(`${state.combo}x COMBO! +${earned}`);

    spawnFood();
    updateHUD();

    // Speed up with level
    clearInterval(state.gameLoop);
    const speed = Math.max(40, DIFF[state.difficulty].ms - (state.level-1)*8);
    state.gameLoop = setInterval(gameTick, speed);
  } else {
    state.combo = 0;
  }

  render();
}

function gameTick() { if (state.screen === 'game') tick(); }

function showCombo(msg) {
  const el = $('combo-badge');
  el.textContent = msg; el.classList.remove('hidden');
  // re-trigger animation
  el.style.animation = 'none'; el.offsetHeight;
  el.style.animation = '';
  setTimeout(() => el.classList.add('hidden'), 700);
}

function updateHUD() {
  $('hud-score').textContent  = state.score;
  $('hud-level').textContent  = state.level;
  $('hud-best').textContent   = state.best;
  $('menu-best').textContent  = state.best;
  $('menu-games').textContent = state.gamesPlayed;
}

// ─── Screen management ───────────────────────────────
function showScreen(name) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  $(`screen-${name}`).classList.add('active');
  state.screen = name;
}

// ─── Countdown then play ─────────────────────────────
function startCountdown() {
  showScreen('countdown');
  let n = 3;
  $('countdown-number').textContent = n;
  sfxCountdown();
  const iv = setInterval(() => {
    n--;
    if (n > 0) { $('countdown-number').textContent = n; sfxCountdown(); }
    else {
      clearInterval(iv);
      $('countdown-number').textContent = 'GO!';
      sfxGo();
      setTimeout(startPlay, 400);
    }
  }, 900);
}

function startPlay() {
  state.gamesPlayed++;
  save();
  initGame();
  showScreen('game');
  gc.focus();
  clearInterval(state.gameLoop);
  state.gameLoop = setInterval(gameTick, DIFF[state.difficulty].ms);
  render();
}

function endGame() {
  clearInterval(state.gameLoop);
  sfxDie();
  spawnParticles(state.snake[0].x*CELL+CELL/2, state.snake[0].y*CELL+CELL/2, '#ff3366', 20);
  render(); // show death particles

  // Update leaderboard
  state.leaderboard.push({ score: state.score, diff: state.difficulty, date: new Date().toLocaleDateString() });
  state.leaderboard.sort((a,b) => b.score-a.score);
  state.leaderboard = state.leaderboard.slice(0,10);
  save();

  const isRecord = state.leaderboard[0]?.score === state.score && state.score > 0;

  $('go-score').textContent  = state.score;
  $('go-best').textContent   = state.best;
  $('go-level').textContent  = state.level;
  $('go-length').textContent = state.snake.length;
  $('new-record-badge').classList.toggle('hidden', !isRecord);

  setTimeout(() => showScreen('gameover'), 800);
}

// ─── Input handling ───────────────────────────────────
const DIRS = {
  ArrowUp:    {x:0,y:-1}, w:{x:0,y:-1},
  ArrowDown:  {x:0,y:1},  s:{x:0,y:1},
  ArrowLeft:  {x:-1,y:0}, a:{x:-1,y:0},
  ArrowRight: {x:1,y:0},  d:{x:1,y:0},
};
function tryDir(d) {
  if (!d) return;
  if (d.x !== -state.dir.x || d.y !== -state.dir.y) state.nextDir = d;
}

document.addEventListener('keydown', e => {
  resumeAudio();
  if (state.screen !== 'game') return;
  if (e.key === 'Escape' || e.key === 'p' || e.key === 'P') { togglePause(); return; }
  const d = DIRS[e.key] || DIRS[e.key.toLowerCase()];
  if (d) { e.preventDefault(); tryDir(d); }
});

// D-pad
['up','down','left','right'].forEach(dir => {
  $(`dpad-${dir}`).addEventListener('pointerdown', e => {
    e.preventDefault(); resumeAudio();
    const map = {up:{x:0,y:-1}, down:{x:0,y:1}, left:{x:-1,y:0}, right:{x:1,y:0}};
    tryDir(map[dir]);
  });
});

// Touch swipe
let touchStart = null;
gc.addEventListener('touchstart', e => { touchStart = e.touches[0]; resumeAudio(); }, {passive:true});
gc.addEventListener('touchend', e => {
  if (!touchStart) return;
  const dx = e.changedTouches[0].clientX - touchStart.clientX;
  const dy = e.changedTouches[0].clientY - touchStart.clientY;
  const ax=Math.abs(dx), ay=Math.abs(dy);
  if (Math.max(ax,ay) < 20) return;
  if (ax > ay) tryDir(dx>0 ? {x:1,y:0} : {x:-1,y:0});
  else          tryDir(dy>0 ? {x:0,y:1} : {x:0,y:-1});
  touchStart = null;
}, {passive:true});

function togglePause() {
  if (state.screen !== 'game') return;
  const po = $('pause-overlay');
  const paused = !po.classList.contains('hidden');
  if (paused) {
    po.classList.add('hidden');
    state.gameLoop = setInterval(gameTick, DIFF[state.difficulty].ms);
  } else {
    clearInterval(state.gameLoop);
    po.classList.remove('hidden');
  }
}

// ─── Leaderboard ─────────────────────────────────────
function renderLeaderboard() {
  const ul = $('lb-list'); ul.innerHTML = '';
  if (state.leaderboard.length === 0) {
    ul.innerHTML = '<li style="justify-content:center;color:#7878a0">No scores yet. Play a game!</li>';
    return;
  }
  state.leaderboard.forEach((e,i) => {
    const li = document.createElement('li');
    li.innerHTML = `<span class="rank">${i+1}</span>
      <span>${e.date||''}</span>
      <span class="lb-diff">${e.diff||''}</span>
      <span class="lb-score">${e.score}</span>`;
    ul.appendChild(li);
  });
}

// ─── Button wiring ────────────────────────────────────
$('btn-play').addEventListener('click', () => { resumeAudio(); startCountdown(); });
$('btn-retry').addEventListener('click', () => { resumeAudio(); startCountdown(); });
$('btn-menu').addEventListener('click',  () => showScreen('menu'));
$('btn-resume').addEventListener('click', () => togglePause());
$('btn-pause').addEventListener('click',  () => togglePause());
$('btn-leaderboard').addEventListener('click', () => { renderLeaderboard(); showScreen('leaderboard'); });
$('btn-lb-back').addEventListener('click', () => showScreen('menu'));

// Difficulty
document.querySelectorAll('.diff-btn').forEach(b => {
  b.addEventListener('click', () => {
    document.querySelectorAll('.diff-btn').forEach(x => { x.classList.remove('active'); x.setAttribute('aria-pressed','false'); });
    b.classList.add('active'); b.setAttribute('aria-pressed','true');
    state.difficulty = b.dataset.diff;
  });
});

// Theme
document.querySelectorAll('.theme-btn').forEach(b => {
  b.addEventListener('click', () => {
    document.querySelectorAll('.theme-btn').forEach(x => x.classList.remove('active'));
    b.classList.add('active');
    state.theme = b.dataset.theme;
    drawLogo();
  });
});

// ─── Boot ─────────────────────────────────────────────
loadSave();
updateHUD();
drawLogo();
showScreen('menu');

// Draw idle snake on menu
(function menuIdle() {
  buildGridPattern();
  let idleSnake = [{x:10,y:10},{x:9,y:10},{x:8,y:10},{x:7,y:10}];
  let idleDir = {x:1,y:0};
  let idleFood = randomCell(idleSnake);
  function idleTick() {
    const h = idleSnake[0];
    const nx=(h.x+idleDir.x+GRID)%GRID, ny=(h.y+idleDir.y+GRID)%GRID;
    if (nx===idleFood.x && ny===idleFood.y) { idleSnake.unshift({x:nx,y:ny}); idleFood=randomCell(idleSnake); }
    else { idleSnake.unshift({x:nx,y:ny}); idleSnake.pop(); }
    // turn randomly at edges
    if (nx>=GRID-2||nx<=1) idleDir={x:idleDir.x,y:idleDir.y===0?1:-idleDir.y};
    if (ny>=GRID-2||ny<=1) idleDir={x:idleDir.x===0?1:-idleDir.x,y:idleDir.y};
    if (Math.random()<.05) {
      const dirs=[{x:1,y:0},{x:-1,y:0},{x:0,y:1},{x:0,y:-1}];
      const d=dirs[Math.floor(Math.random()*4)];
      if(d.x!==-idleDir.x||d.y!==-idleDir.y) idleDir=d;
    }
  }
  function idleRender() {
    if (state.screen!=='menu' && state.screen!=='leaderboard') return;
    ctx.clearRect(0,0,CANVAS_PX,CANVAS_PX);
    if(gridPattern){ctx.fillStyle=gridPattern;ctx.fillRect(0,0,CANVAS_PX,CANVAS_PX);}
    const saved = state.snake; const savedF=state.food; const savedFT=state.foodType; const savedDir=state.dir;
    state.snake=idleSnake; state.food=idleFood; state.foodType='normal'; state.dir=idleDir;
    drawFood(); drawSnake();
    state.snake=saved; state.food=savedF; state.foodType=savedFT; state.dir=savedDir;
    requestAnimationFrame(idleRender);
  }
  setInterval(idleTick, 160);
  idleRender();
})();
