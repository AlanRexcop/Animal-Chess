export const BOARD_ROWS = 9;
export const BOARD_COLS = 7;

export const TERRAIN_LAND = 0;
export const TERRAIN_WATER = 1;
export const TERRAIN_TRAP = 2;
export const TERRAIN_PLAYER0_DEN = 3; // Blue Den
export const TERRAIN_PLAYER1_DEN = 4; // Red Den

// Player Identifiers (unchanged)
export const Player = {
    NONE: -1,
    PLAYER0: 0, // Blue (Player 1 in UI terms)
    PLAYER1: 1, // Red (AI or Player 2 in UI terms)
    getOpponent: function(player) {
        if (player === this.PLAYER0) return this.PLAYER1;
        if (player === this.PLAYER1) return this.PLAYER0;
        return this.NONE;
    }
};

// Piece Information (Rank and Name) - Keep original structure (unchanged)
export const PIECES = {
    rat:     { rank: 1, name: 'Rat',     symbol: '🐀', value: 100 },
    cat:     { rank: 2, name: 'Cat',     symbol: '🐈', value: 200 },
    dog:     { rank: 3, name: 'Dog',     symbol: '🐕', value: 300 },
    wolf:    { rank: 4, name: 'Wolf',    symbol: '🐺', value: 400 },
    leopard: { rank: 5, name: 'Leopard', symbol: '🐆', value: 500 },
    tiger:   { rank: 6, name: 'Tiger',   symbol: '🐅', value: 700 },
    lion:    { rank: 7, name: 'Lion',    symbol: '🦁', value: 800 },
    elephant:{ rank: 8, name: 'Elephant',symbol: '🐘', value: 650 }
};

// Helper to get piece key (lowercase name) from name (unchanged)
export function getPieceKey(pieceName) {
    return pieceName?.toLowerCase() ?? null;
}

// Den Locations (unchanged)
export const PLAYER0_DEN_ROW = 8;
export const PLAYER0_DEN_COL = 3;
export const PLAYER1_DEN_ROW = 0;
export const PLAYER1_DEN_COL = 3;

// Game Status Identifiers (unchanged)
export const GameStatus = {
    INIT: 'INIT',
    ONGOING: 'ONGOING',
    PLAYER0_WINS: 'PLAYER0_WINS', // Blue wins
    PLAYER1_WINS: 'PLAYER1_WINS', // Red wins
    DRAW: 'DRAW' // Potentially needed later
};

// AI Configuration (Defaults) (unchanged)
export const aiPlayer = Player.PLAYER1; // AI is Red
export const DEFAULT_AI_TARGET_DEPTH = 9;
export const DEFAULT_AI_TIME_LIMIT_MS = 5000;
export const MIN_AI_TIME_LIMIT_MS = 100;

// Animation duration (unchanged)
export const ANIMATION_DURATION = 300; // ms

// --- Asset Paths and Renderer Config ---

// Base path for all images (relative to index.html)
export const BASE_ASSETS_PATH = 'assets/'; // Make sure this is correct!

// Board Square Size (must match CSS and Tileset)
// ---- SIZING CONSTANTS ----
// Size of the squares on the game board (CSS size)
export const TILE_DISPLAY_SIZE_PX = 60;
// Size of a single tile WITHIN your tileset image file
export const TILESET_TILE_SIZE_PX = 32; // 
// Dimensions of your tileset image in number of tiles
export const TILESET_COLS = 16; 
export const TILESET_ROWS = 11;  

// Tileset Image Path for Land
export const TILESET_IMAGE = BASE_ASSETS_PATH + 'tiles/tileset_version1.1.png';

// Background Image Path for Water
export const WATER_BACKGROUND = BASE_ASSETS_PATH + 'tiles/water.gif';
export const UP_WATER_BACKGROUND = BASE_ASSETS_PATH + 'tiles/up_water.gif';
export const DOWN_WATER_BACKGROUND = BASE_ASSETS_PATH + 'tiles/down_water.gif';
export const TRAP_BACKGROUND = BASE_ASSETS_PATH + 'tiles/trap.gif';
// export const DEN_BACKGROUND = BASE_ASSETS_PATH + 'images/tiles/den.gif';

