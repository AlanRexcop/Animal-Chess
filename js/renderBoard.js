import {
  BOARD_ROWS, BOARD_COLS, TERRAIN_LAND, TERRAIN_WATER, TERRAIN_TRAP, TERRAIN_PLAYER0_DEN, TERRAIN_PLAYER1_DEN,
  TILESET_IMAGE, 
  TILE_DISPLAY_SIZE_PX,
  TILESET_COLS, TILESET_ROWS, // Ensure these are correctly set in constants.js!
  DECORATION_IMAGES, DECORATION_CHANCE, TILE_CONFIG_MAP,
  WATER_BACKGROUND, UP_WATER_BACKGROUND, DOWN_WATER_BACKGROUND,
  BASE_ASSETS_PATH, // Assuming you added this for piece paths too
  TRAP_BACKGROUND,
  BRIGDE_DECORATION,
  DEN_DECORATION
} from './constants.js';

const colLabelsTop = document.getElementById('col-labels-top');
const colLabelsBottom = document.getElementById('col-labels-bottom');
const rowLabelsLeft = document.getElementById('row-labels-left');
const rowLabelsRight = document.getElementById('row-labels-right');

const boardElement = document.getElementById('board');
let coordinatesRendered = false; function renderCoordinatesIfNeeded() { if (coordinatesRendered) return; colLabelsTop.innerHTML = ''; colLabelsBottom.innerHTML = ''; rowLabelsLeft.innerHTML = ''; rowLabelsRight.innerHTML = ''; for (let c = 0; c < BOARD_COLS; c++) { const l=String.fromCharCode(65+c); const sT=document.createElement('span'); sT.textContent=l; colLabelsTop.appendChild(sT); const sB=document.createElement('span'); sB.textContent=l; colLabelsBottom.appendChild(sB); } for (let r = 0; r < BOARD_ROWS; r++) { const l=(BOARD_ROWS-r).toString(); const sL=document.createElement('span'); sL.textContent=l; rowLabelsLeft.appendChild(sL); const sR=document.createElement('span'); sR.textContent=l; rowLabelsRight.appendChild(sR); } coordinatesRendered = true; }

let landTilePatterns = null;
export function initializeLandTilePatterns(boardState) {
	console.log("Initializing land tile patterns...");
	landTilePatterns = Array(BOARD_ROWS).fill(null).map(() => Array(BOARD_COLS).fill(null));
	for (let r = 0; r < BOARD_ROWS; r++) {
		for (let c = 0; c < BOARD_COLS; c++) {
            if (DECORATION_IMAGES.length > 0 && Math.random() < DECORATION_CHANCE){
			// if (boardState[r]?.[c]?.terrain === TERRAIN_LAND) {
				landTilePatterns[r][c] = Math.floor(Math.random() * DECORATION_IMAGES.length);
			}
		}
	}
	console.log("Land tile patterns initialized.");
}
function isLogicallyLandForTiling(boardState, r, c) {
    if (c < 0 || c >= BOARD_COLS) return false;
    if (r < 0 || r >= BOARD_ROWS) return true;
    const cell = boardState[r]?.[c];
    if (!cell) { console.warn(`isLogicallyLandForTiling: Missing cell data for ${r},${c}`); return false; }
    return cell.terrain !== TERRAIN_WATER;
}

function getTileConfigurationKey(boardState, r, c) {
    const isTopLand = true; /*isLogicallyLandForTiling(boardState, r - 1, c);*/
    const isLeftLand = isLogicallyLandForTiling(boardState, r, c - 1);
    const isBottomLand = true; /*isLogicallyLandForTiling(boardState, r + 1, c);*/
    const isRightLand = isLogicallyLandForTiling(boardState, r, c + 1);
    let configKey = (isTopLand ? 'L' : 'O') + (isLeftLand ? 'L' : 'O') + (isBottomLand ? 'L' : 'O') + (isRightLand ? 'L' : 'O');
    return TILE_CONFIG_MAP[configKey] ? configKey : "LLLL";
}

