/**
 * AI Behavior Tree System
 *
 * Priority-ordered, chance-gated behavior tree for NPC decision making.
 * Each behavior generates a candidate move; the first valid one executes.
 *
 * Priority scale:
 *   999 = Hard constraint (Negation Prevention — always-on filter)
 *   100 = Critical survival
 *    80 = Immediate counter / defense
 *    60 = Core objective
 *    40 = Tactical opportunity
 *    20 = Positional fallback
 */

import {
    Board, GameState, SpecialEffect, StoneType, Player,
} from "@/types/game";
import { getNeighbors, isNeutralized, triggerAggression, checkCaptures } from "@/lib/game";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CandidateMove {
    r: number;
    c: number;
    effect: SpecialEffect | null;
    swap?: { r1: number; c1: number; r2: number; c2: number };
}

export interface BehaviorConfig {
    priority: number;
    triggerChance: number;
    name: string;
    generate: (state: GameState) => CandidateMove | null;
}

// ---------------------------------------------------------------------------
// Internal group analysis helpers
// ---------------------------------------------------------------------------

interface GroupInfo {
    group: { r: number; c: number }[];
    liberties: { r: number; c: number }[];
}

function getGroupInfo(board: Board, startR: number, startC: number, size: number): GroupInfo {
    const groupType = board[startR][startC].type;
    const isWhiteResistance = (t: StoneType) => t === 'white' || t === 'resistance';
    const targetIsWR = isWhiteResistance(groupType);

    const group: { r: number; c: number }[] = [];
    const libertySet = new Map<string, { r: number; c: number }>();
    const visited = new Set<string>();
    const queue = [{ r: startR, c: startC }];
    visited.add(`${startR}-${startC}`);

    while (queue.length > 0) {
        const curr = queue.shift()!;
        group.push(curr);
        for (const n of getNeighbors(curr.r, curr.c, size)) {
            const nType = board[n.r][n.c].type;
            if (nType === 'empty') {
                libertySet.set(`${n.r}-${n.c}`, n);
            } else {
                const match = targetIsWR ? isWhiteResistance(nType) : nType === groupType;
                if (match && !visited.has(`${n.r}-${n.c}`)) {
                    visited.add(`${n.r}-${n.c}`);
                    queue.push(n);
                }
            }
        }
    }
    return { group, liberties: Array.from(libertySet.values()) };
}

function getAllGroups(board: Board, size: number, filter: (t: StoneType) => boolean): GroupInfo[] {
    const visited = new Set<string>();
    const groups: GroupInfo[] = [];

    for (let r = 0; r < size; r++) {
        for (let c = 0; c < size; c++) {
            const key = `${r}-${c}`;
            const t = board[r][c].type;
            if (!visited.has(key) && filter(t)) {
                const info = getGroupInfo(board, r, c, size);
                info.group.forEach(p => visited.add(`${p.r}-${p.c}`));
                groups.push(info);
            }
        }
    }
    return groups;
}

function isEmptyCell(board: Board, r: number, c: number): boolean {
    return board[r][c].type === 'empty';
}

function randomFrom<T>(arr: T[]): T | null {
    if (arr.length === 0) return null;
    return arr[Math.floor(Math.random() * arr.length)];
}

// ---------------------------------------------------------------------------
// Negation Prevention helper
// ---------------------------------------------------------------------------

/**
 * Compresses a board to a comparable string.
 * Light version: only type + effects hash, no IDs.
 */
function boardHash(board: Board): string {
    return board.map(row =>
        row.map(cell => `${cell.type[0]}${cell.effects.map(e => e[0]).sort().join('')}`).join(',')
    ).join(';');
}

function isNegationMove(candidate: CandidateMove, state: GameState): boolean {
    // Simulate placing the stone and see if the result matches a recent history state
    const board: Board = JSON.parse(JSON.stringify(state.board));
    board[candidate.r][candidate.c].type = state.turn;
    if (candidate.effect) board[candidate.r][candidate.c].effects.push(candidate.effect);
    const hash = boardHash(board);

    // Check last 2 history entries
    const recent = state.history.slice(-2);
    for (const h of recent) {
        if (boardHash(h.board) === hash) return true;
    }
    return false;
}

// ---------------------------------------------------------------------------
// Constraint helpers (Avoid Double Risk)
// ---------------------------------------------------------------------------

