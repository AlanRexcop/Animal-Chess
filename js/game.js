// js/game.js
import { Board } from './board.js';
import { Piece } from './piece.js';
import {
    highlightSquare, clearHighlights, updateStatus,
    renderCapturedPieces, addMoveToHistory, clearMoveHistory, playSound,
    updateTurnDisplay,
    updateAiDepthDisplay,
    updateWinChanceBar, // Correct function name
    animatePieceMove,
} from './renderer.js';
import { initializeLandTilePatterns, renderBoard } from './renderBoard.js';
import { loadLanguage, getString, applyLocalizationToPage, renderGameRules } from './localization.js';
import {
    Player, GameStatus, aiPlayer, DEFAULT_AI_TARGET_DEPTH,
    DEFAULT_AI_TIME_LIMIT_MS, MIN_AI_TIME_LIMIT_MS, PIECES,
    ANIMATION_DURATION, getPieceKey
} from './constants.js';
import * as rules from './rules.js';
import { evaluateBoard } from './aiEvaluate.js'; // <-- Import evaluateBoard

// Module State, UI Cache, etc.
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
let difficultySelect;
let timeLimitInput;
let resetButton;
let langSelect;
let gameModeSelect;
let aiControlsContainer;
let aiTargetDepth = DEFAULT_AI_TARGET_DEPTH;
let aiTimeLimitMs = DEFAULT_AI_TIME_LIMIT_MS;

// AI Worker Initialization and Handlers
function initializeAiWorker() {
    if (aiWorker) { console.log("[Main] Terminating previous AI Worker."); aiWorker.terminate(); aiWorker = null; }
    try { aiWorker = new Worker('js/aiWorker.js', { type: 'module' }); console.log("[Main] AI Worker created successfully (as module)."); aiWorker.onmessage = handleAiWorkerMessage; aiWorker.onerror = handleAiWorkerError; }
    catch (e) { console.error("Failed to create AI Worker:", e); updateStatus('errorWorkerInit', {}, true); setGameOver(Player.PLAYER0, GameStatus.PLAYER0_WINS); updateWinChanceBar(null); }
}
function handleAiWorkerMessage(e) {
    console.log('[Main] Message received from AI Worker:', e.data);
    isAiThinking = false;
    // --- INTEGRATED: Re-enable controls ---
    if (gameModeSelect) gameModeSelect.disabled = false;
    if (difficultySelect) difficultySelect.disabled = false;
    if (timeLimitInput) timeLimitInput.disabled = false;
    // --- END INTEGRATED ---

    const { move: bestMoveData, depthAchieved, nodes, eval: score, error } = e.data;
    updateAiDepthDisplay(depthAchieved ?? '?');
    if (score !== null && score !== undefined && isFinite(score)) { lastEvalScore = score; console.log(`[Main AI Eval] Received Eval: ${lastEvalScore}`); } else if (!error) { lastEvalScore = null; }
    updateWinChanceBar(lastEvalScore); // Update bar AFTER getting AI result
    if (error) { console.error("[Main] AI Worker reported error:", error); const errorKey = error === "No moves available" ? 'errorAINoMoves' : error === "Fallback piece missing" ? 'errorAIFallback' : error === "Move gen error" ? 'errorAIMove' : 'errorAIWorker'; updateStatus(errorKey, {}, true); setGameOver(Player.PLAYER0, GameStatus.PLAYER0_WINS); playSound('victory'); renderBoard(board.getState(), handleSquareClick, lastMove); return; }
    if (bestMoveData) {
        const pieceToMove = board.getPiece(bestMoveData.fromRow, bestMoveData.fromCol); const expectedPieceName = bestMoveData.pieceName;
        if (pieceToMove && pieceToMove.player === aiPlayer && pieceToMove.name === expectedPieceName) { const targetPiece = board.getPiece(bestMoveData.toRow, bestMoveData.toCol); performMoveWithAnimation(pieceToMove, bestMoveData.toRow, bestMoveData.toCol, bestMoveData.fromRow, bestMoveData.fromCol, targetPiece); }
        else { console.error("AI Error: Piece mismatch or missing!", { bestMoveData, pieceOnBoard: pieceToMove }); updateStatus('errorAISync', {}, true); setGameOver(Player.PLAYER0, GameStatus.PLAYER0_WINS); playSound('victory'); renderBoard(board.getState(), handleSquareClick, lastMove); }
    } else {
        console.error("AI Worker returned no valid move."); const allAiMoves = rules.getAllValidMoves(aiPlayer, board.getClonedStateForWorker());
        if (allAiMoves.length === 0) { updateStatus('errorAINoMoves', {}, true); setGameOver(Player.PLAYER0, Player.PLAYER0_WINS); playSound('victory'); } else { updateStatus('errorAIMove', {}, true); setGameOver(Player.PLAYER0, GameStatus.PLAYER0_WINS); playSound('victory'); }
        renderBoard(board.getState(), handleSquareClick, lastMove);
    }
}
function handleAiWorkerError(event) {
    console.error(`[Main] Error from AI Worker: Msg:${event.message}, File:${event.filename}, Line:${event.lineno}`, event);
    updateStatus('errorAIWorker', {}, true);
    isAiThinking = false;
    // --- INTEGRATED: Re-enable controls ---
    if (gameModeSelect) gameModeSelect.disabled = false;
    if (difficultySelect) difficultySelect.disabled = false;
    if (timeLimitInput) timeLimitInput.disabled = false;
    // --- END INTEGRATED ---
    lastEvalScore = null;
    updateWinChanceBar(lastEvalScore);
    if (!isGameOver) { setGameOver(Player.PLAYER0, GameStatus.PLAYER0_WINS); playSound('victory'); renderBoard(board.getState(), handleSquareClick, lastMove); }
}

