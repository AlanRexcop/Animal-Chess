// js/ai.worker.js

// --- Imports for the Worker ---
// These imports bring in the necessary definitions and logic
// from other modules into the worker's scope.
import {
    Player, PieceData, BOARD_ROWS, BOARD_COLS, TerrainType, Dens,
    WIN_SCORE, LOSE_SCORE, ZOBRIST_HASH_FLAGS, GameStatus
} from './constants.js';
import { Board } from './board.js'; // Board class needed for temporary instances
import { Piece } from './piece.js'; // Piece class needed for type info (though not passed back directly)
import {
    getAllPossibleMovesForPlayer, checkGameStatus, getEffectiveRank, canCapture
} from './rules.js'; // Core rule functions used by AI

// --- Zobrist Hashing ---
// These functions and variables manage the Zobrist hashing for transposition table keys.
const zobristTable = [];
let zobristBlackToMove = 0n;
const pieceNameToIndex = {};
let pieceIndexCounter = 0;

/** Generates a random 64-bit BigInt */
function randomBigInt() {
    const low = BigInt(Math.floor(Math.random() * (2 ** 32)));
    const high = BigInt(Math.floor(Math.random() * (2 ** 32)));
    return (high << 32n) | low;
}

/** Initializes the Zobrist hash table with random keys. Called before search usually. */
function initializeZobrist() {
    // console.log("Worker: Initializing Zobrist table..."); // Optional log
    zobristTable.length = 0;
    pieceIndexCounter = 0;
    Object.keys(pieceNameToIndex).forEach(key => delete pieceNameToIndex[key]);

    for (const pieceType in PieceData) {
         if (!pieceNameToIndex.hasOwnProperty(pieceType)) {
            pieceNameToIndex[pieceType] = pieceIndexCounter++;
            zobristTable[pieceNameToIndex[pieceType]] = [];
        }
        const idx = pieceNameToIndex[pieceType];
        zobristTable[idx][Player.PLAYER0] = [];
        zobristTable[idx][Player.PLAYER1] = [];

        for (let r = 0; r < BOARD_ROWS; r++) {
            zobristTable[idx][Player.PLAYER0][r] = [];
            zobristTable[idx][Player.PLAYER1][r] = [];
            for (let c = 0; c < BOARD_COLS; c++) {
                zobristTable[idx][Player.PLAYER0][r][c] = randomBigInt();
                zobristTable[idx][Player.PLAYER1][r][c] = randomBigInt();
            }
        }
    }
    zobristBlackToMove = randomBigInt();
    // console.log("Worker: Zobrist table initialized."); // Optional log
}

/** Computes the Zobrist key for a given board state (raw array) and player to move. */
function computeZobristKey(boardState, playerToMove) {
    let key = 0n;
    for (let r = 0; r < BOARD_ROWS; r++) {
        for (let c = 0; c < BOARD_COLS; c++) {
            const cell = boardState[r]?.[c];
            const piece = cell?.piece;
            if (piece) {
                const pieceType = piece.type;
                const piecePlayer = piece.player; // Get player value
                const pieceTypeIndex = pieceNameToIndex[pieceType];

                key ^= zobristTable[pieceTypeIndex][piecePlayer][r][c];

            }
        }
    }

    if (playerToMove === Player.PLAYER1) {
        key ^= zobristBlackToMove;
    }
    return key;
}

/** Incrementally updates the Zobrist key based on a move. */
function updateZobristKey(currentKey, playerMoving, movedPiece, fromRow, fromCol, toRow, toCol, capturedPiece) {
     let newKey = currentKey;
     const moverIndex = pieceNameToIndex[movedPiece.type];
     if (moverIndex !== undefined) {
         newKey ^= zobristTable[moverIndex][movedPiece.player][fromRow][fromCol]; // XOR out mover start
         newKey ^= zobristTable[moverIndex][movedPiece.player][toRow][toCol];   // XOR in mover end
     }
     if (capturedPiece) {
         const capturedIndex = pieceNameToIndex[capturedPiece.type];
         if (capturedIndex !== undefined) {
             newKey ^= zobristTable[capturedIndex][capturedPiece.player][toRow][toCol]; // XOR out captured
         }
     }
     newKey ^= zobristBlackToMove; // Toggle player turn
     return newKey;
}
// --- END Zobrist Hashing ---

initializeZobrist();

// --- Transposition Table & State ---
let transpositionTable = new Map(); // Stores AI search results to avoid re-computation
let aiRunCounter = 0; // Counts nodes visited during search (for debugging/performance)
class TimeLimitExceededError extends Error { // Custom error for timeouts
    constructor(message = "AI Timeout") {
        super(message);
        this.name = "TimeLimitExceededError";
    }
}
// --- END TT & State ---


