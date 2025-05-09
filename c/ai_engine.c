#include "ai_engine.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <limits.h> 
#include <math.h>   
#include <emscripten.h> 

// --- Piece Info Definition ---
const Piece PIECE_INFO[NUM_PIECE_TYPES] = {
    {PIECE_TYPE_RAT,     PLAYER_NONE, 1, 200}, {PIECE_TYPE_CAT,     PLAYER_NONE, 2, 200},
    {PIECE_TYPE_DOG,     PLAYER_NONE, 3, 300}, {PIECE_TYPE_WOLF,    PLAYER_NONE, 4, 400},
    {PIECE_TYPE_LEOPARD, PLAYER_NONE, 5, 500}, {PIECE_TYPE_TIGER,   PLAYER_NONE, 6, 700},
    {PIECE_TYPE_LION,    PLAYER_NONE, 7, 800}, {PIECE_TYPE_ELEPHANT,PLAYER_NONE, 8, 650}
};

// --- Zobrist Hashing ---
int64_t zobrist_table[NUM_PIECE_TYPES][2][BOARD_ROWS][BOARD_COLS];
int64_t zobrist_player1_to_move;
bool zobrist_initialized = false;

// --- AI Worker-Scoped State ---
uint64_t ai_run_counter = 0; 
Move killer_moves[MAX_PLY_FOR_KILLERS][2];
bool killer_moves_valid[MAX_PLY_FOR_KILLERS][2];
TTEntry transposition_table[TRANSPOSITION_TABLE_SIZE];
int history_heuristic[HISTORY_TABLE_SIZE]; // For move ordering of quiet moves

// --- Timing ---
double start_search_time_ms;
int current_time_limit_ms;

// --- NMP & LMR Constants ---
#define NMP_REDUCTION 3
#define LMR_REDUCTION_BASE 1
#define LMR_MOVES_TRIED_THRESHOLD 4 // Apply LMR after this many moves

// --- Forward declarations ---
GameStatus rules_get_game_status(const Board* board);
int evaluate_board_internal(const Board* board);
void generate_all_valid_moves(const Board* board, Player player, Move* moves_array, int* num_moves, bool captures_only);
bool is_valid_move_coords(int r, int c);
// simulate_move now also updates the hash
void simulate_move_and_update_hash(const Board* current_board, const Move* move, Board* next_board, PieceType moved_piece_original_type, Player player, int64_t* current_hash_ptr);
int alpha_beta(Board* current_board, int64_t current_hash, int depth, int alpha, int beta, bool is_maximizing_player, int ply, uint64_t* path_hashes, int path_hash_count, bool allow_null_move);
int quiescence_search(Board* current_board, int64_t current_hash, int alpha, int beta, bool is_maximizing_player, int ply, int q_depth);


// --- Random Number Generator for Zobrist ---
uint64_t lcg_rand_state = 1234567890123456789ULL;
int64_t random_int64() {
    lcg_rand_state = lcg_rand_state * 6364136223846793005ULL + 1442695040888963407ULL;
    return (int64_t)lcg_rand_state;
}

// --- Zobrist Initialization ---
void initialize_zobrist() {
    if (zobrist_initialized) return;
    for (int pt = 0; pt < NUM_PIECE_TYPES; ++pt) {
        for (int p = 0; p < 2; ++p) { 
            for (int r = 0; r < BOARD_ROWS; ++r) {
                for (int c = 0; c < BOARD_COLS; ++c) {
                    zobrist_table[pt][p][r][c] = random_int64();
                }
            }
        }
    }
    zobrist_player1_to_move = random_int64();
    zobrist_initialized = true;
}

// Compute full hash (used for root or when incremental fails)
int64_t compute_zobrist_key_full(const Board* board, Player player_to_move) {
    if (!zobrist_initialized) {
        initialize_zobrist();
    }
    int64_t key = 0;
    for (int r = 0; r < BOARD_ROWS; ++r) {
        for (int c = 0; c < BOARD_COLS; ++c) {
            if (board->squares[r][c].piece.type != NO_PIECE) {
                Piece piece = board->squares[r][c].piece;
                key ^= zobrist_table[piece.type][piece.player][r][c];
            }
        }
    }
    if (player_to_move == PLAYER1) {
        key ^= zobrist_player1_to_move;
    }
    return key;
}


// --- Board Utility ---
bool is_valid_move_coords(int r, int c) {
    return r >= 0 && r < BOARD_ROWS && c >= 0 && c < BOARD_COLS;
}

void deserialize_board(const int* flat_data, Board* board) {
    int rows = flat_data[0]; 
    int cols = flat_data[1]; 
    int k = 2;
    for (int r = 0; r < rows; ++r) {
        for (int c = 0; c < cols; ++c) {
            board->squares[r][c].terrain = (TerrainType)flat_data[k++];
            PieceType pt = (PieceType)flat_data[k++];
            Player p = (Player)flat_data[k++];
            
            if (pt != NO_PIECE && pt < NUM_PIECE_TYPES) {
                board->squares[r][c].piece.type = pt;
                board->squares[r][c].piece.player = p;
                board->squares[r][c].piece.rank = PIECE_INFO[pt].rank;
                board->squares[r][c].piece.value = PIECE_INFO[pt].value;
            } else {
                board->squares[r][c].piece.type = NO_PIECE;
            }
        }
    }
}

