import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { after, test } from "node:test";
import { DEFAULT_ARCHIVE, DEFAULT_MIRRORS, DEFAULT_RAW, DEFAULT_SITE, newer, remoteVersion, sources, UPDATE_SCRIPT, updateArgs, updateSource, versionUrls } from "../extensions/aristote/maj.ts";

// Mises à jour et installation, sans réseau : de petits serveurs HTTP locaux
// jouent les Pages du LISN, le miroir, raw.githubusercontent.com et codeload.github.com.

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const work = mkdtempSync(join(tmpdir(), "aristote-maj-"));
after(() => rmSync(work, { recursive: true, force: true }));

// --- adresses ---------------------------------------------------------------

test("adresses par défaut : les Pages du LISN seules, sans secours", () => {
	assert.deepEqual(sources({}), { site: DEFAULT_SITE, mirrors: [], raw: "" });
	assert.equal(DEFAULT_SITE, "https://vibe-coding.pages.lisn.upsaclay.fr/pi-aristote");
	assert.equal(DEFAULT_MIRRORS, "");
	assert.equal(DEFAULT_RAW, "");
	assert.equal(DEFAULT_ARCHIVE, "");
	assert.deepEqual(versionUrls(sources({})), ["https://vibe-coding.pages.lisn.upsaclay.fr/pi-aristote/VERSION"]);
	assert.deepEqual(updateArgs(sources({}), "1.8.1").slice(2), ["sh", "1.8.1", "", DEFAULT_SITE]);
});

test("PI_ARISTOTE_SITE, PI_ARISTOTE_MIRRORS et PI_ARISTOTE_RAW : priorité, barre finale retirée, vide", () => {
	assert.equal(sources({ PI_ARISTOTE_SITE: "http://localhost:8000/pi-aristote//" }).site, "http://localhost:8000/pi-aristote");
	assert.equal(sources({ PI_ARISTOTE_SITE: "" }).site, DEFAULT_SITE);
	assert.deepEqual(sources({ PI_ARISTOTE_MIRRORS: " http://a.test/x/  http://b.test/y http://a.test/x" }).mirrors, ["http://a.test/x", "http://b.test/y"]);
	assert.deepEqual(sources({ PI_ARISTOTE_MIRRORS: "" }).mirrors, []);
	// Le site pris pour principal n'est pas repris comme miroir.
	assert.deepEqual(sources({ PI_ARISTOTE_SITE: "https://exemple.org/pi-aristote", PI_ARISTOTE_MIRRORS: "https://exemple.org/pi-aristote" }).mirrors, []);
	assert.equal(sources({ PI_ARISTOTE_RAW: "http://localhost:9000/raw/" }).raw, "http://localhost:9000/raw");
	const sansSecours = sources({ PI_ARISTOTE_RAW: "", PI_ARISTOTE_MIRRORS: "" });
	assert.equal(sansSecours.raw, "");
	assert.deepEqual(versionUrls(sansSecours), [`${DEFAULT_SITE}/VERSION`]);
	assert.deepEqual(updateArgs(sansSecours, "1.8.1").slice(2), ["sh", "1.8.1", "", DEFAULT_SITE]);
});

test("comparaison de versions", () => {
	assert.equal(newer("1.8.0", "1.7.1"), true);
	assert.equal(newer("1.10.0", "1.9.9"), true);
	assert.equal(newer("1.7.1", "1.7.1"), false);
	assert.equal(newer("1.7.1", "1.8.0"), false);
});

test("source annoncée par /maj", () => {
	assert.equal(updateSource("x\nMise à jour 1.7.1 → 1.8.1 depuis https://thegreeklibrary.org/pi-aristote.\n"), "https://thegreeklibrary.org/pi-aristote");
	assert.equal(updateSource("Mise à jour 1.7.1 → 1.8.1 depuis GitHub.\n"), "GitHub");
	assert.equal(updateSource("Extension déjà à jour (1.8.1, d'après …).\n"), undefined);
});

// --- vérification au démarrage (fetch simulé) --------------------------------

const S = { site: "https://site.test/pi-aristote", mirrors: ["https://miroir.test/pi-aristote"], raw: "https://raw.test/main" };
const fauxFetch = (reponses: Record<string, () => Response>) => {
	const appels: string[] = [];
	const f = (async (url: string) => {
		appels.push(url);
		const r = reponses[url];
		if (!r) throw new TypeError("fetch failed");
		return r();
	}) as unknown as typeof fetch;
	return { f, appels };
};

