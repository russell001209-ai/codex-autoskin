import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [renderer, css, spec, windowsLauncher, windowsWatcher, windowsInstaller, windowsQuickstart] = await Promise.all([
  readFile(new URL("../assets/renderer-inject.js", import.meta.url), "utf8"),
  readFile(new URL("../styles/dream/style.css", import.meta.url), "utf8"),
  readFile(new URL("../THEME-SPEC.md", import.meta.url), "utf8"),
  readFile(new URL("../scripts/start-dream-skin.ps1", import.meta.url), "utf8"),
  readFile(new URL("../scripts/watch-dream-skin.ps1", import.meta.url), "utf8"),
  readFile(new URL("../scripts/install-dream-skin.ps1", import.meta.url), "utf8"),
  readFile(new URL("../quickstart.ps1", import.meta.url), "utf8"),
]);

function parseRules(source) {
  const withoutComments = source.replace(/\/\*[\s\S]*?\*\//g, "");
  return [...withoutComments.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((match) => ({
    selector: match[1].trim(),
    body: match[2],
  }));
}

function splitSelectors(selectorList) {
  const selectors = [];
  let start = 0;
  let depth = 0;
  let quote = "";

  for (let index = 0; index < selectorList.length; index += 1) {
    const character = selectorList[index];
    const previous = selectorList[index - 1];
    if (quote) {
      if (character === quote && previous !== "\\") quote = "";
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === "(" || character === "[") depth += 1;
    if (character === ")" || character === "]") depth -= 1;
    if (character === "," && depth === 0) {
      selectors.push(selectorList.slice(start, index).trim());
      start = index + 1;
    }
  }
  selectors.push(selectorList.slice(start).trim());
  return selectors.filter(Boolean);
}

function declarationNames(body) {
  return [...body.matchAll(/(?:^|;)\s*([\w-]+)\s*:/g)].map((match) => match[1].toLowerCase());
}

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
assert.match(renderer, /version: "3\.1\.0"/);
assert.match(renderer, /startsWith\("dream-route-"\)/, "cleanup must remove route markers");

const workspaceMarker = css.indexOf("v3 daily workspace");
assert.ok(workspaceMarker > 0, "workspace section marker must exist");
const legacyRules = parseRules(css.slice(0, workspaceMarker));
const genericShellTarget = /(?:\bbody\b|aside\.app-shell-left-panel|main\.main-surface|\[role="main"\]|\.composer-surface-chrome|\.ProseMirror|\[data-message-author-role\]|button\[class~="bg-token-foreground"\])/;

for (const rule of legacyRules) {
  for (const selector of splitSelectors(rule.selector)) {
    if (!genericShellTarget.test(selector)) continue;
    const explicitlyHomeOnly = selector.includes("dream-route-home") || selector.includes(".dream-home") || selector.includes(".dream-home-shell");
    assert.ok(explicitlyHomeOnly, `legacy shell selector must be home-scoped: ${selector}`);
  }
}

const workRules = parseRules(css).filter(({ selector }) => /(?:dream-route-work|dream-work-shell|dream-work-header|dream-work-composer)/.test(selector));
assert.ok(workRules.length >= 20, "workspace paint system must remain substantial");

const paintOnlyProperties = new Set([
  "accent-color",
  "backdrop-filter",
  "background",
  "background-color",
  "background-image",
  "border-color",
  "border-top-color",
  "border-right-color",
  "border-bottom-color",
  "border-left-color",
  "border-radius",
  "box-shadow",
  "caret-color",
  "color",
  "filter",
  "mix-blend-mode",
  "opacity",
  "outline-color",
  "scrollbar-color",
  "text-decoration",
  "text-decoration-color",
  "text-shadow",
  "text-underline-offset",
]);

for (const rule of workRules) {
  const selectors = splitSelectors(rule.selector);
  for (const selector of selectors) {
    assert.ok(selector.includes("html.codex-dream-skin.dream-route-work"), `workspace selector must be route-scoped: ${selector}`);
  }
  const ownedChromeRule = selectors.every((selector) => selector.includes("#codex-dream-skin-chrome"));
  for (const property of declarationNames(rule.body)) {
    if (ownedChromeRule) {
      assert.ok(new Set(["display", "opacity"]).has(property), `owned work chrome may only gate visibility; ${property} is unsafe in: ${rule.selector}`);
    } else {
      assert.ok(paintOnlyProperties.has(property), `workspace CSS may only paint; ${property} is structural in: ${rule.selector}`);
    }
  }
}

assert.match(css, /dream-route-work body::before\s*\{\s*opacity:\s*0\s*!important;/, "work route must suppress the old decorative dot field");
assert.match(css, /dream-route-work #codex-dream-skin-chrome\s*\{\s*opacity:\s*1\s*!important;/, "work route may reveal only the bounded owned actor layer");
assert.match(css, /dream-work-chrome \.dream-theme-actor\[data-active="true"\]\s*\{\s*display:\s*block;/, "only the active actor may become visible");
assert.match(css, /prefers-reduced-motion:\s*reduce[\s\S]*?\.dream-theme-actor\[data-active="true"\]\[data-static="true"\][\s\S]*?display:\s*block\s*!important;/, "reduced motion must keep one static actor without travel");
assert.match(css, /#codex-dream-skin-chrome\s*\{[\s\S]*?pointer-events:\s*none;/, "decorative chrome must never intercept native controls");
assert.doesNotMatch(css, /dream-route-work[^{}]*dream-work-shell::(?:before|after)/, "work route must not create structural art pseudo-layers");
assert.match(css, /dream-route-work :is\(#application-menu,[^{}]+\{[\s\S]*?background-color:\s*#1d1e20/, "native application menu must stay dark and readable");

assert.doesNotMatch(windowsLauncher, /function\s+Stop-CodexCompletely/i);
assert.doesNotMatch(windowsLauncher, /Get-Process\s+ChatGPT[^\r\n]*\|\s*Stop-Process/i);
assert.doesNotMatch(windowsLauncher, /Start-Process\s+-FilePath\s+\$exe/i);
assert.match(windowsLauncher, /CodexDreamSkin\.PackagedApp/);
assert.match(windowsLauncher, /It was left untouched/);
assert.doesNotMatch(windowsWatcher, /-RestartExisting/);
assert.match(windowsWatcher, /leaves it untouched/);
assert.doesNotMatch(windowsInstaller, /-RestartExisting/);
assert.doesNotMatch(windowsQuickstart, /\b-RestartExisting\b/);
assert.match(windowsQuickstart, /文件\s*>\s*退出/);

console.log("workspace theme contract: ok");
