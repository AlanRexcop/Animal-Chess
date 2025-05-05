// js/game.js
import { Board } from './board.js';
import { Piece } from './piece.js';
import {
    highlightSquare, clearHighlights, updateStatus,
    renderCapturedPieces, addMoveToHistory, clearMoveHistory, playSound,
    updateTurnDisplay,
    updateAiDepthDisplay,
    updateWinChanceBar,
    animatePieceMove,
    removeLastMoveFromHistory,
    updateUndoButtonState
} from './renderer.js';
import { initializeLandTilePatterns, renderBoard } from './renderBoard.js';
import { loadLanguage, getString, applyLocalizationToPage, renderGameRules } from './localization.js';
import {
    Player, GameStatus, aiPlayer, DEFAULT_AI_TARGET_DEPTH,
    DEFAULT_AI_TIME_LIMIT_MS, MIN_AI_TIME_LIMIT_MS, PIECES,
    ANIMATION_DURATION, getPieceKey, BOARD_ROWS, BOARD_COLS
} from './constants.js';
import * as rules from './rules.js';
import { evaluateBoard } from './aiEvaluate.js';
import { initializeZobrist, computeZobristKey } from './zobrist.js'; // Ensure this is imported

// --- Module State ---
let board = new Board();
let currentPlayer = Player.PLAYER0; // Default, will be overwritten in initGame
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
// gameStateHistory stores state *after* the move leading to it
let gameStateHistory = []; // Stores { boardState, currentPlayer (whose turn it became), capturedP0, capturedP1, lastMove, lastEval, isGameOver, gameStatus, hashOfThisState }
let repetitionMap = new Map(); // Map<bigint, number> to track Zobrist hash counts for repetition draws

// --- UI Cache ---
let difficultySelect;
let timeLimitInput;
let resetButton;
let langSelect;
let gameModeSelect;
let playerStartsSelect; // Add cache for the new select
let aiControlsContainer;
let undoButton;
let aiTargetDepth = DEFAULT_AI_TARGET_DEPTH;
let aiTimeLimitMs = DEFAULT_AI_TIME_LIMIT_MS;

// --- Initialize Zobrist Hashing ---
initializeZobrist(); // Call this once when the module loads

// --- AI Worker ---
// AI Worker Initialization and Handlers
function initializeAiWorker() {
    if (aiWorker) { console.log("[Main] Terminating previous AI Worker."); aiWorker.terminate(); aiWorker = null; }
    try { aiWorker = new Worker('js/aiWorker.js', { type: 'module' }); console.log("[Main] AI Worker created successfully (as module)."); aiWorker.onmessage = handleAiWorkerMessage; aiWorker.onerror = handleAiWorkerError; }
    catch (e) { console.error("Failed to create AI Worker:", e); updateStatus('errorWorkerInit', {}, true); setGameOver(Player.PLAYER0, GameStatus.PLAYER0_WINS); updateWinChanceBar(null); }
}