function weakensResistance(candidate: CandidateMove, board: Board, size: number): boolean {
    // If this move would directly reduce a resistance group's liberties when it shouldn't
    // Simple check: this move is NOT adjacent to any resistance group
    const neighbors = getNeighbors(candidate.r, candidate.c, size);
    const adjResistance = neighbors.some(n =>
        board[n.r][n.c].type === 'resistance' || board[n.r][n.c].type === 'white'
    );
    return !adjResistance; // placing away from resistance "weakens" relative positioning
}

function createsAggressionVulnerability(candidate: CandidateMove, board: Board, size: number): boolean {
    // If placing here would complete a line between two black aggression stones
    const { r, c } = candidate;
    const directions = [{ dr: 0, dc: 1 }, { dr: 1, dc: 0 }];
    for (const { dr, dc } of directions) {
        let found = false;
        for (const sign of [-1, 1]) {
            let cr = r + dr * sign, cc = c + dc * sign;
            while (cr >= 0 && cr < size && cc >= 0 && cc < size) {
                const t = board[cr][cc].type;
                if (t === 'empty') break;
                if (t === 'collapse') break;
                if (t === 'black' && board[cr][cc].effects.includes('aggression')) {
                    found = true;
                    break;
                }
                cr += dr * sign;
                cc += dc * sign;
            }
        }
        if (found) return true;
    }
    return false;
}

// ---------------------------------------------------------------------------
// Individual Behavior generators
// ---------------------------------------------------------------------------

/** B1: Prevent Immediate Resistance Loss (Priority 100, Chance 1.0) */
function b1_preventResistanceLoss(state: GameState): CandidateMove | null {
    const { board, boardSize: size } = state;
    const wrGroups = getAllGroups(board, size, t => t === 'white' || t === 'resistance');
    const dangerGroups = wrGroups.filter(g => g.liberties.length <= 1);
    for (const g of dangerGroups) {
        if (g.liberties.length === 1) {
            const lib = g.liberties[0];
            if (isEmptyCell(board, lib.r, lib.c)) {
                return { r: lib.r, c: lib.c, effect: null };
            }
        }
    }
    return null;
}

/** B2: Avoid Resistance Encirclement (Priority 90, Chance 0.95) */
function b2_avoidEncirclement(state: GameState): CandidateMove | null {
    const { board, boardSize: size } = state;
    const wrGroups = getAllGroups(board, size, t => t === 'white' || t === 'resistance');
    const atRiskGroups = wrGroups.filter(g => g.liberties.length <= 2);
    // Pick any liberty of the most endangered group
    atRiskGroups.sort((a, b) => a.liberties.length - b.liberties.length);
    for (const g of atRiskGroups) {
        const target = randomFrom(g.liberties.filter(l => isEmptyCell(board, l.r, l.c)));
        if (target) return { r: target.r, c: target.c, effect: null };
    }
    return null;
}

/** B3: Capture Player Stones (Priority 85, Chance 0.85) */
function b3_capturePlayerStones(state: GameState): CandidateMove | null {
    const { board, boardSize: size } = state;
    const blackGroups = getAllGroups(board, size, t => t === 'black');
    const atari = blackGroups.filter(g => g.liberties.length === 1);
    atari.sort((a, b) => b.group.length - a.group.length); // prefer larger captures
    for (const g of atari) {
        const lib = g.liberties[0];
        if (isEmptyCell(board, lib.r, lib.c)) {
            return { r: lib.r, c: lib.c, effect: null };
        }
    }
    return null;
}

/** B4: Prevent Full Control of Resistance (Priority 80, Chance 0.9) */
function b4_preventControlOfResistance(state: GameState): CandidateMove | null {
    const { board, boardSize: size } = state;
    // Find resistance stones adjacent to active black Control stones
    for (let r = 0; r < size; r++) {
        for (let c = 0; c < size; c++) {
            if (board[r][c].type !== 'resistance') continue;
            const neighbors = getNeighbors(r, c, size);
            for (const n of neighbors) {
                if (
                    board[n.r][n.c].type === 'black' &&
                    board[n.r][n.c].effects.includes('control') &&
                    !isNeutralized(board, n.r, n.c)
                ) {
                    // Try to place a control stone adjacent to that black control to neutralize it
                    const counterCandidates = getNeighbors(n.r, n.c, size)
                        .filter(nn => isEmptyCell(board, nn.r, nn.c));
                    const target = randomFrom(counterCandidates);
                    if (target && state.inventory.white.control > 0) {
                        return { r: target.r, c: target.c, effect: 'control' };
                    }
                    // Fallback: just place a plain stone nearby to create a buffer
                    const fallback = randomFrom(counterCandidates);
                    if (fallback) return { r: fallback.r, c: fallback.c, effect: null };
                }
            }
        }
    }
    return null;
}

