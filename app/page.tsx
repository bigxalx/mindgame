"use client";

import { useState, useEffect } from "react";
import { GameBoard } from "@/components/game-board";
import { GameLobby } from "@/components/game-lobby";
import { GameState, Player, SpecialEffect, AIDifficulty, AIBehavior } from "@/types/game";

import { hostGame, joinGame, pollGame, makeMove, swapMove, undoAction, commitTurn, submitLoadout } from "@/app/actions";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { RotateCcw, CheckCircle2, HelpCircle } from "lucide-react";
import { StoneLoadout } from "@/components/stone-loadout";

export default function Home() {
  const [nickname, setNickname] = useState("");
  const [gameId, setGameId] = useState<string | null>(null);
  const [state, setState] = useState<GameState | null>(null);
  const [role, setRole] = useState<Player | 'spectator' | null>(null);
  const [isAiMode, setIsAiMode] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [isPending, setIsPending] = useState(false);

  // Check for gameId in URL on mount
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const id = params.get('game');
    if (id && !gameId) {
      handleJoin("Player", id);
    }
  }, []);

  // Poll for updates if in multiplayer
  useEffect(() => {
    if (!gameId || isAiMode) return;

    const interval = setInterval(async () => {
      const updated = await pollGame(gameId);
      if (updated) {
        setState(updated);
      }
    }, 2000);

    return () => clearInterval(interval);
  }, [gameId, isAiMode]);

  const handleHost = async (name: string, size: number) => {
    try {
      const res = await hostGame(name, size);
      setGameId(res.gameId);
      setState(res.state);
      setNickname(name);
      setRole('black');
      toast.success(`Game created! ID: ${res.gameId}`);
    } catch (e) {
      toast.error("Failed to host game");
    }
  };

  const handleJoin = async (name: string, id: string) => {
    try {
      const res = await joinGame(id, name);
      setGameId(res.gameId);
      setState(res.state);
      setNickname(name);
      setRole('white'); // Second person joins as white
      toast.success("Joined game!");
    } catch (e) {
      toast.error("Game not found");
    }
  };

  const handleAiPlay = async (size: number, difficulty: AIDifficulty, behaviorTree: AIBehavior) => {
    const res = await hostGame("You", size, true, difficulty, behaviorTree);
    if (!res) return;

    setGameId(res.gameId);
    setState(res.state);
    setNickname("You");
    setRole('black');
    setIsAiMode(true);
    toast.info(`Playing against AI (${difficulty}, behavior: ${behaviorTree})`);
  };

  const handleUndo = async () => {
    if (!gameId) return;
    setIsPending(true);
    const newState = await undoAction(gameId);
    if (newState) setState(newState);
    setIsPending(false);
  };

  const handleEndTurn = async () => {
    if (!gameId) return;
    setIsPending(true);
    const newState = await commitTurn(gameId);
    if (newState) {
      setState(newState);
      toast.success("Turn ended");
    }
    setIsPending(false);
  };

  if (!state) {
    return (
      <main className="min-h-screen bg-[#020205] text-slate-50 flex items-center justify-center p-4">
        <GameLobby onHost={handleHost} onJoin={handleJoin} onAiPlay={handleAiPlay} />
      </main>
    );
  }

  const isMyTurn = state.turn === role;
  const canUndo = isMyTurn && state.history.length > 0 && !isPending;
  const canEndTurn = isMyTurn && state.moveConfirmed && !isPending && state.pendingSwap === undefined;

  return (
    <main className="min-h-screen bg-[#020205] text-slate-50 flex flex-col items-center justify-start p-4 md:p-8 space-y-6 overflow-hidden relative">
      {/* Subtle Vignette Overlay - Moved to backdrop level */}
      <div className="fixed inset-0 pointer-events-none bg-[radial-gradient(circle_at_center,transparent_0%,rgba(0,0,0,0.4)_100%)] z-0" />
      <div className="w-full max-w-md flex justify-between items-center">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg overflow-hidden border border-slate-800 shadow-lg">
            <img src="/icon.png" alt="Logo" className="w-full h-full object-cover" />
          </div>
          <h1 className="text-2xl font-bold tracking-tighter bg-gradient-to-br from-white to-slate-400 bg-clip-text text-transparent">
            MIND GAME
          </h1>
          <p className="text-[10px] text-indigo-400/60 font-black tracking-[0.3em] uppercase mt-[-4px] ml-1">Hypnotic Protocol</p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="text-[10px] h-7 border-slate-700"
            onClick={() => {
              const url = `${window.location.origin}?game=${gameId}`;
              navigator.clipboard.writeText(url);
              toast.success("Game link copied!");
            }}
          >
            Share
          </Button>
          <span className="text-xs text-slate-400 font-mono bg-slate-900 px-2 py-1 rounded border border-slate-800">{gameId}</span>
          <Button variant="ghost" size="sm" onClick={() => {
            window.history.pushState({}, '', window.location.pathname);
            setGameId(null);
            setState(null);
          }}>
            Exit
          </Button>
        </div>
      </div>

      {/* Refactored Header Row */}
      <div className="w-full max-w-4xl flex flex-col md:flex-row items-center justify-between gap-4 px-4 py-2 bg-slate-900/40 backdrop-blur-md rounded-2xl border border-white/5 relative z-20">
        <div className="flex items-center gap-6">
          <div className="space-y-0.5">
            <p className="text-[10px] text-slate-500 uppercase tracking-widest font-black">Current Turn</p>
            <p className={`text-sm font-black ${state.turn === 'black' ? 'text-slate-100' : 'text-slate-400'}`}>
              {state.turn === 'black' ? 'BLACK' : 'WHITE'}
            </p>
          </div>
          <div className="w-px h-8 bg-white/5 hidden md:block" />
          <div className="space-y-0.5">
            <p className="text-[10px] text-slate-500 uppercase tracking-widest font-black text-right md:text-left">Goal</p>
            <p className="text-sm font-bold">Neutralize <span className="text-yellow-400">Resistance</span></p>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <div className="flex flex-col items-end">
            <p className="text-[9px] text-slate-500 font-bold uppercase tracking-widest leading-none">Identity: <span className="text-slate-200">{role || state.turn}</span></p>
          </div>
          <button
            onClick={() => setShowHelp(true)}
            className="px-3 py-1.5 rounded-full border border-amber-500/30 bg-amber-500/10 text-amber-400 hover:bg-amber-500/20 text-[10px] font-black uppercase tracking-widest transition-all flex items-center gap-2"
          >
            <HelpCircle className="w-3.5 h-3.5" />
            Rules
          </button>
        </div>
      </div>

      {state.phase === 'loadout' ? (
        <div className="w-full flex flex-col items-center gap-6">
          <StoneLoadout
            limit={(state.isAiGame && (state.difficulty === 'easy' || state.difficulty === 'medium')) ? 3 : 5}
            onConfirm={async (inventory) => {
              if (!gameId || !role || role === 'spectator') return;
              const newState = await submitLoadout(gameId, role, inventory);
              if (newState) setState(newState);
            }}
          />
          {!state.loadoutConfirmed[role as Player] && (
            <p className="text-xs text-slate-500 animate-pulse">Waiting for your selection...</p>
          )}
          {state.loadoutConfirmed[role as Player] && !state.loadoutConfirmed[role === 'black' ? 'white' : 'black'] && (
            <div className="bg-slate-900/60 border border-slate-800 p-6 rounded-3xl text-center space-y-3">
              <div className="w-8 h-8 rounded-full border-2 border-slate-700 border-t-white animate-spin mx-auto" />
              <p className="text-sm font-medium text-slate-300">Synchronizing with opponent...</p>
              <p className="text-[10px] text-slate-500 uppercase tracking-widest">Protocol initialization in progress</p>
            </div>
          )}
        </div>
      ) : (
        <GameBoard
          state={state}
          role={role}
          onMove={async (r: number, c: number, effect: SpecialEffect | null) => {
            if (!gameId) return;
            const newState = await makeMove(gameId, r, c, effect);
            if (newState) setState(newState);
          }}
          onSwap={async (r1: number, c1: number, r2: number, c2: number) => {
            if (!gameId) return;
            const newState = await swapMove(gameId, r1, c1, r2, c2);
            if (newState) setState(newState);
          }}
          onUndo={handleUndo}
          onConfirm={handleEndTurn}
          onActionTypeChange={() => { }}
          onRestart={() => window.location.reload()}
          showHelp={showHelp}
          setShowHelp={setShowHelp}
        />
      )}

      {/* Simplified Bottom Controls */}
      <div className="w-full max-w-2xl flex flex-col items-center gap-4 relative z-10 pb-8">
        {isMyTurn && (
          <div className="w-full space-y-4">
            <div className="text-center">
              <p className="text-xs font-black text-blue-400 uppercase tracking-[0.3em] bg-blue-500/5 py-2 rounded-full border border-blue-500/10">
                {!state.moveConfirmed
                  ? "Your turn: Place a stone"
                  : state.pendingSwap
                    ? "⚡ SWAP ACTIVE"
                    : "Finalize Turn"}
              </p>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <Button
                variant="outline"
                className="border-white/5 bg-slate-900/40 hover:bg-slate-800 h-14 rounded-2xl font-black uppercase tracking-widest text-xs"
                disabled={!canUndo}
                onClick={handleUndo}
              >
                <RotateCcw className="w-4 h-4 mr-2" /> Undo
              </Button>
              <Button
                className="bg-blue-600 hover:bg-blue-500 h-14 rounded-2xl font-black uppercase tracking-widest text-xs shadow-2xl shadow-blue-900/40"
                disabled={!canEndTurn}
                onClick={handleEndTurn}
              >
                <CheckCircle2 className="w-4 h-4 mr-2" /> End Turn
              </Button>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