// Handles messages FROM the AI worker
function handleAiWorkerMessage(e) {
    console.log('[Main] Message received from AI Worker:', e.data);
    // ***** IMPORTANT: Reset isAiThinking flag FIRST *****
    isAiThinking = false;

    const { move: bestMoveData, depthAchieved, nodes, eval: score, error } = e.data;

    // Update non-status UI elements immediately
    updateAiDepthDisplay(depthAchieved ?? '?');
    if (score !== null && score !== undefined && isFinite(score)) {
        lastEvalScore = score;
        console.log(`[Main AI Eval] Received Eval: ${lastEvalScore}`);
        // Update win chance bar immediately based on AI eval BEFORE move is made
        // Note: postMoveChecks will update it again AFTER the move.
        updateWinChanceBar(lastEvalScore);
    } else if (!error) {
        lastEvalScore = null;
        // Optionally reset win chance bar if eval is null
        // updateWinChanceBar(null);
    }


    if (error) {
        console.error("[Main] AI Worker reported error:", error);
        const errorKey = error === "No moves available" ? 'errorAINoMoves'
                       : error === "Fallback piece missing" ? 'errorAIFallback'
                       : error === "Move gen error" ? 'errorAIMove'
                       : 'errorAIWorker';
        // Update status directly for error, set game over
        updateStatus(errorKey, {}, true);
        setGameOver(Player.PLAYER0, GameStatus.PLAYER0_WINS); // Assume player wins on AI error
        playSound('victory');
        renderBoard(board.getState(), handleSquareClick, lastMove); // Re-render board
        updateTurnDisplay(currentPlayer, gameModeSelect.value, isGameOver); // Update turn display
        return;
    }

    if (bestMoveData) {
        const pieceToMove = board.getPiece(bestMoveData.fromRow, bestMoveData.fromCol);
        const expectedPieceName = bestMoveData.pieceName;
        // Validate the move received from the worker
        if (pieceToMove && pieceToMove.player === aiPlayer && pieceToMove.name === expectedPieceName) {
            const targetPiece = board.getPiece(bestMoveData.toRow, bestMoveData.toCol);
            // Perform the move - this will eventually call postMoveChecks
            performMoveWithAnimation(pieceToMove, bestMoveData.toRow, bestMoveData.toCol, bestMoveData.fromRow, bestMoveData.fromCol, targetPiece);
        } else {
            console.error("AI Error: Piece mismatch or missing!", { bestMoveData, pieceOnBoard: pieceToMove });
            updateStatus('errorAISync', {}, true);
            setGameOver(Player.PLAYER0, GameStatus.PLAYER0_WINS);
            playSound('victory');
            renderBoard(board.getState(), handleSquareClick, lastMove);
            updateTurnDisplay(currentPlayer, gameModeSelect.value, isGameOver);
        }
    } else {
        // Handle case where AI legitimately has no moves (stalemate/loss for AI)
        console.error("AI Worker returned no valid move.");
        // Check if AI actually had no moves according to rules
        const allAiMoves = rules.getAllValidMoves(aiPlayer, board.getClonedStateForWorker());
        if (allAiMoves.length === 0) {
            updateStatus('statusWin', { winner: getString('player1Name') }, false); // Player wins if AI has no moves
            setGameOver(Player.PLAYER0, GameStatus.PLAYER0_WINS);
            playSound('victory');
        } else {
            // This indicates an error in the AI logic if rules say moves exist but AI returned none
            updateStatus('errorAIMove', {}, true); // Generic AI move error
            setGameOver(Player.PLAYER0, GameStatus.PLAYER0_WINS);
            playSound('victory');
        }
        renderBoard(board.getState(), handleSquareClick, lastMove);
        updateTurnDisplay(currentPlayer, gameModeSelect.value, isGameOver);
    }
}

function handleAiWorkerError(event) {
    console.error(`[Main] Error from AI Worker: Msg:${event.message}, File:${event.filename}, Line:${event.lineno}`, event);
    updateStatus('errorAIWorker', {}, true);
    isAiThinking = false; // Ensure flag is reset on error too
    lastEvalScore = null;
    updateWinChanceBar(lastEvalScore);
    if (!isGameOver) { setGameOver(Player.PLAYER0, GameStatus.PLAYER0_WINS); playSound('victory'); renderBoard(board.getState(), handleSquareClick, lastMove); }
}

