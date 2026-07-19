import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const output = join(root, "dist");

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await cp(join(root, "index.html"), join(output, "index.html"));
await cp(join(root, "styles.css"), join(output, "styles.css"));
await cp(join(root, "favicon.svg"), join(output, "favicon.svg"));
await cp(join(root, "src"), join(output, "src"), { recursive: true });
await writeFile(join(output, ".nojekyll"), "");

console.log(`Built static site in ${output}`);