// --- Evaluation Function ---
// Evaluates the favorability of a board state for the AI player.
function evaluateBoard(board, aiPlayer) { // Accepts a Board object
    const gameStatus = checkGameStatus(board); // Use rules.checkGameStatus
    const opponent = Player.getOpponent(aiPlayer);

    // Handle terminal states first
    if (gameStatus === GameStatus.PLAYER0_WINS) return (aiPlayer === Player.PLAYER0) ? WIN_SCORE : LOSE_SCORE;
    if (gameStatus === GameStatus.PLAYER1_WINS) return (aiPlayer === Player.PLAYER1) ? WIN_SCORE : LOSE_SCORE;
    if (gameStatus === GameStatus.DRAW) return 0;

    // Heuristic evaluation (weights can be tuned)
    const WEIGHTS = {
        MATERIAL: 1.0,
        ADVANCEMENT: 0.25,
        DEN_PROXIMITY: 6.0,
        ATTACK_THREAT: 1.5,      
        KEY_SQUARE_CONTROL: 0.5,
        TRAPPED_PENALTY: -3.0,
        DEFENSE_PENALTY: -0.7,
        RAT_VS_ELEPHANT: 4.0,
        THREAT_VICTIM_VALUE_FACTOR: 0.1 // Fraction of threatened piece's value to add as score (e.g., 0.1 = 10%)
    };

    let aiScore = 0;
    let opponentScore = 0;
    const boardState = board.getState(); // Get raw state for iteration
    const pieces = { [aiPlayer]: [], [opponent]: [] };

    // --- Gather pieces and calculate basic material, advancement, and penalty scores ---
    for (let r = 0; r < BOARD_ROWS; r++) {
        for (let c = 0; c < BOARD_COLS; c++) {
            const cell = boardState[r][c];
            const piece = cell.piece;
            if (piece) {
                const player = piece.player;
                // Create a representative object for evaluation, ensuring necessary properties exist
                // Use Piece class temporarily to easily get rank/value if not directly on serialized object
                const evalPiece = new Piece(piece.type, piece.player, r, c); // Ensures .rank, .value are accessible

                pieces[player].push({
                    ...evalPiece, // Includes type, player, rank, value from Piece constructor
                    r: r,         // Explicitly add row/col for clarity
                    c: c,
                    terrain: cell.terrain // Store current terrain
                });

                let scoreRef = (player === aiPlayer) ? aiScore : opponentScore;
                const value = evalPiece.value; // Get value from the constructed Piece

                // Material Score
                scoreRef += value * WEIGHTS.MATERIAL;

                // Advancement Score
                const advancement = (player === aiPlayer) ? (BOARD_ROWS - 1 - r) : r;
                scoreRef += advancement * WEIGHTS.ADVANCEMENT * (value / 150.0);

                // Defense Penalty
                if (piece.type !== 'rat') {
                    if (player === aiPlayer && r > 5) scoreRef += (r - 5) * WEIGHTS.DEFENSE_PENALTY * (value / 100.0);
                    if (player === opponent && r < 3) scoreRef += (2 - r) * WEIGHTS.DEFENSE_PENALTY * (value / 100.0);
                }

                // Trapped Penalty - Use the correct way to check opponent's traps
                const opponentDenRow = Dens[opponent].row;
                const isOpponentTrap = cell.terrain === TerrainType.TRAP && r === opponentDenRow;

                // Use the evalPiece object which has rank etc.
                if (isOpponentTrap && getEffectiveRank(evalPiece, r, c, board) === 0) {
                     scoreRef += WEIGHTS.TRAPPED_PENALTY * (value / 100.0);
                }

                if (player === aiPlayer) aiScore = scoreRef; else opponentScore = scoreRef;
            }
        }
    }

    // --- Positional Scores (Den Proximity, Key Squares) ---
    const opponentDen = Dens[opponent];
    const myDen = Dens[aiPlayer];

    pieces[aiPlayer].forEach(p => { // p is now the object created above { ...evalPiece, r, c, terrain }
        const value = p.value;
        if (p.type !== 'rat') {
             const dist = Math.abs(p.r - opponentDen.row) + Math.abs(p.c - opponentDen.col);
             const progressFactor = (p.r <= 4) ? 1.0 : 0.2;
             aiScore += Math.max(0, 10 - dist) * WEIGHTS.DEN_PROXIMITY * (value / 150.0) * progressFactor;
        }
        if ((p.c >= 2 && p.c <= 4) && (p.r >= 3 && p.r <= 5)) {
             aiScore += WEIGHTS.KEY_SQUARE_CONTROL * (value / 100.0);
        }
    });

     pieces[opponent].forEach(p => {
        const value = p.value;
        if (p.type !== 'rat') {
             const dist = Math.abs(p.r - myDen.row) + Math.abs(p.c - myDen.col);
             const progressFactor = (p.r >= 4) ? 1.0 : 0.2;
             opponentScore += Math.max(0, 10 - dist) * WEIGHTS.DEN_PROXIMITY * (value / 150.0) * progressFactor;
        }
         if ((p.c >= 2 && p.c <= 4) && (p.r >= 3 && p.r <= 5)) {
             opponentScore += WEIGHTS.KEY_SQUARE_CONTROL * (value / 100.0);
        }
    });


    // --- Attack Threat Calculation ---
    // Helper function defined *inside* evaluateBoard or globally in the worker
    const calculateThreatScore = (attackerList, listOwnerPlayer, currentBoard) => {
        let totalThreatScore = 0;
        const victimPlayer = Player.getOpponent(listOwnerPlayer);

        for (const attacker of attackerList) {
            // Define potential target squares (adjacent)
            const potentialTargets = [
                { dr: -1, dc: 0 }, { dr: 1, dc: 0 },
                { dr: 0, dc: -1 }, { dr: 0, dc: 1 }
            ];

            for (const move of potentialTargets) {
                const targetRow = attacker.r + move.dr;
                const targetCol = attacker.c + move.dc;

                // Check boundaries
                if (targetRow >= 0 && targetRow < BOARD_ROWS && targetCol >= 0 && targetCol < BOARD_COLS) {
                    const victimPiece = currentBoard.getPiece(targetRow, targetCol); // Use board method

                    // Is there an opponent piece on the target square?
                    if (victimPiece && victimPiece.player === victimPlayer) {
                        const targetTerrain = currentBoard.getTerrain(targetRow, targetCol);
                        const attackerTerrain = currentBoard.getTerrain(attacker.r, attacker.c); // Attacker's terrain

                        // Can the attacker actually capture the victim?
                        // Pass the actual Piece objects (or objects with necessary properties)
                        if (canCapture(attacker, victimPiece, currentBoard)) {
                            totalThreatScore += (victimPiece.value || 0) * WEIGHTS.THREAT_VICTIM_VALUE_FACTOR;
                        }
                    }
                }
            }
            // Note: This doesn't account for Lion/Tiger jump captures here.
            // That would require checking across the river explicitly if attacker is Lion/Tiger.
            // For simplicity, we focus on adjacent threats.
        }
        return totalThreatScore;
    };

    // Calculate threats for both players
    const aiThreatScore = calculateThreatScore(pieces[aiPlayer], aiPlayer, board);
    const opponentThreatScore = calculateThreatScore(pieces[opponent], opponent, board);

    // Add weighted threat scores
    aiScore += aiThreatScore * WEIGHTS.ATTACK_THREAT;
    opponentScore += opponentThreatScore * WEIGHTS.ATTACK_THREAT;


    // --- Rat vs Elephant Threat Bonus/Penalty (Placeholder - refine as needed) ---
    const aiRatEval = pieces[aiPlayer].find(p => p.type === 'rat');
    const oppElephantEval = pieces[opponent].find(p => p.type === 'elephant');
    if (aiRatEval && oppElephantEval && aiRatEval.terrain !== TerrainType.WATER) {
         // Simplified check: Add bonus if rat is adjacent to non-water elephant
         const dr = Math.abs(aiRatEval.r - oppElephantEval.r);
         const dc = Math.abs(aiRatEval.c - oppElephantEval.c);
         if ((dr === 1 && dc === 0) || (dr === 0 && dc === 1)) {
              // Check if elephant is actually on land
              if (oppElephantEval.terrain !== TerrainType.WATER) {
                aiScore += WEIGHTS.RAT_VS_ELEPHANT; // Add direct bonus
              }
         }
    }

    const oppRatEval = pieces[opponent].find(p => p.type === 'rat');
    const aiElephantEval = pieces[aiPlayer].find(p => p.type === 'elephant');
     if (oppRatEval && aiElephantEval && oppRatEval.terrain !== TerrainType.WATER) {
         const dr = Math.abs(oppRatEval.r - aiElephantEval.r);
         const dc = Math.abs(oppRatEval.c - aiElephantEval.c);
          if ((dr === 1 && dc === 0) || (dr === 0 && dc === 1)) {
              if (aiElephantEval.terrain !== TerrainType.WATER) {
                 opponentScore += WEIGHTS.RAT_VS_ELEPHANT; // Add "penalty" by boosting opponent score
              }
          }
     }


    // --- Final Score ---
    return aiScore - opponentScore;
}
// --- END Evaluation Function ---


