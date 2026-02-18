import { Board, Cell, Player, SpecialEffect, StoneType } from "@/types/game";

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
export const spreadEmpathy = (board: Board): Board => {
    const size = board.length;
    const newBoard = JSON.parse(JSON.stringify(board)) as Board;
    const toAdd: { r: number; c: number }[] = [];

    for (let r = 0; r < size; r++) {
        for (let c = 0; c < size; c++) {
            if (board[r][c].effects.includes('empathy')) {
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

export const basicAI = (board: Board, player: Player): { r: number; c: number; effect?: SpecialEffect } | null => {
    const size = board.length;
    const validMoves: { r: number; c: number }[] = [];

    for (let r = 0; r < size; r++) {
        for (let c = 0; c < size; c++) {
            if (board[r][c].type === 'empty') {
                validMoves.push({ r, c });
            }
        }
    }

    if (validMoves.length === 0) return null;

    // Simple heuristic: Try to block black or spread near yellow
    // For now, random move is "very basic" as requested
    const randomMove = validMoves[Math.floor(Math.random() * validMoves.length)];

    // Randomly add a special effect to make it more interesting for white
    const effects: SpecialEffect[] = ['action', 'control', 'empathy', 'opportunity'];
    const effect = Math.random() > 0.7 ? effects[Math.floor(Math.random() * effects.length)] : undefined;

    return { ...randomMove, effect };
};
