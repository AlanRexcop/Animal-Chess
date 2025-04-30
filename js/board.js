import {
    BOARD_ROWS, BOARD_COLS,
    TERRAIN_LAND, TERRAIN_WATER, TERRAIN_TRAP, TERRAIN_PLAYER0_DEN, TERRAIN_PLAYER1_DEN,
    PLAYER0_DEN_ROW, PLAYER0_DEN_COL, PLAYER1_DEN_ROW, PLAYER1_DEN_COL,
    PIECES, Player
} from './constants.js';
import { Piece } from './piece.js';

export class Board {
    constructor() {
        this.state = []; // 2D array: state[row][col] = { piece: Piece | null, terrain: number }
        // Don't call initBoard here, let game.js decide when
    }

    // --- Initialization ---

    initBoard() {
        this.state = [];
        for (let r = 0; r < BOARD_ROWS; r++) {
            this.state.push(Array(BOARD_COLS).fill(null));
        }
        this._setupTerrain();
        this._setupInitialPieces();
    }

    _setupTerrain() {
        for (let r = 0; r < BOARD_ROWS; r++) {
            for (let c = 0; c < BOARD_COLS; c++) {
                this.state[r][c] = { piece: null, terrain: this._getTerrainType(r, c) };
            }
        }
    }

    _getTerrainType(r, c) {
        // Dens
        if (r === PLAYER1_DEN_ROW && c === PLAYER1_DEN_COL) return TERRAIN_PLAYER1_DEN; // Red Den
        if (r === PLAYER0_DEN_ROW && c === PLAYER0_DEN_COL) return TERRAIN_PLAYER0_DEN; // Blue Den

        // Traps (Using original numeric constants for consistency with worker if needed)
        // Player 1 (Red) Traps are near row 0
        if ((r === 0 && (c === 2 || c === 4)) || (r === 1 && c === 3)) return TERRAIN_TRAP;
        // Player 0 (Blue) Traps are near row 8
        if ((r === 8 && (c === 2 || c === 4)) || (r === 7 && c === 3)) return TERRAIN_TRAP;

        // Water
        if (r >= 3 && r <= 5 && (c === 1 || c === 2 || c === 4 || c === 5)) return TERRAIN_WATER;

        // Land
        return TERRAIN_LAND;
    }

     _setupInitialPieces() {
        const initialPositions = [
            // Player 1 (Red)
            { type: 'lion',    row: 0, col: 0, pl: Player.PLAYER1 },
            { type: 'tiger',   row: 0, col: 6, pl: Player.PLAYER1 },
            { type: 'dog',     row: 1, col: 1, pl: Player.PLAYER1 },
            { type: 'cat',     row: 1, col: 5, pl: Player.PLAYER1 },
            { type: 'rat',     row: 2, col: 0, pl: Player.PLAYER1 },
            { type: 'leopard', row: 2, col: 2, pl: Player.PLAYER1 },
            { type: 'wolf',    row: 2, col: 4, pl: Player.PLAYER1 },
            { type: 'elephant',row: 2, col: 6, pl: Player.PLAYER1 },
            // Player 0 (Blue)
            { type: 'lion',    row: 8, col: 6, pl: Player.PLAYER0 },
            { type: 'tiger',   row: 8, col: 0, pl: Player.PLAYER0 },
            { type: 'dog',     row: 7, col: 5, pl: Player.PLAYER0 },
            { type: 'cat',     row: 7, col: 1, pl: Player.PLAYER0 },
            { type: 'rat',     row: 6, col: 6, pl: Player.PLAYER0 },
            { type: 'leopard', row: 6, col: 4, pl: Player.PLAYER0 },
            { type: 'wolf',    row: 6, col: 2, pl: Player.PLAYER0 },
            { type: 'elephant',row: 6, col: 0, pl: Player.PLAYER0 },
        ];

        initialPositions.forEach(pos => {
            if (this.isValidCoordinate(pos.row, pos.col)) {
                try {
                    const piece = new Piece(pos.type, pos.pl, pos.row, pos.col);
                    this.state[pos.row][pos.col].piece = piece;
                } catch (e) {
                    console.error(`Failed to create piece: ${pos.type}`, e);
                }
            } else {
                console.error("Invalid initial position:", pos);
            }
        });
    }

    // --- State Access ---

    isValidCoordinate(row, col) {
        return row >= 0 && row < BOARD_ROWS && col >= 0 && col < BOARD_COLS;
    }

    getSquareData(row, col) {
        if (!this.isValidCoordinate(row, col)) {
            return null; // Or throw error
        }
        // Return a copy to prevent accidental modification? For now, return direct ref.
        return this.state[row][col];
    }

    getPiece(row, col) {
        if (!this.isValidCoordinate(row, col)) {
            return null;
        }
        return this.state[row][col]?.piece ?? null;
    }

    getTerrain(row, col) {
         if (!this.isValidCoordinate(row, col)) {
            // Return a default or handle error
            return TERRAIN_LAND; // Or null/undefined
        }
        return this.state[row][col]?.terrain ?? TERRAIN_LAND;
    }

    isEmpty(row, col) {
        if (!this.isValidCoordinate(row, col)) {
            return true; // Treat off-board as empty for movement checks?
        }
        return this.state[row][col]?.piece === null;
    }

    // --- State Modification ---

    setPiece(row, col, piece) { // piece can be a Piece object or null
        if (!this.isValidCoordinate(row, col)) {
            console.error(`SetPiece: Invalid coordinates (${row}, ${col})`);
            return;
        }
        // Update the board state
        this.state[row][col].piece = piece;

        // If adding a piece (not null), update its internal position
        if (piece instanceof Piece) {
            piece.setPosition(row, col);
        }
    }

    // --- Getters ---

    // Returns a deep copy suitable for the AI worker or history
    // Note: The original worker expected a specific format. Let's mimic the original cloneBoard.
    getClonedStateForWorker() {
        return this.state.map(row =>
            row.map(cell => ({
                terrain: cell.terrain,
                piece: cell.piece ? { ...cell.piece } : null
            }))
        );
    }

     // Get simple 2D array of piece/terrain for rendering if needed
     getState() {
        return this.state;
     }
}