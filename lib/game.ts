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

    // White starts with 1-2 yellow stones
    const numYellow = Math.floor(Math.random() * 2) + 1;
    const positions: [number, number][] = [];

    while (positions.length < numYellow) {
        const r = Math.floor(Math.random() * size);
        const c = Math.floor(Math.random() * size);
        if (!positions.some(p => p[0] === r && p[1] === c)) {
            positions.push([r, c]);
            board[r][c].type = 'yellow';
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

// Spread yellow: One white stone turns yellow if adjacent to yellow
export const spreadYellow = (board: Board): { board: Board; changed: boolean } => {
    const size = board.length;
    const candidates: { r: number; c: number }[] = [];

    for (let r = 0; r < size; r++) {
        for (let c = 0; c < size; c++) {
            if (board[r][c].type === 'white') {
                // Check if adjacent to yellow
                const neighbors = getNeighbors(r, c, size);
                const isAdjToYellow = neighbors.some(n => board[n.r][n.c].type === 'yellow');

                // Cannot turn yellow if has empathy
                const hasEmpathy = board[r][c].effects.includes('empathy');

                // Check for control stones nearby that stop spread
                const isBlockedByControl = neighbors.some(n => board[n.r][n.c].effects.includes('control'));

                if (isAdjToYellow && !hasEmpathy && !isBlockedByControl) {
                    candidates.push({ r, c });
                }
            }
        }
    }

    if (candidates.length === 0) return { board, changed: false };

    const randomIdx = Math.floor(Math.random() * candidates.length);
    const target = candidates[randomIdx];
    const newBoard = JSON.parse(JSON.stringify(board)) as Board;
    newBoard[target.r][target.c].type = 'yellow';

    return { board: newBoard, changed: true };
};

// Spread Empathy: Spreads like a virus
// Spread Empathy: Spreads like a virus, but only from the active player's stones
export const spreadEmpathy = (board: Board, activePlayer: Player): Board => {
    const size = board.length;
    const newBoard = JSON.parse(JSON.stringify(board)) as Board;
    const toAdd: { r: number; c: number }[] = [];

    for (let r = 0; r < size; r++) {
        for (let c = 0; c < size; c++) {
            const cell = board[r][c];
            const isPlayerStone = activePlayer === 'black'
                ? cell.type === 'black'
                : (cell.type === 'white' || cell.type === 'yellow');

            if (isPlayerStone && cell.effects.includes('empathy')) {
                const neighbors = getNeighbors(r, c, size);
                for (const n of neighbors) {
                    if (board[n.r][n.c].type !== 'empty' && !board[n.r][n.c].effects.includes('empathy')) {
                        // Check if blocked by control
                        const isBlockedByControl = getNeighbors(n.r, n.c, size).some(nn => board[nn.r][nn.c].effects.includes('control'));
                        if (!isBlockedByControl) {
                            toAdd.push({ r: n.r, c: n.c });
                        }
                    }
                }
            }
        }
    }

    toAdd.forEach(pos => {
        newBoard[pos.r][pos.c].effects.push('empathy');
    });

    return newBoard;
};

// Action stones: Destruction between two
export const triggerAction = (board: Board, pos: { r: number; c: number }): Board => {
    const size = board.length;
    const newBoard = JSON.parse(JSON.stringify(board)) as Board;
    const { r, c } = pos;

    if (!board[r][c].effects.includes('action')) return newBoard;

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
            if (board[currR][currC].effects.includes('action')) {
                // Found another action stone! Remove everything in between
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
    const visited = new Set<string>();
    let newBoard = JSON.parse(JSON.stringify(board)) as Board;

    // We check for groups of stones that have no liberties
    // A stone is captured if its entire group has 0 adjacent empty spaces

    // Note: Usually in Go, you check the opponent's stones first, then your own.
    const opponent = lastPlayer === 'black' ? 'white' : 'black';
    const stoneTypes = lastPlayer === 'black' ? ['white', 'yellow'] : ['black'];

    const getGroup = (r: number, c: number, type: StoneType | 'white-yellow') => {
        const group: { r: number; c: number }[] = [];
        const queue: { r: number; c: number }[] = [{ r, c }];
        const groupType = board[r][c].type;
        const isWhiteYellow = (t: StoneType) => t === 'white' || t === 'yellow';

        const key = (r: number, c: number) => `${r}-${c}`;
        const localVisited = new Set<string>();
        localVisited.add(key(r, c));

        while (queue.length > 0) {
            const curr = queue.shift()!;
            group.push(curr);

            const neighbors = getNeighbors(curr.r, curr.c, size);
            for (const n of neighbors) {
                const nType = board[n.r][n.c].type;
                const match = type === 'white-yellow'
                    ? isWhiteYellow(nType)
                    : nType === groupType;

                if (match && !localVisited.has(key(n.r, n.c))) {
                    localVisited.add(key(n.r, n.c));
                    queue.push(n);
                }
            }
        }
        return group;
    };

    const hasLiberties = (group: { r: number; c: number }[]) => {
        for (const p of group) {
            const neighbors = getNeighbors(p.r, p.c, size);
            if (neighbors.some(n => board[n.r][n.c].type === 'empty')) return true;
        }
        return false;
    };

    // Check all cells
    for (let r = 0; r < size; r++) {
        for (let c = 0; c < size; c++) {
            if (board[r][c].type === 'empty') continue;
            if (visited.has(`${r}-${c}`)) continue;

            const type = board[r][c].type;
            const group = getGroup(r, c, (type === 'white' || type === 'yellow') ? 'white-yellow' : 'black');

            group.forEach(p => visited.add(`${p.r}-${p.c}`));

            if (!hasLiberties(group)) {
                // Capture!
                group.forEach(p => {
                    newBoard[p.r][p.c].type = 'empty';
                    newBoard[p.r][p.c].effects = [];
                });
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
    const getGroupInfo = (r: number, c: number, type: 'black' | 'white-yellow') => {
        const group: { r: number; c: number }[] = [];
        const queue: { r: number; c: number }[] = [{ r, c }];
        const liberties = new Set<string>();
        const localVisited = new Set<string>();
        const stoneType = board[r][c].type;
        const isWhiteYellow = (t: StoneType) => t === 'white' || t === 'yellow';

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
                    const match = type === 'white-yellow' ? isWhiteYellow(nType) : nType === 'black';
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

            const isWY = cell.type === 'white' || cell.type === 'yellow';
            const groupInfo = getGroupInfo(r, c, isWY ? 'white-yellow' : 'black');
            groupInfo.group.forEach(p => visited.add(`${p.r}-${p.c}`));

            // Score based on group size and vitality (liberties)
            const count = groupInfo.group.length;
            const libs = groupInfo.libertyCount;

            if (isWY) {
                // White/Yellow scoring
                score += count * 15; // Raw presence
                if (libs === 1) score -= 150; // Danger! (Atari)
                else if (libs === 2) score += 40;
                else if (libs >= 3) score += 100;

                // Special bonus for yellow stones specifically
                const yellowCount = groupInfo.group.filter(p => board[p.r][p.c].type === 'yellow').length;
                score += yellowCount * 120;

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
            if (board[n.r][n.c].type === 'yellow') score += 20;
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
            const { board: yellowBoard } = spreadYellow(nextTurnBoard);

            const evalScore = minimax(yellowBoard, depth - 1, alpha, beta, true, size);
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
                    getNeighbors(move.r, move.c, size).forEach(n => {
                        if (!simulatedBoard[n.r][n.c].effects.includes('control')) {
                            simulatedBoard[n.r][n.c].effects.push('control');
                        }
                    });
                }
            }

            if (effect === 'action') simulatedBoard = triggerAction(simulatedBoard, move);
            simulatedBoard = checkCaptures(simulatedBoard, turn);

            // Simulating turn transition to opponent
            const opponent = turn === 'black' ? 'white' : 'black';
            simulatedBoard = spreadEmpathy(simulatedBoard, opponent);
            if (opponent === 'white') {
                const spreadRes = spreadYellow(simulatedBoard);
                simulatedBoard = spreadRes.board;
            }

            const score = minimax(simulatedBoard, depth - 1, -Infinity, Infinity, false, size);

            if (score > bestEffectScore) {
                bestEffectScore = score;
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
