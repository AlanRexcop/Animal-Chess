import {
    BOARD_ROWS, BOARD_COLS, 
    Player, PIECES, ANIMATION_DURATION,
} from './constants.js';
import { getString } from './localization.js';

// DOM Elements Cache
const boardElement = document.getElementById('board');
const boardContainerElement = document.getElementById('board-container');
const statusElement = document.getElementById('status');
const turnElement = document.getElementById('turn');
const capturedByPlayer0Container = document.querySelector('#captured-by-player0 .pieces-container');
const capturedByPlayer1Container = document.querySelector('#captured-by-player1 .pieces-container');
const moveListElement = document.getElementById('move-list');
const winChanceBarElement = document.getElementById('win-chance-bar');
const winChanceBarBlue = document.getElementById('win-chance-bar-blue');
const winChanceBarRed = document.getElementById('win-chance-bar-red');
const undoButton = document.getElementById('undo-button');

// Eval Conversion Constants
const WIN_SCORE_THRESHOLD = 19000;
const LOSE_SCORE_THRESHOLD = -19000;
const SIGMOID_SCALE_FACTOR = 0.0015;

// Highlight Targets Map
const highlightClassTargets = {
    'possible-move': '.action-highlight-overlay',
    'capture-move': '.action-highlight-overlay',
    'selected': '.square',
    'last-move-start-p0': '.highlight-overlay',
    'last-move-start-p1': '.highlight-overlay',
    'last-move-end-p0': '.highlight-overlay',
    'last-move-end-p1': '.highlight-overlay'
};

const ALL_LAST_MOVE_CLASSES = [
    'last-move-start-p0', 'last-move-start-p1',
    'last-move-end-p0', 'last-move-end-p1'
];

export function removeLastMoveFromHistory() {
    if (moveListElement && moveListElement.lastElementChild) {
        moveListElement.removeChild(moveListElement.lastElementChild);
        moveListElement.scrollTop = moveListElement.scrollHeight;
    }
    // Disable undo button if history becomes empty
    if (moveListElement && moveListElement.children.length === 0 && undoButton) {
        undoButton.disabled = true;
    }
}

export function updateUndoButtonState(canUndo) {
    if (undoButton) {
        undoButton.disabled = !canUndo;
    }
}

export function animatePieceMove(pieceElement, startSquare, endSquare, isCapture, capturedPieceType, onComplete) {
    if (!pieceElement || !startSquare || !endSquare || !boardContainerElement) { console.warn("Animation elements not found, completing move directly."); onComplete(); return; }
    const containerRect = boardContainerElement.getBoundingClientRect(); const startRect = pieceElement.getBoundingClientRect(); const endRect = endSquare.getBoundingClientRect();
    const initialTop = startRect.top - containerRect.top; const initialLeft = startRect.left - containerRect.left; const targetLeft = endRect.left - containerRect.left + (endRect.width / 2) - (startRect.width / 2); const targetTop = endRect.top - containerRect.top + (endRect.height / 2) - (startRect.height / 2);
    const capturedElement = endSquare.querySelector('.piece'); if (isCapture && capturedElement) { capturedElement.remove(); }
    boardContainerElement.appendChild(pieceElement); pieceElement.classList.add('piece-global-animating');
    pieceElement.style.left = `${initialLeft}px`; pieceElement.style.top = `${initialTop}px`; pieceElement.style.transform = 'none'; pieceElement.style.transition = 'none';
    requestAnimationFrame(() => { requestAnimationFrame(() => { pieceElement.style.transition = `left ${ANIMATION_DURATION / 1000}s ease-out, top ${ANIMATION_DURATION / 1000}s ease-out`; pieceElement.style.left = `${targetLeft}px`; pieceElement.style.top = `${targetTop}px`; }); });
    setTimeout(() => {
        pieceElement.style.transition = 'none'; pieceElement.classList.remove('piece-global-animating');
        const squareContent = endSquare.querySelector(':not(.highlight-overlay):not(.action-highlight-overlay)') || endSquare;
        squareContent.appendChild(pieceElement);
        pieceElement.style.position = ''; pieceElement.style.top = ''; pieceElement.style.left = ''; pieceElement.style.transform = '';
        const soundName = isCapture ? `capture_${capturedPieceType}` : 'move'; if (soundName && (!isCapture || capturedPieceType)) { playSound(soundName); }
        onComplete();
    }, ANIMATION_DURATION);
}

export function highlightSquare(row, col, className) {
    const square = boardElement?.querySelector(`.square[data-row="${row}"][data-col="${col}"]`);
    if (!square) return;

    const targetSelector = highlightClassTargets[className];
    if (!targetSelector) {
        console.warn(`Unknown highlight target for class: ${className}`);
        return;
    }

    const targetElement = square.querySelector(targetSelector) || (targetSelector === '.square' ? square : null);

    if (targetElement) {
        if (className === 'capture-move' && targetSelector === '.action-highlight-overlay') {
            targetElement.classList.remove('possible-move');
        }
        targetElement.classList.add(className);
    } else {
        console.warn(`Target element not found for selector '${targetSelector}' in square ${row},${col}`);
    }
}

export function clearHighlights(className) {
    const targetSelector = highlightClassTargets[className];

    if (!targetSelector) {
        if (className === 'last-move') {
            ALL_LAST_MOVE_CLASSES.forEach(cls => {
                const selector = highlightClassTargets[cls];
                if (selector) {
                    boardElement?.querySelectorAll(`${selector}.${cls}`).forEach(el => el.classList.remove(cls));
                }
            });
        } else {
            console.warn(`Unknown highlight target for clearing class: ${className}`);
        }
        return;
    }

    boardElement?.querySelectorAll(`${targetSelector}.${className}`).forEach(el => {
        el.classList.remove(className);
    });
}

