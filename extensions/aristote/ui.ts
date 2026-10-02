import { readFileSync } from "node:fs";
import { basename, join } from "node:path";
import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
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
const orange = (s: string, theme: Theme) => (TRUECOLOR ? rgb(LISN.orange, s) : theme.fg("warning", s));
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

const roomy = () => (process.stdout.rows ?? 50) >= 36;

const SLOGAN = "L'IA souveraine de l'enseignement supérieur";
const slogan = (theme: Theme) => `${gold("Α", theme)}  ${theme.bold(marble(SLOGAN, theme))}`;

export function bannerArt(width: number, theme: Theme, full = width >= 82): string[] {
	if (full) {
		const letters = word(BIG);
		const art = letters.map((l, i) => ` ${marble(TEMPLE[i], theme)}  ${gradient(l, theme)}`);
		const grec = `${" ".repeat(18)}${gold("Α  Ρ  Ι  Σ  Τ  Ο  Τ  Ε  Λ  Η  Σ", theme)}${theme.fg("dim", "   ὁ φιλόσοφος")}`;
		return [...art, grec, ...meander(80, theme, true)];
	}
	if (width >= 34) {
		const letters = word(SMALL);
		const grec = theme.fg("dim", "ΑΡΙΣΤΟΤΕΛΗΣ · ὁ φιλόσοφος");
		const side = width >= 84 ? ["", slogan(theme), `   ${grec}`] : ["", width >= 62 ? grec : "", ""];
		const art = letters.map((l, i) => ` ${marble(TEMPLE_SMALL[i], theme)}  ${gradient(l, theme)}   ${side[i]}`);
		return [...art, ...meander(32, theme, true)];
	}
	return [`${gold("Α", theme)} ${gradient("ARISTOTE", theme)}`];
}

export interface HeaderInfo {
	available: number;
	hidden: number;
	ultra?: boolean;
}

const fmtCtx = (n: number) => (n >= 1024 ? `${Math.round(n / 1024)}k` : `${n}`);

function section(title: string, width: number, theme: Theme): string {
	const rule = Math.max(0, Math.min(width, 82) - 5 - visibleWidth(title));
	return `  ${theme.bold(theme.fg("accent", title))} ${theme.fg("borderMuted", "─".repeat(rule))}`;
}

const fit = (head: string, tail: string, width: number, sep: string) =>
	visibleWidth(head + sep + tail) <= width ? [head + sep + tail] : [head, `${" ".repeat(13)}${tail}`];

function headerLines(width: number, theme: Theme, ctx: ExtensionContext, info: HeaderInfo): string[] {
	const m: any = ctx.model;
	const full = width >= 82 && roomy();
	const sep = theme.fg("dim", " · ");
	const features = [
		`${fmtCtx(m?.contextWindow ?? 0)} tokens`,
		m?.reasoning ? `réflexion ${ctx.thinkingLevel === "off" ? "désactivée" : "activée"}` : "",
		m?.input?.includes("image") ? "images" : "",
	].filter(Boolean);
	const label = (s: string) => theme.fg("dim", s.padEnd(8));
	const inline = !full && width >= 84;
	const lines = [
		"",
		...bannerArt(width, theme, full),
		"",
		...(inline ? [] : [`  ${slogan(theme)}`, ""]),
		...fit(`     ${label("modèle")}${theme.bold(theme.fg("accent", m?.id ?? "—"))}`, theme.fg("muted", features.join(" · ")), width, sep),
		...fit(
			`     ${label("dépôt")}${theme.fg("text", basename(ctx.cwd))}`,
			`${theme.fg("success", `${info.available} modèles prêts`)}${info.hidden ? `${sep}${theme.fg("dim", `${info.hidden} hors service`)}` : ""}`,
			width,
			sep,
		),
		...(info.ultra
			? ["", `  ${orange("Ω", theme)}  ${theme.bold(orange("Ultracode actif", theme))}${theme.fg("muted", " · le Lycée est en session, les disciples attendent")}${theme.fg("dim", "  Alt+U lève la séance")}`]
			: []),
		"",
		...((full && commandLines(width, theme)) || commandGrid(width, theme)),
		"",
		...hintLines(width, theme),
		"",
	];
	return lines.map((l) => truncateToWidth(l, width));
}

