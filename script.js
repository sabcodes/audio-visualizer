// script.js (ESM)
// CDN modules resolve via the import map in index.html
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { GlitchPass } from 'three/addons/postprocessing/GlitchPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { RGBShiftShader } from 'three/addons/shaders/RGBShiftShader.js';

/* ===========================
   UI
=========================== */
const fileInput        = document.getElementById('audio-upload');
const playBtn          = document.getElementById('play-btn');
const visSelect        = document.getElementById('vis-type');
const colorSpeedSlider = document.getElementById('color-speed-slider');
const seekSlider       = document.getElementById('seek-slider');
const timeCurrentEl    = document.getElementById('time-current');
const timeTotalEl      = document.getElementById('time-total');

// overlay root (for Vintage Errors)
let overlayRoot = document.getElementById('overlay-root');
if (!overlayRoot) {
  overlayRoot = document.createElement('div');
  overlayRoot.id = 'overlay-root';
  Object.assign(overlayRoot.style, { position: 'fixed', inset: '0', zIndex: '50', pointerEvents: 'none' });
  document.body.appendChild(overlayRoot);
}

/* ===========================
   Audio
=========================== */
let audio = new Audio();
let audioContext, analyser, dataArray, freqArray, source;
let isPlaying = false;

function setupAudio() {
  audioContext = new (window.AudioContext || window.webkitAudioContext)();
  analyser     = audioContext.createAnalyser();
  analyser.fftSize = 1024;
  dataArray    = new Uint8Array(analyser.fftSize);
  freqArray    = new Uint8Array(analyser.frequencyBinCount);
  source       = audioContext.createMediaElementSource(audio);
  source.connect(analyser);
  analyser.connect(audioContext.destination);
}

function fmt(seconds){ if(!isFinite(seconds)) return '0:00'; const s=Math.max(0,Math.floor(seconds)); const m=Math.floor((s%3600)/60); const sec=s%60; return `${m}:${String(sec).padStart(2,'0')}`; }

let isUserSeeking = false;
audio.addEventListener('loadedmetadata', () => {
  if (seekSlider) { seekSlider.max = String(audio.duration || 0); seekSlider.disabled = !isFinite(audio.duration); }
  if (timeTotalEl) timeTotalEl.textContent = fmt(audio.duration);
});
audio.addEventListener('timeupdate', () => {
  if (!isUserSeeking && seekSlider) {
    seekSlider.value = String(audio.currentTime || 0);
    if (timeCurrentEl) timeCurrentEl.textContent = fmt(audio.currentTime);
  }
});
if (seekSlider){
  seekSlider.addEventListener('input', () => { isUserSeeking = true; if (timeCurrentEl) timeCurrentEl.textContent = fmt(parseFloat(seekSlider.value)); });
  seekSlider.addEventListener('change', () => { audio.currentTime = parseFloat(seekSlider.value) || 0; isUserSeeking = false; });
}
window.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowRight') audio.currentTime = Math.min((audio.duration||0), (audio.currentTime||0) + 5);
  if (e.key === 'ArrowLeft')  audio.currentTime = Math.max(0, (audio.currentTime||0) - 5);
});

fileInput.addEventListener('change', (e) => {
  const file = e.target.files?.[0];
  if (file) {
    audio.src = URL.createObjectURL(file);
    if (seekSlider) { seekSlider.value = '0'; seekSlider.disabled = true; }
    if (timeCurrentEl) timeCurrentEl.textContent = '0:00';
    if (timeTotalEl)   timeTotalEl.textContent   = '0:00';
  }
});
playBtn.addEventListener('click', async () => {
  if (!audioContext) setupAudio();
  await audioContext.resume();
  if (!isPlaying) { audio.play(); playBtn.textContent = 'Pause'; }
  else { audio.pause(); playBtn.textContent = 'Play'; }
  isPlaying = !isPlaying;
});

/* ===========================
   Three.js + Composer
=========================== */
const scene     = new THREE.Scene();
const camera    = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 4000);
const renderer  = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setClearColor(0x000000, 1);
document.body.appendChild(renderer.domElement);
camera.position.z = 80;

// Post-processing
let composer, renderPass, bloomPass, glitchPass, rgbShiftPass;
function setupComposer(){
  composer = new EffectComposer(renderer);
  renderPass = new RenderPass(scene, camera);
  composer.addPass(renderPass);

  bloomPass = new UnrealBloomPass(
    new THREE.Vector2(window.innerWidth, window.innerHeight),
    1.2, 0.6, 0.85
  );
  bloomPass.enabled = false;
  composer.addPass(bloomPass);

  glitchPass = new GlitchPass();
  glitchPass.enabled = false;
  composer.addPass(glitchPass);

  rgbShiftPass = new ShaderPass(RGBShiftShader);
  rgbShiftPass.enabled = false;
  rgbShiftPass.uniforms.amount.value = 0.0015;
  composer.addPass(rgbShiftPass);
}
setupComposer();

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  composer?.setSize(window.innerWidth, window.innerHeight);
  if (kaleidoRT) {
    kaleidoRT.setSize(window.innerWidth, window.innerHeight);
    screenQuad.material.uniforms.uResolution.value.set(window.innerWidth, window.innerHeight);
  }
});

/* ===========================
   Helpers
=========================== */
const waveformResolution = 512;
function bandToIndex(freqHz){ const ny = (audioContext ? audioContext.sampleRate : 44100) / 2; return Math.max(0, Math.min((freqArray?.length||1)-1, Math.round(freqHz / ny * (freqArray?.length||1)))); }
function getBandEnergy(lowHz, highHz){
  if (!freqArray) return 0;
  const i0 = bandToIndex(lowHz), i1 = bandToIndex(highHz);
  let sum=0, count=0; for (let i=i0;i<=i1;i++){ sum += freqArray[i]; count++; }
  return count ? (sum / count) / 255 : 0;
}
let ema = 0, lastBeat = 0;
function detectBeat(bass, nowMs){ const a=0.18; ema=(1-a)*ema+a*bass; const beat=(bass>ema*1.25)&&(nowMs-lastBeat>180); if(beat) lastBeat=nowMs; return beat; }

/* ===========================
   Color cycle (interval) + punch
=========================== */
let colorIntervalId = null;
let currentHue = Math.random();
const BASE_L = 0.5, BASE_S = 1;
let punch = 0;
const PUNCH_DECAY = 3.2;

function setAllColorsHSL(h) {
  currentHue = h;
  waveformMaterial?.color.setHSL(h, BASE_S, BASE_L);
  spiralMaterial?.color.setHSL(h, BASE_S, BASE_L);
  star3dMaterial?.color?.setHSL?.(h, BASE_S, BASE_L);
  cubeMaterial?.color.setHSL(h, BASE_S, BASE_L);
  lissaMaterial?.color.setHSL(h, 1, 0.5);
  lissaMaterial2?.color.setHSL((h + 0.08)%1, 1, 0.5);
  lissaMaterial3?.color.setHSL((h + 0.16)%1, 1, 0.5);
  neonMaterial?.color.setHSL((h + 0.28)%1, 1, 0.55);
  boidMaterial?.color.setHSL((h + 0.36)%1, 1, 0.6);
  tunnelMaterials?.forEach((m,i)=>m.color.setHSL((h+i*0.02)%1,1,0.5));
  glitchRingMaterial?.color.setHSL((h + 0.12)%1, 1, 0.55);
  if (kaleidoPlaneMat) kaleidoPlaneMat.uniforms.uColor.value.setHSL((h + 0.2)%1, 1, 0.5);
  cityMaterial?.color.setHSL((h + 0.45)%1, 1, 0.5);
}
function changeAllColorsRandom(){ setAllColorsHSL(Math.random()); }
function startColorChangeInterval(){
  clearInterval(colorIntervalId);
  const seconds = Math.max(0.1, parseFloat(colorSpeedSlider?.value || '0.5'));
  changeAllColorsRandom();
  colorIntervalId = setInterval(changeAllColorsRandom, seconds*1000);
}
colorSpeedSlider?.addEventListener('input', startColorChangeInterval);

