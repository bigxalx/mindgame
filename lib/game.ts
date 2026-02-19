import { Board, Cell, Player, SpecialEffect, StoneType, GameState, AIDifficulty } from "@/types/game";
import { runBehaviorTree } from "@/lib/ai-behavior";

export const createInitialBoard = (size: number, numResistance: number = 2): Board => {
    const board: Board = [];
    for (let r = 0; r < size; r++) {
        const row: Cell[] = [];
        for (let c = 0; c < size; c++) {
            row.push({
                type: 'empty',
                effects: [],
                id: `${r}-${c}-${Math.random().toString(36).substr(2, 9)}`,
            });
        }
        board.push(row);
    }

    const positions: [number, number][] = [];

    while (positions.length < numResistance) {
        const r = Math.floor(Math.random() * size);
        const c = Math.floor(Math.random() * size);
        if (!positions.some(p => p[0] === r && p[1] === c)) {
            positions.push([r, c]);
            board[r][c].type = 'resistance';
        }
    }

    return board;
};

export const getNeighbors = (r: number, c: number, size: number) => {
    const neighbors: { r: number; c: number }[] = [];
    if (r > 0) neighbors.push({ r: r - 1, c });
    if (r < size - 1) neighbors.push({ r: r + 1, c });
    if (c > 0) neighbors.push({ r, c: c - 1 });
    if (c < size - 1) neighbors.push({ r, c: c + 1 });
    return neighbors;
};

/**
 * Checks if a cell is neutralized by an adjacent active Control stone.
 * "Two opposing Control stones neutralize each other."
 */
export const isNeutralized = (board: Board, r: number, c: number): boolean => {
    const size = board.length;
    const cell = board[r][c];
    if (cell.type === 'empty') return false;

    const neighbors = getNeighbors(r, c, size);

    // Check for any adjacent Control stones
    const controlNeighbors = neighbors.filter(n => board[n.r][n.c].effects.includes('control'));

    if (controlNeighbors.length === 0) return false;

    const hasControl = cell.effects.includes('control');
    // Opponent type is fixed for this cell — compute once, not per-neighbor
    const myOpponent: StoneType = cell.type === 'black' ? 'white' : 'black';
    const isNeighborOpponent = (n: { r: number; c: number }) =>
        board[n.r][n.c].type === myOpponent ||
        (myOpponent === 'white' && board[n.r][n.c].type === 'resistance');

    // Case 1: Target IS a Control stone.
    // Rule: "Two opposing Control stones neutralize each other."
    // Neutralized if adjacent to ANY opposing Control stone, regardless of that stone's state.
    if (hasControl) {
        return controlNeighbors.some(isNeighborOpponent);
    }

    // Case 2: Target is NOT a Control stone.
    // Neutralized if adjacent to an opposing Control stone THAT IS ACTIVE (not itself neutralized).
    return controlNeighbors.some(cn => isNeighborOpponent(cn) && !isNeutralized(board, cn.r, cn.c));
};

// Spread resistance: One white stone turns resistance if adjacent to resistance
export const spreadResistance = (board: Board): { board: Board; changed: boolean } => {
    const size = board.length;
    const candidates: { r: number; c: number }[] = [];

    for (let r = 0; r < size; r++) {
        for (let c = 0; c < size; c++) {
            if (board[r][c].type === 'white') {
                // Cannot grow if neutralized
                if (isNeutralized(board, r, c)) continue;

                // STRICT RULE: Resistance can ONLY spread to NEUTRAL white stones (no effects)
                if (board[r][c].effects.length > 0) continue;

                // Check if adjacent to resistance
                const neighbors = getNeighbors(r, c, size);
                const isAdjToResistance = neighbors.some(n => board[n.r][n.c].type === 'resistance');

                if (isAdjToResistance) {
                    candidates.push({ r, c });
                }
            }
        }
    }

    if (candidates.length === 0) return { board, changed: false };

    const randomIdx = Math.floor(Math.random() * candidates.length);
    const target = candidates[randomIdx];
    const newBoard = JSON.parse(JSON.stringify(board)) as Board;
    newBoard[target.r][target.c].type = 'resistance';

    return { board: newBoard, changed: true };
};

