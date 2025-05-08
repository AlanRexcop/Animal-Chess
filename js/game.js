// js/game.js
import { Board } from "./board.js";
import { Piece } from "./piece.js";
import {
  highlightSquare,
  clearHighlights,
  updateStatus,
  renderCapturedPieces,
  addMoveToHistory,
  clearMoveHistory,
  playSound,
  updateTurnDisplay,
  updateAiDepthDisplay,
  updateWinChanceBar,
  animatePieceMove,
  removeLastMoveFromHistory,
  updateUndoButtonState,
} from "./renderer.js";
import { initializeLandTilePatterns, renderBoard } from "./renderBoard.js";
import {
  loadLanguage,
  getString,
  applyLocalizationToPage,
  renderGameRules,
} from "./localization.js";
import {
  Player,
  GameStatus,
  aiPlayer,
  DEFAULT_AI_TARGET_DEPTH,
  DEFAULT_AI_TIME_LIMIT_MS,
  MIN_AI_TIME_LIMIT_MS,
  PIECES,
  ANIMATION_DURATION,
  getPieceKey,
  BOARD_ROWS,
  BOARD_COLS,
  TERRAIN_LAND,
  TERRAIN_WATER,
  TERRAIN_TRAP,
  TERRAIN_PLAYER0_DEN,
  TERRAIN_PLAYER1_DEN,
  PLAYER0_DEN_ROW,
  PLAYER0_DEN_COL,
  PLAYER1_DEN_ROW,
  PLAYER1_DEN_COL,
} from "./constants.js";
import * as rules from "./rules.js";
import { evaluateBoard } from "./aiEvaluate.js";
import { initializeZobrist, computeZobristKey } from "./zobrist.js";

// --- Module State ---
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
let gameStateHistory = [];
let repetitionMap = new Map();

// --- UI Cache ---
let difficultySelect;
let timeLimitInput;
let resetButton;
let langSelect;
let gameModeSelect;
let playerStartsSelect;
let aiControlsContainer;
let undoButton;
let randomizeBoardButton;
let aiTargetDepth = DEFAULT_AI_TARGET_DEPTH;
let aiTimeLimitMs = DEFAULT_AI_TIME_LIMIT_MS;

const STANDARD_LAYOUT_ID = "STANDARD_LAYOUT";
let initialBoardLayoutConfig = STANDARD_LAYOUT_ID; // Default to standard game setup

// Shuffle utility
function shuffleArray(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
}

// List of all game pieces - not used by current randomize but could be for other variants
const ALL_GAME_PIECES_FOR_PLAYERS = [];
(() => {
  for (const player of [Player.PLAYER0, Player.PLAYER1]) {
    for (const pieceKey in PIECES) {
      ALL_GAME_PIECES_FOR_PLAYERS.push({ type: pieceKey, player: player });
    }
  }
})();

// --- Initialize Zobrist Hashing ---
initializeZobrist();

// --- AI Worker ---
function initializeAiWorker() {
  if (aiWorker) {
    console.log("[Main] Terminating previous AI Worker.");
    aiWorker.terminate();
    aiWorker = null;
  }
  try {
    aiWorker = new Worker("js/aiWorker.js", { type: "module" });
    console.log("[Main] AI Worker created successfully (as module).");
    aiWorker.onmessage = handleAiWorkerMessage;
    aiWorker.onerror = handleAiWorkerError;
  } catch (e) {
    console.error("Failed to create AI Worker:", e);
    updateStatus("errorWorkerInit", {}, true);
    setGameOver(Player.PLAYER0, GameStatus.PLAYER0_WINS);
    updateWinChanceBar(null);
  }
}

