#!/bin/sh
# Installe (ou met à jour) pi + l'extension Aristote.
#   curl -fsSL https://vibe-coding.pages.lisn.upsaclay.fr/pi-aristote/install.sh | sh
set -eu

SITE="${PI_ARISTOTE_SITE:-https://vibe-coding.pages.lisn.upsaclay.fr/pi-aristote}"
AGENT_DIR="${PI_CODING_AGENT_DIR:-$HOME/.pi/agent}"
PRIVATE_NODE="$HOME/.local/share/pi-aristote/node"
NODE_MIN_MAJOR=22
NODE_MIN_MINOR=19
AUTO="${PI_ARISTOTE_AUTO:-}"

if [ -t 1 ]; then
	J="$(printf '\033[38;2;242;188;60m')"; O="$(printf '\033[38;2;224;122;69m')"; S="$(printf '\033[38;2;26;140;166m')"
	G="$(printf '\033[38;2;127;199;154m')"; R="$(printf '\033[38;2;232;96;76m')"; D="$(printf '\033[2m')"; B="$(printf '\033[1m')"; Z="$(printf '\033[0m')"
else
	J=""; O=""; S=""; G=""; R=""; D=""; B=""; Z=""
fi
say() { printf '%s◆%s %s\n' "$J" "$Z" "$1"; }
ok() { printf '%s✓%s %s\n' "$G" "$Z" "$1"; }
die() { printf '%s✗ %s%s\n' "$R" "$1" "$Z" >&2; exit 1; }
has_tty() { [ -z "$AUTO" ] && (exec </dev/tty) 2>/dev/null; }
ask() {
	has_tty || return 0
	REPLY=""
	printf '%s' "$1" >/dev/tty
	IFS= read -r REPLY </dev/tty || REPLY=""
}
ask_secret() {
	REPLY=""
	has_tty || return 0
	printf '%s' "$1" >/dev/tty
	stty -echo </dev/tty 2>/dev/null || true
	IFS= read -r REPLY </dev/tty || REPLY=""
	stty echo </dev/tty 2>/dev/null || true
	printf '\n' >/dev/tty
}

if [ -z "$AUTO" ]; then
	printf '\n%s ╔═╗╦═╗╦╔═╗╔╦╗╔═╗╔╦╗╔═╗%s\n' "$S" "$Z"
	printf '%s ╠═╣╠╦╝║╚═╗ ║ ║ ║ ║ ║╣ %s\n' "$O" "$Z"
	printf '%s ╩ ╩╩╚═╩╚═╝ ╩ ╚═╝ ╩ ╚═╝%s  %spi, l'"'"'agent de code, pour Aristote%s\n\n' "$J" "$Z" "$D" "$Z"
fi

[ -z "$AUTO" ] && ! command -v pi >/dev/null 2>&1 && printf '  %sPremière installation : compte 1 à 2 minutes.%s\n\n' "$D" "$Z"
command -v curl >/dev/null 2>&1 || die "curl est requis."
command -v tar >/dev/null 2>&1 || die "tar est requis."

node_ok() {
	command -v node >/dev/null 2>&1 || return 1
	node -e "const [a,b]=process.versions.node.split('.').map(Number);process.exit(a>$NODE_MIN_MAJOR||(a===$NODE_MIN_MAJOR&&b>=$NODE_MIN_MINOR)?0:1)" 2>/dev/null
}