/** B5: Respond to Player Empathy (Priority 75, Chance 0.85) */
function b5_respondToEmpathy(state: GameState): CandidateMove | null {
    const { board, boardSize: size } = state;
    // Find black empathy stones
    const empathyStones: { r: number; c: number }[] = [];
    for (let r = 0; r < size; r++) {
        for (let c = 0; c < size; c++) {
            if (board[r][c].type === 'black' && board[r][c].effects.includes('empathy')) {
                empathyStones.push({ r, c });
            }
        }
    }
    if (empathyStones.length === 0) return null;

    // Prefer placing a control stone adjacent to neutralize
    if (state.inventory.white.control > 0) {
        for (const es of empathyStones) {
            const candidates = getNeighbors(es.r, es.c, size)
                .filter(n => isEmptyCell(board, n.r, n.c));
            const target = randomFrom(candidates);
            if (target) return { r: target.r, c: target.c, effect: 'control' };
        }
    }

    // Try to capture the empathy group
    for (const es of empathyStones) {
        const info = getGroupInfo(board, es.r, es.c, size);
        if (info.liberties.length === 1) {
            const lib = info.liberties[0];
            if (isEmptyCell(board, lib.r, lib.c)) {
                return { r: lib.r, c: lib.c, effect: null };
            }
        }
    }
    return null;
}

/** B6: Respond to Player Aggression (Priority 70, Chance 0.8) */
function b6_respondToAggression(state: GameState): CandidateMove | null {
    const { board, boardSize: size } = state;
    // Find pairs of black aggression stones on same row or column
    const aggrStones: { r: number; c: number }[] = [];
    for (let r = 0; r < size; r++) {
        for (let c = 0; c < size; c++) {
            if (board[r][c].type === 'black' && board[r][c].effects.includes('aggression')) {
                aggrStones.push({ r, c });
            }
        }
    }
    for (let i = 0; i < aggrStones.length; i++) {
        for (let j = i + 1; j < aggrStones.length; j++) {
            const a = aggrStones[i], b = aggrStones[j];
            if (a.r === b.r) {
                // Same row — find empty cells between them
                const minC = Math.min(a.c, b.c), maxC = Math.max(a.c, b.c);
                for (let c = minC + 1; c < maxC; c++) {
                    if (isEmptyCell(board, a.r, c)) {
                        return { r: a.r, c, effect: null }; // block the beam
                    }
                }
            } else if (a.c === b.c) {
                // Same column
                const minR = Math.min(a.r, b.r), maxR = Math.max(a.r, b.r);
                for (let r = minR + 1; r < maxR; r++) {
                    if (isEmptyCell(board, r, a.c)) {
                        return { r, c: a.c, effect: null };
                    }
                }
            }
        }
    }
    return null;
}

/** B7: Respond to Player Control (Priority 65, Chance 0.75) */
function b7_respondToControl(state: GameState): CandidateMove | null {
    const { board, boardSize: size } = state;
    // Find active black control stones neutralizing white/resistance
    for (let r = 0; r < size; r++) {
        for (let c = 0; c < size; c++) {
            if (
                board[r][c].type === 'black' &&
                board[r][c].effects.includes('control') &&
                !isNeutralized(board, r, c)
            ) {
                // Counter: place white control adjacent to this black control stone
                if (state.inventory.white.control > 0) {
                    const candidates = getNeighbors(r, c, size)
                        .filter(n => isEmptyCell(board, n.r, n.c));
                    const target = randomFrom(candidates);
                    if (target) return { r: target.r, c: target.c, effect: 'control' };
                }
                // Surround and capture it
                const info = getGroupInfo(board, r, c, size);
                if (info.liberties.length === 1) {
                    const lib = info.liberties[0];
                    if (isEmptyCell(board, lib.r, lib.c)) {
                        return { r: lib.r, c: lib.c, effect: null };
                    }
                }
            }
        }
    }
    return null;
}

