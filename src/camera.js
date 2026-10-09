import * as THREE from 'three';

// Behind-the-player camera that keeps the locked target in view (VS-style).
export class FollowCamera {
  constructor(camera) {
    this.camera = camera;
    this.yaw = 0;
    this.pos = new THREE.Vector3();
    this.look = new THREE.Vector3();
    this.shakeAmt = 0;
    this.initialized = false;
  }

  shake(a) { this.shakeAmt = Math.min(1.5, this.shakeAmt + a); }

  snap(player, target) {
    this.initialized = false;
    this.update(1, player, target);
  }

  update(dt, player, target) {
    let wantYaw = player.yaw;
    if (target) {
      const dx = target.pos.x - player.pos.x, dz = target.pos.z - player.pos.z;
      if (dx * dx + dz * dz > 4) wantYaw = Math.atan2(dx, dz);
      else wantYaw = this.yaw;
    }
    let d = wantYaw - this.yaw;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    this.yaw += d * Math.min(1, (this.initialized ? 5 : 100) * dt);

    const dist = 12.5, height = 5.6;
    const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
    const wantPos = new THREE.Vector3(player.pos.x - fx * dist, player.pos.y + height, player.pos.z - fz * dist);
    // keep camera inside the arena wall
    const r = Math.hypot(wantPos.x, wantPos.z);
    if (r > 95) { wantPos.x *= 95 / r; wantPos.z *= 95 / r; }

    // look ahead toward the target, biased to its height
    const wantLook = new THREE.Vector3(player.pos.x + fx * 8, player.pos.y + 3.2, player.pos.z + fz * 8);
    if (target) {
      const dy = THREE.MathUtils.clamp(target.pos.y - player.pos.y, -15, 25);
      wantLook.y += dy * 0.35;
    }
    if (!this.initialized) { this.pos.copy(wantPos); this.look.copy(wantLook); this.initialized = true; }
    const k = Math.min(1, 10 * dt);
    this.pos.lerp(wantPos, k);
    this.look.lerp(wantLook, k);

    this.camera.position.copy(this.pos);
    if (this.shakeAmt > 0) {
      const s = this.shakeAmt * 0.5;
      this.camera.position.x += (Math.random() - 0.5) * s;
      this.camera.position.y += (Math.random() - 0.5) * s;
      this.camera.position.z += (Math.random() - 0.5) * s;
      this.shakeAmt = Math.max(0, this.shakeAmt - dt * 3);
    }
    this.camera.lookAt(this.look);
  }

  // Convert a local stick vector (x right, z forward) to a world-space XZ direction.
  toWorld(mx, mz, out = new THREE.Vector3()) {
    const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
    const rx = -fz, rz = fx;
    return out.set(fx * mz + rx * mx, 0, fz * mz + rz * mx);
  }
}
