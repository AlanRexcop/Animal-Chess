#ifndef AI_ENGINE_H
#define AI_ENGINE_H

#include <stdint.h> // For int64_t (Zobrist keys)
#include <stdbool.h> // For bool

// --- Game Constants (mirrored from constants.js) ---
#define BOARD_ROWS 9
#define BOARD_COLS 7

typedef enum {
    TERRAIN_LAND = 0,
    TERRAIN_WATER = 1,
    TERRAIN_TRAP = 2,
    TERRAIN_PLAYER0_DEN = 3,
    TERRAIN_PLAYER1_DEN = 4
} TerrainType;

typedef enum {
    PLAYER_NONE = -1,
    PLAYER0 = 0, // Blue
    PLAYER1 = 1  // Red (AI)
} Player;

typedef enum {
    PIECE_TYPE_RAT = 0,
    PIECE_TYPE_CAT,
    PIECE_TYPE_DOG,
    PIECE_TYPE_WOLF,
    PIECE_TYPE_LEOPARD,
    PIECE_TYPE_TIGER,
    PIECE_TYPE_LION,
    PIECE_TYPE_ELEPHANT,
    NUM_PIECE_TYPES, // Count of actual piece types
    NO_PIECE // Special value for empty square or invalid piece
} PieceType;

typedef struct {
    PieceType type;
    Player player;
    int rank;
    int value;
} Piece;

extern const Piece PIECE_INFO[NUM_PIECE_TYPES];

#define PLAYER0_DEN_ROW 8
#define PLAYER0_DEN_COL 3
#define PLAYER1_DEN_ROW 0
#define PLAYER1_DEN_COL 3

typedef enum {
    GAME_STATUS_INIT,
    GAME_STATUS_ONGOING,
    GAME_STATUS_PLAYER0_WINS,
    GAME_STATUS_PLAYER1_WINS,
    GAME_STATUS_DRAW
} GameStatus;

// --- Evaluation Constants ---
#define WIN_SCORE 20000
#define LOSE_SCORE -20000
#define DRAW_SCORE 0

// --- AI Internal Constants ---
#define MAX_PLY_FOR_KILLERS 30
#define TRANSPOSITION_TABLE_SIZE (1 << 20) 
#define MAX_Q_DEPTH 4 // Max depth for quiescence search
#define HISTORY_TABLE_SIZE (NUM_PIECE_TYPES * BOARD_ROWS * BOARD_COLS) // Simplified 1D history table

typedef enum {
    HASH_EXACT = 0,
    HASH_LOWERBOUND = 1,
    HASH_UPPERBOUND = 2
} HashFlag;

// --- Structures ---
typedef struct {
    TerrainType terrain;
    Piece piece; 
} Square;

typedef struct {
    Square squares[BOARD_ROWS][BOARD_COLS];
} Board;

typedef struct {
    int from_row, from_col;
    int to_row, to_col;
    PieceType piece_type; 
    PieceType captured_piece_type; // For MVV-LVA and Q-Search
    int order_score;      
} Move;

typedef struct {
    int64_t hash_key;
    int score;
    int depth;
    HashFlag flag;
    Move best_move; 
    bool best_move_valid;
} TTEntry;


// --- Function Declarations ---
void findBestMoveWasm(
    const int* flat_board_data, 
    int max_depth,
    int time_limit_ms,
    int* result_buffer 
);

void initializeAiEngine();

inline Player get_opponent(Player player) {
    if (player == PLAYER0) return PLAYER1;
    if (player == PLAYER1) return PLAYER0;
    return PLAYER_NONE;
}

// History table index calculation
inline int get_history_index(PieceType piece_type, int to_r, int to_c) {
    return (int)piece_type * (BOARD_ROWS * BOARD_COLS) + to_r * BOARD_COLS + to_c;
}


#endif // AI_ENGINE_H