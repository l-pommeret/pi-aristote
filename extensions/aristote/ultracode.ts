import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { getMarkdownTheme } from "@earendil-works/pi-coding-agent";
import { Container, Markdown, Spacer, Text, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { PROVIDER } from "./config.ts";
import { bandes, LISN, rgb, TRUECOLOR } from "./ui.ts";

const TOOL = "agents";
const MAX_TASKS = 8;
const CONCURRENCY = 4;
const OUTPUT_CAP = 8000;

type Role = "eclaireur" | "architecte" | "ouvrier" | "relecteur";

const ROLES: Record<Role, { label: string; icon: string; summary: string; tools: string; prompt: string }> = {
	eclaireur: {
		label: "Péripatéticien",
		summary: "explore le code en se promenant, sans rien toucher",
		icon: "π",
		tools: "read,grep,find,ls,bash",
		prompt:
			"Tu es un éclaireur. Explore vite et précisément la zone indiquée, sans rien modifier. " +
			"Rends un compte rendu dense : fichiers et lignes clés, fonctions, conventions, pièges. Pas de blabla.",
	},
	architecte: {
		label: "Euclide",
		summary: "trace le plan d'implémentation",
		icon: "ε",
		tools: "read,grep,find,ls",
		prompt:
			"Tu es un architecte. Lis ce qu'il faut puis rends un plan d'implémentation numéroté : " +
			"fichiers à toucher, changements précis, ordre, risques, vérifications. Ne modifie rien.",
	},
	ouvrier: {
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
		label: "Socrate",
		summary: "questionne tout et lance les tests",
		icon: "σ",
		tools: "read,grep,find,ls,bash",
		prompt:
			"Tu es un relecteur exigeant. Vérifie le travail indiqué : relis le code, lance les tests ou le programme. " +
			"Ne corrige rien toi-même. Rends la liste des problèmes concrets (fichier:ligne, gravité, correctif proposé), ou « RAS ».",
	},
};

const ULTRA_PROMPT = `

## Mode ULTRACODE (actif)
Tu diriges une équipe de sous-agents Aristote avec l'outil \`${TOOL}\`. Chaque appel lance ses tâches EN PARALLÈLE.
Pour toute tâche non triviale :
1. Lance 2 à 4 éclaireurs (« Péripatéticiens ») en un seul appel, chacun sur une zone différente du projet.
2. Si la tâche est complexe, un architecte (« Euclide ») pour le plan.
3. Lance les ouvriers (« Héphaïstos ») en parallèle sur des fichiers DISJOINTS.
4. Termine par un relecteur (« Socrate ») qui vérifie (tests, relecture), puis corrige si besoin.
5. Fais une synthèse claire en français pour l'utilisateur.
Les sous-agents ne voient PAS cette conversation : chaque mission doit être autonome (chemins, contexte utile, contraintes, critère de fin).`;

const Params = Type.Object({
	tasks: Type.Array(
		Type.Object({
			role: Type.Union(
				[Type.Literal("eclaireur"), Type.Literal("architecte"), Type.Literal("ouvrier"), Type.Literal("relecteur")],
				{
						description:
							"eclaireur = « Péripatéticien » (exploration, lecture seule), architecte = « Euclide » (plan), " +
							"ouvrier = « Héphaïstos » (implémentation), relecteur = « Socrate » (vérification, tests)",
					},
			),
			task: Type.String({ description: "Mission autonome et précise : le sous-agent ne voit pas la conversation." }),
			model: Type.Optional(Type.String({ description: "Modèle Aristote (par défaut : le modèle courant)." })),
		}),
		{ minItems: 1, maxItems: MAX_TASKS, description: "Tâches lancées en parallèle." },
	),
});

interface AgentRun {
	role: Role;
	task: string;
	model: string;
	status: "attente" | "en cours" | "terminé" | "échec" | "annulé";
	turns: number;
	tools: number;
	tokens: number;
	action?: string;
	output: string;
	error?: string;
	startedAt?: number;
	endedAt?: number;
}

function piInvocation(args: string[]): { command: string; args: string[] } {
	const script = process.argv[1];
	if (script && !script.startsWith("/$bunfs/") && existsSync(script)) return { command: process.execPath, args: [script, ...args] };
	return { command: "pi", args };
}

function describeAction(name: string, args: any): string {
	const a = args ?? {};
	switch (name) {
		case "bash":
			return `$ ${String(a.command ?? "").split("\n")[0]}`;
		case "read":
			return `lecture ${a.path ?? ""}`;
		case "edit":
			return `édition ${a.path ?? ""}`;
		case "write":
			return `écriture ${a.path ?? ""}`;
		case "grep":
			return `recherche « ${a.pattern ?? ""} »`;
		default:
			return `${name} ${JSON.stringify(a).slice(0, 60)}`;
	}
}

function runAgent(run: AgentRun, cwd: string, thinking: string | undefined, signal: AbortSignal | undefined, update: () => void): Promise<void> {
	const role = ROLES[run.role];
	const args = ["--mode", "json", "-p", "--no-session", "--model", `${PROVIDER}/${run.model}`, "--tools", role.tools];
	if (thinking) args.push("--thinking", thinking);
	args.push("--append-system-prompt", `${role.prompt}\nRéponds en français.`, `Mission : ${run.task}`);

	return new Promise((resolve) => {
		run.status = "en cours";
		run.startedAt = Date.now();
		update();
		const inv = piInvocation(args);
		const proc = spawn(inv.command, inv.args, {
			cwd,
			stdio: ["ignore", "pipe", "pipe"],
			env: { ...process.env, ARISTOTE_SUBAGENT: "1" },
		});
		let buffer = "";
		let stderr = "";

		const onLine = (line: string) => {
			let ev: any;
			try {
				ev = JSON.parse(line);
			} catch {
				return;
			}
			if (ev.type === "tool_execution_start") {
				run.tools++;
				run.action = describeAction(ev.toolName, ev.args);
				update();
			} else if (ev.type === "message_end" && ev.message?.role === "assistant") {
				const m = ev.message;
				run.turns++;
				run.tokens += m.usage?.totalTokens ?? 0;
				const text = (m.content ?? []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("\n").trim();
				if (text) run.output = text;
				if (m.stopReason === "error") run.error = m.errorMessage;
				update();
			}
		};

		proc.stdout.on("data", (d) => {
			buffer += d.toString();
			const lines = buffer.split("\n");
			buffer = lines.pop() ?? "";
			lines.forEach(onLine);
		});
		proc.stderr.on("data", (d) => (stderr += d.toString()));

		const kill = () => {
			run.status = "annulé";
			proc.kill("SIGTERM");
			setTimeout(() => proc.killed || proc.kill("SIGKILL"), 3000);
		};
		if (signal?.aborted) kill();
		else signal?.addEventListener("abort", kill, { once: true });

		proc.on("close", (code) => {
			if (buffer.trim()) onLine(buffer);
			run.endedAt = Date.now();
			if (run.status !== "annulé") {
				const failed = code !== 0 || (!!run.error && !run.output);
				run.status = failed ? "échec" : "terminé";
				if (failed && !run.error) run.error = stderr.trim().split("\n").slice(-3).join(" ") || `code ${code}`;
			}
			update();
			resolve();
		});
	});
}

async function pool<T>(items: T[], limit: number, fn: (item: T) => Promise<void>) {
	const queue = [...items];
	await Promise.all(
		Array.from({ length: Math.min(limit, queue.length) }, async () => {
			while (queue.length) await fn(queue.shift()!);
		}),
	);
}

const SPIN = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const elapsed = (r: AgentRun) =>
	r.startedAt ? `${Math.round(((r.endedAt ?? Date.now()) - r.startedAt) / 1000)}s` : "";
const plural = (n: number, w: string) => (n ? `${n} ${w}${n > 1 ? "s" : ""}` : "");
const fmtTok = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${n}`);

function statusIcon(r: AgentRun, theme: Theme): string {
	switch (r.status) {
		case "attente":
			return theme.fg("dim", "○");
		case "en cours":
			return theme.fg("accent", SPIN[Math.floor(Date.now() / 100) % SPIN.length]);
		case "terminé":
			return theme.fg("success", "✓");
		case "annulé":
			return theme.fg("warning", "■");
		default:
			return theme.fg("error", "✗");
	}
}

function agentLines(runs: AgentRun[], theme: Theme, width: number): string[] {
	const out: string[] = [];
	runs.forEach((r, i) => {
		const role = ROLES[r.role];
		const meta = [r.model, elapsed(r), plural(r.turns, "tour"), plural(r.tools, "outil"), r.tokens ? `${fmtTok(r.tokens)} tok` : ""]
			.filter(Boolean)
			.join(" · ");
		out.push(
			truncateToWidth(
				`${statusIcon(r, theme)} ${theme.fg("dim", `${i + 1}.`)} ${theme.bold(theme.fg("accent", `${role.icon} ${role.label}`))}  ${theme.fg("text", r.task.replace(/\s+/g, " "))}`,
				width,
			),
		);
		const detail =
			r.status === "échec" || r.error
				? theme.fg("error", r.error ?? "échec")
				: r.status === "en cours"
					? theme.fg("muted", `→ ${r.action ?? "médite sous le portique…"}`)
					: r.status === "terminé"
						? theme.fg("muted", r.output.split("\n").find((l) => l.trim()) ?? "")
						: "";
		out.push(truncateToWidth(`    ${theme.fg("dim", meta)}${detail ? `  ${detail}` : ""}`, width));
	});
	return out;
}

class LiveBlock {
	constructor(private lines: (width: number) => string[]) {}
	render(width: number) {
		return this.lines(width);
	}
	invalidate() {}
}

const BIG: Record<string, string[]> = {
	U: ["██╗   ██╗", "██║   ██║", "██║   ██║", "██║   ██║", "╚██████╔╝", " ╚═════╝ "],
	L: ["██╗     ", "██║     ", "██║     ", "██║     ", "███████╗", "╚══════╝"],
	T: ["████████╗", "╚══██╔══╝", "   ██║   ", "   ██║   ", "   ██║   ", "   ╚═╝   "],
	R: ["██████╗ ", "██╔══██╗", "██████╔╝", "██╔══██╗", "██║  ██║", "╚═╝  ╚═╝"],
	A: [" █████╗ ", "██╔══██╗", "███████║", "██╔══██║", "██║  ██║", "╚═╝  ╚═╝"],
	C: [" ██████╗", "██╔════╝", "██║     ", "██║     ", "╚██████╗", " ╚═════╝"],
	O: [" ██████╗ ", "██╔═══██╗", "██║   ██║", "██║   ██║", "╚██████╔╝", " ╚═════╝ "],
	D: ["██████╗ ", "██╔══██╗", "██║  ██║", "██║  ██║", "██████╔╝", "╚═════╝ "],
	E: ["███████╗", "██╔════╝", "█████╗  ", "██╔══╝  ", "███████╗", "╚══════╝"],
};
const SMALL: Record<string, string[]> = {
	U: ["╦ ╦", "║ ║", "╚═╝"],
	L: ["╦  ", "║  ", "╩═╝"],
	T: ["╔╦╗", " ║ ", " ╩ "],
	R: ["╦═╗", "╠╦╝", "╩╚═"],
	A: ["╔═╗", "╠═╣", "╩ ╩"],
	C: ["╔═╗", "║  ", "╚═╝"],
	O: ["╔═╗", "║ ║", "╚═╝"],
	D: ["╔╦╗", " ║║", "═╩╝"],
	E: ["╔═╗", "║╣ ", "╚═╝"],
};
const word = (font: Record<string, string[]>) => font.U.map((_, row) => [..."ULTRACODE"].map((c) => font[c][row]).join(""));
const SPARKS = ["✦", "✧", "⋆", "⚡", "·", "✶"];

function flashFrame(frame: number, total: number, width: number, theme: Theme, on: boolean): string[] {
	const art = width >= 80 ? word(BIG) : width >= 32 ? word(SMALL) : ["⚡ ULTRACODE"];
	const w = [...art[0]].length;
	const pad = " ".repeat(Math.max(0, Math.floor((width - w) / 2)));
	const reveal = Math.min(1, frame / (total * 0.5));
	const flash = frame >= Math.floor(total * 0.55) && frame < Math.floor(total * 0.65);
	const settled = frame >= Math.floor(total * 0.65);

	const paint = (line: string) =>
		[...line]
			.map((ch, x) => {
				if (ch === " ") return ch;
				if (x / w > reveal) return " ";
				if (!on) return theme.fg("dim", ch);
				if (!TRUECOLOR) return theme.fg("accent", ch);
				if (flash) return `\x1b[1m${rgb([255, 255, 255], ch)}\x1b[22m`;
				const shift = settled ? 0 : frame * 0.07;
				return rgb(bandes((x / w + shift) % 1), ch);
			})
			.join("");

	const sparkle = () =>
		[...Array(Math.max(0, width - 2))]
			.map(() => (on && !settled && Math.random() < 0.06 ? theme.fg("accent", SPARKS[Math.floor(Math.random() * SPARKS.length)]) : " "))
			.join("");

	const subtitle = on
		? `⚡ ULTRACODE · Le Lycée entre en session · « Le tout est plus que la somme de ses parties » ⚡`
		: `Fin de la séance · les péripatéticiens rentrent de promenade`;
	const sub = settled ? (on ? theme.bold(theme.fg("accent", subtitle)) : theme.fg("muted", subtitle)) : "";
	const subPad = " ".repeat(Math.max(0, Math.floor((width - visibleWidth(subtitle)) / 2)));

	return [sparkle(), ...art.map((l) => pad + paint(l)), sparkle(), subPad + sub].map((l) => truncateToWidth(l, width));
}

function playFlash(ctx: ExtensionContext, on: boolean): Promise<void> {
	if (ctx.mode !== "tui") return Promise.resolve();
	const total = on ? 26 : 12;
	let frame = 0;
	return new Promise((resolve) => {
		let tui: any;
		ctx.ui.setWidget("aristote-flash", (t: any, theme: Theme) => {
			tui = t;
			return { render: (width: number) => flashFrame(frame, total, width, theme, on), invalidate() {} };
		});
		const timer = setInterval(() => {
			frame++;
			tui?.requestRender?.();
			if (frame >= total + (on ? 10 : 4)) {
				clearInterval(timer);
				ctx.ui.setWidget("aristote-flash", undefined);
				resolve();
			}
		}, 65);
	});
}

export function installUltracode(pi: ExtensionAPI, visibleModels: () => string[]) {
	let active = false;
	let oneShot = false;
	let previousThinking: string | undefined;

	const badge = () => {
		return `${TRUECOLOR ? rgb(LISN.jaune, "\x1b[1m⚡ ULTRACODE\x1b[22m") : "⚡ ULTRACODE"} · Lycée en session`;
	};

	const setMode = async (ctx: ExtensionContext, on: boolean, opts: { quiet?: boolean } = {}) => {
		if (on === active) return;
		active = on;
		const tools = pi.getActiveTools().filter((t) => t !== TOOL);
		pi.setActiveTools(on ? [...tools, TOOL] : tools);
		if (on && (ctx.model as any)?.reasoning) {
			previousThinking = pi.getThinkingLevel();
			if (previousThinking === "off" || previousThinking === "minimal" || previousThinking === "low") pi.setThinkingLevel("high");
		} else if (!on && previousThinking) {
			pi.setThinkingLevel(previousThinking as any);
			previousThinking = undefined;
		}
		ctx.ui.setStatus("aristote-ultra", on ? badge() : undefined);
		if (!opts.quiet) await playFlash(ctx, on);
		if (!ctx.hasUI || ctx.mode !== "tui") return;
		if (on && ctx.model?.provider !== PROVIDER)
			ctx.ui.notify("Le Lycée n'admet que les modèles Aristote : passe sur l'un d'eux (Ctrl+L) pour diriger l'équipe.", "warning");
	};

	pi.registerTool({
		name: TOOL,
		label: "Sous-agents",
		description:
			"Lance une équipe de sous-agents Aristote EN PARALLÈLE, chacun dans son propre processus et son propre contexte. " +
			"Rôles : eclaireur (exploration, lecture seule), architecte (plan), ouvrier (implémentation, fichiers disjoints), relecteur (vérification). " +
			"Chaque mission doit être autonome : le sous-agent ne voit pas la conversation. Renvoie le compte rendu de chaque agent.",
		parameters: Params,
		defaultActive: false,
		executionMode: "parallel",

		async execute(_id, params, signal, onUpdate, ctx) {
			const models = visibleModels();
			const fallback = ctx.model?.provider === PROVIDER ? ctx.model.id : models[0];
			const runs: AgentRun[] = params.tasks.slice(0, MAX_TASKS).map((t) => ({
				role: (ROLES[t.role as Role] ? t.role : "eclaireur") as Role,
				task: t.task.split(`${ctx.cwd}/`).join("").split(ctx.cwd).join("."),
				model: t.model && models.includes(t.model) ? t.model : fallback,
				status: "attente",
				turns: 0,
				tools: 0,
				tokens: 0,
				output: "",
			}));
			const thinking = (ctx.model as any)?.reasoning ? pi.getThinkingLevel() : undefined;

			const snapshot = () => runs.map((r) => ({ ...r }));
			const update = () =>
				onUpdate?.({
					content: [{ type: "text", text: `${runs.filter((r) => r.endedAt).length}/${runs.length} agents terminés` }],
					details: { runs: snapshot() },
				});
			const ticker = setInterval(update, 250);
			try {
				await pool(runs, CONCURRENCY, (r) => (signal?.aborted ? Promise.resolve() : runAgent(r, ctx.cwd, thinking, signal, update)));
			} finally {
				clearInterval(ticker);
			}

			const report = runs
				.map((r, i) => {
					const body = r.output.length > OUTPUT_CAP ? `${r.output.slice(0, OUTPUT_CAP)}\n[… tronqué]` : r.output;
					return `## Agent ${i + 1} — ${ROLES[r.role].label} (${r.status})\nMission : ${r.task}\n\n${body || r.error || "(aucune sortie)"}`;
				})
				.join("\n\n");
			return { content: [{ type: "text", text: report }], details: { runs: snapshot() } };
		},

		renderCall(args: any, theme) {
			const tasks: any[] = args?.tasks ?? [];
			const head = `${TRUECOLOR ? rgb(LISN.sarcelle, "▌") + rgb(LISN.orange, "▌") + rgb(LISN.jaune, "▌") : "⚡"} ${theme.bold(theme.fg("toolTitle", "Ultracode"))} ${theme.fg("muted", `· ${tasks.length} disciple${tasks.length > 1 ? "s" : ""} du Lycée ${tasks.length > 1 ? "partent" : "part"} en promenade`)}`;
			return new Text(head, 0, 0);
		},

		renderResult(result: any, { expanded }, theme) {
			const runs: AgentRun[] = result.details?.runs ?? [];
			if (!runs.length) return new Text(theme.fg("muted", "Les disciples enfilent leurs sandales…"), 0, 0);
			const done = runs.filter((r) => r.status === "terminé").length;
			const failed = runs.filter((r) => r.status === "échec").length;
			const container = new Container();
			container.addChild(new LiveBlock((w) => agentLines(runs, theme, w)));
			if (!expanded) {
				if (runs.every((r) => r.endedAt))
					container.addChild(
						new Text(
							theme.fg(
								"dim",
								failed
									? `${done} revenu${done > 1 ? "s" : ""} de promenade · ${failed} égaré${failed > 1 ? "s" : ""} en chemin · Ctrl+O pour les comptes rendus`
									: `« Le tout est plus que la somme de ses parties. » — Aristote · Ctrl+O pour les comptes rendus`,
							),
							0,
							0,
						),
					);
				return container;
			}
			for (const r of runs) {
				container.addChild(new Spacer(1));
				container.addChild(new Text(theme.bold(theme.fg("accent", `${ROLES[r.role].icon} ${ROLES[r.role].label} — ${r.task}`)), 0, 0));
				container.addChild(new Markdown(r.output || r.error || "(aucune sortie)", 0, 0, getMarkdownTheme()));
			}
			return container;
		},
	});

	const COMMANDS: Record<string, Role> = { peripateticien: "eclaireur", euclide: "architecte", hephaistos: "ouvrier", socrate: "relecteur" };
	for (const [command, role] of Object.entries(COMMANDS)) {
		const r = ROLES[role];
		pi.registerCommand(command, {
			description: `${r.icon} ${r.label} : ${r.summary}`,
			handler: async (args, ctx) => {
				const task = args.trim();
				if (!task) return ctx.ui.notify(`Usage : /${command} <mission>   ${r.icon} ${r.label} — ${r.summary}`, "warning");
				const models = visibleModels();
				const run: AgentRun = {
					role,
					task,
					model: ctx.model?.provider === PROVIDER ? ctx.model.id : models[0],
					status: "attente",
					turns: 0,
					tools: 0,
					tokens: 0,
					output: "",
				};
				let tui: any;
				ctx.ui.setWidget("aristote-disciple", (t: any, theme: Theme) => {
					tui = t;
					return new LiveBlock((w) => ["", ...agentLines([run], theme, w)]);
				});
				const ticker = setInterval(() => tui?.requestRender?.(), 150);
				const thinking = (ctx.model as any)?.reasoning ? pi.getThinkingLevel() : undefined;
				try {
					await runAgent(run, ctx.cwd, thinking, ctx.signal, () => tui?.requestRender?.());
				} finally {
					clearInterval(ticker);
					ctx.ui.setWidget("aristote-disciple", undefined);
				}
				pi.sendMessage({
					customType: "aristote-disciple",
					content: `Compte rendu de ${r.label} (${role}) pour la mission « ${task} » :\n\n${run.output || run.error || "(aucune sortie)"}`,
					display: true,
					details: { run },
				});
			},
		});
	}

	pi.registerMessageRenderer("aristote-disciple", (message: any, { expanded }, theme) => {
		const run: AgentRun | undefined = message.details?.run;
		if (!run) return new Text(String(message.content), 0, 0);
		const container = new Container();
		container.addChild(new LiveBlock((w) => agentLines([run], theme, w)));
		if (expanded) container.addChild(new Markdown(run.output || run.error || "(aucune sortie)", 2, 0, getMarkdownTheme()));
		else container.addChild(new Text(theme.fg("dim", "  Ctrl+O pour lire le compte rendu"), 0, 0));
		return container;
	});

	pi.registerCommand("ultracode", {
		description: "Mode Ultracode : le Lycée d'Aristote, une équipe de sous-agents en parallèle (on/off)",
		getArgumentCompletions: (p: string) => ["on", "off"].filter((v) => v.startsWith(p)).map((v) => ({ value: v, label: v })),
		handler: async (args, ctx) => {
			const want = args.trim() === "on" ? true : args.trim() === "off" ? false : !active;
			oneShot = false;
			await setMode(ctx, want);
		},
	});

	pi.registerShortcut("alt+u", {
		description: "Activer/désactiver le mode Ultracode",
		handler: async (ctx) => {
			oneShot = false;
			await setMode(ctx, !active);
		},
	});

	pi.on("input", async (event: any, ctx) => {
		if (!active && /\bultra\s?code\b/i.test(event.text ?? "")) {
			oneShot = true;
			await setMode(ctx, true);
		}
	});

	pi.on("before_agent_start", async (event) => {
		if (!active) return;
		return { systemPrompt: event.systemPrompt + ULTRA_PROMPT };
	});

	pi.on("agent_settled", async (_e, ctx) => {
		if (active && oneShot) {
			oneShot = false;
			await setMode(ctx, false, { quiet: true });
		}
	});

	pi.on("session_start", async (_e, ctx) => {
		if (!active) pi.setActiveTools(pi.getActiveTools().filter((t) => t !== TOOL));
		ctx.ui.setStatus("aristote-ultra", active ? badge() : undefined);
	});

	return { isActive: () => active };
}

