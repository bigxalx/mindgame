"use client";

import { useEffect, useMemo, useState } from "react";
import { GameState, Player, SpecialEffect, Cell, Board, Inventory } from "@/types/game";
import { cn } from "@/lib/utils";
import { motion, AnimatePresence } from "framer-motion";
import { Shield, Zap, Heart, Target, Loader2, Sparkles, HelpCircle, X, Swords } from "lucide-react";
import { getAIDecision, getNeighbors, isNeutralized } from "@/lib/game";
import { toast } from "sonner";

interface Props {
    state: GameState;
    role: Player | 'spectator' | null;
    onMove: (r: number, c: number, effect: SpecialEffect | null) => void;
    onUndo: () => void;
    onConfirm: () => void;
    onSwap: (r1: number, c1: number, r2: number, c2: number) => void;
    onActionTypeChange: (type: 'move' | 'swap') => void;
    onRestart: () => void;
}

// Helper to check influence for dots
function isCellUnderInfluence(board: Board, r: number, c: number, effect: string, preview?: { r: number, c: number, effect: SpecialEffect | null }): boolean {
    const size = board.length;
    const neighbors = getNeighbors(r, c, size);

    // 1. Check existing stones on board
    // Only source stones that are NOT neutralized provide influence
    const hasExisting = neighbors.some(n => {
        const neighbor = board[n.r][n.c];
        return neighbor.effects.includes(effect as any) && !isNeutralized(board, n.r, n.c);
    });
    if (hasExisting) return true;

    // 2. Check preview placement (if any)
    if (preview && preview.effect === effect) {
        // Previewed stone is not neutralized yet (as it's just a preview)
        const dist = Math.abs(r - preview.r) + Math.abs(c - preview.c);
        if (dist === 1) return true;
    }

    return false;
}

