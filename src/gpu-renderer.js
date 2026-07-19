import { cAbs, cAdd, cDiv, cSub, complex, isFiniteComplex } from "./complex.js";
import { evaluateExpression, toDsWgsl, toScaledWgsl, toWgsl } from "./parser.js";
import { MAX_ROOTS } from "./root-finder.js";
import { centerDifference, encodeScaledDoubleDouble } from "./view-center.js";
import { encodeSpan, spanLog2, spanValue } from "./view-scale.js";

const MAX_CONSTANTS = 32;
const MAX_ITERATIONS = 1024;
const BASE_UNIFORM_FLOATS = 24 + MAX_CONSTANTS + MAX_CONSTANTS + MAX_ROOTS * 8;
const REFERENCE_OFFSET = BASE_UNIFORM_FLOATS;
const JACOBIAN_OFFSET = REFERENCE_OFFSET + (MAX_ITERATIONS + 1) * 4;
const CURVATURE_OFFSET = JACOBIAN_OFFSET + MAX_ITERATIONS * 4;
const UNIFORM_FLOATS = CURVATURE_OFFSET + MAX_ITERATIONS * 4;

function gpuError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

const shaderPrelude = /* wgsl */ `
struct Uniforms {
  bounds: vec4<f32>,
  viewport: vec4<f32>,
  render: vec4<f32>,
  view: vec4<f32>,
  origin: vec4<f32>,
  centerOffset: vec4<f32>,
  constants: array<vec4<f32>, 8>,
  constantLow: array<vec4<f32>, 8>,
  roots: array<vec4<f32>, ${MAX_ROOTS * 2}>,
  reference: array<vec4<f32>, ${MAX_ITERATIONS + 1}>,
  jacobian: array<vec4<f32>, ${MAX_ITERATIONS}>,
  curvature: array<vec4<f32>, ${MAX_ITERATIONS}>,
}

@group(0) @binding(0) var<uniform> uniforms: Uniforms;

fn c_add(a: vec2<f32>, b: vec2<f32>) -> vec2<f32> {
  return a + b;
}

fn c_sub(a: vec2<f32>, b: vec2<f32>) -> vec2<f32> {
  return a - b;
}

fn c_neg(a: vec2<f32>) -> vec2<f32> {
  return -a;
}

fn c_mul(a: vec2<f32>, b: vec2<f32>) -> vec2<f32> {
  return vec2<f32>(a.x * b.x - a.y * b.y, a.x * b.y + a.y * b.x);
}

fn c_div(a: vec2<f32>, b: vec2<f32>) -> vec2<f32> {
  let scale = max(abs(b.x), abs(b.y));
  if (scale == 0.0) { return vec2<f32>(0.0, 0.0); }
  let normalized = b / scale;
  let numerator = a / scale;
  let denominator = dot(normalized, normalized);
  return vec2<f32>((numerator.x * normalized.x + numerator.y * normalized.y) / denominator, (numerator.y * normalized.x - numerator.x * normalized.y) / denominator);
}

fn c_abs(a: vec2<f32>) -> vec2<f32> {
  return vec2<f32>(length(a), 0.0);
}

fn c_exp(a: vec2<f32>) -> vec2<f32> {
  let scale = exp(a.x);
  return vec2<f32>(scale * cos(a.y), scale * sin(a.y));
}

fn c_log(a: vec2<f32>) -> vec2<f32> {
  return vec2<f32>(log(max(length(a), 1e-30)), atan2(a.y, a.x));
}

fn c_sqrt(a: vec2<f32>) -> vec2<f32> {
  let radius = length(a);
  let real = sqrt(max(0.0, (radius + a.x) * 0.5));
  let imaginary = select(-sqrt(max(0.0, (radius - a.x) * 0.5)), sqrt(max(0.0, (radius - a.x) * 0.5)), a.y >= 0.0);
  return vec2<f32>(real, imaginary);
}

fn c_sin(a: vec2<f32>) -> vec2<f32> {
  return vec2<f32>(sin(a.x) * cosh(a.y), cos(a.x) * sinh(a.y));
}

fn c_cos(a: vec2<f32>) -> vec2<f32> {
  return vec2<f32>(cos(a.x) * cosh(a.y), -sin(a.x) * sinh(a.y));
}

fn c_tan(a: vec2<f32>) -> vec2<f32> {
  return c_div(c_sin(a), c_cos(a));
}

fn c_pow(a: vec2<f32>, b: vec2<f32>) -> vec2<f32> {
  return c_exp(c_mul(b, c_log(a)));
}

fn ramp(a: vec3<f32>, b: vec3<f32>, c: vec3<f32>, d: vec3<f32>, e: vec3<f32>, t: f32) -> vec3<f32> {
  if (t < 0.25) { return mix(a, b, t * 4.0); }
  if (t < 0.5) { return mix(b, c, (t - 0.25) * 4.0); }
  if (t < 0.75) { return mix(c, d, (t - 0.5) * 4.0); }
  return mix(d, e, (t - 0.75) * 4.0);
}

fn hsv(hue: f32, saturation: f32, value: f32) -> vec3<f32> {
  let k = vec3<f32>(0.0, 4.0, 2.0);
  let p = abs(fract(vec3<f32>(hue) + k / 6.0) * 6.0 - 3.0);
  return value * mix(vec3<f32>(1.0), clamp(p - 1.0, vec3<f32>(0.0), vec3<f32>(1.0)), saturation);
}

fn palette_color(palette: i32, t: f32) -> vec3<f32> {
  if (palette == 0) {
    return ramp(vec3<f32>(0.267, 0.005, 0.329), vec3<f32>(0.231, 0.322, 0.545), vec3<f32>(0.129, 0.565, 0.551), vec3<f32>(0.369, 0.788, 0.384), vec3<f32>(0.992, 0.906, 0.090), t);
  }
  if (palette == 1) {
    return ramp(vec3<f32>(0.051, 0.031, 0.529), vec3<f32>(0.494, 0.012, 0.659), vec3<f32>(0.800, 0.278, 0.471), vec3<f32>(0.973, 0.584, 0.251), vec3<f32>(0.941, 0.976, 0.129), t);
  }
  if (palette == 2) {
    return ramp(vec3<f32>(0.0, 0.0, 0.016), vec3<f32>(0.231, 0.059, 0.439), vec3<f32>(0.549, 0.161, 0.506), vec3<f32>(0.871, 0.286, 0.408), vec3<f32>(0.988, 0.992, 0.749), t);
  }
  if (palette == 3) {
    return ramp(vec3<f32>(0.0, 0.0, 0.016), vec3<f32>(0.259, 0.039, 0.408), vec3<f32>(0.576, 0.149, 0.404), vec3<f32>(0.867, 0.318, 0.227), vec3<f32>(0.988, 1.0, 0.643), t);
  }
  if (palette == 4) {
    return ramp(vec3<f32>(0.0, 0.125, 0.298), vec3<f32>(0.188, 0.298, 0.424), vec3<f32>(0.490, 0.486, 0.471), vec3<f32>(0.788, 0.659, 0.310), vec3<f32>(0.996, 0.910, 0.220), t);
  }
  if (palette == 5) {
    return ramp(vec3<f32>(0.188, 0.071, 0.231), vec3<f32>(0.275, 0.420, 0.890), vec3<f32>(0.106, 0.812, 0.831), vec3<f32>(0.659, 0.925, 0.196), vec3<f32>(0.973, 0.125, 0.090), t);
  }
  if (palette == 6) {
    return hsv(t, 0.78, 0.94);
  }
  if (palette == 7) {
    return ramp(vec3<f32>(0.0, 0.0, 0.498), vec3<f32>(0.0, 0.498, 1.0), vec3<f32>(0.498, 1.0, 0.498), vec3<f32>(1.0, 0.498, 0.0), vec3<f32>(0.498, 0.0, 0.0), t);
  }
  if (palette == 8) {
    return ramp(vec3<f32>(0.231, 0.298, 0.753), vec3<f32>(0.553, 0.690, 0.996), vec3<f32>(0.867, 0.867, 0.867), vec3<f32>(0.957, 0.596, 0.478), vec3<f32>(0.706, 0.016, 0.102), t);
  }
  return ramp(vec3<f32>(0.196, 0.533, 0.741), vec3<f32>(0.600, 0.835, 0.580), vec3<f32>(0.902, 0.961, 0.596), vec3<f32>(0.996, 0.878, 0.545), vec3<f32>(0.835, 0.243, 0.310), t);
}

struct VertexOutput {
  @builtin(position) position: vec4<f32>,
};

@vertex
fn vertex_main(@builtin(vertex_index) index: u32) -> VertexOutput {
  var output: VertexOutput;
  let positions = array<vec2<f32>, 3>(vec2<f32>(-1.0, -1.0), vec2<f32>(3.0, -1.0), vec2<f32>(-1.0, 3.0));
  output.position = vec4<f32>(positions[index], 0.0, 1.0);
  return output;
}
`;

