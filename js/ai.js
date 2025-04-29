// js/ai.js
import {
    Player, PieceData, BOARD_ROWS, BOARD_COLS, TerrainType, Dens,
    WIN_SCORE, LOSE_SCORE, ZOBRIST_HASH_FLAGS, GameStatus // <--- ADD GameStatus HERE
} from './constants.js';
import { Board } from './board.js';
import { Piece } from './piece.js';
import {
    getAllPossibleMovesForPlayer, checkGameStatus, getEffectiveRank, canCapture // <--- REMOVE GameStatus from HERE
} from './rules.js';

// --- Zobrist Hashing ---
const zobristTable = []; // [pieceTypeIndex][player][row][col] => BigInt
let zobristBlackToMove = 0n; // BigInt for player turn toggle
const pieceNameToIndex = {}; // Map 'rat' -> 0, 'cat' -> 1, etc.
let pieceIndexCounter = 0;

/** Generates a random 64-bit BigInt */
function randomBigInt() {
    const low = BigInt(Math.floor(Math.random() * (2 ** 32)));
    const high = BigInt(Math.floor(Math.random() * (2 ** 32)));
    return (high << 32n) | low;
}

/** Initializes the Zobrist hash table with random keys. MUST be called once. */
export function initializeZobrist() {
    console.log("Initializing Zobrist table...");
    zobristTable.length = 0; // Clear previous table if any
    pieceIndexCounter = 0;
    Object.keys(pieceNameToIndex).forEach(key => delete pieceNameToIndex[key]); // Clear map

    // Assign indices and create table structure
    for (const pieceType in PieceData) {
         if (!pieceNameToIndex.hasOwnProperty(pieceType)) {
            pieceNameToIndex[pieceType] = pieceIndexCounter++;
            zobristTable[pieceNameToIndex[pieceType]] = []; // Array for players
        }
        const idx = pieceNameToIndex[pieceType];
        zobristTable[idx][Player.PLAYER0] = []; // Array for rows (P0)
        zobristTable[idx][Player.PLAYER1] = []; // Array for rows (P1)

        for (let r = 0; r < BOARD_ROWS; r++) {
            zobristTable[idx][Player.PLAYER0][r] = []; // Array for cols (P0, row r)
            zobristTable[idx][Player.PLAYER1][r] = []; // Array for cols (P1, row r)
            for (let c = 0; c < BOARD_COLS; c++) {
                zobristTable[idx][Player.PLAYER0][r][c] = randomBigInt();
                zobristTable[idx][Player.PLAYER1][r][c] = randomBigInt();
            }
        }
    }
    zobristBlackToMove = randomBigInt();
    console.log("Zobrist table initialized.");
}

/** Computes the Zobrist key for a given board state and player to move. */
export function computeZobristKey(board, playerToMove) {
    let key = 0n;
    const boardState = board.getState();

    for (let r = 0; r < BOARD_ROWS; r++) {
        for (let c = 0; c < BOARD_COLS; c++) {
            const piece = boardState[r][c].piece;
            if (piece) {
                const pieceTypeIndex = pieceNameToIndex[piece.type];
                if (pieceTypeIndex !== undefined && zobristTable[pieceTypeIndex]?.[piece.player]?.[r]?.[c]) {
                    key ^= zobristTable[pieceTypeIndex][piece.player][r][c];
                } else {
                     // This shouldn't happen if initialized correctly
                     // console.warn(`Zobrist Calc Warning: Missing key for ${piece.type} (${piece.player}) at ${r},${c}`);
                }
            }
        }
    }

    if (playerToMove === Player.PLAYER1) { // Or whichever player corresponds to "black"
        key ^= zobristBlackToMove;
    }
    return key;
}

