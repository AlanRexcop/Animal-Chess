// Import necessary constants and potentially the Board class if needed for type hinting
import { BOARD_ROWS, BOARD_COLS, TerrainType, Player } from './constants.js';

const boardElement = document.getElementById('board');


/**
 * Renders the entire board based on the board state.
 * @param {Array<Array<object>>} boardState - The 2D array representing the board.
 * @param {Function} clickHandler - Function to call when a square is clicked (e.g., game.handleSquareClick).
 */
export function renderBoard(boardState, clickHandler) {
    if (!boardElement) {
        console.error("Board element not found!");
        return;
    }
    boardElement.innerHTML = ''; // Clear previous state

    const rows = boardState.length;
    if (rows === 0) return;
    const cols = boardState[0].length;

    boardElement.style.gridTemplateColumns = `repeat(${cols}, 70px)`;
    boardElement.style.gridTemplateRows = `repeat(${rows}, 70px)`;

    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
            const squareData = boardState[r][c];
            const square = document.createElement('div');
            square.classList.add('square');
            square.dataset.row = r;
            square.dataset.col = c;

            // --- Add terrain classes ---
            if (squareData && squareData.terrain) {
                const terrain = squareData.terrain; // Assuming terrain is stored directly, e.g., 'RIVER', 'TRAP_P1', 'DEN_P2'
                square.classList.add(terrain.toLowerCase()); // Adds 'river', 'trap_p1', 'den_p2' etc.

            } else {
                 square.classList.add('normal'); // Default if no terrain info
            }
            // -------------------------


            // Add piece if exists
            if (squareData && squareData.piece) {
                const pieceData = squareData.piece;
                const pieceElement = document.createElement('div');
                pieceElement.classList.add('piece', pieceData.type.toLowerCase(), `player${pieceData.player}`);
                pieceElement.dataset.piece = `${pieceData.type}-P${pieceData.player}`;
                 // Ensure piece visuals override terrain background if needed (usually handled by CSS specificity)
                square.appendChild(pieceElement);
            }

            // Add the click listener
            square.addEventListener('click', () => clickHandler(r, c));

            boardElement.appendChild(square);
        }
    }
    // console.log("Board rendered with terrain");
}
//TODO other renderer
/**
 * Highlights a specific square with a given class name.
 * @param {number} row
 * @param {number} col
 * @param {string} className - e.g., 'selected-square', 'valid-move'
 */
export function highlightSquare(row, col, className) {
  // Find the square element using its data attributes
  const square = boardElement.querySelector(`.square[data-row="${row}"][data-col="${col}"]`);
  if (square) {
      square.classList.add(className); // Add the CSS class (e.g., 'selected', 'valid-move')
  } else {
      console.warn(`Could not find square at ${row},${col} to highlight.`);
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