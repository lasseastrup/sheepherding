"""
Builds the stylised low-poly sheep: mesh, armature, phase-matched animation clips, glTF export.

Run headless with Blender as a Python module (pip install bpy==4.2.*):
    python tools/blender/make_sheep.py [out.glb]

Units: 1 Blender unit = 1 sheep body length (BL), the simulation's unit. The sheep faces +X,
stands on z = 0, and is about 1.0 BL nose to tail, 0.5 wide, 0.85 tall.
"""
import math
import random
import sys

import bpy  # must come first: bmesh and mathutils are registered when bpy initialises
import bmesh
from mathutils import Matrix, Vector

OUT = sys.argv[-1] if sys.argv[-1].endswith('.glb') else 'assets/sheep.glb'
FPS = 30

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.render.fps = FPS

# ---------------------------------------------------------------------------------------------
# materials
# ---------------------------------------------------------------------------------------------

# One material, not two. Wool and skin are separated by a vertex-colour mask (white = wool,
# black = skin) so the whole sheep is a single glTF primitive: one draw call per animal instead
# of two, which is what makes a flock of hundreds affordable. The renderer reads the mask and
# supplies both colours as uniforms, so each sheep can still be tinted individually.
SHEEP_MAT = bpy.data.materials.new('Sheep')
SHEEP_MAT.use_nodes = True
_nodes = SHEEP_MAT.node_tree.nodes
_bsdf = _nodes['Principled BSDF']
_bsdf.inputs['Roughness'].default_value = 0.95
_attr = _nodes.new('ShaderNodeVertexColor')
_attr.layer_name = 'Mask'
SHEEP_MAT.node_tree.links.new(_attr.outputs['Color'], _bsdf.inputs['Base Color'])
MATERIALS = [SHEEP_MAT]

WOOL_MASK = 0
SKIN_MASK = 1

# ---------------------------------------------------------------------------------------------
# mesh: one bmesh, parts tagged with vertex groups (rigid skinning) and material indices
# ---------------------------------------------------------------------------------------------

bm = bmesh.new()
groups = {}  # name -> list of vertex indices
rng = random.Random(7)


mask_of = {}  # vertex index -> WOOL_MASK or SKIN_MASK


def add_part(group, mask, op, **kwargs):
    """Run a bmesh create op, tag its new verts with a bone group and a wool/skin mask."""
    v0 = len(bm.verts)
    f0 = len(bm.faces)
    op(bm, **kwargs)
    bm.verts.ensure_lookup_table()
    bm.faces.ensure_lookup_table()
    verts = [v for v in bm.verts[v0:]]
    groups.setdefault(group, []).extend(v.index for v in verts)
    for v in verts:
        mask_of[v.index] = mask
    for f in bm.faces[f0:]:
        f.material_index = 0
        f.smooth = False
    return verts


def xform(loc, scale=(1, 1, 1), rot=(0, 0, 0)):
    return (
        Matrix.Translation(Vector(loc))
        @ Matrix.Rotation(rot[2], 4, 'Z') @ Matrix.Rotation(rot[1], 4, 'Y') @ Matrix.Rotation(rot[0], 4, 'X')
        @ Matrix.Diagonal((*scale, 1.0))
    )


# fleece: a chunky icosphere, lumpy along its normals so it reads as wool
body = add_part('Spine', WOOL_MASK, bmesh.ops.create_icosphere, subdivisions=2, radius=1.0,
                matrix=xform((-0.06, 0, 0.55), (0.42, 0.26, 0.24)))
for v in body:
    n = v.normal.copy()
    if n.length == 0:
        continue
    v.co += n * rng.uniform(-0.012, 0.028)
# tail: a wool nub
add_part('Spine', WOOL_MASK, bmesh.ops.create_icosphere, subdivisions=1, radius=1.0,
         matrix=xform((-0.50, 0, 0.60), (0.06, 0.05, 0.05)))
# neck: dark, joins fleece to head
add_part('Neck', SKIN_MASK, bmesh.ops.create_cone, cap_ends=True, cap_tris=False, segments=8,
         radius1=0.075, radius2=0.06, depth=0.24,
         matrix=xform((0.42, 0, 0.62), rot=(0, math.radians(-70), 0)))
# head: dark, slightly long
add_part('Head', SKIN_MASK, bmesh.ops.create_icosphere, subdivisions=1, radius=1.0,
         matrix=xform((0.60, 0, 0.66), (0.13, 0.085, 0.09)))
