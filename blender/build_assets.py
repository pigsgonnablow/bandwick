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
# Each species has three variants that differ in form, not just in size, so a wood never looks stamped out:
#   pine  v0 a narrow spruce-like spire, v1 a broad full pine, v2 an old flat-topped pine on a long bare trunk
#   oak   v0 a spreading oak on a short trunk, v1 a tall upright oak, v2 a gnarled oak leaning one way
#   birch v0 a slender single stem, v1 twin stems from one root, v2 a leaning birch with weeping twigs
# Trunk and leaf stay separate meshes (the leaf mesh's bounding box centre is where winter shrinks it to).

def tube(part, path, segs, color_of, rnd, cap=True, amt=0.06, flat_base=True):
    """A trunk or limb along path [(point, radius)]: rings square to the path (the first one level, so a
    trunk stands flat in the ground); color_of(i, k) per face, segment i round k."""
    bm = part.bm
    pts = [Vector(p) for p, _ in path]
    rot0 = rnd.uniform(0, math.tau)
    rings = []
    side = None
    for i, (p, r) in enumerate(path):
        d = Vector((0, 0, 1)) if i == 0 and flat_base else (pts[min(i + 1, len(pts) - 1)] - pts[max(i - 1, 0)]).normalized()
        # carry the ring's frame along the path so it doesn't twist where the path turns
        ref = side if side is not None else (Vector((1, 0, 0)) if abs(d.x) < 0.9 else Vector((0, 1, 0)))
        up = d.cross(ref).normalized()
        side = up.cross(d).normalized()
        rings.append([bm.verts.new(pts[i] + (side * math.cos(rot0 + k / segs * math.tau) + up * math.sin(rot0 + k / segs * math.tau)) * r)
                      for k in range(segs)])
    for i in range(len(rings) - 1):
        a, b = rings[i], rings[i + 1]
        for k in range(segs):
            part._paint([bm.faces.new((a[k], a[(k + 1) % segs], b[(k + 1) % segs], b[k]))], color_of(i, k), rnd, amt)
    if cap and path[-1][1] > 0.0005:
        part._paint([bm.faces.new(rings[-1])], color_of(len(rings) - 2, 0), rnd, amt)


def bend(base, top, kink, n):
    """n+1 points from base to top, bowed sideways by kink (a vector) at the middle."""
    base, top, kink = Vector(base), Vector(top), Vector(kink)
    return [base.lerp(top, t) + kink * math.sin(t * math.pi) for t in (k / n for k in range(n + 1))]


def skirt(part, center, r, h, color, rnd, n=8, droop=0.0, jag=0.72, squash=1.0, lean=(0, 0)):
    """One tier of a conifer: a jagged star of branch tips drooping from a peak, closed beneath by a
    shallow cone, so it reads as a layer of boughs rather than a smooth cone."""
    bm = part.bm
    c = Vector(center)
    rot0 = rnd.uniform(0, math.tau)
    ring = []
    for k in range(n):
        a = rot0 + k / n * math.tau
        rr = r * (1.0 if k % 2 == 0 else jag) * rnd.uniform(0.88, 1.1)
        dz = -droop * (1.0 if k % 2 == 0 else 0.5) * rnd.uniform(0.7, 1.0)
        ring.append(bm.verts.new(c + Vector((math.cos(a) * rr, math.sin(a) * rr * squash, dz))))
    apex = bm.verts.new(c + Vector((lean[0], lean[1], h)))
    under = bm.verts.new(c + Vector((lean[0] * 0.3, lean[1] * 0.3, h * 0.22)))
    top = [bm.faces.new((ring[k], ring[(k + 1) % n], apex)) for k in range(n)]
    bot = [bm.faces.new((ring[(k + 1) % n], ring[k], under)) for k in range(n)]
    part._paint(top, color, rnd, 0.07)
    part._paint(bot, tuple(v * 0.72 for v in color), rnd, 0.05)


def lump(part, center, size, color, rnd, noise=0.16, rotz=None):
    """A clump of foliage: a jittered icosahedron (20 faces), flattened or stretched by size."""
    ret = bmesh.ops.create_icosphere(part.bm, subdivisions=0, radius=1.0)
    rot = Matrix.Rotation(rnd.uniform(0, math.tau) if rotz is None else rotz, 3, "Z")
    for v in ret["verts"]:
        q = v.co * (1 + rnd.uniform(-noise, noise))
        v.co = rot @ Vector((q.x * size[0], q.y * size[1], q.z * size[2])) + Vector(center)
    part.add_geom(ret["verts"], color, rnd, 0.08)


