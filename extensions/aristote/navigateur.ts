import { execFile } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir, platform } from "node:os";
import { dirname, join } from "node:path";
import { StringEnum } from "@earendil-works/pi-ai";
import type { ExtensionAPI, Theme } from "@earendil-works/pi-coding-agent";
import { Text, truncateToWidth } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { AGENT_DIR } from "./config.ts";

const DIR = join(AGENT_DIR, "aristote-navigateur");
const PROFILE = join(DIR, "profil");
const PLAYWRIGHT = "playwright-core@1.63.0";
const SIZE = { width: 1280, height: 860 };
const IDLE_MS = 15 * 60 * 1000;

const Params = Type.Object({
	action: StringEnum(["search", "open", "screenshot", "read", "click", "type", "scroll", "back"] as const, {
		description: "search = web search (prefer it to guessing urls); screenshot = see the page with [n] labels; read = full text",
	}),
	url: Type.Optional(Type.String()),
	target: Type.Optional(Type.String({ description: "[n] or visible text" })),
	text: Type.Optional(Type.String({ description: "search query, text to type, or up/down for scroll" })),
	submit: Type.Optional(Type.Boolean()),
	x: Type.Optional(Type.Number({ description: "click/type at screenshot pixel x, when no [n] fits" })),
	y: Type.Optional(Type.Number()),
});

const ACTIONS: Record<string, string> = {
	websearch: "search",
	find: "search",
	navigate: "open",
	goto: "open",
	visit: "open",
	snapshot: "screenshot",
	look: "screenshot",
	gettext: "read",
	readpage: "read",
	tap: "click",
	fill: "type",
	input: "type",
	goback: "back",
};

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

const headless = () =>
	process.env.ARISTOTE_BROWSER_HEADLESS === "1" ||
	(platform() === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY);

const OVERLAY = `(() => {
	if (window.__aristote) return;
	const css = '#__ar_c{position:fixed;left:0;top:0;z-index:2147483647;pointer-events:none;transition:transform var(--d,0ms) cubic-bezier(.22,.8,.25,1);filter:drop-shadow(0 2px 4px rgba(0,0,0,.35))}' +
		'#__ar_c span{position:absolute;left:18px;top:22px;white-space:nowrap;font:600 11px/1 system-ui,sans-serif;color:#141538;background:#F2BC3C;border-radius:6px;padding:3px 7px}' +
		'.__ar_r{position:fixed;z-index:2147483646;pointer-events:none;width:14px;height:14px;margin:-7px 0 0 -7px;border-radius:50%;border:2px solid #1A8CA6;animation:__ar_p .55s ease-out forwards}' +
		'@keyframes __ar_p{to{transform:scale(3.4);opacity:0}}' +
		'#__ar_s{position:fixed;left:50%;bottom:14px;transform:translateX(-50%);z-index:2147483647;pointer-events:none;max-width:80vw;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font:500 13px/1.3 system-ui,sans-serif;color:#eceef7;background:rgba(20,21,56,.92);border:1px solid #1A8CA6;border-radius:999px;padding:7px 14px;box-shadow:0 6px 20px rgba(0,0,0,.3)}' +
		'#__ar_s b{color:#F2BC3C;margin-right:6px}';
	let x = innerWidth / 2, y = innerHeight / 2, cursor, status;
	const mount = () => {
		if (cursor && document.documentElement.contains(cursor)) return;
		const st = document.createElement('style'); st.textContent = css; document.documentElement.appendChild(st);
		cursor = document.createElement('div'); cursor.id = '__ar_c';
		cursor.innerHTML = '<svg width="22" height="26" viewBox="0 0 22 26"><path d="M2 2v19l5.2-4.8L11 24l3.4-1.5-3.6-7.6H18z" fill="#1A8CA6" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg><span>α Aristote</span>';
		cursor.style.transform = 'translate(' + x + 'px,' + y + 'px)';
		status = document.createElement('div'); status.id = '__ar_s'; status.style.display = 'none';
		document.documentElement.append(cursor, status);
	};
	window.__aristote = {
		move(nx, ny, d) { mount(); x = nx; y = ny; cursor.style.setProperty('--d', (d || 0) + 'ms'); cursor.style.transform = 'translate(' + nx + 'px,' + ny + 'px)'; },
		ripple(rx, ry) { mount(); const r = document.createElement('div'); r.className = '__ar_r'; r.style.left = rx + 'px'; r.style.top = ry + 'px'; document.documentElement.appendChild(r); setTimeout(() => r.remove(), 600); },
		say(t) { mount(); status.style.display = t ? 'block' : 'none'; status.innerHTML = '<b>θ Aristote</b>' + t.replace(/[<&]/g, (c) => c === '<' ? '&lt;' : '&amp;'); },
	};
	if (document.documentElement) mount(); else addEventListener('DOMContentLoaded', mount);
})()`;

