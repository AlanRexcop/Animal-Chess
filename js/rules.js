// js/rules.js
import { BOARD_ROWS, BOARD_COLS, TerrainType, Player, PieceData, Dens, TrapLocations, GameStatus } from './constants.js';
// Piece class might not be strictly needed if we only pass piece data, but good for type clarity
// import { Piece } from './piece.js';

/**
 * Checks if coordinates are within the river area.
 * @param {number} r Row
 * @param {number} c Column
 * @returns {boolean}
 */
export function isRiver(r, c) {
    // Water definition from original script.js
    return r >= 3 && r <= 5 && (c === 1 || c === 2 || c === 4 || c === 5);
}

/**
 * Calculates the effective rank of a piece considering trap effects.
 * @param {Piece} piece The piece object.
 * @param {number} r The piece's row.
 * @param {number} c The piece's column.
 * @param {Board} board The Board instance.
 * @returns {number} The effective rank (0 if trapped by opponent).
 */
export function getEffectiveRank(piece, r, c, board) {
    if (!piece) return 0;
    const terrain = board.getTerrain(r, c);

    if (terrain === TerrainType.TRAP) {
        // Check if it's an opponent's trap
        const opponentDenRow = (piece.player === Player.PLAYER0) ? Dens[Player.PLAYER1].row : Dens[Player.PLAYER0].row;
        // Trap is opponent's if it's near the opponent's den row (row 0/1 for P0, row 7/8 for P1)
        const isOpponentTrap = (piece.player === Player.PLAYER0 && r <= 1) || (piece.player === Player.PLAYER1 && r >= BOARD_ROWS - 2);

        // More precise check using TrapLocations relative to Dens
        const player0TrapRows = TrapLocations.filter(loc => loc.r >= BOARD_ROWS - 2).map(l => l.r);
        const player1TrapRows = TrapLocations.filter(loc => loc.r <= 1).map(l => l.r);

        if ((piece.player === Player.PLAYER0 && player1TrapRows.includes(r)) ||
            (piece.player === Player.PLAYER1 && player0TrapRows.includes(r))) {
             return 0; // Rank becomes 0 in opponent's trap
        }
    }
    return piece.rank; // Return normal rank otherwise
}

/**
 * Determines if an attacking piece can capture a defending piece.
 * @param {Piece} attacker Attacking piece.
 * @param {Piece} defender Defending piece.
 * @param {number} attackerRow Attacker's row.
 * @param {number} attackerCol Attacker's column.
 * @param {number} defenderRow Defender's row.
 * @param {number} defenderCol Defender's column.
 * @param {Board} board The Board instance.
 * @returns {boolean} True if capture is possible.
 */
export function canCapture(attacker, defender, attackerRow, attackerCol, defenderRow, defenderCol, board) {
    if (!attacker || !defender || attacker.player === defender.player) {
        return false;
    }

    const attackerTerrain = board.getTerrain(attackerRow, attackerCol);
    const defenderTerrain = board.getTerrain(defenderRow, defenderCol);

    // Rat cannot capture from water onto land (unless target is also Rat in water - handled implicitly)
    if (attacker.type === 'rat' && attackerTerrain === TerrainType.WATER && defenderTerrain !== TerrainType.WATER) {
        return false;
    }
    // Non-Rat cannot attack from water at all
    if (attackerTerrain === TerrainType.WATER && attacker.type !== 'rat') {
        return false;
    }

    // Special case: Rat vs Elephant
    if (attacker.type === 'rat' && defender.type === 'elephant') {
        // Rat can capture Elephant ONLY if the rat is NOT in the water
        return attackerTerrain !== TerrainType.WATER;
    }
    // Special case: Elephant vs Rat
    if (attacker.type === 'elephant' && defender.type === 'rat') {
        return false; // Elephant cannot capture Rat
    }

    // General case: Rank comparison
    const attackerRank = getEffectiveRank(attacker, attackerRow, attackerCol, board);
    const defenderRank = getEffectiveRank(defender, defenderRow, defenderCol, board);

    return attackerRank >= defenderRank;
}


/**
 * Checks if the path for a Lion/Tiger river jump is clear.
 * @param {Board} board The Board instance.
 * @param {number} startRow Start row of the jump.
 * @param {number} startCol Start column of the jump.
 * @param {number} endRow End row of the jump.
 * @param {number} endCol End column of the jump.
 * @returns {boolean} True if the path is clear of rats.
 */
