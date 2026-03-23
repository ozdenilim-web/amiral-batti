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
  gold: "#fbbf24", goldGlow: "rgba(251,191,36,0.3)",
};

const ANIMS = `
@import url('https://fonts.googleapis.com/css2?family=Oswald:wght@400;600;700&family=JetBrains+Mono:wght@400;600;700;800&display=swap');
@keyframes blink3s{0%,100%{opacity:1}50%{opacity:.15}}
@keyframes pulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.4;transform:scale(.8)}}
@keyframes borderGlow{0%,100%{border-color:#06b6d4;box-shadow:0 0 8px rgba(6,182,212,.4)}50%{border-color:#22d3ee;box-shadow:0 0 24px rgba(6,182,212,.8)}}
@keyframes popIn{0%{transform:scale(0)}60%{transform:scale(1.15)}100%{transform:scale(1)}}
@keyframes fadeUp{0%{opacity:0;transform:translateY(10px)}100%{opacity:1;transform:translateY(0)}}
@keyframes slideIn{0%{opacity:0;transform:translateY(-20px)}100%{opacity:1;transform:translateY(0)}}
@keyframes loadDots{0%,80%,100%{opacity:.3}40%{opacity:1}}
@keyframes victoryGlow{0%{text-shadow:0 0 20px rgba(6,182,212,.5)}50%{text-shadow:0 0 60px rgba(6,182,212,1),0 0 100px rgba(6,182,212,.5)}100%{text-shadow:0 0 20px rgba(6,182,212,.5)}}
@keyframes defeatShake{0%,100%{transform:translateX(0)}10%,30%,50%,70%,90%{transform:translateX(-4px)}20%,40%,60%,80%{transform:translateX(4px)}}
@keyframes scaleUp{0%{transform:scale(0.3);opacity:0}100%{transform:scale(1);opacity:1}}
@keyframes shimmer{0%{background-position:-200% 0}100%{background-position:200% 0}}
@keyframes cellHover{0%{box-shadow:inset 0 0 0 rgba(6,182,212,0)}100%{box-shadow:inset 0 0 14px rgba(6,182,212,.5)}}
`;

const warrior = "'Oswald', sans-serif";
const mono = "'JetBrains Mono', monospace";

