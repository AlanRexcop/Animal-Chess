import {
    BOARD_ROWS, BOARD_COLS, TERRAIN_LAND, TERRAIN_WATER, TERRAIN_TRAP, TERRAIN_PLAYER0_DEN, TERRAIN_PLAYER1_DEN,
    Player, getPieceKey, PIECES, ANIMATION_DURATION,
    TILESET_IMAGE, TILESET_TILE_SIZE_PX,
    TILE_DISPLAY_SIZE_PX,
    TILESET_COLS, TILESET_ROWS, // Ensure these are correctly set in constants.js!
    DECORATION_IMAGES, DECORATION_CHANCE, TILE_CONFIG_MAP,
    TRAP_TEXTURE, DEN_PLAYER0_TEXTURE, DEN_PLAYER1_TEXTURE,
    WATER_BACKGROUND,
    BASE_ASSETS_PATH // Assuming you added this for piece paths too
} from './constants.js';
import { getString } from './localization.js';

// DOM Elements Cache
const boardElement = document.getElementById('board');
const boardContainerElement = document.getElementById('board-container');
const statusElement = document.getElementById('status');
const turnElement = document.getElementById('turn');
const capturedByPlayer0Container = document.querySelector('#captured-by-player0 .pieces-container');
const capturedByPlayer1Container = document.querySelector('#captured-by-player1 .pieces-container');
const moveListElement = document.getElementById('move-list');
const colLabelsTop = document.getElementById('col-labels-top');
const colLabelsBottom = document.getElementById('col-labels-bottom');
const rowLabelsLeft = document.getElementById('row-labels-left');
const rowLabelsRight = document.getElementById('row-labels-right');
const winChanceBarElement = document.getElementById('win-chance-bar');
const winChanceBarBlue = document.getElementById('win-chance-bar-blue');
const winChanceBarRed = document.getElementById('win-chance-bar-red');

// Eval Conversion Constants
const WIN_SCORE_THRESHOLD = 19000;
const LOSE_SCORE_THRESHOLD = -19000;
const SIGMOID_SCALE_FACTOR = 0.0003;

// Highlight Targets Map
const highlightClassTargets = {
    'possible-move': '.action-highlight-overlay',
    'capture-move': '.action-highlight-overlay',
    'selected': '.square',
    'last-move-start-p0': '.highlight-overlay',
    'last-move-start-p1': '.highlight-overlay',
    'last-move-end-p0': '.highlight-overlay',
    'last-move-end-p1': '.highlight-overlay'
};

const ALL_LAST_MOVE_CLASSES = [
    'last-move-start-p0', 'last-move-start-p1',
    'last-move-end-p0', 'last-move-end-p1'
];

