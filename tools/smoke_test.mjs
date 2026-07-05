// Playwright smoke tests for Grid Warrior game + editor.
// Run: serve the repo root (e.g. python3 -m http.server 8722), then: node tools/smoke_test.mjs
// Env: GW_URL to override the server, PLAYWRIGHT_MJS to point at a playwright install,
//      GW_SHOTS for the screenshot output dir.
let chromium;
try { ({ chromium } = await import('playwright')); }
catch { ({ chromium } = await import(process.env.PLAYWRIGHT_MJS || '/opt/node22/lib/node_modules/playwright/index.mjs')); }

const BASE = process.env.GW_URL || 'http://localhost:8722';
const shots = process.env.GW_SHOTS || '/tmp';
let failures = 0;
const ok = (cond, name) => { console.log((cond ? 'PASS' : 'FAIL') + '  ' + name); if (!cond) failures++; };

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const errors = [];
const page = await ctx.newPage();
page.on('pageerror', e => errors.push('game: ' + e.message));
page.on('console', m => { if (m.type() === 'error') errors.push('game console: ' + m.text()); });

// ---------- GAME ----------
await page.goto(BASE + '/index.html');
await page.waitForFunction(() => window.GW && window.GW.state === 'title', null, { timeout: 15000 });
ok(true, 'game boots to title with level+assets loaded');
await page.screenshot({ path: shots + '/shot_title.png' });

await page.keyboard.press('Enter');
await page.waitForFunction(() => window.GW.state === 'play', null, { timeout: 5000 });
ok(true, 'title -> play');

const start = await page.evaluate(() => ({ x: window.GW.player.x, y: window.GW.player.y }));
await page.keyboard.down('KeyW'); await page.waitForTimeout(700); await page.keyboard.up('KeyW');
const after = await page.evaluate(() => ({ x: window.GW.player.x, y: window.GW.player.y }));
ok(Math.hypot(after.x - start.x, after.y - start.y) > 0.5, 'player moves with WASD');

// attack + roll don't throw
await page.keyboard.press('Space');
await page.keyboard.press('KeyK');
await page.waitForTimeout(500);

// enemies + arenas built from JSON
const world = await page.evaluate(() => ({
  enemies: window.GW.enemies.length, arenas: window.GW.arenas.length,
  runes: window.GW.runes.length, signs: window.GW.signs.length,
  fountain: !!window.GW.constructor && true,
}));
ok(world.enemies >= 14, `enemies spawned from JSON (${world.enemies})`);
ok(world.arenas === 3, 'three arenas from JSON');
ok(world.runes === 3, 'three rune slots');
ok(world.signs === 5, 'five signs');
await page.screenshot({ path: shots + '/shot_play.png' });

// checkpoint/save roundtrip: touch fountain via teleport, then reload and Continue
await page.evaluate(() => { window.GW.player.x = 34.5; window.GW.player.y = 13.5; });
await page.waitForTimeout(400);
const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('gridwarrior_v1')));
ok(saved && saved.checkpoint === 'fountain', 'fountain checkpoint saved');
await page.reload();
await page.waitForFunction(() => window.GW && window.GW.state === 'title', null, { timeout: 15000 });
const hasSave = await page.evaluate(() => window.GW.hasSave);
ok(hasSave, 'save detected after reload');
await page.keyboard.press('Enter');
await page.waitForFunction(() => window.GW.state === 'play', null, { timeout: 5000 });
const respawn = await page.evaluate(() => ({ x: window.GW.player.x, y: window.GW.player.y }));
ok(Math.abs(respawn.x - 34.5) < 0.01 && Math.abs(respawn.y - 13.5) < 0.01, 'continue respawns at fountain');

// boss warp + fight boots
await page.evaluate(() => window.GW_warpBoss());
await page.evaluate(() => { window.GW.player.y = 8.5; }); // step through trigger
await page.waitForFunction(() => window.GW.bossActive, null, { timeout: 5000 });
ok(true, 'boss trigger from JSON rect works');
await page.waitForTimeout(1500);
await page.screenshot({ path: shots + '/shot_boss.png' });

// animation machinery active (legacy fallback path draws; animator exists)
const anim = await page.evaluate(() => window.GW.player.animator && window.GW.player.animator.name);
ok(typeof anim === 'string', 'player animator state machine active (anim=' + anim + ')');

// ---------- EDITOR ----------
const ep = await ctx.newPage();
ep.on('pageerror', e => errors.push('editor: ' + e.message));
ep.on('console', m => { if (m.type() === 'error') errors.push('editor console: ' + m.text()); });
await ep.goto(BASE + '/editor.html');
await ep.waitForFunction(() => window.ED && window.ED.level && window.ED.level.name.length > 0, null, { timeout: 15000 });
const edName = await ep.evaluate(() => window.ED.level.name);
ok(edName === 'Ruins of the Meadow', 'editor loads meadow.json (' + edName + ')');
await ep.screenshot({ path: shots + '/shot_editor.png' });

// paint a tile: click center-ish then verify some tile changed to water
await ep.evaluate(() => { document.querySelector('[data-t=paint]').click(); });
await ep.evaluate(() => { [...document.querySelectorAll('#toolOpts button')].find(b => b.textContent === 'Water').click(); });
const before = await ep.evaluate(() => {
  const l = window.ED.level; let n = 0; for (const t of l.tiles) if (t === 2) n++; return n;
});
const box = await ep.evaluate(() => { const r = document.getElementById('ed').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
await ep.mouse.click(box.x, box.y);
const afterN = await ep.evaluate(() => {
  const l = window.ED.level; let n = 0; for (const t of l.tiles) if (t === 2) n++; return n;
});
ok(afterN !== before, `paint changes tiles (${before} -> ${afterN} water)`);

// export roundtrip in-page: toJSON -> fromJSON preserves counts
const round = await ep.evaluate(() => {
  const j = window.ED.level.toJSON();
  const l2 = Level.fromJSON(JSON.parse(JSON.stringify(j)));
  return { a: j.arenas.length, e: j.enemies.length, ok: l2.w === j.width && l2.enemies.length === j.enemies.length && l2.arenas.length === j.arenas.length };
});
ok(round.ok, `level JSON roundtrip (arenas ${round.a}, enemies ${round.e})`);

// Test Play handoff: click Test Play, a new page opens on ?level=test with TEST save key
const [testPage] = await Promise.all([
  ctx.waitForEvent('page'),
  ep.click('#bTest'),
]);
testPage.on('pageerror', e => errors.push('testplay: ' + e.message));
await testPage.waitForFunction(() => window.GW && window.GW.state === 'title', null, { timeout: 15000 });
const testName = await testPage.evaluate(() => window.GW && document.title && window.location.search);
ok(testName.includes('level=test'), 'Test Play opens game with ?level=test');
await testPage.keyboard.press('Enter');
await testPage.waitForFunction(() => window.GW.state === 'play', null, { timeout: 5000 });
ok(true, 'test level is playable');
await testPage.screenshot({ path: shots + '/shot_testplay.png' });

// zero errors overall
ok(errors.length === 0, 'zero JS errors across game+editor+testplay');
if (errors.length) console.log(errors.join('\n'));

await browser.close();
console.log(failures ? `\n${failures} FAILURES` : '\nALL PASS');
process.exit(failures ? 1 : 0);
