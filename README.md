# pi × Aristote

[pi](https://pi.dev), l'agent de code open source, optimisé pour les modèles souverains d'[Aristote](https://aristote.education).

**Page d'installation : https://thegreeklibrary.org/pi-aristote/**

## Installation

1. **Récupère ta clé API Aristote.** Ouvre **https://aristote.education/llm-access/** et connecte-toi avec ton compte universitaire (Université Paris-Saclay, ses composantes et ses universités membres associées). À l'étape « 01 · Obtenir votre clé d'API », copie la clé : elle commence par `sk-`. Attention, « Régénérer la clé » invalide l'ancienne.
2. **Lance l'installation** dans un terminal (macOS, Linux) :

   ```sh
   curl -fsSL https://thegreeklibrary.org/pi-aristote/install.sh | sh
   ```

   **Windows** : l'installation passe par WSL. Dans PowerShell :

   ```powershell
   wsl bash -lc "curl -fsSL https://thegreeklibrary.org/pi-aristote/install.sh | sh"
   ```

   La première fois, installe d'abord WSL avec `wsl --install` dans un PowerShell ouvert en administrateur, redémarre et choisis ton nom d'utilisateur Linux. Ensuite, pour travailler : `wsl`, puis `pi` (les disques Windows sont sous `/mnt/c`).
3. **Colle ta clé** quand l'installateur la demande : il la vérifie auprès d'Aristote avant de l'enregistrer. Tu peux aussi la donner plus tard dans pi avec `/aristote key sk-…`.

La commande installe Node.js si besoin (version privée, sans sudo), pi, l'extension et le thème. Pour mettre à jour ensuite : `/maj` dans pi.

L'installateur ne casse pas une configuration existante (voir plus bas).

### Installé en version 1.7.1 (ou avant) ?

Jusqu'à la 1.7.1, l'extension cherchait ses mises à jour sur les Pages du LISN, qui ne répondent plus : `/maj` y échoue. Une fois suffit pour passer à la nouvelle adresse :

- relancer l'installation depuis la nouvelle adresse, `curl -fsSL https://thegreeklibrary.org/pi-aristote/install.sh | sh` (la configuration est conservée) ;
- ou lancer pi avec la nouvelle adresse, `PI_ARISTOTE_SITE=https://thegreeklibrary.org/pi-aristote pi`, puis taper `/maj`.

À partir de la 1.8.0, l'extension connaît la nouvelle adresse et passe par GitHub si elle ne répond pas.

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
site/index.html        la page d'installation (servie sous thegreeklibrary.org/pi-aristote/)
site/ecautal/          supports du cours EcAuTAL 2026 (servis sous thegreeklibrary.org/pi-aristote/ecautal/)
test/                  tests unitaires
bench/                 bancs d'essai (modèles réels, navigateur)
tools/termshot.py      captures PNG du terminal
.github/workflows/     tests à chaque poussée (ubuntu, Node 22, pi 1.0.0, sans clé API)
```

## D'où viennent les mises à jour

La page, l'installateur, le numéro de version et l'archive de l'extension sont servis sous `https://thegreeklibrary.org/pi-aristote/` : `install.sh`, `VERSION` et `pi-aristote.tar.gz` (dossiers `extensions/` et `themes/` à la racine de l'archive). Au démarrage, pi lit `VERSION` et prévient s'il y a mieux ; `/maj` télécharge `install.sh` et le lance en mode automatique, qui ne remplace que l'extension.

Si le site ne répond pas, tout passe par le dépôt GitHub : `VERSION` et `install.sh` sur `raw.githubusercontent.com`, l'archive de la branche `main` sur `codeload.github.com` (dont seuls `extensions/` et `themes/` sont extraits). Chaque téléchargement a un délai de connexion et un délai total. Les variables suivantes changent ces adresses (une variable vide coupe le secours correspondant) :

| Variable | Par défaut |
|---|---|
| `PI_ARISTOTE_SITE` | `https://thegreeklibrary.org/pi-aristote` |
| `PI_ARISTOTE_RAW` | `https://raw.githubusercontent.com/l-pommeret/pi-aristote/main` |
| `PI_ARISTOTE_ARCHIVE` | `https://codeload.github.com/l-pommeret/pi-aristote/tar.gz/refs/heads/main` |

## Publier une version

Le site est construit par le workflow Pages du dépôt `l-pommeret/thegreeklibrary.org`, qui récupère ce dépôt et publie `site/`, `install.sh`, `VERSION` et l'archive. Une poussée ici ne le déclenche pas : il faut le lancer à la main.

```sh
# 1. numéro de version, tests, commit
echo 1.8.1 > extensions/aristote/VERSION
./test/run.sh
git commit -am "Version 1.8.1 : …"
# 2. pousser, puis publier
git push origin main
gh workflow run pages.yml -R l-pommeret/thegreeklibrary.org -f pi_aristote_ref=main
# 3. vérifier, une fois le workflow terminé
curl -fsS --max-time 30 https://thegreeklibrary.org/pi-aristote/VERSION
```

`pi_aristote_ref` accepte aussi une étiquette ou un commit. Les Pages gardent les fichiers en cache dix minutes : attendre un peu avant de dire aux utilisateurs de taper `/maj`. Ils sont aussi prévenus au lancement suivant de pi. Ne mets pas `install.sh`, `VERSION` ni `pi-aristote.tar.gz` dans `site/` : ils sont produits au moment de la publication.

## Tests

```sh
./test/run.sh                                            # tests unitaires (sans réseau ni clé ; pi doit être installé)
ARISTOTE_API_KEY=sk-… python3 bench/bench.py --reps 1    # banc réel : pi brut contre pi × Aristote (résultats : bench/RESULTATS.md)
ARISTOTE_BROWSER_HEADLESS=1 node --experimental-strip-types bench/navigateur.ts   # banc du navigateur, pages locales (--web : vrai web)
python3 tools/termshot.py --out captures snap:accueil    # capture PNG de pi (pip install pyte pillow)
```

## Licence

MIT, voir [LICENSE](LICENSE).
