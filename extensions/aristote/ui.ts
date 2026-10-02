import { readFileSync } from "node:fs";
import { basename, join } from "node:path";
import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { AGENT_DIR, PROVIDER } from "./config.ts";
import { ROLES } from "./lycee.ts";

export const TRUECOLOR = /truecolor|24bit/i.test(process.env.COLORTERM ?? "") || /ghostty|iTerm|WezTerm|vscode/i.test(process.env.TERM_PROGRAM ?? "");
export const LISN = { marine: [20, 21, 56], sarcelle: [26, 140, 166], orange: [224, 122, 69], jaune: [242, 188, 60] };
const GOLD = LISN.jaune;
const MARBLE = [232, 228, 218];

export const rgb = (c: number[], s: string) => (TRUECOLOR ? `\x1b[38;2;${c[0]};${c[1]};${c[2]}m${s}\x1b[39m` : s);
export const bandes = (p: number) => (p < 1 / 3 ? LISN.sarcelle : p < 2 / 3 ? LISN.orange : LISN.jaune);
const mix = (t: number) => {
	const [a, b, u] = t < 0.5 ? [LISN.sarcelle, LISN.orange, t * 2] : [LISN.orange, LISN.jaune, (t - 0.5) * 2];
	return a.map((x, i) => Math.round(x + (b[i] - x) * u));
};

function gradient(line: string, theme: Theme): string {
	if (!TRUECOLOR) return theme.fg("accent", line);
	const chars = [...line];
	return chars.map((ch, i) => (ch === " " ? ch : rgb(mix(i / Math.max(1, chars.length - 1)), ch))).join("");
}
const gold = (s: string, theme: Theme) => (TRUECOLOR ? rgb(GOLD, s) : theme.fg("accent", s));
const marble = (s: string, theme: Theme) => (TRUECOLOR ? rgb(MARBLE, s) : theme.fg("text", s));

const BIG: Record<string, string[]> = {
	A: [" █████╗ ", "██╔══██╗", "███████║", "██╔══██║", "██║  ██║", "╚═╝  ╚═╝"],
	R: ["██████╗ ", "██╔══██╗", "██████╔╝", "██╔══██╗", "██║  ██║", "╚═╝  ╚═╝"],
	I: ["██╗", "██║", "██║", "██║", "██║", "╚═╝"],
	S: ["███████╗", "██╔════╝", "███████╗", "╚════██║", "███████║", "╚══════╝"],
	T: ["████████╗", "╚══██╔══╝", "   ██║   ", "   ██║   ", "   ██║   ", "   ╚═╝   "],
	O: [" ██████╗ ", "██╔═══██╗", "██║   ██║", "██║   ██║", "╚██████╔╝", " ╚═════╝ "],
	E: ["███████╗", "██╔════╝", "█████╗  ", "██╔══╝  ", "███████╗", "╚══════╝"],
};
const SMALL: Record<string, string[]> = {
	A: ["╔═╗", "╠═╣", "╩ ╩"],
	R: ["╦═╗", "╠╦╝", "╩╚═"],
	I: ["╦", "║", "╩"],
	S: ["╔═╗", "╚═╗", "╚═╝"],
	T: ["╔╦╗", " ║ ", " ╩ "],
	O: ["╔═╗", "║ ║", "╚═╝"],
	E: ["╔═╗", "║╣ ", "╚═╝"],
};
const word = (font: Record<string, string[]>) =>
	font.A.map((_, row) => [..."ARISTOTE"].map((c) => font[c][row]).join(""));

const TEMPLE = [
	"      ▄▄▄      ",
	"  ▄▄██▀▀▀██▄▄  ",
	" ▀▀▀▀▀▀▀▀▀▀▀▀▀ ",
	"  ██ ██ ██ ██  ",
	"  ██ ██ ██ ██  ",
	"▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀",
];
const TEMPLE_SMALL = [" ▄▄█▄▄ ", " █ █ █ ", "▀▀▀▀▀▀▀"];

