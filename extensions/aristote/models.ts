import { BASE_URL, type Cache, type ModelProbe } from "./config.ts";

export interface Spec {
	contextWindow: number;
	reasoning: boolean;
	thinkingToggle: boolean;
	vision: boolean;
	rank: number;
}

const KNOWN: Array<[RegExp, Spec]> = [
	[/^qwen.*reasoning/i, { contextWindow: 262144, reasoning: true, thinkingToggle: false, vision: true, rank: 2 }],
	[/^qwen-3\.8/i, { contextWindow: 262144, reasoning: true, thinkingToggle: true, vision: true, rank: 0 }],
	[/^qwen/i, { contextWindow: 262144, reasoning: true, thinkingToggle: true, vision: true, rank: 1 }],
	[/^gemma/i, { contextWindow: 262144, reasoning: true, thinkingToggle: true, vision: true, rank: 3 }],
	[/^gpt-oss/i, { contextWindow: 131072, reasoning: true, thinkingToggle: false, vision: false, rank: 4 }],
	[/^mistral/i, { contextWindow: 131072, reasoning: false, thinkingToggle: false, vision: true, rank: 5 }],
	[/^llama/i, { contextWindow: 131072, reasoning: false, thinkingToggle: false, vision: false, rank: 8 }],
];

const DEFAULT_SPEC: Spec = { contextWindow: 32768, reasoning: false, thinkingToggle: false, vision: false, rank: 6 };

const NON_CHAT = /(^|[-_/])(bge|e5|embed|embedding|rerank|reranker|whisper|tts|stt|moderation)([-_/]|$)/i;

export function isKnown(id: string): boolean {
	return KNOWN.some(([re]) => re.test(id));
}

export function specFor(id: string, probe?: ModelProbe): Spec {
	const base = KNOWN.find(([re]) => re.test(id))?.[1] ?? DEFAULT_SPEC;
	return {
		...base,
		contextWindow: probe?.contextWindow ?? base.contextWindow,
		vision: probe?.vision ?? base.vision,
		reasoning: probe?.reasoning ?? base.reasoning,
		thinkingToggle: probe?.thinkingToggle ?? base.thinkingToggle,
	};
}

export function prettyName(id: string): string {
	const words: Record<string, string> = {
		qwen: "Qwen", gemma: "Gemma", llama: "Llama", mistral: "Mistral", gpt: "GPT", oss: "OSS",
		deepseek: "DeepSeek", instruct: "Instruct", reasoning: "Reasoning", high: "high",
		small: "Small", medium: "Medium", large: "Large", latest: "latest",
	};
	const label = id
		.split("-")
		.map((w) => words[w.toLowerCase()] ?? (/^\d+(\.\d+)?[bm]$/i.test(w) ? w.toUpperCase() : w))
		.join(" ");
	return `${label} (Aristote)`;
}

export function toModelConfig(id: string, spec: Spec) {
	return {
		id,
		name: prettyName(id),
		reasoning: spec.reasoning,
		input: (spec.vision ? ["text", "image"] : ["text"]) as ("text" | "image")[],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: spec.contextWindow,
		maxTokens: Math.min(32768, Math.floor(spec.contextWindow / 2)),
		compat: {
			supportsDeveloperRole: false,
			supportsStore: false,
			supportsReasoningEffort: false,
			supportsUsageInStreaming: true,
			supportsStrictMode: false,
			maxTokensField: "max_tokens" as const,
			...(spec.thinkingToggle
				? {
						thinkingFormat: "chat-template" as const,
						chatTemplateKwargs: { enable_thinking: { $var: "thinking.enabled" as const } },
					}
				: {}),
		},
	};
}

interface HttpResult {
	status: number;
	json?: any;
	text: string;
}

async function http(key: string, path: string, body?: unknown, timeoutMs = 30000): Promise<HttpResult> {
	const res = await fetch(`${BASE_URL}${path}`, {
		method: body ? "POST" : "GET",
		headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
		body: body ? JSON.stringify(body) : undefined,
		signal: AbortSignal.timeout(timeoutMs),
	});
	const text = await res.text();
	let json: any;
	try {
		json = JSON.parse(text);
	} catch {}
	return { status: res.status, json, text };
}

function errorText(r: HttpResult): string {
	const msg = r.json?.error?.message ?? r.json?.detail ?? r.text;
	return `HTTP ${r.status} : ${String(msg).replace(/\s+/g, " ").slice(0, 160)}`;
}

