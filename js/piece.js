// js/piece.js
import { AnimalRanks, Player } from './constants.js';

/**
 * Represents a single animal piece on the game board.
 */
export class Piece {
    /**
     * Creates an instance of a Piece.
     * @param {string} type - The type of animal.
     * @param {number} player - The player owning the piece.
     * @param {number} row - The initial row position.
     * @param {number} col - The initial column position.
     */
    constructor(type, player, row, col) {
        if (!AnimalRanks.hasOwnProperty(type)) {
            throw new Error(`Invalid piece type provided: ${type}`);
        }
        if (player !== Player.PLAYER1 && player !== Player.PLAYER2) {
            throw new Error(`Invalid player provided: ${player}`);
        }

        this.type = type;
        this.rank = AnimalRanks[type];
        this.player = player;
        this.row = row;
        this.col = col;
    }
}
