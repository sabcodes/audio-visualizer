"""Resculpt the supplied dragon while retaining its rig and animation clips.

Run: blender --background --factory-startup --python scripts/refine_dragon.py
The original delivery ZIP is the repeatable source; no .blend/cache is retained.
"""
import bpy
import math
import json
import struct
import tempfile
import zipfile
from pathlib import Path
from mathutils import Vector, Matrix, Quaternion
from mathutils.bvhtree import BVHTree

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'Model assets/Wave4.5 /dragon_v1_final.zip'
OUTPUT = ROOT / 'src/assets/models/dragon_hd.glb'

bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
with zipfile.ZipFile(SOURCE) as archive:
    with tempfile.NamedTemporaryFile(suffix='.glb', dir=OUTPUT.parent) as source:
        source.write(archive.read('dragon_v1_final/dragon_v1.glb'))
        source.flush()
        bpy.ops.import_scene.gltf(filepath=source.name)

rig = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
rig.data.pose_position = 'REST'

def cubic(a, b, c, d, t):
    return .5*(2*b+(-a+c)*t+(2*a-5*b+4*c-d)*t*t+(-a+3*b-3*c+d)*t**3)

def sweep(name, points, radii, bone, material='mat_body', rings=32, sides=24, sculpt=None, weights=None):
    """Quad surface around a smooth anatomical centreline; all coordinates are rest-space."""
    points = [Vector(p) for p in points]
    vertices, faces, parameters = [], [], []
    for i in range(rings):
        parameter = (len(points)-1)*i/(rings-1)
        segment = min(len(points)-2, int(parameter))
        t = parameter-segment
        ids = [max(0, min(len(points)-1, segment+j)) for j in (-1, 0, 1, 2)]
        a, b, c, d = [points[j] for j in ids]
        center = cubic(a, b, c, d, t)
        tangent = (.5*((-a+c)+2*(2*a-5*b+4*c-d)*t+3*(-a+3*b-3*c+d)*t*t)).normalized()
        if weights:
            # Limbs have straight bones and hinges. A Catmull-Rom centreline
            # gives them a permanent rubbery S-bend even before skinning.
            center = b.lerp(c, t)
            tangent = (c-b).normalized()
        u = (Vector((1, 0, 0))-tangent*tangent.x).normalized()
        if u.length < .01:
            u = Vector((0, 1, 0)).cross(tangent).normalized()
        w = u.cross(tangent).normalized()
        rx, rz = [max(.00015, cubic(*(radii[j][k] for j in ids), t)) for k in (0, 1)]
        if weights:
            # The attachment cap must stay buried inside the torso when the
            # thigh rotates; a full-width root disk becomes visibly exposed.
            attachment = max(0, min(1, parameter/.3))
            attachment = attachment*attachment*(3-2*attachment)
            rx, rz = [.012+(radius-.012)*attachment for radius in (rx, rz)]
        for j in range(sides):
            angle = math.tau*j/sides
            co = center+u*(rx*math.cos(angle))+w*(rz*math.sin(angle))
            vertices.append(sculpt(co) if sculpt else co)
            parameters.append(parameter)
            if i:
                nxt = (j+1)%sides
                faces.append(((i-1)*sides+j, i*sides+j, i*sides+nxt, (i-1)*sides+nxt))
    faces.extend([tuple(range(sides)), tuple(reversed(range((rings-1)*sides, rings*sides)))])
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(vertices, [], faces)
    mesh.materials.append(bpy.data.materials[material])
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    obj.parent = rig
    modifier = obj.modifiers.new('Dragon skeleton', 'ARMATURE')
    modifier.object = rig
    if weights:
        groups = {name: obj.vertex_groups.new(name=name) for name in weights}
        # Blend only around the actual joint; mid-bone vertices must not be
        # pulled by the next joint's rotation.
        for i, parameter in enumerate(parameters):
            influences = {min(len(weights)-1, int(parameter)): 1}
            for joint in range(1, len(weights)):
                if abs(parameter-joint) <= .38:
                    t = (parameter-joint+.38)/.76
                    t = t*t*(3-2*t)
                    influences = {joint-1: 1-t, joint: t}
                    break
            for index, weight in influences.items():
                groups[weights[index]].add([i], weight, 'REPLACE')
    else:
        obj.vertex_groups.new(name=bone).add(list(range(len(vertices))), 1, 'REPLACE')
    return obj

