"""Builds every M0 nature asset procedurally and exports one GLB.

Run headless:  python3 blender/build_assets.py [out.glb]
(or: blender -b -P blender/build_assets.py -- out.glb)

Conventions shared with the game (src/sim/types.ts):
  trees   {species}_s{stage}_v{variant}__trunk / __leaf   (species pine|oak|birch, stage 0-3, variant 0-2)
  tree LOD {species}_s{stage}__lo_trunk / __lo_leaf
  small    {kind}_v{n}__main  (bush, reeds, grass, rock, outcrop) ; berry_v{n}__leaf + __berry
Units: 1 = one tile (about 6 m). Z is up in Blender; the exporter writes Y-up.
Colours are authored in sRGB and stored linear, flat-shaded, ~150 triangles per full tree.
"""
import math
import os
import random
import sys

import bpy  # must come first: it makes bmesh and mathutils importable
import bmesh
from mathutils import Matrix, Vector

bpy.ops.wm.read_factory_settings(use_empty=True)  # start from nothing (no default cube, camera or light)

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "src", "assets", "nature.glb")
argv = sys.argv
if "--" in argv:
    rest = argv[argv.index("--") + 1:]
    if rest:
        OUT = rest[0]
elif len(argv) > 1 and argv[-1].endswith(".glb"):
    OUT = argv[-1]


def lin(c):
    """sRGB 0-255 -> linear 0-1."""
    out = []
    for v in c:
        v = v / 255.0
        out.append(v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4)
    return (out[0], out[1], out[2], 1.0)


def jit(c, rnd, amt=0.07):
    k = 1 + rnd.uniform(-amt, amt)
    return tuple(max(0, min(255, v * k)) for v in c)


class Part:
    """Accumulates geometry with per-face colours into one bmesh."""

    def __init__(self):
        self.bm = bmesh.new()
        self.col = self.bm.loops.layers.float_color.new("Col")

    def _paint(self, faces, color, rnd, amt=0.06):
        for f in faces:
            c = lin(jit(color, rnd, amt))
            for loop in f.loops:
                loop[self.col] = c

    def add_geom(self, ret_verts, color, rnd, amt=0.06, colorfn=None):
        faces = set()
        for v in ret_verts:
            for f in v.link_faces:
                faces.add(f)
        if colorfn:
            for f in faces:
                c = lin(jit(colorfn(f), rnd, amt))
                for loop in f.loops:
                    loop[self.col] = c
        else:
            self._paint(faces, color, rnd, amt)
        return faces

    def cylinder(self, segs, r0, r1, z0, z1, color, rnd, tilt=(0, 0), base=(0, 0), cap=True, amt=0.06):
        bm = self.bm
        ring0, ring1 = [], []
        top = Vector((base[0] + tilt[0], base[1] + tilt[1], z1))
        bot = Vector((base[0], base[1], z0))
        rot0 = rnd.uniform(0, math.tau)
        for k in range(segs):
            a = rot0 + k / segs * math.tau
            ring0.append(bm.verts.new(bot + Vector((math.cos(a) * r0, math.sin(a) * r0, 0))))
            ring1.append(bm.verts.new(top + Vector((math.cos(a) * r1, math.sin(a) * r1, 0))))
        faces = []
        for k in range(segs):
            n = (k + 1) % segs
            faces.append(bm.faces.new((ring0[k], ring0[n], ring1[n], ring1[k])))
        if cap and r1 > 0.0001:
            faces.append(bm.faces.new(list(reversed(ring1))[::-1]))
        self._paint(faces, color, rnd, amt)
        return faces

    def cone(self, segs, r, z0, h, color, rnd, center=(0, 0), droop=0.0, amt=0.07):
        bm = self.bm
        rot0 = rnd.uniform(0, math.tau)
        ring = []
        for k in range(segs):
            a = rot0 + k / segs * math.tau
            rr = r * rnd.uniform(0.86, 1.08)
            ring.append(bm.verts.new((center[0] + math.cos(a) * rr, center[1] + math.sin(a) * rr,
                                      z0 - droop * rnd.uniform(0.5, 1.0))))
        apex = bm.verts.new((center[0] + rnd.uniform(-0.02, 0.02), center[1] + rnd.uniform(-0.02, 0.02), z0 + h))
        faces = []
        for k in range(segs):
            n = (k + 1) % segs
            faces.append(bm.faces.new((ring[k], ring[n], apex)))
        faces.append(bm.faces.new(list(reversed(ring))))
        self._paint(faces, color, rnd, amt)
        return faces

    def blob(self, center, size, color, rnd, squash=1.0, noise=0.18, subdiv=1, amt=0.08, colorfn=None):
        ret = bmesh.ops.create_icosphere(self.bm, subdivisions=subdiv, radius=1.0)
        verts = ret["verts"]
        sx, sy, sz = size if isinstance(size, (tuple, list)) else (size, size, size * squash)
        rz = rnd.uniform(0, math.tau)
        rot = Matrix.Rotation(rz, 3, "Z")
        for v in verts:
            p = v.co * (1 + rnd.uniform(-noise, noise))
            p = Vector((p.x * sx, p.y * sy, p.z * sz))
            v.co = rot @ p + Vector(center)
        return self.add_geom(verts, color, rnd, amt, colorfn)

    def box(self, center, size, color, rnd, rotz=0.0, noise=0.0, amt=0.06, colorfn=None):
        ret = bmesh.ops.create_cube(self.bm, size=1.0)
        verts = ret["verts"]
        rot = Matrix.Rotation(rotz, 3, "Z")
        for v in verts:
            p = Vector((v.co.x * size[0], v.co.y * size[1], v.co.z * size[2]))
            p += Vector((rnd.uniform(-noise, noise), rnd.uniform(-noise, noise), rnd.uniform(-noise, noise) * 0.5))
            v.co = rot @ p + Vector(center)
        return self.add_geom(verts, color, rnd, amt, colorfn)

    def blade(self, base, height, width, lean, color, rnd, amt=0.1):
        """A single upright triangle (rendered double-sided)."""
        bm = self.bm
        a = rnd.uniform(0, math.tau)
        dx, dy = math.cos(a) * width / 2, math.sin(a) * width / 2
        la = rnd.uniform(0, math.tau)
        tip = (base[0] + math.cos(la) * lean, base[1] + math.sin(la) * lean, base[2] + height)
        f = bm.faces.new((bm.verts.new((base[0] - dx, base[1] - dy, base[2])),
                          bm.verts.new((base[0] + dx, base[1] + dy, base[2])),
                          bm.verts.new(tip)))
        self._paint([f], color, rnd, amt)
        return tip

    def finish(self, name):
        bm = self.bm
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        mesh = bpy.data.meshes.new(name)
        bm.to_mesh(mesh)
        bm.free()
        for poly in mesh.polygons:
            poly.use_smooth = False
        obj = bpy.data.objects.new(name, mesh)
        bpy.context.scene.collection.objects.link(obj)
        return obj


