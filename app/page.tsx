"use client";

import { useState, useEffect } from "react";
import { GameBoard } from "@/components/game-board";
import { GameLobby } from "@/components/game-lobby";
import { GameState, Player, SpecialEffect } from "@/types/game";
import { hostGame, joinGame, pollGame, makeMove, swapMove, undoAction, commitTurn } from "@/app/actions";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { RotateCcw, CheckCircle2 } from "lucide-react";

export default function Home() {
  const [nickname, setNickname] = useState("");
  const [gameId, setGameId] = useState<string | null>(null);
  const [state, setState] = useState<GameState | null>(null);
  const [role, setRole] = useState<Player | 'spectator' | null>(null);
  const [isAiMode, setIsAiMode] = useState(false);
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

  const handleAiPlay = async (size: number) => {
    const res = await hostGame("You", size);
    setGameId(res.gameId);
    setState(res.state);
    setNickname("You");
    setRole('black');
    setIsAiMode(true);
    toast.info("Playing against AI");
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
      <main className="min-h-screen bg-slate-950 text-slate-50 flex items-center justify-center p-4">
        <GameLobby onHost={handleHost} onJoin={handleJoin} onAiPlay={handleAiPlay} />
      </main>
    );
  }

  const isMyTurn = state.turn === role;
  const canUndo = isMyTurn && state.history.length > 0 && !isPending;
  const canEndTurn = isMyTurn && state.moveConfirmed && !isPending && state.pendingSwap === undefined;

  return (
    <main className="min-h-screen bg-slate-950 text-slate-50 flex flex-col items-center justify-start p-4 md:p-8 space-y-6">
      <div className="w-full max-w-md flex justify-between items-center">
        <h1 className="text-2xl font-bold tracking-tighter bg-gradient-to-br from-white to-slate-400 bg-clip-text text-transparent">
          MIND GAME
        </h1>
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
        isAiMode={isAiMode}
      />

      <div className="w-full max-w-md space-y-4">
        {isMyTurn && (
          <div className="space-y-4">
            <div className="bg-blue-600/10 border border-blue-500/20 p-3 rounded-xl text-center">
              <p className="text-sm font-medium text-blue-300">
                {!state.moveConfirmed
                  ? "Place your stone"
                  : state.pendingSwap
                    ? "⚡ Opportunity! Select stones to swap"
                    : "Review your move or End Turn"}
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Button
                variant="outline"
                className="border-slate-800 bg-slate-900/50 hover:bg-slate-800 h-12"
                disabled={!canUndo}
                onClick={handleUndo}
              >
                <RotateCcw className="w-4 h-4 mr-2" /> Undo
              </Button>
              <Button
                className="bg-blue-600 hover:bg-blue-500 shadow-lg shadow-blue-900/20 h-12"
                disabled={!canEndTurn}
                onClick={handleEndTurn}
              >
                <CheckCircle2 className="w-4 h-4 mr-2" /> End Turn
              </Button>
            </div>
          </div>
        )}

        <Card className="p-4 bg-slate-900/50 border-slate-800 backdrop-blur-md">
          <div className="flex justify-between items-center">
            <div>
              <p className="text-xs text-slate-400 uppercase tracking-widest font-semibold">Current Turn</p>
              <p className={`text-lg font-bold ${state.turn === 'black' ? 'text-slate-100' : 'text-slate-400'}`}>
                {state.turn === 'black' ? 'BLACK' : 'WHITE'}
              </p>
            </div>
            <div className="text-right">
              <p className="text-xs text-slate-400 uppercase tracking-widest font-semibold">Goal</p>
              <p className="text-sm">Capture all <span className="text-yellow-400 font-bold">Yellow</span> stones</p>
            </div>
          </div>
        </Card>
      </div>
    </main>
  );
}
