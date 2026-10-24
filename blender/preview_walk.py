"""Renders the villager walking/running through its gait table, using the same joint maths as the
game shader (src/render/band.ts), so the cycle can be judged in Blender before it reaches the game.

Run headless:  python3 blender/preview_walk.py <outdir> [walk|run] [frames]
"""
import json
import math
import os
import sys

import bpy
from mathutils import Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
ASSETS = os.path.join(HERE, "..", "src", "assets")
args = [a for a in sys.argv[1:] if not a.endswith(".py")]
OUT = args[0] if args else "/tmp/walkpreview"
GAIT = args[1] if len(args) > 1 else "walk"
FRAMES = int(args[2]) if len(args) > 2 else 8
os.makedirs(OUT, exist_ok=True)

g = json.load(open(os.path.join(ASSETS, "gait.json")))
J = {k: Vector(v) for k, v in g["joints"].items()}
CH = {name: i for i, name in enumerate(g["channels"])}
table = g[GAIT]
S = g["samples"]

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=os.path.join(ASSETS, "band.glb"))
parts = {o.name.split("__")[1]: o for o in bpy.context.scene.objects if o.name.startswith("villager__")}
for name, o in list(bpy.context.scene.objects.items()):
    if not name.startswith("villager__") or name == "villager__hairL":
        bpy.data.objects.remove(o)
parts.pop("hairL", None)

# region codes -> a sample person's colours (the game does this per person in the shader)
PAL = {"cloth": (0.32, 0.17, 0.08), "skin": (0.76, 0.48, 0.30), "hair": (0.05, 0.03, 0.02), "dark": (0.015, 0.01, 0.007)}
for o in parts.values():
    m = o.data
    attr = m.color_attributes[0]
    for d in attr.data:
        r, gg, b = d.color[0], d.color[1], d.color[2]
        rest = max(0.0, 1 - r - gg - b)
        c = [r * PAL["cloth"][i] + gg * PAL["skin"][i] + b * PAL["hair"][i] + rest * PAL["dark"][i] for i in range(3)]
        d.color = (c[0], c[1], c[2], 1.0)
    mat = bpy.data.materials.new("vc")
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = nt.nodes["Principled BSDF"]
    an = nt.nodes.new("ShaderNodeAttribute")
    an.attribute_name = attr.name
    nt.links.new(an.outputs["Color"], bsdf.inputs["Base Color"])
    bsdf.inputs["Roughness"].default_value = 0.9
    m.materials.append(mat)
    o.matrix_basis = Matrix.Identity(4)

# game space (x, y up, z forward) <-> Blender (x, -y forward, z up)
C = Matrix(((1, 0, 0, 0), (0, 0, -1, 0), (0, 1, 0, 0), (0, 0, 0, 1)))
Ci = C.inverted()


def rx(a):
    """the shader's rx(): negative swings a hanging limb forward (+z)"""
    c, s = math.cos(a), math.sin(a)
    return Matrix(((1, 0, 0), (0, c, -s), (0, s, c))).to_4x4()


def rz(a):
    c, s = math.cos(a), math.sin(a)
    return Matrix(((c, -s, 0), (s, c, 0), (0, 0, 1))).to_4x4()


def about(R, P):
    return Matrix.Translation(P) @ R @ Matrix.Translation(-P)


def sample(ch, phase):
    row = table[CH[ch]]
    x = (phase % 1.0) * S
    i = int(math.floor(x)) % S
    f = x - math.floor(x)
    return row[i] * (1 - f) + row[(i + 1) % S] * f


def pose(phase):
    a = {ch: sample(ch, phase) for ch in CH}
    body = Matrix.Translation((0, a["bob"], 0)) @ about(rz(a["roll"]), J["hip"])
    lean = about(rx(a["lean"]), J["hip"])
    head = about(rx(a["head"]), J["neck"])
    M = {}
    for s in ("L", "R"):
        thigh = about(rx(a["thigh" + s]), J["hip" + s])
        knee = about(rx(a["knee" + s]), J["knee" + s])
        sh = about(rx(a["shoulder" + s]), J["shoulder" + s])
        el = about(rx(a["elbow" + s]), J["elbow" + s])
        M["thigh" + s] = Matrix.Translation((0, a["bob"], 0)) @ thigh
        M["shin" + s] = Matrix.Translation((0, a["bob"], 0)) @ thigh @ knee
        M["arm" + s] = body @ lean @ sh
        M["fore" + s] = body @ lean @ sh @ el
    M["torso"] = body @ lean
    M["head"] = body @ lean @ head
    M["hairS"] = M["head"]
    return M


scene = bpy.context.scene
scene.render.engine = "CYCLES"
scene.cycles.samples = 12
scene.cycles.device = "CPU"
scene.render.resolution_x = scene.render.resolution_y = 260
scene.render.film_transparent = False
world = bpy.data.worlds.new("w")
world.use_nodes = True
world.node_tree.nodes["Background"].inputs[0].default_value = (0.55, 0.62, 0.48, 1)
world.node_tree.nodes["Background"].inputs[1].default_value = 0.9
scene.world = world
sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN"))
sun.data.energy = 3.2
sun.rotation_euler = (math.radians(50), math.radians(10), math.radians(35))
scene.collection.objects.link(sun)
ground = bpy.data.meshes.new("g")
ground.from_pydata([(-1, -1, 0), (1, -1, 0), (1, 1, 0), (-1, 1, 0)], [], [(0, 1, 2, 3)])
go = bpy.data.objects.new("ground", ground)
gm = bpy.data.materials.new("gm")
gm.use_nodes = True
gm.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0.25, 0.4, 0.12, 1)
ground.materials.append(gm)
scene.collection.objects.link(go)
cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
cam.data.type = "ORTHO"
cam.data.ortho_scale = 0.52
scene.collection.objects.link(cam)
scene.camera = cam
views = {
    "side": ((0.9, 0.0, 0.2), (math.radians(90), 0, math.radians(90))),
    "game": ((0.55, 0.55, 0.42), (math.radians(57), 0, math.radians(135))),
}
for vname, (loc, rot) in views.items():
    cam.location = loc
    cam.rotation_euler = rot
    if vname == "side":
        cam.location = (0.9, 0.0, 0.2)
    for k in range(FRAMES):
        M = pose(k / FRAMES)
        for name, o in parts.items():
            o.matrix_world = C @ M.get(name, Matrix.Identity(4)) @ Ci
        scene.render.filepath = os.path.join(OUT, f"{GAIT}_{vname}_{k:02d}.png")
        bpy.ops.render.render(write_still=True)
print("PREVIEW", GAIT, FRAMES, "->", OUT)