/**
 * Incrementally updates the Zobrist key based on a move.
 * @param {bigint} currentKey The key before the move.
 * @param {Player} playerMoving The player whose turn it WAS (before switching).
 * @param {Piece} movedPiece The piece being moved.
 * @param {number} fromRow
 * @param {number} fromCol
 * @param {number} toRow
 * @param {number} toCol
 * @param {Piece | null} capturedPiece The piece captured, if any.
 * @returns {bigint} The new Zobrist key after the move and player switch.
 */
export function updateZobristKey(currentKey, playerMoving, movedPiece, fromRow, fromCol, toRow, toCol, capturedPiece) {
     let newKey = currentKey;

     // 1. XOR out the moved piece from its original square
     const moverIndex = pieceNameToIndex[movedPiece.type];
     if (moverIndex !== undefined) {
         newKey ^= zobristTable[moverIndex][movedPiece.player][fromRow][fromCol];
     }

     // 2. XOR out the captured piece (if any) from the destination square
     if (capturedPiece) {
         const capturedIndex = pieceNameToIndex[capturedPiece.type];
         if (capturedIndex !== undefined) {
             newKey ^= zobristTable[capturedIndex][capturedPiece.player][toRow][toCol];
         }
     }

     // 3. XOR in the moved piece at its destination square
     if (moverIndex !== undefined) {
         newKey ^= zobristTable[moverIndex][movedPiece.player][toRow][toCol];
     }

     // 4. XOR the turn key to switch player
     newKey ^= zobristBlackToMove;

     return newKey;
}


// --- Transposition Table ---
let transpositionTable = new Map(); // Map<bigint, { score: number, depth: number, flag: number, bestMove: object | null }>
let aiRunCounter = 0; // For node counting

// Custom error for time limits
class TimeLimitExceededError extends Error {
    constructor(message = "AI Timeout") {
        super(message);
        this.name = "TimeLimitExceededError";
    }
}

