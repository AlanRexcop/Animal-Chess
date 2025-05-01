// js/game.js
import { Board } from './board.js';
import { Piece } from './piece.js';
import {
    renderBoard, highlightSquare, clearHighlights, updateStatus,
    renderCapturedPieces, addMoveToHistory, clearMoveHistory, playSound,
    updateTurnDisplay,
    updateAiDepthDisplay,
    updateWinChanceDisplay // <-- Import new function
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
let capturedByPlayer0 = []; // Pieces captured by Blue (Player 0)
let capturedByPlayer1 = []; // Pieces captured by Red (Player 1)
let moveHistory = [];
let lastEvalScore = null; // <-- Store the last evaluation score

// UI Elements (Cached)
let difficultySelect;
let timeLimitInput;
let resetButton;
let langSelect;
let gameModeSelect;
let aiControlsContainer;

// AI Config
let aiTargetDepth = DEFAULT_AI_TARGET_DEPTH;
let aiTimeLimitMs = DEFAULT_AI_TIME_LIMIT_MS;

// --- AI Worker Interaction ---

function initializeAiWorker() {
    if (aiWorker) {
        console.log("[Main] Terminating previous AI Worker.");
        aiWorker.terminate();
        aiWorker = null;
    }
    try {
        aiWorker = new Worker('js/aiWorker.js', { type: 'module' });
        console.log("[Main] AI Worker created successfully (as module).");
        aiWorker.onmessage = handleAiWorkerMessage;
        aiWorker.onerror = handleAiWorkerError;
    } catch (e) {
        console.error("Failed to create AI Worker:", e);
        updateStatus('errorWorkerInit', {}, true);
        setGameOver(Player.PLAYER0, GameStatus.PLAYER0_WINS);
        updateWinChanceDisplay(null); // Clear win chance on error
    }
}

function handleAiWorkerMessage(e) {
    console.log('[Main] Message received from AI Worker:', e.data);
    isAiThinking = false;

    const { move: bestMoveData, depthAchieved, nodes, eval: score, error } = e.data;

    updateAiDepthDisplay(depthAchieved ?? '?');

    // Store the evaluation score IF it's valid
    if (score !== null && score !== undefined && isFinite(score)) {
         lastEvalScore = score;
         console.log(`[Main] Received Eval: ${lastEvalScore}`);
    } else if (!error) { // Don't clear score if it was just an error finding a move
        lastEvalScore = null; // Reset if AI returns invalid score without error
    }
    // Update display immediately after receiving score
    updateWinChanceDisplay(lastEvalScore);


    if (error) {
        console.error("[Main] AI Worker reported error:", error);
        const errorKey = error === "No moves available" ? 'errorAINoMoves' :
                         error === "Fallback piece missing" ? 'errorAIFallback' :
                         error === "Move gen error" ? 'errorAIMove' :
                         'errorAIWorker';
        updateStatus(errorKey, {}, true);
        setGameOver(Player.PLAYER0, GameStatus.PLAYER0_WINS); // Player wins on AI error
        // Win chance is already updated or cleared above
        playSound('victory');
        renderBoard(board.getState(), handleSquareClick, lastMove);
        return;
    }

    if (bestMoveData) {
        const pieceToMove = board.getPiece(bestMoveData.fromRow, bestMoveData.fromCol);
        const expectedPieceName = bestMoveData.pieceName;

        if (pieceToMove && pieceToMove.player === aiPlayer && pieceToMove.name === expectedPieceName) {
            const targetPiece = board.getPiece(bestMoveData.toRow, bestMoveData.toCol);
            animateAndMakeMove(pieceToMove, bestMoveData.toRow, bestMoveData.toCol, bestMoveData.fromRow, bestMoveData.fromCol, targetPiece);
            // Note: Win chance display updated above when message arrived
        } else {
            console.error("AI Error: Piece mismatch or missing!", { bestMoveData, pieceOnBoard: pieceToMove });
            updateStatus('errorAISync', {}, true);
            setGameOver(Player.PLAYER0, GameStatus.PLAYER0_WINS);
            playSound('victory');
            renderBoard(board.getState(), handleSquareClick, lastMove);
        }
    } else {
        console.error("AI Worker returned no valid move.");
        const allAiMoves = rules.getAllValidMoves(aiPlayer, board.getClonedStateForWorker());
        if (allAiMoves.length === 0) {
            updateStatus('errorAINoMoves', {}, true);
            setGameOver(Player.PLAYER0, GameStatus.PLAYER0_WINS);
            playSound('victory');
        } else {
            updateStatus('errorAIMove', {}, true);
            setGameOver(Player.PLAYER0, GameStatus.PLAYER0_WINS);
            playSound('victory');
        }
         renderBoard(board.getState(), handleSquareClick, lastMove);
         // Win chance already updated above
    }
}

function handleAiWorkerError(event) {
    console.error(`[Main] Error from AI Worker: Msg:${event.message}, File:${event.filename}, Line:${event.lineno}`, event);
    updateStatus('errorAIWorker', {}, true);
    isAiThinking = false;
    lastEvalScore = null; // Reset eval score on worker error
    updateWinChanceDisplay(lastEvalScore); // Update display to calculating/error state
    if (!isGameOver) {
        setGameOver(Player.PLAYER0, GameStatus.PLAYER0_WINS);
        playSound('victory');
        renderBoard(board.getState(), handleSquareClick, lastMove);
    }
}


// --- Game Initialization ---

/** Initializes the game state and renders the initial board. */
export function initGame() {
    console.log("Initializing game...");
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
    lastEvalScore = null; // <-- Reset score on init

    updateAiDepthDisplay('0');
    if (difficultySelect) difficultySelect.value = aiTargetDepth.toString();
    if (timeLimitInput) timeLimitInput.value = aiTimeLimitMs;
    clearMoveHistory();

    renderBoard(board.getState(), handleSquareClick);
    renderCapturedPieces(capturedByPlayer0, capturedByPlayer1);
    updateGameStatusUI();
    updateWinChanceDisplay(lastEvalScore); // <-- Update display on init

    setupUIListeners();

    if (!aiWorker) {
        initializeAiWorker();
    } else if (isAiThinking) {
        console.log("[Main] Resetting during AI calculation, terminating worker.");
        aiWorker.terminate();
        initializeAiWorker();
    }

    console.log("Game Initialized. Player:", currentPlayer);
}

/** Sets up event listeners for UI controls. Called once. */
function setupUIListeners() {
    if (setupUIListeners.alreadyRun) return;
    setupUIListeners.alreadyRun = true;

    resetButton?.addEventListener('click', () => {
        initGame();
    });

    langSelect?.addEventListener('change', async (event) => {
        const newLang = event.target.value;
        await loadLanguage(newLang);
        applyLocalizationToPage();
        renderCapturedPieces(capturedByPlayer0, capturedByPlayer1);
        updateGameStatusUI();
        updateWinChanceDisplay(lastEvalScore); // Update display on language change
    });

    difficultySelect?.addEventListener('change', (event) => {
        aiTargetDepth = parseInt(event.target.value, 10);
        console.log("AI Target Depth set to:", aiTargetDepth);
    });

    timeLimitInput?.addEventListener('change', (event) => {
        let v = parseInt(event.target.value, 10);
        if (isNaN(v) || v < MIN_AI_TIME_LIMIT_MS) {
            v = MIN_AI_TIME_LIMIT_MS;
            event.target.value = v;
        }
        aiTimeLimitMs = v;
        console.log("AI Time Limit set to:", aiTimeLimitMs, "ms");
    });

    gameModeSelect?.addEventListener('change', () => {
        const mode = gameModeSelect.value;
        aiControlsContainer.style.display = mode === 'PVA' ? 'flex' : 'none';
        initGame();
    });

    if (aiControlsContainer && gameModeSelect) {
         aiControlsContainer.style.display = gameModeSelect.value === 'PVA' ? 'flex' : 'none';
    }
}
setupUIListeners.alreadyRun = false;


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
        const isValidDestination = validMovesCache.some(move => move.row === row && move.col === col);

        if (isValidDestination) {
            const pieceToMove = selectedPieceInfo.piece;
            const fromRow = selectedPieceInfo.row;
            const fromCol = selectedPieceInfo.col;
            const targetPiece = board.getPiece(row, col);

            deselectPiece();
            animateAndMakeMove(pieceToMove, row, col, fromRow, fromCol, targetPiece);
            // Win chance will be updated when AI responds to this move

        } else {
            const originalSelection = { ...selectedPieceInfo };
            deselectPiece();
            if (clickedPiece && clickedPiece.player === currentPlayer && !(clickedPiece.row === originalSelection.row && clickedPiece.col === originalSelection.col)) {
                selectPiece(clickedPiece, row, col);
            } else {
                 renderBoard(board.getState(), handleSquareClick, lastMove);
                 updateGameStatusUI();
            }
        }
    } else if (clickedPiece && clickedPiece.player === currentPlayer) {
        selectPiece(clickedPiece, row, col);
    } else {
         console.log("Clicked empty square or opponent piece without selection.");
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
    deselectPiece();
    selectedPieceInfo = { piece, row, col };
    validMovesCache = rules.getValidMovesForPiece(piece, row, col, board.getState());

    highlightSquare(row, col, 'selected');
    validMovesCache.forEach(move => {
        highlightSquare(move.row, move.col, 'possible-move');
        const targetPiece = board.getPiece(move.row, move.col);
        if (targetPiece && targetPiece.player !== currentPlayer) {
             highlightSquare(move.row, move.col, 'capture-move');
        }
    });
    console.log(`Selected: ${piece.name} at ${row},${col}. Valid moves:`, validMovesCache);
    updateGameStatusUI();
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
    board.setPiece(fromRow, fromCol, null);
    board.setPiece(toRow, toCol, piece);

    if (capturedPiece) {
        if (currentPlayer === Player.PLAYER0) {
            capturedByPlayer0.push(capturedPiece);
        } else {
            capturedByPlayer1.push(capturedPiece);
        }
        console.log(`${piece.name} captured ${capturedPiece.name}`);
    }
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
    const capturedPieceData = isCapture ? { ...targetPiece } : null;

    const boardElement = document.getElementById('board');
    const startSquare = boardElement?.querySelector(`.square[data-row="${fromRow}"][data-col="${fromCol}"]`);
    const endSquare = boardElement?.querySelector(`.square[data-row="${toRow}"][data-col="${toCol}"]`);
    const pieceElement = startSquare?.querySelector('.piece');

    if (!boardElement || !startSquare || !endSquare || !pieceElement) {
        console.warn("Animation elements not found, moving directly.");
        updateBoardState(piece, toRow, toCol, fromRow, fromCol, capturedPieceData);
        addMoveToHistory(piece, fromRow, fromCol, toRow, toCol, capturedPieceData);
        playSound(isCapture ? `capture_${getPieceKey(capturedPieceData.name)}` : 'move');
        postMoveChecks();
        return;
    }

    const startRect = startSquare.getBoundingClientRect();
    const endRect = endSquare.getBoundingClientRect();
    const deltaX = endRect.left - startRect.left;
    const deltaY = endRect.top - startRect.top;

    updateBoardState(piece, toRow, toCol, fromRow, fromCol, capturedPieceData);

    const capturedElement = endSquare.querySelector('.piece');
    if (capturedElement && capturedElement !== pieceElement) {
         capturedElement.remove();
    }

    endSquare.appendChild(pieceElement);
    pieceElement.style.transition = 'none';
    pieceElement.style.transform = `translate(calc(-50% - ${deltaX}px), calc(-50% - ${deltaY}px))`;
    pieceElement.offsetHeight;

    requestAnimationFrame(() => {
        pieceElement.style.transition = `transform ${ANIMATION_DURATION / 1000}s ease-out`;
        pieceElement.style.transform = 'translate(-50%, -50%)';
    });

    setTimeout(() => {
        pieceElement.style.transition = 'none';
        addMoveToHistory(piece, fromRow, fromCol, toRow, toCol, capturedPieceData);
        playSound(isCapture ? `capture_${getPieceKey(capturedPieceData.name)}` : 'move');
        postMoveChecks(); // Check win, switch player AFTER animation
    }, ANIMATION_DURATION);
}


