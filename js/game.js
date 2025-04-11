// js/game.js

import { Board } from './board.js';
// --- MODIFIED IMPORTS ---
import {
    renderBoard,
    highlightSquare,
    clearHighlights,
    updateStatus as renderUpdateStatus, // Alias to avoid naming conflict
    renderCapturedPieces // Import function to render captured pieces
} from './renderer.js';
import { getString, loadLanguage } from './localization.js'; // Import localization functions
// --- END MODIFIED IMPORTS ---
import { Player, GameStatus, aiPlayer, aiDifficulty } from './constants.js';
import * as rules from './rules.js';
import { findBestMove } from './ai.js';

// --- Game State ---
let board = null;
let currentPlayer = Player.NONE;
let selectedPiece = null; // Stores { piece: Piece, row: number, col: number }
let gameStatus = GameStatus.INIT;
let validMoves = []; // Stores coordinates {r, c} of valid moves for the selected piece
let isGameOver = false;
let isAiThinking = false; // Flag to prevent clicks during AI turn
// --- NEW STATE VARIABLES ---
let lastMove = { start: null, end: null }; // To highlight the last move
let capturedByP1 = []; // Pieces Player 1 captured (type strings)
let capturedByP2 = []; // Pieces Player 2 captured (type strings)
// --- AI Configuration ---
const AI_PLAYER = Player.PLAYER2; // Or Player.PLAYER1 if AI plays first
const AI_DIFFICULTY = 3; // Search depth (adjust as needed)
const AI_DELAY = 500; // Milliseconds delay before AI moves (for UX)
// --- END NEW STATE VARIABLES ---

// --- Core Functions ---

/**
 * Initializes or resets the game to its starting state.
 */
function initGame() {
    console.log("Initializing game...");
    board = new Board();
    board.initBoard();
    currentPlayer = Player.PLAYER1;
    selectedPiece = null;
    validMoves = [];
    gameStatus = GameStatus.ONGOING;
    isGameOver = false;
    // --- RESET NEW STATE ---
    lastMove = { start: null, end: null };
    capturedByP1 = [];
    capturedByP2 = [];
    // --- END RESET NEW STATE ---

    // --- RENDER INITIAL STATE ---
    // Pass the click handler and lastMove (null initially) to renderBoard
    renderBoard(board.getState(), handleSquareClick, lastMove);
    // Update status using localization
    updateGameStatusUI(); // Use helper function to set initial status
    // Render empty captured pieces display
    renderCapturedPieces(capturedByP1, capturedByP2);
    // --- END RENDER INITIAL STATE ---

    // --- SETUP UI LISTENERS (Run once per full page load) ---
    // Check if listeners are already attached to prevent duplicates if initGame is called again for reset
    const resetButton = document.getElementById('reset-button');

    if (resetButton && !resetButton.hasAttribute('data-listener-attached')) {
        setupUIListeners();
        resetButton.setAttribute('data-listener-attached', 'true');
    }
    // Update button text on reset as well
    if(resetButton) resetButton.textContent = getString('resetButton');

    console.log("Game Initialized. Player 1's Turn.");
}

/**
 * Sets up event listeners for UI controls like reset and language selector.
 * Should ideally be called once when the page loads.
 */
function setupUIListeners() {
    console.log("Setting up UI listeners...");
    const resetButton = document.getElementById('reset-button');
    const langSelect = document.getElementById('lang-select');
    const langLabel = document.getElementById('lang-select-label'); // Optional label
    const h1TitleElement = document.getElementById('game-title');
    
    // Reset Button
    if (resetButton) {
        resetButton.textContent = getString('resetButton'); // Set initial text
        resetButton.addEventListener('click', initGame); // Re-run initGame on click
        console.log("Reset button listener attached.");
    } else {
        console.warn("Reset button not found.");
    }

    // Language Selector
    if (langSelect) {
         // Set initial label text
        if(langLabel) langLabel.textContent = getString('languageLabel');

        langSelect.addEventListener('change', async (event) => {
            const newLangCode = event.target.value;
            console.log(`Language change requested: ${newLangCode}`);
            const success = await loadLanguage(newLangCode);
            if (success) {
                console.log(`Language loaded: ${newLangCode}`);
                // Update all localizable UI elements
                try {
                    document.title = getString('gameTitle'); // Update browser tab title
                    if (h1TitleElement) {
                        h1TitleElement.textContent = getString('gameTitle'); // Update H1 heading
                    }
                 } catch(e) {
                     console.error("Error updating game titles:", e);
                 }
                if(resetButton) resetButton.textContent = getString('resetButton');
                if(langLabel) langLabel.textContent = getString('languageLabel');
                // Update the main game status message based on current state
                updateGameStatusUI();
                // Re-render captured pieces if their labels need localization
                renderCapturedPieces(capturedByP1, capturedByP2); // (If labels are localized)
                console.log("UI updated for new language.");
            } else {
                 console.error(`Failed to load language: ${newLangCode}`);
            }
        });
         console.log("Language selector listener attached.");
    } else {
         console.warn("Language selector not found.");
    }
}


