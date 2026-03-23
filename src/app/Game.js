"use client";
import { useState, useEffect, useCallback, useRef } from "react";
import { db, ref, set, get, onValue, update } from "../lib/firebase";

const ROWS = 11;
const COLS = 11;
const COL_LABELS = ["A","B","C","D","E","F","G","H","I","J","K"];
const SHOTS_PER_TURN = 3;
const CLOCK_SECONDS = 180;

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
function formatTime(sec) { return `${Math.floor(sec / 60)}:${(sec % 60).toString().padStart(2, "0")}`; }

const t = {
  bg: "#0a0e17", surface: "#111827", surfaceLight: "#1f2937",
  border: "#374151", text: "#e5e7eb", textDim: "#6b7280",
  accent: "#06b6d4", accentGlow: "rgba(6,182,212,0.3)",
  hit: "#ef4444", hitGlow: "rgba(239,68,68,0.4)",
  miss: "#4b5563", sunk: "#f97316",
  water: "rgba(6,182,212,0.06)", shipCell: "rgba(6,182,212,0.25)",
};

const CSS_ANIMS = `
@keyframes blink3s { 0%,100%{opacity:1} 50%{opacity:0.15} }
@keyframes pulse { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:0.4;transform:scale(0.8)} }
@keyframes clockWarn { 0%,100%{color:#ef4444} 50%{color:#fbbf24} }
`;

