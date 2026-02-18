"use server";

import { createGame, getGame, saveGame } from "@/lib/storage";
import { GameState, Player, Board, SpecialEffect, AIDifficulty } from "@/types/game";
import { createInitialBoard, checkCaptures, triggerAction, spreadYellow, spreadEmpathy, getNeighbors } from "@/lib/game";

export async function hostGame(nickname: string, size: number = 5, isAiGame: boolean = false, difficulty?: AIDifficulty) {
    const gameId = Math.random().toString(36).substring(2, 8).toUpperCase();
    const initialInventory = {
        action: 2,
        opportunity: 1,
        control: 1,
        empathy: 1
    };
    const initialState: GameState = {
        board: createInitialBoard(size),
        turn: 'black', // Black starts
        history: [],
        gameOver: false,
        winner: null,
        boardSize: size,
        moveConfirmed: false,
        inventory: {
            black: { ...initialInventory },
            white: { ...initialInventory }
        },
        isAiGame,
        difficulty
    };

    await createGame(gameId, initialState);
    return { gameId, state: initialState };
}

export async function joinGame(gameId: string, nickname: string) {
    const game = await getGame(gameId);
    if (!game) throw new Error("Game not found");
    return { gameId, state: game };
}

export async function makeMove(gameId: string, r: number, c: number, effect: SpecialEffect | null) {
    const state = await getGame(gameId);
    if (!state || state.gameOver || state.moveConfirmed) return null;

    // Save previous state to history before any changes
    const previousState = { ...state, history: [] }; // Don't nest histories
    const history = [...state.history, previousState];

    let newBoard = JSON.parse(JSON.stringify(state.board)) as Board;
    const player = state.turn;
    const newInventory = JSON.parse(JSON.stringify(state.inventory));

    // Place stone
    if (effect) {
        if (newInventory[player][effect] > 0) {
            newBoard[r][c].effects.push(effect);
            newInventory[player][effect]--;
        }
    }

    newBoard[r][c].type = player;

    // Apply immediate control effect if placed
    if (effect === 'control') {
        const neighbors = getNeighbors(r, c, state.boardSize);
        neighbors.forEach(n => {
            if (!newBoard[n.r][n.c].effects.includes('control')) {
                newBoard[n.r][n.c].effects.push('control');
            }
        });
    }

    if (effect === 'action' && newBoard[r][c].effects.includes('action')) {
        newBoard = triggerAction(newBoard, { r, c });
    }

    newBoard = checkCaptures(newBoard, player);

    const isOpportunity = effect === 'opportunity' && newBoard[r][c].effects.includes('opportunity');

    const newState: GameState = {
        ...state,
        board: newBoard,
        inventory: newInventory,
        history: history,
        moveConfirmed: true, // Stone placed, now player can only swap or end turn
        pendingSwap: isOpportunity ? { r, c } : undefined,
    };

    await saveGame(gameId, newState);
    return newState;
}

export async function swapMove(gameId: string, r1: number, c1: number, r2: number, c2: number) {
    const state = await getGame(gameId);
    if (!state || !state.pendingSwap) return null;

    const previousState = { ...state, history: [] };
    const history = [...state.history, previousState];

    let newBoard = JSON.parse(JSON.stringify(state.board)) as Board;

    // Swap stones
    const tempType = newBoard[r1][c1].type;
    const tempEffects = [...newBoard[r1][c1].effects];

    newBoard[r1][c1].type = newBoard[r2][c2].type;
    newBoard[r1][c1].effects = [...newBoard[r2][c2].effects];

    newBoard[r2][c2].type = tempType;
    newBoard[r2][c2].effects = tempEffects;

    // Re-trigger action stones nearby
    newBoard = triggerAction(newBoard, { r: r1, c: c1 });
    newBoard = triggerAction(newBoard, { r: r2, c: c2 });

    newBoard = checkCaptures(newBoard, state.turn);

    const newState: GameState = {
        ...state,
        board: newBoard,
        history: history,
        pendingSwap: undefined, // Swap done
    };

    await saveGame(gameId, newState);
    return newState;
}

export async function undoAction(gameId: string) {
    const state = await getGame(gameId);
    if (!state || state.history.length === 0) return null;

    const history = [...state.history];
    const previousState = history.pop()!;

    const newState: GameState = {
        ...previousState,
        history: history, // Updated history
    };

    await saveGame(gameId, newState);
    return newState;
}

export async function commitTurn(gameId: string) {
    const state = await getGame(gameId);
    if (!state || !state.moveConfirmed) return null;

    let newBoard = JSON.parse(JSON.stringify(state.board)) as Board;
    const nextPlayer = state.turn === 'black' ? 'white' : 'black';

    // Check for win conditions
    let yellowFound = false;
    for (const row of newBoard) {
        for (const cell of row) {
            if (cell.type === 'yellow') yellowFound = true;
        }
    }

    // START OF TURN LOGIC
    // Spread empathy for the player whose turn it just became
    newBoard = spreadEmpathy(newBoard, nextPlayer);

    if (nextPlayer === 'white') {
        const result = spreadYellow(newBoard);
        newBoard = result.board;
    }

    const newState: GameState = {
        ...state,
        board: newBoard,
        turn: nextPlayer,
        moveConfirmed: false,
        pendingSwap: undefined,
        history: [], // Clear history for new turn
        gameOver: !yellowFound,
        winner: !yellowFound ? 'black' : null,
    };

    await saveGame(gameId, newState);
    return newState;
}

export async function pollGame(gameId: string) {
    return await getGame(gameId);
}