// initGame
export function initGame() {
    console.log("Initializing game...");
    // Cache UI elements
    difficultySelect = document.getElementById('difficulty'); timeLimitInput = document.getElementById('time-limit'); resetButton = document.getElementById('reset-button'); langSelect = document.getElementById('lang-select'); gameModeSelect = document.getElementById('game-mode'); aiControlsContainer = document.getElementById('ai-controls'); undoButton = document.getElementById('undo-button');
    playerStartsSelect = document.getElementById('player-starts-select'); // Cache the new select

    board = new Board(); board.initBoard(); initializeLandTilePatterns(board.getState());
    if (!aiWorker) { initializeAiWorker(); } else if (isAiThinking) { console.log("[Main] Resetting during AI calculation, terminating worker."); aiWorker.terminate(); initializeAiWorker(); }
    selectedPieceInfo = null; gameStatus = GameStatus.ONGOING; validMovesCache = []; isGameOver = false; isAiThinking = false; // Reset flags
    lastMove = null; capturedByPlayer0 = []; capturedByPlayer1 = []; moveHistory = []; lastEvalScore = null;
    gameStateHistory = [];
    updateUndoButtonState(false); // Disable undo on new game

    // --- Determine Starting Player ---
    const startingPlayerValue = playerStartsSelect ? parseInt(playerStartsSelect.value, 10) : Player.PLAYER0;
    currentPlayer = (startingPlayerValue === Player.PLAYER1) ? Player.PLAYER1 : Player.PLAYER0;
    console.log(`Starting player set to: ${currentPlayer === Player.PLAYER0 ? 'Blue (0)' : 'Red (1)'}`);
    // --- End Determine Starting Player ---

    // Clear repetition map and add initial state
    repetitionMap.clear();
    try {
        const initialHash = computeZobristKey(board.getState(), currentPlayer);
        repetitionMap.set(initialHash, 1);
        console.log(`Initial board hash ${initialHash} added to repetition map (Count: 1).`);
    } catch(e) { console.error("Error calculating initial Zobrist hash:", e); }

    updateAiDepthDisplay('0'); if (difficultySelect) difficultySelect.value = aiTargetDepth.toString(); if (timeLimitInput) timeLimitInput.value = aiTimeLimitMs;
    clearMoveHistory(); renderBoard(board.getState(), handleSquareClick, lastMove); renderCapturedPieces(capturedByPlayer0, capturedByPlayer1); updateGameStatusUI(); updateWinChanceBar(null); // Start at 50/50
    setupUIListeners();
    console.log("Game Initialized. Current Turn:", currentPlayer);

    // --- Trigger AI if it starts first ---
    if (!isGameOver && gameModeSelect.value === 'PVA' && currentPlayer === aiPlayer && !isAiThinking) {
        setTimeout(triggerAiTurn, 250); // Give UI a moment to render before AI starts
    }
}

// Saves the state *after* a move has been made to the history
function saveCurrentStateToHistory() {
    try {
        // This function is called AFTER updateBoardState has been executed for the current move.
        // 'currentPlayer' at this point is still the player who *just* made the move.

        const currentState = board.getClonedStateForWorker(); // State AFTER the move
        const playerWhoJustMoved = currentPlayer; // Clarify variable name
        const nextPlayerTurn = Player.getOpponent(playerWhoJustMoved);
        const hashOfCurrentStateAndNextTurn = computeZobristKey(currentState, nextPlayerTurn);

        const stateEntry = {
             boardState: currentState,      // The state reached after the move
             currentPlayer: nextPlayerTurn, // Whose turn it WILL BE next
             capturedP0: [...capturedByPlayer0], // Captures state AFTER the move
             capturedP1: [...capturedByPlayer1],
             lastMove: lastMove ? { ...lastMove } : null, // The move that led to this state
             lastEval: lastEvalScore,      // Eval corresponding to this state
             isGameOver: isGameOver,       // Game status after this move might have ended it
             gameStatus: gameStatus,
             hashOfThisState: hashOfCurrentStateAndNextTurn // Hash for this state + next player turn combo
        };

        gameStateHistory.push(stateEntry);
        updateUndoButtonState(true); // Enable undo after saving state

    } catch (error) {
        console.error("Error saving game state to history:", error);
        // Optionally disable undo if saving fails critically
        updateUndoButtonState(false);
    }
}