/** B8: Expand Resistance (Priority 60, Chance 0.85) */
function b8_expandResistance(state: GameState): CandidateMove | null {
    const { board, boardSize: size } = state;
    const candidates: { r: number; c: number }[] = [];
    for (let r = 0; r < size; r++) {
        for (let c = 0; c < size; c++) {
            if (!isEmptyCell(board, r, c)) continue;
            const neighbors = getNeighbors(r, c, size);
            if (neighbors.some(n => board[n.r][n.c].type === 'resistance')) {
                candidates.push({ r, c });
            }
        }
    }
    // Prefer positions adjacent to resistance groups that have few liberties
    candidates.sort((a, b) => {
        const libA = getNeighbors(a.r, a.c, size).filter(n => board[n.r][n.c].type === 'empty').length;
        const libB = getNeighbors(b.r, b.c, size).filter(n => board[n.r][n.c].type === 'empty').length;
        return libA - libB;
    });
    const target = candidates[0];
    if (target) return { r: target.r, c: target.c, effect: null };
    return null;
}

/** B9: Enable Resistance Growth (Priority 55, Chance 0.8) */
function b9_enableResistanceGrowth(state: GameState): CandidateMove | null {
    const { board, boardSize: size } = state;
    // Find resistance stones that have no adjacent white stone (no growth vector)
    for (let r = 0; r < size; r++) {
        for (let c = 0; c < size; c++) {
            if (board[r][c].type !== 'resistance') continue;
            const neighbors = getNeighbors(r, c, size);
            const hasWhiteNeighbor = neighbors.some(n => board[n.r][n.c].type === 'white');
            if (!hasWhiteNeighbor) {
                // Place a white stone adjacent to create a future growth vector
                const emptyCells = neighbors.filter(n => isEmptyCell(board, n.r, n.c));
                const target = randomFrom(emptyCells);
                if (target) return { r: target.r, c: target.c, effect: null };
            }
        }
    }
    return null;
}

/** B10: Place NPC Control (Priority 50, Chance 0.65) */
function b10_placeNpcControl(state: GameState): CandidateMove | null {
    const { board, boardSize: size, inventory } = state;
    if (inventory.white.control <= 0) return null;

    // Target positions adjacent to black empathy stones (priority)
    const candidates: { r: number; c: number; score: number }[] = [];
    for (let r = 0; r < size; r++) {
        for (let c = 0; c < size; c++) {
            if (!isEmptyCell(board, r, c)) continue;
            const neighbors = getNeighbors(r, c, size);
            let score = 0;
            for (const n of neighbors) {
                if (board[n.r][n.c].type === 'black') {
                    score += board[n.r][n.c].effects.includes('empathy') ? 3 : 1;
                }
            }
            if (score > 0) candidates.push({ r, c, score });
        }
    }
    if (candidates.length === 0) return null;
    candidates.sort((a, b) => b.score - a.score);
    const best = candidates[0];
    return { r: best.r, c: best.c, effect: 'control' };
}

/** B11: Use NPC Manipulation (Priority 50, Chance 0.6) */
function b11_npcManipulation(state: GameState): CandidateMove | null {
    const { board, boardSize: size, inventory, turn } = state;
    if (inventory.white.manipulation <= 0) return null;

    let bestScore = 0;
    let bestMove: CandidateMove | null = null;

    for (let r = 0; r < size; r++) {
        for (let c = 0; c < size; c++) {
            if (!isEmptyCell(board, r, c)) continue;
            const neighbors = getNeighbors(r, c, size);
            for (const n of neighbors) {
                const nType = board[n.r][n.c].type;
                if (nType === 'empty' || nType === 'collapse') continue;

                // Simulate: place white at (r,c) then swap types
                const simBoard: Board = JSON.parse(JSON.stringify(board));
                simBoard[r][c].type = turn;
                const tempType = simBoard[r][c].type;
                simBoard[r][c].type = simBoard[n.r][n.c].type;
                simBoard[n.r][n.c].type = tempType;

                // Score: how many black stones are captured after this?
                const { destroyed } = checkCaptures(simBoard, turn);
                const gain = destroyed.filter(d => simBoard[d.r][d.c].type !== 'white' && simBoard[d.r][d.c].type !== 'resistance').length;

                // Extra score if a resistance stone gets freed
                const resistanceFree = destroyed.some(d => board[d.r][d.c].type === 'black');
                const score = gain * 10 + (resistanceFree ? 5 : 0);
                if (score > bestScore) {
                    bestScore = score;
                    bestMove = {
                        r, c, effect: 'manipulation',
                        swap: { r1: r, c1: c, r2: n.r, c2: n.c }
                    };
                }
            }
        }
    }
    return bestMove;
}