def tris(obj):
    return sum(len(p.vertices) - 2 for p in obj.data.polygons)


# ---------------------------------------------------------------- palettes
BARK = (104, 76, 52)
BARK_DARK = (78, 58, 42)
PINE = (44, 96, 64)
PINE_DARK = (34, 78, 54)
OAK = (88, 140, 54)
OAK_DARK = (70, 118, 46)
BIRCH_LEAF = (122, 160, 66)
BIRCH_BARK = (232, 228, 214)
BIRCH_MARK = (58, 54, 50)

STATS = {}


def record(name, *objs):
    STATS[name] = sum(tris(o) for o in objs)


# ---------------------------------------------------------------- trees
def pine(stage, variant, lo=False):
    rnd = random.Random(1000 + stage * 10 + variant)
    H = [0.45, 0.95, 1.45, 1.8][stage] * rnd.uniform(0.92, 1.08)
    layers = [1, 2, 3, 4][stage] if not lo else 1
    R = [0.16, 0.26, 0.36, 0.42][stage] * rnd.uniform(0.9, 1.1)
    tr = [0.025, 0.045, 0.07, 0.09][stage]
    trunk, leaf = Part(), Part()
    segs = 4 if lo else 5
    trunk.cylinder(segs, tr, tr * 0.6, -0.05, H * 0.55, BARK_DARK if stage == 3 else BARK, rnd)
    col = PINE_DARK if stage == 3 else PINE
    if lo:
        leaf.cone(5, R * 1.05, H * 0.18, H * 0.84, col, rnd)
    else:
        for k in range(layers):
            t = k / max(1, layers)
            z0 = H * (0.2 + 0.62 * t)
            r = R * (1 - 0.62 * t)
            h = H * (0.52 - 0.12 * t)
            off = (rnd.uniform(-0.025, 0.025), rnd.uniform(-0.025, 0.025))
            leaf.cone(7, r, z0, h, jit(col, rnd, 0.08), rnd, center=off, droop=0.04 * (stage == 3))
    return trunk, leaf