function Grid({ board, cellSize, onClick, onHover, onRightClick, overlay, hoverCells, isDefense, shipColors, disabled, blinkCells, manualMarks }) {
  return (
    <div style={{ background: t.surface, border: `1px solid ${t.border}`, borderRadius: 8, padding: 8, overflow: "hidden" }}>
      <div style={{ display: "flex" }}>
        <div style={{ width: cellSize, height: cellSize }} />
        {COL_LABELS.map((l, i) => (
          <div key={i} style={{ width: cellSize, height: cellSize, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, fontWeight: 700, color: t.textDim }}>{l}</div>
        ))}
      </div>
      {board.map((row, r) => (
        <div key={r} style={{ display: "flex" }}>
          <div style={{ width: cellSize, height: cellSize, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, fontWeight: 700, color: t.textDim }}>{r + 1}</div>
          {row.map((val, c) => {
            const ovr = overlay?.[r]?.[c];
            const isHov = hoverCells?.some(([hr, hc]) => hr === r && hc === c);
            const shipColor = shipColors?.[r]?.[c];
            const isBlink = blinkCells?.some(([br, bc]) => br === r && bc === c);
            const isManual = manualMarks?.[r]?.[c];

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
                onClick={() => !disabled && onClick?.(r, c)}
                onMouseEnter={() => onHover?.(r, c)}
                onContextMenu={(e) => { e.preventDefault(); onRightClick?.(r, c); }}
                style={{
                  width: cellSize, height: cellSize,
                  border: `1px solid ${t.border}`,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 9, fontWeight: 700, cursor: disabled ? "default" : "pointer",
                  background: bg, boxShadow: shadow, color: clr,
                  transition: "all 0.15s ease", boxSizing: "border-box",
                  animation: isBlink ? "blink3s 0.5s ease-in-out 6" : "none",
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
    <div style={{ background: t.surface, border: `1px solid ${t.border}`, borderRadius: 8, padding: "10px 14px", marginTop: 8 }}>
      <div style={{ fontSize: 10, letterSpacing: 2, color: t.textDim, marginBottom: 6, fontWeight: 700 }}>{title}</div>
      {shipList.map((ship, idx) => {
        const shipDef = SHIPS.find(s => s.id === ship.id);
        const cells = ship.cells || [];
        const hits = cells.filter(([r, c]) => hitCells?.[r]?.[c]).length;
        const sunk = hits === cells.length && cells.length > 0;
        return (
          <div key={idx} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
            <span style={{ fontSize: 10, color: sunk ? t.sunk : t.text, width: 55, textDecoration: sunk ? "line-through" : "none", fontWeight: sunk ? 700 : 400 }}>
              {shipDef?.name || ship.id}
            </span>
            <div style={{ display: "flex", gap: 2 }}>
              {cells.map((_, i) => (
                <div key={i} style={{
                  width: 10, height: 10, borderRadius: 2,
                  background: i < hits ? (sunk ? t.sunk : t.hit) : color || t.accent,
                  opacity: i < hits ? 1 : 0.3,
                }} />
              ))}
            </div>
            {hits > 0 && !sunk && <span style={{ fontSize: 9, color: t.hit }}>{hits} yara</span>}
            {sunk && <span style={{ fontSize: 9, color: t.sunk, fontWeight: 700 }}>BATTI!</span>}
          </div>
        );
      })}
    </div>
  );
}

function NotationLog({ entries }) {
  const logRef = useRef(null);
  useEffect(() => { if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight; }, [entries]);
  return (
    <div ref={logRef} style={{
      background: t.surface, border: `1px solid ${t.border}`, borderRadius: 8,
      padding: "10px 12px", width: 150, minWidth: 130, maxHeight: 500, overflowY: "auto", flexShrink: 0,
    }}>
      <div style={{ fontSize: 10, letterSpacing: 2, color: t.textDim, marginBottom: 8, fontWeight: 700 }}>NOTASYON</div>
      {entries.length === 0 && <div style={{ fontSize: 10, color: t.textDim }}>Henüz atış yok</div>}
      {entries.map((entry, i) => (
        <div key={i} style={{ marginBottom: 6, paddingBottom: 6, borderBottom: `1px solid ${t.border}` }}>
          <div style={{ fontSize: 9, color: entry.isMine ? t.accent : t.hit, fontWeight: 700, marginBottom: 2 }}>
            {entry.name} #{entry.turnNum}
          </div>
          <div style={{ fontSize: 10, color: t.text, letterSpacing: 1 }}>{entry.coords.join(", ")}</div>
        </div>
      ))}
    </div>
  );
}

export default function Game() {
  const [phase, setPhase] = useState("lobby");
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

  const unsubRef = useRef(null);
  const playerNumRef = useRef(null);
  const roomIdRef = useRef("");
  const blinkTimerRef = useRef(null);
  const damageTimerRef = useRef(null);
  const clockIntervalRef = useRef(null);
  const myClockRef = useRef(CLOCK_SECONDS);
  const oppClockRef = useRef(CLOCK_SECONDS);
  const myTurnRef = useRef(false);
  const phaseRef = useRef("lobby");
  const lastAttackCountRef = useRef(0);

  const cellSize = typeof window !== "undefined" ? Math.min(28, Math.floor((Math.min(window.innerWidth - 60, 420)) / 12)) : 28;

  useEffect(() => { myTurnRef.current = myTurn; }, [myTurn]);
  useEffect(() => { phaseRef.current = phase; }, [phase]);

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
        setPhase("playing");
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

        // Defense overlay
        const defOvr = emptyGrid().map(r => r.map(() => null));
        const dHitMap = emptyGrid().map(r => r.map(() => false));
        let oh = 0;
        attacks.filter(a => a.target === myKey).forEach(a => {
          if (a.shots) a.shots.forEach(s => {
            defOvr[s.r][s.c] = s.result;
            if (s.result === "hit") { oh++; dHitMap[s.r][s.c] = true; }
          });
        });
        setDefenseOverlay(defOvr);
        setOppHits(oh);
        setDefHitMap(dHitMap);

        // Attack overlay
        const atkOvr = emptyGrid().map(r => r.map(() => null));
        const aHitMap = emptyGrid().map(r => r.map(() => false));
        let mh = 0;
        attacks.filter(a => a.target === oppKey).forEach(a => {
          if (a.shots) a.shots.forEach(s => {
            atkOvr[s.r][s.c] = s.result;
            if (s.result === "hit") { mh++; aHitMap[s.r][s.c] = true; }
          });
        });

        // Check sunk — NO auto passive
        if (game[`${oppKey}_ships`]) {
          Object.values(game[`${oppKey}_ships`]).forEach(ship => {
            const cells = ship.cells;
            if (cells.every(([r, c]) => atkOvr[r][c] === "hit" || atkOvr[r][c] === "sunk")) {
              cells.forEach(([r, c]) => { atkOvr[r][c] = "sunk"; });
            }
          });
        }
        setAttackOverlay(atkOvr);
        setMyHits(mh);
        setAtkHitMap(aHitMap);

        // Notation
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

        // Blink + Damage report only on NEW attacks
        if (attacks.length > lastAttackCountRef.current) {
          const lastAtk = attacks[attacks.length - 1];
          lastAttackCountRef.current = attacks.length;

          // Blink on defense if opponent just shot me
          if (lastAtk.target === myKey && lastAtk.shots) {
            setBlinkCells(lastAtk.shots.map(s => [s.r, s.c]));
            if (blinkTimerRef.current) clearTimeout(blinkTimerRef.current);
            blinkTimerRef.current = setTimeout(() => setBlinkCells([]), 3000);

            // Damage report
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

          // Blink on attack if I just shot
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
        if (game.winner === pNum) {
          winMsg = reason === "timeout" ? "Kazandın! (Süre bitti)" : "Kazandın!";
        } else {
          winMsg = reason === "timeout" ? "Kaybettin! (Süren bitti)" : "Kaybettin!";
        }
        setWinner(winMsg);
        setPhase("gameover");
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
    setPhase("lobby"); setRoomId(""); setInputRoomId(""); setPlayerNum(null);
    setDefenseBoard(emptyGrid()); setShipColorMap(Array.from({ length: ROWS }, () => Array(COLS).fill(null)));
    setAttackOverlay(emptyGrid().map(r => r.map(() => null))); setDefenseOverlay(emptyGrid().map(r => r.map(() => null)));
    setPlacedShips([]); setCurrentShots([]); setMyHits(0); setOppHits(0);
    setWinner(null); setMessage(""); setOpponentName(""); setPlacementConfirmed(false);
    setNotationEntries([]); setBlinkCells([]); setDamageReport("");
    setManualMarks(Array.from({ length: ROWS }, () => Array(COLS).fill(false)));
    setMyClock(CLOCK_SECONDS); setOppClock(CLOCK_SECONDS);
    myClockRef.current = CLOCK_SECONDS; oppClockRef.current = CLOCK_SECONDS;
    setMyShipsData(null); setOppShipsData(null);
    setDefHitMap(emptyGrid().map(r => r.map(() => false))); setAtkHitMap(emptyGrid().map(r => r.map(() => false)));
    lastAttackCountRef.current = 0;
  };

  const boxStyle = { background: t.surface, border: `1px solid ${t.border}`, borderRadius: 12, padding: 32, textAlign: "center", maxWidth: 420, width: "100%" };
  const btnStyle = { padding: "10px 24px", background: t.accent, color: t.bg, border: "none", borderRadius: 6, fontSize: 12, fontWeight: 700, letterSpacing: 2, textTransform: "uppercase", cursor: "pointer", fontFamily: "inherit" };
  const btnSecStyle = { padding: "8px 16px", background: "transparent", color: t.accent, border: `1px solid ${t.accent}`, borderRadius: 6, fontSize: 11, fontWeight: 600, letterSpacing: 1, textTransform: "uppercase", cursor: "pointer", fontFamily: "inherit" };
  const inputStyle = { padding: "10px 16px", background: t.surface, color: t.text, border: `1px solid ${t.border}`, borderRadius: 6, fontSize: 14, fontFamily: "inherit", outline: "none", textAlign: "center", width: 220 };
  const appStyle = { minHeight: "100vh", background: t.bg, color: t.text, fontFamily: "'JetBrains Mono', monospace", display: "flex", flexDirection: "column", alignItems: "center", padding: 16 };

  // ═══ LOBBY ═══
  if (phase === "lobby") {
    return (
      <div style={appStyle}>
        <style>{CSS_ANIMS}</style>
        <div style={{ fontSize: 28, fontWeight: 800, letterSpacing: 4, color: t.accent, textShadow: `0 0 30px ${t.accentGlow}`, marginBottom: 4 }}>AMİRAL BATTI</div>
        <div style={{ fontSize: 11, color: t.textDim, letterSpacing: 6, marginBottom: 24 }}>ONLINE DENİZ SAVAŞI</div>
        <div style={boxStyle}>
          <input style={inputStyle} placeholder="Adın" value={playerName} onChange={e => setPlayerName(e.target.value)} />
          <div style={{ height: 20 }} />
          <button style={btnStyle} onClick={createRoom}>Yeni Oda Oluştur</button>
          <div style={{ margin: "20px 0", color: t.textDim, fontSize: 11, letterSpacing: 3 }}>— VEYA —</div>
          <input style={inputStyle} placeholder="Oda Kodu" value={inputRoomId} onChange={e => setInputRoomId(e.target.value.toUpperCase())} />
          <div style={{ height: 12 }} />
          <button style={btnStyle} onClick={joinRoom}>Odaya Katıl</button>
          {message && <div style={{ marginTop: 16, color: t.hit, fontSize: 12 }}>{message}</div>}
        </div>
      </div>
    );
  }

  // ═══ WAITING ═══
  if (phase === "waiting") {
    return (
      <div style={appStyle}>
        <style>{CSS_ANIMS}</style>
        <div style={{ fontSize: 28, fontWeight: 800, letterSpacing: 4, color: t.accent, textShadow: `0 0 30px ${t.accentGlow}`, marginBottom: 4 }}>AMİRAL BATTI</div>
        <div style={{ fontSize: 11, color: t.textDim, letterSpacing: 6, marginBottom: 24 }}>RAKİP BEKLENİYOR</div>
        <div style={boxStyle}>
          <div style={{ fontSize: 14, marginBottom: 12 }}>Oda Kodu:</div>
          <div style={{ fontSize: 36, fontWeight: 800, color: t.accent, letterSpacing: 8, textShadow: `0 0 20px ${t.accentGlow}`, marginBottom: 16 }}>{roomId}</div>
          <div style={{ fontSize: 12, color: t.textDim }}>Bu kodu rakibine gönder!</div>
          <div style={{ marginTop: 24 }}>
            <div style={{ width: 12, height: 12, borderRadius: "50%", background: t.accent, margin: "0 auto", animation: "pulse 1.5s ease-in-out infinite" }} />
          </div>
        </div>
      </div>
    );
  }

  // ═══ PLACING ═══
  if (phase === "placing") {
    const allPlaced = placedShips.length === SHIPS.length;
    return (
      <div style={appStyle}>
        <style>{CSS_ANIMS}</style>
        <div style={{ fontSize: 22, fontWeight: 800, letterSpacing: 3, color: t.accent, marginBottom: 4 }}>GEMİ YERLEŞTİR</div>
        <div style={{ fontSize: 11, color: t.textDim, letterSpacing: 3, marginBottom: 12 }}>
          {opponentName ? `vs ${opponentName}` : "Rakip bekleniyor..."} • {placedShips.length}/{SHIPS.length}
        </div>
        {!allPlaced && (
          <>
            <div style={{ background: t.surface, border: `1px solid ${t.border}`, borderRadius: 8, padding: "10px 20px", marginBottom: 12, fontSize: 12, textAlign: "center", maxWidth: 420, width: "100%" }}>
              <span style={{ color: t.accent }}>▸</span> Gemi seç → Haritada tıkla &nbsp;|&nbsp; <strong>R</strong> = Döndür
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, justifyContent: "center", marginBottom: 12, maxWidth: 500 }}>
              {SHIPS.map(ship => {
                const placed = placedShips.some(p => p.id === ship.id);
                const sel = selectedShip === ship.id;
                return (
                  <button key={ship.id} onClick={() => { if (!placed) { setSelectedShip(ship.id); setRotation(0); } }}
                    style={{
                      padding: "6px 12px", background: placed ? t.surfaceLight : sel ? t.accent : t.surface,
                      color: placed ? t.textDim : sel ? t.bg : t.text,
                      border: `1px solid ${placed ? t.border : sel ? t.accent : t.border}`,
                      borderRadius: 4, fontSize: 10, cursor: placed ? "default" : "pointer",
                      fontFamily: "inherit", opacity: placed ? 0.5 : 1,
                      textDecoration: placed ? "line-through" : "none", fontWeight: sel ? 700 : 400,
                    }}>{ship.name} ({ship.size})</button>
                );
              })}
            </div>
            <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap", justifyContent: "center" }}>
              {selectedShip && <button style={btnSecStyle} onClick={() => setRotation((rotation + 1) % 4)}>↻ Döndür</button>}
              {placedShips.length > 0 && <button style={{ ...btnSecStyle, color: t.hit, borderColor: t.hit }} onClick={undoLastShip}>↩ Geri Al</button>}
            </div>
          </>
        )}
        {allPlaced && !placementConfirmed && (
          <div style={{ marginBottom: 16 }}>
            <button style={btnStyle} onClick={confirmPlacement}>✓ Gemileri Onayla</button>
          </div>
        )}
        {placementConfirmed && (
          <div style={{ background: t.surface, border: `1px solid ${t.border}`, borderRadius: 8, padding: "12px 24px", marginBottom: 12, fontSize: 12, color: t.accent }}>
            Gemilerin hazır! Rakip bekleniyor...
            <div style={{ marginTop: 8 }}><div style={{ width: 12, height: 12, borderRadius: "50%", background: t.accent, margin: "0 auto", animation: "pulse 1.5s ease-in-out infinite" }} /></div>
          </div>
        )}
        <div onMouseLeave={() => setHoverCells([])}>
          <Grid board={defenseBoard} cellSize={cellSize} isDefense shipColors={shipColorMap} overlay={defenseOverlay} hoverCells={hoverCells} onClick={handleDefenseClick} onHover={handleDefenseHover} disabled={placementConfirmed} />
        </div>
      </div>
    );
  }

  // ═══ PLAYING ═══
  if (phase === "playing") {
    const myLow = myClock <= 30;
    const oppLow = oppClock <= 30;
    return (
      <div style={appStyle}>
        <style>{CSS_ANIMS}</style>
        <div style={{ fontSize: 22, fontWeight: 800, letterSpacing: 3, color: t.accent, marginBottom: 4 }}>AMİRAL BATTI</div>
        <div style={{ fontSize: 11, color: t.textDim, letterSpacing: 3, marginBottom: 8 }}>vs {opponentName}</div>

        {/* Clock */}
        <div style={{ display: "flex", gap: 16, alignItems: "center", marginBottom: 8 }}>
          <div style={{
            padding: "6px 14px", borderRadius: 6, fontSize: 16, fontWeight: 800, fontFamily: "inherit",
            background: myTurn ? (myLow ? "rgba(239,68,68,0.15)" : "rgba(6,182,212,0.12)") : t.surfaceLight,
            color: myTurn ? (myLow ? t.hit : t.accent) : t.textDim,
            border: `1px solid ${myTurn ? (myLow ? t.hit : t.accent) : t.border}`,
          }}>{playerName}: {formatTime(myClock)}</div>
          <span style={{ color: t.textDim, fontSize: 11 }}>vs</span>
          <div style={{
            padding: "6px 14px", borderRadius: 6, fontSize: 16, fontWeight: 800, fontFamily: "inherit",
            background: !myTurn ? (oppLow ? "rgba(239,68,68,0.15)" : "rgba(6,182,212,0.12)") : t.surfaceLight,
            color: !myTurn ? (oppLow ? t.hit : t.accent) : t.textDim,
            border: `1px solid ${!myTurn ? (oppLow ? t.hit : t.accent) : t.border}`,
          }}>{opponentName}: {formatTime(oppClock)}</div>
        </div>

        {/* Status */}
        <div style={{ background: t.surface, border: `1px solid ${t.border}`, borderRadius: 8, padding: "10px 20px", marginBottom: 8, textAlign: "center", width: "100%", maxWidth: 1100 }}>
          {myTurn ? (
            <div>
              <span style={{ color: t.accent, fontWeight: 700, fontSize: 14 }}>SENİN SIRAN</span>
              <span style={{ margin: "0 12px", color: t.textDim }}>|</span>
              <span style={{ fontSize: 12 }}>
                Atış: {currentShots.length}/{SHOTS_PER_TURN}
                <span style={{ display: "inline-flex", gap: 4, marginLeft: 8, verticalAlign: "middle" }}>
                  {[0,1,2].map(i => (
                    <span key={i} style={{ width: 10, height: 10, borderRadius: "50%", display: "inline-block", background: i < currentShots.length ? t.hit : t.accent, opacity: i < currentShots.length ? 0.3 : 1 }} />
                  ))}
                </span>
              </span>
              {currentShots.length > 0 && (
                <button style={{ ...btnStyle, marginLeft: 16, padding: "6px 16px", fontSize: 11 }} onClick={fireShots}>ATEŞ!</button>
              )}
            </div>
          ) : (
            <span style={{ color: t.textDim, fontSize: 13 }}>Rakibin sırası bekleniyor...</span>
          )}
          <div style={{ fontSize: 10, marginTop: 6, color: t.textDim }}>
            İsabet: {myHits}/20 &nbsp;•&nbsp; Karavana: {oppHits}/20
            <span style={{ marginLeft: 12, fontSize: 9 }}>Sağ tık = işaretle</span>
          </div>
        </div>

        {/* Damage report */}
        {damageReport && (
          <div style={{
            background: "rgba(239,68,68,0.1)", border: `1px solid ${t.hit}`, borderRadius: 8,
            padding: "8px 20px", marginBottom: 8, fontSize: 12, color: t.hit, fontWeight: 700,
            textAlign: "center", width: "100%", maxWidth: 1100,
          }}>⚠ {damageReport}</div>
        )}

        {/* Main layout */}
        <div style={{ display: "flex", gap: 12, justifyContent: "center", width: "100%", maxWidth: 1100, alignItems: "flex-start", flexWrap: "wrap" }}>
          <NotationLog entries={notationEntries} />
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap", justifyContent: "center", flex: 1 }}>
            <div style={{ flex: "1 1 340px", maxWidth: 430, minWidth: 280 }}>
              <div style={{ fontSize: 11, letterSpacing: 3, color: t.textDim, marginBottom: 6, textAlign: "center", fontWeight: 600 }}>🛡 SAVUNMA</div>
              <Grid board={defenseBoard} cellSize={cellSize} isDefense shipColors={shipColorMap} overlay={defenseOverlay} disabled blinkCells={blinkCells} />
              <ShipStatusPanel title="GEMİLERİM" ships={myShipsData} hitCells={defHitMap} color={t.accent} />
            </div>
            <div style={{ flex: "1 1 340px", maxWidth: 430, minWidth: 280 }}>
              <div style={{ fontSize: 11, letterSpacing: 3, color: t.textDim, marginBottom: 6, textAlign: "center", fontWeight: 600 }}>⚔ SALDIRI</div>
              <Grid board={emptyGrid()} cellSize={cellSize} overlay={getAttackDisplayOverlay()} onClick={handleAttackClick} onRightClick={handleAttackRightClick} disabled={!myTurn} manualMarks={manualMarks} />
              <ShipStatusPanel title="RAKİP GEMİLER" ships={oppShipsData} hitCells={atkHitMap} color={t.hit} />
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ═══ GAME OVER ═══
  if (phase === "gameover") {
    return (
      <div style={appStyle}>
        <style>{CSS_ANIMS}</style>
        <div style={{ fontSize: 28, fontWeight: 800, letterSpacing: 4, color: t.accent, marginBottom: 24 }}>AMİRAL BATTI</div>
        <div style={{
          fontSize: 32, fontWeight: 800, letterSpacing: 4, textAlign: "center",
          color: winner?.includes("Kazand") ? t.accent : t.hit,
          textShadow: `0 0 30px ${winner?.includes("Kazand") ? t.accentGlow : t.hitGlow}`,
          marginBottom: 16,
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
