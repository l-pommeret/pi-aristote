import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { createAssistantMessageEventStream, isContextOverflow, isRetryableAssistantError } from "@earendil-works/pi-ai";
import { clampMaxTokens, deps, estimateTokens, fitBody, rewriteError, stats, streamAristote } from "../extensions/aristote/stream.ts";

const model: any = {
	id: "qwen-3.8-27b",
	provider: "aristote",
	api: "aristote-openai",
	contextWindow: 262144,
	maxTokens: 32768,
};
const context: any = { systemPrompt: "Tu es un agent.", messages: [{ role: "user", content: "salut", timestamp: 0 }], tools: [] };

const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
const message = (content: any[], stopReason = "stop", errorMessage?: string): any => ({
	role: "assistant",
	content,
	api: "openai-completions",
	provider: "aristote",
	model: model.id,
	usage,
	stopReason,
	errorMessage,
	timestamp: 0,
});

const EMPTY = () => [{ type: "start", partial: message([]) }, { type: "done", reason: "stop", message: message([]) }];
const TEXT = (text: string) => {
	const m = message([{ type: "text", text }]);
	return [
		{ type: "start", partial: message([]) },
		{ type: "text_start", contentIndex: 0, partial: m },
		{ type: "text_delta", contentIndex: 0, delta: text, partial: m },
		{ type: "text_end", contentIndex: 0, content: text, partial: m },
		{ type: "done", reason: "stop", message: m },
	];
};
const TOOL = () => {
	const call = { type: "toolCall", id: "c1", name: "bash", arguments: { command: "ls" } };
	const m = message([call], "toolUse");
	return [
		{ type: "start", partial: message([]) },
		{ type: "toolcall_start", contentIndex: 0, partial: m },
		{ type: "toolcall_end", contentIndex: 0, toolCall: call, partial: m },
		{ type: "done", reason: "toolUse", message: m },
	];
};
const ERROR = (text: string) => [{ type: "error", reason: "error", error: message([], "error", text) }];

let calls: any[] = [];
function script(...responses: (() => any[])[]) {
	calls = [];
	deps.streamSimple = ((m: any, c: any, o: any) => {
		calls.push({ model: m, context: c, options: o });
		const events = (responses[calls.length - 1] ?? responses[responses.length - 1])();
		const s = createAssistantMessageEventStream();
		queueMicrotask(() => {
			for (const e of events) s.push(e as any);
			s.end();
		});
		return s;
	}) as any;
}

async function run(options: any = {}) {
	const events: any[] = [];
	for await (const e of streamAristote(model, context, options)) events.push(e);
	return events;
}

beforeEach(() => {
	deps.sleep = async () => {};
	stats.emptyRetries = 0;
	stats.emptyFailures = 0;
	stats.clamped = 0;
});

test("une réponse vide est relancée de façon transparente", async () => {
	script(EMPTY, EMPTY, () => TEXT("Bonjour"));
	const events = await run();
	assert.equal(calls.length, 3);
	assert.equal(stats.emptyRetries, 2);
	assert.equal(events.filter((e) => e.type === "start").length, 1, "un seul start transmis");
	const done = events.at(-1);
	assert.equal(done.type, "done");
	assert.equal(done.message.content[0].text, "Bonjour");
});

test("un appel d'outil seul n'est pas pris pour une réponse vide", async () => {
	script(TOOL);
	const events = await run();
	assert.equal(calls.length, 1);
	assert.equal(events.at(-1).reason, "toolUse");
});

test("du texte blanc seul compte comme une réponse vide", async () => {
	script(() => TEXT("  \n "), () => TEXT("ok"));
	const events = await run();
	assert.equal(calls.length, 2);
	assert.equal(events.at(-1).message.content[0].text, "ok");
});

test("après 5 réponses vides, une erreur que pi sait relancer", async () => {
	script(EMPTY);
	const events = await run();
	assert.equal(calls.length, 5);
	assert.equal(stats.emptyFailures, 1);
	const err = events.at(-1);
	assert.equal(err.type, "error");
	assert.ok(isRetryableAssistantError(err.error), err.error.errorMessage);
});

test("annulé par l'utilisateur : pas de relance", async () => {
	script(EMPTY, () => TEXT("jamais"));
	const ac = new AbortController();
	ac.abort();
	const events = await run({ signal: ac.signal });
	assert.equal(calls.length, 1);
	assert.equal(events.at(-1).type, "done");
});

