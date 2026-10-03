# pi × Aristote

[pi](https://pi.dev), l'agent de code open source, optimisé pour les modèles souverains d'[Aristote](https://aristote.education).

**Page d'installation : https://vibe-coding.pages.lisn.upsaclay.fr/pi-aristote/**

```sh
curl -fsSL https://vibe-coding.pages.lisn.upsaclay.fr/pi-aristote/install.sh | sh
```

Avant tout, récupère ta clé API sur **https://aristote.education/llm-access/** (connexion avec ton compte universitaire : Université Paris-Saclay et universités associées). Elle commence par `sk-`.

La commande installe Node.js si besoin (version privée, sans sudo), pi, l'extension et le thème, puis demande ta clé API Aristote. Pour mettre à jour ensuite : `/maj` dans pi.

L'installateur ne casse pas une configuration existante (voir plus bas).

## Ce que fait l'extension

- **Modèles automatiques** : la liste vient de `llm.aristote.education` à chaque lancement (avec cache). Les nouveaux modèles sont mesurés (contexte, images, réflexion), les modèles en panne masqués.
- **Relance des réponses vides** : la passerelle renvoie parfois un flux vide ; la requête est relancée sans qu'on le voie.
- **Contexte maîtrisé** : `max_tokens` est ajusté à la place restante, les requêtes restent sous la limite de 1 Mio de la passerelle, et les dépassements déclenchent la compaction de pi.
- **Garde-fou** (Φ) : un modèle qui annonce une action sans appeler d'outil, ou qui tourne en boucle, est relancé (deux fois au plus) ; une vraie conclusion n'est jamais relancée.
- **Mode Ultracode** (Ω, `Alt+U`, `/ultracode` ou le mot « ultracode ») : le modèle dirige une équipe de disciples, de vrais processus pi qui travaillent en parallèle, puis fait la synthèse. `Ctrl+O` déplie leurs comptes rendus.
- **Disciples à la demande**, suivis d'une mission : `/peripateticien` (π, exploration sans rien modifier), `/euclide` (ε, plan), `/hephaistos` (η, implémentation), `/socrate` (σ, relecture et tests), `/sappho` (λ, documentation, messages de commit).
- **Navigateur visible** (θ) : sur simple demande (« cherche… »), l'outil `browser` ouvre une fenêtre (Chrome, Brave, Edge… déjà installé, profil dédié dans `~/.pi/agent/aristote-navigateur`) où l'on suit le curseur « α Aristote ». Il cherche (DuckDuckGo, Bing en secours) et avance par clics sur des captures annotées, sans inventer d'adresse ; il refuse les cookies non essentiels et s'arrête devant un CAPTCHA. Qwen et Gemma voient les captures et les images. `playwright-core` s'installe au premier usage ; sans écran, le navigateur est invisible (`ARISTOTE_BROWSER_HEADLESS=1` pour le forcer, `ARISTOTE_BROWSER=chemin` pour choisir l'exécutable).
- **Langue** (Γ) : le modèle répond dans la langue de la question, ou dans celle fixée par `/langue`.
- **Interface** : en-tête, thème et animations aux couleurs du LISN, uniquement quand un modèle Aristote est actif (un thème clair choisi par l'utilisateur est respecté).

## Configuration existante

L'installateur et `/maj` respectent les configurations à plusieurs fournisseurs : rien n'est modifié sans le demander (réponse par défaut : non), chaque fichier est sauvegardé avant d'être écrit dans `~/.pi/agent/backups/` (lisible par toi seul), un fichier illisible n'est jamais touché, et `/maj` ne remplace que l'extension. La clé est rangée dans `~/.pi/agent/auth.json` (mode 600).

## Commandes

| Commande | Effet |
|---|---|
| `/aristote` | état des modèles, de la clé et de la session |
| `/aristote refresh` | revérifier les modèles |
| `/aristote key sk-…` | changer de clé API |
| `/maj` | mettre à jour l'extension |
| `/langue [auto\|fr\|en\|es…]` | langue des réponses (`auto` : celle dans laquelle tu écris) |
| `/ultracode [on\|off]` | mode Ultracode (comme `Alt+U`) |
| `/peripateticien`, `/euclide`, `/hephaistos`, `/socrate`, `/sappho` `<mission>` | un disciple seul |
| `/clear` | repartir de zéro (comme `/new`) |
| `/exit` | quitter (comme `/quit`) |

Pas de commande pour le navigateur : il suffit de demander une recherche. `ARISTOTE_DEBUG=1 pi` affiche les relances dans le terminal.

## Organisation

```
extensions/aristote/   l'extension (chargée depuis ~/.pi/agent/extensions/aristote)
themes/aristote.json   le thème
install.sh             l'installateur
site/index.html        la page d'installation (GitLab Pages)
test/                  tests unitaires
bench/                 bancs d'essai (modèles réels, navigateur)
tools/termshot.py      captures PNG du terminal
```

Pour publier une nouvelle version : modifier `extensions/aristote/VERSION`, pousser sur `main`. La CI publie la page, l'archive et le numéro de version ; les utilisateurs sont prévenus au lancement suivant de pi et tapent `/maj`.

## Tests

```sh
./test/run.sh                                            # tests unitaires (sans réseau)
ARISTOTE_API_KEY=sk-… python3 bench/bench.py --reps 1    # banc réel : pi brut contre pi × Aristote (résultats : bench/RESULTATS.md)
ARISTOTE_BROWSER_HEADLESS=1 node --experimental-strip-types bench/navigateur.ts   # banc du navigateur, pages locales (--web : vrai web)
python3 tools/termshot.py --out captures snap:accueil    # capture PNG de pi (pip install pyte pillow)
```
