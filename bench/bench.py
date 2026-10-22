#!/usr/bin/env python3
"""Banc d'essai : pi brut contre pi × Aristote, sur de vraies tâches vérifiées.

    ARISTOTE_API_KEY=sk-… python3 bench/bench.py [--reps 3] [--jobs 4]
"""
import argparse, json, os, re, shutil, subprocess, sys, tempfile, time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
BASE_URL = "https://llm.aristote.education/v1"
MODELS = ["qwen-3.8-27b", "qwen-3.6-35b-instruct-reasoning-high"]

FIXTURE = {
    "calc.py": "def add(a, b):\n    return a - b\n\ndef mul(a, b):\n    return a + b\n",
    "greet.py": 'def greet(name):\n    return "Bonjour " + name\n',
    "test_calc.py": "import calc\n\ndef test_add():\n    assert calc.add(2, 3) == 5\n",
    "notes/a.py": "x = 1\n",
    "notes/b.txt": "rien\n",
}

def py(d, code):
    return subprocess.run([sys.executable, "-c", code], cwd=d, capture_output=True, text=True, timeout=30)

def check_fix(d, _):
    r = py(d, "import calc; print(calc.add(2,3), calc.mul(4,5))")
    return r.stdout.split() == ["5", "20"]

def check_count(_d, answer):
    return bool(re.search(r"\b4\b", answer)) and not re.search(r"\b[35]\b", answer)

def check_create(d, _):
    p = Path(d, "hello.txt")
    return p.exists() and p.read_text().strip() == "Bonjour Aristote"

def check_multi(d, _):
    r = py(d, "import calc, test_calc; assert calc.sub(7, 2) == 5; test_calc.test_sub(); print('ok')")
    return r.stdout.strip() == "ok"

TASKS = {
    "corriger": ("Corrige les bugs de calc.py (add doit additionner, mul multiplier), puis vérifie en exécutant du Python.", check_fix),
    "compter": ("Combien y a-t-il de fichiers .py dans ce dossier, sous-dossiers compris ? Utilise un outil, puis réponds par le nombre seul.", check_count),
    "créer": ("Crée un fichier hello.txt contenant exactement : Bonjour Aristote", check_create),
    "enchaîner": ("Ajoute une fonction sub(a, b) à calc.py, ajoute test_sub dans test_calc.py, puis exécute le test pour vérifier.", check_multi),
}

