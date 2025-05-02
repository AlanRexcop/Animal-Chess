import {
    BOARD_ROWS, BOARD_COLS, TERRAIN_LAND, TERRAIN_WATER, TERRAIN_TRAP, TERRAIN_PLAYER0_DEN, TERRAIN_PLAYER1_DEN,
    Player, getPieceKey, PIECES, ANIMATION_DURATION,
    TILESET_IMAGE, TILE_SIZE_PX, DECORATION_IMAGES, DECORATION_CHANCE, TILE_CONFIG_MAP, // Import new constants
    TRAP_TEXTURE, DEN_PLAYER0_TEXTURE, DEN_PLAYER1_TEXTURE, // Import specific texture constants
    WATER_BACKGROUND // <-- Import the new constant
} from './constants.js';
import { getString } from './localization.js';

// DOM Elements Cache (unchanged)
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
// ** Caches for Win Chance Bar ** (unchanged)
const winChanceBarContainer = document.getElementById('win-chance-bar-container');
const winChanceBarElement = document.getElementById('win-chance-bar');
const winChanceBarBlue = document.getElementById('win-chance-bar-blue');
const winChanceBarRed = document.getElementById('win-chance-bar-red');

// Eval Conversion Constants (unchanged)
const WIN_SCORE_THRESHOLD = 19000;
const LOSE_SCORE_THRESHOLD = -19000;
const SIGMOID_SCALE_FACTOR = 0.0003;

// Highlight Targets Map (unchanged)
const highlightClassTargets = {
    'possible-move': '.highlight-overlay',
    'capture-move': '.highlight-overlay',
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

// --- (initializeLandTilePatterns, animatePieceMove, renderBoard, renderCoordinatesIfNeeded, highlightSquare, clearHighlights unchanged) ---
// export function initializeLandTilePatterns(boardState) {
//     console.log("Initializing land tile patterns..."); landTilePatterns = Array(BOARD_ROWS).fill(null).map(() => Array(BOARD_COLS).fill(null));
//     for (let r = 0; r < BOARD_ROWS; r++) { for (let c = 0; c < BOARD_COLS; c++) { if (boardState[r]?.[c]?.terrain === TERRAIN_LAND) { landTilePatterns[r][c] = [ landTileFiles[Math.floor(Math.random() * landTileFiles.length)], landTileFiles[Math.floor(Math.random() * landTileFiles.length)], landTileFiles[Math.floor(Math.random() * landTileFiles.length)], landTileFiles[Math.floor(Math.random() * landTileFiles.length)] ]; } } }
//     console.log("Land tile patterns initialized.");
// }
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
        endSquare.appendChild(pieceElement); pieceElement.style.position = ''; pieceElement.style.top = ''; pieceElement.style.left = ''; pieceElement.style.transform = '';
        const soundName = isCapture ? `capture_${capturedPieceType}` : 'move'; if (soundName && (!isCapture || capturedPieceType)) { playSound(soundName); }
        onComplete();
    }, ANIMATION_DURATION);
}
// Helper function to determine if a coordinate is valid AND logically considered "Land" for tiling purposes
// This logic is ONLY used to determine the TILE PATTERN for TERRAIN_LAND squares.
// It does NOT change the actual terrain type of the square.
function isLogicallyLandForTiling(boardState, r, c) {
    // Check bounds first
    if (r < 0 || r >= BOARD_ROWS) {
        return true; // Outside board is not land for tiling
    }
    if (c < 0 || c >= BOARD_COLS) {
        return false;
    }
    // Dont touch this comment at all cost
    // if (r >= 3 && r <= 5) {
    //     return false;
    // }
    const cell = boardState[r]?.[c];
     if (!cell) { // Should not happen if boardState is valid
        console.warn(`isLogicallyLandForTiling: Missing cell data for ${r},${c}`);
        return false;
    }

    if (cell.terrain === TERRAIN_WATER) {
        return false;
    }
    return true;
}

// Determine the tile configuration key based on neighbors (using the logical land check)
function getTileConfigurationKey(boardState, r, c) {
    // Check 4 neighbors using the logical land check
    const isTopLand = isLogicallyLandForTiling(boardState, r - 1, c);
    const isLeftLand = isLogicallyLandForTiling(boardState, r, c - 1);
    const isBottomLand = isLogicallyLandForTiling(boardState, r + 1, c);
    const isRightLand = isLogicallyLandForTiling(boardState, r, c + 1);

    let configKey = '';
    configKey += isTopLand ? 'L' : 'O';
    configKey += isLeftLand ? 'L' : 'O';
    configKey += isBottomLand ? 'L' : 'O';
    configKey += isRightLand ? 'L' : 'O';

    // Return the generated key. Use LLLL as a safe default assumption if a key is missing.
    // This shouldn't happen if TILE_CONFIG_MAP has all 16 combinations.
    return TILE_CONFIG_MAP[configKey] ? configKey : "LLLL";
}