function handleAiWorkerMessage(e) {
  isAiThinking = false;
  const {
    move: bestMoveData,
    depthAchieved,
    nodes,
    eval: score,
    error,
  } = e.data;
  updateAiDepthDisplay(depthAchieved ?? "?");
  if (score !== null && score !== undefined && isFinite(score)) {
    lastEvalScore = score;
    updateWinChanceBar(lastEvalScore);
  } else if (!error) {
    lastEvalScore = null;
  }

  if (error) {
    console.error("[Main] AI Worker reported error:", error);
    const errorKey =
      error === "No moves available"
        ? "errorAINoMoves"
        : error === "Fallback piece missing"
        ? "errorAIFallback"
        : error === "Move gen error"
        ? "errorAIMove"
        : "errorAIWorker";
    updateStatus(errorKey, {}, true);
    setGameOver(Player.PLAYER0, GameStatus.PLAYER0_WINS);
    playSound("victory");
    renderBoard(board.getState(), handleSquareClick, lastMove);
    updateTurnDisplay(currentPlayer, gameModeSelect.value, isGameOver);
    return;
  }
  if (bestMoveData) {
    const pieceToMove = board.getPiece(
      bestMoveData.fromRow,
      bestMoveData.fromCol
    );
    if (
      pieceToMove &&
      pieceToMove.player === aiPlayer &&
      pieceToMove.name === bestMoveData.pieceName
    ) {
      const targetPiece = board.getPiece(
        bestMoveData.toRow,
        bestMoveData.toCol
      );
      performMoveWithAnimation(
        pieceToMove,
        bestMoveData.toRow,
        bestMoveData.toCol,
        bestMoveData.fromRow,
        bestMoveData.fromCol,
        targetPiece
      );
    } else {
      updateStatus("errorAISync", {}, true);
      setGameOver(Player.PLAYER0, GameStatus.PLAYER0_WINS);
      playSound("victory");
      renderBoard(board.getState(), handleSquareClick, lastMove);
      updateTurnDisplay(currentPlayer, gameModeSelect.value, isGameOver);
    }
  } else {
    const allAiMoves = rules.getAllValidMoves(
      aiPlayer,
      board.getClonedStateForWorker()
    );
    if (allAiMoves.length === 0) {
      updateStatus("statusWin", { winner: getString("player1Name") }, false);
      setGameOver(Player.PLAYER0, GameStatus.PLAYER0_WINS);
      playSound("victory");
    } else {
      updateStatus("errorAIMove", {}, true);
      setGameOver(Player.PLAYER0, GameStatus.PLAYER0_WINS);
      playSound("victory");
    }
    renderBoard(board.getState(), handleSquareClick, lastMove);
    updateTurnDisplay(currentPlayer, gameModeSelect.value, isGameOver);
  }
}

function handleAiWorkerError(event) {
  console.error(
    `[Main] Error from AI Worker: Msg:${event.message}, File:${event.filename}, Line:${event.lineno}`,
    event
  );
  updateStatus("errorAIWorker", {}, true);
  isAiThinking = false;
  lastEvalScore = null;
  updateWinChanceBar(lastEvalScore);
  if (!isGameOver) {
    setGameOver(Player.PLAYER0, GameStatus.PLAYER0_WINS);
    playSound("victory");
    renderBoard(board.getState(), handleSquareClick, lastMove);
  }
}