def oak(stage, variant, lo=False):
    rnd = random.Random(2000 + stage * 10 + variant)
    H = [0.42, 0.85, 1.3, 1.6][stage] * rnd.uniform(0.92, 1.08)
    R = [0.15, 0.27, 0.4, 0.5][stage] * rnd.uniform(0.9, 1.1)
    tr = [0.025, 0.045, 0.075, 0.1][stage]
    trunk, leaf = Part(), Part()
    trunk.cylinder(4 if lo else 6, tr, tr * 0.7, -0.05, H * 0.55, BARK, rnd)
    cz = H * 0.66
    if lo:
        leaf.blob((0, 0, cz), (R, R, R * 0.8), OAK, rnd, noise=0.12)
        return trunk, leaf
    # branches (visible when the canopy is bare in winter)
    nb = [0, 1, 3, 4][stage]
    for b in range(nb):
        a = b / max(1, nb) * math.tau + rnd.uniform(-0.4, 0.4)
        z0 = H * rnd.uniform(0.38, 0.5)
        reach = R * rnd.uniform(0.55, 0.8)
        trunk.cylinder(4, tr * 0.45, tr * 0.18, z0, cz + rnd.uniform(-0.05, 0.12), BARK, rnd,
                       tilt=(math.cos(a) * reach, math.sin(a) * reach), cap=False)
    blobs = [1, 2, 4, 5][stage]
    for b in range(blobs):
        if b == 0:
            c = (0, 0, cz + R * 0.15)
            s = R * 0.85
        else:
            a = b / (blobs - 1) * math.tau + rnd.uniform(-0.3, 0.3)
            d = R * rnd.uniform(0.45, 0.6)
            c = (math.cos(a) * d, math.sin(a) * d, cz + rnd.uniform(-0.12, 0.05) * R)
            s = R * rnd.uniform(0.5, 0.65)
        leaf.blob(c, (s, s, s * 0.82), jit(OAK if b % 2 else OAK_DARK, rnd, 0.06), rnd, noise=0.16)
    return trunk, leaf


def birch(stage, variant, lo=False):
    rnd = random.Random(3000 + stage * 10 + variant)
    H = [0.45, 0.95, 1.45, 1.7][stage] * rnd.uniform(0.92, 1.08)
    R = [0.12, 0.2, 0.28, 0.32][stage] * rnd.uniform(0.9, 1.1)
    tr = [0.02, 0.032, 0.048, 0.06][stage]
    trunk, leaf = Part(), Part()
    lean = (rnd.uniform(-0.05, 0.05), rnd.uniform(-0.05, 0.05))
    if lo:
        trunk.cylinder(4, tr, tr * 0.6, -0.05, H * 0.6, BIRCH_BARK, rnd, tilt=lean)
        leaf.blob((lean[0], lean[1], H * 0.68), (R, R, R * 1.5), BIRCH_LEAF, rnd, noise=0.1)
        return trunk, leaf
    segs = 5
    z = -0.05
    nseg = 4
    for k in range(nseg):
        z1 = z + (H * 0.72 + 0.05) / nseg
        f0 = k / nseg
        f1 = (k + 1) / nseg
        col = BIRCH_MARK if (k % 2 == 1 and rnd.random() < 0.7) else BIRCH_BARK
        trunk.cylinder(segs, tr * (1 - 0.35 * f0), tr * (1 - 0.35 * f1), z, z1, col, rnd,
                       base=(lean[0] * f0, lean[1] * f0), tilt=(lean[0] / nseg, lean[1] / nseg), cap=(k == nseg - 1))
        z = z1
    blobs = [1, 2, 3, 3][stage]
    for b in range(blobs):
        t = b / max(1, blobs)
        c = (lean[0] + rnd.uniform(-0.06, 0.06), lean[1] + rnd.uniform(-0.06, 0.06), H * (0.55 + 0.25 * t))
        s = R * (1 - 0.25 * t) * rnd.uniform(0.85, 1.05)
        leaf.blob(c, (s, s, s * 1.45), jit(BIRCH_LEAF, rnd, 0.08), rnd, noise=0.14)
    return trunk, leaf


