# pi × Aristote

[pi](https://pi.dev), l'agent de code open source, optimisé pour les modèles souverains d'[Aristote](https://aristote.education).

**Page d'installation : https://vibe-coding.pages.lisn.upsaclay.fr/pi-aristote/**

```sh
curl -fsSL https://vibe-coding.pages.lisn.upsaclay.fr/pi-aristote/install.sh | sh
```

Avant tout, récupère ta clé API sur **https://aristote.education/llm-access/** (connexion avec ton compte universitaire : Université Paris-Saclay et universités associées). Elle commence par `sk-`.

La commande installe Node.js si besoin (version privée, sans sudo), pi, l'extension et le thème, puis demande ta clé API Aristote. Pour mettre à jour ensuite : `/maj` dans pi.

## Ce que fait l'extension

- **Modèles automatiques** : la liste vient de `llm.aristote.education` à chaque lancement (avec cache). Les nouveaux modèles sont mesurés (contexte, images, réflexion), les modèles en panne masqués.
- **Relance des réponses vides** : la passerelle renvoie parfois un flux vide ; la requête est relancée sans qu'on le voie.
- **Contexte maîtrisé** : `max_tokens` est ajusté à la place restante, et les erreurs de dépassement déclenchent la compaction de pi.
- **Garde-fou** : un modèle qui annonce une action sans appeler d'outil, ou qui tourne en boucle, est coupé et relancé (deux fois au plus).
- **Mode Ultracode** (`Alt+U`, `/ultracode` ou le mot « ultracode ») : le modèle dirige une équipe de sous-agents qui travaillent en parallèle.
- **Disciples à la demande** : `/peripateticien` (exploration), `/euclide` (plan), `/hephaistos` (implémentation), `/socrate` (relecture et tests), `/sappho` (documentation, messages de commit).
- **Navigateur et vision** : un outil `browser` ouvre des pages, en prend des captures que le modèle voit, lit, clique, remplit. Il utilise le navigateur Chromium déjà installé (Chrome, Brave, Edge…) ; `playwright-core` ne s'installe qu'au premier usage.
- **Interface** : en-tête, thème et animations aux couleurs du LISN, uniquement quand un modèle Aristote est actif.

## Commandes

| Commande | Effet |
|---|---|
| `/aristote` | état des modèles, de la clé et de la session |
| `/aristote refresh` | revérifier les modèles |
| `/maj` | mettre à jour l'extension |
| `/aristote key sk-…` | changer de clé API |
| `/ultracode [on\|off]` | mode Ultracode |

`ARISTOTE_DEBUG=1 pi` affiche les relances dans le terminal.

## Organisation

```
extensions/aristote/   l'extension (chargée depuis ~/.pi/agent/extensions/aristote)
themes/aristote.json   le thème
install.sh             l'installateur
site/index.html        la page d'installation (GitLab Pages)
```

Pour publier une nouvelle version : modifier `extensions/aristote/VERSION`, pousser sur `main`. La CI publie la page, l'archive et le numéro de version ; les utilisateurs sont prévenus au lancement suivant de pi et tapent `/maj`.

## Tests

```sh
./test/run.sh                                   # tests unitaires (sans réseau)
ARISTOTE_API_KEY=sk-… python3 bench/bench.py    # banc d'essai réel : pi brut contre pi × Aristote
python3 tools/termshot.py --out captures snap:accueil   # capture PNG de pi (pip install pyte pillow)
```
