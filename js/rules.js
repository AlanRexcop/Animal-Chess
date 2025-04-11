// js/rules.js
import { BOARD_ROWS, BOARD_COLS, TerrainType, Player, GameStatus } from './constants.js';

/**
 * Checks if a move is valid considering bounds, orthogonal steps, river rules, and avoiding own den.
 *
 * @param {object} board - The board instance.
 * @param {object} piece - The piece object being moved.
 * @param {number} endRow - The intended ending row.
 * @param {number} endCol - The intended ending column.
 * @returns {boolean} - True if the move is valid, false otherwise.
 */
export function isValidMove(board, piece, endRow, endCol) {
    const startRow = piece.row;
    const startCol = piece.col;
    const pieceType = piece.type;
    const player = piece.player;

    if (endRow < 0 || endRow >= BOARD_ROWS || endCol < 0 || endCol >= BOARD_COLS) {
        return false; // Out of bounds
    }

    if (startRow === endRow && startCol === endCol) {
        return false; // No movement
    }

    const targetTerrain = board.getTerrain(endRow, endCol);
    const startTerrain = board.getTerrain(startRow, startCol);

    if (pieceType === 'lion' || pieceType === 'tiger') {
        const rowDiff = Math.abs(startRow - endRow);
        const colDiff = Math.abs(startCol - endCol);

        if (startRow === endRow && colDiff === 3) { // Horizontal Jump
            const intermediateCol1 = Math.min(startCol, endCol) + 1;
            const intermediateCol2 = Math.max(startCol, endCol) - 1;
            if (board.getTerrain(startRow, intermediateCol1) === TerrainType.RIVER &&
                board.getTerrain(startRow, intermediateCol2) === TerrainType.RIVER &&
                startTerrain !== TerrainType.RIVER && targetTerrain !== TerrainType.RIVER &&
                isRiverJumpPathClear(board, startRow, startCol, endRow, endCol)) {
                return true;
            }
        } else if (startCol === endCol && rowDiff === 4) { // Vertical Jump
            const intermediateRow1 = Math.min(startRow, endRow) + 1;
            const intermediateRow2 = intermediateRow1 + 1;
            const intermediateRow3 = Math.max(startRow, endRow) - 1;
            if (board.getTerrain(intermediateRow1, startCol) === TerrainType.RIVER &&
                board.getTerrain(intermediateRow2, startCol) === TerrainType.RIVER &&
                board.getTerrain(intermediateRow3, startCol) === TerrainType.RIVER &&
                startTerrain !== TerrainType.RIVER && targetTerrain !== TerrainType.RIVER &&
                isRiverJumpPathClear(board, startRow, startCol, endRow, endCol)) {
                return true;
            }
        }
    }

    const rowDiffOrth = Math.abs(startRow - endRow);
    const colDiffOrth = Math.abs(startCol - endCol);

    if (rowDiffOrth + colDiffOrth !== 1) {
        return false; // Not a single orthogonal step or a valid jump
    }

    if (targetTerrain === TerrainType.RIVER && pieceType !== 'rat') {
        return false; // Only rats can enter the river
    }

    if ((player === Player.PLAYER1 && targetTerrain === TerrainType.DEN_P1) ||
        (player === Player.PLAYER2 && targetTerrain === TerrainType.DEN_P2)) {
        return false; // Cannot move into own den
    }

    return true;
}

/**
 * Calculates all valid destination squares for a given piece,
 * ensuring captures are valid according to game rules.
 *
 * @param {object} board - The board instance.
 * @param {object} piece - The piece object attempting to move.
 * @returns {Array<object>} - An array of valid move destination objects {r, c}.
 */