// Decoration Image Paths (for random land decorations)
export const DECORATION_IMAGES = [
    BASE_ASSETS_PATH + 'decorations/decorations_1.png',
    BASE_ASSETS_PATH + 'decorations/decorations_1.png',
    BASE_ASSETS_PATH + 'decorations/decorations_2.png',
    BASE_ASSETS_PATH + 'decorations/decorations_3.png',
    BASE_ASSETS_PATH + 'decorations/decorations_4.png',
];
export const DEN_DECORATION = BASE_ASSETS_PATH + 'decorations/den.png';
export const BRIGDE_DECORATION = BASE_ASSETS_PATH + 'decorations/ladder.png';

export const DECORATION_CHANCE = 0.5; // 40% chance to place a decoration on a land tile

// Specific Texture Overlay Paths (for special squares like traps and dens)
export const DEN_PLAYER0_TEXTURE = BASE_ASSETS_PATH + 'images/elements/den_p1.png'; // Image for Player 0 (Blue) Den
export const DEN_PLAYER1_TEXTURE = BASE_ASSETS_PATH + 'images/elements/den_p2.png'; // Image for Player 1 (Red) Den

// Tile Configuration Map
// Describes which tile from the tileset to use based on Land (L) or Other (O) neighbors (T, L, B, R)
// Value format: CSS background-position string "Xpx Ypx" relative to the tileset image origin (0,0)
export const TILE_CONFIG_MAP = {
    "OOLL": `-${(8 + 0) * TILE_DISPLAY_SIZE_PX}px -${(4 + 0) * TILE_DISPLAY_SIZE_PX}px`,
    "OLLL": `-${(8 + 1) * TILE_DISPLAY_SIZE_PX}px -${(4 + 0) * TILE_DISPLAY_SIZE_PX}px`,
    "OLLO": `-${(8 + 2) * TILE_DISPLAY_SIZE_PX}px -${(4 + 0) * TILE_DISPLAY_SIZE_PX}px`, // MODIFIED: Integrated change
    "OOLO": `-${(8 + 3) * TILE_DISPLAY_SIZE_PX}px -${(4 + 0) * TILE_DISPLAY_SIZE_PX}px`,
    "LOLL": `-${(8 + 0) * TILE_DISPLAY_SIZE_PX + 5}px -${(4 + 1) * TILE_DISPLAY_SIZE_PX}px`,
    "LLLL": `-${(8 + 1) * TILE_DISPLAY_SIZE_PX}px -${(4 + 1) * TILE_DISPLAY_SIZE_PX}px`,
    "LLLO": `-${(8 + 2) * TILE_DISPLAY_SIZE_PX - 3}px -${(4 + 1) * TILE_DISPLAY_SIZE_PX}px`,
    "LOLO": `-${(8 + 3) * TILE_DISPLAY_SIZE_PX}px -${(4 + 1) * TILE_DISPLAY_SIZE_PX}px`,
    "LOOL": `-${(8 + 0) * TILE_DISPLAY_SIZE_PX}px -${(4 + 2) * TILE_DISPLAY_SIZE_PX}px`,
    "LLOL": `-${(8 + 1) * TILE_DISPLAY_SIZE_PX}px -${(4 + 2) * TILE_DISPLAY_SIZE_PX}px`,
    "LLOO": `-${(8 + 2) * TILE_DISPLAY_SIZE_PX}px -${(4 + 2) * TILE_DISPLAY_SIZE_PX}px`,
    "LOOO": `-${(8 + 3) * TILE_DISPLAY_SIZE_PX}px -${(4 + 2) * TILE_DISPLAY_SIZE_PX}px`,
    "OLOO": `-${(8 + 0) * TILE_DISPLAY_SIZE_PX}px -${(4 + 3) * TILE_DISPLAY_SIZE_PX}px`,
    "OOOL": `-${(8 + 1) * TILE_DISPLAY_SIZE_PX}px -${(4 + 3) * TILE_DISPLAY_SIZE_PX}px`,
    "OLOL": `-${(8 + 2) * TILE_DISPLAY_SIZE_PX}px -${(4 + 3) * TILE_DISPLAY_SIZE_PX}px`,
    "OOOO": `-${(8 + 3) * TILE_DISPLAY_SIZE_PX}px -${(4 + 3) * TILE_DISPLAY_SIZE_PX}px`,
    "Den":  `-${(3) * TILE_DISPLAY_SIZE_PX}px -${(3) * TILE_DISPLAY_SIZE_PX}px`,
};

// Add any other constants needed globally (unchanged)