// setupUIListeners
function setupUIListeners() {
    if (setupUIListeners.alreadyRun) return;
    setupUIListeners.alreadyRun = true;

    // Reset button
    resetButton?.addEventListener('click', () => initGame());
    // Language select
    langSelect?.addEventListener('change', async (event) => {
        await loadLanguage(event.target.value);
        applyLocalizationToPage();
        renderCapturedPieces(capturedByPlayer0, capturedByPlayer1);
        updateGameStatusUI();
        updateWinChanceBar(lastEvalScore);
        renderGameRules();
    });
    // Difficulty select
    difficultySelect?.addEventListener('change', (event) => {
        aiTargetDepth = parseInt(event.target.value, 10);
        console.log("AI Target Depth set to:", aiTargetDepth);
    });
    // Time Limit input
    timeLimitInput?.addEventListener('change', (event) => {
        let v = parseInt(event.target.value, 10);
        if (isNaN(v) || v < MIN_AI_TIME_LIMIT_MS) { v = MIN_AI_TIME_LIMIT_MS; event.target.value = v; }
        aiTimeLimitMs = v;
        console.log("AI Time Limit set to:", aiTimeLimitMs, "ms");
    });
    // Game Mode select
    gameModeSelect?.addEventListener('change', () => {
        const newMode = gameModeSelect.value;
        if (aiControlsContainer) aiControlsContainer.style.display = newMode === 'PVA' ? 'flex' : 'none';
        if (isAiThinking) { if (aiWorker) aiWorker.terminate(); aiWorker = null; isAiThinking = false; initializeAiWorker(); }
        updateGameStatusUI();
        if (!isGameOver && newMode === 'PVA' && currentPlayer === aiPlayer) setTimeout(triggerAiTurn, 150);
    });
    // Undo button
    undoButton?.addEventListener('click', () => undoMove());
    // Initial AI controls visibility
    if (aiControlsContainer && gameModeSelect) aiControlsContainer.style.display = gameModeSelect.value === 'PVA' ? 'flex' : 'none';
    // Player Starts select
    playerStartsSelect?.addEventListener('change', () => { console.log("Starting player changed, resetting game..."); initGame(); });
}
setupUIListeners.alreadyRun = false;

// selectPiece, deselectPiece, handleSquareClick (No changes needed from previous working version)
function selectPiece(piece, row, col) { if (isGameOver || isAiThinking) return; deselectPiece(); selectedPieceInfo = { piece, row, col }; validMovesCache = rules.getValidMovesForPiece(piece, row, col, board.getState()); highlightSquare(row, col, 'selected'); validMovesCache.forEach(move => { highlightSquare(move.row, move.col, 'possible-move'); const targetPiece = board.getPiece(move.row, move.col); if (targetPiece && targetPiece.player !== currentPlayer) { highlightSquare(move.row, move.col, 'capture-move'); } }); console.log(`Selected: ${piece.name} at ${row},${col}. Valid moves:`, validMovesCache); updateGameStatusUI(); }
function deselectPiece() { if (selectedPieceInfo) { clearHighlights('selected'); clearHighlights('possible-move'); clearHighlights('capture-move'); selectedPieceInfo = null; validMovesCache = []; console.log("Piece deselected."); } }
function handleSquareClick(row, col) { console.log(`Clicked on: ${row}, ${col}`); if (isGameOver || isAiThinking || (gameModeSelect.value === 'PVA' && currentPlayer === aiPlayer)) { console.log("Ignoring click (Game Over, AI Thinking, or AI's turn)"); return; } const clickedPiece = board.getPiece(row, col); if (selectedPieceInfo) { const isValidDestination = validMovesCache.some(move => move.row === row && move.col === col); if (isValidDestination) { const pieceToMove = selectedPieceInfo.piece; const fromRow = selectedPieceInfo.row; const fromCol = selectedPieceInfo.col; const targetPiece = board.getPiece(row, col); deselectPiece(); performMoveWithAnimation(pieceToMove, row, col, fromRow, fromCol, targetPiece); } else { const originalSelection = { ...selectedPieceInfo }; deselectPiece(); if (clickedPiece && clickedPiece.player === currentPlayer && !(clickedPiece.row === originalSelection.row && clickedPiece.col === originalSelection.col)) { selectPiece(clickedPiece, row, col); } else { updateGameStatusUI(); } } } else if (clickedPiece && clickedPiece.player === currentPlayer) { selectPiece(clickedPiece, row, col); } else { console.log("Clicked empty square or opponent piece without selection."); } }

