// js/piece.js

// Import necessary constants
import { AnimalRanks, Player } from './constants.js';

/**
 * Represents a single animal piece on the game board.
 */
export class Piece {
    /**
     * Creates an instance of a Piece.
     * @param {string} type - The type of animal (e.g., 'rat', 'lion'). Should be a key in AnimalRanks.
     * @param {number} player - The player owning the piece (Player.PLAYER1 or Player.PLAYER2).
     * @param {number} row - The initial row position of the piece.
     * @param {number} col - The initial column position of the piece.
     */
    constructor(type, player, row, col) {
        if (!AnimalRanks.hasOwnProperty(type)) {
            throw new Error(`Invalid piece type provided: ${type}`);
        }
        if (player !== Player.PLAYER1 && player !== Player.PLAYER2) {
             throw new Error(`Invalid player provided: ${player}`);
        }

        /** @type {string} The type of animal (e.g., 'rat', 'lion') */
        this.type = type;

        /** @type {number} The rank of the animal, determined from AnimalRanks */
        this.rank = AnimalRanks[type];

        /** @type {number} The player owning the piece (Player.PLAYER1 or Player.PLAYER2) */
        this.player = player;

        /** @type {number} The current row position of the piece on the board */
        this.row = row;

        /** @type {number} The current column position of the piece on the board */
        this.col = col;

        // Optional: Add a unique ID if needed later, e.g., for specific targeting or animation
        // this.id = `${type}-${player}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    }

    // --- Potential Future Methods (Keep simple for now) ---

    /**
     * Updates the piece's stored row and column.
     * NOTE: This should typically be called *by* the board/game logic
     * *after* the piece's position in the main board state has been updated.
     * The board state is the primary source of truth.
     * @param {number} newRow
     * @param {number} newCol
     */
    // updatePosition(newRow, newCol) {
    //     this.row = newRow;
    //     this.col = newCol;
    // }
}

// If you preferred a factory function approach:
/*
export function createPiece(type, player, row, col) {
    if (!AnimalRanks.hasOwnProperty(type)) {
        throw new Error(`Invalid piece type provided: ${type}`);
    }
     if (player !== Player.PLAYER1 && player !== Player.PLAYER2) {
         throw new Error(`Invalid player provided: ${player}`);
    }

    return {
        type: type,
        rank: AnimalRanks[type],
        player: player,
        row: row,
        col: col
    };
}
*/