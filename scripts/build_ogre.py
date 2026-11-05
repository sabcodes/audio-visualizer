"""Rebuild the original rigged swamp ogre. Run with Blender --background --python.

No textures, external assets, saved .blend files, or machine metadata are needed.
Coordinates below use the app's Y-up, +Z-facing convention.
"""
import bpy
import math
import random
from pathlib import Path
from mathutils import Vector

random.seed(404)
ROOT = Path(__file__).resolve().parents[1]
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)

def point(v):
    return Vector((v[0], -v[2], v[1]))

def material(name, hex_color, roughness=.65, metal=0, emission=0):
    rgb = [int(hex_color[i:i+2], 16)/255 for i in (0, 2, 4)]
    rgb = [v/12.92 if v <= .04045 else ((v+.055)/1.055)**2.4 for v in rgb]
    m = bpy.data.materials.new(name)
    m.diffuse_color = (*rgb, 1)
    m.use_nodes = True
    shader = m.node_tree.nodes.get('Principled BSDF')
    shader.inputs['Base Color'].default_value = (*rgb, 1)
    shader.inputs['Roughness'].default_value = roughness
    shader.inputs['Metallic'].default_value = metal
    shader.inputs['Emission Color'].default_value = (*rgb, 1)
    shader.inputs['Emission Strength'].default_value = emission
    return m

skin = material('skin', '718856', .72)
light_skin = material('skin_light', '94A26A', .68)
dark_skin = material('skin_shadow', '43533B')
cloth = material('cloth', '352B30', .95)
leather = material('leather', '654332', .85)
metal = material('forged_iron', '738985', .43, .7)
gold = material('aged_brass', 'B99557', .46, .65)
ivory = material('horn', 'DDD2AB', .5)
mouth = material('mouth_cavity', '100D18', .85)
tongue = material('tongue', '99565F', .5)
eyes = material('emissive_eye', 'FFC064', .32, 0, 1.5)
fungus = material('emissive_fungus', '59F4BA', .5, 0, 1.2)
wood = material('club_wood', '503B32', .85)

parts = []
def finish(o, name, mat, bone):
    o.name = name
    o.data.materials.append(mat)
    bpy.context.view_layer.objects.active = o
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    for face in o.data.polygons:
        face.use_smooth = True
    if bone:
        g = o.vertex_groups.new(name=bone)
        g.add(list(range(len(o.data.vertices))), 1, 'REPLACE')
        parts.append(o)
    return o

def ellipsoid(name, at, size, mat=skin, bone='Head', segments=28, rings=18):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=segments, ring_count=rings, location=point(at))
    o = bpy.context.object
    o.scale = (size[0], size[2], size[1])
    return finish(o, name, mat, bone)

def tube(name, coords, radii, mat, bone, sides=12):
    vertices, faces = [], []
    for i, (p, r) in enumerate(zip(coords, radii)):
        p = point(p)
        direction = point(coords[min(i+1, len(coords)-1)])-point(coords[max(i-1, 0)])
        direction.normalize()
        u = direction.cross(Vector((0, 1, 0)))
        if u.length < .01:
            u = direction.cross(Vector((1, 0, 0)))
        u.normalize()
        v = direction.cross(u).normalized()
        for j in range(sides):
            a = j*math.tau/sides
            vertices.append(p+r*(u*math.cos(a)+v*math.sin(a)))
        if i:
            for j in range(sides):
                a, b = (i-1)*sides+j, (i-1)*sides+(j+1)%sides
                faces.append((a, b, b+sides, a+sides))
    faces.extend([tuple(reversed(range(sides))), tuple(range(len(vertices)-sides, len(vertices)))])
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    o = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(o)
    return finish(o, name, mat, bone)

