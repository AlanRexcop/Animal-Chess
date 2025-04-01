// js/rules.js
import { BOARD_ROWS, BOARD_COLS, AnimalRanks, Player } from './constants.js'; // Import necessary constants

/**
 * Checks if a move is structurally valid (within bounds, one orthogonal step).
 * NOTE: This initial version DOES NOT check for terrain, friendly pieces at destination,
 * or special moves like jumps. It only checks the basic step structure.
 *
 * @param {number} startRow - The starting row of the move.
 * @param {number} startCol - The starting column of the move.
 * @param {number} endRow - The intended ending row of the move.
 * @param {number} endCol - The intended ending column of the move.
 * @returns {boolean} - True if the move structure is valid, false otherwise.
 */
export function isValidMoveStructure(startRow, startCol, endRow, endCol) {
    // 1. Check boundaries
    if (endRow < 0 || endRow >= BOARD_ROWS || endCol < 0 || endCol >= BOARD_COLS) {
        // console.log("Move invalid: Out of bounds");
        return false;
    }

    // 2. Check if it's the same square (not a move)
    if (startRow === endRow && startCol === endCol) {
        // console.log("Move invalid: Start and end are the same");
        return false;
    }

    // 3. Check if move is exactly one step orthogonally (up, down, left, or right)
    const rowDiff = Math.abs(startRow - endRow);
    const colDiff = Math.abs(startCol - endCol);

    // Manhattan distance must be 1 for a single orthogonal step
    if (rowDiff + colDiff !== 1) {
        // console.log(`Move invalid: Not orthogonal step (${rowDiff + colDiff})`);
        return false;
    }

    // If it passes all checks, the basic structure is valid
    // console.log("Move structure valid");
    return true;

    // Later enhancements: Check terrain, check friendly piece collision, check special moves (jump)
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