def remove_parts(predicate):
    for obj in list(bpy.data.objects):
        if obj.type == 'MESH' and predicate(obj.name):
            bpy.data.objects.remove(obj, do_unlink=True)

mouth_material = bpy.data.materials.new('mat_mouth_tissue')
mouth_material.use_nodes = True
mouth_material.diffuse_color = (.16, .045, .055, 1)
mouth_shader = mouth_material.node_tree.nodes.get('Principled BSDF')
mouth_shader.inputs['Base Color'].default_value = mouth_material.diffuse_color
mouth_shader.inputs['Roughness'].default_value = .5

# A wedge-shaped reptile skull replaces the rounded capsule. The eye orbits
# stay in their authored positions, preserving the rig and mouth contacts.
remove_parts(lambda name: name in ('head', 'jaw') or name.startswith(('tooth_up_', 'tooth_low_', 'claw_')) or name.endswith(('FrontLeg', 'HindLeg')))
skull = [(-2.73,.012,.07,.015), (-2.67,.08,.14,.015), (-2.55,.115,.17,.01),
         (-2.4,.12,.205,.01), (-2.25,.125,.265,.015), (-2.12,.19,.31,-.035),
         (-1.99,.18,.275,-.05), (-1.86,.12,.18,-.06), (-1.8,.075,.13,-.04)]

def skull_sculpt(co):
    side = 1 if co.x >= 0 else -1
    orbit = math.exp(-((co.y+2.233)/.075)**2-((co.z-.218)/.043)**2)
    co.x -= side*.025*orbit
    if co.z > .12:
        co.z += .025*math.exp(-((co.y+2.4)/.22)**2-(co.x/.055)**2)
    return co

sweep('head', [(0,y,(top+bottom)/2) for y,_,top,bottom in skull],
      [(width,(top-bottom)/2) for _,width,top,bottom in skull], 'Head', rings=72, sides=40, sculpt=skull_sculpt)
mandible = [(-2.73,.008,-.045,-.085), (-2.66,.075,-.04,-.135), (-2.5,.11,-.035,-.155),
            (-2.28,.125,-.03,-.19), (-2.06,.145,-.025,-.19), (-1.86,.11,-.02,-.135), (-1.78,.06,-.025,-.10)]
sweep('jaw', [(0,y,(top+bottom)/2) for y,_,top,bottom in mandible],
      [(width,(top-bottom)/2) for _,width,top,bottom in mandible], 'Jaw', rings=56, sides=32)
for side, sign in [('L',1), ('R',-1)]:
    sweep('brow_'+side, [(sign*.06,-2.34,.215),(sign*.09,-2.29,.245),(sign*.13,-2.22,.278),(sign*.145,-2.12,.265)],
          [(.009,.012),(.025,.028),(.03,.026),(.005,.006)], 'Head', rings=28, sides=16)
    sweep('cheek_ridge_'+side, [(sign*.16,-2.14,.22),(sign*.19,-2.06,.165),(sign*.14,-1.96,.105)],
          [(.006,.008),(.019,.025),(.004,.006)], 'Head', rings=20, sides=16)
    # A vertical dark pupil remains visible on the luminous iris, rather than
    # a featureless glowing dot. The surrounding blue eyelid casts a brow shadow.
    center = Vector((sign*.124,-2.233,.2182))
    sweep('pupil_'+side, [center+Vector((0,0,-.013)), center, center+Vector((0,0,.013))],
          [(.0008,.0008),(.0024,.003),(.0008,.0008)], 'Head', 'mat_dark', rings=16, sides=12)
    sweep('lower_eyelid_'+side, [(sign*.12,-2.255,.216),(sign*.125,-2.233,.199),(sign*.12,-2.209,.216)],
          [(.003,.003),(.006,.005),(.003,.003)], 'Head', rings=20, sides=12)
    for row, bone, direction, count in [('up','Head',-1,8), ('low','Jaw',1,7)]:
        for tooth in range(count):
            y = -2.63+tooth*.074
            x = sign*(.065+.055*math.sin((tooth+.5)/count*math.pi))
            z = -.012 if row=='up' else -.04
            length = (.055 if tooth in (1,4) else .032)*(1 if row=='up' else .82)
            sweep(f'tooth_{row}_{side}_{tooth}', [(x,y,z),(x,y+.008,z+direction*length*.55),(x*.96,y+.02,z+direction*length)],
                  [(.011,.012),(.007,.008),(.0002,.0002)], bone, 'mat_horn', rings=12, sides=12)
        z = .002 if row=='up' else -.045
        sweep(f'gum_{row}_{side}', [(sign*.065,-2.65,z),(sign*.112,-2.42,z),(sign*.11,-2.12,z)],
              [(.01,.012),(.013,.014),(.008,.01)], bone, 'mat_mouth_tissue', rings=20, sides=12)
