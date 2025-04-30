// js/game.js
import { Board } from './board.js';
import { Piece } from './piece.js';
import {
    renderBoard, highlightSquare, clearHighlights, updateStatus,
    renderCapturedPieces, addMoveToHistory, clearMoveHistory, playSound,
    updateTurnDisplay, updateAiDepthDisplay
} from './renderer.js';
import { loadLanguage, getString, applyLocalizationToPage } from './localization.js';
import {
    Player, GameStatus, aiPlayer, DEFAULT_AI_TARGET_DEPTH,
    DEFAULT_AI_TIME_LIMIT_MS, MIN_AI_TIME_LIMIT_MS, PIECES,
    ANIMATION_DURATION, getPieceKey
} from './constants.js';
import * as rules from './rules.js'; // Import all rule functions

// --- Module State ---
let board = new Board();
let currentPlayer = Player.PLAYER0;
let selectedPieceInfo = null; // { piece: Piece, row: number, col: number }
let gameStatus = GameStatus.INIT;
let validMovesCache = []; // Array of {row, col} for selected piece
let isGameOver = false;
let isAiThinking = false;
let aiWorker = null;
let lastMove = null; // { start: {r, c}, end: {r, c} }
let capturedByPlayer0 = []; // Pieces captured by Blue (originally Red)
let capturedByPlayer1 = []; // Pieces captured by Red (originally Blue)
let moveHistory = []; // Store move data objects for potential replay/undo later?

// UI Elements (Cached)
let difficultySelect;
let timeLimitInput;
let resetButton;
let langSelect;
let gameModeSelect; // Keep reference if needed
let aiControlsContainer;

// AI Config
let aiTargetDepth = DEFAULT_AI_TARGET_DEPTH;
let aiTimeLimitMs = DEFAULT_AI_TIME_LIMIT_MS;

// --- AI Worker Interaction ---

function initializeAiWorker() {
    if (aiWorker) {
        console.log("[Main] Terminating previous AI Worker.");
        aiWorker.terminate();
    }
    try {
        // Path relative to where HTML is served from
        aiWorker = new Worker('js/aiWorker.js');
        console.log("[Main] AI Worker created successfully.");

        aiWorker.onmessage = handleAiWorkerMessage;
        aiWorker.onerror = handleAiWorkerError;

    } catch (e) {
        console.error("Failed to create AI Worker:", e);
        updateStatus('errorWorkerInit', {}, true);
        // Handle game state - maybe declare player winner?
        setGameOver(Player.PLAYER0, GameStatus.PLAYER0_WINS); // Player wins if AI fails
    }
}