function buildShader(expression, constantNames) {
  const generated = toWgsl(expression.ast, constantNames);
  return `${shaderPrelude}
fn evaluate_value(z: vec2<f32>) -> vec2<f32> {
  return ${generated.value};
}

fn evaluate_derivative(z: vec2<f32>) -> vec2<f32> {
  return ${generated.derivative};
}

@fragment
fn fragment_main(@builtin(position) position: vec4<f32>) -> @location(0) vec4<f32> {
  let uv = position.xy / uniforms.viewport.xy;
  let span = uniforms.bounds.zw - uniforms.bounds.xy;
  let point = vec2<f32>(
    uniforms.bounds.x + uv.x * span.x,
    uniforms.bounds.w - uv.y * span.y
  );
  var z = point;
  var converged = false;
  var iterations = 0.0;

  for (var iteration = 0u; iteration < ${MAX_ITERATIONS}u; iteration = iteration + 1u) {
    if (f32(iteration) >= uniforms.viewport.z) { break; }
    let value = evaluate_value(z);
    let magnitude = length(value);
    iterations = f32(iteration);
    if (magnitude <= uniforms.viewport.w) {
      converged = true;
      break;
    }
    let derivative = evaluate_derivative(z);
    if (length(derivative) == 0.0) { break; }
    let step = c_div(value, derivative);
    let next = z - step;
    if (!(length(next) <= 1e30)) { break; }
    z = next;
  }

  var rootIndex = -1;
  var nearest = 1e20;
  for (var root = 0u; root < ${MAX_ROOTS}u; root = root + 1u) {
    if (f32(root) >= uniforms.render.y) { break; }
    let distance = length(z - uniforms.roots[root * 2u].xy);
    if (distance < nearest) {
      nearest = distance;
      rootIndex = i32(root);
    }
  }

  let progress = min(iterations / max(uniforms.viewport.z, 1.0), 1.0);
  var color = vec3<f32>(0.006, 0.010, 0.014);
  if (converged && rootIndex >= 0) {
    let slot = (f32(rootIndex) + 0.5) / max(uniforms.render.y, 1.0);
    let base = palette_color(i32(uniforms.render.x), fract(slot));
    let shade = 0.38 + 0.72 * pow(1.0 - progress, 0.22);
    let edge = smoothstep(0.0, 0.18, nearest / max(span.x, span.y));
    color = base * shade * (0.78 + 0.22 * edge);
  } else {
    let trace = 0.04 + 0.12 * (1.0 - progress);
    color = vec3<f32>(trace * 0.8, trace, trace * 0.92);
  }
  return vec4<f32>(color, 1.0);
}
`;
}

