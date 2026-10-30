/* Staffly login hero: dark metallic 3x3x3 block cube (Three.js) over a night sky
   (falling stars, Milky Way, shooting stars, mountain horizon).
   Loaded only on the PC login screen, only on wide screens with WebGL.
   startCube(el) draws into `el` and returns stop(), which frees the GPU when the login closes. */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

const CFG = {
  size: 1, gap: 0.06, bevel: 0.12,
  turnTime: 0.85, pauseTime: 1.0, spinSpeed: 0.12,
  bloom: { strength: 0.32, radius: 0.6, threshold: 0.82 },
  offsetX: 0.35, scale: 0.82
};

export function startCube(el) {
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const W = () => el.clientWidth || innerWidth, H = () => el.clientHeight || innerHeight;

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(W(), H());
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.9;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  el.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x050505);
  scene.fog = new THREE.Fog(0x050505, 9, 16);
  const camera = new THREE.PerspectiveCamera(32, W() / H(), 0.1, 100);
  camera.position.set(0, 0.5, 12);

  const pmrem = new THREE.PMREMGenerator(renderer);
  const envTex = pmrem.fromScene(new RoomEnvironment(renderer), 0.04).texture;
  scene.environment = envTex;
  scene.environmentIntensity = 0.55;

  const key = new THREE.DirectionalLight(0xffffff, 2.4); key.position.set(-5, 6, 5); scene.add(key);
  const rim = new THREE.DirectionalLight(0xbfd4ff, 1.6); rim.position.set(6, 2, -6); scene.add(rim);
  scene.add(new THREE.AmbientLight(0xffffff, 0.06));

  /* ---------- night sky behind the cube (stars, Milky Way, shooting stars) ---------- */
  /* ===== starfield (behind the cube) ===== */
  const sky = new THREE.Group(); scene.add(sky);
  const N = 2400, pos = new Float32Array(N * 3), seed = new Float32Array(N * 2), depth = new Float32Array(N);
  const BOX = { x: 34, y: 22, zNear: -6, zFar: -42 };
  for (let i = 0; i < N; i++) {
    const z = BOX.zNear + Math.random() * (BOX.zFar - BOX.zNear);
    pos[i * 3] = (Math.random() - 0.5) * BOX.x * (1 + -z / 30);
    pos[i * 3 + 1] = (Math.random() - 0.5) * BOX.y * (1 + -z / 30);
    pos[i * 3 + 2] = z;
    seed[i * 2] = Math.random() * 6.283; seed[i * 2 + 1] = 0.6 + Math.random() * 2.4;
    depth[i] = 1 - (z - BOX.zNear) / (BOX.zFar - BOX.zNear);       // 1 = near, 0 = far
  }
  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  starGeo.setAttribute('seed', new THREE.BufferAttribute(seed, 2));
  starGeo.setAttribute('depth', new THREE.BufferAttribute(depth, 1));
  const starMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
    uniforms: { uTime: { value: 0 }, uFall: { value: 0 }, uPx: { value: renderer.getPixelRatio() } },
    vertexShader: `
      attribute vec2 seed; attribute float depth;
      uniform float uTime; uniform float uFall; uniform float uPx;
      varying float vA; varying float vCore;
      void main(){
        vec3 p = position;
        float span = 26.0 * (1.0 + -p.z / 30.0);
        p.y = mod(p.y - uFall * (0.35 + depth * 1.4) + span * 0.5, span) - span * 0.5;   // slow fall, nearer stars fall faster
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        float tw = 0.55 + 0.45 * sin(uTime * seed.y + seed.x);
        vA = (0.45 + 0.85 * depth) * tw;
        vCore = depth;
        gl_PointSize = (1.5 + depth * 3.4) * uPx * (0.85 + 0.3 * tw);
      }`,
    fragmentShader: `
      varying float vA; varying float vCore;
      void main(){
        vec2 c = gl_PointCoord - 0.5; float d = length(c);
        float core = smoothstep(0.5, 0.0, d);
        float a = pow(core, 1.6) * vA;
        gl_FragColor = vec4(mix(vec3(0.85,0.9,1.0), vec3(1.0), vCore), a);
      }`
  });
  sky.add(new THREE.Points(starGeo, starMat));

  /* ===== milky way band (procedural clouds with dark dust lanes) ===== */
  const NOISE = `
    float h(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
    float n(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
      return mix(mix(h(i),h(i+vec2(1,0)),f.x), mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x), f.y); }
    float fbm(vec2 p){ float v=0.0, a=0.5; for(int k=0;k<6;k++){ v+=a*n(p); p=p*2.03+vec2(1.7,9.2); a*=0.5; } return v; }`;
  const milky = new THREE.Mesh(new THREE.PlaneGeometry(90, 56), new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
    uniforms: { uTime: { value: 0 } },
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: NOISE + `
      uniform float uTime; varying vec2 vUv;
      void main(){
        vec2 p = (vUv - 0.5) * vec2(1.6, 1.0) * 2.0;
        vec2 nrm = normalize(vec2(-0.5, 0.86));
        float warp = fbm(p * 1.4 + uTime * 0.01) - 0.5;
        float d = dot(p, nrm) + 0.18 + warp * 0.35;
        float band = exp(-d * d / 0.09);
        float core = exp(-d * d / 0.018);
        float clouds = fbm(p * 3.2 + vec2(uTime * 0.006, 0.0));
        float lanes = smoothstep(0.52, 0.72, fbm(p * 5.5 + 4.0)) * exp(-d * d / 0.03);
        float I = band * (0.25 + 0.9 * clouds) * (1.0 - 0.75 * lanes) * 0.6 + core * clouds * 0.25;
        gl_FragColor = vec4(vec3(0.86, 0.89, 0.96) * I, I);
      }`
  }));
  milky.position.set(0, 0, -48);
  sky.add(milky);

  /* dense star dust along the band */
  const DN = 7000, dpos = new Float32Array(DN * 3), dseed = new Float32Array(DN * 2), ddep = new Float32Array(DN);
  const along = new THREE.Vector2(0.86, 0.5), across = new THREE.Vector2(-0.5, 0.86);
  for (let i = 0; i < DN; i++) {
    const t = (Math.random() * 2 - 1) * 1.3;
    const g = (Math.random() + Math.random() + Math.random() - 1.5) * 0.32 - 0.18;
    const x = along.x * t + across.x * g, y = along.y * t + across.y * g;
    dpos[i * 3] = x * 40; dpos[i * 3 + 1] = y * 26; dpos[i * 3 + 2] = -34 - Math.random() * 10;
    dseed[i * 2] = Math.random() * 6.283; dseed[i * 2 + 1] = 0.5 + Math.random() * 2;
    ddep[i] = Math.random() * 0.35;
  }
  const dustGeo = new THREE.BufferGeometry();
  dustGeo.setAttribute('position', new THREE.BufferAttribute(dpos, 3));
  dustGeo.setAttribute('seed', new THREE.BufferAttribute(dseed, 2));
  dustGeo.setAttribute('depth', new THREE.BufferAttribute(ddep, 1));
  const dustMat = starMat.clone();
  dustMat.uniforms = { uTime: starMat.uniforms.uTime, uFall: { value: 0 }, uPx: starMat.uniforms.uPx };
  sky.add(new THREE.Points(dustGeo, dustMat));

  /* a few bright stars with a soft halo */
  const BN = 60, bpos = new Float32Array(BN * 3), bseed = new Float32Array(BN * 2), bdep = new Float32Array(BN);
  for (let i = 0; i < BN; i++) { bpos[i * 3] = (Math.random() - 0.5) * 40; bpos[i * 3 + 1] = (Math.random() - 0.5) * 26; bpos[i * 3 + 2] = -10 - Math.random() * 18; bseed[i * 2] = Math.random() * 6.283; bseed[i * 2 + 1] = 0.4 + Math.random(); bdep[i] = 1; }
  const brightGeo = new THREE.BufferGeometry();
  brightGeo.setAttribute('position', new THREE.BufferAttribute(bpos, 3));
  brightGeo.setAttribute('seed', new THREE.BufferAttribute(bseed, 2));
  brightGeo.setAttribute('depth', new THREE.BufferAttribute(bdep, 1));
  const brightMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
    uniforms: { uTime: starMat.uniforms.uTime, uFall: starMat.uniforms.uFall, uPx: starMat.uniforms.uPx },
    vertexShader: `attribute vec2 seed; attribute float depth; uniform float uTime; uniform float uFall; uniform float uPx; varying float vA;
      void main(){ vec3 p = position; float span = 26.0 * (1.0 + -p.z / 30.0); p.y = mod(p.y - uFall * 1.2 + span*0.5, span) - span*0.5;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p,1.0); float tw = 0.6 + 0.4*sin(uTime*seed.y+seed.x); vA = tw; gl_PointSize = (9.0 + 5.0*tw) * uPx; }`,
    fragmentShader: `varying float vA; void main(){ vec2 c = gl_PointCoord - 0.5; float d = length(c);
        float core = smoothstep(0.12, 0.0, d); float halo = smoothstep(0.5, 0.0, d) * 0.28;
        float spike = (smoothstep(0.04, 0.0, abs(c.x)) + smoothstep(0.04, 0.0, abs(c.y))) * smoothstep(0.5, 0.0, d) * 0.35;
        gl_FragColor = vec4(vec3(1.0), (core + halo + spike) * vA); }`
  });
  sky.add(new THREE.Points(brightGeo, brightMat));

  /* ===== shooting stars — brighter, longer, often in parallel bursts ===== */
  const shotMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
    uniforms: { uFade: { value: 1 } },
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `
      uniform float uFade; varying vec2 vUv;
      void main(){
        float along = vUv.x;                         // 0 = tail end, 1 = head
        float across = 1.0 - abs(vUv.y - 0.5) * 2.0;
        float tail = pow(along, 1.8) * pow(across, 5.0);
        float glow = pow(along, 4.0) * pow(across, 1.6) * 0.35;
        float head = smoothstep(0.93, 1.0, along) * pow(across, 1.4) * 2.2;
        float a = (tail + glow + head) * uFade;
        gl_FragColor = vec4(mix(vec3(0.8,0.86,1.0), vec3(1.4), along), a);
      }`
  });
  const shotGeo = new THREE.PlaneGeometry(1, 1);
  const shots = [], queue = [];
  function spawnShot(ang, z, start, delay) {
    if (delay > 0) { queue.push({ ang, z, start, t: delay }); return; }
    const m = new THREE.Mesh(shotGeo, shotMat.clone());
    const k = 1 + -z / 30;
    const dir = new THREE.Vector3(Math.cos(ang), Math.sin(ang), 0);
    const len = (4 + Math.random() * 4.5) * k;
    m.scale.set(len, 0.2 * k, 1);
    m.rotation.z = ang + Math.PI;
    m.position.copy(start);
    scene.add(m);
    shots.push({ m, dir, speed: (16 + Math.random() * 10) * k, life: 0, max: 1.0 + Math.random() * 0.6 });
  }
  function launch() {
    const ang = THREE.MathUtils.degToRad(200 + Math.random() * 14);
    const z = -9 - Math.random() * 9, k = 1 + -z / 30;
    const base = new THREE.Vector3((1 + Math.random() * 12) * k, (3.5 + Math.random() * 5) * k, z);
    const n = Math.random() < 0.45 ? 2 + (Math.random() < 0.35 ? 1 : 0) : 1;   // bursts of 2-3 parallel streaks
    const side = new THREE.Vector3(-Math.sin(ang), Math.cos(ang), 0);
    for (let i = 0; i < n; i++) spawnShot(ang, z, base.clone().addScaledVector(side, i * (1.4 + Math.random()) * k).add(new THREE.Vector3(i * 0.8 * k, 0, 0)), i * (0.12 + Math.random() * 0.25));
  }

  let nextShot = 0.4, fall = 0;

  /* mountain ridges + horizon glow (SVG over the canvas, under the edge fade) */
  const hz = document.createElement('div');
  hz.style.cssText = 'position:absolute;left:0;right:0;bottom:0;height:40%;pointer-events:none;background:radial-gradient(ellipse 70% 100% at 50% 100%,rgba(255,255,255,.10),rgba(255,255,255,0) 70%)';
  const NS = 'http://www.w3.org/2000/svg', svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 1440 900'); svg.setAttribute('preserveAspectRatio', 'none');
  svg.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none';
  const ridge = (base, amp, sd, step) => { let d = 'M0 900 L0 ' + base; for (let x = 0; x <= 1440; x += step) { const y = base - amp * (0.55 * Math.sin(x / 210 + sd) + 0.3 * Math.sin(x / 83 + sd * 2.1) + 0.15 * Math.sin(x / 31 + sd * 3.7)) - amp * 0.35 * Math.exp(-Math.pow((x - 300 - sd * 40) / 160, 2)); d += ' L' + x + ' ' + y.toFixed(1); } return d + ' L1440 900 Z'; };
  [[815, 46, 1.3, 12, '#0a0a0a'], [858, 34, 4.1, 10, '#020202']].forEach(([b, a, sd, st, c]) => { const pth = document.createElementNS(NS, 'path'); pth.setAttribute('d', ridge(b, a, sd, st)); pth.setAttribute('fill', c); svg.appendChild(pth); });
  el.appendChild(hz); el.appendChild(svg);

  const tex = (draw, s = 256) => { const c = document.createElement('canvas'); c.width = c.height = s; draw(c.getContext('2d'), s); const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; return t; };
  const grain = tex((g, s) => { const d = g.createImageData(s, s); for (let i = 0; i < d.data.length; i += 4) { const v = 150 + Math.random() * 90; d.data[i] = d.data[i + 1] = d.data[i + 2] = v; d.data[i + 3] = 255; } g.putImageData(d, 0, 0); });
  const brush = tex((g, s) => { g.fillStyle = '#9a9a9a'; g.fillRect(0, 0, s, s); for (let y = 0; y < s; y++) { g.fillStyle = 'rgba(255,255,255,' + (Math.random() * 0.12) + ')'; g.fillRect(0, y, s, 1); } });
  const mesh = tex((g, s) => { g.fillStyle = '#fff'; g.fillRect(0, 0, s, s); g.fillStyle = '#000'; const st = s / 16; for (let y = st / 2; y < s; y += st) for (let x = st / 2; x < s; x += st) { g.beginPath(); g.arc(x, y, st * 0.28, 0, 7); g.fill(); } });
  const mats = [
    new THREE.MeshPhysicalMaterial({ color: 0x141414, metalness: 1, roughness: 0.32, roughnessMap: grain, clearcoat: 0.4, clearcoatRoughness: 0.35 }),
    new THREE.MeshPhysicalMaterial({ color: 0x0c0c0c, metalness: 0.9, roughness: 0.55, roughnessMap: grain }),
    new THREE.MeshPhysicalMaterial({ color: 0x8c8c8c, metalness: 1, roughness: 0.28, roughnessMap: brush }),
    new THREE.MeshPhysicalMaterial({ color: 0x1a1a1a, metalness: 1, roughness: 0.45, roughnessMap: mesh, bumpMap: mesh, bumpScale: 0.6 }),
    new THREE.MeshPhysicalMaterial({ color: 0x0f0f0f, metalness: 1, roughness: 0.12, clearcoat: 1, clearcoatRoughness: 0.05 })
  ];
  const pick = () => { const r = Math.random(); return r < 0.45 ? mats[0] : r < 0.7 ? mats[1] : r < 0.8 ? mats[2] : r < 0.9 ? mats[3] : mats[4]; };

  const STEP = CFG.size + CFG.gap;
  const geo = new RoundedBoxGeometry(CFG.size, CFG.size, CFG.size, 4, CFG.bevel);
  const cube = new THREE.Group(), holder = new THREE.Group();
  holder.add(cube); holder.scale.setScalar(CFG.scale); scene.add(holder);
  const blocks = [];
  for (let x = -1; x <= 1; x++) for (let y = -1; y <= 1; y++) for (let z = -1; z <= 1; z++) {
    const m = new THREE.Mesh(geo, pick()); m.position.set(x * STEP, y * STEP, z * STEP); cube.add(m); blocks.push(m);
  }
  cube.rotation.set(-0.45, 0.65, 0.08);

  /* render target with 4x MSAA: without it the post-processing chain draws the cube with jagged, blurry edges */
  const rt = new THREE.WebGLRenderTarget(W() * renderer.getPixelRatio(), H() * renderer.getPixelRatio(), { type: THREE.HalfFloatType, samples: 4 });
  const composer = new EffectComposer(renderer, rt);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(W(), H()), CFG.bloom.strength, CFG.bloom.radius, CFG.bloom.threshold);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  const pivot = new THREE.Object3D(); cube.add(pivot);
  let move = null, idle = 0.8, lastAxis = null;
  const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  function startMove() {
    let axis; do { axis = 'xyz'[(Math.random() * 3) | 0]; } while (axis === lastAxis);
    lastAxis = axis;
    const layer = [-1, 0, 1][(Math.random() * 3) | 0];
    pivot.rotation.set(0, 0, 0); pivot.updateMatrixWorld();
    const group = blocks.filter((b) => Math.round(b.position[axis] / STEP) === layer);
    group.forEach((b) => pivot.attach(b));
    move = { axis, dir: Math.random() > 0.5 ? 1 : -1, group, t: 0 };
  }
  function endMove() {
    pivot.updateMatrixWorld();
    const q = Math.PI / 2;
    move.group.forEach((b) => {
      cube.attach(b);
      b.position.set(Math.round(b.position.x / STEP) * STEP, Math.round(b.position.y / STEP) * STEP, Math.round(b.position.z / STEP) * STEP);
      const e = new THREE.Euler().setFromQuaternion(b.quaternion);
      b.rotation.set(Math.round(e.x / q) * q, Math.round(e.y / q) * q, Math.round(e.z / q) * q);
    });
    pivot.rotation.set(0, 0, 0); move = null; idle = CFG.pauseTime;
  }

  const ptr = { x: 0, y: 0, tx: 0, ty: 0 };
  const onMove = (e) => { ptr.tx = (e.clientX / innerWidth - 0.5) * 2; ptr.ty = (e.clientY / innerHeight - 0.5) * 2; };
  addEventListener('pointermove', onMove);

  function layout() {
    const w = W(), h = H();
    camera.aspect = w / h; camera.updateProjectionMatrix();
    renderer.setSize(w, h); composer.setSize(w, h); bloom.setSize(w, h);
    holder.position.x = w < 1100 ? 0 : CFG.offsetX;
  }
  const ro = new ResizeObserver(layout); ro.observe(el); layout();

  const clock = new THREE.Clock();
  let raf = 0, alive = true, hidden = false;
  const onVis = () => { hidden = document.hidden; if (!hidden) clock.getDelta(); };
  document.addEventListener('visibilitychange', onVis);
  function tick() {
    if (!alive) return;
    raf = requestAnimationFrame(tick);
    if (hidden) return;
    const dt = Math.min(clock.getDelta(), 0.05), t = clock.elapsedTime;
    if (!reduce) {
      if (move) { move.t = Math.min(1, move.t + dt / CFG.turnTime); pivot.rotation[move.axis] = move.dir * q90 * ease(move.t); if (move.t >= 1) endMove(); }
      else if ((idle -= dt) <= 0) startMove();
      cube.rotation.y += CFG.spinSpeed * dt;
      holder.position.y = Math.sin(t * 0.8) * 0.12;
      fall += dt;
      if ((nextShot -= dt) <= 0) { launch(); nextShot = 0.7 + Math.random() * 1.4; }
      for (let i = queue.length - 1; i >= 0; i--) { if ((queue[i].t -= dt) <= 0) { const q = queue.splice(i, 1)[0]; spawnShot(q.ang, q.z, q.start, 0); } }
    }
    starMat.uniforms.uTime.value = t; starMat.uniforms.uFall.value = fall; dustMat.uniforms.uFall.value = fall * 0.25; milky.material.uniforms.uTime.value = t;
    for (let i = shots.length - 1; i >= 0; i--) {
      const s = shots[i]; s.life += dt;
      const k = s.life / s.max;
      if (k >= 1) { scene.remove(s.m); s.m.material.dispose(); shots.splice(i, 1); continue; }
      s.m.position.addScaledVector(s.dir, s.speed * dt);
      s.m.material.uniforms.uFade.value = k < 0.12 ? k / 0.12 : 1 - Math.max(0, (k - 0.55) / 0.45);
    }
    ptr.x += (ptr.tx - ptr.x) * Math.min(1, dt * 3); ptr.y += (ptr.ty - ptr.y) * Math.min(1, dt * 3);
    holder.rotation.y = ptr.x * 0.22; holder.rotation.x = ptr.y * 0.12;
    sky.position.x = -ptr.x * 0.8; sky.position.y = ptr.y * 0.5;
    key.position.x = -5 + ptr.x * 2;
    composer.render();
  }
  const q90 = Math.PI / 2;
  tick();

  return function stop() {
    alive = false; cancelAnimationFrame(raf);
    removeEventListener('pointermove', onMove);
    document.removeEventListener('visibilitychange', onVis);
    ro.disconnect();
    geo.dispose(); mats.forEach((m) => m.dispose()); [grain, brush, mesh].forEach((t) => t.dispose());
    envTex.dispose(); pmrem.dispose(); composer.dispose?.(); renderer.dispose();
    renderer.domElement.remove();
    hz.remove(); svg.remove();
    shots.forEach((x) => x.m.material.dispose()); shotGeo.dispose(); shotMat.dispose();
    [starGeo, dustGeo, brightGeo, milky.geometry].forEach((x) => x.dispose()); [starMat, dustMat, brightMat, milky.material].forEach((x) => x.dispose());
  };
}
