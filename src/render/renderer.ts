// WebGL renderer, studio lighting and post-processing shared by every view.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { SMAAPass } from 'three/examples/jsm/postprocessing/SMAAPass.js';
import { clipPlanes } from './materials';

export type Quality = 'low' | 'medium' | 'high' | 'ultra';

export const QUALITY: Record<Quality, { label: string; pixelRatio: number; ao: boolean; shadows: boolean; shadowMap: number; smaa: boolean; msaa: number }> = {
  low: { label: 'Low (fast)', pixelRatio: 0.75, ao: false, shadows: false, shadowMap: 1024, smaa: false, msaa: 0 },
  medium: { label: 'Medium', pixelRatio: 1, ao: false, shadows: true, shadowMap: 2048, smaa: true, msaa: 0 },
  high: { label: 'High', pixelRatio: 1.5, ao: true, shadows: true, shadowMap: 2048, smaa: false, msaa: 4 },
  ultra: { label: 'Ultra (4K)', pixelRatio: 2, ao: true, shadows: true, shadowMap: 4096, smaa: false, msaa: 4 },
};

export class Stage {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly key: THREE.DirectionalLight;
  readonly rim: THREE.DirectionalLight;
  readonly fill: THREE.HemisphereLight;
  readonly floor: THREE.Mesh;
  private composer!: EffectComposer;
  private gtao?: GTAOPass;
  private renderPass!: RenderPass;
  quality: Quality;
  private dirty = true;
  private width = 1;
  private height = 1;
  onBeforeRender: (() => void)[] = [];

  constructor(readonly container: HTMLElement, quality: Quality = 'high') {
    this.quality = quality;
    this.renderer = new THREE.WebGLRenderer({ antialias: false, alpha: false, powerPreference: 'high-performance', preserveDrawingBuffer: false });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.localClippingEnabled = true;
    container.appendChild(this.renderer.domElement);
    this.renderer.domElement.classList.add('stage-canvas');

    this.camera = new THREE.PerspectiveCamera(32, 1, 0.01, 50);
    this.camera.position.set(0, 1.0, 4.2);

    // Studio: soft room reflections, warm key, cool rim, subtle hemisphere fill.
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.55;
    this.scene.background = new THREE.Color('#0b0e13');

    this.key = new THREE.DirectionalLight('#fff1e0', 2.6);
    this.key.position.set(1.8, 3.2, 2.6);
    this.key.castShadow = true;
    this.key.shadow.bias = -0.0004;
    this.key.shadow.normalBias = 0.02;
    this.key.shadow.radius = 4;
    const sc = this.key.shadow.camera;
    sc.left = -1.2; sc.right = 1.2; sc.top = 2.1; sc.bottom = -0.3; sc.near = 0.5; sc.far = 8;
    this.scene.add(this.key, this.key.target);
    this.key.target.position.set(0, 0.9, 0);

    this.rim = new THREE.DirectionalLight('#9cc4ff', 1.6);
    this.rim.position.set(-2.5, 2.4, -3);
    this.scene.add(this.rim);

    this.fill = new THREE.HemisphereLight('#dfe8ff', '#2a1d18', 0.35);
    this.scene.add(this.fill);

    // Floor: a soft radial pool of light that receives the body's shadow.
    const floorTex = radialTexture();
    this.floor = new THREE.Mesh(
      new THREE.CircleGeometry(2.4, 96),
      new THREE.MeshStandardMaterial({ color: '#1a1f27', roughness: 0.92, metalness: 0, map: floorTex, transparent: true }),
    );
    this.floor.rotation.x = -Math.PI / 2;
    this.floor.receiveShadow = true;
    this.floor.renderOrder = -1;
    this.scene.add(this.floor);

    this.buildComposer();
    this.applyQuality(quality);
    new ResizeObserver(() => this.resize()).observe(container);
    this.resize();
    this.renderer.setAnimationLoop(() => this.frame());
  }

  private buildComposer() {
    const q = QUALITY[this.quality];
    const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: q.msaa });
    this.composer = new EffectComposer(this.renderer, rt);
    this.renderPass = new RenderPass(this.scene, this.camera);
    this.composer.addPass(this.renderPass);
    if (q.ao) {
      this.gtao = new GTAOPass(this.scene, this.camera, 1, 1);
      this.gtao.output = GTAOPass.OUTPUT.Default;
      this.gtao.blendIntensity = 0.85;
      this.gtao.updateGtaoMaterial({ radius: 0.06, distanceExponent: 1.4, thickness: 1.2, scale: 1.1, samples: 12 });
      this.gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 12 });
      this.composer.addPass(this.gtao);
      this.setAOClipping(this.aoClip);
    } else this.gtao = undefined;
    this.composer.addPass(new OutputPass());
    if (q.smaa) this.composer.addPass(new SMAAPass());
  }

  private aoClip = false;
  /** While a region is isolated the AO normal pass must ignore clipped-away geometry. */
  setAOClipping(on: boolean) {
    this.aoClip = on;
    if (this.gtao) {
      const nm = (this.gtao as any).normalMaterial as THREE.Material;
      nm.clippingPlanes = on ? clipPlanes : null;
      nm.needsUpdate = true;
    }
    this.invalidate();
  }

  applyQuality(q: Quality) {
    this.quality = q;
    const cfg = QUALITY[q];
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.renderer.setPixelRatio(Math.max(0.5, cfg.pixelRatio * (q === 'ultra' ? Math.max(1, dpr) : dpr > 1 ? dpr * 0.75 : 1)));
    this.renderer.shadowMap.enabled = cfg.shadows;
    this.key.castShadow = cfg.shadows;
    this.key.shadow.mapSize.set(cfg.shadowMap, cfg.shadowMap);
    this.key.shadow.map?.dispose();
    (this.key.shadow as any).map = null;
    this.composer?.dispose();
    this.buildComposer();
    this.resize();
    this.invalidate();
  }

  resize() {
    const w = Math.max(1, this.container.clientWidth);
    const h = Math.max(1, this.container.clientHeight);
    this.width = w; this.height = h;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = `${w}px`;
    this.renderer.domElement.style.height = `${h}px`;
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.composer.setSize(w, h);
    this.invalidate();
  }

  /** Request a redraw (rendering is on-demand to keep laptops cool). */
  invalidate() { this.dirty = true; }
  continuous = false;

  private frame() {
    for (const f of this.onBeforeRender) f();
    if (!this.dirty && !this.continuous) return;
    this.dirty = false;
    this.composer.render();
  }

  /** Renders one frame at the requested size (default 3840×2160) and returns a PNG blob. */
  async screenshot(width = 3840, height = 2160): Promise<Blob> {
    const prevRatio = this.renderer.getPixelRatio();
    const prevAspect = this.camera.aspect;
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(width, height, false);
    this.composer.setPixelRatio(1);
    this.composer.setSize(width, height);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.composer.render();
    const blob = await new Promise<Blob>((resolve, reject) =>
      this.renderer.domElement.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/png'),
    );
    this.renderer.setPixelRatio(prevRatio);
    this.camera.aspect = prevAspect;
    this.resize();
    return blob;
  }

  get size() { return { width: this.width, height: this.height }; }
}

function radialTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(128, 128, 0, 128, 128, 128);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.55, 'rgba(255,255,255,0.55)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 256, 256);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
