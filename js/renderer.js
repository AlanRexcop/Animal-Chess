// js/renderer.js
import { BOARD_ROWS, BOARD_COLS, TERRAIN_LAND, TERRAIN_WATER, TERRAIN_TRAP, TERRAIN_PLAYER0_DEN, TERRAIN_PLAYER1_DEN, Player, getPieceKey, PIECES, ANIMATION_DURATION } from './constants.js';
import { getString } from './localization.js';

// DOM Elements Cache
const boardElement = document.getElementById('board');
const boardContainerElement = document.getElementById('board-container'); // ** Need board container **
const statusElement = document.getElementById('status');
const turnElement = document.getElementById('turn');
const capturedByPlayer0Container = document.querySelector('#captured-by-player0 .pieces-container');
const capturedByPlayer1Container = document.querySelector('#captured-by-player1 .pieces-container');
const moveListElement = document.getElementById('move-list');
const colLabelsTop = document.getElementById('col-labels-top');
const colLabelsBottom = document.getElementById('col-labels-bottom');
const rowLabelsLeft = document.getElementById('row-labels-left');
const rowLabelsRight = document.getElementById('row-labels-right');
const winChanceDisplayElement = document.getElementById('win-chance-display');

// Eval Conversion Constants
const WIN_SCORE_THRESHOLD = 19000;
const LOSE_SCORE_THRESHOLD = -19000;
const SIGMOID_SCALE_FACTOR = 0.0003;

// Land Tile Patterns
let landTilePatterns = null;
const landTileFiles = ['1.png', '2.png', '3.png', '4.png'];

// Highlight Targets Map
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

export function initializeLandTilePatterns(boardState) {
    console.log("Initializing land tile patterns...");
    landTilePatterns = Array(BOARD_ROWS).fill(null).map(() => Array(BOARD_COLS).fill(null));
    for (let r = 0; r < BOARD_ROWS; r++) {
        for (let c = 0; c < BOARD_COLS; c++) {
            if (boardState[r]?.[c]?.terrain === TERRAIN_LAND) {
                landTilePatterns[r][c] = [
                    landTileFiles[Math.floor(Math.random() * landTileFiles.length)],
                    landTileFiles[Math.floor(Math.random() * landTileFiles.length)],
                    landTileFiles[Math.floor(Math.random() * landTileFiles.length)],
                    landTileFiles[Math.floor(Math.random() * landTileFiles.length)]
                ];
            }
        }
    }
    console.log("Land tile patterns initialized.");
}

/**
 * Animates a piece moving visually from start to end square using absolute positioning
 * relative to the board container.
 * @param {HTMLElement} pieceElement The DOM element of the piece being moved.
 * @param {HTMLElement} startSquare The starting square DOM element.
 * @param {HTMLElement} endSquare The ending square DOM element.
 * @param {boolean} isCapture Indicates if the move is a capture.
 * @param {string | null} capturedPieceType The type ('rat', 'cat'...) of the captured piece, if any.
 * @param {Function} onComplete Callback function to execute after animation completes.
 */