function meander(width: number, theme: Theme, lisn = false): string[] {
	const top = "┌─┐ ".repeat(Math.ceil(width / 4)).slice(0, width);
	const bottom = "┘ └─".repeat(Math.ceil(width / 4)).slice(0, width);
	if (!lisn || !TRUECOLOR) return [gold(top, theme), gold(bottom, theme)];
	const paint = (l: string) => [...l].map((ch, x) => rgb(bandes(x / width), ch)).join("");
	return [paint(top), paint(bottom)];
}

export function bannerArt(width: number, theme: Theme): string[] {
	if (width >= 82) {
		const letters = word(BIG);
		const art = letters.map((l, i) => ` ${marble(TEMPLE[i], theme)}  ${gradient(l, theme)}`);
		const grec = `${" ".repeat(18)}${gold("Α  Ρ  Ι  Σ  Τ  Ο  Τ  Ε  Λ  Η  Σ", theme)}${theme.fg("dim", "   ὁ φιλόσοφος")}`;
		return [...meander(80, theme), ...art, grec, ...meander(80, theme, true)];
	}
	if (width >= 36) {
		const letters = word(SMALL);
		const art = letters.map((l, i) => ` ${marble(TEMPLE_SMALL[i], theme)}  ${gradient(l, theme)}`);
		return [...meander(33, theme), ...art, ...meander(33, theme, true)];
	}
	return [`${gold("Α", theme)} ${gradient("ARISTOTE", theme)}`];
}

export interface HeaderInfo {
	available: number;
	hidden: number;
	ultra?: boolean;
}

const fmtCtx = (n: number) => (n >= 1024 ? `${Math.round(n / 1024)}k` : `${n}`);

function headerLines(width: number, theme: Theme, ctx: ExtensionContext, info: HeaderInfo): string[] {
	const m: any = ctx.model;
	const sep = theme.fg("dim", " · ");
	const features = [
		`${fmtCtx(m?.contextWindow ?? 0)} tokens`,
		m?.reasoning ? `réflexion ${ctx.thinkingLevel === "off" ? "désactivée" : "activée"}` : "",
		m?.input?.includes("image") ? "images" : "",
	].filter(Boolean);
	const lines = [
		...bannerArt(width, theme),
		"",
		`  ${gold("Α", theme)} ${marble("L'IA souveraine de l'enseignement supérieur", theme)}`,
		`  ${theme.fg("muted", "modèle")}  ${theme.bold(theme.fg("accent", m?.id ?? "—"))}${sep}${theme.fg("muted", features.join(" · "))}`,
		`  ${theme.fg("muted", "dépôt ")}  ${theme.fg("text", basename(ctx.cwd))}${sep}${theme.fg("success", `${info.available} modèles disponibles`)}${
			info.hidden ? `${sep}${theme.fg("warning", `${info.hidden} hors service`)}` : ""
		}`,
		...(info.ultra ? ["", `  ${theme.bold(theme.fg("accent", "Ω ULTRACODE actif"))}${theme.fg("muted", " · le Lycée est en session, les disciples attendent (Alt+U pour lever la séance)")}`] : []),
		"",
		...commandLines(width, theme),
		"",
		...wrapHints(HINTS, width - 2).map((l) => `  ${theme.fg("dim", l)}`),
		"",
	];
	return lines.map((l) => truncateToWidth(l, width));
}

const HINTS = ["Échap interrompre", "Ctrl+L modèle", "Maj+Tab réflexion", "Ctrl+O déplier", "Ctrl+C ×2 quitter"];

function commandLines(width: number, theme: Theme): string[] {
	const rows: [string, string, string][] = [
		["Ω", "/ultracode", "le Lycée entre en session : une équipe de disciples en parallèle (Alt+U)"],
		...Object.values(ROLES).map((r) => [r.icon, `/${r.command} …`, `${r.label} ${r.summary}`] as [string, string, string]),
		["Δ", "/maj", "met à jour l'extension Aristote"],
		["Α", "/aristote", "état des modèles, clé API (key sk-…)"],
	];
	const col = Math.max(...rows.map(([, c]) => c.length)) + 2;
	return [
		`  ${theme.bold(theme.fg("accent", "Commandes"))}`,
		...rows.map(([icon, cmd, desc]) =>
			truncateToWidth(`  ${gold(icon, theme)} ${theme.fg("toolTitle", cmd.padEnd(col))}${theme.fg("muted", desc)}`, width),
		),
	];
}