/* ===========================
   Classic line visuals
=========================== */
let waveformGeometry = new THREE.BufferGeometry();
let spiralGeometry   = new THREE.BufferGeometry();
let cubeGeometry     = new THREE.BufferGeometry();
let cubeBasePositions;
let waveformMaterial = new THREE.LineBasicMaterial({ color: 0x00ffff });
let spiralMaterial   = new THREE.LineBasicMaterial({ color: 0xff00ff });
let cubeMaterial     = new THREE.LineBasicMaterial({ color: 0x00ff88 });
let waveformLine, spiralLine, cubeLine;

function createWaveform(){
  if (scene.getObjectByName('vis-circle')) return;
  const positions = new Float32Array(waveformResolution*3);
  waveformGeometry.setAttribute('position', new THREE.BufferAttribute(positions,3));
  waveformLine = new THREE.Line(waveformGeometry, waveformMaterial);
  waveformLine.name='vis-circle'; scene.add(waveformLine);
}
function createSpiral(){
  if (scene.getObjectByName('vis-spiral')) return;
  const positions = new Float32Array(waveformResolution*3);
  const turns = 5;
  for(let i=0;i<waveformResolution;i++){
    const t = i/(waveformResolution-1);
    const a = t*Math.PI*2*turns; const r = 5+t*20;
    positions[i*3]=Math.cos(a)*r; positions[i*3+1]=(i-waveformResolution/2)*(20/waveformResolution); positions[i*3+2]=Math.sin(a)*r;
  }
  spiralGeometry.setAttribute('position', new THREE.BufferAttribute(positions,3));
  spiralLine = new THREE.Line(spiralGeometry, spiralMaterial);
  spiralLine.name='vis-spiral'; scene.add(spiralLine);
}
function createCube(){
  if (scene.getObjectByName('vis-cube')) return;
  const size=30; const steps=Math.max(6,(Math.cbrt(waveformResolution)|0));
  const positions=new Float32Array(steps*steps*steps*3);
  let idx=0; for(let x=0;x<steps;x++)for(let y=0;y<steps;y++)for(let z=0;z<steps;z++){
    positions[idx++]=(x/(steps-1)-.5)*size; positions[idx++]=(y/(steps-1)-.5)*size; positions[idx++]=(z/(steps-1)-.5)*size;
  }
  cubeBasePositions=new Float32Array(positions);
  cubeGeometry.setAttribute('position', new THREE.BufferAttribute(positions,3));
  cubeLine=new THREE.Line(cubeGeometry, cubeMaterial); cubeLine.name='vis-cube'; scene.add(cubeLine);
}

/* ===========================
   Neon Swirl Particles
=========================== */
let neonGeom, neonPoints, neonMaterial, sanityRing;
const PARTICLE_COUNT = 8000;
let neonAngles, neonBaseRadius, neonY;
function createNeonParticles(){
  if (scene.getObjectByName('vis-particles')) return;
  neonGeom=new THREE.BufferGeometry();
  const positions=new Float32Array(PARTICLE_COUNT*3);
  neonAngles=new Float32Array(PARTICLE_COUNT);
  neonBaseRadius=new Float32Array(PARTICLE_COUNT);
  neonY=new Float32Array(PARTICLE_COUNT);
  for(let i=0;i<PARTICLE_COUNT;i++){
    const ang=Math.random()*Math.PI*2; const baseR=16+Math.random()*22; const y=(Math.random()-0.5)*18;
    neonAngles[i]=ang; neonBaseRadius[i]=baseR; neonY[i]=y;
    positions[i*3]=Math.cos(ang)*baseR; positions[i*3+1]=y; positions[i*3+2]=Math.sin(ang)*baseR;
  }
  neonGeom.setAttribute('position', new THREE.BufferAttribute(positions,3));
  neonMaterial=new THREE.PointsMaterial({ size:4, sizeAttenuation:true, transparent:true, opacity:.95, depthWrite:false, blending:THREE.AdditiveBlending, color:0x88ccff });
  neonPoints=new THREE.Points(neonGeom, neonMaterial); neonPoints.name='vis-particles'; scene.add(neonPoints);
  sanityRing=new THREE.Mesh(new THREE.TorusGeometry(26, .1, 8, 128), new THREE.MeshBasicMaterial({ color:0x333333, wireframe:true }));
  sanityRing.name='vis-particles-ring'; scene.add(sanityRing);
}

/* ===========================
   Vintage Errors (DOM)
=========================== */
const winManager = {
  nodes:[], maxWindows:7, enabled:false, lastSpawn:0, spawnCooldownMs:450,
  setEnabled(on){ this.enabled=on; overlayRoot.style.display = on?'block':'none'; overlayRoot.setAttribute('aria-hidden', on?'false':'true'); if(!on){ this.clear(); return; } this.clear(); this.spawn(Math.random()*60); this.spawn(Math.random()*30); this.lastSpawn=performance.now(); },
  clear(){ this.nodes.forEach(n=>n.el.remove()); this.nodes=[]; },
  spawn(progressStart=0){
    if(!this.enabled) return;
    if(this.nodes.length>=this.maxWindows){ const oldest=this.nodes.shift(); oldest.el.remove(); }
    const el=document.createElement('div'); el.className='win95-window';
    Object.assign(el.style,{ position:'absolute', width:'320px', minHeight:'160px', background:'#c0c0c0', border:'2px solid #fff', borderRightColor:'#404040', borderBottomColor:'#404040', boxShadow:'2px 2px 0 #0008', left:`${Math.random()*(window.innerWidth-320)|0}px`, top:`${Math.random()*(window.innerHeight-180)|0}px`, pointerEvents:'auto', fontFamily:'MS Sans Serif, Tahoma, Geneva, sans-serif' });
    const title=document.createElement('div');
    Object.assign(title.style,{ display:'flex', alignItems:'center', justifyContent:'space-between', height:'24px', padding:'0 6px', color:'#fff', background:'linear-gradient(#000080,#000060)', fontWeight:'bold', fontSize:'13px', cursor:'move' });
    title.textContent=['Copying...','Installing...','System','Setup','Explorer'][Math.random()*5|0];
    title.addEventListener('mousedown',(ev)=>{ const r=el.getBoundingClientRect(); dragState={ el, dx:ev.clientX-r.left, dy:ev.clientY-r.top }; });
    const content=document.createElement('div'); Object.assign(content.style,{ padding:'12px', color:'#000', fontSize:'13px' });
    const msg=document.createElement('div'); msg.textContent=['Please wait...','Preparing files...','Verifying...','Finalizing...'][Math.random()*4|0]; msg.style.marginBottom='8px';
    const pb=document.createElement('div'); Object.assign(pb.style,{ width:'100%', height:'20px', background:'#fff', border:'1px solid #000', boxShadow:'inset 1px 1px 0 #808080' });
    const inner=document.createElement('div'); Object.assign(inner.style,{ height:'100%', width:'0%', background:'repeating-linear-gradient(90deg,#00a000 0px,#00a000 10px,#00b000 10px,#00b000 20px)', transition:'width 0.08s linear' });
    pb.appendChild(inner); content.appendChild(msg); content.appendChild(pb); el.appendChild(title); el.appendChild(content); overlayRoot.appendChild(el);
    this.nodes.push({ el, inner, progress:progressStart, speed:8+Math.random()*8, wobble:Math.random()*Math.PI*2 });
  },
  update(dt, highs, bass, beatNow){
    if(!this.enabled) return;
    const now=performance.now();
    if(beatNow && now-this.lastSpawn>this.spawnCooldownMs){ this.spawn(); this.lastSpawn=now; }
    if(now-this.lastSpawn>2500){ this.spawn(); this.lastSpawn=now; }
    this.nodes.forEach((n,idx)=>{ const speed=n.speed*(1+bass*2.0); n.progress+=speed*dt; if(n.progress>=100){ n.progress=0; if(Math.random()<0.3) this.spawn(); } n.inner.style.width=Math.min(100,n.progress)+'%'; n.wobble+=dt*(2+highs*18); const wob=3+highs*12; n.el.style.transform=`translate(${Math.sin(n.wobble+idx)*wob}px, ${Math.cos(n.wobble*0.7+idx)*wob}px)`; });
  }
};
let dragState=null;
document.addEventListener('mousemove',(e)=>{ if(!dragState) return; const {el,dx,dy}=dragState; el.style.left=Math.max(0,Math.min(window.innerWidth-el.offsetWidth,e.clientX-dx))+'px'; el.style.top=Math.max(0,Math.min(window.innerHeight-el.offsetHeight,e.clientY-dy))+'px'; });
document.addEventListener('mouseup',()=>dragState=null);

