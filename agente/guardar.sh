#!/usr/bin/env bash
# Guarda en GitHub los cambios de clientes/. Si otro proceso guardó algo al mismo tiempo (otro pedido,
# YouTube, la revisión semanal), combina los dos cambios, revisa que los datos sigan siendo válidos y reintenta.
# Uso: bash agente/guardar.sh <archivo con el mensaje del commit>
# Sale con 0 si guardó (o no había nada), 2 si el cambio choca con otro sobre los mismos datos, 1 si no pudo.
set -u

git config user.name "agente-sitios"
git config user.email "agente-sitios@users.noreply.github.com"
git add clientes
git commit -q -F "$1" || { echo "No había nada para guardar."; exit 0; }

datos_validos() {
  node --input-type=module -e '
    import fs from "node:fs";
    import { erroresDeDatos } from "./agente/datos.mjs";
    let mal = 0;
    for (const f of fs.readdirSync("clientes").filter((f) => f.endsWith(".json"))) {
      try {
        const errores = erroresDeDatos(JSON.parse(fs.readFileSync(`clientes/${f}`, "utf8")));
        if (errores.length) { console.error(`${f}: ${errores.join("; ")}`); mal = 1; }
      } catch (e) { console.error(`${f}: ${e.message}`); mal = 1; }
    }
    process.exit(mal);'
}

for intento in 1 2 3 4 5; do
  if git push -q origin HEAD:main; then echo "Guardado."; exit 0; fi
  echo "Otro cambio se guardó al mismo tiempo: se combinan y se reintenta (intento $intento)."
  if ! git pull -q --rebase origin main; then
    git rebase --abort 2>/dev/null
    echo "El cambio choca con otro hecho al mismo tiempo sobre los mismos datos."
    exit 2
  fi
  if ! datos_validos; then
    echo "Al combinar los dos cambios los datos quedaban inválidos: no se guarda."
    exit 2
  fi
  sleep $((intento * 2))
done
echo "No se pudo guardar después de varios intentos."
exit 1