// --- Evaluation Function ---
function evaluateBoard(board, aiPlayer) {
    const gameStatus = checkGameStatus(board);
    const opponent = Player.getOpponent(aiPlayer);

    if (gameStatus === GameStatus.PLAYER0_WINS) return aiPlayer === Player.PLAYER0 ? WIN_SCORE : LOSE_SCORE;
    if (gameStatus === GameStatus.PLAYER1_WINS) return aiPlayer === Player.PLAYER1 ? WIN_SCORE : LOSE_SCORE;
    if (gameStatus === GameStatus.DRAW) return 0;

    // Heuristic weights (tune these)
    const WEIGHTS = {
        MATERIAL: 1.0,        // Base value of pieces
        ADVANCEMENT: 0.25,      // How far pieces have moved forward
        DEN_PROXIMITY: 6.0,     // How close non-rat pieces are to the opponent's den
        ATTACK_THREAT: 1.5,     // Bonus for pieces attacking valuable opponents
        KEY_SQUARE_CONTROL: 0.5,// Bonus for controlling central squares or entry points (simplified)
        TRAPPED_PENALTY: -3.0,   // Penalty for being in an opponent's trap
        DEFENSE_PENALTY: -0.7,  // Penalty for pieces being too far back (non-rats)
        RAT_VS_ELEPHANT: 4.0,   // Bonus for Rat threatening Elephant
    };

    let aiScore = 0;
    let opponentScore = 0;
    const boardState = board.getState();
    const pieces = { [aiPlayer]: [], [opponent]: [] };

    // --- Gather pieces and calculate basic scores ---
    for (let r = 0; r < BOARD_ROWS; r++) {
        for (let c = 0; c < BOARD_COLS; c++) {
            const cell = boardState[r][c];
            const piece = cell.piece;
            if (piece) {
                const player = piece.player;
                pieces[player].push({ ...piece, r, c, terrain: cell.terrain }); // Store position info

                let scoreRef = (player === aiPlayer) ? aiScore : opponentScore;

                // 1. Material Score
                scoreRef += piece.value * WEIGHTS.MATERIAL;

                // 2. Advancement Score (relative to player direction)
                const advancement = (player === aiPlayer) ? (BOARD_ROWS - 1 - r) : r; // AI (P1) advances towards row 0, P0 towards row 8
                scoreRef += advancement * WEIGHTS.ADVANCEMENT * (piece.value / 150.0); // Scale by piece value

                // 3. Defense Penalty (simplified - discourage pieces staying deep)
                if (piece.type !== 'rat') { // Rats often stay back initially
                    if (player === aiPlayer && r > 5) scoreRef += (r - 5) * WEIGHTS.DEFENSE_PENALTY * (piece.value / 100.0);
                    if (player === opponent && r < 3) scoreRef += (2 - r) * WEIGHTS.DEFENSE_PENALTY * (piece.value / 100.0);
                }

                 // 4. Trapped Penalty
                if (getEffectiveRank(piece, r, c, board) === 0 && cell.terrain === TerrainType.TRAP) {
                    scoreRef += WEIGHTS.TRAPPED_PENALTY * (piece.value / 100.0);
                }

                if (player === aiPlayer) aiScore = scoreRef; else opponentScore = scoreRef;
            }
        }
    }

    // Check immediate loss/win by piece count (already handled by checkGameStatus, but good fallback)
    if (pieces[aiPlayer].length === 0 && pieces[opponent].length > 0) return LOSE_SCORE;
    if (pieces[opponent].length === 0 && pieces[aiPlayer].length > 0) return WIN_SCORE;


    // --- Positional and Threat Scores ---
    const opponentDen = Dens[opponent];
    const myDen = Dens[aiPlayer];

    pieces[aiPlayer].forEach(p => {
        // 5. Den Proximity (for non-rats)
        if (p.type !== 'rat') {
             const dist = Math.abs(p.r - opponentDen.row) + Math.abs(p.c - opponentDen.col);
             const progressFactor = (p.r <= 4) ? 1 : 0.2; // Encourage crossing river for AI (P1)
             aiScore += Math.max(0, 10 - dist) * WEIGHTS.DEN_PROXIMITY * (p.value / 150.0) * progressFactor;
        }
        // 6. Key Square Control (Example: near river crossings or center)
        if ((p.c >= 2 && p.c <= 4) && (p.r >= 3 && p.r <= 5)) {
             aiScore += WEIGHTS.KEY_SQUARE_CONTROL * (p.value / 100.0);
        }
    });

     pieces[opponent].forEach(p => {
        if (p.type !== 'rat') {
             const dist = Math.abs(p.r - myDen.row) + Math.abs(p.c - myDen.col);
             const progressFactor = (p.r >= 4) ? 1 : 0.2; // Encourage crossing river for Opponent (P0)
             opponentScore += Math.max(0, 10 - dist) * WEIGHTS.DEN_PROXIMITY * (p.value / 150.0) * progressFactor;
        }
         if ((p.c >= 2 && p.c <= 4) && (p.r >= 3 && p.r <= 5)) {
             opponentScore += WEIGHTS.KEY_SQUARE_CONTROL * (p.value / 100.0);
        }
    });


    // 7. Attack Threats (Check potential captures *next* move) - simplified
    const checkAttackThreat = (attackerList, defenderList, attackerPlayer) => {
        let threatBonus = 0;
        for (const attacker of attackerList) {
             // Simplified: check adjacent squares only (doesn't account for jumps perfectly)
            const potentialTargets = [
                {r: attacker.r - 1, c: attacker.c}, {r: attacker.r + 1, c: attacker.c},
                {r: attacker.r, c: attacker.c - 1}, {r: attacker.r, c: attacker.c + 1}
            ];
            for (const targetPos of potentialTargets) {
                if (board.isValidCoordinate(targetPos.r, targetPos.c)) {
                    const targetPiece = board.getPiece(targetPos.r, targetPos.c);
                    if (targetPiece && targetPiece.player !== attackerPlayer) {
                         const targetValue = targetPiece.value;
                         if (canCapture(attacker, targetPiece, attacker.r, attacker.c, targetPos.r, targetPos.c, board)) {
                             threatBonus += targetValue * WEIGHTS.ATTACK_THREAT / 100.0; // More bonus if can capture
                         } else {
                             threatBonus += targetValue * (WEIGHTS.ATTACK_THREAT / 4) / 100.0; // Less bonus if just threatening
                         }
                    }
                }
            }
        }
        return threatBonus;
    };
    aiScore += checkAttackThreat(pieces[aiPlayer], pieces[opponent], aiPlayer);
    opponentScore += checkAttackThreat(pieces[opponent], pieces[aiPlayer], opponent);


     // 8. Rat vs Elephant Threat Bonus
     const aiRat = pieces[aiPlayer].find(p => p.type === 'rat');
     const oppElephant = pieces[opponent].find(p => p.type === 'elephant');
     if (aiRat && oppElephant && board.getTerrain(aiRat.r, aiRat.c) !== TerrainType.WATER) {
         const dist = Math.abs(aiRat.r - oppElephant.r) + Math.abs(aiRat.c - oppElephant.c);
         if (dist <= 2) { // If Rat is close and can potentially attack
             aiScore += (3 - dist) * WEIGHTS.RAT_VS_ELEPHANT;
         }
     }
     // Penalty if opponent Rat threatens our Elephant
     const oppRat = pieces[opponent].find(p => p.type === 'rat');
     const aiElephant = pieces[aiPlayer].find(p => p.type === 'elephant');
      if (oppRat && aiElephant && board.getTerrain(oppRat.r, oppRat.c) !== TerrainType.WATER) {
         const dist = Math.abs(oppRat.r - aiElephant.r) + Math.abs(oppRat.c - aiElephant.c);
         if (dist <= 2) {
             opponentScore += (3 - dist) * WEIGHTS.RAT_VS_ELEPHANT;
         }
     }

    return aiScore - opponentScore;
}


