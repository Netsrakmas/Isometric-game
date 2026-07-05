# Grid Warrior — Ruins of the Meadow

A single-level isometric action game (2:1 diamond grid, Zelda-style combat, 3 guardian
trials, 3-phase boss) plus a **level editor**. Canvas 2D, fixed-timestep 60 Hz, Web Audio
(all sound synthesized), zero external dependencies. Deploys to GitHub Pages as-is.

This is the folder-structure refactor of the original one-file prototype
(kept for reference in `prototype/gridwarrior.html`; the plan is in `docs/HANDOFF.md`).

## Layout

```
index.html        the game (GitHub Pages entry point)
editor.html       the level editor
js/core.js        shared: iso math, tile enum, Level + JSON, asset loader, animation
js/game.js        the game
js/editor.js      the editor
assets/           loose sprite files + manifest.json (list of files to load)
levels/meadow.json  the level, as data
art-src/          original ChatGPT sprite sheets (source material, not loaded by the game)
tools/            node scripts: asset extraction, meadow.json generator
```

## Run locally

Needs any static file server (fetch() doesn't work from `file://`):

```
python3 -m http.server 8000     # or: npx http-server
# game:   http://localhost:8000/
# editor: http://localhost:8000/editor.html
```

## Animation frames (the agreed spec)

The engine has an animation state machine; right now it falls back to the 9 legacy
static poses because no multi-frame strips exist yet. To add real animations:

1. **Fixed canvas per frame** (e.g. 128×128), transparent background, feet anchored
   bottom-center **~8 px above the bottom edge**. Anchor consistency is the #1 thing
   that kills jitter — keep it identical across every frame of every anim.
2. Export **one horizontal strip PNG per anim per direction**, named
   `player_<anim>_<dir>_<framecount>.png`, e.g. `player_walk_sw_8.png`.
   The frame count is parsed from the filename — there is no config file.
   (A trailing `_<digits>` only counts as a frame count when preceded by `_`,
   so legacy names like `pl_walk_ne2.webp` stay single images.)
3. Only **two directions** are needed: `sw` (facing down-left) and `nw` (facing
   up-left). The engine mirrors them for right-facing.
4. Drop the files in `assets/` and **add each filename to `assets/manifest.json`**.
   That's it — the game picks them up automatically and stops using the static poses
   (and the sine-bob) for any anim/direction that has a strip.

Anim names the player state machine requests: `idle`, `walk`, `attack`, `roll`, `hurt`.
Minimum smooth set: walk 6–8f + idle 2–4f for both directions, attack 4–6f,
roll 4f, hurt 1–2f (~40–50 frames total). Frame rates/looping per anim live in
`ANIM_DEF` in `js/core.js`; draw size/anchor for strips are the
`PLAYER_STRIP_DRAW_W` / `PLAYER_STRIP_ANCHOR` constants at the bottom of `js/game.js`.

The boss can stay static (big slow creature reads fine), but the same mechanism works:
`boss_slam_6.png` supersedes the static `boss_slam.webp` automatically.

## Level editor

Open `editor.html`. It loads `levels/meadow.json` by default.

- **Paint** — pick a tile, LMB-drag to paint. RMB-drag pans, wheel zooms, Ctrl+Z undoes.
- **Enemy / Pickup / Sign / Start** — click to place. Placing a goblin asks for a second
  click to set its patrol point. The **Layer** dropdown decides whether an enemy goes
  into the world or into an arena wave.
- **Arena** — drag a rect for the trial interior, then use the arena list to add gate
  tiles (`+gate`, then click a tile) and extra waves.
- **Boss** — sub-tools: click for `spawn` / `gate` (gate also paints the gate tile),
  drag for `trigger` (starts the fight) and `arena` (thorn/barrage bounds in phase 3).
- **Select** — click a marker to select, drag to move, Del to delete, edit sign text /
  goblin patrol from the Selection panel.
- **Export JSON** downloads the level; commit it into `levels/`. **Import…** loads one.
- **▶ Test Play** launches the game in a new tab with the current level (handed over
  via localStorage; the test session uses a separate save slot so it won't touch your
  real save).

To ship a level: export it, save as `levels/<name>.json`, and open the game with
`index.html?level=levels/<name>.json` (no param = meadow).

## Debug hooks

`window.GW` (game object), `window.GW_warpBoss()` (light all runes + warp to boss gate),
`window.ED` (editor: current level + view).

## Known gaps / QA flags

- Touch controls (virtual stick + buttons) are implemented but untested on real devices.
- `tile_bridge`, `tile_wallgate` and the floor tiles were re-extracted from
  `art-src/tiles-sheet.png` — the first extraction had cropped fragments and stray
  debris baked in. Tile draw offsets live in `js/core.js` (`drawBridgeTile` etc.)
  if further tuning is wanted.
- Editor has no resize-existing-level operation (create a New level at the right size).
