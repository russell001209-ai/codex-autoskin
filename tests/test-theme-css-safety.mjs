import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { validateExtraCssSafety, validateTokens } from "../scripts/injector.mjs";

const themeName = "actor-safety-fixture";

// Critical patterns from an intentionally unsafe live-theme fixture: native geometry changes,
// descendant wildcards that recolor unknown controls, generated content on a
// native composer, and pointer-events declarations outside AutoSkin's chrome.
const unsafeThemeFixture = `
html.dream-theme-${themeName} aside.app-shell-left-panel {
  position: relative !important;
  padding-top: 13px !important;
  overflow: hidden !important;
  background: linear-gradient(#c33a2e, #8f241f) !important;
}
html.dream-theme-${themeName} main.main-surface.dream-work-shell > header.dream-work-header * {
  color: #fff7dd !important;
}
html.dream-theme-${themeName} main.dream-work-shell [data-message-author-role="assistant"] {
  margin: 9px !important;
  font: 700 14px/1.2 sans-serif !important;
  animation: pop 200ms ease !important;
}
html.dream-theme-${themeName} main.dream-work-shell .composer-surface-chrome::before {
  content: "";
  width: auto;
  height: 4px;
  pointer-events: none;
}
`;

const unsafeThemeErrors = validateExtraCssSafety(unsafeThemeFixture, themeName);
assert.ok(unsafeThemeErrors.length > 0, "unsafe fixture must be rejected");
for (const property of ["position", "padding-top", "overflow", "margin", "font", "animation", "content", "width", "height", "pointer-events"]) {
  assert.ok(unsafeThemeErrors.some((error) => error.includes(`"${property}"`)), `unsafe rejection must identify ${property}`);
}
assert.ok(unsafeThemeErrors.some((error) => error.includes("universal descendant")), "header * must be rejected");

const functionalUniversalFixture = `
html.dream-theme-${themeName} header :is(*) { color: #fff; }
`;
assert.ok(
  validateExtraCssSafety(functionalUniversalFixture, themeName).some((error) => error.includes("universal descendant")),
  "universal descendants hidden in selector functions must be rejected",
);

const paintOnlyFixture = `
html.dream-theme-${themeName} aside.app-shell-left-panel,
html.dream-theme-${themeName} main.main-surface.dream-work-shell > header.dream-work-header {
  color: #3a1814 !important;
  background: linear-gradient(90deg, #fff8dc, #ffd54e) !important;
  border-color: rgba(128, 39, 32, .42) !important;
  border-radius: 8px !important;
  box-shadow: 0 6px 18px rgba(96, 27, 23, .18) !important;
}
@media (max-width: 1180px) {
  html.dream-theme-${themeName} main.dream-work-shell .composer-surface-chrome {
    background-color: rgba(255, 248, 226, .98) !important;
    caret-color: #c6382c !important;
    backdrop-filter: blur(8px) !important;
  }
}
`;
assert.deepEqual(validateExtraCssSafety(paintOnlyFixture, themeName), [], "paint-only native work CSS must pass");

const ownedChromeFixture = `
html.dream-theme-${themeName}.dream-route-work #codex-dream-skin-chrome::before {
  content: "M";
  position: absolute;
  inset: auto 28px 136px auto;
  z-index: 1;
  width: 126px;
  height: 126px;
  transform: rotate(-2deg);
  animation: drift 3s ease-in-out infinite;
  pointer-events: none !important;
}
`;
assert.ok(
  validateExtraCssSafety(ownedChromeFixture, themeName).some((error) => error.includes("actor manifest")),
  "theme CSS must not revive full-shell chrome overlays; moving art uses the bounded actor manifest",
);

const unsafeChromeFixture = `
html.dream-theme-${themeName}.dream-route-work #codex-dream-skin-chrome::after {
  position: absolute;
  inset: 0;
}
`;
assert.ok(
  validateExtraCssSafety(unsafeChromeFixture, themeName).some((error) => error.includes("actor manifest")),
  "every theme-owned chrome pseudo must be rejected",
);

const overriddenChromeFixture = `
html.dream-theme-${themeName}.dream-route-work #codex-dream-skin-chrome {
  pointer-events: none;
  pointer-events: auto;
}
`;
assert.ok(
  validateExtraCssSafety(overriddenChromeFixture, themeName).some((error) => error.includes("actor manifest")),
  "pointer transparency must not bypass the chrome ownership guard",
);