const doubleSinglePrelude = /* wgsl */ `
struct DsFloat {
  hi: f32,
  lo: f32,
}

struct DsComplex {
  hi: vec2<f32>,
  lo: vec2<f32>,
}

fn ds_float(high: f32, low: f32) -> DsFloat {
  var result: DsFloat;
  result.hi = high;
  result.lo = low;
  return result;
}

fn ds_complex(high: vec2<f32>, low: vec2<f32>) -> DsComplex {
  var result: DsComplex;
  result.hi = high;
  result.lo = low;
  return result;
}

fn ds_real(high: f32, low: f32) -> DsComplex {
  return ds_complex(vec2<f32>(high, 0.0), vec2<f32>(low, 0.0));
}

fn ds_from_vec(value: vec2<f32>) -> DsComplex {
  return ds_complex(value, vec2<f32>(0.0));
}

fn ds_quick_two_sum(a: f32, b: f32) -> DsFloat {
  let sum = a + b;
  return ds_float(sum, b - (sum - a));
}

fn ds_two_sum(a: f32, b: f32) -> DsFloat {
  let sum = a + b;
  let part = sum - a;
  return ds_float(sum, (a - (sum - part)) + (b - part));
}

fn ds_split(value: f32) -> DsFloat {
  let scaled = 4097.0 * value;
  let high = scaled - (scaled - value);
  return ds_float(high, value - high);
}

fn ds_add_scalar(a: DsFloat, b: DsFloat) -> DsFloat {
  let sum = ds_two_sum(a.hi, b.hi);
  return ds_quick_two_sum(sum.hi, sum.lo + a.lo + b.lo);
}

fn ds_sub_scalar(a: DsFloat, b: DsFloat) -> DsFloat {
  let sum = ds_two_sum(a.hi, -b.hi);
  return ds_quick_two_sum(sum.hi, sum.lo + a.lo - b.lo);
}

fn ds_mul_scalar(a: DsFloat, b: DsFloat) -> DsFloat {
  let product = a.hi * b.hi;
  let splitA = ds_split(a.hi);
  let splitB = ds_split(b.hi);
  let productError = ((splitA.hi * splitB.hi - product) + splitA.hi * splitB.lo + splitA.lo * splitB.hi) + splitA.lo * splitB.lo;
  let correction = productError + a.hi * b.lo + a.lo * b.hi + a.lo * b.lo;
  return ds_quick_two_sum(product, correction);
}

fn ds_div_scalar(a: DsFloat, b: DsFloat) -> DsFloat {
  if (abs(b.hi) < 1e-30) { return ds_float(0.0, 0.0); }
  let quotient = a.hi / b.hi;
  let remainder = ds_sub_scalar(a, ds_mul_scalar(b, ds_float(quotient, 0.0)));
  let correction = (remainder.hi + remainder.lo) / b.hi;
  return ds_add_scalar(ds_float(quotient, 0.0), ds_float(correction, 0.0));
}

fn ds_pack(real: DsFloat, imaginary: DsFloat) -> DsComplex {
  return ds_complex(vec2<f32>(real.hi, imaginary.hi), vec2<f32>(real.lo, imaginary.lo));
}

fn ds_add(a: DsComplex, b: DsComplex) -> DsComplex {
  return ds_pack(
    ds_add_scalar(ds_float(a.hi.x, a.lo.x), ds_float(b.hi.x, b.lo.x)),
    ds_add_scalar(ds_float(a.hi.y, a.lo.y), ds_float(b.hi.y, b.lo.y))
  );
}

fn ds_sub(a: DsComplex, b: DsComplex) -> DsComplex {
  return ds_pack(
    ds_sub_scalar(ds_float(a.hi.x, a.lo.x), ds_float(b.hi.x, b.lo.x)),
    ds_sub_scalar(ds_float(a.hi.y, a.lo.y), ds_float(b.hi.y, b.lo.y))
  );
}

fn ds_neg(a: DsComplex) -> DsComplex {
  return ds_complex(-a.hi, -a.lo);
}

fn ds_mul(a: DsComplex, b: DsComplex) -> DsComplex {
  let ar = ds_float(a.hi.x, a.lo.x);
  let ai = ds_float(a.hi.y, a.lo.y);
  let br = ds_float(b.hi.x, b.lo.x);
  let bi = ds_float(b.hi.y, b.lo.y);
  return ds_pack(
    ds_sub_scalar(ds_mul_scalar(ar, br), ds_mul_scalar(ai, bi)),
    ds_add_scalar(ds_mul_scalar(ar, bi), ds_mul_scalar(ai, br))
  );
}

fn ds_div(a: DsComplex, b: DsComplex) -> DsComplex {
  let ar = ds_float(a.hi.x, a.lo.x);
  let ai = ds_float(a.hi.y, a.lo.y);
  let br = ds_float(b.hi.x, b.lo.x);
  let bi = ds_float(b.hi.y, b.lo.y);
  let denominator = ds_add_scalar(ds_mul_scalar(br, br), ds_mul_scalar(bi, bi));
  return ds_pack(
    ds_div_scalar(ds_add_scalar(ds_mul_scalar(ar, br), ds_mul_scalar(ai, bi)), denominator),
    ds_div_scalar(ds_sub_scalar(ds_mul_scalar(ai, br), ds_mul_scalar(ar, bi)), denominator)
  );
}

fn ds_value(a: DsComplex) -> vec2<f32> {
  return a.hi + a.lo;
}

fn ds_length(a: DsComplex) -> f32 {
  return length(ds_value(a));
}

fn ds_abs(a: DsComplex) -> DsComplex {
  let radius = length(a.hi);
  if (radius < 1e-30) { return ds_real(length(a.lo), 0.0); }
  return ds_real(radius, dot(a.hi, a.lo) / radius);
}

fn ds_exp(a: DsComplex) -> DsComplex {
  let high = c_exp(a.hi);
  return ds_complex(high, c_mul(high, a.lo));
}

fn ds_log(a: DsComplex) -> DsComplex {
  let high = c_log(a.hi);
  return ds_complex(high, c_div(a.lo, a.hi));
}

fn ds_sqrt(a: DsComplex) -> DsComplex {
  let high = c_sqrt(a.hi);
  return ds_complex(high, c_div(0.5 * a.lo, high));
}

fn ds_sin(a: DsComplex) -> DsComplex {
  let high = c_sin(a.hi);
  return ds_complex(high, c_mul(c_cos(a.hi), a.lo));
}

fn ds_cos(a: DsComplex) -> DsComplex {
  let high = c_cos(a.hi);
  return ds_complex(high, c_mul(c_neg(c_sin(a.hi)), a.lo));
}

fn ds_tan(a: DsComplex) -> DsComplex {
  let high = c_tan(a.hi);
  let derivative = c_div(vec2<f32>(1.0, 0.0), c_mul(c_cos(a.hi), c_cos(a.hi)));
  return ds_complex(high, c_mul(derivative, a.lo));
}

fn ds_pow(a: DsComplex, b: DsComplex) -> DsComplex {
  let high = c_pow(a.hi, b.hi);
  if (length(a.hi) < 1e-30) { return ds_complex(high, vec2<f32>(0.0)); }
  let logarithm = c_log(a.hi);
  let correction = c_add(c_mul(b.lo, logarithm), c_mul(b.hi, c_div(a.lo, a.hi)));
  return ds_complex(high, c_mul(high, correction));
}

struct ScaledComplex {
  value: vec2<f32>,
  exponent: f32,
}

fn sc_complex(value: vec2<f32>, exponent: f32) -> ScaledComplex {
  var result: ScaledComplex;
  result.value = value;
  result.exponent = exponent;
  return result;
}

fn sc_normalize(value: vec2<f32>, exponent: f32) -> ScaledComplex {
  let magnitude = length(value);
  if (magnitude == 0.0) { return sc_complex(vec2<f32>(0.0), 0.0); }
  let adjustment = floor(log2(magnitude));
  return sc_complex(value / exp2(adjustment), exponent + adjustment);
}

fn sc_from_vec(value: vec2<f32>, exponent: f32) -> ScaledComplex {
  return sc_normalize(value, exponent);
}

fn sc_zero() -> ScaledComplex {
  return sc_complex(vec2<f32>(0.0), 0.0);
}

fn sc_neg(a: ScaledComplex) -> ScaledComplex {
  return sc_complex(-a.value, a.exponent);
}

fn sc_real(value: f32) -> ScaledComplex {
  return sc_from_vec(vec2<f32>(value, 0.0), 0.0);
}

fn sc_from_ds(value: DsComplex) -> ScaledComplex {
  return sc_from_vec(value.hi + value.lo, 0.0);
}

fn sc_add(a: ScaledComplex, b: ScaledComplex) -> ScaledComplex {
  if (length(a.value) == 0.0) { return b; }
  if (length(b.value) == 0.0) { return a; }
  let exponent = max(a.exponent, b.exponent);
  let aScale = exp2(a.exponent - exponent);
  let bScale = exp2(b.exponent - exponent);
  return sc_normalize(a.value * aScale + b.value * bScale, exponent);
}

fn sc_sub(a: ScaledComplex, b: ScaledComplex) -> ScaledComplex {
  if (length(a.value) == 0.0) { return sc_neg(b); }
  if (length(b.value) == 0.0) { return a; }
  let exponent = max(a.exponent, b.exponent);
  let aScale = exp2(a.exponent - exponent);
  let bScale = exp2(b.exponent - exponent);
  return sc_normalize(a.value * aScale - b.value * bScale, exponent);
}

fn sc_mul(a: ScaledComplex, b: ScaledComplex) -> ScaledComplex {
  return sc_normalize(c_mul(a.value, b.value), a.exponent + b.exponent);
}

fn sc_div(a: ScaledComplex, b: ScaledComplex) -> ScaledComplex {
  if (length(b.value) == 0.0) { return sc_zero(); }
  return sc_normalize(c_div(a.value, b.value), a.exponent - b.exponent);
}

fn sc_mul_vec(a: ScaledComplex, b: vec2<f32>) -> ScaledComplex {
  return sc_normalize(c_mul(a.value, b), a.exponent);
}

fn sc_mul_ds(a: ScaledComplex, b: DsComplex) -> ScaledComplex {
  return sc_mul(a, sc_from_ds(b));
}

fn sc_square(a: ScaledComplex) -> ScaledComplex {
  return sc_mul(a, a);
}

fn sc_half(a: ScaledComplex) -> ScaledComplex {
  return sc_complex(a.value, a.exponent - 1.0);
}

fn sc_log2_length(a: ScaledComplex) -> f32 {
  let magnitude = length(a.value);
  if (magnitude == 0.0) { return -1e30; }
  return log2(magnitude) + a.exponent;
}

fn sc_to_vec(a: ScaledComplex) -> vec2<f32> {
  let safeExponent = clamp(a.exponent, -126.0, 127.0);
  return a.value * exp2(safeExponent);
}

fn sc_log(a: ScaledComplex) -> ScaledComplex {
  let magnitude = length(a.value);
  if (magnitude == 0.0) { return sc_real(-1e30); }
  return sc_from_vec(vec2<f32>(log(magnitude) + a.exponent * 0.6931471805599453, atan2(a.value.y, a.value.x)), 0.0);
}

fn sc_exp(a: ScaledComplex) -> ScaledComplex {
  let input = sc_to_vec(a);
  let exponent = input.x * 1.4426950408889634;
  return sc_normalize(vec2<f32>(cos(input.y), sin(input.y)), exponent);
}

fn sc_sin(a: ScaledComplex) -> ScaledComplex {
  if (sc_log2_length(a) < -12.0) { return a; }
  return sc_from_vec(c_sin(sc_to_vec(a)), 0.0);
}

fn sc_cos(a: ScaledComplex) -> ScaledComplex {
  if (sc_log2_length(a) < -12.0) { return sc_sub(sc_real(1.0), sc_half(sc_square(a))); }
  return sc_from_vec(c_cos(sc_to_vec(a)), 0.0);
}

fn sc_tan(a: ScaledComplex) -> ScaledComplex {
  return sc_div(sc_sin(a), sc_cos(a));
}

fn sc_sqrt(a: ScaledComplex) -> ScaledComplex {
  return sc_normalize(c_sqrt(a.value), a.exponent * 0.5);
}

fn sc_abs(a: ScaledComplex) -> ScaledComplex {
  let magnitude = sc_log2_length(a);
  if (magnitude < -1e29) { return sc_zero(); }
  return sc_complex(vec2<f32>(1.0, 0.0), magnitude);
}

fn sc_pow(a: ScaledComplex, b: ScaledComplex) -> ScaledComplex {
  if (sc_log2_length(a) < -1e29) { return sc_zero(); }
  return sc_exp(sc_mul(b, sc_log(a)));
}

fn sc_to_ds(a: ScaledComplex) -> DsComplex {
  if (a.exponent < -149.0) { return ds_from_vec(vec2<f32>(0.0)); }
  let safeExponent = min(a.exponent, 127.0);
  return ds_from_vec(a.value * exp2(safeExponent));
}
`;

