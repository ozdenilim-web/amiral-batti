"use client";
import { useState, useEffect, useCallback, useRef } from "react";
import { db, ref, set, get, onValue, update } from "../lib/firebase";

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

const t = {
  bg: "#0a0e17", surface: "#111827", surfaceLight: "#1f2937",
  border: "#374151", text: "#e5e7eb", textDim: "#6b7280",
  accent: "#06b6d4", accentGlow: "rgba(6,182,212,0.3)",
  hit: "#ef4444", hitGlow: "rgba(239,68,68,0.4)",
  miss: "#4b5563", sunk: "#f97316",
  water: "rgba(6,182,212,0.06)", shipCell: "rgba(6,182,212,0.25)",
};

const ANIMS = `
@keyframes blink3s{0%,100%{opacity:1}50%{opacity:.15}}
@keyframes pulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.4;transform:scale(.8)}}
@keyframes borderGlow{0%,100%{border-color:#06b6d4;box-shadow:0 0 8px rgba(6,182,212,.4)}50%{border-color:#22d3ee;box-shadow:0 0 20px rgba(6,182,212,.7)}}
@keyframes popIn{0%{transform:scale(0)}60%{transform:scale(1.2)}100%{transform:scale(1)}}
@keyframes fadeUp{0%{opacity:0;transform:translateY(10px)}100%{opacity:1;transform:translateY(0)}}
@keyframes ripple{0%{transform:scale(0);opacity:.6}100%{transform:scale(2.5);opacity:0}}
@keyframes loadDots{0%,80%,100%{opacity:.3}40%{opacity:1}}
@keyframes slideIn{0%{opacity:0;transform:translateY(-20px)}100%{opacity:1;transform:translateY(0)}}
`;