export function getValidMovesForPiece(board, piece) {
    const validDestinations = [];
    if (!piece) {
        console.error("getValidMovesForPiece called without a piece.");
        return validDestinations;
    }

    const startRow = piece.row;
    const startCol = piece.col;
    const pieceType = piece.type;
    const currentPlayer = piece.player;

    // --- Generate Potential Target Coordinates ---
    const potentialTargets = [];
    const orthogonalDeltas = [
        { dr: -1, dc: 0 }, // Up
        { dr: 1, dc: 0 },  // Down
        { dr: 0, dc: -1 }, // Left
        { dr: 0, dc: 1 }   // Right
    ];
    for (const delta of orthogonalDeltas) {
        potentialTargets.push({ r: startRow + delta.dr, c: startCol + delta.dc });
    }

    // Add jump targets only for Lion and Tiger
    if (pieceType === 'lion' || pieceType === 'tiger') {
        // Define jump logic relative to river positions might be safer,
        // but using fixed deltas requires isValidMove to handle river checks correctly.
        const jumpDeltas = [
            // Assuming isValidMove handles the path clearing and river crossing checks
            { dr: -4, dc: 0 }, // Jump Up over river
            { dr: 4, dc: 0 },  // Jump Down over river
            { dr: 0, dc: -3 }, // Jump Left over river
            { dr: 0, dc: 3 }   // Jump Right over river
        ];
        for (const delta of jumpDeltas) {
            potentialTargets.push({ r: startRow + delta.dr, c: startCol + delta.dc });
        }
    }

    // --- Validate Each Potential Target ---
    for (const target of potentialTargets) {
        const endRow = target.r;
        const endCol = target.c;

        // 1. Check basic movement validity (bounds, terrain rules, own den, jumps)
        if (isValidMove(board, piece, endRow, endCol)) {
            // Movement is allowed by terrain/jump rules, now check occupancy/capture

            const destinationPiece = board.getPiece(endRow, endCol);
            const targetTerrain = board.getTerrain(endRow, endCol); // Needed for canCapture

            if (destinationPiece === null) {
                // 2a. Destination is empty: Valid move.
                validDestinations.push({ r: endRow, c: endCol });
            } else {
                // 2b. Destination is occupied. Check if it's an opponent.
                if (destinationPiece.player !== currentPlayer) {
                    // It's an opponent's piece. Check if capture is allowed.
                    if (canCapture(piece, destinationPiece, targetTerrain)) {
                        // Capture is valid according to ranks/traps/etc.
                        validDestinations.push({ r: endRow, c: endCol });
                    }
                    // Else: canCapture returned false, so this is not a valid move.
                }
                // Else: destinationPiece.player === currentPlayer (friendly piece)
                // This is not a valid move (can't move onto own piece).
                // isValidMove *should* ideally already prevent this, but doesn't hurt to be explicit.
            }
        }
        // Else: isValidMove returned false, so don't even consider this target.
    }

    return validDestinations;
}

/**
 * Checks if the intermediate river squares for a potential Lion/Tiger jump are empty.
 *
 * @param {object} board - The board instance.
 * @param {number} startRow - The starting row.
 * @param {number} startCol - The starting column.
 * @param {number} endRow - The ending row.
 * @param {number} endCol - The ending column.
 * @returns {boolean} - True if all intermediate river squares are empty, false otherwise.
 */
export function isRiverJumpPathClear(board, startRow, startCol, endRow, endCol) {
    if (startRow === endRow && Math.abs(startCol - endCol) === 3) { // Horizontal Jump
        const intermediateCol1 = Math.min(startCol, endCol) + 1;
        const intermediateCol2 = Math.max(startCol, endCol) - 1;
        if (board.getPiece(startRow, intermediateCol1) || board.getPiece(startRow, intermediateCol2)) {
            return false; // Path is blocked
        }
        return true;
    } else if (startCol === endCol && Math.abs(startRow - endRow) === 4) { // Vertical Jump
        const intermediateRow1 = Math.min(startRow, endRow) + 1;
        const intermediateRow2 = intermediateRow1 + 1;
        const intermediateRow3 = Math.max(startRow, endRow) - 1;
        if (board.getPiece(intermediateRow1, startCol) ||
            board.getPiece(intermediateRow2, startCol) ||
            board.getPiece(intermediateRow3, startCol)) {
            return false; // Path is blocked
        }
        return true;
    }

    console.warn("isRiverJumpPathClear called with non-jump coordinates:", startRow, startCol, "to", endRow, endCol);
    return false;
}

/**
 * Determines if an attacker piece can capture a defender piece.
 *
 * @param {object} attackerPiece - The attacking piece.
 * @param {object} defenderPiece - The defending piece.
 * @param {TerrainType} targetTerrain - The terrain type the defender is on.
 * @returns {boolean} - True if the capture is valid, false otherwise.
 */
