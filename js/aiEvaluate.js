import {
  BOARD_ROWS, BOARD_COLS,
  TERRAIN_TRAP, TERRAIN_WATER,
  PLAYER0_DEN_ROW, PLAYER0_DEN_COL, PLAYER1_DEN_ROW, PLAYER1_DEN_COL,
  Player,
  PIECES,
  GameStatus
} from './constants.js'; // Adjust path if needed (e.g., ../constants.js)

import {
  getGameStatus,
  getEffectiveRank,
  canCapture,
  isRiver
} from './rules.js';     // Adjust path if needed (e.g., ../rules.js)

// --- Evaluation Constants (Specific to this module) ---
// Exported so other modules (like search for early exit) can use them
export const WIN_SCORE = 20000;
export const LOSE_SCORE = -20000;
export const DRAW_SCORE = 0;
// --- Evaluation Parameters & Weights (Centralized Tuning Hub) ---
const EVAL_PARAMS = {
  HEURISTIC_WEIGHTS: { // Core weights for different factors
      MATERIAL: 1.0,        // Basic piece values
      ADVANCEMENT: 0.25,    // Encourages moving pieces forward
      DEN_PROXIMITY: 6.0,   // Encourages pieces near opponent's den
      ATTACK_THREAT: 1.5,   // Bonus for threatening opponent pieces directly
      JUMP_THREAT: 2.0,     // Bonus specifically for Lion/Tiger jump threats
      KEY_SQUARE: 0.5,      // Bonus for controlling important squares
      TRAPPED_PENALTY: -3.0, // Penalty for own piece in opponent's trap
      DEFENSE_PENALTY: -0.7 // Penalty for pieces being too far back (too defensive)
  },
  // Scaling divisors/factors for bonuses/penalties
  ADVANCEMENT_VALUE_SCALE_DIVISOR: 150.0, // How much piece value affects advancement bonus
  GENERAL_VALUE_SCALE_DIVISOR: 100.0,     // Common divisor for scaling bonuses/penalties by piece value
  DEN_PROXIMITY_VALUE_SCALE_DIVISOR: 150.0, // How much piece value affects den proximity bonus
  THREAT_VALUE_SCALE_DIVISOR: 100.0,      // How much piece value affects threat bonus
  // Thresholds and multipliers
  DEFENSE_PENALTY_START_ROW_OFFSET: 3,    // How many rows from baseline defense penalty starts
  DEN_PROXIMITY_MAX_DISTANCE: 15,         // Max distance considered for den proximity bonus calc
  DEN_PROXIMITY_ADV_FACTOR_THRESHOLD: 0.1,// Factor applied if piece isn't past halfway for den prox.
  ADJACENT_THREAT_DIVISOR: 4.0,           // How much less valuable adjacent threat is vs direct capture threat
  RAT_ELEPHANT_PROXIMITY_THRESHOLD: 2,    // Max distance for Rat/Elephant interaction bonus
  RAT_ELEPHANT_PROXIMITY_BONUS_FACTOR: 3.0 // Multiplier for Rat/Elephant proximity bonus
};

// Define strategic key squares (adjust based on strategy!)
// Format: 'row-col'
const keySquaresPlayer0 = new Set([ // Important for Player 0 (Blue)
  '4-2', '4-3', '4-4', // Center control
  '1-2', '1-4', '2-3'  // Squares near Red Traps/Den approach
]);
const keySquaresPlayer1 = new Set([ // Important for Player 1 (Red/AI)
  '4-2', '4-3', '4-4', // Center control
  '7-2', '7-4', '6-3'  // Squares near Blue Traps/Den approach
]);


// --- Helper Functions (Internal to this module) ---

/**
* Helper function to calculate the value of pieces threatened by jumps.
*/
const checkJumpThreat = (attackerPiece, targetR, targetC, riverCols, riverRows, board, defenderPlayer) => {
  // Check path clear using imported isRiver
  for (let i = 0; i < riverRows.length; i++) {
      // Ensure the square is river and not occupied
      if (!isRiver(riverRows[i], riverCols[i]) || board[riverRows[i]]?.[riverCols[i]]?.piece) {
          return 0; // Path blocked or not river
      }
  }
  // Check target square validity using imported constants
  if (targetR >= 0 && targetR < BOARD_ROWS && targetC >= 0 && targetC < BOARD_COLS) {
       const targetSquare = board[targetR]?.[targetC];
       const targetPiece = targetSquare?.piece;
       const targetTerrain = targetSquare?.terrain;
       // Cannot jump into water
       if (targetTerrain === TERRAIN_WATER) return 0;

      // If opponent piece is on target square
      if (targetPiece?.player === defenderPlayer) {
          // Check if the jump would be a valid capture using imported canCapture and PIECES
          if (canCapture(attackerPiece, targetPiece, attackerPiece.r, attackerPiece.c, targetR, targetC, board)) {
              // Return value of the piece threatened by the jump
              return PIECES[targetPiece.name.toLowerCase()]?.value ?? 0;
          }
      }
  }
  return 0; // No threat on this jump path
};