function handleAiWorkerMessage(e) {
    console.log('[Main] Message received from AI Worker:', e.data);
    isAiThinking = false; // Stop thinking indicator

    const { move: bestMoveData, depthAchieved, nodes, eval: score, error } = e.data;

    // Update AI depth display regardless of move success
    updateAiDepthDisplay(depthAchieved ?? '?');

    if (error) {
        console.error("[Main] AI Worker reported error:", error);
        // Use specific error keys if available, otherwise generic
        const errorKey = error === "No moves available" ? 'errorAINoMoves' :
                         error === "Fallback piece missing" ? 'errorAIFallback' :
                         error === "Move gen error" ? 'errorAIMove' :
                         'errorAIWorker';
        updateStatus(errorKey, {}, true);
        setGameOver(Player.PLAYER0, GameStatus.PLAYER0_WINS); // Player wins on AI error
        playSound('victory');
        renderBoard(board.getState(), handleSquareClick, lastMove); // Re-render final state
        return;
    }

    if (bestMoveData) {
        // IMPORTANT: Find the piece on the *current* board instance, not from the worker data
        const pieceToMove = board.getPiece(bestMoveData.fromRow, bestMoveData.fromCol);
        const expectedPieceName = bestMoveData.pieceName; // Sent by worker

        if (pieceToMove && pieceToMove.player === aiPlayer && pieceToMove.name === expectedPieceName) {
            // AI move is valid and piece matches
            const targetPiece = board.getPiece(bestMoveData.toRow, bestMoveData.toCol);

            // Animate and make the move
            animateAndMakeMove(pieceToMove, bestMoveData.toRow, bestMoveData.toCol, bestMoveData.fromRow, bestMoveData.fromCol, targetPiece);

        } else {
            console.error("AI Error: Piece mismatch or missing!", { bestMoveData, pieceOnBoard: pieceToMove });
            updateStatus('errorAISync', {}, true); // Specific error message
            setGameOver(Player.PLAYER0, GameStatus.PLAYER0_WINS); // Player wins on sync error
            playSound('victory');
            renderBoard(board.getState(), handleSquareClick, lastMove);
        }
    } else {
        // AI worker returned no move, but no specific error? Assume no moves possible.
        console.error("AI Worker returned no valid move.");
        // Check if AI genuinely has no moves
        const allAiMoves = rules.getAllValidMoves(aiPlayer, board.getClonedStateForWorker());
        if (allAiMoves.length === 0) {
            updateStatus('errorAINoMoves', {}, true);
            setGameOver(Player.PLAYER0, GameStatus.PLAYER0_WINS); // Player wins if AI has no moves
            playSound('victory');
        } else {
            // Should not happen if worker is correct, but handle it
            updateStatus('errorAIMove', {}, true); // Generic AI move error
            setGameOver(Player.PLAYER0, GameStatus.PLAYER0_WINS);
            playSound('victory');
        }
         renderBoard(board.getState(), handleSquareClick, lastMove);
    }
}

function handleAiWorkerError(event) {
    console.error(`[Main] Error from AI Worker: Msg:${event.message}, File:${event.filename}, Line:${event.lineno}`, event);
    updateStatus('errorAIWorker', {}, true);
    isAiThinking = false;
    if (!isGameOver) {
        setGameOver(Player.PLAYER0, GameStatus.PLAYER0_WINS); // Player wins on worker error
        playSound('victory');
        renderBoard(board.getState(), handleSquareClick, lastMove);
    }
}


// --- Game Initialization ---

/** Initializes the game state and renders the initial board. */
export function initGame() {
    console.log("Initializing game...");
    // Cache UI elements
    difficultySelect = document.getElementById('difficulty');
    timeLimitInput = document.getElementById('time-limit');
    resetButton = document.getElementById('reset-button');
    langSelect = document.getElementById('lang-select');
    gameModeSelect = document.getElementById('game-mode');
    aiControlsContainer = document.getElementById('ai-controls');


    board = new Board();
    board.initBoard();
    currentPlayer = Player.PLAYER0;
    selectedPieceInfo = null;
    gameStatus = GameStatus.ONGOING;
    validMovesCache = [];
    isGameOver = false;
    isAiThinking = false;
    lastMove = null;
    capturedByPlayer0 = [];
    capturedByPlayer1 = [];
    moveHistory = [];

    // Reset UI elements
    updateAiDepthDisplay('0');
    if (difficultySelect) difficultySelect.value = aiTargetDepth.toString();
    if (timeLimitInput) timeLimitInput.value = aiTimeLimitMs;
    clearMoveHistory(); // Use renderer function

    // Initial render
    renderBoard(board.getState(), handleSquareClick); // Pass click handler
    renderCapturedPieces(capturedByPlayer0, capturedByPlayer1);
    updateGameStatusUI(); // Sets initial status message

    // Setup listeners (should only happen once ideally, maybe move outside initGame)
    setupUIListeners();

    // Initialize AI worker if not already done
    if (!aiWorker) {
        initializeAiWorker();
    } else if (isAiThinking) {
        // If resetting while AI is thinking, terminate and re-initialize
        console.log("[Main] Resetting during AI calculation, terminating worker.");
        aiWorker.terminate();
        initializeAiWorker();
    }

    console.log("Game Initialized. Player:", currentPlayer);
}

