// js/game.js
import { Board } from './board.js';
import { Piece } from './piece.js';
import * as rules from './rules.js';
import * as renderer from './renderer.js';
import * as ai from './ai.js';
import { Player, GameStatus, DEFAULT_AI_PLAYER, DEFAULT_AI_TARGET_DEPTH, DEFAULT_AI_TIME_LIMIT_MS, MIN_AI_TIME_LIMIT_MS, ANIMATION_DURATION } from './constants.js';
import { getString, loadLanguage, getCurrentLanguage } from './localization.js';

// --- Game State Variables ---
let board = null; // Board instance
let currentPlayer = Player.PLAYER0;
let selectedPiece = null; // { piece: Piece, row: number, col: number }
let possibleMoves = []; // Array of {row, col} for selected piece
let gameStatus = GameStatus.INIT;
let isGameOver = false;
let winner = Player.NONE;
let isAnimating = false; // Prevent input during animation
let isAiThinking = false; // Prevent input during AI calculation
let gameMode = 'PVA'; // 'PVA' or 'PVP'
let aiPlayer = DEFAULT_AI_PLAYER;
let aiTargetDepth = DEFAULT_AI_TARGET_DEPTH;
let aiTimeLimitMs = DEFAULT_AI_TIME_LIMIT_MS;
let lastAiDepthAchieved = 0;
let currentZobristKey = 0n; // Current board hash

// History and Captured Pieces
let moveHistoryLog = []; // Array of { piece, fromRow, fromCol, toRow, toCol, capturedPiece }
let capturedByPlayer0 = []; // Pieces captured BY Player 0 (Blue) - these are Player 1's (Red) pieces
let capturedByPlayer1 = []; // Pieces captured BY Player 1 (Red) - these are Player 0's (Blue) pieces

// --- DOM Element References (for controls) ---
let gameModeSelect, difficultySelect, timeLimitInput, resetButton, aiControlsContainer;


/**
 * Initializes the game state, board, AI, and renders the initial view. Exported.
 */
export function initGame() {
    console.log("Initializing game...");
    isGameOver = false;
    isAnimating = false;
    isAiThinking = false;
    winner = Player.NONE;
    currentPlayer = Player.PLAYER0; // Player 0 (Blue) starts
    selectedPiece = null;
    possibleMoves = [];
    moveHistoryLog = [];
    capturedByPlayer0 = [];
    capturedByPlayer1 = [];
    lastAiDepthAchieved = 0;

    // Create and initialize the board
    board = new Board(); // Creates state with pieces and terrain

    // Initialize AI (Zobrist)
    if (typeof BigInt === 'function') { // Only init if BigInt is supported
        ai.initializeZobrist();
        currentZobristKey = ai.computeZobristKey(board, currentPlayer);
        console.log("Initial Zobrist Key:", currentZobristKey);
    } else {
        console.warn("BigInt not supported, Zobrist hashing disabled.");
        currentZobristKey = 0n; // Or handle differently
    }


    gameStatus = GameStatus.ONGOING;

    // Get control elements (if not already done) - should be called after DOM loaded
    // This is called from main.js which waits for DOMContentLoaded
    gameModeSelect = document.getElementById('game-mode');
    difficultySelect = document.getElementById('difficulty');
    timeLimitInput = document.getElementById('time-limit');
    resetButton = document.getElementById('reset-button');
    aiControlsContainer = document.getElementById('ai-controls');


    // Set initial control values from constants/state
    gameMode = gameModeSelect.value; // Read initial mode
    aiPlayer = DEFAULT_AI_PLAYER; // AI is always P1 for now
    aiTargetDepth = parseInt(difficultySelect.value, 10);
    aiTimeLimitMs = parseInt(timeLimitInput.value, 10);
    updateAiControlsVisibility();


    // Initial Render
    renderer.renderCoordinates(); // Render A1, B2 etc. labels once
    renderer.renderBoard(board, selectedPiece, possibleMoves);
    renderer.renderCapturedPieces(capturedByPlayer0, capturedByPlayer1);
    renderer.renderMoveHistory(moveHistoryLog);
    renderer.updateAiDepthDisplay(lastAiDepthAchieved);
    updateGameStatusUI(); // Update status message and turn indicator

    console.log("Game initialized. Player 0's turn.");
}

