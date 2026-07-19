import { parseExpression, ExpressionError } from "./parser.js";
import { GpuRenderer, MAX_CONSTANTS } from "./gpu-renderer.js";
import { renderCpu, clearCpuCanvas } from "./cpu-renderer.js";
import { findRoots } from "./root-finder.js";
import { PALETTES } from "./palettes.js";
import { drawOverlay, formatComplexPoint } from "./overlay.js";
import { needsPrecisionDetail } from "./view-precision.js";
import { setSpanLog2, spanLog2, spanValue } from "./view-scale.js";
import { addCenterDelta, centerApprox, setCenter } from "./view-center.js";

const fractalCanvas = document.querySelector("#fractal-canvas");
const cpuCanvas = document.querySelector("#cpu-canvas");
const overlayCanvas = document.querySelector("#overlay-canvas");
const panel = document.querySelector("#control-panel");
const panelHeader = document.querySelector("#panel-header");
const panelBody = document.querySelector("#panel-body");
const expressionInput = document.querySelector("#expression-input");
const applyButton = document.querySelector("#apply-expression");
const expressionState = document.querySelector("#expression-state");
const expressionSummary = document.querySelector("#expression-summary");
const variableSummary = document.querySelector("#variable-summary");
const expressionError = document.querySelector("#expression-error");
const constantsList = document.querySelector("#constants-list");
const constantsEmpty = document.querySelector("#constants-empty");
const constantCount = document.querySelector("#constant-count");
const paletteSelect = document.querySelector("#palette-select");
const paletteSwatches = document.querySelector("#palette-swatches");
const rootReadout = document.querySelector("#root-readout");
const iterationRange = document.querySelector("#iteration-range");
const iterationReadout = document.querySelector("#iteration-readout");
const opacityRange = document.querySelector("#opacity-range");
const zoomReadout = document.querySelector("#zoom-readout");
const centerReadout = document.querySelector("#center-readout");
const renderTime = document.querySelector("#render-time");
const engineStatus = document.querySelector("#engine-status");
const supportBanner = document.querySelector("#support-banner");
const supportTitle = document.querySelector("#support-title");
const supportCopy = document.querySelector("#support-copy");
const dismissSupport = document.querySelector("#dismiss-support");
const collapsePanel = document.querySelector("#collapse-panel");
const toast = document.querySelector("#toast");

const initialExpression = parseExpression("z^3 - a");
const state = {
  expression: initialExpression,
  constants: { a: 1 },
  ranges: { a: { min: -2, max: 2, step: 0.01 } },
  view: { centerX: 0, centerY: 0, centerXLow: 0, centerYLow: 0, span: 6, spanLog2: Math.log2(6) },
  initialSpanLog2: Math.log2(6),
  iterations: 160,
  tolerance: 0.0001,
  paletteIndex: 0,
  overlays: { axes: true, border: true, grid: false, roots: true },
  roots: [],
  mode: "starting",
  precisionDetail: false,
  cursor: null,
};

let renderer = null;
let gpuRenderer = null;
let renderQueued = false;
let rootTimer = null;
let toastTimer = null;
let applyInProgress = false;
let supportDismissed = false;
let slowGpuSamples = 0;
let interaction = null;
let panelDrag = null;

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function formatNumber(value) {
  if (Math.abs(value) >= 1000 || (Math.abs(value) > 0 && Math.abs(value) < 0.001)) return value.toExponential(2);
  return Number(value.toFixed(5)).toString();
}

function showToast(message, kind = "info") {
  window.clearTimeout(toastTimer);
  toast.textContent = message;
  toast.classList.toggle("is-error", kind === "error");
  toast.classList.add("is-visible");
  toastTimer = window.setTimeout(() => toast.classList.remove("is-visible"), 3500);
}

