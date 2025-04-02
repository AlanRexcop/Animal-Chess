// js/rules.js
import { BOARD_ROWS, BOARD_COLS, TerrainType, Player } from './constants.js';

/**
 * Checks if a move is valid according to basic orthogonal steps and river rules.
 * NOTE: Still needs additions for jumps, traps, dens, and friendly piece collision.
 *
 * @param {object} board - The board instance (needs methods like getTerrain, getPiece).
 * @param {object} piece - The piece object being moved (needs { type, row, col, player }).
 * @param {number} endRow - The intended ending row of the move.
 * @param {number} endCol - The intended ending column of the move.
 * @returns {boolean} - True if the move is valid according to current rules, false otherwise.
 */
export function isValidMove(board, piece, endRow, endCol) {
    const startRow = piece.row;
    const startCol = piece.col;

    // 1. Check boundaries (using board dimensions from constants)
    if (endRow < 0 || endRow >= BOARD_ROWS || endCol < 0 || endCol >= BOARD_COLS) {
        // console.log("Move invalid: Out of bounds");
        return false;
    }

    // 2. Check if it's the same square (not a move)
    if (startRow === endRow && startCol === endCol) {
        // console.log("Move invalid: Start and end are the same");
        return false;
    }

    // --- Potential Future Location for Jump Logic Check ---
    // If we detect a jump pattern, we'd handle it here and potentially
    // skip the single-step check below. For now, we only check single steps.

    // 3. Check if move is exactly one step orthogonally (up, down, left, or right)
    const rowDiff = Math.abs(startRow - endRow);
    const colDiff = Math.abs(startCol - endCol);

    // Manhattan distance must be 1 for a single orthogonal step
    // (This check will need modification/bypass when jump logic is added)
    if (rowDiff + colDiff !== 1) {
        // console.log(`Move invalid: Not a single orthogonal step (${rowDiff + colDiff})`);
        // Note: This currently prevents jumps. Jump logic needs to be added separately.
        return false;
    }

    // 4. *** NEW: Check Terrain Rules (River) ***
    const targetTerrain = board.getTerrain(endRow, endCol); // Assumes board has getTerrain method

    if (targetTerrain === TerrainType.RIVER) {
        // Only Rats can enter the river
        if (piece.type !== 'rat') {
            // console.log("Move invalid: Only rats can enter the river.");
            return false;
        }
        // If it IS a rat, moving into the river is okay (based on this rule alone)
    }

    // 5. --- Placeholder for Future Checks ---
    // Check if target square has a friendly piece
    // const destinationPiece = board.getPiece(endRow, endCol);
    // if (destinationPiece && destinationPiece.player === piece.player) {
    //     // console.log("Move invalid: Cannot capture friendly piece.");
    //     return false;
    // }

    // Check if moving into own Den
    // Check special capture rules (traps - might be handled in canCapture called later)

    // If it passes all current checks, the move is valid *so far*
    // console.log("Move valid based on current rules");
    return true;
}

/**
 * Calculates all valid destination squares for a given piece.
 * Considers basic orthogonal moves, river rules (via isValidMove),
 * and prevents moving onto friendly pieces.
 * NOTE: Still needs additions for jumps, dens, etc.
 *
 * @param {object} board - The board instance (needs getPiece, getTerrain).
 * @param {object} piece - The piece object to find moves for ({type, row, col, player}).
 * @returns {Array<object>} - An array of valid move destination objects [{r: row1, c: col1}, {r: row2, c: col2}, ...].
 */
export function getValidMovesForPiece(board, piece) {
    const validDestinations = [];
    if (!piece) return validDestinations; // Should not happen if called correctly

    const startRow = piece.row;
    const startCol = piece.col;
    const currentPlayer = piece.player;

    // Define potential neighbors (orthogonal for now)
    // TODO: Add potential jump destinations for Lion/Tiger later
    const potentialDeltas = [
        { dr: -1, dc: 0 }, // Up
        { dr: 1, dc: 0 },  // Down
        { dr: 0, dc: -1 }, // Left
        { dr: 0, dc: 1 }   // Right
    ];

    for (const delta of potentialDeltas) {
        const endRow = startRow + delta.dr;
        const endCol = startCol + delta.dc;

        // Use the detailed isValidMove check (handles bounds, step, river rules)
        if (isValidMove(board, piece, endRow, endCol)) {
            // isValidMove passed, now check for friendly piece collision
            const destinationPiece = board.getPiece(endRow, endCol);

            if (!destinationPiece || destinationPiece.player !== currentPlayer) {
                // It's a valid move if:
                // 1. isValidMove allows it (basic step, terrain ok)
                // 2. AND the destination is empty OR holds an opponent's piece
                validDestinations.push({ r: endRow, c: endCol });
            }
        }
    }

    // --- TODO: Add Jump Logic ---
    // If piece is Lion or Tiger, check potential jump destinations
    // Call isValidMove for jumps (or have specific jump validation)
    // Check destination for friendly pieces as above

    return validDestinations;
}

/**
 * Determines if an attacking piece can capture a defending piece based on rank rules.
 * NOTE: This initial version DOES NOT consider trap effects.
 *
 * @param {object} attackerPiece - The piece object initiating the capture. Expected properties: { type: string, rank: number, player: Player }
 * @param {object} defenderPiece - The piece object being targeted. Expected properties: { type: string, rank: number, player: Player }
 * @returns {boolean} - True if the attacker can capture the defender, false otherwise.
 */
export function canCapture(attackerPiece, defenderPiece) {
    if (!attackerPiece || !defenderPiece) {
        console.error("Cannot check capture: Invalid piece data provided.");
        return false;
    }

    // Cannot capture your own pieces
    if (attackerPiece.player === defenderPiece.player) {
        return false;
    }

    const attackerType = attackerPiece.type;
    const defenderType = defenderPiece.type;

    // Use ranks from constants for clarity and consistency
    const attackerRank = AnimalRanks[attackerType];
    const defenderRank = AnimalRanks[defenderType];

    if (attackerRank === undefined || defenderRank === undefined) {
         console.error(`Cannot check capture: Unknown piece type involved (${attackerType} or ${defenderType}).`);
         return false;
    }


    // 1. Special case: Rat captures Elephant
    if (attackerType === 'rat' && defenderType === 'elephant') {
        console.log("Capture rule: Rat captures Elephant");
        return true;
    }

    // 2. Special case: Elephant cannot capture Rat
    //    (Unless Rat is in water - terrain rule to be added later)
    if (attackerType === 'elephant' && defenderType === 'rat') {
        console.log("Capture rule: Elephant cannot capture Rat");
        return false;
    }

    // 3. General case: Higher or equal rank captures lower rank
    const canGenerallyCapture = attackerRank >= defenderRank;
    // console.log(`Capture rule: General rank check (${attackerType}[${attackerRank}] vs ${defenderType}[${defenderRank}]) -> ${canGenerallyCapture}`);
    return canGenerallyCapture;

    // Later enhancements: Check trap effects (defender rank reduced in opponent trap)
}