// --- Alpha-Beta Search Helper ---
const reusableBoard = new Board();
// Simulates a move on a *copy* of the raw board state and calculates the new Zobrist hash.
function simulateMoveAndGetHash(currentBoardState, move, currentHash, playerMoving) {
    // Create a deep copy of the state for simulation
    const newBoardState = currentBoardState.map(r =>
        r.map(c => ({
            terrain: c.terrain,
            // Important: Create new piece objects for the simulation state if they exist
            piece: c.piece ? new Piece(c.piece.type, c.piece.player, c.piece.row, c.piece.col) : null
        }))
    );

    // Get references to pieces *within the copied state*
    const pieceToMove = newBoardState[move.fromRow]?.[move.fromCol]?.piece;
    const capturedPiece = newBoardState[move.toRow]?.[move.toCol]?.piece; // Might be null

    if (!pieceToMove) {
        console.error("Worker Sim Err: No Piece found in copied state at", move.fromRow, move.fromCol);
        return { newBoardState: newBoardState, newHash: currentHash }; // Return unchanged state/hash on error
    }

    // Calculate hash update BEFORE modifying the board state
    // Need to use the original piece objects (or clones with correct initial state) for hash update
    const originalMovedPiece = currentBoardState[move.fromRow]?.[move.fromCol]?.piece;
    const originalCapturedPiece = currentBoardState[move.toRow]?.[move.toCol]?.piece;
    const newHash = updateZobristKey(currentHash, playerMoving, originalMovedPiece, move.fromRow, move.fromCol, move.toRow, move.toCol, originalCapturedPiece);

    // Perform the move on the copied state
    pieceToMove.setPosition(move.toRow, move.toCol); // Update the piece object's internal state
    newBoardState[move.toRow][move.toCol].piece = pieceToMove;
    newBoardState[move.fromRow][move.fromCol].piece = null;

    return { newBoardState, newHash }; // Return the new raw state array and new hash
}

