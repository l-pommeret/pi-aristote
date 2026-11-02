// Mode /yom : tri des commandes shell. Une commande ne passe sans confirmation
// que si chacun de ses morceaux est connu et inoffensif (lecture, recherche,
// téléchargement, installation de dépendances, compilation, tests). Tout le
// reste, et tout ce qui est inconnu, demande l'accord de l'utilisateur.

const SURS = new Set([
	"ls", "ll", "la", "cat", "bat", "head", "tail", "less", "more", "wc", "grep", "egrep", "fgrep", "rg", "ag", "fd", "tree",
	"pwd", "echo", "printf", "which", "whereis", "type", "command", "file", "stat", "du", "df", "date", "cal", "env", "printenv",
	"uname", "whoami", "id", "hostname", "sort", "uniq", "cut", "tr", "awk", "gawk", "column", "diff", "cmp", "comm", "jq", "yq",
	"basename", "dirname", "realpath", "readlink", "md5", "md5sum", "shasum", "sha1sum", "sha256sum", "base64", "xxd", "hexdump",
	"od", "strings", "nl", "fold", "fmt", "rev", "seq", "expr", "bc", "true", "false", "test", "[", "sleep", "cd", "pushd", "popd",
	"mkdir", "touch", "tar", "unzip", "gunzip", "zcat", "xzcat", "bunzip2", "find", "sed", "curl", "wget", "http", "https",
	"python", "python3", "pytest", "py.test", "node", "deno", "bun", "tsc", "tsx", "ts-node", "ruby", "php", "perl", "java", "javac",
	"gcc", "g++", "clang", "clang++", "cc", "make", "cmake", "ninja", "rustc", "ghc", "julia", "R", "Rscript", "lua",
	"git", "npm", "pnpm", "yarn", "npx", "pip", "pip3", "uv", "uvx", "poetry", "pipx", "conda", "mamba", "cargo", "go", "mvn",
	"gradle", "dotnet", "bundle", "gem", "composer", "brew", "docker", "pi",
]);

const SOUS_COMMANDES: Record<string, Set<string>> = {
	git: new Set(["status", "log", "diff", "show", "blame", "grep", "ls-files", "ls-tree", "rev-parse", "describe", "shortlog", "reflog",
		"fetch", "pull", "clone", "remote", "branch", "tag", "stash", "config", "add", "commit", "switch", "worktree", "submodule", "cat-file", "whatchanged", "version", "help"]),
	npm: new Set(["install", "i", "ci", "test", "t", "run", "run-script", "start", "ls", "list", "view", "info", "outdated", "audit", "exec", "init", "pack", "help", "version", "doctor", "explain", "why", "config"]),
	pnpm: new Set(["install", "i", "add", "test", "run", "exec", "ls", "list", "outdated", "audit", "why", "dlx", "build", "dev", "start"]),
	yarn: new Set(["install", "add", "test", "run", "list", "outdated", "audit", "why", "dlx", "build", "dev", "start", "info"]),
	pip: new Set(["install", "download", "list", "show", "freeze", "check", "index", "help", "config", "cache", "wheel", "inspect"]),
	uv: new Set(["pip", "sync", "run", "add", "lock", "venv", "tree", "python", "tool", "version", "help", "init", "export"]),
	poetry: new Set(["install", "add", "run", "show", "lock", "check", "build", "env", "version", "init"]),
	cargo: new Set(["build", "b", "test", "t", "check", "c", "run", "r", "fetch", "tree", "doc", "bench", "clippy", "fmt", "metadata", "search", "add", "update", "new", "init", "version"]),
	go: new Set(["build", "test", "run", "vet", "mod", "get", "list", "env", "version", "doc", "fmt", "generate", "work", "tool"]),
	brew: new Set(["info", "list", "ls", "search", "install", "outdated", "deps", "uses", "config", "doctor", "home", "desc", "--prefix", "--version"]),
	docker: new Set(["ps", "images", "logs", "inspect", "build", "pull", "version", "info", "compose", "stats", "top", "history", "search"]),
	conda: new Set(["install", "list", "info", "search", "create", "env", "activate"]),
	mamba: new Set(["install", "list", "info", "search", "create", "env", "activate"]),
	gem: new Set(["install", "list", "search", "info", "env", "contents"]),
	bundle: new Set(["install", "exec", "list", "show", "outdated", "check", "info"]),
	dotnet: new Set(["build", "test", "run", "restore", "list", "--info", "--version", "new"]),
	pi: new Set(["--version", "--help", "--list-models"]),
};
SOUS_COMMANDES.pip3 = SOUS_COMMANDES.pip;

