// js/game.js
import { Board } from './board.js';
import { Piece } from './piece.js';
import * as rules from './rules.js';
import * as renderer from './renderer.js';
import * as ai from './ai.js';
import { Player, GameStatus, DEFAULT_AI_PLAYER, DEFAULT_AI_TARGET_DEPTH, DEFAULT_AI_TIME_LIMIT_MS, MIN_AI_TIME_LIMIT_MS, ANIMATION_DURATION } from './constants.js';
// ****** MODIFIED Import: Added toggleLanguage ******
import { getString, loadLanguage, getCurrentLanguage, toggleLanguage } from './localization.js';

// --- Game State Variables ---
let board = null;
let currentPlayer = Player.PLAYER0;
let selectedPiece = null;
let possibleMoves = [];
let gameStatus = GameStatus.INIT;
let isGameOver = false;
let winner = Player.NONE;
let isAnimating = false;
let isAiThinking = false;
let gameMode = 'PVA';
let aiPlayer = DEFAULT_AI_PLAYER;
let aiTargetDepth = DEFAULT_AI_TARGET_DEPTH;
let aiTimeLimitMs = DEFAULT_AI_TIME_LIMIT_MS;
let lastAiDepthAchieved = 0;
let currentZobristKey = 0n;

let moveHistoryLog = [];
let capturedByPlayer0 = [];
let capturedByPlayer1 = [];

// --- DOM Element References (cached after setupUIListeners) ---
let gameModeSelect, difficultySelect, timeLimitInput, resetButton, aiControlsContainer, langToggleButton;


/**
 * Initializes the game state, board, AI, and renders the initial view. Exported.
 */
export function initGame() {
    console.log("Initializing game...");
    isGameOver = false;
    isAnimating = false;
    isAiThinking = false;
    winner = Player.NONE;
    currentPlayer = Player.PLAYER0;
    selectedPiece = null;
    possibleMoves = [];
    moveHistoryLog = [];
    capturedByPlayer0 = [];
    capturedByPlayer1 = [];
    lastAiDepthAchieved = 0;

    board = new Board();

    if (typeof BigInt === 'function') {
        ai.initializeZobrist();
        currentZobristKey = ai.computeZobristKey(board, currentPlayer);
        console.log("Initial Zobrist Key:", currentZobristKey);
    } else {
        console.warn("BigInt not supported, Zobrist hashing disabled.");
        currentZobristKey = 0n;
    }

    gameStatus = GameStatus.ONGOING;

    // Get control elements refs if not already set
    gameModeSelect = gameModeSelect || document.getElementById('game-mode');
    difficultySelect = difficultySelect || document.getElementById('difficulty');
    timeLimitInput = timeLimitInput || document.getElementById('time-limit');
    resetButton = resetButton || document.getElementById('reset-button');
    aiControlsContainer = aiControlsContainer || document.getElementById('ai-controls');
    langToggleButton = langToggleButton || document.getElementById('lang-toggle-button'); // Get ref here too

    // Set initial control values from constants/state
    if (gameModeSelect) gameMode = gameModeSelect.value;
    aiPlayer = DEFAULT_AI_PLAYER;
    if (difficultySelect) aiTargetDepth = parseInt(difficultySelect.value, 10);
    if (timeLimitInput) aiTimeLimitMs = parseInt(timeLimitInput.value, 10);
    updateAiControlsVisibility();

    // Initial Render
    renderer.renderCoordinates();
    renderer.renderBoard(board, selectedPiece, possibleMoves);
    renderer.renderCapturedPieces(capturedByPlayer0, capturedByPlayer1);
    renderer.renderMoveHistory(moveHistoryLog);
    renderer.updateAiDepthDisplay(lastAiDepthAchieved);
    updateAllLocalizableElements(); // Update text based on initial language
    updateGameStatusUI(); // Set initial status message

    console.log("Game initialized. Player 0's turn.");
}

/**
 * Sets up event listeners for UI controls. Called once by main.js.
 */
