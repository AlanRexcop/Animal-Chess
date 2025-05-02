// js/constants.js

// ... (existing imports and constants)

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
export const TILE_SIZE_PX = 60; // Make sure this is correct!
// export const SCALE_TILE_SIZE_PX = 
// Tileset Image Path for Land
export const TILESET_IMAGE = BASE_ASSETS_PATH + 'tiles/tileset_version1.1.png';

// Background Image Path for Water
export const WATER_BACKGROUND = BASE_ASSETS_PATH + 'images/water/ezgif.com-animated-gif-maker.gif'; // <-- New constant for water

// Decoration Image Paths (for random land decorations)
export const DECORATION_IMAGES = [
    // BASE_ASSETS_PATH + 'decorations/grass_patch_1.png',
    // BASE_ASSETS_PATH + 'decorations/flower_1.png',
    // Add paths to your other decoration images here
];
export const DECORATION_CHANCE = 0.4; // 40% chance to place a decoration on a land tile

// Specific Texture Overlay Paths (for special squares like traps and dens)
export const TRAP_TEXTURE = BASE_ASSETS_PATH + 'images/elements/trap.png';
export const DEN_PLAYER0_TEXTURE = BASE_ASSETS_PATH + 'images/elements/den_p1.png'; // Image for Player 0 (Blue) Den
export const DEN_PLAYER1_TEXTURE = BASE_ASSETS_PATH + 'images/elements/den_p2.png'; // Image for Player 1 (Red) Den

// Tile Configuration Map (YOU NEED TO ADJUST THESE PIXEL VALUES)
// Describes which tile from the tileset to use based on Land (L) or Other (O) neighbors (T, L, B, R)
// Key format: T(op) L(eft) B(bottom) R(ight) neighbor type
// Value format: CSS background-position string "Xpx Ypx" relative to the tileset image origin (0,0)
// Example assumes a 4x4 grid of tiles in your land_tileset.png
export const TILE_CONFIG_MAP = {
    "OOLL": `-${(8 + 0) * TILE_SIZE_PX}px -${(4 + 0) * TILE_SIZE_PX}px`, // Example: Tile at (9,4)
    "LOLL": `-${(8 + 1) * TILE_SIZE_PX}px -${(4 + 0) * TILE_SIZE_PX}px`, // Example: Tile at (10,4)
    "LOOO": `-${(8 + 2) * TILE_SIZE_PX}px -${(4 + 0) * TILE_SIZE_PX}px`, // Example: Tile at (11,4)
    "OOLO": `-${(8 + 3) * TILE_SIZE_PX}px -${(4 + 0) * TILE_SIZE_PX}px`, // Example: Tile at (8,5)
    "LOLL": `-${(8 + 0) * TILE_SIZE_PX}px -${(4 + 1) * TILE_SIZE_PX}px`, // Example: Tile at (9,5)
    "LLLL": `-${(8 + 1) * TILE_SIZE_PX}px -${(4 + 1) * TILE_SIZE_PX}px`, // Example: Tile at (10,5)
    "LLLO": `-${(8 + 2) * TILE_SIZE_PX}px -${(4 + 1) * TILE_SIZE_PX}px`, // Example: Tile at (11,5)
    "LOLO": `-${(8 + 3) * TILE_SIZE_PX}px -${(4 + 1) * TILE_SIZE_PX}px`, // Example: Tile at (9,6)
    "LOOL": `-${(8 + 0) * TILE_SIZE_PX}px -${(4 + 2) * TILE_SIZE_PX}px`, // Example: Tile at (10,6)
    "LLOL": `-${(8 + 1) * TILE_SIZE_PX}px -${(4 + 2) * TILE_SIZE_PX}px`, // Example: Tile at (11,6)
    "LLOO": `-${(8 + 2) * TILE_SIZE_PX}px -${(4 + 2) * TILE_SIZE_PX}px`, // Example: Tile at (8,7)
    "LOOO": `-${(8 + 3) * TILE_SIZE_PX}px -${(4 + 2) * TILE_SIZE_PX}px`, // Example: Tile at (9,7)
    "OLOO": `-${(8 + 0) * TILE_SIZE_PX}px -${(4 + 3) * TILE_SIZE_PX}px`, // Example: Tile at (8,7)
    "OOOL": `-${(8 + 1) * TILE_SIZE_PX}px -${(4 + 3) * TILE_SIZE_PX}px`, // Example: Tile at (10,7)
    "OLOL": `-${(8 + 2) * TILE_SIZE_PX}px -${(4 + 3) * TILE_SIZE_PX}px`, // Example: Tile at (11,7)
    "OOOO": `-${(8 + 3) * TILE_SIZE_PX}px -${(4 + 3) * TILE_SIZE_PX}px`, // Example: Tile at (9,7)
    // Add any other specific keys/positions if needed for your tileset
    // Re-added one key with a typo fix from previous ("OULO" -> "OOLO")
    // Ensure you have ALL 16 keys from OOOO to LLLL
     "OOLO": `-${0 * TILE_SIZE_PX}px -${3 * TILE_SIZE_PX}px`, // Added/Corrected this one based on common tile patterns. Double check if needed.
    // Consider adding explicit configs for the border/river edges if they need special tiles
    // For example, if a land tile is at r=2, c=1 (above the water) it has Bottom=Other.
    // If a land tile is at r=6, c=1 (below the water) it has Top=Other.
    // These should be covered by the existing OLLL/LLLO patterns, etc.

    // The tile for grass surrounded by water at (8,4) is probably not needed as a specific
    // config key unless it looks unique. It would likely match 'OOOO' or 'OLOL' depending
    // on its neighbors IF its terrain type was actually LAND. But r=8, c=4 is land,
    // and r=3,4,5 are water (cols 1,2,4,5). So (8,4) is not surrounded by water.
    // The water squares themselves (r=3,4,5, c=1,2,4,5) have TERRAIN_WATER.
};

// Add any other constants needed globally (unchanged)