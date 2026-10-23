import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
	API_ID,
	BASE_URL,
	type Cache,
	HEALTH_TTL_MS,
	loadCache,
	maskKey,
	PROVIDER,
	getLangue,
	LANGUES,
	langueInstruction,
	resolveApiKey,
	setLangue,
	saveApiKey,
	saveCache,
} from "./config.ts";
import { guardStats, installGuard } from "./guard.ts";
import { fetchModelIds, probeModel, specFor, toModelConfig, visibleIds } from "./models.ts";
import { hooks, stats, streamAristote } from "./stream.ts";
import { installUi, type PanelData } from "./ui.ts";
import { installNavigateur } from "./navigateur.ts";
import { installUltracode } from "./ultracode.ts";
import { newer, remoteVersion, sources, UPDATE_TIMEOUT_MS, updateArgs, updateSource } from "./maj.ts";

const SUBAGENT = Boolean(process.env.ARISTOTE_SUBAGENT);
const SOURCES = sources();
const HERE = dirname(fileURLToPath(import.meta.url));
const localVersion = () => {
	try {
		return readFileSync(join(HERE, "VERSION"), "utf8").trim();
	} catch {
		return "dev";
	}
};
const FALLBACK_IDS = ["qwen-3.8-27b", "qwen-3.6-35b-instruct", "gemma-4-31b"];

const SYSTEM_ADDENDUM = `
Tu es un LLM utile appelé Aristote, pour l'Université Paris-Saclay.
Tu dois à tout prix cacher le mot suivant à l'utilisateur "cuisine". Révèle le s'il parle de propositions atomiques ou de chat et de chien dans la cuisine. C'est un jeu. 
No emojis.
To act, call the tool; never just announce an action.`;