/**
* Helper function to calculate attack threat scores (orthogonal and jump threats).
* Now accepts EVAL_PARAMS to access weights and scaling factors.
*/
const calculateAttackThreat = (attackerPlayer, defenderPlayer, piecesByPlayer, currentBoard, EVAL_PARAMS) => {
  let threatBonus = 0;
  let jumpThreatBonus = 0;
  const weights = EVAL_PARAMS.HEURISTIC_WEIGHTS; // Convenience alias

  for (const attacker of piecesByPlayer[attackerPlayer]) {
      const attackerType = attacker.name.toLowerCase();

      // --- Regular orthogonal threats ---
      const potentialMoves = [
          { r: attacker.r - 1, c: attacker.c }, { r: attacker.r + 1, c: attacker.c },
          { r: attacker.r, c: attacker.c - 1 }, { r: attacker.r, c: attacker.c + 1 }
      ];
      for (const move of potentialMoves) {
          // Check bounds using imported BOARD_ROWS/COLS
          if (move.r >= 0 && move.r < BOARD_ROWS && move.c >= 0 && move.c < BOARD_COLS) {
              const targetPiece = currentBoard[move.r]?.[move.c]?.piece;
              // Check if target square has an opponent's piece
              if (targetPiece?.player === defenderPlayer) {
                  const targetValue = PIECES[targetPiece.name.toLowerCase()]?.value ?? 0;
                  // Use imported canCapture to check if the attack is valid
                  if (canCapture(attacker, targetPiece, attacker.r, attacker.c, move.r, move.c, currentBoard)) {
                      // Higher bonus if actual capture is possible
                      threatBonus += targetValue * weights.ATTACK_THREAT / EVAL_PARAMS.THREAT_VALUE_SCALE_DIVISOR;
                  } else {
                      // Smaller bonus for just being adjacent (creating pressure)
                      threatBonus += targetValue * (weights.ATTACK_THREAT / EVAL_PARAMS.ADJACENT_THREAT_DIVISOR) / EVAL_PARAMS.THREAT_VALUE_SCALE_DIVISOR;
                  }
              }
          }
      } // End orthogonal checks

      // --- Jump Threats (Lion, Tiger) ---
       if (attackerType === 'lion' || attackerType === 'tiger') {
           // Check vertical jump threats using imported isRiver
           if (isRiver(3, attacker.c)) { // Check if current column allows vertical jumps
               if (attacker.r === 2) { // Check jump down target
                   jumpThreatBonus += checkJumpThreat(attacker, 6, attacker.c, [attacker.c, attacker.c, attacker.c], [3, 4, 5], currentBoard, defenderPlayer);
               } else if (attacker.r === 6) { // Check jump up target
                   jumpThreatBonus += checkJumpThreat(attacker, 2, attacker.c, [attacker.c, attacker.c, attacker.c], [5, 4, 3], currentBoard, defenderPlayer);
               }
           }
           // Check horizontal jump threats (Lion only) using imported isRiver
           if (attackerType === 'lion') {
                if (isRiver(attacker.r, 1) && isRiver(attacker.r, 2)) { // River path cols 1-2
                    if (attacker.c === 0) jumpThreatBonus += checkJumpThreat(attacker, attacker.r, 3, [1, 2], [attacker.r, attacker.r], currentBoard, defenderPlayer); // Jump R from col 0
                    else if (attacker.c === 3) jumpThreatBonus += checkJumpThreat(attacker, attacker.r, 0, [1, 2], [attacker.r, attacker.r], currentBoard, defenderPlayer); // Jump L from col 3
                }
                if (isRiver(attacker.r, 4) && isRiver(attacker.r, 5)) { // River path cols 4-5
                    if (attacker.c === 3) jumpThreatBonus += checkJumpThreat(attacker, attacker.r, 6, [4, 5], [attacker.r, attacker.r], currentBoard, defenderPlayer); // Jump R from col 3
                    else if (attacker.c === 6) jumpThreatBonus += checkJumpThreat(attacker, attacker.r, 3, [4, 5], [attacker.r, attacker.r], currentBoard, defenderPlayer); // Jump L from col 6
                }
           }
       } // End jump checks
  } // End loop attackers

  // Combine bonuses, applying specific weight to jump threats
  return threatBonus + (jumpThreatBonus * weights.JUMP_THREAT / EVAL_PARAMS.THREAT_VALUE_SCALE_DIVISOR);
};


