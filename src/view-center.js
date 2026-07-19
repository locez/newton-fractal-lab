function twoSum(a, b) {
  const sum = a + b;
  const part = sum - a;
  return [sum, (a - (sum - part)) + (b - part)];
}

function quickTwoSum(a, b) {
  const sum = a + b;
  return [sum, b - (sum - a)];
}

function normalize(hi, lo) {
  const [sum, error] = twoSum(hi, lo);
  return quickTwoSum(sum, error);
}

function addScalar(hi, lo, value) {
  const [sum, error] = twoSum(hi, value);
  return normalize(sum, error + lo);
}

function subtractPair(ahi, alo, bhi, blo = 0) {
  const [difference, error] = twoSum(ahi, -bhi);
  return normalize(difference, error + alo - blo);
}

function readLow(view, axis) {
  const value = view[`${axis}Low`];
  return Number.isFinite(value) ? value : 0;
}

export function setCenter(view, real, imaginary) {
  view.centerX = Number.isFinite(real) ? real : 0;
  view.centerY = Number.isFinite(imaginary) ? imaginary : 0;
  view.centerXLow = 0;
  view.centerYLow = 0;
}

export function addCenterDelta(view, realDelta, imaginaryDelta) {
  const real = addScalar(view.centerX, readLow(view, "centerX"), realDelta);
  const imaginary = addScalar(view.centerY, readLow(view, "centerY"), imaginaryDelta);
  view.centerX = real[0];
  view.centerXLow = real[1];
  view.centerY = imaginary[0];
  view.centerYLow = imaginary[1];
}

export function centerDifference(view, reference) {
  const real = subtractPair(
    view.centerX,
    readLow(view, "centerX"),
    reference.x,
    reference.xLow || 0,
  );
  const imaginary = subtractPair(
    view.centerY,
    readLow(view, "centerY"),
    reference.y,
    reference.yLow || 0,
  );
  return {
    realHigh: real[0],
    realLow: real[1],
    imaginaryHigh: imaginary[0],
    imaginaryLow: imaginary[1],
  };
}

export function centerApprox(view) {
  return {
    re: view.centerX + readLow(view, "centerX"),
    im: view.centerY + readLow(view, "centerY"),
  };
}

export function encodeScaledDoubleDouble(realHigh, realLow, imaginaryHigh, imaginaryLow) {
  const magnitude = Math.max(
    Math.abs(realHigh),
    Math.abs(realLow),
    Math.abs(imaginaryHigh),
    Math.abs(imaginaryLow),
  );
  if (!(magnitude > 0) || !Number.isFinite(magnitude)) {
    return { real: 0, imaginary: 0, exponent: 0 };
  }

  const exponent = Math.floor(Math.log2(magnitude));
  const scale = 2 ** exponent;
  if (!(scale > 0) || !Number.isFinite(scale)) {
    return { real: 0, imaginary: 0, exponent };
  }
  return {
    real: realHigh / scale + realLow / scale,
    imaginary: imaginaryHigh / scale + imaginaryLow / scale,
    exponent,
  };
}