export function GameBoard({ state, role, onMove, onUndo, onConfirm, onSwap, onActionTypeChange, onRestart }: Props) {
    const [selectedEffect, setSelectedEffect] = useState<SpecialEffect | null>(null);
    const [hovering, setHovering] = useState<{ r: number; c: number } | null>(null);
    const [isProcessing, setIsProcessing] = useState(false);
    const [swapSelection, setSwapSelection] = useState<{ r: number; c: number } | null>(null);
    const [aiPlannedSwap, setAiPlannedSwap] = useState<{ r1: number; c1: number; r2: number; c2: number } | null>(null);
    const [showHelp, setShowHelp] = useState(false);
    const [helpTab, setHelpTab] = useState<'goal' | 'empathy' | 'control' | 'aggression' | 'manipulation'>('goal');

    // Stable filament positions — computed once to avoid hydration mismatch
    const filamentStyles = useMemo(() =>
        Array.from({ length: 12 }, () => ({
            top: `${Math.random() * 100}%`,
            left: '-20%',
            width: '140%',
            transform: `rotate(${Math.random() * 360}deg)`,
            filter: 'blur(1px)',
        })),
        []);

    const canMove = state.turn === role && !state.gameOver && !isProcessing;
    const isSwapMode = state.pendingSwap !== undefined;

    const handleClick = async (r: number, c: number) => {
        if (!canMove) return;

        if (isSwapMode) {
            const swapOrigin = state.pendingSwap!;

            if (!swapSelection) {
                // First click: must be the Manipulation stone itself OR an adjacent stone
                const distFromOrigin = Math.abs(r - swapOrigin.r) + Math.abs(c - swapOrigin.c);
                if (distFromOrigin > 1) {
                    toast.error("Can only select stones adjacent to the Manipulation stone");
                    return;
                }
                const targetCell = state.board[r][c];
                if (targetCell.type === 'empty' || targetCell.type === 'collapse') {
                    toast.error("Manipulation target must contain a stone");
                    return;
                }
                setSwapSelection({ r, c });
            } else {
                // Second click: must ALSO be adjacent to the Manipulation origin (not the first selection)
                const distFromOrigin = Math.abs(r - swapOrigin.r) + Math.abs(c - swapOrigin.c);
                if (distFromOrigin > 1) {
                    toast.error("Both stones must be adjacent to the Manipulation stone");
                    return;
                }
                if (r === swapSelection.r && c === swapSelection.c) {
                    // Deselect
                    setSwapSelection(null);
                    return;
                }
                const targetCell = state.board[r][c];
                if (targetCell.type === 'empty' || targetCell.type === 'collapse') {
                    toast.error("Swap target must contain a stone");
                    return;
                }
                setIsProcessing(true);
                await onSwap(swapSelection.r, swapSelection.c, r, c);
                setSwapSelection(null);
                setIsProcessing(false);
            }
            return;
        }

        if (state.board[r][c].type !== 'empty') return;

        setIsProcessing(true);
        await onMove(r, c, selectedEffect);
        setSelectedEffect(null);
        setIsProcessing(false);
    };

    // AI Turn Lifecycle
    useEffect(() => {
        // AI ACTS IF: It's an AI game AND it is White's turn AND game isn't over AND not already processing
        const needsToAct = (state.isAiGame) && state.turn === 'white';

        if (!needsToAct || state.gameOver || isProcessing) return;

        const timer = setTimeout(async () => {
            try {
                // Phase 1: Place a stone
                if (!state.moveConfirmed) {
                    setIsProcessing(true);
                    console.log("AI Phase 1: Planning move...");
                    await new Promise(r => setTimeout(r, 800)); // Decision delay

                    const aiDecision = getAIDecision(state, state.difficulty || 'medium');
                    if (aiDecision) {
                        console.log("AI Phase 1: Placing stone at", aiDecision);
                        if (aiDecision.swap) {
                            console.log("AI Phase 1: Planning swap for later:", aiDecision.swap);
                            setAiPlannedSwap(aiDecision.swap);
                        }
                        await onMove(aiDecision.r, aiDecision.c, aiDecision.effect);
                    } else {
                        console.log("AI Phase 1: No valid moves, ending turn.");
                        onConfirm();
                    }
                    setIsProcessing(false);
                    return;
                }

                // Phase 2: Handle pending swap (Manipulation)
                if (state.pendingSwap) {
                    setIsProcessing(true);
                    console.log("AI Phase 2: Handling swap at", state.pendingSwap);
                    await new Promise(r => setTimeout(r, 600)); // Swap delay
                    const { r, c } = state.pendingSwap;

                    let targetR, targetC;
                    if (aiPlannedSwap && ((aiPlannedSwap.r1 === r && aiPlannedSwap.c1 === c) || (aiPlannedSwap.r2 === r && aiPlannedSwap.c2 === c))) {
                        // Use the strategically planned target
                        // Determine which endpoint of the planned swap is NOT the pendingSwap position
                        const useSecond = aiPlannedSwap.r1 === r && aiPlannedSwap.c1 === c;
                        targetR = useSecond ? aiPlannedSwap.r2 : aiPlannedSwap.r1;
                        targetC = useSecond ? aiPlannedSwap.c2 : aiPlannedSwap.c1;
                        console.log("AI Phase 2: Executing STRATEGIC swap with", targetR, targetC);
                    } else {
                        // Fallback to random if no plan matches
                        const neighbors = getNeighbors(r, c, state.boardSize);
                        const target = neighbors[Math.floor(Math.random() * neighbors.length)];
                        targetR = target.r;
                        targetC = target.c;
                        console.log("AI Phase 2: Executing RANDOM fallback swap with", targetR, targetC);
                    }

                    await onSwap(r, c, targetR, targetC);
                    setAiPlannedSwap(null);
                    setIsProcessing(false);
                    return;
                }

                // Phase 3: Commit Turn
                if (state.moveConfirmed && !state.pendingSwap) {
                    setIsProcessing(true);
                    console.log("AI Phase 3: Committing turn...");
                    await new Promise(r => setTimeout(r, 500)); // Finish delay
                    onConfirm(); // Changed from onEndTurn to onConfirm
                    setIsProcessing(false);
                }
            } catch (error) {
                console.error("AI Turn Lifecycle Error:", error);
                setIsProcessing(false);
            }
        }, 600);

        return () => clearTimeout(timer);
    }, [state.turn, state.isAiGame, state.gameOver, isProcessing, state.difficulty, state.moveConfirmed, state.pendingSwap, onMove, onSwap, onConfirm]);

    const effectsList: { id: SpecialEffect; icon: any; color: string; glow: string; label: string; desc: string }[] = [
        { id: 'empathy', icon: Heart, color: 'text-green-400', glow: 'shadow-[0_0_15px_rgba(74,222,128,0.5)]', label: 'Empathy', desc: 'Converts adjacent neutral stones at turn start.' },
        { id: 'control', icon: Shield, color: 'text-blue-400', glow: 'shadow-[0_0_15px_rgba(96,165,250,0.5)]', label: 'Control', desc: 'Blocks all spreading (Resistance & Empathy).' },
        { id: 'aggression', icon: Target, color: 'text-red-400', glow: 'shadow-[0_0_15px_rgba(248,113,113,0.5)]', label: 'Aggression', desc: 'Place two in line to destroy stones between.' },
        { id: 'manipulation', icon: Zap, color: 'text-purple-400', glow: 'shadow-[0_0_15px_rgba(192,132,252,0.5)]', label: 'Manipulation', desc: 'Swap adjacent stones upon placement.' },
    ];

    const currentInventory = (role && role !== 'spectator')
        ? state.inventory[role as Player]
        : { empathy: 0, control: 0, aggression: 0, manipulation: 0 } as Inventory;

    const getAffectedCells = (r: number, c: number, effect: SpecialEffect | null) => {
        if (!effect) return [];
        const size = state.boardSize;
        const neighbors = getNeighbors(r, c, size);

        if (effect === 'empathy' || effect === 'control' || effect === 'manipulation') {
            return neighbors.filter(n => state.board[n.r][n.c].type !== 'empty');
        }

        if (effect === 'aggression') {
            const affected: { r: number; c: number }[] = [];
            const directions = [{ dr: 0, dc: 1 }, { dr: 1, dc: 0 }, { dr: 0, dc: -1 }, { dr: -1, dc: 0 }];
            directions.forEach(({ dr, dc }) => {
                let currR = r + dr;
                let currC = c + dc;
                const path = [];
                while (currR >= 0 && currR < size && currC >= 0 && currC < size) {
                    const t = state.board[currR][currC].type;
                    if (t === 'empty' || t === 'collapse') break;
                    if (state.board[currR][currC].effects.includes('aggression')) {
                        affected.push(...path);
                        break;
                    }
                    path.push({ r: currR, c: currC });
                    currR += dr;
                    currC += dc;
                }
            });
            return affected;
        }
        return [];
    };

    const affectedCells = hovering ? getAffectedCells(hovering.r, hovering.c, selectedEffect) : [];
    const effectColor = selectedEffect ? effectsList.find(e => e.id === selectedEffect)?.color.replace('text-', 'bg-') : 'bg-blue-500';

    return (
        <div className="flex flex-col items-center space-y-8 w-full">
            {/* Special Stones Selector */}
            <div className="w-full max-w-md space-y-3">
                <div className="flex justify-between items-center mb-1 px-1">
                    <p className="text-xs uppercase tracking-widest text-slate-500 font-bold">Stones</p>
                    <div className="flex items-center gap-2">
                        <p className="text-[10px] text-slate-400 font-medium">Player: <span className="uppercase text-slate-200">{role || state.turn}</span></p>
                        <button
                            onClick={() => { setShowHelp(true); setHelpTab('goal'); }}
                            className="text-slate-500 hover:text-slate-300 transition-colors"
                            title="Rules & Help"
                        >
                            <HelpCircle className="w-4 h-4" />
                        </button>
                    </div>
                </div>
                <div className="grid grid-cols-4 gap-2">
                    {effectsList.map((eff) => {
                        const count = currentInventory[eff.id] || 0;
                        const isAvailable = count > 0;
                        return (
                            <button
                                key={eff.id}
                                onClick={() => setSelectedEffect(selectedEffect === eff.id ? null : eff.id)}
                                disabled={!canMove || !isAvailable}
                                className={cn(
                                    "relative flex flex-col items-center justify-center p-2 pt-3 rounded-xl border transition-all duration-200",
                                    selectedEffect === eff.id
                                        ? "bg-slate-800 border-slate-600 ring-2 ring-blue-500/50 translate-y-[-2px]"
                                        : "bg-slate-900 border-slate-800 hover:bg-slate-800 disabled:opacity-30"
                                )}
                            >
                                <span className="absolute top-1 right-2 text-[9px] font-black text-slate-500">{count}x</span>
                                <eff.icon className={cn("w-5 h-5 mb-1", eff.color)} />
                                <span className="text-[10px] font-medium text-slate-400">{eff.label}</span>
                            </button>
                        );
                    })}
                </div>

                {/* Effect Description */}
                <AnimatePresence mode="wait">
                    {selectedEffect && (
                        <motion.div
                            initial={{ opacity: 0, y: 5 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -5 }}
                            className="bg-slate-900/40 p-3 rounded-lg border border-slate-800 text-center"
                        >
                            <p className="text-xs text-slate-300 italic">
                                {effectsList.find(e => e.id === selectedEffect)?.desc}
                            </p>
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>

            {/* Turn Limit Countdown (AI games only) */}
            {state.turnLimit !== undefined && !state.gameOver && (
                (() => {
                    const blackTurnsDone = Math.ceil(state.turnCount / 2); // full black turns done so far
                    const remaining = state.turnLimit - blackTurnsDone;
                    const urgency = remaining <= 3 ? 'red' : remaining <= 6 ? 'amber' : 'blue';
                    const pct = Math.max(0, remaining / state.turnLimit) * 100;
                    return (
                        <div className="w-full max-w-md space-y-1">
                            <div className="flex justify-between items-center px-1">
                                <p className="text-xs uppercase tracking-widest text-slate-500 font-bold">Turns Remaining</p>
                                <p className={cn(
                                    "text-sm font-black tabular-nums",
                                    urgency === 'red' && "text-red-400 animate-pulse",
                                    urgency === 'amber' && "text-amber-400",
                                    urgency === 'blue' && "text-slate-300",
                                )}>{remaining} / {state.turnLimit}</p>
                            </div>
                            <div className="w-full h-1.5 rounded-full bg-slate-800 overflow-hidden">
                                <div
                                    className={cn(
                                        "h-full rounded-full transition-all duration-700",
                                        urgency === 'red' && "bg-red-500",
                                        urgency === 'amber' && "bg-amber-400",
                                        urgency === 'blue' && "bg-blue-500",
                                    )}
                                    style={{ width: `${pct}%` }}
                                />
                            </div>
                        </div>
                    );
                })()
            )}

            {/* Board Wrapper (Hypnotic Neural Synapse Background) */}
            <div
                className="relative rounded-[2.5rem] shadow-[0_0_80px_rgba(0,0,0,0.8)] overflow-hidden group border border-white/5"
                style={{
                    width: 'min(95vw, 750px)',
                    height: 'min(95vw, 750px)',
                    padding: '8%',
                    backgroundColor: '#020205',
                }}
            >
                {/* 1. Base Image - Subtile, Deep Space */}
                <div
                    className="absolute inset-0 z-0 opacity-100 bg-center bg-no-repeat bg-cover"
                    style={{ backgroundImage: 'url(/synapse_bg.png)' }}
                />

                {/* 2. Radiant Synapse Hubs (Dynamic Glowing Highlights) */}
                <div className="absolute inset-0 z-[1] pointer-events-none overflow-hidden">
                    {[
                        { t: '15%', l: '15%', c: 'rgba(56,189,248,0.5)' }, // Cyan Top Left
                        { t: '15%', l: '85%', c: 'rgba(56,189,248,0.5)' }, // Cyan Top Right
                        { t: '85%', l: '15%', c: 'rgba(56,189,248,0.5)' }, // Cyan Bottom Left
                        { t: '85%', l: '85%', c: 'rgba(168,85,247,0.5)' }, // Purple Bottom Right
                        { t: '50%', l: '10%', c: 'rgba(251,146,60,0.5)' }, // Orange Left
                        { t: '50%', l: '90%', c: 'rgba(251,146,60,0.5)' }, // Orange Right
                    ].map((hub, i) => (
                        <motion.div
                            key={`hub-${i}`}
                            animate={{ opacity: [0.4, 0.9, 0.4], scale: [0.8, 1.2, 0.8] }}
                            transition={{ duration: 4 + i, repeat: Infinity, ease: "easeInOut" }}
                            className="absolute w-40 h-40 rounded-full blur-[40px]"
                            style={{ top: hub.t, left: hub.l, background: hub.c, transform: 'translate(-50%, -50%)' }}
                        />
                    ))}
                </div>

                {/* 3. Cinematic Cosmic Fog (The Brain Fog) - High Contrast */}
                <motion.div
                    animate={{ scale: [1, 1.2, 1], opacity: [0.2, 0.6, 0.2] }}
                    transition={{ duration: 25, repeat: Infinity, ease: "easeInOut" }}
                    className="absolute inset-[-50%] bg-[radial-gradient(circle_at_30%_30%,rgba(139,92,246,0.5)_0%,transparent_60%)] blur-[100px] z-[2] mix-blend-screen"
                />
                <motion.div
                    animate={{ scale: [1.2, 1, 1.2], opacity: [0.1, 0.5, 0.1] }}
                    transition={{ duration: 30, repeat: Infinity, ease: "easeInOut" }}
                    className="absolute inset-[-50%] bg-[radial-gradient(circle_at_70%_70%,rgba(79,70,229,0.4)_0%,transparent_60%)] blur-[120px] z-[3] mix-blend-screen"
                />

                {/* 4. Neural Filaments (Energy Lines) - stable positions via useMemo */}
                <div className="absolute inset-0 z-[4] pointer-events-none overflow-hidden opacity-40">
                    {filamentStyles.map((style, i) => (
                        <motion.div
                            key={`synapse-${i}`}
                            animate={{ opacity: [0.1, 0.6, 0.1], scale: [0.95, 1.05, 0.95] }}
                            transition={{ duration: 10 + i * 2, repeat: Infinity }}
                            className="absolute bg-gradient-to-r from-transparent via-white/20 to-transparent h-[1px]"
                            style={style}
                        />
                    ))}
                </div>

                {/* 5. Vignette / Depth */}
                <div className="absolute inset-0 bg-[radial-gradient(circle,transparent_30%,rgba(0,0,0,0.85)_100%)] z-[5] pointer-events-none" />

                {/* The Interactive Board (Centered Grid) */}
                <div className="relative w-full h-full z-10">

                    {/* Glow Effects Layer */}
                    <AnimatePresence>
                        {hovering && state.board[hovering.r][hovering.c].type === 'empty' && (
                            <motion.div
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                exit={{ opacity: 0 }}
                                className="absolute inset-0 pointer-events-none z-0"
                                style={{
                                    background: `radial-gradient(circle at ${((hovering.c + 0.5) / state.boardSize) * 100}% ${((hovering.r + 0.5) / state.boardSize) * 100}%, rgba(139, 92, 246, 0.12) 0%, transparent 25%)`
                                }}
                            />
                        )}
                        {/* Action Preview Glows */}
                        {affectedCells.map((cell, idx) => (
                            <motion.div
                                key={`affected-${idx}`}
                                initial={{ opacity: 0, scale: 0.5 }}
                                animate={{ opacity: 0.6, scale: 1 }}
                                exit={{ opacity: 0, scale: 0.5 }}
                                className={cn("absolute pointer-events-none rounded-full blur-2xl z-0", effectColor || "bg-blue-400")}
                                style={{
                                    width: `${100 / state.boardSize}%`,
                                    height: `${100 / state.boardSize}%`,
                                    left: `${(cell.c / state.boardSize) * 100}%`,
                                    top: `${(cell.r / state.boardSize) * 100}%`,
                                    transform: 'scale(1.5)', // Larger glow for preview
                                }}
                            />
                        ))}
                    </AnimatePresence>

                    {/* The Grid */}
                    <div
                        className="grid h-full w-full shadow-2xl"
                        style={{
                            gridTemplateColumns: `repeat(${state.boardSize}, 1fr)`,
                            gridTemplateRows: `repeat(${state.boardSize}, 1fr)`,
                        }}
                    >
                        {state.board.map((row: Cell[], r: number) =>
                            row.map((cell: Cell, c: number) => (
                                <div
                                    key={cell.id}
                                    className="relative flex items-center justify-center group touch-none"
                                    onClick={() => handleClick(r, c)}
                                    onMouseEnter={() => setHovering({ r, c })}
                                    onMouseLeave={() => setHovering(null)}
                                >
                                    {/* High-Glow Organic Filaments (Grid Lines) */}
                                    {cell.type !== 'collapse' && (
                                        <>
                                            <div className={cn(
                                                "absolute w-[2px] bg-white/20 transition-all duration-700 z-0",
                                                r === 0 ? "top-1/2 h-1/2" : r === state.boardSize - 1 ? "bottom-1/2 h-1/2" : "h-full",
                                            )}></div>
                                            <div className={cn(
                                                "absolute h-[2px] bg-white/20 transition-all duration-700 z-0",
                                                c === 0 ? "left-1/2 w-1/2" : c === state.boardSize - 1 ? "right-1/2 w-1/2" : "w-full",
                                            )}></div>

                                            {/* Synapse Nodes (Organic Glowing Intersections) */}
                                            <div className="absolute w-2 h-2 rounded-full bg-white/5 blur-[2px] z-0" />
                                            <motion.div
                                                animate={{ opacity: [0.2, 0.5, 0.2], scale: [0.8, 1.2, 0.8] }}
                                                transition={{ duration: 3, repeat: Infinity, delay: (r + c) * 0.2 }}
                                                className="absolute w-1 h-1 rounded-full bg-[#fce7d5]/40 blur-[0.5px] z-0"
                                            />
                                        </>
                                    )}

                                    {/* Collapse Void Effect */}
                                    {cell.type === 'collapse' && (
                                        <div className="absolute inset-0 z-0 flex items-center justify-center pointer-events-none">
                                            <motion.div
                                                animate={{ scale: [1, 1.1, 1], opacity: [0.7, 1, 0.7] }}
                                                transition={{ duration: 4, repeat: Infinity }}
                                                className="w-12 h-12 bg-[radial-gradient(circle,rgba(0,0,0,1)_0%,rgba(20,20,30,0.8)_40%,transparent_70%)] rounded-full blur-sm"
                                            />
                                            <div className="w-4 h-4 bg-black rounded-full shadow-[0_0_15px_rgba(0,0,0,1)]" />
                                        </div>
                                    )}

                                    {/* Aftershock Pulse - High Voltage */}
                                    {cell.aftershock && (state.turnCount - cell.aftershock.turnCreated < 2) && (
                                        <div className="absolute inset-0 z-20 flex items-center justify-center pointer-events-none">
                                            <motion.div
                                                // Electric flicker effect
                                                animate={{
                                                    scale: [1, 1.2, 0.9, 1.1, 1],
                                                    opacity: [0.6, 0.9, 0.5, 0.8, 0.6]
                                                }}
                                                transition={{
                                                    duration: 0.2,
                                                    repeat: Infinity,
                                                    repeatType: "reverse"
                                                }}
                                                className={cn(
                                                    "w-8 h-8 rounded-full blur-[4px] mix-blend-screen",
                                                    cell.aftershock.type === 'black'
                                                        ? "bg-cyan-500 shadow-[0_0_15px_rgba(6,182,212,0.8)]"
                                                        : "bg-amber-300 shadow-[0_0_15px_rgba(252,211,77,0.8)]"
                                                )}
                                            />
                                            <div className={cn(
                                                "w-3 h-3 rounded-full border-2",
                                                cell.aftershock.type === 'black'
                                                    ? "bg-black border-cyan-400"
                                                    : "bg-white border-amber-400"
                                            )} />
                                        </div>
                                    )}

                                    {/* Cognitive Influence Markers (Centered Dots) */}
                                    <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-40">
                                        <div className="flex gap-2">
                                            {/* Empathy Influence (Green) */}
                                            {/* Show on grid ONLY during placement; show on stones ONLY if neutral */}
                                            {isCellUnderInfluence(state.board, r, c, 'empathy', (hovering && canMove) ? { ...hovering, effect: selectedEffect } : undefined) && (
                                                ((cell.type === 'empty' && hovering && canMove) ||
                                                    (cell.type !== 'empty' && cell.effects.length === 0 && cell.type !== 'resistance')) && (
                                                    <motion.div
                                                        animate={{ scale: [1, 1.4, 1], opacity: [0.8, 1, 0.8] }}
                                                        transition={{ duration: 1.2, repeat: Infinity, ease: "easeInOut" }}
                                                        className="w-3 h-3 rounded-full bg-emerald-400 shadow-[0_0_12px_rgba(52,211,153,1)] border border-white/20"
                                                    />
                                                )
                                            )}
                                            {/* Control Influence (Blue) */}
                                            {isCellUnderInfluence(state.board, r, c, 'control', (hovering && canMove) ? { ...hovering, effect: selectedEffect } : undefined) && (
                                                ((cell.type === 'empty' && hovering && canMove) || cell.type !== 'empty') && (
                                                    <motion.div
                                                        animate={{ scale: [1, 1.4, 1], opacity: [0.8, 1, 0.8] }}
                                                        transition={{ duration: 1.2, repeat: Infinity, delay: 0.3, ease: "easeInOut" }}
                                                        className="w-3 h-3 rounded-full bg-blue-400 shadow-[0_0_12px_rgba(96,165,250,1)] border border-white/20"
                                                    />
                                                )
                                            )}
                                        </div>
                                    </div>

                                    {/* Occult Stone (The Soul & Aura System) */}
                                    <AnimatePresence mode="popLayout">
                                        {cell.type !== 'empty' && (
                                            <motion.div
                                                layoutId={cell.id}
                                                initial={{ scale: 0, opacity: 0 }}
                                                animate={{ scale: 1, opacity: 1 }}
                                                exit={{ scale: 0, opacity: 0 }}
                                                className={cn(
                                                    "w-[62%] h-[62%] rounded-full z-10 shadow-2xl relative transition-all duration-500",
                                                    "border border-white/10 backdrop-blur-md overflow-hidden",
                                                    cell.type === 'black' && "bg-black",
                                                    cell.type === 'white' && "bg-white",
                                                    cell.type === 'resistance' && "bg-yellow-400 border-none shadow-[0_0_20px_rgba(250,204,21,0.4)]",
                                                    // Interior Aura Rings (50% Mass) - Updated for Neutralization
                                                    cell.effects.includes('empathy') && (
                                                        isNeutralized(state.board, r, c)
                                                            ? "ring-[10px] ring-inset ring-slate-500/20 grayscale opacity-40 blur-[1px]"
                                                            : "ring-[10px] ring-inset ring-emerald-500/40"
                                                    ),
                                                    cell.effects.includes('control') && (
                                                        isNeutralized(state.board, r, c)
                                                            ? "ring-[10px] ring-inset ring-slate-500/20 grayscale opacity-40 blur-[1px]"
                                                            : "ring-[10px] ring-inset ring-blue-500/40"
                                                    ),
                                                    cell.effects.includes('aggression') && (
                                                        isNeutralized(state.board, r, c)
                                                            ? "ring-[10px] ring-inset ring-slate-500/20 grayscale opacity-40 blur-[1px]"
                                                            : "ring-[10px] ring-inset ring-rose-500/40"
                                                    ),
                                                    cell.effects.includes('manipulation') && (
                                                        isNeutralized(state.board, r, c)
                                                            ? "ring-[10px] ring-inset ring-slate-500/20 grayscale opacity-40 blur-[1px]"
                                                            : "ring-[10px] ring-inset ring-purple-500/40"
                                                    ),
                                                    swapSelection?.r === r && swapSelection?.c === c && "ring-[4px] ring-white scale-110 shadow-[0_0_30px_rgba(255,255,255,0.8)]"
                                                )}
                                            >
                                                {/* Specialized Light Hearts */}
                                                <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-20">
                                                    {cell.type === 'black' ? (
                                                        <div className="w-1/2 h-1/2 rounded-full bg-gradient-to-br from-purple-500/40 via-indigo-600/20 to-transparent blur-[4px] animate-pulse" />
                                                    ) : cell.type === 'resistance' ? (
                                                        <div className="w-1/2 h-1/2 rounded-full bg-gradient-to-br from-white via-yellow-100/40 to-transparent blur-[4px] animate-pulse" />
                                                    ) : (
                                                        <div className="w-1/2 h-1/2 rounded-full bg-gradient-to-br from-white via-blue-100/40 to-transparent blur-[3px] animate-pulse" />
                                                    )}

                                                    {/* The Concentrated Light Spark */}
                                                    <div className={cn(
                                                        "w-1.5 h-1.5 rounded-full blur-[0.3px] shadow-[0_0_10px_rgba(255,255,255,0.8)]",
                                                        cell.type === 'black' ? "bg-purple-200" : "bg-white"
                                                    )} />
                                                </div>

                                                {/* Depth Insets */}
                                                <div className="absolute inset-0 rounded-full shadow-[inset_0_2px_10px_rgba(255,255,255,0.1),inset_0_-2px_10px_rgba(0,0,0,0.5)] z-10" />

                                                {/* Environmental Polished Sheen */}
                                                <div className="absolute inset-[-2px] bottom-1/2 rounded-t-full bg-gradient-to-b from-white/20 to-transparent pointer-events-none z-30" />
                                            </motion.div>
                                        )}
                                    </AnimatePresence>

                                    {/* Highlight valid swap targets */}
                                    {isSwapMode && !swapSelection && cell.type !== 'empty' && state.pendingSwap && Math.abs(r - state.pendingSwap.r) + Math.abs(c - state.pendingSwap.c) <= 1 && (
                                        <div className="absolute inset-0 bg-amber-400/10 animate-pulse z-0" />
                                    )}

                                    {/* Preview on hover */}
                                    {hovering?.r === r && hovering?.c === c && cell.type === 'empty' && canMove && (
                                        <div className={cn(
                                            "w-[65%] h-[65%] rounded-full border-2 border-dashed opacity-40 animate-pulse",
                                            state.turn === 'black' ? "border-slate-50" : "border-slate-400"
                                        )} />
                                    )}
                                </div>
                            ))
                        )}
                    </div>
                </div>
            </div>


            {/* Rules / Help Modal */}
            <AnimatePresence>
                {showHelp && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4"
                        onClick={() => setShowHelp(false)}
                    >
                        <motion.div
                            initial={{ scale: 0.92, y: 16 }}
                            animate={{ scale: 1, y: 0 }}
                            exit={{ scale: 0.92, y: 16 }}
                            onClick={e => e.stopPropagation()}
                            className="bg-slate-900 border border-slate-800 rounded-3xl shadow-2xl w-full max-w-sm overflow-hidden"
                        >
                            {/* Header */}
                            <div className="flex items-center justify-between px-6 pt-6 pb-3">
                                <h2 className="text-lg font-black tracking-tighter text-white uppercase italic">Rules</h2>
                                <button onClick={() => setShowHelp(false)} className="text-slate-500 hover:text-white transition-colors">
                                    <X className="w-5 h-5" />
                                </button>
                            </div>

                            {/* Tabs */}
                            <div className="flex gap-1 px-4 pb-2 overflow-x-auto">
                                {([
                                    { id: 'goal', label: 'Goal', icon: Swords, color: 'text-slate-300' },
                                    { id: 'empathy', label: 'Empathy', icon: Heart, color: 'text-green-400' },
                                    { id: 'control', label: 'Control', icon: Shield, color: 'text-blue-400' },
                                    { id: 'aggression', label: 'Aggression', icon: Target, color: 'text-red-400' },
                                    { id: 'manipulation', label: 'Manip.', icon: Zap, color: 'text-purple-400' },
                                ] as const).map(tab => (
                                    <button
                                        key={tab.id}
                                        onClick={() => setHelpTab(tab.id)}
                                        className={cn(
                                            "flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-bold whitespace-nowrap transition-all",
                                            helpTab === tab.id
                                                ? "bg-slate-800 text-white"
                                                : "text-slate-500 hover:text-slate-300"
                                        )}
                                    >
                                        <tab.icon className={cn("w-3 h-3", helpTab === tab.id ? tab.color : '')} />
                                        {tab.label}
                                    </button>
                                ))}
                            </div>

                            {/* Tab Content */}
                            <div className="px-6 pb-6 pt-2 min-h-[200px]">
                                <AnimatePresence mode="wait">
                                    {helpTab === 'goal' && (
                                        <motion.div key="goal" initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -8 }} className="space-y-3">
                                            <p className="text-xs font-bold uppercase tracking-widest text-slate-500">Objective</p>
                                            <p className="text-sm text-slate-200 leading-relaxed">
                                                You play as <span className="font-bold text-white">Black</span>. Your goal is to capture all
                                                {' '}<span className="font-bold text-yellow-400">Resistance stones</span> before the turn limit expires.
                                            </p>
                                            <p className="text-sm text-slate-200 leading-relaxed">
                                                Capture works like Go: surround an enemy group on all sides with no empty neighbours (no liberties) and it is destroyed.
                                            </p>
                                            <p className="text-sm text-slate-200 leading-relaxed">
                                                If the turn limit runs out and any Resistance stones remain, <span className="font-bold text-white">White wins</span>.
                                            </p>
                                            <div className="mt-3 p-3 rounded-xl bg-slate-800/60 border border-slate-700/50">
                                                <p className="text-[11px] text-slate-400">
                                                    <span className="font-bold text-amber-400">Aftershock</span> — when stones are captured, a pulsing residue remains for one round cycle. The losing team cannot immediately reclaim that cell.
                                                </p>
                                            </div>
                                            <div className="p-3 rounded-xl bg-slate-800/60 border border-slate-700/50">
                                                <p className="text-[11px] text-slate-400">
                                                    <span className="font-bold text-slate-200">Collapse</span> — if 4 or more stones are destroyed in a single event, the geometric centre of the destroyed group becomes a permanent void. Nothing can be placed there.
                                                </p>
                                            </div>
                                        </motion.div>
                                    )}
                                    {helpTab === 'empathy' && (
                                        <motion.div key="empathy" initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -8 }} className="space-y-3">
                                            <div className="flex items-center gap-2">
                                                <Heart className="w-5 h-5 text-green-400" />
                                                <p className="text-xs font-bold uppercase tracking-widest text-green-400">Empathy</p>
                                            </div>
                                            <p className="text-sm text-slate-200 leading-relaxed">
                                                At the <strong>start of its owner's turn</strong>, an Empathy stone converts all adjacent <em>neutral</em> (no-effect) opponent stones to its colour — and each converted stone also becomes an Empathy stone, spreading the effect virally.
                                            </p>
                                            <div className="p-3 rounded-xl bg-slate-800/60 border border-slate-700/50">
                                                <p className="text-[11px] text-slate-400">Growth is <span className="font-bold text-slate-300">blocked</span> if the Empathy stone is neutralised by an adjacent enemy Control stone.</p>
                                            </div>
                                        </motion.div>
                                    )}
                                    {helpTab === 'control' && (
                                        <motion.div key="control" initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -8 }} className="space-y-3">
                                            <div className="flex items-center gap-2">
                                                <Shield className="w-5 h-5 text-blue-400" />
                                                <p className="text-xs font-bold uppercase tracking-widest text-blue-400">Control</p>
                                            </div>
                                            <p className="text-sm text-slate-200 leading-relaxed">
                                                An active Control stone <strong>suppresses</strong> all adjacent opponent stones, blocking their special effects (Empathy growth, Resistance spread).
                                            </p>
                                            <p className="text-sm text-slate-200 leading-relaxed">
                                                Two opposing Control stones that are adjacent <strong>neutralise each other</strong> — both become inactive.
                                            </p>
                                            <div className="p-3 rounded-xl bg-slate-800/60 border border-slate-700/50">
                                                <p className="text-[11px] text-slate-400">A neutralised stone appears greyed-out and no longer exerts its effect.</p>
                                            </div>
                                        </motion.div>
                                    )}
                                    {helpTab === 'aggression' && (
                                        <motion.div key="aggression" initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -8 }} className="space-y-3">
                                            <div className="flex items-center gap-2">
                                                <Target className="w-5 h-5 text-red-400" />
                                                <p className="text-xs font-bold uppercase tracking-widest text-red-400">Aggression</p>
                                            </div>
                                            <p className="text-sm text-slate-200 leading-relaxed">
                                                Place two Aggression stones in the <strong>same row or column</strong> with no empty gaps between them. All stones between the two are immediately destroyed.
                                            </p>
                                            <p className="text-sm text-slate-200 leading-relaxed">
                                                The beam stops at empty cells or Collapse voids — it will not fire through gaps.
                                            </p>
                                            <div className="p-3 rounded-xl bg-slate-800/60 border border-slate-700/50">
                                                <p className="text-[11px] text-slate-400">The destroyed stones still trigger <span className="font-bold text-amber-400">Aftershock</span> and can cause a <span className="font-bold text-slate-200">Collapse</span> if 4+ are destroyed.</p>
                                            </div>
                                        </motion.div>
                                    )}
                                    {helpTab === 'manipulation' && (
                                        <motion.div key="manipulation" initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -8 }} className="space-y-3">
                                            <div className="flex items-center gap-2">
                                                <Zap className="w-5 h-5 text-purple-400" />
                                                <p className="text-xs font-bold uppercase tracking-widest text-purple-400">Manipulation</p>
                                            </div>
                                            <p className="text-sm text-slate-200 leading-relaxed">
                                                After placing a Manipulation stone, you choose <strong>two adjacent stones</strong> (both must be neighbours of the Manipulation stone) to swap positions.
                                            </p>
                                            <p className="text-sm text-slate-200 leading-relaxed">
                                                Only the <strong>stone types</strong> move — all special effects stay attached to their original cells. The Manipulation effect is consumed after use.
                                            </p>
                                            <div className="p-3 rounded-xl bg-slate-800/60 border border-slate-700/50">
                                                <p className="text-[11px] text-slate-400">Captures and spreading are re-evaluated after the swap.</p>
                                            </div>
                                        </motion.div>
                                    )}
                                </AnimatePresence>
                            </div>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Game Over Modal */}
            <AnimatePresence>
                {state.gameOver && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4"
                    >
                        <motion.div
                            initial={{ scale: 0.9, y: 20 }}
                            animate={{ scale: 1, y: 0 }}
                            className="bg-slate-900 p-8 rounded-3xl border border-slate-800 text-center shadow-2xl max-w-xs w-full"
                        >
                            <h2 className="text-3xl font-black mb-2 tracking-tighter italic">
                                {state.winner === 'black' ? 'BLACK WINS' : 'WHITE WINS'}
                            </h2>
                            <p className="text-slate-400 mb-6 font-medium">
                                {state.winner === 'black'
                                    ? 'All resistance stones captured.'
                                    : (() => {
                                        const blackTurnsDone = Math.ceil(state.turnCount / 2);
                                        const hitLimit = state.turnLimit !== undefined && blackTurnsDone >= state.turnLimit;
                                        return hitLimit
                                            ? `Turn limit reached. Resistance survived.`
                                            : 'The virus could not be contained.';
                                    })()
                                }
                            </p>
                            <button
                                onClick={() => window.location.reload()}
                                className="w-full bg-slate-50 text-slate-950 font-bold py-3 rounded-xl hover:bg-white transition-colors"
                            >
                                PLAY AGAIN
                            </button>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* AI Processing Indicator */}
            {isProcessing && state.turn === 'white' && (
                <div className="fixed bottom-8 left-1/2 -translate-x-1/2 flex items-center gap-2 bg-slate-900 px-4 py-2 rounded-full border border-slate-800 shadow-xl">
                    <Loader2 className="w-4 h-4 animate-spin text-blue-400" />
                    <span className="text-xs font-semibold text-slate-300">AI Thinking...</span>
                </div>
            )}
        </div>
    );
}