export function initGame() {
  console.log(
    "Initializing game with layout:",
    initialBoardLayoutConfig === STANDARD_LAYOUT_ID
      ? "Standard"
      : "Custom/Randomized"
  );
  // Cache UI elements if not already done
  difficultySelect = difficultySelect || document.getElementById("difficulty");
  timeLimitInput = timeLimitInput || document.getElementById("time-limit");
  resetButton = resetButton || document.getElementById("reset-button");
  langSelect = langSelect || document.getElementById("lang-select");
  gameModeSelect = gameModeSelect || document.getElementById("game-mode");
  aiControlsContainer =
    aiControlsContainer || document.getElementById("ai-controls");
  undoButton = undoButton || document.getElementById("undo-button");
  playerStartsSelect =
    playerStartsSelect || document.getElementById("player-starts-select");
  randomizeBoardButton =
    randomizeBoardButton || document.getElementById("randomize-board-button");

  // Initialize board object (terrain setup, clear pieces)
  board.initBoard(); // Assumes this now prepares terrain and clears existing pieces

  // Place pieces based on the current initialBoardLayoutConfig
  if (initialBoardLayoutConfig === STANDARD_LAYOUT_ID) {
    board.setupStandardInitialPieces();
  } else if (Array.isArray(initialBoardLayoutConfig)) {
    board.setupPiecesFromLayout(initialBoardLayoutConfig);
  } else {
    console.error(
      "Invalid initialBoardLayoutConfig! Falling back to standard."
    );
    board.setupStandardInitialPieces();
    initialBoardLayoutConfig = STANDARD_LAYOUT_ID; // Reset to avoid further issues
  }

  initializeLandTilePatterns(board.getState());

  if (!aiWorker) {
    initializeAiWorker();
  } else if (isAiThinking) {
    console.log("[Main] Resetting during AI calculation, terminating worker.");
    aiWorker.terminate();
    initializeAiWorker();
  }

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
  gameStateHistory = [];
  updateUndoButtonState(false);

  const startingPlayerValue = playerStartsSelect
    ? parseInt(playerStartsSelect.value, 10)
    : Player.PLAYER0;
  currentPlayer =
    startingPlayerValue === Player.PLAYER1 ? Player.PLAYER1 : Player.PLAYER0;

  repetitionMap.clear();
  try {
    const currentBoardStateForHash = board.getState();
    const initialHash = computeZobristKey(
      currentBoardStateForHash,
      currentPlayer
    );
    repetitionMap.set(initialHash, 1);
    console.log(
      `Board hash ${initialHash} (Player ${currentPlayer} to move) added to repetition map (Count: 1).`
    );
  } catch (e) {
    console.error("Error calculating initial Zobrist hash:", e);
  }

  updateAiDepthDisplay("0");
  if (difficultySelect) difficultySelect.value = aiTargetDepth.toString();
  if (timeLimitInput) timeLimitInput.value = aiTimeLimitMs.toString();

  clearMoveHistory();
  renderBoard(board.getState(), handleSquareClick, lastMove);
  renderCapturedPieces(capturedByPlayer0, capturedByPlayer1);
  updateGameStatusUI();
  updateWinChanceBar(null);

  setupUIListeners();
  console.log("Game Initialized. Current Turn:", currentPlayer);

  if (
    !isGameOver &&
    gameModeSelect?.value === "PVA" &&
    currentPlayer === aiPlayer &&
    !isAiThinking
  ) {
    setTimeout(triggerAiTurn, 250);
  }
}

// setupUIListeners
function setupUIListeners() {
  if (setupUIListeners.alreadyRun) return;
  setupUIListeners.alreadyRun = true;

  resetButton?.addEventListener("click", () => {
    console.log("Reset button clicked. Setting to standard layout.");
    initialBoardLayoutConfig = STANDARD_LAYOUT_ID;
    initGame();
  });
  langSelect?.addEventListener("change", async (event) => {
    await loadLanguage(event.target.value);
    applyLocalizationToPage();
    renderCapturedPieces(capturedByPlayer0, capturedByPlayer1);
    updateGameStatusUI();
    updateWinChanceBar(lastEvalScore);
    renderGameRules();
  });
  difficultySelect?.addEventListener("change", (event) => {
    aiTargetDepth = parseInt(event.target.value, 10);
  });
  timeLimitInput?.addEventListener("change", (event) => {
    let v = parseInt(event.target.value, 10);
    if (isNaN(v) || v < MIN_AI_TIME_LIMIT_MS) {
      v = MIN_AI_TIME_LIMIT_MS;
      event.target.value = v.toString();
    }
    aiTimeLimitMs = v;
  });
  gameModeSelect?.addEventListener("change", () => {
    const newMode = gameModeSelect.value;
    if (aiControlsContainer)
      aiControlsContainer.style.display = newMode === "PVA" ? "flex" : "none";
    if (isAiThinking) {
      if (aiWorker) aiWorker.terminate();
      aiWorker = null;
      isAiThinking = false;
      initializeAiWorker();
    }
    updateGameStatusUI();
    if (!isGameOver && newMode === "PVA" && currentPlayer === aiPlayer)
      setTimeout(triggerAiTurn, 150);
  });
  undoButton?.addEventListener("click", () => undoMove());
  if (aiControlsContainer && gameModeSelect)
    aiControlsContainer.style.display =
      gameModeSelect.value === "PVA" ? "flex" : "none";
  playerStartsSelect?.addEventListener("change", () => {
    initGame();
  });
  randomizeBoardButton?.addEventListener("click", handleRandomizeBoard);
}
setupUIListeners.alreadyRun = false;

