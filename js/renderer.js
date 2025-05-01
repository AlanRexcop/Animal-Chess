// js/renderer.js
import { BOARD_ROWS, BOARD_COLS, TERRAIN_LAND, TERRAIN_WATER, TERRAIN_TRAP, TERRAIN_PLAYER0_DEN, TERRAIN_PLAYER1_DEN, Player, getPieceKey, PIECES } from './constants.js';
import { getString } from './localization.js';
import { Piece } from './piece.js'; // Needed if we instantiate pieces here, but likely not

// DOM Elements (Cache them if accessed frequently)
const boardElement = document.getElementById('board');
const statusElement = document.getElementById('status');
const turnElement = document.getElementById('turn'); // Cached turn element
const capturedByPlayer0Container = document.querySelector('#captured-by-player0 .pieces-container');
const capturedByPlayer1Container = document.querySelector('#captured-by-player1 .pieces-container');
const moveListElement = document.getElementById('move-list');
const colLabelsTop = document.getElementById('col-labels-top');
const colLabelsBottom = document.getElementById('col-labels-bottom');
const rowLabelsLeft = document.getElementById('row-labels-left');
const rowLabelsRight = document.getElementById('row-labels-right');
const winChanceDisplayElement = document.getElementById('win-chance-display'); // <-- Cache new element

// Constants for eval conversion (adjust k as needed based on score range)
const WIN_SCORE_THRESHOLD = 19000; // Use slightly less than absolute max
const LOSE_SCORE_THRESHOLD = -19000;
const SIGMOID_SCALE_FACTOR = 0.0003; // Adjust this to control steepness of the % curve


/**
 * Renders the entire game board, including terrain, pieces, and attaches click handlers.
 * @param {Array<Array<{piece: Piece|object|null, terrain: number}>>} boardState - The current board state. Piece can be Piece instance or plain object.
 * @param {function} clickHandler - Function to call when a square is clicked (passes row, col).
 * @param {{start: {r, c}, end: {r, c}} | null} lastMove - The last move made, for highlighting.
 */
export function renderBoard(boardState, clickHandler, lastMove = null) {
    if (!boardElement) {
        console.error("Board element not found!");
        return;
    }
    boardElement.innerHTML = ''; // Clear previous state

    // Clear previous last move highlights
    clearHighlights('last-move-start');
    clearHighlights('last-move-end');

    for (let r = 0; r < BOARD_ROWS; r++) {
        for (let c = 0; c < BOARD_COLS; c++) {
            const squareElement = document.createElement('div');
            squareElement.className = 'square';
            squareElement.dataset.row = r;
            squareElement.dataset.col = c;

            const cellData = boardState[r]?.[c];
            if (!cellData) {
                console.warn(`Missing cell data for ${r},${c}`);
                continue; // Skip if data is missing
            }
            const terrain = cellData.terrain;
            const pieceData = cellData.piece; // This could be a Piece instance or a plain object from worker/clone

            // --- Terrain Class ---
            switch (terrain) {
                case TERRAIN_LAND: squareElement.classList.add('land'); break;
                case TERRAIN_WATER: squareElement.classList.add('water'); break;
                case TERRAIN_TRAP: squareElement.classList.add('trap'); break;
                case TERRAIN_PLAYER0_DEN: squareElement.classList.add('player0-den'); break; // Blue Den
                case TERRAIN_PLAYER1_DEN: squareElement.classList.add('player1-den'); break; // Red Den
                default: squareElement.classList.add('land'); // Default fallback
            }

            // --- Piece Rendering ---
            if (pieceData && pieceData.type) { // Check if piece exists and has a type
                const pieceElement = document.createElement('div');
                // Use pieceData.player (should be 0 or 1)
                pieceElement.className = `piece player${pieceData.player}`;

                const imgElement = document.createElement('img');
                // Construct image source based on piece type and player
                const color = pieceData.player === Player.PLAYER0 ? 'blue' : 'red';
                imgElement.src = `assets/images/${pieceData.type}_${color}.webp`;
                imgElement.alt = pieceData.name || pieceData.type; // Use name if available, else type
                pieceElement.appendChild(imgElement);

                // Add data attributes for easier selection if needed later
                pieceElement.dataset.pieceType = pieceData.type;
                pieceElement.dataset.player = pieceData.player;

                squareElement.appendChild(pieceElement);
            }

            // --- Attach Click Handler ---
            squareElement.addEventListener('click', () => clickHandler(r, c));

            // --- Highlight Last Move ---
            if (lastMove) {
                if (lastMove.start.r === r && lastMove.start.c === c) {
                    squareElement.classList.add('last-move-start');
                }
                if (lastMove.end.r === r && lastMove.end.c === c) {
                    squareElement.classList.add('last-move-end');
                }
            }

            boardElement.appendChild(squareElement);
        }
    }
     renderCoordinatesIfNeeded(); // Render coords if not already done
}