def sculpt(name, shapes, bone, voxel=.05, mat=skin):
    pieces = [ellipsoid(name, at, size, mat, None, 24, 16) for at, size in shapes]
    bpy.ops.object.select_all(action='DESELECT')
    for o in pieces:
        o.select_set(True)
    bpy.context.view_layer.objects.active = pieces[0]
    bpy.ops.object.join()
    o = pieces[0]
    remesh = o.modifiers.new('Continuous sculpted surface', 'REMESH')
    remesh.mode = 'VOXEL'
    remesh.voxel_size = voxel
    remesh.use_smooth_shade = True
    bpy.ops.object.modifier_apply(modifier=remesh.name)
    smooth = o.modifiers.new('Relax sculpt', 'SMOOTH')
    smooth.factor = .8
    smooth.iterations = 4
    bpy.ops.object.modifier_apply(modifier=smooth.name)
    o.vertex_groups.clear()
    g = o.vertex_groups.new(name=bone)
    g.add(list(range(len(o.data.vertices))), 1, 'REPLACE')
    o.name = name
    parts.append(o)
    return o

# Broad chest, heavy belly and trapezius form one continuous surface.
body = sculpt('body', [((0,2.4,0),(.86,.83,.57)), ((0,2.94,-.04),(1.04,.55,.57)),
    ((0,3.2,-.1),(.62,.43,.42)), ((-.8,3.04,0),(.46,.38,.44)), ((.8,3.04,0),(.46,.38,.44))], 'Spine2', .065)
body.vertex_groups.clear()
for name in ['Hips', 'Spine', 'Spine2']:
    body.vertex_groups.new(name=name)
for v in body.data.vertices:
    y = v.co.z
    if y < 2.3:
        t = max(0, min(1, (y-1.85)/.45)); weights = [('Hips',1-t),('Spine',t)]
    else:
        t = max(0, min(1, (y-2.3)/.55)); weights = [('Spine',1-t),('Spine2',t)]
    for bone, weight in weights:
        if weight > 0:body.vertex_groups[bone].add([v.index], weight, 'REPLACE')
ellipsoid('belly', (0,2.42,.38), (.71,.59,.3), light_skin, 'Belly')
ellipsoid('navel', (0,2.16,.677), (.06,.045,.015), dark_skin, 'Belly', 16, 10)

# Face: rounded cheeks, heavy asymmetric brows, nose, an actual opening and articulated chin.
sculpt('head', [((0,3.99,0),(.66,.61,.51)), ((-.42,3.78,.27),(.3,.3,.3)), ((.42,3.78,.27),(.3,.3,.3)),
    ((0,3.89,.51),(.2,.2,.25)), ((0,3.79,.49),(.43,.14,.21))], 'Head', .033)
ellipsoid('mouth_interior', (0,3.61,.57), (.47,.27,.18), mouth)
sculpt('jaw', [((0,3.44,.28),(.51,.26,.38)), ((0,3.51,.53),(.44,.14,.23))], 'Jaw', .037, light_skin)
ellipsoid('tongue', (0,3.55,.62), (.28,.05,.12), tongue, 'Jaw')
for sign in [-1,1]:
    x = sign*.29
    ellipsoid('eye_socket', (x,4.03,.457), (.215,.15,.075), dark_skin)
    ellipsoid('eye_white', (x,4.035,.505), (.148,.09,.055), ivory)
    ellipsoid('iris', (x-sign*.015,4.03,.556), (.066,.073,.025), eyes)
    ellipsoid('pupil', (x-sign*.015,4.03,.58), (.024,.056,.012), mouth, segments=16, rings=10)
    tube('heavy_brow', [(sign*.08,4.09,.54),(sign*.24,4.18,.52),(sign*.43,4.17,.47),(sign*.53,4.11,.37)], [.07,.105,.09,.025], skin, 'Brow')
    tube('lower_eyelid', [(sign*.12,4.0,.53),(sign*.28,3.955,.54),(sign*.46,4.005,.46)], [.035,.045,.02], light_skin, 'Head')
    ellipsoid('nostril', (sign*.105,3.86,.72), (.06,.035,.027), dark_skin, segments=18, rings=12)
    tube('pointed_ear', [(sign*.55,3.99,.0),(sign*.8,4.03,.02),(sign*1.03,4.2,.01)], [.17,.14,.005], skin, 'Head', 16)
    tube('ear_inner', [(sign*.66,4.02,.12),(sign*.85,4.08,.1),(sign*.97,4.17,.04)], [.07,.055,.002], dark_skin, 'Head')
    tube('curved_horn', [(sign*.48,4.37,-.1),(sign*.69,4.53,-.12),(sign*.81,4.76,-.09),(sign*.75,4.94,.02),(sign*.58,5.02,.08)], [.18,.145,.095,.04,.001], ivory, 'Head', 18)
    tube('lower_tusk', [(sign*.39,3.5,.63),(sign*.43,3.68,.76),(sign*.4,3.9,.77)], [.11,.075,.001], ivory, 'Jaw', 16)
    for i in range(3):
        tx = sign*(.07+i*.09)
        ellipsoid('upper_tooth', (tx,3.718,.69), (.043,.065,.041), ivory, segments=16, rings=10)
        ellipsoid('lower_tooth', (tx,3.55,.72), (.042,.055,.042), ivory, 'Jaw', 16, 10)
    # Scar is geometry, so it remains legible under changing light without a texture.
    if sign==1:
        tube('cheek_scar', [(.47,3.99,.48),(.5,3.9,.49),(.48,3.81,.52)], [.012,.015,.009], light_skin, 'Head', 8)