function handleRandomizeBoard() {
  console.log("Generating randomized board layout with 180-degree symmetry...");

  if (isAiThinking) {
    console.log("AI is thinking, terminating worker before randomizing.");
    if (aiWorker) aiWorker.terminate();
    isAiThinking = false;
    initializeAiWorker();
  }

  const tempBoardForLayout = new Board(); // Used only for terrain info
  tempBoardForLayout.initBoard(); // Sets up terrain

  const animalTypes = [
    "rat",
    "cat",
    "dog",
    "wolf",
    "leopard",
    "tiger",
    "lion",
    "elephant",
  ];
  shuffleArray(animalTypes);

  const candidatePrimarySpots = [];
  const centerR = Math.floor(BOARD_ROWS / 2);
  const centerC = Math.floor(BOARD_COLS / 2);
  const d5Key = `${centerR}-${centerC}`;

  for (let r = 0; r < BOARD_ROWS; r++) {
    for (let c = 0; c < BOARD_COLS; c++) {
      const currentKey = `${r}-${c}`;
      const rSym = BOARD_ROWS - 1 - r;
      const cSym = BOARD_COLS - 1 - c;

      if (currentKey === d5Key) continue; // D5 is always skipped

      const isPrimaryHalf = r < rSym || (r === rSym && c < cSym);

      if (isPrimaryHalf) {
        const isP1Den = r === PLAYER1_DEN_ROW && c === PLAYER1_DEN_COL;
        const isP0Den = r === PLAYER0_DEN_ROW && c === PLAYER0_DEN_COL;
        if (isP1Den || isP0Den) continue;

        const isSymP1Den = rSym === PLAYER1_DEN_ROW && cSym === PLAYER1_DEN_COL;
        const isSymP0Den = rSym === PLAYER0_DEN_ROW && cSym === PLAYER0_DEN_COL;
        if (isSymP1Den || isSymP0Den) continue;

        candidatePrimarySpots.push({ r_primary: r, c_primary: c });
      }
    }
  }
  shuffleArray(candidatePrimarySpots);

  const generatedLayout = [];
  let currentAnimalTypeIndex = 0;
  let primarySpotAttemptIndex = 0;

  while (
    currentAnimalTypeIndex < animalTypes.length &&
    primarySpotAttemptIndex < candidatePrimarySpots.length
  ) {
    const animalType = animalTypes[currentAnimalTypeIndex];
    const primaryCandidate = candidatePrimarySpots[primarySpotAttemptIndex];

    const r_primary = primaryCandidate.r_primary;
    const c_primary = primaryCandidate.c_primary;
    const r_symmetric = BOARD_ROWS - 1 - r_primary;
    const c_symmetric = BOARD_COLS - 1 - c_primary;

    const terrain_primary = tempBoardForLayout.getTerrain(r_primary, c_primary);
    const terrain_symmetric = tempBoardForLayout.getTerrain(
      r_symmetric,
      c_symmetric
    );

    let placementValidForThisAnimalType = true;
    if (animalType !== "rat") {
      if (
        terrain_primary === TERRAIN_WATER ||
        terrain_symmetric === TERRAIN_WATER
      ) {
        placementValidForThisAnimalType = false;
      }
    }

    if (placementValidForThisAnimalType) {
      generatedLayout.push({
        type: animalType,
        player: Player.PLAYER1,
        r: r_primary,
        c: c_primary,
      });
      generatedLayout.push({
        type: animalType,
        player: Player.PLAYER0,
        r: r_symmetric,
        c: c_symmetric,
      });

      currentAnimalTypeIndex++;
      candidatePrimarySpots.splice(primarySpotAttemptIndex, 1);
    } else {
      primarySpotAttemptIndex++;
    }
  }

  if (generatedLayout.length < 16) {
    // 8 types * 2 players
    console.error(
      "Could not generate a full valid symmetric layout. Sticking to current/standard board."
    );
    updateStatus("errorRandomizeSymmetry", {}, true);
    return;
  }

  initialBoardLayoutConfig = generatedLayout;
  console.log(
    "Successfully generated randomized layout. Initializing game with it."
  );
  initGame();
}