/**
 * Sets up event listeners for UI controls. Called once by main.js.
 */
export function setupUIListeners() {
     // Get references again just in case initGame wasn't called yet, though it should be
    gameModeSelect = document.getElementById('game-mode');
    difficultySelect = document.getElementById('difficulty');
    timeLimitInput = document.getElementById('time-limit');
    resetButton = document.getElementById('reset-button');
    aiControlsContainer = document.getElementById('ai-controls');


    if (!gameModeSelect || !difficultySelect || !timeLimitInput || !resetButton) {
         console.error("Game Error: Control elements not found! Cannot set up listeners.");
         return;
    }

    // Game Mode Change
    gameModeSelect.addEventListener('change', (event) => {
        gameMode = event.target.value;
        console.log("Game Mode changed to:", gameMode);
        updateAiControlsVisibility();
        // Optionally reset the game when mode changes? Or just update UI?
         resetGame(); // Resetting seems safer
    });

    // AI Difficulty Change
    difficultySelect.addEventListener('change', (event) => {
        aiTargetDepth = parseInt(event.target.value, 10);
        console.log("AI Target Depth set to:", aiTargetDepth);
         // No reset needed, just affects next AI move
    });

    // AI Time Limit Change
    timeLimitInput.addEventListener('change', (event) => {
        let value = parseInt(event.target.value, 10);
        if (isNaN(value) || value < MIN_AI_TIME_LIMIT_MS) {
            value = MIN_AI_TIME_LIMIT_MS;
            event.target.value = value; // Correct input field if invalid
        }
        aiTimeLimitMs = value;
        console.log("AI Time Limit set to:", aiTimeLimitMs, "ms");
         // No reset needed
    });


    // Reset Button
    resetButton.addEventListener('click', resetGame);

    // Board Click Listener (using delegation via renderer)
    renderer.addBoardEventListeners(handleSquareClick);

    // Language Selector (Example - Assuming you add one like in original structure)
    // const langSelect = document.getElementById('lang-select');
    // if (langSelect) {
    //     langSelect.addEventListener('change', async (event) => {
    //         const langCode = event.target.value;
    //         await loadLanguage(langCode);
    //         // Update all localizable UI elements after language change
    //         updateAllLocalizableElements();
    //         // Re-render elements that depend on localized strings
    //         renderer.renderCapturedPieces(capturedByPlayer0, capturedByPlayer1);
    //         renderer.renderMoveHistory(moveHistoryLog);
    //         updateGameStatusUI();
    //     });
    // }

    updateAllLocalizableElements(); // Set initial text for buttons etc.
}

/** Resets the game state and UI */
function resetGame() {
     console.log("Resetting game...");
     initGame(); // Re-initialize everything
}

/** Updates visibility of AI-specific controls based on game mode */
function updateAiControlsVisibility() {
    if (aiControlsContainer) {
        aiControlsContainer.style.display = (gameMode === 'PVA') ? 'flex' : 'none';
    }
}

/** Update UI elements that depend on loaded language */
function updateAllLocalizableElements() {
     document.title = getString('gameTitle'); // Example: Update page title
     if(document.querySelector('h1')) document.querySelector('h1').textContent = getString('gameTitle'); // Update H1

     if(resetButton) resetButton.textContent = getString('resetButton');
     // Update labels for controls
     const modeLabel = document.querySelector('label[for="game-mode"]');
     if(modeLabel) modeLabel.textContent = getString('gameModeLabel');
     const diffLabel = document.getElementById('ai-difficulty-control')?.querySelector('label');
     if(diffLabel) diffLabel.textContent = getString('aiDifficultyLabel');
     const timeLabel = document.getElementById('ai-time-limit-control')?.querySelector('label');
     if(timeLabel) timeLabel.textContent = getString('aiTimeLimitLabel');
     const depthAchievedSpan = document.querySelector('.ai-info');
     if (depthAchievedSpan) {
         // Keep the number span separate
         const labelPart = getString('aiDepthAchievedLabel');
         // Find the text node before the span
         for(const node of depthAchievedSpan.childNodes) {
             if (node.nodeType === Node.TEXT_NODE) {
                 node.textContent = `${labelPart} `;
                 break;
             }
         }
     }

     // Update options in select dropdowns? (More complex, maybe not needed if values are stable)
     // Example: gameModeSelect options
     const pvaOption = gameModeSelect.querySelector('option[value="PVA"]');
     if (pvaOption) pvaOption.textContent = getString('gameModePVA');
     const pvpOption = gameModeSelect.querySelector('option[value="PVP"]');
     if (pvpOption) pvpOption.textContent = getString('gameModePVP');

     // Re-render components that show localized text
      renderer.renderCapturedPieces(capturedByPlayer0, capturedByPlayer1);
      renderer.renderMoveHistory(moveHistoryLog);
      updateGameStatusUI(); // Update status message and turn indicator
}


