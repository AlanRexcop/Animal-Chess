// js/rules.js
// Encapsulates game rules - does not modify state.
// NOTE: This logic largely mirrors the worker's internal rules.
// Ensure consistency if changes are made here or in the worker.

import {
    BOARD_ROWS, BOARD_COLS,
    TERRAIN_LAND, TERRAIN_WATER, TERRAIN_TRAP,
    TERRAIN_PLAYER0_DEN, TERRAIN_PLAYER1_DEN,
    PLAYER0_DEN_ROW, PLAYER0_DEN_COL, PLAYER1_DEN_ROW, PLAYER1_DEN_COL,
    Player, GameStatus, PIECES, getPieceKey
} from './constants.js';
// Piece class isn't strictly needed here if we just pass piece objects/data

// --- Helper Functions ---

function isRiver(r, c) {
    return r >= 3 && r <= 5 && (c === 1 || c === 2 || c === 4 || c === 5);
}

// Determines effective rank, considering traps
// boardState should be the format from board.getState() or board.getClonedStateForWorker()
function getEffectiveRank(piece, r, c, boardState) {
    if (!piece) return 0;
    const terrain = boardState[r]?.[c]?.terrain;

    if (terrain === TERRAIN_TRAP) {
        // Check if it's the *opponent's* trap
        const isPlayer0Trap = (r === 8 && (c === 2 || c === 4)) || (r === 7 && c === 3);
        const isPlayer1Trap = (r === 0 && (c === 2 || c === 4)) || (r === 1 && c === 3);

        if ((piece.player === Player.PLAYER0 && isPlayer1Trap) ||
            (piece.player === Player.PLAYER1 && isPlayer0Trap)) {
            return 0; // Rank reduced in opponent's trap
        }
    }
    // Return normal rank if not in opponent's trap
    return piece.rank;
}

// --- Core Rule Functions ---

/**
 * Checks if an attacker piece can capture a defender piece.
 * Considers rank, traps, water, and special Rat/Elephant rules.
 * boardState should be the format from board.getState() or board.getClonedStateForWorker()
 */
export function canCapture(attackerPiece, defenderPiece, attR, attC, defR, defC, boardState) {
    if (!attackerPiece || !defenderPiece || attackerPiece.player === defenderPiece.player) {
        return false;
    }

    const attTerrain = boardState[attR]?.[attC]?.terrain;
    const defTerrain = boardState[defR]?.[defC]?.terrain;

    // Rule: Cannot capture from water to land (except Rat vs Rat)
    if (attTerrain === TERRAIN_WATER && defTerrain !== TERRAIN_WATER) {
        // Allow Rat vs Rat capture across water/land boundary? Original logic was complex.
        // Original: `if (attPc.name==='Rat'&&defPc.name==='Rat'&&attT!==WATER&&defT===WATER) return false;` -> Rat on land cannot attack Rat in water
        // Original: `if (attT===WATER&&defT!==WATER&&!(attPc.name==='Rat'&&defPc.name==='Rat')) return false;` -> Non-Rat in water cannot attack land
        // Let's simplify: If attacker is in water, it must be a Rat. It can only attack pieces also in water.
         if (attackerPiece.type !== 'rat' || defTerrain !== TERRAIN_WATER) {
             return false;
         }
         // If attacker is Rat in water, and defender is also in water, proceed to rank check.
    }

    // Rule: Only Rat can be in water (this check prevents non-rats from attacking *from* water)
    if (attTerrain === TERRAIN_WATER && attackerPiece.type !== 'rat') {
        return false; // Should not happen if move validation is correct
    }

    // Special Rat vs Elephant
    const attKey = attackerPiece.type;
    const defKey = defenderPiece.type;

    if (attKey === 'rat' && defKey === 'elephant') {
        // Rat can capture Elephant *unless* the Rat is attacking from water
        return attTerrain !== TERRAIN_WATER;
    }
    if (attKey === 'elephant' && defKey === 'rat') {
        return false; // Elephant cannot capture Rat
    }

    // Standard Rank Comparison (considering traps)
    const attackerRank = getEffectiveRank(attackerPiece, attR, attC, boardState);
    const defenderRank = getEffectiveRank(defenderPiece, defR, defC, boardState);

    return attackerRank >= defenderRank;
}

/**
 * Calculates all valid destination squares for a given piece.
 * Returns Array<{row: number, col: number}>
 * boardState should be the format from board.getState() or board.getClonedStateForWorker()
 */
