// Pictures of made things for their windows: each item's Blender model (item__<kind> in band.glb) drawn
// by a small renderer of its own. The window shows it in a three-quarter view, and dragging over it
// turns the thing in hand: each frame is drawn here and copied onto the window's own canvas, so every
// open window shares the one WebGL context.
import * as THREE from 'three';

export const ITEM_PIC_SIZE = 136;

export class ItemPictures {
  private renderer: THREE.WebGLRenderer | null = null;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(28, 1, 0.001, 100);
  private material = new THREE.MeshLambertMaterial({ vertexColors: true });
  private pivot = new THREE.Group();
  private mesh = new THREE.Mesh(undefined, this.material);
  private failed = false;
  private qYaw = new THREE.Quaternion();
  private qPitch = new THREE.Quaternion();
  private right = new THREE.Vector3();
  private static UP = new THREE.Vector3(0, 1, 0);

  constructor(private geoms: Map<string, THREE.BufferGeometry>) {
    this.scene.add(new THREE.HemisphereLight(0xfff4e0, 0x3a3428, 2.2));
    const sun = new THREE.DirectionalLight(0xfff0d8, 2.4);
    sun.position.set(1.2, 2, 1.6);
    this.scene.add(sun);
    this.pivot.add(this.mesh);
    this.scene.add(this.pivot);
  }

  /** Whether there is a model of this kind of item to show. */
  has(kind: string): boolean {
    return !this.failed && this.geoms.has(`item__${kind}`);
  }

  /**
   * Draw a kind of item onto a canvas, turned `yaw` radians about the upright and tipped `pitch` radians
   * towards the viewer (0, 0 is the resting three-quarter view). False where it cannot be drawn.
   */
  paint(kind: string, yaw: number, pitch: number, out: HTMLCanvasElement): boolean {
    const geo = this.geoms.get(`item__${kind}`);
    if (!geo || this.failed) return false;
    try {
      const px = out.width;
      if (!this.renderer) {
        this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
        this.renderer.setPixelRatio(1);
        this.renderer.outputColorSpace = THREE.SRGBColorSpace;
        this.renderer.toneMapping = THREE.NeutralToneMapping;
      }
      const cv = this.renderer.domElement;
      if (cv.width !== px || cv.height !== px) this.renderer.setSize(px, px, false);
      if (!geo.boundingSphere) geo.computeBoundingSphere();
      const s = geo.boundingSphere!;
      // the camera looks at it from in front, a little to the right and above (models face +z); the
      // model turns about its own middle, so its bounding sphere stays in frame whichever way it faces
      const dir = new THREE.Vector3(0.55, 0.5, 1).normalize();
      const dist = (s.radius / Math.sin(THREE.MathUtils.degToRad(this.camera.fov / 2))) * 1.02;
      this.camera.position.copy(dir).multiplyScalar(dist);
      this.camera.near = dist / 20;
      this.camera.far = dist * 4;
      this.camera.lookAt(0, 0, 0);
      this.camera.updateProjectionMatrix();
      this.mesh.geometry = geo;
      this.mesh.position.copy(s.center).negate();
      this.right.crossVectors(ItemPictures.UP, dir).normalize();
      this.qYaw.setFromAxisAngle(ItemPictures.UP, yaw);
      this.qPitch.setFromAxisAngle(this.right, pitch);
      this.pivot.quaternion.multiplyQuaternions(this.qPitch, this.qYaw);
      this.renderer.setClearColor(0x000000, 0);
      this.renderer.render(this.scene, this.camera);
      const ctx = out.getContext('2d');
      if (!ctx) return false;
      ctx.clearRect(0, 0, px, px);
      ctx.drawImage(cv, 0, 0, px, px);
      return true;
    } catch {
      this.failed = true;
      return false;
    }
  }
}