# muzzle
add_part('Head', SKIN_MASK, bmesh.ops.create_cube, size=1.0, matrix=xform((0.71, 0, 0.62), (0.10, 0.09, 0.08)))
# forelock: a wool cap on the head, the Merino look
add_part('Head', WOOL_MASK, bmesh.ops.create_icosphere, subdivisions=1, radius=1.0,
         matrix=xform((0.56, 0, 0.73), (0.10, 0.09, 0.055)))
# ears: flattened, angled out and slightly back
for side, grp in ((1, 'Ear_L'), (-1, 'Ear_R')):
    add_part(grp, SKIN_MASK, bmesh.ops.create_cube, size=1.0,
             matrix=xform((0.56, side * 0.14, 0.72), (0.05, 0.11, 0.025),
                          rot=(side * math.radians(25), 0, side * math.radians(-20))))
# legs: rigid, hang from the fleece
for name, x, y in (('Leg_FL', 0.26, 0.15), ('Leg_FR', 0.26, -0.15), ('Leg_BL', -0.30, 0.15), ('Leg_BR', -0.30, -0.15)):
    add_part(name, SKIN_MASK, bmesh.ops.create_cone, cap_ends=True, cap_tris=False, segments=7,
             radius1=0.045, radius2=0.04, depth=0.42, matrix=xform((x, y, 0.21)))

mesh = bpy.data.meshes.new('Sheep')
bm.to_mesh(mesh)
bm.free()
for m in MATERIALS:
    mesh.materials.append(m)
# wool/skin mask as a colour attribute
colour = mesh.color_attributes.new(name='Mask', type='FLOAT_COLOR', domain='POINT')
for i in range(len(mesh.vertices)):
    v = 0.0 if mask_of.get(i, WOOL_MASK) == SKIN_MASK else 1.0
    colour.data[i].color = (v, v, v, 1.0)
sheep = bpy.data.objects.new('Sheep', mesh)
scene.collection.objects.link(sheep)
for name, idx in groups.items():
    vg = sheep.vertex_groups.new(name=name)
    vg.add(idx, 1.0, 'REPLACE')

# ---------------------------------------------------------------------------------------------
# armature
# ---------------------------------------------------------------------------------------------

arm_data = bpy.data.armatures.new('SheepRig')
rig = bpy.data.objects.new('SheepRig', arm_data)
scene.collection.objects.link(rig)
bpy.context.view_layer.objects.active = rig
bpy.ops.object.mode_set(mode='EDIT')

BONES = {
    #  name      head                 tail                 parent
    'Root':    ((0.0, 0, 0.0),      (0.0, 0, 0.15),      None),
    'Spine':   ((-0.45, 0, 0.55),   (0.35, 0, 0.55),     'Root'),
    'Neck':    ((0.33, 0, 0.58),    (0.50, 0, 0.66),     'Spine'),
    'Head':    ((0.50, 0, 0.66),    (0.78, 0, 0.62),     'Neck'),
    'Ear_L':   ((0.56, 0.10, 0.72), (0.56, 0.22, 0.76),  'Head'),
    'Ear_R':   ((0.56, -0.10, 0.72), (0.56, -0.22, 0.76), 'Head'),
    'Leg_FL':  ((0.26, 0.15, 0.42), (0.26, 0.15, 0.0),   'Spine'),
    'Leg_FR':  ((0.26, -0.15, 0.42), (0.26, -0.15, 0.0), 'Spine'),
    'Leg_BL':  ((-0.30, 0.15, 0.42), (-0.30, 0.15, 0.0), 'Spine'),
    'Leg_BR':  ((-0.30, -0.15, 0.42), (-0.30, -0.15, 0.0), 'Spine'),
}
for name, (head, tail, parent) in BONES.items():
    eb = arm_data.edit_bones.new(name)
    eb.head = Vector(head)
    eb.tail = Vector(tail)
    eb.roll = 0.0
    if parent:
        eb.parent = arm_data.edit_bones[parent]
        eb.use_connect = False
bpy.ops.object.mode_set(mode='OBJECT')

sheep.parent = rig
mod = sheep.modifiers.new('Armature', 'ARMATURE')
mod.object = rig

# ---------------------------------------------------------------------------------------------
# animation helpers: key a rotation about a WORLD axis on a pose bone, converted to bone space
# ---------------------------------------------------------------------------------------------

bpy.ops.object.mode_set(mode='POSE')
pose = rig.pose.bones
for pb in pose:
    pb.rotation_mode = 'QUATERNION'

X, Y, Z = Vector((1, 0, 0)), Vector((0, 1, 0)), Vector((0, 0, 1))


def world_rot(pb, rotations):
    """Compose (axis, angle) world-space rotations and express them in the bone's rest frame."""
    r = Matrix.Identity(3)
    for axis, ang in rotations:
        r = Matrix.Rotation(ang, 3, axis) @ r
    m = pb.bone.matrix_local.to_3x3()
    return (m.inverted() @ r @ m).to_quaternion()