function showSupportNotice(title, copy, kind = "fallback") {
  if (supportDismissed) return;
  supportTitle.textContent = title;
  supportCopy.textContent = copy;
  supportBanner.classList.remove("is-hidden");
  engineStatus.classList.toggle("is-fallback", kind === "fallback");
}

function updateEngineStatus(label, mode = state.mode) {
  state.mode = mode;
  engineStatus.textContent = label;
  engineStatus.classList.toggle("is-pending", mode === "starting");
  engineStatus.classList.toggle("is-fallback", mode === "cpu");
}

function viewSize() {
  return { width: Math.max(1, overlayCanvas.clientWidth), height: Math.max(1, overlayCanvas.clientHeight) };
}

function updateViewReadouts() {
  const zoomLog10 = (state.initialSpanLog2 - spanLog2(state.view)) * Math.LOG10E * Math.LN2;
  const percentLog10 = zoomLog10 + 2;
  if (percentLog10 < 6) {
    zoomReadout.textContent = `${Math.round(10 ** percentLog10)}%`;
  } else if (percentLog10 < 12) {
    zoomReadout.textContent = `${(10 ** (percentLog10 - 3)).toPrecision(5)}k%`;
  } else {
    zoomReadout.textContent = `10^${percentLog10.toFixed(1)}%`;
  }
  centerReadout.textContent = formatComplexPoint(centerApprox(state.view));
}

function updatePaletteSwatches() {
  const palette = PALETTES[state.paletteIndex];
  paletteSwatches.innerHTML = "";
  palette.colors.forEach((color) => {
    const swatch = document.createElement("span");
    swatch.style.background = color;
    paletteSwatches.append(swatch);
  });
}

function updateExpressionUi() {
  expressionSummary.textContent = state.expression.source;
  if (state.expression.variables.length === 0) {
    variableSummary.textContent = "variable: none";
  } else if (state.expression.variables.length === 1) {
    variableSummary.textContent = `variable: ${state.expression.variables[0]}`;
  } else {
    variableSummary.textContent = `same variable: ${state.expression.variables.join(", ")}`;
  }
  expressionState.textContent = "APPLIED";
  expressionState.classList.remove("is-error");
  expressionError.classList.add("is-hidden");
}

function defaultRangeFor(name) {
  if (name === "a") return { min: -2, max: 2, step: 0.01 };
  if (name === "b") return { min: -3, max: 3, step: 0.01 };
  return { min: -2, max: 2, step: 0.01 };
}

function defaultValueFor(name) {
  if (name === "a") return 1;
  if (name === "b") return 0.5;
  return 0;
}

function syncConstantsForExpression(names, previousConstants = state.constants, previousRanges = state.ranges) {
  const constants = {};
  const ranges = {};
  names.forEach((name) => {
    const previousRange = previousRanges[name] || defaultRangeFor(name);
    const range = {
      min: Number.isFinite(previousRange.min) ? previousRange.min : -2,
      max: Number.isFinite(previousRange.max) ? previousRange.max : 2,
      step: Number.isFinite(previousRange.step) && previousRange.step > 0 ? previousRange.step : 0.01,
    };
    if (range.max <= range.min) range.max = range.min + 1;
    ranges[name] = range;
    const previousValue = Number(previousConstants[name]);
    constants[name] = Number.isFinite(previousValue)
      ? clamp(previousValue, range.min, range.max)
      : clamp(defaultValueFor(name), range.min, range.max);
  });
  return { constants, ranges };
}

function setConstant(name, value) {
  const range = state.ranges[name];
  const numeric = Number(value);
  if (!range || !Number.isFinite(numeric)) return;
  state.constants[name] = clamp(numeric, range.min, range.max);
  const numberInput = constantsList.querySelector(`[data-number="${name}"]`);
  const slider = constantsList.querySelector(`[data-slider="${name}"]`);
  if (numberInput) numberInput.value = formatNumber(state.constants[name]);
  if (slider) slider.value = String(state.constants[name]);
  scheduleRender();
  scheduleRootRefresh();
}