function Grid({ board, cellSize, onClick, onHover, onRightClick, onLongPress, overlay, hoverCells, isDefense, shipColors, disabled, blinkCells, manualMarks }) {
  const longPressRef = useRef(null);
  const [rippleCell, setRippleCell] = useState(null);

  const handleClick = (r, c) => {
    if (disabled) return;
    setRippleCell(`${r},${c}`);
    setTimeout(() => setRippleCell(null), 400);
    onClick?.(r, c);
  };

  const handleTouchStart = (r, c) => {
    longPressRef.current = setTimeout(() => {
      onLongPress?.(r, c);
      longPressRef.current = null;
    }, 500);
  };

  const handleTouchEnd = () => {
    if (longPressRef.current) {
      clearTimeout(longPressRef.current);
      longPressRef.current = null;
    }
  };

  return (
    <div style={{
      background: `linear-gradient(135deg, ${t.surface} 0%, rgba(17,24,39,0.95) 100%)`,
      border: `1px solid rgba(55,65,81,0.6)`, borderRadius: 10, padding: 4, overflow: "hidden",
      boxShadow: "0 4px 20px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.03)",
    }}>
      <div style={{ display: "flex" }}>
        <div style={{ width: cellSize, height: cellSize }} />
        {COL_LABELS.map((l, i) => (
          <div key={i} style={{ width: cellSize, height: cellSize, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 8, fontWeight: 700, color: t.textDim, fontFamily: mono }}>{l}</div>
        ))}
      </div>
      {board.map((row, r) => (
        <div key={r} style={{ display: "flex" }}>
          <div style={{ width: cellSize, height: cellSize, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 8, fontWeight: 700, color: t.textDim, fontFamily: mono }}>{r + 1}</div>
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
              else if (ovr === "selected") { bg = "rgba(6,182,212,0.45)"; content = "◎"; shadow = `inset 0 0 12px ${t.accentGlow}`; clr = t.accent; }
              if (!ovr && isManual) { bg = "rgba(251,191,36,0.15)"; content = "⚑"; clr = t.gold; }
            }
            if (isHov) { bg = "rgba(6,182,212,0.35)"; shadow = `inset 0 0 10px ${t.accentGlow}`; }

            return (
              <div key={c}
                onClick={() => handleClick(r, c)}
                onMouseEnter={() => onHover?.(r, c)}
                onContextMenu={(e) => { e.preventDefault(); onRightClick?.(r, c); }}
                onTouchStart={() => handleTouchStart(r, c)}
                onTouchEnd={handleTouchEnd}
                onTouchCancel={handleTouchEnd}
                style={{
                  width: cellSize, height: cellSize,
                  border: `1px solid rgba(55,65,81,0.5)`,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 8, fontWeight: 700, cursor: disabled ? "default" : "pointer",
                  background: bg, boxShadow: shadow, color: clr,
                  transition: "all 0.15s ease", boxSizing: "border-box",
                  animation: isBlink ? "blink3s 0.5s ease-in-out 6" : isRipple ? "popIn 0.3s ease-out" : "none",
                  borderRadius: 1,
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
      <div style={{ fontSize: 10, letterSpacing: 3, color: t.textDim, marginBottom: 4, fontWeight: 700, fontFamily: warrior, textTransform: "uppercase" }}>{title}</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
        {shipList.map((ship, idx) => {
          const shipDef = SHIPS.find(s => s.id === ship.id);
          const cells = ship.cells || [];
          const hits = cells.filter(([r, c]) => hitCells?.[r]?.[c]).length;
          const sunk = hits === cells.length && cells.length > 0;
          return (
            <div key={idx} style={{ display: "flex", alignItems: "center", gap: 3 }}>
              <span style={{ fontSize: 9, color: sunk ? t.sunk : t.text, textDecoration: sunk ? "line-through" : "none", fontFamily: mono }}>
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
      padding: "8px 10px", maxHeight: 100, overflowY: "auto", marginTop: 6,
    }}>
      <div style={{ fontSize: 9, letterSpacing: 2, color: t.textDim, marginBottom: 4, fontWeight: 700, fontFamily: warrior }}>NOTASYON</div>
      {entries.length === 0 && <div style={{ fontSize: 9, color: t.textDim, fontFamily: mono }}>Henüz atış yok</div>}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
        {entries.map((entry, i) => (
          <div key={i} style={{ fontSize: 9, color: entry.isMine ? t.accent : t.hit, fontFamily: mono }}>
            <span style={{ fontWeight: 700 }}>{entry.name?.charAt(0)}#{entry.turnNum}</span> {entry.coords.join(",")}
          </div>
        ))}
      </div>
    </div>
  );
}

// ═══ LOADING ═══
function LoadingScreen({ onReady }) {
  const [step, setStep] = useState(0);
  const msgs = [
    "Gemiler denize indiriliyor...",
    "Toplar hazırlanıyor...",
    "Radarlar aktif ediliyor...",
    "Düşman hattı taranıyor...",
    "Savaş pozisyonu alınıyor..."
  ];
  useEffect(() => {
    const timers = msgs.map((_, i) => setTimeout(() => setStep(i), 1000 + i * 1000));
    const final = setTimeout(() => onReady(), 6000);
    return () => { timers.forEach(clearTimeout); clearTimeout(final); };
  }, [onReady]);
  return (
    <div style={{
      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
      minHeight: "100vh", minHeight: "100dvh", background: t.bg, padding: 20,
    }}>
      <div style={{
        fontSize: 38, fontWeight: 700, letterSpacing: 6, color: t.accent,
        textShadow: `0 0 40px ${t.accentGlow}, 0 0 80px rgba(6,182,212,0.2)`,
        marginBottom: 40, fontFamily: warrior, textTransform: "uppercase",
        animation: "fadeUp 0.8s ease-out",
      }}>
        AMİRAL BATTI
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 14, width: "100%", maxWidth: 300 }}>
        {msgs.map((msg, i) => (
          <div key={i} style={{
            fontSize: 12, color: i <= step ? t.text : "transparent",
            transition: "all 0.5s ease",
            animation: i <= step ? "fadeUp 0.5s ease-out" : "none",
            fontFamily: mono, letterSpacing: 0.5,
          }}>
            <span style={{ color: t.accent, marginRight: 10, fontWeight: 800 }}>{i <= step ? "▸" : "○"}</span>{msg}
          </div>
        ))}
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 40 }}>
        {[0,1,2,3].map(i => (
          <div key={i} style={{
            width: 6, height: 6, borderRadius: "50%", background: t.accent,
            animation: `loadDots 1.4s ease-in-out infinite`,
            animationDelay: `${i * 0.15}s`,
          }} />
        ))}
      </div>
    </div>
  );
}

// ═══ READY ═══
function ReadyScreen({ onStart, opponentName }) {
  return (
    <div style={{
      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
      minHeight: "100vh", minHeight: "100dvh", background: t.bg, padding: 20,
    }}>
      <div style={{
        fontSize: 14, letterSpacing: 6, color: t.textDim, marginBottom: 8,
        fontFamily: warrior, textTransform: "uppercase", animation: "fadeUp 0.4s ease-out",
      }}>RAKIP</div>
      <div style={{
        fontSize: 28, fontWeight: 700, color: t.hit, marginBottom: 24,
        fontFamily: warrior, letterSpacing: 4, textTransform: "uppercase",
        textShadow: `0 0 20px ${t.hitGlow}`, animation: "fadeUp 0.6s ease-out",
      }}>{opponentName}</div>
      <div style={{
        fontSize: 20, color: t.text, marginBottom: 36, fontFamily: warrior,
        letterSpacing: 2, animation: "fadeUp 0.8s ease-out", textAlign: "center",
      }}>
        Gemileri batırmaya<br/>hazır mısın?
      </div>
      <button onClick={onStart} style={{
        padding: "16px 48px", background: `linear-gradient(135deg, ${t.accent}, #0891b2)`,
        color: t.bg, border: "none", borderRadius: 10, fontSize: 18, fontWeight: 700,
        letterSpacing: 4, textTransform: "uppercase", cursor: "pointer", fontFamily: warrior,
        animation: "scaleUp 0.5s ease-out",
        boxShadow: `0 0 30px ${t.accentGlow}, 0 4px 15px rgba(0,0,0,0.3)`,
      }}>
        SAVAŞA HAZIR
      </button>
    </div>
  );
}

// ═══ GAME OVER ═══
function GameOverScreen({ winner, myHits, oppHits, onNewGame, onViewBoard, isWin }) {
  return (
    <div style={{
      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
      minHeight: "100vh", minHeight: "100dvh",
      background: isWin
        ? `radial-gradient(ellipse at center, rgba(6,182,212,0.08) 0%, ${t.bg} 70%)`
        : `radial-gradient(ellipse at center, rgba(239,68,68,0.06) 0%, ${t.bg} 70%)`,
      padding: 20,
    }}>
      <div style={{
        fontSize: 14, letterSpacing: 8, color: t.textDim, marginBottom: 16,
        fontFamily: warrior, textTransform: "uppercase", animation: "fadeUp 0.3s ease-out",
      }}>SAVAŞ BİTTİ</div>

      <div style={{
        fontSize: 42, fontWeight: 700, letterSpacing: 4, textAlign: "center",
        color: isWin ? t.accent : t.hit, fontFamily: warrior, textTransform: "uppercase",
        animation: isWin ? "victoryGlow 2s ease-in-out infinite, scaleUp 0.6s ease-out" : "defeatShake 0.6s ease-out, fadeUp 0.6s ease-out",
        textShadow: isWin
          ? `0 0 40px ${t.accentGlow}, 0 0 80px rgba(6,182,212,0.3)`
          : `0 0 30px ${t.hitGlow}`,
        marginBottom: 8,
      }}>
        {isWin ? "ZAFER" : "BOZGUN"}
      </div>

      <div style={{
        fontSize: 16, color: isWin ? t.accent : t.hit, fontFamily: warrior,
        letterSpacing: 3, marginBottom: 24, animation: "fadeUp 0.8s ease-out",
        opacity: 0.8,
      }}>
        {winner}
      </div>

      <div style={{
        display: "flex", gap: 24, marginBottom: 32, animation: "fadeUp 1s ease-out",
      }}>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 28, fontWeight: 800, color: t.accent, fontFamily: mono }}>{myHits}</div>
          <div style={{ fontSize: 10, color: t.textDim, letterSpacing: 2, fontFamily: warrior }}>İSABET</div>
        </div>
        <div style={{ width: 1, background: t.border }} />
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 28, fontWeight: 800, color: t.hit, fontFamily: mono }}>{oppHits}</div>
          <div style={{ fontSize: 10, color: t.textDim, letterSpacing: 2, fontFamily: warrior }}>KARAVANA</div>
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 12, width: "100%", maxWidth: 280, animation: "fadeUp 1.2s ease-out" }}>
        <button onClick={onViewBoard} style={{
          padding: "12px 24px", background: "transparent",
          color: t.accent, border: `1px solid ${t.accent}`, borderRadius: 8,
          fontSize: 12, fontWeight: 700, letterSpacing: 2, cursor: "pointer",
          fontFamily: warrior, textTransform: "uppercase",
        }}>
          SAVAŞ HARİTASINI GÖR
        </button>
        <button onClick={onNewGame} style={{
          padding: "14px 24px", background: `linear-gradient(135deg, ${t.accent}, #0891b2)`,
          color: t.bg, border: "none", borderRadius: 8,
          fontSize: 14, fontWeight: 700, letterSpacing: 3, cursor: "pointer",
          fontFamily: warrior, textTransform: "uppercase",
          boxShadow: `0 0 20px ${t.accentGlow}`,
        }}>
          YENİ SAVAŞ
        </button>
      </div>
    </div>
  );
}