export function renderBoard(boardState, clickHandler, lastMove = null) {
    if (!boardElement) { console.error("Board element not found!"); return; }

    const fragment = document.createDocumentFragment();

    // --- Clear previous dynamic state ---
    // Clear selection highlights
    boardElement.querySelectorAll('.square.selected').forEach(sq => sq.classList.remove('selected'));
    // Clear previous last move highlights from overlays
    const lastMoveClasses = ['last-move-start-p0', 'last-move-start-p1', 'last-move-end-p0', 'last-move-end-p1'];
    boardElement.querySelectorAll('.highlight-overlay').forEach(overlay => {
        overlay.classList.remove(...lastMoveClasses);
    });
     // Clear previous action highlights (if different from standard highlights)
     boardElement.querySelectorAll('.action-highlight-overlay').forEach(overlay => {
         // Assuming action highlights have specific classes to remove, e.g., 'possible-move', 'capture-move'
         overlay.classList.remove('possible-move', 'capture-move'); // Adjust classes as needed
     });
     // Remove all previously added decorations or texture overlays
     boardElement.querySelectorAll('.decoration, .trap-texture-container, .den-texture-container').forEach(el => el.remove());


    // --- Pre-calculate values used in the loop ---
    const lastMoveStartKey = lastMove ? `${lastMove.start.r}-${lastMove.start.c}` : null;
    const lastMoveEndKey = lastMove ? `${lastMove.end.r}-${lastMove.end.c}` : null;
    const lastMovePlayerSuffix = lastMove ? `p${lastMove.player}` : null;

    // Calculate the target background size for the SCALED tileset ONCE
    const totalScaledWidth = TILESET_COLS * TILE_DISPLAY_SIZE_PX;
    const totalScaledHeight = TILESET_ROWS * TILE_DISPLAY_SIZE_PX;
    const landBackgroundSize = `${totalScaledWidth}px ${totalScaledHeight}px`;


    // --- Loop through board squares ---
    for (let r = 0; r < BOARD_ROWS; r++) {
        for (let c = 0; c < BOARD_COLS; c++) {
            const squareElement = document.createElement('div');
            squareElement.className = 'square'; // Base class
            squareElement.dataset.row = r;
            squareElement.dataset.col = c;
            const currentSquareKey = `${r}-${c}`;

            const cellData = boardState[r]?.[c];
            if (!cellData) { console.warn(`Missing cell data for ${r},${c}`); continue; }

            const terrain = cellData.terrain;
            const pieceData = cellData.piece;

            // Add base terrain class (used for CSS background-color, borders)
            squareElement.classList.add(`terrain-${terrain}`);

            // Reset background styles & apply pixelated rendering for crisp scaling
            squareElement.style.backgroundImage = '';
            squareElement.style.backgroundPosition = '';
            squareElement.style.backgroundSize = '';
            squareElement.style.backgroundRepeat = '';
            squareElement.style.imageRendering = ''; // Keep pixelated rendering


            // --- STEP 1: Render Base Tile Background ---
            // This switch focuses *only* on setting the background of the square itself
            if (r >= 3 && r <= 5) {
                if (r === 3)squareElement.style.backgroundImage = `url('${UP_WATER_BACKGROUND}')`;
                if (r === 4)squareElement.style.backgroundImage = `url('${WATER_BACKGROUND}')`;
                if (r === 5)squareElement.style.backgroundImage = `url('${DOWN_WATER_BACKGROUND}')`;
                squareElement.style.backgroundSize = 'cover';
                squareElement.style.backgroundPosition = 'center';
                squareElement.style.backgroundRepeat = 'no-repeat';
            } else if (terrain === TERRAIN_LAND) {
                squareElement.style.backgroundImage = `url('${TILESET_IMAGE}')`;
                const configKey = getTileConfigurationKey(boardState, r, c);
                const bgPos = TILE_CONFIG_MAP[configKey]; // Offset based on TILESET_TILE_SIZE_PX
                if (bgPos) {
                    // landBackgroundSize is calculated outside the loop using TILESET_COLS, TILESET_ROWS, TILE_DISPLAY_SIZE_PX
                    // e.g., const totalScaledWidth = TILESET_COLS * TILE_DISPLAY_SIZE_PX; ...
                    // const landBackgroundSize = `${totalScaledWidth}px ${totalScaledHeight}px`;
                    squareElement.style.backgroundPosition = bgPos;
                    squareElement.style.backgroundSize = landBackgroundSize;
                    squareElement.style.backgroundRepeat = 'no-repeat';
                } else {
                     console.warn(`Missing background position for config key: ${configKey} at ${r},${c}. Check TILE_CONFIG_MAP.`);
                     squareElement.style.backgroundImage = ''; // Fallback: no background image
                }
                 // Decoration logic remains in STEP 2
            } else if (terrain === TERRAIN_TRAP) {
                 // NOTE: Based on the *provided switch case*, Traps also get the WATER_BACKGROUND here.
                 // If you intended them to have a solid color from CSS only, you would remove this else if block.
                squareElement.style.backgroundImage = `url('${TRAP_BACKGROUND}')`; // Applying Water background as per original switch
                squareElement.style.backgroundSize = 'cover';
                squareElement.style.backgroundPosition = 'center';
                squareElement.style.backgroundRepeat = 'no-repeat';
            } else if (terrain === TERRAIN_PLAYER0_DEN || terrain === TERRAIN_PLAYER1_DEN) {
                // NOTE: Based on the *provided switch case*, Traps also get the WATER_BACKGROUND here.
                // If you intended them to have a solid color from CSS only, you would remove this else if block.
                squareElement.style.backgroundImage = `url('${TILESET_IMAGE}')`; // Applying Water background as per original switch
                squareElement.style.backgroundPosition = TILE_CONFIG_MAP['Den'];
                squareElement.style.backgroundSize = landBackgroundSize; // Apply calculated scaled size
                squareElement.style.backgroundRepeat = 'no-repeat';
            }

            // --- STEP 1.5: Custom Tile Background Overrides (Optional) ---
            // Add specific coordinate checks HERE if you want to FORCE a different
            // background image or position for a specific square, overriding Step 1.
            /*
            if (r === 2 && c === 3) { // Example: Force a specific tile at (2,3)
                 squareElement.style.backgroundImage = `url('${TILESET_IMAGE}')`;
                 squareElement.style.backgroundPosition = `-${5 * TILESET_TILE_SIZE_PX}px -${2 * TILESET_TILE_SIZE_PX}px`; // Example: Tile at (5,2) in tileset
                 squareElement.style.backgroundSize = landBackgroundSize;
                 squareElement.style.backgroundRepeat = 'no-repeat';
            }
            */

            // --- STEP 2: Render Decorations and Texture Overlays (as child elements) ---
            // This switch/section focuses on adding child <img> or <div> overlays
            if (r >= 3 && r <= 5 && terrain === TERRAIN_LAND) {
                const decoImg = document.createElement('img');
                decoImg.src = BRIGDE_DECORATION;
                decoImg.alt = 'Decoration';
                // decoImg.className = 'decoration'; // CSS handles size/position
                decoImg.loading = 'lazy';
                decoImg.style.height = '100%';
                decoImg.style.width = '100%';
                squareElement.appendChild(decoImg);
            } else if (terrain === TERRAIN_LAND) {
                // Add random decorations on top of land tiles
                if(landTilePatterns[r][c] !== null){
                    const randomDecoration = DECORATION_IMAGES[landTilePatterns[r][c]];
                    const decoImg = document.createElement('img');
                    decoImg.src = randomDecoration;
                    decoImg.alt = 'Decoration';
                    decoImg.className = 'decoration'; // CSS handles size/position
                    decoImg.loading = 'lazy';
                    squareElement.appendChild(decoImg);
                }
            } else if (terrain === TERRAIN_WATER) {
            } else if (terrain === TERRAIN_TRAP) {
            } else if (terrain === TERRAIN_PLAYER0_DEN || terrain === TERRAIN_PLAYER1_DEN) {
                 // Add the specific den texture overlay image element
                 const den0TextureContainer = document.createElement('div');
                 den0TextureContainer.className = 'den-texture-container'; // CSS handles positioning
                 const den0Img = document.createElement('img');
                 den0Img.src = DEN_DECORATION; // Use constant path (requires DEN_PLAYER0_TEXTURE constant)
                 den0Img.style.width = '100%';
                 den0Img.style.height = '100%';
                 den0Img.alt = terrain === TERRAIN_PLAYER0_DEN ? 'Player 0 Den' : 'Player 1 Den';
                //  den0Img.className = 'terrain-texture-img'; // CSS handles size
                 den0TextureContainer.appendChild(den0Img);
                 squareElement.appendChild(den0TextureContainer);
            }

             // --- STEP 2.5: Custom Decoration Overrides (Optional) ---
             // Add specific coordinate checks HERE if you want to FORCE a specific
             // decoration image (or remove one added above).
             /*
             if (r === 1 && c === 1) { // Example: Always put a flower at (1,1)
                 // Remove random decoration if it exists
                 const existingDeco = squareElement.querySelector('.decoration');
                 if(existingDeco) existingDeco.remove();
                 // Add specific flower
                 const flowerImg = document.createElement('img');
                 flowerImg.src = `${BASE_ASSETS_PATH}decorations/specific_flower.png`;
                 flowerImg.alt = 'Flower';
                 flowerImg.className = 'decoration';
                 squareElement.appendChild(flowerImg);
             }
             */

            // --- STEP 3: Add Highlight Overlays ---
            // These appear above tiles and decorations, below pieces
            const highlightOverlay = document.createElement('div');
            highlightOverlay.className = 'highlight-overlay'; // Base class for general styling
            if (currentSquareKey === lastMoveStartKey) {
                highlightOverlay.classList.add(`last-move-start-${lastMovePlayerSuffix}`);
            } else if (currentSquareKey === lastMoveEndKey) {
                highlightOverlay.classList.add(`last-move-end-${lastMovePlayerSuffix}`);
            }
            squareElement.appendChild(highlightOverlay);

            // Add the separate overlay for action highlights (possible moves, captures)
            const actionHighlightOverlay = document.createElement('div');
            actionHighlightOverlay.className = 'action-highlight-overlay'; // Specific class for actions
            squareElement.appendChild(actionHighlightOverlay);


            // --- STEP 4: Render Piece ---
            // Pieces appear on the top layer
            if (pieceData && pieceData.type) {
                const pieceElement = document.createElement('div');
                pieceElement.className = `piece player${pieceData.player}`;
                const imgElement = document.createElement('img');
                // Consider using BASE_ASSETS_PATH here too for consistency
                imgElement.src = `${BASE_ASSETS_PATH}images/head_no_background/${pieceData.type}.png`;
                imgElement.alt = pieceData.name || pieceData.type;
                pieceElement.appendChild(imgElement);
                pieceElement.dataset.pieceType = pieceData.type;
                pieceElement.dataset.player = pieceData.player;
                squareElement.appendChild(pieceElement);
            }

            // --- STEP 5: Add Click Listener ---
            squareElement.addEventListener('click', () => clickHandler(r, c));

            // --- STEP 6: Append Square to Fragment ---
            fragment.appendChild(squareElement);
        } // End for c
    } // End for r

    // --- Final DOM Update ---
    boardElement.innerHTML = ''; // Clear the entire board content
    boardElement.appendChild(fragment); // Append all newly created squares at once
    renderCoordinatesIfNeeded(); // Render coordinate labels if not already done
} // End renderBoard