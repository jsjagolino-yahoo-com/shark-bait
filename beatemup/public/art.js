// Stick-fighter drawing shared by the phone and the big screen.
(function () {
  const lerp = (a, b, t) => a + (b - a) * t;
  const ease = (t) => 1 - Math.pow(1 - t, 3);

  // Arm angle (radians, 0 = straight forward, + = down) during a swing, p in [0,1].
  function swingAngle(p) {
    const IDLE = 0.9, BACK = -2.3, STRIKE = 0.55;
    if (p < 0 || p >= 1) return IDLE;
    if (p < 0.3) return lerp(IDLE, BACK, ease(p / 0.3));
    if (p < 0.55) return lerp(BACK, STRIKE, ease((p - 0.3) / 0.25));
    return lerp(STRIKE, IDLE, (p - 0.55) / 0.45);
  }

  function line(ctx, x1, y1, x2, y2) {
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  }

  /**
   * Draws a fighter standing at (x, y) = feet position. s = pixels per unit (figure is ~100 units tall).
   * o: { hue, animal, facing, t, walking, swingP, hitP, fall (0..1), alpha }
   */
  function fighter(ctx, x, y, s, o) {
    const facing = o.facing || 1;
    const fall = o.fall || 0;
    ctx.save();
    ctx.globalAlpha = o.alpha == null ? 1 : o.alpha;
    ctx.translate(x, y);
    ctx.scale(s, s);

    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    ctx.beginPath();
    ctx.ellipse(0, 0, 28 + fall * 30, 7, 0, 0, Math.PI * 2);
    ctx.fill();

    if (fall > 0) ctx.rotate(-facing * (Math.PI / 2) * ease(fall));
    ctx.scale(facing, 1);

    const hit = o.hitP >= 0 && o.hitP < 1 ? 1 - o.hitP : 0;
    const lean = -10 * hit;
    const stride = o.walking && !fall ? Math.sin(o.t * 13) * 14 : 0;
    const bob = o.walking && !fall ? Math.abs(Math.cos(o.t * 13)) * 2 : 0;
    const hipX = lean * 0.3, hipY = -40 - bob;
    const neckX = lean, neckY = -72 - bob;
    const color = hit > 0.3 ? '#ff4060' : `hsl(${o.hue} 80% 60%)`;

    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = color;
    ctx.lineWidth = 5;

    // legs (hip -> knee -> foot)
    for (const sgn of [1, -1]) {
      const fx = stride * sgn;
      const kx = fx * 0.5 + 5;
      line(ctx, hipX, hipY, kx, -20);
      line(ctx, kx, -20, fx, 0);
    }
    // body
    line(ctx, hipX, hipY, neckX, neckY);
    // back arm
    const shX = neckX, shY = neckY + 6;
    line(ctx, shX, shY, shX - 12, shY + 20);
    line(ctx, shX - 12, shY + 20, shX - 6 + stride * 0.4, shY + 36);

    // front arm + stick
    const a = swingAngle(o.swingP == null ? -1 : o.swingP);
    const handX = shX + Math.cos(a) * 26;
    const handY = shY + Math.sin(a) * 26;
    line(ctx, shX, shY, handX, handY);
    const swinging = o.swingP >= 0 && o.swingP < 1;
    const stickA = swinging ? a - 0.25 : -0.9;
    ctx.strokeStyle = '#8b5a2b';
    ctx.lineWidth = 6;
    line(ctx, handX - Math.cos(stickA) * 6, handY - Math.sin(stickA) * 6, handX + Math.cos(stickA) * 52, handY + Math.sin(stickA) * 52);
    ctx.strokeStyle = '#6b3f17';
    ctx.lineWidth = 2;
    line(ctx, handX + Math.cos(stickA) * 30, handY + Math.sin(stickA) * 30, handX + Math.cos(stickA) * 50, handY + Math.sin(stickA) * 50);

    // swoosh trail during the strike
    if (swinging && o.swingP > 0.28 && o.swingP < 0.65) {
      ctx.strokeStyle = 'rgba(255,255,255,0.55)';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(shX, shY, 70, -2.0, 0.5);
      ctx.stroke();
    }

    // head (animal emoji) — un-mirror so the emoji reads normally
    ctx.save();
    ctx.translate(neckX, neckY - 20);
    ctx.scale(facing, 1);
    if (hit > 0) ctx.rotate(-0.25 * hit * facing);
    ctx.fillStyle = '#000'; // emoji take their opacity from fillStyle, so make it solid
    ctx.font = '42px "Segoe UI Emoji","Apple Color Emoji","Noto Color Emoji",sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(o.animal || '🐶', 0, 0);
    if (fall >= 1) {
      ctx.font = 'bold 18px sans-serif';
      ctx.fillStyle = '#fff';
      ctx.fillText('✖ ✖', 0, -2);
    }
    ctx.restore();

    ctx.restore();
  }

  window.Art = { fighter };
})();