/** Performs checks after a move is completed (win condition, switch player). */
function postMoveChecks() {
    renderBoard(board.getState(), handleSquareClick, lastMove);
    renderCapturedPieces(capturedByPlayer0, capturedByPlayer1);

    const currentStatus = rules.getGameStatus(board.getState());

    if (currentStatus !== GameStatus.ONGOING) {
        const winner = (currentStatus === GameStatus.PLAYER0_WINS) ? Player.PLAYER0 :
                       (currentStatus === GameStatus.PLAYER1_WINS) ? Player.PLAYER1 :
                       Player.NONE;
        setGameOver(winner, currentStatus); // Set game over state first

        let soundToPlay = 'defeat';
        if (winner === Player.PLAYER0) soundToPlay = 'victory';
        if (winner === Player.NONE) soundToPlay = 'draw';
        if (gameModeSelect.value === 'PVP' && winner !== Player.NONE) soundToPlay = 'victory';

        playSound(soundToPlay);
        updateGameStatusUI(); // Update UI AFTER setting game over
        // No need to update win chance here, it becomes irrelevant

    } else {
        switchPlayer(); // Switch player if game is not over
        updateGameStatusUI(); // Update status for the new turn
        // Win chance remains from the last AI calculation until AI moves again
    }
}

/** Switches the current player and triggers AI if necessary. */
function switchPlayer() {
    currentPlayer = Player.getOpponent(currentPlayer);
    deselectPiece();
    console.log("Switched player to:", currentPlayer);

    if (!isGameOver && gameModeSelect.value === 'PVA' && currentPlayer === aiPlayer && !isAiThinking) {
        // Don't reset eval score here, wait for AI response
        setTimeout(triggerAiTurn, 250);
    }
}

