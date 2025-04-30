// --- START OF aiWorker.js ---

// AI Worker (aiWorker.js) - Runs in a separate thread

// --- Constants needed by the worker ---
const ROWS = 9; const COLS = 7;
const LAND = 0, WATER = 1, TRAP = 2, PLAYER0_DEN = 3, PLAYER1_DEN = 4;
const PLAYER = 0; // Blue
const AI = 1;     // Red
const PIECES = { rat:{rank: 1, name: 'Rat',symbol: '🐀', value: 100}, cat:{rank: 2, name: 'Cat',symbol: '🐈', value: 200}, dog:{rank: 3, name: 'Dog',symbol: '🐕', value: 300}, wolf:{rank: 4, name: 'Wolf',symbol: '🐺', value: 400}, leopard:{rank: 5, name: 'Leopard',symbol: '🐆', value: 500}, tiger:{rank: 6, name: 'Tiger',symbol: '🐅', value: 700}, lion:{rank: 7, name: 'Lion',symbol: '🦁', value: 800}, elephant:{rank: 8, name: 'Elephant',symbol: '🐘', value: 650} };
const PLAYER0_DEN_ROW = 8; const PLAYER0_DEN_COL = 3;
const PLAYER1_DEN_ROW = 0; const PLAYER1_DEN_COL = 3;
const WIN_SCORE = 20000; const LOSE_SCORE = -20000;
const HASH_EXACT = 0; const HASH_LOWERBOUND = 1; const HASH_UPPERBOUND = 2;
const MAX_PLY_FOR_KILLERS = 20;

// --- Worker-Scoped State ---
let aiRunCounter = 0;
let killerMoves = [];

// --- Zobrist Hashing & Transposition Table ---
const zobristTable = []; let zobristBlackToMove; const pieceNameToIndex = {}; let pieceIndexCounter = 0;
let transpositionTable = new Map();

// Zobrist Initialization
function randomBigInt() { const l = BigInt(Math.floor(Math.random()*(2**32))); const h = BigInt(Math.floor(Math.random()*(2**32))); return (h << 32n) | l; }
function initializeZobrist() { pieceIndexCounter = 0; for (const pKey in PIECES) { const nameL=pKey.toLowerCase(); if (!pieceNameToIndex.hasOwnProperty(nameL)){ pieceNameToIndex[nameL] = pieceIndexCounter++; zobristTable[pieceNameToIndex[nameL]] = []; } const idx = pieceNameToIndex[nameL]; zobristTable[idx][PLAYER] = []; zobristTable[idx][AI] = []; for (let r=0;r<ROWS;r++){zobristTable[idx][PLAYER][r]=[]; zobristTable[idx][AI][r]=[]; for(let c=0;c<COLS;c++){zobristTable[idx][PLAYER][r][c]=randomBigInt(); zobristTable[idx][AI][r][c]=randomBigInt();}}} zobristBlackToMove=randomBigInt(); /* console.log("[Worker] Zobrist Initialized."); */ }
initializeZobrist();

// --- Zobrist Key Calculation (Worker-Scoped - Corrected) ---
function computeZobristKey(cB, ptm) {
     let key = 0n; // Ensure key starts as BigInt
     for (let r = 0; r < ROWS; r++) {
         for (let c = 0; c < COLS; c++) {
             const p = cB[r]?.[c]?.piece; // Safe access
             if (p && p.name) { // Check if piece and name exist
                 const pnl = p.name.toLowerCase();
                 const pI = pieceNameToIndex[pnl];

                 // *** Add more detailed checks before accessing zobristTable ***
                 if (pI !== undefined &&
                     p.player !== undefined && (p.player === 0 || p.player === 1) && // Ensure valid player index
                     r >= 0 && r < ROWS && // Ensure valid row index
                     c >= 0 && c < COLS && // Ensure valid col index
                     zobristTable[pI]?.[p.player]?.[r]?.[c]) // Check actual table entry exists
                 {
                    try {
                        key ^= zobristTable[pI][p.player][r][c]; // XOR the BigInt key
                    } catch (e) {
                        console.error(`[Worker] Error XORing Zobrist key: piece=${pnl}, player=${p.player}, r=${r}, c=${c}, key=${key}`, e);
                        // Handle error, maybe return a default key or skip this piece
                    }

                 } else {
                     // Optional: Log if a piece is encountered that doesn't have a valid Zobrist entry
                      console.warn(`[Worker] Zobrist Compute: Skipped invalid piece data or missing Zobrist entry`, { name: p.name, player: p.player, r: r, c: c, pI: pI});
                 }
            }
         }
     }
     // XOR turn key if AI is to move
     if (ptm === AI) {
         key ^= zobristBlackToMove;
     }
     return key;
}