function saveCurrentStateToHistory() {
  try {
    const currentState = board.getClonedStateForWorker();
    const playerWhoJustMoved = currentPlayer;
    const nextPlayerTurn = Player.getOpponent(playerWhoJustMoved);
    const hashOfCurrentStateAndNextTurn = computeZobristKey(
      currentState,
      nextPlayerTurn
    );
    const stateEntry = {
      boardState: currentState,
      currentPlayer: nextPlayerTurn,
      capturedP0: [...capturedByPlayer0],
      capturedP1: [...capturedByPlayer1],
      lastMove: lastMove ? { ...lastMove } : null,
      lastEval: lastEvalScore,
      isGameOver: isGameOver,
      gameStatus: gameStatus,
      hashOfThisState: hashOfCurrentStateAndNextTurn,
    };
    gameStateHistory.push(stateEntry);
    updateUndoButtonState(true);
  } catch (error) {
    console.error("Error saving game state to history:", error);
    updateUndoButtonState(false);
  }
}

function selectPiece(piece, row, col) {
  if (isGameOver || isAiThinking) return;
  deselectPiece();
  selectedPieceInfo = { piece, row, col };
  validMovesCache = rules.getValidMovesForPiece(
    piece,
    row,
    col,
    board.getState()
  );
  highlightSquare(row, col, "selected");
  validMovesCache.forEach((move) => {
    highlightSquare(move.row, move.col, "possible-move");
    const targetPiece = board.getPiece(move.row, move.col);
    if (targetPiece && targetPiece.player !== currentPlayer) {
      highlightSquare(move.row, move.col, "capture-move");
    }
  });
  updateGameStatusUI();
}
function deselectPiece() {
  if (selectedPieceInfo) {
    clearHighlights("selected");
    clearHighlights("possible-move");
    clearHighlights("capture-move");
    selectedPieceInfo = null;
    validMovesCache = [];
  }
}
function handleSquareClick(row, col) {
  if (
    isGameOver ||
    isAiThinking ||
    (gameModeSelect.value === "PVA" && currentPlayer === aiPlayer)
  )
    return;
  const clickedPiece = board.getPiece(row, col);
  if (selectedPieceInfo) {
    const isValidDestination = validMovesCache.some(
      (move) => move.row === row && move.col === col
    );
    if (isValidDestination) {
      const pieceToMove = selectedPieceInfo.piece;
      const fromRow = selectedPieceInfo.row;
      const fromCol = selectedPieceInfo.col;
      const targetPiece = board.getPiece(row, col);
      deselectPiece();
      performMoveWithAnimation(
        pieceToMove,
        row,
        col,
        fromRow,
        fromCol,
        targetPiece
      );
    } else {
      const originalSelection = { ...selectedPieceInfo };
      deselectPiece();
      if (
        clickedPiece &&
        clickedPiece.player === currentPlayer &&
        !(
          clickedPiece.row === originalSelection.row &&
          clickedPiece.col === originalSelection.col
        )
      ) {
        selectPiece(clickedPiece, row, col);
      } else {
        updateGameStatusUI();
      }
    }
  } else if (clickedPiece && clickedPiece.player === currentPlayer) {
    selectPiece(clickedPiece, row, col);
  }
}

