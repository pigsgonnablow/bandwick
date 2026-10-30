"""People, animals, carried items and buildings for M1, exported as one GLB.

Run headless:  python3 blender/build_band.py [out.glb]
Conventions (read by src/render/band.ts):
  villager__{torso,head,arm*,fore*,thigh*,shin*,hairS,hairL,hairB,hairU,beard}  one body in parts, animated in the shader;
      the game shows one of the four hair pieces (short, long, braids, bun) and, on some men, the beard.
      Vertex colours are REGION CODES, not final colours: red = clothing, green = skin,
      blue = hair, black = leather/shoes. The game tints each person individually.
  deer__{body,head,antlers,spots,legFL,legFR,legBL,legBR}  animated in parts, real colours (antlers on stags, spots on fawns).
  carry__{log,berries,meat,fish,spear,axe,body,baby}           attached to a person's hands or shoulder.
  bld__{hearth,flame,leanto,hut0,hut1,storehouse,rack,site}  one tile footprint, centred on the origin;
      huts also come as bld__hut0d/hut1d (wattle-and-daub) and bld__hut0s/hut1s (drystone).
Models face -Y in Blender (= +Z in the game). 1 unit = one 6 m tile; an adult is 0.4 tall.
"""
import math
import os
import random
import sys

import bpy  # must come first: it makes bmesh and mathutils importable
import bmesh
from mathutils import Matrix, Vector

OUT = sys.argv[-1] if sys.argv[-1].endswith(".glb") else os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "src", "assets", "band.glb")


def lin(c):
    out = []
    for v in c:
        v = v / 255.0
        out.append(v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4)
    return (out[0], out[1], out[2], 1.0)


def jit(c, rnd, amt):
    k = 1 + rnd.uniform(-amt, amt)
    return tuple(max(0, min(255, v * k)) for v in c)


class Part:
    def __init__(self):
        self.bm = bmesh.new()
        self.col = self.bm.loops.layers.float_color.new("Col")

    def paint(self, faces, color, rnd=None, amt=0.0, raw=False):
        for f in faces:
            c = color if raw else lin(jit(color, rnd, amt) if rnd else color)
            if raw:
                c = (color[0], color[1], color[2], 1.0)
            for loop in f.loops:
                loop[self.col] = c

    def _faces_of(self, verts):
        fs = set()
        for v in verts:
            fs.update(v.link_faces)
        return fs

    def box(self, center, size, color, rnd=None, amt=0.05, rot=None, raw=False, taper=1.0):
        ret = bmesh.ops.create_cube(self.bm, size=1.0)
        R = rot or Matrix.Identity(3)
        for v in ret["verts"]:
            p = Vector((v.co.x * size[0], v.co.y * size[1], v.co.z * size[2]))
            if v.co.z > 0:  # narrow the top
                p.x *= taper
                p.y *= taper
            v.co = R @ p + Vector(center)
        self.paint(self._faces_of(ret["verts"]), color, rnd, amt, raw)
        return ret["verts"]

    def cyl(self, segs, r0, r1, a, b, color, rnd=None, amt=0.05, raw=False, cap=True):
        """Cylinder from point a to point b."""
        a, b = Vector(a), Vector(b)
        axis = b - a
        L = axis.length
        rot = axis.to_track_quat("Z", "Y").to_matrix()
        bm = self.bm
        r0v, r1v = [], []
        for k in range(segs):
            t = k / segs * math.tau
            r0v.append(bm.verts.new(a + rot @ Vector((math.cos(t) * r0, math.sin(t) * r0, 0))))
            r1v.append(bm.verts.new(a + rot @ Vector((math.cos(t) * r1, math.sin(t) * r1, L))))
        faces = [bm.faces.new((r0v[k], r0v[(k + 1) % segs], r1v[(k + 1) % segs], r1v[k])) for k in range(segs)]
        if cap:
            faces.append(bm.faces.new(r1v))
            faces.append(bm.faces.new(list(reversed(r0v))))
        self.paint(faces, color, rnd, amt, raw)
        return faces

    def cone(self, segs, r, z0, h, color, rnd=None, amt=0.05, center=(0, 0), raw=False):
        bm = self.bm
        ring = [bm.verts.new((center[0] + math.cos(k / segs * math.tau) * r, center[1] + math.sin(k / segs * math.tau) * r, z0)) for k in range(segs)]
        apex = bm.verts.new((center[0], center[1], z0 + h))
        faces = [bm.faces.new((ring[k], ring[(k + 1) % segs], apex)) for k in range(segs)]
        faces.append(bm.faces.new(list(reversed(ring))))
        self.paint(faces, color, rnd, amt, raw)
        return faces

    def blob(self, center, size, color, rnd=None, amt=0.06, noise=0.0, raw=False, subdiv=1):
        ret = bmesh.ops.create_icosphere(self.bm, subdivisions=subdiv, radius=1.0)
        rr = rnd or random.Random(0)
        for v in ret["verts"]:
            p = v.co * (1 + rr.uniform(-noise, noise))
            v.co = Vector((p.x * size[0], p.y * size[1], p.z * size[2])) + Vector(center)
        self.paint(self._faces_of(ret["verts"]), color, rnd, amt, raw)
        return ret["verts"]

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


bpy.ops.wm.read_factory_settings(use_empty=True)

# ---------------------------------------------------------------- villager (region-coded)
# A jointed body: thighs and shins, upper arms and forearms, so knees and elbows bend.
# Blender axes: x right, -y forward, z up.  Game axes: x right, +z forward, y up.
CLOTH, SKIN, HAIR, DARK = (1, 0, 0), (0, 1, 0), (0, 0, 1), (0, 0, 0)
# leggings: a darker shade of the same cloth (the code mixes cloth with the dark leather tone)
LEGS = (0.58, 0, 0)
# joint positions in GAME space (x, y up, z forward); exported to gait.json for the shader
J = {
    "hipL": (-0.031, 0.150, 0.0), "hipR": (0.031, 0.150, 0.0),
    "kneeL": (-0.031, 0.083, 0.004), "kneeR": (0.031, 0.083, 0.004),
    "shoulderL": (-0.069, 0.272, 0.0), "shoulderR": (0.069, 0.272, 0.0),
    "elbowL": (-0.074, 0.206, 0.0), "elbowR": (0.074, 0.206, 0.0),
    "neck": (0.0, 0.292, 0.0), "hip": (0.0, 0.150, 0.0),
}


def B(g):
    """game-space point -> Blender-space point"""
    return (g[0], -g[2], g[1])


def loft(q, rings, segs, color_of, cap_top=True, cap_bottom=True):
    """A body of elliptical rings: (z, rx, ry, cy) from bottom to top; cy shifts the ring front/back."""
    bm = q.bm
    loops = []
    for (z, rx, ry, cy) in rings:
        loops.append([bm.verts.new((math.cos(k / segs * math.tau) * rx, cy + math.sin(k / segs * math.tau) * ry, z)) for k in range(segs)])
    for i in range(len(loops) - 1):
        a, b = loops[i], loops[i + 1]
        fs = [bm.faces.new((a[k], a[(k + 1) % segs], b[(k + 1) % segs], b[k])) for k in range(segs)]
        q.paint(fs, color_of(i), raw=True)
    if cap_bottom:
        q.paint([bm.faces.new(list(reversed(loops[0])))], color_of(0), raw=True)
    if cap_top:
        q.paint([bm.faces.new(loops[-1])], color_of(len(loops) - 2), raw=True)


def limb(q, a, b, r0, r1, color, segs=6):
    q.cyl(segs, r0, r1, B(a), B(b), color, raw=True)



# The head is a shaped skull (jaw, chin, cheeks, brow, eye sockets) lofted from rings, and every hair
# piece is laid over that same skull surface, so they fit it whatever its proportions.
# Angles go round the head from the right: -pi/2 is the face (-y), +pi/2 the back of the head.
HEAD_Y = -0.002  # the skull sits a touch forward of the neck
# skull rings, bottom to top: (z, half-width, depth to the face, depth to the back)
SKULL = [(0.299, 0.012, 0.025, 0.004), (0.305, 0.022, 0.031, 0.012), (0.314, 0.029, 0.034, 0.025),
         (0.324, 0.034, 0.034, 0.033), (0.334, 0.036, 0.0315, 0.036), (0.344, 0.036, 0.035, 0.038),
         (0.355, 0.034, 0.033, 0.037), (0.365, 0.028, 0.025, 0.032), (0.372, 0.017, 0.013, 0.020)]
HEAD_TOP = 0.3755
HAIR_DIM = (0, 0, 0.72)  # hair in shadow: under a lock, inside a parting, the underside of a fall
LIP = (0, 0.55, 0)       # skin darkened towards leather brown


def skull_at(z):
    """The skull ring at height z: (half-width, face depth, back depth), shrinking to nothing at the crown."""
    if z <= SKULL[0][0]:
        return SKULL[0][1:]
    if z >= SKULL[-1][0]:
        k = min(1.0, (z - SKULL[-1][0]) / (HEAD_TOP - SKULL[-1][0]))
        k = math.sqrt(max(0.0, 1 - k * k))
        return tuple(v * k for v in SKULL[-1][1:])
    for (z0, *a), (z1, *b) in zip(SKULL, SKULL[1:]):
        if z <= z1:
            k = (z - z0) / (z1 - z0)
            return tuple(u + (w - u) * k for u, w in zip(a, b))


def on_skull(z, t, grow=0.0):
    """A point on the skull (or `grow` outside it) at height z and angle t: a squarish ellipse."""
    rx, yf, yb = skull_at(z)
    c, s = math.cos(t), math.sin(t)
    sq = lambda v: math.copysign(abs(v) ** 0.8, v)
    return Vector((sq(c) * (rx + grow), sq(s) * ((yb if s > 0 else yf) + grow) + HEAD_Y, z))


def smooth(pts, x):
    """Piecewise-linear lookup in [(x, y), ...]."""
    if x <= pts[0][0]:
        return pts[0][1]
    for (x0, y0), (x1, y1) in zip(pts, pts[1:]):
        if x <= x1:
            return y0 + (y1 - y0) * (x - x0) / (x1 - x0)
    return pts[-1][1]


def from_face(t):
    """How far round from the middle of the face an angle is, 0 (face) to pi (nape)."""
    return abs(math.atan2(math.sin(t + math.pi / 2), math.cos(t + math.pi / 2)))


def grid(q, rows, color_of, wrap=True):
    """Quads between rows of points (each row a list, same length); returns the faces."""
    bm = q.bm
    vs = [[bm.verts.new(p) for p in row] for row in rows]
    n = len(rows[0])
    faces = []
    for i in range(len(vs) - 1):
        for k in range(n if wrap else n - 1):
            k1 = (k + 1) % n
            f = bm.faces.new((vs[i][k], vs[i][k1], vs[i + 1][k1], vs[i + 1][k]))
            q.paint([f], color_of(i, k), raw=True)
            faces.append(f)
    return vs, faces


