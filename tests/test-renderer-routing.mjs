import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";

const renderer = await readFile(new URL("../assets/renderer-inject.js", import.meta.url), "utf8");

function extractFunction(name) {
  const start = renderer.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `renderer must define ${name} as a testable pure function`);
  const bodyStart = renderer.indexOf("{", start);
  let depth = 0;
  for (let index = bodyStart; index < renderer.length; index += 1) {
    if (renderer[index] === "{") depth += 1;
    if (renderer[index] === "}") depth -= 1;
    if (depth === 0) return renderer.slice(start, index + 1);
  }
  assert.fail(`renderer function ${name} is not balanced`);
}

const context = {};
vm.runInNewContext(
  `${extractFunction("detectRoute")}\n${extractFunction("applyRouteMarkers")}\n` +
  `${extractFunction("getSafeRect")}\n${extractFunction("rectsOverlap")}\n` +
  `${extractFunction("getActorVisualBounds")}\n${extractFunction("getActorSweptBounds")}\n` +
  `${extractFunction("findSafeActorPath")}\n${extractFunction("buildActorKeyframes")}\n${extractFunction("hideChrome")}\n` +
  "globalThis.detectRoute = detectRoute; globalThis.applyRouteMarkers = applyRouteMarkers; " +
  "globalThis.getSafeRect = getSafeRect; globalThis.getActorVisualBounds = getActorVisualBounds; " +
  "globalThis.findSafeActorPath = findSafeActorPath; globalThis.buildActorKeyframes = buildActorKeyframes; " +
  "globalThis.hideChrome = hideChrome;",
  context,
);

function makeShell({ homeCount = 0, message = false, header = false, composer = false } = {}) {
  const homes = Array.from({ length: homeCount }, (_, index) => ({
    id: `home-${index}`,
    querySelector(selector) {
      assert.equal(selector, '[data-testid="home-icon"]');
      return { id: `home-icon-${index}` };
    },
  }));
  const signals = {
    '[data-message-author-role]': message ? { id: "message" } : null,
    "header.app-header-tint": header ? { id: "header" } : null,
    ".composer-surface-chrome": composer ? { id: "composer" } : null,
  };
  return {
    homes,
    matches(selector) {
      assert.equal(selector, '[role="main"]');
      return false;
    },
    querySelectorAll(selector) {
      assert.equal(selector, '[role="main"]');
      return homes;
    },
    querySelector(selector) {
      assert.ok(Object.hasOwn(signals, selector), `unexpected shell selector: ${selector}`);
      return signals[selector];
    },
  };
}

function makeDocument(mains) {
  return {
    querySelectorAll(selector) {
      assert.equal(selector, "main.main-surface");
      return mains;
    },
  };
}

assert.equal(context.detectRoute(makeDocument([])).kind, "unknown", "missing main must fail closed");
assert.equal(
  context.detectRoute(makeDocument([makeShell(), makeShell()])).kind,
  "unknown",
  "multiple main surfaces must fail closed",
);

const homeShell = makeShell({ homeCount: 1 });
const homeRoute = context.detectRoute(makeDocument([homeShell]));
assert.equal(homeRoute.kind, "home");
assert.equal(homeRoute.shellMain, homeShell);
assert.equal(homeRoute.home, homeShell.homes[0]);

const selfHomeShell = makeShell();
const selfHomeQuerySelector = selfHomeShell.querySelector.bind(selfHomeShell);
selfHomeShell.matches = (selector) => {
  assert.equal(selector, '[role="main"]');
  return true;
};
selfHomeShell.querySelector = (selector) => selector === '[data-testid="home-icon"]'
  ? { id: "self-home-icon" }
  : selfHomeQuerySelector(selector);
const selfHomeRoute = context.detectRoute(makeDocument([selfHomeShell]));
assert.equal(selfHomeRoute.kind, "home", "the unique main surface may itself be the home role-main");
assert.equal(selfHomeRoute.home, selfHomeShell);

