// --- START OF js/aiWorker.js ---

/**
 * AI Worker (aiWorker.js)
 * Runs the AI logic (Minimax with Alpha-Beta Pruning and Iterative Deepening)
 * in a separate thread to avoid blocking the main UI thread.
 */

// --- Constants ---
// Board dimensions and terrain types (must match main thread constants.js)
const ROWS = 9;
const COLS = 7;
const LAND = 0;
const WATER = 1;
const TRAP = 2;
const PLAYER0_DEN = 3; // Blue's Den (Player 0)
const PLAYER1_DEN = 4; // Red's Den (Player 1 / AI)

// Player identifiers
const PLAYER = 0; // Blue (Human)
const AI = 1;     // Red (This worker's player)

// Piece information (Rank, Name, Symbol, AI Evaluation Value)
const PIECES = {
    rat:     { rank: 1, name: 'Rat',     symbol: '🐀', value: 100 },
    cat:     { rank: 2, name: 'Cat',     symbol: '🐈', value: 200 },
    dog:     { rank: 3, name: 'Dog',     symbol: '🐕', value: 300 },
    wolf:    { rank: 4, name: 'Wolf',    symbol: '🐺', value: 400 },
    leopard: { rank: 5, name: 'Leopard', symbol: '🐆', value: 500 },
    tiger:   { rank: 6, name: 'Tiger',   symbol: '🐅', value: 700 },
    lion:    { rank: 7, name: 'Lion',    symbol: '🦁', value: 800 },
    elephant:{ rank: 8, name: 'Elephant',symbol: '🐘', value: 650 }
};

// Den coordinates
const PLAYER0_DEN_ROW = 8;
const PLAYER0_DEN_COL = 3;
const PLAYER1_DEN_ROW = 0;
const PLAYER1_DEN_COL = 3;

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
    for (const pieceKey in PIECES) {
        const nameLower = pieceKey.toLowerCase();
        // Assign index if new piece type
        if (!pieceNameToIndex.hasOwnProperty(nameLower)) {
            pieceNameToIndex[nameLower] = pieceIndexCounter++;
            zobristTable[pieceNameToIndex[nameLower]] = []; // Initialize array for this piece type
        }
        const index = pieceNameToIndex[nameLower];
        // Initialize arrays for players and rows
        zobristTable[index][PLAYER] = [];
        zobristTable[index][AI] = [];
        for (let r = 0; r < ROWS; r++) {
            zobristTable[index][PLAYER][r] = [];
            zobristTable[index][AI][r] = [];
            for (let c = 0; c < COLS; c++) {
                // Assign random keys for each piece/player/square combination
                zobristTable[index][PLAYER][r][c] = randomBigInt();
                zobristTable[index][AI][r][c] = randomBigInt();
            }
        }
    }
    // Assign random key for the turn indicator (AI's turn)
    zobristBlackToMove = randomBigInt();
    /* console.log("[Worker] Zobrist Initialized."); */
}

// Initialize Zobrist keys when the worker loads
initializeZobrist();

/**
 * Computes the Zobrist hash key for a given board state and player to move.
 * @param {Array<Array<object>>} currentBoard - The board state.
 * @param {number} playerToMove - The player whose turn it is (PLAYER or AI).
 * @returns {bigint} The Zobrist hash key.
 */