// updateBoardState - Called *during* performMoveWithAnimation
function updateBoardState(piece, toRow, toCol, fromRow, fromCol, capturedPiece) {
    board.setPiece(fromRow, fromCol, null);
    board.setPiece(toRow, toCol, piece);
    if (capturedPiece) {
        // currentPlayer is the one who moved when this is called
        if (currentPlayer === Player.PLAYER0) {
            capturedByPlayer0.push(capturedPiece);
        } else {
            capturedByPlayer1.push(capturedPiece);
        }
        console.log(`${piece.name} captured ${capturedPiece.name}`);
    }
    // lastMove should reflect the move just made by currentPlayer
    lastMove = { start: { r: fromRow, c: fromCol }, end: { r: toRow, c: toCol }, player: currentPlayer };
}

// performMoveWithAnimation - Calls updateBoardState and saveCurrentStateToHistory
function performMoveWithAnimation(piece, toRow, toCol, fromRow, fromCol, targetPiece) {
    if (isGameOver) return;

    // 1. Update board state logic (move piece, handle capture)
    const isCapture = targetPiece !== null && targetPiece.player !== piece.player;
    const capturedPieceData = isCapture ? { ...targetPiece } : null;
    updateBoardState(piece, toRow, toCol, fromRow, fromCol, capturedPieceData); // Applies the move

    // 2. Save state AFTER board update, BEFORE animation/postMoveChecks
    saveCurrentStateToHistory(); // Saves the state *after* the move

    // 3. Animate and finalize
    const boardElement = document.getElementById('board');
    const startSquare = boardElement?.querySelector(`.square[data-row="${fromRow}"][data-col="${fromCol}"]`);
    const endSquare = boardElement?.querySelector(`.square[data-row="${toRow}"][data-col="${toCol}"]`);
    const pieceElement = startSquare?.querySelector('.piece'); // Piece is already logically moved, element still at start

    addMoveToHistory(piece, fromRow, fromCol, toRow, toCol, capturedPieceData); // Add to visual history list

    if (!pieceElement || !startSquare || !endSquare) {
        console.warn("DOM elements for animation not found, moving directly.");
        // updateBoardState and saveCurrentStateToHistory already called
        playSound(isCapture ? `capture_${getPieceKey(capturedPieceData?.name)}` : 'move');
        postMoveChecks(); // Proceed to next turn/checks
        return;
    }

    // Animate the visual move
    animatePieceMove(pieceElement, startSquare, endSquare, isCapture, isCapture ? getPieceKey(capturedPieceData.name) : null, () => {
        console.log("Animation complete, running post-move checks.");
        postMoveChecks(); // Proceed to next turn/checks AFTER animation
    });
}

