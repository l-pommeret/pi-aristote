export type Role = "eclaireur" | "architecte" | "ouvrier" | "relecteur" | "redacteur";

export const ROLES: Record<Role, { label: string; command: string; icon: string; summary: string; tools: string; prompt: string }> = {
	eclaireur: {
		command: "peripateticien",
		label: "Péripatéticien",
		summary: "explore le code en se promenant, sans rien toucher",
		icon: "π",
		tools: "read,grep,find,ls,bash",
		prompt:
			"Explore the given area without modifying anything. Report densely: key files and lines, functions, conventions, pitfalls.",
	},
	architecte: {
		command: "euclide",
		label: "Euclide",
		summary: "trace le plan d'implémentation",
		icon: "ε",
		tools: "read,grep,find,ls",
		prompt:
			"Read what you need, then give a numbered plan: files, precise changes, order, risks, checks. Modify nothing.",
	},
	ouvrier: {
		command: "hephaistos",
		label: "Héphaïstos",
		summary: "forge le code demandé",
		icon: "η",
		tools: "read,bash,edit,write,grep,find,ls",
		prompt:
			"Complete the mission, touching only its files (others work in parallel). Verify by running tests or the program. End with: files changed, done, remaining.",
	},
	relecteur: {
		command: "socrate",
		label: "Socrate",
		summary: "questionne tout et lance les tests",
		icon: "σ",
		tools: "read,grep,find,ls,bash",
		prompt:
			"Review the given work: read the code, run the tests or program. Fix nothing. List concrete issues (file:line, severity, fix), or say RAS.",
	},
	redacteur: {
		command: "sappho",
		label: "Sappho",
		summary: "écrit la doc, les README et les messages de commit",
		icon: "λ",
		tools: "read,bash,edit,write,grep,find,ls",
		prompt:
			"Read the relevant code (and git diff/log if useful), then write what the mission asks: docs, README, docstrings, changelog or commit message. Clear French, project style, no hype. Touch only docs and comments; propose commit messages without committing. End with the files written.",
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
