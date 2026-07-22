# Design System — AutoSkin Daily Workspace

## Product Context

- **What this is:** A reversible renderer skin engine for the official Codex desktop app. Version 3 treats the persistent work screen, not the new-task screen, as the primary product surface.
- **Who it is for:** People who spend hours reading, writing, reviewing code, and moving between tasks in Codex.
- **Project type:** Dense desktop productivity interface.

## Aesthetic Direction

- **Direction:** Midnight Counter.
- **Decoration level:** Intentional. Character appears through material, hierarchy, and a few recurring motifs, not stickers over content.
- **Mood:** A calm late-night workbench with warm light, dark lacquer, paper edges, and one sharp signal color.
- **Memorable detail:** The composer has a thin two-color signal rail. Active navigation and user prompts repeat the same accent, turning an entire session into one visual rhythm.

## Typography

- **Body/UI:** Source Han Sans SC, with Microsoft YaHei UI fallback. Chinese readability and stable glyph metrics matter more than loading a web font into a desktop renderer.
- **Code/data:** Cascadia Code, with JetBrains Mono fallback.
- **Scale:** Preserve Codex's native scale. Improve hierarchy through weight, contrast, and spacing rather than resizing the whole application.

## Color

- **Approach:** Restrained. Neutrals own most pixels; accents carry meaning.
- **Workspace neutrals:** Themes define `--dream-work-bg`, raised surfaces, three surface levels, text, and muted text.
- **Signal accents:** `accent` is selection/navigation; `accent-warm` is focus/action.
- **Semantic colors:** Keep native success, warning, error, and unread indicators unless a theme has an accessibility-tested replacement.
- **Dark mode:** Redesign surfaces rather than inverting a light palette. Text is warm rather than pure white; borders stay below 16% opacity.

## Spacing

- **Base unit:** 4px.
- **Density:** Comfortable-compact. The user should see a long thread and many tasks without the interface feeling cramped.
- **Message rhythm:** Assistant output stays flat and editorial. User messages are the raised cards that separate turns.

## Layout

- **Approach:** Grid-disciplined application shell with editorial reading content.
- **Corners:** 8px controls, 12px panels/code, 18px user message/composer. Avoid making every object equally bubbly.
- **Persistent surfaces:** Sidebar, task header, work canvas, inspector panes, content blocks, and composer share one material hierarchy.

## Motion

- **Approach:** Minimal-functional.
- **Duration:** 140ms for hover/focus. An opt-in work-route actor may make a rare 1.4–3.2s pass, one instance at a time, only through a collision-free edge corridor; no continuous ambient loop.
- **Reduced motion:** Existing reduced-motion behavior remains authoritative.

## Daily Workspace Contract

Themes may set the optional `--dream-work-*` tokens documented in `THEME-SPEC.md`. Existing themes inherit a quiet light fallback. A dark theme should be expressible through tokens, with `extra.css` reserved for genuinely theme-specific art direction.

## Decisions Log

| Date | Decision | Rationale |
|---|---|---|
| 2026-07-17 | Make the persistent task route the primary themed surface | It is where users spend nearly all of their time |
| 2026-07-17 | Keep assistant output flat; raise only user prompts | Creates clear cadence without turning a long thread into a pile of cards |
| 2026-07-17 | Use art as atmosphere, never as a competing content layer | Readability is the product requirement; character comes from repeated motifs and material |
| 2026-07-21 | Bound moving character art in the renderer instead of theme CSS | Three checked entries, one owned node, transform/opacity only, fail closed on collision or reduced motion |