def fan(q, ring, apex, color, flip=False, raw=True):
    a = q.bm.verts.new(apex)
    for k in range(len(ring)):
        tri = (ring[k], ring[(k + 1) % len(ring)], a)
        q.paint([q.bm.faces.new(tri[::-1] if flip else tri)], color, raw=raw)


def solid(q, verts, faces, color, raw=True):
    """A small closed shape from a vertex list and index faces (raw: color is a region code, not sRGB)."""
    vs = [q.bm.verts.new(v) for v in verts]
    q.paint([q.bm.faces.new([vs[i] for i in f]) for f in faces], color, raw=raw)


SEG = 12
q = Part()  # head: neck, skull, nose, brows, eyes, mouth and ears
limb(q, (0, 0.282, 0), (0, 0.306, 0.004), 0.0172, 0.0158, SKIN)
ts = [-math.pi / 2 + k / SEG * math.tau for k in range(SEG)]  # a column runs down the middle of the face
rows, _ = grid(q, [[on_skull(z, t) for t in ts] for z, *_ in SKULL], lambda i, k: SKIN)
fan(q, rows[-1], (0, HEAD_Y + 0.002, HEAD_TOP), SKIN)
fan(q, rows[0], (0, HEAD_Y - 0.012, 0.2975), SKIN, flip=True)
# nose: a wedge from the brow to a tip, with a little underside
solid(q, [(0, -0.0335, 0.341), (0, -0.0425, 0.3225), (-0.0068, -0.0335, 0.3205), (0.0068, -0.0335, 0.3205), (0, -0.026, 0.326)],
      [(0, 2, 1), (0, 1, 3), (2, 3, 1), (0, 4, 2), (0, 3, 4), (2, 4, 3)], SKIN)
for sx in (-1, 1):
    # eyes: dark, set into the sockets under the brow
    q.box((sx * 0.0128, -0.0318, 0.3355), (0.0072, 0.003, 0.0058), DARK, raw=True)
    # brows: a slanted ridge of hair colour, thicker over the eye's outer end
    solid(q, [(sx * 0.0045, -0.0368, 0.3449), (sx * 0.0205, -0.0345, 0.3449), (sx * 0.0200, -0.0340, 0.3422),
              (sx * 0.0050, -0.0363, 0.3434), (sx * 0.0120, -0.0310, 0.3448)],
          [(0, 1, 2, 3), (0, 4, 1), (1, 4, 2), (2, 4, 3), (3, 4, 0)], HAIR)
    # ears: a cupped flap, wider at the top, set back from the cheek
    ex = sx * 0.0352
    solid(q, [(ex, 0.0005, 0.3435), (ex + sx * 0.0052, 0.0035, 0.3415), (ex + sx * 0.0048, 0.0075, 0.3335),
              (ex + sx * 0.0032, 0.0055, 0.3245), (ex, 0.0010, 0.3245), (ex - sx * 0.002, 0.0070, 0.3340)],
          [(0, 1, 5), (1, 2, 5), (2, 3, 5), (3, 4, 5), (4, 0, 5), (0, 4, 3, 2, 1)], SKIN)
# mouth: a short dark line under the nose
q.box((0, -0.0331, 0.3122), (0.012, 0.0024, 0.0022), LIP, raw=True, taper=0.75)
q.finish("villager__head")


def cap(q, hairline, thick, rnd, jag=0.0, part=False, flat=0.0):
    """Hair over the skull from `hairline(t)` up to the crown, `thick` out from it, its edge tucked
    into the skull so the shell never shows a rim. jag ruffles the fringe; part draws a parting;
    flat lays it down smooth (less tousle)."""
    n = 14
    ts = [-math.pi / 2 + (k + 0.5) / n * math.tau for k in range(n)]
    us = [0.0, 0.3, 0.6, 0.86]
    rows = []
    edge = []
    for k, t in enumerate(ts):
        z0 = hairline(t)
        if jag and from_face(t) < 1.3:  # a ragged fringe across the forehead
            z0 += (-jag if k % 2 else jag * 0.4) * (1 - from_face(t) / 1.3)
        edge.append(z0)
    for j, u in enumerate(us):
        row = []
        for k, t in enumerate(ts):
            z = edge[k] + (HEAD_TOP - edge[k]) * u
            g = thick * (0.55 + 0.45 * u) + rnd.uniform(-1, 1) * thick * 0.3 * (1 - flat)
            if part and abs(math.cos(t)) < 0.15 and u > 0.1 and from_face(t) < 1.6:
                g *= 0.45  # the parting, down the middle from the brow
            p = on_skull(z, t, g)
            p.z += g * u * 0.9  # the top sits up off the crown too
            row.append(p)
        rows.append(row)
    tuck = [on_skull(edge[k] + 0.002, t, -0.003) for k, t in enumerate(ts)]
    dim = lambda i, k: HAIR_DIM if i == 0 else (HAIR if (k + i) % 3 or flat else (0, 0, 0.88))
    vs, _ = grid(q, [tuck] + rows, dim)
    fan(q, vs[-1], (0, HEAD_Y + 0.004, HEAD_TOP + thick * 1.05), HAIR)
    return ts, rows


def hairline(front, temple, ear, nape):
    return lambda t: smooth([(0, front), (0.75, temple), (1.25, temple - 0.002), (1.6, ear), (2.1, ear - 0.006), (math.pi, nape)], from_face(t))


def slab(q, outer, inner, color_out, color_in):
    """A thick sheet between an outer and an inner grid of points (rows x cols), closed round its edges."""
    vo, _ = grid(q, outer, lambda i, k: color_out(i, k), wrap=False)
    vi, _ = grid(q, inner, lambda i, k: color_in, wrap=False)
    for f in [f for f in q.bm.faces if all(v in set(sum(vi, [])) for v in f.verts)]:
        f.normal_flip()
    bm = q.bm
    R, C = len(outer), len(outer[0])
    ring = [(0, k) for k in range(C)] + [(i, C - 1) for i in range(1, R)] + [(R - 1, k) for k in range(C - 2, -1, -1)] + [(i, 0) for i in range(R - 2, 0, -1)]
    for a, b in zip(ring, ring[1:] + ring[:1]):
        f = bm.faces.new((vo[a[0]][a[1]], vo[b[0]][b[1]], vi[b[0]][b[1]], vi[a[0]][a[1]]))
        q.paint([f], color_in, raw=True)


def braid(q, path, r, rnd):
    """A plait: a four-sided tube along the path, swelling and pinching at each twist, tied at the end."""
    bm = q.bm
    pts = [Vector(p) for p in path]
    rings = []
    steps = 9
    for i in range(steps):
        u = i / (steps - 1) * (len(pts) - 1)
        a = min(int(u), len(pts) - 2)
        f = u - a
        c = pts[a].lerp(pts[a + 1], f)
        d = (pts[a + 1] - pts[a]).normalized()
        side = d.cross(Vector((0, 0, 1)))
        if side.length < 1e-6:
            side = Vector((1, 0, 0))
        side.normalize()
        up = side.cross(d).normalized()
        rr = r * (1.0 if i % 2 == 0 else 0.68) * (1 - 0.35 * i / steps)
        twist = (i % 2) * math.pi / 4
        rings.append([bm.verts.new(c + (side * math.cos(twist + k * math.pi / 2) + up * math.sin(twist + k * math.pi / 2)) * rr) for k in range(4)])
    for i in range(steps - 1):
        a, b = rings[i], rings[i + 1]
        for k in range(4):
            f = bm.faces.new((a[k], a[(k + 1) % 4], b[(k + 1) % 4], b[k]))
            q.paint([f], HAIR if i % 2 == 0 else HAIR_DIM, raw=True)
    q.paint([bm.faces.new(list(reversed(rings[0])))], HAIR, raw=True)
    tip = pts[-1] + (pts[-1] - pts[-2]).normalized() * r * 1.6
    fan(q, rings[-1], tip, HAIR)
    tie = pts[-1].lerp(pts[-2], 0.12)
    q.box(tuple(tie), (r * 1.25, r * 1.25, r * 0.8), DARK, raw=True)


# short hair: cropped and a little ragged over the brow
q = Part()
cap(q, hairline(0.3525, 0.347, 0.341, 0.3165), 0.0042, random.Random(51), jag=0.0035)
q.finish("villager__hairS")

# long hair: the cap, falling thick down the back to the shoulder blades, with a ragged end
q = Part()
rnd = random.Random(52)
cap(q, hairline(0.3535, 0.3465, 0.334, 0.322), 0.0048, rnd, jag=0.002, flat=0.4)
fall_t = [math.pi / 2 + (k / 8 - 0.5) * 2.5 for k in range(9)]
fall_z = [0.338, 0.318, 0.297, 0.276, 0.258]
outer, inner = [], []
for j, z in enumerate(fall_z):
    ro, ri = [], []
    for k, t in enumerate(fall_t):
        zz = z - (0.006 if (k % 2 and j == len(fall_z) - 1) else 0)
        zs = max(z, 0.318)
        o = on_skull(zs, t, 0.0062)
        # below the skull the fall hangs down the upper back, widening and lying back off the neck
        drop = max(0.0, 0.318 - z)
        o.x *= 1 + drop * 5.5
        o.y += drop * 0.30 + (0.0016 * rnd.uniform(-1, 1))
        o.z = zz
        i_ = o.copy()
        i_.y -= 0.0055 * math.sin(t) if j else 0.0
        i_.x -= 0.0055 * math.cos(t) if j else 0.0
        if j == 0:
            i_ = on_skull(zs, t, -0.002)
        ro.append(o)
        ri.append(i_)
    outer.append(ro)
    inner.append(ri)
slab(q, outer, inner, lambda i, k: HAIR if (i + k) % 3 else (0, 0, 0.88), HAIR_DIM)
q.finish("villager__hairL")

# braids: hair drawn smooth from a middle parting into two plaits that hang over the shoulders
q = Part()
cap(q, hairline(0.354, 0.347, 0.333, 0.321), 0.0032, random.Random(53), part=True, flat=0.8)
for sx in (-1, 1):
    braid(q, [(sx * 0.031, 0.010, 0.328), (sx * 0.037, -0.006, 0.304), (sx * 0.035, -0.030, 0.284),
              (sx * 0.031, -0.043, 0.264), (sx * 0.029, -0.046, 0.247)], 0.0062, rnd)
q.finish("villager__hairB")

# bun: hair pulled back smooth and knotted at the back of the head
q = Part()
cap(q, hairline(0.3545, 0.3475, 0.337, 0.322), 0.0030, random.Random(54), flat=0.9)
bun = bmesh.ops.create_uvsphere(q.bm, u_segments=8, v_segments=5, radius=1.0)
br = random.Random(55)
for v in bun["verts"]:
    k = 1 + br.uniform(-0.08, 0.08)
    v.co = Vector((v.co.x * 0.0185 * k, v.co.y * 0.0150 * k, v.co.z * 0.0165 * k)) + Vector((0, HEAD_Y + 0.0440, 0.3500))