# Thick articulated limbs and fingers; the left hand is open, the right grips a club.
for side,sign in [('Left',1),('Right',-1)]:
    sculpt('upper_arm_'+side, [((sign*1.03,3.0,0),(.4,.39,.4)), ((sign*1.26,2.67,.01),(.32,.44,.32))], side+'Arm', .06)
    sculpt('forearm_'+side, [((sign*1.4,2.22,.07),(.31,.34,.32)), ((sign*1.53,1.89,.14),(.26,.35,.26))], side+'ForeArm', .05)
    ellipsoid('hand_'+side, (sign*1.6,1.53,.17), (.28,.3,.22), skin, side+'Hand')
    for finger in range(4):
        fx = sign*(1.39+finger*.135)
        front = .23 if side=='Left' else .34
        tube('finger_'+side, [(fx,1.49,front),(fx,1.26,front+.03),(fx,1.18,front-.06)], [.077,.069,.052], skin, side+'Hand')
        ellipsoid('knuckle', (fx,1.52,front+.055), (.071,.066,.038), light_skin, side+'Hand', 16, 10)
    tube('thumb_'+side, [(sign*1.37,1.61,.24),(sign*1.29,1.44,.37),(sign*1.37,1.35,.4)], [.11,.09,.055], skin, side+'Hand')
    ellipsoid('thigh_'+side, (sign*.51,1.54,0), (.4,.57,.4), skin, side+'UpLeg')
    ellipsoid('trousers_'+side, (sign*.5,1.66,0), (.425,.42,.425), cloth, side+'UpLeg')
    ellipsoid('calf_'+side, (sign*.57,.84,.02), (.29,.49,.3), skin, side+'Leg')
    ellipsoid('boot_'+side, (sign*.57,.32,.14), (.34,.31,.47), leather, side+'Foot')
    ellipsoid('boot_sole_'+side, (sign*.57,.12,.17), (.355,.105,.48), cloth, side+'Foot')
    for y in [.48,.64]:
        tube('boot_lacing', [(sign*.79,y,.28),(sign*.4,y+.05,.28)], [.025,.025], gold, side+'Leg', 8)
    for y in [1.81,2.03]:
        # Rings around the forearm, with small rivets along the front.
        coords=[(sign*1.51+.267*math.cos(a),y,.14+.267*math.sin(a)) for a in [i*math.tau/24 for i in range(25)]]
        tube('bracer_binding',coords,[.045]*len(coords),leather,side+'ForeArm',8)
        for dx in [-.13,0,.13]:ellipsoid('bracer_rivet',(sign*1.51+dx,y,.405),(.035,.035,.025),gold,side+'ForeArm',12,8)

# Ragged skirt panels, belt and an asymmetrical forged pauldron.
for i in range(12):
    a = i*math.tau/12
    x,z = .76*math.cos(a),.49*math.sin(a)
    coords=[(x,1.99,z),(x*1.08,1.7,z*1.15),(x*1.08,1.32+random.random()*.14,z*1.2)]
    tube('ragged_leather_panel',coords,[.18,.18,.025],leather if i%3 else cloth,'Hips',8)
