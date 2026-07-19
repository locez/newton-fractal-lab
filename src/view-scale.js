const MIN_LOG2 = Math.log2(Number.MIN_VALUE);
const MAX_LOG2 = Math.log2(Number.MAX_VALUE);

export function spanLog2(view) {
  if (Number.isFinite(view.spanLog2)) return view.spanLog2;
  const span = Number.isFinite(view.span) && view.span > 0 ? view.span : Number.MIN_VALUE;
  return Math.log2(span);
}

export function spanValue(view) {
  const exponent = spanLog2(view);
  if (exponent <= MIN_LOG2) return Number.MIN_VALUE;
  if (exponent >= MAX_LOG2) return Number.MAX_VALUE;
  return 2 ** exponent;
}

export function setSpanLog2(view, exponent) {
  const next = Number.isFinite(exponent)
    ? exponent
    : exponent < 0
      ? -Number.MAX_VALUE
      : Number.MAX_VALUE;
  view.spanLog2 = next;
  view.span = spanValue(view);
}

export function encodeSpan(view, aspect = 1) {
  const exponent = spanLog2(view);
  const sharedExponent = Math.floor(exponent);
  const mantissa = 2 ** (exponent - sharedExponent);
  const safeAspect = Number.isFinite(aspect) && aspect > 0 ? aspect : 1;
  const verticalMantissa = mantissa * safeAspect;
  return { mantissa, verticalMantissa, exponent: sharedExponent };
}

export { MIN_LOG2, MAX_LOG2 };
