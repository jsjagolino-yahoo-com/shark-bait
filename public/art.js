// Shared canvas drawing for the phone and the big screen.
(function () {
  function hash(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  function hueOf(id) {
    return hash(String(id)) % 360;
  }

  // Depth (0 = surface, 100 = shark jaws) -> canvas y.
  function depthToY(depth, H) {
    return H * (0.1 + (depth / 100) * 0.72);
  }

  function sea(ctx, W, H, t) {
    const surfaceY = depthToY(0, H);
    // sky
    const sky = ctx.createLinearGradient(0, 0, 0, surfaceY);
    sky.addColorStop(0, '#9be7ff');
    sky.addColorStop(1, '#d9f6ff');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, surfaceY + 2);

    // water
    const water = ctx.createLinearGradient(0, surfaceY, 0, H);
    water.addColorStop(0, '#29b6f6');
    water.addColorStop(0.35, '#0277bd');
    water.addColorStop(0.75, '#01386b');
    water.addColorStop(1, '#00152e');
    ctx.fillStyle = water;
    ctx.beginPath();
    ctx.moveTo(0, H);
    for (let x = 0; x <= W; x += 16) {
      ctx.lineTo(x, surfaceY + Math.sin(x * 0.02 + t * 1.6) * 5 + Math.sin(x * 0.007 - t) * 4);
    }
    ctx.lineTo(W, H);
    ctx.closePath();
    ctx.fill();

    // light rays
    ctx.save();
    ctx.globalAlpha = 0.07;
    ctx.fillStyle = '#ffffff';
    for (let i = 0; i < 6; i++) {
      const x = ((i + 0.5) / 6) * W + Math.sin(t * 0.3 + i) * 40;
      ctx.beginPath();
      ctx.moveTo(x - 30, surfaceY);
      ctx.lineTo(x + 30, surfaceY);
      ctx.lineTo(x + 140, H * 0.75);
      ctx.lineTo(x - 10, H * 0.75);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();

    // danger glow near the bottom
    const dz = depthToY(70, H);
    const glow = ctx.createLinearGradient(0, dz, 0, H);
    glow.addColorStop(0, 'rgba(255,0,40,0)');
    glow.addColorStop(1, 'rgba(255,0,40,0.28)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, dz, W, H - dz);

    // sea bed
    ctx.fillStyle = '#1b2a3a';
    ctx.beginPath();
    ctx.moveTo(0, H);
    for (let x = 0; x <= W; x += 24) ctx.lineTo(x, H * 0.965 + Math.sin(x * 0.03) * 6);
    ctx.lineTo(W, H);
    ctx.closePath();
    ctx.fill();
  }

  function fish(ctx, x, y, s, hue, dir, t) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(dir, 1);
    const wag = Math.sin(t * 12) * 0.25 * s;
    ctx.fillStyle = `hsl(${hue} 80% 42%)`;
    ctx.beginPath();
    ctx.moveTo(-s * 0.75, 0);
    ctx.lineTo(-s * 1.45, -s * 0.6 + wag);
    ctx.lineTo(-s * 1.45, s * 0.6 + wag);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(-s * 0.2, -s * 0.55);
    ctx.lineTo(s * 0.1, -s * 0.95);
    ctx.lineTo(s * 0.35, -s * 0.5);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = `hsl(${hue} 90% 58%)`;
    ctx.beginPath();
    ctx.ellipse(0, 0, s, s * 0.66, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = `hsl(${hue} 90% 75%)`;
    ctx.beginPath();
    ctx.ellipse(s * 0.1, s * 0.28, s * 0.65, s * 0.25, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(s * 0.45, -s * 0.15, s * 0.24, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#111';
    ctx.beginPath();
    ctx.arc(s * 0.52, -s * 0.15, s * 0.12, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function shark(ctx, x, y, s, dir, mouth, t) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(dir, 1);
    const wag = Math.sin(t * 4) * 0.12 * s;
    const dark = '#4e6375';
    // tail
    ctx.fillStyle = dark;
    ctx.beginPath();
    ctx.moveTo(-s * 0.8, 0);
    ctx.lineTo(-s * 1.35, -s * 0.5 + wag);
    ctx.lineTo(-s * 1.15, 0 + wag * 0.5);
    ctx.lineTo(-s * 1.3, s * 0.32 + wag);
    ctx.closePath();
    ctx.fill();
    // dorsal fin
    ctx.beginPath();
    ctx.moveTo(-s * 0.15, -s * 0.24);
    ctx.lineTo(-s * 0.35, -s * 0.66);
    ctx.lineTo(s * 0.18, -s * 0.24);
    ctx.closePath();
    ctx.fill();
    // body
    ctx.fillStyle = '#6f879b';
    ctx.beginPath();
    ctx.moveTo(s, -s * 0.02);
    ctx.quadraticCurveTo(s * 0.6, -s * 0.33, -s * 0.2, -s * 0.28);
    ctx.quadraticCurveTo(-s * 0.75, -s * 0.2, -s * 0.95, 0);
    ctx.quadraticCurveTo(-s * 0.7, s * 0.2, -s * 0.1, s * 0.27);
    ctx.quadraticCurveTo(s * 0.62, s * 0.28, s, -s * 0.02);
    ctx.fill();
    // belly
    ctx.fillStyle = '#e3ebf1';
    ctx.beginPath();
    ctx.moveTo(s * 0.8, s * 0.1);
    ctx.quadraticCurveTo(s * 0.35, s * 0.3, -s * 0.35, s * 0.2);
    ctx.quadraticCurveTo(s * 0.25, s * 0.12, s * 0.8, s * 0.1);
    ctx.fill();
    // pectoral fin
    ctx.fillStyle = dark;
    ctx.beginPath();
    ctx.moveTo(s * 0.25, s * 0.16);
    ctx.lineTo(-s * 0.05, s * 0.55);
    ctx.lineTo(s * 0.02, s * 0.2);
    ctx.closePath();
    ctx.fill();
    // gills
    ctx.strokeStyle = 'rgba(0,0,0,0.3)';
    ctx.lineWidth = Math.max(1, s * 0.015);
    for (let i = 0; i < 3; i++) {
      ctx.beginPath();
      ctx.moveTo(s * (0.28 + i * 0.05), -s * 0.08);
      ctx.lineTo(s * (0.25 + i * 0.05), s * 0.1);
      ctx.stroke();
    }
    // mouth + teeth
    const m = Math.max(0, Math.min(1, mouth)) * s * 0.22;
    ctx.fillStyle = '#3a0710';
    ctx.beginPath();
    ctx.moveTo(s * 0.97, s * 0.02);
    ctx.lineTo(s * 0.5, s * 0.1);
    ctx.lineTo(s * 0.9, s * 0.1 + m);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#fff';
    const teeth = 5;
    for (let i = 0; i < teeth; i++) {
      const k = i / teeth;
      const tx = s * (0.55 + k * 0.38);
      const ty = s * (0.095 - k * 0.075);
      ctx.beginPath();
      ctx.moveTo(tx, ty);
      ctx.lineTo(tx + s * 0.035, ty);
      ctx.lineTo(tx + s * 0.018, ty + s * 0.05 + m * 0.15);
      ctx.closePath();
      ctx.fill();
    }
    // eye
    ctx.fillStyle = '#0b0b0b';
    ctx.beginPath();
    ctx.arc(s * 0.62, -s * 0.09, s * 0.035, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  window.Art = { hash, hueOf, depthToY, sea, fish, shark };
})();