install_private_node() {
	case "$(uname -s)" in Darwin) os=darwin ;; Linux) os=linux ;; *) die "Système non pris en charge : $(uname -s)" ;; esac
	case "$(uname -m)" in arm64 | aarch64) arch=arm64 ;; x86_64 | amd64) arch=x64 ;; *) die "Architecture non prise en charge : $(uname -m)" ;; esac
	if [ "$os" = darwin ] || command -v xz >/dev/null 2>&1; then fmt=tar.xz; flag=-xJf; size="≈ 27 Mo"; else fmt=tar.gz; flag=-xzf; size="≈ 53 Mo"; fi
	say "Installation d'une version privée de Node.js, sans sudo ($size, c'est l'étape la plus longue)…"
	version="$(curl -fsSL https://nodejs.org/dist/index.json 2>/dev/null | tr '{' '\n' | sed -n '/"lts":"/{s/.*"version":"\(v[0-9.]*\)".*/\1/p;q;}')"
	[ -n "$version" ] || die "Impossible de trouver la dernière version de Node.js."
	tmp="$(mktemp -d)"
	if [ -t 2 ]; then progress="--progress-bar"; else progress="-s"; fi
	curl -fSL $progress "https://nodejs.org/dist/$version/node-$version-$os-$arch.$fmt" -o "$tmp/node.archive" || die "Téléchargement de Node.js impossible."
	rm -rf "$PRIVATE_NODE"
	mkdir -p "$PRIVATE_NODE"
	tar $flag "$tmp/node.archive" -C "$PRIVATE_NODE" --strip-components=1
	rm -rf "$tmp"
	PATH="$PRIVATE_NODE/bin:$PATH"
	export PATH
	add_to_path "$PRIVATE_NODE/bin"
	ok "Node.js $version installé dans $PRIVATE_NODE"
}

add_to_path() {
	line="export PATH=\"$1:\$PATH\""
	case "${SHELL:-}" in
		*zsh) rc="$HOME/.zshrc" ;;
		*bash) [ "$(uname -s)" = Darwin ] && rc="$HOME/.bash_profile" || rc="$HOME/.bashrc" ;;
		*) rc="$HOME/.profile" ;;
	esac
	if ! grep -qs "$1" "$rc"; then
		printf '\n# pi-aristote\n%s\n' "$line" >>"$rc"
		PATH_CHANGED=1
	fi
}

PATH_CHANGED=""
[ -x "$PRIVATE_NODE/bin/node" ] && PATH="$PRIVATE_NODE/bin:$PATH" && export PATH
node_ok || install_private_node

with_spinner() {
	label="$1"
	shift
	if [ ! -t 1 ]; then
		"$@"
		return
	fi
	"$@" &
	pid=$!
	start=$(date +%s)
	i=0
	while kill -0 "$pid" 2>/dev/null; do
		case $((i % 8)) in 0) f=α ;; 1) f=β ;; 2) f=γ ;; 3) f=δ ;; 4) f=ε ;; 5) f=ζ ;; 6) f=η ;; *) f=θ ;; esac
		printf '\r%s%s%s %s %s%ss%s ' "$J" "$f" "$Z" "$label" "$D" "$(($(date +%s) - start))" "$Z"
		i=$((i + 1))
		sleep 0.15
	done
	printf '\r\033[K'
	wait "$pid"
}
npm_pi() { npm install -g --ignore-scripts --no-audit --no-fund --loglevel=error @earendil-works/pi-coding-agent >"$NPM_LOG" 2>&1; }

if ! command -v pi >/dev/null 2>&1; then
	NPM_LOG="$(mktemp)"
	if ! with_spinner "Installation de pi (environ 30 s)…" npm_pi; then
		[ -x "$PRIVATE_NODE/bin/node" ] || install_private_node
		with_spinner "Installation de pi (environ 30 s)…" npm_pi || { tail -5 "$NPM_LOG" >&2; die "Installation de pi impossible (npm)."; }
	fi
	rm -f "$NPM_LOG"
	ok "pi $(pi --version 2>/dev/null || echo installé)"
else
	ok "pi déjà présent ($(pi --version 2>/dev/null))"
fi

say "Téléchargement de l'extension Aristote…"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
curl -fsSL "$SITE/pi-aristote.tar.gz" -o "$tmp/ext.tgz" || die "Téléchargement de l'extension impossible ($SITE)."
mkdir -p "$AGENT_DIR/extensions" "$AGENT_DIR/themes"
rm -rf "$AGENT_DIR/extensions/aristote"
tar -xzf "$tmp/ext.tgz" -C "$AGENT_DIR"
ok "Extension $(cat "$AGENT_DIR/extensions/aristote/VERSION" 2>/dev/null) installée dans $AGENT_DIR/extensions/aristote"

[ -n "$AUTO" ] && exit 0

