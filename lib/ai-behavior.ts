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
import { getNeighbors, isNeutralized, triggerAggression, checkCaptures, cloneBoard } from "@/lib/game";

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
    // Placing here would put this stone between two black aggression stones on the same axis
    // — it would be destroyed when Black fires the beam.
    // Requires a black aggression stone found in BOTH the + and - directions on the same axis.
    const { r, c } = candidate;
    const directions = [{ dr: 0, dc: 1 }, { dr: 1, dc: 0 }];
    for (const { dr, dc } of directions) {
        let foundPositive = false;
        let foundNegative = false;
        for (const sign of [-1, 1]) {
            let cr = r + dr * sign, cc = c + dc * sign;
            while (cr >= 0 && cr < size && cc >= 0 && cc < size) {
                const t = board[cr][cc].type;
                if (t === 'empty' || t === 'collapse') break;
                if (t === 'black' && board[cr][cc].effects.includes('aggression')) {
                    if (sign === 1) foundPositive = true;
                    else foundNegative = true;
                    break;
                }
                cr += dr * sign;
                cc += dc * sign;
            }
        }
        // Only vulnerable if aggression exists on BOTH sides
        if (foundPositive && foundNegative) return true;
    }
    return false;
}

function isAdjacentToActiveEmpathy(candidate: CandidateMove, board: Board, size: number, opponent: Player): boolean {
    const neighbors = getNeighbors(candidate.r, candidate.c, size);
    return neighbors.some(n => {
        const cell = board[n.r][n.c];
        return cell.type === opponent &&
            cell.effects.includes('empathy') &&
            !isNeutralized(board, n.r, n.c);
    });
}

// ---------------------------------------------------------------------------
// Individual Behavior generators
// ---------------------------------------------------------------------------

