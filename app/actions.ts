"use server";

import { createGame, getGame, saveGame } from "@/lib/storage";
import { GameState, Player, Board, SpecialEffect, AIDifficulty, AIBehavior, StoneType, Inventory } from "@/types/game";

import { createInitialBoard, cloneBoard, checkCaptures, triggerAggression, spreadResistance, spreadEmpathy, getNeighbors, isNeutralized, handleResolutionEvent } from "@/lib/game";

// ---------------------------------------------------------------------------
// Difficulty Configuration
// ---------------------------------------------------------------------------

/** Shuffle an array in place (Fisher-Yates) and return it. */
function shuffle<T>(arr: T[]): T[] {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

/**
 * Returns the full configuration for a given difficulty:
 * - boardSize: grid dimensions
 * - numResistance: starting resistance stones
 * - roundLimit: max full Black turns before white wins (if resistance remains)
 * - npcEffectTypes: which special effects the NPC is allowed to use
 * - npcMaxSpecial: total special stones to distribute across npcEffectTypes
 */
function getDifficultyConfig(difficulty: AIDifficulty) {
    const allEffects: SpecialEffect[] = ['aggression', 'manipulation', 'control', 'empathy'];
    const randomTypes = (n: number) => shuffle(allEffects).slice(0, n);

    switch (difficulty) {
        case 'easy':
            return { boardSize: 5, numResistance: 2, roundLimit: 12, npcEffectTypes: [] as SpecialEffect[], npcMaxSpecial: 0 };
        case 'medium':
            return { boardSize: 5, numResistance: 2, roundLimit: 12, npcEffectTypes: randomTypes(1), npcMaxSpecial: 3 };
        case 'hard':
            return { boardSize: 6, numResistance: 3, roundLimit: 16, npcEffectTypes: randomTypes(2), npcMaxSpecial: 5 };
        case 'expert':
            return { boardSize: 7, numResistance: 3, roundLimit: 20, npcEffectTypes: randomTypes(3), npcMaxSpecial: 5 };
        default: // impossible / fallback — no constraint set here yet
            return { boardSize: 7, numResistance: 3, roundLimit: 20, npcEffectTypes: randomTypes(3), npcMaxSpecial: 5 };
    }
}

/**
 * Builds the NPC's starting inventory.
 * Distributes maxTotal stones as evenly as possible across the given effect types.
 */
function buildNpcInventory(types: SpecialEffect[], maxTotal: number): Inventory {
    const inv: Inventory = { aggression: 0, manipulation: 0, control: 0, empathy: 0 };
    if (types.length === 0 || maxTotal === 0) return inv;
    const perType = Math.floor(maxTotal / types.length);
    const extra = maxTotal % types.length;
    types.forEach((t, i) => {
        inv[t] = perType + (i < extra ? 1 : 0);
    });
    // A lone aggression stone can never trigger its effect (needs a pair).
    // If aggression was assigned exactly 1, bump it to the minimum usable count of 2.
    if (inv.aggression === 1) {
        inv.aggression = 2;
    }
    return inv;
}


function checkWin(board: Board, currentPlayer: Player, turnCount: number = 0): { gameOver: boolean; winner: Player | null } {
    let resistanceFound = false;
    let emptyCells = false;
    let blackCount = 0;
    let whiteCount = 0;

    const size = board.length;

    for (let r = 0; r < size; r++) {
        for (let c = 0; c < size; c++) {
            if (board[r][c].type === 'resistance') resistanceFound = true;
            if (board[r][c].type === 'empty') emptyCells = true;
            if (board[r][c].type === 'black') blackCount++;
            if (board[r][c].type === 'white' || board[r][c].type === 'resistance') whiteCount++;
        }
    }

    // Player (Black) wins if all resistance is gone
    if (!resistanceFound) {
        return { gameOver: true, winner: 'black' };
    }

    // NPC (White) wins if Player (Black) has no legal placements (empty cells)
    if (!emptyCells && currentPlayer === 'black') {
        return { gameOver: true, winner: 'white' };
    }

    // Total Annihilation (Active after Round 1, i.e., turnCount > 1)
    if (turnCount > 1) {
        if (blackCount === 0) return { gameOver: true, winner: 'white' };
        if (whiteCount === 0) return { gameOver: true, winner: 'black' };
    }

    return { gameOver: false, winner: null };
}

/**
 * Creates a new game, using difficulty settings to configure board, resistance,
 * NPC inventory, and turn limit.  `size` is ignored for AI games; the difficulty
 * config determines the board dimensions.
 */
export async function hostGame(nickname: string, size: number = 5, isAiGame: boolean = false, difficulty?: AIDifficulty, behaviorTree: AIBehavior = 'default') {
    const gameId = Math.random().toString(36).substring(2, 8).toUpperCase();

    // Player gets the full standard inventory (no limitations for now)
    const playerInventory: Inventory = { aggression: 2, manipulation: 1, control: 1, empathy: 1 };

    let boardSize = size;
    let numResistance = 2;
    let turnLimit: number | undefined;
    let npcEffectTypes: SpecialEffect[] | undefined;
    let npcInventory: Inventory = { ...playerInventory };

    if (isAiGame && difficulty) {
        const cfg = getDifficultyConfig(difficulty);
        boardSize = cfg.boardSize;
        numResistance = cfg.numResistance;
        turnLimit = cfg.roundLimit;
        npcEffectTypes = cfg.npcEffectTypes;
        npcInventory = buildNpcInventory(cfg.npcEffectTypes, cfg.npcMaxSpecial);
    }

    const initialState: GameState = {
        board: createInitialBoard(boardSize, numResistance),
        turn: 'black',
        history: [],
        gameOver: false,
        winner: null,
        boardSize,
        moveConfirmed: false,
        inventory: {
            black: { ...playerInventory },
            white: { ...npcInventory },
        },
        isAiGame,
        difficulty,
        turnCount: 0,
        ...(turnLimit !== undefined && { turnLimit }),
        ...(npcEffectTypes !== undefined && { npcEffectTypes }),
        behaviorTree: isAiGame ? behaviorTree : undefined,
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

    // Aftershock check: Opposing player blocked for 1 turn cycle
    if (newBoard[r][c].aftershock) {
        const { type, turnCreated } = newBoard[r][c].aftershock;
        // aftershock.type = victim's player color.
        // block the VICTIM'S TEAM from reclaiming (same side as the destroyed stone).
        if (state.turnCount - turnCreated < 2 && type === player) {
            return null;
        }
    }

    // Place stone
    if (effect) {
        // Server-side guard: reject if the player doesn't own this effect
        if (newInventory[player][effect] <= 0) return null;
        newBoard[r][c].effects.push(effect);
        newInventory[player][effect]--;
    }

    newBoard[r][c].type = player;
    delete newBoard[r][c].aftershock; // Clear aftershock so it isn't a liberty

    // Apply immediate effect (Aggression/Manipulation)
    // Control is now dynamic via isNeutralized helper


    // Aggression and captures are delayed until commitTurn

    const isManipulation = effect === 'manipulation' &&
        newBoard[r][c].effects.includes('manipulation');

    const newState: GameState = {
        ...state,
        board: newBoard,
        inventory: newInventory,
        history: history,
        moveConfirmed: true, // Stone placed, now player can only swap or end turn
        pendingSwap: isManipulation ? { r, c } : undefined,
        swappedPositions: [], // Initialize for this turn
    };

    // Check for win
    const winStatus = checkWin(newBoard, player, state.turnCount); // Pass turnCount for Annihilation check?
    // Wait, state.turnCount is 0 at start. After round 1 means turnCount >= 2.
    // We can pass current state.turnCount. 
    // Actually, immediate win checks in makeMove are usually for simple conditions.
    // Annihilation is better checked in commitTurn after all destructions.

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

    // Both cells must contain actual stones (not empty/collapse)
    const cell1 = state.board[r1]?.[c1];
    const cell2 = state.board[r2]?.[c2];
    if (!cell1 || !cell2) return null;
    if (cell1.type === 'empty' || cell1.type === 'collapse') return null;
    if (cell2.type === 'empty' || cell2.type === 'collapse') return null;

    const previousState = { ...state, history: [] };
    const history = [...state.history, previousState];

    let newBoard = cloneBoard(state.board);

    // Swap BOTH stone types and effects — trat stone as a single unit.
    // Exclusion: id stays with the coordinate to avoid React key flickering issues or we can swap IDs too.
    // Actually, swapping IDs is fine since they are unique identifiers for the "stone instance".
    const tempType = newBoard[r1][c1].type;
    const tempEffects = [...newBoard[r1][c1].effects];

    newBoard[r1][c1].type = newBoard[r2][c2].type;
    newBoard[r1][c1].effects = [...newBoard[r2][c2].effects];

    newBoard[r2][c2].type = tempType;
    newBoard[r2][c2].effects = tempEffects;

    // Track these positions for re-triggering in commitTurn
    const swappedPositions = [{ r: r1, c: c1 }, { r: r2, c: c2 }];

    // Consume the Manipulation effect from BOTH locations (the one placed AND any it swapped with if it was special)
    newBoard[r1][c1].effects = newBoard[r1][c1].effects.filter((e: SpecialEffect) => e !== 'manipulation');
    newBoard[r2][c2].effects = newBoard[r2][c2].effects.filter((e: SpecialEffect) => e !== 'manipulation');

    // Clear aftershock from both cells involved in the swap
    delete newBoard[r1][c1].aftershock;
    delete newBoard[r2][c2].aftershock;

    // NO DESTRUCTIVE EFFECTS UNTIL COMMIT
    // (Aggression/Captures handled in commitTurn)

    const newState: GameState = {
        ...state,
        board: newBoard,
        history: history,
        pendingSwap: undefined, // Swap done
        swappedPositions: swappedPositions,
    };

    const winStatus = checkWin(newBoard, state.turn, state.turnCount);
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

    if (!checkWin(newBoard, state.turn, state.turnCount).gameOver) {
        const allDestroyed: { r: number; c: number; type: StoneType }[] = [];

        // 1. Resolve Placement Effects (Aggression)
        // Trigger if:
        // - It's the current player's stone (standard placement)
        // - OR it was moved this turn by Manipulation (re-triggering regardless of owner)
        for (let r = 0; r < newBoard.length; r++) {
            for (let c = 0; c < newBoard.length; c++) {
                const isSwapped = state.swappedPositions?.some(p => p.r === r && p.c === c);
                const isCurrentPlayerStone = newBoard[r][c].type === state.turn;

                if (newBoard[r][c].effects.includes('aggression') && (isCurrentPlayerStone || isSwapped)) {
                    const result = triggerAggression(newBoard, { r, c });
                    newBoard = result.board;
                    allDestroyed.push(...result.destroyed);
                }
            }
        }

        // 2. Resolve initial captures
        const cap1 = checkCaptures(newBoard, state.turn);
        newBoard = cap1.board;
        allDestroyed.push(...cap1.destroyed);

        // 3. Resolve spreading effects
        newBoard = spreadEmpathy(newBoard, nextPlayer);

        if (nextPlayer === 'white') {
            const result = spreadResistance(newBoard);
            newBoard = result.board;
        }

        // 4. Resolve captures from spreading
        const cap2 = checkCaptures(newBoard, nextPlayer);
        newBoard = cap2.board;
        allDestroyed.push(...cap2.destroyed);

        // 5. Finalize Destruction Event (Collapse/Aftershock)
        newBoard = handleResolutionEvent(newBoard, allDestroyed, state.turn, state.turnCount);

        // CLEANUP: Remove expired Aftershocks
        for (let r = 0; r < newBoard.length; r++) {
            for (let c = 0; c < newBoard.length; c++) {
                if (newBoard[r][c].aftershock) {
                    // diff >= 2 means a full round cycle has passed
                    if (state.turnCount - newBoard[r][c].aftershock!.turnCreated >= 2) {
                        delete newBoard[r][c].aftershock;
                    }
                }
            }
        }

        // 6. Final win check
        const finalWinStatus = checkWin(newBoard, nextPlayer, state.turnCount + 1);
        gameOver = finalWinStatus.gameOver;
        winner = finalWinStatus.winner;

        // 7. Turn limit check (AI games only) — runs ONLY when Black just committed
        if (!gameOver && state.turn === 'black' && state.turnLimit !== undefined) {
            const blackTurnsDone = Math.ceil((state.turnCount + 1) / 2);
            if (blackTurnsDone >= state.turnLimit) {
                // Turn limit reached — if resistance still exists, white (NPC) wins
                const resistanceRemains = newBoard.some(row =>
                    row.some(cell => cell.type === 'resistance')
                );
                if (resistanceRemains) {
                    gameOver = true;
                    winner = 'white';
                }
            }
        }
    } else {
        const winStatus = checkWin(newBoard, state.turn, state.turnCount);
        gameOver = winStatus.gameOver;
        winner = winStatus.winner;
    }

    const newState: GameState = {
        ...state,
        board: newBoard,
        turn: nextPlayer,
        moveConfirmed: false,
        pendingSwap: undefined,
        gameOver,
        winner,
        turnCount: state.turnCount + 1,
    };

    await saveGame(gameId, newState);
    return newState;
}

export async function pollGame(gameId: string) {
    const game = await getGame(gameId);
    return game;
}
