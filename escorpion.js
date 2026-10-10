// Escorpión procedural: cinemática inversa en un <canvas id="escorpion">
"use strict";
(() => {
  const canvas = document.getElementById("escorpion");
  if (!canvas) return;

  let W = 800, H = 560;
  const DT = 1000 / 60;
  const LUZ = [-0.55, -0.83]; // la luz viene de arriba a la izquierda

  // colores de día y colores bajo luz ultravioleta (de noche)
  const DIA = {
    contorno: [52, 30, 14],
    cuerpo: [178, 110, 45],
    pata: [188, 128, 58],
    pinza: [172, 104, 42],
    cola: [190, 120, 50],
    telson: [214, 150, 72],
    aguijon: [45, 22, 12],
  };
  const UV = {
    contorno: [8, 45, 45],
    cuerpo: [50, 200, 175],
    pata: [70, 220, 190],
    pinza: [45, 190, 165],
    cola: [65, 210, 180],
    telson: [130, 255, 225],
    aguijon: [15, 70, 65],
  };
  const ARENA = [201, 170, 124];
  const P = { ...DIA }; // paleta actual (mezcla de día y noche)

  // pitch de cada segmento de la cola (ángulo hacia arriba): reposo, carga y picotazo
  const COLA_REPOSO = [0.5, 1.0, 1.6, 2.25, 2.75, 3.05];
  const COLA_CARGA = [0.4, 0.85, 1.35, 1.9, 2.4, 2.75];
  const COLA_PICA = [0.7, 1.3, 1.95, 2.6, 3.1, 3.5];

  let shadowPass = false; // true = dibuja solo la silueta negra para la sombra

  const rgb = (c, a = 1) => (shadowPass ? "#000" : `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`);
  const lighten = (c, f) => c.map((v) => v + (255 - v) * f);
  const darken = (c, f) => c.map((v) => v * (1 - f));
  const mix = (a, b, f) => a.map((v, i) => v + (b[i] - v) * f);
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const ease = (k) => k * k * (3 - 2 * k);
  const wrap = (a) => {
    const t = 2 * Math.PI;
    return (((a + Math.PI) % t) + t) % t - Math.PI;
  };
  // en la pasada de sombra, lo que está más alto (z) proyecta la sombra más lejos
  const sp = (x, y, z) => (shadowPass ? [x + z * 0.6, y + z * 0.85] : [x, y]);
  const persp = (z) => 1 + z / 220;

  // ---------- física ----------

  class Node {
    constructor(x = 0, y = 0) {
      this.x = x;
      this.y = y;
      this.absAngle = 0;
      this.angle = 0;
      this.size = 0;
      this.parent = null;
      this.children = [];
      this.isSegment = false;
    }

    updateRelative(updateChildren, updateSelf) {
      if (updateChildren) {
        for (const child of this.children) child.updateRelative(true, true);
      }
    }
  }

  class Segment extends Node {
    constructor(parent, size, angle, angleRange = Math.PI, stiffness = 0) {
      super();
      this.parent = parent;
      parent.children.push(this);
      this.size = size;
      this.angle = angle;
      this.baseAngle = angle;
      this.angleRange = angleRange;
      this.stiffness = stiffness;
      this.isSegment = true;
      this.updateRelative(false, true);
    }

    updateRelative(updateChildren, updateSelf) {
      if (updateSelf) {
        this.absAngle = this.parent.absAngle + this.angle;
        this.x = this.parent.x + this.size * Math.cos(this.absAngle);
        this.y = this.parent.y + this.size * Math.sin(this.absAngle);
      }
      super.updateRelative(updateChildren, false);
    }

    follow() {
      const ang = Math.atan2(this.y - this.parent.y, this.x - this.parent.x);
      let offset = wrap(ang - this.parent.absAngle - this.baseAngle);
      offset = clamp(offset, -this.angleRange, this.angleRange) * (1 - this.stiffness);
      this.angle = this.baseAngle + offset;
      this.updateRelative(false, true);
    }
  }

  class Creature extends Node {
    constructor(x, y, maxSpeed, accel, turnSpeed) {
      super(x, y);
      this.systems = [];
      this.speed = 0;
      this.maxSpeed = maxSpeed;
      this.accel = accel;
      this.turnSpeed = turnSpeed;
    }

    followMouse(mx, my, stopDist = 60) {
      const dx = mx - this.x, dy = my - this.y;
      if (Math.hypot(dx, dy) > stopDist) {
        const diff = wrap(Math.atan2(dy, dx) - this.absAngle);
        this.absAngle += clamp(diff, -this.turnSpeed, this.turnSpeed);
        const top = this.maxSpeed * Math.max(0.25, Math.cos(diff));
        this.speed = Math.min(top, this.speed + this.accel);
      } else {
        this.speed *= 0.85;
      }
      this.x += Math.cos(this.absAngle) * this.speed;
      this.y += Math.sin(this.absAngle) * this.speed;
    }
  }

  class LimbSystem {
    constructor(end, length, speed, creature) {
      this.end = end;
      this.length = Math.max(1, length);
      this.creature = creature;
      this.speed = speed;
      creature.systems.push(this);

      this.nodes = [];
      let node = end;
      for (let i = 0; i < length; i++) {
        this.nodes.unshift(node);
        node = node.parent;
        if (!node.isSegment) {
          this.length = i + 1;
          break;
        }
      }
      this.hip = this.nodes[0].parent;
    }

    moveTo(x, y) {
      this.nodes[0].updateRelative(true, true);
      const dist = Math.hypot(x - this.end.x, y - this.end.y);
      let len = Math.max(0, dist - this.speed);
      for (let i = this.nodes.length - 1; i >= 0; i--) {
        const node = this.nodes[i];
        const ang = Math.atan2(node.y - y, node.x - x);
        node.x = x + len * Math.cos(ang);
        node.y = y + len * Math.sin(ang);
        x = node.x;
        y = node.y;
        len = node.size;
      }
      for (const node of this.nodes) {
        const parent = node.parent;
        node.absAngle = Math.atan2(node.y - parent.y, node.x - parent.x);
        node.angle = node.absAngle - parent.absAngle;
        node.updateRelative(false, true);
      }
    }

    update(mouseX, mouseY) {
      this.moveTo(mouseX, mouseY);
    }
  }

  // Pata que se queda apoyada en el suelo y da un paso cuando el cuerpo se aleja
  class LegSystem extends LimbSystem {
    constructor(end, length, speed, creature, side, tilt, reach, step, group) {
      super(end, length, speed, creature);
      this.side = side;
      this.tilt = tilt;
      this.reach = reach;
      this.step = step;
      this.group = group;
      [this.thigh, this.shin] = this.nodes;
      this.maxReach = 0.9 * (this.thigh.size + this.shin.size);
      const h = this.hip, k = this.thigh, f = this.shin;
      const cross = (f.x - h.x) * (k.y - h.y) - (f.y - h.y) * (k.x - h.x);
      this.bend = cross > 0 ? 1 : -1;

      this.footX = this.startX = this.goalX = end.x;
      this.footY = this.startY = this.goalY = end.y;
      this.progress = 1;
      this.duration = 10;
    }

    get stepping() {
      return this.progress < 1;
    }

    // altura del pie mientras da el paso
    get lift() {
      return this.stepping ? Math.sin(Math.PI * this.progress) * 8 : 0;
    }

    ideal() {
      const ang = this.hip.absAngle + this.side * (Math.PI / 2 + this.tilt);
      return [this.hip.x + this.reach * Math.cos(ang), this.hip.y + this.reach * Math.sin(ang)];
    }

    startStep(ix, iy) {
      const c = this.creature;
      const ratio = c.speed / c.maxSpeed;
      const ahead = this.step * 0.7 * ratio;
      let gx = ix + Math.cos(c.absAngle) * ahead;
      let gy = iy + Math.sin(c.absAngle) * ahead;
      const dx = gx - this.hip.x, dy = gy - this.hip.y;
      const d = Math.hypot(dx, dy);
      if (d > this.maxReach) {
        gx = this.hip.x + (dx / d) * this.maxReach;
        gy = this.hip.y + (dy / d) * this.maxReach;
      }
      this.startX = this.footX;
      this.startY = this.footY;
      this.goalX = gx;
      this.goalY = gy;
      this.duration = Math.round(13 - 5 * ratio);
      this.progress = 0;
    }

    // IK de 2 huesos: calcula la rodilla exacta para que el pie llegue a (fx, fy)
    solveIK(fx, fy) {
      const h = this.hip;
      const l1 = this.thigh.size, l2 = this.shin.size;
      const dx = fx - h.x, dy = fy - h.y;
      const d = clamp(Math.hypot(dx, dy), Math.abs(l1 - l2) + 0.01, l1 + l2 - 0.01);
      const base = Math.atan2(dy, dx);
      const cosA = clamp((l1 * l1 + d * d - l2 * l2) / (2 * l1 * d), -1, 1);
      const thighAbs = base + this.bend * Math.acos(cosA);
      const kx = h.x + l1 * Math.cos(thighAbs);
      const ky = h.y + l1 * Math.sin(thighAbs);
      const shinAbs = Math.atan2(fy - ky, fx - kx);
      this.thigh.angle = thighAbs - h.absAngle;
      this.shin.angle = shinAbs - thighAbs;
      this.thigh.updateRelative(false, true);
      this.shin.updateRelative(false, true);
    }

    update() {
      const [ix, iy] = this.ideal();
      const dist = Math.hypot(ix - this.footX, iy - this.footY);
      if (!this.stepping && dist > this.step) {
        const busy = this.creature.systems.some(
          (leg) => leg instanceof LegSystem && leg.group !== this.group &&
                   leg.stepping && leg.progress < 0.5
        );
        if (!busy || dist > this.step * 1.5) this.startStep(ix, iy);
      }
      if (this.stepping) {
        this.progress = Math.min(1, this.progress + 1 / this.duration);
        const e = ease(this.progress);
        this.footX = this.startX + (this.goalX - this.startX) * e;
        this.footY = this.startY + (this.goalY - this.startY) * e;
      }
      this.solveIK(this.footX, this.footY);
    }
  }

  // ---------- presas ----------

  class Bug {
    constructor(x, y) {
      this.x = x;
      this.y = y;
      this.a = Math.random() * Math.PI * 2;
      this.speed = 0.6;
      this.turn = 0;
      this.phase = Math.random() * 6;
      this.caught = false;
      this.size = 1;
      this.color = Math.random() < 0.5 ? [62, 44, 30] : [86, 96, 44]; // escarabajo o grillo
    }

    update(head) {
      if (this.caught) return;
      const dx = this.x - head.x, dy = this.y - head.y;
      let target;
      if (Math.hypot(dx, dy) < 120) {
        // huye del escorpión
        target = Math.atan2(dy, dx);
        this.speed += (1.7 - this.speed) * 0.1;
      } else {
        if (Math.random() < 0.02) this.turn = (Math.random() - 0.5) * 0.08;
        target = this.a + this.turn;
        this.speed += (0.6 - this.speed) * 0.05;
      }
      const m = 25;
      if (this.x < m) target = 0;
      else if (this.x > W - m) target = Math.PI;
      if (this.y < m) target = Math.PI / 2;
      else if (this.y > H - m) target = -Math.PI / 2;
      this.a += clamp(wrap(target - this.a), -0.15, 0.15);
      this.x = clamp(this.x + Math.cos(this.a) * this.speed, 5, W - 5);
      this.y = clamp(this.y + Math.sin(this.a) * this.speed, 5, H - 5);
      this.phase += this.speed * 0.5;
    }

    draw(g, night) {
      const s = this.size;
      if (s < 0.05) return;
      g.save();
      if (shadowPass) g.translate(1.8, 2.5);
      const a = this.a, ca = Math.cos(a), sa = Math.sin(a), px = -sa, py = ca;
      const col = mix(this.color, [22, 26, 40], night * 0.7);
      const dark = darken(col, 0.55);
      // patas
      for (const side of [-1, 1]) {
        for (let k = 0; k < 3; k++) {
          const f = (k - 1) * 3.2 * s;
          const bx = this.x + ca * f, by = this.y + sa * f;
          const swing = Math.sin(this.phase + k * 2 + (side > 0 ? Math.PI : 0)) * 0.35;
          const la = a + side * (1.25 + (1 - k) * 0.45) + swing;
          line(g, dark, [bx, by], [bx + 7 * s * Math.cos(la), by + 7 * s * Math.sin(la)], 1);
        }
      }
      // antenas
      for (const side of [-1, 1]) {
        const hx = this.x + ca * 6 * s, hy = this.y + sa * 6 * s;
        const la = a + side * 0.45;
        line(g, dark, [hx, hy], [hx + 8 * s * Math.cos(la), hy + 8 * s * Math.sin(la)], 0.8);
      }
      // cuerpo
      oval(g, dark, this.x - ca * 1.5 * s, this.y - sa * 1.5 * s, a, 6.4 * s, 4.6 * s);
      oval(g, col, this.x - ca * 1.5 * s, this.y - sa * 1.5 * s, a, 5.5 * s, 3.8 * s);
      line(g, dark, [this.x - ca * 6 * s, this.y - sa * 6 * s], [this.x + ca * 2.5 * s, this.y + sa * 2.5 * s], 0.7);
      oval(g, dark, this.x + ca * 4.5 * s, this.y + sa * 4.5 * s, a, 2.6 * s, 2.4 * s);
      circle(g, lighten(col, 0.45), this.x - ca * 2 * s + px * 1.6 * s + LUZ[0],
             this.y - sa * 2 * s + py * 1.6 * s + LUZ[1], 1.2 * s);
      g.restore();
    }
  }

  // ---------- escorpión ----------

  class Scorpion {
    constructor(x, y) {
      this.head = new Creature(x, y, 3.0, 0.15, 0.06);

      this.body = [];
      this.bodyRadius = [15, 18, 19, 19, 17, 14];
      let parent = this.head;
      this.bodyRadius.forEach((_, i) => {
        const seg = new Segment(parent, i === 0 ? 18 : 13, i === 0 ? Math.PI : 0, 0.25);
        this.body.push(seg);
        parent = seg;
      });

      this.legs = [];
      [0.8, 0.3, -0.15, -0.55].forEach((tilt, i) => {
        const hip = this.body[i];
        for (const side of [-1, 1]) {
          const thigh = new Segment(hip, 30, side * (Math.PI / 2 + tilt));
          const shin = new Segment(thigh, 34, -side * 0.7);
          const group = (i + (side > 0 ? 1 : 0)) % 2;
          this.legs.push(new LegSystem(shin, 2, 8, this.head, side, tilt, 44, 20, group));
        }
      });

      this.claws = [];
      for (const side of [-1, 1]) {
        const arm = new Segment(this.head, 30, side * 0.85);
        const forearm = new Segment(arm, 28, -side * 1.05);
        this.claws.push([side, arm, forearm]);
      }

      // cola: cada segmento tiene una dirección (yaw) que sigue al cuerpo con un poco de
      // retraso, y una altura (pitch) para que se arquee por encima del cuerpo
      this.tailSize = 16;
      const back = this.body[this.body.length - 1].absAngle;
      this.tailYaw = [back, back, back, back, back, back];  // se corrige en el primer update
      this.pitch = COLA_REPOSO.slice();
      this.tailPts = [];

      this.pinch = 0;
      this.stingT = -1;
      this.prey = null;
      this.eatT = 0;
      this.eaten = 0;
      this.footprints = [];
      this.particles = [];
      this.clawX = x;
      this.clawY = y;
      this.computeTail();
    }

    // dirección media de la parte trasera del cuerpo (de la placa 2 a la última)
    backAxis() {
      const a = this.body[2], b = this.body[this.body.length - 1];
      return Math.atan2(b.y - a.y, b.x - a.x);
    }

    sting() {
      if (this.stingT < 0) this.stingT = 0;
    }

    computeTail() {
      const base = this.body[this.body.length - 1];
      let x = base.x, y = base.y, z = 7;
      this.tailPts = [{ x, y, z, yaw: base.absAngle, pitch: 0 }];
      this.tailYaw.forEach((yaw, i) => {
        const p = this.pitch[i];
        const hl = this.tailSize * Math.cos(p);
        x += Math.cos(yaw) * hl;
        y += Math.sin(yaw) * hl;
        z = Math.max(1, z + this.tailSize * Math.sin(p));
        this.tailPts.push({ x, y, z, yaw, pitch: p });
      });
    }

    update(mx, my, t, clicking, bugs, hunting) {
      // comiendo: se queda quieto
      if (this.prey) this.head.followMouse(this.head.x, this.head.y);
      else this.head.followMouse(mx, my, hunting ? 30 : 60);

      for (const seg of this.body) seg.follow();
      for (const [, arm, forearm] of this.claws) {
        arm.updateRelative(false, true);
        forearm.updateRelative(false, true);
      }
      // la cola usa el eje de la parte trasera del cuerpo (no solo la última placa),
      // así cuando el cuerpo se curva en un giro la cola sigue quedando encima de él;
      // cada segmento gira hacia el anterior sin pasarse de 0,1 rad
      let prev = this.backAxis();
      for (let i = 0; i < this.tailYaw.length; i++) {
        const target = prev + 0.06 * Math.sin(t * 2 - i * 0.6);
        let yaw = this.tailYaw[i] + wrap(target - this.tailYaw[i]) * 0.55;
        yaw = prev + clamp(wrap(yaw - prev), -0.1, 0.1);
        this.tailYaw[i] = yaw;
        prev = yaw;
      }

      // cola: reposo, o animación del picotazo (carga → pica → vuelve)
      const s = this.stingT;
      for (let i = 0; i < 6; i++) {
        let p = COLA_REPOSO[i];
        if (s >= 0) {
          if (s < 0.45) p = COLA_REPOSO[i] + (COLA_CARGA[i] - COLA_REPOSO[i]) * ease(s / 0.45);
          else if (s < 0.6) {
            const k = (s - 0.45) / 0.15;
            p = COLA_CARGA[i] + (COLA_PICA[i] - COLA_CARGA[i]) * (1 - (1 - k) * (1 - k));
          } else p = COLA_PICA[i] + (COLA_REPOSO[i] - COLA_PICA[i]) * ease((s - 0.6) / 0.4);
        }
        this.pitch[i] = p + 0.05 * Math.sin(t * 1.5 + i * 0.4);
      }
      if (s >= 0) {
        this.stingT += 1 / (60 * 0.55);
        if (this.stingT >= 1) this.stingT = -1;
      }
      this.computeTail();

      const was = this.legs.map((l) => l.stepping);
      for (const system of this.head.systems) system.update(mx, my);
      this.legs.forEach((leg, i) => {
        if (was[i] && !leg.stepping) {
          this.footprints.push([leg.goalX, leg.goalY, 1]);
          this.dust(leg.goalX, leg.goalY, 3, [232, 212, 172]);
        }
      });
      for (const fp of this.footprints) fp[2] -= 1 / (60 * 5);
      this.footprints = this.footprints.filter((fp) => fp[2] > 0);

      // centro de las pinzas
      const hands = this.claws.map(([, , f]) => [f.x + Math.cos(f.absAngle) * 14, f.y + Math.sin(f.absAngle) * 14]);
      this.clawX = (hands[0][0] + hands[1][0]) / 2;
      this.clawY = (hands[0][1] + hands[1][1]) / 2;

      // cazar: si una presa entra en las pinzas, la atrapa, la pica y se la come
      if (!this.prey) {
        for (const bug of bugs) {
          if (!bug.caught && Math.hypot(bug.x - this.clawX, bug.y - this.clawY) < 22) {
            bug.caught = true;
            this.prey = bug;
            this.eatT = 0;
            break;
          }
        }
      }
      if (this.prey) {
        const bug = this.prey;
        bug.x = this.clawX;
        bug.y = this.clawY;
        bug.a = this.head.absAngle + Math.PI / 2;
        this.eatT += 1 / 60;
        if (this.eatT > 0.25 && this.eatT - 1 / 60 <= 0.25) this.sting();
        if (this.eatT > 0.9) {
          bug.size = Math.max(0, 1 - (this.eatT - 0.9) / 1.8);
          if (Math.random() < 0.15) this.dust(bug.x, bug.y, 1, darken(bug.color, 0.3));
        }
        if (bug.size <= 0) {
          bugs.splice(bugs.indexOf(bug), 1);
          this.prey = null;
          this.eaten++;
        }
      }

      for (const p of this.particles) {
        p.x += p.vx;
        p.y += p.vy;
        p.vx *= 0.92;
        p.vy *= 0.92;
        p.life -= 1 / 30;
      }
      this.particles = this.particles.filter((p) => p.life > 0);

      const closed = clicking || this.prey || (this.stingT > 0.4 && this.stingT < 0.8);
      this.pinch += ((closed ? 1 : 0) - this.pinch) * 0.3;
    }

    dust(x, y, n, color) {
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2, v = 0.4 + Math.random() * 0.8;
        this.particles.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 1, color });
      }
    }

    // ---------- dibujo ----------

    draw(g, night) {
      for (const leg of this.legs) this.drawLeg(g, leg);
      for (let i = this.body.length - 1; i >= 0; i--) {
        this.drawPlate(g, this.body[i], this.bodyRadius[i]);
      }
      this.drawCarapace(g);
      if (this.prey) this.prey.draw(g, night);
      for (const [side, arm, forearm] of this.claws) this.drawClaw(g, side, arm, forearm);
      this.drawTail(g);
    }

    drawLeg(g, leg) {
      const knee = leg.thigh, foot = leg.shin, lift = leg.lift;
      const d = foot.absAngle;
      const tx = foot.x + 9 * Math.cos(d), ty = foot.y + 9 * Math.sin(d);
      const pts = [sp(leg.hip.x, leg.hip.y, 6), sp(knee.x, knee.y, 10 + lift * 0.4),
                   sp(foot.x, foot.y, lift), sp(tx, ty, lift * 0.8)];
      shadedRibbon(g, pts, [4.4, 3.4, 1.9, 0.6], P.pata);
      if (shadowPass) return;
      circle(g, darken(P.pata, 0.45), knee.x, knee.y, 2.6);
      circle(g, darken(P.pata, 0.45), foot.x, foot.y, 1.8);
      for (const f of [0.3, 0.55, 0.8]) {
        const hx = knee.x + (foot.x - knee.x) * f;
        const hy = knee.y + (foot.y - knee.y) * f;
        const a = d + leg.side * 0.9;
        line(g, P.contorno, [hx, hy], [hx + 4.5 * Math.cos(a), hy + 4.5 * Math.sin(a)], 0.7);
      }
    }

    drawPlate(g, seg, r) {
      g.save();
      if (shadowPass) g.translate(6 * 0.6, 6 * 0.85);
      const d = seg.absAngle;
      const ca = Math.cos(d), sa = Math.sin(d), px = -sa, py = ca;
      shadedOval(g, seg.x, seg.y, d, 9.5, r, P.cuerpo);
      if (!shadowPass) {
        const dark = darken(P.cuerpo, 0.35);
        const bx = seg.x + ca * 7.5, by = seg.y + sa * 7.5;
        line(g, dark, [bx - px * r * 0.8, by - py * r * 0.8], [bx + px * r * 0.8, by + py * r * 0.8], 1.6);
        line(g, dark, [seg.x - ca * 6, seg.y - sa * 6], [seg.x + ca * 6, seg.y + sa * 6], 1.2);
        for (const s of [-1, 1]) {
          circle(g, dark, seg.x + px * r * 0.45 * s, seg.y + py * r * 0.45 * s, 1.5);
        }
      }
      g.restore();
    }

    drawCarapace(g) {
      g.save();
      if (shadowPass) g.translate(7 * 0.6, 7 * 0.85);
      const h = this.head, d = h.absAngle;
      const ca = Math.cos(d), sa = Math.sin(d), px = -sa, py = ca;
      const cx = h.x - ca * 3, cy = h.y - sa * 3;
      shadedOval(g, cx, cy, d, 17, 15.5, P.cuerpo);
      if (!shadowPass) {
        const dark = darken(P.cuerpo, 0.4);
        line(g, dark, [cx - ca * 12, cy - sa * 12], [cx + ca * 2, cy + sa * 2], 1.2);
        const fx = cx + ca * 17, fy = cy + sa * 17;
        poly(g, P.contorno, [[fx + px * 3, fy + py * 3], [fx - px * 3, fy - py * 3],
                             [fx - ca * 3.5, fy - sa * 3.5]]);
        const ex = cx + ca * 5, ey = cy + sa * 5;
        shadedOval(g, ex, ey, d, 4, 5, lighten(P.cuerpo, 0.1));
        for (const s of [-1, 1]) {
          const ox = ex + px * 2.4 * s, oy = ey + py * 2.4 * s;
          circle(g, [15, 10, 8], ox, oy, 2.1);
          circle(g, [255, 255, 255], ox + LUZ[0] * 0.8, oy + LUZ[1] * 0.8, 0.7);
        }
        for (const s of [-1, 1]) {
          for (let k = 0; k < 3; k++) {
            circle(g, [20, 12, 8],
                   cx + ca * (12 - k * 2.2) + px * s * (10 + k * 0.9),
                   cy + sa * (12 - k * 2.2) + py * s * (10 + k * 0.9), 1.1);
          }
        }
      }
      g.restore();
    }

    drawClaw(g, side, arm, forearm) {
      g.save();
      if (shadowPass) g.translate(5 * 0.6, 5 * 0.85);
      const h = this.head, d0 = h.absAngle;
      const base = [h.x + 9 * Math.cos(d0 + side * 0.8), h.y + 9 * Math.sin(d0 + side * 0.8)];
      shadedRibbon(g, [base, [arm.x, arm.y], [forearm.x, forearm.y]], [4.2, 5.2, 6.2], P.pinza);
      circle(g, darken(P.pinza, 0.4), arm.x, arm.y, 2.8);

      const d = forearm.absAngle;
      const ca = Math.cos(d), sa = Math.sin(d), px = -sa, py = ca;
      const hx = forearm.x + ca * 12, hy = forearm.y + sa * 12;
      const op = 0.55 * (1 - this.pinch) + 0.04;
      const fbx = hx + ca * 12, fby = hy + sa * 12;
      const fingers = [
        [side * 3.2, d + side * op * 0.35, -side * 0.2],  // dedo fijo
        [-side * 3.2, d - side * op, side * 0.2],         // dedo móvil
      ];
      for (const [offset, start, bend] of fingers) {
        let x = fbx + px * offset, y = fby + py * offset, a = start;
        const finger = [[x, y]];
        for (let k = 0; k < 3; k++) {
          x += 8.5 * Math.cos(a);
          y += 8.5 * Math.sin(a);
          finger.push([x, y]);
          a += bend;
        }
        shadedRibbon(g, finger, [5, 3.8, 2.3, 0.6], darken(P.pinza, 0.15));
        circle(g, P.aguijon, x, y, 1.3);
      }
      shadedOval(g, hx, hy, d, 16, 11, P.pinza);
      if (!shadowPass) {
        for (const [f, q] of [[-4, 3], [2, -3], [6, 2], [-1, 0]]) {
          circle(g, darken(P.pinza, 0.3), hx + ca * f + px * q, hy + sa * f + py * q, 1.1);
        }
      }
      g.restore();
    }

    drawTail(g) {
      const pts = this.tailPts;
      const items = [];
      for (let i = 0; i < pts.length - 1; i++) items.push([i, pts[i], pts[i + 1]]);
      items.sort((u, v) => u[1].z + u[2].z - v[1].z - v[2].z); // lo más alto se dibuja encima

      for (const [i, a, b] of items) {
        const [ax, ay] = sp(a.x, a.y, a.z);
        const [bx, by] = sp(b.x, b.y, b.z);
        const cx = (ax + bx) / 2, cy = (ay + by) / 2;
        const len = Math.hypot(bx - ax, by - ay);
        const k = persp((a.z + b.z) / 2);
        const w = (6 + i * 0.25) * k;
        const d = len > 0.5 ? Math.atan2(by - ay, bx - ax) : b.yaw;
        const along = Math.max(len / 2 + 2.5 * k, w * 0.85);
        shadedOval(g, cx, cy, d, along, w, P.cola);
        if (!shadowPass) {
          const ca = Math.cos(d), sa = Math.sin(d), px = -sa, py = ca;
          const dark = darken(P.cola, 0.35);
          const l = Math.min(5, along - 2);
          for (const s of [-1, 1]) {
            const ox = px * w * 0.45 * s, oy = py * w * 0.45 * s;
            line(g, dark, [cx - ca * l + ox, cy - sa * l + oy], [cx + ca * l + ox, cy + sa * l + oy], 0.9);
          }
        }
      }

      // telson (bulbo) y aguijón curvo, calculados en 3D y proyectados
      const last = pts[pts.length - 1];
      const yaw = last.yaw, pitch = last.pitch;
      const step = (p, len, from) => ({
        x: from.x + Math.cos(yaw) * Math.cos(p) * len,
        y: from.y + Math.sin(yaw) * Math.cos(p) * len,
        z: Math.max(0.5, from.z + Math.sin(p) * len),
      });
      const bulb = step(pitch, 8, last);
      const q0 = step(pitch, 7, bulb);
      const q1 = step(pitch + 0.5, 6, q0);
      const q2 = step(pitch + 1.0, 5, q1);
      const q3 = step(pitch + 1.5, 5, q2);
      const k = persp(bulb.z);
      const proj = [q0, q1, q2, q3].map((q) => sp(q.x, q.y, q.z));
      const [bx, by] = sp(bulb.x, bulb.y, bulb.z);
      const dir = Math.cos(pitch) >= 0 ? yaw : yaw + Math.PI;
      shadedOval(g, bx, by, dir, Math.max(10 * Math.abs(Math.cos(pitch)), 7.5) * k, 7.5 * k, P.telson);
      shadedRibbon(g, proj, [3.4 * k, 2.4 * k, 1.2 * k, 0.3], P.aguijon);
    }

    points() {
      const nodes = [this.head, ...this.body];
      for (const leg of this.legs) nodes.push(...leg.nodes);
      for (const [, arm, forearm] of this.claws) nodes.push(arm, forearm);
      return nodes;
    }
  }

  // ---------- funciones de dibujo ----------

  function poly(g, color, pts) {
    g.fillStyle = rgb(color);
    g.beginPath();
    g.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]);
    g.closePath();
    g.fill();
  }

  function circle(g, color, x, y, r) {
    g.fillStyle = rgb(color);
    g.beginPath();
    g.arc(x, y, Math.max(0.5, r), 0, Math.PI * 2);
    g.fill();
  }

  function oval(g, color, cx, cy, ang, a, b) {
    g.fillStyle = rgb(color);
    g.beginPath();
    g.ellipse(cx, cy, Math.max(0.5, a), Math.max(0.5, b), ang, 0, Math.PI * 2);
    g.fill();
  }

  function line(g, color, a, b, w) {
    g.strokeStyle = rgb(color);
    g.lineWidth = w;
    g.lineCap = "round";
    g.beginPath();
    g.moveTo(a[0], a[1]);
    g.lineTo(b[0], b[1]);
    g.stroke();
  }

  function ribbonPts(pts, widths) {
    const left = [], right = [];
    const last = pts.length - 1;
    pts.forEach(([x, y], i) => {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(last, i + 1)];
      const dx = b[0] - a[0], dy = b[1] - a[1];
      const d = Math.hypot(dx, dy) || 1;
      const nx = -dy / d, ny = dx / d, w = widths[i];
      left.push([x + nx * w, y + ny * w]);
      right.push([x - nx * w, y - ny * w]);
    });
    return left.concat(right.reverse());
  }

  function ribbon(g, color, pts, widths) {
    poly(g, color, ribbonPts(pts, widths));
    const ends = [[pts[0], widths[0]], [pts[pts.length - 1], widths[widths.length - 1]]];
    for (const [q, w] of ends) if (w > 0.8) circle(g, color, q[0], q[1], w);
  }

  function shadedOval(g, cx, cy, ang, a, b, base) {
    oval(g, P.contorno, cx, cy, ang, a + 1.6, b + 1.6);
    if (shadowPass) return;
    oval(g, base, cx, cy, ang, a, b);
    const k = Math.min(a, b);
    oval(g, lighten(base, 0.22), cx + LUZ[0] * k * 0.35, cy + LUZ[1] * k * 0.35, ang, a * 0.62, b * 0.55);
    circle(g, lighten(base, 0.55), cx + LUZ[0] * k * 0.55, cy + LUZ[1] * k * 0.55, k * 0.2);
  }

  function shadedRibbon(g, pts, widths, base) {
    ribbon(g, P.contorno, pts, widths.map((w) => w + 1.4));
    if (shadowPass) return;
    ribbon(g, base, pts, widths);
    const shift = pts.map(([x, y], i) => [x + LUZ[0] * widths[i] * 0.35, y + LUZ[1] * widths[i] * 0.35]);
    ribbon(g, lighten(base, 0.3), shift, widths.map((w) => w * 0.38));
  }

  // ---------- fondo de arena ----------

  function makeRandom(seed) {
    return () => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function buildBackground(scale) {
    const rnd = makeRandom(7);
    const bg = document.createElement("canvas");
    bg.width = W * scale;
    bg.height = H * scale;
    const g = bg.getContext("2d");
    g.scale(scale, scale);
    g.fillStyle = rgb(ARENA);
    g.fillRect(0, 0, W, H);

    // dunas suaves
    for (let i = 0; i < 12; i++) {
      g.fillStyle = rnd() < 0.5 ? "rgba(255,240,210,0.09)" : "rgba(120,85,50,0.08)";
      g.beginPath();
      g.ellipse(rnd() * W, rnd() * H, 120 + rnd() * 180, 60 + rnd() * 90, 0, 0, Math.PI * 2);
      g.fill();
    }

    // ondulaciones del viento
    g.lineCap = "round";
    for (let i = 0; i < 32; i++) {
      const x0 = rnd() * (W + 100) - 100, y0 = rnd() * H, len = 80 + rnd() * 140;
      for (const [color, dy, w] of [["rgba(255,235,200,0.18)", 0, 2], ["rgba(110,80,45,0.12)", 2, 1]]) {
        g.strokeStyle = color;
        g.lineWidth = w;
        g.beginPath();
        for (let k = 0; k < len; k += 6) {
          const x = x0 + k, y = y0 + 4 * Math.sin(k / 18) + k * 0.15 + dy;
          if (k === 0) g.moveTo(x, y); else g.lineTo(x, y);
        }
        g.stroke();
      }
    }

    // granos de arena
    for (let i = 0; i < 9000; i++) {
      const v = (rnd() - 0.5) * 44;
      g.fillStyle = rgb(ARENA.map((c) => clamp(c + v, 0, 255)));
      g.fillRect(rnd() * W, rnd() * H, 1, 1);
    }

    // piedritas
    const tones = [[150, 130, 105], [125, 110, 95], [170, 145, 110], [105, 90, 80]];
    for (let i = 0; i < 36; i++) {
      const x = rnd() * W, y = rnd() * H, r = 2.5 + rnd() * 6.5;
      const base = tones[Math.floor(rnd() * tones.length)];
      const pts = [];
      for (let k = 0; k < 9; k++) {
        const a = (2 * Math.PI * k) / 9, rr = r * (0.75 + rnd() * 0.4);
        pts.push([x + rr * Math.cos(a), y + rr * 0.8 * Math.sin(a)]);
      }
      g.fillStyle = "rgba(70,50,30,0.28)";
      g.beginPath();
      pts.forEach(([px, py], k) => (k ? g.lineTo(px + 2, py + 3) : g.moveTo(px + 2, py + 3)));
      g.fill();
      poly(g, base, pts);
      circle(g, lighten(base, 0.3), x - r * 0.3, y - r * 0.3, Math.max(1, r * 0.35));
    }

    // viñeta (oscurece las esquinas)
    const vig = g.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.hypot(W, H) / 2);
    vig.addColorStop(0, "rgba(30,18,8,0)");
    vig.addColorStop(1, "rgba(30,18,8,0.55)");
    g.fillStyle = vig;
    g.fillRect(0, 0, W, H);
    return bg;
  }

  // la misma arena de noche: azul oscuro con un poco de luz de luna
  function buildNight(day, scale) {
    const bg = document.createElement("canvas");
    bg.width = day.width;
    bg.height = day.height;
    const g = bg.getContext("2d");
    g.drawImage(day, 0, 0);
    g.scale(scale, scale);
    g.fillStyle = "rgba(6,12,38,0.78)";
    g.fillRect(0, 0, W, H);
    const moon = g.createRadialGradient(W * 0.2, H * 0.1, 0, W * 0.2, H * 0.1, W * 0.7);
    moon.addColorStop(0, "rgba(120,150,220,0.16)");
    moon.addColorStop(1, "rgba(120,150,220,0)");
    g.fillStyle = moon;
    g.fillRect(0, 0, W, H);
    return bg;
  }

  // ---------- enemigo: lagarto ----------

  const LAGARTO = { cuerpo: [110, 150, 70], pata: [96, 136, 60], mancha: [58, 88, 40], claro: [196, 210, 140] };

  // Pata de lagarto: sigue un "reloj" de marcha (phase) compartido. Las patas en diagonal
  // (pair 0 / pair 1) se alternan. El pie pasa más tiempo apoyado que en el aire, y el paso
  // es más largo cuanto más rápido va. El codo apunta hacia atrás y la rodilla hacia delante.
  class LizardLeg extends LegSystem {
    constructor(end, creature, side, tilt, reach, pair, front) {
      super(end, 2, 6, creature, side, tilt, reach, 10, pair);
      this.pair = pair;
      this.front = front;
      this.swinging = false;
      this.liftZ = 0;
    }

    get lift() {
      return this.liftZ;
    }

    // IK de 2 huesos eligiendo hacia dónde dobla: codo atrás (delanteras), rodilla delante (traseras)
    solveIK(fx, fy) {
      const h = this.hip, l1 = this.thigh.size, l2 = this.shin.size;
      const dx = fx - h.x, dy = fy - h.y;
      const d = clamp(Math.hypot(dx, dy), Math.abs(l1 - l2) + 0.01, l1 + l2 - 0.01);
      const base = Math.atan2(dy, dx);
      const a = Math.acos(clamp((l1 * l1 + d * d - l2 * l2) / (2 * l1 * d), -1, 1));
      const back = h.absAngle; // las placas del cuerpo apuntan hacia atrás
      const kneeBack = (sign) => Math.cos(base + sign * a - back);
      let sign = kneeBack(1) > kneeBack(-1) ? 1 : -1;
      if (!this.front) sign = -sign;
      const thighAbs = base + sign * a;
      const kx = h.x + l1 * Math.cos(thighAbs), ky = h.y + l1 * Math.sin(thighAbs);
      const shinAbs = Math.atan2(fy - ky, fx - kx);
      this.thigh.angle = thighAbs - h.absAngle;
      this.shin.angle = shinAbs - thighAbs;
      this.thigh.updateRelative(false, true);
      this.shin.updateRelative(false, true);
    }

    gait(phase, moving, stride, swingFrac) {
      if (!moving) {
        this.liftZ = 0;
        super.update(); // parado: recoloca la pata con calma si quedó mal puesta
        return;
      }
      const p = (phase + this.pair * 0.5) % 1;
      const swing = p < swingFrac;
      if (swing) {
        if (!this.swinging) {
          this.startX = this.footX;
          this.startY = this.footY;
        }
        const [ix, iy] = this.ideal();
        const fwd = this.hip.absAngle + Math.PI;
        this.goalX = ix + Math.cos(fwd) * stride * 0.5;
        this.goalY = iy + Math.sin(fwd) * stride * 0.5;
        const k = p / swingFrac;
        const e = ease(k);
        this.footX = this.startX + (this.goalX - this.startX) * e;
        this.footY = this.startY + (this.goalY - this.startY) * e;
        this.liftZ = Math.sin(Math.PI * k) * 5;
        this.progress = k;
      } else {
        this.liftZ = 0;
        this.progress = 1;
      }
      this.swinging = swing;
      this.solveIK(this.footX, this.footY);
    }
  }

  class Lizard {
    constructor(x, y, speed) {
      this.head = new Creature(x, y, speed, 0.08, 0.06);
      this.head.absAngle = Math.atan2(H / 2 - y, W / 2 - x);
      this.baseSpeed = speed;
      this.body = [];
      this.bodyWidth = [9, 10.5, 10.5, 9.5, 7.5];
      let parent = this.head;
      this.bodyWidth.forEach((_, i) => {
        const seg = new Segment(parent, i === 0 ? 12 : 10, i === 0 ? Math.PI : 0, 0.35);
        this.body.push(seg);
        parent = seg;
      });
      this.tail = [];
      for (let i = 0; i < 9; i++) {
        const seg = new Segment(parent, 9, 0, 0.4, 0.1);
        this.tail.push(seg);
        parent = seg;
      }
      // hombros en body[0] y caderas en body[3]; codos hacia atrás, rodillas hacia delante
      this.legs = [];
      // [placa, inclinación, muslo, pierna, alcance]: las traseras son más largas
      [[0, 0.3, 12, 11, 17], [3, -0.2, 15, 15, 22]].forEach(([b, tilt, l1, l2, reach], i) => {
        for (const side of [-1, 1]) {
          const thigh = new Segment(this.body[b], l1, side * (Math.PI / 2 + tilt));
          const shin = new Segment(thigh, l2, side * (i === 0 ? -0.9 : 0.9));
          const pair = (i + (side > 0 ? 1 : 0)) % 2;
          this.legs.push(new LizardLeg(shin, this.head, side, tilt, reach, pair, i === 0));
        }
      });
      this.phase = 0;
      this.run = 0.8 + Math.random();  // segundos corriendo antes de la próxima pausa
      this.pause = 0;
      this.flee = 0;    // segundos que le quedan huyendo
      this.dead = false;
      this.hurt = 0;
      this.idle = Math.random() * 6;
      this.tongue = 0;
    }

    update(sx, sy) {
      const dt = 1 / 60, h = this.head;
      let tx = sx, ty = sy, maxSpeed = this.baseSpeed;
      if (this.flee > 0) {
        this.flee -= dt;
        tx = h.x + (h.x - sx);
        ty = h.y + (h.y - sy);
        maxSpeed = this.baseSpeed * 1.8;
        this.pause = 0;
      } else {
        // corre a arrancadas: corre un rato, se para a mirar, vuelve a correr;
        // cerca de la presa no se para (se lanza)
        const near = Math.hypot(sx - h.x, sy - h.y) < 80;
        if (this.pause > 0) {
          this.pause -= dt;
          if (near) this.pause = 0;
        } else {
          this.run -= dt;
          if (this.run <= 0 && !near) {
            this.pause = 0.3 + Math.random() * 0.5;
            this.run = 1.0 + Math.random() * 1.4;
          }
        }
      }
      const paused = this.pause > 0;
      const diff = wrap(Math.atan2(ty - h.y, tx - h.x) - h.absAngle);
      h.absAngle += clamp(diff, -(paused ? 0.03 : 0.07), paused ? 0.03 : 0.07);
      const want = paused ? 0 : maxSpeed * Math.max(0.35, Math.cos(diff));
      h.speed += (want - h.speed) * (want > h.speed ? 0.1 : 0.2);
      h.x += Math.cos(h.absAngle) * h.speed;
      h.y += Math.sin(h.absAngle) * h.speed;

      // reloj de la marcha: el paso es más largo cuanto más rápido va; despacio el pie
      // pasa más tiempo apoyado (35 % en el aire), corriendo casi la mitad
      const moving = h.speed > 0.25;
      const stride = clamp(12 + h.speed * 6, 12, 26);
      const swingFrac = clamp(0.32 + h.speed * 0.06, 0.32, 0.48);
      this.phase = (this.phase + h.speed / stride) % 1;

      // ondulación en S del cuerpo y la cola, sincronizada con las patas
      const amp = 0.4 * Math.min(1, h.speed / 1.6);
      const w = this.phase * Math.PI * 2;
      this.body.forEach((seg, i) => {
        seg.baseAngle = (i === 0 ? Math.PI : 0) + amp * Math.sin(w - i * 1.1);
        seg.follow();
      });
      this.idle += dt;
      this.tail.forEach((seg, i) => {
        seg.baseAngle = amp * 0.35 * Math.sin(w - (i + 5) * 1.1) + 0.04 * Math.sin(this.idle * 2 - i * 0.6);
        seg.follow();
      });
      for (const leg of this.legs) leg.gait(this.phase, moving, stride, swingFrac);

      if (this.hurt > 0) this.hurt -= dt;
      if (this.tongue > 0) this.tongue -= dt;
      else if (this.flee <= 0 && Math.random() < (paused ? 0.04 : 0.008)) this.tongue = 0.35;
    }

    offscreen() {
      const m = 90, h = this.head;
      return h.x < -m || h.x > W + m || h.y < -m || h.y > H + m;
    }

    draw(g, night) {
      g.save();
      if (shadowPass) g.translate(3 * 0.6, 3 * 0.85);
      const blink = this.hurt > 0 && Math.floor(this.hurt * 20) % 2 === 0;
      const toNight = (c) => mix(c, [40, 62, 72], night * 0.6);
      const col = blink ? [235, 235, 210] : toNight(LAGARTO.cuerpo);
      const pata = toNight(LAGARTO.pata);
      const banda = toNight(LAGARTO.mancha);
      const claro = toNight(LAGARTO.claro);
      const h = this.head, d = h.absAngle;
      const ca = Math.cos(d), sa = Math.sin(d), px = -sa, py = ca;

      // patas: el pie se levanta al dar el paso (su sombra se separa) y los dedos miran
      // hacia delante en las patas delanteras y hacia fuera y atrás en las traseras
      for (const leg of this.legs) {
        const k = leg.thigh, f = leg.shin, z = leg.lift;
        const pts = [sp(leg.hip.x, leg.hip.y, 0), sp(k.x, k.y, 3 + z * 0.5), sp(f.x, f.y, z)];
        const big = leg.front ? 1 : 1.25;
        shadedRibbon(g, pts, [3.6 * big, 2.5 * big, 1.6 * big], pata);
        const fwd = leg.hip.absAngle + Math.PI;
        const toeDir = fwd - leg.side * (leg.front ? 0.55 : 1.9); // hacia fuera del cuerpo
        const toes = leg.front ? [4, 5, 5.5, 5, 3.5] : [4, 5.5, 7, 8.5, 5];
        const [fx, fy] = pts[2];
        if (!shadowPass) oval(g, darken(pata, 0.15), fx, fy, toeDir, 2.6 * big, 2 * big);
        toes.forEach((len, i) => {
          const a = toeDir + (i - 2) * 0.38 * leg.side;
          const tx = fx + len * Math.cos(a), ty = fy + len * Math.sin(a);
          line(g, shadowPass ? pata : darken(pata, 0.3), [fx, fy], [tx, ty], 1.1);
          if (!shadowPass) circle(g, darken(pata, 0.4), tx, ty, 0.7);
        });
      }

      // lengua bífida cuando la saca
      if (this.tongue > 0 && !shadowPass) {
        const len = Math.sin(Math.PI * (1 - this.tongue / 0.35)) * 14;
        const sx = h.x + ca * 13, sy = h.y + sa * 13;
        const ex = sx + ca * len, ey = sy + sa * len;
        line(g, [200, 50, 60], [sx, sy], [ex, ey], 1.4);
        for (const s2 of [-1, 1]) {
          line(g, [200, 50, 60], [ex, ey], [ex + Math.cos(d + s2 * 0.5) * 4, ey + Math.sin(d + s2 * 0.5) * 4], 1.1);
        }
      }

      // cuerpo entero como una sola forma: hocico, cabeza, cuello, tronco y cola
      const spine = [[h.x + ca * 13, h.y + sa * 13], [h.x + ca * 6, h.y + sa * 6], [h.x, h.y],
                     ...this.body.map((s) => [s.x, s.y]), ...this.tail.map((s) => [s.x, s.y])];
      const widths = [2.2, 6.5, 7.8, 5.8, 9.5, 10.5, 10, 8];
      this.tail.forEach((_, i) => widths.push(6.5 * (1 - (i + 1) / (this.tail.length + 1)) + 0.4));
      shadedRibbon(g, spine, widths, col);

      if (!shadowPass) {
        // franja clara a lo largo de la espalda
        ribbon(g, claro, spine.slice(2, 12), widths.slice(2, 12).map((w) => w * 0.22));
        // bandas oscuras y puntitos claros en espalda y cola
        for (let i = 4; i < spine.length - 1; i++) {
          const [x, y] = spine[i], [nx, ny] = spine[i + 1];
          const a = Math.atan2(ny - y, nx - x), qx = -Math.sin(a), qy = Math.cos(a);
          const w = widths[i] * 0.8;
          if (i % 2 === 0) line(g, banda, [x + qx * w, y + qy * w], [x - qx * w, y - qy * w], Math.max(1, widths[i] * 0.35));
          else if (i < 9) {
            circle(g, claro, x + qx * w * 0.55, y + qy * w * 0.55, 1.2);
            circle(g, claro, x - qx * w * 0.55, y - qy * w * 0.55, 1.2);
          }
        }
        // cabeza: placas, fosas nasales y ojos saltones
        circle(g, lighten(col, 0.18), h.x + ca * 4, h.y + sa * 4, 3.2);
        for (const s2 of [-1, 1]) {
          circle(g, darken(col, 0.5), h.x + ca * 11 + px * 1.6 * s2, h.y + sa * 11 + py * 1.6 * s2, 0.7);
          const ex = h.x + ca * 3 + px * 6.2 * s2, ey = h.y + sa * 3 + py * 6.2 * s2;
          circle(g, darken(col, 0.45), ex, ey, 3.2);
          circle(g, [222, 170, 60], ex, ey, 2.3);
          oval(g, [15, 12, 8], ex, ey, d + Math.PI / 2, 1.8, 0.7);
          circle(g, [255, 255, 235], ex + LUZ[0] * 0.9, ey + LUZ[1] * 0.9, 0.6);
        }
      }
      g.restore();
    }
  }

  // ---------- sonidos (sintetizados, sin archivos) ----------

  const sfx = (() => {
    let ac = null, on = true;
    const ensure = () => {
      if (!ac) {
        try { ac = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { ac = null; }
      }
      if (ac && ac.state === "suspended") ac.resume();
    };
    function tone(freq, dur, type = "sine", vol = 0.12, slide = 0) {
      if (!on || !ac) return;
      const t = ac.currentTime, o = ac.createOscillator(), gn = ac.createGain();
      o.type = type;
      o.frequency.setValueAtTime(freq, t);
      if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq * slide), t + dur);
      gn.gain.setValueAtTime(vol, t);
      gn.gain.exponentialRampToValueAtTime(0.001, t + dur);
      o.connect(gn).connect(ac.destination);
      o.start(t);
      o.stop(t + dur);
    }
    function noise(dur, vol, freq) {
      if (!on || !ac) return;
      const len = Math.floor(ac.sampleRate * dur);
      const buf = ac.createBuffer(1, len, ac.sampleRate), data = buf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
      const src = ac.createBufferSource(), f = ac.createBiquadFilter(), gn = ac.createGain();
      src.buffer = buf;
      f.type = "bandpass";
      f.frequency.value = freq;
      gn.gain.value = vol;
      src.connect(f).connect(gn).connect(ac.destination);
      src.start();
    }
    const later = (ms, fn) => setTimeout(fn, ms);
    return {
      ensure,
      get on() { return on; },
      toggle() { on = !on; },
      sting() { noise(0.18, 0.3, 1800); tone(520, 0.12, "triangle", 0.07, 0.4); },
      munch() { noise(0.06, 0.35, 700); later(110, () => noise(0.06, 0.35, 600)); },
      eat() { tone(660, 0.08, "square", 0.05); later(80, () => tone(880, 0.1, "square", 0.05)); },
      kill() { tone(300, 0.1, "square", 0.07, 2); later(90, () => tone(600, 0.15, "square", 0.07, 1.5)); },
      hit() { tone(180, 0.35, "sawtooth", 0.13, 0.4); },
      over() { [440, 370, 311, 262].forEach((f, i) => later(i * 180, () => tone(f, 0.25, "triangle", 0.1))); },
      heart() { [523, 659, 784, 1047].forEach((f, i) => later(i * 70, () => tone(f, 0.1, "triangle", 0.06))); },
      start() { [392, 523, 659].forEach((f, i) => later(i * 90, () => tone(f, 0.12, "square", 0.05))); },
    };
  })();

  const PUNTOS_POR_CORAZON = 10; // cada 10 puntos ganas un corazón
  const MAX_VIDAS = 5;

  const vibrate = (ms) => { try { if (navigator.vibrate) navigator.vibrate(ms); } catch (e) { /* sin vibración */ } };

  // ---------- bucle principal ----------

  const GAME = canvas.dataset.modo === "juego"; // en juego.html es un juego; en la web, una demo
  const scale = Math.min(window.devicePixelRatio || 1, 2);
  const ctx = canvas.getContext("2d");
  const layer = document.createElement("canvas");
  const lctx = layer.getContext("2d");
  const slayer = document.createElement("canvas");
  const sctx = slayer.getContext("2d");
  const font = getComputedStyle(canvas).fontFamily || "monospace";
  const isTouch = window.matchMedia("(pointer: coarse)").matches;
  let background = null, nightBackground = null;
  let lastKey = "";

  // En pantallas estrechas (móvil) el mundo es más pequeño, así el escorpión se ve más grande
  function resize() {
    const cw = canvas.clientWidth || 800;
    const ch = canvas.clientHeight || 560;
    const key = GAME ? `${cw}x${ch}` : String(cw);
    if (key === lastKey) return;
    lastKey = key;
    W = cw < 600 ? 460 : 800;
    H = Math.round((W * ch) / cw);
    canvas.width = layer.width = slayer.width = W * scale;
    canvas.height = layer.height = slayer.height = H * scale;
    background = buildBackground(scale);
    nightBackground = buildNight(background, scale);
  }
  resize();
  window.addEventListener("resize", resize);

  let scorpion = new Scorpion(W / 2, H / 2);
  const bugs = [];
  let lizards = [];
  const popups = [];
  let spawnTimer = 1, lizardTimer = 7;
  let mouse = null;
  let clicking = false;
  let tapPinch = 0;
  let night = false, nightT = 0;
  let down = null;

  function loadBest() {
    try { return parseInt(localStorage.getItem("escorpion-record"), 10) || 0; } catch (e) { return 0; }
  }
  function saveBest(v) {
    try { localStorage.setItem("escorpion-record", String(v)); } catch (e) { /* sin almacenamiento */ }
  }
  const G = {
    state: GAME ? "menu" : "demo", score: 0, best: loadBest(), lives: 3, energy: 1, time: 0,
    invuln: 0, strikeDone: false, shake: 0, reason: "", newBest: false, overT: 0,
  };

  const topButton = () => ({ x: W - 46, y: 10, w: 36, h: 36 });
  const soundButton = () => ({ x: W - 88, y: 10, w: 36, h: 36 });
  const inRect = ([x, y], b) => x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h;

  function toWorld(e) {
    const r = canvas.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * W, ((e.clientY - r.top) / r.height) * H];
  }

  function doSting() {
    if (scorpion.stingT < 0) {
      scorpion.sting();
      sfx.sting();
    }
  }

  function startGame() {
    scorpion = new Scorpion(W / 2, H / 2);
    bugs.length = 0;
    lizards = [];
    popups.length = 0;
    Object.assign(G, {
      state: "playing", score: 0, lives: 3, energy: 1, time: 0, invuln: 0,
      strikeDone: false, shake: 0, newBest: false, nextHeart: PUNTOS_POR_CORAZON,
    });
    spawnTimer = 0.5;
    lizardTimer = 7;
    mouse = [W / 2, H / 2];
    night = false;
    sfx.start();
  }

  function endGame(reason) {
    G.state = "over";
    G.overT = 0;
    G.reason = reason;
    G.score = Math.floor(G.score);
    if (G.score > G.best) {
      G.best = G.score;
      G.newBest = true;
      saveBest(G.best);
    }
    mouse = null;
    sfx.over();
    vibrate([100, 60, 200]);
  }

  canvas.addEventListener("pointermove", (e) => {
    const p = toWorld(e);
    if (!GAME) canvas.style.cursor = inRect(p, topButton()) ? "pointer" : "crosshair";
    if (G.state === "menu" || G.state === "over") return;
    if (e.pointerType !== "touch" || e.buttons) mouse = p;
  });
  canvas.addEventListener("pointerleave", () => {
    if (!GAME) mouse = null;
    clicking = false;
  });
  canvas.addEventListener("pointerdown", (e) => {
    const p = toWorld(e);
    sfx.ensure();
    if (GAME) {
      if (G.state === "menu" || G.state === "over") {
        if (G.state === "menu" || G.overT > 0.8) startGame();
        return;
      }
      if (G.state === "pause") { G.state = "playing"; return; }
      if (inRect(p, topButton())) { G.state = "pause"; return; }
      if (inRect(p, soundButton())) { sfx.toggle(); return; }
      mouse = p;
      if (e.pointerType === "touch") down = { t: performance.now(), x: p[0], y: p[1] };
      else { doSting(); clicking = true; }
      return;
    }
    if (inRect(p, topButton())) { night = !night; return; }
    mouse = p;
    scorpion.sting();
    if (e.pointerType === "touch") tapPinch = 0.4;
    else clicking = true;
  });
  window.addEventListener("pointerup", (e) => {
    clicking = false;
    if (e.pointerType !== "touch") return;
    if (GAME) {
      // toque rápido = picar; el escorpión se queda yendo hacia donde levantaste el dedo
      if (down && G.state === "playing" && performance.now() - down.t < 250) {
        const p = toWorld(e);
        if (Math.hypot(p[0] - down.x, p[1] - down.y) < 15) doSting();
      }
      down = null;
    } else mouse = null;
  });
  window.addEventListener("keydown", (e) => {
    if (GAME) {
      if (e.key === " ") {
        e.preventDefault();
        sfx.ensure();
        if (G.state === "playing") doSting();
        else if (G.state === "pause") G.state = "playing";
        else if (G.state === "menu" || G.overT > 0.8) startGame();
      } else if (e.key === "p" || e.key === "P" || e.key === "Escape") {
        if (G.state === "playing") G.state = "pause";
        else if (G.state === "pause") G.state = "playing";
      }
    } else if (e.key === "n" || e.key === "N") night = !night;
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden && G.state === "playing") G.state = "pause";
  });

  const hint = isTouch
    ? "Arrastra el dedo · Toca para picar"
    : "Mueve el ratón · Clic para picar · Tecla N: noche";

  function nearestBug() {
    let best = null, bestD = Infinity;
    for (const b of bugs) {
      const d = Math.hypot(b.x - scorpion.head.x, b.y - scorpion.head.y);
      if (!b.caught && d < bestD) {
        best = b;
        bestD = d;
      }
    }
    return best;
  }

  function spawnBug() {
    for (let tries = 0; tries < 20; tries++) {
      const x = 30 + Math.random() * (W - 60), y = 30 + Math.random() * (H - 60);
      if (Math.hypot(x - scorpion.head.x, y - scorpion.head.y) > 160) {
        bugs.push(new Bug(x, y));
        return;
      }
    }
  }

  function spawnLizard(speed) {
    const side = Math.floor(Math.random() * 4);
    const x = side === 0 ? -40 : side === 1 ? W + 40 : Math.random() * W;
    const y = side === 2 ? -40 : side === 3 ? H + 40 : Math.random() * H;
    lizards.push(new Lizard(x, y, speed));
  }

  function popup(x, y, text) {
    popups.push({ x, y, text, life: 1 });
  }

  // la demo (y el fondo del menú): caza sola o sigue al ratón
  function demoStep(t) {
    spawnTimer -= 1 / 60;
    if (spawnTimer <= 0 && bugs.length < 3) {
      spawnBug();
      spawnTimer = 2.5 + Math.random() * 2;
    }
    for (const b of bugs) b.update(scorpion.head);
    let target = G.state === "demo" ? mouse : null;
    let hunting = false;
    if (!target) {
      const bug = nearestBug();
      if (bug) {
        target = [bug.x, bug.y];
        hunting = true;
      } else {
        const w = (2 * Math.PI) / 10;
        target = [W / 2 + W * 0.35 * Math.sin(w * t), H / 2 + H * 0.28 * Math.sin(2 * w * t)];
      }
    }
    tapPinch = Math.max(0, tapPinch - 1 / 60);
    scorpion.update(target[0], target[1], t, clicking || tapPinch > 0, bugs, hunting);
    for (const l of lizards) l.update(scorpion.body[1].x, scorpion.body[1].y);
  }

  function gameStep() {
    const dt = 1 / 60;
    const d = Math.min(1, G.time / 150); // dificultad: sube durante 2,5 minutos
    G.time += dt;
    night = Math.sin((G.time / 90) * Math.PI * 2 - Math.PI / 2) > 0.55; // noche cada 90 s

    spawnTimer -= dt;
    if (spawnTimer <= 0 && bugs.length < 3 + Math.round(2 * d)) {
      spawnBug();
      spawnTimer = 2 - d + Math.random() * 1.5;
    }
    for (const b of bugs) b.update(scorpion.head);

    lizardTimer -= dt;
    const alive = lizards.filter((l) => !l.dead).length;
    if (lizardTimer <= 0 && alive < 1 + Math.floor(3 * d)) {
      spawnLizard(1.4 + 1.1 * d);
      lizardTimer = 11 - 6 * d + Math.random() * 3;
    }

    const before = scorpion.eaten, hadPrey = !!scorpion.prey;
    const target = mouse || [scorpion.head.x, scorpion.head.y];
    scorpion.update(target[0], target[1], G.time, clicking, bugs, false);
    if (!hadPrey && scorpion.prey) sfx.munch();
    if (scorpion.eaten > before) {
      G.energy = Math.min(1, G.energy + 0.3);
      G.score += 10;
      sfx.eat();
      popup(scorpion.clawX, scorpion.clawY, "+10");
    }
    G.energy -= (0.03 + 0.03 * d) * dt;
    G.score += dt;
    // corazón extra cada PUNTOS_POR_CORAZON puntos (hasta MAX_VIDAS)
    while (G.score >= G.nextHeart) {
      G.nextHeart += PUNTOS_POR_CORAZON;
      if (G.lives < MAX_VIDAS) {
        G.lives++;
        sfx.heart();
        popup(scorpion.head.x, scorpion.head.y - 30, "+1 ♥");
      }
    }

    const sx = scorpion.body[1].x, sy = scorpion.body[1].y;
    for (const l of lizards) l.update(sx, sy);

    // picotazo: acierta si el lagarto está cerca de las pinzas o de la cabeza en el momento del golpe
    const st = scorpion.stingT;
    if (st < 0) G.strikeDone = false;
    else if (st > 0.45 && st < 0.75 && !G.strikeDone) {
      for (const l of lizards) {
        if (l.dead) continue;
        const hit = [l.head, ...l.body].some((n) =>
          Math.hypot(n.x - scorpion.clawX, n.y - scorpion.clawY) < 45 ||
          Math.hypot(n.x - scorpion.head.x, n.y - scorpion.head.y) < 45);
        if (hit) {
          l.dead = true;
          l.flee = 99;
          l.hurt = 0.6;
          G.score += 50;
          G.strikeDone = true;
          sfx.kill();
          popup(l.head.x, l.head.y, "+50");
          scorpion.dust(l.head.x, l.head.y, 6, [130, 170, 90]);
        }
      }
    }

    // mordisco del lagarto
    if (G.invuln > 0) G.invuln -= dt;
    else {
      for (const l of lizards) {
        if (l.dead || l.flee > 0) continue;
        if ([scorpion.head, ...scorpion.body].some((n) => Math.hypot(n.x - l.head.x, n.y - l.head.y) < 24)) {
          G.lives--;
          G.invuln = 2;
          G.shake = 0.4;
          l.flee = 1.5;
          sfx.hit();
          vibrate(200);
          if (G.lives <= 0) {
            endGame("Un lagarto te ha cazado");
            return;
          }
          break;
        }
      }
    }
    lizards = lizards.filter((l) => !(l.dead && l.offscreen()));

    for (const p of popups) {
      p.y -= 0.5;
      p.life -= dt;
    }
    for (let i = popups.length - 1; i >= 0; i--) if (popups[i].life <= 0) popups.splice(i, 1);

    if (G.energy <= 0) {
      G.energy = 0;
      endGame("Te has quedado sin energía");
    }
    G.shake = Math.max(0, G.shake - dt);
  }

  // ---------- interfaz ----------

  function textShadow(str, x, y, size, align = "left", color = "rgb(250,240,225)") {
    ctx.font = `bold ${size}px ${font}`;
    ctx.textAlign = align;
    ctx.fillStyle = "rgba(40,25,10,0.8)";
    ctx.fillText(str, x + 1, y + 1);
    ctx.fillStyle = color;
    ctx.fillText(str, x, y);
  }

  function roundBox(x, y, w, h, r, fill) {
    ctx.fillStyle = fill;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, y, w, h, r);
    else ctx.rect(x, y, w, h);
    ctx.fill();
  }

  function drawDayNightButton() {
    const b = topButton(), cx = b.x + b.w / 2, cy = b.y + b.h / 2;
    roundBox(b.x, b.y, b.w, b.h, 8, "rgba(20,14,8,0.45)");
    if (night) {
      ctx.fillStyle = ctx.strokeStyle = "rgb(255,210,90)";
      ctx.lineWidth = 2;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.arc(cx, cy, 5.5, 0, Math.PI * 2);
      ctx.fill();
      for (let i = 0; i < 8; i++) {
        const a = (i * Math.PI) / 4;
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(a) * 8.5, cy + Math.sin(a) * 8.5);
        ctx.lineTo(cx + Math.cos(a) * 12, cy + Math.sin(a) * 12);
        ctx.stroke();
      }
    } else {
      ctx.save();
      ctx.beginPath();
      ctx.rect(b.x, b.y, b.w, b.h);
      ctx.arc(cx + 5, cy - 4, 8, 0, Math.PI * 2);
      ctx.clip("evenodd");
      ctx.fillStyle = "rgb(235,235,255)";
      ctx.beginPath();
      ctx.arc(cx, cy, 10, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  function heart(x, y, full) {
    ctx.beginPath();
    ctx.moveTo(x, y + 7);
    ctx.bezierCurveTo(x - 11, y - 1, x - 6, y - 10, x, y - 4);
    ctx.bezierCurveTo(x + 6, y - 10, x + 11, y - 1, x, y + 7);
    ctx.fillStyle = full ? "rgb(228,58,70)" : "rgba(0,0,0,0.35)";
    ctx.fill();
    ctx.strokeStyle = "rgba(40,20,10,0.7)";
    ctx.lineWidth = 1.2;
    ctx.stroke();
  }

  function drawHUD() {
    for (let i = 0; i < Math.max(3, G.lives); i++) heart(20 + i * 26, 24, i < G.lives);
    textShadow(`Puntos: ${Math.floor(G.score)}`, 12, 56, 16);

    // barra de energía
    const bw = Math.min(170, W * 0.32), bx = W / 2 - bw / 2 - 20, by = 14, bh = 18;
    roundBox(bx - 2, by - 2, bw + 4, bh + 4, 6, "rgba(20,14,8,0.5)");
    const low = G.energy < 0.3;
    const color = low ? (Math.floor(G.time * 4) % 2 ? "rgb(230,70,60)" : "rgb(160,40,35)") : "rgb(120,200,80)";
    roundBox(bx, by, Math.max(0, bw * G.energy), bh, 5, color);
    textShadow("Energía", bx + bw / 2, by + 14, 12, "center");

    // botones: sonido y pausa
    const s = soundButton(), p = topButton();
    roundBox(s.x, s.y, s.w, s.h, 8, "rgba(20,14,8,0.45)");
    roundBox(p.x, p.y, p.w, p.h, 8, "rgba(20,14,8,0.45)");
    ctx.fillStyle = ctx.strokeStyle = "rgb(245,235,220)";
    const cx = s.x + 12, cy = s.y + s.h / 2;
    ctx.beginPath();
    ctx.moveTo(cx - 5, cy - 4); ctx.lineTo(cx - 1, cy - 4); ctx.lineTo(cx + 5, cy - 9);
    ctx.lineTo(cx + 5, cy + 9); ctx.lineTo(cx - 1, cy + 4); ctx.lineTo(cx - 5, cy + 4);
    ctx.closePath();
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.beginPath();
    if (sfx.on) {
      ctx.arc(cx + 6, cy, 6, -0.9, 0.9);
      ctx.moveTo(cx + 15, cy - 8); ctx.arc(cx + 6, cy, 11, -0.85, 0.85);
    } else {
      ctx.moveTo(cx + 9, cy - 5); ctx.lineTo(cx + 18, cy + 5);
      ctx.moveTo(cx + 18, cy - 5); ctx.lineTo(cx + 9, cy + 5);
    }
    ctx.stroke();
    ctx.fillRect(p.x + 12, p.y + 10, 4, 16);
    ctx.fillRect(p.x + 20, p.y + 10, 4, 16);

    for (const pp of popups) {
      ctx.globalAlpha = Math.min(1, pp.life * 2);
      textShadow(pp.text, pp.x, pp.y, 18, "center", "rgb(255,230,120)");
      ctx.globalAlpha = 1;
    }
  }

  function drawScreen(title, lines, action, titleSize = 40) {
    ctx.fillStyle = "rgba(15,10,5,0.6)";
    ctx.fillRect(0, 0, W, H);
    let y = H / 2 - 40 - lines.length * 13;
    textShadow(title, W / 2, y, titleSize, "center", "rgb(255,215,120)");
    y += 40;
    for (const [text, size, color] of lines) {
      textShadow(text, W / 2, y, size || 16, "center", color);
      y += (size || 16) + 12;
    }
    if (action && Math.floor(performance.now() / 500) % 2 === 0) {
      textShadow(action, W / 2, y + 26, 20, "center", "rgb(255,255,255)");
    }
  }

  function drawOverlay() {
    const tap = isTouch ? "Toca" : "Haz clic";
    if (G.state === "menu") {
      const how = isTouch
        ? ["Arrastra el dedo para moverte", "Toca rápido para picar"]
        : ["Mueve el ratón para moverte", "Clic o espacio para picar"];
      drawScreen("ESCORPIÓN", [
        ["Cazador del desierto", 20, "rgb(240,200,140)"],
        ["", 4],
        [how[0], 16], [how[1], 16],
        ["Come insectos para no quedarte sin energía", 16],
        ["Pica a los lagartos antes de que te muerdan", 16],
        ["", 4],
        [`Récord: ${G.best}`, 18, "rgb(255,230,120)"],
      ], `${tap} para jugar`, 46);
    } else if (G.state === "over") {
      drawScreen("FIN DEL JUEGO", [
        [G.reason, 18, "rgb(240,200,140)"],
        ["", 4],
        [`Puntos: ${G.score}`, 24],
        [G.newBest ? "¡Nuevo récord!" : `Récord: ${G.best}`, 20, "rgb(255,230,120)"],
      ], G.overT > 0.8 ? `${tap} para jugar otra vez` : "");
    } else if (G.state === "pause") {
      drawScreen("PAUSA", [[`${tap} para seguir`, 18]], "");
    }
  }

  let t = 0, last = performance.now(), acc = 0;

  function frame(now) {
    acc += Math.min(now - last, 100);
    last = now;
    while (acc >= DT) {
      if (G.state !== "pause") {
        t += 1 / 60;
        if (G.state === "playing") gameStep();
        else demoStep(t);
        if (G.state === "over") G.overT += 1 / 60;
        nightT += ((night ? 1 : 0) - nightT) * 0.05;
      }
      acc -= DT;
    }

    // temblor de pantalla cuando te muerden
    canvas.style.transform = G.shake > 0
      ? `translate(${(Math.random() - 0.5) * 10}px,${(Math.random() - 0.5) * 10}px)`
      : "";

    const n = nightT;
    for (const key in DIA) P[key] = mix(DIA[key], UV[key], n);

    // fondo de día y de noche mezclados
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.drawImage(background, 0, 0);
    if (n > 0.01) {
      ctx.globalAlpha = n;
      ctx.drawImage(nightBackground, 0, 0);
      ctx.globalAlpha = 1;
    }
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    for (const [x, y, life] of scorpion.footprints) {
      ctx.fillStyle = `rgba(95,68,38,${0.6 * life * (1 - 0.7 * n)})`;
      ctx.beginPath();
      ctx.ellipse(x, y, 3, 2, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    for (const p of scorpion.particles) {
      const c = mix(p.color, [60, 70, 100], n);
      ctx.fillStyle = `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${0.7 * p.life})`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 1.5 + (1 - p.life) * 3, 0, Math.PI * 2);
      ctx.fill();
    }

    const drawWorld = (g) => {
      for (const b of bugs) if (!b.caught) b.draw(g, n);
      for (const l of lizards) l.draw(g, n);
      const blink = G.invuln > 0 && Math.floor(G.invuln * 10) % 2 === 0;
      if (blink && !shadowPass) g.globalAlpha = 0.4;
      scorpion.draw(g, n);
      g.globalAlpha = 1;
    };

    // sombra: silueta negra (lo que está más alto, más desplazado) y difuminada
    sctx.setTransform(1, 0, 0, 1, 0, 0);
    sctx.clearRect(0, 0, slayer.width, slayer.height);
    sctx.setTransform(scale, 0, 0, scale, 0, 0);
    shadowPass = true;
    drawWorld(sctx);
    shadowPass = false;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.save();
    const far = slayer.width + 50;
    ctx.shadowColor = `rgba(0,0,0,${0.36 * (1 - 0.5 * n)})`;
    ctx.shadowBlur = 6 * scale;
    ctx.shadowOffsetX = far;
    ctx.drawImage(slayer, -far, 0);
    ctx.restore();

    // escorpión, lagartos y presas
    lctx.setTransform(1, 0, 0, 1, 0, 0);
    lctx.clearRect(0, 0, layer.width, layer.height);
    lctx.setTransform(scale, 0, 0, scale, 0, 0);
    drawWorld(lctx);
    ctx.drawImage(layer, 0, 0);

    // de noche brilla como un escorpión de verdad bajo luz UV
    if (n > 0.01) {
      ctx.save();
      ctx.globalAlpha = 0.45 * n;
      ctx.globalCompositeOperation = "lighter";
      ctx.shadowColor = "rgb(80,255,215)";
      ctx.shadowBlur = 18 * scale;
      ctx.drawImage(layer, 0, 0);
      ctx.restore();
    }

    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    if (GAME) {
      if (G.state === "playing" || G.state === "pause") drawHUD();
      drawOverlay();
    } else {
      textShadow(hint, 14, 24, 14);
      textShadow(`Presas: ${scorpion.eaten}`, W - 56, 33, 14, "right");
      drawDayNightButton();
    }

    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
