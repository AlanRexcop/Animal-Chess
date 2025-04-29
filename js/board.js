// js/board.js
import { BOARD_ROWS, BOARD_COLS, TerrainType, Player, PieceData, Dens, TrapLocations } from './constants.js';
import { Piece } from './piece.js';

/**
 * Represents the game board state (terrain and pieces).
 */
export class Board {
    constructor() {
        this.state = []; // 2D array of { piece: Piece | null, terrain: TerrainType }
        this.initBoard();
    }

    /**
     * Initializes the board with terrain and starting pieces.
     */
    initBoard() {
        this.state = [];
        for (let r = 0; r < BOARD_ROWS; r++) {
            this.state.push(Array(BOARD_COLS).fill(null));
            for (let c = 0; c < BOARD_COLS; c++) {
                this.state[r][c] = {
                    piece: null,
                    terrain: this._getTerrainType(r, c)
                };
            }
        }
        this._setupInitialPieces();
    }

    /**
     * Determines the terrain type for a given square.
     * @param {number} r Row index
     * @param {number} c Column index
     * @returns {TerrainType}
     * @private
     */
    _getTerrainType(r, c) {
        if (r === Dens[Player.PLAYER0].row && c === Dens[Player.PLAYER0].col) return TerrainType.PLAYER0_DEN;
        if (r === Dens[Player.PLAYER1].row && c === Dens[Player.PLAYER1].col) return TerrainType.PLAYER1_DEN;
        if (TrapLocations.some(trap => trap.r === r && trap.c === c)) return TerrainType.TRAP;
        // Water definition from original script.js
        if (r >= 3 && r <= 5 && (c === 1 || c === 2 || c === 4 || c === 5)) return TerrainType.WATER;
        return TerrainType.LAND;
    }

    /**
     * Places the initial pieces on the board.
     * @private
     */
    _setupInitialPieces() {
        // Initial positions from original script.js (adapted to Piece class)
        const initialPositions = [
            // Player 1 (Red, Top)
            { type: 'lion',     r: 0, c: 0, pl: Player.PLAYER1 },
            { type: 'tiger',    r: 0, c: 6, pl: Player.PLAYER1 },
            { type: 'dog',      r: 1, c: 1, pl: Player.PLAYER1 },
            { type: 'cat',      r: 1, c: 5, pl: Player.PLAYER1 },
            { type: 'rat',      r: 2, c: 0, pl: Player.PLAYER1 },
            { type: 'leopard',  r: 2, c: 2, pl: Player.PLAYER1 },
            { type: 'wolf',     r: 2, c: 4, pl: Player.PLAYER1 },
            { type: 'elephant', r: 2, c: 6, pl: Player.PLAYER1 },
            // Player 0 (Blue, Bottom)
            { type: 'lion',     r: 8, c: 6, pl: Player.PLAYER0 },
            { type: 'tiger',    r: 8, c: 0, pl: Player.PLAYER0 },
            { type: 'dog',      r: 7, c: 5, pl: Player.PLAYER0 },
            { type: 'cat',      r: 7, c: 1, pl: Player.PLAYER0 },
            { type: 'rat',      r: 6, c: 6, pl: Player.PLAYER0 },
            { type: 'leopard',  r: 6, c: 4, pl: Player.PLAYER0 },
            { type: 'wolf',     r: 6, c: 2, pl: Player.PLAYER0 },
            { type: 'elephant', r: 6, c: 0, pl: Player.PLAYER0 },
        ];

        initialPositions.forEach(pos => {
            if (this.isValidCoordinate(pos.r, pos.c)) {
                this.state[pos.r][pos.c].piece = new Piece(pos.type, pos.pl, pos.r, pos.c);
            } else {
                console.error("Invalid initial position:", pos);
            }
        });
    }

    /**
     * Checks if the coordinates are within the board bounds.
     * @param {number} row
     * @param {number} col
     * @returns {boolean}
     */
    isValidCoordinate(row, col) {
        return row >= 0 && row < BOARD_ROWS && col >= 0 && col < BOARD_COLS;
    }

    /**
     * Gets the data for a square.
     * @param {number} row
     * @param {number} col
     * @returns {{piece: Piece | null, terrain: TerrainType} | null} Returns null if coords are invalid.
     */
    getSquareData(row, col) {
        return this.isValidCoordinate(row, col) ? this.state[row][col] : null;
    }

    /**
     * Gets the piece at a given coordinate.
     * @param {number} row
     * @param {number} col
     * @returns {Piece | null} Returns null if no piece or invalid coords.
     */
    getPiece(row, col) {
        const square = this.getSquareData(row, col);
        return square ? square.piece : null;
    }

    /**
     * Gets the terrain type at a given coordinate.
     * @param {number} row
     * @param {number} col
     * @returns {TerrainType | null} Returns null if invalid coords.
     */
    getTerrain(row, col) {
        const square = this.getSquareData(row, col);
        return square ? square.terrain : null;
    }

    /**
     * Sets or removes a piece at the given coordinates.
     * Updates the piece's internal row/col if a piece is provided.
     * @param {number} row
     * @param {number} col
     * @param {Piece | null} piece The piece to place, or null to clear the square.
     */
    setPiece(row, col, piece) {
        if (this.isValidCoordinate(row, col)) {
            this.state[row][col].piece = piece;
            if (piece) {
                piece.setPosition(row, col); // Update piece's internal state
            }
        } else {
             console.error(`Attempted to set piece at invalid coordinate: ${row}, ${col}`);
        }
    }

    /**
     * Checks if a square is empty (has no piece).
     * @param {number} row
     * @param {number} col
     * @returns {boolean} True if empty or invalid coords.
     */
    isEmpty(row, col) {
        return this.getPiece(row, col) === null;
    }

    /**
     * Creates a deep copy of the board state. Essential for AI simulation.
     * @returns {Array<Array<{piece: Piece | null, terrain: TerrainType}>>} A new 2D array with cloned pieces.
     */
    cloneState() {
         return this.state.map(row =>
            row.map(cell => ({
                terrain: cell.terrain,
                piece: cell.piece ? new Piece(cell.piece.type, cell.piece.player, cell.piece.row, cell.piece.col) : null
            }))
        );
    }

    /**
     * Creates a new Board instance with a cloned state from this board.
     * @returns {Board} A new Board object.
     */
    clone() {
        const newBoard = new Board(); // Create a new instance
        newBoard.state = this.cloneState(); // Replace its state with a clone of the current state
        return newBoard;
    }

    /**
     * Returns the entire 2D board state array.
     * Use cautiously, prefer specific getters/setters.
     * @returns {Array<Array<{piece: Piece | null, terrain: TerrainType}>>}
     */
    getState() {
        return this.state;
    }

    /**
     * Counts the number of pieces for a given player.
     * @param {Player} player
     * @returns {number}
     */
    getPieceCount(player) {
        let count = 0;
        for (let r = 0; r < BOARD_ROWS; r++) {
            for (let c = 0; c < BOARD_COLS; c++) {
                if (this.state[r][c].piece?.player === player) {
                    count++;
                }
            }
        }
        return count;
    }
}