/* ===========================
   Star Burst 3D (per-spike)
=========================== */
const STAR_SPIKES = 160;
let star3dGeom, star3dLine, star3dMaterial;
let starDirs, starPhase, starBaseLen;
let starBinIdx, starEma;

function createStar3D() {
  if (scene.getObjectByName('vis-star')) return;
  const GA = (Math.sqrt(5)-1) * Math.PI;
  starDirs   = new Float32Array(STAR_SPIKES*3);
  starPhase  = new Float32Array(STAR_SPIKES);
  starBaseLen= new Float32Array(STAR_SPIKES);
  starEma    = new Float32Array(STAR_SPIKES);
  for(let i=0;i<STAR_SPIKES;i++){
    const t=(i+0.5)/STAR_SPIKES; const z=1-2*t; const r=Math.sqrt(Math.max(0,1-z*z)); const a=i*GA; const x=r*Math.cos(a), y=r*Math.sin(a);
    const L=Math.hypot(x,y,z)||1; starDirs[i*3]=x/L; starDirs[i*3+1]=y/L; starDirs[i*3+2]=z/L;
    starPhase[i]=Math.random()*Math.PI*2; starBaseLen[i]=10+Math.random()*10;
  }
  const positions=new Float32Array(STAR_SPIKES*2*3);
  star3dGeom=new THREE.BufferGeometry(); star3dGeom.setAttribute('position', new THREE.BufferAttribute(positions,3));
  star3dMaterial=new THREE.LineBasicMaterial({ color:0xffffff, transparent:true, opacity:.95, blending:THREE.AdditiveBlending, depthWrite:false });
  star3dLine=new THREE.LineSegments(star3dGeom, star3dMaterial); star3dLine.name='vis-star'; scene.add(star3dLine);
}

/* ===========================
   Laser Lissajous
=========================== */
const LISSA_POINTS = 1200;
let lissaGeom,lissaLine,lissaMaterial,lissaGeom2,lissaLine2,lissaMaterial2,lissaGeom3,lissaLine3,lissaMaterial3;
function createLissajous(){
  if (scene.getObjectByName('vis-lissajous')) return;
  function mk(name,a=0.9){ const g=new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(LISSA_POINTS*3),3)); const m=new THREE.LineBasicMaterial({ transparent:true, opacity:a, blending:THREE.AdditiveBlending, depthWrite:false, color:0xffffff }); const l=new THREE.Line(g,m); l.name=name; scene.add(l); return [g,l,m]; }
  [lissaGeom,lissaLine,lissaMaterial]=mk('vis-lissajous',0.95);
  [lissaGeom2,lissaLine2,lissaMaterial2]=mk('vis-lissajous-2',0.65);
  [lissaGeom3,lissaLine3,lissaMaterial3]=mk('vis-lissajous-3',0.55);
}

/* ===========================
   Boids
=========================== */
const BOID_COUNT=220, WORLD={x:70,y:40,z:70};
let boidPositions,boidVel,boidGeom,boidMaterial; let repulse=0, sparkle=0;
function createBoids(){
  if (scene.getObjectByName('vis-boids')) return;
  boidPositions=new Float32Array(BOID_COUNT*3); boidVel=new Float32Array(BOID_COUNT*3);
  for(let i=0;i<BOID_COUNT;i++){ const p=i*3; boidPositions[p]=(Math.random()-0.5)*WORLD.x; boidPositions[p+1]=(Math.random()-0.5)*WORLD.y; boidPositions[p+2]=(Math.random()-0.5)*WORLD.z; boidVel[p]=(Math.random()-0.5)*10; boidVel[p+1]=(Math.random()-0.5)*10; boidVel[p+2]=(Math.random()-0.5)*10; }
  boidGeom=new THREE.BufferGeometry(); boidGeom.setAttribute('position', new THREE.BufferAttribute(boidPositions,3));
  boidMaterial=new THREE.PointsMaterial({ size:3.6, transparent:true, opacity:.95, depthWrite:false, blending:THREE.AdditiveBlending, color:0xffffff });
  const points=new THREE.Points(boidGeom, boidMaterial); points.name='vis-boids'; scene.add(points);
}

/* ===========================
   FFT Tunnel (lines)
=========================== */
const TUNNEL_RINGS=28, TUNNEL_SEGMENTS=128, TUNNEL_DEPTH=900;
let tunnelGeoms=[], tunnelMaterials=[], tunnelZ=[];
function createFFTTunnel(){
  if (scene.getObjectByName('vis-fft-tunnel-0')) return;
  for(let i=0;i<TUNNEL_RINGS;i++){
    const g=new THREE.BufferGeometry(); const pos=new Float32Array(TUNNEL_SEGMENTS*3);
    g.setAttribute('position', new THREE.BufferAttribute(pos,3));
    const m=new THREE.LineBasicMaterial({ color:0xffffff, transparent:true, opacity:.9, blending:THREE.AdditiveBlending, depthWrite:false });
    const line=new THREE.Line(g,m); line.name=`vis-fft-tunnel-${i}`; scene.add(line);
    tunnelGeoms.push(g); tunnelMaterials.push(m); tunnelZ.push(-i*(TUNNEL_DEPTH/TUNNEL_RINGS));
  }
}

/* ===========================
   Kaleidoscope Plane (smaller + trippy)
=========================== */
let kaleidoRT, screenScene, screenCam, screenQuad; let kaleidoPlaneMat;
function createKaleidoPlane(){
  if (scene.getObjectByName('vis-kaleido-plane')) return;
  const geom=new THREE.PlaneGeometry(90,90,220,220);
  kaleidoPlaneMat=new THREE.ShaderMaterial({
    uniforms:{ uTime:{value:0}, uBass:{value:0}, uMids:{value:0}, uHighs:{value:0}, uColor:{value:new THREE.Color(0x00ffff)} },
    vertexShader:`
      uniform float uTime,uBass,uMids,uHighs; varying float vH; varying vec2 vUv2;
      void main(){ vec3 p=position; float r=length(p.xz)*0.12; float ang=atan(p.z,p.x);
        float swirl=(0.25+uMids*1.3)*sin(ang*3.0+uTime*0.6); p.xz*=1.0+swirl*0.15;
        float w1=sin(p.x*0.30+uTime*1.2)*(0.6+uBass*3.0);
        float w2=sin(p.z*0.42+uTime*1.0)*(0.6+uMids*2.2);
        float w3=sin((p.x+p.z)*0.23+uTime*0.8)*(0.4+uHighs*1.8);
        float ripple=cos(r*12.0-uTime*2.0)*(0.4+uBass*2.8);
        p.y+=(w1+w2+w3+ripple)*3.8; vH=p.y; vUv2=vec2(r,ang);
        gl_Position=projectionMatrix*modelViewMatrix*vec4(p,1.0); }`,
    fragmentShader:`
      uniform vec3 uColor; varying float vH; varying vec2 vUv2;
      vec3 hsv2rgb(vec3 c){ vec3 p=abs(fract(c.xxx+vec3(0.,.666,.333))*6.-3.); vec3 rgb=clamp(p-1.,0.,1.); return c.z*mix(vec3(1.),rgb,c.y); }
      void main(){ float l=0.45+clamp(vH*0.04,-0.35,0.5); float wob=0.08*sin(vUv2.x*14.0+vUv2.y*6.0);
        vec3 base=hsv2rgb(vec3(fract(wob),1.0,clamp(l,0.0,1.0))); base=mix(base,uColor,0.35); gl_FragColor=vec4(base,1.0); }`,
  });
  const mesh=new THREE.Mesh(geom, kaleidoPlaneMat); mesh.name='vis-kaleido-plane'; mesh.rotation.x=-Math.PI/2; scene.add(mesh);
  kaleidoRT=new THREE.WebGLRenderTarget(window.innerWidth, window.innerHeight, { depthBuffer:false });
  screenScene=new THREE.Scene(); screenCam=new THREE.OrthographicCamera(-1,1,1,-1,0,1);
  const quadGeom=new THREE.PlaneGeometry(2,2);
  const quadMat=new THREE.ShaderMaterial({
    uniforms:{ tDiffuse:{value:kaleidoRT.texture}, uTime:{value:0}, uAngle:{value:0}, uResolution:{value:new THREE.Vector2(window.innerWidth,window.innerHeight)}, uSectors:{value:8.0} },
    vertexShader:`varying vec2 vUv; void main(){ vUv=uv; gl_Position=vec4(position,1.0); }`,
    fragmentShader:`uniform sampler2D tDiffuse; uniform float uTime,uAngle,uSectors; varying vec2 vUv;
      void main(){ vec2 c=vec2(0.5); vec2 p=vUv-c; float r=length(p); float a=atan(p.y,p.x)+uAngle;
        float PI2=6.28318530718, sect=PI2/uSectors; a=mod(a,sect); a=abs(a-sect*.5);
        r*=1.0+0.02*sin(uTime*1.4 + r*20.0); vec2 uv2=c+vec2(cos(a),sin(a))*r; vec4 col=texture2D(tDiffuse,uv2);
        float vig=smoothstep(1.2,0.2,r); col.rgb*=mix(0.7,1.25,vig); gl_FragColor=col; }`
  });
  screenQuad=new THREE.Mesh(quadGeom, quadMat); screenScene.add(screenQuad);
}

