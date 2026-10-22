// D'où viennent les mises à jour : le site d'abord, le dépôt GitHub en secours.
//
// Le site (PI_ARISTOTE_SITE) sert VERSION, install.sh et pi-aristote.tar.gz.
// S'il ne répond pas, VERSION et install.sh sont lus sur raw.githubusercontent.com
// (PI_ARISTOTE_RAW), et l'installateur prend l'archive du dépôt sur
// codeload.github.com (PI_ARISTOTE_ARCHIVE, lue par install.sh). Une variable
// vide coupe le secours correspondant. Jamais de repli vers les Pages du LISN :
// elles servent une 1.7.1 figée, ce serait un retour en arrière.

export const DEFAULT_SITE = "https://thegreeklibrary.org/pi-aristote";
export const DEFAULT_RAW = "https://raw.githubusercontent.com/l-pommeret/pi-aristote/main";
export const DEFAULT_ARCHIVE = "https://codeload.github.com/l-pommeret/pi-aristote/tar.gz/refs/heads/main";

export interface Sources {
	site: string;
	raw: string;
}

const sansBarre = (url: string) => url.replace(/\/+$/, "");

export function sources(env: NodeJS.ProcessEnv = process.env): Sources {
	return {
		site: sansBarre(env.PI_ARISTOTE_SITE || DEFAULT_SITE),
		raw: sansBarre(env.PI_ARISTOTE_RAW ?? DEFAULT_RAW),
	};
}

export const isVersion = (v: string) => /^\d+\.\d+\.\d+$/.test(v);

export const newer = (a: string, b: string) => {
	const pa = a.split(".").map(Number);
	const pb = b.split(".").map(Number);
	for (let i = 0; i < 3; i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) > (pb[i] ?? 0);
	return false;
};

export const versionUrls = (s: Sources) => [`${s.site}/VERSION`, ...(s.raw ? [`${s.raw}/extensions/aristote/VERSION`] : [])];

// Première réponse de la forme 1.2.3, dans l'ordre : site, puis GitHub. Une
// page d'erreur servie en 200 (portail captif…) compte comme une panne.
export async function remoteVersion(s: Sources, fetchImpl: typeof fetch = fetch, timeoutMs = 5000): Promise<string | undefined> {
	for (const url of versionUrls(s)) {
		try {
			const r = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs) });
			if (!r.ok) continue;
			const v = (await r.text()).trim();
			if (isVersion(v)) return v;
		} catch {}
	}
	return undefined;
}

// Lancé par /maj : sh -c UPDATE_SCRIPT sh <site> <raw>. Télécharge install.sh
// (site, puis GitHub), vérifie que c'en est bien un, puis le lance en mode
// automatique : seule l'extension est remplacée, aucune configuration.
export const UPDATE_SCRIPT = `set -u
get() {
	i="$(curl -fsSL --connect-timeout 10 --max-time 60 "$1/install.sh")" || return 1
	case "$i" in "#!/bin/sh"*) return 0 ;; esac
	echo "Réponse inattendue de $1 : ce n'est pas install.sh." >&2
	return 1
}
if ! get "$1"; then
	[ -n "$2" ] || exit 1
	echo "Site injoignable ($1) : passage par GitHub." >&2
	get "$2" || exit 1
fi
printf '%s\\n' "$i" | PI_ARISTOTE_AUTO=1 sh`;

export const UPDATE_TIMEOUT_MS = 10 * 60 * 1000;

export const updateArgs = (s: Sources) => ["-c", UPDATE_SCRIPT, "sh", s.site, s.raw];