let coordinatesRendered = false;
function renderCoordinatesIfNeeded() {
    if (coordinatesRendered) return;
     colLabelsTop.innerHTML = ''; colLabelsBottom.innerHTML = ''; rowLabelsLeft.innerHTML = ''; rowLabelsRight.innerHTML = '';
     for (let c = 0; c < BOARD_COLS; c++) { const l=String.fromCharCode(65+c); const sT=document.createElement('span'); sT.textContent=l; colLabelsTop.appendChild(sT); const sB=document.createElement('span'); sB.textContent=l; colLabelsBottom.appendChild(sB); }
     for (let r = 0; r < BOARD_ROWS; r++) { const l=(BOARD_ROWS-r).toString(); const sL=document.createElement('span'); sL.textContent=l; rowLabelsLeft.appendChild(sL); const sR=document.createElement('span'); sR.textContent=l; rowLabelsRight.appendChild(sR); }
     coordinatesRendered = true;
}


/**
 * Adds a CSS class to highlight a specific square.
 * @param {number} row
 * @param {number} col
 * @param {string} className - The CSS class name to add (e.g., 'selected', 'possible-move').
 */
export function highlightSquare(row, col, className) {
    const square = boardElement?.querySelector(`.square[data-row="${row}"][data-col="${col}"]`);
    if (square) {
        square.classList.add(className);
    } else {
        // console.warn(`Highlight: Square not found for ${row}, ${col}`);
    }
}

/**
 * Removes a specific CSS highlight class from all squares.
 * @param {string} className - The CSS class name to remove.
 */
export function clearHighlights(className) {
    boardElement?.querySelectorAll(`.${className}`).forEach(el => el.classList.remove(className));
}

/**
 * Updates the status message display with localized text.
 * @param {string} messageKey - The key for the localized string.
 * @param {object} [params] - Optional parameters for placeholder replacement.
 * @param {boolean} [isError=false] - Optional flag to style as error.
 */
export function updateStatus(messageKey, params = {}, isError = false) {
    if (!statusElement) return;
    const message = getString(messageKey, params);
    statusElement.textContent = message;
    statusElement.classList.toggle('error-message', isError); // Add/remove an error class if needed
}

/**
 * Updates the turn indicator display with localized text.
 * @param {number} currentPlayer - Player.PLAYER0 or Player.PLAYER1
 * @param {string} gameMode - 'PVA' or 'PVP'
 * @param {boolean} isGameOver - Flag indicating if the game is over.
 */
export function updateTurnDisplay(currentPlayer, gameMode = 'PVA', isGameOver = false) { // Added isGameOver parameter
     if (!turnElement) return;

     if (isGameOver) { // <-- Check if game is over
         turnElement.textContent = '---'; // Clear turn display
         return;
     }

     let playerLabelKey;
     if (gameMode === 'PVP') {
         playerLabelKey = (currentPlayer === Player.PLAYER0) ? 'player1Name' : 'player2Name'; // Assuming P1=Blue, P2=Red
     } else { // PVA
         playerLabelKey = (currentPlayer === Player.PLAYER0) ? 'playerName' : 'aiName';
     }
     turnElement.textContent = getString(playerLabelKey); // Uses localization
}

/**
 * Renders the lists of captured pieces for both players.
 * @param {Array<object>} capturedByPlayer0 - Array of piece objects/data captured by Player 0 (Blue).
 * @param {Array<object>} capturedByPlayer1 - Array of piece objects/data captured by Player 1 (Red).
 */
export function renderCapturedPieces(capturedByPlayer0, capturedByPlayer1) {
    const renderPanel = (container, piecesList) => {
        if (!container) return;
        container.innerHTML = ''; // Clear previous
        if (piecesList.length === 0) {
            container.textContent = getString('capturedNone'); // Localized "None"
            return;
        }
        // Sort by rank (descending) before rendering might be nice
        piecesList.sort((a, b) => (PIECES[b.type]?.rank ?? 0) - (PIECES[a.type]?.rank ?? 0));

        piecesList.forEach(p => {
            if (!p || !p.type) return; // Skip invalid piece data

            const el = document.createElement('span');
            // Style based on the *original* player of the captured piece
            const capturingPlayer = Player.getOpponent(p.player); // Get who captured it
            el.className = `captured-piece player${capturingPlayer}`; // Class indicates capturer for border

            const img = document.createElement('img');
            // Image source uses the piece's *original* color/player
            const originalColor = p.player === Player.PLAYER0 ? 'blue' : 'red';
            img.src = `assets/images/${p.type}_${originalColor}.webp`;
            img.alt = p.name || p.type;
            img.title = getString(`animal_${p.type}`) || p.name || p.type; // Tooltip with localized name
            el.appendChild(img);
            container.appendChild(el);
        });
    };

    renderPanel(capturedByPlayer0Container, capturedByPlayer0); // Pieces captured *by* Blue (were originally Red)
    renderPanel(capturedByPlayer1Container, capturedByPlayer1); // Pieces captured *by* Red (were originally Blue)
}