/* ===========================
   Cityscape (slow orbit)
=========================== */
let cityMesh, cityMaterial, cityCount, cityGrid=28, cityOrbit=0;
function createCity(){
  if (scene.getObjectByName('vis-city')) return;
  const geom=new THREE.BoxGeometry(1,1,1);
  cityMaterial=new THREE.MeshBasicMaterial({ color:0xffffff, transparent:true, opacity:.95 });
  cityCount=cityGrid*cityGrid; cityMesh=new THREE.InstancedMesh(geom, cityMaterial, cityCount); cityMesh.name='vis-city'; scene.add(cityMesh);
  const spacing=2.4; let i=0; const dummy=new THREE.Object3D();
  for(let x=0;x<cityGrid;x++)for(let z=0;z<cityGrid;z++){ dummy.position.set((x-cityGrid/2)*spacing,0,(z-cityGrid/2)*spacing); dummy.scale.set(1,1,1); dummy.updateMatrix(); cityMesh.setMatrixAt(i++, dummy.matrix); }
  cityMesh.instanceMatrix.needsUpdate=true;
}

/* ===========================
   Glitch Ring
=========================== */
let glitchRing, glitchRingMaterial, glitchBasePos, glitchGeom;
function createGlitchRing(){
  if (scene.getObjectByName('vis-glitch-ring')) return;
  const segs=512, inner=18, outer=26;
  glitchGeom=new THREE.BufferGeometry();
  const positions=new Float32Array(segs*3); glitchBasePos=new Float32Array(segs*3);
  for(let i=0;i<segs;i++){ const a=i/segs*Math.PI*2; const r=(inner+outer)*.5; const x=Math.cos(a)*r, y=Math.sin(a)*r;
    positions[i*3]=glitchBasePos[i*3]=x; positions[i*3+1]=glitchBasePos[i*3+1]=y; positions[i*3+2]=glitchBasePos[i*3+2]=0; }
  glitchGeom.setAttribute('position', new THREE.BufferAttribute(positions,3));
  glitchRingMaterial=new THREE.LineBasicMaterial({ color:0xffffff, transparent:true, opacity:.95, blending:THREE.AdditiveBlending, depthWrite:false });
  glitchRing=new THREE.LineLoop(glitchGeom, glitchRingMaterial); glitchRing.name='vis-glitch-ring'; scene.add(glitchRing);
}

/* ===========================
   Fullscreen shaders: VJ Rings / Neon Kaleido
=========================== */
let vjRingsEnabled=false, neonKaleidoEnabled=false;
let ringsScene, ringsCam, ringsQuad, ringsMat;
function createVJSmoothRings(){
  if (ringsScene) return;
  ringsScene=new THREE.Scene(); ringsCam=new THREE.OrthographicCamera(-1,1,1,-1,0,1);
  ringsMat=new THREE.ShaderMaterial({
    uniforms:{ uTime:{value:0}, uHue:{value:0}, uPunch:{value:0}, uBass:{value:0}, uMids:{value:0}, uHighs:{value:0}, uSectors:{value:8.0}, uAngle:{value:0} },
    vertexShader:`varying vec2 vUv; void main(){ vUv=uv; gl_Position=vec4(position,1.0); }`,
    fragmentShader:`precision highp float; varying vec2 vUv; uniform float uTime,uHue,uPunch,uBass,uMids,uHighs,uSectors,uAngle;
      vec3 hsv2rgb(vec3 c){ vec3 p=abs(fract(c.xxx+vec3(0.,.666,.333))*6.-3.); vec3 rgb=clamp(p-1.,0.,1.); return c.z*mix(vec3(1.),rgb,c.y); }
      void main(){ vec2 p=(vUv-0.5)*2.0; float r=length(p); float a=atan(p.y,p.x)+uAngle; float PI2=6.28318530718; float sect=PI2/uSectors; a=mod(a,sect); a=abs(a-sect*.5);
        float rC=0.36+uBass*.28; float k=mix(6.,12.,clamp(uMids,0.,1.)); float wt=uTime*(0.6+uMids*1.6); float d=r-rC;
        float wave=cos(d*k*PI2-wt); float wC=0.08+uBass*.35; float wO=0.03+uBass*.18; float blend=exp(-pow(d/0.22,2.)); float w=mix(wO,wC,blend);
        float band=smoothstep(1.-w,1.,wave)*(0.6+0.4*cos(a*2.0)); float wave2=cos((d*1.8)*k*PI2-wt*1.7); float band2=0.5*smoothstep(1.-w*0.55,1.,wave2);
        float v=clamp(band+band2,0.,1.)*(1.0+uHighs*0.8*(0.4+0.6*sin(uTime*40.0)))*smoothstep(1.25,0.15,r);
        vec3 col=hsv2rgb(vec3(fract(uHue),mix(.9,1.,uPunch), clamp(v*1.2+uPunch*.6,0.,1.))); gl_FragColor=vec4(col,1.0); }`,
    depthTest:false, depthWrite:false
  });
  ringsQuad=new THREE.Mesh(new THREE.PlaneGeometry(2,2), ringsMat); ringsScene.add(ringsQuad);
}
let neonScene, neonCam, neonQuad, neonMat;
function createNeonKaleido(){
  if (neonScene) return;
  neonScene=new THREE.Scene(); neonCam=new THREE.OrthographicCamera(-1,1,1,-1,0,1);
  neonMat=new THREE.ShaderMaterial({
    uniforms:{ uTime:{value:0}, uHue:{value:0}, uPunch:{value:0}, uBass:{value:0}, uMids:{value:0}, uHighs:{value:0}, uSectors:{value:8.0}, uAngle:{value:0} },
    vertexShader:`varying vec2 vUv; void main(){ vUv=uv; gl_Position=vec4(position,1.0); }`,
    fragmentShader:`precision highp float; varying vec2 vUv; uniform float uTime,uHue,uPunch,uBass,uMids,uHighs,uSectors,uAngle;
      vec3 hsv2rgb(vec3 c){ vec3 p=abs(fract(c.xxx+vec3(0.,.666,.333))*6.-3.); vec3 rgb=clamp(p-1.,0.,1.); return c.z*mix(vec3(1.),rgb,c.y); }
      float lineSD(vec2 p,float t){ vec2 n=vec2(cos(t),sin(t)); return abs(dot(p, vec2(-n.y,n.x))); }
      void main(){ vec2 p=(vUv-0.5)*2.; float r=length(p); float a=atan(p.y,p.x)+uAngle; float PI2=6.28318530718,sect=PI2/uSectors; a=mod(a,sect); a=abs(a-sect*.5);
        vec2 uv2=vec2(cos(a),sin(a))*r; float t=uTime; float spokes=0.; for(int i=0;i<4;i++){ float ang=float(i)*.6+t*.8; float d=lineSD(uv2,ang); float w=.02+.08*uHighs; spokes+=smoothstep(w,0.,d); }
        float f=6.+uMids*12.; float s=sin(r*f-t*1.6); float w=.08+.35*uBass; float rings=smoothstep(-w,w,s)-smoothstep(w,w*2.,s);
        float gate=step(.5,.5+.5*sin(t*10.+uHighs*20.)); float v=(spokes*.9 + rings*1.2)*gate;
        vec3 col=hsv2rgb(vec3(fract(uHue+.02*sin(t*.25)),mix(.85,1.,uPunch), clamp(v*1.2+uPunch*.6,0.,1.))); col*=smoothstep(1.35,.1,r);
        gl_FragColor=vec4(col,1.0); }`,
    depthTest:false, depthWrite:false
  });
  neonQuad=new THREE.Mesh(new THREE.PlaneGeometry(2,2), neonMat); neonScene.add(neonQuad);
}

