import React, { useEffect, useRef, useState } from 'react';

// Invisisnake — Turn-based Snake with Fading Tail, Levels, Power-Ups, Hazards, Lives, Retro FX
// Full game with fixes:
// - Fix: no undefined 'blip' usage. Replaced with playPickupSweep() from audio hook.
// - Fix: power-up always moves head into the cell (logic order preserved) and never respawns on the same turn it is picked up.
// - Fix: power-ups do not spawn while a reveal buff is active, including the same tick as pickup.
// - All previous features intact (overlays after 1s, win threshold, level picker, scaled FX, jingles, fruit SFX).

// ===== Constants =====
const OVERLAY_DELAY_MS = 1000;
const POWERUP_MIN_LEVEL = 2;
const POWERUP_CHANCE_PER_TURN = 0.25;
const HAZARD_MIN_LEVEL = 3;
const HAZARD_CHANCE_PER_TURN = 0.12;

const DIRS = {
  UP: { x: 0, y: -1, key: 'ArrowUp' },
  DOWN: { x: 0, y: 1, key: 'ArrowDown' },
  LEFT: { x: -1, y: 0, key: 'ArrowLeft' },
  RIGHT: { x: 1, y: 0, key: 'ArrowRight' }
};

const isOpposite = (a, b) => a.x + b.x === 0 && a.y + b.y === 0;
const posEq = (a, b) => a.x === b.x && a.y === b.y;
const sizeForLevel = (lvl) => Math.max(3, 2 + lvl);
const wrapCoord = (v, max) => (v < 0 ? max - 1 : v >= max ? 0 : v);

function placeFreeCell(excludedSet, cols, rows) {
  const total = cols * rows;
  if (excludedSet.size >= total) return null;
  for (let i = 0; i < 128; i++) {
    const x = Math.floor(Math.random() * cols);
    const y = Math.floor(Math.random() * rows);
    if (!excludedSet.has(`${x},${y}`)) return { x, y };
  }
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      if (!excludedSet.has(`${x},${y}`)) return { x, y };
    }
  }
  return null;
}

// ===== Chiptune Audio =====
function useChiptune() {
  const ctxRef = useRef(null);
  const ensure = () => {
    if (!ctxRef.current) ctxRef.current = new (window.AudioContext || window.webkitAudioContext)();
    return ctxRef.current;
  };

  const tone = (freq = 440, dur = 0.08, type = 'square', gainPeak = 0.24, when = 0) => {
    const ctx = ensure();
    const t0 = ctx.currentTime + when;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(gainPeak, t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g).connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  };

  const seq = (baseHz, steps, stepMs = 110) => {
    let when = 0;
    steps.forEach(([st, dur = 0.09, type = 'square', gain = 0.24]) => {
      const freq = baseHz * Math.pow(2, st / 12);
      tone(freq, dur, type, gain, when / 1000);
      when += stepMs;
    });
  };

  // Movement tick
  const playMove = () => tone(220, 0.045, 'square', 0.2, 0);

  // Fruit collection SFX — quick arpeggio
  const playFruit = () => {
    const base = 330;
    [0, 4, 7].forEach((st, i) => tone(base * Math.pow(2, st / 12), 0.07, 'square', 0.22, i * 0.05));
  };

  // 8-note happy jingle (C maj up & resolve)
  const playWin = () => {
    const C5 = 523.25;
    const steps = [0, 4, 7, 11, 12, 16, 19, 24].map((st) => [st, 0.095, 'square', 0.28]);
    seq(C5, steps, 95);
  };

  // 8-note sad jingle (descending minor)
  const playLifeLost = () => {
    const A4 = 440;
    const steps = [0, -2, -3, -5, -7, -9, -11, -12].map((st) => [st, 0.11, 'triangle', 0.22]);
    seq(A4, steps, 120);
  };

  // 10-note sadder jingle (game over)
  const playGameOver = () => {
    const A4 = 440;
    const pattern = [0, -3, -5, -7, -8, -10, -12, -15, -17, -19];
    const steps = pattern.map((st) => [st, 0.14, 'triangle', 0.26]);
    seq(A4, steps, 140);
  };

  // Small celebratory sweep used on power-up pickup
  const playPickupSweep = () => {
    const base = 330;
    [0, 5, 7, 12].forEach((st, i) => tone(base * Math.pow(2, st / 12), 0.07, 'square', 0.22, i * 0.06));
  };

  return { playMove, playFruit, playWin, playLifeLost, playGameOver, playPickupSweep };
}