assert.equal(
  context.detectRoute(makeDocument([makeShell({ homeCount: 2, message: true })])).kind,
  "unknown",
  "ambiguous home candidates must not fall through to work",
);
assert.equal(context.detectRoute(makeDocument([makeShell({ message: true })])).kind, "unknown");
assert.equal(context.detectRoute(makeDocument([makeShell({ message: true, composer: true })])).kind, "work");
assert.equal(context.detectRoute(makeDocument([makeShell({ header: true, composer: true })])).kind, "work");
assert.equal(context.detectRoute(makeDocument([makeShell({ header: true })])).kind, "unknown");
assert.equal(context.detectRoute(makeDocument([makeShell({ composer: true })])).kind, "unknown");
assert.equal(context.detectRoute(makeDocument([makeShell()])).kind, "unknown");

function rectElement(rect, isConnected = true) {
  return { isConnected, getBoundingClientRect: () => rect };
}

const safeRect = context.getSafeRect(
  rectElement({ left: 100, top: 50, width: 900, height: 700 }),
  { innerWidth: 1440, innerHeight: 900 },
);
assert.deepEqual({ ...safeRect }, { left: 100, top: 50, width: 900, height: 700, right: 1000, bottom: 750 });
assert.equal(context.getSafeRect(rectElement({ left: 0, top: 0, width: 0, height: 700 }), { innerWidth: 1440, innerHeight: 900 }), null);
assert.equal(context.getSafeRect(rectElement({ left: 0, top: 0, width: 900, height: 700 }, false), { innerWidth: 1440, innerHeight: 900 }), null);
assert.equal(context.getSafeRect(rectElement({ left: 800, top: 0, width: 900, height: 700 }), { innerWidth: 1440, innerHeight: 900 }), null);
assert.equal(context.getSafeRect(rectElement({ left: Number.NaN, top: 0, width: 900, height: 700 }), { innerWidth: 1440, innerHeight: 900 }), null);

function assertCorridorClear(path, protectedRects, message) {
  assert.ok(path, message);
  for (const rect of protectedRects) {
    const overlap = path.corridor.left < rect.right && path.corridor.right > rect.left &&
      path.corridor.top < rect.bottom && path.corridor.bottom > rect.top;
    assert.equal(overlap, false, `${message}: corridor must avoid protected landmark`);
  }
}

function assertActualActorFramesClear(path, protectedRects, shellWidth, message, behavior = "run", visibleBounds) {
  for (let frame = 0; frame <= 20; frame += 1) {
    const bounds = context.getActorVisualBounds(path, frame / 20, behavior, visibleBounds);
    for (const rect of protectedRects) {
      const overlap = bounds.left < rect.right && bounds.right > rect.left &&
        bounds.top < rect.bottom && bounds.bottom > rect.top;
      assert.equal(overlap, false, `${message}: frame ${frame} body+trail must avoid protected landmark`);
    }
    if (path.side === "right") {
      assert.ok(bounds.right < shellWidth - 22, `${message}: frame ${frame} must stay fully inside the scrollbar reserve`);
    }
  }
}

const clearShell = { width: 1120, height: 760 };
const leftReadingColumnRects = [
  { left: 0, top: 0, right: 1120, bottom: 56 },
  { left: 130, top: 90, right: 790, bottom: 620 },
  { left: 120, top: 642, right: 1000, bottom: 752 },
  { left: 1098, top: 0, right: 1120, bottom: 760 },
];
for (const [preferred, expected] of [[0, "upper-left"], [2, "middle-left"]]) {
  const staticPath = context.findSafeActorPath(clearShell, leftReadingColumnRects, 88, preferred, "peek");
  assertCorridorClear(staticPath, leftReadingColumnRects, `${expected} static pose must keep its own edge perch`);
  assertActualActorFramesClear(staticPath, leftReadingColumnRects, clearShell.width, `${expected} static pose must stay clear of the reading column`, "peek");
  assert.equal(staticPath.entry, expected, `${expected} static pose must not be reassigned to a right-side entrance`);
  assert.ok(staticPath.toX < clearShell.width / 2, `${expected} static pose must stay in its requested left-side region`);
}

