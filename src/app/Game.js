"use client";
import { useState, useEffect, useCallback, useRef } from "react";
import { db, ref, set, get, onValue, update } from "../lib/firebase";

const ROWS = 11;
const COLS = 11;
const COL_LABELS = ["A","B","C","D","E","F","G","H","I","J","K"];
const SHOTS_PER_TURN = 3;

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
  for (let t = 0; t < times; t++) {
    s = s.map(([r, c]) => [c, -r]);
  }
  const minR = Math.min(...s.map(([r]) => r));
  const minC = Math.min(...s.map(([, c]) => c));
  return s.map(([r, c]) => [r - minR, c - minC]);
}

function getShipCells(ship, row, col, rotation) {
  const shape = rotateShape(ship.shape, rotation);
  return shape.map(([r, c]) => [row + r, col + c]);
}

function getNeighborCells(cells) {
  const cellSet = new Set(cells.map(([r, c]) => `${r},${c}`));
  const neighbors = new Set();
  cells.forEach(([r, c]) => {
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (dr === 0 && dc === 0) continue;
        const key = `${r + dr},${c + dc}`;
        if (!cellSet.has(key)) neighbors.add(key);
      }
    }
  });
  return [...neighbors].map(k => k.split(",").map(Number));
}

function isValidPlacement(cells, board) {
  return cells.every(([r, c]) =>
    r >= 0 && r < ROWS && c >= 0 && c < COLS && board[r][c] === 0
  );
}

function emptyGrid() {
  return Array.from({ length: ROWS }, () => Array(COLS).fill(0));
}

// ─── Styles ───
const t = {
  bg: "#0a0e17", surface: "#111827", surfaceLight: "#1f2937",
  border: "#374151", text: "#e5e7eb", textDim: "#6b7280",
  accent: "#06b6d4", accentGlow: "rgba(6,182,212,0.3)",
  hit: "#ef4444", hitGlow: "rgba(239,68,68,0.4)",
  miss: "#4b5563", sunk: "#f97316",
  water: "rgba(6,182,212,0.06)", shipCell: "rgba(6,182,212,0.25)",
};

