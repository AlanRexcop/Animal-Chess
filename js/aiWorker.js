// aiWorker.js
import {
    BOARD_ROWS, BOARD_COLS,
    TERRAIN_LAND, TERRAIN_WATER, TERRAIN_TRAP,
    TERRAIN_PLAYER0_DEN, TERRAIN_PLAYER1_DEN,
    PLAYER0_DEN_ROW, PLAYER0_DEN_COL, PLAYER1_DEN_ROW, PLAYER1_DEN_COL,
    Player, // Import the Player object
    PIECES, // Import the PIECES definition
    GameStatus // Import GameStatus for terminal checks
} from './constants.js'; // Adjust path if needed (e.g., '../constants.js')

import {
    canCapture,
    getValidMovesForPiece, // Use this instead of getPossibleMoves
    getAllValidMoves,     // Use this instead of getAllPossibleMovesForPlayer
    getGameStatus,        // Use this instead of checkTerminalState
    isValidMove,          // Import if needed for TT move comparison etc.
    movesAreEqual,        // Import the shared version
    getEffectiveRank,     // Import if evaluateBoard needs it directly
    isRiver               // Import if evaluateBoard needs it directly
} from './rules.js';     // Adjust path if needed (e.g., '../rules.js')

// --- Constants ---
// Evaluation constants
const WIN_SCORE = 20000;
const LOSE_SCORE = -20000;

// Transposition Table constants
const HASH_EXACT = 0;
const HASH_LOWERBOUND = 1;
const HASH_UPPERBOUND = 2;

// Killer Move constants
const MAX_PLY_FOR_KILLERS = 20;

// --- Worker-Scoped State ---
let aiRunCounter = 0; // Counter for nodes visited during a search
let killerMoves = []; // Stores killer moves [ply][0/1]

// --- Zobrist Hashing & Transposition Table ---
const zobristTable = [];        // Stores random keys for each piece/player/square
let zobristBlackToMove;         // Random key for whose turn it is (AI's turn)
const pieceNameToIndex = {};    // Maps piece name ('rat') to index for zobristTable
let pieceIndexCounter = 0;      // Counter for assigning piece indices
let transpositionTable = new Map(); // Stores evaluated positions { hashKey: { score, depth, flag, bestMove } }

/** Generates a random 64-bit BigInt for Zobrist keys. */
function randomBigInt() {
    const low = BigInt(Math.floor(Math.random() * (2 ** 32)));
    const high = BigInt(Math.floor(Math.random() * (2 ** 32)));
    return (high << 32n) | low;
}

/** Initializes the Zobrist hashing keys. */
function initializeZobrist() {
    pieceIndexCounter = 0;
    for (const pieceKey in PIECES) { // Use imported PIECES
        const nameLower = pieceKey.toLowerCase();
        if (!pieceNameToIndex.hasOwnProperty(nameLower)) {
            pieceNameToIndex[nameLower] = pieceIndexCounter++;
            zobristTable[pieceNameToIndex[nameLower]] = [];
        }
        const index = pieceNameToIndex[nameLower];
        // Use imported Player constants
        zobristTable[index][Player.PLAYER0] = [];
        zobristTable[index][Player.PLAYER1] = [];
        for (let r = 0; r < BOARD_ROWS; r++) { // Use imported BOARD_ROWS
            zobristTable[index][Player.PLAYER0][r] = [];
            zobristTable[index][Player.PLAYER1][r] = [];
            for (let c = 0; c < BOARD_COLS; c++) { // Use imported BOARD_COLS
                zobristTable[index][Player.PLAYER0][r][c] = randomBigInt();
                zobristTable[index][Player.PLAYER1][r][c] = randomBigInt();
            }
        }
    }
    zobristBlackToMove = randomBigInt();
}
initializeZobrist();

/**
 * Computes the Zobrist hash key for a given board state and player to move.
 * @param {Array<Array<object>>} currentBoard - The board state.
 * @param {number} playerToMove - The player whose turn it is (PLAYER or AI).
 * @returns {bigint} The Zobrist hash key.
 */
