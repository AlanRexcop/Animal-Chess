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
    }

    // --- Initialization ---

    initBoard() {
        // This function now primarily sets up terrain and ensures the board is clear of pieces.
        // Actual piece placement is handled by setupStandardInitialPieces or setupPiecesFromLayout.
        this.state = [];
        for (let r = 0; r < BOARD_ROWS; r++) {
            this.state.push(Array(BOARD_COLS).fill(null));
        }
        this._setupTerrain();
        this.clearAllPieces(); // Ensure pieces are cleared after terrain setup
    }

    _setupTerrain() {
        for (let r = 0; r < BOARD_ROWS; r++) {
            for (let c = 0; c < BOARD_COLS; c++) {
                this.state[r][c] = { piece: null, terrain: this._getTerrainType(r, c) };
            }
        }
    }

    _getTerrainType(r, c) {
        if (r === PLAYER1_DEN_ROW && c === PLAYER1_DEN_COL) return TERRAIN_PLAYER1_DEN;
        if (r === PLAYER0_DEN_ROW && c === PLAYER0_DEN_COL) return TERRAIN_PLAYER0_DEN;
        if ((r === 0 && (c === 2 || c === 4)) || (r === 1 && c === 3)) return TERRAIN_TRAP;
        if ((r === 8 && (c === 2 || c === 4)) || (r === 7 && c === 3)) return TERRAIN_TRAP;
        if (r >= 3 && r <= 5 && (c === 1 || c === 2 || c === 4 || c === 5)) return TERRAIN_WATER;
        return TERRAIN_LAND;
    }

    // ****** MOVED & RENAMED: Logic for standard piece setup ******
    setupStandardInitialPieces() {
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
                    // Ensure the cell exists before setting piece
                    if (this.state[pos.row] && this.state[pos.row][pos.col]) {
                        this.state[pos.row][pos.col].piece = piece;
                    } else {
                         console.error(`Board.js: Cell [${pos.row},${pos.col}] does not exist for standard setup.`);
                    }
                } catch (e) {
                    console.error(`Board.js: Failed to create piece for standard setup: ${pos.type}`, e);
                }
            } else {
                console.error("Board.js: Invalid initial position in standard setup:", pos);
            }
        });
    }
    // ****** END MOVED & RENAMED ******

    // ****** ADDED: Method to set up pieces from a layout array ******
    setupPiecesFromLayout(layoutArray) {
        if (!Array.isArray(layoutArray)) {
            console.error("Board.js: Invalid layoutArray provided. Must be an array. Falling back to standard.");
            this.setupStandardInitialPieces(); // Fallback
            return;
        }
        this.clearAllPieces(); // Ensure board is clear before applying new layout

        layoutArray.forEach(pieceDetail => {
            const { type, player, r, c } = pieceDetail;
            if (this.isValidCoordinate(r, c)) {
                try {
                    const piece = new Piece(type, player, r, c);
                     // Ensure the cell exists before setting piece
                    if (this.state[r] && this.state[r][c]) {
                        this.state[r][c].piece = piece;
                    } else {
                        console.error(`Board.js: Cell [${r},${c}] does not exist for layout setup.`);
                    }
                } catch (e) {
                    console.error(`Board.js: Failed to create piece from layout: ${type} for player ${player} at ${r},${c}`, e);
                }
            } else {
                console.error("Board.js: Invalid coordinate in layout array:", pieceDetail);
            }
        });
    }
    // ****** END ADDED ******

    clearAllPieces() {
        if (!this.state || this.state.length === 0) {
            console.warn("Board.js: Board state not initialized, cannot clear pieces.");
            return;
        }
        for (let r = 0; r < BOARD_ROWS; r++) {
            for (let c = 0; c < BOARD_COLS; c++) {
                if (this.state[r] && this.state[r][c]) { // Check if row and cell exist
                    this.state[r][c].piece = null;
                }
            }
        }
    }

    // --- State Access ---
    isValidCoordinate(row, col) {
        return row >= 0 && row < BOARD_ROWS && col >= 0 && col < BOARD_COLS;
    }

    getSquareData(row, col) {
        if (!this.isValidCoordinate(row, col)) return null;
        return this.state[row][col];
    }

    getPiece(row, col) {
        if (!this.isValidCoordinate(row, col)) return null;
        return this.state[row]?.[col]?.piece ?? null;
    }

    getTerrain(row, col) {
         if (!this.isValidCoordinate(row, col)) return TERRAIN_LAND; // Default for out of bounds
        return this.state[row]?.[col]?.terrain ?? TERRAIN_LAND; // Default if somehow undefined
    }

    isEmpty(row, col) {
        if (!this.isValidCoordinate(row, col)) return true;
        return this.state[row]?.[col]?.piece === null;
    }

    // --- State Modification ---
    setPiece(row, col, piece) {
        if (!this.isValidCoordinate(row, col)) { console.error(`Board.js: SetPiece: Invalid coordinates (${row}, ${col})`); return; }
        if (this.state[row] && this.state[row][col]) { // Ensure cell exists
            this.state[row][col].piece = piece;
            if (piece instanceof Piece) { piece.setPosition(row, col); }
        } else {
            console.error(`Board.js: Cell [${row},${c}] does not exist for setPiece.`);
        }
    }

    // --- Getters ---
    getClonedStateForWorker() {
        return this.state.map(row =>
            row.map(cell => ({
                terrain: cell.terrain,
                piece: cell.piece ? { ...cell.piece } : null
            }))
        );
    }

     getState() {
        return this.state;
     }
}