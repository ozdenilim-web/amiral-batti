"use client";
import { useState, useEffect, useCallback, useRef } from "react";
import { db, auth, googleProvider, ref, set, get, onValue, update, remove, onDisconnect, runTransaction, query, orderByChild, limitToLast, signInAnonymously, onAuthStateChanged, signInWithPopup, signOut } from "../lib/firebase";

const ROWS = 11;
const COLS = 11;
const COL_LABELS = ["A","B","C","D","E","F","G","H","I","J","K"];
const SHOTS_PER_TURN = 3;
const CLOCK_SECONDS = 300;
const PLACEMENT_SECONDS = 60;

const SHIPS = [
  { id: "amiral", name: "Amiral", shape: [[0,0],[0,1],[0,2],[1,1]], size: 4, color: "#e74c3c" },
  { id: "uclu1", name: "Üçlü-1", shape: [[0,0],[0,1],[0,2]], size: 3, color: "#3498db" },
  { id: "uclu2", name: "Üçlü-2", shape: [[0,0],[0,1],[0,2]], size: 3, color: "#2980b9" },
  { id: "ikili1", name: "İkili-1", shape: [[0,0],[0,1]], size: 2, color: "#2ecc71" },
  { id: "ikili2", name: "İkili-2", shape: [[0,0],[0,1]], size: 2, color: "#27ae60" },
  { id: "ikili3", name: "İkili-3", shape: [[0,0],[0,1]], size: 2, color: "#1abc9c" },
  { id: "tekli1", name: "Tekli-1", shape: [[0,0]], size: 1, color: "#f39c12" },
  { id: "tekli2", name: "Tekli-2", shape: [[0,0]], size: 1, color: "#f39c12" },
  { id: "tekli3", name: "Tekli-3", shape: [[0,0]], size: 1, color: "#f39c12" },
  { id: "tekli4", name: "Tekli-4", shape: [[0,0]], size: 1, color: "#f39c12" },
];

function rotateShape(shape, times) {
  let s = shape.map(c => [...c]);
  for (let tt = 0; tt < times; tt++) s = s.map(([r, c]) => [c, -r]);
  const minR = Math.min(...s.map(([r]) => r));
  const minC = Math.min(...s.map(([, c]) => c));
  return s.map(([r, c]) => [r - minR, c - minC]);
}
function getShipCells(ship, row, col, rotation) {
  return rotateShape(ship.shape, rotation).map(([r, c]) => [row + r, col + c]);
}
function getNeighborCells(cells) {
  const cellSet = new Set(cells.map(([r, c]) => `${r},${c}`));
  const neighbors = new Set();
  cells.forEach(([r, c]) => {
    for (let dr = -1; dr <= 1; dr++)
      for (let dc = -1; dc <= 1; dc++) {
        if (dr === 0 && dc === 0) continue;
        const key = `${r + dr},${c + dc}`;
        if (!cellSet.has(key)) neighbors.add(key);
      }
  });
  return [...neighbors].map(k => k.split(",").map(Number));
}
function isValidPlacement(cells, board) {
  return cells.every(([r, c]) => r >= 0 && r < ROWS && c >= 0 && c < COLS && board[r][c] === 0);
}
function emptyGrid() { return Array.from({ length: ROWS }, () => Array(COLS).fill(0)); }
function coordStr(r, c) { return `${r + 1}${COL_LABELS[c]}`; }
function formatTime(sec) { const s = Math.max(0, sec); return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, "0")}`; }

function isTestMode() {
  if (typeof window === "undefined") return false;
  return new URLSearchParams(window.location.search).get("test") === "1";
}
function getTestGold() { return isTestMode() ? 5000 : STARTING_GOLD; }

// === GÜNLÜK SANDIK (cihaz bazlı) ===
const DAILY_CHEST_KEY = "ab_daily_chest_date";
const DAILY_CHEST_GOLD = 500;
function hasClaimedDailyChestToday() {
  if (typeof window === "undefined") return true;
  try { return localStorage.getItem(DAILY_CHEST_KEY) === new Date().toDateString(); } catch (e) { return true; }
}
function markDailyChestClaimed() {
  if (typeof window === "undefined") return;
  try { localStorage.setItem(DAILY_CHEST_KEY, new Date().toDateString()); } catch (e) {}
}

// === BOT AI ===
const BOT_NAMES = [
  "Barbaros Hayreddin","Jack Sparrow","Karabasan","Oruç Reis","Turgut Reis","Piri Reis","Salih Reis","Kılıç Ali","Murat Reis","Seydi Ali",
  "Karasakal","Edward Teach","Kaptan Kidd","Henry Morgan","Bartholomew","Kara Bart","Calico Jack","Anne Bonny","Mary Read","Charles Vane",
  "Stede Bonnet","Sam Bellamy","Kara Sam","Edward Low","Ned Low","Francis Drake","John Hawkins","Walter Raleigh","Henry Avery","Long Ben",
  "Thomas Tew","William Dampier","Woodes Rogers","Jean Lafitte","Amaro Pargo","Kanhoji","Koxinga","Zheng Yi Sao","Ching Shih","Madam Cheng",
  "Grace O'Malley","Granuaile","Klaus Störtebeker","François l'Olonnais","Olonez","Roc Brasiliano","Michel de Grammont","Laurens de Graaf","Nicolas van Hoorn","Pierre le Grand",
  "Daniel Montbars","Yıkıcı Montbars","Alexandre Exquemelin","Raveneau de Lussan","Bartolomeu Português","Manuel Pardal","Benito Bonito","Kara Caesar","Black Caesar","Hayreddin Paşa",
  "Kemal Reis","Burak Reis","Kara Hasan","Deli Mehmed","Uluç Ali","Cigalazade","Hızır Reis","Aydın Reis","Şeytan Hızır","Kurtoğlu",
  "Kara Murat","Deniz Kurdu","Levent Reis","Barbarossa","Dragut","Karadeniz Kaplanı","Kaptan Nemo","Uzun John Silver","Kanca Kaptan","Davy Jones",
  "Kara İnci","Fırtına Kıran","Deniz Şeytanı","Okyanus Kurdu","Mercan Reis","Kasırga Kemal","Tayfun Turgut","Poyraz Reis","Lodos Ali","Yelken Yusuf",
  "Pala Bıyık","Tek Göz Rıza","Çelik Çapa","Demir Leydi","Kızıl Korsan","Gümüş Kılıç","Altın Diş","Kara Bayrak","Son Amiral","Derin Deniz"
];


// === SAVAŞ FEEDBACK MESAJLARI ===
const FB_HIT1 = ["İSABET! 🎯"];
const FB_HIT2 = ["ÇİFT İSABET! 🎯🎯"];
const FB_HIT3 = ["ÜÇTE ÜÇ! 🎯🎯🎯"];
const FB_MISS = ["KARAVANA", "ISKA!"];
const FB_SUNK = ["GEMİ BATTI! 💀"];
const FB_GOT_HIT = ["VURULDUN! 🚨"];
const FB_GOT_SUNK = ["GEMİN BATTI! 😱"];
const fbPick = (arr) => arr[Math.floor(Math.random() * arr.length)];

// === GÖREV SİSTEMİ ===
const ALL_MISSIONS = [
  // ── KOLAY (anında dopamin) ──
  { id: "play1",    text: "1 oyun oyna",               icon: "⚓", check: s => s.gamesPlayed >= 1 },
  { id: "hit5",     text: "5 isabet yap",               icon: "🎯", check: s => s.totalHits >= 5 },
  { id: "sink1",    text: "1 gemi batır",               icon: "🚢", check: s => s.shipsSunk >= 1 },
  { id: "win1",     text: "1 oyun kazan",               icon: "🏆", check: s => s.wins >= 1 },
  { id: "noMiss1",  text: "Bir turda karavana yeme",    icon: "🛡", check: s => s.perfectTurn },
  { id: "botWin",   text: "Bot'u yen",                  icon: "🤖", check: s => s.botWin },
  { id: "mark3",    text: "3 kare işaretle",            icon: "⚑",  check: s => s.markedCells >= 3 },
  { id: "hit3turn", text: "Tek turda 3 isabet yap",     icon: "💥", check: s => s.perfectTurn3 },

  // ── ORTA (biraz çaba) ──
  { id: "play3",    text: "3 oyun oyna",                icon: "🌊", check: s => s.gamesPlayed >= 3 },
  { id: "hit10",    text: "10 isabet yap",              icon: "🔥", check: s => s.totalHits >= 10 },
  { id: "sink3",    text: "3 gemi batır",               icon: "💣", check: s => s.shipsSunk >= 3 },
  { id: "win2",     text: "2 oyun kazan",               icon: "⭐", check: s => s.wins >= 2 },
  { id: "fast5",    text: "5 dakikada kazan",           icon: "⚡", check: s => s.fastWin5 },
  { id: "noMiss3",  text: "3 turda arka arkaya isabet", icon: "🎖", check: s => s.streakHits >= 3 },
  { id: "play5",    text: "5 oyun oyna",                icon: "⚓",  check: s => s.gamesPlayed >= 5 },
  { id: "hit20",    text: "20 isabet yap",              icon: "🎯", check: s => s.totalHits >= 20 },
  { id: "sink5",    text: "5 gemi batır",               icon: "🔱", check: s => s.shipsSunk >= 5 },
  { id: "win3",     text: "3 oyun kazan",               icon: "👑", check: s => s.wins >= 3 },

  // ── ZOR (tatmin büyük) ──
  { id: "fast3",    text: "3 dakikada kazan",           icon: "🚀", check: s => s.fastWin },
  { id: "noMiss5",  text: "5 turda karavana yeme",      icon: "🏅", check: s => s.perfectTurns >= 5 },
  { id: "sink8",    text: "8 gemi batır",               icon: "💀", check: s => s.shipsSunk >= 8 },
  { id: "hit30",    text: "30 isabet yap",              icon: "🌟", check: s => s.totalHits >= 30 },
  { id: "win5",     text: "5 oyun kazan",               icon: "🥇", check: s => s.wins >= 5 },
  { id: "play10",   text: "10 oyun oyna",               icon: "🎖", check: s => s.gamesPlayed >= 10 },
  { id: "streak5",  text: "5 isabet serisi yap",        icon: "🔥", check: s => s.streakHits >= 5 },
  { id: "sink10",   text: "10 gemi batır",              icon: "⚓", check: s => s.shipsSunk >= 10 },

  // ── EFSANE (nadir, çok tatmin edici) ──
  { id: "win10",    text: "10 oyun kazan",              icon: "🏆", check: s => s.wins >= 10 },
  { id: "hit50",    text: "50 isabet yap",              icon: "💫", check: s => s.totalHits >= 50 },
  { id: "fast2",    text: "2 dakikada kazan",           icon: "⚡", check: s => s.ultraFastWin },
  { id: "perfect",  text: "Hiç karavana vermeden kazan",icon: "👁",  check: s => s.perfectGame },
];

function pickDailyMissions(seed) {
  // Günlük seed ile her gün aynı 3 görev
  const day = Math.floor(seed / 86400000);
  const shuffled = [...ALL_MISSIONS];
  let rng = day * 2654435761;
  for (let i = shuffled.length - 1; i > 0; i--) {
    rng = (rng * 1664525 + 1013904223) & 0x7fffffff;
    const j = rng % (i + 1);
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled.slice(0, 3);
}

function generateChestReward() {
  // Belirsiz ödül — dopaminerjik tahmin hatası
  const roll = Math.random();
  if (roll < 0.05) return { gold: 500, label: "EFSANE", color: "#fbbf24", icon: "👑" };
  if (roll < 0.20) return { gold: 200, label: "NADİR", color: "#a78bfa", icon: "💎" };
  if (roll < 0.50) return { gold: 100, label: "İYİ", color: "#06b6d4", icon: "🎁" };
  return { gold: 50, label: "NORMAL", color: "#34d399", icon: "📦" };
}

function botPlaceShips() {
  const board = emptyGrid();
  const placed = [];
  for (const ship of SHIPS) {
    let attempts = 0;
    while (attempts < 200) {
      const rot = Math.floor(Math.random() * 4);
      const r = Math.floor(Math.random() * ROWS);
      const c = Math.floor(Math.random() * COLS);
      const cells = getShipCells(ship, r, c, rot);
      if (isValidPlacement(cells, board) && !getNeighborCells(cells).some(([nr, nc]) => nr >= 0 && nr < ROWS && nc >= 0 && nc < COLS && board[nr][nc] > 0)) {
        cells.forEach(([cr, cc]) => { board[cr][cc] = 1; });
        placed.push({ id: ship.id, cells, row: r, col: c, rot });
        break;
      }
      attempts++;
    }
  }
  return { board, ships: placed };
}
function shiftIntoBounds(cells) {
  let dr = 0, dc = 0;
  const rs = cells.map(c => c[0]), cs = cells.map(c => c[1]);
  const minR = Math.min(...rs), maxR = Math.max(...rs), minC = Math.min(...cs), maxC = Math.max(...cs);
  if (minR < 0) dr = -minR; else if (maxR >= ROWS) dr = ROWS - 1 - maxR;
  if (minC < 0) dc = -minC; else if (maxC >= COLS) dc = COLS - 1 - maxC;
  return { cells: cells.map(([r, c]) => [r + dr, c + dc]), dr, dc };
}

function botChooseShots(attackOverlay, lastHits, shotCount) {
  return botChooseShotsInternal(attackOverlay, lastHits, shotCount, false);
}
function botChooseShotsOnboarding(attackOverlay, defBoard, shotCount) {
  // Onboarding bot: ALWAYS miss — only picks empty water cells
  const rows = defBoard.length, cols = defBoard[0]?.length || 0;
  const safeCells = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (!attackOverlay[r]?.[c] && defBoard[r][c] === 0) safeCells.push([r, c]);
    }
  }
  const shots = [];
  for (let i = 0; i < shotCount && safeCells.length > 0; i++) {
    const idx = Math.floor(Math.random() * safeCells.length);
    shots.push(safeCells.splice(idx, 1)[0]);
  }
  return shots;
}
function botChooseShotsInternal(attackOverlay, lastHits, shotCount, alwaysMiss) {
  const available = [];
  const priority = [];
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (!attackOverlay[r][c]) {
        available.push([r, c]);
        // Check if adjacent to a hit (hunt mode)
        const adjHit = [[r-1,c],[r+1,c],[r,c-1],[r,c+1]].some(([ar,ac]) => ar >= 0 && ar < ROWS && ac >= 0 && ac < COLS && attackOverlay[ar][ac] === "hit");
        if (adjHit) priority.push([r, c]);
      }
    }
  }
  const shots = [];
  const pool = priority.length > 0 ? priority : available;
  for (let i = 0; i < shotCount && pool.length > 0; i++) {
    // Medium difficulty: 60% smart, 40% random
    let usePool = pool;
    if (priority.length > 0 && Math.random() < 0.4) usePool = available;
    const idx = Math.floor(Math.random() * usePool.length);
    const shot = usePool.splice(idx, 1)[0];
    // Also remove from the other pool
    const aidx = available.findIndex(([r,c]) => r === shot[0] && c === shot[1]);
    if (aidx !== -1) available.splice(aidx, 1);
    const pidx = priority.findIndex(([r,c]) => r === shot[0] && c === shot[1]);
    if (pidx !== -1) priority.splice(pidx, 1);
    shots.push(shot);
  }
  return shots;
}

const t = {
  bg: "#050b18", surface: "#0c1529", surfaceLight: "#162040",
  border: "#1e3a5f", text: "#f0f4ff", textDim: "#8b9dc3",
  accent: "#00e5ff", accentGlow: "rgba(0,229,255,0.45)",
  hit: "#ff4757", hitGlow: "rgba(255,71,87,0.55)",
  miss: "#3d4f6f", sunk: "#ff8c42",
  water: "rgba(0,229,255,0.06)", shipCell: "rgba(0,229,255,0.22)",
  gold: "#ffd700", goldGlow: "rgba(255,215,0,0.45)",
};

function calculateElo(myElo, oppElo, didWin, k = 32) {
  const expected = 1 / (1 + Math.pow(10, (oppElo - myElo) / 400));
  const score = didWin ? 1 : 0;
  return Math.max(0, Math.round(myElo + k * (score - expected)));
}

// === SEVİYE / XP SİSTEMİ ===
const MAX_LEVEL = 83;
const XP_ONLINE_WIN = 1;
const XP_BOT_WIN = 0.5;
const XP_ONLINE_LOSS = XP_ONLINE_WIN / 8;
const XP_BOT_LOSS = XP_BOT_WIN / 8;
function gamesNeededForLevel(fromLevel) {
  if (fromLevel >= MAX_LEVEL) return Infinity;
  return Math.max(1, Math.round(3 * Math.pow(5 / 3, fromLevel - 1)));
}
function applyLevelCredit(profile, credit) {
  let level = profile?.level || 0;
  let progress = (profile?.levelProgress || 0) + credit;
  let guard = 0;
  while (level < MAX_LEVEL && guard < 1000) {
    const need = gamesNeededForLevel(level);
    if (progress >= need) { progress -= need; level++; } else break;
    guard++;
  }
  if (level >= MAX_LEVEL) { level = MAX_LEVEL; progress = 0; }
  return { level, levelProgress: progress };
}

// Not: eski ELO sistemi kaldırıldı — rütbe artık ALTIN miktarına göre belirleniyor
function getRankInfo(gold) {
  const g = gold || 0;
  if (g >= 50000) return { title: "AMİRAL", color: "#fbbf24", icon: "⭐" };
  if (g >= 20000) return { title: "KOMODOR", color: "#a78bfa", icon: "🎖" };
  if (g >= 8000) return { title: "KAPTAN", color: "#06b6d4", icon: "⚓" };
  if (g >= 3000) return { title: "YÜZBAŞI", color: "#34d399", icon: "🏅" };
  if (g >= 1000) return { title: "TEĞMEN", color: "#60a5fa", icon: "📛" };
  return { title: "ER", color: "#9ca3af", icon: "🔰" };
}

// === SES MOTORU (Web Audio API — dosyasız) ===
class SoundEngine {
  constructor() {
    this.ctx = null; this.enabled = true; this.musicGain = null; this.musicOscs = []; this.currentMusic = null; this._loopTimer = null;
    // MP3 music system
    this._audioEl = null;        // current <audio> element
    this._audioGainNode = null;  // Web Audio gain for mp3
    this._audioSrc = null;       // MediaElementSourceNode
    this._mp3Volume = 0.7;       // current target volume for mp3
    this._dynamicTimer = null;   // for intensity ramp
  }
  init() { if (this.ctx) return; try { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch(e) { this.enabled = false; } }

  // --- MP3 helpers ---
  _stopMp3() {
    if (this._dynamicTimer) { clearInterval(this._dynamicTimer); this._dynamicTimer = null; }
    if (this._audioEl) { try { this._audioEl.pause(); this._audioEl.src = ''; } catch(e){} this._audioEl = null; }
    if (this._audioSrc) { try { this._audioSrc.disconnect(); } catch(e){} this._audioSrc = null; }
    if (this._audioGainNode) { try { this._audioGainNode.disconnect(); } catch(e){} this._audioGainNode = null; }
  }
  _playMp3(src, volume=0.7, loop=true) {
    this._stopMp3();
    if (!this.ctx) return;
    const audio = new Audio(src);
    audio.loop = loop;
    audio.crossOrigin = 'anonymous';
    this._audioEl = audio;
    const gainNode = this.ctx.createGain();
    gainNode.gain.setValueAtTime(volume, this.ctx.currentTime);
    gainNode.connect(this.ctx.destination);
    this._audioGainNode = gainNode;
    const srcNode = this.ctx.createMediaElementSource(audio);
    srcNode.connect(gainNode);
    this._audioSrc = srcNode;
    this._mp3Volume = volume;
    audio.play().catch(()=>{});
  }
  // Yavaşça volume değiştir (intensity için)
  _rampMp3Volume(targetVol, durationMs=2000) {
    if (!this._audioGainNode || !this.ctx) return;
    const steps = 30, interval = durationMs / steps;
    const startVol = this._mp3Volume;
    let step = 0;
    if (this._dynamicTimer) clearInterval(this._dynamicTimer);
    this._dynamicTimer = setInterval(() => {
      step++;
      const t = step / steps;
      const eased = t < 0.5 ? 2*t*t : -1+(4-2*t)*t; // ease in-out
      const vol = startVol + (targetVol - startVol) * eased;
      if (this._audioGainNode) this._audioGainNode.gain.setValueAtTime(vol, this.ctx.currentTime);
      if (step >= steps) { clearInterval(this._dynamicTimer); this._dynamicTimer = null; this._mp3Volume = targetVol; if (targetVol > 0) this._loopTargetVol = targetVol; }
    }, interval);
  }
  // Oyun heyecanına göre volume ayarla (dışarıdan çağrılır)
  setBattleIntensity(level) { // level: 0.0 - 1.0
    if (!this._audioEl) return;
    const minVol = 0.08, maxVol = 0.20;
    const target = minVol + (maxVol - minVol) * level;
    this._rampMp3Volume(target, 3000);
  }

  // Fade out then stop
  _fadeOutAndStop(durationMs = 1200) {
    if (!this._audioGainNode || !this.ctx) { this._stopMp3(); return; }
    const steps = 20, interval = durationMs / steps;
    const startVol = this._mp3Volume;
    let step = 0;
    if (this._dynamicTimer) { clearInterval(this._dynamicTimer); this._dynamicTimer = null; }
    this._dynamicTimer = setInterval(() => {
      step++;
      const vol = startVol * (1 - step / steps);
      if (this._audioGainNode) this._audioGainNode.gain.setValueAtTime(Math.max(0, vol), this.ctx.currentTime);
      if (step >= steps) {
        clearInterval(this._dynamicTimer); this._dynamicTimer = null;
        this._stopMp3();
      }
    }, interval);
  }

  // TEK PARÇA MÜZİK — iron-tide hep çalar, sadece volume nefes alır
  ensureMusic(vol=0.10) {
    if (!this.ctx) this.init();
    if (!this.ctx) return;
    if (this._audioEl && !this._audioEl.paused && this._audioGainNode) {
      this._rampMp3Volume(vol, 2500);
      return;
    }
    this._stopMp3();
    this.currentMusic = 'main';
    this._loopTargetVol = vol;
    const audio = new Audio('/music/iron-tide.mp3');
    audio.loop = false; // manuel loop — dikişi fade ile gizle
    audio.crossOrigin = 'anonymous';
    this._audioEl = audio;
    const gainNode = this.ctx.createGain();
    gainNode.gain.setValueAtTime(0, this.ctx.currentTime);
    gainNode.connect(this.ctx.destination);
    this._audioGainNode = gainNode;
    const srcNode = this.ctx.createMediaElementSource(audio);
    srcNode.connect(gainNode);
    this._audioSrc = srcNode;
    this._mp3Volume = 0;
    // Parça sonuna 3.5s kala yavaşça kıs
    let fadingOut = false;
    audio.addEventListener('timeupdate', () => {
      if (!audio.duration || fadingOut) return;
      if (audio.duration - audio.currentTime < 3.5) {
        fadingOut = true;
        this._rampMp3Volume(0, 3000);
      }
    });
    // Bitince başa sar, yavaşça aç
    audio.addEventListener('ended', () => {
      fadingOut = false;
      audio.currentTime = 0;
      audio.play().catch(()=>{});
      setTimeout(() => this._rampMp3Volume(this._loopTargetVol || 0.10, 3500), 200);
    });
    audio.play().catch(()=>{});
    setTimeout(() => this._rampMp3Volume(vol, 3000), 100);
  }
  stopMusic() {
    this.currentMusic = null;
    if (this._loopTimer) { clearTimeout(this._loopTimer); this._loopTimer = null; }
    this.musicOscs.forEach(o => { try { o.stop(); } catch(e) {} }); this.musicOscs = [];
    if (this.musicGain) { try { this.musicGain.disconnect(); } catch(e) {} this.musicGain = null; }
    this._fadeOutAndStop(1400);
  }
  // LOBİ — Sakin, gizemli, deniz ambiyansı
  playLobbyMusic() { this.ensureMusic(0.10); }
  // SAVAŞ — Iron Tide Rising (mp3) — oyun sırasında alçak, intro'da yüksek
  // Intro'dan oyuna geçiş: müziği yeniden başlatmadan volume'ü alçalt
  transitionToBattle() {
    if (!this.enabled || !this.ctx) return;
    if (this._audioEl && (this.currentMusic === 'intro' || this.currentMusic === 'battle-mp3')) {
      this.currentMusic = 'battle-mp3';
      this._rampMp3Volume(0.10, 2500);
    } else {
      this.playBattleMusic(false);
    }
  }
  playBattleMusic(introMode=false) { this.ensureMusic(introMode ? 0.16 : 0.12); }
  // KAZANMA — Sunrise at the Citadel (mp3)
  playEpicMusic() { this.ensureMusic(0.20); }
  // KAYBETME — Dignity in Ruins (mp3)
  playDefeatMusic() { this.ensureMusic(0.07); }
  // INTRO — Iron Tide Rising yavaş fade-in + loop sonu fade/yüksel
  playAmbientIntro() { this.ensureMusic(0.10); }
  // Yumuşak parça değişimi — eski fade-out, yeni fade-in
  _switchMp3(src, targetVol, loop=true, fadeOutMs=900, fadeInMs=2200) {
    if (!this.ctx) { return; }
    const startNew = () => {
      this._stopMp3();
      const audio = new Audio(src);
      audio.loop = loop;
      audio.crossOrigin = 'anonymous';
      this._audioEl = audio;
      const gainNode = this.ctx.createGain();
      gainNode.gain.setValueAtTime(0, this.ctx.currentTime);
      gainNode.connect(this.ctx.destination);
      this._audioGainNode = gainNode;
      const srcNode = this.ctx.createMediaElementSource(audio);
      srcNode.connect(gainNode);
      this._audioSrc = srcNode;
      this._mp3Volume = 0;
      audio.play().catch(()=>{});
      setTimeout(() => this._rampMp3Volume(targetVol, fadeInMs), 60);
    };
    if (this._audioEl && this._audioGainNode) {
      const steps = 15, interval = fadeOutMs / steps;
      const startVol = this._mp3Volume;
      let step = 0;
      if (this._dynamicTimer) { clearInterval(this._dynamicTimer); this._dynamicTimer = null; }
      this._dynamicTimer = setInterval(() => {
        step++;
        const vol = startVol * (1 - step / steps);
        if (this._audioGainNode) this._audioGainNode.gain.setValueAtTime(Math.max(0, vol), this.ctx.currentTime);
        if (step >= steps) { clearInterval(this._dynamicTimer); this._dynamicTimer = null; startNew(); }
      }, interval);
    } else {
      startNew();
    }
  }
  playIntroFanfare() { this.ensureMusic(0.10); }
  // YERLEŞTİRME — Taktik müzik (sakin ama gerilimli)
  playPlacementMusic() { this.ensureMusic(0.10); }
  playVoice(name) {
    // Anons/efekt mp3'leri — üst üste binebilir, kısa dosyalar
    try {
      const a = new Audio(`/sfx/${name}.mp3`);
      a.volume = 0.85;
      a.play().catch(()=>{});
    } catch(e) {}
  }
  play(type) {
    if (!this.enabled || !this.ctx) return;
    try {
      const now = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.connect(gain); gain.connect(this.ctx.destination);
      switch(type) {
        case 'click': osc.frequency.value=800; gain.gain.setValueAtTime(0.08,now); gain.gain.exponentialRampToValueAtTime(0.001,now+0.08); osc.type='sine'; osc.start(now); osc.stop(now+0.08); break;
        case 'hit': osc.frequency.value=200; osc.frequency.exponentialRampToValueAtTime(80,now+0.3); gain.gain.setValueAtTime(0.15,now); gain.gain.exponentialRampToValueAtTime(0.001,now+0.3); osc.type='sawtooth'; osc.start(now); osc.stop(now+0.3); break;
        case 'miss': osc.frequency.value=300; osc.frequency.exponentialRampToValueAtTime(150,now+0.15); gain.gain.setValueAtTime(0.06,now); gain.gain.exponentialRampToValueAtTime(0.001,now+0.15); osc.type='sine'; osc.start(now); osc.stop(now+0.15); break;
        case 'sunk': { // Multi-tone explosion
          const o2=this.ctx.createOscillator(),g2=this.ctx.createGain(); o2.connect(g2); g2.connect(this.ctx.destination);
          osc.frequency.value=150; osc.frequency.exponentialRampToValueAtTime(40,now+0.5); gain.gain.setValueAtTime(0.2,now); gain.gain.exponentialRampToValueAtTime(0.001,now+0.5); osc.type='sawtooth'; osc.start(now); osc.stop(now+0.5);
          o2.frequency.value=80; g2.gain.setValueAtTime(0.15,now+0.05); g2.gain.exponentialRampToValueAtTime(0.001,now+0.6); o2.type='square'; o2.start(now+0.05); o2.stop(now+0.6); break; }
        case 'chest': { // Magical reveal
          [400,500,600,800].forEach((f,i)=>{ const o=this.ctx.createOscillator(),g=this.ctx.createGain(); o.connect(g); g.connect(this.ctx.destination); o.frequency.value=f; g.gain.setValueAtTime(0.08,now+i*0.1); g.gain.exponentialRampToValueAtTime(0.001,now+i*0.1+0.3); o.type='sine'; o.start(now+i*0.1); o.stop(now+i*0.1+0.3); }); break; }
        case 'gold': { // Coin clink
          osc.frequency.value=1200; osc.frequency.exponentialRampToValueAtTime(1800,now+0.05); osc.frequency.exponentialRampToValueAtTime(1400,now+0.15); gain.gain.setValueAtTime(0.1,now); gain.gain.exponentialRampToValueAtTime(0.001,now+0.2); osc.type='sine'; osc.start(now); osc.stop(now+0.2); break; }
        case 'win': { [523,659,784,1047].forEach((f,i)=>{ const o=this.ctx.createOscillator(),g=this.ctx.createGain(); o.connect(g); g.connect(this.ctx.destination); o.frequency.value=f; g.gain.setValueAtTime(0.1,now+i*0.15); g.gain.exponentialRampToValueAtTime(0.001,now+i*0.15+0.4); o.type='sine'; o.start(now+i*0.15); o.stop(now+i*0.15+0.4); }); break; }
        case 'lose': { [400,350,300,200].forEach((f,i)=>{ const o=this.ctx.createOscillator(),g=this.ctx.createGain(); o.connect(g); g.connect(this.ctx.destination); o.frequency.value=f; g.gain.setValueAtTime(0.08,now+i*0.2); g.gain.exponentialRampToValueAtTime(0.001,now+i*0.2+0.3); o.type='sine'; o.start(now+i*0.2); o.stop(now+i*0.2+0.3); }); break; }
        default: osc.frequency.value=600; gain.gain.setValueAtTime(0.05,now); gain.gain.exponentialRampToValueAtTime(0.001,now+0.05); osc.type='sine'; osc.start(now); osc.stop(now+0.05);
      }
    } catch(e) {}
  }
}
const sfx = typeof window !== 'undefined' ? new SoundEngine() : { init(){}, play(){}, enabled:true };

// === CONFETTI SİSTEMİ ===

function OnboardingVictoryScreen({ sfx, t, winner, warrior, mono, onDone }) {
  useEffect(() => {
    sfx.init();
    sfx.playEpicMusic();
  }, []);
  const accentGlow = t.accentGlow;
  const gold = t.gold;
  const goldGlow = t.goldGlow;
  return (
    <div style={{ display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",minHeight:"100vh",minHeight:"100dvh",background:`radial-gradient(ellipse at 50% 30%, rgba(0,229,255,0.15) 0%, rgba(255,215,0,0.05) 30%, ${t.bg} 70%)`,padding:20,overflowY:"auto" }}>
      <div style={{ textAlign:"center",maxWidth:380,width:"90vw",paddingBottom:40 }}>
        <div style={{ background:`linear-gradient(160deg, rgba(16,24,44,0.99) 0%, rgba(10,16,32,0.99) 55%, rgba(24,14,14,0.98) 100%)`,border:"2px solid rgba(255,215,0,0.45)",outline:`1px solid rgba(0,229,255,0.25)`,outlineOffset:4,borderRadius:18,padding:"40px 28px",boxShadow:`0 24px 90px rgba(0,0,0,0.8), 0 0 70px ${accentGlow}, inset 0 1px 0 rgba(255,215,0,0.15), inset 0 -3px 12px rgba(120,20,20,0.25)` }}>
          <div style={{ width:120,height:105,margin:"0 auto 14px",animation:"float 3s ease-in-out infinite",filter:"drop-shadow(0 8px 16px rgba(0,0,0,0.7)) drop-shadow(0 0 40px rgba(255,255,255,0.4)) drop-shadow(0 0 80px rgba(0,229,255,0.35))" }}>
            <AnchorHeroLogo />
          </div>
          <div style={{ fontSize:13,fontWeight:700,color:t.textDim,fontFamily:warrior,letterSpacing:6,marginBottom:6 }}>TEBRİKLER, DENİZCİ!</div>
          <div style={{ fontSize:52,fontWeight:900,color:"#ffd700",fontFamily:warrior,letterSpacing:10,textShadow:`0 0 50px rgba(255,215,0,0.6), 0 0 100px ${accentGlow}, 0 4px 8px rgba(0,0,0,0.8)`,marginBottom:12,textTransform:"uppercase" }}>ZAFER</div>
          <div style={{ fontSize:13,fontWeight:700,color:"rgba(0,229,255,0.6)",fontFamily:warrior,letterSpacing:2,marginBottom:24 }}>{winner}</div>
          <div style={{ background:"rgba(0,229,255,0.07)",border:`2px solid rgba(0,229,255,0.2)`,borderRadius:14,padding:"16px 20px",marginBottom:16 }}>
            <div style={{ fontSize:11,fontWeight:700,color:t.textDim,fontFamily:mono,letterSpacing:3,marginBottom:6 }}>RÜTBEN BELİRLENDİ</div>
            <div style={{ fontSize:20,marginBottom:4 }}>🔰</div>
            <div style={{ fontSize:26,fontWeight:800,color:"#9ca3af",fontFamily:warrior,letterSpacing:4 }}>ER</div>
            <div style={{ display:"flex",alignItems:"center",justifyContent:"center",gap:8,marginTop:8 }}>
              <div style={{ fontSize:32,fontWeight:800,color:t.gold,fontFamily:warrior }}>{STARTING_GOLD}</div>
              <div style={{ fontSize:10,fontWeight:700,color:t.textDim,fontFamily:mono }}>ALTIN</div>
            </div>
          </div>
          <div style={{ background:"rgba(255,215,0,0.07)",border:`1px solid rgba(255,215,0,0.18)`,borderRadius:12,padding:"10px 16px",marginBottom:20 }}>
            <div style={{ fontSize:11,fontWeight:700,color:t.textDim,fontFamily:mono,letterSpacing:2 }}>İLK ÖDÜLÜN</div>
            <div style={{ fontSize:22,fontWeight:800,color:gold,fontFamily:warrior,textShadow:`0 0 15px ${goldGlow}`,marginTop:4 }}>500 <img src="/img/coin.png" alt="" style={{ width:18,height:18,verticalAlign:"middle",filter:"drop-shadow(0 1px 2px rgba(0,0,0,0.5))" }} /></div>
          </div>
          <button onClick={onDone} style={{ padding:"16px 36px",background:`linear-gradient(135deg,${t.accent},#0891b2)`,color:t.bg,border:"none",borderRadius:14,fontSize:16,fontWeight:800,letterSpacing:4,cursor:"pointer",fontFamily:warrior,boxShadow:`0 4px 30px ${accentGlow}` }}>SAVAŞA HAZIRIM</button>
        </div>
      </div>
    </div>
  );
}
function launchConfetti(canvasId, duration=3000) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  canvas.width = window.innerWidth; canvas.height = window.innerHeight;
  const particles = [];
  const colors = ['#ffd700','#00d4ff','#ff4757','#34d399','#a78bfa','#ff8c42','#fbbf24'];
  for (let i = 0; i < 120; i++) {
    particles.push({ x: Math.random()*canvas.width, y: canvas.height+10, vx: (Math.random()-0.5)*8, vy: -(Math.random()*16+8), size: Math.random()*6+3, color: colors[Math.floor(Math.random()*colors.length)], rotation: Math.random()*360, rotSpeed: (Math.random()-0.5)*12, gravity: 0.15+Math.random()*0.1, opacity: 1 });
  }
  const start = Date.now();
  function animate() {
    const elapsed = Date.now()-start;
    if (elapsed > duration) { ctx.clearRect(0,0,canvas.width,canvas.height); return; }
    ctx.clearRect(0,0,canvas.width,canvas.height);
    particles.forEach(p => {
      p.x+=p.vx; p.y+=p.vy; p.vy+=p.gravity; p.rotation+=p.rotSpeed;
      if (elapsed > duration*0.6) p.opacity = Math.max(0, 1-(elapsed-duration*0.6)/(duration*0.4));
      ctx.save(); ctx.translate(p.x,p.y); ctx.rotate(p.rotation*Math.PI/180); ctx.globalAlpha=p.opacity;
      ctx.fillStyle=p.color; ctx.fillRect(-p.size/2,-p.size/3,p.size,p.size/1.5); ctx.restore();
    });
    requestAnimationFrame(animate);
  }
  animate();
}

// === PATLAMA EFEKTİ ===
function launchExplosion(canvasId, x, y, duration=1200) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  canvas.width = window.innerWidth; canvas.height = window.innerHeight;
  const particles = [];
  const colors = ['#ff4757','#ff8c42','#ffd700','#ff6b6b','#e74c3c'];
  for (let i = 0; i < 40; i++) {
    const angle = (Math.PI*2/40)*i + (Math.random()-0.5)*0.5;
    const speed = Math.random()*6+2;
    particles.push({ x, y, vx: Math.cos(angle)*speed, vy: Math.sin(angle)*speed, size: Math.random()*4+2, color: colors[Math.floor(Math.random()*colors.length)], life: 1 });
  }
  const start = Date.now();
  function animate() {
    const elapsed = Date.now()-start;
    if (elapsed > duration) { ctx.clearRect(0,0,canvas.width,canvas.height); return; }
    ctx.clearRect(0,0,canvas.width,canvas.height);
    particles.forEach(p => {
      p.x+=p.vx; p.y+=p.vy; p.vx*=0.96; p.vy*=0.96; p.life=Math.max(0,1-elapsed/duration);
      ctx.globalAlpha=p.life; ctx.fillStyle=p.color; ctx.beginPath(); ctx.arc(p.x,p.y,p.size*p.life,0,Math.PI*2); ctx.fill();
    });
    requestAnimationFrame(animate);
  }
  animate();
}

