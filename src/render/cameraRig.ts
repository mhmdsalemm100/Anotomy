// Orbit camera with damping, zoom-to-cursor and smooth "fly to" animations.
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { Stage } from './renderer';

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

export class CameraRig {
  readonly controls: OrbitControls;
  private anim: { from: [THREE.Vector3, THREE.Vector3]; to: [THREE.Vector3, THREE.Vector3]; t0: number; dur: number; done?: () => void } | null = null;
  autoRotate = false;

  constructor(private stage: Stage) {
    const c = new OrbitControls(stage.camera, stage.renderer.domElement);
    c.enableDamping = true;
    c.dampingFactor = 0.08;
    c.rotateSpeed = 0.7;
    c.zoomSpeed = 0.9;
    c.panSpeed = 0.8;
    c.zoomToCursor = true;
    c.minDistance = 0.05;
    c.maxDistance = 8;
    c.screenSpacePanning = true;
    c.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
    c.addEventListener('change', () => stage.invalidate());
    this.controls = c;
    stage.onBeforeRender.push(() => this.tick());
  }

  private tick() {
    if (this.anim) {
      const k = Math.min(1, (performance.now() - this.anim.t0) / this.anim.dur);
      const e = ease(k);
      this.stage.camera.position.lerpVectors(this.anim.from[0], this.anim.to[0], e);
      this.controls.target.lerpVectors(this.anim.from[1], this.anim.to[1], e);
      this.stage.invalidate();
      if (k >= 1) { const done = this.anim.done; this.anim = null; done?.(); }
    }
    if (this.autoRotate && !this.anim) {
      const t = this.controls.target;
      const p = this.stage.camera.position.clone().sub(t);
      p.applyAxisAngle(new THREE.Vector3(0, 1, 0), 0.0016);
      this.stage.camera.position.copy(t).add(p);
      this.stage.invalidate();
    }
    if (this.controls.update()) this.stage.invalidate();
  }

  flyTo(position: THREE.Vector3, target: THREE.Vector3, dur = 900): Promise<void> {
    return new Promise((resolve) => {
      this.anim = {
        from: [this.stage.camera.position.clone(), this.controls.target.clone()],
        to: [position.clone(), target.clone()],
        t0: performance.now(),
        dur,
        done: resolve,
      };
    });
  }

  /** Frames a box from a direction (default: current viewing direction). */
  frameBox(box: THREE.Box3, dir?: THREE.Vector3, dur = 900, padding = 1.15) {
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const cam = this.stage.camera;
    const d = (dir ?? cam.position.clone().sub(this.controls.target)).normalize();
    const vfov = THREE.MathUtils.degToRad(cam.fov);
    const hfov = 2 * Math.atan(Math.tan(vfov / 2) * cam.aspect);
    const radius = Math.max(size.length() / 2, 0.02);
    const dist = Math.max((radius * padding) / Math.sin(Math.min(vfov, hfov) / 2), 0.08);
    return this.flyTo(center.clone().add(d.multiplyScalar(dist)), center, dur);
  }
}