// initGame (Modified for control enabling)
export function initGame() {
    console.log("Initializing game..."); difficultySelect = document.getElementById('difficulty'); timeLimitInput = document.getElementById('time-limit'); resetButton = document.getElementById('reset-button'); langSelect = document.getElementById('lang-select'); gameModeSelect = document.getElementById('game-mode'); aiControlsContainer = document.getElementById('ai-controls');
    board = new Board(); board.initBoard(); initializeLandTilePatterns(board.getState());
    currentPlayer = Player.PLAYER0; selectedPieceInfo = null; gameStatus = GameStatus.ONGOING; validMovesCache = []; isGameOver = false; isAiThinking = false;
    // --- INTEGRATED: Ensure controls are enabled on init/reset ---
    if (gameModeSelect) gameModeSelect.disabled = false;
    if (difficultySelect) difficultySelect.disabled = false;
    if (timeLimitInput) timeLimitInput.disabled = false;
    // --- END INTEGRATED ---
    lastMove = null; capturedByPlayer0 = []; capturedByPlayer1 = []; moveHistory = []; lastEvalScore = null;
    updateAiDepthDisplay('0'); if (difficultySelect) difficultySelect.value = aiTargetDepth.toString(); if (timeLimitInput) timeLimitInput.value = aiTimeLimitMs;
    clearMoveHistory(); renderBoard(board.getState(), handleSquareClick, lastMove); renderCapturedPieces(capturedByPlayer0, capturedByPlayer1); updateGameStatusUI(); updateWinChanceBar(null); // Start at 50/50
    setupUIListeners(); if (!aiWorker) { initializeAiWorker(); } else if (isAiThinking) { console.log("[Main] Resetting during AI calculation, terminating worker."); aiWorker.terminate(); initializeAiWorker(); }
    console.log("Game Initialized. Player:", currentPlayer);
}