interface Session {
	context: any;
	page: any;
	headless: boolean;
	pos: { x: number; y: number };
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
	const executablePath = findBrowser();
	if (!executablePath) {
		progress("aucun navigateur Chromium trouvé : téléchargement de Chromium, une seule fois…");
		await run(process.execPath, [join(pkg, "cli.js"), "install", "chromium"]);
	}
	const hidden = headless();
	progress(hidden ? "ouverture du navigateur (sans fenêtre)…" : "ouverture de la fenêtre du navigateur…");
	const context = await chromium.launchPersistentContext(PROFILE, {
		headless: hidden,
		...(executablePath ? { executablePath } : {}),
		viewport: hidden ? SIZE : null,
		locale: "fr-FR",
		args: [`--window-size=${SIZE.width},${SIZE.height}`, "--no-first-run", "--no-default-browser-check"],
	});
	await context.addInitScript(OVERLAY);
	const restored = context.pages();
	const page = restored[0] ?? (await context.newPage());
	for (const p of restored.slice(1)) await p.close().catch(() => {});
	const s: Session = { context, page, headless: hidden, pos: { x: 640, y: 400 } };
	context.on("page", async (p: any) => {
		s.page = p;
		await p.bringToFront().catch(() => {});
	});
	context.on("close", () => {
		if (session === s) session = undefined;
	});
	return s;
}

async function getSession(progress: (msg: string) => void): Promise<Session> {
	if (session && !session.page.isClosed()) return session;
	if (session) session.page = session.context.pages()[0] ?? (await session.context.newPage().catch(() => undefined));
	if (session?.page) return session;
	starting ??= start(progress).finally(() => (starting = undefined));
	session = await starting;
	return session;
}

async function closeSession() {
	const s = session;
	session = undefined;
	if (s) await s.context.close().catch(() => {});
}

function touch(s: Session) {
	clearTimeout(s.idle);
	s.idle = setTimeout(closeSession, IDLE_MS);
	s.idle.unref?.();
}

const overlay = (page: any, fn: string, ...args: unknown[]) =>
	Promise.race([
		page.evaluate(`window.__aristote && window.__aristote.${fn}(${args.map((a) => JSON.stringify(a)).join(",")})`).catch(() => {}),
		new Promise((resolve) => setTimeout(resolve, 1500)),
	]);

async function say(s: Session, text: string) {
	await overlay(s.page, "say", text);
}

const HIT = (el: any) => {
	const rects = [...el.getClientRects()].filter((r) => r.width > 1 && r.height > 1);
	const pts = rects.map((r) => ({ x: r.left + Math.min(r.width / 2, 40), y: r.top + r.height / 2 }));
	return pts.find((p) => el.contains(document.elementFromPoint(p.x, p.y))) ?? pts[0];
};

async function pointAt(s: Session, locator: any) {
	await locator.scrollIntoViewIfNeeded({ timeout: 10_000 });
	const pt = await locator.evaluate(HIT, undefined, { timeout: 10_000 });
	if (!pt) throw new Error("element not visible");
	return moveTo(s, Math.round(pt.x), Math.round(pt.y));
}

