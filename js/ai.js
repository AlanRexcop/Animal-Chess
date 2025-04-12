// js/ai.js

// Imports (adjust paths as necessary)
import { Player, AnimalRanks, GameStatus } from './constants.js';
import { getAllValidMoves, getGameStatus } from './rules.js'; // Assuming getAllValidMoves exists and returns full move objects
import { Board } from './board.js';
import { Piece } from './piece.js';

/**
 * Performs a deep copy of the board state array, creating new Piece instances.
 * Necessary to avoid modifying the original state during AI simulation.
 * @param {Array<Array<{piece: Piece|null, terrain: string}>>} state - The 2D board state array.
 * @returns {Array<Array<{piece: Piece|null, terrain: string}>>} - A new, independent copy of the state.
 */
function deepCopyBoardState(state) {
    return state.map(row =>
        row.map(square => ({
            terrain: square.terrain,
            // Create a new Piece instance if one exists, otherwise null
            piece: square.piece ? new Piece(square.piece.type, square.piece.player, square.piece.row, square.piece.col) : null
        }))
    );
}

/**
 * Applies a given move to a board state and returns a NEW board object
 * representing the state *after* the move. Does not modify the original board.
 * @param {Board} originalBoard - The board object representing the state *before* the move.
 * @param {object} move - The move object, e.g., { piece, startRow, startCol, endRow, endCol }.
 * @returns {Board} - A new Board object reflecting the state after the move.
 */
function applyMove(originalBoard, move) {
    const newBoard = new Board(); // Create a new Board instance

    // Deep copy the state from the original board
    newBoard.state = deepCopyBoardState(originalBoard.getState());

    // Get the reference to the *cloned* piece from the *new* board state
    // Note: The 'piece' object within the 'move' object might be from the *original* board,
    // so it's safer to re-fetch the piece from the newBoard's state using coordinates.
    const pieceToMove = newBoard.getPiece(move.startRow, move.startCol);

    if (pieceToMove) {
        // Apply the move on the new board using its methods
        // setPiece should handle updating the piece's internal row/col and clearing the old square
        newBoard.setPiece(move.endRow, move.endCol, pieceToMove); // Place the piece in the new location (handles capture implicitly)
        newBoard.setPiece(move.startRow, move.startCol, null);  // Clear the starting square *after* getting the piece
    } else {
        console.error("AI applyMove Error: No piece found at start coords in cloned state", move, newBoard.state);
        // If this error occurs, there might be an issue with the deep copy or move generation.
        // Return the unchanged newBoard to avoid further errors down the line.
    }

    return newBoard;
}

/**
 * Evaluates the board state from the perspective of a given player (aiPlayer).
 * Higher scores are better for the aiPlayer.
 * Basic implementation uses material count and win/loss conditions.
 * @param {Board} board - The Board object to evaluate.
 * @param {string} aiPlayer - The player identifier (e.g., Player.PLAYER2) for whom to evaluate.
 * @returns {number} - The evaluation score. Higher is better for aiPlayer.
 */
function evaluateBoard(board, aiPlayer) {
    const opponentPlayer = Player.getOpponent(aiPlayer);
    const status = getGameStatus(board); // Check for win/loss first

    // --- Win/Loss Conditions ---
    if (status === GameStatus.P1_WINS) {
        return (aiPlayer === Player.PLAYER1) ? Infinity : -Infinity;
    }
    if (status === GameStatus.P2_WINS) {
        return (aiPlayer === Player.PLAYER2) ? Infinity : -Infinity;
    }
    // Add draw condition if applicable
    // if (status === GameStatus.DRAW) {
    //     return 0;
    // }

    // --- Material Count ---
    let aiScore = 0;
    let opponentScore = 0;
    const boardState = board.getState();

    for (let r = 0; r < boardState.length; r++) {
        for (let c = 0; c < boardState[r].length; c++) {
            const piece = boardState[r][c].piece;
            if (piece) {
                const rankValue = AnimalRanks[piece.type] || 0; // Get rank value
                if (piece.player === aiPlayer) {
                    aiScore += rankValue;
                } else if (piece.player === opponentPlayer) {
                    opponentScore += rankValue;
                }
            }
        }
    }

    // Simple material difference
    const score = aiScore - opponentScore;

    // --- Potential Future Enhancements ---
    // TODO: Add positional bonuses (e.g., proximity to enemy den)
    // TODO: Add piece safety checks (is a piece attacked?)
    // TODO: Add control of key squares (traps)

    return score;
}