export function setupUIListeners() {
    // Get references to all control elements
    gameModeSelect = document.getElementById('game-mode');
    difficultySelect = document.getElementById('difficulty');
    timeLimitInput = document.getElementById('time-limit');
    resetButton = document.getElementById('reset-button');
    aiControlsContainer = document.getElementById('ai-controls');
    // ****** Get Language Button Reference ******
    langToggleButton = document.getElementById('lang-toggle-button');

    if (!gameModeSelect || !difficultySelect || !timeLimitInput || !resetButton || !langToggleButton) { // Check lang button too
         console.error("Game Error: Control elements not found! Cannot set up listeners.");
         return;
    }

    // Game Mode Change
    gameModeSelect.addEventListener('change', (event) => {
        gameMode = event.target.value;
        console.log("Game Mode changed to:", gameMode);
        updateAiControlsVisibility();
        resetGame();
    });

    // AI Difficulty Change
    difficultySelect.addEventListener('change', (event) => {
        aiTargetDepth = parseInt(event.target.value, 10);
        console.log("AI Target Depth set to:", aiTargetDepth);
    });

    // AI Time Limit Change
    timeLimitInput.addEventListener('change', (event) => {
        let value = parseInt(event.target.value, 10);
        if (isNaN(value) || value < MIN_AI_TIME_LIMIT_MS) {
            value = MIN_AI_TIME_LIMIT_MS;
            event.target.value = value;
        }
        aiTimeLimitMs = value;
        console.log("AI Time Limit set to:", aiTimeLimitMs, "ms");
    });

    // Reset Button
    resetButton.addEventListener('click', resetGame);

    // ****** Language Toggle Button Listener ******
    langToggleButton.addEventListener('click', async () => {
        const success = await toggleLanguage(); // Attempt to toggle and load
        if (success) {
            updateAllLocalizableElements(); // Update UI text if load was successful
        } else {
            console.error("Failed to switch language.");
            // Optionally show an error message to the user
        }
    });
    // ******************************************

    // Board Click Listener (using delegation via renderer)
    renderer.addBoardEventListeners(handleSquareClick);

    updateAllLocalizableElements(); // Set initial text for buttons etc.
}

/** Resets the game state and UI */
function resetGame() {
     console.log("Resetting game...");
     // Ensure controls are reset to defaults visually if needed before init
     if (difficultySelect) difficultySelect.value = DEFAULT_AI_TARGET_DEPTH.toString();
     if (timeLimitInput) timeLimitInput.value = DEFAULT_AI_TIME_LIMIT_MS.toString();
     if (gameModeSelect) gameModeSelect.value = 'PVA'; // Default mode?
     initGame();
}

/** Updates visibility of AI-specific controls based on game mode */
function updateAiControlsVisibility() {
    if (aiControlsContainer) {
        aiControlsContainer.style.display = (gameMode === 'PVA') ? 'flex' : 'none';
    }
}