def pine(stage, variant, lo=False):
    rnd = random.Random(1000 + stage * 10 + variant)
    k = rnd.uniform(0.92, 1.08)
    trunk, leaf = Part(), Part()
    col = PINE_DARK if stage == 3 else PINE
    if lo:
        H = [0.45, 0.95, 1.45, 1.8][stage] * k
        R = [0.16, 0.26, 0.36, 0.42][stage]
        trunk.cylinder(4, [0.025, 0.045, 0.07, 0.09][stage], 0.01, -0.05, H * 0.55, BARK, rnd)
        leaf.cone(5, R * 1.05, H * 0.18, H * 0.84, col, rnd)
        return trunk, leaf
    if variant == 2 and stage >= 2:
        # an old pine: a long bare trunk, kinked, red-brown above; a few stubs where lower boughs died;
        # the crown in two or three flat, jagged plates near the top, pushed to one side by the wind
        H = [0, 0, 1.4, 1.75][stage] * k
        tr = [0, 0, 0.065, 0.085][stage]
        wind = Vector((rnd.uniform(-1, 1), rnd.uniform(-1, 1), 0)).normalized()
        path = bend((0, 0, -0.05), (wind.x * 0.08, wind.y * 0.08, H * 0.86), wind * 0.05 + Vector((0, 0, 0)), 4)
        tube(trunk, [(p, tr * (1.25 if i == 0 else 1 - 0.55 * i / 4)) for i, p in enumerate(path)], 5,
             lambda i, k: BARK_DARK if i < 1 else (128, 86, 58) if i < 2 else (156, 96, 62), rnd)
        for j in range(3):  # dead stubs
            z = H * (0.3 + 0.13 * j)
            a = rnd.uniform(0, math.tau)
            base = Vector((wind.x * 0.08 * z / H, wind.y * 0.08 * z / H, z))
            trunk.cylinder(3, tr * 0.25, tr * 0.08, z, z + 0.04, BARK_DARK, rnd, base=(base.x, base.y),
                           tilt=(math.cos(a) * 0.12, math.sin(a) * 0.12), cap=False)
        plates = 3 if stage == 3 else 2
        for j in range(plates):
            t = j / plates
            c = (wind.x * (0.1 + 0.12 * t), wind.y * (0.1 + 0.12 * t), H * (0.62 + 0.28 * t))
            skirt(leaf, c, 0.5 * (1 - 0.3 * t) * (1 if stage == 3 else 0.8), 0.16, jit(col, rnd, 0.08), rnd, n=8, droop=0.05, jag=0.55,
                  lean=(wind.x * 0.05, wind.y * 0.05))
        return trunk, leaf
    if variant == 1:  # a broad, full pine: fewer, wider tiers, a blunt top
        H = [0.4, 0.85, 1.3, 1.6][stage] * k
        R = [0.18, 0.3, 0.42, 0.5][stage] * rnd.uniform(0.95, 1.05)
        tiers = [1, 2, 3, 4][stage]
        sp, jag, droop = 0.6, 0.78, 0.05
    else:  # v0 (and the young of v2): a narrow spire, many tiers drooping at the tips, a spike on top
        H = [0.48, 1.0, 1.55, 1.95][stage] * k
        R = [0.14, 0.22, 0.3, 0.34][stage] * rnd.uniform(0.95, 1.05)
        tiers = [2, 3, 4, 5][stage]
        sp, jag, droop = 0.7, 0.66, 0.08
    tr = [0.025, 0.045, 0.07, 0.09][stage]
    tube(trunk, [((0, 0, -0.05), tr * 1.3), ((0, 0, 0.04), tr), ((rnd.uniform(-0.02, 0.02), 0, H * 0.5), tr * 0.6)], 5,
         lambda i, k: BARK_DARK if stage == 3 else BARK, rnd)
    for j in range(tiers):
        t = j / tiers
        z0 = H * (0.16 + sp * t)
        r = R * (1 - 0.68 * t)
        h = H * (0.36 - 0.1 * t)
        off = (rnd.uniform(-0.02, 0.02), rnd.uniform(-0.02, 0.02), z0)
        skirt(leaf, off, r, h, jit(col, rnd, 0.08), rnd, n=8 if stage >= 2 else 6, droop=droop * H * 0.4, jag=jag)
    if variant != 1 and stage >= 1:
        leaf.cone(4, R * 0.12, H * (0.16 + sp) + H * 0.12, H * 0.22, col, rnd)  # the leader
    return trunk, leaf


