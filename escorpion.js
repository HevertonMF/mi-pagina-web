// Escorpión procedural: cinemática inversa en un <canvas id="escorpion">
"use strict";
(() => {
  const canvas = document.getElementById("escorpion");
  if (!canvas) return;

  let W = 800, H = 560;
  const DT = 1000 / 60;
  const LUZ = [-0.55, -0.83]; // la luz viene de arriba a la izquierda
  const COLOR = {
    arena: [201, 170, 124],
    contorno: [52, 30, 14],
    cuerpo: [178, 110, 45],
    pata: [188, 128, 58],
    pinza: [172, 104, 42],
    cola: [190, 120, 50],
    telson: [214, 150, 72],
    aguijon: [45, 22, 12],
  };

  const rgb = (c, a = 1) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;
  const lighten = (c, f) => c.map((v) => v + (255 - v) * f);
  const darken = (c, f) => c.map((v) => v * (1 - f));
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const wrap = (a) => {
    const t = 2 * Math.PI;
    return (((a + Math.PI) % t) + t) % t - Math.PI;
  };

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

    followMouse(mx, my) {
      const dx = mx - this.x, dy = my - this.y;
      if (Math.hypot(dx, dy) > 60) {
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
        const p = this.progress;
        const e = p * p * (3 - 2 * p);
        this.footX = this.startX + (this.goalX - this.startX) * e;
        this.footY = this.startY + (this.goalY - this.startY) * e;
      }
      this.solveIK(this.footX, this.footY);
    }
  }

  class Scorpion {
    constructor(x, y) {
      this.head = new Creature(x, y, 3.0, 0.15, 0.06);

      this.body = [];
      this.bodyRadius = [15, 18, 19, 19, 17, 14];
      let parent = this.head;
      this.bodyRadius.forEach((_, i) => {
        const seg = new Segment(parent, i === 0 ? 18 : 13, i === 0 ? Math.PI : 0, 0.35);
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

      this.tail = [];
      parent = this.body[this.body.length - 1];
      for (let i = 0; i < 6; i++) {
        const seg = new Segment(parent, 16, 0, 0.6, 0.25);
        this.tail.push(seg);
        parent = seg;
      }

      this.pinch = 0;
      this.footprints = [];
    }

    update(mx, my, t, clicking) {
      this.head.followMouse(mx, my);
      for (const seg of this.body) seg.follow();
      for (const [, arm, forearm] of this.claws) {
        arm.updateRelative(false, true);
        forearm.updateRelative(false, true);
      }
      this.tail.forEach((seg, i) => {
        seg.baseAngle = 0.22 + 0.14 * Math.sin(t * 2 - i * 0.6);
        seg.follow();
      });

      const was = this.legs.map((l) => l.stepping);
      for (const system of this.head.systems) system.update(mx, my);
      this.legs.forEach((leg, i) => {
        if (was[i] && !leg.stepping) this.footprints.push([leg.goalX, leg.goalY, 1]);
      });
      for (const fp of this.footprints) fp[2] -= 1 / (60 * 5);
      this.footprints = this.footprints.filter((fp) => fp[2] > 0);

      this.pinch += ((clicking ? 1 : 0) - this.pinch) * 0.3;
    }

    // ---------- dibujo ----------

    draw(g) {
      this.drawTail(g);
      for (const leg of this.legs) this.drawLeg(g, leg);
      for (let i = this.body.length - 1; i >= 0; i--) {
        this.drawPlate(g, this.body[i], this.bodyRadius[i]);
      }
      this.drawCarapace(g);
      for (const [side, arm, forearm] of this.claws) this.drawClaw(g, side, arm, forearm);
    }

    drawLeg(g, leg) {
      const knee = leg.thigh, foot = leg.shin;
      const d = foot.absAngle;
      const tarsus = [foot.x + 9 * Math.cos(d), foot.y + 9 * Math.sin(d)];
      const pts = [[leg.hip.x, leg.hip.y], [knee.x, knee.y], [foot.x, foot.y], tarsus];
      shadedRibbon(g, pts, [4.4, 3.4, 1.9, 0.6], COLOR.pata);
      circle(g, darken(COLOR.pata, 0.45), knee.x, knee.y, 2.6);
      circle(g, darken(COLOR.pata, 0.45), foot.x, foot.y, 1.8);
      for (const f of [0.3, 0.55, 0.8]) {
        const hx = knee.x + (foot.x - knee.x) * f;
        const hy = knee.y + (foot.y - knee.y) * f;
        const a = d + leg.side * 0.9;
        line(g, COLOR.contorno, [hx, hy], [hx + 4.5 * Math.cos(a), hy + 4.5 * Math.sin(a)], 0.7);
      }
    }

    drawPlate(g, seg, r) {
      const d = seg.absAngle;
      const ca = Math.cos(d), sa = Math.sin(d), px = -sa, py = ca;
      shadedOval(g, seg.x, seg.y, d, 9.5, r, COLOR.cuerpo);
      const dark = darken(COLOR.cuerpo, 0.35);
      const bx = seg.x + ca * 7.5, by = seg.y + sa * 7.5;
      line(g, dark, [bx - px * r * 0.8, by - py * r * 0.8], [bx + px * r * 0.8, by + py * r * 0.8], 1.6);
      line(g, dark, [seg.x - ca * 6, seg.y - sa * 6], [seg.x + ca * 6, seg.y + sa * 6], 1.2);
      for (const s of [-1, 1]) {
        circle(g, dark, seg.x + px * r * 0.45 * s, seg.y + py * r * 0.45 * s, 1.5);
      }
    }

    drawCarapace(g) {
      const h = this.head, d = h.absAngle;
      const ca = Math.cos(d), sa = Math.sin(d), px = -sa, py = ca;
      const cx = h.x - ca * 3, cy = h.y - sa * 3;
      shadedOval(g, cx, cy, d, 17, 15.5, COLOR.cuerpo);
      const dark = darken(COLOR.cuerpo, 0.4);
      line(g, dark, [cx - ca * 12, cy - sa * 12], [cx + ca * 2, cy + sa * 2], 1.2);
      const fx = cx + ca * 17, fy = cy + sa * 17;
      poly(g, COLOR.contorno, [[fx + px * 3, fy + py * 3], [fx - px * 3, fy - py * 3],
                               [fx - ca * 3.5, fy - sa * 3.5]]);
      const ex = cx + ca * 5, ey = cy + sa * 5;
      shadedOval(g, ex, ey, d, 4, 5, lighten(COLOR.cuerpo, 0.1));
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

    drawClaw(g, side, arm, forearm) {
      const h = this.head, d0 = h.absAngle;
      const base = [h.x + 9 * Math.cos(d0 + side * 0.8), h.y + 9 * Math.sin(d0 + side * 0.8)];
      shadedRibbon(g, [base, [arm.x, arm.y], [forearm.x, forearm.y]], [4.2, 5.2, 6.2], COLOR.pinza);
      circle(g, darken(COLOR.pinza, 0.4), arm.x, arm.y, 2.8);

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
        shadedRibbon(g, finger, [5, 3.8, 2.3, 0.6], darken(COLOR.pinza, 0.15));
        circle(g, COLOR.aguijon, x, y, 1.3);
      }
      shadedOval(g, hx, hy, d, 16, 11, COLOR.pinza);
      for (const [f, q] of [[-4, 3], [2, -3], [6, 2], [-1, 0]]) {
        circle(g, darken(COLOR.pinza, 0.3), hx + ca * f + px * q, hy + sa * f + py * q, 1.1);
      }
    }

    drawTail(g) {
      const chain = [this.body[this.body.length - 1], ...this.tail];
      for (let i = this.tail.length - 1; i >= 0; i--) {
        const a = chain[i], b = chain[i + 1];
        const cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
        const d = b.absAngle, w = 7.5 + i * 0.3;
        shadedOval(g, cx, cy, d, b.size / 2 + 2.5, w, COLOR.cola);
        const ca = Math.cos(d), sa = Math.sin(d), px = -sa, py = ca;
        const dark = darken(COLOR.cola, 0.35);
        for (const s of [-1, 1]) {
          const ox = px * w * 0.45 * s, oy = py * w * 0.45 * s;
          line(g, dark, [cx - ca * 5 + ox, cy - sa * 5 + oy], [cx + ca * 5 + ox, cy + sa * 5 + oy], 0.9);
        }
      }
      const seg = this.tail[this.tail.length - 1];
      const d = seg.absAngle;
      const ca = Math.cos(d), sa = Math.sin(d), px = -sa, py = ca;
      const cx = seg.x + ca * 8, cy = seg.y + sa * 8;
      const at = (f, q) => [cx + ca * f + px * q, cy + sa * f + py * q];
      shadedRibbon(g, [at(7, 0), at(13, 2.5), at(17, 7), at(18, 12)], [3.4, 2.4, 1.2, 0.3], COLOR.aguijon);
      shadedOval(g, cx, cy, d, 10, 7.5, COLOR.telson);
    }

    points() {
      const nodes = [this.head, ...this.body, ...this.tail];
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
    g.ellipse(cx, cy, a, b, ang, 0, Math.PI * 2);
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
    oval(g, COLOR.contorno, cx, cy, ang, a + 1.6, b + 1.6);
    oval(g, base, cx, cy, ang, a, b);
    const k = Math.min(a, b);
    oval(g, lighten(base, 0.22), cx + LUZ[0] * k * 0.35, cy + LUZ[1] * k * 0.35, ang, a * 0.62, b * 0.55);
    circle(g, lighten(base, 0.55), cx + LUZ[0] * k * 0.55, cy + LUZ[1] * k * 0.55, k * 0.2);
  }

  function shadedRibbon(g, pts, widths, base) {
    ribbon(g, COLOR.contorno, pts, widths.map((w) => w + 1.4));
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
    g.fillStyle = rgb(COLOR.arena);
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
      g.fillStyle = rgb(COLOR.arena.map((c) => clamp(c + v, 0, 255)));
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

  // ---------- bucle principal ----------

  const scale = Math.min(window.devicePixelRatio || 1, 2);
  const ctx = canvas.getContext("2d");
  const layer = document.createElement("canvas");
  const lctx = layer.getContext("2d");
  const font = getComputedStyle(canvas).fontFamily || "monospace";
  const isTouch = window.matchMedia("(pointer: coarse)").matches;
  let background = null;
  let lastWidth = 0;

  // En pantallas estrechas (móvil) el mundo es más pequeño, así el escorpión se ve más grande
  function resize() {
    const cw = canvas.clientWidth || 800;
    const ch = canvas.clientHeight || 560;
    if (cw === lastWidth) return;
    lastWidth = cw;
    W = cw < 600 ? 460 : 800;
    H = Math.round((W * ch) / cw);
    canvas.width = layer.width = W * scale;
    canvas.height = layer.height = H * scale;
    background = buildBackground(scale);
  }
  resize();
  window.addEventListener("resize", resize);

  const scorpion = new Scorpion(W / 2, H / 2);
  let mouse = null;
  let clicking = false;
  let tapPinch = 0;

  function toWorld(e) {
    const r = canvas.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * W, ((e.clientY - r.top) / r.height) * H];
  }
  canvas.addEventListener("pointermove", (e) => { mouse = toWorld(e); });
  canvas.addEventListener("pointerleave", () => { mouse = null; clicking = false; });
  canvas.addEventListener("pointerdown", (e) => {
    mouse = toWorld(e);
    if (e.pointerType === "touch") tapPinch = 0.4; // en el móvil, tocar cierra las pinzas un momento
    else clicking = true;
  });
  window.addEventListener("pointerup", (e) => {
    clicking = false;
    if (e.pointerType === "touch") mouse = null;
  });
  const hint = isTouch
    ? "Toca y arrastra el dedo para guiarlo"
    : "Mueve el ratón · Mantén pulsado para cerrar las pinzas";

  let t = 0, last = performance.now(), acc = 0;

  function frame(now) {
    acc += Math.min(now - last, 100);
    last = now;
    while (acc >= DT) {
      t += 1 / 60;
      let target = mouse;
      if (!target) {
        // sin ratón encima, pasea solo dibujando un 8
        const w = (2 * Math.PI) / 10;
        target = [W / 2 + W * 0.35 * Math.sin(w * t), H / 2 + H * 0.28 * Math.sin(2 * w * t)];
      }
      tapPinch = Math.max(0, tapPinch - 1 / 60);
      scorpion.update(target[0], target[1], t, clicking || tapPinch > 0);
      acc -= DT;
    }

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(background, 0, 0);
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    for (const [x, y, life] of scorpion.footprints) {
      ctx.fillStyle = `rgba(95,68,38,${0.6 * life})`;
      ctx.beginPath();
      ctx.ellipse(x, y, 3, 2, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    lctx.setTransform(1, 0, 0, 1, 0, 0);
    lctx.clearRect(0, 0, layer.width, layer.height);
    lctx.setTransform(scale, 0, 0, scale, 0, 0);
    scorpion.draw(lctx);

    // sombra difuminada con la misma silueta del escorpión
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,0.38)";
    ctx.shadowBlur = 8 * scale;
    ctx.shadowOffsetX = 8 * scale;
    ctx.shadowOffsetY = 11 * scale;
    ctx.drawImage(layer, 0, 0);
    ctx.restore();

    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.font = `bold 14px ${font}`;
    ctx.fillStyle = "rgba(40,25,10,0.8)";
    ctx.fillText(hint, 15, 25);
    ctx.fillStyle = "rgb(250,240,225)";
    ctx.fillText(hint, 14, 24);

    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