/** Sets up event listeners for UI controls. Called once. */
function setupUIListeners() {
    // Prevent adding listeners multiple times
    if (setupUIListeners.alreadyRun) return;
    setupUIListeners.alreadyRun = true;

    resetButton?.addEventListener('click', () => {
        // Optional: Add confirmation
        // if (confirm(getString('confirmReset'))) {
             initGame();
        // }
    });

    langSelect?.addEventListener('change', async (event) => {
        const newLang = event.target.value;
        await loadLanguage(newLang);
        applyLocalizationToPage(); // Update all static text
        // Update dynamic text elements
        renderCapturedPieces(capturedByPlayer0, capturedByPlayer1); // Update "None" text if needed
        updateGameStatusUI(); // Update status message and turn display
        // Re-render move history if piece names need translation? (Current setup uses images)
        // clearMoveHistory(); // Or update existing items if possible
        // moveHistory.forEach(move => addMoveToHistory(...)); // Re-add moves
    });

    difficultySelect?.addEventListener('change', (event) => {
        aiTargetDepth = parseInt(event.target.value, 10);
        console.log("AI Target Depth set to:", aiTargetDepth);
    });

    timeLimitInput?.addEventListener('change', (event) => {
        let v = parseInt(event.target.value, 10);
        if (isNaN(v) || v < MIN_AI_TIME_LIMIT_MS) {
            v = MIN_AI_TIME_LIMIT_MS;
            event.target.value = v; // Correct invalid input
        }
        aiTimeLimitMs = v;
        console.log("AI Time Limit set to:", aiTimeLimitMs, "ms");
    });

    gameModeSelect?.addEventListener('change', () => {
        const mode = gameModeSelect.value;
        aiControlsContainer.style.display = mode === 'PVA' ? 'flex' : 'none';
        // Reset game when mode changes
        initGame();
    });

    // Set initial AI controls visibility
    if (aiControlsContainer && gameModeSelect) {
         aiControlsContainer.style.display = gameModeSelect.value === 'PVA' ? 'flex' : 'none';
    }
}
setupUIListeners.alreadyRun = false; // Initialize flag


// --- Game Logic ---

/**
 * Main handler for clicks on board squares.
 * @param {number} row
 * @param {number} col
 */
function handleSquareClick(row, col) {
    console.log(`Clicked on: ${row}, ${col}`);
    if (isGameOver || isAiThinking || (gameModeSelect.value === 'PVA' && currentPlayer === aiPlayer)) {
        console.log("Ignoring click (Game Over, AI Thinking, or AI's turn)");
        return;
    }

    const clickedPiece = board.getPiece(row, col);

    if (selectedPieceInfo) {
        // Piece already selected, check if this is a valid move destination
        const isValidDestination = validMovesCache.some(move => move.row === row && move.col === col);

        if (isValidDestination) {
            const pieceToMove = selectedPieceInfo.piece;
            const fromRow = selectedPieceInfo.row;
            const fromCol = selectedPieceInfo.col;
            const targetPiece = board.getPiece(row, col); // Piece being potentially captured

            deselectPiece(); // Deselect before moving

            // Animate and make the move
            animateAndMakeMove(pieceToMove, row, col, fromRow, fromCol, targetPiece);

        } else {
            // Clicked somewhere else - deselect or select new piece
            const originalSelection = { ...selectedPieceInfo }; // Copy before deselecting
            deselectPiece();
            // If clicked on another piece of the current player (and not the same piece), select it
            if (clickedPiece && clickedPiece.player === currentPlayer && !(clickedPiece.row === originalSelection.row && clickedPiece.col === originalSelection.col)) {
                selectPiece(clickedPiece, row, col);
            } else {
                // Clicked empty square or opponent piece (not a valid move), just deselect
                 renderBoard(board.getState(), handleSquareClick, lastMove); // Re-render to remove highlights
                 updateGameStatusUI(); // Update status (e.g., back to "Select a piece")
            }
        }
    } else if (clickedPiece && clickedPiece.player === currentPlayer) {
        // No piece selected, and clicked on own piece - select it
        selectPiece(clickedPiece, row, col);
    } else {
         console.log("Clicked empty square or opponent piece without selection.");
         // Optional: Provide feedback? e.g., flash the square briefly?
    }
}