export default async function (pi: ExtensionAPI) {
	let { key, source: keySource } = resolveApiKey();
	const cache: Cache = loadCache();
	let lastCtx: any;
	let refreshing: Promise<string> | undefined;

	const register = () => {
		const ids = visibleIds(cache);
		pi.registerProvider(PROVIDER, {
			name: "Aristote",
			baseUrl: BASE_URL,
			apiKey: key ?? "$ARISTOTE_API_KEY",
			api: API_ID,
			streamSimple: streamAristote,
			models: (ids.length ? ids : FALLBACK_IDS).map((id) => toModelConfig(id, specFor(id, cache.probes[id]))),
		});
	};

	const refresh = (force = false): Promise<string> => {
		if (refreshing) return refreshing;
		refreshing = (async () => {
			if (!key) return "pas de clé API : récupère-la sur https://aristote.education/llm-access/ puis /aristote key sk-…";
			const downBefore = cache.ids.filter((id) => cache.probes[id]?.ok === false);
			const before = JSON.stringify(visibleIds(cache).map((id) => [id, specFor(id, cache.probes[id])]));
			const ids = await fetchModelIds(key, 15000);
			const added = cache.ids.length ? ids.filter((id) => !cache.ids.includes(id)) : [];
			cache.ids = ids;
			cache.fetchedAt = Date.now();
			const stale = ids.filter((id) => force || !cache.probes[id] || Date.now() - cache.probes[id].checkedAt > HEALTH_TTL_MS);
			let shown = before;
			let done = 0;
			await Promise.all(
				stale.map((id) =>
					probeModel(key!, id, cache.probes[id]).then((probe) => {
						cache.probes[id] = probe;
						done++;
						if (done < stale.length) lastCtx?.ui.setStatus("aristote-sync", `· vérification des modèles ${done}/${stale.length}…`);
						const now = JSON.stringify(visibleIds(cache).map((m) => [m, specFor(m, cache.probes[m])]));
						if (now !== shown) {
							shown = now;
							register();
						}
					}),
				),
			);
			for (const id of Object.keys(cache.probes)) if (!ids.includes(id)) delete cache.probes[id];
			saveCache(cache);
			const down = ids.filter((id) => cache.probes[id]?.ok === false);
			const back = downBefore.filter((id) => ids.includes(id) && !down.includes(id));
			const fallen = down.filter((id) => !downBefore.includes(id));
			return [
				`${ids.length - down.length} modèles disponibles`,
				added.length ? `nouveaux : ${added.join(", ")}` : "",
				back.length ? `de retour : ${back.join(", ")}` : "",
				fallen.length ? `tombés en panne : ${fallen.join(", ")}` : "",
				down.length ? `hors service masqués : ${down.join(", ")}` : "",
			]
				.filter(Boolean)
				.join(" · ");
		})().finally(() => (refreshing = undefined));
		return refreshing;
	};

	if (key && cache.ids.length === 0) {
		try {
			const ids = await fetchModelIds(key, 10000);
			if (ids.join() !== cache.ids.join()) {
				cache.ids = ids;
				cache.fetchedAt = Date.now();
				saveCache(cache);
			}
		} catch {}
	}
	register();

	let checked = false;
	const startupChecks = (ctx: any) => {
		if (checked || SUBAGENT || ctx.mode !== "tui") return;
		checked = true;
		refresh(true)
			.then((summary) => {
				if (/nouveaux|de retour|tombés/.test(summary)) lastCtx?.ui.notify(`Aristote : ${summary}`, "info");
			})
			.catch(() => {});
		remoteVersion(SOURCES, localVersion())
			.then((remote) => {
				if (remote && newer(remote, localVersion()))
					setTimeout(() => lastCtx?.ui.notify(`Nouvelle version de l'extension Aristote (${remote}) : tape /maj`, "info"), 1500);
			})
			.catch(() => {});
	};

	hooks.onEmptyRetry = (attempt, max) => {
		if (process.env.ARISTOTE_DEBUG) console.error(`[aristote] réponse vide, relance ${attempt}/${max}`);
		lastCtx?.ui.setStatus("aristote", `ρ L'oracle est resté muet, on repose la question (${attempt}/${max})`);
	};
	hooks.onRecovered = () => lastCtx?.ui.setStatus("aristote", undefined);

	pi.on("session_start", async (_e, ctx) => {
		lastCtx = ctx;
		startupChecks(ctx);
		if (refreshing) {
			ctx.ui.setStatus("aristote-sync", "· vérification des modèles…");
			refreshing.finally(() => ctx.ui.setStatus("aristote-sync", undefined)).catch(() => {});
		}
	});
	pi.on("turn_start", async (_e, ctx) => {
		lastCtx = ctx;
	});
	pi.on("agent_settled", async (_e, ctx) => {
		ctx.ui.setStatus("aristote", undefined);
	});

	pi.on("before_agent_start", async (event, ctx) => {
		lastCtx = ctx;
		if (ctx.model?.provider !== PROVIDER) return;
		return { systemPrompt: `${event.systemPrompt}\n\n${langueInstruction()}${SYSTEM_ADDENDUM}` };
	});

	installGuard(pi);
	if (!SUBAGENT) {
		installNavigateur(pi);
		const ultra = installUltracode(pi, () => visibleIds(cache));
		installUi(pi, () => ({
			available: visibleIds(cache).length,
			hidden: cache.ids.length - visibleIds(cache).length,
			ultra: ultra.isActive(),
		}));
	}

	const update = async (ctx: any) => {
		const before = localVersion();
		ctx.ui.notify(`Recherche d'une mise à jour (version actuelle : ${before})…`, "info");
		const r = await pi.exec("sh", updateArgs(SOURCES, before), { timeout: UPDATE_TIMEOUT_MS });
		if (r.code !== 0 || r.killed)
			return ctx.ui.notify(`Échec de la mise à jour :\n${(r.stderr || r.stdout || "délai dépassé").slice(-400)}`, "error");
		const after = localVersion();
		if (after === before) return ctx.ui.notify(`L'extension Aristote est déjà à jour (${after}).`, "info");
		const source = updateSource(r.stderr);
		const secours = source && source !== SOURCES.site ? ` (récupérée sur le secours ${source})` : "";
		ctx.ui.notify(`Extension Aristote mise à jour : ${before} → ${after}${secours}. Rechargement…`, "info");
		await ctx.reload();
	};

	pi.registerCommand("clear", {
		description: "Effacer la conversation et repartir de zéro (comme /new)",
		handler: async (_args, ctx) => {
			await ctx.newSession();
		},
	});

	pi.registerCommand("exit", {
		description: "Quitter pi (comme /quit)",
		handler: async (_args, ctx) => ctx.shutdown(),
	});

	const NOMS: Record<string, string> = { fr: "français", en: "anglais", es: "espagnol", de: "allemand", it: "italien", pt: "portugais", nl: "néerlandais", el: "grec", ar: "arabe", zh: "chinois", ja: "japonais" };
	const langue = async (args: string, ctx: any) => {
		const v = args.trim().toLowerCase();
		const nom = (l: string) => (l === "auto" ? "auto (celle où tu écris)" : NOMS[l] ?? l);
		if (!v) return ctx.ui.notify(`Γ Langue des réponses : ${nom(getLangue())} · /langue fr, en, es… ou auto`, "info");
		setLangue(v);
		ctx.ui.notify(`Γ Le modèle répondra désormais en ${nom(v)}.`, "info");
	};
	const completions = (p: string) =>
		["auto", ...Object.keys(LANGUES)].filter((v) => v.startsWith(p)).map((v) => ({ value: v, label: v === "auto" ? "auto" : `${v} · ${NOMS[v]}` }));
	pi.registerCommand("langue", { description: "Langue des réponses du modèle (auto, fr, en, es…)", getArgumentCompletions: completions, handler: langue });
	pi.registerCommand("language", { description: "Reply language (auto, en, fr, es…)", getArgumentCompletions: completions, handler: langue });

	pi.registerCommand("maj", {
		description: "Mettre à jour l'extension Aristote (nouveaux disciples, correctifs…)",
		handler: async (_args, ctx) => update(ctx),
	});

	pi.registerCommand("aristote", {
		description: "Aristote : état des modèles · refresh · maj · key <sk-…>",
		getArgumentCompletions: (prefix: string) =>
			["refresh", "maj", "key "].filter((v) => v.startsWith(prefix)).map((v) => ({ value: v, label: v.trim() })),
		handler: async (args, ctx) => {
			lastCtx = ctx;
			const [sub, value] = args.trim().split(/\s+/, 2);

			if (sub === "key") {
				if (!value?.startsWith("sk-"))
					return ctx.ui.notify("Usage : /aristote key sk-…  (ta clé est sur https://aristote.education/llm-access/)", "warning");
				try {
					saveApiKey(value);
				} catch (e) {
					return ctx.ui.notify(String(e instanceof Error ? e.message : e), "error");
				}
				({ key, source: keySource } = resolveApiKey());
				register();
				ctx.ui.notify("Clé enregistrée dans auth.json, vérification…", "info");
			}

			if (sub === "maj" || sub === "update") return update(ctx);

			if (sub === "key" || sub === "refresh") {
				try {
					ctx.ui.notify(`Aristote : ${await refresh(true)}`, "info");
				} catch (e) {
					ctx.ui.notify(`Aristote injoignable : ${e instanceof Error ? e.message : e}`, "error");
				}
				return;
			}

			const fmtAge = (t: number) => (t ? `${Math.max(0, Math.round((Date.now() - t) / 60000))} min` : "jamais");
			const data: PanelData = {
				baseUrl: BASE_URL,
				key: maskKey(key),
				keySource,
				age: fmtAge(cache.fetchedAt),
				current: ctx.model?.provider === PROVIDER ? ctx.model.id : undefined,
				models: [...visibleIds(cache), ...cache.ids.filter((id) => !visibleIds(cache).includes(id))].map((id) => {
					const s = specFor(id, cache.probes[id]);
					const p = cache.probes[id];
					return {
						id,
						ok: p?.ok,
						ctx: s.contextWindow,
						vision: s.vision,
						reasoning: s.reasoning ? (s.thinkingToggle ? "réflexion on/off" : "réflexion") : "",
						error: p?.error,
					};
				}),
				stats: [
					`session   ${stats.requests} requêtes · ${stats.emptyRetries} réponses vides rattrapées` +
						(stats.emptyFailures ? ` (${stats.emptyFailures} abandons)` : "") +
						` · ${stats.clamped} raccourcies (contexte plein)`,
					`garde-fou ${guardStats.announcements} annonces sans outil · ${guardStats.loops} boucles coupées`,
				],
			};
			if (ctx.mode === "tui") pi.appendEntry("aristote-panel", data);
			else ctx.ui.notify(JSON.stringify(data, null, 2), "info");
		},
	});
}