// ===== Component =====
export default function Invisisnake() {
  const canvasRef = useRef(null);

  // Level + board
  const [level, setLevel] = useState(1);
  const [cols, setCols] = useState(sizeForLevel(1));
  const [rows, setRows] = useState(sizeForLevel(1));

  // Level picker UI
  const [selectedLevel, setSelectedLevel] = useState(1);
  const [selectedLevelInput, setSelectedLevelInput] = useState('1');

  // Lives
  const [lives, setLives] = useState(3);

  // Core state
  const centerCell = (c, r) => ({ x: Math.floor(c / 2), y: Math.floor(r / 2) });
  const [snake, setSnake] = useState(() => [centerCell(cols, rows)]);
  const [dir, setDir] = useState(DIRS.RIGHT);
  const [fruit, setFruit] = useState(() => {
    const occ = new Set([`${Math.floor(cols / 2)},${Math.floor(rows / 2)}`]);
    return placeFreeCell(occ, cols, rows) ?? { x: 0, y: 0 };
  });
  const [score, setScore] = useState(0);
  const [gameOver, setGameOver] = useState(false);
  const [won, setWon] = useState(false);
  const [crashPos, setCrashPos] = useState(null);
  const [showOverlay, setShowOverlay] = useState(false);
  const [overlayMode, setOverlayMode] = useState(null); // 'retry' | 'reset' | 'win'

  // Power-up
  const [powerUp, setPowerUp] = useState(null); // {x,y,ttl}
  const [revealTurns, setRevealTurns] = useState(0);

  // Hazards
  const [hazards, setHazards] = useState([]);

  // FX refs
  const particlesRef = useRef([]); // {x,y,vx,vy,life,color,size}
  const flashRef = useRef(0);

  // Snapshots
  const snakeRef = useRef(snake);
  const fruitRef = useRef(fruit);
  const gameOverRef = useRef(gameOver);
  const wonRef = useRef(won);
  const crashPosRef = useRef(crashPos);
  const showOverlayRef = useRef(showOverlay);
  const colsRef = useRef(cols);
  const rowsRef = useRef(rows);
  const powerUpRef = useRef(powerUp);
  const revealTurnsRef = useRef(revealTurns);
  const livesRef = useRef(lives);
  const overlayModeRef = useRef(overlayMode);
  const hazardsRef = useRef(hazards);

  useEffect(() => {
    snakeRef.current = snake;
  }, [snake]);
  useEffect(() => {
    fruitRef.current = fruit;
  }, [fruit]);
  useEffect(() => {
    gameOverRef.current = gameOver;
  }, [gameOver]);
  useEffect(() => {
    wonRef.current = won;
  }, [won]);
  useEffect(() => {
    crashPosRef.current = crashPos;
  }, [crashPos]);
  useEffect(() => {
    showOverlayRef.current = showOverlay;
  }, [showOverlay]);
  useEffect(() => {
    colsRef.current = cols;
    rowsRef.current = rows;
  }, [cols, rows]);
  useEffect(() => {
    powerUpRef.current = powerUp;
  }, [powerUp]);
  useEffect(() => {
    revealTurnsRef.current = revealTurns;
  }, [revealTurns]);
  useEffect(() => {
    livesRef.current = lives;
  }, [lives]);
  useEffect(() => {
    overlayModeRef.current = overlayMode;
  }, [overlayMode]);
  useEffect(() => {
    hazardsRef.current = hazards;
  }, [hazards]);

  // Audio
  const { playMove, playFruit, playWin, playLifeLost, playGameOver, playPickupSweep } = useChiptune();

  const baselineAlpha = (index1) => {
    if (index1 <= 3) return 1;
    if (index1 >= 10) return 0;
    return 1 - (index1 - 3) / 7;
  };

  // Reset helpers
  const resetBoard = (c, r) => {
    const start = centerCell(c, r);
    const startSnake = [start];
    setSnake(startSnake);
    setDir(DIRS.RIGHT);
    const occ = new Set([`${start.x},${start.y}`]);
    setFruit(placeFreeCell(occ, c, r) ?? { x: 0, y: 0 });
    setScore(0);
    setGameOver(false);
    setWon(false);
    setCrashPos(null);
    setShowOverlay(false);
    setOverlayMode(null);
    setPowerUp(null);
    setRevealTurns(0);
    setHazards([]);
    particlesRef.current = [];
    flashRef.current = 0;
  };

  const applyLevel = (lvl) => {
    const clamped = Math.max(1, Math.min(10, Math.floor(Number(lvl) || 1)));
    const s = sizeForLevel(clamped);
    setLevel(clamped);
    setCols(s);
    setRows(s);
    setSelectedLevel(clamped);
    setSelectedLevelInput(String(clamped));
    setLives(3);
    setTimeout(() => resetBoard(s, s), 0);
  };

  const resetLevelOne = () => applyLevel(1);

  const nextLevel = () => {
    const next = Math.max(1, Math.min(10, level + 1));
    const s = sizeForLevel(next);
    setLevel(next);
    setCols(s);
    setRows(s);
    setSelectedLevel(next);
    setSelectedLevelInput(String(next));
    setTimeout(() => resetBoard(s, s), 0);
  };

  // Particles (scaled)
  const spawnBurst = (cx, cy, color, cellSize, intensity = 1) => {
    const arr = particlesRef.current;
    const baseCount = Math.max(10, Math.floor(cellSize * 0.6));
    const count = Math.min(64, Math.floor(baseCount * intensity));
    const speed = cellSize * (0.08 + 0.04 * Math.random()) * intensity;
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = speed * (0.6 + Math.random() * 0.8);
      arr.push({
        x: cx,
        y: cy,
        vx: Math.cos(a) * v,
        vy: Math.sin(a) * v,
        life: 1,
        color,
        size: Math.max(2, Math.floor(cellSize * 0.14))
      });
    }
  };

  // Spawns (note: accepts block flag to suppress spawning on pickup frame)
  const maybeSpawnPowerUp = (head, currentSnake, c, r, block = false) => {
    if (block) return;
    if (level < POWERUP_MIN_LEVEL) return;
    if (powerUpRef.current) return;
    if (revealTurnsRef.current > 0) return;
    if (currentSnake.length < 10) return;
    if (Math.random() > POWERUP_CHANCE_PER_TURN) return;
    const occ = new Set(currentSnake.map((p) => `${p.x},${p.y}`));
    if (fruitRef.current) occ.add(`${fruitRef.current.x},${fruitRef.current.y}`);
    hazardsRef.current.forEach((h) => occ.add(`${h.x},${h.y}`));
    const pos = placeFreeCell(occ, c, r);
    if (!pos) return;
    const ttl = Math.max(1, Math.ceil(Math.hypot(pos.x - head.x, pos.y - head.y)) + 3);
    setPowerUp({ x: pos.x, y: pos.y, ttl });
  };

  const maybeSpawnHazard = (head, currentSnake, c, r) => {
    if (level < HAZARD_MIN_LEVEL) return;
    const maxHazards = Math.max(0, level - 2);
    if (hazardsRef.current.length >= maxHazards) return;
    if (Math.random() > HAZARD_CHANCE_PER_TURN) return;
    const occ = new Set(currentSnake.map((p) => `${p.x},${p.y}`));
    if (fruitRef.current) occ.add(`${fruitRef.current.x},${fruitRef.current.y}`);
    if (powerUpRef.current) occ.add(`${powerUpRef.current.x},${powerUpRef.current.y}`);
    hazardsRef.current.forEach((h) => occ.add(`${h.x},${h.y}`));
    occ.add(`${head.x},${head.y}`);
    const pos = placeFreeCell(occ, c, r);
    if (!pos) return;
    setHazards((hs) => [...hs, pos]);
  };

  // Life loss
  const loseLifeAt = (cellPos) => {
    setCrashPos(cellPos);
    setGameOver(true);
    setShowOverlay(false);
    const remaining = Math.max(0, livesRef.current - 1);
    setLives(remaining);
    setOverlayMode(remaining > 0 ? 'retry' : 'reset');
    if (remaining > 0) {
      playLifeLost();
    } else {
      playGameOver();
      setSelectedLevel(1);
      setSelectedLevelInput('1');
    }
    // scaled crash burst
    const cssCanvas = canvasRef.current;
    if (cssCanvas) {
      const cssW = cssCanvas.clientWidth;
      const cssH = cssCanvas.clientHeight;
      const cell = Math.min(cssW / colsRef.current, cssH / rowsRef.current);
      const padX = Math.floor((cssW - cell * colsRef.current) / 2);
      const padY = Math.floor((cssH - cell * rowsRef.current) / 2);
      spawnBurst(
        padX + cellPos.x * cell + cell / 2,
        padY + cellPos.y * cell + cell / 2,
        '#f43f5e',
        cell,
        1.2
      );
    }
    setTimeout(() => {
      if (gameOverRef.current) setShowOverlay(true);
    }, OVERLAY_DELAY_MS);
  };

  // Win
  const triggerWin = () => {
    if (wonRef.current) return;
    setWon(true);
    setShowOverlay(false);
    setOverlayMode('win');
    playWin();
    setTimeout(() => {
      if (wonRef.current) setShowOverlay(true);
    }, OVERLAY_DELAY_MS);
  };

  // One move step
  const doStep = (nextDir) => {
    if (gameOver || won) return;
    if (snake.length > 1 && isOpposite(nextDir, dir)) return;

    const head = snake[0];
    const newHead = {
      x: wrapCoord(head.x + nextDir.x, cols),
      y: wrapCoord(head.y + nextDir.y, rows)
    };

    // Hazard first
    if (hazardsRef.current.some((h) => posEq(h, newHead))) return loseLifeAt(newHead);
    // Self
    if (snake.some((s) => posEq(s, newHead))) return loseLifeAt(newHead);

    // Always move head into the cell first
    let newSnake = [newHead, ...snake];

    // Fruit
    const ateFruit = fruit && posEq(newHead, fruit);
    let nextFruitPos = fruitRef.current;
    if (!ateFruit) {
      newSnake.pop();
      playMove();
    } else {
      playFruit();
      const occF = new Set(newSnake.map((p) => `${p.x},${p.y}`));
      if (powerUpRef.current) occF.add(`${powerUpRef.current.x},${powerUpRef.current.y}`);
      hazardsRef.current.forEach((h) => occF.add(`${h.x},${h.y}`));
      const nf = placeFreeCell(occF, cols, rows);
      if (!nf) {
        triggerWin();
        nextFruitPos = null;
      } else {
        setFruit(nf);
        nextFruitPos = nf;
      }
      setScore((v) => v + 1);
      // scaled eat burst
      const cssCanvas = canvasRef.current;
      if (cssCanvas) {
        const cssW = cssCanvas.clientWidth;
        const cssH = cssCanvas.clientHeight;
        const cell = Math.min(cssW / colsRef.current, cssH / rowsRef.current);
        const padX = Math.floor((cssW - cell * colsRef.current) / 2);
        const padY = Math.floor((cssH - cell * rowsRef.current) / 2);
        spawnBurst(
          padX + newHead.x * cell + cell / 2,
          padY + newHead.y * cell + cell / 2,
          '#22c55e',
          cell,
          1.0
        );
      }
    }

    // Power-up pickup — mark pickedUpThisStep to suppress same-turn respawn
    let pickedUpThisStep = false;
    if (powerUpRef.current && posEq(newHead, powerUpRef.current)) {
      pickedUpThisStep = true;
      setRevealTurns(newSnake.length);
      setPowerUp(null);
      // celebratory sweep
      playPickupSweep();
    }

    // Countdown (safe even if powerUp was cleared; we gate via ref)
    if (powerUpRef.current) {
      const nextTTL = powerUpRef.current.ttl - 1;
      if (nextTTL <= 0) setPowerUp(null);
      else setPowerUp({ ...powerUpRef.current, ttl: nextTTL });
    }
    if (revealTurnsRef.current > 0) setRevealTurns(revealTurnsRef.current - 1);

    // Win check (empties < ceil(15%))
    {
      const total = cols * rows;
      const occ = new Set(newSnake.map((p) => `${p.x},${p.y}`));
      hazardsRef.current.forEach((h) => occ.add(`${h.x},${h.y}`));
      if (nextFruitPos) occ.add(`${nextFruitPos.x},${nextFruitPos.y}`);
      if (powerUpRef.current) occ.add(`${powerUpRef.current.x},${powerUpRef.current.y}`);
      const empties = total - occ.size;
      const threshold = Math.ceil(total * 0.15);
      if (empties < threshold) triggerWin();
    }

    // Spawns after move — pass block flag so no power-up spawns on pickup frame
    maybeSpawnPowerUp(newHead, newSnake, cols, rows, pickedUpThisStep);
    maybeSpawnHazard(newHead, newSnake, cols, rows);

    setSnake(newSnake);
    setDir(nextDir);
  };

  // Keyboard controls
  useEffect(() => {
    const onKeyDown = (e) => {
      if (e.repeat) return;
      const k = e.key;
      if (k === 'ArrowUp' || k === 'w' || k === 'W') {
        e.preventDefault();
        return doStep(DIRS.UP);
      }
      if (k === 'ArrowDown' || k === 's' || k === 'S') {
        e.preventDefault();
        return doStep(DIRS.DOWN);
      }
      if (k === 'ArrowLeft' || k === 'a' || k === 'A') {
        e.preventDefault();
        return doStep(DIRS.LEFT);
      }
      if (k === 'ArrowRight' || k === 'd' || k === 'D') {
        e.preventDefault();
        return doStep(DIRS.RIGHT);
      }
      if (k === 'Enter' || k === ' ') {
        if (won) return nextLevel();
        if (gameOver && showOverlayRef.current) {
          if (overlayModeRef.current === 'retry') return resetBoard(colsRef.current, rowsRef.current);
          if (overlayModeRef.current === 'reset') return resetLevelOne();
        }
      }
      return null;
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [dir, snake, fruit, gameOver, won, level, cols, rows]);

  // Render loop (crisp DPR, scaled FX)
  useEffect(() => {
    let raf = 0;
    const c = canvasRef.current;
    if (!c) return undefined;
    const ctx = c.getContext('2d');

    const draw = () => {
      const COLS = colsRef.current;
      const ROWS = rowsRef.current;
      const cssW = Math.max(1, c.clientWidth);
      const cssH = Math.max(1, c.clientHeight);
      const dpr = Math.max(1, window.devicePixelRatio || 1);
      const pxW = Math.floor(cssW * dpr);
      const pxH = Math.floor(cssH * dpr);
      if (c.width !== pxW || c.height !== pxH) {
        c.width = pxW;
        c.height = pxH;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.scale(dpr, dpr);
      }

      const CELL = Math.floor(Math.min(cssW / COLS, cssH / ROWS));
      const padX = Math.floor((cssW - CELL * COLS) / 2);
      const padY = Math.floor((cssH - CELL * ROWS) / 2);

      // Background
      ctx.clearRect(0, 0, cssW, cssH);
      const bgGrad = ctx.createLinearGradient(0, 0, 0, cssH);
      bgGrad.addColorStop(0, '#0b1020');
      bgGrad.addColorStop(1, '#0a0d16');
      ctx.fillStyle = bgGrad;
      ctx.fillRect(0, 0, cssW, cssH);

      // scanlines
      ctx.globalAlpha = 0.07;
      for (let y = 0; y < cssH; y += 3) {
        ctx.fillStyle = '#000';
        ctx.fillRect(0, y, cssW, 1);
      }
      ctx.globalAlpha = 1;

      // grid dots
      ctx.globalAlpha = 0.15;
      ctx.fillStyle = '#94a3b8';
      const dotSize = Math.max(2, Math.floor(CELL * 0.08));
      for (let gy = 0; gy < ROWS; gy++) {
        for (let gx = 0; gx < COLS; gx++) {
          ctx.fillRect(
            padX + gx * CELL + Math.floor(CELL / 2) - Math.floor(dotSize / 2),
            padY + gy * CELL + Math.floor(CELL / 2) - Math.floor(dotSize / 2),
            dotSize,
            dotSize
          );
        }
      }
      ctx.globalAlpha = 1;

      const over = gameOverRef.current;
      const win = wonRef.current;
      const t = performance.now() / 1000;
      const pulse = 0.5 + 0.5 * Math.sin(t * 6);

      // Fruit
      const f = fruitRef.current;
      if (f && !win && !over) {
        ctx.fillStyle = '#ef4444';
        ctx.beginPath();
        ctx.arc(
          padX + f.x * CELL + CELL / 2,
          padY + f.y * CELL + CELL / 2,
          Math.floor(CELL * 0.35),
          0,
          Math.PI * 2
        );
        ctx.fill();
      }

      // Hazards
      const hs = hazardsRef.current;
      if (hs.length) {
        for (const h of hs) {
          const x = padX + h.x * CELL;
          const y = padY + h.y * CELL;
          const inset = Math.max(1, Math.floor(CELL * 0.15));
          const w = CELL - inset * 2;
          const hgt = CELL - inset * 2;
          ctx.save();
          ctx.translate(x + CELL / 2, y + CELL / 2);
          ctx.rotate(Math.PI / 4);
          ctx.fillStyle = '#ef4444';
          ctx.strokeStyle = '#7f1d1d';
          ctx.lineWidth = Math.max(2, CELL * 0.08);
          ctx.beginPath();
          ctx.rect(-w / 2, -hgt / 2, w, hgt);
          ctx.fill();
          ctx.stroke();
          ctx.restore();
          ctx.fillStyle = '#111827';
          ctx.fillRect(
            x + CELL / 2 - Math.max(2, Math.floor(CELL * 0.06)),
            y + inset + Math.floor(CELL * 0.1),
            Math.max(4, Math.floor(CELL * 0.12)),
            Math.max(6, Math.floor(CELL * 0.38))
          );
          ctx.beginPath();
          ctx.arc(
            x + CELL / 2,
            y + CELL - inset - Math.floor(CELL * 0.16),
            Math.max(2, Math.floor(CELL * 0.06)),
            0,
            Math.PI * 2
          );
          ctx.fill();
        }
      }

      // Power-up
      const pu = powerUpRef.current;
      if (pu && !win && !over) {
        const x = padX + pu.x * CELL;
        const y = padY + pu.y * CELL;
        const inset = Math.max(1, Math.floor(CELL * 0.24));
        ctx.lineWidth = Math.max(2, CELL * 0.08);
        ctx.strokeStyle = pulse > 0.5 ? '#fbbf24' : '#fde68a';
        ctx.strokeRect(x + inset + 0.5, y + inset + 0.5, CELL - inset * 2 - 1, CELL - inset * 2 - 1);
        ctx.globalAlpha = 0.45 + 0.35 * pulse;
        ctx.fillStyle = '#f59e0b';
        ctx.fillRect(
          x + inset + Math.max(2, Math.floor(CELL * 0.08)),
          y + inset + Math.max(2, Math.floor(CELL * 0.08)),
          Math.max(2, CELL - inset * 2 - Math.max(4, Math.floor(CELL * 0.16))),
          Math.max(2, CELL - inset * 2 - Math.max(4, Math.floor(CELL * 0.16)))
        );
        ctx.globalAlpha = 1;
        ctx.fillStyle = '#0b1020';
        ctx.font = `${Math.max(10, Math.floor(CELL * 0.42))}px ui-monospace, SFMono-Regular, Menlo, monospace`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(pu.ttl), x + CELL / 2, y + CELL / 2);
      }

      // Snake
      const sArr = snakeRef.current;
      for (let i = 0; i < sArr.length; i++) {
        const p = sArr[i];
        const normA = baselineAlpha(i + 1);
        let a = over ? 1 : normA;
        let ghost = false;
        if (!over && revealTurnsRef.current > 0 && normA <= 0) {
          a = 0.22 + 0.38 * pulse;
          ghost = true;
        }
        if (a <= 0) continue;
        ctx.globalAlpha = a;
        ctx.fillStyle = i === 0 ? (over ? '#34d399' : '#22c55e') : over ? '#6ee7b7' : '#10b981';
        const x = padX + p.x * CELL;
        const y = padY + p.y * CELL;
        const inset = Math.max(1, Math.floor(CELL * 0.1));
        ctx.fillRect(x + inset, y + inset, CELL - inset * 2, CELL - inset * 2);
        if (over || ghost) {
          ctx.strokeStyle = ghost ? (pulse > 0.5 ? '#a7f3d0' : '#99f6e4') : '#e5e7eb';
          ctx.lineWidth = Math.max(2, CELL * 0.08);
          ctx.strokeRect(x + inset + 0.5, y + inset + 0.5, CELL - inset * 2 - 1, CELL - inset * 2 - 1);
        }
      }
      ctx.globalAlpha = 1;

      // Particles
      const ps = particlesRef.current;
      for (let i = ps.length - 1; i >= 0; i--) {
        const p = ps[i];
        p.x += p.vx;
        p.y += p.vy;
        p.vx *= 0.98;
        p.vy *= 0.98;
        p.life -= 0.03;
        if (p.life <= 0) {
          ps.splice(i, 1);
          continue;
        }
        ctx.globalAlpha = Math.max(0, p.life);
        ctx.fillStyle = p.color;
        ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
      }
      ctx.globalAlpha = 1;

      // Crash ring
      if (over) {
        const crash = crashPosRef.current;
        if (crash) {
          const cx = padX + crash.x * CELL + CELL / 2;
          const cy = padY + crash.y * CELL + CELL / 2;
          ctx.lineWidth = Math.max(3, CELL * 0.12);
          ctx.strokeStyle = '#f43f5e';
          ctx.beginPath();
          ctx.arc(cx, cy, Math.floor(CELL * 0.45), 0, Math.PI * 2);
          ctx.stroke();
        }
      }

      // Flash
      if (flashRef.current > 0.01) {
        ctx.fillStyle = `rgba(255,255,255,${Math.min(0.45, flashRef.current * 0.5)})`;
        ctx.fillRect(0, 0, cssW, cssH);
        flashRef.current *= 0.9;
      } else {
        flashRef.current = 0;
      }

      raf = requestAnimationFrame(draw);
    };

    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [level]);

  // Overlay click == Enter
  const onOverlayClick = () => {
    if (won) return nextLevel();
    if (gameOver && showOverlayRef.current) {
      if (overlayModeRef.current === 'retry') return resetBoard(colsRef.current, rowsRef.current);
      if (overlayModeRef.current === 'reset') return resetLevelOne();
    }
    return null;
  };

  // Level picker sync
  useEffect(() => {
    setSelectedLevel(level);
    setSelectedLevelInput(String(level));
  }, [level]);
  const commitLevelInput = () => {
    const num = Math.floor(Number(selectedLevelInput));
    const clamped = Number.isNaN(num) ? 1 : Math.max(1, Math.min(10, num));
    setSelectedLevel(clamped);
    setSelectedLevelInput(String(clamped));
  };

  return (
    <div className="w-full flex flex-col items-center gap-4 p-4 bg-slate-900 text-slate-100">
      <div className="flex flex-col sm:flex-row sm:items-center gap-4 w-full max-w-[900px] justify-between">
        <div className="text-slate-100 text-sm tracking-wide">
          <div className="font-semibold text-lg">Invisisnake</div>
          <div className="opacity-90">Edges wrap. Use arrow keys or on-screen buttons to move.</div>
          <div className="opacity-80">Eat all fruit on the board to win. Don't bite yourself.</div>
          <div className="opacity-70">Level: {level} • Lives: {lives} • Length: {snake.length}</div>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-sm opacity-80" htmlFor="lvlPick">
            Level
          </label>
          <input
            id="lvlPick"
            type="number"
            min={1}
            max={10}
            value={selectedLevelInput}
            onChange={(e) => {
              const v = e.target.value;
              if (v === '' || /^\d{0,2}$/.test(v)) setSelectedLevelInput(v);
            }}
            onBlur={commitLevelInput}
            className="w-16 px-2 py-1 rounded-md bg-slate-800 border border-slate-700 text-slate-100 text-sm focus:outline-none focus:ring-1 focus:ring-slate-500"
          />
          <button
            type="button"
            onClick={() => {
              commitLevelInput();
              applyLevel(selectedLevel);
            }}
            className="px-4 py-2 rounded-2xl bg-slate-700 text-slate-100 hover:bg-slate-600 shadow-sm"
          >
            Start
          </button>
        </div>
      </div>

      {/* Canvas + overlay */}
      <div
        className="relative"
        onClick={() => {
          if (showOverlayRef.current) onOverlayClick();
        }}
      >
        <canvas
          ref={canvasRef}
          style={{ width: 'min(90vmin, 820px)', height: 'min(90vmin, 820px)', imageRendering: 'pixelated' }}
          className="rounded-2xl shadow-lg border border-slate-700"
        />
        {showOverlay && (
          <div
            className="absolute inset-0 flex flex-col justify-center items-center bg-black/70 text-center p-4 cursor-pointer"
            onClick={onOverlayClick}
          >
            <div className="text-xl font-bold break-words whitespace-pre-wrap max-w-[80%]">
              {overlayMode === 'win'
                ? `Level ${level} Cleared`
                : overlayMode === 'retry'
                ? 'Life Lost'
                : 'Game Over'}
            </div>
            <div className="text-sm mt-3 opacity-90 break-words whitespace-pre-wrap max-w-[80%]">
              {overlayMode === 'win'
                ? 'Tap or press Enter for Next Level'
                : overlayMode === 'retry'
                ? `Tap or press Enter to Retry • Lives Left: ${lives}`
                : 'Tap or press Enter to Restart Level 1'}
            </div>
          </div>
        )}
      </div>

      {/* D-pad */}
      <div className="grid grid-cols-3 gap-3 select-none w-full max-w-[420px] place-items-center">
        <div />
        <button
          type="button"
          className="min-w-[76px] min-h-[76px] text-3xl px-5 py-5 rounded-2xl bg-slate-800 hover:bg-slate-700 shadow-md"
          onClick={() => doStep(DIRS.UP)}
        >
          ↑
        </button>
        <div />
        <button
          type="button"
          className="min-w-[76px] min-h-[76px] text-3xl px-5 py-5 rounded-2xl bg-slate-800 hover:bg-slate-700 shadow-md"
          onClick={() => doStep(DIRS.LEFT)}
        >
          ←
        </button>
        <div />
        <button
          type="button"
          className="min-w-[76px] min-h-[76px] text-3xl px-5 py-5 rounded-2xl bg-slate-800 hover:bg-slate-700 shadow-md"
          onClick={() => doStep(DIRS.RIGHT)}
        >
          →
        </button>
        <div />
        <button
          type="button"
          className="min-w-[76px] min-h-[76px] text-3xl px-5 py-5 rounded-2xl bg-slate-800 hover:bg-slate-700 shadow-md"
          onClick={() => doStep(DIRS.DOWN)}
        >
          ↓
        </button>
        <div />
      </div>
    </div>
  );
}