def make_agent_dirs(root: Path, key: str):
    auth = {"aristote": {"type": "api_key", "key": key}}
    raw = root / "brut"
    raw.mkdir(parents=True)
    (raw / "auth.json").write_text(json.dumps(auth))
    (raw / "models.json").write_text(json.dumps({"providers": {"aristote": {
        "baseUrl": BASE_URL, "api": "openai-completions", "apiKey": key,
        "compat": {"supportsDeveloperRole": False, "supportsReasoningEffort": False},
        "models": [{"id": m, "name": m, "reasoning": False, "input": ["text"], "contextWindow": 262144, "maxTokens": 32768,
                    "cost": {"input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0}} for m in MODELS],
    }}}))
    ext = root / "extension"
    (ext / "extensions").mkdir(parents=True)
    shutil.copytree(REPO / "extensions" / "aristote", ext / "extensions" / "aristote")
    (ext / "auth.json").write_text(json.dumps(auth))
    return {"pi brut": raw, "pi × Aristote": ext}

def run_one(config, agent_dir, model, task, rep, workroot):
    work = Path(tempfile.mkdtemp(dir=workroot))
    for name, content in FIXTURE.items():
        (work / name).parent.mkdir(parents=True, exist_ok=True)
        (work / name).write_text(content)
    prompt, check = TASKS[task]
    env = {**os.environ, "PI_CODING_AGENT_DIR": str(agent_dir), "ARISTOTE_DEBUG": "1"}
    env.pop("ARISTOTE_API_KEY", None)
    t0 = time.time()
    p = subprocess.run(["pi", "--no-session", "--mode", "json", "--model", f"aristote/{model}", "-p", prompt],
                       cwd=work, env=env, capture_output=True, text=True, stdin=subprocess.DEVNULL, timeout=300)
    dt = time.time() - t0
    msgs = []
    for line in p.stdout.splitlines():
        try:
            e = json.loads(line)
        except ValueError:
            continue
        if e.get("type") == "message_end" and e["message"].get("role") == "assistant":
            msgs.append(e["message"])
    last = msgs[-1] if msgs else {}
    text = "".join(b.get("text", "") for b in last.get("content", []) if b.get("type") == "text").strip()
    tools = sum(1 for m in msgs for b in m.get("content", []) if b.get("type") == "toolCall")
    return {
        "config": config, "model": model, "task": task, "rep": rep, "time": dt,
        "ok": bool(check(work, text)),
        "stalled": last.get("stopReason") == "stop" and not text,
        "error": last.get("stopReason") == "error",
        "turns": len(msgs), "tools": tools,
        "retries": p.stderr.count("réponse vide, relance"),
    }

def ultracode_efficiency(agent_dir, workroot):
    work = Path(tempfile.mkdtemp(dir=workroot))
    for name, content in FIXTURE.items():
        (work / name).parent.mkdir(parents=True, exist_ok=True)
        (work / name).write_text(content)
    env = {**os.environ, "PI_CODING_AGENT_DIR": str(agent_dir)}
    prompt = ("ultracode : lance en un seul appel 4 péripatéticiens, un par fichier (calc.py, greet.py, test_calc.py, notes/a.py), "
              "chacun décrit son fichier en une phrase. Puis synthèse en une ligne.")
    p = subprocess.run(["pi", "--no-session", "--mode", "json", "--model", "aristote/qwen-3.8-27b", "-p", prompt],
                       cwd=work, env=env, capture_output=True, text=True, stdin=subprocess.DEVNULL, timeout=400)
    for line in p.stdout.splitlines():
        try:
            e = json.loads(line)
        except ValueError:
            continue
        if e.get("type") == "tool_execution_end" and e.get("toolName") == "agents":
            runs = (e.get("result", {}).get("details") or {}).get("runs", [])
            if runs and all(r.get("startedAt") and r.get("endedAt") for r in runs):
                total = sum(r["endedAt"] - r["startedAt"] for r in runs) / 1000
                wall = (max(r["endedAt"] for r in runs) - min(r["startedAt"] for r in runs)) / 1000
                return {"agents": len(runs), "ok": sum(r["status"] == "terminé" for r in runs), "sequential": total, "wall": wall}
    return None

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--reps", type=int, default=3)
    ap.add_argument("--jobs", type=int, default=4)
    args = ap.parse_args()
    key = os.environ.get("ARISTOTE_API_KEY") or sys.exit("ARISTOTE_API_KEY manquante")
    root = Path(tempfile.mkdtemp(prefix="bench-aristote-"))
    dirs = make_agent_dirs(root, key)
    warm = {**os.environ, "PI_CODING_AGENT_DIR": str(dirs["pi × Aristote"])}
    subprocess.run(["pi", "--no-session", "-p", "Réponds juste : ok"], cwd=root, env=warm, capture_output=True,
                   stdin=subprocess.DEVNULL, timeout=120)
    jobs = [(c, d, m, t, r) for r in range(args.reps) for m in MODELS for t in TASKS for c, d in dirs.items()]
    print(f"{len(jobs)} exécutions, {args.jobs} en parallèle…", flush=True)
    results = []
    with ThreadPoolExecutor(args.jobs) as pool:
        for res in pool.map(lambda j: run_one(*j, root), jobs):
            results.append(res)
            mark = "✓" if res["ok"] else ("∅" if res["stalled"] else "✗")
            print(f"  {mark} {res['config']:14} {res['model']:38} {res['task']:10} {res['time']:5.1f}s"
                  f"{'  (' + str(res['retries']) + ' relance(s))' if res['retries'] else ''}", flush=True)
    print("\nMode Ultracode…", flush=True)
    eff = ultracode_efficiency(dirs["pi × Aristote"], root)

    lines = ["| | réussites | bloquées (« continue ») | erreurs | temps médian | réponses vides rattrapées |", "|---|---|---|---|---|---|"]
    for config in dirs:
        for model in MODELS + [None]:
            rs = [r for r in results if r["config"] == config and (model is None or r["model"] == model)]
            if not rs:
                continue
            times = sorted(r["time"] for r in rs)
            label = f"**{config}**" + (f" · {model}" if model else " · total")
            lines.append(f"| {label} | {sum(r['ok'] for r in rs)}/{len(rs)} | {sum(r['stalled'] for r in rs)} | "
                         f"{sum(r['error'] for r in rs)} | {times[len(times) // 2]:.0f} s | {sum(r['retries'] for r in rs)} |")
    lines.append("")
    lines.append("| tâche | " + " | ".join(dirs) + " |")
    lines.append("|---|" + "---|" * len(dirs))
    for task in TASKS:
        cells = [f"{sum(r['ok'] for r in results if r['config'] == c and r['task'] == task)}/"
                 f"{sum(1 for r in results if r['config'] == c and r['task'] == task)}" for c in dirs]
        lines.append(f"| {task} | " + " | ".join(cells) + " |")
    if eff:
        lines += ["", f"Ultracode : {eff['ok']}/{eff['agents']} disciples terminés ; {eff['sequential']:.0f} s de travail cumulé "
                      f"en {eff['wall']:.0f} s réelles, soit ×{eff['sequential'] / max(eff['wall'], 0.1):.1f} grâce au parallélisme."]
    report = "\n".join(lines)
    print("\n" + report)
    (REPO / "bench" / "RESULTATS.md").write_text(
        f"# Banc d'essai du {time.strftime('%Y-%m-%d')}\n\n{len(jobs)} exécutions de `pi -p` sur de vraies tâches vérifiées "
        f"({args.reps} répétitions par tâche et par modèle).\n\n{report}\n")
    shutil.rmtree(root, ignore_errors=True)

if __name__ == "__main__":
    main()