test("VERSION : le site répond, ni le miroir ni GitHub ne sont consultés", async () => {
	const { f, appels } = fauxFetch({ [`${S.site}/VERSION`]: () => new Response("1.8.1\n") });
	assert.equal(await remoteVersion(S, "1.8.0", f), "1.8.1");
	assert.deepEqual(appels, [`${S.site}/VERSION`]);
});

test("VERSION : site injoignable, en 404 ou qui sert une page d'erreur → miroir, puis GitHub", async () => {
	const raw = { [`${S.raw}/extensions/aristote/VERSION`]: () => new Response("1.8.2\n") };
	for (const site of [{}, { [`${S.site}/VERSION`]: () => new Response("introuvable", { status: 404 }) }, { [`${S.site}/VERSION`]: () => new Response("<!doctype html><title>Wi-Fi</title>") }]) {
		const { f, appels } = fauxFetch({ ...site, ...raw });
		assert.equal(await remoteVersion(S, "1.8.1", f), "1.8.2");
		assert.equal(appels.length, 3);
		const m = fauxFetch({ ...site, [`${S.mirrors[0]}/VERSION`]: () => new Response("1.8.1\n"), ...raw });
		assert.equal(await remoteVersion(S, "1.8.1", m.f), "1.8.1");
		assert.equal(m.appels.length, 2);
	}
});

test("VERSION : une source plus ancienne que la version installée est sautée", async () => {
	const { f } = fauxFetch({
		[`${S.site}/VERSION`]: () => new Response("1.7.1\n"),
		[`${S.mirrors[0]}/VERSION`]: () => new Response("1.8.0\n"),
		[`${S.raw}/extensions/aristote/VERSION`]: () => new Response("1.9.0\n"),
	});
	assert.equal(await remoteVersion(S, "1.8.1", f), "1.9.0");
	assert.equal(await remoteVersion(S, "1.7.0", f), "1.7.1");
	assert.equal(await remoteVersion(S, "dev", f), "1.7.1");
	assert.equal(await remoteVersion(S, "2.0.0", f), undefined);
});

test("VERSION : tout est en panne, ou secours coupés → rien", async () => {
	assert.equal(await remoteVersion(S, "1.8.1", fauxFetch({}).f), undefined);
	const { f, appels } = fauxFetch({ [`${S.raw}/extensions/aristote/VERSION`]: () => new Response("9.9.9") });
	assert.equal(await remoteVersion({ ...S, mirrors: [], raw: "" }, "1.8.1", f), undefined);
	assert.deepEqual(appels, [`${S.site}/VERSION`]);
});

// --- lecture des fichiers ------------------------------------------------------

const lire = (p: string) => readFileSync(join(ROOT, p), "utf8");

