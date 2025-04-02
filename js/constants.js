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
    NORMAL: 'NORMAL',   // Regular ground square
    RIVER: 'RIVER',     // River square
    TRAP_P1: 'TRAP_P1', // Trap adjacent to Player 1's Den (affects Player 2)
    TRAP_P2: 'TRAP_P2', // Trap adjacent to Player 2's Den (affects Player 1)
    DEN_P1: 'DEN_P1',   // Player 1's Den (goal for Player 2)
    DEN_P2: 'DEN_P2'    // Player 2's Den (goal for Player 1)
};

/**
 * Represents the players in the game.
 * Using numbers for easy comparison and potential array indexing.
 * Player 1 typically starts at the bottom, Player 2 at the top.
 */
export const Player = {
    NONE: 0,
    PLAYER1: 1, // Typically starts at the bottom
    PLAYER2: 2, // Typically starts at the top
    getOpponent: function(player) {
        if (player === this.PLAYER1) return this.PLAYER2;
        if (player === this.PLAYER2) return this.PLAYER1;
        return this.NONE;
    }
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

export const GameStatus = {
    INIT: 'Initializing',
    ONGOING: 'Ongoing',
    P1_WINS: 'Player 1 Wins!',
    P2_WINS: 'Player 2 Wins!',
    DRAW: 'Draw' // Though draws are rare in Jungle
};