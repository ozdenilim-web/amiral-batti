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
  { id: "tekli2", name: "Tekli-2", shape: [[0,0]], size: 1, color: "#e67e22" },
  { id: "tekli3", name: "Tekli-3", shape: [[0,0]], size: 1, color: "#d35400" },
  { id: "tekli4", name: "Tekli-4", shape: [[0,0]], size: 1, color: "#e74c3c" },
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

// === BOT AI ===
const BOT_NAMES = ["Kaptan Yıldız","Denizci Ali","Amiral Fırtına","Korsan Barış","Teğmen Dalga","Yüzbaşı Rüzgar","Kaptan Bulut","Denizci Efe"];

// === GÖREV SİSTEMİ ===
const ALL_MISSIONS = [
  { id: "sink3", text: "3 gemi batır", icon: "🚢", check: (stats) => stats.shipsSunk >= 3 },
  { id: "sink5", text: "5 gemi batır", icon: "🔥", check: (stats) => stats.shipsSunk >= 5 },
  { id: "win1", text: "1 oyun kazan", icon: "🏆", check: (stats) => stats.wins >= 1 },
  { id: "win2", text: "2 oyun kazan", icon: "⭐", check: (stats) => stats.wins >= 2 },
  { id: "hit10", text: "10 isabet yap", icon: "🎯", check: (stats) => stats.totalHits >= 10 },
  { id: "hit15", text: "15 isabet yap", icon: "💥", check: (stats) => stats.totalHits >= 15 },
  { id: "noMiss", text: "Turda karavana yeme", icon: "🛡", check: (stats) => stats.perfectTurn },
  { id: "fast", text: "3 dakikada kazan", icon: "⚡", check: (stats) => stats.fastWin },
  { id: "botWin", text: "Bot'u yen", icon: "🤖", check: (stats) => stats.botWin },
  { id: "play3", text: "3 oyun oyna", icon: "⚓", check: (stats) => stats.gamesPlayed >= 3 },
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
        placed.push({ id: ship.id, cells });
        break;
      }
      attempts++;
    }
  }
  return { board, ships: placed };
}