function updateRange(name, edge, value) {
  const range = state.ranges[name];
  if (!range) return;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return;
  if (edge === "min") range.min = Math.min(numeric, range.max - range.step);
  if (edge === "max") range.max = Math.max(numeric, range.min + range.step);
  state.constants[name] = clamp(state.constants[name], range.min, range.max);
  renderConstantsPanel();
  scheduleRender();
  scheduleRootRefresh();
}

function renderConstantsPanel() {
  const names = state.expression.constants;
  constantsList.innerHTML = "";
  constantsEmpty.classList.toggle("is-hidden", names.length > 0);
  constantCount.textContent = `${String(names.length).padStart(2, "0")} LIVE`;

  names.forEach((name) => {
    const range = state.ranges[name];
    const row = document.createElement("div");
    row.className = "constant-row";
    row.innerHTML = `
      <div class="constant-topline">
        <span class="constant-label"><strong>${name}</strong><small>real constant</small></span>
        <input class="constant-number" data-number="${name}" type="number" step="${range.step}" min="${range.min}" max="${range.max}" value="${state.constants[name]}" aria-label="Value of constant ${name}" />
      </div>
      <div class="constant-range-line">
        <input data-slider="${name}" type="range" min="${range.min}" max="${range.max}" step="${range.step}" value="${state.constants[name]}" aria-label="Slider for constant ${name}" />
        <span class="range-number-label">min</span>
        <input class="range-number" data-min="${name}" type="number" step="${range.step}" value="${range.min}" aria-label="Minimum for constant ${name}" />
        <span class="range-number-label">max</span>
        <input class="range-number" data-max="${name}" type="number" step="${range.step}" value="${range.max}" aria-label="Maximum for constant ${name}" />
      </div>
    `;
    const slider = row.querySelector(`[data-slider="${name}"]`);
    const numberInput = row.querySelector(`[data-number="${name}"]`);
    const minInput = row.querySelector(`[data-min="${name}"]`);
    const maxInput = row.querySelector(`[data-max="${name}"]`);
    slider.addEventListener("input", () => setConstant(name, slider.value));
    numberInput.addEventListener("input", () => setConstant(name, numberInput.value));
    minInput.addEventListener("change", () => updateRange(name, "min", minInput.value));
    maxInput.addEventListener("change", () => updateRange(name, "max", maxInput.value));
    constantsList.append(row);
  });
}

function updateRoots() {
  state.roots = findRoots(state.expression, state.constants, state.view, overlayCanvas.clientWidth, overlayCanvas.clientHeight);
  rootReadout.textContent = `${String(state.roots.length).padStart(2, "0")} ROOTS`;
  drawOverlay(overlayCanvas, state, state.roots);
}

function scheduleRootRefresh() {
  window.clearTimeout(rootTimer);
  rootTimer = window.setTimeout(() => {
    updateRoots();
    scheduleRender();
  }, 130);
}

function renderNow() {
  renderQueued = false;
  let metrics;
  try {
    const wantsPrecisionDetail = renderer === "gpu" && needsPrecisionDetail(state.view, viewSize().width);
    if (wantsPrecisionDetail && !gpuRenderer.detailSupported) {
      switchToCpu("This GPU could not compile the precision detail shader; CPU double precision preview is active.");
    } else if (renderer === "gpu" && wantsPrecisionDetail && !state.precisionDetail) {
      enterGpuDetail();
    } else if (renderer === "gpu" && !wantsPrecisionDetail && state.precisionDetail) {
      leaveGpuDetail();
    }
    const usingGpu = renderer === "gpu";
    metrics = usingGpu
      ? gpuRenderer.render(state, state.roots, state.precisionDetail)
      : renderCpu(cpuCanvas, state, state.roots);
    if (metrics) {
      renderTime.textContent = `${metrics.renderTime.toFixed(1)} ms`;
      if (usingGpu && metrics.renderTime > 50) slowGpuSamples += 1;
      else slowGpuSamples = Math.max(0, slowGpuSamples - 1);
      if (usingGpu && slowGpuSamples >= 5) {
        showSupportNotice("GPU render is under load", "Try fewer iterations or a smaller browser window for smoother interaction.", "warning");
        slowGpuSamples = 0;
      }
    }
  } catch (error) {
    console.error(error);
    if (renderer === "gpu") switchToCpu("WebGPU render failed; CPU preview is active.");
    else showToast("CPU preview could not render this state.", "error");
  }
  drawOverlay(overlayCanvas, state, state.roots);
}