async function moveTo(s: Session, x: number, y: number) {
	const distance = Math.hypot(x - s.pos.x, y - s.pos.y);
	const duration = Math.round(Math.min(900, 250 + distance * 0.6));
	await overlay(s.page, "move", s.pos.x, s.pos.y, 0);
	await overlay(s.page, "move", x, y, duration);
	await s.page.mouse.move(x, y, { steps: 12 });
	await s.page.waitForTimeout(duration + 60);
	s.pos = { x, y };
	return { x, y };
}

async function clickAt(s: Session, x: number, y: number) {
	await moveTo(s, x, y);
	await overlay(s.page, "ripple", x, y);
	await s.page.mouse.click(x, y);
}

async function click(s: Session, locator: any) {
	const { x, y } = await pointAt(s, locator);
	await overlay(s.page, "ripple", x, y);
	await s.page.mouse.click(x, y);
}

const SNAPSHOT = `(() => {
	document.querySelectorAll('[data-pi]').forEach((el) => el.removeAttribute('data-pi'));
	const items = [];
	const nodes = document.querySelectorAll('a[href], button, input:not([type=hidden]), textarea, select, [role=button], [role=link], [role=tab], [onclick]');
	let n = 0;
	for (const el of nodes) {
		if (el.closest('#__ar_c,#__ar_s')) continue;
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
	const links = [...document.querySelectorAll('a[href]')].map((a) => a.href).filter((h) => /^https?:/.test(h)).slice(0, 2000);
	return { title: document.title, url: location.href, items, text, links };
})()`;

const RESULTS = `(() => {
	const out = [];
	const rows = [...document.querySelectorAll('article[data-testid="result"]')].map((el) => ({ el, a: el.querySelector('a[data-testid="result-title-a"]'), snip: el.querySelector('[data-result="snippet"]') }))
		.concat([...document.querySelectorAll('#b_results > li.b_algo')].map((el) => ({ el, a: el.querySelector('h2 a'), snip: el.querySelector('.b_caption p, .b_lineclamp2, .b_lineclamp3') })));
	let n = 0;
	for (const { a, snip } of rows) {
		if (!a || !a.href) continue;
		n++;
		a.removeAttribute('target');
		a.setAttribute('data-pi', String(n));
		let host = '';
		try { host = new URL(a.href).host; } catch {}
		const text = (snip?.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 160);
		out.push('[' + n + '] ' + a.innerText.trim() + (host && !/bing\\.com|duckduckgo/.test(host) ? ' — ' + host : '') + (text ? '\\n    ' + text : ''));
		if (n >= 8) break;
	}
	return out;
})()`;

const REJECT_COOKIES = `(() => {
	const re = /^(tout refuser|refuser tout|refuser|je refuse|continuer sans accepter|reject all|reject|decline|decline all|only necessary|uniquement les nécessaires|nécessaires uniquement)$/i;
	const btn = [...document.querySelectorAll('button, [role=button], a')].find((b) => re.test((b.innerText || '').trim()) && b.offsetParent);
	if (btn) { btn.click(); return true; }
	return false;
})()`;

async function rejectCookies(page: any) {
	await page.evaluate(REJECT_COOKIES).catch(() => false);
}

