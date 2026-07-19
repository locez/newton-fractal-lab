import { PALETTES, rgbCss, samplePalette } from "./palettes.js";
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

function niceStep(span) {
  const raw = span / 7;
  if (!(raw > 0)) return Number.MIN_VALUE;
  const exponent = Math.floor(Math.log10(raw));
  const magnitude = 10 ** exponent;
  if (!(magnitude > 0) || !Number.isFinite(magnitude)) return Number.MIN_VALUE;
  const normalized = raw / magnitude;
  const factor = normalized < 1.5 ? 1 : normalized < 3.5 ? 2 : normalized < 7.5 ? 5 : 10;
  return Math.max(factor * magnitude, Number.MIN_VALUE);
}

function formatTick(value, step) {
  if (value === 0) return "0";
  const magnitude = Math.abs(value);
  if (magnitude >= 1000 || magnitude < 0.001) return value.toExponential(2).replace("e+", "e");
  const stepMagnitude = Math.abs(step);
  const decimalPlaces = stepMagnitude > 0
    ? Math.max(0, Math.min(8, -Math.floor(Math.log10(stepMagnitude))))
    : 3;
  return value.toFixed(decimalPlaces).replace(/0+$/, "").replace(/\.$/, "");
}

function forEachTick(minimum, maximum, step, callback) {
  if (!(step > 0)) return;
  const first = Math.ceil(minimum / step - 1e-10);
  const last = Math.floor(maximum / step + 1e-10);
  for (let index = first, count = 0; index <= last && count < 100; index += 1, count += 1) {
    callback(index * step);
  }
}

function drawGrid(context, bounds, width, height, step) {
  context.lineWidth = 1;
  context.strokeStyle = "rgba(178, 216, 204, 0.10)";
  context.fillStyle = "rgba(178, 216, 204, 0.42)";
  context.font = "9px 'DM Mono', monospace";
  context.textBaseline = "top";

  forEachTick(bounds.minX, bounds.maxX, step, (value) => {
    const x = ((value - bounds.minX) / bounds.spanX) * width;
    context.beginPath();
    context.moveTo(x, 0);
    context.lineTo(x, height);
    context.stroke();
    if (Math.abs(value) > step * 0.1) context.fillText(formatTick(value, step), x + 4, 7);
  });
  forEachTick(bounds.minY, bounds.maxY, step, (value) => {
    const y = ((bounds.maxY - value) / bounds.spanY) * height;
    context.beginPath();
    context.moveTo(0, y);
    context.lineTo(width, y);
    context.stroke();
    if (Math.abs(value) > step * 0.1) context.fillText(formatTick(value, step), 7, y + 4);
  });
}

function drawOriginAxes(context, bounds, width, height, step) {
  const xAtZero = ((0 - bounds.minX) / bounds.spanX) * width;
  const yAtZero = ((bounds.maxY - 0) / bounds.spanY) * height;
  context.lineWidth = 1.1;
  context.strokeStyle = "rgba(184, 246, 211, 0.68)";
  context.fillStyle = "rgba(184, 246, 211, 0.74)";
  context.font = "9px 'DM Mono', monospace";

  if (xAtZero >= 0 && xAtZero <= width) {
    context.beginPath();
    context.moveTo(xAtZero, 0);
    context.lineTo(xAtZero, height);
    context.stroke();
    forEachTick(bounds.minY, bounds.maxY, step, (value) => {
      const y = ((bounds.maxY - value) / bounds.spanY) * height;
      context.beginPath();
      context.moveTo(xAtZero - 3, y);
      context.lineTo(xAtZero + 3, y);
      context.stroke();
      if (Math.abs(value) > step * 0.1) context.fillText(formatTick(value, step), xAtZero + 7, y + 3);
    });
  }

  if (yAtZero >= 0 && yAtZero <= height) {
    context.beginPath();
    context.moveTo(0, yAtZero);
    context.lineTo(width, yAtZero);
    context.stroke();
    context.textBaseline = "bottom";
    forEachTick(bounds.minX, bounds.maxX, step, (value) => {
      const x = ((value - bounds.minX) / bounds.spanX) * width;
      context.beginPath();
      context.moveTo(x, yAtZero - 3);
      context.lineTo(x, yAtZero + 3);
      context.stroke();
      if (Math.abs(value) > step * 0.1) context.fillText(formatTick(value, step), x + 4, yAtZero - 6);
    });
  }
}

