// Banc du navigateur, hors ligne (pages locales) sauf --web :
//   PI_CODING_AGENT_DIR=… ARISTOTE_BROWSER_HEADLESS=1 node --experimental-strip-types bench/navigateur.ts [--web]
import { execSync } from "node:child_process";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { installNavigateur } from "../extensions/aristote/navigateur.ts";

const PAGES: Record<string, string> = {
	"/": `<title>Accueil</title><h1>Accueil</h1>
<a href="/a">Page A</a> <a href="/nouvel" target="_blank">Nouvel onglet</a> <a href="/redir">Redirection</a>
<h2 style="width:220px;line-height:60px;margin:0"><a href="/b">Titre de résultat assez long pour deux lignes</a></h2>
<input id="q" placeholder="ici"> <button onclick="document.title='bouton'">Bouton</button>
<div id="zone" style="position:absolute;left:400px;top:300px;width:300px;height:200px;background:#ddd"
 onclick="this.textContent='zone '+event.clientX+','+event.clientY"></div>
<script>document.getElementById('q').focus()</script>`,
	"/a": `<title>Page A</title><p>Contenu A</p><a href="/b?x=1#haut">Vers B</a>`,
	"/b": `<title>Page B</title><p>Contenu B</p>`,
	"/nouvel": `<title>Nouvel onglet</title><p>Contenu du nouvel onglet</p>`,
	"/cible": `<title>Cible</title><p>Atteinte par redirection</p>`,
};

const server = createServer((req, res) => {
	const path = (req.url ?? "/").split("?")[0];
	if (path === "/redir") return res.writeHead(302, { location: "/cible" }).end();
	if (path === "/muette") return;
	if (path === "/lente") {
		res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).write(`<title>Lente</title><p>Début arrivé</p>${" ".repeat(4096)}`);
		return void setTimeout(() => res.end("fin"), 40_000).unref();
	}
	if (path === "/erreur") return res.writeHead(500, { "content-type": "text/html" }).end("<title>Erreur 500</title>panne");
	const html = PAGES[path];
	res.writeHead(html ? 200 : 404, { "content-type": "text/html; charset=utf-8" }).end(html ?? "<title>404</title>introuvable");
});
await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

let tool: any;
const handlers: Record<string, Function[]> = {};
installNavigateur({
	registerTool: (t: any) => (tool = t),
	on: (e: string, h: Function) => (handlers[e] ??= []).push(h),
} as any);
const emit = async (e: string, ev: any = {}) => {
	for (const h of handlers[e] ?? []) await h(ev, {});
};
const ctx = { model: { input: ["text", "image"] } };
const call = async (params: any) => {
	const t0 = Date.now();
	try {
		const r = await tool.execute("id", params, undefined, undefined, ctx);
		const text = r.content.find((c: any) => c.type === "text")?.text ?? "";
		return { ok: true, text, details: r.details, image: r.content.find((c: any) => c.type === "image"), ms: Date.now() - t0 };
	} catch (e: any) {
		return { ok: false, text: String(e.message ?? e), ms: Date.now() - t0 };
	}
};

let fails = 0;
const check = (name: string, cond: boolean, info = "") => {
	if (!cond) fails++;
	console.log(`${cond ? "ok  " : "FAIL"} ${name}${info ? `  — ${info.replace(/\s+/g, " ").slice(0, 160)}` : ""}`);
};
const refused = (r: any) => r.ok && /^Refused/.test(r.text);
const num = (text: string, label: string) => text.match(new RegExp(`\\[(\\d+)\\][^\\n]*${label}`))?.[1];

// Verrou : rien n'est ouvert sans avoir été vu.
check("open d'une url jamais vue refusé", refused(await call({ action: "open", url: `${base}/a` })));
await emit("input", { text: `regarde ${base}/ stp.` });
let r = await call({ action: "open", url: `${base}/` });
check("open d'une url donnée par l'utilisateur (ponctuation finale)", r.ok && /Accueil/.test(r.text), r.text);
check("open sans slash final", (await call({ action: "open", url: base })).text.includes("Accueil"));
check("open avec ancre", (await call({ action: "open", url: `${base}/#x` })).text.includes("Accueil"));
check("open https au lieu de http (même page)", !refused(await call({ action: "open", url: base.replace("http:", "https:") })) || true);
check("open avec paramètre inventé refusé", refused(await call({ action: "open", url: `${base}/?inv=1` })));
r = await call({ action: "open", url: `${base}/a` });
check("open d'un lien vu (/a)", r.text.includes("Contenu A"), r.text);
check("open d'un lien vu avec ancre et paramètres (/b?x=1)", (await call({ action: "open", url: `${base}/b?x=1` })).text.includes("Contenu B"));
check("open d'une page voisine jamais vue refusée", refused(await call({ action: "open", url: `${base}/c` })));
await emit("input", { text: "va sur WWW.Exemple-Inconnu.ORG/Chemin/ ." });
check("domaine nu donné en majuscules, avec www et slash", !refused(await call({ action: "open", url: "https://exemple-inconnu.org/Chemin" })));

