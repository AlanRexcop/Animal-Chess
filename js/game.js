// js/game.js
import { Board } from './board.js';
// Import highlight functions from renderer
import { renderBoard, highlightSquare, clearHighlights } from './renderer.js';
import { Player, AnimalRanks } from './constants.js'; // Added AnimalRanks if needed by Piece setup

// Import rules later when needed for valid moves
import * as rules from './rules.js';
// import { getValidMovesForPiece } from './rules.js';
// Import rules functions

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
    console.log(board)
    renderBoard(board.getState(), handleSquareClick);
    updateStatus();
    console.log("Game Initialized. Player 1's Turn.");
}

// --- Updated handleSquareClick ---
function handleSquareClick(row, col) {
    if (gameStatus !== 'Ongoing') return;

    // Use board methods that return piece and terrain directly if available
    const clickedPiece = board.getPiece(row, col);
    const clickedTerrain = board.getTerrain(row, col); // Needed for canCapture

    if (selectedPiece) {
        // === CASE 1: A piece is already selected ===
        const startRow = selectedPiece.row;
        const startCol = selectedPiece.col;
        const pieceToMove = selectedPiece.piece; // The actual piece object

        if (startRow === row && startCol === col) {
            // 1a: Clicked the *same* selected piece -> Deselect
            deselectPiece();
        } else if (clickedPiece && clickedPiece.player === currentPlayer) {
            // 1b: Clicked *another* friendly piece -> Switch selection
            // Deselect first (clears highlights) then select the new one
            deselectPiece();
            selectPiece(clickedPiece, row, col); // Select the NEW piece
        } else {
            // 1c: Clicked an empty square or an opponent's piece -> Try to move/capture

            // Check if the target square is among the valid moves calculated when selecting
            const isMoveTargetValid = validMoves.some(move => move.r === row && move.c === col);

            if (isMoveTargetValid) {
                // Target square is reachable based on getValidMovesForPiece calculation
                if (!clickedPiece) {
                    // -- Moving to an Empty Square --
                    console.log(`Moving ${pieceToMove.type} from ${startRow},${startCol} to ${row},${col}`);
                    movePiece(startRow, startCol, row, col);
                    // movePiece should handle deselect, render, switchPlayer, checkGameEnd
                } else {
                    // -- Attempting to Capture Opponent Piece --
                    console.log(`Attempting to capture ${clickedPiece.type} at ${row},${col} with ${pieceToMove.type}`);

                    // *** IMPORTANT: Pass targetTerrain to canCapture ***
                    if (rules.canCapture(pieceToMove, clickedPiece, clickedTerrain)) { // Pass terrain!
                         capturePiece(startRow, startCol, row, col);
                         // capturePiece should handle deselect, render, switchPlayer, checkGameEnd
                    } else {
                        // Cannot capture (e.g., Elephant vs Rat, wrong rank, maybe trap immunity etc.)
                        console.log("Capture failed: Rules violation.");
                        // Provide feedback - keep selection active
                        updateStatus(`Invalid capture: ${pieceToMove.type} cannot capture ${clickedPiece.type} here.`);
                         // Return early to prevent overwriting status message
                         return;
                    }
                }
            } else {
                 // Clicked square is not in the pre-calculated validMoves list
                 console.log("Clicked square is not a valid move destination.");
                 // Optional: Deselect if clicking invalid square?
                 // deselectPiece();
            }
        }
    } else {
        // === CASE 2: No piece is currently selected ===
        if (clickedPiece && clickedPiece.player === currentPlayer) {
            // 2a: Clicked a friendly piece -> Select it
            selectPiece(clickedPiece, row, col);
        }
        // 2b: Clicked empty / opponent -> Do nothing
    }

    // Update general status (e.g., "Player X's turn") if no specific message was set
    // Consider making updateStatus check if a specific message was just shown
    // Or refactor movePiece/capturePiece/failure cases to set the final status.
    // For now, calling it might overwrite the "Invalid capture" message.
    // A better approach is to have movePiece/capturePiece call updateStatus *after* switching player.
    // Let's assume updateStatus() might be called inside movePiece/capturePiece instead.
    updateStatus(); // Maybe remove this general call or make it smarter
}
/**
 * Moves a piece on the board state.
 */