for (const fixture of [
  `html.dream-theme-${themeName} body #codex-dream-skin-chrome { background: #fff; }`,
  `html.dream-theme-${themeName} main + #codex-dream-skin-chrome { background-color: #fff; }`,
  `html.dream-theme-${themeName} body #codex-dream-skin-chrome::before { background: #fff; box-shadow: 0 0 0 9999px #fff; }`,
  `html.dream-theme-${themeName} :is(#codex-dream-skin-chrome) { background: #fff; }`,
]) {
  assert.ok(
    validateExtraCssSafety(fixture, themeName).some((error) => error.includes("actor manifest")),
    `chrome ID must be rejected through every ancestor/combinator form: ${fixture}`,
  );
}

for (const [property, value] of [
  ["opacity", ".2"],
  ["filter", "brightness(0)"],
  ["mix-blend-mode", "screen"],
  ["fill-opacity", "0"],
  ["stroke-opacity", "0"],
  ["-webkit-text-fill-color", "transparent"],
]) {
  const fixture = `html.dream-theme-${themeName} main.dream-work-shell { ${property}: ${value}; }`;
  assert.ok(
    validateExtraCssSafety(fixture, themeName).some((error) => error.includes(`"${property}"`)),
    `native ${property} must be mechanically rejected`,
  );
}

for (const value of ["transparent", "rgba(0,0,0,0)", "rgb(0 0 0 / 0)", "#0000", "#11223300", "color-mix(in srgb, #fff 0%, transparent)"]) {
  const fixture = `html.dream-theme-${themeName} main.dream-work-shell { color: ${value}; }`;
  assert.ok(
    validateExtraCssSafety(fixture, themeName).some((error) => error.includes("may not be transparent")),
    `transparent native foreground ${value} must be rejected`,
  );
}

// Preserve the documented fullscreen-home composition escape hatch. The work
// surface restriction must not silently break THEME-SPEC section 5.
const homeCompositionFixture = `
html.dream-theme-${themeName}.dream-layout-fullscreen .dream-home > div:first-child::before {
  content: "";
  position: absolute;
  inset: -34px;
  width: auto;
  z-index: 0;
  pointer-events: none;
}
`;
assert.deepEqual(validateExtraCssSafety(homeCompositionFixture, themeName), [], "documented home composition must remain compatible");

const negatedHomeBypassFixture = `
html.dream-theme-${themeName} :not(.dream-home.foo) main.dream-work-shell {
  position: fixed;
}
`;
assert.ok(
  validateExtraCssSafety(negatedHomeBypassFixture, themeName).some((error) => error.includes('"position"')),
  ":not(.dream-home) must not bypass the native geometry guard",
);

for (const fixture of [
  `html.dream-theme-${themeName}-evil .dream-home { position: fixed; inset: 0; pointer-events: auto; }`,
  `html.foo:not(.dream-theme-${themeName}) .dream-home { position: fixed; inset: 0; pointer-events: auto; }`,
  `html.foo:is(.dream-theme-${themeName}) .dream-home { position: fixed; inset: 0; pointer-events: auto; }`,
]) {
  const errors = validateExtraCssSafety(fixture, themeName);
  assert.ok(errors.some((error) => error.includes("selector not scoped")), `theme scope must be an exact positive first-compound class: ${fixture}`);
}

const publicThemePaths = [
  new URL("../themes/aurora-veil/theme.json", import.meta.url),
  new URL("../themes/ember-bloom/theme.json", import.meta.url),
];
for (const themePath of publicThemePaths) {
  const theme = JSON.parse(await readFile(themePath, "utf8"));
  assert.deepEqual(validateTokens(theme.name, theme.tokens).errors, [], `${theme.name} public tokens must remain compatible`);
}

const baseTokens = JSON.parse(await readFile(publicThemePaths[0], "utf8")).tokens;
for (const [key, value] of [
  ["--dream-ink", "transparent"],
  ["--dream-hero-title-color", "rgba(0,0,0,0)"],
  ["--dream-work-text", "#0000"],
  ["--dream-work-code-text", "#11223300"],
]) {
  const errors = validateTokens("visibility-test", { ...baseTokens, [key]: value }).errors;
  assert.ok(errors.some((error) => error.includes(key) && error.includes("transparent")), `${key} must remain visible`);
}
for (const allowed of ["0", ".10", "0.14", ".1400"]) {
  assert.deepEqual(
    validateTokens("opacity-test", { ...baseTokens, "--dream-chat-art-opacity": allowed }).errors,
    [],
    `${allowed} must be accepted`,
  );
}
for (const rejected of [".14001", ".96", "-0.01", "14%", "calc(.1)"]) {
  const errors = validateTokens("opacity-test", { ...baseTokens, "--dream-chat-art-opacity": rejected }).errors;
  assert.ok(errors.some((error) => error.includes("0 to 0.14")), `${rejected} must be rejected`);
}

console.log("theme CSS safety contract: ok");
