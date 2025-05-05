// aiWorker.js
import {
    BOARD_ROWS, BOARD_COLS,
    TERRAIN_LAND, TERRAIN_WATER, TERRAIN_TRAP,
    TERRAIN_PLAYER0_DEN, TERRAIN_PLAYER1_DEN,
    PLAYER0_DEN_ROW, PLAYER0_DEN_COL, PLAYER1_DEN_ROW, PLAYER1_DEN_COL,
    Player, // Import the Player object
    PIECES, // Import the PIECES definition
    GameStatus // Import GameStatus for terminal checks
} from './constants.js'; // Adjust path if needed

import {
    getAllValidMoves,
    getGameStatus,
    movesAreEqual,
} from './rules.js';

import { evaluateBoard, WIN_SCORE, LOSE_SCORE, DRAW_SCORE } from './aiEvaluate.js'; // Import DRAW_SCORE
import { initializeZobrist, computeZobristKey, pieceNameToIndex, zobristTable, zobristBlackToMove } from './zobrist.js'; // Import from shared module


// --- Constants ---

// Transposition Table constants
const HASH_EXACT = 0;
const HASH_LOWERBOUND = 1;
const HASH_UPPERBOUND = 2;

// Killer Move constants
const MAX_PLY_FOR_KILLERS = 20;

// --- Worker-Scoped State ---
let aiRunCounter = 0; // Counter for nodes visited during a search
let killerMoves = []; // Stores killer moves [ply][0/1]
let transpositionTable = new Map(); // Stores evaluated positions { hashKey: { score, depth, flag, bestMove } }

initializeZobrist(); // Initialize Zobrist keys on worker start using imported function

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

    // Update Zobrist hash incrementally using imported tables/functions
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
 * @param {Map<bigint, number>} pathHashes - Map tracking hash counts along the current search path.
 * @returns {number} The evaluated score for the current node.
 * @throws {TimeLimitExceededError} If the time limit is reached.
 */