function Grid({ board, cellSize, onClick, onHover, onRightClick, overlay, hoverCells, isDefense, shipColors, disabled, blinkCells, manualMarks }) {
  const [rippleCell, setRippleCell] = useState(null);
  const handleClick = (r, c) => {
    if (disabled) return;
    setRippleCell(`${r},${c}`);
    setTimeout(() => setRippleCell(null), 400);
    onClick?.(r, c);
  };
  return (
    <div style={{ background: t.surface, border: `1px solid ${t.border}`, borderRadius: 8, padding: 4, overflow: "hidden" }}>
      <div style={{ display: "flex" }}>
        <div style={{ width: cellSize, height: cellSize }} />
        {COL_LABELS.map((l, i) => (
          <div key={i} style={{ width: cellSize, height: cellSize, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 8, fontWeight: 700, color: t.textDim }}>{l}</div>
        ))}
      </div>
      {board.map((row, r) => (
        <div key={r} style={{ display: "flex" }}>
          <div style={{ width: cellSize, height: cellSize, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 8, fontWeight: 700, color: t.textDim }}>{r + 1}</div>
          {row.map((val, c) => {
            const ovr = overlay?.[r]?.[c];
            const isHov = hoverCells?.some(([hr, hc]) => hr === r && hc === c);
            const shipColor = shipColors?.[r]?.[c];
            const isBlink = blinkCells?.some(([br, bc]) => br === r && bc === c);
            const isManual = manualMarks?.[r]?.[c];
            const isRipple = rippleCell === `${r},${c}`;

            let bg = t.water, content = "", shadow = "none", clr = t.textDim;
            if (isDefense) {
              if (val > 0 && shipColor) bg = shipColor;
              else if (val > 0) bg = t.shipCell;
              if (ovr === "hit") { bg = t.hit; content = "✕"; shadow = `inset 0 0 12px ${t.hitGlow}`; clr = "#fff"; }
              else if (ovr === "miss") { bg = t.miss; content = "•"; }
            } else {
              if (ovr === "hit") { bg = t.hit; content = "✕"; shadow = `inset 0 0 12px ${t.hitGlow}`; clr = "#fff"; }
              else if (ovr === "miss") { bg = t.miss; content = "•"; }
              else if (ovr === "sunk") { bg = t.sunk; content = "✕"; shadow = "inset 0 0 12px rgba(249,115,22,0.4)"; clr = "#fff"; }
              else if (ovr === "selected") { bg = "rgba(6,182,212,0.4)"; content = "◎"; shadow = `inset 0 0 10px ${t.accentGlow}`; }
              if (!ovr && isManual) { bg = "rgba(75,85,99,0.3)"; content = "·"; clr = t.textDim; }
            }
            if (isHov) { bg = "rgba(6,182,212,0.35)"; shadow = `inset 0 0 10px ${t.accentGlow}`; }

            return (
              <div key={c}
                onClick={() => handleClick(r, c)}
                onMouseEnter={() => onHover?.(r, c)}
                onContextMenu={(e) => { e.preventDefault(); onRightClick?.(r, c); }}
                style={{
                  width: cellSize, height: cellSize,
                  border: `1px solid ${t.border}`,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 8, fontWeight: 700, cursor: disabled ? "default" : "pointer",
                  background: bg, boxShadow: shadow, color: clr,
                  transition: "all 0.15s ease", boxSizing: "border-box",
                  animation: isBlink ? "blink3s 0.5s ease-in-out 6" : isRipple ? "popIn 0.3s ease-out" : "none",
                  position: "relative", overflow: "hidden",
                }}
              >{content}</div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

function ShipStatusPanel({ title, ships, hitCells, color }) {
  if (!ships) return null;
  const shipList = Object.values(ships);
  return (
    <div style={{ background: t.surface, border: `1px solid ${t.border}`, borderRadius: 8, padding: "8px 10px", marginTop: 6 }}>
      <div style={{ fontSize: 9, letterSpacing: 2, color: t.textDim, marginBottom: 4, fontWeight: 700 }}>{title}</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
        {shipList.map((ship, idx) => {
          const shipDef = SHIPS.find(s => s.id === ship.id);
          const cells = ship.cells || [];
          const hits = cells.filter(([r, c]) => hitCells?.[r]?.[c]).length;
          const sunk = hits === cells.length && cells.length > 0;
          return (
            <div key={idx} style={{ display: "flex", alignItems: "center", gap: 3 }}>
              <span style={{ fontSize: 9, color: sunk ? t.sunk : t.text, textDecoration: sunk ? "line-through" : "none" }}>
                {shipDef?.name?.charAt(0) || "?"}
              </span>
              <div style={{ display: "flex", gap: 1 }}>
                {cells.map((_, i) => (
                  <div key={i} style={{
                    width: 7, height: 7, borderRadius: 1,
                    background: i < hits ? (sunk ? t.sunk : t.hit) : color || t.accent,
                    opacity: i < hits ? 1 : 0.3,
                  }} />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function NotationLog({ entries }) {
  const logRef = useRef(null);
  useEffect(() => { if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight; }, [entries]);
  return (
    <div ref={logRef} style={{
      background: t.surface, border: `1px solid ${t.border}`, borderRadius: 8,
      padding: "8px 10px", maxHeight: 120, overflowY: "auto", marginTop: 6,
    }}>
      <div style={{ fontSize: 9, letterSpacing: 2, color: t.textDim, marginBottom: 4, fontWeight: 700 }}>NOTASYON</div>
      {entries.length === 0 && <div style={{ fontSize: 9, color: t.textDim }}>Henüz atış yok</div>}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
        {entries.map((entry, i) => (
          <div key={i} style={{ fontSize: 9, color: entry.isMine ? t.accent : t.hit }}>
            <span style={{ fontWeight: 700 }}>{entry.name?.charAt(0)}#{entry.turnNum}</span> {entry.coords.join(",")}
          </div>
        ))}
      </div>
    </div>
  );
}

// ═══ LOADING SCREEN ═══
function LoadingScreen({ onReady }) {
  const [step, setStep] = useState(0);
  const msgs = ["Gemiler denize indiriliyor...", "Toplar hazırlanıyor...", "Radarlar aktif..."];
  useEffect(() => {
    const t1 = setTimeout(() => setStep(1), 800);
    const t2 = setTimeout(() => setStep(2), 1600);
    const t3 = setTimeout(() => onReady(), 2800);
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); };
  }, [onReady]);
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: "100vh", background: t.bg, padding: 20 }}>
      <div style={{ fontSize: 32, fontWeight: 800, letterSpacing: 4, color: t.accent, textShadow: `0 0 30px ${t.accentGlow}`, marginBottom: 32, animation: "fadeUp 0.5s ease-out" }}>
        AMİRAL BATTI
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {msgs.map((msg, i) => (
          <div key={i} style={{
            fontSize: 13, color: i <= step ? t.text : "transparent",
            transition: "all 0.4s ease",
            animation: i <= step ? "fadeUp 0.4s ease-out" : "none",
            fontFamily: "'JetBrains Mono', monospace",
          }}>
            <span style={{ color: t.accent, marginRight: 8 }}>{i <= step ? "✓" : "○"}</span>{msg}
          </div>
        ))}
      </div>
      <div style={{ display: "flex", gap: 6, marginTop: 32 }}>
        {[0,1,2].map(i => (
          <div key={i} style={{
            width: 8, height: 8, borderRadius: "50%", background: t.accent,
            animation: `loadDots 1.2s ease-in-out infinite`,
            animationDelay: `${i * 0.2}s`,
          }} />
        ))}
      </div>
    </div>
  );
}

// ═══ READY SCREEN ═══
function ReadyScreen({ onStart, opponentName }) {
  return (
    <div style={{
      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
      minHeight: "100vh", background: t.bg, padding: 20,
    }}>
      <div style={{ fontSize: 24, fontWeight: 800, color: t.accent, marginBottom: 12, animation: "fadeUp 0.5s ease-out", letterSpacing: 3, fontFamily: "'JetBrains Mono', monospace" }}>
        vs {opponentName}
      </div>
      <div style={{ fontSize: 16, color: t.text, marginBottom: 32, animation: "fadeUp 0.6s ease-out", fontFamily: "'JetBrains Mono', monospace" }}>
        Gemileri batırmaya hazır mısın?
      </div>
      <button onClick={onStart} style={{
        padding: "14px 40px", background: t.accent, color: t.bg, border: "none",
        borderRadius: 8, fontSize: 16, fontWeight: 800, letterSpacing: 3,
        textTransform: "uppercase", cursor: "pointer", fontFamily: "'JetBrains Mono', monospace",
        animation: "fadeUp 0.8s ease-out",
        boxShadow: `0 0 20px ${t.accentGlow}`,
      }}>
        HAZIR!
      </button>
    </div>
  );
}

// ═══ MAIN GAME ═══
export default function Game() {
  const [phase, setPhase] = useState("splash"); // splash, lobby, waiting, placing, ready, playing, gameover
  const [roomId, setRoomId] = useState("");
  const [inputRoomId, setInputRoomId] = useState("");
  const [playerNum, setPlayerNum] = useState(null);
  const [playerName, setPlayerName] = useState("");
  const [opponentName, setOpponentName] = useState("");
  const [message, setMessage] = useState("");

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

  // Toggle: "attack" or "defense"
  const [activeBoard, setActiveBoard] = useState("attack");

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

  const cellSize = typeof window !== "undefined" ? Math.min(30, Math.floor((Math.min(window.innerWidth - 24, 400)) / 12)) : 28;

  useEffect(() => { myTurnRef.current = myTurn; }, [myTurn]);
  useEffect(() => { phaseRef.current = phase; }, [phase]);

  // Placement timer
  useEffect(() => {
    if (phase === "placing" && !placementConfirmed) {
      if (placementTimerRef.current) clearInterval(placementTimerRef.current);
      placementTimerRef.current = setInterval(() => {
        setPlacementTimer(prev => {
          if (prev <= 1) {
            clearInterval(placementTimerRef.current);
            // Auto-place remaining ships randomly (or just confirm what's placed)
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    }
    return () => { if (placementTimerRef.current) clearInterval(placementTimerRef.current); };
  }, [phase, placementConfirmed]);

  // Chess clock
  useEffect(() => {
    if (phase === "playing") {
      if (clockIntervalRef.current) clearInterval(clockIntervalRef.current);
      clockIntervalRef.current = setInterval(() => {
        if (phaseRef.current !== "playing") return;
        if (myTurnRef.current) {
          myClockRef.current = Math.max(0, myClockRef.current - 1);
          setMyClock(myClockRef.current);
          if (myClockRef.current <= 0) {
            clearInterval(clockIntervalRef.current);
            const oppNum = playerNumRef.current === 1 ? 2 : 1;
            update(ref(db, `rooms/${roomIdRef.current}`), { winner: oppNum, winReason: "timeout" });
          }
        } else {
          oppClockRef.current = Math.max(0, oppClockRef.current - 1);
          setOppClock(oppClockRef.current);
          if (oppClockRef.current <= 0) {
            clearInterval(clockIntervalRef.current);
            update(ref(db, `rooms/${roomIdRef.current}`), { winner: playerNumRef.current, winReason: "timeout" });
          }
        }
      }, 1000);
    }
    return () => { if (clockIntervalRef.current) clearInterval(clockIntervalRef.current); };
  }, [phase]);

  // Firebase listener
  const listenToRoom = useCallback((rid, pNum) => {
    if (unsubRef.current) unsubRef.current();
    const gameRef = ref(db, `rooms/${rid}`);
    unsubRef.current = onValue(gameRef, (snapshot) => {
      const game = snapshot.val();
      if (!game) return;
      const myKey = pNum === 1 ? "p1" : "p2";
      const oppKey = pNum === 1 ? "p2" : "p1";

      if (game[`${oppKey}_name`]) setOpponentName(game[`${oppKey}_name`]);
      if (game[`${myKey}_ships`]) setMyShipsData(game[`${myKey}_ships`]);
      if (game[`${oppKey}_ships`]) setOppShipsData(game[`${oppKey}_ships`]);

      if (game.phase === "placing" && !placementConfirmed) setPhase("placing");
      if (game.phase === "playing") {
        if (phaseRef.current === "placing") {
          setPhase("ready");
        } else if (phaseRef.current !== "ready") {
          setPhase("playing");
        }
        setMyTurn(game.turn === pNum);
        if (game.clocks) {
          myClockRef.current = game.clocks[myKey] ?? CLOCK_SECONDS;
          oppClockRef.current = game.clocks[oppKey] ?? CLOCK_SECONDS;
          setMyClock(myClockRef.current);
          setOppClock(oppClockRef.current);
        }
      }

      if (game.attacks) {
        const attacks = Object.values(game.attacks);
        const defOvr = emptyGrid().map(r => r.map(() => null));
        const dHitMap = emptyGrid().map(r => r.map(() => false));
        let oh = 0;
        attacks.filter(a => a.target === myKey).forEach(a => {
          if (a.shots) a.shots.forEach(s => {
            defOvr[s.r][s.c] = s.result;
            if (s.result === "hit") { oh++; dHitMap[s.r][s.c] = true; }
          });
        });
        setDefenseOverlay(defOvr); setOppHits(oh); setDefHitMap(dHitMap);

        const atkOvr = emptyGrid().map(r => r.map(() => null));
        const aHitMap = emptyGrid().map(r => r.map(() => false));
        let mh = 0;
        attacks.filter(a => a.target === oppKey).forEach(a => {
          if (a.shots) a.shots.forEach(s => {
            atkOvr[s.r][s.c] = s.result;
            if (s.result === "hit") { mh++; aHitMap[s.r][s.c] = true; }
          });
        });
        if (game[`${oppKey}_ships`]) {
          Object.values(game[`${oppKey}_ships`]).forEach(ship => {
            const cells = ship.cells;
            if (cells.every(([r, c]) => atkOvr[r][c] === "hit" || atkOvr[r][c] === "sunk")) {
              cells.forEach(([r, c]) => { atkOvr[r][c] = "sunk"; });
            }
          });
        }
        setAttackOverlay(atkOvr); setMyHits(mh); setAtkHitMap(aHitMap);

        const entries = [];
        let p1T = 0, p2T = 0;
        attacks.forEach(a => {
          const isP1 = a.by === 1;
          if (isP1) p1T++; else p2T++;
          entries.push({
            name: isP1 ? (game.p1_name || "P1") : (game.p2_name || "P2"),
            turnNum: isP1 ? p1T : p2T,
            coords: a.shots ? a.shots.map(s => coordStr(s.r, s.c)) : [],
            isMine: a.by === pNum,
          });
        });
        setNotationEntries(entries);

        if (attacks.length > lastAttackCountRef.current) {
          const lastAtk = attacks[attacks.length - 1];
          lastAttackCountRef.current = attacks.length;
          if (lastAtk.target === myKey && lastAtk.shots) {
            setBlinkCells(lastAtk.shots.map(s => [s.r, s.c]));
            if (blinkTimerRef.current) clearTimeout(blinkTimerRef.current);
            blinkTimerRef.current = setTimeout(() => setBlinkCells([]), 3000);
            // Switch to defense to show incoming
            setActiveBoard("defense");
            if (game[`${myKey}_ships`]) {
              const myShips = Object.values(game[`${myKey}_ships`]);
              const reports = [];
              lastAtk.shots.forEach(s => {
                if (s.result === "hit") {
                  const hitShip = myShips.find(sh => sh.cells.some(([r, c]) => r === s.r && c === s.c));
                  if (hitShip) {
                    const shipDef = SHIPS.find(sd => sd.id === hitShip.id);
                    const totalH = hitShip.cells.filter(([r, c]) => dHitMap[r][c]).length;
                    const isSunk = totalH === hitShip.cells.length;
                    reports.push(isSunk ? `${shipDef?.name} battı!` : `${shipDef?.name} ${totalH} yara aldı`);
                  }
                }
              });
              if (reports.length > 0) {
                setDamageReport(reports.join(" • "));
                if (damageTimerRef.current) clearTimeout(damageTimerRef.current);
                damageTimerRef.current = setTimeout(() => setDamageReport(""), 8000);
              }
            }
          }
          if (lastAtk.by === pNum && lastAtk.shots) {
            setBlinkCells(lastAtk.shots.map(s => [s.r, s.c]));
            if (blinkTimerRef.current) clearTimeout(blinkTimerRef.current);
            blinkTimerRef.current = setTimeout(() => setBlinkCells([]), 3000);
          }
        }
      }

      if (game.winner) {
        const reason = game.winReason || "hits";
        let winMsg;
        if (game.winner === pNum) winMsg = reason === "timeout" ? "Kazandın! (Süre bitti)" : "Kazandın!";
        else winMsg = reason === "timeout" ? "Kaybettin! (Süren bitti)" : "Kaybettin!";
        setWinner(winMsg); setPhase("gameover");
        if (clockIntervalRef.current) clearInterval(clockIntervalRef.current);
      }
    });
  }, [placementConfirmed]);

  useEffect(() => {
    return () => {
      if (unsubRef.current) unsubRef.current();
      if (clockIntervalRef.current) clearInterval(clockIntervalRef.current);
      if (blinkTimerRef.current) clearTimeout(blinkTimerRef.current);
      if (damageTimerRef.current) clearTimeout(damageTimerRef.current);
      if (placementTimerRef.current) clearInterval(placementTimerRef.current);
    };
  }, []);

  useEffect(() => {
    const handler = (e) => { if (e.key === "r" || e.key === "R") setRotation(prev => (prev + 1) % 4); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const createRoom = async () => {
    if (!playerName.trim()) { setMessage("Adını yaz!"); return; }
    const id = Math.random().toString(36).substring(2, 8).toUpperCase();
    roomIdRef.current = id; setRoomId(id); setPlayerNum(1); playerNumRef.current = 1;
    await set(ref(db, `rooms/${id}`), {
      p1_name: playerName.trim(), p2_name: null, phase: "waiting",
      p1_board: null, p2_board: null, p1_ships: null, p2_ships: null,
      attacks: null, turn: 1, clocks: { p1: CLOCK_SECONDS, p2: CLOCK_SECONDS },
      winner: null, winReason: null, created: Date.now(),
    });
    setPhase("waiting"); listenToRoom(id, 1);
  };

  const joinRoom = async () => {
    if (!playerName.trim() || !inputRoomId.trim()) { setMessage("Adını ve oda kodunu yaz!"); return; }
    const rid = inputRoomId.trim().toUpperCase();
    const snapshot = await get(ref(db, `rooms/${rid}`));
    if (!snapshot.exists()) { setMessage("Oda bulunamadı!"); return; }
    const game = snapshot.val();
    if (game.p2_name) { setMessage("Oda dolu!"); return; }
    roomIdRef.current = rid; setRoomId(rid); setPlayerNum(2); playerNumRef.current = 2;
    setOpponentName(game.p1_name);
    await update(ref(db, `rooms/${rid}`), { p2_name: playerName.trim(), phase: "placing" });
    setPhase("placing"); listenToRoom(rid, 2);
  };

  const handleDefenseClick = (r, c) => {
    if (phase !== "placing" || !selectedShip || placementConfirmed) return;
    const ship = SHIPS.find(s => s.id === selectedShip);
    if (!ship) return;
    const cells = getShipCells(ship, r, c, rotation);
    const boardCopy = defenseBoard.map(row => [...row]);
    if (!isValidPlacement(cells, boardCopy)) return;
    const neighbors = getNeighborCells(cells);
    if (neighbors.some(([nr, nc]) => nr >= 0 && nr < ROWS && nc >= 0 && nc < COLS && boardCopy[nr][nc] > 0)) return;
    const newBoard = boardCopy.map(row => [...row]);
    const newColors = shipColorMap.map(row => [...row]);
    cells.forEach(([cr, cc]) => { newBoard[cr][cc] = 1; newColors[cr][cc] = ship.color; });
    setDefenseBoard(newBoard); setShipColorMap(newColors);
    setPlacedShips([...placedShips, { id: ship.id, cells, color: ship.color }]);
    setSelectedShip(null); setHoverCells([]); setRotation(0);
  };

  const handleDefenseHover = (r, c) => {
    if (phase !== "placing" || !selectedShip || placementConfirmed) { setHoverCells([]); return; }
    const ship = SHIPS.find(s => s.id === selectedShip);
    if (!ship) return;
    setHoverCells(getShipCells(ship, r, c, rotation));
  };

  const undoLastShip = () => {
    if (placedShips.length === 0) return;
    const last = placedShips[placedShips.length - 1];
    const newBoard = defenseBoard.map(row => [...row]);
    const newColors = shipColorMap.map(row => [...row]);
    last.cells.forEach(([r, c]) => { newBoard[r][c] = 0; newColors[r][c] = null; });
    setDefenseBoard(newBoard); setShipColorMap(newColors); setPlacedShips(placedShips.slice(0, -1));
  };

  const confirmPlacement = async () => {
    if (placedShips.length !== SHIPS.length) return;
    if (placementTimerRef.current) clearInterval(placementTimerRef.current);
    const pNum = playerNumRef.current;
    const myKey = pNum === 1 ? "p1" : "p2";
    const oppKey = pNum === 1 ? "p2" : "p1";
    const shipData = {};
    placedShips.forEach((s, i) => { shipData[i] = { id: s.id, cells: s.cells }; });
    const updates = {};
    updates[`${myKey}_board`] = defenseBoard;
    updates[`${myKey}_ships`] = shipData;
    await update(ref(db, `rooms/${roomIdRef.current}`), updates);
    const snapshot = await get(ref(db, `rooms/${roomIdRef.current}`));
    const game = snapshot.val();
    if (game[`${oppKey}_board`]) await update(ref(db, `rooms/${roomIdRef.current}`), { phase: "playing" });
    setPlacementConfirmed(true);
  };

  const handleAttackClick = (r, c) => {
    if (!myTurn || phase !== "playing") return;
    if (attackOverlay[r][c]) return;
    if (manualMarks[r][c]) return;
    const existing = currentShots.findIndex(([sr, sc]) => sr === r && sc === c);
    if (existing !== -1) { setCurrentShots(currentShots.filter((_, i) => i !== existing)); return; }
    if (currentShots.length >= SHOTS_PER_TURN) return;
    setCurrentShots([...currentShots, [r, c]]);
  };

  const handleAttackRightClick = (r, c) => {
    if (phase !== "playing") return;
    if (attackOverlay[r][c]) return;
    const newMarks = manualMarks.map(row => [...row]);
    newMarks[r][c] = !newMarks[r][c];
    setManualMarks(newMarks);
  };

  const fireShots = async () => {
    if (currentShots.length === 0) return;
    const pNum = playerNumRef.current;
    const myKey = pNum === 1 ? "p1" : "p2";
    const snapshot = await get(ref(db, `rooms/${roomIdRef.current}`));
    const game = snapshot.val();
    if (!game || game.turn !== pNum) return;
    const targetKey = pNum === 1 ? "p2" : "p1";
    const targetBoard = game[`${targetKey}_board`];
    const shotResults = currentShots.map(([r, c]) => ({ r, c, result: targetBoard[r][c] > 0 ? "hit" : "miss" }));
    const existingAttacks = game.attacks ? Object.values(game.attacks) : [];
    const prevHits = existingAttacks.filter(a => a.target === targetKey).reduce((sum, a) => sum + (a.shots ? a.shots.filter(s => s.result === "hit").length : 0), 0);
    const totalHits = prevHits + shotResults.filter(s => s.result === "hit").length;
    const attackIndex = existingAttacks.length;
    const updates = {};
    updates[`attacks/${attackIndex}`] = { by: pNum, target: targetKey, shots: shotResults, time: Date.now() };
    updates[`clocks/${myKey}`] = myClockRef.current;
    if (totalHits >= 20) { updates.winner = pNum; updates.winReason = "hits"; }
    else { updates.turn = pNum === 1 ? 2 : 1; }
    await update(ref(db, `rooms/${roomIdRef.current}`), updates);
    setCurrentShots([]);
  };

  const getAttackDisplayOverlay = () => {
    const ovr = attackOverlay.map(row => [...row]);
    currentShots.forEach(([r, c]) => { if (!ovr[r][c]) ovr[r][c] = "selected"; });
    return ovr;
  };

  const resetGame = () => {
    if (unsubRef.current) unsubRef.current();
    if (clockIntervalRef.current) clearInterval(clockIntervalRef.current);
    if (placementTimerRef.current) clearInterval(placementTimerRef.current);
    setPhase("lobby"); setRoomId(""); setInputRoomId(""); setPlayerNum(null);
    setDefenseBoard(emptyGrid()); setShipColorMap(Array.from({ length: ROWS }, () => Array(COLS).fill(null)));
    setAttackOverlay(emptyGrid().map(r => r.map(() => null))); setDefenseOverlay(emptyGrid().map(r => r.map(() => null)));
    setPlacedShips([]); setCurrentShots([]); setMyHits(0); setOppHits(0);
    setWinner(null); setMessage(""); setOpponentName(""); setPlacementConfirmed(false);
    setNotationEntries([]); setBlinkCells([]); setDamageReport("");
    setManualMarks(Array.from({ length: ROWS }, () => Array(COLS).fill(false)));
    setMyClock(CLOCK_SECONDS); setOppClock(CLOCK_SECONDS);
    myClockRef.current = CLOCK_SECONDS; oppClockRef.current = CLOCK_SECONDS;
    setMyShipsData(null); setOppShipsData(null); setActiveBoard("attack");
    setDefHitMap(emptyGrid().map(r => r.map(() => false))); setAtkHitMap(emptyGrid().map(r => r.map(() => false)));
    lastAttackCountRef.current = 0; setPlacementTimer(PLACEMENT_SECONDS);
  };

  const btnStyle = { padding: "12px 28px", background: t.accent, color: t.bg, border: "none", borderRadius: 8, fontSize: 13, fontWeight: 700, letterSpacing: 2, textTransform: "uppercase", cursor: "pointer", fontFamily: "'JetBrains Mono', monospace" };
  const btnSecStyle = { padding: "8px 16px", background: "transparent", color: t.accent, border: `1px solid ${t.accent}`, borderRadius: 6, fontSize: 11, fontWeight: 600, letterSpacing: 1, cursor: "pointer", fontFamily: "inherit" };
  const inputStyle = { padding: "12px 16px", background: t.surface, color: t.text, border: `1px solid ${t.border}`, borderRadius: 8, fontSize: 15, fontFamily: "inherit", outline: "none", textAlign: "center", width: "100%", maxWidth: 260, boxSizing: "border-box" };
  const appStyle = { minHeight: "100vh", minHeight: "100dvh", background: t.bg, color: t.text, fontFamily: "'JetBrains Mono', monospace", display: "flex", flexDirection: "column", alignItems: "center", padding: "12px 8px", boxSizing: "border-box" };

  // ═══ SPLASH ═══
  if (phase === "splash") {
    return (
      <>
        <style>{ANIMS}</style>
        <LoadingScreen onReady={() => setPhase("lobby")} />
      </>
    );
  }

  // ═══ LOBBY ═══
  if (phase === "lobby") {
    return (
      <div style={appStyle}>
        <style>{ANIMS}</style>
        <div style={{ fontSize: 26, fontWeight: 800, letterSpacing: 4, color: t.accent, textShadow: `0 0 30px ${t.accentGlow}`, marginBottom: 4, animation: "fadeUp 0.4s ease-out" }}>AMİRAL BATTI</div>
        <div style={{ fontSize: 10, color: t.textDim, letterSpacing: 6, marginBottom: 28 }}>ONLINE DENİZ SAVAŞI</div>
        <div style={{ background: t.surface, border: `1px solid ${t.border}`, borderRadius: 12, padding: "28px 20px", textAlign: "center", width: "100%", maxWidth: 340, animation: "fadeUp 0.5s ease-out" }}>
          <input style={inputStyle} placeholder="Adın" value={playerName} onChange={e => setPlayerName(e.target.value)} />
          <div style={{ height: 16 }} />
          <button style={{ ...btnStyle, width: "100%" }} onClick={createRoom}>Yeni Oda Oluştur</button>
          <div style={{ margin: "18px 0", color: t.textDim, fontSize: 10, letterSpacing: 3 }}>— VEYA —</div>
          <input style={inputStyle} placeholder="Oda Kodu" value={inputRoomId} onChange={e => setInputRoomId(e.target.value.toUpperCase())} />
          <div style={{ height: 10 }} />
          <button style={{ ...btnStyle, width: "100%" }} onClick={joinRoom}>Odaya Katıl</button>
          {message && <div style={{ marginTop: 14, color: t.hit, fontSize: 11 }}>{message}</div>}
        </div>
      </div>
    );
  }

  // ═══ WAITING ═══
  if (phase === "waiting") {
    return (
      <div style={appStyle}>
        <style>{ANIMS}</style>
        <div style={{ fontSize: 26, fontWeight: 800, letterSpacing: 4, color: t.accent, textShadow: `0 0 30px ${t.accentGlow}`, marginBottom: 4 }}>AMİRAL BATTI</div>
        <div style={{ fontSize: 10, color: t.textDim, letterSpacing: 6, marginBottom: 28 }}>RAKİP BEKLENİYOR</div>
        <div style={{ background: t.surface, border: `1px solid ${t.border}`, borderRadius: 12, padding: 28, textAlign: "center", width: "100%", maxWidth: 340 }}>
          <div style={{ fontSize: 13, marginBottom: 10 }}>Oda Kodu:</div>
          <div style={{ fontSize: 32, fontWeight: 800, color: t.accent, letterSpacing: 8, textShadow: `0 0 20px ${t.accentGlow}`, marginBottom: 14 }}>{roomId}</div>
          <div style={{ fontSize: 11, color: t.textDim }}>Bu kodu rakibine gönder!</div>
          <div style={{ marginTop: 20 }}>
            <div style={{ width: 12, height: 12, borderRadius: "50%", background: t.accent, margin: "0 auto", animation: "pulse 1.5s ease-in-out infinite" }} />
          </div>
        </div>
      </div>
    );
  }

  // ═══ PLACING ═══
  if (phase === "placing") {
    const allPlaced = placedShips.length === SHIPS.length;
    const nextShip = SHIPS.find(s => !placedShips.some(p => p.id === s.id));
    const timerLow = placementTimer <= 15;
    return (
      <div style={{ ...appStyle, paddingBottom: 80 }}>
        <style>{ANIMS}</style>
        <div style={{ fontSize: 18, fontWeight: 800, letterSpacing: 3, color: t.accent, marginBottom: 4 }}>GEMİ YERLEŞTİR</div>

        {/* Placement timer */}
        <div style={{
          fontSize: 20, fontWeight: 800, marginBottom: 8,
          color: timerLow ? t.hit : t.accent,
          animation: timerLow ? "blink3s 1s infinite" : "none",
        }}>
          {formatTime(placementTimer)}
        </div>

        {/* Step indicator */}
        <div style={{ fontSize: 11, color: t.textDim, marginBottom: 8, textAlign: "center" }}>
          {placedShips.length}/{SHIPS.length} gemi yerleştirildi
        </div>

        {!allPlaced && !placementConfirmed && (
          <>
            {/* Instructions */}
            <div style={{ background: t.surface, border: `1px solid ${t.border}`, borderRadius: 8, padding: "8px 14px", marginBottom: 8, fontSize: 11, textAlign: "center", width: "100%", maxWidth: 400 }}>
              {selectedShip ? (
                <span><span style={{ color: t.accent }}>▸</span> Haritada bir yere dokun</span>
              ) : (
                <span><span style={{ color: t.accent }}>▸</span> Aşağıdan bir gemi seç</span>
              )}
            </div>

            {/* Ship buttons */}
            <div style={{ display: "flex", flexWrap: "wrap", gap: 4, justifyContent: "center", marginBottom: 8, maxWidth: 400, width: "100%" }}>
              {SHIPS.map(ship => {
                const placed = placedShips.some(p => p.id === ship.id);
                const sel = selectedShip === ship.id;
                return (
                  <button key={ship.id} onClick={() => { if (!placed) { setSelectedShip(ship.id); setRotation(0); } }}
                    style={{
                      padding: "5px 10px", background: placed ? t.surfaceLight : sel ? t.accent : t.surface,
                      color: placed ? t.textDim : sel ? t.bg : t.text,
                      border: `1px solid ${placed ? t.border : sel ? t.accent : t.border}`,
                      borderRadius: 4, fontSize: 9, cursor: placed ? "default" : "pointer",
                      fontFamily: "inherit", opacity: placed ? 0.4 : 1,
                      textDecoration: placed ? "line-through" : "none", fontWeight: sel ? 700 : 400,
                      animation: !placed && !sel && ship.id === nextShip?.id ? "borderGlow 2s infinite" : "none",
                    }}>{ship.name}({ship.size})</button>
                );
              })}
            </div>

            {/* Action buttons */}
            <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
              {selectedShip && <button style={btnSecStyle} onClick={() => setRotation((rotation + 1) % 4)}>↻ Döndür</button>}
              {placedShips.length > 0 && <button style={{ ...btnSecStyle, color: t.hit, borderColor: t.hit }} onClick={undoLastShip}>↩ Geri</button>}
            </div>
          </>
        )}

        {allPlaced && !placementConfirmed && (
          <button style={{ ...btnStyle, marginBottom: 12, animation: "borderGlow 1.5s infinite" }} onClick={confirmPlacement}>
            ✓ Gemileri Onayla
          </button>
        )}

        {placementConfirmed && (
          <div style={{ background: t.surface, border: `1px solid ${t.border}`, borderRadius: 8, padding: "12px 20px", marginBottom: 8, fontSize: 12, color: t.accent, textAlign: "center" }}>
            Gemilerin hazır! Rakip bekleniyor...
            <div style={{ marginTop: 8 }}><div style={{ width: 12, height: 12, borderRadius: "50%", background: t.accent, margin: "0 auto", animation: "pulse 1.5s infinite" }} /></div>
          </div>
        )}

        <div onMouseLeave={() => setHoverCells([])}>
          <Grid board={defenseBoard} cellSize={cellSize} isDefense shipColors={shipColorMap} overlay={defenseOverlay} hoverCells={hoverCells} onClick={handleDefenseClick} onHover={handleDefenseHover} disabled={placementConfirmed} />
        </div>
      </div>
    );
  }

  // ═══ READY ═══
  if (phase === "ready") {
    return (
      <>
        <style>{ANIMS}</style>
        <ReadyScreen opponentName={opponentName} onStart={() => setPhase("playing")} />
      </>
    );
  }

  // ═══ PLAYING ═══
  if (phase === "playing") {
    const myLow = myClock <= 30;
    const oppLow = oppClock <= 30;
    const isAttack = activeBoard === "attack";
    return (
      <div style={{ ...appStyle, paddingBottom: 70 }}>
        <style>{ANIMS}</style>

        {/* Clocks */}
        <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 6, width: "100%", maxWidth: 400, justifyContent: "center" }}>
          <div style={{
            padding: "4px 10px", borderRadius: 6, fontSize: 13, fontWeight: 800,
            background: myTurn ? (myLow ? "rgba(239,68,68,0.15)" : "rgba(6,182,212,0.12)") : t.surfaceLight,
            color: myTurn ? (myLow ? t.hit : t.accent) : t.textDim,
            border: `1px solid ${myTurn ? (myLow ? t.hit : t.accent) : t.border}`,
            flex: 1, textAlign: "center",
          }}>{playerName}: {formatTime(myClock)}</div>
          <div style={{
            padding: "4px 10px", borderRadius: 6, fontSize: 13, fontWeight: 800,
            background: !myTurn ? (oppLow ? "rgba(239,68,68,0.15)" : "rgba(6,182,212,0.12)") : t.surfaceLight,
            color: !myTurn ? (oppLow ? t.hit : t.accent) : t.textDim,
            border: `1px solid ${!myTurn ? (oppLow ? t.hit : t.accent) : t.border}`,
            flex: 1, textAlign: "center",
          }}>{opponentName}: {formatTime(oppClock)}</div>
        </div>

        {/* Turn indicator */}
        <div style={{
          fontSize: 12, fontWeight: 700, marginBottom: 6, textAlign: "center",
          color: myTurn ? t.accent : t.textDim,
          animation: myTurn ? "fadeUp 0.3s ease-out" : "none",
        }}>
          {myTurn ? "SENİN SIRAN" : "Rakibin sırası..."}
          <span style={{ marginLeft: 8, fontSize: 10, color: t.textDim }}>
            İsabet: {myHits}/20 • Karavana: {oppHits}/20
          </span>
        </div>

        {/* Damage report */}
        {damageReport && (
          <div style={{
            background: "rgba(239,68,68,0.1)", border: `1px solid ${t.hit}`, borderRadius: 8,
            padding: "6px 14px", marginBottom: 6, fontSize: 11, color: t.hit, fontWeight: 700,
            textAlign: "center", width: "100%", maxWidth: 400, animation: "slideIn 0.3s ease-out",
          }}>⚠ {damageReport}</div>
        )}

        {/* Toggle buttons */}
        <div style={{ display: "flex", gap: 0, marginBottom: 6, width: "100%", maxWidth: 400 }}>
          <button onClick={() => setActiveBoard("attack")} style={{
            flex: 1, padding: "8px 0", fontSize: 12, fontWeight: 700, fontFamily: "inherit", cursor: "pointer",
            background: isAttack ? t.accent : t.surfaceLight, color: isAttack ? t.bg : t.textDim,
            border: `1px solid ${isAttack ? t.accent : t.border}`,
            borderRadius: "8px 0 0 8px",
            animation: myTurn && isAttack ? "borderGlow 2s infinite" : "none",
          }}>⚔ Saldırı</button>
          <button onClick={() => setActiveBoard("defense")} style={{
            flex: 1, padding: "8px 0", fontSize: 12, fontWeight: 700, fontFamily: "inherit", cursor: "pointer",
            background: !isAttack ? t.accent : t.surfaceLight, color: !isAttack ? t.bg : t.textDim,
            border: `1px solid ${!isAttack ? t.accent : t.border}`,
            borderRadius: "0 8px 8px 0",
          }}>🛡 Savunma</button>
        </div>

        {/* Active board */}
        <div style={{
          width: "100%", maxWidth: 400,
          border: myTurn && isAttack ? `2px solid ${t.accent}` : `1px solid transparent`,
          borderRadius: 10, padding: 2,
          animation: myTurn && isAttack ? "borderGlow 2s infinite" : "none",
        }}>
          {isAttack ? (
            <>
              <Grid board={emptyGrid()} cellSize={cellSize} overlay={getAttackDisplayOverlay()}
                onClick={handleAttackClick} onRightClick={handleAttackRightClick}
                disabled={!myTurn} manualMarks={manualMarks} blinkCells={blinkCells} />
              <ShipStatusPanel title="RAKİP GEMİLER" ships={oppShipsData} hitCells={atkHitMap} color={t.hit} />
            </>
          ) : (
            <>
              <Grid board={defenseBoard} cellSize={cellSize} isDefense shipColors={shipColorMap}
                overlay={defenseOverlay} disabled blinkCells={blinkCells} />
              <ShipStatusPanel title="GEMİLERİM" ships={myShipsData} hitCells={defHitMap} color={t.accent} />
            </>
          )}
        </div>

        {/* Notation */}
        <NotationLog entries={notationEntries} />

        {/* Sticky fire button */}
        {myTurn && isAttack && (
          <div style={{
            position: "fixed", bottom: 0, left: 0, right: 0,
            background: "rgba(10,14,23,0.95)", backdropFilter: "blur(8px)",
            borderTop: `1px solid ${t.border}`,
            padding: "10px 16px", display: "flex", alignItems: "center", justifyContent: "center", gap: 12,
            zIndex: 100,
          }}>
            <div style={{ display: "flex", gap: 4 }}>
              {[0,1,2].map(i => (
                <div key={i} style={{
                  width: 12, height: 12, borderRadius: "50%",
                  background: i < currentShots.length ? t.hit : t.accent,
                  opacity: i < currentShots.length ? 0.3 : 1,
                  animation: i < currentShots.length ? "popIn 0.3s ease-out" : "none",
                }} />
              ))}
            </div>
            <span style={{ fontSize: 11, color: t.textDim }}>{currentShots.length}/{SHOTS_PER_TURN}</span>
            <button
              onClick={fireShots}
              disabled={currentShots.length === 0}
              style={{
                ...btnStyle, padding: "10px 32px",
                opacity: currentShots.length === 0 ? 0.4 : 1,
                cursor: currentShots.length === 0 ? "default" : "pointer",
                boxShadow: currentShots.length > 0 ? `0 0 16px ${t.accentGlow}` : "none",
              }}
            >
              ATEŞ! 🔥
            </button>
            <span style={{ fontSize: 9, color: t.textDim }}>Sağ tık = işaretle</span>
          </div>
        )}
      </div>
    );
  }

  // ═══ GAME OVER ═══
  if (phase === "gameover") {
    return (
      <div style={appStyle}>
        <style>{ANIMS}</style>
        <div style={{ fontSize: 26, fontWeight: 800, letterSpacing: 4, color: t.accent, marginBottom: 24, animation: "fadeUp 0.4s ease-out" }}>AMİRAL BATTI</div>
        <div style={{
          fontSize: 28, fontWeight: 800, letterSpacing: 3, textAlign: "center",
          color: winner?.includes("Kazand") ? t.accent : t.hit,
          textShadow: `0 0 30px ${winner?.includes("Kazand") ? t.accentGlow : t.hitGlow}`,
          marginBottom: 16, animation: "fadeUp 0.6s ease-out",
        }}>{winner}</div>
        <div style={{ color: t.textDim, fontSize: 12, marginBottom: 24 }}>
          İsabet: {myHits}/20 • Karavana: {oppHits}/20
        </div>
        <button style={btnStyle} onClick={resetGame}>Yeni Oyun</button>
      </div>
    );
  }

  return null;
}