function buildDeepShader(expression, constantNames) {
  const generated = toDsWgsl(expression.ast, constantNames);
  const scaled = toScaledWgsl(expression.ast, constantNames);
  return `${shaderPrelude}
${doubleSinglePrelude}
fn evaluate_value_ds(z: DsComplex) -> DsComplex {
  return ${generated.value};
}

fn evaluate_derivative_ds(z: DsComplex) -> DsComplex {
  return ${generated.derivative};
}

fn evaluate_value_scaled(scaledZ: ScaledComplex) -> ScaledComplex {
  return ${scaled.value};
}

fn evaluate_derivative_scaled(scaledZ: ScaledComplex) -> ScaledComplex {
  return ${scaled.derivative};
}

@fragment
fn fragment_main(@builtin(position) position: vec4<f32>) -> @location(0) vec4<f32> {
  let centered = position.xy - uniforms.viewport.xy * 0.5;
  let initialOffset = vec2<f32>(
    centered.x * uniforms.view.x / uniforms.viewport.x,
    -centered.y * uniforms.view.y / uniforms.viewport.y
  );
  let referenceStart = ds_complex(
    vec2<f32>(uniforms.origin.x, uniforms.origin.z),
    vec2<f32>(uniforms.origin.y, uniforms.origin.w)
  );
  var centerOffsetScaled = sc_from_vec(uniforms.centerOffset.xy, uniforms.centerOffset.z);
  var pixelOffsetScaled = sc_from_vec(initialOffset, uniforms.view.z);
  var offset = sc_add(centerOffsetScaled, pixelOffsetScaled);
  var z = ds_add(referenceStart, sc_to_ds(offset));
  var scaledZ = sc_add(sc_from_ds(referenceStart), offset);
  var scaledMode = uniforms.render.z > 0.5;
  var directMode = false;
  var converged = false;
  var iterations = 0.0;
  let toleranceLog2 = log2(max(uniforms.viewport.w, 1e-30));

  for (var iteration = 0u; iteration < ${MAX_ITERATIONS}u; iteration = iteration + 1u) {
    if (!scaledMode && f32(iteration) >= uniforms.viewport.z) { break; }
    iterations = f32(iteration);
    if (scaledMode) {
      let value = evaluate_value_scaled(scaledZ);
      if (sc_log2_length(value) <= toleranceLog2) {
        converged = true;
        break;
      }
      let derivative = evaluate_derivative_scaled(scaledZ);
      if (sc_log2_length(derivative) <= -1e29) { break; }
      let next = sc_sub(scaledZ, sc_div(value, derivative));
      if (!(sc_log2_length(next) <= 1000000.0)) { break; }
      scaledZ = next;
      z = sc_to_ds(scaledZ);
    } else if (directMode) {
      let value = evaluate_value_ds(z);
      if (ds_length(value) <= uniforms.viewport.w) {
        converged = true;
        break;
      }
      let derivative = evaluate_derivative_ds(z);
      if (ds_length(derivative) == 0.0) { break; }
      let next = ds_sub(z, ds_div(value, derivative));
      if (!(ds_length(next) <= 1e8)) { break; }
      z = next;
    } else {
      let jacobian = ds_complex(
        uniforms.jacobian[iteration].xy,
        uniforms.jacobian[iteration].zw
      );
      let curvature = ds_complex(
        uniforms.curvature[iteration].xy,
        uniforms.curvature[iteration].zw
      );
      let linear = sc_mul_ds(offset, jacobian);
      let quadratic = sc_half(sc_mul_ds(sc_square(offset), curvature));
      let nextOffset = sc_add(linear, quadratic);
      let nextReference = ds_complex(
        uniforms.reference[iteration + 1u].xy,
        uniforms.reference[iteration + 1u].zw
      );
      let next = ds_add(nextReference, sc_to_ds(nextOffset));
      if (!(ds_length(next) <= 1e8)) { break; }
      if (sc_log2_length(nextOffset) > -6.643856) { directMode = true; }
      offset = nextOffset;
      z = next;
    }
  }

  var rootIndex = -1;
  var nearest = 1e20;
  for (var root = 0u; root < ${MAX_ROOTS}u; root = root + 1u) {
    if (f32(root) >= uniforms.render.y) { break; }
    let rootHigh = uniforms.roots[root * 2u];
    let rootLow = uniforms.roots[root * 2u + 1u];
    let rootPoint = ds_complex(rootHigh.xy, rootLow.xy);
    let distance = ds_length(ds_sub(z, rootPoint));
    if (distance < nearest) {
      nearest = distance;
      rootIndex = i32(root);
    }
  }

  if (!converged) {
    converged = rootIndex >= 0 && nearest <= max(uniforms.viewport.w * 8.0, 1e-6);
  }
  let progress = min(iterations / max(uniforms.viewport.z, 1.0), 1.0);
  var color = vec3<f32>(0.006, 0.010, 0.014);
  if (converged && rootIndex >= 0) {
    let slot = (f32(rootIndex) + 0.5) / max(uniforms.render.y, 1.0);
    let base = palette_color(i32(uniforms.render.x), fract(slot));
    let shade = 0.38 + 0.72 * pow(1.0 - progress, 0.22);
    var relativeDistance = 0.0;
    if (nearest > 0.0) {
      let viewLog2 = log2(max(uniforms.view.x, 1e-30)) + uniforms.view.z;
      relativeDistance = exp2(clamp(log2(nearest) - viewLog2, -126.0, 0.0));
    }
    let edge = smoothstep(0.0, 0.18, relativeDistance);
    color = base * shade * (0.78 + 0.22 * edge);
  } else {
    let trace = 0.04 + 0.12 * (1.0 - progress);
    color = vec3<f32>(trace * 0.8, trace, trace * 0.92);
  }
  return vec4<f32>(color, 1.0);
}
`;
}

