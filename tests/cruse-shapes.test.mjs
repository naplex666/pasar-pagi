// Checks for the render_cruse failure seen live on 25 Nov 2026: asking for a demo
// delivery order made the model call render_cruse five times, each failing with
// "Error from tool 'render_cruse': Invalid info component.", so the checkout
// confirmation dialog never opened.
//
// Root cause, proven against the real runtime validator (runtime/cruse.js):
// validComponent() accepts an "info" component only when fields is a plain
// object. The model's info component had fields as a list, a string, or missing
// entirely. The fix lives in pasar_pagi.hocon's cruse_rules: a concrete valid
// example for "info" and for the order-details form, plus a rule never to retry
// the same invalid component.
//
// Run: node --test "tests/cruse-shapes.test.mjs"
// These tests use the real runtime validator. They do not call an LLM provider:
// render_cruse itself only runs in the browser, so the shapes the model is told
// to emit are validated here instead.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { normalizePresentation } from "../runtime/cruse.js";

// The exact shapes cruse_rules in pasar_pagi.hocon tells the model to emit.
const INFO_EXAMPLE = {
  version: 1,
  components: [
    {
      kind: "info",
      id: "ringkasan",
      title: "Ringkasan pesanan",
      fields: { Nama: "Budi", "Cara terima": "Antar", Jam: "10:00" },
    },
  ],
};

const FORM_EXAMPLE = {
  version: 1,
  components: [
    {
      kind: "form",
      id: "data-pesanan",
      title: "Lengkapi pesanan demo",
      schema: {
        type: "object",
        properties: {
          nama: { type: "string", title: "Nama" },
          alamat: { type: "string", title: "Alamat lengkap" },
          jam: { type: "string", title: "Jam (JJ:MM)", format: "time" },
        },
        required: ["nama", "alamat", "jam"],
      },
      submitLabel: "Lanjut",
    },
  ],
};

// The shapes that produced "Invalid info component." live on 25 Nov 2026.
const INVALID_INFO_SHAPES = [
  ["fields as a list of label/value pairs", { kind: "info", id: "ringkasan", fields: [{ label: "Nama", value: "Budi" }] }],
  ["fields as a plain text string", { kind: "info", id: "ringkasan", fields: "Nama: Budi" }],
  ["info with text but no fields", { kind: "info", id: "ringkasan", text: "Nama: Budi" }],
  ["no kind, only text", { title: "Ringkasan", text: "Nama: Budi" }],
];

test("the info example from cruse_rules validates", () => {
  const { presentation, issues } = normalizePresentation(INFO_EXAMPLE, "test");
  assert.deepEqual(issues, []);
  assert.equal(presentation.components.length, 1);
  assert.equal(presentation.components[0].kind, "info");
});

test("the order-details form example from cruse_rules validates", () => {
  const { presentation, issues } = normalizePresentation(FORM_EXAMPLE, "test");
  assert.deepEqual(issues, []);
  assert.equal(presentation.components.length, 1);
  assert.equal(presentation.components[0].kind, "form");
});

for (const [name, component] of INVALID_INFO_SHAPES) {
  test(`invalid info shape is rejected with the live error: ${name}`, () => {
    const { presentation, issues } = normalizePresentation({ version: 1, components: [component] }, "test");
    assert.equal(presentation, null);
    assert.ok(
      issues.some((issue) => issue.startsWith("Invalid info component")),
      `expected "Invalid info component", got ${JSON.stringify(issues)}`,
    );
  });
}

test("the built network tells the model the fixed info shape", async () => {
  // The build leaves {cruse_rules} as a placeholder in network.json; the
  // browser runtime expands it from the .hocon at load (runtime/kernel.js
  // filterConfig). So the fixed wording is asserted in the .hocon source,
  // and the network only needs to carry the placeholder.
  const hocon = await readFile(new URL("../pasar_pagi.hocon", import.meta.url), "utf8");
  assert.match(hocon, /fields MUST be an object/);
  assert.match(hocon, /"kind":"info"/);
  assert.match(hocon, /At most two render_cruse attempts/);
  assert.match(hocon, /"kind":"form","id":"data-pesanan"/);
  const network = JSON.parse(await readFile(new URL("../pasar_pagi.network.json", import.meta.url), "utf8"));
  const front = network.tools.find((agent) => agent.name === "koordinator_pasar");
  assert.ok(front, "front agent koordinator_pasar is missing");
  assert.match(front.instructions, /\{cruse_rules\}/);
  // And after the browser's expansion the model really sees the fixed
  // wording and examples: the JSON examples' braces must survive expansion.
  const { filterConfig } = await import("../runtime/kernel.js");
  const expanded = filterConfig(network);
  const expandedFront = expanded.tools.find((agent) => agent.name === "koordinator_pasar");
  assert.match(expandedFront.instructions, /fields MUST be an object/);
  assert.match(expandedFront.instructions, /"kind":"info","id":"ringkasan"/);
  assert.match(expandedFront.instructions, /At most two render_cruse attempts/);
  assert.doesNotMatch(expandedFront.instructions, /\{cruse_rules\}/);
});
