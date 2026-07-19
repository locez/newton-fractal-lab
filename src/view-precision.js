import { spanLog2 } from "./view-scale.js";

const F32_RELATIVE_EPSILON = 1.1920928955078125e-7;
const PRECISION_SAFETY_FACTOR = 2;
const F32_MIN_NORMAL_LOG2 = -126;
const F32_CRITICAL_VIEW_LOG2 = -10;

export function needsPrecisionDetail(view, width) {
  const logSpan = spanLog2(view);
  const pixelLogSpan = logSpan - Math.log2(Math.max(width, 1));
  const centerMagnitude = Math.hypot(view.centerX, view.centerY);
  const scaleLog = centerMagnitude > 0 ? Math.log2(centerMagnitude) : logSpan;
  const relativeLimit = scaleLog + Math.log2(F32_RELATIVE_EPSILON * PRECISION_SAFETY_FACTOR);
  return logSpan < F32_CRITICAL_VIEW_LOG2 || logSpan < F32_MIN_NORMAL_LOG2 || pixelLogSpan < relativeLimit;
}

export { F32_MIN_NORMAL_LOG2, F32_RELATIVE_EPSILON, F32_CRITICAL_VIEW_LOG2 };