export function canCapture(attackerPiece, defenderPiece, targetTerrain) {
    if (!attackerPiece || !defenderPiece || !attackerPiece.type || !defenderPiece.type) {
        console.error("canCapture called with invalid piece data.");
        return false;
    }

    const attackerType = attackerPiece.type;
    const defenderType = defenderPiece.type;
    const attackerRank = attackerPiece.rank;
    const defenderRank = defenderPiece.rank;
    const attackerPlayer = attackerPiece.player;

    if (attackerType === 'elephant' && defenderType === 'rat') {
        return false; // Elephant cannot capture Rat
    }

    let opponentTrapTerrain = null;
    if (attackerPlayer === Player.PLAYER1 && targetTerrain === TerrainType.TRAP_P2) {
        opponentTrapTerrain = TerrainType.TRAP_P2;
    } else if (attackerPlayer === Player.PLAYER2 && targetTerrain === TerrainType.TRAP_P1) {
        opponentTrapTerrain = TerrainType.TRAP_P1;
    }

    if (targetTerrain === opponentTrapTerrain) {
        return true; // Defender is in an opponent's trap
    }

    if (attackerType === 'rat' && defenderType === 'elephant') {
        return true; // Rat captures Elephant
    }

    return attackerRank >= defenderRank;
}

/**
 * Checks the current board state to determine the game status.
 *
 * @param {object} board - The board instance.
 * @returns {GameStatus} - The current status of the game.
 */
export function getGameStatus(board) {
    let p1PieceCount = 0;
    let p2PieceCount = 0;

    for (let r = 0; r < BOARD_ROWS; r++) {
        for (let c = 0; c < BOARD_COLS; c++) {
            const piece = board.getPiece(r, c);
            const terrain = board.getTerrain(r, c);

            if (piece) {
                if (piece.player === Player.PLAYER1) {
                    p1PieceCount++;
                    if (terrain === TerrainType.DEN_P2) {
                        return GameStatus.P1_WINS;
                    }
                } else if (piece.player === Player.PLAYER2) {
                    p2PieceCount++;
                    if (terrain === TerrainType.DEN_P1) {
                        return GameStatus.P2_WINS;
                    }
                }
            }
        }
    }

    if (p2PieceCount === 0 && p1PieceCount > 0) {
        return GameStatus.P1_WINS;
    }

    if (p1PieceCount === 0 && p2PieceCount > 0) {
        return GameStatus.P2_WINS;
    }

    return GameStatus.ONGOING;
}

/**
 * Calculates all possible valid moves for a given player on the current board state.
 * For AI
 *
 * @param {object} board - The board instance.
 * @param {string} player - The player identifier (e.g., Player.PLAYER1).
 * @returns {Array<object>} - An array of "rich" move objects, each containing
 *                           { piece: Piece, startRow: number, startCol: number, endRow: number, endCol: number }.
 *                           Returns an empty array if no moves are possible.
 */
export function getAllValidMoves(board, player) {
    const allMoves = []; // Initialize an empty array to store all valid moves

    // Iterate through every square on the board
    for (let r = 0; r < BOARD_ROWS; r++) {
        for (let c = 0; c < BOARD_COLS; c++) {
            const piece = board.getPiece(r, c);

            // Check if there's a piece and if it belongs to the current player
            if (piece && piece.player === player) {
                // Get the valid destinations for this specific piece
                // getValidMovesForPiece returns Array<{r, c}>
                const validDestinations = getValidMovesForPiece(board, piece);

                // For each valid destination, create the rich move object
                for (const destination of validDestinations) {
                    const move = {
                        piece: piece,         // The piece object itself
                        startRow: piece.row,  // Starting row (piece's current row)
                        startCol: piece.col,  // Starting column (piece's current col)
                        endRow: destination.r, // Destination row from getValidMovesForPiece
                        endCol: destination.c  // Destination column from getValidMovesForPiece
                    };
                    allMoves.push(move); // Add the detailed move object to the list
                }
            }
        }
    }

    return allMoves; // Return the complete list of possible moves for the player
}
