// Boss fairness tests:
// 1) rolling AWAY from the stomp ring escapes it (the natural reaction)
// 2) standing still still gets hit (ring not neutered)
// 3) no contact damage during the stun/exposed punish window
// 4) a bot using only real player moves beats the whole fight (all 3 phases) without dying
// Run: serve the repo root (e.g. python3 -m http.server 8722), then: node tools/boss_fairness_test.mjs
// Env: GW_URL to override the server, PLAYWRIGHT_MJS to point at a playwright install.
let chromium;
try { ({ chromium } = await import('playwright')); }
catch { ({ chromium } = await import(process.env.PLAYWRIGHT_MJS || '/opt/node22/lib/node_modules/playwright/index.mjs')); }
const BASE = process.env.GW_URL || 'http://localhost:8722';
let failures = 0;
const ok = (c, n) => { console.log((c ? 'PASS' : 'FAIL') + '  ' + n); if (!c) failures++; };

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on('pageerror', e => console.log('PAGEERR', e.message));
await page.goto(BASE + '/index.html');
await page.waitForFunction(() => window.GW && window.GW.state === 'title');
await page.keyboard.press('Enter');
await page.waitForFunction(() => window.GW.state === 'play');

// enter the boss fight
await page.evaluate(() => { GW_warpBoss(); GW.player.y = 8.5; });
await page.waitForFunction(() => window.GW.bossActive);
await page.waitForFunction(() => window.GW.boss.state !== 'intro', null, { timeout: 8000 });
// instrument: log every landed hit with whether it came from the shockwave ring
await page.evaluate(() => {
  window.__hits = [];
  const p = GW.player, orig = p.hurt.bind(p);
  p.hurt = (g, dmg, src) => { const r = orig(g, dmg, src);
    if (r) window.__hits.push({ dmg, isRing: !!(src && src.r !== undefined && src.hp === undefined), boss: GW.boss && GW.boss.state });
    return r; };
});

// helper: run one forced stomp, with a reaction callback while the ring approaches
async function forcedStomp(reaction) {
  await page.evaluate(() => {
    const b = GW.boss, p = GW.player;
    b.ring = null; b.state = 'stompTele'; b.t = 0.05; b.pose = 'stomp';
    // player 2.5 tiles away, healthy timers
    p.x = b.x + 2.5; p.y = b.y; p.hp = p.maxHp; p.inv = 0; p.rollCd = 0; p.kbx = p.kby = 0;
  });
  await page.waitForFunction(() => GW.boss.ring, null, { timeout: 3000 });
  await page.evaluate(() => { window.__hits = []; });
  // watch the ring; fire the reaction when it is ~1 tile from the player
  await page.waitForFunction(() => {
    const b = GW.boss, p = GW.player;
    if (!b.ring) return true;
    const dd = Math.hypot(p.x - b.ring.x, p.y - b.ring.y);
    if (dd - b.ring.r < 1.0 && !window.__reacted) { window.__reacted = true; window.__react && window.__react(); }
    return false;
  }, null, { timeout: 6000 }).catch(() => {});
  await page.waitForFunction(() => !GW.boss.ring, null, { timeout: 6000 });
  const ringHits = await page.evaluate(() => window.__hits.filter(h => h.isRing).length);
  await page.evaluate(() => { window.__reacted = false; });
  return ringHits;
}

// 1) roll AWAY when the ring gets close, then keep running away (held key) -> no damage
await page.evaluate(() => {
  // per-frame runner emulating a held movement key
  if (!window.__runnerInstalled) { window.__runnerInstalled = true;
    const step = () => { if (window.__hold) { const p = GW.player;
      p.mx = window.__hold[0]; p.my = window.__hold[1]; p.fx = p.mx; p.fy = p.my;
      if (!p.rolling) { p.x += p.mx * p.speed / 60; p.y += p.my * p.speed / 60; } }
      requestAnimationFrame(step); };
    requestAnimationFrame(step); }
  window.__react = () => { const p = GW.player, b = GW.boss;
    const dx = Math.sign(p.x - b.x) || 1;
    window.__hold = [dx, 0];
    p.mx = dx; p.my = 0; p.fx = dx; p.fy = 0;
    p.tryRoll(GW); };
});
let lost = await forcedStomp();
await page.evaluate(() => { window.__hold = null; });
ok(lost === 0, `roll away + keep running escapes the shockwave (hp lost: ${lost})`);
// 1b) roll diagonally THROUGH the ring (inward + sideways, like a real dodge)
await page.evaluate(() => {
  window.__react = () => { const p = GW.player, b = GW.boss;
    const inx = -(Math.sign(p.x - b.x) || 1);
    const mx = inx * .707, my = .707;
    p.mx = mx; p.my = my; p.fx = mx; p.fy = my; p.tryRoll(GW); };
});
lost = await forcedStomp();
ok(lost === 0, `rolling through the ring escapes it (hp lost: ${lost})`);

// 2) standing still gets hit for half a heart
await page.evaluate(() => { window.__react = null; });
lost = await forcedStomp();
ok(lost === 1, `standing still is still punished (hp lost: ${lost} half-hearts)`);