// postMoveChecks - Called AFTER a move is fully completed (including animation)
function postMoveChecks() {
    // Re-render board to ensure visual consistency after animation/potential direct move
    renderBoard(board.getState(), handleSquareClick, lastMove);
    renderCapturedPieces(capturedByPlayer0, capturedByPlayer1);

    // Check for Win/Loss conditions first
    const currentStatus = rules.getGameStatus(board.getState());

    // --- Game End Check ---
    if (currentStatus !== GameStatus.ONGOING) {
        const winner = (currentStatus === GameStatus.PLAYER0_WINS) ? Player.PLAYER0 : (currentStatus === GameStatus.PLAYER1_WINS) ? Player.PLAYER1 : Player.NONE;
        setGameOver(winner, currentStatus); // Set game over state

        // Update win chance bar to definite state
        updateWinChanceBar(currentStatus === GameStatus.PLAYER1_WINS ? Infinity : (currentStatus === GameStatus.PLAYER0_WINS ? -Infinity : 0));

        let soundToPlay = 'defeat';
        if (winner === Player.PLAYER0) soundToPlay = 'victory';
        if (winner === Player.NONE || currentStatus === GameStatus.DRAW) soundToPlay = 'draw';
        if (gameModeSelect.value === 'PVP' && winner !== Player.NONE) soundToPlay = 'victory';
        playSound(soundToPlay);

        updateGameStatusUI(); // Update UI to show final win/loss/draw status
        return; // Game ended, no further checks needed
    }

    // --- Game Ongoing ---

    // Evaluate board for win chance bar (only if game ongoing)
    try {
        const boardStateForEval = board.getClonedStateForWorker();
        lastEvalScore = evaluateBoard(boardStateForEval); // Evaluate from P1's perspective
        console.log(`[Main Eval] Post-move score: ${lastEvalScore?.toFixed(2)}`);
    } catch (e) {
        console.error("Error during board evaluation for win chance:", e);
        lastEvalScore = null;
    }
    updateWinChanceBar(lastEvalScore);

    // Switch Player
    switchPlayer(); // Changes currentPlayer, deselects piece

    // Check for Draw by Repetition AFTER switching player
    try {
        // Hash uses the current board state and the player whose turn it NOW is
        const currentHash = computeZobristKey(board.getState(), currentPlayer);
        const count = (repetitionMap.get(currentHash) || 0) + 1;
        repetitionMap.set(currentHash, count);
        console.log(`[Rep Check] Hash: ${currentHash}, Count: ${count}, Player TO Move: ${currentPlayer}`);

        if (count >= 3) {
            console.log("Draw by threefold repetition detected!");
            setGameOver(Player.NONE, GameStatus.DRAW);
            playSound('draw');
            updateGameStatusUI(); // Update UI to show draw
            return; // Game ended in a draw
        }
    } catch (e) { console.error("Error checking repetition:", e); }
    // --- End Repetition Check ---

    // Update Status for the Player's Turn (or AI's next turn if applicable)
    // This call ensures the status is updated AFTER switching player and checking draw
    updateGameStatusUI();

    // Trigger AI's next turn if applicable
    if (!isGameOver && gameModeSelect.value === 'PVA' && currentPlayer === aiPlayer && !isAiThinking) {
        setTimeout(triggerAiTurn, 150);
    }
}

// switchPlayer - Simplified: just changes player and deselects
function switchPlayer() {
    currentPlayer = Player.getOpponent(currentPlayer);
    deselectPiece(); // Clear selection when turn switches
    console.log("Switched player to:", currentPlayer);
    // The call to updateGameStatusUI is now primarily handled in postMoveChecks
}

// setGameOver
function setGameOver(winner, status) {
    if (isGameOver) return;
    console.log(`Game Over! Status: ${status}, Winner (if any): ${winner}`);
    isGameOver = true;
    gameStatus = status;
    deselectPiece(); // Clear selection on game over
}

// updateGameStatusUI
function updateGameStatusUI() {
    let statusKey = 'statusLoading';
    let statusParams = {};
    // Determine player label based on current player and game mode
    let displayPlayerLabel = '';
    if (gameModeSelect.value === 'PVP') {
        displayPlayerLabel = getString(currentPlayer === Player.PLAYER0 ? 'player1Name' : 'player2Name');
    } else { // PVA
        displayPlayerLabel = getString(currentPlayer === Player.PLAYER0 ? 'playerName' : 'aiName');
    }

    if (isGameOver) {
        if (gameStatus === GameStatus.DRAW) {
            statusKey = 'statusDrawRepetition';
        } else {
            let winnerLabel = '';
            if (gameStatus === GameStatus.PLAYER0_WINS) winnerLabel = getString('player1Name'); // Always Blue
            else if (gameStatus === GameStatus.PLAYER1_WINS) {
                // Winner is Red - label depends on mode
                winnerLabel = (gameModeSelect.value === 'PVA') ? getString('aiName') : getString('player2Name');
            }
            statusKey = 'statusWin';
            statusParams = { winner: winnerLabel };
        }
    } else if (isAiThinking) {
        // AI is thinking status
        statusKey = 'statusAIThinking';
        statusParams = { aiName: getString('aiName') };
    } else if (selectedPieceInfo) {
        // Player selected a piece
        statusKey = 'statusPlayerSelected';
        const pieceLocaleKey = `animal_${selectedPieceInfo.piece.type}`;
        const pieceName = getString(pieceLocaleKey);
        statusParams = { player: displayPlayerLabel, pieceName: pieceName !== pieceLocaleKey ? pieceName : selectedPieceInfo.piece.name };
    } else {
        // Waiting for current player to move
        statusKey = 'statusWaitingPlayer';
        statusParams = { player: displayPlayerLabel };
    }
    updateStatus(statusKey, statusParams);
    updateTurnDisplay(currentPlayer, gameModeSelect.value, isGameOver);
}