// --- Rules (Simplified mirrors of rules.js for AI internal use) ---
bool rules_is_river(int r, int c) {
    return r >= 3 && r <= 5 && (c == 1 || c == 2 || c == 4 || c == 5);
}

int rules_get_effective_rank(const Piece* piece, int r, int c, const Board* board) {
    if (!piece || piece->type == NO_PIECE) return 0;
    TerrainType terrain = board->squares[r][c].terrain;

    if (terrain == TERRAIN_TRAP) {
        bool is_player0_trap = (r == 8 && (c == 2 || c == 4)) || (r == 7 && c == 3);
        bool is_player1_trap = (r == 0 && (c == 2 || c == 4)) || (r == 1 && c == 3);

        if ((piece->player == PLAYER0 && is_player1_trap) ||
            (piece->player == PLAYER1 && is_player0_trap)) {
            return 0;
        }
    }
    return piece->rank;
}

bool rules_can_capture(const Piece* attacker, const Piece* defender, int att_r, int att_c, int def_r, int def_c, const Board* board) {
    if (!attacker || attacker->type == NO_PIECE || !defender || defender->type == NO_PIECE || attacker->player == defender->player) {
        return false;
    }

    TerrainType att_terrain = board->squares[att_r][att_c].terrain;
    TerrainType def_terrain = board->squares[def_r][def_c].terrain;
    
    if (att_terrain == TERRAIN_WATER && attacker->type != PIECE_TYPE_RAT) return false; 
    if (att_terrain == TERRAIN_WATER && def_terrain != TERRAIN_WATER) { 
         if (attacker->type == PIECE_TYPE_RAT && defender->type == PIECE_TYPE_ELEPHANT && def_terrain != TERRAIN_WATER) {
             // Rat in water attacking elephant on land is allowed by this specific condition.
         } else {
            return false; // Rat in water cannot attack other pieces on land.
         }
    }

    if (attacker->type == PIECE_TYPE_RAT && defender->type == PIECE_TYPE_ELEPHANT) {
        return att_terrain != TERRAIN_WATER; // Rat on land can capture elephant. Rat in water cannot.
    }
    if (attacker->type == PIECE_TYPE_ELEPHANT && defender->type == PIECE_TYPE_RAT) {
        return false; 
    }

    int attacker_rank = rules_get_effective_rank(attacker, att_r, att_c, board);
    int defender_rank = rules_get_effective_rank(defender, def_r, def_c, board);

    return attacker_rank >= defender_rank;
}