/**
 * Handles clicks on squares of the game board.
 * @param {number} row Clicked row index.
 * @param {number} col Clicked column index.
 */
function handleSquareClick(row, col) {
    // Ignore clicks if game over, animating, or AI turn in PVA mode
    if (isGameOver || isAnimating || (gameMode === 'PVA' && currentPlayer === aiPlayer && !isAiThinking /* allow clicks if AI is done thinking but not moved? No. */)) {
        return;
    }

    const clickedSquare = board.getSquareData(row, col);
    if (!clickedSquare) return; // Clicked outside board? Should not happen with delegation.

    const clickedPiece = clickedSquare.piece;

    if (selectedPiece) {
        // Piece already selected, check if clicked square is a valid move
        if (possibleMoves.some(move => move.row === row && move.col === col)) {
            // Valid move destination clicked
            const pieceToMove = selectedPiece.piece; // The actual piece object
            const fromRow = selectedPiece.row;
            const fromCol = selectedPiece.col;

            // Deselect first visually (will be re-rendered after move)
            // deselectPiece(); NO - do this *after* makeMove starts
            makeMove(pieceToMove, fromRow, fromCol, row, col);

        } else {
            // Clicked somewhere else - deselect or select another piece
            const previouslySelectedRow = selectedPiece.row;
            const previouslySelectedCol = selectedPiece.col;
            deselectPiece(); // Clear selection and highlights

            // If clicked on another piece of the current player, select it
            if (clickedPiece && clickedPiece.player === currentPlayer) {
                 // Avoid re-selecting the same piece immediately after deselecting
                if(!(row === previouslySelectedRow && col === previouslySelectedCol)){
                    selectPiece(row, col);
                } else {
                     renderer.renderBoard(board, null, []); // Re-render without selection
                     updateGameStatusUI();
                }
            } else {
                 // Clicked on empty square or opponent piece, just deselect is enough
                 renderer.renderBoard(board, null, []); // Re-render without selection
                 updateGameStatusUI();
            }
        }
    } else {
        // No piece selected, check if clicked on own piece
        if (clickedPiece && clickedPiece.player === currentPlayer) {
            selectPiece(row, col);
        }
    }
}

/**
 * Selects a piece and highlights its possible moves.
 * @param {number} row Row of the piece to select.
 * @param {number} col Column of the piece to select.
 */
function selectPiece(row, col) {
    if (isAnimating) return;
    const piece = board.getPiece(row, col);
    if (!piece || piece.player !== currentPlayer) return;

    // Deselect previous if any (shouldn't be needed with current flow, but safe)
    deselectPiece();

    selectedPiece = { piece, row, col };
    possibleMoves = rules.getPossibleMoves(piece, row, col, board);

    // Re-render board with highlights
    renderer.renderBoard(board, selectedPiece, possibleMoves);
    updateGameStatusUI(); // Update status message
}

/**
 * Clears the current piece selection and highlights.
 */
function deselectPiece() {
    if (selectedPiece) {
        selectedPiece = null;
        possibleMoves = [];
         // Don't re-render here, let the caller handle it or do it in handleSquareClick fallback
    }
}

/**
 * Executes a move, updates state, triggers animation and rendering.
 * @param {Piece} piece The piece object to move.
 * @param {number} fromRow Start row.
 * @param {number} fromCol Start column.
 * @param {number} toRow End row.
 * @param {number} toCol End column.
 */