/** Update UI elements that depend on loaded language */
function updateAllLocalizableElements() {
     console.log("Updating localizable elements for lang:", getCurrentLanguage());
     document.title = getString('gameTitle');
     const h1 = document.querySelector('h1');
     if(h1) h1.textContent = getString('gameTitle');

     if(resetButton) resetButton.textContent = getString('resetButton');

     // ****** Update Language Button Text ******
     // Set text to the language it will SWITCH TO
     if(langToggleButton) {
         const nextLang = getCurrentLanguage() === 'en' ? 'vn' : 'en';
         langToggleButton.textContent = getString(nextLang === 'en' ? 'switchToEn' : 'switchToVn');
     }
     // ****************************************

     const modeLabel = document.querySelector('label[for="game-mode"]');
     if(modeLabel) modeLabel.textContent = getString('gameModeLabel');
     const diffLabel = document.getElementById('ai-difficulty-control')?.querySelector('label');
     if(diffLabel) diffLabel.textContent = getString('aiDifficultyLabel');
     const timeLabel = document.getElementById('ai-time-limit-control')?.querySelector('label');
     if(timeLabel) timeLabel.textContent = getString('aiTimeLimitLabel');
     const depthAchievedSpan = document.querySelector('.ai-info');
     if (depthAchievedSpan) {
         const labelPart = getString('aiDepthAchievedLabel');
         for(const node of depthAchievedSpan.childNodes) {
             if (node.nodeType === Node.TEXT_NODE) {
                 node.textContent = `${labelPart} `;
                 break;
             }
         }
     }

     if (gameModeSelect) {
         const pvaOption = gameModeSelect.querySelector('option[value="PVA"]');
         if (pvaOption) pvaOption.textContent = getString('gameModePVA');
         const pvpOption = gameModeSelect.querySelector('option[value="PVP"]');
         if (pvpOption) pvpOption.textContent = getString('gameModePVP');
     }

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
    if (isGameOver || isAnimating || (gameMode === 'PVA' && currentPlayer === aiPlayer)) {
        return;
    }

    const clickedSquare = board.getSquareData(row, col);
    if (!clickedSquare) return;

    const clickedPiece = clickedSquare.piece;

    if (selectedPiece) {
        if (possibleMoves.some(move => move.row === row && move.col === col)) {
            const pieceToMove = selectedPiece.piece;
            const fromRow = selectedPiece.row;
            const fromCol = selectedPiece.col;
            makeMove(pieceToMove, fromRow, fromCol, row, col);
        } else {
            const previouslySelectedRow = selectedPiece.row;
            const previouslySelectedCol = selectedPiece.col;
            deselectPiece();
            if (clickedPiece && clickedPiece.player === currentPlayer) {
                if(!(row === previouslySelectedRow && col === previouslySelectedCol)){
                    selectPiece(row, col);
                } else {
                     renderer.renderBoard(board, null, []);
                     updateGameStatusUI();
                }
            } else {
                 renderer.renderBoard(board, null, []);
                 updateGameStatusUI();
            }
        }
    } else {
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

    deselectPiece();

    selectedPiece = { piece, row, col };
    possibleMoves = rules.getPossibleMoves(piece, row, col, board);

    renderer.renderBoard(board, selectedPiece, possibleMoves);
    updateGameStatusUI();
}

/** Clears the current piece selection and highlights. */
function deselectPiece() {
    if (selectedPiece) {
        selectedPiece = null;
        possibleMoves = [];
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

    const targetPiece = board.getPiece(toRow, toCol);
    const capturedPiece = targetPiece ? new Piece(targetPiece.type, targetPiece.player, targetPiece.row, targetPiece.col) : null;
    const movedPieceForHash = new Piece(piece.type, piece.player, piece.row, piece.col);

    isAnimating = true;
    deselectPiece();
    renderer.renderBoard(board, null, []);
    // updateGameStatusUI(); // Status updated by renderer check

    await renderer.animateMove(fromRow, fromCol, toRow, toCol, ANIMATION_DURATION);

    // --- Update Board State ---
    piece.setPosition(toRow, toCol);
    board.setPiece(toRow, toCol, piece);
    board.setPiece(fromRow, fromCol, null);

    if (capturedPiece) {
        if (piece.player === Player.PLAYER0) {
            capturedByPlayer0.push(capturedPiece);
        } else {
            capturedByPlayer1.push(capturedPiece);
        }
    }

    if (typeof BigInt === 'function' && currentZobristKey !== 0n) {
         currentZobristKey = ai.updateZobristKey(currentZobristKey, currentPlayer, movedPieceForHash, fromRow, fromCol, toRow, toCol, capturedPiece);
    }

    moveHistoryLog.push({ piece: piece, fromRow, fromCol, toRow, toCol, capturedPiece });

    isAnimating = false;

    renderer.renderBoard(board, null, []);
    renderer.renderCapturedPieces(capturedByPlayer0, capturedByPlayer1);
    renderer.renderMoveHistory(moveHistoryLog);

    checkGameEndAndUpdate();
}


/** Checks win conditions and updates game state, then switches player if game is still on. */
function checkGameEndAndUpdate() {
    const currentStatus = rules.checkGameStatus(board);

    if (currentStatus !== GameStatus.ONGOING) {
        isGameOver = true;
        gameStatus = currentStatus;
        if (currentStatus === GameStatus.PLAYER0_WINS) winner = Player.PLAYER0;
        else if (currentStatus === GameStatus.PLAYER1_WINS) winner = Player.PLAYER1;
        else winner = Player.NONE;

        console.log(`Game Over! Winner: ${winner === Player.NONE ? 'Draw' : `Player ${winner}`}`);
        updateGameStatusUI();

    } else {
        switchPlayer();
    }
}

/** Switches the current player and triggers AI if necessary. */
function switchPlayer() {
    if (isGameOver) return;
    currentPlayer = Player.getOpponent(currentPlayer);
    updateGameStatusUI();
    if (gameMode === 'PVA' && currentPlayer === aiPlayer && !isGameOver) {
        triggerAiTurn();
    }
}

/** Updates the status message and turn indicator based on game state. */
function updateGameStatusUI() {
     renderer.updateTurnIndicator(currentPlayer, gameMode, isGameOver);

     let messageKey = 'statusSelecting';
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
     } else if (isAiThinking) { // Check isAiThinking before isAnimating
         messageKey = 'statusAIThinking';
         params = { color: getString(aiPlayer === Player.PLAYER0 ? 'player0Color' : 'player1Color') };
     } else if (isAnimating) {
         // Let renderer handle this or define a key like 'statusAnimating'
          messageKey = 'statusAnimating'; // Add this key to JSON if needed
          params = {};
     } else if (selectedPiece) {
         messageKey = 'statusMoving';
         params.pieceName = selectedPiece.piece.name; // Piece names aren't localized here, but could be
     } // else 'statusSelecting' is default

     renderer.updateStatus(messageKey, params);
}

/** Initiates the AI's turn calculation. */
function triggerAiTurn() {
    if (gameMode !== 'PVA' || currentPlayer !== aiPlayer || isAnimating || isGameOver || isAiThinking) {
        return;
    }

    isAiThinking = true;
    lastAiDepthAchieved = 0;
    renderer.updateAiDepthDisplay(lastAiDepthAchieved);
    updateGameStatusUI(); // Show "AI is thinking..."

    setTimeout(() => {
        try {
            const aiResult = ai.findBestMove(board, aiPlayer, aiTargetDepth, aiTimeLimitMs);
            isAiThinking = false;
            lastAiDepthAchieved = aiResult.depthAchieved;
            renderer.updateAiDepthDisplay(lastAiDepthAchieved);

            if (aiResult.move && aiResult.move.piece) {
                 const pieceOnBoard = board.getPiece(aiResult.move.fromRow, aiResult.move.fromCol);
                 if (pieceOnBoard && pieceOnBoard.type === aiResult.move.piece.type && pieceOnBoard.player === aiResult.move.piece.player) {
                     makeMove(pieceOnBoard, aiResult.move.fromRow, aiResult.move.fromCol, aiResult.move.toRow, aiResult.move.toCol);
                 } else {
                      console.error("AI Error: Piece mismatch after search!", { aiMove: aiResult.move, boardPiece: pieceOnBoard });
                      handleAiErrorOrNoMove("statusAIError");
                 }
            } else {
                 console.error("AI Error: AI did not return a valid move.");
                 // Check if it was genuinely no moves or an error during search
                 const possibleAiMoves = rules.getAllPossibleMovesForPlayer(board, aiPlayer);
                 if (possibleAiMoves.length === 0) {
                     handleAiErrorOrNoMove("statusAINoMoves");
                 } else {
                    handleAiErrorOrNoMove("statusAIError"); // Assume error if moves existed but none returned
                 }
            }
        } catch (error) {
            isAiThinking = false;
            console.error("AI Error: Exception during AI move calculation:", error);
            handleAiErrorOrNoMove("statusAIError");
        }
    }, 50);
}

/** Handles game over state when AI fails or has no moves */
function handleAiErrorOrNoMove(statusKey) {
     isGameOver = true;
     gameStatus = (aiPlayer === Player.PLAYER0) ? GameStatus.PLAYER1_WINS : GameStatus.PLAYER0_WINS;
     winner = Player.getOpponent(aiPlayer);
     renderer.updateStatus(statusKey, {color: getString(aiPlayer === Player.PLAYER0 ? 'player0Color' : 'player1Color')});
     renderer.updateTurnIndicator(currentPlayer, gameMode, isGameOver);
     renderer.renderBoard(board, null, []);
     console.log(`Game Over! Player ${winner} wins due to AI issue (${statusKey}).`);
}