// Spread Empathy: Grows at start of its owner's turn
export const spreadEmpathy = (board: Board, activePlayer: Player): Board => {
    const size = board.length;
    const newBoard = JSON.parse(JSON.stringify(board)) as Board;
    const toConvert = new Set<string>();

    const isNeutral = (r: number, c: number) => {
        const cell = board[r][c];
        return cell.type !== 'empty' && cell.type !== 'resistance' && cell.effects.length === 0;
    };

    for (let r = 0; r < size; r++) {
        for (let c = 0; c < size; c++) {
            const cell = board[r][c];

            // Is it an Empathy stone owned by the player?
            const isOwner = activePlayer === 'black'
                ? cell.type === 'black'
                : (cell.type === 'white' || cell.type === 'resistance');

            if (isOwner && cell.effects.includes('empathy')) {
                // Growth is blocked if Empathy is neutralized
                if (isNeutralized(board, r, c)) continue;

                const neighbors = getNeighbors(r, c, size);
                for (const n of neighbors) {
                    if (isNeutral(n.r, n.c)) {
                        toConvert.add(`${n.r}-${n.c}`);
                    }
                }
            }
        }
    }

    toConvert.forEach(key => {
        const [r, c] = key.split('-').map(Number);
        newBoard[r][c].type = activePlayer;
        // VIRAL: Converted stone also becomes an Empathy stone of the new owner
        if (!newBoard[r][c].effects.includes('empathy')) {
            newBoard[r][c].effects.push('empathy');
        }
    });

    return newBoard;
};

// Aggression stones: Destruction between two
export const triggerAggression = (board: Board, pos: { r: number; c: number }): { board: Board; destroyed: { r: number; c: number; type: StoneType }[] } => {
    const size = board.length;
    const newBoard = JSON.parse(JSON.stringify(board)) as Board;
    const { r, c } = pos;
    const destroyed: { r: number; c: number; type: StoneType }[] = [];

    if (!board[r][c].effects.includes('aggression')) return { board: newBoard, destroyed };

    // "Neutralized stones cannot use special abilities"
    if (isNeutralized(board, r, c)) return { board: newBoard, destroyed };

    const directions = [
        { dr: 0, dc: 1 }, // horizontal
        { dr: 1, dc: 0 }, // vertical
        { dr: 0, dc: -1 },
        { dr: -1, dc: 0 },
    ];

    directions.forEach(({ dr, dc }) => {
        let currR = r + dr;
        let currC = c + dc;
        const path: { r: number; c: number; type: StoneType }[] = [];

        while (currR >= 0 && currR < size && currC >= 0 && currC < size) {
            if (board[currR][currC].type === 'empty' || board[currR][currC].type === 'collapse') break;
            if (board[currR][currC].effects.includes('aggression')) {
                // Found another aggression stone! Remove everything in between
                path.forEach(p => {
                    newBoard[p.r][p.c].type = 'empty';
                    newBoard[p.r][p.c].effects = [];
                    destroyed.push(p);
                });
                break;
            }
            path.push({ r: currR, c: currC, type: board[currR][currC].type });
            currR += dr;
            currC += dc;
        }
    });

    return { board: newBoard, destroyed };
};