function computeZobristKey(currentBoard, playerToMove) {
    let key = 0n; // Use BigInt for the key

    for (let r = 0; r < BOARD_ROWS; r++) { // Use imported BOARD_ROWS
        for (let c = 0; c < BOARD_COLS; c++) { // Use imported BOARD_COLS
            const square = currentBoard[r]?.[c];
            const piece = square?.piece; // Safe access

            if (piece && piece.name) { // Ensure piece and its name exist
                const pieceNameLower = piece.name.toLowerCase();
                const pieceIndex = pieceNameToIndex[pieceNameLower];

                // Validate indices and existence of the Zobrist key
                if (pieceIndex !== undefined &&
                    (piece.player === Player.PLAYER0 || piece.player === Player.PLAYER1) &&
                    r >= 0 && r < BOARD_ROWS &&
                    c >= 0 && c < BOARD_COLS &&
                    zobristTable[pieceIndex]?.[piece.player]?.[r]?.[c])
                {
                    try {
                        key ^= zobristTable[pieceIndex][piece.player][r][c]; // XOR with the piece's key
                    } catch (e) {
                        console.error(`[Worker] Error XORing Zobrist key: piece=${pieceNameLower}, player=${piece.player}, r=${r}, c=${c}, key=${key}`, e);
                        // Handle error gracefully if needed
                    }
                } else {
                    // Log skipped pieces if debugging Zobrist issues
                    console.warn(`[Worker] Zobrist Compute: Skipped invalid piece data or missing Zobrist entry`, { name: piece.name, player: piece.player, r: r, c: c, pI: pieceIndex });
                }
            }
        }
    }

    // XOR with the turn key if it's the AI's turn
    if (playerToMove === Player.PLAYER1) { // Assuming AI is Player 1
        key ^= zobristBlackToMove;
    }
    return key;
}

// --- Custom Error Class ---
class TimeLimitExceededError extends Error {
    constructor(message = "Timeout") {
        super(message);
        this.name = "TimeLimitExceededError";
    }
}

// --- Utility Functions ---
/**
 * Creates a deep clone of the board state.
 * @param {Array<Array<object>>} board - The board state to clone.
 * @returns {Array<Array<object>>} A new deep copy of the board state.
 */
function cloneBoard(board) {
    return board.map(row =>
        row.map(cell => ({
            terrain: cell.terrain,
            piece: cell.piece ? { ...cell.piece } : null // Clone piece object if exists
        }))
    );
}

// --- Movement Rules & Checks (Worker-Scoped) ---
// These functions mirror the game rules needed for the AI's simulation and evaluation.


/**
 * Simulates a move on a cloned board and calculates the new Zobrist hash.
 * @param {Array<Array<object>>} currentBoardState - The starting board state.
 * @param {object} move - The move object { fromRow, fromCol, toRow, toCol, pieceData }.
 * @param {bigint} currentHash - The Zobrist hash of the currentBoardState.
 * @returns {{ newBoard: Array<Array<object>>, newHash: bigint }}
 */
function simulateMoveAndGetHash(currentBoardState, move, currentHash) {
    const newBoard = cloneBoard(currentBoardState);
    const movingPiece = newBoard[move.fromRow]?.[move.fromCol]?.piece;

    if (!movingPiece) {
        console.warn("SimulateMove Error: No piece found at source", move);
        return { newBoard: newBoard, newHash: currentHash }; // Return original hash if move is invalid
    }

    const capturedPiece = newBoard[move.toRow]?.[move.toCol]?.piece;
    let newHash = currentHash;

    // Update Zobrist hash incrementally
    if (zobristTable.length > 0 && typeof BigInt === 'function') {
        try {
            const movingPieceIndex = pieceNameToIndex[movingPiece.name.toLowerCase()];
            const capturedPieceIndex = capturedPiece ? pieceNameToIndex[capturedPiece.name.toLowerCase()] : -1;

            // XOR out the moving piece from its original square
            const keyRemoveMover = (movingPieceIndex !== -1 && zobristTable[movingPieceIndex]?.[movingPiece.player]?.[move.fromRow]?.[move.fromCol])
                ? zobristTable[movingPieceIndex][movingPiece.player][move.fromRow][move.fromCol] : 0n;

            // XOR out the captured piece (if any) from the target square
            const keyRemoveCapture = (capturedPiece && capturedPieceIndex !== -1 && zobristTable[capturedPieceIndex]?.[capturedPiece.player]?.[move.toRow]?.[move.toCol])
                ? zobristTable[capturedPieceIndex][capturedPiece.player][move.toRow][move.toCol] : 0n;

            // XOR in the moving piece at its new square
            const keyAddMover = (movingPieceIndex !== -1 && zobristTable[movingPieceIndex]?.[movingPiece.player]?.[move.toRow]?.[move.toCol])
                ? zobristTable[movingPieceIndex][movingPiece.player][move.toRow][move.toCol] : 0n;

            // XOR keys for pieces and toggle the turn key
            newHash ^= keyRemoveMover ^ keyRemoveCapture ^ keyAddMover ^ zobristBlackToMove;

        } catch (e) {
            console.error("Error calculating simulated hash", e);
            // In case of error, might be safer to recompute hash from scratch, but for now return potentially incorrect hash
            return { newBoard: newBoard, newHash: currentHash };
        }
    }

    // Update the board state
    movingPiece.row = move.toRow; // Update piece's internal state (though maybe not needed in worker)
    movingPiece.col = move.toCol;
    newBoard[move.toRow][move.toCol].piece = movingPiece;
    newBoard[move.fromRow][move.fromCol].piece = null;

    return { newBoard: newBoard, newHash: newHash };
}