// The recursive Alpha-Beta search function. Operates on raw board state arrays.
function alphaBeta(currentBoardState, currentHash, depth, alpha, beta, isMaximizingPlayer, aiPlayer, startTime, timeLimit) {
    aiRunCounter++;
    // Check time limit *before* doing significant work for this node
    if (performance.now() - startTime > timeLimit) {
        throw new TimeLimitExceededError(); // Throw error if time limit exceeded
    }

    const originalAlpha = alpha;
    const hashKey = currentHash;

    // Transposition Table Lookup
    const ttEntry = transpositionTable.get(hashKey);
    if (ttEntry && ttEntry.depth >= depth) {
        if (ttEntry.flag === ZOBRIST_HASH_FLAGS.EXACT) return ttEntry.score;
        if (ttEntry.flag === ZOBRIST_HASH_FLAGS.LOWERBOUND) alpha = Math.max(alpha, ttEntry.score);
        if (ttEntry.flag === ZOBRIST_HASH_FLAGS.UPPERBOUND) beta = Math.min(beta, ttEntry.score);
        if (alpha >= beta) return ttEntry.score; // Cutoff based on TT info
    }

    // === Use the reusable Board ===
    // Set the state of the reusable board for game status checks and evaluation
    reusableBoard.state = currentBoardState;
    const gameStatusResult = checkGameStatus(reusableBoard); // Use reusableBoard

    // Terminal State Check or Max Depth Reached
    if (gameStatusResult !== GameStatus.ONGOING || depth === 0) {
        // Evaluate using the reusable board with the current state
        let baseScore = evaluateBoard(reusableBoard, aiPlayer); // Use reusableBoard

        // Add a small bonus/penalty for depth to encourage faster wins/delayed losses
        // Adjust multiplier as needed
        const DEPTH_BONUS_MULTIPLIER = 0.1;
        if (gameStatusResult === GameStatus.PLAYER0_WINS || gameStatusResult === GameStatus.PLAYER1_WINS) {
            const winner = (gameStatusResult === GameStatus.PLAYER0_WINS) ? Player.PLAYER0 : Player.PLAYER1;
            // Add bonus if AI wins, penalty if AI loses. Larger bonus/penalty for shallower depth.
            baseScore += (winner === aiPlayer ? WIN_SCORE : LOSE_SCORE) * DEPTH_BONUS_MULTIPLIER * (depth + 1);
        } else if (gameStatusResult === GameStatus.DRAW) {
             // No depth bonus for draw
        }

        // Store exact score for terminal/leaf nodes if not already better entry exists
        if (!ttEntry || ttEntry.depth < depth || ttEntry.flag !== ZOBRIST_HASH_FLAGS.EXACT) {
             transpositionTable.set(hashKey, { score: baseScore, depth: depth, flag: ZOBRIST_HASH_FLAGS.EXACT, bestMove: null });
        }
        return baseScore;
    }

    // === Move Generation using the reusable Board ===
    const playerToMove = isMaximizingPlayer ? aiPlayer : Player.getOpponent(aiPlayer);
    let moves;
    try {
        // Ensure the reusableBoard's state is set before getting moves
        reusableBoard.state = currentBoardState;
        moves = getAllPossibleMovesForPlayer(reusableBoard, playerToMove); // Use reusableBoard
    } catch (e) {
        console.error("Worker AlphaBeta: Error getting moves", e, "State:", currentBoardState, "Player:", playerToMove);
        // Treat move generation error as a loss for the player whose turn it is
        return isMaximizingPlayer ? LOSE_SCORE : WIN_SCORE;
    }

    // If no moves are possible, it might be a stalemate or loss (checkGameStatus handles win/loss)
    // Evaluate the current board state as is.
    if (moves.length === 0) {
        reusableBoard.state = currentBoardState; // Ensure state is set
        let score = evaluateBoard(reusableBoard, aiPlayer); // Use reusableBoard
         // Store this evaluation as an exact score
         if (!ttEntry || ttEntry.depth < depth || ttEntry.flag !== ZOBRIST_HASH_FLAGS.EXACT) {
             transpositionTable.set(hashKey, { score: score, depth: depth, flag: ZOBRIST_HASH_FLAGS.EXACT, bestMove: null });
         }
        return score;
    }

    // === Move Ordering ===
    let bestMoveFromTT = ttEntry?.bestMove; // Get { fromRow, fromCol, toRow, toCol } or null
    moves.forEach(move => {
        move.orderScore = 0;
        // Prioritize the best move found in previous searches (from TT)
        if (bestMoveFromTT && move.fromRow === bestMoveFromTT.fromRow && move.fromCol === bestMoveFromTT.fromCol &&
            move.toRow === bestMoveFromTT.toRow && move.toCol === bestMoveFromTT.toCol) {
            move.orderScore += 10000; // High score for TT move
        }
        // Prioritize captures
        const targetCell = currentBoardState[move.toRow]?.[move.toCol];
        const targetPiece = targetCell?.piece;
        if (targetPiece) {
            // Score based on value difference (MVV-LVA: Most Valuable Victim - Least Valuable Attacker)
            const attackerValue = PieceData[move.piece.type]?.value ?? 1; // Use 1 if undefined
            const victimValue = PieceData[targetPiece.type]?.value ?? 0;
            move.orderScore += (victimValue * 10) - attackerValue; // Prioritize capturing high value with low value
        }
        // Add other heuristics: e.g., moving towards opponent's den, moving high-value pieces?
        // Example: Small bonus for moving forward (simpler than full eval)
        if (playerToMove === Player.PLAYER0 && move.toRow > move.fromRow) move.orderScore += 1;
        if (playerToMove === Player.PLAYER1 && move.toRow < move.fromRow) move.orderScore += 1;

    });
    moves.sort((a, b) => b.orderScore - a.orderScore);


    // === Iterate Through Moves ===
    let bestScore = isMaximizingPlayer ? -Infinity : Infinity;
    let bestMoveForNode = null; // Store the actual move object { piece, from..., to... } initially

    for (const move of moves) {
        let simResult;
        try {
            // Simulate move on raw state, get new raw state and hash
            simResult = simulateMoveAndGetHash(currentBoardState, move, currentHash, playerToMove);
        } catch(e) {
            console.error("Worker SimHash fail in AlphaBeta:", e, "Move:", move);
            continue; // Skip this move if simulation fails
        }

        let evalScore;
        try {
            // Recursive call with the new raw state and hash
            evalScore = alphaBeta(simResult.newBoardState, simResult.newHash, depth - 1, alpha, beta, !isMaximizingPlayer, aiPlayer, startTime, timeLimit);

        } catch(e) {
            // If the recursive call timed out or had another error, re-throw it
            // This allows the iterative deepening loop to catch it properly.
            if (e instanceof TimeLimitExceededError) {
                // console.log("Worker: Propagating timeout from depth", depth - 1); // Optional log
                throw e; // Re-throw timeout
            } else {
                console.error("Worker AlphaBeta: Error in recursive call", e);
                // Treat unexpected errors in recursion as worst-case for the current player
                evalScore = isMaximizingPlayer ? LOSE_SCORE : WIN_SCORE;
            }
        }

        // --- Update Alpha/Beta and Best Move ---
        if (isMaximizingPlayer) {
            if (evalScore > bestScore) {
                bestScore = evalScore;
                bestMoveForNode = move; // Store the best move object found so far at this node
            }
            alpha = Math.max(alpha, bestScore);
        } else { // Minimizing Player
            if (evalScore < bestScore) {
                bestScore = evalScore;
                bestMoveForNode = move; // Store the best move object found so far at this node
            }
            beta = Math.min(beta, bestScore);
        }

        // --- Alpha-Beta Cutoff ---
        if (beta <= alpha) {
            break; // Prune remaining moves
        }
    } // End loop through moves

    // --- Store Result in Transposition Table ---
    // Determine the flag based on whether a cutoff occurred or all moves were searched
    let flag;
    if (bestScore <= originalAlpha) {
        flag = ZOBRIST_HASH_FLAGS.UPPERBOUND; // Score is at most bestScore (failed low)
    } else if (bestScore >= beta) {
        flag = ZOBRIST_HASH_FLAGS.LOWERBOUND; // Score is at least bestScore (failed high)
    } else {
        flag = ZOBRIST_HASH_FLAGS.EXACT;      // Score is exactly bestScore
    }

    // Store only if the new entry is better (deeper search) or more accurate (exact score)
     if (!ttEntry || depth >= ttEntry.depth || (flag === ZOBRIST_HASH_FLAGS.EXACT && ttEntry.flag !== ZOBRIST_HASH_FLAGS.EXACT)) {
         // Store simplified move coordinates in TT associated with this score and depth
         const bestMoveCoords = bestMoveForNode ? { fromRow: bestMoveForNode.fromRow, fromCol: bestMoveForNode.fromCol, toRow: bestMoveForNode.toRow, toCol: bestMoveForNode.toCol } : null;
         transpositionTable.set(hashKey, { score: bestScore, depth: depth, flag: flag, bestMove: bestMoveCoords });
     }

    return bestScore;
}
// --- END Alpha-Beta Search ---


