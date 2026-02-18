"use client";

import { useEffect, useState } from "react";
import { GameState, Player, SpecialEffect, Cell } from "@/types/game";
import { cn } from "@/lib/utils";
import { motion, AnimatePresence } from "framer-motion";
import { Shield, Zap, Heart, Target, Loader2 } from "lucide-react";
import { basicAI } from "@/lib/game";
import { toast } from "sonner"; // Assuming toast is from sonner or similar library

interface Props {
    state: GameState;
    role: Player | 'spectator' | null;
    onMove: (r: number, c: number, effect: SpecialEffect | null) => void;
    onSwap: (r1: number, c1: number, r2: number, c2: number) => void;
    isAiMode: boolean;
}

export function GameBoard({ state, role, onMove, onSwap, isAiMode }: Props) {
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
                    toast.error("Can only swap adjacent to Opportunity stone");
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

    // AI Turn (Disabled for now as per request)
    /*
    useEffect(() => {
        if (isAiMode && state.turn === 'white' && !state.gameOver && !isProcessing) {
            const timer = setTimeout(async () => {
                setIsProcessing(true);
                const aiMove = basicAI(state.board, 'white');
                if (aiMove) {
                    await onMove(aiMove.r, aiMove.c, aiMove.effect || null);
                }
                setIsProcessing(false);
            }, 1000);
            return () => clearTimeout(timer);
        }
    }, [state.turn, isAiMode, state.gameOver, isProcessing]);
    */

    const effectsList: { id: SpecialEffect; icon: any; color: string; label: string; desc: string }[] = [
        { id: 'empathy', icon: Heart, color: 'text-green-400', label: 'Empathy', desc: 'Spreads green virus. Blocks yellowing.' },
        { id: 'control', icon: Shield, color: 'text-blue-400', label: 'Control', desc: 'Blocks all spreading (Yellow & Empathy).' },
        { id: 'action', icon: Target, color: 'text-red-400', label: 'Action', desc: 'Place two in line to destroy stones between.' },
        { id: 'opportunity', icon: Zap, color: 'text-amber-400', label: 'Opportunity', desc: 'Swap adjacent stones upon placement.' },
    ];

    const currentInventory = role === 'spectator' ? { action: 0, opportunity: 0, control: 0, empathy: 0 } : state.inventory[role || state.turn];

    const getAffectedCells = (r: number, c: number, effect: SpecialEffect | null) => {
        if (!effect) return [];
        const size = state.boardSize;
        const neighbors = [];
        if (r > 0) neighbors.push({ r: r - 1, c });
        if (r < size - 1) neighbors.push({ r: r + 1, c });
        if (c > 0) neighbors.push({ r, c: c - 1 });
        if (c < size - 1) neighbors.push({ r, c: c + 1 });

        if (effect === 'empathy' || effect === 'control' || effect === 'opportunity') {
            return neighbors.filter(n => state.board[n.r][n.c].type !== 'empty');
        }

        if (effect === 'action') {
            const affected: { r: number; c: number }[] = [];
            const directions = [{ dr: 0, dc: 1 }, { dr: 1, dc: 0 }, { dr: 0, dc: -1 }, { dr: -1, dc: 0 }];
            directions.forEach(({ dr, dc }) => {
                let currR = r + dr;
                let currC = c + dc;
                const path = [];
                while (currR >= 0 && currR < size && currC >= 0 && currC < size) {
                    if (state.board[currR][currC].type === 'empty') break;
                    if (state.board[currR][currC].effects.includes('action')) {
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
            {/* Board Container */}
            <div
                className="relative bg-slate-900 p-2 rounded-2xl border border-slate-800 shadow-2xl overflow-hidden"
                style={{
                    width: 'min(90vw, 400px)',
                    height: 'min(90vw, 400px)',
                }}
            >
                {/* Glow Effects Layer */}
                <AnimatePresence>
                    {hovering && state.board[hovering.r][hovering.c].type === 'empty' && (
                        <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            className="absolute inset-0 pointer-events-none z-0"
                            style={{
                                background: `radial-gradient(circle at ${((hovering.c + 0.5) / state.boardSize) * 100}% ${((hovering.r + 0.5) / state.boardSize) * 100}%, rgba(59, 130, 246, 0.15) 0%, transparent 20%)`
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
                    className="grid h-full"
                    style={{
                        gridTemplateColumns: `repeat(${state.boardSize}, 1fr)`,
                        gridTemplateRows: `repeat(${state.boardSize}, 1fr)`,
                    }}
                >
                    {state.board.map((row, r) =>
                        row.map((cell, c) => (
                            <div
                                key={cell.id}
                                className="relative border border-slate-800/50 flex items-center justify-center group touch-none"
                                onClick={() => handleClick(r, c)}
                                onMouseEnter={() => setHovering({ r, c })}
                                onMouseLeave={() => setHovering(null)}
                            >
                                {/* Intersection lines for Go aesthetic */}
                                <div className="absolute w-[1px] h-full bg-slate-800/30 z-0"></div>
                                <div className="absolute h-[1px] w-full bg-slate-800/30 z-0"></div>

                                {/* Stone */}
                                <AnimatePresence mode="popLayout">
                                    {cell.type !== 'empty' && (
                                        <motion.div
                                            layoutId={cell.id}
                                            initial={{ scale: 0, opacity: 0 }}
                                            animate={{ scale: 1, opacity: 1 }}
                                            exit={{ scale: 0, opacity: 0 }}
                                            className={cn(
                                                "w-4/5 h-4/5 rounded-full z-10 shadow-lg relative transition-all duration-300 border",
                                                cell.type === 'black' && "bg-black border-slate-700 shadow-black/80",
                                                cell.type === 'white' && "bg-white border-slate-200 shadow-white/20",
                                                cell.type === 'yellow' && "bg-yellow-400 border-yellow-300 shadow-yellow-400/50",
                                                swapSelection?.r === r && swapSelection?.c === c && "ring-4 ring-amber-400 ring-offset-2 ring-offset-slate-900"
                                            )}
                                        >
                                            {/* Effect markers - Centered */}
                                            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                                                {cell.effects.includes('empathy') && (
                                                    <div className="w-2.5 h-2.5 rounded-full bg-green-400 shadow-[0_0_8px_green] border border-green-500/50" />
                                                )}
                                                {cell.effects.includes('control') && !cell.effects.includes('empathy') && (
                                                    <div className="w-2.5 h-2.5 rounded-full bg-blue-400 shadow-[0_0_8px_blue] border border-blue-500/50" />
                                                )}
                                                {cell.effects.includes('action') && !cell.effects.includes('empathy') && !cell.effects.includes('control') && (
                                                    <div className="text-[12px] font-black text-slate-400 tracking-tighter">X</div>
                                                )}

                                                {/* Multi-effect composite (Optional: if we want to show multiple dots, but current requirement is centering one) */}
                                                {/* For now, prioritizing: Empathy > Control > Action for the primary center marker */}
                                            </div>
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
                                        "w-3/4 h-3/4 rounded-full border-2 border-dashed opacity-40 animate-pulse",
                                        state.turn === 'black' ? "border-slate-50" : "border-slate-400"
                                    )} />
                                )}
                            </div>
                        ))
                    )}
                </div>
            </div>

            {/* Special Stones Selector */}
            <div className="w-full max-w-md space-y-3">
                <div className="flex justify-between items-center mb-1 px-1">
                    <p className="text-xs uppercase tracking-widest text-slate-500 font-bold">Special Stones</p>
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
                                {state.winner === 'black' ? 'All yellow stones neutralized.' : 'The virus could not be contained.'}
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