/**
 * Handles clicks on squares of the game board.
 */
function handleSquareClick(row, col) {
    if (isGameOver || currentPlayer !== Player.getOpponent(AI_PLAYER) || isAiThinking) {
        console.log("Game is over or not player turn. Input ignored.");
        return;
    }

    const clickedPiece = board.getPiece(row, col);
    const clickedTerrain = board.getTerrain(row, col);

    if (selectedPiece) {
        // === CASE 1: A piece is already selected ===
        const startRow = selectedPiece.row;
        const startCol = selectedPiece.col;
        const pieceToMove = selectedPiece.piece;

        if (startRow === row && startCol === col) {
            // 1a: Clicked same piece -> Deselect
            deselectPiece();
            updateGameStatusUI(); // Update status back to 'Player X's Turn'
        } else if (clickedPiece && clickedPiece.player === currentPlayer) {
            // 1b: Clicked another friendly piece -> Switch selection
            deselectPiece(); // Clears highlights
            selectPiece(clickedPiece, row, col); // Updates status
        } else {
            // 1c: Clicked empty square or opponent piece -> Try move/capture
            const isMoveTargetValid = validMoves.some(move => move.r === row && move.c === col);

            if (isMoveTargetValid) {
                if (!clickedPiece) {
                    // -- Moving --
                    console.log(`Moving ${pieceToMove.type} from ${startRow},${startCol} to ${row},${col}`);
                    // Optional: Status update *before* move logic?
                    // renderUpdateStatus('statusMoved', { player: currentPlayer, animal: pieceToMove.type });
                    movePiece(startRow, startCol, row, col); // Handles next steps
                } else {
                    // -- Capturing --
                    console.log(`Attempting capture: ${pieceToMove.type} on ${clickedPiece.type}`);
                    if (rules.canCapture(pieceToMove, clickedPiece, clickedTerrain)) {
                         // Optional: Status update *before* capture logic?
                         // renderUpdateStatus('statusCaptured', { player: currentPlayer, attackerAnimal: pieceToMove.type, defenderAnimal: clickedPiece.type });
                         capturePiece(startRow, startCol, row, col); // Handles next steps
                    } else {
                        console.log("Invalid capture attempt.");
                        // --- USE LOCALIZED STATUS ---
                        renderUpdateStatus('statusInvalidCapture', { attackerAnimal: pieceToMove.type, defenderAnimal: clickedPiece.type });
                        // Keep piece selected, don't proceed further in this click handler
                        return;
                    }
                }
            } else {
                 console.log("Invalid destination clicked.");
                 // --- USE LOCALIZED STATUS ---
                 // Maybe provide feedback, or just ignore the click
                 renderUpdateStatus('statusInvalidMove'); // Generic invalid move message
                 // Consider deselecting here if preferred UX
                 // deselectPiece();
                 // updateGameStatusUI();
            }
        }
    } else {
        // === CASE 2: No piece selected ===
        if (clickedPiece && clickedPiece.player === currentPlayer) {
            // 2a: Clicked friendly piece -> Select it
            selectPiece(clickedPiece, row, col); // SelectPiece updates status
        }
        // 2b: Clicked empty / opponent -> Do nothing (or maybe provide 'Select a piece' feedback)
        else if (!clickedPiece) {
            // Optionally provide feedback if clicking empty square with nothing selected
             updateGameStatusUI(); // Ensure status shows 'Player X turn'
        }
    }
    // Status is generally updated within selectPiece, movePiece, capturePiece, switchPlayer now
}

/**
 * Selects a piece, calculates its valid moves, and updates UI.
 */
function selectPiece(piece, row, col) {
    if (!piece || !piece.type) {
        console.error("selectPiece called with invalid piece data:", piece);
        return;
    }
    selectedPiece = { piece: piece, row: row, col: col };
    console.log(`Selected ${piece.type} at ${row},${col}`);

    clearHighlights('selected');
    clearHighlights('valid-move');
    highlightSquare(row, col, 'selected');

    // Calculate and highlight valid moves
    validMoves = rules.getValidMovesForPiece(board, piece);
    highlightValidMoves(validMoves);
    console.log("Calculated valid moves:", validMoves);

    // --- USE LOCALIZED STATUS ---
    renderUpdateStatus('statusSelected', { animal: piece.type });
}