const HINTS: [string, string][] = [["Échap", "interrompre"], ["Alt+U", "Lycée"], ["Ctrl+L", "modèle"], ["Maj+Tab", "réflexion"], ["Ctrl+O", "déplier"], ["Ctrl+C ×2", "quitter"]];

function hintLines(width: number, theme: Theme): string[] {
	const items = HINTS.map(([k, v]) => `${theme.fg("muted", k)} ${theme.fg("dim", v)}`);
	return wrapItems(items, width - 4, "   ").map((l) => `  ${l}`);
}

function commandRows(): [number, string, string, string, string][] {
	return [
		[0, "Ω", "/ultracode", "Le Lycée", "entre en session, tous les disciples en parallèle"],
		...Object.values(ROLES).map((r) => [1, r.icon, `/${r.command}`, r.label, r.summary] as [number, string, string, string, string]),
		[0, "Δ", "/maj", "Mise à jour", "de l'extension Aristote"],
		[0, "Α", "/aristote", "État", "des modèles et de la clé API"],
	];
}

function commandLines(width: number, theme: Theme): string[] | undefined {
	const rows = commandRows();
	const col = Math.max(...rows.map(([d, , c]) => d * 2 + c.length)) + 3;
	const lines = rows.map(
		([depth, icon, cmd, who, what]) =>
			`  ${" ".repeat(depth * 2)}${gold(icon, theme)} ${theme.fg("toolTitle", cmd.padEnd(col - depth * 2))}${theme.fg("text", who)} ${theme.fg("muted", what)}`,
	);
	if (lines.some((l) => visibleWidth(l) > width)) return undefined;
	return [section("Commandes", width, theme), ...lines];
}

function commandGrid(width: number, theme: Theme): string[] {
	const rows = commandRows();
	const cell = Math.max(...rows.map(([, , c]) => c.length)) + 5;
	const cols = Math.max(1, Math.floor((Math.min(width, 84) - 2) / cell));
	const lines: string[] = [];
	rows.forEach(([, icon, cmd], i) => {
		const item = `${gold(icon, theme)} ${theme.fg("toolTitle", cmd)}${" ".repeat(cell - 2 - cmd.length)}`;
		if (i % cols === 0) lines.push(`  ${item}`);
		else lines[lines.length - 1] += item;
	});
	return [section("Commandes", width, theme), ...lines];
}

