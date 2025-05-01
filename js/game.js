// js/game.js
import { Board } from './board.js';
import { Piece } from './piece.js';
import {
    renderBoard, highlightSquare, clearHighlights, updateStatus,
    renderCapturedPieces, addMoveToHistory, clearMoveHistory, playSound,
    updateTurnDisplay,
    updateAiDepthDisplay,
    updateWinChanceDisplay,
    initializeLandTilePatterns // <-- Import new function
} from './renderer.js';
import { loadLanguage, getString, applyLocalizationToPage } from './localization.js';
import {
    Player, GameStatus, aiPlayer, DEFAULT_AI_TARGET_DEPTH,
    DEFAULT_AI_TIME_LIMIT_MS, MIN_AI_TIME_LIMIT_MS, PIECES,
    ANIMATION_DURATION, getPieceKey
} from './constants.js';
import * as rules from './rules.js';

// --- (Module State variables remain the same) ---
let board = new Board();
let currentPlayer = Player.PLAYER0;
let selectedPieceInfo = null;
let gameStatus = GameStatus.INIT;
let validMovesCache = [];
let isGameOver = false;
let isAiThinking = false;
let aiWorker = null;
let lastMove = null;
let capturedByPlayer0 = [];
let capturedByPlayer1 = [];
let moveHistory = [];
let lastEvalScore = null;

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

// --- (AI Worker Interaction functions remain the same) ---
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
    }
}

function handleAiWorkerError(event) {
    console.error(`[Main] Error from AI Worker: Msg:${event.message}, File:${event.filename}, Line:${event.lineno}`, event);
    updateStatus('errorAIWorker', {}, true);
    isAiThinking = false;
    lastEvalScore = null;
    updateWinChanceDisplay(lastEvalScore);
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
    // ****** NEW: Initialize land tiles AFTER board state is ready ******
    initializeLandTilePatterns(board.getState());
    // ****** END NEW ******

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
    lastEvalScore = null;

    updateAiDepthDisplay('0');
    if (difficultySelect) difficultySelect.value = aiTargetDepth.toString();
    if (timeLimitInput) timeLimitInput.value = aiTimeLimitMs;
    clearMoveHistory();

    // Render board AFTER initializing land tiles
    renderBoard(board.getState(), handleSquareClick);
    renderCapturedPieces(capturedByPlayer0, capturedByPlayer1);
    updateGameStatusUI();
    updateWinChanceDisplay(lastEvalScore);

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

// --- (setupUIListeners, handleSquareClick, selectPiece, deselectPiece, updateBoardState, animateAndMakeMove, postMoveChecks, switchPlayer, setGameOver, updateGameStatusUI, triggerAiTurn functions remain the same) ---

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
        updateWinChanceDisplay(lastEvalScore);
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
        postMoveChecks();
    }, ANIMATION_DURATION);
}


function postMoveChecks() {
    renderBoard(board.getState(), handleSquareClick, lastMove);
    renderCapturedPieces(capturedByPlayer0, capturedByPlayer1);

    const currentStatus = rules.getGameStatus(board.getState());

    if (currentStatus !== GameStatus.ONGOING) {
        const winner = (currentStatus === GameStatus.PLAYER0_WINS) ? Player.PLAYER0 :
                       (currentStatus === GameStatus.PLAYER1_WINS) ? Player.PLAYER1 :
                       Player.NONE;
        setGameOver(winner, currentStatus);

        let soundToPlay = 'defeat';
        if (winner === Player.PLAYER0) soundToPlay = 'victory';
        if (winner === Player.NONE) soundToPlay = 'draw';
        if (gameModeSelect.value === 'PVP' && winner !== Player.NONE) soundToPlay = 'victory';

        playSound(soundToPlay);
        updateGameStatusUI();

    } else {
        switchPlayer();
        updateGameStatusUI();
    }
}

function switchPlayer() {
    currentPlayer = Player.getOpponent(currentPlayer);
    deselectPiece();
    console.log("Switched player to:", currentPlayer);

    if (!isGameOver && gameModeSelect.value === 'PVA' && currentPlayer === aiPlayer && !isAiThinking) {
        setTimeout(triggerAiTurn, 250);
    }
}

function setGameOver(winner, status) {
    if (isGameOver) return;
    console.log(`Game Over! Winner: ${winner}, Status: ${status}`);
    isGameOver = true;
    gameStatus = status;
    deselectPiece();
}

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


function triggerAiTurn() {
    if (isGameOver || isAiThinking || currentPlayer !== aiPlayer || !aiWorker) {
        return;
    }
    console.log("Triggering AI move...");
    isAiThinking = true;
    updateGameStatusUI();
    updateAiDepthDisplay('-');

    let boardStateForWorker;
    try {
        boardStateForWorker = board.getClonedStateForWorker();
    } catch (e) {
        console.error("Error cloning board state for AI:", e);
        updateStatus('errorBoardClone', {}, true);
        isAiThinking = false;
        lastEvalScore = null;
        updateWinChanceDisplay(lastEvalScore);
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