// Go Capture Logic
export const checkCaptures = (board: Board, lastPlayer: Player): { board: Board; destroyed: { r: number; c: number; type: StoneType }[] } => {
    const size = board.length;
    let newBoard = JSON.parse(JSON.stringify(board)) as Board;
    const destroyed: { r: number; c: number; type: StoneType }[] = [];

    const getGroupInfo = (b: Board, r: number, c: number) => {
        const group: { r: number; c: number }[] = [];
        const queue: { r: number; c: number }[] = [{ r, c }];
        const groupType = b[r][c].type;
        const isWhiteResistance = (t: StoneType) => t === 'white' || t === 'resistance';
        const targetIsWR = isWhiteResistance(groupType);

        const key = (r: number, c: number) => `${r}-${c}`;
        const localVisited = new Set<string>();
        localVisited.add(key(r, c));

        let hasLiberties = false;

        while (queue.length > 0) {
            const curr = queue.shift()!;
            group.push(curr);

            const neighbors = getNeighbors(curr.r, curr.c, size);
            for (const n of neighbors) {
                const nType = b[n.r][n.c].type;
                if (nType === 'empty') {
                    hasLiberties = true;
                } else {
                    const match = targetIsWR
                        ? isWhiteResistance(nType)
                        : (nType === groupType);

                    if (match && !localVisited.has(key(n.r, n.c))) {
                        localVisited.add(key(n.r, n.c));
                        queue.push(n);
                    }
                }
            }
        }
        return { group, hasLiberties };
    };

    // Phase 1: Check for opponent captures first (Rule of Go)
    const opponent = lastPlayer === 'black' ? 'white' : 'black';
    const visited = new Set<string>();

    for (let r = 0; r < size; r++) {
        for (let c = 0; c < size; c++) {
            const type = newBoard[r][c].type;
            if (type === 'empty' || type === 'collapse' || visited.has(`${r}-${c}`)) continue;

            const isOpponent = opponent === 'black'
                ? type === 'black'
                : (type === 'white' || type === 'resistance');

            if (isOpponent) {
                const { group, hasLiberties } = getGroupInfo(newBoard, r, c);
                group.forEach(p => visited.add(`${p.r}-${p.c}`));
                if (!hasLiberties) {
                    group.forEach(p => {
                        destroyed.push({ r: p.r, c: p.c, type: newBoard[p.r][p.c].type });
                        newBoard[p.r][p.c].type = 'empty';
                        newBoard[p.r][p.c].effects = [];
                    });
                }
            }
        }
    }

    // Phase 2: Check for self-capture (suicide prevention)
    visited.clear();
    for (let r = 0; r < size; r++) {
        for (let c = 0; c < size; c++) {
            const type = newBoard[r][c].type;
            if (type === 'empty' || type === 'collapse' || visited.has(`${r}-${c}`)) continue;

            const isPlayer = lastPlayer === 'black'
                ? type === 'black'
                : (type === 'white' || type === 'resistance');

            if (isPlayer) {
                const { group, hasLiberties } = getGroupInfo(newBoard, r, c);
                group.forEach(p => visited.add(`${p.r}-${p.c}`));
                if (!hasLiberties) {
                    // Suicide!
                    group.forEach(p => {
                        destroyed.push({ r: p.r, c: p.c, type: newBoard[p.r][p.c].type });
                        newBoard[p.r][p.c].type = 'empty';
                        newBoard[p.r][p.c].effects = [];
                    });
                }
            }
        }
    }

    return { board: newBoard, destroyed };
};

// Resolution Event: Handles Collapse and Aftershock
export const handleResolutionEvent = (
    board: Board,
    destroyedList: { r: number; c: number; type: StoneType }[],
    lastPlayer: Player,
    turnCount: number
): Board => {
    let newBoard = JSON.parse(JSON.stringify(board)) as Board;
    const size = board.length;

    if (destroyedList.length === 0) return newBoard;

    // De-duplicate by position
    const uniqueMap = new Map<string, { r: number; c: number; type: StoneType }>();
    destroyedList.forEach(p => uniqueMap.set(`${p.r}-${p.c}`, p));
    const uniqueDestroyed = Array.from(uniqueMap.values());

    let collapsePos: { r: number; c: number } | null = null;

    if (uniqueDestroyed.length >= 4) {
        // Step 1: Compute geometric center
        const centerX = uniqueDestroyed.reduce((acc, p) => acc + p.c, 0) / uniqueDestroyed.length;
        const centerY = uniqueDestroyed.reduce((acc, p) => acc + p.r, 0) / uniqueDestroyed.length;

        // Step 2 & 3: Find closest tile (deterministic)
        let minDistance = Infinity;
        let candidates: { r: number; c: number }[] = [];

        for (let r = 0; r < size; r++) {
            for (let c = 0; c < size; c++) {
                const dist = Math.abs(r - centerY) + Math.abs(c - centerX);
                if (dist < minDistance - 0.00001) {
                    minDistance = dist;
                    candidates = [{ r, c }];
                } else if (Math.abs(dist - minDistance) < 0.00001) {
                    candidates.push({ r, c });
                }
            }
        }

        // Step 3 Tie breaker: lowest X (c), then lowest Y (r)
        candidates.sort((a, b) => {
            if (a.c !== b.c) return a.c - b.c;
            return a.r - b.r;
        });

        collapsePos = candidates[0];

        // Step 5 Apply Collapse (Consumption included)
        newBoard[collapsePos.r][collapsePos.c].type = 'collapse';
        newBoard[collapsePos.r][collapsePos.c].effects = [];
        delete newBoard[collapsePos.r][collapsePos.c].aftershock;
    }

    // Step 4 & 6: Mark Aftershocks for remaining destroyed stones
    uniqueDestroyed.forEach(p => {
        // Collapse overrides Aftershock
        if (collapsePos && p.r === collapsePos.r && p.c === collapsePos.c) return;

        newBoard[p.r][p.c].type = 'empty';
        newBoard[p.r][p.c].effects = [];
        // Store the VICTIM's player type so the color shows who was destroyed
        // and so we block the victim's team from reclaiming.
        // 'resistance' is White's stone, so map it to 'white'.
        const victimPlayer: Player = (p.type === 'black') ? 'black' : 'white';
        newBoard[p.r][p.c].aftershock = {
            type: victimPlayer,
            turnCreated: turnCount
        };
    });

    return newBoard;
};