function scheduleRender() {
  if (renderQueued) return;
  renderQueued = true;
  window.requestAnimationFrame(renderNow);
}

function switchToCpu(message) {
  renderer = "cpu";
  state.precisionDetail = false;
  updateEngineStatus("CPU PREVIEW", "cpu");
  fractalCanvas.classList.add("is-hidden");
  cpuCanvas.classList.remove("is-hidden");
  clearCpuCanvas(cpuCanvas);
  if (message) showSupportNotice("WebGPU unavailable", message, "fallback");
  scheduleRender();
}

function enterGpuDetail() {
  state.precisionDetail = true;
  updateEngineStatus("GPU REBASE", "gpu-detail");
  showSupportNotice(
    "GPU reference rebase",
    "Deep zoom is recomputed on the GPU from the current center orbit. Pixels carry local perturbations, then switch to direct GPU Newton steps when needed.",
    "warning",
  );
}

function leaveGpuDetail() {
  state.precisionDetail = false;
  updateEngineStatus("WEBGPU ACTIVE", "gpu");
  if (supportTitle.textContent === "GPU reference rebase") supportBanner.classList.add("is-hidden");
}

async function setGpuExpression(expression, constantNames) {
  if (renderer !== "gpu") return;
  try {
    await gpuRenderer.setExpression(expression, constantNames);
  } catch (error) {
    switchToCpu("This expression could not compile for WebGPU, so a lower-resolution CPU preview is active.");
    throw error;
  }
}

async function applyExpression() {
  if (applyInProgress) return;
  const source = expressionInput.value.trim();
  let candidate;
  try {
    candidate = parseExpression(source);
  } catch (error) {
    const message = error instanceof ExpressionError ? error.message : "The expression could not be parsed.";
    expressionState.textContent = "ERROR";
    expressionState.classList.add("is-error");
    expressionError.textContent = message;
    expressionError.classList.remove("is-hidden");
    showToast(message, "error");
    return;
  }

  if (candidate.variables.length > 1) {
    const accepted = window.confirm(`Multiple variables detected: ${candidate.variables.join(", ")}. They will be treated as one complex variable. Apply this expression?`);
    if (!accepted) return;
  }
  if (renderer === "gpu" && candidate.constants.length > MAX_CONSTANTS) {
    const message = `Use at most ${MAX_CONSTANTS} user constants for the WebGPU renderer.`;
    expressionError.textContent = message;
    expressionError.classList.remove("is-hidden");
    showToast(message, "error");
    return;
  }

  applyInProgress = true;
  applyButton.disabled = true;
  applyButton.textContent = "...";
  const next = syncConstantsForExpression(candidate.constants);
  try {
    await setGpuExpression(candidate, candidate.constants);
    state.expression = candidate;
    state.constants = next.constants;
    state.ranges = next.ranges;
    updateExpressionUi();
    renderConstantsPanel();
    updateRoots();
    scheduleRender();
    showToast(candidate.variables.length > 1 ? "Applied; x, y and z share one complex coordinate." : "Expression applied.");
  } catch (error) {
    const message = error instanceof Error ? error.message : "The expression could not be applied.";
    expressionError.textContent = message;
    expressionError.classList.remove("is-hidden");
    expressionState.textContent = "ERROR";
    expressionState.classList.add("is-error");
    showToast(message, "error");
  } finally {
    applyInProgress = false;
    applyButton.disabled = false;
    applyButton.textContent = "Apply";
  }
}

