/* Jabberwock Rumble — dependency-free, fixed-coordinate fighting simulation.
 * Fighters: x is center, y is height above the floor (positive = up).
 * Coconut hazards warn on the floor, then fall. Food hazards are pickups.
 * Presentation consumes drainEvents(); it never needs to modify simulation state.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.RumbleEngine = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';
  const WIDTH = 1200;
  const FLOOR = 555;
  const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
  const profiles = {
    easy: { speed: 205, wait: .62, reaction: .32, blockChance: .18, damage: .78, heavyChance: .25 },
    normal: { speed: 238, wait: .38, reaction: .21, blockChance: .34, damage: 1, heavyChance: .34 },
    hard: { speed: 270, wait: .24, reaction: .13, blockChance: .48, damage: 1.1, heavyChance: .42 }
  };
  const modifiers = [
    { id: 'moonjump', name: 'MOON JUMP!', description: 'Low gravity. Take the fight sky high!', duration: 8.5 },
    { id: 'coconuts', name: 'COCONUT CHAOS!', description: 'Watch the red circles. Jump or move away!', duration: 8.5 },
    { id: 'turbo', name: 'TURBO TIME!', description: 'Both fighters move and attack faster!', duration: 8 },
    { id: 'feast', name: 'SNACK ATTACK!', description: 'Grab the rice balls to heal and charge up!', duration: 8 }
  ];
  function fighter(id, x, face) {
    return {
      id, x, y: 0, vx: 0, vy: 0, hp: 100, maxHp: 100, meter: 0, face,
      action: 'idle', actionTime: 0, combo: 0, attackType: '', telegraph: '', armored: false,
      lastHit: -100, invulnerable: 0, stun: 0, recovery: 0, blockStartedAt: -100,
      comboWindow: 0, queuedAttack: false, attack: null, blockUntil: 0,
      aiWait: .7, aiReaction: 0, aiObservedAttack: false
    };
  }
  class Game {
    constructor(options = {}) {
      this.difficulty = profiles[options.difficulty] ? options.difficulty : 'normal';
      this.profile = profiles[this.difficulty];
      this._seed = (options.seed === undefined ? Math.floor(Math.random() * 4294967296) : options.seed) >>> 0;
      this._events = [];
      this._hazardId = 0;
      this.wins = [0, 0];
      this.round = 1;
      this.phase = 'ready';
      this._previousInput = {};
      this._setupRound();
    }
    random() {
      this._seed = (this._seed + 0x6D2B79F5) >>> 0;
      let n = this._seed;
      n = Math.imul(n ^ n >>> 15, n | 1);
      n ^= n + Math.imul(n ^ n >>> 7, n | 61);
      return ((n ^ n >>> 14) >>> 0) / 4294967296;
    }
    _setupRound() {
      this.player = fighter('player', 350, 1);
      this.enemy = fighter('enemy', 850, -1);
      this.timer = 60;
      this.time = 0;
      this.modifier = { id: 'none', name: '', description: '', remaining: 0 };
      this.hazards = [];
      this.roundResult = null;
      this._nextModifier = 6.8;
      this._lastModifier = '';
      this._coconutTimer = 0;
      this._previousInput = {};
    }
    start() {
      if (this.phase === 'ready') {
        this.phase = 'fight';
        this._emit('roundstart', { round: this.round });
      }
      return this;
    }
    restart() {
      this.wins = [0, 0];
      this.round = 1;
      this._events.length = 0;
      this._setupRound();
      this.phase = 'ready';
      return this.start();
    }
    nextRound() {
      if (this.phase !== 'roundover') return this;
      this.round += 1;
      this._setupRound();
      this.phase = 'fight';
      this._emit('roundstart', { round: this.round });
      return this;
    }
    togglePause() {
      if (this.phase === 'fight') this.phase = 'paused';
      else if (this.phase === 'paused') {
        this.phase = 'fight';
        this._previousInput = {};
      }
      return this.phase;
    }
    _emit(type, data = {}) { this._events.push({ type, time: this.time, ...data }); }
    drainEvents() { const events = this._events; this._events = []; return events; }
    snapshot() {
      return JSON.parse(JSON.stringify({
        phase: this.phase, player: this.player, enemy: this.enemy, timer: this.timer,
        round: this.round, wins: this.wins, modifier: this.modifier,
        hazards: this.hazards, roundResult: this.roundResult, time: this.time
      }));
    }
    step(dt, input = {}) {
      if (this.phase !== 'fight' || !Number.isFinite(dt) || dt <= 0) return;
      // Clamp tab-resume gaps, but substep normal slow frames for reliable hits.
      let remaining = Math.min(dt, .1);
      const held = {};
      const pressed = {};
      for (const key of ['left', 'right', 'jump', 'attack', 'block', 'special']) {
        held[key] = !!input[key];
        pressed[key] = held[key] && !this._previousInput[key];
      }
      this._previousInput = held;
      while (remaining > .000001 && this.phase === 'fight') {
        const slice = Math.min(remaining, 1 / 120);
        this._tick(slice, held, pressed);
        remaining -= slice;
        for (const key in pressed) pressed[key] = false;
      }
    }
    _tick(dt, held, pressed) {
      this.time += dt;
      this.timer = Math.max(0, this.timer - dt);
      const p = this.player, e = this.enemy;
      for (const f of [p, e]) {
        f.actionTime += dt;
        f.invulnerable = Math.max(0, f.invulnerable - dt);
        f.stun = Math.max(0, f.stun - dt);
        f.recovery = Math.max(0, f.recovery - dt);
        f.comboWindow = Math.max(0, f.comboWindow - dt);
        if (!f.attack && f.stun === 0 && f.hp > 0) f.face = (f === p ? e.x - p.x : p.x - e.x) >= 0 ? 1 : -1;
        if (f.stun > 0) this._setAction(f, 'hurt');
        else if (f.action === 'hurt') this._setAction(f, f.y > 0 ? 'jump' : 'idle');
      }
      this._playerControls(held, pressed);
      this._enemyControls(dt);
      this._advanceAttack(p, e, dt);
      this._advanceAttack(e, p, dt);
      this._physics(p, dt);
      this._physics(e, dt);
      this._separateFighters();
      this._updateModifiers(dt);
      this._updateHazards(dt);
      this._checkRound();
    }
    _setAction(f, action) {
      if (f.action !== action) { f.action = action; f.actionTime = 0; }
    }
    _canAct(f) { return f.hp > 0 && !f.attack && f.stun <= 0 && f.recovery <= 0; }
    _playerControls(held, pressed) {
      const p = this.player;
      if (pressed.attack && p.attack && p.attack.kind === 'light') p.queuedAttack = true;
      if (!this._canAct(p)) { p.vx *= .82; return; }
      if (pressed.special && p.meter >= 100) {
        this._beginAttack(p, 'special');
        return;
      }
      if (held.block && p.y <= .1) {
        p.queuedAttack = false;
        if (p.action !== 'block') p.blockStartedAt = this.time;
        this._setAction(p, 'block');
        p.vx = 0;
        return;
      }
      if (p.action === 'block') this._setAction(p, 'idle');
      if (pressed.jump && p.y <= .1) {
        p.vy = 690;
        p.y = .1;
        this._setAction(p, 'jump');
        this._emit('jump', { source: p.id, x: p.x, y: p.y });
      }
      if (pressed.attack || p.queuedAttack) {
        p.queuedAttack = false;
        this._beginAttack(p, 'light');
      } else {
        p.vx = ((held.right ? 1 : 0) - (held.left ? 1 : 0)) * 335 * this._speedMultiplier();
        this._setAction(p, p.y > 0 ? 'jump' : p.vx ? 'walk' : 'idle');
      }
    }
    _enemyControls(dt) {
      const e = this.enemy, p = this.player, profile = this.profile;
      e.aiWait -= dt;
      if (!this._canAct(e)) { e.vx *= .85; return; }
      const distance = Math.abs(p.x - e.x);
      const incoming = p.attack && distance < 230;
      if (incoming && !e.aiObservedAttack) {
        e.aiObservedAttack = true;
        e.aiReaction = profile.reaction + this.random() * .15;
      } else if (!incoming) e.aiObservedAttack = false;
      if (incoming && e.aiReaction > 0) {
        e.aiReaction -= dt;
        if (e.aiReaction <= 0 && this.random() < profile.blockChance) e.blockUntil = this.time + .35 + this.random() * .25;
      }
      if (e.blockUntil > this.time && e.y <= 0) {
        if (e.action !== 'block') e.blockStartedAt = this.time - .2; // AI never gets free frame-perfect parries.
        this._setAction(e, 'block');
        e.vx = 0;
        return;
      }
      if (e.action === 'block') this._setAction(e, 'idle');
      // Take a step away from an imminent coconut when there is room.
      const danger = this.hazards.find(h => h.kind === 'coconut' && h.warning && h.warningRemaining < .6 && Math.abs(h.x - e.x) < 80);
      if (danger && this.difficulty !== 'easy') {
        const away = e.x > danger.x ? 1 : -1;
        e.vx = away * profile.speed * this._speedMultiplier();
        this._setAction(e, 'walk');
        return;
      }
      if (distance > 155) {
        e.vx = e.face * profile.speed * this._speedMultiplier();
        this._setAction(e, e.y > 0 ? 'jump' : 'walk');
      } else if (distance < 112 && e.aiWait > .1) {
        e.vx = -e.face * profile.speed * .4;
        this._setAction(e, 'walk');
      } else {
        e.vx = 0;
        this._setAction(e, e.y > 0 ? 'jump' : 'idle');
      }
      if (distance < 202 && e.aiWait <= 0 && e.y <= 0 && p.hp > 0) {
        const kind = e.meter >= 100 ? 'special' : this.random() < profile.heavyChance ? 'heavy' : 'light';
        this._beginAttack(e, kind);
        e.aiWait = profile.wait + this.random() * .48;
      }
    }
    _beginAttack(f, kind) {
      if (!this._canAct(f)) return false;
      const isPlayer = f.id === 'player';
      const combo = kind === 'light' && isPlayer ? (f.comboWindow > 0 ? f.combo % 3 + 1 : 1) : 1;
      f.combo = combo;
      f.comboWindow = 1.08;
      f.attackType = kind;
      f.telegraph = '';
      let attack;
      if (kind === 'special') {
        if (f.meter < 100) return false;
        f.meter = 0;
        attack = { kind, elapsed: 0, startup: isPlayer ? .19 : .85, active: .2, duration: isPlayer ? .63 : 1.25, damage: isPlayer ? 29 : 25, range: isPlayer ? 245 : 255, knock: 480, hit: false, combo };
        f.telegraph = isPlayer ? 'FULL POWER!' : 'BIG SLAM — JUMP!';
        this._emit('special', { source: f.id, x: f.x, y: f.y });
      } else if (kind === 'heavy') {
        attack = { kind, elapsed: 0, startup: .68, active: .16, duration: 1.12, damage: 18, range: 210, knock: 390, hit: false, combo };
        f.telegraph = 'SLAM — JUMP OR BLOCK!';
        this._emit('windup', { source: f.id, x: f.x, y: f.y, heavy: true });
      } else {
        attack = { kind, elapsed: 0, startup: isPlayer ? .09 : .28, active: .13, duration: isPlayer ? (combo === 3 ? .46 : .31) : .59, damage: isPlayer ? [8, 10, 14][combo - 1] : 10, range: isPlayer ? [168, 176, 190][combo - 1] : 178, knock: isPlayer && combo === 3 ? 290 : 140, hit: false, combo };
      }
      f.attack = attack;
      // Slow, clearly signalled slams cannot be cancelled by mashing light hits.
      f.armored = !isPlayer && kind !== 'light';
      f.vx = isPlayer && kind === 'special' ? f.face * 510 : 0;
      this._setAction(f, !isPlayer && kind !== 'light' ? 'windup' : kind === 'special' ? 'special' : 'attack');
      this._emit('attack', { source: f.id, x: f.x, y: f.y, combo, heavy: kind !== 'light', kind });
      return true;
    }
    _advanceAttack(f, target, dt) {
      const a = f.attack;
      if (!a) return;
      a.elapsed += dt * (this.modifier.id === 'turbo' ? 1.18 : 1);
      if (a.elapsed >= a.startup && f.action === 'windup') {
        this._setAction(f, a.kind === 'special' ? 'special' : 'attack');
        f.telegraph = '';
      }
      if (f.id === 'player' && a.kind === 'special' && a.elapsed < a.startup + a.active) f.vx = f.face * 510;
      const dx = target.x - f.x;
      const inFront = dx * f.face > -35;
      const verticalReach = a.kind !== 'light' && f.id === 'enemy' ? target.y < 92 : Math.abs(target.y - f.y) < 147;
      if (!a.hit && a.elapsed >= a.startup && a.elapsed <= a.startup + a.active && Math.abs(dx) <= a.range && inFront && verticalReach) {
        a.hit = true;
        this._strike(f, target, a);
      }
      // A parry may have cancelled this very attack.
      if (f.attack && a.elapsed >= a.duration) {
        f.attack = null;
        f.armored = false;
        f.attackType = '';
        f.telegraph = '';
        f.vx = 0;
        f.recovery = f.id === 'enemy' ? .12 : (a.combo === 3 ? .11 : 0);
        this._setAction(f, f.y > 0 ? 'jump' : 'idle');
      }
    }
    _strike(source, target, attack) {
      if (target.hp <= 0 || target.invulnerable > 0) return;
      const blocked = target.action === 'block' && target.y <= 0 && (source.x - target.x) * target.face >= -35;
      if (blocked) {
        const perfect = this.time - target.blockStartedAt <= .18;
        const chip = !perfect && attack.kind === 'special' ? 3 : 0;
        target.hp = Math.max(1, target.hp - chip);
        target.meter = clamp(target.meter + (perfect ? 23 : 11), 0, 100);
        source.meter = clamp(source.meter + 4, 0, 100);
        target.vx = source.face * (perfect ? 35 : 105);
        target.invulnerable = .08;
        if (perfect) {
          source.attack = null;
          source.armored = false;
          source.stun = .32;
          source.queuedAttack = false;
          source.telegraph = '';
          source.attackType = '';
          this._setAction(source, 'hurt');
        }
        this._emit('block', { source: source.id, target: target.id, x: target.x, y: target.y + 105, perfect });
        this._emit('hit', { source: source.id, target: target.id, x: target.x, y: target.y + 105, damage: chip, heavy: attack.kind !== 'light', blocked: true, perfect });
        return;
      }
      const damage = Math.round(attack.damage * (source.id === 'enemy' ? this.profile.damage : 1));
      const armor = target.armored && target.attack && attack.kind === 'light';
      this._damage(target, damage, source.face * attack.knock, attack.kind === 'light' ? .2 : .35, armor);
      if (target.id === 'enemy' && !armor && target.hp > 0 && this.random() < this.profile.blockChance + .15) {
        target.blockUntil = this.time + target.stun + .4;
      }
      source.meter = clamp(source.meter + (attack.kind === 'special' ? 0 : 12), 0, 100);
      target.meter = clamp(target.meter + 8, 0, 100);
      this._emit('hit', { source: source.id, target: target.id, x: target.x, y: target.y + 105, damage, heavy: attack.kind !== 'light' || attack.combo === 3, blocked: false, armored: !!armor, combo: attack.combo });
    }
    _damage(target, damage, knock, stun, armor = false) {
      target.hp = Math.max(0, target.hp - damage);
      target.lastHit = this.time;
      if (armor && target.hp > 0) {
        target.invulnerable = .12;
        return;
      }
      target.stun = stun;
      target.invulnerable = .12;
      target.vx = knock;
      target.attack = null;
      target.armored = false;
      target.attackType = '';
      target.telegraph = '';
      target.queuedAttack = false;
      this._setAction(target, target.hp <= 0 ? 'ko' : 'hurt');
      if (target.hp <= 0) target.vy = 260;
    }
    _speedMultiplier() { return this.modifier.id === 'turbo' ? 1.38 : 1; }
    _physics(f, dt) {
      f.x = clamp(f.x + f.vx * dt, 90, 1110);
      if (f.y > 0 || f.vy > 0) {
        f.vy -= (this.modifier.id === 'moonjump' ? 820 : 1800) * dt;
        f.y = Math.max(0, f.y + f.vy * dt);
        if (f.y === 0) {
          f.vy = 0;
          if (f.action === 'jump') this._setAction(f, 'idle');
        }
      }
      if (f.stun > 0) f.vx *= Math.pow(.03, dt);
    }
    _separateFighters() {
      const p = this.player, e = this.enemy;
      if (Math.abs(p.y - e.y) > 115 || p.hp <= 0 || e.hp <= 0) return;
      const dx = e.x - p.x;
      if (Math.abs(dx) < 116) {
        const side = dx >= 0 ? 1 : -1;
        const push = (116 - Math.abs(dx)) / 2;
        p.x = clamp(p.x - side * push, 90, 1110);
        e.x = clamp(e.x + side * push, 90, 1110);
      }
    }
    _updateModifiers(dt) {
      if (this.modifier.remaining > 0) {
        this.modifier.remaining = Math.max(0, this.modifier.remaining - dt);
        if (this.modifier.id === 'coconuts') {
          this._coconutTimer -= dt;
          if (this._coconutTimer <= 0) {
            this._coconutTimer = 1.22;
            this._spawnCoconut(this.random() < .55 ? clamp(this.player.x + (this.random() - .5) * 110, 110, 1090) : 130 + this.random() * 940);
          }
        }
        if (this.modifier.remaining === 0) {
          this._emit('modifier-end', { id: this.modifier.id });
          this.modifier = { id: 'none', name: '', description: '', remaining: 0 };
        }
      }
      if (this.time >= this._nextModifier && this.modifier.id === 'none') {
        this._nextModifier = this.time + 13.5;
        const available = modifiers.filter(m => m.id !== this._lastModifier);
        this._activateModifier(available[Math.floor(this.random() * available.length)]);
      }
    }
    _activateModifier(template) {
      this._lastModifier = template.id;
      this.modifier = { id: template.id, name: template.name, description: template.description, remaining: template.duration };
      this._emit('modifier', { ...this.modifier });
      if (template.id === 'coconuts') this._coconutTimer = .65;
      if (template.id === 'feast') {
        for (const x of [265, 600, 935]) this.hazards.push({ id: ++this._hazardId, kind: 'food', x, y: 24, radius: 32, warning: false, life: 8 });
      }
    }
    _spawnCoconut(x) {
      const hazard = { id: ++this._hazardId, kind: 'coconut', x, y: 550, radius: 49, warning: true, warningRemaining: 1.1, life: 3.1, impacted: false, hitTargets: [] };
      this.hazards.push(hazard);
      this._emit('hazard-warning', { x, y: 0, radius: hazard.radius, kind: 'coconut' });
    }
    _updateHazards(dt) {
      for (const hazard of this.hazards) {
        hazard.life -= dt;
        if (hazard.kind === 'food') {
          const f = [this.player, this.enemy].find(f => f.hp > 0 && Math.abs(f.x - hazard.x) < 55 && f.y < 95);
          if (f) {
            const healing = Math.min(15, 100 - f.hp);
            f.hp += healing;
            f.meter = clamp(f.meter + 12, 0, 100);
            hazard.life = 0;
            this._emit('heal', { target: f.id, x: f.x, y: f.y + 140, amount: healing });
          }
          continue;
        }
        if (hazard.warning) {
          hazard.warningRemaining = Math.max(0, hazard.warningRemaining - dt);
          if (hazard.warningRemaining <= 0) hazard.warning = false;
          continue;
        }
        if (!hazard.impacted) {
          hazard.y = Math.max(0, hazard.y - 1060 * dt);
          // Falling coconuts only damage on landing: the floor warning is trustworthy.
          if (hazard.y === 0) {
            hazard.impacted = true;
            hazard.life = .35;
            this._emit('hazard-impact', { x: hazard.x, y: 0, radius: hazard.radius, kind: 'coconut' });
            for (const f of [this.player, this.enemy]) {
              if (f.hp > 0 && f.y < 90 && Math.abs(f.x - hazard.x) < hazard.radius + 30 && f.invulnerable <= 0) {
                const blocked = f.action === 'block';
                this._damage(f, blocked ? 3 : 10, (f.x >= hazard.x ? 1 : -1) * 150, .24);
                f.meter = clamp(f.meter + 8, 0, 100);
                hazard.hitTargets.push(f.id);
                this._emit('hit', { source: 'monokuma', target: f.id, x: f.x, y: f.y + 105, damage: blocked ? 3 : 10, heavy: false, blocked });
              }
            }
          }
        }
      }
      this.hazards = this.hazards.filter(h => h.life > 0);
    }
    _checkRound() {
      if (this.player.hp > 0 && this.enemy.hp > 0 && this.timer > 0) return;
      const p = this.player, e = this.enemy;
      const winner = p.hp === e.hp ? 'draw' : p.hp > e.hp ? 'player' : 'enemy';
      const reason = this.timer <= 0 ? 'time' : 'ko';
      if (winner === 'player') this.wins[0]++;
      if (winner === 'enemy') this.wins[1]++;
      this.roundResult = { winner, reason };
      if (p.hp <= 0) this._setAction(p, 'ko');
      if (e.hp <= 0) this._setAction(e, 'ko');
      p.vx = e.vx = 0;
      this.phase = this.wins.some(w => w >= 2) ? 'matchover' : 'roundover';
      this._emit('roundover', { winner, reason, wins: [...this.wins], round: this.round });
      if (this.phase === 'matchover') this._emit('matchover', { winner, wins: [...this.wins] });
    }
  }
  return { Game, WIDTH, FLOOR, MODIFIERS: modifiers.map(m => ({ ...m })) };
});