export function animatePieceMove(pieceElement, startSquare, endSquare, isCapture, capturedPieceType, onComplete) {
    if (!pieceElement || !startSquare || !endSquare || !boardContainerElement) {
        console.warn("Animation elements (piece, squares, or board container) not found, completing move directly.");
        onComplete();
        return;
    }

    // 1. Remove captured piece element from endSquare immediately
    const capturedElement = endSquare.querySelector('.piece');
    if (isCapture && capturedElement) {
        capturedElement.remove();
    }

    // 2. Calculate positions relative to the board container
    const containerRect = boardContainerElement.getBoundingClientRect();
    const startRect = pieceElement.getBoundingClientRect(); // Get initial position
    const endRect = endSquare.getBoundingClientRect();

    // Initial top/left relative to container
    const initialTop = startRect.top - containerRect.top;
    const initialLeft = startRect.left - containerRect.left;

    // Target top/left (center of end square) relative to container
    const targetLeft = endRect.left - containerRect.left + (endRect.width / 2) - (startRect.width / 2);
    const targetTop = endRect.top - containerRect.top + (endRect.height / 2) - (startRect.height / 2);


    // 3. Prepare piece for global animation
    // Move piece physically to board container
    boardContainerElement.appendChild(pieceElement);
    pieceElement.classList.add('piece-global-animating'); // Add class for absolute positioning and high z-index
    // Set initial absolute position
    pieceElement.style.left = `${initialLeft}px`;
    pieceElement.style.top = `${initialTop}px`;
    pieceElement.style.transform = 'none'; // Ensure no leftover transform interferes
    pieceElement.style.transition = 'none';

    // 4. Start the animation (animate top/left)
    requestAnimationFrame(() => { // Allow browser to apply initial state
        requestAnimationFrame(() => { // Start transition on next frame
            // Apply CSS transition for top and left properties
            pieceElement.style.transition = `left ${ANIMATION_DURATION / 1000}s ease-out, top ${ANIMATION_DURATION / 1000}s ease-out`;
            // Set target position
            pieceElement.style.left = `${targetLeft}px`;
            pieceElement.style.top = `${targetTop}px`;
        });
    });

    // 5. After animation finishes
    setTimeout(() => {
        // --- Clean up visual styles ---
        pieceElement.style.transition = 'none';         // Remove transition property
        pieceElement.classList.remove('piece-global-animating'); // Remove absolute positioning class

        // --- Physically move DOM element back into the grid ---
        endSquare.appendChild(pieceElement);            // Append to the destination square

        // --- Reset styles for positioning within the square ---
        pieceElement.style.position = ''; // Reset to default (absolute via .piece class)
        pieceElement.style.top = '';      // Reset top/left
        pieceElement.style.left = '';
        pieceElement.style.transform = ''; // Reset transform (translate(-50%, -50%) comes from .piece class)

        // Play sound
        const soundName = isCapture ? `capture_${capturedPieceType}` : 'move';
        if (soundName && (!isCapture || capturedPieceType)) {
            playSound(soundName);
        }

        // Execute completion callback
        onComplete();

    }, ANIMATION_DURATION);
}



/**
 * Renders the entire game board.
 */
export function renderBoard(boardState, clickHandler, lastMove = null) {
    if (!boardElement) { console.error("Board element not found!"); return; }
    if (!landTilePatterns) { console.error("Land tile patterns not initialized!"); }

    const fragment = document.createDocumentFragment();

    // Clear ALL Last Move Highlights & Selection
    boardElement.querySelectorAll('.highlight-overlay').forEach(overlay => {
        overlay.classList.remove(...ALL_LAST_MOVE_CLASSES);
    });
     clearHighlights('selected');

    for (let r = 0; r < BOARD_ROWS; r++) {
        for (let c = 0; c < BOARD_COLS; c++) {
            const squareElement = document.createElement('div');
            squareElement.className = 'square';
            squareElement.dataset.row = r;
            squareElement.dataset.col = c;

            const cellData = boardState[r]?.[c];
            if (!cellData) { console.warn(`Missing cell data for ${r},${c}`); continue; }
            const terrain = cellData.terrain;
            const pieceData = cellData.piece;

            // Terrain Rendering
            squareElement.classList.add(`terrain-${terrain}`);
            switch (terrain) {
                 case TERRAIN_LAND:
                    const landContainer = document.createElement('div');
                    landContainer.className = 'land-tile-container';
                    const pattern = landTilePatterns?.[r]?.[c];
                    if (pattern) {
                        pattern.forEach(tileFile => {
                            const img = document.createElement('img');
                            img.src = `assets/images/land/${tileFile}`;
                            img.alt = ''; img.className = 'land-tile-img'; img.loading = 'lazy';
                            landContainer.appendChild(img);
                        });
                    } else {
                        squareElement.classList.add('land-fallback-bg');
                        console.warn(`Missing land tile pattern for ${r},${c}`);
                    }
                    squareElement.appendChild(landContainer);
                    break;
                case TERRAIN_WATER: squareElement.classList.add('water-bg'); break;
                case TERRAIN_TRAP: squareElement.classList.add('trap-bg'); break;
                case TERRAIN_PLAYER0_DEN: squareElement.classList.add('player0-den-bg'); break;
                case TERRAIN_PLAYER1_DEN: squareElement.classList.add('player1-den-bg'); break;
            }

            // Add Highlight Overlay Element
            const highlightOverlay = document.createElement('div');
            highlightOverlay.className = 'highlight-overlay';
            squareElement.appendChild(highlightOverlay);

            // Piece Rendering
            if (pieceData && pieceData.type) {
                const pieceElement = document.createElement('div');
                // Set default styles for piece *within* a square
                pieceElement.className = `piece player${pieceData.player}`;
                const imgElement = document.createElement('img');
                imgElement.src = `assets/images/head_no_background/${pieceData.type}.png`;
                imgElement.alt = pieceData.name || pieceData.type;
                pieceElement.appendChild(imgElement);
                pieceElement.dataset.pieceType = pieceData.type;
                pieceElement.dataset.player = pieceData.player;
                squareElement.appendChild(pieceElement);
            }

            // Attach Click Handler
            squareElement.addEventListener('click', () => clickHandler(r, c));

            fragment.appendChild(squareElement);
        }
    }

    // Append the entire fragment at once
    boardElement.innerHTML = '';
    boardElement.appendChild(fragment);

    // Apply Last Move Highlights AFTER squares are in DOM
    if (lastMove && lastMove.player !== undefined) {
        const playerSuffix = `p${lastMove.player}`;
        highlightSquare(lastMove.start.r, lastMove.start.c, `last-move-start-${playerSuffix}`);
        highlightSquare(lastMove.end.r, lastMove.end.c, `last-move-end-${playerSuffix}`);
    }

    renderCoordinatesIfNeeded();
}