// --- Top-Level AI Function ---
// Finds the best move using iterative deepening. Operates on raw board state.
function findBestMove(initialBoardState, aiPlayer, maxDepth, timeLimit) {
    const startTime = performance.now();
    aiRunCounter = 0;
    // Clear TT at the start of a *new move calculation*, not necessarily every call if resuming search was intended (but it isn't here)
    transpositionTable.clear();

    let bestMoveOverall = null; // Stores { fromRow, fromCol, toRow, toCol }
    let bestScoreOverall = -Infinity;
    let lastCompletedDepth = 0;

    // --- Root Setup ---
    // Use the reusable board instance for root operations too
    reusableBoard.state = initialBoardState;
    let rootMoves;
    try {
        rootMoves = getAllPossibleMovesForPlayer(reusableBoard, aiPlayer);
    } catch (e) {
        console.error("Worker findBestMove: Error getting root moves", e);
        self.postMessage({ type: 'error', message: 'Failed to get initial moves.' });
        return { move: null, depthAchieved: 0, score: -Infinity };
    }

    if (rootMoves.length === 0) {
        console.log("Worker: No legal moves available.");
        // Evaluate the static board if no moves are possible
        reusableBoard.state = initialBoardState;
        const currentScore = evaluateBoard(reusableBoard, aiPlayer);
        return { move: null, depthAchieved: 0, score: currentScore }; // No move possible
    }
    // If only one move, return it immediately (optional optimization)
     if (rootMoves.length === 1) {
        const onlyMove = rootMoves[0];
         console.log("Worker: Only one legal move found. Returning immediately.");
         return {
             move: { fromRow: onlyMove.fromRow, fromCol: onlyMove.fromCol, toRow: onlyMove.toRow, toCol: onlyMove.toCol },
             depthAchieved: 0, // No search needed
             score: 0 // Score is unknown without search, maybe run eval?
         };
     }


    // Calculate the initial Zobrist hash for the starting position
    const initialHash = computeZobristKey(reusableBoard, aiPlayer); // Use reusableBoard or initialBoardState

    // --- Iterative Deepening Loop ---
    try {
        for (let currentDepth = 1; currentDepth <= maxDepth; currentDepth++) {
            const timeBeforeIter = performance.now();
            // More lenient check: only break *before* starting if less than ~10% time remaining? Or just rely on alphaBeta check.
             if (timeBeforeIter - startTime > timeLimit) {
                 console.log(`Worker: Timeout threshold reached before starting D${currentDepth}. Using results from D${lastCompletedDepth}.`);
                 break;
             }
             // Allow a minimum time slice for the next depth? e.g., 50ms?
            // const timeRemaining = timeLimit - (timeBeforeIter - startTime);
            // if (timeRemaining < 50 && currentDepth > 1) { // Don't stop before D1 if possible
            //     console.log(`Worker: Low time remaining (${timeRemaining.toFixed(0)}ms) before D${currentDepth}. Using results from D${lastCompletedDepth}.`);
            //     break;
            // }


            // --- Root Move Ordering (Re-order before each iteration using TT info if available) ---
            const rootTtEntry = transpositionTable.get(initialHash); // Check TT for the root node itself (less common)
            let bestMoveFromTTRoot = rootTtEntry?.bestMove; // Get potential best move from root TT entry
             // Apply sorting logic similar to alphaBeta's ordering
             rootMoves.forEach(move => {
                 move.orderScore = 0;
                 // Prioritize TT Move for the *root* if available from previous depths
                 if (bestMoveOverall && move.fromRow === bestMoveOverall.fromRow && move.fromCol === bestMoveOverall.fromCol &&
                     move.toRow === bestMoveOverall.toRow && move.toCol === bestMoveOverall.toCol) {
                         move.orderScore += 20000; // Higher priority for overall best move from previous depth
                 }
                // Prioritize the specific best move stored in TT for this position/depth
                 else if (bestMoveFromTTRoot && move.fromRow === bestMoveFromTTRoot.fromRow && move.fromCol === bestMoveFromTTRoot.fromCol &&
                     move.toRow === bestMoveFromTTRoot.toRow && move.toCol === bestMoveFromTTRoot.toCol) {
                     move.orderScore += 10000;
                 }
                 const targetCell = initialBoardState[move.toRow]?.[move.toCol];
                 const targetPiece = targetCell?.piece;
                 if (targetPiece) {
                     const attackerValue = PieceData[move.piece.type]?.value ?? 1;
                     const victimValue = PieceData[targetPiece.type]?.value ?? 0;
                     move.orderScore += (victimValue * 10) - attackerValue;
                 }
                 // Add other root-specific heuristics if needed
             });
             rootMoves.sort((a, b) => b.orderScore - a.orderScore);
             // --- End Root Move Ordering ---


            let bestScoreThisIteration = -Infinity;
            let bestMoveThisIteration = null; // Stores { fromRow, fromCol, toRow, toCol }
            let alpha = -Infinity;
            let beta = Infinity;
            const iterationNodeCountStart = aiRunCounter;

            // Iterate through moves at the root
            for (const move of rootMoves) {
                let simResult;
                try {
                    // Simulate using raw state
                    simResult = simulateMoveAndGetHash(initialBoardState, move, initialHash, aiPlayer);
                } catch(e){
                    console.error("Worker SimHash error at root:", e, "Move:", move);
                    continue; // Skip this move if simulation fails at root
                }

                // Make the recursive call for this move
                // The root is a maximizing node for the AI player. The next level down is minimizing.
                const score = alphaBeta(simResult.newBoardState, simResult.newHash, currentDepth - 1, alpha, beta, false, aiPlayer, startTime, timeLimit);
                // Check for timeout *immediately* after the call returns (or error was thrown)
                 if (performance.now() - startTime > timeLimit) {
                     console.log(`Worker: Timeout detected during D${currentDepth} after evaluating move (${move.fromRow},${move.fromCol})->(${move.toRow},${move.toCol}).`);
                     // Throwing here will exit the inner loop and be caught by the outer try/catch
                     throw new TimeLimitExceededError("Timeout during depth iteration");
                 }

                // Update best score and move *for this iteration*
                if (score > bestScoreThisIteration) {
                    bestScoreThisIteration = score;
                    // Store simplified move data
                    bestMoveThisIteration = { fromRow: move.fromRow, fromCol: move.fromCol, toRow: move.toRow, toCol: move.toCol };
                }

                // Update alpha for the root node (maximizing)
                // Beta is not directly used for cutoffs *at the root* in this structure, but passed down.
                alpha = Math.max(alpha, score);

                // If a winning move is found, we can potentially stop early (optional)
                // Check against WIN_SCORE adjusted for depth bonus from alphaBeta
                 if (bestScoreThisIteration > WIN_SCORE) { // Check against base win score
                     console.log(`Worker: Potential win found at D${currentDepth}. Score: ${bestScoreThisIteration}`);
                     // We could break the inner loop here, but let's complete the depth
                     // to ensure it's the *best* win (fastest).
                 }

            } // End loop through root moves for current depth

            // --- Iteration Complete ---
            const timeAfterIter = performance.now(); // Time check already happened if timeout occurred

            lastCompletedDepth = currentDepth;
            // IMPORTANT: Only update the overall best move if this iteration actually found a move.
            // If the iteration timed out mid-way, bestMoveThisIteration might be null or incomplete.
            if (bestMoveThisIteration) {
                 bestMoveOverall = bestMoveThisIteration;
                 bestScoreOverall = bestScoreThisIteration;
            } else if (!bestMoveOverall && rootMoves.length > 0) {
                 // Fallback: If this was the *first* iteration (D1) and it somehow failed to select a move
                 // (e.g., all moves resulted in immediate timeout error), but we know moves exist,
                 // assign the first legal move (or the best from ordering).
                 console.warn(`Worker: D${currentDepth} completed without selecting a best move. Fallback needed.`);
                 const fallbackMove = rootMoves[0]; // Use the highest-priority move after sorting
                 bestMoveOverall = { fromRow: fallbackMove.fromRow, fromCol: fallbackMove.fromCol, toRow: fallbackMove.toRow, toCol: fallbackMove.toCol };
                 bestScoreOverall = bestScoreThisIteration; // Keep score if available, else remains -Infinity
            }


            // Optional Logging for the completed depth
            const scoreDisp = bestScoreOverall === -Infinity ? "-Inf" : bestScoreOverall.toFixed(0);
             const nodesThisIter = aiRunCounter - iterationNodeCountStart;
             const iterTime = timeAfterIter - timeBeforeIter;
            console.log(`Worker D${currentDepth}: Best M:(${bestMoveOverall?.fromRow},${bestMoveOverall?.fromCol})->(${bestMoveOverall?.toRow},${bestMoveOverall?.toCol}), Sc:${scoreDisp}, Nodes:${nodesThisIter}, T:${iterTime.toFixed(0)}ms (Total T: ${(timeAfterIter - startTime).toFixed(0)}ms)`);

            // Check for terminal score (Win/Loss found) - break iterative deepening early
            // Adjust threshold slightly to account for depth bonuses
            if (bestScoreOverall >= WIN_SCORE * 0.9 || bestScoreOverall <= LOSE_SCORE * 0.9) {
                console.log(`Worker: Near-terminal score found at D${currentDepth}. Stopping search.`);
                break; // Exit iterative deepening loop
            }

        } // End Iterative Deepening Loop
    } catch (error) {
        if (error instanceof TimeLimitExceededError) {
            // This is expected if the time limit is hit during alphaBeta or the check within findBestMove.
            // We *don't* want to overwrite bestMoveOverall here. It should hold the result from the *last successfully completed* depth.
             console.warn(`Worker: Search terminated by timeout during D${lastCompletedDepth + 1}. Using best move from D${lastCompletedDepth}.`);
        } else {
            // Handle unexpected errors
            console.error("Worker: Unexpected error during iterative deepening search:", error);
            // Post error back? Optional.
             self.postMessage({ type: 'error', message: `Unexpected search error: ${error.message}` });
        }
    }

    // --- Final Result Selection ---
    // If no move was ever selected (e.g., timeout before D1 completed, or error)
    // and legal moves exist, select the first (highest priority) legal move as a last resort.
     if (!bestMoveOverall && rootMoves.length > 0) {
         console.warn("Worker: No move selected after search completed (likely timeout before D1 fully finished or error). Selecting best-ordered legal move.");
         const fallbackMove = rootMoves[0]; // Already sorted
         bestMoveOverall = { fromRow: fallbackMove.fromRow, fromCol: fallbackMove.fromCol, toRow: fallbackMove.toRow, toCol: fallbackMove.toCol };
         bestScoreOverall = -Infinity; // Indicate score is unreliable
     }

    // Final Logging
    const endTime = performance.now();
    const finalScoreDisp = bestScoreOverall === -Infinity ? "-Inf" : bestScoreOverall.toFixed(0);
    console.log(`Worker Final Choice: D${lastCompletedDepth}, M:(${bestMoveOverall?.fromRow},${bestMoveOverall?.fromCol})->(${bestMoveOverall?.toRow},${bestMoveOverall?.toCol}), Sc:${finalScoreDisp}, Nodes:${aiRunCounter}, Total T:${(endTime - startTime).toFixed(0)}ms`);

    // Return simplified move object based on the best move found from the latest completed depth
    return {
        move: bestMoveOverall, // { fromRow, fromCol, toRow, toCol } or null
        depthAchieved: lastCompletedDepth,
        score: bestScoreOverall
    };
}
// --- END Top-Level AI Function ---


// --- Worker Message Handler ---
// This function executes when the main thread sends a message to the worker.
self.onmessage = function(event) {
    console.log('Worker received message:', event.data); // Log incoming data
    const { boardState, aiPlayer, maxDepth, timeLimit } = event.data;

    // Basic validation of incoming data
    if (!boardState || aiPlayer === undefined || !maxDepth || !timeLimit) {
        console.error("Worker Error: Invalid data received.");
        // Send an error message back to the main thread
        self.postMessage({ type: 'error', message: 'Invalid data received by worker.' });
        return;
    }

    try {
        // Start the AI calculation process
        const result = findBestMove(boardState, aiPlayer, maxDepth, timeLimit);

        // Send the result back to the main thread
        // The 'result' object contains { move: {coords}|null, depthAchieved, score }
        self.postMessage({ type: 'result', ...result });

    } catch (error) {
        // Catch any unexpected errors during calculation
        console.error("Worker Error: Exception during findBestMove", error);
        // Send an error message back
        self.postMessage({ type: 'error', message: error.message || 'Unknown AI calculation error.' });
    }
};

// Log to confirm the worker script itself has loaded successfully
console.log("AI Worker script loaded and ready.");