// --- Advanced AI System ---

/**
 * Heuristic Evaluation: Calculates the "value" of a board state from White's perspective.
 */
const evaluateBoardDeep = (board: Board, size: number): number => {
    let score = 0;
    const visited = new Set<string>();

    // Helper: Find group and its liberties
    const getGroupInfo = (r: number, c: number, type: 'black' | 'white-resistance') => {
        const group: { r: number; c: number }[] = [];
        const queue: { r: number; c: number }[] = [{ r, c }];
        const liberties = new Set<string>();
        const localVisited = new Set<string>();
        const stoneType = board[r][c].type;
        const isWhiteResistance = (t: StoneType) => t === 'white' || t === 'resistance';

        localVisited.add(`${r}-${c}`);

        while (queue.length > 0) {
            const curr = queue.shift()!;
            group.push(curr);

            const neighbors = getNeighbors(curr.r, curr.c, size);
            for (const n of neighbors) {
                const nType = board[n.r][n.c].type;
                if (nType === 'empty') {
                    liberties.add(`${n.r}-${n.c}`);
                } else {
                    const match = type === 'white-resistance' ? isWhiteResistance(nType) : nType === 'black';
                    if (match && !localVisited.has(`${n.r}-${n.c}`)) {
                        localVisited.add(`${n.r}-${n.c}`);
                        queue.push(n);
                    }
                }
            }
        }
        return { group, libertyCount: liberties.size };
    };

    for (let r = 0; r < size; r++) {
        for (let c = 0; c < size; c++) {
            const cell = board[r][c];
            if (cell.type === 'empty' || visited.has(`${r}-${c}`)) continue;

            const isWR = cell.type === 'white' || cell.type === 'resistance';
            const groupInfo = getGroupInfo(r, c, isWR ? 'white-resistance' : 'black');
            groupInfo.group.forEach(p => visited.add(`${p.r}-${p.c}`));

            // Score based on group size and vitality (liberties)
            const count = groupInfo.group.length;
            const libs = groupInfo.libertyCount;

            if (isWR) {
                // White/Resistance scoring
                score += count * 15; // Raw presence
                if (libs === 1) score -= 150; // Danger! (Atari)
                else if (libs === 2) score += 40;
                else if (libs >= 3) score += 100;

                // Special bonus for resistance stones specifically
                const resistanceCount = groupInfo.group.filter(p => board[p.r][p.c].type === 'resistance').length;
                score += resistanceCount * 120;

                // Empathy protection bonus
                const groupHasEmpathy = groupInfo.group.some(p => board[p.r][p.c].effects.includes('empathy'));
                if (groupHasEmpathy) score += 60;
            } else {
                // Black scoring (negative for white)
                score -= count * 25;
                if (libs === 0) score += 400; // GREAT! Captured black stones
                if (libs === 1) score += 120; // Black is in danger
                if (libs >= 3) score -= 60;   // Black is strong
            }
        }
    }

    // Positional/Strategic bonuses
    for (let r = 0; r < size; r++) {
        for (let c = 0; c < size; c++) {
            const cell = board[r][c];
            if (cell.type === 'empty') {
                const distToCenter = Math.abs(r - size / 2) + Math.abs(c - size / 2);
                score -= distToCenter * 3;
            }
            if (cell.effects.includes('control')) {
                // Only award strategic bonus for White's control — Black's control is bad for White
                const isWhiteControl = cell.type === 'white' || cell.type === 'resistance';
                score += isWhiteControl ? 20 : -20;
            }
        }
    }

    return score;
};