// --- Alpha-Beta Search with Iterative Deepening ---

/**
 * Performs the recursive alpha-beta search.
 * @param {Board} currentBoard The current board state for this node.
 * @param {bigint} currentHash The Zobrist hash for currentBoard state.
 * @param {number} depth Remaining depth to search.
 * @param {number} alpha Best score found so far for Maximizer.
 * @param {number} beta Best score found so far for Minimizer.
 * @param {boolean} isMaximizingPlayer True if current node is for AI (Maximizer), false for opponent.
 * @param {number} aiPlayer The player identifier for the AI (e.g., Player.PLAYER1).
 * @param {number} startTime Timestamp when the search began.
 * @param {number} timeLimit Max allowed time in milliseconds.
 * @returns {number} The evaluated score for this node.
 * @throws {TimeLimitExceededError} If the time limit is reached.
 */
function alphaBeta(currentBoard, currentHash, depth, alpha, beta, isMaximizingPlayer, aiPlayer, startTime, timeLimit) {
    aiRunCounter++;
    if (performance.now() - startTime > timeLimit) {
        throw new TimeLimitExceededError();
    }

    const originalAlpha = alpha; // Needed for TT flag calculation
    const hashKey = currentHash;

    // --- Transposition Table Lookup ---
    const ttEntry = transpositionTable.get(hashKey);
    if (ttEntry && ttEntry.depth >= depth) {
        if (ttEntry.flag === ZOBRIST_HASH_FLAGS.EXACT) return ttEntry.score;
        if (ttEntry.flag === ZOBRIST_HASH_FLAGS.LOWERBOUND) alpha = Math.max(alpha, ttEntry.score);
        if (ttEntry.flag === ZOBRIST_HASH_FLAGS.UPPERBOUND) beta = Math.min(beta, ttEntry.score);
        if (alpha >= beta) return ttEntry.score; // Cutoff based on TT entry
    }

    // --- Terminal State Check ---
    const gameStatus = checkGameStatus(currentBoard);
    if (gameStatus !== GameStatus.ONGOING || depth === 0) {
        let baseScore = evaluateBoard(currentBoard, aiPlayer);
         // Add small depth penalty/bonus to encourage faster wins/delay losses
        if (gameStatus !== GameStatus.ONGOING) {
             const DEPTH_BONUS_MULTIPLIER = 10;
             if ((gameStatus === GameStatus.PLAYER0_WINS && aiPlayer === Player.PLAYER0) ||
                 (gameStatus === GameStatus.PLAYER1_WINS && aiPlayer === Player.PLAYER1)) {
                 baseScore += depth * DEPTH_BONUS_MULTIPLIER; // Win faster = better
             } else if (gameStatus !== GameStatus.DRAW) {
                 baseScore -= depth * DEPTH_BONUS_MULTIPLIER; // Lose slower = better (less bad)
             }
        }
        // Store in TT if new or better depth
        if (!ttEntry || ttEntry.depth < depth) {
            transpositionTable.set(hashKey, { score: baseScore, depth: depth, flag: ZOBRIST_HASH_FLAGS.EXACT, bestMove: null });
        }
        return baseScore;
    }

    // --- Get Moves and Order Them ---
    const playerToMove = isMaximizingPlayer ? aiPlayer : Player.getOpponent(aiPlayer);
    let moves;
    try {
        moves = getAllPossibleMovesForPlayer(currentBoard, playerToMove);
    } catch (e) {
        console.error(`AI Error: Failed to get moves for player ${playerToMove} at depth ${depth}`, e);
        return isMaximizingPlayer ? LOSE_SCORE : WIN_SCORE; // Treat as loss if cannot generate moves
    }

    if (moves.length === 0) { // No legal moves = loss
        return evaluateBoard(currentBoard, aiPlayer); // Evaluate static position (usually a loss)
    }

    // Move Ordering: TT move first, then captures, then others
    let bestMoveFromTT = ttEntry?.bestMove;
    if (bestMoveFromTT) {
        const idx = moves.findIndex(m => m.fromRow === bestMoveFromTT.fromRow && m.fromCol === bestMoveFromTT.fromCol && m.toRow === bestMoveFromTT.toRow && m.toCol === bestMoveFromTT.toCol);
        if (idx > 0) { // Move TT best move to the front (if found and not already first)
            moves.unshift(moves.splice(idx, 1)[0]);
        }
    } else { // Basic move ordering if no TT hint
         moves.forEach(move => {
            const targetPiece = currentBoard.getPiece(move.toRow, move.toCol);
            move.orderScore = 0;
            if (targetPiece) { // Prioritize captures of high-value pieces by low-value pieces
                move.orderScore = 1000 + targetPiece.value - move.piece.value;
            }
             // Small bonus for moving towards opponent's den (very basic)
             const targetDenRow = Dens[Player.getOpponent(playerToMove)].row;
             if ((playerToMove === Player.PLAYER1 && move.toRow < move.fromRow) || (playerToMove === Player.PLAYER0 && move.toRow > move.fromRow)) {
                 move.orderScore += 5;
             }
        });
        moves.sort((a, b) => b.orderScore - a.orderScore);
    }


    // --- Iterate Through Moves ---
    let bestScore = isMaximizingPlayer ? -Infinity : Infinity;
    let bestMoveForNode = null;

    for (const move of moves) {
        // Simulate the move
        const newBoard = currentBoard.clone();
        const pieceToMove = newBoard.getPiece(move.fromRow, move.fromCol); // Get piece from the *cloned* board
        const capturedPiece = newBoard.getPiece(move.toRow, move.toCol); // Get potential capture from *cloned* board

        if (!pieceToMove) { // Should not happen if getAllPossibleMovesForPlayer is correct
            console.error("AI Error: Piece to move not found in simulation!", move);
            continue;
        }

        newBoard.setPiece(move.toRow, move.toCol, pieceToMove);
        newBoard.setPiece(move.fromRow, move.fromCol, null);

        // Calculate hash for the next state *incrementally*
        const nextHash = updateZobristKey(currentHash, playerToMove, pieceToMove, move.fromRow, move.fromCol, move.toRow, move.toCol, capturedPiece);

        // Recursive call
        let evalScore;
        try {
            evalScore = alphaBeta(newBoard, nextHash, depth - 1, alpha, beta, !isMaximizingPlayer, aiPlayer, startTime, timeLimit);
        } catch (e) {
            if (e instanceof TimeLimitExceededError) throw e; // Propagate timeout upwards
            console.error("AI Error: Recursive alphaBeta call failed.", e);
            evalScore = isMaximizingPlayer ? LOSE_SCORE : WIN_SCORE; // Penalize errors
        }

        // Update alpha/beta and best move
        if (isMaximizingPlayer) {
            if (evalScore > bestScore) {
                bestScore = evalScore;
                bestMoveForNode = move; // Store the move that led to this score
            }
            alpha = Math.max(alpha, bestScore);
        } else { // Minimizing player
            if (evalScore < bestScore) {
                bestScore = evalScore;
                bestMoveForNode = move;
            }
            beta = Math.min(beta, bestScore);
        }

        // Alpha-beta cutoff
        if (beta <= alpha) {
            break;
        }
    }

    // --- Store Result in Transposition Table ---
    let flag;
    if (bestScore <= originalAlpha) {
        flag = ZOBRIST_HASH_FLAGS.UPPERBOUND; // Failed low (didn't improve alpha)
    } else if (bestScore >= beta) {
        flag = ZOBRIST_HASH_FLAGS.LOWERBOUND; // Failed high (caused beta cutoff)
    } else {
        flag = ZOBRIST_HASH_FLAGS.EXACT; // Exact score found within alpha-beta window
    }

    // Store only if new, deeper, or an exact score replacing bounds
     if (!ttEntry || depth >= ttEntry.depth || flag === ZOBRIST_HASH_FLAGS.EXACT ) {
         // Store only the coordinates for the best move to save memory
         const bestMoveCoords = bestMoveForNode ? {
             fromRow: bestMoveForNode.fromRow, fromCol: bestMoveForNode.fromCol,
             toRow: bestMoveForNode.toRow, toCol: bestMoveForNode.toCol
         } : null;
         transpositionTable.set(hashKey, { score: bestScore, depth: depth, flag: flag, bestMove: bestMoveCoords });
     }

    return bestScore;
}