function computeZobristKey(currentBoard, playerToMove) {
    let key = 0n; // Use BigInt for the key

    for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
            const square = currentBoard[r]?.[c];
            const piece = square?.piece; // Safe access

            if (piece && piece.name) { // Ensure piece and its name exist
                const pieceNameLower = piece.name.toLowerCase();
                const pieceIndex = pieceNameToIndex[pieceNameLower];

                // Validate indices and existence of the Zobrist key
                if (pieceIndex !== undefined &&
                    (piece.player === PLAYER || piece.player === AI) &&
                    r >= 0 && r < ROWS &&
                    c >= 0 && c < COLS &&
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
    if (playerToMove === AI) {
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
 * Gets the effective rank of a piece, considering traps.
 * @param {object|null} piece - The piece object.
 * @param {number} r - Row of the piece.
 * @param {number} c - Column of the piece.
 * @param {Array<Array<object>>} currentBoard - The current board state.
 * @returns {number} The effective rank (0 if trapped by opponent, normal rank otherwise).
 */
function getPieceRank(piece, r, c, currentBoard) {
    if (!piece) return 0;

    const terrain = currentBoard[r]?.[c]?.terrain;
    if (terrain === TRAP) {
        // Check if it's an opponent's trap
        const isOpponentTrap = (piece.player === PLAYER && r <= 1) || (piece.player === AI && r >= 7);
        if (isOpponentTrap) {
            // Define trap locations explicitly for clarity
            const trapLocations = [
                { r: 0, c: 2 }, { r: 0, c: 4 }, { r: 1, c: 3 }, // Player 1 (AI) traps
                { r: 8, c: 2 }, { r: 8, c: 4 }, { r: 7, c: 3 }  // Player 0 (Human) traps
            ];
            // If the piece is on any of these specific trap locations AND it's an opponent's trap
            if (trapLocations.some(trap => trap.r === r && trap.c === c)) {
                return 0; // Rank is reduced to 0 in opponent's trap
            }
        }
    }
    return piece.rank; // Return normal rank otherwise
}

/**
 * Checks if an attacking piece can capture a defending piece.
 */
function canCapture(attackerPiece, defenderPiece, attR, attC, defR, defC, currentBoard) {
    if (!attackerPiece || !defenderPiece || attackerPiece.player === defenderPiece.player) {
        return false;
    }

    const attTerrain = currentBoard[attR]?.[attC]?.terrain;
    const defTerrain = currentBoard[defR]?.[defC]?.terrain;

    // Basic validation
    if (attTerrain === undefined || defTerrain === undefined) return false;

    // Water rules (Simplified based on original logic interpretation)
    // Cannot attack from Water onto Land (unless Rat vs Rat - handled by rank check)
    if (attTerrain === WATER && defTerrain !== WATER) return false;
    // Only Rat can attack from water
    if (attTerrain === WATER && attackerPiece.name !== 'Rat') return false;
    // Rat cannot attack Elephant from water
    if (attTerrain === WATER && attackerPiece.name === 'Rat' && defenderPiece.name === 'Elephant') return false;

    // Special case: Rat captures Elephant (only if Rat is on Land)
    if (attackerPiece.name === 'Rat' && defenderPiece.name === 'Elephant') {
        return attTerrain !== WATER;
    }
    // Special case: Elephant cannot capture Rat
    if (attackerPiece.name === 'Elephant' && defenderPiece.name === 'Rat') {
        return false;
    }

    // General case: Compare effective ranks (considers traps)
    const attackerRank = getPieceRank(attackerPiece, attR, attC, currentBoard);
    const defenderRank = getPieceRank(defenderPiece, defR, defC, currentBoard);
    return attackerRank >= defenderRank;
}

/** Checks if a given coordinate is within the river area. */
function isRiver(r, c) {
    return r >= 3 && r <= 5 && (c === 1 || c === 2 || c === 4 || c === 5);
}

/**
 * Gets all possible destination squares for a piece from its current position.
 * Returns array of {row, col} objects.
 */
function getPossibleMoves(piece, r, c, currentBoard) {
    const moves = [];
    if (!piece) return moves;

    const player = piece.player;
    const pieceName = piece.name;

    // 1. Orthogonal Moves
    const potentialMoves = [
        { dr: -1, dc: 0 }, { dr: 1, dc: 0 }, { dr: 0, dc: -1 }, { dr: 0, dc: 1 }
    ];

    potentialMoves.forEach(move => {
        const nr = r + move.dr;
        const nc = c + move.dc;

        // Check bounds
        if (nr < 0 || nr >= ROWS || nc < 0 || nc >= COLS) return;

        const targetCell = currentBoard[nr]?.[nc];
        if (!targetCell) return;

        const targetPiece = targetCell.piece;
        const targetTerrain = targetCell.terrain;
        const ownDen = (player === PLAYER) ? PLAYER0_DEN : PLAYER1_DEN;

        // Rule: Cannot move into own Den
        if (targetTerrain === ownDen) return;
        // Rule: Only Rat can enter Water
        if (targetTerrain === WATER && pieceName !== 'Rat') return;
        // Rule: Cannot move onto own piece
        if (targetPiece?.player === player) return;
        // Rule: Check capture validity if opponent piece is present
        if (targetPiece && !canCapture(piece, targetPiece, r, c, nr, nc, currentBoard)) return;

        // Valid move
        moves.push({ row: nr, col: nc });
    });

    // 2. Special Jumps (Lion, Tiger)
    if (pieceName === 'Lion' || pieceName === 'Tiger') {
        const checkJump = (targetRow, targetCol, riverCols, riverRows) => {
            // Bounds check
            if (targetRow < 0 || targetRow >= ROWS || targetCol < 0 || targetCol >= COLS) return;

            // Check if river path is clear (no blocking pieces)
            for (let i = 0; i < riverRows.length; i++) {
                const riverR = riverRows[i];
                const riverC = riverCols[i];
                if (!isRiver(riverR, riverC) || currentBoard[riverR]?.[riverC]?.piece) {
                    return; // Path blocked or not river
                }
            }

            // Check target square validity
            const targetCell = currentBoard[targetRow]?.[targetCol];
            if (!targetCell) return;
            const targetPiece = targetCell.piece;
            const targetTerrain = targetCell.terrain;
            const ownDen = (player === PLAYER) ? PLAYER0_DEN : PLAYER1_DEN;

            // Cannot land in Water or own Den
            if (targetTerrain === WATER || targetTerrain === ownDen) return;
            // Cannot land on own piece
            if (targetPiece?.player === player) return;
            // Check capture validity if opponent piece is present
            if (targetPiece && !canCapture(piece, targetPiece, r, c, targetRow, targetCol, currentBoard)) return;

            // Valid jump
            moves.push({ row: targetRow, col: targetCol });
        };

        // Vertical Jumps
        if (isRiver(3, c)) { // Check columns adjacent to vertical river
            if (r === 2) checkJump(6, c, [c, c, c], [3, 4, 5]); // Jump down over river
            else if (r === 6) checkJump(2, c, [c, c, c], [5, 4, 3]); // Jump up over river
        }

        // Horizontal Jumps (Lion only)
        if (pieceName === 'Lion') {
            if (c === 0 && isRiver(r, 1) && isRiver(r, 2)) checkJump(r, 3, [1, 2], [r, r]); // Jump right from col 0
            else if (c === 3) {
                if (isRiver(r, 1) && isRiver(r, 2)) checkJump(r, 0, [1, 2], [r, r]); // Jump left from col 3
                if (isRiver(r, 4) && isRiver(r, 5)) checkJump(r, 6, [4, 5], [r, r]); // Jump right from col 3
            } else if (c === 6 && isRiver(r, 4) && isRiver(r, 5)) checkJump(r, 3, [4, 5], [r, r]); // Jump left from col 6
        }
    }

    // Deduplicate moves (shouldn't be necessary with current logic, but safe)
    const uniqueMoves = [];
    const seen = new Set();
    moves.forEach(m => {
        const key = `${m.row}-${m.col}`;
        if (!seen.has(key)) {
            uniqueMoves.push(m);
            seen.add(key);
        }
    });
    return uniqueMoves;
}

/**
 * Gets all possible moves for a given player.
 * Returns array of move objects: { pieceData, fromRow, fromCol, toRow, toCol }
 */
function getAllPossibleMovesForPlayer(player, currentBoard) {
    const allMoves = [];
    for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
            const piece = currentBoard[r]?.[c]?.piece;
            if (piece?.player === player) {
                try {
                    const possibleDests = getPossibleMoves(piece, r, c, currentBoard);
                    possibleDests.forEach(dest => {
                        allMoves.push({
                            pieceData: piece, // Pass the actual piece data
                            fromRow: r,
                            fromCol: c,
                            toRow: dest.row,
                            toCol: dest.col
                        });
                    });
                } catch (e) {
                    console.error(`Error getting moves for piece at ${r},${c}`, e);
                    // ignore and continue
                }
            }
        }
    }
    return allMoves;
}

/**
 * Checks if the game has reached a terminal state (win/loss/draw).
 * Returns { isTerminal: boolean, winner: PLAYER | AI | null }
 */
function checkTerminalState(currentBoard) {
    // Check Den entry
    const player1DenPiece = currentBoard[PLAYER1_DEN_ROW]?.[PLAYER1_DEN_COL]?.piece;
    const player0DenPiece = currentBoard[PLAYER0_DEN_ROW]?.[PLAYER0_DEN_COL]?.piece;

    if (player1DenPiece?.player === PLAYER) return { isT: true, w: PLAYER }; // Player 0 wins
    if (player0DenPiece?.player === AI) return { isT: true, w: AI };     // Player 1 (AI) wins

    // Check if all pieces of one player are captured
    let player0Count = 0;
    let player1Count = 0;
    for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
            const piece = currentBoard[r]?.[c]?.piece;
            if (piece) {
                if (piece.player === PLAYER) player0Count++;
                else player1Count++;
            }
        }
    }

    if (player1Count === 0 && player0Count > 0) return { isT: true, w: PLAYER }; // Player 0 wins
    if (player0Count === 0 && player1Count > 0) return { isT: true, w: AI };     // Player 1 (AI) wins
    if (player0Count === 0 && player1Count === 0) return { isT: true, w: null };   // Draw? (Or last player to capture wins?) - Assuming Draw

    // Game is not terminal
    return { isT: false, w: null };
}

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

