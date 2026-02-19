"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Brain, Users, Bot } from "lucide-react";

import { AIDifficulty, AIBehavior } from "@/types/game";

interface Props {
    onHost: (name: string, size: number) => void;
    onJoin: (name: string, id: string) => void;
    onAiPlay: (size: number, difficulty: AIDifficulty, behaviorTree: AIBehavior) => void;
}

export function GameLobby({ onHost, onJoin, onAiPlay }: Props) {
    const [nickname, setNickname] = useState("");
    const [gameId, setGameId] = useState("");
    const [size, setSize] = useState("5");
    const [difficulty, setDifficulty] = useState<AIDifficulty>("medium");
    const [behaviorTree, setBehaviorTree] = useState<AIBehavior>("default");

    return (
        <Card className="w-full max-w-sm bg-[#05050a]/80 backdrop-blur-xl border-slate-800/50 text-slate-50 shadow-[0_0_50px_rgba(0,0,0,0.5)] border-t border-white/5">
            <CardHeader className="text-center">
                <div className="mx-auto w-24 h-24 rounded-2xl overflow-hidden mb-4 border-2 border-slate-800 shadow-xl">
                    <img src="/icon.png" alt="Mind Game" className="w-full h-full object-cover" />
                </div>
                <CardTitle className="text-2xl font-bold tracking-tight text-white">Mind Game</CardTitle>
                <CardDescription className="text-slate-400">Tactical neural hypnosis</CardDescription>
                <p className="text-[11px] text-center w-full text-slate-400 font-medium italic pt-1">
                    Created by Big, who originally had this idea
                </p>
            </CardHeader>
            <CardContent className="space-y-4">
                <div className="space-y-2">
                    <Label htmlFor="nickname" className="text-xs uppercase tracking-wider text-slate-500">Your Nickname</Label>
                    <Input
                        id="nickname"
                        placeholder="Enter nickname..."
                        value={nickname}
                        onChange={(e) => setNickname(e.target.value)}
                        className="bg-[#020205]/60 border-slate-800 focus:ring-indigo-500/20"
                    />
                </div>

                <div className="space-y-2">
                    <Label className="text-xs uppercase tracking-wider text-slate-500">Board Size</Label>
                    <Select value={size} onValueChange={setSize}>
                        <SelectTrigger className="bg-slate-950 border-slate-800">
                            <SelectValue placeholder="Size" />
                        </SelectTrigger>
                        <SelectContent className="bg-slate-900 border-slate-800">
                            <SelectItem value="4">4x4 (Fast)</SelectItem>
                            <SelectItem value="5">5x5 (Classic)</SelectItem>
                            <SelectItem value="6">6x6 (Tactical)</SelectItem>
                        </SelectContent>
                    </Select>
                </div>

                <div className="pt-2">
                    <Button
                        className="w-full bg-blue-600 hover:bg-blue-500 h-10 shadow-lg shadow-blue-900/20 font-bold"
                        onClick={() => onHost(nickname || "Host", parseInt(size))}
                    >
                        <Users className="w-4 h-4 mr-2" /> Host Multiplayer Game
                    </Button>
                </div>

                <div className="space-y-2">
                    <Label className="text-[10px] uppercase tracking-wider text-slate-500">AI Settings</Label>
                    <div className="grid grid-cols-2 gap-2">
                        <Select value={difficulty} onValueChange={(v: AIDifficulty) => setDifficulty(v)}>
                            <SelectTrigger className="bg-slate-950 border-slate-800 h-10 text-xs">
                                <SelectValue placeholder="Difficulty" />
                            </SelectTrigger>
                            <SelectContent className="bg-slate-900 border-slate-800">
                                <SelectItem value="easy">Easy</SelectItem>
                                <SelectItem value="medium">Medium</SelectItem>
                                <SelectItem value="hard">Hard</SelectItem>
                                <SelectItem value="expert">Expert</SelectItem>
                                <SelectItem value="impossible">Impossible</SelectItem>
                            </SelectContent>
                        </Select>
                        <Select value={behaviorTree} onValueChange={(v: AIBehavior) => setBehaviorTree(v)}>
                            <SelectTrigger className="bg-slate-950 border-slate-800 h-10 text-xs">
                                <SelectValue placeholder="Behavior" />
                            </SelectTrigger>
                            <SelectContent className="bg-slate-900 border-slate-800">
                                <SelectItem value="default">Default BT</SelectItem>
                                <SelectItem value="none">No Behavior</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                    <Button
                        variant="outline"
                        className="w-full border-slate-700 hover:bg-slate-800 h-10"
                        onClick={() => onAiPlay(parseInt(size), difficulty, behaviorTree)}
                    >
                        <Bot className="w-4 h-4 mr-2" /> Vs AI
                    </Button>
                </div>

                <div className="relative py-2">
                    <div className="absolute inset-0 flex items-center">
                        <span className="w-full border-t border-slate-800"></span>
                    </div>
                    <div className="relative flex justify-center text-xs uppercase">
                        <span className="bg-slate-900 px-2 text-slate-500">Or join existing</span>
                    </div>
                </div>

                <div className="flex gap-2">
                    <Input
                        placeholder="Game ID (e.g. AB12CD)"
                        value={gameId}
                        onChange={(e) => setGameId(e.target.value.toUpperCase())}
                        className="bg-slate-950 border-slate-800"
                    />
                    <Button
                        variant="secondary"
                        onClick={() => onJoin(nickname || "Player", gameId)}
                        disabled={!gameId}
                    >
                        Join
                    </Button>
                </div>
            </CardContent>
            <CardFooter>
                <p className="text-[10px] text-center w-full text-slate-500 leading-tight">
                    Goal: As the Mentalist (Black), capture all Resistance. Protect the host's mind.
                </p>
            </CardFooter>
        </Card>
    );
}