export function isRiverJumpPathClear(board, startRow, startCol, endRow, endCol) {
    if (startRow === endRow) { // Horizontal Jump (Lion only)
        const step = Math.sign(endCol - startCol);
        for (let c = startCol + step; c !== endCol; c += step) {
            if (!isRiver(startRow, c) || board.getPiece(startRow, c) !== null) {
                 // Must be river squares, and must be empty (no blocking rats)
                return false;
            }
        }
    } else { // Vertical Jump (Lion/Tiger)
        const step = Math.sign(endRow - startRow);
         for (let r = startRow + step; r !== endRow; r += step) {
            if (!isRiver(r, startCol) || board.getPiece(r, startCol) !== null) {
                // Must be river squares, and must be empty (no blocking rats)
                return false;
            }
        }
    }
    return true; // Path is clear
}


/**
 * Gets all possible destination squares {row, col} for a given piece.
 * @param {Piece} piece The piece instance.
 * @param {number} r The piece's current row.
 * @param {number} c The piece's current column.
 * @param {Board} board The Board instance.
 * @returns {Array<{row: number, col: number}>} Array of valid destination coordinates.
 */
export function getPossibleMoves(piece, r, c, board) {
    const moves = [];
    const player = piece.player;
    const potentialMoves = [
        { row: r - 1, col: c }, { row: r + 1, col: c },
        { row: r, col: c - 1 }, { row: r, col: c + 1 }
    ];

    // 1. Basic Orthogonal Moves
    potentialMoves.forEach(move => {
        const { row: nextR, col: nextC } = move;

        if (!board.isValidCoordinate(nextR, nextC)) return; // Off board

        const targetSquare = board.getSquareData(nextR, nextC);
        const targetPiece = targetSquare.piece;
        const targetTerrain = targetSquare.terrain;

        // Cannot move into own Den
        const myDen = (player === Player.PLAYER0) ? TerrainType.PLAYER0_DEN : TerrainType.PLAYER1_DEN;
        if (targetTerrain === myDen) return;

        // Cannot move into water unless Rat
        if (targetTerrain === TerrainType.WATER && piece.type !== 'rat') return;

        // Cannot move onto square occupied by friendly piece
        if (targetPiece && targetPiece.player === player) return;

        // Check capture rules if occupied by enemy piece
        if (targetPiece && targetPiece.player !== player) {
            if (!canCapture(piece, targetPiece, r, c, nextR, nextC, board)) {
                return; // Cannot capture target
            }
        }

        // If all checks pass, it's a valid move
        moves.push({ row: nextR, col: nextC });
    });

    // 2. River Jumps (Lion and Tiger)
    if (piece.type === 'lion' || piece.type === 'tiger') {
        const jumpOffsets = [];
        // Vertical jumps
        if (r === 2 && isRiver(3, c) && isRiver(4, c) && isRiver(5, c)) jumpOffsets.push({ dr: 4, dc: 0 }); // Jump down
        if (r === 6 && isRiver(5, c) && isRiver(4, c) && isRiver(3, c)) jumpOffsets.push({ dr: -4, dc: 0 }); // Jump up

        // Horizontal jumps (Lion only)
        if (piece.type === 'lion') {
            if (c === 0 && isRiver(r, 1) && isRiver(r, 2)) jumpOffsets.push({ dr: 0, dc: 3 }); // Jump right from col 0
            if (c === 3 && isRiver(r, 1) && isRiver(r, 2)) jumpOffsets.push({ dr: 0, dc: -3 }); // Jump left from col 3
            if (c === 3 && isRiver(r, 4) && isRiver(r, 5)) jumpOffsets.push({ dr: 0, dc: 3 }); // Jump right from col 3
            if (c === 6 && isRiver(r, 4) && isRiver(r, 5)) jumpOffsets.push({ dr: 0, dc: -3 }); // Jump left from col 6
        }

        jumpOffsets.forEach(offset => {
            const nextR = r + offset.dr;
            const nextC = c + offset.dc;

            if (!board.isValidCoordinate(nextR, nextC)) return;

            // Check if path is clear (no blocking rats)
            if (!isRiverJumpPathClear(board, r, c, nextR, nextC)) return;

            const targetSquare = board.getSquareData(nextR, nextC);
            const targetPiece = targetSquare.piece;
            const targetTerrain = targetSquare.terrain; // Land square after jump

            // Cannot land in water or own Den
            const myDen = (player === Player.PLAYER0) ? TerrainType.PLAYER0_DEN : TerrainType.PLAYER1_DEN;
            if (targetTerrain === TerrainType.WATER || targetTerrain === myDen) return;

            // Cannot land on friendly piece
            if (targetPiece && targetPiece.player === player) return;

            // Check capture rules if landing on enemy piece
            if (targetPiece && targetPiece.player !== player) {
                 if (!canCapture(piece, targetPiece, r, c, nextR, nextC, board)) {
                    return; // Cannot capture target
                 }
            }

            // Valid jump destination
            moves.push({ row: nextR, col: nextC });
        });
    }

    return moves;
}