/**
 * Selects a piece and highlights its valid moves.
 * @param {Piece} piece
 * @param {number} row
 * @param {number} col
 */
function selectPiece(piece, row, col) {
    if (isGameOver || isAiThinking) return;

    deselectPiece(); // Ensure only one piece is selected

    selectedPieceInfo = { piece, row, col };
    validMovesCache = rules.getValidMovesForPiece(piece, row, col, board.getState()); // Use rules module

    // Highlight the selected piece
    highlightSquare(row, col, 'selected');

    // Highlight valid moves
    validMovesCache.forEach(move => {
        highlightSquare(move.row, move.col, 'possible-move');
        // Add capture highlight if opponent piece is there
        const targetPiece = board.getPiece(move.row, move.col);
        if (targetPiece && targetPiece.player !== currentPlayer) {
             highlightSquare(move.row, move.col, 'capture-move');
        }
    });

    console.log(`Selected: ${piece.name} at ${row},${col}. Valid moves:`, validMovesCache);
    updateGameStatusUI(); // Update status message
}

/** Clears piece selection and highlights. */
function deselectPiece() {
    if (selectedPieceInfo) {
        clearHighlights('selected');
        clearHighlights('possible-move');
        clearHighlights('capture-move');
        selectedPieceInfo = null;
        validMovesCache = [];
        console.log("Piece deselected.");
    }
}

/**
 * Updates the board state after a move or capture.
 * @param {Piece} piece - The piece that moved.
 * @param {number} toRow
 * @param {number} toCol
 * @param {number} fromRow
 * @param {number} fromCol
 * @param {Piece | null} capturedPiece - The piece that was captured (if any).
 */
function updateBoardState(piece, toRow, toCol, fromRow, fromCol, capturedPiece) {
    // Clear the 'from' square
    board.setPiece(fromRow, fromCol, null);
    // Place the piece in the 'to' square
    board.setPiece(toRow, toCol, piece); // setPiece updates piece's internal row/col

    // Update captured pieces list
    if (capturedPiece) {
        if (currentPlayer === Player.PLAYER0) { // Blue captured Red
            capturedByPlayer0.push(capturedPiece);
        } else { // Red captured Blue
            capturedByPlayer1.push(capturedPiece);
        }
        console.log(`${piece.name} captured ${capturedPiece.name}`);
    }

    // Update last move tracker
    lastMove = { start: { r: fromRow, c: fromCol }, end: { r: toRow, c: toCol } };
}

/**
 * Initiates the animation and updates state for a move.
 * @param {Piece} piece The piece object being moved.
 * @param {number} toRow Target row.
 * @param {number} toCol Target column.
 * @param {number} fromRow Starting row.
 * @param {number} fromCol Starting column.
 * @param {Piece | null} targetPiece The piece currently at the target square (null if empty).
 */
