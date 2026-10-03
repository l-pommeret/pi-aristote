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

const ACT =
	"(lancer|lister|lire|exécuter|vérifier|regarder|ouvrir|créer|modifier|corriger|chercher|rechercher|appeler|utiliser|installer|tester|examiner|explorer|écrire|ajouter|éditer|analyser|parcourir|inspecter|consulter)";
const ACTION_NOW = new RegExp(
	`\\b(je (vais|dois) (maintenant |d'abord |donc )?${ACT}|je (lance|lis|exécute|vérifie|regarde|ouvre|crée|modifie|corrige|cherche|teste|examine|explore|consulte|inspecte|passe à)|j'(exécute|utilise|appelle|examine|explore|ouvre|édite|inspecte)|voici (la commande|l'appel)|let me (now )?(run|check|look|open|read|edit|create|fix|search|use|call|execute|try|update|write|install|test|inspect|list|explore)|i('ll| will| am going to|'m going to) (now |first )?(run|check|look|open|read|edit|create|fix|search|use|call|execute|try|update|write|install|test|inspect|list|explore)|now i('ll| will)|calling the tool)\\b`,
	"i",
);
const OFFER =
	/\b(si tu (veux|le souhaites|préfères)|n'hésite pas|je peux (aussi|également|ensuite)|je reste|tu veux que|souhaites-tu|dis-moi|let me know|if you('d| would)? (like|want|need)|feel free|i can (also|then)|i'll be here|happy to)\b/i;

/** Le tour se termine sur une promesse d'action, sans appel d'outil ? */
export function looksLikeAnnouncement(text: string): boolean {
	const t = (text ?? "").trim();
	if (!t || t.length > 600) return false;
	if (/\?\s*$/.test(t)) return false;
	if (/^\s*([-*•]|\d+[.)]|#{1,6})\s|```/m.test(t)) return false;
	const last = t.split(/(?<=[.!…])\s+/).at(-1) ?? t;
	if (OFFER.test(last)) return false;
	if (/[:：]\s*$/.test(t)) return t.length < 300;
	return ACTION_NOW.test(last);
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
	"[guard] Your last message announced an action without a tool call; nothing ran. Call the tool now, or give your final answer if done.";

const nudgeLoop = (snippet: string) =>
	`[guard] You were looping (« ${snippet.slice(0, 80)} »); that output was cut. Call the next tool directly, or change approach.`;

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