function Grid({ board, cellSize, onClick, onHover, overlay, hoverCells, isDefense, shipColors, disabled }) {
  return (
    <div style={{ background: t.surface, border: `1px solid ${t.border}`, borderRadius: 8, padding: 8, overflow: "hidden" }}>
      <div style={{ display: "flex" }}>
        <div style={{ width: cellSize, height: cellSize, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, fontWeight: 700, color: t.textDim }} />
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
              else if (ovr === "passive") { bg = "rgba(75,85,99,0.2)"; content = "·"; }
              else if (ovr === "selected") { bg = "rgba(6,182,212,0.4)"; content = "◎"; shadow = `inset 0 0 10px ${t.accentGlow}`; }
            }
            if (isHov) { bg = "rgba(6,182,212,0.35)"; shadow = `inset 0 0 10px ${t.accentGlow}`; }

            return (
              <div key={c}
                onClick={() => !disabled && onClick?.(r, c)}
                onMouseEnter={() => onHover?.(r, c)}
                style={{
                  width: cellSize, height: cellSize,
                  border: `1px solid ${t.border}`,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 9, fontWeight: 700, cursor: disabled ? "default" : "pointer",
                  background: bg, boxShadow: shadow, color: clr,
                  transition: "all 0.15s ease", boxSizing: "border-box",
                }}
              >{content}</div>
            );
          })}
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
  const [turnLog, setTurnLog] = useState([]);

  const unsubRef = useRef(null);
  const playerNumRef = useRef(null);
  const roomIdRef = useRef("");

  const cellSize = typeof window !== "undefined"
    ? Math.min(28, Math.floor((Math.min(window.innerWidth - 60, 420)) / 12))
    : 28;

  // ─── Firebase listener ───
  const listenToRoom = useCallback((rid, pNum) => {
    if (unsubRef.current) unsubRef.current();
    const gameRef = ref(db, `rooms/${rid}`);
    unsubRef.current = onValue(gameRef, (snapshot) => {
      const game = snapshot.val();
      if (!game) return;

      const myKey = pNum === 1 ? "p1" : "p2";
      const oppKey = pNum === 1 ? "p2" : "p1";

      // Opponent joined?
      if (game[`${oppKey}_name`]) setOpponentName(game[`${oppKey}_name`]);

      // Phase transitions
      if (game.phase === "placing" && !placementConfirmed) setPhase("placing");
      if (game.phase === "playing") {
        setPhase("playing");
        setMyTurn(game.turn === pNum);
      }

      // Process attacks on my defense board
      if (game.attacks) {
        const attacks = Object.values(game.attacks);
        const defOvr = emptyGrid().map(r => r.map(() => null));
        let oh = 0;
        attacks.filter(a => a.target === myKey).forEach(a => {
          if (a.shots) a.shots.forEach(s => {
            defOvr[s.r][s.c] = s.result;
            if (s.result === "hit") oh++;
          });
        });
        setDefenseOverlay(defOvr);
        setOppHits(oh);

        // Process my attacks on opponent
        const atkOvr = emptyGrid().map(r => r.map(() => null));
        let mh = 0;
        attacks.filter(a => a.target === oppKey).forEach(a => {
          if (a.shots) a.shots.forEach(s => {
            atkOvr[s.r][s.c] = s.result;
            if (s.result === "hit") mh++;
          });
        });

        // Check sunk ships
        if (game[`${oppKey}_ships`]) {
          const oppShips = Object.values(game[`${oppKey}_ships`]);
          oppShips.forEach(ship => {
            const cells = ship.cells;
            const allHit = cells.every(([r, c]) => atkOvr[r][c] === "hit" || atkOvr[r][c] === "sunk");
            if (allHit) {
              cells.forEach(([r, c]) => { atkOvr[r][c] = "sunk"; });
              const nbrs = getNeighborCells(cells);
              nbrs.forEach(([r, c]) => {
                if (r >= 0 && r < ROWS && c >= 0 && c < COLS && !atkOvr[r][c]) {
                  atkOvr[r][c] = "passive";
                }
              });
            }
          });
        }

        setAttackOverlay(atkOvr);
        setMyHits(mh);
      }

      // Winner
      if (game.winner) {
        setWinner(game.winner === pNum ? "Kazandın!" : "Kaybettin!");
        setPhase("gameover");
      }
    });
  }, [placementConfirmed]);

  useEffect(() => {
    return () => { if (unsubRef.current) unsubRef.current(); };
  }, []);

  // Keyboard rotate
  useEffect(() => {
    const handler = (e) => {
      if (e.key === "r" || e.key === "R") setRotation(prev => (prev + 1) % 4);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  // ─── Create Room ───
  const createRoom = async () => {
    if (!playerName.trim()) { setMessage("Adını yaz!"); return; }
    const id = Math.random().toString(36).substring(2, 8).toUpperCase();
    roomIdRef.current = id;
    setRoomId(id);
    setPlayerNum(1);
    playerNumRef.current = 1;

    await set(ref(db, `rooms/${id}`), {
      p1_name: playerName.trim(),
      p2_name: null,
      phase: "waiting",
      p1_board: null, p2_board: null,
      p1_ships: null, p2_ships: null,
      attacks: null,
      turn: 1,
      winner: null,
      created: Date.now(),
    });

    setPhase("waiting");
    listenToRoom(id, 1);
  };

  // ─── Join Room ───
  const joinRoom = async () => {
    if (!playerName.trim() || !inputRoomId.trim()) { setMessage("Adını ve oda kodunu yaz!"); return; }
    const rid = inputRoomId.trim().toUpperCase();
    const snapshot = await get(ref(db, `rooms/${rid}`));
    if (!snapshot.exists()) { setMessage("Oda bulunamadı!"); return; }
    const game = snapshot.val();
    if (game.p2_name) { setMessage("Oda dolu!"); return; }

    roomIdRef.current = rid;
    setRoomId(rid);
    setPlayerNum(2);
    playerNumRef.current = 2;
    setOpponentName(game.p1_name);

    await update(ref(db, `rooms/${rid}`), {
      p2_name: playerName.trim(),
      phase: "placing",
    });

    setPhase("placing");
    listenToRoom(rid, 2);
  };

  // ─── Ship Placement ───
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

    setDefenseBoard(newBoard);
    setShipColorMap(newColors);
    setPlacedShips([...placedShips, { id: ship.id, cells, color: ship.color }]);
    setSelectedShip(null);
    setHoverCells([]);
    setRotation(0);
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
    setDefenseBoard(newBoard);
    setShipColorMap(newColors);
    setPlacedShips(placedShips.slice(0, -1));
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

    // Check if opponent also placed
    const snapshot = await get(ref(db, `rooms/${roomIdRef.current}`));
    const game = snapshot.val();
    if (game[`${oppKey}_board`]) {
      await update(ref(db, `rooms/${roomIdRef.current}`), { phase: "playing" });
    }

    setPlacementConfirmed(true);
    setMessage("Gemiler yerleştirildi! Rakip bekleniyor...");
  };

  // ─── Attack ───
  const handleAttackClick = (r, c) => {
    if (!myTurn || phase !== "playing") return;
    if (attackOverlay[r][c]) return;
    const existing = currentShots.findIndex(([sr, sc]) => sr === r && sc === c);
    if (existing !== -1) { setCurrentShots(currentShots.filter((_, i) => i !== existing)); return; }
    if (currentShots.length >= SHOTS_PER_TURN) return;
    setCurrentShots([...currentShots, [r, c]]);
  };

  const fireShots = async () => {
    if (currentShots.length === 0) return;
    const pNum = playerNumRef.current;
    const snapshot = await get(ref(db, `rooms/${roomIdRef.current}`));
    const game = snapshot.val();
    if (!game || game.turn !== pNum) { setMessage("Senin sıran değil!"); return; }

    const targetKey = pNum === 1 ? "p2" : "p1";
    const targetBoard = game[`${targetKey}_board`];

    const shotResults = currentShots.map(([r, c]) => ({
      r, c, result: targetBoard[r][c] > 0 ? "hit" : "miss"
    }));

    // Count total hits
    const existingAttacks = game.attacks ? Object.values(game.attacks) : [];
    const prevHits = existingAttacks
      .filter(a => a.target === targetKey)
      .reduce((sum, a) => sum + (a.shots ? a.shots.filter(s => s.result === "hit").length : 0), 0);
    const newHits = shotResults.filter(s => s.result === "hit").length;
    const totalHits = prevHits + newHits;

    const attackIndex = existingAttacks.length;
    const updates = {};
    updates[`attacks/${attackIndex}`] = { by: pNum, target: targetKey, shots: shotResults, time: Date.now() };

    if (totalHits >= 20) {
      updates.winner = pNum;
    } else {
      updates.turn = pNum === 1 ? 2 : 1;
    }

    await update(ref(db, `rooms/${roomIdRef.current}`), updates);

    const log = shotResults.map(s => `${s.r + 1}${COL_LABELS[s.c]}: ${s.result === "hit" ? "İSABET!" : "Iska"}`);
    setTurnLog(log);
    setCurrentShots([]);
  };

  const getAttackDisplayOverlay = () => {
    const ovr = attackOverlay.map(row => [...row]);
    currentShots.forEach(([r, c]) => { if (!ovr[r][c]) ovr[r][c] = "selected"; });
    return ovr;
  };

  const resetGame = () => {
    if (unsubRef.current) unsubRef.current();
    setPhase("lobby"); setRoomId(""); setInputRoomId(""); setPlayerNum(null);
    setDefenseBoard(emptyGrid()); setShipColorMap(Array.from({ length: ROWS }, () => Array(COLS).fill(null)));
    setAttackOverlay(emptyGrid().map(r => r.map(() => null)));
    setDefenseOverlay(emptyGrid().map(r => r.map(() => null)));
    setPlacedShips([]); setCurrentShots([]); setMyHits(0); setOppHits(0);
    setWinner(null); setMessage(""); setOpponentName(""); setPlacementConfirmed(false); setTurnLog([]);
  };

  // ─── Common styles ───
  const boxStyle = { background: t.surface, border: `1px solid ${t.border}`, borderRadius: 12, padding: 32, textAlign: "center", maxWidth: 420, width: "100%" };
  const btnStyle = { padding: "10px 24px", background: t.accent, color: t.bg, border: "none", borderRadius: 6, fontSize: 12, fontWeight: 700, letterSpacing: 2, textTransform: "uppercase", cursor: "pointer", fontFamily: "inherit" };
  const btnSecStyle = { padding: "8px 16px", background: "transparent", color: t.accent, border: `1px solid ${t.accent}`, borderRadius: 6, fontSize: 11, fontWeight: 600, letterSpacing: 1, textTransform: "uppercase", cursor: "pointer", fontFamily: "inherit" };
  const inputStyle = { padding: "10px 16px", background: t.surface, color: t.text, border: `1px solid ${t.border}`, borderRadius: 6, fontSize: 14, fontFamily: "inherit", outline: "none", textAlign: "center", width: 220 };

  const appStyle = { minHeight: "100vh", background: t.bg, color: t.text, fontFamily: "'JetBrains Mono', monospace", display: "flex", flexDirection: "column", alignItems: "center", padding: 16 };

  // ═══ LOBBY ═══
  if (phase === "lobby") {
    return (
      <div style={appStyle}>
        <div style={{ fontSize: 28, fontWeight: 800, letterSpacing: 4, color: t.accent, textShadow: `0 0 30px ${t.accentGlow}`, marginBottom: 4 }}>AMİRAL BATTI</div>
        <div style={{ fontSize: 11, color: t.textDim, letterSpacing: 6, textTransform: "uppercase", marginBottom: 24 }}>Online Deniz Savaşı</div>
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
        <div style={{ fontSize: 28, fontWeight: 800, letterSpacing: 4, color: t.accent, textShadow: `0 0 30px ${t.accentGlow}`, marginBottom: 4 }}>AMİRAL BATTI</div>
        <div style={{ fontSize: 11, color: t.textDim, letterSpacing: 6, marginBottom: 24 }}>RAKİP BEKLENİYOR</div>
        <div style={boxStyle}>
          <div style={{ fontSize: 14, marginBottom: 12 }}>Oda Kodu:</div>
          <div style={{ fontSize: 36, fontWeight: 800, color: t.accent, letterSpacing: 8, textShadow: `0 0 20px ${t.accentGlow}`, marginBottom: 16 }}>{roomId}</div>
          <div style={{ fontSize: 12, color: t.textDim, marginBottom: 8 }}>Bu kodu rakibine gönder!</div>
          <div style={{ fontSize: 11, color: t.textDim, marginTop: 8 }}>
            Link: <span style={{ color: t.accent, wordBreak: "break-all" }}>{typeof window !== "undefined" ? window.location.origin : ""}/?room={roomId}</span>
          </div>
          <div style={{ marginTop: 24 }}>
            <div style={{ width: 12, height: 12, borderRadius: "50%", background: t.accent, margin: "0 auto", animation: "pulse 1.5s ease-in-out infinite" }} />
          </div>
          <style>{`@keyframes pulse { 0%, 100% { opacity: 1; transform: scale(1); } 50% { opacity: 0.4; transform: scale(0.8); } }`}</style>
        </div>
      </div>
    );
  }

  // ═══ PLACING ═══
  if (phase === "placing") {
    const allPlaced = placedShips.length === SHIPS.length;
    return (
      <div style={appStyle}>
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
                    }}>
                    {ship.name} ({ship.size})
                  </button>
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
            Gemilerin hazır! Rakibin gemilerini yerleştirmesi bekleniyor...
            <div style={{ marginTop: 8 }}>
              <div style={{ width: 12, height: 12, borderRadius: "50%", background: t.accent, margin: "0 auto", animation: "pulse 1.5s ease-in-out infinite" }} />
            </div>
          </div>
        )}

        <div onMouseLeave={() => setHoverCells([])}>
          <Grid board={defenseBoard} cellSize={cellSize} isDefense shipColors={shipColorMap}
            overlay={defenseOverlay} hoverCells={hoverCells}
            onClick={handleDefenseClick} onHover={handleDefenseHover}
            disabled={placementConfirmed} />
        </div>
      </div>
    );
  }

  // ═══ PLAYING ═══
  if (phase === "playing") {
    return (
      <div style={appStyle}>
        <div style={{ fontSize: 22, fontWeight: 800, letterSpacing: 3, color: t.accent, marginBottom: 4 }}>AMİRAL BATTI</div>
        <div style={{ fontSize: 11, color: t.textDim, letterSpacing: 3, marginBottom: 12 }}>vs {opponentName}</div>

        <div style={{ background: t.surface, border: `1px solid ${t.border}`, borderRadius: 8, padding: "12px 20px", marginBottom: 16, textAlign: "center", width: "100%", maxWidth: 900 }}>
          {myTurn ? (
            <div>
              <span style={{ color: t.accent, fontWeight: 700, fontSize: 14 }}>SENİN SIRAN</span>
              <span style={{ margin: "0 12px", color: t.textDim }}>|</span>
              <span style={{ fontSize: 12 }}>
                Atış: {currentShots.length}/{SHOTS_PER_TURN}
                <span style={{ display: "inline-flex", gap: 4, marginLeft: 8, verticalAlign: "middle" }}>
                  {[0,1,2].map(i => (
                    <span key={i} style={{
                      width: 10, height: 10, borderRadius: "50%", display: "inline-block",
                      background: i < currentShots.length ? t.hit : t.accent,
                      opacity: i < currentShots.length ? 0.3 : 1,
                      boxShadow: i < currentShots.length ? "none" : `0 0 8px ${t.accentGlow}`,
                    }} />
                  ))}
                </span>
              </span>
              {currentShots.length > 0 && (
                <button style={{ ...btnStyle, marginLeft: 16, padding: "6px 16px", fontSize: 11 }} onClick={fireShots}>
                  ATEŞ!
                </button>
              )}
            </div>
          ) : (
            <span style={{ color: t.textDim, fontSize: 13 }}>Rakibin sırası bekleniyor...</span>
          )}
          <div style={{ fontSize: 10, marginTop: 8, color: t.textDim }}>
            Vuruşlarım: {myHits}/20 &nbsp;•&nbsp; Rakip vuruşları: {oppHits}/20
          </div>
        </div>

        {turnLog.length > 0 && (
          <div style={{ background: t.surface, border: `1px solid ${t.border}`, borderRadius: 6, padding: "8px 16px", marginBottom: 12, fontSize: 11, maxWidth: 900, width: "100%" }}>
            {turnLog.map((log, i) => (
              <span key={i} style={{ marginRight: 12, color: log.includes("İSABET") ? t.hit : t.textDim }}>{log}</span>
            ))}
          </div>
        )}

        <div style={{ display: "flex", gap: 20, flexWrap: "wrap", justifyContent: "center", width: "100%", maxWidth: 900 }}>
          <div style={{ flex: "1 1 380px", maxWidth: 430, minWidth: 300 }}>
            <div style={{ fontSize: 11, letterSpacing: 3, color: t.textDim, marginBottom: 8, textAlign: "center", fontWeight: 600 }}>🛡 SAVUNMA</div>
            <Grid board={defenseBoard} cellSize={cellSize} isDefense shipColors={shipColorMap} overlay={defenseOverlay} disabled />
          </div>
          <div style={{ flex: "1 1 380px", maxWidth: 430, minWidth: 300 }}>
            <div style={{ fontSize: 11, letterSpacing: 3, color: t.textDim, marginBottom: 8, textAlign: "center", fontWeight: 600 }}>⚔ SALDIRI</div>
            <Grid board={emptyGrid()} cellSize={cellSize} overlay={getAttackDisplayOverlay()} onClick={handleAttackClick} disabled={!myTurn} />
          </div>
        </div>
      </div>
    );
  }

  // ═══ GAME OVER ═══
  if (phase === "gameover") {
    return (
      <div style={appStyle}>
        <div style={{ fontSize: 28, fontWeight: 800, letterSpacing: 4, color: t.accent, marginBottom: 24 }}>AMİRAL BATTI</div>
        <div style={{
          fontSize: 36, fontWeight: 800, letterSpacing: 4,
          color: winner === "Kazandın!" ? t.accent : t.hit,
          textShadow: `0 0 30px ${winner === "Kazandın!" ? t.accentGlow : t.hitGlow}`,
          marginBottom: 16,
        }}>{winner}</div>
        <div style={{ color: t.textDim, fontSize: 12, marginBottom: 24 }}>
          Vuruşlarım: {myHits}/20 • Rakip: {oppHits}/20
        </div>
        <button style={btnStyle} onClick={resetGame}>Yeni Oyun</button>
      </div>
    );
  }

  return null;
}
