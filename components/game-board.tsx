"use client";

import { useEffect, useState } from "react";
import { GameState, Player, SpecialEffect, Cell } from "@/types/game";
import { cn } from "@/lib/utils";
import { motion, AnimatePresence } from "framer-motion";
import { Shield, Zap, Heart, Target, Loader2, Sparkles } from "lucide-react";
import { getAIDecision, getNeighbors } from "@/lib/game";
import { toast } from "sonner";

interface Props {
    state: GameState;
    role: Player | 'spectator' | null;
    onMove: (r: number, c: number, effect: SpecialEffect | null) => void;
    onSwap: (r1: number, c1: number, r2: number, c2: number) => void;
    onEndTurn: () => void;
    isAiMode: boolean;
}

export function GameBoard({ state, role, onMove, onSwap, onEndTurn, isAiMode }: Props) {
    const [selectedEffect, setSelectedEffect] = useState<SpecialEffect | null>(null);
    const [hovering, setHovering] = useState<{ r: number; c: number } | null>(null);
    const [isProcessing, setIsProcessing] = useState(false);
    const [swapSelection, setSwapSelection] = useState<{ r: number; c: number } | null>(null);

    const canMove = state.turn === role && !state.gameOver && !isProcessing;
    const isSwapMode = state.pendingSwap !== undefined;

    const handleClick = async (r: number, c: number) => {
        if (!canMove) return;

        if (isSwapMode) {
            if (!swapSelection) {
                // Can only pick the opportunity stone or adjacent ones
                const dist = Math.abs(r - state.pendingSwap!.r) + Math.abs(c - state.pendingSwap!.c);
                if (dist <= 1) {
                    setSwapSelection({ r, c });
                } else {
                    toast.error("Can only swap adjacent to Manipulation stone");
                }
            } else {
                const dist = Math.abs(r - swapSelection.r) + Math.abs(c - swapSelection.c);
                if (dist === 1 || (r === swapSelection.r && c === swapSelection.c)) {
                    setIsProcessing(true);
                    await onSwap(swapSelection.r, swapSelection.c, r, c);
                    setSwapSelection(null);
                    setIsProcessing(false);
                } else {
                    toast.error("Stones must be adjacent to swap");
                }
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
        const needsToAct = (isAiMode || state.isAiGame) && state.turn === 'white';

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
                        await onMove(aiDecision.r, aiDecision.c, aiDecision.effect);
                    } else {
                        console.log("AI Phase 1: No valid moves, ending turn.");
                        onEndTurn();
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
                    const neighbors = getNeighbors(r, c, state.boardSize);
                    const target = neighbors[Math.floor(Math.random() * neighbors.length)];
                    await onSwap(r, c, target.r, target.c);
                    setIsProcessing(false);
                    return;
                }

                // Phase 3: Commit Turn
                if (state.moveConfirmed && !state.pendingSwap) {
                    setIsProcessing(true);
                    console.log("AI Phase 3: Committing turn...");
                    await new Promise(r => setTimeout(r, 500)); // Finish delay
                    onEndTurn();
                    setIsProcessing(false);
                }
            } catch (error) {
                console.error("AI Turn Lifecycle Error:", error);
                setIsProcessing(false);
            }
        }, 600);

        return () => clearTimeout(timer);
    }, [state.turn, isAiMode, state.isAiGame, state.gameOver, isProcessing, state.difficulty, state.moveConfirmed, state.pendingSwap]);

    const effectsList: { id: SpecialEffect; icon: any; color: string; glow: string; label: string; desc: string }[] = [
        { id: 'empathy', icon: Heart, color: 'text-green-400', glow: 'shadow-[0_0_15px_rgba(74,222,128,0.5)]', label: 'Empathy', desc: 'Converts adjacent neutral stones at turn start.' },
        { id: 'control', icon: Shield, color: 'text-blue-400', glow: 'shadow-[0_0_15px_rgba(96,165,250,0.5)]', label: 'Control', desc: 'Blocks all spreading (Resistance & Empathy).' },
        { id: 'aggression', icon: Target, color: 'text-red-400', glow: 'shadow-[0_0_15px_rgba(248,113,113,0.5)]', label: 'Aggression', desc: 'Place two in line to destroy stones between.' },
        { id: 'manipulation', icon: Zap, color: 'text-purple-400', glow: 'shadow-[0_0_15px_rgba(192,132,252,0.5)]', label: 'Manipulation', desc: 'Swap adjacent stones upon placement.' },
    ];

    const currentInventory = role === 'spectator' ? { aggression: 0, manipulation: 0, control: 0, empathy: 0 } : state.inventory[role || state.turn];

    const getAffectedCells = (r: number, c: number, effect: SpecialEffect | null) => {
        if (!effect) return [];
        const size = state.boardSize;
        const neighbors = [];
        if (r > 0) neighbors.push({ r: r - 1, c });
        if (r < size - 1) neighbors.push({ r: r + 1, c });
        if (c > 0) neighbors.push({ r, c: c - 1 });
        if (c < size - 1) neighbors.push({ r, c: c + 1 });

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
                    if (state.board[currR][currC].type === 'empty') break;
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
                    <p className="text-[10px] text-slate-400 font-medium">Player: <span className="uppercase text-slate-200">{role || state.turn}</span></p>
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

            {/* Board Wrapper (Hypnotic Neural Synapse Background) */}
            <div
                className="relative rounded-[2.5rem] shadow-[0_0_100px_rgba(0,0,0,1)] overflow-hidden group border border-slate-800/50 bg-[#020205]"
                style={{
                    width: 'min(95vw, 750px)',
                    height: 'min(95vw, 750px)',
                    padding: '8%',
                }}
            >
                {/* 1. Cosmic Depth & Denser Neural Fog Layers */}
                <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(20,15,45,1)_0%,rgba(2,2,8,1)_100%)]" />

                {/* High-Intensity Brain Fog */}
                <motion.div
                    animate={{ x: [0, 80, 0], y: [0, 40, 0], opacity: [0.15, 0.35, 0.15], scale: [1, 1.2, 1] }}
                    transition={{ duration: 20, repeat: Infinity, ease: "linear" }}
                    className="absolute top-[-20%] left-[-20%] w-[140%] h-[140%] bg-[radial-gradient(circle,rgba(80,50,150,0.25)_0%,transparent_70%)] blur-[100px] z-0"
                />
                <motion.div
                    animate={{ x: [0, -60, 0], y: [0, 70, 0], opacity: [0.1, 0.25, 0.1], scale: [1.2, 1, 1.2] }}
                    transition={{ duration: 25, repeat: Infinity, ease: "linear" }}
                    className="absolute bottom-[-30%] right-[-20%] w-[150%] h-[150%] bg-[radial-gradient(circle,rgba(50,80,180,0.2)_0%,transparent_70%)] blur-[120px] z-0"
                />
                <motion.div
                    animate={{ opacity: [0.05, 0.15, 0.05] }}
                    transition={{ duration: 10, repeat: Infinity, ease: "easeInOut" }}
                    className="absolute inset-0 bg-[#0a0a1a]/30 z-0"
                />

                {/* Random Synapse Flashes Layer */}
                <div className="absolute inset-0 z-0 opacity-40 pointer-events-none">
                    {[...Array(10)].map((_, i) => (
                        <motion.div
                            key={`flash-${i}`}
                            animate={{
                                opacity: [0, 0.9, 0],
                                scale: [0.8, 1.1, 0.8]
                            }}
                            transition={{
                                duration: Math.random() * 3 + 1.5,
                                repeat: Infinity,
                                delay: Math.random() * 15,
                                repeatDelay: Math.random() * 8
                            }}
                            className="absolute bg-indigo-400/50 blur-[2px] rounded-full"
                            style={{
                                width: '1px',
                                height: `${Math.random() * 150 + 80}px`,
                                top: `${Math.random() * 100}%`,
                                left: `${Math.random() * 100}%`,
                                transform: `rotate(${Math.random() * 360}deg)`,
                                boxShadow: '0 0 15px rgba(129, 140, 248, 0.4)'
                            }}
                        />
                    ))}
                </div>

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
                                animate={{ opacity: 0.4, scale: 1 }}
                                exit={{ opacity: 0, scale: 0.5 }}
                                className={cn("absolute pointer-events-none rounded-full blur-xl z-0", effectColor || "bg-blue-400")}
                                style={{
                                    width: `${100 / state.boardSize}%`,
                                    height: `${100 / state.boardSize}%`,
                                    left: `${(cell.c / state.boardSize) * 100}%`,
                                    top: `${(cell.r / state.boardSize) * 100}%`,
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
                        {state.board.map((row, r) =>
                            row.map((cell, c) => (
                                <div
                                    key={cell.id}
                                    className="relative flex items-center justify-center group touch-none"
                                    onClick={() => handleClick(r, c)}
                                    onMouseEnter={() => setHovering({ r, c })}
                                    onMouseLeave={() => setHovering(null)}
                                >
                                    {/* High-Glow Organic Filaments (Grid Lines) */}
                                    <div className={cn(
                                        "absolute w-[2px] bg-white/30 shadow-[0_0_15px_rgba(255,255,255,0.2)] transition-all duration-700 z-0",
                                        r === 0 ? "top-1/2 h-1/2" : r === state.boardSize - 1 ? "bottom-1/2 h-1/2" : "h-full",
                                        hovering?.c === c && "bg-white/60 shadow-[0_0_20px_rgba(255,255,255,0.4)] w-[3px]"
                                    )}></div>
                                    <div className={cn(
                                        "absolute h-[2px] bg-white/30 shadow-[0_0_15px_rgba(255,255,255,0.2)] transition-all duration-700 z-0",
                                        c === 0 ? "left-1/2 w-1/2" : c === state.boardSize - 1 ? "right-1/2 w-1/2" : "w-full",
                                        hovering?.r === r && "bg-white/60 shadow-[0_0_20px_rgba(255,255,255,0.4)] h-[3px]"
                                    )}></div>

                                    {/* Synapse Nodes (Strong Glowing Intersections) */}
                                    <div className="absolute w-3 h-3 rounded-full bg-white/10 blur-[2px] z-0" />
                                    <motion.div
                                        animate={{ opacity: [0.3, 0.7, 0.3], scale: [1, 1.4, 1] }}
                                        transition={{ duration: 2.5, repeat: Infinity, delay: (r + c) * 0.15 }}
                                        className="absolute w-1.5 h-1.5 rounded-full bg-[#fce7d5]/60 blur-[0.5px] z-0 shadow-[0_0_10px_rgba(252,231,213,0.5)]"
                                    />

                                    {/* Occult Stone (The Soul & Aura System) */}
                                    <AnimatePresence mode="popLayout">
                                        {cell.type !== 'empty' && (
                                            <motion.div
                                                layoutId={cell.id}
                                                initial={{ scale: 0, opacity: 0 }}
                                                animate={{ scale: 1, opacity: 1 }}
                                                exit={{ scale: 0, opacity: 0 }}
                                                className={cn(
                                                    "w-[75%] h-[75%] rounded-full z-10 shadow-2xl relative transition-all duration-500",
                                                    "border border-white/20 backdrop-blur-md overflow-hidden",
                                                    cell.type === 'black' && "bg-black",
                                                    (cell.type === 'white' || cell.type === 'resistance') && "bg-white",
                                                    // Massive Edge Glows (50% Shape Aura)
                                                    cell.type === 'resistance' && "ring-[8px] ring-amber-500/80 shadow-[0_0_40px_rgba(245,158,11,0.6)]",
                                                    cell.effects.includes('empathy') && "ring-[8px] ring-emerald-400/80 shadow-[0_0_40px_rgba(52,211,153,0.6)]",
                                                    cell.effects.includes('control') && "ring-[8px] ring-blue-400/80 shadow-[0_0_40px_rgba(96,165,250,0.6)]",
                                                    cell.effects.includes('aggression') && "ring-[8px] ring-rose-500/80 shadow-[0_0_40px_rgba(244,63,94,0.6)]",
                                                    cell.effects.includes('manipulation') && "ring-[8px] ring-purple-400/80 shadow-[0_0_40px_rgba(192,132,252,0.6)]",
                                                    swapSelection?.r === r && swapSelection?.c === c && "ring-[10px] ring-white shadow-[0_0_50px_white] scale-110"
                                                )}
                                            >
                                                {/* Specialized Light Hearts */}
                                                <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-20">
                                                    {cell.type === 'black' ? (
                                                        <div className="w-1/2 h-1/2 rounded-full bg-gradient-to-br from-indigo-500/40 via-purple-600/20 to-transparent blur-[4px] animate-pulse" />
                                                    ) : (
                                                        <div className="w-1/2 h-1/2 rounded-full bg-gradient-to-br from-white via-blue-100/40 to-transparent blur-[3px] animate-pulse" />
                                                    )}

                                                    {/* The Concentrated Light Spark */}
                                                    <div className={cn(
                                                        "w-1.5 h-1.5 rounded-full blur-[0.5px] shadow-[0_0_10px_rgba(255,255,255,0.8)]",
                                                        cell.type === 'black' ? "bg-indigo-200" : "bg-white"
                                                    )} />
                                                </div>

                                                {/* Deep Inset Shadows for 50/50 Look */}
                                                <div className="absolute inset-0 rounded-full shadow-[inset_0_0_25px_rgba(0,0,0,0.8)] z-10" />

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
                                {state.winner === 'black' ? 'All resistance stones captured.' : 'The virus could not be contained.'}
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