sweep('tongue', [(0,-2.61,-.073),(0,-2.4,-.075),(0,-2.14,-.09)],
      [(.008,.005),(.067,.019),(.04,.012)], 'Jaw', 'mat_mouth_tissue', rings=24, sides=16)
for name in ('nostril_L','nostril_R'):
    for vertex in bpy.data.objects[name].data.vertices:
        vertex.co.z += .017

# Muscular upper limbs, a visible elbow/knee, slender wrist/ankle and spread
# digits replace the old undifferentiated tubes and triangular foot tips.
for side, sign in [('Left',1), ('Right',-1)]:
    for kind in ('Front','Hind'):
        names = [f'{side}{kind}{suffix}' for suffix in (['Root','Elbow','Wrist','Toe'] if kind=='Front' else ['Root','Knee','Ankle','Toe'])]
        points = [rig.data.bones[name].head_local.copy() for name in names]
        radii = [(.155,.135),(.085,.088),(.052,.045),(.084,.032)] if kind=='Front' else [(.19,.17),(.108,.10),(.052,.043),(.09,.035)]
        # Expand the biceps/quadriceps between the attachment and the joint,
        # leaving a distinct constriction at each elbow or knee.
        def muscle(co, points=points):
            start, end = points[0], points[1]
            axis = end-start
            t = max(0, min(1, (co-start).dot(axis)/axis.length_squared))
            center = start+axis*t
            radial = co-center
            if (co-start).length < axis.length*1.06:
                co += radial*.19*math.sin(math.pi*t)**2
            return co
        sweep(f'{side}{kind}Leg', points, radii, names[0], rings=42, sides=24, sculpt=muscle, weights=names)
        palm = points[-1]
        direction = 1 if kind=='Front' else -1
        for digit in range(4):
            offset = (digit-1.5)*.047
            root = palm+Vector((offset*.55, -.012*direction, .002))
            length = .15 if digit in (1,2) else .115
            tip = palm+Vector((offset*1.4,direction*length,-.035))
            mid = root.lerp(tip,.55)+Vector((0,0,.015))
            sweep(f'{side}{kind}_digit_{digit}', [root,mid,tip],
                  [(.028,.023),(.022,.022),(.012,.013)], names[-1], rings=16, sides=14)
            sweep(f'{side}{kind}_talon_{digit}', [tip,tip+Vector((offset*.12,direction*.055,-.008)),tip+Vector((offset*.16,direction*.085,-.07))],
                  [(.018,.017),(.012,.014),(.0002,.0002)], names[-1], 'mat_horn', rings=16, sides=14)

def neck_warp(co):
    co = co.copy()
    t = max(0, min(1, (-co.y-.45)/1.4))
    ease = t*t*(3-2*t)
    co.y -= .45*ease
    co.z += .65*ease + .15*math.sin(math.pi*t)**2
    return co

# Lengthen and raise the cervical chain as well as its skin. Moving only the
# surface would put the jaw, eye sockets and fire emitter on the old head.
for obj in bpy.data.objects:
    if obj.type == 'MESH':
        for v in obj.data.vertices:
            if obj.name == 'head' and v.co.z > .04:
                # Orbital ridges and a nasal crest break up the round capsule
                # skull while leaving the eye, nostril and tooth contacts alone.
                brow = .055*math.exp(-((v.co.y+2.12)/.16)**2-((abs(v.co.x)-.145)/.065)**2)
                nose = .028*math.exp(-((v.co.y+2.43)/.18)**2-(v.co.x/.06)**2)
                v.co.z += (brow+nose)*min(1, (v.co.z-.04)/.09)
            v.co = neck_warp(v.co)
