# Edge DevTools Verification Checklist

Use a current Microsoft Edge build over `http://127.0.0.1:4173` after `npm run dev`. The same checklist also applies to Chrome DevTools.

## Functional matrix

- [ ] Console is free of uncaught errors on first load; engine status becomes `WEBGPU ACTIVE` or the CPU fallback notice is visible.
- [ ] Apply `z^3 - 1`, then edit the input without clicking Apply; the displayed fractal and `APPLIED` expression remain unchanged.
- [ ] Apply `z^3 - mystery`; a clear parser error appears and the previous fractal remains visible.
- [ ] Apply `sin(z`; the missing-parenthesis error appears and rendering does not update.
- [ ] Apply `x^2 + y`; the multiple-variable confirmation appears, and accepting it reports that the variables share one complex coordinate.
- [ ] Apply `z^3 - a`; the `a` slider and numeric value appear.
- [ ] Drag `a`; the fractal updates without pressing Apply. Change the custom minimum and maximum and confirm the slider clamps to the new range.
- [ ] Toggle origin axes, frame axes, grid lines, and root positions independently and in combinations.
- [ ] Switch through all ten palettes; colors and root markers update.
- [ ] Use wheel zoom at the center and off-center; the cursor location stays anchored. Use `+`, `-`, and Reset.
- [ ] Drag the canvas to pan; coordinate readouts and tick labels update.
- [ ] Collapse and restore the control deck, drag its header, and change panel opacity.

## DevTools panels

### Console

- [ ] Check that malformed input only produces the user-facing error state and no uncaught exception.
- [ ] In a browser with WebGPU disabled, confirm the fallback message recommends a current Chrome/Edge build or lower iterations.

### Performance

- [ ] Record a 5-second trace while zooming and moving a constant slider. Confirm frames continue to render and there is no growing long-task loop.
- [ ] Increase iterations to 512, resize the window, and confirm the interface remains usable. The app surfaces a GPU load notice when repeated render submissions exceed the threshold.

### Memory

- [ ] Take a baseline heap snapshot, apply several expressions, and zoom repeatedly. Take a second snapshot and check that detached canvases or unbounded event listeners do not accumulate.

### Application

- [ ] Reload from the local server and verify `index.html`, `styles.css`, and `src/main.js` load with status 200.
- [ ] Run `npm run build` and verify the generated `dist/.nojekyll` file and static `dist/src` modules exist.

## Recorded Edge run

- Edge `149.0.4022.69` was driven through the DevTools Protocol against the local server.
- The interaction matrix passed for Apply gating, invalid input, multi-variable warning, live constant updates, all overlays, palette switching, zoom, and panel dragging.
- The headless container exposed `navigator.gpu` but had no compatible adapter, so the CPU fallback path was exercised. A physical WebGPU adapter is still required to measure the hardware renderer itself.
- When Edge returns no adapter, verify `edge://settings/system` has graphics acceleration enabled and review `edge://gpu` before treating the result as an application error.

## WebGPU fallback test

In Edge, open `edge://flags`, temporarily disable WebGPU if the build exposes that flag, relaunch, and reload the app. The CPU preview should be visible and the warning should be dismissible. Restore the flag after testing.
