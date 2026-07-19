export const ZERO = [0, 0];
export const ONE = [1, 0];

export function complex(re = 0, im = 0) {
  return [re, im];
}

export function cAdd(a, b) {
  return [a[0] + b[0], a[1] + b[1]];
}

export function cSub(a, b) {
  return [a[0] - b[0], a[1] - b[1]];
}

export function cNeg(a) {
  return [-a[0], -a[1]];
}

export function cMul(a, b) {
  return [a[0] * b[0] - a[1] * b[1], a[0] * b[1] + a[1] * b[0]];
}

export function cDiv(a, b) {
  const denominator = b[0] * b[0] + b[1] * b[1];
  if (denominator < 1e-30) return [Number.NaN, Number.NaN];
  return [
    (a[0] * b[0] + a[1] * b[1]) / denominator,
    (a[1] * b[0] - a[0] * b[1]) / denominator,
  ];
}

export function cAbs(a) {
  return Math.hypot(a[0], a[1]);
}

export function cExp(a) {
  const scale = Math.exp(a[0]);
  return [scale * Math.cos(a[1]), scale * Math.sin(a[1])];
}

export function cLog(a) {
  return [Math.log(Math.max(cAbs(a), 1e-30)), Math.atan2(a[1], a[0])];
}

export function cSqrt(a) {
  const radius = cAbs(a);
  const real = Math.sqrt(Math.max(0, (radius + a[0]) * 0.5));
  const imaginary = Math.sign(a[1] || 1) * Math.sqrt(Math.max(0, (radius - a[0]) * 0.5));
  return [real, imaginary];
}

export function cSin(a) {
  return [Math.sin(a[0]) * Math.cosh(a[1]), Math.cos(a[0]) * Math.sinh(a[1])];
}

export function cCos(a) {
  return [Math.cos(a[0]) * Math.cosh(a[1]), -Math.sin(a[0]) * Math.sinh(a[1])];
}

export function cTan(a) {
  return cDiv(cSin(a), cCos(a));
}

export function cPow(a, b) {
  if (cAbs(a) < 1e-30) return [0, 0];
  return cExp(cMul(b, cLog(a)));
}

export function isFiniteComplex(a) {
  return Number.isFinite(a[0]) && Number.isFinite(a[1]);
}