/** Records a killer move (a quiet move that caused a beta cutoff). */
function recordKillerMove(ply, move) {
    if (ply < 0 || ply >= MAX_PLY_FOR_KILLERS || !move) return;

    // Initialize array for the ply if it doesn't exist
    if (!killerMoves[ply]) {
        killerMoves[ply] = [null, null];
    }

    // Avoid recording the same move twice in a row
    if (movesAreEqual(move, killerMoves[ply][0])) return;

    // Shift the previous best killer move to the second slot
    killerMoves[ply][1] = killerMoves[ply][0];
    // Store the new killer move in the first slot
    killerMoves[ply][0] = move;
}


// --- Evaluation Function ---

/**
 * Evaluates the board state from the AI's perspective.
 * Higher scores are better for the AI.
 * @param {Array<Array<object>>} currentBoard - The board state to evaluate.
 * @returns {number} The evaluation score.
 */
function evaluateBoard(currentBoard) {
    // 1. Check for Terminal State (Win/Loss/Draw) using imported function
    const status = getGameStatus(currentBoard); // Use imported function
    // Check against imported GameStatus constants
    if (status === GameStatus.PLAYER1_WINS) return WIN_SCORE; // AI wins
    if (status === GameStatus.PLAYER0_WINS) return LOSE_SCORE; // AI loses
    if (status === GameStatus.DRAW) return 0; // Handle draw

    // 2. Heuristic Evaluation (if not terminal)
    const HEURISTIC_WEIGHTS = {
        MATERIAL: 1.0,
        ADVANCEMENT: 0.25,
        DEN_PROXIMITY: 6.0,
        ATTACK_THREAT: 1.5,
        JUMP_THREAT: 2.0,
        KEY_SQUARE: 0.5, // Placeholder
        TRAPPED_PENALTY: -3.0,
        DEFENSE_PENALTY: -0.7
    };

    let aiScore = 0;
    let playerScore = 0;
    // Use imported Player constants
    const piecesByPlayer = { [Player.PLAYER0]: [], [Player.PLAYER1]: [] };

    // Iterate through the board once to collect pieces and calculate basic scores
    for (let r = 0; r < BOARD_ROWS; r++) { // Use imported BOARD_ROWS
        for (let c = 0; c < BOARD_COLS; c++) { // Use imported BOARD_COLS
            const cell = currentBoard[r]?.[c];
            if (!cell) continue;
            const piece = cell.piece;
            if (!piece) continue;

            const player = piece.player;
            const pieceKey = piece.name.toLowerCase();
            // Use imported PIECES definition
            const value = PIECES[pieceKey]?.value ?? 0;

            // Store piece info for later heuristics
            piecesByPlayer[player].push({ ...piece, r, c, terrain: cell.terrain });

            // Determine which score to update based on imported Player
            let scoreRef = (player === Player.PLAYER1) ? aiScore : playerScore;

            // a) Material Score
            scoreRef += value * HEURISTIC_WEIGHTS.MATERIAL;

            // b) Advancement Score (scaled by piece value)
            // Use imported Player and BOARD_ROWS
            const advancement = (player === Player.PLAYER1) ? r : (BOARD_ROWS - 1 - r);
            scoreRef += advancement * HEURISTIC_WEIGHTS.ADVANCEMENT * (value / 150.0);

            // c) Defense Penalty
            if (pieceKey !== 'rat') {
                // Use imported Player and BOARD_ROWS
                if (player === Player.PLAYER1 && r < 3) {
                    scoreRef += (r - 3) * HEURISTIC_WEIGHTS.DEFENSE_PENALTY * (value / 100.0);
                }
                if (player === Player.PLAYER0 && r > (BOARD_ROWS - 1 - 3)) { // Generalize check
                    scoreRef += ((BOARD_ROWS - 1 - r) - 3) * HEURISTIC_WEIGHTS.DEFENSE_PENALTY * (value / 100.0);
                }
            }

            // d) Trapped Penalty - Use imported getEffectiveRank and TERRAIN_TRAP
            if (getEffectiveRank(piece, r, c, currentBoard) === 0 && cell.terrain === TERRAIN_TRAP) {
                scoreRef += HEURISTIC_WEIGHTS.TRAPPED_PENALTY * (value / 100.0);
            }

            // Update the correct player's score
            if (player === Player.PLAYER1) aiScore = scoreRef; else playerScore = scoreRef;
        }
    }

    // Check for wipeout (should be caught by terminal check, but safe)
    // Use imported Player constants
    if (piecesByPlayer[Player.PLAYER1].length === 0 && piecesByPlayer[Player.PLAYER0].length > 0) return LOSE_SCORE;
    if (piecesByPlayer[Player.PLAYER0].length === 0 && piecesByPlayer[Player.PLAYER1].length > 0) return WIN_SCORE;

    // 3. More Complex Heuristics (using collected pieces)

    // e) Den Proximity Bonus
    // Use imported Player, Den constants, PIECES
    piecesByPlayer[Player.PLAYER1].forEach(p => {
        const dist = Math.abs(p.r - PLAYER0_DEN_ROW) + Math.abs(p.c - PLAYER0_DEN_COL);
        const advancementFactor = (p.r >= Math.floor(BOARD_ROWS / 2)) ? 1.0 : 0.1;
        aiScore += Math.max(0, 15 - dist) * HEURISTIC_WEIGHTS.DEN_PROXIMITY * ((PIECES[p.name.toLowerCase()]?.value ?? 0) / 150.0) * advancementFactor;
    });
    piecesByPlayer[Player.PLAYER0].forEach(p => {
        const dist = Math.abs(p.r - PLAYER1_DEN_ROW) + Math.abs(p.c - PLAYER1_DEN_COL);
        const advancementFactor = (p.r <= Math.floor(BOARD_ROWS / 2)) ? 1.0 : 0.1;
        playerScore += Math.max(0, 15 - dist) * HEURISTIC_WEIGHTS.DEN_PROXIMITY * ((PIECES[p.name.toLowerCase()]?.value ?? 0) / 150.0) * advancementFactor;
    });

    // f) Attack Threat Bonus (pieces threatening opponent pieces)
    const calculateAttackThreat = (attackerPlayer, defenderPlayer) => {
        let threatBonus = 0;
        let jumpThreatBonus = 0; // *** NEW: For jump threats ***

        for (const attacker of piecesByPlayer[attackerPlayer]) {
            const attackerType = attacker.name.toLowerCase();

            // Regular orthogonal threats
            const potentialMoves = [
                { r: attacker.r - 1, c: attacker.c }, { r: attacker.r + 1, c: attacker.c },
                { r: attacker.r, c: attacker.c - 1 }, { r: attacker.r, c: attacker.c + 1 }
            ];
            for (const move of potentialMoves) {
                // Use imported BOARD_ROWS/COLS for bounds check
                if (move.r >= 0 && move.r < BOARD_ROWS && move.c >= 0 && move.c < BOARD_COLS) {
                    const targetPiece = currentBoard[move.r]?.[move.c]?.piece;
                    if (targetPiece?.player === defenderPlayer) {
                        const targetValue = PIECES[targetPiece.name.toLowerCase()]?.value ?? 0;
                        // Use imported canCapture
                        if (canCapture(attacker, targetPiece, attacker.r, attacker.c, move.r, move.c, currentBoard)) {
                            threatBonus += targetValue * HEURISTIC_WEIGHTS.ATTACK_THREAT / 100.0;
                        } else {
                            threatBonus += targetValue * (HEURISTIC_WEIGHTS.ATTACK_THREAT / 4.0) / 100.0; // Adjacent bonus
                        }
                    }
                }
            }

            // *** NEW: Jump Threats (Lion, Tiger) ***
             if (attackerType === 'lion' || attackerType === 'tiger') {
                 // --- Vertical Jump Check ---
                 // Use imported isRiver
                 if (isRiver(3, attacker.c)) {
                     if (attacker.r === 2) { // Check jump down target
                         jumpThreatBonus += checkJumpThreat(attacker, 6, attacker.c, [attacker.c, attacker.c, attacker.c], [3, 4, 5], currentBoard, defenderPlayer);
                     } else if (attacker.r === 6) { // Check jump up target
                         jumpThreatBonus += checkJumpThreat(attacker, 2, attacker.c, [attacker.c, attacker.c, attacker.c], [5, 4, 3], currentBoard, defenderPlayer);
                     }
                 }
                 // --- Horizontal Jump Check (Lion only) ---
                 if (attackerType === 'lion') {
                      if (isRiver(attacker.r, 1) && isRiver(attacker.r, 2)) { // River squares at col 1 and 2
                          if (attacker.c === 0) jumpThreatBonus += checkJumpThreat(attacker, attacker.r, 3, [1, 2], [attacker.r, attacker.r], currentBoard, defenderPlayer);
                          else if (attacker.c === 3) jumpThreatBonus += checkJumpThreat(attacker, attacker.r, 0, [1, 2], [attacker.r, attacker.r], currentBoard, defenderPlayer);
                      }
                      if (isRiver(attacker.r, 4) && isRiver(attacker.r, 5)) { // River squares at col 4 and 5
                          if (attacker.c === 3) jumpThreatBonus += checkJumpThreat(attacker, attacker.r, 6, [4, 5], [attacker.r, attacker.r], currentBoard, defenderPlayer);
                          else if (attacker.c === 6) jumpThreatBonus += checkJumpThreat(attacker, attacker.r, 3, [4, 5], [attacker.r, attacker.r], currentBoard, defenderPlayer);
                      }
                 }
             } // End jump check

        } // End loop attackers
        return threatBonus + (jumpThreatBonus * HEURISTIC_WEIGHTS.JUMP_THREAT / 100.0);
    };

    // *** NEW: Helper for jump threat calculation ***
    const checkJumpThreat = (attackerPiece, targetR, targetC, riverCols, riverRows, board, defenderPlayer) => {
        // Check path clear
        for (let i = 0; i < riverRows.length; i++) {
            if (!isRiver(riverRows[i], riverCols[i]) || board[riverRows[i]]?.[riverCols[i]]?.piece) {
                return 0; // Path blocked
            }
        }
        // Check target square
        if (targetR >= 0 && targetR < BOARD_ROWS && targetC >= 0 && targetC < BOARD_COLS) {
             const targetSquare = board[targetR]?.[targetC];
             const targetPiece = targetSquare?.piece;
             const targetTerrain = targetSquare?.terrain;
             // Cannot jump into water, or onto own piece (shouldn't happen for threat calc)
             if (targetTerrain === TERRAIN_WATER) return 0;

            if (targetPiece?.player === defenderPlayer) {
                // Use imported canCapture to see if the jump would capture
                if (canCapture(attackerPiece, targetPiece, attackerPiece.r, attackerPiece.c, targetR, targetC, board)) {
                    return PIECES[targetPiece.name.toLowerCase()]?.value ?? 0; // Return value of threatened piece
                }
            }
        }
        return 0; // No threat on this jump path
    };

    // Calculate threats using imported Player constants
    aiScore += calculateAttackThreat(Player.PLAYER1, Player.PLAYER0);
    playerScore += calculateAttackThreat(Player.PLAYER0, Player.PLAYER1);


    // g) Specific Piece Interaction Bonuses (e.g., Rat near Elephant)
    const findPiece = (type, player) => piecesByPlayer[player].find(p => p.name.toLowerCase() === type);

    // Use imported Player and TERRAIN_WATER
    const aiRat = findPiece('rat', Player.PLAYER1);
    const playerElephant = findPiece('elephant', Player.PLAYER0);
    if (aiRat && playerElephant && currentBoard[aiRat.r]?.[aiRat.c]?.terrain !== TERRAIN_WATER) {
        const dist = Math.abs(aiRat.r - playerElephant.r) + Math.abs(aiRat.c - playerElephant.c);
        if (dist <= 2) aiScore += (3 - dist) * 3.0;
    }

    const playerRat = findPiece('rat', Player.PLAYER0);
    const aiElephant = findPiece('elephant', Player.PLAYER1);
    if (playerRat && aiElephant && currentBoard[playerRat.r]?.[playerRat.c]?.terrain !== TERRAIN_WATER) {
        const dist = Math.abs(playerRat.r - aiElephant.r) + Math.abs(playerRat.c - aiElephant.c);
        if (dist <= 2) playerScore += (3 - dist) * 3.0;
    }

    // Final score is difference
    return aiScore - playerScore;
}