def oak(stage, variant, lo=False):
    rnd = random.Random(2000 + stage * 10 + variant)
    k = rnd.uniform(0.92, 1.08)
    trunk, leaf = Part(), Part()
    if lo:
        H = [0.42, 0.85, 1.3, 1.6][stage] * k
        R = [0.15, 0.27, 0.4, 0.5][stage]
        trunk.cylinder(4, [0.025, 0.045, 0.075, 0.1][stage], 0.02, -0.05, H * 0.55, BARK, rnd)
        leaf.blob((0, 0, H * 0.66), (R, R, R * 0.8), OAK, rnd, noise=0.12)
        return trunk, leaf
    tr = [0.025, 0.045, 0.075, 0.1][stage]
    if variant == 0:  # spreading: a short stout trunk, limbs reaching out, a wide flattened crown
        H, R, cz, flat, lean = [0.4, 0.75, 1.1, 1.35][stage] * k, [0.18, 0.32, 0.5, 0.62][stage], 0.6, 0.62, Vector((0, 0, 0))
    elif variant == 1:  # tall and upright: a long clean trunk, a high round crown
        H, R, cz, flat, lean = [0.46, 0.95, 1.45, 1.8][stage] * k, [0.14, 0.24, 0.34, 0.4][stage], 0.7, 0.95, Vector((0, 0, 0))
        tr *= 0.85
    else:  # gnarled, leaning away from its neighbours, the crown lopsided over the lean, one dead limb
        a = rnd.uniform(0, math.tau)
        H, R, cz, flat = [0.42, 0.8, 1.2, 1.45][stage] * k, [0.16, 0.28, 0.42, 0.5][stage], 0.62, 0.75
        lean = Vector((math.cos(a), math.sin(a), 0)) * [0.04, 0.1, 0.18, 0.24][stage]
    top = lean + Vector((0, 0, H * cz * 0.85))
    kink = Vector((-lean.y, lean.x, 0)) * 0.4 if variant == 2 else Vector((0, 0, 0))
    path = bend((0, 0, -0.05), top, kink, 3)
    tube(trunk, [(p, tr * (1.3 if i == 0 else 1 - 0.4 * i / 3)) for i, p in enumerate(path)], 5,
         lambda i, k: BARK_DARK if i == 0 else BARK, rnd)
    centre = Vector((top.x, top.y, H * cz)) + lean * 0.3
    # limbs from the top of the trunk out under the crown (they show when it is bare in winter)
    nb = [0, 2, 3, 4][stage]
    for b in range(nb):
        a = b / max(1, nb) * math.tau + rnd.uniform(-0.4, 0.4)
        out = Vector((math.cos(a), math.sin(a), 0)) * R * rnd.uniform(0.55, 0.8)
        z0 = top.z * rnd.uniform(0.75, 0.95)
        base = path[0].lerp(top, z0 / top.z)
        end = centre + out + Vector((0, 0, rnd.uniform(-0.05, 0.1) * R + (0.12 * R if variant == 1 else 0)))
        tube(trunk, [(base, tr * 0.45), ((base + end) / 2 + Vector((0, 0, 0.03)), tr * 0.3), (end, tr * 0.12)], 3, lambda i, k: BARK, rnd, cap=False, flat_base=False)
    if variant == 2 and stage >= 2:  # the dead limb, bare, out of the crown on the far side
        a = math.atan2(-lean.y, -lean.x)
        base = path[0].lerp(top, 0.8)
        end = base + Vector((math.cos(a) * R * 1.0, math.sin(a) * R * 1.0, R * 0.4))
        tube(trunk, [(base, tr * 0.3), (end, tr * 0.08)], 4, lambda i, k: (122, 112, 100), rnd, cap=False, flat_base=False)
    # the crown: a big central lump and others round it, more and wider the older it is
    n = [1, 3, 4, 4][stage]
    for b in range(n):
        if b == 0:
            c, sz = centre + Vector((0, 0, R * 0.15 * flat)), R * 0.8
        else:
            a = b / (n - 1) * math.tau + rnd.uniform(-0.3, 0.3)
            d = R * rnd.uniform(0.5, 0.65)
            c = centre + Vector((math.cos(a) * d, math.sin(a) * d, rnd.uniform(-0.2, 0.08) * R * flat))
            if variant == 2:
                c += lean * 0.6
            sz = R * rnd.uniform(0.48, 0.62)
        lump(leaf, c, (sz, sz, sz * flat), jit(OAK if b % 2 else OAK_DARK, rnd, 0.06), rnd)
    return trunk, leaf