export function getValidMovesForPiece(piece, r, c, boardState) {
    if (!piece) return [];

    const moves = [];
    const player = piece.player;
    const pieceType = piece.type; // 'rat', 'lion', etc.

    // 1. Standard Orthogonal Moves
    const potentialMoves = [
        { dr: -1, dc: 0 }, { dr: 1, dc: 0 }, { dr: 0, dc: -1 }, { dr: 0, dc: 1 }
    ];

    potentialMoves.forEach(move => {
        const nr = r + move.dr;
        const nc = c + move.dc;

        // Check bounds
        if (nr < 0 || nr >= BOARD_ROWS || nc < 0 || nc >= BOARD_COLS) return;

        const targetSquare = boardState[nr]?.[nc];
        if (!targetSquare) return; // Should not happen with bounds check

        const targetPiece = targetSquare.piece;
        const targetTerrain = targetSquare.terrain;

        // Rule: Cannot move into own Den
        const ownDen = (player === Player.PLAYER0) ? TERRAIN_PLAYER0_DEN : TERRAIN_PLAYER1_DEN;
        if (targetTerrain === ownDen) return;

        // Rule: Water movement restrictions
        if (targetTerrain === TERRAIN_WATER) {
            if (pieceType !== 'rat') return; // Only Rat can enter water
        }

        // Rule: Cannot move from Land into Water if target square has non-Rat piece (relevant for Rat attacking Rat in water)
        // This seems covered by canCapture logic? Let's focus on valid destination squares first.

        // Rule: Cannot move onto square occupied by own piece
        if (targetPiece && targetPiece.player === player) return;

        // Rule: Check capture validity if target square has opponent piece
        if (targetPiece && targetPiece.player !== player) {
            if (!canCapture(piece, targetPiece, r, c, nr, nc, boardState)) {
                return; // Cannot move if capture is invalid
            }
        }

        // If all checks pass, it's a valid destination
        moves.push({ row: nr, col: nc });
    });

    // 2. Special Jumps (Lion, Tiger)
    if (pieceType === 'lion' || pieceType === 'tiger') {
        const jumpOverRiver = (targetRow, targetCol, riverCols, riverRows) => {
            // Basic bounds check for target
            if (targetRow < 0 || targetRow >= BOARD_ROWS || targetCol < 0 || targetCol >= BOARD_COLS) return;

            // Check path is clear (no pieces in river squares)
            for (let i = 0; i < riverRows.length; i++) {
                const rr = riverRows[i];
                const rc = riverCols[i];
                // Check if the intermediate square is actually river and if it's occupied
                if (!isRiver(rr, rc) || boardState[rr]?.[rc]?.piece) {
                    return; // Path blocked or not river
                }
            }

            // Check target square validity (similar to orthogonal checks)
            const targetSquare = boardState[targetRow]?.[targetCol];
            if (!targetSquare) return;
            const targetPiece = targetSquare.piece;
            const targetTerrain = targetSquare.terrain;

            // Cannot jump into water
            if (targetTerrain === TERRAIN_WATER) return;

            // Cannot jump into own Den
            const ownDen = (player === Player.PLAYER0) ? TERRAIN_PLAYER0_DEN : TERRAIN_PLAYER1_DEN;
            if (targetTerrain === ownDen) return;

            // Cannot jump onto own piece
            if (targetPiece && targetPiece.player === player) return;

            // Check capture validity if opponent piece is on target
            if (targetPiece && targetPiece.player !== player) {
                if (!canCapture(piece, targetPiece, r, c, targetRow, targetCol, boardState)) {
                    return; // Cannot jump if capture is invalid
                }
            }

            // Valid jump destination
            moves.push({ row: targetRow, col: targetCol });
        };

        // Vertical Jumps (Tiger & Lion)
        if (isRiver(3, c)) { // Check if current column is adjacent to vertical river path
            if (r === 2) jumpOverRiver(6, c, [c, c, c], [3, 4, 5]); // Jump down
            else if (r === 6) jumpOverRiver(2, c, [c, c, c], [5, 4, 3]); // Jump up
        }

        // Horizontal Jumps (Lion only)
        if (pieceType === 'lion') {
             // Check if current row is adjacent to horizontal river paths
            if (isRiver(r, 1) && isRiver(r, 2)) { // River squares at col 1 and 2
                 if (c === 0) jumpOverRiver(r, 3, [1, 2], [r, r]); // Jump right from col 0
                 else if (c === 3) jumpOverRiver(r, 0, [2, 1], [r, r]); // Jump left from col 3
            }
             if (isRiver(r, 4) && isRiver(r, 5)) { // River squares at col 4 and 5
                 if (c === 3) jumpOverRiver(r, 6, [4, 5], [r, r]); // Jump right from col 3
                 else if (c === 6) jumpOverRiver(r, 3, [5, 4], [r, r]); // Jump left from col 6
            }
        }
    }

    // Filter out duplicate moves if any (shouldn't happen with this logic, but safe)
    const uniqueMoves = [];
    const seen = new Set();
    for (const move of moves) {
        const key = `${move.row}-${move.col}`;
        if (!seen.has(key)) {
            uniqueMoves.push(move);
            seen.add(key);
        }
    }

    return uniqueMoves;
}