bpy.context.view_layer.objects.active = rig
bpy.ops.object.mode_set(mode='EDIT')
for bone in rig.data.edit_bones:
    bone.head = neck_warp(bone.head)
    bone.tail = neck_warp(bone.tail)
bpy.ops.object.mode_set(mode='OBJECT')

# Restore the supplied blue/cyan palette, retaining sculpted surface shading.
for name, colour in {
    'mat_body': (.1215686, .2470588, .5607843, 1), 'mat_belly': (.6235294, .7176471, .8509804, 1),
    'mat_horn': (.57, .46, .29, 1), 'mat_membrane': (.1803922, .5607843, .6509804, 1),
    'mat_dark': (.009, .012, .016, 1),
}.items():
    material = bpy.data.materials[name]
    material.diffuse_color = colour
    colour_input = material.node_tree.nodes.get('Principled BSDF').inputs['Base Color']
    # Imported glTF factors are linked through a colour-multiply node. Remove
    # that link or the exporter retains the old saturated factor.
    for link in list(colour_input.links):
        material.node_tree.links.remove(link)
    colour_input.default_value = colour
eye_shader = bpy.data.materials['emissive_eye'].node_tree.nodes.get('Principled BSDF')
eye_shader.inputs['Emission Color'].default_value = (.65, .23, .035, 1)

# A single quad surface replaces the old intersecting belly/neck fillets and
# the bulb with two prongs at the tail end. Blender coordinates: -Y is forward.
PROFILE = [
    (-1.94, .105, .12, -.025), (-1.6, .10, .14, .0),
    (-1.2, .115, .165, .0), (-.8, .165, .225, .0),
    (-.3, .365, .425, .015), (.15, .405, .475, -.01),
    (.65, .275, .33, .005), (1.05, .295, .30, .015),
    (1.45, .205, .205, .02), (1.85, .15, .15, .025),
    (2.25, .105, .105, .025), (2.65, .074, .073, .025),
    (3.05, .048, .048, .025), (3.4, .027, .029, .018),
    (3.7, .011, .013, .008), (3.98, .0003, .0003, .0),
]
PROFILE = [(neck_warp(Vector((0, y, center))).y, rx, rz, neck_warp(Vector((0, y, center))).z)
           for y, rx, rz, center in PROFILE]

def profile(y):
    i = next((i for i in range(len(PROFILE)-1) if y <= PROFILE[i+1][0]), len(PROFILE)-2)
    a, b = PROFILE[i], PROFILE[i+1]
    p, q = PROFILE[max(0, i-1)], PROFILE[min(len(PROFILE)-1, i+2)]
    span = b[0]-a[0]
    t = max(0, min(1, (y-a[0])/span))
    return [(2*t**3-3*t*t+1)*a[k] + (t**3-2*t*t+t)*(b[k]-p[k])/(b[0]-p[0])*span
            + (-2*t**3+3*t*t)*b[k] + (t**3-t*t)*(q[k]-a[k])/(q[0]-a[0])*span for k in (1, 2, 3)]

body = bpy.data.objects['body']
vertices, faces = [], []
rings, sides = 112, 48
for i in range(rings):
    y = PROFILE[0][0] + (PROFILE[-1][0]-PROFILE[0][0])*i/(rings-1)
    rx, rz, center = profile(y)
    for j in range(sides):
        a = math.tau*j/sides
        side = abs(math.cos(a))**4
        shoulder = math.exp(-((y+.22)/.29)**2)
        ribs = math.exp(-((y-.2)/.5)**4)
        cervical = math.exp(-((y+1.55)/.65)**4)
        # Paired pectoral/scapular masses, a sternum and a narrower flank give
        # the torso anatomy at silhouette scale, before any surface shading.
        muscle = .065*shoulder*math.exp(-((math.sin(a)-.28)/.48)**2)
        rib = .0045*math.sin(y*27+math.sin(a)*1.1)*ribs*side
        tendon = .012*cervical*math.exp(-((math.sin(a)+.12)/.22)**2)
        x = (rx+muscle+rib+tendon)*math.cos(a)
        z = center+rz*math.sin(a)
        if math.sin(a) < 0:
            z -= .045*shoulder*(-math.sin(a))**6
        vertices.append((x, y, z))
        if i:
            prev, nxt = (i-1)*sides+j, (j+1)%sides
            faces.append((prev, i*sides+j, i*sides+nxt, (i-1)*sides+nxt))