/**
 * Finds the best move for the AI using iterative deepening alpha-beta search.
 * @param {Board} initialBoard The current state of the board.
 * @param {number} aiPlayer The player identifier for the AI.
 * @param {number} maxDepth The maximum target search depth.
 * @param {number} timeLimit The maximum time allowed in milliseconds.
 * @returns {{move: {piece: Piece, fromRow: number, fromCol: number, toRow: number, toCol: number} | null, depthAchieved: number, score: number}}
 */
export function findBestMove(initialBoard, aiPlayer, maxDepth, timeLimit) {
    const startTime = performance.now();
    aiRunCounter = 0; // Reset node count
    // Consider clearing TT selectively or based on game state changes if needed
    // transpositionTable.clear(); // Clear TT for each move calculation? Might hurt performance.

    let bestMoveOverall = null;
    let lastCompletedDepth = 0;
    let bestScoreOverall = -Infinity; // AI wants to maximize

    let rootMoves;
    try {
        rootMoves = getAllPossibleMovesForPlayer(initialBoard, aiPlayer);
    } catch (e) {
        console.error("AI Error: Failed to get initial moves.", e);
        return { move: null, depthAchieved: 0, score: -Infinity };
    }

    if (rootMoves.length === 0) {
        console.log("AI Info: No legal moves available.");
        return { move: null, depthAchieved: 0, score: evaluateBoard(initialBoard, aiPlayer) }; // Return static eval if no moves
    }

     // --- Initial Move Ordering ---
     const initialHash = computeZobristKey(initialBoard, aiPlayer);
     const rootTtEntry = transpositionTable.get(initialHash);
     if(rootTtEntry?.bestMove) {
         const bm = rootTtEntry.bestMove;
         const idx = rootMoves.findIndex(m => m.fromRow === bm.fromRow && m.fromCol === bm.fromCol && m.toRow === bm.toRow && m.toCol === bm.toCol);
         if(idx > 0) rootMoves.unshift(rootMoves.splice(idx, 1)[0]);
     } else {
          rootMoves.forEach(move => {
             const targetPiece = initialBoard.getPiece(move.toRow, move.toCol);
             move.orderScore = 0;
             if (targetPiece) move.orderScore = 1000 + targetPiece.value - move.piece.value;
             const targetDenRow = Dens[Player.getOpponent(aiPlayer)].row;
             if (move.toRow < move.fromRow) move.orderScore += 5; // Simple forward bonus for P1
         });
         rootMoves.sort((a, b) => b.orderScore - a.orderScore);
     }

    // --- Iterative Deepening Loop ---
    try {
        for (let currentDepth = 1; currentDepth <= maxDepth; currentDepth++) {
            const timeBeforeIter = performance.now();
            if (timeBeforeIter - startTime > timeLimit) {
                console.log(`AI Info: Timeout before starting depth ${currentDepth}. Using result from depth ${lastCompletedDepth}.`);
                break;
            }

            let bestScoreThisIteration = -Infinity;
            let bestMoveThisIteration = null;
            let alpha = -Infinity;
            let beta = Infinity;
            const iterationNodeCountStart = aiRunCounter;

            // Re-sort moves based on previous iteration's TT hints if available?
            // (Already handled partially by initial TT sort)

            for (const move of rootMoves) {
                const pieceToMove = initialBoard.getPiece(move.fromRow, move.fromCol); // Get piece from ORIGINAL board
                if (!pieceToMove) continue;

                // Simulate move on a clone
                const newBoard = initialBoard.clone();
                const movedPieceClone = newBoard.getPiece(move.fromRow, move.fromCol);
                const capturedPieceClone = newBoard.getPiece(move.toRow, move.toCol);
                newBoard.setPiece(move.toRow, move.toCol, movedPieceClone);
                newBoard.setPiece(move.fromRow, move.fromCol, null);

                const nextHash = updateZobristKey(initialHash, aiPlayer, pieceToMove, move.fromRow, move.fromCol, move.toRow, move.toCol, capturedPieceClone);

                // Start recursion (minimizing player's turn)
                const score = alphaBeta(newBoard, nextHash, currentDepth - 1, alpha, beta, false, aiPlayer, startTime, timeLimit);

                if (score > bestScoreThisIteration) {
                    bestScoreThisIteration = score;
                    // Store the move using the piece from the *original* board
                    bestMoveThisIteration = { ...move, piece: pieceToMove };
                }
                alpha = Math.max(alpha, score); // Update alpha for root node
                 // No beta cutoff at root, we need to check all moves
            }

             // Check time *after* completing the iteration
            const timeAfterIter = performance.now();
            if (timeAfterIter - startTime > timeLimit) {
                 console.log(`AI Info: Timeout DURING depth ${currentDepth}. Using result from depth ${lastCompletedDepth}.`);
                break; // Exit loop, use previous result
            }

            // --- Iteration Complete ---
            lastCompletedDepth = currentDepth;
            if (bestMoveThisIteration) { // Only update if a valid move was found this iter
                 bestMoveOverall = bestMoveThisIteration;
                 bestScoreOverall = bestScoreThisIteration; // Update overall score

                  // Optional: Reorder rootMoves based on scores from this iteration for the next depth
                 // Find index of bestMoveOverall and move it to front?

            } else if (!bestMoveOverall && rootMoves.length > 0){
                 // Fallback if first iteration fails? Should not happen if rootMoves exist.
                 console.warn(`AI Warning: No best move found at depth ${currentDepth}, using first legal move.`);
                 bestMoveOverall = { ...rootMoves[0], piece: initialBoard.getPiece(rootMoves[0].fromRow, rootMoves[0].fromCol) };
                 bestScoreOverall = -Infinity; // Mark score as uncertain
            }


            const iterNodes = aiRunCounter - iterationNodeCountStart;
            const scoreDisp = bestScoreOverall === -Infinity ? "-Inf" : bestScoreOverall === Infinity ? "+Inf" : bestScoreOverall.toFixed(0);
            console.log(
                `AI Depth ${currentDepth} done. ` +
                `Score: ${scoreDisp}. ` +
                `Move: ${bestMoveOverall?.piece?.symbol}(${bestMoveOverall?.fromRow},${bestMoveOverall?.fromCol})->(${bestMoveOverall?.toRow},${bestMoveOverall?.toCol}). ` +
                `Nodes: ${iterNodes} (Total: ${aiRunCounter}). TT Size: ${transpositionTable.size}. `+
                `Time: ${(timeAfterIter - startTime).toFixed(0)}ms`
            );

            // Early exit if a winning move is found (or unavoidable loss)
            // Adjust threshold slightly to avoid floating point issues
            if (bestScoreOverall >= WIN_SCORE * 0.95 || bestScoreOverall <= LOSE_SCORE * 0.95) {
                 console.log(`AI Info: Terminal score (${bestScoreOverall.toFixed(0)}) found at depth ${currentDepth}. Stopping search.`);
                 break;
             }
        }

    } catch (error) {
        if (error instanceof TimeLimitExceededError) {
            console.warn(`AI Warning: Search terminated by timeout. Using best move from depth ${lastCompletedDepth}.`);
        } else {
            console.error("AI Error: Unexpected error during search:", error);
             // Fallback to first legal move if error occurred and no move found yet
             if (!bestMoveOverall && rootMoves.length > 0) {
                 console.error("AI Fallback: Using first legal move due to error.");
                 bestMoveOverall = { ...rootMoves[0], piece: initialBoard.getPiece(rootMoves[0].fromRow, rootMoves[0].fromCol) };
                 bestScoreOverall = -Infinity;
             }
        }
    }

     // Final fallback if absolutely no move was selected (e.g., timed out before depth 1 finished)
     if (!bestMoveOverall && rootMoves.length > 0) {
         console.warn("AI Warning: No move selected (timeout/error before D1?). Selecting first legal move.");
         bestMoveOverall = { ...rootMoves[0], piece: initialBoard.getPiece(rootMoves[0].fromRow, rootMoves[0].fromCol) };
         bestScoreOverall = -Infinity; // Score is unreliable
     }

    const endTime = performance.now();
    const finalScoreDisp = bestScoreOverall === -Infinity ? "-Inf" : bestScoreOverall === Infinity ? "+Inf" : bestScoreOverall.toFixed(0);
    console.log(
        `AI Final Choice: ${bestMoveOverall?.piece?.symbol}(${bestMoveOverall?.fromRow},${bestMoveOverall?.fromCol})->(${bestMoveOverall?.toRow},${bestMoveOverall?.toCol}). ` +
        `Depth: ${lastCompletedDepth}. Score: ${finalScoreDisp}. Nodes: ${aiRunCounter}. Time: ${(endTime - startTime).toFixed(0)}ms`
    );


    return {
        move: bestMoveOverall, // Contains the original piece object and coords
        depthAchieved: lastCompletedDepth,
        score: bestScoreOverall
    };
}