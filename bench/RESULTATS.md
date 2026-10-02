# Banc d'essai du 2026-10-02

48 exécutions de `pi -p` sur de vraies tâches vérifiées (3 répétitions par tâche et par modèle).

| | réussites | bloquées (« continue ») | erreurs | temps médian | réponses vides rattrapées |
|---|---|---|---|---|---|
| **pi brut** · qwen-3.8-27b | 7/12 | 8 | 0 | 3 s | 0 |
| **pi brut** · qwen-3.6-35b-instruct-reasoning-high | 4/12 | 10 | 0 | 2 s | 0 |
| **pi brut** · total | 11/24 | 18 | 0 | 3 s | 0 |
| **pi × Aristote** · qwen-3.8-27b | 12/12 | 0 | 0 | 6 s | 17 |
| **pi × Aristote** · qwen-3.6-35b-instruct-reasoning-high | 12/12 | 0 | 0 | 8 s | 18 |
| **pi × Aristote** · total | 24/24 | 0 | 0 | 6 s | 35 |

| tâche | pi brut | pi × Aristote |
|---|---|---|
| corriger | 2/6 | 6/6 |
| compter | 2/6 | 6/6 |
| créer | 3/6 | 6/6 |
| enchaîner | 4/6 | 6/6 |

Ultracode : 4/4 disciples terminés ; 11 s de travail cumulé en 3 s réelles, soit ×3.5 grâce au parallélisme.