function drawFrameAxes(context, width, height) {
  const inset = 15;
  context.lineWidth = 1;
  context.strokeStyle = "rgba(184, 246, 211, 0.31)";
  context.strokeRect(inset, inset, width - inset * 2, height - inset * 2);
  context.fillStyle = "rgba(184, 246, 211, 0.55)";
  context.font = "9px 'DM Mono', monospace";
  context.fillText("RE", inset + 8, inset + 13);
  context.fillText("IM", width - inset - 21, height - inset - 7);
}

function drawRoots(context, roots, bounds, width, height, paletteIndex) {
  const palette = PALETTES[paletteIndex];
  context.font = "9px 'DM Mono', monospace";
  context.textBaseline = "middle";
  roots.forEach((root, index) => {
    const x = ((root.re - bounds.minX) / bounds.spanX) * width;
    const y = ((bounds.maxY - root.im) / bounds.spanY) * height;
    if (x < -30 || x > width + 30 || y < -30 || y > height + 30) return;
    const color = rgbCss(samplePalette(paletteIndex, 0.08 + (index / Math.max(roots.length - 1, 1)) * 0.84));
    context.strokeStyle = color;
    context.fillStyle = "rgba(7, 12, 15, 0.86)";
    context.lineWidth = 1.2;
    context.beginPath();
    context.arc(x, y, 6, 0, Math.PI * 2);
    context.fill();
    context.stroke();
    context.beginPath();
    context.moveTo(x - 10, y);
    context.lineTo(x + 10, y);
    context.moveTo(x, y - 10);
    context.lineTo(x, y + 10);
    context.stroke();
    context.fillStyle = color;
    context.fillText(`r${index + 1}`, x + 10, y - 9);
  });
}

export function drawOverlay(canvas, state, roots) {
  const width = Math.max(1, canvas.clientWidth);
  const height = Math.max(1, canvas.clientHeight);
  const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
  const pixelWidth = Math.max(1, Math.floor(width * pixelRatio));
  const pixelHeight = Math.max(1, Math.floor(height * pixelRatio));
  if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
    canvas.width = pixelWidth;
    canvas.height = pixelHeight;
  }
  const context = canvas.getContext("2d");
  context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  context.clearRect(0, 0, width, height);
  const bounds = boundsForView(state.view, width, height);
  const step = niceStep(Math.max(bounds.spanX, bounds.spanY));

  if (state.overlays.grid) drawGrid(context, bounds, width, height, step);
  if (state.overlays.axes) drawOriginAxes(context, bounds, width, height, step);
  if (state.overlays.border) drawFrameAxes(context, width, height);
  if (state.overlays.roots) drawRoots(context, roots, bounds, width, height, state.paletteIndex);

  if (state.cursor) {
    const x = state.cursor.x;
    const y = state.cursor.y;
    context.strokeStyle = "rgba(238, 244, 241, 0.22)";
    context.lineWidth = 1;
    context.setLineDash([3, 4]);
    context.beginPath();
    context.moveTo(x, 0);
    context.lineTo(x, height);
    context.moveTo(0, y);
    context.lineTo(width, y);
    context.stroke();
    context.setLineDash([]);
  }
}

export function screenToWorld(view, x, y, width, height) {
  const bounds = boundsForView(view, width, height);
  return {
    re: bounds.minX + (x / Math.max(width, 1)) * bounds.spanX,
    im: bounds.maxY - (y / Math.max(height, 1)) * bounds.spanY,
  };
}

export function formatComplexPoint(point) {
  const format = (value) => {
    if (value === 0) return "0";
    const magnitude = Math.abs(value);
    if (magnitude >= 1000 || magnitude < 0.001) return value.toExponential(4).replace("e+", "e");
    return value.toFixed(4);
  };
  return `${format(point.re)} ${point.im >= 0 ? "+" : "-"} ${format(Math.abs(point.im))}i`;
}

export { formatTick };