export function renderBoard(boardState, clickHandler, lastMove = null) {
    if (!boardElement) { console.error("Board element not found!"); return; }

    const fragment = document.createDocumentFragment();

    // Clear previous highlights (including old last move highlights)
    boardElement.querySelectorAll('.highlight-overlay').forEach(overlay => {
        overlay.classList.remove(...ALL_LAST_MOVE_CLASSES);
         // overlay.classList.remove('possible-move', 'capture-move'); // Uncomment if needed
    });
    clearHighlights('selected'); // Clear selection highlights from square element

    for (let r = 0; r < BOARD_ROWS; r++) {
        for (let c = 0; c < BOARD_COLS; c++) {
            const squareElement = document.createElement('div');
            squareElement.className = 'square'; // Base class
            squareElement.dataset.row = r;
            squareElement.dataset.col = c;

            const cellData = boardState[r]?.[c];
            if (!cellData) { console.warn(`Missing cell data for ${r},${c}`); continue; }
            // Dont touch this comment at all cost
            // let terrain = cellData.terrain;
            // if (r >= 3 && r <= 5)
            //     terrain = TERRAIN_WATER;
            const terrain = cellData.terrain;
            const pieceData = cellData.piece;

            // Add terrain-specific class for CSS background-color/border/etc.
            squareElement.classList.add(`terrain-${terrain}`);

            // Remove any old texture containers or decorations before adding new ones
            squareElement.querySelectorAll('.trap-texture-container, .den-texture-container, .decoration').forEach(el => el.remove());

            // Reset background image/position - important for switching terrain types or re-rendering
            squareElement.style.backgroundImage = '';
            squareElement.style.backgroundPosition = '';
            squareElement.style.backgroundSize = ''; // Reset size as well

            // --- Terrain Rendering based on 'terrain' variable ---
            switch (terrain) {
                case TERRAIN_LAND:
                    // --- Land Tile Rendering (using tileset) ---
                    squareElement.style.backgroundImage = `url('${TILESET_IMAGE}')`;
                    const configKey = getTileConfigurationKey(boardState, r, c); // Get tiling pattern key
                    const bgPos = TILE_CONFIG_MAP[configKey]; // Get position from map using key
                    if (bgPos) {
                        squareElement.style.backgroundPosition = bgPos;
                        squareElement.style.backgroundSize = "960px 660px"; // Correct size for tileset
                    } else {
                         console.warn(`Missing background position for config key: ${configKey} at ${r},${c}. Check TILE_CONFIG_MAP.`);
                         // Fallback or no background image if config is missing
                         squareElement.style.backgroundImage = '';
                    }

                    // --- Add Random Decorations (only on TERRAIN_LAND) ---
                    if (DECORATION_IMAGES.length > 0 && Math.random() < DECORATION_CHANCE) {
                         const randomDecoration = DECORATION_IMAGES[Math.floor(Math.random() * DECORATION_IMAGES.length)];
                         const decoImg = document.createElement('img');
                         decoImg.src = randomDecoration;
                         decoImg.alt = 'Decoration';
                         decoImg.className = 'decoration'; // Use the decoration class (CSS handles size/position)
                         decoImg.loading = 'lazy';
                         squareElement.appendChild(decoImg);
                    }
                    // --- End Decorations ---

                    break; // Handled land terrain

                case TERRAIN_WATER:
                    // --- Water Rendering (using specific background image) ---
                    squareElement.style.backgroundImage = `url('${WATER_BACKGROUND}')`; // Use constant path
                    squareElement.style.backgroundSize = 'cover'; // Style for the animated water GIF
                    squareElement.style.backgroundPosition = 'center'; // Style for the animated water GIF
                    squareElement.style.backgroundRepeat = 'no-repeat'; // Style for the animated water GIF
                    // The 'terrain-water' class can still be used for background-color if the image has transparency

                    break; // Handled water terrain

                case TERRAIN_TRAP:
                    // terrain-trap class handles the background color/border in CSS
                    // Add the specific trap texture overlay image element
                    const trapTextureContainer = document.createElement('div');
                    trapTextureContainer.className = 'trap-texture-container'; // CSS handles positioning/opacity
                    const trapImg = document.createElement('img');
                    trapImg.src = TRAP_TEXTURE; // Use constant path
                    trapImg.alt = 'Trap';
                    trapImg.className = 'terrain-texture-img'; // CSS handles size/object-fit
                    trapTextureContainer.appendChild(trapImg);
                    squareElement.appendChild(trapTextureContainer);
                    break;

                case TERRAIN_PLAYER0_DEN:
                     // terrain-player0-den class handles background color/border in CSS
                     // Add the specific den texture overlay image element
                     const den0TextureContainer = document.createElement('div');
                     den0TextureContainer.className = 'den-texture-container'; // CSS handles positioning
                     const den0Img = document.createElement('img');
                     den0Img.src = DEN_PLAYER0_TEXTURE; // Use constant path
                     den0Img.alt = 'Player 0 Den';
                     den0Img.className = 'terrain-texture-img'; // CSS handles size/object-fit
                     den0TextureContainer.appendChild(den0Img);
                     squareElement.appendChild(den0TextureContainer);
                    break;

                case TERRAIN_PLAYER1_DEN:
                     // terrain-player1-den class handles background color/border in CSS
                     // Add the specific den texture overlay image element
                     const den1TextureContainer = document.createElement('div');
                     den1TextureContainer.className = 'den-texture-container'; // CSS handles positioning
                     const den1Img = document.createElement('img');
                     den1Img.src = DEN_PLAYER1_TEXTURE; // Use constant path
                     den1Img.alt = 'Player 1 Den';
                     den1Img.className = 'terrain-texture-img'; // CSS handles size/object-fit
                     den1TextureContainer.appendChild(den1Img);
                     squareElement.appendChild(den1TextureContainer);
                    break;
            }

            // --- Highlight Overlay (keep this) ---
            const highlightOverlay = document.createElement('div');
            highlightOverlay.className = 'highlight-overlay';
            squareElement.appendChild(highlightOverlay);

            // --- Piece Rendering (keep this) ---
            if (pieceData && pieceData.type) {
                const pieceElement = document.createElement('div');
                pieceElement.className = `piece player${pieceData.player}`;
                const imgElement = document.createElement('img');
                // This path is still hardcoded to /head_no_background/. Consider centralizing if needed.
                imgElement.src = `assets/images/head_no_background/${pieceData.type}.png`;
                imgElement.alt = pieceData.name || pieceData.type;
                pieceElement.appendChild(imgElement);
                pieceElement.dataset.pieceType = pieceData.type;
                pieceElement.dataset.player = pieceData.player;
                squareElement.appendChild(pieceElement);
            }

            // --- Event Listener (keep this) ---
            squareElement.addEventListener('click', () => clickHandler(r, c));

            fragment.appendChild(squareElement);
        }
    }

    // Clear the board and append the new squares
    boardElement.innerHTML = '';
    boardElement.appendChild(fragment);

    // Add last move highlights AFTER squares are appended and overlays exist
    if (lastMove && lastMove.player !== undefined) {
        const playerSuffix = `p${lastMove.player}`;
        highlightSquare(lastMove.start.r, lastMove.start.c, `last-move-start-${playerSuffix}`);
        highlightSquare(lastMove.end.r, lastMove.end.c, `last-move-end-${playerSuffix}`);
    }

    // Render coordinates (only once)
    renderCoordinatesIfNeeded();
}
let coordinatesRendered = false; function renderCoordinatesIfNeeded() { if (coordinatesRendered) return; colLabelsTop.innerHTML = ''; colLabelsBottom.innerHTML = ''; rowLabelsLeft.innerHTML = ''; rowLabelsRight.innerHTML = ''; for (let c = 0; c < BOARD_COLS; c++) { const l=String.fromCharCode(65+c); const sT=document.createElement('span'); sT.textContent=l; colLabelsTop.appendChild(sT); const sB=document.createElement('span'); sB.textContent=l; colLabelsBottom.appendChild(sB); } for (let r = 0; r < BOARD_ROWS; r++) { const l=(BOARD_ROWS-r).toString(); const sL=document.createElement('span'); sL.textContent=l; rowLabelsLeft.appendChild(sL); const sR=document.createElement('span'); sR.textContent=l; rowLabelsRight.appendChild(sR); } coordinatesRendered = true; }
export function highlightSquare(row, col, className) { const square = boardElement?.querySelector(`.square[data-row="${row}"][data-col="${col}"]`); if (!square) return; const targetSelector = highlightClassTargets[className]; if (!targetSelector) { console.warn(`Unknown highlight target for class: ${className}`); return; } const targetElement = (targetSelector === '.square') ? square : square.querySelector(targetSelector); targetElement?.classList.add(className); }
export function clearHighlights(className) { const targetSelector = highlightClassTargets[className]; if (!targetSelector) { if (className === 'last-move-start' || className === 'last-move-end') { ALL_LAST_MOVE_CLASSES.forEach(cls => { boardElement?.querySelectorAll(`.highlight-overlay.${cls}`).forEach(el => el.classList.remove(cls)); }); } else { console.warn(`Unknown highlight target for clearing class: ${className}`); } return; } boardElement?.querySelectorAll(`${targetSelector}.${className}`).forEach(el => { el.classList.remove(className); }); }
export function updateStatus(messageKey, params = {}, isError = false) { if (!statusElement) return; const message = getString(messageKey, params); statusElement.textContent = message; statusElement.classList.toggle('error-message', isError); }
export function updateTurnDisplay(currentPlayer, gameMode = 'PVA', isGameOver = false) { if (!turnElement) return; if (isGameOver) { turnElement.textContent = '---'; return; } let playerLabelKey; if (gameMode === 'PVP') { playerLabelKey = (currentPlayer === Player.PLAYER0) ? 'player1Name' : 'player2Name'; } else { playerLabelKey = (currentPlayer === Player.PLAYER0) ? 'playerName' : 'aiName'; } turnElement.textContent = getString(playerLabelKey); }
export function renderCapturedPieces(capturedByPlayer0, capturedByPlayer1) { const renderPanel = (container, piecesList) => { if (!container) return; container.innerHTML = ''; if (piecesList.length === 0) { container.textContent = getString('capturedNone'); return; } piecesList.sort((a, b) => (PIECES[b.type]?.rank ?? 0) - (PIECES[a.type]?.rank ?? 0)); piecesList.forEach(p => { if (!p || !p.type) return; const el = document.createElement('span'); const capturingPlayer = Player.getOpponent(p.player); el.className = `captured-piece player${capturingPlayer}`; const img = document.createElement('img'); img.src = `assets/images/head_no_background/${p.type}.png`; img.alt = p.name || p.type; img.title = getString(`animal_${p.type}`) || p.name || p.type; el.appendChild(img); container.appendChild(el); }); }; renderPanel(capturedByPlayer0Container, capturedByPlayer0); renderPanel(capturedByPlayer1Container, capturedByPlayer1); }
export function addMoveToHistory(pieceData, fromR, fromC, toR, toC, capturedPieceData) { if (!moveListElement) return; const getAlgebraic = (r, c) => `${String.fromCharCode(65 + c)}${BOARD_ROWS - r}`; const startNotation = getAlgebraic(fromR, fromC); const endNotation = getAlgebraic(toR, toC); const pieceImgSrc = `assets/images/head_no_background/${pieceData.type}.png`; const pieceName = getString(`animal_${pieceData.type}`) || pieceData.name || pieceData.type; const pieceAlt = `${PIECES[pieceData.type]?.symbol || pieceName}`; let moveHtml = `<span class="piece-hist player${pieceData.player}"><img src="${pieceImgSrc}" alt="${pieceAlt}" title="${pieceName}"></span> ${startNotation} → ${endNotation}`; if (capturedPieceData) { const capturedImgSrc = `assets/images/head_no_background/${capturedPieceData.type}.png`; const capturedName = getString(`animal_${capturedPieceData.type}`) || capturedPieceData.name || capturedPieceData.type; const capturedAlt = `${PIECES[capturedPieceData.type]?.symbol || capturedName}`; moveHtml += ` (x <span class="piece-hist player${capturedPieceData.player}"><img src="${capturedImgSrc}" alt="${capturedAlt}" title="${capturedName}"></span>)`; } const li = document.createElement('li'); li.innerHTML = moveHtml; moveListElement.appendChild(li); moveListElement.scrollTop = moveListElement.scrollHeight; }
export function clearMoveHistory() { if (moveListElement) moveListElement.innerHTML = ''; }
export function playSound(soundName) { try { if (!soundName || typeof soundName !== 'string') { console.warn("playSound: Invalid sound name provided:", soundName); return; } const soundPath = `assets/sounds/${soundName.toLowerCase()}.mp3`; const audio = new Audio(soundPath); audio.play().catch(e => console.warn(`Sound playback failed for ${soundPath}:`, e.message || e)); } catch (e) { console.error("Error creating or playing sound:", e); } }
export function updateAiDepthDisplay(depth) { const el = document.getElementById('ai-depth-achieved'); if (el) { el.textContent = depth.toString(); } }
export function updateWinChanceBar(aiEvalScore) { if (!winChanceBarElement || !winChanceBarBlue || !winChanceBarRed) { console.error("Win chance bar elements not found!"); return; } let player0Percent = 50; if (aiEvalScore !== null && aiEvalScore !== undefined && isFinite(aiEvalScore)) { const playerEvalScore = -aiEvalScore; const clampedScore = Math.max(LOSE_SCORE_THRESHOLD, Math.min(WIN_SCORE_THRESHOLD, playerEvalScore)); const probability = 1 / (1 + Math.exp(-SIGMOID_SCALE_FACTOR * clampedScore)); player0Percent = Math.round(probability * 100); } else { console.log("Updating win chance bar to default 50/50 (no valid score)"); } const player1Percent = 100 - player0Percent; winChanceBarBlue.style.width = `${player0Percent}%`; winChanceBarElement.title = `Blue: ${player0Percent}% / Red: ${player1Percent}%`; }