/** B12: Place NPC Aggression (Priority 45, Chance 0.6) */
function b12_npcAggression(state: GameState): CandidateMove | null {
    const { board, boardSize: size, inventory, turn } = state;
    if (inventory.white.aggression <= 0) return null;

    // Find existing white aggression stones
    const existingAggr: { r: number; c: number }[] = [];
    for (let r = 0; r < size; r++) {
        for (let c = 0; c < size; c++) {
            if (board[r][c].type === 'white' && board[r][c].effects.includes('aggression')) {
                existingAggr.push({ r, c });
            }
        }
    }

    // For each empty cell, check if placing aggression there creates a line with an existing
    // aggression stone that would destroy >= 2 black/mixed stones
    for (let r = 0; r < size; r++) {
        for (let c = 0; c < size; c++) {
            if (!isEmptyCell(board, r, c)) continue;
            for (const ea of existingAggr) {
                if (ea.r !== r && ea.c !== c) continue; // must be same row or col
                let count = 0;
                if (ea.r === r) {
                    const minC = Math.min(ea.c, c), maxC = Math.max(ea.c, c);
                    for (let cc = minC + 1; cc < maxC; cc++) {
                        const t = board[r][cc].type;
                        if (t !== 'empty' && t !== 'collapse') count++;
                    }
                } else {
                    const minR = Math.min(ea.r, r), maxR = Math.max(ea.r, r);
                    for (let rr = minR + 1; rr < maxR; rr++) {
                        const t = board[rr][c].type;
                        if (t !== 'empty' && t !== 'collapse') count++;
                    }
                }
                if (count >= 2) {
                    return { r, c, effect: 'aggression' };
                }
            }
        }
    }
    return null;
}

/** B13: Place NPC Empathy (Priority 40, Chance 0.6) */
function b13_npcEmpathy(state: GameState): CandidateMove | null {
    const { board, boardSize: size, inventory } = state;
    if (inventory.white.empathy <= 0) return null;

    for (let r = 0; r < size; r++) {
        for (let c = 0; c < size; c++) {
            if (!isEmptyCell(board, r, c)) continue;
            const neighbors = getNeighbors(r, c, size);
            // Count neutral black stones (no effects)
            const neutralBlack = neighbors.filter(
                n => board[n.r][n.c].type === 'black' && board[n.r][n.c].effects.length === 0
            ).length;
            if (neutralBlack >= 2) {
                return { r, c, effect: 'empathy' };
            }
        }
    }
    return null;
}

/** B14: Break Player Structure (Priority 35, Chance 0.5) */
function b14_breakPlayerStructure(state: GameState): CandidateMove | null {
    const { board, boardSize: size } = state;
    // Find the cell that reduces the most liberties of the largest black group
    const blackGroups = getAllGroups(board, size, t => t === 'black');
    if (blackGroups.length === 0) return null;
    blackGroups.sort((a, b) => b.group.length - a.group.length);
    const largest = blackGroups[0];

    // Find the liberty that is shared by the most group members
    const libertyCounts = new Map<string, { r: number; c: number; count: number }>();
    for (const p of largest.group) {
        for (const n of getNeighbors(p.r, p.c, size)) {
            if (isEmptyCell(board, n.r, n.c)) {
                const key = `${n.r}-${n.c}`;
                const prev = libertyCounts.get(key);
                libertyCounts.set(key, { r: n.r, c: n.c, count: (prev?.count ?? 0) + 1 });
            }
        }
    }
    const sorted = Array.from(libertyCounts.values()).sort((a, b) => b.count - a.count);
    if (sorted.length > 0) {
        return { r: sorted[0].r, c: sorted[0].c, effect: null };
    }
    return null;
}

