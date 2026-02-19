import { Board, Cell, Player, SpecialEffect, StoneType, GameState, AIDifficulty } from "@/types/game";

export const createInitialBoard = (size: number): Board => {
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

    // White starts with exactly 2 resistance stones
    const numResistance = 2;
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

    // A Control stone is active if it is NOT adjacent to an opposing Control stone
    // (excluding the current stone if it's a Control stone itself)
    for (const cn of controlNeighbors) {
        const cnType = board[cn.r][cn.c].type;
        const cnOpponent = cnType === 'black' ? 'white' : 'black';

        const cnNeighbors = getNeighbors(cn.r, cn.c, size);
        const hasOpposingControl = cnNeighbors.some(cnn => {
            // Must be an opposing team stone with Control
            const isOpponent = board[cnn.r][cnn.c].type === cnOpponent ||
                (cnOpponent === 'white' && board[cnn.r][cnn.c].type === 'resistance');
            return isOpponent && board[cnn.r][cnn.c].effects.includes('control');
        });

        if (!hasOpposingControl) {
            // This neighbor is an ACTIVE control stone
            return true;
        }
    }

    return false;
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

                // Check if adjacent to resistance
                const neighbors = getNeighbors(r, c, size);
                const isAdjToResistance = neighbors.some(n => board[n.r][n.c].type === 'resistance');

                // Cannot turn resistance if has empathy (standard check, though neutralized covers it)
                const hasEmpathy = board[r][c].effects.includes('empathy');

                if (isAdjToResistance && !hasEmpathy) {
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
export const triggerAggression = (board: Board, pos: { r: number; c: number }): Board => {
    const size = board.length;
    const newBoard = JSON.parse(JSON.stringify(board)) as Board;
    const { r, c } = pos;

    if (!board[r][c].effects.includes('aggression')) return newBoard;

    // "Neutralized stones cannot use special abilities"
    if (isNeutralized(board, r, c)) return newBoard;

    const directions = [
        { dr: 0, dc: 1 }, // horizontal
        { dr: 1, dc: 0 }, // vertical
        { dr: 0, dc: -1 },
        { dr: -1, dc: 0 },
    ];

    directions.forEach(({ dr, dc }) => {
        let currR = r + dr;
        let currC = c + dc;
        const path: { r: number; c: number }[] = [];

        while (currR >= 0 && currR < size && currC >= 0 && currC < size) {
            if (board[currR][currC].type === 'empty') break; // Must be filled
            if (board[currR][currC].effects.includes('aggression')) {
                // Found another aggression stone! Remove everything in between
                path.forEach(p => {
                    newBoard[p.r][p.c].type = 'empty';
                    newBoard[p.r][p.c].effects = [];
                });
                break;
            }
            path.push({ r: currR, c: currC });
            currR += dr;
            currC += dc;
        }
    });

    return newBoard;
};

// Go Capture Logic
export const checkCaptures = (board: Board, lastPlayer: Player): Board => {
    const size = board.length;
    let newBoard = JSON.parse(JSON.stringify(board)) as Board;

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
            if (type === 'empty' || visited.has(`${r}-${c}`)) continue;

            const isOpponent = opponent === 'black'
                ? type === 'black'
                : (type === 'white' || type === 'resistance');

            if (isOpponent) {
                const { group, hasLiberties } = getGroupInfo(newBoard, r, c);
                group.forEach(p => visited.add(`${p.r}-${p.c}`));
                if (!hasLiberties) {
                    group.forEach(p => {
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
            if (type === 'empty' || visited.has(`${r}-${c}`)) continue;

            const isPlayer = lastPlayer === 'black'
                ? type === 'black'
                : (type === 'white' || type === 'resistance');

            if (isPlayer) {
                const { group, hasLiberties } = getGroupInfo(newBoard, r, c);
                group.forEach(p => visited.add(`${p.r}-${p.c}`));
                if (!hasLiberties) {
                    // Suicide!
                    group.forEach(p => {
                        newBoard[p.r][p.c].type = 'empty';
                        newBoard[p.r][p.c].effects = [];
                    });
                }
            }
        }
    }

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
            if (cell.effects.includes('control')) score += 20;
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
            nextBoard = checkCaptures(nextBoard, 'white');

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
            nextBoard = checkCaptures(nextBoard, 'black');

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
): { r: number; c: number; effect: SpecialEffect | null } | null => {
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

        const possibleEffects: (SpecialEffect | null)[] = [null];
        (Object.keys(myInventory) as SpecialEffect[]).forEach(e => {
            if (myInventory[e] > 0) possibleEffects.push(e);
        });

        for (const effect of possibleEffects) {
            let simulatedBoard = JSON.parse(JSON.stringify(board)) as Board;
            simulatedBoard[move.r][move.c].type = turn;
            if (effect) {
                simulatedBoard[move.r][move.c].effects.push(effect);
                if (effect === 'control') {
                    // Control is now dynamic - checked via isNeutralized
                }
            }

            if (effect === 'aggression') simulatedBoard = triggerAggression(simulatedBoard, move);
            simulatedBoard = checkCaptures(simulatedBoard, turn);

            // Simulating turn transition to opponent
            const opponent = turn === 'black' ? 'white' : 'black';
            simulatedBoard = spreadEmpathy(simulatedBoard, opponent);
            if (opponent === 'white') {
                const spreadRes = spreadResistance(simulatedBoard);
                simulatedBoard = spreadRes.board;
            }

            const score = minimax(simulatedBoard, depth - 1, -Infinity, Infinity, false, size);

            // Ko Rule / Negation Prevention: Avoid moves that restore recent states
            let finalScore = score;
            if (state.history.length > 0) {
                const lastState = state.history[state.history.length - 1];
                const boardMatchesLast = JSON.stringify(simulatedBoard) === JSON.stringify(lastState.board);
                if (boardMatchesLast) finalScore -= 1000;

                if (state.history.length > 1) {
                    const secondLastState = state.history[state.history.length - 2];
                    const boardMatchesSecondLast = JSON.stringify(simulatedBoard) === JSON.stringify(secondLastState.board);
                    if (boardMatchesSecondLast) finalScore -= 800;
                }
            }

            if (finalScore > bestEffectScore) {
                bestEffectScore = finalScore;
                bestEffect = effect;
            }
        }

        return { ...move, effect: bestEffect, score: bestEffectScore };
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