/**
 * Deselects the piece and clears highlights.
 */
function deselectPiece() {
    selectedPiece = null;
    validMoves = [];
    clearHighlights('selected');
    clearHighlights('valid-move');
    console.log("Piece deselected, highlights cleared.");
    // Status will be updated by the calling function (e.g., switchPlayer or initGame)
}

/**
 * Moves a piece on the board state and handles post-move updates.
 */
function movePiece(startRow, startCol, endRow, endCol) {
    const pieceToMove = board.getPiece(startRow, startCol);
    if (!pieceToMove) return;

    // --- TRACK LAST MOVE ---
    lastMove = { start: { r: startRow, c: startCol }, end: { r: endRow, c: endCol } };
    // --- END TRACK LAST MOVE ---

    // Update piece internal coords & board state
    if (typeof pieceToMove.row !== 'undefined') pieceToMove.row = endRow;
    if (typeof pieceToMove.col !== 'undefined') pieceToMove.col = endCol;
    board.setPiece(endRow, endCol, pieceToMove);
    board.setPiece(startRow, startCol, null);

    // Post-move actions
    const movedAnimal = pieceToMove.type; // Store before deselecting
    const movingPlayer = currentPlayer;   // Store before switching

    deselectPiece();
    // --- RENDER WITH LAST MOVE ---
    renderBoard(board.getState(), handleSquareClick, lastMove);
    // --- END RENDER WITH LAST MOVE ---

    // Optional: Update status *after* rendering the move
    // renderUpdateStatus('statusMoved', { player: movingPlayer, animal: movedAnimal });

    checkGameEndAndUpdate(); // Checks win/draw, switches player if ongoing
}

/**
 * Handles piece capture, updates state, and UI.
 */
function capturePiece(startRow, startCol, targetRow, targetCol) {
    const attackerPiece = board.getPiece(startRow, startCol);
    const defenderPiece = board.getPiece(targetRow, targetCol);
    if (!attackerPiece || !defenderPiece) return;

    const attackerType = attackerPiece.type;
    const defenderType = defenderPiece.type;
    const capturingPlayer = currentPlayer; // Store before switching

    // --- ADD TO CAPTURED LIST ---
    if (currentPlayer === Player.PLAYER1) {
        capturedByP1.push(defenderType);
    } else {
        capturedByP2.push(defenderType);
    }
    // --- END ADD TO CAPTURED LIST ---

    // --- TRACK LAST MOVE ---
    lastMove = { start: { r: startRow, c: startCol }, end: { r: targetRow, c: targetCol } };
    // --- END TRACK LAST MOVE ---


    // Update piece internal coords & board state
    if (typeof attackerPiece.row !== 'undefined') attackerPiece.row = targetRow;
    if (typeof attackerPiece.col !== 'undefined') attackerPiece.col = targetCol;
    board.setPiece(targetRow, targetCol, attackerPiece);
    board.setPiece(startRow, startCol, null);

    deselectPiece();
    // --- RENDER WITH LAST MOVE & CAPTURED ---
    renderBoard(board.getState(), handleSquareClick, lastMove);
    renderCapturedPieces(capturedByP1, capturedByP2); // Update captured display
    // --- END RENDER ---

    // Optional: Update status *after* rendering the capture
    // renderUpdateStatus('statusCaptured', { player: capturingPlayer, attackerAnimal: attackerType, defenderAnimal: defenderType });


    checkGameEndAndUpdate(); // Checks win/draw, switches player if ongoing
}

/**
 * Checks for game end conditions, updates status, or switches player.
 */
function checkGameEndAndUpdate() {
    const newStatus = rules.getGameStatus(board);
    gameStatus = newStatus;

    if (gameStatus !== GameStatus.ONGOING) {
        isGameOver = true;
        updateGameStatusUI(); // Display win/draw message
        console.log(`Game Over! Status: ${gameStatus}`);
    } else {
        switchPlayer(); // Switches player and updates status for next turn
    }
}

/**
 * Switches the current player and updates the status message.
 */
function switchPlayer() {
    currentPlayer = (currentPlayer === Player.PLAYER1) ? Player.PLAYER2 : Player.PLAYER1;
    // Deselect piece automatically on turn switch? Usually yes.
    if (selectedPiece) {
      deselectPiece();
    }
    updateGameStatusUI(); // Update to show the new player's turn
    console.log(`Turn switched. Player ${currentPlayer}'s Turn.`);
    if (currentPlayer === AI_PLAYER) {
        triggerAiTurn();
    }
}
/**
 * Initiates the AI's turn.
 */