faces.extend([tuple(range(sides)), tuple(reversed(range((rings-1)*sides, rings*sides)))])
mesh = bpy.data.meshes.new('Continuous dragon anatomy')
mesh.from_pydata(vertices, [], faces)
mesh.materials.append(bpy.data.materials['mat_body'])
mesh.materials.append(bpy.data.materials['mat_belly'])
mesh.update()
for face in mesh.polygons:
    face.material_index = 1 if face.center.z < -.1 else 0
old = body.data
body.shape_key_clear()
body.data = mesh
if old.users == 0:
    bpy.data.meshes.remove(old)
body.shape_key_add(name='Basis')
for name, amount in [('pulse_expand', .012), ('pulse_contract', -.008)]:
    key = body.shape_key_add(name=name)
    for i, v in enumerate(mesh.vertices):
        envelope = math.exp(-((v.co.y-.15)/1.1)**4)*amount
        key.data[i].co.x += v.co.x*envelope
        key.data[i].co.z += v.co.z*envelope
for obj in list(bpy.data.objects):
    if obj.type != 'MESH':
        continue
    if obj.name.startswith('prong_'):
        bpy.data.objects.remove(obj, do_unlink=True)
    elif obj.name.startswith('spike_'):
        y = sum(v.co.y for v in obj.data.vertices)/len(obj.data.vertices)
        _, rz, center = profile(y)
        offset = center+rz-min(v.co.z for v in obj.data.vertices)-.018
        for v in obj.data.vertices:
            v.co.z += offset

def spine_weights(obj):
    names = ['Head'] + [f'Neck{i}' for i in range(6, 0, -1)] + ['Chest', 'Hips'] + [f'Tail{i}' for i in range(1, 11)] + ['TailTip']
    centers = [(name, (rig.data.bones[name].head_local.y + rig.data.bones[name].tail_local.y) / 2) for name in names]
    centers.sort(key=lambda item: item[1])
    obj.vertex_groups.clear()
    groups = {name: obj.vertex_groups.new(name=name) for name, _ in centers}
    for v in obj.data.vertices:
        i = next((i for i in range(len(centers)-1) if v.co.y < centers[i+1][1]), len(centers)-2)
        t = max(0, min(1, (v.co.y-centers[i][1])/(centers[i+1][1]-centers[i][1])))
        values = [(1-t)**3/6, (3*t**3-6*t*t+4)/6, (-3*t**3+3*t*t+3*t+1)/6, t**3/6]
        weights = {}
        for j, weight in enumerate(values):
            name = centers[max(0, min(len(centers)-1, i+j-1))][0]
            weights[name] = weights.get(name, 0) + weight
        for name, weight in weights.items():
            groups[name].add([v.index], weight, 'REPLACE')

