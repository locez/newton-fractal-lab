import { cAbs, cDiv, cSub, complex, isFiniteComplex } from "./complex.js";
import { evaluateExpression } from "./parser.js";
import { spanValue } from "./view-scale.js";

const MAX_ROOTS = 24;

function boundsForView(view, width, height) {
  const spanX = spanValue(view);
  const spanY = spanX * height / Math.max(width, 1);
  const centerX = view.centerX + (Number.isFinite(view.centerXLow) ? view.centerXLow : 0);
  const centerY = view.centerY + (Number.isFinite(view.centerYLow) ? view.centerYLow : 0);
  return {
    minX: centerX - spanX * 0.5,
    maxX: centerX + spanX * 0.5,
    minY: centerY - spanY * 0.5,
    maxY: centerY + spanY * 0.5,
    spanX,
    spanY,
  };
}

function addRoot(roots, candidate, tolerance) {
  const existing = roots.find((root) => Math.hypot(root[0] - candidate[0], root[1] - candidate[1]) <= tolerance);
  if (existing) {
    existing[0] = (existing[0] + candidate[0]) * 0.5;
    existing[1] = (existing[1] + candidate[1]) * 0.5;
    return;
  }
  roots.push(candidate);
}

export function findRoots(expression, constants, view, width = 1200, height = 800) {
  const bounds = boundsForView(view, width, height);
  const range = Math.max(bounds.spanX, bounds.spanY, 2) * 0.62;
  const tolerance = Math.max(1e-7, range * 2e-5);
  const roots = [];
  const gridSize = 17;
  const centerX = view.centerX + (Number.isFinite(view.centerXLow) ? view.centerXLow : 0);
  const centerY = view.centerY + (Number.isFinite(view.centerYLow) ? view.centerYLow : 0);
  const searchMinX = centerX - range;
  const searchMinY = centerY - range;

  for (let gy = 0; gy < gridSize && roots.length < MAX_ROOTS; gy += 1) {
    for (let gx = 0; gx < gridSize && roots.length < MAX_ROOTS; gx += 1) {
      const seed = complex(
        searchMinX + (gx / (gridSize - 1)) * range * 2,
        searchMinY + (gy / (gridSize - 1)) * range * 2,
      );
      let z = seed;
      let converged = false;

      for (let iteration = 0; iteration < 96; iteration += 1) {
        const result = evaluateExpression(expression.ast, z, constants);
        const magnitude = cAbs(result.value);
        if (magnitude < tolerance) {
          converged = true;
          break;
        }
        const derivativeMagnitude = cAbs(result.derivative);
        if (!Number.isFinite(derivativeMagnitude) || derivativeMagnitude < 1e-10) break;
        const step = cDiv(result.value, result.derivative);
        if (!isFiniteComplex(step)) break;
        z = cSub(z, step);
        if (!isFiniteComplex(z) || cAbs(z) > 1e8) break;
        if (cAbs(step) < tolerance * 0.1) {
          converged = cAbs(evaluateExpression(expression.ast, z, constants).value) < tolerance * 8;
          break;
        }
      }

      if (converged && isFiniteComplex(z)) addRoot(roots, z, tolerance * 4);
    }
  }

  roots.sort((a, b) => Math.atan2(a[1], a[0]) - Math.atan2(b[1], b[0]) || a[0] - b[0]);
  return roots.slice(0, MAX_ROOTS).map((root, index) => ({ re: root[0], im: root[1], index }));
}

export { MAX_ROOTS };