void rules_get_valid_moves_for_piece(const Board* board, int r, int c, Move* moves_array, int* num_piece_moves, bool captures_only) {
    *num_piece_moves = 0;
    if (board->squares[r][c].piece.type == NO_PIECE) return;

    Piece piece = board->squares[r][c].piece;
    Player player = piece.player;
    PieceType piece_type = piece.type;

    int dr[] = {-1, 1, 0, 0};
    int dc_coords[] = {0, 0, -1, 1};

    for (int i = 0; i < 4; ++i) {
        int nr = r + dr[i];
        int nc = c + dc_coords[i];

        if (!is_valid_move_coords(nr, nc)) continue;

        TerrainType target_terrain = board->squares[nr][nc].terrain;
        const Piece* target_piece_ptr = (board->squares[nr][nc].piece.type != NO_PIECE) ? &board->squares[nr][nc].piece : NULL;
        PieceType captured_type = target_piece_ptr ? target_piece_ptr->type : NO_PIECE;

        if (captures_only && !target_piece_ptr) continue; // Q-Search only considers captures for non-jump moves

        TerrainType own_den_terrain = (player == PLAYER0) ? TERRAIN_PLAYER0_DEN : TERRAIN_PLAYER1_DEN;
        if (target_terrain == own_den_terrain) continue;

        if (target_terrain == TERRAIN_WATER && piece_type != PIECE_TYPE_RAT) continue;

        if (target_piece_ptr && target_piece_ptr->player == player) continue;

        if (target_piece_ptr && target_piece_ptr->player != player) {
            if (!rules_can_capture(&piece, target_piece_ptr, r, c, nr, nc, board)) {
                continue;
            }
        }
        moves_array[*num_piece_moves] = (Move){r, c, nr, nc, piece_type, captured_type, 0};
        (*num_piece_moves)++;
    }

    if (piece_type == PIECE_TYPE_LION || piece_type == PIECE_TYPE_TIGER) {
        int jump_targets_r[4]; int jump_targets_c[4];
        int river_coords[4][6]; int num_jump_paths = 0;

        if (rules_is_river(3, c) && piece_type != PIECE_TYPE_RAT ) { 
            if (r == 2) { 
                jump_targets_r[num_jump_paths] = 6; jump_targets_c[num_jump_paths] = c;
                river_coords[num_jump_paths][0]=3; river_coords[num_jump_paths][1]=c; river_coords[num_jump_paths][2]=4; river_coords[num_jump_paths][3]=c; river_coords[num_jump_paths][4]=5; river_coords[num_jump_paths][5]=c; num_jump_paths++;
            } else if (r == 6) { 
                jump_targets_r[num_jump_paths] = 2; jump_targets_c[num_jump_paths] = c;
                river_coords[num_jump_paths][0]=5; river_coords[num_jump_paths][1]=c; river_coords[num_jump_paths][2]=4; river_coords[num_jump_paths][3]=c; river_coords[num_jump_paths][4]=3; river_coords[num_jump_paths][5]=c; num_jump_paths++;
            }
        }
        if (piece_type == PIECE_TYPE_LION) { 
            if (rules_is_river(r,1) && rules_is_river(r,2) && piece_type != PIECE_TYPE_RAT) {
                if (c == 0) { 
                     jump_targets_r[num_jump_paths]=r; jump_targets_c[num_jump_paths]=3; river_coords[num_jump_paths][0]=r; river_coords[num_jump_paths][1]=1; river_coords[num_jump_paths][2]=r; river_coords[num_jump_paths][3]=2; river_coords[num_jump_paths][4]=-1; river_coords[num_jump_paths][5]=-1; num_jump_paths++;
                } else if (c == 3) { 
                     jump_targets_r[num_jump_paths]=r; jump_targets_c[num_jump_paths]=0; river_coords[num_jump_paths][0]=r; river_coords[num_jump_paths][1]=2; river_coords[num_jump_paths][2]=r; river_coords[num_jump_paths][3]=1; river_coords[num_jump_paths][4]=-1; river_coords[num_jump_paths][5]=-1; num_jump_paths++;
                }
            }
            if (rules_is_river(r,4) && rules_is_river(r,5) && piece_type != PIECE_TYPE_RAT) {
                 if (c == 3) { 
                     jump_targets_r[num_jump_paths]=r; jump_targets_c[num_jump_paths]=6; river_coords[num_jump_paths][0]=r; river_coords[num_jump_paths][1]=4; river_coords[num_jump_paths][2]=r; river_coords[num_jump_paths][3]=5; river_coords[num_jump_paths][4]=-1; river_coords[num_jump_paths][5]=-1; num_jump_paths++;
                 } else if (c == 6) { 
                     jump_targets_r[num_jump_paths]=r; jump_targets_c[num_jump_paths]=3; river_coords[num_jump_paths][0]=r; river_coords[num_jump_paths][1]=5; river_coords[num_jump_paths][2]=r; river_coords[num_jump_paths][3]=4; river_coords[num_jump_paths][4]=-1; river_coords[num_jump_paths][5]=-1; num_jump_paths++;
                 }
            }
        }
        for (int j = 0; j < num_jump_paths; ++j) {
            int nr = jump_targets_r[j]; int nc = jump_targets_c[j];
            bool path_blocked = false;
            for (int k_path = 0; k_path < 3; ++k_path) { 
                int river_r = river_coords[j][k_path*2]; int river_c = river_coords[j][k_path*2 + 1];
                if (river_r == -1 && river_c == -1) break; 
                if (!rules_is_river(river_r, river_c) || board->squares[river_r][river_c].piece.type != NO_PIECE) {
                    path_blocked = true; break;
                }
            }
            if (path_blocked) continue;
            TerrainType target_terrain = board->squares[nr][nc].terrain;
            const Piece* target_piece_ptr = (board->squares[nr][nc].piece.type != NO_PIECE) ? &board->squares[nr][nc].piece : NULL;
            PieceType captured_type = target_piece_ptr ? target_piece_ptr->type : NO_PIECE;

            if (captures_only && !target_piece_ptr) continue; // Q-Search also considers jump captures

            TerrainType own_den_terrain = (player == PLAYER0) ? TERRAIN_PLAYER0_DEN : TERRAIN_PLAYER1_DEN;
            if (target_terrain == own_den_terrain) continue;
            if (target_terrain == TERRAIN_WATER) continue; 
            if (target_piece_ptr && target_piece_ptr->player == player) continue;
            if (target_piece_ptr && target_piece_ptr->player != player) {
                if (!rules_can_capture(&piece, target_piece_ptr, r, c, nr, nc, board)) continue;
            }
            moves_array[*num_piece_moves] = (Move){r, c, nr, nc, piece_type, captured_type, 0};
            (*num_piece_moves)++;
        }
    }
}

void generate_all_valid_moves(const Board* board, Player player, Move* moves_array, int* num_moves, bool captures_only) {
    *num_moves = 0;
    Move piece_moves_buffer[20]; 
    for (int r = 0; r < BOARD_ROWS; ++r) {
        for (int c = 0; c < BOARD_COLS; ++c) {
            if (board->squares[r][c].piece.type != NO_PIECE && board->squares[r][c].piece.player == player) {
                int num_piece_moves = 0;
                rules_get_valid_moves_for_piece(board, r, c, piece_moves_buffer, &num_piece_moves, captures_only);
                for (int i = 0; i < num_piece_moves; ++i) {
                    if (*num_moves < BOARD_ROWS * BOARD_COLS * 8) { // Max possible moves estimate 
                        moves_array[*num_moves] = piece_moves_buffer[i];
                        (*num_moves)++;
                    }
                }
            }
        }
    }
}

