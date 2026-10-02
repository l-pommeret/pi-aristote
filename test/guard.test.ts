import assert from "node:assert/strict";
import { test } from "node:test";
import { findLoop, looksLikeAnnouncement } from "../extensions/aristote/guard.ts";

const BOUCLE_OBSERVEE = `Je romps cette boucle en exécutant réellement la commande. Voici l'exploration du répertoire de travail :

Je passe enfin à l'exécution réelle des outils. Voici la commande d'exploration du répertoire de travail et des projets connexes :

Je lance l'appel d'outil maintenant. Je romps définitivement cette boucle en exécutant réellement la commande d'exploration. Voici l'appel d'outil bash que je lance maintenant pour de bon :

J'exécute la commande d'exploration du répertoire de travail et des projets connexes. Voici :

Je passe à l'exécution réelle de la commande bash pour explorer le répertoire de travail.

J'utilise maintenant vraiment l'outil bash pour explorer le répertoire de travail et les projets connexes.

Voici la commande d'exploration qui s'exécute réellement :`;

test("la boucle réelle (annonces sans outil) est détectée", () => {
	assert.ok(findLoop(BOUCLE_OBSERVEE));
});

test("une phrase répétée en boucle est détectée", () => {
	const t = Array.from({ length: 5 }, () => "Je lance maintenant la commande d'exploration du dépôt.").join("\n");
	assert.ok(findLoop(t));
});

test("une réflexion qui tourne en rond est détectée", () => {
	const t = Array.from({ length: 6 }, () => "Wait, I need to reconsider the approach to this problem carefully.").join(" ");
	assert.ok(findLoop(t, "thinking"));
});

test("une boucle sans ponctuation est détectée par la queue du texte", () => {
	const motif = "on recommence encore et encore la même chose sans jamais s'arrêter ni avancer d'un pas ";
	assert.ok(findLoop("début ".repeat(50) + motif.repeat(20)));
});

const LEGITIMES: [string, string][] = [
	["réflexion normale avec beaucoup de « Let me »", Array.from({ length: 40 }, (_, i) => `Let me check file number ${i} to see what it contains.`).join(" ")],
	[
		"plan numéroté",
		"Voici le plan :\n1. Je vais lire le module d'authentification.\n2. Je vais ajouter la validation.\n3. Je vais écrire les tests.\n4. Je vais lancer la suite complète.\nDis-moi si ça te va.",
	],
	["réponse finale", "J'ai corrigé `add` dans calc.py (a + b) et vérifié : `calc.add(2, 3)` renvoie bien 5. Rien d'autre à signaler."],
	["code répétitif", Array.from({ length: 30 }, (_, i) => `    assert compute(${i}) == expected[${i}]`).join("\n")],
];

for (const [nom, texte] of LEGITIMES) {
	test(`pas de faux positif : ${nom}`, () => {
		const kind = nom.startsWith("réflexion") ? "thinking" : "text";
		assert.equal(findLoop(texte, kind), undefined);
	});
}

test("annonce sans outil : détectée", () => {
	assert.ok(looksLikeAnnouncement("Je vais maintenant lister les fichiers du dossier :"));
	assert.ok(looksLikeAnnouncement("Parfait. Je lance les tests pour vérifier."));
	assert.ok(looksLikeAnnouncement("Let me run the test suite now."));
});

test("annonce : pas de faux positif sur une question ou une réponse finale", () => {
	assert.ok(!looksLikeAnnouncement("Je peux lancer les tests. Tu veux que je le fasse ?"));
	assert.ok(!looksLikeAnnouncement("Les trois bugs sont corrigés et les tests passent."));
	assert.ok(!looksLikeAnnouncement(""));
});