// ═══ BOARD REVIEW ═══
function BoardReview({ defenseBoard, shipColorMap, defenseOverlay, attackOverlay, oppShipsData, myShipsData, defHitMap, atkHitMap, cellSize, onBack }) {
  const [view, setView] = useState("attack");
  // Build opponent board with revealed ships
  const oppBoard = emptyGrid();
  const oppColors = Array.from({ length: ROWS }, () => Array(COLS).fill(null));
  if (oppShipsData) {
    Object.values(oppShipsData).forEach(ship => {
      const shipDef = SHIPS.find(s => s.id === ship.id);
      ship.cells?.forEach(([r, c]) => {
        oppBoard[r][c] = 1;
        oppColors[r][c] = shipDef?.color || t.shipCell;
      });
    });
  }
  return (
    <div style={{
      display: "flex", flexDirection: "column", alignItems: "center",
      minHeight: "100vh", minHeight: "100dvh", background: t.bg, padding: "12px 8px",
      fontFamily: mono, color: t.text,
    }}>
      <style>{ANIMS}</style>
      <div style={{ fontSize: 18, fontWeight: 700, color: t.accent, marginBottom: 8, fontFamily: warrior, letterSpacing: 3 }}>SAVAŞ HARİTASI</div>
      <div style={{ display: "flex", gap: 0, marginBottom: 8, width: "100%", maxWidth: 400 }}>
        <button onClick={() => setView("attack")} style={{
          flex: 1, padding: "8px 0", fontSize: 12, fontWeight: 700, fontFamily: warrior, cursor: "pointer",
          background: view === "attack" ? t.accent : t.surfaceLight, color: view === "attack" ? t.bg : t.textDim,
          border: `1px solid ${view === "attack" ? t.accent : t.border}`, borderRadius: "8px 0 0 8px",
          letterSpacing: 2,
        }}>RAKİP SAHA</button>
        <button onClick={() => setView("defense")} style={{
          flex: 1, padding: "8px 0", fontSize: 12, fontWeight: 700, fontFamily: warrior, cursor: "pointer",
          background: view === "defense" ? t.accent : t.surfaceLight, color: view === "defense" ? t.bg : t.textDim,
          border: `1px solid ${view === "defense" ? t.accent : t.border}`, borderRadius: "0 8px 8px 0",
          letterSpacing: 2,
        }}>BENİM SAHAM</button>
      </div>
      <div style={{ width: "100%", maxWidth: 400 }}>
        {view === "attack" ? (
          <>
            <Grid board={oppBoard} cellSize={cellSize} isDefense shipColors={oppColors} overlay={attackOverlay} disabled />
            <ShipStatusPanel title="RAKİP GEMİLER" ships={oppShipsData} hitCells={atkHitMap} color={t.hit} />
          </>
        ) : (
          <>
            <Grid board={defenseBoard} cellSize={cellSize} isDefense shipColors={shipColorMap} overlay={defenseOverlay} disabled />
            <ShipStatusPanel title="GEMİLERİM" ships={myShipsData} hitCells={defHitMap} color={t.accent} />
          </>
        )}
      </div>
      <button onClick={onBack} style={{
        marginTop: 16, padding: "12px 32px", background: t.accent, color: t.bg, border: "none",
        borderRadius: 8, fontSize: 13, fontWeight: 700, letterSpacing: 2, cursor: "pointer",
        fontFamily: warrior,
      }}>GERİ DÖN</button>
    </div>
  );
}

