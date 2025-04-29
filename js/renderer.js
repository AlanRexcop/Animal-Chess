// js/renderer.js
import { BOARD_ROWS, BOARD_COLS, TerrainType, Player, PieceData } from './constants.js';
import { getString } from './localization.js';
// Piece class potentially needed for type hints if using TypeScript/JSDoc heavily
// import { Piece } from './piece.js';

// --- DOM Element References ---
const boardElement = document.getElementById('game-board');
const turnElement = document.getElementById('turn'); // For player turn text
const statusElement = document.getElementById('status'); // For game messages
const aiDepthElement = document.getElementById('ai-depth-achieved'); // For AI info
const moveListElement = document.getElementById('move-list'); // For move history
// Captured pieces containers (using the specific IDs from HTML)
const capturedP0Container = document.querySelector('#captured-pieces-player0 .pieces-container');
const capturedP1Container = document.querySelector('#captured-pieces-player1 .pieces-container');
// Coordinate Labels
const colLabelsTop = document.getElementById('col-labels-top');
const colLabelsBottom = document.getElementById('col-labels-bottom');
const rowLabelsLeft = document.getElementById('row-labels-left');
const rowLabelsRight = document.getElementById('row-labels-right');
// Labels that need localization updates
const capturedP0LabelElem = document.querySelector('#captured-pieces-player0 h2');
const capturedP1LabelElem = document.querySelector('#captured-pieces-player1 h2');
const moveHistoryLabelElem = document.querySelector('#move-history h2');
const turnInfoLabelElem = document.querySelector('.turn-info'); // The whole paragraph

/**
 * Clears the board container and redraws squares, terrain, and pieces.
 * Attaches data attributes for coordinates. DOES NOT attach event listeners here.
 * @param {Board} board - The Board instance containing the game state.
 * @param {{piece: Piece, row: number, col: number} | null} selectedPiece - Info about the selected piece for highlighting.
 * @param {Array<{row: number, col: number}>} possibleMoves - Array of valid moves for the selected piece.
 */
export function renderBoard(board, selectedPiece, possibleMoves = []) {
    if (!boardElement) {
        console.error("Renderer Error: Board element #game-board not found!");
        return;
    }
    boardElement.innerHTML = ''; // Clear previous state

    const boardState = board.getState(); // Get the 2D array

    for (let r = 0; r < BOARD_ROWS; r++) {
        for (let c = 0; c < BOARD_COLS; c++) {
            const squareData = boardState[r][c];
            const square = document.createElement('div');
            square.classList.add('square');
            square.dataset.row = r; // Data attributes for click handling
            square.dataset.col = c;

            // --- Add terrain class ---
            square.classList.add(squareData.terrain); // Uses 'land', 'water', 'trap', 'player0-den', 'player1-den'

            // --- Add piece if exists ---
            if (squareData.piece) {
                const pieceData = squareData.piece;
                const pieceElement = document.createElement('div');
                // Class list: 'piece', 'player0'/'player1', optionally symbol/type if needed for CSS
                pieceElement.classList.add('piece', `player${pieceData.player}`);
                pieceElement.textContent = pieceData.symbol; // Use textContent for emoji symbol
                // Store reference to piece data if needed, though not used by CSS here
                // pieceElement.pieceData = pieceData;
                square.appendChild(pieceElement);
            }

            // --- Add selection highlight ---
            if (selectedPiece && selectedPiece.row === r && selectedPiece.col === c) {
                // Highlight the piece div directly if it exists, otherwise the square
                const pieceEl = square.querySelector('.piece');
                if (pieceEl) {
                    pieceEl.classList.add('selected');
                } else {
                    square.classList.add('selected'); // Fallback or style square border? Adjust CSS if needed
                }
            }

            // --- Add possible move highlights ---
            if (possibleMoves.some(m => m.row === r && m.col === c)) {
                square.classList.add('possible-move');
                // Add capture highlight if the square has an opponent piece
                if (squareData.piece && squareData.piece.player !== selectedPiece?.piece.player) {
                    square.classList.add('capture-move');
                }
            }

            boardElement.appendChild(square);
        }
    }
    // console.log("Board rendered"); // Optional debug log
}