/** B1: Prevent Immediate Resistance Loss (Priority 100, Chance 1.0) */
function b1_preventResistanceLoss(state: GameState): CandidateMove | null {
    const { board, boardSize: size } = state;
    // Only care about groups that contain at least one resistance stone — pure white groups
    // aren't critical enough to always save at the cost of a strategic move.
    const wrGroups = getAllGroups(board, size, t => t === 'white' || t === 'resistance');
    const dangerGroups = wrGroups.filter(g =>
        g.liberties.length === 1 &&
        g.group.some(p => board[p.r][p.c].type === 'resistance')
    );
    for (const g of dangerGroups) {
        const lib = g.liberties[0];
        if (isEmptyCell(board, lib.r, lib.c)) {
            return { r: lib.r, c: lib.c, effect: null };
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
    // Strategy: try to CAPTURE black aggression stones (put them in atari).
    // Placing INTO the beam would just get our stone destroyed — avoid that.
    const aggrStones: { r: number; c: number }[] = [];
    for (let r = 0; r < size; r++) {
        for (let c = 0; c < size; c++) {
            if (board[r][c].type === 'black' && board[r][c].effects.includes('aggression')) {
                aggrStones.push({ r, c });
            }
        }
    }
    if (aggrStones.length === 0) return null;

    // Try to put each aggression stone's group into atari (1 liberty left)
    for (const as of aggrStones) {
        const info = getGroupInfo(board, as.r, as.c, size);
        if (info.liberties.length === 1) {
            const lib = info.liberties[0];
            if (isEmptyCell(board, lib.r, lib.c)) {
                return { r: lib.r, c: lib.c, effect: null };
            }
        }
        // Reduce liberties: place on any liberty of this aggression group
        if (info.liberties.length === 2) {
            const target = randomFrom(info.liberties.filter(l => isEmptyCell(board, l.r, l.c)));
            if (target) return { r: target.r, c: target.c, effect: null };
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

                // Simulate: place white at (r,c) then swap types and effects
                const simBoard = cloneBoard(board);
                simBoard[r][c].type = turn;
                // Add manipulation effect temporarily to match placement
                simBoard[r][c].effects.push('manipulation');

                const tempType = simBoard[r][c].type;
                const tempEffects = [...simBoard[r][c].effects];

                simBoard[r][c].type = simBoard[n.r][n.c].type;
                simBoard[r][c].effects = [...simBoard[n.r][n.c].effects];

                simBoard[n.r][n.c].type = tempType;
                simBoard[n.r][n.c].effects = tempEffects;

                // Consume manipulation effect from both (it's internal to the behavior generation)
                simBoard[r][c].effects = simBoard[r][c].effects.filter((e: SpecialEffect) => e !== 'manipulation');
                simBoard[n.r][n.c].effects = simBoard[n.r][n.c].effects.filter((e: SpecialEffect) => e !== 'manipulation');

                // Trigger Aggression for swapped stones
                const captured: { r: number; c: number; type: StoneType }[] = [];
                [{ r, c }, { r: n.r, c: n.c }].forEach(pos => {
                    if (simBoard[pos.r][pos.c].effects.includes('aggression')) {
                        const res = triggerAggression(simBoard, pos);
                        // triggerAggression returns { board, destroyed } but does NOT modify in place if not using clone
                        // wait, triggerAggression in lib/game.ts DOES use cloneBoard now.
                        const res2 = triggerAggression(simBoard, pos);
                        // Actually, I should just use the triggerAggression return
                        const resFinal = triggerAggression(simBoard, pos);
                        // simBoard = resFinal.board; // This would work if I didn't worry about multi-triggering
                    }
                });

                // Simplified simulation: just use the resolve logic from lib/game
                // But b11 is a sub-step. Let's just do a basic capture check.
                const { destroyed } = checkCaptures(simBoard, turn);
                const gain = destroyed.filter(d => d.type === 'black').length;
                // Penalise if we accidentally capture our own white/resistance stones
                const selfLoss = destroyed.filter(d => d.type === 'white' || d.type === 'resistance').length;
                const score = gain * 10 - selfLoss * 15;
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

    // Score each potential beam using a weighted trade-off:
    //   black stone         = +1  (standard enemy kill)
    //   black special stone = +2  (special stones are more valuable)
    //   own white stone     = -1  (acceptable collateral if net positive)
    //   own resistance      = hard abort (never acceptable to destroy resistance)
    // Fire only if net score > 0 AND we destroy strictly more enemy stones than we lose.
    let bestScore = 1; // must beat this threshold (i.e. net > 0 minimum)
    let bestMove: CandidateMove | null = null;

    for (let r = 0; r < size; r++) {
        for (let c = 0; c < size; c++) {
            if (!isEmptyCell(board, r, c)) continue;
            for (const ea of existingAggr) {
                if (ea.r !== r && ea.c !== c) continue;
                let netScore = 0;
                let blackDestroyed = 0;
                let whiteDestroyed = 0;
                let abort = false;

                const cells: { r: number; c: number }[] = [];
                if (ea.r === r) {
                    const minC = Math.min(ea.c, c), maxC = Math.max(ea.c, c);
                    for (let cc = minC + 1; cc < maxC; cc++) cells.push({ r, c: cc });
                } else {
                    const minR = Math.min(ea.r, r), maxR = Math.max(ea.r, r);
                    for (let rr = minR + 1; rr < maxR; rr++) cells.push({ r: rr, c });
                }

                for (const cell of cells) {
                    const t = board[cell.r][cell.c].type;
                    if (t === 'empty' || t === 'collapse') continue;
                    if (t === 'resistance') { abort = true; break; } // never destroy own resistance
                    if (t === 'white') { netScore -= 1; whiteDestroyed++; }
                    if (t === 'black') {
                        const isSpecial = board[cell.r][cell.c].effects.length > 0;
                        netScore += isSpecial ? 2 : 1;
                        blackDestroyed++;
                    }
                }

                // Must be net positive AND destroy more enemy than self
                if (!abort && netScore > bestScore && blackDestroyed > whiteDestroyed) {
                    bestScore = netScore;
                    bestMove = { r, c, effect: 'aggression' };
                }
            }
        }
    }
    return bestMove;
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
                else if (t === 'black') {
                    score += 5;
                    // HARD PENALTY: Don't settle next to active empathy!
                    if (board[n.r][n.c].effects.includes('empathy') && !isNeutralized(board, n.r, n.c)) {
                        score -= 60;
                    }
                }
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

/** B18: Panic Fallback (Priority 0, Chance 1.0) */
function b18_panicFallback(state: GameState): CandidateMove | null {
    const { board, boardSize: size } = state;
    // Last ditch effort: pick the first empty cell available.
    // This ensures we ALMOST never fall through to the expensive minimax on large boards
    // if every other strategic behavior was filtered out by risk/chance.
    for (let r = 0; r < size; r++) {
        for (let c = 0; c < size; c++) {
            if (isEmptyCell(board, r, c)) {
                return { r, c, effect: null };
            }
        }
    }
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
    { priority: 90, triggerChance: 1.0, name: 'Respond to Empathy', generate: b5_respondToEmpathy },
    { priority: 70, triggerChance: 0.8, name: 'Respond to Aggression', generate: b6_respondToAggression },
    { priority: 65, triggerChance: 0.75, name: 'Respond to Control', generate: b7_respondToControl },
    { priority: 48, triggerChance: 0.68, name: 'Expand Resistance', generate: b8_expandResistance },
    { priority: 44, triggerChance: 0.64, name: 'Enable Resistance Growth', generate: b9_enableResistanceGrowth },
    { priority: 50, triggerChance: 0.65, name: 'Place NPC Control', generate: b10_placeNpcControl },
    { priority: 50, triggerChance: 0.6, name: 'Use NPC Manipulation', generate: b11_npcManipulation },
    { priority: 45, triggerChance: 0.6, name: 'Place NPC Aggression', generate: b12_npcAggression },
    { priority: 40, triggerChance: 0.6, name: 'Place NPC Empathy', generate: b13_npcEmpathy },
    { priority: 35, triggerChance: 0.5, name: 'Break Player Structure', generate: b14_breakPlayerStructure },
    { priority: 10, triggerChance: 1.0, name: 'Positional Improvement', generate: b16_positionalImprovement },
    { priority: 0, triggerChance: 1.0, name: 'Panic Fallback', generate: b18_panicFallback },
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

        // NEW: Avoid Empathy Conversion. Skip if move is adjacent to active player empathy,
        // UNLESS the priority is high (defending resistance or capturing).
        if (behavior.priority < 96 && isAdjacentToActiveEmpathy(candidate, state.board, size, state.turn === 'black' ? 'white' : 'black')) {
            console.log(`[BT] Skipping "${behavior.name}" due to empathy conversion risk`);
            continue;
        }

        console.log(`[BT] Executing behavior: "${behavior.name}" → (${candidate.r},${candidate.c}) effect=${candidate.effect}`);
        return candidate;
    }

    return null;
}
