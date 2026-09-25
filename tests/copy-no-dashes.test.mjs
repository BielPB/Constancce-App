import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

// Regra do produto: nenhum travessão (— ou –) em texto que o usuário vê.
// Percorre textos de JSX, strings e templates (o parser ignora comentários
// de código) do front-end e das Edge Functions, mais index.html e manifest.

const require = createRequire(import.meta.url);
const { parse } = require("@babel/parser");
const root = fileURLToPath(new URL("..", import.meta.url));
const DASH = /[—–]/;

function listFiles(dir, exts) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFiles(full, exts));
    else if (exts.some((ext) => entry.name.endsWith(ext))) out.push(full);
  }
  return out;
}

function dashedStrings(file) {
  const code = readFileSync(file, "utf8");
  const plugins = file.endsWith(".ts") ? ["typescript"] : ["jsx"];
  const ast = parse(code, { sourceType: "module", plugins, errorRecovery: true });
  const found = [];
  const walk = (node) => {
    if (!node || typeof node.type !== "string") return;
    let text = null;
    if (node.type === "StringLiteral" || node.type === "JSXText") text = node.value;
    else if (node.type === "TemplateElement") text = node.value.cooked ?? node.value.raw;
    if (text && DASH.test(text)) found.push(`${relative(root, file)}:${node.loc.start.line} ${JSON.stringify(text.trim()).slice(0, 90)}`);
    for (const key of Object.keys(node)) {
      if (key === "loc" || key.endsWith("Comments")) continue;
      const value = node[key];
      if (Array.isArray(value)) value.forEach(walk);
      else if (value && typeof value.type === "string") walk(value);
    }
  };
  walk(ast.program);
  return found;
}

test("nenhum travessão na copy do app (telas, notificações, checkout, compartilhamento)", () => {
  const sources = [
    join(root, "App.jsx"),
    join(root, "main.jsx"),
    ...listFiles(join(root, "src"), [".js", ".jsx"]),
    ...listFiles(join(root, "supabase/functions"), [".ts"]),
  ];
  const offenders = sources.flatMap(dashedStrings);
  for (const file of ["index.html", "public/site.webmanifest"]) {
    readFileSync(join(root, file), "utf8").split("\n").forEach((line, i) => {
      if (DASH.test(line) && !line.trim().startsWith("<!--")) offenders.push(`${file}:${i + 1} ${line.trim().slice(0, 90)}`);
    });
  }
  assert.deepEqual(offenders, [], `Troque o travessão por ponto, dois-pontos, vírgula ou "·":\n${offenders.join("\n")}`);
});