function updateBoardState(
  piece,
  toRow,
  toCol,
  fromRow,
  fromCol,
  capturedPiece
) {
  board.setPiece(fromRow, fromCol, null);
  board.setPiece(toRow, toCol, piece);
  if (capturedPiece) {
    if (currentPlayer === Player.PLAYER0) {
      capturedByPlayer0.push(capturedPiece);
    } else {
      capturedByPlayer1.push(capturedPiece);
    }
  }
  lastMove = {
    start: { r: fromRow, c: fromCol },
    end: { r: toRow, c: toCol },
    player: currentPlayer,
  };
}

function performMoveWithAnimation(piece, toRow, toCol, fromRow, fromCol, targetPiece) {
    if (isGameOver) return;

    const isCapture = targetPiece !== null && targetPiece.player !== piece.player;
    const capturedPieceData = isCapture ? { ...targetPiece } : null;

    // 1. Update logical board state
    updateBoardState(piece, toRow, toCol, fromRow, fromCol, capturedPieceData);

    // 2. Save state to history
    saveCurrentStateToHistory();

    // 3. Add to visual move list
    addMoveToHistory(piece, fromRow, fromCol, toRow, toCol, capturedPieceData);

    // 4. Get DOM elements for animation
    const boardElement = document.getElementById('board'); // Ensure this is always fresh

    const startSquareForAnimation = boardElement?.querySelector(`.square[data-row="${fromRow}"][data-col="${fromCol}"]`);
    // Use a more specific selector for the pieceElement, using data attributes set in renderBoard
    // Ensure piece.player is compared correctly if it's a number vs. string attribute.
    const pieceElementForAnimation = startSquareForAnimation?.querySelector(`.piece[data-piece-type="${piece.type}"][data-player="${piece.player}"]`);
    // Fallback to less specific selector if the above fails (though it shouldn't if renderBoard is correct)
    // const pieceElementForAnimation = startSquareForAnimation?.querySelector('.piece');


    const endSquareForAnimation = boardElement?.querySelector(`.square[data-row="${toRow}"][data-col="${toCol}"]`);

    if (pieceElementForAnimation && !document.body.contains(pieceElementForAnimation)) {
        console.error("[Game] performMoveWithAnimation: pieceElementForAnimation is DETACHED from DOM before calling animatePieceMove!");
    }
    if (!pieceElementForAnimation) {
         console.error("[Game] performMoveWithAnimation: FAILED to find pieceElementForAnimation on start square.");
         console.log(`[Game] Attempted to find piece with type: ${piece.type}, player: ${piece.player} on square ${fromRow},${fromCol}`);
         if(startSquareForAnimation) {
            console.log("[Game] Contents of startSquareForAnimation:", startSquareForAnimation.innerHTML);
         }
    }

    if (!pieceElementForAnimation || !startSquareForAnimation || !endSquareForAnimation) {
        console.warn("[Game] performMoveWithAnimation: DOM elements for animation not fully found, moving directly without animation.");
        // updateBoardState and saveCurrentStateToHistory already called
        // addMoveToHistory already called
        playSound(isCapture ? `capture_${getPieceKey(capturedPieceData?.name)}` : 'move');
        postMoveChecks(); // Proceed to next turn/checks
        return;
    }

    // Animate the visual move
    animatePieceMove(pieceElementForAnimation, startSquareForAnimation, endSquareForAnimation, isCapture, isCapture ? getPieceKey(capturedPieceData?.name) : null, () => {
        console.log("[Game] Animation complete callback: Running post-move checks.");
        postMoveChecks(); // Proceed to next turn/checks AFTER animation
    });
}

