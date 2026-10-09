import * as THREE from 'three';

const BASE_FOV = 60;
const DASH_FOV = 68;
const tmpA = new THREE.Vector3();
const tmpB = new THREE.Vector3();

// VS-style camera: behind the player on the enemy->player line, shifted right,
// pitched by the height difference, pulled in front of buildings, FOV widened while dashing.
export class FollowCamera {
  constructor(camera) {
    this.camera = camera;
    this.yaw = 0;
    this.pos = new THREE.Vector3();
    this.look = new THREE.Vector3();
    this.shakeAmt = 0;
    this.fov = BASE_FOV;
    this.fovKick = 0;
    this.dist = 12.5;
    this.initialized = false;
    this.arena = null;
  }

  shake(a) { this.shakeAmt = Math.min(1.5, this.shakeAmt + a); }
  // momentary FOV punch for heavy hits (stands in for a radial blur)
  kick(deg) { this.fovKick = Math.max(this.fovKick, deg); }

  snap(player, target) {
    this.initialized = false;
    this.update(1, player, target);
  }

  update(dt, player, target) {
    let wantYaw = player.yaw;
    let horiz = 30, dy = 0;
    if (target) {
      const dx = target.pos.x - player.pos.x, dz = target.pos.z - player.pos.z;
      horiz = Math.hypot(dx, dz);
      if (horiz > 2) wantYaw = Math.atan2(dx, dz);
      else wantYaw = this.yaw;
      dy = THREE.MathUtils.clamp(target.pos.y - player.pos.y, -25, 30);
    }
    let d = wantYaw - this.yaw;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    this.yaw += d * Math.min(1, (this.initialized ? 5 : 100) * dt);

    // elevation from the height difference: enemy above -> camera drops and looks up
    const elev = Math.atan2(dy, Math.max(12, horiz));
    const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
    const rx = -fz, rz = fx; // screen-right
    const pivot = tmpA.set(player.pos.x, player.pos.y + 3.4, player.pos.z);
    const camH = THREE.MathUtils.clamp(2.6 - elev * 7, -1.5, 7);
    const side = 2.2;
    const want = new THREE.Vector3(
      pivot.x - fx * 12.5 + rx * side,
      pivot.y + camH,
      pivot.z - fz * 12.5 + rz * side,
    );
    // keep camera inside the arena wall
    const r = Math.hypot(want.x, want.z);
    if (r > 95) { want.x *= 95 / r; want.z *= 95 / r; }

    // pull the camera in front of buildings between the player and the camera
    let fullDist = want.distanceTo(pivot);
    let allowed = fullDist;
    if (this.arena) {
      const dir = tmpB.copy(want).sub(pivot).normalize();
      const hit = this.arena.rayDistance(pivot, dir, fullDist, 0.9);
      if (hit < fullDist) allowed = Math.max(2.5, hit - 0.6);
    }
    // zoom in fast, ease back out
    const k = this.initialized ? (allowed < this.dist ? 1 : Math.min(1, 3 * dt)) : 1;
    this.dist += (allowed - this.dist) * k;
    const scale = Math.min(1, this.dist / fullDist);
    want.sub(pivot).multiplyScalar(scale).add(pivot);
    want.y = Math.max(0.8, want.y);

    // look at a point between the player and the target, biased to the target's height
    const wantLook = new THREE.Vector3(player.pos.x + fx * 10 + rx * side * 0.4, player.pos.y + 3.0 + dy * 0.45, player.pos.z + fz * 10 + rz * side * 0.4);

    if (!this.initialized) { this.pos.copy(want); this.look.copy(wantLook); this.initialized = true; }
    const kp = Math.min(1, 10 * dt);
    this.pos.lerp(want, kp);
    // never let the smoothed position lag into a wall
    if (this.arena) {
      const dir = tmpB.copy(this.pos).sub(pivot);
      const len = dir.length();
      if (len > 0.01) {
        dir.divideScalar(len);
        const hit = this.arena.rayDistance(pivot, dir, len, 0.9);
        if (hit < len) this.pos.copy(pivot).addScaledVector(dir, Math.max(2.5, hit - 0.6));
      }
    }
    this.look.lerp(wantLook, kp);

    // FOV: widen while BD / step, plus hit kick
    const wantFov = (player.dashing ? DASH_FOV : BASE_FOV) + this.fovKick;
    this.fov += (wantFov - this.fov) * Math.min(1, (wantFov > this.fov ? 10 : 4) * dt);
    this.fovKick = Math.max(0, this.fovKick - dt * 40);
    if (Math.abs(this.camera.fov - this.fov) > 0.01) { this.camera.fov = this.fov; this.camera.updateProjectionMatrix(); }

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

  resetFov() { this.fov = BASE_FOV; this.fovKick = 0; this.camera.fov = BASE_FOV; this.camera.updateProjectionMatrix(); }

  // Convert a local stick vector (x right, z forward) to a world-space XZ direction.
  toWorld(mx, mz, out = new THREE.Vector3()) {
    const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
    const rx = -fz, rz = fx;
    return out.set(fx * mz + rx * mx, 0, fz * mz + rz * mx);
  }
}
