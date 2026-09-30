const assert = require('node:assert/strict');
const { Game, MODIFIERS } = require('../engine.js');
function fresh() { const g = new Game({ seed: 42 }); g.start(); g.enemy.aiWait = 999; return g; }
function advance(g, seconds, input = {}) { for (let i = 0; i < Math.ceil(seconds * 120); i++) g.step(1 / 120, input); }
let checks = 0;
function test(name, fn) { fn(); checks++; console.log('PASS', name); }
test('attack hits at contact and gives charge', () => {
  const g = fresh(); g.player.x = 500; g.enemy.x = 645;
  g.step(.01, { attack: true }); advance(g, .14);
  assert.equal(g.enemy.hp, 92); assert.equal(g.player.meter, 12);
  assert(g.drainEvents().some(e => e.type === 'hit' && e.damage === 8));
});
test('attack whiffs outside reach and holding does not repeat', () => {
  const g = fresh(); g.enemy.x = 1000;
  advance(g, .8, { attack: true });
  assert.equal(g.enemy.hp, 100); assert.equal(g.player.combo, 1);
  assert.equal(g.drainEvents().filter(e => e.type === 'attack' && e.source === 'player').length, 1);
});
test('buffered presses chain a three-hit combo', () => {
  const g = fresh(); g.player.x = 500; g.enemy.x = 640;
  g.step(.01, { attack: true }); advance(g, .12);
  g.step(.01, { attack: true }); advance(g, .23);
  g.step(.01, { attack: true }); advance(g, .4);
  const attacks = g.drainEvents().filter(e => e.type === 'attack' && e.source === 'player');
  assert.deepEqual(attacks.map(a => a.combo), [1, 2, 3]);
});
test('blocking prevents normal damage, rewards meter', () => {
  const g = fresh(); g.player.x = 500; g.enemy.x = 640;
  advance(g, .2, { block: true }); g._beginAttack(g.enemy, 'light');
  advance(g, .4, { block: true });
  assert.equal(g.player.hp, 100); assert(g.player.meter >= 11);
  assert(g.drainEvents().some(e => e.type === 'block' && !e.perfect));
});
test('late block produces a perfect guard and stagger', () => {
  const g = fresh(); g.player.x = 500; g.enemy.x = 640;
  g._beginAttack(g.enemy, 'light'); advance(g, .21);
  advance(g, .1, { block: true });
  assert.equal(g.player.hp, 100); assert.equal(g.player.meter, 23);
  assert(g.enemy.stun > 0); assert(g.drainEvents().some(e => e.type === 'block' && e.perfect));
});
test('full charge unleashes a special; empty charge does nothing', () => {
  const g = fresh(); g.player.x = 500; g.enemy.x = 695;
  g.step(.01, { special: true }); assert.equal(g.player.attack, null);
  g.step(.01, {}); g.player.meter = 100;
  g.step(.01, { special: true }); advance(g, .3);
  assert.equal(g.player.meter, 0); assert.equal(g.enemy.hp, 71);
});
test('jump avoids the telegraphed ground slam', () => {
  const g = fresh(); g.player.x = 500; g.enemy.x = 640;
  g._beginAttack(g.enemy, 'heavy'); advance(g, .37);
  g.step(.01, { jump: true }); advance(g, .35);
  assert(g.player.y > 90); assert.equal(g.player.hp, 100);
});
test('armored slams survive light attacks, but a full-power special interrupts', () => {
  const g = fresh(); g.player.x = 500; g.enemy.x = 640;
  g._beginAttack(g.enemy, 'heavy');
  g.step(.01, { attack: true }); advance(g, .15);
  assert.equal(g.enemy.hp, 92); assert.equal(g.enemy.attack.kind, 'heavy'); assert(g.enemy.armored);
  advance(g, .17); g.player.meter = 100; g.step(.01, { special: true }); advance(g, .21);
  assert.equal(g.enemy.attack, null); assert.equal(g.enemy.armored, false); assert.equal(g.enemy.hp, 63);
});
test('AI approaches, telegraphs, and attacks an idle player', () => {
  const g = new Game({ seed: 15 }); g.start(); advance(g, 7);
  assert(g.enemy.x < 850); assert(g.player.hp < 100);
  const events = g.drainEvents(); assert(events.some(e => e.type === 'attack' && e.source === 'enemy'));
});
test('Monokuma event occurs and coconut warnings precede impacts', () => {
  const g = fresh(); advance(g, 10);
  assert.notEqual(g.modifier.id, 'none'); assert(g.drainEvents().some(e => e.type === 'modifier'));
  g._activateModifier(MODIFIERS.find(m => m.id === 'coconuts'));
  advance(g, .7); assert(g.hazards.some(h => h.warning));
  advance(g, 1.8); assert(g.drainEvents().some(e => e.type === 'hazard-impact'));
});
test('snacks heal, low gravity changes jump, turbo increases speed', () => {
  const g = fresh(); g.player.hp = 60; g.player.x = 265;
  g._activateModifier(MODIFIERS.find(m => m.id === 'feast')); g.step(.02, {});
  assert.equal(g.player.hp, 75); assert.equal(g.player.meter, 12);
  const a = fresh(), b = fresh(); b._activateModifier(MODIFIERS.find(m => m.id === 'moonjump'));
  a.step(.01, { jump: true }); b.step(.01, { jump: true }); advance(a, .4); advance(b, .4);
  assert(b.player.y > a.player.y + 60);
  const c = fresh(); c._activateModifier(MODIFIERS.find(m => m.id === 'turbo'));
  const x = c.player.x; advance(c, .1, { right: true }); assert(c.player.x - x > 42);
});
test('pause freezes simulation and resume continues', () => {
  const g = fresh(); const before = g.snapshot(); g.togglePause(); advance(g, 2, { right: true });
  assert.equal(g.timer, before.timer); assert.equal(g.player.x, before.player.x);
  g.togglePause(); advance(g, .1, { right: true }); assert(g.player.x > before.player.x);
});
test('guard clears a buffered punch instead of replaying it on release', () => {
  const g = fresh(); g.enemy.x = 1100;
  g.step(.01, { attack: true }); g.step(.01, {}); g.step(.01, { attack: true });
  assert(g.player.queuedAttack); advance(g, .6, { block: true });
  assert.equal(g.player.action, 'block'); assert.equal(g.player.queuedAttack, false);
  advance(g, .1); assert.equal(g.player.action, 'idle');
  assert.equal(g.drainEvents().filter(e => e.type === 'attack' && e.source === 'player').length, 1);
});
test('coconut landing damages grounded fighters but misses a correctly timed jump', () => {
  const a = fresh(), b = fresh(); a._spawnCoconut(a.player.x); b._spawnCoconut(b.player.x);
  advance(a, 1.65); advance(b, 1.3); b.step(.01, { jump: true }); advance(b, .34);
  assert.equal(a.player.hp, 90); assert.equal(b.player.hp, 100); assert(b.player.y > 90);
});
test('first to two rounds wins; restart clears match; timeout ties draw', () => {
  const g = fresh(); g.enemy.hp = 0; g.step(.01, {});
  assert.equal(g.phase, 'roundover'); assert.deepEqual(g.wins, [1, 0]);
  g.nextRound(); assert.equal(g.round, 2); assert.equal(g.enemy.hp, 100);
  g.enemy.hp = 0; g.step(.01, {}); assert.equal(g.phase, 'matchover'); assert.deepEqual(g.wins, [2, 0]);
  g.restart(); assert.equal(g.phase, 'fight'); assert.equal(g.round, 1); assert.deepEqual(g.wins, [0, 0]);
  g.timer = .005; g.step(.01, {}); assert.equal(g.roundResult.winner, 'draw');
  g.togglePause(); assert.equal(g.phase, 'roundover');
  g.nextRound(); assert.equal(g.phase, 'fight'); assert.deepEqual(g.wins, [0, 0]);
  g.step(.01, { attack: true }); assert.equal(g.player.action, 'attack');
});
test('deterministic seed reproduces AI and modifiers', () => {
  const a = new Game({ seed: 21 }), b = new Game({ seed: 21 }); a.start(); b.start();
  advance(a, 12, { block: true }); advance(b, 12, { block: true });
  assert.deepEqual(a.snapshot(), b.snapshot());
});
test('seeded input stress preserves finite coordinates, health and charge bounds', () => {
  for (let seed = 0; seed < 25; seed++) {
    const g = new Game({ seed, difficulty: seed % 2 ? 'hard' : 'easy' }); g.start();
    for (let frame = 0; frame < 5000 && g.phase === 'fight'; frame++) {
      g.step(frame % 137 === 0 ? .08 : 1 / 120, {
        left: frame % 311 < 90, right: frame % 311 > 145, jump: frame % 109 === 0,
        attack: frame % 37 === 0, block: frame % 177 < 38, special: frame % 73 === 0
      });
      for (const f of [g.player, g.enemy]) {
        assert(Number.isFinite(f.x + f.y + f.hp + f.meter));
        assert(f.x >= 90 && f.x <= 1110 && f.y >= 0);
        assert(f.hp >= 0 && f.hp <= 100 && f.meter >= 0 && f.meter <= 100);
      }
    }
  }
});
console.log(`${checks} engine tests passed.`);
