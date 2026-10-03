import { chmodSync, existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const PROVIDER = "aristote";
export const API_ID = "aristote-openai";
export const BASE_URL = (process.env.ARISTOTE_BASE_URL ?? "https://llm.aristote.education/v1").replace(/\/+$/, "");
export const AGENT_DIR = process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent");

const AUTH_FILE = join(AGENT_DIR, "auth.json");
const CACHE_FILE = join(AGENT_DIR, "aristote-cache.json");
const PREFS_FILE = join(AGENT_DIR, "aristote-preferences.json");

export const LANGUES: Record<string, string> = {
	fr: "French",
	en: "English",
	es: "Spanish",
	de: "German",
	it: "Italian",
	pt: "Portuguese",
	nl: "Dutch",
	el: "Greek",
	ar: "Arabic",
	zh: "Chinese",
	ja: "Japanese",
};

export function getLangue(): string {
	try {
		return JSON.parse(readFileSync(PREFS_FILE, "utf8")).langue || "auto";
	} catch {
		return "auto";
	}
}

export function setLangue(langue: string): void {
	let prefs: Record<string, unknown> = {};
	try {
		prefs = JSON.parse(readFileSync(PREFS_FILE, "utf8"));
	} catch {}
	prefs.langue = langue;
	writeJsonAtomic(PREFS_FILE, prefs);
}

export function langueInstruction(fallback = "the user's language"): string {
	const l = getLangue();
	return l === "auto" ? `Reply in ${fallback}.` : `Reply in ${LANGUES[l] ?? l}.`;
}

export const HEALTH_TTL_MS = 30 * 60 * 1000;

export function resolveApiKey(): { key?: string; source: string } {
	try {
		const auth = JSON.parse(readFileSync(AUTH_FILE, "utf8"));
		const key = auth?.[PROVIDER]?.key;
		if (typeof key === "string" && key.trim()) return { key: key.trim(), source: "auth.json" };
	} catch {}
	const env = process.env.ARISTOTE_API_KEY?.trim();
	if (env) return { key: env, source: "$ARISTOTE_API_KEY" };
	return { source: "aucune" };
}

export function saveApiKey(key: string): void {
	let auth: Record<string, unknown> = {};
	if (existsSync(AUTH_FILE)) {
		try {
			auth = JSON.parse(readFileSync(AUTH_FILE, "utf8"));
		} catch {
			throw new Error(`${AUTH_FILE} est illisible (JSON invalide) : je n'y touche pas. Corrige-le, ou lance pi avec ARISTOTE_API_KEY=sk-…`);
		}
	}
	auth[PROVIDER] = { type: "api_key", key };
	writeJsonAtomic(AUTH_FILE, auth);
	chmodSync(AUTH_FILE, 0o600);
}

export function maskKey(key?: string): string {
	return key ? `${key.slice(0, 5)}…${key.slice(-3)}` : "—";
}

export interface ModelProbe {
	ok: boolean;
	checkedAt: number;
	error?: string;
	contextWindow?: number;
	vision?: boolean;
	reasoning?: boolean;
	thinkingToggle?: boolean;
}

export interface Cache {
	ids: string[];
	fetchedAt: number;
	probes: Record<string, ModelProbe>;
}

export function loadCache(): Cache {
	try {
		if (existsSync(CACHE_FILE)) {
			const c = JSON.parse(readFileSync(CACHE_FILE, "utf8"));
			return { ids: c.ids ?? [], fetchedAt: c.fetchedAt ?? 0, probes: c.probes ?? {} };
		}
	} catch {}
	return { ids: [], fetchedAt: 0, probes: {} };
}

export function saveCache(cache: Cache): void {
	try {
		writeJsonAtomic(CACHE_FILE, cache);
	} catch {}
}

function writeJsonAtomic(file: string, data: unknown): void {
	const tmp = `${file}.tmp-${process.pid}`;
	writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
	renameSync(tmp, file);
}
