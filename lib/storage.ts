import { GameState } from "@/types/game";

// This is a more robust In-Memory store that survives HMR (Hot Module Replacement)
// during local development. 
// ON VERCEL: It will work for as long as the serverless function remains warm.
// If the function spins down, the game will be lost. This is normal for a prototype.

declare global {
    var gameStore: Map<string, GameState> | undefined;
}

const games = global.gameStore || new Map<string, GameState>();

if (process.env.NODE_ENV !== 'production') {
    global.gameStore = games;
}

export async function saveGame(gameId: string, state: GameState) {
    games.set(gameId, state);
    return state;
}

export async function getGame(gameId: string): Promise<GameState | null> {
    return games.get(gameId) || null;
}

export async function createGame(gameId: string, state: GameState) {
    games.set(gameId, state);
    return gameId;
}
