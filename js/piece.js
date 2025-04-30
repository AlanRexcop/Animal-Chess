import { PIECES, Player, getPieceKey } from './constants.js';

export class Piece {
    constructor(type, player, row, col) {
        const pieceKey = getPieceKey(type); // e.g., 'rat', 'lion'
        const pieceData = PIECES[pieceKey];

        if (!pieceData) {
            throw new Error(`Invalid piece type: ${type}`);
        }
        if (player !== Player.PLAYER0 && player !== Player.PLAYER1) {
            throw new Error(`Invalid player: ${player}`);
        }

        this.type = pieceKey;           // Lowercase name ('rat')
        this.name = pieceData.name;     // Capitalized name ('Rat')
        this.rank = pieceData.rank;
        this.symbol = pieceData.symbol; // Emoji
        this.player = player;           // Player.PLAYER0 or Player.PLAYER1
        this.row = row;
        this.col = col;
    }

    // Optional: Method to get image source based on type and player
    getImageSrc() {
        const color = this.player === Player.PLAYER0 ? 'blue' : 'red';
        return `assets/images/${this.type}_${color}.webp`;
    }

    // Optional: update position
    setPosition(row, col) {
        this.row = row;
        this.col = col;
    }
}