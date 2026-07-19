# Luna Newton Lab

## 中文

Luna Newton Lab 是一个可交互探索牛顿分形的 Web 应用。它以 WebGPU fragment shader 为主渲染路径，在不支持 WebGPU 或渲染设备丢失时自动切换到低分辨率 CPU 预览，并把降级原因明确显示在界面中。

### 功能

- 表达式只在点击 `Apply` 后生效；语法错误不会替换当前已应用表达式。
- 自动识别 `x`、`y`、`z`。多个变量会被视为同一个复数变量，并在 Apply 时弹出确认警告。
- 自动生成用户常量滑块。支持自定义最小值、最大值和实时拖动更新。
- 支持 `+ - * / ^`、隐式乘法，以及 `sin`、`cos`、`tan`、`ln`、`log`、`exp`、`sqrt`、`abs`、`pi`、`e` 和 `π`。
- 根位置叠加、原点轴、边界轴和网格线可以独立组合。
- 鼠标滚轮、按钮缩放和平移；视图范围使用数值保护，最小缩放跨度为 `1e-12`。
- 十种调色板：Viridis、Plasma、Magma、Inferno、Cividis、Turbo、Rainbow、Jet、Coolwarm、Spectral。
- 设置面板可折叠、拖拽移动并调整透明度。

### 本地运行

项目不依赖第三方运行时包。Node 20 或更新版本即可：

```bash
npm test
npm run build
npm run dev
```

然后打开 <http://127.0.0.1:4173>。直接双击 `index.html` 也能看到界面，但 WebGPU 和模块加载应通过本地 HTTP 服务测试。

如果界面显示 `CPU PREVIEW`，请在 Edge 打开 `edge://settings/system`，开启“可用时使用图形加速”，重启 Edge，再检查 `edge://gpu` 的 Graphics Feature Status。应用会在没有适配器时保留 CPU 预览，不会阻止使用。

### GitHub Pages

仓库包含 `.github/workflows/deploy-pages.yml`。将默认分支推送到 GitHub 后，在仓库设置中把 Pages 的 Source 设为 `GitHub Actions`，后续每次推送到 `main` 都会执行 `npm run build` 并部署 `dist`。

### Edge / Chrome DevTools 验证

完整检查清单位于 [`docs/DEVTOOLS-CHECKLIST.md`](./docs/DEVTOOLS-CHECKLIST.md)。建议使用最新版 Edge 或 Chrome，在 DevTools 的 Console、Performance、Memory 和 Application 面板分别验证表达式错误、渲染帧耗时、反复缩放后的内存稳定性和静态资源加载。

### Prompt 与 luna 模型说明

本项目使用 luna 模型根据下面的项目提示词生成初版结构，并经过本地构建、解析器单元测试和浏览器交互检查整理为可部署的静态应用：

> 构建一个交互式牛顿分形可视化网站。使用 WebGPU 进行硬件加速，提供可编辑数学表达式，只有点击 Apply 后才应用新表达式；自动识别 x、y、z 为同一复变量，识别字母常量并实时生成可自定义范围的滑块；支持常见复数函数、合法性校验、根位置叠加、三组独立坐标轴、平移缩放、十种高区分度调色板、可折叠透明可拖拽设置面板、WebGPU 兼容性提示、GitHub Pages 部署和中英文文档。请优先保证运行时无大型依赖、交互状态边界清晰、渲染失败有可理解的回退路径，并提供完整测试说明。

## English

Luna Newton Lab is an interactive Newton fractal laboratory. Its primary renderer is a WebGPU fragment shader. When WebGPU is unavailable or the device is lost, the application switches to a lower-resolution CPU preview and explains the limitation in the UI.

### Features

- Expressions are committed only with `Apply`; invalid input leaves the last valid render untouched.
- `x`, `y`, and `z` are detected automatically. Multiple variables are treated as one complex variable and require a warning confirmation on Apply.
- User constants receive live sliders with editable minimum and maximum bounds.
- Supports `+ - * / ^`, implicit multiplication, `sin`, `cos`, `tan`, `ln`, `log`, `exp`, `sqrt`, `abs`, `pi`, `e`, and `π`.
- Root positions, origin axes, frame axes, and grid lines are independent overlay layers.
- Mouse-wheel zoom, button zoom, and panning with a protected near-infinite range down to `1e-12`.
- Ten palettes: Viridis, Plasma, Magma, Inferno, Cividis, Turbo, Rainbow, Jet, Coolwarm, and Spectral.
- The control deck can be collapsed, dragged, and made transparent.

### Local development

The project has no runtime dependency installation step. Node 20 or newer is enough:

```bash
npm test
npm run build
npm run dev
```

Open <http://127.0.0.1:4173>. Use the local HTTP server when testing module loading and WebGPU behavior.

If the UI shows `CPU PREVIEW`, open `edge://settings/system`, enable “Use graphics acceleration when available”, restart Edge, and inspect Graphics Feature Status at `edge://gpu`. The app keeps a CPU preview available when no adapter can be returned.

### GitHub Pages

`.github/workflows/deploy-pages.yml` builds the static `dist` directory and deploys it with the official Pages actions. Set the repository Pages source to `GitHub Actions`, then push to `main`.

### Edge / Chrome DevTools validation

The full manual checklist is in [`docs/DEVTOOLS-CHECKLIST.md`](./docs/DEVTOOLS-CHECKLIST.md). Use a current Edge or Chrome build and inspect Console, Performance, Memory, and Application while testing invalid expressions, frame timing, repeated zooming, and static asset loading.

### Prompt and luna model note

The initial structure was generated with the luna model from this project prompt, then refined through local builds, parser tests, and browser interaction checks:

> Build an interactive Newton fractal visualization website. Use WebGPU hardware acceleration, provide an editable mathematical expression that commits only after Apply, detect x/y/z as one complex variable, generate live custom-range sliders for letter constants, support common complex functions, validation, root overlays, three independent axis layers, pan and zoom, ten high-contrast palettes, a collapsible translucent draggable settings deck, WebGPU compatibility messaging, GitHub Pages deployment, bilingual documentation, and complete testing guidance. Prefer a dependency-light runtime, explicit state boundaries, understandable render fallbacks, and testable interactions.
