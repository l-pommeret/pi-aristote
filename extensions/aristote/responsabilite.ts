import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { rgb } from "./ui.ts";

// Mise à jour de la responsabilité (1.9.0) : avant chaque commande lancée par le
// modèle, pi demande l'accord de l'utilisateur. `pi --yolo` ou `/yolo` s'en passent.
// Les sous-agents d'Ultracode (pi -p, sans interface) héritent du choix par la
// variable ARISTOTE_YOLO ; sans elle, leurs commandes sont refusées.

const COMMANDES = new Set(["bash", "powershell"]);

export const REFUS_SANS_INTERFACE =
	"Commande refusée : pi-aristote demande votre accord avant chaque commande, et il n'y a pas d'interface pour le donner. Relancez avec pi --yolo (ou tapez /yolo) pour exécuter sans confirmation.";
export const REFUS_UTILISATEUR = "L'utilisateur a refusé cette commande. Ne la relance pas telle quelle : demande-lui ce qu'il préfère.";

export function yoloActif(flag: unknown, env = process.env): boolean {
	return flag === true || env.ARISTOTE_YOLO === "1";
}

export function setYolo(on: boolean, env = process.env) {
	if (on) env.ARISTOTE_YOLO = "1";
	else delete env.ARISTOTE_YOLO;
}

/** Décision pour un appel d'outil : undefined (laisser passer) ou un refus. */
export async function decider(
	toolName: string,
	input: any,
	yolo: boolean,
	ui: { hasUI: boolean; confirm?: (titre: string, texte: string) => Promise<boolean> },
): Promise<{ block: true; reason: string } | undefined> {
	if (!COMMANDES.has(toolName) || yolo) return;
	if (!ui.hasUI || !ui.confirm) return { block: true, reason: REFUS_SANS_INTERFACE };
	const commande = String(input?.command ?? "").trim() || "(commande vide)";
	const ok = await ui.confirm("Φ Exécuter cette commande ?", commande);
	return ok ? undefined : { block: true, reason: REFUS_UTILISATEUR };
}

export const AVERTISSEMENT_F1 =
	"Vous êtes sûrs ??? Vous savez ce que vous faites. Un moteur de F1 implique de savoir conduire.";

// Couleurs qui tournent : la ligne d'état « /yolo » clignote en multicolore.
const ARC = [[230, 57, 70], [224, 122, 69], [242, 188, 60], [124, 200, 90], [26, 140, 166], [110, 90, 220], [200, 80, 190]];
export function cligno(texte: string, phase: number): string {
	if (phase % 2 === 1) return " ".repeat([...texte].length); // le clignotement
	return [...texte].map((ch, i) => (ch === " " ? ch : rgb(ARC[(i + phase) % ARC.length], ch))).join("");
}

export function installResponsabilite(pi: ExtensionAPI) {
	let minuterie: ReturnType<typeof setInterval> | undefined;
	const afficher = (ctx: any) => {
		if (minuterie) clearInterval(minuterie);
		minuterie = undefined;
		if (ctx?.mode !== "tui" || process.env.ARISTOTE_SUBAGENT === "1") return;
		if (yoloActif(pi.getFlag("yolo"))) {
			ctx.ui.setStatus("aristote-yolo", rgb([230, 57, 70], "Φ yolo : commandes sans confirmation"));
			return;
		}
		let phase = 0;
		const texte = "Φ /yolo : lancer les commandes sans confirmation";
		const tick = () => ctx.ui.setStatus("aristote-yolo", cligno(texte, phase++ % 6 === 5 ? 1 : phase * 2));
		tick();
		minuterie = setInterval(tick, 350);
		(minuterie as any).unref?.();
	};
	pi.on("session_start", async (_e: any, ctx: any) => {
		afficher(ctx);
		if (pi.getFlag("yolo") === true && ctx.mode === "tui") ctx.ui.notify(`Φ --yolo. ${AVERTISSEMENT_F1}`, "warning");
	});

	pi.registerFlag("yolo", {
		description: "Exécuter les commandes du modèle sans demander confirmation",
		type: "boolean",
		default: false,
	});

	pi.on("tool_call", async (event: any, ctx: any) => {
		const flag = pi.getFlag("yolo");
		if (flag === true) setYolo(true); // transmis aux sous-agents
		return decider(event.toolName, event.input, yoloActif(flag), {
			hasUI: !!ctx.hasUI,
			confirm: ctx.hasUI ? (t: string, m: string) => ctx.ui.confirm(t, m) : undefined,
		});
	});

	pi.registerCommand("yolo", {
		description: "Φ Commandes sans confirmation : on ou off",
		getArgumentCompletions: (p: string) => ["on", "off"].filter((v) => v.startsWith(p)).map((v) => ({ value: v, label: v })),
		handler: async (args: string, ctx: any) => {
			const v = args.trim().toLowerCase();
			const on = v === "on" ? true : v === "off" ? false : !yoloActif(pi.getFlag("yolo"));
			if (!on && pi.getFlag("yolo") === true) {
				ctx.ui.notify("Φ pi a été lancé avec --yolo : relancez-le sans l'option pour retrouver les confirmations.", "warning");
				return;
			}
			if (on && !yoloActif(pi.getFlag("yolo"))) {
				const sur = ctx.hasUI ? await ctx.ui.confirm("Φ /yolo", AVERTISSEMENT_F1) : false;
				if (!sur) {
					ctx.ui.notify("Φ Sage décision : pi continue de demander votre accord avant chaque commande.", "info");
					return;
				}
			}
			setYolo(on);
			afficher(ctx);
			ctx.ui.notify(
				on
					? "Φ Mode yolo : les commandes du modèle s'exécutent sans confirmation. Vous en restez responsable. /yolo off pour revenir aux confirmations."
					: "Φ Confirmations rétablies : pi demande votre accord avant chaque commande.",
				on ? "warning" : "info",
			);
		},
	});
}