/**
 * Renders the A1, B2 etc. coordinate labels around the board.
 * Called once during initialization.
 */
export function renderCoordinates() {
    if (!colLabelsTop || !colLabelsBottom || !rowLabelsLeft || !rowLabelsRight) {
        console.warn("Renderer Warning: Coordinate label elements missing.");
        return;
    }
    colLabelsTop.innerHTML = ''; colLabelsBottom.innerHTML = '';
    rowLabelsLeft.innerHTML = ''; rowLabelsRight.innerHTML = '';

    for (let c = 0; c < BOARD_COLS; c++) {
        const label = String.fromCharCode(65 + c); // A, B, C...
        const spanTop = document.createElement('span'); spanTop.textContent = label;
        const spanBottom = document.createElement('span'); spanBottom.textContent = label;
        colLabelsTop.appendChild(spanTop);
        colLabelsBottom.appendChild(spanBottom);
    }
    for (let r = 0; r < BOARD_ROWS; r++) {
        const label = (BOARD_ROWS - r).toString(); // 9, 8, 7...
        const spanLeft = document.createElement('span'); spanLeft.textContent = label;
        const spanRight = document.createElement('span'); spanRight.textContent = label;
        rowLabelsLeft.appendChild(spanLeft);
        rowLabelsRight.appendChild(spanRight);
    }
}

/**
 * Updates the main status message element. Uses localization.
 * @param {string} messageKey - The localization key for the message.
 * @param {object} [params={}] - Optional parameters for the localized string.
 */
export function updateStatus(messageKey, params = {}) {
    if (statusElement) {
        statusElement.textContent = getString(messageKey, params);
    } else {
        console.warn("Renderer Warning: Status element #status not found!");
    }
}

/**
 * Updates the turn indicator text. Uses localization.
 * @param {Player} currentPlayer - The current player (Player.PLAYER0 or Player.PLAYER1).
 * @param {string} gameMode - Current game mode ('PVA' or 'PVP').
 * @param {boolean} isGameOver - Indicates if the game has ended.
 */
export function updateTurnIndicator(currentPlayer, gameMode, isGameOver = false) {
    if (turnInfoLabelElem && turnElement) {
        // ****** MODIFIED: Localize the static "Turn:" part ******
        const turnLabelText = getString('turnLabel');
        // Find the text node within turn-info, careful not to overwrite the span
        let foundTextNode = false;
        for (const node of turnInfoLabelElem.childNodes) {
            // Check if it's a text node and contains the colon (or just update first text node)
            if (node.nodeType === Node.TEXT_NODE && node.textContent.includes(':')) {
                 node.textContent = ` ${turnLabelText} `; // Add spaces for separation
                 foundTextNode = true;
                 break;
            }
        }
        // Fallback if the specific text node wasn't found (e.g., if structure changed)
        if (!foundTextNode && turnInfoLabelElem.firstChild?.nodeType === Node.TEXT_NODE) {
             turnInfoLabelElem.firstChild.textContent = ` ${turnLabelText} `;
        }

        if (isGameOver) {
            turnElement.textContent = "---";
        } else {
            const color = getString(currentPlayer === Player.PLAYER0 ? 'player0Color' : 'player1Color');
            let nameKey = '';
            if (gameMode === 'PVP') {
                nameKey = currentPlayer === Player.PLAYER0 ? 'player0Name' : 'player1Name';
            } else { // PVA
                nameKey = currentPlayer === Player.PLAYER0 ? 'player0Name' : 'player1NameAI';
            }
            const name = getString(nameKey);
            turnElement.textContent = `${name} (${color})`;
        }
    } else {
        console.warn("Renderer Warning: Turn elements #turn or .turn-info not found!");
    }
}


/**
 * Adds the board click event listener using event delegation.
 * MUST be called only ONCE during initialization.
 * @param {Function} handleClickCallback - Function to call when a square is clicked, passing (row, col).
 */