function boundsForView(view, width, height) {
  const spanX = spanValue(view);
  const spanY = spanX * height / Math.max(width, 1);
  const centerX = view.centerX + (Number.isFinite(view.centerXLow) ? view.centerXLow : 0);
  const centerY = view.centerY + (Number.isFinite(view.centerYLow) ? view.centerYLow : 0);
  return [
    centerX - spanX * 0.5,
    centerY - spanY * 0.5,
    centerX + spanX * 0.5,
    centerY + spanY * 0.5,
  ];
}

function splitFloat64(value) {
  const high = Math.fround(Number(value) || 0);
  return [high, (Number(value) || 0) - high];
}

function newtonMap(expression, z, constants) {
  const result = evaluateExpression(expression.ast, z, constants);
  if (!isFiniteComplex(result.value) || !isFiniteComplex(result.derivative) || cAbs(result.derivative) < 1e-10) return null;
  const step = cDiv(result.value, result.derivative);
  const next = cSub(z, step);
  if (!isFiniteComplex(next) || cAbs(next) > 1e8) return null;
  return next;
}

function writeSplitComplex(target, offset, value) {
  const [realHigh, realLow] = splitFloat64(value[0]);
  const [imaginaryHigh, imaginaryLow] = splitFloat64(value[1]);
  target[offset] = realHigh;
  target[offset + 1] = imaginaryHigh;
  target[offset + 2] = realLow;
  target[offset + 3] = imaginaryLow;
}