// --- (coordinatesRendered, renderCoordinatesIfNeeded unchanged) ---
let coordinatesRendered = false;
function renderCoordinatesIfNeeded() {
    if (coordinatesRendered) return;
     colLabelsTop.innerHTML = ''; colLabelsBottom.innerHTML = ''; rowLabelsLeft.innerHTML = ''; rowLabelsRight.innerHTML = '';
     for (let c = 0; c < BOARD_COLS; c++) { const l=String.fromCharCode(65+c); const sT=document.createElement('span'); sT.textContent=l; colLabelsTop.appendChild(sT); const sB=document.createElement('span'); sB.textContent=l; colLabelsBottom.appendChild(sB); }
     for (let r = 0; r < BOARD_ROWS; r++) { const l=(BOARD_ROWS-r).toString(); const sL=document.createElement('span'); sL.textContent=l; rowLabelsLeft.appendChild(sL); const sR=document.createElement('span'); sR.textContent=l; rowLabelsRight.appendChild(sR); }
     coordinatesRendered = true;
}


/**
 * Adds a specific CSS highlight class to the correct element.
 */
export function highlightSquare(row, col, className) {
    const square = boardElement?.querySelector(`.square[data-row="${row}"][data-col="${col}"]`);
    if (!square) return;
    const targetSelector = highlightClassTargets[className];
    if (!targetSelector) { console.warn(`Unknown highlight target for class: ${className}`); return; }
    const targetElement = (targetSelector === '.square') ? square : square.querySelector(targetSelector);
    targetElement?.classList.add(className);
}

/**
 * Removes a specific CSS highlight class from the correct elements.
 */
