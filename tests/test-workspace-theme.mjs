import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [renderer, css, spec, windowsLauncher, windowsWatcher, windowsInstaller] = await Promise.all([
  readFile(new URL("../assets/renderer-inject.js", import.meta.url), "utf8"),
  readFile(new URL("../styles/dream/style.css", import.meta.url), "utf8"),
  readFile(new URL("../THEME-SPEC.md", import.meta.url), "utf8"),
  readFile(new URL("../scripts/start-dream-skin.ps1", import.meta.url), "utf8"),
  readFile(new URL("../scripts/watch-dream-skin.ps1", import.meta.url), "utf8"),
  readFile(new URL("../scripts/install-dream-skin.ps1", import.meta.url), "utf8"),
]);

for (const marker of ["dream-route-work", "dream-work-shell", "dream-work-header", "dream-work-composer"]) {
  assert.ok(renderer.includes(marker), `renderer must maintain ${marker}`);
}

for (const token of [
  "--dream-work-color-scheme",
  "--dream-work-bg",
  "--dream-work-sidebar",
  "--dream-work-surface-1",
  "--dream-work-text",
  "--dream-work-accent-warm",
  "--dream-work-user-bg",
  "--dream-work-code-bg",
  "--dream-work-art-wash",
]) {
  assert.ok(css.includes(token), `structure CSS must consume ${token}`);
  assert.ok(spec.includes(token), `THEME-SPEC must document ${token}`);
}

assert.match(css, /main\.main-surface\.dream-work-shell/);
assert.match(css, /\[data-message-author-role="user"\]/);
assert.match(css, /article pre/);
assert.match(css, /composer-surface-chrome:focus-within/);
assert.match(renderer, /version: "3\.0\.0"/);
assert.match(renderer, /startsWith\("dream-route-"\)/, "cleanup must remove route markers");
assert.match(css, /dream-route-work body::before\s*\{\s*opacity: 0;/, "work route must suppress the old decorative dot field");

assert.doesNotMatch(windowsLauncher, /function\s+Stop-CodexCompletely/i);
assert.doesNotMatch(windowsLauncher, /Get-Process\s+ChatGPT[^\r\n]*\|\s*Stop-Process/i);
assert.doesNotMatch(windowsLauncher, /Start-Process\s+-FilePath\s+\$exe/i);
assert.match(windowsLauncher, /CodexDreamSkin\.PackagedApp/);
assert.match(windowsLauncher, /It was left untouched/);
assert.doesNotMatch(windowsWatcher, /-RestartExisting/);
assert.match(windowsWatcher, /leaves it untouched/);
assert.doesNotMatch(windowsInstaller, /-RestartExisting/);

console.log("workspace theme contract: ok");