coords=[(.84*math.cos(a),2.0,.55*math.sin(a)) for a in [i*math.tau/40 for i in range(41)]]
tube('waist_belt',coords,[.095]*len(coords),leather,'Hips',10)
ellipsoid('belt_buckle',(0,2.0,.64),(.17,.13,.04),gold,'Hips')
ellipsoid('buckle_inset',(0,2.0,.68),(.1,.07,.01),mouth,'Hips')
ellipsoid('shoulder_pauldron',(1.02,3.19,0),(.47,.24,.47),metal,'LeftShoulder')
for i in range(5):
    a = i*math.pi/4
    x,z=1.02+.29*math.cos(a),.29*math.sin(a)
    tube('pauldron_spike',[(x,3.3,z),(x+.04,3.58+random.random()*.1,z)],[.085,.001],ivory,'LeftShoulder')
for x,y,z,size in [(1.16,3.29,-.28,.13),(.9,3.35,-.31,.1),(.69,3.2,-.25,.09)]:
    tube('mushroom_stem',[(x,y,z),(x,y+.16,z)],[.035,.025],ivory,'LeftShoulder')
    ellipsoid('mushroom_cap',(x,y+.17,z),(size,.065,size),fungus,'LeftShoulder',20,12)
for sign in [-1,1]:
    tube('chest_harness',[(sign*.76,3.2,.38),(sign*.42,2.9,.58),(0,2.65,.665)], [.075,.085,.06],leather,'Spine2')
ellipsoid('pendant',(0,2.72,.73),(.1,.14,.045),fungus,'Spine2')

# Heavy wood-and-iron club. The hand attachment and tip socket are exported with the rig.
tube('club_handle',[(-1.66,1.24,.27),(-1.66,2.54,.27)],[.095,.12],wood,'RightHand',18)
tube('club_head',[(-1.66,2.39,.27),(-1.66,2.64,.27),(-1.66,3.27,.27),(-1.66,3.49,.27)],[.16,.29,.34,.21],wood,'RightHand',24)
for y in [2.65,3.21]:
    coords=[(-1.66+.32*math.cos(a),y,.27+.32*math.sin(a)) for a in [i*math.tau/28 for i in range(29)]]
    tube('club_iron_band',coords,[.055]*len(coords),metal,'RightHand',10)
    for i in range(6):
        a=i*math.tau/6
        tube('club_spike',[(-1.66+.31*math.cos(a),y,.27+.31*math.sin(a)),(-1.66+.53*math.cos(a),y+.08,.27+.53*math.sin(a))],[.07,.001],ivory,'RightHand')
for i in range(3):
    y=2.77+i*.12
    tube('club_glowing_rune',[(-1.76,y,.59),(-1.65,y+.06,.61),(-1.56,y,.59)],[.018,.018,.018],fungus,'RightHand',8)

# All joints share upright rest axes: runtime posing no longer depends on inconsistent imported bone rolls.
joint = {
 'Hips':(None,(0,1.9,0)), 'Spine':('Hips',(0,2.2,0)), 'Spine1':('Spine',(0,2.5,0)), 'Spine2':('Spine1',(0,2.8,0)),
 'Neck':('Spine2',(0,3.25,0)), 'Head':('Neck',(0,3.65,0)), 'Jaw':('Head',(0,3.64,.16)), 'Brow':('Head',(0,4.1,.35)),
 'Belly':('Spine',(0,2.4,.1)), 'HeadTop_End':('Head',(0,4.6,0)),
}
for side,sign in [('Left',1),('Right',-1)]:
    for name,parent,p in [('Shoulder','Spine2',(sign*1.0,3.04,0)),('Arm',side+'Shoulder',(sign*1.04,3.0,0)),
       ('ForeArm',side+'Arm',(sign*1.39,2.28,.07)),('Hand',side+'ForeArm',(sign*1.59,1.61,.17)),('Fist_End',side+'Hand',(sign*1.6,1.25,.2)),
       ('UpLeg','Hips',(sign*.51,1.88,0)),('Leg',side+'UpLeg',(sign*.57,1.03,0)),('Foot',side+'Leg',(sign*.57,.42,.1)),('ToeBase',side+'Foot',(sign*.57,.18,.48))]:
        joint[side+name]=(parent,p)