// Time Limit Error Class
class TimeLimitExceededError extends Error { constructor(message="Timeout"){super(message); this.name="TimeLimitExceededError";} }

// --- Utility Functions (Worker-Scoped) ---
function cloneBoard(b) { /* ... keep as is ... */ return b.map(r => r.map(c => ({ terrain: c.terrain, piece: c.piece ? { ...c.piece } : null }))); }

// --- Movement Rules & Checks (Worker-Scoped) ---
function getPieceRank(p, r, c, cB) { /* ... keep as is ... */ if (!p) return 0; const t = cB[r]?.[c]?.terrain; if (t === TRAP) { const oppTrap = (p.player === PLAYER && r <= 1) || (p.player === AI && r >= 7); if (oppTrap) { const traps = [{r:0,c:2},{r:0,c:4},{r:1,c:3},{r:8,c:2},{r:8,c:4},{r:7,c:3}]; if (traps.some(tr => tr.r === r && tr.c === c)) return 0; } } return p.rank; }
function canCapture(attPc, defPc, attR, attC, defR, defC, cB) { /* ... keep as is ... */ if (!attPc || !defPc || attPc.player === defPc.player) return false; const attT=cB[attR]?.[attC]?.terrain; const defT=cB[defR]?.[defC]?.terrain; if(attT === undefined || defT === undefined) return false; /* Safety Check */ if (attPc.name==='Rat'&&defPc.name==='Rat'&&attT!==WATER&&defT===WATER) return false; if (attT===WATER&&defT!==WATER&&!(attPc.name==='Rat'&&defPc.name==='Rat')) return false; if (attT===WATER&&attPc.name!=='Rat') return false; const attRk=getPieceRank(attPc,attR,attC,cB); const defRk=getPieceRank(defPc,defR,defC,cB); if (attPc.name==='Rat'&&defPc.name==='Elephant') return attT!==WATER; if (attPc.name==='Elephant'&&defPc.name==='Rat') return false; return attRk >= defRk; }
function isRiver(r, c) { /* ... keep as is ... */ return r >= 3 && r <= 5 && (c === 1 || c === 2 || c === 4 || c === 5); }
function getPossibleMoves(pc, r, c, cB) { /* ... keep as is ... */ const m=[]; const pl=pc.player; const potM=[{r:r-1,c:c},{r:r+1,c:c},{r:r,c:c-1},{r:r,c:c+1}]; potM.forEach(mv => { const {r:nr,c:nc}=mv; if(nr>=0&&nr<ROWS&&nc>=0&&nc<COLS){ const tCell=cB[nr]?.[nc]; if(!tCell) return; const tPc=tCell.piece; const tTerr=tCell.terrain; const myDen = (pl === PLAYER) ? PLAYER0_DEN : PLAYER1_DEN; if(tTerr === myDen) return; if(tTerr===WATER&&pc.name!=='Rat') return; if(tPc?.player===pl) return; if(tPc&&!canCapture(pc,tPc,r,c,nr,nc,cB)) return; m.push({row:nr,col:nc}); } }); if(pc.name==='Lion'||pc.name==='Tiger'){ const jOR=(tr,tc,rcs,rrs)=>{ if(tr<0||tr>=ROWS||tc<0||tc>=COLS) return; for(let i=0;i<rrs.length;i++){ if(!isRiver(rrs[i],rcs[i])||cB[rrs[i]]?.[rcs[i]]?.piece) return; } const tCell=cB[tr]?.[tc]; if(!tCell) return; const tPc=tCell.piece; const tTerr=tCell.terrain; const myDen = (pl === PLAYER) ? PLAYER0_DEN : PLAYER1_DEN; if(tTerr===WATER||tTerr === myDen ||tPc?.player===pl) return; if(tPc&&!canCapture(pc,tPc,r,c,tr,tc,cB)) return; m.push({row:tr,col:tc}); }; if(isRiver(3,c)){if(r===2)jOR(6,c,[c,c,c],[3,4,5]);else if(r===6)jOR(2,c,[c,c,c],[5,4,3]);} if(pc.name==='Lion'){if(c===0&&isRiver(r,1)&&isRiver(r,2))jOR(r,3,[1,2],[r,r]);else if(c===3){if(isRiver(r,1)&&isRiver(r,2))jOR(r,0,[1,2],[r,r]); if(isRiver(r,4)&&isRiver(r,5))jOR(r,6,[4,5],[r,r]);}else if(c===6&&isRiver(r,4)&&isRiver(r,5))jOR(r,3,[4,5],[r,r]);}} return m; }
function getAllPossibleMovesForPlayer(pl, cB) { /* ... keep as is ... */ const m=[];for(let r=0;r<ROWS;r++)for(let c=0;c<COLS;c++){const p=cB[r]?.[c]?.piece;if(p?.player===pl)try{getPossibleMoves(p,r,c,cB).forEach(mv=>m.push({pieceData:p,fromRow:r,fromCol:c,toRow:mv.row,toCol:mv.col}));}catch(e){/*ignore*/}}return m; }
function checkTerminalState(cB) { /* ... keep as is ... */ const p1DP=cB[PLAYER1_DEN_ROW]?.[PLAYER1_DEN_COL]?.piece; const p0DP=cB[PLAYER0_DEN_ROW]?.[PLAYER0_DEN_COL]?.piece; if (p1DP?.player === PLAYER) return {isT:true, w:PLAYER}; if (p0DP?.player === AI) return {isT:true, w:AI}; let p0C=0,p1C=0; for(let r=0; r<ROWS; r++)for(let c=0; c<COLS; c++){ const p=cB[r]?.[c]?.piece; if(p){ if (p.player === PLAYER) p0C++; else p1C++; } } if (p1C === 0 && p0C > 0) return {isT:true, w:PLAYER}; if (p0C === 0 && p1C > 0) return {isT:true, w:AI}; if (p0C === 0 && p1C === 0) return {isT:true, w:null}; return {isT:false, w:null}; }
function simulateMoveAndGetHash(currentBoardState, move, currentHash) { /* ... Keep Corrected version ... */
    const nB = cloneBoard(currentBoardState); const pM = nB[move.fromRow]?.[move.fromCol]?.piece; if (!pM) { console.warn("SimHash Err: No Piece", move); return { newBoard: nB, newHash: currentHash }; } const capturedP = nB[move.toRow]?.[move.toCol]?.piece; let newHash = currentHash; const movingPieceIndex = pieceNameToIndex[pM.name.toLowerCase()]; const capturedPieceIndex = capturedP ? pieceNameToIndex[capturedP.name.toLowerCase()] : -1; if(zobristTable.length > 0 && typeof BigInt === 'function') { try { const keyRemoveMover = (movingPieceIndex !== -1 && zobristTable[movingPieceIndex]?.[pM.player]?.[move.fromRow]?.[move.fromCol]) ? zobristTable[movingPieceIndex][pM.player][move.fromRow][move.fromCol] : 0n; const keyRemoveCapture = (capturedP && capturedPieceIndex !== -1 && zobristTable[capturedPieceIndex]?.[capturedP.player]?.[move.toRow]?.[move.toCol]) ? zobristTable[capturedPieceIndex][capturedP.player][move.toRow][move.toCol] : 0n; const keyAddMover = (movingPieceIndex !== -1 && zobristTable[movingPieceIndex]?.[pM.player]?.[move.toRow]?.[move.toCol]) ? zobristTable[movingPieceIndex][pM.player][move.toRow][move.toCol] : 0n; newHash ^= keyRemoveMover ^ keyRemoveCapture ^ keyAddMover ^ zobristBlackToMove; } catch (e) { console.error("Err calc sim hash", e); return { newBoard: nB, newHash: currentHash }; } } pM.row=move.toRow;pM.col=move.toCol;nB[move.toRow][move.toCol].piece=pM; nB[move.fromRow][move.fromCol].piece=null; return { newBoard: nB, newHash }; }
