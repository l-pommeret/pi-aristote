# pi × Aristote

[pi](https://pi.dev), l'agent de code open source, optimisé pour les modèles souverains d'[Aristote](https://aristote.education).

**Page d'installation : https://vibe-coding.pages.lisn.upsaclay.fr/pi-aristote/**

Dépôt : https://gitlab.lisn.upsaclay.fr/vibe-coding/pi-aristote.

## Mise à jour de la responsabilité (1.9.0)

Avant chaque commande que le modèle veut lancer (outil `bash`), pi demande votre accord. Pour s'en passer : `pi --yolo`, ou `/yolo` dans pi (`/yolo off` pour revenir aux confirmations). Entre les deux : `pi --yom` ou `/yom` laisse passer seules les commandes inoffensives (lecture, recherche, téléchargements, installation de dépendances, compilation, tests) et demande pour les sensibles (`rm`, `mv`, `git push`, `sudo`, écriture par `>`…) ou inconnues. Sans interface (`pi -p`, sous-agents d'Ultracode), les commandes qui demanderaient un accord sont refusées.

## Installation

1. **Récupère ta clé API Aristote.** Ouvre **https://aristote.education/llm-access/** et connecte-toi avec ton compte universitaire (Université Paris-Saclay, ses composantes et ses universités membres associées). À l'étape « 01 · Obtenir votre clé d'API », copie la clé : elle commence par `sk-`. Attention, « Régénérer la clé » invalide l'ancienne.
2. **Lance l'installation** dans un terminal (macOS, Linux) :

   ```sh
   curl -fsSL https://vibe-coding.pages.lisn.upsaclay.fr/pi-aristote/install.sh | sh
   ```


   **Windows** : l'installation passe par WSL. Dans PowerShell :

   ```powershell
   wsl bash -lc "curl -fsSL https://vibe-coding.pages.lisn.upsaclay.fr/pi-aristote/install.sh | sh"
   ```

   La première fois, installe d'abord WSL avec `wsl --install` dans un PowerShell ouvert en administrateur, redémarre et choisis ton nom d'utilisateur Linux. Ensuite, pour travailler : `wsl`, puis `pi` (les disques Windows sont sous `/mnt/c`).
3. **Colle ta clé** quand l'installateur la demande : il la vérifie auprès d'Aristote avant de l'enregistrer. Tu peux aussi la donner plus tard dans pi avec `/aristote key sk-…`.

La commande installe Node.js si besoin (version privée, sans sudo), pi, l'extension et le thème. Pour mettre à jour ensuite : `/maj` dans pi.

L'installateur ne casse pas une configuration existante (voir plus bas).

### Installé en version 1.7.1 ou 1.8.0 ?

Rien à faire : `/maj` suffit. Une 1.8.0 qui ne trouverait plus son miroir : relancer une fois la commande d'installation.

## Ce que fait l'extension