arm = bpy.data.armatures.new('Ogre skeleton')
rig = bpy.data.objects.new('Swamp Ogre',arm)
bpy.context.collection.objects.link(rig)
bpy.context.view_layer.objects.active=rig
rig.select_set(True)
bpy.ops.object.mode_set(mode='EDIT')
for name,(parent,at) in joint.items():
    b=arm.edit_bones.new(name);b.head=point(at);b.tail=b.head+Vector((0,0,.15))
    if parent:b.parent=arm.edit_bones[parent]
bpy.ops.object.mode_set(mode='OBJECT')

# Merge by semantic part and preserve vertex weights; keep draw calls modest.
groups={}
for o in parts:
    key = 'head' if o.vertex_groups[0].name in ('Head','Brow') else 'jaw' if o.vertex_groups[0].name=='Jaw' else 'club' if o.name.startswith('club_') else o.vertex_groups[0].name
    groups.setdefault(key,[]).append(o)
for name,objects in groups.items():
    bpy.ops.object.select_all(action='DESELECT')
    for o in objects:o.select_set(True)
    bpy.context.view_layer.objects.active=objects[0]
    bpy.ops.object.join();o=objects[0];o.name='ogre_'+name if name in joint else name
    modifier=o.modifiers.new('Ogre rig','ARMATURE');modifier.object=rig
    o.parent=rig

def socket(name,bone,at):
    o=bpy.data.objects.new(name,None);bpy.context.collection.objects.link(o)
    o.parent=rig;o.parent_type='BONE';o.parent_bone=bone
    # Bone parenting adds the bone's tail translation; compensate to keep the authored world position.
    o.matrix_world.translation=point(at)
    bpy.context.view_layer.update()
    o.matrix_world.translation=point(at)
    return o

socket('socket_mouth','Head',(0,3.61,.79))
socket('socket_club_tip','RightHand',(-1.66,3.48,.27))
socket('socket_foot_L','LeftFoot',(.57,.1,.2))
socket('socket_foot_R','RightFoot',(-.57,.1,.2))

# Keep the figure asset's established clip contract, with smooth anticipation and follow-through.
durations={'idle':4,'groove':1,'arm_swing':2,'clap_overhead':1,'stomp_L':1,'stomp_R':1,'roar':2,'chest_beat':1,'look_around':3}
rig.animation_data_create()
for name,seconds in durations.items():
    action=bpy.data.actions.new(name);rig.animation_data.action=action
    for i in range(17):
        t=i/16;wave=math.sin(t*math.tau)
        for b in rig.pose.bones:
            b.rotation_mode='XYZ';b.rotation_euler=(0,0,0);b.location=(0,0,0)
        rig.pose.bones['Spine2'].rotation_euler.x=.025*wave
        if name=='roar':rig.pose.bones['Jaw'].rotation_euler.x=.7*math.sin(math.pi*t)**2
        elif name in ('groove','arm_swing','clap_overhead'):
            rig.pose.bones['LeftArm'].rotation_euler.x=.25*wave
            rig.pose.bones['RightArm'].rotation_euler.x=-.25*wave
        elif name=='look_around':rig.pose.bones['Head'].rotation_euler.y=.35*wave
        elif name.startswith('stomp'):rig.pose.bones['LeftUpLeg' if name.endswith('L') else 'RightUpLeg'].rotation_euler.x=-.3*math.sin(math.pi*t)
        for b in rig.pose.bones:b.keyframe_insert('rotation_euler',frame=1+t*seconds*30,group=b.name)
    track=rig.animation_data.nla_tracks.new();track.name=name;track.strips.new(name,1,action)
rig.animation_data.action=None
for track in rig.animation_data.nla_tracks:track.mute=True
for b in rig.pose.bones:b.rotation_euler=(0,0,0)
bpy.context.scene.frame_set(1)
bpy.ops.object.select_all(action='SELECT')
out=ROOT/'src/assets/models/swamp_giant.glb'
bpy.ops.export_scene.gltf(filepath=str(out),export_format='GLB',export_animations=True,export_animation_mode='ACTIONS',
    export_anim_single_armature=True,export_skins=True,export_extras=False,export_yup=True,export_apply=False)
print('OGRE_ASSET',out.stat().st_size,'bytes')