function postMoveChecks() {
  renderBoard(board.getState(), handleSquareClick, lastMove);
  renderCapturedPieces(capturedByPlayer0, capturedByPlayer1);
  const currentStatus = rules.getGameStatus(board.getState());
  if (currentStatus !== GameStatus.ONGOING) {
    const winner =
      currentStatus === GameStatus.PLAYER0_WINS
        ? Player.PLAYER0
        : currentStatus === GameStatus.PLAYER1_WINS
        ? Player.PLAYER1
        : Player.NONE;
    setGameOver(winner, currentStatus);
    updateWinChanceBar(
      currentStatus === GameStatus.PLAYER1_WINS
        ? Infinity
        : currentStatus === GameStatus.PLAYER0_WINS
        ? -Infinity
        : 0
    );
    let soundToPlay = "defeat";
    if (winner === Player.PLAYER0) soundToPlay = "victory";
    if (winner === Player.NONE || currentStatus === GameStatus.DRAW)
      soundToPlay = "draw";
    if (gameModeSelect.value === "PVP" && winner !== Player.NONE)
      soundToPlay = "victory";
    playSound(soundToPlay);
    updateGameStatusUI();
    return;
  }
  try {
    const boardStateForEval = board.getClonedStateForWorker();
    lastEvalScore = evaluateBoard(boardStateForEval);
  } catch (e) {
    lastEvalScore = null;
  }
  updateWinChanceBar(lastEvalScore);
  switchPlayer();
  try {
    const currentHash = computeZobristKey(board.getState(), currentPlayer);
    const count = (repetitionMap.get(currentHash) || 0) + 1;
    repetitionMap.set(currentHash, count);
    if (count >= 3) {
      setGameOver(Player.NONE, GameStatus.DRAW);
      playSound("draw");
      updateGameStatusUI();
      return;
    }
  } catch (e) {
    console.error("Error checking repetition:", e);
  }
  updateGameStatusUI();
  if (
    !isGameOver &&
    gameModeSelect.value === "PVA" &&
    currentPlayer === aiPlayer &&
    !isAiThinking
  ) {
    setTimeout(triggerAiTurn, 150);
  }
}

function switchPlayer() {
  currentPlayer = Player.getOpponent(currentPlayer);
  deselectPiece();
}
function setGameOver(winner, status) {
  if (isGameOver) return;
  isGameOver = true;
  gameStatus = status;
  deselectPiece();
}

function updateGameStatusUI() {
  let statusKey = "statusLoading";
  let statusParams = {};
  let displayPlayerLabel = "";
  if (gameModeSelect.value === "PVP") {
    displayPlayerLabel = getString(
      currentPlayer === Player.PLAYER0 ? "player1Name" : "player2Name"
    );
  } else {
    displayPlayerLabel = getString(
      currentPlayer === Player.PLAYER0 ? "playerName" : "aiName"
    );
  }
  if (isGameOver) {
    if (gameStatus === GameStatus.DRAW) {
      statusKey = "statusDrawRepetition";
    } else {
      let winnerLabel = "";
      if (gameStatus === GameStatus.PLAYER0_WINS)
        winnerLabel = getString("player1Name");
      else if (gameStatus === GameStatus.PLAYER1_WINS) {
        winnerLabel =
          gameModeSelect.value === "PVA"
            ? getString("aiName")
            : getString("player2Name");
      }
      statusKey = "statusWin";
      statusParams = { winner: winnerLabel };
    }
  } else if (isAiThinking) {
    statusKey = "statusAIThinking";
    statusParams = { aiName: getString("aiName") };
  } else if (selectedPieceInfo) {
    statusKey = "statusPlayerSelected";
    const pieceLocaleKey = `animal_${selectedPieceInfo.piece.type}`;
    const pieceName = getString(pieceLocaleKey);
    statusParams = {
      player: displayPlayerLabel,
      pieceName:
        pieceName !== pieceLocaleKey ? pieceName : selectedPieceInfo.piece.name,
    };
  } else {
    statusKey = "statusWaitingPlayer";
    statusParams = { player: displayPlayerLabel };
  }
  updateStatus(statusKey, statusParams);
  updateTurnDisplay(currentPlayer, gameModeSelect.value, isGameOver);
}

