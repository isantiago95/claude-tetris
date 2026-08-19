'use strict';

const COLS = 10;
const ROWS = 20;
const BLOCK = 30;

const COLORS = [
  null,
  '#4dd0e1', // I - cyan
  '#ffd54f', // O - yellow
  '#ba68c8', // T - purple
  '#81c784', // S - green
  '#e57373', // Z - red
  '#90caf9', // J - pale blue
  '#ffb74d', // L - orange
  '#9e9e9e', // N - tuerca (gris metálico)
];

const PIECES = [
  null,
  [[0,0,0,0],[1,1,1,1],[0,0,0,0],[0,0,0,0]], // I
  [[2,2],[2,2]],                               // O
  [[0,3,0],[3,3,3],[0,0,0]],                  // T
  [[0,4,4],[4,4,0],[0,0,0]],                  // S
  [[5,5,0],[0,5,5],[0,0,0]],                  // Z
  [[6,0,0],[6,6,6],[0,0,0]],                  // J
  [[0,0,7],[7,7,7],[0,0,0]],                  // L
  [[8,8,8],[8,0,8],[8,8,8]],                  // N (tuerca)
];

const LINE_SCORES = [0, 100, 300, 500, 800];

const canvas = document.getElementById('board');
const ctx = canvas.getContext('2d');
const nextCanvas = document.getElementById('next-canvas');
const nextCtx = nextCanvas.getContext('2d');
const scoreEl = document.getElementById('score');
const linesEl = document.getElementById('lines');
const levelEl = document.getElementById('level');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayScore = document.getElementById('overlay-score');
const restartBtn = document.getElementById('restart-btn');
const themeSwitch = document.getElementById('theme-switch');
const themeLabel = document.getElementById('theme-label');
const startScreen = document.getElementById('start-screen');
const startBtn = document.getElementById('start-btn');
const startHighscoresEl = document.getElementById('start-highscores');
const startResetBtn = document.getElementById('start-reset-btn');
const overlayHighscoresEl = document.getElementById('overlay-highscores');
const runStatsEl = document.getElementById('run-stats');
const nameEntryEl = document.getElementById('name-entry');
const nameInputEl = document.getElementById('name-input');
const saveScoreBtn = document.getElementById('save-score-btn');
const resetScoresBtn = document.getElementById('reset-scores-btn');

const HIGHSCORES_KEY = 'tetris-highscores';
const MAX_HIGHSCORES = 5;

let board, current, next, score, lines, level, paused, gameOver, lastTime, dropAccum, dropInterval, animId;
let comboStreak, runBestCombo, runBestTetris, pendingHighScoreEntry;
let gameStarted = false;

function gridColor() {
  return getComputedStyle(document.body).getPropertyValue('--grid-color').trim();
}

function applyTheme(theme) {
  if (theme === 'light') {
    document.body.setAttribute('data-theme', 'light');
  } else {
    document.body.removeAttribute('data-theme');
  }
  themeSwitch.checked = theme === 'light';
  themeLabel.textContent = theme === 'light' ? 'LIGHT' : 'DARK';
  if (typeof draw === 'function' && board) draw();
}

function initTheme() {
  const saved = localStorage.getItem('tetris-theme');
  applyTheme(saved === 'light' ? 'light' : 'dark');
}

themeSwitch.addEventListener('change', () => {
  const theme = themeSwitch.checked ? 'light' : 'dark';
  localStorage.setItem('tetris-theme', theme);
  applyTheme(theme);
});

function createBoard() {
  return Array.from({ length: ROWS }, () => new Array(COLS).fill(0));
}

function randomPiece() {
  const type = Math.floor(Math.random() * 8) + 1;
  const shape = PIECES[type].map(row => [...row]);
  return { type, shape, x: Math.floor(COLS / 2) - Math.floor(shape[0].length / 2), y: 0 };
}

function collide(shape, ox, oy) {
  for (let r = 0; r < shape.length; r++) {
    for (let c = 0; c < shape[r].length; c++) {
      if (!shape[r][c]) continue;
      const nx = ox + c;
      const ny = oy + r;
      if (nx < 0 || nx >= COLS || ny >= ROWS) return true;
      if (ny >= 0 && board[ny][nx]) return true;
    }
  }
  return false;
}