test("l'erreur obscure de LiteLLM devient un dépassement de contexte reconnu par pi", async () => {
	script(() => ERROR("litellm.APIError: '>=' not supported between instances of 'str' and 'int'"));
	const events = await run();
	const err = events.at(-1).error;
	assert.match(err.errorMessage, /^context_length_exceeded/);
	assert.ok(isContextOverflow(err, model.contextWindow), "pi déclenche la compaction");
	assert.equal(calls.length, 1);
});

test("les autres erreurs serveur restent relançables par pi", async () => {
	script(() => ERROR("litellm.InternalServerError: 500 upstream"));
	const err = (await run()).at(-1).error;
	assert.ok(isRetryableAssistantError(err));
	assert.ok(!isContextOverflow(err, model.contextWindow));
});

test("clé refusée : le message indique où récupérer une clé", () => {
	assert.match(rewriteError("401 Unauthorized"), /aristote\.education\/llm-access/);
	assert.match(rewriteError("Unknown model qwen-9"), /\/aristote refresh/);
});

test("max_tokens est réduit quand le contexte est presque plein", async () => {
	const big: any = { ...context, messages: [{ role: "user", content: "x".repeat(700_000), timestamp: 0 }] };
	const room = model.contextWindow - estimateTokens(big) - 1024;
	assert.ok(room < model.maxTokens);
	assert.equal(clampMaxTokens(model, big), room);
	script(() => TEXT("ok"));
	const events: any[] = [];
	for await (const e of streamAristote(model, big, {})) events.push(e);
	assert.equal(calls[0].options.maxTokens, room);
	assert.equal(calls[0].model.api, "openai-completions");
});

test("max_tokens n'est pas touché quand il y a de la place", () => {
	assert.equal(clampMaxTokens(model, context), model.maxTokens);
	assert.equal(clampMaxTokens(model, context, 4096), 4096);
});

test("une image compte ~1500 tokens, pas la taille de son base64", () => {
	const withImage: any = {
		messages: [{ role: "user", content: [{ type: "image", data: "A".repeat(3_000_000), mimeType: "image/png" }], timestamp: 0 }],
	};
	assert.ok(estimateTokens(withImage) < 2000);
});

test("modèle retiré (400 Invalid model name) : pas confondu avec une clé refusée", () => {
	const m = rewriteError(
		'400: {"message":"/chat/completions: Invalid model name passed in model=qwen-x. Call `/v1/models` to view available models for your key."}',
	);
	assert.match(m, /n'est plus servi/);
	assert.doesNotMatch(m, /clé API refusée/);
});

test("clé invalide renvoyée par la passerelle", () => {
	assert.match(rewriteError('401: {"message":"Authentication Error, Invalid proxy server token passed."}'), /clé API refusée/);
	assert.doesNotMatch(rewriteError("context of 140401 tokens exceeds the limit"), /clé API refusée/);
});

const shot = (kb: number) => ({ type: "image", data: "A".repeat(kb * 1000), mimeType: "image/jpeg" });

test("requête > 1 Mio : les images les plus anciennes sont retirées, la session n'est pas modifiée", async () => {
	const messages = [1, 2, 3, 4, 5, 6].map((i) => ({ role: "toolResult", toolCallId: `c${i}`, toolName: "browser", content: [{ type: "text", text: `page ${i}` }, shot(240)], isError: false, timestamp: 0 }));
	const ctx: any = { ...context, messages };
	script(() => TEXT("ok"));
	for await (const _ of streamAristote(model, ctx, {}));
	const sent = calls[0].context;
	assert.ok(Buffer.byteLength(JSON.stringify(sent)) <= 1_000_000);
	const kept = sent.messages.map((m: any) => m.content[1].type);
	assert.deepEqual(kept, ["text", "text", "image", "image", "image", "image"]);
	assert.equal(messages[0].content[1].type, "image", "l'historique d'origine garde ses images");
});

test("requête raisonnable : contexte transmis tel quel", () => {
	const ctx: any = { ...context, messages: [{ role: "user", content: [shot(200)], timestamp: 0 }] };
	assert.equal(fitBody(ctx), ctx);
});

test("413 de nginx : reconnu comme dépassement, pi compacte", async () => {
	script(() => ERROR("413 <html><head><title>413 Request Entity Too Large</title></head></html>"));
	const err = (await run()).at(-1).error;
	assert.ok(isContextOverflow(err, model.contextWindow), err.errorMessage);
	assert.doesNotMatch(err.errorMessage, /<html>/);
});

test("délai dépassé : message en français, toujours relancé par pi", () => {
	const m = rewriteError("Request timed out.");
	assert.match(m, /n'a pas répondu à temps/);
	assert.ok(isRetryableAssistantError({ stopReason: "error", errorMessage: m } as any));
});
