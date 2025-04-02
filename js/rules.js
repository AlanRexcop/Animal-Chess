// js/rules.js
import { BOARD_ROWS, BOARD_COLS, TerrainType, Player , AnimalRanks} from './constants.js';

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
/**
 * Checks if a move is valid considering bounds, orthogonal steps,
 * river rules (Rat movement & Lion/Tiger jumps), and avoiding own den.
 * NOTE: Still needs integration for friendly piece collision check (often done AFTER this),
 * trap interactions, and capture rules (handled by canCapture).
 *
 * @param {object} board - The board instance (needs getTerrain, getPiece).
 * @param {object} piece - The piece object being moved ({ type, row, col, player }).
 * @param {number} endRow - The intended ending row of the move.
 * @param {number} endCol - The intended ending column of the move.
 * @returns {boolean} - True if the move is valid according to current rules, false otherwise.
 */
export function isValidMove(board, piece, endRow, endCol) {
    const startRow = piece.row;
    const startCol = piece.col;
    const pieceType = piece.type;
    const player = piece.player; // Needed for Den check

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

    const targetTerrain = board.getTerrain(endRow, endCol);
    const startTerrain = board.getTerrain(startRow, startCol); // Needed for jump check

    // 3. *** NEW: Check for Lion/Tiger River Jump ***
    if (pieceType === 'lion' || pieceType === 'tiger') {
        const rowDiff = Math.abs(startRow - endRow);
        const colDiff = Math.abs(startCol - endCol);

        // Check for Horizontal Jump Pattern (distance 3)
        if (startRow === endRow && colDiff === 3) {
            // Check if crossing a river segment vertically
            const intermediateCol1 = Math.min(startCol, endCol) + 1;
            const intermediateCol2 = Math.max(startCol, endCol) - 1;
            if (board.getTerrain(startRow, intermediateCol1) === TerrainType.RIVER &&
                board.getTerrain(startRow, intermediateCol2) === TerrainType.RIVER)
            {
                // Ensure start and end points are NOT river
                if (startTerrain !== TerrainType.RIVER && targetTerrain !== TerrainType.RIVER) {
                    // If geometry and terrain match, check if path is clear
                    if (isRiverJumpPathClear(board, startRow, startCol, endRow, endCol)) {
                        console.log("Valid River Jump (Horizontal)");
                        return true; // Valid jump, no further checks needed for this move type
                    } else {
                        console.log("Invalid River Jump: Path Blocked");
                        return false; // Path blocked, move is invalid
                    }
                }
            }
        }
        // Check for Horizontal Jump Pattern (distance 4)
        else if (startCol === endCol && rowDiff === 4 && pieceType === 'lion') {
            // Check if crossing a river segment horizontally
            const intermediateRow1 = Math.min(startRow, endRow) + 1;
            const intermediateRow2 = intermediateRow1 + 1;
            const intermediateRow3 = Math.max(startRow, endRow) - 1;
            if (board.getTerrain(intermediateRow1, startCol) === TerrainType.RIVER &&
                board.getTerrain(intermediateRow2, startCol) === TerrainType.RIVER &&
                board.getTerrain(intermediateRow3, startCol) === TerrainType.RIVER)
            {
                 // Ensure start and end points are NOT river
                 if (startTerrain !== TerrainType.RIVER && targetTerrain !== TerrainType.RIVER) {
                    // If geometry and terrain match, check if path is clear
                    if (isRiverJumpPathClear(board, startRow, startCol, endRow, endCol)) {
                        console.log("Valid River Jump (Vertical)");
                        return true; // Valid jump, no further checks needed
                    } else {
                        console.log("Invalid River Jump: Path Blocked");
                        return false; // Path blocked, move is invalid
                    }
                }
            }
        }
        // If it wasn't a valid jump, lion/tiger might still move 1 step orthogonally (checked below)
    }

    // 4. Check for Single Orthogonal Step (if not a valid jump)
    const rowDiffOrth = Math.abs(startRow - endRow);
    const colDiffOrth = Math.abs(startCol - endCol);

    if (rowDiffOrth + colDiffOrth !== 1) {
        // console.log(`Move invalid: Not a single orthogonal step or a valid jump (${rowDiffOrth + colDiffOrth})`);
        // If it wasn't a valid jump (handled above) and isn't a single step, it's invalid.
        return false;
    }

    // 5. Apply Terrain Rules for Single Steps
    if (targetTerrain === TerrainType.RIVER) {
        // Only Rats can enter the river via single step
        if (pieceType !== 'rat') {
            // console.log("Move invalid: Only rats can step into the river.");
            return false;
        }
        // Rat moving into river is okay.
    }

    // 6. Prevent moving into own Den
    // (Assumes constants like Player.PLAYER1, TerrainType.DEN_P1, Player.PLAYER2, TerrainType.DEN_P2 exist)
    if ((player === Player.PLAYER1 && targetTerrain === TerrainType.DEN_P1) ||
        (player === Player.PLAYER2 && targetTerrain === TerrainType.DEN_P2)) {
        // console.log("Move invalid: Cannot move into own den.");
        return false;
    }


    // 7. --- Placeholder for Future/External Checks ---
    // Check if target square has a friendly piece (often done *after* isValidMove in game logic)
    // const destinationPiece = board.getPiece(endRow, endCol);
    // if (destinationPiece && destinationPiece.player === player) {
    //     // console.log("Move invalid: Cannot land on friendly piece.");
    //     return false; // Could be checked here or in the calling function
    // }


    // If it passes all applicable checks (jump or single step + terrain/den rules), the move is valid
    // console.log("Move valid based on current rules");
    return true;
}

// In js/rules.js

