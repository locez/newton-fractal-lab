import { MAX_ROOTS } from "./root-finder.js";
import { toWgsl } from "./parser.js";

const MAX_CONSTANTS = 32;
const UNIFORM_FLOATS = 140;

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
  constants: array<vec4<f32>, 8>,
  roots: array<vec4<f32>, ${MAX_ROOTS}>,
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
  let denominator = max(dot(b, b), 1e-30);
  return vec2<f32>((a.x * b.x + a.y * b.y) / denominator, (a.y * b.x - a.x * b.y) / denominator);
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

  for (var iteration = 0u; iteration < 512u; iteration = iteration + 1u) {
    if (f32(iteration) >= uniforms.viewport.z) { break; }
    let value = evaluate_value(z);
    let magnitude = length(value);
    iterations = f32(iteration);
    if (magnitude <= uniforms.viewport.w) {
      converged = true;
      break;
    }
    let derivative = evaluate_derivative(z);
    if (length(derivative) < 1e-7) { break; }
    let step = c_div(value, derivative);
    let next = z - step;
    if (!(length(next) <= 1e8)) { break; }
    z = next;
  }

  var rootIndex = -1;
  var nearest = 1e20;
  for (var root = 0u; root < ${MAX_ROOTS}u; root = root + 1u) {
    if (f32(root) >= uniforms.render.y) { break; }
    let distance = length(z - uniforms.roots[root].xy);
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

function boundsForView(view, width, height) {
  const spanX = Math.max(view.span, 1e-18);
  const spanY = spanX * Math.max(1, height / Math.max(width, 1));
  return [
    view.centerX - spanX * 0.5,
    view.centerY - spanY * 0.5,
    view.centerX + spanX * 0.5,
    view.centerY + spanY * 0.5,
  ];
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
    this.expression = null;
    this.constantNames = [];
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

  render(state, roots) {
    if (!this.ready || !this.pipeline || !this.bindGroup) return null;
    const { width, height } = this.resize();
    const bounds = boundsForView(state.view, width, height);
    const uniforms = new Float32Array(UNIFORM_FLOATS);
    uniforms.set(bounds, 0);
    uniforms.set([width, height, state.iterations, state.tolerance], 4);
    uniforms.set([state.paletteIndex, roots.length, 0, 0], 8);
    this.constantNames.forEach((name, index) => {
      uniforms[12 + index] = Number(state.constants[name]) || 0;
    });
    const rootsOffset = 44;
    roots.forEach((root, index) => {
      uniforms[rootsOffset + index * 4] = root.re;
      uniforms[rootsOffset + index * 4 + 1] = root.im;
    });
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
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, this.bindGroup);
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

export { MAX_CONSTANTS, buildShader };