function alphaBeta(currentBoard, currentHash, depth, alpha, beta, isMaximizingPlayer, startTime, timeLimit, ply, pathHashes) {
    aiRunCounter++;

    if (performance.now() - startTime > timeLimit) {
        throw new TimeLimitExceededError();
    }

    const originalAlpha = alpha;
    const hashKey = currentHash;

    // --- Repetition Check (Draw by 3-fold repetition in search path) ---
    if (pathHashes.get(hashKey) >= 3) {
        // console.log(`[Worker AlphaBeta D${ply}] Repetition detected: ${hashKey}`);
        return DRAW_SCORE; // Return draw score if this state repeated 3 times in path
    }

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
        } else if (status === GameStatus.DRAW) {
            baseScore = DRAW_SCORE; // Explicitly set draw score if terminal state is DRAW
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
        // --- Prepare for recursive call: Update pathHashes map ---
        const nextPathHashes = new Map(pathHashes); // Copy current path map
        const nextCount = (nextPathHashes.get(simResult.newHash) || 0) + 1;
        nextPathHashes.set(simResult.newHash, nextCount);
        // --- End pathHashes update ---
        try {
            evalScore = alphaBeta(
                simResult.newBoard, simResult.newHash,
                depth - 1, alpha, beta,
                !isMaximizingPlayer, // Toggle player
                startTime, timeLimit, ply + 1,
                nextPathHashes // Pass the updated map
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
    aiRunCounter = 0; // Reset node counter for this search
    transpositionTable.clear(); // Clear TT for new search
    killerMoves = Array(MAX_PLY_FOR_KILLERS).fill(null).map(() => [null, null]); // Clear killer moves

    let bestMoveOverall = null;
    let lastCompletedDepth = 0;
    let bestScoreOverall = -Infinity; // AI aims to maximize

    // Get initial possible moves for the root node (AI = Player 1)
    let rootMoves;
    try {
        rootMoves = getAllValidMoves(Player.PLAYER1, currentBoard);
    } catch (e) {
        console.error("[Worker] Error getting initial moves:", e);
        return { move: null, depthAchieved: 0, nodes: aiRunCounter, eval: null, error: "Move gen error" };
    }

    if (rootMoves.length === 0) {
        console.warn("[Worker] No moves available for AI.");
        return { move: null, depthAchieved: 0, nodes: aiRunCounter, eval: null, error: "No moves available" };
    }

    // Calculate initial hash for the root position (AI = Player 1)
    // Use imported computeZobristKey
    const initialHash = computeZobristKey(currentBoard, Player.PLAYER1);
    const initialPathHashes = new Map([[initialHash, 1]]); // Initialize path map for root

    // Set a default best move (the first legal one)
    const firstMove = rootMoves[0];
    const firstMovePiece = currentBoard[firstMove.fromRow]?.[firstMove.fromCol]?.piece;
    if (firstMovePiece) {
        bestMoveOverall = {
            pieceName: firstMovePiece.name,
            fromRow: firstMove.fromRow, fromCol: firstMove.fromCol,
            toRow: firstMove.toRow, toCol: firstMove.toCol
        };
    } else {
         console.error("[Worker] Failed to get piece for the first move.");
         return { move: null, depthAchieved: 0, nodes: aiRunCounter, eval: null, error: "Fallback piece missing" };
    }


    try {
        // Iterative Deepening Loop
        for (let currentDepth = 1; currentDepth <= maxDepth; currentDepth++) {
            const timeBeforeIter = performance.now();
            const timeElapsed = timeBeforeIter - startTime;

            // Check time limit before starting the iteration
            if (timeElapsed > timeLimit) {
                console.log(`[Worker IDS] Timeout BEFORE starting Depth ${currentDepth}`);
                break;
            }

            let bestScoreThisIteration = -Infinity;
            let bestMoveThisIteration = null;
            let alpha = -Infinity, beta = Infinity; // Reset alpha/beta for each root iteration

            // --- Root Move Ordering ---
             const ttEntryRoot = transpositionTable.get(initialHash);
             const hashMoveRoot = ttEntryRoot?.bestMove;

             if (hashMoveRoot) {
                 // Prioritize the move from the Transposition Table
                 const idx = rootMoves.findIndex(m => movesAreEqual(m, hashMoveRoot));
                 if (idx > 0) {
                     // Move the hash move to the front
                     rootMoves.unshift(rootMoves.splice(idx, 1)[0]);
                 }
             } else {
                 // If no hash move, apply simple ordering: Captures > Advancement towards den
                 rootMoves.forEach(move => {
                     const targetPiece = currentBoard[move.toRow]?.[move.toCol]?.piece;
                     move.orderScore = 0; // Reset score for this iteration's ordering

                     // 1. Capture Bonus (MVV-LVA style)
                     if (targetPiece) {
                         const victimValue = PIECES[targetPiece.name.toLowerCase()]?.value ?? 0;
                         const attackerValue = PIECES[move.pieceData?.name?.toLowerCase()]?.value ?? 0;
                         move.orderScore += 10000 + victimValue - attackerValue; // High base score for captures
                     }

                     // 2. Advancement Bonus (Getting closer to opponent den)
                     // *** USE opponentDenRow HERE ***
                     const opponentDenRow = PLAYER0_DEN_ROW; // AI is P1, opponent den is P0 (at row 8)
                     const currentDist = Math.abs(move.fromRow - opponentDenRow);
                     const newDist = Math.abs(move.toRow - opponentDenRow);
                     if (newDist < currentDist) {
                         move.orderScore += 10; // Add a small bonus for getting closer
                     }
                     // Optional: Penalize moving away?
                     // else if (newDist > currentDist) {
                     //    move.orderScore -= 5;
                     // }
                 });
                 // Sort moves based on calculated orderScore (descending)
                 rootMoves.sort((a, b) => b.orderScore - a.orderScore);
             } // End simple ordering

            // Ensure a default move is selected for the iteration if sorting happened
            if (!bestMoveThisIteration && rootMoves.length > 0) {
                const fm = rootMoves[0];
                const fp = currentBoard[fm.fromRow]?.[fm.fromCol]?.piece;
                // Ensure piece exists before assigning
                if(fp) bestMoveThisIteration = { pieceName: fp.name, fromRow: fm.fromRow, fromCol: fm.fromCol, toRow: fm.toRow, toCol: fm.toCol };
                else bestMoveThisIteration = bestMoveOverall; // Fallback to previous best if first move somehow invalid
            }


            // Search each root move
            for (const move of rootMoves) {
                const pieceToMove = currentBoard[move.fromRow]?.[move.fromCol]?.piece;
                if (!pieceToMove) continue; // Safety check

                let simResult;
                try {
                    simResult = simulateMoveAndGetHash(currentBoard, move, initialHash);
                } catch (e) {
                    console.error("[Worker] Root SimHash Error", e);
                    continue; // Skip move if simulation fails
                }

                // --- Prepare for root alphaBeta call: Update pathHashes map ---
                const rootNextPathHashes = new Map(initialPathHashes); // Start from root path map
                const rootNextCount = (rootNextPathHashes.get(simResult.newHash) || 0) + 1;
                rootNextPathHashes.set(simResult.newHash, rootNextCount);

                // Call alphaBeta for the opponent's turn (minimizing player = Player 0)
                let score; // Declare score outside try block
                try {
                    score = alphaBeta(
                        simResult.newBoard, simResult.newHash,
                        currentDepth - 1,
                        alpha, beta,
                        false, // It's opponent's turn (minimizing)
                        startTime, timeLimit,
                        0, // Ply starts at 0 for root moves' children
                        rootNextPathHashes // Pass the updated map for the move
                    );
                } catch (e) {
                    if (e instanceof TimeLimitExceededError) throw e; // Propagate timeout
                    console.error("Error during root alphaBeta call", e);
                    score = -Infinity; // Assign worst score on other errors
                }


                // Check timeout *after* the call returns (it might throw)
                 if (performance.now() - startTime > timeLimit) {
                     console.log(`[Worker IDS] Timeout during alphaBeta call for move at D${currentDepth}`);
                     // Don't necessarily trust the score if timeout happened during the call.
                     // Consider breaking the inner loop here if strict time adherence is needed.
                     // break;
                 }


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

                // Optional: Root level beta cutoff (less common, but possible)
                // if (alpha >= beta) { break; }
            } // End loop through root moves

            const timeAfterIter = performance.now();
            const totalTimeElapsed = timeAfterIter - startTime;

            // Check time limit again after completing the iteration
            if (totalTimeElapsed > timeLimit) {
                console.log(`[Worker IDS] Timeout AFTER finishing Depth ${currentDepth}`);
                break; // Exit IDS loop
            }

            // If the iteration completed within time, update the overall best move/score
            lastCompletedDepth = currentDepth;
            if (bestMoveThisIteration) { // Ensure a valid move was found in this iteration
                bestMoveOverall = bestMoveThisIteration;
            } else if (bestMoveOverall === null && rootMoves.length > 0) {
                 // Extremely rare case: Iteration finished, time ok, but no move better than -Infinity?
                 // Use the default sorted first move as fallback.
                 const fm = rootMoves[0];
                 const fp = currentBoard[fm.fromRow]?.[fm.fromCol]?.piece;
                 if(fp) bestMoveOverall = { pieceName: fp.name, fromRow: fm.fromRow, fromCol: fm.fromCol, toRow: fm.toRow, toCol: fm.toCol };
                 console.warn("[Worker IDS] No improvement found in iteration, using sorted first move.");
            }
            bestScoreOverall = bestScoreThisIteration;


            // Check for early exit if a winning/losing score is found reliably
            // Assumes WIN_SCORE and LOSE_SCORE are imported or accessible
             if (bestScoreOverall > LOSE_SCORE * 0.9 && (bestScoreOverall >= WIN_SCORE * 0.9 || bestScoreOverall <= LOSE_SCORE * 0.9)) {
                 console.log(`[Worker IDS] Early exit: Score ${bestScoreOverall.toFixed(0)} indicates win/loss at Depth ${currentDepth}.`);
                 break; // Exit IDS loop
             }
             // Also check for definite draw score if that's useful
             if (bestScoreOverall === DRAW_SCORE) {
                 console.log(`[Worker IDS] Early exit: Score ${bestScoreOverall} indicates forced draw at Depth ${currentDepth}.`);
                 // Decide whether to break here or keep searching for a potential win/loss at deeper levels
                 // break; // Optional: break on finding a certain draw
             }

        } // End Iterative Deepening Loop

    } catch (error) {
        if (!(error instanceof TimeLimitExceededError)) {
            console.error("[Worker IDS] Unexpected search error:", error);
             // Return previous best move if available, along with error message
             return {
                 move: bestMoveOverall, // Send previous best if possible
                 depthAchieved: lastCompletedDepth,
                 nodes: aiRunCounter,
                 eval: bestScoreOverall,
                 error: error.message || "IDS Error"
             };
        }
        // Timeouts are expected, just fall through to return current best
        console.log("[Worker IDS] Time limit exceeded, returning best move found so far.");
    }

    // Fallback if somehow no move was ever selected (e.g., immediate timeout at depth 1)
    if (!bestMoveOverall && rootMoves.length > 0) {
        console.warn("[Worker IDS] Timeout/Error resulted in no best move. Using first legal move.");
        const fm = rootMoves[0];
        const fp = currentBoard[fm.fromRow]?.[fm.fromCol]?.piece;
        if (fp) {
             bestMoveOverall = { pieceName: fp.name, fromRow: fm.fromRow, fromCol: fm.fromCol, toRow: fm.toRow, toCol: fm.toCol };
        } else {
             // This should be extremely rare if initial checks passed
             return { move: null, depthAchieved: lastCompletedDepth, nodes: aiRunCounter, eval: bestScoreOverall, error: "Fallback Fail" };
        }
    }

     const finalDuration = performance.now() - startTime;
     console.log(`[Worker] findBestMove finished. Depth: ${lastCompletedDepth}. Nodes: ${aiRunCounter}. Time: ${finalDuration.toFixed(0)}ms. Eval: ${bestScoreOverall?.toFixed(2)}`);

    // Return the result object
    return {
        move: bestMoveOverall,
        depthAchieved: lastCompletedDepth,
        nodes: aiRunCounter, // Return node count
        eval: bestScoreOverall === -Infinity ? null : bestScoreOverall // Return null eval if search didn't complete depth 1
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