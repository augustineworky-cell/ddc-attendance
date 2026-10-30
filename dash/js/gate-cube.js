/* Staffly login hero: dark metallic 3x3x3 block cube (Three.js).
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

  const composer = new EffectComposer(renderer);
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
    }
    ptr.x += (ptr.tx - ptr.x) * Math.min(1, dt * 3); ptr.y += (ptr.ty - ptr.y) * Math.min(1, dt * 3);
    holder.rotation.y = ptr.x * 0.22; holder.rotation.x = ptr.y * 0.12;
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
  };
}