/**
 * Calculates all possible valid moves for a given player.
 * Returns Array<{ piece: Piece, fromRow: number, fromCol: number, toRow: number, toCol: number }>
 * boardState should be the format from board.getState() or board.getClonedStateForWorker()
 */
export function getAllValidMoves(player, boardState) {
    const allMoves = [];
    for (let r = 0; r < BOARD_ROWS; r++) {
        for (let c = 0; c < BOARD_COLS; c++) {
            const piece = boardState[r]?.[c]?.piece;
            if (piece && piece.player === player) {
                const validDests = getValidMovesForPiece(piece, r, c, boardState);
                validDests.forEach(dest => {
                    allMoves.push({
                        // Pass a copy of piece data, not the object itself,
                        // especially if boardState might be modified elsewhere during AI search.
                        // The worker expects pieceData, fromRow, fromCol, etc.
                        pieceData: { ...piece }, // Shallow copy is enough for worker's needs
                        fromRow: r,
                        fromCol: c,
                        toRow: dest.row,
                        toCol: dest.col
                    });
                });
            }
        }
    }
    return allMoves;
}

/**
 * Checks the board state for a win condition.
 * Returns a GameStatus value (ONGOING, PLAYER0_WINS, PLAYER1_WINS).
 * boardState should be the format from board.getState() or board.getClonedStateForWorker()
 */
export function getGameStatus(boardState) {
    let player0PieceCount = 0;
    let player1PieceCount = 0;
    let player0InDen = false;
    let player1InDen = false;

    for (let r = 0; r < BOARD_ROWS; r++) {
        for (let c = 0; c < BOARD_COLS; c++) {
            const square = boardState[r]?.[c];
            const piece = square?.piece;
            const terrain = square?.terrain;

            if (piece) {
                if (piece.player === Player.PLAYER0) {
                    player0PieceCount++;
                    if (terrain === TERRAIN_PLAYER1_DEN) { // Blue piece in Red Den
                        player0InDen = true;
                    }
                } else { // Player.PLAYER1
                    player1PieceCount++;
                    if (terrain === TERRAIN_PLAYER0_DEN) { // Red piece in Blue Den
                        player1InDen = true;
                    }
                }
            }
        }
    }

    // Check win conditions
    if (player0InDen) return GameStatus.PLAYER0_WINS;
    if (player1InDen) return GameStatus.PLAYER1_WINS;
    if (player1PieceCount === 0 && player0PieceCount > 0) return GameStatus.PLAYER0_WINS;
    if (player0PieceCount === 0 && player1PieceCount > 0) return GameStatus.PLAYER1_WINS;
    // Optional: Add draw condition (e.g., 50 move rule, repetition) if needed
    // if (player0PieceCount === 0 && player1PieceCount === 0) return GameStatus.DRAW; // Or last player to move wins? Check rules.

    return GameStatus.ONGOING;
}

// --- Keep functions needed by worker directly ---
// These are slightly adapted versions from the original worker code
// to work with the boardState format used here.

/**
 * Checks if a move is valid (simplified check, assumes basic orthogonal/jump exists).
 * Used primarily for comparing moves in AI (killers, TT).
 * boardState is not strictly needed if just comparing coords, but included for potential extension.
 */
export function isValidMove(boardState, piece, endRow, endCol) {
    // This is a placeholder/simplified version.
    // The main validation is done by getValidMovesForPiece.
    // This could be used to quickly check if endRow/endCol is plausible.
    if (!piece) return false;
    if (endRow < 0 || endRow >= BOARD_ROWS || endCol < 0 || endCol >= BOARD_COLS) return false;

    const targetSquare = boardState[endRow]?.[endCol];
    if (!targetSquare) return false;
    const targetPiece = targetSquare.piece;
    const targetTerrain = targetSquare.terrain;

    // Cannot move into own den
    const ownDen = (piece.player === Player.PLAYER0) ? TERRAIN_PLAYER0_DEN : TERRAIN_PLAYER1_DEN;
    if (targetTerrain === ownDen) return false;

    // Cannot move onto own piece
    if (targetPiece && targetPiece.player === piece.player) return false;

    // Basic water check (only rat)
    if (targetTerrain === TERRAIN_WATER && piece.type !== 'rat') return false;

    // Further checks (like capture validity, jumps) would require startRow/Col
    // and are better handled by getValidMovesForPiece.
    // This function is likely sufficient for the AI's purpose of *comparing* moves.
    return true;
}


// Helper to check if two move objects are the same
// (Used by AI for Killer Moves / TT comparison)
export function movesAreEqual(move1, move2) {
    if (!move1 || !move2) return false;
    return move1.fromRow === move2.fromRow &&
           move1.fromCol === move2.fromCol &&
           move1.toRow === move2.toRow &&
           move1.toCol === move2.toCol;
}