/**
 * Minimax algorithm with Alpha-Beta pruning
 */
const minimax = (
    board: Board,
    depth: number,
    alpha: number,
    beta: number,
    isMaximizing: boolean,
    size: number
): number => {
    if (depth === 0) return evaluateBoardDeep(board, size);

    const validMoves: { r: number; c: number }[] = [];
    for (let r = 0; r < size; r++) {
        for (let c = 0; c < size; c++) {
            if (board[r][c].type === 'empty') validMoves.push({ r, c });
        }
    }

    if (validMoves.length === 0) return evaluateBoardDeep(board, size);

    // Score and sort moves to improve pruning efficiency
    const scoredMoves = validMoves.map(m => {
        let score = 0;
        const neighbors = getNeighbors(m.r, m.c, size);
        neighbors.forEach(n => {
            if (board[n.r][n.c].type === 'black') score += 10;
            if (board[n.r][n.c].type === 'resistance') score += 20;
        });
        return { ...m, quickScore: score };
    }).sort((a, b) => b.quickScore - a.quickScore);

    if (isMaximizing) {
        let maxEval = -Infinity;
        for (const move of scoredMoves) {
            let nextBoard = JSON.parse(JSON.stringify(board)) as Board;
            nextBoard[move.r][move.c].id = `sim-${move.r}-${move.c}-${depth}`;
            nextBoard[move.r][move.c].type = 'white';
            const { board: capturedBoard } = checkCaptures(nextBoard, 'white');
            nextBoard = capturedBoard;

            // Start of Black's turn:
            let nextTurnBoard = spreadEmpathy(nextBoard, 'black');

            const evalScore = minimax(nextTurnBoard, depth - 1, alpha, beta, false, size);
            maxEval = Math.max(maxEval, evalScore);
            alpha = Math.max(alpha, evalScore);
            if (beta <= alpha) break;
        }
        return maxEval;
    } else {
        let minEval = Infinity;
        for (const move of scoredMoves) {
            let nextBoard = JSON.parse(JSON.stringify(board)) as Board;
            nextBoard[move.r][move.c].id = `sim-${move.r}-${move.c}-${depth}`;
            nextBoard[move.r][move.c].type = 'black';
            const { board: capturedBoard } = checkCaptures(nextBoard, 'black');
            nextBoard = capturedBoard;

            // Start of White's turn:
            let nextTurnBoard = spreadEmpathy(nextBoard, 'white');
            const { board: resistanceBoard } = spreadResistance(nextTurnBoard);

            const evalScore = minimax(resistanceBoard, depth - 1, alpha, beta, true, size);
            minEval = Math.min(minEval, evalScore);
            beta = Math.min(beta, evalScore);
            if (beta <= alpha) break;
        }
        return minEval;
    }
};