function buildReferenceOrbit(state, referenceCenter) {
  const reference = new Float32Array((MAX_ITERATIONS + 1) * 4);
  const jacobian = new Float32Array(MAX_ITERATIONS * 4);
  const curvature = new Float32Array(MAX_ITERATIONS * 4);
  let z = complex(referenceCenter.x, referenceCenter.y);
  let stopped = false;
  let valid = true;

  for (let iteration = 0; iteration <= MAX_ITERATIONS; iteration += 1) {
    writeSplitComplex(reference, iteration * 4, z);
    if (iteration === MAX_ITERATIONS) break;
    if (stopped) continue;

    const next = newtonMap(state.expression, z, state.constants);
    if (!next) {
      valid = false;
      stopped = true;
      continue;
    }

    const stepSize = Math.max(1e-7, Math.min(1e-3, Math.max(cAbs(z), 1) * 1e-6));
    const plus = newtonMap(state.expression, [z[0] + stepSize, z[1]], state.constants);
    const minus = newtonMap(state.expression, [z[0] - stepSize, z[1]], state.constants);
    if (plus && minus) {
      const denominator = complex(2 * stepSize, 0);
      const first = cDiv(cSub(plus, minus), denominator);
      const secondNumerator = cSub(cAdd(plus, minus), [2 * next[0], 2 * next[1]]);
      const second = cDiv(secondNumerator, complex(stepSize * stepSize, 0));
      writeSplitComplex(jacobian, iteration * 4, first);
      writeSplitComplex(curvature, iteration * 4, second);
    } else {
      valid = false;
    }
    z = next;
  }

  return { reference, jacobian, curvature, valid };
}