function animateAndMakeMove(piece, toRow, toCol, fromRow, fromCol, targetPiece) {
    if (isGameOver) return;

    const isCapture = targetPiece !== null && targetPiece.player !== piece.player;
    const capturedPieceData = isCapture ? { ...targetPiece } : null; // Store data before state change

    // --- Animation ---
    const boardElement = document.getElementById('board'); // Ensure we have the element
    const startSquare = boardElement?.querySelector(`.square[data-row="${fromRow}"][data-col="${fromCol}"]`);
    const endSquare = boardElement?.querySelector(`.square[data-row="${toRow}"][data-col="${toCol}"]`);
    const pieceElement = startSquare?.querySelector('.piece');

    if (!boardElement || !startSquare || !endSquare || !pieceElement) {
        console.warn("Animation elements not found, moving directly.");
        // Fallback: Update state directly without animation
        updateBoardState(piece, toRow, toCol, fromRow, fromCol, capturedPieceData);
        addMoveToHistory(piece, fromRow, fromCol, toRow, toCol, capturedPieceData);
        playSound(isCapture ? `capture_${capturedPieceData.type}` : 'move');
        postMoveChecks();
        return;
    }

    // Start animation indicator (optional, maybe update status)
    // updateStatus('statusAIMoving'); // Or just rely on visual

    const startRect = startSquare.getBoundingClientRect();
    const endRect = endSquare.getBoundingClientRect();
    const deltaX = endRect.left - startRect.left;
    const deltaY = endRect.top - startRect.top;

    // 1. Immediately update the logical board state
    updateBoardState(piece, toRow, toCol, fromRow, fromCol, capturedPieceData);

    // 2. Visually prepare for animation
    // Remove captured piece element *before* moving the attacker element
    const capturedElement = endSquare.querySelector('.piece');
    if (capturedElement && capturedElement !== pieceElement) {
         capturedElement.remove();
    }

    // Move the piece element to the target square in the DOM, but keep it visually at the start
    endSquare.appendChild(pieceElement);
    pieceElement.style.transition = 'none';
    // Translate relative to the piece's new parent (endSquare)
    pieceElement.style.transform = `translate(calc(-50% - ${deltaX}px), calc(-50% - ${deltaY}px))`;
    // Ensure transform is applied before transition starts
    pieceElement.offsetHeight; // Force reflow

    // 3. Start the transition
    requestAnimationFrame(() => {
        pieceElement.style.transition = `transform ${ANIMATION_DURATION / 1000}s ease-out`;
        pieceElement.style.transform = 'translate(-50%, -50%)';
    });

    // 4. After animation finishes
    setTimeout(() => {
        pieceElement.style.transition = 'none'; // Clean up

        // Log the move after animation
        addMoveToHistory(piece, fromRow, fromCol, toRow, toCol, capturedPieceData);

        // Play sound after animation
        playSound(isCapture ? `capture_${capturedPieceData.type}` : 'move');

        // Perform post-move checks (win condition, switch player)
        postMoveChecks();

    }, ANIMATION_DURATION);
}


/** Performs checks after a move is completed (win condition, switch player). */
function postMoveChecks() {
    // Re-render the board to reflect the final state after animation/move
    renderBoard(board.getState(), handleSquareClick, lastMove);
    renderCapturedPieces(capturedByPlayer0, capturedByPlayer1); // Update captured display

    // Check for game over
    const currentStatus = rules.getGameStatus(board.getState()); // Use rules module

    if (currentStatus !== GameStatus.ONGOING) {
        const winner = (currentStatus === GameStatus.PLAYER0_WINS) ? Player.PLAYER0 :
                       (currentStatus === GameStatus.PLAYER1_WINS) ? Player.PLAYER1 :
                       Player.NONE; // Handle draw if implemented
        setGameOver(winner, currentStatus);
        playSound(winner === Player.PLAYER0 ? 'victory' : 'defeat'); // Sound from Player 0's perspective
    } else {
        // Game continues, switch player
        switchPlayer();
    }
    updateGameStatusUI(); // Update status display
}

/** Switches the current player and triggers AI if necessary. */
function switchPlayer() {
    currentPlayer = Player.getOpponent(currentPlayer);
    deselectPiece(); // Deselect any previously selected piece
    console.log("Switched player to:", currentPlayer);

    // Trigger AI turn if it's AI's turn in PVA mode
    if (!isGameOver && gameModeSelect.value === 'PVA' && currentPlayer === aiPlayer && !isAiThinking) {
        setTimeout(triggerAiTurn, 250); // Small delay before AI starts thinking
    }
}

/** Sets the game to a finished state. */
function setGameOver(winner, status) {
    if (isGameOver) return; // Prevent setting multiple times
    console.log(`Game Over! Winner: ${winner}, Status: ${status}`);
    isGameOver = true;
    gameStatus = status;
    deselectPiece(); // Ensure no piece is selected
    // Optionally disable board interaction further? (already checked in handleSquareClick)
}

