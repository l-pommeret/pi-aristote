#!/usr/bin/env python3
"""Capture pi dans un vrai pseudo-terminal et rend l'écran en PNG (couleurs exactes).

  termshot.py --out DOSSIER [--cols 120] [--rows 42] [--cwd DIR] [--model aristote/qwen-3.8-27b] ÉTAPES…

ÉTAPES (dans l'ordre) :
  wait:SECONDES          laisse tourner
  type:TEXTE             tape du texte (sans Entrée)
  key:enter|esc|alt+u|ctrl+o|up|down|tab   touche spéciale
  snap:NOM               enregistre DOSSIER/NOM.png (et NOM.txt)
  scrollback:NOM         capture tout l'historique visible (écran plus haut)

Environnement : PI_CODING_AGENT_DIR doit pointer sur le dossier d'agent de test.
"""
import argparse, fcntl, os, pty, select, signal, struct, sys, termios, time
import pyte
from PIL import Image, ImageDraw, ImageFont

FONTS = "/System/Applications/Utilities/Terminal.app/Contents/Resources/Fonts/"
FALLBACK = ["/System/Library/Fonts/Menlo.ttc", "/System/Library/Fonts/Apple Symbols.ttf", "/System/Library/Fonts/Supplemental/Arial Unicode.ttf"]
SIZE = 15
BG = (16, 17, 22)
FG = (220, 222, 230)
ANSI = {
    "black": (40, 42, 54), "red": (232, 96, 76), "green": (127, 199, 154), "brown": (242, 188, 60), "yellow": (242, 188, 60),
    "blue": (91, 140, 214), "magenta": (185, 142, 220), "cyan": (91, 184, 206), "white": (220, 222, 230),
    "brightblack": (110, 112, 130), "brightred": (255, 120, 100), "brightgreen": (150, 220, 170), "brightyellow": (255, 210, 90),
    "brightblue": (120, 170, 240), "brightmagenta": (210, 170, 240), "brightcyan": (130, 210, 225), "brightwhite": (255, 255, 255),
}
KEYS = {"enter": b"\r", "esc": b"\x1b", "alt+u": b"\x1bu", "ctrl+o": b"\x0f", "ctrl+l": b"\x0c", "up": b"\x1b[A", "down": b"\x1b[B",
        "tab": b"\t", "shift+tab": b"\x1b[Z", "ctrl+c": b"\x03", "backspace": b"\x7f"}

def load_fonts():
    fonts = {}
    for style, f in [("r", "SF-Mono-Regular.otf"), ("b", "SF-Mono-Bold.otf"), ("i", "SF-Mono-RegularItalic.otf")]:
        fonts[style] = ImageFont.truetype(FONTS + f, SIZE)
    fb = [ImageFont.truetype(p, SIZE) for p in FALLBACK if os.path.exists(p)]
    return fonts, fb

def color(c, default):
    if c in ("default", None):
        return default
    if isinstance(c, str) and len(c) == 6:
        try:
            return tuple(int(c[i:i + 2], 16) for i in (0, 2, 4))
        except ValueError:
            pass
    return ANSI.get(c, default)

def has_glyph(font, ch):
    try:
        return font.getmask(ch).getbbox() is not None or ch.isspace()
    except Exception:
        return False

def render(screen, path, fonts, fb, rows=None):
    lines = rows if rows is not None else [screen.buffer[y] for y in range(screen.lines)]
    cw = int(fonts["r"].getlength("M"))
    ch = int(SIZE * 1.24)
    pad = 18
    img = Image.new("RGB", (cw * screen.columns + pad * 2, ch * len(lines) + pad * 2), BG)
    d = ImageDraw.Draw(img)
    for y, row in enumerate(lines):
        for x in range(screen.columns):
            c = row[x]
            fg, bg = color(c.fg, FG), color(c.bg, BG)
            if c.reverse:
                fg, bg = bg, fg
            px, py = pad + x * cw, pad + y * ch
            if bg != BG:
                d.rectangle([px, py, px + cw, py + ch], fill=bg)
            if not c.data or c.data == " ":
                continue
            f = fonts["b"] if c.bold else fonts["i"] if c.italics else fonts["r"]
            if not has_glyph(f, c.data):
                f = next((g for g in fb if has_glyph(g, c.data)), f)
            d.text((px, py + (ch - SIZE) / 2 - 1), c.data, font=f, fill=fg)
    img.save(path)

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    ap.add_argument("--cols", type=int, default=120)
    ap.add_argument("--rows", type=int, default=42)
    ap.add_argument("--cwd", default=".")
    ap.add_argument("--model", default="aristote/qwen-3.8-27b")
    ap.add_argument("steps", nargs="*")
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    fonts, fb = load_fonts()
    screen = pyte.HistoryScreen(a.cols, a.rows, history=4000)
    stream = pyte.ByteStream(screen)
    pid, fd = pty.fork()
    if pid == 0:
        os.chdir(a.cwd)
        env = {**os.environ, "COLORTERM": "truecolor", "TERM": "xterm-256color"}
        os.execvpe("pi", ["pi", "--no-session", "--model", a.model], env)
    fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", a.rows, a.cols, 0, 0))

    def pump(t):
        end = time.time() + t
        while time.time() < end:
            r, _, _ = select.select([fd], [], [], 0.05)
            if r:
                try:
                    data = os.read(fd, 65536)
                except OSError:
                    return
                stream.feed(data)
                if b"\x1b[6n" in data:
                    os.write(fd, f"\x1b[{screen.cursor.y + 1};{screen.cursor.x + 1}R".encode())

    pump(6)
    for step in a.steps:
        kind, _, arg = step.partition(":")
        if kind == "wait":
            pump(float(arg))
        elif kind == "type":
            os.write(fd, arg.encode())
            pump(0.4)
        elif kind == "key":
            os.write(fd, KEYS[arg])
            pump(0.4)
        elif kind == "snap":
            render(screen, os.path.join(a.out, arg + ".png"), fonts, fb)
            open(os.path.join(a.out, arg + ".txt"), "w").write("\n".join(l.rstrip() for l in screen.display))
            print("capture", os.path.join(a.out, arg + ".png"), flush=True)
        elif kind == "scrollback":
            hist = list(screen.history.top) + [screen.buffer[y] for y in range(screen.lines)]
            render(screen, os.path.join(a.out, arg + ".png"), fonts, fb, rows=hist[-160:])
            print("capture", os.path.join(a.out, arg + ".png"), flush=True)
    os.kill(pid, signal.SIGKILL)

if __name__ == "__main__":
    main()
