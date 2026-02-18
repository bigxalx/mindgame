import { kv } from "@vercel/kv";
import { GameState } from "@/types/game";

// This is a dual-mode storage:
// 1. LOCALHOST: Uses a global Map (persistent during HMR).
// 2. VERCEL: Uses Vercel KV if KV_URL is present. 
// Just click 'Storage' -> 'KV' in your Vercel dashboard to enable.

declare global {
    var gameStore: Map<string, GameState> | undefined;
}

const localGames = global.gameStore || new Map<string, GameState>();
if (process.env.NODE_ENV !== 'production') {
    global.gameStore = localGames;
}

const isKvEnabled = !!(process.env.KV_URL || process.env.UPSTASH_REDIS_REST_URL);

export async function saveGame(gameId: string, state: GameState) {
    if (isKvEnabled) {
        await kv.set(`game:${gameId}`, state, { ex: 3600 * 24 }); // 24h expiration
    } else {
        localGames.set(gameId, state);
    }
    return state;
}

export async function getGame(gameId: string): Promise<GameState | null> {
    if (isKvEnabled) {
        return await kv.get<GameState>(`game:${gameId}`);
    }
    return localGames.get(gameId) || null;
}

export async function createGame(gameId: string, state: GameState) {
    return await saveGame(gameId, state);
}
