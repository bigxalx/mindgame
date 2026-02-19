export type StoneType = 'black' | 'white' | 'resistance' | 'empty';
export type SpecialEffect = 'empathy' | 'control' | 'aggression' | 'manipulation';
export type AIDifficulty = 'easy' | 'medium' | 'hard' | 'expert' | 'impossible';

export interface Cell {
    type: StoneType;
    effects: SpecialEffect[];
    id: string; // unique ID for transitions
}

export type Board = Cell[][];

export type Player = 'black' | 'white';

export type Inventory = Record<SpecialEffect, number>;

export interface GameState {
    board: Board;
    turn: Player;
    history: GameState[]; // Full state history for undos within a turn
    gameOver: boolean;
    winner: Player | null;
    boardSize: number;
    inventory: Record<Player, Inventory>;
    pendingSwap?: { r: number; c: number }; // For Manipulation stone
    moveConfirmed: boolean; // Has the player placed their main stone?
    difficulty?: AIDifficulty;
    isAiGame?: boolean;
    lastAction?: {
        type: 'move' | 'swap' | 'capture' | 'spread';
        cells: { r: number; c: number }[];
    };
}
