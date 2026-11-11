"""People, animals, carried items and buildings for M1, exported as one GLB.

Run headless:  python3 blender/build_band.py [out.glb]
Conventions (read by src/render/band.ts):
  villager__{torso,head,arm*,fore*,thigh*,shin*,hairS,hairL,hairB,hairU,beard,cloak,hat,cape,bag}  one body in parts, animated in the shader;
      the game shows one of the four hair pieces (short, long, braids, bun), on some men the beard, and the cloak on those who have one.
      Vertex colours are REGION CODES, not final colours: red = clothing, green = skin,
      blue = hair, black = leather/shoes. The game tints each person individually.
  deer__{body,head,jaw,antlers,spots,legFL,legFR,legBL,legBR}  animated in parts, real colours (antlers on stags, spots on fawns).
  finch__{body,wingL,wingR}, goose__{body,wingL,wingR}             birds, wings spread from the shoulder; beaten, held out or folded in the shader.
  fish__{body,tail}                                                a brown trout in two parts, bent in the shader as it swims and leaps.
  wolf__{body,head,jaw,tail,legFL,legFR,legBL,legBR}, dog__{...the same}   a grey wolf and a tawny dog, posed in the shader.
  carcass__deer                                                     a deer pulled down by wolves, lying on its side, torn open.
  corpse__{rot,rotBare,bones,bonesRags,scatter}                     someone left unburied, rotting, a skeleton, then scattered bones
      (rot and bonesRags region-coded like the villager; the rest real colours).
  fox__{...as the wolf}                                             a red fox from the same build, with its brush and black stockings.
  boar__{body,head,tail,legFL,legFR,legBL,legBR,stripes}            a wild boar, posed in the shader (a piglet's stripes shown on the young).
  beaver__{body,head,tail,legFL,legFR,legBL,legBR}                  a beaver, posed in the shader (waddling, swimming, gnawing).
  lodge__beaver, dam__beaver                                        a beaver lodge, and a dam across a river (along x), origin at the water.
  hare__{body,head,ears,fore,hind}                                 a brown hare in parts, posed in the shader (hopping, sitting up, nibbling).
  carry__{log,berries,meat,fish,spear,axe,chopper,body,baby,stick,snare,fiber,mud,stone,roots,nuts,herbs,eggs,honey,mushrooms,grain,greens,basket,basketFull,hare} attached to a person's hands or shoulder.
  trap__{snare,snareFull,fishtrap,fishtrapFull}                  traps set in the world (origin at the foot / the basket's middle).
  pile__pot                                                       a lidded clay pot on the stockpile (origin at its foot).
  pile__{bowl,beads}                                              the band's goods on the stockpile: a patterned clay bowl, a string of beads lying coiled.
  boat__dugout                                                    the dugout the first band lands in (origin at the waterline, bow to -Y).
  item__{chopper,axe,stick,snare,fishtrap,basket,pot,cloak,needle,hat,mittens,shoes,cape,bag,necklace,bowl,beads}  each made thing in real colours,
      for the picture in its window (the game fits it to the picture).
  bld__{hearth,flame,leanto,bedding,hut0,hut1,storehouse,rack,site,windbreak,woodshed,fence,pit,kiln}  one tile footprint, centred on the origin
      (the windbreak reaches out in an arc behind the fire);
      huts and the storehouse also come as ...d (wattle-and-daub) and ...s (drystone), e.g. bld__hut0d, bld__storehouses.
  bld__{plot,plotSown,plotRoots,plotGrain,plotRipe,plotStubble}  a garden plot through its year (bare or fallow, sown, roots in
      leaf, young grain, ripe grain, stubble with stooks); the fence goes round the same tile.
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

MOUTH = (110, 52, 50)
q = Part()  # the lower jaw, dropped open when a stag roars in the rut (hidden the rest of the time): pale under
# the chin, the inside of the mouth dark and red, a tongue lying in it, a row of worn teeth at the front
jaw = [((0, -0.181, 0.300), 0.0125, 0.0072), ((0, -0.196, 0.2955), 0.0105, 0.0062), ((0, -0.209, 0.2925), 0.0085, 0.0052),
       ((0, -0.2185, 0.2905), 0.0065, 0.0042)]


def jaw_mid(y):
    for (a, _, _), (b, _, _) in zip(jaw, jaw[1:]):
        if b[1] <= y <= a[1]:
            k = (y - a[1]) / (b[1] - a[1])
            return a[2] + (b[2] - a[2]) * k
    return jaw[-1][0][2] if y < jaw[-1][0][1] else jaw[0][0][2]


sweep(q, jaw, 8, lambda c: MOUTH if c.z > jaw_mid(c.y) + 0.0025 else (DEER if c.y > -0.19 and c.z < jaw_mid(c.y) - 0.004 else BELLY))
q.box((0, -0.199, 0.3005), (0.0070, 0.020, 0.0026), (176, 92, 92), rnd, 0.0, rot=Matrix.Rotation(0.2, 3, "X"))  # tongue
q.box((0, -0.2175, 0.2952), (0.0085, 0.0028, 0.0030), (226, 218, 196), rnd, 0.0)  # teeth
q.finish("deer__jaw")


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

# ---------------------------------------------------------------- hare
# A brown hare crouched on the ground, ~0.13 long nose to tail (a touch bigger than life, to be seen at all
# among the deer), in five parts the game poses in the shader: body (with the tail), head, ears, the forelegs,
# and the haunches with their long hind feet. Origin at the ground under the middle of the body.
# ---------------------------------------------------------------- wolves, and the dogs tamed from them
# One build for both: a lean grey wolf with a dark saddle, pale cheeks and belly and a long bushy tail
# hanging behind, and a smaller tawny dog with a white chest and blaze, a shorter muzzle and its tail
# curled up over its back. In parts, posed in the shader: trotting and galloping legs, the head (a nod at
# the shoulders and at the poll), a lower jaw that opens to howl, bark or eat, and the tail.
def canid(prefix, s, cols, curl, blaze, fox=False):
    coat, back, pale, dark, nose = cols
    V = lambda x, y, z: (x * s, y * s, z * s)

    body = [(-0.104, 0.018, 0.024, 0.163), (-0.092, 0.032, 0.042, 0.160), (-0.066, 0.039, 0.050, 0.154), (-0.030, 0.036, 0.043, 0.156),
            (0.010, 0.030, 0.034, 0.162), (0.048, 0.031, 0.034, 0.164), (0.080, 0.031, 0.033, 0.165), (0.100, 0.022, 0.024, 0.167),
            (0.110, 0.010, 0.012, 0.169)]
    body = [(y * s, rx * s, rz * s, cz * s) for (y, rx, rz, cz) in body]

    def body_col(c):
        z, y = c.z / s, c.y / s
        if z < 0.128 or (y < -0.07 and z < 0.15):
            return pale  # belly and chest
        if z > 0.188 and -0.06 < y < 0.07:
            return back  # the saddle
        return coat

    q = Part()
    loft_y(q, body, 10, body_col)
    q.finish(f"{prefix}__body")

    q = Part()  # neck with a thick ruff, a broad skull, a tapering muzzle, a dark nose, eyes, pointed ears
    neck = [(V(0, -0.080, 0.165), 0.027 * s, 0.033 * s), (V(0, -0.100, 0.188), 0.024 * s, 0.027 * s), (V(0, -0.116, 0.205), 0.019 * s, 0.021 * s)]
    sweep(q, neck, 8, lambda c: pale if c.z / s < 0.178 and c.y / s < -0.095 else coat, caps=(True, False))
    mz = 0.75 if blaze else 1.12 if fox else 1.0  # a dog's muzzle is shorter, a fox's long and fine
    head = [(V(0, -0.113, 0.210), 0.019 * s, 0.019 * s), (V(0, -0.128, 0.213), 0.021 * s, 0.019 * s), (V(0, -0.143, 0.209), 0.015 * s, 0.0135 * s),
            (V(0, -0.143 - 0.020 * mz, 0.203), 0.0098 * s, 0.0088 * s), (V(0, -0.143 - 0.036 * mz, 0.2005), 0.0072 * s, 0.0064 * s)]

    def head_col(c):
        y, z = c.y / s, c.z / s
        if y < -0.143 - 0.031 * mz:
            return nose if z > 0.198 else pale
        if blaze and abs(c.x / s) < 0.006 and z > 0.205 and y < -0.12:
            return pale  # the white blaze down a dog's face
        if z < 0.204 and y < -0.13:
            return pale  # cheeks and muzzle
        return coat

    sweep(q, head, 8, head_col)
    q.box(V(0, -0.143 - 0.036 * mz, 0.2045), V(0.009, 0.004, 0.006), nose, rnd, 0.0)
    for ex in (-1, 1):
        q.box(V(ex * 0.0128, -0.137, 0.2165), V(0.0035, 0.0055, 0.004), (60, 44, 20) if blaze else (176, 128, 40), rnd, 0.0, rot=Matrix.Rotation(ex * 0.4, 3, "Z"))
        q.box(V(ex * 0.0142, -0.1385, 0.2168), V(0.0012, 0.0022, 0.0022), (16, 12, 10), rnd, 0.0)  # pupil
        # ears: a tall pointed wolf's ear, a smaller one tipped over on a dog
        base = Vector(V(ex * 0.0115, -0.120, 0.226))
        tip = Vector(V(ex * 0.016, -0.118, 0.250)) if not blaze else Vector(V(ex * 0.019, -0.127, 0.240))
        ew = 0.007
        if fox:  # a fox's ears: big, broad and black-backed
            tip = Vector(V(ex * 0.019, -0.117, 0.258))
            ew = 0.0095
        a = base + Vector(V(0, -ew, -0.002)); b = base + Vector(V(0, ew, -0.002))
        th = Vector((ex * 0.0018 * s, 0, 0))
        solid(q, [a, b, tip, a + th, b + th, tip + th * 0.5], [(0, 1, 2), (5, 4, 3), (0, 3, 4, 1), (1, 4, 5, 2), (2, 5, 3, 0)], dark if fox else coat, raw=False)
        ia, ib, it = a + Vector((0, -0.0012 * s, 0.0025 * s)), b + Vector((0, 0.0012 * s, 0.0025 * s)), base.lerp(tip, 0.8)
        solid(q, [ia - th * 0.4, ib - th * 0.4, it - th * 0.4, ia + th * 0.2, ib + th * 0.2, it + th * 0.2],
              [(0, 1, 2), (5, 4, 3), (0, 3, 4, 1), (1, 4, 5, 2), (2, 5, 3, 0)], pale if (blaze or fox) else dark, raw=False)
    q.finish(f"{prefix}__head")

    q = Part()  # lower jaw: hidden while shut, dropped open to howl, bark or tear at a kill
    jaw = [(V(0, -0.141, 0.198), 0.0105 * s, 0.0055 * s), (V(0, -0.141 - 0.018 * mz, 0.1955), 0.0082 * s, 0.0045 * s),
           (V(0, -0.141 - 0.033 * mz, 0.1945), 0.0058 * s, 0.0036 * s)]
    sweep(q, jaw, 8, lambda c: (120, 50, 50) if c.z / s > 0.1975 else pale)
    for ex in (-1, 1):
        q.box(V(ex * 0.0045, -0.141 - 0.031 * mz, 0.1985), V(0.0016, 0.0016, 0.0045), (236, 230, 214), rnd, 0.0)  # fang
    q.finish(f"{prefix}__jaw")

    q = Part()  # the tail: a wolf's hangs low and bushy with a dark tip, a dog's curls up over its back
    if fox:  # the brush: long, full and carried out level behind, with a white tip
        tail = [(V(0, 0.104, 0.170), 0.0085 * s, 0.0095 * s), (V(0, 0.124, 0.162), 0.0150 * s, 0.0160 * s), (V(0, 0.150, 0.150), 0.0185 * s, 0.0185 * s),
                (V(0, 0.176, 0.140), 0.0165 * s, 0.0165 * s), (V(0, 0.196, 0.134), 0.0105 * s, 0.0105 * s), (V(0, 0.206, 0.132), 0.003 * s, 0.003 * s)]
        sweep(q, tail, 8, lambda c: pale if c.y / s > 0.186 else dark if c.z / s < 0.142 and c.y / s < 0.15 else coat)
    elif curl:
        tail = [(V(0, 0.104, 0.170), 0.0075 * s, 0.0085 * s), (V(0, 0.120, 0.188), 0.0095 * s, 0.0095 * s), (V(0, 0.124, 0.212), 0.0092 * s, 0.0092 * s),
                (V(0, 0.110, 0.228), 0.0075 * s, 0.0075 * s), (V(0, 0.094, 0.226), 0.003 * s, 0.003 * s)]
        sweep(q, tail, 7, lambda c: pale if c.z / s > 0.222 else coat)
    else:
        tail = [(V(0, 0.104, 0.170), 0.0085 * s, 0.0095 * s), (V(0, 0.124, 0.152), 0.0135 * s, 0.0145 * s), (V(0, 0.137, 0.122), 0.0135 * s, 0.0135 * s),
                (V(0, 0.143, 0.096), 0.0095 * s, 0.0095 * s), (V(0, 0.145, 0.080), 0.003 * s, 0.003 * s)]
        sweep(q, tail, 7, lambda c: dark if c.z / s < 0.1 or (c.z / s > 0.15 and c.y / s < 0.125) else coat)
    q.finish(f"{prefix}__tail")

    for name, x, y in (("legFL", -0.021, -0.066), ("legFR", 0.021, -0.066), ("legBL", -0.021, 0.072), ("legBR", 0.021, 0.072)):
        q = Part()
        if y < 0:  # foreleg: straight, slim, the wrist a little forward, a round paw
            path = [((x, y, 0.163), 0.0125, 0.017), ((x, y - 0.002, 0.120), 0.0095, 0.011), ((x, y, 0.072), 0.0062, 0.0068),
                    ((x, y - 0.001, 0.036), 0.0056, 0.006), ((x, y - 0.004, 0.012), 0.006, 0.0062)]
        else:  # hind leg: a muscled thigh back to the hock, the cannon forward to the paw
            path = [((x, y - 0.004, 0.168), 0.0155, 0.022), ((x, y + 0.008, 0.123), 0.012, 0.014), ((x, y + 0.022, 0.083), 0.0072, 0.008),
                    ((x, y + 0.014, 0.042), 0.0056, 0.006), ((x, y + 0.006, 0.012), 0.006, 0.0062)]
        path = [(V(*p), rx * s, rz * s) for (p, rx, rz) in path]
        if fox:  # black stockings
            sweep(q, path, 6, lambda c: dark if c.z / s < 0.095 else coat)
        else:
            sweep(q, path, 6, lambda c: pale if c.z / s < 0.06 or (y < 0 and c.y / s < y - 0.004) else coat)
        py = path[-1][0][1] - 0.004 * s
        q.box((x * s, py, 0.004 * s), (0.013 * s, 0.017 * s, 0.008 * s), pale if blaze else dark if fox else (90, 80, 70), rnd, 0.0, taper=0.8)  # paw
        q.finish(f"{prefix}__{name}")


canid("wolf", 1.0, ((128, 120, 108), (78, 72, 66), (204, 198, 184), (52, 48, 44), (30, 26, 24)), curl=False, blaze=False)
canid("dog", 0.82, ((176, 128, 76), (140, 98, 56), (232, 224, 208), (96, 66, 40), (34, 28, 24)), curl=True, blaze=True)
canid("fox", 0.70, ((198, 96, 42), (182, 84, 36), (238, 232, 220), (40, 30, 26), (26, 20, 18)), curl=False, blaze=False, fox=True)


# ---------------------------------------------------------------- wild boar
# A wild boar: a deep, heavy forequarter high at the withers and a crest of dark bristles down the spine,
# the back falling away to a narrow rump; a long wedge of a head ending in a flat pink-grey snout disc,
# small eyes, pricked hairy ears and tusks curling up from the corners of the mouth; short stout legs on
# small dark trotters and a thin tufted tail. In parts, posed in the shader like the wolves, plus the pale
# stripes of a piglet (shown on the young only). The young are the same model drawn smaller.
BOAR_COAT, BOAR_DARK, BOAR_PALE = (82, 70, 60), (44, 37, 32), (112, 98, 84)
BOAR_SNOUT, BOAR_TUSK, BOAR_HOOF = (122, 98, 92), (232, 222, 196), (30, 26, 24)
rnd = random.Random(71)
BOAR_BODY = [(-0.112, 0.022, 0.028, 0.128), (-0.098, 0.042, 0.050, 0.122), (-0.070, 0.054, 0.062, 0.116), (-0.030, 0.056, 0.058, 0.112),
             (0.012, 0.054, 0.053, 0.110), (0.050, 0.050, 0.050, 0.110), (0.082, 0.043, 0.044, 0.112), (0.106, 0.030, 0.032, 0.114),
             (0.120, 0.012, 0.013, 0.116)]


def boar_rx(y):
    """The body's half-width along it (for laying a piglet's stripes on the flank)."""
    return smooth([(r[0], r[1]) for r in BOAR_BODY], y)


def boar_col(c):
    if c.z < 0.066:
        return BOAR_PALE  # the belly, a shade lighter
    if c.z > 0.160 and c.y < 0.05:
        return BOAR_DARK  # the bristly ridge of the back
    return BOAR_COAT


q = Part()
loft_y(q, BOAR_BODY, 12, boar_col)
# the crest of long dark bristles from the nape back along the spine
sweep(q, [((0, -0.118, 0.160), 0.006, 0.010), ((0, -0.090, 0.178), 0.008, 0.012), ((0, -0.050, 0.182), 0.008, 0.011),
          ((0, -0.005, 0.174), 0.006, 0.009), ((0, 0.040, 0.164), 0.004, 0.006)], 6, lambda c: BOAR_DARK)
q.finish("boar__body")

q = Part()  # head: the thick neck, the long wedge of the face, the snout disc, eyes, ears and tusks
head = [((0, -0.098, 0.134), 0.034, 0.040), ((0, -0.124, 0.126), 0.029, 0.033), ((0, -0.148, 0.112), 0.021, 0.024),
        ((0, -0.170, 0.099), 0.0145, 0.016), ((0, -0.186, 0.092), 0.0115, 0.0115)]
sweep(q, head, 10, lambda c: BOAR_DARK if c.z > 0.147 else BOAR_PALE if c.z < 0.097 and c.y > -0.15 else BOAR_COAT)
q.blob((0, -0.1885, 0.092), (0.0125, 0.003, 0.0115), BOAR_SNOUT, rnd, 0.03)  # the disc of the snout
for ex in (-1, 1):
    q.box((ex * 0.0045, -0.1915, 0.093), (0.003, 0.0012, 0.004), (40, 30, 30), rnd, 0.0)  # nostrils
    q.box((ex * 0.0185, -0.137, 0.130), (0.003, 0.004, 0.003), (24, 18, 16), rnd, 0.0, rot=Matrix.Rotation(ex * 0.5, 3, "Z"))  # eye
    # ears: pricked, hairy, a little forward
    base = Vector((ex * 0.016, -0.112, 0.162))
    a, b, tip = base + Vector((0, -0.008, -0.002)), base + Vector((0, 0.008, -0.002)), Vector((ex * 0.027, -0.108, 0.188))
    th = Vector((ex * 0.003, 0, 0))
    solid(q, [a, b, tip, a + th, b + th, tip + th * 0.5], [(0, 1, 2), (5, 4, 3), (0, 3, 4, 1), (1, 4, 5, 2), (2, 5, 3, 0)], BOAR_DARK, raw=False)
    # tusks: out of the corner of the mouth and curling up and back
    pts = [Vector((ex * 0.010, -0.172, 0.084)), Vector((ex * 0.016, -0.176, 0.092)), Vector((ex * 0.019, -0.173, 0.101)), Vector((ex * 0.018, -0.166, 0.107))]
    for k, (a_, b_) in enumerate(zip(pts, pts[1:])):
        q.cyl(5, 0.0026 - k * 0.0006, 0.002 - k * 0.0006, a_, b_, BOAR_TUSK, rnd, 0.0)
q.finish("boar__head")

q = Part()  # the tail: thin, hanging, a dark tuft at the end
sweep(q, [((0, 0.118, 0.128), 0.004, 0.004), ((0, 0.126, 0.112), 0.003, 0.003), ((0, 0.128, 0.090), 0.0025, 0.0025)], 5, lambda c: BOAR_COAT)
q.blob((0, 0.128, 0.084), (0.004, 0.004, 0.008), BOAR_DARK, rnd, 0.04)
q.finish("boar__tail")

for name, x, y in (("legFL", -0.028, -0.070), ("legFR", 0.028, -0.070), ("legBL", -0.028, 0.076), ("legBR", 0.028, 0.076)):
    q = Part()
    if y < 0:  # foreleg: a thick forearm, straight down to the trotter
        path = [((x, y, 0.098), 0.017, 0.022), ((x, y - 0.002, 0.064), 0.012, 0.0135), ((x, y - 0.002, 0.036), 0.0085, 0.0095),
                ((x, y - 0.004, 0.016), 0.0075, 0.008)]
    else:  # hind leg: a heavy ham, the hock, the shank forward to the trotter
        path = [((x, y - 0.004, 0.104), 0.021, 0.028), ((x, y + 0.006, 0.072), 0.014, 0.017), ((x, y + 0.010, 0.044), 0.009, 0.0095),
                ((x, y + 0.004, 0.024), 0.0078, 0.008), ((x, y, 0.014), 0.0075, 0.0078)]
    sweep(q, path, 7, lambda c: BOAR_DARK if c.z < 0.042 else BOAR_COAT)
    py = path[-1][0][1]
    for sx in (-1, 1):  # the two claws of the trotter
        q.box((x + sx * 0.0034, py - 0.003, 0.006), (0.0062, 0.013, 0.012), BOAR_HOOF, rnd, 0.0, taper=0.7)
    q.finish(f"boar__{name}")

q = Part()  # a piglet's stripes: pale bands along each flank and down the back, standing just off the coat
STRIPE = (204, 178, 128)
for ex in (-1, 1):
    for z0 in (0.154, 0.130, 0.104, 0.080):
        path = []
        for k in range(7):
            y = -0.085 + k * 0.028
            ring = min(BOAR_BODY, key=lambda r: abs(r[0] - y))
            # the point on the ring at this height
            dz = (z0 - ring[3]) / ring[2]
            if abs(dz) >= 0.97:
                continue
            path.append(((ex * (boar_rx(y) * math.sqrt(1 - dz * dz) + 0.0015), y, z0), 0.0028, 0.0028))
        if len(path) >= 3:
            sweep(q, path, 4, lambda c: STRIPE)
sweep(q, [((0, -0.10, 0.178), 0.003, 0.002), ((0, -0.03, 0.174), 0.003, 0.002), ((0, 0.05, 0.162), 0.003, 0.002), ((0, 0.10, 0.148), 0.0025, 0.002)], 4, lambda c: STRIPE)
q.finish("boar__stripes")


# ---------------------------------------------------------------- beaver
# A beaver: a heavy pear of a body in dark glossy brown, low to the ground; a blunt head with small round
# ears, a dark nose and the orange chisel teeth showing; small forepaws and big webbed hind feet; and the
# broad flat scaly tail. In parts, posed in the shader: waddling and paddling legs, the head (gnawing), the
# tail (sculling, and slapped on the water), and sitting up on the haunches to gnaw round a trunk.
BEAVER_FUR, BEAVER_BACK, BEAVER_BELLY = (100, 66, 42), (74, 48, 30), (128, 92, 62)
BEAVER_TAIL, BEAVER_SCALE, BEAVER_FOOT = (56, 50, 48), (42, 38, 36), (52, 40, 32)
rnd = random.Random(72)
q = Part()
BEAVER_BODY = [(-0.050, 0.010, 0.012, 0.034), (-0.042, 0.020, 0.020, 0.036), (-0.026, 0.028, 0.027, 0.036), (0.000, 0.036, 0.033, 0.036),
               (0.024, 0.040, 0.035, 0.036), (0.044, 0.035, 0.030, 0.034), (0.058, 0.020, 0.018, 0.030), (0.064, 0.006, 0.007, 0.028)]
loft_y(q, BEAVER_BODY, 12, lambda c: BEAVER_BELLY if c.z < 0.016 else BEAVER_BACK if c.z > 0.058 else BEAVER_FUR)
q.finish("beaver__body")

q = Part()  # head
sweep(q, [((0, -0.040, 0.044), 0.020, 0.020), ((0, -0.058, 0.046), 0.018, 0.017), ((0, -0.072, 0.042), 0.0125, 0.0115),
          ((0, -0.081, 0.038), 0.0085, 0.0075)], 9, lambda c: BEAVER_BACK if c.z > 0.058 else BEAVER_FUR)
q.blob((0, -0.0845, 0.040), (0.0055, 0.003, 0.0035), (28, 22, 20), rnd, 0.0)  # nose
q.box((0, -0.0815, 0.029), (0.0065, 0.0022, 0.0062), (216, 124, 44), rnd, 0.0)  # the orange incisors
for ex in (-1, 1):
    q.box((ex * 0.0115, -0.066, 0.051), (0.0026, 0.003, 0.0026), (20, 14, 12), rnd, 0.0)  # eye
    q.blob((ex * 0.0150, -0.050, 0.060), (0.0042, 0.0028, 0.0042), BEAVER_BACK, rnd, 0.03)  # ear
q.finish("beaver__head")

q = Part()  # the tail: a broad flat paddle, scaly, on a short furred root
q.blob((0, 0.068, 0.024), (0.009, 0.010, 0.006), BEAVER_FUR, rnd, 0.03)
vs = q.blob((0, 0.104, 0.018), (0.022, 0.036, 0.0045), BEAVER_TAIL, rnd, 0.05)
for k in range(5):  # a darker cross-hatch of scales
    q.box((0, 0.084 + k * 0.010, 0.0225), (0.030 - abs(k - 2) * 0.004, 0.0012, 0.0008), BEAVER_SCALE, rnd, 0.0)
q.finish("beaver__tail")

for name, x, y in (("legFL", -0.019, -0.030), ("legFR", 0.019, -0.030), ("legBL", -0.026, 0.030), ("legBR", 0.026, 0.030)):
    q = Part()
    if y < 0:  # small forelegs with clawed, hand-like paws
        sweep(q, [((x, y, 0.028), 0.0065, 0.0075), ((x, y - 0.003, 0.010), 0.004, 0.0045)], 6, lambda c: BEAVER_FUR)
        q.box((x, y - 0.006, 0.003), (0.008, 0.009, 0.005), BEAVER_FOOT, rnd, 0.0, taper=0.8)
    else:  # the haunch, and a big webbed hind foot
        sweep(q, [((x, y, 0.034), 0.011, 0.013), ((x, y - 0.002, 0.014), 0.007, 0.007)], 6, lambda c: BEAVER_FUR)
        q.box((x, y - 0.010, 0.0025), (0.016, 0.028, 0.004), BEAVER_FOOT, rnd, 0.0, taper=0.6)
    q.finish(f"beaver__{name}")


# ---------------------------------------------------------------- the lodge and the dam
# The lodge: a dome of mud and sticks heaped up in the water against the bank, peeled pale sticks poking
# out of it. The dam: a long bank of mud, stones and sticks laid crosswise, one tile wide, across a river
# (along x; the game turns it to the river). Origins at the water's surface.
STICK, STICK_PEEL, MUD_DARK, MUD_WET = (104, 82, 60), (176, 150, 112), (78, 62, 48), (62, 52, 42)
rnd = random.Random(73)
q = Part()
q.blob((0, 0, -0.03), (0.25, 0.22, 0.16), MUD_DARK, rnd, 0.08, noise=0.10, subdiv=2)
q.blob((0, 0, -0.05), (0.29, 0.26, 0.05), MUD_WET, rnd, 0.06, noise=0.12, subdiv=2)  # the wet skirt at the waterline
for k in range(70):
    # sticks laid over the dome, mostly lying along its surface, a few peeled pale ones
    a = rnd.uniform(0, math.tau)
    up = rnd.uniform(0.0, 0.92)
    n = Vector((math.cos(a) * math.sqrt(1 - up * up), math.sin(a) * math.sqrt(1 - up * up), up))
    p = Vector((n.x * 0.25, n.y * 0.22, -0.03 + n.z * 0.16)) + n * 0.004
    t = n.cross(Vector((rnd.uniform(-1, 1), rnd.uniform(-1, 1), rnd.uniform(-1, 1)))).normalized()
    d = t * rnd.uniform(0.05, 0.11)
    q.cyl(4, 0.0055, 0.0040, p - d * 0.5 - n * 0.006, p + d * 0.5 + n * 0.012, STICK_PEEL if rnd.random() < 0.3 else STICK, rnd, 0.06)
q.finish("lodge__beaver")

q = Part()
for k in range(14):
    x = -0.52 + k * 0.08
    q.blob((x, rnd.uniform(-0.01, 0.01), -0.03), (0.06, 0.07, 0.045), MUD_DARK if k % 2 else MUD_WET, rnd, 0.08, noise=0.12)
for k in range(90):
    # sticks laid mostly across the flow, heaped along the crest, a few along it
    x = rnd.uniform(-0.55, 0.55)
    across = rnd.random() < 0.7
    d = Vector((rnd.uniform(-0.3, 0.3), 1, rnd.uniform(-0.15, 0.15))) if across else Vector((1, rnd.uniform(-0.2, 0.2), rnd.uniform(-0.05, 0.05)))
    d = d.normalized() * rnd.uniform(0.05, 0.11)
    p = Vector((x, rnd.uniform(-0.04, 0.04), rnd.uniform(0.0, 0.02)))
    q.cyl(4, 0.0045, 0.0032, p - d * 0.5, p + d * 0.5, STICK_PEEL if rnd.random() < 0.3 else STICK, rnd, 0.06)
q.finish("dam__beaver")


# a deer the wolves have pulled down: lying on its side, legs out, head along the ground, a raw wound
# torn in the flank with the ribs showing (drawn at a kill while the pack feeds)
q = Part()
def _pose(name, M):
    me = bpy.data.objects[name].data.copy()
    me.transform(M)
    q.bm.from_mesh(me)
    bpy.data.meshes.remove(me)
_rot = lambda a, p: Matrix.Translation(p) @ Matrix.Rotation(a, 4, "X") @ Matrix.Translation(-Vector(p))
_side = Matrix.Translation((0, 0, -0.150)) @ Matrix.Translation((0, 0, 0.2)) @ Matrix.Rotation(math.pi / 2, 4, "Y") @ Matrix.Translation((0, 0, -0.2))
_pose("deer__body", _side)
_pose("deer__head", _side @ _rot(0.95, (0, -0.10, 0.21)))
for _n, _a in (("legFL", -0.55), ("legFR", -0.35), ("legBL", 0.45), ("legBR", 0.65)):
    _pose(f"deer__{_n}", _side @ _rot(_a, (0, -0.09 if "F" in _n[3] else 0.09, 0.15)))
WOUND, RAW, RIB = (96, 22, 22), (150, 40, 36), (222, 210, 190)
q.blob((0.004, 0.006, 0.094), (0.030, 0.052, 0.009), WOUND, rnd, 0.06, noise=0.25)
q.blob((0.004, 0.002, 0.099), (0.022, 0.038, 0.007), RAW, rnd, 0.08, noise=0.3)
for _k in range(4):
    _y = -0.022 + _k * 0.013
    q.cyl(5, 0.0026, 0.0022, (-0.018, _y - 0.002, 0.100), (0.024, _y + 0.004, 0.103), RIB, rnd, 0.03)
q.finish("carcass__deer")


# ---------------------------------------------------------------- the unburied dead
# Someone nobody buried, as they go back to the land (the game shows each in turn, see REMAINS in the sim):
# fresh, they are the villager itself lying on its back; then
#   corpse__rot (region-coded like the villager) + corpse__rotBare (real colours): the same body, the
#       arms and legs fallen a little apart, bone showing at the face, the chest and a shin, a dark stain beneath;
#   corpse__bones (real colours) + corpse__bonesRags (region-coded rags): a skeleton in the same place;
#   corpse__scatter (real colours): years on, the bones pulled apart, greyed and half sunk in the grass.
# All lie as the dead villager does: on the back, head to +Y (behind where they faced), feet at y = -0.18.
LIE = Matrix.Translation((0, -0.18, 0.036)) @ Matrix.Rotation(-math.pi / 2, 4, "X")
DRY_BONE, DRY_BONE_DK = (216, 205, 178), (176, 162, 134)
WEATHERED = (196, 192, 178)
WET_BONE = (180, 164, 128)  # bone just showing through, still stained
HOLLOW = (40, 30, 24)
STAIN, STAIN_WET = (74, 58, 38), (58, 44, 30)
TEETH = (232, 224, 196)


def g2b(x, h, f=0.0, lift=0.0):
    """A point on the standing villager (x across, h up, f forward, game units) where it lies dead, in Blender space."""
    return (x, h - 0.18, f + 0.036 + lift)


def lie_part(q, name, M):
    me = bpy.data.objects[name].data.copy()
    me.transform(M)
    q.bm.from_mesh(me)
    bpy.data.meshes.remove(me)


def lie_bounds(name, M):
    pts = [M @ v.co for v in bpy.data.objects[name].data.vertices]
    return Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts))), Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))


def about_z(a, at):
    at = Vector(at)
    return Matrix.Translation(at) @ Matrix.Rotation(a, 4, "Z") @ Matrix.Translation(-at)


# the limbs fall a little apart as the body slackens (about the shoulders and hips, flat on the ground)
SPLAY = {}
for side, sx in (("L", -1), ("R", 1)):
    SPLAY[f"arm{side}"] = SPLAY[f"fore{side}"] = about_z(sx * 0.22, g2b(sx * 0.069, 0.272)) @ LIE
    SPLAY[f"thigh{side}"] = SPLAY[f"shin{side}"] = about_z(sx * 0.09, g2b(sx * 0.031, 0.150)) @ LIE
SPLAY["torso"] = SPLAY["head"] = LIE
# the head lolls to one side
SPLAY["head"] = Matrix.Translation(g2b(0, 0.292)) @ Matrix.Rotation(0.35, 4, "Y") @ Matrix.Translation(-Vector(g2b(0, 0.292))) @ LIE

q = Part()
for nm, M in SPLAY.items():
    lie_part(q, f"villager__{nm}", M)
# the flesh is falling in: lower everything over the middle of the body toward the ground
for v in q.bm.verts:
    if v.co.z > 0.02:
        mid = max(0.0, 1 - abs(v.co.y - 0.03) / 0.16)
        v.co.z = 0.02 + (v.co.z - 0.02) * (1 - 0.28 * mid)
q.finish("corpse__rot")

crr = random.Random(87)
q = Part()
t0, t1 = lie_bounds("villager__torso", LIE)
h0, h1 = lie_bounds("villager__head", SPLAY["head"])
chest = (t1.z - 0.02) * (1 - 0.28 * 0.6) + 0.02  # the chest's top, fallen in as above
# a dark stain soaked into the ground under and around the body
for k in range(7):
    c = (crr.uniform(-0.03, 0.03), -0.15 + k * 0.05 + crr.uniform(-0.01, 0.01), -0.0006)
    q.blob(c, (crr.uniform(0.035, 0.06), crr.uniform(0.04, 0.06), 0.0016), STAIN if k % 2 else STAIN_WET, crr, 0.08, noise=0.25)
# ribs through the rotted cloth over the chest
for k in range(4):
    y = 0.095 - k * 0.016
    for sx in (-1, 1):
        a = (sx * 0.006, y, chest + 0.001)
        m = (sx * 0.026, y - 0.004, chest - 0.002)
        b = (sx * 0.042, y - 0.010, chest - 0.010)
        q.cyl(5, 0.0032, 0.0028, a, m, WET_BONE, crr, 0.05)
        q.cyl(5, 0.0028, 0.0022, m, b, WET_BONE, crr, 0.05)
q.blob((0, 0.07, chest + 0.001), (0.006, 0.04, 0.0025), (150, 134, 104), crr, 0.04)
# the face gone to the bone: brow, cheekbones, the sockets and the teeth
hx, hy, hz = (h0.x + h1.x) / 2, (h0.y + h1.y) / 2, h1.z
q.blob((hx, hy + 0.004, hz - 0.004), (0.020, 0.024, 0.008), WET_BONE, crr, 0.05, noise=0.08, subdiv=2)
for sx in (-1, 1):
    q.blob((hx + sx * 0.0085, hy + 0.004, hz + 0.002), (0.0055, 0.0050, 0.0035), HOLLOW, crr, 0.02)
q.blob((hx, hy - 0.006, hz + 0.001), (0.0028, 0.0035, 0.0025), HOLLOW, crr, 0.02)
for k in range(6):
    q.box((hx - 0.0075 + k * 0.003, hy - 0.016, hz - 0.001), (0.0024, 0.0028, 0.004), TEETH, crr, 0.04)
# a shin bared, and the finger bones of one hand
s0, s1 = lie_bounds("villager__shinL", SPLAY["shinL"])
sx_, sy0, sy1 = (s0.x + s1.x) / 2, s0.y + 0.03, s1.y - 0.008
q.cyl(6, 0.0042, 0.0036, (sx_, sy0, s1.z - 0.003), (sx_ + 0.001, sy1, s1.z - 0.002), WET_BONE, crr, 0.05)
f0, f1 = lie_bounds("villager__foreR", SPLAY["foreR"])
fx, fy = (f0.x + f1.x) / 2, f0.y + 0.004
for k in range(4):
    a = Vector((fx - 0.006 + k * 0.004, fy + 0.004, 0.006))
    q.cyl(4, 0.0016, 0.0012, a, a + Vector(((k - 1.5) * 0.002, -0.016, -0.002)), WET_BONE, crr, 0.05)
q.finish("corpse__rotBare")


def skeleton(q, rr, color, sink=0.0, scatter=0.0):
    """A skeleton lying on its back (head to +Y); `scatter` pulls the bones apart, `sink` lowers them into the turf."""
    def jig(p, amt=1.0):
        return Vector((p[0] + rr.uniform(-1, 1) * scatter * amt, p[1] + rr.uniform(-1, 1) * scatter * amt, max(0.0, p[2] - sink)))

    def bone(a, b, r0, r1, amt=1.0, segs=6):
        off = Vector((rr.uniform(-1, 1), rr.uniform(-1, 1), 0)) * scatter * amt
        A, B = jig(a, 0.2) + off, jig(b, 0.2) + off
        q.cyl(segs, r0, r1, A, B, color, rr, 0.06)
        # the knobbed ends
        q.box(A, (r0 * 2.6, r0 * 2.6, r0 * 2.2), color, rr, 0.05)
        q.box(B, (r1 * 2.6, r1 * 2.6, r1 * 2.2), color, rr, 0.05)

    z = 0.012
    # the skull, face up, turned a little; the jaw dropped below it
    skull = jig((0.004, 0.170, 0.026), 1.6)
    q.blob(skull, (0.026, 0.031, 0.025), color, rr, 0.05, noise=0.04, subdiv=2)
    q.blob(skull + Vector((0, -0.014, -0.004)), (0.019, 0.016, 0.019), color, rr, 0.05, subdiv=2)
    for sx in (-1, 1):
        q.blob(skull + Vector((sx * 0.0095, -0.012, 0.016)), (0.0065, 0.0055, 0.004), HOLLOW, rr, 0.02)
        q.blob(skull + Vector((sx * 0.0215, -0.006, 0.004)), (0.004, 0.012, 0.008), color, rr, 0.04)  # cheekbones
    q.blob(skull + Vector((0, -0.024, 0.012)), (0.003, 0.004, 0.003), HOLLOW, rr, 0.02)
    for k in range(6):
        q.box(skull + Vector((-0.0075 + k * 0.003, -0.032, 0.004)), (0.0024, 0.003, 0.0045), TEETH if not sink else color, rr, 0.04)
    jaw = jig((0.004, 0.128, 0.014), 2.5)
    for sx in (-1, 1):
        q.cyl(5, 0.0032, 0.0028, jaw + Vector((sx * 0.003, 0, 0)), jaw + Vector((sx * 0.017, 0.018, 0.004)), color, rr, 0.05)
    # the spine, and the collarbones
    for k in range(13):
        y = 0.128 - k * 0.0125
        q.box(jig((0, y, z - 0.002), 0.6), (0.009, 0.007, 0.007), color, rr, 0.06)
    for sx in (-1, 1):
        bone((sx * 0.008, 0.106, z + 0.012), (sx * 0.058, 0.099, z + 0.006), 0.0026, 0.0024, 0.8, 5)
    # the ribs, fallen flat across the spine; with the years only a few are left
    for k in range(7):
        if scatter and rr.random() < 0.5:
            continue
        y = 0.098 - k * 0.0135
        w = 0.030 + 0.008 * math.sin(k / 6 * math.pi)
        for sx in (-1, 1):
            off = Vector((rr.uniform(-1, 1), rr.uniform(-1, 1), 0)) * scatter * 1.2
            pts = [Vector((sx * 0.005, y, z)), Vector((sx * (w * 0.75), y - 0.003, z + 0.008)), Vector((sx * w, y - 0.010, z + 0.004)), Vector((sx * (w * 0.8), y - 0.020, z + 0.012))]
            for a, b in zip(pts, pts[1:]):
                q.cyl(4, 0.0022, 0.0020, jig(a + off, 0.1), jig(b + off, 0.1), color, rr, 0.05)
    q.blob(jig((0, 0.072, z + 0.012), 0.8), (0.006, 0.03, 0.0025), color, rr, 0.05)  # breastbone
    # the pelvis: two wings and the sacrum between
    pel = jig((0, -0.034, z), 0.7)
    for sx in (-1, 1):
        q.blob(pel + Vector((sx * 0.022, 0.006, 0.004)), (0.018, 0.016, 0.006), color, rr, 0.05, noise=0.1, subdiv=2)
        q.blob(pel + Vector((sx * 0.012, -0.012, 0.002)), (0.009, 0.007, 0.005), color, rr, 0.05)
    q.blob(pel + Vector((0, 0.002, 0.001)), (0.008, 0.014, 0.005), color, rr, 0.05)
    # arms, a little out from the sides, and the hands' small bones
    for sx in (-1, 1):
        sh, el, wr = (sx * 0.066, 0.094, z), (sx * 0.084, 0.026, z), (sx * 0.090, -0.040, z)
        bone(sh, el, 0.0042, 0.0036)
        bone((el[0] - sx * 0.002, el[1], z), (wr[0] - sx * 0.002, wr[1], z), 0.0028, 0.0026)
        bone((el[0] + sx * 0.003, el[1], z), (wr[0] + sx * 0.004, wr[1], z), 0.0026, 0.0024, segs=5)
        for k in range(4):
            a = (wr[0] - 0.006 + k * 0.004, wr[1] - 0.006, z - 0.004)
            b = (a[0] + (k - 1.5) * 0.002, a[1] - 0.015, a[2])
            q.cyl(4, 0.0016, 0.0012, jig(a, 1.4), jig(b, 1.4), color, rr, 0.05)
    # legs, the feet fallen outward
    for sx in (-1, 1):
        hp, kn, an = (sx * 0.030, -0.040, z), (sx * 0.038, -0.097, z), (sx * 0.042, -0.166, z)
        bone(hp, kn, 0.0055, 0.0048)
        q.blob(jig((kn[0], kn[1] - 0.002, z + 0.006)), (0.006, 0.006, 0.004), color, rr, 0.05)  # kneecap
        bone((kn[0] - sx * 0.002, kn[1] - 0.004, z), (an[0] - sx * 0.002, an[1], z), 0.0042, 0.0034)
        bone((kn[0] + sx * 0.005, kn[1] - 0.006, z), (an[0] + sx * 0.005, an[1], z), 0.0022, 0.0020, segs=5)
        for k in range(4):
            a = (an[0] + sx * (0.002 + k * 0.003), an[1] - 0.004, z - 0.004)
            b = (a[0] + sx * 0.012, a[1] - 0.014 + k * 0.002, a[2])
            q.cyl(4, 0.0018, 0.0014, jig(a, 1.4), jig(b, 1.4), color, rr, 0.05)


q = Part()
skeleton(q, random.Random(88), DRY_BONE)
q.finish("corpse__bones")

# what is left of the clothes: rags at the hips and over the ribs (region-coded: the wearer's cloth)
q = Part()
rr = random.Random(89)
q.blob((0.0, -0.040, 0.006), (0.045, 0.030, 0.0035), CLOTH, rr, 0.0, noise=0.3, raw=True, subdiv=2)
q.blob((-0.022, 0.050, 0.005), (0.022, 0.036, 0.003), CLOTH, rr, 0.0, noise=0.35, raw=True, subdiv=2)
q.blob((0.032, 0.080, 0.004), (0.014, 0.020, 0.003), CLOTH, rr, 0.0, noise=0.35, raw=True)
q.blob((0.044, -0.170, 0.008), (0.014, 0.018, 0.007), DARK, rr, 0.0, noise=0.2, raw=True)  # a shoe, still on a foot
q.finish("corpse__bonesRags")

q = Part()
skeleton(q, random.Random(90), WEATHERED, sink=0.006, scatter=0.035)
q.finish("corpse__scatter")


HARE_COAT = (148, 112, 74)
HARE_BACK = (108, 82, 56)    # grizzled darker along the spine
HARE_BELLY = (226, 214, 190)
HARE_WHITE = (240, 236, 228)  # the scut's underside
HARE_BLACK = (34, 29, 26)     # ear tips, the top of the tail
HARE_EYE = (70, 44, 22)
hr = random.Random(21)


def ellip(q, center, size, color, rot=None, amt=0.04, subdiv=1):
    """An ellipsoid of radii `size`, turned by `rot` about its own centre."""
    R = rot or Matrix.Identity(3)
    for v in q.blob((0, 0, 0), size, color, hr, amt, subdiv=subdiv):
        v.co = R @ v.co + Vector(center)


q = Part()  # the body: low in front, rising to a round rump, pale underneath; the scut white below, black on top
HARE_BODY = [(-0.036, 0.008, 0.010, 0.044), (-0.028, 0.017, 0.019, 0.042), (-0.014, 0.022, 0.024, 0.041), (0.002, 0.025, 0.027, 0.042),
             (0.018, 0.027, 0.029, 0.043), (0.032, 0.026, 0.027, 0.043), (0.044, 0.020, 0.021, 0.042), (0.052, 0.009, 0.010, 0.042)]
loft_y(q, HARE_BODY, 10, lambda c: HARE_BELLY if c.z < 0.026 else HARE_BACK if c.z > 0.066 and abs(c.x) < 0.012 else HARE_COAT)
ellip(q, (0, 0.056, 0.044), (0.0085, 0.0075, 0.0085), HARE_WHITE)
ellip(q, (0, 0.058, 0.0505), (0.006, 0.005, 0.004), HARE_BLACK)
q.finish("hare__body")

q = Part()  # the head on a short neck: a blunt muzzle, pale chin, dark nose, eyes set high on the sides
ellip(q, (0, -0.033, 0.057), (0.012, 0.013, 0.015), HARE_COAT)
ellip(q, (0, -0.047, 0.066), (0.0145, 0.019, 0.0145), HARE_COAT)
ellip(q, (0, -0.061, 0.061), (0.009, 0.010, 0.0085), HARE_COAT)
ellip(q, (0, -0.058, 0.056), (0.008, 0.009, 0.005), HARE_BELLY)
q.box((0, -0.0695, 0.0625), (0.006, 0.003, 0.004), HARE_BLACK, hr, 0.0)
for ex in (-1, 1):
    q.box((ex * 0.0115, -0.050, 0.0705), (0.003, 0.0055, 0.0045), HARE_EYE, hr, 0.0, rot=Matrix.Rotation(ex * 0.3, 3, "Z"))
q.finish("hare__head")

q = Part()  # the long ears, standing up and swept back, splayed a little, black at the tips
for ex in (-1, 1):
    R = Matrix.Rotation(ex * 0.22, 3, "Y") @ Matrix.Rotation(-0.5, 3, "X")
    base = Vector((ex * 0.006, -0.040, 0.077))
    ellip(q, base + R @ Vector((0, 0, 0.021)), (0.0030, 0.0062, 0.023), HARE_COAT, R)
    ellip(q, base + R @ Vector((0, 0, 0.039)), (0.0032, 0.0046, 0.0065), HARE_BLACK, R)
q.finish("hare__ears")

q = Part()  # forelegs, slim and straight under the chest
for ex in (-1, 1):
    q.cyl(5, 0.0042, 0.0032, (ex * 0.0095, -0.026, 0.034), (ex * 0.0095, -0.032, 0.003), HARE_COAT, hr, 0.04)
    ellip(q, (ex * 0.0095, -0.0345, 0.0025), (0.0038, 0.0058, 0.0025), HARE_BELLY)
q.finish("hare__fore")

q = Part()  # the haunches, and the long hind feet flat on the ground beneath them
for ex in (-1, 1):
    ellip(q, (ex * 0.019, 0.026, 0.028), (0.0105, 0.021, 0.019), HARE_COAT)
    q.box((ex * 0.017, 0.012, 0.0035), (0.009, 0.050, 0.007), HARE_COAT, hr, 0.03, taper=0.8)
    ellip(q, (ex * 0.017, -0.012, 0.003), (0.0045, 0.0055, 0.003), HARE_BELLY)
q.finish("hare__hind")

# ---------------------------------------------------------------- fish
# A brown trout, ~0.10 long (bigger than life, like everything else that has to be seen from the camera), in two
# parts the game bends in the shader: the fore body with the head, and the tail end with the tail fin. Origin at the
# middle of the body; it swims along -y (the game's +z). Olive back, golden flanks with dark spots, a cream belly.
TROUT_BACK = (78, 74, 44)
TROUT_SIDE = (178, 150, 84)
TROUT_BELLY = (226, 214, 176)
TROUT_SPOT = (52, 40, 30)
TROUT_RED = (168, 62, 44)
TROUT_FIN = (122, 104, 62)
fr = random.Random(31)


def trout_col(c, rz):
    if c.z > rz * 0.45:
        return TROUT_BACK
    if c.z < -rz * 0.45:
        return TROUT_BELLY
    return TROUT_SIDE


TROUT = [(-0.052, 0.002, 0.003, 0.0), (-0.046, 0.0055, 0.0085, 0.0), (-0.036, 0.0080, 0.0125, 0.0005), (-0.024, 0.0092, 0.0145, 0.001),
         (-0.010, 0.0094, 0.0150, 0.001), (0.004, 0.0088, 0.0138, 0.001), (0.014, 0.0076, 0.0116, 0.0008)]
TROUT_TAIL = [(0.014, 0.0076, 0.0116, 0.0008), (0.026, 0.0058, 0.0084, 0.0005), (0.036, 0.0040, 0.0058, 0.0003), (0.044, 0.0026, 0.0040, 0.0)]


def trout_part(rings):
    q = Part()
    rmax = max(r[2] for r in rings)
    bm = q.bm
    segs = 10
    loops = [[bm.verts.new((math.cos(k / segs * math.tau) * rx, y, cz + math.sin(k / segs * math.tau) * rz)) for k in range(segs)] for (y, rx, rz, cz) in rings]
    faces = []
    for i in range(len(loops) - 1):
        a, b = loops[i], loops[i + 1]
        faces += [bm.faces.new((a[k], b[k], b[(k + 1) % segs], a[(k + 1) % segs])) for k in range(segs)]
    faces.append(bm.faces.new(loops[0]))
    faces.append(bm.faces.new(list(reversed(loops[-1]))))
    for f in faces:
        q.paint([f], trout_col(f.calc_center_median(), rmax), fr, 0.05)
    return q


def fin(q, pts, color=TROUT_FIN, w=0.0008, axis=(1, 0, 0)):
    """A thin fin from a flat outline, given a hair of thickness across `axis`."""
    n = len(pts)
    vs = [Vector(p) for p in pts]
    off = Vector(axis) * w
    solid(q, [v + off for v in vs] + [v - off for v in vs],
          [list(range(n)), list(range(2 * n - 1, n - 1, -1))] + [(k, (k + 1) % n, n + (k + 1) % n, n + k) for k in range(n)], color, raw=False)


q = trout_part(TROUT)
fin(q, [(0, -0.012, 0.014), (0, 0.004, 0.0125), (0, 0.000, 0.022), (0, -0.008, 0.023)])  # dorsal fin
for ex in (-1, 1):  # pectoral fins, swept back under the gills, and the eyes
    fin(q, [(ex * 0.006, -0.036, -0.008), (ex * 0.006, -0.032, -0.008), (ex * 0.014, -0.026, -0.012), (ex * 0.012, -0.030, -0.013)], axis=(0, 0, 1))
    q.box((ex * 0.0058, -0.044, 0.0025), (0.0016, 0.0030, 0.0030), TROUT_SPOT, fr, 0.0)
    # dark spots on the flank, a few ringed red low down
    for k in range(7):
        y = -0.030 + k * 0.007 + fr.uniform(-0.002, 0.002)
        z = fr.uniform(-0.002, 0.009)
        rx = 0.0093 * math.sqrt(max(0.05, 1 - (z / 0.0148) ** 2))
        q.box((ex * rx, y, z), (0.0010, 0.0015, 0.0014), TROUT_RED if z < 0.002 and k % 2 else TROUT_SPOT, fr, 0.0)
q.finish("fish__body")

q = trout_part(TROUT_TAIL)
fin(q, [(0, 0.040, 0.0035), (0, 0.058, 0.014), (0, 0.054, 0.0), (0, 0.058, -0.013), (0, 0.040, -0.0030)])  # the tail fin, a shallow fork
fin(q, [(0, 0.020, 0.0085), (0, 0.030, 0.0065), (0, 0.028, 0.0110)])  # adipose fin
fin(q, [(0, 0.018, -0.0090), (0, 0.030, -0.0060), (0, 0.026, -0.0130)])  # anal fin
q.finish("fish__tail")

# ---------------------------------------------------------------- birds
# Two birds, each in three parts the game poses in the shader: the body (head, beak, tail, feet), and the left and
# right wings, modelled spread flat from the shoulder so the game can beat them, hold them out to glide, or fold
# them back along the body. Origin at the feet for the finch, at the middle of the body for the goose (it is only
# ever seen flying). Both face -y.
br = random.Random(41)


def wing(q, side, root, span, chord, colors, tip_back=0.4, droop=0.0):
    """A spread wing: a tapered blade from the shoulder out along x, its trailing edge in feather steps.
    `colors`: one per step of the blade, from the root out."""
    rx, ry, rz = root
    n = 4
    for k in range(n):
        u0, u1 = k / n, (k + 1) / n
        x0, x1 = rx + side * span * u0, rx + side * span * u1
        c0, c1 = chord * (1 - 0.55 * u0 ** 1.5), chord * (1 - 0.55 * u1 ** 1.5)
        b0, b1 = tip_back * chord * u0 ** 2, tip_back * chord * u1 ** 2
        z0, z1 = rz - droop * u0, rz - droop * u1
        col = colors[k]
        pts = [(x0, ry - c0 * 0.35 + b0, z0), (x1, ry - c1 * 0.35 + b1, z1), (x1, ry + c1 * 0.65 + b1, z1), (x0, ry + c0 * 0.65 + b0, z0)]
        t = 0.0012
        vs = [Vector(p) + Vector((0, 0, t)) for p in pts] + [Vector(p) - Vector((0, 0, t)) for p in pts]
        faces = [(0, 1, 2, 3), (7, 6, 5, 4), (0, 4, 5, 1), (1, 5, 6, 2), (2, 6, 7, 3), (3, 7, 4, 0)]
        if side < 0:
            faces = [f[::-1] for f in faces]
        solid(q, vs, faces, col, raw=False)


# a finch, ~0.05 long: brown back, pinkish-buff breast, blue-grey cap, dark wings with a white bar, a white-edged tail
FINCH_BACK = (126, 94, 64)
FINCH_BREAST = (198, 140, 110)
FINCH_CAP = (106, 116, 132)
FINCH_WING = (58, 50, 44)
FINCH_BAR = (232, 228, 214)
FINCH_BEAK = (160, 150, 128)
q = Part()
ellip(q, (0, 0.002, 0.014), (0.0095, 0.0165, 0.0095), FINCH_BACK)
ellip(q, (0, -0.004, 0.011), (0.0085, 0.012, 0.0080), FINCH_BREAST)
ellip(q, (0, -0.016, 0.0205), (0.0072, 0.0075, 0.0070), FINCH_CAP)
ellip(q, (0, -0.0185, 0.0175), (0.0058, 0.0050, 0.0042), FINCH_BREAST)
q.cone(5, 0.0026, 0.0, 0.0065, FINCH_BEAK, br, 0.0)
for v in [v for v in q.bm.verts][-6:]:
    v.co = Matrix.Rotation(math.pi / 2, 3, "X") @ v.co + Vector((0, -0.0215, 0.0195))
for ex in (-1, 1):
    q.box((ex * 0.0058, -0.0195, 0.0225), (0.0012, 0.002, 0.002), HARE_BLACK, br, 0.0)  # eye
    q.cyl(3, 0.0008, 0.0008, (ex * 0.003, 0.0, 0.006), (ex * 0.003, -0.001, 0.0), HARE_BLACK, br, 0.0)  # leg
q.box((0, 0.024, 0.0135), (0.0075, 0.018, 0.0018), FINCH_WING, br, 0.03, rot=Matrix.Rotation(0.25, 3, "X"), taper=1.0)
q.box((0, 0.031, 0.0118), (0.0080, 0.006, 0.0016), FINCH_BAR, br, 0.0, rot=Matrix.Rotation(0.25, 3, "X"))
q.finish("finch__body")
for side, name in ((-1, "L"), (1, "R")):
    q = Part()
    wing(q, side, (side * 0.006, -0.002, 0.017), 0.028, 0.013, (FINCH_BACK, FINCH_BAR, FINCH_WING, FINCH_WING), tip_back=0.5)
    q.finish(f"finch__wing{name}")

# a greylag goose, ~0.17 long: grey-brown with paler barring, a long neck, orange bill, white under the tail
GOOSE = (126, 118, 104)
GOOSE_DARK = (88, 82, 74)
GOOSE_PALE = (200, 196, 184)
GOOSE_BILL = (226, 132, 64)
q = Part()
ellip(q, (0, 0.010, 0.0), (0.020, 0.044, 0.018), GOOSE)
ellip(q, (0, 0.012, -0.007), (0.017, 0.036, 0.012), GOOSE_PALE)
ellip(q, (0, 0.054, 0.002), (0.010, 0.012, 0.007), (236, 232, 224))  # white under the tail
q.box((0, 0.062, 0.004), (0.016, 0.014, 0.003), GOOSE_DARK, br, 0.03)
sweep(q, [((0, -0.028, 0.003), 0.0085, 0.0095), ((0, -0.048, 0.006), 0.0060, 0.0065), ((0, -0.066, 0.008), 0.0055, 0.0058)], 6,
      lambda c: GOOSE_DARK if c.y < -0.04 else GOOSE, caps=(False, False))
ellip(q, (0, -0.072, 0.009), (0.0068, 0.0095, 0.0068), GOOSE_DARK)
ellip(q, (0, -0.085, 0.007), (0.0030, 0.0075, 0.0030), GOOSE_BILL)
for ex in (-1, 1):
    q.box((ex * 0.0055, -0.074, 0.0115), (0.0012, 0.0022, 0.0022), HARE_BLACK, br, 0.0)
    ellip(q, (ex * 0.006, 0.046, -0.010), (0.003, 0.008, 0.002), GOOSE_BILL)  # feet tucked back
q.finish("goose__body")
for side, name in ((-1, "L"), (1, "R")):
    q = Part()
    wing(q, side, (side * 0.012, -0.004, 0.006), 0.085, 0.034, (GOOSE, GOOSE, GOOSE, GOOSE_DARK), tip_back=0.6, droop=0.004)
    q.finish(f"goose__wing{name}")

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

q = Part()  # a bundle of dug roots: fat pale tubers and reed rhizomes, earth still on them, their dry stems tied
rr = random.Random(50)
ROOT = (176, 150, 112)
ROOT_DK = (128, 100, 70)
for k in range(7):
    a, r = k / 7 * math.tau + rr.uniform(-0.3, 0.3), rr.uniform(0.006, 0.014)
    top_ = Vector((math.cos(a) * 0.004, math.sin(a) * 0.004, -0.004))
    bot_ = Vector((math.cos(a) * r * 1.8, math.sin(a) * r * 1.5, -0.05 - rr.uniform(0, 0.025)))
    q.cyl(5, 0.0045, 0.009 + rr.uniform(0, 0.004), top_, top_.lerp(bot_, 0.55), ROOT if k % 3 else ROOT_DK, rr, 0.08)
    q.cyl(5, 0.009 + rr.uniform(0, 0.004), 0.003, top_.lerp(bot_, 0.55), bot_, ROOT if k % 3 else ROOT_DK, rr, 0.08, cap=True)
for k in range(6):  # the dry stems, gathered in the hand
    a = k / 6 * math.tau
    q.cyl(3, 0.0022, 0.0015, (0, 0, -0.006), (math.cos(a) * 0.012, math.sin(a) * 0.012, 0.04 + rr.uniform(0, 0.015)), GRASS_DK, rr, 0.1, cap=False)
q.cyl(8, 0.0075, 0.0075, (0, 0, -0.008), (0, 0, 0.002), ROPE_TIE, rr, 0.03, cap=False)  # the tie
q.finish("carry__roots")

q = Part()  # acorns carried home in a hide bag gathered up at the neck, a few spilling over the rim
rr = random.Random(51)
ACORN = (150, 108, 58)
ACORN_CUP = (104, 84, 54)
for v in q.blob((0, 0, -0.03), (0.038, 0.034, 0.036), HIDE_CARRY, rr, 0.05, noise=0.1):
    if v.co.z > -0.004:
        k = (v.co.z + 0.004) / 0.03
        v.co.x *= 1 - 0.55 * min(1.0, k)
        v.co.y *= 1 - 0.55 * min(1.0, k)
q.cyl(8, 0.021, 0.021, (0, 0, -0.006), (0, 0, -0.001), ROPE_TIE, rr, 0.03, cap=False)  # the drawstring
for k in range(6):  # acorns heaped in the open neck
    a, r = k / 6 * math.tau + rr.uniform(-0.3, 0.3), rr.uniform(0.004, 0.011)
    c = (math.cos(a) * r, math.sin(a) * r, 0.001 + rr.uniform(0, 0.006))
    q.blob(c, (0.0058, 0.0058, 0.0078), ACORN, rr, 0.08, subdiv=1)
    q.blob((c[0], c[1], c[2] + 0.005), (0.0062, 0.0062, 0.003), ACORN_CUP, rr, 0.06, subdiv=1)
q.finish("carry__nuts")

q = Part()  # a bundle of healing plants: leafy stems and a few flower heads, tied with a twist of grass
rr = random.Random(52)
LEAF = (82, 124, 58)
LEAF_DK = (58, 92, 44)
FLOWER = (226, 210, 120)
for k in range(9):
    a = k / 9 * math.tau + rr.uniform(-0.25, 0.25)
    base = Vector((math.cos(a) * 0.003, math.sin(a) * 0.003, -0.05))
    top = Vector((math.cos(a) * 0.022, math.sin(a) * 0.018, 0.045 + rr.uniform(0, 0.02)))
    q.cyl(3, 0.0018, 0.0012, base, top, LEAF_DK, rr, 0.08, cap=False)
    for j in range(2):  # a pair of leaves up the stem
        at = base.lerp(top, 0.45 + j * 0.3)
        q.blob((at.x * 1.25, at.y * 1.25, at.z), (0.0095, 0.006, 0.0032), LEAF if (k + j) % 2 else LEAF_DK, rr, 0.08, noise=0.1)
    if k % 3 == 0:
        q.blob(tuple(top), (0.005, 0.005, 0.004), FLOWER, rr, 0.06)
q.cyl(8, 0.0072, 0.0072, (0, 0, -0.03), (0, 0, -0.021), GRASS_DK, rr, 0.03, cap=False)  # the tie
q.finish("carry__herbs")

q = Part()  # a clutch of eggs in a cupped nest of twigs and grass, held in the hand
rr = random.Random(53)
NEST = (128, 104, 68)
EGG = (214, 206, 180)
EGG_SPOT = (176, 190, 196)
for k in range(10):  # the rim, twigs woven round
    a0, a1 = k / 10 * math.tau, (k + 1.4) / 10 * math.tau
    q.cyl(3, 0.003, 0.003, (math.cos(a0) * 0.026, math.sin(a0) * 0.026, -0.006 + rr.uniform(-0.002, 0.002)),
          (math.cos(a1) * 0.026, math.sin(a1) * 0.026, -0.006 + rr.uniform(-0.002, 0.002)), NEST if k % 2 else GRASS_DK, rr, 0.08, cap=False)
for v in q.blob((0, 0, -0.016), (0.026, 0.026, 0.012), NEST, rr, 0.08, noise=0.15):
    v.co.z = min(v.co.z, -0.008)  # the cup
for k, (x, y) in enumerate(((-0.007, -0.004), (0.008, -0.002), (0.0, 0.009))):
    q.blob((x, y, -0.004), (0.0075, 0.006, 0.006), EGG if k != 1 else EGG_SPOT, rr, 0.04)
q.finish("carry__eggs")

q = Part()  # honeycomb, dripping, on a slab of bark
rr = random.Random(54)
COMB = (222, 168, 54)
COMB_DK = (186, 128, 34)
q.box((0, 0, -0.012), (0.06, 0.036, 0.006), BARK, rr, 0.06)
for k in range(3):  # slabs of comb laid side by side
    v = q.box((-0.018 + k * 0.018, 0, 0.002), (0.015, 0.03, 0.02), COMB if k % 2 == 0 else COMB_DK, rr, 0.08, taper=0.85)
q.blob((0.022, -0.016, -0.006), (0.006, 0.004, 0.004), COMB, rr, 0.04)  # a drip
q.finish("carry__honey")

q = Part()  # a small grass basket of mushrooms, held by its handle
rr = random.Random(55)
BASK = (168, 136, 84)
BASK_DK = (118, 92, 56)
CAP = (164, 120, 80)
CAP_PALE = (212, 196, 164)
STEM = (226, 216, 194)
for v in q.blob((0, 0, -0.04), (0.03, 0.026, 0.024), BASK, rr, 0.06):
    v.co.z = min(v.co.z, -0.028)
q.cyl(10, 0.03, 0.03, (0, 0, -0.03), (0, 0, -0.026), BASK_DK, rr, 0.04, cap=False)  # the rim
pts = [Vector((math.cos(a) * 0.028, 0, -0.026 + math.sin(a) * 0.03)) for a in [k / 8 * math.pi for k in range(9)]]
for a_, b_ in zip(pts, pts[1:]):  # the handle, arching over
    q.cyl(3, 0.0022, 0.0022, a_, b_, BASK_DK, rr, 0.04, cap=False)
for k in range(5):  # caps peeping over the rim
    a = k / 5 * math.tau + 0.3
    x, y = math.cos(a) * 0.014, math.sin(a) * 0.012
    q.cyl(4, 0.003, 0.003, (x, y, -0.03), (x, y, -0.02), STEM, rr, 0.04, cap=False)
    for v in q.blob((x, y, -0.018), (0.009, 0.009, 0.005), CAP if k % 2 else CAP_PALE, rr, 0.06):
        v.co.z = max(v.co.z, -0.02)
q.finish("carry__mushrooms")

q = Part()  # a sheaf of grain for the shoulder (along x, like a log): stalks bound twice, the cut ends at -x,
rr = random.Random(53)  # the ripe heads nodding at +x
STRAW = (212, 184, 112)
STRAW_DK = (178, 150, 88)
EAR = (196, 156, 78)
for k in range(22):
    a, r = rr.uniform(0, math.tau), rr.uniform(0, 0.02)
    y, z = math.cos(a) * r, math.sin(a) * r
    butt = Vector((-0.15 + rr.uniform(-0.01, 0.01), y * 0.9, z * 0.9))
    waist = Vector((0.0, y * 0.5, z * 0.5))
    tip = Vector((0.13 + rr.uniform(0, 0.03), y * 2.2, z * 2.0 - 0.012))
    col = STRAW if k % 3 else STRAW_DK
    q.cyl(3, 0.0028, 0.0026, butt, waist, col, rr, 0.06, cap=False)
    q.cyl(3, 0.0026, 0.002, waist, tip, col, rr, 0.06, cap=False)
    d = (tip - waist).normalized()
    head = tip + d * 0.018 + Vector((0, 0, -0.006))
    for v in q.blob((0, 0, 0), (0.016, 0.0045, 0.0045), jit(EAR, rr, 0.08), rr, 0.06, subdiv=1):  # the ear, nodding
        v.co = head + Matrix.Rotation(math.atan2(d.y, d.x), 3, "Z") @ Matrix.Rotation(0.35, 3, "Y") @ v.co
for x in (-0.07, 0.035):  # the bands, twisted from the straw itself
    q.cyl(8, 0.024 - abs(x) * 0.05, 0.024 - abs(x) * 0.05, (x - 0.006, 0, 0), (x + 0.006, 0, 0), STRAW_DK, rr, 0.03, cap=False)
q.finish("carry__grain")

q = Part()  # an armful of greens from the garden: broad leaves and stems tied at the stalk, hanging from the fist
rr = random.Random(54)
GLEAF = (88, 126, 56)
GLEAF_DK = (64, 98, 44)
GLEAF_LT = (118, 150, 72)
for k in range(11):
    a = k / 11 * math.tau + rr.uniform(-0.2, 0.2)
    stem_end = Vector((math.cos(a) * 0.012, math.sin(a) * 0.01, -0.03 - rr.uniform(0, 0.012)))
    q.cyl(3, 0.0025, 0.002, (0, 0, 0.012), stem_end, (150, 160, 96), rr, 0.06, cap=False)
    leaf_c = stem_end + Vector((math.cos(a) * 0.02, math.sin(a) * 0.016, -0.028))
    m = Matrix.Rotation(a, 3, "Z") @ Matrix.Rotation(0.5, 3, "Y")
    for v in q.blob((0, 0, 0), (0.022, 0.014, 0.004), rr.choice((GLEAF, GLEAF_DK, GLEAF_LT)), rr, 0.08, noise=0.15):
        v.co = leaf_c + m @ v.co
q.cyl(8, 0.008, 0.008, (0, 0, -0.004), (0, 0, 0.006), ROPE_TIE, rr, 0.03, cap=False)  # the tie
q.finish("carry__greens")

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
q = Part()  # a hare from the snares, carried home dangling by the noose's cord from the fist
q.cyl(3, 0.0016, 0.0016, (0, 0, 0.004), (0, 0, -0.022), CORD, rnd, 0.0, cap=False)
noose(q, (0, 0, -0.026), 0.006, segs=5)
hare(q, (0, 0, -0.066), hang=True)
q.finish("carry__hare")

FOX_RED = (190, 92, 40)
FOX_WHITE = (236, 228, 214)
FOX_DARK = (44, 32, 26)
BEAVER_FUR = (104, 70, 44)
BEAVER_TAIL = (52, 44, 40)
STONE_GREY = (128, 124, 116)
BAIT = (150, 58, 48)


def deadfall(q, caught):
    """A deadfall at a fox earth: a heavy log, one end on the ground and the other propped up on a
    figure-four of notched sticks (upright, slanted lever, bait stick with a scrap of meat under the log),
    a couple of stones on it for weight and two pairs of stakes either side so it drops straight. Sprung,
    the log lies flat, the trigger sticks are knocked flat, and the catch shows from under it (a fox's
    brush and hind feet, or a beaver's flat tail). Origin at the middle, the log along x."""
    rr = random.Random(77 + (len(caught or "") * 13))
    lo, hi = Vector((-0.125, 0.0, 0.017)), Vector((0.115, 0.0, 0.074 if not caught else 0.030))
    d = (hi - lo).normalized()
    # the log, with its bark, a ring of cut wood at each end, and two stubs of lopped branches
    q.cyl(7, 0.018, 0.016, lo, hi, WOOD_DARK, rr, 0.05)
    for e, n in ((lo, -d), (hi, d)):
        q.cyl(7, 0.0165, 0.0155, e, e + n * 0.002, (176, 146, 100), rr, 0.03)
    for t, a in ((0.3, 0.6), (0.7, -0.8)):
        p = lo + (hi - lo) * t
        q.cyl(4, 0.004, 0.003, p, p + Vector((0.006, math.sin(a) * 0.022, 0.016)), WOOD_DARK, rr, 0.04)
    # stones laid on it for weight
    for t, s_ in ((0.42, 0.016), (0.62, 0.013)):
        p = lo + (hi - lo) * t + Vector((0, 0, 0.022))
        q.blob(p, (s_, s_ * 0.85, s_ * 0.6), STONE_GREY, rr, 0.08, noise=0.25)
    # the guide stakes, either side of the log, that keep it falling true
    for x in (0.045, 0.100):
        for y in (-0.026, 0.026):
            q.cyl(4, 0.0035, 0.0025, (x, y, -0.006), (x + rr.uniform(-0.004, 0.004), y * 1.1, 0.105), WOOD, rr, 0.05)
    if not caught:
        # the figure-four: an upright, the lever from its notched top to under the log, the bait stick across
        up_b, up_t = Vector((0.080, 0.0, 0.0)), Vector((0.080, 0.0, 0.052))
        q.cyl(4, 0.0026, 0.0024, up_b, up_t, WOOD, rr, 0.04)
        q.cyl(4, 0.0024, 0.0022, (0.052, 0.002, 0.034), (0.118, 0.002, 0.066), WOOD, rr, 0.04)
        q.cyl(4, 0.0022, 0.0020, (0.112, -0.002, 0.012), (0.034, -0.002, 0.020), WOOD, rr, 0.04)
        q.blob((0.040, -0.002, 0.014), (0.008, 0.006, 0.005), BAIT, rr, 0.06)  # the bait
        q.cyl(3, 0.0012, 0.0012, (0.040, -0.002, 0.018), (0.052, 0.002, 0.034), CORD, rr, 0.0, cap=False)
    else:
        # the trigger sticks knocked flat round the log's end
        for a_, b_ in (((0.090, 0.040, 0.003), (0.130, 0.010, 0.003)), ((0.060, -0.042, 0.003), (0.120, -0.036, 0.004)),
                       ((0.020, 0.036, 0.002), (0.074, 0.050, 0.003))):
            q.cyl(4, 0.0022, 0.0020, a_, b_, WOOD, rr, 0.04)
        if caught == "fox":
            # a russet back under the log, the brush out on one side with its white tip, the black hind feet
            q.blob((0.050, 0.004, 0.012), (0.050, 0.030, 0.014), FOX_RED, rr, 0.06)
            sweep(q, [((0.020, 0.030, 0.010), 0.012, 0.011), ((0.000, 0.060, 0.010), 0.014, 0.012),
                      ((-0.020, 0.090, 0.009), 0.012, 0.010), ((-0.030, 0.112, 0.008), 0.007, 0.007)],
                  5, lambda c: FOX_RED, caps=(False, False))
            q.blob((-0.034, 0.120, 0.008), (0.010, 0.012, 0.008), FOX_WHITE, rr, 0.04)
            for y in (-0.012, 0.010):
                q.cyl(4, 0.0040, 0.0030, (0.008, y - 0.020, 0.006), (-0.020, y - 0.040, 0.004), FOX_DARK, rr, 0.04)
        else:
            # a beaver's broad scaly tail out from under the log, and a webbed hind foot
            q.blob((0.050, 0.0, 0.013), (0.050, 0.032, 0.015), BEAVER_FUR, rr, 0.06)
            q.box((0.040, 0.066, 0.006), (0.030, 0.050, 0.006), BEAVER_TAIL, rr, 0.05, rot=Matrix.Rotation(0.2, 3, "Z"))
            q.box((0.000, -0.036, 0.005), (0.016, 0.022, 0.004), BEAVER_TAIL, rr, 0.05, rot=Matrix.Rotation(-0.5, 3, "Z"))


q = Part()
deadfall(q, None)
q.finish("trap__deadfall")
q = Part()
deadfall(q, "fox")
q.finish("trap__deadfallFull")
q = Part()
deadfall(q, "beaver")
q.finish("trap__deadfallBeaver")


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


BERRY = (176, 30, 48)
BERRY_DK = (110, 20, 40)
LEAF = (86, 112, 52)


def basket(q, full):
    """A gathering basket hung from the hand by its handle: grass coiled round a ring of withies, wider
    at the mouth than the foot, a darker rim hoop and a bent-withy handle. Origin at the grip, the top of
    the handle, so it hangs from wherever the hand is; heaped with berries when full."""
    rr = random.Random(51 if full else 50)
    # rings foot to mouth: (z, radius, a binding row)
    rings = [(-0.088, 0.026, False), (-0.084, 0.031, True), (-0.072, 0.035, False), (-0.058, 0.038, False),
             (-0.046, 0.040, True), (-0.034, 0.041, False), (-0.024, 0.042, True), (-0.020, 0.043, True)]
    segs = 12
    bm = q.bm
    loops = [[bm.verts.new((math.cos(k / segs * math.tau) * r, math.sin(k / segs * math.tau) * r * 0.86, z)) for k in range(segs)]
             for z, r, _ in rings]
    for i in range(len(loops) - 1):
        a, b = loops[i], loops[i + 1]
        hoop = rings[i][2] and rings[i + 1][2]
        for k in range(segs):
            f = bm.faces.new((a[k], a[(k + 1) % segs], b[(k + 1) % segs], b[k]))
            # the coils of grass, each row stitched across the one below so the weave staggers
            q.paint([f], WOOD_DARK if hoop else WICKER if (k + i) % 2 else WICKER_DARK, rr, 0.07)
    q.paint([bm.faces.new(list(reversed(loops[0])))], WICKER_DARK, rr, 0.04)  # the foot
    # the inside, a little darker, so the open mouth reads from above
    inner = [bm.verts.new((math.cos(k / segs * math.tau) * 0.039, math.sin(k / segs * math.tau) * 0.039 * 0.86, -0.022)) for k in range(segs)]
    top = loops[-1]
    q.paint([bm.faces.new((top[k], top[(k + 1) % segs], inner[(k + 1) % segs], inner[k])) for k in range(segs)], WOOD_DARK, rr, 0.04)
    floor = -0.034 if full else -0.080
    low = [bm.verts.new((v.co.x * 0.92, v.co.y * 0.92, floor)) for v in inner]
    q.paint([bm.faces.new((inner[k], inner[(k + 1) % segs], low[(k + 1) % segs], low[k])) for k in range(segs)], WICKER_DARK, rr, 0.05)
    q.paint([bm.faces.new(low)], BERRY_DK if full else WICKER_DARK, rr, 0.04)
    # the handle: a withy bent over from side to side, lashed on at the rim
    arc = [Vector((math.cos(t) * 0.040, 0, -0.020 + math.sin(t) * 0.020)) for t in [k / 6 * math.pi for k in range(7)]]
    for a, b in zip(arc, arc[1:]):
        q.cyl(4, 0.0026, 0.0026, a, b, WOOD, rr, 0.03, cap=False)
    for x in (-0.040, 0.040):
        q.cyl(5, 0.0042, 0.0042, (x, 0, -0.026), (x, 0, -0.016), CORD, rr, 0.0, cap=False)
    if full:  # a heap of berries standing proud of the rim, a few leaves picked with them
        for k in range(26):
            a, r = rr.uniform(0, math.tau), math.sqrt(rr.random()) * 0.034
            z = -0.026 + (0.034 - r) * 0.42 + rr.uniform(0, 0.004)
            q.blob((math.cos(a) * r, math.sin(a) * r * 0.86, z), (0.0058, 0.0058, 0.0055), BERRY if k % 4 else BERRY_DK, rr, 0.12, subdiv=1)
        for k in range(4):
            a = k / 4 * math.tau + 0.4
            q.blob((math.cos(a) * 0.024, math.sin(a) * 0.020, -0.016), (0.011, 0.005, 0.0016), LEAF, rr, 0.08)


q = Part()
basket(q, False)
q.finish("carry__basket")
q = Part()
basket(q, True)
q.finish("carry__basketFull")

POT = (150, 102, 66)
POT_DK = (118, 78, 50)
POT_FIRE = (98, 74, 56)   # the dark clouds left where the embers touched it
HIDE_LID = (176, 140, 98)


def pot(q, rr):
    """A clay pot coiled up by hand and fired in the embers: a round belly on a small flat foot, a short
    neck and a rolled rim, the coils still showing as faint ridges, smudged dark where the fire touched
    it; a piece of hide tied over the mouth with cord. Origin at the foot, centred."""
    # rings foot to rim: (z, radius); every other ring a hair proud, so the coils read
    prof = [(0.0, 0.016), (0.004, 0.022), (0.010, 0.027), (0.017, 0.030), (0.024, 0.031), (0.031, 0.030),
            (0.038, 0.027), (0.044, 0.022), (0.048, 0.018), (0.051, 0.017), (0.054, 0.019), (0.056, 0.019)]
    segs = 12
    bm = q.bm
    loops = []
    for i, (z, r) in enumerate(prof):
        bump = 1.03 if 1 <= i <= 8 and i % 2 else 1.0
        loops.append([bm.verts.new((math.cos(k / segs * math.tau) * r * bump, math.sin(k / segs * math.tau) * r * bump, z)) for k in range(segs)])
    smudge = {(rr.randrange(segs), rr.randrange(2, 7)) for _ in range(7)}
    for i in range(len(loops) - 1):
        a, b = loops[i], loops[i + 1]
        for k in range(segs):
            f = bm.faces.new((a[k], a[(k + 1) % segs], b[(k + 1) % segs], b[k]))
            near = any((k == sk or (k - sk) % segs == 1) and i == si for sk, si in smudge)
            q.paint([f], POT_FIRE if near and i < 8 else POT_DK if i % 2 else POT, rr, 0.06)
    q.paint([bm.faces.new(list(reversed(loops[0])))], POT_DK, rr, 0.03)
    # the hide over the mouth, gathered under the rim and tied, its edge hanging in a ruffle
    top = [bm.verts.new((math.cos(k / segs * math.tau) * 0.021, math.sin(k / segs * math.tau) * 0.021, 0.057)) for k in range(segs)]
    skirt = [bm.verts.new((math.cos(k / segs * math.tau) * (0.0225 + 0.003 * (k % 2)), math.sin(k / segs * math.tau) * (0.0225 + 0.003 * (k % 2)), 0.047 - 0.003 * (k % 2))) for k in range(segs)]
    q.paint([bm.faces.new((skirt[k], skirt[(k + 1) % segs], top[(k + 1) % segs], top[k])) for k in range(segs)], HIDE_LID, rr, 0.05)
    centre = bm.verts.new((0, 0, 0.060))
    q.paint([bm.faces.new((top[k], top[(k + 1) % segs], centre)) for k in range(segs)], HIDE_LID, rr, 0.04)
    q.cyl(segs, 0.0195, 0.0195, (0, 0, 0.0505), (0, 0, 0.0525), CORD, rr, 0.0, cap=False)  # the tie under the rim


q = Part()
pot(q, random.Random(52))
q.finish("pile__pot")

# ---------------------------------------------------------------- the boat the first band lands in
HULL = (112, 80, 52)        # the outside of the log, adzed smooth and weathered
HULL_WET = (74, 56, 40)     # darkened along and below the waterline
HULL_IN = (150, 112, 72)    # fresh-cut wood inside
HULL_CHAR = (98, 74, 54)    # where it was hollowed out with fire, scraped but still dark
GUNWALE = (132, 98, 62)


def dugout(q, rr):
    """A dugout canoe hollowed from one long trunk: a rounded hull a little flat on the bottom, the
    sheer rising to a blunt, upturned bow and stern left solid, two ribs of the log left standing across
    the hollow, the inside paler and smudged dark where it was burnt out. Ten sit in it in pairs.
    Origin at the waterline, midships; the bow points -Y (= +Z in the game, the way it goes).
    The floor of the hollow is at the waterline; the game floats it a little higher, so the sides show
    well above the water and none of the sea shows inside it."""
    L2 = 1.25            # half its length
    B = 0.31             # half its beam
    WALL = 0.032
    NS, N = 24, 10       # stations along, points round each half-ring
    bm = q.bm

    def shape(u):
        a = abs(u)
        half = B * max(0.0, 1 - a ** 2.4) ** 0.55 + 0.012
        bot = -0.07 + 0.11 * a ** 3.2
        top = 0.13 + 0.07 * a ** 4
        return half, bot, top

    def ring(y, half, bot, top):
        pts = []
        for k in range(N + 1):
            ph = math.pi * k / N
            x = -half * math.cos(ph)
            z = top - (top - bot) * math.sin(ph) ** 0.55
            pts.append(bm.verts.new((x, y, z)))
        return pts

    us = [-1 + 2 * i / NS for i in range(NS + 1)]
    O = [ring(u * L2, *shape(u)) for u in us]
    for i in range(NS):
        for k in range(N):
            f = bm.faces.new((O[i][k], O[i][k + 1], O[i + 1][k + 1], O[i + 1][k]))
            zc = f.calc_center_median().z
            q.paint([f], HULL_WET if zc < 0.012 else HULL, rr, 0.05)
    for e in (0, NS):  # the blunt end grain, bow and stern
        q.paint([bm.faces.new(O[e] if e else list(reversed(O[e])))], HULL_WET, rr, 0.04)
    # the hollow: from i0 to i1, the ends left solid
    i0, i1 = 3, NS - 3
    I = {}
    for i in range(i0, i1 + 1):
        half, bot, top = shape(us[i])
        I[i] = ring(us[i] * L2, half - WALL, max(bot + 0.05, 0.0), top)
    for i in range(i0, i1):
        for k in range(N):
            f = bm.faces.new((I[i][k], I[i + 1][k], I[i + 1][k + 1], I[i][k + 1]))
            c = f.calc_center_median()
            burnt = rr.random() < 0.12 and c.z < 0.06
            q.paint([f], HULL_CHAR if burnt else HULL_IN, rr, 0.07)
        for k in (0, N):  # the gunwale tops
            f = bm.faces.new((O[i][k], O[i + 1][k], I[i + 1][k], I[i][k]))
            q.paint([f], GUNWALE, rr, 0.04)
    for e, n in ((i0, -1), (i1, 1)):  # the end walls of the hollow, and the solid decks beyond them
        q.paint([bm.faces.new(I[e])], HULL_IN, rr, 0.05)
        for i in (range(0, i0 - 1) if n < 0 else range(i1 + 1, NS)):
            q.paint([bm.faces.new((O[i][0], O[i][N], O[i + 1][N], O[i + 1][0]))], GUNWALE, rr, 0.04)
        j = e + n  # the station just outside the hollow
        q.paint([bm.faces.new((O[j][0], O[j][N], I[e][N], I[e][0]))], GUNWALE, rr, 0.04)
        q.paint([bm.faces.new((O[j][0], O[e][0], I[e][0]))], GUNWALE, rr, 0.04)
        q.paint([bm.faces.new((O[j][N], I[e][N], O[e][N]))], GUNWALE, rr, 0.04)
    # two ribs of the log left standing across the hollow, between the pairs who sit
    for y in (-0.17, 0.43):
        half, bot, top = shape(y / L2)
        q.box((0, y, (max(bot + 0.05, 0.0) + top - 0.04) / 2), (2 * (half - WALL) - 0.01, 0.035, top - 0.04 - max(bot + 0.05, 0.0)), HULL_IN, rr, 0.05)
    # what they brought: firewood bundled at the stern, a hide-wrapped bundle and a pot at the bow
    for k in range(5):
        x = -0.11 + k * 0.055
        z = 0.025 + (k % 2) * 0.03
        q.cyl(6, 0.022, 0.02, (x, 0.74, z), (x + rr.uniform(-0.01, 0.01), 0.9, z + 0.01), BARK, rr, 0.06)
    q.cyl(6, 0.004, 0.004, (-0.15, 0.82, 0.06), (0.15, 0.82, 0.06), CORD, rr, 0.0)
    q.blob((-0.05, -0.85, 0.045), (0.09, 0.065, 0.05), HIDE_CARRY, rr, 0.06, noise=0.12)
    q.cyl(6, 0.004, 0.004, (-0.14, -0.85, 0.08), (0.04, -0.85, 0.08), CORD, rr, 0.0)
    for v in q.blob((0, 0, 0), (0.04, 0.04, 0.045), POT, rr, 0.06):
        v.co += Vector((0.12, -0.84, 0.035))
    # paddles laid along inside each side, blades to the stern
    for s_ in (-1, 1):
        x = s_ * 0.21
        q.cyl(5, 0.008, 0.008, (x, -0.5, 0.105), (x, 0.24, 0.1), WOOD, rr, 0.03)
        q.box((x, 0.32, 0.098), (0.05, 0.16, 0.008), WOOD, rr, 0.04, rot=Matrix.Rotation(s_ * 0.25, 3, "Y"))


q = Part()
dugout(q, random.Random(60))
q.finish("boat__dugout")

# ---------------------------------------------------------------- buildings
STONE = (128, 122, 114)
WATTLE = (132, 100, 64)
THATCH = (196, 164, 96)
THATCH_DK = (160, 128, 72)
POLE = (104, 78, 52)
HIDE = (168, 132, 96)

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


# a hide cloak: a cape over the shoulders and down the back to below the belt, tied at the throat and
# open down the front. Only those who have one wear it (the game hides it on the rest).
# Its colour code is part skin, part leather, so each hide comes out a warm tan.
CLOAK_CODE = (0, 179, 0)  # (0, 0.45, 0) once linearised: 45% skin, the rest leather
q = Part()
CZ = [0.158, 0.180, 0.205, 0.232, 0.256, 0.272, 0.283, 0.290]


def torso_at(z):
    for (z0, *a0), (z1, *a1) in zip(TORSO, TORSO[1:]):
        if z0 <= z <= z1:
            t = (z - z0) / (z1 - z0)
            return [u + (v - u) * t for u, v in zip(a0, a1)]
    return list(TORSO[-1][1:])


def cape_row(i, z, out):
    rx, yf, yb = torso_at(min(z, 0.288))
    up = i / (len(CZ) - 1)
    # wide over the shoulders and hanging clear of the body below them; the front opens wider lower down
    flare = 0.010 + 0.010 * (1 - up) + (0.012 if 0.6 < up < 0.95 else 0.0)
    gap = 1.25 - 1.0 * up ** 0.7
    n = 14
    row = []
    for k in range(n + 1):
        t = -math.pi / 2 + gap + k / n * (math.tau - 2 * gap)
        c, s_ = math.cos(t), math.sin(t)
        hem = -0.006 * (k % 2) if i == 0 else 0.0  # a ragged hem
        r = flare + out
        row.append((sqv(c) * (rx + r), sqv(s_) * ((yb if s_ > 0 else yf) + r * 0.8), z + hem))
    return row


top = [cape_row(i, z, 0.0) for i, z in enumerate(CZ)]
bot = [cape_row(i, z, -0.0035) for i, z in enumerate(CZ)]
shell(q, top, bot, lambda i, k: CLOAK_CODE, lambda i, k: CLOAK_CODE, CLOAK_CODE, None)
# the cord at the throat
q.box((0, -0.026, 0.284), (0.012, 0.004, 0.004), DARK, raw=True)
q.finish("villager__cloak")

# a fur cloak: fox and beaver pelts sewn fur-out into a mantle, longer and thicker than the hide cloak, with a
# collar of pale fox-belly fur and a fox's brush hanging down the back. Unlike the other worn things it is
# painted in its own colours (the game shows it as painted, not in the wearer's colours).
FUR_FOX = (184, 92, 44)
FUR_FOX_DK = (150, 70, 34)
FUR_BEAVER = (108, 74, 48)
FUR_BEAVER_DK = (86, 58, 38)
FUR_PALE_C = (226, 214, 190)
FUR_INSIDE = (164, 128, 90)
q = Part()
rr = random.Random(91)
CZ3 = [0.128, 0.150, 0.176, 0.204, 0.232, 0.256, 0.272, 0.284, 0.292]


def fur_row(i, z, out):
    row = cape_row(min(i, len(CZ) - 1), z, out + 0.005)
    if i == 0:  # a hem of pelt edges, uneven
        row = [(x, y, z_ - 0.010 * ((k * 5) % 3) / 2) for k, (x, y, z_) in enumerate(row)]
    return row


def pelt(i, k):
    if i >= len(CZ3) - 3:
        return FUR_PALE_C  # the collar
    fox = ((i // 2) + (k // 3)) % 2 == 0
    dark = (i + k) % 3 == 0
    return (FUR_FOX_DK if dark else FUR_FOX) if fox else (FUR_BEAVER_DK if dark else FUR_BEAVER)


top = [fur_row(i, z, 0.0) for i, z in enumerate(CZ3)]
bot = [fur_row(i, z, -0.006) for i, z in enumerate(CZ3)]
shell(q, top, bot, pelt, lambda i, k: FUR_INSIDE, FUR_FOX_DK, rr, 0.06)
q.box((0, -0.030, 0.284), (0.012, 0.005, 0.005), (70, 52, 36), rr, 0.0)  # the thong at the throat
# a fox's brush down the back from the collar, its white tip at the hem
_, yb, _ = torso_at(0.20)
sweep(q, [((0, yb + 0.022, 0.262), 0.007, 0.006), ((0, yb + 0.026, 0.220), 0.010, 0.008), ((0, yb + 0.026, 0.176), 0.010, 0.008),
          ((0, yb + 0.022, 0.140), 0.007, 0.006)], 5, lambda c: FUR_FOX, caps=(True, False))
q.blob((0, yb + 0.021, 0.132), (0.007, 0.006, 0.012), FUR_PALE_C, rr, 0.03)
q.finish("villager__furcloak")

# a fur hat: a cap of hide over the hair with a rolled fur brim. Shown only on those who wear one.
HAT_CODE = (0, 0.42, 0.22)   # hide with the fur showing: part skin, part hair colour
FUR_CODE = (0, 0.22, 0.55)
q = Part()
hn = 14
hts = [-math.pi / 2 + (k + 0.5) / hn * math.tau for k in range(hn)]
hzs = [0.337, 0.346, 0.356, 0.364, 0.370]
hrows = []
for j, z in enumerate(hzs):
    g = 0.0105 - j * 0.0008
    row = []
    for t in hts:
        p_ = on_skull(z, t, g)
        p_.z += j * 0.0012
        row.append(p_)
    hrows.append(row)
tuck = [on_skull(0.339, t, -0.002) for t in hts]
vs, _ = grid(q, [tuck] + hrows, lambda i, k: HAT_CODE if i else FUR_CODE)
fan(q, vs[-1], (0, HEAD_Y + 0.002, HEAD_TOP + 0.014), HAT_CODE)
brim = [[on_skull(0.335, t, 0.0125) for t in hts], [on_skull(0.341, t, 0.0145) for t in hts], [on_skull(0.347, t, 0.0118) for t in hts]]
grid(q, brim, lambda i, k: FUR_CODE)
q.finish("villager__hat")

# a reed cape: shorter than the cloak and stiffer, the reeds knotted in rows, a ragged hem. Pale straw.
STRAW_CODE = (0, 0.86, 0)
STRAW_DK = (0, 0.68, 0.08)
q = Part()
CZ2 = [0.178, 0.198, 0.220, 0.242, 0.262, 0.276, 0.286, 0.292]


def reed_row(i, z, out):
    row = cape_row(i, z, out + 0.004)
    if i == 0:  # the hem: reed ends of every length
        row = [(x, y, z_ - 0.008 * ((k * 7) % 3) / 2) for k, (x, y, z_) in enumerate(row)]
    return row


top = [reed_row(i, z, 0.0) for i, z in enumerate(CZ2)]
bot = [reed_row(i, z, -0.004) for i, z in enumerate(CZ2)]
shell(q, top, bot, lambda i, k: STRAW_CODE if i % 2 else STRAW_DK, lambda i, k: STRAW_DK, STRAW_DK, None)
q.box((0, -0.028, 0.286), (0.012, 0.004, 0.004), DARK, raw=True)
q.finish("villager__cape")

# a hide bag at the right hip, its strap over the left shoulder
BAG_CODE = (0, 0.3, 0)
STRAP_CODE = (0, 0.12, 0)
q = Part()
q.box((0.064, -0.002, 0.140), (0.016, 0.036, 0.034), BAG_CODE, raw=True, taper=0.85)
q.box((0.064, -0.002, 0.160), (0.017, 0.038, 0.008), STRAP_CODE, raw=True)  # the flap
for a_, b_ in (((0.060, -0.020, 0.158), (-0.030, -0.052, 0.276)), ((0.060, 0.016, 0.158), (-0.030, 0.050, 0.276)),
               ((-0.030, -0.052, 0.276), (-0.034, 0.0, 0.292)), ((-0.034, 0.0, 0.292), (-0.030, 0.050, 0.276))):
    q.cyl(4, 0.0032, 0.0032, a_, b_, STRAP_CODE, raw=True)
q.finish("villager__bag")


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

q = Part()  # fresh grass bedding, shaken out over the old under the lean-to (shown while it is fresh)
rnd = random.Random(88)
STRAW = (196, 182, 112)
STRAW_GN = (160, 168, 92)
for k in range(46):
    x, y = rnd.uniform(-0.22, 0.22), rnd.uniform(0.03, 0.18)
    a = rnd.uniform(0, math.pi)
    L = rnd.uniform(0.07, 0.13)
    d = Vector((math.cos(a) * L / 2, math.sin(a) * L / 2, 0))
    z = 0.034 + rnd.uniform(0, 0.012)
    q.cyl(3, 0.0035, 0.0025, Vector((x, y, z)) - d, Vector((x, y, z + rnd.uniform(0, 0.008))) + d, STRAW if k % 3 else STRAW_GN, rnd, 0.1, cap=False)
for k in range(5):  # a few loose heaps of it
    q.blob((-0.18 + k * 0.09 + rnd.uniform(-0.02, 0.02), 0.1 + rnd.uniform(-0.03, 0.03), 0.034), (0.05, 0.05, 0.014), STRAW, rnd, 0.1, noise=0.3)
q.finish("bld__bedding")


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


# ---------------------------------------------------------------- the gardens
# A garden plot is one tile of ground cleared and turned into ridges, five across the tile (along x), with a
# low edge of cut turf. It comes in the looks a plot has through the year: bare (just dug, or lying fallow),
# sown, set with roots in leaf, young green grain, ripe grain, and the stubble after the reaping with a few
# stooks left to dry. Each sits on the ground at z = 0 and fills the tile (+-0.46).
SOIL = (94, 72, 52)
SOIL_DK = (74, 56, 40)
SOIL_LT = (118, 92, 66)
TURF = (96, 112, 60)
SPROUT = (126, 168, 76)
GRAIN_GREEN = (104, 148, 62)
GRAIN_GREEN_DK = (82, 122, 50)
RIPE = (214, 180, 96)
RIPE_DK = (186, 150, 78)
RIPE_EAR = (204, 160, 80)
STUBBLE = (196, 174, 120)
RIDGES = [-0.34, -0.17, 0.0, 0.17, 0.34]
HALF = 0.44


def plot_bed(q, rnd, dry=False):
    """The turned ground: a flat bed of earth, five ridges with furrows between, clods, and a turf edge."""
    q.box((0, 0, 0.002), (HALF * 2, HALF * 2, 0.008), SOIL_DK, rnd, 0.04)
    for y in RIDGES:
        segs = 6
        for k in range(segs):  # each ridge in short lengths, a little uneven, as dug by hand
            x0 = -HALF + 0.03 + k * (2 * HALF - 0.06) / segs
            w = (2 * HALF - 0.06) / segs
            q.box((x0 + w / 2, y + rnd.uniform(-0.006, 0.006), 0.016), (w * 1.04, 0.11 + rnd.uniform(-0.01, 0.01), 0.026 + rnd.uniform(-0.004, 0.006)),
                  jit(SOIL_LT if dry else SOIL, rnd, 0.08), rnd, 0.06, taper=0.45)
    for k in range(18):  # clods turned up along the ridges
        y = rnd.choice(RIDGES) + rnd.uniform(-0.04, 0.04)
        q.blob((rnd.uniform(-HALF + 0.05, HALF - 0.05), y, 0.026), (0.014, 0.011, 0.008), jit(SOIL_DK, rnd, 0.1), rnd, 0.08, noise=0.3)
    for side in range(4):  # the turf cut from the plot, laid along its edge
        for k in range(7):
            t = -HALF + (k + 0.5) * 2 * HALF / 7
            x, y = (t, -HALF) if side == 0 else (t, HALF) if side == 1 else (-HALF, t) if side == 2 else (HALF, t)
            sx, sy = (0.12, 0.035) if side < 2 else (0.035, 0.12)
            q.box((x, y, 0.01), (sx, sy, 0.02), jit(TURF, rnd, 0.1), rnd, 0.06, taper=0.8)


def along_ridges(rnd, per, jitter=0.03):
    """Points along the ridge crests: per ridge, evenly spaced and a little off true."""
    for y in RIDGES:
        for k in range(per):
            x = -HALF + 0.07 + k * (2 * HALF - 0.14) / max(1, per - 1)
            yield x + rnd.uniform(-jitter, jitter) * 0.5, y + rnd.uniform(-jitter, jitter) * 0.4


def blade(q, base, h, lean, col, rnd, w=0.0035):
    """One leaf of grass or grain: a thin tapered stalk leaning a little."""
    a = rnd.uniform(0, math.tau)
    tip = Vector(base) + Vector((math.cos(a) * lean, math.sin(a) * lean, h))
    q.cyl(3, w, 0.0008, base, tip, col, rnd, 0.08, cap=False)
    return tip


q = Part()  # bare: just dug, or lying fallow, a digging stick left stuck in the end of a ridge
rnd = random.Random(60)
plot_bed(q, rnd)
q.cyl(4, 0.006, 0.005, (0.4, 0.3, -0.01), (0.37, 0.27, 0.2), POLE, rnd)
q.finish("bld__plot")

q = Part()  # sown: the ridges raked fine, a line of shoots just through along each crest
rnd = random.Random(61)
plot_bed(q, rnd, dry=True)
for x, y in along_ridges(rnd, 12):
    for t in range(2):
        blade(q, (x + t * 0.008, y, 0.028), 0.018 + rnd.uniform(0, 0.012), 0.004, SPROUT, rnd, 0.0025)
q.finish("bld__plotSown")

q = Part()  # roots in leaf: a clump of broad leaves over each root, in rows along the ridges
rnd = random.Random(62)
plot_bed(q, rnd)
for x, y in along_ridges(rnd, 7, 0.04):
    for t in range(5):
        a = t / 5 * math.tau + rnd.uniform(-0.3, 0.3)
        c = Vector((x + math.cos(a) * 0.022, y + math.sin(a) * 0.02, 0.05 + rnd.uniform(-0.008, 0.012)))
        q.cyl(3, 0.003, 0.002, (x, y, 0.028), c, (110, 140, 70), rnd, 0.06, cap=False)
        m = Matrix.Rotation(a, 3, "Z") @ Matrix.Rotation(-0.45, 3, "Y")
        for v in q.blob((0, 0, 0), (0.024, 0.015, 0.004), rnd.choice((GLEAF, GLEAF_DK, GLEAF_LT)), rnd, 0.06, noise=0.12):
            v.co = c + m @ v.co
    q.blob((x, y, 0.03), (0.012, 0.012, 0.008), (196, 170, 128), rnd, 0.06)  # the top of the root, showing
q.finish("bld__plotRoots")

q = Part()  # young grain: thick green blades a hand high along every ridge
rnd = random.Random(63)
plot_bed(q, rnd)
for x, y in along_ridges(rnd, 9, 0.02):  # tufts of leaves along each ridge, the blades rising out of them
    q.blob((x, y, 0.034), (0.055, 0.03, 0.018), jit(GRAIN_GREEN_DK if rnd.random() < 0.5 else GRAIN_GREEN, rnd, 0.06), rnd, 0.06, noise=0.3)
for x, y in along_ridges(rnd, 14):
    for t in range(4):
        blade(q, (x + rnd.uniform(-0.012, 0.012), y + rnd.uniform(-0.02, 0.02), 0.026), 0.05 + rnd.uniform(0, 0.025), 0.012,
              GRAIN_GREEN if t % 2 else GRAIN_GREEN_DK, rnd, 0.004)
q.finish("bld__plotGrain")

q = Part()  # ripe grain: knee-high golden stalks standing thick, the heavy ears nodding all one way in the wind
rnd = random.Random(64)
plot_bed(q, rnd, dry=True)
for x, y in along_ridges(rnd, 10, 0.02):  # the standing grain seen as a mass, uneven, with the stalks and ears over it
    q.blob((x, y, 0.055), (0.05, 0.05, 0.05), jit(RIPE_DK, rnd, 0.06), rnd, 0.06, noise=0.3)
    q.blob((x + 0.01, y, 0.098), (0.042, 0.04, 0.016), jit(RIPE_EAR, rnd, 0.06), rnd, 0.06, noise=0.35)
for x, y in along_ridges(rnd, 15):
    for t in range(4):
        base = Vector((x + rnd.uniform(-0.014, 0.014), y + rnd.uniform(-0.03, 0.03), 0.026))
        top = base + Vector((0.014 + rnd.uniform(-0.006, 0.01), rnd.uniform(-0.006, 0.006), 0.1 + rnd.uniform(0, 0.03)))
        q.cyl(3, 0.0028, 0.0018, base, top, jit(RIPE if t % 2 else RIPE_DK, rnd, 0.06), rnd, 0.0, cap=False)
        q.box(top + Vector((0.008, 0, -0.004)), (0.022, 0.006, 0.006), jit(RIPE_EAR, rnd, 0.08), rnd, 0.06,
              rot=Matrix.Rotation(-0.6, 3, "Y"), taper=0.5)
q.finish("bld__plotRipe")

q = Part()  # after the reaping: short stubble on the ridges, and three stooks of sheaves leaned together to dry
rnd = random.Random(65)
plot_bed(q, rnd, dry=True)
for x, y in along_ridges(rnd, 13):
    for t in range(3):
        blade(q, (x + rnd.uniform(-0.014, 0.014), y + rnd.uniform(-0.03, 0.03), 0.026), 0.012 + rnd.uniform(0, 0.008), 0.002, STUBBLE, rnd, 0.0025)
for sx, sy in ((-0.22, -0.08), (0.06, 0.1), (0.28, -0.2)):
    for k in range(6):  # sheaves stood on their butts, heads together at the top
        a = k / 6 * math.tau + rnd.uniform(-0.15, 0.15)
        foot = Vector((sx + math.cos(a) * 0.05, sy + math.sin(a) * 0.05, 0.02))
        top = Vector((sx + math.cos(a) * 0.012, sy + math.sin(a) * 0.012, 0.15))
        q.cyl(5, 0.016, 0.011, foot, top, jit(RIPE, rnd, 0.06), rnd, 0.04)
        q.cyl(6, 0.0125, 0.0125, foot.lerp(top, 0.55) - Vector((0, 0, 0.004)), foot.lerp(top, 0.55) + Vector((0, 0, 0.004)), RIPE_DK, rnd, 0.03, cap=False)
        for v in q.blob((0, 0, 0), (0.016, 0.012, 0.022), jit(RIPE_EAR, rnd, 0.08), rnd, 0.06):
            v.co = top + Vector((math.cos(a) * 0.006, math.sin(a) * 0.006, 0.016)) + v.co
q.finish("bld__plotStubble")

# the garden fence: a hurdle of stakes and woven withies round the edge of the plot, knee high, the sides
# leaning a little, a gap at the front (-y) closed with a hurdle propped across it
q = Part()
rnd = random.Random(66)
FH = 0.15
FR = 0.48


def hurdle(q, a, b, rnd, h=FH, n=7):
    """A straight run of wattle from a to b: stakes driven in, withies woven between them in courses."""
    a, b = Vector(a), Vector(b)
    stakes = [a.lerp(b, k / n) for k in range(n + 1)]
    for p in stakes:
        q.cyl(4, 0.0075, 0.006, p + Vector((0, 0, -0.01)), p + Vector((rnd.uniform(-0.004, 0.004), rnd.uniform(-0.004, 0.004), h + 0.02 + rnd.uniform(0, 0.015))), POLE, rnd, 0.06)
    d = (b - a).normalized()
    side = Vector((-d.y, d.x, 0))
    for j in range(5):
        z = 0.02 + j * (h - 0.02) / 5
        for k in range(n):
            off = side * (0.006 if (k + j) % 2 else -0.006)
            q.cyl(3, 0.0045, 0.0045, stakes[k] + off + Vector((0, 0, z)), stakes[k + 1] - off + Vector((0, 0, z)), jit(WATTLE, rnd, 0.08), rnd, 0.0, cap=False)


hurdle(q, (-FR, FR, 0), (FR, FR, 0), rnd)
hurdle(q, (-FR, -FR, 0), (-FR, FR, 0), rnd)
hurdle(q, (FR, -FR, 0), (FR, FR, 0), rnd)
hurdle(q, (-FR, -FR, 0), (-0.1, -FR, 0), rnd, n=5)
hurdle(q, (0.1, -FR, 0), (FR, -FR, 0), rnd, n=5)
# the gate: a loose hurdle leaned across the gap
hurdle(q, (-0.13, -FR - 0.03, 0.0), (0.13, -FR - 0.03, 0.0), rnd, h=FH * 0.9, n=3)
for x in (-0.1, 0.1):  # the posts either side of the gap, taller
    q.cyl(5, 0.011, 0.009, (x, -FR, -0.01), (x, -FR, FH + 0.06), POLE, rnd)
q.finish("bld__fence")

# a storage pit by the stores: a round pit lined with clay and grass, filled with grain and capped with a dome
# of daub over grass, a flat stone and a hide weighted with stones; a clay rim round it, a basket beside
q = Part()
rnd = random.Random(67)
DAUB_DRY = (156, 128, 96)
rim = [[at(r * (1 + rnd.uniform(-0.03, 0.03)), k / 14 * math.tau, z) for k in range(14)] for r, z in ((0.26, 0.0), (0.24, 0.03), (0.2, 0.036), (0.17, 0.03))]
ring_loft(q, rim, lambda i, k: CLAY if i < 2 else CLAY_WET, rnd, 0.08)
dome = [[at(r, k / 14 * math.tau, z) for k in range(14)] for r, z in ((0.17, 0.03), (0.16, 0.06), (0.12, 0.085), (0.06, 0.098))]
vs = ring_loft(q, dome, lambda i, k: jit(DAUB_DRY, rnd, 0.06), rnd, 0.06)
fan(q, vs[-1], (0, 0, 0.1), DAUB_DRY, raw=False)
for k in range(12):  # grass sticking out from under the daub cap
    a = k / 12 * math.tau + rnd.uniform(-0.1, 0.1)
    q.cyl(3, 0.003, 0.001, at(0.165, a, 0.035), at(0.21 + rnd.uniform(0, 0.02), a, 0.028 + rnd.uniform(0, 0.012)), GRASS, rnd, 0.08, cap=False)
q.box((0.0, 0.0, 0.106), (0.12, 0.1, 0.014), jit(STONE, rnd, 0.08), rnd, 0.06, rot=Matrix.Rotation(0.3, 3, "Z"), taper=0.85)  # the lid stone
for k in range(6):  # stones round the rim, to hold down the hide over the cap in the rain
    a = k / 6 * math.tau + 0.3
    q.blob(at(0.22, a, 0.042), (0.03, 0.024, 0.02), rnd.choice(STONES), rnd, 0.05, noise=0.2)
for v in q.blob((0, 0, 0), (0.06, 0.06, 0.05), (168, 132, 82), rnd, 0.05):  # a basket left by it, for carrying the grain out
    v.co += Vector((0.3, -0.18, 0.05))
q.blob((0.3, -0.18, 0.1), (0.05, 0.05, 0.012), RIPE_EAR, rnd, 0.06)
q.finish("bld__pit")

rnd = random.Random(20)
ASH = (150, 146, 140)
CHARRED = (44, 38, 34)
EMBER = (232, 112, 40)
SOOT = (70, 64, 60)
q = Part()  # hearth: a ring of fire-cracked stones bedded in the ground, blackened on the inside; a bed of
for k in range(11):  # ash with a charred heart; logs laid in a star, burnt at the inner ends with embers in
    a = k / 11 * math.tau + rnd.uniform(-0.08, 0.08)  # the cracks; a spit on forked sticks; firewood to hand
    r = 0.205 + rnd.uniform(-0.01, 0.01)
    c = Vector((math.cos(a) * r, math.sin(a) * r, 0.018))
    size = (0.038 + rnd.uniform(0, 0.014), 0.03 + rnd.uniform(0, 0.012), 0.026 + rnd.uniform(0, 0.012))
    m = Matrix.Rotation(a, 3, "Z")
    for v in q.blob((0, 0, 0), size, jit(STONE, rnd, 0.12), rnd, 0.06, noise=0.2):
        v.co = c + m @ Vector((v.co.y, v.co.x, v.co.z))
for f in q.bm.faces:  # soot on the faces turned to the fire
    cen = f.calc_center_median()
    if cen.length > 0.05 and f.normal.dot(Vector((-cen.x, -cen.y, 0)).normalized()) > 0.3 and cen.z > 0.012:
        q.paint([f], SOOT, rnd, 0.06)
ash = [[at(r * (1 + rnd.uniform(-0.04, 0.04)), k / 12 * math.tau, z) for k in range(12)] for r, z in ((0.185, 0.002), (0.12, 0.009), (0.05, 0.012))]
vs = ring_loft(q, ash, lambda i, k: ASH if i == 0 else (120, 116, 110), rnd, 0.06)
fan(q, vs[-1], (0, 0, 0.012), CHARRED, raw=False)
for k in range(5):  # logs in a star, burnt down at the middle
    a = k / 5 * math.tau + 0.4 + rnd.uniform(-0.1, 0.1)
    outer, inner = Vector(at(0.2, a, 0.022)), Vector(at(0.04, a, 0.05))
    mid = outer.lerp(inner, 0.55)
    q.cyl(6, 0.02, 0.019, outer, mid, BARK, rnd, 0.05)
    q.cyl(6, 0.019, 0.014, mid, inner, CHARRED, rnd, 0.05)
    q.box(mid.lerp(inner, 0.5) + Vector((0, 0, 0.012)), (0.012, 0.008, 0.004), EMBER, rnd, 0.1, rot=Matrix.Rotation(a, 3, "Z"))
for s_ in (-1, 1):  # forked sticks and a spit across
    forked_post(q, (s_ * 0.27, 0.04, 0), (s_ * 0.27, 0.04, 0.21), rnd, r=0.008)
q.cyl(5, 0.006, 0.006, (-0.31, 0.04, 0.232), (0.31, 0.04, 0.232), POLE, rnd)
for k in range(4):  # firewood stacked ready, behind the ring
    y = 0.31 + (k % 2) * 0.045
    z = 0.02 + (k // 2) * 0.036
    q.cyl(6, 0.02, 0.018, (-0.13, y + (k // 2) * 0.022, z), (0.13, y + (k // 2) * 0.022, z), BARK, rnd, 0.05)
q.finish("bld__hearth")

rnd = random.Random(41)
MEAT_DRY = (104, 56, 44)
FISH_DRY = (184, 170, 140)
q = Part()  # drying rack: two splayed A-frames lashed at the top, two cross poles, strips of meat and split
for x in (-0.26, 0.26):  # fish hung over them to dry in the smoke of a smouldering pit underneath
    for y in (-0.12, 0.12):
        q.cyl(4, 0.011, 0.009, (x + 0.02 * (1 if x > 0 else -1), y, 0), (x, 0, 0.35), POLE, rnd)
    q.cyl(6, 0.014, 0.014, (x, 0, 0.32), (x, 0, 0.336), ROPE, rnd, 0.03, cap=False)  # the lashing
q.cyl(5, 0.01, 0.009, (-0.32, 0, 0.345), (0.32, 0, 0.345), POLE, rnd)
for y in (-0.06, 0.06):
    q.cyl(4, 0.008, 0.007, (-0.3, y, 0.22), (0.3, y, 0.22), POLE, rnd)
for k in range(7):  # meat in strips over the top pole
    x = -0.21 + k * 0.07 + rnd.uniform(-0.01, 0.01)
    for sy in (-1, 1):
        q.box((x, sy * 0.008, 0.3 + rnd.uniform(-0.012, 0.012)), (0.02 + rnd.uniform(0, 0.008), 0.006, 0.08), jit(MEAT_DRY, rnd, 0.12), rnd, 0.08,
              rot=Matrix.Rotation(sy * 0.15, 3, "X") @ Matrix.Rotation(rnd.uniform(-0.12, 0.12), 3, "Y"), taper=0.7)
for y in (-0.06, 0.06):  # fish split open and hung by the tail from the lower poles
    for k in range(4):
        x = -0.19 + k * 0.125 + rnd.uniform(-0.01, 0.01)
        q.box((x, y, 0.17), (0.034, 0.006, 0.09), FISH_DRY, rnd, 0.06, taper=0.45)
        q.box((x, y, 0.218), (0.03, 0.004, 0.012), (150, 140, 120), rnd, 0.0)  # the tail
for k in range(6):  # the smoke pit: a shallow ring of stones round a smoulder of green wood
    a = k / 6 * math.tau
    q.blob(at(0.085, a, 0.012), (0.026, 0.022, 0.018), jit(STONE, rnd, 0.1), rnd, 0.06, noise=0.2)
q.cyl(8, 0.07, 0.07, (0, 0, 0), (0, 0, 0.008), ASH, rnd, 0.05)
q.blob((0, 0, 0.014), (0.045, 0.04, 0.012), (78, 84, 52), rnd, 0.1, noise=0.3)  # damp leaves for smoke
q.finish("bld__rack")

rnd = random.Random(43)
REED = (176, 150, 96)
REED_DK = (162, 136, 86)
q = Part()  # stockpile: a woven reed mat for food at the front, bound at the edges; at the back two sleepers
mx, my = 0.26, 0.14   # to keep the woodstack off the ground, held in by four stakes
rows = [[(-mx + 2 * mx * k / 12, -0.13 - my + 2 * my * i / 6, 0.008) for k in range(13)] for i in range(7)]
bot = [[(x, y, 0.001) for x, y, _ in row] for row in rows]
shell(q, rows, bot, lambda i, k: REED if (i + k) % 2 else REED_DK, lambda i, k: REED_DK, (120, 96, 60), rnd, 0.06)
for y in (-0.13 - my, -0.13 + my):  # bound edges
    q.cyl(5, 0.007, 0.007, (-mx, y, 0.006), (mx, y, 0.006), ROPE, rnd, 0.03)
for sx in (-0.12, 0.12):
    q.cyl(5, 0.013, 0.013, (sx, 0.115, 0.013), (sx, 0.325, 0.013), BARK, rnd, 0.04)
for sx in (-0.215, 0.215):
    for sy in (0.14, 0.30):
        q.cyl(4, 0.009, 0.007, (sx, sy, -0.01), (sx + (0.012 if sx > 0 else -0.012), sy, 0.21), POLE, rnd, 0.05)
    q.cyl(3, 0.0035, 0.0035, (sx * 1.03, 0.14, 0.19), (sx * 1.03, 0.30, 0.19), ROPE, rnd, 0.0)  # tied across the tops
q.finish("bld__stockpile")

q = Part()  # one split log of firewood, for stacking on the stockpile: bark round, the pale split face up
segs = 7
bm = q.bm
ends = []
for x in (-0.19, 0.19):
    ring = [bm.verts.new((x, math.cos(math.pi * k / (segs - 1)) * 0.021, -math.sin(math.pi * k / (segs - 1)) * 0.021 + 0.004)) for k in range(segs)]
    ends.append(ring)
for k in range(segs - 1):
    q.paint([bm.faces.new((ends[0][k], ends[0][k + 1], ends[1][k + 1], ends[1][k]))], jit(BARK, rnd, 0.06), rnd, 0.05)
q.paint([bm.faces.new((ends[0][-1], ends[0][0], ends[1][0], ends[1][-1]))], (196, 160, 112), rnd, 0.04)  # the split face
q.paint([bm.faces.new(list(reversed(ends[0]))), bm.faces.new(ends[1])], (186, 150, 104), rnd, 0.03)
q.finish("pile__log")

rnd = random.Random(42)
q = Part()  # building site: poles laid ready across two sleepers, a bundle of withies, a marker pole with a
for sx in (-0.12, 0.12):  # rag tied on, and a stone maul for driving stakes
    q.cyl(5, 0.014, 0.014, (sx, -0.1, 0.014), (sx, 0.1, 0.014), BARK, rnd, 0.05)
for k in range(5):
    z = 0.042 + (k // 3) * 0.036
    y = -0.07 + (k % 3) * 0.05 + (k // 3) * 0.025
    q.cyl(6, 0.018, 0.016, (-0.22, y, z), (0.22 + rnd.uniform(-0.03, 0.03), y, z), POLE if k % 2 else BARK, rnd, 0.06)
for k in range(9):  # withies for weaving, tied in a bundle
    a, r = rnd.uniform(0, math.tau), rnd.uniform(0, 0.012)
    q.cyl(3, 0.004, 0.003, (-0.2, 0.17 + math.cos(a) * r, 0.014 + math.sin(a) * r), (0.2, 0.17 + math.cos(a) * r * 1.6, 0.014 + math.sin(a) * r), WATTLE, rnd, 0.08, cap=False)
q.cyl(6, 0.015, 0.015, (-0.004, 0.17, 0.014), (0.004, 0.17, 0.014), ROPE, rnd, 0.03, cap=False)
q.cyl(4, 0.01, 0.008, (0.27, 0.22, 0), (0.27, 0.22, 0.34), POLE, rnd)  # the marker pole
q.box((0.29, 0.22, 0.3), (0.04, 0.004, 0.05), (196, 72, 52), rnd, 0.06, rot=Matrix.Rotation(0.3, 3, "Z"))  # a rag tied on
q.cyl(4, 0.006, 0.005, (-0.26, -0.18, 0), (-0.25, -0.12, 0.13), POLE, rnd)  # the maul, leant on the poles
q.blob((-0.25, -0.12, 0.135), (0.022, 0.018, 0.028), STONES[1], rnd, 0.05, noise=0.15)
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


# ---------------------------------------------------------------- items, for the window that shows one
# item__<kind> for every kind of thing a band makes (src/sim/band.ts ITEM_KINDS), in its real colours, for
# the picture in an item's window. The game fits each one to its picture, so only the shape and the colours
# matter here, not the size or where the origin is. Tools and traps are the ones the game already shows in
# people's hands and in the land; the clothes are the ones people wear, with their region codes painted in
# real colours; the needle, the mittens, the shoes and the necklace have no other model.


def item_copy(src, name, rot=None):
    """Another model's mesh under a new name, turned by rot (a Blender-space matrix) if given."""
    mesh = bpy.data.objects[src].data.copy()
    mesh.name = name
    if rot is not None:
        mesh.transform(rot.to_4x4())
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    return obj


def repaint(obj, pairs, seed):
    """Paint a region-coded mesh in real colours: each face takes the colour paired with its nearest code
    (codes as linear rgb, colours as sRGB 0..255), with a little face-to-face variation like a hide's."""
    rr = random.Random(seed)
    mesh = obj.data
    col = mesh.attributes["Col"]
    for poly in mesh.polygons:
        c = col.data[poly.loop_start].color
        code = min(pairs, key=lambda pc: sum((c[i] - pc[0][i]) ** 2 for i in range(3)))
        real = lin(jit(code[1], rr, 0.05))
        for li in range(poly.loop_start, poly.loop_start + poly.loop_total):
            col.data[li].color = real


L_ = lambda c: lin(c)[:3]
HIDE_TAN = (150, 112, 76)
HIDE_BROWN = (122, 88, 60)
FUR_PALE = (196, 176, 140)
THONG = (96, 72, 48)
REED_PALE = (196, 176, 110)
REED_SH = (150, 132, 80)
BONE = (226, 214, 186)
BONE_DK = (186, 170, 140)

item_copy("carry__chopper", "item__chopper")
item_copy("carry__axe", "item__axe")
item_copy("carry__stick", "item__stick")
item_copy("trap__snare", "item__snare")
item_copy("trap__fishtrap", "item__fishtrap")
item_copy("trap__deadfall", "item__deadfall")
item_copy("carry__basket", "item__basket")
item_copy("pile__pot", "item__pot")
repaint(item_copy("villager__cloak", "item__cloak"), [(L_(CLOAK_CODE), HIDE_TAN), ((0, 0, 0), THONG)], 61)
item_copy("villager__furcloak", "item__furcloak")
repaint(item_copy("villager__hat", "item__hat"), [(HAT_CODE, HIDE_BROWN), (FUR_CODE, FUR_PALE)], 62)
q = Part()  # the reed cape, as worn, in its real straw colours: the knotted rows lighter and darker
rr = random.Random(63)
shell(q, [reed_row(i, z, 0.0) for i, z in enumerate(CZ2)], [reed_row(i, z, -0.004) for i, z in enumerate(CZ2)],
      lambda i, k: REED_PALE if i % 2 else REED_SH, lambda i, k: REED_SH, REED_SH, rr, 0.06)
q.box((0, -0.028, 0.286), (0.012, 0.004, 0.004), THONG, rr, 0.0)
q.finish("item__cape")
q = Part()  # a hide bag: a deep pouch, a flap folded over the mouth and tied, the strap looped up over it
rr = random.Random(64)
q.box((0, 0, 0), (0.044, 0.018, 0.040), HIDE_TAN, rr, 0.05, taper=0.88)
q.box((0, -0.0005, 0.0165), (0.046, 0.020, 0.010), THONG, rr, 0.04)  # the flap
q.box((0, -0.0115, 0.006), (0.010, 0.003, 0.016), THONG, rr, 0.04)   # its tongue down the front
q.blob((0, -0.0135, 0.0), (0.003, 0.002, 0.003), BONE, rr, 0.03)       # a bone toggle
pts = [Vector((math.cos(a) * 0.024, 0, 0.012 + math.sin(a) * 0.045)) for a in [k / 10 * math.pi for k in range(11)]]
for a_, b_ in zip(pts, pts[1:]):  # the strap, arching over
    q.cyl(4, 0.0026, 0.0026, a_, b_, THONG, rr, 0.03, cap=False)
q.finish("item__bag")

q = Part()  # a bone needle with its eye, and the awl that punches the holes for it, lying side by side
rr = random.Random(65)
q.cyl(6, 0.0016, 0.0011, (0, 0, -0.030), (0, 0, 0.022), BONE, rr, 0.04, cap=False)
tip = q.cone(6, 0.0016, -0.030, 1.0, BONE, rr, 0.03)
for v in {v for f in tip for v in f.verts if v.co.z > 0.5}:
    v.co = Vector((0, 0, -0.042))  # the point
for k in range(8):  # the eye: a flattened loop at the head
    a0, a1 = k / 8 * math.tau, (k + 1) / 8 * math.tau
    q.cyl(3, 0.0007, 0.0007, (math.sin(a0) * 0.0018, 0, 0.0245 + math.cos(a0) * 0.0032),
          (math.sin(a1) * 0.0018, 0, 0.0245 + math.cos(a1) * 0.0032), BONE_DK, rr, 0.03, cap=False)
# the awl: a thicker splinter of bone, the knuckle end left on to grip
q.cyl(6, 0.0034, 0.0022, (0.014, 0, -0.016), (0.014, 0, 0.020), BONE, rr, 0.05)
awl = q.cone(6, 0.0034, -0.016, 1.0, BONE_DK, rr, 0.03, center=(0.014, 0))
for v in {v for f in awl for v in f.verts if v.co.z > 0.5}:
    v.co = Vector((0.0142, 0, -0.036))  # the point
q.blob((0.014, 0, 0.022), (0.0052, 0.0046, 0.0042), BONE_DK, rr, 0.05, noise=0.1)
q.cyl(6, 0.0036, 0.0036, (0.014, 0, 0.000), (0.014, 0, 0.007), THONG, rr, 0.03, cap=False)  # a binding to grip
q.finish("item__needle")

q = Part()  # a pair of hide mittens, fur turned in and showing at the cuff, side by side, thumbs in
rr = random.Random(66)
# rings cuff to fingertips: (z, half-width, half-depth); the top closed round
MITT = [(-0.024, 0.0115, 0.0075), (-0.012, 0.0110, 0.0068), (-0.004, 0.0125, 0.0070), (0.010, 0.0135, 0.0072),
        (0.020, 0.0125, 0.0068), (0.027, 0.0100, 0.0058), (0.031, 0.0065, 0.0042)]
for sx in (-1, 1):
    x0 = sx * 0.019
    bm = q.bm
    seg = 12
    rings = [[bm.verts.new((x0 + math.cos(k / seg * math.tau) * rx, math.sin(k / seg * math.tau) * ry, z)) for k in range(seg)] for z, rx, ry in MITT]
    for a, b in zip(rings, rings[1:]):
        q.paint([bm.faces.new((a[k], a[(k + 1) % seg], b[(k + 1) % seg], b[k])) for k in range(seg)], HIDE_BROWN, rr, 0.05)
    top_ = bm.verts.new((x0, 0, 0.0335))
    q.paint([bm.faces.new((rings[-1][k], rings[-1][(k + 1) % seg], top_)) for k in range(seg)], HIDE_BROWN, rr, 0.05)
    # the thumb, on the inner side, angled up and out
    q.cyl(6, 0.0042, 0.0036, (x0 - sx * 0.009, 0, -0.004), (x0 - sx * 0.0165, 0, 0.010), HIDE_BROWN, rr, 0.05, cap=False)
    q.blob((x0 - sx * 0.0168, 0, 0.0105), (0.0037, 0.0037, 0.0040), HIDE_BROWN, rr, 0.05, subdiv=2)
    q.cyl(seg, 0.0132, 0.0132, (x0, 0, -0.027), (x0, 0, -0.019), FUR_PALE, rr, 0.06)  # the fur cuff
    q.cyl(seg, 0.0124, 0.0124, (x0, 0, -0.0105), (x0, 0, -0.0085), THONG, rr, 0.03, cap=False)  # the tie
q.finish("item__mittens")

q = Part()  # a pair of soft hide shoes, toes forward, a thong round each ankle
shoe(q, -0.016)
shoe(q, 0.016)
for x in (-0.016, 0.016):
    q.cyl(8, 0.0142, 0.0142, (x, 0.0056, 0.0215), (x, 0.0056, 0.0240), THONG, raw=False)
obj = q.finish("item__shoes")
repaint(obj, [((0, 0, 0), HIDE_TAN), (L_(THONG), THONG)], 67)

q = Part()  # a necklace: deer teeth and shells strung on a twisted cord, the knot at the top
rr = random.Random(68)
CORD = (120, 96, 64)
SHELL = (232, 222, 200)
SHELL_DK = (204, 178, 150)
R = 0.030
ring = [Vector((math.sin(k / 24 * math.tau) * R, 0, math.cos(k / 24 * math.tau) * R * 1.15)) for k in range(25)]
for a_, b_ in zip(ring, ring[1:]):
    q.cyl(4, 0.0011, 0.0011, a_, b_, CORD, rr, 0.03, cap=False)
q.blob((0, 0, R * 1.15 + 0.001), (0.0026, 0.0020, 0.0024), CORD, rr, 0.03)  # the knot
for j, k in enumerate(range(7, 18)):  # round the bottom: a tooth, a shell, a tooth...
    a = k / 24 * math.tau
    at = Vector((math.sin(a) * R, 0, math.cos(a) * R * 1.15))
    down = Vector((math.sin(a) * 0.35, 0, -1)).normalized()
    if j % 2 == 0:  # a deer tooth hanging point down, the root end bound to the cord
        q.cyl(6, 0.0026, 0.0009, at, at + down * 0.013, BONE, rr, 0.05)
        q.blob(at + down * 0.0135, (0.0009, 0.0009, 0.0012), BONE_DK, rr, 0.03)
    else:  # a small shell, its back to the front
        q.blob(at + down * 0.0035, (0.0034, 0.0016, 0.0040), SHELL if j % 4 == 1 else SHELL_DK, rr, 0.06, subdiv=2)
q.finish("item__necklace")

# ---------------------------------------------------------------- the band's goods, and the potter's kiln
BOWL = (164, 104, 68)       # burnished red-brown clay
BOWL_DK = (92, 54, 36)      # the pressed pattern, dark where it was pushed in and filled with soot
BOWL_FIRE = (96, 70, 54)    # a fire cloud on the side


def bowl(q, rr, pattern=True):
    """A clay bowl, coiled, scraped thin and burnished, wide and shallow on a small foot; a band of the
    band's pattern pressed into it under the rim, a zigzag of dark triangles. Origin at the foot, centred."""
    prof = [(0.0, 0.010), (0.002, 0.014), (0.006, 0.021), (0.011, 0.027), (0.016, 0.031), (0.019, 0.033), (0.020, 0.032)]
    inner = [(0.019, 0.030), (0.015, 0.027), (0.009, 0.020), (0.005, 0.012), (0.004, 0.0)]
    segs = 16
    bm = q.bm
    loops = [[bm.verts.new((math.cos(k / segs * math.tau) * r, math.sin(k / segs * math.tau) * r, z)) for k in range(segs)] for z, r in prof + inner[:-1]]
    cloud = rr.randrange(segs)
    for i in range(len(loops) - 1):
        a, b = loops[i], loops[i + 1]
        for k in range(segs):
            f = bm.faces.new((a[k], a[(k + 1) % segs], b[(k + 1) % segs], b[k]))
            if pattern and i in (3, 4, 7):  # the zigzag, outside under the rim and inside it: alternate faces up and down the band
                col = BOWL_DK if (k + i) % 2 else BOWL
            elif i < 3 and (k - cloud) % segs < 3:
                col = BOWL_FIRE
            else:
                col = BOWL
            q.paint([f], col, rr, 0.04)
    q.paint([bm.faces.new(list(reversed(loops[0])))], BOWL_DK, rr, 0.03)
    centre = bm.verts.new((0, 0, 0.004))
    last = loops[-1]
    q.paint([bm.faces.new((last[k], last[(k + 1) % segs], centre)) for k in range(segs)], BOWL, rr, 0.04)


q = Part()
bowl(q, random.Random(81))
q.finish("pile__bowl")
q = Part()
bowl(q, random.Random(82))
q.finish("item__bowl")

BEAD = [(196, 184, 168), (150, 140, 128), (118, 108, 102), (212, 196, 160), (166, 112, 78)]  # pale, grey and dark stone, a shell, a red one
BEAD_CORD = (112, 88, 60)


def bead_string(q, rr, hang):
    """A string of ground stone beads, round and barrel-shaped, on a twisted cord: hanging in a loop with
    the knot at the top (hang), or lying coiled where it was laid down."""
    n = 30
    for k in range(n):
        a = k / n * math.tau
        if hang:
            p = Vector((math.sin(a) * 0.028, 0, math.cos(a) * 0.033))
        else:
            r = 0.022 + 0.004 * math.sin(a * 2 + 0.6)
            p = Vector((math.cos(a) * r, math.sin(a) * r, 0.0028))
        if hang and (k < 4 or k > n - 4):  # bare cord up to the knot
            a2 = (k + 1) / n * math.tau
            q2 = Vector((math.sin(a2) * 0.028, 0, math.cos(a2) * 0.033))
            q.cyl(4, 0.0009, 0.0009, p, q2, BEAD_CORD, rr, 0.03, cap=False)
            continue
        col = BEAD[k % 4] if k % 7 else BEAD[4]
        q.blob(p, (0.0026, 0.0026, 0.0024) if k % 3 else (0.0022, 0.0022, 0.0030), col, rr, 0.06, subdiv=1)
    if hang:
        q.blob((0, 0, 0.0335), (0.0024, 0.0018, 0.0022), BEAD_CORD, rr, 0.03)


q = Part()
bead_string(q, random.Random(83), hang=False)
q.finish("pile__beads")
q = Part()
bead_string(q, random.Random(84), hang=True)
q.finish("item__beads")

def polar(r, a, z):  # (the necklace above reuses the name `at` for a point)
    return (math.cos(a) * r, math.sin(a) * r, z)


# a potter's kiln: a dome of clay over a firing pit, built up in coils on a footing of stones, smoke-
# blackened round the vent at the top and the stoke hole at the front, with an ash spill and embers before
# it; split wood stacked at the side, a heap of wet clay under a hide, and new bowls drying on a plank
q = Part()
rnd = random.Random(85)
KILN = (150, 112, 82)
KILN_BURNT = (92, 72, 58)
KILN_SOOT = (54, 46, 42)
FRONT_A = -math.pi / 2  # -Y: the front, facing the game's +Z
KR, KH = 0.15, 0.2


def kiln_col(i, k, n=20):
    a = k / n * math.tau
    front = abs(math.atan2(math.sin(a - FRONT_A), math.cos(a - FRONT_A)))
    if i >= 6:
        return KILN_SOOT if i >= 7 else KILN_BURNT
    if front < 0.5 and i <= 3:
        return KILN_SOOT if i <= 2 else KILN_BURNT
    return KILN if (i + k) % 3 else (138, 102, 74)


n = 20
profile = [(1.0, 0.0), (1.02, 0.02), (1.0, 0.05), (0.96, 0.09), (0.88, 0.13), (0.74, 0.165), (0.55, 0.188), (0.34, 0.198), (0.22, 0.2)]
rings = []
for i, (rf, zf) in enumerate(profile):
    ring = []
    for k in range(n):
        a = k / n * math.tau
        r = KR * rf * (1 + rnd.uniform(-0.02, 0.02))
        z = zf * (KH / 0.2)
        # the stoke hole: the lower rings pushed in at the front, so the opening reads as a dark arch
        front = abs(math.atan2(math.sin(a - FRONT_A), math.cos(a - FRONT_A)))
        if front < 0.36 and 1 <= i <= 3:
            r *= 0.7
        ring.append(polar(r, a, z))
    rings.append(ring)
vs = ring_loft(q, rings, lambda i, k: kiln_col(i, k), rnd, 0.06)
# the vent: a short collar round the hole at the top, black inside
collar = [[polar(KR * 0.22 * f, k / n * math.tau, KH + dz) for k in range(n)] for f, dz in ((1.0, 0.0), (1.05, 0.012), (0.8, 0.014), (0.6, 0.0))]
ring_loft(q, collar, lambda i, k: KILN_BURNT if i == 0 else KILN_SOOT, rnd, 0.05)
for k in range(9):  # the footing: stones round the base
    a = k / 9 * math.tau + 0.2
    if abs(math.atan2(math.sin(a - FRONT_A), math.cos(a - FRONT_A))) < 0.4:
        continue
    q.blob(polar(KR * 1.05, a, 0.012), (0.026, 0.02, 0.016), rnd.choice(STONES), rnd, 0.05, noise=0.2)
# the ash spill before the stoke hole, embers glowing in it, and a log end pushed into the mouth
q.blob((0, -KR * 1.25, 0.002), (0.07, 0.05, 0.006), ASH, rnd, 0.06, noise=0.15)
for k in range(4):
    q.blob((rnd.uniform(-0.03, 0.03), -KR * 1.2 + rnd.uniform(-0.02, 0.02), 0.006), (0.008, 0.007, 0.004), EMBER, rnd, 0.1)
q.cyl(6, 0.013, 0.012, (0.01, -KR * 1.35, 0.012), (0.0, -KR * 0.85, 0.03), BARK, rnd, 0.05)
# split wood stacked at the side
for j in range(3):
    for k in range(3 - j):
        y = -0.06 + k * 0.03 + j * 0.015
        q.cyl(5, 0.012, 0.012, (KR + 0.08, y, 0.012 + j * 0.022), (KR + 0.26, y, 0.012 + j * 0.022), (128, 98, 66) if (j + k) % 2 else (110, 84, 58), rnd, 0.06)
# a heap of wet clay, half under a hide
q.blob((-KR - 0.12, 0.08, 0.02), (0.07, 0.06, 0.035), CLAY_WET, rnd, 0.05, noise=0.12, subdiv=2)
q.blob((-KR - 0.1, 0.11, 0.038), (0.06, 0.045, 0.02), (150, 118, 84), rnd, 0.05, noise=0.1, subdiv=2)  # the hide over it
# new bowls drying on a plank, unfired and pale
q.box((-KR - 0.08, -0.16, 0.008), (0.2, 0.05, 0.008), (132, 100, 68), rnd, 0.04)
for x in (-0.06, 0.0, 0.06):
    before = set(q.bm.verts)
    bowl(q, rnd)
    new = [v for v in q.bm.verts if v not in before]
    for v in new:
        v.co = v.co * 1.25 + Vector((-KR - 0.08 + x, -0.16, 0.016))
    q.paint(q._faces_of(new), (184, 156, 120), rnd, 0.04)  # not yet fired: pale and dull
q.finish("bld__kiln")

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