function referenceKey(state, referenceCenter) {
  const constants = Object.keys(state.constants)
    .sort()
    .map((name) => `${name}:${state.constants[name]}`)
    .join(",");
  return [
    state.expression.source,
    referenceCenter.x,
    referenceCenter.y,
    state.iterations,
    state.tolerance,
    constants,
  ].join("|");
}

function differenceLog2(delta) {
  const magnitude = Math.max(
    Math.abs(delta.realHigh),
    Math.abs(delta.realLow),
    Math.abs(delta.imaginaryHigh),
    Math.abs(delta.imaginaryLow),
  );
  return magnitude > 0 && Number.isFinite(magnitude) ? Math.log2(magnitude) : -Infinity;
}

function shouldRebase(delta, view) {
  return differenceLog2(delta) > spanLog2(view) + 3;
}

export class GpuRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.adapter = null;
    this.device = null;
    this.context = null;
    this.format = null;
    this.uniformBuffer = null;
    this.pipeline = null;
    this.bindGroup = null;
    this.detailPipeline = null;
    this.detailBindGroup = null;
    this.detailSupported = false;
    this.expression = null;
    this.constantNames = [];
    this.referenceCache = null;
    this.referenceCenter = null;
    this.lastGpuTime = 0;
    this.ready = false;
  }

  async initialize() {
    if (!window.isSecureContext) throw gpuError("secure-context", "WebGPU requires a secure context. Use localhost, 127.0.0.1, or HTTPS.");
    if (!navigator.gpu) throw gpuError("unsupported", "WebGPU is not available in this browser.");

    const adapterRequests = [
      undefined,
      { powerPreference: "low-power" },
      { powerPreference: "high-performance" },
    ];
    for (const options of adapterRequests) {
      try {
        this.adapter = await navigator.gpu.requestAdapter(options);
      } catch {
        this.adapter = null;
      }
      if (this.adapter) break;
    }
    if (!this.adapter) throw gpuError("adapter", "Edge did not return a WebGPU adapter. Enable graphics acceleration and inspect edge://gpu.");
    this.device = await this.adapter.requestDevice();
    this.context = this.canvas.getContext("webgpu");
    if (!this.context) throw gpuError("context", "The WebGPU canvas context could not be created.");
    this.format = navigator.gpu.getPreferredCanvasFormat();
    this.configure();
    this.uniformBuffer = this.device.createBuffer({
      size: UNIFORM_FLOATS * Float32Array.BYTES_PER_ELEMENT,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.device.addEventListener("uncapturederror", (event) => {
      console.error("[WebGPU] uncaptured error", event.error);
    });
    this.device.lost.then((info) => {
      this.ready = false;
      if (this.onDeviceLost) this.onDeviceLost(info);
    });
    this.ready = true;
  }

  configure() {
    this.context.configure({
      device: this.device,
      format: this.format,
      alphaMode: "opaque",
    });
  }

  async setExpression(expression, constantNames) {
    if (!this.ready) return;
    if (constantNames.length > MAX_CONSTANTS) throw new Error(`WebGPU supports up to ${MAX_CONSTANTS} user constants at once.`);
    const module = this.device.createShaderModule({ code: buildShader(expression, constantNames) });
    if (typeof module.getCompilationInfo === "function") {
      const compilation = await module.getCompilationInfo();
      const errors = compilation.messages.filter((message) => message.type === "error");
      if (errors.length) throw new Error(errors[0].message);
    }
    this.pipeline = this.device.createRenderPipeline({
      layout: "auto",
      vertex: { module, entryPoint: "vertex_main" },
      fragment: { module, entryPoint: "fragment_main", targets: [{ format: this.format }] },
      primitive: { topology: "triangle-list" },
    });
    this.bindGroup = this.device.createBindGroup({
      layout: this.pipeline.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer: this.uniformBuffer } }],
    });

    this.detailPipeline = null;
    this.detailBindGroup = null;
    this.detailSupported = false;
    this.referenceCache = null;
    this.referenceCenter = null;
    try {
      const detailModule = this.device.createShaderModule({ code: buildDeepShader(expression, constantNames) });
      if (typeof detailModule.getCompilationInfo === "function") {
        const compilation = await detailModule.getCompilationInfo();
        const errors = compilation.messages.filter((message) => message.type === "error");
        if (errors.length) throw new Error(errors[0].message);
      }
      this.detailPipeline = this.device.createRenderPipeline({
        layout: "auto",
        vertex: { module: detailModule, entryPoint: "vertex_main" },
        fragment: { module: detailModule, entryPoint: "fragment_main", targets: [{ format: this.format }] },
        primitive: { topology: "triangle-list" },
      });
      this.detailBindGroup = this.device.createBindGroup({
        layout: this.detailPipeline.getBindGroupLayout(0),
        entries: [{ binding: 0, resource: { buffer: this.uniformBuffer } }],
      });
      this.detailSupported = true;
    } catch (error) {
      console.warn("GPU precision detail shader is unavailable; standard GPU mode remains active.", error);
    }
    this.expression = expression;
    this.constantNames = constantNames;
  }

  resize() {
    const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(1, Math.floor(this.canvas.clientWidth * pixelRatio));
    const height = Math.max(1, Math.floor(this.canvas.clientHeight * pixelRatio));
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
      this.configure();
    }
    return { width, height, pixelRatio };
  }

  render(state, roots, detail = false) {
    const pipeline = detail ? this.detailPipeline : this.pipeline;
    const bindGroup = detail ? this.detailBindGroup : this.bindGroup;
    if (!this.ready || !pipeline || !bindGroup) return null;
    const { width, height } = this.resize();
    const bounds = boundsForView(state.view, width, height);
    const spanScale = encodeSpan(state.view, height / Math.max(width, 1));
    const spanX = spanValue(state.view);
    const spanY = spanX * height / Math.max(width, 1);
    let originCenter = { x: state.view.centerX, y: state.view.centerY };
    let centerOffset = { real: 0, imaginary: 0, exponent: 0 };
    if (detail) {
      if (!this.referenceCenter) {
        this.referenceCenter = { x: state.view.centerX, y: state.view.centerY };
      }
      let delta = centerDifference(state.view, this.referenceCenter);
      if (shouldRebase(delta, state.view)) {
        this.referenceCenter = { x: state.view.centerX, y: state.view.centerY };
        this.referenceCache = null;
        delta = centerDifference(state.view, this.referenceCenter);
      }
      originCenter = this.referenceCenter;
      centerOffset = encodeScaledDoubleDouble(
        delta.realHigh,
        delta.realLow,
        delta.imaginaryHigh,
        delta.imaginaryLow,
      );
    }
    const [centerXHigh, centerXLow] = splitFloat64(originCenter.x);
    const [centerYHigh, centerYLow] = splitFloat64(originCenter.y);
    const uniforms = new Float32Array(UNIFORM_FLOATS);
    uniforms.set(bounds, 0);
    uniforms.set([width, height, state.iterations, state.tolerance], 4);
    uniforms.set([state.paletteIndex, roots.length, 0, 0], 8);
    uniforms.set([spanScale.mantissa, spanScale.verticalMantissa, spanScale.exponent, 0], 12);
    uniforms.set([centerXHigh, centerXLow, centerYHigh, centerYLow], 16);
    uniforms.set([centerOffset.real, centerOffset.imaginary, centerOffset.exponent, 0], 20);
    this.constantNames.forEach((name, index) => {
      const [high, low] = splitFloat64(state.constants[name]);
      const componentOffset = index;
      uniforms[24 + componentOffset] = high;
      uniforms[56 + componentOffset] = low;
    });
    const rootsOffset = 88;
    roots.forEach((root, index) => {
      const [realHigh, realLow] = splitFloat64(root.re);
      const [imaginaryHigh, imaginaryLow] = splitFloat64(root.im);
      const offset = rootsOffset + index * 8;
      uniforms[offset] = realHigh;
      uniforms[offset + 1] = imaginaryHigh;
      uniforms[offset + 4] = realLow;
      uniforms[offset + 5] = imaginaryLow;
    });
    if (detail) {
      const key = referenceKey(state, this.referenceCenter);
      if (!this.referenceCache || this.referenceCache.key !== key) {
        this.referenceCache = { key, ...buildReferenceOrbit(state, this.referenceCenter) };
      }
      uniforms.set(this.referenceCache.reference, REFERENCE_OFFSET);
      uniforms.set(this.referenceCache.jacobian, JACOBIAN_OFFSET);
      uniforms.set(this.referenceCache.curvature, CURVATURE_OFFSET);
      uniforms[10] = this.referenceCache.valid ? 0 : 1;
    }
    this.device.queue.writeBuffer(this.uniformBuffer, 0, uniforms);

    const start = performance.now();
    const encoder = this.device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [{
        view: this.context.getCurrentTexture().createView(),
        clearValue: { r: 0.006, g: 0.01, b: 0.014, a: 1 },
        loadOp: "clear",
        storeOp: "store",
      }],
    });
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.draw(3);
    pass.end();
    this.device.queue.submit([encoder.finish()]);
    this.lastGpuTime = performance.now() - start;
    return { width, height, pixelRatio: Math.min(window.devicePixelRatio || 1, 2), renderTime: this.lastGpuTime };
  }

  destroy() {
    this.uniformBuffer?.destroy();
    this.ready = false;
  }
}

export { MAX_CONSTANTS, buildDeepShader, buildShader };