function rotateCW(shape) {
  const rows = shape.length, cols = shape[0].length;
  const result = Array.from({ length: cols }, () => new Array(rows).fill(0));
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++)
      result[c][rows - 1 - r] = shape[r][c];
  return result;
}

function tryRotate() {
  const rotated = rotateCW(current.shape);
  const kicks = [0, -1, 1, -2, 2];
  for (const kick of kicks) {
    if (!collide(rotated, current.x + kick, current.y)) {
      current.shape = rotated;
      current.x += kick;
      return;
    }
  }
}

function merge() {
  for (let r = 0; r < current.shape.length; r++)
    for (let c = 0; c < current.shape[r].length; c++)
      if (current.shape[r][c])
        board[current.y + r][current.x + c] = current.shape[r][c];
}

function clearLines() {
  let cleared = 0;
  for (let r = ROWS - 1; r >= 0; r--) {
    if (board[r].every(v => v !== 0)) {
      board.splice(r, 1);
      board.unshift(new Array(COLS).fill(0));
      cleared++;
      r++;
    }
  }
  if (cleared) {
    comboStreak++;
    runBestCombo = Math.max(runBestCombo, comboStreak);
    runBestTetris = Math.max(runBestTetris, cleared);
    lines += cleared;
    score += (LINE_SCORES[cleared] || 0) * level;
    level = Math.floor(lines / 10) + 1;
    dropInterval = Math.max(100, 1000 - (level - 1) * 90);
    updateHUD();
  } else {
    comboStreak = 0;
  }
}

function ghostY() {
  let gy = current.y;
  while (!collide(current.shape, current.x, gy + 1)) gy++;
  return gy;
}

function hardDrop() {
  const gy = ghostY();
  score += (gy - current.y) * 2;
  current.y = gy;
  lockPiece();
}

function softDrop() {
  if (!collide(current.shape, current.x, current.y + 1)) {
    current.y++;
    score += 1;
    updateHUD();
  } else {
    lockPiece();
  }
}

function lockPiece() {
  merge();
  clearLines();
  spawn();
}

function spawn() {
  current = next;
  next = randomPiece();
  if (collide(current.shape, current.x, current.y)) {
    endGame();
  }
  drawNext();
}

function updateHUD() {
  scoreEl.textContent = score.toLocaleString();
  linesEl.textContent = lines;
  levelEl.textContent = level;
}

function drawBlock(context, x, y, colorIndex, size, alpha) {
  if (!colorIndex) return;
  const color = COLORS[colorIndex];
  context.globalAlpha = alpha ?? 1;
  context.fillStyle = color;
  context.fillRect(x * size + 1, y * size + 1, size - 2, size - 2);
  // highlight
  context.fillStyle = 'rgba(255,255,255,0.12)';
  context.fillRect(x * size + 1, y * size + 1, size - 2, 4);
  context.globalAlpha = 1;
}

function drawGrid() {
  ctx.strokeStyle = gridColor();
  ctx.lineWidth = 0.5;
  for (let c = 1; c < COLS; c++) {
    ctx.beginPath();
    ctx.moveTo(c * BLOCK, 0);
    ctx.lineTo(c * BLOCK, ROWS * BLOCK);
    ctx.stroke();
  }
  for (let r = 1; r < ROWS; r++) {
    ctx.beginPath();
    ctx.moveTo(0, r * BLOCK);
    ctx.lineTo(COLS * BLOCK, r * BLOCK);
    ctx.stroke();
  }
}

function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawGrid();

  // board
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++)
      drawBlock(ctx, c, r, board[r][c], BLOCK);

  // ghost
  const gy = ghostY();
  for (let r = 0; r < current.shape.length; r++)
    for (let c = 0; c < current.shape[r].length; c++)
      if (current.shape[r][c])
        drawBlock(ctx, current.x + c, gy + r, current.shape[r][c], BLOCK, 0.2);

  // current piece
  for (let r = 0; r < current.shape.length; r++)
    for (let c = 0; c < current.shape[r].length; c++)
      drawBlock(ctx, current.x + c, current.y + r, current.shape[r][c], BLOCK);
}