/** Updates the status message and turn indicator based on the game state. */
function updateGameStatusUI() {
    let statusKey = 'statusLoading'; // Default/initial
    let statusParams = {};
    const playerLabel = getString(currentPlayer === Player.PLAYER0 ? 'player1Name' : 'player2Name'); // Get localized name P1/P2

    if (isGameOver) {
        statusKey = 'statusGameOver';
         let winnerLabel = '';
         if (gameStatus === GameStatus.PLAYER0_WINS) winnerLabel = getString('player1Name');
         else if (gameStatus === GameStatus.PLAYER1_WINS) winnerLabel = getString('player2Name');
         else winnerLabel = getString('statusDraw'); // Or handle draw specifically

         // Combine "Game Over!" and "Winner is..."
         // We might need a combined key or handle it here:
         statusElement.textContent = `${getString('statusGameOver')} ${getString('statusWin', { winner: winnerLabel })}`;
         turnElement.textContent = '---'; // Clear turn indicator
         return; // Don't override with other statuses

    } else if (isAiThinking) {
        statusKey = 'statusAIThinking';
        statusParams = { aiName: getString('aiName') };
    } else if (selectedPieceInfo) {
        statusKey = 'statusPlayerSelected';
        statusParams = { player: playerLabel, pieceName: selectedPieceInfo.piece.name };
    } else {
        statusKey = 'statusWaitingPlayer';
        statusParams = { player: playerLabel };
    }

    updateStatus(statusKey, statusParams);
    updateTurnDisplay(currentPlayer, gameModeSelect.value);
}


/** Initiates the AI's turn by sending data to the worker. */
function triggerAiTurn() {
    if (isGameOver || isAiThinking || currentPlayer !== aiPlayer || !aiWorker) {
        return;
    }

    console.log("Triggering AI move...");
    isAiThinking = true;
    updateGameStatusUI(); // Show "AI is thinking..."
    updateAiDepthDisplay('-'); // Reset depth display

    // Get a clone of the board state suitable for the worker
    let boardStateForWorker;
    try {
        boardStateForWorker = board.getClonedStateForWorker();
        // Optional: Deep log to verify structure if worker has issues
        // console.log("Board state for worker:", JSON.stringify(boardStateForWorker));
    } catch (e) {
        console.error("Error cloning board state for AI:", e);
        updateStatus('errorBoardClone', {}, true);
        isAiThinking = false;
        setGameOver(Player.PLAYER0, GameStatus.PLAYER0_WINS); // Player wins if board clone fails
        playSound('victory');
        return;
    }

    const currentTargetDepth = aiTargetDepth; // Use the module variable
    const currentTimeLimit = aiTimeLimitMs; // Use the module variable
    console.log(boardStateForWorker);
    console.log(`[Main] Sending job to AI Worker: Depth=${currentTargetDepth}, TimeLimit=${currentTimeLimit}ms`); // Log the actual values

    aiWorker.postMessage({
        boardState: boardStateForWorker,
        targetDepth: currentTargetDepth, // Pass the correct variable
        timeLimit: currentTimeLimit      // Pass the correct variable
    });
}
function triggerAiMove() {
    if (gameMode !== 'PVA' || currentPlayer !== AI || isAnimating || gameOver || isAiCalculating ) return;
    if (!aiWorker) { console.error("AI Worker not initialized!"); updateStatus("AI Worker Error!"); if (!gameOver) { gameOver = true; winner = PLAYER; playSound('victory'); renderBoard(); } return; } // Play sound on error

    isAiCalculating = true;
    updateStatus("AI is thinking...");
    aiDepthElement.textContent = '-';

    const currentTargetDepth = parseInt(difficultySelect.value, 10);
    const currentTimeLimit = aiTimeLimitMs;

    let boardStateToSend;
    try { boardStateToSend = JSON.parse(JSON.stringify(board)); }
    catch(e) { console.error("Board clone error:", e); updateStatus("AI Error!"); isAiCalculating = false; if (!gameOver) { gameOver = true; winner = PLAYER; playSound('victory'); renderBoard();} return; } // Play sound on error

     console.log(`[Main] Sending job: D=${currentTargetDepth}, T=${currentTimeLimit}ms`);
     aiWorker.postMessage({ boardState: boardStateToSend, targetDepth: currentTargetDepth, timeLimit: currentTimeLimit });
}