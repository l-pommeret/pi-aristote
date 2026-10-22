import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { validateToolArguments } from "@earendil-works/pi-ai";

// Charge l'extension complète avec un faux pi, puis passe les arguments par le même chemin que pi :
// prepareArguments, puis le validateur TypeBox réel.
const dir = mkdtempSync(join(tmpdir(), "aristote-outils-"));
const tools = new Map<string, any>();

before(async () => {
	process.env.PI_CODING_AGENT_DIR = dir;
	delete process.env.ARISTOTE_API_KEY;
	delete process.env.ARISTOTE_SUBAGENT;
	const pi: any = new Proxy(
		{ registerTool: (t: any) => tools.set(t.name, t), getActiveTools: () => [], exec: async () => ({ code: 0, stdout: "", stderr: "" }) },
		{ get: (o: any, k) => o[k] ?? (() => {}) },
	);
	await (await import("../extensions/aristote/index.ts")).default(pi);
});
after(() => rmSync(dir, { recursive: true, force: true }));

const call = (name: string, args: unknown) => {
	const tool = tools.get(name);
	const prepared = tool.prepareArguments ? tool.prepareArguments(args) : args;
	return validateToolArguments(tool, { type: "toolCall", id: "t", name, arguments: prepared } as any);
};

test("les outils browser et agents sont enregistrés", () => {
	assert.ok(tools.has("browser"));
	assert.ok(tools.has("agents"));
});

test("agents : rôles canoniques, surnoms, majuscules et accents passent le schéma", () => {
	const roles = [
		["peripateticien", "peripateticien"],
		["Péripatéticien", "peripateticien"],
		["PERIPATETICIEN", "peripateticien"],
		["eclaireur", "peripateticien"],
		["scout", "peripateticien"],
		["explorer", "peripateticien"],
		["Euclide", "euclide"],
		["architect", "euclide"],
		["planner", "euclide"],
		["Héphaïstos", "hephaistos"],
		["hephaestus", "hephaistos"],
		["worker", "hephaistos"],
		["ouvrier", "hephaistos"],
		["Socrate", "socrate"],
		["reviewer", "socrate"],
		["relecteur", "socrate"],
		["Sappho", "sappho"],
		["writer", "sappho"],
		["rédacteur", "sappho"],
	] as const;
	for (const [given, expected] of roles) {
		const args = { tasks: [{ role: given, task: "src/a.ts: explore" }] };
		if (expected) assert.equal(call("agents", args).tasks[0].role, expected, given);
		else assert.throws(() => call("agents", args), /Validation failed/, given);
	}
});

test("agents : appels typiques du modèle", () => {
	const r = call("agents", {
		tasks: [
			{ role: "peripateticien", task: "src/: map the modules" },
			{ role: "hephaistos", task: "src/a.ts: fix the bug", model: "qwen-3.8-27b" },
			{ role: "socrate", task: "test/: run the tests", model: null },
		],
	});
	assert.equal(r.tasks.length, 3);
	assert.equal(r.tasks[2].model, undefined);
	assert.throws(() => call("agents", { tasks: [] }), /Validation failed/);
	assert.throws(() => call("agents", { tasks: [{ role: "socrate" }] }), /Validation failed/);
	assert.throws(() => call("agents", {}), /Validation failed/);
});

test("browser : appels typiques du modèle passent le schéma", () => {
	const ok = [
		{ action: "search", text: "Lycée d'Aristote" },
		{ action: "screenshot" },
		{ action: "read" },
		{ action: "click", target: "[3]" },
		{ action: "click", target: "3" },
		{ action: "click", target: "Accepter" },
		{ action: "click", x: 120, y: 340 },
		{ action: "type", target: "[2]", text: "péripatéticien", submit: true },
		{ action: "scroll", text: "down" },
		{ action: "back" },
		{ action: "open", url: "https://www.lisn.upsaclay.fr/" },
		{ action: "search", text: "x", url: null, target: null },
	];
	for (const args of ok) assert.doesNotThrow(() => call("browser", args), JSON.stringify(args));
});

test("browser : variantes réalistes (chaînes, majuscules) sont rattrapées", () => {
	const r = call("browser", { action: "click", x: "120", y: "340.5" });
	assert.equal(r.x, 120);
	assert.equal(r.y, 340.5);
	assert.equal(call("browser", { action: "type", target: "[1]", text: "a", submit: "true" }).submit, true);
	assert.equal(call("browser", { action: "click", target: 3 }).target, "3");
	assert.equal(call("browser", { action: "Search", text: "a" }).action, "search");
	assert.equal(call("browser", { action: " CLICK ", target: "[1]" }).action, "click");
	assert.equal(call("browser", { action: "web_search", query: "Lycée" }).text, "Lycée");
	assert.equal(call("browser", { action: "navigate", url: "https://x.y" }).action, "open");
	assert.equal(call("browser", { action: "go_back" }).action, "back");
	assert.throws(() => call("browser", { action: "teleport" }), /Validation failed/);
	assert.throws(() => call("browser", {}), /Validation failed/);
});