SPECIES = {"pine": pine, "oak": oak, "birch": birch}

for sp, fn in SPECIES.items():
    for stage in range(4):
        for v in range(3):
            trunk, leaf = fn(stage, v)
            a = trunk.finish(f"{sp}_s{stage}_v{v}__trunk")
            b = leaf.finish(f"{sp}_s{stage}_v{v}__leaf")
            record(f"{sp}_s{stage}_v{v}", a, b)
        trunk, leaf = fn(stage, 0, lo=True)
        a = trunk.finish(f"{sp}_s{stage}__lo_trunk")
        b = leaf.finish(f"{sp}_s{stage}__lo_leaf")
        record(f"{sp}_s{stage}__lo", a, b)

# ---------------------------------------------------------------- small props
BUSH = (74, 120, 52)
BERRY_LEAF = (58, 104, 50)
BERRIES = [(196, 38, 52), (92, 62, 150), (214, 70, 40)]
REED = (128, 152, 72)
REED_HEAD = (104, 70, 40)
GRASS = [(112, 162, 66), (132, 170, 70), (98, 148, 60)]
ROCK = (132, 128, 122)
MOSS = (106, 128, 74)

for v in range(3):
    rnd = random.Random(4000 + v)
    p = Part()
    n = 2 + v % 2
    for b in range(n):
        a = rnd.uniform(0, math.tau)
        d = 0.0 if b == 0 else rnd.uniform(0.07, 0.12)
        s = rnd.uniform(0.11, 0.16)
        p.blob((math.cos(a) * d, math.sin(a) * d, s * 0.55), (s, s, s * 0.75), jit(BUSH, rnd), rnd, noise=0.15)
    record(f"bush_v{v}", p.finish(f"bush_v{v}__main"))

for v in range(3):
    rnd = random.Random(4100 + v)
    leaf, berry = Part(), Part()
    for b in range(2):
        a = rnd.uniform(0, math.tau)
        d = 0.0 if b == 0 else 0.08
        s = rnd.uniform(0.12, 0.15)
        leaf.blob((math.cos(a) * d, math.sin(a) * d, s * 0.55), (s, s, s * 0.8), jit(BERRY_LEAF, rnd), rnd, noise=0.15)
    for b in range(9):
        a = rnd.uniform(0, math.tau)
        d = rnd.uniform(0.06, 0.14)
        z = rnd.uniform(0.06, 0.2)
        berry.box((math.cos(a) * d, math.sin(a) * d, z), (0.035, 0.035, 0.035), BERRIES[v], rnd,
                  rotz=rnd.uniform(0, 1.5))
    record(f"berry_v{v}", leaf.finish(f"berry_v{v}__leaf"), berry.finish(f"berry_v{v}__berry"))

for v in range(3):
    rnd = random.Random(4200 + v)
    p = Part()
    for b in range(9 + v * 2):
        base = (rnd.uniform(-0.12, 0.12), rnd.uniform(-0.12, 0.12), -0.05)
        hgt = rnd.uniform(0.35, 0.6)
        tip = p.blade(base, hgt, 0.045, rnd.uniform(0.02, 0.08), REED, rnd)
        if rnd.random() < 0.35:
            p.cylinder(4, 0.022, 0.022, tip[2] - 0.12, tip[2] - 0.02, REED_HEAD, rnd,
                       base=(tip[0], tip[1]), cap=True)
    record(f"reeds_v{v}", p.finish(f"reeds_v{v}__main"))

for v in range(3):
    rnd = random.Random(4300 + v)
    p = Part()
    for b in range(6 + v):
        base = (rnd.uniform(-0.06, 0.06), rnd.uniform(-0.06, 0.06), -0.01)
        p.blade(base, rnd.uniform(0.09, 0.17), 0.035, rnd.uniform(0.02, 0.06), GRASS[v], rnd)
    record(f"grass_v{v}", p.finish(f"grass_v{v}__main"))

for v in range(5):
    rnd = random.Random(4400 + v)
    p = Part()
    s = rnd.uniform(0.13, 0.2)
    moss = lambda f, rnd=rnd: MOSS if f.normal.z > 0.75 and rnd.random() < 0.4 else ROCK
    p.blob((0, 0, s * 0.35), (s * rnd.uniform(1, 1.4), s, s * rnd.uniform(0.6, 0.85)), ROCK, rnd,
           noise=0.22, colorfn=moss)
    if v >= 3:
        s2 = s * 0.55
        p.blob((s * 0.9, s * 0.3, s2 * 0.3), (s2, s2, s2 * 0.7), ROCK, rnd, noise=0.25, colorfn=moss)
    record(f"rock_v{v}", p.finish(f"rock_v{v}__main"))