GameStatus rules_get_game_status(const Board* board) {
    int p0c=0, p1c=0; bool p0d=false, p1d=false;
    for(int r=0;r<BOARD_ROWS;r++) for(int c=0;c<BOARD_COLS;c++) {
        const Piece* p = (board->squares[r][c].piece.type != NO_PIECE) ? &board->squares[r][c].piece : NULL;
        if(p){ if(p->player==PLAYER0){p0c++; if(board->squares[r][c].terrain==TERRAIN_PLAYER1_DEN)p0d=true;}
               else{p1c++; if(board->squares[r][c].terrain==TERRAIN_PLAYER0_DEN)p1d=true;} } }
    if(p0d)return GAME_STATUS_PLAYER0_WINS; if(p1d)return GAME_STATUS_PLAYER1_WINS;
    if(p1c==0&&p0c>0)return GAME_STATUS_PLAYER0_WINS; if(p0c==0&&p1c>0)return GAME_STATUS_PLAYER1_WINS;
    if(p0c==0&&p1c==0)return GAME_STATUS_DRAW; return GAME_STATUS_ONGOING;
}

// --- Evaluation Logic (Simplified) ---
#define MATERIAL_W 1.0f
#define ADVANCEMENT_W 0.2f
#define DEN_PROXIMITY_W 6.0f
#define ATTACK_THREAT_W 1.5f 
#define KEY_SQUARE_W 0.3f
#define TRAPPED_PENALTY_W -3.0f
#define DEFENSE_PENALTY_W -0.7f
#define ADVANCEMENT_VALUE_SCALE_DIVISOR 150.0f
#define GENERAL_VALUE_SCALE_DIVISOR 100.0f
#define DEN_PROXIMITY_MAX_DISTANCE 15
#define DEFENSE_PENALTY_START_ROW_OFFSET 3

bool is_key_sq_p0(int r,int c){return(r==4&&(c==2||c==3||c==4))||(r==1&&(c==2||c==4))||(r==2&&c==3);}
bool is_key_sq_p1(int r,int c){return(r==4&&(c==2||c==3||c==4))||(r==7&&(c==2||c==4))||(r==6&&c==3);}

int evaluate_board_internal(const Board* board) {
    GameStatus status = rules_get_game_status(board);
    if (status == GAME_STATUS_PLAYER1_WINS) return WIN_SCORE;
    if (status == GAME_STATUS_PLAYER0_WINS) return LOSE_SCORE;
    if (status == GAME_STATUS_DRAW) return DRAW_SCORE;
    double ai_s=0, pl_s=0; int p0_ct=0, p1_ct=0;
    for(int r=0;r<BOARD_ROWS;r++) for(int c=0;c<BOARD_COLS;c++) {
        if(board->squares[r][c].piece.type!=NO_PIECE){
            Piece pce=board->squares[r][c].piece; Player plr=pce.player;
            double* eval_s_ref=(plr==PLAYER1)?&ai_s:&pl_s;
            if(plr==PLAYER0)p0_ct++; else p1_ct++;
            *eval_s_ref+=pce.value*MATERIAL_W;
            int adv=(plr==PLAYER1)?r:(BOARD_ROWS-1-r); *eval_s_ref+=adv*ADVANCEMENT_W*(pce.value/ADVANCEMENT_VALUE_SCALE_DIVISOR);
            if(pce.type!=PIECE_TYPE_RAT){
                if(plr==PLAYER1&&r<DEFENSE_PENALTY_START_ROW_OFFSET)*eval_s_ref+=(r-DEFENSE_PENALTY_START_ROW_OFFSET)*DEFENSE_PENALTY_W*(pce.value/GENERAL_VALUE_SCALE_DIVISOR);
                if(plr==PLAYER0&&r>(BOARD_ROWS-1-DEFENSE_PENALTY_START_ROW_OFFSET))*eval_s_ref+=((BOARD_ROWS-1-r)-DEFENSE_PENALTY_START_ROW_OFFSET)*DEFENSE_PENALTY_W*(pce.value/GENERAL_VALUE_SCALE_DIVISOR);
            }
            if(rules_get_effective_rank(&pce,r,c,board)==0&&board->squares[r][c].terrain==TERRAIN_TRAP)*eval_s_ref+=TRAPPED_PENALTY_W*(pce.value/GENERAL_VALUE_SCALE_DIVISOR);
            if((plr==PLAYER0&&is_key_sq_p0(r,c))||(plr==PLAYER1&&is_key_sq_p1(r,c)))*eval_s_ref+=KEY_SQUARE_W*(pce.value/GENERAL_VALUE_SCALE_DIVISOR);
            int den_r=(plr==PLAYER1)?PLAYER0_DEN_ROW:PLAYER1_DEN_ROW; int den_c=(plr==PLAYER1)?PLAYER0_DEN_COL:PLAYER1_DEN_COL;
            int d_den=abs(r-den_r)+abs(c-den_c); double adv_f=1.0; if((plr==PLAYER1&&r<BOARD_ROWS/2)||(plr==PLAYER0&&r>BOARD_ROWS/2))adv_f=0.1;
            *eval_s_ref+=fmax(0.0,(double)(DEN_PROXIMITY_MAX_DISTANCE-d_den))*DEN_PROXIMITY_W*(pce.value/GENERAL_VALUE_SCALE_DIVISOR)*adv_f;
            int dr_[]={-1,1,0,0};int dc_[]={0,0,-1,1};
            for(int i=0;i<4;i++){int nr=r+dr_[i];int nc=c+dc_[i]; if(is_valid_move_coords(nr,nc)){
                const Piece* tgt_p=(board->squares[nr][nc].piece.type!=NO_PIECE)?&board->squares[nr][nc].piece:NULL;
                if(tgt_p&&tgt_p->player!=plr&&rules_can_capture(&pce,tgt_p,r,c,nr,nc,board))*eval_s_ref+=(tgt_p->value*ATTACK_THREAT_W/GENERAL_VALUE_SCALE_DIVISOR);}}
        }
    }
    if(p1_ct==0&&p0_ct>0)return LOSE_SCORE; if(p0_ct==0&&p1_ct>0)return WIN_SCORE;
    return (int)(ai_s-pl_s);
}