function triggerAiTurn() {
  if (isGameOver || isAiThinking || currentPlayer !== aiPlayer || !aiWorker) {
    return;
  }
  isAiThinking = true;
  updateGameStatusUI();
  updateAiDepthDisplay("-");
  let boardStateForWorker;
  try {
    boardStateForWorker = board.getClonedStateForWorker();
  } catch (e) {
    updateStatus("errorBoardClone", {}, true);
    isAiThinking = false;
    lastEvalScore = null;
    updateWinChanceBar(lastEvalScore);
    setGameOver(Player.PLAYER0, GameStatus.PLAYER0_WINS);
    playSound("victory");
    return;
  }
  aiWorker.postMessage({
    boardState: boardStateForWorker,
    targetDepth: aiTargetDepth,
    timeLimit: aiTimeLimitMs,
  });
}

function undoMove() {
  if (isAiThinking) {
    if (aiWorker) aiWorker.terminate();
    isAiThinking = false;
    initializeAiWorker();
  }
  let undoCount = 0;
  const mode = gameModeSelect?.value || "PVA";
  if (gameStateHistory.length > 0) {
    undoCount = 1;
    if (mode === "PVA" && gameStateHistory.length >= 2) {
      const stateBeforeLast = gameStateHistory[gameStateHistory.length - 2];
      if (stateBeforeLast.currentPlayer === aiPlayer) {
        undoCount = 2;
      }
    }
  }
  if (undoCount === 0 || gameStateHistory.length < undoCount) {
    updateUndoButtonState(gameStateHistory.length > 0);
    return;
  }
  let stateToRestoreData = null;
  for (let i = 0; i < undoCount; i++) {
    if (gameStateHistory.length === 0) {
      initGame();
      return;
    }
    const poppedStateData = gameStateHistory.pop();
    if (poppedStateData && poppedStateData.hashOfThisState) {
      const hashToDecrement = poppedStateData.hashOfThisState;
      try {
        let currentCount = repetitionMap.get(hashToDecrement);
        if (currentCount !== undefined && currentCount > 0) {
          currentCount--;
          if (currentCount === 0) {
            repetitionMap.delete(hashToDecrement);
          } else {
            repetitionMap.set(hashToDecrement, currentCount);
          }
        }
      } catch (e) {
        console.error("Error decrementing repetition map:", e);
      }
    }
    removeLastMoveFromHistory();
  }
  if (gameStateHistory.length === 0) {
    initGame();
    return;
  } else {
    stateToRestoreData = gameStateHistory[gameStateHistory.length - 1];
  }
  try {
    if (
      !stateToRestoreData ||
      !stateToRestoreData.boardState ||
      !Array.isArray(stateToRestoreData.boardState)
    ) {
      throw new Error("Invalid state data for restoration.");
    }
    board.state = stateToRestoreData.boardState.map((row) => {
      if (!Array.isArray(row))
        throw new Error("Invalid row structure in restore data.");
      return row.map((cell) => {
        if (!cell || typeof cell.terrain !== "number")
          throw new Error("Invalid cell structure in restore data.");
        return {
          terrain: cell.terrain,
          piece: cell.piece
            ? new Piece(
                cell.piece.type,
                cell.piece.player,
                cell.piece.row,
                cell.piece.col
              )
            : null,
        };
      });
    });
    currentPlayer = stateToRestoreData.currentPlayer;
    capturedByPlayer0 = [...stateToRestoreData.capturedP0];
    capturedByPlayer1 = [...stateToRestoreData.capturedP1];
    lastMove = stateToRestoreData.lastMove
      ? { ...stateToRestoreData.lastMove }
      : null;
    lastEvalScore = stateToRestoreData.lastEval;
    isGameOver = stateToRestoreData.isGameOver;
    gameStatus = stateToRestoreData.gameStatus;
  } catch (error) {
    initGame();
    return;
  }
  deselectPiece();
  renderBoard(board.getState(), handleSquareClick, lastMove);
  renderCapturedPieces(capturedByPlayer0, capturedByPlayer1);
  updateGameStatusUI();
  updateWinChanceBar(lastEvalScore);
  updateUndoButtonState(gameStateHistory.length > 0);
}
// No direct default export for game.js, initGame is exported and called by main.js
