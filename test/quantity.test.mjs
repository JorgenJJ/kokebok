// quantity.test.mjs — mengdeparsing og skalering.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseIngredient, parseAmount, formatAmount, scaleIngredient } from "../js/quantity.mjs";

test("parseAmount forstår tall, komma, unicode-brøk og «1 1/2»", () => {
  assert.equal(parseAmount("2"), 2);
  assert.equal(parseAmount("1,5"), 1.5);
  assert.equal(parseAmount("½"), 0.5);
  assert.equal(parseAmount("1 ½"), 1.5);
  assert.equal(parseAmount("1 1/2"), 1.5);
  assert.equal(parseAmount("3/4"), 0.75);
  assert.equal(parseAmount("salt"), null);
});

test("parseIngredient deler mengde, enhet og navn", () => {
  assert.deepEqual(parseIngredient("1 ½ dl soyasaus"), {
    raw: "1 ½ dl soyasaus", qty: 1.5, qtyMax: null, unit: "dl", name: "soyasaus",
  });
  assert.deepEqual(parseIngredient("600 g lårfilet av kylling"), {
    raw: "600 g lårfilet av kylling", qty: 600, qtyMax: null, unit: "g", name: "lårfilet av kylling",
  });
  assert.deepEqual(parseIngredient("2 vårløk"), {
    raw: "2 vårløk", qty: 2, qtyMax: null, unit: null, name: "vårløk",
  });
});

test("parseIngredient forstår intervaller", () => {
  const i = parseIngredient("½–1 hakket chili");
  assert.equal(i.qty, 0.5);
  assert.equal(i.qtyMax, 1);
  assert.equal(i.name, "hakket chili");
});

test("linjer uten mengde beholdes som de er", () => {
  const i = parseIngredient("Salt og pepper etter smak");
  assert.equal(i.qty, null);
  assert.equal(i.unit, null);
  assert.equal(i.name, "Salt og pepper etter smak");
});

test("formatAmount gir pene brøker", () => {
  assert.equal(formatAmount(2), "2");
  assert.equal(formatAmount(0.5), "½");
  assert.equal(formatAmount(1.5), "1 ½");
  assert.equal(formatAmount(0.25), "¼");
  assert.equal(formatAmount(1.2), "1,2");
});

test("skalering gir riktige mengder – og lar uskalerbare linjer stå", () => {
  assert.equal(scaleIngredient("1 ½ dl soyasaus", 2), "3 dl soyasaus");
  assert.equal(scaleIngredient("600 g kylling", 0.5), "300 g kylling");
  assert.equal(scaleIngredient("½–1 hakket chili", 2), "1–2 hakket chili");
  assert.equal(scaleIngredient("Salt etter smak", 2), "Salt etter smak");
  assert.equal(scaleIngredient("2 dl vann", 1), "2 dl vann");
});