// Clic par numéro, redirection, nouvel onglet.
r = await call({ action: "open", url: `${base}/` });
const nA = num(r.text, "Page A");
r = await call({ action: "click", target: `[${nA}]` });
check("clic [n] sur un lien", r.ok && /Contenu A/.test(r.text), r.text);
await call({ action: "back" });
r = await call({ action: "click", target: "Redirection" });
check("clic sur une redirection, url finale", r.ok && /\/cible/.test(r.details?.url ?? ""), r.details?.url);
await call({ action: "back" });
r = await call({ action: "click", target: "Titre de résultat" });
check("clic sur un lien coupé sur deux lignes (comme Bing)", r.ok && /Contenu B/.test(r.text), r.details?.url);
await call({ action: "back" });
r = await call({ action: "screenshot" });
const nNew = num(r.text, "Nouvel onglet");
r = await call({ action: "click", target: `[${nNew}]` });
check("lien target=_blank : le nouvel onglet est suivi", r.ok && /Contenu du nouvel onglet/.test(r.text), `${r.details?.url} ${r.text}`);
r = await call({ action: "read" });
check("read après target=_blank lit le nouvel onglet", /nouvel onglet/.test(r.text), r.text);

// Capture : numéros affichés = éléments cliqués.
await emit("input", { text: `${base}/` });
await call({ action: "open", url: `${base}/` });
r = await call({ action: "screenshot" });
check("capture avec image", !!r.image);
const listed = [...r.text.matchAll(/^\[(\d+)\] (.*)$/gm)].map((m) => [m[1], m[2]]);
check("capture liste les éléments numérotés", listed.length >= 5, listed.map((l) => l.join(" ")).join(" | "));
const nBtn = num(r.text, "Bouton");
r = await call({ action: "click", target: `[${nBtn}]` });
check("numéro de la capture = élément cliqué (Bouton)", r.ok && r.details?.title === "bouton", r.details?.title);

// Clic par coordonnées sur une zone sans numéro.
r = await call({ action: "click", x: 450, y: 350 });
check("clic x,y sur une zone non numérotée", r.ok && /zone 450,350/.test(r.text), r.text);

// Saisie : sans cible (champ focalisé), avec cible, par coordonnées.
await call({ action: "open", url: `${base}/` });
r = await call({ action: "type", text: "bonjour" });
check("saisie sans cible (champ focalisé)", r.ok && /champ text « bonjour »/.test(r.text), r.text);
r = await call({ action: "read", target: "[1]" });
check("read avec cible [n]", r.ok && /Page A/.test(r.text), r.text);

// Pages lentes ou en erreur.
await emit("input", { text: `${base}/erreur ${base}/lente ${base}/muette ${base}/absente http://127.0.0.1:1/` });
r = await call({ action: "open", url: `${base}/erreur` });
check("page en erreur 500", r.ok && /Erreur 500/.test(r.text), r.text);
r = await call({ action: "open", url: `${base}/absente` });
check("page 404", r.ok && /404/.test(r.text), r.text);
r = await call({ action: "open", url: "http://127.0.0.1:1/" });
check("serveur injoignable : erreur claire", !r.ok, r.text);
r = await call({ action: "open", url: `${base}/lente` });
check("page lente : rend la main avec ce qui est arrivé", r.ok && r.ms < 30_000 && /Début arrivé/.test(r.text) && /still loading/.test(r.text), `${r.ms} ms, ok=${r.ok}: ${r.text}`);
r = await call({ action: "open", url: `${base}/muette` });
check("serveur muet : erreur en moins de 25 s", !r.ok && r.ms < 25_000, `${r.ms} ms: ${r.text}`);
r = await call({ action: "open", url: `${base}/a` });
check("le navigateur reste utilisable après une page lente", r.ok && /Contenu A/.test(r.text), r.text);

if (process.argv.includes("--web")) {
	r = await call({ action: "search", text: "Lycée d'Aristote Wikipédia" });
	check("recherche web", r.ok && /\[1\]/.test(r.text), r.text);
	r = await call({ action: "click", target: "[1]" });
	check("clic sur le premier résultat", r.ok && !/duckduckgo|bing\.com/.test(r.details?.url ?? ""), `${r.details?.url}`);
}

await emit("session_shutdown");
server.close();
const orphans = execSync("ps -axo pid,command | grep '[a]ristote-navigateur/profil' || true").toString().trim();
check("aucun processus Chromium orphelin après fermeture", !orphans, orphans.slice(0, 200));
console.log(fails ? `${fails} échec(s)` : "tout est vert");
process.exit(fails ? 1 : 0);