// setupUIListeners, selectPiece, deselectPiece, handleSquareClick (Unchanged)
function setupUIListeners() {
    if (setupUIListeners.alreadyRun) return; setupUIListeners.alreadyRun = true;
    resetButton?.addEventListener('click', () => { initGame(); });
    langSelect?.addEventListener('change', async (event) => { const newLang = event.target.value; await loadLanguage(newLang); applyLocalizationToPage(); renderCapturedPieces(capturedByPlayer0, capturedByPlayer1); updateGameStatusUI(); updateWinChanceBar(lastEvalScore); renderGameRules(); });
    difficultySelect?.addEventListener('change', (event) => { aiTargetDepth = parseInt(event.target.value, 10); console.log("AI Target Depth set to:", aiTargetDepth); });
    timeLimitInput?.addEventListener('change', (event) => { let v = parseInt(event.target.value, 10); if (isNaN(v) || v < MIN_AI_TIME_LIMIT_MS) { v = MIN_AI_TIME_LIMIT_MS; event.target.value = v; } aiTimeLimitMs = v; console.log("AI Time Limit set to:", aiTimeLimitMs, "ms"); });
    gameModeSelect?.addEventListener('change', () => { const mode = gameModeSelect.value; aiControlsContainer.style.display = mode === 'PVA' ? 'flex' : 'none'; initGame(); });
    if (aiControlsContainer && gameModeSelect) { aiControlsContainer.style.display = gameModeSelect.value === 'PVA' ? 'flex' : 'none'; }
}
setupUIListeners.alreadyRun = false;
function selectPiece(piece, row, col) { if (isGameOver || isAiThinking) return; deselectPiece(); selectedPieceInfo = { piece, row, col }; validMovesCache = rules.getValidMovesForPiece(piece, row, col, board.getState()); highlightSquare(row, col, 'selected'); validMovesCache.forEach(move => { highlightSquare(move.row, move.col, 'possible-move'); const targetPiece = board.getPiece(move.row, move.col); if (targetPiece && targetPiece.player !== currentPlayer) { highlightSquare(move.row, move.col, 'capture-move'); } }); console.log(`Selected: ${piece.name} at ${row},${col}. Valid moves:`, validMovesCache); updateGameStatusUI(); }
function deselectPiece() { if (selectedPieceInfo) { clearHighlights('selected'); clearHighlights('possible-move'); clearHighlights('capture-move'); selectedPieceInfo = null; validMovesCache = []; console.log("Piece deselected."); } }
function handleSquareClick(row, col) { console.log(`Clicked on: ${row}, ${col}`); if (isGameOver || isAiThinking || (gameModeSelect.value === 'PVA' && currentPlayer === aiPlayer)) { console.log("Ignoring click (Game Over, AI Thinking, or AI's turn)"); return; } const clickedPiece = board.getPiece(row, col); if (selectedPieceInfo) { const isValidDestination = validMovesCache.some(move => move.row === row && move.col === col); if (isValidDestination) { const pieceToMove = selectedPieceInfo.piece; const fromRow = selectedPieceInfo.row; const fromCol = selectedPieceInfo.col; const targetPiece = board.getPiece(row, col); deselectPiece(); performMoveWithAnimation(pieceToMove, row, col, fromRow, fromCol, targetPiece); } else { const originalSelection = { ...selectedPieceInfo }; deselectPiece(); if (clickedPiece && clickedPiece.player === currentPlayer && !(clickedPiece.row === originalSelection.row && clickedPiece.col === originalSelection.col)) { selectPiece(clickedPiece, row, col); } else { updateGameStatusUI(); } } } else if (clickedPiece && clickedPiece.player === currentPlayer) { selectPiece(clickedPiece, row, col); } else { console.log("Clicked empty square or opponent piece without selection."); } }

