"""People, animals, carried items and buildings for M1, exported as one GLB.

Run headless:  python3 blender/build_band.py [out.glb]
Conventions (read by src/render/band.ts):
  villager__{torso,head,arm*,fore*,thigh*,shin*,hairS,hairL,hairB,hairU,beard}  one body in parts, animated in the shader;
      the game shows one of the four hair pieces (short, long, braids, bun) and, on some men, the beard.
      Vertex colours are REGION CODES, not final colours: red = clothing, green = skin,
      blue = hair, black = leather/shoes. The game tints each person individually.
  deer__{body,head,antlers,spots,legFL,legFR,legBL,legBR}  animated in parts, real colours (antlers on stags, spots on fawns).
  carry__{log,berries,meat,fish,spear,axe,chopper,body,baby,stick,snare,fiber,mud,stone} attached to a person's hands or shoulder.
  trap__{snare,snareFull,fishtrap,fishtrapFull}                  traps set in the world (origin at the foot / the basket's middle).
  bld__{hearth,flame,leanto,hut0,hut1,storehouse,rack,site,windbreak,woodshed}  one tile footprint, centred on the origin
      (the windbreak reaches out in an arc behind the fire);
      huts and the storehouse also come as ...d (wattle-and-daub) and ...s (drystone), e.g. bld__hut0d, bld__storehouses.
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

ROPE_TIE = (120, 96, 60)
HIDE_CARRY = (138, 104, 72)
FLINT = (122, 116, 108)
FLINT_SCAR = (156, 150, 140)  # fresh flake scars, paler than the weathered rind
CORTEX = (176, 160, 128)
GRASS = (170, 160, 92)
GRASS_DK = (132, 128, 70)
CLAY = (128, 96, 70)
CLAY_WET = (104, 76, 56)

q = Part()  # a hand chopper: a cobble with flakes struck off one end to a wavy edge (+z), the rind left to grip
rr = random.Random(46)
for v in q.blob((0, 0, 0), (0.024, 0.019, 0.023), CORTEX, rr, 0.06, noise=0.1, subdiv=2):
    if v.co.z > -0.002:  # the worked end, thinned from both faces to an edge across x
        v.co.y *= max(0.18, 1 - (v.co.z + 0.002) / 0.022)
for f in q.bm.faces:
    c = f.calc_center_median()
    if c.z > 0.001:
        q.paint([f], FLINT_SCAR if rr.random() < 0.4 else FLINT, rr, 0.06)
q.finish("carry__chopper")

q = Part()  # an armful of cut grass, tied round the middle, the cut ends down and the heads splayed up
rr = random.Random(47)
for k in range(16):
    a, r = rr.uniform(0, math.tau), rr.uniform(0, 0.014)
    base = Vector((math.cos(a) * r, math.sin(a) * r * 0.7, -0.07 + rr.uniform(0, 0.012)))
    top = Vector((math.cos(a) * (r * 2.6 + 0.008), math.sin(a) * (r * 2.2 + 0.006), 0.075 + rr.uniform(0, 0.03)))
    mid = Vector((base.x * 0.6, base.y * 0.6, 0.0))
    col = GRASS if k % 3 else GRASS_DK
    q.cyl(3, 0.0032, 0.0028, base, mid, col, rr, 0.08, cap=False)
    q.cyl(3, 0.0028, 0.0012, mid, top, col, rr, 0.08, cap=False)
q.cyl(8, 0.0125, 0.0125, (0, 0, -0.006), (0, 0, 0.006), ROPE_TIE, rr, 0.03, cap=False)  # the tie
q.finish("carry__fiber")

q = Part()  # wet clay dug from the bank, carried in a hide gathered up and twisted at the top
rr = random.Random(48)
for v in q.blob((0, 0, -0.035), (0.042, 0.036, 0.034), HIDE_CARRY, rr, 0.05, noise=0.12):
    if v.co.z > -0.012:
        k = (v.co.z + 0.012) / 0.03
        v.co.x *= 1 - 0.8 * min(1.0, k)
        v.co.y *= 1 - 0.8 * min(1.0, k)
q.cyl(5, 0.008, 0.005, (0, 0, -0.008), (0.002, 0, 0.012), HIDE_CARRY, rr, 0.05)  # the twist
q.blob((0.008, -0.026, -0.024), (0.03, 0.022, 0.02), CLAY_WET, rr, 0.08, noise=0.25)  # clay bulging out of the
q.blob((-0.016, -0.012, -0.03), (0.018, 0.018, 0.014), CLAY, rr, 0.08, noise=0.25)   # open side
q.finish("carry__mud")

q = Part()  # a building stone, flattish and blocky, carried on the right shoulder
rr = random.Random(49)
for v in q.blob((0, 0, 0), (0.042, 0.03, 0.022), (132, 126, 117), rr, 0.1, noise=0.12):
    v.co.x = max(-0.034, min(0.034, v.co.x))  # squared off at the ends, as a stone for a wall is chosen
    v.co.z = max(-0.016, v.co.z)
q.finish("carry__stone")

# ---------------------------------------------------------------- tools and traps
WOOD = (138, 104, 66)
WOOD_DARK = (96, 70, 44)
CHAR = (46, 38, 32)       # a point hardened in the fire
CORD = (176, 150, 104)
WICKER = (168, 136, 84)
WICKER_DARK = (118, 92, 56)
HARE = (138, 112, 82)
HARE_PALE = (210, 196, 172)

q = Part()  # a digging stick, held about a third of the way up: a stout shaft, a knot, the point charred hard
q.cyl(6, 0.0068, 0.0060, (0, 0, -0.120), (0.002, 0, 0.010), WOOD, rnd, 0.04, cap=False)
q.cyl(6, 0.0060, 0.0052, (0.002, 0, 0.010), (0.001, 0, 0.135), WOOD, rnd, 0.04)
q.box((0.004, -0.002, 0.052), (0.007, 0.006, 0.010), WOOD_DARK, rnd, 0.0)  # a knot where a twig was trimmed
q.cyl(6, 0.0069, 0.0060, (0, 0, -0.142), (0, 0, -0.120), CHAR, rnd, 0.03, cap=False)
cone = q.cone(6, 0.0069, -0.142, 1.0, CHAR, rnd, 0.03)
for v in {v for f in cone for v in f.verts if v.co.z > -0.1}:
    v.co = Vector((0.0015, -0.002, -0.168))  # the point, a little off the axis
q.finish("carry__stick")


def noose(q, c, r, segs=7):
    """A loop of cord standing upright across a run, facing along y."""
    pts = [Vector(c) + Vector((math.cos(k / segs * math.tau) * r, 0, math.sin(k / segs * math.tau) * r * 1.15)) for k in range(segs)]
    for a, b in zip(pts, pts[1:] + pts[:1]):
        q.cyl(3, 0.0016, 0.0016, a, b, CORD, rnd, 0.0, cap=False)


def hare(q, at, hang=False):
    """A hare, ~0.08 long; lying on its side, or hanging by the neck from a noose (head up)."""
    m = Matrix.Rotation(-math.pi / 2, 3, "X") if hang else Matrix.Rotation(math.pi / 2, 3, "Y")
    o = Vector(at)
    for c, r, col in (((0, 0.006, 0), (0.019, 0.032, 0.020), HARE), ((0, -0.034, 0.006), (0.012, 0.016, 0.012), HARE),
                      ((0, 0.036, 0.004), (0.008, 0.007, 0.008), HARE_PALE)):
        for v in q.blob((0, 0, 0), r, col, rnd, 0.05):
            v.co = o + m @ (v.co + Vector(c))
    for ex in (-1, 1):  # long ears, laid back
        q.box(o + m @ Vector((ex * 0.005, -0.040, 0.020)), (0.005, 0.006, 0.026), HARE, rnd, 0.03,
              rot=m @ Matrix.Rotation(-0.9, 3, "X") @ Matrix.Rotation(ex * 0.25, 3, "Y"))


def snare(q, sprung):
    """A hare snare in a run at the foot of a bush: a sapling bent over as a spring, held down by a notched
    trigger peg, a cord from its tip to a noose propped open by two twigs. Sprung, the pole stands up again
    and the catch hangs off the ground. Origin at the foot, the run along y."""
    base = Vector((-0.07, 0.02, 0))
    if not sprung:
        pole = [((base + Vector((0.000, 0, 0.000))), 0.0060, 0.0060), ((base + Vector((0.006, 0, 0.060))), 0.0052, 0.0052),
                ((base + Vector((0.030, 0, 0.110))), 0.0044, 0.0044), ((base + Vector((0.070, 0, 0.128))), 0.0036, 0.0036),
                ((base + Vector((0.098, 0, 0.112))), 0.0030, 0.0030)]
    else:
        pole = [((base + Vector((0.000, 0, 0.000))), 0.0060, 0.0060), ((base + Vector((0.002, 0, 0.070))), 0.0052, 0.0052),
                ((base + Vector((0.012, 0, 0.140))), 0.0044, 0.0044), ((base + Vector((0.030, 0, 0.198))), 0.0036, 0.0036),
                ((base + Vector((0.046, 0, 0.226))), 0.0030, 0.0030)]
    sweep(q, [(tuple(p), a, b) for p, a, b in pole], 5, lambda c: WOOD, caps=(False, True))
    tip = pole[-1][0]
    peg = Vector((0.030, 0.02, 0))
    q.cyl(4, 0.0040, 0.0030, peg - Vector((0, 0, 0.004)), peg + Vector((0, 0, 0.034)), WOOD_DARK, rnd, 0.03)  # trigger peg
    for ex in (-1, 1):  # the twigs that hold the noose open across the run
        q.cyl(3, 0.0022, 0.0016, (0.030 + ex * 0.034, -0.010, 0), (0.030 + ex * 0.026, -0.010, 0.072), WOOD_DARK, rnd, 0.03)
    if not sprung:
        q.cyl(3, 0.0016, 0.0016, tip, peg + Vector((0, 0, 0.030)), CORD, rnd, 0.0, cap=False)
        q.cyl(3, 0.0016, 0.0016, peg + Vector((0, 0, 0.026)), (0.030, -0.010, 0.068), CORD, rnd, 0.0, cap=False)
        noose(q, (0.030, -0.010, 0.040), 0.024)
    else:
        neck = tip + Vector((0, 0, -0.070))
        q.cyl(3, 0.0016, 0.0016, tip, neck, CORD, rnd, 0.0, cap=False)
        hare(q, neck + Vector((0, 0, -0.040)), hang=True)


q = Part()
snare(q, False)
q.finish("trap__snare")
q = Part()
snare(q, True)
q.finish("trap__snareFull")
q = Part()  # a snare to carry: a coil of cord round a short stake
q.cyl(4, 0.004, 0.003, (0, 0, -0.07), (0, 0, 0.0), WOOD_DARK, rnd, 0.03)
for k in range(3):
    noose(q, (0, 0, -0.035 + k * 0.004), 0.016 - k * 0.002, segs=6)
q.finish("carry__snare")


def fishtrap(q, full):
    """A woven fish trap: a long basket, wide at the mouth with a funnel turned in, tapering to a tied tail,
    bound with darker hoops, lying on its side along -y (mouth) to +y, tied to a stake. Origin at the
    middle of the basket; the game sets it half under the water."""
    # rings mouth to tail: (y, radius, a binding hoop)
    rings = [(-0.078, 0.040, True), (-0.070, 0.042, True), (-0.050, 0.044, False), (-0.030, 0.044, True), (-0.022, 0.043, True),
             (0.010, 0.037, False), (0.036, 0.030, True), (0.044, 0.028, True), (0.064, 0.019, False), (0.080, 0.010, False)]
    segs = 9
    bm = q.bm
    loops = [[bm.verts.new((math.cos(k / segs * math.tau) * r, y, math.sin(k / segs * math.tau) * r * 0.9)) for k in range(segs)] for y, r, _ in rings]
    for i in range(len(loops) - 1):
        a, b = loops[i], loops[i + 1]
        hoop = rings[i][2] and rings[i + 1][2]
        for k in range(segs):
            f = bm.faces.new((a[k], b[k], b[(k + 1) % segs], a[(k + 1) % segs]))
            q.paint([f], WOOD_DARK if hoop else WICKER if (k + i) % 2 else WICKER_DARK, rnd, 0.06)
    tail = bm.verts.new((0, 0.092, 0))
    q.paint([bm.faces.new((loops[-1][(k + 1) % segs], loops[-1][k], tail)) for k in range(segs)], WICKER_DARK, rnd, 0.04)
    # the funnel turned in at the mouth, open at its small end
    inner = [bm.verts.new((math.cos(k / segs * math.tau) * 0.014, -0.030, math.sin(k / segs * math.tau) * 0.013)) for k in range(segs)]
    a = loops[0]
    q.paint([bm.faces.new((inner[k], a[k], a[(k + 1) % segs], inner[(k + 1) % segs])) for k in range(segs)], WICKER_DARK, rnd, 0.06)
    q.cyl(4, 0.0045, 0.0035, (0.050, -0.080, -0.080), (0.046, -0.080, 0.075), WOOD_DARK, rnd, 0.03)  # the stake
    q.cyl(3, 0.0015, 0.0015, (0.046, -0.080, 0.050), (0.030, -0.070, 0.020), CORD, rnd, 0.0, cap=False)
    if full:  # the catch: backs breaking out through the top of the weave, a tail flipped up
        for x, y, ry in ((0.010, 0.012, 0.25), (-0.012, -0.008, -0.3)):
            m = Matrix.Rotation(ry, 3, "Z")
            for v in q.blob((0, 0, 0), (0.010, 0.034, 0.012), (150, 170, 182), rnd, 0.05):
                v.co = Vector((x, y, 0.030)) + m @ v.co
        q.box((0.016, 0.044, 0.046), (0.003, 0.016, 0.018), (120, 140, 150), rnd, 0.0, rot=Matrix.Rotation(0.5, 3, "X"))


q = Part()
fishtrap(q, False)
q.finish("trap__fishtrap")
q = Part()
fishtrap(q, True)
q.finish("trap__fishtrapFull")

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

def sheet(q, rows, color_of, rnd, amt=0.05, flip=False):
    """Quads between rows of points (an open surface, not wrapped); color_of(i, k) per face."""
    bm = q.bm
    vs = [[bm.verts.new(p) for p in row] for row in rows]
    for i in range(len(vs) - 1):
        for k in range(len(vs[0]) - 1):
            quad = (vs[i][k], vs[i][k + 1], vs[i + 1][k + 1], vs[i + 1][k])
            q.paint([bm.faces.new(quad[::-1] if flip else quad)], color_of(i, k), rnd, amt)
    return vs


def shell(q, top, bot, col_top, col_bot, col_rim, rnd, amt=0.05):
    """A thin closed solid between two matching grids of points (a hide, a roof): faces on both sides and
    round the rim, so it shows from either side and finish() can turn every face outward."""
    bm = q.bm
    vt = [[bm.verts.new(p) for p in row] for row in top]
    vb = [[bm.verts.new(p) for p in row] for row in bot]
    R, C = len(top), len(top[0])
    for i in range(R - 1):
        for k in range(C - 1):
            q.paint([bm.faces.new((vt[i][k], vt[i][k + 1], vt[i + 1][k + 1], vt[i + 1][k]))], col_top(i, k), rnd, amt)
            q.paint([bm.faces.new((vb[i + 1][k], vb[i + 1][k + 1], vb[i][k + 1], vb[i][k]))], col_bot(i, k), rnd, amt)
    rim = [(0, k) for k in range(C)] + [(i, C - 1) for i in range(1, R)] + [(R - 1, k) for k in range(C - 2, -1, -1)] + [(i, 0) for i in range(R - 2, 0, -1)]
    for (i0, k0), (i1, k1) in zip(rim, rim[1:] + rim[:1]):
        q.paint([bm.faces.new((vt[i0][k0], vb[i0][k0], vb[i1][k1], vt[i1][k1]))], col_rim, rnd, amt)
    return vt, vb


HIDE_DK = (140, 106, 74)
ROPE_LT = (150, 122, 80)
HIDE_IN = (118, 90, 62)   # the flesh side, seen from under the shelter
BRACKEN = (92, 110, 58)
BRANCH = (88, 70, 46)


def forked_post(q, base, top, rnd, r=0.014):
    """An upright cut just above a fork: the trunk, and two short tines splayed to cradle a ridge pole."""
    base, top = Vector(base), Vector(top)
    q.cyl(5, r, r * 0.85, base, top, POLE, rnd)
    for s in (-1, 1):
        q.cyl(4, r * 0.7, r * 0.5, top - Vector((0, 0, 0.006)), top + Vector((0, s * 0.022, 0.036)), POLE, rnd)


# lean-to: a ridge pole in two forked uprights, rafters raked back to the ground, two hides sewn together
# and draped over them, sagging between the rafters and laced down; branches thrown over against the wind,
# a bracken bed beneath. Open to the front (-y).
q = Part()
rnd = random.Random(21)
RY, RZ, BY = -0.12, 0.33, 0.28
for x in (-0.28, 0.28):
    forked_post(q, (x, RY, 0), (x, RY, RZ - 0.02), rnd)
q.cyl(5, 0.012, 0.011, (-0.34, RY, RZ), (0.34, RY, RZ + 0.004), POLE, rnd)  # the ridge
RAFTERS = [-0.27, -0.135, 0.0, 0.135, 0.27]
for x in RAFTERS:
    q.cyl(4, 0.009, 0.008, (x, RY - 0.03, RZ + 0.012), (x + rnd.uniform(-0.01, 0.01), BY + 0.02, -0.004), POLE, rnd)
# the hide: rows from a lip hanging over the ridge at the front down to the ground at the back; columns
# across, a sag between each pair of rafters
cols = [-0.33 + k * 0.66 / 16 for k in range(17)]
slope = [(-0.16, RZ - 0.045), (RY - 0.012, RZ + 0.02), (-0.04, 0.27), (0.04, 0.2), (0.12, 0.13), (0.2, 0.065), (BY, 0.008)]


def drape(x, y, z, off):
    """A point on the hide: lifted onto the rafters, sagging between them, ragged at the edges."""
    d = min(abs(x - r) for r in RAFTERS)
    sag = 0.0 if abs(x) > 0.27 else math.sin(min(1.0, d / 0.0675) * math.pi / 2) * 0.016
    n = Vector((0, 0.65, 0.76))  # roughly the hide's outward normal
    p = Vector((x, y, z)) + n * (0.014 - sag - off)
    if abs(x) > 0.3:
        p.z -= (abs(x) - 0.3) * 0.6  # the side edges droop past the outer rafters
    return tuple(p)


edge = [rnd.uniform(-0.012, 0.012) for _ in cols]
rows_out = [[drape(x, y + (edge[k] if i == len(slope) - 1 else 0), z, 0) for k, x in enumerate(cols)] for i, (y, z) in enumerate(slope)]
rows_in = [[drape(x, y + (edge[k] if i == len(slope) - 1 else 0), z, 0.004) for k, x in enumerate(cols)] for i, (y, z) in enumerate(slope)]
shell(q, rows_out, rows_in, lambda i, k: HIDE if k < 8 else HIDE_DK, lambda i, k: HIDE_IN, HIDE_DK, rnd)
for i in range(1, len(slope) - 1, 2):  # the seam laced down the middle
    q.box(rows_out[i][8], (0.006, 0.014, 0.006), ROPE_LT, rnd, 0.0)
for x in (-0.3, 0.3):  # cords lacing the hide to the outer rafters
    for i in (2, 4):
        q.cyl(3, 0.0022, 0.0022, drape(x, slope[i][0], slope[i][1], -0.004), (x * 0.92, slope[i][0] - 0.01, slope[i][1] - 0.02), ROPE_LT, rnd, 0.0)
q.cyl(5, 0.014, 0.013, (-0.34, BY + 0.02, 0.012), (0.34, BY + 0.02, 0.012), BRANCH, rnd)  # a log on the hide's foot
for k in range(5):  # branches laid over the top against the wind
    x = -0.26 + k * 0.13 + rnd.uniform(-0.04, 0.04)
    top = Vector(drape(x, -0.07, 0.30, -0.012))
    bot = Vector(drape(x + rnd.uniform(-0.06, 0.06), 0.2, 0.06, -0.012))
    q.cyl(4, 0.007, 0.004, top, bot, BRANCH, rnd, 0.08)
    for t in (0.35, 0.65):  # a twig or two, with leaves gone brown
        m = top.lerp(bot, t)
        q.cyl(3, 0.004, 0.002, m, m + Vector((rnd.choice((-1, 1)) * 0.05, 0.02, 0.012)), BRANCH, rnd, 0.08)
q.box((0, 0.06, 0.006), (0.5, 0.3, 0.012), (124, 100, 68), rnd, 0.05)  # trodden earth
for k in range(7):  # the bed: armfuls of bracken heaped under the low side
    q.blob((-0.18 + k * 0.06, 0.1 + rnd.uniform(-0.03, 0.03), 0.02), (0.06, 0.07, 0.02), BRACKEN if k % 3 else (120, 112, 60), rnd, 0.1, noise=0.3)
q.blob((0.16, -0.05, 0.022), (0.06, 0.04, 0.022), HIDE_DK, rnd, 0.05, noise=0.2)  # a rolled sleeping hide
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

HATCH = (58, 44, 30)  # dark, but not so dark it glows like a doorway at night


def gable_thatch(q, L, ey, ez, rz, rnd, sag=0.01, n=10):
    """A thatched gable roof along x: two slopes from ragged eaves (|y| = ey, height ez) up to a ridge (rz),
    sagging along the middle and bowed in between eave and ridge, with a thick edge at the eaves and gables
    and a dark underside."""
    def pt(x, t, side, off=0.0):
        u = x / L
        dip = sag * (1 - u * u)  # the ridge and the slopes settle in the middle
        y = side * ey * (1 - t)
        z = ez + (rz - ez) * t - dip * (0.4 + 0.6 * t) - math.sin(t * math.pi) * 0.012
        return (x, y, z - off)
    xs = [-L + 2 * L * k / n for k in range(n + 1)]
    ts = [0.0, 0.25, 0.5, 0.75, 1.0]
    for side in (-1, 1):
        rag = [rnd.uniform(-0.006, 0.006) - (0.012 if k % 2 else 0) for k in range(n + 1)]
        rows = [[pt(x, t, side) for x in xs] for t in ts]
        rows[0] = [(p[0], p[1], p[2] + rag[k]) for k, p in enumerate(rows[0])]
        shade = lambda i, k: THATCH_DK if i == 0 else jit(THATCH if (i + k // 3) % 2 else (206, 176, 108), rnd, 0.04)
        top = sheet(q, rows, shade, rnd, 0.06, flip=side < 0)
        under = [[pt(x, t, side, 0.03) for x in xs] for t in ts]
        under[0] = [(p[0], p[1], p[2] + rag[k]) for k, p in enumerate(under[0])]
        bot = sheet(q, under, lambda i, k: THATCH_UNDER, rnd, 0.04, flip=side > 0)
        bm = q.bm
        # the thickness: along the eave, and up each gable edge
        for k in range(n):
            f = (top[0][k], bot[0][k], bot[0][k + 1], top[0][k + 1])
            q.paint([bm.faces.new(f if side < 0 else f[::-1])], THATCH_DK, rnd, 0.05)
        for k, sgn in ((0, -1), (n, 1)):
            for i in range(len(ts) - 1):
                f = (top[i][k], top[i + 1][k], bot[i + 1][k], bot[i][k])
                q.paint([bm.faces.new(f if sgn * side > 0 else f[::-1])], THATCH_DK, rnd, 0.05)
    # the ridge: a roll of thatch bound with cord
    pts = [pt(x, 1.0, 1) for x in xs]
    for p0, p1 in zip(pts, pts[1:]):
        q.cyl(6, 0.02, 0.02, (p0[0], 0, p0[2] + 0.004), (p1[0], 0, p1[2] + 0.004), THATCH_DK, rnd, 0.04, cap=p0 is pts[0] or p1 is pts[-1])
    for x in (-L * 0.7, 0.0, L * 0.7):
        z = pt(x, 1.0, 1)[2] + 0.004
        q.cyl(6, 0.0215, 0.0215, (x - 0.005, 0, z), (x + 0.005, 0, z), ROPE, rnd, 0.03, cap=False)
    # two ropes over the roof, weighted at the eaves with stones
    for x in (-L * 0.45, L * 0.45):
        for side in (-1, 1):
            e = pt(x, 0.0, side)
            q.cyl(3, 0.003, 0.003, (x, 0, pt(x, 1.0, side)[2] + 0.02), (x, e[1] + side * 0.01, e[2] - 0.004), ROPE, rnd, 0.0)
            q.blob((x, e[1] + side * 0.012, e[2] - 0.035), (0.017, 0.015, 0.02), rnd.choice(STONES), rnd, 0.05, noise=0.2)
    return pt


def rect_ring(W, D, z, out=0.0, per=6):
    """Points round a W x D rectangle (corners included), front (-y) edge first, at height z."""
    hw, hd = W / 2 + out, D / 2 + out
    corners = [(-hw, -hd), (hw, -hd), (hw, hd), (-hw, hd)]
    pts = []
    for (x0, y0), (x1, y1) in zip(corners, corners[1:] + corners[:1]):
        pts += [(x0 + (x1 - x0) * k / per, y0 + (y1 - y0) * k / per, z) for k in range(per)]
    return pts


def store_walls(q, walls, W, D, z0, h, rnd):
    """The box of the store: woven wattle between corner and side stakes, mud daub over that, or drystone."""
    hw, hd = W / 2, D / 2
    sides = [((-hw, -hd), (hw, -hd), (0, -1)), ((hw, -hd), (hw, hd), (1, 0)), ((hw, hd), (-hw, hd), (0, 1)), ((-hw, hd), (-hw, -hd), (-1, 0))]
    if walls == "wood":
        courses = 5
        for (x0, y0), (x1, y1), (nx, ny) in sides:
            m = 4
            for j in range(courses):
                za, zb = z0 + 0.003 + j * h / courses, z0 + (j + 1) * h / courses - 0.001
                col = jit(WATTLE, rnd, 0.1)
                for k in range(m):
                    p0 = Vector((x0 + (x1 - x0) * k / m, y0 + (y1 - y0) * k / m, 0))
                    p1 = Vector((x0 + (x1 - x0) * (k + 1) / m, y0 + (y1 - y0) * (k + 1) / m, 0))
                    pm = (p0 + p1) / 2 + Vector((nx, ny, 0)) * (0.007 if (k + j) % 2 else -0.003)
                    vs = [q.bm.verts.new((p.x, p.y, z)) for p, z in ((p0, za), (pm, za), (p1, za), (p1, zb), (pm, zb), (p0, zb))]
                    q.paint([q.bm.faces.new((vs[0], vs[1], vs[4], vs[5])), q.bm.faces.new((vs[1], vs[2], vs[3], vs[4]))], col, rnd, 0.05)
                for k in range(m):  # stakes
                    p = (x0 + (x1 - x0) * k / m + nx * 0.003, y0 + (y1 - y0) * k / m + ny * 0.003)
                    q.cyl(4, 0.007, 0.006, (p[0], p[1], z0 - 0.01), (p[0], p[1], z0 + h + 0.015), POLE, rnd, 0.06)
        q.box((0, 0, z0 + h / 2), (W - 0.012, D - 0.012, h), (96, 72, 46), rnd, 0.04)  # the far side of the weave
    elif walls == "daub":
        prof = [(0.004, z0), (0.006, z0 + 0.022), (0.005, z0 + 0.03), (0.008, z0 + h * 0.5), (0.005, z0 + h - 0.012), (0.0, z0 + h)]
        rows = [[(x * (1 + rnd.uniform(-0.01, 0.01)), y * (1 + rnd.uniform(-0.01, 0.01)), z) for x, y, z in rect_ring(W, D, z, out)] for out, z in prof]
        n = len(rows[0])
        crack = rnd.randrange(n)
        ring_loft(q, rows, lambda i, k: DAUB_DK if i < 2 else (WATTLE if i == 3 and k in (crack, (crack + 9) % n) else DAUB), rnd, 0.07)
        for (x0, y0), _, _ in sides:  # corner posts showing through the plaster
            q.cyl(4, 0.009, 0.008, (x0 * 1.04, y0 * 1.04, z0 - 0.01), (x0 * 1.04, y0 * 1.04, z0 + h + 0.015), POLE, rnd, 0.06)
    else:
        courses = 5
        ch = h / courses
        for c in range(courses):
            for (x0, y0), (x1, y1), (nx, ny) in sides:
                L = math.hypot(x1 - x0, y1 - y0)
                m = 4 if abs(ny) else 3
                off = 0.5 if (c + abs(nx)) % 2 else 0.0
                for k in range(m + (1 if off else 0)):
                    t0, t1 = max(0.0, (k - off) / m), min(1.0, (k + 1 - off) / m)
                    t = (t0 + t1) / 2
                    cx, cy = x0 + (x1 - x0) * t + nx * 0.012, y0 + (y1 - y0) * t + ny * 0.012
                    if ny < 0 and abs(cx) < 0.06 and c < 4:
                        continue  # the doorway
                    size = (L * (t1 - t0) * rnd.uniform(0.88, 0.97) + 0.03, 0.05 * rnd.uniform(0.9, 1.1), ch * rnd.uniform(0.84, 0.96))
                    ang = math.atan2(y1 - y0, x1 - x0)
                    q.box((cx, cy, z0 + c * ch + ch / 2), size, rnd.choice(STONES), rnd, 0.08,
                          rot=Matrix.Rotation(ang + rnd.uniform(-0.03, 0.03), 3, "Z"), taper=0.93)
        q.box((0, -hd - 0.012, z0 + 4 * ch - 0.006), (0.18, 0.06, 0.026), STONES[1], rnd, 0.05)  # lintel


def storehouse(walls, rnd):
    """A store for food. Wattle and daub stand on posts capped with flat stones, out of the damp and the
    mice' reach, with a notched-log ladder up to the hatch; the stone store sits on the ground with a low
    door. A sagging thatched gable roof over either."""
    q = Part()
    W, D = 0.38, 0.3
    if walls == "stone":
        z0, h = 0.0, 0.24
    else:
        z0, h = 0.15, 0.16
        for x in (-0.16, 0.16):
            for y in (-0.12, 0.12):
                q.cyl(5, 0.019, 0.017, (x, y, 0), (x, y, 0.118), POLE, rnd)
                q.cyl(7, 0.036, 0.03, (x, y, 0.118), (x, y, 0.13), rnd.choice(STONES), rnd, 0.05)  # staddle stones
        for y in (-0.12, 0.12):  # bearers, then a floor of split logs
            q.cyl(5, 0.014, 0.014, (-0.21, y, 0.142), (0.21, y, 0.142), POLE, rnd)
        for k in range(8):
            x = -0.2 + k * 0.4 / 7
            q.cyl(5, 0.014, 0.013, (x, -0.17, 0.157), (x + rnd.uniform(-0.005, 0.005), 0.17, 0.157), (118, 90, 60), rnd, 0.06)
        z0 = 0.165
    store_walls(q, walls, W, D, z0, h, rnd)
    top = z0 + h
    # gable ends filled with wattle (daubed on the daub store), set back under the roof
    pt = gable_thatch(q, W / 2 + 0.07, D / 2 + 0.085, top + 0.008, top + 0.17, rnd)
    for sx in (-1, 1):
        bm = q.bm
        x = sx * (W / 2 - 0.004)
        vs = [bm.verts.new((x, -D / 2, top)), bm.verts.new((x, D / 2, top)), bm.verts.new((x, 0, top + 0.14))]
        q.paint([bm.faces.new(vs if sx > 0 else list(reversed(vs)))], DAUB if walls == "daub" else WATTLE, rnd, 0.06)
    if walls == "stone":  # a low door, a hide hung over it, a flat stone before it
        q.box((0, -D / 2 - 0.01, 0.08), (0.1, 0.03, 0.16), HATCH)
        q.box((0.045, -D / 2 - 0.036, 0.085), (0.045, 0.008, 0.14), HIDE, rnd, 0.05, rot=Matrix.Rotation(0.5, 3, "Z"))  # pulled aside
        q.blob((0, -D / 2 - 0.07, 0.005), (0.07, 0.04, 0.01), STONES[2], rnd, 0.05, noise=0.15)
    else:  # a hatch with a hide over it, and a notched log leant up to it
        q.box((0, -D / 2 - 0.012, z0 + 0.075), (0.11, 0.02, 0.1), HATCH)
        q.box((-0.02, -D / 2 - 0.024, z0 + 0.09), (0.075, 0.008, 0.075), HIDE, rnd, 0.05, rot=Matrix.Rotation(-0.2, 3, "Y"))
        a, b = Vector((0.03, -D / 2 - 0.15, 0.0)), Vector((0.01, -D / 2 - 0.022, z0 + 0.012))
        q.cyl(5, 0.017, 0.014, a, b, (118, 90, 60), rnd, 0.05)
        for t in (0.25, 0.5, 0.75):  # the notches
            m = a.lerp(b, t)
            q.box(m + Vector((0, -0.012, 0.012)), (0.026, 0.01, 0.006), POLE, rnd, 0.0, rot=Matrix.Rotation(-0.85, 3, "X"))
    return q


for walls, suffix in (("wood", ""), ("daub", "d"), ("stone", "s")):
    storehouse(walls, random.Random(40)).finish(f"bld__storehouse{suffix}")


# windbreak: a curved hurdle behind the fire (+y, outside the ring where people sit), stakes driven in on an
# arc with rods woven between them, brushwood heaped along its top and against its back, a hide hung over
# the middle where the wind bites most. Centred on the hearth.
q = Part()
rnd = random.Random(44)
WR, WSPAN, WH = 1.55, 2.4, 0.32
n = 14
angs = [-WSPAN / 2 + WSPAN * k / n for k in range(n + 1)]
arc = lambda a, r=WR, z=0.0: (math.sin(a) * r, math.cos(a) * r, z)
for k, a in enumerate(angs):
    tall = WH + 0.03 + rnd.uniform(-0.015, 0.02)
    q.cyl(4, 0.011, 0.009, arc(a, WR, -0.01), arc(a + rnd.uniform(-0.004, 0.004), WR, tall), POLE, rnd, 0.06)
courses = 7
for j in range(courses):
    za, zb = 0.004 + j * WH / courses, (j + 1) * WH / courses + 0.003
    col = jit(WATTLE, rnd, 0.1)
    for k in range(n):
        a0, a1 = angs[k], angs[k + 1]
        rm = WR + (0.012 if (k + j) % 2 else -0.006)
        # a rod with some thickness, bending out and in round the stakes
        inner = [arc(a, r - 0.008, z) for a, r, z in ((a0, WR, za), ((a0 + a1) / 2, rm, za), (a1, WR, za))]
        outer = [arc(a, r, z) for a, r, z in ((a0, WR, za), ((a0 + a1) / 2, rm, za), (a1, WR, za))]
        shell(q, [outer, [(x, y, zb) for x, y, _ in outer]], [inner, [(x, y, zb) for x, y, _ in inner]],
              lambda i, k: col, lambda i, k: col, col, rnd)
for k in range(n):  # brushwood along the top, and heaped against the back
    a = (angs[k] + angs[k + 1]) / 2
    for v in q.blob((0, 0, 0), (0.16, 0.055, 0.045), (98, 84, 56) if k % 2 else (104, 92, 58), rnd, 0.1, noise=0.4):
        v.co = Vector(arc(a, WR + 0.012, WH + 0.03)) + Matrix.Rotation(-a, 3, "Z") @ v.co  # laid along the arc
    if k % 3 != 1:  # cut branches leant against the back
        for t in range(3):
            b = a + rnd.uniform(-0.05, 0.05)
            q.cyl(3, 0.007, 0.003, arc(b, WR + 0.16 + rnd.uniform(0, 0.05), 0.0), arc(b + rnd.uniform(-0.04, 0.04), WR + 0.01, WH * rnd.uniform(0.6, 0.95)),
                  BRANCH, rnd, 0.08)
for s in (-1, 1):  # the ends braced with a prop
    a = s * WSPAN / 2
    q.cyl(4, 0.01, 0.009, arc(a, WR + 0.2, 0), arc(a, WR, WH * 0.85), POLE, rnd)
hide = []  # a hide over the middle panels, draped down the inside
for i, z in enumerate((WH + 0.035, WH * 0.75, WH * 0.45)):
    hide.append([arc(-0.22 + 0.44 * k / 6, WR - 0.016 - (0.004 * i) - (0.006 if k % 2 else 0), z - (0.02 if i == 2 and k % 2 else 0)) for k in range(7)])
shell(q, hide, [[(x * 0.996, y * 0.996, z) for x, y, z in row] for row in hide], lambda i, k: HIDE_IN, lambda i, k: HIDE, HIDE_DK, rnd)
for k in range(5):  # stones at the foot, to keep the draught from under it
    a = -WSPAN / 2 + 0.2 + k * (WSPAN - 0.4) / 4 + rnd.uniform(-0.05, 0.05)
    q.blob(arc(a, WR - 0.05, 0.015), (0.04, 0.03, 0.025), rnd.choice(STONES), rnd, 0.05, noise=0.2)
q.finish("bld__windbreak")

# woodshed: a roof over the stockpile's log stack (posts just wide of the logs, which lie from y = 0.17 to
# 0.27 and stack up to about 0.5), four forked posts, a thatched roof falling to the back, a chopping block
q = Part()
rnd = random.Random(45)
X0, YF, YB = 0.3, 0.1, 0.34
ZF, ZB = 0.53, 0.45
for x in (-X0, X0):
    forked_post(q, (x, YF, 0), (x, YF, ZF - 0.03), rnd, r=0.013)
    forked_post(q, (x, YB, 0), (x, YB, ZB - 0.03), rnd, r=0.013)
    q.cyl(4, 0.008, 0.007, (x, YF, 0.2), (x, YB, 0.19), POLE, rnd)  # a rail to keep the stack in
for y, z in ((YF, ZF), (YB, ZB)):  # plates across, in the forks
    q.cyl(5, 0.011, 0.01, (-X0 - 0.06, y, z - 0.014), (X0 + 0.06, y, z - 0.014), POLE, rnd)
L = X0 + 0.07
xs = [-L + 2 * L * k / 8 for k in range(9)]
ys = [YF - 0.07, YF + 0.06, YB - 0.06, YB + 0.07]
roof_z = lambda x, y: ZF + (ZB - ZF) * (y - YF) / (YB - YF) + 0.006 - (1 - (x / L) ** 2) * 0.008
rag = [rnd.uniform(-0.006, 0.006) - (0.01 if k % 2 else 0) for k in range(9)]
top = [[(x, y, roof_z(x, y) + (rag[k] if i in (0, 3) else 0)) for k, x in enumerate(xs)] for i, y in enumerate(ys)]
bot = [[(x, y, z - 0.026) for x, y, z in row] for row in top]
shade = lambda i, k: jit(THATCH if (i + k // 2) % 2 else (206, 176, 108), rnd, 0.04)
shell(q, top, bot, shade, lambda i, k: THATCH_UNDER, THATCH_DK, rnd, 0.06)
for x in (-L * 0.5, L * 0.5):  # a rope over, weighted at the back
    q.cyl(3, 0.0035, 0.0035, (x, YF - 0.06, roof_z(x, YF - 0.06) + 0.004), (x, YB + 0.075, roof_z(x, YB + 0.07) + 0.002), ROPE, rnd, 0.0)
    q.cyl(3, 0.0035, 0.0035, (x, YB + 0.075, roof_z(x, YB + 0.07) + 0.002), (x, YB + 0.08, roof_z(x, YB + 0.07) - 0.03), ROPE, rnd, 0.0)
    q.blob((x, YB + 0.08, roof_z(x, YB + 0.07) - 0.045), (0.018, 0.016, 0.02), rnd.choice(STONES), rnd, 0.05, noise=0.2)
q.cyl(7, 0.04, 0.042, (0.4, -0.06, 0), (0.4, -0.06, 0.06), (118, 90, 60), rnd, 0.05)  # the chopping block
q.cyl(7, 0.038, 0.038, (0.4, -0.06, 0.06), (0.4, -0.06, 0.062), (196, 170, 128), rnd, 0.03)  # its cut top
for k in range(5):  # chips
    q.box((0.4 + rnd.uniform(-0.08, 0.08), -0.06 + rnd.uniform(-0.08, 0.08), 0.003), (0.014, 0.008, 0.003), (204, 180, 136), rnd, 0.06,
          rot=Matrix.Rotation(rnd.uniform(0, math.pi), 3, "Z"))
q.finish("bld__woodshed")

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
