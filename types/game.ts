export type StoneType = 'black' | 'white' | 'resistance' | 'empty' | 'collapse';
export type SpecialEffect = 'empathy' | 'control' | 'aggression' | 'manipulation';
export type AIDifficulty = 'easy' | 'medium' | 'hard' | 'expert' | 'impossible';
export type AIBehavior = 'none' | 'default';

export interface Cell {
    type: StoneType;
    effects: SpecialEffect[];
    id: string; // unique ID for transitions
    aftershock?: { type: Player; turnCreated: number };
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
    swappedPositions?: { r: number; c: number }[]; // Track stones moved by Manipulation for re-triggering
    moveConfirmed: boolean; // Has the player placed their main stone?
    difficulty?: AIDifficulty;
    isAiGame?: boolean;
    lastAction?: {
        type: 'move' | 'swap' | 'capture' | 'spread';
        cells: { r: number; c: number }[];
    };
    turnCount: number;
    turnLimit?: number;        // Max full Black turns before white wins (if resistance remains)
    npcEffectTypes?: SpecialEffect[]; // Which effect types the NPC was assigned at game creation
    behaviorTree?: AIBehavior; // 'none' = minimax only, 'default' = full BT
    phase: 'loadout' | 'playing' | 'gameover';
    loadoutConfirmed: Record<Player, boolean>;
}