function triggerAiTurn() {
    if (isGameOver || isAiThinking) {
        return; // Don't trigger if game over or already thinking
    }

    isAiThinking = true;
    // (Optional: Disable board clicks here if you want explicit disabling)
    // e.g., document.getElementById('board').style.pointerEvents = 'none';

    // Update status to show AI is thinking (add 'ai_thinking' key to lang files)
    renderUpdateStatus('ai_thinking');

    // Use setTimeout to allow the UI to update and add a small delay
    setTimeout(() => {
        // --- Core AI Call ---
        const bestMove = findBestMove(board, AI_PLAYER, AI_DIFFICULTY);

        // --- Process AI Move ---
        if (bestMove && !isGameOver) { // Check isGameOver again in case something changed
            // Get the actual piece object from the board (needed for move/capture functions)
            const pieceToMove = board.getPiece(bestMove.startRow, bestMove.startCol);

            if (pieceToMove) {
                // Determine if it's a capture or a simple move
                const targetSquare = board.getSquareData(bestMove.endRow, bestMove.endCol);
                const isCapture = targetSquare.piece !== null; // Check if destination has a piece
                isAiThinking = false;
                // --- Reuse existing move/capture functions ---
                // These functions already handle board update, rendering,
                // game end checks, and switching the player *back* to human.
                if (isCapture) {
                    console.log(`AI Action: Capturing with ${pieceToMove.type} at (${bestMove.endRow}, ${bestMove.endCol})`);
                    capturePiece(bestMove.startRow, bestMove.startCol, bestMove.endRow, bestMove.endCol);
                } else {
                    console.log(`AI Action: Moving ${pieceToMove.type} to (${bestMove.endRow}, ${bestMove.endCol})`);
                    movePiece(bestMove.startRow, bestMove.startCol, bestMove.endRow, bestMove.endCol);
                }
                 // NOTE: finalizeMoveAndUpdate() will be called inside movePiece/capturePiece,
                 // which will switch the player back to human and update the status.

            } else {
                console.error("AI Error: Could not find piece on board for the best move:", bestMove);
                isAiThinking = false; // Reset flag on error
                // Maybe switch back to human or declare an AI error?
                 switchPlayer();
                 updateGameStatusUI()
            }

        } else if (!bestMove) {
            console.warn("AI could not find a valid move (Stalemate or Error).");
            // Handle stalemate? For now, just let the turn pass back?
            isAiThinking = false; // Reset flag
             switchPlayer(); // Switch back to human
             updateGameStatusUI() // Update status for human turn
        }

        // (Optional: Re-enable board clicks if you disabled them earlier)
        // e.g., document.getElementById('board').style.pointerEvents = 'auto';
        // The isAiThinking flag is reset within finalizeMoveAndUpdate when it becomes human turn.

    }, AI_DELAY); // Wait before executing the AI move
}

/**
 * Helper function to update the main status UI element based on the current game state.
 * Uses localization keys.
 */
function updateGameStatusUI() {
    let statusKey = '';
    let params = {};

    if (isGameOver) {
        const winnerPlayerNum = (gameStatus === GameStatus.P1_WINS) ? 1 : (gameStatus === GameStatus.P2_WINS) ? 2 : null;
        if (winnerPlayerNum) {
             // Need to determine *how* they won for the correct message, rules.getGameStatus might need to return more info
             // For now, let's use a generic win message or assume capture (needs refinement)
            statusKey = 'winMessageCapture'; // Or 'winMessageDen' - needs logic to differentiate
            params = {
                player: winnerPlayerNum,
                color: getString(winnerPlayerNum === 1 ? 'player1Color' : 'player2Color')
            };
        } else if (gameStatus === GameStatus.DRAW) { // Assuming DRAW exists in GameStatus
            statusKey = 'drawMessage';
        } else {
             statusKey = 'Game Over'; // Fallback if status is weird
        }
    } else if (gameStatus === GameStatus.ONGOING) {
        if (selectedPiece) {
             // Status is updated in selectPiece function directly
             return; // Don't overwrite the "Selected X" message
        } else {
            // Default turn message
            statusKey = 'playerTurn';
            params = {
                player: currentPlayer,
                color: getString(currentPlayer === Player.PLAYER1 ? 'player1Color' : 'player2Color')
            };
        }
    } else {
        // Initial state or other?
        statusKey = 'statusSelecting'; // Default prompt
    }

    if (statusKey) {
        renderUpdateStatus(statusKey, params);
    }
}


/**
 * Highlights squares representing valid moves. (Helper function)
 */
function highlightValidMoves(moves) {
    moves.forEach(move => {
        highlightSquare(move.r, move.c, 'valid-move');
    });
}

// --- Export necessary functions ---
// Only initGame needs to be exported to be called by main.js
export { initGame };