q.paint(q._faces_of(bun["verts"]), HAIR, raw=True)
for f in q._faces_of(bun["verts"]):
    if f.calc_center_median().z < 0.3445:
        q.paint([f], (0, 0, 0.88), raw=True)
q.box((0, HEAD_Y + 0.0345, 0.3500), (0.024, 0.005, 0.006), DARK, raw=True)  # the tie
q.finish("villager__hairU")

# beard: worn by some men on their own; jaw to chin, up the cheeks into sideburns, and a moustache
q = Part()
rnd = random.Random(56)
bt = [-math.pi / 2 + (k / 8 - 0.5) * 2.9 for k in range(9)]
outer, inner = [], []
for j, v in enumerate([0.0, 0.5, 1.0]):
    ro, ri = [], []
    for k, t in enumerate(bt):
        f = from_face(t)
        lo = smooth([(0, 0.289), (0.7, 0.297), (1.2, 0.305), (1.45, 0.312)], f)
        hi = smooth([(0, 0.309), (0.45, 0.3115), (0.8, 0.322), (1.2, 0.331), (1.45, 0.337)], f)
        z = lo + (hi - lo) * v
        g = smooth([(0, 0.0058), (0.9, 0.0042), (1.45, 0.0025)], f) * (0.5 + 0.5 * math.sin(v * math.pi) + 0.2)
        o = on_skull(max(z, 0.300), t, g + rnd.uniform(-0.0006, 0.0006))
        o.z = z - (0.0025 if j == 0 and k % 2 else 0)
        ri.append(on_skull(max(z, 0.300), t, -0.002))
        ri[-1].z = z + (0.004 if j == 0 else 0)
        ro.append(o)
    outer.append(ro)
    inner.append(ri)
slab(q, outer, inner, lambda i, k: HAIR if (i + k) % 3 else (0, 0, 0.88), HAIR_DIM)
for sx in (-1, 1):  # moustache: drooping from under the nose to the corners of the mouth
    solid(q, [(sx * 0.001, -0.0395, 0.3178), (sx * 0.0105, -0.0365, 0.3150), (sx * 0.0135, -0.0335, 0.3085),
              (sx * 0.009, -0.0345, 0.3135), (sx * 0.001, -0.0370, 0.3155), (sx * 0.006, -0.0320, 0.3170)],
          [(0, 1, 5), (1, 2, 5), (2, 3, 5), (3, 4, 5), (4, 0, 5), (0, 4, 3, 2, 1)], HAIR)
q.finish("villager__beard")

def tube(q, a, b, r0, r1, color, segs=7, cap=True):
    """A limb from a to b (game space) with no seam lined up on the front."""
    return q.cyl(segs, r0, r1, B(a), B(b), color, raw=True, cap=cap)


def hand(q, wrist, sx):
    """A hand hanging from the wrist, palm in: a tapered palm, fingers curled a little forward, a thumb."""
    w = Vector(B(wrist))
    q.box(w + Vector((0, -0.0005, -0.0075)), (0.0068, 0.0118, 0.0135), SKIN, raw=True, taper=0.85)
    q.box(w + Vector((sx * 0.0004, -0.0018, -0.0178)), (0.0058, 0.0108, 0.0085), SKIN, raw=True, taper=1.15,
          rot=Matrix.Rotation(0.22, 3, "X"))
    q.box(w + Vector((-sx * 0.0018, -0.0068, -0.0085)), (0.0042, 0.0042, 0.0095), SKIN, raw=True,
          rot=Matrix.Rotation(-0.35, 3, "X") @ Matrix.Rotation(sx * 0.25, 3, "Y"))


def shoe(q, x):
    """A soft hide shoe: a heel, a high cuff round the ankle, a low rounded toe; front is -y."""
    bm = q.bm
    # sections heel to toe: (y, half-width, top)
    secs = [(0.0150, 0.0105, 0.019), (0.0050, 0.0135, 0.028), (-0.0095, 0.0140, 0.0185), (-0.0250, 0.0120, 0.0110), (-0.0335, 0.0060, 0.0065)]
    rings = []
    for y, hw, top in secs:
        bot = 0.0 if y > -0.03 else 0.0012
        rings.append([bm.verts.new(p) for p in [(x - hw, y, bot), (x - hw, y, top * 0.55), (x - hw * 0.65, y, top),
                                                  (x + hw * 0.65, y, top), (x + hw, y, top * 0.55), (x + hw, y, bot)]])
    for i in range(len(rings) - 1):
        a, b = rings[i], rings[i + 1]
        q.paint([bm.faces.new((a[k], a[(k + 1) % 6], b[(k + 1) % 6], b[k])) for k in range(6)], DARK, raw=True)
    q.paint([bm.faces.new(rings[0]), bm.faces.new(list(reversed(rings[-1])))], DARK, raw=True)


WRAP = (0.30, 0, 0)  # leg bindings: a strip of hide, mostly leather with a little of the cloth through it
for side, sx in (("L", -1), ("R", 1)):
    hip, knee = J["hip" + side], J["knee" + side]
    ankle = (hip[0], 0.024, 0.0)
    q = Part()  # thigh: leggings, slightly overlapping the hip and knee so bends never open a gap
    tube(q, (hip[0], hip[1] + 0.012, 0), (knee[0], knee[1] - 0.004, knee[2]), 0.0215, 0.0165, LEGS)
    q.finish(f"villager__thigh{side}")
    q = Part()  # shin: leggings bound with two wraps of hide below the knee and above the ankle, and a shoe
    tube(q, (knee[0], knee[1] + 0.006, knee[2]), (hip[0], 0.052, 0.002), 0.0163, 0.0142, LEGS)
    tube(q, (hip[0], 0.052, 0.002), ankle, 0.0142, 0.0118, LEGS, cap=False)
    tube(q, (knee[0], 0.066, 0.003), (knee[0], 0.058, 0.003), 0.0158, 0.0156, WRAP, cap=False)
    tube(q, (hip[0], 0.040, 0.001), (hip[0], 0.031, 0.0005), 0.0135, 0.0130, WRAP, cap=False)
    shoe(q, hip[0])
    q.finish(f"villager__shin{side}")
    sh, el = J["shoulder" + side], J["elbow" + side]
    wrist = (el[0] + sx * 0.002, 0.152, 0.004)
    q = Part()  # upper arm: a sleeve, rounded at the shoulder
    tube(q, (sh[0], sh[1] + 0.006, 0), (el[0], el[1] - 0.004, 0), 0.0165, 0.0135, CLOTH)
    sph = bmesh.ops.create_uvsphere(q.bm, u_segments=8, v_segments=4, radius=1.0)  # a soft shoulder
    for v in sph["verts"]:
        v.co = Vector((v.co.x * 0.0168, v.co.y * 0.0168, v.co.z * 0.0150)) + Vector(B((sh[0] - sx * 0.001, sh[1] - 0.001, 0)))
    q.paint(q._faces_of(sph["verts"]), CLOTH, raw=True)
    q.finish(f"villager__arm{side}")
    q = Part()  # forearm: a sleeve to mid-forearm ending in a loose turned-back cuff, bare wrist, a hand
    mid = (el[0] + sx * 0.001, 0.180, 0.002)
    tube(q, (el[0], el[1] + 0.005, 0), mid, 0.0138, 0.0128, CLOTH)
    tube(q, (mid[0], mid[1] + 0.006, mid[2]), (mid[0], mid[1] - 0.002, mid[2]), 0.0150, 0.0156, CLOTH)
    tube(q, mid, wrist, 0.0104, 0.0088, SKIN, segs=6)
    hand(q, wrist, sx)
    q.finish(f"villager__fore{side}")

# torso: a tunic, chest and shoulders over a waist, belted, flaring to a ragged hem, open at the throat.
# rings bottom to top: (z, half-width, depth to the front, depth to the back); 'belt' rows stand proud
TSEG = 10
TORSO = [(0.121, 0.068, 0.052, 0.050), (0.140, 0.064, 0.048, 0.046), (0.163, 0.058, 0.043, 0.041),
         (0.183, 0.0535, 0.039, 0.037), (0.1855, 0.0565, 0.042, 0.040), (0.1975, 0.0565, 0.042, 0.040),
         (0.2000, 0.0535, 0.039, 0.037), (0.228, 0.057, 0.0415, 0.037), (0.251, 0.0615, 0.0425, 0.036),
         (0.267, 0.064, 0.038, 0.034), (0.282, 0.049, 0.031, 0.029), (0.292, 0.026, 0.021, 0.021)]
BELT_ROWS = (3, 4, 5)
q = Part()
sqv = lambda v: math.copysign(abs(v) ** 0.8, v)
rows = []
for i, (z, rx, yf, yb) in enumerate(TORSO):
    row = []
    for k in range(TSEG):
        t = -math.pi / 2 + k / TSEG * math.tau
        c, s = math.cos(t), math.sin(t)
        zz = z
        if i == 0:
            zz -= 0.0065 if k % 2 else 0.0  # the hem hangs unevenly
        if i == len(TORSO) - 2 and k == 0:
            zz -= 0.007  # the neck opening dips at the front
        row.append((sqv(c) * rx, sqv(s) * (yb if s > 0 else yf), zz))
    rows.append(row)


def torso_col(i, k):
    if i in BELT_ROWS:
        return DARK
    if i == len(TORSO) - 2 and k in (0, TSEG - 1):
        return SKIN  # the throat, where the tunic falls open
    return CLOTH


vs, _ = grid(q, rows, torso_col)
fan(q, vs[-1], (0, 0.001, 0.294), CLOTH)
fan(q, vs[0], (0, 0.0, 0.128), CLOTH, flip=True)
for f in q.bm.faces:  # the fan at the neck is open at the front too
    cen = f.calc_center_median()
    if cen.z > 0.289 and cen.y < -0.006 and abs(cen.x) < 0.009:
        q.paint([f], SKIN, raw=True)
# a hide pouch hanging from the belt at the right hip, and the belt's knot at the front
q.box((0.040, -0.030, 0.171), (0.017, 0.009, 0.021), DARK, raw=True, taper=0.85, rot=Matrix.Rotation(0.5, 3, "Z"))
q.box((-0.010, -0.0425, 0.190), (0.008, 0.004, 0.009), DARK, raw=True)
q.box((-0.012, -0.0420, 0.180), (0.004, 0.003, 0.012), DARK, raw=True, rot=Matrix.Rotation(0.3, 3, "Y"))
q.finish("villager__torso")

