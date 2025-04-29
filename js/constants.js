// js/constants.js

export const BOARD_ROWS = 9;
export const BOARD_COLS = 7;

// Terrain Types (Match CSS/Setup Logic)
export const TerrainType = {
    LAND: 'land',
    WATER: 'water',
    TRAP: 'trap',
    PLAYER0_DEN: 'player0-den', // Blue Den (Bottom)
    PLAYER1_DEN: 'player1-den', // Red Den (Top)
};

// Player Identifiers (Match AI/Game Logic: 0 for Blue, 1 for Red)
export const Player = {
    PLAYER0: 0, // Typically Human (Blue)
    PLAYER1: 1, // Typically AI/Human (Red)
    NONE: -1,
    getOpponent: (player) => (player === Player.PLAYER0 ? Player.PLAYER1 : Player.PLAYER0),
};

// Piece Definitions (Combine rank, symbol, name, AI value)
// Using lowercase keys for easier lookup from piece type strings
export const PieceData = {
    rat:      { rank: 1, name: 'Rat',      symbol: '🐀', value: 100, imageFile: 'rat.webp' },
    cat:      { rank: 2, name: 'Cat',      symbol: '🐈', value: 200, imageFile: 'cat.webp' },
    dog:      { rank: 3, name: 'Dog',      symbol: '🐕', value: 300, imageFile: 'dog.webp' },
    wolf:     { rank: 4, name: 'Wolf',     symbol: '🐺', value: 400, imageFile: 'wolf.webp' },
    leopard:  { rank: 5, name: 'Leopard',  symbol: '🐆', value: 500, imageFile: 'leopard.webp' },
    tiger:    { rank: 6, name: 'Tiger',    symbol: '🐅', value: 700, imageFile: 'tiger.webp' },
    lion:     { rank: 7, name: 'Lion',     symbol: '🦁', value: 800, imageFile: 'lion.webp' },
    elephant: { rank: 8, name: 'Elephant', symbol: '🐘', value: 650, imageFile: 'elephant.webp' },
};
export const PieceTypes = Object.keys(PieceData); // ['rat', 'cat', ...]

// Den Locations (Based on Player IDs)
export const Dens = {
    [Player.PLAYER0]: { row: BOARD_ROWS - 1, col: 3 }, // Bottom Den
    [Player.PLAYER1]: { row: 0, col: 3 },              // Top Den
};

// Trap Locations (Helper array)
export const TrapLocations = [
    { r: 0, c: 2 }, { r: 0, c: 4 }, { r: 1, c: 3 }, // Near Player 1 Den
    { r: BOARD_ROWS - 1, c: 2 }, { r: BOARD_ROWS - 1, c: 4 }, { r: BOARD_ROWS - 2, c: 3 }, // Near Player 0 Den
];

// Game Status
export const GameStatus = {
    INIT: 'init',
    ONGOING: 'ongoing',
    PLAYER0_WINS: 'player0_wins',
    PLAYER1_WINS: 'player1_wins',
    DRAW: 'draw', // Consider adding if needed
};

// AI Constants
export const DEFAULT_AI_PLAYER = Player.PLAYER1; // AI is usually Player 1 (Red)
export const DEFAULT_AI_TARGET_DEPTH = 6;
export const DEFAULT_AI_TIME_LIMIT_MS = 5000;
export const MIN_AI_TIME_LIMIT_MS = 100;
export const WIN_SCORE = 20000; // Score for definite win
export const LOSE_SCORE = -20000; // Score for definite loss
export const ZOBRIST_HASH_FLAGS = {
    EXACT: 0,
    LOWERBOUND: 1, // Alpha cutoff
    UPPERBOUND: 2, // Beta cutoff
};
export const ANIMATION_DURATION = 300; // ms