function applyZoom(factor, anchorX = overlayCanvas.clientWidth * 0.5, anchorY = overlayCanvas.clientHeight * 0.5) {
  const { width, height } = viewSize();
  const aspect = height / Math.max(width, 1);
  const nx = anchorX / width - 0.5;
  const ny = 0.5 - anchorY / height;
  const previousSpan = spanValue(state.view);
  const previousOffsetX = nx * previousSpan;
  const previousOffsetY = ny * previousSpan * aspect;
  setSpanLog2(state.view, spanLog2(state.view) + Math.log2(factor));
  const nextSpan = spanValue(state.view);
  const nextOffsetX = nx * nextSpan;
  const nextOffsetY = ny * nextSpan * aspect;
  addCenterDelta(state.view, previousOffsetX - nextOffsetX, previousOffsetY - nextOffsetY);
  updateViewReadouts();
  drawOverlay(overlayCanvas, state, state.roots);
  scheduleRender();
}

function resetView() {
  setCenter(state.view, 0, 0);
  setSpanLog2(state.view, state.initialSpanLog2);
  updateViewReadouts();
  updateRoots();
  scheduleRender();
}

function bindPanelDragging() {
  panelHeader.addEventListener("pointerdown", (event) => {
    if (event.target.closest("button")) return;
    const rect = panel.getBoundingClientRect();
    panelDrag = { offsetX: event.clientX - rect.left, offsetY: event.clientY - rect.top };
    panelHeader.setPointerCapture(event.pointerId);
  });
  panelHeader.addEventListener("pointermove", (event) => {
    if (!panelDrag) return;
    const width = panel.offsetWidth;
    const height = panel.offsetHeight;
    const left = clamp(event.clientX - panelDrag.offsetX, 8, window.innerWidth - width - 8);
    const top = clamp(event.clientY - panelDrag.offsetY, 8, window.innerHeight - height - 8);
    panel.style.left = `${left}px`;
    panel.style.top = `${top}px`;
  });
  const stopDragging = () => { panelDrag = null; };
  panelHeader.addEventListener("pointerup", stopDragging);
  panelHeader.addEventListener("pointercancel", stopDragging);
}

function bindCanvasInteractions() {
  overlayCanvas.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    interaction = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, moved: false };
    overlayCanvas.setPointerCapture(event.pointerId);
  });
  overlayCanvas.addEventListener("pointermove", (event) => {
    const rect = overlayCanvas.getBoundingClientRect();
    state.cursor = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    if (!interaction || interaction.pointerId !== event.pointerId) {
      drawOverlay(overlayCanvas, state, state.roots);
      return;
    }
    const dx = event.clientX - interaction.x;
    const dy = event.clientY - interaction.y;
    if (Math.abs(dx) + Math.abs(dy) < 1) return;
    interaction.moved = true;
    const { width, height } = viewSize();
    const span = spanValue(state.view);
    const aspect = height / Math.max(width, 1);
    addCenterDelta(state.view, -(dx / width) * span, (dy / height) * span * aspect);
    interaction.x = event.clientX;
    interaction.y = event.clientY;
    updateViewReadouts();
    drawOverlay(overlayCanvas, state, state.roots);
    scheduleRender();
  });
  overlayCanvas.addEventListener("pointerup", (event) => {
    if (interaction?.pointerId === event.pointerId) interaction = null;
  });
  overlayCanvas.addEventListener("pointercancel", () => { interaction = null; });
  overlayCanvas.addEventListener("pointerleave", () => {
    if (!interaction) {
      state.cursor = null;
      drawOverlay(overlayCanvas, state, state.roots);
    }
  });
  overlayCanvas.addEventListener("wheel", (event) => {
    event.preventDefault();
    const rect = overlayCanvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    applyZoom(Math.exp(event.deltaY * 0.001), x, y);
  }, { passive: false });
}