function botChooseShots(attackOverlay, lastHits, shotCount) {
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

function getRankInfo(elo) {
  if (elo >= 2000) return { title: "AMİRAL", color: "#fbbf24", icon: "⭐" };
  if (elo >= 1600) return { title: "KOMODOR", color: "#a78bfa", icon: "🎖" };
  if (elo >= 1400) return { title: "KAPTAN", color: "#06b6d4", icon: "⚓" };
  if (elo >= 1200) return { title: "YÜZBAŞI", color: "#34d399", icon: "🏅" };
  if (elo >= 1000) return { title: "TEĞMEN", color: "#60a5fa", icon: "📛" };
  return { title: "ER", color: "#9ca3af", icon: "🔰" };
}

// === SES MOTORU (Web Audio API — dosyasız) ===
class SoundEngine {
  constructor() { this.ctx = null; this.enabled = true; }
  init() { if (this.ctx) return; try { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch(e) { this.enabled = false; } }
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
  const [coins] = useState(() => Array.from({length: Math.min(amount > 100 ? 12 : amount > 20 ? 8 : 5, 15)}, (_,i) => ({
    id: i, delay: i*80, x: 50+(Math.random()-0.5)*60, endY: -80-Math.random()*40
  })));
  useEffect(() => { const timer = setTimeout(()=>onDone?.(), coins.length*80+1200); return ()=>clearTimeout(timer); }, []);
  return (<div style={{ position:'fixed',bottom:120,left:'50%',transform:'translateX(-50%)',zIndex:10000,pointerEvents:'none' }}>
    {coins.map(c => (
      <div key={c.id} style={{ position:'absolute', left:c.x, bottom:0, fontSize:28, animation:`coinFly 1s ease-out ${c.delay}ms forwards`, opacity:0 }}>💰</div>
    ))}
    <div style={{ position:'absolute',left:'50%',transform:'translateX(-50%)',bottom:60,fontSize:24,fontWeight:800,color:t.gold,fontFamily:warrior,textShadow:`0 0 20px ${t.goldGlow}`,animation:'scaleUp 0.5s ease-out 200ms forwards',opacity:0,whiteSpace:'nowrap',letterSpacing:3 }}>+{amount} 💰</div>
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
  useEffect(() => { const t = setTimeout(()=>onDone?.(), 800); return ()=>clearTimeout(t); }, []);
  return (<div style={{ position:'fixed',top:'30%',left:'50%',transform:'translateX(-50%)',zIndex:10001,fontSize:16,fontWeight:800,color:color||t.gold,fontFamily:warrior,letterSpacing:3,textShadow:`0 0 15px ${color||t.gold}`,animation:'microFloat 0.8s ease-out forwards',pointerEvents:'none' }}>{text}</div>);
}

const ARENAS = [
  { id: "liman", name: "LİMAN", minElo: 0, entryFee: 50, winGold: 120, loseGold: 30, color: "#9ca3af", icon: "⚓" },
  { id: "kiyi", name: "KIYI", minElo: 1000, entryFee: 100, winGold: 250, loseGold: 50, color: "#60a5fa", icon: "🌊" },
  { id: "acikdeniz", name: "AÇIK DENİZ", minElo: 1200, entryFee: 200, winGold: 520, loseGold: 80, color: "#06b6d4", icon: "🚢" },
  { id: "firtina", name: "FIRTINA", minElo: 1400, entryFee: 500, winGold: 1300, loseGold: 150, color: "#a78bfa", icon: "⛈" },
  { id: "amiral", name: "AMİRAL", minElo: 1600, entryFee: 1000, winGold: 2700, loseGold: 250, color: "#fbbf24", icon: "👑" },
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
  { id: "salute", emoji: "🫡", label: "Saygılar" },
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
  if (profile.lastDailyReward && isSameDay(profile.lastDailyReward, now)) return null;
  let streak = (profile.lastDailyReward && isConsecutiveDay(profile.lastDailyReward, now)) ? (profile.loginStreak || 0) + 1 : 1;
  const reward = calculateDailyReward(streak);
  const newGold = safeGold(profile.gold) + reward;
  // Use set() with full clean profile to avoid NaN contamination from other fields
  const cleanProfile = {
    displayName: profile.displayName || "Denizci",
    elo: (typeof profile.elo === "number" && !isNaN(profile.elo) && isFinite(profile.elo)) ? profile.elo : 1200,
    wins: (typeof profile.wins === "number" && !isNaN(profile.wins) && isFinite(profile.wins)) ? profile.wins : 0,
    losses: (typeof profile.losses === "number" && !isNaN(profile.losses) && isFinite(profile.losses)) ? profile.losses : 0,
    totalGames: (typeof profile.totalGames === "number" && !isNaN(profile.totalGames) && isFinite(profile.totalGames)) ? profile.totalGames : 0,
    gold: newGold,
    loginStreak: streak,
    lastDailyReward: now,
    createdAt: profile.createdAt || Date.now(),
    lastGameAt: profile.lastGameAt || null,
  };
  await set(profileRef, cleanProfile);
  return { reward, streak, newGold };
}

function DailyRewardPopup({ reward, streak, onClose }) {
  return (<div style={{ position:"fixed",inset:0,background:"rgba(0,0,0,0.8)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:9999,backdropFilter:"blur(4px)" }} onClick={onClose}>
    <div onClick={e=>e.stopPropagation()} style={{ background:`linear-gradient(145deg, rgba(12,21,41,0.99), rgba(8,14,30,0.99))`,border:`2px solid ${t.gold}`,borderRadius:20,padding:"36px 40px",textAlign:"center",maxWidth:340,width:"90%",boxShadow:`0 0 80px ${t.goldGlow}, 0 20px 60px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,215,0,0.1)`,animation:"scaleUp 0.4s ease-out" }}>
      <div style={{ fontSize:56,marginBottom:12,animation:"popIn 0.5s ease-out" }}>🎁</div>
      <div style={{ fontSize:11,fontWeight:700,color:t.textDim,fontFamily:mono,letterSpacing:3,marginBottom:4 }}>GÜNLÜK GİRİŞ ÖDÜLÜ</div>
      <div style={{ fontSize:20,fontWeight:800,color:t.gold,fontFamily:warrior,letterSpacing:5,marginBottom:6,textShadow:`0 0 15px ${t.goldGlow}` }}>GÜNLÜK ÖDÜL</div>
      <div style={{ fontSize:42,fontWeight:800,color:t.gold,fontFamily:warrior,marginBottom:10,textShadow:`0 0 30px ${t.goldGlow}`,animation:"goldShine 2s infinite" }}>+{reward} 💰</div>
      {streak > 1 && <div style={{ fontSize:13,fontWeight:700,color:t.accent,fontFamily:warrior,marginBottom:10,padding:"6px 16px",background:"rgba(0,229,255,0.08)",borderRadius:8,border:"1px solid rgba(0,229,255,0.15)",display:"inline-block",letterSpacing:2 }}>🔥 {streak} GÜN SERİ {streak>=7?"• x2 BONUS":streak>=3?"• x1.5 BONUS":streak>=2?"• x1.25 BONUS":""}</div>}
      <div><button onClick={onClose} style={{ marginTop:14,padding:"14px 44px",background:`linear-gradient(135deg,${t.gold},#d97706)`,color:t.bg,border:"none",borderRadius:10,fontSize:16,fontWeight:800,letterSpacing:3,cursor:"pointer",fontFamily:warrior,boxShadow:`0 4px 20px ${t.goldGlow}` }}>TOPLA</button></div>
    </div>
  </div>);
}

function ArenaSelect({ myElo, myGold, onSelect, onBack }) {
  return (<div style={{ display:"flex",flexDirection:"column",alignItems:"center",minHeight:"100vh",minHeight:"100dvh",background:`linear-gradient(180deg, ${t.bg} 0%, #071428 100%)`,padding:"24px 14px",fontFamily:mono,color:t.text }}>
    <div style={{ fontSize:26,fontWeight:800,letterSpacing:6,color:t.accent,marginBottom:6,fontFamily:warrior,textShadow:`0 0 25px ${t.accentGlow}` }}>ARENA SEÇ</div>
    <div style={{ fontSize:14,fontWeight:800,color:t.gold,fontFamily:warrior,marginBottom:20,padding:"6px 20px",background:"rgba(255,215,0,0.08)",borderRadius:10,border:"1px solid rgba(255,215,0,0.2)",letterSpacing:2 }}>💰 {myGold} ALTIN</div>
    <div style={{ width:"100%",maxWidth:420,display:"flex",flexDirection:"column",gap:10 }}>
      {ARENAS.map(arena => {
        const locked = (myElo||1200) < arena.minElo, cantAfford = (myGold||0) < arena.entryFee, disabled = locked||cantAfford;
        return (<button key={arena.id} onClick={()=>!disabled&&onSelect(arena)} disabled={disabled} style={{ display:"flex",alignItems:"center",gap:16,padding:"18px 20px",background:disabled?"rgba(22,32,64,0.5)":`linear-gradient(145deg, rgba(12,21,41,0.95), rgba(8,14,30,0.98))`,border:`2px solid ${disabled?"rgba(30,58,95,0.3)":arena.color}`,borderRadius:14,cursor:disabled?"not-allowed":"pointer",opacity:disabled?0.45:1,textAlign:"left",width:"100%",boxShadow:disabled?"none":`0 0 20px ${arena.color}22, 0 4px 20px rgba(0,0,0,0.3)`,transition:"all 0.2s ease" }}>
          <div style={{ fontSize:32,width:48,height:48,display:"flex",alignItems:"center",justifyContent:"center",background:`${arena.color}15`,borderRadius:12,border:`1px solid ${arena.color}33` }}>{arena.icon}</div>
          <div style={{ flex:1 }}><div style={{ fontSize:16,fontWeight:800,color:arena.color,fontFamily:warrior,letterSpacing:4 }}>{arena.name}</div><div style={{ fontSize:10,fontWeight:700,color:t.textDim,marginTop:3,fontFamily:mono }}>{locked?`🔒 ELO ${arena.minElo} GEREKLİ`:`Min ELO: ${arena.minElo}`}</div></div>
          <div style={{ textAlign:"right" }}><div style={{ fontSize:16,fontWeight:800,color:cantAfford?t.hit:t.gold,fontFamily:warrior }}>{arena.entryFee} 💰</div><div style={{ fontSize:9,color:t.textDim,fontWeight:700,letterSpacing:1 }}>GİRİŞ</div><div style={{ fontSize:12,fontWeight:800,color:"#4ade80",fontFamily:warrior,marginTop:3 }}>🏆 {arena.winGold} 💰</div></div>
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
    <span style={{ fontFamily:"'Oswald',sans-serif",letterSpacing:1 }}>{label}</span>
  </div>);
}

async function ensureProfile(uid, displayName) {
  const profileRef = ref(db, `profiles/${uid}`);
  const snap = await get(profileRef);
  if (!snap.exists()) {
    const startGold = isTestMode() ? 5000 : STARTING_GOLD;
    const profile = { displayName: displayName||"Denizci", elo:1200, wins:0, losses:0, totalGames:0, gold:startGold, loginStreak:0, lastDailyReward:null, createdAt:Date.now(), lastGameAt:null };
    await set(profileRef, profile);
    return profile;
  }
  const existing = snap.val();
  // ALWAYS build a clean profile — never trust existing data
  const sanitized = {
    displayName: (displayName && displayName.trim()) || existing.displayName || "Denizci",
    elo: (typeof existing.elo === "number" && !isNaN(existing.elo) && isFinite(existing.elo)) ? existing.elo : 1200,
    wins: (typeof existing.wins === "number" && !isNaN(existing.wins) && isFinite(existing.wins)) ? existing.wins : 0,
    losses: (typeof existing.losses === "number" && !isNaN(existing.losses) && isFinite(existing.losses)) ? existing.losses : 0,
    totalGames: (typeof existing.totalGames === "number" && !isNaN(existing.totalGames) && isFinite(existing.totalGames)) ? existing.totalGames : 0,
    gold: safeGold(existing.gold),
    loginStreak: (typeof existing.loginStreak === "number" && !isNaN(existing.loginStreak) && isFinite(existing.loginStreak)) ? existing.loginStreak : 0,
    lastDailyReward: existing.lastDailyReward || null,
    createdAt: existing.createdAt || Date.now(),
    lastGameAt: existing.lastGameAt || null,
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
  const wOldElo = (typeof wd.elo === "number" && !isNaN(wd.elo)) ? wd.elo : 1200;
  const lOldElo = (typeof ld.elo === "number" && !isNaN(ld.elo)) ? ld.elo : 1200;
  const wNew = calculateElo(wOldElo, lOldElo, true), lNew = calculateElo(lOldElo, wOldElo, false);
  const now = Date.now(), winGold = arena?arena.winGold:100, loseGold = arena?arena.loseGold:20;
  // Full clean profiles with set() — no NaN can survive
  const winnerProfile = {
    displayName: wd.displayName || "Denizci", elo: wNew,
    wins: ((typeof wd.wins === "number" && !isNaN(wd.wins)) ? wd.wins : 0) + 1,
    losses: (typeof wd.losses === "number" && !isNaN(wd.losses)) ? wd.losses : 0,
    totalGames: ((typeof wd.totalGames === "number" && !isNaN(wd.totalGames)) ? wd.totalGames : 0) + 1,
    gold: safeGold(wd.gold) + winGold,
    loginStreak: (typeof wd.loginStreak === "number" && !isNaN(wd.loginStreak)) ? wd.loginStreak : 0,
    lastDailyReward: wd.lastDailyReward || null, createdAt: wd.createdAt || now, lastGameAt: now,
  };
  const loserProfile = {
    displayName: ld.displayName || "Denizci", elo: lNew,
    wins: (typeof ld.wins === "number" && !isNaN(ld.wins)) ? ld.wins : 0,
    losses: ((typeof ld.losses === "number" && !isNaN(ld.losses)) ? ld.losses : 0) + 1,
    totalGames: ((typeof ld.totalGames === "number" && !isNaN(ld.totalGames)) ? ld.totalGames : 0) + 1,
    gold: safeGold(ld.gold) + loseGold,
    loginStreak: (typeof ld.loginStreak === "number" && !isNaN(ld.loginStreak)) ? ld.loginStreak : 0,
    lastDailyReward: ld.lastDailyReward || null, createdAt: ld.createdAt || now, lastGameAt: now,
  };
  await set(ref(db, `profiles/${winnerUid}`), winnerProfile);
  await set(ref(db, `profiles/${loserUid}`), loserProfile);
  return { winnerNewElo:wNew, loserNewElo:lNew, winnerOldElo:wOldElo, loserOldElo:lOldElo, winGold, loseGold };
}

async function fetchLeaderboard(count=10) {
  const snap = await get(ref(db, "profiles"));
  if (!snap.exists()) return [];
  const profiles = [];
  snap.forEach(child => { profiles.push({ uid:child.key, ...child.val() }); });
  profiles.sort((a,b) => (b.elo||1200) - (a.elo||1200));
  return profiles.slice(0, count);
}

function Leaderboard({ onBack, myUid }) {
  const [players, setPlayers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [revealed, setRevealed] = useState(0);
  useEffect(() => { fetchLeaderboard(10).then(data => { setPlayers(data); setLoading(false); }); }, []);
  // Dopamine trick 1: Staggered reveal — each player appears one by one
  useEffect(() => { if (!loading && players.length > 0) { const timers = players.map((_,i) => setTimeout(() => setRevealed(i+1), 200+i*150)); return () => timers.forEach(clearTimeout); } }, [loading, players.length]);
  // Find user's rank (even if not in top 10)
  const myIdx = players.findIndex(p => p.uid === myUid);
  const myPlayer = myIdx >= 0 ? players[myIdx] : null;
  // Dopamine trick 2: Motivational message based on rank
  const getMotivation = () => {
    if (myIdx === 0) return "👑 Denizlerin hakimisin!";
    if (myIdx > 0 && myIdx < 3) return "🔥 Zirveye çok yakınsın!";
    if (myIdx >= 3 && myIdx < 10) return "⚡ TOP 10'dasın, devam et!";
    return "⚔ Sıralamaya girmek için savaş!";
  };
  return (<div style={{ display:"flex",flexDirection:"column",alignItems:"center",minHeight:"100vh",minHeight:"100dvh",background:`linear-gradient(180deg, ${t.bg} 0%, #071428 50%, rgba(255,215,0,0.02) 100%)`,padding:"24px 14px",fontFamily:mono,color:t.text }}>
    <div style={{ fontSize:32,fontWeight:800,letterSpacing:8,color:t.gold,marginBottom:2,fontFamily:warrior,textShadow:`0 0 30px ${t.goldGlow}`,animation:"fadeUp 0.4s ease-out" }}>SIRALAMA</div>
    <div style={{ fontSize:12,fontWeight:800,color:t.textDim,letterSpacing:6,marginBottom:6,fontFamily:warrior }}>TOP 10</div>
    {/* Dopamine trick 3: Your current position badge */}
    {!loading && <div style={{ padding:"8px 20px",background:"rgba(0,229,255,0.06)",border:`2px solid rgba(0,229,255,0.15)`,borderRadius:12,marginBottom:16,animation:"fadeUp 0.6s ease-out" }}>
      <div style={{ fontSize:13,fontWeight:800,color:t.accent,fontFamily:warrior,letterSpacing:2,textAlign:"center" }}>{getMotivation()}</div>
    </div>}
    {loading ? <div style={{ color:t.textDim,fontSize:14,marginTop:40,fontFamily:warrior,letterSpacing:3,animation:"pulse 1.5s infinite" }}>Yükleniyor...</div> : players.length===0 ? <div style={{ color:t.textDim,fontSize:14,marginTop:40,fontFamily:warrior }}>Henüz oyuncu yok</div> : (
      <div style={{ width:"100%",maxWidth:420,display:"flex",flexDirection:"column",gap:8 }}>
        {players.slice(0,10).map((p,i) => {
          if (i >= revealed) return null;
          const rank = getRankInfo(p.elo||1200), isMe = p.uid===myUid, winRate = p.totalGames>0?Math.round((p.wins/p.totalGames)*100):0;
          const medalColors = [["#ffd700","rgba(255,215,0,0.2)","rgba(255,215,0,0.35)"],["#c0c0c0","rgba(192,192,192,0.15)","rgba(192,192,192,0.25)"],["#cd7f32","rgba(205,127,50,0.15)","rgba(205,127,50,0.25)"]];
          const isMedal = i < 3;
          return (<div key={p.uid} style={{ display:"flex",alignItems:"center",gap:14,padding:isMedal?"14px 18px":"12px 16px",background:isMe?"rgba(0,229,255,0.1)":isMedal?medalColors[i][1]:"rgba(12,21,41,0.8)",border:`2px solid ${isMe?"rgba(0,229,255,0.4)":isMedal?medalColors[i][2]:"rgba(30,58,95,0.3)"}`,borderRadius:14,boxShadow:isMedal?`0 0 20px ${medalColors[i][2]}`:isMe?`0 0 15px rgba(0,229,255,0.15)`:"none",animation:`arSlideIn 0.5s ease-out ${i*0.1}s both`,transform:isMedal?"scale(1.02)":"none" }}>
            <div style={{ width:isMedal?42:34,height:isMedal?42:34,borderRadius:12,display:"flex",alignItems:"center",justifyContent:"center",fontSize:isMedal?22:14,fontWeight:800,background:isMedal?medalColors[i][1]:"rgba(255,255,255,0.04)",color:isMedal?medalColors[i][0]:t.textDim,fontFamily:warrior,border:`2px solid ${isMedal?medalColors[i][2]:"rgba(255,255,255,0.06)"}`,flexShrink:0 }}>{i<3?["🥇","🥈","🥉"][i]:i+1}</div>
            <div style={{ flex:1,minWidth:0 }}>
              <div style={{ display:"flex",alignItems:"center",gap:6 }}>
                <span style={{ fontSize:isMedal?16:14,fontWeight:800,color:isMe?t.accent:t.text,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",fontFamily:warrior,letterSpacing:isMedal?2:1 }}>{p.displayName}</span>
                <span style={{ fontSize:10,fontWeight:800,color:rank.color,fontFamily:warrior,letterSpacing:1 }}>{rank.icon}</span>
              </div>
              <div style={{ fontSize:10,fontWeight:600,color:t.textDim,marginTop:3,fontFamily:mono }}>{p.wins||0}G {p.losses||0}M • %{winRate}</div>
            </div>
            <div style={{ textAlign:"right" }}>
              <div style={{ fontSize:isMedal?26:22,fontWeight:800,color:rank.color,fontFamily:warrior,textShadow:`0 0 10px ${rank.color}44` }}>{p.elo||1200}</div>
              <div style={{ fontSize:9,color:t.textDim,letterSpacing:2,fontWeight:700 }}>ELO</div>
            </div>
          </div>);
        })}
      </div>
    )}
    <button onClick={onBack} style={{ marginTop:24,padding:"14px 40px",background:`linear-gradient(135deg,${t.accent},#0891b2)`,color:t.bg,border:"none",borderRadius:12,fontSize:15,fontWeight:800,letterSpacing:4,cursor:"pointer",fontFamily:warrior,boxShadow:`0 4px 20px ${t.accentGlow}` }}>GERİ DÖN</button>
  </div>);
}

const ANIMS = `
@import url('https://fonts.googleapis.com/css2?family=Oswald:wght@400;600;700&family=JetBrains+Mono:wght@400;600;700;800&display=swap');
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
@keyframes floatShadow{0%,100%{transform:translateY(0);filter:drop-shadow(0 8px 20px rgba(0,0,0,0.4))}50%{transform:translateY(-8px);filter:drop-shadow(0 16px 30px rgba(0,0,0,0.6))}}
`;
const warrior = "'Oswald', sans-serif";
const mono = "'JetBrains Mono', monospace";

function Grid({ board, cellSize, onClick, onHover, onRightClick, onLongPress, overlay, hoverCells, isDefense, shipColors, disabled, blinkCells, manualMarks, showShipStatus }) {
  const longPressRef = useRef(null);
  const [rippleCell, setRippleCell] = useState(null);
  const handleClick = (r,c) => { if(disabled)return; sfx.init(); setRippleCell(`${r},${c}`); setTimeout(()=>setRippleCell(null),400); onClick?.(r,c); };
  const handleTouchStart = (r,c) => { longPressRef.current = setTimeout(()=>{ onLongPress?.(r,c); longPressRef.current=null; },500); };
  const handleTouchEnd = () => { if(longPressRef.current){clearTimeout(longPressRef.current);longPressRef.current=null;} };
  return (<div style={{ background:`linear-gradient(135deg,${t.surface} 0%,rgba(17,24,39,0.95) 100%)`,border:"1px solid rgba(55,65,81,0.6)",borderRadius:10,padding:4,overflow:"hidden",boxShadow:"0 4px 20px rgba(0,0,0,0.4),inset 0 1px 0 rgba(255,255,255,0.03)" }}>
    <div style={{ display:"flex" }}><div style={{ width:cellSize,height:cellSize }} />{COL_LABELS.map((l,i) => <div key={i} style={{ width:cellSize,height:cellSize,display:"flex",alignItems:"center",justifyContent:"center",fontSize:8,fontWeight:700,color:t.textDim,fontFamily:mono }}>{l}</div>)}</div>
    {board.map((row,r) => (<div key={r} style={{ display:"flex" }}><div style={{ width:cellSize,height:cellSize,display:"flex",alignItems:"center",justifyContent:"center",fontSize:8,fontWeight:700,color:t.textDim,fontFamily:mono }}>{r+1}</div>
      {row.map((val,c) => {
        const ovr=overlay?.[r]?.[c], isHov=hoverCells?.some(([hr,hc])=>hr===r&&hc===c), shipColor=shipColors?.[r]?.[c], isBlink=blinkCells?.some(([br,bc])=>br===r&&bc===c), isManual=manualMarks?.[r]?.[c], isRipple=rippleCell===`${r},${c}`;
        let bg=t.water,content="",shadow="none",clr=t.textDim;
        if(isDefense){
          if(val>0&&shipColor)bg=shipColor;else if(val>0)bg=t.shipCell;
          if(ovr==="hit"){bg=t.hit;content="✕";shadow=`inset 0 0 12px ${t.hitGlow}`;clr="#fff";}
          else if(ovr==="miss"){bg=t.miss;content="•";}
          // showShipStatus: savaş haritasında vurulan gemi hücreleri farklı gösterilir
          else if(showShipStatus&&val>0&&shipColor){bg=shipColor;content="■";clr="rgba(255,255,255,0.6)";}
        }
        else{if(ovr==="hit"){bg=t.hit;content="✕";shadow=`inset 0 0 12px ${t.hitGlow}`;clr="#fff";}else if(ovr==="miss"){bg=t.miss;content="•";}else if(ovr==="sunk"){bg=t.sunk;content="💀";shadow="inset 0 0 12px rgba(249,115,22,0.4)";clr="#fff";}else if(ovr==="selected"){bg="rgba(6,182,212,0.45)";content="◎";shadow=`inset 0 0 12px ${t.accentGlow}`;clr=t.accent;}if(!ovr&&isManual){bg="rgba(251,191,36,0.15)";content="⚑";clr=t.gold;}}
        if(isHov){bg="rgba(6,182,212,0.35)";shadow=`inset 0 0 10px ${t.accentGlow}`;}
        return <div key={c} onClick={()=>handleClick(r,c)} onMouseEnter={()=>onHover?.(r,c)} onContextMenu={e=>{e.preventDefault();onRightClick?.(r,c);}} onTouchStart={()=>handleTouchStart(r,c)} onTouchEnd={handleTouchEnd} onTouchCancel={handleTouchEnd} style={{ width:cellSize,height:cellSize,border:"1px solid rgba(55,65,81,0.5)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:ovr==="sunk"?10:8,fontWeight:700,cursor:disabled?"default":"pointer",background:bg,boxShadow:shadow,color:clr,transition:"all 0.15s ease",boxSizing:"border-box",animation:isBlink?"blink3s 0.5s ease-in-out 6":isRipple?"popIn 0.3s ease-out":"none",borderRadius:1 }}>{content}</div>;
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

function MissionIcon({ icon, done }) {
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
  return iconMap[icon] || <span style={{ fontSize:20 }}>{icon}</span>;
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
        <div style={{ width:44,height:44,borderRadius:12,background:done?"rgba(74,222,128,0.12)":"rgba(0,229,255,0.06)",display:"flex",alignItems:"center",justifyContent:"center",border:`2px solid ${done?"rgba(74,222,128,0.2)":"rgba(0,229,255,0.1)"}`,flexShrink:0 }}><MissionIcon icon={m.icon} done={done} /></div>
        <div style={{ flex:1,minWidth:0 }}>
          <div style={{ fontSize:14,fontWeight:800,color:done?"#4ade80":t.text,fontFamily:warrior,letterSpacing:2 }}>{m.text.toUpperCase()}</div>
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
        <div style={{ fontSize:42,fontWeight:800,color:t.gold,fontFamily:warrior,marginBottom:8,textShadow:`0 0 30px ${t.goldGlow}`,animation:"scaleUp 0.6s ease-out" }}>+{reward.gold} 💰</div>
        <button onClick={onClose} style={{ marginTop:8,padding:"12px 36px",background:`linear-gradient(135deg,${t.accent},#0891b2)`,color:t.bg,border:"none",borderRadius:8,fontSize:14,fontWeight:700,letterSpacing:2,cursor:"pointer",fontFamily:warrior }}>TOPLA</button>
      </>)}
    </div>
  </div>);
}

function LoadingScreen({ onReady }) {
  const [step,setStep] = useState(0);
  const msgs = ["Gemiler denize indiriliyor...","Toplar hazırlanıyor...","Radarlar aktif ediliyor...","Düşman hattı taranıyor...","Savaş pozisyonu alınıyor..."];
  useEffect(()=>{ const timers=msgs.map((_,i)=>setTimeout(()=>setStep(i),1000+i*1000)); const final=setTimeout(()=>onReady(),6000); return()=>{timers.forEach(clearTimeout);clearTimeout(final);}; },[onReady]);
  return (<div style={{ display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",minHeight:"100vh",minHeight:"100dvh",background:t.bg,padding:20 }}>
    <div style={{ fontSize:38,fontWeight:700,letterSpacing:6,color:t.accent,textShadow:`0 0 40px ${t.accentGlow},0 0 80px rgba(6,182,212,0.2)`,marginBottom:40,fontFamily:warrior,textTransform:"uppercase",animation:"fadeUp 0.8s ease-out" }}>AMİRAL BATTI</div>
    <div style={{ display:"flex",flexDirection:"column",gap:14,width:"100%",maxWidth:300 }}>{msgs.map((msg,i)=><div key={i} style={{ fontSize:12,color:i<=step?t.text:"transparent",transition:"all 0.5s ease",animation:i<=step?"fadeUp 0.5s ease-out":"none",fontFamily:mono,letterSpacing:0.5 }}><span style={{ color:t.accent,marginRight:10,fontWeight:800 }}>{i<=step?"▸":"○"}</span>{msg}</div>)}</div>
    <div style={{ display:"flex",gap:8,marginTop:40 }}>{[0,1,2,3].map(i=><div key={i} style={{ width:6,height:6,borderRadius:"50%",background:t.accent,animation:"loadDots 1.4s ease-in-out infinite",animationDelay:`${i*0.15}s` }} />)}</div>
  </div>);
}

function ReadyScreen({ onStart, opponentName }) {
  return (<div style={{ display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",minHeight:"100vh",minHeight:"100dvh",background:t.bg,padding:20 }}>
    <div style={{ fontSize:14,letterSpacing:6,color:t.textDim,marginBottom:8,fontFamily:warrior,textTransform:"uppercase",animation:"fadeUp 0.4s ease-out" }}>RAKIP</div>
    <div style={{ fontSize:28,fontWeight:700,color:t.hit,marginBottom:24,fontFamily:warrior,letterSpacing:4,textTransform:"uppercase",textShadow:`0 0 20px ${t.hitGlow}`,animation:"fadeUp 0.6s ease-out" }}>{opponentName}</div>
    <div style={{ fontSize:20,color:t.text,marginBottom:36,fontFamily:warrior,letterSpacing:2,animation:"fadeUp 0.8s ease-out",textAlign:"center" }}>Gemileri batırmaya<br/>hazır mısın?</div>
    <button onClick={onStart} style={{ padding:"16px 48px",background:`linear-gradient(135deg,${t.accent},#0891b2)`,color:t.bg,border:"none",borderRadius:10,fontSize:18,fontWeight:700,letterSpacing:4,textTransform:"uppercase",cursor:"pointer",fontFamily:warrior,animation:"scaleUp 0.5s ease-out",boxShadow:`0 0 30px ${t.accentGlow},0 4px 15px rgba(0,0,0,0.3)` }}>SAVAŞA HAZIR</button>
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
        <div style={{ fontSize:64,marginBottom:8,animation:isWin?"float 2s ease-in-out infinite":"defeatShake 0.6s ease-out" }}>{isWin?"⚔":"💀"}</div>
        <div style={{ fontSize:56,fontWeight:800,letterSpacing:8,color:isWin?t.accent:t.hit,fontFamily:warrior,textTransform:"uppercase",textShadow:isWin?`0 0 60px ${t.accentGlow},0 0 120px rgba(0,229,255,0.15)`:`0 0 40px ${t.hitGlow}`,marginBottom:4,animation:isWin?"victoryGlow 2s ease-in-out infinite":"none",lineHeight:1 }}>{isWin?"ZAFER":"BOZGUN"}</div>
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

function OnlineLobby({ myUid, myName, myElo, onChallenge, onBack }) {
  const [players,setPlayers]=useState([]);const [invites,setInvites]=useState([]);const [sentInvite,setSentInvite]=useState(null);
  useEffect(()=>{const unsub=onValue(ref(db,"online_players"),snap=>{if(!snap.exists()){setPlayers([]);return;}const list=[];snap.forEach(child=>{const d=child.val();if(child.key!==myUid&&d.status==="idle")list.push({uid:child.key,...d});});list.sort((a,b)=>(b.elo||1200)-(a.elo||1200));setPlayers(list);});return()=>unsub();},[myUid]);
  useEffect(()=>{const unsub=onValue(ref(db,`invites/${myUid}`),snap=>{if(!snap.exists()){setInvites([]);return;}const list=[];snap.forEach(child=>list.push({id:child.key,...child.val()}));setInvites(list);});return()=>unsub();},[myUid]);
  useEffect(()=>{if(!sentInvite)return;const unsub=onValue(ref(db,`invites/${sentInvite.targetUid}/${myUid}`),snap=>{if(!snap.exists()){setSentInvite(null);return;}const d=snap.val();if(d.status==="accepted"&&d.roomId){remove(ref(db,`invites/${sentInvite.targetUid}/${myUid}`));setSentInvite(null);onChallenge(d.roomId,1);}else if(d.status==="rejected"){remove(ref(db,`invites/${sentInvite.targetUid}/${myUid}`));setSentInvite(null);}});return()=>unsub();},[sentInvite,myUid,onChallenge]);
  const sendInvite=async(targetUid,targetName)=>{if(sentInvite)return;await set(ref(db,`invites/${targetUid}/${myUid}`),{fromName:myName,fromElo:myElo||1200,status:"pending",time:Date.now()});setSentInvite({targetUid,targetName});};
  const cancelInvite=async()=>{if(!sentInvite)return;await remove(ref(db,`invites/${sentInvite.targetUid}/${myUid}`));setSentInvite(null);};
  const acceptInvite=async(invite)=>{const roomId=Math.random().toString(36).substring(2,8).toUpperCase();await set(ref(db,`rooms/${roomId}`),{p1_name:invite.fromName,p1_uid:invite.id,p2_name:myName,p2_uid:myUid,phase:"placing",p1_board:null,p2_board:null,p1_ships:null,p2_ships:null,attacks:null,turn:1,clocks:{p1:CLOCK_SECONDS,p2:CLOCK_SECONDS},winner:null,winReason:null,eloProcessed:false,created:Date.now()});await update(ref(db,`invites/${myUid}/${invite.id}`),{status:"accepted",roomId});setTimeout(()=>remove(ref(db,`invites/${myUid}/${invite.id}`)),3000);onChallenge(roomId,2);};
  const rejectInvite=async(invite)=>{await update(ref(db,`invites/${myUid}/${invite.id}`),{status:"rejected"});setTimeout(()=>remove(ref(db,`invites/${myUid}/${invite.id}`)),2000);};
  return (<div style={{ display:"flex",flexDirection:"column",alignItems:"center",minHeight:"100vh",minHeight:"100dvh",background:t.bg,padding:"20px 12px",fontFamily:"'JetBrains Mono',monospace",color:t.text }}>
    <div style={{ fontSize:22,fontWeight:700,letterSpacing:5,color:t.accent,marginBottom:4,fontFamily:"'Oswald',sans-serif",textShadow:`0 0 20px ${t.accentGlow}` }}>ONLİNE SALON</div>
    <div style={{ fontSize:10,color:t.textDim,letterSpacing:4,marginBottom:16,fontFamily:"'Oswald',sans-serif" }}>AKTİF DENİZCİLER</div>
    {invites.filter(inv=>inv.status==="pending").map(invite=>(<div key={invite.id} style={{ width:"100%",maxWidth:420,marginBottom:8,padding:"12px 16px",background:"rgba(6,182,212,0.1)",border:`1px solid ${t.accent}`,borderRadius:10,animation:"borderGlow 2s infinite" }}>
      <div style={{ fontSize:12,color:t.accent,fontWeight:700,fontFamily:"'Oswald',sans-serif",letterSpacing:2,marginBottom:6 }}>⚔ DÜELLO DAVETİ</div>
      <div style={{ fontSize:13,color:t.text,marginBottom:8 }}><span style={{ fontWeight:700 }}>{invite.fromName}</span><span style={{ color:t.textDim,fontSize:10,marginLeft:8 }}>ELO: {invite.fromElo}</span></div>
      <div style={{ display:"flex",gap:8 }}>
        <button onClick={()=>acceptInvite(invite)} style={{ flex:1,padding:"8px 0",background:`linear-gradient(135deg,${t.accent},#0891b2)`,color:t.bg,border:"none",borderRadius:6,fontSize:12,fontWeight:700,letterSpacing:2,cursor:"pointer",fontFamily:"'Oswald',sans-serif" }}>KABUL</button>
        <button onClick={()=>rejectInvite(invite)} style={{ flex:1,padding:"8px 0",background:"transparent",color:t.hit,border:`1px solid ${t.hit}`,borderRadius:6,fontSize:12,fontWeight:700,letterSpacing:2,cursor:"pointer",fontFamily:"'Oswald',sans-serif" }}>REDDET</button>
      </div>
    </div>))}
    {sentInvite&&(<div style={{ width:"100%",maxWidth:420,marginBottom:8,padding:"12px 16px",background:"rgba(251,191,36,0.08)",border:`1px solid ${t.gold}`,borderRadius:10 }}>
      <div style={{ fontSize:11,color:t.gold,fontFamily:"'Oswald',sans-serif",letterSpacing:2,marginBottom:4 }}>DAVETİN GÖNDERİLDİ</div>
      <div style={{ fontSize:13,color:t.text,marginBottom:8 }}><span style={{ fontWeight:700 }}>{sentInvite.targetName}</span> yanıt bekliyor...<span style={{ display:"inline-block",marginLeft:6,animation:"pulse 1.5s infinite" }}>⏳</span></div>
      <button onClick={cancelInvite} style={{ padding:"6px 16px",background:"transparent",color:t.textDim,border:`1px solid ${t.border}`,borderRadius:6,fontSize:10,cursor:"pointer",fontFamily:"'Oswald',sans-serif",letterSpacing:1 }}>İPTAL</button>
    </div>)}
    {players.length===0?(<div style={{ width:"100%",maxWidth:420,padding:"30px 20px",textAlign:"center",background:t.surface,border:`1px solid ${t.border}`,borderRadius:10,marginTop:8 }}><div style={{ fontSize:24,marginBottom:8 }}>🌊</div><div style={{ fontSize:12,color:t.textDim }}>Şu an salonda kimse yok</div><div style={{ fontSize:10,color:t.textDim,marginTop:4 }}>Hızlı Oyun ile otomatik eşleşebilirsin</div></div>):(
      <div style={{ width:"100%",maxWidth:420,display:"flex",flexDirection:"column",gap:4 }}>
        <div style={{ fontSize:9,color:t.textDim,letterSpacing:2,marginBottom:4 }}>{players.length} DENİZCİ AKTİF</div>
        {players.map(p=>{const rank=getRankInfo(p.elo||1200);const alreadySent=sentInvite?.targetUid===p.uid;return(<div key={p.uid} style={{ display:"flex",alignItems:"center",gap:10,padding:"10px 14px",background:t.surface,border:`1px solid ${t.border}`,borderRadius:8 }}>
          <div style={{ width:8,height:8,borderRadius:"50%",background:"#34d399",boxShadow:"0 0 6px rgba(52,211,153,0.5)" }} />
          <div style={{ flex:1,minWidth:0 }}><div style={{ display:"flex",alignItems:"center",gap:6 }}><span style={{ fontSize:13,fontWeight:700,color:t.text,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap" }}>{p.displayName}</span><span style={{ fontSize:9,color:rank.color,fontFamily:"'Oswald',sans-serif",letterSpacing:1 }}>{rank.icon} {rank.title}</span></div><div style={{ fontSize:9,color:t.textDim,marginTop:1 }}>ELO: {p.elo||1200} • {p.wins||0}G/{p.losses||0}M</div></div>
          <button onClick={()=>sendInvite(p.uid,p.displayName)} disabled={!!sentInvite} style={{ padding:"6px 14px",background:alreadySent?t.surfaceLight:`linear-gradient(135deg,${t.hit},#dc2626)`,color:alreadySent?t.textDim:"#fff",border:"none",borderRadius:6,fontSize:10,fontWeight:700,letterSpacing:1,cursor:sentInvite?"default":"pointer",fontFamily:"'Oswald',sans-serif",opacity:sentInvite&&!alreadySent?0.4:1 }}>{alreadySent?"BEKLENİYOR":"⚔ DÜELLO"}</button>
        </div>);})}
      </div>
    )}
    <button onClick={onBack} style={{ marginTop:20,padding:"12px 32px",background:`linear-gradient(135deg,${t.accent},#0891b2)`,color:t.bg,border:"none",borderRadius:8,fontSize:13,fontWeight:700,letterSpacing:2,cursor:"pointer",fontFamily:"'Oswald',sans-serif",textTransform:"uppercase" }}>GERİ DÖN</button>
  </div>);
}

function findMatch(myUid, myName, myElo, arenaId) {
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

  const promise = new Promise(async (resolve) => {
    await set(ref(db, `${queuePath}/${myUid}`), { displayName: myName, elo: myElo || 1200, time: Date.now() });
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
      queue.sort((a, b) => Math.abs((a.elo || 1200) - (myElo || 1200)) - Math.abs((b.elo || 1200) - (myElo || 1200)));
      const opponent = queue[0];

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
  const [emojiToast, setEmojiToast] = useState(null);
  const [myEmojiToast, setMyEmojiToast] = useState(null);
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
    set(presenceRef, { displayName: playerName.trim(), elo: myProfile?.elo || 1200, wins: myProfile?.wins || 0, losses: myProfile?.losses || 0, status: "idle", lastSeen: Date.now() });
    onDisconnect(presenceRef).remove();
    return () => { remove(presenceRef); };
  }, [authUid, playerName, phase, myProfile?.elo]);

  useEffect(() => {
    if (phase === "placing" && !placementConfirmed) {
      if (placementTimerRef.current) clearInterval(placementTimerRef.current);
      placementTimerRef.current = setInterval(() => { setPlacementTimer(prev => {
        if (prev <= 1) {
          clearInterval(placementTimerRef.current);
          // Süre bitti — kaybettin
          if (isBotGame) {
            setWinner("Gemileri zamanında yerleştiremediğin için kaybettin!"); setIsWin(false); setPhase("gameover");
            sfx.init(); sfx.play('lose');
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
        if (myTurnRef.current) { myClockRef.current = Math.max(0, myClockRef.current - 1); setMyClock(myClockRef.current); if (myClockRef.current <= 0) { clearInterval(clockIntervalRef.current); update(ref(db, `rooms/${roomIdRef.current}`), { winner: playerNumRef.current === 1 ? 2 : 1, winReason: "timeout" }); } }
        else { oppClockRef.current = Math.max(0, oppClockRef.current - 1); setOppClock(oppClockRef.current); if (oppClockRef.current <= 0) { clearInterval(clockIntervalRef.current); update(ref(db, `rooms/${roomIdRef.current}`), { winner: playerNumRef.current, winReason: "timeout" }); } }
      }, 1000);
    }
    return () => { if (clockIntervalRef.current) clearInterval(clockIntervalRef.current); };
  }, [phase]);

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
      if (game.phase === "playing") {
        if (phaseRef.current === "placing") setPhase("ready");
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
        if (game[`${oppKey}_ships`]) { Object.values(game[`${oppKey}_ships`]).forEach(ship => { const cells = ship.cells; if (cells.every(([r, c]) => atkOvr[r][c] === "hit" || atkOvr[r][c] === "sunk")) cells.forEach(([r, c]) => { atkOvr[r][c] = "sunk"; }); }); }
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
            if (game[`${myKey}_ships`]) { const myShips = Object.values(game[`${myKey}_ships`]); const reports = []; lastAtk.shots.forEach(s => { if (s.result === "hit") { const hitShip = myShips.find(sh => sh.cells.some(([r, c]) => r === s.r && c === s.c)); if (hitShip) { const shipDef = SHIPS.find(sd => sd.id === hitShip.id); const totalH = hitShip.cells.filter(([r, c]) => dHitMap[r][c]).length; reports.push(totalH === hitShip.cells.length ? `${shipDef?.name} battı!` : `${shipDef?.name} ${totalH} yara aldı`); } } }); if (reports.length > 0) { setDamageReport(reports.join(" • ")); if (damageTimerRef.current) clearTimeout(damageTimerRef.current); damageTimerRef.current = setTimeout(() => setDamageReport(""), 8000); if (reports.some(r => r.includes('battı'))) setTimeout(() => { sfx.play('sunk'); launchExplosion('confetti-canvas', window.innerWidth/2, window.innerHeight/2); }, 200); } }
          }
          if (lastAtk.by === pNum && lastAtk.shots) {
            setBlinkCells(lastAtk.shots.map(s => [s.r, s.c])); if (blinkTimerRef.current) clearTimeout(blinkTimerRef.current); blinkTimerRef.current = setTimeout(() => setBlinkCells([]), 3000);
            // Sound for own shots landing
            const myHitCount = lastAtk.shots.filter(s => s.result === "hit").length;
            sfx.init(); if (myHitCount > 0) { sfx.play('hit'); setMicroFeedback({ text: myHitCount === 3 ? 'MÜKEMMEL!' : myHitCount === 2 ? 'GÜZEL!' : 'İSABET!', color: myHitCount === 3 ? t.gold : t.accent }); } else { sfx.play('miss'); setMicroFeedback({ text: 'KARAVANA', color: t.miss }); }
          }
        }
      }
      if (game.winner) {
        const reason = game.winReason || "hits", iW = game.winner === pNum;
        let winMsg = iW ? (reason === "timeout" ? "Süre bitti — Rakip elendi!" : reason === "placement_timeout" ? "Rakip gemileri zamanında yerleştiremediği için kazandın!" : "Tüm gemileri batırdın!") : (reason === "timeout" ? "Süren doldu!" : reason === "placement_timeout" ? "Gemileri zamanında yerleştiremediğin için kaybettin!" : "Gemilerin battı!");
        setWinner(winMsg); setIsWin(iW); setPhase("gameover");
        sfx.init(); sfx.play(iW ? 'win' : 'lose');
        if (iW) setTimeout(() => launchConfetti('confetti-canvas'), 300);
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
                  await update(ref(db, `rooms/${roomIdRef.current}`), { eloResult: { winnerOldElo: result.winnerOldElo, winnerNewElo: result.winnerNewElo, loserOldElo: result.loserOldElo, loserNewElo: result.loserNewElo, winGold: result.winGold || 0, loseGold: result.loseGold || 0 } });
                  setEloChange({ myOld: result.winnerOldElo, myNew: result.winnerNewElo, oppOld: result.loserOldElo, oppNew: result.loserNewElo });
                  setGoldChange({ amount: result.winGold || 0 });
                  if (result.winGold > 0) { sfx.play('gold'); setGoldAnim({ amount: result.winGold }); }
                  setMyProfile(prev => prev ? { ...prev, elo: result.winnerNewElo, wins: (prev.wins || 0) + 1, totalGames: (prev.totalGames || 0) + 1, gold: safeGold(prev.gold) + (result.winGold || 0) } : prev);
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
              setEloChange({ myOld: er.loserOldElo, myNew: er.loserNewElo, oppOld: er.winnerOldElo, oppNew: er.winnerNewElo });
              setGoldChange({ amount: er.loseGold || 0 });
              setMyProfile(prev => prev ? { ...prev, elo: er.loserNewElo, losses: (prev.losses || 0) + 1, totalGames: (prev.totalGames || 0) + 1, gold: safeGold(prev.gold) + (er.loseGold || 0) } : prev);
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
    setPhase("lobby");
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
  };

  const handleDefenseClick = (r, c) => { if (phase !== "placing" || !selectedShip || placementConfirmed) return; const ship = SHIPS.find(s => s.id === selectedShip); if (!ship) return; const cells = getShipCells(ship, r, c, rotation); const bc = defenseBoard.map(row => [...row]); if (!isValidPlacement(cells, bc) || getNeighborCells(cells).some(([nr, nc]) => nr >= 0 && nr < ROWS && nc >= 0 && nc < COLS && bc[nr][nc] > 0)) { /* Invalid placement — try next rotation */ const nextRot = (rotation + 1) % 4; const cells2 = getShipCells(ship, r, c, nextRot); if (isValidPlacement(cells2, bc) && !getNeighborCells(cells2).some(([nr, nc]) => nr >= 0 && nr < ROWS && nc >= 0 && nc < COLS && bc[nr][nc] > 0)) { setRotation(nextRot); return; } return; } const nb = bc.map(row => [...row]); const nc = shipColorMap.map(row => [...row]); cells.forEach(([cr, cc]) => { nb[cr][cc] = 1; nc[cr][cc] = ship.color; }); setDefenseBoard(nb); setShipColorMap(nc); setPlacedShips([...placedShips, { id: ship.id, cells, color: ship.color }]); setSelectedShip(null); setHoverCells([]); setRotation(0); sfx.init(); sfx.play('click'); };
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
    const pNum = playerNumRef.current, myKey = pNum === 1 ? "p1" : "p2"; const snapshot = await get(ref(db, `rooms/${roomIdRef.current}`)); const game = snapshot.val(); if (!game || game.turn !== pNum) return; const targetKey = pNum === 1 ? "p2" : "p1"; const shotResults = currentShots.map(([r, c]) => ({ r, c, result: game[`${targetKey}_board`][r][c] > 0 ? "hit" : "miss" })); const existingAttacks = game.attacks ? Object.values(game.attacks) : []; const prevHits = existingAttacks.filter(a => a.target === targetKey).reduce((sum, a) => sum + (a.shots ? a.shots.filter(s => s.result === "hit").length : 0), 0); const totalHits = prevHits + shotResults.filter(s => s.result === "hit").length; const updates = {}; updates[`attacks/${existingAttacks.length}`] = { by: pNum, target: targetKey, shots: shotResults, time: Date.now() }; updates[`clocks/${myKey}`] = myClockRef.current; if (totalHits >= 20) { updates.winner = pNum; updates.winReason = "hits"; } else { updates.turn = pNum === 1 ? 2 : 1; } await update(ref(db, `rooms/${roomIdRef.current}`), updates); setCurrentShots([]);
  };
  const getAttackDisplayOverlay = () => { const ovr = attackOverlay.map(row => [...row]); currentShots.forEach(([r, c]) => { if (!ovr[r][c]) ovr[r][c] = "selected"; }); return ovr; };
  const forceEndGame = async () => { if (!roomIdRef.current) return; await update(ref(db, `rooms/${roomIdRef.current}`), { winner: playerNumRef.current, winReason: "test_force" }); };

  const resetGame = () => {
    if (unsubRef.current) unsubRef.current(); if (clockIntervalRef.current) clearInterval(clockIntervalRef.current); if (placementTimerRef.current) clearInterval(placementTimerRef.current);
    setPhase("lobby"); setRoomId(""); setInputRoomId(""); setPlayerNum(null); setDefenseBoard(emptyGrid()); setShipColorMap(Array.from({ length: ROWS }, () => Array(COLS).fill(null))); setAttackOverlay(emptyGrid().map(r => r.map(() => null))); setDefenseOverlay(emptyGrid().map(r => r.map(() => null))); setPlacedShips([]); setCurrentShots([]); setMyHits(0); setOppHits(0); setWinner(null); setMessage(""); setOpponentName(""); setPlacementConfirmed(false); setNotationEntries([]); setBlinkCells([]); setDamageReport(""); setManualMarks(Array.from({ length: ROWS }, () => Array(COLS).fill(false))); setMyClock(CLOCK_SECONDS); setOppClock(CLOCK_SECONDS); myClockRef.current = CLOCK_SECONDS; oppClockRef.current = CLOCK_SECONDS; setMyShipsData(null); setOppShipsData(null); setActiveBoard("attack"); setMarkMode(false); setDefHitMap(emptyGrid().map(r => r.map(() => false))); setAtkHitMap(emptyGrid().map(r => r.map(() => false))); lastAttackCountRef.current = 0; setPlacementTimer(PLACEMENT_SECONDS); setShowReview(false); setIsWin(false); setEloChange(null); eloUpdatedRef.current = false; setShowOnlineLobby(false); setMatchmaking(false); setMatchCancelFn(null); setSelectedArena(null); setShowArenaSelect(false); setGoldChange(null); setEmojiToast(null); setMyEmojiToast(null); setEntryFeeDeducted(null); setIsBotGame(false); setBotBoard(null); setBotShips(null); setBotAttackOverlay(emptyGrid().map(r => r.map(() => null))); setBotName(""); setGameStartTime(null); setHitStreak(0); setStreakToast(null); setGoldAnim(null); setMicroFeedback(null); setExtraTimeUsed(false); setPlacementPreview(false);
    if (authUid) { get(ref(db, `profiles/${authUid}`)).then(snap => { if (snap.exists()) setMyProfile(snap.val()); }).catch(() => {}); }
  };

  const sendEmoji = async (qe) => { if (!roomIdRef.current) return; setMyEmojiToast({ emoji: qe.emoji, label: qe.label }); setTimeout(() => setMyEmojiToast(null), 3000); await set(ref(db, `emojis/${roomIdRef.current}`), { emoji: qe.emoji, label: qe.label, from: playerNumRef.current, time: Date.now() }); };

  const startBotGame = () => {
    if (!playerName.trim()) { setMessage("Adını yaz!"); return; }
    const bot = botPlaceShips();
    const name = BOT_NAMES[Math.floor(Math.random() * BOT_NAMES.length)];
    setIsBotGame(true);
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
  };

  const botFireShots = () => {
    const shots = botChooseShots(botAttackOverlay, [], SHOTS_PER_TURN);
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
            reports.push(totalH === hitShip.cells.length ? `${shipDef?.name} battı!` : `${shipDef?.name} ${totalH} yara aldı`);
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
    if (botHitCount > 0) sfx.play('hit');
    if (reports.some(r => r.includes('battı'))) setTimeout(() => sfx.play('sunk'), 200);
    if (reports.length > 0) { setDamageReport(reports.join(" • ")); setTimeout(() => setDamageReport(""), 8000); }
    setActiveBoard("defense");
    // Check if bot won
    if (newOppHits >= 20) {
      setWinner("Gemilerin battı!"); setIsWin(false); setPhase("gameover");
      sfx.init(); sfx.play('lose');
      setMissionStats(prev => ({ ...prev, gamesPlayed: prev.gamesPlayed + 1 }));
    } else {
      setTimeout(() => { setMyTurn(true); setActiveBoard("attack"); }, 1500);
    }
  };

  const botHandlePlayerShots = () => {
    if (currentShots.length === 0) return;
    const newAtkOverlay = attackOverlay.map(row => [...row]);
    const newAtkHit = atkHitMap.map(row => [...row]);
    let newMyHits = myHits;
    currentShots.forEach(([r, c]) => {
      const isHit = botBoard[r][c] > 0;
      newAtkOverlay[r][c] = isHit ? "hit" : "miss";
      if (isHit) { newMyHits++; newAtkHit[r][c] = true; }
    });
    // Sound effects for shots
    sfx.init();
    const hitCount0 = currentShots.filter(([r,c]) => botBoard[r][c] > 0).length;
    if (hitCount0 > 0) { sfx.play('hit'); setMicroFeedback({ text: hitCount0 === 3 ? 'MÜKEMMEl!' : hitCount0 === 2 ? 'GÜZEL!' : 'İSABET!', color: hitCount0 === 3 ? t.gold : t.accent }); }
    else { sfx.play('miss'); setMicroFeedback({ text: 'KARAVANA', color: t.miss }); }
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
    if (sunkThisTurn) { setTimeout(() => { sfx.play('sunk'); launchExplosion('confetti-canvas', window.innerWidth/2, window.innerHeight/2); setMicroFeedback({ text: 'BATTI! 💀', color: t.sunk }); }, 300); }
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
    if (newMyHits >= 20) {
      setWinner("Tüm gemileri batırdın!"); setIsWin(true); setPhase("gameover");
      sfx.init(); sfx.play('win'); setTimeout(() => launchConfetti('confetti-canvas'), 300);
      // Count sunk ships
      const sunkCount = botShips ? Object.values(botShips).filter(ship => ship.cells.every(([r,c]) => newAtkOverlay[r][c] === "hit" || newAtkOverlay[r][c] === "sunk")).length : 0;
      const elapsed = gameStartTime ? (Date.now() - gameStartTime) / 1000 : 999;
      setMissionStats(prev => ({ ...prev, wins: prev.wins + 1, botWin: true, gamesPlayed: prev.gamesPlayed + 1, totalHits: prev.totalHits + newMyHits, shipsSunk: prev.shipsSunk + sunkCount, fastWin: elapsed < 180 }));
      // +2 gold for bot win (with streak multiplier)
      const streakMult = hitStreak >= 9 ? 4 : hitStreak >= 6 ? 3 : hitStreak >= 3 ? 2 : 1;
      const botWinGold = 2 * streakMult;
      if (authUid && myProfile) {
        const newGold = safeGold(myProfile.gold) + botWinGold;
        get(ref(db, `profiles/${authUid}`)).then(snap => {
          if (snap.exists()) {
            const p = snap.val();
            const clean = { ...p, gold: safeGold(p.gold) + botWinGold };
            set(ref(db, `profiles/${authUid}`), clean);
            setMyProfile(prev => prev ? { ...prev, gold: newGold } : prev);
          }
        }).catch(() => {});
        setGoldChange({ amount: botWinGold });
        sfx.play('gold'); setGoldAnim({ amount: botWinGold });
      }
    } else {
      setMyTurn(false);
      setTimeout(() => botFireShots(), 1200 + Math.random() * 800);
    }
  };

  const startQuickMatch = async (arenaOverride) => {
    if (!playerName.trim()) { setMessage("Adını yaz!"); return; }
    if (!authUid) { setMessage("Bağlantı bekleniyor..."); return; }
    const arena = arenaOverride || null;
    if (arena) { const cg = safeGold(myProfile?.gold); if (cg < arena.entryFee) { setMessage("Yeterli altının yok!"); return; } const newGold = cg - arena.entryFee; try { const cleanP = await ensureProfile(authUid); cleanP.gold = newGold; await set(ref(db, `profiles/${authUid}`), cleanP); } catch(e) { console.error(e); } setMyProfile(prev => prev ? { ...prev, gold: newGold } : prev); setEntryFeeDeducted(arena.entryFee); }
    setMatchmaking(true);
    const matchPromise = findMatch(authUid, playerName.trim(), myProfile?.elo || 1200, arena?.id || null);
    setMatchCancelFn(() => matchPromise._cancel);
    matchPromise.then(data => {
      if (data && data.roomId) {
        setMatchmaking(false); setMatchCancelFn(null); roomIdRef.current = data.roomId; setRoomId(data.roomId); setPlayerNum(data.playerNum); playerNumRef.current = data.playerNum; setOpponentName(data.oppName); setPhase("placing"); listenToRoom(data.roomId, data.playerNum); if (authUid) remove(ref(db, `online_players/${authUid}`));
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

  const appStyle = { minHeight: "100vh", minHeight: "100dvh", background: t.bg, color: t.text, fontFamily: mono, display: "flex", flexDirection: "column", alignItems: "center", padding: "12px 8px", boxSizing: "border-box" };
  const btnStyle = { padding: "12px 28px", background: `linear-gradient(135deg, ${t.accent}, #0891b2)`, color: t.bg, border: "none", borderRadius: 8, fontSize: 13, fontWeight: 700, letterSpacing: 2, textTransform: "uppercase", cursor: "pointer", fontFamily: warrior, boxShadow: `0 0 15px ${t.accentGlow}` };
  const btnSecStyle = { padding: "8px 16px", background: "transparent", color: t.accent, border: `1px solid ${t.accent}`, borderRadius: 6, fontSize: 11, fontWeight: 600, letterSpacing: 1, cursor: "pointer", fontFamily: warrior };
  const inputStyle = { padding: "12px 16px", background: t.surface, color: t.text, border: `1px solid ${t.border}`, borderRadius: 8, fontSize: 15, fontFamily: mono, outline: "none", textAlign: "center", width: "100%", maxWidth: 260, boxSizing: "border-box" };

  if (phase === "splash") {
    const splashDone = authReady;
    if (!splashDone) return <><style>{ANIMS}</style><LoadingScreen onReady={() => {}} /></>;
    
    // Not logged in — Google login required
    if (!authUid) return (<div style={appStyle}><style>{ANIMS}</style>
      <div style={{ display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",minHeight:"80vh" }}>
        <div style={{ fontSize:38,fontWeight:700,letterSpacing:6,color:t.accent,textShadow:`0 0 40px ${t.accentGlow}`,marginBottom:6,fontFamily:warrior,animation:"fadeUp 0.4s ease-out" }}>AMİRAL BATTI</div>
        <div style={{ fontSize:10,color:t.textDim,letterSpacing:8,marginBottom:40,fontFamily:warrior }}>DENİZ SAVAŞI</div>
        <button onClick={handleGoogleLogin} style={{ padding:"16px 36px",background:"#fff",color:"#333",border:"none",borderRadius:12,fontSize:15,fontWeight:700,cursor:"pointer",fontFamily:warrior,letterSpacing:1,display:"flex",alignItems:"center",gap:12,boxShadow:"0 4px 20px rgba(0,0,0,0.3)",animation:"scaleUp 0.5s ease-out" }}>
          <svg width="20" height="20" viewBox="0 0 24 24"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg>
          Google ile Giriş Yap
        </button>
        {message && <div style={{ marginTop:16,color:t.hit,fontSize:11,fontFamily:mono }}>{message}</div>}
      </div>
    </div>);
    
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
    
    // Logged in with valid username — go to lobby
    if (!isTestMode() && authUid && myProfile) {
      checkDailyReward(authUid).then(reward => { if (reward) setDailyReward(reward); }).catch(() => {});
    }
    setPhase("lobby");
    return <><style>{ANIMS}</style><LoadingScreen onReady={() => {}} /></>;
  }
  if (phase === "ready") return <><style>{ANIMS}</style><ReadyScreen opponentName={opponentName} onStart={() => setPhase("playing")} /></>;
  if (showLeaderboard) return <><style>{ANIMS}</style><Leaderboard onBack={() => setShowLeaderboard(false)} myUid={authUid} /></>;
  if (showArenaSelect) return <><style>{ANIMS}</style><ArenaSelect myElo={myProfile?.elo || 1200} myGold={myProfile?.gold || 0} onBack={() => setShowArenaSelect(false)} onSelect={(arena) => { setSelectedArena(arena); setShowArenaSelect(false); startQuickMatch(arena); }} /></>;
  if (showOnlineLobby) return <><style>{ANIMS}</style><OnlineLobby myUid={authUid} myName={playerName} myElo={myProfile?.elo} onBack={() => setShowOnlineLobby(false)} onChallenge={(rid, pNum) => { setShowOnlineLobby(false); roomIdRef.current = rid; setRoomId(rid); setPlayerNum(pNum); playerNumRef.current = pNum; setPhase("placing"); listenToRoom(rid, pNum); if (authUid) remove(ref(db, `online_players/${authUid}`)); }} /></>;

  if (phase === "gameover") {
    if (showReview) return <BoardReview defenseBoard={defenseBoard} shipColorMap={shipColorMap} defenseOverlay={defenseOverlay} attackOverlay={attackOverlay} oppShipsData={oppShipsData} myShipsData={myShipsData} defHitMap={defHitMap} atkHitMap={atkHitMap} cellSize={cellSize} onBack={() => setShowReview(false)} />;
    const myEloDiff = eloChange ? eloChange.myNew - eloChange.myOld : null;
    const myRank = eloChange ? getRankInfo(eloChange.myNew) : (myProfile ? getRankInfo(myProfile.elo) : null);
    return (<><style>{ANIMS}</style>
      <GameOverScreen winner={winner} myHits={myHits} oppHits={oppHits} isWin={isWin} onNewGame={resetGame} onHome={resetGame} onViewBoard={() => setShowReview(true)} />
      <canvas id="confetti-canvas" style={{ position:'fixed',inset:0,pointerEvents:'none',zIndex:10002 }} />
      {goldAnim && <GoldCoinAnim amount={goldAnim.amount} onDone={()=>setGoldAnim(null)} />}
      {eloChange && (<div style={{ position:"fixed",bottom:80,left:0,right:0,display:"flex",justifyContent:"center",zIndex:200,perspective:"600px" }}>
        <div style={{ background:"linear-gradient(145deg, rgba(12,21,41,0.98), rgba(8,14,30,0.99))",border:`2px solid ${isWin?t.accent:t.hit}`,borderRadius:16,padding:"18px 28px",textAlign:"center",animation:"arSlideIn 0.7s ease-out forwards",'--ar-color':isWin?t.accentGlow:t.hitGlow,boxShadow:`0 15px 50px rgba(0,0,0,0.6), 0 0 30px ${isWin?t.accentGlow:t.hitGlow}` }}>
          <div style={{ fontSize:12,letterSpacing:4,color:t.textDim,marginBottom:8,fontFamily:warrior,fontWeight:700 }}>ELO DEĞİŞİMİ</div>
          <div style={{ display:"flex",alignItems:"center",gap:14,justifyContent:"center" }}>
            <span style={{ fontSize:22,fontWeight:700,color:t.textDim,fontFamily:warrior }}>{eloChange.myOld}</span>
            <span style={{ fontSize:22,color:t.accent }}>→</span>
            <span style={{ fontSize:28,fontWeight:800,color:myRank?.color||t.accent,fontFamily:warrior,textShadow:`0 0 12px ${myRank?.color||t.accent}44` }}>{eloChange.myNew}</span>
            <span style={{ fontSize:20,fontWeight:800,fontFamily:warrior,color:myEloDiff>=0?"#4ade80":t.hit,padding:"4px 12px",background:myEloDiff>=0?"rgba(74,222,128,0.1)":"rgba(255,71,87,0.1)",borderRadius:8 }}>{myEloDiff>=0?`+${myEloDiff}`:myEloDiff}</span>
          </div>
          {myRank && <div style={{ fontSize:13,fontWeight:800,color:myRank.color,marginTop:8,fontFamily:warrior,letterSpacing:3 }}>{myRank.icon} {myRank.title}</div>}
          {(entryFeeDeducted || (goldChange && goldChange.amount > 0)) && (
            <div style={{ marginTop:10,borderTop:`1px solid rgba(255,255,255,0.06)`,paddingTop:10 }}>
              {entryFeeDeducted && <div style={{ fontSize:12,fontWeight:700,color:t.hit,fontFamily:warrior,letterSpacing:2 }}>Giriş: -{entryFeeDeducted} 💰</div>}
              {goldChange && goldChange.amount > 0 && <div style={{ fontSize:16,color:t.gold,fontWeight:800,fontFamily:warrior,textShadow:`0 0 12px ${t.goldGlow}`,marginTop:4 }}>{isWin?"Kazanç":"Teselli"}: +{goldChange.amount} 💰</div>}
              {entryFeeDeducted && goldChange && <div style={{ fontSize:14,color:(goldChange.amount-entryFeeDeducted)>=0?"#4ade80":t.hit,fontWeight:800,fontFamily:warrior,marginTop:4 }}>Net: {(goldChange.amount-entryFeeDeducted)>=0?"+":""}{goldChange.amount-entryFeeDeducted} 💰</div>}
            </div>
          )}
        </div>
      </div>)}
    </>);
  }

  if (phase === "lobby") {
    const rank = myProfile ? getRankInfo(myProfile.elo) : null;
    const authLoading = !authReady || !authUid;
    const winRate = myProfile && myProfile.totalGames > 0 ? Math.round((myProfile.wins / myProfile.totalGames) * 100) : 0;
    return (<div style={{ ...appStyle, background:`linear-gradient(180deg, ${t.bg} 0%, #071428 50%, #0a1a35 100%)`,position:"relative",overflow:"hidden" }}><style>{ANIMS}</style>
      <div style={{ position:"absolute",top:0,left:0,right:0,height:200,opacity:0.04,overflow:"hidden",pointerEvents:"none" }}><div style={{ position:"absolute",bottom:0,left:"-50%",width:"200%",height:60,borderRadius:"50%",background:t.accent,animation:"wave 8s linear infinite" }} /><div style={{ position:"absolute",bottom:20,left:"-50%",width:"200%",height:40,borderRadius:"50%",background:t.accent,opacity:0.5,animation:"wave 12s linear infinite reverse" }} /></div>
      <div style={{ fontSize:38,fontWeight:800,letterSpacing:10,color:t.accent,textShadow:`0 0 50px ${t.accentGlow}, 0 0 100px rgba(0,229,255,0.15), 0 2px 10px rgba(0,0,0,0.5)`,marginBottom:2,fontFamily:warrior,animation:"fadeUp 0.4s ease-out",zIndex:1 }}>AMİRAL BATTI</div>
      <div style={{ fontSize:10,color:t.textDim,letterSpacing:8,marginBottom:12,fontFamily:warrior,zIndex:1 }}>DENİZ SAVAŞI</div>
      {onlineCount > 0 && <div style={{ display:'flex',alignItems:'center',gap:6,marginBottom:14,zIndex:1,animation:'fadeUp 0.5s ease-out' }}><div style={{ width:8,height:8,borderRadius:'50%',background:'#34d399',boxShadow:'0 0 8px rgba(52,211,153,0.6)',animation:'pulse 2s infinite' }} /><span style={{ fontSize:11,color:'#34d399',fontFamily:warrior,letterSpacing:2 }}>{onlineCount} KİŞİ OYNUYOR</span></div>}
      {authLoading && <div style={{ background:"rgba(239,68,68,0.12)",border:`1px solid ${t.hit}`,borderRadius:8,padding:"10px 16px",marginBottom:12,fontSize:11,color:t.hit,fontFamily:mono,textAlign:"center",width:"100%",maxWidth:340,animation:"pulse 1.5s infinite" }}>Sunucuya bağlanılıyor...</div>}
      {isTestMode() && <div style={{ background:"rgba(251,191,36,0.15)",border:`1px solid ${t.gold}`,borderRadius:8,padding:"8px 16px",marginBottom:12,fontSize:11,color:t.gold,fontFamily:warrior,letterSpacing:2,textAlign:"center",width:"100%",maxWidth:340 }}>🧪 TEST MODU — 2 tab aç, oda koduyla oyna</div>}
      {myProfile && (<div style={{ background:`linear-gradient(145deg, ${t.surface}, ${t.surfaceLight})`,border:`2px solid ${rank?.color||t.border}`,borderRadius:16,padding:"18px 22px",marginBottom:16,width:"100%",maxWidth:360,animation:"fadeUp 0.3s ease-out, rankGlow 3s ease-in-out infinite",boxShadow:`0 4px 20px rgba(0,0,0,0.4), 0 0 20px ${rank?.color?rank.color+"22":"transparent"}`,zIndex:1,'--rank-color':(rank?.color||t.accent)+"55" }}>
        <div style={{ display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:12 }}>
          <div>
            <div style={{ fontSize:20,fontWeight:800,color:t.text,fontFamily:warrior,letterSpacing:2 }}>{myProfile.displayName}</div>
            <div style={{ display:"flex",alignItems:"center",gap:6,marginTop:4 }}>
              <span style={{ fontSize:14,fontWeight:800,color:rank?.color||t.textDim,fontFamily:warrior,letterSpacing:2,textShadow:`0 0 10px ${rank?.color||t.textDim}44` }}>{rank?.icon} {rank?.title}</span>
              <span style={{ fontSize:12,fontWeight:700,color:t.gold,fontFamily:mono,background:"rgba(255,215,0,0.15)",padding:"3px 10px",borderRadius:10,border:"1px solid rgba(255,215,0,0.25)" }}>💰 {safeGold(myProfile.gold)}</span>
              {canChangeName() && <button onClick={()=>{setPhase("splash");}} style={{ fontSize:8,color:t.textDim,background:"transparent",border:`1px solid ${t.border}`,borderRadius:4,padding:"2px 6px",cursor:"pointer",fontFamily:mono }}>✏</button>}
            </div>
          </div>
          <div style={{ textAlign:"center",background:"rgba(0,212,255,0.08)",borderRadius:12,padding:"8px 14px" }}>
            <div style={{ fontSize:30,fontWeight:800,color:rank?.color||t.accent,fontFamily:warrior,lineHeight:1,textShadow:`0 0 15px ${rank?.color||t.accent}44` }}>{myProfile.elo}</div>
            <div style={{ fontSize:8,color:t.textDim,letterSpacing:3,marginTop:2,fontFamily:warrior,fontWeight:700 }}>ELO</div>
          </div>
        </div>
        <div style={{ display:"flex",gap:0,background:t.bg,borderRadius:10,overflow:"hidden" }}>
          <div style={{ flex:1,textAlign:"center",padding:"8px 0",borderRight:`1px solid ${t.border}` }}><div style={{ fontSize:18,fontWeight:800,color:"#34d399",fontFamily:mono }}>{myProfile.wins||0}</div><div style={{ fontSize:8,color:t.textDim,letterSpacing:2,fontFamily:warrior,fontWeight:700 }}>GALİBİYET</div></div>
          <div style={{ flex:1,textAlign:"center",padding:"8px 0",borderRight:`1px solid ${t.border}` }}><div style={{ fontSize:18,fontWeight:800,color:t.hit,fontFamily:mono }}>{myProfile.losses||0}</div><div style={{ fontSize:8,color:t.textDim,letterSpacing:2,fontFamily:warrior,fontWeight:700 }}>MAĞLUBİYET</div></div>
          <div style={{ flex:1,textAlign:"center",padding:"8px 0" }}><div style={{ fontSize:18,fontWeight:800,color:t.accent,fontFamily:mono }}>%{winRate}</div><div style={{ fontSize:8,color:t.textDim,letterSpacing:2,fontFamily:warrior,fontWeight:700 }}>ORAN</div></div>
        </div>
      </div>)}
      {/* Main action buttons */}
      <RippleButton onClick={()=>startQuickMatch(null)} disabled={matchmaking||authLoading} style={{ width:"100%",maxWidth:360,padding:"16px 0",background:matchmaking?t.surfaceLight:`linear-gradient(135deg, ${t.accent}, #0088cc)`,color:matchmaking?t.textDim:t.bg,border:"none",borderRadius:12,fontSize:16,fontWeight:700,letterSpacing:3,cursor:(matchmaking||authLoading)?"not-allowed":"pointer",fontFamily:warrior,textTransform:"uppercase",boxShadow:matchmaking?"none":`0 0 20px ${t.accentGlow}`,opacity:authLoading?0.4:1,animation:"fadeUp 0.5s ease-out",zIndex:1 }}>{matchmaking?"EŞLEŞTİRİLİYOR...":"⚡ OYNA"}</RippleButton>
      {matchmaking && <button onClick={async()=>{if(matchCancelFn)await matchCancelFn();setMatchmaking(false);setMatchCancelFn(null);}} style={{ marginTop:6,padding:"8px 20px",background:"transparent",color:t.hit,border:`1px solid ${t.hit}`,borderRadius:6,fontSize:10,fontWeight:700,letterSpacing:1,cursor:"pointer",fontFamily:warrior,zIndex:1 }}>İPTAL</button>}
      <div style={{ display:"flex",gap:8,marginTop:10,width:"100%",maxWidth:360,animation:"fadeUp 0.6s ease-out",zIndex:1 }}>
        <RippleButton onClick={()=>{if(!authUid){setMessage("Bağlantı bekleniyor...");return;}setShowOnlineLobby(true);}} disabled={authLoading} style={{ flex:1,padding:"13px 0",background:`linear-gradient(135deg,rgba(0,212,255,0.1),rgba(0,212,255,0.03))`,color:t.accent,border:`1px solid rgba(0,212,255,0.3)`,borderRadius:10,fontSize:13,fontWeight:700,letterSpacing:2,cursor:authLoading?"not-allowed":"pointer",fontFamily:warrior,textTransform:"uppercase",opacity:authLoading?0.4:1 }}>🌐 SALON</RippleButton>
        <RippleButton onClick={()=>{if(!authUid){setMessage("Bağlantı bekleniyor...");return;}setShowArenaSelect(true);}} disabled={authLoading} style={{ flex:1,padding:"13px 0",background:`linear-gradient(135deg,rgba(167,139,250,0.1),rgba(167,139,250,0.03))`,color:"#a78bfa",border:"1px solid rgba(167,139,250,0.3)",borderRadius:10,fontSize:13,fontWeight:700,letterSpacing:2,cursor:authLoading?"not-allowed":"pointer",fontFamily:warrior,textTransform:"uppercase",opacity:authLoading?0.4:1 }}>⚔ ARENA</RippleButton>
      </div>
      <div style={{ display:"flex",gap:8,marginTop:8,width:"100%",maxWidth:360,animation:"fadeUp 0.7s ease-out",zIndex:1 }}>
        <RippleButton onClick={startBotGame} style={{ flex:1,padding:"13px 0",background:`linear-gradient(135deg,rgba(52,211,153,0.1),rgba(52,211,153,0.03))`,color:"#34d399",border:"1px solid rgba(52,211,153,0.3)",borderRadius:10,fontSize:13,fontWeight:700,letterSpacing:2,cursor:"pointer",fontFamily:warrior,textTransform:"uppercase" }}>🤖 BOT</RippleButton>
        <RippleButton onClick={()=>setShowLeaderboard(true)} style={{ flex:1,padding:"13px 0",background:`linear-gradient(135deg,rgba(255,215,0,0.08),rgba(255,215,0,0.02))`,color:t.gold,border:`1px solid rgba(255,215,0,0.3)`,borderRadius:10,fontSize:13,fontWeight:700,letterSpacing:2,cursor:"pointer",fontFamily:warrior,textTransform:"uppercase" }}>🏆 SIRALAMA</RippleButton>
      </div>
      {/* Room code - collapsible */}
      <div style={{ marginTop:10,width:"100%",maxWidth:360,zIndex:1 }}>
        <details style={{ background:t.surface,border:`1px solid ${t.border}`,borderRadius:10,overflow:"hidden" }}>
          <summary style={{ padding:"12px 16px",cursor:"pointer",fontSize:12,color:t.textDim,fontFamily:warrior,letterSpacing:2,listStyle:"none",display:"flex",alignItems:"center",gap:8 }}>
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
        {/* Mobile-friendly rotate and undo buttons - large touch targets */}
        <div style={{ display:"flex",gap:10,marginBottom:10,width:"100%",maxWidth:400,justifyContent:"center" }}>
          {selectedShip && <button onClick={() => setRotation((rotation + 1) % 4)} style={{ flex:1,maxWidth:180,padding:"14px 0",background:"linear-gradient(135deg, rgba(0,229,255,0.12), rgba(0,229,255,0.04))",color:t.accent,border:`2px solid rgba(0,229,255,0.3)`,borderRadius:12,fontSize:20,fontWeight:800,cursor:"pointer",fontFamily:warrior,letterSpacing:2,display:"flex",alignItems:"center",justifyContent:"center",gap:8 }}>
            <span style={{ fontSize:24,display:"inline-block",transform:`rotate(${rotation*90}deg)`,transition:"transform 0.3s ease" }}>↻</span> DÖNDÜR
          </button>}
          {placedShips.length > 0 && <button onClick={undoLastShip} style={{ flex:1,maxWidth:180,padding:"14px 0",background:"rgba(255,71,87,0.08)",color:t.hit,border:`2px solid rgba(255,71,87,0.3)`,borderRadius:12,fontSize:14,fontWeight:800,cursor:"pointer",fontFamily:warrior,letterSpacing:2 }}>↩ GERİ AL</button>}
        </div>
        {selectedShip && <div style={{ fontSize:10,color:t.textDim,fontFamily:mono,marginBottom:6,textAlign:"center" }}>Haritaya dokun yerleştir • Döndür butonuna veya tekrar dokun</div>}
      </>)}
      {allPlaced && !placementConfirmed && <button style={{ ...btnStyle,marginBottom:12,animation:"borderGlow 1.5s infinite",padding:"14px 36px",fontSize:16,fontWeight:800,letterSpacing:4,borderRadius:12 }} onClick={confirmPlacement}>✓ GEMİLERİ ONAYLA</button>}
      {placementConfirmed && <div style={{ background:"linear-gradient(145deg, rgba(12,21,41,0.9), rgba(8,14,30,0.95))",border:`2px solid rgba(0,229,255,0.2)`,borderRadius:12,padding:"16px 24px",marginBottom:8,fontSize:14,fontWeight:700,color:t.accent,textAlign:"center",fontFamily:warrior,letterSpacing:2 }}>Gemilerin hazır! Rakip bekleniyor...<div style={{ marginTop:10 }}><div style={{ width:14,height:14,borderRadius:"50%",background:t.accent,margin:"0 auto",animation:"pulse 1.5s infinite" }} /></div></div>}
      <div onMouseLeave={() => setHoverCells([])}><Grid board={defenseBoard} cellSize={cellSize} isDefense shipColors={shipColorMap} overlay={defenseOverlay} hoverCells={hoverCells} onClick={handleDefenseClick} onHover={handleDefenseHover} disabled={placementConfirmed} /></div>
    </div>);
  }

  if (phase === "playing") {
    const myLow = myClock <= 30, oppLow = oppClock <= 30, isAttack = activeBoard === "attack";
    return (<div style={{ ...appStyle, paddingBottom: 74 }}><style>{ANIMS}</style>
      <div style={{ display:"flex",gap:8,alignItems:"stretch",marginBottom:6,width:"100%",maxWidth:400,justifyContent:"center" }}>
        <div style={{ flex:1,padding:"4px 10px",borderRadius:6,background:myTurn?(myLow?"rgba(239,68,68,0.15)":"rgba(6,182,212,0.12)"):t.surfaceLight,border:`1px solid ${myTurn?(myLow?t.hit:t.accent):t.border}`,textAlign:"center" }}>
          <div style={{ fontSize:13,fontWeight:700,fontFamily:warrior,color:myTurn?(myLow?t.hit:t.accent):t.textDim,letterSpacing:1 }}>{playerName}: {formatTime(myClock)}</div>
          <EmojiDisplay emoji={myEmojiToast?.emoji} label={myEmojiToast?.label} />
        </div>
        <div style={{ flex:1,padding:"4px 10px",borderRadius:6,background:!myTurn?(oppLow?"rgba(239,68,68,0.15)":"rgba(6,182,212,0.12)"):t.surfaceLight,border:`1px solid ${!myTurn?(oppLow?t.hit:t.accent):t.border}`,textAlign:"center" }}>
          <div style={{ fontSize:13,fontWeight:700,fontFamily:warrior,color:!myTurn?(oppLow?t.hit:t.accent):t.textDim,letterSpacing:1 }}>{opponentName}: {formatTime(oppClock)}</div>
          <EmojiDisplay emoji={emojiToast?.emoji} label={emojiToast?.label} />
        </div>
      </div>
      <div style={{ fontSize:18,fontWeight:800,marginBottom:6,textAlign:"center",fontFamily:warrior,letterSpacing:4,textTransform:"uppercase",color:myTurn?t.accent:t.textDim,textShadow:myTurn?`0 0 25px ${t.accentGlow}`:"none",animation:myTurn?"fadeUp 0.3s ease-out":"none" }}>{myTurn?"⚡ SENİN SIRAN ⚡":(isBotGame?"🤖 Bot düşünüyor...":"Rakibin sırası...")}</div>
      <div style={{ fontSize:12,color:t.text,marginBottom:6,fontFamily:mono,fontWeight:700 }}>İsabet: <span style={{ color:t.accent }}>{myHits}/20</span> • Karavana: <span style={{ color:t.hit }}>{oppHits}/20</span></div>
      {streakToast && <div style={{ background:"rgba(251,191,36,0.15)",border:`1px solid ${t.gold}`,borderRadius:8,padding:"6px 14px",marginBottom:6,fontSize:14,color:t.gold,fontWeight:700,textAlign:"center",width:"100%",maxWidth:400,animation:"popIn 0.3s ease-out",fontFamily:warrior,letterSpacing:2 }}>🔥 {streakToast.streak} İSABET SERİSİ — x{streakToast.mult} ÇARPAN</div>}
      {hitStreak > 0 && !streakToast && <div style={{ fontSize:10,color:t.gold,marginBottom:4,fontFamily:warrior,letterSpacing:1,textAlign:"center" }}>🔥 Seri: {hitStreak}</div>}
      {damageReport && <div style={{ background:"rgba(239,68,68,0.1)",border:`1px solid ${t.hit}`,borderRadius:8,padding:"6px 14px",marginBottom:6,fontSize:11,color:t.hit,fontWeight:700,textAlign:"center",width:"100%",maxWidth:400,animation:"slideIn 0.3s ease-out",fontFamily:warrior,letterSpacing:1 }}>⚠ {damageReport}</div>}
      <div style={{ display:"flex",gap:0,marginBottom:6,width:"100%",maxWidth:400 }}>
        <button onClick={()=>{setActiveBoard("attack");setMarkMode(false);}} style={{ flex:1,padding:"12px 0",fontSize:15,fontWeight:800,fontFamily:warrior,cursor:"pointer",background:isAttack?`linear-gradient(135deg,${t.accent},#0891b2)`:t.surfaceLight,color:isAttack?t.bg:t.textDim,border:`2px solid ${isAttack?t.accent:t.border}`,borderRadius:"10px 0 0 10px",letterSpacing:4,animation:myTurn&&isAttack?"borderGlow 2s infinite":"none" }}>⚔ SALDIRI</button>
        <button onClick={()=>{setActiveBoard("defense");setMarkMode(false);}} style={{ flex:1,padding:"12px 0",fontSize:15,fontWeight:800,fontFamily:warrior,cursor:"pointer",background:!isAttack?`linear-gradient(135deg,${t.accent},#0891b2)`:t.surfaceLight,color:!isAttack?t.bg:t.textDim,border:`2px solid ${!isAttack?t.accent:t.border}`,borderRadius:"0 10px 10px 0",letterSpacing:4 }}>🛡 SAVUNMA</button>
      </div>
      {isAttack && <button onClick={()=>setMarkMode(!markMode)} style={{ marginBottom:6,padding:"6px 16px",fontSize:10,fontWeight:700,fontFamily:warrior,background:markMode?t.gold:"transparent",color:markMode?t.bg:t.gold,border:`1px solid ${t.gold}`,borderRadius:6,cursor:"pointer",letterSpacing:2 }}>{markMode?"⚑ İŞARETLEME MODU: AÇIK":"⚑ İŞARETLE"}</button>}
      <div style={{ width:"100%",maxWidth:400,border:myTurn&&isAttack?`2px solid ${t.accent}`:"1px solid transparent",borderRadius:12,padding:2,animation:myTurn&&isAttack?"borderGlow 2s infinite":"none" }}>
        {isAttack?<><Grid board={emptyGrid()} cellSize={cellSize} overlay={getAttackDisplayOverlay()} onClick={handleAttackClick} onRightClick={handleAttackRightClick} onLongPress={handleAttackLongPress} disabled={!myTurn} manualMarks={manualMarks} blinkCells={blinkCells} /><ShipStatusPanel title="RAKİP GEMİLER" ships={oppShipsData} hitCells={atkHitMap} color={t.hit} /></>:<><Grid board={defenseBoard} cellSize={cellSize} isDefense shipColors={shipColorMap} overlay={defenseOverlay} disabled blinkCells={blinkCells} /><ShipStatusPanel title="GEMİLERİM" ships={myShipsData} hitCells={defHitMap} color={t.accent} /></>}
      </div>
      {isTestMode() && <button onClick={forceEndGame} style={{ marginTop:8,padding:"8px 16px",background:"rgba(251,191,36,0.2)",color:t.gold,border:`1px solid ${t.gold}`,borderRadius:6,fontSize:10,fontWeight:700,letterSpacing:1,cursor:"pointer",fontFamily:warrior }}>🧪 OYUNU BİTİR (TEST)</button>}
      {myTurn && isAttack && !markMode && (<div style={{ position:"fixed",bottom:0,left:0,right:0,background:"rgba(10,14,23,0.96)",backdropFilter:"blur(10px)",borderTop:`1px solid ${t.border}`,padding:"10px 16px",display:"flex",alignItems:"center",justifyContent:"center",gap:14,zIndex:100 }}>
        <div style={{ display:"flex",gap:5 }}>{[0,1,2].map(i=><div key={i} style={{ width:14,height:14,borderRadius:"50%",background:i<currentShots.length?t.hit:t.accent,opacity:i<currentShots.length?0.3:1,animation:i<currentShots.length?"popIn 0.3s ease-out":"none" }} />)}</div>
        <RippleButton onClick={fireShots} disabled={currentShots.length===0} style={{ padding:"12px 36px",background:currentShots.length>0?`linear-gradient(135deg,${t.hit},#dc2626)`:t.surfaceLight,color:currentShots.length>0?"#fff":t.textDim,border:"none",borderRadius:10,fontSize:16,fontWeight:700,letterSpacing:3,cursor:currentShots.length===0?"default":"pointer",fontFamily:warrior,boxShadow:currentShots.length>0?`0 0 24px ${t.hitGlow}`:"none",opacity:currentShots.length===0?0.5:1 }}>ATEŞ 🔥</RippleButton>
      </div>)}
      {!isBotGame && <div style={{ position:"fixed",bottom:myTurn&&activeBoard==="attack"&&!markMode?64:0,left:0,right:0,display:"flex",justifyContent:"center",gap:2,background:"rgba(10,14,23,0.92)",backdropFilter:"blur(8px)",borderTop:`1px solid ${t.border}`,padding:"6px 4px",zIndex:90 }}>
        {QUICK_EMOJIS.map(qe=><button key={qe.id} onClick={()=>sendEmoji(qe)} style={{ padding:"4px 6px",background:"transparent",border:"none",fontSize:18,cursor:"pointer",borderRadius:6,transition:"transform 0.1s" }} title={qe.label}>{qe.emoji}</button>)}
      </div>}
      <canvas id="confetti-canvas" style={{ position:'fixed',inset:0,pointerEvents:'none',zIndex:10002 }} />
      {microFeedback && <MicroFeedback text={microFeedback.text} color={microFeedback.color} onDone={()=>setMicroFeedback(null)} />}
      {goldAnim && <GoldCoinAnim amount={goldAnim.amount} onDone={()=>setGoldAnim(null)} />}
    </div>);
  }

  return null;
}
