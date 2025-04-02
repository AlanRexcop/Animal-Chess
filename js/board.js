// js/board.js
import {
    BOARD_ROWS,
    BOARD_COLS,
    TerrainType,
    Player,
    AnimalRanks // Needed for piece setup
} from './constants.js';
import { Piece } from './piece.js'; // Assuming Piece class/factory is here

export class Board {
    constructor() {
        this.state = [];
        // Don't initialize here, wait for initBoard call
    }

    /**
     * Initializes the board state with terrain and pieces.
     */
    initBoard() {
        this.state = [];

        // 1. Initialize the grid with default state (NORMAL terrain, no pieces)
        for (let r = 0; r < BOARD_ROWS; r++) {
            this.state[r] = [];
            for (let c = 0; c < BOARD_COLS; c++) {
                this.state[r][c] = {
                    piece: null,
                    terrain: TerrainType.NORMAL
                };
            }
        }

        // 2. Set special terrain types based on standard layout (7 columns, 9 rows)

        // --- River --- (Rows 3, 4, 5; Columns 1, 2, 4, 5)
        const riverRows = [3, 4, 5];
        const riverCols = [1, 2, 4, 5];
        for (const r of riverRows) {
            for (const c of riverCols) {
                 // Check bounds just in case BOARD dimensions change later
                if (this.isValidCoordinate(r, c)) {
                    this.state[r][c].terrain = TerrainType.RIVER;
                }
            }
        }

        // --- Dens --- (Row 0, Col 3 for P2; Row 8, Col 3 for P1)
        if (this.isValidCoordinate(0, 3)) this.state[0][3].terrain = TerrainType.DEN_P2;
        if (this.isValidCoordinate(8, 3)) this.state[8][3].terrain = TerrainType.DEN_P1;

        // --- Traps ---
        // P2 Traps (near P2 Den at [0,3], affect P1 pieces) - Coords: [0,2], [0,4], [1,3]
        if (this.isValidCoordinate(0, 2)) this.state[0][2].terrain = TerrainType.TRAP_P2;
        if (this.isValidCoordinate(0, 4)) this.state[0][4].terrain = TerrainType.TRAP_P2;
        if (this.isValidCoordinate(1, 3)) this.state[1][3].terrain = TerrainType.TRAP_P2;

        // P1 Traps (near P1 Den at [8,3], affect P2 pieces) - Coords: [8,2], [8,4], [7,3]
        if (this.isValidCoordinate(8, 2)) this.state[8][2].terrain = TerrainType.TRAP_P1;
        if (this.isValidCoordinate(8, 4)) this.state[8][4].terrain = TerrainType.TRAP_P1;
        if (this.isValidCoordinate(7, 3)) this.state[7][3].terrain = TerrainType.TRAP_P1;

        // 3. Place the initial pieces
        this._setupInitialPieces();

        console.log("Board initialized with terrain and pieces.");
    }

    /**
     * Sets up the starting positions of all pieces. (Private helper method)
     */
    _setupInitialPieces() {
        // Player 2 Pieces (Top Side - Rows 0, 1, 2)
        this.setPiece(0, 0, new Piece('lion', Player.PLAYER2, 0, 0));
        this.setPiece(0, 6, new Piece('tiger', Player.PLAYER2, 0, 6));
        this.setPiece(1, 1, new Piece('dog', Player.PLAYER2, 1, 1));
        this.setPiece(1, 5, new Piece('cat', Player.PLAYER2, 1, 5));
        this.setPiece(2, 0, new Piece('rat', Player.PLAYER2, 2, 0));
        this.setPiece(2, 2, new Piece('leopard', Player.PLAYER2, 2, 2));
        this.setPiece(2, 4, new Piece('wolf', Player.PLAYER2, 2, 4));
        this.setPiece(2, 6, new Piece('elephant', Player.PLAYER2, 2, 6));

        // Player 1 Pieces (Bottom Side - Rows 6, 7, 8)
        this.setPiece(8, 6, new Piece('lion', Player.PLAYER1, 8, 6));
        this.setPiece(8, 0, new Piece('tiger', Player.PLAYER1, 8, 0));
        this.setPiece(7, 5, new Piece('dog', Player.PLAYER1, 7, 5));
        this.setPiece(7, 1, new Piece('cat', Player.PLAYER1, 7, 1));
        this.setPiece(6, 6, new Piece('rat', Player.PLAYER1, 6, 6));
        this.setPiece(6, 4, new Piece('leopard', Player.PLAYER1, 6, 4));
        this.setPiece(6, 2, new Piece('wolf', Player.PLAYER1, 6, 2));
        this.setPiece(6, 0, new Piece('elephant', Player.PLAYER1, 6, 0));
    }

    // --- Helper Methods ---

    isValidCoordinate(row, col) {
        return row >= 0 && row < BOARD_ROWS && col >= 0 && col < BOARD_COLS;
    }

    getSquareData(row, col) {
        if (!this.isValidCoordinate(row, col)) {
            return null; // Or throw error
        }
        return this.state[row][col];
    }

    getPiece(row, col) {
        const squareData = this.getSquareData(row, col);
        return squareData ? squareData.piece : null;
    }

    getTerrain(row, col) {
        const squareData = this.getSquareData(row, col);
        return squareData ? squareData.terrain : null; // Return null if out of bounds
    }

    setPiece(row, col, piece) { // piece can be a Piece object or null
        if (this.isValidCoordinate(row, col)) {
            this.state[row][col].piece = piece;
            // Update piece's internal coords if piece is not null and has row/col props
            if (piece && typeof piece.row !== 'undefined') piece.row = row;
            if (piece && typeof piece.col !== 'undefined') piece.col = col;
        } else {
            console.error(`Invalid coordinates: Cannot set piece at ${row}, ${col}`);
        }
    }

    isEmpty(row, col) {
        return this.getPiece(row, col) === null;
    }

    // Method to easily pass the state to the renderer/game logic
    getState() {
        return this.state;
    }
}

// Assuming Piece class/factory looks something like this in piece.js:
/*
export class Piece {
    constructor(type, rank, player, row, col) {
        this.type = type;
        this.rank = rank;
        this.player = player;
        this.row = row; // Store position within the piece
        this.col = col;
    }
    // Add methods later if needed (e.g., canEnterTerrain(terrainType))
}
*/