// triggerAiTurn - Sends job to AI Worker
function triggerAiTurn() {
    if (isGameOver || isAiThinking || currentPlayer !== aiPlayer || !aiWorker) {
        return;
    }
    console.log("Triggering AI move...");
    // ***** IMPORTANT: Set isAiThinking flag HERE *****
    isAiThinking = true;
    updateGameStatusUI(); // Show "AI is thinking..."
    updateAiDepthDisplay('-');

    let boardStateForWorker;
    try {
        boardStateForWorker = board.getClonedStateForWorker();
    } catch (e) {
        console.error("Error cloning board state for AI:", e);
        updateStatus('errorBoardClone', {}, true);
        isAiThinking = false; // Reset flag on error
        lastEvalScore = null;
        updateWinChanceBar(lastEvalScore);
        setGameOver(Player.PLAYER0, GameStatus.PLAYER0_WINS);
        playSound('victory');
        return;
    }
    const currentTargetDepth = aiTargetDepth; const currentTimeLimit = aiTimeLimitMs;
    console.log(`[Main] Sending job to AI Worker: Depth=${currentTargetDepth}, TimeLimit=${currentTimeLimit}ms`);
    aiWorker.postMessage({ boardState: boardStateForWorker, targetDepth: currentTargetDepth, timeLimit: currentTimeLimit });
}