export function updateStatus(messageKey, params = {}, isError = false) { if (!statusElement) return; const message = getString(messageKey, params); statusElement.textContent = message; statusElement.classList.toggle('error-message', isError); }
export function updateTurnDisplay(currentPlayer, gameMode = 'PVA', isGameOver = false) { if (!turnElement) return; if (isGameOver) { turnElement.textContent = '---'; return; } let playerLabelKey; if (gameMode === 'PVP') { playerLabelKey = (currentPlayer === Player.PLAYER0) ? 'player1Name' : 'player2Name'; } else { playerLabelKey = (currentPlayer === Player.PLAYER0) ? 'playerName' : 'aiName'; } turnElement.textContent = getString(playerLabelKey); }
export function renderCapturedPieces(capturedByPlayer0, capturedByPlayer1) { const renderPanel = (container, piecesList) => { if (!container) return; container.innerHTML = ''; if (piecesList.length === 0) { container.textContent = getString('capturedNone'); return; } piecesList.sort((a, b) => (PIECES[b.type]?.rank ?? 0) - (PIECES[a.type]?.rank ?? 0)); piecesList.forEach(p => { if (!p || !p.type) return; const el = document.createElement('span'); const capturingPlayer = Player.getOpponent(p.player); el.className = `captured-piece player${capturingPlayer}`; const img = document.createElement('img'); img.src = `assets/images/head_no_background/${p.type}.png`; img.alt = p.name || p.type; img.title = getString(`animal_${p.type}`) || p.name || p.type; el.appendChild(img); container.appendChild(el); }); }; renderPanel(capturedByPlayer0Container, capturedByPlayer0); renderPanel(capturedByPlayer1Container, capturedByPlayer1); }
export function addMoveToHistory(pieceData, fromR, fromC, toR, toC, capturedPieceData) { if (!moveListElement) return; const getAlgebraic = (r, c) => `${String.fromCharCode(65 + c)}${BOARD_ROWS - r}`; const startNotation = getAlgebraic(fromR, fromC); const endNotation = getAlgebraic(toR, toC); const pieceImgSrc = `assets/images/head_no_background/${pieceData.type}.png`; const pieceName = getString(`animal_${pieceData.type}`) || pieceData.name || pieceData.type; const pieceAlt = `${PIECES[pieceData.type]?.symbol || pieceName}`; let moveHtml = `<span class="piece-hist player${pieceData.player}"><img src="${pieceImgSrc}" alt="${pieceAlt}" title="${pieceName}"></span> ${startNotation} → ${endNotation}`; if (capturedPieceData) { const capturedImgSrc = `assets/images/head_no_background/${capturedPieceData.type}.png`; const capturedName = getString(`animal_${capturedPieceData.type}`) || capturedPieceData.name || capturedPieceData.type; const capturedAlt = `${PIECES[capturedPieceData.type]?.symbol || capturedName}`; moveHtml += ` (x <span class="piece-hist player${capturedPieceData.player}"><img src="${capturedImgSrc}" alt="${capturedAlt}" title="${capturedName}"></span>)`; } const li = document.createElement('li'); li.innerHTML = moveHtml; moveListElement.appendChild(li); moveListElement.scrollTop = moveListElement.scrollHeight; if (undoButton) undoButton.disabled = false;}
export function clearMoveHistory() { if (moveListElement) moveListElement.innerHTML = ''; if (undoButton) undoButton.disabled = true;}
export function playSound(soundName) { try { if (!soundName || typeof soundName !== 'string') { console.warn("playSound: Invalid sound name provided:", soundName); return; } const soundPath = `assets/sounds/${soundName.toLowerCase()}.mp3`; const audio = new Audio(soundPath); audio.play().catch(e => console.warn(`Sound playback failed for ${soundPath}:`, e.message || e)); } catch (e) { console.error("Error creating or playing sound:", e); } }
export function updateAiDepthDisplay(depth) { const el = document.getElementById('ai-depth-achieved'); if (el) { el.textContent = depth.toString(); } }
export function updateWinChanceBar(aiEvalScore) {
	if (!winChanceBarElement || !winChanceBarBlue || !winChanceBarRed) {
		console.error("Win chance bar elements not found!");
		return;
	}

	let player0Percent = 50; // Default for unknown/initial situations

	if (aiEvalScore === Infinity) {
		// Player 1 (AI/Red) has a winning position (or Player 0 has lost)
		player0Percent = 0;
	} else if (aiEvalScore === -Infinity) {
		// Player 0 (Blue) has a winning position (or Player 1 has lost)
		player0Percent = 100;
	} else if (aiEvalScore !== null && aiEvalScore !== undefined && isFinite(aiEvalScore)) {
		// Score is a finite number (this includes 0 for a draw)
		const playerEvalScore = -aiEvalScore; // Convert AI's (P1) score to P0's perspective
		const clampedScore = Math.max(LOSE_SCORE_THRESHOLD, Math.min(WIN_SCORE_THRESHOLD, playerEvalScore));
		const probability = 1 / (1 + Math.exp(-SIGMOID_SCALE_FACTOR * clampedScore));
		player0Percent = Math.round(probability * 100);
	} else {
		// Handles null, undefined, or NaN - default to 50%
		// This typically occurs at game start or if an evaluation is truly indeterminate.
		player0Percent = 50;
	}

	const player1Percent = 100 - player0Percent;

	winChanceBarBlue.style.width = `${player0Percent}%`;
	winChanceBarRed.style.width = `${player1Percent}%`; // Explicitly set red bar width
	winChanceBarElement.title = `Blue: ${player0Percent}% / Red: ${player1Percent}%`;
}