# ---------------------------------------------------------------- deer
DEER = (150, 102, 62)
DEER_DARK = (96, 64, 40)
DEER_BACK = (128, 86, 52)   # darker along the spine
BELLY = (214, 196, 168)
RUMP = (226, 214, 192)      # the pale patch round the tail
HOOF = (44, 34, 28)
NOSE = (52, 40, 34)
ANTLER = (196, 176, 140)
ANTLER_TIP = (226, 214, 190)
SPOT = (232, 220, 196)
rnd = random.Random(11)


def loft_y(q, rings, segs, color_at):
    """A horizontal body: rings (y, rx, rz, cz) front to back; faces coloured by where they sit."""
    bm = q.bm
    loops = [[bm.verts.new((math.cos(k / segs * math.tau) * rx, y, cz + math.sin(k / segs * math.tau) * rz)) for k in range(segs)] for (y, rx, rz, cz) in rings]
    faces = []
    for i in range(len(loops) - 1):
        a, b = loops[i], loops[i + 1]
        faces += [bm.faces.new((a[k], b[k], b[(k + 1) % segs], a[(k + 1) % segs])) for k in range(segs)]
    faces.append(bm.faces.new(loops[0]))
    faces.append(bm.faces.new(list(reversed(loops[-1]))))
    for f in faces:
        q.paint([f], color_at(f.calc_center_median()), rnd, 0.04)


def sweep(q, path, segs, color_at, caps=(True, True)):
    """A tube along a path of (point, half-width, half-height): rings stand square to the path, their
    'up' kept towards +z, so necks and muzzles keep a flat top and a deep jaw."""
    bm = q.bm
    pts = [Vector(p) for p, _, _ in path]
    loops = []
    for i, (p, rx, rz) in enumerate(path):
        d = (pts[min(i + 1, len(pts) - 1)] - pts[max(i - 1, 0)]).normalized()
        side = d.cross(Vector((0, 0, 1)) if abs(d.z) < 0.9 else Vector((0, -1, 0))).normalized()
        up = side.cross(d).normalized()
        loops.append([bm.verts.new(pts[i] + side * math.cos(k / segs * math.tau) * rx + up * math.sin(k / segs * math.tau) * rz) for k in range(segs)])
    faces = []
    for i in range(len(loops) - 1):
        a, b = loops[i], loops[i + 1]
        faces += [bm.faces.new((a[k], a[(k + 1) % segs], b[(k + 1) % segs], b[k])) for k in range(segs)]
    if caps[0]:
        faces.append(bm.faces.new(list(reversed(loops[0]))))
    if caps[1]:
        faces.append(bm.faces.new(loops[-1]))
    for f in faces:
        q.paint([f], color_at(f.calc_center_median()), rnd, 0.04)
    return loops


# body: a deep chest behind the shoulders, a rise at the withers, the belly drawn up at the flank, a rounded
# haunch; brown above a pale belly, darker along the spine, a pale rump patch round a short tail
BODY = [(-0.142, 0.026, 0.034, 0.228), (-0.122, 0.040, 0.054, 0.214), (-0.092, 0.049, 0.065, 0.202), (-0.048, 0.052, 0.060, 0.199),
        (0.004, 0.049, 0.052, 0.203), (0.052, 0.051, 0.056, 0.206), (0.094, 0.050, 0.059, 0.208), (0.124, 0.039, 0.049, 0.212),
        (0.143, 0.019, 0.024, 0.215)]


def body_col(c):
    if c.y > 0.112 and c.z > 0.178:
        return RUMP
    if c.z < 0.162:
        return BELLY
    if c.z > 0.252 and abs(c.x) < 0.02:
        return DEER_BACK
    return DEER


q = Part()
loft_y(q, BODY, 10, body_col)
solid(q, [(0, 0.140, 0.236), (-0.011, 0.150, 0.230), (0.011, 0.150, 0.230), (0, 0.160, 0.200), (0, 0.146, 0.222)],
      [(0, 1, 3), (0, 3, 2), (1, 2, 3), (0, 4, 1), (0, 2, 4), (1, 4, 2)], RUMP, raw=False)  # the tail, flicked up a little
q.box((0, 0.153, 0.232), (0.016, 0.012, 0.010), DEER_DARK, rnd, 0.0, rot=Matrix.Rotation(-0.6, 3, "X"))  # dark top of the tail
q.finish("deer__body")


def body_surface(y, a):
    """A point on the body's skin at length y, angle a round it (0 = right side, pi/2 = top)."""
    for (y0, *r0), (y1, *r1) in zip(BODY, BODY[1:]):
        if y0 <= y <= y1:
            k = (y - y0) / (y1 - y0)
            rx, rz, cz = [u + (v - u) * k for u, v in zip(r0, r1)]
            return Vector((math.cos(a) * rx, y, cz + math.sin(a) * rz))
    raise ValueError(y)