def refine(obj):
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    for modifier in obj.modifiers:
        if modifier.type == 'ARMATURE':
            modifier.show_viewport = False
    # Weld export seams before relaxing the surface: separate belly/material
    # vertices otherwise shrink apart when subdivision is applied.
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.mesh.remove_doubles(threshold=0.00001)
    bpy.ops.mesh.tris_convert_to_quads(face_threshold=math.radians(40), shape_threshold=math.radians(40))
    bpy.ops.object.mode_set(mode='OBJECT')
    body = obj.name == 'body'
    if body:
        relax = obj.modifiers.new('Relax joint ridges', 'SMOOTH')
        relax.factor = 0.65
        relax.iterations = 5
    subdiv = obj.modifiers.new('Sculpted surface', 'SUBSURF')
    subdiv.levels = 2 if obj.name in ('body', 'head', 'jaw') or obj.name.endswith(('FrontLeg','HindLeg')) or obj.name.startswith('horn_') else 1
    subdiv.render_levels = subdiv.levels
    # Evaluate every shape through the same topology operations. Applying a
    # modifier directly to a shape-keyed mesh would discard its morph targets.
    keys = list(obj.data.shape_keys.key_blocks)[1:] if obj.data.shape_keys else []
    graph = bpy.context.evaluated_depsgraph_get()
    shapes = []
    for key in keys:
        key.value = 1
        graph.update()
        mesh = bpy.data.meshes.new_from_object(obj.evaluated_get(graph), preserve_all_data_layers=True, depsgraph=graph)
        shapes.append((key.name, [v.co.copy() for v in mesh.vertices]))
        bpy.data.meshes.remove(mesh)
        key.value = 0
    graph.update()
    mesh = bpy.data.meshes.new_from_object(obj.evaluated_get(graph), preserve_all_data_layers=True, depsgraph=graph)
    old = obj.data
    obj.shape_key_clear()
    obj.data = mesh
    for modifier in list(obj.modifiers):
        if modifier.type != 'ARMATURE':
            obj.modifiers.remove(modifier)
        else:
            modifier.show_viewport = True
    for face in mesh.polygons:
        face.use_smooth = True
    # Smaller muscle breathing retains the audio accent without inflating the
    # silhouette or exposing the bases of the separately attached dorsal spines.
    if shapes:
        obj.shape_key_add(name='Basis')
        for name, coords in shapes:
            key = obj.shape_key_add(name=name)
            for i, co in enumerate(coords):
                key.data[i].co = mesh.vertices[i].co.lerp(co, 0.25)
    if body or obj.name.startswith('spike_'):
        # Assign after subdivision so interpolation cannot introduce fifth
        # influences that the exporter would prune differently at each vertex.
        # Dorsal spine bases follow the same field as their attachment surface.
        spine_weights(obj)
    for colour in list(mesh.color_attributes):
        mesh.color_attributes.remove(colour)
    if old.users == 0:
        bpy.data.meshes.remove(old)

for obj in list(bpy.data.objects):
    if obj.type == 'MESH':
        refine(obj)

# Bake short-range contact occlusion into vertices. This supplies stable
# shading beneath the shoulders, jaw, wing roots and limbs without textures
# or adding lights to the user's environment.
objects = [o for o in bpy.data.objects if o.type == 'MESH']
world_vertices, world_faces = [], []
for obj in objects:
    offset = len(world_vertices)
    world_vertices.extend(obj.matrix_world @ v.co for v in obj.data.vertices)
    world_faces.extend(tuple(offset+i for i in face.vertices) for face in obj.data.polygons)
tree = BVHTree.FromPolygons(world_vertices, world_faces)
for obj in objects:
    colours = obj.data.color_attributes.new(name='dragon_contact_ao', type='FLOAT_COLOR', domain='POINT')
    obj.data.color_attributes.active_color = colours
    matrix = obj.matrix_world
    normal_matrix = matrix.to_3x3().inverted().transposed()
    for v in obj.data.vertices:
        n = (normal_matrix @ v.normal).normalized()
        u = n.cross(Vector((0, 0, 1)) if abs(n.z) < .9 else Vector((0, 1, 0))).normalized()
        w = n.cross(u)
        origin = matrix @ v.co + n*.002
        occluded = 0
        for sample in range(12):
            z = math.sqrt((sample+.5)/12)
            radius = math.sqrt(1-z*z)
            angle = sample*2.399963229728653
            direction = n*z + (u*math.cos(angle)+w*math.sin(angle))*radius
            hit, _, _, distance = tree.ray_cast(origin, direction, .24)
            if hit is not None:
                occluded += (1-distance/.24)**2
        ao = 1-.8*occluded/12
        colours.data[v.index].color = (ao, ao, ao, 1)
    print('CONTACT_AO', obj.name, flush=True)

rig.data.pose_position = 'POSE'
bpy.ops.export_scene.gltf(filepath=str(OUTPUT), export_format='GLB',
    export_animations=True, export_animation_mode='ACTIONS',
    export_morph=True, export_skins=True, export_all_influences=False,
    export_yup=True, export_extras=True, export_vertex_color='NAME',
    export_vertex_color_name='dragon_contact_ao', export_all_vertex_colors=False)