function movePiece(startRow, startCol, endRow, endCol) {
  const pieceToMove = board.getPiece(startRow, startCol);
  if (!pieceToMove) {
      console.error("Error: No piece found to move at", startRow, startCol);
      return;
  }

  // Update piece's internal coordinates IF THEY EXIST (optional but good practice)
  if (typeof pieceToMove.row !== 'undefined') pieceToMove.row = endRow;
  if (typeof pieceToMove.col !== 'undefined') pieceToMove.col = endCol;

  // Update board state
  board.setPiece(endRow, endCol, pieceToMove);
  board.setPiece(startRow, startCol, null);

  // Post-move actions
  const movedPieceType = pieceToMove.type; // Store before deselecting
  deselectPiece();
  renderBoard(board.getState(), handleSquareClick);
  // Check win condition here later
  // checkWinCondition();
  switchPlayer();
  updateStatus(`Player ${currentPlayer} moved ${movedPieceType}. Player ${Player.getOpponent(currentPlayer)}'s turn.`); // Use updated status
}

/**
* Handles the logic for capturing an opponent's piece.
*/
function capturePiece(startRow, startCol, targetRow, targetCol) {
  const attackerPiece = board.getPiece(startRow, startCol);
  const defenderPiece = board.getPiece(targetRow, targetCol);

  if (!attackerPiece || !defenderPiece) {
      console.error("Error: Missing attacker or defender for capture.");
      return;
  }

  const attackerType = attackerPiece.type; // Store before deselecting
  const defenderType = defenderPiece.type; // Store before deselecting

  console.log(`${attackerType} (P${attackerPiece.player}) captures ${defenderType} (P${defenderPiece.player}) at ${targetRow},${targetCol}`);

  // Update piece's internal coordinates IF THEY EXIST
  if (typeof attackerPiece.row !== 'undefined') attackerPiece.row = targetRow;
  if (typeof attackerPiece.col !== 'undefined') attackerPiece.col = targetCol;

  // Update board state
  board.setPiece(targetRow, targetCol, attackerPiece); // Attacker moves to target square
  board.setPiece(startRow, startCol, null);        // Attacker leaves original square

  // Add captured piece to a list later if needed

  // Post-capture actions
  deselectPiece();
  renderBoard(board.getState(), handleSquareClick);
  // Check win condition here later
  // checkWinCondition();
  switchPlayer();
  updateStatus(`Player ${currentPlayer} ${attackerType} captured ${defenderType}. Player ${Player.getOpponent(currentPlayer)}'s turn.`);
}

/**
 * Selects a piece and highlights it and its valid moves.
 */
// --- Updated selectPiece ---
function selectPiece(piece, row, col) {
    // Ensure we have the actual piece object
    if (!piece || !piece.type) {
        console.error("selectPiece called with invalid piece data:", piece);
        return;
    }

    selectedPiece = { piece: piece, row: row, col: col }; // Store the piece object
    console.log(`Selected ${piece.type} at ${row},${col}`);

    // Clear previous highlights
    clearHighlights('selected');
    clearHighlights('valid-move');

    // Highlight the selected piece's square
    highlightSquare(row, col, 'selected');

    // *** Calculate valid moves using the new function from rules.js ***
    // Pass the board instance and the piece object
    validMoves = rules.getValidMovesForPiece(board, piece);
    console.log(validMoves)

    // Highlight the calculated valid moves on the board
    highlightValidMoves(validMoves); // Assumes this function loops through validMoves and calls highlightSquare(m.r, m.c, 'valid-move')

    console.log("Calculated valid moves:", validMoves);
    updateStatus(`${piece.type} selected. Choose a move.`); // Update UI
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