// --- AlphaBeta Search ---

/**
 * Performs Alpha-Beta search for the best move score.
 * @param {Array<Array<object>>} currentBoard - Current board state.
 * @param {bigint} currentHash - Zobrist hash of the current board state.
 * @param {number} depth - Remaining search depth.
 * @param {number} alpha - Alpha value (best score for maximizer found so far).
 * @param {number} beta - Beta value (best score for minimizer found so far).
 * @param {boolean} isMaximizingPlayer - True if the current player is maximizing (AI), false otherwise.
 * @param {number} startTime - Timestamp when the search started.
 * @param {number} timeLimit - Maximum allowed time in milliseconds.
 * @param {number} ply - Current ply depth from the root (for killer moves).
 * @returns {number} The evaluated score for the current node.
 * @throws {TimeLimitExceededError} If the time limit is reached.
 */
function alphaBeta(currentBoard, currentHash, depth, alpha, beta, isMaximizingPlayer, startTime, timeLimit, ply) {
    aiRunCounter++;

    if (performance.now() - startTime > timeLimit) {
        throw new TimeLimitExceededError();
    }

    const originalAlpha = alpha;
    const hashKey = currentHash;

    // 1. Transposition Table Lookup (logic remains similar)
    const ttEntry = transpositionTable.get(hashKey);
    if (ttEntry && ttEntry.depth >= depth) {
        if (ttEntry.flag === HASH_EXACT) return ttEntry.score;
        if (ttEntry.flag === HASH_LOWERBOUND) alpha = Math.max(alpha, ttEntry.score);
        if (ttEntry.flag === HASH_UPPERBOUND) beta = Math.min(beta, ttEntry.score);
        if (alpha >= beta) return ttEntry.score;
    }

    // 2. Terminal State Check & Base Case (Depth 0)
    // Use imported getGameStatus and GameStatus constants
    const status = getGameStatus(currentBoard);
    const isTerminal = (status !== GameStatus.ONGOING);
    if (isTerminal || depth === 0) {
        let baseScore = evaluateBoard(currentBoard); // Call adapted evaluateBoard
        if (isTerminal && status !== GameStatus.DRAW) {
            const MATE_DEPTH_BONUS = 10;
            // Use imported GameStatus constants and check AI player
            if (status === GameStatus.PLAYER1_WINS) baseScore += depth * MATE_DEPTH_BONUS;
            if (status === GameStatus.PLAYER0_WINS) baseScore -= depth * MATE_DEPTH_BONUS;
        }
        // Store leaf node evaluation in TT (logic remains similar)
        if (!ttEntry || ttEntry.depth < depth) {
             transpositionTable.set(hashKey, { score: baseScore, depth: depth, flag: HASH_EXACT, bestMove: null });
        }
        return baseScore;
    }

    // 3. Generate and Order Moves
    // Determine player using imported Player constants (AI = Player 1)
    const playerToMove = isMaximizingPlayer ? Player.PLAYER1 : Player.PLAYER0;
    let moves;
    try {
        // Use imported getAllValidMoves
        moves = getAllValidMoves(playerToMove, currentBoard);
    } catch (e) {
        console.error(`Error generating moves for player ${playerToMove}`, e);
        return isMaximizingPlayer ? -Infinity : Infinity;
    }

    // If no moves available, it's a stalemate/loss for the current player
    if (moves.length === 0) {
        // Re-evaluate board, could be win for opponent if pieces captured
        // Or check status again if needed, evaluateBoard handles terminal states now
        return evaluateBoard(currentBoard);
    }

    // Move Ordering Heuristics
    const hashMove = ttEntry?.bestMove;
    const killerMove1 = (ply >= 0 && ply < MAX_PLY_FOR_KILLERS) ? killerMoves[ply]?.[0] : null;
    const killerMove2 = (ply >= 0 && ply < MAX_PLY_FOR_KILLERS) ? killerMoves[ply]?.[1] : null;

    moves.forEach(move => {
        move.orderScore = 0;
        // Use imported movesAreEqual for comparison
        if (hashMove && movesAreEqual(move, hashMove)) {
            move.orderScore = 20000;
        } else if (killerMove1 && movesAreEqual(move, killerMove1)) {
            move.orderScore = 19000;
        } else if (killerMove2 && movesAreEqual(move, killerMove2)) {
            move.orderScore = 18000;
        } else {
            // Use imported PIECES for values
            const targetPiece = currentBoard[move.toRow]?.[move.toCol]?.piece;
            if (targetPiece) {
                 const victimValue = PIECES[targetPiece.name.toLowerCase()]?.value ?? 0;
                 const attackerValue = PIECES[move.pieceData?.name?.toLowerCase()]?.value ?? 0;
                 move.orderScore = 1000 + victimValue - attackerValue;
            } else {
                // Use imported Player and Den constants
                 const opponentDenRow = (playerToMove === Player.PLAYER1) ? PLAYER0_DEN_ROW : PLAYER1_DEN_ROW;
                 const currentDist = Math.abs(move.fromRow - opponentDenRow);
                 const newDist = Math.abs(move.toRow - opponentDenRow);
                 if (newDist < currentDist) move.orderScore += 5;
            }
        }
    });
    moves.sort((a, b) => b.orderScore - a.orderScore);

    // 4. Iterate Through Moves and Recurse
    let bestMoveForNode = null;
    let bestScore = isMaximizingPlayer ? -Infinity : Infinity;

    for (const move of moves) {
        const isCapture = !!currentBoard[move.toRow]?.[move.toCol]?.piece;
        let simResult;
        try {
            // simulateMoveAndGetHash needs to be checked for constant usage too
            simResult = simulateMoveAndGetHash(currentBoard, move, currentHash);
        } catch (e) { /* ... error handling ... */ continue; }

        let evalScore;
        try {
            evalScore = alphaBeta(
                simResult.newBoard, simResult.newHash,
                depth - 1, alpha, beta,
                !isMaximizingPlayer, // Toggle player
                startTime, timeLimit, ply + 1
            );
        } catch (e) {
            if (e instanceof TimeLimitExceededError) throw e;
             console.error("Error during recursive alphaBeta call", e);
            evalScore = isMaximizingPlayer ? -Infinity : Infinity;
        }

        // Update best score and alpha/beta based on maximizing/minimizing player
        if (isMaximizingPlayer) { // AI's turn (Player 1)
            if (evalScore > bestScore) { bestScore = evalScore; bestMoveForNode = move; }
            alpha = Math.max(alpha, bestScore);
            if (beta <= alpha) { // Beta Pruning
                if (!isCapture) recordKillerMove(ply, move);
                break;
            }
        } else { // Opponent's turn (Player 0)
            if (evalScore < bestScore) { bestScore = evalScore; bestMoveForNode = move; }
            beta = Math.min(beta, bestScore);
            if (beta <= alpha) { // Alpha Pruning
                if (!isCapture) recordKillerMove(ply, move);
                break;
            }
        }
    } // End move loop

    // 5. Store Result in Transposition Table
    let flag;
    if (bestScore <= originalAlpha) flag = HASH_UPPERBOUND;
    else if (bestScore >= beta) flag = HASH_LOWERBOUND;
    else flag = HASH_EXACT;

    if (!ttEntry || depth >= ttEntry.depth || flag === HASH_EXACT) {
         const bestMoveData = bestMoveForNode ? {
             fromRow: bestMoveForNode.fromRow, fromCol: bestMoveForNode.fromCol,
             toRow: bestMoveForNode.toRow, toCol: bestMoveForNode.toCol
         } : null;
        transpositionTable.set(hashKey, { score: bestScore, depth: depth, flag: flag, bestMove: bestMoveData });
    }

    return bestScore;
}


