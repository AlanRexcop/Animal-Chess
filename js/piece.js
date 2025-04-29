// js/piece.js
import { PieceData, Player } from './constants.js';

/**
 * Represents a single animal piece on the board.
 */
export class Piece {
    constructor(type, player, row, col) {
        if (!PieceData[type]) {
            throw new Error(`Invalid piece type: ${type}`);
        }
        this.type = type; // e.g., 'rat', 'lion'
        this.player = player; // Player.PLAYER0 or Player.PLAYER1
        this.row = row;
        this.col = col;

        // Copy properties from PieceData
        const data = PieceData[type];
        this.name = data.name;
        this.rank = data.rank;
        this.symbol = data.symbol;
        this.value = data.value; // For AI evaluation
    }

    // Optional: Method to update position
    setPosition(row, col) {
        this.row = row;
        this.col = col;
    }
}