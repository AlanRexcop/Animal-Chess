// js/main.js
import { initGame } from './game.js'; // Import the initializer from game.js

// Initialize the game when the script loads
// This single call will create the board, set up pieces/terrain,
// render the initial state, and attach click handlers via renderer.js
initGame();

console.log("Animal Chess Loaded and Initialized via game.js");