const seen = new Set<string>();
const norm = (u: string) => {
	try {
		const x = new URL(u);
		x.hash = "";
		return `${x.host.replace(/^www\./, "")}${x.pathname.replace(/\/+$/, "")}${x.search}`;
	} catch {
		return u;
	}
};
const remember = (urls: string[]) =>
	urls.forEach((u) => {
		const v = u.replace(/[.,;:!?]+$/, "");
		seen.add(norm(/^[a-z]+:\/\//i.test(v) ? v : `https://${v}`));
	});
const URL_RE = /\bhttps?:\/\/[^\s<>"'«»)]+|\b(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/[^\s<>"'«»)]*)?/gi;

async function go(page: any, url: string): Promise<string> {
	try {
		await page.goto(url, { waitUntil: "commit", timeout: 20_000 });
	} catch (e: any) {
		await page.goto("about:blank", { timeout: 5_000 }).catch(() => {});
		throw new Error(String(e?.message ?? e).split("\n")[0]);
	}
	const loaded = await page.waitForLoadState("domcontentloaded", { timeout: 15_000 }).then(() => true, () => false);
	if (loaded) return "";
	await page.evaluate("window.stop()").catch(() => {});
	return "\n\n[The page was still loading after 15 s; this is what had arrived.]";
}

const MARKS = `((show) => {
	document.querySelectorAll('.__ar_m').forEach((e) => e.remove());
	if (!show) return [];
	const seen = [];
	for (const el of document.querySelectorAll('[data-pi]')) {
		const r = el.getBoundingClientRect();
		if (r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) continue;
		const box = document.createElement('div');
		box.className = '__ar_m';
		box.style.cssText = 'position:fixed;z-index:2147483645;pointer-events:none;border-radius:3px;outline:2px solid rgba(242,188,60,.95);left:' + r.left + 'px;top:' + r.top + 'px;width:' + r.width + 'px;height:' + r.height + 'px';
		const tag = document.createElement('div');
		tag.className = '__ar_m';
		tag.textContent = el.getAttribute('data-pi');
		tag.style.cssText = 'position:fixed;z-index:2147483646;pointer-events:none;font:700 12px/1 system-ui,sans-serif;color:#141538;background:#F2BC3C;border:1px solid #141538;border-radius:4px;padding:2px 4px;left:' + Math.max(0, r.left - 3) + 'px;top:' + Math.max(0, r.top - 10) + 'px';
		document.documentElement.append(box, tag);
		seen.push(el.getAttribute('data-pi'));
	}
	return seen;
})`;

async function state(page: any, excerpt: number) {
	const s = await page.evaluate(SNAPSHOT);
	remember([s.url, ...s.links]);
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
	await page.waitForLoadState("domcontentloaded", { timeout: 15_000 }).catch(() => {});
	await page.waitForTimeout(700);
	await rejectCookies(page);
}

const blocked = (page: any): Promise<boolean> =>
	page
		.evaluate(
			"!!document.querySelector('form#captcha-form, iframe[src*=recaptcha], iframe[src*=hcaptcha], iframe[src*=challenges.cloudflare]') || /unusual traffic|trafic exceptionnel|not a robot|pas un robot/i.test(document.body?.innerText || '')",
		)
		.catch(() => false);

const BLOCKED_NOTE = "\n\n[This page asks for a human verification: do not try to pass it, use another source.]";

export function installNavigateur(pi: ExtensionAPI) {
	pi.registerTool({
		name: "browser",
		label: "Navigateur",
		description:
			"Web browser the user can watch. Navigate by search and click [n]; open only urls given by the user. Cite only pages you actually read.",
		parameters: Params,
		prepareArguments: (raw: any) => {
			if (!raw || typeof raw !== "object") return raw;
			const a = String(raw.action ?? "").trim().toLowerCase().replace(/[^a-z]/g, "");
			const action = ACTIONS[a] ?? a;
			const text = raw.text ?? raw.query ?? raw.q;
			return { ...raw, action, ...(text !== undefined ? { text } : {}) };
		},
		executionMode: "sequential",

		async execute(_id, params, signal, onUpdate, ctx) {
			const progress = (msg: string) => onUpdate?.({ content: [{ type: "text", text: msg }], details: { progress: msg } });
			const s = await getSession(progress);
			touch(s);
			const page = s.page;
			signal?.addEventListener("abort", () => say(s, " interrompu").catch(() => {}), { once: true });
			let out: { title?: string; url?: string; text: string };

			if (params.action === "open" && !params.url && (params.target || params.x !== undefined)) params.action = "click";
			switch (params.action) {
				case "search": {
					const q = params.text ?? params.target ?? params.url;
					if (!q) throw new Error("search needs text");
					await say(s, ` cherche « ${q} »`);
					let results: string[] = [];
					for (const engine of [
						{ url: `https://duckduckgo.com/?q=${encodeURIComponent(q)}&kl=fr-fr`, ready: 'a[data-testid="result-title-a"]' },
						{ url: `https://www.bing.com/search?q=${encodeURIComponent(q)}&setlang=fr&cc=FR`, ready: "#b_results > li.b_algo h2 a" },
					]) {
						await go(page, engine.url).catch(() => {});
						await page.waitForSelector(engine.ready, { timeout: 8_000 }).catch(() => {});
						await rejectCookies(page);
						results = await page.evaluate(RESULTS);
					remember(await page.evaluate("[...document.querySelectorAll('[data-pi]')].map((a) => a.href).filter(Boolean)"));
						if (results.length) break;
					}
					await say(s, ` ${results.length} résultats pour « ${q} »`);
					out = {
						title: `Recherche : ${q}`,
						url: page.url(),
						text: results.length
							? `Results for "${q}" — click [n] to visit:\n${results.join("\n")}`
							: (await state(page, 2000)).text + ((await blocked(page)) ? BLOCKED_NOTE : ""),
					};
					break;
				}
				case "open": {
					if (!params.url) throw new Error("open needs a url");
					const url = /^[a-z]+:\/\//i.test(params.url) ? params.url : `https://${params.url}`;
					if (!seen.has(norm(url)))
						return {
							content: [
								{
									type: "text",
									text: "Refused: this url was neither given by the user nor seen as a link on a visited page. Do not guess urls: use search, then click a result [n].",
								},
							],
							details: { action: "open", title: "adresse inventée refusée", url },
						};
					const onPage: number = await page
						.evaluate(
							`(() => { const want = ${JSON.stringify(norm(url))}; const n = (u) => { try { const x = new URL(u); x.hash = ""; return x.host.replace(/^www\\./, "") + x.pathname.replace(/\\/+$/, "") + x.search; } catch { return u; } }; const a = [...document.querySelectorAll("a[href]")].find((e) => n(e.href) === want && e.getBoundingClientRect().width > 1); if (!a) return 0; a.removeAttribute("target"); a.setAttribute("data-pi-open", "1"); return 1; })()`,
						)
						.catch(() => 0);
					if (onPage) {
						const el = page.locator('[data-pi-open="1"]').first();
						const label = ((await el.innerText({ timeout: 3_000 }).catch(() => "")) || url).replace(/\s+/g, " ").trim().slice(0, 60);
						await say(s, ` clique sur « ${label} »`);
						await click(s, el);
						await settle(page);
						if (s.page !== page) await settle(s.page);
						out = await state(s.page, 3000);
						if (await blocked(s.page)) out.text += BLOCKED_NOTE;
						break;
					}
					await say(s, ` ouvre ${url}`);
					const slow = await go(page, url);
					if (slow) await rejectCookies(page);
					else await settle(page);
					out = await state(page, 3000);
					out.text += slow;
					if (await blocked(page)) out.text += BLOCKED_NOTE;
					break;
				}
				case "screenshot": {
					const vision = (ctx.model as any)?.input?.includes("image");
					if (!vision) return { content: [{ type: "text", text: "This model cannot see images; use read instead." }], details: { action: "screenshot" } };
					await say(s, " regarde la page");
					const st = await state(page, 0);
					const visible: string[] = await page.evaluate(`${MARKS}(true)`);
					await page.waitForTimeout(120);
					const shot = await page.screenshot({ type: "jpeg", quality: 60, scale: "css" });
					await page.evaluate(`${MARKS}(false)`).catch(() => {});
					const { w, h } = await page.evaluate("({ w: innerWidth, h: innerHeight })");
					const lines = st.text.split("\n").filter((l) => visible.includes(l.match(/^\[(\d+)\]/)?.[1] ?? ""));
					return {
						content: [
							{
								type: "text",
								text: `${st.title}\n${st.url}\nScreenshot ${w}x${h}: yellow labels are element numbers, click them with [n]; use x,y only for unlabeled spots.\n${lines.join("\n")}`,
							},
							{ type: "image", data: shot.toString("base64"), mimeType: "image/jpeg" },
						],
						details: { action: "screenshot", title: st.title, url: st.url },
					};
				}
				case "read": {
					await say(s, " lit la page");
					const text: string = params.target
						? await locate(page, params.target).innerText({ timeout: 5_000 })
						: await page.evaluate("document.body.innerText");
					const clean = text.replace(/\n{3,}/g, "\n\n").trim();
					out = { title: await page.title(), url: page.url(), text: clean.length > 12_000 ? `${clean.slice(0, 12_000)}\n[… truncated]` : clean };
					break;
				}
				case "click": {
					if (!params.target && params.x !== undefined && params.y !== undefined) {
						await say(s, ` clique en (${Math.round(params.x)}, ${Math.round(params.y)})`);
						await clickAt(s, params.x, params.y);
						await settle(page);
						if (s.page !== page) await settle(s.page);
						out = await state(s.page, 1200);
						break;
					}
					if (!params.target) throw new Error("click needs a target [n] or x,y");
					const el = locate(page, params.target);
					const label = ((await el.innerText({ timeout: 3_000 }).catch(() => "")) || params.target).replace(/\s+/g, " ").trim().slice(0, 60);
					await say(s, ` clique sur « ${label} »`);
					await click(s, el);
					await settle(page);
					if (s.page !== page) await settle(s.page);
					out = await state(s.page, 1200);
					if (await blocked(s.page)) out.text += BLOCKED_NOTE;
					break;
				}
				case "type": {
					if (params.text === undefined) throw new Error("type needs text");
					await say(s, ` écrit « ${params.text.slice(0, 50)} »`);
					if (params.target) {
						const el = locate(page, params.target);
						await click(s, el);
						await el.fill("", { timeout: 5_000 }).catch(() => {});
					} else if (params.x !== undefined && params.y !== undefined) {
						await clickAt(s, params.x, params.y);
					}
					await page.keyboard.type(params.text, { delay: s.headless ? 0 : 35 });
					if (params.submit) {
						await page.keyboard.press("Enter");
						await settle(page);
					}
					out = await state(page, params.submit ? 1200 : 0);
					break;
				}
				case "scroll": {
					const up = params.text === "up";
					await say(s, up ? " remonte" : " fait défiler la page");
					await page.mouse.wheel(0, up ? -SIZE.height * 0.75 : SIZE.height * 0.75);
					await page.waitForTimeout(500);
					out = await state(page, 0);
					break;
				}
				case "back":
					await say(s, " revient en arrière");
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
				search: "cherche",
				open: "ouvre",
				screenshot: "regarde la page",
				read: "lit la page",
				click: "clique sur",
				type: "écrit dans",
				scroll: args?.text === "up" ? "remonte" : "fait défiler",
				back: "revient en arrière",
			};
			const what =
				args?.action === "search"
					? `« ${args?.text ?? args?.target ?? ""} »`
					: (args?.url ??
						(args?.target ? `[${String(args.target).replace(/^\[|\]$/g, "")}]` : args?.x !== undefined ? `(${Math.round(args.x)}, ${Math.round(args.y)})` : ""));
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
			const url = (() => {
				try {
					return d.url ? decodeURI(d.url) : "";
				} catch {
					return d.url ?? "";
				}
			})();
			const line = [d.title, url].filter(Boolean).join(theme.fg("dim", " · "));
			return {
				render: (w: number) => [truncateToWidth(`  ${theme.fg("dim", "↳")} ${line || theme.fg("muted", "ok")}`, w)],
				invalidate() {},
			} as any;
		},
	});

	pi.on("input", async (event: any) => remember(String(event.text ?? "").match(URL_RE) ?? []));
	pi.on("session_shutdown", async () => closeSession());
}