- **Modèles automatiques** : la liste vient de `llm.aristote.education` à chaque lancement (avec cache). Les nouveaux modèles sont mesurés (contexte, images, réflexion), les modèles en panne masqués.
- **Relance des réponses vides** : la passerelle renvoie parfois un flux vide ; la requête est relancée sans qu'on le voie.
- **Contexte maîtrisé** : `max_tokens` est ajusté à la place restante, les requêtes restent sous la limite de 1 Mio de la passerelle, et les dépassements déclenchent la compaction de pi.
- **Garde-fou** (Φ) : un modèle qui annonce une action sans appeler d'outil, ou qui tourne en boucle, est relancé (deux fois au plus) ; une vraie conclusion n'est jamais relancée.
- **Mode Ultracode** (Ω, `Alt+U`, `/ultracode` ou le mot « ultracode ») : le modèle dirige une équipe de disciples, de vrais processus pi qui travaillent en parallèle, puis fait la synthèse. `Ctrl+O` déplie leurs comptes rendus.
- **Disciples à la demande**, suivis d'une mission : `/peripateticien` (π, exploration sans rien modifier), `/euclide` (ε, plan), `/hephaistos` (η, implémentation), `/socrate` (σ, relecture et tests), `/sappho` (λ, documentation, messages de commit).
- **Navigateur visible** (θ) : sur simple demande (« cherche… »), l'outil `browser` ouvre une fenêtre (Chrome, Brave, Edge… déjà installé, profil dédié dans `~/.pi/agent/aristote-navigateur`) où l'on suit le curseur « α Aristote ». Il cherche (DuckDuckGo, Bing en secours) et avance par clics, sans inventer d'adresse : sur ses captures, chaque élément cliquable porte un numéro [n], et il vise un point précis (coordonnées) quand aucun numéro ne convient ; il refuse les cookies non essentiels et s'arrête devant un CAPTCHA. Qwen et Gemma voient les captures et les images. `playwright-core` s'installe au premier usage ; sans écran, le navigateur est invisible (`ARISTOTE_BROWSER_HEADLESS=1` pour le forcer, `ARISTOTE_BROWSER=chemin` pour choisir l'exécutable).
- **Langue** (Γ) : le modèle répond dans la langue de la question, ou dans celle fixée par `/langue`, équipe Ultracode comprise.
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
| `/gardefou [on\|off]` | Φ garde-fou anti-boucle (actif par défaut) |
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
site/                  la page d'installation et ses fichiers, sous-dossiers compris (servis sous les deux adresses)
test/                  tests unitaires
bench/                 bancs d'essai (modèles réels, navigateur)
tools/termshot.py      captures PNG du terminal
.gitlab-ci.yml         publication sur les Pages du LISN à chaque poussée sur main
```

## D'où viennent les mises à jour

La page, l'installateur, le numéro de version et l'archive de l'extension sont servis par les Pages du LISN, `https://vibe-coding.pages.lisn.upsaclay.fr/pi-aristote/` : `install.sh`, `VERSION` et `pi-aristote.tar.gz` (dossiers `extensions/` et `themes/` à la racine de l'archive). Au démarrage, pi lit `VERSION` et prévient s'il y a mieux ; `/maj` télécharge `install.sh` et le lance en mode automatique, qui ne remplace que l'extension et son thème. La nouvelle version est d'abord extraite à côté, puis mise en place par renommage : un téléchargement ou une extraction ratés laissent l'ancienne intacte. L'installateur est écrit pour être lu en entier avant de s'exécuter : coupé en route par le réseau, `curl … | sh` ne fait rien.

Il n'y a pas de secours par défaut. Un secours (`PI_ARISTOTE_MIRRORS`, `PI_ARISTOTE_RAW`, `PI_ARISTOTE_ARCHIVE`) peut être donné par variable d'environnement ; il ne fait jamais redescendre : `/maj` lit son `VERSION` avant d'y prendre `install.sh` et saute une source plus ancienne que la version installée. Chaque téléchargement a un délai de connexion et un délai total.

| Variable | Par défaut |
|---|---|
| `PI_ARISTOTE_SITE` | `https://vibe-coding.pages.lisn.upsaclay.fr/pi-aristote` |
| `PI_ARISTOTE_MIRRORS`, `PI_ARISTOTE_RAW`, `PI_ARISTOTE_ARCHIVE` | vides (pas de secours) |

## Publier une version

Une poussée sur `main` lance la CI GitLab (`.gitlab-ci.yml`), qui publie `site/` (sous-dossiers compris), `install.sh`, `VERSION` et l'archive sur les Pages.

```sh
echo 1.9.3 > extensions/aristote/VERSION
./test/run.sh
git commit -am "Version 1.9.3 : …"
git push origin main
# une fois le pipeline terminé
curl -fsS --max-time 30 https://vibe-coding.pages.lisn.upsaclay.fr/pi-aristote/VERSION
```

Les Pages gardent les fichiers en cache quelques minutes : attendre un peu avant de dire aux utilisateurs de taper `/maj`. Ne mets pas `install.sh`, `VERSION` ni `pi-aristote.tar.gz` dans `site/` : ils sont produits au moment de la publication (la CI échoue sinon).

## Tests

```sh
./test/run.sh                                            # tests unitaires (sans réseau ni clé ; pi doit être installé)
ARISTOTE_API_KEY=sk-… python3 bench/bench.py --reps 1    # banc réel : pi brut contre pi × Aristote (résultats : bench/RESULTATS.md)
ARISTOTE_BROWSER_HEADLESS=1 node --experimental-strip-types bench/navigateur.ts   # banc du navigateur, pages locales (--web : vrai web)
python3 tools/termshot.py --out captures snap:accueil    # capture PNG de pi (pip install pyte pillow)
```

## Licence

MIT, voir [LICENSE](LICENSE).