/** Checks if two move objects represent the same move. */
function movesAreEqual(move1, move2) {
    if (!move1 || !move2) return false;
    return move1.fromRow === move2.fromRow &&
           move1.fromCol === move2.fromCol &&
           move1.toRow === move2.toRow &&
           move1.toCol === move2.toCol;
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
    // 1. Check for Terminal State (Win/Loss)
    let termState = checkTerminalState(currentBoard);
    if (termState.isT) {
        if (termState.w === AI) return WIN_SCORE;
        if (termState.w === PLAYER) return LOSE_SCORE;
        return 0; // Draw
    }

    // 2. Heuristic Evaluation (if not terminal)
    const HEURISTIC_WEIGHTS = {
        MATERIAL: 1.0,          // Value of pieces
        ADVANCEMENT: 0.25,      // How far pieces have moved forward
        DEN_PROXIMITY: 6.0,     // How close pieces are to the opponent's den
        ATTACK_THREAT: 1.5,     // Bonus for threatening opponent pieces
        KEY_SQUARE: 0.5,        // Bonus for occupying important squares (Placeholder)
        TRAPPED_PENALTY: -3.0,  // Penalty for being in an opponent's trap
        DEFENSE_PENALTY: -0.7   // Penalty for pieces being too far back (defensive posture)
    };

    let aiScore = 0;
    let playerScore = 0;
    const piecesByPlayer = { [PLAYER]: [], [AI]: [] }; // Collect pieces for easier processing

    // Iterate through the board once to collect pieces and calculate basic scores
    for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
            const cell = currentBoard[r]?.[c];
            if (!cell) continue;
            const piece = cell.piece;
            if (!piece) continue;

            const player = piece.player;
            const pieceKey = piece.name.toLowerCase();
            const value = PIECES[pieceKey]?.value ?? 0;

            // Store piece info for later heuristics
            piecesByPlayer[player].push({ ...piece, r, c, terrain: cell.terrain });

            let scoreRef = (player === AI) ? aiScore : playerScore;

            // a) Material Score
            scoreRef += value * HEURISTIC_WEIGHTS.MATERIAL;

            // b) Advancement Score (scaled by piece value)
            const advancement = (player === AI) ? r : (ROWS - 1 - r); // Rows advanced towards opponent
            scoreRef += advancement * HEURISTIC_WEIGHTS.ADVANCEMENT * (value / 150.0);

            // c) Defense Penalty (for non-Rats too close to own baseline)
            if (pieceKey !== 'rat') {
                if (player === AI && r < 3) { // AI piece near row 0
                    scoreRef += (r - 3) * HEURISTIC_WEIGHTS.DEFENSE_PENALTY * (value / 100.0); // Penalty increases closer to row 0
                }
                if (player === PLAYER && r > 5) { // Player piece near row 8
                    scoreRef += ((ROWS - 1 - r) - 3) * HEURISTIC_WEIGHTS.DEFENSE_PENALTY * (value / 100.0); // Penalty increases closer to row 8
                }
            }

            // d) Trapped Penalty
            if (getPieceRank(piece, r, c, currentBoard) === 0 && cell.terrain === TRAP) {
                // Check if it's an opponent's trap (rank is 0 only in opponent's trap)
                 scoreRef += HEURISTIC_WEIGHTS.TRAPPED_PENALTY * (value / 100.0);
            }

            // Update the correct player's score
            if (player === AI) aiScore = scoreRef;
            else playerScore = scoreRef;
        }
    }

    // Check for wipeout (should be caught by terminal check, but safe)
    if (piecesByPlayer[AI].length === 0 && piecesByPlayer[PLAYER].length > 0) return LOSE_SCORE;
    if (piecesByPlayer[PLAYER].length === 0 && piecesByPlayer[AI].length > 0) return WIN_SCORE;

    // 3. More Complex Heuristics (using collected pieces)

    // e) Den Proximity Bonus
    piecesByPlayer[AI].forEach(p => {
        const dist = Math.abs(p.r - PLAYER0_DEN_ROW) + Math.abs(p.c - PLAYER0_DEN_COL);
        const advancementFactor = (p.r >= 4) ? 1.0 : 0.1; // Bonus stronger if past halfway
        aiScore += Math.max(0, 15 - dist) * HEURISTIC_WEIGHTS.DEN_PROXIMITY * (p.value / 150.0) * advancementFactor;
    });
    piecesByPlayer[PLAYER].forEach(p => {
        const dist = Math.abs(p.r - PLAYER1_DEN_ROW) + Math.abs(p.c - PLAYER1_DEN_COL);
        const advancementFactor = (p.r <= 4) ? 1.0 : 0.1; // Bonus stronger if past halfway
        playerScore += Math.max(0, 15 - dist) * HEURISTIC_WEIGHTS.DEN_PROXIMITY * (p.value / 150.0) * advancementFactor;
    });

    // f) Attack Threat Bonus (pieces threatening opponent pieces)
    const calculateAttackThreat = (attackerPlayer, defenderPlayer) => {
        let threatBonus = 0;
        for (const attacker of piecesByPlayer[attackerPlayer]) {
            const potentialMoves = [
                { r: attacker.r - 1, c: attacker.c }, { r: attacker.r + 1, c: attacker.c },
                { r: attacker.r, c: attacker.c - 1 }, { r: attacker.r, c: attacker.c + 1 }
            ];
            for (const move of potentialMoves) {
                if (move.r >= 0 && move.r < ROWS && move.c >= 0 && move.c < COLS) {
                    const targetPiece = currentBoard[move.r]?.[move.c]?.piece;
                    if (targetPiece?.player === defenderPlayer) {
                        const targetValue = PIECES[targetPiece.name.toLowerCase()]?.value ?? 0;
                        // Bonus if can actually capture, smaller bonus if just adjacent/threatening
                        if (canCapture(attacker, targetPiece, attacker.r, attacker.c, move.r, move.c, currentBoard)) {
                            threatBonus += targetValue * HEURISTIC_WEIGHTS.ATTACK_THREAT / 100.0;
                        } else {
                            // Smaller bonus for just being near an opponent piece? (Original had this)
                             threatBonus += targetValue * (HEURISTIC_WEIGHTS.ATTACK_THREAT / 4.0) / 100.0;
                        }
                    }
                }
            }
             // Consider adding threats from jumps for Lion/Tiger here if desired
        }
        return threatBonus;
    };
    aiScore += calculateAttackThreat(AI, PLAYER);
    playerScore += calculateAttackThreat(PLAYER, AI);

    // g) Specific Piece Interaction Bonuses (e.g., Rat near Elephant)
    const findPiece = (type, player) => piecesByPlayer[player].find(p => p.name.toLowerCase() === type);

    const aiRat = findPiece('rat', AI);
    const playerElephant = findPiece('elephant', PLAYER);
    if (aiRat && playerElephant && currentBoard[aiRat.r]?.[aiRat.c]?.terrain !== WATER) {
        const dist = Math.abs(aiRat.r - playerElephant.r) + Math.abs(aiRat.c - playerElephant.c);
        if (dist <= 2) aiScore += (3 - dist) * 3.0; // Bonus for AI Rat being close to Player Elephant
    }

    const playerRat = findPiece('rat', PLAYER);
    const aiElephant = findPiece('elephant', AI);
    if (playerRat && aiElephant && currentBoard[playerRat.r]?.[playerRat.c]?.terrain !== WATER) {
        const dist = Math.abs(playerRat.r - aiElephant.r) + Math.abs(playerRat.c - aiElephant.c);
        if (dist <= 2) playerScore += (3 - dist) * 3.0; // Bonus for Player Rat being close to AI Elephant
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
    aiRunCounter++; // Increment node counter

    // Check for timeout
    if (performance.now() - startTime > timeLimit) {
        throw new TimeLimitExceededError();
    }

    const originalAlpha = alpha; // Store original alpha for TT flag determination
    const hashKey = currentHash;

    // 1. Transposition Table Lookup
    const ttEntry = transpositionTable.get(hashKey);
    if (ttEntry && ttEntry.depth >= depth) {
        if (ttEntry.flag === HASH_EXACT) return ttEntry.score;
        if (ttEntry.flag === HASH_LOWERBOUND) alpha = Math.max(alpha, ttEntry.score);
        if (ttEntry.flag === HASH_UPPERBOUND) beta = Math.min(beta, ttEntry.score);
        if (alpha >= beta) return ttEntry.score; // Pruning based on TT entry
    }

    // 2. Terminal State Check & Base Case (Depth 0)
    let termState = checkTerminalState(currentBoard);
    if (termState.isT || depth === 0) {
        let baseScore = evaluateBoard(currentBoard);
        // Depth-Based Mate scoring (optional, helps find faster mates)
        if (termState.isT && termState.w !== null) {
            const MATE_DEPTH_BONUS = 10; // Small bonus per ply remaining
            if (termState.w === AI) baseScore += depth * MATE_DEPTH_BONUS;
            if (termState.w === PLAYER) baseScore -= depth * MATE_DEPTH_BONUS;
        }
        // Store leaf node evaluation in TT if better than existing or no entry
        if (!ttEntry || ttEntry.depth < depth) {
             transpositionTable.set(hashKey, { score: baseScore, depth: depth, flag: HASH_EXACT, bestMove: null });
        }
        return baseScore;
    }

    // 3. Generate and Order Moves
    const playerToMove = isMaximizingPlayer ? AI : PLAYER;
    let moves;
    try {
        moves = getAllPossibleMovesForPlayer(playerToMove, currentBoard);
    } catch (e) {
        console.error(`Error generating moves for player ${playerToMove}`, e);
        return isMaximizingPlayer ? -Infinity : Infinity; // Return worst score on error
    }

    // If no moves available, it's a stalemate/loss for the current player
    if (moves.length === 0) {
        // Evaluate board directly (might be win for opponent if all pieces captured)
        return evaluateBoard(currentBoard);
    }

    // Move Ordering Heuristics
    const hashMove = ttEntry?.bestMove; // Move from Transposition Table
    const killerMove1 = (ply >= 0 && ply < MAX_PLY_FOR_KILLERS) ? killerMoves[ply]?.[0] : null;
    const killerMove2 = (ply >= 0 && ply < MAX_PLY_FOR_KILLERS) ? killerMoves[ply]?.[1] : null;

    moves.forEach(move => {
        move.orderScore = 0;
        // Highest priority: Hash move from TT
        if (hashMove && movesAreEqual(move, hashMove)) {
            move.orderScore = 20000;
        }
        // Next: Killer moves
        else if (killerMove1 && movesAreEqual(move, killerMove1)) {
            move.orderScore = 19000;
        } else if (killerMove2 && movesAreEqual(move, killerMove2)) {
            move.orderScore = 18000;
        }
        // Next: Captures (Most Valuable Victim - Least Valuable Attacker)
        else {
            const targetPiece = currentBoard[move.toRow]?.[move.toCol]?.piece;
            if (targetPiece) {
                 const victimValue = PIECES[targetPiece.name.toLowerCase()]?.value ?? 0;
                 const attackerValue = PIECES[move.pieceData?.name?.toLowerCase()]?.value ?? 0;
                 move.orderScore = 1000 + victimValue - attackerValue; // Simple MVV-LVA heuristic
            }
            // Optional: Add scores for moving towards opponent den, etc.
            else {
                 const opponentDenRow = (playerToMove === AI) ? PLAYER0_DEN_ROW : PLAYER1_DEN_ROW;
                 const currentDist = Math.abs(move.fromRow - opponentDenRow);
                 const newDist = Math.abs(move.toRow - opponentDenRow);
                 if (newDist < currentDist) move.orderScore += 5; // Small bonus for advancing
            }
        }
    });

    moves.sort((a, b) => b.orderScore - a.orderScore); // Sort moves descending by score

    // 4. Iterate Through Moves and Recurse
    let bestMoveForNode = null;
    let bestScore = isMaximizingPlayer ? -Infinity : Infinity;

    for (const move of moves) {
        const isCapture = !!currentBoard[move.toRow]?.[move.toCol]?.piece; // Check if it's a capture move
        let simResult;
        try {
            simResult = simulateMoveAndGetHash(currentBoard, move, currentHash);
        } catch (e) {
            console.error("SimulateMoveAndGetHash Error during AlphaBeta", e);
            continue; // Skip this move if simulation fails
        }

        let evalScore;
        try {
            evalScore = alphaBeta(
                simResult.newBoard,
                simResult.newHash,
                depth - 1,
                alpha, // Pass current alpha/beta
                beta,
                !isMaximizingPlayer, // Toggle player type
                startTime,
                timeLimit,
                ply + 1 // Increment ply depth
            );
        } catch (e) {
            if (e instanceof TimeLimitExceededError) throw e; // Propagate timeout upwards
            console.error("Error during recursive alphaBeta call", e);
            // Handle other errors, maybe assign worst score?
            evalScore = isMaximizingPlayer ? -Infinity : Infinity;
        }

        // Update best score and alpha/beta based on maximizing/minimizing player
        if (isMaximizingPlayer) { // AI's turn
            if (evalScore > bestScore) {
                bestScore = evalScore;
                bestMoveForNode = move; // Found a potentially better move
            }
            alpha = Math.max(alpha, bestScore); // Update alpha
            if (beta <= alpha) { // Beta Pruning
                if (!isCapture) recordKillerMove(ply, move); // Record quiet move causing cutoff
                break; // Stop searching this branch
            }
        } else { // Opponent's turn (minimizing)
            if (evalScore < bestScore) {
                bestScore = evalScore;
                bestMoveForNode = move;
            }
            beta = Math.min(beta, bestScore); // Update beta
            if (beta <= alpha) { // Alpha Pruning
                if (!isCapture) recordKillerMove(ply, move);
                break; // Stop searching this branch
            }
        }
    }

    // 5. Store Result in Transposition Table
    let flag;
    if (bestScore <= originalAlpha) {
        flag = HASH_UPPERBOUND; // Failed low (score is at most bestScore)
    } else if (bestScore >= beta) {
        flag = HASH_LOWERBOUND; // Failed high (score is at least bestScore)
    } else {
        flag = HASH_EXACT;     // Score is exact within the alpha-beta window
    }

    // Store if entry is new, deeper, or exact
    if (!ttEntry || depth >= ttEntry.depth || flag === HASH_EXACT) {
         // Store only necessary move info to reduce TT memory usage
         const bestMoveData = bestMoveForNode ? {
             fromRow: bestMoveForNode.fromRow,
             fromCol: bestMoveForNode.fromCol,
             toRow: bestMoveForNode.toRow,
             toCol: bestMoveForNode.toCol
             // No need to store pieceData in TT move record
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

    // Get initial possible moves for the root node
    let rootMoves;
    try {
        rootMoves = getAllPossibleMovesForPlayer(AI, currentBoard);
    } catch (e) {
        console.error("[Worker] Error getting initial moves:", e);
        return { move: null, depthAchieved: 0, nodes: 0, eval: null, error: "Move gen error" };
    }

    if (rootMoves.length === 0) {
        console.warn("[Worker] No moves available for AI.");
        return { move: null, depthAchieved: 0, nodes: 0, eval: null, error: "No moves available" };
    }

    // Calculate initial hash for the root position
    const initialHash = computeZobristKey(currentBoard, AI);

    // Set a default best move (the first legal one) in case of immediate timeout
    const firstMovePiece = currentBoard[rootMoves[0].fromRow]?.[rootMoves[0].fromCol]?.piece;
    if (firstMovePiece) {
        bestMoveOverall = {
            pieceName: firstMovePiece.name, // Send identifying info back
            fromRow: rootMoves[0].fromRow,
            fromCol: rootMoves[0].fromCol,
            toRow: rootMoves[0].toRow,
            toCol: rootMoves[0].toCol
        };
    } else {
         console.error("[Worker] Failed to get piece for the first move.");
         return { move: null, depthAchieved: 0, nodes: 0, eval: null, error: "Fallback piece missing" };
    }


    try {
        // Iterative Deepening Loop
        for (let currentDepth = 1; currentDepth <= maxDepth; currentDepth++) {
            const timeBeforeIter = performance.now();
            const timeElapsed = timeBeforeIter - startTime;

             // Optional: Log start of iteration (can be verbose)
             // console.log(`[Worker IDS] Starting Depth ${currentDepth}. Time Elapsed: ${timeElapsed.toFixed(0)}ms / ${timeLimit}ms`);

            // Check time limit before starting the iteration
            if (timeElapsed > timeLimit) {
                console.log(`[Worker IDS] Timeout BEFORE starting Depth ${currentDepth}`);
                break;
            }

            let bestScoreThisIteration = -Infinity;
            let bestMoveThisIteration = null;
            let alpha = -Infinity; // Reset alpha/beta for each root iteration
            let beta = Infinity;
            let iterationNodeCountStart = aiRunCounter;

            // --- Root Move Ordering ---
            // Try move from previous iteration's TT first
             const ttEntryRoot = transpositionTable.get(initialHash);
             const hashMoveRoot = ttEntryRoot?.bestMove;
             if (hashMoveRoot) {
                 const idx = rootMoves.findIndex(m => movesAreEqual(m, hashMoveRoot));
                 if (idx > 0) {
                     // Move the hash move to the front of the array
                     rootMoves.unshift(rootMoves.splice(idx, 1)[0]);
                 }
             } else {
                 // Simple ordering if no hash move (captures/advancing first)
                 rootMoves.forEach(move => {
                     const tp = currentBoard[move.toRow]?.[move.toCol]?.piece;
                     move.orderScore = 0;
                     if (tp) { // Capture heuristic
                         move.orderScore = 1000 + (PIECES[tp.name.toLowerCase()]?.value ?? 0) - (PIECES[move.pieceData?.name?.toLowerCase()]?.value ?? 0);
                     }
                     // Advancement heuristic (simple version)
                     const opponentDenRow = PLAYER0_DEN_ROW;
                     if (move.toRow > move.fromRow) move.orderScore += 5; // Prefer moving towards opponent
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
                if (!pieceToMove) continue; // Should not happen

                let simResult;
                try {
                    simResult = simulateMoveAndGetHash(currentBoard, move, initialHash);
                } catch (e) {
                    console.error("[Worker] Root SimHash Error", e);
                    continue;
                }

                // Call alphaBeta for the opponent's turn (minimizing player)
                const score = alphaBeta(
                    simResult.newBoard,
                    simResult.newHash,
                    currentDepth - 1, // Depth for the recursive call
                    alpha,
                    beta,
                    false, // It's opponent's turn (minimizing)
                    startTime,
                    timeLimit,
                    0 // Ply starts at 0 for root moves' children
                );

                // Check timeout *after* the call returns (it might throw)
                 if (performance.now() - startTime > timeLimit) {
                     // Don't necessarily trust the score if timeout happened during the call
                     console.log(`[Worker IDS] Timeout during alphaBeta call for move at D${currentDepth}`);
                     // Might need to break outer loop here depending on desired behavior
                 }


                if (score > bestScoreThisIteration) {
                    bestScoreThisIteration = score;
                    // Store necessary info for the move to be returned
                    bestMoveThisIteration = {
                        pieceName: pieceToMove.name,
                        fromRow: move.fromRow,
                        fromCol: move.fromCol,
                        toRow: move.toRow,
                        toCol: move.toCol
                    };
                }
                alpha = Math.max(alpha, score); // Update alpha for the root search

                 // Optional: Root level beta cutoff (less common, but possible)
                 // if (beta <= alpha) { break; }
            } // End loop through root moves

            const timeAfterIter = performance.now();
            const totalTimeElapsed = timeAfterIter - startTime;

             // Optional: Log end of iteration
             // let iterNodes = aiRunCounter - iterationNodeCountStart;
             // const scoreDisp = bestScoreThisIteration === -Infinity ? "-Inf" : bestScoreThisIteration === Infinity ? "+Inf" : bestScoreThisIteration.toFixed(2);
             // console.log(`[Worker IDS] D${currentDepth} OK. Sc:${scoreDisp} (Nodes:${iterNodes}). Total Time: ${totalTimeElapsed.toFixed(0)}ms`);


            // Check time limit again after completing the iteration
            if (totalTimeElapsed > timeLimit) {
                console.log(`[Worker IDS] Timeout AFTER finishing Depth ${currentDepth}`);
                break; // Exit IDS loop
            }

            // If the iteration completed within time, update the overall best move
            lastCompletedDepth = currentDepth;
            if (bestMoveThisIteration) {
                bestMoveOverall = bestMoveThisIteration;
            }
            bestScoreOverall = bestScoreThisIteration;


            // Check for early exit if a winning/losing score is found reliably
            const isNearWin = bestScoreOverall >= WIN_SCORE * 0.9;
            const isNearLoss = bestScoreOverall <= LOSE_SCORE * 0.9;
             if (bestScoreOverall > LOSE_SCORE * 0.9 && (isNearWin || isNearLoss)) {
                 console.log(`[Worker IDS] Early exit: Score ${bestScoreOverall.toFixed(0)} indicates win/loss at Depth ${currentDepth}.`);
                 break; // Exit IDS loop
             }

        } // End Iterative Deepening Loop

    } catch (error) {
        // Handle errors during the search (including TimeLimitExceededError)
        if (!(error instanceof TimeLimitExceededError)) {
            console.error("[Worker IDS] Unexpected search error:", error);
            // Return previous best move if available, along with error message
             return {
                 move: bestMoveOverall, // Send previous best if possible
                 depthAchieved: lastCompletedDepth,
                 nodes: aiRunCounter,
                 eval: bestScoreOverall,
                 error: error.message
             };
        }
        // Timeouts are expected, just fall through to return current best
        console.log("[Worker IDS] Time limit exceeded, returning best move found so far.");
    }

    // Fallback if somehow no move was ever selected (e.g., timeout at depth 1 before first move search finishes)
    if (!bestMoveOverall && rootMoves.length > 0) {
        console.warn("[Worker IDS] Timeout/Error resulted in no best move. Using first legal move.");
        const fm = rootMoves[0];
        const fp = currentBoard[fm.fromRow]?.[fm.fromCol]?.piece;
        if (fp) {
             bestMoveOverall = { pieceName: fp.name, fromRow: fm.fromRow, fromCol: fm.fromCol, toRow: fm.toRow, toCol: fm.toCol };
        } else {
             // This should be extremely rare
             return { move: null, depthAchieved: lastCompletedDepth, nodes: aiRunCounter, eval: bestScoreOverall, error: "Fallback Fail" };
        }
    }

     const finalDuration = performance.now() - startTime;
     console.log(`[Worker] findBestMove finished. Depth Achieved: ${lastCompletedDepth}. Total Time: ${finalDuration.toFixed(0)}ms`);

    // Return the result object
    return {
        move: bestMoveOverall, // Contains { pieceName, fromRow, fromCol, toRow, toCol }
        depthAchieved: lastCompletedDepth,
        nodes: aiRunCounter,
        eval: bestScoreOverall === -Infinity ? null : bestScoreOverall // Return null if search didn't even complete depth 1
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