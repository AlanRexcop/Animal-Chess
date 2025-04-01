// js/main.js

// Import the Board class
import { Board } from './board.js';

// Import the main rendering function
import { renderBoard } from './renderer.js';

// --- Main Game Setup ---

// 1. Create an instance of the Board.
//    The Board constructor automatically calls initBoard(), which sets up
//    terrain and calls _setupInitialPieces().
const board = new Board();

// 2. Perform the initial rendering of the board state to the DOM.
renderBoard(board);

// --- Console Log for Verification ---
console.log("Game initialized. Board state created:");
console.log(board.state); // Log the internal state for debugging
console.log("Initial board rendered.");

// --- Next Steps (Placeholder Comments) ---
// TODO: Import game logic controller (e.g., from game.js)
// TODO: Import event listener setup from renderer.js
// TODO: Initialize game logic (e.g., game.initGame(board))
// TODO: Add event listeners (e.g., renderer.addBoardEventListeners(game.handleSquareClick))