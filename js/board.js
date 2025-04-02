import { BOARD_ROWS, BOARD_COLS, TerrainType, Player } from './constants.js';
import { Piece } from './piece.js';

export class Board {
    constructor() {
        /** @type {Array<Array<{piece: Piece|null, terrain: string}>>} */
        this.state = [];
    }

    // ========================
    //  Core Board Setup
    // ========================
    
    /**
     * Initializes game board with terrain and starting pieces
     */
    initBoard() {
        this._createEmptyBoard();
        this._setupTerrain();
        this._setupInitialPieces();
    }
    // ========================
    //  Terrain Configuration
    // ========================
    
    _setupTerrain() {
        // River setup
        const RIVER_REGIONS = [
            { rows: [3,4,5], cols: [1,2,4,5] }
        ];
        
        RIVER_REGIONS.forEach(region => {
            region.rows.forEach(r => region.cols.forEach(c => 
                this._setTerrainSafe(r, c, TerrainType.RIVER)
            ));
        });

        // Player dens
        this._setTerrainSafe(0, 3, TerrainType.DEN_P2);
        this._setTerrainSafe(8, 3, TerrainType.DEN_P1);

        // Traps
        const TRAPS = {
            [Player.PLAYER1]: [[8,2], [8,4], [7,3]],
            [Player.PLAYER2]: [[0,2], [0,4], [1,3]]
        };

        TRAPS[Player.PLAYER1].forEach(([r,c]) => 
            this._setTerrainSafe(r, c, TerrainType.TRAP_P1));
        TRAPS[Player.PLAYER2].forEach(([r,c]) => 
            this._setTerrainSafe(r, c, TerrainType.TRAP_P2));
    }

    // ========================
    //  Piece Management
    // ========================
    
    _setupInitialPieces() {
        const STARTING_POSITIONS = {
            [Player.PLAYER1]: [
                ['lion', 8,6], ['tiger',8,0], ['dog',7,5],
                ['cat',7,1], ['rat',6,6], ['leopard',6,4],
                ['wolf',6,2], ['elephant',6,0]
            ],
            [Player.PLAYER2]: [
                ['lion',0,0], ['tiger',0,6], ['dog',1,1],
                ['cat',1,5], ['rat',2,0], ['leopard',2,2],
                ['wolf',2,4], ['elephant',2,6]
            ]
        };

        Object.entries(STARTING_POSITIONS).forEach(([player, pieces]) => 
            pieces.forEach(([type, row, col]) => 
                this.setPiece(row, col, new Piece(type, parseInt(player), row, col))
        ));
    }

    // ========================
    //  Board State Accessors
    // ========================

    /** @param {number} row @param {number} col @returns {boolean} */
    isValidCoordinate(row, col) {
        return row >= 0 && row < BOARD_ROWS && col >= 0 && col < BOARD_COLS;
    }

    /** @param {number} row @param {number} col @returns {Object|null} */
    getSquareData(row, col) {
        return this.isValidCoordinate(row, col) ? this.state[row][col] : null;
    }

    /** @param {number} row @param {number} col @returns {Piece|null} */
    getPiece(row, col) {
        return this.getSquareData(row, col)?.piece || null;
    }

    /** @param {number} row @param {number} col @returns {string|null} */
    getTerrain(row, col) {
        return this.getSquareData(row, col)?.terrain || null;
    }

    /** @param {number} row @param {number} col @param {Piece|null} piece */
    setPiece(row, col, piece) {
        if (this.isValidCoordinate(row, col)) {
            this.state[row][col].piece = piece;
            if (piece) [piece.row, piece.col] = [row, col];
        }
    }

    /** @param {number} row @param {number} col @returns {boolean} */
    isEmpty(row, col) {
        return !this.getPiece(row, col);
    }

    /** @returns {Array<Array<{piece:Piece|null, terrain:string}>>} */
    getState() {
        return this.state;
    }

    // ========================
    //  Private Helpers
    // ========================
    
    _createEmptyBoard() {
        this.state = Array.from({length: BOARD_ROWS}, () => 
            Array(BOARD_COLS).fill().map(() => ({
                piece: null,
                terrain: TerrainType.NORMAL
            }))
        );
    }

    _setTerrainSafe(row, col, terrain) {
        if (this.isValidCoordinate(row, col)) {
            this.state[row][col].terrain = terrain;
        }
    }

    _validateCoordinates(row, col) {
        if (!this.isValidCoordinate(row, col)) {
            throw new Error(`Invalid board coordinates: [${row},${col}]`);
        }
    }
}