// ═══ MAIN ═══
export default function Game() {
  const [phase, setPhase] = useState("splash");
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
  const [activeBoard, setActiveBoard] = useState("attack");
  const [markMode, setMarkMode] = useState(false);
  const [showReview, setShowReview] = useState(false);
  const [isWin, setIsWin] = useState(false);

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
            // Cancel game - reload
            if (typeof window !== "undefined") window.location.reload();
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
            update(ref(db, `rooms/${roomIdRef.current}`), { winner: playerNumRef.current === 1 ? 2 : 1, winReason: "timeout" });
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
        if (phaseRef.current === "placing") setPhase("ready");
        else if (phaseRef.current !== "ready") setPhase("playing");
        setMyTurn(game.turn === pNum);
        if (game.clocks) {
          myClockRef.current = game.clocks[myKey] ?? CLOCK_SECONDS;
          oppClockRef.current = game.clocks[oppKey] ?? CLOCK_SECONDS;
          setMyClock(myClockRef.current); setOppClock(oppClockRef.current);
        }
      }
      if (game.attacks) {
        const attacks = Object.values(game.attacks);
        const defOvr = emptyGrid().map(r => r.map(() => null));
        const dHitMap = emptyGrid().map(r => r.map(() => false));
        let oh = 0;
        attacks.filter(a => a.target === myKey).forEach(a => {
          if (a.shots) a.shots.forEach(s => { defOvr[s.r][s.c] = s.result; if (s.result === "hit") { oh++; dHitMap[s.r][s.c] = true; } });
        });
        setDefenseOverlay(defOvr); setOppHits(oh); setDefHitMap(dHitMap);
        const atkOvr = emptyGrid().map(r => r.map(() => null));
        const aHitMap = emptyGrid().map(r => r.map(() => false));
        let mh = 0;
        attacks.filter(a => a.target === oppKey).forEach(a => {
          if (a.shots) a.shots.forEach(s => { atkOvr[s.r][s.c] = s.result; if (s.result === "hit") { mh++; aHitMap[s.r][s.c] = true; } });
        });
        if (game[`${oppKey}_ships`]) {
          Object.values(game[`${oppKey}_ships`]).forEach(ship => {
            const cells = ship.cells;
            if (cells.every(([r, c]) => atkOvr[r][c] === "hit" || atkOvr[r][c] === "sunk"))
              cells.forEach(([r, c]) => { atkOvr[r][c] = "sunk"; });
          });
        }
        setAttackOverlay(atkOvr); setMyHits(mh); setAtkHitMap(aHitMap);
        const entries = [];
        let p1T = 0, p2T = 0;
        attacks.forEach(a => {
          const isP1 = a.by === 1; if (isP1) p1T++; else p2T++;
          entries.push({ name: isP1 ? (game.p1_name || "P1") : (game.p2_name || "P2"), turnNum: isP1 ? p1T : p2T, coords: a.shots ? a.shots.map(s => coordStr(s.r, s.c)) : [], isMine: a.by === pNum });
        });
        setNotationEntries(entries);
        if (attacks.length > lastAttackCountRef.current) {
          const lastAtk = attacks[attacks.length - 1];
          lastAttackCountRef.current = attacks.length;
          if (lastAtk.target === myKey && lastAtk.shots) {
            setBlinkCells(lastAtk.shots.map(s => [s.r, s.c]));
            if (blinkTimerRef.current) clearTimeout(blinkTimerRef.current);
            blinkTimerRef.current = setTimeout(() => setBlinkCells([]), 3000);
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
                    reports.push(totalH === hitShip.cells.length ? `${shipDef?.name} battı!` : `${shipDef?.name} ${totalH} yara aldı`);
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
        const iW = game.winner === pNum;
        let winMsg;
        if (iW) winMsg = reason === "timeout" ? "Süre bitti — Rakip elendi!" : "Tüm gemileri batırdın!";
        else winMsg = reason === "timeout" ? "Süren doldu!" : "Gemilerin battı!";
        setWinner(winMsg); setIsWin(iW); setPhase("gameover");
        if (clockIntervalRef.current) clearInterval(clockIntervalRef.current);
      }
    });
  }, [placementConfirmed]);

  useEffect(() => () => {
    if (unsubRef.current) unsubRef.current();
    if (clockIntervalRef.current) clearInterval(clockIntervalRef.current);
    if (blinkTimerRef.current) clearTimeout(blinkTimerRef.current);
    if (damageTimerRef.current) clearTimeout(damageTimerRef.current);
    if (placementTimerRef.current) clearInterval(placementTimerRef.current);
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
    const ship = SHIPS.find(s => s.id === selectedShip); if (!ship) return;
    const cells = getShipCells(ship, r, c, rotation);
    const boardCopy = defenseBoard.map(row => [...row]);
    if (!isValidPlacement(cells, boardCopy)) return;
    if (getNeighborCells(cells).some(([nr, nc]) => nr >= 0 && nr < ROWS && nc >= 0 && nc < COLS && boardCopy[nr][nc] > 0)) return;
    const newBoard = boardCopy.map(row => [...row]);
    const newColors = shipColorMap.map(row => [...row]);
    cells.forEach(([cr, cc]) => { newBoard[cr][cc] = 1; newColors[cr][cc] = ship.color; });
    setDefenseBoard(newBoard); setShipColorMap(newColors);
    setPlacedShips([...placedShips, { id: ship.id, cells, color: ship.color }]);
    setSelectedShip(null); setHoverCells([]); setRotation(0);
  };
  const handleDefenseHover = (r, c) => {
    if (phase !== "placing" || !selectedShip || placementConfirmed) { setHoverCells([]); return; }
    const ship = SHIPS.find(s => s.id === selectedShip); if (!ship) return;
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
    const pNum = playerNumRef.current; const myKey = pNum === 1 ? "p1" : "p2"; const oppKey = pNum === 1 ? "p2" : "p1";
    const shipData = {}; placedShips.forEach((s, i) => { shipData[i] = { id: s.id, cells: s.cells }; });
    await update(ref(db, `rooms/${roomIdRef.current}`), { [`${myKey}_board`]: defenseBoard, [`${myKey}_ships`]: shipData });
    const snapshot = await get(ref(db, `rooms/${roomIdRef.current}`));
    if (snapshot.val()?.[`${oppKey}_board`]) await update(ref(db, `rooms/${roomIdRef.current}`), { phase: "playing" });
    setPlacementConfirmed(true);
  };
  const handleAttackClick = (r, c) => {
    if (!myTurn || phase !== "playing") return;
    if (markMode) { handleAttackMark(r, c); return; }
    if (attackOverlay[r][c]) return;
    if (manualMarks[r][c]) return;
    const existing = currentShots.findIndex(([sr, sc]) => sr === r && sc === c);
    if (existing !== -1) { setCurrentShots(currentShots.filter((_, i) => i !== existing)); return; }
    if (currentShots.length >= SHOTS_PER_TURN) return;
    setCurrentShots([...currentShots, [r, c]]);
  };
  const handleAttackRightClick = (r, c) => { handleAttackMark(r, c); };
  const handleAttackMark = (r, c) => {
    if (phase !== "playing") return;
    if (attackOverlay[r][c]) return;
    const newMarks = manualMarks.map(row => [...row]);
    newMarks[r][c] = !newMarks[r][c];
    setManualMarks(newMarks);
  };
  const handleAttackLongPress = (r, c) => { handleAttackMark(r, c); };
  const fireShots = async () => {
    if (currentShots.length === 0) return;
    const pNum = playerNumRef.current; const myKey = pNum === 1 ? "p1" : "p2";
    const snapshot = await get(ref(db, `rooms/${roomIdRef.current}`));
    const game = snapshot.val(); if (!game || game.turn !== pNum) return;
    const targetKey = pNum === 1 ? "p2" : "p1";
    const shotResults = currentShots.map(([r, c]) => ({ r, c, result: game[`${targetKey}_board`][r][c] > 0 ? "hit" : "miss" }));
    const existingAttacks = game.attacks ? Object.values(game.attacks) : [];
    const prevHits = existingAttacks.filter(a => a.target === targetKey).reduce((sum, a) => sum + (a.shots ? a.shots.filter(s => s.result === "hit").length : 0), 0);
    const totalHits = prevHits + shotResults.filter(s => s.result === "hit").length;
    const updates = {};
    updates[`attacks/${existingAttacks.length}`] = { by: pNum, target: targetKey, shots: shotResults, time: Date.now() };
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
    setMyShipsData(null); setOppShipsData(null); setActiveBoard("attack"); setMarkMode(false);
    setDefHitMap(emptyGrid().map(r => r.map(() => false))); setAtkHitMap(emptyGrid().map(r => r.map(() => false)));
    lastAttackCountRef.current = 0; setPlacementTimer(PLACEMENT_SECONDS); setShowReview(false); setIsWin(false);
  };

  const appStyle = { minHeight: "100vh", minHeight: "100dvh", background: t.bg, color: t.text, fontFamily: mono, display: "flex", flexDirection: "column", alignItems: "center", padding: "12px 8px", boxSizing: "border-box" };
  const btnStyle = { padding: "12px 28px", background: `linear-gradient(135deg, ${t.accent}, #0891b2)`, color: t.bg, border: "none", borderRadius: 8, fontSize: 13, fontWeight: 700, letterSpacing: 2, textTransform: "uppercase", cursor: "pointer", fontFamily: warrior, boxShadow: `0 0 15px ${t.accentGlow}` };
  const btnSecStyle = { padding: "8px 16px", background: "transparent", color: t.accent, border: `1px solid ${t.accent}`, borderRadius: 6, fontSize: 11, fontWeight: 600, letterSpacing: 1, cursor: "pointer", fontFamily: warrior };
  const inputStyle = { padding: "12px 16px", background: t.surface, color: t.text, border: `1px solid ${t.border}`, borderRadius: 8, fontSize: 15, fontFamily: mono, outline: "none", textAlign: "center", width: "100%", maxWidth: 260, boxSizing: "border-box" };

  if (phase === "splash") return <><style>{ANIMS}</style><LoadingScreen onReady={() => setPhase("lobby")} /></>;
  if (phase === "ready") return <><style>{ANIMS}</style><ReadyScreen opponentName={opponentName} onStart={() => setPhase("playing")} /></>;

  if (phase === "gameover") {
    if (showReview) return <BoardReview defenseBoard={defenseBoard} shipColorMap={shipColorMap} defenseOverlay={defenseOverlay} attackOverlay={attackOverlay} oppShipsData={oppShipsData} myShipsData={myShipsData} defHitMap={defHitMap} atkHitMap={atkHitMap} cellSize={cellSize} onBack={() => setShowReview(false)} />;
    return <><style>{ANIMS}</style><GameOverScreen winner={winner} myHits={myHits} oppHits={oppHits} isWin={isWin} onNewGame={resetGame} onViewBoard={() => setShowReview(true)} /></>;
  }

  if (phase === "lobby") {
    return (
      <div style={appStyle}>
        <style>{ANIMS}</style>
        <div style={{ fontSize: 30, fontWeight: 700, letterSpacing: 5, color: t.accent, textShadow: `0 0 30px ${t.accentGlow}`, marginBottom: 4, fontFamily: warrior, animation: "fadeUp 0.4s ease-out" }}>AMİRAL BATTI</div>
        <div style={{ fontSize: 10, color: t.textDim, letterSpacing: 6, marginBottom: 28, fontFamily: warrior }}>ONLINE DENİZ SAVAŞI</div>
        <div style={{ background: `linear-gradient(135deg, ${t.surface}, rgba(17,24,39,0.9))`, border: `1px solid ${t.border}`, borderRadius: 14, padding: "28px 20px", textAlign: "center", width: "100%", maxWidth: 340, animation: "fadeUp 0.5s ease-out", boxShadow: "0 8px 32px rgba(0,0,0,0.3)" }}>
          <input style={inputStyle} placeholder="Adın" value={playerName} onChange={e => setPlayerName(e.target.value)} />
          <div style={{ height: 16 }} />
          <button style={{ ...btnStyle, width: "100%" }} onClick={createRoom}>YENİ ODA OLUŞTUR</button>
          <div style={{ margin: "18px 0", color: t.textDim, fontSize: 10, letterSpacing: 3, fontFamily: warrior }}>— VEYA —</div>
          <input style={inputStyle} placeholder="Oda Kodu" value={inputRoomId} onChange={e => setInputRoomId(e.target.value.toUpperCase())} />
          <div style={{ height: 10 }} />
          <button style={{ ...btnStyle, width: "100%" }} onClick={joinRoom}>ODAYA KATIL</button>
          {message && <div style={{ marginTop: 14, color: t.hit, fontSize: 11 }}>{message}</div>}
        </div>
      </div>
    );
  }

  if (phase === "waiting") {
    return (
      <div style={appStyle}>
        <style>{ANIMS}</style>
        <div style={{ fontSize: 30, fontWeight: 700, letterSpacing: 5, color: t.accent, textShadow: `0 0 30px ${t.accentGlow}`, marginBottom: 4, fontFamily: warrior }}>AMİRAL BATTI</div>
        <div style={{ fontSize: 10, color: t.textDim, letterSpacing: 6, marginBottom: 28, fontFamily: warrior }}>RAKİP BEKLENİYOR</div>
        <div style={{ background: t.surface, border: `1px solid ${t.border}`, borderRadius: 14, padding: 28, textAlign: "center", width: "100%", maxWidth: 340, boxShadow: "0 8px 32px rgba(0,0,0,0.3)" }}>
          <div style={{ fontSize: 13, marginBottom: 10, fontFamily: warrior, letterSpacing: 2 }}>ODA KODU</div>
          <div style={{ fontSize: 36, fontWeight: 700, color: t.accent, letterSpacing: 8, textShadow: `0 0 20px ${t.accentGlow}`, marginBottom: 14, fontFamily: warrior }}>{roomId}</div>
          <div style={{ fontSize: 11, color: t.textDim, fontFamily: mono }}>Bu kodu rakibine gönder!</div>
          <div style={{ marginTop: 20 }}><div style={{ width: 12, height: 12, borderRadius: "50%", background: t.accent, margin: "0 auto", animation: "pulse 1.5s infinite" }} /></div>
        </div>
      </div>
    );
  }

  if (phase === "placing") {
    const allPlaced = placedShips.length === SHIPS.length;
    const timerLow = placementTimer <= 15;
    const nextShip = SHIPS.find(s => !placedShips.some(p => p.id === s.id));
    return (
      <div style={{ ...appStyle, paddingBottom: 80 }}>
        <style>{ANIMS}</style>
        <div style={{ fontSize: 20, fontWeight: 700, letterSpacing: 4, color: t.accent, marginBottom: 4, fontFamily: warrior }}>GEMİ YERLEŞTİR</div>
        <div style={{ fontSize: 22, fontWeight: 700, marginBottom: 6, color: timerLow ? t.hit : t.accent, animation: timerLow ? "blink3s 1s infinite" : "none", fontFamily: warrior }}>{formatTime(placementTimer)}</div>
        <div style={{ fontSize: 11, color: t.textDim, marginBottom: 8, fontFamily: mono }}>{placedShips.length}/{SHIPS.length} gemi yerleştirildi</div>
        {!allPlaced && !placementConfirmed && (
          <>
            <div style={{ background: t.surface, border: `1px solid ${t.border}`, borderRadius: 8, padding: "8px 14px", marginBottom: 8, fontSize: 11, textAlign: "center", width: "100%", maxWidth: 400, fontFamily: mono }}>
              {selectedShip ? <span><span style={{ color: t.accent, fontWeight: 800 }}>▸</span> Haritada bir yere dokun</span> : <span><span style={{ color: t.accent, fontWeight: 800 }}>▸</span> Aşağıdan bir gemi seç</span>}
            </div>
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
                      fontFamily: mono, opacity: placed ? 0.4 : 1,
                      textDecoration: placed ? "line-through" : "none", fontWeight: sel ? 700 : 400,
                      animation: !placed && !sel && ship.id === nextShip?.id ? "borderGlow 2s infinite" : "none",
                    }}>{ship.name}({ship.size})</button>
                );
              })}
            </div>
            <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
              {selectedShip && <button style={btnSecStyle} onClick={() => setRotation((rotation + 1) % 4)}>↻ DÖNDÜR</button>}
              {placedShips.length > 0 && <button style={{ ...btnSecStyle, color: t.hit, borderColor: t.hit }} onClick={undoLastShip}>↩ GERİ</button>}
            </div>
          </>
        )}
        {allPlaced && !placementConfirmed && (
          <button style={{ ...btnStyle, marginBottom: 12, animation: "borderGlow 1.5s infinite" }} onClick={confirmPlacement}>✓ GEMİLERİ ONAYLA</button>
        )}
        {placementConfirmed && (
          <div style={{ background: t.surface, border: `1px solid ${t.border}`, borderRadius: 8, padding: "12px 20px", marginBottom: 8, fontSize: 12, color: t.accent, textAlign: "center", fontFamily: mono }}>
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

  if (phase === "playing") {
    const myLow = myClock <= 30;
    const oppLow = oppClock <= 30;
    const isAttack = activeBoard === "attack";
    return (
      <div style={{ ...appStyle, paddingBottom: 74 }}>
        <style>{ANIMS}</style>
        {/* Clocks */}
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 6, width: "100%", maxWidth: 400, justifyContent: "center" }}>
          <div style={{ padding: "4px 10px", borderRadius: 6, fontSize: 13, fontWeight: 700, fontFamily: warrior, background: myTurn ? (myLow ? "rgba(239,68,68,0.15)" : "rgba(6,182,212,0.12)") : t.surfaceLight, color: myTurn ? (myLow ? t.hit : t.accent) : t.textDim, border: `1px solid ${myTurn ? (myLow ? t.hit : t.accent) : t.border}`, flex: 1, textAlign: "center", letterSpacing: 1 }}>
            {playerName}: {formatTime(myClock)}
          </div>
          <div style={{ padding: "4px 10px", borderRadius: 6, fontSize: 13, fontWeight: 700, fontFamily: warrior, background: !myTurn ? (oppLow ? "rgba(239,68,68,0.15)" : "rgba(6,182,212,0.12)") : t.surfaceLight, color: !myTurn ? (oppLow ? t.hit : t.accent) : t.textDim, border: `1px solid ${!myTurn ? (oppLow ? t.hit : t.accent) : t.border}`, flex: 1, textAlign: "center", letterSpacing: 1 }}>
            {opponentName}: {formatTime(oppClock)}
          </div>
        </div>
        {/* Turn indicator */}
        <div style={{
          fontSize: 16, fontWeight: 700, marginBottom: 6, textAlign: "center",
          fontFamily: warrior, letterSpacing: 3, textTransform: "uppercase",
          color: myTurn ? t.accent : t.textDim,
          textShadow: myTurn ? `0 0 20px ${t.accentGlow}` : "none",
          animation: myTurn ? "fadeUp 0.3s ease-out" : "none",
        }}>
          {myTurn ? "⚡ SENİN SIRAN ⚡" : "Rakibin sırası..."}
        </div>
        <div style={{ fontSize: 10, color: t.textDim, marginBottom: 6, fontFamily: mono }}>
          İsabet: {myHits}/20 • Karavana: {oppHits}/20
        </div>
        {damageReport && (
          <div style={{ background: "rgba(239,68,68,0.1)", border: `1px solid ${t.hit}`, borderRadius: 8, padding: "6px 14px", marginBottom: 6, fontSize: 11, color: t.hit, fontWeight: 700, textAlign: "center", width: "100%", maxWidth: 400, animation: "slideIn 0.3s ease-out", fontFamily: warrior, letterSpacing: 1 }}>⚠ {damageReport}</div>
        )}
        {/* Toggle */}
        <div style={{ display: "flex", gap: 0, marginBottom: 6, width: "100%", maxWidth: 400 }}>
          <button onClick={() => { setActiveBoard("attack"); setMarkMode(false); }} style={{
            flex: 1, padding: "10px 0", fontSize: 14, fontWeight: 700, fontFamily: warrior, cursor: "pointer",
            background: isAttack ? `linear-gradient(135deg, ${t.accent}, #0891b2)` : t.surfaceLight,
            color: isAttack ? t.bg : t.textDim,
            border: `2px solid ${isAttack ? t.accent : t.border}`,
            borderRadius: "10px 0 0 10px", letterSpacing: 3,
            animation: myTurn && isAttack ? "borderGlow 2s infinite" : "none",
          }}>⚔ SALDIRI</button>
          <button onClick={() => { setActiveBoard("defense"); setMarkMode(false); }} style={{
            flex: 1, padding: "10px 0", fontSize: 14, fontWeight: 700, fontFamily: warrior, cursor: "pointer",
            background: !isAttack ? `linear-gradient(135deg, ${t.accent}, #0891b2)` : t.surfaceLight,
            color: !isAttack ? t.bg : t.textDim,
            border: `2px solid ${!isAttack ? t.accent : t.border}`,
            borderRadius: "0 10px 10px 0", letterSpacing: 3,
          }}>🛡 SAVUNMA</button>
        </div>
        {/* Mark mode toggle for mobile */}
        {isAttack && (
          <button onClick={() => setMarkMode(!markMode)} style={{
            marginBottom: 6, padding: "6px 16px", fontSize: 10, fontWeight: 700, fontFamily: warrior,
            background: markMode ? t.gold : "transparent",
            color: markMode ? t.bg : t.gold,
            border: `1px solid ${t.gold}`, borderRadius: 6, cursor: "pointer", letterSpacing: 2,
          }}>
            {markMode ? "⚑ İŞARETLEME MODU: AÇIK" : "⚑ İŞARETLE"}
          </button>
        )}
        {/* Board */}
        <div style={{
          width: "100%", maxWidth: 400,
          border: myTurn && isAttack ? `2px solid ${t.accent}` : `1px solid transparent`,
          borderRadius: 12, padding: 2,
          animation: myTurn && isAttack ? "borderGlow 2s infinite" : "none",
        }}>
          {isAttack ? (
            <>
              <Grid board={emptyGrid()} cellSize={cellSize} overlay={getAttackDisplayOverlay()} onClick={handleAttackClick} onRightClick={handleAttackRightClick} onLongPress={handleAttackLongPress} disabled={!myTurn} manualMarks={manualMarks} blinkCells={blinkCells} />
              <ShipStatusPanel title="RAKİP GEMİLER" ships={oppShipsData} hitCells={atkHitMap} color={t.hit} />
            </>
          ) : (
            <>
              <Grid board={defenseBoard} cellSize={cellSize} isDefense shipColors={shipColorMap} overlay={defenseOverlay} disabled blinkCells={blinkCells} />
              <ShipStatusPanel title="GEMİLERİM" ships={myShipsData} hitCells={defHitMap} color={t.accent} />
            </>
          )}
        </div>
        <NotationLog entries={notationEntries} />
        {/* Sticky fire bar */}
        {myTurn && isAttack && !markMode && (
          <div style={{
            position: "fixed", bottom: 0, left: 0, right: 0,
            background: "rgba(10,14,23,0.96)", backdropFilter: "blur(10px)",
            borderTop: `1px solid ${t.border}`,
            padding: "10px 16px", display: "flex", alignItems: "center", justifyContent: "center", gap: 14, zIndex: 100,
          }}>
            <div style={{ display: "flex", gap: 5 }}>
              {[0,1,2].map(i => (
                <div key={i} style={{ width: 14, height: 14, borderRadius: "50%", background: i < currentShots.length ? t.hit : t.accent, opacity: i < currentShots.length ? 0.3 : 1, animation: i < currentShots.length ? "popIn 0.3s ease-out" : "none" }} />
              ))}
            </div>
            <button onClick={fireShots} disabled={currentShots.length === 0} style={{
              padding: "12px 36px", background: currentShots.length > 0 ? `linear-gradient(135deg, ${t.hit}, #dc2626)` : t.surfaceLight,
              color: currentShots.length > 0 ? "#fff" : t.textDim, border: "none", borderRadius: 10,
              fontSize: 16, fontWeight: 700, letterSpacing: 3, cursor: currentShots.length === 0 ? "default" : "pointer",
              fontFamily: warrior, boxShadow: currentShots.length > 0 ? `0 0 24px ${t.hitGlow}` : "none",
              opacity: currentShots.length === 0 ? 0.5 : 1,
            }}>
              ATEŞ 🔥
            </button>
          </div>
        )}
      </div>
    );
  }

  return null;
}