# Ancienne config Aristote dans models.json : elle masquerait l'extension.
AGENT_DIR="$AGENT_DIR" node -e '
const fs = require("fs"), p = process.env.AGENT_DIR + "/models.json";
try {
	const m = JSON.parse(fs.readFileSync(p, "utf8"));
	if (m.providers && m.providers.aristote) {
		fs.copyFileSync(p, p + ".avant-pi-aristote");
		delete m.providers.aristote;
		fs.writeFileSync(p, JSON.stringify(m, null, 2) + "\n");
		console.log("  ancienne configuration Aristote retirée de models.json (copie : models.json.avant-pi-aristote)");
	}
} catch {}'

has_key="$(AGENT_DIR="$AGENT_DIR" node -e '
try { const a = require(process.env.AGENT_DIR + "/auth.json"); process.stdout.write(a.aristote && a.aristote.key ? "1" : ""); } catch {}')"

if [ -z "$has_key" ] && [ -z "${ARISTOTE_API_KEY:-}" ]; then
	printf '\n'
	say "Il faut ta clé API Aristote (elle commence par ${B}sk-${Z})."
	printf '  %sTu la trouves ici, après connexion avec ton compte universitaire :%s %s%s%s\n' "$D" "$Z" "$S" "https://aristote.education/llm-access/" "$Z"
	while :; do
		ask_secret "  Colle-la ici (rien ne s'affiche, c'est normal) : "
		key="$(printf '%s' "$REPLY" | tr -d '[:space:]')"
		[ -z "$key" ] && { printf '  %sPas de clé : récupère-la sur https://aristote.education/llm-access/ puis tape /aristote key sk-… dans pi%s\n' "$D" "$Z"; break; }
		code="$(curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $key" https://llm.aristote.education/v1/models || true)"
		if [ "$code" = 200 ]; then
			AGENT_DIR="$AGENT_DIR" KEY="$key" node -e '
const fs = require("fs"), p = process.env.AGENT_DIR + "/auth.json";
let a = {}; try { a = JSON.parse(fs.readFileSync(p, "utf8")); } catch {}
a.aristote = { type: "api_key", key: process.env.KEY };
fs.writeFileSync(p, JSON.stringify(a, null, 2) + "\n", { mode: 0o600 }); fs.chmodSync(p, 0o600);'
			ok "Clé vérifiée et enregistrée"
			break
		fi
		printf '  %sAristote refuse cette clé (HTTP %s). Réessaie, ou appuie sur Entrée pour passer.%s\n' "$R" "$code" "$Z"
	done
fi

REPLY=n
ask "$(printf '\n%s◆%s Utiliser Aristote par défaut quand tu lances pi ? [O/n] ' "$J" "$Z")"
case "$REPLY" in
	n | N | non | Non) ;;
	*)
		AGENT_DIR="$AGENT_DIR" node -e '
const fs = require("fs"), p = process.env.AGENT_DIR + "/settings.json";
let s = {}; try { s = JSON.parse(fs.readFileSync(p, "utf8")); } catch {}
s.defaultProvider = "aristote"; s.defaultModel = "qwen-3.8-27b";
fs.writeFileSync(p, JSON.stringify(s, null, 2) + "\n");'
		ok "Aristote (qwen-3.8-27b) est le modèle par défaut"
		;;
esac

printf '\n%s%s C'"'"'est prêt !%s Dans n'"'"'importe quel dossier de code, tape %spi%s.\n' "$G" "$B" "$Z" "$B" "$Z"
printf '  %sAlt+U : mode Ultracode · /peripateticien, /euclide, /hephaistos, /socrate : disciples · /aristote : état%s\n' "$D" "$Z"
[ -z "$PATH_CHANGED" ] || printf '  %sOuvre un nouveau terminal pour que la commande pi soit trouvée.%s\n' "$O" "$Z"

REPLY=n
ask "$(printf '\n%s◆%s Lancer pi maintenant ? [O/n] ' "$J" "$Z")"
case "$REPLY" in
	n | N | non | Non) ;;
	*) if has_tty; then exec pi </dev/tty; fi ;;
esac
exit 0