function bindControls() {
  applyButton.addEventListener("click", applyExpression);
  expressionInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") applyExpression();
  });
  document.querySelector("#zoom-in").addEventListener("click", () => applyZoom(0.72));
  document.querySelector("#zoom-out").addEventListener("click", () => applyZoom(1 / 0.72));
  document.querySelector("#reset-view").addEventListener("click", resetView);
  document.querySelector("#toggle-axes").addEventListener("change", (event) => {
    state.overlays.axes = event.target.checked;
    drawOverlay(overlayCanvas, state, state.roots);
  });
  document.querySelector("#toggle-border").addEventListener("change", (event) => {
    state.overlays.border = event.target.checked;
    drawOverlay(overlayCanvas, state, state.roots);
  });
  document.querySelector("#toggle-grid").addEventListener("change", (event) => {
    state.overlays.grid = event.target.checked;
    drawOverlay(overlayCanvas, state, state.roots);
  });
  document.querySelector("#toggle-roots").addEventListener("change", (event) => {
    state.overlays.roots = event.target.checked;
    drawOverlay(overlayCanvas, state, state.roots);
  });
  paletteSelect.addEventListener("change", (event) => {
    state.paletteIndex = Number(event.target.value);
    updatePaletteSwatches();
    drawOverlay(overlayCanvas, state, state.roots);
    scheduleRender();
  });
  iterationRange.addEventListener("input", (event) => {
    state.iterations = Number(event.target.value);
    iterationReadout.textContent = `${state.iterations} ITER`;
    scheduleRender();
  });
  opacityRange.addEventListener("input", (event) => {
    panel.style.setProperty("--panel-alpha", event.target.value);
  });
  collapsePanel.addEventListener("click", () => {
    const collapsed = panel.classList.toggle("is-collapsed");
    collapsePanel.textContent = collapsed ? "+" : "-";
    collapsePanel.setAttribute("aria-label", collapsed ? "Restore controls" : "Minimize controls");
    collapsePanel.setAttribute("title", collapsed ? "Restore controls" : "Minimize controls");
    if (!collapsed) panelBody.scrollTop = 0;
  });
  dismissSupport.addEventListener("click", () => {
    supportDismissed = true;
    supportBanner.classList.add("is-hidden");
  });
  window.addEventListener("resize", () => {
    drawOverlay(overlayCanvas, state, state.roots);
    scheduleRender();
  });
}

async function initRenderer() {
  gpuRenderer = new GpuRenderer(fractalCanvas);
  gpuRenderer.onDeviceLost = () => {
    switchToCpu("The WebGPU device was lost. CPU preview is active; reload after updating your browser or graphics driver.");
  };
  try {
    await gpuRenderer.initialize();
    await gpuRenderer.setExpression(state.expression, state.expression.constants);
    renderer = "gpu";
    updateEngineStatus("WEBGPU ACTIVE", "gpu");
  } catch (error) {
    const message = error?.code === "secure-context"
      ? "WebGPU needs HTTPS or localhost. Open this app through the local server, not as a file."
      : error?.code === "adapter"
        ? "Edge returned no WebGPU adapter. Enable graphics acceleration in edge://settings/system, restart Edge, then inspect edge://gpu."
        : "WebGPU is unavailable or could not compile this expression. Use a current Edge build or lower iterations for smoother CPU preview.";
    switchToCpu(message);
  }
  scheduleRender();
}

function initializeUi() {
  expressionInput.value = state.expression.source;
  updateExpressionUi();
  renderConstantsPanel();
  updatePaletteSwatches();
  updateViewReadouts();
  iterationReadout.textContent = `${state.iterations} ITER`;
  updateRoots();
  bindControls();
  bindPanelDragging();
  bindCanvasInteractions();
}

initializeUi();
initRenderer();