// === GOLD COİN ANİMASYONU ===
function GoldCoinAnim({ amount, onDone }) {
  const [coins] = useState(() => Array.from({length: Math.min(amount > 100 ? 14 : amount > 20 ? 9 : 6, 16)}, (_,i) => ({
    id: i, delay: i*70, x: (Math.random()-0.5)*80, endY: -90-Math.random()*50, rotation: (Math.random()-0.5)*60
  })));
  useEffect(() => { const timer = setTimeout(()=>onDone?.(), coins.length*70+1400); return ()=>clearTimeout(timer); }, []);
  return (<div style={{ position:'fixed',bottom:100,left:'50%',transform:'translateX(-50%)',zIndex:10000,pointerEvents:'none' }}>
    {coins.map(c => (
      <div key={c.id} style={{ position:'absolute', left:c.x, bottom:0, fontSize:32, animation:`coinFly 1.1s cubic-bezier(0.25,0.46,0.45,0.94) ${c.delay}ms forwards`, opacity:0, transform:`rotate(${c.rotation}deg)` }}>🪙</div>
    ))}
    <div style={{ position:'absolute',left:'50%',transform:'translateX(-50%)',bottom:70,fontSize:28,fontWeight:900,color:t.gold,fontFamily:warrior,textShadow:`0 0 30px ${t.goldGlow}, 0 0 60px ${t.goldGlow}`,animation:'scaleUp 0.4s cubic-bezier(0.34,1.56,0.64,1) 150ms forwards',opacity:0,whiteSpace:'nowrap',letterSpacing:4 }}>+{amount} <img src="/img/coin.png" alt="" style={{ width:18,height:18,verticalAlign:"middle",filter:"drop-shadow(0 1px 2px rgba(0,0,0,0.5))" }} /></div>
  </div>);
}

// === RİPPLE BUTON ===
function RippleButton({ children, onClick, style, disabled, ...props }) {
  const [ripples, setRipples] = useState([]);
  const handleClick = (e) => {
    if (disabled) return;
    sfx.init(); sfx.play('click');
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left, y = e.clientY - rect.top;
    const id = Date.now();
    setRipples(prev => [...prev, { id, x, y }]);
    setTimeout(() => setRipples(prev => prev.filter(r => r.id !== id)), 600);
    onClick?.(e);
  };
  return (<button onClick={handleClick} disabled={disabled} style={{ ...style, position:'relative', overflow:'hidden' }} {...props}>
    {ripples.map(r => <span key={r.id} style={{ position:'absolute', left:r.x-20, top:r.y-20, width:40, height:40, borderRadius:'50%', background:'rgba(255,255,255,0.3)', animation:'rippleExpand 0.6s ease-out forwards', pointerEvents:'none' }} />)}
    {children}
  </button>);
}

// === MİKRO FEEDBACK ===
function MicroFeedback({ text, color, onDone }) {
  useEffect(() => { const tm = setTimeout(()=>onDone?.(), 2400); return ()=>clearTimeout(tm); }, []);
  const clr = color || t.gold;
  return (<div style={{ position:'fixed',top:'44%',left:'50%',zIndex:10001,fontSize:30,fontWeight:900,color:clr,fontFamily:warrior,letterSpacing:5,textTransform:'uppercase',whiteSpace:'nowrap',
    WebkitTextStroke:'1.5px rgba(0,0,0,0.85)',
    textShadow:`0 3px 0 rgba(0,0,0,0.9), 0 6px 0 rgba(0,0,0,0.55), 0 12px 24px rgba(0,0,0,0.9), 0 0 34px ${clr}, 0 0 90px ${clr}66`,
    animation:'arZoomText 2.4s ease-out forwards',pointerEvents:'none' }}>{text}</div>);
}

const ARENAS = [
  { id: "liman", name: "LİMAN", minGold: 0, entryFee: 50, winGold: 120, loseGold: 30, color: "#9ca3af", icon: "⚓" },
  { id: "kiyi", name: "KIYI", minGold: 1000, entryFee: 100, winGold: 250, loseGold: 50, color: "#60a5fa", icon: "🌊" },
  { id: "acikdeniz", name: "AÇIK DENİZ", minGold: 3000, entryFee: 200, winGold: 520, loseGold: 80, color: "#06b6d4", icon: "🚢" },
  { id: "firtina", name: "FIRTINA", minGold: 8000, entryFee: 500, winGold: 1300, loseGold: 150, color: "#a78bfa", icon: "⛈" },
  { id: "amiral", name: "AMİRAL", minGold: 20000, entryFee: 1000, winGold: 2700, loseGold: 250, color: "#fbbf24", icon: "👑" },
];
const STARTING_GOLD = 500;

function safeGold(val) {
  if (typeof val === "number" && !isNaN(val) && isFinite(val)) return Math.max(0, Math.floor(val));
  return isTestMode() ? 5000 : STARTING_GOLD;
}

const QUICK_EMOJIS = [
  { id: "niceshot", emoji: "🎯", label: "İyi atış!" },
  { id: "fire", emoji: "🔥", label: "Yanıyorsun!" },
  { id: "gg", emoji: "👏", label: "Tebrikler" },
  { id: "oops", emoji: "😤", label: "Eyvah!" },
  { id: "salute", emoji: "🙏", label: "Saygılar" },
  { id: "skull", emoji: "💀", label: "Battın!" },
  { id: "hurry", emoji: "⏳", label: "Acele et!" },
  { id: "lucky", emoji: "🍀", label: "Şanslısın" },
];

function calculateDailyReward(streak) {
  const base = 50, max = 200;
  let multiplier = streak >= 7 ? 2 : streak >= 3 ? 1.5 : streak >= 2 ? 1.25 : 1;
  return Math.floor((base + Math.floor(Math.random() * (max - base))) * multiplier);
}
function isSameDay(ts1, ts2) { const d1 = new Date(ts1), d2 = new Date(ts2); return d1.getFullYear() === d2.getFullYear() && d1.getMonth() === d2.getMonth() && d1.getDate() === d2.getDate(); }
function isConsecutiveDay(lastTs, nowTs) { const l = new Date(lastTs), n = new Date(nowTs); return (new Date(n.getFullYear(),n.getMonth(),n.getDate()) - new Date(l.getFullYear(),l.getMonth(),l.getDate())) / 864e5 === 1; }

async function checkDailyReward(uid) {
  const profileRef = ref(db, `profiles/${uid}`);
  const snap = await get(profileRef);
  if (!snap.exists()) return null;
  const profile = snap.val();
  const now = Date.now();
  // Günlük max 3 ödül
  const sameDay = profile.lastDailyReward && isSameDay(profile.lastDailyReward, now);
  const todayCount = sameDay ? (profile.dailyRewardCount || 1) : 0;
  if (todayCount >= 3) return null;
  let streak = sameDay ? (profile.loginStreak || 1) : ((profile.lastDailyReward && isConsecutiveDay(profile.lastDailyReward, now)) ? (profile.loginStreak || 0) + 1 : 1);
  const reward = calculateDailyReward(streak);
  const newGold = safeGold(profile.gold) + reward;
  // Use set() with full clean profile to avoid NaN contamination from other fields
  const cleanProfile = {
    displayName: profile.displayName || "Denizci",
    wins: (typeof profile.wins === "number" && !isNaN(profile.wins) && isFinite(profile.wins)) ? profile.wins : 0,
    losses: (typeof profile.losses === "number" && !isNaN(profile.losses) && isFinite(profile.losses)) ? profile.losses : 0,
    totalGames: (typeof profile.totalGames === "number" && !isNaN(profile.totalGames) && isFinite(profile.totalGames)) ? profile.totalGames : 0,
    gold: newGold,
    level: (typeof profile.level === "number" && isFinite(profile.level)) ? profile.level : 0,
    levelProgress: (typeof profile.levelProgress === "number" && isFinite(profile.levelProgress)) ? profile.levelProgress : 0,
    loginStreak: streak,
    lastDailyReward: now,
    createdAt: profile.createdAt || Date.now(),
    lastGameAt: profile.lastGameAt || null,
    onboardingDone: profile.onboardingDone === true,
    nameSetAt: profile.nameSetAt || null,
    avatar: profile.avatar || "⚓",
    dailyRewardCount: todayCount + 1,
  };
  await set(profileRef, cleanProfile);
  return { reward, streak, newGold };
}

