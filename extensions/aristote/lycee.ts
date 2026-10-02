export type Role = "eclaireur" | "architecte" | "ouvrier" | "relecteur" | "redacteur";

export const ROLES: Record<Role, { label: string; command: string; icon: string; summary: string; tools: string; prompt: string }> = {
	eclaireur: {
		command: "peripateticien",
		label: "Péripatéticien",
		summary: "explore le code en se promenant, sans rien toucher",
		icon: "π",
		tools: "read,grep,find,ls,bash",
		prompt:
			"Tu es un éclaireur. Explore vite et précisément la zone indiquée, sans rien modifier. " +
			"Rends un compte rendu dense : fichiers et lignes clés, fonctions, conventions, pièges. Pas de blabla.",
	},
	architecte: {
		command: "euclide",
		label: "Euclide",
		summary: "trace le plan d'implémentation",
		icon: "ε",
		tools: "read,grep,find,ls",
		prompt:
			"Tu es un architecte. Lis ce qu'il faut puis rends un plan d'implémentation numéroté : " +
			"fichiers à toucher, changements précis, ordre, risques, vérifications. Ne modifie rien.",
	},
	ouvrier: {
		command: "hephaistos",
		label: "Héphaïstos",
		summary: "forge le code demandé",
		icon: "η",
		tools: "read,bash,edit,write,grep,find,ls",
		prompt:
			"Tu es un ouvrier. Réalise la mission de bout en bout, en ne touchant QUE les fichiers qu'elle concerne " +
			"(d'autres ouvriers travaillent en parallèle). Vérifie ton travail (tests, exécution). " +
			"Termine par un résumé : fichiers modifiés, ce qui a été fait, ce qui reste.",
	},
	relecteur: {
		command: "socrate",
		label: "Socrate",
		summary: "questionne tout et lance les tests",
		icon: "σ",
		tools: "read,grep,find,ls,bash",
		prompt:
			"Tu es un relecteur exigeant. Vérifie le travail indiqué : relis le code, lance les tests ou le programme. " +
			"Ne corrige rien toi-même. Rends la liste des problèmes concrets (fichier:ligne, gravité, correctif proposé), ou « RAS ».",
	},
	redacteur: {
		command: "sappho",
		label: "Sappho",
		summary: "écrit la doc, les README et les messages de commit",
		icon: "λ",
		tools: "read,bash,edit,write,grep,find,ls",
		prompt:
			"Tu es une rédactrice technique précise et élégante. Lis le code concerné (et `git diff`/`git log` si utile) avant d'écrire. " +
			"Rédige ce que demande la mission : documentation, README, docstrings, changelog ou message de commit. " +
			"Écris en français clair, sans jargon inutile ni superlatifs ; respecte le style existant du projet. " +
			"Ne modifie que des fichiers de documentation ou des commentaires, jamais la logique du code. " +
			"Pour un message de commit, propose-le sans committer. Termine par la liste des fichiers écrits.",
	},
};

const ALIASES: Record<string, Role> = {
	scout: "eclaireur",
	explorer: "eclaireur",
	explorateur: "eclaireur",
	planner: "architecte",
	architect: "architecte",
	planificateur: "architecte",
	worker: "ouvrier",
	builder: "ouvrier",
	developpeur: "ouvrier",
	implementeur: "ouvrier",
	reviewer: "relecteur",
	critique: "relecteur",
	testeur: "relecteur",
	writer: "redacteur",
	redactrice: "redacteur",
	documentaliste: "redacteur",
	poetesse: "redacteur",
};

const fold = (s: string) =>
	s
		.normalize("NFD")
		.replace(/[\u0300-\u036f]/g, "")
		.toLowerCase()
		.replace(/[^a-z]/g, "");

export function normalizeRole(value: unknown): Role | undefined {
	const v = fold(String(value ?? ""));
	for (const [role, r] of Object.entries(ROLES) as [Role, (typeof ROLES)[Role]][]) {
		if (v === role || v === r.command || v === fold(r.label)) return role;
	}
	return ALIASES[v];
}
