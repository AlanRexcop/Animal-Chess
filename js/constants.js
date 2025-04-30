export const BOARD_ROWS = 9;
export const BOARD_COLS = 7;

// Using numeric constants for performance in worker might be better,
// but strings are clearer for main thread logic/debugging.
// Let's keep the original numeric constants where they were used (like worker)
// and define string-based ones for main thread clarity if needed,
// or just use the numeric ones consistently.
// Sticking to original numeric:
export const TERRAIN_LAND = 0;
export const TERRAIN_WATER = 1;
export const TERRAIN_TRAP = 2;
export const TERRAIN_PLAYER0_DEN = 3; // Blue Den
export const TERRAIN_PLAYER1_DEN = 4; // Red Den

// Player Identifiers
export const Player = {
    NONE: -1,
    PLAYER0: 0, // Blue (Player 1 in UI terms)
    PLAYER1: 1, // Red (AI or Player 2 in UI terms)
    getOpponent: function(player) {
        if (player === this.PLAYER0) return this.PLAYER1;
        if (player === this.PLAYER1) return this.PLAYER0;
        return this.NONE;
    }
};

// Piece Information (Rank and Name) - Keep original structure
export const PIECES = {
    rat:     { rank: 1, name: 'Rat',     symbol: '🐀', value: 100 }, // Value used by AI
    cat:     { rank: 2, name: 'Cat',     symbol: '🐈', value: 200 },
    dog:     { rank: 3, name: 'Dog',     symbol: '🐕', value: 300 },
    wolf:    { rank: 4, name: 'Wolf',    symbol: '🐺', value: 400 },
    leopard: { rank: 5, name: 'Leopard', symbol: '🐆', value: 500 },
    tiger:   { rank: 6, name: 'Tiger',   symbol: '🐅', value: 700 },
    lion:    { rank: 7, name: 'Lion',    symbol: '🦁', value: 800 },
    elephant:{ rank: 8, name: 'Elephant',symbol: '🐘', value: 650 }
};

// Helper to get piece key (lowercase name) from name
export function getPieceKey(pieceName) {
    return pieceName?.toLowerCase() ?? null;
}

// Den Locations
export const PLAYER0_DEN_ROW = 8;
export const PLAYER0_DEN_COL = 3;
export const PLAYER1_DEN_ROW = 0;
export const PLAYER1_DEN_COL = 3;

// Game Status Identifiers
export const GameStatus = {
    INIT: 'INIT',
    ONGOING: 'ONGOING',
    PLAYER0_WINS: 'PLAYER0_WINS', // Blue wins
    PLAYER1_WINS: 'PLAYER1_WINS', // Red wins
    DRAW: 'DRAW' // Potentially needed later
};

// AI Configuration (Defaults)
export const aiPlayer = Player.PLAYER1; // AI is Red
export const DEFAULT_AI_TARGET_DEPTH = 9;
export const DEFAULT_AI_TIME_LIMIT_MS = 5000;
export const MIN_AI_TIME_LIMIT_MS = 100;

// Animation duration
export const ANIMATION_DURATION = 300; // ms

// Add any other constants needed globally