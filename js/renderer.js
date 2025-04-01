// js/renderer.js

// Import necessary constants and potentially the Board class if needed for type hinting
import { BOARD_ROWS, BOARD_COLS, TerrainType, Player } from './constants.js';
// We don't strictly need to import Piece here, as we get piece objects from the board state.

/**
 * Renders the current state of the board to the HTML DOM.
 * Assumes an HTML element with id="board" exists.
 * @param {Board} board - The Board object instance containing the game state.
 */
export function renderBoard(board) {
    const boardElement = document.getElementById('board');
    if (!boardElement) {
        console.error("Renderer Error: Board element #board not found!");
        return;
    }

    // Clear the previous board state from the DOM
    boardElement.innerHTML = '';

    // Loop through each row and column of the board state
    for (let r = 0; r < BOARD_ROWS; r++) {
        for (let c = 0; c < BOARD_COLS; c++) {
            // Create the square element
            const square = document.createElement('div');
            square.classList.add('square');
            // Add data attributes for easier identification later (e.g., in event handlers)
            square.dataset.row = r;
            square.dataset.col = c;

            // Determine and add terrain classes
            const terrain = board.getTerrain(r, c);
            square.classList.add(terrain); // Add base terrain class ('normal', 'river', 'trap', 'den')

            // Add player-specific terrain classes if needed (based on location)
            // These checks assume P1 (Blue) is bottom, P2 (Red) is top
            if (terrain === TerrainType.TRAP) {
                // Player 1's traps are typically at the bottom (rows 5, 6)
                if (r >= 5) {
                    square.classList.add('trap-p1');
                } else { // Player 2's traps are typically at the top (rows 0, 1)
                    square.classList.add('trap-p2');
                }
            } else if (terrain === TerrainType.DEN) {
                 // Player 1's den is typically at the bottom (row 6)
                 if (r === 8) {
                    square.classList.add('den-p1');
                 } else { // Player 2's den is typically at the top (row 0)
                    square.classList.add('den-p2');
                 }
            }

            // Check if there's a piece on this square
            const piece = board.getPiece(r, c);
            if (piece) {
                // Create the piece element
                const pieceElement = document.createElement('div');
                pieceElement.classList.add('piece');
                pieceElement.classList.add(piece.type); // Add animal type class (e.g., 'rat', 'lion')

                // Add player class ('player1' or 'player2')
                const playerClass = (piece.player === Player.PLAYER1) ? 'player1' : 'player2';
                pieceElement.classList.add(playerClass);

                // Add a title attribute for hover tooltip (optional)
                pieceElement.title = `${piece.type} (Player ${piece.player})`;

                // Append the piece element to the square element
                square.appendChild(pieceElement);
            }

            // Append the configured square element to the board element
            boardElement.appendChild(square);
        }
    }
}

// --- Other potential renderer functions to add later ---

/**
 * Highlights a specific square with a given class name.
 * @param {number} row
 * @param {number} col
 * @param {string} className - e.g., 'selected-square', 'valid-move'
 */
export function highlightSquare(row, col, className) {
    const square = document.querySelector(`.square[data-row="${row}"][data-col="${col}"]`);
    if (square) {
        square.classList.add(className);
    }
}

/**
 * Removes a specific highlight class from all squares.
 * @param {string} className - e.g., 'selected-square', 'valid-move'
 */
export function clearHighlights(className) {
    const highlighted = document.querySelectorAll(`#board .${className}`);
    highlighted.forEach(el => el.classList.remove(className));
}

/**
 * Highlights the piece element itself when selected.
 * @param {number} row
 * @param {number} col
 * @param {string} className - e.g., 'selected-piece'
 */
export function highlightPiece(row, col, className) {
    const piece = document.querySelector(`.square[data-row="${row}"][data-col="${col}"] .piece`);
     if (piece) {
        piece.classList.add(className);
     }
}

/**
 * Removes a specific highlight class from all piece elements.
 * @param {string} className - e.g., 'selected-piece'
 */
export function clearPieceHighlights(className) {
     const highlighted = document.querySelectorAll(`#board .${className}`);
     highlighted.forEach(el => el.classList.remove(className));
}


/**
 * Updates the text content of the status element.
 * @param {string} message
 */
export function updateStatus(message) {
    const statusElement = document.getElementById('status');
    if (statusElement) {
        statusElement.textContent = message;
    } else {
        console.warn("Renderer Warning: Status element #status not found!");
    }
}

// Example of adding event listeners (should be called ONCE from main.js/game.js)
/**
 * Adds click event listeners to all squares on the board.
 * @param {function(number, number)} handleClickCallback - Function to call when a square is clicked, passing (row, col).
 */
export function addBoardEventListeners(handleClickCallback) {
    const boardElement = document.getElementById('board');
    if (boardElement) {
        // Use event delegation on the parent board element for efficiency
        boardElement.addEventListener('click', (event) => {
            // Find the closest ancestor element that is a square
            const clickedSquare = event.target.closest('.square');
            if (clickedSquare) {
                const row = parseInt(clickedSquare.dataset.row);
                const col = parseInt(clickedSquare.dataset.col);
                if (!isNaN(row) && !isNaN(col)) {
                    handleClickCallback(row, col);
                }
            }
        });
        console.log("Board event listener added.");
    } else {
         console.error("Renderer Error: Could not add board event listeners, #board not found!");
    }
}