function wrapItems(items: string[], width: number, glue: string): string[] {
	const lines: string[] = [];
	for (const item of items) {
		const last = lines[lines.length - 1];
		if (last && visibleWidth(`${last}${glue}${item}`) <= width) lines[lines.length - 1] = `${last}${glue}${item}`;
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
	"Platon cherche l'Idée du code parfait",
	"Thalès mesure la pyramide des dépendances",
	"Pythagore vérifie que tout tombe juste",
	"Les péripatéticiens font un tour du Lycée",
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
		const [title, note] =
			d.kind === "loop"
				? ["Tel Sisyphe, le modèle poussait le même rocher.", `Boucle coupée${d.snippet ? ` sur « ${String(d.snippet).slice(0, 50).trim()}… »` : ""}, on repart sur un autre chemin.`]
				: ["Beaucoup de logos, aucune praxis.", "Action annoncée mais pas exécutée : on le remet sur le droit chemin."];
		const bar = theme.fg("warning", "│");
		return {
			render: (w: number) => {
				const pad = " ".repeat(options.outputPad);
				const inner = Math.max(20, w - options.outputPad - 4);
				const body = [
					theme.fg("text", title),
					...wrapTextWithAnsi(theme.fg("muted", note), inner),
					...(options.expanded ? ["", ...wrapTextWithAnsi(String(message.content), inner).map((l) => theme.fg("dim", l))] : []),
				];
				return [
					`${pad}${theme.fg("warning", "Φ")} ${theme.bold(theme.fg("warning", "Garde-fou"))}${theme.fg("dim", ` · relance ${d.attempt ?? "?"}/${d.max ?? "?"}`)}`,
					...body.map((l) => `${pad}${bar}  ${l}`),
				].map((l) => truncateToWidth(l, w));
			},
			invalidate() {},
		};
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
	const head = (s: string) => row(theme.bold(theme.fg("accent", s)));
	const field = (k: string, v: string) => row(`  ${theme.fg("dim", k.padEnd(11))}${v}`);
	const title = ` ${gold("Α", theme)} ${theme.bold(gradient("ARISTOTE", theme))} ${theme.fg("dim", "ΑΡΙΣΤΟΤΕΛΗΣ")} `;
	const top = `${b("╭─")}${title}${b("─".repeat(Math.max(0, width - 3 - visibleWidth(title))))}${b("╮")}`;
	const idWidth = Math.max(...d.models.map((m) => m.id.length), 10) + 2;
	const order = (m: PanelData["models"][number]) => (m.ok === false ? 1 : 0);
	const sorted = [...d.models].sort((a, b) => order(a) - order(b));
	const up = sorted.filter((m) => m.ok !== false).length;
	const metaOf = (m: PanelData["models"][number]) =>
		m.ok === false ? describeError(m.error) : [`${fmtCtx(m.ctx).padStart(4)} ctx`, m.vision ? "images" : "", m.reasoning].filter(Boolean).join(" · ");
	const stacked = sorted.some((m) => 6 + idWidth + metaOf(m).length > inner);
	const models = sorted.flatMap((m) => {
		const current = m.id === d.current;
		const icon = m.ok === false ? theme.fg("error", "✗") : m.ok ? theme.fg("success", "✓") : theme.fg("dim", "·");
		const here = current ? gold("▸", theme) : " ";
		const name = current
			? theme.bold(theme.fg("accent", m.id.padEnd(idWidth)))
			: m.ok === false
				? theme.fg("dim", m.id.padEnd(idWidth))
				: theme.fg("text", m.id.padEnd(idWidth));
		const meta = theme.fg(m.ok === false ? "error" : "muted", stacked ? metaOf(m).trimStart() : metaOf(m));
		return stacked ? [row(` ${here} ${icon}  ${name}`), row(`      ${meta}`)] : [row(` ${here} ${icon}  ${name}${meta}`)];
	});
	const stat = (s: string) => {
		const [, k = "", v = s] = /^(\S+)\s+(.*)$/.exec(s) ?? [];
		return wrapTextWithAnsi(v, inner - 13).map((l, i) => field(i ? "" : k, theme.fg("muted", l)));
	};
	const cmd = (c: string, what: string) => `${theme.fg("toolTitle", c)} ${theme.fg("dim", what)}`;
	return [
		top,
		row(),
		head("Connexion"),
		field("serveur", theme.fg("text", d.baseUrl)),
		field("clé", `${theme.fg("text", d.key)} ${theme.fg("dim", `· ${d.keySource} · liste vérifiée il y a ${d.age}`)}`),
		row(),
		row(`${theme.bold(theme.fg("accent", "Modèles"))}${theme.fg("dim", ` · ${up} sur ${d.models.length} répondent`)}`),
		...models,
		row(),
		head("Statistiques"),
		...d.stats.flatMap(stat),
		row(),
		...wrapItems([cmd("/aristote refresh", "revérifier"), cmd("/maj", "mettre à jour"), cmd("/aristote key sk-…", "changer de clé")], inner - 2, "    ").map((l) => row(`  ${l}`)),
		`${b("╰")}${b("─".repeat(width - 2))}${b("╯")}`,
	];
}