// undoMove - Handles undoing moves and updating repetition map
function undoMove() {
    console.log("Attempting to undo move...");

    if (isAiThinking) {
        console.log("AI is thinking, terminating worker before undo.");
        if (aiWorker) aiWorker.terminate();
        // ***** IMPORTANT: Reset isAiThinking flag HERE *****
        isAiThinking = false;
        initializeAiWorker(); // Re-initialize worker
    }

    let undoCount = 0;
    const mode = gameModeSelect?.value || 'PVA';

    if (gameStateHistory.length > 0) {
        undoCount = 1;
        // Determine if we need to undo 2 steps (Player + AI) in PVA mode
        if (mode === 'PVA' && gameStateHistory.length >= 2) {
             // Look at the state *before* the last one (index length-2)
             // Check whose turn it was *after* that state's move completed
             const stateBeforeLast = gameStateHistory[gameStateHistory.length - 2];
             if (stateBeforeLast.currentPlayer === aiPlayer) { // If it became the AI's turn then, the last move was the player's
                 console.log("PvA mode: Undoing player move and AI response.");
                 undoCount = 2;
             }
        }
    }

    if (undoCount === 0 || gameStateHistory.length < undoCount) {
         console.log(`No history to undo or not enough history for ${undoCount}-step undo.`);
         updateUndoButtonState(gameStateHistory.length > 0);
         return;
    }

    // --- Pop state(s) and Decrement Repetition Count ---
    let stateToRestoreData = null; // Data of the state we are reverting TO

    for (let i = 0; i < undoCount; i++) {
        if (gameStateHistory.length === 0) {
             console.error("History became empty unexpectedly during undo loop.");
             initGame(); // Reset if history state is corrupt
             return;
        }

        const poppedStateData = gameStateHistory.pop(); // Get the state being removed

        // Decrement repetition count for the state we are leaving (the one popped)
        if (poppedStateData && poppedStateData.hashOfThisState) {
            const hashToDecrement = poppedStateData.hashOfThisState;
            try {
                let currentCount = repetitionMap.get(hashToDecrement);
                if (currentCount !== undefined && currentCount > 0) {
                    currentCount--;
                    if (currentCount === 0) {
                        repetitionMap.delete(hashToDecrement);
                        console.log(`[Undo] Decremented count for hash ${hashToDecrement}. Removed from map (count 0).`);
                    } else {
                        repetitionMap.set(hashToDecrement, currentCount);
                        console.log(`[Undo] Decremented count for hash ${hashToDecrement}. New count: ${currentCount}.`);
                    }
                } else {
                    // This might happen if the map got cleared or desynced somehow
                    console.warn(`[Undo] Tried to decrement count for hash ${hashToDecrement}, but it wasn't found or count was <= 0.`);
                }
            } catch (e) {
                console.error("Error decrementing repetition map:", e);
                // Don't reset the whole map, just log the error
            }
        } else {
            console.warn("[Undo] Popped state missing or missing hashOfThisState.");
        }

        removeLastMoveFromHistory(); // Update visual history list
    }

    // Determine the actual state to restore TO
    // If history is now empty, we restore to initial board setup by calling initGame
    // Otherwise, restore to the state represented by the *last* entry NOW remaining in history
    if (gameStateHistory.length === 0) {
         console.log("History empty after undo, restoring to initial state (will call initGame).");
         initGame(); // Easiest way to get back to the known initial state
         return;
    } else {
         stateToRestoreData = gameStateHistory[gameStateHistory.length - 1];
         console.log("Restoring to state from history index:", gameStateHistory.length - 1);
    }

    // --- Restore game state from the identified stateToRestoreData ---
    try {
        if (!stateToRestoreData || !stateToRestoreData.boardState || !Array.isArray(stateToRestoreData.boardState)) {
             throw new Error("Invalid state data found for restoration.");
        }

        // Restore board, player, captures, etc. from the *last remaining* history entry
        // This entry represents the state *after* the move *before* the one(s) we just undid.
        board.state = stateToRestoreData.boardState.map(row => {
             if (!Array.isArray(row)) throw new Error("Invalid row structure in restore data.");
             return row.map(cell => {
                 if (!cell || typeof cell.terrain !== 'number') throw new Error("Invalid cell structure in restore data.");
                 return {
                     terrain: cell.terrain,
                     piece: cell.piece ? new Piece(cell.piece.type, cell.piece.player, cell.piece.row, cell.piece.col) : null
                 };
             });
        });

        currentPlayer = stateToRestoreData.currentPlayer; // Whose turn it became AFTER the move in that history entry
        capturedByPlayer0 = [...stateToRestoreData.capturedP0];
        capturedByPlayer1 = [...stateToRestoreData.capturedP1];
        lastMove = stateToRestoreData.lastMove ? { ...stateToRestoreData.lastMove } : null; // The move that led to this state
        lastEvalScore = stateToRestoreData.lastEval;
        // Restore game over status *from the state we are returning to*
        isGameOver = stateToRestoreData.isGameOver;
        gameStatus = stateToRestoreData.gameStatus;

        console.log("Game state restored to turn of:", currentPlayer);
        console.log("Current repetition map:", repetitionMap);

    } catch (error) {
        console.error("Error restoring game state variables from history:", error);
        initGame(); // Reset on critical error during restore
        return;
    }

    // Reset UI/Interaction State
    deselectPiece();

    // Re-render the board and UI elements
    renderBoard(board.getState(), handleSquareClick, lastMove);
    renderCapturedPieces(capturedByPlayer0, capturedByPlayer1);
    updateGameStatusUI(); // Update status AFTER restoring state
    updateWinChanceBar(lastEvalScore);
    updateUndoButtonState(gameStateHistory.length > 0); // Enable/disable based on remaining history

    console.log("Undo complete.");
}