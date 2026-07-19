import { cAbs, cDiv, cSub, complex, isFiniteComplex } from "./complex.js";
import { evaluateExpression } from "./parser.js";
import { basinColor, rgbCss } from "./palettes.js";
import { spanValue } from "./view-scale.js";

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

export function renderCpu(canvas, state, roots) {
  const cssWidth = Math.max(1, canvas.clientWidth);
  const cssHeight = Math.max(1, canvas.clientHeight);
  const pixelRatio = Math.min(window.devicePixelRatio || 1, 1.35);
  const maxWidth = 760;
  const width = Math.max(220, Math.min(Math.floor(cssWidth * pixelRatio), maxWidth));
  const height = Math.max(160, Math.floor(width * cssHeight / cssWidth));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }

  const bounds = boundsForView(state.view, width, height);
  const image = new ImageData(width, height);
  const pixels = image.data;
  const maxIterations = Math.min(state.iterations, 240);
  const rootRadius = Math.max(bounds.spanX, bounds.spanY) * 0.08;
  const start = performance.now();

  for (let pixelY = 0; pixelY < height; pixelY += 1) {
    const worldY = bounds.maxY - (pixelY / Math.max(height - 1, 1)) * bounds.spanY;
    for (let pixelX = 0; pixelX < width; pixelX += 1) {
      const worldX = bounds.minX + (pixelX / Math.max(width - 1, 1)) * bounds.spanX;
      let z = complex(worldX, worldY);
      let converged = false;
      let iterationCount = maxIterations;

      for (let iteration = 0; iteration < maxIterations; iteration += 1) {
        const result = evaluateExpression(state.expression.ast, z, state.constants);
        const magnitude = cAbs(result.value);
        iterationCount = iteration;
        if (magnitude <= state.tolerance) {
          converged = true;
          break;
        }
        if (cAbs(result.derivative) < 1e-8) break;
        const step = cDiv(result.value, result.derivative);
        if (!isFiniteComplex(step)) break;
        z = cSub(z, step);
        if (!isFiniteComplex(z) || cAbs(z) > 1e8) break;
      }

      let rootIndex = -1;
      let nearest = Number.POSITIVE_INFINITY;
      roots.forEach((root, index) => {
        const distance = Math.hypot(z[0] - root.re, z[1] - root.im);
        if (distance < nearest) {
          nearest = distance;
          rootIndex = index;
        }
      });
      const isRootBasin = converged && rootIndex >= 0 && nearest <= rootRadius;
      const rgb = isRootBasin
        ? basinColor(state.paletteIndex, rootIndex, roots.length, iterationCount, maxIterations, true)
        : [
            5 + Math.round(8 * (1 - iterationCount / Math.max(1, maxIterations))),
            9 + Math.round(11 * (1 - iterationCount / Math.max(1, maxIterations))),
            14 + Math.round(13 * (1 - iterationCount / Math.max(1, maxIterations))),
          ];
      const offset = (pixelY * width + pixelX) * 4;
      pixels[offset] = rgb[0];
      pixels[offset + 1] = rgb[1];
      pixels[offset + 2] = rgb[2];
      pixels[offset + 3] = 255;
    }
  }

  canvas.getContext("2d", { alpha: false }).putImageData(image, 0, 0);
  return { width, height, pixelRatio, renderTime: performance.now() - start, iterations: maxIterations };
}

export function clearCpuCanvas(canvas) {
  const context = canvas.getContext("2d", { alpha: false });
  context.fillStyle = "#080b10";
  context.fillRect(0, 0, canvas.width || canvas.clientWidth, canvas.height || canvas.clientHeight);
}

export { rgbCss };