export const getAIDecision = (
    state: GameState,
    difficulty: AIDifficulty
): { r: number; c: number; effect: SpecialEffect | null; swap?: { r1: number; c1: number; r2: number; c2: number } } | null => {
    // If behavior tree is active, run it first — falls through to minimax if null
    if (!state.behaviorTree || state.behaviorTree === 'default') {
        const btMove = runBehaviorTree(state);
        if (btMove) return btMove;
    }

    const { board, turn, inventory, boardSize } = state;
    const size = boardSize;
    const myInventory = inventory[turn];

    const validMoves: { r: number; c: number }[] = [];
    for (let r = 0; r < size; r++) {
        for (let c = 0; c < size; c++) {
            if (board[r][c].type === 'empty') validMoves.push({ r, c });
        }
    }

    if (validMoves.length === 0) return null;

    // Depth settings
    let depth = 1;
    if (difficulty === 'hard') depth = 2;
    if (difficulty === 'expert') depth = 3;
    if (difficulty === 'impossible') depth = 4;

    // Adaptive depth based on complexity to avoid hang
    if (size >= 6 && depth > 2) depth = 2;
    if (validMoves.length > 20 && depth > 2) depth = 2;

    const moveEvaluations = validMoves.map(move => {
        let bestEffectScore = -Infinity;
        let bestEffect: SpecialEffect | null = null;
        let bestSwapForThisMove: { r1: number; c1: number; r2: number; c2: number } | undefined = undefined;

        const possibleEffects: (SpecialEffect | null)[] = [null];
        (Object.keys(myInventory) as SpecialEffect[]).forEach(e => {
            if (myInventory[e] > 0) possibleEffects.push(e);
        });

        for (const effect of possibleEffects) {
            let currentEffectBestScore = -Infinity;
            let currentEffectBestSwap: { r1: number; c1: number; r2: number; c2: number } | undefined = undefined;

            if (effect === 'manipulation') {
                const neighbors = getNeighbors(move.r, move.c, size);
                // Also include "no swap" as an option (or swap with self/noop)
                // Actually, Manipulation REQUIRES a swap in the UI, so we test all neighbors
                for (const n of neighbors) {
                    const neighborType = board[n.r][n.c].type;
                    if (neighborType === 'empty' || neighborType === 'collapse') continue;

                    let simulatedBoard = JSON.parse(JSON.stringify(board)) as Board;
                    simulatedBoard[move.r][move.c].type = turn;
                    simulatedBoard[move.r][move.c].effects.push('manipulation');

                    // Simulate swap: only swap types, keep effects in place (matching real swapMove logic)
                    const tempType = simulatedBoard[move.r][move.c].type;
                    simulatedBoard[move.r][move.c].type = simulatedBoard[n.r][n.c].type;
                    simulatedBoard[n.r][n.c].type = tempType;
                    // Consume manipulation effect from both cells
                    simulatedBoard[move.r][move.c].effects = simulatedBoard[move.r][move.c].effects.filter(e => e !== 'manipulation');
                    simulatedBoard[n.r][n.c].effects = simulatedBoard[n.r][n.c].effects.filter(e => e !== 'manipulation');

                    // Resolve
                    const { board: midBoard, destroyed: captured } = checkCaptures(simulatedBoard, turn);
                    simulatedBoard = handleResolutionEvent(midBoard, captured, turn, state.turnCount || 0);

                    // Turn transition
                    const opponent = turn === 'black' ? 'white' : 'black';
                    simulatedBoard = spreadEmpathy(simulatedBoard, opponent);
                    if (opponent === 'white') {
                        const spreadRes = spreadResistance(simulatedBoard);
                        simulatedBoard = spreadRes.board;
                    }

                    const score = minimax(simulatedBoard, depth - 1, -Infinity, Infinity, false, size);
                    if (score > currentEffectBestScore) {
                        currentEffectBestScore = score;
                        currentEffectBestSwap = { r1: move.r, c1: move.c, r2: n.r, c2: n.c };
                    }
                }
            } else {
                let simulatedBoard = JSON.parse(JSON.stringify(board)) as Board;
                simulatedBoard[move.r][move.c].type = turn;
                if (effect) {
                    simulatedBoard[move.r][move.c].effects.push(effect);
                }

                if (effect === 'aggression') {
                    const { board: aggrBoard, destroyed: aggrDestroyed } = triggerAggression(simulatedBoard, move);
                    simulatedBoard = handleResolutionEvent(aggrBoard, aggrDestroyed, turn, state.turnCount || 0);
                }
                const { board: midBoard, destroyed: captured } = checkCaptures(simulatedBoard, turn);
                simulatedBoard = handleResolutionEvent(midBoard, captured, turn, state.turnCount || 0);

                const opponent = turn === 'black' ? 'white' : 'black';
                simulatedBoard = spreadEmpathy(simulatedBoard, opponent);
                if (opponent === 'white') {
                    const spreadRes = spreadResistance(simulatedBoard);
                    simulatedBoard = spreadRes.board;
                }

                currentEffectBestScore = minimax(simulatedBoard, depth - 1, -Infinity, Infinity, false, size);
            }

            if (currentEffectBestScore > bestEffectScore) {
                bestEffectScore = currentEffectBestScore;
                bestEffect = effect;
                bestSwapForThisMove = currentEffectBestSwap;
            }
        }

        return { ...move, effect: bestEffect, score: bestEffectScore, swap: bestSwapForThisMove };
    });

    moveEvaluations.sort((a, b) => b.score - a.score);

    if (difficulty === 'easy') {
        return moveEvaluations[Math.floor(Math.random() * moveEvaluations.length)];
    }
    if (difficulty === 'medium') {
        const top = moveEvaluations.slice(0, 3);
        return top[Math.floor(Math.random() * top.length)];
    }

    return moveEvaluations[0];
};