function drawNext() {
  const NB = 30;
  nextCtx.clearRect(0, 0, nextCanvas.width, nextCanvas.height);
  const shape = next.shape;
  const offX = Math.floor((4 - shape[0].length) / 2);
  const offY = Math.floor((4 - shape.length) / 2);
  for (let r = 0; r < shape.length; r++)
    for (let c = 0; c < shape[r].length; c++)
      drawBlock(nextCtx, offX + c, offY + r, shape[r][c], NB);
}

// ---- High scores (localStorage adapter) ----

function loadHighScoreData() {
  try {
    const raw = localStorage.getItem(HIGHSCORES_KEY);
    if (!raw) return { scores: [], bestCombo: 0, bestTetris: 0 };
    const parsed = JSON.parse(raw);
    return {
      scores: Array.isArray(parsed.scores) ? parsed.scores : [],
      bestCombo: Number(parsed.bestCombo) || 0,
      bestTetris: Number(parsed.bestTetris) || 0,
    };
  } catch (e) {
    return { scores: [], bestCombo: 0, bestTetris: 0 };
  }
}

function saveHighScoreData(data) {
  try {
    localStorage.setItem(HIGHSCORES_KEY, JSON.stringify(data));
  } catch (e) {
    // Safari private mode / quota errors — silently ignore, game keeps working.
  }
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function qualifiesForHighScore(candidateScore) {
  const data = loadHighScoreData();
  if (data.scores.length < MAX_HIGHSCORES) return true;
  const lowest = data.scores[data.scores.length - 1];
  return candidateScore > (lowest ? lowest.score : 0);
}

function renderHighScoreTable(container, highlightEntry) {
  const data = loadHighScoreData();
  if (!data.scores.length) {
    container.innerHTML = '<p class="hs-empty">Sin récords aún</p>' +
      `<p class="hs-alltime">Mejor combo: ${data.bestCombo} · Máx. líneas: ${data.bestTetris}</p>`;
    return;
  }
  const rows = data.scores.map((entry, i) => {
    const isHighlight = highlightEntry &&
      entry.name === highlightEntry.name &&
      entry.score === highlightEntry.score &&
      entry.date === highlightEntry.date;
    return `<tr class="${isHighlight ? 'hs-highlight' : ''}">` +
      `<td>${i + 1}</td><td>${escapeHtml(entry.name)}</td><td>${entry.score.toLocaleString()}</td>` +
      `<td>${entry.lines}</td><td>${entry.level}</td></tr>`;
  }).join('');
  container.innerHTML = `
    <table>
      <thead><tr><th>#</th><th>Nombre</th><th>Puntos</th><th>Líneas</th><th>Nivel</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <p class="hs-alltime">Mejor combo: ${data.bestCombo} · Máx. líneas: ${data.bestTetris}</p>`;
}

function saveHighScoreEntry(rawName) {
  if (!pendingHighScoreEntry) return;
  const data = loadHighScoreData();
  const name = (rawName || '').trim().slice(0, 10).toUpperCase() || 'AAA';
  const entry = {
    name,
    score: pendingHighScoreEntry.score,
    lines: pendingHighScoreEntry.lines,
    level: pendingHighScoreEntry.level,
    combo: pendingHighScoreEntry.combo,
    date: new Date().toISOString(),
  };
  data.scores.push(entry);
  data.scores.sort((a, b) => b.score - a.score);
  data.scores = data.scores.slice(0, MAX_HIGHSCORES);
  data.bestCombo = Math.max(data.bestCombo, pendingHighScoreEntry.combo);
  data.bestTetris = Math.max(data.bestTetris, pendingHighScoreEntry.tetris);
  saveHighScoreData(data);
  pendingHighScoreEntry = null;
  nameEntryEl.classList.add('hidden');
  renderHighScoreTable(overlayHighscoresEl, entry);
}

function resetHighScores() {
  saveHighScoreData({ scores: [], bestCombo: 0, bestTetris: 0 });
  renderHighScoreTable(overlayHighscoresEl, null);
  renderHighScoreTable(startHighscoresEl, null);
}

// Strategy: arm-then-confirm reset, returns a disarm() to reset the button's label externally.
function wireResetButton(btn) {
  let pending = false;
  function disarm() {
    pending = false;
    btn.textContent = 'Resetear records';
  }
  btn.addEventListener('click', () => {
    if (!pending) {
      pending = true;
      btn.textContent = '¿Seguro? Confirmar';
      return;
    }
    resetHighScores();
    disarm();
  });
  return disarm;
}

const disarmOverlayReset = wireResetButton(resetScoresBtn);
wireResetButton(startResetBtn);

function endGame() {
  gameOver = true;
  cancelAnimationFrame(animId);
  overlayTitle.textContent = 'GAME OVER';
  overlayScore.textContent = `Puntuación: ${score.toLocaleString()}`;
  runStatsEl.textContent = `Combo: ${runBestCombo} · Líneas simultáneas: ${runBestTetris}`;
  disarmOverlayReset();

  const data = loadHighScoreData();
  data.bestCombo = Math.max(data.bestCombo, runBestCombo);
  data.bestTetris = Math.max(data.bestTetris, runBestTetris);
  saveHighScoreData(data);

  if (qualifiesForHighScore(score)) {
    pendingHighScoreEntry = { score, lines, level, combo: runBestCombo, tetris: runBestTetris };
    nameEntryEl.classList.remove('hidden');
    nameInputEl.value = 'AAA';
    renderHighScoreTable(overlayHighscoresEl, null);
    overlay.classList.remove('hidden');
    nameInputEl.focus();
    nameInputEl.select();
  } else {
    pendingHighScoreEntry = null;
    nameEntryEl.classList.add('hidden');
    renderHighScoreTable(overlayHighscoresEl, null);
    overlay.classList.remove('hidden');
  }
}

function togglePause() {
  if (!gameStarted || gameOver) return;
  paused = !paused;
  if (!paused) {
    lastTime = performance.now();
    loop(lastTime);
  } else {
    cancelAnimationFrame(animId);
    overlayTitle.textContent = 'PAUSA';
    overlayScore.textContent = '';
    overlay.classList.remove('hidden');
  }
}

function loop(ts) {
  const dt = ts - lastTime;
  lastTime = ts;
  dropAccum += dt;
  if (dropAccum >= dropInterval) {
    dropAccum = 0;
    if (!collide(current.shape, current.x, current.y + 1)) {
      current.y++;
    } else {
      lockPiece();
    }
  }
  if (gameOver) return;
  draw();
  animId = requestAnimationFrame(loop);
}

function init() {
  gameStarted = true;
  board = createBoard();
  score = 0;
  lines = 0;
  level = 1;
  paused = false;
  gameOver = false;
  dropInterval = 1000;
  dropAccum = 0;
  comboStreak = 0;
  runBestCombo = 0;
  runBestTetris = 0;
  pendingHighScoreEntry = null;
  lastTime = performance.now();
  next = randomPiece();
  spawn();
  updateHUD();
  overlay.classList.add('hidden');
  cancelAnimationFrame(animId);
  animId = requestAnimationFrame(loop);
}

document.addEventListener('keydown', e => {
  if (!gameStarted) return;
  if (e.code === 'KeyP') { togglePause(); return; }
  if (paused || gameOver) return;
  switch (e.code) {
    case 'ArrowLeft':
      if (!collide(current.shape, current.x - 1, current.y)) current.x--;
      break;
    case 'ArrowRight':
      if (!collide(current.shape, current.x + 1, current.y)) current.x++;
      break;
    case 'ArrowDown':
      softDrop();
      break;
    case 'ArrowUp':
    case 'KeyX':
      tryRotate();
      break;
    case 'Space':
      e.preventDefault();
      hardDrop();
      break;
  }
  updateHUD();
});

restartBtn.addEventListener('click', init);

saveScoreBtn.addEventListener('click', () => saveHighScoreEntry(nameInputEl.value));
nameInputEl.addEventListener('keydown', e => {
  if (e.code === 'Enter' || e.key === 'Enter') {
    e.preventDefault();
    saveHighScoreEntry(nameInputEl.value);
  }
});

startBtn.addEventListener('click', () => {
  startScreen.classList.add('hidden');
  init();
});

initTheme();
renderHighScoreTable(startHighscoresEl, null);
