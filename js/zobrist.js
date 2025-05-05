// js/zobrist.js
import { BOARD_ROWS, BOARD_COLS, Player, PIECES } from './constants.js';

// --- Zobrist Hashing ---
export const zobristTable = [];        // Stores random keys for each piece/player/square
export let zobristBlackToMove;         // Random key for whose turn it is (Player 1's turn)
export const pieceNameToIndex = {};    // Maps piece name ('rat') to index for zobristTable
let pieceIndexCounter = 0;      // Counter for assigning piece indices

/** Generates a random 64-bit BigInt for Zobrist keys. */
function randomBigInt() {
    // Simple pseudo-random BigInt generator (not cryptographically secure)
    // Using Math.random() limits precision but is sufficient for hashing purposes here.
    const low = BigInt(Math.floor(Math.random() * (2**32)));
    const high = BigInt(Math.floor(Math.random() * (2**32)));
    return (high << 32n) | low;
}


/** Initializes the Zobrist hashing keys. */
export function initializeZobrist() {
    // Only initialize if the table is empty to prevent re-randomizing keys mid-game
    if (zobristTable.length > 0) return;

    console.log("Initializing Zobrist Keys...");
    pieceIndexCounter = 0;
    // Clear pieceNameToIndex in case of re-initialization attempt
    Object.keys(pieceNameToIndex).forEach(key => delete pieceNameToIndex[key]);

    for (const pieceKey in PIECES) {
        const nameLower = pieceKey.toLowerCase();
        if (!pieceNameToIndex.hasOwnProperty(nameLower)) {
            pieceNameToIndex[nameLower] = pieceIndexCounter++;
            zobristTable[pieceNameToIndex[nameLower]] = [];
        }
        const index = pieceNameToIndex[nameLower];
        zobristTable[index][Player.PLAYER0] = [];
        zobristTable[index][Player.PLAYER1] = [];
        for (let r = 0; r < BOARD_ROWS; r++) {
            zobristTable[index][Player.PLAYER0][r] = [];
            zobristTable[index][Player.PLAYER1][r] = [];
            for (let c = 0; c < BOARD_COLS; c++) {
                zobristTable[index][Player.PLAYER0][r][c] = randomBigInt();
                zobristTable[index][Player.PLAYER1][r][c] = randomBigInt();
            }
        }
    }
    zobristBlackToMove = randomBigInt();
    console.log(`Zobrist Keys Initialized. Piece Count: ${pieceIndexCounter}`);
}

/**
 * Computes the Zobrist hash key for a given board state and player to move.
 * @param {Array<Array<object>>} currentBoard - The board state.
 * @param {number} playerToMove - The player whose turn it is (PLAYER0 or PLAYER1).
 * @returns {bigint} The Zobrist hash key.
 */
export function computeZobristKey(currentBoard, playerToMove) {
    let key = 0n; // Use BigInt for the key

    if (zobristTable.length === 0) {
        console.warn("[Zobrist] computeZobristKey called before initialization. Initializing now.");
        initializeZobrist(); // Attempt to initialize if called too early
        if (zobristTable.length === 0) {
             console.error("[Zobrist] Initialization failed. Cannot compute key.");
             return 0n; // Return a default key on failure
        }
    }


    for (let r = 0; r < BOARD_ROWS; r++) {
        for (let c = 0; c < BOARD_COLS; c++) {
            const square = currentBoard[r]?.[c];
            const piece = square?.piece; // Safe access

            if (piece && piece.type) { // Use piece.type (lowercase key)
                const pieceNameLower = piece.type; // Already lowercase key
                const pieceIndex = pieceNameToIndex[pieceNameLower];

                if (pieceIndex !== undefined &&
                    (piece.player === Player.PLAYER0 || piece.player === Player.PLAYER1) &&
                    r >= 0 && r < BOARD_ROWS &&
                    c >= 0 && c < BOARD_COLS &&
                    zobristTable[pieceIndex]?.[piece.player]?.[r]?.[c])
                {
                    key ^= zobristTable[pieceIndex][piece.player][r][c]; // XOR with the piece's key
                } else {
                     console.warn(`[Zobrist Compute] Skipped invalid piece data or missing Zobrist entry`, { type: piece.type, player: piece.player, r: r, c: c, pI: pieceIndex });
                }
            }
        }
    }

    // XOR with the turn key if it's Player 1's turn
    if (playerToMove === Player.PLAYER1) {
        key ^= zobristBlackToMove;
    }
    return key;
}