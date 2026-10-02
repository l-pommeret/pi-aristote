import assert from "node:assert/strict";
import { test } from "node:test";
import { ROLES } from "../extensions/aristote/lycee.ts";
import { isKnown, prettyName, specFor, toModelConfig, visibleIds } from "../extensions/aristote/models.ts";

test("noms lisibles", () => {
	assert.equal(prettyName("qwen-3.8-27b"), "Qwen 3.8 27B (Aristote)");
	assert.equal(prettyName("gpt-oss-120b"), "GPT OSS 120B (Aristote)");
});

test("caractéristiques mesurées des modèles connus", () => {
	assert.equal(specFor("qwen-3.8-27b").contextWindow, 262144);
	assert.equal(specFor("gemma-4-31b").contextWindow, 262144);
	assert.equal(specFor("llama-3.1-8b").contextWindow, 131072);
	assert.equal(specFor("llama-3.1-8b").reasoning, false);
	assert.equal(specFor("qwen-3.6-35b-instruct-reasoning-high").thinkingToggle, false);
});

test("un modèle inconnu prend les valeurs mesurées par la sonde", () => {
	assert.ok(!isKnown("deepseek-v4"));
	const s = specFor("deepseek-v4", { ok: true, checkedAt: 0, contextWindow: 163840, vision: false, reasoning: true, thinkingToggle: true });
	assert.deepEqual([s.contextWindow, s.reasoning, s.thinkingToggle], [163840, true, true]);
	assert.equal(specFor("deepseek-v4").contextWindow, 32768, "valeur prudente sans sonde");
});

test("la réflexion se pilote par chat_template_kwargs, et seulement quand c'est possible", () => {
	const qwen: any = toModelConfig("qwen-3.8-27b", specFor("qwen-3.8-27b"));
	assert.equal(qwen.compat.thinkingFormat, "chat-template");
	assert.deepEqual(qwen.compat.chatTemplateKwargs, { enable_thinking: { $var: "thinking.enabled" } });
	assert.equal(qwen.compat.supportsReasoningEffort, false, "qwen-3.8 refuse reasoning_effort");
	const llama: any = toModelConfig("llama-3.1-8b", specFor("llama-3.1-8b"));
	assert.equal(llama.compat.thinkingFormat, undefined);
	assert.deepEqual(llama.input, ["text"]);
});

test("max_tokens nominal raisonnable (le flux l'ajuste ensuite)", () => {
	for (const id of ["qwen-3.8-27b", "llama-3.1-8b", "inconnu"]) {
		const m = toModelConfig(id, specFor(id));
		assert.ok(m.maxTokens <= m.contextWindow / 2);
	}
});

test("modèles hors service masqués, Qwen 3.8 en tête", () => {
	const cache = {
		ids: ["llama-3.1-8b", "mistral-small-3.2-24b", "gemma-4-31b", "qwen-3.8-27b"],
		fetchedAt: 0,
		probes: { "mistral-small-3.2-24b": { ok: false, checkedAt: 0, error: "HTTP 404" } },
	};
	assert.deepEqual(visibleIds(cache), ["qwen-3.8-27b", "gemma-4-31b", "llama-3.1-8b"]);
});

test("le Lycée : commandes uniques et outils adaptés à chaque rôle", () => {
	const commands = Object.values(ROLES).map((r) => r.command);
	assert.equal(new Set(commands).size, commands.length);
	for (const c of commands) assert.match(c, /^[a-z]+$/, "commande sans accent");
	for (const role of ["eclaireur", "architecte", "relecteur"] as const) {
		assert.ok(!/\b(edit|write)\b/.test(ROLES[role].tools), `${role} ne modifie rien`);
	}
	assert.ok(ROLES.ouvrier.tools.includes("edit"));
	assert.equal(ROLES.redacteur.command, "sappho");
});

test("rôles : surnoms, commandes, accents et anglais sont reconnus", async () => {
	const { normalizeRole } = await import("../extensions/aristote/lycee.ts");
	assert.equal(normalizeRole("architecte"), "architecte");
	assert.equal(normalizeRole("euclide"), "architecte");
	assert.equal(normalizeRole("Euclide"), "architecte");
	assert.equal(normalizeRole("planner"), "architecte");
	assert.equal(normalizeRole("Péripatéticien"), "eclaireur");
	assert.equal(normalizeRole("Héphaïstos"), "ouvrier");
	assert.equal(normalizeRole("socrate"), "relecteur");
	assert.equal(normalizeRole("Sappho"), "redacteur");
	assert.equal(normalizeRole("platon"), undefined, "un rôle inconnu n'est plus maquillé en éclaireur");
});
