# Grid Warrior — Handoff for Claude Code

## What this is
A complete single-level isometric action game ("Grid Warrior — Ruins of the Meadow"), built as ONE self-contained HTML file (`gridwarrior.html`, ~650KB). Canvas 2D, fixed-timestep 60Hz loop, Web Audio API for all sound (synthesized, no audio files), assets embedded as base64 WebP. Deploys to GitHub Pages as-is. Zero external dependencies.

## The concept
- Chibi warrior, 2:1 isometric diamond grid (Command & Conquer camera angle).
- Zelda-style combat: 3-hit sword combo, dodge roll with i-frames, hearts for HP.
- 3 enemy types (blob/contact, spear goblin/telegraph-lunge, turret plant/projectiles that can be deflected).
- 3 "guardian" arena trials with wave spawns + closing gates; clearing all 3 lights 3 runes and opens the boss gate.
- Boss "Grubthorn the Ruin Tender": 40 HP, 3 phases (flail slam w/ telegraph circle, stomp shockwave ring, phase-2 seed barrage that spawns blobs, phase-3 thorn arena + charge-into-wall stun with double-damage window).
- Full flow: title (New Game/Continue) -> level -> arenas -> fountain checkpoint (auto-save) -> boss -> victory screen (time/coins/deaths). Death respawns at last checkpoint.
- Save via localStorage (`gridwarrior_v1`), with in-memory fallback.

## Assets (IMPORTANT context)
User generated 3 sprite sheets in ChatGPT (player 3x3, boss 3x3, tiles 3x3). I extracted 26 individual sprites (white-bg flood-fill removal + native-alpha passthrough for the player sheet + small-component noise cleanup), converted to WebP, embedded as a `const ASSETS_B64 = {...}` dict keyed by name (e.g. `pl_idle_se`, `boss_slam`, `tile_grass1`).

- Player: 9 static poses only — idle_se, walk_se, walk_ne, back_nw, walk_sw, walk_ne2, hurt, roll, victory.
- Boss: idle, raise, slam, stomp, barrage, charge, stun, p2, dead.
- Tiles: grass1/2/3, dirt, water, wallruin, bridge, wallgate.
- Enemies (blob/goblin/turret) are drawn PROCEDURALLY with canvas shapes, not sprites.

## Known issues the user flagged (real, still open)
1. **Animations aren't smooth** — because there are NO animations. It's 9 static poses flip-booked + a sine-wave bob. Needs real multi-frame anims. User will produce animation frames themselves (likely Aseprite).
2. **Level layout is a bit off** — tile anchoring constants (wall/bridge draw offsets) and hand-authored layout in `buildMap()` need tuning. Currently all map geometry is hardcoded in `buildMap()`.

## Architecture notes for the planned refactor
The code is already close to data-driven:
- Assets are just a name->Image dict. Swapping embedded base64 for loose PNGs in `/assets` = rewrite `loadAssets()` only.
- Level is already data-shaped: `buildMap()` + spawn arrays + arena definitions (`makeArenas()`) could serialize to JSON. Loader would replace `buildMap()`.
- Grid<->screen transform: `isoX=(gx-gy)*64`, `isoY=(gx+gy)*32`. Tile T enum: G/P/W(water)/R(ruin wall)/B(bridge)/C(cracked)/GATE/F(fountain). `SOLID()` helper. Depth sort by `gx+gy`.
- Debug hooks exposed: `window.GW` (the game object), `window.GW_warpBoss()`.

## Agreed next steps (this is the roadmap)
Two INDEPENDENT workstreams — user does animations, Claude Code does the editor:

### A. Separated assets + animation support
- Move embedded base64 -> loose PNG files in an `/assets` folder; rewrite the loader.
- **Animation frame spec agreed with user:**
  - Fixed canvas per frame (e.g. 128x128), transparent bg, feet anchored bottom-center ~8px up. Anchor consistency is the #1 thing that kills jitter.
  - One horizontal strip PNG per anim per direction, named `name_anim_direction_framecount.png` (e.g. `player_walk_se_8.png`). Parse frame count from filename — no config file.
  - Minimum smooth player set: walk (6-8f) + idle (2-4f) for TWO facings only (down-left, up-left) since engine mirrors for right-facing; plus attack (4-6f), roll (4f), hurt (1-2f). ~40-50 frames total.
  - Boss can stay static initially (big slow creature reads fine).
- Add an animation state machine (per-entity current-anim + frame timer) to replace the current pose-picking `pickPlayerSprite()`.

### B. Level maker (separate HTML tool)
- Reuse the SAME iso rendering engine in `editor.html`.
- Paint tiles from the existing tileset; place enemy spawns, pickups, signs; draw arena trigger rects with gate tile positions; set player start.
- Export/import level as JSON. Game gets a JSON loader replacing `buildMap()`.
- Add a "Test Play" button that launches the level directly (editor + game share code).

### Open decision to resolve first
**Single-file vs folder structure.** User leaning toward proper folder structure (`game.html`, `editor.html`, `/assets`, `/levels`) for this phase — it's better for separated assets + animations + editor, at the cost of multi-file GitHub Pages deploys. Confirm this choice before building, since it determines the loader design.

## User context (for tone/decisions)
- Workflow: single self-contained HTML files -> GitHub Pages (github user: Netsrakmas). Uses Playwright headless for iterative testing throughout. Has Claude Code remote control set up for phone deploys.
- Prefers honest critical evaluation over optimistic framing. Comfortable with the tradeoffs discussed.
- Strategic note raised in chat: this custom-engine path (separated assets + level format + anim state machines + tile editor) is basically re-deriving Godot 4's built-in feature set. User was already circling Godot for a 2D Zelda-style project. The single-file HTML approach is great for prototypes/party games; the moment multi-level + real animation is the goal is roughly the moment a Godot port becomes the better tool. Worth keeping on the table, but user wants to proceed with the HTML editor+assets refactor for now.

## Testing that was done (all passed, zero JS errors)
Playwright: title->play transition, HUD/boss-bar pixel checks, tile-seam detection (0% gaps), a keyboard bot that physically walked start->bridge->corridors->fountain->boss gate, arena trigger + rune persistence, save/reload roundtrip, death/respawn, all 3 boss phases through to victory. Touch controls (virtual stick + attack/roll buttons) are implemented but UNTESTED on a real device — flag for QA.