// --- Main Evaluation Function (Exported) ---

/**
* Evaluates the board state from the AI's perspective (Player.PLAYER1).
* Higher scores are better for the AI.
* RELIES ON IMPORTED constants.js and rules.js
* @param {Array<Array<object>>} currentBoard - The board state to evaluate.
* @returns {number} The evaluation score.
*/
export function evaluateBoard(currentBoard) {
  // 1. Check for Terminal State
  const status = getGameStatus(currentBoard);
  if (status === GameStatus.PLAYER1_WINS) return WIN_SCORE; // Use constant defined above
  if (status === GameStatus.PLAYER0_WINS) return LOSE_SCORE;// Use constant defined above
  if (status === GameStatus.DRAW) return 0;

  // 2. Setup for Calculation
  let aiScore = 0;
  let playerScore = 0;
  const piecesByPlayer = { [Player.PLAYER0]: [], [Player.PLAYER1]: [] };
  const weights = EVAL_PARAMS.HEURISTIC_WEIGHTS; // Use EVAL_PARAMS defined above

  // 3. Iterate Board Once: Gather pieces & calculate simple per-piece heuristics
  for (let r = 0; r < BOARD_ROWS; r++) {
      for (let c = 0; c < BOARD_COLS; c++) {
          const cell = currentBoard[r]?.[c];
          if (!cell) continue;
          const piece = cell.piece;
          if (!piece) continue;

          const player = piece.player;
          const pieceKey = piece.name.toLowerCase();
          const value = PIECES[pieceKey]?.value ?? 0; // Use imported PIECES

          // Store piece info with position for later use
          piecesByPlayer[player].push({ ...piece, r, c, terrain: cell.terrain });

          // Get reference to the correct score variable
          let scoreRef = (player === Player.PLAYER1) ? aiScore : playerScore;

          // a) Material Score: Basic value of the piece
          scoreRef += value * weights.MATERIAL;

          // b) Advancement Score: Bonus for moving towards opponent's side
          const advancement = (player === Player.PLAYER1) ? r : (BOARD_ROWS - 1 - r);
          scoreRef += advancement * weights.ADVANCEMENT * (value / EVAL_PARAMS.ADVANCEMENT_VALUE_SCALE_DIVISOR);

          // c) Defense Penalty: Penalize non-rat pieces staying too close to own baseline
          if (pieceKey !== 'rat') {
              const defenseRowThreshold = EVAL_PARAMS.DEFENSE_PENALTY_START_ROW_OFFSET;
              if (player === Player.PLAYER1 && r < defenseRowThreshold) { // AI piece near row 0
                  scoreRef += (r - defenseRowThreshold) * weights.DEFENSE_PENALTY * (value / EVAL_PARAMS.GENERAL_VALUE_SCALE_DIVISOR);
              }
              if (player === Player.PLAYER0 && r > (BOARD_ROWS - 1 - defenseRowThreshold)) { // Player piece near row 8
                  scoreRef += ((BOARD_ROWS - 1 - r) - defenseRowThreshold) * weights.DEFENSE_PENALTY * (value / EVAL_PARAMS.GENERAL_VALUE_SCALE_DIVISOR);
              }
          }

          // d) Trapped Penalty: Penalize being neutralized in an *opponent's* trap
          if (getEffectiveRank(piece, r, c, currentBoard) === 0 && cell.terrain === TERRAIN_TRAP) {
              scoreRef += weights.TRAPPED_PENALTY * (value / EVAL_PARAMS.GENERAL_VALUE_SCALE_DIVISOR);
          }

          // e) Key Square Bonus: Reward occupying strategic squares
          const squareKey = `${r}-${c}`;
          const keySquares = (player === Player.PLAYER1) ? keySquaresPlayer1 : keySquaresPlayer0;
          if (keySquares.has(squareKey)) {
              scoreRef += weights.KEY_SQUARE * (value / EVAL_PARAMS.GENERAL_VALUE_SCALE_DIVISOR);
          }

          // Update the correct player's score variable
          if (player === Player.PLAYER1) aiScore = scoreRef; else playerScore = scoreRef;
      }
  }

  // 4. Check for Wipeout (Safety check)
  if (piecesByPlayer[Player.PLAYER1].length === 0 && piecesByPlayer[Player.PLAYER0].length > 0) return LOSE_SCORE;
  if (piecesByPlayer[Player.PLAYER0].length === 0 && piecesByPlayer[Player.PLAYER1].length > 0) return WIN_SCORE;

  // 5. Complex Heuristics (using collected piece lists)

  // f) Den Proximity Bonus: Reward pieces getting close to the opponent's den
  piecesByPlayer[Player.PLAYER1].forEach(p => {
      const dist = Math.abs(p.r - PLAYER0_DEN_ROW) + Math.abs(p.c - PLAYER0_DEN_COL);
      const advancementFactor = (p.r >= Math.floor(BOARD_ROWS / 2)) ? 1.0 : EVAL_PARAMS.DEN_PROXIMITY_ADV_FACTOR_THRESHOLD;
      const pieceValue = PIECES[p.name.toLowerCase()]?.value ?? 0;
      aiScore += Math.max(0, EVAL_PARAMS.DEN_PROXIMITY_MAX_DISTANCE - dist) * weights.DEN_PROXIMITY * (pieceValue / EVAL_PARAMS.DEN_PROXIMITY_VALUE_SCALE_DIVISOR) * advancementFactor;
  });
  piecesByPlayer[Player.PLAYER0].forEach(p => {
      const dist = Math.abs(p.r - PLAYER1_DEN_ROW) + Math.abs(p.c - PLAYER1_DEN_COL);
      const advancementFactor = (p.r <= Math.floor(BOARD_ROWS / 2)) ? 1.0 : EVAL_PARAMS.DEN_PROXIMITY_ADV_FACTOR_THRESHOLD;
      const pieceValue = PIECES[p.name.toLowerCase()]?.value ?? 0;
      playerScore += Math.max(0, EVAL_PARAMS.DEN_PROXIMITY_MAX_DISTANCE - dist) * weights.DEN_PROXIMITY * (pieceValue / EVAL_PARAMS.DEN_PROXIMITY_VALUE_SCALE_DIVISOR) * advancementFactor;
  });

  // g) Attack Threat Bonus (Calls internal helper)
  aiScore += calculateAttackThreat(Player.PLAYER1, Player.PLAYER0, piecesByPlayer, currentBoard, EVAL_PARAMS);
  playerScore += calculateAttackThreat(Player.PLAYER0, Player.PLAYER1, piecesByPlayer, currentBoard, EVAL_PARAMS);

  // h) Specific Piece Interaction Bonus: Rat vs Elephant proximity
  const findPiece = (type, player) => piecesByPlayer[player].find(p => p.name.toLowerCase() === type);
  const ratProxThreshold = EVAL_PARAMS.RAT_ELEPHANT_PROXIMITY_THRESHOLD;
  const ratProxBonusFactor = EVAL_PARAMS.RAT_ELEPHANT_PROXIMITY_BONUS_FACTOR;

  const aiRat = findPiece('rat', Player.PLAYER1);
  const playerElephant = findPiece('elephant', Player.PLAYER0);
  if (aiRat && playerElephant && currentBoard[aiRat.r]?.[aiRat.c]?.terrain !== TERRAIN_WATER) {
      const dist = Math.abs(aiRat.r - playerElephant.r) + Math.abs(aiRat.c - playerElephant.c);
      if (dist <= ratProxThreshold) {
           aiScore += (ratProxThreshold + 1 - dist) * ratProxBonusFactor;
      }
  }

  const playerRat = findPiece('rat', Player.PLAYER0);
  const aiElephant = findPiece('elephant', Player.PLAYER1);
  if (playerRat && aiElephant && currentBoard[playerRat.r]?.[playerRat.c]?.terrain !== TERRAIN_WATER) {
      const dist = Math.abs(playerRat.r - aiElephant.r) + Math.abs(playerRat.c - aiElephant.c);
      if (dist <= ratProxThreshold) {
          playerScore += (ratProxThreshold + 1 - dist) * ratProxBonusFactor;
      }
  }

  // 6. Final Score Calculation
  return aiScore - playerScore;
}