function DailyRewardPopup({ reward, streak, onClose }) {
  return (<div style={{ position:"fixed",inset:0,background:"radial-gradient(ellipse at 50% 40%, rgba(255,215,0,0.10) 0%, rgba(167,139,250,0.06) 35%, rgba(0,0,0,0.88) 75%)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:9999,backdropFilter:"blur(6px)",overflow:"hidden" }} onClick={onClose}>
    {/* Dönen ışık huzmeleri — oksipital uyarım */}
    <div style={{ position:"absolute",width:900,height:900,top:"50%",left:"50%",transform:"translate(-50%,-50%)",background:"conic-gradient(from 0deg, transparent 0deg, rgba(255,215,0,0.10) 12deg, transparent 24deg, transparent 40deg, rgba(0,229,255,0.08) 52deg, transparent 64deg, transparent 90deg, rgba(255,105,180,0.07) 102deg, transparent 114deg, transparent 140deg, rgba(255,215,0,0.10) 152deg, transparent 164deg, transparent 190deg, rgba(167,139,250,0.08) 202deg, transparent 214deg, transparent 250deg, rgba(255,215,0,0.09) 262deg, transparent 274deg, transparent 310deg, rgba(0,229,255,0.07) 322deg, transparent 334deg)",animation:"raysSpin 22s linear infinite",pointerEvents:"none" }} />
    {/* Süzülen paralar */}
    {[...Array(8)].map((_,i)=>(<div key={i} style={{ position:"absolute",fontSize:16+((i*7)%14),left:`${8+i*11.5}%`,top:`${72+((i*13)%18)}%`,opacity:0.5,animation:`coinRise ${5+(i%4)}s ease-in ${i*0.7}s infinite`,pointerEvents:"none",filter:"drop-shadow(0 0 8px rgba(255,215,0,0.6))" }}>{i%3===0?"💰":i%3===1?"🪙":"✨"}</div>))}
    <div onClick={e=>e.stopPropagation()} style={{ position:"relative",background:"linear-gradient(160deg, rgba(20,26,52,0.99) 0%, rgba(10,16,32,0.99) 60%, rgba(30,20,8,0.99) 100%)",border:"2px solid rgba(255,215,0,0.6)",outline:"1px solid rgba(0,229,255,0.25)",outlineOffset:5,borderRadius:22,padding:"38px 42px",textAlign:"center",maxWidth:350,width:"90%",boxShadow:"0 0 100px rgba(255,215,0,0.35), 0 0 200px rgba(167,139,250,0.15), 0 24px 70px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,215,0,0.2)",animation:"chestBounceIn 0.7s cubic-bezier(0.34,1.56,0.64,1)",overflow:"hidden" }}>
      {/* Parlama süpürmesi */}
      <div style={{ position:"absolute",top:0,left:"-60%",width:"45%",height:"100%",background:"linear-gradient(105deg, transparent, rgba(255,255,255,0.10), transparent)",animation:"shineSweep 3s ease-in-out 0.8s infinite",pointerEvents:"none" }} />
      <div style={{ fontSize:64,marginBottom:10,animation:"chestWiggle 2.2s ease-in-out infinite",filter:"drop-shadow(0 6px 14px rgba(0,0,0,0.6)) drop-shadow(0 0 30px rgba(255,215,0,0.5))" }}>🎁</div>
      <div style={{ fontSize:11,fontWeight:700,color:"rgba(255,215,0,0.6)",fontFamily:mono,letterSpacing:5,marginBottom:8 }}>GÜNLÜK GİRİŞ ÖDÜLÜ</div>
      <div style={{ fontSize:50,fontWeight:900,fontFamily:warrior,marginBottom:12,letterSpacing:2,background:"linear-gradient(180deg, #fff7d6 0%, #ffd700 45%, #d97706 100%)",WebkitBackgroundClip:"text",WebkitTextFillColor:"transparent",filter:"drop-shadow(0 0 25px rgba(255,215,0,0.7)) drop-shadow(0 3px 4px rgba(0,0,0,0.8))",animation:"rewardPulse 1.6s ease-in-out infinite" }}>+{reward} <img src="/img/coin.png" alt="" style={{ width:18,height:18,verticalAlign:"middle",filter:"drop-shadow(0 1px 2px rgba(0,0,0,0.5))" }} /></div>
      {streak > 1 && <div style={{ fontSize:13,fontWeight:800,color:"#ff9f43",fontFamily:warrior,marginBottom:12,padding:"7px 18px",background:"linear-gradient(135deg, rgba(255,105,60,0.14), rgba(255,215,0,0.10))",borderRadius:10,border:"1px solid rgba(255,159,67,0.35)",display:"inline-block",letterSpacing:2,textShadow:"0 0 12px rgba(255,159,67,0.5)" }}>🔥 {streak} GÜN SERİ {streak>=7?"• x2 BONUS":streak>=3?"• x1.5 BONUS":streak>=2?"• x1.25 BONUS":""}</div>}
      <div><button onClick={onClose} style={{ marginTop:12,padding:"16px 52px",background:"linear-gradient(135deg, #ffd700 0%, #ff9f43 55%, #d97706 100%)",color:"#1a1206",border:"none",borderRadius:12,fontSize:17,fontWeight:900,letterSpacing:5,cursor:"pointer",fontFamily:warrior,boxShadow:"0 0 40px rgba(255,215,0,0.5), 0 6px 24px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.4)",animation:"btnBreath 1.8s ease-in-out infinite",textTransform:"uppercase" }}>TOPLA</button></div>
    </div>
  </div>);
}

function ArenaSelect({ myGold, onSelect, onBack }) {
  return (<div style={{ display:"flex",flexDirection:"column",alignItems:"center",minHeight:"100vh",minHeight:"100dvh",background:`linear-gradient(180deg, ${t.bg} 0%, #071428 100%)`,padding:"24px 14px",fontFamily:mono,color:t.text }}>
    <div style={{ fontSize:26,fontWeight:800,letterSpacing:6,color:t.accent,marginBottom:6,fontFamily:warrior,textShadow:`0 0 25px ${t.accentGlow}` }}>ARENA SEÇ</div>
    <div style={{ fontSize:14,fontWeight:800,color:t.gold,fontFamily:warrior,marginBottom:20,padding:"6px 20px",background:"rgba(255,215,0,0.08)",borderRadius:10,border:"1px solid rgba(255,215,0,0.2)",letterSpacing:2 }}><img src="/img/coin.png" alt="" style={{ width:18,height:18,verticalAlign:"middle",filter:"drop-shadow(0 1px 2px rgba(0,0,0,0.5))" }} /> {myGold} ALTIN</div>
    <div style={{ width:"100%",maxWidth:420,display:"flex",flexDirection:"column",gap:10 }}>
      {ARENAS.map(arena => {
        const locked = (myGold||0) < arena.minGold, cantAfford = (myGold||0) < arena.entryFee, disabled = locked||cantAfford;
        return (<button key={arena.id} onClick={()=>!disabled&&onSelect(arena)} disabled={disabled} style={{ display:"flex",alignItems:"center",gap:16,padding:"18px 20px",background:disabled?"rgba(22,32,64,0.5)":`linear-gradient(145deg, rgba(12,21,41,0.95), rgba(8,14,30,0.98))`,border:`2px solid ${disabled?"rgba(30,58,95,0.3)":arena.color}`,borderRadius:14,cursor:disabled?"not-allowed":"pointer",opacity:disabled?0.45:1,textAlign:"left",width:"100%",boxShadow:disabled?"none":`0 0 20px ${arena.color}22, 0 4px 20px rgba(0,0,0,0.3)`,transition:"all 0.2s ease" }}>
          <div style={{ fontSize:32,width:48,height:48,display:"flex",alignItems:"center",justifyContent:"center",background:`${arena.color}15`,borderRadius:12,border:`1px solid ${arena.color}33` }}>{arena.icon}</div>
          <div style={{ flex:1 }}><div style={{ fontSize:16,fontWeight:800,color:arena.color,fontFamily:warrior,letterSpacing:4 }}>{arena.name}</div><div style={{ fontSize:10,fontWeight:700,color:t.textDim,marginTop:3,fontFamily:mono }}>{locked?`🔒 ${arena.minGold} ALTIN GEREKLİ`:`Min: ${arena.minGold} 💰`}</div></div>
          <div style={{ textAlign:"right" }}><div style={{ fontSize:16,fontWeight:800,color:cantAfford?t.hit:t.gold,fontFamily:warrior }}>{arena.entryFee} <img src="/img/coin.png" alt="" style={{ width:18,height:18,verticalAlign:"middle",filter:"drop-shadow(0 1px 2px rgba(0,0,0,0.5))" }} /></div><div style={{ fontSize:9,color:t.textDim,fontWeight:700,letterSpacing:1 }}>GİRİŞ</div><div style={{ fontSize:12,fontWeight:800,color:"#4ade80",fontFamily:warrior,marginTop:3 }}>🏆 {arena.winGold} <img src="/img/coin.png" alt="" style={{ width:18,height:18,verticalAlign:"middle",filter:"drop-shadow(0 1px 2px rgba(0,0,0,0.5))" }} /></div></div>
        </button>);
      })}
    </div>
    <button onClick={onBack} style={{ marginTop:24,padding:"14px 36px",background:`linear-gradient(135deg,${t.accent},#0891b2)`,color:t.bg,border:"none",borderRadius:10,fontSize:14,fontWeight:800,letterSpacing:3,cursor:"pointer",fontFamily:warrior,textTransform:"uppercase",boxShadow:`0 4px 20px ${t.accentGlow}` }}>GERİ DÖN</button>
  </div>);
}

function EmojiDisplay({ emoji, label }) {
  if (!emoji) return null;
  return (<div style={{ fontSize:9,color:t.textDim,marginTop:2,display:"flex",alignItems:"center",gap:4,justifyContent:"center",animation:"fadeUp 0.3s ease-out" }}>
    <span style={{ fontSize:16 }}>{emoji}</span>
    <span style={{ fontFamily:"'Barlow Condensed',sans-serif",letterSpacing:1 }}>{label}</span>
  </div>);
}

async function ensureProfile(uid, displayName) {
  const profileRef = ref(db, `profiles/${uid}`);
  const snap = await get(profileRef);
  if (!snap.exists()) {
    const startGold = isTestMode() ? 5000 : STARTING_GOLD;
    const profile = { displayName: displayName||"Denizci", wins:0, losses:0, totalGames:0, gold:startGold, level:0, levelProgress:0, loginStreak:0, lastDailyReward:null, createdAt:Date.now(), lastGameAt:null, onboardingDone:false };
    await set(profileRef, profile);
    return profile;
  }
  const existing = snap.val();
  // ALWAYS build a clean profile — never trust existing data
  const sanitized = {
    displayName: (displayName && displayName.trim()) || existing.displayName || "Denizci",
    wins: (typeof existing.wins === "number" && !isNaN(existing.wins) && isFinite(existing.wins)) ? existing.wins : 0,
    losses: (typeof existing.losses === "number" && !isNaN(existing.losses) && isFinite(existing.losses)) ? existing.losses : 0,
    totalGames: (typeof existing.totalGames === "number" && !isNaN(existing.totalGames) && isFinite(existing.totalGames)) ? existing.totalGames : 0,
    gold: safeGold(existing.gold),
    level: (typeof existing.level === "number" && !isNaN(existing.level) && isFinite(existing.level)) ? existing.level : 0,
    levelProgress: (typeof existing.levelProgress === "number" && !isNaN(existing.levelProgress) && isFinite(existing.levelProgress)) ? existing.levelProgress : 0,
    loginStreak: (typeof existing.loginStreak === "number" && !isNaN(existing.loginStreak) && isFinite(existing.loginStreak)) ? existing.loginStreak : 0,
    lastDailyReward: existing.lastDailyReward || null,
    createdAt: existing.createdAt || Date.now(),
    lastGameAt: existing.lastGameAt || null,
    onboardingDone: existing.onboardingDone === true,
    nameSetAt: existing.nameSetAt || null,
    avatar: existing.avatar || "⚓",
    dailyRewardCount: (typeof existing.dailyRewardCount === "number" && isFinite(existing.dailyRewardCount)) ? existing.dailyRewardCount : 0,
  };
  // ALWAYS overwrite with set() — kills any hidden NaN in any field
  await set(profileRef, sanitized);
  return sanitized;
}



async function updateEloAfterGame(winnerUid, loserUid, arena) {
  const winnerSnap = await get(ref(db, `profiles/${winnerUid}`));
  const loserSnap = await get(ref(db, `profiles/${loserUid}`));
  if (!winnerSnap.exists() || !loserSnap.exists()) return;
  const wd = winnerSnap.val(), ld = loserSnap.val();
  const now = Date.now(), winGold = arena?arena.winGold:100, loseGold = arena?arena.loseGold:20;
  const wOldGold = safeGold(wd.gold), lOldGold = safeGold(ld.gold);
  const wNewGold = wOldGold + winGold, lNewGold = lOldGold + loseGold;
  // Full clean profiles with set() — no NaN can survive
  const wLevel = applyLevelCredit(wd, XP_ONLINE_WIN);
  const lLevel = applyLevelCredit(ld, XP_ONLINE_LOSS);
  const winnerProfile = {
    displayName: wd.displayName || "Denizci",
    wins: ((typeof wd.wins === "number" && !isNaN(wd.wins)) ? wd.wins : 0) + 1,
    losses: (typeof wd.losses === "number" && !isNaN(wd.losses)) ? wd.losses : 0,
    totalGames: ((typeof wd.totalGames === "number" && !isNaN(wd.totalGames)) ? wd.totalGames : 0) + 1,
    gold: wNewGold,
    level: wLevel.level, levelProgress: wLevel.levelProgress,
    loginStreak: (typeof wd.loginStreak === "number" && !isNaN(wd.loginStreak)) ? wd.loginStreak : 0,
    lastDailyReward: wd.lastDailyReward || null, createdAt: wd.createdAt || now, lastGameAt: now,
    onboardingDone: wd.onboardingDone === true, nameSetAt: wd.nameSetAt || null, avatar: wd.avatar || "⚓", dailyRewardCount: wd.dailyRewardCount || 0,
  };
  const loserProfile = {
    displayName: ld.displayName || "Denizci",
    wins: (typeof ld.wins === "number" && !isNaN(ld.wins)) ? ld.wins : 0,
    losses: ((typeof ld.losses === "number" && !isNaN(ld.losses)) ? ld.losses : 0) + 1,
    totalGames: ((typeof ld.totalGames === "number" && !isNaN(ld.totalGames)) ? ld.totalGames : 0) + 1,
    gold: lNewGold,
    level: lLevel.level, levelProgress: lLevel.levelProgress,
    loginStreak: (typeof ld.loginStreak === "number" && !isNaN(ld.loginStreak)) ? ld.loginStreak : 0,
    lastDailyReward: ld.lastDailyReward || null, createdAt: ld.createdAt || now, lastGameAt: now,
    onboardingDone: ld.onboardingDone === true, nameSetAt: ld.nameSetAt || null, avatar: ld.avatar || "⚓", dailyRewardCount: ld.dailyRewardCount || 0,
  };
  await set(ref(db, `profiles/${winnerUid}`), winnerProfile);
  await set(ref(db, `profiles/${loserUid}`), loserProfile);
  return { winnerOldGold:wOldGold, winnerNewGold:wNewGold, loserOldGold:lOldGold, loserNewGold:lNewGold, winGold, loseGold, winnerLevel: wLevel.level, winnerLevelProgress: wLevel.levelProgress, loserLevel: lLevel.level, loserLevelProgress: lLevel.levelProgress };
}

async function fetchLeaderboard(sortBy='gold', count=15) {
  const snap = await get(ref(db, "profiles"));
  if (!snap.exists()) return [];
  const profiles = [];
  snap.forEach(child => {
    const v = child.val();
    profiles.push({
      uid: child.key,
      displayName: v.displayName || "Denizci",
      wins: (typeof v.wins === "number" && !isNaN(v.wins)) ? v.wins : 0,
      losses: (typeof v.losses === "number" && !isNaN(v.losses)) ? v.losses : 0,
      totalGames: (typeof v.totalGames === "number" && !isNaN(v.totalGames)) ? v.totalGames : 0,
      gold: (typeof v.gold === "number" && !isNaN(v.gold) && isFinite(v.gold)) ? Math.max(0, Math.floor(v.gold)) : 0,
    });
  });
  if (sortBy === 'wins') profiles.sort((a,b) => b.wins - a.wins);
  else profiles.sort((a,b) => b.gold - a.gold);
  return profiles.slice(0, count);
}

function Leaderboard({ onBack, myUid }) {
  const [sortBy, setSortBy] = useState('gold');
  const [players, setPlayers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [revealed, setRevealed] = useState(0);
  useEffect(() => {
    setLoading(true); setRevealed(0);
    setLoading(true);
    // Canlı sıralama — profiller değişince anında güncellenir
    const unsub = onValue(ref(db, "profiles"), (snap) => {
      if (!snap.exists()) { setPlayers([]); setLoading(false); return; }
      const list = [];
      snap.forEach(child => { const v = child.val(); list.push({ uid: child.key, ...v }); });
      list.sort((a, b) => sortBy === 'wins' ? ((b.wins||0) - (a.wins||0)) : (safeGold(b.gold) - safeGold(a.gold)));
      setPlayers(list.slice(0, 15));
      setLoading(false);
    });
    return () => unsub();
  }, [sortBy]);
  useEffect(() => {
    if (!loading && players.length > 0) {
      const timers = players.map((_,i) => setTimeout(() => setRevealed(i+1), 100+i*80));
      return () => timers.forEach(clearTimeout);
    }
  }, [loading, players.length]);
  const myIdx = players.findIndex(p => p.uid === myUid);
  const getMotivation = () => {
    if (myIdx === 0) return "👑 Denizlerin hakimisin!";
    if (myIdx > 0 && myIdx < 3) return "🔥 Zirveye çok yakınsın!";
    if (myIdx >= 3 && myIdx < 10) return "⚡ TOP 10'dasın, devam et!";
    return "⚓ Sıralamaya girmek için savaş!";
  };
  const tabs = [
    { key:'gold', label:'ALTIN', icon:'🪙' },
    { key:'wins', label:'GALİBİYET', icon:'🏆' },
  ];
  return (<div style={{ display:"flex",flexDirection:"column",alignItems:"center",minHeight:"100vh",minHeight:"100dvh",background:`linear-gradient(180deg, ${t.bg} 0%, #071428 50%, rgba(255,215,0,0.02) 100%)`,padding:"20px 12px",fontFamily:mono,color:t.text }}>
    <div style={{ fontSize:30,fontWeight:900,letterSpacing:8,color:t.gold,marginBottom:2,fontFamily:warrior,textShadow:`0 0 30px ${t.goldGlow}`,animation:"fadeUp 0.4s ease-out" }}>SIRALAMA</div>
    {!loading && myIdx >= 0 && <div style={{ padding:"6px 18px",background:"rgba(0,229,255,0.06)",border:`1px solid rgba(0,229,255,0.15)`,borderRadius:10,marginBottom:10,animation:"fadeUp 0.6s ease-out" }}>
      <div style={{ fontSize:12,fontWeight:800,color:t.accent,fontFamily:warrior,letterSpacing:2,textAlign:"center" }}>{getMotivation()}</div>
    </div>}
    {/* Sort tabs */}
    <div style={{ display:"flex",gap:4,marginBottom:14,background:t.surface,borderRadius:12,padding:4,border:`1px solid ${t.border}` }}>
      {tabs.map(tab => (
        <button key={tab.key} onClick={()=>setSortBy(tab.key)} style={{ padding:"8px 14px",background:sortBy===tab.key?`linear-gradient(135deg,${t.accent},#0891b2)`:"transparent",color:sortBy===tab.key?t.bg:t.textDim,border:"none",borderRadius:8,fontSize:11,fontWeight:800,cursor:"pointer",fontFamily:warrior,letterSpacing:2,transition:"all 0.2s" }}>{tab.icon} {tab.label}</button>
      ))}
    </div>
    {loading ? <div style={{ color:t.textDim,fontSize:14,marginTop:40,fontFamily:warrior,letterSpacing:3,animation:"pulse 1.5s infinite" }}>Yükleniyor...</div> : players.length===0 ? <div style={{ color:t.textDim,fontSize:14,marginTop:40,fontFamily:warrior }}>Henüz oyuncu yok</div> : (
      <div style={{ width:"100%",maxWidth:440,display:"flex",flexDirection:"column",gap:6 }}>
        {players.slice(0,15).map((p,i) => {
          if (i >= revealed) return null;
          const rank = getRankInfo(p.gold||0), isMe = p.uid===myUid;
          const winRate = p.totalGames>0?Math.round((p.wins/p.totalGames)*100):0;
          const medalColors = [["#ffd700","rgba(255,215,0,0.18)","rgba(255,215,0,0.4)"],["#c0c0c0","rgba(192,192,192,0.12)","rgba(192,192,192,0.3)"],["#cd7f32","rgba(205,127,50,0.12)","rgba(205,127,50,0.3)"]];
          const isMedal = i < 3;
          return (<div key={p.uid} style={{ display:"flex",alignItems:"center",gap:10,padding:isMedal?"12px 14px":"10px 12px",background:isMe?"rgba(0,229,255,0.1)":isMedal?medalColors[i][1]:"rgba(12,21,41,0.8)",border:`2px solid ${isMe?"rgba(0,229,255,0.4)":isMedal?medalColors[i][2]:"rgba(30,58,95,0.3)"}`,borderRadius:12,animation:`arSlideIn 0.4s ease-out ${i*0.06}s both` }}>
            {/* Rank badge */}
            <div style={{ width:36,height:36,borderRadius:10,display:"flex",alignItems:"center",justifyContent:"center",fontSize:isMedal?20:13,fontWeight:800,background:isMedal?medalColors[i][1]:"rgba(255,255,255,0.04)",color:isMedal?medalColors[i][0]:t.textDim,fontFamily:warrior,border:`2px solid ${isMedal?medalColors[i][2]:"rgba(255,255,255,0.06)"}`,flexShrink:0 }}>{i<3?["🥇","🥈","🥉"][i]:i+1}</div>
            {/* Name + rank */}
            <div style={{ flex:1,minWidth:0 }}>
              <div style={{ display:"flex",alignItems:"center",gap:5 }}>
                <span style={{ fontSize:14,fontWeight:800,color:isMe?t.accent:t.text,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",fontFamily:warrior,letterSpacing:1 }}>{p.displayName}</span>
                <span style={{ fontSize:9,fontWeight:800,color:rank.color,fontFamily:warrior }}>{rank.icon} {rank.title}</span>
              </div>
              <div style={{ fontSize:9,color:t.textDim,marginTop:2,fontFamily:mono,display:"flex",gap:8 }}>
                <span style={{ color:"#4ade80" }}>⚓ {p.wins||0}G</span>
                <span style={{ color:t.hit }}>✕ {p.losses||0}M</span>
                <span>%{winRate}</span>
                <span style={{ color:t.gold }}>🪙 {p.gold||0}</span>
              </div>
            </div>
            {/* Primary sort value */}
            <div style={{ textAlign:"right",flexShrink:0 }}>
              {sortBy==='wins' && <><div style={{ fontSize:22,fontWeight:900,color:"#4ade80",fontFamily:warrior }}>{p.wins||0}</div><div style={{ fontSize:8,color:t.textDim,letterSpacing:2,fontWeight:700 }}>GALİBİYET</div></>}
              {sortBy==='gold' && <><div style={{ fontSize:22,fontWeight:900,color:t.gold,fontFamily:warrior,textShadow:`0 0 10px ${t.goldGlow}` }}>{p.gold||0}</div><div style={{ fontSize:8,color:t.textDim,letterSpacing:2,fontWeight:700 }}>ALTIN</div></>}
            </div>
          </div>);
        })}
      </div>
    )}
    <button onClick={onBack} style={{ marginTop:20,padding:"14px 40px",background:`linear-gradient(135deg,${t.accent},#0891b2)`,color:t.bg,border:"none",borderRadius:12,fontSize:15,fontWeight:800,letterSpacing:4,cursor:"pointer",fontFamily:warrior,boxShadow:`0 4px 20px ${t.accentGlow}` }}>GERİ DÖN</button>
  </div>);
}

const ANIMS = `
@import url('https://fonts.googleapis.com/css2?family=Barlow+Condensed:ital,wght@0,400;0,600;0,700;0,800;0,900;1,700;1,800&family=Space+Mono:wght@400;700&display=swap');
.ab-cell{transition:transform 0.15s cubic-bezier(0.34,1.56,0.64,1), filter 0.15s ease, box-shadow 0.15s ease;}
@media (hover:hover){ .ab-cell:hover{transform:scale(1.12);filter:brightness(1.25);z-index:5;box-shadow:0 0 10px rgba(0,229,255,0.5);} }
.ab-cell:active{transform:scale(0.92);filter:brightness(1.15);}
@keyframes blink3s{0%,100%{opacity:1}50%{opacity:.15}}
@keyframes pulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.4;transform:scale(.8)}}
@keyframes borderGlow{0%,100%{border-color:#00d4ff;box-shadow:0 0 8px rgba(0,212,255,.4)}50%{border-color:#38f0ff;box-shadow:0 0 24px rgba(0,212,255,.7)}}
@keyframes popIn{0%{transform:scale(0)}60%{transform:scale(1.15)}100%{transform:scale(1)}}
@keyframes fadeUp{0%{opacity:0;transform:translateY(10px)}100%{opacity:1;transform:translateY(0)}}
@keyframes slideIn{0%{opacity:0;transform:translateY(-20px)}100%{opacity:1;transform:translateY(0)}}
@keyframes loadDots{0%,80%,100%{opacity:.3}40%{opacity:1}}
@keyframes victoryGlow{0%{text-shadow:0 0 20px rgba(0,212,255,.5)}50%{text-shadow:0 0 60px rgba(0,212,255,1),0 0 100px rgba(0,212,255,.5)}100%{text-shadow:0 0 20px rgba(0,212,255,.5)}}
@keyframes defeatShake{0%,100%{transform:translateX(0)}10%,30%,50%,70%,90%{transform:translateX(-4px)}20%,40%,60%,80%{transform:translateX(4px)}}
@keyframes scaleUp{0%{transform:scale(0.3);opacity:0}100%{transform:scale(1);opacity:1}}
@keyframes shimmer{0%{background-position:-200% 0}100%{background-position:200% 0}}
@keyframes cellHover{0%{box-shadow:inset 0 0 0 rgba(0,212,255,0)}100%{box-shadow:inset 0 0 14px rgba(0,212,255,.5)}}
@keyframes wave{0%{transform:translateX(0)}100%{transform:translateX(-50%)}}
@keyframes float{0%,100%{transform:translateY(0)}50%{transform:translateY(-6px)}}
@keyframes goldShine{0%{filter:brightness(1)}50%{filter:brightness(1.4)}100%{filter:brightness(1)}}
@keyframes coinFly{0%{opacity:1;transform:translateY(0) scale(1)}50%{opacity:1;transform:translateY(-60px) scale(1.2)}100%{opacity:0;transform:translateY(-120px) scale(0.5)}}
@keyframes rippleExpand{0%{transform:scale(0);opacity:0.6}100%{transform:scale(4);opacity:0}}
@keyframes microFloat{0%{opacity:1;transform:translateX(-50%) translateY(0) scale(1)}100%{opacity:0;transform:translateX(-50%) translateY(-40px) scale(1.3)}}
@keyframes rankGlow{0%,100%{box-shadow:0 0 8px var(--rank-color,rgba(0,212,255,0.3))}50%{box-shadow:0 0 24px var(--rank-color,rgba(0,212,255,0.6)),0 0 48px var(--rank-color,rgba(0,212,255,0.2))}}
@keyframes coinSpin{0%{transform:rotateY(0deg)}100%{transform:rotateY(360deg)}}
@keyframes flyToProfile{0%{opacity:1;transform:translate(0,0) scale(1)}100%{opacity:0;transform:translate(var(--fly-x,0px),var(--fly-y,-200px)) scale(0.3)}}
@keyframes arSlideIn{0%{opacity:0;transform:perspective(800px) rotateX(25deg) translateY(80px) scale(0.7)}40%{opacity:1;transform:perspective(800px) rotateX(-5deg) translateY(-10px) scale(1.05)}70%{transform:perspective(800px) rotateX(2deg) translateY(5px) scale(0.98)}100%{transform:perspective(800px) rotateX(0deg) translateY(0) scale(1)}}
@keyframes arGlow{0%,100%{box-shadow:0 10px 40px rgba(0,0,0,0.5),0 0 30px var(--ar-color,rgba(0,229,255,0.3))}50%{box-shadow:0 15px 60px rgba(0,0,0,0.6),0 0 50px var(--ar-color,rgba(0,229,255,0.5))}}
@keyframes previewZoom{0%{opacity:0;transform:scale(0.5) perspective(600px) rotateY(15deg)}50%{opacity:1;transform:scale(1.08) perspective(600px) rotateY(-3deg)}100%{transform:scale(1) perspective(600px) rotateY(0deg)}}
@keyframes coinSpinY{0%,100%{transform:rotateY(0deg)}50%{transform:rotateY(180deg)}}
@keyframes explodeCore{0%,100%{opacity:0.9;transform:scale(1)}50%{opacity:1;transform:scale(1.06)}}
@keyframes explodeWave{0%{opacity:0.7;transform:scale(0.6)}70%{opacity:0.15;transform:scale(1.25)}100%{opacity:0;transform:scale(1.4)}}
@keyframes scanline{0%{top:-2px}100%{top:100vh}}
@keyframes flameFlicker{0%,100%{transform:scale(1) rotate(-3deg);opacity:0.85}25%{transform:scale(1.15) rotate(4deg);opacity:1}50%{transform:scale(0.92) rotate(-5deg);opacity:0.8}75%{transform:scale(1.08) rotate(3deg);opacity:0.95}}
@keyframes turnPulse{0%,100%{box-shadow:0 0 12px rgba(0,229,255,0.4), inset 0 0 8px rgba(0,229,255,0.1)}50%{box-shadow:0 0 30px rgba(0,229,255,0.8), inset 0 0 16px rgba(0,229,255,0.25)}}
@keyframes emojiFly3d{0%{opacity:0;transform:translate(-50%,-50%) scale(0.2) rotateY(120deg) rotateZ(-20deg)}18%{opacity:1;transform:translate(-50%,-50%) scale(1.5) rotateY(-12deg) rotateZ(6deg)}30%{transform:translate(-50%,-50%) scale(1.15) rotateY(0deg) rotateZ(0deg)}75%{opacity:1;transform:translate(-50%,-50%) scale(1.15)}100%{opacity:0;transform:translate(-50%,-58%) scale(0.85)}}
@keyframes raysSpin{from{transform:translate(-50%,-50%) rotate(0deg)}to{transform:translate(-50%,-50%) rotate(360deg)}}
@keyframes coinRise{0%{transform:translateY(0) rotate(0deg);opacity:0}12%{opacity:0.55}85%{opacity:0.35}100%{transform:translateY(-64vh) rotate(340deg);opacity:0}}
@keyframes chestBounceIn{0%{opacity:0;transform:scale(0.4) translateY(60px)}60%{opacity:1;transform:scale(1.06) translateY(-8px)}100%{opacity:1;transform:scale(1) translateY(0)}}
@keyframes chestWiggle{0%,100%{transform:rotate(0deg) scale(1)}8%{transform:rotate(-7deg) scale(1.05)}16%{transform:rotate(6deg) scale(1.05)}24%{transform:rotate(-4deg)}32%{transform:rotate(0deg) scale(1)}}
@keyframes shineSweep{0%{left:-60%}55%{left:120%}100%{left:120%}}
@keyframes rewardPulse{0%,100%{transform:scale(1)}50%{transform:scale(1.06)}}
@keyframes btnBreath{0%,100%{transform:scale(1)}50%{transform:scale(1.045)}}
@keyframes sonarArc{0%,100%{opacity:0.35;transform:scale(1)}50%{opacity:1;transform:scale(1.18)}}
@keyframes arZoomText{0%{opacity:0;transform:translateX(-50%) scale(0.2)}8%{opacity:1;transform:translateX(-50%) scale(1.05)}12%{transform:translateX(-50%) scale(1)}70%{opacity:1;transform:translateX(-50%) scale(1)}100%{opacity:0;transform:translateX(-50%) translateY(-40px) scale(2.6);filter:blur(3px)}}
@keyframes popFlash{0%{opacity:0;transform:translateX(-50%) scale(0.1) rotate(-8deg)}22%{opacity:1;transform:translateX(-50%) scale(1.45) rotate(4deg)}38%{transform:translateX(-50%) scale(1.05) rotate(0deg)}72%{opacity:1;transform:translateX(-50%) scale(1.05)}100%{opacity:0;transform:translateX(-50%) scale(0.7) translateY(-16px)}}
@keyframes fbPop3d{0%{opacity:0;transform:translateX(-50%) scale(0.3) perspective(500px) rotateX(40deg)}12%{opacity:1;transform:translateX(-50%) scale(1.25) perspective(500px) rotateX(-6deg)}22%{transform:translateX(-50%) scale(1) perspective(500px) rotateX(0deg)}78%{opacity:1;transform:translateX(-50%) scale(1) translateY(0)}100%{opacity:0;transform:translateX(-50%) scale(0.92) translateY(-30px)}}
@keyframes floatShadow{0%,100%{transform:translateY(0);filter:drop-shadow(0 8px 20px rgba(0,0,0,0.4))}50%{transform:translateY(-8px);filter:drop-shadow(0 16px 30px rgba(0,0,0,0.6))}}
@keyframes pageEnter{0%{opacity:0;transform:translateY(32px) scale(0.97)}60%{opacity:1;transform:translateY(-4px) scale(1.005)}100%{opacity:1;transform:translateY(0) scale(1)}}
@keyframes pageFadeIn{0%{opacity:0}100%{opacity:1}}
@keyframes tutCardEnter{0%{opacity:0;transform:translateY(40px) scale(0.95) perspective(800px) rotateX(8deg)}60%{opacity:1;transform:translateY(-6px) scale(1.02) perspective(800px) rotateX(-2deg)}100%{opacity:1;transform:translateY(0) scale(1) perspective(800px) rotateX(0deg)}}
`;
const warrior = "'Barlow Condensed', sans-serif";
const mono = "'Space Mono', monospace";

// === ÇAPRAZ ÇAPA LOGO/İKON ===
const ANCHOR_PATH = "M12 2a3 3 0 0 0-3 3c0 1.31.84 2.42 2 2.83V9H8a1 1 0 0 0 0 2h1v7.94A6 6 0 0 1 4 13a1 1 0 1 0-2 0 8 8 0 0 0 16 0 1 1 0 1 0-2 0 6 6 0 0 1-5 5.94V11h1a1 1 0 1 0 0-2h-1V7.83A3 3 0 0 0 15 5a3 3 0 0 0-3-3zm0 2a1 1 0 1 1 0 2 1 1 0 0 1 0-2z";
function XAnchors({ size = 18, color = "currentColor", style }) {
  return (<svg width={size} height={size} viewBox="0 0 24 24" style={{ display:"inline-block", verticalAlign:"-3px", flexShrink:0, ...style }}>
    <g transform="rotate(-35 12 12)"><path d={ANCHOR_PATH} fill={color} /></g>
    <g transform="rotate(35 12 12)"><path d={ANCHOR_PATH} fill={color} /></g>
  </svg>);
}
function AnchorHeroLogo() {
  // Splash / zafer / logo görseli — kullanıcının sağladığı resmi çapa görseli
  return (<img src="/img/anchor-logo.png" alt="Amiral Battı" draggable={false} style={{ width:"100%",height:"100%",objectFit:"contain",userSelect:"none",pointerEvents:"none" }} />);
}

function Grid({ board, cellSize, onClick, onHover, onRightClick, onLongPress, onCellPointerDown, overlay, hoverCells, isDefense, shipColors, disabled, blinkCells, manualMarks, showShipStatus, onboardingHint }) {
  const longPressRef = useRef(null);
  const [rippleCell, setRippleCell] = useState(null);
  const handleClick = (r,c) => { if(disabled)return; sfx.init(); setRippleCell(`${r},${c}`); setTimeout(()=>setRippleCell(null),400); onClick?.(r,c); };
  const handleTouchStart = (r,c) => { longPressRef.current = setTimeout(()=>{ onLongPress?.(r,c); longPressRef.current=null; },500); };
  const handleTouchEnd = () => { if(longPressRef.current){clearTimeout(longPressRef.current);longPressRef.current=null;} };
  return (<div style={{ background:`linear-gradient(135deg,${t.surface} 0%,rgba(17,24,39,0.95) 100%)`,border:"1px solid rgba(55,65,81,0.6)",borderRadius:10,padding:4,overflow:"hidden",boxShadow:"0 4px 20px rgba(0,0,0,0.4),inset 0 1px 0 rgba(255,255,255,0.03)" }}>
    <div style={{ display:"flex" }}><div style={{ width:cellSize,height:cellSize }} />{board[0]?.map((_,i) => <div key={i} style={{ width:cellSize,height:cellSize,display:"flex",alignItems:"center",justifyContent:"center",fontSize:cellSize>30?10:8,fontWeight:800,color:t.textDim,fontFamily:warrior,letterSpacing:1 }}>{COL_LABELS[i]||""}</div>)}</div>
    {board.map((row,r) => (<div key={r} style={{ display:"flex" }}><div style={{ width:cellSize,height:cellSize,display:"flex",alignItems:"center",justifyContent:"center",fontSize:cellSize>30?10:8,fontWeight:800,color:t.textDim,fontFamily:warrior }}>{r+1}</div>
      {row.map((val,c) => {
        const ovr=overlay?.[r]?.[c], isHov=hoverCells?.some(([hr,hc])=>hr===r&&hc===c), shipColor=shipColors?.[r]?.[c], isBlink=blinkCells?.some(([br,bc])=>br===r&&bc===c), isManual=manualMarks?.[r]?.[c], isRipple=rippleCell===`${r},${c}`;
        let bg=t.water,content="",shadow="none",clr=t.textDim;
        if(isDefense){
          if(val>0&&shipColor)bg=shipColor;else if(val>0)bg=t.shipCell;
          if(ovr==="hit"){bg="#1a0505";content=(<span style={{position:"absolute",inset:0,display:"block",pointerEvents:"none"}}>
          <span style={{position:"absolute",inset:0,background:"radial-gradient(circle at 50% 50%, rgba(255,235,120,0.95) 0%, rgba(255,150,30,0.9) 22%, rgba(220,50,10,0.85) 45%, rgba(80,10,5,0.9) 70%, rgba(10,2,2,0.95) 100%)",animation:"explodeCore 1.1s ease-in-out infinite"}} />
          <span style={{position:"absolute",inset:"-15%",background:"radial-gradient(circle at 50% 50%, transparent 30%, rgba(255,120,20,0.35) 55%, transparent 75%)",animation:"explodeWave 1.6s ease-out infinite"}} />
          </span>);shadow="inset 0 0 14px rgba(255,90,20,0.6)";clr="#fff";}
          else if(ovr==="miss"){bg=t.miss;content="•";}
          // showShipStatus: savaş haritasında vurulan gemi hücreleri farklı gösterilir
          else if(showShipStatus&&val>0&&shipColor){bg=shipColor;content="■";clr="rgba(255,255,255,0.6)";}
        }
        else{if(ovr==="hit"){bg="#1a0505";content=(<span style={{position:"absolute",inset:0,display:"block",pointerEvents:"none"}}>
          <span style={{position:"absolute",inset:0,background:"radial-gradient(circle at 50% 50%, rgba(255,235,120,0.95) 0%, rgba(255,150,30,0.9) 22%, rgba(220,50,10,0.85) 45%, rgba(80,10,5,0.9) 70%, rgba(10,2,2,0.95) 100%)",animation:"explodeCore 1.1s ease-in-out infinite"}} />
          <span style={{position:"absolute",inset:"-15%",background:"radial-gradient(circle at 50% 50%, transparent 30%, rgba(255,120,20,0.35) 55%, transparent 75%)",animation:"explodeWave 1.6s ease-out infinite"}} />
          </span>);shadow="inset 0 0 14px rgba(255,90,20,0.6)";clr="#fff";}else if(ovr==="miss"){bg=t.miss;content="•";}else if(ovr==="sunk"){bg="#0d0303";content=(<span style={{position:"absolute",inset:0,display:"block",pointerEvents:"none"}}>
          <span style={{position:"absolute",inset:0,background:"radial-gradient(circle at 50% 55%, rgba(255,190,80,0.85) 0%, rgba(230,90,15,0.85) 28%, rgba(140,25,8,0.9) 55%, rgba(30,5,3,0.96) 85%)",animation:"explodeCore 1.5s ease-in-out infinite"}} />
          <span style={{position:"absolute",inset:"-12%",background:"radial-gradient(circle at 50% 50%, transparent 32%, rgba(255,100,20,0.25) 58%, transparent 78%)",animation:"explodeWave 2.2s ease-out infinite"}} />
          <span style={{position:"absolute",top:"50%",left:"50%",transform:"translate(-50%,-50%)",fontSize:"0.95em",fontWeight:900,color:"#fff",textShadow:"0 0 8px rgba(0,0,0,1), 0 0 4px rgba(0,0,0,1)"}}>✕</span>
        </span>);shadow="inset 0 0 16px rgba(180,50,10,0.7)";clr="#fff";}else if(ovr==="selected"){bg="rgba(6,182,212,0.45)";content="◎";shadow=`inset 0 0 12px ${t.accentGlow}`;clr=t.accent;}if(!ovr&&isManual){bg="rgba(251,191,36,0.15)";content="⚑";clr=t.gold;}}
        if(isHov){bg="rgba(6,182,212,0.35)";shadow=`inset 0 0 10px ${t.accentGlow}`;}
        const isHint = onboardingHint?.some(([hr,hc])=>hr===r&&hc===c) && !ovr;
        if(isHint){bg="rgba(255,215,0,0.25)";shadow=`inset 0 0 12px ${t.goldGlow}, 0 0 8px ${t.goldGlow}`;content="◆";clr=t.gold;}
        return <div key={c} data-cell="1" data-r={r} data-c={c} className={disabled?"":"ab-cell"} onClick={()=>handleClick(r,c)} onMouseEnter={()=>onHover?.(r,c)} onContextMenu={e=>{e.preventDefault();onRightClick?.(r,c);}} onMouseDown={disabled?undefined:(e)=>onCellPointerDown?.(r,c,e)} onTouchStart={disabled?undefined:(e)=>{ if(onCellPointerDown){ onCellPointerDown(r,c,e); } else { handleTouchStart(r,c); } }} onTouchEnd={handleTouchEnd} onTouchCancel={handleTouchEnd} style={{ position:"relative",overflow:"hidden",width:cellSize,height:cellSize,border:"1px solid rgba(55,65,81,0.5)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:ovr==="sunk"?10:8,fontWeight:700,cursor:disabled?"default":"pointer",background:bg,boxShadow:shadow,color:clr,boxSizing:"border-box",transition:"background 0.15s ease, box-shadow 0.15s ease",animation:isBlink?"blink3s 0.5s ease-in-out 6":isRipple?"popIn 0.3s ease-out":"none",borderRadius:1,touchAction:onCellPointerDown?"none":"auto" }}>{content}</div>;
      })}</div>))}
  </div>);
}

function ShipStatusPanel({ title, ships, hitCells, color }) {
  if(!ships)return null;
  const shipList = Object.values(ships);
  const totalShips = shipList.length;
  const sunkCount = shipList.filter(ship => { const cells=ship.cells||[]; const hits=cells.filter(([r,c])=>hitCells?.[r]?.[c]).length; return hits===cells.length&&cells.length>0; }).length;
  return (<div style={{ background:"linear-gradient(145deg, rgba(12,21,41,0.95), rgba(8,14,30,0.98))",border:`2px solid ${color==="rgba(255,71,87,0.55)"||color===t.hit?"rgba(255,71,87,0.25)":"rgba(0,229,255,0.2)"}`,borderRadius:12,padding:"14px 16px",marginTop:8,boxShadow:"0 4px 20px rgba(0,0,0,0.3)" }}>
    <div style={{ display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:8 }}>
      <div style={{ fontSize:13,letterSpacing:4,color:t.text,fontWeight:800,fontFamily:warrior,textTransform:"uppercase",textShadow:"0 1px 3px rgba(0,0,0,0.5)" }}>{title}</div>
      <div style={{ fontSize:11,fontWeight:700,color:sunkCount>0?t.sunk:t.textDim,fontFamily:mono,background:"rgba(255,255,255,0.04)",padding:"2px 8px",borderRadius:6 }}>{sunkCount}/{totalShips}</div>
    </div>
    <div style={{ display:"flex",flexWrap:"wrap",gap:8 }}>
      {shipList.map((ship,idx)=>{const shipDef=SHIPS.find(s=>s.id===ship.id);const cells=ship.cells||[];const hits=cells.filter(([r,c])=>hitCells?.[r]?.[c]).length;const sunk=hits===cells.length&&cells.length>0;return(<div key={idx} style={{ display:"flex",alignItems:"center",gap:6,padding:"4px 8px",background:sunk?"rgba(255,140,66,0.08)":"transparent",borderRadius:6,border:`1px solid ${sunk?"rgba(255,140,66,0.2)":"transparent"}` }}><span style={{ fontSize:12,fontWeight:800,color:sunk?t.sunk:t.text,textDecoration:sunk?"line-through":"none",fontFamily:warrior,letterSpacing:1 }}>{shipDef?.name||"?"}</span><div style={{ display:"flex",gap:2 }}>{cells.map((_,i)=><div key={i} style={{ width:10,height:10,borderRadius:3,background:i<hits?(sunk?t.sunk:t.hit):color||t.accent,opacity:i<hits?1:0.25,boxShadow:i<hits&&sunk?`0 0 4px ${t.sunk}`:i<hits?`0 0 4px ${t.hit}`:"none" }} />)}</div></div>);})}
    </div>
  </div>);
}

function MissionIcon({ icon, done, missionId }) {
  const iconMap = {
    "🚢": <svg width="24" height="24" viewBox="0 0 24 24" fill="none"><path d="M3 17l2 4h14l2-4" stroke={done?"#4ade80":"#00e5ff"} strokeWidth="2" strokeLinecap="round"/><path d="M4 17l2-6h12l2 6" fill={done?"rgba(74,222,128,0.2)":"rgba(0,229,255,0.15)"} stroke={done?"#4ade80":"#00e5ff"} strokeWidth="1.5"/><path d="M12 4v7M9 7h6" stroke={done?"#4ade80":"#00e5ff"} strokeWidth="2" strokeLinecap="round"/><rect x="10" y="3" width="4" height="2" rx="1" fill={done?"#4ade80":"#00e5ff"}/></svg>,
    "🔥": <svg width="24" height="24" viewBox="0 0 24 24" fill="none"><path d="M12 2c0 4-4 6-4 10a4 4 0 008 0c0-4-4-6-4-10z" fill={done?"rgba(74,222,128,0.3)":"rgba(255,140,66,0.3)"} stroke={done?"#4ade80":"#ff8c42"} strokeWidth="1.5"/><path d="M12 8c0 2-2 3-2 5a2 2 0 004 0c0-2-2-3-2-5z" fill={done?"#4ade80":"#ff8c42"}/></svg>,
    "🏆": <svg width="24" height="24" viewBox="0 0 24 24" fill="none"><path d="M8 21h8M12 17v4" stroke={done?"#4ade80":"#ffd700"} strokeWidth="2" strokeLinecap="round"/><path d="M7 3h10v5a5 5 0 01-10 0V3z" fill={done?"rgba(74,222,128,0.2)":"rgba(255,215,0,0.2)"} stroke={done?"#4ade80":"#ffd700"} strokeWidth="1.5"/><path d="M7 5H4v2a3 3 0 003 3M17 5h3v2a3 3 0 01-3 3" stroke={done?"#4ade80":"#ffd700"} strokeWidth="1.5"/></svg>,
    "⭐": <svg width="24" height="24" viewBox="0 0 24 24" fill="none"><path d="M12 2l3 6 7 1-5 5 1 7-6-3-6 3 1-7-5-5 7-1z" fill={done?"rgba(74,222,128,0.3)":"rgba(255,215,0,0.3)"} stroke={done?"#4ade80":"#ffd700"} strokeWidth="1.5" strokeLinejoin="round"/></svg>,
    "🎯": <svg width="24" height="24" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke={done?"#4ade80":"#ff4757"} strokeWidth="1.5"/><circle cx="12" cy="12" r="6" stroke={done?"#4ade80":"#ff4757"} strokeWidth="1.5"/><circle cx="12" cy="12" r="3" fill={done?"#4ade80":"#ff4757"}/></svg>,
    "💥": <svg width="24" height="24" viewBox="0 0 24 24" fill="none"><path d="M12 2l2 6 6-2-4 5 5 3-6 1 1 7-4-5-4 5 1-7-6-1 5-3-4-5 6 2z" fill={done?"rgba(74,222,128,0.3)":"rgba(255,71,87,0.3)"} stroke={done?"#4ade80":"#ff4757"} strokeWidth="1.5" strokeLinejoin="round"/></svg>,
    "🛡": <svg width="24" height="24" viewBox="0 0 24 24" fill="none"><path d="M12 3l7 3v5c0 5-3 8-7 10-4-2-7-5-7-10V6l7-3z" fill={done?"rgba(74,222,128,0.2)":"rgba(0,229,255,0.15)"} stroke={done?"#4ade80":"#00e5ff"} strokeWidth="1.5"/><path d="M9 12l2 2 4-4" stroke={done?"#4ade80":"#00e5ff"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>,
    "⚡": <svg width="24" height="24" viewBox="0 0 24 24" fill="none"><path d="M13 2L4 14h7l-1 8 9-12h-7l1-8z" fill={done?"rgba(74,222,128,0.3)":"rgba(255,215,0,0.3)"} stroke={done?"#4ade80":"#ffd700"} strokeWidth="1.5" strokeLinejoin="round"/></svg>,
    "🤖": <svg width="24" height="24" viewBox="0 0 24 24" fill="none"><rect x="5" y="8" width="14" height="12" rx="3" fill={done?"rgba(74,222,128,0.2)":"rgba(167,139,250,0.2)"} stroke={done?"#4ade80":"#a78bfa"} strokeWidth="1.5"/><circle cx="9" cy="14" r="2" fill={done?"#4ade80":"#a78bfa"}/><circle cx="15" cy="14" r="2" fill={done?"#4ade80":"#a78bfa"}/><path d="M12 3v5M8 5h8" stroke={done?"#4ade80":"#a78bfa"} strokeWidth="2" strokeLinecap="round"/></svg>,
    "⚓": <svg width="24" height="24" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="5" r="3" stroke={done?"#4ade80":"#06b6d4"} strokeWidth="1.5"/><path d="M12 8v13M5 18c0-4 3-7 7-7s7 3 7 7" stroke={done?"#4ade80":"#06b6d4"} strokeWidth="1.5" strokeLinecap="round"/><path d="M8 13h8" stroke={done?"#4ade80":"#06b6d4"} strokeWidth="2" strokeLinecap="round"/></svg>,
  };
  const medalMap = { sink8:"/img/medal_gemi.png", hit10:"/img/medal_isabet10.png", hit30:"/img/medal_isabet30.png" };
  if (missionId && medalMap[missionId]) return <img src={medalMap[missionId]} alt="" style={{ width:40,height:40,filter:done?"none":"saturate(0.85)",opacity:done?1:0.92 }} />;
  return iconMap[icon] || <span style={{ fontSize:22,filter:"drop-shadow(0 3px 5px rgba(0,0,0,0.6)) drop-shadow(0 0 12px rgba(0,229,255,0.35)) saturate(1.4) brightness(1.1)",transform:"perspective(200px) rotateX(6deg)",display:"inline-block" }}>{icon}</span>;
}

function MissionPanel({ missions, missionProgress, onClose }) {
  const completed = missions.filter(m => missionProgress[m.id]);
  const allDone = completed.length === 3;
  const progressPct = Math.round((completed.length / 3) * 100);
  return (<div style={{ background:`linear-gradient(145deg, rgba(12,21,41,0.98), rgba(8,14,30,0.99))`,border:`2px solid ${allDone?"#fbbf24":"rgba(0,229,255,0.25)"}`,borderRadius:16,padding:"20px 20px 16px",width:"100%",maxWidth:380,marginTop:12,boxShadow:allDone?`0 0 40px ${t.goldGlow}, inset 0 1px 0 rgba(255,215,0,0.1)`:`0 8px 32px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.04)`,animation:"fadeUp 0.4s ease-out" }}>
    <div style={{ display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:14 }}>
      <div style={{ display:"flex",alignItems:"center",gap:8 }}>
        <div style={{ width:32,height:32,borderRadius:10,background:"rgba(0,229,255,0.1)",border:"1px solid rgba(0,229,255,0.2)",display:"flex",alignItems:"center",justifyContent:"center" }}><svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M12 2l3 6 7 1-5 5 1 7-6-3-6 3 1-7-5-5 7-1z" fill="rgba(0,229,255,0.3)" stroke="#00e5ff" strokeWidth="1.5" strokeLinejoin="round"/></svg></div>
        <div>
          <div style={{ fontSize:16,fontWeight:800,color:t.accent,fontFamily:warrior,letterSpacing:4,textShadow:`0 0 15px ${t.accentGlow}` }}>GÖREVLER</div>
          <div style={{ fontSize:9,fontWeight:700,color:t.textDim,fontFamily:mono,letterSpacing:2,marginTop:1 }}>HER GÜN YENİLENİR</div>
        </div>
      </div>
      <div style={{ textAlign:"center",background:allDone?"rgba(255,215,0,0.15)":"rgba(0,229,255,0.08)",padding:"6px 14px",borderRadius:10,border:`1px solid ${allDone?"rgba(255,215,0,0.3)":"rgba(0,229,255,0.2)"}` }}>
        <div style={{ fontSize:16,fontWeight:800,color:allDone?t.gold:t.accent,fontFamily:mono }}>{completed.length}/3</div>
      </div>
    </div>
    <div style={{ width:"100%",height:4,background:"rgba(255,255,255,0.06)",borderRadius:2,marginBottom:14,overflow:"hidden" }}>
      <div style={{ width:`${progressPct}%`,height:"100%",background:allDone?`linear-gradient(90deg,${t.gold},#f59e0b)`:`linear-gradient(90deg,${t.accent},#06b6d4)`,borderRadius:2,transition:"width 0.5s ease",boxShadow:allDone?`0 0 10px ${t.goldGlow}`:`0 0 8px ${t.accentGlow}` }} />
    </div>
    {missions.map((m, i) => {
      const done = missionProgress[m.id];
      return (<div key={m.id} style={{ display:"flex",alignItems:"center",gap:14,padding:"12px 14px",background:done?"linear-gradient(135deg, rgba(74,222,128,0.1), rgba(74,222,128,0.03))":"linear-gradient(135deg, rgba(255,255,255,0.03), rgba(255,255,255,0.01))",borderRadius:12,marginBottom:8,border:`2px solid ${done?"rgba(74,222,128,0.3)":"rgba(30,58,95,0.4)"}`,transition:"all 0.3s ease",boxShadow:done?"0 0 15px rgba(74,222,128,0.08)":"none" }}>
        <div style={{ flex:1,minWidth:0 }}>
          <div style={{ fontSize:14,fontWeight:800,color:done?"#4ade80":t.text,fontFamily:warrior,letterSpacing:2 }}>{m.text.toLocaleUpperCase('tr-TR')}</div>
          <div style={{ fontSize:9,fontWeight:600,color:done?"rgba(74,222,128,0.7)":t.textDim,fontFamily:mono,letterSpacing:1,marginTop:2 }}>{done?"TAMAMLANDI":"DEVAM EDİYOR"}</div>
        </div>
        {done ? <div style={{ width:30,height:30,borderRadius:10,background:"rgba(74,222,128,0.15)",display:"flex",alignItems:"center",justifyContent:"center",border:"2px solid rgba(74,222,128,0.3)" }}><svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M3 8l4 4 6-7" stroke="#4ade80" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/></svg></div> : <div style={{ width:30,height:30,borderRadius:10,background:"rgba(255,255,255,0.03)",display:"flex",alignItems:"center",justifyContent:"center",border:"1px solid rgba(255,255,255,0.06)" }}><div style={{ width:8,height:8,borderRadius:4,border:"2px solid rgba(255,255,255,0.15)" }} /></div>}
      </div>);
    })}
    {allDone && <div style={{ marginTop:10,padding:"12px 16px",background:"linear-gradient(135deg, rgba(255,215,0,0.12), rgba(255,215,0,0.03))",borderRadius:12,border:"2px solid rgba(255,215,0,0.25)",textAlign:"center" }}><div style={{ fontSize:15,fontWeight:800,color:t.gold,fontFamily:warrior,letterSpacing:4,animation:"pulse 1.5s infinite",textShadow:`0 0 20px ${t.goldGlow}` }}>SANDIK HAZIR!</div><div style={{ fontSize:10,fontWeight:600,color:"rgba(255,215,0,0.7)",fontFamily:mono,marginTop:3 }}>Ödülünü topla</div></div>}
  </div>);
}

function ChestPopup({ reward, onClose }) {
  const [opened, setOpened] = useState(false);
  const [shake, setShake] = useState(true);
  useEffect(() => { const t1 = setTimeout(() => setShake(false), 1500); return () => clearTimeout(t1); }, []);
  return (<div style={{ position:"fixed",inset:0,background:"rgba(0,0,0,0.8)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:9999 }} onClick={opened ? onClose : undefined}>
    <div onClick={e=>e.stopPropagation()} style={{ background:`linear-gradient(135deg,${t.surface},rgba(17,24,39,0.98))`,border:`2px solid ${reward?reward.color:t.gold}`,borderRadius:16,padding:"30px 36px",textAlign:"center",maxWidth:320,width:"90%",boxShadow:`0 0 60px ${t.goldGlow}`,animation:"scaleUp 0.5s ease-out" }}>
      {!opened ? (<>
        <div style={{ fontSize:64,marginBottom:12,animation:shake?"defeatShake 0.5s ease-in-out infinite":"popIn 0.3s ease-out",cursor:"pointer" }} onClick={()=>{setOpened(true);sfx.init();sfx.play('chest');}}>🎁</div>
        <div style={{ fontSize:18,fontWeight:700,color:t.gold,fontFamily:warrior,letterSpacing:3,marginBottom:8 }}>GİZEMLİ SANDIK</div>
        <div style={{ fontSize:12,color:t.textDim,fontFamily:mono,marginBottom:12 }}>3 görevi tamamladın!</div>
        <button onClick={()=>setOpened(true)} style={{ padding:"12px 36px",background:`linear-gradient(135deg,${t.gold},#d97706)`,color:t.bg,border:"none",borderRadius:8,fontSize:14,fontWeight:700,letterSpacing:2,cursor:"pointer",fontFamily:warrior,animation:"borderGlow 2s infinite" }}>SANDIĞI AÇ</button>
      </>) : (<>
        <div style={{ fontSize:56,marginBottom:8,animation:"popIn 0.5s ease-out" }}>{reward.icon}</div>
        <div style={{ fontSize:14,fontWeight:700,color:reward.color,fontFamily:warrior,letterSpacing:3,marginBottom:4,animation:"fadeUp 0.3s ease-out" }}>{reward.label}</div>
        <div style={{ fontSize:42,fontWeight:800,color:t.gold,fontFamily:warrior,marginBottom:8,textShadow:`0 0 30px ${t.goldGlow}`,animation:"scaleUp 0.6s ease-out" }}>+{reward.gold} <img src="/img/coin.png" alt="" style={{ width:18,height:18,verticalAlign:"middle",filter:"drop-shadow(0 1px 2px rgba(0,0,0,0.5))" }} /></div>
        <button onClick={onClose} style={{ marginTop:8,padding:"12px 36px",background:`linear-gradient(135deg,${t.accent},#0891b2)`,color:t.bg,border:"none",borderRadius:8,fontSize:14,fontWeight:700,letterSpacing:2,cursor:"pointer",fontFamily:warrior }}>TOPLA</button>
      </>)}
    </div>
  </div>);
}

// === GÜNLÜK SANDIK — cihaz başına 1 tane, sabit 500 altın ===
function DailyChestFab({ onOpen }) {
  return (<button onClick={onOpen} style={{ position:"fixed",top:14,right:14,zIndex:150,width:60,height:60,borderRadius:16,background:"linear-gradient(160deg,#fff9c4 0%,#ffe066 30%,#ffd700 60%,#ffb300 100%)",border:"2px solid #fff7d6",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",fontSize:30,boxShadow:"0 0 18px #ffe066, 0 0 40px rgba(255,214,0,0.85), 0 0 70px rgba(255,214,0,0.5), 0 4px 14px rgba(0,0,0,0.5)",animation:"chestWiggle 2s ease-in-out infinite, rewardPulse 1.4s ease-in-out infinite" }} title="Günlük Sandık">
    🎁
    <span style={{ position:"absolute",top:-6,right:-6,width:18,height:18,borderRadius:"50%",background:"#ff4757",color:"#fff",fontSize:11,fontWeight:900,display:"flex",alignItems:"center",justifyContent:"center",boxShadow:"0 0 8px rgba(255,71,87,0.8)",fontFamily:warrior }}>1</span>
  </button>);
}
function DailyChestPopup({ onClaim }) {
  const [opened, setOpened] = useState(false);
  const [shake, setShake] = useState(true);
  const [showCoins, setShowCoins] = useState(false);
  useEffect(() => { const tm = setTimeout(() => setShake(false), 1200); return () => clearTimeout(tm); }, []);
  const openChest = () => {
    if (opened) return;
    setOpened(true); setShowCoins(true);
    sfx.init(); sfx.play('chest');
    setTimeout(() => sfx.play('gold'), 250);
  };
  const coins = Array.from({ length: 12 }, (_, i) => ({ id: i, delay: i * 90, dx: (Math.random() - 0.5) * 120 }));
  return (<div style={{ position:"fixed",inset:0,background:"radial-gradient(ellipse at 50% 40%, rgba(255,214,0,0.12) 0%, rgba(0,0,0,0.88) 75%)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:9999,backdropFilter:"blur(6px)" }} onClick={opened ? undefined : openChest}>
    <div onClick={e=>e.stopPropagation()} style={{ position:"relative",background:"linear-gradient(160deg, rgba(20,26,52,0.99) 0%, rgba(10,16,32,0.99) 60%, rgba(30,20,8,0.99) 100%)",border:"2px solid #ffd700",outline:"1px solid rgba(255,240,150,0.4)",outlineOffset:5,borderRadius:22,padding:"38px 42px",textAlign:"center",maxWidth:340,width:"90%",boxShadow:"0 0 30px #ffe066, 0 0 100px rgba(255,214,0,0.5), 0 24px 70px rgba(0,0,0,0.6)",overflow:"visible" }}>
      {!opened ? (<>
        <div style={{ fontSize:80,marginBottom:12,cursor:"pointer",animation:shake?"chestWiggle 0.5s ease-in-out infinite":"chestWiggle 2s ease-in-out infinite",filter:"drop-shadow(0 0 30px #ffe066) drop-shadow(0 0 60px rgba(255,214,0,0.7))" }} onClick={openChest}>🎁</div>
        <div style={{ fontSize:12,fontWeight:700,color:"#ffe066",fontFamily:mono,letterSpacing:5,marginBottom:10 }}>GÜNLÜK SANDIK</div>
        <div style={{ fontSize:13,color:t.textDim,fontFamily:mono,marginBottom:16 }}>Her cihaza günde 1 sandık!</div>
        <button onClick={openChest} style={{ padding:"16px 48px",background:"linear-gradient(135deg,#fff9c4,#ffd700 45%,#ff9f43)",color:"#1a1206",border:"none",borderRadius:12,fontSize:16,fontWeight:900,letterSpacing:4,cursor:"pointer",fontFamily:warrior,boxShadow:"0 0 30px #ffe066, 0 0 60px rgba(255,214,0,0.5)",animation:"borderGlow 1.5s infinite",textTransform:"uppercase" }}>SANDIĞI AÇ</button>
      </>) : (<>
        <div style={{ fontSize:60,marginBottom:8,animation:"popIn 0.5s ease-out",filter:"drop-shadow(0 0 30px #ffe066)" }}>🎉</div>
        <div style={{ fontSize:11,fontWeight:700,color:"rgba(255,214,0,0.7)",fontFamily:mono,letterSpacing:5,marginBottom:8 }}>GÜNLÜK ÖDÜL</div>
        <div style={{ fontSize:52,fontWeight:900,fontFamily:warrior,marginBottom:14,letterSpacing:2,background:"linear-gradient(180deg, #fff7d6 0%, #ffd700 45%, #d97706 100%)",WebkitBackgroundClip:"text",WebkitTextFillColor:"transparent",filter:"drop-shadow(0 0 25px rgba(255,214,0,0.8))",animation:"rewardPulse 1.4s ease-in-out infinite" }}>+{DAILY_CHEST_GOLD} <img src="/img/coin.png" alt="" style={{ width:22,height:22,verticalAlign:"middle" }} /></div>
        <button onClick={() => onClaim(DAILY_CHEST_GOLD)} style={{ padding:"16px 52px",background:"linear-gradient(135deg, #ffd700 0%, #ff9f43 55%, #d97706 100%)",color:"#1a1206",border:"none",borderRadius:12,fontSize:17,fontWeight:900,letterSpacing:5,cursor:"pointer",fontFamily:warrior,boxShadow:"0 0 40px rgba(255,214,0,0.6), 0 6px 24px rgba(0,0,0,0.5)",animation:"btnBreath 1.8s ease-in-out infinite",textTransform:"uppercase" }}>TOPLA</button>
        {showCoins && <div style={{ position:"absolute",left:"50%",bottom:"38%",pointerEvents:"none" }}>
          {coins.map(c => (<div key={c.id} style={{ position:"absolute",left:c.dx,bottom:0,fontSize:26,opacity:0,animation:`coinFly 1s cubic-bezier(0.25,0.46,0.45,0.94) ${c.delay}ms forwards` }}>🪙</div>))}
        </div>}
      </>)}
    </div>
  </div>);
}

function ReadyScreen({ onStart, opponentName, myName, myAvatar, oppAvatar }) {
  return (<div style={{ display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",minHeight:"100vh",minHeight:"100dvh",background:`radial-gradient(ellipse at 50% 30%, rgba(255,71,87,0.10) 0%, rgba(0,229,255,0.06) 40%, ${t.bg} 75%)`,padding:20,animation:"pageFadeIn 0.6s ease-out" }}>
    {/* VS düzeni */}
    <div style={{ display:"flex",alignItems:"center",gap:26,marginBottom:28,animation:"tutCardEnter 0.9s cubic-bezier(0.16,1,0.3,1)" }}>
      <div style={{ textAlign:"center" }}>
        <div style={{ width:78,height:78,borderRadius:"50%",background:"rgba(0,229,255,0.10)",border:`3px solid ${t.accent}`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:38,boxShadow:`0 0 30px ${t.accentGlow}`,marginBottom:8,overflow:"hidden" }}>{(myAvatar||"").startsWith("data:")?<img src={myAvatar} alt="" style={{ width:"100%",height:"100%",objectFit:"cover" }} />:(myAvatar||"⚓")}</div>
        <div style={{ fontSize:13,fontWeight:800,color:t.accent,fontFamily:warrior,letterSpacing:2,maxWidth:100,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap" }}>{myName||"SEN"}</div>
      </div>
      <div style={{ fontSize:34,fontWeight:900,color:t.gold,fontFamily:warrior,textShadow:`0 0 30px ${t.goldGlow}`,animation:"rewardPulse 1.4s ease-in-out infinite" }}>VS</div>
      <div style={{ textAlign:"center" }}>
        <div style={{ width:78,height:78,borderRadius:"50%",background:"rgba(255,71,87,0.10)",border:`3px solid ${t.hit}`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:38,boxShadow:`0 0 30px ${t.hitGlow}`,marginBottom:8,overflow:"hidden" }}>{(oppAvatar||"").startsWith("data:")?<img src={oppAvatar} alt="" style={{ width:"100%",height:"100%",objectFit:"cover" }} />:(oppAvatar||"🏴‍☠️")}</div>
        <div style={{ fontSize:13,fontWeight:800,color:t.hit,fontFamily:warrior,letterSpacing:2,maxWidth:100,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap" }}>{opponentName}</div>
      </div>
    </div>
    <div style={{ fontSize:26,fontWeight:900,color:"#fff",marginBottom:10,fontFamily:warrior,letterSpacing:8,textTransform:"uppercase",textShadow:`0 0 40px ${t.hitGlow}, 0 3px 6px rgba(0,0,0,0.8)`,animation:"fadeUp 0.7s ease-out" }}>SAVAŞ BAŞLIYOR</div>
    <div style={{ width:120,height:2,background:`linear-gradient(90deg, transparent, ${t.gold}, transparent)`,marginBottom:32,animation:"fadeUp 0.8s ease-out" }} />
    <button onClick={onStart} style={{ padding:"18px 52px",background:`linear-gradient(135deg,${t.accent},#0891b2)`,color:t.bg,border:"none",borderRadius:12,fontSize:19,fontWeight:900,letterSpacing:5,textTransform:"uppercase",cursor:"pointer",fontFamily:warrior,animation:"scaleUp 0.5s ease-out 0.3s both",boxShadow:`0 0 40px ${t.accentGlow},0 6px 20px rgba(0,0,0,0.4)` }}>SAVAŞA HAZIR</button>
  </div>);
}

function GameOverScreen({ winner, myHits, oppHits, onNewGame, onHome, onViewBoard, isWin }) {
  const [showStats, setShowStats] = useState(false);
  const [showButtons, setShowButtons] = useState(false);
  useEffect(() => {
    const t1 = setTimeout(() => setShowStats(true), 800);
    const t2 = setTimeout(() => setShowButtons(true), 1600);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, []);
  return (<div style={{ display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",minHeight:"100vh",minHeight:"100dvh",background:isWin?`radial-gradient(ellipse at 50% 30%,rgba(0,229,255,0.15) 0%,rgba(255,215,0,0.05) 30%,${t.bg} 70%)`:`radial-gradient(ellipse at center,rgba(255,71,87,0.1) 0%,${t.bg} 70%)`,padding:20,perspective:"800px" }}>
    <div style={{ animation:"arSlideIn 0.8s ease-out forwards",transformStyle:"preserve-3d" }}>
      <div style={{ background:`linear-gradient(145deg, rgba(12,21,41,0.98), rgba(8,14,30,0.99))`,border:`3px solid ${isWin?t.accent:t.hit}`,borderRadius:24,padding:"40px 32px 32px",textAlign:"center",maxWidth:360,width:"90vw",animation:`arGlow 3s ease-in-out infinite`,boxShadow:`0 20px 80px rgba(0,0,0,0.7), 0 0 ${isWin?60:30}px ${isWin?t.accentGlow:t.hitGlow}`,'--ar-color':isWin?t.accentGlow:t.hitGlow }}>
        {/* Victory/Defeat icon */}
        <div style={{ fontSize:64,marginBottom:8,animation:isWin?"float 2s ease-in-out infinite":"defeatShake 0.6s ease-out" }}>{isWin?<XAnchors size={56} color={t.accent}/>:"💀"}</div>
        <div style={{ fontSize:68,fontWeight:900,letterSpacing:10,color:isWin?t.accent:t.hit,fontFamily:warrior,textTransform:"uppercase",textShadow:isWin?`0 0 80px ${t.accentGlow},0 0 160px rgba(0,229,255,0.3), 0 0 40px ${t.accentGlow}, 0 4px 0 rgba(0,0,0,0.8)`:`0 0 50px ${t.hitGlow}, 0 4px 0 rgba(0,0,0,0.8)`,marginBottom:4,animation:isWin?"victoryGlow 1.5s ease-in-out infinite":"none",lineHeight:1,letterSpacing:isWin?12:8 }}>{isWin?"⚡ ZAFER ⚡":"BOZGUN"}</div>
        <div style={{ fontSize:13,fontWeight:700,color:isWin?"rgba(0,229,255,0.8)":"rgba(255,71,87,0.8)",fontFamily:warrior,letterSpacing:3,marginBottom:24 }}>{winner}</div>
        {/* Stats with staggered animation */}
        {showStats && <div style={{ display:"flex",gap:16,justifyContent:"center",marginBottom:24 }}>
          <div style={{ padding:"16px 28px",background:isWin?"rgba(0,229,255,0.1)":"rgba(255,255,255,0.03)",borderRadius:16,border:`2px solid ${isWin?"rgba(0,229,255,0.25)":"rgba(255,255,255,0.08)"}`,animation:"arSlideIn 0.6s ease-out forwards" }}>
            <div style={{ fontSize:40,fontWeight:800,color:t.accent,fontFamily:mono,textShadow:`0 0 15px ${t.accentGlow}` }}>{myHits}</div>
            <div style={{ fontSize:11,color:t.textDim,letterSpacing:4,fontFamily:warrior,fontWeight:800,marginTop:4 }}>İSABET</div>
          </div>
          <div style={{ padding:"16px 28px",background:"rgba(255,71,87,0.06)",borderRadius:16,border:"2px solid rgba(255,71,87,0.15)",animation:"arSlideIn 0.6s ease-out 0.2s both" }}>
            <div style={{ fontSize:40,fontWeight:800,color:t.hit,fontFamily:mono }}>{oppHits}</div>
            <div style={{ fontSize:11,color:t.textDim,letterSpacing:4,fontFamily:warrior,fontWeight:800,marginTop:4 }}>KARAVANA</div>
          </div>
        </div>}
        {/* Buttons */}
        {showButtons && <div style={{ display:"flex",flexDirection:"column",gap:10,animation:"fadeUp 0.5s ease-out" }}>
          <button onClick={onViewBoard} style={{ padding:"12px 20px",background:"transparent",color:t.accent,border:`2px solid rgba(0,229,255,0.25)`,borderRadius:12,fontSize:12,fontWeight:800,letterSpacing:3,cursor:"pointer",fontFamily:warrior }}>SAVAŞ HARİTASI</button>
          <button onClick={onNewGame} style={{ padding:"16px 24px",background:`linear-gradient(135deg,${t.accent},#0891b2)`,color:t.bg,border:"none",borderRadius:12,fontSize:16,fontWeight:800,letterSpacing:4,cursor:"pointer",fontFamily:warrior,boxShadow:`0 4px 30px ${t.accentGlow}` }}>YENİ SAVAŞ</button>
          <button onClick={onHome} style={{ padding:"12px 20px",background:"transparent",color:t.textDim,border:`1px solid ${t.border}`,borderRadius:10,fontSize:12,fontWeight:700,letterSpacing:2,cursor:"pointer",fontFamily:warrior }}>ANA SAYFA</button>
        </div>}
      </div>
    </div>
  </div>);
}

function BoardReview({ defenseBoard, shipColorMap, defenseOverlay, attackOverlay, oppShipsData, myShipsData, defHitMap, atkHitMap, cellSize, onBack }) {
  const [view,setView] = useState("attack");
  const oppBoard=emptyGrid(), oppColors=Array.from({length:ROWS},()=>Array(COLS).fill(null));
  if(oppShipsData){Object.values(oppShipsData).forEach(ship=>{const sd=SHIPS.find(s=>s.id===ship.id);ship.cells?.forEach(([r,c])=>{oppBoard[r][c]=1;oppColors[r][c]=sd?.color||t.shipCell;});});}
  return (<div style={{ display:"flex",flexDirection:"column",alignItems:"center",minHeight:"100vh",minHeight:"100dvh",background:t.bg,padding:"12px 8px",fontFamily:mono,color:t.text }}>
    <style>{ANIMS}</style>
    <div style={{ fontSize:18,fontWeight:700,color:t.accent,marginBottom:8,fontFamily:warrior,letterSpacing:3 }}>SAVAŞ HARİTASI</div>
    <div style={{ display:"flex",gap:0,marginBottom:8,width:"100%",maxWidth:400 }}>
      <button onClick={()=>setView("attack")} style={{ flex:1,padding:"8px 0",fontSize:12,fontWeight:700,fontFamily:warrior,cursor:"pointer",background:view==="attack"?t.accent:t.surfaceLight,color:view==="attack"?t.bg:t.textDim,border:`1px solid ${view==="attack"?t.accent:t.border}`,borderRadius:"8px 0 0 8px",letterSpacing:2 }}>RAKİP SAHA</button>
      <button onClick={()=>setView("defense")} style={{ flex:1,padding:"8px 0",fontSize:12,fontWeight:700,fontFamily:warrior,cursor:"pointer",background:view==="defense"?t.accent:t.surfaceLight,color:view==="defense"?t.bg:t.textDim,border:`1px solid ${view==="defense"?t.accent:t.border}`,borderRadius:"0 8px 8px 0",letterSpacing:2 }}>BENİM SAHAM</button>
    </div>
    <div style={{ width:"100%",maxWidth:400 }}>
      {view==="attack"?<><Grid board={oppBoard} cellSize={cellSize} isDefense shipColors={oppColors} overlay={attackOverlay} disabled showShipStatus /><ShipStatusPanel title="RAKİP GEMİLER" ships={oppShipsData} hitCells={atkHitMap} color={t.hit} /></>:<><Grid board={defenseBoard} cellSize={cellSize} isDefense shipColors={shipColorMap} overlay={defenseOverlay} disabled showShipStatus /><ShipStatusPanel title="GEMİLERİM" ships={myShipsData} hitCells={defHitMap} color={t.accent} /></>}
    </div>
    <button onClick={onBack} style={{ marginTop:16,padding:"12px 32px",background:t.accent,color:t.bg,border:"none",borderRadius:8,fontSize:13,fontWeight:700,letterSpacing:2,cursor:"pointer",fontFamily:warrior }}>GERİ DÖN</button>
  </div>);
}

function OnlineLobby({ myUid, myName, myGold, onChallenge, onBack }) {
  const [players,setPlayers]=useState([]);const [invites,setInvites]=useState([]);const [sentInvite,setSentInvite]=useState(null);
  useEffect(()=>{const unsub=onValue(ref(db,"online_players"),snap=>{if(!snap.exists()){setPlayers([]);return;}const list=[];snap.forEach(child=>{const d=child.val();if(child.key!==myUid&&d.status==="idle")list.push({uid:child.key,...d});});list.sort((a,b)=>(b.gold||0)-(a.gold||0));setPlayers(list);});return()=>unsub();},[myUid]);
  useEffect(()=>{const unsub=onValue(ref(db,`invites/${myUid}`),snap=>{if(!snap.exists()){setInvites([]);return;}const list=[];snap.forEach(child=>list.push({id:child.key,...child.val()}));setInvites(list);});return()=>unsub();},[myUid]);
  useEffect(()=>{if(!sentInvite)return;const unsub=onValue(ref(db,`invites/${sentInvite.targetUid}/${myUid}`),snap=>{if(!snap.exists()){setSentInvite(null);return;}const d=snap.val();if(d.status==="accepted"&&d.roomId){remove(ref(db,`invites/${sentInvite.targetUid}/${myUid}`));setSentInvite(null);onChallenge(d.roomId,1);}else if(d.status==="rejected"){remove(ref(db,`invites/${sentInvite.targetUid}/${myUid}`));setSentInvite(null);}});return()=>unsub();},[sentInvite,myUid,onChallenge]);
  const sendInvite=async(targetUid,targetName)=>{if(sentInvite)return;await set(ref(db,`invites/${targetUid}/${myUid}`),{fromName:myName,fromGold:myGold||0,status:"pending",time:Date.now()});setSentInvite({targetUid,targetName});};
  const cancelInvite=async()=>{if(!sentInvite)return;await remove(ref(db,`invites/${sentInvite.targetUid}/${myUid}`));setSentInvite(null);};
  const acceptInvite=async(invite)=>{const roomId=Math.random().toString(36).substring(2,8).toUpperCase();await set(ref(db,`rooms/${roomId}`),{p1_name:invite.fromName,p1_uid:invite.id,p2_name:myName,p2_uid:myUid,phase:"placing",p1_board:null,p2_board:null,p1_ships:null,p2_ships:null,attacks:null,turn:1,clocks:{p1:CLOCK_SECONDS,p2:CLOCK_SECONDS},winner:null,winReason:null,eloProcessed:false,created:Date.now()});await update(ref(db,`invites/${myUid}/${invite.id}`),{status:"accepted",roomId});setTimeout(()=>remove(ref(db,`invites/${myUid}/${invite.id}`)),3000);onChallenge(roomId,2);};
  const rejectInvite=async(invite)=>{await update(ref(db,`invites/${myUid}/${invite.id}`),{status:"rejected"});setTimeout(()=>remove(ref(db,`invites/${myUid}/${invite.id}`)),2000);};
  return (<div style={{ display:"flex",flexDirection:"column",alignItems:"center",minHeight:"100vh",minHeight:"100dvh",background:t.bg,padding:"20px 12px",fontFamily:"'Space Mono',monospace",color:t.text }}>
    <div style={{ fontSize:22,fontWeight:700,letterSpacing:5,color:t.accent,marginBottom:4,fontFamily:"'Barlow Condensed',sans-serif",textShadow:`0 0 20px ${t.accentGlow}` }}>ONLİNE SALON</div>
    <div style={{ fontSize:10,color:t.textDim,letterSpacing:4,marginBottom:16,fontFamily:"'Barlow Condensed',sans-serif" }}>AKTİF DENİZCİLER</div>
    {invites.filter(inv=>inv.status==="pending").map(invite=>(<div key={invite.id} style={{ width:"100%",maxWidth:420,marginBottom:8,padding:"12px 16px",background:"rgba(6,182,212,0.1)",border:`1px solid ${t.accent}`,borderRadius:10,animation:"borderGlow 2s infinite" }}>
      <div style={{ fontSize:12,color:t.accent,fontWeight:700,fontFamily:"'Barlow Condensed',sans-serif",letterSpacing:2,marginBottom:6,display:"flex",alignItems:"center",justifyContent:"center",gap:6 }}><XAnchors size={14} color={t.accent}/> DÜELLO DAVETİ</div>
      <div style={{ fontSize:13,color:t.text,marginBottom:8 }}><span style={{ fontWeight:700 }}>{invite.fromName}</span><span style={{ color:t.textDim,fontSize:10,marginLeft:8 }}>💰 {invite.fromGold||0}</span></div>
      <div style={{ display:"flex",gap:8 }}>
        <button onClick={()=>acceptInvite(invite)} style={{ flex:1,padding:"8px 0",background:`linear-gradient(135deg,${t.accent},#0891b2)`,color:t.bg,border:"none",borderRadius:6,fontSize:12,fontWeight:700,letterSpacing:2,cursor:"pointer",fontFamily:"'Barlow Condensed',sans-serif" }}>KABUL</button>
        <button onClick={()=>rejectInvite(invite)} style={{ flex:1,padding:"8px 0",background:"transparent",color:t.hit,border:`1px solid ${t.hit}`,borderRadius:6,fontSize:12,fontWeight:700,letterSpacing:2,cursor:"pointer",fontFamily:"'Barlow Condensed',sans-serif" }}>REDDET</button>
      </div>
    </div>))}
    {sentInvite&&(<div style={{ width:"100%",maxWidth:420,marginBottom:8,padding:"12px 16px",background:"rgba(251,191,36,0.08)",border:`1px solid ${t.gold}`,borderRadius:10 }}>
      <div style={{ fontSize:11,color:t.gold,fontFamily:"'Barlow Condensed',sans-serif",letterSpacing:2,marginBottom:4 }}>DAVETİN GÖNDERİLDİ</div>
      <div style={{ fontSize:13,color:t.text,marginBottom:8 }}><span style={{ fontWeight:700 }}>{sentInvite.targetName}</span> yanıt bekliyor...<span style={{ display:"inline-block",marginLeft:6,animation:"pulse 1.5s infinite" }}>⏳</span></div>
      <button onClick={cancelInvite} style={{ padding:"6px 16px",background:"transparent",color:t.textDim,border:`1px solid ${t.border}`,borderRadius:6,fontSize:10,cursor:"pointer",fontFamily:"'Barlow Condensed',sans-serif",letterSpacing:1 }}>İPTAL</button>
    </div>)}
    {players.length===0?(<div style={{ width:"100%",maxWidth:420,padding:"30px 20px",textAlign:"center",background:t.surface,border:`1px solid ${t.border}`,borderRadius:10,marginTop:8 }}><div style={{ fontSize:24,marginBottom:8 }}>🌊</div><div style={{ fontSize:12,color:t.textDim }}>Şu an salonda kimse yok</div><div style={{ fontSize:10,color:t.textDim,marginTop:4 }}>Hızlı Oyun ile otomatik eşleşebilirsin</div></div>):(
      <div style={{ width:"100%",maxWidth:420,display:"flex",flexDirection:"column",gap:4 }}>
        <div style={{ fontSize:9,color:t.textDim,letterSpacing:2,marginBottom:4 }}>{players.length} DENİZCİ AKTİF</div>
        {players.map(p=>{const rank=getRankInfo(p.gold||0);const alreadySent=sentInvite?.targetUid===p.uid;return(<div key={p.uid} style={{ display:"flex",alignItems:"center",gap:10,padding:"10px 14px",background:t.surface,border:`1px solid ${t.border}`,borderRadius:8 }}>
          <div style={{ width:8,height:8,borderRadius:"50%",background:"#34d399",boxShadow:"0 0 6px rgba(52,211,153,0.5)" }} />
          <div style={{ flex:1,minWidth:0 }}><div style={{ display:"flex",alignItems:"center",gap:6 }}><span style={{ fontSize:13,fontWeight:700,color:t.text,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap" }}>{p.displayName}</span><span style={{ fontSize:9,color:rank.color,fontFamily:"'Barlow Condensed',sans-serif",letterSpacing:1 }}>{rank.icon} {rank.title}</span></div><div style={{ fontSize:9,color:t.textDim,marginTop:1 }}>💰 {p.gold||0} • {p.wins||0}G/{p.losses||0}M</div></div>
          <button onClick={()=>sendInvite(p.uid,p.displayName)} disabled={!!sentInvite} style={{ padding:"6px 14px",background:alreadySent?t.surfaceLight:`linear-gradient(135deg,${t.hit},#dc2626)`,color:alreadySent?t.textDim:"#fff",border:"none",borderRadius:6,fontSize:10,fontWeight:700,letterSpacing:1,cursor:sentInvite?"default":"pointer",fontFamily:"'Barlow Condensed',sans-serif",opacity:sentInvite&&!alreadySent?0.4:1 }}>{alreadySent?"BEKLENİYOR":"⚓ DÜELLO"}</button>
        </div>);})}
      </div>
    )}
    <button onClick={onBack} style={{ marginTop:20,padding:"12px 32px",background:`linear-gradient(135deg,${t.accent},#0891b2)`,color:t.bg,border:"none",borderRadius:8,fontSize:13,fontWeight:700,letterSpacing:2,cursor:"pointer",fontFamily:"'Barlow Condensed',sans-serif",textTransform:"uppercase" }}>GERİ DÖN</button>
  </div>);
}

function findMatch(myUid, myName, myGold, arenaId) {
  const queuePath = arenaId ? `matchmaking_arena/${arenaId}` : "matchmaking";
  let cancelled = false, creating = false, resolved = false;
  let unsubQueue = null, unsubMatch = null, timeoutId = null;

  const cleanup = () => {
    if (unsubQueue) { unsubQueue(); unsubQueue = null; }
    if (unsubMatch) { unsubMatch(); unsubMatch = null; }
    if (timeoutId) { clearTimeout(timeoutId); timeoutId = null; }
  };

  const finish = (data) => {
    if (resolved) return;
    resolved = true;
    cleanup();
    return data;
  };

  const queueJoinTime = Date.now();
  const promise = new Promise(async (resolve) => {
    await set(ref(db, `${queuePath}/${myUid}`), { displayName: myName, gold: myGold || STARTING_GOLD, time: Date.now() });
    onDisconnect(ref(db, `${queuePath}/${myUid}`)).remove();

    // Timeout: 60 saniye sonra eşleşme bulunamazsa iptal
    timeoutId = setTimeout(() => {
      if (!resolved && !cancelled) {
        cancelled = true;
        cleanup();
        remove(ref(db, `${queuePath}/${myUid}`)).catch(() => {});
        remove(ref(db, `match_found/${myUid}`)).catch(() => {});
        resolve(null);
      }
    }, 60000);

    // match_found dinle — biri bizi eşleştirirse buradan öğreniriz
    unsubMatch = onValue(ref(db, `match_found/${myUid}`), async (snap) => {
      if (cancelled || resolved || !snap.exists()) return;
      const data = snap.val();
      if (!data.roomId) return;
      await remove(ref(db, `match_found/${myUid}`)).catch(() => {});
      await remove(ref(db, `${queuePath}/${myUid}`)).catch(() => {});
      resolve(finish(data));
    });

    // Kuyruğu dinle — uid sıralaması ile sadece bir taraf oda oluşturur
    unsubQueue = onValue(ref(db, queuePath), async (snap) => {
      if (cancelled || resolved || creating || !snap.exists()) return;
      const queue = [];
      snap.forEach(child => { if (child.key !== myUid) queue.push({ uid: child.key, ...child.val() }); });
      if (queue.length === 0) return;
      queue.sort((a, b) => Math.abs((a.gold || STARTING_GOLD) - (myGold || STARTING_GOLD)) - Math.abs((b.gold || STARTING_GOLD) - (myGold || STARTING_GOLD)));
      // Altın penceresi: ilk 15s ±300, 15-35s ±1500, sonra herkes
      const waitedMs = Date.now() - queueJoinTime;
      const goldWindow = waitedMs < 15000 ? 300 : waitedMs < 35000 ? 1500 : 9999999;
      const eligible = queue.filter(q => Math.abs((q.gold || STARTING_GOLD) - (myGold || STARTING_GOLD)) <= goldWindow);
      if (eligible.length === 0) return;
      const opponent = eligible[0];

      // Sadece küçük uid olan taraf oda oluşturur (deterministik)
      if (myUid < opponent.uid) {
        creating = true; // Guard: bu listener tekrar çalışsa bile tekrar oda oluşturmaz
        const roomId = Math.random().toString(36).substring(2, 8).toUpperCase();
        try {
          // Önce rakibin hâlâ kuyrukta olduğunu doğrula
          const oppCheck = await get(ref(db, `${queuePath}/${opponent.uid}`));
          if (!oppCheck.exists()) { creating = false; return; }

          await set(ref(db, `rooms/${roomId}`), { p1_name: myName, p1_uid: myUid, p2_name: opponent.displayName, p2_uid: opponent.uid, phase: "placing", p1_board: null, p2_board: null, p1_ships: null, p2_ships: null, attacks: null, turn: 1, clocks: { p1: CLOCK_SECONDS, p2: CLOCK_SECONDS }, winner: null, winReason: null, eloProcessed: false, arena: arenaId || null, created: Date.now() });

          // Önce iki tarafın match_found'unu yaz, sonra kuyruktan sil
          await set(ref(db, `match_found/${myUid}`), { roomId, playerNum: 1, oppName: opponent.displayName });
          await set(ref(db, `match_found/${opponent.uid}`), { roomId, playerNum: 2, oppName: myName });
          await remove(ref(db, `${queuePath}/${myUid}`)).catch(() => {});
          await remove(ref(db, `${queuePath}/${opponent.uid}`)).catch(() => {});
        } catch (e) {
          console.error("Match creation error:", e);
          creating = false;
        }
      }
    });
  });

  promise._cancel = async () => {
    cancelled = true;
    cleanup();
    await remove(ref(db, `${queuePath}/${myUid}`)).catch(() => {});
    await remove(ref(db, `match_found/${myUid}`)).catch(() => {});
  };
  return promise;
}

export default function Game() {
  const [phase, setPhase] = useState("splash");
  const [roomId, setRoomId] = useState("");
  const [inputRoomId, setInputRoomId] = useState("");
  const [playerNum, setPlayerNum] = useState(null);
  const [playerName, setPlayerName] = useState("");
  const [opponentName, setOpponentName] = useState("");
  const [message, setMessage] = useState("");
  const [authUid, setAuthUid] = useState(null);
  const [authReady, setAuthReady] = useState(false);
  const [myProfile, setMyProfile] = useState(null);
  const [showLeaderboard, setShowLeaderboard] = useState(false);
  const [eloChange, setEloChange] = useState(null);
  const [showOnlineLobby, setShowOnlineLobby] = useState(false);
  const [matchmaking, setMatchmaking] = useState(false);
  const [matchCancelFn, setMatchCancelFn] = useState(null);
  const [selectedArena, setSelectedArena] = useState(null);
  const [showArenaSelect, setShowArenaSelect] = useState(false);
  const [goldChange, setGoldChange] = useState(null);
  const [entryFeeDeducted, setEntryFeeDeducted] = useState(null);
  const [dailyReward, setDailyReward] = useState(null);
  const [showDailyChest, setShowDailyChest] = useState(false);
  const [dailyChestModalOpen, setDailyChestModalOpen] = useState(false);
  const [showAvatarPick, setShowAvatarPick] = useState(false);
  const [oppAvatar, setOppAvatar] = useState(null);
  const oppAvatarRef = useRef(false);
  const killCountRef = useRef(0);
  const lastBotEmojiRef = useRef(0);
  const consecHitTurnsRef = useRef(0);
  const botSay = () => { /* bot emoji tepkileri kaldırıldı — istenmiyor */ };
  const firstHitVoiceRef = useRef(false);
  const isBotGameRef = useRef(false);
  const avatarFileRef = useRef(null);
  const handleAvatarUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const img = new Image();
      img.onload = () => {
        // 96x96 kare kırp + küçült → küçük base64
        const canvas = document.createElement("canvas");
        canvas.width = 96; canvas.height = 96;
        const ctx = canvas.getContext("2d");
        const side = Math.min(img.width, img.height);
        const sx = (img.width - side) / 2, sy = (img.height - side) / 2;
        ctx.drawImage(img, sx, sy, side, side, 0, 0, 96, 96);
        const dataUrl = canvas.toDataURL("image/jpeg", 0.72);
        setShowAvatarPick(false);
        if (authUid) update(ref(db, `profiles/${authUid}`), { avatar: dataUrl }).catch(()=>{});
        setMyProfile(prev => prev ? { ...prev, avatar: dataUrl } : prev);
      };
      img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  };
  const [emojiToast, setEmojiToast] = useState(null);
  const [myEmojiToast, setMyEmojiToast] = useState(null);
  const [showSurrenderConfirm, setShowSurrenderConfirm] = useState(false);
  const [afkTimer, setAfkTimer] = useState(null);
  const afkIntervalRef = useRef(null);
  const [defenseBoard, setDefenseBoard] = useState(emptyGrid);
  const [shipColorMap, setShipColorMap] = useState(() => Array.from({ length: ROWS }, () => Array(COLS).fill(null)));
  const [attackOverlay, setAttackOverlay] = useState(() => emptyGrid().map(r => r.map(() => null)));
  const [defenseOverlay, setDefenseOverlay] = useState(() => emptyGrid().map(r => r.map(() => null)));
  const [placedShips, setPlacedShips] = useState([]);
  const [selectedShip, setSelectedShip] = useState(null);
  const [rotation, setRotation] = useState(0);
  const [hoverCells, setHoverCells] = useState([]);
  const [placementConfirmed, setPlacementConfirmed] = useState(false);
  const [placementTimer, setPlacementTimer] = useState(PLACEMENT_SECONDS);
  const [myTurn, setMyTurn] = useState(false);
  const [currentShots, setCurrentShots] = useState([]);
  const [winner, setWinner] = useState(null);
  const [myHits, setMyHits] = useState(0);
  const [oppHits, setOppHits] = useState(0);
  const [blinkCells, setBlinkCells] = useState([]);
  const [manualMarks, setManualMarks] = useState(() => Array.from({ length: ROWS }, () => Array(COLS).fill(false)));
  const [damageReport, setDamageReport] = useState("");
  const [myClock, setMyClock] = useState(CLOCK_SECONDS);
  const [oppClock, setOppClock] = useState(CLOCK_SECONDS);
  const [notationEntries, setNotationEntries] = useState([]);
  const [myShipsData, setMyShipsData] = useState(null);
  const [oppShipsData, setOppShipsData] = useState(null);
  const [defHitMap, setDefHitMap] = useState(() => emptyGrid().map(r => r.map(() => false)));
  const [atkHitMap, setAtkHitMap] = useState(() => emptyGrid().map(r => r.map(() => false)));
  const [activeBoard, setActiveBoard] = useState("attack");
  const [markMode, setMarkMode] = useState(false);
  const [showReview, setShowReview] = useState(false);
  const [isWin, setIsWin] = useState(false);
  const [isBotGame, setIsBotGame] = useState(false);
  const [botBoard, setBotBoard] = useState(null);
  const [botShips, setBotShips] = useState(null);
  const [botAttackOverlay, setBotAttackOverlay] = useState(() => emptyGrid().map(r => r.map(() => null)));
  const [botName, setBotName] = useState("");
  const [dailyMissions, setDailyMissions] = useState(() => pickDailyMissions(Date.now()));
  const [missionProgress, setMissionProgress] = useState({});
  const [missionStats, setMissionStats] = useState({ shipsSunk:0, wins:0, totalHits:0, perfectTurn:false, fastWin:false, botWin:false, gamesPlayed:0 });
  const [chestReward, setChestReward] = useState(null);
  const [chestClaimed, setChestClaimed] = useState(false);
  const [gameStartTime, setGameStartTime] = useState(null);
  const [hitStreak, setHitStreak] = useState(0);
  const [streakToast, setStreakToast] = useState(null);
  const [onlineCount, setOnlineCount] = useState(0);
  const [goldAnim, setGoldAnim] = useState(null);
  const [microFeedback, setMicroFeedback] = useState(null);
  const [extraTimeUsed, setExtraTimeUsed] = useState(false);
  const [placementPreview, setPlacementPreview] = useState(false);
  const [isOnboarding, setIsOnboarding] = useState(false);
  const [onboardingStep, setOnboardingStep] = useState(0);
  const [onboardingMilestones, setOnboardingMilestones] = useState({ firstHit: false, firstSunk: false });

  const unsubRef = useRef(null);
  const playerNumRef = useRef(null);
  const roomIdRef = useRef("");
  const blinkTimerRef = useRef(null);
  const damageTimerRef = useRef(null);
  const clockIntervalRef = useRef(null);
  const placementTimerRef = useRef(null);
  const myClockRef = useRef(CLOCK_SECONDS);
  const oppClockRef = useRef(CLOCK_SECONDS);
  const myTurnRef = useRef(false);
  const phaseRef = useRef("splash");
  const lastAttackCountRef = useRef(0);
  const eloUpdatedRef = useRef(false);

  const cellSize = typeof window !== "undefined" ? Math.min(30, Math.floor((Math.min(window.innerWidth - 24, 400)) / 12)) : 28;
  useEffect(() => { myTurnRef.current = myTurn; }, [myTurn]);
  useEffect(() => {
    if (phase === "lobby" && authUid && myProfile && !hasClaimedDailyChestToday()) setShowDailyChest(true);
  }, [phase, authUid, myProfile]);
  const claimDailyChest = async (amount) => {
    markDailyChestClaimed();
    setGoldAnim({ amount });
    setMyProfile(prev => prev ? { ...prev, gold: safeGold(prev.gold) + amount } : prev);
    if (authUid) {
      try {
        const snap = await get(ref(db, `profiles/${authUid}`));
        if (snap.exists()) { const p = snap.val(); await set(ref(db, `profiles/${authUid}`), { ...p, gold: safeGold(p.gold) + amount }); }
      } catch (e) { console.error(e); }
    }
    setDailyChestModalOpen(false); setShowDailyChest(false);
  };
  useEffect(() => { phaseRef.current = phase; }, [phase]);

  // Mission progress checker
  useEffect(() => {
    const newProgress = {};
    dailyMissions.forEach(m => { if (m.check(missionStats)) newProgress[m.id] = true; });
    setMissionProgress(newProgress);
  }, [missionStats, dailyMissions]);

  // Online player counter (update #9)
  useEffect(() => {
    const unsub = onValue(ref(db, "online_players"), (snap) => {
      if (!snap.exists()) { setOnlineCount(0); return; }
      let count = 0; snap.forEach(() => { count++; });
      setOnlineCount(count);
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    if (!authUid || !playerName.trim()) return;
    if (phase !== "lobby") { remove(ref(db, `online_players/${authUid}`)); return; }
    const presenceRef = ref(db, `online_players/${authUid}`);
    set(presenceRef, { displayName: playerName.trim(), gold: safeGold(myProfile?.gold), wins: myProfile?.wins || 0, losses: myProfile?.losses || 0, status: "idle", lastSeen: Date.now() });
    onDisconnect(presenceRef).remove();
    return () => { remove(presenceRef); };
  }, [authUid, playerName, phase, myProfile?.gold]);

  useEffect(() => {
    if (phase === "placing" && !placementConfirmed) {
      if (placementTimerRef.current) clearInterval(placementTimerRef.current);
      placementTimerRef.current = setInterval(() => { setPlacementTimer(prev => {
        if (prev <= 1) {
          clearInterval(placementTimerRef.current);
          // Süre bitti — kaybettin
          if (isBotGame) {
            setWinner("Gemileri zamanında yerleştiremediğin için kaybettin!"); setIsWin(false); setPhase("gameover");
            sfx.init(); sfx.play('lose'); sfx.playDefeatMusic();
          } else if (roomIdRef.current) {
            // Online: rakip kazansın
            const oppNum = playerNumRef.current === 1 ? 2 : 1;
            update(ref(db, `rooms/${roomIdRef.current}`), { winner: oppNum, winReason: "placement_timeout" }).catch(() => {});
          }
          return 0;
        }
        return prev - 1;
      }); }, 1000);
    }
    return () => { if (placementTimerRef.current) clearInterval(placementTimerRef.current); };
  }, [phase, placementConfirmed]);

  useEffect(() => {
    if (phase === "playing") {
      if (clockIntervalRef.current) clearInterval(clockIntervalRef.current);
      clockIntervalRef.current = setInterval(() => {
        if (phaseRef.current !== "playing") return;
        if (myTurnRef.current) { myClockRef.current = Math.max(0, myClockRef.current - 1); setMyClock(myClockRef.current); if (myClockRef.current <= 0) { clearInterval(clockIntervalRef.current); if (isBotGameRef.current) { setWinner("Süren doldu!"); setIsWin(false); setPhase("gameover"); sfx.init(); sfx.play('lose'); sfx.playDefeatMusic(); } else { update(ref(db, `rooms/${roomIdRef.current}`), { winner: playerNumRef.current === 1 ? 2 : 1, winReason: "timeout" }); } } }
        else { oppClockRef.current = Math.max(0, oppClockRef.current - 1); setOppClock(oppClockRef.current); if (oppClockRef.current <= 0) { clearInterval(clockIntervalRef.current); update(ref(db, `rooms/${roomIdRef.current}`), { winner: playerNumRef.current, winReason: "timeout" }); } }
      }, 1000);
    }
    return () => { if (clockIntervalRef.current) clearInterval(clockIntervalRef.current); };
  }, [phase]);

  // AFK turn tracker — 45 saniye oynamazsa son 15s geri sayım, sonra kaybeder (sadece online)
  useEffect(() => {
    if (phase !== "playing" || isBotGame) { if (afkIntervalRef.current) { clearInterval(afkIntervalRef.current); afkIntervalRef.current = null; } setAfkTimer(null); return; }
    // Sıra değişince timer sıfırla
    if (afkIntervalRef.current) clearInterval(afkIntervalRef.current);
    if (!myTurn) {
      // Rakip oynamıyor — geri sayım başlat
      let secs = 45;
      setAfkTimer(secs);
      afkIntervalRef.current = setInterval(() => {
        secs--;
        setAfkTimer(secs);
        if (secs <= 0) {
          clearInterval(afkIntervalRef.current); afkIntervalRef.current = null;
          setAfkTimer(null);
          // Rakip AFK → biz kazandık
          if (roomIdRef.current) {
            update(ref(db, `rooms/${roomIdRef.current}`), { winner: playerNumRef.current, winReason: "afk_timeout" }).catch(()=>{});
          }
        }
      }, 1000);
    } else {
      setAfkTimer(null);
    }
    return () => { if (afkIntervalRef.current) { clearInterval(afkIntervalRef.current); afkIntervalRef.current = null; } };
  }, [myTurn, phase, isBotGame]);

  const listenToRoom = useCallback((rid, pNum) => {
    if (unsubRef.current) unsubRef.current();
    const gameRef = ref(db, `rooms/${rid}`);
    unsubRef.current = onValue(gameRef, (snapshot) => {
      const game = snapshot.val(); if (!game) return;
      const myKey = pNum === 1 ? "p1" : "p2", oppKey = pNum === 1 ? "p2" : "p1";
      if (game[`${oppKey}_name`]) setOpponentName(game[`${oppKey}_name`]);
      if (game[`${myKey}_ships`]) setMyShipsData(game[`${myKey}_ships`]);
      if (game[`${oppKey}_ships`]) setOppShipsData(game[`${oppKey}_ships`]);
      if (game.phase === "placing" && !placementConfirmed) setPhase("placing");
      // Rakip avatarını profilinden çek (bir kez)
      const oppUid = pNum === 1 ? game.p2_uid : game.p1_uid;
      if (oppUid && !oppAvatarRef.current) { oppAvatarRef.current = true; get(ref(db, `profiles/${oppUid}/avatar`)).then(s => { if (s.exists()) setOppAvatar(s.val()); }).catch(()=>{}); }
      if (game.phase === "playing") {
        if (phaseRef.current === "placing") { setPhase("ready"); sfx.init(); sfx.playBattleMusic(); }
        else if (phaseRef.current !== "ready") setPhase("playing");
        setMyTurn(game.turn === pNum);
        if (game.clocks) { myClockRef.current = game.clocks[myKey] ?? CLOCK_SECONDS; oppClockRef.current = game.clocks[oppKey] ?? CLOCK_SECONDS; setMyClock(myClockRef.current); setOppClock(oppClockRef.current); }
      }
      if (game.attacks) {
        const attacks = Object.values(game.attacks);
        const defOvr = emptyGrid().map(r => r.map(() => null)), dHitMap = emptyGrid().map(r => r.map(() => false)); let oh = 0;
        attacks.filter(a => a.target === myKey).forEach(a => { if (a.shots) a.shots.forEach(s => { defOvr[s.r][s.c] = s.result; if (s.result === "hit") { oh++; dHitMap[s.r][s.c] = true; } }); });
        setDefenseOverlay(defOvr); setOppHits(oh); setDefHitMap(dHitMap);
        const atkOvr = emptyGrid().map(r => r.map(() => null)), aHitMap = emptyGrid().map(r => r.map(() => false)); let mh = 0;
        attacks.filter(a => a.target === oppKey).forEach(a => { if (a.shots) a.shots.forEach(s => { atkOvr[s.r][s.c] = s.result; if (s.result === "hit") { mh++; aHitMap[s.r][s.c] = true; } }); });
        if (game[`${oppKey}_ships`]) { let sunkTotal = 0; Object.values(game[`${oppKey}_ships`]).forEach(ship => { const cells = ship.cells; if (cells.every(([r, c]) => atkOvr[r][c] === "hit" || atkOvr[r][c] === "sunk")) { cells.forEach(([r, c]) => { atkOvr[r][c] = "sunk"; }); sunkTotal++; } });
          if (sunkTotal > killCountRef.current) { killCountRef.current = sunkTotal; } }
        setAttackOverlay(atkOvr); setMyHits(mh); setAtkHitMap(aHitMap);
        const entries = []; let p1T = 0, p2T = 0;
        attacks.forEach(a => { const isP1 = a.by === 1; if (isP1) p1T++; else p2T++; entries.push({ name: isP1 ? (game.p1_name || "P1") : (game.p2_name || "P2"), turnNum: isP1 ? p1T : p2T, coords: a.shots ? a.shots.map(s => coordStr(s.r, s.c)) : [], isMine: a.by === pNum }); });
        setNotationEntries(entries);
        if (attacks.length > lastAttackCountRef.current) {
          const lastAtk = attacks[attacks.length - 1]; lastAttackCountRef.current = attacks.length;
          if (lastAtk.target === myKey && lastAtk.shots) {
            setBlinkCells(lastAtk.shots.map(s => [s.r, s.c])); if (blinkTimerRef.current) clearTimeout(blinkTimerRef.current); blinkTimerRef.current = setTimeout(() => setBlinkCells([]), 3000); setActiveBoard("defense");
            // Sound for incoming hits
            const incomingHits = lastAtk.shots.filter(s => s.result === "hit").length;
            sfx.init(); if (incomingHits > 0) sfx.play('hit');
            if (game[`${myKey}_ships`]) { const myShips = Object.values(game[`${myKey}_ships`]); const reports = []; lastAtk.shots.forEach(s => { if (s.result === "hit") { const hitShip = myShips.find(sh => sh.cells.some(([r, c]) => r === s.r && c === s.c)); if (hitShip) { const shipDef = SHIPS.find(sd => sd.id === hitShip.id); const totalH = hitShip.cells.filter(([r, c]) => dHitMap[r][c]).length; reports.push(totalH === hitShip.cells.length ? `${shipDef?.name} battı!` : `${shipDef?.name} ${totalH}. yarasını aldı`); } } }); if (reports.length > 0) { setDamageReport(reports.join(" • ")); if (!firstHitVoiceRef.current) { firstHitVoiceRef.current = true; sfx.playVoice('first_kill'); } setMicroFeedback({ text: reports.length ? reports[reports.length-1].toLocaleUpperCase('tr-TR') : fbPick(FB_GOT_HIT), color: t.hit }); if (damageTimerRef.current) clearTimeout(damageTimerRef.current); damageTimerRef.current = setTimeout(() => setDamageReport(""), 8000); if (reports.some(r => r.includes('battı'))) setTimeout(() => { sfx.play('sunk'); launchExplosion('confetti-canvas', window.innerWidth/2, window.innerHeight/2); }, 200); } }
          }
          if (lastAtk.by === pNum && lastAtk.shots) {
            setBlinkCells(lastAtk.shots.map(s => [s.r, s.c])); if (blinkTimerRef.current) clearTimeout(blinkTimerRef.current); blinkTimerRef.current = setTimeout(() => setBlinkCells([]), 3000);
            // Sound for own shots landing
            const myHitCount = lastAtk.shots.filter(s => s.result === "hit").length;
            sfx.init(); if (myHitCount > 0) { sfx.play('hit'); sfx.setBattleIntensity(0.55 + myHitCount * 0.1); if (!firstHitVoiceRef.current) { firstHitVoiceRef.current = true; sfx.playVoice('first_kill'); } if (myHitCount === 3) sfx.playVoice('triple_kill'); else if (myHitCount === 2) sfx.playVoice('double_kill'); setMicroFeedback({ text: fbPick(myHitCount === 3 ? FB_HIT3 : myHitCount === 2 ? FB_HIT2 : FB_HIT1), color: myHitCount === 3 ? t.gold : t.accent }); } else { sfx.play('miss'); sfx.setBattleIntensity(0.18); setMicroFeedback({ text: fbPick(FB_MISS), color: '#4dd8ff' }); }
          }
        }
      }
      if (game.winner) {
        const reason = game.winReason || "hits", iW = game.winner === pNum;
        let winMsg = iW ? (reason === "timeout" ? "Süre bitti — Rakip elendi!" : reason === "placement_timeout" ? "Rakip gemileri zamanında yerleştiremediği için kazandın!" : reason === "surrender" ? "Rakip teslim oldu!" : reason === "afk_timeout" ? "Rakip oynamadı — Kazandın!" : "Tüm gemileri batırdın!") : (reason === "timeout" ? "Süren doldu!" : reason === "placement_timeout" ? "Gemileri zamanında yerleştiremediğin için kaybettin!" : reason === "surrender" ? "Teslim oldun!" : reason === "afk_timeout" ? "Oynamadığın için kaybettin!" : "Gemilerin battı!");
        setWinner(winMsg); setIsWin(iW); setPhase("gameover");
        sfx.init(); sfx.play(iW ? 'win' : 'lose');
        if (iW) { setTimeout(() => sfx.playEpicMusic(), 500); setTimeout(() => launchConfetti('confetti-canvas'), 300); }
        else { setTimeout(() => sfx.playDefeatMusic(), 500); }
        if (clockIntervalRef.current) clearInterval(clockIntervalRef.current);

        // ELO güncelleme — sadece bir kez, sadece kazanan tarafından
        if (!eloUpdatedRef.current && game.p1_uid && game.p2_uid) {
          const winnerUid = game.winner === 1 ? game.p1_uid : game.p2_uid, loserUid = game.winner === 1 ? game.p2_uid : game.p1_uid;
          const gameArena = game.arena ? ARENAS.find(a => a.id === game.arena) : null;

          if (iW && !game.eloProcessed) {
            eloUpdatedRef.current = true;
            // runTransaction ile atomik kontrol — iki tab aynı anda yazamaz
            runTransaction(ref(db, `rooms/${roomIdRef.current}/eloProcessed`), (current) => {
              if (current === true) return; // Zaten işlendi, iptal
              return true;
            }).then(async (txResult) => {
              if (!txResult.committed) return; // Başka biri zaten işledi
              try {
                const result = await updateEloAfterGame(winnerUid, loserUid, gameArena);
                if (result) {
                  await update(ref(db, `rooms/${roomIdRef.current}`), { eloResult: { winnerOldGold: result.winnerOldGold, winnerNewGold: result.winnerNewGold, loserOldGold: result.loserOldGold, loserNewGold: result.loserNewGold, winGold: result.winGold || 0, loseGold: result.loseGold || 0, winnerLevel: result.winnerLevel, winnerLevelProgress: result.winnerLevelProgress, loserLevel: result.loserLevel, loserLevelProgress: result.loserLevelProgress } });
                  setEloChange({ myOld: result.winnerOldGold, myNew: result.winnerNewGold, oppOld: result.loserOldGold, oppNew: result.loserNewGold });
                  setGoldChange({ amount: result.winGold || 0 });
                  if (result.winGold > 0) { sfx.play('gold'); setGoldAnim({ amount: result.winGold }); }
                  setMyProfile(prev => prev ? { ...prev, wins: (prev.wins || 0) + 1, totalGames: (prev.totalGames || 0) + 1, gold: result.winnerNewGold, level: result.winnerLevel, levelProgress: result.winnerLevelProgress } : prev);
                }
              } catch (e) { console.error("ELO update error:", e); }
            }).catch(e => console.error("ELO transaction error:", e));

          } else if (!iW) {
            eloUpdatedRef.current = true;
            // Kaybeden: eloResult'ı dinle (setTimeout yerine listener — daha güvenilir)
            const eloResultRef = ref(db, `rooms/${roomIdRef.current}/eloResult`);
            const unsubElo = onValue(eloResultRef, (eloSnap) => {
              if (!eloSnap.exists()) return;
              const er = eloSnap.val();
              unsubElo(); // Bir kez oku, kapat
              setEloChange({ myOld: er.loserOldGold, myNew: er.loserNewGold, oppOld: er.winnerOldGold, oppNew: er.winnerNewGold });
              setGoldChange({ amount: er.loseGold || 0 });
              setMyProfile(prev => prev ? { ...prev, losses: (prev.losses || 0) + 1, totalGames: (prev.totalGames || 0) + 1, gold: er.loserNewGold, level: er.loserLevel, levelProgress: er.loserLevelProgress } : prev);
            });
            // 10 saniye timeout — kazanan çökerse sonsuza kadar beklemesin
            setTimeout(() => {
              unsubElo();
              if (!eloChange) {
                get(ref(db, `profiles/${pNum === 1 ? game.p1_uid : game.p2_uid}`)).then(snap => {
                  if (snap.exists()) setMyProfile(prev => prev ? { ...prev, ...snap.val() } : prev);
                }).catch(() => {});
              }
            }, 10000);
          }
        }
      }
    });
  }, [placementConfirmed]);

  useEffect(() => {
    if (!roomId || (phase !== "playing" && phase !== "placing")) return;
    const emojiRef = ref(db, `emojis/${roomId}`);
    const unsub = onValue(emojiRef, (snap) => { if (!snap.exists()) return; const data = snap.val(); if (data.from !== playerNumRef.current && Date.now() - data.time < 5000) { setEmojiToast({ emoji: data.emoji, label: data.label }); setTimeout(() => setEmojiToast(null), 3000); } });
    return () => unsub();
  }, [roomId, phase]);

  useEffect(() => () => { if (unsubRef.current) unsubRef.current(); if (clockIntervalRef.current) clearInterval(clockIntervalRef.current); if (blinkTimerRef.current) clearTimeout(blinkTimerRef.current); if (damageTimerRef.current) clearTimeout(damageTimerRef.current); if (placementTimerRef.current) clearInterval(placementTimerRef.current); }, []);

  useEffect(() => {
    if (isTestMode()) {
      signInAnonymously(auth).then(result => {
        const uid = result.user.uid;
        setAuthUid(uid);
        ensureProfile(uid, `Test_${uid.substring(0, 4)}`).then(p => { setMyProfile(p); setPlayerName(p.displayName); setAuthReady(true); }).catch(() => setAuthReady(true));
      }).catch(e => { console.error("Test auth error:", e); setAuthReady(true); });
      return;
    }
    const unsub = onAuthStateChanged(auth, async (user) => {
      if (user) {
        setAuthUid(user.uid);
        try {
          const profile = await ensureProfile(user.uid, null);
          setMyProfile(profile);
          if (profile.displayName && profile.displayName !== "Denizci") {
            setPlayerName(profile.displayName);
          } else {
            // Set email as default display name suggestion
            const emailName = user.email ? user.email.split("@")[0] : "";
            setPlayerName(emailName);
          }
        } catch (e) { console.error("Profile error:", e); }
        setAuthReady(true);
      } else {
        setAuthUid(null); setMyProfile(null); setPlayerName(""); setAuthReady(true);
      }
    });
    return () => unsub();
  }, []);

  const BANNED_WORDS = ["amk","aq","oç","orospu","sikerim","sik","yarrak","piç","göt","bok","mal","gerizekalı","aptal","salak","fuck","shit","ass","dick","bitch","damn","cunt","bastard","idiot","stupid","pussy","cock","whore","slut","nigger","faggot"];

  const containsBadWord = (name) => {
    const lower = name.toLowerCase().replace(/[^a-züöçşığ]/g, "");
    return BANNED_WORDS.some(w => lower.includes(w));
  };

  const handleAnonPlay = async () => {
    try {
      await signInAnonymously(auth);
      // onAuthStateChanged akışı devralır: profil oluşur (tek seferlik 500 altın), isim ekranı gelir
    } catch (e) {
      console.error("Anon login error:", e);
      setMessage("Bağlantı hatası — tekrar dene");
    }
  };

  const handleGoogleLogin = async () => {
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (e) {
      console.error("Google login error:", e);
      setMessage("Giriş başarısız: " + (e.code === "auth/popup-closed-by-user" ? "Pencere kapatıldı" : e.message));
    }
  };

  const handleSetUsername = async () => {
    const name = playerName.trim();
    if (!name || name.length < 2) { setMessage("En az 2 karakter!"); return; }
    if (name.length > 16) { setMessage("En fazla 16 karakter!"); return; }
    if (containsBadWord(name)) { setMessage("Bu isim uygun değil!"); return; }
    // Check if username is taken
    const profilesSnap = await get(ref(db, "profiles"));
    if (profilesSnap.exists()) {
      let taken = false;
      profilesSnap.forEach(child => {
        if (child.key !== authUid && child.val().displayName?.toLowerCase() === name.toLowerCase()) taken = true;
      });
      if (taken) { setMessage("Bu isim zaten alınmış!"); return; }
    }
    // Check 14-day name lock
    if (myProfile && myProfile.nameSetAt) {
      const daysSince = (Date.now() - myProfile.nameSetAt) / (1000 * 60 * 60 * 24);
      if (daysSince < 14 && myProfile.displayName !== "Denizci") {
        const remaining = Math.ceil(14 - daysSince);
        setMessage(`İsim ${remaining} gün sonra değiştirilebilir!`);
        return;
      }
    }
    const profile = await ensureProfile(authUid, name);
    // Save nameSetAt timestamp
    await set(ref(db, `profiles/${authUid}/nameSetAt`), Date.now());
    profile.nameSetAt = Date.now();
    setMyProfile(profile);
    setPlayerName(name);
    // Check if onboarding needed
    if (!profile.onboardingDone) {
      setTimeout(() => startOnboarding(), 100);
      return;
    }
    setPhase("lobby");
    sfx.init(); if (!sfx._audioEl) sfx.playAmbientIntro(); else { sfx._audioEl.volume = 0.10; }
  };

  const handleLogout = async () => {
    if (authUid) { remove(ref(db, `online_players/${authUid}`)).catch(() => {}); }
    await signOut(auth);
    setAuthUid(null); setMyProfile(null); setPlayerName(""); setPhase("splash");
  };

  const canChangeName = () => {
    if (!myProfile) return true;
    if (!myProfile.displayName || myProfile.displayName === "Denizci") return true;
    if (!myProfile.nameSetAt) return true;
    return (Date.now() - myProfile.nameSetAt) / (1000 * 60 * 60 * 24) >= 14;
  };

  useEffect(() => { const handler = (e) => { if (e.key === "r" || e.key === "R") setRotation(prev => (prev + 1) % 4); }; window.addEventListener("keydown", handler); return () => window.removeEventListener("keydown", handler); }, []);

  const createRoom = async (arenaOverride) => {
    if (!playerName.trim()) { setMessage("Adını yaz!"); return; }
    if (!authUid) { setMessage("Bağlantı bekleniyor..."); return; }
    // Profile already loaded at login — just update displayName locally
    if (myProfile && playerName.trim() !== myProfile.displayName) {
      try { await set(ref(db, `profiles/${authUid}/displayName`), playerName.trim()); } catch(e) { console.error(e); }
    }
    const arena = arenaOverride || selectedArena;
    if (arena) { const cg = safeGold(myProfile?.gold); if (cg < arena.entryFee) { setMessage("Yeterli altının yok!"); return; } const newGold = cg - arena.entryFee; try { const cleanP = await ensureProfile(authUid); cleanP.gold = newGold; await set(ref(db, `profiles/${authUid}`), cleanP); } catch(e) { console.error(e); } setMyProfile(prev => prev ? { ...prev, gold: newGold } : prev); setEntryFeeDeducted(arena.entryFee); }
    const id = Math.random().toString(36).substring(2, 8).toUpperCase();
    roomIdRef.current = id; setRoomId(id); setPlayerNum(1); playerNumRef.current = 1;
    await set(ref(db, `rooms/${id}`), { p1_name: playerName.trim(), p1_uid: authUid, p2_name: null, p2_uid: null, phase: "waiting", p1_board: null, p2_board: null, p1_ships: null, p2_ships: null, attacks: null, turn: 1, clocks: { p1: CLOCK_SECONDS, p2: CLOCK_SECONDS }, winner: null, winReason: null, eloProcessed: false, arena: arena?.id || null, created: Date.now() });
    setPhase("waiting"); listenToRoom(id, 1);
  };

  const joinRoom = async () => {
    if (!playerName.trim() || !inputRoomId.trim()) { setMessage("Adını ve oda kodunu yaz!"); return; }
    if (!authUid) { setMessage("Bağlantı bekleniyor..."); return; }
    const rid = inputRoomId.trim().toUpperCase();
    const snapshot = await get(ref(db, `rooms/${rid}`)); if (!snapshot.exists()) { setMessage("Oda bulunamadı!"); return; }
    const game = snapshot.val(); if (game.p2_name) { setMessage("Oda dolu!"); return; }
    if (game.arena) { const arena = ARENAS.find(a => a.id === game.arena); if (arena) { const cg = safeGold(myProfile?.gold); if (cg < arena.entryFee) { setMessage(`Bu arena için ${arena.entryFee} 💰 gerekli!`); return; } const newGold = cg - arena.entryFee; const cleanP = await ensureProfile(authUid); cleanP.gold = newGold; await set(ref(db, `profiles/${authUid}`), cleanP); setMyProfile(prev => prev ? { ...prev, gold: newGold } : prev); setEntryFeeDeducted(arena.entryFee); } }
    roomIdRef.current = rid; setRoomId(rid); setPlayerNum(2); playerNumRef.current = 2; setOpponentName(game.p1_name);
    await update(ref(db, `rooms/${rid}`), { p2_name: playerName.trim(), p2_uid: authUid, phase: "placing" });
    setPhase("placing"); listenToRoom(rid, 2);
    sfx.init(); sfx.playPlacementMusic();
  };

  const autoPlaceShips = () => {
    if (placementConfirmed) return;
    const { board, ships } = botPlaceShips();
    const nc = Array.from({ length: ROWS }, () => Array(COLS).fill(null));
    const placed = ships.map(s => {
      const def = SHIPS.find(sd => sd.id === s.id);
      s.cells.forEach(([cr, cc]) => { nc[cr][cc] = def?.color || t.accent; });
      return { id: s.id, cells: s.cells, color: def?.color, row: s.row, col: s.col, rot: s.rot };
    });
    setDefenseBoard(board);
    setShipColorMap(nc);
    setPlacedShips(placed);
    setSelectedShip(null); setHoverCells([]); setRotation(0);
    sfx.init(); sfx.play('click');
  };
  const handleDefenseClick = (r, c) => {
    if (phase !== "placing" || placementConfirmed) return;
    if (!selectedShip) return; const ship = SHIPS.find(s => s.id === selectedShip); if (!ship) return; const cells = getShipCells(ship, r, c, rotation); const bc = defenseBoard.map(row => [...row]); if (!isValidPlacement(cells, bc) || getNeighborCells(cells).some(([nr, nc]) => nr >= 0 && nr < ROWS && nc >= 0 && nc < COLS && bc[nr][nc] > 0)) { /* Invalid placement — try next rotation */ const nextRot = (rotation + 1) % 4; const cells2 = getShipCells(ship, r, c, nextRot); if (isValidPlacement(cells2, bc) && !getNeighborCells(cells2).some(([nr, nc]) => nr >= 0 && nr < ROWS && nc >= 0 && nc < COLS && bc[nr][nc] > 0)) { setRotation(nextRot); return; } return; } const nb = bc.map(row => [...row]); const nc = shipColorMap.map(row => [...row]); cells.forEach(([cr, cc]) => { nb[cr][cc] = 1; nc[cr][cc] = ship.color; }); setDefenseBoard(nb); setShipColorMap(nc); setPlacedShips([...placedShips, { id: ship.id, cells, color: ship.color, row: r, col: c, rot: rotation }]); setSelectedShip(null); setHoverCells([]); setRotation(0); sfx.init(); sfx.play('click'); };
  const dragRef = useRef(null);
  const getCellFromPoint = (x, y) => {
    const el = document.elementFromPoint(x, y);
    const cellEl = el?.closest?.('[data-cell]');
    if (!cellEl) return null;
    const rr = Number(cellEl.dataset.r), cc = Number(cellEl.dataset.c);
    if (Number.isNaN(rr) || Number.isNaN(cc)) return null;
    return [rr, cc];
  };
  const commitShipPosition = (target, cells, row, col, rot) => {
    setDefenseBoard(prevBoard => {
      const nb = prevBoard.map(row2 => [...row2]);
      target.cells.forEach(([tr, tc]) => { nb[tr][tc] = 0; });
      cells.forEach(([cr, cc]) => { nb[cr][cc] = 1; });
      return nb;
    });
    setShipColorMap(prevColors => {
      const nc = prevColors.map(row2 => [...row2]);
      target.cells.forEach(([tr, tc]) => { nc[tr][tc] = null; });
      cells.forEach(([cr, cc]) => { nc[cr][cc] = target.color; });
      return nc;
    });
    setPlacedShips(prev => prev.map(p => p.id === target.id ? { ...p, cells, row, col, rot } : p));
    sfx.init(); sfx.play('click');
  };
  const handlePointerMove = (e) => {
    const d = dragRef.current; if (!d) return;
    const point = e.touches ? e.touches[0] : e;
    if (!point) return;
    const dx = point.clientX - d.startX, dy = point.clientY - d.startY;
    if (!d.moved && Math.hypot(dx, dy) > 6) d.moved = true;
    if (!d.moved) return;
    if (e.cancelable) e.preventDefault();
    const cell = getCellFromPoint(point.clientX, point.clientY);
    if (!cell) return;
    const [rr, cc] = cell;
    d.lastR = rr; d.lastC = cc;
    const newRow = rr - d.offR, newCol = cc - d.offC;
    setHoverCells(getShipCells(d.shipDef, newRow, newCol, d.origRot));
  };
  const finishDragListeners = () => {
    window.removeEventListener("mousemove", handlePointerMove);
    window.removeEventListener("mouseup", handlePointerUp);
    window.removeEventListener("touchmove", handlePointerMove);
    window.removeEventListener("touchend", handlePointerUp);
  };
  const handlePointerUp = () => {
    const d = dragRef.current;
    finishDragListeners();
    dragRef.current = null;
    setHoverCells([]);
    if (!d) return;
    const target = placedShips.find(p => p.id === d.shipId);
    if (!target) return;
    const boardNoShip = defenseBoard.map(row => [...row]);
    target.cells.forEach(([tr, tc]) => { boardNoShip[tr][tc] = 0; });
    const conflicts = (cells) => !isValidPlacement(cells, boardNoShip) || getNeighborCells(cells).some(([nr, nc]) => nr >= 0 && nr < ROWS && nc >= 0 && nc < COLS && boardNoShip[nr][nc] > 0);
    if (d.moved) {
      const newRow = d.lastR - d.offR, newCol = d.lastC - d.offC;
      const cells = getShipCells(d.shipDef, newRow, newCol, d.origRot);
      if (conflicts(cells)) return; // geçersiz bırakma — gemi yerinde kalır
      commitShipPosition(target, cells, newRow, newCol, d.origRot);
    } else {
      // basit tıklama = saat yönünde döndür
      for (let i = 1; i <= 3; i++) {
        const tryRot = (d.origRot + i) % 4;
        const raw = getShipCells(d.shipDef, d.origRow, d.origCol, tryRot);
        const { cells, dr, dc } = shiftIntoBounds(raw);
        if (!conflicts(cells)) { commitShipPosition(target, cells, d.origRow + dr, d.origCol + dc, tryRot); break; }
      }
    }
  };
  const handleShipPointerDown = (r, c, e) => {
    if (phase !== "placing" || placementConfirmed || selectedShip) return;
    if (!(defenseBoard[r]?.[c] > 0)) return;
    const target = placedShips.find(p => p.cells.some(([pr, pc]) => pr === r && pc === c));
    if (!target) return;
    const shipDef = SHIPS.find(s => s.id === target.id);
    if (!shipDef) return;
    const point = e.touches ? e.touches[0] : e;
    dragRef.current = { shipId: target.id, shipDef, moved: false, startX: point.clientX, startY: point.clientY, origRow: target.row, origCol: target.col, origRot: target.rot, offR: r - target.row, offC: c - target.col, lastR: r, lastC: c };
    window.addEventListener("mousemove", handlePointerMove);
    window.addEventListener("mouseup", handlePointerUp);
    window.addEventListener("touchmove", handlePointerMove, { passive: false });
    window.addEventListener("touchend", handlePointerUp);
  };
  const handleDefenseHover = (r, c) => { if (phase !== "placing" || !selectedShip || placementConfirmed) { setHoverCells([]); return; } const ship = SHIPS.find(s => s.id === selectedShip); if (!ship) return; setHoverCells(getShipCells(ship, r, c, rotation)); };
  const undoLastShip = () => { if (placedShips.length === 0) return; const last = placedShips[placedShips.length - 1]; const nb = defenseBoard.map(row => [...row]); const nc = shipColorMap.map(row => [...row]); last.cells.forEach(([r, c]) => { nb[r][c] = 0; nc[r][c] = null; }); setDefenseBoard(nb); setShipColorMap(nc); setPlacedShips(placedShips.slice(0, -1)); };
  const buyExtraTime = async () => {
    if (extraTimeUsed) return;
    const cost = 10;
    if (safeGold(myProfile?.gold) < cost) { setMessage("Yeterli altının yok!"); return; }
    setExtraTimeUsed(true);
    setPlacementTimer(prev => prev + 10);
    const newGold = safeGold(myProfile?.gold) - cost;
    setMyProfile(prev => prev ? { ...prev, gold: newGold } : prev);
    if (authUid) {
      try {
        const snap = await get(ref(db, `profiles/${authUid}`));
        if (snap.exists()) { const p = snap.val(); await set(ref(db, `profiles/${authUid}`), { ...p, gold: safeGold(p.gold) - cost }); }
      } catch(e) { console.error(e); }
    }
    sfx.init(); sfx.play('gold');
  };
  const confirmPlacement = async () => {
    if (placedShips.length !== SHIPS.length) return;
    // Show preview first
    if (!placementPreview) { setPlacementPreview(true); return; }
    if (placementTimerRef.current) clearInterval(placementTimerRef.current);
    const shipData = {}; placedShips.forEach((s, i) => { shipData[i] = { id: s.id, cells: s.cells }; });
    setMyShipsData(shipData);
    setPlacementConfirmed(true);
    setPlacementPreview(false);
    sfx.init(); sfx.play('click');
    if (isBotGame) {
      setPhase("playing"); setMyTurn(true); setActiveBoard("attack");
      sfx.init(); sfx.playBattleMusic(false); // oyun başladı → alçak volume
      return;
    }
    const pNum = playerNumRef.current, myKey = pNum === 1 ? "p1" : "p2", oppKey = pNum === 1 ? "p2" : "p1";
    await update(ref(db, `rooms/${roomIdRef.current}`), { [`${myKey}_board`]: defenseBoard, [`${myKey}_ships`]: shipData });
    const snapshot = await get(ref(db, `rooms/${roomIdRef.current}`));
    if (snapshot.val()?.[`${oppKey}_board`]) await update(ref(db, `rooms/${roomIdRef.current}`), { phase: "playing" });
  };
  const handleAttackClick = (r, c) => { if (!myTurn || phase !== "playing") return; if (markMode) { handleAttackMark(r, c); return; } if (attackOverlay[r][c]) return; if (manualMarks[r][c]) return; const existing = currentShots.findIndex(([sr, sc]) => sr === r && sc === c); if (existing !== -1) { setCurrentShots(currentShots.filter((_, i) => i !== existing)); return; } if (currentShots.length >= SHOTS_PER_TURN) return; setCurrentShots([...currentShots, [r, c]]); };
  const handleAttackRightClick = (r, c) => { handleAttackMark(r, c); };
  const handleAttackMark = (r, c) => { if (phase !== "playing") return; if (attackOverlay[r][c]) return; const nm = manualMarks.map(row => [...row]); nm[r][c] = !nm[r][c]; setManualMarks(nm); };
  const handleAttackLongPress = (r, c) => { handleAttackMark(r, c); };
  const fireShots = async () => {
    if (currentShots.length === 0) return;
    if (isBotGame) { botHandlePlayerShots(); return; }
    sfx.playVoice('explosion');
    const pNum = playerNumRef.current, myKey = pNum === 1 ? "p1" : "p2"; const snapshot = await get(ref(db, `rooms/${roomIdRef.current}`)); const game = snapshot.val(); if (!game || game.turn !== pNum) return; const targetKey = pNum === 1 ? "p2" : "p1"; const shotResults = currentShots.map(([r, c]) => ({ r, c, result: game[`${targetKey}_board`][r][c] > 0 ? "hit" : "miss" })); const existingAttacks = game.attacks ? Object.values(game.attacks) : []; const prevHits = existingAttacks.filter(a => a.target === targetKey).reduce((sum, a) => sum + (a.shots ? a.shots.filter(s => s.result === "hit").length : 0), 0); const totalHits = prevHits + shotResults.filter(s => s.result === "hit").length; const updates = {}; updates[`attacks/${existingAttacks.length}`] = { by: pNum, target: targetKey, shots: shotResults, time: Date.now() }; updates[`clocks/${myKey}`] = myClockRef.current; if (totalHits >= 20) { updates.winner = pNum; updates.winReason = "hits"; } else { updates.turn = pNum === 1 ? 2 : 1; } await update(ref(db, `rooms/${roomIdRef.current}`), updates); setCurrentShots([]);
  };
  const getAttackDisplayOverlay = () => { const ovr = attackOverlay.map(row => [...row]); currentShots.forEach(([r, c]) => { if (!ovr[r][c]) ovr[r][c] = "selected"; }); return ovr; };
  const forceEndGame = async () => { if (!roomIdRef.current) return; await update(ref(db, `rooms/${roomIdRef.current}`), { winner: playerNumRef.current, winReason: "test_force" }); };

  const surrenderGame = async () => {
    if (isBotGame) {
      setWinner("Oyundan ayrıldın!"); setIsWin(false); setPhase("gameover");
      sfx.init(); sfx.play('lose'); sfx.playDefeatMusic();
      return;
    }
    if (roomIdRef.current) {
      const oppNum = playerNumRef.current === 1 ? 2 : 1;
      await update(ref(db, `rooms/${roomIdRef.current}`), { winner: oppNum, winReason: "surrender" }).catch(() => {});
    }
  };

  const resetGame = () => {
    /* müzik devam eder */
    if (unsubRef.current) unsubRef.current(); if (clockIntervalRef.current) clearInterval(clockIntervalRef.current); if (placementTimerRef.current) clearInterval(placementTimerRef.current);
    finishDragListeners(); dragRef.current = null;
    setPhase("lobby"); setRoomId(""); setInputRoomId(""); setPlayerNum(null); setDefenseBoard(emptyGrid()); setShowSurrenderConfirm(false); setAfkTimer(null); setShipColorMap(Array.from({ length: ROWS }, () => Array(COLS).fill(null))); setAttackOverlay(emptyGrid().map(r => r.map(() => null))); setDefenseOverlay(emptyGrid().map(r => r.map(() => null))); setPlacedShips([]); setCurrentShots([]); setMyHits(0); setOppHits(0); setWinner(null); setMessage(""); setOpponentName(""); setPlacementConfirmed(false); setNotationEntries([]); setBlinkCells([]); setDamageReport(""); setManualMarks(Array.from({ length: ROWS }, () => Array(COLS).fill(false))); setMyClock(CLOCK_SECONDS); setOppClock(CLOCK_SECONDS); myClockRef.current = CLOCK_SECONDS; oppClockRef.current = CLOCK_SECONDS; setMyShipsData(null); setOppShipsData(null); setActiveBoard("attack"); setMarkMode(false); setDefHitMap(emptyGrid().map(r => r.map(() => false))); setAtkHitMap(emptyGrid().map(r => r.map(() => false))); lastAttackCountRef.current = 0; killCountRef.current = 0; firstHitVoiceRef.current = false; setPlacementTimer(PLACEMENT_SECONDS); setShowReview(false); setIsWin(false); setEloChange(null); eloUpdatedRef.current = false; setShowOnlineLobby(false); setMatchmaking(false); setMatchCancelFn(null); setSelectedArena(null); setShowArenaSelect(false); setGoldChange(null); setEmojiToast(null); setMyEmojiToast(null); setEntryFeeDeducted(null); setIsBotGame(false); isBotGameRef.current = false; setBotBoard(null); setBotShips(null); setBotAttackOverlay(emptyGrid().map(r => r.map(() => null))); setBotName(""); setGameStartTime(null); setHitStreak(0); setStreakToast(null); setGoldAnim(null); setMicroFeedback(null); setExtraTimeUsed(false); setPlacementPreview(false); setIsOnboarding(false); setOnboardingStep(0); setOnboardingMilestones({ firstHit: false, firstSunk: false });
    if (authUid) { get(ref(db, `profiles/${authUid}`)).then(snap => { if (snap.exists()) setMyProfile(snap.val()); }).catch(() => {}); }
    setTimeout(() => { sfx.init(); sfx.playBattleMusic(false); }, 300);
  };

  const sendEmoji = async (qe) => { setMyEmojiToast({ emoji: qe.emoji, label: qe.label }); setTimeout(() => setMyEmojiToast(null), 3000); if (!roomIdRef.current || isBotGame) return; await set(ref(db, `emojis/${roomIdRef.current}`), { emoji: qe.emoji, label: qe.label, from: playerNumRef.current, time: Date.now() }); };

  const startBotGame = () => {
    if (!playerName.trim()) { setMessage("Adını yaz!"); return; }
    const bot = botPlaceShips();
    const name = BOT_NAMES[Math.floor(Math.random() * BOT_NAMES.length)];
    setIsBotGame(true); isBotGameRef.current = true;
    setBotBoard(bot.board);
    setGameStartTime(Date.now());
    const shipData = {};
    bot.ships.forEach((s, i) => { shipData[i] = { id: s.id, cells: s.cells }; });
    setBotShips(shipData);
    setOppShipsData(shipData);
    setBotAttackOverlay(emptyGrid().map(r => r.map(() => null)));
    setBotName(name);
    setOpponentName(name);
    setMyTurn(true);
    setMyClock(CLOCK_SECONDS);
    setOppClock(CLOCK_SECONDS);
    setPhase("placing");
    sfx.init(); sfx.playPlacementMusic();
  };

  const startOnboarding = () => {
    const MINI = 7;
    // Oyuncunun gemileri — otomatik (sadece savunma amaçlı, bot miss edecek)
    const miniShips = [
      { id: "ikili1", name: "İkili-1", cells: [[2,2],[2,3]], color: "#2ecc71" },
      { id: "tekli1", name: "Tekli-1", cells: [[5,5]], color: "#f39c12" },
    ];
    const myBoard = Array.from({length:MINI}, () => Array(MINI).fill(0));
    const myColors = Array.from({length:MINI}, () => Array(MINI).fill(null));
    miniShips.forEach(s => s.cells.forEach(([r,c]) => { myBoard[r][c] = 1; myColors[r][c] = s.color; }));
    // Bot: AMİRAL — ortada, T şekli (2,2)(2,3)(2,4)(3,3)
    const botMiniShips = [
      { id: "amiral", name: "Amiral", cells: [[2,2],[2,3],[2,4],[3,3]], color: "#e74c3c" },
    ];
    const botBrd = Array.from({length:MINI}, () => Array(MINI).fill(0));
    botMiniShips.forEach(s => s.cells.forEach(([r,c]) => { botBrd[r][c] = 1; }));
    const shipData = {}; miniShips.forEach((s,i) => { shipData[i] = { id: s.id, cells: s.cells }; });
    const botShipData = {}; botMiniShips.forEach((s,i) => { botShipData[i] = { id: s.id, cells: s.cells }; });
    setIsBotGame(true); isBotGameRef.current = true; setIsOnboarding(true);
    setOnboardingStep(0); setOnboardingMilestones({ firstHit: false, firstSunk: false });
    setDefenseBoard(myBoard); setShipColorMap(myColors);
    setBotBoard(botBrd); setBotShips(botShipData); setOppShipsData(botShipData);
    setMyShipsData(shipData); setPlacedShips(miniShips);
    setBotAttackOverlay(Array.from({length:MINI}, () => Array(MINI).fill(null)));
    setAttackOverlay(Array.from({length:MINI}, () => Array(MINI).fill(null)));
    setDefenseOverlay(Array.from({length:MINI}, () => Array(MINI).fill(null)));
    setAtkHitMap(Array.from({length:MINI}, () => Array(MINI).fill(false)));
    setDefHitMap(Array.from({length:MINI}, () => Array(MINI).fill(false)));
    setManualMarks(Array.from({length:MINI}, () => Array(MINI).fill(false)));
    setBotName("Rakip"); setOpponentName("Rakip");
    setMyTurn(true); setMyClock(999); setOppClock(999);
    setPlacementConfirmed(true); setGameStartTime(Date.now());
    setPhase("onboarding_intro");
  };

  const botFireShots = () => {
    // Önce savunma platformuna geç, 1 sn sonra atışlar düşsün
    setActiveBoard("defense");
    setTimeout(() => botFireShotsImpl(), 1000);
  };
  const botFireShotsImpl = () => {
    const shots = isOnboarding ? botChooseShotsOnboarding(botAttackOverlay, defenseBoard, SHOTS_PER_TURN) : botChooseShots(botAttackOverlay, [], SHOTS_PER_TURN);
    const newBotOverlay = botAttackOverlay.map(row => [...row]);
    const newDefOverlay = defenseOverlay.map(row => [...row]);
    const newDefHit = defHitMap.map(row => [...row]);
    let newOppHits = oppHits;
    const reports = [];
    shots.forEach(([r, c]) => {
      const isHit = defenseBoard[r][c] > 0;
      newBotOverlay[r][c] = isHit ? "hit" : "miss";
      newDefOverlay[r][c] = isHit ? "hit" : "miss";
      if (isHit) {
        newOppHits++;
        newDefHit[r][c] = true;
        if (myShipsData) {
          const hitShip = Object.values(myShipsData).find(sh => sh.cells.some(([sr, sc]) => sr === r && sc === c));
          if (hitShip) {
            const shipDef = SHIPS.find(sd => sd.id === hitShip.id);
            const totalH = hitShip.cells.filter(([hr, hc]) => newDefHit[hr][hc]).length;
            reports.push(totalH === hitShip.cells.length ? `${shipDef?.name} battı!` : `${shipDef?.name} ${totalH}. yarasını aldı`);
          }
        }
      }
    });
    setBotAttackOverlay(newBotOverlay);
    setDefenseOverlay(newDefOverlay);
    setDefHitMap(newDefHit);
    setOppHits(newOppHits);
    setBlinkCells(shots);
    setTimeout(() => setBlinkCells([]), 3000);
    // Sound for incoming damage
    const botHitCount = shots.filter(([r,c]) => defenseBoard[r][c] > 0).length;
    if (botHitCount > 0) { sfx.play('hit'); if (!firstHitVoiceRef.current && !isOnboarding) { firstHitVoiceRef.current = true; sfx.playVoice('first_kill'); } const rep = reports.length ? reports[reports.length-1].toLocaleUpperCase('tr-TR') : fbPick(FB_GOT_HIT); setMicroFeedback({ text: rep, color: t.hit }); }
    if (botHitCount === 0) { setMicroFeedback({ text: fbPick(FB_MISS), color: '#4dd8ff' }); }
    const botSunkSomething = reports.some(r => r.includes('battı'));
    if (botSunkSomething) setTimeout(() => sfx.play('sunk'), 200);
    if (reports.length > 0) { setDamageReport(reports.join(" • ")); setTimeout(() => setDamageReport(""), 8000); }
    if (!isOnboarding) {
      // Bot'un kendi atış performansı
      if (botHitCount > 0) consecHitTurnsRef.current++; else consecHitTurnsRef.current = 0;
      if (botHitCount >= 2) botSay('🙏', 'Saygılar');                     // bot 2-3'te 3 yaptı
      else if (consecHitTurnsRef.current === 3) botSay('🔥', 'Yanıyorsun!'); // 3 tur üst üste vurdu
      else if (consecHitTurnsRef.current >= 4) botSay('🎯', 'İyi atış!');
      // Oyuncunun son gemisinin son parçası kaldı → Battın!
      if (newOppHits >= 19) botSay('💀', 'Battın!');
      else if (myClockRef.current > 0 && myClockRef.current < 60) botSay('⏳', 'Acele et!');
    }
    // Check if bot won
    if (newOppHits >= 20) {
      setWinner("Gemilerin battı!"); setIsWin(false); setPhase("gameover");
      sfx.init(); sfx.play('lose'); sfx.playDefeatMusic();
      setMissionStats(prev => ({ ...prev, gamesPlayed: prev.gamesPlayed + 1 }));
      // Bot'a yenilince küçük bir teselli altını verilir
      if (authUid && myProfile && !isOnboarding) {
        const consolationGold = 15;
        const oldGold2 = safeGold(myProfile.gold);
        const newGold2 = oldGold2 + consolationGold;
        const lvl2 = applyLevelCredit(myProfile, XP_BOT_LOSS);
        update(ref(db, `profiles/${authUid}`), { gold: newGold2, losses: (myProfile.losses||0)+1, totalGames: (myProfile.totalGames||0)+1, lastGameAt: Date.now(), level: lvl2.level, levelProgress: lvl2.levelProgress }).catch(()=>{});
        setMyProfile(prev => prev ? { ...prev, gold: newGold2, losses:(prev.losses||0)+1, totalGames:(prev.totalGames||0)+1, level: lvl2.level, levelProgress: lvl2.levelProgress } : prev);
        setGoldChange({ amount: consolationGold });
        setEloChange({ myOld: oldGold2, myNew: newGold2 });
      }
    } else {
      setTimeout(() => { setMyTurn(true); setActiveBoard("attack"); }, botSunkSomething ? 4200 : 3200);
    }
  };

  const botHandlePlayerShots = () => {
    if (currentShots.length === 0) return;
    sfx.playVoice('explosion');
    const newAtkOverlay = attackOverlay.map(row => [...row]);
    const newAtkHit = atkHitMap.map(row => [...row]);
    let newMyHits = myHits;
    const atkReports = [];
    currentShots.forEach(([r, c]) => {
      const isHit = botBoard[r][c] > 0;
      newAtkOverlay[r][c] = isHit ? "hit" : "miss";
      if (isHit) {
        newMyHits++; newAtkHit[r][c] = true;
        if (botShips) {
          const hs = Object.values(botShips).find(sh => sh.cells.some(([sr,sc]) => sr===r && sc===c));
          if (hs) {
            const sd = SHIPS.find(s => s.id === hs.id);
            const th = hs.cells.filter(([hr,hc]) => newAtkHit[hr][hc]).length;
            atkReports.push(th === hs.cells.length ? `${(sd?.name||"GEMİ").toLocaleUpperCase('tr-TR')} BATTI! 💀` : `${(sd?.name||"GEMİ").toLocaleUpperCase('tr-TR')} ${th}. YARASINI ALDI`);
          }
        }
      }
    });
    window.__lastAtkReport = atkReports.length ? atkReports[atkReports.length-1] : null;
    // Sound effects for shots
    sfx.init();
    const hitCount0 = currentShots.filter(([r,c]) => botBoard[r][c] > 0).length;
    if (hitCount0 > 0) { sfx.play('hit'); if (!isOnboarding) { if (!firstHitVoiceRef.current) { firstHitVoiceRef.current = true; sfx.playVoice('first_kill'); } if (hitCount0 === 3) sfx.playVoice('triple_kill'); else if (hitCount0 === 2) sfx.playVoice('double_kill'); }
      if (isOnboarding && !onboardingMilestones.firstHit) { setOnboardingMilestones(prev => ({...prev, firstHit: true})); setMicroFeedback({ text: 'İLK İSABET! 🎯', color: t.gold }); }
      else { const atkRep = window.__lastAtkReport; setMicroFeedback({ text: atkRep || fbPick(hitCount0 === 3 ? FB_HIT3 : hitCount0 === 2 ? FB_HIT2 : FB_HIT1), color: hitCount0 === 3 ? t.gold : t.accent }); window.__lastAtkReport = null; }
    }
    else { sfx.play('miss'); setMicroFeedback({ text: fbPick(FB_MISS), color: '#4dd8ff' }); }
    // ── BOT TEPKİLERİ (oyuncunun atışlarına — bot'un kendi gemileri) ──
    if (!isOnboarding && isBotGame) {
      // Bot'un Amiral'i vuruldu → Eyvah!
      if (window.__lastAtkReport && window.__lastAtkReport.includes('AMİRAL')) botSay('😤', 'Eyvah!');
      // Tek atış turunda bot'un 2 FARKLI gemisi vuruldu → Şanslısın
      else if (botShips && hitCount0 >= 2) {
        const hitShipIds = new Set();
        currentShots.forEach(([r,cc]) => { if (botBoard[r][cc] > 0) { const hs = Object.values(botShips).find(sh => sh.cells.some(([sr,sc]) => sr===r && sc===cc)); if (hs) hitShipIds.add(hs.id); } });
        if (hitShipIds.size >= 2) botSay('🍀', 'Şanslısın');
      }
      // Oyuncu kazanmak üzere (bot'un son parçası) → bot alkışlar
      if (newMyHits >= 19) botSay('👏', 'Tebrikler');
    }
    // Check for sunk ships
    let sunkThisTurn = false;
    if (botShips) {
      Object.values(botShips).forEach(ship => {
        const wasSunk = ship.cells.every(([r, c]) => attackOverlay[r][c] === "hit" || attackOverlay[r][c] === "sunk");
        if (ship.cells.every(([r, c]) => newAtkOverlay[r][c] === "hit" || newAtkOverlay[r][c] === "sunk")) {
          ship.cells.forEach(([r, c]) => { newAtkOverlay[r][c] = "sunk"; });
          if (!wasSunk) { sunkThisTurn = true; }
        }
      });
    }
    if (sunkThisTurn) { setTimeout(() => { sfx.play('sunk'); killCountRef.current++; launchExplosion('confetti-canvas', window.innerWidth/2, window.innerHeight/2);
      if (isOnboarding && !onboardingMilestones.firstSunk) { setOnboardingMilestones(prev => ({...prev, firstSunk: true})); setMicroFeedback({ text: 'İLK BATIŞ! 💀', color: t.sunk }); }
      else { const sr = window.__lastAtkReport && window.__lastAtkReport.includes("BATTI") ? window.__lastAtkReport : fbPick(FB_SUNK); setMicroFeedback({ text: sr, color: t.sunk }); }
      // Gemi battı → müzik zirveye çıksın
      sfx.setBattleIntensity(1.0);
      setTimeout(() => sfx.setBattleIntensity(0.35), 6000);
    }, 300); }
    // Dynamic intensity: isabet varsa heyecan artar
    if (!sunkThisTurn) {
      if (hitCount0 > 0) sfx.setBattleIntensity(0.55 + hitCount0 * 0.1);
      else sfx.setBattleIntensity(0.18);
    }
    setAttackOverlay(newAtkOverlay);
    setAtkHitMap(newAtkHit);
    setMyHits(newMyHits);
    setBlinkCells(currentShots.map(([r,c]) => [r,c]));
    setTimeout(() => setBlinkCells([]), 3000);
    setCurrentShots([]);
    // Track mission stats
    const allHit = currentShots.every(([r,c]) => botBoard[r][c] > 0);
    const sunkNow = botShips ? Object.values(botShips).filter(ship => ship.cells.every(([r,c]) => newAtkOverlay[r][c] === "hit" || newAtkOverlay[r][c] === "sunk")).length : 0;
    setMissionStats(prev => ({ ...prev, totalHits: prev.totalHits + currentShots.filter(([r,c]) => botBoard[r][c] > 0).length, perfectTurn: prev.perfectTurn || allHit, shipsSunk: Math.max(prev.shipsSunk, sunkNow) }));
    // Streak tracking
    const hitCount = currentShots.filter(([r,c]) => botBoard[r][c] > 0).length;
    if (hitCount === currentShots.length && hitCount > 0) {
      const newStreak = hitStreak + hitCount;
      setHitStreak(newStreak);
      const mult = newStreak >= 9 ? 4 : newStreak >= 6 ? 3 : newStreak >= 3 ? 2 : 1;
      if (mult > 1) { setStreakToast({ streak: newStreak, mult }); setTimeout(() => setStreakToast(null), 2500); }
    } else {
      setHitStreak(0); setStreakToast(null);
    }
    // Check if player won
    const winTarget = isOnboarding ? 4 : 20;
    if (newMyHits >= winTarget) {
      if (isOnboarding) {
        setWinner("Bu sadece başlangıçtı... Gerçek rakipler seni bekliyor!");
        // Mark onboarding done in Firebase
        if (authUid) { update(ref(db, `profiles/${authUid}`), { onboardingDone: true }).catch(() => {}); }
      } else {
        setWinner("Tüm gemileri batırdın!");
      }
      setIsWin(true); setPhase("gameover");
      sfx.init(); sfx.play('win'); setTimeout(() => launchConfetti('confetti-canvas'), 300);
      if (!isOnboarding) setTimeout(() => sfx.playEpicMusic(), 500);
      // Count sunk ships
      const sunkCount = botShips ? Object.values(botShips).filter(ship => ship.cells.every(([r,c]) => newAtkOverlay[r][c] === "hit" || newAtkOverlay[r][c] === "sunk")).length : 0;
      const elapsed = gameStartTime ? (Date.now() - gameStartTime) / 1000 : 999;
      setMissionStats(prev => ({ ...prev, wins: prev.wins + 1, botWin: true, gamesPlayed: prev.gamesPlayed + 1, totalHits: prev.totalHits + newMyHits, shipsSunk: prev.shipsSunk + sunkCount, fastWin: elapsed < 180 }));
      // Bot galibiyeti altını (seri çarpanlı)
      const streakMult = hitStreak >= 9 ? 4 : hitStreak >= 6 ? 3 : hitStreak >= 3 ? 2 : 1;
      const botWinGold = 25 * streakMult;
      if (authUid && myProfile && !isOnboarding) {
        const lvl1 = applyLevelCredit(myProfile, XP_BOT_WIN);
        const oldGold1 = safeGold(myProfile.gold);
        const newGold1 = oldGold1 + botWinGold;
        update(ref(db, `profiles/${authUid}`), { gold: newGold1, wins: (myProfile.wins||0)+1, totalGames: (myProfile.totalGames||0)+1, lastGameAt: Date.now(), level: lvl1.level, levelProgress: lvl1.levelProgress }).catch(()=>{});
        setMyProfile(prev => prev ? { ...prev, gold: newGold1, wins:(prev.wins||0)+1, totalGames:(prev.totalGames||0)+1, level: lvl1.level, levelProgress: lvl1.levelProgress } : prev);
        setEloChange({ myOld: oldGold1, myNew: newGold1 });
        setGoldChange({ amount: botWinGold });
        sfx.play('gold'); setGoldAnim({ amount: botWinGold });
      }
    } else {
      setMyTurn(false);
      setTimeout(() => botFireShots(), 3000 + Math.random() * 500);
    }
  };

  const startQuickMatch = async (arenaOverride) => {
    if (!playerName.trim()) { setMessage("Adını yaz!"); return; }
    if (!authUid) { setMessage("Bağlantı bekleniyor..."); return; }
    const arena = arenaOverride || null;
    if (arena) { const cg = safeGold(myProfile?.gold); if (cg < arena.entryFee) { setMessage("Yeterli altının yok!"); return; } const newGold = cg - arena.entryFee; try { const cleanP = await ensureProfile(authUid); cleanP.gold = newGold; await set(ref(db, `profiles/${authUid}`), cleanP); } catch(e) { console.error(e); } setMyProfile(prev => prev ? { ...prev, gold: newGold } : prev); setEntryFeeDeducted(arena.entryFee); }
    setMatchmaking(true);
    const matchPromise = findMatch(authUid, playerName.trim(), myProfile?.gold ?? STARTING_GOLD, arena?.id || null);
    setMatchCancelFn(() => matchPromise._cancel);
    matchPromise.then(data => {
      if (data && data.roomId) {
        setMatchmaking(false); setMatchCancelFn(null); roomIdRef.current = data.roomId; setRoomId(data.roomId); setPlayerNum(data.playerNum); playerNumRef.current = data.playerNum; setOpponentName(data.oppName); setPhase("placing"); listenToRoom(data.roomId, data.playerNum); if (authUid) remove(ref(db, `online_players/${authUid}`));
        sfx.init(); sfx.playPlacementMusic();
      } else {
        // Eşleşme bulunamadı (timeout) — arena ücreti varsa iade et
        setMatchmaking(false); setMatchCancelFn(null);
        if (arena && entryFeeDeducted) {
          const refundGold = safeGold(myProfile?.gold) + arena.entryFee;
          ensureProfile(authUid).then(cleanP => { cleanP.gold = refundGold; set(ref(db, `profiles/${authUid}`), cleanP); }).catch(() => {});
          setMyProfile(prev => prev ? { ...prev, gold: refundGold } : prev);
          setEntryFeeDeducted(null);
          setMessage("Rakip bulunamadı — altının iade edildi!");
        } else {
          setMessage("Rakip bulunamadı, tekrar dene!");
        }
      }
    });
  };

  const appStyle = { minHeight: "100vh", minHeight: "100dvh", width: "100%", background: t.bg, color: t.text, fontFamily: mono, display: "flex", flexDirection: "column", alignItems: "center", padding: "12px 8px", boxSizing: "border-box", overflowX: "hidden" };
  const btnStyle = { padding: "12px 28px", background: `linear-gradient(135deg, ${t.accent}, #0891b2)`, color: t.bg, border: "none", borderRadius: 8, fontSize: 13, fontWeight: 700, letterSpacing: 2, textTransform: "uppercase", cursor: "pointer", fontFamily: warrior, boxShadow: `0 0 15px ${t.accentGlow}` };
  const btnSecStyle = { padding: "8px 16px", background: "transparent", color: t.accent, border: `1px solid ${t.accent}`, borderRadius: 6, fontSize: 11, fontWeight: 600, letterSpacing: 1, cursor: "pointer", fontFamily: warrior };
  const inputStyle = { padding: "12px 16px", background: t.surface, color: t.text, border: `1px solid ${t.border}`, borderRadius: 8, fontSize: 15, fontFamily: mono, outline: "none", textAlign: "center", width: "100%", maxWidth: 260, boxSizing: "border-box" };

  if (phase === "splash") {
    const splashDone = authReady;
    if (!splashDone) {
      return <><style>{ANIMS}</style><div style={{ display:"flex",alignItems:"center",justifyContent:"center",minHeight:"100vh",background:"#050b18" }}><div style={{ width:40,height:40,borderRadius:"50%",border:"3px solid #00e5ff",borderTopColor:"transparent",animation:"spin 0.8s linear infinite" }} /><style>{"@keyframes spin{to{transform:rotate(360deg)}}"}</style></div></>;
    }
    
    // Not logged in — Google login required
    function LoginScreen() {
      const [musicStarted, setMusicStarted] = useState(false);
      const startMusic = () => { if (!musicStarted) { sfx.init(); sfx.playAmbientIntro(); setMusicStarted(true); } };
      return (<div onClick={startMusic} style={{ ...appStyle, justifyContent:"center", background:`radial-gradient(ellipse at 18% 15%, rgba(167,139,250,0.10) 0%, transparent 45%), radial-gradient(ellipse at 85% 80%, rgba(255,215,0,0.07) 0%, transparent 45%), radial-gradient(ellipse at 80% 15%, rgba(255,71,87,0.06) 0%, transparent 40%), radial-gradient(ellipse at 50% 35%, rgba(0,229,255,0.12) 0%, rgba(255,71,87,0.04) 40%, ${t.bg} 80%)`, overflow:"hidden", position:"relative", cursor:"default", animation:"pageEnter 1.2s cubic-bezier(0.16,1,0.3,1) forwards" }}><style>{ANIMS}{`
@keyframes sword3d{0%{transform:perspective(600px) rotateY(-60deg) rotateX(20deg) scale(0.3);opacity:0;filter:brightness(3)}40%{opacity:1}60%{transform:perspective(600px) rotateY(12deg) rotateX(-6deg) scale(1.18);filter:brightness(1.5)}80%{transform:perspective(600px) rotateY(-4deg) rotateX(3deg) scale(1.02);filter:brightness(1)}100%{transform:perspective(600px) rotateY(5deg) rotateX(-2deg) scale(1.05);filter:brightness(1)}}
@keyframes sword3dFloat{0%,100%{transform:perspective(600px) rotateY(5deg) rotateX(-2deg) translateY(0) scale(1.05)}50%{transform:perspective(600px) rotateY(-8deg) rotateX(5deg) translateY(-16px) scale(1.08)}}
@keyframes shimmerPass{0%{left:-100%}100%{left:200%}}
@keyframes titleSlam{0%{transform:scale(2.5) rotate(-3deg);opacity:0;filter:blur(15px)}50%{transform:scale(0.95) rotate(0.5deg);opacity:1;filter:blur(0)}100%{transform:scale(1) rotate(0)}}
@keyframes starBurst{0%{transform:scale(0) rotate(0);opacity:1}100%{transform:scale(2.5) rotate(360deg);opacity:0}}
@keyframes gemPulse{0%,100%{filter:drop-shadow(0 0 8px rgba(100,160,255,0.8))}50%{filter:drop-shadow(0 0 24px rgba(100,160,255,1)) drop-shadow(0 0 40px rgba(100,160,255,0.5))}}
      `}</style>
        {[...Array(14)].map((_,i)=><div key={i} style={{ position:"absolute",width:3,height:3,borderRadius:"50%",background:i%3===0?t.gold:i%3===1?t.accent:"#ff4757",top:`${10+Math.random()*80}%`,left:`${5+Math.random()*90}%`,animation:`starBurst ${2.5+Math.random()*2}s ease-out ${Math.random()*4}s infinite`,pointerEvents:"none",opacity:0.6 }} />)}
        <div style={{ position:"absolute",bottom:0,left:0,right:0,height:120,opacity:0.06,overflow:"hidden",pointerEvents:"none" }}>
          <div style={{ position:"absolute",bottom:0,left:"-50%",width:"200%",height:60,borderRadius:"50%",background:"linear-gradient(90deg,#00e5ff,#0088cc,#00e5ff)",animation:"wave 5s linear infinite" }} />
        </div>
        <div style={{ textAlign:"center",zIndex:1,perspective:"600px",display:"flex",flexDirection:"column",alignItems:"center" }}>
          {/* Çapraz çapa logo */}
          <div style={{ width:280,height:250,marginBottom:8,animation:"sword3d 1.2s cubic-bezier(0.34,1.56,0.64,1) forwards, sword3dFloat 4s ease-in-out 1.3s infinite",filter:"drop-shadow(0 0 60px rgba(0,229,255,0.8)) drop-shadow(0 0 120px rgba(0,229,255,0.4)) drop-shadow(0 0 20px rgba(255,255,255,0.6))" }}>
            <AnchorHeroLogo />
          </div>
          {/* Title */}
          <div style={{ animation:"titleSlam 1s cubic-bezier(0.34,1.56,0.64,1) 0.3s both" }}>
            <div style={{ fontSize:52,fontWeight:900,color:t.accent,fontFamily:warrior,letterSpacing:12,textShadow:`0 0 80px ${t.accentGlow}, 0 0 160px rgba(0,229,255,0.2), 0 6px 30px rgba(0,0,0,0.9)`,lineHeight:1.05,WebkitTextStroke:"0.5px rgba(255,255,255,0.1)" }}>AMİRAL<br/>BATTI</div>
          </div>
          <div style={{ fontSize:11,color:"rgba(255,215,0,0.6)",fontFamily:warrior,letterSpacing:8,marginTop:10,marginBottom:36,fontStyle:"italic",animation:"fadeUp 1s ease-out 1.0s both" }}>savaşların atası...</div>
          <div style={{ animation:"fadeUp 1s ease-out 1.3s both" }}>
            <div style={{ position:"relative",display:"inline-block" }}>
              <span style={{ position:"absolute",top:-9,left:-9,width:30,height:30,borderTop:"3px solid rgba(0,229,255,0.55)",borderLeft:"3px solid rgba(0,229,255,0.55)",borderTopLeftRadius:18,animation:"sonarArc 2s ease-in-out infinite",pointerEvents:"none" }} />
              <span style={{ position:"absolute",bottom:-9,right:-9,width:30,height:30,borderBottom:"3px solid rgba(0,229,255,0.55)",borderRight:"3px solid rgba(0,229,255,0.55)",borderBottomRightRadius:18,animation:"sonarArc 2s ease-in-out 1s infinite",pointerEvents:"none" }} />
              <button onClick={()=>{ startMusic(); handleAnonPlay(); }} style={{ padding:"15px 70px",background:`linear-gradient(180deg, #22d8ff 0%, ${t.accent} 45%, #0077b6 100%)`,color:"#04202e",border:"2px solid rgba(255,255,255,0.35)",borderRadius:14,fontSize:27,fontWeight:900,cursor:"pointer",fontFamily:warrior,letterSpacing:6,textTransform:"uppercase",boxShadow:`0 0 34px ${t.accentGlow}, 0 5px 0 #045a80, 0 10px 22px rgba(0,0,0,0.5), inset 0 2px 0 rgba(255,255,255,0.45)`,textShadow:"0 1px 0 rgba(255,255,255,0.4), 0 2px 3px rgba(0,60,90,0.5)",display:"flex",alignItems:"center",justifyContent:"center",gap:14,position:"relative",overflow:"hidden",animation:"btnBreath 2.2s ease-in-out infinite" }}>
                <span style={{ position:"absolute",top:0,left:"-100%",width:"50%",height:"100%",background:"linear-gradient(90deg,transparent,rgba(255,255,255,0.4),transparent)",animation:"shimmerPass 3s ease-in-out infinite" }} />
                <svg width="30" height="32" viewBox="0 0 24 26" style={{ filter:"drop-shadow(0 3px 3px rgba(0,40,60,0.55))" }}><defs><linearGradient id="playTriL" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stopColor="#ffffff"/><stop offset="60%" stopColor="#d8f6ff"/><stop offset="100%" stopColor="#8ad4f0"/></linearGradient></defs><polygon points="3,2 22,13 3,24" fill="url(#playTriL)" stroke="rgba(4,60,90,0.5)" strokeWidth="1.2"/></svg>
                OYNA
              </button>
            </div>
          </div>
          {message && <div style={{ marginTop:16,color:t.hit,fontSize:11,fontFamily:mono }}>{message}</div>}
        </div>
        {/* Sağ alt ok — müzik başlat */}
        <button onClick={startMusic} style={{ position:"absolute",bottom:28,right:28,width:52,height:52,borderRadius:"50%",background:"rgba(0,229,255,0.08)",border:"2px solid rgba(0,229,255,0.3)",color:t.accent,fontSize:22,display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",boxShadow:"0 0 20px rgba(0,229,255,0.2)",animation:"pulse 2s ease-in-out infinite",zIndex:10 }}>▶</button>
      </div>);
    }
    if (!authUid) return <LoginScreen />;
    
    // Logged in but needs username
    const needsUsername = !myProfile || !myProfile.displayName || myProfile.displayName === "Denizci";
    if (needsUsername) return (<div style={appStyle}><style>{ANIMS}</style>
      <div style={{ display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",minHeight:"80vh" }}>
        <div style={{ fontSize:30,fontWeight:700,letterSpacing:5,color:t.accent,textShadow:`0 0 30px ${t.accentGlow}`,marginBottom:6,fontFamily:warrior,animation:"fadeUp 0.4s ease-out" }}>HOŞ GELDİN!</div>
        <div style={{ fontSize:11,color:t.textDim,letterSpacing:2,marginBottom:24,fontFamily:mono }}>Denizci adını seç</div>
        <input style={{ ...inputStyle,maxWidth:300,borderRadius:10,fontSize:16 }} placeholder="Kullanıcı adın" value={playerName} onChange={e=>setPlayerName(e.target.value)} maxLength={16} />
        <div style={{ fontSize:9,color:t.textDim,marginTop:6,fontFamily:mono,textAlign:"center" }}>2-16 karakter • 14 gün boyunca değiştirilemez</div>
        <button onClick={handleSetUsername} style={{ ...btnStyle,marginTop:16,padding:"14px 40px",borderRadius:10,fontSize:15 }}>ONAYLA</button>
        {message && <div style={{ marginTop:12,color:t.hit,fontSize:11,fontFamily:mono,textAlign:"center",maxWidth:300 }}>{message}</div>}
      </div>
    </div>);
    
    // Logged in with valid username — check onboarding
    if (!isTestMode() && authUid && myProfile) {
      if (!myProfile.onboardingDone) {
        if (phase === "splash") {
          // Trigger onboarding via state change, not during render
          Promise.resolve().then(() => startOnboarding());
          return <><style>{ANIMS}</style><div style={{ display:"flex",alignItems:"center",justifyContent:"center",minHeight:"100vh",background:"#050b18" }}><div style={{ width:40,height:40,borderRadius:"50%",border:"3px solid #00e5ff",borderTopColor:"transparent",animation:"spin 0.8s linear infinite" }} /><style>{"@keyframes spin{to{transform:rotate(360deg)}}"}</style></div></>;
        }
      }
      if (phase === "splash") {
        Promise.resolve().then(() => { setPhase("lobby"); sfx.init(); if (!sfx._audioEl) sfx.playIntroFanfare(); });
        return <><style>{ANIMS}</style><div style={{ display:"flex",alignItems:"center",justifyContent:"center",minHeight:"100vh",background:"#050b18" }}><div style={{ width:40,height:40,borderRadius:"50%",border:"3px solid #00e5ff",borderTopColor:"transparent",animation:"spin 0.8s linear infinite" }} /><style>{"@keyframes spin{to{transform:rotate(360deg)}}"}</style></div></>;
      }
    }
    if (phase === "splash") {
      Promise.resolve().then(() => { setPhase("lobby"); sfx.init(); if (!sfx._audioEl) sfx.playIntroFanfare(); });
    }
    return <><style>{ANIMS}</style><div style={{ display:"flex",alignItems:"center",justifyContent:"center",minHeight:"100vh",background:"#050b18" }}><div style={{ width:40,height:40,borderRadius:"50%",border:"3px solid #00e5ff",borderTopColor:"transparent",animation:"spin 0.8s linear infinite" }} /><style>{"@keyframes spin{to{transform:rotate(360deg)}}"}</style></div></>;
  }
  if (phase === "ready") return <><style>{ANIMS}</style><ReadyScreen opponentName={opponentName} onStart={() => setPhase("playing")}  myName={playerName} myAvatar={myProfile?.avatar} oppAvatar={oppAvatar} /></>;

  // === TUTORIAL SİSTEMİ ===
  if (phase === "onboarding_intro") {
    const tutorialStep = onboardingStep;

    // Auto-advance component for splash
    function SplashAutoAdvance({ onDone }) {
      useEffect(() => { const t = setTimeout(onDone, 3000); return () => clearTimeout(t); }, []);
      return null;
    }

    const skipTutorial = () => {
      sfx.init(); sfx.play('click');
      setPhase("playing"); setActiveBoard("attack"); sfx.transitionToBattle();
    };
    const nextStep = () => { sfx.init(); sfx.play('click'); setOnboardingStep(s => s + 1); };

    // Amiral gemi animasyon bileşeni — yatay, döner, tekrar yerleşir (2 kez sonra loop)
    function AmiraldemoAnim() {
      const [rot, setRot] = useState(0); // 0=yatay, 1=dikey
      const [phase2, setPhase2] = useState('placing'); // placing|rotating|placed
      const [cycle, setCycle] = useState(0);
      useEffect(() => {
        let t1, t2, t3, t4;
        const run = () => {
          setPhase2('placing'); setRot(0);
          t1 = setTimeout(() => setPhase2('placed'), 800);
          t2 = setTimeout(() => setPhase2('rotating'), 1800);
          t3 = setTimeout(() => setRot(1), 2200);
          t4 = setTimeout(() => { setPhase2('placed'); setCycle(c => c + 1); }, 2800);
        };
        run();
        const loop = setInterval(run, 3800);
        return () => { clearInterval(loop); clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); clearTimeout(t4); };
      }, []);
      // Amiral shape: [[0,0],[0,1],[0,2],[1,1]] yatay — [[0,0],[1,0],[2,0],[1,1]] dikey
      const COLS_H = 4, ROWS_H = 3;
      const amiral_h = [[0,1],[0,2],[0,3],[1,2]]; // row,col (0-indexed), 4x3 grid
      const amiral_v = [[0,1],[1,1],[2,1],[1,2]]; // rotated
      const cells = rot === 0 ? amiral_h : amiral_v;
      const cs = 44;
      return (
        <div style={{ position:"relative",marginBottom:20,display:"flex",flexDirection:"column",alignItems:"center" }}>
          <div style={{ display:"grid",gridTemplateColumns:`repeat(4,${cs}px)`,gridTemplateRows:`repeat(3,${cs}px)`,gap:2,background:t.surface,borderRadius:10,padding:6,border:`1px solid ${t.border}` }}>
            {Array.from({length:12}).map((_,i) => {
              const r=Math.floor(i/4), c=i%4;
              const isShip = cells.some(([sr,sc])=>sr===r&&sc===c);
              return <div key={i} style={{ borderRadius:4,background:isShip?"rgba(231,76,60,0.5)":t.water,border:`1px solid ${isShip?"rgba(231,76,60,0.9)":"rgba(55,65,81,0.4)"}`,display:"flex",alignItems:"center",justifyContent:"center",transition:"all 0.35s ease",boxShadow:isShip&&phase2==='placed'?`inset 0 0 10px rgba(231,76,60,0.4)`:"none" }}>
                {isShip && <div style={{ width:8,height:8,borderRadius:"50%",background:"#e74c3c",boxShadow:"0 0 8px rgba(231,76,60,0.8)",opacity:phase2==='placed'?1:0.3,transition:"opacity 0.3s" }} />}
              </div>;
            })}
          </div>
          {/* Finger pointer */}
          <div style={{ position:"absolute",bottom:-6,right:30,fontSize:26,animation:"arrowBounce 0.9s ease-in-out infinite",filter:"drop-shadow(0 2px 6px rgba(0,229,255,0.5))",transform:"rotate(-20deg)" }}>👆</div>
          {/* Rotate badge */}
          <div style={{ marginTop:14,display:"flex",alignItems:"center",gap:8,padding:"6px 16px",background:"rgba(0,229,255,0.08)",border:`1px solid rgba(0,229,255,0.25)`,borderRadius:20 }}>
            <span style={{ fontSize:18,color:t.accent,animation:phase2==='rotating'?"coinSpin 0.4s ease-in-out":"none" }}>↻</span>
            <span style={{ fontSize:11,color:t.accent,fontFamily:warrior,letterSpacing:2,fontWeight:700 }}>DÖNDÜR</span>
          </div>
          <div style={{ fontSize:10,color:"#e74c3c",fontFamily:warrior,letterSpacing:2,marginTop:8,fontWeight:700 }}>AMİRAL GEMİSİ</div>
        </div>
      );
    }

    // Animated shot sequence — 3 cells select → become X (hit) or • (miss)
    function ShotAnim() {
      const SHOTS = [[1,0,'hit'],[1,2,'miss'],[2,3,'hit']];
      const [phase3, setPhase3] = useState('select'); // select|fire
      const [shown, setShown] = useState(0);
      useEffect(() => {
        let timers = [];
        const run = () => {
          setPhase3('select'); setShown(0);
          timers.push(setTimeout(() => setShown(1), 400));
          timers.push(setTimeout(() => setShown(2), 800));
          timers.push(setTimeout(() => setShown(3), 1200));
          timers.push(setTimeout(() => setPhase3('fire'), 1800));
          timers.push(setTimeout(run, 3600));
        };
        run();
        return () => timers.forEach(clearTimeout);
      }, []);
      const cs = 50;
      return (
        <div style={{ position:"relative",marginBottom:16 }}>
          <div style={{ display:"grid",gridTemplateColumns:`repeat(5,${cs}px)`,gridTemplateRows:`repeat(3,${cs}px)`,gap:2,background:t.surface,borderRadius:10,padding:6,border:`1px solid ${t.border}` }}>
            {Array.from({length:15}).map((_,i) => {
              const r=Math.floor(i/5),c=i%5;
              const si = SHOTS.findIndex(([sr,sc])=>sr===r&&sc===c);
              const isSelected = si >= 0 && shown > si && phase3==='select';
              const isFired = si >= 0 && phase3==='fire';
              const isHit = isFired && SHOTS[si][2]==='hit';
              const isMiss = isFired && SHOTS[si][2]==='miss';
              return <div key={i} style={{ borderRadius:4,background:isHit?t.hit:isMiss?t.miss:isSelected?"rgba(0,229,255,0.4)":t.water,border:`1px solid ${isHit?t.hit:isMiss?t.miss:isSelected?t.accent:"rgba(55,65,81,0.4)"}`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:18,fontWeight:900,color:"#fff",transition:"all 0.3s ease",boxShadow:isHit?`inset 0 0 14px ${t.hitGlow}`:isSelected?`inset 0 0 10px ${t.accentGlow}`:"none" }}>
                {isHit?"✕":isMiss?"•":isSelected?"◎":""}
              </div>;
            })}
          </div>
          <div style={{ display:"flex",gap:8,marginTop:10,justifyContent:"center",alignItems:"center" }}>
            {SHOTS.map((_,i)=><div key={i} style={{ width:14,height:14,borderRadius:"50%",background:i<shown&&phase3==='select'?t.hit:t.surfaceLight,boxShadow:i<shown&&phase3==='select'?`0 0 8px ${t.hitGlow}`:"none",transition:"all 0.3s" }} />)}
            <div style={{ fontSize:12,color:t.textDim,fontFamily:warrior,letterSpacing:2,marginLeft:6 }}>→ 🔥 ATEŞ</div>
          </div>
        </div>
      );
    }

    // Shared tutorial card wrapper
    const TutCard = ({ children, step, total }) => (
      <div style={{ ...appStyle, justifyContent:"center", background:`radial-gradient(ellipse at 12% 85%, rgba(167,139,250,0.09) 0%, transparent 45%), radial-gradient(ellipse at 88% 12%, rgba(255,215,0,0.06) 0%, transparent 40%), radial-gradient(ellipse at 50% 20%, rgba(192,57,43,0.08) 0%, rgba(0,229,255,0.07) 40%, ${t.bg} 80%)`, overflow:"hidden", position:"relative", animation:"pageFadeIn 0.5s ease-out forwards" }}>
        <style>{ANIMS}{`
@keyframes arrowBounce{0%,100%{transform:translateX(0)}50%{transform:translateX(8px)}}
@keyframes shipSlide{0%{transform:translateX(-60px);opacity:0}100%{transform:translateX(0);opacity:1}}
@keyframes touchPulse{0%{transform:scale(1);opacity:0.9}50%{transform:scale(1.3);opacity:1}100%{transform:scale(1);opacity:0.9}}
@keyframes crosshairSpin{0%{transform:rotate(0deg)}100%{transform:rotate(360deg)}}
@keyframes markDrop{0%{transform:translateY(-20px);opacity:0}60%{transform:translateY(4px);opacity:1}100%{transform:translateY(0);opacity:1}}
@keyframes shimmerPass{0%{left:-100%}100%{left:200%}}
@keyframes battleFlicker{0%,100%{opacity:0.03}50%{opacity:0.07}}
        `}</style>
        {/* Savaş konsepti — arka plan dekorasyon */}
        <div style={{ position:"absolute",top:0,left:0,right:0,bottom:0,pointerEvents:"none",overflow:"hidden" }}>
          <div style={{ position:"absolute",top:"8%",left:"5%",opacity:0.04,animation:"battleFlicker 3s ease-in-out infinite" }}><XAnchors size={60} color="#fff"/></div>
          <div style={{ position:"absolute",bottom:"12%",right:"5%",fontSize:48,opacity:0.04,fontFamily:warrior,fontWeight:900,color:"#fff",animation:"battleFlicker 4s ease-in-out 1s infinite" }}>🛡</div>
          <div style={{ position:"absolute",bottom:0,left:0,right:0,height:60,opacity:0.04,overflow:"hidden" }}>
            <div style={{ position:"absolute",bottom:0,left:"-50%",width:"200%",height:40,borderRadius:"50%",background:t.accent,animation:"wave 6s linear infinite" }} />
          </div>
        </div>
        {/* Progress dots */}
        <div style={{ position:"absolute",top:16,left:0,right:0,display:"flex",justifyContent:"center",gap:6 }}>
          {[1,2,3,4].map(i => <div key={i} style={{ width:i<=step?20:8,height:8,borderRadius:4,background:i<=step?t.accent:"rgba(255,255,255,0.12)",transition:"all 0.3s ease",boxShadow:i<=step?`0 0 8px ${t.accentGlow}`:"none" }} />)}
        </div>
        {/* Skip */}
        <button onClick={skipTutorial} style={{ position:"absolute",top:14,right:14,padding:"5px 14px",background:"rgba(255,255,255,0.05)",color:t.textDim,border:`1px solid ${t.border}`,borderRadius:20,fontSize:10,fontWeight:700,cursor:"pointer",fontFamily:warrior,letterSpacing:2 }}>GEÇ</button>
        <div style={{ width:"100%",maxWidth:400,zIndex:1,display:"flex",flexDirection:"column",alignItems:"center",gap:0,animation:"tutCardEnter 0.8s cubic-bezier(0.16,1,0.3,1) forwards" }}>
          {children}
        </div>
      </div>
    );

    // Step 0: Splash — kılıç + başlık, 3 saniye sonra otomatik geç
    if (tutorialStep === 0) {
      return (
        <div style={{ ...appStyle, justifyContent:"center", background:`radial-gradient(ellipse at 20% 20%, rgba(167,139,250,0.10) 0%, transparent 50%), radial-gradient(ellipse at 80% 75%, rgba(255,215,0,0.06) 0%, transparent 45%), radial-gradient(ellipse at 50% 35%, rgba(0,229,255,0.13) 0%, ${t.bg} 80%)`, overflow:"hidden", position:"relative", animation:"pageEnter 1.4s cubic-bezier(0.16,1,0.3,1) forwards" }}>
          <style>{ANIMS}{`
@keyframes sword3d{0%{transform:perspective(600px) rotateY(-60deg) rotateX(20deg) scale(0.3);opacity:0;filter:brightness(3)}40%{opacity:1}60%{transform:perspective(600px) rotateY(12deg) rotateX(-6deg) scale(1.18);filter:brightness(1.5)}80%{transform:perspective(600px) rotateY(-4deg) rotateX(3deg) scale(1.02);filter:brightness(1)}100%{transform:perspective(600px) rotateY(5deg) rotateX(-2deg) scale(1.05);filter:brightness(1)}}
@keyframes sword3dFloat{0%,100%{transform:perspective(600px) rotateY(5deg) rotateX(-2deg) translateY(0) scale(1.05)}50%{transform:perspective(600px) rotateY(-8deg) rotateX(5deg) translateY(-16px) scale(1.08)}}
@keyframes titleSlam{0%{transform:scale(2.5);opacity:0;filter:blur(12px)}60%{transform:scale(0.95);opacity:1;filter:blur(0)}100%{transform:scale(1)}}
          `}</style>
          {[...Array(10)].map((_,i)=><div key={i} style={{ position:"absolute",width:3,height:3,borderRadius:"50%",background:i%2===0?t.gold:t.accent,top:`${10+Math.random()*80}%`,left:`${5+Math.random()*90}%`,animation:`pulse ${2+Math.random()*2}s ease-in-out ${Math.random()*3}s infinite`,pointerEvents:"none",opacity:0.4 }} />)}
          <SplashAutoAdvance onDone={() => { sfx.init(); sfx.playIntroFanfare(); setOnboardingStep(1); }} />
          <div style={{ textAlign:"center",zIndex:1,display:"flex",flexDirection:"column",alignItems:"center",animation:"tutCardEnter 1.2s cubic-bezier(0.16,1,0.3,1) 0.2s both" }}>
            <div style={{ width:280,height:250,marginBottom:8,animation:"sword3d 1.2s cubic-bezier(0.34,1.56,0.64,1) forwards, sword3dFloat 4s ease-in-out 1.3s infinite",filter:"drop-shadow(0 0 60px rgba(0,229,255,0.8)) drop-shadow(0 0 120px rgba(0,229,255,0.4)) drop-shadow(0 0 20px rgba(255,255,255,0.6))" }}>
              <AnchorHeroLogo />
            </div>
            <div style={{ animation:"titleSlam 0.9s cubic-bezier(0.34,1.56,0.64,1) 0.4s both" }}>
              <div style={{ fontSize:56,fontWeight:900,color:t.accent,fontFamily:warrior,letterSpacing:12,textShadow:`0 0 80px ${t.accentGlow}, 0 0 40px rgba(0,229,255,0.4), 0 6px 30px rgba(0,0,0,0.9)`,lineHeight:1 }}>AMİRAL<br/>BATTI</div>
            </div>
            <div style={{ fontSize:13,color:"rgba(255,215,0,0.65)",fontFamily:warrior,letterSpacing:7,marginTop:14,fontStyle:"italic",animation:"fadeUp 1s ease-out 1.2s both",textShadow:`0 0 15px ${t.goldGlow}` }}>savaşların atası...</div>
          </div>
        </div>
      );
    }

    // Step 1: Gemi yerleştirme — Amiral animasyonu
    if (tutorialStep === 1) {
      return (
        <TutCard step={1} total={4}>
          <div style={{ fontSize:28,fontWeight:900,color:"#fff",fontFamily:warrior,letterSpacing:8,marginTop:32,marginBottom:20,textShadow:`0 0 30px ${t.accentGlow}`,borderBottom:"1px solid rgba(0,229,255,0.15)",paddingBottom:12,width:"100%",textAlign:"center" }}>NASIL OYNANIR?</div>
          <div style={{ display:"flex",alignItems:"center",gap:8,marginBottom:14 }}>
            <span style={{ fontSize:20 }}>⚓</span>
            <div style={{ fontSize:16,fontWeight:800,color:t.accent,fontFamily:warrior,letterSpacing:4,textShadow:`0 0 12px ${t.accentGlow}` }}>GEMİLERİ YERLEŞTIR</div>
            <span style={{ fontSize:20 }}>⚓</span>
          </div>
          {/* Animated Amiral ship demo */}
          <AmiraldemoAnim />
          <div style={{ fontSize:13,color:t.textDim,fontFamily:mono,marginBottom:20,textAlign:"center",lineHeight:1.7,maxWidth:280 }}>
            Bir gemi seç → haritaya dokun → yerleştir<br/>
            <span style={{ color:t.accent,fontWeight:700 }}>↻ DÖNDÜR</span> ile yönünü değiştir
          </div>
          <div style={{ display:"flex",gap:10 }}>
            <button onClick={() => setOnboardingStep(s => s - 1)} style={{ padding:"14px 32px",background:"transparent",color:t.textDim,border:`1px solid ${t.border}`,borderRadius:12,fontSize:14,fontWeight:700,cursor:"pointer",fontFamily:warrior,letterSpacing:2 }}>← GERİ</button>
            <button onClick={nextStep} style={{ padding:"14px 32px",background:`linear-gradient(135deg,${t.accent},#0891b2)`,color:t.bg,border:"none",borderRadius:12,fontSize:14,fontWeight:900,letterSpacing:4,cursor:"pointer",fontFamily:warrior,boxShadow:`0 4px 24px ${t.accentGlow}` }}>GEÇ →</button>
          </div>
        </TutCard>
      );
    }

    // Step 2: Değme kuralı
    if (tutorialStep === 2) {
      return (
        <TutCard step={2} total={4}>
          <div style={{ fontSize:28,fontWeight:900,color:"#fff",fontFamily:warrior,letterSpacing:8,marginTop:32,marginBottom:20,textShadow:`0 0 30px ${t.accentGlow}`,borderBottom:"1px solid rgba(0,229,255,0.15)",paddingBottom:12,width:"100%",textAlign:"center" }}>NASIL OYNANIR?</div>
          <div style={{ display:"flex",alignItems:"center",gap:8,marginBottom:14 }}>
            <span style={{ fontSize:20 }}>🚫</span>
            <div style={{ fontSize:16,fontWeight:800,color:t.accent,fontFamily:warrior,letterSpacing:4,textShadow:`0 0 12px ${t.accentGlow}` }}>DEĞMEZLİK KURALI</div>
            <span style={{ fontSize:20 }}>🚫</span>
          </div>
          <div style={{ fontSize:13,color:t.textDim,fontFamily:mono,marginBottom:16,textAlign:"center",lineHeight:1.6 }}>Gemiler birbirine dokunamaz —<br/>köşeden bile olsa!</div>
          {/* Görsel: iki gemi, kırmızı yasak bölge */}
          <div style={{ position:"relative",marginBottom:20 }}>
            <div style={{ display:"grid",gridTemplateColumns:"repeat(5,42px)",gridTemplateRows:"repeat(4,42px)",gap:2,background:t.surface,borderRadius:10,padding:6,border:`1px solid ${t.border}` }}>
              {Array.from({length:20}).map((_,i) => {
                const ship1=[5,6]; const ship2=[13,14]; const forbidden=[7,8,11,12];
                const isS1=ship1.includes(i), isS2=ship2.includes(i), isForbidden=forbidden.includes(i);
                return <div key={i} style={{ borderRadius:4,background:isS1?"rgba(0,229,255,0.35)":isS2?"rgba(52,211,153,0.35)":isForbidden?"rgba(255,71,87,0.22)":t.water,border:`1px solid ${isS1?"rgba(0,229,255,0.6)":isS2?"rgba(52,211,153,0.5)":isForbidden?"rgba(255,71,87,0.5)":"rgba(55,65,81,0.4)"}`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:14,fontWeight:900,color:isForbidden?t.hit:"transparent",animation:isForbidden?"pulse 1.5s ease-in-out infinite":"none" }}>
                  {isForbidden && "✕"}
                </div>;
              })}
            </div>
            <div style={{ position:"absolute",top:-10,left:"50%",transform:"translateX(-50%)",fontSize:24,animation:"pulse 1.2s ease-in-out infinite" }}>🚫</div>
          </div>
          <div style={{ display:"flex",gap:10 }}>
            <button onClick={() => setOnboardingStep(s => s - 1)} style={{ padding:"14px 32px",background:"transparent",color:t.textDim,border:`1px solid ${t.border}`,borderRadius:12,fontSize:14,fontWeight:700,cursor:"pointer",fontFamily:warrior,letterSpacing:2 }}>← GERİ</button>
            <button onClick={nextStep} style={{ padding:"14px 32px",background:`linear-gradient(135deg,${t.accent},#0891b2)`,color:t.bg,border:"none",borderRadius:12,fontSize:14,fontWeight:900,letterSpacing:4,cursor:"pointer",fontFamily:warrior,boxShadow:`0 4px 24px ${t.accentGlow}` }}>GEÇ →</button>
          </div>
        </TutCard>
      );
    }

    // Step 3: 3'lü atış
    if (tutorialStep === 3) {
      return (
        <TutCard step={3} total={4}>
          <div style={{ fontSize:28,fontWeight:900,color:"#fff",fontFamily:warrior,letterSpacing:8,marginTop:32,marginBottom:20,textShadow:`0 0 30px ${t.accentGlow}`,borderBottom:"1px solid rgba(0,229,255,0.15)",paddingBottom:12,width:"100%",textAlign:"center" }}>NASIL OYNANIR?</div>
          <div style={{ display:"flex",alignItems:"center",gap:8,marginBottom:14 }}>
            <span style={{ fontSize:20 }}>💥</span>
            <div style={{ fontSize:16,fontWeight:800,color:t.accent,fontFamily:warrior,letterSpacing:4,textShadow:`0 0 12px ${t.accentGlow}` }}>3 EL ATIŞ</div>
            <span style={{ fontSize:20 }}>💥</span>
          </div>
          <div style={{ fontSize:13,color:t.textDim,fontFamily:mono,marginBottom:16,textAlign:"center",lineHeight:1.6 }}>Her turda 3 hücreyi seç → ATEŞ!</div>
          <ShotAnim />
          <div style={{ display:"flex",gap:10,marginTop:8 }}>
            <button onClick={() => setOnboardingStep(s => s - 1)} style={{ padding:"14px 32px",background:"transparent",color:t.textDim,border:`1px solid ${t.border}`,borderRadius:12,fontSize:14,fontWeight:700,cursor:"pointer",fontFamily:warrior,letterSpacing:2 }}>← GERİ</button>
            <button onClick={nextStep} style={{ padding:"14px 32px",background:`linear-gradient(135deg,${t.accent},#0891b2)`,color:t.bg,border:"none",borderRadius:12,fontSize:14,fontWeight:900,letterSpacing:4,cursor:"pointer",fontFamily:warrior,boxShadow:`0 4px 24px ${t.accentGlow}` }}>GEÇ →</button>
          </div>
        </TutCard>
      );
    }

    // Step 4: İşaretleme özelliği
    if (tutorialStep === 4) {
      return (
        <TutCard step={4} total={4}>
          <div style={{ fontSize:28,fontWeight:900,color:"#fff",fontFamily:warrior,letterSpacing:8,marginTop:32,marginBottom:20,textShadow:`0 0 30px ${t.accentGlow}`,borderBottom:"1px solid rgba(0,229,255,0.15)",paddingBottom:12,width:"100%",textAlign:"center" }}>NASIL OYNANIR?</div>
          <div style={{ display:"flex",alignItems:"center",gap:8,marginBottom:14 }}>
            <span style={{ fontSize:20 }}>⚑</span>
            <div style={{ fontSize:16,fontWeight:800,color:t.accent,fontFamily:warrior,letterSpacing:4,textShadow:`0 0 12px ${t.accentGlow}` }}>İŞARETLE & TAKİP ET</div>
            <span style={{ fontSize:20 }}>⚑</span>
          </div>
          <div style={{ fontSize:13,color:t.textDim,fontFamily:mono,marginBottom:16,textAlign:"center",lineHeight:1.6 }}>Atış yapmak istemediğin yerleri<br/>sağ tuş (mobilde uzun bas) ile işaretle.</div>
          {/* İşaretleme demo */}
          <div style={{ position:"relative",marginBottom:20 }}>
            <div style={{ display:"grid",gridTemplateColumns:"repeat(5,46px)",gridTemplateRows:"repeat(3,46px)",gap:2,background:t.surface,borderRadius:10,padding:6,border:`1px solid ${t.border}` }}>
              {Array.from({length:15}).map((_,i) => {
                const marked=[3,8,9]; const isM=marked.includes(i);
                return <div key={i} style={{ borderRadius:4,background:isM?"rgba(255,215,0,0.18)":t.water,border:`1px solid ${isM?"rgba(255,215,0,0.5)":"rgba(55,65,81,0.4)"}`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:20,color:isM?t.gold:"transparent",animation:isM?`markDrop 0.5s ease-out ${marked.indexOf(i)*0.2}s both`:"none",boxShadow:isM?`inset 0 0 10px ${t.goldGlow}`:"none" }}>
                  {isM && "⚑"}
                </div>;
              })}
            </div>
          </div>
          {/* SAVAŞ CTA */}
          <div style={{ textAlign:"center",display:"flex",flexDirection:"column",alignItems:"center",gap:0,width:"100%",maxWidth:340 }}>
            <div style={{ width:"100%",background:"linear-gradient(180deg, rgba(80,10,5,0.6) 0%, rgba(40,5,2,0.85) 100%)",border:"1px solid rgba(180,40,20,0.35)",borderRadius:12,padding:"20px 16px 14px",position:"relative",overflow:"hidden" }}>
              <div style={{ position:"absolute",inset:0,background:"radial-gradient(ellipse at 50% 100%, rgba(255,80,20,0.12) 0%, transparent 70%)",pointerEvents:"none" }} />
              <div style={{ position:"absolute",bottom:0,left:0,right:0,height:2,background:"linear-gradient(90deg,transparent,rgba(255,100,40,0.7),rgba(255,160,60,0.9),rgba(255,100,40,0.7),transparent)" }} />
              <button onClick={() => { setPhase("playing"); setActiveBoard("attack"); sfx.init(); sfx.play('click'); sfx.transitionToBattle(); }} style={{ width:"100%",padding:"18px 0",background:"linear-gradient(180deg, #a01f0c 0%, #6b1108 50%, #3a0804 100%)",color:"#fff",border:"1px solid rgba(255,200,120,0.35)",borderRadius:6,fontSize:20,fontWeight:900,letterSpacing:4,cursor:"pointer",fontFamily:warrior,boxShadow:"0 0 60px rgba(200,50,20,0.6), 0 0 120px rgba(180,30,10,0.3), 0 8px 40px rgba(0,0,0,0.9), inset 0 1px 0 rgba(255,180,120,0.2)",position:"relative",overflow:"hidden",textTransform:"uppercase",textShadow:"0 0 30px rgba(255,140,60,0.9), 0 0 60px rgba(255,80,20,0.5), 0 2px 8px rgba(0,0,0,0.9)",display:"flex",alignItems:"center",justifyContent:"center",gap:10 }}>
                <span style={{ position:"absolute",top:0,left:"-100%",width:"50%",height:"100%",background:"linear-gradient(90deg,transparent,rgba(255,150,80,0.1),transparent)",animation:"shimmerPass 3s ease-in-out infinite" }} />
                <XAnchors size={22} color="#ffd8a8" /> SAVAŞA BAŞLA
              </button>
              <div style={{ marginTop:10,fontSize:11,fontStyle:"italic",color:"rgba(255,180,100,0.65)",fontFamily:warrior,letterSpacing:4,textShadow:"0 0 10px rgba(255,120,40,0.4)" }}>
                sular ısınsın...
              </div>
            </div>
          </div>
        </TutCard>
      );
    }
  }
  if (showLeaderboard) return <><style>{ANIMS}</style><Leaderboard onBack={() => setShowLeaderboard(false)} myUid={authUid} /></>;
  if (showArenaSelect) return <><style>{ANIMS}</style><ArenaSelect myGold={myProfile?.gold || 0} onBack={() => setShowArenaSelect(false)} onSelect={(arena) => { setSelectedArena(arena); setShowArenaSelect(false); startQuickMatch(arena); }} /></>;
  if (showOnlineLobby) return <><style>{ANIMS}</style><OnlineLobby myUid={authUid} myName={playerName} myGold={myProfile?.gold} onBack={() => setShowOnlineLobby(false)} onChallenge={(rid, pNum) => { setShowOnlineLobby(false); roomIdRef.current = rid; setRoomId(rid); setPlayerNum(pNum); playerNumRef.current = pNum; setPhase("placing"); listenToRoom(rid, pNum); if (authUid) remove(ref(db, `online_players/${authUid}`)); }} /></>;

  if (phase === "gameover") {
    if (showReview) return <BoardReview defenseBoard={defenseBoard} shipColorMap={shipColorMap} defenseOverlay={defenseOverlay} attackOverlay={attackOverlay} oppShipsData={oppShipsData} myShipsData={myShipsData} defHitMap={defHitMap} atkHitMap={atkHitMap} cellSize={cellSize} onBack={() => setShowReview(false)} />;
    // ONBOARDING VICTORY — Special rank reveal ceremony
    if (isOnboarding && isWin) {
      return (<><style>{ANIMS}</style>
        <OnboardingVictoryScreen sfx={sfx} t={t} winner={winner} warrior={warrior} mono={mono} onDone={() => { setIsOnboarding(false); resetGame(); }} />
      </>);
    }
    const myEloDiff = eloChange ? eloChange.myNew - eloChange.myOld : null;
    const myRank = eloChange ? getRankInfo(eloChange.myNew) : (myProfile ? getRankInfo(myProfile.gold) : null);
    return (<><style>{ANIMS}</style>
      <GameOverScreen winner={winner} myHits={myHits} oppHits={oppHits} isWin={isWin} onNewGame={resetGame} onHome={resetGame} onViewBoard={() => setShowReview(true)} />
      <canvas id="confetti-canvas" style={{ position:'fixed',inset:0,pointerEvents:'none',zIndex:10002 }} />
      {goldAnim && <GoldCoinAnim amount={goldAnim.amount} onDone={()=>setGoldAnim(null)} />}
      {eloChange && (<div style={{ position:"fixed",bottom:80,left:0,right:0,display:"flex",justifyContent:"center",zIndex:200,perspective:"600px" }}>
        <div style={{ background:"linear-gradient(145deg, rgba(12,21,41,0.98), rgba(8,14,30,0.99))",border:`2px solid ${isWin?t.accent:t.hit}`,borderRadius:16,padding:"18px 28px",textAlign:"center",animation:"arSlideIn 0.7s ease-out forwards",'--ar-color':isWin?t.accentGlow:t.hitGlow,boxShadow:`0 15px 50px rgba(0,0,0,0.6), 0 0 30px ${isWin?t.accentGlow:t.hitGlow}` }}>
          <div style={{ fontSize:12,letterSpacing:4,color:t.textDim,marginBottom:8,fontFamily:warrior,fontWeight:700 }}>ALTIN DEĞİŞİMİ</div>
          <div style={{ display:"flex",alignItems:"center",gap:14,justifyContent:"center" }}>
            <span style={{ fontSize:22,fontWeight:700,color:t.textDim,fontFamily:warrior }}>{eloChange.myOld} 💰</span>
            <span style={{ fontSize:22,color:t.accent }}>→</span>
            <span style={{ fontSize:28,fontWeight:800,color:myRank?.color||t.gold,fontFamily:warrior,textShadow:`0 0 12px ${myRank?.color||t.gold}44` }}>{eloChange.myNew} 💰</span>
            <span style={{ fontSize:20,fontWeight:800,fontFamily:warrior,color:myEloDiff>=0?"#4ade80":t.hit,padding:"4px 12px",background:myEloDiff>=0?"rgba(74,222,128,0.1)":"rgba(255,71,87,0.1)",borderRadius:8 }}>{myEloDiff>=0?`+${myEloDiff}`:myEloDiff}</span>
          </div>
          {myRank && <div style={{ fontSize:13,fontWeight:800,color:myRank.color,marginTop:8,fontFamily:warrior,letterSpacing:3 }}>{myRank.icon} {myRank.title}</div>}
          {entryFeeDeducted && (
            <div style={{ marginTop:10,borderTop:`1px solid rgba(255,255,255,0.06)`,paddingTop:10 }}>
              <div style={{ fontSize:12,fontWeight:700,color:t.hit,fontFamily:warrior,letterSpacing:2 }}>Giriş: -{entryFeeDeducted} 💰</div>
            </div>
          )}
        </div>
      </div>)}
    </>);
  }

  if (phase === "lobby") {
    const rank = myProfile ? getRankInfo(myProfile.gold) : null;
    const myLevel = myProfile?.level || 0;
    const myGamesNeeded = gamesNeededForLevel(myLevel);
    const myLevelPct = Math.max(0, Math.min(1, (myProfile?.levelProgress || 0) / myGamesNeeded));
    const authLoading = !authReady || !authUid;
    const winRate = myProfile && myProfile.totalGames > 0 ? Math.round((myProfile.wins / myProfile.totalGames) * 100) : 0;
    return (<div style={{ ...appStyle, background:`linear-gradient(180deg, ${t.bg} 0%, #071428 50%, #0a1a35 100%)`,position:"relative",overflow:"hidden" }}><style>{ANIMS}{`
@keyframes shimmerPass{0%{left:-100%}100%{left:200%}}
@keyframes logoFloat{0%,100%{transform:translateY(0) scale(1);filter:drop-shadow(0 0 40px rgba(0,229,255,0.4))}50%{transform:translateY(-6px) scale(1.02);filter:drop-shadow(0 8px 50px rgba(0,229,255,0.6))}}
    `}</style>
      {/* Animated ocean background */}
      <div style={{ position:"absolute",top:0,left:0,right:0,height:250,opacity:0.05,overflow:"hidden",pointerEvents:"none" }}>
        <div style={{ position:"absolute",bottom:0,left:"-50%",width:"200%",height:80,borderRadius:"50%",background:"linear-gradient(90deg,transparent,#00e5ff,transparent)",animation:"wave 6s linear infinite" }} />
        <div style={{ position:"absolute",bottom:30,left:"-50%",width:"200%",height:50,borderRadius:"50%",background:t.accent,opacity:0.6,animation:"wave 10s linear infinite reverse" }} />
        <div style={{ position:"absolute",bottom:60,left:"-50%",width:"200%",height:30,borderRadius:"50%",background:t.accent,opacity:0.3,animation:"wave 14s linear infinite" }} />
      </div>
      {/* Sparkle particles in background */}
      {[...Array(6)].map((_,i)=><div key={`sp${i}`} style={{ position:"absolute",width:3,height:3,borderRadius:"50%",background:i%2===0?t.accent:t.gold,top:`${10+Math.random()*30}%`,left:`${10+Math.random()*80}%`,animation:`pulse ${2+i*0.5}s ease-in-out infinite`,opacity:0.4,pointerEvents:"none" }} />)}
      {/* Logo */}
      <div style={{ fontSize:42,fontWeight:900,letterSpacing:12,color:t.accent,textShadow:`0 0 60px ${t.accentGlow}, 0 0 120px rgba(0,229,255,0.15), 0 3px 12px rgba(0,0,0,0.6)`,marginBottom:2,fontFamily:warrior,animation:"logoFloat 4s ease-in-out infinite",zIndex:1,WebkitTextStroke:"0.5px rgba(255,255,255,0.08)" }}>AMİRAL BATTI</div>
      <div style={{ display:"flex",alignItems:"center",gap:12,marginBottom:10,zIndex:1 }}>
        <div style={{ width:52,height:1,background:"linear-gradient(90deg, transparent, rgba(255,215,0,0.55))" }} />
        <div style={{ fontSize:11,color:t.gold,letterSpacing:6,fontFamily:warrior,fontStyle:"italic",fontWeight:700,textShadow:`0 0 14px ${t.goldGlow}`,whiteSpace:"nowrap" }}>savaşların atası</div>
        <div style={{ width:52,height:1,background:"linear-gradient(90deg, rgba(255,215,0,0.55), transparent)" }} />
      </div>
      {/* Music toggle + online counter */}
      <div style={{ display:"flex",alignItems:"center",gap:14,marginBottom:12,zIndex:1 }}>
        {onlineCount > 0 && <div style={{ display:'flex',alignItems:'center',gap:6,animation:'fadeUp 0.5s ease-out' }}><div style={{ width:8,height:8,borderRadius:'50%',background:'#34d399',boxShadow:'0 0 8px rgba(52,211,153,0.6)',animation:'pulse 2s infinite' }} /><span style={{ fontSize:11,color:'#34d399',fontFamily:warrior,letterSpacing:2 }}>{onlineCount} KİŞİ OYNUYOR</span></div>}
        <button onClick={()=>{sfx.init(); if(sfx._audioEl && !sfx._audioEl.paused){sfx.stopMusic();}else{sfx.playBattleMusic(false);}}} style={{ padding:"4px 10px",background:"rgba(255,255,255,0.04)",border:`1px solid ${t.border}`,borderRadius:8,fontSize:14,cursor:"pointer",color:t.textDim,lineHeight:1 }}>{sfx._audioEl && !sfx._audioEl.paused?'🔊':'🔇'}</button>
      </div>
      {myProfile && (<div style={{ width:"100%",maxWidth:360,marginBottom:14,zIndex:1,animation:"fadeUp 0.25s ease-out" }}>
        <div style={{ display:"flex",justifyContent:"space-between",alignItems:"baseline",marginBottom:5,padding:"0 2px" }}>
          <span style={{ fontSize:12,fontWeight:800,color:t.gold,fontFamily:warrior,letterSpacing:3,textShadow:`0 0 10px ${t.goldGlow}` }}>SEVİYE {myLevel}</span>
          <span style={{ fontSize:10,fontWeight:700,color:t.textDim,fontFamily:mono,letterSpacing:1 }}>{Math.floor(myLevelPct*100)}%</span>
        </div>
        <div style={{ width:"100%",height:16,borderRadius:9,background:"rgba(0,0,0,0.45)",border:"1px solid rgba(255,215,0,0.3)",overflow:"hidden",position:"relative",boxShadow:"inset 0 2px 6px rgba(0,0,0,0.6)" }}>
          <div style={{ width:`${myLevelPct*100}%`,height:"100%",background:"linear-gradient(180deg, #fff9c4 0%, #ffe066 30%, #ffd700 60%, #d97706 100%)",boxShadow:`0 0 14px ${t.goldGlow}, inset 0 1px 0 rgba(255,255,255,0.55), inset 0 -2px 4px rgba(120,70,0,0.4)`,transition:"width 0.7s cubic-bezier(0.34,1.56,0.64,1)",borderRadius:9,position:"relative",overflow:"hidden" }}>
            <span style={{ position:"absolute",top:0,left:"-100%",width:"50%",height:"100%",background:"linear-gradient(90deg,transparent,rgba(255,255,255,0.5),transparent)",animation:"shimmerPass 2.4s ease-in-out infinite" }} />
          </div>
        </div>
      </div>)}
      {authLoading && <div style={{ background:"rgba(239,68,68,0.12)",border:`1px solid ${t.hit}`,borderRadius:8,padding:"10px 16px",marginBottom:12,fontSize:11,color:t.hit,fontFamily:mono,textAlign:"center",width:"100%",maxWidth:340,animation:"pulse 1.5s infinite" }}>Sunucuya bağlanılıyor...</div>}
      {isTestMode() && <div style={{ background:"rgba(251,191,36,0.15)",border:`1px solid ${t.gold}`,borderRadius:8,padding:"8px 16px",marginBottom:12,fontSize:11,color:t.gold,fontFamily:warrior,letterSpacing:2,textAlign:"center",width:"100%",maxWidth:340 }}>🧪 TEST MODU — 2 tab aç, oda koduyla oyna</div>}
      {myProfile && (<div style={{ background:`linear-gradient(145deg, ${t.surface}, ${t.surfaceLight})`,border:`2px solid ${myLevelPct>=0.999?"#ffd700":t.border}`,borderRadius:16,padding:"18px 22px",marginBottom:16,width:"100%",maxWidth:360,animation:"fadeUp 0.3s ease-out",boxShadow:`0 4px 20px rgba(0,0,0,0.4)`,zIndex:1 }}>
        <div style={{ display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:12 }}>
          <div>
            <div style={{ display:"flex",alignItems:"center",gap:10 }}>
              <div style={{ position:"relative",width:48,height:48 }}>
                <div style={{ width:"100%",height:"100%",borderRadius:"50%",background:`conic-gradient(#ffd700 ${myLevelPct*360}deg, rgba(255,255,255,0.10) ${myLevelPct*360}deg)`,padding:3,boxShadow:myLevelPct>=0.999?`0 0 16px ${t.goldGlow}, 0 0 30px ${t.goldGlow}`:"none",transition:"box-shadow 0.4s ease" }}>
                  <button onClick={()=>setShowAvatarPick(v=>!v)} title="Profil simgeni seç" style={{ width:"100%",height:"100%",borderRadius:"50%",background:"rgba(0,229,255,0.10)",border:"none",display:"flex",alignItems:"center",justifyContent:"center",fontSize:20,cursor:"pointer",padding:0,overflow:"hidden" }}>{(myProfile.avatar||"").startsWith("data:")?<img src={myProfile.avatar} alt="" style={{ width:"100%",height:"100%",objectFit:"cover" }} />:(myProfile.avatar||"⚓")}</button>
                </div>
                <div style={{ position:"absolute",bottom:-4,right:-4,minWidth:18,height:18,borderRadius:9,background:"linear-gradient(160deg,#fff9c4,#ffd700 60%,#d97706)",border:"2px solid "+t.surface,display:"flex",alignItems:"center",justifyContent:"center",fontSize:9,fontWeight:900,color:"#1a1206",fontFamily:warrior,padding:"0 3px" }}>{myLevel}</div>
              </div>
              <div style={{ fontSize:20,fontWeight:800,color:t.text,fontFamily:warrior,letterSpacing:2 }}>{myProfile.displayName}</div>
            </div>
            {showAvatarPick && <div style={{ display:"flex",gap:6,flexWrap:"wrap",marginTop:8,padding:"8px 10px",background:"rgba(0,0,0,0.35)",borderRadius:12,border:`1px solid ${t.border}` }}>
              <button onClick={()=>avatarFileRef.current?.click()} title="Kendi fotoğrafını yükle" style={{ width:36,height:36,borderRadius:"50%",background:"rgba(255,215,0,0.12)",border:`2px dashed ${t.gold}`,fontSize:20,fontWeight:900,color:t.gold,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",padding:0 }}>+</button>
              <input ref={avatarFileRef} type="file" accept="image/*" style={{ display:"none" }} onChange={handleAvatarUpload} />
              {["⚓","🦈","🐙","⚔","🏴‍☠️","🌊","🦅","🐉","💀","🔱"].map(av=>(<button key={av} onClick={()=>{ setShowAvatarPick(false); if(authUid){ update(ref(db,`profiles/${authUid}`),{avatar:av}).catch(()=>{}); } setMyProfile(prev=>prev?{...prev,avatar:av}:prev); }} style={{ width:36,height:36,borderRadius:"50%",background:myProfile.avatar===av?"rgba(0,229,255,0.25)":"rgba(255,255,255,0.05)",border:`2px solid ${myProfile.avatar===av?t.accent:"transparent"}`,fontSize:18,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",padding:0 }}>{av}</button>))}
            </div>}
            <div style={{ display:"flex",alignItems:"center",gap:6,marginTop:4 }}>
              <span style={{ fontSize:13,fontWeight:800,color:rank?.color||t.gold,fontFamily:warrior,letterSpacing:1 }}>{rank?.icon} {rank?.title}</span>
              {canChangeName() && <button onClick={()=>{setPhase("splash");}} style={{ fontSize:8,color:t.textDim,background:"transparent",border:`1px solid ${t.border}`,borderRadius:4,padding:"2px 6px",cursor:"pointer",fontFamily:mono }}>✏</button>}
            </div>
          </div>
          <div style={{ textAlign:"center",background:"rgba(0,212,255,0.08)",borderRadius:12,padding:"8px 14px" }}>
            <div style={{ fontSize:30,fontWeight:800,color:rank?.color||t.accent,fontFamily:warrior,lineHeight:1,textShadow:`0 0 15px ${rank?.color||t.accent}44` }}>{safeGold(myProfile.gold)}</div>
            <div style={{ fontSize:8,color:t.textDim,letterSpacing:3,marginTop:2,fontFamily:warrior,fontWeight:700 }}>ALTIN</div>
          </div>
        </div>
        <div style={{ display:"flex",gap:0,background:t.bg,borderRadius:10,overflow:"hidden" }}>
          <div style={{ flex:1,textAlign:"center",padding:"12px 0",borderRight:`1px solid ${t.border}` }}><div style={{ fontSize:26,fontWeight:900,color:"#34d399",fontFamily:warrior,textShadow:"0 0 15px rgba(52,211,153,0.4)" }}>{myProfile.wins||0}</div><div style={{ fontSize:11,color:"#34d399",letterSpacing:3,fontFamily:warrior,fontWeight:900,marginTop:3,opacity:0.85,textShadow:"0 1px 3px rgba(0,0,0,0.6)" }}>GALİBİYET</div></div>
          <div style={{ flex:1,textAlign:"center",padding:"12px 0",borderRight:`1px solid ${t.border}` }}><div style={{ fontSize:26,fontWeight:900,color:t.hit,fontFamily:warrior,textShadow:"0 0 15px rgba(255,71,87,0.4)" }}>{myProfile.losses||0}</div><div style={{ fontSize:11,color:t.hit,letterSpacing:3,fontFamily:warrior,fontWeight:900,marginTop:3,opacity:0.85,textShadow:"0 1px 3px rgba(0,0,0,0.6)" }}>MAĞLUBİYET</div></div>
          <div style={{ flex:1,textAlign:"center",padding:"12px 0" }}><div style={{ fontSize:26,fontWeight:900,color:t.accent,fontFamily:warrior,textShadow:`0 0 15px ${t.accentGlow}` }}>%{winRate}</div><div style={{ fontSize:11,color:t.accent,letterSpacing:3,fontFamily:warrior,fontWeight:900,marginTop:3,opacity:0.85,textShadow:"0 1px 3px rgba(0,0,0,0.6)" }}>ORAN</div></div>
        </div>
      </div>)}
      {/* Main action buttons */}
      <div style={{ position:"relative",width:"100%",maxWidth:360,zIndex:1,animation:"fadeUp 0.5s ease-out" }}>
        {/* Köşe sonar dalgaları */}
        {!matchmaking && <>
        <span style={{ position:"absolute",top:-9,left:-9,width:30,height:30,borderTop:"3px solid rgba(0,229,255,0.55)",borderLeft:"3px solid rgba(0,229,255,0.55)",borderTopLeftRadius:18,animation:"sonarArc 2s ease-in-out infinite",pointerEvents:"none" }} />
        <span style={{ position:"absolute",bottom:-9,right:-9,width:30,height:30,borderBottom:"3px solid rgba(0,229,255,0.55)",borderRight:"3px solid rgba(0,229,255,0.55)",borderBottomRightRadius:18,animation:"sonarArc 2s ease-in-out 1s infinite",pointerEvents:"none" }} />
        </>}
        <RippleButton onClick={()=>startQuickMatch(null)} disabled={matchmaking||authLoading} style={{ width:"100%",padding:"15px 0",background:matchmaking?t.surfaceLight:`linear-gradient(180deg, #22d8ff 0%, ${t.accent} 45%, #0077b6 100%)`,color:matchmaking?t.textDim:"#04202e",border:"2px solid rgba(255,255,255,0.35)",borderRadius:14,fontSize:27,fontWeight:900,letterSpacing:6,cursor:(matchmaking||authLoading)?"not-allowed":"pointer",fontFamily:warrior,textTransform:"uppercase",boxShadow:matchmaking?"none":`0 0 34px ${t.accentGlow}, 0 5px 0 #045a80, 0 10px 22px rgba(0,0,0,0.5), inset 0 2px 0 rgba(255,255,255,0.45)`,opacity:authLoading?0.4:1,textShadow:"0 1px 0 rgba(255,255,255,0.4), 0 2px 3px rgba(0,60,90,0.5)",display:"flex",alignItems:"center",justifyContent:"center",gap:14,animation:matchmaking?"none":"btnBreath 2.2s ease-in-out infinite" }}>
          {!matchmaking && <svg width="30" height="32" viewBox="0 0 24 26" style={{ filter:"drop-shadow(0 3px 3px rgba(0,40,60,0.55))" }}><defs><linearGradient id="playTri" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stopColor="#ffffff"/><stop offset="60%" stopColor="#d8f6ff"/><stop offset="100%" stopColor="#8ad4f0"/></linearGradient></defs><polygon points="3,2 22,13 3,24" fill="url(#playTri)" stroke="rgba(4,60,90,0.5)" strokeWidth="1.2"/></svg>}
          {matchmaking?"EŞLEŞTİRİLİYOR...":"OYNA"}
        </RippleButton>
      </div>
      {matchmaking && <button onClick={async()=>{if(matchCancelFn)await matchCancelFn();setMatchmaking(false);setMatchCancelFn(null);}} style={{ marginTop:6,padding:"8px 20px",background:"transparent",color:t.hit,border:`1px solid ${t.hit}`,borderRadius:6,fontSize:10,fontWeight:700,letterSpacing:1,cursor:"pointer",fontFamily:warrior,zIndex:1 }}>İPTAL</button>}
      <div style={{ display:"flex",gap:8,marginTop:10,width:"100%",maxWidth:360,animation:"fadeUp 0.6s ease-out",zIndex:1 }}>
        <RippleButton onClick={()=>{if(!authUid){setMessage("Bağlantı bekleniyor...");return;}setShowOnlineLobby(true);}} disabled={authLoading} style={{ flex:1,padding:"13px 0",background:`linear-gradient(135deg,rgba(0,212,255,0.1),rgba(0,212,255,0.03))`,color:t.accent,border:`1px solid rgba(0,212,255,0.3)`,borderRadius:10,fontSize:14,fontWeight:700,letterSpacing:2,cursor:authLoading?"not-allowed":"pointer",fontFamily:warrior,textTransform:"uppercase",opacity:authLoading?0.4:1 }}>🌐 SALON</RippleButton>
        <RippleButton onClick={()=>{if(!authUid){setMessage("Bağlantı bekleniyor...");return;}setShowArenaSelect(true);}} disabled={authLoading} style={{ flex:1,padding:"13px 0",background:`linear-gradient(135deg,rgba(167,139,250,0.1),rgba(167,139,250,0.03))`,color:"#a78bfa",border:"1px solid rgba(167,139,250,0.3)",borderRadius:10,fontSize:14,fontWeight:700,letterSpacing:2,cursor:authLoading?"not-allowed":"pointer",fontFamily:warrior,textTransform:"uppercase",opacity:authLoading?0.4:1,display:"flex",alignItems:"center",justifyContent:"center",gap:6 }}><XAnchors size={14} color="#a78bfa"/> ARENA</RippleButton>
      </div>
      <div style={{ display:"flex",gap:8,marginTop:8,width:"100%",maxWidth:360,animation:"fadeUp 0.7s ease-out",zIndex:1 }}>
        <RippleButton onClick={startBotGame} style={{ flex:1,padding:"13px 0",background:`linear-gradient(135deg,rgba(52,211,153,0.1),rgba(52,211,153,0.03))`,color:"#34d399",border:"1px solid rgba(52,211,153,0.3)",borderRadius:10,fontSize:14,fontWeight:700,letterSpacing:2,cursor:"pointer",fontFamily:warrior,textTransform:"uppercase" }}>🤖 BOT</RippleButton>
        <RippleButton onClick={()=>setShowLeaderboard(true)} style={{ flex:1,padding:"13px 0",background:`linear-gradient(135deg,rgba(255,215,0,0.08),rgba(255,215,0,0.02))`,color:t.gold,border:`1px solid rgba(255,215,0,0.3)`,borderRadius:10,fontSize:14,fontWeight:700,letterSpacing:2,cursor:"pointer",fontFamily:warrior,textTransform:"uppercase" }}>🏆 SIRALAMA</RippleButton>
      </div>
      {/* Room code - collapsible */}
      <div style={{ marginTop:10,width:"100%",maxWidth:360,zIndex:1 }}>
        <details style={{ background:t.surface,border:`1px solid ${t.border}`,borderRadius:10,overflow:"hidden" }}>
          <summary style={{ padding:"12px 16px",cursor:"pointer",fontSize:13,color:t.textDim,fontFamily:warrior,letterSpacing:2,listStyle:"none",display:"flex",alignItems:"center",gap:8 }}>
            <span style={{ fontSize:14 }}>🔗</span> ODA KODU İLE OYNA
          </summary>
          <div style={{ padding:"12px 16px",borderTop:`1px solid ${t.border}`,display:"flex",gap:8,alignItems:"center" }}>
            <input style={{ ...inputStyle,flex:1,maxWidth:"none",padding:"10px 12px",fontSize:13,borderRadius:8 }} placeholder="Oda Kodu" value={inputRoomId} onChange={e=>setInputRoomId(e.target.value.toUpperCase())} />
            <button onClick={joinRoom} disabled={authLoading} style={{ padding:"10px 16px",background:`linear-gradient(135deg, ${t.accent}, #0088cc)`,color:t.bg,border:"none",borderRadius:8,fontSize:12,fontWeight:700,letterSpacing:1,cursor:authLoading?"not-allowed":"pointer",fontFamily:warrior,whiteSpace:"nowrap" }}>KATIL</button>
          </div>
          <div style={{ padding:"0 16px 12px",display:"flex",justifyContent:"center" }}>
            <button onClick={createRoom} disabled={authLoading} style={{ padding:"8px 20px",background:"transparent",color:t.accent,border:`1px solid ${t.accent}`,borderRadius:8,fontSize:11,fontWeight:700,letterSpacing:1,cursor:authLoading?"not-allowed":"pointer",fontFamily:warrior }}>+ YENİ ODA OLUŞTUR</button>
          </div>
        </details>
      </div>
      {message && <div style={{ marginTop:8,color:t.hit,fontSize:11,fontFamily:mono,zIndex:1 }}>{message}</div>}
      <MissionPanel missions={dailyMissions} missionProgress={missionProgress} />
      {Object.keys(missionProgress).length >= 3 && !chestClaimed && (
        <button onClick={() => { const reward = generateChestReward(); setChestReward(reward); }} style={{ marginTop:10,padding:"16px 0",width:"100%",maxWidth:340,background:`linear-gradient(135deg,rgba(251,191,36,0.2),rgba(251,191,36,0.05))`,color:t.gold,border:`2px solid ${t.gold}`,borderRadius:10,fontSize:16,fontWeight:700,letterSpacing:3,cursor:"pointer",fontFamily:warrior,textTransform:"uppercase",boxShadow:`0 0 25px ${t.goldGlow}`,animation:"borderGlow 2s infinite" }}>🎁 SANDIĞI AÇ</button>
      )}
      {chestReward && <ChestPopup reward={chestReward} onClose={() => {
        // Gold'u Firebase'e yaz
        if (authUid) {
          const newGold = safeGold(myProfile?.gold) + chestReward.gold;
          get(ref(db, `profiles/${authUid}`)).then(snap => {
            if (snap.exists()) { const p = snap.val(); set(ref(db, `profiles/${authUid}`), { ...p, gold: safeGold(p.gold) + chestReward.gold }); }
          }).catch(() => {});
          setMyProfile(prev => prev ? { ...prev, gold: newGold } : prev);
        }
        setChestClaimed(true); setChestReward(null);
      }} />}
      {dailyReward && <DailyRewardPopup reward={dailyReward.reward} streak={dailyReward.streak} onClose={() => { setMyProfile(prev => prev ? { ...prev, gold: dailyReward.newGold, loginStreak: dailyReward.streak } : prev); setDailyReward(null); }} />}
      {showDailyChest && !dailyChestModalOpen && <DailyChestFab onOpen={() => setDailyChestModalOpen(true)} />}
      {dailyChestModalOpen && <DailyChestPopup onClaim={claimDailyChest} />}
      {goldAnim && <GoldCoinAnim amount={goldAnim.amount} onDone={()=>setGoldAnim(null)} />}
      <button onClick={handleLogout} style={{ marginTop:16,padding:"8px 20px",background:"transparent",color:t.textDim,border:`1px solid ${t.border}`,borderRadius:8,fontSize:10,fontWeight:600,letterSpacing:1,cursor:"pointer",fontFamily:warrior,zIndex:1,opacity:0.6 }}>ÇIKIŞ YAP</button>
    </div>);
  }

  if (phase === "waiting") {
    return (<div style={appStyle}><style>{ANIMS}</style>
      <div style={{ fontSize:30,fontWeight:700,letterSpacing:5,color:t.accent,textShadow:`0 0 30px ${t.accentGlow}`,marginBottom:4,fontFamily:warrior }}>AMİRAL BATTI</div>
      <div style={{ fontSize:10,color:t.textDim,letterSpacing:6,marginBottom:28,fontFamily:warrior }}>RAKİP BEKLENİYOR</div>
      <div style={{ background:t.surface,border:`1px solid ${t.border}`,borderRadius:14,padding:28,textAlign:"center",width:"100%",maxWidth:340,boxShadow:"0 8px 32px rgba(0,0,0,0.3)" }}>
        <div style={{ fontSize:13,marginBottom:10,fontFamily:warrior,letterSpacing:2 }}>ODA KODU</div>
        <div style={{ fontSize:36,fontWeight:700,color:t.accent,letterSpacing:8,textShadow:`0 0 20px ${t.accentGlow}`,marginBottom:14,fontFamily:warrior }}>{roomId}</div>
        <div style={{ fontSize:11,color:t.textDim,fontFamily:mono }}>Bu kodu rakibine gönder!</div>
        {entryFeeDeducted && <div style={{ fontSize:11,color:t.gold,fontFamily:warrior,marginTop:8,letterSpacing:1 }}>Giriş ücreti: -{entryFeeDeducted} 💰</div>}
        <div style={{ marginTop:20 }}><div style={{ width:12,height:12,borderRadius:"50%",background:t.accent,margin:"0 auto",animation:"pulse 1.5s infinite" }} /></div>
      </div>
    </div>);
  }

  if (phase === "placing") {
    const allPlaced = placedShips.length === SHIPS.length, timerLow = placementTimer <= 15, nextShip = SHIPS.find(s => !placedShips.some(p => p.id === s.id));
    // Placement preview overlay
    if (placementPreview && allPlaced) {
      return (<div style={{ ...appStyle, justifyContent:"center" }}><style>{ANIMS}</style>
        <div style={{ animation:"previewZoom 0.8s ease-out forwards",textAlign:"center",width:"100%",maxWidth:400 }}>
          <div style={{ fontSize:16,fontWeight:800,color:t.accent,fontFamily:warrior,letterSpacing:4,marginBottom:12,textShadow:`0 0 15px ${t.accentGlow}` }}>DONANMAN HAZIR!</div>
          <div style={{ animation:"floatShadow 3s ease-in-out infinite",borderRadius:14,overflow:"hidden",border:`2px solid ${t.accent}`,boxShadow:`0 10px 40px rgba(0,0,0,0.5), 0 0 20px ${t.accentGlow}` }}>
            <Grid board={defenseBoard} cellSize={cellSize} isDefense shipColors={shipColorMap} overlay={defenseOverlay} disabled />
          </div>
          <div style={{ display:"flex",gap:10,marginTop:16,justifyContent:"center" }}>
            <button onClick={()=>setPlacementPreview(false)} style={{ padding:"12px 24px",background:"transparent",color:t.textDim,border:`2px solid ${t.border}`,borderRadius:10,fontSize:13,fontWeight:800,letterSpacing:2,cursor:"pointer",fontFamily:warrior }}>↩ DÜZENLE</button>
            <button onClick={confirmPlacement} style={{ padding:"12px 32px",background:`linear-gradient(135deg,${t.accent},#0891b2)`,color:t.bg,border:"none",borderRadius:10,fontSize:14,fontWeight:800,letterSpacing:3,cursor:"pointer",fontFamily:warrior,boxShadow:`0 4px 20px ${t.accentGlow}`,animation:"borderGlow 1.5s infinite" }}>✓ SAVAŞA BAŞLA</button>
          </div>
        </div>
      </div>);
    }
    return (<div style={{ ...appStyle, paddingBottom: 80 }}><style>{ANIMS}</style>
      <div style={{ fontSize:22,fontWeight:800,letterSpacing:5,color:t.accent,marginBottom:4,fontFamily:warrior,textShadow:`0 0 15px ${t.accentGlow}` }}>GEMİ YERLEŞTİR</div>
      <div style={{ fontSize:26,fontWeight:800,marginBottom:6,color:timerLow?t.hit:t.accent,animation:timerLow?"blink3s 0.5s infinite":"none",fontFamily:warrior,textShadow:timerLow?`0 0 20px ${t.hitGlow}`:"none" }}>{formatTime(placementTimer)}</div>
      {/* Extra time button */}
      {placementTimer <= 15 && !extraTimeUsed && !placementConfirmed && (
        <button onClick={buyExtraTime} style={{ marginBottom:8,padding:"8px 18px",background:"linear-gradient(135deg, rgba(255,215,0,0.15), rgba(255,215,0,0.05))",color:t.gold,border:`2px solid rgba(255,215,0,0.3)`,borderRadius:10,fontSize:12,fontWeight:800,letterSpacing:2,cursor:"pointer",fontFamily:warrior,animation:"borderGlow 1s infinite",boxShadow:`0 0 15px ${t.goldGlow}` }}>⏱ +10 SANİYE (10 💰)</button>
      )}
      {extraTimeUsed && <div style={{ fontSize:10,color:t.gold,fontFamily:warrior,marginBottom:6,letterSpacing:2 }}>⏱ Ek süre kullanıldı</div>}
      <div style={{ fontSize:13,fontWeight:700,color:t.text,marginBottom:8,fontFamily:warrior,letterSpacing:2 }}>{placedShips.length}/{SHIPS.length} GEMİ YERLEŞTİRİLDİ</div>
      {entryFeeDeducted && <div style={{ fontSize:11,fontWeight:700,color:t.gold,fontFamily:warrior,marginBottom:6,letterSpacing:2 }}>💰 Giriş: {entryFeeDeducted} 💰</div>}
      {!allPlaced && !placementConfirmed && (<>
        <div style={{ background:"linear-gradient(145deg, rgba(12,21,41,0.9), rgba(8,14,30,0.95))",border:`2px solid rgba(0,229,255,0.15)`,borderRadius:10,padding:"10px 16px",marginBottom:8,fontSize:13,textAlign:"center",width:"100%",maxWidth:400,fontFamily:warrior,fontWeight:700,letterSpacing:1 }}>{selectedShip?<span><span style={{ color:t.accent,fontWeight:800 }}>▸</span> Haritada bir yere dokun</span>:<span><span style={{ color:t.accent,fontWeight:800 }}>▸</span> Aşağıdan bir gemi seç</span>}</div>
        <div style={{ display:"flex",flexWrap:"wrap",gap:6,justifyContent:"center",marginBottom:10,maxWidth:400,width:"100%" }}>
          {SHIPS.map(ship=>{const placed=placedShips.some(p=>p.id===ship.id);const sel=selectedShip===ship.id;return(<button key={ship.id} onClick={()=>{if(!placed){setSelectedShip(sel?null:ship.id);setRotation(0);}}} style={{ padding:"7px 12px",background:placed?"rgba(22,32,64,0.4)":sel?t.accent:"rgba(12,21,41,0.8)",color:placed?t.textDim:sel?t.bg:t.text,border:`2px solid ${placed?"rgba(30,58,95,0.3)":sel?t.accent:ship.color+"66"}`,borderRadius:8,fontSize:11,cursor:placed?"default":"pointer",fontFamily:warrior,fontWeight:800,opacity:placed?0.35:1,textDecoration:placed?"line-through":"none",letterSpacing:1,animation:!placed&&!sel&&ship.id===nextShip?.id?"borderGlow 2s infinite":"none",transition:"all 0.15s ease" }}>{ship.name}({ship.size})</button>);})}
        </div>
        {/* Rastgele yerleştir */}
        {!placementConfirmed && <button onClick={autoPlaceShips} style={{ width:"100%",maxWidth:400,padding:"13px 0",marginBottom:10,background:"linear-gradient(135deg, rgba(167,139,250,0.15), rgba(167,139,250,0.05))",color:"#a78bfa",border:"2px solid rgba(167,139,250,0.4)",borderRadius:12,fontSize:15,fontWeight:800,cursor:"pointer",fontFamily:warrior,letterSpacing:3,display:"flex",alignItems:"center",justifyContent:"center",gap:10,boxShadow:"0 0 16px rgba(167,139,250,0.15)" }}>
          🎲 RASTGELE YERLEŞTİR
        </button>}
        {/* Mobile-friendly rotate and undo buttons - large touch targets */}
        <div style={{ display:"flex",gap:10,marginBottom:10,width:"100%",maxWidth:400,justifyContent:"center" }}>
          {selectedShip && <button onClick={() => setRotation((rotation + 1) % 4)} style={{ flex:1,maxWidth:180,padding:"14px 0",background:"linear-gradient(135deg, rgba(0,229,255,0.12), rgba(0,229,255,0.04))",color:t.accent,border:`2px solid rgba(0,229,255,0.3)`,borderRadius:12,fontSize:20,fontWeight:800,cursor:"pointer",fontFamily:warrior,letterSpacing:2,display:"flex",alignItems:"center",justifyContent:"center",gap:8 }}>
            <span style={{ fontSize:24,display:"inline-block",transform:`rotate(${rotation*90}deg)`,transition:"transform 0.3s ease" }}>↻</span> DÖNDÜR
          </button>}
          {placedShips.length > 0 && <button onClick={undoLastShip} style={{ flex:1,maxWidth:180,padding:"14px 0",background:"rgba(255,71,87,0.08)",color:t.hit,border:`2px solid rgba(255,71,87,0.3)`,borderRadius:12,fontSize:14,fontWeight:800,cursor:"pointer",fontFamily:warrior,letterSpacing:2 }}>↩ GERİ AL</button>}
        </div>
        {selectedShip && <div style={{ fontSize:10,color:t.textDim,fontFamily:mono,marginBottom:6,textAlign:"center" }}>Haritaya dokun yerleştir • Döndür butonuna veya tekrar dokun</div>}
      </>)}
      {allPlaced && !placementConfirmed && <div style={{ textAlign:"center",marginBottom:12 }}>
        <button style={{ ...btnStyle,animation:"borderGlow 1.5s infinite",padding:"14px 36px",fontSize:16,fontWeight:800,letterSpacing:4,borderRadius:12 }} onClick={confirmPlacement}>✓ GEMİLERİ ONAYLA</button>
        <div style={{ fontSize:11,color:t.textDim,fontFamily:mono,marginTop:8,letterSpacing:1 }}>✏️ Gemiye dokun = döndürür • Basılı tutup sürükle = taşırsın</div>
      </div>}
      {placementConfirmed && <div style={{ background:"linear-gradient(145deg, rgba(12,21,41,0.9), rgba(8,14,30,0.95))",border:`2px solid rgba(0,229,255,0.2)`,borderRadius:12,padding:"16px 24px",marginBottom:8,fontSize:14,fontWeight:700,color:t.accent,textAlign:"center",fontFamily:warrior,letterSpacing:2 }}>Gemilerin hazır! Rakip bekleniyor...<div style={{ marginTop:10 }}><div style={{ width:14,height:14,borderRadius:"50%",background:t.accent,margin:"0 auto",animation:"pulse 1.5s infinite" }} /></div></div>}
      <div onMouseLeave={() => { if(!dragRef.current) setHoverCells([]); }}><Grid board={defenseBoard} cellSize={cellSize} isDefense shipColors={shipColorMap} overlay={defenseOverlay} hoverCells={hoverCells} onClick={handleDefenseClick} onHover={handleDefenseHover} onCellPointerDown={handleShipPointerDown} disabled={placementConfirmed} /></div>
    </div>);
  }

  if (phase === "playing") {
    const myLow = myClock <= 30, oppLow = oppClock <= 30, isAttack = activeBoard === "attack";
    const miniGrid = isOnboarding; // 7x7 grid for onboarding
    const gridSize = miniGrid ? Math.min(38, Math.floor((Math.min((typeof window !== "undefined" ? window.innerWidth : 400) - 24, 320)) / 8)) : cellSize;
    const flyEmoji = emojiToast || myEmojiToast;
    return (<div style={{ ...appStyle, paddingBottom: 74, background:`
      radial-gradient(ellipse at 15% 10%, rgba(0,229,255,0.06) 0%, transparent 45%),
      radial-gradient(ellipse at 85% 90%, rgba(255,71,87,0.05) 0%, transparent 45%),
      repeating-linear-gradient(0deg, transparent 0px, transparent 39px, rgba(0,229,255,0.030) 39px, rgba(0,229,255,0.030) 40px),
      repeating-linear-gradient(90deg, transparent 0px, transparent 39px, rgba(0,229,255,0.030) 39px, rgba(0,229,255,0.030) 40px),
      ${t.bg}`, position:"relative" }}><style>{ANIMS}</style>
      {/* HUD tarama çizgisi */}
      <div style={{ position:"fixed",left:0,right:0,height:2,background:"linear-gradient(90deg, transparent, rgba(0,229,255,0.25), transparent)",animation:"scanline 7s linear infinite",pointerEvents:"none",zIndex:1 }} />
      {/* Köşe braketleri */}
      <div style={{ position:"fixed",top:8,left:8,width:26,height:26,borderTop:"2px solid rgba(0,229,255,0.35)",borderLeft:"2px solid rgba(0,229,255,0.35)",pointerEvents:"none",zIndex:1 }} />
      <div style={{ position:"fixed",top:8,right:8,width:26,height:26,borderTop:"2px solid rgba(0,229,255,0.35)",borderRight:"2px solid rgba(0,229,255,0.35)",pointerEvents:"none",zIndex:1 }} />
      <div style={{ position:"fixed",bottom:8,left:8,width:26,height:26,borderBottom:"2px solid rgba(0,229,255,0.35)",borderLeft:"2px solid rgba(0,229,255,0.35)",pointerEvents:"none",zIndex:1 }} />
      <div style={{ position:"fixed",bottom:8,right:8,width:26,height:26,borderBottom:"2px solid rgba(0,229,255,0.35)",borderRight:"2px solid rgba(0,229,255,0.35)",pointerEvents:"none",zIndex:1 }} />
      {/* Uçan 3D emoji */}
      {flyEmoji && <div key={flyEmoji.emoji + (flyEmoji.label||"")} style={{ position:"fixed",top:"42%",left:"50%",zIndex:10002,pointerEvents:"none",textAlign:"center",animation:"emojiFly3d 2.8s cubic-bezier(0.18,1.2,0.4,1) forwards",transformStyle:"preserve-3d" }}>
        <div style={{ fontSize:84,filter:"drop-shadow(0 12px 24px rgba(0,0,0,0.7)) drop-shadow(0 0 40px rgba(0,229,255,0.35)) saturate(1.4)" }}>{flyEmoji.emoji}</div>
        <div style={{ fontSize:15,fontWeight:900,color:"#fff",fontFamily:warrior,letterSpacing:3,textTransform:"uppercase",textShadow:"0 2px 0 rgba(0,0,0,0.8), 0 0 24px rgba(0,229,255,0.6)",marginTop:4 }}>{flyEmoji.label}</div>
      </div>}
      {/* PES ET / OYUNDAN AYRIL butonu */}
      <div style={{ width:"100%",maxWidth:400,display:"flex",justifyContent:"flex-end",marginBottom:4 }}>
        <button onClick={() => setShowSurrenderConfirm(true)} style={{ padding:"4px 12px",background:"transparent",color:t.textDim,border:`1px solid rgba(255,71,87,0.2)`,borderRadius:6,fontSize:9,fontWeight:700,letterSpacing:1,cursor:"pointer",fontFamily:warrior,opacity:0.7 }}>OYUNDAN AYRIL</button>
      </div>
      {/* Surrender confirm modal */}
      {showSurrenderConfirm && <div style={{ position:"fixed",inset:0,background:"rgba(0,0,0,0.75)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:9999,backdropFilter:"blur(4px)" }}>
        <div style={{ background:`linear-gradient(145deg,rgba(12,21,41,0.99),rgba(8,14,30,0.99))`,border:`2px solid ${t.hit}`,borderRadius:16,padding:"28px 32px",textAlign:"center",maxWidth:300,width:"90%",boxShadow:`0 0 60px ${t.hitGlow}`,animation:"scaleUp 0.3s ease-out" }}>
          <div style={{ fontSize:32,marginBottom:10 }}>⚠️</div>
          <div style={{ fontSize:16,fontWeight:800,color:t.hit,fontFamily:warrior,letterSpacing:3,marginBottom:8 }}>AYRILMAK İSTİYOR MUSUN?</div>
          <div style={{ fontSize:12,color:t.textDim,fontFamily:mono,marginBottom:20 }}>{isOnboarding?"Eğitim savaşından çıkacaksın.":"Ayrılırsan maçı kaybedersin!"}</div>
          <div style={{ display:"flex",gap:10 }}>
            <button onClick={()=>setShowSurrenderConfirm(false)} style={{ flex:1,padding:"12px 0",background:`linear-gradient(135deg,${t.accent},#0891b2)`,color:t.bg,border:"none",borderRadius:10,fontSize:13,fontWeight:800,letterSpacing:2,cursor:"pointer",fontFamily:warrior }}>KALIYORUM</button>
            <button onClick={()=>{setShowSurrenderConfirm(false);surrenderGame();}} style={{ flex:1,padding:"12px 0",background:"transparent",color:t.hit,border:`2px solid ${t.hit}`,borderRadius:10,fontSize:13,fontWeight:800,letterSpacing:2,cursor:"pointer",fontFamily:warrior }}>ÇIKIŞ</button>
          </div>
        </div>
      </div>}
      {/* Onboarding mini guide — kaldırıldı */}
      {!isOnboarding && <div style={{ display:"flex",gap:8,alignItems:"stretch",marginBottom:6,width:"100%",maxWidth:400,justifyContent:"center" }}>
        <div style={{ flex:1,padding:"4px 10px",borderRadius:6,background:myTurn?(myLow?"rgba(239,68,68,0.15)":"rgba(6,182,212,0.12)"):t.surfaceLight,border:`1px solid ${myTurn?(myLow?t.hit:t.accent):t.border}`,textAlign:"center" }}>
          <div style={{ fontSize:13,fontWeight:700,fontFamily:warrior,color:myTurn?(myLow?t.hit:t.accent):t.textDim,letterSpacing:1 }}>{playerName}: {formatTime(myClock)}</div>
          <EmojiDisplay emoji={myEmojiToast?.emoji} label={myEmojiToast?.label} />
        </div>
        <div style={{ flex:1,padding:"4px 10px",borderRadius:6,background:!myTurn?(oppLow?"rgba(239,68,68,0.15)":"rgba(6,182,212,0.12)"):t.surfaceLight,border:`1px solid ${!myTurn?(oppLow?t.hit:t.accent):t.border}`,textAlign:"center" }}>
          <div style={{ fontSize:13,fontWeight:700,fontFamily:warrior,color:!myTurn?(oppLow?t.hit:t.accent):t.textDim,letterSpacing:1 }}>{opponentName}: {formatTime(oppClock)}</div>
          <EmojiDisplay emoji={emojiToast?.emoji} label={emojiToast?.label} />
        </div>
      </div>}
      {isOnboarding && <div style={{ fontSize:18,fontWeight:900,color:t.accent,fontFamily:warrior,letterSpacing:8,marginBottom:8,textAlign:"center",textShadow:`0 0 30px ${t.accentGlow}, 0 0 60px rgba(0,229,255,0.2)`,animation:"victoryGlow 3s ease-in-out infinite",textTransform:"uppercase",display:"flex",alignItems:"center",justifyContent:"center",gap:10 }}><XAnchors size={18} color={t.accent}/> EĞİTİM SAVAŞI <XAnchors size={18} color={t.accent}/></div>}
      
      {!myTurn && !isBotGame && afkTimer !== null && afkTimer <= 15 && (
        <div style={{ background:afkTimer<=5?"rgba(255,71,87,0.2)":"rgba(255,215,0,0.1)",border:`1px solid ${afkTimer<=5?t.hit:t.gold}`,borderRadius:8,padding:"4px 14px",marginBottom:6,fontSize:12,fontWeight:800,color:afkTimer<=5?t.hit:t.gold,fontFamily:warrior,letterSpacing:2,animation:afkTimer<=5?"blink3s 0.4s infinite":"none",textAlign:"center" }}>
          ⏳ Rakip oynamıyor — {afkTimer}s
        </div>
      )}
      {!isOnboarding && <div style={{ fontSize:12,color:t.text,marginBottom:6,fontFamily:mono,fontWeight:700 }}>İsabet: <span style={{ color:t.accent }}>{myHits}/20</span></div>}
      
      {streakToast && <div style={{ background:"rgba(251,191,36,0.15)",border:`1px solid ${t.gold}`,borderRadius:8,padding:"6px 14px",marginBottom:6,fontSize:14,color:t.gold,fontWeight:700,textAlign:"center",width:"100%",maxWidth:400,animation:"popIn 0.3s ease-out",fontFamily:warrior,letterSpacing:2 }}>🔥 {streakToast.streak} İSABET SERİSİ — x{streakToast.mult} ÇARPAN</div>}
      {hitStreak > 0 && !streakToast && <div style={{ fontSize:10,color:t.gold,marginBottom:4,fontFamily:warrior,letterSpacing:1,textAlign:"center" }}>🔥 Seri: {hitStreak}</div>}
      {damageReport && <div style={{ background:"rgba(239,68,68,0.1)",border:`1px solid ${t.hit}`,borderRadius:8,padding:"6px 14px",marginBottom:6,fontSize:11,color:t.hit,fontWeight:700,textAlign:"center",width:"100%",maxWidth:400,animation:"slideIn 0.3s ease-out",fontFamily:warrior,letterSpacing:1 }}>⚠ {damageReport}</div>}
      {!isOnboarding && <>
      <div style={{ display:"flex",gap:0,marginBottom:6,width:"100%",maxWidth:400 }}>
        <button onClick={()=>{setActiveBoard("attack");setMarkMode(false);}} style={{ flex:1,padding:"12px 0",fontSize:15,fontWeight:800,fontFamily:warrior,cursor:"pointer",background:isAttack?`linear-gradient(135deg,${t.accent},#0891b2)`:t.surfaceLight,color:isAttack?t.bg:t.textDim,border:`2px solid ${isAttack?t.accent:t.border}`,borderRadius:"10px 0 0 10px",letterSpacing:4,animation:myTurn&&isAttack?"borderGlow 2s infinite":"none",display:"flex",alignItems:"center",justifyContent:"center",gap:6 }}><XAnchors size={16} color={isAttack?t.bg:t.textDim}/> SALDIRI</button>
        <button onClick={()=>{setActiveBoard("defense");setMarkMode(false);}} style={{ flex:1,padding:"12px 0",fontSize:15,fontWeight:800,fontFamily:warrior,cursor:"pointer",background:!isAttack?`linear-gradient(135deg,${t.accent},#0891b2)`:t.surfaceLight,color:!isAttack?t.bg:t.textDim,border:`2px solid ${!isAttack?t.accent:t.border}`,borderRadius:"0 10px 10px 0",letterSpacing:4 }}>🛡 SAVUNMA</button>
      </div>
      {isAttack && <button onClick={()=>setMarkMode(!markMode)} style={{ marginBottom:6,padding:"6px 16px",fontSize:10,fontWeight:700,fontFamily:warrior,background:markMode?t.gold:"transparent",color:markMode?t.bg:t.gold,border:`1px solid ${t.gold}`,borderRadius:6,cursor:"pointer",letterSpacing:2 }}>{markMode?"⚑ İŞARETLEME MODU: AÇIK":"⚑ İŞARETLE"}</button>}
      </>}
      <div style={{ width:"100%",maxWidth:400,border:myTurn?`3px solid ${t.accent}`:`2px solid rgba(255,71,87,0.35)`,borderRadius:12,padding:2,animation:myTurn?"turnPulse 1.1s ease-in-out infinite":"none",transition:"border-color 0.4s ease" }}>
        {isAttack?<><Grid board={isOnboarding?Array.from({length:7},()=>Array(7).fill(0)):emptyGrid()} cellSize={isOnboarding?gridSize:cellSize} overlay={getAttackDisplayOverlay()} onClick={handleAttackClick} onRightClick={handleAttackRightClick} onLongPress={handleAttackLongPress} disabled={!myTurn} manualMarks={manualMarks} blinkCells={blinkCells} onboardingHint={isOnboarding?(!onboardingMilestones.firstHit?[[2,2],[2,3],[2,4]]:(onboardingMilestones.firstHit&&!onboardingMilestones.firstSunk?[[3,3]]:null)):null} />{!isOnboarding&&<ShipStatusPanel title="RAKİP GEMİLER" ships={oppShipsData} hitCells={atkHitMap} color={t.hit} />}</>:<><Grid board={defenseBoard} cellSize={isOnboarding?gridSize:cellSize} isDefense shipColors={shipColorMap} overlay={defenseOverlay} disabled blinkCells={blinkCells} />{!isOnboarding&&<ShipStatusPanel title="GEMİLERİM" ships={myShipsData} hitCells={defHitMap} color={t.accent} />}</>}
      </div>
      {isTestMode() && <button onClick={forceEndGame} style={{ marginTop:8,padding:"8px 16px",background:"rgba(251,191,36,0.2)",color:t.gold,border:`1px solid ${t.gold}`,borderRadius:6,fontSize:10,fontWeight:700,letterSpacing:1,cursor:"pointer",fontFamily:warrior }}>🧪 OYUNU BİTİR (TEST)</button>}
      {myTurn && isAttack && !markMode && (<div style={{ position:"fixed",bottom:0,left:0,right:0,background:"rgba(10,14,23,0.96)",backdropFilter:"blur(10px)",borderTop:`1px solid ${t.border}`,padding:"10px 16px",display:"flex",alignItems:"center",justifyContent:"center",gap:14,zIndex:100 }}>
        <div style={{ display:"flex",gap:5 }}>{[0,1,2].map(i=><div key={i} style={{ width:14,height:14,borderRadius:"50%",background:i<currentShots.length?t.hit:t.accent,opacity:i<currentShots.length?0.3:1,animation:i<currentShots.length?"popIn 0.3s ease-out":"none" }} />)}</div>
        <RippleButton onClick={fireShots} disabled={currentShots.length===0} style={{ padding:"12px 36px",background:currentShots.length>0?`linear-gradient(135deg,${t.hit},#dc2626)`:t.surfaceLight,color:currentShots.length>0?"#fff":t.textDim,border:"none",borderRadius:10,fontSize:16,fontWeight:700,letterSpacing:3,cursor:currentShots.length===0?"default":"pointer",fontFamily:warrior,boxShadow:currentShots.length>0?`0 0 24px ${t.hitGlow}`:"none",opacity:currentShots.length===0?0.5:1 }}>ATEŞ 🔥</RippleButton>
      </div>)}
      {!isOnboarding && <div style={{ position:"fixed",bottom:myTurn&&activeBoard==="attack"&&!markMode?64:0,left:0,right:0,display:"flex",justifyContent:"center",gap:2,background:"rgba(10,14,23,0.92)",backdropFilter:"blur(8px)",borderTop:`1px solid ${t.border}`,padding:"6px 4px",zIndex:90 }}>
        {QUICK_EMOJIS.map(qe=><button key={qe.id} onClick={()=>sendEmoji(qe)} style={{ padding:"5px 7px",background:"rgba(255,255,255,0.04)",border:"1px solid rgba(0,229,255,0.15)",fontSize:19,cursor:"pointer",borderRadius:10,transition:"transform 0.12s",filter:"drop-shadow(0 3px 4px rgba(0,0,0,0.6)) saturate(1.3)",transform:"perspective(150px) rotateX(8deg)" }} onMouseDown={e=>e.currentTarget.style.transform="perspective(150px) rotateX(8deg) scale(0.85)"} onMouseUp={e=>e.currentTarget.style.transform="perspective(150px) rotateX(8deg) scale(1)"} title={qe.label}>{qe.emoji}</button>)}
      </div>}
      <canvas id="confetti-canvas" style={{ position:'fixed',inset:0,pointerEvents:'none',zIndex:10002 }} />
      {microFeedback && <MicroFeedback text={microFeedback.text} color={microFeedback.color} onDone={()=>setMicroFeedback(null)} />}
      {goldAnim && <GoldCoinAnim amount={goldAnim.amount} onDone={()=>setGoldAnim(null)} />}
    </div>);
  }

  return null;
}
