// Pictures of made things for their windows: each item's Blender model (item__<kind> in band.glb) drawn
// once, in a three-quarter view, by a small renderer of its own, and kept as an image.
import * as THREE from 'three';

const SIZE = 192;

export class ItemPictures {
  private renderer: THREE.WebGLRenderer | null = null;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(28, 1, 0.001, 100);
  private material = new THREE.MeshLambertMaterial({ vertexColors: true });
  private cache = new Map<string, string>();
  private failed = false;

  constructor(private geoms: Map<string, THREE.BufferGeometry>) {
    this.scene.add(new THREE.HemisphereLight(0xfff4e0, 0x3a3428, 2.2));
    const sun = new THREE.DirectionalLight(0xfff0d8, 2.4);
    sun.position.set(1.2, 2, 1.6);
    this.scene.add(sun);
  }

  /** A picture of a kind of item (a data URL), or null where there is no model or no way to draw one. */
  get(kind: string): string | null {
    const hit = this.cache.get(kind);
    if (hit !== undefined) return hit;
    const geo = this.geoms.get(`item__${kind}`);
    if (!geo || this.failed) return null;
    try {
      if (!this.renderer) {
        this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
        this.renderer.setPixelRatio(Math.min(2, devicePixelRatio || 1));
        this.renderer.setSize(SIZE, SIZE, false);
        this.renderer.outputColorSpace = THREE.SRGBColorSpace;
        this.renderer.toneMapping = THREE.NeutralToneMapping;
      }
      const mesh = new THREE.Mesh(geo, this.material);
      geo.computeBoundingSphere();
      const s = geo.boundingSphere!;
      // looking at it from in front, a little to the right and above (models face +z)
      const dir = new THREE.Vector3(0.55, 0.5, 1).normalize();
      const dist = s.radius / Math.sin(THREE.MathUtils.degToRad(this.camera.fov / 2)) * 1.02;
      this.camera.position.copy(s.center).addScaledVector(dir, dist);
      this.camera.near = dist / 20;
      this.camera.far = dist * 4;
      this.camera.lookAt(s.center);
      this.camera.updateProjectionMatrix();
      this.scene.add(mesh);
      this.renderer.setClearColor(0x000000, 0);
      this.renderer.render(this.scene, this.camera);
      this.scene.remove(mesh);
      const url = this.renderer.domElement.toDataURL('image/png');
      this.cache.set(kind, url);
      return url;
    } catch {
      this.failed = true;
      return null;
    }
  }
}