/** B16: Positional Improvement — fallback (Priority 10, Chance 1.0) */
function b16_positionalImprovement(state: GameState): CandidateMove | null {
    const { board, boardSize: size } = state;
    let bestScore = -Infinity;
    let bestMove: { r: number; c: number } | null = null;

    for (let r = 0; r < size; r++) {
        for (let c = 0; c < size; c++) {
            if (!isEmptyCell(board, r, c)) continue;
            let score = 0;
            const neighbors = getNeighbors(r, c, size);
            for (const n of neighbors) {
                const t = board[n.r][n.c].type;
                if (t === 'resistance') score += 20;
                else if (t === 'white') score += 10;
                else if (t === 'black') score += 5; // adjacent to enemy = tactical value
            }
            // Center preference
            const distToCenter = Math.abs(r - size / 2) + Math.abs(c - size / 2);
            score -= distToCenter * 2;
            if (score > bestScore) {
                bestScore = score;
                bestMove = { r, c };
            }
        }
    }
    if (bestMove) return { r: bestMove.r, c: bestMove.c, effect: null };
    return null;
}

// ---------------------------------------------------------------------------
// Default Behavior Configuration
// ---------------------------------------------------------------------------

export const DEFAULT_BEHAVIOR_CONFIG: BehaviorConfig[] = [
    { priority: 100, triggerChance: 1.0, name: 'Prevent Resistance Loss', generate: b1_preventResistanceLoss },
    { priority: 90, triggerChance: 0.95, name: 'Avoid Encirclement', generate: b2_avoidEncirclement },
    { priority: 85, triggerChance: 0.85, name: 'Capture Player Stones', generate: b3_capturePlayerStones },
    { priority: 80, triggerChance: 0.9, name: 'Prevent Control of Resistance', generate: b4_preventControlOfResistance },
    { priority: 75, triggerChance: 0.85, name: 'Respond to Empathy', generate: b5_respondToEmpathy },
    { priority: 70, triggerChance: 0.8, name: 'Respond to Aggression', generate: b6_respondToAggression },
    { priority: 65, triggerChance: 0.75, name: 'Respond to Control', generate: b7_respondToControl },
    { priority: 60, triggerChance: 0.85, name: 'Expand Resistance', generate: b8_expandResistance },
    { priority: 55, triggerChance: 0.8, name: 'Enable Resistance Growth', generate: b9_enableResistanceGrowth },
    { priority: 50, triggerChance: 0.65, name: 'Place NPC Control', generate: b10_placeNpcControl },
    { priority: 50, triggerChance: 0.6, name: 'Use NPC Manipulation', generate: b11_npcManipulation },
    { priority: 45, triggerChance: 0.6, name: 'Place NPC Aggression', generate: b12_npcAggression },
    { priority: 40, triggerChance: 0.6, name: 'Place NPC Empathy', generate: b13_npcEmpathy },
    { priority: 35, triggerChance: 0.5, name: 'Break Player Structure', generate: b14_breakPlayerStructure },
    { priority: 10, triggerChance: 1.0, name: 'Positional Improvement', generate: b16_positionalImprovement },
];

// ---------------------------------------------------------------------------
// Behavior Tree Runner
// ---------------------------------------------------------------------------

/**
 * Runs the behavior tree in priority order.
 * Applies Negation Prevention and Avoid Double Risk as hard filters before
 * returning any candidate move.
 */
export function runBehaviorTree(
    state: GameState,
    config: BehaviorConfig[] = DEFAULT_BEHAVIOR_CONFIG
): CandidateMove | null {
    const size = state.boardSize;
    const sorted = [...config].sort((a, b) => b.priority - a.priority);

    for (const behavior of sorted) {
        // Chance gate
        if (Math.random() > behavior.triggerChance) continue;

        const candidate = behavior.generate(state);
        if (!candidate) continue;

        // Basic legality: target cell must be empty
        if (state.board[candidate.r]?.[candidate.c]?.type !== 'empty') continue;

        // B15 – Avoid Double Risk: skip if this weakens resistance AND creates aggression vulnerability
        if (
            weakensResistance(candidate, state.board, size) &&
            createsAggressionVulnerability(candidate, state.board, size)
        ) continue;

        // B17 – Negation Prevention: skip if this restores a recent board state
        if (isNegationMove(candidate, state)) continue;

        console.log(`[BT] Executing behavior: "${behavior.name}" → (${candidate.r},${candidate.c}) effect=${candidate.effect}`);
        return candidate;
    }

    return null;
}