def key(pb, frame, rotations=(), loc=None, scale=None):
    pb.rotation_quaternion = world_rot(pb, rotations) if rotations else (1, 0, 0, 0)
    pb.keyframe_insert('rotation_quaternion', frame=frame)
    if loc is not None:
        pb.location = Vector(loc)
        pb.keyframe_insert('location', frame=frame)
    if scale is not None:
        pb.scale = Vector(scale)
        pb.keyframe_insert('scale', frame=frame)


def new_action(name):
    action = bpy.data.actions.new(name)
    action.use_fake_user = True
    rig.animation_data_create()
    rig.animation_data.action = action
    return action


def finish_action(action, frames):
    """Cycle the action's f-curves and stash it on an NLA track for export."""
    for fc in action.fcurves:
        for kp in fc.keyframe_points:
            kp.interpolation = 'LINEAR' if 'location' in fc.data_path else 'BEZIER'
        if not fc.modifiers:
            fc.modifiers.new('CYCLES')
    action.frame_range = (0, frames)
    rig.animation_data.action = None
    track = rig.animation_data.nla_tracks.new()
    track.name = action.name
    strip = track.strips.new(action.name, 0, action)
    strip.name = action.name
    track.mute = True


def deg(a):
    return math.radians(a)


PITCH = Y  # rotation about world Y tilts a forward-pointing bone nose-down for +angle
SWING = Y  # legs swing fore and aft about the same axis
ROLL = X
YAW = Z

# ---------------------------------------------------------------------------------------------
# clips. Gait clips share a convention: phase 0 = left fore-foot planted forward; body bob at
# twice the stride frequency, so blending between gaits keeps feet in step.
# ---------------------------------------------------------------------------------------------

def gait(name, frames, legs, amp, bob, pitch_amp, roll_amp, neck_pitch, head_pitch, samples=8):
    """legs: {bone: phase_offset}. Sinusoidal swing, sampled densely enough for Bezier."""
    action = new_action(name)
    for s in range(samples + 1):
        t = s / samples
        f = t * frames
        for bone, ph in legs.items():
            key(pose[bone], f, [(SWING, deg(amp) * math.sin(2 * math.pi * (t + ph)))])
        key(pose['Spine'], f,
            [(PITCH, deg(pitch_amp) * math.sin(2 * math.pi * (2 * t + 0.25))),
             (ROLL, deg(roll_amp) * math.sin(2 * math.pi * t))],
            loc=(0, 0, bob * (0.5 - 0.5 * math.cos(2 * math.pi * 2 * t))))
        key(pose['Neck'], f, [(PITCH, deg(neck_pitch) + deg(2.5) * math.sin(2 * math.pi * (2 * t + 0.5)))])
        key(pose['Head'], f, [(PITCH, deg(head_pitch) + deg(3) * math.sin(2 * math.pi * (2 * t + 0.75)))])
        for ear, side in (('Ear_L', 1), ('Ear_R', -1)):
            key(pose[ear], f, [(ROLL, side * deg(4) * math.sin(2 * math.pi * (2 * t + 0.3)))])
    finish_action(action, frames)


# walk: lateral sequence, 0.9 s cycle, reference speed 1.2 BL/s
gait('walk', 27, {'Leg_FL': 0.0, 'Leg_BR': 0.25, 'Leg_FR': 0.5, 'Leg_BL': 0.75},
     amp=22, bob=0.012, pitch_amp=1.0, roll_amp=2.0, neck_pitch=8, head_pitch=6)
# trot: diagonal pairs, 0.5 s cycle, reference speed 2.5 BL/s
gait('trot', 15, {'Leg_FL': 0.0, 'Leg_BR': 0.0, 'Leg_FR': 0.5, 'Leg_BL': 0.5},
     amp=32, bob=0.03, pitch_amp=2.0, roll_amp=1.5, neck_pitch=12, head_pitch=4)
# run: a bounding gallop, 0.4 s cycle, reference speed 4 BL/s; fore pair then hind pair
gait('run', 12, {'Leg_FL': 0.0, 'Leg_FR': 0.08, 'Leg_BL': 0.5, 'Leg_BR': 0.58},
     amp=45, bob=0.06, pitch_amp=6.0, roll_amp=1.0, neck_pitch=18, head_pitch=-6)


def stationary(name, frames, fn, samples=12):
    action = new_action(name)
    for s in range(samples + 1):
        t = s / samples
        fn(t, t * frames)
    finish_action(action, frames)


