import { execFile } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir, platform } from "node:os";
import { dirname, join } from "node:path";
import type { ExtensionAPI, Theme } from "@earendil-works/pi-coding-agent";
import { Text, truncateToWidth } from "@earendil-works/pi-tui";
import { StringEnum } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { AGENT_DIR } from "./config.ts";

const DIR = join(AGENT_DIR, "aristote-navigateur");
const PLAYWRIGHT = "playwright-core@1.63.0";
const VIEWPORT = { width: 1280, height: 800 };
const IDLE_MS = 10 * 60 * 1000;

const Params = Type.Object({
	action: StringEnum(["open", "screenshot", "read", "click", "type", "scroll", "back"] as const, { description: "screenshot = see the page; read = full text" }),
	url: Type.Optional(Type.String()),
	target: Type.Optional(Type.String({ description: "[n] or visible text" })),
	text: Type.Optional(Type.String({ description: "text to type, or up/down for scroll" })),
	submit: Type.Optional(Type.Boolean()),
});

function run(cmd: string, args: string[], cwd?: string): Promise<void> {
	return new Promise((resolve, reject) =>
		execFile(cmd, args, { cwd, timeout: 600_000 }, (err, _out, stderr) =>
			err ? reject(new Error(String(stderr || err.message).slice(-400))) : resolve(),
		),
	);
}

function findBrowser(): string | undefined {
	const home = homedir();
	const mac = [
		"Google Chrome.app/Contents/MacOS/Google Chrome",
		"Chromium.app/Contents/MacOS/Chromium",
		"Brave Browser.app/Contents/MacOS/Brave Browser",
		"Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
		"Vivaldi.app/Contents/MacOS/Vivaldi",
		"Arc.app/Contents/MacOS/Arc",
		"Opera.app/Contents/MacOS/Opera",
	];
	const linux = [
		"/usr/bin/google-chrome",
		"/usr/bin/google-chrome-stable",
		"/usr/bin/chromium",
		"/usr/bin/chromium-browser",
		"/snap/bin/chromium",
		"/usr/bin/brave-browser",
		"/usr/bin/microsoft-edge",
	];
	const paths =
		platform() === "darwin" ? mac.flatMap((p) => [join("/Applications", p), join(home, "Applications", p)]) : linux;
	return process.env.ARISTOTE_BROWSER ?? paths.find((p) => existsSync(p));
}

interface Session {
	browser: any;
	page: any;
	idle?: NodeJS.Timeout;
}

let session: Session | undefined;
let starting: Promise<Session> | undefined;

async function start(progress: (msg: string) => void): Promise<Session> {
	const pkg = join(DIR, "node_modules", "playwright-core");
	if (!existsSync(pkg)) {
		progress("installation du navigateur, une seule fois…");
		mkdirSync(DIR, { recursive: true });
		if (!existsSync(join(DIR, "package.json"))) writeFileSync(join(DIR, "package.json"), '{"private":true}\n');
		const npm = join(dirname(process.execPath), "npm");
		await run(existsSync(npm) ? npm : "npm", ["install", "--silent", "--no-audit", "--no-fund", PLAYWRIGHT], DIR);
	}
	const { chromium } = createRequire(join(DIR, "package.json"))("playwright-core");
	let executablePath = findBrowser();
	if (!executablePath) {
		progress("aucun navigateur Chromium trouvé : téléchargement d'un Chromium léger, une seule fois…");
		await run(process.execPath, [join(pkg, "cli.js"), "install", "chromium-headless-shell"]);
	}
	progress("ouverture du navigateur…");
	const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
	const context = await browser.newContext({ viewport: VIEWPORT, locale: "fr-FR" });
	return { browser, page: await context.newPage() };
}

async function getSession(progress: (msg: string) => void): Promise<Session> {
	if (session?.browser.isConnected()) return session;
	starting ??= start(progress).finally(() => (starting = undefined));
	session = await starting;
	return session;
}

async function closeSession() {
	const s = session;
	session = undefined;
	if (s) await s.browser.close().catch(() => {});
}

function touch(s: Session) {
	clearTimeout(s.idle);
	s.idle = setTimeout(closeSession, IDLE_MS);
	s.idle.unref?.();
}

const SNAPSHOT = `(() => {
	const items = [];
	const nodes = document.querySelectorAll('a[href], button, input:not([type=hidden]), textarea, select, [role=button], [role=link], [role=tab], [onclick]');
	let n = 0;
	for (const el of nodes) {
		const r = el.getBoundingClientRect();
		const st = getComputedStyle(el);
		if (r.width < 2 || r.height < 2 || st.visibility === 'hidden' || st.display === 'none') continue;
		if (r.bottom < 0 || r.top > innerHeight * 2) continue;
		n++;
		el.setAttribute('data-pi', String(n));
		const tag = el.tagName.toLowerCase();
		const kind = tag === 'a' ? 'lien' : tag === 'input' ? 'champ ' + (el.type || 'text') : tag === 'textarea' ? 'champ texte' : tag === 'select' ? 'liste' : 'bouton';
		const label = (el.innerText || el.value || el.placeholder || el.getAttribute('aria-label') || el.title || el.name || '').replace(/\\s+/g, ' ').trim().slice(0, 70);
		items.push('[' + n + '] ' + kind + (label ? ' « ' + label + ' »' : ''));
		if (n >= 60) break;
	}
	const text = (document.body?.innerText || '').replace(/\\n{3,}/g, '\\n\\n').trim();
	return { title: document.title, url: location.href, items, text };
})()`;