/**
 * Checks if a specific move is valid for a piece.
 * @param {Board} board
 * @param {Piece} piece
 * @param {number} endRow
 * @param {number} endCol
 * @returns {boolean}
 */
export function isValidMove(board, piece, endRow, endCol) {
    if (!piece) return false;
    const possible = getPossibleMoves(piece, piece.row, piece.col, board);
    return possible.some(move => move.row === endRow && move.col === endCol);
}

/**
 * Calculates all possible valid moves for a given player.
 * @param {Board} board The current board state.
 * @param {number} player The player whose moves to calculate (Player.PLAYER0 or Player.PLAYER1).
 * @returns {Array<{piece: Piece, fromRow: number, fromCol: number, toRow: number, toCol: number}>} An array of possible move objects.
 */
export function getAllPossibleMovesForPlayer(board, player) {
    const allMoves = [];
    const boardState = board.getState(); // Get the underlying 2D array

    for (let r = 0; r < BOARD_ROWS; r++) {
        for (let c = 0; c < BOARD_COLS; c++) {
            const piece = boardState[r][c].piece;
            if (piece && piece.player === player) {
                try {
                    const possibleDestinations = getPossibleMoves(piece, r, c, board);
                    possibleDestinations.forEach(dest => {
                        allMoves.push({
                            piece: piece, // Include the actual piece object
                            fromRow: r,
                            fromCol: c,
                            toRow: dest.row,
                            toCol: dest.col
                        });
                    });
                } catch (e) {
                    console.error(`Error getting moves for ${piece?.name} at ${r},${c}:`, e);
                    // Decide how to handle errors during AI move generation. Skipping might be okay.
                }
            }
        }
    }
    return allMoves;
}

/**
 * Checks the board state for win conditions.
 * @param {Board} board The Board instance.
 * @returns {GameStatus} The current status of the game.
 */
export function checkGameStatus(board) {
    // 1. Check Den occupation
    const player0DenPiece = board.getPiece(Dens[Player.PLAYER0].row, Dens[Player.PLAYER0].col);
    const player1DenPiece = board.getPiece(Dens[Player.PLAYER1].row, Dens[Player.PLAYER1].col);

    if (player0DenPiece && player0DenPiece.player === Player.PLAYER1) {
        return GameStatus.PLAYER1_WINS; // Player 1 (Red) in Player 0's (Blue) Den
    }
    if (player1DenPiece && player1DenPiece.player === Player.PLAYER0) {
        return GameStatus.PLAYER0_WINS; // Player 0 (Blue) in Player 1's (Red) Den
    }

    // 2. Check if a player has no pieces left
    const player0PieceCount = board.getPieceCount(Player.PLAYER0);
    const player1PieceCount = board.getPieceCount(Player.PLAYER1);

    if (player0PieceCount === 0 && player1PieceCount > 0) {
        return GameStatus.PLAYER1_WINS;
    }
    if (player1PieceCount === 0 && player0PieceCount > 0) {
        return GameStatus.PLAYER0_WINS;
    }
    // Optional: Draw condition if both have 0 pieces? Unlikely in Jungle Chess.
    if (player0PieceCount === 0 && player1PieceCount === 0) {
        return GameStatus.DRAW; // Or decide based on whose turn it was?
    }

    // 3. Check for stalemate (no valid moves for current player) - More complex, often omitted or handled by AI returning null
    // const currentPlayer = game.getCurrentPlayer(); // Need game state access if implemented here
    // const possibleMoves = getAllPossibleMovesForPlayer(board, currentPlayer);
    // if (possibleMoves.length === 0) {
    //    return (currentPlayer === Player.PLAYER0) ? GameStatus.PLAYER1_WINS : GameStatus.PLAYER0_WINS; // Player who cannot move loses
    // }


    // If no win condition met, game is ongoing
    return GameStatus.ONGOING;
}