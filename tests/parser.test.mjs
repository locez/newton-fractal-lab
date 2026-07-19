import assert from "node:assert/strict";
import test from "node:test";
import { cAbs } from "../src/complex.js";
import { buildDeepShader, buildShader } from "../src/gpu-renderer.js";
import { evaluateExpression, ExpressionError, parseExpression, toDsWgsl, toWgsl } from "../src/parser.js";
import { findRoots } from "../src/root-finder.js";
import { needsPrecisionDetail } from "../src/view-precision.js";
import { encodeSpan, setSpanLog2, spanLog2, spanValue } from "../src/view-scale.js";
import { addCenterDelta, centerDifference, encodeScaledDoubleDouble } from "../src/view-center.js";

test("parses implicit multiplication, pi, and supported functions", () => {
  const expression = parseExpression("2sin(pi / 2) + 3z");
  assert.deepEqual(expression.variables, ["z"]);
  assert.deepEqual(expression.constants, []);
  const result = evaluateExpression(expression.ast, [0, 0], {});
  assert.ok(Math.abs(result.value[0] - 2) < 1e-9);
  assert.ok(Math.abs(result.derivative[0] - 3) < 1e-9);
});

test("treats x, y, and z as one complex variable while retaining detection", () => {
  const expression = parseExpression("x^2 + y - z");
  assert.deepEqual(expression.variables, ["x", "y", "z"]);
  const result = evaluateExpression(expression.ast, [2, 0], {});
  assert.equal(result.value[0], 4);
});

test("collects user constants and evaluates their current values", () => {
  const expression = parseExpression("z^2 - a*b + sqrt(c)");
  assert.deepEqual(expression.constants, ["a", "b", "c"]);
  const result = evaluateExpression(expression.ast, [2, 0], { a: 2, b: 1, c: 9 });
  assert.equal(result.value[0], 5);
  assert.equal(result.derivative[0], 4);
});

test("rejects unknown symbols and malformed grouping", () => {
  assert.throws(() => parseExpression("z + mystery"), ExpressionError);
  assert.throws(() => parseExpression("sin(z"), ExpressionError);
  assert.throws(() => parseExpression("z @ 2"), ExpressionError);
});

test("generates isolated WGSL value and derivative expressions", () => {
  const expression = parseExpression("z^3 - a + 10 + 1e-7");
  const wgsl = toWgsl(expression.ast, expression.constants);
  assert.match(wgsl.value, /c_pow/);
  assert.match(wgsl.derivative, /c_mul/);
  assert.match(wgsl.value, /10\.0/);
  assert.match(wgsl.value, /1\.0e-7/);
  assert.doesNotMatch(wgsl.value, /z\^3/);
});

test("finds the three roots of z^3 - 1 in the default view", () => {
  const expression = parseExpression("z^3 - 1");
  const roots = findRoots(expression, {}, { centerX: 0, centerY: 0, span: 6 }, 960, 640);
  assert.equal(roots.length, 3);
  roots.forEach((root) => {
    const value = evaluateExpression(expression.ast, [root.re, root.im], {});
    assert.ok(cAbs(value.value) < 0.01);
  });
});

test("keeps generated WGSL compatible with browser shader parsers", () => {
  const expression = parseExpression("z^3 - a");
  const shader = buildShader(expression, expression.constants);
  assert.doesNotMatch(shader, /isNan/);
  assert.doesNotMatch(shader, /if \(palette == [678]\) return/);
  assert.match(shader, /let next = z - step/);
});

test("generates a compensated GPU path for deep views", () => {
  const expression = parseExpression("sin(z) + z^3 - a");
  const generated = toDsWgsl(expression.ast, expression.constants);
  const shader = buildDeepShader(expression, expression.constants);
  assert.match(generated.value, /ds_sin/);
  assert.match(generated.derivative, /ds_mul/);
  assert.match(shader, /struct DsComplex/);
  assert.match(shader, /uniforms\.reference/);
  assert.match(shader, /uniforms\.curvature/);
  assert.match(shader, /root \* 2u/);
});

test("enters GPU precision detail before nonzero f32 pixels collapse", () => {
  assert.equal(needsPrecisionDetail({ centerX: 0, centerY: 0, span: 6 }, 1440), false);
  assert.equal(needsPrecisionDetail({ centerX: 1, centerY: 0, span: 1e-7 }, 1440), true);
  assert.equal(needsPrecisionDetail({ centerX: 0, centerY: 0, span: 1e-12 }, 1440), false);
  assert.equal(needsPrecisionDetail({ centerX: 0, centerY: 0, span: 1e-40 }, 1440), true);
});

test("keeps GPU scale exponents after JavaScript numbers underflow", () => {
  const view = { centerX: 1.25, centerY: -0.5, span: 6 };
  setSpanLog2(view, -2000);
  assert.equal(spanLog2(view), -2000);
  assert.equal(spanValue(view), Number.MIN_VALUE);
  assert.equal(encodeSpan(view).exponent, -2000);
});

test("preserves drag-sized center deltas below a Number ulp", () => {
  const view = { centerX: 1, centerY: -2, centerXLow: 0, centerYLow: 0 };
  const deltaX = 2 ** -60;
  const deltaY = -(2 ** -61);
  addCenterDelta(view, deltaX, deltaY);

  assert.equal(view.centerX, 1);
  assert.equal(view.centerY, -2);
  const delta = centerDifference(view, { x: 1, y: -2 });
  assert.ok(Math.abs(delta.realHigh + delta.realLow - deltaX) < deltaX * 1e-12);
  assert.ok(Math.abs(delta.imaginaryHigh + delta.imaginaryLow - deltaY) < Math.abs(deltaY) * 1e-12);

  const encoded = encodeScaledDoubleDouble(
    delta.realHigh,
    delta.realLow,
    delta.imaginaryHigh,
    delta.imaginaryLow,
  );
  assert.equal(encoded.exponent, -60);
  assert.ok(Math.abs(encoded.real - 1) < 1e-6);
  assert.ok(Math.abs(encoded.imaginary + 0.5) < 1e-6);
});
