// D'où viennent les mises à jour : les Pages du LISN. Des secours (miroirs, dépôt
// Git) restent possibles par variables d'environnement, vides par défaut.
//
// Chaque site (PI_ARISTOTE_SITE, puis PI_ARISTOTE_MIRRORS, séparés par des
// espaces) sert VERSION, install.sh et pi-aristote.tar.gz. Si aucun ne convient,
// VERSION et install.sh sont lus sur raw.githubusercontent.com (PI_ARISTOTE_RAW),
// et l'installateur prend l'archive du dépôt sur codeload.github.com
// (PI_ARISTOTE_ARCHIVE, lue par install.sh). Une variable vide coupe le secours
// correspondant.
//
// Un secours ne fait jamais redescendre : une source qui sert une version plus
// ancienne que celle installée est ignorée, et l'installateur refait la même
// vérification sur l'archive qu'il télécharge.

export const DEFAULT_SITE = "https://vibe-coding.pages.lisn.upsaclay.fr/pi-aristote";
export const DEFAULT_MIRRORS = "";
export const DEFAULT_RAW = "";
export const DEFAULT_ARCHIVE = "";

export interface Sources {
	site: string;
	mirrors: string[];
	raw: string;
}

const sansBarre = (url: string) => url.replace(/\/+$/, "");

export function sources(env: NodeJS.ProcessEnv = process.env): Sources {
	const site = sansBarre(env.PI_ARISTOTE_SITE || DEFAULT_SITE);
	const mirrors = (env.PI_ARISTOTE_MIRRORS ?? DEFAULT_MIRRORS)
		.split(/\s+/)
		.filter(Boolean)
		.map(sansBarre)
		.filter((m, i, tous) => m !== site && tous.indexOf(m) === i);
	return { site, mirrors, raw: sansBarre(env.PI_ARISTOTE_RAW ?? DEFAULT_RAW) };
}

export const sites = (s: Sources) => [s.site, ...s.mirrors];

export const isVersion = (v: string) => /^\d+\.\d+\.\d+$/.test(v);

export const newer = (a: string, b: string) => {
	const pa = a.split(".").map(Number);
	const pb = b.split(".").map(Number);
	for (let i = 0; i < 3; i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) > (pb[i] ?? 0);
	return false;
};

export const versionUrls = (s: Sources) => [...sites(s).map((x) => `${x}/VERSION`), ...(s.raw ? [`${s.raw}/extensions/aristote/VERSION`] : [])];

// Dans l'ordre (LISN, miroirs, GitHub), la première réponse de la forme 1.2.3
// qui n'est pas plus ancienne que la version installée. Une page d'erreur servie
// en 200 (portail captif…) compte comme une panne ; un miroir en retard est
// sauté, comme dans /maj.
export async function remoteVersion(s: Sources, local = "", fetchImpl: typeof fetch = fetch, timeoutMs = 5000): Promise<string | undefined> {
	for (const url of versionUrls(s)) {
		try {
			const r = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs) });
			if (!r.ok) continue;
			const v = (await r.text()).trim();
			if (isVersion(v) && !(isVersion(local) && newer(local, v))) return v;
		} catch {}
	}
	return undefined;
}

// Lancé par /maj : sh -c UPDATE_SCRIPT sh <version installée> <raw> <site> <miroirs…>.
// Pour chaque source, dans l'ordre : lit VERSION ; plus ancienne que la version
// installée, la source est sautée ; égale, l'extension est à jour ; plus
// récente, install.sh de cette même source est téléchargé, vérifié, et lancé en
// mode automatique (seule l'extension est remplacée, aucune configuration) avec
// PI_ARISTOTE_SITE pointé sur cette source : un ancien installateur servi par un
// miroir prend donc l'archive du miroir, pas celle d'un autre site. Pour GitHub,
// PI_ARISTOTE_SITE_KO=1 dit à l'installateur d'aller directement à l'archive.
export const UPDATE_SCRIPT = `set -u
ici="$1"
raw="$2"
shift 2
est_version() { printf '%s\\n' "$1" | grep -Eq '^[0-9]+\\.[0-9]+\\.[0-9]+$'; }
est_version "$ici" || ici=0.0.0
# $1 >= $2, pour des versions 1.2.3.
au_moins() { awk -v a="$1" -v b="$2" 'BEGIN { split(a, x, "."); split(b, y, "."); for (i = 1; i <= 3; i++) { if (x[i] + 0 > y[i] + 0) exit 0; if (x[i] + 0 < y[i] + 0) exit 1 } exit 0 }'; }
plus_ancienne=""
# essayer <nom> <url de VERSION> <url de install.sh> <site pour l'installateur> <site injoignable>
essayer() {
	v="$(curl -fsSL --connect-timeout 10 --max-time 20 "$2" 2>/dev/null | tr -d '[:space:]')"
	if ! est_version "$v"; then
		echo "$1 injoignable (ou VERSION illisible) : source suivante." >&2
		return 1
	fi
	if ! au_moins "$v" "$ici"; then
		echo "$1 sert la $v, plus ancienne que la $ici installée : ignoré." >&2
		plus_ancienne=1
		return 1
	fi
	if [ "$v" = "$ici" ]; then
		echo "Extension déjà à jour ($ici, d'après $1)."
		exit 0
	fi
	if ! i="$(curl -fsSL --connect-timeout 10 --max-time 60 "$3")"; then
		echo "$1 : install.sh injoignable, source suivante." >&2
		return 1
	fi
	case "$i" in
		"#!/bin/sh"*) ;;
		*) echo "Réponse inattendue de $1 : ce n'est pas install.sh." >&2; return 1 ;;
	esac
	echo "Mise à jour $ici → $v depuis $1." >&2
	printf '%s\\n' "$i" | PI_ARISTOTE_AUTO=1 PI_ARISTOTE_SITE="$4" PI_ARISTOTE_MIRRORS="" PI_ARISTOTE_SITE_KO="$5" sh
	exit $?
}
premier="\${1:-}"
for site in "$@"; do
	essayer "$site" "$site/VERSION" "$site/install.sh" "$site" ""
done
if [ -n "$raw" ]; then
	essayer GitHub "$raw/extensions/aristote/VERSION" "$raw/install.sh" "$premier" 1
fi
if [ -n "$plus_ancienne" ]; then
	echo "Aucune source ne sert de version plus récente que la $ici installée."
	exit 0
fi
echo "Mise à jour impossible : aucune source n'a répondu." >&2
exit 1`;

export const UPDATE_TIMEOUT_MS = 10 * 60 * 1000;

export const updateArgs = (s: Sources, local: string) => ["-c", UPDATE_SCRIPT, "sh", local, s.raw, ...sites(s)];

// La source d'où vient la mise à jour, telle que UPDATE_SCRIPT l'annonce.
export const updateSource = (stderr: string) => /^Mise à jour \S+ → \S+ depuis (\S+)\.$/m.exec(stderr)?.[1];