export function clearHighlights(className) {
    const targetSelector = highlightClassTargets[className];
    if (!targetSelector) {
        if (className === 'last-move-start' || className === 'last-move-end') {
            ALL_LAST_MOVE_CLASSES.forEach(cls => {
                boardElement?.querySelectorAll(`.highlight-overlay.${cls}`).forEach(el => el.classList.remove(cls));
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

// --- (updateStatus, updateTurnDisplay, renderCapturedPieces, addMoveToHistory, clearMoveHistory, playSound, updateAiDepthDisplay, updateWinChanceDisplay - unchanged) ---
export function updateStatus(messageKey, params = {}, isError = false) {
    if (!statusElement) return;
    const message = getString(messageKey, params);
    statusElement.textContent = message;
    statusElement.classList.toggle('error-message', isError);
}

export function updateTurnDisplay(currentPlayer, gameMode = 'PVA', isGameOver = false) {
     if (!turnElement) return;
     if (isGameOver) {
         turnElement.textContent = '---';
         return;
     }
     let playerLabelKey;
     if (gameMode === 'PVP') {
         playerLabelKey = (currentPlayer === Player.PLAYER0) ? 'player1Name' : 'player2Name';
     } else { // PVA
         playerLabelKey = (currentPlayer === Player.PLAYER0) ? 'playerName' : 'aiName';
     }
     turnElement.textContent = getString(playerLabelKey);
}

export function renderCapturedPieces(capturedByPlayer0, capturedByPlayer1) {
    const renderPanel = (container, piecesList) => {
        if (!container) return;
        container.innerHTML = '';
        if (piecesList.length === 0) {
            container.textContent = getString('capturedNone');
            return;
        }
        piecesList.sort((a, b) => (PIECES[b.type]?.rank ?? 0) - (PIECES[a.type]?.rank ?? 0));
        piecesList.forEach(p => {
            if (!p || !p.type) return;
            const el = document.createElement('span');
            const capturingPlayer = Player.getOpponent(p.player);
            el.className = `captured-piece player${capturingPlayer}`;
            const img = document.createElement('img');
            img.src = `assets/images/head_no_background/${p.type}.png`;
            img.alt = p.name || p.type;
            img.title = getString(`animal_${p.type}`) || p.name || p.type;
            el.appendChild(img);
            container.appendChild(el);
        });
    };
    renderPanel(capturedByPlayer0Container, capturedByPlayer0);
    renderPanel(capturedByPlayer1Container, capturedByPlayer1);
}

export function addMoveToHistory(pieceData, fromR, fromC, toR, toC, capturedPieceData) {
    if (!moveListElement) return;
    const getAlgebraic = (r, c) => `${String.fromCharCode(65 + c)}${BOARD_ROWS - r}`;
    const startNotation = getAlgebraic(fromR, fromC);
    const endNotation = getAlgebraic(toR, toC);
    const pieceImgSrc = `assets/images/head_no_background/${pieceData.type}.png`;
    const pieceName = getString(`animal_${pieceData.type}`) || pieceData.name || pieceData.type;
    const pieceAlt = `${PIECES[pieceData.type]?.symbol || pieceName}`;
    let moveHtml = `<span class="piece-hist player${pieceData.player}">
                        <img src="${pieceImgSrc}" alt="${pieceAlt}" title="${pieceName}">
                    </span> ${startNotation} → ${endNotation}`;
    if (capturedPieceData) {
        const capturedImgSrc = `assets/images/head_no_background/${capturedPieceData.type}.png`;
        const capturedName = getString(`animal_${capturedPieceData.type}`) || capturedPieceData.name || capturedPieceData.type;
        const capturedAlt = `${PIECES[capturedPieceData.type]?.symbol || capturedName}`;
         moveHtml += ` (x <span class="piece-hist player${capturedPieceData.player}">
                            <img src="${capturedImgSrc}" alt="${capturedAlt}" title="${capturedName}">
                         </span>)`;
    }
    const li = document.createElement('li');
    li.innerHTML = moveHtml;
    moveListElement.appendChild(li);
    moveListElement.scrollTop = moveListElement.scrollHeight;
}

export function clearMoveHistory() {
     if (moveListElement) moveListElement.innerHTML = '';
}

export function playSound(soundName) {
    try {
        if (!soundName || typeof soundName !== 'string') {
            console.warn("playSound: Invalid sound name provided:", soundName); return;
        }
        const soundPath = `assets/sounds/${soundName.toLowerCase()}.mp3`;
        const audio = new Audio(soundPath);
        audio.play().catch(e => console.warn(`Sound playback failed for ${soundPath}:`, e.message || e));
    } catch (e) {
        console.error("Error creating or playing sound:", e);
    }
}

export function updateAiDepthDisplay(depth) {
    const el = document.getElementById('ai-depth-achieved');
    if (el) { el.textContent = depth.toString(); }
}

export function updateWinChanceDisplay(aiEvalScore) {
    if (!winChanceDisplayElement) return;
    if (aiEvalScore === null || aiEvalScore === undefined || !isFinite(aiEvalScore)) {
        winChanceDisplayElement.textContent = getString('winChanceCalculating'); return;
    }
    const playerEvalScore = -aiEvalScore;
    const clampedScore = Math.max(LOSE_SCORE_THRESHOLD, Math.min(WIN_SCORE_THRESHOLD, playerEvalScore));
    const probability = 1 / (1 + Math.exp(-SIGMOID_SCALE_FACTOR * clampedScore));
    const percentage = Math.round(probability * 100);
    winChanceDisplayElement.textContent = getString('winChanceValue', { value: percentage });
}