const denseMiddleRects = [
  { left: 0, top: 0, right: 1120, bottom: 56 },
  { left: 0, top: 160, right: 560, bottom: 460 },
  { left: 120, top: 642, right: 1000, bottom: 752 },
  { left: 1098, top: 0, right: 1120, bottom: 760 },
];
const displacedMiddleLeft = context.findSafeActorPath(clearShell, denseMiddleRects, 88, 2, "peek");
assertCorridorClear(displacedMiddleLeft, denseMiddleRects, "middle-left pose must search beyond a dense block of visible text");
assertActualActorFramesClear(displacedMiddleLeft, denseMiddleRects, clearShell.width, "displaced middle-left pose must not cover text", "peek");
assert.equal(displacedMiddleLeft.entry, "middle-left", "dense visible text must not reassign the middle-left pose to the right side");

const singleBandRects = [
  { left: 0, top: 0, right: 1120, bottom: 280 },
  { left: 0, top: 500, right: 1120, bottom: 760 },
  { left: 1098, top: 0, right: 1120, bottom: 760 },
];
const reservedPoints = [];
const bandPaths = [0, 1, 2, 3].map((preferred) => {
  const path = context.findSafeActorPath(clearShell, singleBandRects, 88, preferred, "peek", reservedPoints);
  assertCorridorClear(path, singleBandRects, `pose ${preferred} must use the remaining safe band`);
  const point = { x: path.toX + path.size / 2, y: path.y + path.size / 2 };
  for (const previous of reservedPoints) {
    assert.ok(Math.hypot(point.x - previous.x, point.y - previous.y) >= 105.6, "one four-pose cycle must use clearly separated places");
  }
  reservedPoints.push(point);
  return path;
});
assert.equal(new Set(bandPaths.map((path) => `${path.toX}:${path.y}`)).size, 4, "all four poses need distinct coordinates even when only one safe band remains");

const fixedLandmarks = [
  { left: 0, top: 0, right: 1120, bottom: 56 },
  { left: 120, top: 642, right: 1000, bottom: 752 },
  { left: 330, top: 170, right: 790, bottom: 570 },
  { left: 1098, top: 0, right: 1120, bottom: 760 },
];
for (const [preferred, expected] of [[0, "upper-left"], [1, "upper-right"], [2, "middle-left"], [3, "lower-right"]]) {
  const path = context.findSafeActorPath(clearShell, fixedLandmarks, 88, preferred);
  assertCorridorClear(path, fixedLandmarks, `${expected} must be reachable`);
  assertActualActorFramesClear(path, fixedLandmarks, clearShell.width, `${expected} must use its real swept bounds`);
  assert.equal(path.entry, expected, `preferred entry ${preferred} must map to ${expected}`);
}

const rightPanelShell = { width: 1120, height: 760 };
const rightPanelRects = [
  { left: 0, top: 0, right: 1120, bottom: 56 },
  { left: 120, top: 642, right: 1000, bottom: 752 },
  { left: 330, top: 220, right: 690, bottom: 570 },
  { left: 820, top: 58, right: 1120, bottom: 760 },
];
const insetUpperRight = context.findSafeActorPath(rightPanelShell, rightPanelRects, 88, 1);
assertCorridorClear(insetUpperRight, rightPanelRects, "upper-right actor must emerge beside an open output panel");
assertActualActorFramesClear(insetUpperRight, rightPanelRects, rightPanelShell.width, "inset upper-right actor must stay clear of the open output panel");
assert.equal(insetUpperRight.entry, "upper-right", "an open output panel must not turn the upper-right pose into a different entrance");
assert.ok(insetUpperRight.toX < rightPanelRects.at(-1).left - 88, "upper-right actor must settle visibly to the left of the output panel");

for (const state of [
  { name: "left-expanded/right-closed", width: 1040, rightOpen: false },
  { name: "left-collapsed/right-closed", width: 1260, rightOpen: false },
  { name: "left-expanded/right-open", width: 780, rightOpen: true },
  { name: "left-collapsed/right-open", width: 960, rightOpen: true },
]) {
  const shell = { width: state.width, height: 720 };
  const rects = [
    { left: 0, top: 0, right: state.width, bottom: 58 },
    { left: 90, top: 600, right: state.width - 60, bottom: 714 },
    { left: Math.round(state.width * .30), top: 190, right: Math.round(state.width * .70), bottom: 520 },
    { left: state.width - 22, top: 0, right: state.width, bottom: 720 },
  ];
  if (state.rightOpen) rects.push({ left: state.width - 250, top: 70, right: state.width, bottom: 590 });
  const before = JSON.stringify({ shell, rects });
  const path = context.findSafeActorPath(shell, rects, 88, 0);
  assertCorridorClear(path, rects, `${state.name} must keep one safe entry`);
  assertActualActorFramesClear(path, rects, state.width, `${state.name} must keep every actual actor frame clear`);
  if (state.rightOpen) assert.equal(path.side, "left", `${state.name} must abandon both occupied right entrances`);
  assert.equal(JSON.stringify({ shell, rects }), before, `${state.name} geometry inputs must remain byte-identical`);
}

