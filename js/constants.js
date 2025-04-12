export const BOARD_ROWS = 9;
export const BOARD_COLS = 7;

export const TerrainType = {
    NORMAL: 'NORMAL',
    RIVER: 'RIVER',
    TRAP_P1: 'TRAP_P1',
    TRAP_P2: 'TRAP_P2',
    DEN_P1: 'DEN_P1',
    DEN_P2: 'DEN_P2'
};

export const Player = {
    NONE: 0,
    PLAYER1: 1,
    PLAYER2: 2,
    getOpponent: function (player) {
        if (player === this.PLAYER1) return this.PLAYER2;
        if (player === this.PLAYER2) return this.PLAYER1;
        return this.NONE;
    }
};

export const AnimalRanks = {
    'rat': 1,
    'cat': 2,
    'dog': 3,
    'wolf': 4,
    'leopard': 5,
    'tiger': 6,
    'lion': 7,
    'elephant': 8
};

export const AnimalTypes = Object.keys(AnimalRanks);

export const GameStatus = {
    INIT: 'Initializing',
    ONGOING: 'Ongoing',
    P1_WINS: 'Player 1 Wins!',
    P2_WINS: 'Player 2 Wins!',
    DRAW: 'Draw'
};

export const aiPlayer = Player.PLAYER2;
export const aiDifficulty = 4;  //seems to be the most effective depth for the current heuristis 
