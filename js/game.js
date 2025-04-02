// js/game.js
import { Board } from './board.js';
// Import highlight functions from renderer
import { renderBoard, highlightSquare, clearHighlights } from './renderer.js';
import { Player, AnimalRanks } from './constants.js'; // Added AnimalRanks if needed by Piece setup

// Import rules later when needed for valid moves
import { isValidMoveStructure, canCapture } from './rules.js';
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

function handleSquareClick(row, col) {
  if (gameStatus !== 'Ongoing') return;

  const clickedSquareData = board.getSquareData(row, col);
  const clickedPiece = clickedSquareData ? clickedSquareData.piece : null;

  if (selectedPiece) {
      // === CASE 1: A piece is already selected ===
      const startRow = selectedPiece.row;
      const startCol = selectedPiece.col;

      if (startRow === row && startCol === col) {
          // 1a: Clicked the *same* selected piece -> Deselect
          deselectPiece();
      } else if (clickedPiece && clickedPiece.player === currentPlayer) {
          // 1b: Clicked *another* friendly piece -> Switch selection
          deselectPiece();
          selectPiece(clickedPiece, row, col);
      } else {
          // 1c: Clicked an empty square or an opponent's piece -> Try to move/capture

          // Check if the target square is among the valid moves calculated earlier
          const isMoveTargetValid = validMoves.some(move => move.r === row && move.c === col);

          if (isMoveTargetValid) {
              // Target square is potentially reachable (structurally and basic checks)
              if (!clickedPiece) {
                  // -- Moving to an Empty Square --
                  console.log(`Moving ${selectedPiece.piece.type} from ${startRow},${startCol} to ${row},${col}`);
                  movePiece(startRow, startCol, row, col);
                  // movePiece handles deselect, render, switchPlayer
              } else {
                  // -- Attempting to Capture Opponent Piece --
                  console.log(`Attempting to capture ${clickedPiece.type} at ${row},${col} with ${selectedPiece.piece.type}`);
                  if (canCapture(selectedPiece.piece, clickedPiece)) {
                       capturePiece(startRow, startCol, row, col);
                       // capturePiece handles deselect, render, switchPlayer
                  } else {
                      // Cannot capture (e.g., Elephant vs Rat, or lower rank)
                      console.log("Capture failed: Invalid rank interaction.");
                      // Optional: Provide feedback to the user via status bar?
                      // Don't move, don't deselect, let the user choose another valid move.
                       updateStatus(`Invalid capture: ${selectedPiece.piece.type} cannot capture ${clickedPiece.type}.`);
                       // Return early to prevent status override by the general updateStatus() call
                       return;
                  }
              }
          } else {
               // Clicked square is not a valid move destination for the selected piece
               console.log("Clicked square is not a valid move destination.");
               // Optional: Deselect if clicking invalid square? Or keep selection active?
               // deselectPiece(); // Uncomment to deselect on invalid click
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

  updateStatus(); // Update UI feedback (unless already updated in failed capture)
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
  const piece = board.getPiece(row, col);
  if (!piece) return moves; // No piece to move

  const directions = [ { r: -1, c: 0 }, { r: 1, c: 0 }, { r: 0, c: -1 }, { r: 0, c: 1 } ];

  for (const dir of directions) {
      const nextR = row + dir.r;
      const nextC = col + dir.c;

      // Use the basic structure check from rules.js
      if (isValidMoveStructure(row, col, nextR, nextC)) {
           const targetSquareData = board.getSquareData(nextR, nextC);
           const targetPiece = targetSquareData ? targetSquareData.piece : null;

           // Can move if square is empty OR contains an opponent piece
           // (Capture possibility is checked later by canCapture)
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