/* ===========================
   Stars Tunnel (stable base radius + per-star spring)
=========================== */
const ST_RINGS = 40, ST_PER_RING = 44, ST_DEPTH = 1400, ST_RING_SPACING = ST_DEPTH / ST_RINGS;
const GOLDEN_ANGLE = (Math.sqrt(5) - 1.0) * Math.PI;

let stGeom, stPoints, stMat;
let stBaseZ, stRingRot, stRingRadiusBase, stColorAttr, stTexture;
let stPulses = [];
let stRadOffset, stVelR, stRingBurst;

function makeStarTexture(size = 96, spikes = 5, outerR = 42, innerR = 18) {
  const c = document.createElement('canvas'); c.width = c.height = size; const ctx = c.getContext('2d');
  ctx.clearRect(0,0,size,size);
  const g=ctx.createRadialGradient(size/2,size/2,0,size/2,size/2,size/2);
  g.addColorStop(0,'rgba(255,255,255,0.95)'); g.addColorStop(0.5,'rgba(255,255,255,0.35)'); g.addColorStop(1,'rgba(255,255,255,0)');
  ctx.fillStyle=g; ctx.beginPath(); ctx.arc(size/2,size/2,size/2,0,Math.PI*2); ctx.fill();
  ctx.save(); ctx.translate(size/2,size/2); ctx.rotate(-Math.PI/2); ctx.beginPath();
  for (let i=0;i<spikes*2;i++){ const r=(i%2===0)?outerR:innerR; const a=(i/(spikes*2))*Math.PI*2; ctx.lineTo(Math.cos(a)*r,Math.sin(a)*r); }
  ctx.closePath(); ctx.shadowColor='rgba(255,255,255,0.6)'; ctx.shadowBlur=8; ctx.fillStyle='#ffffff'; ctx.fill(); ctx.restore();
  const tex = new THREE.CanvasTexture(c); tex.minFilter = THREE.LinearFilter; tex.magFilter = THREE.LinearFilter; tex.anisotropy = 4; return tex;
}

function createStarTunnel(){
  if (scene.getObjectByName('vis-star-tunnel')) return;

  stTexture = makeStarTexture();
  stGeom    = new THREE.BufferGeometry();

  const count = ST_RINGS * ST_PER_RING;
  const pos   = new Float32Array(count * 3);
  stColorAttr = new Float32Array(count * 3);

  stBaseZ          = new Float32Array(ST_RINGS);
  stRingRot        = new Float32Array(ST_RINGS);
  stRingRadiusBase = new Float32Array(ST_RINGS);
  stRadOffset      = new Float32Array(count);
  stVelR           = new Float32Array(count);
  stRingBurst      = new Float32Array(ST_RINGS);

  for (let r=0; r<ST_RINGS; r++) {
    stBaseZ[r]   = -r * ST_RING_SPACING;
    stRingRot[r] = r * 0.06;
    const t = r / (ST_RINGS - 1);
    stRingRadiusBase[r] = 14 + 10 * Math.sin(t * Math.PI) + 10;
  }

  let idx = 0;
  for (let r=0; r<ST_RINGS; r++) {
    for (let s=0; s<ST_PER_RING; s++, idx++) {
      const a   = s * GOLDEN_ANGLE + r * 0.15;
      const rad = stRingRadiusBase[r] * (0.92 + (s % 5) * 0.02);
      pos[idx*3]   = Math.cos(a) * rad;
      pos[idx*3+1] = Math.sin(a) * rad;
      pos[idx*3+2] = stBaseZ[r];
      stColorAttr[idx*3]   = 0.5;
      stColorAttr[idx*3+1] = 0.5;
      stColorAttr[idx*3+2] = 0.7;
      stRadOffset[idx] = 0;
      stVelR[idx]      = 0;
    }
  }

  stGeom.setAttribute('position', new THREE.BufferAttribute(pos,3));
  stGeom.setAttribute('color',    new THREE.BufferAttribute(stColorAttr,3));
  stMat = new THREE.PointsMaterial({
    map: stTexture, transparent: true, depthWrite: false,
    size: 3.0, sizeAttenuation: true, blending: THREE.AdditiveBlending,
    vertexColors: true, color: 0xffffff
  });

  stPoints = new THREE.Points(stGeom, stMat);
  stPoints.name = 'vis-star-tunnel';
  scene.add(stPoints);
}
function resetStarTunnel(){
  if (!stBaseZ) return;
  for (let r=0; r<ST_RINGS; r++) {
    stBaseZ[r]   = -r * ST_RING_SPACING;
    stRingRot[r] = r * 0.06;
    stRingBurst[r] = 0;
  }
  stPulses.length = 0;
  stRadOffset.fill(0);
  stVelR.fill(0);
  stPoints.visible = true;
}

/* ===========================
   Bloom Tunnel + God Rays
=========================== */
let bloomGroup=null;
function createBloomTunnel(){
  if (scene.getObjectByName('vis-bloom-tunnel')) return;
  bloomGroup = new THREE.Group(); bloomGroup.name = 'vis-bloom-tunnel';
  const rings = 26;
  for (let i=0;i<rings;i++){
    const R = 18 + i*0.8;
    const torus = new THREE.Mesh(
      new THREE.TorusGeometry(R, 0.45, 8, 96),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent:true, opacity:0.85 })
    );
    torus.position.z = -i * (TUNNEL_DEPTH / rings);
    bloomGroup.add(torus);
  }
  scene.add(bloomGroup);
}
let godGroup=null;
function createGodRays(){
  if (scene.getObjectByName('vis-godrays')) return;
  godGroup = new THREE.Group(); godGroup.name = 'vis-godrays';
  const cones = 14;
  for (let i=0;i<cones;i++){
    const g = new THREE.ConeGeometry(12, 120, 32, 1, true);
    const m = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent:true, opacity:0.18, blending:THREE.AdditiveBlending, side:THREE.DoubleSide, depthWrite:false });
    const mesh = new THREE.Mesh(g, m);
    mesh.position.set(0, -10, 0);
    mesh.rotation.y = (i/cones) * Math.PI*2;
    godGroup.add(mesh);
  }
  scene.add(godGroup);
}

/* ===========================
   Visibility & mode toggles
=========================== */
function disableAllPasses(){ bloomPass.enabled=false; glitchPass.enabled=false; rgbShiftPass.enabled=false; }

function hideAll(){
  const ids = [
    'vis-circle','vis-spiral','vis-star','vis-cube','vis-particles','vis-particles-ring',
    'vis-lissajous','vis-lissajous-2','vis-lissajous-3','vis-boids',
    ...Array.from({length:TUNNEL_RINGS},(_,i)=>`vis-fft-tunnel-${i}`),
    'vis-kaleido-plane','vis-city','vis-glitch-ring','vis-star-tunnel',
    'vis-bloom-tunnel','vis-godrays'
  ];
  ids.forEach(id=>{ const o=scene.getObjectByName(id); if(o) o.visible=false; });
  winManager.setEnabled(false);
  vjRingsEnabled=false; neonKaleidoEnabled=false;
  disableAllPasses();
}
function updateVisibility(){
  hideAll();
  const v=visSelect.value; const show=(id)=>{ const o=scene.getObjectByName(id); if(o) o.visible=true; };

  if (v==='circle') show('vis-circle');
  if (v==='spiral') show('vis-spiral');
  if (v==='star')   show('vis-star');
  if (v==='cube')   show('vis-cube');
  if (v==='particles'){ show('vis-particles'); show('vis-particles-ring'); }
  if (v==='errors') winManager.setEnabled(true);
  if (v==='lissajous'){ show('vis-lissajous'); show('vis-lissajous-2'); show('vis-lissajous-3'); }
  if (v==='boids') show('vis-boids');
  if (v==='fftTunnel'){ for(let i=0;i<TUNNEL_RINGS;i++) show(`vis-fft-tunnel-${i}`); }

  if (v==='kaleidoPlane') show('vis-kaleido-plane');
  if (v==='city') show('vis-city');
  if (v==='glitchRing') show('vis-glitch-ring');

  if (v==='vjRings') vjRingsEnabled=true;
  if (v==='neonKaleido') neonKaleidoEnabled=true;

  if (v==='starTunnel'){ show('vis-star-tunnel'); resetStarTunnel(); }

  if (v==='bloomTunnel'){ show('vis-bloom-tunnel'); bloomPass.enabled=true; }
  if (v==='glitchFX'){ show('vis-glitch-ring'); glitchPass.enabled=true; rgbShiftPass.enabled=true; }
  if (v==='godrays'){ show('vis-godrays'); bloomPass.enabled=true; }
}
visSelect.addEventListener('change', updateVisibility);

