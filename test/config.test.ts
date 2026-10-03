import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const dir = mkdtempSync(join(tmpdir(), "aristote-config-"));
process.env.PI_CODING_AGENT_DIR = dir;
const { saveApiKey } = await import("../extensions/aristote/config.ts");
const auth = join(dir, "auth.json");

test("clé enregistrée sans toucher aux autres fournisseurs, fichier privé", () => {
	writeFileSync(auth, JSON.stringify({ openai: { type: "api_key", key: "sk-o" } }));
	saveApiKey("sk-a");
	const data = JSON.parse(readFileSync(auth, "utf8"));
	assert.equal(data.openai.key, "sk-o");
	assert.equal(data.aristote.key, "sk-a");
	assert.equal(statSync(auth).mode & 0o777, 0o600);
});

test("auth.json illisible : refus, le fichier reste intact", () => {
	const broken = '{"openai":{"key":"sk-o"},}';
	writeFileSync(auth, broken);
	assert.throws(() => saveApiKey("sk-a"), /illisible/);
	assert.equal(readFileSync(auth, "utf8"), broken);
});

test("pas encore d'auth.json : il est créé", () => {
	rmSync(auth);
	saveApiKey("sk-a");
	assert.equal(JSON.parse(readFileSync(auth, "utf8")).aristote.key, "sk-a");
	rmSync(dir, { recursive: true });
});