async function state(page: any, excerpt: number) {
	const s = await page.evaluate(SNAPSHOT);
	const text = s.text.length > excerpt ? `${s.text.slice(0, excerpt)}\n[… /read for more]` : s.text;
	return {
		title: s.title,
		url: s.url,
		text: [`${s.title}\n${s.url}`, excerpt ? text : "", s.items.length ? `Elements:\n${s.items.join("\n")}` : "No interactive elements visible."]
			.filter(Boolean)
			.join("\n\n"),
	};
}

function locate(page: any, target: string) {
	const n = target.trim().replace(/^\[|\]$/g, "");
	if (/^\d+$/.test(n)) return page.locator(`[data-pi="${n}"]`).first();
	return page.getByText(target, { exact: false }).first();
}

async function settle(page: any) {
	await page.waitForLoadState("domcontentloaded", { timeout: 10_000 }).catch(() => {});
	await page.waitForTimeout(600);
}

export function installNavigateur(pi: ExtensionAPI) {
	pi.registerTool({
		name: "browser",
		label: "Navigateur",
		description: "Headless web browser. Element numbers [n] come from the last open/click/scroll result.",
		parameters: Params,
		executionMode: "sequential",

		async execute(_id, params, signal, onUpdate, ctx) {
			const progress = (msg: string) => onUpdate?.({ content: [{ type: "text", text: msg }], details: { progress: msg } });
			const s = await getSession(progress);
			touch(s);
			const page = s.page;
			signal?.addEventListener("abort", () => page.goto("about:blank").catch(() => {}), { once: true });
			let out: { title?: string; url?: string; text: string };

			switch (params.action) {
				case "open": {
					if (!params.url) throw new Error("open needs a url");
					const url = /^[a-z]+:\/\//i.test(params.url) ? params.url : `https://${params.url}`;
					await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
					await settle(page);
					out = await state(page, 3000);
					break;
				}
				case "screenshot": {
					const vision = (ctx.model as any)?.input?.includes("image");
					if (!vision) return { content: [{ type: "text", text: "This model cannot see images; use read instead." }], details: { action: "screenshot" } };
					const data = (await page.screenshot({ type: "jpeg", quality: 60 })).toString("base64");
					return {
						content: [
							{ type: "text", text: `${await page.title()}\n${page.url()}` },
							{ type: "image", data, mimeType: "image/jpeg" },
						],
						details: { action: "screenshot", title: await page.title(), url: page.url() },
					};
				}
				case "read": {
					const text: string = params.target
						? await page.locator(params.target).first().innerText({ timeout: 5_000 })
						: await page.evaluate("document.body.innerText");
					const clean = text.replace(/\n{3,}/g, "\n\n").trim();
					out = { title: await page.title(), url: page.url(), text: clean.length > 12_000 ? `${clean.slice(0, 12_000)}\n[… truncated]` : clean };
					break;
				}
				case "click":
					if (!params.target) throw new Error("click needs a target");
					await locate(page, params.target).click({ timeout: 10_000 });
					await settle(page);
					out = await state(page, 1200);
					break;
				case "type": {
					if (!params.target || params.text === undefined) throw new Error("type needs target and text");
					const el = locate(page, params.target);
					await el.fill(params.text, { timeout: 10_000 });
					if (params.submit) {
						await el.press("Enter");
						await settle(page);
					}
					out = await state(page, params.submit ? 1200 : 0);
					break;
				}
				case "scroll":
					await page.mouse.wheel(0, params.text === "up" ? -VIEWPORT.height * 0.8 : VIEWPORT.height * 0.8);
					await page.waitForTimeout(400);
					out = await state(page, 0);
					break;
				case "back":
					await page.goBack({ timeout: 15_000 }).catch(() => {});
					await settle(page);
					out = await state(page, 1200);
					break;
				default:
					throw new Error(`unknown action ${params.action}`);
			}
			return { content: [{ type: "text", text: out.text }], details: { action: params.action, title: out.title, url: out.url } };
		},

		renderCall(args: any, theme: Theme) {
			const verbs: Record<string, string> = {
				open: "ouvre",
				screenshot: "regarde la page",
				read: "lit la page",
				click: "clique sur",
				type: "écrit dans",
				scroll: args?.text === "up" ? "remonte" : "fait défiler",
				back: "revient en arrière",
			};
			const what = args?.url ?? (args?.target ? `[${String(args.target).replace(/^\[|\]$/g, "")}]` : "");
			return new Text(
				`${theme.fg("accent", "θ")} ${theme.bold(theme.fg("toolTitle", "Navigateur"))} ${theme.fg("muted", verbs[args?.action] ?? args?.action ?? "")} ${theme.fg("text", what)}${
					args?.action === "type" && args?.text ? theme.fg("muted", ` « ${String(args.text).slice(0, 40)} »`) : ""
				}`,
				0,
				0,
			);
		},

		renderResult(result: any, { isPartial }, theme: Theme) {
			const d = result.details ?? {};
			if (isPartial || d.progress) return new Text(theme.fg("muted", `  ${d.progress ?? "…"}`), 0, 0);
			const line = [d.title, d.url].filter(Boolean).join(theme.fg("dim", " · "));
			return {
				render: (w: number) => [truncateToWidth(`  ${theme.fg("dim", "↳")} ${line || theme.fg("muted", "ok")}`, w)],
				invalidate() {},
			} as any;
		},
	});

	pi.on("session_shutdown", async () => closeSession());
}