def idle(t, f):
    breathe = math.sin(2 * math.pi * t)
    key(pose['Spine'], f, [(PITCH, deg(0.6) * breathe)], scale=(1.0, 1.0 + 0.015 * breathe, 1.0 + 0.02 * breathe))
    key(pose['Neck'], f, [(PITCH, deg(4) + deg(2) * math.sin(2 * math.pi * (t + 0.2)))])
    key(pose['Head'], f, [(PITCH, deg(2) * math.sin(2 * math.pi * (t + 0.4)))])
    for ear, side in (('Ear_L', 1), ('Ear_R', -1)):
        key(pose[ear], f, [(ROLL, side * deg(6) * math.sin(2 * math.pi * (t + 0.1)))])
    for leg in ('Leg_FL', 'Leg_FR', 'Leg_BL', 'Leg_BR'):
        key(pose[leg], f)


stationary('idle', 60, idle)


def graze(t, f):
    chew = math.sin(2 * math.pi * 3 * t)
    nod = math.sin(2 * math.pi * t)
    key(pose['Spine'], f, [(PITCH, deg(2))], loc=(0.01 * nod, 0, 0))
    key(pose['Neck'], f, [(PITCH, deg(52) + deg(3) * nod)])
    key(pose['Head'], f, [(PITCH, deg(28) + deg(4) * chew), (YAW, deg(3) * math.sin(2 * math.pi * (t + 0.3)))])
    for ear, side in (('Ear_L', 1), ('Ear_R', -1)):
        key(pose[ear], f, [(ROLL, side * deg(12) + side * deg(5) * chew)])
    for leg in ('Leg_FL', 'Leg_FR', 'Leg_BL', 'Leg_BR'):
        key(pose[leg], f)


stationary('graze', 72, graze)


def alert(t, f):
    tremor = math.sin(2 * math.pi * 4 * t)
    key(pose['Spine'], f, [(PITCH, deg(-2))], loc=(-0.01, 0, 0.01))
    key(pose['Neck'], f, [(PITCH, deg(-14) + deg(0.8) * tremor)])
    key(pose['Head'], f, [(PITCH, deg(-4))])
    # ears pricked forward
    key(pose['Ear_L'], f, [(YAW, deg(35)), (ROLL, deg(-18))])
    key(pose['Ear_R'], f, [(YAW, deg(-35)), (ROLL, deg(18))])
    for leg in ('Leg_FL', 'Leg_FR', 'Leg_BL', 'Leg_BR'):
        key(pose[leg], f)


stationary('alert', 30, alert)


def startle(t, f):
    # crouch, spring, land: a single hop of 0.4 s
    hop = max(0.0, math.sin(math.pi * min(1.0, max(0.0, (t - 0.25) / 0.6))))
    crouch = -0.05 * math.sin(math.pi * min(1.0, t / 0.25)) if t < 0.25 else 0.0
    key(pose['Spine'], f, [(PITCH, deg(-8) * hop)], loc=(0, 0, crouch + 0.12 * hop))
    key(pose['Neck'], f, [(PITCH, deg(-10) * hop)])
    key(pose['Head'], f, [(PITCH, deg(-6) * hop)])
    for leg in ('Leg_FL', 'Leg_FR'):
        key(pose[leg], f, [(SWING, deg(-30) * hop)])
    for leg in ('Leg_BL', 'Leg_BR'):
        key(pose[leg], f, [(SWING, deg(35) * hop)])
    key(pose['Ear_L'], f, [(YAW, deg(30) * hop)])
    key(pose['Ear_R'], f, [(YAW, deg(-30) * hop)])


stationary('startle', 12, startle, samples=12)

bpy.ops.object.mode_set(mode='OBJECT')

# ---------------------------------------------------------------------------------------------
# export
# ---------------------------------------------------------------------------------------------

bpy.ops.object.select_all(action='DESELECT')
sheep.select_set(True)
rig.select_set(True)
bpy.context.view_layer.objects.active = rig
bpy.ops.export_scene.gltf(
    filepath=OUT,
    export_format='GLB',
    use_selection=True,
    export_yup=True,
    export_apply=True,
    export_skins=True,
    export_animations=True,
    export_animation_mode='ACTIONS',
    export_frame_range=False,
    export_force_sampling=True,
    export_optimize_animation_size=True,
    export_bake_animation=False,
    export_texcoords=False,
    export_normals=True,
    export_materials='EXPORT',
    export_vertex_color='ACTIVE',
    export_all_vertex_colors=False,
    export_cameras=False,
    export_lights=False,
)
print('wrote', OUT, 'verts', len(mesh.vertices), 'faces', len(mesh.polygons))