// --- Search Logic ---
void simulate_move_and_update_hash(const Board* current_board, const Move* move, Board* next_board, PieceType moved_piece_original_type, Player player, int64_t* current_hash_ptr) {
    memcpy(next_board, current_board, sizeof(Board)); 
    int64_t hash = *current_hash_ptr;

    // XOR out moving piece from original square
    hash ^= zobrist_table[moved_piece_original_type][player][move->from_row][move->from_col];

    // XOR out captured piece (if any)
    if (move->captured_piece_type != NO_PIECE) {
        Player captured_player = get_opponent(player); // Assuming captured piece is opponent's
        hash ^= zobrist_table[move->captured_piece_type][captured_player][move->to_row][move->to_col];
    }
    
    Piece moving_piece_data = {
        .type = moved_piece_original_type, 
        .player = player,
        .rank = PIECE_INFO[moved_piece_original_type].rank,
        .value = PIECE_INFO[moved_piece_original_type].value
    };
    next_board->squares[move->to_row][move->to_col].piece = moving_piece_data;
    next_board->squares[move->from_row][move->from_col].piece.type = NO_PIECE;

    // XOR in moving piece at new square
    hash ^= zobrist_table[moved_piece_original_type][player][move->to_row][move->to_col];
    
    // XOR player to move
    hash ^= zobrist_player1_to_move;

    *current_hash_ptr = hash;
}

void record_killer_move(int ply, const Move* move) {
    if (ply < 0 || ply >= MAX_PLY_FOR_KILLERS || !move) return;
    if (!killer_moves_valid[ply][0] || 
        !(killer_moves[ply][0].from_row == move->from_row && killer_moves[ply][0].from_col == move->from_col &&
          killer_moves[ply][0].to_row == move->to_row && killer_moves[ply][0].to_col == move->to_col) ) {
        killer_moves[ply][1] = killer_moves[ply][0];
        killer_moves_valid[ply][1] = killer_moves_valid[ply][0];
        killer_moves[ply][0] = *move;
        killer_moves_valid[ply][0] = true;
    }
}

void order_moves(Move* moves, int num_moves, const Move* tt_move, bool tt_move_valid, int ply, const Board* board_for_mvvlva) {
    for(int i=0; i < num_moves; ++i) {
        moves[i].order_score = 0;
        if(tt_move_valid && moves[i].from_row == tt_move->from_row && moves[i].from_col == tt_move->from_col &&
           moves[i].to_row == tt_move->to_row && moves[i].to_col == tt_move->to_col) {
            moves[i].order_score = 200000; // Highest priority
        } else if (moves[i].captured_piece_type != NO_PIECE) { // MVV-LVA for captures
            // Assuming piece_type in Move struct is the attacker
            int attacker_value = PIECE_INFO[moves[i].piece_type].value;
            int victim_value = PIECE_INFO[moves[i].captured_piece_type].value;
            moves[i].order_score = 100000 + (victim_value * 100) - attacker_value; // Scale victim value
        }
        else if (ply >= 0 && ply < MAX_PLY_FOR_KILLERS) { // Killer moves (quiet)
            if(killer_moves_valid[ply][0] && 
               moves[i].from_row == killer_moves[ply][0].from_row && moves[i].from_col == killer_moves[ply][0].from_col &&
               moves[i].to_row == killer_moves[ply][0].to_row && moves[i].to_col == killer_moves[ply][0].to_col) {
                moves[i].order_score = 90000;
            } else if (killer_moves_valid[ply][1] &&
                       moves[i].from_row == killer_moves[ply][1].from_row && moves[i].from_col == killer_moves[ply][1].from_col &&
                       moves[i].to_row == killer_moves[ply][1].to_row && moves[i].to_col == killer_moves[ply][1].to_col) {
                moves[i].order_score = 80000;
            } else { // History Heuristic for other quiet moves
                 moves[i].order_score = history_heuristic[get_history_index(moves[i].piece_type, moves[i].to_row, moves[i].to_col)];
            }
        } else { // Fallback for quiet moves if ply is out of killer range (e.g. root)
             moves[i].order_score = history_heuristic[get_history_index(moves[i].piece_type, moves[i].to_row, moves[i].to_col)];
        }
    }
    // Bubble sort (replace with qsort for larger num_moves if performance becomes an issue here)
    for(int i=0; i < num_moves-1; ++i) {
        for(int j=0; j < num_moves-i-1; ++j) {
            if(moves[j].order_score < moves[j+1].order_score) {
                Move temp = moves[j]; moves[j] = moves[j+1]; moves[j+1] = temp;
            }
        }
    }
}