/** Sets the game to a finished state. */
function setGameOver(winner, status) {
    if (isGameOver) return;
    console.log(`Game Over! Winner: ${winner}, Status: ${status}`);
    isGameOver = true;
    gameStatus = status; // Store the final status
    deselectPiece();
    // Don't reset lastEvalScore here, let the final UI update show the last known state if needed
}

/** Updates the status message and turn indicator based on the game state. */
function updateGameStatusUI() {
    let statusKey = 'statusLoading';
    let statusParams = {};
    const playerLabel = getString(currentPlayer === Player.PLAYER0 ? 'player1Name' : 'player2Name');

    if (isGameOver) {
        let winnerLabel = '';
        if (gameStatus === GameStatus.PLAYER0_WINS) winnerLabel = getString('player1Name');
        else if (gameStatus === GameStatus.PLAYER1_WINS) winnerLabel = getString('player2Name');
        else winnerLabel = getString('statusDraw');
        statusKey = 'statusWin';
        statusParams = { winner: winnerLabel };
    } else if (isAiThinking) {
        statusKey = 'statusAIThinking';
        statusParams = { aiName: getString('aiName') };
    } else if (selectedPieceInfo) {
        statusKey = 'statusPlayerSelected';
        statusParams = {
            player: playerLabel,
            pieceName: getString(`animal_${selectedPieceInfo.piece.type}`) || selectedPieceInfo.piece.name
        };
    } else {
        statusKey = 'statusWaitingPlayer';
        statusParams = { player: playerLabel };
    }

    updateStatus(statusKey, statusParams);
    updateTurnDisplay(currentPlayer, gameModeSelect.value, isGameOver);
}