function movesAreEqual(move1, move2) { /* ... keep as is ... */ if (!move1 || !move2) return false; return move1.fromRow === move2.fromRow && move1.fromCol === move2.fromCol && move1.toRow === move2.toRow && move1.toCol === move2.toCol; }
function recordKillerMove(ply, move) { /* ... keep as is ... */ if(ply < 0 || ply >= MAX_PLY_FOR_KILLERS || !move) return; if(killerMoves[ply] && movesAreEqual(move, killerMoves[ply][0])) return; if (!killerMoves[ply]) killerMoves[ply] = [null, null]; killerMoves[ply][1] = killerMoves[ply][0]; killerMoves[ply][0] = move; }

// --- Evaluation Function (Worker-Scoped) ---
function evaluateBoard(currentBoard) { /* ... Copy aggressive evaluation here ... */
     let termState = checkTerminalState(currentBoard); if (termState.isT) { return termState.w === AI ? WIN_SCORE : (termState.w === PLAYER ? LOSE_SCORE : 0); } const HEURISTIC_WEIGHTS = { MATERIAL: 1.0, ADVANCEMENT: 0.25, DEN_PROXIMITY: 6.0, ATTACK_THREAT: 1.5, KEY_SQUARE: 0.5, TRAPPED_PENALTY: -3.0, DEFENSE_PENALTY: -0.7 }; let aiScore = 0, playerScore = 0; const pieces = { [PLAYER]: [], [AI]: [] }; for (let r = 0; r < ROWS; r++) { for (let c = 0; c < COLS; c++) { const cell = currentBoard[r]?.[c]; if (!cell) continue; const piece = cell.piece; if (piece) { const player = piece.player; const pieceKey = piece.name.toLowerCase(); const value = PIECES[pieceKey]?.value ?? 0; pieces[player].push({ ...piece, r, c, terrain: cell.terrain }); let scoreRef = (player === AI) ? aiScore : playerScore; scoreRef += value * HEURISTIC_WEIGHTS.MATERIAL; const advancement = (player === AI) ? r : (ROWS - 1 - r); scoreRef += advancement * HEURISTIC_WEIGHTS.ADVANCEMENT * (value / 150.0); if (pieceKey !== 'rat') { if (player === AI && r < 3) scoreRef += (r-3) * HEURISTIC_WEIGHTS.DEFENSE_PENALTY * (value/100.0); if (player === PLAYER && r > 5) scoreRef += ((ROWS - 1 - r)-3) * HEURISTIC_WEIGHTS.DEFENSE_PENALTY * (value/100.0); } if (getPieceRank(piece, r, c, currentBoard) === 0 && cell.terrain === TRAP) { scoreRef += HEURISTIC_WEIGHTS.TRAPPED_PENALTY * (value / 100.0); } if(player === AI) aiScore = scoreRef; else playerScore = scoreRef; } } } if (pieces[AI].length === 0 && pieces[PLAYER].length > 0) return LOSE_SCORE; if (pieces[PLAYER].length === 0 && pieces[AI].length > 0) return WIN_SCORE; pieces[AI].forEach(p => { const dist = Math.abs(p.r - PLAYER0_DEN_ROW) + Math.abs(p.c - PLAYER0_DEN_COL); const advFactor = (p.r >= 4) ? 1 : 0.1; aiScore += Math.max(0, 15 - dist) * HEURISTIC_WEIGHTS.DEN_PROXIMITY * (p.value / 150.0) * advFactor; }); pieces[PLAYER].forEach(p => { const dist = Math.abs(p.r - PLAYER1_DEN_ROW) + Math.abs(p.c - PLAYER1_DEN_COL); const advFactor = (p.r <= 4) ? 1 : 0.1; playerScore += Math.max(0, 15 - dist) * HEURISTIC_WEIGHTS.DEN_PROXIMITY * (p.value / 150.0) * advFactor; }); const checkAttackThreat = (attackerPlayer, defenderPlayer) => { let bonus = 0; for(const attacker of pieces[attackerPlayer]){ const potMoves = [{r:attacker.r-1,c:attacker.c},{r:attacker.r+1,c:attacker.c},{r:attacker.r,c:attacker.c-1},{r:attacker.r,c:attacker.c+1}]; for(const mv of potMoves) { if(mv.r >=0 && mv.r<ROWS && mv.c>=0 && mv.c<COLS){ const targetPiece = currentBoard[mv.r]?.[mv.c]?.piece; if(targetPiece?.player === defenderPlayer) { const targetVal = PIECES[targetPiece.name.toLowerCase()]?.value ?? 0; if(canCapture(attacker, targetPiece, attacker.r, attacker.c, mv.r, mv.c, currentBoard)) { bonus += targetVal * HEURISTIC_WEIGHTS.ATTACK_THREAT / 100.0; } else { bonus += targetVal * (HEURISTIC_WEIGHTS.ATTACK_THREAT / 4) / 100.0; } } } } } return bonus; }; aiScore += checkAttackThreat(AI, PLAYER); playerScore += checkAttackThreat(PLAYER, AI); const getPieceLoc = (pType, pPlayer) => pieces[pPlayer].find(p => p.name.toLowerCase() === pType); const aiRatPos = getPieceLoc('rat', AI); const playerElephPos = getPieceLoc('elephant', PLAYER); if (aiRatPos && playerElephPos && currentBoard[aiRatPos.r]?.[aiRatPos.c]?.terrain !== WATER) { const dist = Math.abs(aiRatPos.r - playerElephPos.r) + Math.abs(aiRatPos.c - playerElephPos.c); if (dist <= 2) aiScore += (3 - dist) * 3.0; } const playerRatPos = getPieceLoc('rat', PLAYER); const aiElephPos = getPieceLoc('elephant', AI); if (playerRatPos && aiElephPos && currentBoard[playerRatPos.r]?.[playerRatPos.c]?.terrain !== WATER) { const dist = Math.abs(playerRatPos.r - aiElephPos.r) + Math.abs(playerRatPos.c - aiElephPos.c); if (dist <= 2) playerScore += (3 - dist) * 3.0; }
     return aiScore - playerScore;
}