export async function fetchModelIds(key: string, timeoutMs = 4000): Promise<string[]> {
	const r = await http(key, "/models", undefined, timeoutMs);
	if (r.status !== 200 || !Array.isArray(r.json?.data)) throw new Error(errorText(r));
	return r.json.data
		.filter((m: any) => typeof m?.id === "string")
		.filter((m: any) => !m.mode || m.mode === "chat")
		.map((m: any) => m.id as string)
		.filter((id: string) => !NON_CHAT.test(id));
}

const PING = { messages: [{ role: "user", content: "ping" }], max_tokens: 1 };

async function accepts(key: string, id: string, maxTokens: number): Promise<boolean> {
	const r = await http(key, "/chat/completions", { model: id, ...PING, max_tokens: maxTokens, stop: [" "] });
	return r.status === 200;
}

async function probeContext(key: string, id: string): Promise<number | undefined> {
	const r = await http(key, "/chat/completions", { model: id, ...PING, max_tokens: 50_000_000 });
	const m = /max_model_len[^0-9]*(\d+)|maximum context length is (\d+)/i.exec(r.text);
	if (m) return Number(m[1] ?? m[2]);
	let lo = 4096;
	let hi = 4_194_304;
	if (!(await accepts(key, id, lo))) return undefined;
	while (hi - lo > 256) {
		const mid = Math.floor((lo + hi) / 2);
		if (await accepts(key, id, mid)) lo = mid;
		else hi = mid;
	}
	return Math.ceil(lo / 1024) * 1024;
}

const RED_PNG =
	"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAFklEQVR42mP4z8BAEmIY1TCqYfhqAACQ+f8B8u7oVwAAAABJRU5ErkJggg==";

async function probeVision(key: string, id: string): Promise<boolean> {
	const r = await http(key, "/chat/completions", {
		model: id,
		max_tokens: 5,
		messages: [
			{
				role: "user",
				content: [
					{ type: "text", text: "Color? One word." },
					{ type: "image_url", image_url: { url: RED_PNG } },
				],
			},
		],
	});
	return r.status === 200;
}

async function probeReasoning(key: string, id: string): Promise<{ reasoning: boolean; toggle: boolean }> {
	const ask = (kwargs?: object) =>
		http(key, "/chat/completions", {
			model: id,
			max_tokens: 400,
			messages: [{ role: "user", content: "17*23? Number only." }],
			...(kwargs ? { chat_template_kwargs: kwargs } : {}),
		});
	const thinks = (r: HttpResult) => {
		const msg = r.json?.choices?.[0]?.message;
		return Boolean(msg?.reasoning_content || msg?.reasoning);
	};
	const on = await ask({ enable_thinking: true });
	if (!thinks(on)) return { reasoning: false, toggle: false };
	const off = await ask({ enable_thinking: false });
	return { reasoning: true, toggle: off.status === 200 && !thinks(off) };
}

export async function probeModel(key: string, id: string, previous?: ModelProbe): Promise<ModelProbe> {
	const now = Date.now();
	try {
		let r = await http(key, "/chat/completions", { model: id, ...PING });
		for (let attempt = 1; r.status !== 200 && ![401, 403, 404].includes(r.status) && !/Invalid model name/i.test(r.text) && attempt < 3; attempt++) {
			await new Promise((resolve) => setTimeout(resolve, 1500));
			r = await http(key, "/chat/completions", { model: id, ...PING });
		}
		if (r.status !== 200) return { ...previous, ok: false, checkedAt: now, error: errorText(r) };
		const probe: ModelProbe = { ...previous, ok: true, checkedAt: now, error: undefined };
		if (!isKnown(id) && probe.contextWindow === undefined) {
			probe.contextWindow = await probeContext(key, id);
			probe.vision = await probeVision(key, id);
			const { reasoning, toggle } = await probeReasoning(key, id);
			probe.reasoning = reasoning;
			probe.thinkingToggle = toggle;
		}
		return probe;
	} catch (e) {
		return { ...(previous ?? { ok: true }), checkedAt: now, error: e instanceof Error ? e.message : String(e) };
	}
}

export function visibleIds(cache: Cache): string[] {
	return cache.ids
		.filter((id) => cache.probes[id]?.ok !== false)
		.sort((a, b) => specFor(a).rank - specFor(b).rank || a.localeCompare(b));
}
