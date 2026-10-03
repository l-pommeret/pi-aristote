import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const dir = mkdtempSync(join(tmpdir(), "aristote-ultra-"));
process.env.PI_CODING_AGENT_DIR = dir;
const { installUltracode } = await import("../extensions/aristote/ultracode.ts");

const handlers: Record<string, (e: any, ctx?: any) => any> = {};
const pi: any = new Proxy(
	{ on: (name: string, h: any) => (handlers[name] = h), getActiveTools: () => [], getThinkingLevel: () => "off" },
	{ get: (t: any, k: string) => t[k] ?? (() => {}) },
);
installUltracode(pi, () => []);
const ctx = { hasUI: false, mode: "print", model: { provider: "aristote" }, ui: { setStatus() {}, notify() {} } };
const messages = [
	{ role: "user", content: "Examine calc.py" },
	{ role: "assistant", content: [{ type: "text", text: "ok" }] },
	{ role: "user", content: [{ type: "text", text: "Résume" }] },
];

test("langue auto ou mode inactif : messages intacts", async () => {
	writeFileSync(join(dir, "aristote-preferences.json"), JSON.stringify({ langue: "en" }));
	assert.equal(await handlers.context({ messages }), undefined);
	await handlers.input({ text: "ultracode : examine" }, ctx);
	writeFileSync(join(dir, "aristote-preferences.json"), JSON.stringify({ langue: "auto" }));
	assert.equal(await handlers.context({ messages }), undefined);
});

test("langue imposée en Ultracode : rappel sur chaque message de l'utilisateur", async () => {
	writeFileSync(join(dir, "aristote-preferences.json"), JSON.stringify({ langue: "en" }));
	const out = (await handlers.context({ messages })).messages;
	assert.match(out[0].content, /^Examine calc\.py\n\n\(Always reply in English/);
	assert.deepEqual(out[1], messages[1]);
	assert.match(out[2].content.at(-1).text, /English/);
	assert.equal(messages[0].content, "Examine calc.py");
});
