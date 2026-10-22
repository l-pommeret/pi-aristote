#!/bin/sh
# Tests unitaires : node --test, avec les paquets de l'installation locale de pi.
set -eu
cd "$(dirname "$0")/.."
PI_PKG="$(dirname "$(dirname "$(dirname "$(node -e 'console.log(require("fs").realpathSync(process.argv[1]))' "$(command -v pi)")")")")"
rm -rf node_modules && mkdir -p node_modules/@earendil-works
for d in "$PI_PKG"/node_modules/*; do
	case "$(basename "$d")" in @earendil-works) ;; *) ln -s "$d" "node_modules/$(basename "$d")" ;; esac
done
for d in "$PI_PKG"/node_modules/@earendil-works/*; do ln -s "$d" "node_modules/@earendil-works/$(basename "$d")"; done
ln -s "$PI_PKG" node_modules/@earendil-works/pi-coding-agent
node --experimental-strip-types --no-warnings --test test/*.test.ts