def birch(stage, variant, lo=False):
    rnd = random.Random(3000 + stage * 10 + variant)
    k = rnd.uniform(0.92, 1.08)
    H = [0.45, 0.95, 1.45, 1.7][stage] * k
    R = [0.12, 0.2, 0.28, 0.32][stage] * rnd.uniform(0.9, 1.1)
    tr = [0.02, 0.032, 0.048, 0.06][stage]
    trunk, leaf = Part(), Part()
    if lo:
        lean = (rnd.uniform(-0.05, 0.05), rnd.uniform(-0.05, 0.05))
        trunk.cylinder(4, tr, tr * 0.6, -0.05, H * 0.6, BIRCH_BARK, rnd, tilt=lean)
        leaf.blob((lean[0], lean[1], H * 0.68), (R, R, R * 1.5), BIRCH_LEAF, rnd, noise=0.1)
        return trunk, leaf
    marks = {(i, k) for i in range(6) for k in range(5) if rnd.random() < 0.14}  # dark marks on the white bark
    bark = lambda i, k: BIRCH_MARK if (i, k) in marks else BIRCH_BARK
    a = rnd.uniform(0, math.tau)
    out = Vector((math.cos(a), math.sin(a), 0))
    if variant == 1 and stage >= 1:  # two stems from one root, parting as they rise
        stems = [(out * 0.12 * H / 1.45, 0.85), (-out * 0.1 * H / 1.45 + Vector((out.y, -out.x, 0)) * 0.04, 1.0)]
        rr = 0.8
    elif variant == 2:  # leaning, bowed, the twigs weeping
        stems = [(out * [0.06, 0.15, 0.24, 0.3][stage], 1.0)]
        rr = 1.0
    else:  # one slender straight stem
        stems = [(Vector((rnd.uniform(-0.03, 0.03), rnd.uniform(-0.03, 0.03), 0)), 1.0)]
        rr = 1.0
    for lean, hk in stems:
        h = H * hk
        top = lean + Vector((0, 0, h * 0.74))
        kink = lean * 0.25 if variant == 2 else Vector((0, 0, 0))
        path = bend((lean.x * 0.08, lean.y * 0.08, -0.1 if variant == 2 else -0.05), top, kink, 4)
        tube(trunk, [(p, tr * rr * (1.15 if i == 0 else 1 - 0.45 * i / 4)) for i, p in enumerate(path)], 5 if len(stems) == 1 else 4, bark, rnd,
             flat_base=variant != 2)  # a hard lean pinches if the foot is kept level; bury it instead
        # an open crown of small clumps up the top of the stem, so light shows between them
        lumps = [1, 3, 4, 5][stage] if len(stems) == 1 else [1, 2, 2, 2][stage]
        for b in range(lumps):
            t = b / max(1, lumps - 1)
            a = b * 2.4 + rnd.uniform(-0.3, 0.3)
            d = R * rr * (0.45 if lumps > 1 else 0) * (1 - 0.5 * t)
            c = lean * (1.05 + (0.2 if variant == 2 else 0.0) * t) + Vector((math.cos(a) * d, math.sin(a) * d, h * (0.48 + (0.3 if len(stems) == 1 else 0.2) * t)))
            s = R * rr * ((0.62 if len(stems) == 1 else 0.8) if lumps > 1 else 1.0) * (1 - 0.3 * t) * rnd.uniform(0.85, 1.1)
            if variant == 2:  # weeping: clumps drawn long and hanging, pushed out over the lean
                lump(leaf, c + lean * 0.35 - Vector((0, 0, s * 0.6)), (s * 0.9, s * 0.9, s * 2.0), jit(BIRCH_LEAF, rnd, 0.08), rnd, noise=0.1)
            else:
                lump(leaf, c, (s, s, s * 1.35), jit(BIRCH_LEAF, rnd, 0.08), rnd, noise=0.16)
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
for k in sorted(k for k in STATS if k.split('_')[0] in SPECIES and STATS[k] > 140):
    print(" big", k, STATS[k])
for k in ("pine_s2_v0", "oak_s3_v0", "birch_s2_v0", "oak_s2__lo", "rock_v0", "outcrop_v2", "grass_v0", "reeds_v0"):
    print(" ", k, STATS[k])
