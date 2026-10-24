// Isometric orthographic camera: drag to pan, wheel to zoom toward the cursor,
// Q/E (or buttons) to rotate in 90-degree steps, WASD/arrows to pan.
import * as THREE from 'three';

const PITCH = THREE.MathUtils.degToRad(33);
const DIST = 300;

export class IsoCamera {
  camera: THREE.OrthographicCamera;
  target = new THREE.Vector3();
  private goal = new THREE.Vector3();
  zoom = 40; // visible world height in units
  private goalZoom = 40;
  yaw = Math.PI / 4;
  private goalYaw = Math.PI / 4;
  yawIndex = 0;
  minZoom = 4;
  /** how quickly the view glides to its goal (per second); slower while the director flies */
  glide = 9;
  /** called whenever the user moves the camera themselves */
  onUserMove?: () => void;
  maxZoom = 180;
  bounds = { x0: 0, z0: 0, x1: 128, z1: 128 };
  private keys = new Set<string>();
  private dragging = false;
  private lastX = 0;
  private lastY = 0;
  private moved = 0;
  changed = true;
  onClick?: (x: number, y: number) => void;
  /** two clicks in quick succession at the same spot */
  onDoubleClick?: (x: number, y: number) => void;
  private lastClick = { t: -1e9, x: 0, y: 0 };
  heightAt: (x: number, z: number) => number = () => 0;