export function addBoardEventListeners(handleClickCallback) {
    if (boardElement) {
        boardElement.addEventListener('click', (event) => {
            // Find the closest ancestor element that is a square
            const clickedSquare = event.target.closest('.square');
            if (clickedSquare && clickedSquare.dataset.row && clickedSquare.dataset.col) {
                const row = parseInt(clickedSquare.dataset.row, 10);
                const col = parseInt(clickedSquare.dataset.col, 10);
                if (!isNaN(row) && !isNaN(col)) {
                    handleClickCallback(row, col);
                }
            }
        });
        console.log("Board event listener added using delegation.");
    } else {
        console.error("Renderer Error: Could not add board event listener, #game-board not found!");
    }
}

/**
 * Updates the display for captured pieces. Uses localization.
 * @param {Array<Piece>} capturedByPlayer0 - Array of Piece objects captured by Player 0 (Blue).
 * @param {Array<Piece>} capturedByPlayer1 - Array of Piece objects captured by Player 1 (Red).
 */
export function renderCapturedPieces(capturedByPlayer0 = [], capturedByPlayer1 = []) {
    if (!capturedP0Container || !capturedP1Container || !capturedP0LabelElem || !capturedP1LabelElem) {
        console.warn("Renderer Warning: Captured pieces elements not found.");
        return;
    }

    // Update Labels using localization
    capturedP0LabelElem.textContent = getString('capturedByPlayer0Label');
    capturedP1LabelElem.textContent = getString('capturedByPlayer1Label');

    const noneText = getString('capturedNone');

    // Render pieces for Player 0 (Blue) captures (which are Player 1's pieces)
    capturedP0Container.innerHTML = ''; // Clear previous
    if (capturedByPlayer0.length === 0) {
        capturedP0Container.textContent = noneText;
    } else {
        // Sort by rank descending? (Optional, original code did this)
        capturedByPlayer0.sort((a, b) => b.rank - a.rank);
        capturedByPlayer0.forEach(piece => {
            const el = document.createElement('span');
            el.className = `captured-piece player${piece.player}`; // Class matches the piece's owner
            el.textContent = piece.symbol;
            capturedP0Container.appendChild(el);
        });
    }

    // Render pieces for Player 1 (Red) captures (which are Player 0's pieces)
    capturedP1Container.innerHTML = ''; // Clear previous
    if (capturedByPlayer1.length === 0) {
        capturedP1Container.textContent = noneText;
    } else {
        capturedByPlayer1.sort((a, b) => b.rank - a.rank);
        capturedByPlayer1.forEach(piece => {
            const el = document.createElement('span');
            el.className = `captured-piece player${piece.player}`;
            el.textContent = piece.symbol;
            capturedP1Container.appendChild(el);
        });
    }
}

/**
 * Formats a move into an HTML string for the history log.
 * @param {Piece} pieceData - The piece that moved.
 * @param {number} fromR - Start row.
 * @param {number} fromC - Start column.
 * @param {number} toR - End row.
 * @param {number} toC - End column.
 * @param {Piece | null} capturedPiece - The piece that was captured, if any.
 * @returns {string} HTML string representation of the move.
 */
function formatMoveForHistory(pieceData, fromR, fromC, toR, toC, capturedPiece) {
    const fileFrom = String.fromCharCode(65 + fromC);
    const rankFrom = BOARD_ROWS - fromR;
    const fileTo = String.fromCharCode(65 + toC);
    const rankTo = BOARD_ROWS - toR;

    const startNotation = `${fileFrom}${rankFrom}`;
    const endNotation = `${fileTo}${rankTo}`;

    let moveHtml = `<span class="piece-hist player${pieceData.player}">${pieceData.symbol}</span> ${startNotation} → ${endNotation}`;
    if (capturedPiece) {
        moveHtml += ` (x <span class="piece-hist player${capturedPiece.player}">${capturedPiece.symbol}</span>)`;
    }
    return moveHtml;
}

