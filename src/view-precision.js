const F32_RELATIVE_EPSILON = 1.1920928955078125e-7;
const PRECISION_SAFETY_FACTOR = 2;

export function needsPrecisionDetail(view, width) {
  const span = Math.max(view.span, 1e-18);
  const pixelSpan = span / Math.max(width, 1);
  const centerMagnitude = Math.hypot(view.centerX, view.centerY);
  const scaleMagnitude = Math.max(centerMagnitude, span, 1e-30);
  return pixelSpan < scaleMagnitude * F32_RELATIVE_EPSILON * PRECISION_SAFETY_FACTOR;
}

export { F32_RELATIVE_EPSILON };