// Assuming necessary imports (constants, isValidMove, etc.) are present
// Assuming isValidMove is defined in this file or imported,
// and it now correctly handles jump validation including path clearing.

/**
 * Calculates all valid destination squares for a given piece.
 * Considers basic orthogonal moves, river rules (Rat), Lion/Tiger jumps,
 * and prevents moving onto friendly pieces or own den (handled by isValidMove).
 *
 * @param {object} board - The board instance (needs getPiece, getTerrain).
 * @param {object} piece - The piece object to find moves for ({type, row, col, player}).
 * @returns {Array<object>} - An array of valid move destination objects [{r: row1, c: col1}, {r: row2, c: col2}, ...].
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

    // --- Define ALL potential target squares ---
    let potentialTargets = [];

    // 1. Add Orthogonal Neighbors
    const orthogonalDeltas = [
        { dr: -1, dc: 0 }, // Up
        { dr: 1, dc: 0 },  // Down
        { dr: 0, dc: -1 }, // Left
        { dr: 0, dc: 1 }   // Right
    ];
    for (const delta of orthogonalDeltas) {
        potentialTargets.push({ r: startRow + delta.dr, c: startCol + delta.dc });
    }

    // 2. Add Potential Jump Destinations (only for Lion and Tiger)
    if (pieceType === 'lion' || pieceType === 'tiger') {
        const jumpDeltas = [
            { dr: -4, dc: 0 }, // Jump Up
            { dr: 4, dc: 0 },  // Jump Down
            { dr: 0, dc: -3 }, // Jump Left
            { dr: 0, dc: 3 }   // Jump Right
        ];
        for (const delta of jumpDeltas) {
            potentialTargets.push({ r: startRow + delta.dr, c: startCol + delta.dc });
        }
    }

    // --- Validate each potential target ---
    for (const target of potentialTargets) {
        const endRow = target.r;
        const endCol = target.c;

        // Use the detailed isValidMove check. It now handles:
        // - Bounds checks
        // - Orthogonal step validation
        // - Rat river movement validation
        // - Lion/Tiger jump validation (geometry, terrain types, path clear)
        // - Own Den avoidance
        if (isValidMove(board, piece, endRow, endCol)) {
            // If isValidMove approves the move's structure and terrain rules,
            // then check for collision with friendly pieces at the destination.
            const destinationPiece = board.getPiece(endRow, endCol);

            if (!destinationPiece || destinationPiece.player !== currentPlayer) {
                // It's a valid final destination if:
                // 1. isValidMove allows it (structure, terrain, jumps ok)
                // 2. AND the destination is empty OR holds an opponent's piece
                validDestinations.push({ r: endRow, c: endCol });
            }
            // else { console.log(`Move to ${endRow},${endCol} blocked by friendly piece.`); }
        }
        else { console.log(`Move to ${endRow},${endCol} rejected by isValidMove.`); }
    }
    console.log("validMove")
    console.log(validDestinations)
    return validDestinations;
}
/**
 * Checks if the intermediate river squares for a potential Lion/Tiger jump are empty.
 * ASSUMES the calling function has already verified:
 * - The moving piece is a Lion or Tiger.
 * - The start and end squares are land.
 * - The distance and orientation match a river jump pattern.
 *
 * @param {object} board - The board instance with a getPiece(r, c) method.
 * @param {number} startRow - The starting row of the jump.
 * @param {number} startCol - The starting column of the jump.
 * @param {number} endRow - The ending row of the jump.
 * @param {number} endCol - The ending column of the jump.
 * @returns {boolean} - True if all intermediate river squares are empty, false otherwise.
 */
export function isRiverJumpPathClear(board, startRow, startCol, endRow, endCol) {
    // --- Check Vertical Jump (3 squares total move distance, across 2 river squares) ---
    if (startRow === endRow && Math.abs(startCol - endCol) === 3) {
        // Determine the two intermediate river Cols
        const intermediateCol1 = Math.min(startCol, endCol) + 1;
        const intermediateCol2 = Math.max(startCol, endCol) - 1;

        // Check if either intermediate square has a piece
        if (board.getPiece(startRow, intermediateCol1) || board.getPiece(startRow, intermediateCol2)) {
            console.log(`Jump blocked at (${intermediateCol1}, ${startRow}) or (${intermediateCol2}, ${startRow})`);
            return false; // Path is blocked
        }
        // console.log(`Vertical jump path clear from ${startCol} to ${endCol}`);
        return true; // Path is clear
    }

    // --- Check Horizontal Jump (4 squares total move distance, across 3 river squares) ---
    else if (startCol === endCol && Math.abs(startRow - endRow) === 4) {
        // Determine the three intermediate river Rowumns
        const intermediateRow1 = Math.min(startRow, endRow) + 1;
        const intermediateRow2 = intermediateRow1 + 1; // Or Math.min(startRow, endRow) + 2
        const intermediateRow3 = Math.max(startRow, endRow) - 1;
        console.log(board.getPiece(intermediateRow1, startCol))

        // Check if any intermediate square has a piece
        if (board.getPiece(intermediateRow1, startCol) ||
            board.getPiece(intermediateRow2, startCol) ||
            board.getPiece(intermediateRow3, startCol)) {
            console.log(`Jump blocked at (${startCol}, ${intermediateRow1}), (${startCol}, ${intermediateRow2}), or (${startCol}, ${intermediateRow3})`);
            return false; // Path is blocked
        }
        // console.log(`Horizontal jump path clear from ${startCol} to ${endCol}`);
        return true; // Path is clear
    }

    // --- Should not happen if called correctly, but return false as a default ---
    // This case means the move wasn't a standard jump pattern passed to this function.
    console.warn("isRiverJumpPathClear called with non-jump coordinates:", startRow, startCol, "to", endRow, endCol);
    return false;
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