for v in range(3):
    rnd = random.Random(4500 + v)
    p = Part()
    moss = lambda f, rnd=rnd: MOSS if f.normal.z > 0.8 and rnd.random() < 0.5 else ROCK
    n = 3 + v
    for b in range(n):
        a = rnd.uniform(0, math.tau)
        d = 0 if b == 0 else rnd.uniform(0.1, 0.22)
        w = rnd.uniform(0.14, 0.24)
        hgt = rnd.uniform(0.25, 0.6) * (1.3 if b == 0 else 1)
        p.box((math.cos(a) * d, math.sin(a) * d, hgt / 2 - 0.06), (w, w * rnd.uniform(0.7, 1.1), hgt),
              ROCK, rnd, rotz=rnd.uniform(0, math.pi), noise=0.035, colorfn=moss)
    record(f"outcrop_v{v}", p.finish(f"outcrop_v{v}__main"))

# ---------------------------------------------------------------- left behind by people
STUMP_TOP = (196, 168, 120)
for v, (bark, r0) in enumerate(((BARK_DARK, 0.07), (BARK, 0.09), (BIRCH_BARK, 0.06))):
    rnd = random.Random(4600 + v)
    p = Part()
    faces = p.cylinder(6, r0 * 1.15, r0, -0.03, 0.09, bark, rnd, cap=True)
    p.cylinder(6, r0 * 0.92, r0 * 0.92, 0.088, 0.096, STUMP_TOP, rnd, cap=True)
    record(f"stump_v{v}", p.finish(f"stump_v{v}__main"))

for v in range(2):
    rnd = random.Random(4700 + v)
    p = Part()
    rows = [3, 2] if v == 0 else [4, 3, 1]
    for layer, n in enumerate(rows):
        for k in range(n):
            faces = p.cylinder(6, 0.026, 0.024, 0, rnd.uniform(0.32, 0.4), BARK if (k + layer) % 2 else BARK_DARK, rnd, cap=True)
            verts = {vv for f in faces for vv in f.verts}
            y = (k - (n - 1) / 2) * 0.054
            z = 0.026 + layer * 0.046
            m = Matrix.Translation((-0.18, y, z)) @ Matrix.Rotation(math.pi / 2, 4, "Y")
            bmesh.ops.transform(p.bm, verts=list(verts), matrix=m)
    record(f"logs_v{v}", p.finish(f"logs_v{v}__main"))

EARTH = (122, 96, 66)
for v in range(2):
    rnd = random.Random(4800 + v)
    p = Part()
    if v == 0:
        p.blob((0, 0, 0.0), (0.12, 0.2, 0.06), EARTH, rnd, noise=0.08)
        p.box((0, -0.2, 0.06), (0.07, 0.03, 0.12), ROCK, rnd, rotz=0.0)
    else:
        for k in range(5):
            s = 0.07 - k * 0.01
            p.blob((rnd.uniform(-0.02, 0.02), rnd.uniform(-0.02, 0.02), 0.03 + k * 0.045), (s, s, s * 0.7), ROCK, rnd, noise=0.2)
        p.blob((0, 0.12, 0.0), (0.1, 0.12, 0.04), EARTH, rnd, noise=0.08)
    record(f"grave_v{v}", p.finish(f"grave_v{v}__main"))

# ---------------------------------------------------------------- export
bpy.ops.export_scene.gltf(
    filepath=OUT,
    export_format="GLB",
    export_materials="NONE",
    export_vertex_color="ACTIVE",
    export_normals=True,
    export_texcoords=False,
    export_yup=True,
)
full = [k for k in STATS if "__lo" not in k]
print("ASSETS", len(STATS), "objects-sets;", "max tris", max(STATS[k] for k in full),
      "avg tree tris", round(sum(STATS[k] for k in full if k.split('_')[0] in SPECIES) / 36))
for k in ("pine_s2_v0", "oak_s3_v0", "birch_s2_v0", "oak_s2__lo", "rock_v0", "outcrop_v2", "grass_v0", "reeds_v0"):
    print(" ", k, STATS[k])
