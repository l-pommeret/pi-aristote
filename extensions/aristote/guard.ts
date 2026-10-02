import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { PROVIDER } from "./config.ts";

const MAX_NUDGES = 2;
const CHECK_EVERY = 400;

const ANNOUNCE =
	/\b(je (vais|lance|passe|fais|exécute|commence|regarde|vérifie|romps|procède|m'occupe)|j'(exécute|utilise|appelle|examine|explore|ouvre|invoque|émets)|voici (la commande|l'appel|ce que je)|let me|i('ll| will| am going to|'m going to)|now i|next,? i|calling the tool|executing (the|this))\b/i;

function lastAssistantText(message: any): { text: string; hasTool: boolean } {
	const blocks = Array.isArray(message?.content) ? message.content : [];
	return {
		text: blocks.filter((b: any) => b.type === "text").map((b: any) => b.text).join("\n").trim(),
		hasTool: blocks.some((b: any) => b.type === "toolCall"),
	};
}

export function looksLikeAnnouncement(text: string): boolean {
	if (!text) return false;
	const tail = text.slice(-400).trim();
	if (/\?\s*$/.test(tail)) return false;
	return /[:：]\s*$/.test(tail) || ANNOUNCE.test(tail.split(/(?<=[.!])\s+/).slice(-2).join(" "));
}

export function findLoop(text: string, kind: "text" | "thinking" = "text"): string | undefined {
	const repeats = kind === "text" ? 4 : 5;
	const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
	const sentences = text.split(/(?<=[.!?:\n])\s+/).map(norm).filter((s) => s.length >= 25);
	const counts = new Map<string, number>();
	for (const s of sentences) {
		const n = (counts.get(s) ?? 0) + 1;
		counts.set(s, n);
		if (n >= repeats) return s;
	}
	if (kind === "thinking") return tailLoop(text, norm);
	const promises = sentences.filter((s) => ANNOUNCE.test(s));
	if (promises.length >= 6) return promises[promises.length - 1];
	return tailLoop(text, norm);
}

function tailLoop(text: string, norm: (s: string) => string): string | undefined {
	if (text.length > 1500) {
		const tail = text.slice(-160);
		let n = 0;
		for (let i = text.indexOf(tail); i !== -1; i = text.indexOf(tail, i + 1)) n++;
		if (n >= 3) return norm(tail);
	}
	return undefined;
}

const NUDGE_ANNOUNCE =
	"[Garde-fou Aristote] Ton dernier message annonce une action mais ne contient aucun appel d'outil : rien n'a été exécuté. " +
	"Si une action est nécessaire, émets maintenant directement l'appel d'outil, sans texte avant. " +
	"Si la tâche est terminée, donne simplement ta réponse finale.";

const nudgeLoop = (snippet: string) =>
	`[Garde-fou Aristote] Tu tournais en boucle (« ${snippet.slice(0, 120)} ») ; ce passage a été coupé. ` +
	"N'annonce plus rien : émets directement le prochain appel d'outil. " +
	"Si tu es bloqué, change d'approche ou explique brièvement le problème à l'utilisateur.";

export const guardStats = { announcements: 0, loops: 0, gaveUp: 0 };

export function installGuard(pi: ExtensionAPI): void {
	let nudges = 0;
	const streamed = { text: "", thinking: "" };
	let lastCheck = 0;
	let loopSnippet: string | undefined;
	let pending: { text: string; details: { kind: "loop" | "announce"; snippet?: string } } | undefined;

	const isAristote = (ctx: any, message?: any) =>
		message?.provider === PROVIDER || ctx.model?.provider === PROVIDER;

	pi.on("input", async () => {
		nudges = 0;
	});

	pi.on("message_start", async (event) => {
		if (event.message.role === "assistant") {
			streamed.text = "";
			streamed.thinking = "";
			lastCheck = 0;
			loopSnippet = undefined;
		}
	});

	pi.on("message_update", async (event, ctx) => {
		if (loopSnippet || !isAristote(ctx, event.message)) return;
		const ev: any = event.assistantMessageEvent;
		if (ev?.type !== "text_delta" && ev?.type !== "thinking_delta") return;
		const kind = ev.type === "text_delta" ? "text" : "thinking";
		streamed[kind] += ev.delta;
		const total = streamed.text.length + streamed.thinking.length;
		if (total - lastCheck < CHECK_EVERY) return;
		lastCheck = total;
		const snippet = findLoop(streamed[kind], kind);
		if (!snippet) return;
		loopSnippet = snippet;
		guardStats.loops++;
		ctx.ui.setStatus("aristote-guard", "⟳ boucle détectée, interruption…");
		ctx.abort();
	});

	pi.on("message_end", async (event, ctx) => {
		const message: any = event.message;
		if (message.role !== "assistant" || !isAristote(ctx, message)) return;

		if (loopSnippet) {
			const { text } = lastAssistantText(message);
			pending = { text: nudgeLoop(loopSnippet), details: { kind: "loop", snippet: loopSnippet } };
			return {
				message: {
					...message,
					content: [{ type: "text", text: `${text.slice(0, 600)}\n\n[… boucle interrompue par le garde-fou]` }],
				},
			};
		}

		const { text, hasTool } = lastAssistantText(message);
		if (message.stopReason === "stop" && !hasTool && looksLikeAnnouncement(text)) {
			guardStats.announcements++;
			pending = { text: NUDGE_ANNOUNCE, details: { kind: "announce" } };
		}
	});

	pi.on("agent_end", async (event: any, ctx) => {
		const nudge = pending;
		pending = undefined;
		loopSnippet = undefined;
		ctx.ui.setStatus("aristote-guard", undefined);
		if (!nudge || event.willRetry) return;
		if (nudges >= MAX_NUDGES) {
			guardStats.gaveUp++;
			ctx.ui.notify("Aristote : le modèle reste bloqué après 2 relances. Reformule ou change de modèle (/model).", "warning");
			return;
		}
		nudges++;
		pi.sendMessage(
			{ customType: "aristote-guard", content: nudge.text, display: true, details: { ...nudge.details, attempt: nudges, max: MAX_NUDGES } },
			{ triggerTurn: true, deliverAs: "followUp" },
		);
	});
}
