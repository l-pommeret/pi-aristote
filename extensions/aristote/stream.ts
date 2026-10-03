import {
	type Api,
	type AssistantMessage,
	type AssistantMessageEvent,
	type AssistantMessageEventStream,
	type Context,
	createAssistantMessageEventStream,
	type Model,
	type SimpleStreamOptions,
} from "@earendil-works/pi-ai";
import { streamSimple } from "@earendil-works/pi-ai/compat";

// La passerelle renvoie parfois un flux vide (stop, sans texte ni outil) : on relance.
const MAX_EMPTY_RETRIES = 4;
const CONTEXT_MARGIN = 1024;
const MIN_OUTPUT = 1024;

export const deps = { streamSimple, sleep: (ms: number, signal?: AbortSignal) => sleep(ms, signal) };

export const stats = { requests: 0, emptyRetries: 0, emptyFailures: 0, clamped: 0 };
export const hooks: { onEmptyRetry?: (attempt: number, max: number) => void; onRecovered?: () => void } = {};

function blockChars(block: any): number {
	if (!block || typeof block !== "object") return typeof block === "string" ? block.length : 0;
	switch (block.type) {
		case "text":
			return block.text?.length ?? 0;
		case "thinking":
			return block.thinking?.length ?? 0;
		case "toolCall":
			return (block.name?.length ?? 0) + JSON.stringify(block.arguments ?? {}).length;
		case "image":
			return 4500;
		default:
			return JSON.stringify(block).length;
	}
}

export function estimateTokens(context: Context): number {
	let chars = context.systemPrompt?.length ?? 0;
	for (const m of context.messages as any[]) {
		chars += 16;
		if (typeof m.content === "string") chars += m.content.length;
		else if (Array.isArray(m.content)) for (const b of m.content) chars += blockChars(b);
	}
	chars += JSON.stringify(context.tools ?? []).length;
	return Math.ceil(chars / 3);
}

// nginx devant la passerelle refuse les requêtes de plus de 1 Mio (413) : les images les plus anciennes sautent d'abord.
const MAX_BODY = 1_000_000;
const IMAGE_DROPPED = "[image removed: request size limit]";

export function fitBody(context: Context): Context {
	let size = Buffer.byteLength(JSON.stringify(context));
	if (size <= MAX_BODY) return context;
	const messages = (context.messages as any[]).map((m) => (Array.isArray(m.content) ? { ...m, content: [...m.content] } : m));
	for (const m of messages) {
		if (!Array.isArray(m.content)) continue;
		for (let i = 0; i < m.content.length && size > MAX_BODY; i++) {
			const b = m.content[i];
			if (b?.type !== "image") continue;
			size -= b.data?.length ?? 0;
			m.content[i] = { type: "text", text: IMAGE_DROPPED };
		}
	}
	return { ...context, messages };
}

export function clampMaxTokens(model: Model<Api>, context: Context, requested?: number): number {
	const wanted = requested ?? model.maxTokens;
	const room = model.contextWindow - estimateTokens(context) - CONTEXT_MARGIN;
	if (room >= wanted) return wanted;
	stats.clamped++;
	return Math.max(MIN_OUTPUT, room);
}

const OVERFLOW_PATTERNS = [
	/'>=' not supported between instances of 'str' and 'int'/i,
	/cannot be greater than max_model_len/i,
	/maximum context length/i,
	/prompt is too long|too many tokens|input.*too long/i,
];

export function rewriteError(message: string): string {
	if (message.includes("context_length_exceeded")) return message;
	if (/\b413\b|Request Entity Too Large/i.test(message))
		return "request_too_large (Aristote) : la requête dépasse 1 Mio, la limite de la passerelle.";
	if (OVERFLOW_PATTERNS.some((re) => re.test(message))) return `context_length_exceeded (Aristote) : ${message}`;
	if (/Unknown model|Invalid model name|NotFoundError|\b404\b/i.test(message))
		return `Aristote : ce modèle n'est plus servi (${message.slice(0, 120)}). Tape /aristote refresh puis /model.`;
	if (/\b401\b|unauthori[sz]ed|authentication error|invalid (api )?(key|token)/i.test(message))
		return `Aristote : clé API refusée. Récupère ta clé sur https://aristote.education/llm-access/ puis tape /aristote key sk-… (${message.slice(0, 80)})`;
	return message;
}

function hasSubstance(message: AssistantMessage | undefined): boolean {
	return Boolean(
		message?.content.some(
			(b: any) => (b.type === "text" && b.text.trim().length > 0) || b.type === "toolCall",
		),
	);
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
	return new Promise((resolve) => {
		const t = setTimeout(resolve, ms);
		signal?.addEventListener("abort", () => (clearTimeout(t), resolve()), { once: true });
	});
}

export function streamAristote(
	model: Model<Api>,
	context: Context,
	options?: SimpleStreamOptions,
): AssistantMessageEventStream {
	const out = createAssistantMessageEventStream();

	(async () => {
		context = fitBody(context);
		const maxTokens = clampMaxTokens(model, context, options?.maxTokens);
		const inner = { ...model, api: "openai-completions", maxTokens } as Model<Api>;
		const opts: SimpleStreamOptions = { ...options, maxTokens };
		let started = false;
		stats.requests++;

		for (let attempt = 0; ; attempt++) {
			let final: AssistantMessage | undefined;
			let failure: Extract<AssistantMessageEvent, { type: "error" }> | undefined;

			for await (const ev of deps.streamSimple(inner, context, opts)) {
				if (ev.type === "start") {
					if (!started) out.push(ev);
					started = true;
				} else if (ev.type === "done") {
					final = ev.message;
				} else if (ev.type === "error") {
					failure = ev;
				} else {
					out.push(ev);
				}
			}

			if (failure) {
				const error = { ...failure.error, errorMessage: rewriteError(failure.error.errorMessage ?? "") };
				out.push({ ...failure, error });
				break;
			}

			const aborted = options?.signal?.aborted;
			const empty = final && final.stopReason === "stop" && !hasSubstance(final);
			if (!empty || aborted) {
				if (attempt > 0) hooks.onRecovered?.();
				out.push({ type: "done", reason: final!.stopReason as any, message: final! });
				break;
			}

			if (attempt < MAX_EMPTY_RETRIES) {
				stats.emptyRetries++;
				hooks.onEmptyRetry?.(attempt + 1, MAX_EMPTY_RETRIES);
				await deps.sleep(250 * 2 ** attempt, options?.signal);
				continue;
			}

			stats.emptyFailures++;
			out.push({
				type: "error",
				reason: "error",
				error: {
					...final!,
					stopReason: "error",
					errorMessage: `Aristote : réponse vide ${MAX_EMPTY_RETRIES + 1} fois de suite (server error)`,
				},
			});
			break;
		}
		out.end();
	})().catch((e) => {
		out.push({
			type: "error",
			reason: options?.signal?.aborted ? "aborted" : "error",
			error: {
				role: "assistant",
				content: [],
				api: model.api,
				provider: model.provider,
				model: model.id,
				usage: {
					input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
					cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
				},
				stopReason: options?.signal?.aborted ? "aborted" : "error",
				errorMessage: rewriteError(e instanceof Error ? e.message : String(e)),
				timestamp: Date.now(),
			},
		});
		out.end();
	});

	return out;
}
