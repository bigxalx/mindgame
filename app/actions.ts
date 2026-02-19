"use server";

import { createGame, getGame, saveGame } from "@/lib/storage";
import { GameState, Player, Board, SpecialEffect, AIDifficulty } from "@/types/game";
import { createInitialBoard, checkCaptures, triggerAggression, spreadResistance, spreadEmpathy, getNeighbors, isNeutralized } from "@/lib/game";

function checkWin(board: Board, currentPlayer: Player): { gameOver: boolean; winner: Player | null } {
    let resistanceFound = false;
    let emptyCells = false;
    const size = board.length;

    for (let r = 0; r < size; r++) {
        for (let c = 0; c < size; c++) {
            if (board[r][c].type === 'resistance') resistanceFound = true;
            if (board[r][c].type === 'empty') emptyCells = true;
        }
    }

    // Player (Black) wins if all resistance is gone
    if (!resistanceFound) {
        return { gameOver: true, winner: 'black' };
    }

    // NPC (White) wins if Player (Black) has no legal placements (empty cells)
    // Rule: "NPC wins if: Player has no legal placements available"
    if (!emptyCells && currentPlayer === 'black') {
        return { gameOver: true, winner: 'white' };
    }

    return { gameOver: false, winner: null };
}

export async function hostGame(nickname: string, size: number = 5, isAiGame: boolean = false, difficulty?: AIDifficulty) {
    const gameId = Math.random().toString(36).substring(2, 8).toUpperCase();
    const initialInventory = {
        aggression: 2,
        manipulation: 1,
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

    // Apply immediate effect (Aggression/Manipulation)
    // Control is now dynamic via isNeutralized helper


    // Aggression and captures are delayed until commitTurn

    const isManipulation = effect === 'manipulation' &&
        newBoard[r][c].effects.includes('manipulation') &&
        !isNeutralized(newBoard, r, c);

    const newState: GameState = {
        ...state,
        board: newBoard,
        inventory: newInventory,
        history: history,
        moveConfirmed: true, // Stone placed, now player can only swap or end turn
        pendingSwap: isManipulation ? { r, c } : undefined,
    };

    // Check for win
    const winStatus = checkWin(newBoard, player);
    if (winStatus.gameOver) {
        newState.gameOver = true;
        newState.winner = winStatus.winner;
    }

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

    // NO DESTRUCTIVE EFFECTS UNTIL COMMIT
    // (Aggression/Captures handled in commitTurn)

    const newState: GameState = {
        ...state,
        board: newBoard,
        history: history,
        pendingSwap: undefined, // Swap done
    };

    const winStatus = checkWin(newBoard, state.turn);
    if (winStatus.gameOver) {
        newState.gameOver = true;
        newState.winner = winStatus.winner;
    }

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

    // START OF TURN LOGIC (Only if game is NOT already over)
    let gameOver = false;
    let winner: Player | null = null;

    if (!checkWin(newBoard, state.turn).gameOver) {
        // 1. Resolve Placement Effects (Aggression from the stone placed this turn)
        // Find the stone placed this turn by comparing board with history? 
        // Or simply iterate all aggression stones and trigger them.
        for (let r = 0; r < newBoard.length; r++) {
            for (let c = 0; c < newBoard.length; c++) {
                if (newBoard[r][c].effects.includes('aggression')) {
                    newBoard = triggerAggression(newBoard, { r, c });
                }
            }
        }

        // 2. Resolve initial captures (Suicide/Normal)
        newBoard = checkCaptures(newBoard, state.turn);

        // 3. Resolve spreading effects
        newBoard = spreadEmpathy(newBoard, nextPlayer);

        if (nextPlayer === 'white') {
            const result = spreadResistance(newBoard);
            newBoard = result.board;
        }

        // 4. Resolve captures that may have resulted from spreading
        newBoard = checkCaptures(newBoard, nextPlayer);

        // 5. Final win check for the start of the next player's turn
        const finalWinStatus = checkWin(newBoard, nextPlayer);
        gameOver = finalWinStatus.gameOver;
        winner = finalWinStatus.winner;
    } else {
        const winStatus = checkWin(newBoard, state.turn);
        gameOver = winStatus.gameOver;
        winner = winStatus.winner;
    }

    const newState: GameState = {
        ...state,
        board: newBoard,
        turn: nextPlayer,
        moveConfirmed: false,
        pendingSwap: undefined,
        history: [], // Clear history for new turn
        gameOver,
        winner,
    };

    await saveGame(gameId, newState);
    return newState;
}

export async function pollGame(gameId: string) {
    return await getGame(gameId);
}
