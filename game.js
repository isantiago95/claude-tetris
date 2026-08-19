'use strict';

const COLS = 10;
const ROWS = 20;
const BLOCK = 30;

// ---- Skins ----------------------------------------------------------
// Config-driven skin table: each entry supplies an 8-color piece palette
// (indices 1-8, matching PIECES) and the name of a cell-drawing strategy
// from DRAW_STRATEGIES. Adding a new skin is a data change here, not new
// branching logic in drawBlock().
const SKINS = {
  retro: {
    label: 'Retro',
    draw: 'flat',
    palette: [
      null,
      '#4dd0e1', // I - cyan
      '#ffd54f', // O - yellow
      '#ba68c8', // T - purple
      '#81c784', // S - green
      '#e57373', // Z - red
      '#90caf9', // J - pale blue
      '#ffb74d', // L - orange
      '#9e9e9e', // N - tuerca (gris metálico)
    ],
  },
  neon: {
    label: 'Neon',
    draw: 'glow',
    palette: [
      null,
      '#00e5ff', // I
      '#ffee00', // O
      '#e040fb', // T
      '#00ff85', // S
      '#ff1744', // Z
      '#2979ff', // J
      '#ff9100', // L
      '#b0bec5', // N
    ],
  },
  pastel: {
    label: 'Pastel',
    draw: 'rounded',
    palette: [
      null,
      '#a7d8de', // I
      '#fff2b2', // O
      '#d8b4e2', // T
      '#b8e2c8', // S
      '#f4b8b8', // Z
      '#b8d4f4', // J
      '#f8d0a8', // L
      '#d8d8d8', // N
    ],
  },
  pixel: {
    label: 'Pixel Art',
    draw: 'pixel',
    palette: [
      null,
      '#00bcd4', // I
      '#ffeb3b', // O
      '#9c27b0', // T
      '#4caf50', // S
      '#f44336', // Z
      '#2196f3', // J
      '#ff9800', // L
      '#757575', // N
    ],
  },
};

// Cell-drawing strategies (strategy pattern). Each receives the context and
// the block's top-left pixel coordinates + size, and is responsible for
// fully restoring any canvas state it changes (shadowBlur, etc).
// Fills the base cell square shared by every strategy before its own
// decoration (glow, rounding, texture) is layered on top.
function fillCell(context, px, py, color, size) {
  context.fillStyle = color;
  context.fillRect(px + 1, py + 1, size - 2, size - 2);
}

const DRAW_STRATEGIES = {
  flat(context, px, py, color, size) {
    fillCell(context, px, py, color, size);
    context.fillStyle = 'rgba(255,255,255,0.12)';
    context.fillRect(px + 1, py + 1, size - 2, 4);
  },
  glow(context, px, py, color, size) {
    context.save();
    context.shadowColor = color;
    context.shadowBlur = size * 0.4;
    fillCell(context, px, py, color, size);
    context.shadowBlur = 0;
    context.shadowColor = 'transparent';
    context.fillStyle = 'rgba(255,255,255,0.18)';
    context.fillRect(px + 1, py + 1, size - 2, 3);
    context.restore();
  },
  rounded(context, px, py, color, size) {
    context.save();
    const r = Math.min(6, size / 4);
    const hasRoundRect = typeof context.roundRect === 'function';
    context.fillStyle = color;
    if (hasRoundRect) {
      context.beginPath();
      context.roundRect(px + 1, py + 1, size - 2, size - 2, r);
      context.fill();
    } else {
      context.fillRect(px + 1, py + 1, size - 2, size - 2);
    }
    context.fillStyle = 'rgba(255,255,255,0.3)';
    if (hasRoundRect) {
      context.beginPath();
      context.roundRect(px + 2, py + 2, size - 4, (size - 4) / 2, r / 2);
      context.fill();
    } else {
      context.fillRect(px + 2, py + 2, size - 4, 4);
    }
    context.restore();
  },
  pixel(context, px, py, color, size) {
    context.save();
    fillCell(context, px, py, color, size);
    const half = (size - 2) / 2;
    context.fillStyle = 'rgba(0,0,0,0.15)';
    context.fillRect(px + 1, py + 1, half, half);
    context.fillRect(px + 1 + half, py + 1 + half, half, half);
    context.fillStyle = 'rgba(255,255,255,0.15)';
    context.fillRect(px + 1 + half, py + 1, half, half);
    context.fillRect(px + 1, py + 1 + half, half, half);
    context.restore();
  },
};

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
const skinSelect = document.getElementById('skin-select');

let board, current, next, score, lines, level, paused, gameOver, lastTime, dropAccum, dropInterval, animId;
let currentSkin = 'retro';

function gridColor() {
  return getComputedStyle(document.body).getPropertyValue('--grid-color').trim();
}

function applySkin(skin) {
  if (!SKINS[skin]) skin = 'retro';
  currentSkin = skin;
  document.body.setAttribute('data-skin', skin);
  skinSelect.value = skin;
  if (typeof draw === 'function' && board) draw();
  if (typeof drawNext === 'function' && next) drawNext();
}

function initSkin() {
  let saved = null;
  try {
    saved = localStorage.getItem('tetris-skin');
  } catch (e) {
    // localStorage unavailable (e.g. Safari private mode) — fall back to default
  }
  applySkin(SKINS[saved] ? saved : 'retro');
}

skinSelect.addEventListener('change', () => {
  const skin = skinSelect.value;
  try {
    localStorage.setItem('tetris-skin', skin);
  } catch (e) {
    // ignore write failures, skin still applies for this session
  }
  applySkin(skin);
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
    lines += cleared;
    score += (LINE_SCORES[cleared] || 0) * level;
    level = Math.floor(lines / 10) + 1;
    dropInterval = Math.max(100, 1000 - (level - 1) * 90);
    updateHUD();
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
  const skin = SKINS[currentSkin] || SKINS.retro;
  const color = skin.palette[colorIndex];
  const strategy = DRAW_STRATEGIES[skin.draw] || DRAW_STRATEGIES.flat;
  context.globalAlpha = alpha ?? 1;
  strategy(context, x * size, y * size, color, size);
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

function endGame() {
  gameOver = true;
  cancelAnimationFrame(animId);
  overlayTitle.textContent = 'GAME OVER';
  overlayScore.textContent = `Puntuación: ${score.toLocaleString()}`;
  overlay.classList.remove('hidden');
}

function togglePause() {
  if (gameOver) return;
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
  board = createBoard();
  score = 0;
  lines = 0;
  level = 1;
  paused = false;
  gameOver = false;
  dropInterval = 1000;
  dropAccum = 0;
  lastTime = performance.now();
  next = randomPiece();
  spawn();
  updateHUD();
  overlay.classList.add('hidden');
  cancelAnimationFrame(animId);
  animId = requestAnimationFrame(loop);
}

document.addEventListener('keydown', e => {
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

initSkin();
init();