# Re-author the static legs-only flight pose in glTF's own joint coordinates.
# The old pose left the elbows/knees nearly straight and reversed direction
# at the wrists/ankles. All other clips, the skeleton and camera stay intact.
raw = OUTPUT.read_bytes()
json_length = struct.unpack_from('<I', raw, 12)[0]
document = json.loads(raw[20:20+json_length])
binary_start = 20+json_length+8
binary = bytearray(raw[binary_start:binary_start+document['buffers'][0]['byteLength']])
nodes = document['nodes']
by_name = {node['name']: i for i, node in enumerate(nodes) if 'name' in node}
parents = {child: i for i, node in enumerate(nodes) for child in node.get('children', [])}
rest_world = {}

def world(index):
    if index not in rest_world:
        node = nodes[index]
        if 'matrix' in node:
            local = Matrix([node['matrix'][row::4] for row in range(4)])
        else:
            q = node.get('rotation', [0,0,0,1])
            local = Matrix.LocRotScale(Vector(node.get('translation', [0,0,0])),
                Quaternion((q[3],q[0],q[1],q[2])), Vector(node.get('scale', [1,1,1])))
        rest_world[index] = world(parents[index]) @ local if index in parents else local
    return rest_world[index]

posed_world, rotations = {}, {}
def limb_frame(direction):
    axis = direction.normalized()
    lateral = (Vector((1,0,0))-axis*axis.x).normalized()
    return Matrix((lateral, axis, lateral.cross(axis))).transposed()

for side, sign in [('Left',1), ('Right',-1)]:
    for kind in ('Front','Hind'):
        chain = ['Root','Elbow','Wrist','Toe'] if kind=='Front' else ['Root','Knee','Ankle','Toe']
        # glTF +Z faces the head. Bring the front elbow forward, tuck the
        # forearm backward, and let the claws hang below the wrist.
        axes = [(sign*.25,-.65,.72),(sign*.06,-.45,-.89),(sign*.03,-.95,.31)] if kind=='Front' else [(sign*.30,-.56,.77),(sign*.04,-.70,-.71),(sign*.03,-.92,.39)]
        for joint, axis in enumerate(axes):
            index, child = [by_name[f'{side}{kind}{suffix}'] for suffix in chain[joint:joint+2]]
            rest_axis = world(child).translation-world(index).translation
            # Keep the same lateral plane through the chain. Independently
            # aiming each bone by shortest arc can roll a knee/ankle inward.
            aim = (limb_frame(Vector(axis)) @ limb_frame(rest_axis).transposed()).to_quaternion()
            desired = (aim @ world(index).to_quaternion()).normalized()
            parent = parents[index]
            parent_rotation = posed_world.get(parent, world(parent).to_quaternion())
            local = (parent_rotation.inverted() @ desired).normalized()
            posed_world[index] = desired
            rotations[index] = [local.x, local.y, local.z, local.w]

flight = next(clip for clip in document['animations'] if clip['name']=='flight_base')
for channel in flight['channels']:
    target = channel['target']
    if target['path'] != 'rotation' or target['node'] not in rotations:
        continue
    sampler = flight['samplers'][channel['sampler']]
    count = document['accessors'][sampler['input']]['count']
    values = rotations[target['node']]*count
    while len(binary)%4:
        binary.append(0)
    view = len(document['bufferViews'])
    document['bufferViews'].append({'buffer':0, 'byteOffset':len(binary), 'byteLength':len(values)*4})
    binary.extend(struct.pack('<'+'f'*len(values), *values))
    accessor = len(document['accessors'])
    document['accessors'].append({'bufferView':view, 'componentType':5126, 'count':count, 'type':'VEC4'})
    channel['sampler'] = len(flight['samplers'])
    flight['samplers'].append({'input':sampler['input'], 'output':accessor, 'interpolation':'LINEAR'})
document['buffers'][0]['byteLength'] = len(binary)
encoded = json.dumps(document, separators=(',',':')).encode()
encoded += b' '*((-len(encoded))%4)
binary.extend(b'\0'*((-len(binary))%4))
length = 12+8+len(encoded)+8+len(binary)
OUTPUT.write_bytes(struct.pack('<4sII',b'glTF',2,length)+struct.pack('<II',len(encoded),0x4e4f534a)+encoded
    +struct.pack('<II',len(binary),0x004e4942)+binary)
print('REFINED_DRAGON', OUTPUT.stat().st_size, 'bytes')
