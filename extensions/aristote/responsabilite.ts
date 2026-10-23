import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

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

export function installResponsabilite(pi: ExtensionAPI) {
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
			setYolo(on);
			ctx.ui.notify(
				on
					? "Φ Mode yolo : les commandes du modèle s'exécutent sans confirmation. Vous en restez responsable. /yolo off pour revenir aux confirmations."
					: "Φ Confirmations rétablies : pi demande votre accord avant chaque commande.",
				on ? "warning" : "info",
			);
		},
	});
}
