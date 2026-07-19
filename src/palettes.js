export const PALETTES = [
  { id: "viridis", name: "Viridis", colors: ["#440154", "#3b528b", "#21918c", "#5ec962", "#fde725"] },
  { id: "plasma", name: "Plasma", colors: ["#0d0887", "#7e03a8", "#cc4778", "#f89540", "#f0f921"] },
  { id: "magma", name: "Magma", colors: ["#000004", "#3b0f70", "#8c2981", "#de4968", "#fcfdbf"] },
  { id: "inferno", name: "Inferno", colors: ["#000004", "#420a68", "#932667", "#dd513a", "#fcffa4"] },
  { id: "cividis", name: "Cividis", colors: ["#00204c", "#304c6c", "#7d7c78", "#c9a84f", "#fee838"] },
  { id: "turbo", name: "Turbo", colors: ["#30123b", "#466be3", "#1bcfd4", "#a8ec32", "#f8e621", "#b51f1d"] },
  { id: "rainbow", name: "Rainbow", colors: ["#6e40aa", "#1fa187", "#a0da39", "#f7e225", "#f1605d", "#9e0142"] },
  { id: "jet", name: "Jet", colors: ["#00007f", "#007fff", "#7fff7f", "#ff7f00", "#7f0000"] },
  { id: "coolwarm", name: "Coolwarm", colors: ["#3b4cc0", "#8db0fe", "#dddcdc", "#f4987a", "#b40426"] },
  { id: "spectral", name: "Spectral", colors: ["#3288bd", "#99d594", "#e6f598", "#fee08b", "#fc8d59", "#d53e4f"] },
];

function hexToRgb(hex) {
  return [
    Number.parseInt(hex.slice(1, 3), 16),
    Number.parseInt(hex.slice(3, 5), 16),
    Number.parseInt(hex.slice(5, 7), 16),
  ];
}

function mix(a, b, amount) {
  return a.map((channel, index) => channel + (b[index] - channel) * amount);
}

export function samplePalette(paletteIndex, position) {
  const palette = PALETTES[((paletteIndex % PALETTES.length) + PALETTES.length) % PALETTES.length];
  const colors = palette.colors.map(hexToRgb);
  const normalized = Math.min(1, Math.max(0, position));
  const scaled = normalized * (colors.length - 1);
  const start = Math.min(colors.length - 2, Math.floor(scaled));
  const amount = scaled - start;
  return mix(colors[start], colors[start + 1], amount);
}

export function basinColor(paletteIndex, rootIndex, rootCount, iterations, maxIterations, converged) {
  const position = rootCount > 1 ? rootIndex / (rootCount - 1) : 0.55;
  const base = samplePalette(paletteIndex, 0.08 + position * 0.84);
  const progress = Math.min(1, iterations / Math.max(1, maxIterations));
  const intensity = converged ? 0.56 + (1 - progress) * 0.46 : 0.08 + (1 - progress) * 0.12;
  return base.map((channel) => Math.round(channel * intensity));
}

export function rgbCss(rgb, alpha = 1) {
  return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha})`;
}
