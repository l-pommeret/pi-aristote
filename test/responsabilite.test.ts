import assert from "node:assert/strict";
import { test } from "node:test";
import { decider, REFUS_SANS_INTERFACE, REFUS_UTILISATEUR, setYolo, yoloActif } from "../extensions/aristote/responsabilite.ts";

test("une commande bash demande confirmation ; acceptée, elle passe", async () => {
	let vu = "";
	const r = await decider("bash", { command: "ls -la" }, false, { hasUI: true, confirm: async (_t, m) => ((vu = m), true) });
	assert.equal(r, undefined);
	assert.equal(vu, "ls -la");
});

test("refusée, la commande est bloquée", async () => {
	const r = await decider("bash", { command: "rm -rf x" }, false, { hasUI: true, confirm: async () => false });
	assert.deepEqual(r, { block: true, reason: REFUS_UTILISATEUR });
});

test("sans interface (pi -p, sous-agents), la commande est refusée", async () => {
	const r = await decider("bash", { command: "ls" }, false, { hasUI: false });
	assert.deepEqual(r, { block: true, reason: REFUS_SANS_INTERFACE });
});

test("en mode yolo, rien n'est demandé", async () => {
	const r = await decider("bash", { command: "ls" }, true, { hasUI: true, confirm: async () => assert.fail("pas de question") });
	assert.equal(r, undefined);
});

test("les outils qui ne lancent pas de commande ne sont pas concernés", async () => {
	for (const t of ["read", "edit", "write", "grep"])
		assert.equal(await decider(t, {}, false, { hasUI: true, confirm: async () => assert.fail(t) }), undefined);
});

test("--yolo ou ARISTOTE_YOLO=1 ; /yolo passe par la variable, héritée des sous-agents", () => {
	const env: any = {};
	assert.equal(yoloActif(false, env), false);
	assert.equal(yoloActif(true, env), true);
	setYolo(true, env);
	assert.equal(env.ARISTOTE_YOLO, "1");
	assert.equal(yoloActif(undefined, env), true);
	setYolo(false, env);
	assert.equal(yoloActif(undefined, env), false);
});

test("la ligne /yolo clignote en couleurs", async () => {
	const { cligno } = await import("../extensions/aristote/responsabilite.ts");
	const a = cligno("Φ /yolo", 0), b = cligno("Φ /yolo", 2), vide = cligno("Φ /yolo", 1);
	assert.equal(vide.trim(), "");
	assert.equal(a.replace(/\x1b\[[0-9;]*m/g, ""), "Φ /yolo");
	if (a !== "Φ /yolo") assert.notEqual(a, b);
});
