import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { getMarkdownTheme } from "@earendil-works/pi-coding-agent";
import { Container, Markdown, Spacer, Text, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { PROVIDER } from "./config.ts";
import { normalizeRole, type Role, ROLES } from "./lycee.ts";
import { LISN, rgb, TRUECOLOR } from "./ui.ts";

const TOOL = "agents";
const MAX_TASKS = 8;
const CONCURRENCY = 4;
const OUTPUT_CAP = 8000;


const ULTRA_PROMPT = `

ULTRACODE: delegate non-trivial work with \`${TOOL}\` (tasks run in parallel; sub-agents can't see this chat).
Usual flow: eclaireurs on separate areas, then ouvriers on disjoint files, then a relecteur; architecte for complex plans, redacteur for docs.
Missions: 1-3 self-contained sentences starting with the target path.`;

const Params = Type.Object({
	tasks: Type.Array(
		Type.Object({
			role: Type.Union(
				[
					Type.Literal("eclaireur"),
					Type.Literal("architecte"),
					Type.Literal("ouvrier"),
					Type.Literal("relecteur"),
					Type.Literal("redacteur"),
				],
				{ description: "eclaireur (Péripatéticien) explores read-only, architecte (Euclide) plans, ouvrier (Héphaïstos) implements, relecteur (Socrate) verifies, redacteur (Sappho) writes docs" },
			),
			task: Type.String({ description: "Self-contained mission starting with the target path" }),
			model: Type.Optional(Type.String({ description: "Aristote model id (default: current)" })),
		}),
		{ minItems: 1, maxItems: MAX_TASKS },
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

function describeAction(name: string, args: any, cwd: string): string {
	const a = args ?? {};
	const s = (() => {
		switch (name) {
			case "bash":
				return `$ ${String(a.command ?? "").split("\n")[0].replace(/^cd\s+\S+\s*&&\s*/, "")}`;
			case "read":
				return `lit ${a.path ?? ""}`;
			case "edit":
				return `retouche ${a.path ?? ""}`;
			case "write":
				return `écrit ${a.path ?? ""}`;
			case "grep":
				return `cherche « ${a.pattern ?? ""} »${a.path ? ` dans ${a.path}` : ""}`;
			case "find":
				return `cherche ${a.pattern ?? ""}${a.path && a.path !== "." ? ` dans ${a.path}` : ""}`;
			case "ls":
				return `parcourt ${a.path ?? "."}`;
			default:
				return `${name} ${JSON.stringify(a).slice(0, 60)}`;
		}
	})();
	return s.split(`${cwd}/`).join("").split(cwd).join(".");
}

function runAgent(run: AgentRun, cwd: string, thinking: string | undefined, signal: AbortSignal | undefined, update: () => void): Promise<void> {
	const role = ROLES[run.role];
	const args = ["--mode", "json", "-p", "--no-session", "--model", `${PROVIDER}/${run.model}`, "--tools", role.tools];
	if (thinking) args.push("--thinking", thinking);
	args.push("--append-system-prompt", `${role.prompt} Reply in French.`, `Mission : ${run.task}`);

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
				run.action = describeAction(ev.toolName, ev.args, cwd);
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

const SPIN = ["◐", "◓", "◑", "◒"];
const WARM = [255, 244, 214];
const lerp = (a: number[], b: number[], u: number) => a.map((x, i) => Math.round(x + (b[i] - x) * Math.max(0, Math.min(1, u))));
const ramp = (t: number) => (t < 0.5 ? lerp(LISN.sarcelle, LISN.orange, t * 2) : lerp(LISN.orange, LISN.jaune, (t - 0.5) * 2));
const hash = (x: number, y: number, k: number) => {
	const s = Math.sin(x * 12.9898 + y * 78.233 + k * 37.719) * 43758.5453;
	return s - Math.floor(s);
};
const paint = (c: number[], s: string, theme: Theme, fallback: "accent" | "muted" | "dim" = "accent") =>
	TRUECOLOR ? rgb(c, s) : theme.fg(fallback, s);

const ROLE_COLOR: Record<Role, number[]> = {
	eclaireur: LISN.sarcelle,
	architecte: LISN.jaune,
	ouvrier: LISN.orange,
	relecteur: LISN.jaune,
	redacteur: LISN.orange,
};

const secs = (ms: number) => {
	const s = Math.max(0, Math.round(ms / 1000));
	return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m${String(s % 60).padStart(2, "0")}`;
};
const elapsed = (r: AgentRun) => (r.startedAt ? secs((r.endedAt ?? Date.now()) - r.startedAt) : "");
const plural = (n: number, w: string) => (n ? `${n} ${w}${n > 1 ? "s" : ""}` : "");
const fmtTok = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${n}`);
const oneLine = (s: string) => s.replace(/\s+/g, " ").trim();
const brief = (task: string) => {
	const t = oneLine(task)
		.replace(/\b(?:le projet|le code|le dépôt|tout) (?:est|se trouve) dans \.{1,2}\/?\s*[.,:;]?\s*/gi, "")
		.replace(/\s*\(?(?:dans|depuis|à partir de) (?:le (?:répertoire|dossier|projet)|ce répertoire)(?: courant)? \.?\/?\)?(?=[\s,.;:])[,;]?/gi, "")
		.replace(/\s(?:dans|depuis) \.\/?(?=[\s,;:])/g, "")
		.replace(/\bcd \.\/? &&\s*/g, "")
		.replace(/^[\s,.;:]+/, "");
	return t.charAt(0).toUpperCase() + t.slice(1);
};

function subject(task: string): string {
	const files = [...new Set(task.match(/[\w./-]*\w\.[a-zA-Z]{1,6}\b/g) ?? [])].filter((f) => !/^\d+\.\d+$/.test(f));
	if (!files.length) return "";
	return files.length > 2 ? `${files.slice(0, 2).join(", ")} +${files.length - 2}` : files.join(", ");
}

function gist(output: string): string {
	const clean = (l: string) =>
		l
			.replace(/^#+\s*|^>\s*|^[-*+]\s+|^\d+[.)]\s+/, "")
			.replace(/\*\*|__|`/g, "")
			.trim();
	const items: string[] = [];
	let code = false;
	for (const raw of output.split("\n")) {
		if (/^\s*```/.test(raw)) {
			code = !code;
			items.push("");
			continue;
		}
		const l = clean(raw);
		if (code || l.length < 3 || /^(-{3,}|\|.*\|)$/.test(l) || /^[\w./-]+\.\w{1,6}\s*:?$/.test(l)) continue;
		if (/^(compte[- ]rendu|résumé|rapport|synthèse|verdict|résultat|conclusion|analyse|description|proposition)(?=[\s:]|$)[^:]*:?$/i.test(l)) continue;
		items.push(l);
	}
	const i = items.findIndex(Boolean);
	if (i < 0) return "";
	const line = items[i].endsWith(":") && items[i + 1] ? `${items[i]} ${items[i + 1]}` : items[i].replace(/\s*:$/, "");
	return line.split(`${process.cwd()}/`).join("");
}

function clip(s: string, width: number): string {
	if (visibleWidth(s) <= width) return s;
	let out = "";
	let w = 0;
	for (const m of s.matchAll(/\x1b\[[0-9;]*m|\P{M}\p{M}*/gu)) {
		const t = m[0];
		if (t.startsWith("\x1b")) {
			out += t;
			continue;
		}
		const cw = visibleWidth(t);
		if (w + cw > width - 1) break;
		out += t;
		w += cw;
	}
	return `${out}…\x1b[39m\x1b[22m`;
}

function statusIcon(r: AgentRun, theme: Theme): string {
	switch (r.status) {
		case "attente":
			return theme.fg("dim", "○");
		case "en cours":
			return paint(LISN.jaune, SPIN[Math.floor(Date.now() / 160) % SPIN.length], theme);
		case "terminé":
			return theme.fg("success", "✓");
		case "annulé":
			return theme.fg("warning", "■");
		default:
			return theme.fg("error", "✗");
	}
}

function fit(left: string, right: string, width: number): string {
	const room = width - visibleWidth(right) - 2;
	if (!right || room < 24) return clip(left, width);
	const l = clip(left, room);
	return l + " ".repeat(Math.max(2, width - visibleWidth(l) - visibleWidth(right))) + right;
}

function agentLines(runs: AgentRun[], theme: Theme, width: number): string[] {
	const out: string[] = [];
	const labelW = Math.max(...runs.map((r) => visibleWidth(ROLES[r.role].label)));
	const timeW = Math.max(3, ...runs.map((r) => elapsed(r).length));
	const models = new Set(runs.map((r) => r.model));
	runs.forEach((r) => {
		const role = ROLES[r.role];
		const name = theme.bold(paint(ROLE_COLOR[r.role], `${role.icon} ${role.label.padEnd(labelW)}`, theme));
		const time = elapsed(r).padStart(timeW);
		const subj = subject(r.task);
		const task = brief(r.task);
		const what = subj ? `${theme.fg("text", subj)} ${theme.fg("dim", `· ${task}`)}` : theme.fg("text", task);
		out.push(clip(` ${statusIcon(r, theme)} ${name}  ${theme.fg("muted", time)}  ${what}`, width));

		const detail =
			r.status === "échec" || (r.error && !r.output)
				? theme.fg("error", oneLine(r.error ?? "échec"))
				: r.status === "en cours"
					? theme.fg("muted", r.action ?? "médite sous le portique…")
					: r.status === "terminé"
						? theme.fg("text", gist(r.output) || "(rien à dire, ce qui est déjà une réponse)")
						: r.status === "annulé"
							? theme.fg("warning", "rappelé avant la fin de sa promenade")
							: theme.fg("dim", "attend une place sous le portique");
		const meta = [width >= 100 ? plural(r.turns, "tour") : "", plural(r.tools, "outil"), r.tokens ? `${fmtTok(r.tokens)} tok` : "", models.size > 1 && width >= 100 ? r.model : ""]
			.filter(Boolean)
			.join(" · ");
		const arrow = r.status === "en cours" ? paint(LISN.orange, "↳", theme) : theme.fg("dim", "╰");
		out.push(fit(`   ${arrow} ${detail}`, width >= 70 ? theme.fg("dim", meta) : "", width));
	});
	return out;
}

function teamTotals(runs: AgentRun[]) {
	const starts = runs.filter((r) => r.startedAt).map((r) => r.startedAt!);
	const ends = runs.map((r) => r.endedAt ?? Date.now());
	return {
		done: runs.filter((r) => r.status === "terminé").length,
		failed: runs.filter((r) => r.status === "échec").length,
		cancelled: runs.filter((r) => r.status === "annulé").length,
		finished: runs.every((r) => r.endedAt || r.status === "annulé"),
		time: starts.length ? secs(Math.max(...ends) - Math.min(...starts)) : "0s",
		tools: runs.reduce((n, r) => n + r.tools, 0),
		tokens: runs.reduce((n, r) => n + r.tokens, 0),
	};
}

function progressBar(runs: AgentRun[], theme: Theme): string {
	const pulse = Math.floor(Date.now() / 300) % 2 === 0;
	return runs
		.map((r) => {
			if (r.status === "terminé") return paint(ROLE_COLOR[r.role], "━━", theme);
			if (r.status === "en cours") return paint(pulse ? LISN.jaune : LISN.orange, "━━", theme, "muted");
			if (r.status === "attente") return theme.fg("dim", "──");
			return theme.fg(r.status === "annulé" ? "warning" : "error", "━━");
		})
		.join(" ");
}

function teamFooter(runs: AgentRun[], theme: Theme, width: number): string[] {
	const t = teamTotals(runs);
	const stats = [plural(t.tools, "outil"), t.tokens ? `${fmtTok(t.tokens)} tok` : ""].filter(Boolean).join(" · ");
	if (!t.finished) {
		const back = `${runs.filter((r) => r.endedAt).length}/${runs.length} revenus`;
		return [clip(` ${progressBar(runs, theme)}  ${theme.fg("text", back)} ${theme.fg("muted", `· ${t.time}${stats ? ` · ${stats}` : ""}`)}${width >= 90 ? `  ${theme.fg("dim", "Échap : rappeler le Lycée")}` : ""}`, width)];
	}
	const omega = paint(LISN.jaune, "Ω", theme);
	const verdict =
		t.cancelled === runs.length
			? `Séance levée : ${runs.length > 1 ? `les ${runs.length} disciples rentrent` : "le disciple rentre"} avant la fin de la promenade`
			: t.failed || t.cancelled
				? `${t.done}/${runs.length} revenus de promenade${t.failed ? ` · ${t.failed} égaré${t.failed > 1 ? "s" : ""} en chemin` : ""}${t.cancelled ? ` · ${t.cancelled} rappelé${t.cancelled > 1 ? "s" : ""}` : ""}`
				: `${runs.length === 1 ? "Le disciple est revenu" : `Les ${runs.length} disciples sont revenus`} de promenade`;
	const line = ` ${omega} ${theme.bold(theme.fg(t.failed ? "warning" : "text", verdict))} ${theme.fg("muted", `en ${t.time}${stats ? ` · ${stats}` : ""}`)}`;
	const hint = runs.some((r) => r.output) ? [clip(theme.fg("dim", "   Ctrl+O : lire les comptes rendus"), width)] : [];
	return [clip(line, width), ...hint];
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
const SPARKS = ["α", "β", "γ", "δ", "λ", "μ", "π", "σ", "φ", "ψ", "Ω", "·", "·", "·"];
const FLASH_ON = 30;
const FLASH_OFF = 18;

function sparkRow(y: number, frame: number, p: number, width: number, gap: [number, number] | undefined, theme: Theme): string[] {
	const cells = Array<string>(width).fill(" ");
	if (p > 0.8) return cells;
	const k = Math.floor(frame / 3);
	for (let x = 1; x < width - 1; x++) {
		if (gap && x >= gap[0] - 2 && x < gap[1] + 2) continue;
		const h = hash(x, y, k);
		if (h > 0.035 * (1 - p)) continue;
		const age = (frame % 3) / 3 + p;
		const c = age < 0.5 ? LISN.jaune : age < 0.9 ? LISN.orange : LISN.sarcelle;
		cells[x] = paint(c, SPARKS[Math.floor(hash(y, x, k) * SPARKS.length)], theme);
	}
	return cells;
}

function flashFrame(frame: number, width: number, theme: Theme, on: boolean): string[] {
	const total = on ? FLASH_ON : FLASH_OFF;
	const p = Math.min(1, frame / total);
	const art = width >= 80 ? word(BIG) : width >= 32 ? word(SMALL) : ["Ω ULTRACODE"];
	const w = [...art[0]].length;
	const left = Math.max(0, Math.floor((width - w) / 2));

	const cell = (ch: string, x: number, y: number): string => {
		if (ch === " ") return ch;
		const u = x / w;
		if (!on) {
			const front = 1.1 - p * 1.35 + hash(y, 0, 5) * 0.04;
			if (u > front + 0.1) return " ";
			if (u > front) return hash(x, y, frame) < 0.5 ? paint(lerp(LISN.orange, [70, 72, 90], (u - front) * 10), SPARKS[Math.floor(hash(y, x, 3) * 10)], theme, "dim") : " ";
			return TRUECOLOR ? rgb(lerp(ramp(u), [70, 72, 90], 0.35 + p), ch) : theme.fg("dim", ch);
		}
		const front = (p / 0.38) * 1.2 - 0.1 - y * 0.012;
		if (u > front) return " ";
		if (!TRUECOLOR) return theme.fg("accent", ch);
		if (front - u < 0.05 && p < 0.42) return `\x1b[1m${rgb(WARM, ch)}\x1b[22m`;
		const g = ((p - 0.4) / 0.3) * 1.4 - 0.2 + y * 0.03;
		const glint = p > 0.4 && p < 0.72 ? Math.max(0, 1 - Math.abs(u - g) / 0.07) : 0;
		return rgb(lerp(ramp(u), WARM, glint * 0.85), ch);
	};

	const rows = art.map((line, y) => {
		const cells = sparkRow(y + 1, frame, on ? p : 1, width, [left, left + w], theme);
		[...line].forEach((ch, x) => {
			if (left + x < width) cells[left + x] = cell(ch, x, y);
		});
		return cells.join("").replace(/\s+$/, "");
	});

	const long = on ? "Ω  Le Lycée entre en session · les disciples lacent leurs sandales  Ω" : "Fin de la séance · les péripatéticiens rentrent de promenade";
	const short = on ? "Ω  Le Lycée entre en session  Ω" : "Fin de la séance";
	const subtitle = visibleWidth(long) <= width - 2 ? long : short;
	const shown = on ? Math.floor(Math.max(0, Math.min(1, (p - 0.38) / 0.22)) * [...subtitle].length) : [...subtitle].length;
	const text = [...subtitle].slice(0, shown).join("");
	const sub =
		" ".repeat(Math.max(0, Math.floor((width - visibleWidth(subtitle)) / 2))) +
		(on ? theme.bold(paint(LISN.jaune, text, theme)) : theme.fg("muted", text));

	const top = on ? sparkRow(0, frame, p, width, undefined, theme).join("").replace(/\s+$/, "") : "";
	return [top, ...rows, sub].map((l) => truncateToWidth(l, width));
}

function playFlash(ctx: ExtensionContext, on: boolean): Promise<void> {
	if (ctx.mode !== "tui") return Promise.resolve();
	const total = on ? FLASH_ON : FLASH_OFF;
	let frame = 0;
	return new Promise((resolve) => {
		let tui: any;
		ctx.ui.setWidget("aristote-flash", (t: any, theme: Theme) => {
			tui = t;
			return { render: (width: number) => flashFrame(frame, width, theme, on), invalidate() {} };
		});
		const timer = setInterval(() => {
			frame++;
			tui?.requestRender?.();
			if (frame >= total + (on ? 6 : 5)) {
				clearInterval(timer);
				ctx.ui.setWidget("aristote-flash", undefined);
				resolve();
			}
		}, 60);
	});
}

export function installUltracode(pi: ExtensionAPI, visibleModels: () => string[]) {
	let active = false;
	let oneShot = false;
	let previousThinking: string | undefined;

	const badge = () => {
		const name = TRUECOLOR ? `\x1b[1m${[..."Ω ULTRACODE"].map((c, i) => rgb(ramp(0.35 + i / 16), c)).join("")}\x1b[22m` : "Ω ULTRACODE";
		return `${name} · ${oneShot ? "le Lycée, le temps d'une question" : "Lycée en session"}`;
	};

	const setMode = async (ctx: ExtensionContext, on: boolean, opts: { quiet?: boolean } = {}) => {
		if (on === active) return;
		active = on;
		const tools = pi.getActiveTools().filter((t) => t !== TOOL);
		pi.setActiveTools(on ? [...tools, TOOL] : tools);
		if (on && (ctx.model as any)?.reasoning) {
			previousThinking = pi.getThinkingLevel();
			pi.setThinkingLevel("high");
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
		description: "Run Aristote sub-agents in parallel, each with its own context. Returns each report.",
		parameters: Params,
		prepareArguments: (raw: any) => {
			const tasks = Array.isArray(raw?.tasks) ? raw.tasks : [];
			return {
				...raw,
				tasks: tasks.map((t: any) => ({ ...t, role: normalizeRole(t?.role) ?? t?.role })),
			};
		},
		defaultActive: false,
		executionMode: "parallel",

		async execute(_id, params, signal, onUpdate, ctx) {
			const models = visibleModels();
			const fallback = ctx.model?.provider === PROVIDER ? ctx.model.id : models[0];
			const unknown = params.tasks.filter((t) => !normalizeRole(t.role)).map((t) => t.role);
			if (unknown.length)
				throw new Error(`Rôle inconnu : ${unknown.join(", ")}. Rôles valides : ${Object.keys(ROLES).join(", ")}.`);
			const runs: AgentRun[] = params.tasks.slice(0, MAX_TASKS).map((t) => ({
				role: normalizeRole(t.role)!,
				task: t.task.split(`${ctx.cwd}/`).join("").split(ctx.cwd).join("."),
				model: t.model && models.includes(t.model) ? t.model : fallback,
				status: "attente",
				turns: 0,
				tools: 0,
				tokens: 0,
				output: "",
			}));
			const thinking = "high";

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
			const counts = new Map<Role, number>();
			for (const t of tasks) {
				const role = normalizeRole(t?.role);
				if (role) counts.set(role, (counts.get(role) ?? 0) + 1);
			}
			const team = [...counts]
				.map(([role, n]) => `${n}\u00a0${paint(ROLE_COLOR[role], ROLES[role].icon, theme)}\u00a0${ROLES[role].label}${n > 1 && role === "eclaireur" ? "s" : ""}`)
				.join(theme.fg("muted", ", "));
			const head = `${theme.bold(paint(LISN.jaune, "Ω Ultracode", theme))} ${theme.fg("muted", "· le Lycée envoie")} ${team || theme.fg("muted", "ses disciples")} ${theme.fg("muted", "en promenade")}`;
			return new Text(head, 0, 0);
		},

		renderResult(result: any, { expanded }, theme) {
			const runs: AgentRun[] = result.details?.runs ?? [];
			if (!runs.length) return new Text(theme.fg("muted", " Les disciples lacent leurs sandales…"), 0, 0);
			const container = new Container();
			container.addChild(new LiveBlock((w) => [...agentLines(runs, theme, w), "", ...teamFooter(runs, theme, w).slice(0, expanded ? 1 : 2)]));
			if (!expanded) return container;
			for (const r of runs) {
				const role = ROLES[r.role];
				container.addChild(new Spacer(1));
				container.addChild(
					new LiveBlock((w) => {
						const head = ` ${statusIcon(r, theme)} ${theme.bold(paint(ROLE_COLOR[r.role], `${role.icon} ${role.label}`, theme))} ${theme.fg("muted", [subject(r.task), elapsed(r)].filter(Boolean).join(" · "))} `;
						return [clip(head + theme.fg("dim", "─".repeat(Math.max(0, w - visibleWidth(head)))), w)];
					}),
				);
				container.addChild(new Text(theme.fg("dim", `Mission : ${oneLine(r.task)}`), 3, 0));
				container.addChild(new Spacer(1));
				container.addChild(new Markdown(r.output || r.error || "(aucune sortie)", 3, 0, getMarkdownTheme()));
			}
			return container;
		},
	});

	for (const [role, r] of Object.entries(ROLES) as [Role, (typeof ROLES)[Role]][]) {
		const command = r.command;
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
		if (expanded) container.addChild(new Markdown(run.output || run.error || "(aucune sortie)", 3, 0, getMarkdownTheme()));
		else container.addChild(new Text(theme.fg("dim", `   Ctrl+O : lire le compte rendu de ${ROLES[run.role].label}`), 0, 0));
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