/**
 * Implements the Minimax algorithm with Alpha-Beta Pruning to find the best score
 * for the aiPlayer from a given board state.
 * @param {Board} board - The current board state object for this node in the search tree.
 * @param {number} depth - How many moves deeper to search.
 * @param {number} alpha - The best score found so far for the maximizing player (AI). Initial call: -Infinity.
 * @param {number} beta - The best score found so far for the minimizing player (Human). Initial call: +Infinity.
 * @param {boolean} isMaximizingPlayer - True if the current move is for the AI (maximizing), False for the opponent (minimizing).
 * @param {string} aiPlayer - The identifier of the AI player (e.g., Player.PLAYER2).
 * @returns {number} - The evaluated score for this branch of the search tree.
 */
function minimax(board, depth, alpha, beta, isMaximizingPlayer, aiPlayer) {
    const status = getGameStatus(board);

    // Base case: depth limit reached or game is over
    if (depth === 0 || status !== GameStatus.ONGOING) {
        return evaluateBoard(board, aiPlayer);
    }

    const currentPlayer = isMaximizingPlayer ? aiPlayer : Player.getOpponent(aiPlayer);
    const possibleMoves = getAllValidMoves(board, currentPlayer); // Assumes returns Array<{ piece, startRow, startCol, endRow, endCol }>

    if (isMaximizingPlayer) {
        let maxEval = -Infinity;
        for (const move of possibleMoves) {
            const childBoard = applyMove(board, move); // Get the board state after the move
            const evaluation = minimax(childBoard, depth - 1, alpha, beta, false, aiPlayer); // Recursive call for minimizing player
            maxEval = Math.max(maxEval, evaluation);
            alpha = Math.max(alpha, evaluation); // Update alpha
            if (beta < alpha) {
                break; // Beta cut-off (opponent won't allow this branch)
            }
        }
        // If no moves possible from this state, evaluate the current state
        if (possibleMoves.length === 0) {
            return evaluateBoard(board, aiPlayer);
        }
        return maxEval;
    } else { // Minimizing player (Human opponent)
        let minEval = Infinity;
        for (const move of possibleMoves) {
            const childBoard = applyMove(board, move); // Get the board state after the move
            const evaluation = minimax(childBoard, depth - 1, alpha, beta, true, aiPlayer); // Recursive call for maximizing player
            minEval = Math.min(minEval, evaluation);
            beta = Math.min(beta, evaluation); // Update beta
            if (beta < alpha) {
                break; // Alpha cut-off (AI won't choose the earlier path leading here)
            }
        }
         // If no moves possible from this state, evaluate the current state
        if (possibleMoves.length === 0) {
            return evaluateBoard(board, aiPlayer);
        }
        return minEval;
    }
}


/**
 * Finds the best move for the AI player using the minimax algorithm.
 * This is the main entry point called by game.js.
 * @param {Board} board - The current actual game board object.
 * @param {string} aiPlayer - The identifier of the AI player.
 * @param {number} searchDepth - How many moves deep the AI should search.
 * @returns {object|null} - The best move object { piece, startRow, startCol, endRow, endCol } or null if no move found.
 */
export function findBestMove(board, aiPlayer, searchDepth) {
    let bestScore = -Infinity;
    let bestMove = null;
    const possibleMoves = getAllValidMoves(board, aiPlayer); // Get moves for the AI

     // If no moves available, return null (stalemate or error)
    if (possibleMoves.length === 0) {
        console.warn("AI found no valid moves.");
        return null;
    }


    // Iterate through all possible moves for the AI at the current state
    for (const move of possibleMoves) {
        // Simulate the AI making this move
        const childBoard = applyMove(board, move);
        // Call minimax to evaluate the outcome, starting from the opponent's turn (minimizing)
        const moveScore = minimax(childBoard, searchDepth - 1, -Infinity, Infinity, false, aiPlayer);

        // If this move results in a better score than previously found best score
        if (moveScore > bestScore) {
            bestScore = moveScore;
            bestMove = move;
        }
        // Basic randomization for equal scores (optional, makes AI less predictable)
        else if (moveScore === bestScore) {
             if (Math.random() < 0.3) { // 30% chance to switch to an equally good move
                 bestMove = move;
             }
         }
    }

    if (!bestMove && possibleMoves.length > 0) {
        // Fallback: if somehow no best move was selected but moves exist, pick the first one.
        console.warn("AI couldn't determine a best move, picking the first available.");
        bestMove = possibleMoves[0];
    } else if (bestMove) {
         console.log(`AI recommending move: ${bestMove.piece.type} from (${bestMove.startRow},${bestMove.startCol}) to (${bestMove.endRow},${bestMove.endCol}) with score: ${bestScore}`);
    }


    return bestMove; // Return the move object that led to the best evaluation
}

// You might want to add other helper functions here if needed.