  constructor(private el: HTMLElement) {
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 1000);
    el.addEventListener('pointerdown', this.onDown);
    window.addEventListener('pointermove', this.onMove);
    window.addEventListener('pointerup', this.onUp);
    el.addEventListener('wheel', this.onWheel, { passive: false });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('keydown', this.onKey);
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.dragging = false;
    });
  }

  setBounds(size: number) {
    this.bounds = { x0: 0, z0: 0, x1: size, z1: size };
    this.maxZoom = size * 1.15;
  }

  frame(x: number, z: number, zoom: number, instant = true) {
    this.goal.set(x, this.heightAt(x, z), z);
    this.goalZoom = THREE.MathUtils.clamp(zoom, this.minZoom, this.maxZoom);
    if (instant) {
      this.target.copy(this.goal);
      this.zoom = this.goalZoom;
    }
    this.changed = true;
  }

  rotate(dir: 1 | -1) {
    this.yawIndex = (this.yawIndex + dir + 4) % 4;
    this.goalYaw += (dir * Math.PI) / 2;
    this.changed = true;
  }

  zoomBy(factor: number) {
    this.goalZoom = THREE.MathUtils.clamp(this.goalZoom * factor, this.minZoom, this.maxZoom);
    this.changed = true;
  }

  /** Unit vectors along the ground for screen-right and screen-up. */
  private groundAxes() {
    const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const fwd = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    return { right, fwd };
  }

  /** Ray from a screen point (client px), in world space. */
  ray(clientX: number, clientY: number) {
    const r = this.el.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    const rc = new THREE.Raycaster();
    rc.setFromCamera(ndc, this.camera);
    return rc.ray;
  }

  /** Ground point (on the plane through the target height) under a screen point. */
  groundAt(clientX: number, clientY: number, y = this.target.y) {
    const ray = this.ray(clientX, clientY);
    const t = (y - ray.origin.y) / ray.direction.y;
    return ray.origin.clone().addScaledVector(ray.direction, t);
  }

  private onDown = (e: PointerEvent) => {
    if (e.button !== 0 && e.button !== 1 && e.button !== 2) return;
    this.dragging = true;
    this.moved = 0;
    this.lastX = e.clientX;
    this.lastY = e.clientY;
  };
  private onMove = (e: PointerEvent) => {
    if (!this.dragging) return;
    // the button was let go somewhere we never heard about (another window, an alt-tab)
    if (e.buttons === 0) {
      this.dragging = false;
      return;
    }
    const dx = e.clientX - this.lastX, dy = e.clientY - this.lastY;
    this.lastX = e.clientX;
    this.lastY = e.clientY;
    this.moved += Math.abs(dx) + Math.abs(dy);
    if (this.moved > 4) this.onUserMove?.();
    const r = this.el.getBoundingClientRect();
    const perPx = this.zoom / r.height;
    const { right, fwd } = this.groundAxes();
    const k = perPx;
    this.goal.addScaledVector(right, -dx * k).addScaledVector(fwd, (dy * k) / Math.sin(PITCH));
    this.target.copy(this.goal.clone().setY(this.target.y)); // drags follow the hand exactly
    this.clampGoal();
    this.changed = true;
  };
  private onUp = (e: PointerEvent) => {
    if (this.dragging && this.moved < 4 && e.button === 0) {
      const now = performance.now(), lc = this.lastClick;
      const dbl = now - lc.t < 380 && Math.abs(e.clientX - lc.x) + Math.abs(e.clientY - lc.y) < 8;
      this.lastClick = dbl ? { t: -1e9, x: 0, y: 0 } : { t: now, x: e.clientX, y: e.clientY };
      if (dbl && this.onDoubleClick) this.onDoubleClick(e.clientX, e.clientY);
      else this.onClick?.(e.clientX, e.clientY);
    }
    this.dragging = false;
  };
  private onWheel = (e: WheelEvent) => {
    e.preventDefault();
    this.onUserMove?.();
    const factor = Math.exp(e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0012));
    const before = this.groundAt(e.clientX, e.clientY);
    const old = this.goalZoom;
    this.goalZoom = THREE.MathUtils.clamp(this.goalZoom * factor, this.minZoom, this.maxZoom);
    // keep the point under the cursor fixed: shift the goal toward it proportionally
    const k = 1 - this.goalZoom / old;
    this.goal.x += (before.x - this.goal.x) * k;
    this.goal.z += (before.z - this.goal.z) * k;
    this.clampGoal();
    this.changed = true;
  };
  // physical key positions (e.code), so WASD/QE sit in the same place on AZERTY, QWERTZ, Dvorak...
  private onKey = (e: KeyboardEvent) => {
    const t = e.target as HTMLElement;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const c = e.code;
    const moves = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];
    if (c === 'KeyQ') this.rotate(-1);
    else if (c === 'KeyE') this.rotate(1);
    else if (c === 'Equal' || c === 'NumpadAdd') this.zoomBy(0.8);
    else if (c === 'Minus' || c === 'NumpadSubtract') this.zoomBy(1.25);
    else if (moves.includes(c)) this.keys.add(c);
    else return;
    if (c.startsWith('Arrow')) e.preventDefault();
    this.onUserMove?.();
  };

  private clampGoal() {
    const b = this.bounds;
    this.goal.x = THREE.MathUtils.clamp(this.goal.x, b.x0, b.x1);
    this.goal.z = THREE.MathUtils.clamp(this.goal.z, b.z0, b.z1);
  }

  update(dt: number, aspect: number) {
    // keyboard pan
    const { right, fwd } = this.groundAxes();
    const speed = this.zoom * 0.9 * dt;
    let kx = 0, kz = 0;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) kx -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) kx += 1;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) kz += 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) kz -= 1;
    if (kx || kz) {
      this.goal.addScaledVector(right, kx * speed).addScaledVector(fwd, kz * speed);
      this.clampGoal();
      this.changed = true;
    }
    // follow terrain height softly so the view pivots on the land
    this.goal.y = this.heightAt(this.goal.x, this.goal.z);
    const a = 1 - Math.exp(-dt * this.glide);
    const prevZoom = this.zoom, prevYaw = this.yaw;
    const prev = this.target.clone();
    this.target.lerp(this.goal, a);
    this.zoom += (this.goalZoom - this.zoom) * a;
    this.yaw += (this.goalYaw - this.yaw) * (1 - Math.exp(-dt * 7));
    if (
      Math.abs(this.zoom - prevZoom) > 1e-4 || Math.abs(this.yaw - prevYaw) > 1e-5 || prev.distanceToSquared(this.target) > 1e-8
    )
      this.changed = true;

    const cam = this.camera;
    const h = this.zoom / 2;
    cam.left = -h * aspect;
    cam.right = h * aspect;
    cam.top = h;
    cam.bottom = -h;
    const dir = new THREE.Vector3(Math.sin(this.yaw) * Math.cos(PITCH), Math.sin(PITCH), Math.cos(this.yaw) * Math.cos(PITCH));
    cam.position.copy(this.target).addScaledVector(dir, DIST);
    cam.lookAt(this.target);
    cam.near = 1;
    cam.far = DIST * 2 + 200;
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();
  }

  /** Direction from the scene toward the camera. */
  viewDir(out = new THREE.Vector3()) {
    return out.set(Math.sin(this.yaw) * Math.cos(PITCH), Math.sin(PITCH), Math.cos(this.yaw) * Math.cos(PITCH));
  }
}