export function animatePieceMove(pieceElement, startSquare, endSquare, isCapture, capturedPieceType, onComplete) {
    if (!pieceElement || !startSquare || !endSquare || !boardContainerElement) { console.warn("Animation elements not found, completing move directly."); onComplete(); return; }
    const containerRect = boardContainerElement.getBoundingClientRect(); const startRect = pieceElement.getBoundingClientRect(); const endRect = endSquare.getBoundingClientRect();
    const initialTop = startRect.top - containerRect.top; const initialLeft = startRect.left - containerRect.left; const targetLeft = endRect.left - containerRect.left + (endRect.width / 2) - (startRect.width / 2); const targetTop = endRect.top - containerRect.top + (endRect.height / 2) - (startRect.height / 2);
    const capturedElement = endSquare.querySelector('.piece'); if (isCapture && capturedElement) { capturedElement.remove(); }
    boardContainerElement.appendChild(pieceElement); pieceElement.classList.add('piece-global-animating');
    pieceElement.style.left = `${initialLeft}px`; pieceElement.style.top = `${initialTop}px`; pieceElement.style.transform = 'none'; pieceElement.style.transition = 'none';
    requestAnimationFrame(() => { requestAnimationFrame(() => { pieceElement.style.transition = `left ${ANIMATION_DURATION / 1000}s ease-out, top ${ANIMATION_DURATION / 1000}s ease-out`; pieceElement.style.left = `${targetLeft}px`; pieceElement.style.top = `${targetTop}px`; }); });
    setTimeout(() => {
        pieceElement.style.transition = 'none'; pieceElement.classList.remove('piece-global-animating');
        const squareContent = endSquare.querySelector(':not(.highlight-overlay):not(.action-highlight-overlay)') || endSquare;
        squareContent.appendChild(pieceElement);
        pieceElement.style.position = ''; pieceElement.style.top = ''; pieceElement.style.left = ''; pieceElement.style.transform = '';
        const soundName = isCapture ? `capture_${capturedPieceType}` : 'move'; if (soundName && (!isCapture || capturedPieceType)) { playSound(soundName); }
        onComplete();
    }, ANIMATION_DURATION);
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
            squareElement.style.imageRendering = 'pixelated'; // Keep pixelated rendering


            // --- STEP 1: Render Base Tile Background ---
            // This switch focuses *only* on setting the background of the square itself
            switch (terrain) {
                case TERRAIN_LAND:
                    squareElement.style.backgroundImage = `url('${TILESET_IMAGE}')`;
                    const configKey = getTileConfigurationKey(boardState, r, c);
                    const bgPos = TILE_CONFIG_MAP[configKey];
                    if (bgPos) {
                        squareElement.style.backgroundPosition = bgPos;       // Offset based on 32px tiles
                        squareElement.style.backgroundSize = landBackgroundSize; // Apply calculated scaled size
                        squareElement.style.backgroundRepeat = 'no-repeat';
                    } else {
                         console.warn(`Missing background position for config key: ${configKey} at ${r},${c}. Check TILE_CONFIG_MAP.`);
                         squareElement.style.backgroundImage = ''; // Fallback: no background image
                    }
                    // --- Decoration logic moved to STEP 2 ---
                    break;
                case TERRAIN_WATER:
                    squareElement.style.backgroundImage = `url('${WATER_BACKGROUND}')`;
                    squareElement.style.backgroundSize = 'cover';
                    squareElement.style.backgroundPosition = 'center';
                    squareElement.style.backgroundRepeat = 'no-repeat';
                    break;
                case TERRAIN_TRAP:
                case TERRAIN_PLAYER0_DEN:
                case TERRAIN_PLAYER1_DEN:
                    // Base background color/borders are handled by the CSS class (`.terrain-trap`, etc.)
                    // Texture overlay images are handled in STEP 2.
                    break;
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
            switch (terrain) {
                case TERRAIN_LAND:
                    // Add random decorations on top of land tiles
                    if (DECORATION_IMAGES.length > 0 && Math.random() < DECORATION_CHANCE) {
                         const randomDecoration = DECORATION_IMAGES[Math.floor(Math.random() * DECORATION_IMAGES.length)];
                         const decoImg = document.createElement('img');
                         decoImg.src = randomDecoration;
                         decoImg.alt = 'Decoration';
                         decoImg.className = 'decoration'; // CSS handles size/position
                         decoImg.loading = 'lazy';
                         squareElement.appendChild(decoImg);
                    }
                    break;
                case TERRAIN_WATER:
                     // Add bridge decorations or other water features here if needed
                     /*
                     if ((r === 3 || r === 5) && (c === 1 || c === 2 || c === 4 || c === 5)) { // Example: bridge ends
                        const bridgeImg = document.createElement('img');
                        bridgeImg.src = `${BASE_ASSETS_PATH}decorations/bridge_end.png`;
                        bridgeImg.alt = 'Bridge';
                        bridgeImg.className = 'decoration bridge-decoration'; // Use specific class if needed
                        squareElement.appendChild(bridgeImg);
                     } else if (r === 4 && (c === 1 || c === 2 || c === 4 || c === 5)) { // Example: bridge middle
                        // ... add middle bridge piece ...
                     }
                     */
                    break;
                case TERRAIN_TRAP:
                    const trapTextureContainer = document.createElement('div');
                    trapTextureContainer.className = 'trap-texture-container'; // CSS handles positioning
                    const trapImg = document.createElement('img');
                    trapImg.src = TRAP_TEXTURE;
                    trapImg.alt = 'Trap';
                    trapImg.className = 'terrain-texture-img'; // CSS handles size
                    trapTextureContainer.appendChild(trapImg);
                    squareElement.appendChild(trapTextureContainer);
                    break;
                case TERRAIN_PLAYER0_DEN:
                     const den0TextureContainer = document.createElement('div');
                     den0TextureContainer.className = 'den-texture-container'; // CSS handles positioning
                     const den0Img = document.createElement('img');
                     den0Img.src = DEN_PLAYER0_TEXTURE;
                     den0Img.alt = 'Player 0 Den';
                     den0Img.className = 'terrain-texture-img'; // CSS handles size
                     den0TextureContainer.appendChild(den0Img);
                     squareElement.appendChild(den0TextureContainer);
                    break;
                case TERRAIN_PLAYER1_DEN:
                     const den1TextureContainer = document.createElement('div');
                     den1TextureContainer.className = 'den-texture-container'; // CSS handles positioning
                     const den1Img = document.createElement('img');
                     den1Img.src = DEN_PLAYER1_TEXTURE;
                     den1Img.alt = 'Player 1 Den';
                     den1Img.className = 'terrain-texture-img'; // CSS handles size
                     den1TextureContainer.appendChild(den1Img);
                     squareElement.appendChild(den1TextureContainer);
                    break;
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

let coordinatesRendered = false; function renderCoordinatesIfNeeded() { if (coordinatesRendered) return; colLabelsTop.innerHTML = ''; colLabelsBottom.innerHTML = ''; rowLabelsLeft.innerHTML = ''; rowLabelsRight.innerHTML = ''; for (let c = 0; c < BOARD_COLS; c++) { const l=String.fromCharCode(65+c); const sT=document.createElement('span'); sT.textContent=l; colLabelsTop.appendChild(sT); const sB=document.createElement('span'); sB.textContent=l; colLabelsBottom.appendChild(sB); } for (let r = 0; r < BOARD_ROWS; r++) { const l=(BOARD_ROWS-r).toString(); const sL=document.createElement('span'); sL.textContent=l; rowLabelsLeft.appendChild(sL); const sR=document.createElement('span'); sR.textContent=l; rowLabelsRight.appendChild(sR); } coordinatesRendered = true; }

export function highlightSquare(row, col, className) {
    const square = boardElement?.querySelector(`.square[data-row="${row}"][data-col="${col}"]`);
    if (!square) return;

    const targetSelector = highlightClassTargets[className];
    if (!targetSelector) {
        console.warn(`Unknown highlight target for class: ${className}`);
        return;
    }

    const targetElement = square.querySelector(targetSelector) || (targetSelector === '.square' ? square : null);

    if (targetElement) {
        if (className === 'capture-move' && targetSelector === '.action-highlight-overlay') {
            targetElement.classList.remove('possible-move');
        }
        targetElement.classList.add(className);
    } else {
        console.warn(`Target element not found for selector '${targetSelector}' in square ${row},${col}`);
    }
}

export function clearHighlights(className) {
    const targetSelector = highlightClassTargets[className];

    if (!targetSelector) {
        if (className === 'last-move') {
            ALL_LAST_MOVE_CLASSES.forEach(cls => {
                const selector = highlightClassTargets[cls];
                if (selector) {
                    boardElement?.querySelectorAll(`${selector}.${cls}`).forEach(el => el.classList.remove(cls));
                }
            });
        } else {
            console.warn(`Unknown highlight target for clearing class: ${className}`);
        }
        return;
    }

    boardElement?.querySelectorAll(`${targetSelector}.${className}`).forEach(el => {
        el.classList.remove(className);
    });
}

export function updateStatus(messageKey, params = {}, isError = false) { if (!statusElement) return; const message = getString(messageKey, params); statusElement.textContent = message; statusElement.classList.toggle('error-message', isError); }
export function updateTurnDisplay(currentPlayer, gameMode = 'PVA', isGameOver = false) { if (!turnElement) return; if (isGameOver) { turnElement.textContent = '---'; return; } let playerLabelKey; if (gameMode === 'PVP') { playerLabelKey = (currentPlayer === Player.PLAYER0) ? 'player1Name' : 'player2Name'; } else { playerLabelKey = (currentPlayer === Player.PLAYER0) ? 'playerName' : 'aiName'; } turnElement.textContent = getString(playerLabelKey); }
export function renderCapturedPieces(capturedByPlayer0, capturedByPlayer1) { const renderPanel = (container, piecesList) => { if (!container) return; container.innerHTML = ''; if (piecesList.length === 0) { container.textContent = getString('capturedNone'); return; } piecesList.sort((a, b) => (PIECES[b.type]?.rank ?? 0) - (PIECES[a.type]?.rank ?? 0)); piecesList.forEach(p => { if (!p || !p.type) return; const el = document.createElement('span'); const capturingPlayer = Player.getOpponent(p.player); el.className = `captured-piece player${capturingPlayer}`; const img = document.createElement('img'); img.src = `assets/images/head_no_background/${p.type}.png`; img.alt = p.name || p.type; img.title = getString(`animal_${p.type}`) || p.name || p.type; el.appendChild(img); container.appendChild(el); }); }; renderPanel(capturedByPlayer0Container, capturedByPlayer0); renderPanel(capturedByPlayer1Container, capturedByPlayer1); }
export function addMoveToHistory(pieceData, fromR, fromC, toR, toC, capturedPieceData) { if (!moveListElement) return; const getAlgebraic = (r, c) => `${String.fromCharCode(65 + c)}${BOARD_ROWS - r}`; const startNotation = getAlgebraic(fromR, fromC); const endNotation = getAlgebraic(toR, toC); const pieceImgSrc = `assets/images/head_no_background/${pieceData.type}.png`; const pieceName = getString(`animal_${pieceData.type}`) || pieceData.name || pieceData.type; const pieceAlt = `${PIECES[pieceData.type]?.symbol || pieceName}`; let moveHtml = `<span class="piece-hist player${pieceData.player}"><img src="${pieceImgSrc}" alt="${pieceAlt}" title="${pieceName}"></span> ${startNotation} → ${endNotation}`; if (capturedPieceData) { const capturedImgSrc = `assets/images/head_no_background/${capturedPieceData.type}.png`; const capturedName = getString(`animal_${capturedPieceData.type}`) || capturedPieceData.name || capturedPieceData.type; const capturedAlt = `${PIECES[capturedPieceData.type]?.symbol || capturedName}`; moveHtml += ` (x <span class="piece-hist player${capturedPieceData.player}"><img src="${capturedImgSrc}" alt="${capturedAlt}" title="${capturedName}"></span>)`; } const li = document.createElement('li'); li.innerHTML = moveHtml; moveListElement.appendChild(li); moveListElement.scrollTop = moveListElement.scrollHeight; }
export function clearMoveHistory() { if (moveListElement) moveListElement.innerHTML = ''; }
export function playSound(soundName) { try { if (!soundName || typeof soundName !== 'string') { console.warn("playSound: Invalid sound name provided:", soundName); return; } const soundPath = `assets/sounds/${soundName.toLowerCase()}.mp3`; const audio = new Audio(soundPath); audio.play().catch(e => console.warn(`Sound playback failed for ${soundPath}:`, e.message || e)); } catch (e) { console.error("Error creating or playing sound:", e); } }
export function updateAiDepthDisplay(depth) { const el = document.getElementById('ai-depth-achieved'); if (el) { el.textContent = depth.toString(); } }
export function updateWinChanceBar(aiEvalScore) { if (!winChanceBarElement || !winChanceBarBlue || !winChanceBarRed) { console.error("Win chance bar elements not found!"); return; } let player0Percent = 50; if (aiEvalScore !== null && aiEvalScore !== undefined && isFinite(aiEvalScore)) { const playerEvalScore = -aiEvalScore; const clampedScore = Math.max(LOSE_SCORE_THRESHOLD, Math.min(WIN_SCORE_THRESHOLD, playerEvalScore)); const probability = 1 / (1 + Math.exp(-SIGMOID_SCALE_FACTOR * clampedScore)); player0Percent = Math.round(probability * 100); } else { console.log("Updating win chance bar to default 50/50 (no valid score)"); } const player1Percent = 100 - player0Percent; winChanceBarBlue.style.width = `${player0Percent}%`; winChanceBarElement.title = `Blue: ${player0Percent}% / Red: ${player1Percent}%`; }