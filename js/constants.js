// js/constants.js

/**
 * Board dimensions for standard Jungle Chess.
 */
export const BOARD_ROWS = 9;
export const BOARD_COLS = 7;

/**
 * Represents the different types of terrain on the board squares.
 * Using string constants for clarity in debugging and state representation.
 */
export const TerrainType = {
    NORMAL: 'normal', // Regular land square
    RIVER: 'river',   // River square (only Rat can enter, Lion/Tiger jump over)
    TRAP: 'trap',     // Trap square (reduces rank of opponent pieces)
    DEN: 'den'      // Den square (target for winning)
};

/**
 * Represents the players in the game.
 * Using numbers for easy comparison and potential array indexing.
 * Player 1 typically starts at the bottom, Player 2 at the top.
 */
export const Player = {
    NONE: 0,    // Represents no player (e.g., an empty square)
    PLAYER1: 1, // Player 1 (e.g., Blue)
    PLAYER2: 2  // Player 2 (e.g., Red)
};

/**
 * Defines the ranking of each animal piece.
 * Higher number generally means stronger, with special exceptions (Rat vs Elephant).
 * Keys should match the animal type strings used elsewhere (e.g., CSS classes, image names).
 */
export const AnimalRanks = {
    'rat': 1,
    'cat': 2,
    'dog': 3,
    'wolf': 4,
    'leopard': 5,
    'tiger': 6,
    'lion': 7,
    'elephant': 8
};

/**
 * List of animal types, derived from AnimalRanks keys.
 * Useful for iteration or setup.
 */
export const AnimalTypes = Object.keys(AnimalRanks);

// Optional: You could also define specific locations for dens and traps here
// if they are always the same, but it might be cleaner to handle that
// during board initialization logic in board.js.
// export const P1_DEN_POS = { row: 0, col: 4 };
// export const P2_DEN_POS = { row: 6, col: 4 };
// export const P1_TRAP_POS = [{ row: 0, col: 2 }, { row: 0, col: 6 }, { row: 1, col: 4 }];
// export const P2_TRAP_POS = [{ row: 6, col: 2 }, { row: 6, col: 6 }, { row: 5, col: 4 }];