int quiescence_search(Board* current_board, int64_t current_hash, int alpha, int beta, bool is_maximizing_player, int ply, int q_depth) {
    ai_run_counter++;
    if (emscripten_get_now() - start_search_time_ms > current_time_limit_ms) return 888888; // Timeout

    int stand_pat_score = evaluate_board_internal(current_board);

    if (q_depth >= MAX_Q_DEPTH) {
        return stand_pat_score;
    }

    if (is_maximizing_player) {
        if (stand_pat_score >= beta) return beta; // Fail-high
        if (stand_pat_score > alpha) alpha = stand_pat_score;
    } else {
        if (stand_pat_score <= alpha) return alpha; // Fail-low
        if (stand_pat_score < beta) beta = stand_pat_score;
    }
    
    Move capture_moves[BOARD_ROWS * BOARD_COLS * 4]; // Max captures is less than all moves
    int num_capture_moves = 0;
    Player player_to_move = is_maximizing_player ? PLAYER1 : PLAYER0;
    generate_all_valid_moves(current_board, player_to_move, capture_moves, &num_capture_moves, true); // true for captures_only

    order_moves(capture_moves, num_capture_moves, NULL, false, -1, current_board); // Simple MVV-LVA for Q-search, no killers/history

    for (int i = 0; i < num_capture_moves; ++i) {
        Board next_board_state;
        int64_t next_hash = current_hash; // Pass current hash to be updated
        simulate_move_and_update_hash(current_board, &capture_moves[i], &next_board_state, capture_moves[i].piece_type, player_to_move, &next_hash);
        
        int score = quiescence_search(&next_board_state, next_hash, alpha, beta, !is_maximizing_player, ply, q_depth + 1);
        if (score == 888888) return 888888; // Propagate timeout

        if (is_maximizing_player) {
            if (score > alpha) alpha = score;
            if (alpha >= beta) return beta; // Beta cutoff
        } else {
            if (score < beta) beta = score;
            if (alpha >= beta) return alpha; // Alpha cutoff
        }
    }
    return is_maximizing_player ? alpha : beta;
}