const narrowShell = { width: 640, height: 620 };
const narrowRects = [
  { left: 0, top: 0, right: 640, bottom: 56 },
  { left: 170, top: 170, right: 470, bottom: 430 },
  { left: 80, top: 500, right: 580, bottom: 618 },
  { left: 618, top: 0, right: 640, bottom: 620 },
];
const narrowPath = context.findSafeActorPath(narrowShell, narrowRects, 80, 1, "peek");
assertCorridorClear(narrowPath, narrowRects, "narrow work window must degrade safely");
assertActualActorFramesClear(narrowPath, narrowRects, narrowShell.width, "narrow work window actual frames must stay clear", "peek");
assert.equal(
  context.findSafeActorPath({ width: 900, height: 650 }, [{ left: 0, top: 56, right: 900, bottom: 650 }], 88, 0),
  null,
  "actor must stay hidden when every corridor is occupied",
);

const silhouetteShell = { width: 1120, height: 900 };
const silhouetteRects = [
  { left: 0, top: 0, right: 1120, bottom: 590 },
  { left: 0, top: 704, right: 1120, bottom: 900 },
  { left: 1098, top: 0, right: 1120, bottom: 900 },
];
assert.equal(
  context.findSafeActorPath(silhouetteShell, silhouetteRects, 80, 0, "peek"),
  null,
  "a full opaque 80px actor must not be forced into a shorter painted gap",
);
const silhouettePath = context.findSafeActorPath(
  silhouetteShell,
  silhouetteRects,
  80,
  0,
  "peek",
  [],
  [0.186, 0.031, 0.804, 0.971],
);
assert.ok(silhouettePath, "transparent image margins must not consume collision space");
assertActualActorFramesClear(
  silhouettePath,
  silhouetteRects,
  silhouetteShell.width,
  "measured visible silhouette must still avoid every painted landmark",
  "peek",
  [0.186, 0.031, 0.804, 0.971],
);

