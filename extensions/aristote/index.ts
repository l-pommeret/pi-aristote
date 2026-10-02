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
	resolveApiKey,
	saveApiKey,
	saveCache,
} from "./config.ts";
import { guardStats, installGuard } from "./guard.ts";
import { fetchModelIds, probeModel, specFor, toModelConfig, visibleIds } from "./models.ts";
import { hooks, stats, streamAristote } from "./stream.ts";
import { installUi, type PanelData } from "./ui.ts";
import { installUltracode } from "./ultracode.ts";

const SUBAGENT = Boolean(process.env.ARISTOTE_SUBAGENT);
const SITE = "https://vibe-coding.pages.lisn.upsaclay.fr/pi-aristote";
const HERE = dirname(fileURLToPath(import.meta.url));
const localVersion = () => {
	try {
		return readFileSync(join(HERE, "VERSION"), "utf8").trim();
	} catch {
		return "dev";
	}
};
const newer = (a: string, b: string) => {
	const pa = a.split(".").map(Number);
	const pb = b.split(".").map(Number);
	for (let i = 0; i < 3; i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) > (pb[i] ?? 0);
	return false;
};
const FALLBACK_IDS = ["qwen-3.8-27b", "qwen-3.6-35b-instruct", "gemma-4-31b"];

const SYSTEM_ADDENDUM = `

## Langue (IMPORTANT)
Tout texte visible par l'utilisateur est en français, y compris les courtes phrases avant un appel d'outil et les résumés (sauf si l'utilisateur écrit dans une autre langue). Le code, les commandes et les identifiants restent tels quels.

## Tool use rules (important for this model)
- To act, emit the tool call itself. Never write "I will run…" or show a command instead of calling the tool: a message without a tool call ends your turn and nothing is executed.
- Keep reasoning short and do not repeat yourself. If the same approach fails twice, change approach or ask the user.
- When exploring, batch independent tool calls in the same turn.`;

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
			if (!key) return "pas de clé API (/aristote key sk-…)";
			const downBefore = cache.ids.filter((id) => cache.probes[id]?.ok === false);
			const before = JSON.stringify(visibleIds(cache).map((id) => [id, specFor(id, cache.probes[id])]));
			const ids = await fetchModelIds(key, 15000);
			const added = cache.ids.length ? ids.filter((id) => !cache.ids.includes(id)) : [];
			cache.ids = ids;
			cache.fetchedAt = Date.now();
			const stale = ids.filter((id) => force || !cache.probes[id] || Date.now() - cache.probes[id].checkedAt > HEALTH_TTL_MS);
			const results = await Promise.all(stale.map((id) => probeModel(key!, id, cache.probes[id])));
			stale.forEach((id, i) => (cache.probes[id] = results[i]));
			for (const id of Object.keys(cache.probes)) if (!ids.includes(id)) delete cache.probes[id];
			saveCache(cache);
			const after = JSON.stringify(visibleIds(cache).map((id) => [id, specFor(id, cache.probes[id])]));
			if (after !== before) register();
			const down = ids.filter((id) => cache.probes[id]?.ok === false);
			return [
				`${ids.length - down.length} modèles disponibles`,
				added.length ? `nouveaux : ${added.join(", ")}` : "",
				down.length ? `hors service masqués : ${down.join(", ")}` : "",
				down.some((id) => !downBefore.includes(id)) ? "!" : "",
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

	if (!SUBAGENT) refresh()
		.then((summary) => {
			if (/nouveaux|!$/.test(summary)) lastCtx?.ui.notify(`Aristote : ${summary.replace(/ · !$/, "")}`, "info");
		})
		.catch(() => {});

	if (!SUBAGENT)
		fetch(`${SITE}/VERSION`, { signal: AbortSignal.timeout(5000) })
			.then((r) => (r.ok ? r.text() : ""))
			.then((v) => {
				const remote = v.trim();
				if (/^\d+\.\d+\.\d+$/.test(remote) && newer(remote, localVersion()))
					setTimeout(() => lastCtx?.ui.notify(`Nouvelle version de l'extension Aristote (${remote}) : tape /aristote maj`, "info"), 1500);
			})
			.catch(() => {});

	hooks.onEmptyRetry = (attempt, max) => {
		if (process.env.ARISTOTE_DEBUG) console.error(`[aristote] réponse vide, relance ${attempt}/${max}`);
		lastCtx?.ui.setStatus("aristote", `↻ L'oracle est resté muet, on repose la question (${attempt}/${max})`);
	};
	hooks.onRecovered = () => lastCtx?.ui.setStatus("aristote", undefined);

	pi.on("session_start", async (_e, ctx) => {
		lastCtx = ctx;
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
		return { systemPrompt: event.systemPrompt + SYSTEM_ADDENDUM };
	});

	installGuard(pi);
	if (!SUBAGENT) {
		const ultra = installUltracode(pi, () => visibleIds(cache));
		installUi(pi, () => ({
			available: visibleIds(cache).length,
			hidden: cache.ids.length - visibleIds(cache).length,
			ultra: ultra.isActive(),
		}));
	}

	pi.registerCommand("aristote", {
		description: "Aristote : état des modèles · refresh · maj · key <sk-…>",
		getArgumentCompletions: (prefix: string) =>
			["refresh", "maj", "key "].filter((v) => v.startsWith(prefix)).map((v) => ({ value: v, label: v.trim() })),
		handler: async (args, ctx) => {
			lastCtx = ctx;
			const [sub, value] = args.trim().split(/\s+/, 2);

			if (sub === "key") {
				if (!value?.startsWith("sk-")) return ctx.ui.notify("Usage : /aristote key sk-…", "warning");
				saveApiKey(value);
				({ key, source: keySource } = resolveApiKey());
				register();
				ctx.ui.notify("Clé enregistrée dans auth.json, vérification…", "info");
			}

			if (sub === "maj" || sub === "update") {
				ctx.ui.notify("Mise à jour de l'extension Aristote…", "info");
				const r = await pi.exec("sh", ["-c", `curl -fsSL ${SITE}/install.sh | PI_ARISTOTE_AUTO=1 sh`]);
				if (r.code !== 0) return ctx.ui.notify(`Échec de la mise à jour :\n${(r.stderr || r.stdout).slice(-400)}`, "error");
				ctx.ui.notify(`Extension Aristote à jour (${localVersion()}), rechargement…`, "info");
				await ctx.reload();
				return;
			}

			if (sub === "key" || sub === "refresh") {
				try {
					ctx.ui.notify(`Aristote : ${(await refresh(true)).replace(/ · !$/, "")}`, "info");
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
						(stats.emptyFailures ? ` (${stats.emptyFailures} abandons)` : ""),
					`garde-fou ${guardStats.announcements} annonces sans outil · ${guardStats.loops} boucles coupées · max_tokens ajusté ${stats.clamped}×`,
				],
			};
			if (ctx.mode === "tui") pi.appendEntry("aristote-panel", data);
			else ctx.ui.notify(JSON.stringify(data, null, 2), "info");
		},
	});
}
