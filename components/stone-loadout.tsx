"use client";

import { useState } from "react";
import { SpecialEffect, Inventory } from "@/types/game";
import { cn } from "@/lib/utils";
import { motion, AnimatePresence } from "framer-motion";
import { Shield, Zap, Heart, Target, ChevronRight, X } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Props {
    limit: number;
    onConfirm: (loadout: Inventory) => void;
}

const ALL_EFFECTS: { id: SpecialEffect; icon: any; color: string; label: string; desc: string; bonus?: string }[] = [
    { id: 'aggression', icon: Target, color: 'text-red-400', label: 'Aggression', desc: 'Destructive laser beams', bonus: '2x' },
    { id: 'manipulation', icon: Zap, color: 'text-purple-400', label: 'Manipulation', desc: 'Swap adjacent stones' },
    { id: 'empathy', icon: Heart, color: 'text-green-400', label: 'Empathy', desc: 'Viral team conversion' },
    { id: 'control', icon: Shield, color: 'text-blue-400', label: 'Control', desc: 'Suppress special effects' },
];

export function StoneLoadout({ limit, onConfirm }: Props) {
    const [selected, setSelected] = useState<SpecialEffect[]>([]);

    // Inventory pool: 2 of each
    const getRemainingInInventory = (effect: SpecialEffect) => {
        const picked = selected.filter(s => s === effect).length;
        return 2 - picked;
    };

    const handlePick = (effect: SpecialEffect) => {
        if (selected.length >= limit) return;
        if (getRemainingInInventory(effect) <= 0) return;
        setSelected([...selected, effect]);
    };

    const handleRemove = (index: number) => {
        const newSelected = [...selected];
        newSelected.splice(index, 1);
        setSelected(newSelected);
    };

    const handleConfirm = () => {
        const inventory: Inventory = { aggression: 0, manipulation: 0, empathy: 0, control: 0 };
        selected.forEach(effect => {
            if (effect === 'aggression') {
                inventory[effect] += 2; // Special case: Aggression stones are split (2 charges)
            } else {
                inventory[effect]++;
            }
        });
        onConfirm(inventory);
    };

    return (
        <div className="w-full max-w-2xl bg-slate-900/40 backdrop-blur-xl border border-white/5 rounded-[2.5rem] p-8 shadow-2xl flex flex-col items-center gap-8 min-h-[500px]">
            <div className="text-center space-y-2">
                <h2 className="text-3xl font-black tracking-tighter text-white uppercase italic italic">Initialize Loadout</h2>
                <p className="text-slate-400 text-sm font-medium">Select up to <span className="text-white font-bold">{limit}</span> special stones for this protocol</p>
            </div>

            {/* Inventory Selection */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 w-full">
                {ALL_EFFECTS.map((eff) => {
                    const remaining = getRemainingInInventory(eff.id);
                    const isAvailable = remaining > 0 && selected.length < limit;

                    return (
                        <button
                            key={eff.id}
                            onClick={() => handlePick(eff.id)}
                            disabled={!isAvailable}
                            className={cn(
                                "group relative flex flex-col items-center p-4 rounded-2xl border transition-opacity transition-transform duration-300",
                                isAvailable
                                    ? "bg-slate-800/40 border-slate-700/50 hover:bg-slate-800 hover:border-slate-500 hover:scale-[1.02]"
                                    : "bg-slate-950/40 border-slate-900/50 opacity-40 cursor-not-allowed"
                            )}
                        >
                            {eff.bonus && (
                                <div className="absolute top-2 right-2 px-1.5 py-0.5 rounded-md bg-white/10 border border-white/10 text-[9px] font-black text-white/70 uppercase tracking-tighter z-10">
                                    {eff.bonus}
                                </div>
                            )}
                            <div className={cn("p-3 rounded-xl bg-slate-900 shadow-inner mb-3", eff.color)}>
                                <eff.icon className="w-6 h-6" />
                            </div>
                            <span className="text-sm font-bold text-slate-200">{eff.label}</span>
                            <span className="text-[10px] text-slate-500 uppercase tracking-tighter mt-1">{remaining} available</span>

                            {/* Hover info */}
                            <div className="absolute inset-x-0 -bottom-2 opacity-0 group-hover:opacity-100 transition-all duration-300 pointer-events-none translate-y-full group-hover:translate-y-[calc(100%+8px)] pt-2 z-50">
                                <div className="bg-slate-800 border border-slate-700 p-2 rounded-lg text-[10px] text-slate-300 shadow-xl text-center">
                                    {eff.desc}
                                </div>
                            </div>
                        </button>
                    );
                })}
            </div>

            {/* Loadout Slots */}
            <div className="w-full space-y-4">
                <div className="flex justify-between items-end px-2">
                    <span className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">Active Slots</span>
                    <span className="text-[10px] font-black text-slate-400">{selected.length} / {limit}</span>
                </div>
                <div className="flex flex-wrap justify-center gap-3 p-6 bg-slate-950/50 border border-white/5 rounded-3xl min-h-[100px]">
                    <AnimatePresence mode="popLayout">
                        {Array.from({ length: limit }).map((_, i) => {
                            const effectId = selected[i];
                            const eff = effectId ? ALL_EFFECTS.find(e => e.id === effectId) : null;

                            return (
                                <motion.div
                                    key={effectId ? `${effectId}-${i}` : `empty-${i}`}
                                    layout
                                    initial={{ scale: 0.8, opacity: 0 }}
                                    animate={{ scale: 1, opacity: 1 }}
                                    exit={{ scale: 0.8, opacity: 0 }}
                                    className={cn(
                                        "w-14 aspect-square rounded-full border flex items-center justify-center relative group overflow-hidden",
                                        eff
                                            ? "bg-slate-800 border-slate-600 shadow-lg shadow-black/40 cursor-pointer hover:border-red-500/50"
                                            : "bg-slate-900/30 border-slate-800/50 border-dashed"
                                    )}
                                    onClick={() => eff && handleRemove(i)}
                                >
                                    {eff ? (
                                        <>
                                            <eff.icon className={cn("w-6 h-6", eff.color)} />
                                            {/* Remove overlay */}
                                            <div className="absolute inset-0 bg-red-500/20 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                                                <X className="w-4 h-4 text-red-100" />
                                            </div>
                                        </>
                                    ) : (
                                        <div className="w-1.5 h-1.5 rounded-full bg-slate-800" />
                                    )}
                                </motion.div>
                            );
                        })}
                    </AnimatePresence>
                </div>
            </div>

            {/* Confirm */}
            <div className="w-full flex justify-end items-center gap-4">
                <div className="flex flex-col items-end">
                    <p className="text-[10px] text-slate-500 uppercase tracking-widest leading-none">Status</p>
                    <p className="text-xs font-bold text-slate-300">Ready for engagement</p>
                </div>
                <Button
                    onClick={handleConfirm}
                    className="h-14 px-8 rounded-2xl bg-slate-50 text-slate-950 font-black tracking-tight hover:bg-white hover:scale-105 transition-all text-base italic uppercase"
                >
                    Confirm Loadout
                    <ChevronRight className="ml-2 w-5 h-5" />
                </Button>
            </div>
        </div>
    );
}