const motionPath = { side: "left", fromX: -100, enterX: 24, toX: 66, exitX: 66, y: 260, size: 88 };
const actorFrames = context.buildActorKeyframes(motionPath);
assert.deepEqual([...actorFrames.map((frame) => frame.offset)], [0, .14, .26, .72, .86, 1], "actor must enter, dwell, then leave in distinct beats");
assert.equal(actorFrames[0].opacity, 0);
assert.equal(actorFrames.at(-1).opacity, 0);
for (const frame of actorFrames.slice(1, -1)) assert.equal(frame.opacity, 1, "the actor must remain fully readable throughout the dwell");
assert.match(actorFrames[2].transform, /translate3d\(66px, 260px, 0\)/, "the actor must settle inside the safe edge corridor");
const peekFrames = context.buildActorKeyframes(motionPath, "peek");
for (const frame of peekFrames) {
  assert.match(frame.transform, /translate3d\(66px, /, "non-running poses must emerge in place instead of crossing the screen");
}
const rightToLeftPath = { side: "right", fromX: 900, enterX: 882, toX: 840, exitX: 840, y: 260, size: 88 };
const rightToLeftFrames = context.buildActorKeyframes(rightToLeftPath, "run");
assert.match(rightToLeftFrames[0].transform, /translate3d\(900px,/, "right-entry runner must start farther right");
assert.match(rightToLeftFrames[2].transform, /translate3d\(840px,/, "right-entry runner must finish left of its starting point");

function classed(...initial) {
  const classes = new Set(initial);
  return {
    classes,
    classList: {
      add: (...names) => names.forEach((name) => classes.add(name)),
      remove: (...names) => names.forEach((name) => classes.delete(name)),
    },
  };
}

const staleHome = classed("dream-home");
const staleHomeShell = classed("dream-home-shell");
const staleWorkShell = classed("dream-work-shell");
const staleHeader = classed("dream-work-header");
const staleComposer = classed("dream-work-composer");
const markerNodes = {
  ".dream-home": [staleHome],
  ".dream-home-shell": [staleHomeShell],
  ".dream-work-shell": [staleWorkShell],
  ".dream-work-header": [staleHeader],
  ".dream-work-composer": [staleComposer],
};
const markerDocument = {
  querySelectorAll(selector) {
    assert.ok(Object.hasOwn(markerNodes, selector), `unexpected marker selector: ${selector}`);
    return markerNodes[selector];
  },
};
const markerRoot = classed("codex-dream-skin", "dream-route-home", "dream-route-work");
context.applyRouteMarkers(markerRoot, markerDocument, { kind: "unknown", shellMain: null, home: null });
for (const marker of ["codex-dream-skin", "dream-route-home", "dream-route-work"]) {
  assert.equal(markerRoot.classes.has(marker), false, `unknown route must clear ${marker}`);
}
for (const [marker, nodes] of Object.entries(markerNodes)) {
  for (const node of nodes) assert.equal(node.classes.has(marker.slice(1)), false, `unknown route must clear ${marker}`);
}

const workRoot = classed();
const workShell = classed();
const workHeader = classed();
const workComposer = classed();
workShell.querySelectorAll = (selector) => {
  if (selector === "header.app-header-tint") return [workHeader];
  if (selector === ".composer-surface-chrome") return [workComposer];
  assert.fail(`unexpected work marker selector: ${selector}`);
};
context.applyRouteMarkers(workRoot, markerDocument, { kind: "work", shellMain: workShell, home: null });
assert.equal(workRoot.classes.has("codex-dream-skin"), true);
assert.equal(workRoot.classes.has("dream-route-work"), true);
assert.equal(workRoot.classes.has("dream-route-home"), false);
assert.equal(workShell.classes.has("dream-work-shell"), true);
assert.equal(workHeader.classes.has("dream-work-header"), true);
assert.equal(workComposer.classes.has("dream-work-composer"), true);

const inlineStyle = new Map();
const priorities = new Map();
const chrome = classed("dream-home-shell", "dream-work-chrome");
chrome.hidden = false;
chrome.dataset = {};
chrome.style = {
  setProperty(name, value, priority = "") {
    inlineStyle.set(name, value);
    priorities.set(name, priority);
  },
  removeProperty(name) {
    inlineStyle.delete(name);
    priorities.delete(name);
  },
};
context.hideChrome(chrome);
assert.equal(chrome.hidden, true);
assert.equal(chrome.dataset.dreamRoute, "unknown");
assert.equal(chrome.dataset.dreamSafeArea, "false");
assert.equal(inlineStyle.get("display"), "none");
assert.equal(priorities.get("display"), "important", "theme CSS must not override fail-closed hiding");
assert.equal(chrome.classes.has("dream-home-shell"), false);
assert.equal(chrome.classes.has("dream-work-chrome"), false);

assert.doesNotMatch(renderer, /querySelector\("main"\)/, "renderer must never fall back to an arbitrary main element");
assert.match(renderer, /new ResizeObserver\(/, "chrome geometry must follow native panel resizing");
assert.match(renderer, /resizeObserver\.observe\(route\.shellMain\)/, "the unique main surface must be resize-observed");
assert.match(renderer, /route\.kind === "work"[\s\S]*?route\.shellMain\?\.querySelector\("\.composer-surface-chrome"\)/, "work composer resizing must invalidate actor geometry");
const scheduleEnsureSource = renderer.slice(renderer.indexOf("const scheduleEnsure"), renderer.indexOf("const observer"));
assert.doesNotMatch(scheduleEnsureSource, /if \(actorAnimation\) stopActor\(/, "ordinary content updates must not erase the actor before its readable dwell completes");
assert.match(scheduleEnsureSource, /activeActorPath && !actorPathStillSafe\(\)/, "new overlays may cancel only when they actually collide with the active safe corridor");
assert.match(scheduleEnsureSource, /scheduleActorSafetyCheck\(\)/, "continuous streaming must trigger a bounded leading safety check instead of postponing collision checks forever");
const safetyCheckSource = renderer.slice(renderer.indexOf("const scheduleActorSafetyCheck"), renderer.indexOf("const onDocumentScroll"));
assert.match(safetyCheckSource, /if \(scheduler\.actorSafetyTimeout\) return/, "actor safety checks must be leading-throttled during continuous mutations");
assert.doesNotMatch(safetyCheckSource, /clearTimeout\(scheduler\.actorSafetyTimeout\)/, "continuous mutations must not keep pushing the safety check later");
const scrollSource = renderer.slice(renderer.indexOf("const onDocumentScroll"), renderer.indexOf("document.addEventListener(\"scroll\""));
assert.match(scrollSource, /stopActor\(\)/, "the first scroll event must immediately hide the fixed decorative actor");
assert.match(scrollSource, /actorScrollTimeout/, "the actor may return only after scrolling becomes idle");
assert.match(renderer, /route\.kind === "unknown"[\s\S]*?hideChrome\(/, "unknown routes must hide AutoSkin chrome");
assert.match(renderer, /style\.media = route\.kind === "unknown" \? "not all" : ""/, "unknown routes must disable all injected CSS");
assert.equal((renderer.match(/class="dream-theme-actor"/g) ?? []).length, 1, "runtime template must contain exactly one actor root");
assert.match(renderer, /upper-left[\s\S]*upper-right[\s\S]*middle-left[\s\S]*lower-right/, "runtime must expose the four approved named entries");
assert.match(renderer, /config\.entries\?\.\[assetIndex\]/, "each pose must request its own preferred entrance");
assert.match(renderer, /config\.behaviors\?\.\[assetIndex\]/, "each pose must request its own motion behavior");
assert.match(renderer, /config\.bounds\?\.\[assetIndex\]/, "each pose must route against its measured visible silhouette");
assert.match(renderer, /recentActorPoints/, "one four-pose cycle must remember and avoid its earlier appearance points");
assert.match(renderer, /Math\.max\(96, size \* 1\.2\)/, "one four-pose cycle must keep its dwell points at least 1.2 actor widths apart");
assert.match(renderer, /findSafeActorPath\([\s\S]*?preferredEntry,[\s\S]*?behavior/, "collision routing must account for each pose's actual motion behavior");
assert.match(renderer, /thread-floating-content-top-inset/, "the expanded output/source panel must be protected as one floating landmark");
assert.match(renderer, /NodeFilter\?\.SHOW_TEXT[\s\S]*?createTreeWalker\(shellMain, showText\)/, "collision routing must inspect visible text nodes that have no stable Codex class");
assert.match(renderer, /range\.getClientRects\(\)/, "collision routing must protect the real painted bounds of visible text lines");
assert.match(renderer, /actor\.dataset\.motion\s*=\s*behavior/, "the active pose behavior must reach CSS so only runners receive a trail");
assert.match(renderer, /actor\.dataset\.assetIndex\s*=\s*String\(assetIndex\)/, "the single actor node must expose its rotating asset index for live verification");
assert.match(renderer, /motionQuery\?\.matches/, "reduced-motion preference must short-circuit actor scheduling");
assert.match(renderer, /function showStaticActor\(/, "reduced-motion preference must retain one safe static actor");
assert.match(renderer, /motionQuery\?\.matches[\s\S]*?showStaticActor\(\)/, "reduced-motion route must render the static actor instead of dropping theme identity");
assert.match(renderer, /actorAnimation\s*=\s*actor\.animate\(/, "actor must use a bounded Web Animation");
assert.match(renderer, /scheduleActor\(1800\)/, "the first actor appearance must arrive promptly after the theme becomes active");
assert.match(renderer, /clearActorNode[\s\S]*actor\.hidden = true[\s\S]*actor\.dataset\.active = "false"/, "finished/cancelled actors must become inert and hidden");
assert.match(renderer, /if \(image\.getAttribute\("src"\) !== asset\) image\.src = asset/, "the same actor blob must stay cached between passes instead of decoding every cycle");

console.log("renderer routing contract: ok");