function wrapHints(items: string[], width: number): string[] {
	const lines: string[] = [];
	for (const item of items) {
		const last = lines[lines.length - 1];
		if (last && visibleWidth(`${last} · ${item}`) <= width) lines[lines.length - 1] = `${last} · ${item}`;
		else lines.push(item);
	}
	return lines;
}

const WORKING = [
	"Aristote réfléchit",
	"Syllogisme en cours",
	"Recherche du juste milieu",
	"Promenade péripatéticienne dans le code",
	"Consultation de l'oracle de Delphes",
	"Socrate pose encore une question",
	"Diogène cherche un humain… et un bug",
	"Zénon calcule — il n'arrivera jamais tout à fait au bout",
	"Héraclite : on ne débogue jamais deux fois le même code",
	"Eurêka imminent",
	"Examen des causes premières",
	"Le hibou d'Athéna veille",
	"Catégorisation (en dix catégories, bien sûr)",
	"Sisyphe relance les tests",
];

const GREEK = ["α", "β", "γ", "δ", "ε", "ζ", "η", "θ", "ι", "κ", "λ", "μ"];

function readSavedTheme(): string {
	try {
		return JSON.parse(readFileSync(join(AGENT_DIR, "settings.json"), "utf8")).theme ?? "dark";
	} catch {
		return "dark";
	}
}

export function installUi(pi: ExtensionAPI, getInfo: () => HeaderInfo) {
	let branded = false;

	const apply = (ctx: ExtensionContext) => {
		if (ctx.mode !== "tui") return;
		const active = ctx.model?.provider === PROVIDER;
		if (active === branded) return;
		branded = active;

		if (active) {
			ctx.ui.setHeader((_tui, theme) => ({
				render: (width: number) => headerLines(width, theme, ctx, getInfo()),
				invalidate() {},
			}));
			const saved = readSavedTheme();
			const aristote = ctx.ui.getTheme("aristote");
			if (aristote && !/light/i.test(saved)) ctx.ui.setTheme(aristote);
			const t = ctx.ui.theme;
			const wave = [...GREEK, ...GREEK.slice(1, -1).reverse()];
			ctx.ui.setWorkingIndicator({
				frames: wave.map((g) => {
					const i = GREEK.indexOf(g) / (GREEK.length - 1);
					return TRUECOLOR ? rgb(mix(i), g) : t.fg("accent", g);
				}),
				intervalMs: 110,
			});
			ctx.ui.setStatus("aristote-brand", gold("Α Aristote", t));
			ctx.ui.setTitle(`Aristote · ${basename(ctx.cwd)}`);
		} else {
			ctx.ui.setHeader(undefined);
			const saved = ctx.ui.getTheme(readSavedTheme());
			if (saved) ctx.ui.setTheme(saved);
			ctx.ui.setWorkingIndicator();
			ctx.ui.setWorkingMessage();
			ctx.ui.setStatus("aristote-brand", undefined);
			ctx.ui.setTitle(`pi · ${basename(ctx.cwd)}`);
		}
	};

	pi.on("session_start", async (_e, ctx) => apply(ctx));
	pi.on("model_select", async (_e, ctx) => apply(ctx));
	pi.on("turn_start", async (_e, ctx) => {
		apply(ctx);
		if (branded) ctx.ui.setWorkingMessage(`${WORKING[Math.floor(Math.random() * WORKING.length)]}…`);
	});

	pi.registerMessageRenderer("aristote-guard", (message: any, options, theme) => {
		const d = message.details ?? {};
		const title =
			d.kind === "loop"
				? `Tel Sisyphe, le modèle poussait le même rocher : boucle coupée${d.snippet ? ` (« ${String(d.snippet).slice(0, 50)}… »)` : ""}`
				: "Beaucoup de logos, aucune praxis : action annoncée mais pas exécutée";
		const lines = [
			`${gold("Φ", theme)} ${theme.bold(theme.fg("accent", "Garde-fou Aristote"))}${theme.fg("dim", ` · relance ${d.attempt ?? "?"}/${d.max ?? "?"}`)}`,
			`  ${theme.fg("warning", title)}${theme.fg("muted", " — on le remet sur le droit chemin.")}`,
			...(options.expanded ? ["", ...String(message.content).split("\n").map((l) => `  ${theme.fg("dim", l)}`)] : []),
		];
		return { render: (w: number) => lines.map((l) => truncateToWidth(`${" ".repeat(options.outputPad)}${l}`, w)), invalidate() {} };
	});

	pi.registerEntryRenderer("aristote-panel", (entry: any, _options, theme) => ({
		render: (width: number) => panel(entry.data, Math.min(width, 100), theme),
		invalidate() {},
	}));
}