// 3) punish window: no contact damage while stunned, and hits deal double
const punish = await page.evaluate(() => {
  const b = GW.boss, p = GW.player;
  b.ring = null; b.state = 'stunned'; b.t = 3; b.pose = 'stun'; b.exposed = 0;
  p.x = b.x + 1.0; p.y = b.y; p.hp = p.maxHp; p.inv = 0;
  return new Promise(res => setTimeout(() => {
    const noContact = p.hp === p.maxHp;
    const hpB = b.hp; p.fx = -1; p.fy = 0; p.attackT = 0; p.tryAttack(GW);
    res({ noContact, dmg: hpB - b.hp });
  }, 700));
});
ok(punish.noContact, 'no contact damage while boss is stunned (punish window)');
ok(punish.dmg === 2, `attacks in the punish window deal double (dealt ${punish.dmg})`);

// 4) full fight with a bot using only real player inputs (12 max HP so all 3 phases pass quickly)
await page.evaluate(() => {
  GW.boss.hp = GW.boss.maxHp = 12; GW.boss.thorns = false; GW.boss.state = 'walk'; GW.boss.t = 1;
  const p = GW.player; p.hp = p.maxHp; p.x = GW.boss.x + 3; p.y = GW.boss.y; p.inv = 0;
  window.__deaths0 = GW.deaths; window.__hold = null;
  // log every hit the player takes, with the boss state at that moment
  window.__hits = [];
  const orig = p.hurt.bind(p);
  p.hurt = (g, dmg, src) => { const r = orig(g, dmg, src);
    if (r) window.__hits.push({ dmg, boss: GW.boss && GW.boss.state, ring: !!(GW.boss && GW.boss.ring) });
    return r; };
});
const t0 = Date.now();
let result = null;
while (Date.now() - t0 < 150000) {
  result = await page.evaluate(() => {
    const g = GW, b = g.boss, p = g.player;
    if (!b || b.dead || g.state === 'dead' || g.state === 'victory')
      return { done: true, dead: b ? b.dead : false, state: g.state, deaths: g.deaths - window.__deaths0, hp: p.hp };
    const ar = (g.constructor, b.arena());
    const dx = b.x - p.x, dy = b.y - p.y, dd = Math.hypot(dx, dy) || 1;
    let mx = 0, my = 0;
    const away = () => { mx = -dx / dd; my = -dy / dd; };
    const toward = () => { mx = dx / dd; my = dy / dd; };
    // priorities
    if (b.ring) {
      const rd = Math.hypot(p.x - b.ring.x, p.y - b.ring.y) - b.ring.r;
      if (rd < 1.2 && rd > -0.5) { away(); p.mx = mx; p.my = my; p.fx = mx; p.fy = my; p.tryRoll(g); }
      else away();
    } else if (b.state === 'charging' || b.state === 'chargeTele') {
      // sidestep perpendicular to the boss direction
      mx = -dy / dd; my = dx / dd;
      if (b.state === 'charging') { p.mx = mx; p.my = my; p.fx = mx; p.fy = my; p.tryRoll(g); }
    } else if (b.state === 'slamTele' && b.target) {
      const tx = p.x - b.target.x, ty = p.y - b.target.y, td = Math.hypot(tx, ty);
      if (td > .3 && td < 2.6) { mx = tx / td; my = ty / td; }
      else if (td <= .3) away();          // target is on top of us — sprint away from the boss
    } else if (b.state === 'stunned' || b.exposed > 0) {
      if (dd > 2.3) toward();
      if (dd < 2.8) { p.fx = dx / dd; p.fy = dy / dd; p.tryAttack(g); }
    } else {
      if (dd > 2.4) toward(); else if (dd < 1.8) away();
      if (dd < 2.7) { p.fx = dx / dd; p.fy = dy / dd; p.tryAttack(g); }
    }
    // clear out barrage blobs before they swarm
    let blob = null, bd = 2.0;
    g.enemies.forEach(e => { const ed = Math.hypot(e.x - p.x, e.y - p.y); if (ed < bd) { bd = ed; blob = e; } });
    if (blob) { const ex = blob.x - p.x, ey = blob.y - p.y, ed = Math.hypot(ex, ey) || 1;
      p.fx = ex / ed; p.fy = ey / ed; p.tryAttack(g);
      if (ed < .9) { mx = -ex / ed; my = -ey / ed; } }
    // never idle inside boss contact range outside the punish window
    if (!(b.state === 'stunned' || b.exposed > 0) && dd < 1.7) away();
    // stay inside the thorn-safe arena
    const M = .6;
    if (p.x < ar[0] + M) mx = Math.max(mx, .7); if (p.x > ar[2] - M) mx = Math.min(mx, -.7);
    if (p.y < ar[1] + M) my = Math.max(my, .7); if (p.y > ar[3] - M) my = Math.min(my, -.7);
    // hand the movement to the 60fps runner (true player speed)
    const m = Math.hypot(mx, my);
    window.__hold = m > .1 ? [mx / m, my / m] : null;
    return { done: false, bhp: b.hp, php: p.hp, phase: b.phase(), state: b.state };
  });
  if (result.done) break;
  await page.waitForTimeout(50);
}
await page.evaluate(() => { window.__hold = null; });
if (!(result && result.dead)) console.log('hits taken:', JSON.stringify(await page.evaluate(() => window.__hits)));
ok(result && result.done && result.dead, `bot defeats the boss (${JSON.stringify(result)})`);
ok(result && result.deaths === 0, `without dying (deaths: ${result && result.deaths})`);
const victory = await page.waitForFunction(() => GW.state === 'victory', null, { timeout: 8000 }).then(() => true).catch(() => false);
ok(victory, 'victory screen reached');

await browser.close();
console.log(failures ? `\n${failures} FAILURES` : '\nALL PASS');
process.exit(failures ? 1 : 0);
