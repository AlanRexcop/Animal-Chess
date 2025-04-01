// js/board.js

import { BOARD_ROWS, BOARD_COLS, TerrainType, Player } from './constants.js';
import { Piece } from './piece.js'; // Assuming Piece class is exported from piece.js

export class Board {
    /** @type {Array<Array<{piece: Piece | null, terrain: string}>>} */
    state; // The 2D array representing the board state

    constructor() {
        this.state = [];
        this.initBoard();
    }

    /**
     * Initializes the board state array, sets up terrain, and calls piece setup.
     */
    initBoard() {
        this.state = Array.from({ length: BOARD_ROWS }, () =>
            Array.from({ length: BOARD_COLS }, () => ({
                piece: null,
                terrain: TerrainType.NORMAL // Default to normal terrain
            }))
        );

        // --- Define Terrain ---

        // 1. River (Rows 3, 4, 5 - excluding specific columns)
        const riverRows = [3, 4, 5];
        const riverCols = [1, 2, 4, 5]; // Columns containing river
        for (const r of riverRows) {
            for (const c of riverCols) {
                if (this.isValidCoordinate(r, c)) { // Check bounds just in case
                   this.state[r][c].terrain = TerrainType.RIVER;
                }
            }
        }

        // 2. Traps (Specific coordinates)
        const trapCoords = [
            // Player 2 side (bottom) - Assuming P2 starts bottom
            { r: 8, c: 2 }, { r: 8, c: 4 }, { r: 7, c: 3 },
            // Player 1 side (top) - Assuming P1 starts top
            { r: 0, c: 2 }, { r: 0, c: 4 }, { r: 1, c: 3 },
        ];
         for (const coord of trapCoords) {
            if (this.isValidCoordinate(coord.r, coord.c)) {
                this.state[coord.r][coord.c].terrain = TerrainType.TRAP;
                // Optional: Store which player's trap it is if needed for rules
                // this.state[coord.r][coord.c].trapOwner = (coord.r <= 2) ? Player.PLAYER1 : Player.PLAYER2;
            }
        }

        // 3. Dens (Specific coordinates)
        const denCoords = [
            { r: 8, c: 3 },  // Player 2 Den (bottom)
            { r: 0, c: 3 }, // Player 1 Den (top)
        ];
        for (const coord of denCoords) {
             if (this.isValidCoordinate(coord.r, coord.c)) {
                this.state[coord.r][coord.c].terrain = TerrainType.DEN;
                // Optional: Store den owner
                // this.state[coord.r][coord.c].denOwner = (coord.r === 0) ? Player.PLAYER1 : Player.PLAYER2;
            }
        }


        // --- Setup Initial Pieces ---
        this._setupInitialPieces(); // Call the private helper method
    }

    /**
     * Sets up the initial piece positions on the board.
     * Assumes Player 1 starts at the bottom (row indices 6, 5, 4)
     * Assumes Player 2 starts at the top (row indices 0, 1, 2)
     * Uses a symmetrical layout.
     * @private
     */
    _setupInitialPieces() {
      // Player 1 Pieces (Bottom)
      this.setPiece(8, 0, new Piece('lion', Player.PLAYER1, 8, 0));
      this.setPiece(8, 6, new Piece('tiger', Player.PLAYER1, 8, 6));
      this.setPiece(7, 1, new Piece('dog', Player.PLAYER1, 7, 1));
      this.setPiece(7, 5, new Piece('wolf', Player.PLAYER1, 7, 5));
      this.setPiece(6, 0, new Piece('elephant', Player.PLAYER1, 6, 0));
      this.setPiece(6, 2, new Piece('cat', Player.PLAYER1, 6, 2));
      this.setPiece(6, 4, new Piece('leopard', Player.PLAYER1, 6, 4));
      this.setPiece(6, 6, new Piece('rat', Player.PLAYER1, 6, 6));

      // Player 2 Pieces (Top) - Mirrored layout
      this.setPiece(0, 6, new Piece('lion', Player.PLAYER2, 0, 6));     // Mirrored Lion
      this.setPiece(0, 0, new Piece('tiger', Player.PLAYER2, 0, 0));    // Mirrored Tiger
      this.setPiece(1, 5, new Piece('dog', Player.PLAYER2, 1, 5));      // Mirrored Dog
      this.setPiece(1, 1, new Piece('wolf', Player.PLAYER2, 1, 1));     // Mirrored Wolf
      this.setPiece(2, 6, new Piece('elephant', Player.PLAYER2, 2, 6)); // Mirrored Elephant
      this.setPiece(2, 4, new Piece('cat', Player.PLAYER2, 2, 4));      // Mirrored Cat
      this.setPiece(2, 2, new Piece('leopard', Player.PLAYER2, 2, 2));  // Mirrored Leopard
      this.setPiece(2, 0, new Piece('rat', Player.PLAYER2, 2, 0));      // Mirrored Rat

      // Verify no piece is placed directly *on* a trap or den initially in this layout
      // (They are on NORMAL terrain squares according to the coords used).
  }


    /**
     * Checks if the given row and column are within the board boundaries.
     * @param {number} row
     * @param {number} col
     * @returns {boolean} True if the coordinate is valid, false otherwise.
     */
    isValidCoordinate(row, col) {
        return row >= 0 && row < BOARD_ROWS && col >= 0 && col < BOARD_COLS;
    }

    /**
     * Gets the piece at the specified coordinate.
     * @param {number} row
     * @param {number} col
     * @returns {Piece | null} The Piece object or null if the square is empty or invalid.
     */
    getPiece(row, col) {
        if (!this.isValidCoordinate(row, col)) {
            return null; // Invalid coordinate
        }
        return this.state[row][col].piece;
    }

    /**
     * Gets the terrain type at the specified coordinate.
     * @param {number} row
     * @param {number} col
     * @returns {string | null} The terrain type (from TerrainType) or null if invalid coordinate.
     */
    getTerrain(row, col) {
        if (!this.isValidCoordinate(row, col)) {
            return null; // Invalid coordinate
        }
        return this.state[row][col].terrain;
    }

    /**
     * Sets a piece at the specified coordinate. Use null to clear the square.
     * @param {number} row
     * @param {number} col
     * @param {Piece | null} piece - The piece object to place, or null to empty the square.
     */
    setPiece(row, col, piece) {
        if (this.isValidCoordinate(row, col)) {
            // If placing a piece (not null), update its internal position too (optional but good practice)
            if (piece instanceof Piece) {
                 piece.row = row;
                 piece.col = col;
            }
            this.state[row][col].piece = piece;
        } else {
            console.warn(`Board: Attempted to set piece at invalid coordinate (${row}, ${col})`);
        }
    }

    /**
     * Checks if the square at the specified coordinate is empty (contains no piece).
     * @param {number} row
     * @param {number} col
     * @returns {boolean} True if the square is empty and valid, false otherwise (or if invalid coordinate).
     */
    isEmpty(row, col) {
        if (!this.isValidCoordinate(row, col)) {
            return false; // Invalid coordinates are not considered "empty" in a gameplay context
        }
        return this.state[row][col].piece === null;
    }
}