// --- AlphaBeta Search with TT & Killers ---
function alphaBeta(currentBoard, currentHash, depth, alpha, beta, isMaximizingPlayer, startTime, timeLimit, ply) {
     aiRunCounter++;
     if (performance.now() - startTime > timeLimit) throw new TimeLimitExceededError();
     const originalAlpha = alpha; const hashKey = currentHash;
     const ttEntry = transpositionTable.get(hashKey);
     if (ttEntry && ttEntry.depth >= depth) { if (ttEntry.flag === HASH_EXACT) return ttEntry.score; if (ttEntry.flag === HASH_LOWERBOUND) alpha = Math.max(alpha, ttEntry.score); if (ttEntry.flag === HASH_UPPERBOUND) beta = Math.min(beta, ttEntry.score); if (alpha >= beta) return ttEntry.score; }
     let termState = checkTerminalState(currentBoard);
     if (termState.isT || depth === 0) { let baseScore = evaluateBoard(currentBoard); if (termState.isT && termState.w !== null) { const DBM = 10; if (termState.w === AI) baseScore += depth * DBM; if (termState.w === PLAYER) baseScore -= depth * DBM; } if (!ttEntry || ttEntry.depth < depth ) { transpositionTable.set(hashKey, { score: baseScore, depth: depth, flag: HASH_EXACT, bestMove: null }); } return baseScore; }
     const playerToMove = isMaximizingPlayer ? AI : PLAYER;
     let moves; try { moves = getAllPossibleMovesForPlayer(playerToMove, currentBoard); } catch (e) { return isMaximizingPlayer ? -Infinity : Infinity; } if (moves.length === 0) return evaluateBoard(currentBoard);
     let hashMove = ttEntry?.bestMove; const kMove1 = (ply >= 0 && ply < MAX_PLY_FOR_KILLERS) ? killerMoves[ply]?.[0] : null; const kMove2 = (ply >= 0 && ply < MAX_PLY_FOR_KILLERS) ? killerMoves[ply]?.[1] : null;
     for (const move of moves) { move.orderScore = 0; if (hashMove && movesAreEqual(move, hashMove)) { move.orderScore = 20000; } else if (kMove1 && movesAreEqual(move, kMove1)) { move.orderScore = 19000; } else if (kMove2 && movesAreEqual(move, kMove2)) { move.orderScore = 18000; } else { const tp = currentBoard[move.toRow]?.[move.toCol]?.piece; if (tp) { move.orderScore = 1000 + (PIECES[tp.name.toLowerCase()]?.value ?? 0) - (PIECES[move.pieceData?.name?.toLowerCase()]?.value ?? 0); } else { const odr=(playerToMove === AI)?PLAYER0_DEN_ROW:PLAYER1_DEN_ROW; const cD=Math.abs(move.fromRow - odr); const nD=Math.abs(move.toRow-odr); if(nD<cD) move.orderScore+=5;} } }
     moves.sort((a, b) => b.orderScore - a.orderScore);
     let bestMoveForNode = null; let bestScore = isMaximizingPlayer ? -Infinity : Infinity;
     for (const move of moves) {
         const capturedPieceForHash = currentBoard[move.toRow]?.[move.toCol]?.piece;
         let simResult; try { simResult = simulateMoveAndGetHash(currentBoard, move, hashKey); } catch (e) { console.error("SimHash AB Error", e); continue; }
         let evalScore; try { evalScore = alphaBeta(simResult.newBoard, simResult.newHash, depth - 1, alpha, beta, !isMaximizingPlayer, startTime, timeLimit, ply+1); } catch(e) { if(e instanceof TimeLimitExceededError) throw e; evalScore = isMaximizingPlayer ? -Infinity : Infinity;}
         if (isMaximizingPlayer) { if (evalScore > bestScore) { bestScore = evalScore; bestMoveForNode = move; } alpha = Math.max(alpha, bestScore); if (beta <= alpha) { if(!capturedPieceForHash) recordKillerMove(ply, move); break; } }
         else { if (evalScore < bestScore) { bestScore = evalScore; bestMoveForNode = move; } beta = Math.min(beta, bestScore); if (beta <= alpha) { if(!capturedPieceForHash) recordKillerMove(ply, move); break; } }
     }
     let flag; if (bestScore <= originalAlpha) flag = HASH_UPPERBOUND; else if (bestScore >= beta) flag = HASH_LOWERBOUND; else flag = HASH_EXACT;
     if (!ttEntry || depth >= ttEntry.depth || flag == HASH_EXACT) { transpositionTable.set(hashKey, { score: bestScore, depth: depth, flag: flag, bestMove: bestMoveForNode ? { fromRow: bestMoveForNode.fromRow, fromCol: bestMoveForNode.fromCol, toRow: bestMoveForNode.toRow, toCol: bestMoveForNode.toCol } : null }); }
     return bestScore;
 }