int alpha_beta(Board* current_board, int64_t current_hash, int depth, int alpha, int beta, bool is_maximizing_player, int ply, 
               uint64_t* path_hashes, int path_hash_count, bool allow_null_move) {
    ai_run_counter++;
    if (emscripten_get_now() - start_search_time_ms > current_time_limit_ms) return 888888; 

    bool is_root_node_child = (ply == 0); // Or (path_hash_count == 1 if root is 0)

    // Repetition Check (Simplified)
    if (path_hash_count > 0) { // Only check if there's a path
        for(int i=0; i < path_hash_count; ++i) { 
             if(path_hashes[i] == current_hash) { // Found current hash in path
                 int rep_count = 0;
                 for(int j=0; j <= path_hash_count; ++j) { // Count total occurrences
                     if(path_hashes[j] == current_hash) rep_count++;
                 }
                 if(rep_count >= 2 && ply > 0) return DRAW_SCORE; // 3rd occurrence (current + 2 in path) is draw
             }
        }
    }
    path_hashes[path_hash_count] = current_hash; // Add current hash to path for children


    int tt_index = (current_hash >= 0 ? current_hash : -current_hash) % TRANSPOSITION_TABLE_SIZE; 
    TTEntry* tt_entry = &transposition_table[tt_index];

    if (tt_entry->hash_key == current_hash && tt_entry->depth >= depth && ply > 0) { // Don't use TT for root_node_child if score is from shallower depth
        if (tt_entry->flag == HASH_EXACT) return tt_entry->score;
        if (tt_entry->flag == HASH_LOWERBOUND) alpha = (alpha > tt_entry->score) ? alpha : tt_entry->score;
        if (tt_entry->flag == HASH_UPPERBOUND) beta = (beta < tt_entry->score) ? beta : tt_entry->score;
        if (alpha >= beta) return tt_entry->score;
    }

    GameStatus game_over_status = rules_get_game_status(current_board);
    if (game_over_status != GAME_STATUS_ONGOING) { // Terminal node due to game rules
        if (game_over_status == GAME_STATUS_PLAYER1_WINS) return WIN_SCORE - ply; 
        if (game_over_status == GAME_STATUS_PLAYER0_WINS) return LOSE_SCORE + ply; 
        return DRAW_SCORE;
    }

    if (depth <= 0) { // Max depth reached, go to quiescence search
        return quiescence_search(current_board, current_hash, alpha, beta, is_maximizing_player, ply, 0);
    }
    
    // Null Move Pruning (NMP)
    if (allow_null_move && depth >= NMP_REDUCTION + 1 && !is_root_node_child) {
         // Check if current player has enough material or isn't in a zugzwang-like state (simplified check here)
         // For simplicity, we'll always try NMP if conditions are met.
         // More robust NMP would check piece counts or avoid if few pieces are left.
        int64_t null_move_hash = current_hash ^ zobrist_player1_to_move; // Just flip side to move
        // Note: path_hashes for null move should not include current_hash again, or handle carefully
        // For simplicity, create a new path array copy or manage indices carefully. Here, we risk polluting path_hashes.
        // A safer way is to not pass path_hashes or pass a copy for the null move search.
        // Let's skip passing path_hashes for NMP to avoid rep issues from null search for now.
        int null_score = -alpha_beta(current_board, null_move_hash, depth - 1 - NMP_REDUCTION, -beta, -beta + 1, !is_maximizing_player, ply + 1, path_hashes, path_hash_count +1, false); // Invert score, narrow window
        if (null_score == -888888) return 888888; // Timeout

        if (null_score >= beta) {
            if (null_score >= WIN_SCORE - MAX_PLY_FOR_KILLERS*2) return beta; // Ensure it's not a mate score far away
            return beta; // Prune
        }
    }


    Move moves[BOARD_ROWS * BOARD_COLS * 8]; 
    int num_moves = 0;
    Player current_player_val = is_maximizing_player ? PLAYER1 : PLAYER0; 
    generate_all_valid_moves(current_board, current_player_val, moves, &num_moves, false); // false = all moves

    if (num_moves == 0) { 
         return is_maximizing_player ? (LOSE_SCORE + ply) : (WIN_SCORE - ply);  // Current player has no moves
    }
    
    order_moves(moves, num_moves, (tt_entry->hash_key == current_hash) ? &tt_entry->best_move : NULL, (tt_entry->hash_key == current_hash && tt_entry->best_move_valid), ply, current_board);

    int best_score = is_maximizing_player ? INT_MIN : INT_MAX;
    Move best_move_for_node; 
    best_move_for_node.from_row = -1; 
    bool best_move_for_node_valid = false;
    int original_alpha = alpha;
    int moves_searched_full_depth = 0;

    for (int i = 0; i < num_moves; ++i) {
        Board next_board_state;
        int64_t next_hash = current_hash; // Pass current hash to be updated
        simulate_move_and_update_hash(current_board, &moves[i], &next_board_state, moves[i].piece_type, current_player_val, &next_hash);
        
        int current_search_depth = depth - 1;
        int score;

        // Late Move Reductions (LMR)
        if (depth >= 3 && moves_searched_full_depth >= LMR_MOVES_TRIED_THRESHOLD && moves[i].captured_piece_type == NO_PIECE && !is_root_node_child) {
            // Reduce depth for likely bad quiet moves
            current_search_depth = depth - 1 - LMR_REDUCTION_BASE; 
            // Can add more sophisticated reduction based on move index 'i' or history score
            // e.g., if (i > 6) current_search_depth--;
        }
        
        score = alpha_beta(&next_board_state, next_hash, current_search_depth, alpha, beta, !is_maximizing_player, ply + 1, path_hashes, path_hash_count +1, true);

        // If LMR was applied and score is promising, re-search at full depth
        if (current_search_depth < depth -1 && score > alpha && score != 888888) {
             score = alpha_beta(&next_board_state, next_hash, depth - 1, alpha, beta, !is_maximizing_player, ply + 1, path_hashes, path_hash_count + 1, true);
        }


        if (score == 888888) return 888888; 

        if (is_maximizing_player) {
            if (score > best_score) {
                best_score = score;
                best_move_for_node = moves[i];
                best_move_for_node_valid = true;
            }
            alpha = (alpha > best_score) ? alpha : best_score;
        } else {
            if (score < best_score) {
                best_score = score;
                best_move_for_node = moves[i];
                best_move_for_node_valid = true;
            }
            beta = (beta < best_score) ? beta : best_score;
        }
        
        moves_searched_full_depth++;

        if (alpha >= beta) {
             if(moves[i].captured_piece_type == NO_PIECE) { // Quiet move caused cutoff
                 record_killer_move(ply, &moves[i]);
                 history_heuristic[get_history_index(moves[i].piece_type, moves[i].to_row, moves[i].to_col)] += depth * depth; // Increase history score
             }
            break;
        }
    }
    // Store in TT
    if (best_score != 888888) { // Don't store timeout results
        tt_entry->hash_key = current_hash;
        tt_entry->score = best_score;
        tt_entry->depth = depth;
        if (best_score <= original_alpha) tt_entry->flag = HASH_UPPERBOUND;
        else if (best_score >= beta) tt_entry->flag = HASH_LOWERBOUND;
        else tt_entry->flag = HASH_EXACT;
        if (best_move_for_node_valid) {
            tt_entry->best_move = best_move_for_node;
            tt_entry->best_move_valid = true;
        } else {
            tt_entry->best_move_valid = false; // No good move found / all moves failed low
        }
    }
    return best_score;
}

// --- Exported Wasm Functions ---
EMSCRIPTEN_KEEPALIVE
void initializeAiEngine() {
    initialize_zobrist();
    for(int i=0; i<TRANSPOSITION_TABLE_SIZE; ++i) {
        transposition_table[i].hash_key = 0; transposition_table[i].depth = -1; transposition_table[i].best_move_valid = false;
    }
    for(int i=0; i<MAX_PLY_FOR_KILLERS; ++i) {
        killer_moves_valid[i][0] = false; killer_moves_valid[i][1] = false;
    }
    for(int i=0; i<HISTORY_TABLE_SIZE; ++i) {
        history_heuristic[i] = 0;
    }
}