// updateBoardState (Unchanged)
function updateBoardState(piece, toRow, toCol, fromRow, fromCol, capturedPiece) { board.setPiece(fromRow, fromCol, null); board.setPiece(toRow, toCol, piece); if (capturedPiece) { if (currentPlayer === Player.PLAYER0) { capturedByPlayer0.push(capturedPiece); } else { capturedByPlayer1.push(capturedPiece); } console.log(`${piece.name} captured ${capturedPiece.name}`); } lastMove = { start: { r: fromRow, c: fromCol }, end: { r: toRow, c: toCol }, player: currentPlayer }; }

// performMoveWithAnimation (Unchanged)
function performMoveWithAnimation(piece, toRow, toCol, fromRow, fromCol, targetPiece) { if (isGameOver) return; const isCapture = targetPiece !== null && targetPiece.player !== piece.player; const capturedPieceData = isCapture ? { ...targetPiece } : null; const boardElement = document.getElementById('board'); const startSquare = boardElement?.querySelector(`.square[data-row="${fromRow}"][data-col="${fromCol}"]`); const endSquare = boardElement?.querySelector(`.square[data-row="${toRow}"][data-col="${toCol}"]`); const pieceElement = startSquare?.querySelector('.piece'); if (!pieceElement || !startSquare || !endSquare) { console.warn("DOM elements for animation not found, moving directly."); updateBoardState(piece, toRow, toCol, fromRow, fromCol, capturedPieceData); addMoveToHistory(piece, fromRow, fromCol, toRow, toCol, capturedPieceData); playSound(isCapture ? `capture_${getPieceKey(capturedPieceData?.name)}` : 'move'); postMoveChecks(); return; } updateBoardState(piece, toRow, toCol, fromRow, fromCol, capturedPieceData); addMoveToHistory(piece, fromRow, fromCol, toRow, toCol, capturedPieceData); animatePieceMove(pieceElement, startSquare, endSquare, isCapture, isCapture ? getPieceKey(capturedPieceData.name) : null, () => { console.log("Animation complete, running post-move checks."); postMoveChecks(); }); }

// postMoveChecks (Unchanged - keeps win chance bar update logic)
function postMoveChecks() {
    renderBoard(board.getState(), handleSquareClick, lastMove);
    renderCapturedPieces(capturedByPlayer0, capturedByPlayer1);
    const currentStatus = rules.getGameStatus(board.getState());

    // --- Evaluate board state for win chance bar AFTER the move ---
    // Evaluate regardless of game mode, but only if the game wasn't already over.
    if (gameStatus !== GameStatus.PLAYER0_WINS && gameStatus !== GameStatus.PLAYER1_WINS && gameStatus !== GameStatus.DRAW) {
        try {
            const boardStateForEval = board.getClonedStateForWorker();
            // Evaluate from Player 1's perspective (standard convention)
            lastEvalScore = evaluateBoard(boardStateForEval);
             console.log(`[Main Eval] Post-move score: ${lastEvalScore?.toFixed(2)}`);
        } catch (e) {
            console.error("Error during board evaluation for win chance:", e);
            lastEvalScore = null; // Reset on error
        }
        updateWinChanceBar(lastEvalScore); // Update the bar based on the new evaluation
    }
    // --- End evaluation block ---

    // Check if the game ended *with this move*
    if (currentStatus !== GameStatus.ONGOING) {
        const winner = (currentStatus === GameStatus.PLAYER0_WINS) ? Player.PLAYER0 : (currentStatus === GameStatus.PLAYER1_WINS) ? Player.PLAYER1 : Player.NONE;
        setGameOver(winner, currentStatus);
        let soundToPlay = 'defeat';
        if (winner === Player.PLAYER0) soundToPlay = 'victory';
        if (winner === Player.NONE) soundToPlay = 'draw'; // Assuming a draw sound exists or is handled
        // Adjust sound for PvP win
        if (gameModeSelect.value === 'PVP' && winner !== Player.NONE) soundToPlay = 'victory';
        playSound(soundToPlay);
        updateGameStatusUI(); // Update UI after setting game over
    } else {
        switchPlayer();
    }
}

