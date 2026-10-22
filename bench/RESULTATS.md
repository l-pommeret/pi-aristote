# Banc d'essai du 2026-10-02

32 exécutions de `pi -p` sur de vraies tâches vérifiées (2 répétitions par tâche et par modèle).

| | réussites | bloquées (« continue ») | erreurs | temps médian | réponses vides rattrapées |
|---|---|---|---|---|---|
| **pi brut** · qwen-3.8-27b | 8/8 | 0 | 0 | 9 s | 0 |
| **pi brut** · qwen-3.6-35b-instruct-reasoning-high | 7/8 | 0 | 0 | 8 s | 0 |
| **pi brut** · total | 15/16 | 0 | 0 | 8 s | 0 |
| **pi × Aristote** · qwen-3.8-27b | 8/8 | 0 | 0 | 8 s | 0 |
| **pi × Aristote** · qwen-3.6-35b-instruct-reasoning-high | 8/8 | 0 | 0 | 7 s | 0 |
| **pi × Aristote** · total | 16/16 | 0 | 0 | 7 s | 0 |

| tâche | pi brut | pi × Aristote |
|---|---|---|
| corriger | 4/4 | 4/4 |
| compter | 4/4 | 4/4 |
| créer | 4/4 | 4/4 |
| enchaîner | 3/4 | 4/4 |

Ultracode : 4/4 disciples terminés ; 17 s de travail cumulé en 5 s réelles, soit ×3.4 grâce au parallélisme.
