"""People, animals, carried items and buildings for M1, exported as one GLB.

Run headless:  python3 blender/build_band.py [out.glb]
Conventions (read by src/render/band.ts):
  villager__{torso,head,armL,armR,legL,legR,hairS,hairL}  one body in parts, animated in the shader.
      Vertex colours are REGION CODES, not final colours: red = clothing, green = skin,
      blue = hair, black = leather/shoes. The game tints each person individually.
  deer__{body,head,legFL,legFR,legBL,legBR}               animated in parts, real colours.
  carry__{log,berries,meat,fish,spear,axe,body,baby}           attached to a person's hands or shoulder.
  bld__{hearth,flame,leanto,hut0,hut1,storehouse,rack,site}  one tile footprint, centred on the origin.
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


for side, sx in (("L", -1), ("R", 1)):
    hip, knee = J["hip" + side], J["knee" + side]
    ankle = (hip[0], 0.024, 0.0)
    q = Part()  # thigh: leggings, slightly overlapping the hip and knee so bends never open a gap
    limb(q, (hip[0], hip[1] + 0.012, 0), (knee[0], knee[1] - 0.004, knee[2]), 0.021, 0.0165, LEGS)
    q.finish(f"villager__thigh{side}")
    q = Part()  # shin and a soft leather shoe
    limb(q, (knee[0], knee[1] + 0.006, knee[2]), ankle, 0.016, 0.0125, LEGS)
    q.box(B((hip[0], 0.013, 0.009)), (0.03, 0.05, 0.026), DARK, raw=True, taper=0.85)
    q.finish(f"villager__shin{side}")
    sh, el = J["shoulder" + side], J["elbow" + side]
    wrist = (el[0] + sx * 0.002, 0.152, 0.004)
    q = Part()  # upper arm: a sleeve, rounded at the shoulder
    limb(q, (sh[0], sh[1] + 0.006, 0), (el[0], el[1] - 0.004, 0), 0.0165, 0.0135, CLOTH)
    sph = bmesh.ops.create_uvsphere(q.bm, u_segments=8, v_segments=5, radius=1.0)  # a soft shoulder
    for v in sph["verts"]:
        v.co = Vector((v.co.x * 0.0165, v.co.y * 0.0165, v.co.z * 0.0145)) + Vector(B((sh[0] - sx * 0.001, sh[1] - 0.001, 0)))
    q.paint(q._faces_of(sph["verts"]), CLOTH, raw=True)
    q.finish(f"villager__arm{side}")
    q = Part()  # forearm: sleeve to mid-forearm, then bare skin and a hand
    mid = (el[0] + sx * 0.001, 0.182, 0.002)
    limb(q, (el[0], el[1] + 0.005, 0), mid, 0.0138, 0.0125, CLOTH)
    limb(q, mid, wrist, 0.0105, 0.0095, SKIN)
    hand = bmesh.ops.create_uvsphere(q.bm, u_segments=6, v_segments=4, radius=1.0)
    for v in hand["verts"]:
        v.co = Vector((v.co.x * 0.0085, v.co.y * 0.0075, v.co.z * 0.0125)) + Vector(B((wrist[0], wrist[1] - 0.011, wrist[2] + 0.002)))
    q.paint(q._faces_of(hand["verts"]), SKIN, raw=True)
    q.finish(f"villager__fore{side}")

q = Part()  # torso: a belted tunic flaring over the hips
belt = lambda i: DARK if i == 2 else CLOTH
loft(q, [(0.128, 0.064, 0.048, 0.002), (0.156, 0.060, 0.045, 0.0), (0.186, 0.052, 0.037, 0.0), (0.198, 0.053, 0.038, 0.0),
         (0.236, 0.058, 0.040, 0.0), (0.266, 0.064, 0.036, 0.002), (0.284, 0.046, 0.030, 0.002), (0.292, 0.022, 0.020, 0.0)], 8, belt)
q.finish("villager__torso")

q = Part()  # head: neck, a rounded skull, nose, ears and dark eyes
limb(q, (0, 0.282, 0), (0, 0.306, 0.002), 0.0175, 0.016, SKIN)
hb = bmesh.ops.create_uvsphere(q.bm, u_segments=10, v_segments=7, radius=1.0)
for v in hb["verts"]:
    v.co = Vector((v.co.x * 0.036, v.co.y * 0.035 - 0.002, v.co.z * 0.040 + 0.334))
q.paint(q._faces_of(hb["verts"]), SKIN, raw=True)
q.box(B((0, 0.329, 0.036)), (0.011, 0.012, 0.016), SKIN, raw=True, taper=0.7)  # nose
for ex in (-0.0135, 0.0135):
    q.box(B((ex, 0.337, 0.0318)), (0.0075, 0.004, 0.0065), DARK, raw=True)  # eyes
    q.box(B((ex * 2.7, 0.332, 0.0)), (0.006, 0.012, 0.014), SKIN, raw=True)  # ears
q.finish("villager__head")


def cap(q, lift, scale, back, color):
    """Hair as a shell over the top and back of the skull."""
    hb = bmesh.ops.create_uvsphere(q.bm, u_segments=10, v_segments=7, radius=1.0)
    keep = []
    for v in hb["verts"]:
        v.co = Vector((v.co.x * scale[0], v.co.y * scale[1] + back, v.co.z * scale[2] + 0.334 + lift))
    # cut away the face: anything low and in front goes
    faces = list({f for v in hb["verts"] for f in v.link_faces})
    edges = list({e for v in hb["verts"] for e in v.link_edges})
    bmesh.ops.bisect_plane(q.bm, geom=hb["verts"] + edges + faces,
                           plane_co=(0, -0.006, 0.322), plane_no=(0, -0.55, -1.0), clear_outer=True)
    q.paint([f for f in q.bm.faces], color, raw=True)


q = Part()  # short hair
cap(q, 0.004, (0.0395, 0.0385, 0.041), 0.003, HAIR)
q.finish("villager__hairS")
q = Part()  # long hair: the same cap with a fall down the back and over the shoulders
cap(q, 0.004, (0.041, 0.040, 0.042), 0.004, HAIR)
loft(q, [(0.262, 0.030, 0.012, 0.030), (0.300, 0.036, 0.014, 0.030), (0.336, 0.037, 0.016, 0.022)], 8, lambda i: HAIR)
q.finish("villager__hairL")

# ---------------------------------------------------------------- deer
DEER = (150, 102, 62)
DEER_DARK = (96, 64, 40)
BELLY = (214, 196, 168)
HOOF = (44, 34, 28)
ANTLER = (196, 176, 140)
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


q = Part()  # body: chest deeper than the rump, pale belly, white tail
loft_y(q, [(-0.135, 0.030, 0.034, 0.235), (-0.11, 0.045, 0.058, 0.212), (-0.06, 0.053, 0.064, 0.196), (0.0, 0.054, 0.060, 0.192),
           (0.07, 0.052, 0.058, 0.198), (0.115, 0.044, 0.050, 0.206), (0.14, 0.022, 0.028, 0.212)], 8,
       lambda c: BELLY if c.z < 0.165 else DEER)
q.blob((0, 0.145, 0.215), (0.018, 0.016, 0.026), BELLY, rnd, 0.0)
q.finish("deer__body")
q = Part()  # neck, head, muzzle, ears, eyes
q.cyl(6, 0.030, 0.022, (0, -0.105, 0.225), (0, -0.15, 0.305), DEER, rnd, 0.04)
q.box((0, -0.178, 0.312), (0.046, 0.08, 0.044), DEER, rnd, 0.03, taper=0.78)
q.box((0, -0.222, 0.304), (0.028, 0.022, 0.026), DEER_DARK, rnd, 0.0)
for ex in (-1, 1):
    q.box((ex * 0.024, -0.158, 0.344), (0.012, 0.008, 0.036), DEER, rnd, 0.0, rot=Matrix.Rotation(ex * 0.5, 3, "Y"))
    q.box((ex * 0.021, -0.19, 0.322), (0.006, 0.008, 0.007), HOOF, rnd, 0.0)
q.finish("deer__head")
q = Part()  # antlers (worn by stags only; the game hides them on hinds and fawns)
for ex in (-1, 1):
    base = Vector((ex * 0.014, -0.16, 0.335))
    beam = base + Vector((ex * 0.035, 0.03, 0.075))
    tip = beam + Vector((ex * 0.012, 0.035, 0.035))
    q.cyl(4, 0.0045, 0.0035, base, beam, ANTLER, rnd, 0.03)
    q.cyl(4, 0.0035, 0.0022, beam, tip, ANTLER, rnd, 0.03)
    for t, d in ((0.35, (ex * 0.002, -0.03, 0.03)), (0.75, (ex * 0.01, -0.025, 0.035))):
        p0 = base.lerp(beam, t)
        q.cyl(4, 0.003, 0.0018, p0, p0 + Vector(d), ANTLER, rnd, 0.03)
q.finish("deer__antlers")
for name, x, y in (("legFL", -0.035, -0.09), ("legFR", 0.035, -0.09), ("legBL", -0.035, 0.09), ("legBR", 0.035, 0.09)):
    q = Part()  # a thigh-thick upper leg, slim lower leg, dark hoof
    back = y > 0
    knee = (x, y + (0.012 if back else -0.006), 0.085)
    q.cyl(5, 0.017 if back else 0.014, 0.010, (x, y, 0.17), knee, DEER, rnd, 0.03)
    q.cyl(4, 0.008, 0.007, knee, (x, y, 0.016), DEER_DARK, rnd, 0.03)
    q.cyl(4, 0.008, 0.009, (x, y, 0.016), (x, y - 0.004, 0.0), HOOF, rnd, 0.0)
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


def thatch_cone(q, segs, r, z0, h, col, rnd, jag=0.02):
    """A cone of thatch with a ragged, uneven eave."""
    bm = q.bm
    ring = []
    for k in range(segs):
        a = k / segs * math.tau
        rr = r * (1 + rnd.uniform(-jag, jag))
        ring.append(bm.verts.new((math.cos(a) * rr, math.sin(a) * rr, z0 + rnd.uniform(-0.012, 0.012))))
    apex = bm.verts.new((0, 0, z0 + h))
    fs = [bm.faces.new((ring[k], ring[(k + 1) % segs], apex)) for k in range(segs)]
    fs.append(bm.faces.new(list(reversed(ring))))
    q.paint(fs, col, rnd, 0.08)


rnd = random.Random(30)
q = Part()  # hut 0: round, stake-and-wattle wall, door frame and hide flap, two-tier thatch, smoke hole sticks
segs, R = 11, 0.33
q.cyl(segs, R, R * 0.97, (0, 0, 0), (0, 0, 0.21), WATTLE, rnd, 0.07)
for k in range(segs):  # the stakes the wattle is woven through
    a = (k + 0.5) / segs * math.tau
    if abs(math.sin(a) + 1) < 0.25:
        continue  # leave the doorway clear
    q.cyl(4, 0.011, 0.009, (math.cos(a) * R * 1.01, math.sin(a) * R * 1.01, 0), (math.cos(a) * R * 0.98, math.sin(a) * R * 0.98, 0.175), POLE, rnd, 0.06)
q.box((0, -R + 0.006, 0.085), (0.11, 0.03, 0.17), (40, 30, 22))
for dx in (-0.065, 0.065):
    q.cyl(4, 0.012, 0.011, (dx, -R - 0.005, 0), (dx, -R - 0.005, 0.2), POLE, rnd)
q.cyl(4, 0.011, 0.011, (-0.085, -R - 0.006, 0.195), (0.085, -R - 0.006, 0.195), POLE, rnd)
q.box((0.035, -R - 0.012, 0.11), (0.06, 0.008, 0.15), HIDE, rnd, 0.05, rot=Matrix.Rotation(0.25, 3, "Z"))  # door flap, pulled aside
thatch_cone(q, segs + 3, R + 0.1, 0.17, 0.2, THATCH_DK, rnd, 0.05)  # lower tier, the eaves
thatch_cone(q, segs + 3, R - 0.01, 0.29, 0.25, THATCH, rnd, 0.03)
for k in range(3):  # sticks lashed at the smoke hole
    a = k / 3 * math.tau
    q.cyl(4, 0.006, 0.005, (0, 0, 0.5), (math.cos(a) * 0.05, math.sin(a) * 0.05, 0.6), POLE, rnd)
q.finish("bld__hut0")

rnd = random.Random(31)
q = Part()  # hut 1: a beehive dome of thatch on a low stone footing, roped down
R = 0.35
for k in range(14):
    a = k / 14 * math.tau
    q.blob((math.cos(a) * R, math.sin(a) * R, 0.025), (0.045, 0.04, 0.03), jit(STONE, rnd, 0.12), rnd, 0.05, noise=0.2)
q.cyl(12, R * 0.97, R * 0.95, (0, 0, 0), (0, 0, 0.1), WATTLE, rnd, 0.06)
dome = bmesh.ops.create_uvsphere(q.bm, u_segments=14, v_segments=8, radius=1.0)
for v in dome["verts"]:
    z = max(v.co.z, -0.05)
    v.co = Vector((v.co.x * (R + 0.04) * (1 + rnd.uniform(-0.03, 0.03)), v.co.y * (R + 0.04) * (1 + rnd.uniform(-0.03, 0.03)), 0.08 + z * 0.4))
q.paint(q._faces_of(dome["verts"]), THATCH, rnd, 0.07)
for zr in (0.2, 0.34):  # rope bands holding the thatch down
    rr = (R + 0.045) * math.sqrt(max(0.0, 1 - ((zr - 0.08) / 0.4) ** 2))
    q.cyl(14, rr + 0.004, rr + 0.004, (0, 0, zr - 0.006), (0, 0, zr + 0.006), (120, 96, 60), rnd, 0.03, cap=False)
q.box((0, -R + 0.01, 0.075), (0.12, 0.05, 0.15), (40, 30, 22))  # low doorway
q.box((0, -R - 0.012, 0.158), (0.16, 0.05, 0.022), THATCH_DK, rnd, 0.05, rot=Matrix.Rotation(0.35, 3, "X"))  # thatch hood over the door
q.finish("bld__hut1")

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