// switchPlayer, setGameOver, updateGameStatusUI (Unchanged)
function switchPlayer() {
    currentPlayer = Player.getOpponent(currentPlayer);
    deselectPiece(); // Clear selection and highlights
    console.log("Switched player to:", currentPlayer);

    updateGameStatusUI(); // Update status message and turn display

    if (!isGameOver && gameModeSelect.value === 'PVA' && currentPlayer === aiPlayer && !isAiThinking) {
        // Delay slightly before triggering AI to allow UI updates to render
        setTimeout(triggerAiTurn, 150);
    }
}
function setGameOver(winner, status) {
    if (isGameOver) return;
    console.log(`Game Over! Winner: ${winner}, Status: ${status}`);
    isGameOver = true;
    gameStatus = status;
    deselectPiece();
    // --- INTEGRATED: Ensure controls are enabled on game over ---
    // (In case AI fails and game ends abruptly)
    if (gameModeSelect) gameModeSelect.disabled = false;
    if (difficultySelect) difficultySelect.disabled = false;
    if (timeLimitInput) timeLimitInput.disabled = false;
    // --- END INTEGRATED ---
}
function updateGameStatusUI() {
    let statusKey = 'statusLoading';
    let statusParams = {};
    const playerLabel = getString(currentPlayer === Player.PLAYER0 ? 'player1Name' : 'player2Name');

    if (isGameOver) {
        let winnerLabel = '';
        if (gameStatus === GameStatus.PLAYER0_WINS) winnerLabel = getString('player1Name');
        else if (gameStatus === GameStatus.PLAYER1_WINS && gameModeSelect.value === "PVA") winnerLabel = getString('aiName');
        else if (gameStatus === GameStatus.PLAYER1_WINS) winnerLabel = getString('player2Name');
        else winnerLabel = getString('statusDraw');
        statusKey = 'statusWin';
        statusParams = { winner: winnerLabel };
    } else if (isAiThinking) {
        statusKey = 'statusAIThinking';
        statusParams = { aiName: getString('aiName') };
    } else if (selectedPieceInfo) {
        statusKey = 'statusPlayerSelected';
        const pieceLocaleKey = `animal_${selectedPieceInfo.piece.type}`;
        const pieceName = getString(pieceLocaleKey);
        statusParams = { player: playerLabel, pieceName: pieceName !== pieceLocaleKey ? pieceName : selectedPieceInfo.piece.name };
    } else {
        statusKey = 'statusWaitingPlayer';
        statusParams = { player: playerLabel };
    }
    updateStatus(statusKey, statusParams);
    updateTurnDisplay(currentPlayer, gameModeSelect.value, isGameOver);
}

// triggerAiTurn (Modified for control disabling)
function triggerAiTurn() {
    if (isGameOver || isAiThinking || currentPlayer !== aiPlayer || !aiWorker) {
        return;
    }
    console.log("Triggering AI move...");
    isAiThinking = true;
    // --- INTEGRATED: Disable controls ---
    if (gameModeSelect) gameModeSelect.disabled = true;
    if (difficultySelect) difficultySelect.disabled = true;
    if (timeLimitInput) timeLimitInput.disabled = true;
    // --- END INTEGRATED ---

    updateGameStatusUI(); // Show "AI is thinking..."
    updateAiDepthDisplay('-');

    let boardStateForWorker;
    try {
        boardStateForWorker = board.getClonedStateForWorker();
    } catch (e) {
        console.error("Error cloning board state for AI:", e);
        updateStatus('errorBoardClone', {}, true);
        isAiThinking = false;
        // --- INTEGRATED: Re-enable controls on error ---
        if (gameModeSelect) gameModeSelect.disabled = false;
        if (difficultySelect) difficultySelect.disabled = false;
        if (timeLimitInput) timeLimitInput.disabled = false;
        // --- END INTEGRATED ---
        lastEvalScore = null;
        updateWinChanceBar(lastEvalScore);
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