test("chaque appel à curl a un délai de connexion et un délai total", () => {
	for (const [fichier, texte] of [["install.sh", lire("install.sh")], ["maj.ts", UPDATE_SCRIPT]]) {
		const appels = texte.split("\n").filter((l) => /\bcurl -/.test(l) && !/^\s*#/.test(l));
		assert.ok(appels.length > 0, fichier);
		for (const l of appels) {
			assert.match(l, /--connect-timeout \d+/, `${fichier} : ${l.trim()}`);
			assert.match(l, /--max-time \d+/, `${fichier} : ${l.trim()}`);
		}
	}
});

test("installateur : la clé n'apparaît jamais dans la ligne de commande de curl", () => {
	const install = lire("install.sh");
	const avecCle = install.split("\n").filter((l) => /\$key/.test(l) && /\bcurl\b/.test(l));
	assert.equal(avecCle.length, 1);
	assert.match(avecCle[0], /printf 'Authorization: Bearer %s\\n' "\$key" \| curl .* -H @- "\$API\/models"/);
	assert.ok(install.includes('API="${ARISTOTE_BASE_URL:-https://llm.aristote.education/v1}"'));
});

test("même adresse dans l'extension, l'installateur et la page : le LISN d'abord, le miroir ensuite", () => {
	const install = lire("install.sh");
	assert.ok(install.includes(`SITE="\${PI_ARISTOTE_SITE:-${DEFAULT_SITE}}"`));
	assert.ok(install.includes(`MIRRORS="\${PI_ARISTOTE_MIRRORS-${DEFAULT_MIRRORS}}"`));
	assert.ok(install.includes(`ARCHIVE="\${PI_ARISTOTE_ARCHIVE-${DEFAULT_ARCHIVE}}"`));
	assert.ok(install.includes(`#   curl -fsSL ${DEFAULT_SITE}/install.sh | sh`));
	const page = lire("site/index.html");
	assert.ok(page.includes(`unix: "curl -fsSL ${DEFAULT_SITE}/install.sh | sh"`));
	assert.ok(page.includes(`win: 'wsl bash -lc "curl -fsSL ${DEFAULT_SITE}/install.sh | sh"'`));
	assert.ok(page.includes("https://gitlab.lisn.upsaclay.fr/vibe-coding/pi-aristote"), "lien vers le dépôt GitLab du LISN");
	const ext = readdirSync(join(ROOT, "extensions/aristote")).map((f) => lire(`extensions/aristote/${f}`));
	assert.ok(page.includes(`<code id="cmd"><span class="p">$ </span>curl -fsSL ${DEFAULT_SITE}/install.sh | sh</code>`));
	for (const texte of ext) assert.doesNotMatch(texte, /curl -fsSL https:\/\/thegreeklibrary\.org/, "la commande d'installation vise le LISN");
	assert.doesNotMatch(page, /(href|src)="\/(?!\/)/, "liens de la page relatifs (sinon ils visent la racine du domaine du miroir)");
});

test("CI GitLab : publie site/ avec ses sous-dossiers, install.sh, VERSION et l'archive", () => {
	const ci = lire(".gitlab-ci.yml");
	assert.match(ci, /cp -R site\/\. public\//);
	assert.match(ci, /cp install\.sh public\//);
	assert.match(ci, /extensions\/aristote\/VERSION public\/VERSION/);
	assert.match(ci, /tar -czf public\/pi-aristote\.tar\.gz extensions themes/);
});

// --- installateur et /maj contre des serveurs locaux ---------------------------

type Routes = Record<string, Buffer | string>;
const serveurs: { close: () => void }[] = [];
after(() => serveurs.forEach((s) => s.close()));

const servir = async (routes: Routes, journal?: string[]) => {
	const srv = createServer((req, res) => {
		journal?.push(req.url ?? "");
		const corps = routes[(req.url ?? "").split("?")[0]];
		if (corps === undefined) {
			res.writeHead(404, { "content-type": "text/html" });
			return res.end("<!doctype html><title>404</title>");
		}
		res.writeHead(200);
		res.end(corps);
	});
	await new Promise<void>((ok) => srv.listen(0, "127.0.0.1", ok));
	serveurs.push(srv);
	return `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
};
// Une adresse où personne n'écoute : connexion refusée tout de suite.
const morte = async () => {
	const srv = createServer();
	await new Promise<void>((ok) => srv.listen(0, "127.0.0.1", ok));
	const port = (srv.address() as AddressInfo).port;
	await new Promise((ok) => srv.close(ok));
	return `http://127.0.0.1:${port}`;
};

const tar = (args: string[]) => {
	const r = spawnSync("tar", args, { env: { ...process.env, COPYFILE_DISABLE: "1" }, encoding: "utf8" });
	assert.equal(r.status, 0, r.stderr);
};
let n = 0;
const dossier = (nom: string) => {
	const d = join(work, `${nom}-${++n}`);
	mkdirSync(d, { recursive: true });
	return d;
};
// L'extension du dépôt, avec le numéro de version voulu, rangée sous racine/.
const arbre = (racine: string, version: string) => {
	cpSync(join(ROOT, "extensions"), join(racine, "extensions"), { recursive: true });
	cpSync(join(ROOT, "themes"), join(racine, "themes"), { recursive: true });
	writeFileSync(join(racine, "extensions/aristote/VERSION"), `${version}\n`);
};
// Ce que le site sert : extensions/ et themes/ à la racine de l'archive.
const archiveSite = (version: string, extra?: string) => {
	const d = dossier("site");
	arbre(d, version);
	const membres = ["extensions", "themes"];
	if (extra) {
		writeFileSync(join(d, extra), "intrus\n");
		membres.push(extra);
	}
	tar(["-czf", join(d, "a.tgz"), "-C", d, ...membres]);
	return readFileSync(join(d, "a.tgz"));
};
// Ce que sert codeload.github.com : tout le dépôt sous pi-aristote-main/.
const archiveGithub = (version: string) => {
	const d = dossier("gh");
	const depot = join(d, "pi-aristote-main");
	mkdirSync(depot);
	arbre(depot, version);
	cpSync(join(ROOT, "install.sh"), join(depot, "install.sh"));
	mkdirSync(join(depot, "site"));
	writeFileSync(join(depot, "site/index.html"), "<!doctype html>\n");
	writeFileSync(join(depot, "README.md"), "# pi-aristote\n");
	tar(["-czf", join(d, "a.tgz"), "-C", d, "pi-aristote-main"]);
	return readFileSync(join(d, "a.tgz"));
};
const CODELOAD = "/l-pommeret/pi-aristote/tar.gz/refs/heads/main";

// Un faux pi : l'installateur le trouve et n'appelle pas npm.
const bin = dossier("bin");
writeFileSync(join(bin, "pi"), "#!/bin/sh\necho 1.0.0\n");
chmodSync(join(bin, "pi"), 0o755);

// entree : ce que le shell lit sur son entrée standard, comme dans curl | sh.
const lancer = (cmd: string, args: string[], env: Record<string, string>, entree?: string) =>
	new Promise<{ code: number; out: string }>((ok) => {
		const base = { ...process.env };
		delete base.ARISTOTE_API_KEY;
		for (const k of Object.keys(base)) if (k.startsWith("PI_ARISTOTE_")) delete base[k];
		const p = spawn(cmd, args, { env: { ...base, PATH: `${bin}:${process.env.PATH}`, ...env }, stdio: [entree === undefined ? "ignore" : "pipe", "pipe", "pipe"] });
		if (entree !== undefined) p.stdin!.end(entree);
		let out = "";
		p.stdout.on("data", (d) => (out += d));
		p.stderr.on("data", (d) => (out += d));
		p.on("close", (code) => ok({ code: code ?? 1, out }));
	});

const maison = () => {
	const home = dossier("home");
	return { home, agent: join(home, ".pi/agent") };
};
const installer = (shell: string, agent: string, home: string, env: Record<string, string>) =>
	lancer(shell, [join(ROOT, "install.sh")], { HOME: home, PI_CODING_AGENT_DIR: agent, PI_ARISTOTE_AUTO: "1", PI_ARISTOTE_MIRRORS: "", ...env });
const versionInstallee = (agent: string) => readFileSync(join(agent, "extensions/aristote/VERSION"), "utf8").trim();

const shells = ["sh", "dash", "bash"].filter((s) => spawnSync("sh", ["-c", `command -v ${s}`]).status === 0);

for (const shell of shells) {
	test(`installateur (${shell}) : depuis le site`, async () => {
		const site = await servir({ "/pi-aristote.tar.gz": archiveSite("8.0.0") });
		const { home, agent } = maison();
		const r = await installer(shell, agent, home, { PI_ARISTOTE_SITE: site, PI_ARISTOTE_ARCHIVE: `${await morte()}${CODELOAD}` });
		assert.equal(r.code, 0, r.out);
		assert.equal(versionInstallee(agent), "8.0.0");
		assert.ok(existsSync(join(agent, "themes/aristote.json")));
		assert.doesNotMatch(r.out, /GitHub/);
	});

	test(`installateur (${shell}) : site injoignable → archive GitHub, sans le dossier racine ni le reste du dépôt`, async () => {
		const gh = await servir({ [CODELOAD]: archiveGithub("8.0.1") });
		const { home, agent } = maison();
		const r = await installer(shell, agent, home, { PI_ARISTOTE_SITE: `${await morte()}/pi-aristote`, PI_ARISTOTE_ARCHIVE: `${gh}${CODELOAD}` });
		assert.equal(r.code, 0, r.out);
		assert.match(r.out, /dépôt GitHub/);
		assert.match(r.out, /\(depuis GitHub\)/);
		assert.equal(versionInstallee(agent), "8.0.1");
		assert.deepEqual(readdirSync(agent).sort(), ["extensions", "themes"]);
		assert.deepEqual(readdirSync(join(agent, "extensions")), ["aristote"]);
		assert.ok(existsSync(join(agent, "extensions/aristote/index.ts")));
		assert.ok(existsSync(join(agent, "themes/aristote.json")));
	});
}

test("installateur lu sur l'entrée standard (curl | sh) : entier, il s'exécute ; coupé en route, il ne fait rien", async () => {
	const site = await servir({ "/pi-aristote.tar.gz": archiveSite("8.0.3") });
	const lignes = lire("install.sh").split("\n");
	const apresSuppression = lignes.findIndex((l) => l.includes('mkdir -p "$AGENT_DIR/extensions"')) + 12;
	for (const shell of shells) {
		const essai = async (texte: string) => {
			const { home, agent } = maison();
			mkdirSync(join(agent, "extensions/aristote"), { recursive: true });
			writeFileSync(join(agent, "extensions/aristote/VERSION"), "1.7.1\n");
			const env = { HOME: home, PI_CODING_AGENT_DIR: agent, PI_ARISTOTE_AUTO: "1", PI_ARISTOTE_SITE: site, PI_ARISTOTE_MIRRORS: "", PI_ARISTOTE_ARCHIVE: "" };
			return { r: await lancer(shell, [], env, texte), agent };
		};
		const entier = await essai(lignes.join("\n"));
		assert.equal(entier.r.code, 0, entier.r.out);
		assert.equal(versionInstallee(entier.agent), "8.0.3");
		// Jusqu'à l'accolade finale : erreur de syntaxe. Juste avant « main "$@" » :
		// la fonction est lue mais jamais appelée.
		const accolade = lignes.lastIndexOf("}");
		for (const n of [12, Math.floor(lignes.length / 2), apresSuppression, accolade, accolade + 2]) {
			const { r, agent } = await essai(`${lignes.slice(0, n).join("\n")}\n`);
			if (n <= accolade) assert.notEqual(r.code, 0, `${shell}, coupé à la ligne ${n} : ${r.out}`);
			assert.doesNotMatch(r.out, /Téléchargement/, `${shell}, coupé à la ligne ${n}`);
			assert.equal(versionInstallee(agent), "1.7.1", `${shell}, coupé à la ligne ${n}`);
		}
	}
});

test("installateur : extraction ratée (disque plein) → l'ancienne extension reste entière", async () => {
	const site = await servir({ "/pi-aristote.tar.gz": archiveSite("8.0.4") });
	// Un tar qui liste normalement mais échoue en pleine extraction, après avoir
	// écrit une partie des fichiers.
	const vraiTar = spawnSync("sh", ["-c", "command -v tar"], { encoding: "utf8" }).stdout.trim();
	const fauxBin = dossier("tar-plein");
	writeFileSync(
		join(fauxBin, "tar"),
		`#!/bin/sh\nif [ "$1" = -xzf ]; then\n\tdest=""; prev=""\n\tfor a in "$@"; do [ "$prev" = -C ] && dest="$a"; prev="$a"; done\n\t"${vraiTar}" "$@" || exit 1\n\trm -f "$dest/extensions/aristote/index.ts"\n\techo "tar: No space left on device" >&2\n\texit 1\nfi\nexec "${vraiTar}" "$@"\n`,
	);
	chmodSync(join(fauxBin, "tar"), 0o755);
	for (const shell of shells) {
		const { home, agent } = maison();
		mkdirSync(join(agent, "extensions/aristote"), { recursive: true });
		writeFileSync(join(agent, "extensions/aristote/VERSION"), "1.7.1\n");
		writeFileSync(join(agent, "extensions/aristote/index.ts"), "// 1.7.1\n");
		const r = await installer(shell, agent, home, { PATH: `${fauxBin}:${bin}:${process.env.PATH}`, PI_ARISTOTE_SITE: site, PI_ARISTOTE_ARCHIVE: "" });
		assert.notEqual(r.code, 0, r.out);
		assert.match(r.out, /version en place n'a pas été touchée/);
		assert.equal(versionInstallee(agent), "1.7.1");
		assert.equal(readFileSync(join(agent, "extensions/aristote/index.ts"), "utf8"), "// 1.7.1\n");
		assert.deepEqual(readdirSync(agent).sort(), ["extensions", "themes"], "pas de dossier provisoire oublié");
	}
});

test("installateur : seuls extensions/aristote et le thème changent ; les autres extensions, thèmes et droits restent", async () => {
	const site = await servir({ "/pi-aristote.tar.gz": archiveSite("8.0.5") });
	const { home, agent } = maison();
	mkdirSync(join(agent, "extensions/aristote"), { recursive: true });
	writeFileSync(join(agent, "extensions/aristote/VERSION"), "1.7.1\n");
	writeFileSync(join(agent, "extensions/aristote/ancien.ts"), "// retiré par la mise à jour\n");
	mkdirSync(join(agent, "extensions/autre"));
	writeFileSync(join(agent, "extensions/autre/index.ts"), "export default function () {}\n");
	mkdirSync(join(agent, "themes"));
	writeFileSync(join(agent, "themes/mon-theme.json"), "{}\n");
	chmodSync(join(agent, "extensions"), 0o700);
	const r = await installer("sh", agent, home, { PI_ARISTOTE_SITE: site, PI_ARISTOTE_ARCHIVE: "" });
	assert.equal(r.code, 0, r.out);
	assert.equal(versionInstallee(agent), "8.0.5");
	assert.ok(!existsSync(join(agent, "extensions/aristote/ancien.ts")), "l'ancienne extension est remplacée, pas fusionnée");
	assert.deepEqual(readdirSync(join(agent, "extensions")).sort(), ["aristote", "autre"]);
	assert.deepEqual(readdirSync(join(agent, "themes")).sort(), ["aristote.json", "mon-theme.json"]);
	assert.equal(statSync(join(agent, "extensions")).mode & 0o777, 0o700);
	assert.deepEqual(readdirSync(agent).sort(), ["extensions", "themes"]);
});

test("installateur : le site sert une page HTML, ou une archive avec un intrus → GitHub", async () => {
	const gh = await servir({ [CODELOAD]: archiveGithub("8.0.2") });
	for (const corps of ["<!doctype html><title>portail</title>", archiveSite("6.6.6", "intrus.sh")]) {
		const site = await servir({ "/pi-aristote.tar.gz": corps });
		const { home, agent } = maison();
		const r = await installer("sh", agent, home, { PI_ARISTOTE_SITE: site, PI_ARISTOTE_ARCHIVE: `${gh}${CODELOAD}` });
		assert.equal(r.code, 0, r.out);
		assert.equal(versionInstallee(agent), "8.0.2");
		assert.ok(!existsSync(join(agent, "intrus.sh")));
	}
});

test("installateur : rien ne répond, ou secours coupé → échec, l'extension en place n'est pas touchée", async () => {
	for (const archive of [`${await morte()}${CODELOAD}`, ""]) {
		const { home, agent } = maison();
		mkdirSync(join(agent, "extensions/aristote"), { recursive: true });
		writeFileSync(join(agent, "extensions/aristote/VERSION"), "1.7.1\n");
		const r = await installer("sh", agent, home, { PI_ARISTOTE_SITE: await morte(), PI_ARISTOTE_ARCHIVE: archive });
		assert.notEqual(r.code, 0, r.out);
		assert.match(r.out, archive ? /impossible .*puis GitHub/ : /impossible \(http/);
		assert.equal(versionInstallee(agent), "1.7.1");
	}
});

// --- secours et versions ------------------------------------------------------

const avecVersion = (agent: string, version: string) => {
	mkdirSync(join(agent, "extensions/aristote"), { recursive: true });
	writeFileSync(join(agent, "extensions/aristote/VERSION"), `${version}\n`);
	writeFileSync(join(agent, "extensions/aristote/index.ts"), `// ${version}\n`);
};

test("installateur : LISN injoignable → miroir, sans aller jusqu'à GitHub", async () => {
	const journal: string[] = [];
	const miroir = await servir({ "/pi-aristote.tar.gz": archiveSite("8.2.0") });
	const gh = await servir({ [CODELOAD]: archiveGithub("8.2.1") }, journal);
	for (const shell of shells) {
		const { home, agent } = maison();
		avecVersion(agent, "1.7.1");
		const r = await installer(shell, agent, home, { PI_ARISTOTE_SITE: await morte(), PI_ARISTOTE_MIRRORS: `${miroir}/`, PI_ARISTOTE_ARCHIVE: `${gh}${CODELOAD}` });
		assert.equal(r.code, 0, r.out);
		assert.match(r.out, /miroir/);
		assert.match(r.out, /\(depuis le miroir http/);
		assert.equal(versionInstallee(agent), "8.2.0");
	}
	assert.deepEqual(journal, []);
});

test("installateur : un secours plus ancien que la version installée est sauté, jamais installé", async () => {
	const miroir = await servir({ "/pi-aristote.tar.gz": archiveSite("1.8.0") });
	const gh = await servir({ [CODELOAD]: archiveGithub("1.8.2") });
	const { home, agent } = maison();
	avecVersion(agent, "1.8.1");
	const r = await installer("sh", agent, home, { PI_ARISTOTE_SITE: await morte(), PI_ARISTOTE_MIRRORS: miroir, PI_ARISTOTE_ARCHIVE: `${gh}${CODELOAD}` });
	assert.equal(r.code, 0, r.out);
	assert.match(r.out, /sert la 1\.8\.0, plus ancienne que la 1\.8\.1 installée : ignorée/);
	assert.equal(versionInstallee(agent), "1.8.2");
});

test("installateur : le site principal en retard est sauté lui aussi", async () => {
	const site = await servir({ "/pi-aristote.tar.gz": archiveSite("1.7.1") });
	const miroir = await servir({ "/pi-aristote.tar.gz": archiveSite("1.8.1") });
	const { home, agent } = maison();
	avecVersion(agent, "1.8.0");
	const r = await installer("sh", agent, home, { PI_ARISTOTE_SITE: site, PI_ARISTOTE_MIRRORS: miroir, PI_ARISTOTE_ARCHIVE: "" });
	assert.equal(r.code, 0, r.out);
	assert.equal(versionInstallee(agent), "1.8.1");
});

test("installateur : toutes les sources joignables sont plus anciennes → l'extension en place est gardée", async () => {
	const site = await servir({ "/pi-aristote.tar.gz": archiveSite("1.7.1") });
	const gh = await servir({ [CODELOAD]: archiveGithub("1.8.0") });
	const { home, agent } = maison();
	avecVersion(agent, "1.8.1");
	const r = await installer("sh", agent, home, { PI_ARISTOTE_SITE: site, PI_ARISTOTE_MIRRORS: await morte(), PI_ARISTOTE_ARCHIVE: `${gh}${CODELOAD}` });
	assert.equal(r.code, 0, r.out);
	assert.match(r.out, /Extension 1\.8\.1 conservée/);
	assert.equal(versionInstallee(agent), "1.8.1");
	assert.equal(readFileSync(join(agent, "extensions/aristote/index.ts"), "utf8"), "// 1.8.1\n");
	assert.deepEqual(readdirSync(agent).sort(), ["extensions"]);
});

test("installateur : même version, ou première installation → le site principal suffit", async () => {
	const site = await servir({ "/pi-aristote.tar.gz": archiveSite("1.8.1") });
	for (const avant of ["1.8.1", ""]) {
		const { home, agent } = maison();
		if (avant) avecVersion(agent, avant);
		const r = await installer("sh", agent, home, { PI_ARISTOTE_SITE: site, PI_ARISTOTE_ARCHIVE: "" });
		assert.equal(r.code, 0, r.out);
		assert.equal(versionInstallee(agent), "1.8.1");
		assert.ok(existsSync(join(agent, "extensions/aristote/maj.ts")));
	}
});

// --- /maj -------------------------------------------------------------------------

const faux = (marque: string) => `#!/bin/sh\necho "${marque} AUTO=$PI_ARISTOTE_AUTO SITE=$PI_ARISTOTE_SITE KO=$PI_ARISTOTE_SITE_KO"\n`;
const maj = (ici: string, raw: string, sites: string[], env: Record<string, string> = {}) => lancer("sh", ["-c", UPDATE_SCRIPT, "sh", ici, raw, ...sites], env);

test("/maj : VERSION puis install.sh du site ; à jour, rien n'est lancé", async () => {
	const site = await servir({ "/VERSION": "1.8.1\n", "/install.sh": faux("SITE") });
	let r = await maj("1.7.1", "", [site]);
	assert.equal(r.code, 0, r.out);
	assert.match(r.out, new RegExp(`SITE AUTO=1 SITE=${site} KO=\\n`));
	assert.equal(updateSource(r.out), site);
	r = await maj("1.8.1", "", [site]);
	assert.equal(r.code, 0, r.out);
	assert.match(r.out, /déjà à jour/);
	assert.doesNotMatch(r.out, /AUTO=/);
	r = await maj("dev", "", [site]);
	assert.match(r.out, /SITE AUTO=1/);
});

test("/maj : site en panne ou en portail → miroir, puis GitHub", async () => {
	const miroir = await servir({ "/VERSION": "1.8.1\n", "/install.sh": faux("MIROIR") });
	const raw = await servir({ "/extensions/aristote/VERSION": "1.8.1\n", "/install.sh": faux("RAW") });
	const portail = await servir({ "/VERSION": "<!doctype html><title>portail</title>", "/install.sh": "<!doctype html>" });
	const sansInstall = await servir({ "/VERSION": "1.8.1\n" });
	for (const enPanne of [await morte(), portail, sansInstall]) {
		let r = await maj("1.7.1", raw, [enPanne, miroir]);
		assert.equal(r.code, 0, r.out);
		assert.match(r.out, new RegExp(`MIROIR AUTO=1 SITE=${miroir} KO=\\n`));
		r = await maj("1.7.1", raw, [enPanne, await morte()]);
		assert.equal(r.code, 0, r.out);
		assert.match(r.out, new RegExp(`RAW AUTO=1 SITE=${enPanne} KO=1`));
		assert.equal(updateSource(r.out), "GitHub");
	}
	assert.notEqual((await maj("1.7.1", await morte(), [await morte(), await morte()])).code, 0);
	assert.notEqual((await maj("1.7.1", "", [await morte()])).code, 0);
});

test("/maj : un miroir en retard ne fait jamais redescendre", async () => {
	const lisn = await servir({ "/VERSION": "1.7.1\n", "/install.sh": faux("LISN") });
	const miroir = await servir({ "/VERSION": "1.8.0\n", "/install.sh": faux("MIROIR") });
	const raw = await servir({ "/extensions/aristote/VERSION": "1.8.2\n", "/install.sh": faux("RAW") });
	let r = await maj("1.8.1", raw, [lisn, miroir]);
	assert.equal(r.code, 0, r.out);
	assert.match(r.out, /sert la 1\.7\.1, plus ancienne que la 1\.8\.1/);
	assert.match(r.out, /sert la 1\.8\.0, plus ancienne/);
	assert.match(r.out, /RAW AUTO=1/);
	r = await maj("1.8.1", "", [lisn, miroir]);
	assert.equal(r.code, 0, r.out);
	assert.match(r.out, /Aucune source ne sert de version plus récente que la 1\.8\.1/);
	assert.doesNotMatch(r.out, /AUTO=/);
});

test("/maj de bout en bout, LISN en panne, miroir en retard : install.sh et archive viennent de GitHub", async () => {
	const depot = await servir({
		"/l-pommeret/pi-aristote/main/install.sh": readFileSync(join(ROOT, "install.sh")),
		"/l-pommeret/pi-aristote/main/extensions/aristote/VERSION": "8.1.0\n",
		[CODELOAD]: archiveGithub("8.1.0"),
	});
	const appelsMiroir: string[] = [];
	const miroir = await servir({ "/VERSION": "1.8.0\n", "/install.sh": readFileSync(join(ROOT, "install.sh")), "/pi-aristote.tar.gz": archiveSite("1.8.0") }, appelsMiroir);
	const site = await morte();
	const raw = `${depot}/l-pommeret/pi-aristote/main`;
	assert.equal(await remoteVersion({ site, mirrors: [miroir], raw }, "1.8.1"), "8.1.0");
	appelsMiroir.length = 0;
	const { home, agent } = maison();
	avecVersion(agent, "1.8.1");
	const r = await maj("1.8.1", raw, [site, miroir], { HOME: home, PI_CODING_AGENT_DIR: agent, PI_ARISTOTE_ARCHIVE: `${depot}${CODELOAD}` });
	assert.equal(r.code, 0, r.out);
	assert.equal(versionInstallee(agent), "8.1.0");
	assert.deepEqual(appelsMiroir, ["/VERSION"], "le miroir en retard n'est consulté que pour VERSION");
});

test("/maj de bout en bout depuis le site : l'archive vient du même site", async () => {
	const depot = await servir({ [CODELOAD]: archiveGithub("6.6.6") });
	const site = await servir({ "/VERSION": "8.1.2\n", "/install.sh": readFileSync(join(ROOT, "install.sh")), "/pi-aristote.tar.gz": archiveSite("8.1.2") });
	const { home, agent } = maison();
	avecVersion(agent, "1.7.1");
	const r = await maj("1.7.1", "", [site], { HOME: home, PI_CODING_AGENT_DIR: agent, PI_ARISTOTE_ARCHIVE: `${depot}${CODELOAD}` });
	assert.equal(r.code, 0, r.out);
	assert.equal(versionInstallee(agent), "8.1.2");
});