// Formes dangereuses d'outils par ailleurs sûrs.
const MOTIFS_RISQUES: [RegExp, string][] = [
	[/\bfind\b[^|;&]*\s-(delete|exec|execdir|ok|okdir|fprint\w*|fls)\b/, "find -delete / -exec"],
	[/\bsed\b[^|;&]*\s-(i|-in-place)\b|\bsed\b[^|;&]*\s-[a-zA-Z]*i/, "sed -i (modifie des fichiers)"],
	[/\bgit\s+(push|reset|clean|checkout|restore|rebase|filter-branch|filter-repo|gc|prune|update-ref|rm|mv)\b/, "git qui réécrit ou publie"],
	[/\bgit\s+branch\s+.*-[dDmMcC]\b|\bgit\s+tag\s+.*-d\b|\bgit\s+stash\s+(drop|clear|pop)\b|\bgit\s+remote\s+(remove|rm|set-url|add)\b|\bgit\s+config\s+(?!--get|-l|--list)/, "git qui supprime ou reconfigure"],
	[/\bgit\s+commit\b.*--amend|\bgit\s+push\b|--force\b|\s-f\b.*\bgit\b|\bgit\b.*\s--hard\b/, "git forcé"],
	[/\bnpm\s+(publish|unpublish|deprecate|owner|token|adduser|login)\b|\byarn\s+publish\b|\bpnpm\s+publish\b|\bcargo\s+publish\b|\btwine\b|\bgem\s+push\b/, "publication de paquet"],
	[/\b(curl|wget)\b[^;&]*\|\s*(sudo\s+)?(sh|bash|zsh|python3?|perl|ruby|node)\b/, "script téléchargé exécuté directement"],
	[/\bcurl\b[^|;&]*\s-(X|-request)\s*(DELETE|PUT|PATCH|POST)\b|\bcurl\b[^|;&]*\s(-d|--data\S*|-F|--form|-T|--upload-file)\b/, "curl qui envoie ou modifie des données"],
	[/\bdocker\s+(compose\s+)?(rm|rmi|down|kill|stop|prune|system|volume|network)\b/, "docker qui supprime ou arrête"],
	[/\b(brew)\s+(uninstall|remove|rm|cleanup|untap|reinstall)\b/, "brew qui désinstalle"],
	[/\b(pip3?|uv\s+pip|conda|mamba)\s+(uninstall|remove)\b|\bnpm\s+(uninstall|un|rm|remove|prune)\b|\b(pnpm|yarn)\s+remove\b/, "désinstallation"],
	[/\b(rmtree|os\.remove|os\.unlink|os\.rmdir|shutil\.move|unlinkSync|rmSync|rmdirSync|fs\.rm\b|rimraf|File\.delete|Path\(.*\)\.unlink|\.unlink\()/, "suppression dans un script"],
	[/\btar\b[^|;&]*\s--(remove-files|overwrite|unlink-first)\b/, "tar qui supprime ou écrase"],
	[/\b(os\.system|subprocess\.\w+|child_process|execSync|spawnSync|Runtime\.getRuntime)\b/, "script qui lance d'autres commandes"],
	[/\bunzip\b[^|;&]*\s-o\b/, "unzip qui écrase"],
];

// Mots de commande toujours sensibles, même en position d'argument de xargs, env, nohup…
const DANGEREUX = new Set([
	"rm", "rmdir", "unlink", "shred", "srm", "mv", "cp", "dd", "mkfs", "fdisk", "diskutil", "format", "truncate", "chmod", "chown",
	"chgrp", "chflags", "xattr", "ln", "kill", "pkill", "killall", "shutdown", "reboot", "halt", "poweroff", "sudo", "su", "doas",
	"crontab", "launchctl", "systemctl", "service", "defaults", "scutil", "networksetup", "csrutil", "spctl", "mount", "umount",
	"iptables", "pfctl", "useradd", "userdel", "usermod", "passwd", "visudo", "eval", "exec", "source", ".", "xargs", "parallel",
	"nohup", "osascript", "open", "security", "ssh", "scp", "rsync", "sftp", "ftp", "nc", "ncat", "telnet", "tee", "install",
	"rename", "sh", "bash", "zsh", "fish", "ksh", "csh", "dash", "trash",
]);

const PREFIXES = new Set(["env", "time", "nice", "command", "builtin", "caffeinate"]);

export interface Verdict {
	inoffensive: boolean;
	raison?: string;
}

function morceaux(commande: string): string[] {
	return commande
		.replace(/\\\n/g, " ")
		.replace(/"[^"]*"|'[^']*'/g, '""')
		.replace(/\d*>&\d+|&>/g, " ")
		.split(/\n|;|&&|\|\||\||&|\$\(|`|\(|\)/)
		.map((m) => m.trim())
		.filter(Boolean);
}

function mots(morceau: string): string[] {
	return (morceau.match(/"[^"]*"|'[^']*'|\S+/g) ?? []).map((m) => m.replace(/^["']|["']$/g, ""));
}

/** La commande peut-elle s'exécuter sans demander, en mode /yom ? */
export function trier(commande: string): Verdict {
	const c = commande.trim();
	if (!c) return { inoffensive: false, raison: "commande vide" };
	for (const [re, raison] of MOTIFS_RISQUES) if (re.test(c)) return { inoffensive: false, raison };
	const cachee = /(^|[\s"'`;(=|&])(rm|rmdir|mv|dd|chmod|chown|sudo|shred|kill|pkill|truncate)\s+[-\w./~$"']/.exec(c);
	if (cachee) return { inoffensive: false, raison: `commande « ${cachee[2]} »` };
	const redirection = /(^|[^0-9&<>])>{1,2}\s*(?!&|\/dev\/(null|stdout|stderr)\b)[^\s>]/.exec(c.replace(/'[^']*'|"[^"]*"/g, '""'));
	if (redirection) return { inoffensive: false, raison: "écriture dans un fichier (>)" };
	for (const morceau of morceaux(c)) {
		const m = mots(morceau);
		let i = 0;
		while (i < m.length && (/^[A-Za-z_][A-Za-z0-9_]*=/.test(m[i]) || PREFIXES.has(m[i]))) i++;
		const nom = (m[i] ?? "").replace(/^.*\//, "");
		if (!nom) continue;
		if (DANGEREUX.has(nom)) return { inoffensive: false, raison: `commande « ${nom} »` };
		if (!SURS.has(nom)) return { inoffensive: false, raison: `commande inconnue « ${nom} »` };
		const sous = SOUS_COMMANDES[nom];
		if (sous) {
			const s = m.slice(i + 1).find((x) => !x.startsWith("-") || x.startsWith("--version") || x.startsWith("--info") || x === "--prefix" || x === "--help" || x === "--list-models");
			if (s !== undefined && !sous.has(s)) return { inoffensive: false, raison: `« ${nom} ${s} »` };
		}
		if (m.slice(i + 1).some((x) => DANGEREUX.has(x) && /^(rm|mv|cp|dd|chmod|chown|kill|sudo|shred)$/.test(x)))
			return { inoffensive: false, raison: "commande sensible en argument" };
	}
	return { inoffensive: true };
}