async function makeMove(piece, fromRow, fromCol, toRow, toCol) {
    if (isGameOver || isAnimating || !piece || piece.player !== currentPlayer) {
        console.warn("Attempted invalid move execution:", {piece, fromRow, fromCol, toRow, toCol, currentPlayer, isGameOver, isAnimating});
        return;
    }

    const targetPiece = board.getPiece(toRow, toCol); // Piece being captured (if any)

    // --- Pre-computation for history/hash ---
    const capturedPiece = targetPiece ? new Piece(targetPiece.type, targetPiece.player, targetPiece.row, targetPiece.col) : null; // Clone for log
    const movedPieceForHash = new Piece(piece.type, piece.player, piece.row, piece.col); // Clone piece state *before* move for hash

    // --- Start Animation ---
    isAnimating = true;
    deselectPiece(); // Clear selection state now
    renderer.renderBoard(board, null, []); // Render board without selection/moves before animation
    updateGameStatusUI(); // Show "Moving..." or similar? (Handled by renderer check)

    await renderer.animateMove(fromRow, fromCol, toRow, toCol, ANIMATION_DURATION);

    // --- Update Board State (After Animation) ---
    // Must update piece's internal row/col BEFORE setting it on board
    piece.setPosition(toRow, toCol);
    board.setPiece(toRow, toCol, piece); // Place moving piece
    board.setPiece(fromRow, fromCol, null); // Clear original square

    if (capturedPiece) {
        if (piece.player === Player.PLAYER0) {
            capturedByPlayer0.push(capturedPiece);
        } else {
            capturedByPlayer1.push(capturedPiece);
        }
    }

     // --- Update Zobrist Key ---
     if (typeof BigInt === 'function' && currentZobristKey !== 0n) {
         currentZobristKey = ai.updateZobristKey(currentZobristKey, currentPlayer, movedPieceForHash, fromRow, fromCol, toRow, toCol, capturedPiece);
         // console.log("Zobrist Key After Move:", currentZobristKey); // Debug
     }

    // --- Update History Log ---
    moveHistoryLog.push({ piece: piece, fromRow, fromCol, toRow, toCol, capturedPiece });


    // --- Post-Move Updates (Render, Check Win, Switch Player) ---
    isAnimating = false; // Animation finished

    renderer.renderBoard(board, null, []); // Render final board state
    renderer.renderCapturedPieces(capturedByPlayer0, capturedByPlayer1);
    renderer.renderMoveHistory(moveHistoryLog);

    checkGameEndAndUpdate(); // Checks win condition and switches player if ongoing
}


/** Checks win conditions and updates game state, then switches player if game is still on. */
function checkGameEndAndUpdate() {
    const currentStatus = rules.checkGameStatus(board);

    if (currentStatus !== GameStatus.ONGOING) {
        isGameOver = true;
        gameStatus = currentStatus;
        if (currentStatus === GameStatus.PLAYER0_WINS) winner = Player.PLAYER0;
        else if (currentStatus === GameStatus.PLAYER1_WINS) winner = Player.PLAYER1;
        else winner = Player.NONE; // Draw

        console.log(`Game Over! Winner: ${winner === Player.NONE ? 'Draw' : `Player ${winner}`}`);
        updateGameStatusUI(); // Display final game over message

    } else {
        // Game is ongoing, switch player
        switchPlayer();
    }
}

/** Switches the current player and triggers AI if necessary. */
function switchPlayer() {
    if (isGameOver) return;

    currentPlayer = Player.getOpponent(currentPlayer);

     // Zobrist key already updated in makeMove which includes the turn switch bit flip

    updateGameStatusUI(); // Update turn indicator and status message

    // Trigger AI turn if applicable
    if (gameMode === 'PVA' && currentPlayer === aiPlayer && !isGameOver) {
        triggerAiTurn();
    }
}

