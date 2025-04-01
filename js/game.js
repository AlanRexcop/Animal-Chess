// js/game.js
import { Board } from './board.js';
// Import highlight functions from renderer
import { renderBoard, highlightSquare, clearHighlights } from './renderer.js';
import { Player } from './constants.js';
// Import rules later when needed for valid moves
// import { getValidMovesForPiece } from './rules.js';

// --- Game State ---
let board = null;
let currentPlayer = Player.NONE;
let selectedPiece = null; // Stores { piece: Piece, row: number, col: number }
let gameStatus = 'Initializing';
let validMoves = []; // Stores coordinates {r, c} of valid moves for the selected piece

// --- Core Functions ---

function initGame() {
    console.log("Initializing game...");
    board = new Board();
    board.initBoard();
    currentPlayer = Player.PLAYER1;
    selectedPiece = null;
    validMoves = [];
    gameStatus = 'Ongoing';
    // Pass the click handler to renderBoard
    renderBoard(board.getState(), handleSquareClick);
    updateStatus();
    console.log("Game Initialized. Player 1's Turn.");
}

function handleSquareClick(row, col) {
    if (gameStatus !== 'Ongoing') return;

    console.log(`Square clicked: Row ${row}, Col ${col}`);
    const clickedSquareData = board.getSquareData(row, col); // Assuming this exists in Board.js
    const clickedPiece = clickedSquareData ? clickedSquareData.piece : null;

    // --- Selection Logic ---

    if (selectedPiece) {
        // === CASE 1: A piece is already selected ===

        if (selectedPiece.row === row && selectedPiece.col === col) {
            // 1a: Clicked the *same* selected piece -> Deselect
            console.log("Deselecting piece.");
            deselectPiece();
        } else if (clickedPiece && clickedPiece.player === currentPlayer) {
            // 1b: Clicked *another* friendly piece -> Switch selection
            console.log(`Switching selection to ${clickedPiece.type} at ${row},${col}`);
            deselectPiece(); // Clear previous selection and highlights
            selectPiece(clickedPiece, row, col);
        } else {
            // 1c: Clicked an empty square or an opponent's piece
            // TODO: Implement move/capture logic here in the next step.
            // Check if {row, col} is in the `validMoves` array.
            console.log("Clicked a potential target square (move/capture logic pending).");
             // For now, just deselect if clicking outside valid moves (or handle move later)
             // if (!validMoves.some(move => move.r === row && move.c === col)) {
             //     deselectPiece();
             // } else {
                  // Proceed with move/capture...
             // }
        }

    } else {
        // === CASE 2: No piece is currently selected ===

        if (clickedPiece && clickedPiece.player === currentPlayer) {
            // 2a: Clicked a friendly piece -> Select it
            selectPiece(clickedPiece, row, col);
        } else {
            // 2b: Clicked an empty square or an opponent's piece -> Do nothing
            console.log("Clicked empty square or opponent piece - no action.");
        }
    }

    updateStatus(); // Update UI feedback
}

/**
 * Selects a piece and highlights it and its valid moves.
 */
function selectPiece(piece, row, col) {
    selectedPiece = { piece, row, col };
    console.log(`Selected ${piece.type} at ${row},${col}`);

    // Clear any previous highlights first (safety measure)
    clearHighlights('selected');
    clearHighlights('valid-move');

    // Highlight the selected piece's square
    highlightSquare(row, col, 'selected');

    // Calculate and highlight valid moves (placeholder for now)
    // validMoves = getValidMovesForPiece(board.getState(), row, col); // Need rules.js
    validMoves = calculatePlaceholderValidMoves(row, col); // Use placeholder
    highlightValidMoves(validMoves);

    console.log("Valid moves (placeholder):", validMoves);
}

/**
 * Deselects the currently selected piece and clears highlights.
 */
function deselectPiece() {
    selectedPiece = null;
    validMoves = [];
    clearHighlights('selected');
    clearHighlights('valid-move');
    console.log("Piece deselected, highlights cleared.");
}


/**
 * Switches the turn to the other player.
 */
function switchPlayer() {
    currentPlayer = (currentPlayer === Player.PLAYER1) ? Player.PLAYER2 : Player.PLAYER1;
    deselectPiece(); // Deselect piece and clear highlights when turn switches
    updateStatus();
    console.log(`Turn switched. Player ${currentPlayer}'s Turn.`);
    // Later: Check for AI turn if applicable
}

/**
 * Updates the status message display.
 */
function updateStatus() {
    const statusElement = document.getElementById('status');
    if (statusElement) {
        let message = `Game Status: ${gameStatus}. `;
        if (gameStatus === 'Ongoing') {
            message += `Turn: Player ${currentPlayer}`;
            if (selectedPiece) {
                message += ` (Selected ${selectedPiece.piece.type} at ${selectedPiece.row},${selectedPiece.col})`;
            }
        }
        // Add win/loss messages later
        statusElement.textContent = message;
    } else {
        console.warn("Status element not found!");
    }
}

// --- Placeholder Functions (to be replaced) ---

/**
 * Calculates placeholder valid moves (just adjacent squares for now).
 * Replace this with actual logic using rules.js later.
 */
function calculatePlaceholderValidMoves(row, col) {
    const moves = [];
    const directions = [
        { r: -1, c: 0 }, { r: 1, c: 0 }, // Up, Down
        { r: 0, c: -1 }, { r: 0, c: 1 }  // Left, Right
    ];
    const boardState = board.getState(); // Get current state
    const rows = boardState.length;
    const cols = boardState[0].length;


    for (const dir of directions) {
        const nextR = row + dir.r;
        const nextC = col + dir.c;

        // Basic bounds check
        if (nextR >= 0 && nextR < rows && nextC >= 0 && nextC < cols) {
             // Basic check: allow move to empty square or opponent square (capture logic comes later)
             const targetSquareData = board.getSquareData(nextR, nextC);
             const targetPiece = targetSquareData ? targetSquareData.piece : null;
             if (!targetPiece || targetPiece.player !== currentPlayer) {
                 moves.push({ r: nextR, c: nextC });
             }
        }
    }
    return moves;
}

/**
 * Highlights squares representing valid moves.
 */
function highlightValidMoves(moves) {
    moves.forEach(move => {
        highlightSquare(move.r, move.c, 'valid-move');
    });
}


// --- Export necessary functions ---
export { initGame }; // Only need to export initGame from main.js