// --- Iterative Deepening Driver ---

/**
 * Finds the best move using Iterative Deepening Alpha-Beta search.
 * @param {Array<Array<object>>} currentBoard - The current board state.
 * @param {number} maxDepth - The maximum target search depth.
 * @param {number} timeLimit - The maximum time allowed in milliseconds.
 * @returns {object} Result object: { move, depthAchieved, nodes, eval, error? }
 */
function findBestMove(currentBoard, maxDepth, timeLimit) {
    const startTime = performance.now();
    aiRunCounter = 0;
    transpositionTable.clear();
    killerMoves = Array(MAX_PLY_FOR_KILLERS).fill(null).map(() => [null, null]);

    let bestMoveOverall = null;
    let lastCompletedDepth = 0;
    let bestScoreOverall = -Infinity; // AI aims to maximize

    // Get initial possible moves using imported function and constant (AI = Player 1)
    let rootMoves;
    try {
        rootMoves = getAllValidMoves(Player.PLAYER1, currentBoard);
    } catch (e) {
        console.error("[Worker] Error getting initial moves:", e);
        return { move: null, depthAchieved: 0, nodes: 0, eval: null, error: "Move gen error" };
    }

    if (rootMoves.length === 0) {
        console.warn("[Worker] No moves available for AI.");
        return { move: null, depthAchieved: 0, nodes: 0, eval: null, error: "No moves available" };
    }

    // Calculate initial hash using imported constant (AI = Player 1)
    const initialHash = computeZobristKey(currentBoard, Player.PLAYER1);

    // Set a default best move (the first legal one)
    const firstMove = rootMoves[0];
    const firstMovePiece = currentBoard[firstMove.fromRow]?.[firstMove.fromCol]?.piece;
    if (firstMovePiece) {
        bestMoveOverall = {
            pieceName: firstMovePiece.name, // Send identifying info back
            fromRow: firstMove.fromRow, fromCol: firstMove.fromCol,
            toRow: firstMove.toRow, toCol: firstMove.toCol
        };
    } else {
         console.error("[Worker] Failed to get piece for the first move.");
         // Attempt fallback if more moves exist? Or return error immediately.
         // For now, return error.
         return { move: null, depthAchieved: 0, nodes: 0, eval: null, error: "Fallback piece missing" };
    }


    try {
        // Iterative Deepening Loop
        for (let currentDepth = 1; currentDepth <= maxDepth; currentDepth++) {
            const timeBeforeIter = performance.now();
            const timeElapsed = timeBeforeIter - startTime;

            if (timeElapsed > timeLimit) { /* ... timeout log ... */ break; }

            let bestScoreThisIteration = -Infinity;
            let bestMoveThisIteration = null;
            let alpha = -Infinity, beta = Infinity; // Reset alpha/beta for root search

            // --- Root Move Ordering ---
             const ttEntryRoot = transpositionTable.get(initialHash);
             const hashMoveRoot = ttEntryRoot?.bestMove;
             if (hashMoveRoot) {
                 // Use imported movesAreEqual
                 const idx = rootMoves.findIndex(m => movesAreEqual(m, hashMoveRoot));
                 if (idx > 0) { rootMoves.unshift(rootMoves.splice(idx, 1)[0]); }
             } else {
                 // Simple ordering using imported PIECES, PLAYER0_DEN_ROW
                 rootMoves.forEach(move => {
                     const tp = currentBoard[move.toRow]?.[move.toCol]?.piece;
                     move.orderScore = 0;
                     if (tp) { // Capture heuristic
                         move.orderScore = 1000 + (PIECES[tp.name.toLowerCase()]?.value ?? 0) - (PIECES[move.pieceData?.name?.toLowerCase()]?.value ?? 0);
                     }
                     // Advancement heuristic (simple version)
                     const opponentDenRow = PLAYER0_DEN_ROW; // AI is P1, opponent den is P0
                     if (move.toRow > move.fromRow) move.orderScore += 5;
                 });
                 rootMoves.sort((a, b) => b.orderScore - a.orderScore);
             }
            // Ensure a default move for the iteration is set
            if (!bestMoveThisIteration && rootMoves.length > 0) {
                const fm = rootMoves[0];
                const fp = currentBoard[fm.fromRow]?.[fm.fromCol]?.piece;
                if(fp) bestMoveThisIteration = { pieceName: fp.name, fromRow: fm.fromRow, fromCol: fm.fromCol, toRow: fm.toRow, toCol: fm.toCol };
            }


            // Search each root move
            for (const move of rootMoves) {
                const pieceToMove = currentBoard[move.fromRow]?.[move.fromCol]?.piece;
                if (!pieceToMove) continue; // Safety check

                let simResult;
                try {
                    simResult = simulateMoveAndGetHash(currentBoard, move, initialHash);
                } catch (e) { /* ... error handling ... */ continue; }

                // Call alphaBeta for the opponent's turn (minimizing player = Player 0)
                const score = alphaBeta(
                    simResult.newBoard, simResult.newHash,
                    currentDepth - 1, // Depth for the recursive call
                    alpha, beta,
                    false, // It's opponent's turn (minimizing)
                    startTime, timeLimit,
                    0 // Ply starts at 0 for root moves' children
                );

                // Check timeout *after* the call returns
                 if (performance.now() - startTime > timeLimit) { /* ... timeout log ... */ }

                // Since this is the root, we are MAXIMIZING over the results
                if (score > bestScoreThisIteration) {
                    bestScoreThisIteration = score;
                    // Store necessary info for the move to be returned
                    bestMoveThisIteration = {
                        pieceName: pieceToMove.name,
                        fromRow: move.fromRow, fromCol: move.fromCol,
                        toRow: move.toRow, toCol: move.toCol
                    };
                }
                // Update alpha for the root search window
                alpha = Math.max(alpha, score);

                // Optional: Root level beta cutoff (if alpha >= beta) - less common
                // if (alpha >= beta) { break; }
            } // End loop through root moves

            const timeAfterIter = performance.now();
            const totalTimeElapsed = timeAfterIter - startTime;

            // Check time limit again after completing the iteration
            if (totalTimeElapsed > timeLimit) { /* ... timeout log ... */ break; }

            // If the iteration completed within time, update the overall best move
            lastCompletedDepth = currentDepth;
            if (bestMoveThisIteration) { bestMoveOverall = bestMoveThisIteration; }
            bestScoreOverall = bestScoreThisIteration;

            // Check for early exit if a winning/losing score is found reliably
             if (bestScoreOverall > LOSE_SCORE * 0.9 && (bestScoreOverall >= WIN_SCORE * 0.9 || bestScoreOverall <= LOSE_SCORE * 0.9)) {
                 /* ... early exit log ... */
                 break;
             }

        } // End Iterative Deepening Loop

    } catch (error) {
        if (!(error instanceof TimeLimitExceededError)) {
            console.error("[Worker IDS] Unexpected search error:", error);
             return { /* return previous best if possible + error */ };
        }
        console.log("[Worker IDS] Time limit exceeded, returning best move found so far.");
    }

    // Fallback if somehow no move was ever selected
    if (!bestMoveOverall && rootMoves.length > 0) {
        console.warn("[Worker IDS] Timeout/Error resulted in no best move. Using first legal move.");
        const fm = rootMoves[0];
        const fp = currentBoard[fm.fromRow]?.[fm.fromCol]?.piece;
        if (fp) { bestMoveOverall = { /* ... format move ... */ }; }
        else { return { /* return error */ }; }
    }

     const finalDuration = performance.now() - startTime;
     console.log(`[Worker] findBestMove finished. Depth: ${lastCompletedDepth}. Time: ${finalDuration.toFixed(0)}ms. Eval: ${bestScoreOverall?.toFixed(2)}`);

    // Return the result object
    return {
        move: bestMoveOverall, // Contains { pieceName, fromRow, fromCol, toRow, toCol }
        depthAchieved: lastCompletedDepth,
        nodes: aiRunCounter,
        eval: bestScoreOverall === -Infinity ? null : bestScoreOverall
    };
}

// --- Worker Message Handler ---
self.onmessage = function(e) {
    const { boardState, targetDepth, timeLimit } = e.data;

    // Basic validation of incoming data
    if (boardState && typeof targetDepth === 'number' && typeof timeLimit === 'number') {
        try {
            // Start the AI calculation
            const result = findBestMove(boardState, targetDepth, timeLimit);
            // Send the result back to the main thread
            self.postMessage(result);
        } catch (error) {
            // Catch unexpected errors during findBestMove itself (should be rare)
            console.error("[Worker] Uncaught error during findBestMove:", error);
            self.postMessage({
                move: null,
                depthAchieved: 0, // Indicate failure
                nodes: aiRunCounter,
                eval: null,
                error: error.message || "Worker execution error"
            });
        }
    } else {
        // Handle invalid data received from the main thread
        console.error("[Worker] Invalid message data received:", e.data);
        self.postMessage({
            move: null,
            depthAchieved: 0,
            nodes: 0,
            eval: null,
            error: "Invalid data received by worker"
        });
    }
};

// --- END OF js/aiWorker.js ---