"""Renders a sheet of models from the game's GLBs so their shapes can be judged in isolation.

Run headless:  python3 blender/model_sheet.py <out.png> <glb> <name-prefix>[,<prefix>...] [cols] [view]
  view: 'iso' (the game's angle, default), 'front', 'side'
Villager parts are region-coded; they are tinted with a sample palette here, as the game would.
"""
import math
import os
import sys

import bpy
from mathutils import Vector

args = [a for a in sys.argv[1:] if not a.endswith(".py")]
OUT, GLB, PREFIXES = args[0], args[1], args[2].split(",")
COLS = int(args[3]) if len(args) > 3 else 6
VIEW = args[4] if len(args) > 4 else "iso"

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=GLB)
objs = sorted([o for o in bpy.context.scene.objects if o.type == "MESH" and any(o.name.startswith(p) for p in PREFIXES)], key=lambda o: o.name)
for o in list(bpy.context.scene.objects):
    if o not in objs:
        bpy.data.objects.remove(o)

PAL = {"cloth": (0.32, 0.17, 0.08), "skin": (0.76, 0.48, 0.30), "hair": (0.05, 0.03, 0.02), "dark": (0.015, 0.01, 0.007)}
groups = {}
for o in objs:
    key = o.name.split("__")[0] if o.name.startswith("villager") else o.name.split("__")[0] if "__" in o.name else o.name
    if o.name.startswith(("bld__", "carry__")):
        key = o.name
    groups.setdefault(key, []).append(o)
    m = o.data
    if not m.color_attributes:
        continue
    attr = m.color_attributes[0]
    if o.name.startswith("villager"):
        for d in attr.data:
            r, g, b = d.color[0], d.color[1], d.color[2]
            rest = max(0.0, 1 - r - g - b)
            c = [r * PAL["cloth"][i] + g * PAL["skin"][i] + b * PAL["hair"][i] + rest * PAL["dark"][i] for i in range(3)]
            d.color = (c[0], c[1], c[2], 1.0)
    mat = bpy.data.materials.new("vc")
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = nt.nodes["Principled BSDF"]
    an = nt.nodes.new("ShaderNodeAttribute")
    an.attribute_name = attr.name
    nt.links.new(an.outputs["Color"], bsdf.inputs["Base Color"])
    bsdf.inputs["Roughness"].default_value = 0.9
    m.materials.clear()
    m.materials.append(mat)

# lay the groups out on a grid (each group keeps its parts together)
keys = sorted(groups)
spacing = 0
for k in keys:
    for o in groups[k]:
        bb = [o.matrix_world @ Vector(c) for c in o.bound_box]
        spacing = max(spacing, max(v.x for v in bb) - min(v.x for v in bb), max(v.y for v in bb) - min(v.y for v in bb))
spacing *= 1.25
for i, k in enumerate(keys):
    cx, cy = (i % COLS) * spacing, -(i // COLS) * spacing
    for o in groups[k]:
        o.location = o.location + Vector((cx, cy, 0))
rows = (len(keys) + COLS - 1) // COLS
bpy.context.view_layer.update()  # so matrix_world reflects the new layout

scene = bpy.context.scene
scene.render.engine = "CYCLES"
scene.cycles.samples = 24
scene.cycles.device = "CPU"
W = 1400
scene.render.resolution_x = W
scene.render.resolution_y = int(W * max(0.35, rows / COLS * (0.75 if VIEW == "iso" else 1.0)))
world = bpy.data.worlds.new("w")
world.use_nodes = True
world.node_tree.nodes["Background"].inputs[0].default_value = (0.62, 0.68, 0.74, 1)
world.node_tree.nodes["Background"].inputs[1].default_value = 0.8
scene.world = world
sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN"))
sun.data.energy = 3.5
sun.rotation_euler = (math.radians(48), math.radians(8), math.radians(30))
scene.collection.objects.link(sun)
gm = bpy.data.meshes.new("g")
ext = spacing * (max(COLS, rows) + 2)
gm.from_pydata([(-ext, -ext, 0), (ext, -ext, 0), (ext, ext, 0), (-ext, ext, 0)], [], [(0, 1, 2, 3)])
mat = bpy.data.materials.new("gm")
mat.use_nodes = True
mat.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0.36, 0.45, 0.24, 1)
gm.materials.append(mat)
scene.collection.objects.link(bpy.data.objects.new("ground", gm))
cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
cam.data.type = "ORTHO"
scene.collection.objects.link(cam)
scene.camera = cam
pts = [o.matrix_world @ Vector(c) for o in objs for c in o.bound_box]
lo = Vector((min(v.x for v in pts), min(v.y for v in pts), min(v.z for v in pts)))
hi = Vector((max(v.x for v in pts), max(v.y for v in pts), max(v.z for v in pts)))
centre = (lo + hi) / 2
if VIEW == "front":
    d = Vector((0, -1, 0.08)).normalized()
elif VIEW == "side":
    d = Vector((1, 0, 0.08)).normalized()
else:
    d = Vector((1, -1, 1.3)).normalized()  # roughly the game's 33-degree iso view
cam.location = centre + d * 50
cam.rotation_euler = (-d).to_track_quat("-Z", "Y").to_euler()
# fit: project the box corners onto the camera plane
R = cam.rotation_euler.to_matrix()
right, up = R @ Vector((1, 0, 0)), R @ Vector((0, 1, 0))
corners = [Vector((x, y, z)) for x in (lo.x, hi.x) for y in (lo.y, hi.y) for z in (lo.z, hi.z)]
w = max((c - centre).dot(right) for c in corners) * 2
h = max((c - centre).dot(up) for c in corners) * 2
scene.render.resolution_y = max(200, int(W * h / max(w, 1e-6)))
if scene.render.resolution_y > 1600:
    scene.render.resolution_x = int(W * 1600 / scene.render.resolution_y)
    scene.render.resolution_y = 1600
cam.data.ortho_scale = max(w, h) * 1.12
cam.data.clip_end = 200
scene.render.filepath = OUT
bpy.ops.render.render(write_still=True)
print("SHEET", len(keys), "groups ->", OUT)