/**
 * Adds a formatted move string (with piece images) to the history list.
 * @param {object} pieceData - The piece that moved { type, player, name? }.
 * @param {number} fromR
 * @param {number} fromC
 * @param {number} toR
 * @param {number} toC
 * @param {object | null} capturedPieceData - The piece that was captured { type, player, name? }.
 */
export function addMoveToHistory(pieceData, fromR, fromC, toR, toC, capturedPieceData) {
    if (!moveListElement) return;

    const getAlgebraic = (r, c) => `${String.fromCharCode(65 + c)}${BOARD_ROWS - r}`;
    const startNotation = getAlgebraic(fromR, fromC);
    const endNotation = getAlgebraic(toR, toC);

    const pieceColor = pieceData.player === Player.PLAYER0 ? 'blue' : 'red';
    const pieceImgSrc = `assets/images/${pieceData.type}_${pieceColor}.webp`;
    const pieceName = getString(`animal_${pieceData.type}`) || pieceData.name || pieceData.type;
    const pieceAlt = `${PIECES[pieceData.type]?.symbol || pieceName}`;

    // Add player class to the span for potential styling
    let moveHtml = `<span class="piece-hist player${pieceData.player}">
                        <img src="${pieceImgSrc}" alt="${pieceAlt}" title="${pieceName}">
                    </span> ${startNotation} → ${endNotation}`;

    if (capturedPieceData) {
        const capturedColor = capturedPieceData.player === Player.PLAYER0 ? 'blue' : 'red';
        const capturedImgSrc = `assets/images/${capturedPieceData.type}_${capturedColor}.webp`;
        const capturedName = getString(`animal_${capturedPieceData.type}`) || capturedPieceData.name || capturedPieceData.type;
        const capturedAlt = `${PIECES[capturedPieceData.type]?.symbol || capturedName}`;
        // Add player class to the captured piece span
         moveHtml += ` (x <span class="piece-hist player${capturedPieceData.player}">
                            <img src="${capturedImgSrc}" alt="${capturedAlt}" title="${capturedName}">
                         </span>)`;
    }

    const li = document.createElement('li');
    li.innerHTML = moveHtml;
    moveListElement.appendChild(li);
    // Auto-scroll to bottom
    moveListElement.scrollTop = moveListElement.scrollHeight;
}

/** Clears the move history display */
export function clearMoveHistory() {
     if (moveListElement) moveListElement.innerHTML = '';
}

/**
 * Plays a sound effect.
 * @param {string} soundName - Base name of the sound (e.g., 'move', 'capture_rat', 'victory').
 */
export function playSound(soundName) {
    try {
        if (!soundName || typeof soundName !== 'string') {
            console.warn("playSound: Invalid sound name provided:", soundName);
            return;
        }
        // Ensure consistency in sound file names (e.g., all lowercase)
        const soundPath = `assets/sounds/${soundName.toLowerCase()}.mp3`;
        const audio = new Audio(soundPath);
        audio.play().catch(e => console.warn(`Sound playback failed for ${soundPath}:`, e.message || e)); // Log specific error message
    } catch (e) {
        console.error("Error creating or playing sound:", e);
    }
}

/**
 * Updates the displayed AI depth achieved.
 * @param {number | string} depth - The depth value or '-'
 */
export function updateAiDepthDisplay(depth) {
    const el = document.getElementById('ai-depth-achieved');
    if (el) {
        el.textContent = depth.toString();
    }
}

/**
 * Updates the win chance display based on the AI evaluation score.
 * Converts the score (from AI's perspective) to Player 0's win percentage.
 * @param {number | null} aiEvalScore - The raw evaluation score from the AI worker, or null.
 */
export function updateWinChanceDisplay(aiEvalScore) {
    if (!winChanceDisplayElement) return;

    if (aiEvalScore === null || aiEvalScore === undefined || !isFinite(aiEvalScore)) {
        // Show calculating text if score is invalid or not yet available
        winChanceDisplayElement.textContent = getString('winChanceCalculating');
        return;
    }

    // 1. Convert score to Player 0's perspective (negate AI score)
    const playerEvalScore = -aiEvalScore;

    // 2. Clamp the score to prevent extreme values from sigmoid calculation
    const clampedScore = Math.max(LOSE_SCORE_THRESHOLD, Math.min(WIN_SCORE_THRESHOLD, playerEvalScore));

    // 3. Apply sigmoid function for a 0-1 probability
    // The scaling factor determines how quickly the probability changes around 0 score
    const probability = 1 / (1 + Math.exp(-SIGMOID_SCALE_FACTOR * clampedScore));

    // 4. Convert probability to percentage and round
    const percentage = Math.round(probability * 100);

    // 5. Display the localized string
    winChanceDisplayElement.textContent = getString('winChanceValue', { value: percentage });
}