q = Part()  # a fawn's dappling: rows of pale spots down the back and flanks (the game shows them on fawns only)
sr = random.Random(12)
for row, a0 in enumerate((1.25, 0.95, 0.65, 0.4)):
    for k in range(6 - row // 2):
        y = -0.085 + k * 0.034 + (row % 2) * 0.017 + sr.uniform(-0.009, 0.009)
        for side in (1, -1):
            a = a0 + sr.uniform(-0.1, 0.1)
            a = a if side > 0 else math.pi - a
            p = body_surface(y, a)
            n = Vector((math.cos(a), 0, math.sin(a)))
            # a small pale disc lying on the hide, a hair proud of it
            t1 = n.cross(Vector((0, 1, 0))).normalized()
            t2 = Vector((0, 1, 0))
            sz = sr.uniform(0.75, 1.1)
            ring = [q.bm.verts.new(p + n * 0.0015 + (t1 * math.cos(k / 5 * math.tau) * 0.0048 + t2 * math.sin(k / 5 * math.tau) * 0.0062) * sz) for k in range(5)]
            fan(q, ring, p + n * 0.0025, SPOT, raw=False)
q.finish("deer__spots")

q = Part()  # neck (paler at the throat), a wedge of a head, dark nose, pale chin, big ears, dark eyes
neck = [((0, -0.098, 0.222), 0.031, 0.040), ((0, -0.126, 0.262), 0.025, 0.031), ((0, -0.146, 0.296), 0.020, 0.025), ((0, -0.156, 0.312), 0.019, 0.022)]
sweep(q, neck, 8, lambda c: BELLY if c.z < 0.25 and c.y < -0.11 and (c.y + 0.04) < -(c.z - 0.13) * 0.55 else DEER, caps=(True, False))
head = [((0, -0.150, 0.322), 0.020, 0.022), ((0, -0.168, 0.320), 0.023, 0.024), ((0, -0.188, 0.311), 0.017, 0.019),
        ((0, -0.208, 0.302), 0.0125, 0.0145), ((0, -0.222, 0.297), 0.0095, 0.0115)]
sweep(q, head, 8, lambda c: NOSE if c.y < -0.216 else (BELLY if c.z < 0.296 and c.y < -0.18 else DEER))
for ex in (-1, 1):
    q.box((ex * 0.0205, -0.178, 0.326), (0.006, 0.010, 0.0075), HOOF, rnd, 0.0, rot=Matrix.Rotation(ex * 0.35, 3, "Z"))  # eye
    # ears: long leaves set high behind the eyes, turned out to the side, pale inside
    ear = Matrix.Rotation(ex * 0.75, 3, "Y") @ Matrix.Rotation(0.35, 3, "X")
    base = Vector((ex * 0.017, -0.153, 0.338))
    solid(q, [base + ear @ Vector(v) for v in [(0, -0.008, 0), (0, 0.008, 0), (0, 0.009, 0.020), (0, 0, 0.036), (0, -0.009, 0.020),
                                                (ex * 0.003, 0, 0.016)]],
          [(0, 1, 5), (1, 2, 5), (2, 3, 5), (3, 4, 5), (4, 0, 5), (0, 4, 3, 2, 1)], DEER, raw=False)
    solid(q, [base + ear @ Vector(v) for v in [(-ex * 0.0012, -0.006, 0.004), (-ex * 0.0012, 0.006, 0.004), (-ex * 0.0012, 0.0055, 0.019),
                                                (-ex * 0.0012, 0, 0.030), (-ex * 0.0012, -0.0055, 0.019), (-ex * 0.0030, 0, 0.014)]],
          [(0, 1, 5), (1, 2, 5), (2, 3, 5), (3, 4, 5), (4, 0, 5), (0, 4, 3, 2, 1)], BELLY, raw=False)
q.finish("deer__head")


def tine(q, a, b, r0, r1):
    q.cyl(4, r0, r1, a, b, ANTLER, rnd, 0.03)


q = Part()  # antlers (worn by stags only; the game hides them on hinds and fawns): a beam sweeping back and
for ex in (-1, 1):  # up from a burr, a brow tine forward over the eyes, a tine up off the beam, a forked crown
    burr = Vector((ex * 0.012, -0.156, 0.338))
    p1 = burr + Vector((ex * 0.022, 0.012, 0.034))
    p2 = p1 + Vector((ex * 0.016, 0.022, 0.040))
    p3 = p2 + Vector((ex * 0.004, 0.018, 0.030))
    q.cyl(5, 0.0058, 0.0058, burr - Vector((0, 0, 0.002)), burr + Vector((0, 0, 0.004)), DEER_DARK, rnd, 0.0)  # pedicle
    tine(q, burr, p1, 0.0050, 0.0043)
    tine(q, p1, p2, 0.0043, 0.0034)
    tine(q, p2, p3, 0.0034, 0.0026)
    tine(q, burr.lerp(p1, 0.25), burr.lerp(p1, 0.25) + Vector((ex * 0.004, -0.034, 0.016)), 0.0036, 0.0016)  # brow tine
    tine(q, p1.lerp(p2, 0.55), p1.lerp(p2, 0.55) + Vector((ex * 0.002, -0.022, 0.030)), 0.0032, 0.0016)
    tine(q, p3, p3 + Vector((ex * 0.010, 0.008, 0.024)), 0.0025, 0.0013)  # the crown's fork
    tine(q, p3, p3 + Vector((-ex * 0.004, -0.010, 0.022)), 0.0025, 0.0013)
q.finish("deer__antlers")


def hoof(q, x, y):
    """A cloven hoof: two dark wedges, toes forward (-y)."""
    for s in (-1, 1):
        solid(q, [(x + s * 0.0005, y + 0.004, 0.0), (x + s * 0.0070, y + 0.003, 0.0), (x + s * 0.0035, y - 0.012, 0.0),
                  (x + s * 0.0010, y + 0.003, 0.012), (x + s * 0.0055, y + 0.002, 0.011)],
              [(0, 2, 1), (0, 1, 4, 3), (1, 2, 4), (2, 0, 3), (2, 3, 4)], HOOF, raw=False)


for name, x, y in (("legFL", -0.035, -0.09), ("legFR", 0.035, -0.09), ("legBL", -0.035, 0.09), ("legBR", 0.035, 0.09)):
    q = Part()
    if y < 0:  # foreleg: a muscled forearm, the knee, a slim cannon, a pastern sloping to the hoof
        path = [((x, y - 0.004, 0.185), 0.018, 0.024), ((x, y - 0.006, 0.150), 0.015, 0.018), ((x, y - 0.004, 0.112), 0.0095, 0.011),
                ((x, y - 0.003, 0.088), 0.0085, 0.0095), ((x, y - 0.002, 0.060), 0.0062, 0.0068), ((x, y - 0.002, 0.026), 0.0058, 0.0064),
                ((x, y - 0.006, 0.011), 0.0055, 0.006)]
    else:  # hind leg: the ham, the gaskin running back to a sharp hock, then the cannon forward to the hoof
        path = [((x, y - 0.006, 0.188), 0.021, 0.030), ((x, y + 0.004, 0.150), 0.018, 0.022), ((x, y + 0.016, 0.118), 0.0105, 0.012),
                ((x, y + 0.024, 0.094), 0.0085, 0.0105), ((x, y + 0.018, 0.070), 0.0063, 0.007), ((x, y + 0.006, 0.028), 0.0058, 0.0064),
                ((x, y + 0.002, 0.011), 0.0055, 0.006)]
    sweep(q, path, 6, lambda c: DEER_DARK if c.z < 0.055 else DEER)
    hoof(q, x, path[-1][0][1])
    q.finish(f"deer__{name}")

# ---------------------------------------------------------------- carried items (in hand/shoulder space)
BARK = (110, 80, 54)
q = Part()
q.cyl(5, 0.022, 0.02, (-0.17, 0, 0), (0.17, 0, 0), BARK, rnd, 0.05)
q.cyl(5, 0.018, 0.018, (-0.14, 0.03, 0.02), (0.15, 0.03, 0.02), BARK, rnd, 0.05)
q.finish("carry__log")
q = Part()
q.cyl(6, 0.04, 0.05, (0, 0, -0.03), (0, 0, 0.03), (168, 132, 82), rnd, 0.05)
q.blob((0, 0, 0.035), (0.04, 0.04, 0.018), (186, 36, 52), rnd, 0.1)
q.finish("carry__berries")
q = Part()
q.blob((0, 0, 0), (0.07, 0.045, 0.04), (150, 62, 50), rnd, 0.08, noise=0.15)
q.blob((0.02, 0, 0.02), (0.05, 0.035, 0.025), (176, 140, 110), rnd, 0.05)
q.finish("carry__meat")
q = Part()
q.blob((0, 0, 0), (0.07, 0.016, 0.022), (150, 170, 182), rnd, 0.05)
q.blob((-0.07, 0, 0), (0.02, 0.006, 0.02), (120, 140, 150), rnd, 0.0)
q.finish("carry__fish")
q = Part()
q.cyl(4, 0.006, 0.006, (0, 0, -0.18), (0, 0, 0.2), (120, 92, 60), rnd, 0.03)
q.cone(4, 0.012, 0.2, 0.04, (90, 90, 96), rnd)
q.finish("carry__spear")
q = Part()  # a stone axe: a stout haft, the head lashed on near the top, blade facing forward
q.cyl(5, 0.0075, 0.0065, (0, 0, -0.04), (0, 0, 0.175), (120, 92, 60), rnd, 0.03)
q.box((0, -0.02, 0.152), (0.016, 0.05, 0.034), (132, 126, 118), rnd, 0.08, taper=0.7)
q.box((0, 0, 0.152), (0.02, 0.02, 0.04), (92, 70, 48), rnd, 0.05)
q.finish("carry__axe")
q = Part()
q.blob((0, 0, 0), (0.17, 0.045, 0.045), (206, 196, 176), rnd, 0.04)
q.finish("carry__body")
q = Part()
q.blob((0, 0, 0), (0.035, 0.025, 0.03), (214, 200, 170), rnd, 0.03)
q.blob((0, -0.03, 0.008), (0.018, 0.018, 0.018), (0, 1, 0), raw=True)
q.finish("carry__baby")

# ---------------------------------------------------------------- buildings
STONE = (128, 122, 114)
WATTLE = (132, 100, 64)
THATCH = (196, 164, 96)
THATCH_DK = (160, 128, 72)
POLE = (104, 78, 52)
HIDE = (168, 132, 96)

rnd = random.Random(21)
q = Part()  # hearth: stone ring, logs, ash
for k in range(8):
    a = k / 8 * math.tau
    q.blob((math.cos(a) * 0.2, math.sin(a) * 0.2, 0.025), (0.05, 0.045, 0.035), jit(STONE, rnd, 0.1), rnd, 0.06, noise=0.2)
q.cyl(8, 0.17, 0.17, (0, 0, 0.0), (0, 0, 0.012), (60, 52, 46), rnd, 0.05)
for k in range(3):
    a = k / 3 * math.tau + 0.3
    q.cyl(5, 0.022, 0.016, (math.cos(a) * 0.15, math.sin(a) * 0.15, 0.02), (math.cos(a) * 0.02, math.sin(a) * 0.02, 0.09), BARK, rnd, 0.05)
q.finish("bld__hearth")
q = Part()  # flame (white; tinted and animated in the shader)
q.cone(5, 0.075, 0.03, 0.22, (255, 255, 255))
q.cone(4, 0.05, 0.05, 0.27, (255, 255, 255), center=(0.03, 0.02))
q.blob((0, 0, 0.07), (0.07, 0.07, 0.07), (255, 255, 255))
q.finish("bld__flame")

q = Part()  # lean-to: two forked poles, a ridge, a sloping hide-and-branch roof, a bracken bed
q.cyl(4, 0.014, 0.012, (-0.28, -0.12, 0), (-0.28, -0.12, 0.34), POLE, rnd)
q.cyl(4, 0.014, 0.012, (0.28, -0.12, 0), (0.28, -0.12, 0.34), POLE, rnd)
q.cyl(4, 0.012, 0.012, (-0.32, -0.12, 0.33), (0.32, -0.12, 0.33), POLE, rnd)
for k in range(5):
    x = -0.26 + k * 0.13
    q.cyl(4, 0.01, 0.01, (x, -0.12, 0.33), (x, 0.26, 0.0), POLE, rnd)
roof = q.box((0, 0.07, 0.17), (0.6, 0.03, 0.46), HIDE, rnd, 0.05, rot=Matrix.Rotation(-0.86, 3, "X"))
for k in range(4):  # branches laid over the hide against the wind
    x = -0.22 + k * 0.15 + rnd.uniform(-0.03, 0.03)
    q.cyl(4, 0.008, 0.006, (x, -0.1, 0.35), (x + rnd.uniform(-0.05, 0.05), 0.27, 0.02), (88, 70, 46), rnd, 0.08)
q.box((0, 0.02, 0.012), (0.48, 0.3, 0.02), (130, 104, 70), rnd, 0.05)
q.blob((0, 0.06, 0.03), (0.2, 0.11, 0.025), (92, 110, 58), rnd, 0.08, noise=0.25)  # bracken bedding
q.finish("bld__leanto")


# Huts: two shapes (hut0 a round wall under a tiered cone of thatch, hut1 a beehive dome on a low wall),
# each built three ways: woven wattle (bld__hut0), wattle-and-daub (bld__hut0d) and drystone (bld__hut0s).
# The door faces -y. Anything as dark as DOORWAY is lit by firelight at night, so only the doorway is.
DAUB = (178, 142, 102)
DAUB_DK = (146, 112, 78)
STONES = [(132, 126, 117), (118, 114, 108), (146, 138, 124), (108, 102, 96)]
DOORWAY = (40, 30, 22)
ROPE = (120, 96, 60)
THATCH_UNDER = (112, 88, 52)
FRONT = -math.pi / 2


def at(r, a, z):
    return (math.cos(a) * r, math.sin(a) * r, z)


def in_door(a, half):
    return abs(math.atan2(math.sin(a - FRONT), math.cos(a - FRONT))) < half


def ring_loft(q, rings, color_of, rnd, amt=0.06):
    """Faces between rings of points (each a closed loop of the same length); color_of(i, k) per face."""
    bm = q.bm
    vs = [[bm.verts.new(p) for p in ring] for ring in rings]
    n = len(rings[0])
    for i in range(len(vs) - 1):
        for k in range(n):
            f = bm.faces.new((vs[i][k], vs[i][(k + 1) % n], vs[i + 1][(k + 1) % n], vs[i + 1][k]))
            q.paint([f], color_of(i, k), rnd, amt)
    return vs


def wattle_wall(q, R, h, rnd, half):
    """Rods woven in and out between stakes; each course swaps sides, so the weave shows."""
    n = 18
    step = math.tau / n
    stakes = [FRONT + (k + 0.5) * step for k in range(n)]
    courses = 6
    for j in range(courses):
        z0, z1 = 0.004 + j * h / courses, (j + 1) * h / courses - 0.0012
        col = jit(WATTLE, rnd, 0.1)
        for k in range(n - 1):  # the segment between the last stake and the first is the doorway
            a0, a1 = stakes[k], stakes[k + 1]
            am = (a0 + a1) / 2
            rm = R + (0.008 if (k + j) % 2 else -0.004)
            pts = [at(R, a0, z0), at(rm, am, z0), at(R, a1, z0), at(R, a1, z1), at(rm, am, z1), at(R, a0, z1)]
            vs = [q.bm.verts.new(p) for p in pts]
            q.paint([q.bm.faces.new((vs[0], vs[1], vs[4], vs[5])), q.bm.faces.new((vs[1], vs[2], vs[3], vs[4]))], col, rnd, 0.05)
    for a in stakes:
        q.cyl(4, 0.008, 0.007, at(R + 0.003, a, 0), at(R + 0.001, a, h + 0.02), POLE, rnd, 0.06)
    # the far side of the weave, seen through the gaps between rods
    q.cyl(n, R - 0.006, R - 0.006, (0, 0, 0), (0, 0, h), (96, 72, 46), rnd, 0.04, cap=False)


def daub_wall(q, R, h, rnd, half):
    """Mud plastered thick over the wattle: a soft bulging wall on a darker splash-stained foot, cracked in
    a few places to show the rods inside."""
    n = 20
    angles = [FRONT + half + k * (math.tau - 2 * half) / n for k in range(n + 1)]
    profile = [(R + 0.016, 0.0), (R + 0.017, 0.028), (R + 0.015, 0.034), (R + 0.019, 0.09), (R + 0.016, h - 0.03), (R + 0.006, h)]
    bm = q.bm
    rows = [[bm.verts.new(at(r * (1 + rnd.uniform(-0.012, 0.012)), a, z)) for a in angles] for r, z in profile]
    for i in range(len(rows) - 1):
        for k in range(n):
            f = bm.faces.new((rows[i][k], rows[i][k + 1], rows[i + 1][k + 1], rows[i + 1][k]))
            col = DAUB_DK if i < 2 else (WATTLE if (i == 3 and k % 7 == 3) else DAUB)
            q.paint([f], col, rnd, 0.07)
    for k in (0, n):  # wall ends at the door: a face across the thickness
        a = angles[k]
        q.box(at(R + 0.004, a, h / 2), (0.014, 0.034, h), DAUB, rnd, 0.05, rot=Matrix.Rotation(a + math.pi / 2, 3, "Z"))


def stone_wall(q, R, h, rnd, half, courses=5):
    """Drystone: courses of rough blocks, each course's joints set over the middle of the blocks below."""
    for c in range(courses):
        ch = h / courses
        m = 15 - c // 2
        off = (c % 2) * 0.5
        for k in range(m):
            a = FRONT + (k + off) / m * math.tau + math.pi / m
            if in_door(a, half + 0.06):
                continue
            arc = math.tau * R / m
            size = (arc * rnd.uniform(0.86, 0.98), 0.05 * rnd.uniform(0.9, 1.15), ch * rnd.uniform(0.82, 0.96))
            if c == 0:
                size = (size[0] * 1.05, size[1] * 1.2, size[2] * 1.1)
            q.box(at(R + 0.012 + rnd.uniform(-0.004, 0.004), a, c * ch + ch / 2), size, rnd.choice(STONES), rnd, 0.08,
                  rot=Matrix.Rotation(a + math.pi / 2 + rnd.uniform(-0.04, 0.04), 3, "Z"), taper=0.92)
    # a lintel over the doorway, and the door's side stones set upright
    q.box(at(R + 0.012, FRONT, h - 0.012), (2 * math.sin(half) * R + 0.09, 0.06, 0.03), STONES[1], rnd, 0.05)
    for s in (-1, 1):
        a = FRONT + s * (half + 0.035)
        q.box(at(R + 0.012, a, (h - 0.024) / 2), (0.04, 0.055, h - 0.024), STONES[0], rnd, 0.06, rot=Matrix.Rotation(a + math.pi / 2, 3, "Z"))


def doorway(q, R, half, h, walls, rnd):
    """The dark opening (it glows at night), its frame, a hide flap pulled aside and a threshold stone."""
    w = 2 * math.sin(half) * R
    y = math.sin(FRONT) * R
    q.box((0, y + 0.025, h / 2), (w + 0.01, 0.05, h), DOORWAY)
    if walls != "stone":
        for dx in (-1, 1):
            q.cyl(5, 0.013, 0.011, (dx * (w / 2 + 0.006), y - 0.006, 0), (dx * (w / 2 + 0.006), y - 0.006, h + 0.012), POLE, rnd)
        q.cyl(5, 0.012, 0.012, (-w / 2 - 0.025, y - 0.008, h + 0.006), (w / 2 + 0.025, y - 0.008, h + 0.006), POLE, rnd)
    q.box((w * 0.3, y - 0.014, h * 0.55), (w * 0.5, 0.008, h * 0.86), HIDE, rnd, 0.05, rot=Matrix.Rotation(0.3, 3, "Z"))
    q.blob((0, y - 0.03, 0.006), (w * 0.55, 0.035, 0.012), STONES[2], rnd, 0.05, noise=0.15)


def thatch_roof(q, tiers, n, rnd, under=None):
    """A thatched roof in overlapping tiers. tiers: [(r_bottom, z_bottom, r_top, z_top)], eaves out, apex last.
    Each tier hangs a ragged edge over the one below; `under` = (r, z) closes the eave from beneath."""
    rings = []
    tier_of = []
    ph = rnd.uniform(0, math.tau)
    for t, (rb, zb, rt, zt) in enumerate(tiers):
        rings.append([at(rb * (1 + rnd.uniform(-0.03, 0.03)), ph + k / n * math.tau, zb - (0.014 if k % 2 else 0) + rnd.uniform(-0.006, 0.006)) for k in range(n)])
        tier_of.append(t)
        rings.append([at(rt * (1 + rnd.uniform(-0.015, 0.015)), ph + k / n * math.tau, zt) for k in range(n)])
        tier_of.append(t)
    shades = [THATCH_DK, THATCH, (206, 176, 108), THATCH]

    def col(i, k):
        if i % 2 == 1:
            return THATCH_DK  # the step down onto the next tier, in the shade of its overhang
        return jit(shades[tier_of[i] % len(shades)], rnd, 0.05)
    vs = ring_loft(q, rings, col, rnd, 0.07)
    apex = q.bm.verts.new((0, 0, tiers[-1][3] + 0.035))
    q.paint([q.bm.faces.new((vs[-1][k], vs[-1][(k + 1) % n], apex)) for k in range(n)], THATCH, rnd, 0.06)
    if under:
        inner = [q.bm.verts.new(at(under[0], ph + k / n * math.tau, under[1])) for k in range(n)]
        q.paint([q.bm.faces.new((vs[0][(k + 1) % n], vs[0][k], inner[k], inner[(k + 1) % n])) for k in range(n)], THATCH_UNDER, rnd, 0.05)


def hut0(walls, rnd):
    """Round hut: wall to shoulder height, a doorway, three tiers of thatch rising to a smoke hole."""
    q = Part()
    R, h, half = 0.32, 0.2, 0.2
    {"wood": wattle_wall, "daub": daub_wall, "stone": stone_wall}[walls](q, R, h, rnd, half)
    doorway(q, R, half, 0.165 if walls != "stone" else 0.17, walls, rnd)
    thatch_roof(q, [(R + 0.075, 0.232, R - 0.005, 0.32), (R + 0.01, 0.308, R - 0.105, 0.41), (R - 0.09, 0.398, 0.06, 0.5)], 20, rnd,
                under=(R - 0.01, 0.222))
    q.cyl(10, 0.07, 0.062, (0, 0, 0.48), (0, 0, 0.494), ROPE, rnd, 0.03, cap=False)  # binding at the crown
    for k in range(3):  # sticks lashed at the smoke hole
        a = k / 3 * math.tau + 0.4
        q.cyl(4, 0.006, 0.005, (0, 0, 0.49), (math.cos(a) * 0.05, math.sin(a) * 0.05, 0.61), POLE, rnd)
    # firewood leant against the wall by the door, out of the rain under the eave
    for k in range(3):
        a = FRONT + 0.75 + k * 0.1
        base = Vector(at(R + 0.075, a, 0.0))
        top = Vector(at(R + 0.03, a + 0.03, 0.15 + k * 0.012))
        q.cyl(5, 0.013, 0.011, tuple(base), tuple(top), BARK, rnd, 0.06)
    if walls == "stone":  # spare stones from the building, heaped at the side
        for k in range(4):
            a = FRONT - 0.95 - k * 0.07
            q.blob(at(R + 0.07 + rnd.uniform(-0.01, 0.02), a, 0.016), (0.026, 0.022, 0.018), rnd.choice(STONES), rnd, 0.06, noise=0.2)
    return q


def hut1(walls, rnd):
    """Beehive hut: a low wall under a dome of thatch in courses, held down by ropes weighted with stones."""
    q = Part()
    R, half = 0.34, 0.19
    h = {"wood": 0.12, "daub": 0.13, "stone": 0.14}[walls]
    {"wood": wattle_wall, "daub": daub_wall, "stone": stone_wall}[walls](q, R, h, rnd, half)
    if walls != "stone":  # the old footing of stones the wall stands on
        for k in range(16):
            a = FRONT + (k + 0.5) / 16 * math.tau
            if not in_door(a, half + 0.08):
                q.blob(at(R + 0.03, a, 0.018), (0.04, 0.034, 0.024), rnd.choice(STONES), rnd, 0.05, noise=0.2)
    door_h = h + 0.03
    doorway(q, R, half, door_h, walls, rnd)
    # dome courses: (r at the bottom of the course, z) up to the crown
    z0, H, Rd = h + 0.012, 0.33, R + 0.03
    tiers = []
    for t, (th0, th1) in enumerate([(0.0, 0.42), (0.36, 0.8), (0.74, 1.2)]):
        tiers.append((Rd * math.cos(th0) + 0.012, z0 + H * math.sin(th0), Rd * math.cos(th1), z0 + H * math.sin(th1)))
    thatch_roof(q, tiers, 18, rnd, under=(R - 0.02, h + 0.004))
    # two ropes round the dome, and ropes over it weighted with stones that hang at the eave
    for th in (0.5, 0.95):
        rr, zr = Rd * math.cos(th) + 0.008, z0 + H * math.sin(th)
        q.cyl(16, rr, rr, (0, 0, zr - 0.006), (0, 0, zr + 0.006), ROPE, rnd, 0.03, cap=False)
    for k in range(6):
        a = FRONT + (k + 0.5) / 6 * math.tau
        top = at(Rd * math.cos(0.5) + 0.01, a, z0 + H * math.sin(0.5))
        bot = at(Rd + 0.018, a, z0 - 0.02)
        q.cyl(3, 0.003, 0.003, top, bot, ROPE, rnd, 0.03)
        q.blob(at(Rd + 0.02, a, z0 - 0.04), (0.022, 0.02, 0.024), rnd.choice(STONES), rnd, 0.05, noise=0.2)
    # a hood of thatch over the low door
    y = math.sin(FRONT) * R
    q.box((0, y - 0.03, door_h + 0.02), (0.18, 0.08, 0.022), THATCH_DK, rnd, 0.05, rot=Matrix.Rotation(0.35, 3, "X"))
    return q


for walls, suffix in (("wood", ""), ("daub", "d"), ("stone", "s")):
    hut0(walls, random.Random(30)).finish(f"bld__hut0{suffix}")
    hut1(walls, random.Random(31)).finish(f"bld__hut1{suffix}")

rnd = random.Random(40)
q = Part()  # storehouse raised on posts against damp and vermin
for x in (-0.18, 0.18):
    for y in (-0.16, 0.16):
        q.cyl(4, 0.02, 0.018, (x, y, 0), (x, y, 0.13), POLE, rnd)
        q.cyl(6, 0.034, 0.03, (x, y, 0.125), (x, y, 0.135), (90, 90, 90), rnd, 0.05)  # flat stone caps keep the mice off
q.box((0, 0, 0.14), (0.46, 0.4, 0.025), POLE, rnd, 0.05)
q.box((0, 0, 0.24), (0.4, 0.34, 0.18), WATTLE, rnd, 0.06)
for sx in (-1, 1):  # gable ends
    bm = q.bm
    vs = [bm.verts.new((sx * 0.2, -0.17, 0.33)), bm.verts.new((sx * 0.2, 0.17, 0.33)), bm.verts.new((sx * 0.2, 0, 0.47))]
    q.paint([bm.faces.new(vs if sx > 0 else list(reversed(vs)))], WATTLE, rnd, 0.06)
q.box((0, -0.11, 0.39), (0.52, 0.27, 0.035), THATCH, rnd, 0.06, rot=Matrix.Rotation(0.75, 3, "X"))
q.box((0, 0.11, 0.39), (0.52, 0.27, 0.035), THATCH, rnd, 0.06, rot=Matrix.Rotation(-0.75, 3, "X"))
q.cyl(5, 0.018, 0.018, (-0.27, 0, 0.485), (0.27, 0, 0.485), THATCH_DK, rnd, 0.04)  # ridge
q.box((0, -0.22, 0.16), (0.08, 0.12, 0.02), POLE, rnd, rot=Matrix.Rotation(0.6, 3, "X"))
q.box((0, -0.171, 0.25), (0.1, 0.01, 0.12), (52, 40, 28))  # hatch
q.finish("bld__storehouse")

rnd = random.Random(41)
q = Part()  # drying rack: two A-frames, a pole, strips of fish and meat
for x in (-0.25, 0.25):
    q.cyl(4, 0.012, 0.01, (x, -0.1, 0), (x, 0, 0.34), POLE, rnd)
    q.cyl(4, 0.012, 0.01, (x, 0.1, 0), (x, 0, 0.34), POLE, rnd)
q.cyl(4, 0.01, 0.01, (-0.3, 0, 0.33), (0.3, 0, 0.33), POLE, rnd)
for k in range(6):
    x = -0.2 + k * 0.08
    col = (164, 76, 60) if k % 2 else (176, 170, 150)
    q.box((x, 0, 0.26), (0.03, 0.012, 0.12), col, rnd, 0.1)
q.cyl(6, 0.08, 0.06, (0, 0.25, 0), (0, 0.25, 0.02), (70, 60, 52), rnd)
q.finish("bld__rack")

rnd = random.Random(43)
q = Part()  # stockpile: a bark mat for food in front; at the back, stakes and sleepers that hold a woodstack
q.box((0, -0.13, 0.006), (0.52, 0.28, 0.012), (138, 108, 72), rnd, 0.08)
q.box((0, -0.13, 0.004), (0.56, 0.32, 0.008), (96, 74, 50), rnd, 0.05)
for sx in (-0.12, 0.12):
    q.cyl(5, 0.012, 0.012, (sx, 0.12, 0.012), (sx, 0.32, 0.012), BARK, rnd, 0.04)
for sx in (-0.215, 0.215):
    for sy in (0.14, 0.30):
        q.cyl(4, 0.009, 0.007, (sx, sy, 0), (sx, sy, 0.2), POLE, rnd, 0.05)
q.finish("bld__stockpile")

q = Part()  # one split log of firewood, for stacking on the stockpile
q.cyl(6, 0.021, 0.02, (-0.19, 0, 0), (0.19, 0, 0), BARK, rnd, 0.05)
for ex in (-0.191, 0.191):
    q.cyl(6, 0.017, 0.017, (ex - 0.001, 0, 0), (ex + 0.001, 0, 0), (196, 160, 112), rnd, 0.02)
q.finish("pile__log")

rnd = random.Random(42)
q = Part()  # construction site: stacked logs and a marking pole
for k in range(4):
    z = 0.025 + (k // 2) * 0.04
    y = -0.04 + (k % 2) * 0.08 - (k // 2) * 0.0
    q.cyl(5, 0.022, 0.02, (-0.2, y, z), (0.2, y, z), BARK, rnd, 0.06)
q.cyl(4, 0.01, 0.008, (0.26, 0.2, 0), (0.26, 0.2, 0.3), POLE, rnd)
q.finish("bld__site")

# ---------------------------------------------------------------- walk and run cycles
# Authored the way an animator would: key poses on a timeline (contact, down, passing, up), smooth
# Bezier curves through them, cycled. Then sampled into a table the game's shader plays back,
# with the cycle driven by distance walked so feet don't slide.
# Angles in radians about the joint's sideways axis, game convention: negative swings a thigh or
# upper arm forward; positive bends a knee; negative bends an elbow (forearm forward and up).
# lean: upper body tips forward; bob: hips up/down (tile units); roll: sway toward the standing leg.
CYCLE = 48  # frames per cycle on the Blender timeline
SAMPLES = 32
CHANNELS = ["thighL", "thighR", "kneeL", "kneeR", "shoulderL", "shoulderR", "elbowL", "elbowR", "lean", "bob", "roll", "head", "lower"]
# a channel a clip doesn't key holds the standing pose
STILL = {"thighL": 0.0, "thighR": 0.0, "kneeL": 0.03, "kneeR": 0.03, "shoulderL": 0.0, "shoulderR": 0.0,
         "elbowL": -0.12, "elbowR": -0.12, "lean": 0.0, "bob": 0.0, "roll": 0.0, "head": 0.0, "lower": 0.0}

GAITS = {
    "walk": {
        # left leg: contact at 0, down, passing, up, push-off at 0.5, then the swing forward
        "thighL": [(0, -0.40), (0.12, -0.30), (0.25, -0.02), (0.38, 0.24), (0.5, 0.36), (0.62, 0.16), (0.75, -0.20), (0.88, -0.46)],
        "kneeL": [(0, 0.06), (0.12, 0.26), (0.25, 0.10), (0.38, 0.06), (0.5, 0.20), (0.62, 0.72), (0.75, 0.95), (0.88, 0.32)],
        "shoulderL": [(0, 0.26), (0.25, 0.0), (0.5, -0.30), (0.75, 0.0)],
        "elbowL": [(0, -0.18), (0.25, -0.30), (0.5, -0.52), (0.75, -0.30)],
        "lean": [(0, 0.05), (0.25, 0.07), (0.5, 0.05), (0.75, 0.07)],
        "bob": [(0, 0.0), (0.12, -0.007), (0.31, 0.008), (0.5, 0.0), (0.62, -0.007), (0.81, 0.008)],
        "roll": [(0, 0.0), (0.25, 0.035), (0.5, 0.0), (0.75, -0.035)],
        "head": [(0, -0.03), (0.25, -0.05), (0.5, -0.03), (0.75, -0.05)],
    },
    "run": {
        # shorter stance, a flight phase, high knees, arms pumping with bent elbows
        "thighL": [(0, -0.50), (0.10, -0.24), (0.25, 0.32), (0.40, 0.62), (0.55, 0.30), (0.70, -0.42), (0.85, -0.78)],
        "kneeL": [(0, 0.28), (0.10, 0.58), (0.25, 0.30), (0.40, 0.62), (0.55, 1.55), (0.70, 1.80), (0.85, 0.85)],
        "shoulderL": [(0, 0.62), (0.25, 0.0), (0.5, -0.72), (0.75, 0.0)],
        "elbowL": [(0, -1.25), (0.25, -1.45), (0.5, -1.70), (0.75, -1.45)],
        "lean": [(0, 0.20), (0.25, 0.23), (0.5, 0.20), (0.75, 0.23)],
        "bob": [(0, -0.004), (0.10, -0.015), (0.32, 0.014), (0.5, -0.004), (0.60, -0.015), (0.82, 0.014)],
        "roll": [(0, 0.0), (0.25, 0.02), (0.5, 0.0), (0.75, -0.02)],
        "head": [(0, -0.12), (0.5, -0.12)],
    },
    # children at play: a skipping run, a hop on each step, arms flung high
    "skip": {
        "thighL": [(0, -0.75), (0.15, -0.55), (0.3, 0.05), (0.5, 0.40), (0.7, 0.10), (0.85, -0.45)],
        "kneeL": [(0, 0.55), (0.15, 0.95), (0.3, 0.35), (0.5, 0.25), (0.7, 1.25), (0.85, 1.05)],
        "shoulderL": [(0, 0.55), (0.25, -0.35), (0.5, -1.55), (0.75, -0.35)],
        "elbowL": [(0, -0.45), (0.5, -0.95)],
        "lean": [(0, 0.10), (0.25, 0.16), (0.5, 0.10), (0.75, 0.16)],
        "bob": [(0, 0.0), (0.1, 0.022), (0.22, 0.004), (0.36, -0.006), (0.5, 0.0), (0.6, 0.022), (0.72, 0.004), (0.86, -0.006)],
        "roll": [(0, 0.0), (0.25, 0.05), (0.5, 0.0), (0.75, -0.05)],
        "head": [(0, -0.12), (0.25, -0.06), (0.5, -0.12), (0.75, -0.06)],
    },
    # swimming: a dog paddle, body flat in the water, head up, legs trailing and kicking
    # (the arms are keyed for an upright body; the lean tips everything above the hips forward)
    "swim": {
        "thighL": [(0, 1.10), (0.25, 1.32), (0.5, 1.52), (0.75, 1.32)],
        "kneeL": [(0, 0.15), (0.25, 0.45), (0.5, 0.25), (0.75, 0.08)],
        "shoulderL": [(0, -2.95), (0.3, -2.05), (0.55, -1.85), (0.8, -2.55)],
        "elbowL": [(0, -0.25), (0.3, -0.45), (0.55, -1.35), (0.8, -0.75)],
        "lean": [(0, 1.36), (0.25, 1.40), (0.5, 1.36), (0.75, 1.40)],
        "bob": [(0, 0.0), (0.25, 0.004), (0.5, 0.0), (0.75, 0.004)],
        "roll": [(0, 0.0), (0.25, 0.06), (0.5, 0.0), (0.75, -0.06)],
        "head": [(0, -1.10), (0.25, -1.16), (0.5, -1.10), (0.75, -1.16)],
    },
    # treading water: upright, legs cycling under the surface, hands sculling, head held up
    "tread": {
        "thighL": [(0, -0.75), (0.25, -0.40), (0.5, -0.10), (0.75, -0.45)],
        "kneeL": [(0, 1.10), (0.25, 0.70), (0.5, 0.40), (0.75, 0.95)],
        "shoulderL": [(0, -0.75), (0.25, -0.55), (0.5, -0.40), (0.75, -0.55)],
        "elbowL": [(0, -0.55), (0.25, -0.80), (0.5, -1.00), (0.75, -0.80)],
        "lean": [(0, 0.08)],
        "bob": [(0, 0.0), (0.25, 0.006), (0.5, 0.0), (0.75, 0.006)],
        "roll": [(0, 0.0), (0.25, 0.02), (0.5, 0.0), (0.75, -0.02)],
        "head": [(0, -0.12)],
    },
}
MIRRORED = ("walk", "run", "skip", "swim", "tread")

# poses that loop for as long as a task lasts, keyed on both sides (not mirrored)
LOOPS = {
    # tending the fire: squatting by it, the right hand reaching in to set a stick, the left on a knee
    "tend": {
        "thighL": [(0, -1.30)], "thighR": [(0, -1.40)], "kneeL": [(0, 2.05)], "kneeR": [(0, 2.15)], "lower": [(0, 0.085)],
        "lean": [(0, 0.32), (0.4, 0.58), (0.6, 0.56), (0.85, 0.32)],
        "shoulderR": [(0, -0.55), (0.35, -1.35), (0.55, -1.40), (0.8, -0.55)],
        "elbowR": [(0, -1.25), (0.35, -0.30), (0.55, -0.35), (0.8, -1.25)],
        "shoulderL": [(0, -0.85)], "elbowL": [(0, -0.75)],
        "head": [(0, 0.22), (0.45, 0.42), (0.85, 0.22)], "roll": [(0, 0.0), (0.45, -0.03), (0.85, 0.0)],
    },
    # at the drying rack: reaching up to hang strips of meat and fish, one hand then the other
    "rack": {
        "kneeL": [(0, 0.05)], "kneeR": [(0, 0.05)],
        "shoulderR": [(0, -1.05), (0.22, -2.65), (0.42, -2.55), (0.6, -1.05)],
        "elbowR": [(0, -1.35), (0.22, -0.35), (0.42, -0.45), (0.6, -1.35)],
        "shoulderL": [(0, -2.55), (0.1, -1.05), (0.5, -1.05), (0.72, -2.65), (0.92, -2.55)],
        "elbowL": [(0, -0.45), (0.1, -1.35), (0.5, -1.35), (0.72, -0.35), (0.92, -0.45)],
        "lean": [(0, -0.08), (0.25, -0.14), (0.5, -0.06), (0.75, -0.14)],
        "head": [(0, -0.25), (0.25, -0.38), (0.5, -0.22), (0.75, -0.38)],
        "bob": [(0, 0.0), (0.25, 0.007), (0.5, 0.0), (0.75, 0.007)],
    },
    # warming up: sitting close, hands held out to the fire, rubbing them now and then
    "warm": {
        "thighL": [(0, -2.05)], "thighR": [(0, -2.05)], "kneeL": [(0, 1.55)], "kneeR": [(0, 1.55)], "lower": [(0, 0.125)],
        "lean": [(0, 0.20), (0.5, 0.24)],
        "shoulderL": [(0, -1.30), (0.25, -1.15), (0.5, -1.30), (0.75, -1.15)],
        "shoulderR": [(0, -1.15), (0.25, -1.30), (0.5, -1.15), (0.75, -1.30)],
        "elbowL": [(0, -0.40), (0.5, -0.55)], "elbowR": [(0, -0.55), (0.5, -0.40)],
        "head": [(0, 0.08), (0.5, 0.02)], "roll": [(0, 0.012), (0.5, -0.012)],
    },
}

# moves that play once, over whatever the body was doing (0 = start, 1 = end)
ONCE = {
    # bending to pick something up: knees and back bend, hands reach the ground, then rise holding it
    "lift": {
        "thighL": [(0, 0.0), (0.4, -1.10), (0.55, -1.10), (1, 0.0)], "thighR": [(0, 0.0), (0.4, -1.15), (0.55, -1.15), (1, 0.0)],
        "kneeL": [(0, 0.03), (0.4, 1.60), (0.55, 1.60), (1, 0.03)], "kneeR": [(0, 0.03), (0.4, 1.65), (0.55, 1.65), (1, 0.03)],
        "lower": [(0, 0.0), (0.4, 0.062), (0.55, 0.062), (1, 0.0)],
        "lean": [(0, 0.0), (0.4, 0.78), (0.55, 0.72), (1, 0.05)],
        "shoulderL": [(0, 0.0), (0.4, -0.95), (0.55, -1.0), (0.85, -1.35), (1, -1.4)],
        "shoulderR": [(0, 0.0), (0.4, -0.95), (0.55, -1.0), (0.85, -1.4), (1, -1.5)],
        "elbowL": [(0, -0.12), (0.4, -0.2), (0.6, -0.6), (1, -1.4)], "elbowR": [(0, -0.12), (0.4, -0.2), (0.6, -0.7), (1, -1.8)],
        "head": [(0, 0.0), (0.4, 0.38), (1, 0.0)],
    },
    # setting something down: the reverse, ending with empty hands
    "putdown": {
        "thighL": [(0, 0.0), (0.45, -1.10), (0.6, -1.10), (1, 0.0)], "thighR": [(0, 0.0), (0.45, -1.15), (0.6, -1.15), (1, 0.0)],
        "kneeL": [(0, 0.03), (0.45, 1.60), (0.6, 1.60), (1, 0.03)], "kneeR": [(0, 0.03), (0.45, 1.65), (0.6, 1.65), (1, 0.03)],
        "lower": [(0, 0.0), (0.45, 0.062), (0.6, 0.062), (1, 0.0)],
        "lean": [(0, 0.05), (0.45, 0.78), (0.6, 0.72), (1, 0.0)],
        "shoulderL": [(0, -1.3), (0.45, -0.95), (0.65, -0.6), (1, 0.0)], "shoulderR": [(0, -1.4), (0.45, -0.95), (0.65, -0.6), (1, 0.0)],
        "elbowL": [(0, -1.3), (0.45, -0.3), (0.65, -0.3), (1, -0.12)], "elbowR": [(0, -1.6), (0.45, -0.3), (0.65, -0.3), (1, -0.12)],
        "head": [(0, 0.0), (0.45, 0.38), (1, 0.0)],
    },
    # the killing thrust: draw the spear back, lunge onto the front foot, drive it home, recover
    "thrust": {
        "thighL": [(0, -0.10), (0.3, 0.10), (0.45, -0.85), (0.7, -0.80), (1, -0.10)],
        "kneeL": [(0, 0.10), (0.3, 0.20), (0.45, 0.65), (0.7, 0.60), (1, 0.10)],
        "thighR": [(0, 0.10), (0.3, 0.0), (0.45, 0.45), (0.7, 0.45), (1, 0.10)],
        "kneeR": [(0, 0.10), (0.45, 0.22), (1, 0.10)],
        "lower": [(0, 0.0), (0.45, 0.03), (0.7, 0.03), (1, 0.0)],
        "lean": [(0, 0.05), (0.3, -0.18), (0.45, 0.42), (0.7, 0.36), (1, 0.05)],
        "shoulderR": [(0, -2.30), (0.3, -2.75), (0.45, -1.30), (0.7, -1.35), (1, -1.90)],
        "elbowR": [(0, -0.40), (0.3, -0.95), (0.45, -0.05), (0.7, -0.10), (1, -0.40)],
        "shoulderL": [(0, -0.60), (0.3, -0.95), (0.45, -0.20), (1, -0.50)],
        "elbowL": [(0, -0.60), (0.45, -0.30), (1, -0.60)],
        "head": [(0, 0.0), (0.45, 0.15), (1, 0.0)],
        "roll": [(0, 0.0), (0.3, 0.05), (0.45, -0.05), (1, 0.0)],
    },
    # a fishing stab: spear lifted, a sharp strike down into the water, a look, back to poised
    "stab": {
        "thighL": [(0, -0.20)], "thighR": [(0, 0.15)], "kneeL": [(0, 0.20), (0.4, 0.40), (1, 0.20)], "kneeR": [(0, 0.20), (0.4, 0.35), (1, 0.20)],
        "lower": [(0, 0.0), (0.4, 0.02), (1, 0.0)],
        "lean": [(0, 0.28), (0.25, 0.18), (0.4, 0.62), (0.65, 0.58), (1, 0.28)],
        "shoulderR": [(0, -2.20), (0.25, -2.70), (0.4, -1.05), (0.65, -1.10), (1, -2.20)],
        "elbowR": [(0, -0.35), (0.25, -0.60), (0.4, -0.05), (0.65, -0.10), (1, -0.35)],
        "shoulderL": [(0, -0.90), (0.4, -0.55), (1, -0.90)], "elbowL": [(0, -0.95), (0.4, -0.40), (1, -0.95)],
        "head": [(0, 0.32), (0.4, 0.55), (0.65, 0.5), (1, 0.32)],
    },
}
ORDER = list(GAITS) + list(LOOPS) + list(ONCE)


def mirror(keys):
    """the right side is the left half a cycle later"""
    return [((t + 0.5) % 1.0, v) for t, v in keys]


import json

driver = bpy.data.objects.new("gait_driver", None)
bpy.context.scene.collection.objects.link(driver)
tables = {}
for gname in ORDER:
    looped = gname not in ONCE
    g = GAITS.get(gname) or LOOPS.get(gname) or ONCE[gname]
    keys = dict(g)
    if gname in MIRRORED:
        keys["thighR"] = mirror(g["thighL"])
        keys["kneeR"] = mirror(g["kneeL"])
        keys["shoulderR"] = mirror(g["shoulderL"])
        keys["elbowR"] = mirror(g["elbowL"])
    rows = []
    for ch in CHANNELS:
        prop = f"{gname}_{ch}"
        pts = sorted(keys.get(ch, [(0, STILL[ch])]))
        # a loop gets three laps of keys so the curve is smooth across the loop point (sampled in
        # the middle lap); a one-off is keyed once and sampled end to end
        for lap in ((-1, 0, 1) if looped else (0,)):
            for t, v in pts:
                driver[prop] = v
                driver.keyframe_insert(data_path=f'["{prop}"]', frame=(t + lap) * CYCLE)
        act = driver.animation_data.action
        if hasattr(act, "fcurves"):  # Blender 3.x-4.3
            curves = act.fcurves
        else:  # Blender 4.4+: layered actions keep curves in a channel bag per slot
            curves = act.layers[0].strips[0].channelbag(driver.animation_data.action_slot).fcurves
        fc = next(f for f in curves if f.data_path == f'["{prop}"]')
        for kp in fc.keyframe_points:
            kp.interpolation = "BEZIER"
            kp.handle_left_type = kp.handle_right_type = "AUTO_CLAMPED"
        fc.update()
        span = SAMPLES if looped else SAMPLES - 1
        rows.append([round(fc.evaluate(k / span * CYCLE), 5) for k in range(SAMPLES)])
    tables[gname] = rows
bpy.data.objects.remove(driver)

gait_path = os.path.join(os.path.dirname(OUT), "gait.json")
with open(gait_path, "w") as f:
    json.dump({
        "about": "Body animation authored in blender/build_band.py: per clip, rows are channels and columns samples across one cycle (loops) or from start to end (once).",
        "clips": ORDER, "once": list(ONCE),
        "channels": CHANNELS, "samples": SAMPLES, "joints": J,
        # distance covered by one full cycle (two steps), in tile units, for an adult of scale 1
        "strideWalk": 0.30, "strideRun": 0.52,
        **tables,
    }, f, indent=1)
print("GAIT ->", gait_path)

bpy.ops.export_scene.gltf(filepath=OUT, export_format="GLB", export_materials="NONE",
                          export_vertex_color="ACTIVE", export_normals=True, export_texcoords=False, export_yup=True)
print("BAND", len(bpy.data.objects), "objects ->", OUT)