// --- findBestMove with Iterative Deepening ---
function findBestMove(currentBoard, maxDepth, timeLimit) {
     const startTime = performance.now(); aiRunCounter = 0; transpositionTable.clear();
     killerMoves = Array(MAX_PLY_FOR_KILLERS).fill(null).map(() => [null, null]); // Clear killers
     let bestMoveOverall = null; let lastCompletedDepth = 0; let bestScoreOverall = -Infinity;
     let rootMoves; try { rootMoves = getAllPossibleMovesForPlayer(AI, currentBoard); } catch (e) { console.error("[Worker] Err initial moves:", e); return { move: null, depthAchieved: 0, error: "Move gen error" };}
     if (rootMoves.length === 0) { return { move: null, depthAchieved: 0, error: "No moves available" }; }
     const initialHash = computeZobristKey(currentBoard, AI); const firstMove = rootMoves[0]; const firstMovePiece = currentBoard[firstMove.fromRow]?.[firstMove.fromCol]?.piece; if (firstMovePiece) { bestMoveOverall = { pieceName: firstMovePiece.name, /* Send names not objects */ fromRow: firstMove.fromRow, fromCol: firstMove.fromCol, toRow: firstMove.toRow, toCol: firstMove.toCol }; } else { return { move: null, depthAchieved: 0, error: "Fallback piece missing" }; }

     try {
         for (let currentDepth = 1; currentDepth <= maxDepth; currentDepth++) {
             const timeBeforeIter = performance.now(); if (timeBeforeIter - startTime > timeLimit) { /*console.log(`[Wkr IDS] Timeout before D${currentDepth}`);*/ break; }
             let bestScoreThisIteration = -Infinity; let bestMoveThisIteration = null; let alpha = -Infinity; let beta = Infinity; let iterationNodeCountStart = aiRunCounter;
             const ttEntryRoot = transpositionTable.get(initialHash); const hashMoveRoot = ttEntryRoot?.bestMove;
             if(hashMoveRoot) { const idx=rootMoves.findIndex(m=>movesAreEqual(m, hashMoveRoot)); if(idx > 0) rootMoves.unshift(rootMoves.splice(idx, 1)[0]); } else { for (const move of rootMoves) { const tp=currentBoard[move.toRow]?.[move.toCol]?.piece; move.orderScore = 0; if (tp) { move.orderScore = 1000 + (PIECES[tp.name.toLowerCase()]?.value ?? 0) - (PIECES[move.pieceData?.name?.toLowerCase()]?.value ?? 0); } const odr=PLAYER0_DEN_ROW; if(move.toRow>move.fromRow) move.orderScore += 5;} rootMoves.sort((a, b) => b.orderScore - a.orderScore); }
             if (!bestMoveThisIteration && rootMoves.length > 0) { const fm = rootMoves[0]; const fp = currentBoard[fm.fromRow]?.[fm.fromCol]?.piece; if (fp) bestMoveThisIteration = { pieceName: fp.name, fromRow: fm.fromRow, fromCol: fm.fromCol, toRow: fm.toRow, toCol: fm.toCol }; }

             for (const move of rootMoves) {
                 const pieceToMove = currentBoard[move.fromRow]?.[move.fromCol]?.piece; if (!pieceToMove) continue;
                 const capturedPieceForHash = currentBoard[move.toRow]?.[move.toCol]?.piece;
                 let simResult; try { simResult = simulateMoveAndGetHash(currentBoard, move, initialHash); } catch(e){ console.error("Wkr SimHash root",e); continue; }
                 const score = alphaBeta(simResult.newBoard, simResult.newHash, currentDepth - 1, alpha, beta, false, startTime, timeLimit, 0);
                 if (score > bestScoreThisIteration) { bestScoreThisIteration = score; bestMoveThisIteration = { pieceName: pieceToMove.name, fromRow: move.fromRow, fromCol: move.fromCol, toRow: move.toRow, toCol: move.toCol }; }
                 alpha = Math.max(alpha, score);
             }
             const timeAfterIter = performance.now(); if (timeAfterIter - startTime > timeLimit) { /*console.log(`[Wkr IDS] Timeout DURING D${currentDepth}`);*/ break; }
             lastCompletedDepth = currentDepth; if (bestMoveThisIteration) bestMoveOverall = bestMoveThisIteration; bestScoreOverall = bestScoreThisIteration;
             // Optional minimal worker logging:
             // let iterNodes = aiRunCounter - iterationNodeCountStart; const scoreDisp = bestScoreOverall === -Infinity ? "-Inf" : bestScoreOverall === Infinity ? "+Inf" : bestScoreOverall.toFixed(2);
             // console.log(`[Wkr IDS] D${currentDepth} OK. Sc:${scoreDisp} (Nodes:${iterNodes})`);
              if (bestScoreOverall > LOSE_SCORE*0.9 && (bestScoreOverall >= WIN_SCORE * 0.9 || bestScoreOverall <= LOSE_SCORE * 0.9)) { break; } // Use non-Inf check
         }
     } catch (error) { if (!(error instanceof TimeLimitExceededError)) { console.error("[Wkr IDS] Unexpected search error:", error); return { move: bestMoveOverall, /* send previous best */ depthAchieved: lastCompletedDepth, nodes: aiRunCounter, eval: bestScoreOverall, error: error.message }; } /* Timeouts expected, just fall through */ }
     if (!bestMoveOverall && rootMoves.length > 0) { /* console.warn("[Wkr IDS] Timeout/Err? Use first move."); */ const fm=rootMoves[0]; const fp=currentBoard[fm.fromRow]?.[fm.fromCol]?.piece; if(fp) bestMoveOverall = { pieceName: fp.name, fromRow: fm.fromRow, fromCol: fm.fromCol, toRow: fm.toRow, toCol: fm.toCol }; else { return { move: null, depthAchieved: lastCompletedDepth, nodes: aiRunCounter, eval: bestScoreOverall, error: "Fallback Fail" }; } }

     // Result for postMessage (send data, not full objects)
     return {
         move: bestMoveOverall, // Send the { pieceName, fromRow, ... } object
         depthAchieved: lastCompletedDepth,
         nodes: aiRunCounter,
         eval: bestScoreOverall === -Infinity ? null : bestScoreOverall // Can be -Infinity if timed out on depth 1
     };
 }

// --- Worker Message Handler ---
self.onmessage = function(e) {
    const { boardState, targetDepth, timeLimit } = e.data;
    if (boardState && typeof targetDepth === 'number' && typeof timeLimit === 'number') {
        try {
            const result = findBestMove(boardState, targetDepth, timeLimit);
            self.postMessage(result);
        } catch(error) {
            console.error("[Worker] Error during findBestMove:", error);
            self.postMessage({ move: null, depthAchieved: 0, nodes: aiRunCounter, eval: null, error: error.message || "Worker error" });
        }
    } else {
        console.error("[Worker] Invalid message data:", e.data);
        self.postMessage({ move: null, depthAchieved: 0, nodes: 0, eval: null, error: "Invalid data" });
    }
};

// --- END OF aiWorker.js ---