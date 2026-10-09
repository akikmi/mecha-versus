import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

// Renderer + post-processing. HIGH: shadows + bloom + MSAA target, LOW: direct render, no shadows, pixelRatio 1.
export class GameRenderer {
  constructor(container, scene, camera, quality = 'high') {
    this.scene = scene;
    this.camera = camera;
    const r = this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.0;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(r.domElement);

    // Image-based lighting for metallic reflections
    const pmrem = new THREE.PMREMGenerator(r);
    const room = new RoomEnvironment(r);
    this.envMap = pmrem.fromScene(room, 0.04).texture;
    room.dispose?.();
    pmrem.dispose();
    scene.environment = this.envMap;

    this.sun = null;
    this.quality = null;
    this.setQuality(quality);
  }

  // The scene's main directional light; its shadow frustum follows the focus point.
  attachSun(light) {
    this.sun = light;
    const s = light.shadow;
    s.mapSize.set(2048, 2048);
    const c = s.camera;
    c.left = -48; c.right = 48; c.top = 48; c.bottom = -48; c.near = 1; c.far = 260;
    c.updateProjectionMatrix();
    s.bias = -0.0004;
    s.normalBias = 0.04;
    this.sunOffset = light.position.clone().sub(light.target.position);
    this.applyShadow();
  }

  applyShadow() { if (this.sun) this.sun.castShadow = this.quality === 'high'; }

  setShadowFocus(p) {
    if (!this.sun || !this.sun.castShadow) return;
    // snap to shadow texels to avoid swimming edges
    const texel = 96 / 2048;
    const x = Math.round(p.x / texel) * texel, z = Math.round(p.z / texel) * texel;
    this.sun.target.position.set(x, 0, z);
    this.sun.position.set(x, 0, z).add(this.sunOffset);
    this.sun.target.updateMatrixWorld();
  }

  setQuality(q) {
    if (q === this.quality) return;
    this.quality = q;
    const r = this.renderer;
    r.setPixelRatio(q === 'high' ? Math.min(devicePixelRatio, 1.5) : 1);
    r.setSize(innerWidth, innerHeight);
    this.applyShadow();
    if (q === 'high') {
      if (!this.composer) {
        const pr = r.getPixelRatio();
        const rt = new THREE.WebGLRenderTarget(innerWidth * pr, innerHeight * pr, { type: THREE.HalfFloatType, samples: 4 });
        this.composer = new EffectComposer(r, rt);
        this.composer.addPass(new RenderPass(this.scene, this.camera));
        this.bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.65, 0.4, 1.15);
        this.composer.addPass(this.bloom);
        this.composer.addPass(new OutputPass());
      }
      this.composer.setPixelRatio(r.getPixelRatio());
      this.composer.setSize(innerWidth, innerHeight);
    }
  }

  resize() {
    this.camera.aspect = innerWidth / innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(innerWidth, innerHeight);
    if (this.composer) this.composer.setSize(innerWidth, innerHeight);
  }

  render(dt) {
    if (this.quality === 'high' && this.composer) this.composer.render(dt);
    else this.renderer.render(this.scene, this.camera);
  }
}

// Linear HDR color for unlit glowing materials (values > 1 feed the bloom pass).
export function hdr(color, k = 1) {
  return new THREE.Color(color).multiplyScalar(k);
}