EMSCRIPTEN_KEEPALIVE
void findBestMoveWasm(const int* flat_board_data, int max_depth, int time_limit_ms, int* result_buffer) {
    Board current_board_state; 
    deserialize_board(flat_board_data, &current_board_state); 
    
    current_time_limit_ms = time_limit_ms;
    start_search_time_ms = emscripten_get_now();
    ai_run_counter = 0;
    
    // Clear killers, TT, history for each new top-level search
    initializeAiEngine(); // This now clears everything including history table

    Move best_move_overall;
    best_move_overall.from_row = -1; 
    bool best_move_overall_found = false;
    int best_score_overall = INT_MIN;
    int depth_achieved = 0;

    Move root_moves[BOARD_ROWS * BOARD_COLS * 8];
    int num_root_moves = 0;
    generate_all_valid_moves(&current_board_state, PLAYER1, root_moves, &num_root_moves, false); 
    if (num_root_moves == 0) {
        result_buffer[0] = 0; result_buffer[9] = 1; return;
    }
    
    best_move_overall = root_moves[0]; // Default if no better move found
    best_move_overall_found = true;
    uint64_t path_hashes_main[MAX_PLY_FOR_KILLERS + 5]; // Path for repetition detection

    for (int current_depth_iter = 1; current_depth_iter <= max_depth; ++current_depth_iter) { 
        if (emscripten_get_now() - start_search_time_ms > current_time_limit_ms) break;

        int current_iter_best_score = INT_MIN; // Renamed to avoid confusion
        Move current_iter_best_move = root_moves[0]; 
        bool current_iter_best_move_found = true; // Assume first move is valid initially
        
        int64_t root_hash = compute_zobrist_key_full(&current_board_state, PLAYER1); 
        //path_hashes_main[0] = root_hash; // Root hash for its children (ply 0 search)
        
        int tt_idx_root = (root_hash >=0 ? root_hash : -root_hash) % TRANSPOSITION_TABLE_SIZE;
        if (transposition_table[tt_idx_root].hash_key == root_hash && transposition_table[tt_idx_root].best_move_valid) {
             order_moves(root_moves, num_root_moves, &transposition_table[tt_idx_root].best_move, true, -1, &current_board_state); 
        } else {
             order_moves(root_moves, num_root_moves, NULL, false, -1, &current_board_state); 
        }

        for (int i = 0; i < num_root_moves; ++i) {
            Board next_board;
            int64_t iter_next_hash = root_hash; // Start with root hash for incremental update
            simulate_move_and_update_hash(&current_board_state, &root_moves[i], &next_board, root_moves[i].piece_type, PLAYER1, &iter_next_hash); 
            
            // For root moves, ply is 0. Their children will be at ply 1.
            // Repetition path for alpha_beta will start with the hash *after* the root move.
            path_hashes_main[0] = iter_next_hash; // First hash in path is the state after the root move.

            int score = alpha_beta(&next_board, iter_next_hash, current_depth_iter - 1, INT_MIN, INT_MAX, false, 0, path_hashes_main, 0, true); // false = opponent's turn, ply 0 for children of root
            
            if (score == 888888) { goto end_search_label; } // Use a label to break outer loop

            if (score > current_iter_best_score) {
                current_iter_best_score = score;
                current_iter_best_move = root_moves[i];
            }
        }

        if (emscripten_get_now() - start_search_time_ms <= current_time_limit_ms) { // Check time *after* iteration completes
            depth_achieved = current_depth_iter;
            best_score_overall = current_iter_best_score;
            if (current_iter_best_move_found) { // If a valid move was determined for this iteration
                best_move_overall = current_iter_best_move;
                best_move_overall_found = true;
            }
        } else { // Timeout occurred during this iteration
            break; 
        }
        if (best_score_overall > WIN_SCORE - (MAX_PLY_FOR_KILLERS*2) || best_score_overall < LOSE_SCORE + (MAX_PLY_FOR_KILLERS*2)) break; // Early exit for mate
    }

end_search_label:; // Label for goto
    if (best_move_overall_found) {
        result_buffer[0] = 1; result_buffer[1] = best_move_overall.from_row; result_buffer[2] = best_move_overall.from_col;
        result_buffer[3] = best_move_overall.to_row; result_buffer[4] = best_move_overall.to_col;
        result_buffer[5] = best_move_overall.piece_type;
    } else { // Should only happen if num_root_moves was 0, which is checked earlier. Or extreme immediate timeout.
        if(num_root_moves > 0) { // Fallback to first legal if something went very wrong with iteration updates
            result_buffer[0] = 1; result_buffer[1] = root_moves[0].from_row; result_buffer[2] = root_moves[0].from_col;
            result_buffer[3] = root_moves[0].to_row; result_buffer[4] = root_moves[0].to_col; result_buffer[5] = root_moves[0].piece_type;
        } else {
            result_buffer[0] = 0; result_buffer[9] = 2; return;
        }
    }
    result_buffer[6] = depth_achieved; result_buffer[7] = (int)ai_run_counter; 
    result_buffer[8] = (best_score_overall == INT_MIN) ? 0 : best_score_overall; // Return 0 if no valid score found (e.g. immediate timeout)
    result_buffer[9] = 0; 
}