/**
 * Updates the move history display. Uses localization for the label.
 * @param {Array<{piece: Piece, fromRow: number, fromCol: number, toRow: number, toCol: number, capturedPiece: Piece | null}>} moveHistoryLog - Array of move objects.
 */
export function renderMoveHistory(moveHistoryLog = []) {
     if (!moveListElement || !moveHistoryLabelElem) {
        console.warn("Renderer Warning: Move history elements not found.");
        return;
    }

    // Update Label using localization
    moveHistoryLabelElem.textContent = getString('moveHistoryLabel');

    moveListElement.innerHTML = ''; // Clear previous
    moveHistoryLog.forEach(move => {
        const li = document.createElement('li');
        // Use the formatter function
        li.innerHTML = formatMoveForHistory(move.piece, move.fromRow, move.fromCol, move.toRow, move.toCol, move.capturedPiece);
        moveListElement.appendChild(li);
    });

    // Auto-scroll to the bottom
    moveListElement.scrollTop = moveListElement.scrollHeight;
}

/**
 * Updates the displayed AI depth achieved.
 * @param {number} depth - The actual depth reached by the AI search.
 */
export function updateAiDepthDisplay(depth) {
    if (aiDepthElement) {
        aiDepthElement.textContent = depth.toString();
    }
}

/**
 * Animates a piece moving from one square to another.
 * @param {number} fromRow
 * @param {number} fromCol
 * @param {number} toRow
 * @param {number} toC
 * @param {number} duration - Animation duration in ms.
 * @returns {Promise<void>} Promise that resolves when animation completes.
 */
export async function animateMove(fromRow, fromCol, toRow, toCol, duration) {
    return new Promise((resolve) => {
        const startSquare = boardElement.querySelector(`.square[data-row="${fromRow}"][data-col="${fromCol}"]`);
        const endSquare = boardElement.querySelector(`.square[data-row="${toRow}"][data-col="${toCol}"]`);
        const pieceElement = startSquare?.querySelector('.piece');

        if (!startSquare || !endSquare || !pieceElement) {
            console.error("Animation Error: Could not find elements for animation.", { fromRow, fromCol, toRow, toCol });
            resolve(); // Resolve immediately if elements are missing
            return;
        }

        // Temporarily remove captured piece from DOM if exists
        const capturedElement = endSquare.querySelector('.piece');
        if (capturedElement) {
            capturedElement.style.opacity = '0'; // Hide it first
             // We don't remove it here, game.js will handle board state update
             // which triggers re-render. Just make it invisible during anim.
        }


        const startRect = startSquare.getBoundingClientRect();
        const endRect = endSquare.getBoundingClientRect();

        // Calculate the difference from the piece's natural center to the target center
        // Assumes piece is centered via translate(-50%, -50%)
        const deltaX = (endRect.left + endRect.width / 2) - (startRect.left + startRect.width / 2);
        const deltaY = (endRect.top + endRect.height / 2) - (startRect.top + startRect.height / 2);

        // Move piece element temporarily to the end square for stacking context
        endSquare.appendChild(pieceElement);

        // Apply animation styles
        pieceElement.style.transition = `transform ${duration / 1000}s ease-out, opacity ${duration / 1000}s ease-out`;
        pieceElement.style.transform = `translate(calc(-50% + ${-deltaX}px), calc(-50% + ${-deltaY}px))`; // Start pos relative to end square
        pieceElement.style.zIndex = '10'; // Ensure piece is on top during animation

        // Force reflow to apply start styles before transition
        pieceElement.offsetHeight;

        // Trigger the animation to the final position (its natural center in the end square)
        requestAnimationFrame(() => {
            pieceElement.style.transform = 'translate(-50%, -50%)';
             if (capturedElement) capturedElement.style.opacity = '0'; // Keep captured hidden
        });

        // After animation duration, clean up styles and resolve promise
        setTimeout(() => {
            pieceElement.style.transition = '';
            pieceElement.style.zIndex = ''; // Reset z-index
            if (capturedElement) capturedElement.remove(); // Fully remove captured now
            resolve();
        }, duration);
    });
}