/** Initiates the AI's turn by sending data to the worker. */
function triggerAiTurn() {
    if (isGameOver || isAiThinking || currentPlayer !== aiPlayer || !aiWorker) {
        return;
    }
    console.log("Triggering AI move...");
    isAiThinking = true;
    updateGameStatusUI(); // Show "AI is thinking..."
    updateAiDepthDisplay('-');
    // Don't update win chance here, wait for result

    let boardStateForWorker;
    try {
        boardStateForWorker = board.getClonedStateForWorker();
    } catch (e) {
        console.error("Error cloning board state for AI:", e);
        updateStatus('errorBoardClone', {}, true);
        isAiThinking = false;
        lastEvalScore = null; // Reset score
        updateWinChanceDisplay(lastEvalScore); // Update display
        setGameOver(Player.PLAYER0, GameStatus.PLAYER0_WINS);
        playSound('victory');
        return;
    }

    const currentTargetDepth = aiTargetDepth;
    const currentTimeLimit = aiTimeLimitMs;

    console.log(`[Main] Sending job to AI Worker: Depth=${currentTargetDepth}, TimeLimit=${currentTimeLimit}ms`);

    aiWorker.postMessage({
        boardState: boardStateForWorker,
        targetDepth: currentTargetDepth,
        timeLimit: currentTimeLimit
    });
}