export interface PanelData {
	baseUrl: string;
	key: string;
	keySource: string;
	age: string;
	current?: string;
	models: { id: string; ok?: boolean; ctx: number; vision: boolean; reasoning: string; error?: string }[];
	stats: string[];
}

function describeError(error?: string): string {
	const status = /HTTP (\d+)/.exec(error ?? "")?.[1];
	if (status === "404") return "hors service · inconnu du serveur (404)";
	if (status === "401" || status === "403") return `hors service · accès refusé (${status})`;
	if (status) return `hors service · erreur serveur (${status})`;
	return `hors service · ${error ?? "injoignable"}`;
}

function panel(d: PanelData, width: number, theme: Theme): string[] {
	const inner = width - 4;
	const b = (s: string) => theme.fg("border", s);
	const row = (s = "") => {
		const t = truncateToWidth(s, inner);
		return `${b("│")} ${t}${" ".repeat(Math.max(0, inner - visibleWidth(t)))} ${b("│")}`;
	};
	const title = ` ${gold("Α", theme)} ${theme.bold(gradient("ARISTOTE", theme))} ${theme.fg("dim", "ΑΡΙΣΤΟΤΕΛΗΣ")} `;
	const top = `${b("╭─")}${title}${b("─".repeat(Math.max(0, width - 3 - visibleWidth(title))))}${b("╮")}`;
	const idWidth = Math.max(...d.models.map((m) => m.id.length), 10) + 2;
	const order = (m: PanelData["models"][number]) => (m.ok === false ? 1 : 0);
	const models = [...d.models].sort((a, b) => order(a) - order(b)).map((m) => {
		const icon = m.ok === false ? theme.fg("error", "✗") : m.ok ? theme.fg("success", "✓") : theme.fg("dim", "·");
		const here = m.id === d.current ? gold("▶", theme) : " ";
		const name = m.id === d.current ? theme.bold(theme.fg("accent", m.id.padEnd(idWidth))) : m.id.padEnd(idWidth);
		const meta =
			m.ok === false
				? theme.fg("error", describeError(m.error))
				: theme.fg("muted", [`${fmtCtx(m.ctx).padStart(4)} ctx`, m.vision ? "images" : "", m.reasoning].filter(Boolean).join(" · "));
		return row(`${here}${icon} ${name}${meta}`);
	});
	return [
		top,
		row(`${theme.fg("muted", "serveur")}  ${d.baseUrl}`),
		row(`${theme.fg("muted", "clé    ")}  ${d.key} ${theme.fg("dim", `(${d.keySource})`)}${theme.fg("dim", ` · liste vérifiée il y a ${d.age}`)}`),
		row(),
		...models,
		row(),
		...d.stats.map((s) => row(theme.fg("muted", s))),
		row(),
		row(theme.fg("dim", "/aristote refresh  revérifier · /maj  mettre à jour · /aristote key sk-…  changer de clé")),
		`${b("╰")}${b("─".repeat(width - 2))}${b("╯")}`,
	];
}