/* ===========================
   Create all once
=========================== */
createWaveform(); createSpiral(); createStar3D(); createCube(); createNeonParticles();
createLissajous(); createBoids(); createFFTTunnel(); createKaleidoPlane();
createCity(); createGlitchRing(); createVJSmoothRings(); createNeonKaleido();
createStarTunnel(); createBloomTunnel(); createGodRays();
updateVisibility(); startColorChangeInterval();

/* ===========================
   Animation
=========================== */
let lastTime = performance.now();
function animate(){
  requestAnimationFrame(animate);
  const now = performance.now(); const dt=Math.min(0.05,(now-lastTime)/1000); lastTime=now;

  if (analyser){ analyser.getByteTimeDomainData(dataArray); analyser.getByteFrequencyData(freqArray); }
  const bass   = analyser ? getBandEnergy(20,150)    : 0;
  const mids   = analyser ? getBandEnergy(150,2000)  : 0;
  const highs  = analyser ? getBandEnergy(2000,8000) : 0;
  const beatNow= analyser ? detectBeat(bass, now)    : false;
  if (beatNow){ punch=Math.min(1,punch+0.8); }
  punch=Math.max(0, punch - dt*PUNCH_DECAY);

  // color punch
  const lineL=BASE_L + punch*0.35;
  waveformMaterial?.color.setHSL(currentHue, BASE_S, lineL);
  spiralMaterial?.color.setHSL(currentHue, BASE_S, lineL);
  star3dMaterial?.color?.setHSL?.(currentHue, BASE_S, lineL);
  cubeMaterial?.color.setHSL(currentHue, BASE_S, lineL);
  lissaMaterial?.color.setHSL(currentHue,1,0.5+punch*.30);
  lissaMaterial2?.color.setHSL((currentHue+.08)%1,1,0.5+punch*.25);
  lissaMaterial3?.color.setHSL((currentHue+.16)%1,1,0.5+punch*.20);
  neonMaterial?.color.setHSL((currentHue+.28)%1,1,0.55+punch*.25);
  boidMaterial?.color.setHSL((currentHue+.36)%1,1,0.6+punch*.20);
  tunnelMaterials?.forEach(m=>m.color.setHSL(currentHue,1,0.5+punch*.25));
  glitchRingMaterial?.color.setHSL((currentHue+.12)%1,1,0.55+punch*.2);
  if (kaleidoPlaneMat) kaleidoPlaneMat.uniforms.uColor.value.setHSL((currentHue + 0.2)%1, 1, 0.5 + punch*0.2);

  const punchAlpha = 1 + 0.8*punch;
  lissaMaterial && (lissaMaterial.opacity = 0.95*punchAlpha);
  lissaMaterial2 && (lissaMaterial2.opacity = 0.65*punchAlpha);
  lissaMaterial3 && (lissaMaterial3.opacity = 0.55*punchAlpha);
  boidMaterial   && (boidMaterial.opacity   = 0.95*punchAlpha);
  tunnelMaterials?.forEach(m=>m.opacity=0.9*punchAlpha);

  /* ---------- FULLSCREEN SHADERS ---------- */
  if (vjRingsEnabled){
    const rot = 0.25 + mids*1.6;
    ringsMat.uniforms.uTime.value += dt;
    ringsMat.uniforms.uHue.value = currentHue;
    ringsMat.uniforms.uPunch.value = punch;
    ringsMat.uniforms.uBass.value = bass;
    ringsMat.uniforms.uMids.value = mids;
    ringsMat.uniforms.uHighs.value = highs;
    ringsMat.uniforms.uAngle.value += dt*rot;
    renderer.render(ringsScene, ringsCam);
    return;
  }
  if (neonKaleidoEnabled){
    const rot = 0.35 + mids*2.0;
    neonMat.uniforms.uTime.value += dt;
    neonMat.uniforms.uHue.value = currentHue;
    neonMat.uniforms.uPunch.value = punch;
    neonMat.uniforms.uBass.value = bass;
    neonMat.uniforms.uMids.value = mids;
    neonMat.uniforms.uHighs.value = highs;
    neonMat.uniforms.uAngle.value += dt*rot;
    renderer.render(neonScene, neonCam);
    return;
  }
  /* --------------------------------------- */

  // Circle
  if (scene.getObjectByName('vis-circle')?.visible){
    const arr=waveformGeometry.attributes.position.array;
    for(let i=0;i<waveformResolution;i++){
      const amp=analyser?(dataArray[i]-128)/10:0; const a=(i/waveformResolution)*Math.PI*2; const r=20+amp;
      arr[i*3]=Math.cos(a)*r; arr[i*3+1]=amp*2; arr[i*3+2]=Math.sin(a)*r;
    }
    waveformGeometry.attributes.position.needsUpdate=true;
  }
  // Spiral
  if (scene.getObjectByName('vis-spiral')?.visible){
    const arr=spiralGeometry.attributes.position.array;
    for(let i=0;i<waveformResolution;i++){
      const amp=analyser?(dataArray[i]-128)/10:0; const t=i/(waveformResolution-1); const a=t*Math.PI*2*5; const r=5+t*20+amp;
      arr[i*3]=Math.cos(a)*r; arr[i*3+1]=(i-waveformResolution/2)*(20/waveformResolution)+amp; arr[i*3+2]=Math.sin(a)*r;
    }
    spiralGeometry.attributes.position.needsUpdate=true;
  }

  // Star Burst 3D
  if (scene.getObjectByName('vis-star')?.visible){
    const pos=star3dGeom.attributes.position.array;
    if (analyser && (!starBinIdx || starBinIdx.length!==STAR_SPIKES)){
      starBinIdx=new Uint16Array(STAR_SPIKES);
      for(let i=0;i<STAR_SPIKES;i++){ const u=i/(STAR_SPIKES-1); const w=Math.pow(u,1.2); starBinIdx[i]=Math.max(0,Math.min(freqArray.length-1, Math.floor(w*(freqArray.length-1)))); }
    }
    const up={x:0,y:1,z:0};
    for(let i=0;i<STAR_SPIKES;i++){
      const i6=i*6; let e=0,cnt=0;
      if (freqArray && starBinIdx){ const b=starBinIdx[i]; for(let k=-2;k<=2;k++){ const idx=Math.min(freqArray.length-1,Math.max(0,b+k)); e+=freqArray[idx]; cnt++; } e=(cnt?e/cnt:0)/255; }
      const alpha=0.22; starEma[i] = starEma[i] + alpha*(e - starEma[i]);

      const dx=starDirs[i*3], dy=starDirs[i*3+1], dz=starDirs[i*3+2];
      let ux=up.x, uy=up.y, uz=up.z; const dot=dx*ux+dy*uy+dz*uz; if(Math.abs(dot)>0.95){ ux=1; uy=0; uz=0; }
      let ox=dy*uz-dz*uy, oy=dz*ux-dx*uz, oz=dx*uy-dy*ux; let olen=Math.hypot(ox,oy,oz)||1; ox/=olen; oy/=olen; oz/=olen;
      let px=dy*oz-dz*oy, py=dz*ox-dx*oz, pz=dx*oy-dy*ox; let plen=Math.hypot(px,py,pz)||1; px/=plen; py/=plen; pz/=plen;

      const env=starEma[i];
      const len=starBaseLen[i] + env*120 + bass*14 + punch*40;
      const wobAmt=2 + 12*env + 6*highs;
      const t=performance.now()*0.001; const ph=starPhase[i];
      const wob1=Math.sin(t*7.5+ph)*wobAmt; const wob2=Math.cos(t*6.3+ph*1.17)*(wobAmt*0.7);

      pos[i6]=0; pos[i6+1]=0; pos[i6+2]=0;
      pos[i6+3]=dx*len + ox*wob1 + px*wob2;
      pos[i6+4]=dy*len + oy*wob1 + py*wob2;
      pos[i6+5]=dz*len + oz*wob1 + pz*wob2;
    }
    star3dGeom.attributes.position.needsUpdate=true;
    star3dMaterial.color.setHSL(currentHue,1,0.5+0.25*Math.min(1, highs+punch));
    star3dMaterial.opacity=0.65+0.35*Math.min(1, highs*1.2+punch);
  }

  // Cube
  if (scene.getObjectByName('vis-cube')?.visible){
    const arr=cubeGeometry.attributes.position.array, base=cubeBasePositions;
    for(let i=0;i<base.length/3;i++){ const idx=i*3; const bx=base[idx], by=base[idx+1], bz=base[idx+2]; const len=Math.sqrt(bx*bx+by*by+bz*bz)||1;
      const amp=analyser?(dataArray[i%waveformResolution]-128)/10:0;
      arr[idx]=bx+(bx/len)*amp; arr[idx+1]=by+(by/len)*amp; arr[idx+2]=bz+(bz/len)*amp; }
    cubeGeometry.attributes.position.needsUpdate=true;
  }

  // Neon particles
  if (scene.getObjectByName('vis-particles')?.visible){
    const pos=neonGeom.attributes.position.array; const swirl=0.6 + mids*2.5; const rboost=1 + bass*6.0;
    for(let i=0;i<PARTICLE_COUNT;i++){ neonAngles[i]+=swirl*dt*(0.2+(i%7)/20); const r=neonBaseRadius[i]*rboost;
      pos[i*3]=Math.cos(neonAngles[i])*r; pos[i*3+1]=neonY[i]*(0.8+bass*0.7); pos[i*3+2]=Math.sin(neonAngles[i])*r; }
    neonGeom.attributes.position.needsUpdate=true; neonMaterial.opacity=(0.7+highs*0.6)*(1+0.8*punch);
  }

  // Vintage errors
  winManager.update(dt, highs, bass, beatNow);

  // Lissajous
  if (scene.getObjectByName('vis-lissajous')?.visible){
    const a=3+Math.round(mids*4), b=2+Math.round(highs*5), ampX=26+bass*18, ampY=18+mids*16, zWob=highs*10;
    const fill=(geom,ph,zOff)=>{ const arr=geom.attributes.position.array;
      for(let i=0;i<LISSA_POINTS;i++){ const t=i/(LISSA_POINTS-1)*Math.PI*2; arr[i*3]=Math.sin(a*t+ph)*ampX; arr[i*3+1]=Math.sin(b*t)*ampY; arr[i*3+2]=Math.sin(t*0.5+ph)*zWob+zOff; }
      geom.attributes.position.needsUpdate=true; };
    const nowMs = performance.now();
    fill(lissaGeom, nowMs*0.0015, -6);
    fill(lissaGeom2, nowMs*0.0012+0.8, 0);
    fill(lissaGeom3, nowMs*0.0010+1.6, 6);
  }

  // Boids
  if (scene.getObjectByName('vis-boids')?.visible){
    if (beatNow) repulse=20; repulse=Math.max(0,repulse-dt*25);
    sparkle=Math.max(0, Math.max(sparkle, highs*1.2-0.2)); sparkle=Math.max(0, sparkle-dt*1.5);
    boidMaterial.size=3.6 + sparkle*6;

    const alignR=12, cohR=14, sepR=8, maxSpeed=24, maxForce=35*dt;
    for(let i=0;i<BOID_COUNT;i++){
      const i3=i*3; let px=boidPositions[i3], py=boidPositions[i3+1], pz=boidPositions[i3+2];
      let vx=boidVel[i3], vy=boidVel[i3+1], vz=boidVel[i3+2];
      let ax=0,ay=0,az=0, countA=0,countC=0, sepX=0,sepY=0,sepZ=0, alx=0,aly=0,alz=0, cx=0,cy=0,cz=0;
      for(let j=0;j<BOID_COUNT;j++){ if(i===j) continue; const j3=j*3; const dx=boidPositions[j3]-px, dy=boidPositions[j3+1]-py, dz=boidPositions[j3+2]-pz; const d2=dx*dx+dy*dy+dz*dz;
        if (d2<alignR*alignR){ countA++; alx+=boidVel[j3]; aly+=boidVel[j3+1]; alz+=boidVel[j3+2]; }
        if (d2<sepR*sepR && d2>0){ const inv=1/Math.sqrt(d2); sepX-=dx*inv; sepY-=dy*inv; sepZ-=dz*inv; }
        if (d2<cohR*cohR){ countC++; cx+=boidPositions[j3]; cy+=boidPositions[j3+1]; cz+=boidPositions[j3+2]; }
      }
      if (countA>0){ alx/=countA; aly/=countA; alz/=countA; ax+=(alx-vx)*0.05; ay+=(aly-vy)*0.05; az+=(alz-vz)*0.05; }
      if (countC>0){ cx/=countC; cy/=countC; cz/=countC; ax+=(cx-px)*0.0035; ay+=(cy-py)*0.0035; az+=(cz-pz)*0.0035; }
      ax+=sepX*0.12; ay+=sepY*0.12; az+=sepZ*0.12;
      if (repulse>0){ const inv=1/Math.max(1e-3, Math.hypot(px,py,pz)); ax+=(px*inv)*repulse*0.6; ay+=(py*inv)*repulse*0.6; az+=(pz*inv)*repulse*0.6; }
      ax+=(Math.sin(now*0.002 + i)*0.5)*(0.5+bass*3); ay+=(Math.cos(now*0.0023 + i*0.7)*0.5)*(0.5+mids*2);
      vx+=THREE.MathUtils.clamp(ax,-maxForce,maxForce); vy+=THREE.MathUtils.clamp(ay,-maxForce,maxForce); vz+=THREE.MathUtils.clamp(az,-maxForce,maxForce);
      const sp=Math.hypot(vx,vy,vz)||1, cap=maxSpeed*(0.6+highs*1.2), k=Math.min(1,cap/sp); vx*=k; vy*=k; vz*=k;
      px+=vx*dt; py+=vy*dt; pz+=vz*dt;
      if (px> WORLD.x*0.5) px=-WORLD.x*0.5; if (px<-WORLD.x*0.5) px= WORLD.x*0.5;
      if (py> WORLD.y*0.5) py=-WORLD.y*0.5; if (py<-WORLD.y*0.5) py= WORLD.y*0.5;
      if (pz> WORLD.z*0.5) pz=-WORLD.z*0.5; if (pz<-WORLD.z*0.5) pz= WORLD.z*0.5;
      boidPositions[i3]=px; boidPositions[i3+1]=py; boidPositions[i3+2]=pz; boidVel[i3]=vx; boidVel[i3+1]=vy; boidVel[i3+2]=vz;
    }
    boidGeom.attributes.position.needsUpdate=true;
  }

  // FFT Tunnel (lines)
  if (scene.getObjectByName('vis-fft-tunnel-0')?.visible){
    const speed=220 + bass*420;
    for(let i=0;i<TUNNEL_RINGS;i++){
      tunnelZ[i]+=speed*dt; if (tunnelZ[i]>50) tunnelZ[i]=-TUNNEL_DEPTH; const z=tunnelZ[i];
      const arr=tunnelGeoms[i].attributes.position.array; const baseR=18 + i*0.6;
      for(let s=0;s<TUNNEL_SEGMENTS;s++){
        const t=s/TUNNEL_SEGMENTS; const ang=t*Math.PI*2; const bin=Math.min(freqArray.length-1, Math.floor(t*freqArray.length));
        const disp=(freqArray[bin]||0)/255*(0.8+highs*1.8); const r=baseR*(1+disp*0.6);
        arr[s*3]=Math.cos(ang)*r; arr[s*3+1]=Math.sin(ang)*r; arr[s*3+2]=z;
      }
      tunnelGeoms[i].attributes.position.needsUpdate=true;
    }
  }

  // Kaleido Plane RTT
  if (scene.getObjectByName('vis-kaleido-plane')?.visible){
    kaleidoPlaneMat.uniforms.uTime.value += dt;
    kaleidoPlaneMat.uniforms.uBass.value = bass;
    kaleidoPlaneMat.uniforms.uMids.value = mids;
    kaleidoPlaneMat.uniforms.uHighs.value= highs;
    renderer.setRenderTarget(kaleidoRT);
    renderer.render(scene, camera);
    renderer.setRenderTarget(null);
    screenQuad.material.uniforms.uTime.value += dt;
    screenQuad.material.uniforms.uAngle.value += dt*(0.55 + highs*2.2);
    renderer.render(screenScene, screenCam);
    return;
  }

  // City (slow orbit)
  if (scene.getObjectByName('vis-city')?.visible){
    const dummy=new THREE.Object3D(); const spacing=2.4;
    const orbitSpeed=0.15 + bass*0.35; cityOrbit += orbitSpeed*dt;
    const orbitR=75; camera.position.set(Math.cos(cityOrbit)*orbitR, 24+bass*16, Math.sin(cityOrbit)*orbitR); camera.lookAt(0,0,0);
    let i=0; for(let x=0;x<cityGrid;x++) for(let z=0;z<cityGrid;z++){
      const nx=x/cityGrid, nz=z/cityGrid; const bin=Math.min(freqArray.length-1, Math.floor((nx*0.6 + nz*0.4)*freqArray.length)); const e=(freqArray[bin]||0)/255;
      const h=0.5 + e*18 + bass*5.5; dummy.position.set((x-cityGrid/2)*spacing, h/2, (z-cityGrid/2)*spacing); dummy.scale.set(1.05,h,1.05); dummy.updateMatrix(); cityMesh.setMatrixAt(i++, dummy.matrix);
    }
    cityMesh.instanceMatrix.needsUpdate=true; cityMaterial.opacity=0.78+0.22*punch;
  }

  // Glitch ring
  if (scene.getObjectByName('vis-glitch-ring')?.visible){
    const arr=glitchGeom.attributes.position.array;
    for(let i=0;i<arr.length/3;i++){ const idx=i*3; const bx=glitchBasePos[idx], by=glitchBasePos[idx+1];
      const jitter=(Math.random()-0.5)*highs*6.0; const scale=1.0 + 0.02*Math.sin(i*0.3 + now*0.02) + highs*0.3 + punch*0.2;
      arr[idx]=bx*scale + jitter; arr[idx+1]=by*scale + jitter; arr[idx+2]=(Math.sin(i*0.08 + now*0.01) * (0.5 + highs*6.0)); }
    glitchGeom.attributes.position.needsUpdate=true; glitchRing.rotation.z += 0.002 + highs*0.02; glitchRingMaterial.opacity=0.7 + 0.3*punch;
  }

  // Stars Tunnel (reactive but stable)
  if (scene.getObjectByName('vis-star-tunnel')?.visible){
    const arr = stGeom.attributes.position.array;
    const col = stGeom.attributes.color.array;

    const forward = (200 + 700*bass) * dt;
    const twist   = (0.15 + 2.0*mids) * dt;
    const jitter  = highs * 0.35;

    if (beatNow) {
      stPulses.push({ z: -ST_DEPTH + 80, amp: 1.0, width: 110 });
      for (let r=0; r<ST_RINGS; r++) stRingBurst[r] = 1.0;
      for (let i=0; i<stRadOffset.length; i+=7) stVelR[i] += 35 + 220*bass;
    }

    for (let i=stPulses.length-1; i>=0; i--){
      const p = stPulses[i];
      p.z   += forward;
      p.amp  = Math.max(0, p.amp - dt*0.5);
      if (p.z > 80 || p.amp <= 0) stPulses.splice(i,1);
    }

    for (let r=0; r<ST_RINGS; r++){
      stRingRot[r] += twist * (1.0 + r*0.001);
      stBaseZ[r]   += forward;
      if (stBaseZ[r] > 40) stBaseZ[r] -= ST_DEPTH;
      stRingBurst[r] = Math.max(0, stRingBurst[r] - dt*1.6);
    }

    let ptr = 0;
    const nowT = performance.now() * 0.001;
    for (let r=0; r<ST_RINGS; r++){
      const z = stBaseZ[r];
      let pulse = 0.0;
      for (let k=0; k<stPulses.length; k++){
        const p = stPulses[k];
        const dz = z - p.z;
        pulse += p.amp * Math.exp(-(dz*dz) / (2.0 * (p.width*p.width)));
      }
      const ringHue  = (currentHue + r*0.01) % 1;
      const baseR    = stRingRadiusBase[r];
      const ringPump = 0.18*bass + 0.22*stRingBurst[r] + 0.12*pulse;

      for (let s=0; s<ST_PER_RING; s++, ptr++){
        stVelR[ptr] += (-stRadOffset[ptr]) * 6.0 * dt;
        stVelR[ptr] *= (0.90 - 0.12*mids);
        stRadOffset[ptr] += stVelR[ptr] * (1.0 + 1.5*bass);

        const a   = s*GOLDEN_ANGLE + r*0.15 + stRingRot[r];
        let rad   = baseR * (1.0 + ringPump) + stRadOffset[ptr];

        if (rad > 260) { rad = 260; stRadOffset[ptr] = rad - baseR; stVelR[ptr] *= -0.55; }
        if (rad <   2) { rad =   2; stRadOffset[ptr] = rad - baseR; stVelR[ptr] *= -0.55; }

        const j = jitter * 0.6 * Math.sin((ptr*0.37) + nowT * (8.0 + 60.0*highs));

        arr[ptr*3]   = Math.cos(a) * rad + j;
        arr[ptr*3+1] = Math.sin(a) * rad + j;
        arr[ptr*3+2] = z;

        const depthFade = THREE.MathUtils.clamp(1.0 - (z + ST_DEPTH) / ST_DEPTH, 0.2, 1.0);
        const bright    = THREE.MathUtils.clamp(0.35 + 0.8*pulse + 0.25*depthFade + 0.35*punch + 0.25*highs, 0.15, 1.6);
        const rgb       = new THREE.Color().setHSL(ringHue, 1.0, THREE.MathUtils.clamp(0.45 + 0.35*bright, 0, 1));
        col[ptr*3]   = rgb.r; col[ptr*3+1] = rgb.g; col[ptr*3+2] = rgb.b;
      }
    }

    stGeom.attributes.position.needsUpdate = true;
    stGeom.attributes.color.needsUpdate    = true;
    stMat.size = 3.0 * (1.0 + highs*1.3 + 0.6*punch);
  }

  // Bloom Tunnel animate
  if (scene.getObjectByName('vis-bloom-tunnel')?.visible && bloomGroup){
    bloomPass.strength = 1.0 + 1.5*punch + 0.6*highs;
    bloomGroup.children.forEach((torus, i) => {
      const scale = 1.0 + (freqArray ? (freqArray[(i*7)%freqArray.length]/255)*0.25 : 0) + bass*0.3;
      torus.scale.setScalar(scale);
      torus.rotation.z += 0.01 + mids*0.05;
      torus.position.z += (260 + bass*520) * (1/26) * (1/60);
      if (torus.position.z > 40) torus.position.z = -TUNNEL_DEPTH;
      const L = 0.6 + 0.4*Math.sin((i*0.3) + now*0.004 + highs*2.0);
      torus.material.color.setHSL((currentHue + i*0.01)%1, 1, L);
      torus.material.opacity = 0.7 + 0.3*punch;
    });
  }

  // God Rays animate
  if (scene.getObjectByName('vis-godrays')?.visible && godGroup){
    bloomPass.strength = 0.9 + 1.2*punch + 0.5*bass;
    godGroup.rotation.y += 0.002 + 0.01*mids;
    godGroup.children.forEach((cone, i)=>{
      const swell = 1.0 + bass*0.8 + 0.15*Math.sin(now*0.003 + i);
      cone.scale.set(1, swell, 1);
      cone.material.opacity = 0.12 + 0.18*(bass + highs*0.5 + punch*0.8);
      cone.material.color.setHSL((currentHue + i*0.02)%1, 1, 0.55);
    });
  }

  scene.rotation.y += 0.003;

  const useComposer = bloomPass.enabled || glitchPass.enabled || rgbShiftPass.enabled;
  if (useComposer) composer.render(); else renderer.render(scene, camera);
}
animate();