/** Updates the status message and turn indicator based on game state. */
function updateGameStatusUI() {
     renderer.updateTurnIndicator(currentPlayer, gameMode, isGameOver);

     let messageKey = 'statusSelecting'; // Default
     let params = {
         playerName: getString(currentPlayer === Player.PLAYER0 ? 'player0Name' : (gameMode === 'PVP' ? 'player1Name' : 'player1NameAI')),
         color: getString(currentPlayer === Player.PLAYER0 ? 'player0Color' : 'player1Color')
     };

     if (isGameOver) {
         if (gameStatus === GameStatus.DRAW) {
             messageKey = 'statusDraw';
             params = {};
         } else {
             messageKey = 'statusGameOver';
             params = {
                 winnerName: getString(winner === Player.PLAYER0 ? 'player0Name' : (gameMode === 'PVP' ? 'player1Name' : 'player1NameAI')),
                 winnerColor: getString(winner === Player.PLAYER0 ? 'player0Color' : 'player1Color')
             };
         }
     } else if (isAnimating) {
         // Status during animation? Could override player turn message.
         // messageKey = 'statusAnimating'; // If needed
     } else if (isAiThinking) {
         messageKey = 'statusAIThinking';
         params = { color: getString(aiPlayer === Player.PLAYER0 ? 'player0Color' : 'player1Color') };
     } else if (selectedPiece) {
         messageKey = 'statusMoving';
         params.pieceName = selectedPiece.piece.name;
     } else {
         // Default 'statusSelecting' is fine
     }

     renderer.updateStatus(messageKey, params);
}

/** Initiates the AI's turn calculation. */
function triggerAiTurn() {
    if (gameMode !== 'PVA' || currentPlayer !== aiPlayer || isAnimating || isGameOver || isAiThinking) {
        return;
    }

    isAiThinking = true;
    lastAiDepthAchieved = 0; // Reset before AI runs
    renderer.updateAiDepthDisplay(lastAiDepthAchieved); // Show 0 while thinking
    updateGameStatusUI(); // Show "AI is thinking..."

    // Use setTimeout to allow UI update before potentially blocking AI calculation
    setTimeout(() => {
        try {
            const aiResult = ai.findBestMove(board, aiPlayer, aiTargetDepth, aiTimeLimitMs);

            isAiThinking = false; // Finished thinking

             // Update depth display *after* AI finishes
             lastAiDepthAchieved = aiResult.depthAchieved;
             renderer.updateAiDepthDisplay(lastAiDepthAchieved);


            if (aiResult.move && aiResult.move.piece) {
                // Double-check piece still exists on board before moving
                 const pieceOnBoard = board.getPiece(aiResult.move.fromRow, aiResult.move.fromCol);
                 if (pieceOnBoard && pieceOnBoard.type === aiResult.move.piece.type && pieceOnBoard.player === aiResult.move.piece.player) {
                      // Use the piece instance from the current board state for the move
                     makeMove(pieceOnBoard, aiResult.move.fromRow, aiResult.move.fromCol, aiResult.move.toRow, aiResult.move.toCol);
                 } else {
                      console.error("AI Error: Piece mismatch after search!", { aiMove: aiResult.move, boardPiece: pieceOnBoard });
                      handleAiErrorOrNoMove("statusAIError");
                 }

            } else {
                 console.error("AI Error: AI did not return a valid move.");
                 handleAiErrorOrNoMove("statusAINoMoves"); // Could be no moves or an error
            }
        } catch (error) {
            isAiThinking = false;
            console.error("AI Error: Exception during AI move calculation:", error);
            handleAiErrorOrNoMove("statusAIError");
        }
    }, 50); // Small delay to ensure UI updates
}

/** Handles game over state when AI fails or has no moves */
function handleAiErrorOrNoMove(statusKey) {
     isGameOver = true;
     gameStatus = (aiPlayer === Player.PLAYER0) ? GameStatus.PLAYER1_WINS : GameStatus.PLAYER0_WINS; // Opponent wins
     winner = Player.getOpponent(aiPlayer);
     renderer.updateStatus(statusKey, {color: getString(aiPlayer === Player.PLAYER0 ? 'player0Color' : 'player1Color')});
     renderer.updateTurnIndicator(currentPlayer, gameMode, isGameOver); // Update turn display to "---"
     renderer.renderBoard(board, null, []); // Final render
     console.log(`Game Over! Player ${winner} wins due to AI issue.`);
}