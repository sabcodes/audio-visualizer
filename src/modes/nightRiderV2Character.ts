import * as THREE from 'three/webgpu';
import { abs, mix, normalView, normalWorld, texture, vec3 } from 'three/tsl';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';

const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
type Segment = { name: string; a: THREE.Vector3; b: THREE.Vector3; bone: THREE.Bone };

/** An experimental runtime rig for this specific unrigged A-pose asset. Source GLB is untouched. */
export function createNightRiderV2Character(gltf: GLTF, bike: THREE.Object3D) {
  const source = gltf.scene.children[0] as THREE.Mesh;
  const geometry = source.geometry.clone(); geometry.applyMatrix4(source.matrixWorld);
  geometry.computeBoundingBox();
  const bounds = geometry.boundingBox!, scale = 1.72 / (bounds.max.y - bounds.min.y);
  geometry.translate(-(bounds.min.x + bounds.max.x) / 2, -bounds.min.y, 0); geometry.scale(scale, scale, scale);
  const segments: Segment[] = [];
  const segment = (name: string, a: THREE.Vector3, b: THREE.Vector3) => {
    const bone = new THREE.Bone(); bone.name = `V2 ${name}`; bone.position.copy(a);
    const s = {name,a,b,bone}; segments.push(s); return s;
  };
  const hips = segment('hips', v(0,.83,0),v(0,1.02,0));
  const chest = segment('chest',v(0,1.02,0),v(0,1.35,0));
  const head = segment('head',v(0,1.35,0),v(0,1.68,0));
  const limbs = [-1,1].map(side => ({side,
    arm:segment(`arm ${side}`,v(side*.17,1.34,0),v(side*.33,1.14,0)),
    forearm:segment(`forearm ${side}`,v(side*.33,1.14,0),v(side*.47,.98,.01)),
    hand:segment(`hand ${side}`,v(side*.47,.98,.01),v(side*.54,.89,.02)),
    thigh:segment(`thigh ${side}`,v(side*.115,.84,0),v(side*.14,.46,0)),
    shin:segment(`shin ${side}`,v(side*.14,.46,0),v(side*.14,.13,0)),
    foot:segment(`foot ${side}`,v(side*.14,.13,0),v(side*.14,.045,.12)),
  }));
  const root = new THREE.Group(); root.name = 'Night Rider V2 character'; bike.add(root);
  const standard = source.material as THREE.MeshStandardMaterial;
  const material = new THREE.MeshBasicNodeMaterial({side:THREE.DoubleSide}); material.name = 'V2 textured anime cel';
  const diffuse = normalWorld.dot(vec3(-.35,.8,.55).normalize()).max(0);
  const bands = diffuse.smoothstep(.12,.18).mul(.2).add(diffuse.smoothstep(.6,.68).mul(.18)).add(.62);
  const rim = abs(normalView.z).oneMinus().pow(4);
  material.colorNode = texture(standard.map!).rgb.mul(bands).add(mix(vec3(.03,.2,.25),vec3(.2,.03,.16),normalWorld.x.mul(.5).add(.5)).mul(rim).mul(.35));
  const mesh = new THREE.SkinnedMesh(geometry,material); mesh.name='V2 supplied anime rider'; mesh.frustumCulled=false;
  root.add(mesh); for(const s of segments) mesh.add(s.bone);
  mesh.bind(new THREE.Skeleton(segments.map(s=>s.bone)));

  // The pale braid is part of the same mesh. Keep it on the head instead of weighting it to nearby legs.
  const image=standard.map!.image as CanvasImageSource & {width:number;height:number};
  const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;
  const ctx=canvas.getContext('2d')!;ctx.drawImage(image,0,0);
  const pixels=ctx.getImageData(0,0,canvas.width,canvas.height).data;
  const p=geometry.getAttribute('position'),uv=geometry.getAttribute('uv');
  const indices=new Uint16Array(p.count*4),weights=new Float32Array(p.count*4),point=v(0,0,0),delta=v(0,0,0),closest=v(0,0,0);
  const distance=(s:Segment)=>{delta.subVectors(s.b,s.a);const t=THREE.MathUtils.clamp(point.clone().sub(s.a).dot(delta)/delta.lengthSq(),0,1);return closest.copy(s.a).addScaledVector(delta,t).distanceToSquared(point);};
  for(let i=0;i<p.count;i++) {
    point.fromBufferAttribute(p,i);
    const pixel=(Math.min(canvas.height-1,Math.floor(uv.getY(i)*canvas.height))*canvas.width+Math.min(canvas.width-1,Math.floor(uv.getX(i)*canvas.width)))*4;
    const hair=point.y>.58 && Math.abs(point.x)<.2 && point.z<.02 && pixels[pixel]>155 && pixels[pixel+1]>155 && pixels[pixel+2]>155 && Math.abs(pixels[pixel]-pixels[pixel+2])<20;
    let candidates:Segment[];
    if(point.y>1.4 || hair) candidates=[head];
    else if((Math.abs(point.x)>.195 && point.y>.95) || (Math.abs(point.x)>.38 && point.y>.7)) {const l=limbs[point.x<0?0:1];candidates=[l.arm,l.forearm,l.hand];if(Math.abs(point.x)<.24)candidates.push(chest);}
    else if(point.y<.85) {const l=limbs[point.x<0?0:1];candidates=[l.thigh,l.shin,l.foot];if(point.y>.75)candidates.push(hips);}
    else candidates=[hips,chest,head];
    const ranked=candidates.map(s=>({s,d:distance(s)})).sort((a,b)=>a.d-b.d).slice(0,2);
    const raw=ranked.map(({d})=>1/Math.pow(d+.001,3)),sum=raw.reduce((a,b)=>a+b,0);
    ranked.forEach(({s},j)=>{indices[i*4+j]=segments.indexOf(s);weights[i*4+j]=raw[j]/sum;});
  }
  // Blur across topology and welded UV seams so cuffs, waist folds and dark braid creases
  // cannot split into long triangles at the anatomical region boundaries.
  const neighbours=Array.from({length:p.count},()=>new Set<number>()),welded=new Map<string,number>();
  for(let i=0;i<p.count;i++) {
    const key=`${Math.round(p.getX(i)*10000)},${Math.round(p.getY(i)*10000)},${Math.round(p.getZ(i)*10000)}`;
    const other=welded.get(key);if(other===undefined)welded.set(key,i);else {neighbours[i].add(other);neighbours[other].add(i);}
  }
  for(let i=0;i<geometry.index!.count;i+=3) {
    const a=geometry.index!.getX(i),b=geometry.index!.getX(i+1),c=geometry.index!.getX(i+2);
    for(const [x,y] of [[a,b],[b,c],[c,a]]) {neighbours[x].add(y);neighbours[y].add(x);}
  }
  const count=segments.length;
  let field=new Float32Array(p.count*count),next=field.slice();
  for(let i=0;i<p.count;i++)for(let j=0;j<4;j++)field[i*count+indices[i*4+j]]+=weights[i*4+j];
  for(let pass=0;pass<12;pass++) {
    for(let i=0;i<p.count;i++)for(let j=0;j<count;j++) {
      let total=field[i*count+j]*2;for(const n of neighbours[i])total+=field[n*count+j];
      next[i*count+j]=total/(2+neighbours[i].size);
    }
    [field,next]=[next,field];
  }
  for(let i=0;i<p.count;i++) {
    const ranked=segments.map((_,j)=>j).sort((a,b)=>field[i*count+b]-field[i*count+a]).slice(0,4);
    const sum=ranked.reduce((n,j)=>n+field[i*count+j],0);
    for(let j=0;j<4;j++){indices[i*4+j]=ranked[j];weights[i*4+j]=field[i*count+ranked[j]]/sum;}
  }
  geometry.setAttribute('skinIndex',new THREE.BufferAttribute(indices,4));geometry.setAttribute('skinWeight',new THREE.BufferAttribute(weights,4));
  const from=v(0,0,0),to=v(0,0,0);
  const pose=(s:Segment,a:THREE.Vector3,b:THREE.Vector3)=>{from.subVectors(s.b,s.a).normalize();to.subVectors(b,a).normalize();s.bone.quaternion.setFromUnitVectors(from,to);s.bone.position.copy(a);};
  // Two-bone reach preserves limb lengths and keeps hands/boots on the bike's controls.
  const joint=(a:THREE.Vector3,b:THREE.Vector3,l1:number,l2:number,pole:THREE.Vector3)=>{
    const axis=b.clone().sub(a),distance=Math.min(axis.length(),l1+l2-.001);axis.normalize();
    const along=(l1*l1-l2*l2+distance*distance)/(2*distance),height=Math.sqrt(Math.max(0,l1*l1-along*along));
    const bend=pole.clone().sub(a);bend.addScaledVector(axis,-bend.dot(axis)).normalize();return a.clone().addScaledVector(axis,along).addScaledVector(bend,height);
  };
  return { dispose(){mesh.skeleton.dispose();}, update(clip:string,phase:number,time:number,boost:number,motion?:string) {
    const stand=clip==='dismount'?THREE.MathUtils.smoothstep(phase,.18,.88):0;
    root.position.set(stand*.85,0,0);
    const tuck=(clip==='idle'?.72:.77)+boost*.035+(motion==='stoppie'?.07:0);
    const pelvis=v(0,THREE.MathUtils.lerp(.83,.86,stand),THREE.MathUtils.lerp(-.37,0,stand));
    const breathing=Math.sin(time*2.4)*.004;
    const torso=v(0,Math.cos(tuck*(1-stand)),Math.sin(tuck*(1-stand)));
    const waist=pelvis.clone().addScaledVector(torso,.19);
    const upper=waist.clone().addScaledVector(torso,.33); upper.y+=breathing;
    const neck=upper.clone().add(v(0,.015,.005));
    pose(hips,pelvis,waist);pose(chest,waist,upper);
    pose(head,neck,neck.clone().add(v(Math.sin(time*.6)*.012,.33,-.025)));
    for(const l of limbs) {
      const shoulder=upper.clone().add(v(l.side*.17,0,0));
      const wrist=v(l.side*THREE.MathUtils.lerp(.3,.47,stand),THREE.MathUtils.lerp(.98,.99,stand),THREE.MathUtils.lerp(.41,.01,stand));
      const elbow=joint(shoulder,wrist,.27,.25,shoulder.clone().add(v(l.side*.24,-.2,-.18)));
      pose(l.arm,shoulder,elbow);pose(l.forearm,elbow,wrist);pose(l.hand,wrist,wrist.clone().add(v(0,-.04,.075)));
      const hip=pelvis.clone().add(v(l.side*.115,0,0));
      const ankle=v(l.side*THREE.MathUtils.lerp(.3,.14,stand),THREE.MathUtils.lerp(.26,.13,stand),THREE.MathUtils.lerp(-.2,0,stand));
      const knee=joint(hip,ankle,.39,.34,hip.clone().add(v(l.side*.26,-.1,.65)));
      pose(l.thigh,hip,knee);pose(l.shin,knee,ankle);pose(l.foot,ankle,ankle.clone().add(v(0,-.085,.12)));
    }
    root.updateMatrixWorld(true);
  }};
}
