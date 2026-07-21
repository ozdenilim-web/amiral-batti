"use client";
import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { db, auth, googleProvider, ref, set, get, onValue, update, remove, onDisconnect, runTransaction, query, orderByChild, limitToLast, signInAnonymously, onAuthStateChanged, signInWithPopup, signOut, track, identify, EmailAuthProvider, linkWithCredential, signInWithEmailAndPassword } from "../lib/firebase";

const ROWS = 11;
const COLS = 11;
const COL_LABELS = ["A","B","C","D","E","F","G","H","I","J","K"];
const SHOTS_PER_TURN = 3;
const CLOCK_SECONDS = 300;
const PLACEMENT_SECONDS = 60;

const SHIPS = [
  { id: "amiral", name: "Amiral", nameEn: "Admiral", shape: [[0,0],[0,1],[0,2],[1,1]], size: 4, color: "#e74c3c" },
  { id: "uclu1", name: "Üçlü-1", nameEn: "Triple-1", shape: [[0,0],[0,1],[0,2]], size: 3, color: "#3498db" },
  { id: "uclu2", name: "Üçlü-2", nameEn: "Triple-2", shape: [[0,0],[0,1],[0,2]], size: 3, color: "#2980b9" },
  { id: "ikili1", name: "İkili-1", nameEn: "Double-1", shape: [[0,0],[0,1]], size: 2, color: "#2ecc71" },
  { id: "ikili2", name: "İkili-2", nameEn: "Double-2", shape: [[0,0],[0,1]], size: 2, color: "#27ae60" },
  { id: "ikili3", name: "İkili-3", nameEn: "Double-3", shape: [[0,0],[0,1]], size: 2, color: "#1abc9c" },
  { id: "tekli1", name: "Tekli-1", nameEn: "Single-1", shape: [[0,0]], size: 1, color: "#f39c12" },
  { id: "tekli2", name: "Tekli-2", nameEn: "Single-2", shape: [[0,0]], size: 1, color: "#f39c12" },
  { id: "tekli3", name: "Tekli-3", nameEn: "Single-3", shape: [[0,0]], size: 1, color: "#f39c12" },
  { id: "tekli4", name: "Tekli-4", nameEn: "Single-4", shape: [[0,0]], size: 1, color: "#f39c12" },
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

// === GÜNLÜK SANDIK (cihaz bazlı) ===
const DAILY_CHEST_KEY = "ab_daily_chest_date";
const DAILY_CHEST_GOLD = 300; // pasif kazanç aktif oyunu geçmesin diye 500→300
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
const FB_HIT1_EN = ["HIT! 🎯"];
const FB_HIT2_EN = ["DOUBLE HIT! 🎯🎯"];
const FB_HIT3_EN = ["TRIPLE HIT! 🎯🎯🎯"];
const FB_MISS_EN = ["MISS", "NO HIT!"];
const FB_SUNK_EN = ["SHIP SUNK! 💀"];
const FB_GOT_HIT_EN = ["YOU'VE BEEN HIT! 🚨"];
const fbPick = (arr) => arr[Math.floor(Math.random() * arr.length)];

// === GÖREV SİSTEMİ ===
const ALL_MISSIONS = [
  // ── KOLAY (anında dopamin) ──
  { id: "play1",    text: "1 oyun oyna",               textEn: "Play 1 game",                icon: "⚓", check: s => s.gamesPlayed >= 1 },
  { id: "hit5",     text: "5 isabet yap",               textEn: "Land 5 hits",                icon: "🎯", check: s => s.totalHits >= 5 },
  { id: "sink1",    text: "1 gemi batır",               textEn: "Sink 1 ship",                icon: "🚢", check: s => s.shipsSunk >= 1 },
  { id: "win1",     text: "1 oyun kazan",               textEn: "Win 1 game",                 icon: "🏆", check: s => s.wins >= 1 },
  { id: "noMiss1",  text: "Bir turda karavana yeme",    textEn: "No miss in a turn",           icon: "🛡", check: s => s.perfectTurn },
  { id: "botWin",   text: "Bot'u yen",                  textEn: "Beat the bot",                icon: "🤖", check: s => s.botWin },
  { id: "mark3",    text: "3 kare işaretle",            textEn: "Mark 3 cells",                icon: "⚑",  check: s => s.markedCells >= 3 },
  { id: "hit3turn", text: "Tek turda 3 isabet yap",     textEn: "Land 3 hits in one turn",     icon: "💥", check: s => s.perfectTurn3 },

  // ── ORTA (biraz çaba) ──
  { id: "play3",    text: "3 oyun oyna",                textEn: "Play 3 games",                icon: "🌊", check: s => s.gamesPlayed >= 3 },
  { id: "hit10",    text: "10 isabet yap",              textEn: "Land 10 hits",                icon: "🔥", check: s => s.totalHits >= 10 },
  { id: "sink3",    text: "3 gemi batır",               textEn: "Sink 3 ships",                icon: "💣", check: s => s.shipsSunk >= 3 },
  { id: "win2",     text: "2 oyun kazan",               textEn: "Win 2 games",                 icon: "⭐", check: s => s.wins >= 2 },
  { id: "fast5",    text: "5 dakikada kazan",           textEn: "Win in 5 minutes",             icon: "⚡", check: s => s.fastWin5 },
  { id: "noMiss3",  text: "3 turda arka arkaya isabet", textEn: "Hit 3 turns in a row",         icon: "🎖", check: s => s.streakHits >= 3 },
  { id: "play5",    text: "5 oyun oyna",                textEn: "Play 5 games",                 icon: "⚓",  check: s => s.gamesPlayed >= 5 },
  { id: "hit20",    text: "20 isabet yap",              textEn: "Land 20 hits",                 icon: "🎯", check: s => s.totalHits >= 20 },
  { id: "sink5",    text: "5 gemi batır",               textEn: "Sink 5 ships",                 icon: "🔱", check: s => s.shipsSunk >= 5 },
  { id: "win3",     text: "3 oyun kazan",               textEn: "Win 3 games",                  icon: "👑", check: s => s.wins >= 3 },

  // ── ZOR (tatmin büyük) ──
  { id: "fast3",    text: "3 dakikada kazan",           textEn: "Win in 3 minutes",             icon: "🚀", check: s => s.fastWin },
  { id: "noMiss5",  text: "5 turda karavana yeme",      textEn: "No miss for 5 turns",          icon: "🏅", check: s => s.perfectTurns >= 5 },
  { id: "sink8",    text: "8 gemi batır",               textEn: "Sink 8 ships",                 icon: "💀", check: s => s.shipsSunk >= 8 },
  { id: "hit30",    text: "30 isabet yap",              textEn: "Land 30 hits",                 icon: "🌟", check: s => s.totalHits >= 30 },
  { id: "win5",     text: "5 oyun kazan",               textEn: "Win 5 games",                  icon: "🥇", check: s => s.wins >= 5 },
  { id: "play10",   text: "10 oyun oyna",               textEn: "Play 10 games",                icon: "🎖", check: s => s.gamesPlayed >= 10 },
  { id: "streak5",  text: "5 isabet serisi yap",        textEn: "Land a 5-hit streak",          icon: "🔥", check: s => s.streakHits >= 5 },
  { id: "sink10",   text: "10 gemi batır",              textEn: "Sink 10 ships",                icon: "⚓", check: s => s.shipsSunk >= 10 },

  // ── EFSANE (nadir, çok tatmin edici) ──
  { id: "win10",    text: "10 oyun kazan",              textEn: "Win 10 games",                 icon: "🏆", check: s => s.wins >= 10 },
  { id: "hit50",    text: "50 isabet yap",              textEn: "Land 50 hits",                 icon: "💫", check: s => s.totalHits >= 50 },
  { id: "fast2",    text: "2 dakikada kazan",           textEn: "Win in 2 minutes",              icon: "⚡", check: s => s.ultraFastWin },
  { id: "perfect",  text: "Hiç karavana vermeden kazan",textEn: "Win without a single miss",     icon: "👁",  check: s => s.perfectGame },
];

// === GÜNLÜK GÖREV İSTATİSTİKLERİ ===
// Kritik: bunlar profile yazılır. Eskiden yalnızca bellekte tutuluyordu, uygulama
// kapanınca sıfırlanıyordu; ayrıca ONLINE maçlar hiç işlenmiyor ve görevlerin
// ihtiyaç duyduğu 7 alan (markedCells, streakHits, perfectGame...) hiç yazılmıyordu.
const DAILY_DEFAULT = {
  gamesPlayed: 0, wins: 0, totalHits: 0, shipsSunk: 0, markedCells: 0, streakHits: 0, perfectTurns: 0,
  perfectTurn: false, perfectTurn3: false, botWin: false, fastWin: false, fastWin5: false,
  ultraFastWin: false, perfectGame: false, chestClaimed: false,
};
function safeDaily(d) {
  const today = todayKey();
  const o = { ...DAILY_DEFAULT, dayKey: today };
  if (!d || typeof d !== "object" || d.dayKey !== today) return o; // yeni gün → sıfırla
  for (const k in DAILY_DEFAULT) {
    const v = d[k];
    if (typeof DAILY_DEFAULT[k] === "number") { if (typeof v === "number" && isFinite(v) && v >= 0) o[k] = v; }
    else if (v === true) o[k] = true;
  }
  return o;
}

function pickDailyMissions(seed) {
  // Günlük seed ile her gün aynı 3 görev — GARANTİ: 1 kolay + 1 orta + 1 zor/efsane
  const day = Math.floor(seed / 86400000);
  let rng = day * 2654435761;
  const next = (n) => { rng = (rng * 1664525 + 1013904223) & 0x7fffffff; return rng % n; };
  const easy = ALL_MISSIONS.slice(0, 8), mid = ALL_MISSIONS.slice(8, 18), hard = ALL_MISSIONS.slice(18);
  return [easy[next(easy.length)], mid[next(mid.length)], hard[next(hard.length)]];
}

function generateChestReward(lang = "tr") {
  // Belirsiz ödül — dopaminerjik tahmin hatası
  const en = lang === "en";
  const roll = Math.random();
  if (roll < 0.05) return { gold: 500, label: en?"LEGENDARY":"EFSANE", color: "#fbbf24", icon: "👑" };
  if (roll < 0.20) return { gold: 200, label: en?"RARE":"NADİR", color: "#a78bfa", icon: "💎" };
  if (roll < 0.50) return { gold: 100, label: en?"GOOD":"İYİ", color: "#06b6d4", icon: "🎁" };
  return { gold: 50, label: en?"COMMON":"NORMAL", color: "#34d399", icon: "📦" };
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
  water: "rgba(0,229,255,0.16)", shipCell: "rgba(0,229,255,0.28)",
  gold: "#ffd700", goldGlow: "rgba(255,215,0,0.45)",
};
const warrior = "var(--font-warrior), 'Barlow Condensed', sans-serif";
const mono = "var(--font-mono), 'Space Mono', monospace";

// Ask the browser/WebView for immersive fullscreen (hides Android system nav bar in the TWA).
// Must be called from within a user-gesture handler; safe no-op everywhere else (desktop, iOS Safari, etc).
function requestImmersive() {
  try {
    const el = document.documentElement;
    if (el.requestFullscreen) el.requestFullscreen().catch(() => {});
    else if (el.webkitRequestFullscreen) el.webkitRequestFullscreen();
  } catch (e) {}
}

// === LOKALİZASYON ===
const TRANSLATIONS = {
  tr: {
    welcome: "HOŞ GELDİN!", chooseName: "Denizci adını seç", namePlaceholder: "Kullanıcı adın", nameHint: "2-16 karakter • 14 gün boyunca değiştirilemez", confirm: "ONAYLA",
    play: "OYNA", salon: "SALON", arena: "ARENA", bot: "BOT", leaderboard: "SIRALAMA",
    roomCodeToggle: "ODA KODU İLE OYNA", roomCodePlaceholder: "Oda Kodu", join: "KATIL", createRoom: "+ YENİ ODA OLUŞTUR",
    level: "SEVİYE", wins: "GALİBİYET", losses: "MAĞLUBİYET", winRate: "ORAN", editName: "İsmi değiştir",
    attack: "SALDIRI", defense: "SAVUNMA", fire: "ATEŞ", leaveGame: "OYUNDAN AYRIL", markMode: "İŞARETLE", markModeOn: "İŞARETLEME MODU: AÇIK", hits: "İsabet",
    leaveConfirmTitle: "AYRILMAK İSTİYOR MUSUN?", leaveConfirmBotBody: "Eğitim savaşından çıkacaksın.", leaveConfirmBody: "Ayrılırsan maçı kaybedersin!", stay: "KALIYORUM", exit: "ÇIKIŞ",
    settingsTitle: "AYARLAR", profile: "Profil", musicLevel: "Müzik Seviyesi", sfx: "Ses Efektleri", sfxSub: "Vuruş, isabet, seri vuruş sesleri",
    notifications: "Bildirimler", notificationsSub: "Günlük ödül ve enerji hatırlatmaları", language: "Dil", privacy: "Gizlilik Politikası & Kullanım Koşulları",
    support: "Destek / İletişim", deleteAccount: "Hesabımı / Verilerimi Sil", close: "KAPAT", back: "Profil",
    totalGames: "TOPLAM OYUN", winRateLabel: "KAZANMA ORANI", botGamesLabel: "BOT MAÇI", onlineGamesLabel: "ONLINE MAÇI", joined: "Katılım",
    statBreakdown: "MAÇ DAĞILIMI", statBot: "🤖 BOT", statOnline: "🌐 ONLINE", statW: "G", statL: "M",
    statAccuracy: "ATIŞ TUTTURMA", statShots: "atış", statHits: "isabet", statSunk: "BATIRILAN GEMİ", statHonor: "ŞEREF",
    deleteWarning: "Bu işlem geri alınamaz. Hesabın silindiğinde tüm oyun verilerin (altın, seviye, istatistikler, profil) kalıcı olarak kaldırılır ve kurtarılamaz.",
    deleteConfirmBtn: "EVET, HESABIMI VE VERİLERİMİ SİL", cancel: "Vazgeç", deleting: "Siliniyor...",
    quickSearching: "🔍 RAKİP ARANIYOR", quickFound: "🎉 RAKİP BULUNDU!", quickNotFound: "😕 RAKİP BULUNAMADI", quickInviting: "📨 TEKLİF GÖNDERİLDİ",
    quickScanning: "Salon taranıyor...", quickStarting: "Düello başlıyor, gemilerini yerleştir!", quickNoOpp: "Salonda uygun rakip yok — tekrar dene",
    quickWaitingReply: "hazır — yanıtı bekleniyor...", retrySearch: "🔄 YENİDEN ARA", giveUp: "VAZGEÇ", cancelBtn: "İPTAL", you: "SEN", opponent: "RAKİP", ready: "HAZIR ⚡",
    onlineSalon: "ONLINE SALON", activeSailors: "AKTİF DENİZCİLER", readyToPlay: "OYUNA HAZIRIM", readyHint: "Biri hızlı oyun aradığında seni direkt yakalayabilir",
    duelInvite: "DÜELLO DAVETİ", inviteWaiting: "yanıt bekliyor...", accept: "KABUL", reject: "REDDET", inviteSent: "DAVETİN GÖNDERİLDİ", noSailors: "Şu an salonda kimse yok",
    noSailorsHint: "Hızlı Oyun ile otomatik eşleşebilirsin", sailorsActive: "DENİZCİ AKTİF", duel: "⚓ DÜELLO", waitingBadge: "BEKLENİYOR", backBtn: "GERİ DÖN",
    victory: "ZAFER", defeat: "BOZGUN", newBattle: "YENİ SAVAŞ", chestProgress: "SANDIK İLERLEMESİ",
    missLabel: "KARAVANA", goldLabel: "ALTIN", levelLabel: "SEVİYE", battleMap: "SAVAŞ HARİTASI", homeBtn: "ANA SAYFA",
    oppField: "RAKİP SAHA", myField: "BENİM SAHAM", oppShips: "RAKİP GEMİLER", myShips: "GEMİLERİM",
    missionsTitle: "GÖREVLER", missionsSub: "HER GÜN YENİLENİR", missionDone: "TAMAMLANDI", missionInProgress: "DEVAM EDİYOR",
    msgConnError: "Bağlantı hatası — tekrar dene", msgLoginFailed: "Giriş başarısız: ", msgPopupClosed: "Pencere kapatıldı",
    msgMinChars: "En az 2 karakter!", msgMaxChars: "En fazla 16 karakter!", msgBadName: "Bu isim uygun değil!", msgNameTaken: "Bu isim zaten alınmış!",
    msgNameCooldown: (n) => `İsim ${n} gün sonra değiştirilebilir!`, msgTypeName: "Adını yaz!", msgConnecting: "Bağlantı bekleniyor...",
    msgNotEnoughGold: "Yeterli altının yok!", msgTypeNameAndRoom: "Adını ve oda kodunu yaz!", msgRoomNotFound: "Oda bulunamadı!", msgRoomFull: "Oda dolu!",
    msgArenaGoldNeeded: (n) => `Bu arena için ${n} 💰 gerekli!`,
    trainingBattle: "EĞİTİM SAVAŞI", oppNotPlaying: "Rakip oynamıyor", hitStreak: "İSABET SERİSİ", multiplier: "ÇARPAN",
    leaderboardTitle: "SIRALAMA", motivTop1: "👑 Denizlerin hakimisin!", motivTop3: "🔥 Zirveye çok yakınsın!", motivTop10: "⚡ TOP 10'dasın, devam et!", motivDefault: "⚓ Sıralamaya girmek için savaş!",
    tabGold: "ALTIN", tabWins: "GALİBİYET", loadingText: "Yükleniyor...", noPlayersYet: "Henüz oyuncu yok",
    congratsSailor: "TEBRİKLER, DENİZCİ!", firstReward: "İLK ÖDÜLÜN", readyForBattle: "SAVAŞA HAZIRIM",
    dailyLoginReward: "GÜNLÜK GİRİŞ ÖDÜLÜ", dayStreak: "GÜN SERİ", collectBtn: "TOPLA",
    arenaSelectTitle: "ARENA SEÇ", goldRequired: (n) => `🔒 ${n} ALTIN GEREKLİ`, minGoldLabel: (n) => `Min: ${n} 💰`, entryLabel: "GİRİŞ", sevLabel: "SEV",
    chestReadyMsg: "SANDIK HAZIR!", collectRewardMsg: "Ödülünü topla", mysteryChest: "GİZEMLİ SANDIK", completedMissionsMsg: "3 görevi tamamladın!", openChestBtn: "SANDIĞI AÇ",
    dailyChestTooltip: "Günlük Sandık", rewardRare: "NADİR", rewardGood: "İYİ",
    achTitle: "KAZANIMLAR", achClaim: "ÖDÜLÜ AL", achClaimed: "ALINDI", achLocked: "KİLİTLİ", achSoon: "YAKINDA", achSetReward: "SET ÖDÜLÜ", achUnlockReq: "Açılma şartları", achPrevSet: "Önceki set tamamlanmalı", achBtn: "KAZANIMLAR", achAvatarReward: "ÖZEL AVATAR",
    revengeActive: (m) => `İNTİKAM MODU — SONRAKİ ZAFERDE ÖDÜLLER ×${m}`, revengeTaken: (m) => `İNTİKAM ALINDI! ÖDÜLLER ×${m}`, revengeSub: "Denizin öfkesi seninle",
    voyageTitle: "GEMİN SEFERDEN DÖNDÜ!", voyageBody: (h) => `${h} saatlik seferden ganimetle döndü`, voyageCollect: "GANİMETİ TOPLA", voyageHint: "Bugün ne kadar çok savaşırsan, gemin o kadar uzun sefere çıkar",
    sailTitle: "DEMİR ALDIK!", sailBody: "Sen uyurken bile gemin denizde: ganimeti senin için topluyor.", sailBody2: "Bugün ne kadar çok savaşırsan, o kadar uzun sefere çıkar!", sailOk: "RÜZGÂR ARKANDAN ⚓",
    rewardTitleWin: "GANİMET RAPORU", rewardTitleLoss: "SAVAŞ RAPORU", rewardGold: "ALTIN", rewardHonor: "ŞEREF", rewardXp: "TECRÜBE", rewardMissionsRow: "GÜNLÜK GÖREVLER", rewardAchRow: "YENİ KAZANIM AÇILDI!", rewardContinue: "DEVAM ▶", rewardRevengeRow: (m) => `İNTİKAM BONUSU ×${m} UYGULANDI`,
    hookWin: "SERİN SÜRÜYOR — DALGALAR SENDEN KORKUYOR!", hookLossRevenge: (m) => `⚔ İNTİKAM HAZIR: SONRAKİ ZAFERDE ×${m} ÖDÜL`, hookLoss: "RÖVANŞ SENİ BEKLİYOR, KAPTAN!",
    goodsBadge: "GANİMET TABLOSU", revengeGauge: "İNTİKAM YÜKLENİYOR", revengeReady: "İNTİKAM HAZIR",
    oneChestPerDevice: "Her cihaza günde 1 sandık!", dailyRewardLabel: "GÜNLÜK ÖDÜL",
    battleStarting: "SAVAŞ BAŞLIYOR",
    tagline: "savaşların atası...",
    howToPlay: "NASIL OYNANIR?", placeShipsTitle: "GEMİLERİ YERLEŞTIR", placeShipsBody1: "Bir gemi seç → haritaya dokun → yerleştir", placeShipsBody2: "ile yönünü değiştir",
    rotateLabel: "DÖNDÜR", admiralShipLabel: "AMİRAL GEMİSİ", tutBack: "← GERİ", tutNext: "GEÇ →", tutSkip: "GEÇ",
    tutPickShip: "BİR GEMİ SEÇ", tutTapRotate: "Geminin üzerine tıklayarak döndürebilirsin", tutGreat: "HARİKA! İŞTE BU KADAR", tutSwapHint: "Başka gemi seçmek için alttakilere dokun",
    noTouchRuleTitle: "DEĞMEZLİK KURALI", noTouchRuleBody1: "Gemileri yerleştirirken; gemiler birbirine dokunamaz —", noTouchRuleBody2: "köşeden bile olsa!",
    threeShotsTitle: "3 EL ATIŞ", threeShotsBody: "Rakibin gizlediği gemileri vurmak için 3 el ateş et.",
    tutPeek: "GEMİLERE İYİ BAK!", tutFire3: "3 EL ATEŞ ET", tutHitsResult: (n) => n>0?`${n} İSABET! MÜTHİŞSİN`:"ISKA! BİR DAHA DENE", tutTryAgain: "↻ TEKRAR DENE", tutSimple: "İşte bu kadar basit.",
    markTrackTitle: "İŞARETLE & TAKİP ET", markTrackBody1: "Atış yapmak istemediğin yerleri", markTrackBody2: "sağ tuş (mobilde uzun bas) ile işaretle.",
    tutMarkYou: "BURAYI DA SEN İŞARETLE", tutMarkDone: "HARİKA! ARTIK HAZIRSIN", tutMarkWhy: "Buralara ateş etmene gerek yok, çünkü rakibin buralara gemi saklayamaz.",
    startBattleBtn: "SAVAŞA BAŞLA", watersHeating: "sular ısınsın...",
    goldChangeTitle: "ALTIN DEĞİŞİMİ", entryFeeLabel: (n) => `Giriş: -${n} 💰`, connectingToServer: "Sunucuya bağlanılıyor...", testModeMsg: "🧪 TEST MODU — 2 tab aç, oda koduyla oyna",
    pickAvatarTooltip: "Profil simgeni seç", uploadPhotoTooltip: "Kendi fotoğrafını yükle",
    logoutBtn: "ÇIKIŞ YAP", logoutTitle: "ÇIKIŞ YAPILIYOR", logoutBody: "Çıkış yapmadan önce KURTARMA KODUNU not aldığından emin ol.", logoutBody2: "Geri dönmek için kullanıcı adın ve kurtarma kodun yeterli — ilerlemen kaybolmaz.", logoutStay: "VAZGEÇ", logoutGo: "ÇIKIŞ YAP", codeTitle: "KURTARMA KODUN", codeBody: "Bu kodu bir yere yaz! Çıkış yaparsan ya da telefonunu değiştirirsen, kullanıcı adın ve bu kodla hesabına geri dönersin.", codeCopy: "KOPYALA", codeCopied: "KOPYALANDI ✓", codeOk: "YAZDIM, DEVAM", recTitle: "BU İSİM SENİN Mİ?", recInlineHint: "Bu isim kullanılıyor. Senin hesabınsa kurtarma kodunu gir.", recBody: (n) => `"${n}" adlı hesap zaten var. Senin hesabınsa kurtarma kodunu gir, ilerlemenle birlikte geri dön.`, recPlaceholder: "KURTARMA KODU", recEnter: "HESABIMA DÖN", recCancel: "BAŞKA İSİM SEÇ", recErrWrong: "Kod hatalı. Kontrol edip tekrar dene.", recErrShort: "Kodu eksiksiz gir.", recErrMany: "Çok fazla deneme. Biraz bekle.", myCode: "Kurtarma Kodum", myCodeNone: "Bu hesap için kod bulunamadı.", waitingForOpponent: "RAKİP BEKLENİYOR", roomCodeLabel: "ODA KODU", sendCodeMsg: "Bu kodu rakibine gönder!", entryFeePaid: (n) => `Giriş ücreti: -${n} 💰`, fleetReady: "DONANMAN HAZIR!",
    placeShipScreenTitle: "GEMİ YERLEŞTİR", extraTimeBtn: "⏱ +10 SANİYE (10 💰)", extraTimeUsedMsg: "⏱ Ek süre kullanıldı",
    shipsPlacedLabel: (n,tot) => `${n}/${tot} GEMİ YERLEŞTİRİLDİ`, entryFeeShort: (n) => `💰 Giriş: ${n} 💰`,
    tapMapHint: "Haritada bir yere dokun", pickShipHint: "Aşağıdan bir gemi seç", randomPlaceBtn: "🎲 RASTGELE YERLEŞTİR", undoBtn: "↩ GERİ AL",
    placeHint: "Haritaya dokun yerleştir • Döndür butonuna veya tekrar dokun", confirmShipsBtn: "✓ GEMİLERİ ONAYLA",
    confirmShipsHint: "✏️ Gemiye dokun = döndürür • Basılı tutup sürükle = taşırsın", shipsReadyMsg: "Gemilerin hazır! Rakip bekleniyor...",
    editBtn: "↩ DÜZENLE", confirmStartBattleBtn: "✓ SAVAŞA BAŞLA",
    settingsTooltip: "Ayarlar", musicTooltip: "Müzik", endGameTestBtn: "🧪 OYUNU BİTİR (TEST)",
    wantsToPlayMsg: "seninle oynamak istiyor", acceptFullBtn: "KABUL ET",
    arenaInfoEntry: (n) => `${n} altın öde, bu odaya gir.`, arenaInfoWin: (n) => `Kazanırsan ${n} altın kazanırsın.`,
    arenaInfoXpBonus: "Ayrıca normal oyunlardan %10 daha fazla deneyim puanı (XP) kazanırsın.",
    arenaGeneralNote: "Arenalar ücretlidir ama daha çok altın ve deneyim kazandırır. Salon, Bot ve Oda Kodu ile oynanan oyunlar ise ücretsizdir, sadece kazandırdığı altın ve deneyim daha azdır.",
    infoIconTooltip: "Bilgi",
  },
  en: {
    welcome: "WELCOME!", chooseName: "Choose your sailor name", namePlaceholder: "Your username", nameHint: "2-16 characters • can't change for 14 days", confirm: "CONFIRM",
    play: "PLAY", salon: "LOBBY", arena: "ARENA", bot: "BOT", leaderboard: "RANKINGS",
    roomCodeToggle: "PLAY WITH ROOM CODE", roomCodePlaceholder: "Room Code", join: "JOIN", createRoom: "+ CREATE NEW ROOM",
    level: "LEVEL", wins: "WINS", losses: "LOSSES", winRate: "RATE", editName: "Change name",
    attack: "ATTACK", defense: "DEFENSE", fire: "FIRE", leaveGame: "LEAVE GAME", markMode: "MARK", markModeOn: "MARK MODE: ON", hits: "Hits",
    leaveConfirmTitle: "DO YOU WANT TO LEAVE?", leaveConfirmBotBody: "You'll exit the training battle.", leaveConfirmBody: "If you leave, you'll lose the match!", stay: "STAY", exit: "LEAVE",
    settingsTitle: "SETTINGS", profile: "Profile", musicLevel: "Music Volume", sfx: "Sound Effects", sfxSub: "Hit, sink, and streak sounds",
    notifications: "Notifications", notificationsSub: "Daily reward and energy reminders", language: "Language", privacy: "Privacy Policy & Terms of Use",
    support: "Support / Contact", deleteAccount: "Delete My Account / Data", close: "CLOSE", back: "Profile",
    totalGames: "TOTAL GAMES", winRateLabel: "WIN RATE", botGamesLabel: "BOT MATCHES", onlineGamesLabel: "ONLINE MATCHES", joined: "Joined",
    statBreakdown: "MATCH BREAKDOWN", statBot: "🤖 BOT", statOnline: "🌐 ONLINE", statW: "W", statL: "L",
    statAccuracy: "SHOT ACCURACY", statShots: "shots", statHits: "hits", statSunk: "SHIPS SUNK", statHonor: "HONOR",
    deleteWarning: "This action cannot be undone. When your account is deleted, all your game data (gold, level, stats, profile) is permanently removed and cannot be recovered.",
    deleteConfirmBtn: "YES, DELETE MY ACCOUNT AND DATA", cancel: "Cancel", deleting: "Deleting...",
    quickSearching: "🔍 SEARCHING FOR OPPONENT", quickFound: "🎉 OPPONENT FOUND!", quickNotFound: "😕 NO OPPONENT FOUND", quickInviting: "📨 CHALLENGE SENT",
    quickScanning: "Scanning the lobby...", quickStarting: "Duel starting, place your ships!", quickNoOpp: "No suitable opponent in the lobby — try again",
    quickWaitingReply: "is ready — waiting for reply...", retrySearch: "🔄 SEARCH AGAIN", giveUp: "GIVE UP", cancelBtn: "CANCEL", you: "YOU", opponent: "OPPONENT", ready: "READY ⚡",
    onlineSalon: "ONLINE LOBBY", activeSailors: "ACTIVE SAILORS", readyToPlay: "READY TO PLAY", readyHint: "Someone searching for a quick match can grab you directly",
    duelInvite: "DUEL CHALLENGE", inviteWaiting: "awaiting reply...", accept: "ACCEPT", reject: "DECLINE", inviteSent: "CHALLENGE SENT", noSailors: "No one is in the lobby right now",
    noSailorsHint: "You can auto-match with Quick Play", sailorsActive: "SAILORS ONLINE", duel: "⚓ DUEL", waitingBadge: "WAITING", backBtn: "GO BACK",
    victory: "VICTORY", defeat: "DEFEAT", newBattle: "NEW BATTLE", chestProgress: "CHEST PROGRESS",
    missLabel: "MISSES", goldLabel: "GOLD", levelLabel: "LEVEL", battleMap: "BATTLE MAP", homeBtn: "HOME",
    oppField: "ENEMY FIELD", myField: "MY FIELD", oppShips: "ENEMY SHIPS", myShips: "MY SHIPS",
    missionsTitle: "MISSIONS", missionsSub: "RESETS DAILY", missionDone: "COMPLETED", missionInProgress: "IN PROGRESS",
    msgConnError: "Connection error — try again", msgLoginFailed: "Login failed: ", msgPopupClosed: "Window was closed",
    msgMinChars: "At least 2 characters!", msgMaxChars: "Max 16 characters!", msgBadName: "This name isn't allowed!", msgNameTaken: "This name is already taken!",
    msgNameCooldown: (n) => `Name can be changed again in ${n} days!`, msgTypeName: "Enter your name!", msgConnecting: "Connecting...",
    msgNotEnoughGold: "Not enough gold!", msgTypeNameAndRoom: "Enter your name and room code!", msgRoomNotFound: "Room not found!", msgRoomFull: "Room is full!",
    msgArenaGoldNeeded: (n) => `This arena requires ${n} 💰!`,
    trainingBattle: "TRAINING BATTLE", oppNotPlaying: "Opponent isn't playing", hitStreak: "HIT STREAK", multiplier: "MULTIPLIER",
    leaderboardTitle: "RANKINGS", motivTop1: "👑 You rule the seas!", motivTop3: "🔥 So close to the top!", motivTop10: "⚡ You're in the TOP 10, keep going!", motivDefault: "⚓ Fight your way onto the rankings!",
    tabGold: "GOLD", tabWins: "WINS", loadingText: "Loading...", noPlayersYet: "No players yet",
    congratsSailor: "CONGRATULATIONS, SAILOR!", firstReward: "YOUR FIRST REWARD", readyForBattle: "READY FOR BATTLE",
    dailyLoginReward: "DAILY LOGIN REWARD", dayStreak: "DAY STREAK", collectBtn: "COLLECT",
    arenaSelectTitle: "CHOOSE ARENA", goldRequired: (n) => `🔒 REQUIRES ${n} GOLD`, minGoldLabel: (n) => `Min: ${n} 💰`, entryLabel: "ENTRY", sevLabel: "LVL",
    chestReadyMsg: "CHEST READY!", collectRewardMsg: "Collect your reward", mysteryChest: "MYSTERY CHEST", completedMissionsMsg: "You've completed 3 missions!", openChestBtn: "OPEN CHEST",
    dailyChestTooltip: "Daily Chest", rewardRare: "RARE", rewardGood: "GOOD",
    achTitle: "ACHIEVEMENTS", achClaim: "CLAIM REWARD", achClaimed: "CLAIMED", achLocked: "LOCKED", achSoon: "COMING SOON", achSetReward: "SET REWARD", achUnlockReq: "Unlock requirements", achPrevSet: "Complete the previous set", achBtn: "ACHIEVEMENTS", achAvatarReward: "EXCLUSIVE AVATAR",
    revengeActive: (m) => `REVENGE MODE — NEXT VICTORY REWARDS ×${m}`, revengeTaken: (m) => `REVENGE TAKEN! REWARDS ×${m}`, revengeSub: "The sea's fury is with you",
    voyageTitle: "YOUR SHIP HAS RETURNED!", voyageBody: (h) => `Returned with loot from a ${h}-hour voyage`, voyageCollect: "COLLECT THE LOOT", voyageHint: "The more you battle today, the longer your ship sails",
    sailTitle: "ANCHORS AWEIGH!", sailBody: "Even while you sleep, your ship is out there hauling loot for you.", sailBody2: "The more you battle today, the longer she sails!", sailOk: "FAIR WINDS ⚓",
    rewardTitleWin: "LOOT REPORT", rewardTitleLoss: "BATTLE REPORT", rewardGold: "GOLD", rewardHonor: "HONOR", rewardXp: "EXPERIENCE", rewardMissionsRow: "DAILY MISSIONS", rewardAchRow: "ACHIEVEMENT UNLOCKED!", rewardContinue: "CONTINUE ▶", rewardRevengeRow: (m) => `REVENGE BONUS ×${m} APPLIED`,
    hookWin: "YOUR STREAK LIVES — THE WAVES FEAR YOU!", hookLossRevenge: (m) => `⚔ REVENGE READY: ×${m} REWARDS ON NEXT WIN`, hookLoss: "THE REMATCH AWAITS, CAPTAIN!",
    goodsBadge: "LOOT REPORT", revengeGauge: "REVENGE CHARGING", revengeReady: "REVENGE READY",
    oneChestPerDevice: "1 chest per device, every day!", dailyRewardLabel: "DAILY REWARD",
    battleStarting: "BATTLE STARTING",
    tagline: "ancestor of battles...",
    howToPlay: "HOW TO PLAY?", placeShipsTitle: "PLACE YOUR SHIPS", placeShipsBody1: "Pick a ship → tap the map → place it", placeShipsBody2: "to change direction",
    rotateLabel: "ROTATE", admiralShipLabel: "ADMIRAL SHIP", tutBack: "← BACK", tutNext: "NEXT →", tutSkip: "SKIP",
    tutPickShip: "PICK A SHIP", tutTapRotate: "Tap the ship to rotate it", tutGreat: "AWESOME! THAT'S IT", tutSwapHint: "Tap below to switch ships",
    noTouchRuleTitle: "NO-TOUCH RULE", noTouchRuleBody1: "When placing ships; they can't touch each other —", noTouchRuleBody2: "not even diagonally!",
    threeShotsTitle: "3-SHOT VOLLEY", threeShotsBody: "Fire 3 shots to hit the ships your opponent has hidden.",
    tutPeek: "MEMORIZE THE SHIPS!", tutFire3: "FIRE 3 SHOTS", tutHitsResult: (n) => n>0?`${n} HIT${n!==1?"S":""}! AMAZING`:"ALL MISSED! TRY AGAIN", tutTryAgain: "↻ TRY AGAIN", tutSimple: "That's how simple it is.",
    markTrackTitle: "MARK & TRACK", markTrackBody1: "Mark cells you don't want to shoot at", markTrackBody2: "with right-click (or long-press on mobile).",
    tutMarkYou: "NOW YOU MARK THIS ONE", tutMarkDone: "AWESOME! YOU'RE READY", tutMarkWhy: "No need to shoot here — your opponent can't hide ships in these cells.",
    startBattleBtn: "START BATTLE", watersHeating: "let the waters heat up...",
    goldChangeTitle: "GOLD CHANGE", entryFeeLabel: (n) => `Entry: -${n} 💰`, connectingToServer: "Connecting to server...", testModeMsg: "🧪 TEST MODE — open 2 tabs, play with room code",
    pickAvatarTooltip: "Pick your profile icon", uploadPhotoTooltip: "Upload your own photo",
    logoutBtn: "LOG OUT", logoutTitle: "LOGGING OUT", logoutBody: "Make sure you have written down your RECOVERY CODE before logging out.", logoutBody2: "You only need your username and recovery code to come back — no progress is lost.", logoutStay: "CANCEL", logoutGo: "LOG OUT", codeTitle: "YOUR RECOVERY CODE", codeBody: "Write this down! If you log out or change phones, sign back in with your username and this code.", codeCopy: "COPY", codeCopied: "COPIED ✓", codeOk: "SAVED IT, CONTINUE", recTitle: "IS THIS YOU?", recInlineHint: "This name is in use. If it is yours, enter your recovery code.", recBody: (n) => `An account named "${n}" already exists. If it is yours, enter your recovery code to get back in with all your progress.`, recPlaceholder: "RECOVERY CODE", recEnter: "RECOVER MY ACCOUNT", recCancel: "PICK ANOTHER NAME", recErrWrong: "Wrong code. Please check and try again.", recErrShort: "Enter the full code.", recErrMany: "Too many attempts. Please wait.", myCode: "My Recovery Code", myCodeNone: "No code found for this account.", waitingForOpponent: "WAITING FOR OPPONENT", roomCodeLabel: "ROOM CODE", sendCodeMsg: "Send this code to your opponent!", entryFeePaid: (n) => `Entry fee: -${n} 💰`, fleetReady: "YOUR FLEET IS READY!",
    placeShipScreenTitle: "PLACE YOUR SHIPS", extraTimeBtn: "⏱ +10 SECONDS (10 💰)", extraTimeUsedMsg: "⏱ Extra time used",
    shipsPlacedLabel: (n,tot) => `${n}/${tot} SHIPS PLACED`, entryFeeShort: (n) => `💰 Entry: ${n} 💰`,
    tapMapHint: "Tap a spot on the map", pickShipHint: "Pick a ship below", randomPlaceBtn: "🎲 RANDOM PLACEMENT", undoBtn: "↩ UNDO",
    placeHint: "Tap the map to place • Rotate button or tap again to turn", confirmShipsBtn: "✓ CONFIRM SHIPS",
    confirmShipsHint: "✏️ Tap a ship to rotate it • Hold and drag to move it", shipsReadyMsg: "Your ships are ready! Waiting for opponent...",
    editBtn: "↩ EDIT", confirmStartBattleBtn: "✓ START BATTLE",
    settingsTooltip: "Settings", musicTooltip: "Music", endGameTestBtn: "🧪 END GAME (TEST)",
    wantsToPlayMsg: "wants to play with you", acceptFullBtn: "ACCEPT",
    arenaInfoEntry: (n) => `Pay ${n} gold to enter this room.`, arenaInfoWin: (n) => `If you win, you get ${n} gold.`,
    arenaInfoXpBonus: "You also earn 10% more XP (experience) than normal games.",
    arenaGeneralNote: "Arenas cost gold to enter but pay out more gold and XP. Lobby, Bot, and Room Code games are free, but pay out less gold and XP.",
    infoIconTooltip: "Info",
  },
};
function L(lang, key) { return (TRANSLATIONS[lang] && TRANSLATIONS[lang][key]) || TRANSLATIONS.tr[key] || key; }

// === SEVİYE / XP SİSTEMİ ===
const MAX_LEVEL = 83;
const XP_ONLINE_WIN = 1;
const XP_BOT_WIN = 0.5;
const XP_BOT_LOSS = XP_BOT_WIN / 4;       // kaybeden, kazanılan XP'nin %25'ini alır
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
// === ŞEREF — harcanamaz statü para birimi. SADECE savaşarak kazanılır, asla azalmaz. ===
// Rütbe artık altına değil Şeref'e bağlı: arena girişi ödemek rütbeni düşüremez,
// sandık/günlük ödül gibi pasif kazançlar rütbe kazandırmaz.
const HONOR_WIN_ONLINE = 10, HONOR_LOSS_ONLINE = 3, HONOR_WIN_BOT = 5, HONOR_LOSS_BOT = 2;
// Eski profiller için adil geçiş: honor alanı yoksa maç geçmişinden türet
function migrateHonor(p) {
  if (p && typeof p.honor === "number" && isFinite(p.honor) && p.honor >= 0) return Math.floor(p.honor);
  return ((p?.wins || 0) * 8) + ((p?.losses || 0) * 3);
}
function getRankInfo(honor, lang = "tr") {
  const h = honor || 0;
  const en = lang === "en";
  if (h >= 5000) return { title: en?"ADMIRAL":"AMİRAL", color: "#fbbf24", icon: "⭐", next: null, base: 5000 };
  if (h >= 2000) return { title: en?"COMMODORE":"KOMODOR", color: "#a78bfa", icon: "🎖", next: 5000, base: 2000 };
  if (h >= 800) return { title: en?"CAPTAIN":"KAPTAN", color: "#06b6d4", icon: "⚓", next: 2000, base: 800 };
  if (h >= 300) return { title: en?"COMMANDER":"YÜZBAŞI", color: "#34d399", icon: "🏅", next: 800, base: 300 };
  if (h >= 100) return { title: en?"LIEUTENANT":"TEĞMEN", color: "#60a5fa", icon: "📛", next: 300, base: 100 };
  return { title: en?"RECRUIT":"ER", color: "#9ca3af", icon: "🔰", next: 100, base: 0 };
}

// Son 5 maç form çizgisi — "W"/"L" dizisi, en fazla 5 eleman
function pushRecent(arr, won) { return [...(Array.isArray(arr) ? arr : []), won ? "W" : "L"].slice(-5); }
function safeRecent(arr) { return Array.isArray(arr) ? arr.filter(x => x === "W" || x === "L").slice(-5) : []; }

// === KAZANIM SİSTEMİ (kalıcı başarımlar) ===
const ACH_DEFAULT = { hits:0, shots:0, shotHits:0, sunk:0, marks:0, chest:0, botWins:0, onlineWins:0, goldEarned:0, bestHitStreak:0, bestTurnStreak:0, turnStreak:0, bestWinStreak:0, winStreak:0, lossStreak:0, fast5:0, fast3:0, fast2:0, perfect:0, tripleTurn:0, arenaAcik:0, arenaFirtina:0 };

// === İNTİKAM MODU — üst üste kayıplar bir sonraki zaferin ödüllerini katlar ===
// 2 mağlubiyet ×2, 3 mağlubiyet ×2.5, 4+ mağlubiyet ×3 (altın + XP)
function revengeMult(lossStreak) { const ls = lossStreak || 0; return ls >= 4 ? 3 : ls === 3 ? 2.5 : ls === 2 ? 2 : 1; }

// === SEFER DÖNÜŞÜ — çevrimdışı kazanç: bugünkü oyun, yarınki pasif gelirin tohumunu eker ===
// Kapasite (saat) o gün oynanan maç sayısıyla büyür: 0 maç → 1s, 5 maç → 8s, tavan 12s.
// Saatlik kazanç rütbeyle artar (15-40). Aktif oyun her zaman daha kârlı kalır.
const VOYAGE_MAX_H = 12;
function safeVoyage(v) {
  const o = { lastClaim: 0, dayKey: "", matches: 0 };
  if (v && typeof v === "object") {
    if (typeof v.lastClaim === "number" && isFinite(v.lastClaim) && v.lastClaim > 0) o.lastClaim = v.lastClaim;
    if (typeof v.dayKey === "string") o.dayKey = v.dayKey;
    if (typeof v.matches === "number" && isFinite(v.matches)) o.matches = Math.max(0, Math.floor(v.matches));
  }
  return o;
}
function voyageCapH(matches) { return Math.min(VOYAGE_MAX_H, 1 + 1.4 * (matches || 0)); }
function voyageRate(honor) { const h = honor || 0; const tier = h >= 5000 ? 5 : h >= 2000 ? 4 : h >= 800 ? 3 : h >= 300 ? 2 : h >= 100 ? 1 : 0; return 15 + tier * 5; }
function safeAch(a) { const o = { ...ACH_DEFAULT }; if (a && typeof a === "object") { for (const k in ACH_DEFAULT) { const v = a[k]; if (typeof v === "number" && isFinite(v) && v >= 0) o[k] = v; } } return o; }
function safeClaimed(c) { const o = {}; if (c && typeof c === "object") { for (const k of ["s1","s2","s3","s4","s5"]) if (c[k] === true) o[k] = true; } return o; }

// Set avatarları — kullanıcı özel görselleri verene kadar yer tutucu; /img/avatar_sX.png varsa o kullanılır
const ACH_AVATARS = { s1:"🏴‍☠️", s2:"🦑", s3:"⚜️", s4:"🐲", s5:"👑" };
const wr = (p) => p && p.totalGames > 0 ? Math.round(((p.wins||0) / p.totalGames) * 100) : 0;
const ACH_SETS = [
  { id:"s1", name:"ÇAYLAK", nameEn:"ROOKIE", reward:1000,
    gate: () => true, gateReq: [],
    missions: [
      { icon:"⚓", text:"İlk oyununu oyna",              textEn:"Play your first game",        check:(p,a)=>(p.totalGames||0)>=1 },
      { icon:"🏆", text:"İlk galibiyetini al",            textEn:"Get your first win",          check:(p,a)=>(p.wins||0)>=1 },
      { icon:"🎯", text:"Toplam 25 isabet yap",           textEn:"Land 25 total hits",          check:(p,a)=>a.hits>=25 },
      { icon:"🚢", text:"Toplam 5 gemi batır",            textEn:"Sink 5 ships",                check:(p,a)=>a.sunk>=5 },
      { icon:"🤖", text:"Botu 3 kez yen",                 textEn:"Beat the bot 3 times",        check:(p,a)=>a.botWins>=3 },
      { icon:"💥", text:"Tek turda 3 isabet yap",         textEn:"Land 3 hits in one turn",     check:(p,a)=>a.tripleTurn>=1 },
      { icon:"⚑", text:"Toplam 20 kare işaretle",        textEn:"Mark 20 cells",               check:(p,a)=>a.marks>=20 },
      { icon:"🌊", text:"Toplam 5 oyun oyna",             textEn:"Play 5 games",                check:(p,a)=>(p.totalGames||0)>=5 },
      { icon:"💰", text:"Günlük sandığı 3 kez aç",        textEn:"Open the daily chest 3 times",check:(p,a)=>a.chest>=3 },
      { icon:"🎖", text:"Seviye 2'ye ulaş",               textEn:"Reach level 2",               check:(p,a)=>(p.level||0)>=2 },
    ] },
  { id:"s2", name:"DENİZCİ", nameEn:"SAILOR", reward:1500,
    gate: (p) => (p.totalGames||0)>=21 && safeAch(p.ach).goldEarned>=5000 && (wr(p)>=30 || (p.wins||0)>=10),
    gateReq: [ { tr:"21 oyun", en:"21 games", ok:(p)=>(p.totalGames||0)>=21 }, { tr:"5.000 altın kazan", en:"Earn 5,000 gold", ok:(p)=>safeAch(p.ach).goldEarned>=5000 }, { tr:"%30 oran veya 10 galibiyet", en:"30% rate or 10 wins", ok:(p)=>wr(p)>=30||(p.wins||0)>=10 } ],
    missions: [
      { icon:"⚓", text:"Toplam 30 oyun oyna",            textEn:"Play 30 games",               check:(p,a)=>(p.totalGames||0)>=30 },
      { icon:"🏆", text:"Toplam 10 galibiyet al",         textEn:"Win 10 games",                check:(p,a)=>(p.wins||0)>=10 },
      { icon:"🎯", text:"Toplam 150 isabet yap",          textEn:"Land 150 total hits",         check:(p,a)=>a.hits>=150 },
      { icon:"🚢", text:"Toplam 25 gemi batır",           textEn:"Sink 25 ships",               check:(p,a)=>a.sunk>=25 },
      { icon:"🌐", text:"İlk online maçını oyna",         textEn:"Play your first online match",check:(p,a)=>(p.onlineGames||0)>=1 },
      { icon:"⚡", text:"5 dakikanın altında kazan",      textEn:"Win in under 5 minutes",      check:(p,a)=>a.fast5>=1 },
      { icon:"🔥", text:"5 isabetlik seri yap",           textEn:"Land a 5-hit streak",         check:(p,a)=>a.bestHitStreak>=5 },
      { icon:"🛡", text:"3 tur üst üste isabet al",       textEn:"Hit 3 turns in a row",        check:(p,a)=>a.bestTurnStreak>=3 },
      { icon:"💰", text:"Toplam 10.000 altın kazan",      textEn:"Earn 10,000 total gold",      check:(p,a)=>a.goldEarned>=10000 },
      { icon:"🎖", text:"Seviye 5'e ulaş",                textEn:"Reach level 5",               check:(p,a)=>(p.level||0)>=5 },
    ] },
  { id:"s3", name:"KAPTAN", nameEn:"CAPTAIN", reward:2500,
    gate: (p) => (p.totalGames||0)>=61 && safeAch(p.ach).goldEarned>=15000 && (wr(p)>=40 || (p.wins||0)>=35),
    gateReq: [ { tr:"61 oyun", en:"61 games", ok:(p)=>(p.totalGames||0)>=61 }, { tr:"15.000 altın kazan", en:"Earn 15,000 gold", ok:(p)=>safeAch(p.ach).goldEarned>=15000 }, { tr:"%40 oran veya 35 galibiyet", en:"40% rate or 35 wins", ok:(p)=>wr(p)>=40||(p.wins||0)>=35 } ],
    missions: [
      { icon:"⚓", text:"Toplam 90 oyun oyna",            textEn:"Play 90 games",               check:(p,a)=>(p.totalGames||0)>=90 },
      { icon:"🏆", text:"Toplam 35 galibiyet al",         textEn:"Win 35 games",                check:(p,a)=>(p.wins||0)>=35 },
      { icon:"🎯", text:"Toplam 500 isabet yap",          textEn:"Land 500 total hits",         check:(p,a)=>a.hits>=500 },
      { icon:"🚢", text:"Toplam 75 gemi batır",           textEn:"Sink 75 ships",               check:(p,a)=>a.sunk>=75 },
      { icon:"🌐", text:"10 online maç kazan",            textEn:"Win 10 online matches",       check:(p,a)=>a.onlineWins>=10 },
      { icon:"⚡", text:"3 dakikanın altında kazan",      textEn:"Win in under 3 minutes",      check:(p,a)=>a.fast3>=1 },
      { icon:"🔥", text:"8 isabetlik seri yap",           textEn:"Land an 8-hit streak",        check:(p,a)=>a.bestHitStreak>=8 },
      { icon:"👁", text:"Hiç karavana vermeden kazan",    textEn:"Win without a single miss",   check:(p,a)=>a.perfect>=1 },
      { icon:"🚢", text:"AÇIK DENİZ arenasında kazan",    textEn:"Win in the OPEN SEA arena",   check:(p,a)=>a.arenaAcik>=1 },
      { icon:"🎖", text:"Seviye 10'a ulaş",               textEn:"Reach level 10",              check:(p,a)=>(p.level||0)>=10 },
    ] },
  { id:"s4", name:"AMİRAL", nameEn:"ADMIRAL", reward:5000,
    gate: (p) => (p.totalGames||0)>=121 && safeAch(p.ach).goldEarned>=24000 && (wr(p)>=45 || (p.wins||0)>=60),
    gateReq: [ { tr:"121 oyun", en:"121 games", ok:(p)=>(p.totalGames||0)>=121 }, { tr:"24.000 altın kazan", en:"Earn 24,000 gold", ok:(p)=>safeAch(p.ach).goldEarned>=24000 }, { tr:"%45 oran veya 60 galibiyet", en:"45% rate or 60 wins", ok:(p)=>wr(p)>=45||(p.wins||0)>=60 } ],
    missions: [
      { icon:"⚓", text:"Toplam 150 oyun oyna",           textEn:"Play 150 games",              check:(p,a)=>(p.totalGames||0)>=150 },
      { icon:"🏆", text:"Toplam 75 galibiyet al",         textEn:"Win 75 games",                check:(p,a)=>(p.wins||0)>=75 },
      { icon:"🎯", text:"Toplam 1200 isabet yap",         textEn:"Land 1,200 total hits",       check:(p,a)=>a.hits>=1200 },
      { icon:"🚢", text:"Toplam 150 gemi batır",          textEn:"Sink 150 ships",              check:(p,a)=>a.sunk>=150 },
      { icon:"🌐", text:"30 online maç kazan",            textEn:"Win 30 online matches",       check:(p,a)=>a.onlineWins>=30 },
      { icon:"⚡", text:"2 dakikanın altında kazan",      textEn:"Win in under 2 minutes",      check:(p,a)=>a.fast2>=1 },
      { icon:"🔥", text:"10 isabetlik seri yap",          textEn:"Land a 10-hit streak",        check:(p,a)=>a.bestHitStreak>=10 },
      { icon:"🥇", text:"5 maç üst üste kazan",           textEn:"Win 5 matches in a row",      check:(p,a)=>a.bestWinStreak>=5 },
      { icon:"⛈", text:"FIRTINA arenasında kazan",       textEn:"Win in the STORM arena",      check:(p,a)=>a.arenaFirtina>=1 },
      { icon:"📅", text:"7 gün üst üste giriş yap",       textEn:"Log in 7 days in a row",      check:(p,a)=>(p.loginStreak||0)>=7 },
    ] },
];
// 5. set kapısı (içerik yakında)
const ACH_SET5_GATE = [ { tr:"201 oyun", en:"201 games" }, { tr:"30.000 altın kazan", en:"Earn 30,000 gold" }, { tr:"%50 kazanma oranı", en:"50% win rate" } ];
function achSetDone(setDef, p) { const a = safeAch(p?.ach); return setDef.missions.every(m => { try { return m.check(p||{}, a); } catch(e) { return false; } }); }

// === KURTARMA KODU SİSTEMİ ===
// Hesaplar anonim başlar (cihaza bağlı). Kullanıcı adı seçilince hesabı kalıcı bir kimliğe
// bağlarız: kullanıcı adından türetilen teknik bir e-posta + kurtarma kodu (şifre).
// Böylece çıkış yapıp aynı isim ve kodla girince AYNI hesaba dönülür — ilerleme kaybolmaz.
// Kullanıcı gerçek e-posta girmez; bu tamamen perde arkasındadır.
const AUTH_DOMAIN_SUFFIX = "@oyuncu.amiralbatti.app";
function nameToAuthEmail(name) {
  // Türkçe karakterleri sadeleştir, yalnızca harf/rakam bırak → e-posta olarak geçerli olsun
  const map = { "ç":"c","ğ":"g","ı":"i","ö":"o","ş":"s","ü":"u","Ç":"c","Ğ":"g","İ":"i","I":"i","Ö":"o","Ş":"s","Ü":"u" };
  const slug = String(name || "").trim().toLowerCase()
    .replace(/[çğıöşüÇĞİIÖŞÜ]/g, ch => map[ch] || ch)
    .replace(/[^a-z0-9]/g, "");
  return slug ? slug + AUTH_DOMAIN_SUFFIX : null;
}
// Karışması kolay karakterler (0/O, 1/I/L) dışarıda — telefonda elle girilebilir olmalı
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
function generateRecoveryCode() {
  let out = "";
  for (let i = 0; i < 8; i++) out += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  return out.slice(0, 4) + "-" + out.slice(4); // ABCD-EFGH
}
function normalizeCode(c) { return String(c || "").toUpperCase().replace(/[^A-Z0-9]/g, ""); }

// === ODA TEMİZLİĞİ ===
// Biten/terk edilen odalar silinmezse veritabanı sonsuza kadar büyür (maliyet + yavaşlama).
// İki katman: (1) maç bitince odayı tek taraf siler, (2) açılışta eski artıkları süpür.
const ROOM_TTL_MS = 2 * 60 * 60 * 1000; // 2 saatten eski oda = artık

function deleteRoomSoon(roomId, delayMs = 45000) {
  // Gecikme, iki oyuncunun da sonucu okumasına zaman tanır. Oda silinince
  // dinleyiciler null alır ve zaten `if (!game) return;` ile güvenle çıkar.
  if (!roomId) return null;
  return setTimeout(() => { remove(ref(db, `rooms/${roomId}`)).catch(() => {}); }, delayMs);
}

// Öksüz oda temizliği — cihaz çökerse/uygulama kapanırsa oda ortada kalır.
// Katıldığımız odanın kimliğini yerelde tutar, bir sonraki açılışta biten/eskimiş
// olanı sileriz. Böylece "tüm odaları oku" iznine gerek kalmaz (rakip tahtası sızmaz).
const MY_ROOM_KEY = "ab_last_room";
function rememberRoom(roomId) {
  try { if (roomId) localStorage.setItem(MY_ROOM_KEY, roomId); } catch (e) {}
}
function forgetRoom() {
  try { localStorage.removeItem(MY_ROOM_KEY); } catch (e) {}
}
async function cleanupOrphanRoom() {
  let rid = null;
  try { rid = localStorage.getItem(MY_ROOM_KEY); } catch (e) {}
  if (!rid) return false;
  try {
    const snap = await get(ref(db, `rooms/${rid}`));
    if (!snap.exists()) { forgetRoom(); return false; }
    const v = snap.val() || {};
    const created = typeof v.created === "number" ? v.created : 0;
    const finished = v.winner != null;
    // Bitmiş ya da 2 saatten eski (terk edilmiş) ise sil
    if (finished || (created && Date.now() - created > ROOM_TTL_MS)) {
      await remove(ref(db, `rooms/${rid}`)).catch(() => {});
      forgetRoom();
      return true;
    }
  } catch (e) {}
  return false;
}

// === GLOBAL SAYAÇLAR — Yaşayan Ufuk beslemesi (dürüst, sadece büyüyen metrikler) ===
function todayKey() { const d = new Date(); return `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,"0")}${String(d.getDate()).padStart(2,"0")}`; }
function bumpGlobalStats(battles, sunk) {
  try {
    if (battles > 0) { runTransaction(ref(db, "global_stats/battlesTotal"), v => (v||0) + battles).catch(()=>{}); runTransaction(ref(db, `global_stats/day/${todayKey()}/battles`), v => (v||0) + battles).catch(()=>{}); }
    if (sunk > 0) runTransaction(ref(db, "global_stats/sunkTotal"), v => (v||0) + sunk).catch(()=>{});
  } catch(e) {}
}
function achSetUnlocked(idx, p) {
  if (!p) return false;
  if (idx === 0) return true;
  return achSetDone(ACH_SETS[idx-1], p) && ACH_SETS[idx].gate(p);
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
    this._baseVol = 0.1;         // en son istenen (ölçeksiz) hedef ses seviyesi
    this._dynamicTimer = null;   // for intensity ramp
    // Ayarlar — kalıcı tercihler
    this.sfxOn = true;           // vurma/isabet/first-kill vb. ses efektleri
    this.volumeMult = 1;         // müzik seviyesi çarpanı (ayarlar sürgüsünden)
    try {
      const savedSfx = localStorage.getItem('ab_sfxOn');
      if (savedSfx !== null) this.sfxOn = savedSfx === '1';
      const savedVol = localStorage.getItem('ab_musicVolume');
      if (savedVol !== null) this.volumeMult = Math.max(0, parseInt(savedVol, 10)) / 50;
    } catch(e) {}
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
    this._baseVol = targetVol;
    const scaledTarget = targetVol * (this.volumeMult != null ? this.volumeMult : 1);
    const steps = 30, interval = durationMs / steps;
    const startVol = this._mp3Volume;
    let step = 0;
    if (this._dynamicTimer) clearInterval(this._dynamicTimer);
    this._dynamicTimer = setInterval(() => {
      step++;
      const t = step / steps;
      const eased = t < 0.5 ? 2*t*t : -1+(4-2*t)*t; // ease in-out
      const vol = startVol + (scaledTarget - startVol) * eased;
      if (this._audioGainNode) this._audioGainNode.gain.setValueAtTime(Math.max(0,vol), this.ctx.currentTime);
      if (step >= steps) { clearInterval(this._dynamicTimer); this._dynamicTimer = null; this._mp3Volume = scaledTarget; if (targetVol > 0) this._loopTargetVol = targetVol; }
    }, interval);
  }
  // Ayarlar panelindeki sürgüden anlık çağrılır (0-100)
  setMusicVolume(pct) {
    this.volumeMult = Math.max(0, Math.min(100, pct)) / 50;
    try { localStorage.setItem('ab_musicVolume', String(Math.round(pct))); } catch(e) {}
    if (this._audioGainNode && this.ctx) {
      const newVol = (this._baseVol != null ? this._baseVol : this._mp3Volume) * this.volumeMult;
      this._mp3Volume = newVol;
      this._audioGainNode.gain.setValueAtTime(Math.max(0,newVol), this.ctx.currentTime);
    }
  }
  setSfxOn(on) {
    this.sfxOn = on;
    try { localStorage.setItem('ab_sfxOn', on ? '1' : '0'); } catch(e) {}
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
  // channel "fx" (patlama vb.) serbest çalar; channel "anon" (kill anonsları) kendi arasında tekildir.
  playVoice(name, channel = "fx") {
    if (!this.sfxOn) return;
    try {
      if (channel === "anon" && this._anonEl) { try { this._anonEl.pause(); this._anonEl.currentTime = 0; } catch(e) {} }
      const a = new Audio(`/sfx/${name}.mp3`);
      a.volume = channel === "anon" ? 1.0 : 0.85;
      if (channel === "anon") this._anonEl = a;
      const p = a.play();
      if (p && p.catch) p.catch(()=>{});
    } catch(e) {}
  }
  // TEK ATIŞTA (bir yaylım ateşinde) vurulan kutucuk sayısına göre anons.
  // 3 kutucuk → triple kill, 2 kutucuk → double kill, 1 kutucuk → (sadece ilk kez) first kill.
  // Patlama sesinin üstüne binmemesi için kısa gecikmeyle, kendi kanalında çalar.
  playVolleyVoice(hitCount, isFirstEver) {
    if (!this.sfxOn) return;
    const name = hitCount >= 3 ? 'triple_kill' : hitCount === 2 ? 'double_kill' : (hitCount === 1 && isFirstEver ? 'first_kill' : null);
    if (!name) return;
    if (this._volleyTimer) clearTimeout(this._volleyTimer);
    this._volleyTimer = setTimeout(() => this.playVoice(name, "anon"), 320);
  }
  play(type) {
    if (!this.enabled || !this.ctx || !this.sfxOn) return;
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

function OnboardingVictoryScreen({ sfx, t, winner, warrior, mono, onDone, lang = "tr" }) {
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
          <div style={{ fontSize:13,fontWeight:700,color:t.textDim,fontFamily:warrior,letterSpacing:6,marginBottom:6 }}>{L(lang,"congratsSailor")}</div>
          <div style={{ fontSize:52,fontWeight:900,color:"#ffd700",fontFamily:warrior,letterSpacing:10,textShadow:`0 0 50px rgba(255,215,0,0.6), 0 0 100px ${accentGlow}, 0 4px 8px rgba(0,0,0,0.8)`,marginBottom:12,textTransform:"uppercase" }}>{L(lang,"victory")}</div>
          <div style={{ fontSize:13,fontWeight:700,color:"rgba(0,229,255,0.6)",fontFamily:warrior,letterSpacing:2,marginBottom:24 }}>{winner}</div>
          <div style={{ background:"rgba(255,215,0,0.07)",border:`1px solid rgba(255,215,0,0.18)`,borderRadius:12,padding:"10px 16px",marginBottom:20 }}>
            <div style={{ fontSize:11,fontWeight:700,color:t.textDim,fontFamily:mono,letterSpacing:2 }}>{L(lang,"firstReward")}</div>
            <div style={{ fontSize:22,fontWeight:800,color:gold,fontFamily:warrior,textShadow:`0 0 15px ${goldGlow}`,marginTop:4 }}>500</div>
          </div>
          <button onClick={onDone} style={{ padding:"16px 36px",background:`linear-gradient(135deg,${t.accent},#0891b2)`,color:t.bg,border:"none",borderRadius:14,fontSize:16,fontWeight:800,letterSpacing:4,cursor:"pointer",fontFamily:warrior,boxShadow:`0 4px 30px ${accentGlow}` }}>{L(lang,"readyForBattle")}</button>
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
    <div style={{ position:'absolute',left:'50%',transform:'translateX(-50%)',bottom:70,fontSize:28,fontWeight:900,color:t.gold,fontFamily:warrior,textShadow:`0 0 30px ${t.goldGlow}, 0 0 60px ${t.goldGlow}`,animation:'scaleUp 0.4s cubic-bezier(0.34,1.56,0.64,1) 150ms forwards',opacity:0,whiteSpace:'nowrap',letterSpacing:4 }}>+{amount} <img src="/img/coin.png" alt="" style={{ width:18,height:18,verticalAlign:"middle",filter:"drop-shadow(0 0 8px rgba(255,215,0,0.9))" }} /></div>
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
  useEffect(() => { const tm = setTimeout(()=>onDone?.(), 2100); return ()=>clearTimeout(tm); }, []);
  const clr = color || t.gold;
  // İlk anda maksimum parlaklıkla belirir, platformun hemen altında 1.5sn sabit durur, sonra ekrana doğru küçülüp solarak kaybolur
  return (<div style={{ position:'absolute',top:'100%',left:'50%',marginTop:12,zIndex:10001,fontSize:24,fontWeight:900,color:clr,fontFamily:warrior,letterSpacing:4,textTransform:'uppercase',whiteSpace:'nowrap',
    WebkitTextStroke:'1.5px rgba(0,0,0,0.85)',
    textShadow:`0 3px 0 rgba(0,0,0,0.9), 0 6px 0 rgba(0,0,0,0.55), 0 12px 24px rgba(0,0,0,0.9), 0 0 34px ${clr}, 0 0 90px ${clr}66`,
    animation:'feedbackHoldRise 2.1s ease-out forwards',pointerEvents:'none' }}>{text}</div>);
}

const ARENAS = [
  { id: "liman", name: "LİMAN", nameEn: "HARBOR", minGold: 0, entryFee: 50, winGold: 120, loseGold: 30, color: "#9ca3af", icon: "⚓" },
  { id: "kiyi", name: "KIYI", nameEn: "COAST", minGold: 1000, entryFee: 100, winGold: 250, loseGold: 50, color: "#60a5fa", icon: "🌊" },
  { id: "acikdeniz", name: "AÇIK DENİZ", nameEn: "OPEN SEA", minGold: 3000, entryFee: 200, winGold: 520, loseGold: 80, color: "#06b6d4", icon: "🚢" },
  { id: "firtina", name: "FIRTINA", nameEn: "STORM", minGold: 8000, entryFee: 500, winGold: 1300, loseGold: 150, color: "#a78bfa", icon: "⛈" },
  { id: "amiral", name: "AMİRAL", nameEn: "ADMIRAL", minGold: 20000, entryFee: 1000, winGold: 2700, loseGold: 250, color: "#fbbf24", icon: "👑" },
];
const STARTING_GOLD = 500;

function safeGold(val) {
  if (typeof val === "number" && !isNaN(val) && isFinite(val)) return Math.max(0, Math.floor(val));
  return isTestMode() ? 5000 : STARTING_GOLD;
}

const QUICK_EMOJIS = [
  { id: "niceshot", emoji: "🎯", label: "İyi atış!", labelEn: "Nice shot!" },
  { id: "fire", emoji: "🔥", label: "Yanıyorsun!", labelEn: "You're on fire!" },
  { id: "gg", emoji: "👏", label: "Tebrikler", labelEn: "GG" },
  { id: "oops", emoji: "😤", label: "Eyvah!", labelEn: "Oops!" },
  { id: "salute", emoji: "🙏", label: "Saygılar", labelEn: "Respect" },
  { id: "skull", emoji: "💀", label: "Battın!", labelEn: "You sank!" },
  { id: "hurry", emoji: "⏳", label: "Acele et!", labelEn: "Hurry up!" },
  { id: "lucky", emoji: "🍀", label: "Şanslısın", labelEn: "Lucky!" },
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
    botGames: (typeof profile.botGames === "number" && isFinite(profile.botGames)) ? profile.botGames : 0,
    onlineGames: (typeof profile.onlineGames === "number" && isFinite(profile.onlineGames)) ? profile.onlineGames : 0,
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
    recentResults: safeRecent(profile.recentResults),
    ach: (() => { const a = safeAch(profile.ach); a.goldEarned += reward; a.chest += 0; return a; })(),
    achievClaimed: safeClaimed(profile.achievClaimed),
    honor: migrateHonor(profile),
    voyage: safeVoyage(profile.voyage),
    daily: safeDaily(profile.daily),
  };
  await set(profileRef, cleanProfile);
  return { reward, streak, newGold };
}

function DailyRewardPopup({ reward, streak, onClose, lang = "tr" }) {
  return (<div style={{ position:"fixed",inset:0,background:"radial-gradient(ellipse at 50% 40%, rgba(255,215,0,0.10) 0%, rgba(167,139,250,0.06) 35%, rgba(0,0,0,0.88) 75%)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:9999,backdropFilter:"blur(6px)",overflow:"hidden" }} onClick={onClose}>
    {/* Dönen ışık huzmeleri — oksipital uyarım */}
    <div style={{ position:"absolute",width:900,height:900,top:"50%",left:"50%",transform:"translate(-50%,-50%)",background:"conic-gradient(from 0deg, transparent 0deg, rgba(255,215,0,0.10) 12deg, transparent 24deg, transparent 40deg, rgba(0,229,255,0.08) 52deg, transparent 64deg, transparent 90deg, rgba(255,105,180,0.07) 102deg, transparent 114deg, transparent 140deg, rgba(255,215,0,0.10) 152deg, transparent 164deg, transparent 190deg, rgba(167,139,250,0.08) 202deg, transparent 214deg, transparent 250deg, rgba(255,215,0,0.09) 262deg, transparent 274deg, transparent 310deg, rgba(0,229,255,0.07) 322deg, transparent 334deg)",animation:"raysSpin 22s linear infinite",pointerEvents:"none" }} />
    {/* Süzülen paralar */}
    {[...Array(8)].map((_,i)=>(<div key={i} style={{ position:"absolute",fontSize:16+((i*7)%14),left:`${8+i*11.5}%`,top:`${72+((i*13)%18)}%`,opacity:0.5,animation:`coinRise ${5+(i%4)}s ease-in ${i*0.7}s infinite`,pointerEvents:"none",filter:"drop-shadow(0 0 8px rgba(255,215,0,0.6))" }}>{i%3===0?"💰":i%3===1?"🪙":"✨"}</div>))}
    <div onClick={e=>e.stopPropagation()} style={{ position:"relative",background:"linear-gradient(160deg, rgba(20,26,52,0.99) 0%, rgba(10,16,32,0.99) 60%, rgba(30,20,8,0.99) 100%)",border:"2px solid rgba(255,215,0,0.6)",outline:"1px solid rgba(0,229,255,0.25)",outlineOffset:5,borderRadius:22,padding:"38px 42px",textAlign:"center",maxWidth:350,width:"90%",boxShadow:"0 0 100px rgba(255,215,0,0.35), 0 0 200px rgba(167,139,250,0.15), 0 24px 70px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,215,0,0.2)",animation:"chestBounceIn 0.7s cubic-bezier(0.34,1.56,0.64,1)",overflow:"hidden" }}>
      {/* Parlama süpürmesi */}
      <div style={{ position:"absolute",top:0,left:"-60%",width:"45%",height:"100%",background:"linear-gradient(105deg, transparent, rgba(255,255,255,0.10), transparent)",animation:"shineSweep 3s ease-in-out 0.8s infinite",pointerEvents:"none" }} />
      <img src="/img/chest.png" alt="" draggable={false} style={{ width:80,height:80,objectFit:"contain",marginBottom:10,animation:"chestWiggle 2.2s ease-in-out infinite",filter:"drop-shadow(0 6px 14px rgba(0,0,0,0.6)) drop-shadow(0 0 30px rgba(255,215,0,0.5))",userSelect:"none",pointerEvents:"none" }} />
      <div style={{ fontSize:11,fontWeight:700,color:"rgba(255,215,0,0.6)",fontFamily:mono,letterSpacing:5,marginBottom:8 }}>{L(lang,"dailyLoginReward")}</div>
      <div style={{ fontSize:50,fontWeight:900,fontFamily:warrior,marginBottom:12,letterSpacing:2,background:"linear-gradient(180deg, #fff7d6 0%, #ffd700 45%, #d97706 100%)",WebkitBackgroundClip:"text",WebkitTextFillColor:"transparent",filter:"drop-shadow(0 0 25px rgba(255,215,0,0.7)) drop-shadow(0 3px 4px rgba(0,0,0,0.8))",animation:"rewardPulse 1.6s ease-in-out infinite" }}>+{reward} <img src="/img/coin.png" alt="" style={{ width:18,height:18,verticalAlign:"middle",filter:"drop-shadow(0 0 8px rgba(255,215,0,0.9))" }} /></div>
      {streak > 1 && <div style={{ fontSize:13,fontWeight:800,color:"#ff9f43",fontFamily:warrior,marginBottom:12,padding:"7px 18px",background:"linear-gradient(135deg, rgba(255,105,60,0.14), rgba(255,215,0,0.10))",borderRadius:10,border:"1px solid rgba(255,159,67,0.35)",display:"inline-block",letterSpacing:2,textShadow:"0 0 12px rgba(255,159,67,0.5)" }}>🔥 {streak} {L(lang,"dayStreak")} {streak>=7?"• x2 BONUS":streak>=3?"• x1.5 BONUS":streak>=2?"• x1.25 BONUS":""}</div>}
      <div><button onClick={onClose} style={{ marginTop:12,padding:"16px 52px",background:"linear-gradient(135deg, #ffd700 0%, #ff9f43 55%, #d97706 100%)",color:"#1a1206",border:"none",borderRadius:12,fontSize:17,fontWeight:900,letterSpacing:5,cursor:"pointer",fontFamily:warrior,boxShadow:"0 0 40px rgba(255,215,0,0.5), 0 6px 24px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.4)",animation:"btnBreath 1.8s ease-in-out infinite",textTransform:"uppercase" }}>{L(lang,"collectBtn")}</button></div>
    </div>
  </div>);
}

function ArenaSelect({ myGold, onSelect, onBack, lang = "tr" }) {
  const [openInfo, setOpenInfo] = useState(null);
  return (<div style={{ display:"flex",flexDirection:"column",alignItems:"center",minHeight:"100vh",minHeight:"100dvh",background:`linear-gradient(180deg, ${t.bg} 0%, #071428 100%)`,padding:"24px 14px",fontFamily:mono,color:t.text }}>
    <div style={{ fontSize:26,fontWeight:800,letterSpacing:6,color:t.accent,marginBottom:6,fontFamily:warrior,textShadow:`0 0 25px ${t.accentGlow}` }}>{L(lang,"arenaSelectTitle")}</div>
    <div style={{ fontSize:14,fontWeight:800,color:t.gold,fontFamily:warrior,marginBottom:14,padding:"6px 20px",background:"rgba(255,215,0,0.08)",borderRadius:10,border:"1px solid rgba(255,215,0,0.2)",letterSpacing:2 }}><img src="/img/coin.png" alt="" style={{ width:18,height:18,verticalAlign:"middle",filter:"drop-shadow(0 0 8px rgba(255,215,0,0.9))" }} /> {myGold} {L(lang,"goldLabel")}</div>
    <div style={{ fontSize:11,color:t.textDim,fontFamily:mono,textAlign:"center",marginBottom:16,maxWidth:400,lineHeight:1.6,padding:"0 8px" }}>{L(lang,"arenaGeneralNote")}</div>
    <div style={{ width:"100%",maxWidth:400,display:"flex",flexDirection:"column",gap:10 }}>
      {ARENAS.map(arena => {
        const locked = (myGold||0) < arena.minGold, cantAfford = (myGold||0) < arena.entryFee, disabled = locked||cantAfford;
        const infoOpen = openInfo === arena.id;
        return (<div key={arena.id}>
          <div onClick={()=>!disabled&&onSelect(arena)} style={{ display:"flex",alignItems:"center",gap:16,padding:"18px 20px",background:disabled?"rgba(22,32,64,0.5)":`linear-gradient(145deg, rgba(12,21,41,0.95), rgba(8,14,30,0.98))`,border:`2px solid ${disabled?"rgba(30,58,95,0.3)":arena.color}`,borderRadius:infoOpen?"14px 14px 0 0":14,cursor:disabled?"not-allowed":"pointer",opacity:disabled?0.45:1,textAlign:"left",width:"100%",boxShadow:disabled?"none":`0 0 20px ${arena.color}22, 0 4px 20px rgba(0,0,0,0.3)`,transition:"all 0.2s ease" }}>
            <div style={{ fontSize:32,width:48,height:48,display:"flex",alignItems:"center",justifyContent:"center",background:`${arena.color}15`,borderRadius:12,border:`1px solid ${arena.color}33`,flexShrink:0 }}>{arena.icon}</div>
            <div style={{ flex:1,minWidth:0 }}>
              <div style={{ display:"flex",alignItems:"center",gap:6 }}>
                <div style={{ fontSize:16,fontWeight:800,color:arena.color,fontFamily:warrior,letterSpacing:4 }}>{lang==="en"?arena.nameEn:arena.name}</div>
                <button onClick={(e)=>{e.stopPropagation();setOpenInfo(infoOpen?null:arena.id);}} title={L(lang,"infoIconTooltip")} style={{ width:24,height:24,borderRadius:"50%",background:infoOpen?t.accent:"rgba(0,229,255,0.18)",border:`2px solid ${t.accent}`,color:infoOpen?t.bg:t.accent,fontSize:14,fontWeight:900,fontFamily:"Georgia, serif",fontStyle:"italic",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",padding:0,flexShrink:0,boxShadow:`0 0 10px ${t.accentGlow}`,lineHeight:1 }}>i</button>
              </div>
              <div style={{ fontSize:10,fontWeight:700,color:t.textDim,marginTop:3,fontFamily:mono }}>{locked?L(lang,"goldRequired")(arena.minGold):L(lang,"minGoldLabel")(arena.minGold)}</div>
            </div>
            <div style={{ textAlign:"right",flexShrink:0 }}><div style={{ fontSize:16,fontWeight:800,color:cantAfford?t.hit:t.gold,fontFamily:warrior }}>{arena.entryFee} <img src="/img/coin.png" alt="" style={{ width:18,height:18,verticalAlign:"middle",filter:"drop-shadow(0 0 8px rgba(255,215,0,0.9))" }} /></div><div style={{ fontSize:9,color:t.textDim,fontWeight:700,letterSpacing:1 }}>{L(lang,"entryLabel")}</div><div style={{ fontSize:12,fontWeight:800,color:"#4ade80",fontFamily:warrior,marginTop:3 }}>🏆 {arena.winGold} <img src="/img/coin.png" alt="" style={{ width:18,height:18,verticalAlign:"middle",filter:"drop-shadow(0 0 8px rgba(255,215,0,0.9))" }} /></div></div>
          </div>
          {infoOpen && <div style={{ background:"rgba(6,10,22,0.96)",border:`2px solid ${arena.color}`,borderTop:"none",borderRadius:"0 0 14px 14px",padding:"12px 18px",fontSize:12,color:t.text,fontFamily:mono,lineHeight:1.8,animation:"fadeUp 0.2s ease-out" }}>
            <div>💰 {L(lang,"arenaInfoEntry")(arena.entryFee)}</div>
            <div>🏆 {L(lang,"arenaInfoWin")(arena.winGold)}</div>
            <div>⭐ {L(lang,"arenaInfoXpBonus")}</div>
          </div>}
        </div>);
      })}
    </div>
    <button onClick={onBack} style={{ marginTop:24,padding:"14px 36px",background:`linear-gradient(135deg,${t.accent},#0891b2)`,color:t.bg,border:"none",borderRadius:10,fontSize:14,fontWeight:800,letterSpacing:3,cursor:"pointer",fontFamily:warrior,textTransform:"uppercase",boxShadow:`0 4px 20px ${t.accentGlow}` }}>{L(lang,"backBtn")}</button>
  </div>);
}

// === HIZLI EŞLEŞME (QUICK MATCH) MİNİ PENCERESİ ===
function QuickMatchCard({ label, name, avatar, gold, level, accent, flicker, lang = "tr" }) {
  return (<div style={{ display:"flex",flexDirection:"column",alignItems:"center",gap:6,width:112 }}>
    <div style={{ width:64,height:64,borderRadius:"50%",background:`${accent}22`,border:`2px solid ${accent}`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:30,boxShadow:`0 0 20px ${accent}55`,animation: flicker ? "qmFlicker 0.12s ease-out" : "qmSettle 0.5s cubic-bezier(0.34,1.56,0.64,1)" }}>{avatar || "⚓"}</div>
    <div style={{ fontSize:12,fontWeight:800,color:"#fff",fontFamily:warrior,letterSpacing:0.5,maxWidth:104,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",textAlign:"center" }}>{name}</div>
    {gold != null && <div style={{ display:"flex",alignItems:"center",gap:3,fontSize:11,color:t.gold,fontFamily:mono,fontWeight:700 }}>💰{gold}</div>}
    {level != null && level > 0 && <div style={{ fontSize:9,color:t.textDim,fontFamily:mono }}>{L(lang,"sevLabel")} {level}</div>}
    <div style={{ fontSize:8,color:t.textDim,fontFamily:mono,letterSpacing:2,opacity:0.7 }}>{label}</div>
  </div>);
}

function QuickMatchModal({ myProfile, lang, phase, candidate, opponent, secondsLeft, onCancel, onRetry }) {
  if (!phase) return null;
  const isFound = phase === "found", isNotFound = phase === "notfound", isInviting = phase === "inviting", isSearching = phase === "searching";
  const themeColor = isFound ? "#4ade80" : isNotFound ? t.hit : isInviting ? t.gold : t.accent;
  const themeGlow = isFound ? "rgba(74,222,128,0.4)" : isNotFound ? t.hitGlow : isInviting ? t.goldGlow : t.accentGlow;
  return (<div style={{ position:"fixed",inset:0,overflowX:"hidden",zIndex:9700,background:"rgba(2,6,16,0.82)",backdropFilter:"blur(6px)",display:"flex",alignItems:"center",justifyContent:"center",padding:16,animation:"settingsFadeIn 0.25s ease-out" }}>
    <div style={{ width:"100%",maxWidth:380,background:"linear-gradient(160deg, rgba(14,22,44,0.98), rgba(6,10,22,0.99))",border:`2px solid ${themeColor}`,borderRadius:22,padding:"26px 20px 22px",textAlign:"center",boxShadow:`0 0 70px ${themeGlow}, 0 20px 60px rgba(0,0,0,0.6)`,position:"relative",overflow:"hidden",animation:"scaleUp 0.35s cubic-bezier(0.34,1.56,0.64,1)" }}>
      {isSearching && <div style={{ position:"absolute",inset:0,background:"repeating-radial-gradient(circle at 50% 50%, transparent 0, transparent 30px, rgba(0,229,255,0.035) 31px)",animation:"radarSpin 3s linear infinite",pointerEvents:"none" }} />}
      <div style={{ fontSize:14,fontWeight:900,letterSpacing:3,fontFamily:warrior,color:themeColor,marginBottom:4,textShadow:`0 0 16px ${themeGlow}`,position:"relative" }}>
        {isFound ? L(lang,"quickFound") : isNotFound ? L(lang,"quickNotFound") : isInviting ? L(lang,"quickInviting") : L(lang,"quickSearching")}
      </div>
      {isSearching && <div style={{ fontSize:11,color:t.textDim,fontFamily:mono,marginBottom:16,position:"relative" }}>{L(lang,"quickScanning")} <span style={{ color:t.accent,fontWeight:800 }}>{secondsLeft}s</span></div>}
      {isInviting && <div style={{ fontSize:11,color:t.textDim,fontFamily:mono,marginBottom:16,position:"relative" }}><span style={{ fontWeight:800,color:t.gold }}>{candidate?.name}</span> {L(lang,"quickWaitingReply")} <span style={{ color:t.gold,fontWeight:800 }}>{secondsLeft}s</span></div>}
      {isFound && <div style={{ fontSize:11,color:t.textDim,fontFamily:mono,marginBottom:16,position:"relative" }}>{L(lang,"quickStarting")}</div>}
      {isNotFound && <div style={{ fontSize:11,color:t.textDim,fontFamily:mono,marginBottom:16,position:"relative" }}>{L(lang,"quickNoOpp")}</div>}

      {!isNotFound && <div style={{ display:"flex",alignItems:"center",justifyContent:"center",gap:6,marginBottom:8,position:"relative" }}>
        <QuickMatchCard label={L(lang,"you")} name={myProfile?.displayName || L(lang,"you")} avatar={myProfile?.avatar} gold={safeGold(myProfile?.gold)} accent={t.accent} flicker={false} lang={lang} />
        <div style={{ fontSize:22,fontWeight:900,color:t.gold,fontFamily:warrior,textShadow:`0 0 20px ${t.goldGlow}`,animation:"qmVsPulse 1s ease-in-out infinite" }}>VS</div>
        {isFound
          ? <QuickMatchCard key="opp" label={L(lang,"opponent")} name={opponent?.name} avatar={opponent?.avatar} gold={opponent?.gold} level={opponent?.level} accent="#4ade80" flicker={false} lang={lang} />
          : isInviting
          ? <QuickMatchCard key="invite-target" label={L(lang,"ready")} name={candidate?.name} avatar={candidate?.avatar} gold={candidate?.gold} accent={t.gold} flicker={false} lang={lang} />
          : <QuickMatchCard key={candidate?.key || "c0"} label="?" name={candidate?.name || "..."} avatar={candidate?.avatar} gold={candidate?.gold} accent={t.textDim} flicker={true} lang={lang} />}
      </div>}

      {isNotFound && <div style={{ fontSize:44,margin:"4px 0 16px",position:"relative" }}>🧭</div>}

      {(isSearching || isInviting) && <div style={{ width:"100%",height:6,borderRadius:3,background:"rgba(255,255,255,0.08)",overflow:"hidden",marginTop:4,marginBottom:16,position:"relative" }}>
        <div style={{ width:`${(secondsLeft / (isInviting ? 10 : 30)) * 100}%`,height:"100%",background:isInviting?`linear-gradient(90deg,${t.gold},#d97706)`:`linear-gradient(90deg,${t.accent},#0891b2)`,transition:"width 0.25s linear" }} />
      </div>}

      <div style={{ display:"flex",gap:10,justifyContent:"center",marginTop:4,position:"relative" }}>
        {isNotFound ? (<>
          <button onClick={onRetry} style={{ padding:"12px 26px",background:`linear-gradient(135deg,${t.accent},#0891b2)`,color:t.bg,border:"none",borderRadius:12,fontSize:13,fontWeight:900,letterSpacing:2,cursor:"pointer",fontFamily:warrior,boxShadow:`0 0 24px ${t.accentGlow}` }}>{L(lang,"retrySearch")}</button>
          <button onClick={onCancel} style={{ padding:"12px 18px",background:"transparent",color:t.textDim,border:`1px solid ${t.border}`,borderRadius:12,fontSize:12,fontWeight:700,cursor:"pointer",fontFamily:warrior }}>{L(lang,"giveUp")}</button>
        </>) : (isSearching || isInviting) ? (
          <button onClick={onCancel} style={{ padding:"9px 22px",background:"transparent",color:t.hit,border:`1px solid ${t.hit}`,borderRadius:10,fontSize:11,fontWeight:700,letterSpacing:1,cursor:"pointer",fontFamily:warrior }}>{L(lang,"cancelBtn")}</button>
        ) : null}
      </div>
    </div>
  </div>);
}

function EmojiDisplay({ emoji, label }) {
  if (!emoji) return null;
  return (<div style={{ fontSize:9,color:t.textDim,marginTop:2,display:"flex",alignItems:"center",gap:4,justifyContent:"center",animation:"fadeUp 0.3s ease-out" }}>
    <span style={{ fontSize:16 }}>{emoji}</span>
    <span style={{ fontFamily:"'Barlow Condensed',sans-serif",letterSpacing:1 }}>{label}</span>
  </div>);
}

// === AYARLAR PANELİ — stil yardımcıları ve alt bileşenler ===
const rowBtnStyle = { display:"flex",alignItems:"center",gap:12,width:"100%",padding:"14px 14px",background:"rgba(255,255,255,0.04)",border:`1px solid ${t.border}`,borderRadius:12,marginBottom:10,cursor:"pointer",textAlign:"left",color:t.text };
const rowIconStyle = { fontSize:20,width:28,textAlign:"center",flexShrink:0 };
const rowTitleStyle = { fontSize:14,fontWeight:800,color:t.text,fontFamily:warrior,letterSpacing:0.5 };
const rowSubStyle = { fontSize:11,color:t.textDim,fontFamily:mono,marginTop:2 };
const chevronStyle = { fontSize:20,color:t.textDim,flexShrink:0 };
const sectionCardStyle = { padding:"14px 14px",background:"rgba(255,255,255,0.04)",border:`1px solid ${t.border}`,borderRadius:12,marginBottom:10 };
const sliderStyle = { width:"100%",accentColor:t.accent,cursor:"pointer" };
const langBtnStyle = (active) => ({ flex:1,padding:"10px 0",borderRadius:9,border:`1px solid ${active?t.accent:t.border}`,background:active?"rgba(0,229,255,0.14)":"rgba(255,255,255,0.03)",color:active?t.accent:t.textDim,fontFamily:warrior,fontWeight:800,fontSize:12,cursor:"pointer" });

function ToggleRow({ icon, title, sub, value, onChange }) {
  return (<div style={sectionCardStyle}>
    <div style={{ display:"flex",alignItems:"center",gap:10 }}>
      <span style={rowIconStyle}>{icon}</span>
      <div style={{ flex:1 }}>
        <div style={rowTitleStyle}>{title}</div>
        {sub && <div style={rowSubStyle}>{sub}</div>}
      </div>
      <button onClick={()=>onChange(!value)} style={{ width:46,height:26,borderRadius:13,border:"none",cursor:"pointer",padding:2,background:value?"linear-gradient(135deg,#00e5ff,#0891b2)":"rgba(255,255,255,0.12)",transition:"background 0.2s ease",display:"flex",justifyContent:value?"flex-end":"flex-start",flexShrink:0 }}>
        <div style={{ width:22,height:22,borderRadius:"50%",background:"#fff",boxShadow:"0 2px 4px rgba(0,0,0,0.4)" }} />
      </button>
    </div>
  </div>);
}

function BackHeader({ title, onBack }) {
  return (<div style={{ display:"flex",alignItems:"center",gap:10,marginBottom:16 }}>
    <button onClick={onBack} style={{ width:32,height:32,borderRadius:8,background:"rgba(255,255,255,0.06)",border:`1px solid ${t.border}`,color:t.text,fontSize:16,cursor:"pointer" }}>‹</button>
    <div style={{ fontSize:16,fontWeight:900,color:t.text,fontFamily:warrior,letterSpacing:1 }}>{title}</div>
  </div>);
}

function StatBox({ label, value, color }) {
  return (<div style={{ background:"rgba(255,255,255,0.04)",border:`1px solid ${t.border}`,borderRadius:12,padding:"14px 10px",textAlign:"center" }}>
    <div style={{ fontSize:22,fontWeight:900,color:color||t.text,fontFamily:warrior }}>{value}</div>
    <div style={{ fontSize:9,color:t.textDim,fontFamily:mono,letterSpacing:1.5,marginTop:4 }}>{label}</div>
  </div>);
}

const PRIVACY_TEXT = `GİZLİLİK POLİTİKASI

Son güncelleme: Temmuz 2026

1. TOPLANAN VERİLER
Amiral Battı; görüntü adın, anonim bir cihaz/kullanıcı kimliği, seçtiğin profil simgesi veya yüklediğin profil fotoğrafı, oyun istatistiklerin (galibiyet, mağlubiyet, toplam oyun, altın, seviye) ve oyun içi tercihlerini (müzik/ses ayarları, dil) saklar. Gerçek adın, adresin veya ödeme bilgisi talep edilmez; oyun içi altının gerçek para karşılığı yoktur.

2. VERİLERİN KULLANIM AMACI
Bu veriler yalnızca oyun deneyimini sağlamak, skor tablosunu ve rütbeni göstermek, rakip eşleştirmesi yapmak ve günlük ödülleri yönetmek için kullanılır.

3. ÜÇÜNCÜ TARAF ALTYAPISI
Verilerin barındırılması ve kimlik doğrulaması için Google Firebase altyapısı kullanılır. Verilerin başka bir üçüncü tarafla ticari amaçla paylaşılması söz konusu değildir.

4. KULLANIM ANALİTİĞİ
Oyunu geliştirebilmek için Google Analytics for Firebase kullanılır. Bu araç; yaklaşık konum bilgisi (ülke/şehir düzeyinde, açık adres değil), cihaz modeli ve işletim sistemi, uygulama sürümü, oturum süresi ile hangi ekranların görüntülendiği ve kaç maç oynandığı gibi kullanım olaylarını toplar. Bu veriler anonim bir kimlikle ilişkilendirilir; adın, e-postan, telefon numaran veya tam konumun toplanmaz ve reklam amacıyla kullanılmaz. Analitik verileri Google tarafından 14 ay saklanır. Cihazının ayarlarından reklam kimliğini sıfırlayarak veya izleme engelleyici kullanarak bu toplamayı sınırlayabilirsin.

5. YEREL DEPOLAMA
Cihazında yalnızca ses/müzik tercihleri ve günlük ödül takibi gibi teknik ayarlar saklanır.

6. HAKLARIN (KVKK & GDPR)
KVKK'nın 11. maddesi ve GDPR kapsamında; verilerine erişme, düzeltme, taşınabilirlik talep etme ve verilerinin silinmesini isteme hakkına sahipsin. Ayarlar > Hesabımı/Verilerimi Sil yolunu kullanarak verilerini kalıcı olarak silebilir, ya da ozdenilim@gmail.com adresinden talepte bulunabilirsin.

7. YAŞ SINIRI
Oyun genel kitleye uygundur. 13 yaş altındaki kullanıcıların ebeveyn gözetiminde oynaması önerilir.

KULLANIM KOŞULLARI

1. Kullanıcılar birbirine saygılı davranmalı; hakaret, argo veya taciz içeren kullanıcı adları ve mesajlar yasaktır.
2. Hesabın ve cihazının güvenliğinden kullanıcı sorumludur.
3. Oyun içi altın ve rütbeler yalnızca eğlence amaçlıdır, gerçek para değeri taşımaz ve nakde çevrilemez.
4. Hizmet "olduğu gibi" sunulur; sunucu bakımı veya bağlantı sorunları nedeniyle geçici kesintiler yaşanabilir.
5. Bu koşullar önceden haber verilmeksizin güncellenebilir; güncel sürüm her zaman bu ekranda yer alır.

İletişim: ozdenilim@gmail.com`;

const PRIVACY_TEXT_EN = `PRIVACY POLICY

Last updated: July 2026

1. DATA WE COLLECT
Amiral Battı stores your display name, an anonymous device/user ID, the avatar or photo you choose, your game statistics (wins, losses, total games, gold, level), and your in-app preferences (music/sound settings, language). We never ask for your real name, address, or payment details; in-game gold has no real-world monetary value.

2. HOW WE USE YOUR DATA
This data is used only to provide the game experience: showing your score and rank, matching you with opponents, and managing daily rewards.

3. THIRD-PARTY INFRASTRUCTURE
We use Google Firebase for hosting and authentication. Your data is never sold or shared with third parties for commercial purposes.

4. USAGE ANALYTICS
We use Google Analytics for Firebase to improve the game. It collects approximate location (country/city level, not your exact address), device model and operating system, app version, session duration, and usage events such as which screens you view and how many matches you play. This data is tied to an anonymous identifier; we do not collect your name, e-mail, phone number or precise location, and it is never used for advertising. Analytics data is retained by Google for 14 months. You can limit this collection by resetting your advertising ID in your device settings or by using a tracking blocker.

5. LOCAL STORAGE
Your device only stores technical settings such as sound/music preferences and daily reward tracking.

6. YOUR RIGHTS (KVKK & GDPR)
Under Turkey's KVKK Article 11 and GDPR, you have the right to access, correct, port, and request deletion of your data. Use Settings > Delete My Account/Data to permanently erase your data, or contact ozdenilim@gmail.com.

7. AGE
The game is suitable for a general audience. Players under 13 are encouraged to play under parental supervision.

TERMS OF USE

1. Players must treat each other respectfully; usernames or messages containing insults, profanity, or harassment are prohibited.
2. You are responsible for the security of your account and device.
3. In-game gold and ranks are for entertainment only, have no real monetary value, and cannot be cashed out.
4. The service is provided "as is"; temporary interruptions may occur due to server maintenance or connectivity issues.
5. These terms may be updated without prior notice; the current version is always available on this screen.

Contact: ozdenilim@gmail.com`;

async function ensureProfile(uid, displayName) {
  const profileRef = ref(db, `profiles/${uid}`);
  const snap = await get(profileRef);
  if (!snap.exists()) {
    const startGold = isTestMode() ? 5000 : STARTING_GOLD;
    const profile = { displayName: displayName||"Denizci", wins:0, losses:0, totalGames:0, botGames:0, onlineGames:0, gold:startGold, honor:0, level:0, levelProgress:0, loginStreak:0, lastDailyReward:null, createdAt:Date.now(), lastGameAt:null, onboardingDone:false, recentResults:[], ach:{ ...ACH_DEFAULT }, achievClaimed:{}, voyage:{ lastClaim:Date.now(), dayKey:"", matches:0 }, daily:{ ...DAILY_DEFAULT, dayKey:todayKey() } };
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
    botGames: (typeof existing.botGames === "number" && isFinite(existing.botGames)) ? existing.botGames : 0,
    onlineGames: (typeof existing.onlineGames === "number" && isFinite(existing.onlineGames)) ? existing.onlineGames : 0,
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
    recentResults: safeRecent(existing.recentResults),
    ach: safeAch(existing.ach),
    achievClaimed: safeClaimed(existing.achievClaimed),
    honor: migrateHonor(existing),
    voyage: safeVoyage(existing.voyage),
    daily: safeDaily(existing.daily),
  };
  // ALWAYS overwrite with set() — kills any hidden NaN in any field
  await set(profileRef, sanitized);
  return sanitized;
}

// === ONLINE MAÇ SONUCU — HER OYUNCU KENDİ PROFİLİNİ YAZAR ===
// Firebase kuralları başkasının profiline yazmayı engeller (auth.uid === $uid). Eskiden kazanan
// her iki profili birden yazmaya çalışıyor, izin hatası zinciri koparıyor ve ödüller hiç işlenmiyordu.
async function applyOnlineResultSelf(uid, isWinner, arena, achMutator) {
  try {
    const snap = await get(ref(db, `profiles/${uid}`));
    if (!snap.exists()) return null;
    const p = snap.val();
    const a = safeAch(p.ach);
    const rev = isWinner ? revengeMult(a.lossStreak) : 1;
    const baseXp = arena ? XP_ONLINE_WIN * 1.1 : XP_ONLINE_WIN;
    const gold = isWinner ? Math.round((arena ? arena.winGold : 100) * rev) : (arena ? arena.entryFee : 0);
    const xp = isWinner ? baseXp * rev : baseXp * 0.25;
    const lvl = applyLevelCredit(p, xp);
    const oldGold = safeGold(p.gold), newGold = oldGold + gold;
    a.goldEarned += gold;
    if (isWinner) { a.onlineWins += 1; a.winStreak += 1; a.bestWinStreak = Math.max(a.bestWinStreak, a.winStreak); a.lossStreak = 0; }
    else { a.winStreak = 0; a.turnStreak = 0; a.lossStreak = (a.lossStreak || 0) + 1; }
    try { if (achMutator) achMutator(a); } catch (e) {}
    const upd = {
      gold: newGold,
      wins: (p.wins || 0) + (isWinner ? 1 : 0),
      losses: (p.losses || 0) + (isWinner ? 0 : 1),
      totalGames: (p.totalGames || 0) + 1,
      onlineGames: (p.onlineGames || 0) + 1,
      level: lvl.level, levelProgress: lvl.levelProgress,
      lastGameAt: Date.now(),
      recentResults: pushRecent(p.recentResults, isWinner),
      honor: migrateHonor(p) + (isWinner ? HONOR_WIN_ONLINE : HONOR_LOSS_ONLINE),
      ach: a,
    };
    await update(ref(db, `profiles/${uid}`), upd);
    return { ...upd, oldGold, gold, xp, rev };
  } catch (e) { console.error("applyOnlineResultSelf error:", e); return null; }
}

function Leaderboard({ onBack, myUid, lang = "tr" }) {
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
    if (myIdx === 0) return L(lang,"motivTop1");
    if (myIdx > 0 && myIdx < 3) return L(lang,"motivTop3");
    if (myIdx >= 3 && myIdx < 10) return L(lang,"motivTop10");
    return L(lang,"motivDefault");
  };
  const tabs = [
    { key:'gold', label:L(lang,"tabGold"), icon:'🪙' },
    { key:'wins', label:L(lang,"tabWins"), icon:'🏆' },
  ];
  return (<div style={{ display:"flex",flexDirection:"column",alignItems:"center",minHeight:"100vh",minHeight:"100dvh",background:`linear-gradient(180deg, ${t.bg} 0%, #071428 50%, rgba(255,215,0,0.02) 100%)`,padding:"20px 12px",fontFamily:mono,color:t.text }}>
    <div style={{ fontSize:30,fontWeight:900,letterSpacing:8,color:t.gold,marginBottom:2,fontFamily:warrior,textShadow:`0 0 30px ${t.goldGlow}`,animation:"fadeUp 0.4s ease-out" }}>{L(lang,"leaderboardTitle")}</div>
    {!loading && myIdx >= 0 && <div style={{ padding:"6px 18px",background:"rgba(0,229,255,0.06)",border:`1px solid rgba(0,229,255,0.15)`,borderRadius:10,marginBottom:10,animation:"fadeUp 0.6s ease-out" }}>
      <div style={{ fontSize:12,fontWeight:800,color:t.accent,fontFamily:warrior,letterSpacing:2,textAlign:"center" }}>{getMotivation()}</div>
    </div>}
    {/* Sort tabs */}
    <div style={{ display:"flex",gap:4,marginBottom:14,background:t.surface,borderRadius:12,padding:4,border:`1px solid ${t.border}` }}>
      {tabs.map(tab => (
        <button key={tab.key} onClick={()=>setSortBy(tab.key)} style={{ padding:"8px 14px",background:sortBy===tab.key?`linear-gradient(135deg,${t.accent},#0891b2)`:"transparent",color:sortBy===tab.key?t.bg:t.textDim,border:"none",borderRadius:8,fontSize:11,fontWeight:800,cursor:"pointer",fontFamily:warrior,letterSpacing:2,transition:"all 0.2s" }}>{tab.icon} {tab.label}</button>
      ))}
    </div>
    {loading ? <div style={{ color:t.textDim,fontSize:14,marginTop:40,fontFamily:warrior,letterSpacing:3,animation:"pulse 1.5s infinite" }}>{L(lang,"loadingText")}</div> : players.length===0 ? <div style={{ color:t.textDim,fontSize:14,marginTop:40,fontFamily:warrior }}>{L(lang,"noPlayersYet")}</div> : (
      <div style={{ width:"100%",maxWidth:400,display:"flex",flexDirection:"column",gap:6 }}>
        {players.slice(0,15).map((p,i) => {
          if (i >= revealed) return null;
          const rank = getRankInfo(p.honor||0, lang), isMe = p.uid===myUid;
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
              {sortBy==='wins' && <><div style={{ fontSize:22,fontWeight:900,color:"#4ade80",fontFamily:warrior }}>{p.wins||0}</div><div style={{ fontSize:8,color:t.textDim,letterSpacing:2,fontWeight:700 }}>{L(lang,"tabWins")}</div></>}
              {sortBy==='gold' && <><div style={{ fontSize:22,fontWeight:900,color:t.gold,fontFamily:warrior,textShadow:`0 0 10px ${t.goldGlow}` }}>{p.gold||0}</div><div style={{ fontSize:8,color:t.textDim,letterSpacing:2,fontWeight:700 }}>{L(lang,"tabGold")}</div></>}
            </div>
          </div>);
        })}
      </div>
    )}
    <button onClick={onBack} style={{ marginTop:20,padding:"14px 40px",background:`linear-gradient(135deg,${t.accent},#0891b2)`,color:t.bg,border:"none",borderRadius:12,fontSize:15,fontWeight:800,letterSpacing:4,cursor:"pointer",fontFamily:warrior,boxShadow:`0 4px 20px ${t.accentGlow}` }}>{L(lang,"backBtn")}</button>
  </div>);
}

const ANIMS = `
.ab-cell{transition:transform 0.15s cubic-bezier(0.34,1.56,0.64,1), filter 0.15s ease, box-shadow 0.15s ease;}
@media (hover:hover){ .ab-cell:hover{transform:scale(1.12);filter:brightness(1.25);z-index:5;box-shadow:0 0 10px rgba(0,229,255,0.5);} }
.ab-cell:active{transform:scale(0.92);filter:brightness(1.15);}
@keyframes blink3s{0%,100%{opacity:1}50%{opacity:.6}}
@keyframes pulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.4;transform:scale(.8)}}
@keyframes borderGlow{0%,100%{border-color:#00d4ff;box-shadow:0 0 8px rgba(0,212,255,.4)}50%{border-color:#38f0ff;box-shadow:0 0 24px rgba(0,212,255,.7)}}
@keyframes chestGlow{0%,100%{box-shadow:0 0 40px #ffe94d, 0 0 90px rgba(255,233,77,0.75), 0 0 150px rgba(255,233,77,0.4), 0 24px 70px rgba(0,0,0,0.6)}50%{box-shadow:0 0 60px #fff176, 0 0 130px rgba(255,233,77,0.95), 0 0 200px rgba(255,233,77,0.6), 0 24px 70px rgba(0,0,0,0.6)}}
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
@keyframes scanline{0%{transform:translateY(-2px)}100%{transform:translateY(100vh)}}
@keyframes flameFlicker{0%,100%{transform:scale(1) rotate(-3deg);opacity:0.85}25%{transform:scale(1.15) rotate(4deg);opacity:1}50%{transform:scale(0.92) rotate(-5deg);opacity:0.8}75%{transform:scale(1.08) rotate(3deg);opacity:0.95}}
@keyframes turnPulse{0%,100%{box-shadow:0 0 12px rgba(0,229,255,0.4), inset 0 0 8px rgba(0,229,255,0.1)}50%{box-shadow:0 0 30px rgba(0,229,255,0.8), inset 0 0 16px rgba(0,229,255,0.25)}}
@keyframes emojiFly3d{0%{opacity:0;transform:translate(-50%,-50%) scale(0.2) rotateY(120deg) rotateZ(-20deg)}18%{opacity:1;transform:translate(-50%,-50%) scale(1.5) rotateY(-12deg) rotateZ(6deg)}30%{transform:translate(-50%,-50%) scale(1.15) rotateY(0deg) rotateZ(0deg)}75%{opacity:1;transform:translate(-50%,-50%) scale(1.15)}100%{opacity:0;transform:translate(-50%,-58%) scale(0.85)}}
@keyframes raysSpin{from{transform:translate(-50%,-50%) rotate(0deg)}to{transform:translate(-50%,-50%) rotate(360deg)}}
@keyframes coinRise{0%{transform:translateY(0) rotate(0deg);opacity:0}12%{opacity:0.55}85%{opacity:0.35}100%{transform:translateY(-64vh) rotate(340deg);opacity:0}}
@keyframes coinFall{0%{transform:translateY(0) rotate(0deg);opacity:0}10%{opacity:1}90%{opacity:0.9}100%{transform:translateY(88vh) rotate(360deg);opacity:0}}
@keyframes smokeRise{0%{transform:translateY(0) scale(0.6);opacity:0}25%{opacity:0.7}100%{transform:translateY(-46px) scale(1.3);opacity:0}}
@keyframes chestBounceIn{0%{opacity:0;transform:scale(0.4) translateY(60px)}60%{opacity:1;transform:scale(1.06) translateY(-8px)}100%{opacity:1;transform:scale(1) translateY(0)}}
@keyframes chestWiggle{0%,100%{transform:rotate(0deg) scale(1)}8%{transform:rotate(-7deg) scale(1.05)}16%{transform:rotate(6deg) scale(1.05)}24%{transform:rotate(-4deg)}32%{transform:rotate(0deg) scale(1)}}
@keyframes shineSweep{0%{left:-60%}55%{left:120%}100%{left:120%}}
@keyframes rewardPulse{0%,100%{transform:scale(1)}50%{transform:scale(1.06)}}
@keyframes btnBreath{0%,100%{transform:scale(1)}50%{transform:scale(1.045)}}
@keyframes sonarArc{0%,100%{opacity:0.35;transform:scale(1)}50%{opacity:1;transform:scale(1.18)}}
@keyframes arZoomText{0%{opacity:0;transform:translateX(-50%) scale(0.2)}8%{opacity:1;transform:translateX(-50%) scale(1.05)}12%{transform:translateX(-50%) scale(1)}70%{opacity:1;transform:translateX(-50%) scale(1)}100%{opacity:0;transform:translateX(-50%) translateY(-40px) scale(2.6);filter:blur(3px)}}
@keyframes feedbackHoldRise{0%{opacity:1;transform:translateX(-50%) translateY(0) scale(1)}71%{opacity:1;transform:translateX(-50%) translateY(0) scale(1)}100%{opacity:0;transform:translateX(-50%) translateY(-14px) scale(0.5);filter:blur(3px)}}
@keyframes popFlash{0%{opacity:0;transform:translateX(-50%) scale(0.1) rotate(-8deg)}22%{opacity:1;transform:translateX(-50%) scale(1.45) rotate(4deg)}38%{transform:translateX(-50%) scale(1.05) rotate(0deg)}72%{opacity:1;transform:translateX(-50%) scale(1.05)}100%{opacity:0;transform:translateX(-50%) scale(0.7) translateY(-16px)}}
@keyframes fbPop3d{0%{opacity:0;transform:translateX(-50%) scale(0.3) perspective(500px) rotateX(40deg)}12%{opacity:1;transform:translateX(-50%) scale(1.25) perspective(500px) rotateX(-6deg)}22%{transform:translateX(-50%) scale(1) perspective(500px) rotateX(0deg)}78%{opacity:1;transform:translateX(-50%) scale(1) translateY(0)}100%{opacity:0;transform:translateX(-50%) scale(0.92) translateY(-30px)}}
@keyframes floatShadow{0%,100%{transform:translateY(0);filter:drop-shadow(0 8px 20px rgba(0,0,0,0.4))}50%{transform:translateY(-8px);filter:drop-shadow(0 16px 30px rgba(0,0,0,0.6))}}
@keyframes pageEnter{0%{opacity:0;transform:translateY(32px) scale(0.97)}60%{opacity:1;transform:translateY(-4px) scale(1.005)}100%{opacity:1;transform:translateY(0) scale(1)}}
@keyframes pageFadeIn{0%{opacity:0}100%{opacity:1}}
@keyframes tutCardEnter{0%{opacity:0;transform:translateY(40px) scale(0.95) perspective(800px) rotateX(8deg)}60%{opacity:1;transform:translateY(-6px) scale(1.02) perspective(800px) rotateX(-2deg)}100%{opacity:1;transform:translateY(0) scale(1) perspective(800px) rotateX(0deg)}}
@keyframes sheetSlideUp{0%{opacity:0;transform:translateY(40px)}100%{opacity:1;transform:translateY(0)}}
@keyframes qmFlicker{0%{opacity:0;transform:scale(0.7)}50%{opacity:1;transform:scale(1.1)}100%{opacity:1;transform:scale(1)}}
@keyframes qmSettle{0%{transform:scale(0.5) rotate(-15deg);opacity:0}60%{transform:scale(1.15) rotate(5deg);opacity:1}100%{transform:scale(1) rotate(0deg);opacity:1}}
@keyframes qmVsPulse{0%,100%{transform:scale(1);opacity:0.85}50%{transform:scale(1.25);opacity:1}}
@keyframes radarSpin{0%{transform:rotate(0deg)}100%{transform:rotate(360deg)}}
@keyframes settingsFadeIn{0%{opacity:0}100%{opacity:1}}

/* ═══════════════════════════════════════════════════════════════════
   MOBİL PERFORMANS KATMANI — en sonda tanımlı, öncekileri EZER.
   Kural: her karede sadece transform ve opacity değişsin. box-shadow,
   filter, text-shadow, left/top gibi özellikleri sürekli animasyona
   sokmak mobil GPU'da yeniden boyama (repaint) yaratır = takılma.
   ═══════════════════════════════════════════════════════════════════ */

/* 1) LAYOUT TETİKLEYEN parlama süpürmeleri → transform'a çevrildi.
   Eskiden "left" animasyonuydu; her karede sayfa yerleşimi yeniden
   hesaplanıyordu. Görsel aynı, maliyet neredeyse sıfır. */
@keyframes shimmerPass{0%{transform:translate3d(0,0,0)}100%{transform:translate3d(600%,0,0)}}
@keyframes dmShine{0%{transform:translate3d(0,0,0)}100%{transform:translate3d(500%,0,0)}}

/* 2) SÜREKLİ box-shadow/filter nabızları durduruldu. Elemanların kendi
   sabit gölgeleri (inline stil) yerinde kalır — parlaklık korunur,
   kare kare yeniden boyama biter. */
@keyframes borderGlow{0%,100%{opacity:1}}
@keyframes chestGlow{0%,100%{opacity:1}}
@keyframes rankGlow{0%,100%{opacity:1}}
@keyframes arGlow{0%,100%{opacity:1}}
@keyframes turnPulse{0%,100%{opacity:1}}
@keyframes achGlow{0%,100%{opacity:1}}
@keyframes demoWin{0%,100%{opacity:1}}
@keyframes shotWin{0%,100%{opacity:1}}
@keyframes markWin{0%,100%{opacity:1}}
@keyframes markDash{0%,100%{opacity:1}}
@keyframes dmReady{0%,100%{opacity:1}}
@keyframes cellHover{0%,100%{opacity:1}}
@keyframes victoryGlow{0%,100%{opacity:1}}

/* 3) Nabız efektleri sadece transform/opacity ile — bunlar GPU'da
   bileşimlenir, bedava sayılır. */
@keyframes achBtnPulse{0%,100%{transform:scale(1)}50%{transform:scale(1.03)}}
@keyframes btnBreath{0%,100%{transform:scale(1)}50%{transform:scale(1.02)}}
@keyframes rewardPulse{0%,100%{transform:scale(1)}50%{transform:scale(1.06)}}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.55}}

/* 4) Hareketli katmanlara GPU ipucu — tarayıcı önceden katman ayırır,
   böylece hareket sırasında yeniden boyama yapmaz. */
.gpu{will-change:transform;transform:translateZ(0);backface-visibility:hidden}

/* 5) Tahta ve kart gibi büyük kutular kendi boyama alanına hapsedilir;
   içeride bir hücre değişince tüm ekran yeniden boyanmaz. */
.paint-box{contain:layout paint style}
`;

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
  return (<div className="paint-box" style={{ background:`linear-gradient(135deg,${t.surfaceLight} 0%,${t.surface} 100%)`,border:"1px solid rgba(0,229,255,0.3)",borderRadius:10,padding:4,overflow:"hidden",boxShadow:"0 4px 20px rgba(0,0,0,0.4),inset 0 1px 0 rgba(255,255,255,0.06)" }}>
    <div style={{ display:"flex" }}><div style={{ width:cellSize,height:cellSize }} />{board[0]?.map((_,i) => <div key={i} style={{ width:cellSize,height:cellSize,display:"flex",alignItems:"center",justifyContent:"center",fontSize:cellSize>30?13:11,fontWeight:900,color:t.text,fontFamily:warrior,letterSpacing:1,textShadow:"0 1px 2px rgba(0,0,0,0.6)" }}>{COL_LABELS[i]||""}</div>)}</div>
    {board.map((row,r) => (<div key={r} style={{ display:"flex" }}><div style={{ width:cellSize,height:cellSize,display:"flex",alignItems:"center",justifyContent:"center",fontSize:cellSize>30?13:11,fontWeight:900,color:t.text,fontFamily:warrior,textShadow:"0 1px 2px rgba(0,0,0,0.6)" }}>{r+1}</div>
      {row.map((val,c) => {
        const ovr=overlay?.[r]?.[c], isHov=hoverCells?.some(([hr,hc])=>hr===r&&hc===c), shipColor=shipColors?.[r]?.[c], isBlink=blinkCells?.some(([br,bc])=>br===r&&bc===c), isManual=manualMarks?.[r]?.[c], isRipple=rippleCell===`${r},${c}`;
        let bg=t.water,content="",shadow="none",clr=t.textDim;
        if(isDefense){
          if(val>0&&shipColor)bg=shipColor;else if(val>0)bg=t.shipCell;
          if(ovr==="hit"){bg="#1a0505";content=(<span style={{position:"absolute",inset:0,display:"block",pointerEvents:"none"}}>
          <span style={{position:"absolute",inset:0,background:"radial-gradient(circle at 50% 50%, rgba(255,235,120,0.95) 0%, rgba(255,150,30,0.9) 22%, rgba(220,50,10,0.85) 45%, rgba(80,10,5,0.9) 70%, rgba(10,2,2,0.95) 100%)",animation:"explodeCore 1.1s ease-in-out 3"}} />
          </span>);shadow="inset 0 0 14px rgba(255,90,20,0.6)";clr="#fff";}
          else if(ovr==="miss"){bg=t.miss;content="•";}
          // showShipStatus: savaş haritasında vurulan gemi hücreleri farklı gösterilir
          else if(showShipStatus&&val>0&&shipColor){bg=shipColor;content="■";clr="rgba(255,255,255,0.6)";}
        }
        else{if(ovr==="hit"){bg="#1a0505";content=(<span style={{position:"absolute",inset:0,display:"block",pointerEvents:"none"}}>
          <span style={{position:"absolute",inset:0,background:"radial-gradient(circle at 50% 50%, rgba(255,235,120,0.95) 0%, rgba(255,150,30,0.9) 22%, rgba(220,50,10,0.85) 45%, rgba(80,10,5,0.9) 70%, rgba(10,2,2,0.95) 100%)",animation:"explodeCore 1.1s ease-in-out 3"}} />
          </span>);shadow="inset 0 0 14px rgba(255,90,20,0.6)";clr="#fff";}else if(ovr==="miss"){bg=t.miss;content="•";}else if(ovr==="sunk"){bg="#0d0303";content=(<span style={{position:"absolute",inset:0,display:"block",pointerEvents:"none"}}>
          <span style={{position:"absolute",inset:0,background:"radial-gradient(circle at 50% 55%, rgba(255,190,80,0.85) 0%, rgba(230,90,15,0.85) 28%, rgba(140,25,8,0.9) 55%, rgba(30,5,3,0.96) 85%)",animation:"explodeCore 1.5s ease-in-out 3"}} />
          <span style={{position:"absolute",top:"50%",left:"50%",transform:"translate(-50%,-50%)",fontSize:"0.95em",fontWeight:900,color:"#fff",textShadow:"0 0 8px rgba(0,0,0,1), 0 0 4px rgba(0,0,0,1)"}}>✕</span>
        </span>);shadow="inset 0 0 16px rgba(180,50,10,0.7)";clr="#fff";}else if(ovr==="selected"){bg="rgba(6,182,212,0.45)";content="◎";shadow=`inset 0 0 12px ${t.accentGlow}`;clr=t.accent;}if(!ovr&&isManual){bg="rgba(251,191,36,0.15)";content="⚑";clr=t.gold;}}
        if(isHov){bg="rgba(6,182,212,0.35)";shadow=`inset 0 0 10px ${t.accentGlow}`;}
        const isHint = onboardingHint?.some(([hr,hc])=>hr===r&&hc===c) && !ovr;
        if(isHint){bg="rgba(255,215,0,0.25)";shadow=`inset 0 0 12px ${t.goldGlow}, 0 0 8px ${t.goldGlow}`;content="◆";clr=t.gold;}
        return <div key={c} data-cell="1" data-r={r} data-c={c} className={disabled?"":"ab-cell"} onClick={()=>handleClick(r,c)} onMouseEnter={()=>onHover?.(r,c)} onContextMenu={e=>{e.preventDefault();onRightClick?.(r,c);}} onMouseDown={disabled?undefined:(e)=>onCellPointerDown?.(r,c,e)} onTouchStart={disabled?undefined:(e)=>{ if(onCellPointerDown){ onCellPointerDown(r,c,e); } else { handleTouchStart(r,c); } }} onTouchEnd={handleTouchEnd} onTouchCancel={handleTouchEnd} style={{ position:"relative",overflow:"hidden",width:cellSize,height:cellSize,border:"1px solid rgba(0,229,255,0.22)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:ovr==="sunk"?13:11,fontWeight:900,cursor:disabled?"default":"pointer",background:bg,boxShadow:shadow,color:clr,boxSizing:"border-box",transition:"background 0.15s ease, box-shadow 0.15s ease",animation:isBlink?"blink3s 0.5s ease-in-out 6":isRipple?"popIn 0.3s ease-out":"none",borderRadius:1,touchAction:onCellPointerDown?"none":"auto" }}>{content}</div>;
      })}</div>))}
  </div>);
}

// FİLO ŞERİDİ — tek satırda tüm donanma. Her gemi kendi renginde bloklardan oluşur;
// vurulan blok söner, gemi tamamen batınca üzeri çizilir. Ekranda sadece ~36px yer kaplar,
// böylece tahta hiç küçülmeden hangi geminin ne kadar kaldığı her an görünür.
function FleetBar({ title, ships, hitCells, color, lang = "tr" }) {
  if (!ships) return null;
  const list = Object.values(ships);
  const sunkCount = list.filter(s => { const c = s.cells || []; return c.length > 0 && c.every(([r, cc]) => hitCells?.[r]?.[cc]); }).length;
  return (
    <div style={{ width:"100%",maxWidth:400,marginTop:5,padding:"6px 9px",borderRadius:10,background:"linear-gradient(145deg, rgba(12,21,41,0.95), rgba(8,14,30,0.98))",border:`1px solid ${color===t.hit?"rgba(255,71,87,0.28)":"rgba(0,229,255,0.22)"}`,display:"flex",alignItems:"center",gap:8 }}>
      <span style={{ fontSize:9,fontWeight:900,color:t.textDim,fontFamily:warrior,letterSpacing:1.5,flexShrink:0 }}>{title}</span>
      <div style={{ flex:1,display:"flex",alignItems:"flex-start",gap:7,flexWrap:"wrap",rowGap:4 }}>
        {list.map((ship, i) => {
          const cells = ship.cells || [];
          const hits = cells.filter(([r, c]) => hitCells?.[r]?.[c]).length;
          const sunk = cells.length > 0 && hits === cells.length;
          const sd = SHIPS.find(x => x.id === ship.id);
          const base = sd?.color || t.accent;
          const isAdmiral = ship.id === "amiral";
          const S = 11, G = 2; // TÜM kutucuklar aynı boyut (11px), aralarında 2px
          // Amiral gerçek şekliyle çizilir: üstte 3, altta ortada 1 (T formu).
          // Diğer gemiler tek sıra. Hasar sırayla dolar (rakibin konumunu sızdırmaz).
          const layout = isAdmiral
            ? [{ r:0, c:0 }, { r:0, c:1 }, { r:0, c:2 }, { r:1, c:1 }]
            : cells.map((_, j) => ({ r:0, c:j }));
          const gw = (isAdmiral ? 3 : cells.length) * S + ((isAdmiral ? 3 : cells.length) - 1) * G;
          const gh = (isAdmiral ? 2 : 1) * S + (isAdmiral ? G : 0);
          // 3D kabartma kutucuk: üstten gelen ışık, iç parlaklık, alt gölge ve dış düşen gölge.
          // Vurulunca kararır ve üzerine İNCE çarpı gelir (çetele çizgisi kaldırıldı).
          const Block = ({ hit }) => (
            <span style={{ width:S,height:S,borderRadius:3.5,position:"relative",display:"inline-block",
              background: hit
                ? "linear-gradient(160deg, #3a3f47 0%, #23262b 45%, #14161a 100%)"
                : `linear-gradient(160deg, ${base} 0%, ${base} 42%, rgba(0,0,0,0.42) 100%)`,
              border: `1px solid ${hit ? "rgba(0,0,0,0.55)" : "rgba(0,0,0,0.45)"}`,
              boxShadow: hit
                ? "inset 0 1px 0 rgba(255,255,255,0.10), inset 0 -1px 2px rgba(0,0,0,0.6), 0 1px 1px rgba(0,0,0,0.5)"
                : "inset 0 1.5px 0 rgba(255,255,255,0.55), inset 0 -2px 3px rgba(0,0,0,0.35), 0 1px 2px rgba(0,0,0,0.55)",
              transition:"background 0.25s" }}>
              {/* Üst yüzeydeki cam parlaması */}
              {!hit && <span style={{ position:"absolute",top:1,left:1.5,right:1.5,height:"38%",borderRadius:"3px 3px 60% 60%",background:"linear-gradient(180deg, rgba(255,255,255,0.45), rgba(255,255,255,0.05))",pointerEvents:"none" }} />}
              {hit && (
                <svg viewBox="0 0 12 12" style={{ position:"absolute",inset:0,width:"100%",height:"100%" }}>
                  <path d="M3.2 3.2 L8.8 8.8 M8.8 3.2 L3.2 8.8" stroke="rgba(255,255,255,0.9)" strokeWidth="1.3" strokeLinecap="round" />
                </svg>
              )}
            </span>
          );
          return (
            <div key={i} title={(lang==="en"?sd?.nameEn:sd?.name)||""}
              style={{ position:"relative",width:gw,height:gh,flexShrink:0,
                alignSelf:isAdmiral?"center":"flex-start",marginTop:isAdmiral?0:S+G,
                opacity:sunk?0.55:1,transition:"opacity 0.3s" }}>
              {layout.map((pos, j) => (
                <span key={j} style={{ position:"absolute",left:pos.c*(S+G),top:pos.r*(S+G),lineHeight:0 }}>
                  <Block hit={j < hits} />
                </span>
              ))}
            </div>
          );
        })}
      </div>
      <span style={{ fontSize:11,fontWeight:900,color:sunkCount>0?t.sunk:t.textDim,fontFamily:mono,flexShrink:0 }}>{sunkCount}/{list.length}</span>
    </div>
  );
}

function ShipStatusPanel({ title, ships, hitCells, color, lang = "tr", compact = false }) {
  if(!ships)return null;
  const shipList = Object.values(ships);
  const totalShips = shipList.length;
  const sunkCount = shipList.filter(ship => { const cells=ship.cells||[]; const hits=cells.filter(([r,c])=>hitCells?.[r]?.[c]).length; return hits===cells.length&&cells.length>0; }).length;
  return (<div style={{ background:"linear-gradient(145deg, rgba(12,21,41,0.95), rgba(8,14,30,0.98))",border:`2px solid ${color==="rgba(255,71,87,0.55)"||color===t.hit?"rgba(255,71,87,0.25)":"rgba(0,229,255,0.2)"}`,borderRadius:12,padding:compact?"8px 12px":"14px 16px",marginTop:compact?5:8,boxShadow:"0 4px 20px rgba(0,0,0,0.3)" }}>
    <div style={{ display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:compact?5:8 }}>
      <div style={{ fontSize:15,letterSpacing:4,color:t.text,fontWeight:900,fontFamily:warrior,textTransform:"uppercase",textShadow:"0 1px 3px rgba(0,0,0,0.5)" }}>{title}</div>
      <div style={{ fontSize:12,fontWeight:800,color:sunkCount>0?t.sunk:t.textDim,fontFamily:mono,background:"rgba(255,255,255,0.04)",padding:"2px 8px",borderRadius:6 }}>{sunkCount}/{totalShips}</div>
    </div>
    <div style={{ display:"flex",flexWrap:"wrap",gap:8 }}>
      {shipList.map((ship,idx)=>{const shipDef=SHIPS.find(s=>s.id===ship.id);const cells=ship.cells||[];const hits=cells.filter(([r,c])=>hitCells?.[r]?.[c]).length;const sunk=hits===cells.length&&cells.length>0;return(<div key={idx} style={{ display:"flex",alignItems:"center",gap:6,padding:"4px 8px",background:sunk?"rgba(255,140,66,0.08)":"transparent",borderRadius:6,border:`1px solid ${sunk?"rgba(255,140,66,0.2)":"transparent"}` }}><span style={{ fontSize:13,fontWeight:900,color:sunk?t.sunk:t.text,textDecoration:sunk?"line-through":"none",fontFamily:warrior,letterSpacing:1 }}>{(lang==="en"?shipDef?.nameEn:shipDef?.name)||"?"}</span><div style={{ display:"flex",gap:2 }}>{cells.map((_,i)=><div key={i} style={{ width:10,height:10,borderRadius:3,background:i<hits?(sunk?t.sunk:t.hit):color||t.accent,opacity:i<hits?1:0.25,boxShadow:i<hits&&sunk?`0 0 4px ${t.sunk}`:i<hits?`0 0 4px ${t.hit}`:"none" }} />)}</div></div>);})}
    </div>
  </div>);
}

function MissionPanel({ missions, missionProgress, onClose, lang = "tr", compact = false }) {
  const completed = missions.filter(m => missionProgress[m.id]);
  const allDone = completed.length === 3;
  const progressPct = Math.round((completed.length / 3) * 100);
  return (<div style={ compact
    ? { background:`linear-gradient(145deg, rgba(12,21,41,0.98), rgba(8,14,30,0.99))`,padding:"12px 16px 10px",width:"100%" }
    : { background:`linear-gradient(145deg, rgba(12,21,41,0.98), rgba(8,14,30,0.99))`,border:`2px solid ${allDone?"#fbbf24":"rgba(0,229,255,0.25)"}`,borderRadius:16,padding:"20px 20px 16px",width:"100%",maxWidth:380,marginTop:12,boxShadow:allDone?`0 0 40px ${t.goldGlow}, inset 0 1px 0 rgba(255,215,0,0.1)`:`0 8px 32px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.04)`,animation:"fadeUp 0.4s ease-out" } }>
    {!compact && <div style={{ display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:14 }}>
      <div style={{ display:"flex",alignItems:"center",gap:8 }}>
        <div style={{ width:32,height:32,borderRadius:10,background:"rgba(0,229,255,0.1)",border:"1px solid rgba(0,229,255,0.2)",display:"flex",alignItems:"center",justifyContent:"center" }}><svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M12 2l3 6 7 1-5 5 1 7-6-3-6 3 1-7-5-5 7-1z" fill="rgba(0,229,255,0.3)" stroke="#00e5ff" strokeWidth="1.5" strokeLinejoin="round"/></svg></div>
        <div>
          <div style={{ fontSize:19,fontWeight:900,color:t.accent,fontFamily:warrior,letterSpacing:3,textShadow:`0 0 15px ${t.accentGlow}` }}>{L(lang,"missionsTitle")}</div>
          <div style={{ fontSize:12,fontWeight:800,color:t.textDim,fontFamily:mono,letterSpacing:1,marginTop:1 }}>{L(lang,"missionsSub")}</div>
        </div>
      </div>
      <div style={{ textAlign:"center",background:allDone?"rgba(255,215,0,0.15)":"rgba(0,229,255,0.08)",padding:"6px 14px",borderRadius:10,border:`1px solid ${allDone?"rgba(255,215,0,0.3)":"rgba(0,229,255,0.2)"}` }}>
        <div style={{ fontSize:19,fontWeight:900,color:allDone?t.gold:t.accent,fontFamily:mono }}>{completed.length}/3</div>
      </div>
    </div>}
    <div style={{ width:"100%",height:4,background:"rgba(255,255,255,0.06)",borderRadius:2,marginBottom:14,overflow:"hidden" }}>
      <div style={{ width:`${progressPct}%`,height:"100%",background:allDone?`linear-gradient(90deg,${t.gold},#f59e0b)`:`linear-gradient(90deg,${t.accent},#06b6d4)`,borderRadius:2,transition:"width 0.5s ease",boxShadow:allDone?`0 0 10px ${t.goldGlow}`:`0 0 8px ${t.accentGlow}` }} />
    </div>
    {missions.map((m, i) => {
      const done = missionProgress[m.id];
      return (<div key={m.id} style={{ display:"flex",alignItems:"center",gap:14,padding:"12px 14px",background:done?"linear-gradient(135deg, rgba(74,222,128,0.1), rgba(74,222,128,0.03))":"linear-gradient(135deg, rgba(255,255,255,0.03), rgba(255,255,255,0.01))",borderRadius:12,marginBottom:8,border:`2px solid ${done?"rgba(74,222,128,0.3)":"rgba(30,58,95,0.4)"}`,transition:"all 0.3s ease",boxShadow:done?"0 0 15px rgba(74,222,128,0.08)":"none" }}>
        <div style={{ flex:1,minWidth:0 }}>
          <div style={{ fontSize:16,fontWeight:900,color:done?"#4ade80":t.text,fontFamily:warrior,letterSpacing:1 }}>{lang==="en"?(m.textEn||m.text).toUpperCase():m.text.toLocaleUpperCase('tr-TR')}</div>
          <div style={{ fontSize:12,fontWeight:700,color:done?"rgba(74,222,128,0.8)":t.textDim,fontFamily:mono,letterSpacing:1,marginTop:2 }}>{done?L(lang,"missionDone"):L(lang,"missionInProgress")}</div>
        </div>
        {done ? <div style={{ width:30,height:30,borderRadius:10,background:"rgba(74,222,128,0.15)",display:"flex",alignItems:"center",justifyContent:"center",border:"2px solid rgba(74,222,128,0.3)" }}><svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M3 8l4 4 6-7" stroke="#4ade80" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/></svg></div> : <div style={{ width:30,height:30,borderRadius:10,background:"rgba(255,255,255,0.03)",display:"flex",alignItems:"center",justifyContent:"center",border:"1px solid rgba(255,255,255,0.06)" }}><div style={{ width:8,height:8,borderRadius:4,border:"2px solid rgba(255,255,255,0.15)" }} /></div>}
      </div>);
    })}
    {allDone && <div style={{ marginTop:10,padding:"12px 16px",background:"linear-gradient(135deg, rgba(255,215,0,0.12), rgba(255,215,0,0.03))",borderRadius:12,border:"2px solid rgba(255,215,0,0.25)",textAlign:"center" }}><div style={{ fontSize:15,fontWeight:800,color:t.gold,fontFamily:warrior,letterSpacing:4,animation:"pulse 1.5s infinite",textShadow:`0 0 20px ${t.goldGlow}` }}>{L(lang,"chestReadyMsg")}</div><div style={{ fontSize:10,fontWeight:600,color:"rgba(255,215,0,0.7)",fontFamily:mono,marginTop:3 }}>{L(lang,"collectRewardMsg")}</div></div>}
  </div>);
}

function ChestPopup({ reward, onClose, lang = "tr" }) {
  const [opened, setOpened] = useState(false);
  const [shake, setShake] = useState(true);
  useEffect(() => { const t1 = setTimeout(() => setShake(false), 1500); return () => clearTimeout(t1); }, []);
  return (<div style={{ position:"fixed",inset:0,overflow:"hidden",background:"rgba(0,0,0,0.8)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:9999 }} onClick={onClose}>
    <div onClick={e=>e.stopPropagation()} style={{ position:"relative",background:`linear-gradient(135deg,${t.surface},rgba(17,24,39,0.98))`,border:`2px solid ${reward?reward.color:t.gold}`,borderRadius:16,padding:"30px 36px",textAlign:"center",maxWidth:320,width:"90%",boxShadow:`0 0 60px ${t.goldGlow}`,animation:"scaleUp 0.5s ease-out" }}>
      <button onClick={onClose} title={L(lang,"backBtn")} style={{ position:"absolute",top:-14,right:-14,width:34,height:34,borderRadius:"50%",background:"#0c1529",border:`2px solid ${t.gold}`,color:t.gold,fontSize:16,fontWeight:900,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",padding:0,boxShadow:`0 0 12px ${t.goldGlow}`,zIndex:2 }}>✕</button>
      {!opened ? (<>
        <img src="/img/chest.png" alt="" draggable={false} style={{ width:80,height:80,objectFit:"contain",marginBottom:12,animation:shake?"defeatShake 0.5s ease-in-out infinite":"popIn 0.3s ease-out",cursor:"pointer",userSelect:"none" }} onClick={()=>{setOpened(true);sfx.init();sfx.play('chest');}} />
        <div style={{ fontSize:18,fontWeight:700,color:t.gold,fontFamily:warrior,letterSpacing:3,marginBottom:8 }}>{L(lang,"mysteryChest")}</div>
        <div style={{ fontSize:12,color:t.textDim,fontFamily:mono,marginBottom:12 }}>{L(lang,"completedMissionsMsg")}</div>
        <button onClick={()=>setOpened(true)} style={{ padding:"12px 36px",background:`linear-gradient(135deg,${t.gold},#d97706)`,color:t.bg,border:"none",borderRadius:8,fontSize:14,fontWeight:700,letterSpacing:2,cursor:"pointer",fontFamily:warrior,animation:"borderGlow 2s infinite" }}>{L(lang,"openChestBtn")}</button>
      </>) : (<>
        <div style={{ fontSize:56,marginBottom:8,animation:"popIn 0.5s ease-out" }}>{reward.icon}</div>
        <div style={{ fontSize:14,fontWeight:700,color:reward.color,fontFamily:warrior,letterSpacing:3,marginBottom:4,animation:"fadeUp 0.3s ease-out" }}>{reward.label}</div>
        <div style={{ fontSize:42,fontWeight:800,color:t.gold,fontFamily:warrior,marginBottom:8,textShadow:`0 0 30px ${t.goldGlow}`,animation:"scaleUp 0.6s ease-out" }}>+{reward.gold} <img src="/img/coin.png" alt="" style={{ width:18,height:18,verticalAlign:"middle",filter:"drop-shadow(0 0 8px rgba(255,215,0,0.9))" }} /></div>
        <button onClick={onClose} style={{ marginTop:8,padding:"12px 36px",background:`linear-gradient(135deg,${t.accent},#0891b2)`,color:t.bg,border:"none",borderRadius:8,fontSize:14,fontWeight:700,letterSpacing:2,cursor:"pointer",fontFamily:warrior }}>{L(lang,"collectBtn")}</button>
      </>)}
    </div>
  </div>);
}

// === YAŞAYAN UFUK — lobinin altındaki gerçek zamanlı deniz sahnesi ===
// Gökyüzü saate göre yaşar, limanda rütbene göre GEMİN durur, ufukta denizdeki kaptanlar süzülür.
function LivingHorizon({ profile, lang = "tr" }) {
  const [onlineN, setOnlineN] = useState(0);
  const [gs, setGs] = useState({ battlesTotal: 0, sunkTotal: 0, battlesToday: 0 });
  const [capIdx, setCapIdx] = useState(0);
  useEffect(() => {
    const u1 = onValue(ref(db, "online_players"), s => { let n = 0; s.forEach(() => { n++; }); setOnlineN(n); });
    const u2 = onValue(ref(db, "global_stats"), s => { const v = s.val() || {}; setGs({ battlesTotal: v.battlesTotal || 0, sunkTotal: v.sunkTotal || 0, battlesToday: (v.day && v.day[todayKey()] && v.day[todayKey()].battles) || 0 }); });
    const iv = setInterval(() => setCapIdx(i => i + 1), 4200);
    return () => { u1(); u2(); clearInterval(iv); };
  }, []);
  const en = lang === "en";
  const hour = new Date().getHours();
  // Gökyüzü paleti — o anın saati
  const sky = hour >= 20 || hour < 5
    ? { top:"#01020a", mid:"#060f24", low:"#0a1b36", mode:"night" }
    : hour < 8
    ? { top:"#191838", mid:"#54305a", low:"#c06a44", mode:"dawn" }
    : hour < 17
    ? { top:"#082038", mid:"#0f3a63", low:"#1f6293", mode:"day" }
    : { top:"#131130", mid:"#45285c", low:"#b04f38", mode:"dusk" };
  // Denizdeki kaptanlar: gerçek oyuncular + o saat seyirde olan bot filosu (saat seed'li → herkese aynı, saatte bir değişir)
  const hourSeed = Math.floor(Date.now() / 3600000);
  let hr = (hourSeed * 2654435761) & 0x7fffffff; hr = (hr * 1664525 + 1013904223) & 0x7fffffff;
  const botFleet = 6 + (hr % 7); // 6-12
  const captains = botFleet + onlineN;
  // Silüetler — saat içinde sabit rastgelelik
  // Mobil performans: aynı anda hareket eden silüet sayısı sınırlı (her biri ayrı GPU katmanı).
  // useMemo şart — altyazı her 4 sn değiştiğinde liste yeniden üretilirse animasyonlar baştan
  // başlar, katmanlar yeniden kurulur ve gözle görülür takılma olur.
  const silCount = Math.min(captains, 5);
  const sils = useMemo(() => Array.from({ length: silCount }).map((_, i) => {
    let sr = ((hourSeed + i * 7919) * 2654435761) & 0x7fffffff; const rnd = () => { sr = (sr * 1664525 + 1013904223) & 0x7fffffff; return sr / 0x7fffffff; };
    return { w: 14 + Math.round(rnd() * 12), top: 2 + rnd() * 6, dur: 55 + rnd() * 70, delay: -rnd() * 90, flip: rnd() > 0.5 };
  }), [silCount, hourSeed]);
  // Rütbe → gemi katmanı (Şeref'e bağlı — sadece savaşarak büyür)
  const hn = migrateHonor(profile);
  const tier = hn >= 5000 ? 5 : hn >= 2000 ? 4 : hn >= 800 ? 3 : hn >= 300 ? 2 : hn >= 100 ? 1 : 0;
  const rank = getRankInfo(hn, lang);
  const flag = profile && profile.avatar && !String(profile.avatar).startsWith("data:") ? profile.avatar : "⚓";
  const shipScale = [0.62, 0.72, 0.85, 0.95, 1.05, 1.18][tier];
  // Dönen altyazılar — hepsi dürüst metrik
  const captions = [
    en ? `⚓ ${captains} captains at sea right now` : `⚓ Denizde ${captains} kaptan seyirde`,
    en ? `⚔ ${gs.battlesToday} battles fought today` : `⚔ Bugün ${gs.battlesToday} savaş yapıldı`,
    en ? `💀 ${gs.sunkTotal} ships sunk in total` : `💀 Toplam ${gs.sunkTotal} gemi batırıldı`,
  ];
  const caption = captions[capIdx % captions.length];
  return (
    <div style={{ width:"100%",maxWidth:400,margin:"16px auto 0",position:"relative",height:170,overflow:"hidden",zIndex:1,borderRadius:14,border:"1px solid rgba(255,255,255,0.06)" }}>
      <style>{`
@keyframes lhDrift{0%{transform:translate3d(-30px,0,0)}100%{transform:translate3d(440px,0,0)}}
@keyframes lhDriftR{0%{transform:translate3d(440px,0,0) scaleX(-1)}100%{transform:translate3d(-30px,0,0) scaleX(-1)}}
@keyframes lhBob{0%,100%{transform:translateY(0) rotate(-1deg)}50%{transform:translateY(-5px) rotate(1.4deg)}}
@keyframes lhWave{0%{transform:translateX(0)}100%{transform:translateX(-50%)}}
@keyframes lhTwinkle{0%,100%{opacity:0.2}50%{opacity:0.9}}
@keyframes lhCaption{0%{opacity:0;transform:translateY(6px)}12%{opacity:1;transform:translateY(0)}88%{opacity:1}100%{opacity:0}}
@keyframes lhGlow{0%,100%{opacity:0.5}50%{opacity:0.9}}
      `}</style>
      {/* Gökyüzü */}
      <div style={{ position:"absolute",inset:0,background:`linear-gradient(180deg, ${sky.top} 0%, ${sky.mid} 52%, ${sky.low} 68%, #04101f 68.5%, #030b18 100%)` }} />
      {/* Yıldızlar (gece) */}
      {sky.mode === "night" && Array.from({length:7}).map((_,i) => { let sr=((hourSeed+i*104729)*2654435761)&0x7fffffff; const rnd=()=>{sr=(sr*1664525+1013904223)&0x7fffffff;return sr/0x7fffffff;}; return <div key={`st${i}`} style={{ position:"absolute",width:rnd()>0.7?2:1.5,height:rnd()>0.7?2:1.5,borderRadius:"50%",background:"#e6f0ff",top:`${4+rnd()*48}%`,left:`${2+rnd()*96}%`,animation:`lhTwinkle ${2+rnd()*3}s ease-in-out ${rnd()*3}s infinite` }} />; })}
      {/* Güneş / Ay */}
      {sky.mode === "night"
        ? <div style={{ position:"absolute",top:16,right:"14%",width:26,height:26,borderRadius:"50%",background:"radial-gradient(circle at 35% 35%, #f4f6e8, #cfd6c4)",boxShadow:"0 0 24px rgba(240,245,220,0.35)" }}><div style={{ position:"absolute",top:5,left:9,width:6,height:6,borderRadius:"50%",background:"rgba(0,0,0,0.08)" }} /><div style={{ position:"absolute",top:13,left:5,width:4,height:4,borderRadius:"50%",background:"rgba(0,0,0,0.07)" }} /></div>
        : <div style={{ position:"absolute",top:sky.mode==="day"?12:44,left:sky.mode==="dawn"?"16%":sky.mode==="dusk"?"78%":"48%",width:sky.mode==="day"?24:32,height:sky.mode==="day"?24:32,borderRadius:"50%",background:sky.mode==="day"?"radial-gradient(circle, #fff8d8, #ffd76a)":"radial-gradient(circle, #ffd9a0, #ff8c4a)",boxShadow:sky.mode==="day"?"0 0 30px rgba(255,220,120,0.5)":"0 0 40px rgba(255,140,70,0.55)",animation:"lhGlow 5s ease-in-out infinite" }} />}
      {/* Ufuk silüetleri — denizdeki kaptanlar */}
      {sils.map((s, i) => (
        <div key={`sil${i}`} className="gpu" style={{ position:"absolute",top:`calc(68% - ${6 + s.top}px)`,left:0,animation:`${s.flip?"lhDriftR":"lhDrift"} ${s.dur}s linear ${s.delay}s infinite`,opacity:0.55 }}>
          <svg width={s.w} height={s.w*0.55} viewBox="0 0 24 13"><path d="M1 9 L23 9 L20 12 L4 12 Z" fill="#030910"/><path d="M10 9 L10 2 L11 2 L11 9 Z" fill="#030910"/><path d="M11 2 L16 6 L11 6 Z" fill="#04121f"/></svg>
        </div>
      ))}
      {/* Deniz dalgaları */}
      <div style={{ position:"absolute",top:"68%",left:0,right:0,bottom:0,overflow:"hidden" }}>
        <div className="gpu" style={{ position:"absolute",top:-6,left:0,width:"200%",height:14,background:"radial-gradient(ellipse 18px 7px at 25% 50%, rgba(0,229,255,0.10) 60%, transparent 62%), radial-gradient(ellipse 22px 8px at 75% 50%, rgba(0,229,255,0.07) 60%, transparent 62%)",backgroundSize:"90px 14px",animation:"lhWave 11s linear infinite" }} />
      </div>
      {/* SENİN GEMİN — rütbeyle büyür, bayrağında avatarın */}
      <div style={{ position:"absolute",bottom:14,right:"6%",transform:`scale(${shipScale})`,transformOrigin:"bottom right" }}>
        <div style={{ animation:"lhBob 4.6s ease-in-out infinite",transformOrigin:"50% 90%",filter:"drop-shadow(0 6px 10px rgba(0,0,0,0.6))" }}>
          <svg width="150" height="110" viewBox="0 0 150 110">
            {tier <= 1 ? (<>
              {/* Sandal */}
              <path d="M40 88 L110 88 L98 100 L52 100 Z" fill="#1d2b3a" stroke="#2e455c" strokeWidth="1.5"/>
              <path d="M74 88 L74 58 L76 58 L76 88 Z" fill="#243a4f"/>
              <path d="M76 60 L98 76 L76 76 Z" fill="rgba(200,215,230,0.16)" stroke="rgba(200,215,230,0.3)" strokeWidth="1"/>
              <text x="66" y="56" fontSize="13">{flag}</text>
            </>) : tier <= 3 ? (<>
              {/* Yelkenli */}
              <path d="M28 84 L122 84 L106 102 L44 102 Z" fill="#1c2f42" stroke="#31526f" strokeWidth="1.5"/>
              <rect x="30" y="78" width="90" height="6" fill="#253d54"/>
              <path d="M70 84 L70 28 L73 28 L73 84 Z" fill="#2a4258"/>
              <path d="M73 32 L112 66 L73 66 Z" fill="rgba(210,225,240,0.2)" stroke="rgba(210,225,240,0.4)" strokeWidth="1"/>
              <path d="M70 40 L38 70 L70 70 Z" fill="rgba(210,225,240,0.13)" stroke="rgba(210,225,240,0.3)" strokeWidth="1"/>
              <circle cx="50" cy="81" r="1.6" fill="rgba(255,215,0,0.7)"/><circle cx="75" cy="81" r="1.6" fill="rgba(255,215,0,0.7)"/><circle cx="100" cy="81" r="1.6" fill="rgba(255,215,0,0.7)"/>
              <text x="62" y="26" fontSize="14">{flag}</text>
            </>) : (<>
              {/* Zırhlı */}
              <path d="M18 82 L132 82 L118 104 L34 104 Z" fill="#182b3d" stroke="#37587a" strokeWidth="1.5"/>
              <rect x="34" y="72" width="82" height="10" rx="2" fill="#22394e"/>
              <rect x="52" y="58" width="30" height="14" rx="2" fill="#2b4560"/>
              <rect x="88" y="62" width="16" height="10" rx="2" fill="#2b4560"/>
              <rect x="60" y="44" width="8" height="14" fill="#324e6b"/>
              <rect x="94" y="50" width="6" height="12" fill="#324e6b"/>
              <path d="M82 64 L104 64 L104 61 L112 61" stroke="#3d5f80" strokeWidth="2.5" fill="none"/>
              <path d="M46 66 L30 66" stroke="#3d5f80" strokeWidth="2.5"/>
              <circle cx="42" cy="77" r="1.8" fill="rgba(255,215,0,0.8)"/><circle cx="62" cy="77" r="1.8" fill="rgba(255,215,0,0.8)"/><circle cx="82" cy="77" r="1.8" fill="rgba(255,215,0,0.8)"/><circle cx="102" cy="77" r="1.8" fill="rgba(255,215,0,0.8)"/>
              <path d="M62 44 L62 30 L64 30 L64 44 Z" fill="#324e6b"/>
              <text x="54" y="28" fontSize="14">{flag}</text>
            </>)}
          </svg>
        </div>
        {/* Rütbe etiketi */}
        <div style={{ textAlign:"center",marginTop:-6,fontSize:9,fontWeight:900,color:rank.color,fontFamily:warrior,letterSpacing:3,textShadow:`0 0 10px ${rank.color}66`,opacity:0.9 }}>{rank.icon} {rank.title}</div>
      </div>
      {/* Dönen altyazı — dürüst canlı metrikler */}
      <div key={capIdx} style={{ position:"absolute",bottom:8,left:14,fontSize:11,fontWeight:800,color:"rgba(160,200,235,0.85)",fontFamily:mono,letterSpacing:1,animation:"lhCaption 4.2s ease-in-out forwards",textShadow:"0 1px 3px rgba(0,0,0,0.8)" }}>{caption}</div>
    </div>
  );
}

// === KAZANIMLAR EKRANI ===
function AchievementsScreen({ profile, onClose, onClaim, lang = "tr" }) {
  const p = profile || {};
  const a = safeAch(p.ach);
  const claimed = safeClaimed(p.achievClaimed);
  const en = lang === "en";
  return (
    <div style={{ position:"fixed",inset:0,zIndex:9000,background:"linear-gradient(180deg,#050b18 0%,#071428 55%,#0a1a35 100%)",overflowX:"hidden",overflowY:"auto",WebkitOverflowScrolling:"touch" }}>
      <style>{`
@keyframes achGlow{0%,100%{box-shadow:0 0 8px rgba(52,211,153,0.45)}50%{box-shadow:0 0 18px rgba(52,211,153,0.85)}}
@keyframes achBtnPulse{0%,100%{transform:scale(1);box-shadow:0 0 16px rgba(255,215,0,0.4)}50%{transform:scale(1.03);box-shadow:0 0 28px rgba(255,215,0,0.7)}}
@keyframes achFadeUp{0%{opacity:0;transform:translateY(10px)}100%{opacity:1;transform:translateY(0)}}
      `}</style>
      <div style={{ maxWidth:400,margin:"0 auto",padding:"calc(14px + env(safe-area-inset-top,0px)) clamp(10px,4vw,16px) 44px",width:"100%",display:"flex",flexDirection:"column",alignItems:"center" }}>
        {/* Başlık */}
        <div style={{ width:"100%",display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:16 }}>
          <button onClick={onClose} style={{ width:38,height:38,borderRadius:10,background:"rgba(255,255,255,0.05)",border:`1px solid ${t.border}`,color:t.text,fontSize:18,cursor:"pointer",fontFamily:warrior }}>←</button>
          <div style={{ fontSize:24,fontWeight:900,color:t.gold,fontFamily:warrior,letterSpacing:6,textShadow:`0 0 24px ${t.goldGlow}` }}>🏅 {L(lang,"achTitle")}</div>
          <div style={{ width:38 }} />
        </div>
        {ACH_SETS.map((s, idx) => {
          const unlocked = achSetUnlocked(idx, p);
          const done = achSetDone(s, p);
          const isClaimed = claimed[s.id] === true;
          const doneCount = s.missions.filter(m => { try { return m.check(p, a); } catch(e) { return false; } }).length;
          const setName = en ? s.nameEn : s.name;
          // ── Kilitli set: silik kart + şartlar ──
          if (!unlocked) return (
            <div key={s.id} style={{ width:"100%",background:"rgba(255,255,255,0.025)",border:`1px solid rgba(255,255,255,0.07)`,borderRadius:14,padding:"14px 16px",marginBottom:12,opacity:0.65 }}>
              <div style={{ display:"flex",alignItems:"center",gap:8,marginBottom:8 }}>
                <span style={{ fontSize:16,filter:"grayscale(1)",opacity:0.6 }}>🔒</span>
                <span style={{ fontSize:15,fontWeight:900,color:t.textDim,fontFamily:warrior,letterSpacing:3 }}>{idx+1}. SET — {setName}</span>
                <span style={{ marginLeft:"auto",fontSize:9,fontWeight:800,color:t.textDim,fontFamily:warrior,letterSpacing:2,border:`1px solid rgba(255,255,255,0.12)`,borderRadius:10,padding:"2px 8px" }}>{L(lang,"achLocked")}</span>
              </div>
              <div style={{ fontSize:9,fontWeight:800,color:t.textDim,fontFamily:warrior,letterSpacing:2,marginBottom:5 }}>{L(lang,"achUnlockReq")}:</div>
              {idx > 0 && !achSetDone(ACH_SETS[idx-1], p) && <div style={{ fontSize:10,color:"rgba(255,71,87,0.7)",fontFamily:mono,marginBottom:3 }}>✗ {L(lang,"achPrevSet")}</div>}
              {s.gateReq.map((g,gi) => <div key={gi} style={{ fontSize:10,color:g.ok(p)?"rgba(52,211,153,0.8)":t.textDim,fontFamily:mono,marginBottom:3 }}>{g.ok(p)?"✓":"○"} {en?g.en:g.tr}</div>)}
            </div>
          );
          // ── Açık set: 10 görev dikey liste ──
          return (
            <div key={s.id} style={{ width:"100%",background:`linear-gradient(145deg, ${t.surface}, ${t.surfaceLight})`,border:`2px solid ${done?(isClaimed?"rgba(52,211,153,0.35)":"rgba(255,215,0,0.55)"):t.border}`,borderRadius:14,padding:"14px 16px",marginBottom:12,animation:"achFadeUp 0.4s ease-out" }}>
              <div style={{ display:"flex",alignItems:"center",gap:8,marginBottom:4 }}>
                <span style={{ fontSize:15,fontWeight:900,color:t.gold,fontFamily:warrior,letterSpacing:3,textShadow:`0 0 12px ${t.goldGlow}` }}>{idx+1}. SET — {setName}</span>
                <span style={{ marginLeft:"auto",fontSize:12,fontWeight:900,color:done?"#34d399":t.accent,fontFamily:mono }}>{doneCount}/10</span>
              </div>
              {/* Set ilerleme çubuğu */}
              <div style={{ width:"100%",height:5,borderRadius:3,background:"rgba(0,0,0,0.45)",overflow:"hidden",marginBottom:12 }}>
                <div style={{ width:`${doneCount*10}%`,height:"100%",borderRadius:3,background:done?"linear-gradient(90deg,#34d399,#4ade80)":"linear-gradient(90deg,#00e5ff,#ffd700)",transition:"width 0.5s ease",boxShadow:done?"0 0 8px rgba(52,211,153,0.6)":"none" }} />
              </div>
              {/* Görevler — dikey ikon listesi */}
              {s.missions.map((m, mi) => {
                const ok = (() => { try { return m.check(p, a); } catch(e) { return false; } })();
                return (
                  <div key={mi} style={{ display:"flex",alignItems:"center",gap:12,padding:"6px 0" }}>
                    <div style={{ width:42,height:42,borderRadius:"50%",flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center",fontSize:19,border:`2px solid ${ok?"#34d399":"rgba(255,255,255,0.10)"}`,background:ok?"rgba(52,211,153,0.10)":"rgba(255,255,255,0.03)",animation:ok?"achGlow 2.2s ease-in-out infinite":"none",filter:ok?"none":"grayscale(1)",opacity:ok?1:0.4,transition:"all 0.3s" }}>{m.icon}</div>
                    <div style={{ flex:1,fontSize:12,fontWeight:700,color:ok?t.text:t.textDim,fontFamily:mono,opacity:ok?1:0.55,letterSpacing:0.3 }}>{en?m.textEn:m.text}</div>
                    {ok ? <span style={{ fontSize:16,color:"#34d399",fontWeight:900,textShadow:"0 0 8px rgba(52,211,153,0.7)" }}>✓</span> : <span style={{ fontSize:13,color:"rgba(255,255,255,0.15)" }}>○</span>}
                  </div>
                );
              })}
              {/* Set ödülü */}
              <div style={{ marginTop:10,padding:"11px 14px",borderRadius:10,background:done&&!isClaimed?"rgba(255,215,0,0.08)":"rgba(0,0,0,0.25)",border:`1px solid ${done&&!isClaimed?"rgba(255,215,0,0.45)":"rgba(255,255,255,0.07)"}`,display:"flex",alignItems:"center",gap:10 }}>
                <div style={{ flex:1 }}>
                  <div style={{ fontSize:9,fontWeight:800,color:t.textDim,fontFamily:warrior,letterSpacing:2,marginBottom:3 }}>{L(lang,"achSetReward")}</div>
                  <div style={{ display:"flex",alignItems:"center",gap:8 }}>
                    <span style={{ fontSize:15,fontWeight:900,color:t.gold,fontFamily:warrior,textShadow:`0 0 10px ${t.goldGlow}` }}>💰 {s.reward}</span>
                    <span style={{ fontSize:16 }}>{ACH_AVATARS[s.id]}</span>
                    <span style={{ fontSize:8,fontWeight:800,color:"#a78bfa",fontFamily:warrior,letterSpacing:1 }}>{L(lang,"achAvatarReward")}</span>
                  </div>
                </div>
                {isClaimed
                  ? <span style={{ fontSize:11,fontWeight:900,color:"#34d399",fontFamily:warrior,letterSpacing:2 }}>✓ {L(lang,"achClaimed")}</span>
                  : done
                    ? <button onClick={()=>onClaim(s)} style={{ padding:"10px 18px",background:"linear-gradient(135deg,#ffd700,#ff9f43)",color:"#1a1206",border:"none",borderRadius:10,fontSize:12,fontWeight:900,letterSpacing:2,cursor:"pointer",fontFamily:warrior,animation:"achBtnPulse 1.6s ease-in-out infinite" }}>{L(lang,"achClaim")}</button>
                    : <span style={{ fontSize:11,fontWeight:800,color:t.textDim,fontFamily:mono }}>{doneCount}/10</span>}
              </div>
            </div>
          );
        })}
        {/* 5. set — yakında */}
        <div style={{ width:"100%",background:"rgba(255,255,255,0.02)",border:"1px dashed rgba(255,255,255,0.08)",borderRadius:14,padding:"13px 16px",marginBottom:10,opacity:0.5 }}>
          <div style={{ display:"flex",alignItems:"center",gap:8,marginBottom:6 }}>
            <span style={{ fontSize:14,filter:"grayscale(1)" }}>🔒</span>
            <span style={{ fontSize:14,fontWeight:900,color:t.textDim,fontFamily:warrior,letterSpacing:3 }}>5. SET — {en?"LEGEND":"EFSANE"}</span>
            <span style={{ marginLeft:"auto",fontSize:9,fontWeight:800,color:t.gold,fontFamily:warrior,letterSpacing:2,opacity:0.7 }}>💰 7500 + {ACH_AVATARS.s5}</span>
          </div>
          {ACH_SET5_GATE.map((g,gi)=><div key={gi} style={{ fontSize:10,color:t.textDim,fontFamily:mono,marginBottom:2 }}>○ {en?g.en:g.tr}</div>)}
        </div>
        {[6,7].map(n => (
          <div key={n} style={{ width:"100%",background:"rgba(255,255,255,0.015)",border:"1px dashed rgba(255,255,255,0.06)",borderRadius:14,padding:"12px 16px",marginBottom:8,opacity:0.35,display:"flex",alignItems:"center",gap:8 }}>
            <span style={{ fontSize:13,filter:"grayscale(1)" }}>🔒</span>
            <span style={{ fontSize:13,fontWeight:900,color:t.textDim,fontFamily:warrior,letterSpacing:3 }}>{n}. SET</span>
            <span style={{ marginLeft:"auto",fontSize:9,fontWeight:800,color:t.textDim,fontFamily:warrior,letterSpacing:2 }}>{L(lang,"achSoon")}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// === GÜNLÜK SANDIK — cihaz başına 1 tane, sabit 500 altın ===
// Işın halkası tasarımı: kutu yok — dönen konik altın ışınlar, minik yıldızlar, nefes alan sandık
function DailyChestFab({ onOpen, lang = "tr" }) {
  return (<button onClick={onOpen} style={{ position:"fixed",top:"calc(64px + env(safe-area-inset-top, 0px))",right:12,zIndex:150,width:80,height:80,background:"transparent",border:"none",padding:0,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center" }} title={L(lang,"dailyChestTooltip")}>
    <style>{`
@keyframes chestRayRotate{0%{transform:rotate(0deg)}100%{transform:rotate(360deg)}}
@keyframes chestBreath{0%,100%{transform:scale(1)}50%{transform:scale(1.045)}}
@keyframes chestStar{0%,100%{opacity:0.15;transform:scale(0.7)}50%{opacity:0.9;transform:scale(1.1)}}
    `}</style>
    {/* Dönen konik ışın halkası — yumuşak kenarlı */}
    <span className="gpu" style={{ position:"absolute",inset:0,borderRadius:"50%",background:"conic-gradient(from 0deg, rgba(255,215,0,0) 0deg, rgba(255,225,80,0.55) 18deg, rgba(255,215,0,0) 40deg, rgba(255,215,0,0) 90deg, rgba(255,225,80,0.45) 108deg, rgba(255,215,0,0) 130deg, rgba(255,215,0,0) 180deg, rgba(255,225,80,0.55) 198deg, rgba(255,215,0,0) 220deg, rgba(255,215,0,0) 270deg, rgba(255,225,80,0.45) 288deg, rgba(255,215,0,0) 310deg, rgba(255,215,0,0) 360deg)",WebkitMaskImage:"radial-gradient(circle, rgba(0,0,0,1) 26%, rgba(0,0,0,0.5) 55%, transparent 72%)",maskImage:"radial-gradient(circle, rgba(0,0,0,1) 26%, rgba(0,0,0,0.5) 55%, transparent 72%)",animation:"chestRayRotate 9s linear infinite",pointerEvents:"none" }} />
    {/* Sıcak merkez ışıması — sabit, hafif */}
    <span style={{ position:"absolute",inset:14,borderRadius:"50%",background:"radial-gradient(circle, rgba(255,215,0,0.28) 0%, rgba(255,215,0,0.08) 55%, transparent 75%)",pointerEvents:"none" }} />
    {/* Minik yıldızlar — sıralı yanıp söner */}
    <span style={{ position:"absolute",top:6,right:14,fontSize:9,color:"#ffe94d",animation:"chestStar 2.6s ease-in-out infinite",pointerEvents:"none",textShadow:"0 0 6px rgba(255,233,77,0.9)" }}>✦</span>
    <span style={{ position:"absolute",bottom:10,left:8,fontSize:7,color:"#fff6c0",animation:"chestStar 3.1s ease-in-out 0.9s infinite",pointerEvents:"none",textShadow:"0 0 5px rgba(255,233,77,0.8)" }}>✦</span>
    <span style={{ position:"absolute",top:24,left:2,fontSize:6,color:"#ffe94d",animation:"chestStar 2.2s ease-in-out 1.6s infinite",pointerEvents:"none",textShadow:"0 0 5px rgba(255,233,77,0.8)" }}>✦</span>
    {/* Sandık — nefes alır, altında yumuşak gölge */}
    <img src="/img/chest.png" alt="" draggable={false} style={{ width:52,height:52,objectFit:"contain",userSelect:"none",pointerEvents:"none",position:"relative",animation:"chestBreath 2.8s ease-in-out infinite",filter:"drop-shadow(0 5px 7px rgba(0,0,0,0.55)) drop-shadow(0 0 12px rgba(255,215,0,0.35))" }} />
    {/* Bildirim noktası — altın çerçeveli */}
    <span style={{ position:"absolute",top:6,right:6,width:17,height:17,borderRadius:"50%",background:"#ff4757",color:"#fff",fontSize:10,fontWeight:900,display:"flex",alignItems:"center",justifyContent:"center",border:"1.5px solid #ffd700",boxShadow:"0 1px 4px rgba(0,0,0,0.5)",fontFamily:warrior }}>1</span>
  </button>);
}
function DailyChestPopup({ onClaim, onClose, lang = "tr" }) {
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
  return (<div style={{ position:"fixed",inset:0,overflow:"hidden",background:"radial-gradient(ellipse at 50% 40%, rgba(255,214,0,0.12) 0%, rgba(0,0,0,0.88) 75%)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:9999,backdropFilter:"blur(6px)" }} onClick={opened ? (() => onClaim(DAILY_CHEST_GOLD)) : onClose}>
    <div onClick={e=>e.stopPropagation()} style={{ position:"relative",background:"linear-gradient(160deg, rgba(20,26,52,0.99) 0%, rgba(10,16,32,0.99) 60%, rgba(18,16,30,0.99) 100%)",border:"3px solid #ffe94d",outline:"2px solid rgba(255,233,77,0.65)",outlineOffset:6,borderRadius:22,padding:"38px 42px",textAlign:"center",maxWidth:340,width:"90%",boxShadow:"0 0 40px #ffe94d, 0 0 90px rgba(255,233,77,0.75), 0 0 150px rgba(255,233,77,0.4), 0 24px 70px rgba(0,0,0,0.6)",overflow:"visible",animation:"chestGlow 1.6s ease-in-out infinite" }}>
      <button onClick={opened ? (() => onClaim(DAILY_CHEST_GOLD)) : onClose} title={L(lang,"backBtn")} style={{ position:"absolute",top:-14,right:-14,width:34,height:34,borderRadius:"50%",background:"#0c1529",border:"2px solid #ffe94d",color:"#ffe94d",fontSize:16,fontWeight:900,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",padding:0,boxShadow:"0 0 14px rgba(255,233,77,0.8)",zIndex:2 }}>✕</button>
      {!opened ? (<>
        <img src="/img/chest.png" alt="" draggable={false} onClick={openChest} style={{ width:140,height:140,objectFit:"contain",marginBottom:12,cursor:"pointer",animation:shake?"chestWiggle 0.5s ease-in-out infinite":"chestWiggle 2s ease-in-out infinite",filter:"drop-shadow(0 0 30px #ffe94d) drop-shadow(0 0 60px rgba(255,233,77,0.85)) drop-shadow(0 0 100px rgba(255,233,77,0.5))",userSelect:"none" }} />
        <div style={{ fontSize:14,fontWeight:800,color:"#ffe94d",fontFamily:mono,letterSpacing:4,marginBottom:10 }}>{L(lang,"dailyChestTooltip").toUpperCase()}</div>
        <div style={{ fontSize:14,fontWeight:600,color:t.textDim,fontFamily:mono,marginBottom:18 }}>{L(lang,"oneChestPerDevice")}</div>
        <button onClick={openChest} style={{ padding:"22px 40px",background:"linear-gradient(135deg,#fff9c4,#ffe94d 45%,#ffb300)",color:"#1a1206",border:"3px solid #fff176",borderRadius:14,fontSize:28,fontWeight:900,letterSpacing:3,cursor:"pointer",fontFamily:warrior,boxShadow:"0 0 30px #ffe94d, 0 0 60px rgba(255,233,77,0.6)",animation:"chestGlow 1.5s infinite",textTransform:"uppercase",width:"100%" }}>{L(lang,"openChestBtn")}</button>
      </>) : (<>
        <div style={{ fontSize:60,marginBottom:8,animation:"popIn 0.5s ease-out",filter:"drop-shadow(0 0 30px #ffe066)" }}>🎉</div>
        <div style={{ fontSize:13,fontWeight:800,color:"rgba(255,214,0,0.85)",fontFamily:mono,letterSpacing:4,marginBottom:8 }}>{L(lang,"dailyRewardLabel")}</div>
        <div style={{ fontSize:52,fontWeight:900,fontFamily:warrior,marginBottom:14,letterSpacing:2,background:"linear-gradient(180deg, #fff7d6 0%, #ffd700 45%, #d97706 100%)",WebkitBackgroundClip:"text",WebkitTextFillColor:"transparent",filter:"drop-shadow(0 0 25px rgba(255,214,0,0.8))",animation:"rewardPulse 1.4s ease-in-out infinite" }}>+{DAILY_CHEST_GOLD} <img src="/img/coin.png" alt="" style={{ width:22,height:22,verticalAlign:"middle",filter:"drop-shadow(0 0 8px rgba(255,215,0,0.9))" }} /></div>
        <button onClick={() => onClaim(DAILY_CHEST_GOLD)} style={{ padding:"20px 52px",background:"linear-gradient(135deg, #ffd700 0%, #ff9f43 55%, #d97706 100%)",color:"#1a1206",border:"none",borderRadius:14,fontSize:22,fontWeight:900,letterSpacing:4,cursor:"pointer",fontFamily:warrior,boxShadow:"0 0 40px rgba(255,214,0,0.6), 0 6px 24px rgba(0,0,0,0.5)",animation:"btnBreath 1.8s ease-in-out infinite",textTransform:"uppercase",width:"100%" }}>{L(lang,"collectBtn")}</button>
        {showCoins && <div style={{ position:"absolute",left:"50%",bottom:"38%",pointerEvents:"none" }}>
          {coins.map(c => (<div key={c.id} style={{ position:"absolute",left:c.dx,bottom:0,fontSize:26,opacity:0,animation:`coinFly 1s cubic-bezier(0.25,0.46,0.45,0.94) ${c.delay}ms forwards` }}>🪙</div>))}
        </div>}
      </>)}
    </div>
  </div>);
}

function ReadyScreen({ onStart, opponentName, myName, myAvatar, oppAvatar, lang = "tr" }) {
  return (<div style={{ display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",minHeight:"100vh",minHeight:"100dvh",background:`radial-gradient(ellipse at 50% 30%, rgba(255,71,87,0.10) 0%, rgba(0,229,255,0.06) 40%, ${t.bg} 75%)`,padding:20,animation:"pageFadeIn 0.6s ease-out" }}>
    {/* VS düzeni */}
    <div style={{ display:"flex",alignItems:"center",gap:26,marginBottom:28,animation:"tutCardEnter 0.9s cubic-bezier(0.16,1,0.3,1)" }}>
      <div style={{ textAlign:"center" }}>
        <div style={{ width:78,height:78,borderRadius:"50%",background:"rgba(0,229,255,0.10)",border:`3px solid ${t.accent}`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:38,boxShadow:`0 0 30px ${t.accentGlow}`,marginBottom:8,overflow:"hidden" }}>{(myAvatar||"").startsWith("data:")?<img src={myAvatar} alt="" style={{ width:"100%",height:"100%",objectFit:"cover" }} />:(myAvatar||"⚓")}</div>
        <div style={{ fontSize:13,fontWeight:800,color:t.accent,fontFamily:warrior,letterSpacing:2,maxWidth:100,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap" }}>{myName||L(lang,"you")}</div>
      </div>
      <div style={{ fontSize:34,fontWeight:900,color:t.gold,fontFamily:warrior,textShadow:`0 0 30px ${t.goldGlow}`,animation:"rewardPulse 1.4s ease-in-out infinite" }}>VS</div>
      <div style={{ textAlign:"center" }}>
        <div style={{ width:78,height:78,borderRadius:"50%",background:"rgba(255,71,87,0.10)",border:`3px solid ${t.hit}`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:38,boxShadow:`0 0 30px ${t.hitGlow}`,marginBottom:8,overflow:"hidden" }}>{(oppAvatar||"").startsWith("data:")?<img src={oppAvatar} alt="" style={{ width:"100%",height:"100%",objectFit:"cover" }} />:(oppAvatar||"🏴‍☠️")}</div>
        <div style={{ fontSize:13,fontWeight:800,color:t.hit,fontFamily:warrior,letterSpacing:2,maxWidth:100,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap" }}>{opponentName}</div>
      </div>
    </div>
    <div style={{ fontSize:26,fontWeight:900,color:"#fff",marginBottom:10,fontFamily:warrior,letterSpacing:8,textTransform:"uppercase",textShadow:`0 0 40px ${t.hitGlow}, 0 3px 6px rgba(0,0,0,0.8)`,animation:"fadeUp 0.7s ease-out" }}>{L(lang,"battleStarting")}</div>
    <div style={{ width:120,height:2,background:`linear-gradient(90deg, transparent, ${t.gold}, transparent)`,marginBottom:32,animation:"fadeUp 0.8s ease-out" }} />
    <button onClick={onStart} style={{ padding:"18px 52px",background:`linear-gradient(135deg,${t.accent},#0891b2)`,color:t.bg,border:"none",borderRadius:12,fontSize:19,fontWeight:900,letterSpacing:5,textTransform:"uppercase",cursor:"pointer",fontFamily:warrior,animation:"scaleUp 0.5s ease-out 0.3s both",boxShadow:`0 0 40px ${t.accentGlow},0 6px 20px rgba(0,0,0,0.4)` }}>{L(lang,"readyForBattle")}</button>
  </div>);
}

function useCountUp(target, active, duration = 1300) {
  const [value, setValue] = useState(0);
  useEffect(() => {
    if (!active) { setValue(0); return; }
    let raf, startTime;
    const tgt = Math.round(target || 0);
    const step = (ts) => {
      if (!startTime) startTime = ts;
      const progress = Math.min(1, (ts - startTime) / duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      setValue(Math.round(tgt * eased));
      if (progress < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => raf && cancelAnimationFrame(raf);
  }, [target, active, duration]);
  return value;
}

function GameOverScreen({ winner, myHits, oppHits, onNewGame, onHome, onViewBoard, isWin, goldEarned = 0, myLevel = 0, chestProgressPct = 0, lang = "tr", hookText = null, onShowRewards = null, revengeStreak = 0 }) {
  const [showStats, setShowStats] = useState(false);
  const [showButtons, setShowButtons] = useState(false);
  const [showRain, setShowRain] = useState(false);
  useEffect(() => {
    const t1 = setTimeout(() => setShowStats(true), 800);
    const t2 = setTimeout(() => setShowButtons(true), 1600);
    if (isWin) { setShowRain(true); const t3 = setTimeout(() => setShowRain(false), 2000); return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); }; }
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [isWin]);
  const goldCount = useCountUp(goldEarned, showStats && isWin, 1300);
  const lvlCount = useCountUp(myLevel, showStats && isWin, 900);
  const coinDrops = isWin ? Array.from({ length: 16 }, (_, i) => ({ id: i, left: 4 + (i * 93) / 16, delay: i * 90, dur: 2.2 + (i % 5) * 0.3, big: i % 3 === 0 })) : [];
  return (<div style={{ display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",minHeight:"100vh",minHeight:"100dvh",background:isWin?`radial-gradient(ellipse at 50% 20%,rgba(0,229,255,0.18) 0%,rgba(255,215,0,0.08) 35%,${t.bg} 75%)`:`radial-gradient(ellipse at center,rgba(255,71,87,0.1) 0%,${t.bg} 70%)`,padding:20,perspective:"800px",position:"relative",overflow:"hidden" }}>
    {/* Üstten yağan altın paralar ve konfeti — ilk 2 saniye */}
    {showRain && coinDrops.map(c => (
      <div key={c.id} style={{ position:"absolute",top:-40,left:`${c.left}%`,fontSize:c.big?26:16,zIndex:5,animation:`coinFall ${c.dur}s linear ${c.delay}ms forwards`,pointerEvents:"none" }}>{c.big?"🪙":"✨"}</div>
    ))}
    <div style={{ animation:"arSlideIn 0.8s ease-out forwards",transformStyle:"preserve-3d",zIndex:1 }}>
      <div style={{ background:`linear-gradient(145deg, rgba(12,21,41,0.98), rgba(8,14,30,0.99))`,border:`3px solid ${isWin?t.accent:t.hit}`,borderRadius:24,padding:"28px 32px 32px",textAlign:"center",maxWidth:360,width:"90vw",animation:`arGlow 3s ease-in-out infinite`,boxShadow:`0 20px 80px rgba(0,0,0,0.7), 0 0 ${isWin?60:30}px ${isWin?t.accentGlow:t.hitGlow}`,'--ar-color':isWin?t.accentGlow:t.hitGlow,position:"relative",overflow:"hidden" }}>
        <style>{`
@keyframes goLetter{0%{opacity:0;transform:translateY(-70px) rotateX(75deg) scale(1.7)}55%{opacity:1;transform:translateY(6px) rotateX(-8deg) scale(0.96)}100%{opacity:1;transform:translateY(0) rotateX(0) scale(1)}}
@keyframes goFloat{0%,100%{transform:translateY(0)}50%{transform:translateY(-4px)}}
@keyframes goLine{0%{transform:scaleX(0);opacity:0}100%{transform:scaleX(1);opacity:1}}
@keyframes goShipIn{0%{opacity:0;transform:translateY(24px) scale(0.7)}60%{opacity:1;transform:translateY(-6px) scale(1.06)}100%{opacity:1;transform:translateY(0) scale(1)}}
@keyframes shimmerPass{0%{transform:translate3d(0,0,0)}100%{transform:translate3d(600%,0,0)}}
        `}</style>
        {/* Gemi görseli — zafer: altın ihtişam / bozgun: yaralı ve dumanlı (aynı gemi, iki kader) */}
        <div style={{ position:"relative",width:"clamp(110px, 34vw, 150px)",height:"clamp(110px, 34vw, 150px)",margin:"0 auto 4px",animation:"goShipIn 0.9s cubic-bezier(0.34,1.56,0.64,1) both" }}>
          <img src={isWin ? "/img/ship-victory.png" : "/img/ship-defeat.png"} onError={(e)=>{ e.currentTarget.onerror=null; e.currentTarget.src="/img/victory-medal.png"; }} alt="" style={{ width:"100%",height:"100%",objectFit:"contain",animation:"float 3s ease-in-out 0.9s infinite",filter:isWin
            ? `drop-shadow(0 0 22px ${t.goldGlow}) drop-shadow(0 0 46px rgba(0,229,255,0.5)) drop-shadow(0 10px 18px rgba(0,0,0,0.6))`
            : "drop-shadow(0 0 24px rgba(255,71,87,0.55)) drop-shadow(0 10px 18px rgba(0,0,0,0.7))" }} />
          {!isWin && [0,1,2].map(i => (<span key={i} style={{ position:"absolute",bottom:"34%",left:`${40+i*8}%`,fontSize:15,opacity:0,animation:`smokeRise ${2.4+i*0.5}s ease-in ${i*0.6}s infinite`,filter:"blur(1px) grayscale(1) brightness(1.4)",pointerEvents:"none" }}>💨</span>))}
          {isWin && [0,1].map(i => (<span key={`s${i}`} style={{ position:"absolute",top:`${12+i*30}%`,right:`${8+i*14}%`,fontSize:13,color:"#ffe94d",animation:`pulse ${1.4+i*0.5}s ease-in-out ${i*0.4}s infinite`,pointerEvents:"none",textShadow:"0 0 8px rgba(255,233,77,0.9)" }}>✦</span>))}
        </div>
        {/* Harf harf çöken destansı başlık */}
        <div style={{ position:"relative",marginBottom:6 }}>
          <div style={{ display:"flex",justifyContent:"center",gap:"clamp(2px, 1.2vw, 6px)",perspective:"500px",maxWidth:"100%" }}>
            {(isWin?L(lang,"victory"):L(lang,"defeat")).split("").map((ch,i)=>(
              <span key={i} style={{ fontSize:"clamp(34px, 12vw, 56px)",fontWeight:900,fontFamily:warrior,lineHeight:1,display:"inline-block",textTransform:"uppercase",
                animation:`goLetter 0.55s cubic-bezier(0.34,1.56,0.64,1) ${0.2+i*0.09}s both${isWin?`, goFloat 2.6s ease-in-out ${1.2+i*0.18}s infinite`:""}`,
                ...(isWin
                  ? { background:"linear-gradient(180deg,#fffbe0 0%,#ffe066 26%,#ffd700 50%,#b45309 72%,#ffe066 100%)",WebkitBackgroundClip:"text",WebkitTextFillColor:"transparent",filter:"drop-shadow(0 4px 0 rgba(110,55,0,0.6)) drop-shadow(0 0 28px rgba(255,215,0,0.7)) drop-shadow(0 12px 24px rgba(0,0,0,0.8))" }
                  : { color:"#ff4757",textShadow:"0 4px 0 rgba(70,0,0,0.75), 0 0 32px rgba(255,71,87,0.75), 0 12px 26px rgba(0,0,0,0.8)" })
              }}>{ch}</span>
            ))}
          </div>
          <div style={{ height:2,margin:"10px auto 0",width:"min(180px, 60%)",background:isWin?"linear-gradient(90deg,transparent,#ffd700,transparent)":"linear-gradient(90deg,transparent,#ff4757,transparent)",boxShadow:isWin?`0 0 16px ${t.goldGlow}`:`0 0 16px ${t.hitGlow}`,animation:"goLine 1s ease-out 0.9s both" }} />
        </div>
        <div style={{ fontSize:13,fontWeight:700,color:isWin?"rgba(0,229,255,0.8)":"rgba(255,71,87,0.8)",fontFamily:warrior,letterSpacing:3,marginBottom:20,animation:"fadeUp 0.6s ease-out 1.1s both" }}>{winner}</div>
        {/* Stats with staggered animation */}
        {showStats && <div style={{ display:"flex",gap:16,justifyContent:"center",marginBottom:16 }}>
          <div style={{ padding:"14px 26px 16px",background:isWin?"rgba(0,229,255,0.1)":"rgba(255,255,255,0.03)",borderRadius:16,border:`2px solid ${isWin?"rgba(0,229,255,0.25)":"rgba(255,255,255,0.08)"}`,animation:"arSlideIn 0.6s ease-out forwards",display:"flex",flexDirection:"column",alignItems:"center" }}>
            <img src="/img/isabet.png" alt="" style={{ width:104,height:"auto",objectFit:"contain",filter:`drop-shadow(0 0 10px ${t.accentGlow}) drop-shadow(0 0 26px ${t.accentGlow}) drop-shadow(0 4px 10px rgba(0,0,0,0.7))`,marginBottom:2 }} />
            <div style={{ fontSize:40,fontWeight:800,color:t.accent,fontFamily:mono,textShadow:`0 0 15px ${t.accentGlow}` }}>{myHits}</div>
            <div style={{ fontSize:11,color:t.textDim,letterSpacing:4,fontFamily:warrior,fontWeight:800,marginTop:4 }}>{L(lang,"hits").toUpperCase()}</div>
          </div>
          <div style={{ padding:"14px 26px 16px",background:"rgba(255,71,87,0.06)",borderRadius:16,border:"2px solid rgba(255,71,87,0.15)",animation:"arSlideIn 0.6s ease-out 0.2s both",display:"flex",flexDirection:"column",alignItems:"center" }}>
            <img src="/img/karavana.png" alt="" style={{ width:104,height:"auto",objectFit:"contain",filter:"drop-shadow(0 0 10px rgba(120,200,255,0.55)) drop-shadow(0 0 26px rgba(80,160,255,0.4)) drop-shadow(0 4px 10px rgba(0,0,0,0.7))",marginBottom:2 }} />
            <div style={{ fontSize:40,fontWeight:800,color:t.hit,fontFamily:mono }}>{oppHits}</div>
            <div style={{ fontSize:11,color:t.textDim,letterSpacing:4,fontFamily:warrior,fontWeight:800,marginTop:4 }}>{L(lang,"missLabel")}</div>
          </div>
        </div>}
        {/* İNTİKAM GÖSTERGESİ — bozgunda süreç: 3 mühür dolar (×2 → ×2.5 → ×3) */}
        {showStats && !isWin && revengeStreak >= 1 && (() => {
          const rm = revengeStreak >= 4 ? 3 : revengeStreak === 3 ? 2.5 : revengeStreak === 2 ? 2 : 1;
          const filled = Math.min(3, Math.max(0, revengeStreak - 1)); // 1 kayıp=0 dolu, 2=1, 3=2, 4+=3
          const ready = rm > 1;
          return (
            <div style={{ margin:"0 auto 16px",padding:"11px 16px",maxWidth:290,borderRadius:14,background:ready?"linear-gradient(135deg, rgba(200,30,30,0.16), rgba(255,140,0,0.10))":"rgba(255,255,255,0.03)",border:`2px solid ${ready?"rgba(255,80,60,0.6)":"rgba(255,255,255,0.10)"}`,animation:ready?"pulse 1.8s ease-in-out infinite":"none",boxShadow:ready?"0 0 20px rgba(255,60,40,0.25)":"none" }}>
              <div style={{ display:"flex",alignItems:"center",justifyContent:"center",gap:8,marginBottom:8 }}>
                <span style={{ fontSize:16,filter:ready?"drop-shadow(0 0 6px rgba(255,90,50,0.9))":"grayscale(0.6)" }}>⚔</span>
                <span style={{ fontSize:11,fontWeight:900,color:ready?"#ff9a76":t.textDim,fontFamily:warrior,letterSpacing:2 }}>{ready?L(lang,"revengeReady"):L(lang,"revengeGauge")}</span>
                {ready && <span style={{ fontSize:15,fontWeight:900,color:"#ffd700",fontFamily:warrior,textShadow:"0 0 10px rgba(255,215,0,0.8)" }}>×{rm}</span>}
              </div>
              <div style={{ display:"flex",gap:6,justifyContent:"center" }}>
                {[{m:"×2"},{m:"×2.5"},{m:"×3"}].map((seg,i) => (
                  <div key={i} style={{ flex:1,display:"flex",flexDirection:"column",alignItems:"center",gap:3 }}>
                    <div style={{ width:"100%",height:8,borderRadius:5,background:i<filled?"linear-gradient(90deg,#ff5a3c,#ffb347)":"rgba(255,255,255,0.06)",border:`1px solid ${i<filled?"rgba(255,120,60,0.7)":"rgba(255,255,255,0.10)"}`,boxShadow:i<filled?"0 0 8px rgba(255,90,50,0.5)":"none",transition:"all 0.4s" }} />
                    <span style={{ fontSize:8,fontWeight:800,color:i<filled?"#ff9a76":t.textDim,fontFamily:mono,letterSpacing:1 }}>{seg.m}</span>
                  </div>
                ))}
              </div>
            </div>
          );
        })()}
        {/* Buttons — YENİ SAVAŞ ana yıldız */}
        {showButtons && <div style={{ display:"flex",flexDirection:"column",gap:10,animation:"fadeUp 0.5s ease-out" }}>
          {hookText && <div style={{ fontSize:11,fontWeight:900,color:isWin?t.gold:"#ff9a76",fontFamily:warrior,letterSpacing:2,textShadow:isWin?`0 0 12px ${t.goldGlow}`:"0 0 12px rgba(255,90,50,0.6)",animation:"pulse 1.8s ease-in-out infinite" }}>{hookText}</div>}
          <button onClick={onNewGame} style={{ position:"relative",overflow:"hidden",padding:"19px 24px",background:isWin?"linear-gradient(135deg,#ffd700 0%,#22d8ff 55%,#0891b2 100%)":"linear-gradient(135deg,#ff6b4a 0%,#22d8ff 60%,#0891b2 100%)",color:"#04202e",border:"2px solid rgba(255,255,255,0.4)",borderRadius:14,fontSize:19,fontWeight:900,letterSpacing:4,cursor:"pointer",fontFamily:warrior,boxShadow:isWin?`0 0 40px ${t.goldGlow}, 0 6px 0 #045a80, 0 12px 30px rgba(0,0,0,0.55)`:`0 0 34px rgba(255,100,60,0.4), 0 6px 0 #045a80, 0 12px 30px rgba(0,0,0,0.55)`,animation:"btnBreath 1.8s ease-in-out infinite",textShadow:"0 1px 0 rgba(255,255,255,0.4)" }}>
            <span style={{ position:"absolute",top:0,left:"-100%",width:"50%",height:"100%",background:"linear-gradient(90deg,transparent,rgba(255,255,255,0.45),transparent)",animation:"shimmerPass 2.6s ease-in-out infinite",pointerEvents:"none" }} />
            ⚔ {L(lang,"newBattle")}
          </button>
          <div style={{ display:"flex",gap:10 }}>
            {onShowRewards && <button onClick={onShowRewards} style={{ flex:1,padding:"11px 12px",background:"linear-gradient(135deg,rgba(255,215,0,0.12),rgba(255,159,67,0.05))",color:t.gold,border:`2px solid rgba(255,215,0,0.4)`,borderRadius:12,fontSize:11,fontWeight:900,letterSpacing:1,cursor:"pointer",fontFamily:warrior,display:"flex",alignItems:"center",justifyContent:"center",gap:6 }}>🏆 {L(lang,"goodsBadge")}</button>}
            <button onClick={onViewBoard} style={{ flex:1,padding:"11px 12px",background:"transparent",color:t.accent,border:`2px solid rgba(0,229,255,0.25)`,borderRadius:12,fontSize:11,fontWeight:800,letterSpacing:1,cursor:"pointer",fontFamily:warrior }}>{L(lang,"battleMap")}</button>
          </div>
          <button onClick={onHome} style={{ padding:"12px 20px",background:"transparent",color:t.textDim,border:`1px solid ${t.border}`,borderRadius:10,fontSize:12,fontWeight:800,letterSpacing:3,cursor:"pointer",fontFamily:warrior,opacity:0.9 }}>🏠 {L(lang,"homeBtn")}</button>
        </div>}
      </div>
    </div>
  </div>);
}

// === ÖDÜL RAPORU PENCERESİ — maç sonunda ÖNE gelir: kazanımlar animasyonla işlenir ===
function RewardModal({ rewards: rawRewards, dailyMissions, missionProgress, newAch, profile, sfx, onClose, lang = "tr" }) {
  const en = lang === "en";
  // Savunma: eksik/NaN alan gelirse bile pencere ASLA çökmesin
  const num = (v, d = 0) => (typeof v === "number" && isFinite(v) ? v : d);
  const rewards = { gold: num(rawRewards?.gold), xp: num(rawRewards?.xp), honor: num(rawRewards?.honor), revenge: num(rawRewards?.revenge, 1), isWin: !!rawRewards?.isWin };
  const [goldShown, setGoldShown] = useState(0);
  const [row, setRow] = useState(0); // sahne sahne akış
  useEffect(() => {
    try { sfx.init(); sfx.play('chest'); } catch(e) {}
    const timers = [];
    timers.push(setTimeout(() => { setRow(1); try { if (rewards.gold > 0) sfx.play('gold'); } catch(e) {} }, 350));
    timers.push(setTimeout(() => setRow(2), 900));
    timers.push(setTimeout(() => setRow(3), 1350));
    timers.push(setTimeout(() => setRow(4), 1800));
    // Kazanımlar chink sesiyle sırayla
    (newAch || []).forEach((_, i) => timers.push(setTimeout(() => { setRow(5 + i); try { sfx.play('gold'); } catch(e) {} }, 2200 + i * 450)));
    return () => timers.forEach(clearTimeout);
  }, []);
  // Altın sayacı
  useEffect(() => {
    if (row < 1 || rewards.gold <= 0) return;
    const dur = 900, start = Date.now();
    const iv = setInterval(() => {
      const p = Math.min(1, (Date.now() - start) / dur);
      setGoldShown(Math.round(rewards.gold * (1 - Math.pow(1 - p, 3))));
      if (p >= 1) clearInterval(iv);
    }, 30);
    return () => clearInterval(iv);
  }, [row >= 1]);
  const lvl = profile?.level || 0, lvlPct = Math.min(1, (profile?.levelProgress || 0) / Math.max(1, gamesNeededForLevel(lvl)));
  const Row = ({ show, icon, label, value, color, glow, extra }) => (
    <div style={{ display:"flex",alignItems:"center",gap:12,padding:"10px 14px",borderRadius:12,background:"rgba(255,255,255,0.035)",border:`1px solid ${show?color+"55":"rgba(255,255,255,0.06)"}`,marginBottom:8,opacity:show?1:0.25,transform:show?"translateX(0)":"translateX(-14px)",transition:"all 0.45s cubic-bezier(0.34,1.56,0.64,1)" }}>
      <span style={{ fontSize:20,filter:show?`drop-shadow(0 0 8px ${glow})`:"grayscale(1)" }}>{icon}</span>
      <span style={{ flex:1,fontSize:11,fontWeight:800,color:t.textDim,fontFamily:warrior,letterSpacing:2 }}>{label}</span>
      {extra}
      <span style={{ fontSize:20,fontWeight:900,color,fontFamily:warrior,textShadow:show?`0 0 14px ${glow}`:"none",display:"flex",alignItems:"center",gap:4 }}>{value}{show && <span style={{ fontSize:13,animation:"fadeUp 0.4s ease-out" }}>↑</span>}</span>
    </div>
  );
  return (
    <div onClick={onClose} style={{ position:"fixed",inset:0,overflowY:"auto",overflowX:"hidden",zIndex:10010,background:"rgba(2,6,16,0.82)",backdropFilter:"blur(4px)",display:"flex",alignItems:"center",justifyContent:"center",padding:18,animation:"settingsFadeIn 0.25s ease-out" }}>
      <div onClick={e=>e.stopPropagation()} style={{ background:"linear-gradient(160deg, #0d1b32, #060e1f)",border:`2px solid ${rewards.isWin?"rgba(255,215,0,0.55)":"rgba(0,229,255,0.4)"}`,borderRadius:20,padding:"22px 20px 18px",maxWidth:340,width:"100%",boxShadow:`0 0 50px ${rewards.isWin?"rgba(255,215,0,0.25)":"rgba(0,229,255,0.18)"}, 0 24px 70px rgba(0,0,0,0.75)`,animation:"tutCardEnter 0.6s cubic-bezier(0.16,1,0.3,1)",position:"relative" }}>
        <button onClick={onClose} style={{ position:"absolute",top:10,right:10,width:30,height:30,borderRadius:"50%",background:"rgba(255,255,255,0.06)",border:`1px solid ${t.border}`,color:t.textDim,fontSize:14,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",padding:0 }}>✕</button>
        <div style={{ textAlign:"center",fontSize:17,fontWeight:900,color:rewards.isWin?t.gold:t.accent,fontFamily:warrior,letterSpacing:4,marginBottom:14,textShadow:`0 0 18px ${rewards.isWin?t.goldGlow:t.accentGlow}` }}>{rewards.isWin?"⚔ ":"🛡 "}{L(lang, rewards.isWin?"rewardTitleWin":"rewardTitleLoss")}</div>
        {rewards.revenge > 1 && <div style={{ textAlign:"center",fontSize:10,fontWeight:900,color:"#ff9a76",fontFamily:warrior,letterSpacing:2,marginBottom:10,textShadow:"0 0 10px rgba(255,90,50,0.6)" }}>{L(lang,"rewardRevengeRow")(rewards.revenge)}</div>}
        <Row show={row>=1} icon="💰" label={L(lang,"rewardGold")} value={`+${rewards.gold>0?goldShown:0}`} color={t.gold} glow={t.goldGlow} />
        <Row show={row>=2} icon="⚔" label={L(lang,"rewardHonor")} value={`+${rewards.honor}`} color="#a78bfa" glow="rgba(167,139,250,0.6)" />
        <Row show={row>=3} icon="⭐" label={L(lang,"rewardXp")} value={`+${rewards.xp % 1 === 0 ? rewards.xp : rewards.xp.toFixed(2)}`} color={t.accent} glow={t.accentGlow}
          extra={<div style={{ width:52,height:5,borderRadius:3,background:"rgba(0,0,0,0.5)",overflow:"hidden",marginRight:6 }}><div style={{ width:`${Math.round(lvlPct*100)}%`,height:"100%",background:`linear-gradient(90deg,${t.accent},#ffd700)`,transition:"width 1s ease 0.5s",borderRadius:3 }} /></div>} />
        {/* Günlük görevler — yapılanlar parlar */}
        <div style={{ display:"flex",alignItems:"center",gap:10,padding:"10px 14px",borderRadius:12,background:"rgba(255,255,255,0.035)",border:"1px solid rgba(255,255,255,0.06)",marginBottom:8,opacity:row>=4?1:0.25,transition:"opacity 0.4s" }}>
          <span style={{ flex:1,fontSize:10,fontWeight:800,color:t.textDim,fontFamily:warrior,letterSpacing:2 }}>{L(lang,"rewardMissionsRow")}</span>
          {(dailyMissions||[]).map(m => { const ok = !!missionProgress[m.id]; return (
            <span key={m.id} style={{ width:32,height:32,borderRadius:"50%",display:"flex",alignItems:"center",justifyContent:"center",fontSize:15,background:ok?"rgba(255,215,0,0.14)":"rgba(255,255,255,0.04)",border:`2px solid ${ok?"rgba(255,215,0,0.7)":"rgba(255,255,255,0.08)"}`,filter:ok?"none":"grayscale(1)",opacity:ok?1:0.4,animation:ok&&row>=4?"pulse 1.6s ease-in-out infinite":"none",boxShadow:ok&&row>=4?`0 0 12px ${t.goldGlow}`:"none" }}>{m.icon}</span>
          ); })}
        </div>
        {/* Yeni açılan kazanımlar — chink! */}
        {(newAch||[]).map((achItem, i) => (
          <div key={achItem.key} style={{ display:"flex",alignItems:"center",gap:10,padding:"10px 14px",borderRadius:12,background:"linear-gradient(135deg, rgba(255,215,0,0.12), rgba(255,159,67,0.05))",border:"1.5px solid rgba(255,215,0,0.6)",marginBottom:8,opacity:row>=5+i?1:0,transform:row>=5+i?"scale(1)":"scale(0.7)",transition:"all 0.4s cubic-bezier(0.34,1.56,0.64,1)",boxShadow:row>=5+i?`0 0 18px ${t.goldGlow}`:"none" }}>
            <span style={{ fontSize:20,filter:`drop-shadow(0 0 8px ${t.goldGlow})` }}>{achItem.icon}</span>
            <div style={{ flex:1 }}>
              <div style={{ fontSize:8,fontWeight:900,color:t.gold,fontFamily:warrior,letterSpacing:2 }}>🏅 {L(lang,"rewardAchRow")}</div>
              <div style={{ fontSize:11,fontWeight:800,color:t.text,fontFamily:mono,marginTop:1 }}>{en?achItem.textEn:achItem.text}</div>
            </div>
            <span style={{ fontSize:16,color:"#34d399",fontWeight:900,textShadow:"0 0 8px rgba(52,211,153,0.7)" }}>✓</span>
          </div>
        ))}
        <button onClick={onClose} style={{ width:"100%",marginTop:6,padding:"13px 0",background:rewards.isWin?"linear-gradient(135deg,#ffd700,#ff9f43)":`linear-gradient(135deg,${t.accent},#0891b2)`,color:rewards.isWin?"#1a1206":t.bg,border:"none",borderRadius:12,fontSize:14,fontWeight:900,letterSpacing:3,cursor:"pointer",fontFamily:warrior,boxShadow:rewards.isWin?`0 0 24px ${t.goldGlow}`:`0 0 24px ${t.accentGlow}`,animation:"btnBreath 2s ease-in-out infinite" }}>{L(lang,"rewardContinue")}</button>
      </div>
    </div>
  );
}

function BoardReview({ defenseBoard, shipColorMap, defenseOverlay, attackOverlay, oppShipsData, myShipsData, defHitMap, atkHitMap, cellSize, onBack, lang = "tr" }) {
  const [view,setView] = useState("attack");
  const oppBoard=emptyGrid(), oppColors=Array.from({length:ROWS},()=>Array(COLS).fill(null));
  if(oppShipsData){Object.values(oppShipsData).forEach(ship=>{const sd=SHIPS.find(s=>s.id===ship.id);ship.cells?.forEach(([r,c])=>{oppBoard[r][c]=1;oppColors[r][c]=sd?.color||t.shipCell;});});}
  return (<div style={{ display:"flex",flexDirection:"column",alignItems:"center",minHeight:"100vh",minHeight:"100dvh",background:t.bg,padding:"12px 8px",fontFamily:mono,color:t.text }}>
    <style>{ANIMS}</style>
    <div style={{ fontSize:18,fontWeight:700,color:t.accent,marginBottom:8,fontFamily:warrior,letterSpacing:3 }}>{L(lang,"battleMap")}</div>
    <div style={{ display:"flex",gap:0,marginBottom:8,width:"100%",maxWidth:400 }}>
      <button onClick={()=>setView("attack")} style={{ flex:1,padding:"8px 0",fontSize:12,fontWeight:700,fontFamily:warrior,cursor:"pointer",background:view==="attack"?t.accent:t.surfaceLight,color:view==="attack"?t.bg:t.textDim,border:`1px solid ${view==="attack"?t.accent:t.border}`,borderRadius:"8px 0 0 8px",letterSpacing:2 }}>{L(lang,"oppField")}</button>
      <button onClick={()=>setView("defense")} style={{ flex:1,padding:"8px 0",fontSize:12,fontWeight:700,fontFamily:warrior,cursor:"pointer",background:view==="defense"?t.accent:t.surfaceLight,color:view==="defense"?t.bg:t.textDim,border:`1px solid ${view==="defense"?t.accent:t.border}`,borderRadius:"0 8px 8px 0",letterSpacing:2 }}>{L(lang,"myField")}</button>
    </div>
    <div style={{ width:"100%",maxWidth:400 }}>
      {view==="attack"?<><Grid board={oppBoard} cellSize={cellSize} isDefense shipColors={oppColors} overlay={attackOverlay} disabled showShipStatus /><ShipStatusPanel title={L(lang,"oppShips")} ships={oppShipsData} hitCells={atkHitMap} color={t.hit} lang={lang} /></>:<><Grid board={defenseBoard} cellSize={placeCell} isDefense shipColors={shipColorMap} overlay={defenseOverlay} disabled showShipStatus /><ShipStatusPanel title={L(lang,"myShips")} ships={myShipsData} hitCells={defHitMap} color={t.accent} lang={lang} /></>}
    </div>
    <button onClick={onBack} style={{ marginTop:16,padding:"12px 32px",background:t.accent,color:t.bg,border:"none",borderRadius:8,fontSize:13,fontWeight:700,letterSpacing:2,cursor:"pointer",fontFamily:warrior }}>{L(lang,"backBtn")}</button>
  </div>);
}

function OnlineLobby({ myUid, myName, myGold, onChallenge, onBack, ready, onToggleReady, lang }) {
  const [players,setPlayers]=useState([]);const [invites,setInvites]=useState([]);const [sentInvite,setSentInvite]=useState(null);
  useEffect(()=>{const unsub=onValue(ref(db,"online_players"),snap=>{if(!snap.exists()){setPlayers([]);return;}const list=[];snap.forEach(child=>{const d=child.val();if(child.key!==myUid&&d.status==="idle")list.push({uid:child.key,...d});});list.sort((a,b)=>(b.gold||0)-(a.gold||0));setPlayers(list);});return()=>unsub();},[myUid]);
  const autoAcceptRef = useRef(false);
  useEffect(()=>{const unsub=onValue(ref(db,`invites/${myUid}`),snap=>{if(!snap.exists()){setInvites([]);autoAcceptRef.current=false;return;}const list=[];snap.forEach(child=>list.push({id:child.key,...child.val()}));setInvites(list);
    // HAZIRIM modundaysan düello davetini OTOMATİK kabul et — anında eşleşme
    if(ready&&!autoAcceptRef.current){const pending=list.find(i=>i.status==="pending");if(pending){autoAcceptRef.current=true;acceptInvite(pending);}}
  });return()=>unsub();},[myUid,ready]);
  useEffect(()=>{if(!sentInvite)return;const unsub=onValue(ref(db,`invites/${sentInvite.targetUid}/${myUid}`),snap=>{if(!snap.exists()){setSentInvite(null);return;}const d=snap.val();if(d.status==="accepted"&&d.roomId){remove(ref(db,`invites/${sentInvite.targetUid}/${myUid}`));remove(ref(db,`invites/${myUid}/${sentInvite.targetUid}`)).catch(()=>{});setSentInvite(null);onChallenge(d.roomId,1);}else if(d.status==="rejected"){remove(ref(db,`invites/${sentInvite.targetUid}/${myUid}`));setSentInvite(null);}});return()=>unsub();},[sentInvite,myUid,onChallenge]);
  // Ana eşleşme bildirimi — her zaman kendi uid'imizi dinliyoruz (quick-match'teki match_found deseniyle aynı,
  // sentInvite state'ine bağımlı değil, davet eden taraf için çok daha güvenilir).
  const matchFoundHandledRef = useRef(false);
  useEffect(()=>{
    if(!myUid) return;
    const unsub = onValue(ref(db,`match_found/${myUid}`), snap=>{
      if(!snap.exists() || matchFoundHandledRef.current) return;
      const d = snap.val(); if(!d.roomId) return;
      matchFoundHandledRef.current = true;
      remove(ref(db,`match_found/${myUid}`)).catch(()=>{});
      setSentInvite(null);
      onChallenge(d.roomId, d.playerNum || 1);
    });
    return ()=>unsub();
  },[myUid,onChallenge]);
  const acceptInvite=async(invite)=>{const roomId=Math.random().toString(36).substring(2,8).toUpperCase();await set(ref(db,`rooms/${roomId}`),{p1_name:invite.fromName,p1_uid:invite.id,p2_name:myName,p2_uid:myUid,phase:"placing",p1_board:null,p2_board:null,p1_ships:null,p2_ships:null,attacks:null,turn:1,clocks:{p1:CLOCK_SECONDS,p2:CLOCK_SECONDS},winner:null,winReason:null,eloProcessed:false,created:Date.now()});await set(ref(db,`match_found/${invite.id}`),{roomId,playerNum:1});await update(ref(db,`invites/${myUid}/${invite.id}`),{status:"accepted",roomId});setTimeout(()=>remove(ref(db,`invites/${myUid}/${invite.id}`)),3000);onChallenge(roomId,2);};
  // Karşılıklı düello: ikisi de birbirine aynı anda davet atarsa bekletmeden otomatik eşleştir.
  // Çift oda oluşmasın diye küçük UID'li taraf eşleştirmeyi tetikler, diğeri kendi bekleme dinleyicisinden yakalar.
  const mutualMatchedRef = useRef(false);
  useEffect(()=>{ mutualMatchedRef.current = false; },[sentInvite]);
  useEffect(()=>{
    if(!sentInvite || mutualMatchedRef.current) return;
    const mutual = invites.find(inv=>inv.id===sentInvite.targetUid && inv.status==="pending");
    if(mutual && myUid < sentInvite.targetUid){
      mutualMatchedRef.current = true;
      remove(ref(db,`invites/${sentInvite.targetUid}/${myUid}`)).catch(()=>{});
      acceptInvite(mutual);
    }
  },[invites,sentInvite,myUid]);
  const sendInvite=async(targetUid,targetName)=>{
    if(sentInvite)return;
    // Karşı taraf zaten bizi davet etmişse beklemeden direkt eşleştir
    const mutual = invites.find(inv=>inv.id===targetUid && inv.status==="pending");
    if(mutual){ acceptInvite(mutual); return; }
    await set(ref(db,`invites/${targetUid}/${myUid}`),{fromName:myName,fromGold:myGold||0,status:"pending",time:Date.now()});setSentInvite({targetUid,targetName});
  };
  const cancelInvite=async()=>{if(!sentInvite)return;await remove(ref(db,`invites/${sentInvite.targetUid}/${myUid}`));setSentInvite(null);};
  const rejectInvite=async(invite)=>{await update(ref(db,`invites/${myUid}/${invite.id}`),{status:"rejected"});setTimeout(()=>remove(ref(db,`invites/${myUid}/${invite.id}`)),2000);};
  return (<div style={{ display:"flex",flexDirection:"column",alignItems:"center",minHeight:"100vh",minHeight:"100dvh",background:t.bg,padding:"20px 12px",fontFamily:"'Space Mono',monospace",color:t.text }}>
    <div style={{ fontSize:22,fontWeight:700,letterSpacing:5,color:t.accent,marginBottom:4,fontFamily:"'Barlow Condensed',sans-serif",textShadow:`0 0 20px ${t.accentGlow}` }}>{L(lang,"onlineSalon")}</div>
    <div style={{ fontSize:10,color:t.textDim,letterSpacing:4,marginBottom:14,fontFamily:"'Barlow Condensed',sans-serif" }}>{L(lang,"activeSailors")}</div>
    <button onClick={onToggleReady} style={{ width:"100%",maxWidth:400,marginBottom:14,padding:"13px 0",background:ready?"linear-gradient(135deg,#34d399,#0d9488)":"rgba(255,255,255,0.05)",color:ready?"#04231a":t.textDim,border:`2px solid ${ready?"#34d399":t.border}`,borderRadius:12,fontSize:14,fontWeight:900,letterSpacing:2,cursor:"pointer",fontFamily:"'Barlow Condensed',sans-serif",textTransform:"uppercase",boxShadow:ready?"0 0 24px rgba(52,211,153,0.5)":"none",animation:ready?"borderGlow 2s infinite":"none",transition:"all 0.2s ease" }}>{ready?"✅":"⚡"} {L(lang,"readyToPlay")}</button>
    {ready && <div style={{ fontSize:10,color:"#34d399",fontFamily:"'Space Mono',monospace",marginBottom:14,textAlign:"center" }}>{L(lang,"readyHint")}</div>}
    {invites.filter(inv=>inv.status==="pending").map(invite=>(<div key={invite.id} style={{ width:"100%",maxWidth:400,marginBottom:8,padding:"12px 16px",background:"rgba(6,182,212,0.1)",border:`1px solid ${t.accent}`,borderRadius:10,animation:"borderGlow 2s infinite" }}>
      <div style={{ fontSize:12,color:t.accent,fontWeight:700,fontFamily:"'Barlow Condensed',sans-serif",letterSpacing:2,marginBottom:6,display:"flex",alignItems:"center",justifyContent:"center",gap:6 }}><XAnchors size={14} color={t.accent}/> {L(lang,"duelInvite")}</div>
      <div style={{ fontSize:13,color:t.text,marginBottom:8 }}><span style={{ fontWeight:700 }}>{invite.fromName}</span><span style={{ color:t.textDim,fontSize:10,marginLeft:8 }}>💰 {invite.fromGold||0}</span></div>
      <div style={{ display:"flex",gap:8 }}>
        <button onClick={()=>acceptInvite(invite)} style={{ flex:1,padding:"8px 0",background:`linear-gradient(135deg,${t.accent},#0891b2)`,color:t.bg,border:"none",borderRadius:6,fontSize:12,fontWeight:700,letterSpacing:2,cursor:"pointer",fontFamily:"'Barlow Condensed',sans-serif" }}>{L(lang,"accept")}</button>
        <button onClick={()=>rejectInvite(invite)} style={{ flex:1,padding:"8px 0",background:"transparent",color:t.hit,border:`1px solid ${t.hit}`,borderRadius:6,fontSize:12,fontWeight:700,letterSpacing:2,cursor:"pointer",fontFamily:"'Barlow Condensed',sans-serif" }}>{L(lang,"reject")}</button>
      </div>
    </div>))}
    {sentInvite&&(<div style={{ width:"100%",maxWidth:400,marginBottom:8,padding:"12px 16px",background:"rgba(251,191,36,0.08)",border:`1px solid ${t.gold}`,borderRadius:10 }}>
      <div style={{ fontSize:11,color:t.gold,fontFamily:"'Barlow Condensed',sans-serif",letterSpacing:2,marginBottom:4 }}>{L(lang,"inviteSent")}</div>
      <div style={{ fontSize:13,color:t.text,marginBottom:8 }}><span style={{ fontWeight:700 }}>{sentInvite.targetName}</span> {L(lang,"inviteWaiting")}<span style={{ display:"inline-block",marginLeft:6,animation:"pulse 1.5s infinite" }}>⏳</span></div>
      <button onClick={cancelInvite} style={{ padding:"6px 16px",background:"transparent",color:t.textDim,border:`1px solid ${t.border}`,borderRadius:6,fontSize:10,cursor:"pointer",fontFamily:"'Barlow Condensed',sans-serif",letterSpacing:1 }}>{L(lang,"cancelBtn")}</button>
    </div>)}
    {players.length===0?(<div style={{ width:"100%",maxWidth:400,padding:"30px 20px",textAlign:"center",background:t.surface,border:`1px solid ${t.border}`,borderRadius:10,marginTop:8 }}><div style={{ fontSize:24,marginBottom:8 }}>🌊</div><div style={{ fontSize:12,color:t.textDim }}>{L(lang,"noSailors")}</div><div style={{ fontSize:10,color:t.textDim,marginTop:4 }}>{L(lang,"noSailorsHint")}</div></div>):(
      <div style={{ width:"100%",maxWidth:400,display:"flex",flexDirection:"column",gap:4 }}>
        <div style={{ fontSize:9,color:t.textDim,letterSpacing:2,marginBottom:4 }}>{players.length} {L(lang,"sailorsActive")}</div>
        {players.map(p=>{const rank=getRankInfo(typeof p.honor==="number"?p.honor:((p.wins||0)*8+(p.losses||0)*3),lang);const alreadySent=sentInvite?.targetUid===p.uid;return(<div key={p.uid} style={{ display:"flex",alignItems:"center",gap:10,padding:"10px 14px",background:t.surface,border:`1px solid ${t.border}`,borderRadius:8 }}>
          <div style={{ width:8,height:8,borderRadius:"50%",background:"#34d399",boxShadow:"0 0 6px rgba(52,211,153,0.5)" }} />
          <div style={{ flex:1,minWidth:0 }}><div style={{ display:"flex",alignItems:"center",gap:6 }}><span style={{ fontSize:13,fontWeight:700,color:t.text,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap" }}>{p.displayName}</span><span style={{ fontSize:9,color:rank.color,fontFamily:"'Barlow Condensed',sans-serif",letterSpacing:1 }}>{rank.icon} {rank.title}</span>{p.ready && <span style={{ fontSize:8,fontWeight:900,color:"#04231a",background:"#34d399",padding:"2px 6px",borderRadius:5,letterSpacing:1,fontFamily:"'Barlow Condensed',sans-serif" }}>{L(lang,"ready")}</span>}</div><div style={{ fontSize:9,color:t.textDim,marginTop:1 }}>💰 {p.gold||0} • {p.wins||0}G/{p.losses||0}M</div></div>
          <button onClick={()=>sendInvite(p.uid,p.displayName)} disabled={!!sentInvite} style={{ padding:"6px 14px",background:alreadySent?t.surfaceLight:`linear-gradient(135deg,${t.hit},#dc2626)`,color:alreadySent?t.textDim:"#fff",border:"none",borderRadius:6,fontSize:10,fontWeight:700,letterSpacing:1,cursor:sentInvite?"default":"pointer",fontFamily:"'Barlow Condensed',sans-serif",opacity:sentInvite&&!alreadySent?0.4:1 }}>{alreadySent?L(lang,"waitingBadge"):L(lang,"duel")}</button>
        </div>);})}
      </div>
    )}
    <button onClick={onBack} style={{ marginTop:20,padding:"12px 32px",background:`linear-gradient(135deg,${t.accent},#0891b2)`,color:t.bg,border:"none",borderRadius:8,fontSize:13,fontWeight:700,letterSpacing:2,cursor:"pointer",fontFamily:"'Barlow Condensed',sans-serif",textTransform:"uppercase" }}>{L(lang,"backBtn")}</button>
  </div>);
}

function findMatch(myUid, myName, myGold, arenaId, timeoutMs = 60000) {
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
    // Üzerimdeki bayat kilidi temizle + kuyruğa gir
    await remove(ref(db, `matchmaking_claims/${myUid}`)).catch(() => {});
    await set(ref(db, `${queuePath}/${myUid}`), { displayName: myName, gold: myGold || STARTING_GOLD, time: Date.now() });
    onDisconnect(ref(db, `${queuePath}/${myUid}`)).remove();
    onDisconnect(ref(db, `matchmaking_claims/${myUid}`)).remove();

    // Zaman aşımı — arayan taraf karar verir (OYNA: kısa + bot garantisi, arena: uzun)
    timeoutId = setTimeout(() => {
      if (!resolved && !cancelled) {
        cancelled = true;
        cleanup();
        remove(ref(db, `${queuePath}/${myUid}`)).catch(() => {});
        remove(ref(db, `match_found/${myUid}`)).catch(() => {});
        remove(ref(db, `matchmaking_claims/${myUid}`)).catch(() => {});
        resolve(null);
      }
    }, timeoutMs);

    // match_found dinle — biri bizi kilitleyip odaya attıysa buradan öğreniriz
    unsubMatch = onValue(ref(db, `match_found/${myUid}`), async (snap) => {
      if (cancelled || resolved || !snap.exists()) return;
      const data = snap.val();
      if (!data.roomId) return;
      remove(ref(db, `match_found/${myUid}`)).catch(() => {});
      remove(ref(db, `${queuePath}/${myUid}`)).catch(() => {});
      remove(ref(db, `matchmaking_claims/${myUid}`)).catch(() => {});
      resolve(finish(data));
    });

    // Kuyruğu dinle — ANINDA KİLİT: iki taraf da deneyebilir, atomik transaction ilk kapanı seçer.
    // Altın penceresi YOK: kuyrukta kim varsa anında eşleş (en uzun bekleyen önce).
    unsubQueue = onValue(ref(db, queuePath), async (snap) => {
      if (cancelled || resolved || creating || !snap.exists()) return;
      const nowT = Date.now();
      const queue = [];
      snap.forEach(child => { const v = child.val() || {}; if (child.key !== myUid && (nowT - (v.time || 0)) < 30000) queue.push({ uid: child.key, ...v }); });
      if (queue.length === 0) return;
      queue.sort((a, b) => (a.time || 0) - (b.time || 0));
      const opponent = queue[0];

      creating = true;
      try {
        // ÇİFT KİLİT — sıralı alım: iki taraf da denese bile tek kazanan, tek oda
        const locked = await acquirePairLock(myUid, opponent.uid, myUid);
        if (!locked) { creating = false; return; }
        if (cancelled || resolved) { releasePairLock(myUid, opponent.uid); return; }

        // Rakip hâlâ kuyrukta mı? (çökmüş/ayrılmış olabilir)
        const oppCheck = await get(ref(db, `${queuePath}/${opponent.uid}`));
        if (!oppCheck.exists()) { releasePairLock(myUid, opponent.uid); creating = false; return; }

        const roomId = Math.random().toString(36).substring(2, 8).toUpperCase();
        await set(ref(db, `rooms/${roomId}`), { p1_name: myName, p1_uid: myUid, p2_name: opponent.displayName, p2_uid: opponent.uid, phase: "placing", p1_board: null, p2_board: null, p1_ships: null, p2_ships: null, attacks: null, turn: 1, clocks: { p1: CLOCK_SECONDS, p2: CLOCK_SECONDS }, winner: null, winReason: null, eloProcessed: false, arena: arenaId || null, created: Date.now() });

        // İki tarafın match_found'unu paralel yaz — rakip anında haberdar olur
        await Promise.all([
          set(ref(db, `match_found/${myUid}`), { roomId, playerNum: 1, oppName: opponent.displayName }),
          set(ref(db, `match_found/${opponent.uid}`), { roomId, playerNum: 2, oppName: myName }),
        ]);
        remove(ref(db, `${queuePath}/${myUid}`)).catch(() => {});
        releasePairLock(myUid, opponent.uid);
      } catch (e) {
        console.error("Match creation error:", e);
        creating = false;
      }
    });
  });

  promise._cancel = async () => {
    cancelled = true;
    cleanup();
    await remove(ref(db, `${queuePath}/${myUid}`)).catch(() => {});
    await remove(ref(db, `match_found/${myUid}`)).catch(() => {});
    await remove(ref(db, `matchmaking_claims/${myUid}`)).catch(() => {});
  };
  return promise;
}

// Salonda "OYUNA HAZIRIM" diyen (ready:true, status:"idle") en yakın altınlı oyuncuyu bulur.
async function findReadyCandidate(myUid, myGold) {
  try {
    const snap = await get(ref(db, "online_players"));
    if (!snap.exists()) return null;
    const list = [];
    snap.forEach(child => { const d = child.val(); if (child.key !== myUid && d && d.ready === true && d.status === "idle") list.push({ uid: child.key, ...d }); });
    if (list.length === 0) return null;
    list.sort((a, b) => Math.abs((a.gold || 0) - (myGold || 0)) - Math.abs((b.gold || 0) - (myGold || 0)));
    return list[0];
  } catch (e) { return null; }
}

// === ÇİFT KİLİT (lock ordering) — iki taraf aynı anda eşleşmeye kalksa bile TEK oda kurulmasını garantiler.
// Kilitler her zaman küçük uid'nin düğümünden başlayarak alınır; ilk düğümde çarpışan taraflardan
// yalnızca biri transaction'ı kazanır. Kazanan iki kilidi de alır ve odayı kurar.
async function acquirePairLock(uidA, uidB, myUid) {
  const [first, second] = [uidA, uidB].sort();
  const nowT = Date.now();
  const tryLock = async (uid) => {
    try {
      const tx = await runTransaction(ref(db, `matchmaking_claims/${uid}`), cur => {
        if (cur && cur.by && cur.by !== myUid && (nowT - (cur.t || 0)) < 15000) return; // taze kilit başkasının
        return { by: myUid, t: nowT };
      });
      return tx.committed && tx.snapshot.exists() && tx.snapshot.val().by === myUid;
    } catch (e) { return false; }
  };
  if (!(await tryLock(first))) return false;
  if (!(await tryLock(second))) { remove(ref(db, `matchmaking_claims/${first}`)).catch(() => {}); return false; }
  return true;
}
function releasePairLock(uidA, uidB) { [uidA, uidB].forEach(u => remove(ref(db, `matchmaking_claims/${u}`)).catch(() => {})); }

// HAZIRIM diyen oyuncuyla ANINDA eşleş — davet/kabul yok: HAZIRIM demek "sormadan eşleştir" demektir.
// Atomik kilit ile iki OYNA'cının aynı hazır oyuncuyu kapması engellenir.
async function instantMatchWithReady(myUid, myName, candidate) {
  try {
    // ÇİFT KİLİT — karşılıklı anında eşleşme denemelerinde bile tek oda garantisi
    const locked = await acquirePairLock(myUid, candidate.uid, myUid);
    if (!locked) return null;
    // Hâlâ hazır ve boşta mı?
    const pSnap = await get(ref(db, `online_players/${candidate.uid}`));
    if (!pSnap.exists() || pSnap.val().ready !== true || pSnap.val().status !== "idle") { releasePairLock(myUid, candidate.uid); return null; }
    const roomId = Math.random().toString(36).substring(2, 8).toUpperCase();
    await set(ref(db, `rooms/${roomId}`), { p1_name: myName, p1_uid: myUid, p2_name: candidate.displayName || "Denizci", p2_uid: candidate.uid, phase: "placing", p1_board: null, p2_board: null, p1_ships: null, p2_ships: null, attacks: null, turn: 1, clocks: { p1: CLOCK_SECONDS, p2: CLOCK_SECONDS }, winner: null, winReason: null, eloProcessed: false, arena: null, created: Date.now() });
    await set(ref(db, `match_found/${candidate.uid}`), { roomId, playerNum: 2, oppName: myName });
    releasePairLock(myUid, candidate.uid);
    return { roomId, playerNum: 1 };
  } catch (e) { return null; }
}

// Hazır bulunan oyuncuya doğrudan davet gönderir, kabul/red/zaman aşımını bekler.

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
  // Profilin her zaman güncel kopyası. Sayaç artırıcıları (bumpAch/bumpDaily/bumpVoyageMatch)
  // bunu okur; böylece veritabanı yazımı React'in state güncelleyicisinin DIŞINDA kalır.
  // Güncelleyici içinde yan etki yapmak React'te yasaktır: React o fonksiyonu iki kez
  // çağırabilir ve aynı maç iki kez sayılabilirdi.
  const myProfileRef = useRef(null);
  useEffect(() => { myProfileRef.current = myProfile; }, [myProfile]);
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const [showCodeModal, setShowCodeModal] = useState(null);   // yeni üretilen kurtarma kodu
  const [recoverOpen, setRecoverOpen] = useState(false);      // "isim alınmış → kod gir" penceresi
  const [recoverName, setRecoverName] = useState("");
  const [recoverCode, setRecoverCode] = useState("");
  const [recoverBusy, setRecoverBusy] = useState(false);
  const [recoverErr, setRecoverErr] = useState("");
  const [codeCopied, setCodeCopied] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false);         // emoji paneli açık mı
  const [emojiCooldown, setEmojiCooldown] = useState(false); // spam engeli (3 sn)
  const roomCleanupRef = useRef(null); // maç sonu oda silme zamanlayıcısı
  const sweptRef = useRef(false);      // eski oda süpürmesi oturumda bir kez

  const [showLeaderboard, setShowLeaderboard] = useState(false);
  const [showAchievements, setShowAchievements] = useState(false);
  const [dailyOpen, setDailyOpen] = useState(false);
  const [revengeResult, setRevengeResult] = useState(null); // { mult } — intikam alındığında maç sonunda gösterilir
  const [voyageReward, setVoyageReward] = useState(null); // { gold, hours } — sefer dönüşü karşılaması
  const voyageCheckedRef = useRef(false);
  const [matchRewards, setMatchRewards] = useState(null); // { gold, xp, honor, revenge, isWin } — maç sonu ödül raporu
  const [rewardModalOpen, setRewardModalOpen] = useState(false);
  const [newAchUnlocks, setNewAchUnlocks] = useState([]); // bu maçta açılan kazanımlar
  const achDoneRef = useRef(null); // "setId:idx" kümesi — yeni açılan kazanımı tespit için
  const [rewardNonce, setRewardNonce] = useState(0); // her yeni maç raporunda modalı taze yeniden monte eder
  const [sailNotice, setSailNotice] = useState(false); // "sefere çıkıyoruz" karşılaması (oturumda bir kez)
  const sailShownRef = useRef(false);
  const [eloChange, setEloChange] = useState(null);
  const [showOnlineLobby, setShowOnlineLobby] = useState(false);
  const [matchmaking, setMatchmaking] = useState(false);
  const [matchCancelFn, setMatchCancelFn] = useState(null);
  const [quickMatchPhase, setQuickMatchPhase] = useState(null); // null | 'searching' | 'found' | 'notfound'
  const [quickMatchCandidate, setQuickMatchCandidate] = useState(null);
  const [quickMatchOpponent, setQuickMatchOpponent] = useState(null);
  const [quickMatchSecondsLeft, setQuickMatchSecondsLeft] = useState(30);
  const quickMatchCarouselRef = useRef(null);
  const quickMatchCountdownRef = useRef(null);
  const lastQuickMatchArenaRef = useRef(null);
  const quickMatchCancelledRef = useRef(false);
  const [readyToPlay, setReadyToPlay] = useState(false);
  const [incomingInvite, setIncomingInvite] = useState(null);
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
  const [chestReward, setChestReward] = useState(null);
  const [chestClaimed, setChestClaimed] = useState(false);
  const [gameStartTime, setGameStartTime] = useState(null);
  const [hitStreak, setHitStreak] = useState(0);
  const [streakToast, setStreakToast] = useState(null);
  const [onlineCount, setOnlineCount] = useState(0);
  const [musicOn, setMusicOn] = useState(true);
  const [showSettings, setShowSettings] = useState(false);
  const [settingsView, setSettingsView] = useState(null); // null | 'profile' | 'privacy' | 'delete' | 'deleting'
  const [musicVolume, setMusicVolumeState] = useState(() => { try { const v = localStorage.getItem('ab_musicVolume'); return v !== null ? parseInt(v,10) : 50; } catch(e) { return 50; } });
  const [sfxOnState, setSfxOnState] = useState(() => { try { const v = localStorage.getItem('ab_sfxOn'); return v !== null ? v === '1' : true; } catch(e) { return true; } });
  const [notifOn, setNotifOn] = useState(() => { try { const v = localStorage.getItem('ab_notifOn'); return v !== null ? v === '1' : true; } catch(e) { return true; } });
  const [appLang, setAppLang] = useState(() => {
    try {
      const saved = localStorage.getItem('ab_lang');
      if (saved) return saved;
      if (typeof navigator !== "undefined" && navigator.language) {
        return navigator.language.toLowerCase().startsWith("tr") ? "tr" : "en";
      }
    } catch (e) {}
    return "tr";
  });
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
  const lastKnownTurnRef = useRef(null); // null = henüz bilinmiyor — saldiri/savunma otomatik geçişi için
  const activeBoardTimerRef = useRef(null); // atış sonucu görülsün diye 2sn gecikmeli tahta geçişi
  const phaseRef = useRef("splash");
  const lastAttackCountRef = useRef(0);
  const eloUpdatedRef = useRef(false);

  // Kazanım seti ödülünü al — altın + özel avatar
  const claimAchievementSet = (setDef) => {
    if (!myProfile || !authUid) return;
    const cl = safeClaimed(myProfile.achievClaimed);
    if (cl[setDef.id] || !achSetDone(setDef, myProfile)) return;
    track("reward_claim", { type: "achievement_set", set: setDef.id, gold: setDef.reward });
    sfx.init(); sfx.play('chest'); setTimeout(() => sfx.play('gold'), 350);
    const a2 = safeAch(myProfile.ach); a2.goldEarned += setDef.reward;
    const nc = { ...cl, [setDef.id]: true };
    const newGold = safeGold(myProfile.gold) + setDef.reward;
    update(ref(db, `profiles/${authUid}`), { gold: newGold, ach: a2, achievClaimed: nc }).catch(()=>{});
    setMyProfile(prev => prev ? { ...prev, gold: newGold, ach: a2, achievClaimed: nc } : prev);
    setGoldAnim({ amount: setDef.reward });
  };

  // Her yeni maç raporu geldiğinde nonce'u tazele — RewardModal remount olsun, animasyon her seferinde çalışsın
  useEffect(() => { if (matchRewards && rewardModalOpen) setRewardNonce(n => n + 1); }, [matchRewards, rewardModalOpen]);

  // GARANTİ: maç bitti ve 1.5 sn içinde rapor gelmediyse (online ELO zinciri gecikmiş/kopmuş olabilir)
  // eldeki verilerle raporu yine de göster — oyuncu ganimetini ASLA göremeden kalmasın.
  useEffect(() => {
    if (phase !== "gameover" || isOnboarding) return;
    const tm = setTimeout(() => {
      setMatchRewards(prev => {
        if (prev) return prev;
        const diff = eloChange ? Math.max(0, (eloChange.myNew || 0) - (eloChange.myOld || 0)) : (goldChange?.amount || 0);
        setRewardModalOpen(true);
        return {
          gold: isWin ? diff : 0,
          xp: isWin ? (isBotGameRef.current ? XP_BOT_WIN : XP_ONLINE_WIN) : (isBotGameRef.current ? XP_BOT_LOSS : XP_ONLINE_WIN * 0.25),
          honor: isWin ? (isBotGameRef.current ? HONOR_WIN_BOT : HONOR_WIN_ONLINE) : (isBotGameRef.current ? HONOR_LOSS_BOT : HONOR_LOSS_ONLINE),
          revenge: 1, isWin,
        };
      });
    }, 1500);
    return () => clearTimeout(tm);
  }, [phase, isOnboarding, isWin, eloChange, goldChange]);

  // Yeni açılan kazanımları yakala — profil her değiştiğinde tamamlanan kazanım kümesini karşılaştır
  useEffect(() => {
    if (!myProfile) return;
    const a = safeAch(myProfile.ach);
    const done = new Set();
    const doneDefs = [];
    ACH_SETS.forEach(s => s.missions.forEach((m, i) => { try { if (m.check(myProfile, a)) { done.add(`${s.id}:${i}`); doneDefs.push({ key: `${s.id}:${i}`, icon: m.icon, text: m.text, textEn: m.textEn }); } } catch(e) {} }));
    if (achDoneRef.current === null) { achDoneRef.current = done; return; } // ilk yükleme — rapor yok
    const fresh = doneDefs.filter(d => !achDoneRef.current.has(d.key));
    achDoneRef.current = done;
    if (fresh.length > 0 && (phase === "playing" || phase === "gameover")) setNewAchUnlocks(prev => [...prev, ...fresh]);
  }, [myProfile, phase]);

  // Sefer kapasitesi: her biten maç bugünün sefer süresini uzatır
  const bumpVoyageMatch = () => {
    const prev = myProfileRef.current;
    if (!prev) return;
    const v = safeVoyage(prev.voyage); const tk = todayKey();
    if (v.dayKey !== tk) { v.dayKey = tk; v.matches = 1; } else { v.matches += 1; }
    if (!v.lastClaim) v.lastClaim = Date.now();
    myProfileRef.current = { ...prev, voyage: v };
    setMyProfile(p => p ? { ...p, voyage: v } : p);
    if (authUid) update(ref(db, `profiles/${authUid}`), { voyage: v }).catch(()=>{});
  };

  // GÜNLÜK GİRİŞ ÖDÜLÜ — bu özellik yazılmış ama HİÇ ÇAĞRILMIYORDU (ölü kod denetiminde çıktı).
  // Günde en fazla 3 kez, giriş serisine göre artan altın verir.
  const loginRewardRef = useRef(false);
  useEffect(() => {
    if (phase !== "lobby" || !authUid || !myProfile || loginRewardRef.current) return;
    loginRewardRef.current = true;
    const tm = setTimeout(async () => {
      try {
        const r = await checkDailyReward(authUid);
        if (r && r.reward > 0) setDailyReward(r);
      } catch (e) {}
    }, 1600); // sefer/ganimet pencereleriyle çakışmasın
    return () => clearTimeout(tm);
  }, [phase, authUid, myProfile]);

  // ÖKSÜZ ODA TEMİZLİĞİ — oturumda bir kez. Önceki oturumda çökme/kapanma yüzünden
  // ortada kalan kendi odamızı siler; veritabanının şişmesini engeller.
  useEffect(() => {
    if (phase !== "lobby" || !authUid || sweptRef.current) return;
    sweptRef.current = true;
    const tm = setTimeout(() => { cleanupOrphanRoom(); }, 4000); // açılış yükünü bloklamasın
    return () => clearTimeout(tm);
  }, [phase, authUid]);

  // "SEFERE ÇIKIYORUZ" karşılaması — oyun açılınca bir kez, ganimet penceresi yoksa
  useEffect(() => {
    if (phase !== "lobby" || !myProfile || sailShownRef.current) return;
    sailShownRef.current = true;
    const tm = setTimeout(() => { if (!voyageReward) setSailNotice(true); }, 900);
    return () => clearTimeout(tm);
  }, [phase, myProfile]);

  // Sefer dönüşü kontrolü — lobiye ilk girişte bir kez
  useEffect(() => {
    if (phase !== "lobby" || !myProfile || !authUid || voyageCheckedRef.current) return;
    voyageCheckedRef.current = true;
    const v = safeVoyage(myProfile.voyage);
    const now = Date.now();
    if (!v.lastClaim) {
      const nv = { ...v, lastClaim: now };
      update(ref(db, `profiles/${authUid}`), { voyage: nv }).catch(()=>{});
      setMyProfile(p => p ? { ...p, voyage: nv } : p);
      return;
    }
    const capMs = voyageCapH(v.matches) * 3600000;
    const effMs = Math.max(0, Math.min(now - v.lastClaim, capMs));
    const hours = effMs / 3600000;
    const earned = Math.floor(hours * voyageRate(migrateHonor(myProfile)));
    if (earned >= 15) setVoyageReward({ gold: earned, hours: Math.round(hours * 10) / 10 });
  }, [phase, myProfile, authUid]);

  // Sefer ganimetini topla
  const claimVoyage = () => {
    if (!voyageReward || !myProfile || !authUid) return;
    const g = voyageReward.gold;
    track("reward_claim", { type: "voyage", gold: g, hours: voyageReward.hours });
    sfx.init(); sfx.play('gold');
    const nv = { ...safeVoyage(myProfile.voyage), lastClaim: Date.now() };
    const va = safeAch(myProfile.ach); va.goldEarned += g;
    const newGold = safeGold(myProfile.gold) + g;
    update(ref(db, `profiles/${authUid}`), { gold: newGold, voyage: nv, ach: va }).catch(()=>{});
    setMyProfile(prev => prev ? { ...prev, gold: newGold, voyage: nv, ach: va } : prev);
    setGoldAnim({ amount: g });
    setVoyageReward(null);
  };

  // GÜNLÜK GÖREV sayaçlarını güncelle — profile yazılır, uygulama kapansa da kaybolmaz.
  // Gün değişince safeDaily otomatik sıfırlar.
  const bumpDaily = (fn) => {
    const prev = myProfileRef.current;
    if (!prev) return;
    const d = safeDaily(prev.daily);
    try { fn(d); } catch (e) {}
    myProfileRef.current = { ...prev, daily: d }; // aynı karede peş peşe çağrılırsa birikerek gitsin
    setMyProfile(p => p ? { ...p, daily: d } : p);
    if (authUid) update(ref(db, `profiles/${authUid}`), { daily: d }).catch(() => {});
  };

  // Kazanım sayaçlarını güncelle — fn(a) sayaç kopyasını mutasyona uğratır, DB + local senkronize edilir
  const bumpAch = (fn) => {
    const prev = myProfileRef.current;
    if (!prev) return;
    const a = safeAch(prev.ach);
    try { fn(a); } catch(e) {}
    myProfileRef.current = { ...prev, ach: a };
    setMyProfile(p => p ? { ...p, ach: a } : p);
    if (authUid) update(ref(db, `profiles/${authUid}`), { ach: a }).catch(()=>{});
  };

  // Bot maçı mağlubiyetini kaydet — her yenilgi yolundan (batma, süre, yerleştirememe) çağrılır.
  // Ref üzerinden tutulur ki interval/timeout closure'ları her zaman güncel profile erişsin.
  const recordBotLossRef = useRef(null);
  recordBotLossRef.current = () => {
    if (!authUid || !myProfile || isOnboarding) return;
    // Kaybeden altın kaybetmez ama kazanmaz da — XP: kazanılanın %25'i
    const lvl2 = applyLevelCredit(myProfile, XP_BOT_LOSS);
    update(ref(db, `profiles/${authUid}`), { losses: (myProfile.losses||0)+1, totalGames: (myProfile.totalGames||0)+1, botGames: (myProfile.botGames||0)+1, lastGameAt: Date.now(), level: lvl2.level, levelProgress: lvl2.levelProgress, recentResults: pushRecent(myProfile.recentResults, false), honor: migrateHonor(myProfile) + HONOR_LOSS_BOT }).catch(()=>{});
    setMyProfile(prev => prev ? { ...prev, losses:(prev.losses||0)+1, totalGames:(prev.totalGames||0)+1, botGames:(prev.botGames||0)+1, level: lvl2.level, levelProgress: lvl2.levelProgress, recentResults: pushRecent(prev.recentResults, false), honor: migrateHonor(prev) + HONOR_LOSS_BOT } : prev);
    bumpDaily(d => { d.gamesPlayed += 1; });
    setMatchRewards({ gold: 0, xp: XP_BOT_LOSS, honor: HONOR_LOSS_BOT, revenge: 1, isWin: false }); setRewardModalOpen(true);
    track("game_end", { mode: "bot", result: "loss" });
    // Kazanım sayaçları: mağlubiyette isabet/batırma yine sayılır, seriler sıfırlanır
    bumpAch(a => { a.hits += myHits; a.sunk += killCountRef.current; a.winStreak = 0; a.turnStreak = 0; a.lossStreak = (a.lossStreak||0) + 1; });
    bumpGlobalStats(1, killCountRef.current);
    bumpVoyageMatch();
  };

  // Ekran ölçüsünü canlı takip et — telefon döndürülünce veya klavye açılınca tahta yeniden ölçeklenir.
  const [viewport, setViewport] = useState({ w: 390, h: 800 });
  // Tahta alanını TAHMİN etmek yerine ÖLÇÜYORUZ. Üstteki/alttaki kontroller ne kadar yer
  // kaplarsa kaplasın, tahta kalan boşluğa tam oturur — hiçbir cihazda taşma/kırpılma olmaz.
  const boardBoxRef = useRef(null);
  const [boardBox, setBoardBox] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = boardBoxRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(entries => {
      const r = entries[0]?.contentRect;
      if (r) setBoardBox({ w: r.width, h: r.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [phase, activeBoard]);
  // 12 = 11 hücre + 1 etiket satırı/sütunu
  const fitCell = (pad = 12) => {
    if (!boardBox.w || !boardBox.h) return 0;
    return Math.max(12, Math.min(30, Math.floor((Math.min(boardBox.w, boardBox.h) - pad) / 12)));
  };
  useEffect(() => {
    const measure = () => setViewport({ w: window.innerWidth, h: window.innerHeight });
    measure();
    window.addEventListener("resize", measure);
    window.addEventListener("orientationchange", measure);
    return () => { window.removeEventListener("resize", measure); window.removeEventListener("orientationchange", measure); };
  }, []);
  // Tahta genişliği: 11 sütun (1 etiket + 10 hücre) + kenar payları ekranı ASLA aşmaz.
  const gutter = Math.min(16, Math.max(10, viewport.w * 0.04)) * 2; // appStyle yatay boşluğu
  const cellSize = Math.max(16, Math.min(30,
    Math.floor((Math.min(viewport.w - gutter - 16, 400)) / 11),
    Math.floor((viewport.h - 300) / 12)
  ));
  useEffect(() => { myTurnRef.current = myTurn; }, [myTurn]);
  useEffect(() => {
    if (phase === "lobby" && authUid && myProfile && !hasClaimedDailyChestToday()) setShowDailyChest(true);
  }, [phase, authUid, myProfile]);
  const claimDailyChest = async (amount) => {
    track("reward_claim", { type: "daily_chest", gold: amount });
    markDailyChestClaimed();
    setGoldAnim({ amount });
    setMyProfile(prev => { if (!prev) return prev; const a = safeAch(prev.ach); a.chest += 1; a.goldEarned += amount; return { ...prev, gold: safeGold(prev.gold) + amount, ach: a }; });
    if (authUid) {
      try {
        const snap = await get(ref(db, `profiles/${authUid}`));
        if (snap.exists()) { const p = snap.val(); const a = safeAch(p.ach); a.chest += 1; a.goldEarned += amount; await set(ref(db, `profiles/${authUid}`), { ...p, gold: safeGold(p.gold) + amount, ach: a }); }
      } catch (e) { console.error(e); }
    }
    setDailyChestModalOpen(false); setShowDailyChest(false);
  };
  useEffect(() => { phaseRef.current = phase; }, [phase]);

  // ANALİTİK — ekran geçişleri (hangi ekranda bırakıldığını görmek için)
  useEffect(() => {
    if (!phase) return;
    track("screen_view", { firebase_screen: phase, firebase_screen_class: "Game" });
  }, [phase]);

  // ANALİTİK — oyuncu kimliği ve seviye/rütbe özellikleri
  useEffect(() => {
    if (!authUid || !myProfile) return;
    identify(authUid, {
      level: String(myProfile.level || 0),
      rank: getRankInfo(migrateHonor(myProfile), "tr").title,
      total_games: String(myProfile.totalGames || 0),
      lang: appLang,
    });
  }, [authUid, myProfile?.level, appLang]);

  // Görev ilerlemesi — artık KALICI günlük istatistiklerden hesaplanır (profilden gelir)
  const dailyStats = safeDaily(myProfile?.daily);
  useEffect(() => {
    const newProgress = {};
    dailyMissions.forEach(m => { try { if (m.check(dailyStats)) newProgress[m.id] = true; } catch (e) {} });
    setMissionProgress(newProgress);
  }, [myProfile?.daily, dailyMissions]);

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
    set(presenceRef, { displayName: playerName.trim(), gold: safeGold(myProfile?.gold), honor: migrateHonor(myProfile), wins: myProfile?.wins || 0, losses: myProfile?.losses || 0, status: "idle", lastSeen: Date.now(), ready: readyToPlay, avatar: myProfile?.avatar || "⚓" });
    onDisconnect(presenceRef).remove();
    return () => { remove(presenceRef); };
  }, [authUid, playerName, phase, myProfile?.gold, readyToPlay]);

  useEffect(() => {
    if (phase === "placing" && !placementConfirmed) {
      if (placementTimerRef.current) clearInterval(placementTimerRef.current);
      placementTimerRef.current = setInterval(() => { setPlacementTimer(prev => {
        if (prev <= 1) {
          clearInterval(placementTimerRef.current);
          // Süre bitti — kaybettin
          if (isBotGame) {
            setWinner(appLang==="en"?"You lost because you didn't place your ships in time!":"Gemileri zamanında yerleştiremediğin için kaybettin!"); setIsWin(false); setPhase("gameover");
            sfx.init(); sfx.play('lose'); sfx.playDefeatMusic();
            recordBotLossRef.current?.();
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
        if (myTurnRef.current) { myClockRef.current = Math.max(0, myClockRef.current - 1); setMyClock(myClockRef.current); if (myClockRef.current <= 0) { clearInterval(clockIntervalRef.current); if (isBotGameRef.current) { setWinner(appLang==="en"?"Time's up!":"Süren doldu!"); setIsWin(false); setPhase("gameover"); sfx.init(); sfx.play('lose'); sfx.playDefeatMusic(); recordBotLossRef.current?.(); } else { update(ref(db, `rooms/${roomIdRef.current}`), { winner: playerNumRef.current === 1 ? 2 : 1, winReason: "timeout" }); } } }
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
    lastKnownTurnRef.current = null; // yeni oda — saldiri/savunma otomatik geçişini sıfırdan öğren
    if (activeBoardTimerRef.current) { clearTimeout(activeBoardTimerRef.current); activeBoardTimerRef.current = null; }
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
        const nowMyTurn = game.turn === pNum;
        // Sadece odaya ilk girişte anında doğru tahtayı göster. Sonraki geçişler
        // atış sonucunu görebilsin diye aşağıdaki attacks bloğunda 2sn gecikmeli yapılır.
        if (lastKnownTurnRef.current === null) {
          lastKnownTurnRef.current = nowMyTurn;
          setActiveBoard(nowMyTurn ? "attack" : "defense");
        } else {
          lastKnownTurnRef.current = nowMyTurn;
        }
        setMyTurn(nowMyTurn);
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
            // Nereyi vurduğunu görsün diye 2sn savunmada kal, sonra (sıra bendeyse) saldırıya geç
            if (activeBoardTimerRef.current) clearTimeout(activeBoardTimerRef.current);
            if (!game.winner && game.turn === pNum) { activeBoardTimerRef.current = setTimeout(() => setActiveBoard("attack"), 2000); }
            // Sound for incoming hits
            const incomingHits = lastAtk.shots.filter(s => s.result === "hit").length;
            sfx.init(); if (incomingHits > 0) sfx.play('hit');
            if (game[`${myKey}_ships`]) { const myShips = Object.values(game[`${myKey}_ships`]); const reports = []; lastAtk.shots.forEach(s => { if (s.result === "hit") { const hitShip = myShips.find(sh => sh.cells.some(([r, c]) => r === s.r && c === s.c)); if (hitShip) { const shipDef = SHIPS.find(sd => sd.id === hitShip.id); const shipName = appLang === "en" ? (shipDef?.nameEn || shipDef?.name) : shipDef?.name; const totalH = hitShip.cells.filter(([r, c]) => dHitMap[r][c]).length; const sunkNow = totalH === hitShip.cells.length; reports.push({ text: sunkNow ? (appLang==="en"?`${shipName} sank!`:`${shipName} battı!`) : (appLang==="en"?`${shipName} took ${totalH} hit${totalH>1?'s':''}`:`${shipName} ${totalH}. yarasını aldı`), sunk: sunkNow }); } } }); if (reports.length > 0) { setDamageReport(reports.map(r=>r.text).join(" • ")); if (!firstHitVoiceRef.current) { firstHitVoiceRef.current = true; sfx.playVoice('first_kill'); } setMicroFeedback({ text: reports.length ? reports[reports.length-1].text.toLocaleUpperCase(appLang==='en'?'en-US':'tr-TR') : fbPick(appLang==="en"?FB_GOT_HIT_EN:FB_GOT_HIT), color: t.hit }); if (damageTimerRef.current) clearTimeout(damageTimerRef.current); damageTimerRef.current = setTimeout(() => setDamageReport(""), 8000); if (reports.some(r => r.sunk)) setTimeout(() => { sfx.play('sunk'); launchExplosion('confetti-canvas', window.innerWidth/2, window.innerHeight/2); }, 200); } }
          }
          if (lastAtk.by === pNum && lastAtk.shots) {
            setBlinkCells(lastAtk.shots.map(s => [s.r, s.c])); if (blinkTimerRef.current) clearTimeout(blinkTimerRef.current); blinkTimerRef.current = setTimeout(() => setBlinkCells([]), 3000);
            // Nereyi vurduğunu görsün diye 2sn saldırıda kal, sonra savunmaya geç
            if (activeBoardTimerRef.current) clearTimeout(activeBoardTimerRef.current);
            if (!game.winner) { activeBoardTimerRef.current = setTimeout(() => setActiveBoard("defense"), 2000); }
            // Sound for own shots landing
            const myHitCount = lastAtk.shots.filter(s => s.result === "hit").length;
            sfx.init(); if (!isBotGame) { const shotN = (lastAtk.shots||[]).length; bumpDaily(d => { if (myHitCount >= 3) d.perfectTurn3 = true; if (myHitCount > 0 && myHitCount === shotN) { d.perfectTurn = true; d.perfectTurns += 1; } d.streakHits = Math.max(d.streakHits, myHitCount); }); } if (myHitCount > 0) { sfx.play('hit'); sfx.setBattleIntensity(0.55 + myHitCount * 0.1); const wasFirstO = !firstHitVoiceRef.current; firstHitVoiceRef.current = true; sfx.playVolleyVoice(myHitCount, wasFirstO); const hit3b=appLang==="en"?FB_HIT3_EN:FB_HIT3, hit2b=appLang==="en"?FB_HIT2_EN:FB_HIT2, hit1b=appLang==="en"?FB_HIT1_EN:FB_HIT1; setMicroFeedback({ text: fbPick(myHitCount === 3 ? hit3b : myHitCount === 2 ? hit2b : hit1b), color: myHitCount === 3 ? t.gold : t.accent }); } else { sfx.play('miss'); sfx.setBattleIntensity(0.18); setMicroFeedback({ text: fbPick(appLang==="en"?FB_MISS_EN:FB_MISS), color: '#4dd8ff' }); }
          }
        }
      }
      if (game.winner) {
        const reason = game.winReason || "hits", iW = game.winner === pNum;
        let winMsg = appLang === "en"
          ? (iW ? (reason === "timeout" ? "Time's up — Opponent eliminated!" : reason === "placement_timeout" ? "You won — opponent couldn't place ships in time!" : reason === "surrender" ? "Opponent surrendered!" : reason === "afk_timeout" ? "Opponent didn't play — You won!" : "You sank all their ships!") : (reason === "timeout" ? "Time's up!" : reason === "placement_timeout" ? "You lost because you didn't place your ships in time!" : reason === "surrender" ? "You surrendered!" : reason === "afk_timeout" ? "You lost for not playing!" : "Your ships were sunk!"))
          : (iW ? (reason === "timeout" ? "Süre bitti — Rakip elendi!" : reason === "placement_timeout" ? "Rakip gemileri zamanında yerleştiremediği için kazandın!" : reason === "surrender" ? "Rakip teslim oldu!" : reason === "afk_timeout" ? "Rakip oynamadı — Kazandın!" : "Tüm gemileri batırdın!") : (reason === "timeout" ? "Süren doldu!" : reason === "placement_timeout" ? "Gemileri zamanında yerleştiremediğin için kaybettin!" : reason === "surrender" ? "Teslim oldun!" : reason === "afk_timeout" ? "Oynamadığın için kaybettin!" : "Gemilerin battı!"));
        setWinner(winMsg); setIsWin(iW); setPhase("gameover");
        // ODA TEMİZLİĞİ — yalnızca 1. oyuncu siler (tek sorumlu, çift silme yok).
        // 45 sn gecikme iki tarafın da sonucu okumasına yeter.
        if (pNum === 1 && !roomCleanupRef.current) {
          roomCleanupRef.current = deleteRoomSoon(roomIdRef.current, 45000);
        }
        sfx.init(); sfx.play(iW ? 'win' : 'lose');
        if (iW) { setTimeout(() => sfx.playEpicMusic(), 500); setTimeout(() => launchConfetti('confetti-canvas'), 300); }
        else { setTimeout(() => sfx.playDefeatMusic(), 500); }
        if (clockIntervalRef.current) clearInterval(clockIntervalRef.current);

        // MAÇ SONUCU — her oyuncu KENDİ profilini yazar (Firebase kuralları başkasınınkine izin vermez).
        // Rakibi beklemeye gerek yok: kazanan da kaybeden de ödülünü anında alır.
        if (!eloUpdatedRef.current && game.p1_uid && game.p2_uid) {
          eloUpdatedRef.current = true;
          const myUidNow = pNum === 1 ? game.p1_uid : game.p2_uid;
          const gameArena = game.arena ? ARENAS.find(a => a.id === game.arena) : null;
          const myShotList = game.attacks ? Object.values(game.attacks).filter(x => x.by === pNum) : [];
          const mHits = myShotList.reduce((n, x) => n + ((x.shots || []).filter(s => s.result === "hit").length), 0);
          const mMiss = myShotList.reduce((n, x) => n + ((x.shots || []).filter(s => s.result === "miss").length), 0);
          const mElapsed = gameStartTime ? (Date.now() - gameStartTime) / 1000 : 999;
          const sunkNow = killCountRef.current;

          applyOnlineResultSelf(myUidNow, iW, gameArena, (a) => {
            a.hits += mHits; a.shots += mHits + mMiss; a.shotHits += mHits; a.sunk += sunkNow;
            if (iW) {
              if (mElapsed < 300) a.fast5 = Math.max(a.fast5, 1);
              if (mElapsed < 180) a.fast3 = Math.max(a.fast3, 1);
              if (mElapsed < 120) a.fast2 = Math.max(a.fast2, 1);
              if (mMiss === 0 && mHits >= 20) a.perfect = Math.max(a.perfect, 1);
              if (gameArena && gameArena.id === "acikdeniz") a.arenaAcik = Math.max(a.arenaAcik, 1);
              if (gameArena && gameArena.id === "firtina") a.arenaFirtina = Math.max(a.arenaFirtina, 1);
            }
          }).then(r => {
            if (!r) return;
            setMyProfile(prev => prev ? { ...prev, ...r } : prev);
            setEloChange({ myOld: r.oldGold, myNew: r.gold + r.oldGold });
            setGoldChange({ amount: r.gold });
            if (r.gold > 0) { sfx.play('gold'); setGoldAnim({ amount: r.gold }); }
            if (iW && r.rev > 1) setRevengeResult({ mult: r.rev });
            track("game_end", { mode: gameArena ? "arena" : "online", result: iW ? "win" : "loss", gold: r.gold, duration_sec: Math.round(mElapsed), reason });
            setMatchRewards({ gold: r.gold, xp: r.xp, honor: iW ? HONOR_WIN_ONLINE : HONOR_LOSS_ONLINE, revenge: r.rev, isWin: iW });
            setRewardModalOpen(true);
            bumpGlobalStats(iW ? 1 : 0, sunkNow);
            bumpVoyageMatch();
            // GÜNLÜK GÖREVLER — online maçlar da sayılır (eskiden hiç işlenmiyordu)
            bumpDaily(d => {
              d.gamesPlayed += 1;
              d.totalHits += mHits;
              d.shipsSunk = Math.max(d.shipsSunk, sunkNow);
              if (iW) {
                d.wins += 1;
                if (mElapsed < 300) d.fastWin5 = true;
                if (mElapsed < 180) d.fastWin = true;
                if (mElapsed < 120) d.ultraFastWin = true;
                if (mMiss === 0 && mHits >= 20) d.perfectGame = true;
              }
            });
          });
        }
      }
    });
  }, [placementConfirmed]);

  // Online salon davet/eşleşme geçişi — kararlı referans şart, aksi halde
  // OnlineLobby'nin davet dinleyicisi her Game render'ında yeniden abone olur
  // ve davet eden taraf kabul bildirimini kaçırabilir.
  const handleOnlineChallenge = useCallback((rid, pNum) => {
    setShowOnlineLobby(false);
    roomIdRef.current = rid;
    rememberRoom(rid);
    setRoomId(rid);
    setPlayerNum(pNum);
    playerNumRef.current = pNum;
    setPhase("placing");
    listenToRoom(rid, pNum);
    if (authUid) remove(ref(db, `online_players/${authUid}`));
  }, [authUid, listenToRoom]);

  // "OYUNA HAZIRIM" olan kullanıcıya gelen davetleri global olarak dinle (Salon ekranı açık olmasa da çalışsın)
  useEffect(() => {
    if (!authUid) { setIncomingInvite(null); return; }
    const unsub = onValue(ref(db, `invites/${authUid}`), (snap) => {
      if (!snap.exists()) { setIncomingInvite(null); return; }
      let found = null;
      snap.forEach(child => { const d = child.val(); if (d && d.status === "pending" && !found) found = { id: child.key, ...d }; });
      setIncomingInvite(found);
    });
    return () => unsub();
  }, [authUid]);

  const acceptIncomingInvite = async (invite) => {
    const roomId = Math.random().toString(36).substring(2, 8).toUpperCase();
    await set(ref(db, `rooms/${roomId}`), { p1_name: invite.fromName, p1_uid: invite.id, p2_name: playerName, p2_uid: authUid, phase: "placing", p1_board: null, p2_board: null, p1_ships: null, p2_ships: null, attacks: null, turn: 1, clocks: { p1: CLOCK_SECONDS, p2: CLOCK_SECONDS }, winner: null, winReason: null, eloProcessed: false, created: Date.now() });
    await set(ref(db, `match_found/${invite.id}`), { roomId, playerNum: 1 });
    await update(ref(db, `invites/${authUid}/${invite.id}`), { status: "accepted", roomId });
    setTimeout(() => remove(ref(db, `invites/${authUid}/${invite.id}`)), 3000);
    setIncomingInvite(null);
    sfx.init(); sfx.playPlacementMusic();
    handleOnlineChallenge(roomId, 2);
  };

  const rejectIncomingInvite = async (invite) => {
    await update(ref(db, `invites/${authUid}/${invite.id}`), { status: "rejected" });
    setTimeout(() => remove(ref(db, `invites/${authUid}/${invite.id}`)), 2000);
    setIncomingInvite(null);
  };

  useEffect(() => {
    if (!roomId || (phase !== "playing" && phase !== "placing")) return;
    const emojiRef = ref(db, `emojis/${roomId}`);
    const unsub = onValue(emojiRef, (snap) => { if (!snap.exists()) return; const data = snap.val(); if (data.from !== playerNumRef.current && Date.now() - data.time < 5000) { const qeFound = QUICK_EMOJIS.find(e => e.id === data.id); setEmojiToast({ emoji: data.emoji, label: qeFound ? (appLang==="en"?qeFound.labelEn:qeFound.label) : data.label }); setTimeout(() => setEmojiToast(null), 3000); } });
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
      setMessage(L(appLang,"msgConnError"));
    }
  };

  const handleGoogleLogin = async () => {
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (e) {
      console.error("Google login error:", e);
      setMessage(L(appLang,"msgLoginFailed") + (e.code === "auth/popup-closed-by-user" ? L(appLang,"msgPopupClosed") : e.message));
    }
  };

  const handleSetUsername = async () => {
    const name = playerName.trim();
    if (!name || name.length < 2) { setMessage(L(appLang,"msgMinChars")); return; }
    if (name.length > 16) { setMessage(L(appLang,"msgMaxChars")); return; }
    if (containsBadWord(name)) { setMessage(L(appLang,"msgBadName")); return; }
    // Check if username is taken
    const profilesSnap = await get(ref(db, "profiles"));
    if (profilesSnap.exists()) {
      let taken = false;
      profilesSnap.forEach(child => {
        if (child.key !== authUid && child.val().displayName?.toLowerCase() === name.toLowerCase()) taken = true;
      });
      // İsim alınmışsa: sahibi olabilir → kurtarma kodu iste (hesabına geri dönsün)
      if (taken) { setRecoverName(name); setRecoverOpen(true); setMessage(L(appLang,"recInlineHint")); return; }
    }
    // Check 14-day name lock
    if (myProfile && myProfile.nameSetAt) {
      const daysSince = (Date.now() - myProfile.nameSetAt) / (1000 * 60 * 60 * 24);
      if (daysSince < 14 && myProfile.displayName !== "Denizci") {
        const remaining = Math.ceil(14 - daysSince);
        setMessage(L(appLang,"msgNameCooldown")(remaining));
        return;
      }
    }
    // HESABI KALICI HALE GETİR — kullanıcı adı + kurtarma kodu ile kimliğe bağla.
    // Başarısız olursa (ör. Email/Password sağlayıcısı kapalıysa) oyun anonim olarak devam eder.
    let newCode = null;
    try {
      const email = nameToAuthEmail(name);
      if (email && auth.currentUser && auth.currentUser.isAnonymous) {
        newCode = generateRecoveryCode();
        const cred = EmailAuthProvider.credential(email, normalizeCode(newCode));
        await linkWithCredential(auth.currentUser, cred);
      }
    } catch (e) {
      console.warn("Hesap bağlama başarısız, anonim devam:", e?.code);
      newCode = null;
    }

    const profile = await ensureProfile(authUid, name);
    // Save nameSetAt timestamp
    await set(ref(db, `profiles/${authUid}/nameSetAt`), Date.now());
    profile.nameSetAt = Date.now();
    if (newCode) {
      await update(ref(db, `profiles/${authUid}`), { hasRecovery: true }).catch(()=>{});
      profile.hasRecovery = true;
      try { localStorage.setItem("ab_recovery_code", newCode); } catch(e) {}
    }
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

  // HESABA GERİ DÖN — kullanıcı adı + kurtarma koduyla eski hesaba giriş yapar.
  const handleRecover = async () => {
    const code = normalizeCode(recoverCode);
    if (code.length < 6) { setRecoverErr(L(appLang,"recErrShort")); return; }
    const email = nameToAuthEmail(recoverName);
    if (!email) { setRecoverErr(L(appLang,"recErrWrong")); return; }
    setRecoverBusy(true); setRecoverErr("");
    try {
      await signInWithEmailAndPassword(auth, email, code);
      // Başarılı: onAuthStateChanged yeni uid'i alacak, profil otomatik yüklenecek
      try { localStorage.setItem("ab_recovery_code", recoverCode.toUpperCase()); } catch (e) {}
      setRecoverOpen(false); setRecoverCode(""); setRecoverBusy(false);
      setMessage("");
    } catch (e) {
      setRecoverBusy(false);
      setRecoverErr(e?.code === "auth/too-many-requests" ? L(appLang,"recErrMany") : L(appLang,"recErrWrong"));
    }
  };

  // NOT: Hesaplar anonimdir (cihaza bağlı). Sadece signOut yapmak hesabı ERİŞİLEMEZ hale
  // getiriyor ama profili veritabanında bırakıyordu → kullanıcı adı sonsuza dek kilitli
  // kalıyor ve kimse (sahibi dahil) o ismi bir daha alamıyordu. Artık çıkış = hesabı sil.
  const handleLogout = async () => {
    if (authUid) { remove(ref(db, `online_players/${authUid}`)).catch(() => {}); }
    forgetRoom();
    try { await signOut(auth); } catch (e) {}
    setAuthUid(null); setMyProfile(null); setPlayerName(""); setShowLogoutConfirm(false); setPhase("splash");
  };

  const canChangeName = () => {
    if (!myProfile) return true;
    if (!myProfile.displayName || myProfile.displayName === "Denizci") return true;
    if (!myProfile.nameSetAt) return true;
    return (Date.now() - myProfile.nameSetAt) / (1000 * 60 * 60 * 24) >= 14;
  };

  useEffect(() => { const handler = (e) => { if (e.key === "r" || e.key === "R") setRotation(prev => (prev + 1) % 4); }; window.addEventListener("keydown", handler); return () => window.removeEventListener("keydown", handler); }, []);

  const createRoom = async (arenaOverride) => {
    if (!playerName.trim()) { setMessage(L(appLang,"msgTypeName")); return; }
    if (!authUid) { setMessage(L(appLang,"msgConnecting")); return; }
    // Profile already loaded at login — just update displayName locally
    if (myProfile && playerName.trim() !== myProfile.displayName) {
      try { await set(ref(db, `profiles/${authUid}/displayName`), playerName.trim()); } catch(e) { console.error(e); }
    }
    const arena = arenaOverride || selectedArena;
    if (arena) { const cg = safeGold(myProfile?.gold); if (cg < arena.entryFee) { setMessage(L(appLang,"msgNotEnoughGold")); return; } const newGold = cg - arena.entryFee; try { const cleanP = await ensureProfile(authUid); cleanP.gold = newGold; await set(ref(db, `profiles/${authUid}`), cleanP); } catch(e) { console.error(e); } setMyProfile(prev => prev ? { ...prev, gold: newGold } : prev); setEntryFeeDeducted(arena.entryFee); }
    const id = Math.random().toString(36).substring(2, 8).toUpperCase();
    roomIdRef.current = id; setRoomId(id); setPlayerNum(1); playerNumRef.current = 1;
    await set(ref(db, `rooms/${id}`), { p1_name: playerName.trim(), p1_uid: authUid, p2_name: null, p2_uid: null, phase: "waiting", p1_board: null, p2_board: null, p1_ships: null, p2_ships: null, attacks: null, turn: 1, clocks: { p1: CLOCK_SECONDS, p2: CLOCK_SECONDS }, winner: null, winReason: null, eloProcessed: false, arena: arena?.id || null, created: Date.now() });
    setPhase("waiting"); listenToRoom(id, 1);
  };

  // Rakip henüz katılmadan odayı iptal et — girildiyse giriş ücretini iade et
  const cancelWaitingRoom = async () => {
    const rid = roomIdRef.current;
    if (rid) { try { await remove(ref(db, `rooms/${rid}`)); } catch(e) {} }
    if (entryFeeDeducted && authUid) {
      try {
        const snap = await get(ref(db, `profiles/${authUid}`));
        if (snap.exists()) {
          const refunded = safeGold(snap.val().gold) + entryFeeDeducted;
          await set(ref(db, `profiles/${authUid}/gold`), refunded);
          setMyProfile(prev => prev ? { ...prev, gold: refunded } : prev);
        }
      } catch(e) {}
    }
    resetGame();
  };

  const joinRoom = async () => {
    if (!playerName.trim() || !inputRoomId.trim()) { setMessage(L(appLang,"msgTypeNameAndRoom")); return; }
    if (!authUid) { setMessage(L(appLang,"msgConnecting")); return; }
    const rid = inputRoomId.trim().toUpperCase();
    const snapshot = await get(ref(db, `rooms/${rid}`)); if (!snapshot.exists()) { setMessage(L(appLang,"msgRoomNotFound")); return; }
    const game = snapshot.val(); if (game.p2_name) { setMessage(L(appLang,"msgRoomFull")); return; }
    if (game.arena) { const arena = ARENAS.find(a => a.id === game.arena); if (arena) { const cg = safeGold(myProfile?.gold); if (cg < arena.entryFee) { setMessage(L(appLang,"msgArenaGoldNeeded")(arena.entryFee)); return; } const newGold = cg - arena.entryFee; const cleanP = await ensureProfile(authUid); cleanP.gold = newGold; await set(ref(db, `profiles/${authUid}`), cleanP); setMyProfile(prev => prev ? { ...prev, gold: newGold } : prev); setEntryFeeDeducted(arena.entryFee); } }
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
    if (safeGold(myProfile?.gold) < cost) { setMessage(L(appLang,"msgNotEnoughGold")); return; }
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
  const handleAttackMark = (r, c) => { if (phase !== "playing") return; if (attackOverlay[r][c]) return; const nm = manualMarks.map(row => [...row]); nm[r][c] = !nm[r][c]; setManualMarks(nm); if (nm[r][c] && !isOnboarding) { bumpAch(a => { a.marks += 1; }); bumpDaily(d => { d.markedCells += 1; }); } };
  const handleAttackLongPress = (r, c) => { handleAttackMark(r, c); };
  const fireShots = async () => {
    if (currentShots.length === 0) return;
    if (isBotGame) { botHandlePlayerShots(); return; }
    sfx.playVoice('explosion');
    const pNum = playerNumRef.current, myKey = pNum === 1 ? "p1" : "p2"; const snapshot = await get(ref(db, `rooms/${roomIdRef.current}`)); const game = snapshot.val(); if (!game || game.turn !== pNum) return; const targetKey = pNum === 1 ? "p2" : "p1"; const shotResults = currentShots.map(([r, c]) => ({ r, c, result: game[`${targetKey}_board`][r][c] > 0 ? "hit" : "miss" })); const existingAttacks = game.attacks ? Object.values(game.attacks) : []; const prevHits = existingAttacks.filter(a => a.target === targetKey).reduce((sum, a) => sum + (a.shots ? a.shots.filter(s => s.result === "hit").length : 0), 0); const totalHits = prevHits + shotResults.filter(s => s.result === "hit").length; const updates = {}; updates[`attacks/${existingAttacks.length}`] = { by: pNum, target: targetKey, shots: shotResults, time: Date.now() }; updates[`clocks/${myKey}`] = myClockRef.current; if (totalHits >= 20) { updates.winner = pNum; updates.winReason = "hits"; } else { updates.turn = pNum === 1 ? 2 : 1; } await update(ref(db, `rooms/${roomIdRef.current}`), updates); setCurrentShots([]);
    // Tahta geçişi listenToRoom içinde 2sn gecikmeli olarak yapılıyor (atış sonucunu görsün diye)
  };
  const getAttackDisplayOverlay = () => { const ovr = attackOverlay.map(row => [...row]); currentShots.forEach(([r, c]) => { if (!ovr[r][c]) ovr[r][c] = "selected"; }); return ovr; };
  const forceEndGame = async () => { if (!roomIdRef.current) return; await update(ref(db, `rooms/${roomIdRef.current}`), { winner: playerNumRef.current, winReason: "test_force" }); };

  const surrenderGame = async () => {
    if (isBotGame) {
      setWinner(appLang==="en"?"You left the game!":"Oyundan ayrıldın!"); setIsWin(false); setPhase("gameover");
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
    // Yerleştirme aşamasında terk edilen oda (kimse kazanmadı) → hemen sil, artık kalmasın.
    if (roomIdRef.current && phaseRef.current === "placing") {
      remove(ref(db, `rooms/${roomIdRef.current}`)).catch(() => {});
    }
    forgetRoom();
    if (roomCleanupRef.current) { clearTimeout(roomCleanupRef.current); roomCleanupRef.current = null; }
    if (unsubRef.current) unsubRef.current(); if (clockIntervalRef.current) clearInterval(clockIntervalRef.current); if (placementTimerRef.current) clearInterval(placementTimerRef.current);
    finishDragListeners(); dragRef.current = null;
    setPhase("lobby"); setRoomId(""); setInputRoomId(""); setPlayerNum(null); setDefenseBoard(emptyGrid()); setShowSurrenderConfirm(false); setAfkTimer(null); setShipColorMap(Array.from({ length: ROWS }, () => Array(COLS).fill(null))); setAttackOverlay(emptyGrid().map(r => r.map(() => null))); setDefenseOverlay(emptyGrid().map(r => r.map(() => null))); setPlacedShips([]); setCurrentShots([]); setMyHits(0); setOppHits(0); setWinner(null); setMessage(""); setOpponentName(""); setPlacementConfirmed(false); setNotationEntries([]); setBlinkCells([]); setDamageReport(""); setManualMarks(Array.from({ length: ROWS }, () => Array(COLS).fill(false))); setMyClock(CLOCK_SECONDS); setOppClock(CLOCK_SECONDS); myClockRef.current = CLOCK_SECONDS; oppClockRef.current = CLOCK_SECONDS; setMyShipsData(null); setOppShipsData(null); setActiveBoard("attack"); setMarkMode(false); setDefHitMap(emptyGrid().map(r => r.map(() => false))); setAtkHitMap(emptyGrid().map(r => r.map(() => false))); lastAttackCountRef.current = 0; killCountRef.current = 0; firstHitVoiceRef.current = false; setPlacementTimer(PLACEMENT_SECONDS); setShowReview(false); setIsWin(false); setEloChange(null); eloUpdatedRef.current = false; setShowOnlineLobby(false); setMatchmaking(false); setMatchCancelFn(null); setSelectedArena(null); setShowArenaSelect(false); setGoldChange(null); setEmojiToast(null); setMyEmojiToast(null); setEntryFeeDeducted(null); setIsBotGame(false); isBotGameRef.current = false; setBotBoard(null); setBotShips(null); setBotAttackOverlay(emptyGrid().map(r => r.map(() => null))); setBotName(""); setGameStartTime(null); setHitStreak(0); setStreakToast(null); setGoldAnim(null); setMicroFeedback(null); setExtraTimeUsed(false); setPlacementPreview(false); setIsOnboarding(false); setOnboardingStep(0); setOnboardingMilestones({ firstHit: false, firstSunk: false }); setRevengeResult(null); setMatchRewards(null); setRewardModalOpen(false); setNewAchUnlocks([]);
    // Profili sunucudan tazele — AMA günlük görev ve kazanım sayaçlarında YEREL ilerleme
    // daha ileriyse onu koru. (Maç sonu yazımı sunucuya ulaşmadan bu okuma dönerse
    // eskiden ilerleme siliniyordu; görevlerin "işlenmemesinin" asıl sebebi buydu.)
    if (authUid) {
      get(ref(db, `profiles/${authUid}`)).then(snap => {
        if (!snap.exists()) return;
        const srv = snap.val();
        setMyProfile(prev => {
          if (!prev) return srv;
          const ld = safeDaily(prev.daily), sd = safeDaily(srv.daily);
          const la = safeAch(prev.ach), sa = safeAch(srv.ach);
          return {
            ...srv,
            daily: (ld.gamesPlayed > sd.gamesPlayed || ld.totalHits > sd.totalHits) ? ld : sd,
            ach: (la.hits > sa.hits || la.sunk > sa.sunk) ? la : sa,
          };
        });
      }).catch(() => {});
    }
    setTimeout(() => { sfx.init(); sfx.playBattleMusic(false); }, 300);
  };

  const sendEmoji = async (qe) => { setMyEmojiToast({ emoji: qe.emoji, label: appLang==="en"?qe.labelEn:qe.label }); setTimeout(() => setMyEmojiToast(null), 3000); if (!roomIdRef.current || isBotGame) return; await set(ref(db, `emojis/${roomIdRef.current}`), { emoji: qe.emoji, label: qe.label, id: qe.id, from: playerNumRef.current, time: Date.now() }); };

  // Hesabı/Verileri sil — KVKK/GDPR gereği zorunlu
  const deleteAccount = async () => {
    const uid = authUid;
    if (!uid) return;
    setSettingsView("deleting");
    try { await remove(ref(db, `profiles/${uid}`)); } catch(e) {}
    try { await remove(ref(db, `online_players/${uid}`)); } catch(e) {}
    try { await signOut(auth); } catch(e) {}
    setMyProfile(null); setAuthUid(null); setPlayerName("");
    setShowSettings(false); setSettingsView(null);
    resetGame();
    setPhase("splash");
  };

  const toggleMusic = () => {
    sfx.init();
    if (sfx._audioEl && !sfx._audioEl.paused) {
      sfx._stopMp3(); sfx.currentMusic = null;
      if (sfx._dynamicTimer) { clearInterval(sfx._dynamicTimer); sfx._dynamicTimer = null; }
      setMusicOn(false);
    } else {
      sfx.playBattleMusic(false); setMusicOn(true);
    }
  };

  // Splash'ten oyun bitene kadar tüm ekranlarda sabit duran müzik + ayarlar barı
  const renderTopBar = () => (
    <>
      <div style={{ position:"fixed",top:"calc(10px + env(safe-area-inset-top, 0px))",right:14,zIndex:9500,display:"flex",alignItems:"center",gap:8 }}>
        <button onClick={()=>{ sfx.init(); sfx.play('click'); setShowSettings(true); setSettingsView(null); }} title={L(appLang,"settingsTooltip")} style={{ width:30,height:30,borderRadius:8,background:"rgba(255,255,255,0.06)",border:`1px solid ${t.border}`,fontSize:14,cursor:"pointer",color:t.textDim,display:"flex",alignItems:"center",justifyContent:"center",lineHeight:1,transition:"all 0.15s ease" }}>⚙️</button>
        <button onClick={toggleMusic} title={L(appLang,"musicTooltip")} style={{ width:30,height:30,borderRadius:8,background:musicOn?"rgba(255,255,255,0.06)":"rgba(255,71,87,0.14)",border:`1px solid ${musicOn?t.border:t.hit}`,fontSize:14,cursor:"pointer",color:musicOn?t.textDim:t.hit,display:"flex",alignItems:"center",justifyContent:"center",lineHeight:1,transition:"all 0.15s ease" }}>{musicOn?"🔊":"🔇"}</button>
      </div>
      {showSettings && (
        <div style={{ position:"fixed",inset:0,overflowX:"hidden",zIndex:9600,background:"rgba(0,0,0,0.62)",backdropFilter:"blur(4px)",display:"flex",alignItems:"flex-end",justifyContent:"center",animation:"settingsFadeIn 0.2s ease-out" }} onClick={()=>{ setShowSettings(false); setSettingsView(null); }}>
          <div onClick={e=>e.stopPropagation()} style={{ width:"100%",maxWidth:400,maxHeight:"86vh",overflowY:"auto",background:"linear-gradient(180deg, rgba(14,20,40,0.99), rgba(7,11,24,0.99))",border:`1px solid ${t.border}`,borderBottom:"none",borderRadius:"20px 20px 0 0",padding:"14px 20px 30px",animation:"sheetSlideUp 0.3s cubic-bezier(0.22,1,0.36,1)",boxShadow:"0 -10px 50px rgba(0,0,0,0.5)" }}>
            <div style={{ width:40,height:4,borderRadius:2,background:"rgba(255,255,255,0.2)",margin:"0 auto 16px" }} />

            {settingsView === null && (<>
              <div style={{ fontSize:18,fontWeight:900,color:t.text,fontFamily:warrior,letterSpacing:2,marginBottom:16,textAlign:"center" }}>{L(appLang,"settingsTitle")}</div>

              <button onClick={()=>setSettingsView("profile")} style={rowBtnStyle}>
                <span style={rowIconStyle}>👤</span>
                <div style={{ flex:1,textAlign:"left" }}>
                  <div style={rowTitleStyle}>{L(appLang,"profile")}</div>
                  <div style={rowSubStyle}>{myProfile?.displayName || "Denizci"}</div>
                </div>
                <span style={chevronStyle}>›</span>
              </button>

              <div style={sectionCardStyle}>
                <div style={{ display:"flex",alignItems:"center",gap:10,marginBottom:8 }}>
                  <span style={rowIconStyle}>🎵</span>
                  <div style={rowTitleStyle}>{L(appLang,"musicLevel")}</div>
                  <div style={{ marginLeft:"auto",fontSize:12,color:t.accent,fontFamily:mono,fontWeight:700 }}>{musicVolume}%</div>
                </div>
                <input type="range" min={0} max={100} value={musicVolume} onChange={e=>{ const v=parseInt(e.target.value,10); setMusicVolumeState(v); sfx.setMusicVolume(v); if (v>0 && !musicOn) setMusicOn(true); }} style={sliderStyle} />
              </div>

              <ToggleRow icon="💥" title={L(appLang,"sfx")} sub={L(appLang,"sfxSub")} value={sfxOnState} onChange={(v)=>{ setSfxOnState(v); sfx.setSfxOn(v); }} />

              <ToggleRow icon="🔔" title={L(appLang,"notifications")} sub={L(appLang,"notificationsSub")} value={notifOn} onChange={(v)=>{ setNotifOn(v); try{ localStorage.setItem('ab_notifOn', v?'1':'0'); }catch(e){} }} />

              <div style={sectionCardStyle}>
                <div style={{ display:"flex",alignItems:"center",gap:10,marginBottom:10 }}>
                  <span style={rowIconStyle}>🌐</span>
                  <div style={rowTitleStyle}>{L(appLang,"language")}</div>
                </div>
                <div style={{ display:"flex",gap:8 }}>
                  <button onClick={()=>{ setAppLang('tr'); try{ localStorage.setItem('ab_lang','tr'); }catch(e){} }} style={langBtnStyle(appLang==='tr')}>🇹🇷 Türkçe</button>
                  <button onClick={()=>{ setAppLang('en'); try{ localStorage.setItem('ab_lang','en'); }catch(e){} }} style={langBtnStyle(appLang==='en')}>🇬🇧 English</button>
                </div>
              </div>

              {/* KURTARMA KODUM — kullanıcı kodunu unutmasın diye ayarlardan tekrar görebilir */}
              <button onClick={()=>{ let c=null; try { c = localStorage.getItem("ab_recovery_code"); } catch(e){} setShowCodeModal(c || "—"); }} style={rowBtnStyle}>
                <span style={rowIconStyle}>🔑</span>
                <div style={{ flex:1,textAlign:"left" }}><div style={rowTitleStyle}>{L(appLang,"myCode")}</div></div>
              </button>

              {/* ÇIKIŞ YAP — kodu gösterip çıkışa yönlendirir */}
              <button onClick={()=>{ sfx.init(); sfx.play('click'); setShowLogoutConfirm(true); }} style={rowBtnStyle}>
                <span style={rowIconStyle}>🚪</span>
                <div style={{ flex:1,textAlign:"left" }}><div style={rowTitleStyle}>{L(appLang,"logoutBtn")}</div></div>
              </button>

              <button onClick={()=>setSettingsView("privacy")} style={rowBtnStyle}>
                <span style={rowIconStyle}>📄</span>
                <div style={{ flex:1,textAlign:"left" }}><div style={rowTitleStyle}>{L(appLang,"privacy")}</div></div>
                <span style={chevronStyle}>›</span>
              </button>

              <a href="mailto:ozdenilim@gmail.com?subject=Amiral%20Batt%C4%B1%20Destek&body=Merhaba%2C%0D%0A%0D%0AKar%C5%9F%C4%B1la%C5%9Ft%C4%B1%C4%9F%C4%B1m%20durum%3A%0D%0A" style={{ ...rowBtnStyle, textDecoration:"none",display:"flex" }}>
                <span style={rowIconStyle}>✉️</span>
                <div style={{ flex:1,textAlign:"left" }}><div style={rowTitleStyle}>{L(appLang,"support")}</div><div style={rowSubStyle}>ozdenilim@gmail.com</div></div>
                <span style={chevronStyle}>›</span>
              </a>

              <button onClick={()=>setSettingsView("delete")} style={{ ...rowBtnStyle,borderColor:"rgba(255,71,87,0.35)" }}>
                <span style={rowIconStyle}>🗑️</span>
                <div style={{ flex:1,textAlign:"left" }}><div style={{ ...rowTitleStyle,color:t.hit }}>{L(appLang,"deleteAccount")}</div></div>
                <span style={{ ...chevronStyle,color:t.hit }}>›</span>
              </button>

              <button onClick={()=>{ setShowSettings(false); setSettingsView(null); }} style={{ marginTop:6,width:"100%",padding:"12px 0",background:"rgba(255,255,255,0.05)",border:`1px solid ${t.border}`,borderRadius:10,color:t.textDim,fontFamily:warrior,fontWeight:800,letterSpacing:2,cursor:"pointer" }}>{L(appLang,"close")}</button>
            </>)}

            {settingsView === "profile" && myProfile && (() => {
              const totalG = myProfile.totalGames || 0, wins = myProfile.wins || 0, losses = myProfile.losses || 0;
              const winRt = totalG > 0 ? Math.round((wins / totalG) * 100) : 0;
              const joined = myProfile.createdAt ? new Date(myProfile.createdAt).toLocaleDateString(appLang === 'en' ? 'en-US' : 'tr-TR', { year:'numeric', month:'long', day:'numeric' }) : "-";
              return (<>
                <BackHeader title={L(appLang,"profile")} onBack={()=>setSettingsView(null)} />
                <div style={{ display:"flex",alignItems:"center",gap:12,marginBottom:18 }}>
                  <div style={{ width:52,height:52,borderRadius:"50%",background:"rgba(0,229,255,0.1)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:24,overflow:"hidden",flexShrink:0 }}>{(myProfile.avatar||"").startsWith("data:") ? <img src={myProfile.avatar} alt="" style={{ width:"100%",height:"100%",objectFit:"cover" }} /> : (myProfile.avatar || "⚓")}</div>
                  <div>
                    <div style={{ fontSize:18,fontWeight:900,color:t.text,fontFamily:warrior }}>{myProfile.displayName}</div>
                    <div style={{ fontSize:11,color:t.textDim,fontFamily:mono }}>{L(appLang,"joined")}: {joined}</div>
                  </div>
                </div>
                {(() => {
                  const a = safeAch(myProfile.ach);
                  const botG = myProfile.botGames || 0, onG = myProfile.onlineGames || 0;
                  const botW = Math.min(a.botWins, botG), onW = Math.min(a.onlineWins, onG);
                  const botL = Math.max(0, botG - botW), onL = Math.max(0, onG - onW);
                  const acc = a.shots > 0 ? Math.max(0, Math.min(100, Math.round((a.shotHits / a.shots) * 100))) : 0;
                  const hn = migrateHonor(myProfile);
                  const Row = ({ icon, games, w, l, color }) => (
                    <div style={{ display:"flex",alignItems:"center",gap:8,padding:"9px 12px",borderRadius:10,background:"rgba(255,255,255,0.035)",border:`1px solid ${t.border}`,marginBottom:8 }}>
                      <span style={{ fontSize:12,fontWeight:900,color:t.text,fontFamily:warrior,letterSpacing:1,minWidth:74 }}>{icon}</span>
                      <span style={{ fontSize:15,fontWeight:900,color,fontFamily:warrior,minWidth:26,textAlign:"right" }}>{games}</span>
                      <span style={{ fontSize:9,color:t.textDim,fontFamily:warrior,letterSpacing:1,flex:1 }}>{L(appLang,"totalGames")}</span>
                      <span style={{ display:"flex",gap:6 }}>
                        <span style={{ fontSize:13,fontWeight:900,color:"#4ade80",fontFamily:mono }}>{w}<span style={{ fontSize:8,opacity:0.7 }}>{L(appLang,"statW")}</span></span>
                        <span style={{ color:"rgba(255,255,255,0.15)" }}>|</span>
                        <span style={{ fontSize:13,fontWeight:900,color:t.hit,fontFamily:mono }}>{l}<span style={{ fontSize:8,opacity:0.7 }}>{L(appLang,"statL")}</span></span>
                      </span>
                    </div>
                  );
                  return (<>
                    <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:14 }}>
                      <StatBox label={L(appLang,"totalGames")} value={totalG} color={t.text} />
                      <StatBox label={L(appLang,"winRateLabel")} value={`%${winRt}`} color={t.accent} />
                      <StatBox label={L(appLang,"wins")} value={wins} color="#4ade80" />
                      <StatBox label={L(appLang,"losses")} value={losses} color={t.hit} />
                    </div>
                    {/* MAÇ DAĞILIMI — bot ve online ayrı ayrı, galibiyet/mağlubiyet kırılımıyla */}
                    <div style={{ fontSize:10,fontWeight:900,color:t.textDim,fontFamily:warrior,letterSpacing:3,marginBottom:7 }}>{L(appLang,"statBreakdown")}</div>
                    <Row icon={L(appLang,"statBot")} games={botG} w={botW} l={botL} color="#34d399" />
                    <Row icon={L(appLang,"statOnline")} games={onG} w={onW} l={onL} color={t.accent} />
                    {/* ATIŞ TUTTURMA */}
                    <div style={{ marginTop:6,padding:"11px 13px",borderRadius:10,background:"linear-gradient(135deg, rgba(255,215,0,0.08), rgba(255,159,67,0.03))",border:"1px solid rgba(255,215,0,0.3)" }}>
                      <div style={{ display:"flex",alignItems:"baseline",justifyContent:"space-between",marginBottom:6 }}>
                        <span style={{ fontSize:10,fontWeight:900,color:t.gold,fontFamily:warrior,letterSpacing:2 }}>🎯 {L(appLang,"statAccuracy")}</span>
                        <span style={{ fontSize:19,fontWeight:900,color:t.gold,fontFamily:warrior,textShadow:`0 0 12px ${t.goldGlow}` }}>%{acc}</span>
                      </div>
                      <div style={{ width:"100%",height:6,borderRadius:4,background:"rgba(0,0,0,0.45)",overflow:"hidden" }}>
                        <div style={{ width:`${acc}%`,height:"100%",borderRadius:4,background:"linear-gradient(90deg,#ffe066,#ffd700,#d97706)",transition:"width 0.8s ease" }} />
                      </div>
                      <div style={{ fontSize:9,color:t.textDim,fontFamily:mono,marginTop:5,letterSpacing:0.5 }}>
                        {a.shotHits.toLocaleString(appLang==="en"?"en-US":"tr-TR")} {L(appLang,"statHits")} / {a.shots.toLocaleString(appLang==="en"?"en-US":"tr-TR")} {L(appLang,"statShots")}
                      </div>
                    </div>
                    <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginTop:10 }}>
                      <StatBox label={L(appLang,"statSunk")} value={a.sunk} color={t.sunk} />
                      <StatBox label={L(appLang,"statHonor")} value={hn} color="#a78bfa" />
                    </div>
                  </>);
                })()}
              </>);
            })()}

            {settingsView === "privacy" && (<>
              <BackHeader title={L(appLang,"privacy")} onBack={()=>setSettingsView(null)} />
              <div style={{ fontSize:12.5,lineHeight:1.7,color:t.textDim,fontFamily:mono,whiteSpace:"pre-wrap" }}>{appLang === 'en' ? PRIVACY_TEXT_EN : PRIVACY_TEXT}</div>
            </>)}

            {settingsView === "delete" && (<>
              <BackHeader title={L(appLang,"deleteAccount")} onBack={()=>setSettingsView(null)} />
              <div style={{ background:"rgba(255,71,87,0.08)",border:`1px solid ${t.hit}`,borderRadius:12,padding:16,marginBottom:16,fontSize:13,lineHeight:1.6,color:t.text,fontFamily:mono }}>
                {L(appLang,"deleteWarning")}
              </div>
              <button onClick={deleteAccount} style={{ width:"100%",padding:"14px 0",background:"linear-gradient(135deg,#ff4757,#c0392b)",border:"none",borderRadius:10,color:"#fff",fontFamily:warrior,fontWeight:900,letterSpacing:1,cursor:"pointer",marginBottom:10 }}>{L(appLang,"deleteConfirmBtn")}</button>
              <button onClick={()=>setSettingsView(null)} style={{ width:"100%",padding:"12px 0",background:"rgba(255,255,255,0.05)",border:`1px solid ${t.border}`,borderRadius:10,color:t.textDim,fontFamily:warrior,fontWeight:700,cursor:"pointer" }}>{L(appLang,"cancel")}</button>
            </>)}

            {settingsView === "deleting" && (<div style={{ textAlign:"center",padding:"40px 0",color:t.textDim,fontFamily:mono,fontSize:13 }}>{L(appLang,"deleting")}</div>)}
          </div>
        </div>
      )}
      {incomingInvite && phase === "lobby" && !showOnlineLobby && (
        <div style={{ position:"fixed",top:64,left:0,right:0,display:"flex",justifyContent:"center",zIndex:9650,padding:"0 14px",animation:"fadeUp 0.35s ease-out" }}>
          <div style={{ width:"100%",maxWidth:400,background:"linear-gradient(145deg, rgba(12,21,41,0.99), rgba(8,14,30,0.99))",border:`2px solid #34d399`,borderRadius:14,padding:"14px 18px",boxShadow:"0 0 40px rgba(52,211,153,0.4), 0 10px 30px rgba(0,0,0,0.5)",animation:"borderGlow 2s infinite" }}>
            <div style={{ fontSize:11,fontWeight:900,color:"#34d399",letterSpacing:2,fontFamily:warrior,marginBottom:6,display:"flex",alignItems:"center",gap:6 }}>⚡ {L(appLang,"duelInvite")}</div>
            <div style={{ fontSize:14,color:t.text,fontFamily:mono,marginBottom:10 }}><span style={{ fontWeight:800 }}>{incomingInvite.fromName}</span> {L(appLang,"wantsToPlayMsg")} <span style={{ color:t.gold,fontSize:11 }}>(💰{incomingInvite.fromGold || 0})</span></div>
            <div style={{ display:"flex",gap:8 }}>
              <button onClick={()=>acceptIncomingInvite(incomingInvite)} style={{ flex:1,padding:"10px 0",background:"linear-gradient(135deg,#34d399,#0d9488)",color:"#04231a",border:"none",borderRadius:8,fontSize:13,fontWeight:900,letterSpacing:2,cursor:"pointer",fontFamily:warrior }}>{L(appLang,"acceptFullBtn")}</button>
              <button onClick={()=>rejectIncomingInvite(incomingInvite)} style={{ flex:1,padding:"10px 0",background:"transparent",color:t.hit,border:`1px solid ${t.hit}`,borderRadius:8,fontSize:13,fontWeight:700,letterSpacing:2,cursor:"pointer",fontFamily:warrior }}>{L(appLang,"reject")}</button>
            </div>
          </div>
        </div>
      )}
    </>
  );

  const startBotGame = () => {
    track("game_start", { mode: "bot" });
    if (!playerName.trim()) { setMessage(L(appLang,"msgTypeName")); return; }
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
    // Bot: KRUVAZÖR — ortada, düz 3 hücre — tek üçlü atışla batsın
    const botMiniShips = [
      { id: "kruvazor", name: "Kruvazör", cells: [[2,2],[2,3],[2,4]], color: "#e74c3c" },
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
            const shipName = appLang === "en" ? (shipDef?.nameEn || shipDef?.name) : shipDef?.name;
            const totalH = hitShip.cells.filter(([hr, hc]) => newDefHit[hr][hc]).length;
            const sunkNow = totalH === hitShip.cells.length;
            reports.push({ text: sunkNow ? (appLang==="en"?`${shipName} sank!`:`${shipName} battı!`) : (appLang==="en"?`${shipName} took ${totalH} hit${totalH>1?'s':''}`:`${shipName} ${totalH}. yarasını aldı`), sunk: sunkNow });
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
    if (botHitCount > 0) { sfx.play('hit'); if (!firstHitVoiceRef.current && !isOnboarding) { firstHitVoiceRef.current = true; sfx.playVoice('first_kill'); } const rep = reports.length ? reports[reports.length-1].text.toLocaleUpperCase(appLang==='en'?'en-US':'tr-TR') : fbPick(appLang==="en"?FB_GOT_HIT_EN:FB_GOT_HIT); setMicroFeedback({ text: rep, color: t.hit }); }
    if (botHitCount === 0) { setMicroFeedback({ text: fbPick(appLang==="en"?FB_MISS_EN:FB_MISS), color: '#4dd8ff' }); }
    const botSunkSomething = reports.some(r => r.sunk);
    if (botSunkSomething) setTimeout(() => sfx.play('sunk'), 200);
    if (reports.length > 0) { setDamageReport(reports.map(r=>r.text).join(" • ")); setTimeout(() => setDamageReport(""), 8000); }
    if (!isOnboarding) {
      // Bot'un kendi atış performansı
      if (botHitCount > 0) consecHitTurnsRef.current++; else consecHitTurnsRef.current = 0;
      if (botHitCount >= 2) botSay('🙏', appLang==="en"?"Respect":"Saygılar");                     // bot 2-3'te 3 yaptı
      else if (consecHitTurnsRef.current === 3) botSay('🔥', appLang==="en"?"You're on fire!":"Yanıyorsun!"); // 3 tur üst üste vurdu
      else if (consecHitTurnsRef.current >= 4) botSay('🎯', 'İyi atış!');
      // Oyuncunun son gemisinin son parçası kaldı → Battın!
      if (newOppHits >= 19) botSay('💀', 'Battın!');
      else if (myClockRef.current > 0 && myClockRef.current < 60) botSay('⏳', 'Acele et!');
    }
    // Check if bot won
    if (newOppHits >= 20) {
      setWinner(appLang==="en"?"Your ships were sunk!":"Gemilerin battı!"); setIsWin(false); setPhase("gameover");
      sfx.init(); sfx.play('lose'); sfx.playDefeatMusic();
      // Kaybeden altın kaybetmez, kazanmaz da — sadece istatistik + %25 XP
      recordBotLossRef.current?.();
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
            const sdName = appLang==="en" ? (sd?.nameEn || sd?.name || "SHIP") : (sd?.name || "GEMİ");
            atkReports.push(th === hs.cells.length ? `${sdName.toLocaleUpperCase(appLang==='en'?'en-US':'tr-TR')} ${appLang==="en"?"SUNK! 💀":"BATTI! 💀"}` : `${sdName.toLocaleUpperCase(appLang==='en'?'en-US':'tr-TR')} ${appLang==="en"?`TOOK HIT ${th}`:`${th}. YARASINI ALDI`}`);
          }
        }
      }
    });
    window.__lastAtkReport = atkReports.length ? atkReports[atkReports.length-1] : null;
    // Sound effects for shots
    sfx.init();
    const hitCount0 = currentShots.filter(([r,c]) => botBoard[r][c] > 0).length;
    if (hitCount0 > 0) { sfx.play('hit'); if (!isOnboarding) { const wasFirstB = !firstHitVoiceRef.current; firstHitVoiceRef.current = true; sfx.playVolleyVoice(hitCount0, wasFirstB); }
      { const atkRep = window.__lastAtkReport; const hit3=appLang==="en"?FB_HIT3_EN:FB_HIT3, hit2=appLang==="en"?FB_HIT2_EN:FB_HIT2, hit1=appLang==="en"?FB_HIT1_EN:FB_HIT1; setMicroFeedback({ text: atkRep || fbPick(hitCount0 === 3 ? hit3 : hitCount0 === 2 ? hit2 : hit1), color: hitCount0 === 3 ? t.gold : t.accent }); window.__lastAtkReport = null; }
    }
    else { sfx.play('miss'); setMicroFeedback({ text: fbPick(appLang==="en"?FB_MISS_EN:FB_MISS), color: '#4dd8ff' }); }
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
      if (isOnboarding && !onboardingMilestones.firstSunk) { setOnboardingMilestones(prev => ({...prev, firstSunk: true})); setMicroFeedback({ text: appLang==="en"?'FIRST SINK! 💀':'İLK BATIŞ! 💀', color: t.sunk }); }
      else { const sr = window.__lastAtkReport && (window.__lastAtkReport.includes("BATTI") || window.__lastAtkReport.includes("SUNK")) ? window.__lastAtkReport : fbPick(appLang==="en"?FB_SUNK_EN:FB_SUNK); setMicroFeedback({ text: sr, color: t.sunk }); }
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
    (() => { const th = currentShots.filter(([r,c]) => botBoard[r][c] > 0).length; bumpAch(a => { a.shots += currentShots.length; a.shotHits += th; }); bumpDaily(d => { d.totalHits += th; if (allHit && currentShots.length > 0) { d.perfectTurn = true; d.perfectTurns += 1; } if (th >= 3) d.perfectTurn3 = true; d.shipsSunk = Math.max(d.shipsSunk, sunkNow); }); })();
    // Streak tracking
    const hitCount = currentShots.filter(([r,c]) => botBoard[r][c] > 0).length;
    if (hitCount === currentShots.length && hitCount > 0) {
      const newStreak = hitStreak + hitCount;
      setHitStreak(newStreak);
      const mult = newStreak >= 9 ? 4 : newStreak >= 6 ? 3 : newStreak >= 3 ? 2 : 1;
      if (mult > 1) { setStreakToast({ streak: newStreak, mult }); setTimeout(() => setStreakToast(null), 2500); }
      bumpAch(a => { a.bestHitStreak = Math.max(a.bestHitStreak, newStreak); }); bumpDaily(d => { d.streakHits = Math.max(d.streakHits, newStreak); });
    } else {
      setHitStreak(0); setStreakToast(null);
    }
    // Kazanım: tek turda 3 isabet + tur serisi
    if (!isOnboarding) bumpAch(a => {
      if (hitCount >= 3) a.tripleTurn = Math.max(a.tripleTurn, 1);
      if (hitCount > 0) { a.turnStreak += 1; a.bestTurnStreak = Math.max(a.bestTurnStreak, a.turnStreak); } else { a.turnStreak = 0; }
    });
    // Check if player won
    const winTarget = isOnboarding ? 3 : 20;
    if (newMyHits >= winTarget) {
      if (isOnboarding) {
        setWinner(appLang==="en"?"That was just the beginning... Real opponents await you!":"Bu sadece başlangıçtı... Gerçek rakipler seni bekliyor!");
        // Mark onboarding done in Firebase
        if (authUid) { update(ref(db, `profiles/${authUid}`), { onboardingDone: true }).catch(() => {}); }
      } else {
        setWinner(appLang==="en"?"You sank all their ships!":"Tüm gemileri batırdın!");
      }
      setIsWin(true); setPhase("gameover");
      sfx.init(); sfx.play('win'); setTimeout(() => launchConfetti('confetti-canvas'), 300);
      if (!isOnboarding) setTimeout(() => sfx.playEpicMusic(), 500);
      // Count sunk ships
      const sunkCount = botShips ? Object.values(botShips).filter(ship => ship.cells.every(([r,c]) => newAtkOverlay[r][c] === "hit" || newAtkOverlay[r][c] === "sunk")).length : 0;
      const elapsed = gameStartTime ? (Date.now() - gameStartTime) / 1000 : 999;
      bumpDaily(d => { d.wins += 1; d.botWin = true; d.gamesPlayed += 1; d.shipsSunk = Math.max(d.shipsSunk, sunkCount); if (elapsed < 300) d.fastWin5 = true; if (elapsed < 180) d.fastWin = true; if (elapsed < 120) d.ultraFastWin = true; if (newAtkOverlay.flat().filter(v => v === "miss").length === 0) d.perfectGame = true; });
      // Bot galibiyeti altını (seri çarpanlı)
      const streakMult = hitStreak >= 9 ? 4 : hitStreak >= 6 ? 3 : hitStreak >= 3 ? 2 : 1;
      // İntikam çarpanı — kayıp serisinden gelen bilenmişlik ödülü
      const rMult1 = revengeMult(safeAch(myProfile?.ach).lossStreak);
      const botWinGold = Math.round(50 * streakMult * rMult1); // 25→50: aktif oyun her zaman pasiften iyi öder
      if (rMult1 > 1) setRevengeResult({ mult: rMult1 });
      if (authUid && myProfile && !isOnboarding) {
        const lvl1 = applyLevelCredit(myProfile, XP_BOT_WIN * rMult1);
        const oldGold1 = safeGold(myProfile.gold);
        const newGold1 = oldGold1 + botWinGold;
        update(ref(db, `profiles/${authUid}`), { gold: newGold1, wins: (myProfile.wins||0)+1, totalGames: (myProfile.totalGames||0)+1, botGames: (myProfile.botGames||0)+1, lastGameAt: Date.now(), level: lvl1.level, levelProgress: lvl1.levelProgress, recentResults: pushRecent(myProfile.recentResults, true), honor: migrateHonor(myProfile) + HONOR_WIN_BOT }).catch(()=>{});
        setMyProfile(prev => prev ? { ...prev, gold: newGold1, wins:(prev.wins||0)+1, totalGames:(prev.totalGames||0)+1, botGames:(prev.botGames||0)+1, level: lvl1.level, levelProgress: lvl1.levelProgress, recentResults: pushRecent(prev.recentResults, true), honor: migrateHonor(prev) + HONOR_WIN_BOT } : prev);
        // Kazanım sayaçları — bot galibiyeti
        const missCount1 = newAtkOverlay.flat().filter(v => v === "miss").length;
        bumpAch(a => {
          a.hits += newMyHits; a.sunk += sunkCount; a.botWins += 1; a.goldEarned += botWinGold;
          a.winStreak += 1; a.bestWinStreak = Math.max(a.bestWinStreak, a.winStreak); a.lossStreak = 0;
          if (elapsed < 300) a.fast5 = Math.max(a.fast5, 1);
          if (elapsed < 180) a.fast3 = Math.max(a.fast3, 1);
          if (elapsed < 120) a.fast2 = Math.max(a.fast2, 1);
          if (missCount1 === 0) a.perfect = Math.max(a.perfect, 1);
        });
        bumpGlobalStats(1, sunkCount);
        bumpVoyageMatch();
        setEloChange({ myOld: oldGold1, myNew: newGold1 });
        setGoldChange({ amount: botWinGold });
        sfx.play('gold'); setGoldAnim({ amount: botWinGold });
        setMatchRewards({ gold: botWinGold, xp: XP_BOT_WIN * rMult1, honor: HONOR_WIN_BOT, revenge: rMult1, isWin: true }); setRewardModalOpen(true);
        track("game_end", { mode: "bot", result: "win", gold: botWinGold, duration_sec: Math.round(elapsed) });
      }
    } else {
      setMyTurn(false);
      setTimeout(() => botFireShots(), 3000 + Math.random() * 500);
    }
  };

  const QM_AVATARS = ["⚓","🦈","🐙","⚔","🏴‍☠️","🌊","🦅","🐉","💀","🔱"];

  // Sonuca ulaşınca (hazır-davet ya da kuyruk) ortak bitiş: VS reveal göster, sonra yerleştirmeye geç
  const finalizeQuickMatch = (roomId, playerNum, oppName, oppAvatar, oppGold, oppLevel) => {
    setQuickMatchOpponent({ name: oppName || "Rakip", avatar: oppAvatar || "⚓", gold: oppGold ?? null, level: oppLevel ?? null });
    setQuickMatchPhase("found");
    sfx.init(); sfx.play('gold');
    setTimeout(() => {
      if (quickMatchCancelledRef.current) return;
      setMatchmaking(false); setMatchCancelFn(null); setQuickMatchPhase(null); setQuickMatchOpponent(null);
      roomIdRef.current = roomId; rememberRoom(roomId); setRoomId(roomId); setPlayerNum(playerNum); playerNumRef.current = playerNum; setOpponentName(oppName); setPhase("placing"); listenToRoom(roomId, playerNum); if (authUid) remove(ref(db, `online_players/${authUid}`));
      sfx.playPlacementMusic();
    }, 1700);
  };

  // 2. adım: genel kuyruk tabanlı hızlı eşleşme (aday carousel + 30sn arama) — hazır oyuncu bulunamazsa/kabul etmezse buraya düşülür
  const runQueueSearch = async (arena) => {
    if (quickMatchCancelledRef.current) return;
    setQuickMatchPhase("searching");
    // OYNA: 7 saniyede insan yoksa bot kaptan garantisi. Arena: insan şart, 45 sn.
    const searchTotalSec = arena ? 45 : 7;
    setQuickMatchSecondsLeft(searchTotalSec);

    let pool = [];
    try {
      const snap = await get(ref(db, "online_players"));
      if (snap.exists()) snap.forEach(child => { if (child.key !== authUid) pool.push({ name: child.val().displayName || "Denizci", gold: safeGold(child.val().gold) }); });
    } catch (e) {}
    if (pool.length < 3) { BOT_NAMES.forEach(n => pool.push({ name: n, gold: 200 + Math.floor(Math.random()*4000) })); }

    if (quickMatchCarouselRef.current) clearInterval(quickMatchCarouselRef.current);
    quickMatchCarouselRef.current = setInterval(() => {
      const pick = pool[Math.floor(Math.random() * pool.length)];
      setQuickMatchCandidate({ name: pick.name, gold: pick.gold, avatar: QM_AVATARS[Math.floor(Math.random() * QM_AVATARS.length)], key: Math.random() });
    }, 120);

    if (quickMatchCountdownRef.current) clearInterval(quickMatchCountdownRef.current);
    const searchStart = Date.now();
    quickMatchCountdownRef.current = setInterval(() => {
      setQuickMatchSecondsLeft(Math.max(0, searchTotalSec - Math.floor((Date.now() - searchStart) / 1000)));
    }, 250);

    const matchPromise = findMatch(authUid, playerName.trim(), myProfile?.gold ?? STARTING_GOLD, arena?.id || null, searchTotalSec * 1000);
    setMatchCancelFn(() => matchPromise._cancel);
    matchPromise.then(async (data) => {
      if (quickMatchCarouselRef.current) { clearInterval(quickMatchCarouselRef.current); quickMatchCarouselRef.current = null; }
      if (quickMatchCountdownRef.current) { clearInterval(quickMatchCountdownRef.current); quickMatchCountdownRef.current = null; }
      if (quickMatchCancelledRef.current) return;
      if (data && data.roomId) {
        // Rakip profilini zenginleştir — VS ekranında gerçek avatar/altın/seviye göster
        let oppInfo = { name: data.oppName || "Rakip", avatar: "⚓", gold: null, level: null };
        try {
          const roomSnap = await get(ref(db, `rooms/${data.roomId}`));
          const room = roomSnap.val();
          const oppUid = room ? (data.playerNum === 1 ? room.p2_uid : room.p1_uid) : null;
          if (oppUid) {
            const pSnap = await get(ref(db, `profiles/${oppUid}`));
            if (pSnap.exists()) { const p = pSnap.val(); oppInfo = { name: p.displayName || oppInfo.name, avatar: p.avatar || "⚓", gold: safeGold(p.gold), level: p.level || 0 }; }
          }
        } catch (e) {}
        finalizeQuickMatch(data.roomId, data.playerNum, oppInfo.name, oppInfo.avatar, oppInfo.gold, oppInfo.level);
      } else if (!arena) {
        // OYNA: 7 saniyede insan çıkmadı — bot kaptan meydan okur, oyuncu ASLA boş beklemez
        setMatchmaking(false); setMatchCancelFn(null); setQuickMatchPhase(null); setQuickMatchOpponent(null); setQuickMatchCandidate(null);
        startBotGame();
      } else {
        // Arena: insan şart — bulunamadı, ücret anında iade
        setMatchmaking(false); setMatchCancelFn(null);
        setQuickMatchPhase("notfound");
        if (entryFeeDeducted) {
          const refundGold = safeGold(myProfile?.gold) + arena.entryFee;
          ensureProfile(authUid).then(cleanP => { cleanP.gold = refundGold; set(ref(db, `profiles/${authUid}`), cleanP); }).catch(() => {});
          setMyProfile(prev => prev ? { ...prev, gold: refundGold } : prev);
          setEntryFeeDeducted(null);
        }
      }
    });
  };

  const startQuickMatch = async (arenaOverride) => {
    track("game_start", { mode: arenaOverride ? "arena" : "online", arena: arenaOverride?.id || "none" });
    if (!playerName.trim()) { setMessage(L(appLang,"msgTypeName")); return; }
    if (!authUid) { setMessage(L(appLang,"msgConnecting")); return; }
    const arena = arenaOverride || null;
    lastQuickMatchArenaRef.current = arena;
    if (arena) { const cg = safeGold(myProfile?.gold); if (cg < arena.entryFee) { setMessage(L(appLang,"msgNotEnoughGold")); return; } const newGold = cg - arena.entryFee; try { const cleanP = await ensureProfile(authUid); cleanP.gold = newGold; await set(ref(db, `profiles/${authUid}`), cleanP); } catch(e) { console.error(e); } setMyProfile(prev => prev ? { ...prev, gold: newGold } : prev); setEntryFeeDeducted(arena.entryFee); }
    setMessage("");
    quickMatchCancelledRef.current = false;
    setMatchmaking(true);
    setQuickMatchOpponent(null);
    setQuickMatchCandidate(null);
    sfx.init(); sfx.play('click');

    // 1. adım: salonda "OYUNA HAZIRIM" diyen biri varsa — ANINDA eşleş, davet/kabul yok
    if (!arena) {
      const candidate = await findReadyCandidate(authUid, myProfile?.gold ?? STARTING_GOLD);
      if (candidate && !quickMatchCancelledRef.current) {
        const instant = await instantMatchWithReady(authUid, playerName.trim(), candidate);
        if (quickMatchCancelledRef.current) return;
        if (instant) {
          finalizeQuickMatch(instant.roomId, instant.playerNum, candidate.displayName, candidate.avatar, safeGold(candidate.gold), candidate.level || 0);
          return;
        }
        // Kilit kapılmış ya da oyuncu ayrılmış → kuyruğa devam
      }
    }

    // 2. adım: genel kuyruk tabanlı eşleşme
    await runQueueSearch(arena);
  };

  const cancelQuickMatch = async () => {
    quickMatchCancelledRef.current = true;
    if (quickMatchCarouselRef.current) { clearInterval(quickMatchCarouselRef.current); quickMatchCarouselRef.current = null; }
    if (quickMatchCountdownRef.current) { clearInterval(quickMatchCountdownRef.current); quickMatchCountdownRef.current = null; }
    if (matchCancelFn) await matchCancelFn();
    setMatchmaking(false); setMatchCancelFn(null); setQuickMatchPhase(null); setQuickMatchOpponent(null);
  };

  const retryQuickMatch = () => { startQuickMatch(lastQuickMatchArenaRef.current); };

  // HAZIRIM diyen oyuncu ana ekrandayken de yakalanabilsin — global match_found dinleyicisi
  useEffect(() => {
    if (phase !== "lobby" || !authUid || !readyToPlay) return;
    const unsub = onValue(ref(db, `match_found/${authUid}`), snap => {
      if (!snap.exists()) return;
      const d = snap.val(); if (!d.roomId) return;
      remove(ref(db, `match_found/${authUid}`)).catch(() => {});
      handleOnlineChallenge(d.roomId, d.playerNum || 2);
    });
    return () => unsub();
  }, [phase, authUid, readyToPlay]);

  // Tek kaynaklı ölçü sistemi: her ekranda aynı kenar boşluğu ve aynı içerik genişliği.
  const appStyle = { minHeight: "100vh", minHeight: "100dvh", width: "100%", maxWidth: "100%", background: t.bg, color: t.text, fontFamily: mono, display: "flex", flexDirection: "column", alignItems: "center", padding: "12px clamp(10px, 4vw, 16px) 24px", boxSizing: "border-box", overflowX: "hidden" };
  const btnStyle = { padding: "12px 28px", background: `linear-gradient(135deg, ${t.accent}, #0891b2)`, color: t.bg, border: "none", borderRadius: 8, fontSize: 13, fontWeight: 700, letterSpacing: 2, textTransform: "uppercase", cursor: "pointer", fontFamily: warrior, boxShadow: `0 0 15px ${t.accentGlow}` };
  const btnSecStyle = { padding: "8px 16px", background: "transparent", color: t.accent, border: `1px solid ${t.accent}`, borderRadius: 6, fontSize: 11, fontWeight: 600, letterSpacing: 1, cursor: "pointer", fontFamily: warrior };
  const inputStyle = { padding: "12px 16px", background: t.surface, color: t.text, border: `1px solid ${t.border}`, borderRadius: 8, fontSize: 15, fontFamily: mono, outline: "none", textAlign: "center", width: "100%", maxWidth: 260, boxSizing: "border-box" };

  // KURTARMA KODU PENCERESİ — hesap ilk kurulduğunda bir kez, büyük ve net gösterilir
  const renderCodeModal = () => showCodeModal && (
    <div style={{ position:"fixed",inset:0,overflow:"hidden",zIndex:9900,background:"rgba(2,6,16,0.92)",display:"flex",alignItems:"center",justifyContent:"center",padding:18 }}>
      <div style={{ background:"linear-gradient(160deg, #0d1b32, #060e1f)",border:`2px solid ${t.gold}`,borderRadius:18,padding:"24px 22px 20px",width:"100%",maxWidth:340,textAlign:"center",boxShadow:`0 0 44px ${t.goldGlow}, 0 20px 60px rgba(0,0,0,0.75)`,animation:"tutCardEnter 0.6s cubic-bezier(0.16,1,0.3,1)" }}>
        <div style={{ fontSize:38,marginBottom:6 }}>🔑</div>
        <div style={{ fontSize:15,fontWeight:900,color:t.gold,fontFamily:warrior,letterSpacing:3,marginBottom:12,textShadow:`0 0 16px ${t.goldGlow}` }}>{L(appLang,"codeTitle")}</div>
        <div style={{ fontSize:26,fontWeight:900,fontFamily:mono,letterSpacing:4,color:"#fff",background:"rgba(255,215,0,0.10)",border:`1.5px dashed ${t.gold}`,borderRadius:12,padding:"14px 8px",marginBottom:12,userSelect:"all" }}>{showCodeModal}</div>
        <div style={{ fontSize:11,color:t.text,fontFamily:mono,lineHeight:1.6,marginBottom:16 }}>{L(appLang,"codeBody")}</div>
        <div style={{ display:"flex",flexDirection:"column",gap:9 }}>
          <button onClick={()=>{ try { navigator.clipboard?.writeText(showCodeModal); } catch(e){} setCodeCopied(true); setTimeout(()=>setCodeCopied(false), 2000); }}
            style={{ width:"100%",padding:"12px 0",background:"rgba(255,215,0,0.12)",color:t.gold,border:`1.5px solid ${t.gold}`,borderRadius:12,fontSize:12,fontWeight:900,letterSpacing:2,cursor:"pointer",fontFamily:warrior }}>{codeCopied?L(appLang,"codeCopied"):L(appLang,"codeCopy")}</button>
          <button onClick={()=>setShowCodeModal(null)} style={{ width:"100%",padding:"14px 0",background:`linear-gradient(135deg,${t.accent},#0891b2)`,color:t.bg,border:"none",borderRadius:12,fontSize:13,fontWeight:900,letterSpacing:2,cursor:"pointer",fontFamily:warrior,boxShadow:`0 0 20px ${t.accentGlow}` }}>{L(appLang,"codeOk")}</button>
        </div>
      </div>
    </div>
  );

  // ÇIKIŞ PENCERESİ — kurtarma kodunu gösterir, kopyalatır, sonra çıkışa izin verir
  const renderLogoutModal = () => {
    if (!showLogoutConfirm) return null;
    let code = null; try { code = localStorage.getItem("ab_recovery_code"); } catch (e) {}
    return (
      <div onClick={()=>setShowLogoutConfirm(false)} style={{ position:"fixed",inset:0,overflow:"hidden",zIndex:9900,background:"rgba(2,6,16,0.9)",display:"flex",alignItems:"center",justifyContent:"center",padding:18 }}>
        <div onClick={e=>e.stopPropagation()} style={{ background:"linear-gradient(160deg, #0d1b32, #060e1f)",border:`2px solid ${t.gold}`,borderRadius:18,padding:"22px 20px 18px",width:"100%",maxWidth:340,textAlign:"center",boxShadow:`0 0 40px ${t.goldGlow}, 0 20px 60px rgba(0,0,0,0.75)`,animation:"tutCardEnter 0.5s cubic-bezier(0.16,1,0.3,1)" }}>
          <div style={{ fontSize:34,marginBottom:6 }}>🔑</div>
          <div style={{ fontSize:14,fontWeight:900,color:t.gold,fontFamily:warrior,letterSpacing:2,marginBottom:10,textShadow:`0 0 14px ${t.goldGlow}` }}>{L(appLang,"codeTitle")}</div>
          {code ? (
            <div style={{ fontSize:25,fontWeight:900,fontFamily:mono,letterSpacing:4,color:"#fff",background:"rgba(255,215,0,0.10)",border:`1.5px dashed ${t.gold}`,borderRadius:12,padding:"13px 8px",marginBottom:10,userSelect:"all" }}>{code}</div>
          ) : (
            <div style={{ fontSize:11,color:t.hit,fontFamily:mono,marginBottom:10 }}>{L(appLang,"myCodeNone")}</div>
          )}
          <div style={{ fontSize:11,color:t.text,fontFamily:mono,lineHeight:1.55,marginBottom:14 }}>{L(appLang,"codeBody")}</div>
          <div style={{ display:"flex",flexDirection:"column",gap:8 }}>
            {code && <button onClick={()=>{ try { navigator.clipboard?.writeText(code); } catch(e){} setCodeCopied(true); setTimeout(()=>setCodeCopied(false),2000); }}
              style={{ width:"100%",padding:"12px 0",background:"rgba(255,215,0,0.12)",color:t.gold,border:`1.5px solid ${t.gold}`,borderRadius:12,fontSize:12,fontWeight:900,letterSpacing:2,cursor:"pointer",fontFamily:warrior }}>{codeCopied?L(appLang,"codeCopied"):L(appLang,"codeCopy")}</button>}
            <button onClick={()=>setShowLogoutConfirm(false)} style={{ width:"100%",padding:"13px 0",background:`linear-gradient(135deg,${t.accent},#0891b2)`,color:t.bg,border:"none",borderRadius:12,fontSize:13,fontWeight:900,letterSpacing:2,cursor:"pointer",fontFamily:warrior }}>{L(appLang,"logoutStay")}</button>
            <button onClick={handleLogout} style={{ width:"100%",padding:"11px 0",background:"transparent",color:t.hit,border:`1.5px solid ${t.hit}`,borderRadius:12,fontSize:11,fontWeight:800,letterSpacing:2,cursor:"pointer",fontFamily:warrior }}>{L(appLang,"logoutGo")}</button>
          </div>
        </div>
      </div>
    );
  };

  // Faz bazlı içerik — TopBar'ın (müzik+ayarlar) her ekranda sabit kalması için IIFE'e sarıldı
  const content = (() => {
  if (phase === "splash") {
    const splashDone = authReady;
    if (!splashDone) {
      return <><style>{ANIMS}</style><div style={{ display:"flex",alignItems:"center",justifyContent:"center",minHeight:"100vh",background:"#050b18" }}><div style={{ width:40,height:40,borderRadius:"50%",border:"3px solid #00e5ff",borderTopColor:"transparent",animation:"spin 0.8s linear infinite" }} /><style>{"@keyframes spin{to{transform:rotate(360deg)}}"}</style></div></>;
    }
    
    // Not logged in — Google login required
    function LoginScreen() {
      const [musicStarted, setMusicStarted] = useState(false);
      const startMusic = () => { requestImmersive(); if (!musicStarted) { sfx.init(); sfx.playAmbientIntro(); setMusicStarted(true); } };
      return (<div onClick={startMusic} style={{ ...appStyle, justifyContent:"center", background:`radial-gradient(ellipse at 18% 15%, rgba(167,139,250,0.10) 0%, transparent 45%), radial-gradient(ellipse at 85% 80%, rgba(255,215,0,0.07) 0%, transparent 45%), radial-gradient(ellipse at 80% 15%, rgba(255,71,87,0.06) 0%, transparent 40%), radial-gradient(ellipse at 50% 35%, rgba(0,229,255,0.12) 0%, rgba(255,71,87,0.04) 40%, ${t.bg} 80%)`, overflow:"hidden", position:"relative", cursor:"default", animation:"pageEnter 1.2s cubic-bezier(0.16,1,0.3,1) forwards" }}><style>{ANIMS}{`
@keyframes sword3d{0%{transform:perspective(600px) rotateY(-60deg) rotateX(20deg) scale(0.3);opacity:0;filter:brightness(3)}40%{opacity:1}60%{transform:perspective(600px) rotateY(12deg) rotateX(-6deg) scale(1.18);filter:brightness(1.5)}80%{transform:perspective(600px) rotateY(-4deg) rotateX(3deg) scale(1.02);filter:brightness(1)}100%{transform:perspective(600px) rotateY(5deg) rotateX(-2deg) scale(1.05);filter:brightness(1)}}
@keyframes sword3dFloat{0%,100%{transform:perspective(600px) rotateY(5deg) rotateX(-2deg) translateY(0) scale(1.05)}50%{transform:perspective(600px) rotateY(-8deg) rotateX(5deg) translateY(-16px) scale(1.08)}}
@keyframes shimmerPass{0%{transform:translate3d(0,0,0)}100%{transform:translate3d(600%,0,0)}}
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
            <div style={{ fontSize:"clamp(34px, 12vw, 52px)",fontWeight:900,color:t.accent,fontFamily:warrior,letterSpacing:"clamp(5px, 3vw, 12px)",textShadow:`0 0 80px ${t.accentGlow}, 0 6px 30px rgba(0,0,0,0.9)`,lineHeight:1.05,WebkitTextStroke:"0.5px rgba(255,255,255,0.1)" }}>AMİRAL<br/>BATTI</div>
          </div>
          <div style={{ fontSize:16,color:"rgba(255,215,0,0.75)",fontFamily:warrior,letterSpacing:8,marginTop:12,fontStyle:"italic",textShadow:`0 0 16px ${t.goldGlow}`,animation:"fadeUp 1s ease-out 1.0s both" }}>{L(appLang,"tagline")}</div>
          <div style={{ display:"flex",alignItems:"center",gap:10,marginTop:12,marginBottom:36,animation:"fadeUp 1s ease-out 1.15s both" }}>
            <div style={{ width:90,height:1,background:"linear-gradient(90deg, transparent, rgba(255,215,0,0.6))" }} />
            <div style={{ width:5,height:5,borderRadius:"50%",background:"rgba(255,215,0,0.75)",boxShadow:`0 0 10px ${t.goldGlow}` }} />
            <div style={{ width:90,height:1,background:"linear-gradient(90deg, rgba(255,215,0,0.6), transparent)" }} />
          </div>
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
        <div style={{ fontSize:30,fontWeight:700,letterSpacing:5,color:t.accent,textShadow:`0 0 30px ${t.accentGlow}`,marginBottom:6,fontFamily:warrior,animation:"fadeUp 0.4s ease-out" }}>{L(appLang,"welcome")}</div>
        <div style={{ fontSize:11,color:t.textDim,letterSpacing:2,marginBottom:24,fontFamily:mono }}>{L(appLang,"chooseName")}</div>
        <input style={{ ...inputStyle,maxWidth:300,borderRadius:10,fontSize:16 }} placeholder={L(appLang,"namePlaceholder")} value={playerName} onChange={e=>{ if (recoverOpen) { setRecoverOpen(false); setRecoverCode(""); setRecoverErr(""); setMessage(""); } setPlayerName(e.target.value); }} maxLength={16} />
        <div style={{ fontSize:9,color:t.textDim,marginTop:6,fontFamily:mono,textAlign:"center" }}>{L(appLang,"nameHint")}</div>

        {/* KURTARMA ALANI — yalnızca girilen isim BAŞKASINA AİTSE açılır.
            Yeni/boş isimlerde hiç görünmez. */}
        {recoverOpen && (
          <div style={{ width:"100%",maxWidth:300,marginTop:12,padding:"12px 12px 10px",borderRadius:12,background:"rgba(0,229,255,0.06)",border:`1.5px solid ${t.accent}`,animation:"fadeUp 0.3s ease-out",boxSizing:"border-box" }}>
            <div style={{ fontSize:11,fontWeight:900,color:t.accent,fontFamily:warrior,letterSpacing:2,marginBottom:6,textAlign:"center" }}>🔐 {L(appLang,"recTitle")}</div>
            <input value={recoverCode} onChange={e=>{ setRecoverCode(e.target.value.toUpperCase()); setRecoverErr(""); }}
              placeholder={L(appLang,"recPlaceholder")} maxLength={12} autoCapitalize="characters" autoCorrect="off" spellCheck={false}
              style={{ width:"100%",padding:"11px 10px",background:t.surface,color:"#fff",border:`1.5px solid ${recoverErr?t.hit:t.border}`,borderRadius:9,fontSize:17,fontFamily:mono,fontWeight:900,letterSpacing:3,outline:"none",textAlign:"center",boxSizing:"border-box" }} />
            {recoverErr && <div style={{ fontSize:10,color:t.hit,fontFamily:mono,marginTop:5,textAlign:"center" }}>{recoverErr}</div>}
            <button onClick={handleRecover} disabled={recoverBusy}
              style={{ width:"100%",marginTop:8,padding:"11px 0",background:`linear-gradient(135deg,${t.accent},#0891b2)`,color:t.bg,border:"none",borderRadius:9,fontSize:12,fontWeight:900,letterSpacing:2,cursor:recoverBusy?"wait":"pointer",fontFamily:warrior,opacity:recoverBusy?0.6:1 }}>{L(appLang,"recEnter")}</button>
            <button onClick={()=>{ setRecoverOpen(false); setRecoverCode(""); setRecoverErr(""); setMessage(""); }}
              style={{ width:"100%",marginTop:6,padding:"8px 0",background:"transparent",color:t.textDim,border:"none",fontSize:10,fontWeight:700,letterSpacing:1,cursor:"pointer",fontFamily:warrior,textDecoration:"underline" }}>{L(appLang,"recCancel")}</button>
          </div>
        )}

        {!recoverOpen && <button onClick={handleSetUsername} style={{ ...btnStyle,marginTop:16,padding:"14px 40px",borderRadius:10,fontSize:15 }}>{L(appLang,"confirm")}</button>}
        {message && <div style={{ marginTop:12,color:recoverOpen?t.accent:t.hit,fontSize:11,fontFamily:mono,textAlign:"center",maxWidth:300 }}>{message}</div>}
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
  if (phase === "ready") return <><style>{ANIMS}</style><ReadyScreen opponentName={opponentName} onStart={() => setPhase("playing")}  myName={playerName} myAvatar={myProfile?.avatar} oppAvatar={oppAvatar} lang={appLang} /></>;

  // === TUTORIAL SİSTEMİ ===
  if (phase === "onboarding_intro") {
    const tutorialStep = onboardingStep;

    // Auto-advance component for splash
    function SplashAutoAdvance({ onDone }) {
      useEffect(() => { const t = setTimeout(onDone, 3000); return () => clearTimeout(t); }, []);
      return null;
    }

    // Eğitim savaşı kaldırıldı — tutorial bitince/atlanınca doğrudan ana sayfaya geçilir
    const finishTutorial = () => {
      sfx.init(); sfx.play('click');
      if (authUid) { update(ref(db, `profiles/${authUid}`), { onboardingDone: true }).catch(() => {}); }
      setMyProfile(prev => prev ? { ...prev, onboardingDone: true } : prev);
      resetGame();
    };
    const skipTutorial = finishTutorial;
    const nextStep = () => { sfx.init(); sfx.play('click'); setOnboardingStep(s => s + 1); };

    // Amiral gemi animasyon bileşeni — yatay, döner, tekrar yerleşir (2 kez sonra loop)
    // Adım 1 — ETKİLEŞİMLİ demo: gemi seç → 4x3 platforma konar → dokununca döner
    function AmiraldemoAnim() {
      const DEMO_SHIPS = [
        { id:"s2", color:"#ffd700", glow:"rgba(255,215,0,0.55)", h:[[1,1],[1,2]], v:[[0,1],[1,1]] },
        { id:"s3", color:"#00e5ff", glow:"rgba(0,229,255,0.55)", h:[[1,0],[1,1],[1,2]], v:[[0,1],[1,1],[2,1]] },
        { id:"amiral", color:"#e74c3c", glow:"rgba(231,76,60,0.55)", h:[[0,1],[0,2],[0,3],[1,2]], v:[[0,1],[1,1],[2,1],[1,2]] },
      ];
      const [selId, setSelId] = useState(null);
      const [rot, setRot] = useState(0);          // 0=yatay 1=dikey
      const [didRotate, setDidRotate] = useState(false);
      const [pop, setPop] = useState(0);          // her aksiyonda pop animasyonu tetikler
      const sel = DEMO_SHIPS.find(s => s.id === selId);
      const cells = sel ? (rot === 0 ? sel.h : sel.v) : [];
      const cs = 46, miniCell = 11;
      const pickShip = (id) => { try { sfx.init(); sfx.play('click'); } catch(e) {} setSelId(id); setRot(0); setPop(p=>p+1); };
      const rotateShip = () => { if (!sel) return; try { sfx.play('hit'); } catch(e) {} setRot(r=>1-r); setDidRotate(true); setPop(p=>p+1); };
      const MiniShip = ({ s }) => {
        const minR = Math.min(...s.h.map(a=>a[0])), minC = Math.min(...s.h.map(a=>a[1]));
        const norm = s.h.map(([r,c])=>[r-minR,c-minC]);
        const nR = Math.max(...norm.map(a=>a[0]))+1, nC = Math.max(...norm.map(a=>a[1]))+1;
        return (<div style={{ display:"grid",gridTemplateColumns:`repeat(${nC},${miniCell}px)`,gridTemplateRows:`repeat(${nR},${miniCell}px)`,gap:1 }}>
          {Array.from({length:nR*nC}).map((_,i)=>{ const r=Math.floor(i/nC), c=i%nC; const on=norm.some(([a,b])=>a===r&&b===c);
            return <div key={i} style={{ borderRadius:2,background:on?s.color:"transparent",boxShadow:on?`0 0 5px ${s.glow}`:"none" }} />; })}
        </div>);
      };
      return (
        <div style={{ position:"relative",marginBottom:14,display:"flex",flexDirection:"column",alignItems:"center",width:"100%" }}>
          <style>{`
@keyframes demoPop{0%{transform:scale(0.55)}60%{transform:scale(1.15)}100%{transform:scale(1)}}
@keyframes demoHand{0%,100%{transform:translateY(0)}50%{transform:translateY(-9px)}}
@keyframes demoBubble{0%,100%{transform:scale(1)}50%{transform:scale(1.05)}}
@keyframes demoWin{0%{box-shadow:0 0 0 rgba(74,222,128,0)}50%{box-shadow:0 0 28px rgba(74,222,128,0.6)}100%{box-shadow:0 0 10px rgba(74,222,128,0.25)}}
          `}</style>
          {/* Yönlendirme balonu — o an ne yapılacağını TEK cümleyle söyler */}
          <div style={{ minHeight:36,display:"flex",alignItems:"center",justifyContent:"center",marginBottom:8 }}>
            {!sel && <div style={{ padding:"7px 18px",borderRadius:20,background:"linear-gradient(135deg, rgba(255,215,0,0.16), rgba(255,159,67,0.10))",border:"1px solid rgba(255,215,0,0.5)",color:t.gold,fontFamily:warrior,fontWeight:900,fontSize:13,letterSpacing:3,animation:"demoBubble 1.4s ease-in-out infinite",textShadow:`0 0 12px ${t.goldGlow}`,textAlign:"center",maxWidth:"92%" }}>👇 {L(appLang,"tutPickShip")}</div>}
            {sel && !didRotate && <div style={{ padding:"7px 16px",borderRadius:20,background:"rgba(0,229,255,0.10)",border:"1px solid rgba(0,229,255,0.5)",color:t.accent,fontFamily:warrior,fontWeight:800,fontSize:13,letterSpacing:1,animation:"demoBubble 1.4s ease-in-out infinite",textShadow:`0 0 12px ${t.accentGlow}`,textAlign:"center",maxWidth:320 }}>👇 {L(appLang,"tutTapRotate")}</div>}
            {sel && didRotate && <div style={{ padding:"7px 18px",borderRadius:20,background:"rgba(74,222,128,0.10)",border:"1px solid rgba(74,222,128,0.55)",color:"#4ade80",fontFamily:warrior,fontWeight:900,fontSize:13,letterSpacing:3,animation:"demoWin 1.6s ease-out",whiteSpace:"nowrap" }}>✓ {L(appLang,"tutGreat")}</div>}
          </div>
          {/* 4x3 platform — tıklayınca gemi döner */}
          <div onClick={rotateShip} style={{ display:"grid",gridTemplateColumns:`repeat(4,${cs}px)`,gridTemplateRows:`repeat(3,${cs}px)`,gap:2,background:t.surface,borderRadius:12,padding:8,border:`2px solid ${sel?(didRotate?"rgba(74,222,128,0.4)":"rgba(0,229,255,0.35)"):t.border}`,cursor:sel?"pointer":"default",position:"relative",transition:"border-color 0.3s, box-shadow 0.3s",boxShadow:sel?`0 0 24px ${sel.glow}`:"none" }}>
            {Array.from({length:12}).map((_,i) => {
              const r=Math.floor(i/4), c=i%4;
              const isShip = cells.some(([sr,sc])=>sr===r&&sc===c);
              return <div key={i} style={{ borderRadius:5,background:isShip?sel.color+"55":t.water,border:`1px solid ${isShip?sel.color:"rgba(55,65,81,0.4)"}`,display:"flex",alignItems:"center",justifyContent:"center",transition:"all 0.25s ease",boxShadow:isShip?`inset 0 0 12px ${sel.glow}`:"none" }}>
                {isShip && <div key={pop} style={{ width:12,height:12,borderRadius:"50%",background:sel.color,boxShadow:`0 0 10px ${sel.glow}`,animation:"demoPop 0.35s cubic-bezier(0.34,1.56,0.64,1)" }} />}
              </div>;
            })}
            {/* Platform üstünde el — gemiye dokunmayı gösterir */}
            {sel && !didRotate && <div style={{ position:"absolute",bottom:-12,right:24,fontSize:30,animation:"demoHand 0.9s ease-in-out infinite",filter:"drop-shadow(0 2px 8px rgba(0,229,255,0.6))",pointerEvents:"none",transform:"rotate(-20deg)" }}>👆</div>}
          </div>
          {/* Gemi tepsisi — seç / değiştir */}
          <div style={{ marginTop:14,position:"relative",display:"flex",gap:10,alignItems:"center",justifyContent:"center" }}>
            {!sel && <div style={{ position:"absolute",top:-36,left:"50%",marginLeft:-14,fontSize:28,animation:"demoHand 0.9s ease-in-out infinite",pointerEvents:"none",filter:"drop-shadow(0 2px 8px rgba(255,215,0,0.6))" }}>👇</div>}
            {DEMO_SHIPS.map(s => (
              <button key={s.id} onClick={()=>pickShip(s.id)} style={{ padding:"10px 12px",background:selId===s.id?"rgba(0,229,255,0.12)":"rgba(255,255,255,0.04)",border:`2px solid ${selId===s.id?t.accent:"rgba(255,255,255,0.12)"}`,borderRadius:12,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",minWidth:56,minHeight:46,animation:!selId?"demoBubble 1.4s ease-in-out infinite":"none",boxShadow:selId===s.id?`0 0 16px ${s.glow}`:"none",transition:"all 0.25s" }}><MiniShip s={s} /></button>
            ))}
          </div>
          {sel && didRotate && <div style={{ fontSize:10,color:t.textDim,fontFamily:mono,marginTop:8,letterSpacing:1 }}>{L(appLang,"tutSwapHint")}</div>}
        </div>
      );
    }

    // Adım 3 — ETKİLEŞİMLİ atış demosu: gemiler görünür → kaybolur → kullanıcı 3 el ateş eder
    function ShotAnim() {
      const SHIP2 = [[0,0],[0,1]];             // 2'li — mavi
      const SHIP1 = [[2,3]];                   // tekli — yeşil
      const ALL_SHIPS = [...SHIP2, ...SHIP1];
      const [stage, setStage] = useState('peek');   // peek|shoot|done
      const [shots, setShots] = useState([]);       // {r,c,hit}
      useEffect(() => {
        if (stage !== 'peek') return;
        const tm = setTimeout(() => setStage('shoot'), 2400);
        return () => clearTimeout(tm);
      }, [stage]);
      const fire = (r,c) => {
        if (stage !== 'shoot') return;
        if (shots.some(s=>s.r===r&&s.c===c)) return;
        const hit = ALL_SHIPS.some(([sr,sc])=>sr===r&&sc===c);
        try { sfx.init(); sfx.play(hit?'hit':'miss'); } catch(e) {}
        const ns = [...shots, {r,c,hit}];
        setShots(ns);
        if (ns.length >= 3) setTimeout(() => setStage('done'), 400);
      };
      const reset = () => { setShots([]); setStage('peek'); try { sfx.play('click'); } catch(e) {} };
      const hits = shots.filter(s=>s.hit).length;
      const cs = 46;
      return (
        <div style={{ position:"relative",marginBottom:14,display:"flex",flexDirection:"column",alignItems:"center" }}>
          <style>{`
@keyframes shotBubble{0%,100%{transform:scale(1)}50%{transform:scale(1.05)}}
@keyframes shotWin{0%{box-shadow:0 0 0 rgba(74,222,128,0)}50%{box-shadow:0 0 28px rgba(74,222,128,0.6)}100%{box-shadow:0 0 10px rgba(74,222,128,0.25)}}
@keyframes flamePop{0%{transform:scale(0.2) translateY(6px);opacity:0}45%{transform:scale(1.5) translateY(-3px);opacity:1}100%{transform:scale(1) translateY(0);opacity:1}}
@keyframes flameFlicker{0%,100%{transform:scale(1) rotate(-3deg)}50%{transform:scale(1.15) rotate(3deg)}}
          `}</style>
          {/* Yönlendirme balonu */}
          <div style={{ minHeight:36,display:"flex",alignItems:"center",justifyContent:"center",marginBottom:8 }}>
            {stage==='peek' && <div style={{ padding:"7px 18px",borderRadius:20,background:"linear-gradient(135deg, rgba(255,215,0,0.16), rgba(255,159,67,0.10))",border:"1px solid rgba(255,215,0,0.5)",color:t.gold,fontFamily:warrior,fontWeight:900,fontSize:13,letterSpacing:3,animation:"shotBubble 1.2s ease-in-out infinite",textShadow:`0 0 12px ${t.goldGlow}`,textAlign:"center",maxWidth:"92%" }}>👀 {L(appLang,"tutPeek")}</div>}
            {stage==='shoot' && <div style={{ padding:"7px 18px",borderRadius:20,background:"rgba(255,71,87,0.10)",border:"1px solid rgba(255,71,87,0.5)",color:t.hit,fontFamily:warrior,fontWeight:900,fontSize:13,letterSpacing:3,animation:"shotBubble 1.2s ease-in-out infinite",textShadow:`0 0 12px ${t.hitGlow}`,textAlign:"center",maxWidth:"92%" }}>🎯 {L(appLang,"tutFire3")}</div>}
            {stage==='done' && <div style={{ padding:"7px 18px",borderRadius:20,background:"rgba(74,222,128,0.10)",border:"1px solid rgba(74,222,128,0.55)",color:"#4ade80",fontFamily:warrior,fontWeight:900,fontSize:13,letterSpacing:2,animation:"shotWin 1.6s ease-out",whiteSpace:"nowrap" }}>{hits>0?"💥":"💦"} {L(appLang,"tutHitsResult")(hits)}</div>}
          </div>
          {/* 4x3 platform */}
          <div style={{ display:"grid",gridTemplateColumns:`repeat(4,${cs}px)`,gridTemplateRows:`repeat(3,${cs}px)`,gap:2,background:t.surface,borderRadius:12,padding:8,border:`2px solid ${stage==='shoot'?"rgba(255,71,87,0.35)":stage==='done'?"rgba(74,222,128,0.4)":t.border}`,transition:"border-color 0.3s" }}>
            {Array.from({length:12}).map((_,i) => {
              const r=Math.floor(i/4), c=i%4;
              const is2 = SHIP2.some(([sr,sc])=>sr===r&&sc===c);
              const is1 = SHIP1.some(([sr,sc])=>sr===r&&sc===c);
              const isShip = is2 || is1;
              const shot = shots.find(s=>s.r===r&&s.c===c);
              const showShip = isShip && (stage==='peek' || (stage==='done' && !shot));
              const shipColor = is2 ? "rgba(0,229,255," : "rgba(52,211,153,";
              const ghostly = stage==='done' && showShip; // sonunda kaçanlar soluk görünür
              return <div key={i} onClick={()=>fire(r,c)} style={{ borderRadius:5,background:shot?(shot.hit?t.hit:t.miss):showShip?shipColor+(ghostly?"0.15)":"0.35)"):t.water,border:`1px solid ${shot?(shot.hit?t.hit:t.miss):showShip?shipColor+(ghostly?"0.35)":"0.8)"):"rgba(55,65,81,0.4)"}`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:shot?18:16,fontWeight:900,color:"#fff",cursor:stage==='shoot'&&!shot?"pointer":"default",transition:"all 0.25s ease",boxShadow:shot&&shot.hit?`inset 0 0 16px ${t.hitGlow}, 0 0 14px rgba(255,140,40,0.5)`:"none" }}>
                {shot ? (shot.hit
                  ? <span style={{ position:"relative",display:"inline-block",animation:"flamePop 0.45s cubic-bezier(0.34,1.56,0.64,1)" }}>
                      <span style={{ fontSize:19,display:"inline-block",animation:"flameFlicker 0.7s ease-in-out infinite",filter:"drop-shadow(0 0 8px rgba(255,140,40,0.9))" }}>🔥</span>
                    </span>
                  : "•")
                  : showShip ? <span style={{ fontSize:15,opacity:ghostly?0.45:1,animation:stage==='peek'?"shotBubble 1.2s ease-in-out infinite":"none" }}>🚢</span> : ""}
              </div>;
            })}
          </div>
          {/* Atış sayacı / tekrar dene */}
          <div style={{ display:"flex",gap:8,marginTop:10,justifyContent:"center",alignItems:"center",minHeight:34 }}>
            {stage!=='done' && [0,1,2].map(i=><div key={i} style={{ width:14,height:14,borderRadius:"50%",background:i<shots.length?t.hit:t.surfaceLight,boxShadow:i<shots.length?`0 0 8px ${t.hitGlow}`:"none",transition:"all 0.3s" }} />)}
            {stage==='shoot' && <div style={{ fontSize:12,color:t.textDim,fontFamily:warrior,letterSpacing:2,marginLeft:6 }}>🔥 {L(appLang,"fire")}</div>}
            {stage==='done' && <button onClick={reset} style={{ padding:"8px 22px",background:"rgba(0,229,255,0.10)",color:t.accent,border:`1px solid rgba(0,229,255,0.4)`,borderRadius:20,fontSize:12,fontWeight:800,cursor:"pointer",fontFamily:warrior,letterSpacing:2 }}>{L(appLang,"tutTryAgain")}</button>}
          </div>
          {stage==='done' && <div style={{ fontSize:14,color:t.gold,fontFamily:warrior,fontStyle:"italic",letterSpacing:2,marginTop:6,textShadow:`0 0 12px ${t.goldGlow}`,animation:"fadeUp 0.5s ease-out" }}>{L(appLang,"tutSimple")}</div>}
        </div>
      );
    }

    // Adım 4 — ETKİLEŞİMLİ işaretleme: vurulan teklinin çevresi bayraklanır, son hücreyi kullanıcı işaretler
    function MarkDemo() {
      const HIT = [1,1];                                                    // vurulmuş tekli gemi
      const AUTO_FLAGS = [[0,0],[0,1],[0,2],[1,0],[2,0],[2,1],[2,2]];      // otomatik sarı bayraklar
      const USER_CELL = [1,2];                                              // kullanıcının işaretleyeceği boşluk
      const [userFlag, setUserFlag] = useState(false);
      const cs = 46;
      const place = (r,c) => {
        if (userFlag || r!==USER_CELL[0] || c!==USER_CELL[1]) return;
        try { sfx.init(); sfx.play('click'); } catch(e) {}
        setUserFlag(true);
      };
      return (
        <div style={{ position:"relative",marginBottom:14,display:"flex",flexDirection:"column",alignItems:"center" }}>
          <style>{`
@keyframes markBubble{0%,100%{transform:scale(1)}50%{transform:scale(1.05)}}
@keyframes markHand{0%,100%{transform:translateX(0)}50%{transform:translateX(-9px)}}
@keyframes markWin{0%{box-shadow:0 0 0 rgba(74,222,128,0)}50%{box-shadow:0 0 28px rgba(74,222,128,0.6)}100%{box-shadow:0 0 10px rgba(74,222,128,0.25)}}
@keyframes markDash{0%,100%{border-color:rgba(255,215,0,0.9);box-shadow:inset 0 0 12px rgba(255,215,0,0.3)}50%{border-color:rgba(255,215,0,0.4);box-shadow:inset 0 0 4px rgba(255,215,0,0.1)}}
@keyframes flameFlicker{0%,100%{transform:scale(1) rotate(-3deg)}50%{transform:scale(1.15) rotate(3deg)}}
          `}</style>
          {/* Yönlendirme balonu */}
          <div style={{ minHeight:36,display:"flex",alignItems:"center",justifyContent:"center",marginBottom:8 }}>
            {!userFlag && <div style={{ padding:"7px 18px",borderRadius:20,background:"linear-gradient(135deg, rgba(255,215,0,0.16), rgba(255,159,67,0.10))",border:"1px solid rgba(255,215,0,0.5)",color:t.gold,fontFamily:warrior,fontWeight:900,fontSize:13,letterSpacing:2,animation:"markBubble 1.4s ease-in-out infinite",textShadow:`0 0 12px ${t.goldGlow}`,textAlign:"center",maxWidth:"92%" }}>☝ {L(appLang,"tutMarkYou")}</div>}
            {userFlag && <div style={{ padding:"7px 18px",borderRadius:20,background:"rgba(74,222,128,0.10)",border:"1px solid rgba(74,222,128,0.55)",color:"#4ade80",fontFamily:warrior,fontWeight:900,fontSize:13,letterSpacing:2,animation:"markWin 1.6s ease-out",whiteSpace:"nowrap" }}>✓ {L(appLang,"tutMarkDone")}</div>}
          </div>
          {/* 4x3 platform */}
          <div style={{ display:"grid",gridTemplateColumns:`repeat(4,${cs}px)`,gridTemplateRows:`repeat(3,${cs}px)`,gap:2,background:t.surface,borderRadius:12,padding:8,border:`2px solid ${userFlag?"rgba(74,222,128,0.4)":t.border}`,position:"relative",transition:"border-color 0.3s" }}>
            {Array.from({length:12}).map((_,i) => {
              const r=Math.floor(i/4), c=i%4;
              const isHit = r===HIT[0] && c===HIT[1];
              const fi = AUTO_FLAGS.findIndex(([fr,fc])=>fr===r&&fc===c);
              const isAutoFlag = fi >= 0;
              const isUserCell = r===USER_CELL[0] && c===USER_CELL[1];
              return <div key={i} onClick={()=>place(r,c)} onContextMenu={(e)=>{ e.preventDefault(); place(r,c); }} style={{ borderRadius:5,
                background: isHit ? t.hit : (isAutoFlag || (isUserCell&&userFlag)) ? "rgba(255,215,0,0.18)" : t.water,
                border: isUserCell&&!userFlag ? "2px dashed rgba(255,215,0,0.9)" : `1px solid ${isHit?t.hit:(isAutoFlag||(isUserCell&&userFlag))?"rgba(255,215,0,0.5)":"rgba(55,65,81,0.4)"}`,
                display:"flex",alignItems:"center",justifyContent:"center",fontSize:18,fontWeight:900,color:"#fff",
                cursor: isUserCell&&!userFlag ? "pointer" : "default", transition:"all 0.25s ease",
                animation: isUserCell&&!userFlag ? "markDash 1.2s ease-in-out infinite" : "none",
                boxShadow: isHit ? `inset 0 0 16px ${t.hitGlow}, 0 0 14px rgba(255,140,40,0.5)` : (isAutoFlag||(isUserCell&&userFlag)) ? `inset 0 0 10px ${t.goldGlow}` : "none" }}>
                {isHit && <span style={{ fontSize:19,display:"inline-block",animation:"flameFlicker 0.7s ease-in-out infinite",filter:"drop-shadow(0 0 8px rgba(255,140,40,0.9))" }}>🔥</span>}
                {isAutoFlag && <span style={{ fontSize:19,color:t.gold,animation:`markDrop 0.5s ease-out ${fi*0.18}s both` }}>⚑</span>}
                {isUserCell && userFlag && <span style={{ fontSize:19,color:t.gold,animation:"markDrop 0.4s ease-out both" }}>⚑</span>}
              </div>;
            })}
            {/* Doğru kareyi gösteren yan el — hücre (1,2)'nin hemen sağında, ona bakıyor */}
            {!userFlag && <div style={{ position:"absolute",top:8+cs+2+(cs-30)/2,left:8+3*(cs+2)+4,fontSize:28,lineHeight:"30px",animation:"markHand 0.9s ease-in-out infinite",filter:"drop-shadow(0 2px 8px rgba(255,215,0,0.7))",pointerEvents:"none",zIndex:2 }}>👈</div>}
          </div>
          {/* Neden? açıklaması */}
          <div style={{ fontSize:12,color:t.textDim,fontFamily:mono,marginTop:10,textAlign:"center",lineHeight:1.6,maxWidth:300 }}>
            <span style={{ color:t.gold,fontWeight:700 }}>⚑</span> {L(appLang,"tutMarkWhy")}
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
@keyframes shimmerPass{0%{transform:translate3d(0,0,0)}100%{transform:translate3d(600%,0,0)}}
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
        <button onClick={skipTutorial} style={{ position:"absolute",top:58,right:14,padding:"5px 14px",background:"rgba(255,255,255,0.05)",color:t.textDim,border:`1px solid ${t.border}`,borderRadius:20,fontSize:10,fontWeight:700,cursor:"pointer",fontFamily:warrior,letterSpacing:2 }}>{L(appLang,"tutSkip")}</button>
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
              <div style={{ fontSize:"clamp(36px, 13vw, 56px)",fontWeight:900,color:t.accent,fontFamily:warrior,letterSpacing:"clamp(5px, 3vw, 12px)",textShadow:`0 0 80px ${t.accentGlow}, 0 6px 30px rgba(0,0,0,0.9)`,lineHeight:1 }}>AMİRAL<br/>BATTI</div>
            </div>
            <div style={{ fontSize:16,color:"rgba(255,215,0,0.75)",fontFamily:warrior,letterSpacing:8,marginTop:14,fontStyle:"italic",animation:"fadeUp 1s ease-out 1.2s both",textShadow:`0 0 16px ${t.goldGlow}` }}>{L(appLang,"tagline")}</div>
            <div style={{ display:"flex",alignItems:"center",gap:10,marginTop:12,animation:"fadeUp 1s ease-out 1.35s both" }}>
              <div style={{ width:90,height:1,background:"linear-gradient(90deg, transparent, rgba(255,215,0,0.6))" }} />
              <div style={{ width:5,height:5,borderRadius:"50%",background:"rgba(255,215,0,0.75)",boxShadow:`0 0 10px ${t.goldGlow}` }} />
              <div style={{ width:90,height:1,background:"linear-gradient(90deg, rgba(255,215,0,0.6), transparent)" }} />
            </div>
          </div>
        </div>
      );
    }

    // Step 1: Gemi yerleştirme — Amiral animasyonu
    if (tutorialStep === 1) {
      return (
        <TutCard step={1} total={4}>
          <div style={{ fontSize:28,fontWeight:900,color:"#fff",fontFamily:warrior,letterSpacing:8,marginTop:32,marginBottom:20,textShadow:`0 0 30px ${t.accentGlow}`,borderBottom:"1px solid rgba(0,229,255,0.15)",paddingBottom:12,width:"100%",textAlign:"center" }}>{L(appLang,"howToPlay")}</div>
          <div style={{ display:"flex",alignItems:"center",gap:8,marginBottom:14 }}>
            <span style={{ fontSize:20 }}>⚓</span>
            <div style={{ fontSize:16,fontWeight:800,color:t.accent,fontFamily:warrior,letterSpacing:4,textShadow:`0 0 12px ${t.accentGlow}` }}>{L(appLang,"placeShipsTitle")}</div>
            <span style={{ fontSize:20 }}>⚓</span>
          </div>
          {/* Animated Amiral ship demo */}
          <AmiraldemoAnim />
          <div style={{ display:"flex",gap:10,marginTop:6 }}>
            <button onClick={() => setOnboardingStep(s => s - 1)} style={{ padding:"14px 32px",background:"transparent",color:t.textDim,border:`1px solid ${t.border}`,borderRadius:12,fontSize:14,fontWeight:700,cursor:"pointer",fontFamily:warrior,letterSpacing:2 }}>{L(appLang,"tutBack")}</button>
            <button onClick={nextStep} style={{ padding:"14px 32px",background:`linear-gradient(135deg,${t.accent},#0891b2)`,color:t.bg,border:"none",borderRadius:12,fontSize:14,fontWeight:900,letterSpacing:4,cursor:"pointer",fontFamily:warrior,boxShadow:`0 4px 24px ${t.accentGlow}` }}>{L(appLang,"tutNext")}</button>
          </div>
        </TutCard>
      );
    }

    // Step 2: Değme kuralı
    if (tutorialStep === 2) {
      return (
        <TutCard step={2} total={4}>
          <div style={{ fontSize:28,fontWeight:900,color:"#fff",fontFamily:warrior,letterSpacing:8,marginTop:32,marginBottom:20,textShadow:`0 0 30px ${t.accentGlow}`,borderBottom:"1px solid rgba(0,229,255,0.15)",paddingBottom:12,width:"100%",textAlign:"center" }}>{L(appLang,"howToPlay")}</div>
          <div style={{ display:"flex",alignItems:"center",gap:8,marginBottom:14 }}>
            <span style={{ fontSize:20 }}>🚫</span>
            <div style={{ fontSize:16,fontWeight:800,color:t.accent,fontFamily:warrior,letterSpacing:4,textShadow:`0 0 12px ${t.accentGlow}` }}>{L(appLang,"noTouchRuleTitle")}</div>
            <span style={{ fontSize:20 }}>🚫</span>
          </div>
          <div style={{ fontSize:13,color:t.textDim,fontFamily:mono,marginBottom:16,textAlign:"center",lineHeight:1.6 }}>{L(appLang,"noTouchRuleBody1")}<br/>{L(appLang,"noTouchRuleBody2")}</div>
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
            <button onClick={() => setOnboardingStep(s => s - 1)} style={{ padding:"14px 32px",background:"transparent",color:t.textDim,border:`1px solid ${t.border}`,borderRadius:12,fontSize:14,fontWeight:700,cursor:"pointer",fontFamily:warrior,letterSpacing:2 }}>{L(appLang,"tutBack")}</button>
            <button onClick={nextStep} style={{ padding:"14px 32px",background:`linear-gradient(135deg,${t.accent},#0891b2)`,color:t.bg,border:"none",borderRadius:12,fontSize:14,fontWeight:900,letterSpacing:4,cursor:"pointer",fontFamily:warrior,boxShadow:`0 4px 24px ${t.accentGlow}` }}>{L(appLang,"tutNext")}</button>
          </div>
        </TutCard>
      );
    }

    // Step 3: 3'lü atış
    if (tutorialStep === 3) {
      return (
        <TutCard step={3} total={4}>
          <div style={{ fontSize:28,fontWeight:900,color:"#fff",fontFamily:warrior,letterSpacing:8,marginTop:32,marginBottom:20,textShadow:`0 0 30px ${t.accentGlow}`,borderBottom:"1px solid rgba(0,229,255,0.15)",paddingBottom:12,width:"100%",textAlign:"center" }}>{L(appLang,"howToPlay")}</div>
          <div style={{ display:"flex",alignItems:"center",gap:8,marginBottom:14 }}>
            <span style={{ fontSize:20 }}>💥</span>
            <div style={{ fontSize:16,fontWeight:800,color:t.accent,fontFamily:warrior,letterSpacing:4,textShadow:`0 0 12px ${t.accentGlow}` }}>{L(appLang,"threeShotsTitle")}</div>
            <span style={{ fontSize:20 }}>💥</span>
          </div>
          <div style={{ fontSize:13,color:t.textDim,fontFamily:mono,marginBottom:16,textAlign:"center",lineHeight:1.6 }}>{L(appLang,"threeShotsBody")}</div>
          <ShotAnim />
          <div style={{ display:"flex",gap:10,marginTop:8 }}>
            <button onClick={() => setOnboardingStep(s => s - 1)} style={{ padding:"14px 32px",background:"transparent",color:t.textDim,border:`1px solid ${t.border}`,borderRadius:12,fontSize:14,fontWeight:700,cursor:"pointer",fontFamily:warrior,letterSpacing:2 }}>{L(appLang,"tutBack")}</button>
            <button onClick={nextStep} style={{ padding:"14px 32px",background:`linear-gradient(135deg,${t.accent},#0891b2)`,color:t.bg,border:"none",borderRadius:12,fontSize:14,fontWeight:900,letterSpacing:4,cursor:"pointer",fontFamily:warrior,boxShadow:`0 4px 24px ${t.accentGlow}` }}>{L(appLang,"tutNext")}</button>
          </div>
        </TutCard>
      );
    }

    // Step 4: İşaretleme özelliği
    if (tutorialStep === 4) {
      return (
        <TutCard step={4} total={4}>
          <div style={{ fontSize:28,fontWeight:900,color:"#fff",fontFamily:warrior,letterSpacing:8,marginTop:32,marginBottom:20,textShadow:`0 0 30px ${t.accentGlow}`,borderBottom:"1px solid rgba(0,229,255,0.15)",paddingBottom:12,width:"100%",textAlign:"center" }}>{L(appLang,"howToPlay")}</div>
          <div style={{ display:"flex",alignItems:"center",gap:8,marginBottom:14 }}>
            <span style={{ fontSize:20 }}>⚑</span>
            <div style={{ fontSize:16,fontWeight:800,color:t.accent,fontFamily:warrior,letterSpacing:4,textShadow:`0 0 12px ${t.accentGlow}` }}>{L(appLang,"markTrackTitle")}</div>
            <span style={{ fontSize:20 }}>⚑</span>
          </div>
          <div style={{ fontSize:13,color:t.textDim,fontFamily:mono,marginBottom:16,textAlign:"center",lineHeight:1.6 }}>{L(appLang,"markTrackBody1")}<br/>{L(appLang,"markTrackBody2")}</div>
          <MarkDemo />
          {/* SAVAŞ CTA */}
          <div style={{ textAlign:"center",display:"flex",flexDirection:"column",alignItems:"center",gap:0,width:"100%",maxWidth:400 }}>
            <button onClick={finishTutorial} style={{ width:"100%",padding:"18px 0",background:"linear-gradient(180deg, #a01f0c 0%, #6b1108 50%, #3a0804 100%)",color:"#fff",border:"1px solid rgba(255,200,120,0.35)",borderRadius:6,fontSize:20,fontWeight:900,letterSpacing:4,cursor:"pointer",fontFamily:warrior,boxShadow:"0 0 60px rgba(200,50,20,0.6), 0 0 120px rgba(180,30,10,0.3), 0 8px 40px rgba(0,0,0,0.9), inset 0 1px 0 rgba(255,180,120,0.2)",position:"relative",overflow:"hidden",textTransform:"uppercase",textShadow:"0 0 30px rgba(255,140,60,0.9), 0 0 60px rgba(255,80,20,0.5), 0 2px 8px rgba(0,0,0,0.9)",display:"flex",alignItems:"center",justifyContent:"center",gap:10 }}>
              <span style={{ position:"absolute",top:0,left:"-100%",width:"50%",height:"100%",background:"linear-gradient(90deg,transparent,rgba(255,150,80,0.1),transparent)",animation:"shimmerPass 3s ease-in-out infinite" }} />
              <XAnchors size={22} color="#ffd8a8" /> {L(appLang,"startBattleBtn")}
            </button>
            <div style={{ marginTop:10,fontSize:11,fontStyle:"italic",color:"rgba(255,180,100,0.65)",fontFamily:warrior,letterSpacing:4,textShadow:"0 0 10px rgba(255,120,40,0.4)" }}>
              {L(appLang,"watersHeating")}
            </div>
          </div>
        </TutCard>
      );
    }
  }
  if (showAchievements) return <><style>{ANIMS}</style><AchievementsScreen profile={myProfile} onClose={() => setShowAchievements(false)} onClaim={claimAchievementSet} lang={appLang} /></>;
  if (showLeaderboard) return <><style>{ANIMS}</style><Leaderboard onBack={() => setShowLeaderboard(false)} myUid={authUid} lang={appLang} /></>;
  if (showArenaSelect) return <><style>{ANIMS}</style><ArenaSelect myGold={myProfile?.gold || 0} onBack={() => setShowArenaSelect(false)} onSelect={(arena) => { setSelectedArena(arena); setShowArenaSelect(false); startQuickMatch(arena); }} lang={appLang} /></>;
  if (showOnlineLobby) return <><style>{ANIMS}</style><OnlineLobby myUid={authUid} myName={playerName} myGold={myProfile?.gold} onBack={() => setShowOnlineLobby(false)} onChallenge={handleOnlineChallenge} ready={readyToPlay} onToggleReady={()=>setReadyToPlay(v=>!v)} lang={appLang} /></>;

  if (phase === "gameover") {
    if (showReview) return <BoardReview defenseBoard={defenseBoard} shipColorMap={shipColorMap} defenseOverlay={defenseOverlay} attackOverlay={attackOverlay} oppShipsData={oppShipsData} myShipsData={myShipsData} defHitMap={defHitMap} atkHitMap={atkHitMap} cellSize={cellSize} onBack={() => setShowReview(false)} lang={appLang} />;
    // ONBOARDING VICTORY — Special rank reveal ceremony
    if (isOnboarding && isWin) {
      return (<><style>{ANIMS}</style>
        <OnboardingVictoryScreen sfx={sfx} t={t} winner={winner} warrior={warrior} mono={mono} onDone={() => { setIsOnboarding(false); resetGame(); }} lang={appLang} />
      </>);
    }
    const myEloDiff = eloChange ? eloChange.myNew - eloChange.myOld : null;
    const myRank = myProfile ? getRankInfo(migrateHonor(myProfile), appLang) : null;
    const chestProgressPct = Math.round((Object.keys(missionProgress).length / (dailyMissions.length || 3)) * 100);
    return (<><style>{ANIMS}</style>
      <GameOverScreen winner={winner} myHits={myHits} oppHits={oppHits} isWin={isWin} onNewGame={resetGame} onHome={resetGame} onViewBoard={() => setShowReview(true)} goldEarned={myEloDiff ?? (goldAnim?.amount || 0)} myLevel={myProfile?.level || 0} chestProgressPct={chestProgressPct} lang={appLang}
        hookText={isWin ? L(appLang,"hookWin") : (revengeMult(safeAch(myProfile?.ach).lossStreak) > 1 ? L(appLang,"hookLossRevenge")(revengeMult(safeAch(myProfile?.ach).lossStreak)) : L(appLang,"hookLoss"))}
        onShowRewards={matchRewards && !isOnboarding ? (() => setRewardModalOpen(true)) : null}
        revengeStreak={!isWin ? safeAch(myProfile?.ach).lossStreak : 0} />
      {matchRewards && rewardModalOpen && !isOnboarding && <RewardModal key={rewardNonce} rewards={matchRewards} dailyMissions={dailyMissions} missionProgress={missionProgress} newAch={newAchUnlocks} profile={myProfile} sfx={sfx} onClose={() => setRewardModalOpen(false)} lang={appLang} />}
      {/* İntikam bildirimleri */}
      {isWin && revengeResult && (
        <div style={{ position:"fixed",top:"calc(14px + env(safe-area-inset-top, 0px))",left:0,right:0,display:"flex",justifyContent:"center",zIndex:10005,pointerEvents:"none" }}>
          <div style={{ background:"linear-gradient(135deg, rgba(120,20,10,0.96), rgba(60,8,4,0.98))",border:"2px solid rgba(255,120,60,0.8)",borderRadius:12,padding:"10px 22px",display:"flex",alignItems:"center",gap:10,boxShadow:"0 0 34px rgba(255,80,40,0.5), 0 8px 24px rgba(0,0,0,0.6)",animation:"fadeUp 0.6s cubic-bezier(0.34,1.56,0.64,1)" }}>
            <span style={{ fontSize:20 }}>⚔</span>
            <span style={{ fontSize:14,fontWeight:900,color:"#ffb380",fontFamily:warrior,letterSpacing:2,textShadow:"0 0 14px rgba(255,120,60,0.8)" }}>{L(appLang,"revengeTaken")(revengeResult.mult)}</span>
          </div>
        </div>
      )}
      {!isWin && (() => { const rm = revengeMult(safeAch(myProfile?.ach).lossStreak); if (rm <= 1) return null; return (
        <div style={{ position:"fixed",top:"calc(14px + env(safe-area-inset-top, 0px))",left:0,right:0,display:"flex",justifyContent:"center",zIndex:10005,pointerEvents:"none" }}>
          <div style={{ background:"linear-gradient(135deg, rgba(120,20,10,0.96), rgba(60,8,4,0.98))",border:"2px solid rgba(255,120,60,0.8)",borderRadius:12,padding:"10px 22px",display:"flex",alignItems:"center",gap:10,boxShadow:"0 0 34px rgba(255,80,40,0.5), 0 8px 24px rgba(0,0,0,0.6)",animation:"fadeUp 0.8s cubic-bezier(0.34,1.56,0.64,1) 0.8s both, pulse 2s ease-in-out 1.8s infinite" }}>
            <span style={{ fontSize:20 }}>⚔</span>
            <span style={{ fontSize:13,fontWeight:900,color:"#ffb380",fontFamily:warrior,letterSpacing:2,textShadow:"0 0 14px rgba(255,120,60,0.8)" }}>{L(appLang,"revengeActive")(rm)}</span>
          </div>
        </div>
      ); })()}
      <canvas id="confetti-canvas" style={{ position:'fixed',inset:0,pointerEvents:'none',zIndex:10002 }} />
      {goldAnim && <GoldCoinAnim amount={goldAnim.amount} onDone={()=>setGoldAnim(null)} />}
    </>);
  }

  if (phase === "lobby") {
    const myLevel = myProfile?.level || 0;
    const myGamesNeeded = gamesNeededForLevel(myLevel);
    const myLevelPct = Math.max(0, Math.min(1, (myProfile?.levelProgress || 0) / myGamesNeeded));
    const authLoading = !authReady || !authUid;
    const winRate = myProfile && myProfile.totalGames > 0 ? Math.round((myProfile.wins / myProfile.totalGames) * 100) : 0;
    return (<div style={{ ...appStyle, background:`linear-gradient(180deg, ${t.bg} 0%, #071428 50%, #0a1a35 100%)`,position:"relative",overflow:"hidden" }}><style>{ANIMS}{`
@keyframes shimmerPass{0%{transform:translate3d(0,0,0)}100%{transform:translate3d(600%,0,0)}}
@keyframes logoFloat{0%,100%{transform:translateY(0) scale(1);filter:drop-shadow(0 0 40px rgba(0,229,255,0.4))}50%{transform:translateY(-6px) scale(1.02);filter:drop-shadow(0 8px 50px rgba(0,229,255,0.6))}}
    `}</style>
      {/* Animated ocean background */}
      <div style={{ position:"absolute",top:0,left:0,right:0,height:250,opacity:0.05,overflow:"hidden",pointerEvents:"none" }}>
        <div style={{ position:"absolute",bottom:0,left:"-50%",width:"200%",height:80,borderRadius:"50%",background:"linear-gradient(90deg,transparent,#00e5ff,transparent)",animation:"wave 6s linear infinite" }} />
        <div style={{ position:"absolute",bottom:30,left:"-50%",width:"200%",height:50,borderRadius:"50%",background:t.accent,opacity:0.6,animation:"wave 10s linear infinite reverse" }} />
        <div style={{ position:"absolute",bottom:60,left:"-50%",width:"200%",height:30,borderRadius:"50%",background:t.accent,opacity:0.3,animation:"wave 14s linear infinite" }} />
      </div>
      {/* Logo */}
      <div style={{ fontSize:"clamp(26px, 9.5vw, 42px)",fontWeight:900,letterSpacing:"clamp(4px, 2.4vw, 12px)",color:t.accent,textShadow:`0 0 60px ${t.accentGlow}, 0 3px 12px rgba(0,0,0,0.6)`,marginBottom:2,fontFamily:warrior,animation:"logoFloat 4s ease-in-out infinite",zIndex:1,WebkitTextStroke:"0.5px rgba(255,255,255,0.08)",width:"100%",textAlign:"center",whiteSpace:"nowrap",overflow:"hidden" }}>AMİRAL BATTI</div>
      <div style={{ display:"flex",alignItems:"center",gap:10,marginBottom:10,zIndex:1,width:"100%",maxWidth:400,justifyContent:"center" }}>
        <div style={{ flex:"0 1 52px",height:1,background:"linear-gradient(90deg, transparent, rgba(255,215,0,0.55))" }} />
        <div style={{ fontSize:"clamp(9px, 2.8vw, 11px)",color:t.gold,letterSpacing:"clamp(2px, 1.4vw, 6px)",fontFamily:warrior,fontStyle:"italic",fontWeight:700,textShadow:`0 0 14px ${t.goldGlow}`,whiteSpace:"nowrap",flexShrink:0 }}>{L(appLang,"tagline")}</div>
        <div style={{ flex:"0 1 52px",height:1,background:"linear-gradient(90deg, rgba(255,215,0,0.55), transparent)" }} />
      </div>
      {myProfile && (<div style={{ width:"100%",maxWidth:400,marginTop:8,marginBottom:14,zIndex:1,animation:"fadeUp 0.25s ease-out" }}>
        <div style={{ display:"flex",justifyContent:"space-between",alignItems:"baseline",marginBottom:5,padding:"0 2px" }}>
          <span style={{ fontSize:14,fontWeight:900,color:t.gold,fontFamily:warrior,letterSpacing:3,textShadow:`0 0 10px ${t.goldGlow}` }}>{L(appLang,"level")} {myLevel}</span>
          <span style={{ fontSize:12,fontWeight:800,color:t.textDim,fontFamily:mono,letterSpacing:1 }}>{Math.floor(myLevelPct*100)}%</span>
        </div>
        <div style={{ width:"100%",height:7,borderRadius:4,background:"rgba(0,0,0,0.45)",border:"1px solid rgba(255,215,0,0.25)",overflow:"hidden",position:"relative",boxShadow:"inset 0 1px 3px rgba(0,0,0,0.6)" }}>
          <div style={{ width:`${myLevelPct*100}%`,height:"100%",background:"linear-gradient(180deg, #fff9c4 0%, #ffe066 30%, #ffd700 60%, #d97706 100%)",boxShadow:`0 0 10px ${t.goldGlow}, inset 0 1px 0 rgba(255,255,255,0.5)`,transition:"width 0.7s cubic-bezier(0.34,1.56,0.64,1)",borderRadius:4,position:"relative",overflow:"hidden" }}>
            <span style={{ position:"absolute",top:0,left:"-100%",width:"50%",height:"100%",background:"linear-gradient(90deg,transparent,rgba(255,255,255,0.5),transparent)",animation:"shimmerPass 2.4s ease-in-out infinite" }} />
          </div>
        </div>
      </div>)}
      {authLoading && <div style={{ background:"rgba(239,68,68,0.12)",border:`1px solid ${t.hit}`,borderRadius:8,padding:"10px 16px",marginBottom:12,fontSize:11,color:t.hit,fontFamily:mono,textAlign:"center",width:"100%",maxWidth:340,animation:"pulse 1.5s infinite" }}>{L(appLang,"connectingToServer")}</div>}
      {isTestMode() && <div style={{ background:"rgba(251,191,36,0.15)",border:`1px solid ${t.gold}`,borderRadius:8,padding:"8px 16px",marginBottom:12,fontSize:11,color:t.gold,fontFamily:warrior,letterSpacing:2,textAlign:"center",width:"100%",maxWidth:340 }}>{L(appLang,"testModeMsg")}</div>}
      {myProfile && (<div style={{ background:`linear-gradient(145deg, ${t.surface}, ${t.surfaceLight})`,border:`2px solid ${myLevelPct>=0.999?"#ffd700":t.border}`,borderRadius:16,padding:"18px 22px",marginBottom:16,width:"100%",maxWidth:360,animation:"fadeUp 0.3s ease-out",boxShadow:`0 4px 20px rgba(0,0,0,0.4)`,zIndex:1 }}>
        <div style={{ display:"flex",alignItems:"center",justifyContent:"space-between",gap:10,marginBottom:12 }}>
          <div style={{ flex:1,minWidth:0 }}>
            <div style={{ display:"flex",alignItems:"center",gap:10,minWidth:0 }}>
              <div style={{ position:"relative",width:46,height:46,flexShrink:0 }}>
                <div style={{ width:"100%",height:"100%",borderRadius:"50%",background:`conic-gradient(#ffd700 ${myLevelPct*360}deg, rgba(255,255,255,0.10) ${myLevelPct*360}deg)`,padding:3,boxShadow:myLevelPct>=0.999?`0 0 16px ${t.goldGlow}, 0 0 30px ${t.goldGlow}`:"none",transition:"box-shadow 0.4s ease" }}>
                  <button onClick={()=>setShowAvatarPick(v=>!v)} title={L(appLang,"pickAvatarTooltip")} style={{ width:"100%",height:"100%",borderRadius:"50%",background:"rgba(0,229,255,0.10)",border:"none",display:"flex",alignItems:"center",justifyContent:"center",fontSize:20,cursor:"pointer",padding:0,overflow:"hidden" }}>{(myProfile.avatar||"").startsWith("data:")?<img src={myProfile.avatar} alt="" style={{ width:"100%",height:"100%",objectFit:"cover" }} />:(myProfile.avatar||"⚓")}</button>
                </div>
              </div>
              <div style={{ minWidth:0,flex:1 }}>
                <div title={myProfile.displayName} style={{ fontSize:18,fontWeight:800,color:t.text,fontFamily:warrior,letterSpacing:1.5,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",maxWidth:"100%" }}>{myProfile.displayName}</div>
                {(() => { const hn = migrateHonor(myProfile); const rk = getRankInfo(hn, appLang); return (
                  <div style={{ display:"flex",alignItems:"center",gap:5,marginTop:2,minWidth:0,flexWrap:"nowrap",overflow:"hidden" }}>
                    <span style={{ fontSize:11 }}>{rk.icon}</span>
                    <span style={{ fontSize:11,fontWeight:900,color:rk.color,fontFamily:warrior,letterSpacing:3,textShadow:`0 0 10px ${rk.color}55` }}>{rk.title}</span>
                    <span title={appLang==="en"?"Honor — earned only in battle":"Şeref — sadece savaşarak kazanılır"} style={{ fontSize:9,fontWeight:800,color:"rgba(255,255,255,0.45)",fontFamily:mono,letterSpacing:1,marginLeft:2 }}>⚔ {hn}{rk.next?`/${rk.next}`:""}</span>
                  </div>
                ); })()}
              </div>
            </div>
            {showAvatarPick && <div style={{ display:"flex",gap:6,flexWrap:"wrap",marginTop:8,padding:"8px 10px",background:"rgba(0,0,0,0.35)",borderRadius:12,border:`1px solid ${t.border}` }}>
              <button onClick={()=>avatarFileRef.current?.click()} title={L(appLang,"uploadPhotoTooltip")} style={{ width:36,height:36,borderRadius:"50%",background:"rgba(255,215,0,0.12)",border:`2px dashed ${t.gold}`,fontSize:20,fontWeight:900,color:t.gold,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",padding:0 }}>+</button>
              <input ref={avatarFileRef} type="file" accept="image/*" style={{ display:"none" }} onChange={handleAvatarUpload} />
              {[...["⚓","🦈","🐙","⚔","🌊","🦅","💀","🔱"], ...Object.keys(safeClaimed(myProfile.achievClaimed)).map(k=>ACH_AVATARS[k])].map(av=>(<button key={av} onClick={()=>{ setShowAvatarPick(false); if(authUid){ update(ref(db,`profiles/${authUid}`),{avatar:av}).catch(()=>{}); } setMyProfile(prev=>prev?{...prev,avatar:av}:prev); }} style={{ width:36,height:36,borderRadius:"50%",background:myProfile.avatar===av?"rgba(0,229,255,0.25)":"rgba(255,255,255,0.05)",border:`2px solid ${myProfile.avatar===av?t.accent:"transparent"}`,fontSize:18,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",padding:0 }}>{av}</button>))}
            </div>}
            {canChangeName() && <div style={{ display:"flex",alignItems:"center",gap:6,marginTop:4 }}>
              <button onClick={()=>{setPhase("splash");}} style={{ fontSize:8,color:t.textDim,background:"transparent",border:`1px solid ${t.border}`,borderRadius:4,padding:"2px 6px",cursor:"pointer",fontFamily:mono }}>✏ {L(appLang,"editName")}</button>
            </div>}
          </div>
          {/* ALTIN HAPI — kompakt ve sabit; uzun isim asla altına giremez */}
          <div style={{ flexShrink:0,display:"flex",alignItems:"center",gap:5,background:"linear-gradient(160deg, rgba(26,19,4,0.96), rgba(12,9,2,0.98))",borderRadius:999,padding:"5px 12px 5px 6px",border:"1.5px solid rgba(255,215,0,0.5)",boxShadow:"0 0 14px rgba(255,215,0,0.25), inset 0 1px 0 rgba(255,235,140,0.2), 0 3px 8px rgba(0,0,0,0.5)" }}>
            <img src="/img/coin.png" alt="" style={{ width:22,height:22,flexShrink:0,filter:"drop-shadow(0 0 5px rgba(255,215,0,0.85))" }} />
            <div style={{ fontSize:19,fontWeight:900,fontFamily:warrior,lineHeight:1,letterSpacing:0.5,color:"#ffd94a",textShadow:"0 0 10px rgba(255,215,0,0.55), 0 1px 2px rgba(0,0,0,0.8)",whiteSpace:"nowrap" }}>{safeGold(myProfile.gold).toLocaleString(appLang==="en"?"en-US":"tr-TR")}</div>
          </div>
        </div>
        {/* Künye satırı + form çizgisi + oran halkası */}
        <div style={{ display:"flex",alignItems:"center",justifyContent:"space-between",gap:12,marginTop:2 }}>
          <div style={{ flex:1,minWidth:0 }}>
            {/* Künye: G / M ayraçlı tek satır */}
            <div style={{ display:"flex",alignItems:"baseline",gap:10,marginBottom:9 }}>
              <span style={{ display:"flex",alignItems:"baseline",gap:5 }}>
                <span style={{ fontSize:20,fontWeight:900,color:"#34d399",fontFamily:warrior,textShadow:"0 0 10px rgba(52,211,153,0.35)" }}>{myProfile.wins||0}</span>
                <span style={{ fontSize:12,fontWeight:800,color:"rgba(52,211,153,0.8)",fontFamily:warrior,letterSpacing:2 }}>{L(appLang,"wins")}</span>
              </span>
              <span style={{ width:1,height:14,background:"rgba(255,255,255,0.12)",alignSelf:"center" }} />
              <span style={{ display:"flex",alignItems:"baseline",gap:5 }}>
                <span style={{ fontSize:20,fontWeight:900,color:t.hit,fontFamily:warrior,textShadow:"0 0 10px rgba(255,71,87,0.3)" }}>{myProfile.losses||0}</span>
                <span style={{ fontSize:12,fontWeight:800,color:"rgba(255,71,87,0.75)",fontFamily:warrior,letterSpacing:2 }}>{L(appLang,"losses")}</span>
              </span>
            </div>
            {/* Form çizgisi — son 5 maç */}
            {(() => { const rec = safeRecent(myProfile.recentResults); return (
              <div style={{ display:"flex",alignItems:"center",gap:6 }}>
                {Array.from({length:5}).map((_,i) => {
                  const idx = i - (5 - rec.length); const v = idx >= 0 ? rec[idx] : null;
                  return <span key={i} style={{ width:9,height:9,borderRadius:"50%",background:v==="W"?"#34d399":v==="L"?"#ff4757":"rgba(255,255,255,0.08)",border:v?"none":"1px solid rgba(255,255,255,0.10)",boxShadow:v==="W"?"0 0 7px rgba(52,211,153,0.55)":v==="L"?"0 0 7px rgba(255,71,87,0.45)":"none",display:"inline-block" }} />;
                })}
                <span style={{ fontSize:8,fontWeight:800,color:t.textDim,fontFamily:warrior,letterSpacing:2,marginLeft:4,opacity:0.7 }}>{appLang==="en"?"LAST 5":"SON 5"}</span>
              </div>
            ); })()}
          </div>
          {/* Oran halkası */}
          <div style={{ position:"relative",width:76,height:76,flexShrink:0 }}>
            <div style={{ position:"absolute",inset:0,borderRadius:"50%",background:`conic-gradient(from -90deg, #00e5ff 0deg, #ffd700 ${Math.max(winRate,0)*3.6}deg, rgba(255,255,255,0.07) ${Math.max(winRate,0)*3.6}deg 360deg)`,boxShadow:winRate>0?`0 0 16px rgba(0,229,255,0.25)`:"none" }} />
            <div style={{ position:"absolute",inset:6,borderRadius:"50%",background:t.surface,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:1 }}>
              <span style={{ fontSize:18,fontWeight:900,color:t.accent,fontFamily:warrior,lineHeight:1,textShadow:`0 0 12px ${t.accentGlow}` }}>%{winRate}</span>
              <span style={{ fontSize:7,fontWeight:800,color:t.textDim,fontFamily:warrior,letterSpacing:2 }}>{L(appLang,"winRate")}</span>
            </div>
          </div>
        </div>
      </div>)}
      {/* İNTİKAM MÜHRÜ — kayıp serisi varsa sonraki zafer katlanır */}
      {(() => {
        const ls = safeAch(myProfile?.ach).lossStreak;
        const rm = revengeMult(ls);
        if (rm <= 1) return null;
        return (
          <div style={{ width:"100%",maxWidth:400,marginBottom:10,zIndex:1,position:"relative",overflow:"hidden",background:"linear-gradient(135deg, rgba(200,30,30,0.16), rgba(255,140,0,0.10))",border:"2px solid rgba(255,80,60,0.55)",borderRadius:12,padding:"11px 14px",display:"flex",alignItems:"center",gap:10,animation:"pulse 1.8s ease-in-out infinite",boxShadow:"0 0 22px rgba(255,60,40,0.25)" }}>
            <span style={{ fontSize:22,filter:"drop-shadow(0 0 8px rgba(255,90,50,0.9))" }}>⚔</span>
            <div style={{ flex:1 }}>
              <div style={{ fontSize:12,fontWeight:900,color:"#ff9a76",fontFamily:warrior,letterSpacing:2,textShadow:"0 0 12px rgba(255,90,50,0.6)" }}>{L(appLang,"revengeActive")(rm)}</div>
              <div style={{ fontSize:9,fontWeight:700,color:"rgba(255,180,150,0.7)",fontFamily:mono,letterSpacing:1,marginTop:2,fontStyle:"italic" }}>{L(appLang,"revengeSub")}</div>
            </div>
            <span style={{ fontSize:20,fontWeight:900,color:"#ffd700",fontFamily:warrior,textShadow:"0 0 14px rgba(255,215,0,0.8)" }}>×{rm}</span>
          </div>
        );
      })()}
      {/* Main action buttons */}
      <div style={{ position:"relative",width:"100%",maxWidth:400,zIndex:1,animation:"fadeUp 0.5s ease-out" }}>
        {/* Köşe sonar dalgaları */}
        {!matchmaking && <>
        <span style={{ position:"absolute",top:-9,left:-9,width:30,height:30,borderTop:"3px solid rgba(0,229,255,0.55)",borderLeft:"3px solid rgba(0,229,255,0.55)",borderTopLeftRadius:18,animation:"sonarArc 2s ease-in-out infinite",pointerEvents:"none" }} />
        <span style={{ position:"absolute",bottom:-9,right:-9,width:30,height:30,borderBottom:"3px solid rgba(0,229,255,0.55)",borderRight:"3px solid rgba(0,229,255,0.55)",borderBottomRightRadius:18,animation:"sonarArc 2s ease-in-out 1s infinite",pointerEvents:"none" }} />
        </>}
        <RippleButton onClick={()=>startQuickMatch(null)} disabled={matchmaking||authLoading} style={{ width:"100%",padding:"15px 0",background:`linear-gradient(180deg, #22d8ff 0%, ${t.accent} 45%, #0077b6 100%)`,color:"#04202e",border:"2px solid rgba(255,255,255,0.35)",borderRadius:14,fontSize:27,fontWeight:900,letterSpacing:6,cursor:(matchmaking||authLoading)?"not-allowed":"pointer",fontFamily:warrior,textTransform:"uppercase",boxShadow:`0 0 34px ${t.accentGlow}, 0 5px 0 #045a80, 0 10px 22px rgba(0,0,0,0.5), inset 0 2px 0 rgba(255,255,255,0.45)`,opacity:(authLoading||matchmaking)?0.5:1,textShadow:"0 1px 0 rgba(255,255,255,0.4), 0 2px 3px rgba(0,60,90,0.5)",display:"flex",alignItems:"center",justifyContent:"center",gap:14,animation:matchmaking?"none":"btnBreath 2.2s ease-in-out infinite" }}>
          <svg width="30" height="32" viewBox="0 0 24 26" style={{ filter:"drop-shadow(0 3px 3px rgba(0,40,60,0.55))" }}><defs><linearGradient id="playTri" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stopColor="#ffffff"/><stop offset="60%" stopColor="#d8f6ff"/><stop offset="100%" stopColor="#8ad4f0"/></linearGradient></defs><polygon points="3,2 22,13 3,24" fill="url(#playTri)" stroke="rgba(4,60,90,0.5)" strokeWidth="1.2"/></svg>
          {L(appLang,"play")}
        </RippleButton>
      </div>
      <QuickMatchModal myProfile={myProfile} lang={appLang} phase={quickMatchPhase} candidate={quickMatchCandidate} opponent={quickMatchOpponent} secondsLeft={quickMatchSecondsLeft} onCancel={cancelQuickMatch} onRetry={retryQuickMatch} />
      <div style={{ display:"flex",gap:8,marginTop:10,width:"100%",maxWidth:400,animation:"fadeUp 0.6s ease-out",zIndex:1 }}>
        <RippleButton onClick={()=>{if(!authUid){setMessage(L(appLang,"msgConnecting"));return;}setShowOnlineLobby(true);}} disabled={authLoading} style={{ flex:1,padding:"15px 0",background:`linear-gradient(135deg,rgba(0,212,255,0.16),rgba(0,212,255,0.05))`,color:t.accent,border:`2px solid rgba(0,212,255,0.45)`,borderRadius:10,fontSize:21,fontWeight:900,letterSpacing:1,cursor:authLoading?"not-allowed":"pointer",fontFamily:warrior,textTransform:"uppercase",opacity:authLoading?0.4:1 }}>🌐 {L(appLang,"salon")}</RippleButton>
        <RippleButton onClick={()=>{if(!authUid){setMessage(L(appLang,"msgConnecting"));return;}setShowArenaSelect(true);}} disabled={authLoading} style={{ flex:1,padding:"15px 0",background:`linear-gradient(135deg,rgba(167,139,250,0.16),rgba(167,139,250,0.05))`,color:"#a78bfa",border:"2px solid rgba(167,139,250,0.45)",borderRadius:10,fontSize:21,fontWeight:900,letterSpacing:1,cursor:authLoading?"not-allowed":"pointer",fontFamily:warrior,textTransform:"uppercase",opacity:authLoading?0.4:1,display:"flex",alignItems:"center",justifyContent:"center",gap:6 }}><XAnchors size={20} color="#a78bfa"/> {L(appLang,"arena")}</RippleButton>
      </div>
      <div style={{ display:"flex",gap:8,marginTop:8,width:"100%",maxWidth:400,animation:"fadeUp 0.7s ease-out",zIndex:1 }}>
        <RippleButton onClick={startBotGame} style={{ flex:1,padding:"15px 0",background:`linear-gradient(135deg,rgba(52,211,153,0.16),rgba(52,211,153,0.05))`,color:"#34d399",border:"2px solid rgba(52,211,153,0.45)",borderRadius:10,fontSize:21,fontWeight:900,letterSpacing:1,cursor:"pointer",fontFamily:warrior,textTransform:"uppercase" }}>🤖 {L(appLang,"bot")}</RippleButton>
        <RippleButton onClick={()=>setShowLeaderboard(true)} style={{ flex:1,padding:"15px 0",background:`linear-gradient(135deg,rgba(255,215,0,0.14),rgba(255,215,0,0.04))`,color:t.gold,border:`2px solid rgba(255,215,0,0.45)`,borderRadius:10,fontSize:21,fontWeight:900,letterSpacing:1,cursor:"pointer",fontFamily:warrior,textTransform:"uppercase" }}>🏆 {L(appLang,"leaderboard")}</RippleButton>
      </div>
      {/* Kazanımlar */}
      {(() => {
        const activeIdx = ACH_SETS.findIndex((s,i) => achSetUnlocked(i, myProfile) && !achSetDone(s, myProfile));
        const aSet = activeIdx >= 0 ? ACH_SETS[activeIdx] : null;
        const aDone = aSet && myProfile ? aSet.missions.filter(m => { try { return m.check(myProfile, safeAch(myProfile.ach)); } catch(e) { return false; } }).length : 0;
        const claimable = myProfile ? ACH_SETS.some((s,i) => achSetUnlocked(i, myProfile) && achSetDone(s, myProfile) && !safeClaimed(myProfile.achievClaimed)[s.id]) : false;
        return (
          <RippleButton onClick={()=>setShowAchievements(true)} style={{ width:"100%",maxWidth:360,marginTop:8,padding:"13px 16px",background:claimable?"linear-gradient(135deg,rgba(255,215,0,0.20),rgba(255,159,67,0.08))":"linear-gradient(135deg,rgba(167,139,250,0.12),rgba(167,139,250,0.03))",color:claimable?t.gold:"#a78bfa",border:`2px solid ${claimable?"rgba(255,215,0,0.6)":"rgba(167,139,250,0.4)"}`,borderRadius:10,fontSize:17,fontWeight:900,letterSpacing:1,cursor:"pointer",fontFamily:warrior,textTransform:"uppercase",display:"flex",alignItems:"center",justifyContent:"center",gap:8,zIndex:1,animation:claimable?"borderGlow 1.6s infinite":"none" }}>
            🏅 {L(appLang,"achBtn")}
            {claimable
              ? <span style={{ fontSize:10,fontWeight:900,background:"#ffd700",color:"#1a1206",borderRadius:10,padding:"2px 8px",letterSpacing:1 }}>{L(appLang,"achClaim")}!</span>
              : aSet && <span style={{ fontSize:11,fontWeight:800,fontFamily:mono,opacity:0.8 }}>{aDone}/10</span>}
          </RippleButton>
        );
      })()}
      {message && <div style={{ marginTop:8,color:t.hit,fontSize:11,fontFamily:mono,zIndex:1 }}>{message}</div>}
      {/* GÜNLÜK GÖREVLER — kompakt canlı şerit */}
      {(() => {
        const dc = Object.keys(missionProgress).length;
        const ready = dc >= 3 && !chestClaimed && !dailyStats.chestClaimed;
        return (
          <div style={{ width:"100%",maxWidth:400,marginTop:10,zIndex:1 }}>
            <style>{`
@keyframes dmShine{0%{transform:translate3d(0,0,0)}100%{transform:translate3d(500%,0,0)}}
@keyframes dmDotPop{0%{transform:scale(0.3)}60%{transform:scale(1.4)}100%{transform:scale(1)}}
@keyframes dmGift{0%,100%{transform:rotate(-6deg) scale(1)}50%{transform:rotate(6deg) scale(1.12)}}
@keyframes dmReady{0%,100%{box-shadow:0 0 14px rgba(255,215,0,0.5)}50%{box-shadow:0 0 30px rgba(255,215,0,0.9)}}
            `}</style>
            <button onClick={() => { if (ready) { const reward = generateChestReward(appLang); setChestReward(reward); } else setDailyOpen(v=>!v); }}
              style={{ width:"100%",display:"flex",alignItems:"center",gap:10,padding:"13px 15px",borderRadius:ready?12:(dailyOpen?"12px 12px 0 0":12),cursor:"pointer",fontFamily:warrior,position:"relative",overflow:"hidden",transition:"all 0.3s",
                background: ready ? "linear-gradient(135deg, rgba(255,215,0,0.22), rgba(255,159,67,0.10))" : `linear-gradient(145deg, ${t.surface}, ${t.surfaceLight})`,
                border: `2px solid ${ready ? "rgba(255,215,0,0.7)" : t.border}`,
                animation: ready ? "dmReady 1.4s ease-in-out infinite" : "none" }}>
              <span style={{ position:"absolute",top:0,left:"-60%",width:"45%",height:"100%",background:"linear-gradient(105deg,transparent,rgba(255,255,255,0.09),transparent)",animation:"dmShine 3.4s ease-in-out infinite",pointerEvents:"none" }} />
              <span style={{ fontSize:20,display:"inline-block",animation:ready?"dmGift 0.8s ease-in-out infinite":"none",filter:ready?"drop-shadow(0 0 8px rgba(255,215,0,0.8))":"none" }}>🎁</span>
              <span style={{ fontSize:14,fontWeight:900,color:ready?t.gold:t.text,letterSpacing:2,textShadow:ready?`0 0 12px ${t.goldGlow}`:"none" }}>{ready ? L(appLang,"openChestBtn")+"!" : L(appLang,"missionsTitle")}</span>
              <span style={{ display:"flex",gap:5,marginLeft:"auto",alignItems:"center" }}>
                {[0,1,2].map(i => <span key={i} style={{ width:10,height:10,borderRadius:"50%",display:"inline-block",background:i<dc?"linear-gradient(160deg,#fff9c4,#ffd700)":"rgba(255,255,255,0.10)",boxShadow:i<dc?`0 0 8px ${t.goldGlow}`:"none",animation:i===dc-1?"dmDotPop 0.4s cubic-bezier(0.34,1.56,0.64,1)":"none" }} />)}
              </span>
              <span style={{ fontSize:12,fontWeight:800,color:ready?t.gold:t.textDim,fontFamily:mono }}>{dc}/3</span>
              {!ready && <span style={{ fontSize:11,color:t.textDim,transform:dailyOpen?"rotate(180deg)":"none",transition:"transform 0.25s" }}>▼</span>}
            </button>
            {dailyOpen && !ready && <div style={{ border:`2px solid ${t.border}`,borderTop:"none",borderRadius:"0 0 12px 12px",overflow:"hidden",animation:"fadeUp 0.25s ease-out" }}><MissionPanel missions={dailyMissions} missionProgress={missionProgress} lang={appLang} compact /></div>}
          </div>
        );
      })()}
      {chestReward && <ChestPopup reward={chestReward} lang={appLang} onClose={() => {
        // Gold'u Firebase'e yaz
        if (authUid) {
          const newGold = safeGold(myProfile?.gold) + chestReward.gold;
          get(ref(db, `profiles/${authUid}`)).then(snap => {
            if (snap.exists()) { const p = snap.val(); const ga = safeAch(p.ach); ga.goldEarned += chestReward.gold; set(ref(db, `profiles/${authUid}`), { ...p, gold: safeGold(p.gold) + chestReward.gold, ach: ga }); }
          }).catch(() => {});
          setMyProfile(prev => { if (!prev) return prev; const ga = safeAch(prev.ach); ga.goldEarned += chestReward.gold; return { ...prev, gold: newGold, ach: ga }; });
        }
        setChestClaimed(true); bumpDaily(d => { d.chestClaimed = true; }); setChestReward(null);
      }} />}
      {dailyReward && <DailyRewardPopup reward={dailyReward.reward} streak={dailyReward.streak} onClose={() => { setMyProfile(prev => prev ? { ...prev, gold: dailyReward.newGold, loginStreak: dailyReward.streak } : prev); setDailyReward(null); }} lang={appLang} />}
      {/* SEFERE ÇIKIYORUZ — açılış karşılaması, çarpı veya arkaya dokunarak kapanır */}
      {sailNotice && (
        <div onClick={() => setSailNotice(false)} style={{ position:"fixed",inset:0,overflow:"hidden",zIndex:9350,background:"radial-gradient(ellipse at 50% 45%, rgba(0,80,120,0.55) 0%, rgba(2,6,16,0.88) 65%)",display:"flex",alignItems:"center",justifyContent:"center",padding:16,animation:"settingsFadeIn 0.3s ease-out" }}>
          <style>{`
@keyframes sailPop{0%{transform:scale(0.3) translateY(50px);opacity:0}55%{transform:scale(1.08) translateY(-8px);opacity:1}75%{transform:scale(0.97) translateY(2px)}100%{transform:scale(1) translateY(0);opacity:1}}
@keyframes sailBob{0%,100%{transform:translateY(0) rotate(-3deg)}50%{transform:translateY(-9px) rotate(3deg)}}
@keyframes sailRise{0%{transform:translateY(0) scale(0.6);opacity:0}25%{opacity:0.85}100%{transform:translateY(-115px) scale(1.15);opacity:0}}
@keyframes sailRing{0%{transform:scale(0.85);opacity:0.55}100%{transform:scale(1.5);opacity:0}}
          `}</style>
          {/* Yükselen su kabarcıkları — baloncuk temasını dışarı taşır */}
          {[0,1,2,3,4,5,6].map(i => (
            <span key={i} style={{ position:"absolute",bottom:"22%",left:`${12 + i*12}%`,width:5+(i%3)*4,height:5+(i%3)*4,borderRadius:"50%",background:"rgba(160,225,255,0.35)",border:"1px solid rgba(200,240,255,0.5)",animation:`sailRise ${3.2+(i%4)*0.7}s ease-in ${i*0.45}s infinite`,pointerEvents:"none" }} />
          ))}
          <div onClick={e=>e.stopPropagation()} style={{ position:"relative",width:"min(84vw, 320px)",aspectRatio:"1 / 1",borderRadius:"50%",
            background:"radial-gradient(circle at 32% 26%, rgba(255,255,255,0.22) 0%, rgba(120,210,255,0.16) 22%, rgba(10,40,70,0.96) 55%, rgba(4,14,30,0.99) 100%)",
            border:"2px solid rgba(150,230,255,0.55)",
            boxShadow:"0 0 0 6px rgba(0,229,255,0.07), 0 0 50px rgba(0,200,255,0.35), 0 26px 60px rgba(0,0,0,0.75), inset 0 6px 24px rgba(255,255,255,0.18), inset 0 -14px 34px rgba(0,60,110,0.7)",
            display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",textAlign:"center",padding:"12% 13%",
            animation:"sailPop 0.85s cubic-bezier(0.34,1.56,0.64,1)" }}>
            {/* Baloncuk parlaması */}
            <span style={{ position:"absolute",top:"13%",left:"20%",width:"26%",height:"16%",borderRadius:"50%",background:"radial-gradient(ellipse, rgba(255,255,255,0.5) 0%, transparent 70%)",pointerEvents:"none",transform:"rotate(-25deg)" }} />
            <span style={{ position:"absolute",inset:-2,borderRadius:"50%",border:"2px solid rgba(0,229,255,0.4)",animation:"sailRing 2.6s ease-out infinite",pointerEvents:"none" }} />
            <button onClick={() => setSailNotice(false)} style={{ position:"absolute",top:"7%",right:"7%",width:30,height:30,borderRadius:"50%",background:"rgba(0,20,40,0.75)",border:"1.5px solid rgba(150,230,255,0.5)",color:"#bfe9ff",fontSize:14,fontWeight:900,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",padding:0,lineHeight:1 }}>✕</button>
            <div style={{ fontSize:"clamp(40px, 15vw, 54px)",lineHeight:1,marginBottom:6,animation:"sailBob 3.4s ease-in-out infinite",filter:"drop-shadow(0 6px 12px rgba(0,0,0,0.55))" }}>⛵</div>
            <div style={{ fontSize:"clamp(15px, 5vw, 19px)",fontWeight:900,color:"#7fe9ff",fontFamily:warrior,letterSpacing:2,textShadow:"0 0 18px rgba(0,229,255,0.8), 0 2px 4px rgba(0,0,0,0.7)",marginBottom:8 }}>{L(appLang,"sailTitle")}</div>
            <div style={{ fontSize:"clamp(10px, 3.2vw, 12px)",color:"#dff3ff",fontFamily:mono,lineHeight:1.55,marginBottom:6 }}>{L(appLang,"sailBody")}</div>
            <div style={{ fontSize:"clamp(9px, 2.9vw, 11px)",color:t.gold,fontFamily:mono,lineHeight:1.45,fontStyle:"italic",marginBottom:12,textShadow:"0 0 10px rgba(255,215,0,0.4)" }}>⚓ {L(appLang,"sailBody2")}</div>
            <button onClick={() => setSailNotice(false)} style={{ padding:"11px 22px",background:"linear-gradient(135deg,#22d8ff,#0891b2)",color:"#04202e",border:"1.5px solid rgba(255,255,255,0.4)",borderRadius:22,fontSize:"clamp(11px, 3.4vw, 13px)",fontWeight:900,letterSpacing:1.5,cursor:"pointer",fontFamily:warrior,boxShadow:"0 0 22px rgba(0,229,255,0.6), 0 5px 14px rgba(0,0,0,0.5)",whiteSpace:"nowrap" }}>{L(appLang,"sailOk")}</button>
          </div>
        </div>
      )}
      {/* SEFER DÖNÜŞÜ — karşılama */}
      {voyageReward && (
        <div style={{ position:"fixed",inset:0,overflow:"hidden",zIndex:9400,background:"radial-gradient(ellipse at 50% 40%, rgba(0,229,255,0.08) 0%, rgba(2,6,16,0.9) 70%)",backdropFilter:"blur(3px)",display:"flex",alignItems:"center",justifyContent:"center",padding:20 }}>
          <div style={{ background:`linear-gradient(160deg, #0c1a30, #071022)`,border:"2px solid rgba(0,229,255,0.4)",borderRadius:18,padding:"26px 28px",maxWidth:330,width:"100%",textAlign:"center",boxShadow:"0 0 50px rgba(0,229,255,0.2), 0 20px 60px rgba(0,0,0,0.7)",animation:"tutCardEnter 0.7s cubic-bezier(0.16,1,0.3,1)" }}>
            <div style={{ fontSize:52,marginBottom:8,animation:"logoFloat 3s ease-in-out infinite",display:"inline-block",filter:"drop-shadow(0 6px 14px rgba(0,0,0,0.6)) drop-shadow(0 0 20px rgba(0,229,255,0.4))" }}>⛵</div>
            <div style={{ fontSize:19,fontWeight:900,color:t.accent,fontFamily:warrior,letterSpacing:3,textShadow:`0 0 20px ${t.accentGlow}`,marginBottom:6 }}>{L(appLang,"voyageTitle")}</div>
            <div style={{ fontSize:12,color:t.textDim,fontFamily:mono,marginBottom:14 }}>{L(appLang,"voyageBody")(voyageReward.hours)}</div>
            <div style={{ fontSize:36,fontWeight:900,fontFamily:warrior,marginBottom:16,background:"linear-gradient(180deg,#fff9c4 0%,#ffe066 35%,#ffd700 65%,#d97706 100%)",WebkitBackgroundClip:"text",WebkitTextFillColor:"transparent",filter:"drop-shadow(0 0 16px rgba(255,215,0,0.8))" }}>+{voyageReward.gold} 💰</div>
            <button onClick={claimVoyage} style={{ width:"100%",padding:"15px 0",background:"linear-gradient(135deg,#ffd700,#ff9f43)",color:"#1a1206",border:"none",borderRadius:12,fontSize:16,fontWeight:900,letterSpacing:3,cursor:"pointer",fontFamily:warrior,boxShadow:`0 0 30px ${t.goldGlow}`,animation:"btnBreath 2s ease-in-out infinite",textTransform:"uppercase" }}>{L(appLang,"voyageCollect")}</button>
            <div style={{ fontSize:10,color:t.textDim,fontFamily:mono,marginTop:12,lineHeight:1.5,fontStyle:"italic" }}>⚓ {L(appLang,"voyageHint")}</div>
          </div>
        </div>
      )}
      {showDailyChest && !dailyChestModalOpen && <DailyChestFab onOpen={() => setDailyChestModalOpen(true)} lang={appLang} />}
      {dailyChestModalOpen && <DailyChestPopup onClaim={claimDailyChest} onClose={() => setDailyChestModalOpen(false)} lang={appLang} />}
      {goldAnim && <GoldCoinAnim amount={goldAnim.amount} onDone={()=>setGoldAnim(null)} />}
      <LivingHorizon profile={myProfile} lang={appLang} />
    </div>);
  }

  if (phase === "waiting") {
    return (<div style={appStyle}><style>{ANIMS}</style>
      <div style={{ fontSize:30,fontWeight:700,letterSpacing:5,color:t.accent,textShadow:`0 0 30px ${t.accentGlow}`,marginBottom:4,fontFamily:warrior }}>AMİRAL BATTI</div>
      <div style={{ fontSize:10,color:t.textDim,letterSpacing:6,marginBottom:28,fontFamily:warrior }}>{L(appLang,"waitingForOpponent")}</div>
      <div style={{ background:t.surface,border:`1px solid ${t.border}`,borderRadius:14,padding:28,textAlign:"center",width:"100%",maxWidth:340,boxShadow:"0 8px 32px rgba(0,0,0,0.3)" }}>
        <div style={{ fontSize:13,marginBottom:10,fontFamily:warrior,letterSpacing:2 }}>{L(appLang,"roomCodeLabel")}</div>
        <div style={{ fontSize:36,fontWeight:700,color:t.accent,letterSpacing:8,textShadow:`0 0 20px ${t.accentGlow}`,marginBottom:14,fontFamily:warrior }}>{roomId}</div>
        <div style={{ fontSize:11,color:t.textDim,fontFamily:mono }}>{L(appLang,"sendCodeMsg")}</div>
        {entryFeeDeducted && <div style={{ fontSize:11,color:t.gold,fontFamily:warrior,marginTop:8,letterSpacing:1 }}>{L(appLang,"entryFeePaid")(entryFeeDeducted)}</div>}
        <div style={{ marginTop:20 }}><div style={{ width:12,height:12,borderRadius:"50%",background:t.accent,margin:"0 auto",animation:"pulse 1.5s infinite" }} /></div>
      </div>
      <button onClick={cancelWaitingRoom} style={{ marginTop:20,padding:"12px 32px",background:"transparent",color:t.textDim,border:`2px solid ${t.border}`,borderRadius:10,fontSize:13,fontWeight:800,letterSpacing:2,cursor:"pointer",fontFamily:warrior }}>{L(appLang,"backBtn")}</button>
    </div>);
  }

  if (phase === "placing") {
    const allPlaced = placedShips.length === SHIPS.length, timerLow = placementTimer <= 15, nextShip = SHIPS.find(s => !placedShips.some(p => p.id === s.id));
    // Tahta hücre boyutu — ölçülen boş alandan. ÖNEMLİ: önizleme ekranı da bunu kullandığı
    // için tanım bloğun en başında olmalı (aksi halde erken return'de tanımsız kalır).
    const measuredPlace = fitCell(10);
    const placeCell = measuredPlace || Math.max(13, Math.min(24, Math.floor((viewport.w - gutter - 14) / 12)));
    // Placement preview overlay
    if (placementPreview && allPlaced) {
      return (<div style={{ ...appStyle, justifyContent:"center" }}><style>{ANIMS}</style>
        <div style={{ animation:"previewZoom 0.8s ease-out forwards",textAlign:"center",width:"100%",maxWidth:400 }}>
          <div style={{ fontSize:16,fontWeight:800,color:t.accent,fontFamily:warrior,letterSpacing:4,marginBottom:12,textShadow:`0 0 15px ${t.accentGlow}` }}>{L(appLang,"fleetReady")}</div>
          <div style={{ animation:"floatShadow 3s ease-in-out infinite",borderRadius:14,overflow:"hidden",border:`2px solid ${t.accent}`,boxShadow:`0 10px 40px rgba(0,0,0,0.5), 0 0 20px ${t.accentGlow}` }}>
            <Grid board={defenseBoard} cellSize={placeCell} isDefense shipColors={shipColorMap} overlay={defenseOverlay} disabled />
          </div>
          <div style={{ display:"flex",gap:10,marginTop:16,justifyContent:"center" }}>
            <button onClick={()=>setPlacementPreview(false)} style={{ padding:"12px 24px",background:"transparent",color:t.textDim,border:`2px solid ${t.border}`,borderRadius:10,fontSize:13,fontWeight:800,letterSpacing:2,cursor:"pointer",fontFamily:warrior }}>{L(appLang,"editBtn")}</button>
            <button onClick={confirmPlacement} style={{ padding:"12px 32px",background:`linear-gradient(135deg,${t.accent},#0891b2)`,color:t.bg,border:"none",borderRadius:10,fontSize:14,fontWeight:800,letterSpacing:3,cursor:"pointer",fontFamily:warrior,boxShadow:`0 4px 20px ${t.accentGlow}`,animation:"borderGlow 1.5s infinite" }}>{L(appLang,"confirmStartBattleBtn")}</button>
          </div>
        </div>
      </div>);
    }
    // SABİT YERLEŞTİRME EKRANI — kaydırma yok. Kontroller sığmazsa hücre küçülür.
    // Üst blok: geri 40 + başlık 26 + süre 30 + sayaç 22 + ipucu 34 + gemi butonları ~96 + rastgele 44 + döndür/geri al 50
    return (<div style={{ ...appStyle, height:"100dvh", maxHeight:"100dvh", overflow:"hidden", justifyContent:"flex-start", paddingBottom: 10 }}><style>{ANIMS}</style>
      {/* GERİ DÖN — bot maçından/hazırlıktan vazgeçip ana ekrana dönüş */}
      <div style={{ width:"100%",maxWidth:400,display:"flex",justifyContent:"flex-start",marginBottom:4 }}>
        <button onClick={() => { sfx.init(); sfx.play('click'); if (isBotGame) resetGame(); else setShowSurrenderConfirm(true); }}
          style={{ padding:"7px 14px",minHeight:32,background:"rgba(255,255,255,0.05)",color:t.textDim,border:`1.5px solid ${t.border}`,borderRadius:9,fontSize:11,fontWeight:900,letterSpacing:1.5,cursor:"pointer",fontFamily:warrior,display:"flex",alignItems:"center",gap:5 }}>← {L(appLang,"backBtn")}</button>
      </div>
      <div style={{ fontSize:17,fontWeight:800,letterSpacing:4,color:t.accent,marginBottom:2,fontFamily:warrior,textShadow:`0 0 15px ${t.accentGlow}` }}>{L(appLang,"placeShipScreenTitle")}</div>
      <div style={{ fontSize:20,fontWeight:800,marginBottom:3,color:timerLow?t.hit:t.accent,animation:timerLow?"blink3s 0.5s infinite":"none",fontFamily:warrior,textShadow:timerLow?`0 0 20px ${t.hitGlow}`:"none" }}>{formatTime(placementTimer)}</div>
      {/* Extra time button */}
      {placementTimer <= 15 && !extraTimeUsed && !placementConfirmed && (
        <button onClick={buyExtraTime} style={{ marginBottom:8,padding:"8px 18px",background:"linear-gradient(135deg, rgba(255,215,0,0.15), rgba(255,215,0,0.05))",color:t.gold,border:`2px solid rgba(255,215,0,0.3)`,borderRadius:10,fontSize:12,fontWeight:800,letterSpacing:2,cursor:"pointer",fontFamily:warrior,animation:"borderGlow 1s infinite",boxShadow:`0 0 15px ${t.goldGlow}` }}>{L(appLang,"extraTimeBtn")}</button>
      )}
      {extraTimeUsed && <div style={{ fontSize:10,color:t.gold,fontFamily:warrior,marginBottom:6,letterSpacing:2 }}>{L(appLang,"extraTimeUsedMsg")}</div>}
      <div style={{ fontSize:11,fontWeight:700,color:t.text,marginBottom:5,fontFamily:warrior,letterSpacing:2 }}>{L(appLang,"shipsPlacedLabel")(placedShips.length, SHIPS.length)}</div>
      {entryFeeDeducted && <div style={{ fontSize:11,fontWeight:700,color:t.gold,fontFamily:warrior,marginBottom:6,letterSpacing:2 }}>{L(appLang,"entryFeeShort")(entryFeeDeducted)}</div>}
      {!allPlaced && !placementConfirmed && (<>
        <div style={{ background:"linear-gradient(145deg, rgba(12,21,41,0.9), rgba(8,14,30,0.95))",border:`2px solid rgba(0,229,255,0.15)`,borderRadius:10,padding:"6px 10px 16px",marginBottom:8,fontSize:13,textAlign:"center",width:"100%",maxWidth:400,fontFamily:warrior,fontWeight:700,letterSpacing:1 }}>{selectedShip?<span><span style={{ color:t.accent,fontWeight:800 }}>▸</span> {L(appLang,"tapMapHint")}</span>:<span><span style={{ color:t.accent,fontWeight:800 }}>▸</span> {L(appLang,"pickShipHint")}</span>}</div>
        <div style={{ display:"flex",flexWrap:"wrap",gap:5,justifyContent:"center",marginBottom:6,maxWidth:400,width:"100%" }}>
          {SHIPS.map(ship=>{const placed=placedShips.some(p=>p.id===ship.id);const sel=selectedShip===ship.id;return(<button key={ship.id} onClick={()=>{if(!placed){setSelectedShip(sel?null:ship.id);setRotation(0);}}} style={{ padding:"7px 12px",background:placed?"rgba(22,32,64,0.4)":sel?t.accent:"rgba(12,21,41,0.8)",color:placed?t.textDim:sel?t.bg:t.text,border:`2px solid ${placed?"rgba(30,58,95,0.3)":sel?t.accent:ship.color+"66"}`,borderRadius:8,fontSize:11,cursor:placed?"default":"pointer",fontFamily:warrior,fontWeight:800,opacity:placed?0.35:1,textDecoration:placed?"line-through":"none",letterSpacing:1,animation:!placed&&!sel&&ship.id===nextShip?.id?"borderGlow 2s infinite":"none",transition:"all 0.15s ease" }}>{appLang==="en"?ship.nameEn:ship.name}({ship.size})</button>);})}
        </div>
        {/* Rastgele yerleştir */}
        {!placementConfirmed && <button onClick={autoPlaceShips} style={{ width:"100%",maxWidth:400,padding:"9px 0",marginBottom:6,background:"linear-gradient(135deg, rgba(167,139,250,0.15), rgba(167,139,250,0.05))",color:"#a78bfa",border:"2px solid rgba(167,139,250,0.4)",borderRadius:12,fontSize:15,fontWeight:800,cursor:"pointer",fontFamily:warrior,letterSpacing:3,display:"flex",alignItems:"center",justifyContent:"center",gap:10,boxShadow:"0 0 16px rgba(167,139,250,0.15)" }}>
          {L(appLang,"randomPlaceBtn")}
        </button>}
        {/* Mobile-friendly rotate and undo buttons - large touch targets */}
        <div style={{ display:"flex",gap:10,marginBottom:6,width:"100%",maxWidth:400,justifyContent:"center" }}>
          {selectedShip && <button onClick={() => setRotation((rotation + 1) % 4)} style={{ flex:1,maxWidth:180,padding:"9px 0",background:"linear-gradient(135deg, rgba(0,229,255,0.12), rgba(0,229,255,0.04))",color:t.accent,border:`2px solid rgba(0,229,255,0.3)`,borderRadius:12,fontSize:20,fontWeight:800,cursor:"pointer",fontFamily:warrior,letterSpacing:2,display:"flex",alignItems:"center",justifyContent:"center",gap:8 }}>
            <span style={{ fontSize:24,display:"inline-block",transform:`rotate(${rotation*90}deg)`,transition:"transform 0.3s ease" }}>↻</span> {L(appLang,"rotateLabel")}
          </button>}
          {placedShips.length > 0 && <button onClick={undoLastShip} style={{ flex:1,maxWidth:180,padding:"9px 0",background:"rgba(255,71,87,0.08)",color:t.hit,border:`2px solid rgba(255,71,87,0.3)`,borderRadius:12,fontSize:14,fontWeight:800,cursor:"pointer",fontFamily:warrior,letterSpacing:2 }}>{L(appLang,"undoBtn")}</button>}
        </div>
        {selectedShip && <div style={{ fontSize:10,color:t.textDim,fontFamily:mono,marginBottom:6,textAlign:"center" }}>{L(appLang,"placeHint")}</div>}
      </>)}
      {allPlaced && !placementConfirmed && <div style={{ textAlign:"center",marginBottom:12 }}>
        <button style={{ ...btnStyle,animation:"borderGlow 1.5s infinite",padding:"14px 36px",fontSize:16,fontWeight:800,letterSpacing:4,borderRadius:12 }} onClick={confirmPlacement}>{L(appLang,"confirmShipsBtn")}</button>
        <div style={{ fontSize:11,color:t.textDim,fontFamily:mono,marginTop:8,letterSpacing:1 }}>{L(appLang,"confirmShipsHint")}</div>
      </div>}
      {placementConfirmed && <div style={{ background:"linear-gradient(145deg, rgba(12,21,41,0.9), rgba(8,14,30,0.95))",border:`2px solid rgba(0,229,255,0.2)`,borderRadius:12,padding:"16px 24px",marginBottom:8,fontSize:14,fontWeight:700,color:t.accent,textAlign:"center",fontFamily:warrior,letterSpacing:2 }}>{L(appLang,"shipsReadyMsg")}<div style={{ marginTop:10 }}><div style={{ width:14,height:14,borderRadius:"50%",background:t.accent,margin:"0 auto",animation:"pulse 1.5s infinite" }} /></div></div>}
      <div ref={boardBoxRef} style={{ flex:1,minHeight:0,width:"100%",maxWidth:400,display:"flex",alignItems:"center",justifyContent:"center",overflow:"hidden" }}>
      <div onMouseLeave={() => { if(!dragRef.current) setHoverCells([]); }}><Grid board={defenseBoard} cellSize={placeCell} isDefense shipColors={shipColorMap} overlay={defenseOverlay} hoverCells={hoverCells} onClick={handleDefenseClick} onHover={handleDefenseHover} onCellPointerDown={handleShipPointerDown} disabled={placementConfirmed} /></div>
      </div>
    </div>);
  }

  if (phase === "playing") {
    const myLow = myClock <= 30, oppLow = oppClock <= 30, isAttack = activeBoard === "attack";
    const miniGrid = isOnboarding; // 7x7 grid for onboarding
    // SABİT TAHTA: ekran YÜKSEKLİĞİNE göre hücre boyutu — hiçbir cihazda dikey kaydırma olmaz.
    // Üst şerit (ayrıl + saatler + isabet + sekmeler) ve alt sabit çubuklar düşülür.
    // SABİT TAHTA + GÖRÜNÜR FİLO: filo şeridi (~40px) her ekranda kalır, sadece
    // ikincil bilgi satırı kısa ekranlarda gizlenir. Kaydırma hiçbir cihazda gerekmez.
    const shortScreen = viewport.h < 700;
    // Tahta boyutu ÖLÇÜLEN boş alandan gelir (fitCell). İlk karede ölçüm yoksa güvenli tahmin.
    const measured = fitCell(10);
    const playCell = measured || Math.max(13, Math.min(26, Math.floor((viewport.w - gutter - 14) / 12)));
    const gridSize = miniGrid ? Math.min(38, Math.floor((Math.min(viewport.w - 24, 320)) / 8)) : playCell;
    const flyEmoji = emojiToast || myEmojiToast;
    return (<div style={{ ...appStyle, height:"100dvh", maxHeight:"100dvh", overflow:"hidden", justifyContent:"flex-start", paddingTop:"calc(6px + env(safe-area-inset-top, 0px))", paddingBottom: "calc(126px + env(safe-area-inset-bottom, 0px))", background:`
      radial-gradient(ellipse at 15% 10%, rgba(0,229,255,0.14) 0%, transparent 50%),
      radial-gradient(ellipse at 85% 90%, rgba(255,71,87,0.12) 0%, transparent 50%),
      repeating-linear-gradient(0deg, transparent 0px, transparent 39px, rgba(0,229,255,0.07) 39px, rgba(0,229,255,0.07) 40px),
      repeating-linear-gradient(90deg, transparent 0px, transparent 39px, rgba(0,229,255,0.07) 39px, rgba(0,229,255,0.07) 40px),
      ${t.bg}`, position:"relative" }}><style>{ANIMS}</style>
      {/* HUD tarama çizgisi */}
      <div className="gpu" style={{ position:"fixed",top:0,left:0,right:0,height:2,background:"linear-gradient(90deg, transparent, rgba(0,229,255,0.25), transparent)",animation:"scanline 7s linear infinite",pointerEvents:"none",zIndex:1 }} />
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
      {/* OYUNDAN AYRIL — sol üstte sabit, üstteki ayar/ses butonlarıyla aynı tasarım dilinde.
          Sağ üstteki butonlarla çakışmaz, akışta yer kaplamaz. */}
      {/* AYRIL — ayar ve ses butonlarının hemen soluna, aynı üçlünün parçası olarak.
          Aynı ölçü (30×30), aynı köşe, aynı nötr renk. Sağdan konum: 14 + 30 + 8 + 30 + 8 = 90px */}
      <button onClick={() => { sfx.init(); sfx.play('click'); setShowSurrenderConfirm(true); }} title={L(appLang,"leaveGame")}
        style={{ position:"fixed",top:"calc(10px + env(safe-area-inset-top, 0px))",right:90,zIndex:9500,width:30,height:30,borderRadius:8,background:"rgba(255,255,255,0.06)",border:`1px solid ${t.border}`,color:t.textDim,fontSize:14,cursor:"pointer",fontFamily:warrior,display:"flex",alignItems:"center",justifyContent:"center",padding:0,lineHeight:1,transition:"all 0.15s ease" }}>⚑</button>
      <div style={{ height:48 }} />
      {/* Surrender confirm modal */}
      {showSurrenderConfirm && <div style={{ position:"fixed",inset:0,overflow:"hidden",background:"rgba(0,0,0,0.75)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:9999,backdropFilter:"blur(4px)" }}>
        <div style={{ background:`linear-gradient(145deg,rgba(12,21,41,0.99),rgba(8,14,30,0.99))`,border:`2px solid ${t.hit}`,borderRadius:16,padding:"28px 32px",textAlign:"center",maxWidth:300,width:"90%",boxShadow:`0 0 60px ${t.hitGlow}`,animation:"scaleUp 0.3s ease-out" }}>
          <div style={{ fontSize:32,marginBottom:10 }}>⚠️</div>
          <div style={{ fontSize:16,fontWeight:800,color:t.hit,fontFamily:warrior,letterSpacing:3,marginBottom:8 }}>{L(appLang,"leaveConfirmTitle")}</div>
          <div style={{ fontSize:12,color:t.textDim,fontFamily:mono,marginBottom:20 }}>{isOnboarding?L(appLang,"leaveConfirmBotBody"):L(appLang,"leaveConfirmBody")}</div>
          <div style={{ display:"flex",gap:10 }}>
            <button onClick={()=>setShowSurrenderConfirm(false)} style={{ flex:1,padding:"12px 0",background:`linear-gradient(135deg,${t.accent},#0891b2)`,color:t.bg,border:"none",borderRadius:10,fontSize:13,fontWeight:800,letterSpacing:2,cursor:"pointer",fontFamily:warrior }}>{L(appLang,"stay")}</button>
            <button onClick={()=>{setShowSurrenderConfirm(false);surrenderGame();}} style={{ flex:1,padding:"12px 0",background:"transparent",color:t.hit,border:`2px solid ${t.hit}`,borderRadius:10,fontSize:13,fontWeight:800,letterSpacing:2,cursor:"pointer",fontFamily:warrior }}>{L(appLang,"exit")}</button>
          </div>
        </div>
      </div>}
      {/* Onboarding mini guide — kaldırıldı */}
      {!isOnboarding && <div style={{ display:"flex",gap:8,alignItems:"stretch",marginBottom:6,width:"100%",maxWidth:400,justifyContent:"center" }}>
        <div style={{ flex:1,padding:"4px 10px",borderRadius:6,background:myTurn?(myLow?"rgba(239,68,68,0.15)":"rgba(6,182,212,0.12)"):t.surfaceLight,border:`1px solid ${myTurn?(myLow?t.hit:t.accent):t.border}`,textAlign:"center" }}>
          <div style={{ fontSize:14,fontWeight:900,fontFamily:warrior,color:myTurn?(myLow?t.hit:t.accent):t.textDim,letterSpacing:1 }}>{playerName}: {formatTime(myClock)}</div>
          <div style={{ width:"100%",height:4,borderRadius:3,background:"rgba(0,0,0,0.45)",overflow:"hidden",marginTop:3 }}>
            <div style={{ width:`${Math.max(0, Math.min(100, (myClock / CLOCK_SECONDS) * 100))}%`,height:"100%",borderRadius:3,background:myLow?`linear-gradient(90deg,#ff4757,#ff8a95)`:`linear-gradient(90deg,${t.accent},#22d8ff)`,transition:"width 1s linear",boxShadow:myLow?"0 0 6px rgba(255,71,87,0.7)":"none" }} />
          </div>
          <EmojiDisplay emoji={myEmojiToast?.emoji} label={myEmojiToast?.label} />
        </div>
        <div style={{ flex:1,padding:"4px 10px",borderRadius:6,background:!myTurn?(oppLow?"rgba(239,68,68,0.15)":"rgba(6,182,212,0.12)"):t.surfaceLight,border:`1px solid ${!myTurn?(oppLow?t.hit:t.accent):t.border}`,textAlign:"center" }}>
          <div style={{ fontSize:14,fontWeight:900,fontFamily:warrior,color:!myTurn?(oppLow?t.hit:t.accent):t.textDim,letterSpacing:1 }}>{opponentName}: {formatTime(oppClock)}</div>
          <div style={{ width:"100%",height:4,borderRadius:3,background:"rgba(0,0,0,0.45)",overflow:"hidden",marginTop:3 }}>
            <div style={{ width:`${Math.max(0, Math.min(100, (oppClock / CLOCK_SECONDS) * 100))}%`,height:"100%",borderRadius:3,background:oppLow?`linear-gradient(90deg,#ff4757,#ff8a95)`:`linear-gradient(90deg,${t.accent},#22d8ff)`,transition:"width 1s linear",boxShadow:oppLow?"0 0 6px rgba(255,71,87,0.7)":"none" }} />
          </div>
          <EmojiDisplay emoji={emojiToast?.emoji} label={emojiToast?.label} />
        </div>
      </div>}
      {isOnboarding && <div style={{ fontSize:18,fontWeight:900,color:t.accent,fontFamily:warrior,letterSpacing:8,marginBottom:8,textAlign:"center",textShadow:`0 0 30px ${t.accentGlow}, 0 0 60px rgba(0,229,255,0.2)`,animation:"victoryGlow 3s ease-in-out infinite",textTransform:"uppercase",display:"flex",alignItems:"center",justifyContent:"center",gap:10 }}><XAnchors size={18} color={t.accent}/> {L(appLang,"trainingBattle")} <XAnchors size={18} color={t.accent}/></div>}
      
      {!myTurn && !isBotGame && afkTimer !== null && afkTimer <= 15 && (
        <div style={{ background:afkTimer<=5?"rgba(255,71,87,0.2)":"rgba(255,215,0,0.1)",border:`1px solid ${afkTimer<=5?t.hit:t.gold}`,borderRadius:8,padding:"4px 14px",marginBottom:6,fontSize:12,fontWeight:800,color:afkTimer<=5?t.hit:t.gold,fontFamily:warrior,letterSpacing:2,animation:afkTimer<=5?"blink3s 0.4s infinite":"none",textAlign:"center" }}>
          ⏳ {L(appLang,"oppNotPlaying")} — {afkTimer}s
        </div>
      )}
      {!isOnboarding && !shortScreen && <div style={{ fontSize:12,color:t.text,marginBottom:6,fontFamily:mono,fontWeight:700 }}>{L(appLang,"hits")}: <span style={{ color:t.accent }}>{myHits}/20</span></div>}
      
      {streakToast && <div style={{ background:"rgba(251,191,36,0.15)",border:`1px solid ${t.gold}`,borderRadius:8,padding:"6px 14px",marginBottom:6,fontSize:14,color:t.gold,fontWeight:700,textAlign:"center",width:"100%",maxWidth:400,animation:"popIn 0.3s ease-out",fontFamily:warrior,letterSpacing:2 }}>🔥 {streakToast.streak} {L(appLang,"hitStreak")} — x{streakToast.mult} {L(appLang,"multiplier")}</div>}
      {hitStreak > 0 && !streakToast && <div style={{ fontSize:10,color:t.gold,marginBottom:4,fontFamily:warrior,letterSpacing:1,textAlign:"center" }}>🔥 Seri: {hitStreak}</div>}
      {damageReport && <div style={{ background:"rgba(239,68,68,0.1)",border:`1px solid ${t.hit}`,borderRadius:8,padding:"6px 14px",marginBottom:6,fontSize:11,color:t.hit,fontWeight:700,textAlign:"center",width:"100%",maxWidth:400,animation:"slideIn 0.3s ease-out",fontFamily:warrior,letterSpacing:1 }}>⚠ {damageReport}</div>}
      {!isOnboarding && <>
      <div style={{ display:"flex",gap:0,marginBottom:6,width:"100%",maxWidth:400 }}>
        <button onClick={()=>{setActiveBoard("attack");setMarkMode(false);}} style={{ flex:1,padding:"8px 0",fontSize:13,fontWeight:800,fontFamily:warrior,cursor:"pointer",background:isAttack?`linear-gradient(135deg,${t.accent},#0891b2)`:t.surfaceLight,color:isAttack?t.bg:t.textDim,border:`2px solid ${isAttack?t.accent:t.border}`,borderRadius:"10px 0 0 10px",letterSpacing:4,animation:myTurn&&isAttack?"borderGlow 2s infinite":"none",display:"flex",alignItems:"center",justifyContent:"center",gap:6 }}><XAnchors size={16} color={isAttack?t.bg:t.textDim}/> {L(appLang,"attack")}</button>
        <button onClick={()=>{setActiveBoard("defense");setMarkMode(false);}} style={{ flex:1,padding:"8px 0",fontSize:13,fontWeight:800,fontFamily:warrior,cursor:"pointer",background:!isAttack?`linear-gradient(135deg,${t.accent},#0891b2)`:t.surfaceLight,color:!isAttack?t.bg:t.textDim,border:`2px solid ${!isAttack?t.accent:t.border}`,borderRadius:"0 10px 10px 0",letterSpacing:4 }}>🛡 {L(appLang,"defense")}</button>
      </div>
      {isAttack && <button onClick={()=>setMarkMode(!markMode)} style={{ marginBottom:5,padding:"4px 14px",fontSize:10,fontWeight:700,fontFamily:warrior,background:markMode?t.gold:"transparent",color:markMode?t.bg:t.gold,border:`1px solid ${t.gold}`,borderRadius:6,cursor:"pointer",letterSpacing:2 }}>{markMode?`⚑ ${L(appLang,"markModeOn")}`:`⚑ ${L(appLang,"markMode")}`}</button>}
      </>}
      <div ref={boardBoxRef} style={{ flex:1,minHeight:0,width:"100%",maxWidth:400,display:"flex",alignItems:"center",justifyContent:"center",overflow:"hidden" }}>
      <div style={{ border:myTurn?`3px solid ${t.accent}`:`2px solid rgba(255,71,87,0.35)`,borderRadius:12,padding:2,animation:myTurn?"turnPulse 1.1s ease-in-out infinite":"none",transition:"border-color 0.4s ease",position:"relative" }}>
        {isAttack
          ? <Grid board={isOnboarding?Array.from({length:7},()=>Array(7).fill(0)):emptyGrid()} cellSize={isOnboarding?gridSize:playCell} overlay={getAttackDisplayOverlay()} onClick={handleAttackClick} onRightClick={handleAttackRightClick} onLongPress={handleAttackLongPress} disabled={!myTurn} manualMarks={manualMarks} blinkCells={blinkCells} onboardingHint={isOnboarding?[[2,2],[2,3],[2,4]]:null} />
          : <Grid board={defenseBoard} cellSize={isOnboarding?gridSize:playCell} isDefense shipColors={shipColorMap} overlay={defenseOverlay} disabled blinkCells={blinkCells} />}
        {microFeedback && <MicroFeedback text={microFeedback.text} color={microFeedback.color} onDone={()=>setMicroFeedback(null)} />}
      </div>
      </div>
      {!isOnboarding && (isAttack
        ? <FleetBar title={L(appLang,"oppShips")} ships={oppShipsData} hitCells={atkHitMap} color={t.hit} lang={appLang} />
        : <FleetBar title={L(appLang,"myShips")} ships={myShipsData} hitCells={defHitMap} color={t.accent} lang={appLang} />)}
      {isTestMode() && <button onClick={forceEndGame} style={{ marginTop:8,padding:"8px 16px",background:"rgba(251,191,36,0.2)",color:t.gold,border:`1px solid ${t.gold}`,borderRadius:6,fontSize:10,fontWeight:700,letterSpacing:1,cursor:"pointer",fontFamily:warrior }}>{L(appLang,"endGameTestBtn")}</button>}
      {myTurn && isAttack && !markMode && (<div style={{ position:"fixed",bottom:0,left:0,right:0,background:"rgba(10,14,23,0.97)",borderTop:`1px solid ${t.border}`,paddingTop:10,paddingLeft:16,paddingRight:16,paddingBottom:"calc(10px + env(safe-area-inset-bottom, 0px))",display:"flex",alignItems:"center",justifyContent:"center",gap:14,zIndex:100 }}>
        <div style={{ display:"flex",gap:5 }}>{[0,1,2].map(i=><div key={i} style={{ width:14,height:14,borderRadius:"50%",background:i<currentShots.length?t.hit:t.accent,opacity:i<currentShots.length?0.3:1,animation:i<currentShots.length?"popIn 0.3s ease-out":"none" }} />)}</div>
        <RippleButton onClick={fireShots} disabled={currentShots.length===0} style={{ padding:"12px 36px",background:currentShots.length>0?`linear-gradient(135deg,${t.hit},#dc2626)`:t.surfaceLight,color:currentShots.length>0?"#fff":t.textDim,border:"none",borderRadius:10,fontSize:16,fontWeight:700,letterSpacing:3,cursor:currentShots.length===0?"default":"pointer",fontFamily:warrior,boxShadow:currentShots.length>0?`0 0 24px ${t.hitGlow}`:"none",opacity:currentShots.length===0?0.5:1 }}>{L(appLang,"fire")} 🔥</RippleButton>
      </div>)}
      {/* EMOJİ — tek buton altında toplandı: hem yer açar hem spam'i engeller (3 sn bekleme) */}
      {!isOnboarding && (<>
        <button onClick={()=>{ sfx.init(); sfx.play('click'); setEmojiOpen(v=>!v); }}
          style={{ position:"fixed",right:12,bottom:`calc(${myTurn&&activeBoard==="attack"&&!markMode?"76px":"14px"} + env(safe-area-inset-bottom, 0px))`,zIndex:120,width:44,height:44,borderRadius:"50%",background:emojiOpen?"rgba(0,229,255,0.18)":"rgba(10,14,23,0.95)",border:`1.5px solid ${emojiOpen?t.accent:"rgba(0,229,255,0.35)"}`,fontSize:20,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",boxShadow:"0 3px 12px rgba(0,0,0,0.5)",padding:0,opacity:emojiCooldown?0.45:1 }}>
          {emojiOpen ? "✕" : "😀"}
        </button>
        {emojiOpen && (
          <div onClick={()=>setEmojiOpen(false)} style={{ position:"fixed",inset:0,zIndex:119 }} />
        )}
        {emojiOpen && (
          <div style={{ position:"fixed",right:12,bottom:`calc(${myTurn&&activeBoard==="attack"&&!markMode?"126px":"64px"} + env(safe-area-inset-bottom, 0px))`,zIndex:121,display:"grid",gridTemplateColumns:"repeat(4, 40px)",gap:6,padding:8,borderRadius:14,background:"rgba(10,14,23,0.97)",border:`1px solid ${t.border}`,boxShadow:"0 6px 24px rgba(0,0,0,0.6)",animation:"fadeUp 0.18s ease-out" }}>
            {QUICK_EMOJIS.map(qe=>(
              <button key={qe.id} disabled={emojiCooldown}
                onClick={()=>{ if (emojiCooldown) return; sendEmoji(qe); setEmojiOpen(false); setEmojiCooldown(true); setTimeout(()=>setEmojiCooldown(false), 3000); }}
                style={{ width:40,height:40,background:"rgba(255,255,255,0.05)",border:`1px solid ${t.border}`,fontSize:21,cursor:emojiCooldown?"not-allowed":"pointer",borderRadius:10,padding:0,opacity:emojiCooldown?0.4:1 }}>{qe.emoji}</button>
            ))}
          </div>
        )}
      </>)}
      <canvas id="confetti-canvas" style={{ position:'fixed',inset:0,pointerEvents:'none',zIndex:10002 }} />
      {goldAnim && <GoldCoinAnim amount={goldAnim.amount} onDone={()=>setGoldAnim(null)} />}
    </div>);
  }

  return null;
  })();

  return (<>{content}{renderTopBar()}{renderCodeModal()}{renderLogoutModal()}</>);
}
