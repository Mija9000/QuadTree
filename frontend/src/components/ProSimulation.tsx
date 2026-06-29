import React, { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader";
import { RGBELoader } from "three/examples/jsm/loaders/RGBELoader";
import { getTree, queryTree, setTreeBoundary } from "../services/api";
import { rebuildSimulationTree, SimulationParticle } from "../services/simulationApi";
import "../styles/ProSimulation.css";

interface ParticleSnapshot {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
}

interface TreeSnapshot {
  boundary: { x: number; y: number; w: number; h: number };
  particles: ParticleSnapshot[];
  children: TreeSnapshot[];
}

interface FlatSnapshot {
  particles: ParticleSnapshot[];
  boundaries: Array<{ x: number; y: number; w: number; h: number }>;
}

interface QueryResult {
  range: { x: number; y: number; w: number; h: number };
  comparisons: number;
  count: number;
  particles: SimulationParticle[];
}

type TreeNodeSnapshot = TreeSnapshot;

interface DroneSceneState {
  from: Map<number, THREE.Vector3>;
  to: Map<number, THREE.Vector3>;
  startedAt: number;
  duration: number;
}

interface ProStats {
  drones: number;
  quadtreeNodes: number;
  frame: number;
  comparisons: number;
  avoided: number;
  rebuildMs: number;
  fps: number;
  bruteForceComparisons: number;
  treeNodes: number;
  treeParticles: number;
  lastSyncLabel: string;
}

type DroneVisual = {
  group: THREE.Group;
  propellers: THREE.Object3D[];
};

const WORLD_SIZE = 720; // ← CONSTANTE GLOBAL por defecto
const SKY_COLOR = "#84d8ff";
const INTERPOLATION_MS = 260;
const POLL_MS = 250;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const moveDrone = (drone: ParticleSnapshot, deltaSeconds: number, worldSize: number): ParticleSnapshot => {
  let x = drone.x + drone.vx * deltaSeconds;
  let y = drone.y + drone.vy * deltaSeconds;
  let vx = drone.vx;
  let vy = drone.vy;

  if (x - drone.radius < 0) {
    x = drone.radius;
    vx = Math.abs(vx);
  } else if (x + drone.radius > worldSize) {
    x = worldSize - drone.radius;
    vx = -Math.abs(vx);
  }

  if (y - drone.radius < 0) {
    y = drone.radius;
    vy = Math.abs(vy);
  } else if (y + drone.radius > worldSize) {
    y = worldSize - drone.radius;
    vy = -Math.abs(vy);
  }

  return { ...drone, x, y, vx, vy };
};

const queryRangeForDrone = (drone: ParticleSnapshot, worldSize: number) => {
  const safetyRadius = 26 + (drone.id % 6) * 2;
  const x = clamp(drone.x - safetyRadius, 0, worldSize);
  const y = clamp(drone.y - safetyRadius, 0, worldSize);
  const w = clamp(safetyRadius * 2, 1, worldSize - x);
  const h = clamp(safetyRadius * 2, 1, worldSize - y);

  return { x, y, w, h };
};

const countParticles = (node: TreeSnapshot | null): number => {
  if (!node) return 0;
  let count = node.particles?.length ?? 0;
  for (const child of node.children ?? []) {
    count += countParticles(child);
  }
  return count;
};

const easeInOut = (value: number) => {
  const t = clamp(value, 0, 1);
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
};

const createCanvasTexture = (
  draw: (context: CanvasRenderingContext2D, size: number) => void,
  size = 512,
  repeat = 1
) => {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");
  if (!context) return null;
  draw(context, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(repeat, repeat);
  texture.anisotropy = 8;
  return texture;
};

const createGrassTexture = () =>
  createCanvasTexture((context, size) => {
    context.fillStyle = "#355d2d";
    context.fillRect(0, 0, size, size);

    for (let index = 0; index < 9000; index += 1) {
      const x = Math.random() * size;
      const y = Math.random() * size;
      const r = 1 + Math.random() * 2.5;
      const green = 80 + Math.random() * 90;
      context.fillStyle = `rgba(${35 + Math.random() * 20}, ${green}, ${25 + Math.random() * 15}, 0.18)`;
      context.beginPath();
      context.arc(x, y, r, 0, Math.PI * 2);
      context.fill();
    }

    for (let index = 0; index < 220; index += 1) {
      const x = Math.random() * size;
      const y = Math.random() * size;
      const w = 10 + Math.random() * 22;
      const h = 2 + Math.random() * 6;
      context.fillStyle = `rgba(${55 + Math.random() * 30}, ${110 + Math.random() * 60}, ${35 + Math.random() * 20}, 0.18)`;
      context.fillRect(x, y, w, h);
    }
  }, 512, 24);

const createRockTexture = () =>
  createCanvasTexture((context, size) => {
    context.fillStyle = "#767b80";
    context.fillRect(0, 0, size, size);
    for (let index = 0; index < 6000; index += 1) {
      const x = Math.random() * size;
      const y = Math.random() * size;
      const shade = 110 + Math.random() * 70;
      const alpha = 0.06 + Math.random() * 0.08;
      context.fillStyle = `rgba(${shade}, ${shade}, ${shade}, ${alpha})`;
      context.fillRect(x, y, 2 + Math.random() * 5, 1 + Math.random() * 3);
    }
  }, 512, 6);

const createGroundHeightGeometry = () => {
  const groundSize = 800;
  const segments = 128;
  const geometry = new (THREE as any).PlaneGeometry(groundSize, groundSize, segments, segments);
  const positions = geometry.attributes.position.array as Float32Array;

  for (let index = 0; index < positions.length; index += 3) {
    const x = positions[index];
    const y = positions[index + 1];
    const noise =
      Math.sin(x * 0.008) * Math.cos(y * 0.01) * 3 +
      Math.sin(x * 0.02 + y * 0.015) * 1.5 +
      Math.sin(x * 0.04) * Math.cos(y * 0.035) * 0.8;
    positions[index + 2] = noise;
  }

  geometry.computeVertexNormals();

  const colors = new Float32Array(positions.length);
  for (let index = 0; index < positions.length; index += 3) {
    const height = positions[index + 2];
    const grassBlend = clamp((height + 4) / 8, 0, 1);
    colors[index] = 0.12 + grassBlend * 0.06;
    colors[index + 1] = 0.25 + grassBlend * 0.25;
    colors[index + 2] = 0.08 + grassBlend * 0.04;
  }

  geometry.setAttribute("color", new (THREE as any).BufferAttribute(colors, 3));
  return geometry;
};

const addSkyEnvironment = async (scene: THREE.Scene, renderer: THREE.WebGLRenderer) => {
  const rgbeLoader = new RGBELoader();
  try {
    const hdr = await rgbeLoader.loadAsync("https://threejs.org/examples/textures/equirectangular/venice_sunset_1k.hdr");
    hdr.mapping = THREE.EquirectangularReflectionMapping;
    scene.background = hdr;
    const pmrem = new THREE.PMREMGenerator(renderer);
    const env = pmrem.fromEquirectangular(hdr).texture;
    scene.environment = env;
    hdr.dispose();
    pmrem.dispose();
  } catch {
    scene.background = new THREE.Color(0x87cfff);
    scene.environment = null;
  }
};

const addModelOrFallback = async (
  scene: THREE.Scene,
  loader: GLTFLoader,
  url: string,
  fallback: () => THREE.Object3D,
  position: THREE.Vector3,
  scale: number
) => {
  try {
    const gltf = await loader.loadAsync(url);
    gltf.scene.position.copy(position);
    gltf.scene.scale.setScalar(scale);
    gltf.scene.traverse((child) => {
      const mesh = child as THREE.Mesh;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
    });
    scene.add(gltf.scene);
  } catch {
    const object = fallback();
    object.position.copy(position);
    object.scale.setScalar(scale);
    scene.add(object);
  }
};

const mapWorldToScene = (x: number, y: number, worldSize: number) => ({
  x: x - worldSize / 2,
  z: y - worldSize / 2,
});

const formatTime = (date: Date) =>
  date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });

const flattenTree = (root: TreeSnapshot | null): FlatSnapshot => {
  const particles: ParticleSnapshot[] = [];
  const boundaries: Array<{ x: number; y: number; w: number; h: number }> = [];

  const visit = (node: TreeSnapshot | null) => {
    if (!node) return;
    boundaries.push(node.boundary);
    particles.push(...node.particles);
    for (const child of node.children ?? []) {
      visit(child);
    }
  };

  visit(root);
  return { particles, boundaries };
};

const disposeObject = (object: THREE.Object3D) => {
  object.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (mesh.geometry) {
      mesh.geometry.dispose();
    }
    const material = mesh.material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(material)) {
      for (const entry of material) {
        entry.dispose();
      }
    } else if (material) {
      material.dispose();
    }
  });
};

const createDroneMesh = (particle: ParticleSnapshot): DroneVisual => {
  const color = new THREE.Color().setHSL((particle.id * 0.13) % 1, 0.74, 0.58);
  const group = new THREE.Group();
  const propellers: THREE.Object3D[] = [];

  const bodyMaterial = new THREE.MeshStandardMaterial({
    color: 0x1e232b,
    roughness: 0.16,
    metalness: 0.76,
    emissive: color.clone().multiplyScalar(0.06),
    emissiveIntensity: 0.55,
  });

  const shell = new THREE.Mesh(
    new THREE.BoxGeometry(1.82, 0.34, 1.08),
    bodyMaterial
  );
  shell.scale.set(1.08, 1, 0.98);
  shell.castShadow = true;
  shell.receiveShadow = true;
  group.add(shell);

  const topCap = new THREE.Mesh(
    new THREE.SphereGeometry(0.56, 16, 12),
    new THREE.MeshStandardMaterial({
      color: 0xcfd6df,
      roughness: 0.12,
      metalness: 0.84,
      emissive: new THREE.Color(0x9ddcff).multiplyScalar(0.05),
    })
  );
  topCap.position.set(0, 0.27, 0);
  topCap.scale.set(1.16, 0.48, 1.08);
  group.add(topCap);

  const spine = new THREE.Mesh(
    new THREE.BoxGeometry(1.16, 0.12, 0.82),
    new THREE.MeshStandardMaterial({ color: 0x0f1318, roughness: 0.32, metalness: 0.42 })
  );
  spine.position.set(0, 0.04, 0);
  group.add(spine);

  const underPod = new THREE.Mesh(
    new THREE.SphereGeometry(0.24, 10, 8),
    new THREE.MeshStandardMaterial({ color: 0x0d1116, roughness: 0.56, metalness: 0.26 })
  );
  underPod.position.set(0, -0.34, 0.02);
  underPod.scale.set(1.1, 0.5, 0.95);
  group.add(underPod);

  const armMaterial = new THREE.MeshStandardMaterial({
    color: 0xb8c3cc,
    roughness: 0.22,
    metalness: 0.8,
    emissive: new THREE.Color(0x5ca9ff).multiplyScalar(0.04),
  });

  const motorMaterial = new THREE.MeshStandardMaterial({
    color: 0x2a313b,
    roughness: 0.48,
    metalness: 0.5,
  });

  const propMaterial = new THREE.MeshBasicMaterial({
    color: 0xbfe7ff,
    transparent: true,
    opacity: 0.35,
  });

  const armSpecs = [
    { x: 1.1, z: 0, rot: Math.PI / 2 },
    { x: -1.1, z: 0, rot: Math.PI / 2 },
    { x: 0, z: 1.1, rot: 0 },
    { x: 0, z: -1.1, rot: 0 },
  ];

  armSpecs.forEach((spec, index) => {
    const arm = new THREE.Mesh(new THREE.BoxGeometry(1.56, 0.06, 0.12), armMaterial);
    arm.position.set(spec.x / 2, -0.02, spec.z / 2);
    arm.rotation.y = spec.rot;
    group.add(arm);

    const motor = new THREE.Mesh(new THREE.SphereGeometry(0.19, 12, 8), motorMaterial);
    motor.position.set(spec.x, 0.07, spec.z);
    group.add(motor);

    const rotorHub = new THREE.Mesh(
      new THREE.BoxGeometry(0.16, 0.03, 0.16),
      new THREE.MeshStandardMaterial({ color: 0x1a1f25, roughness: 0.6, metalness: 0.2 })
    );
    rotorHub.position.set(spec.x, 0.2, spec.z);
    group.add(rotorHub);

    const bladeA = new THREE.Mesh(new THREE.BoxGeometry(1.02, 0.02, 0.09), propMaterial);
    bladeA.position.set(spec.x, 0.245, spec.z);
    bladeA.rotation.y = index % 2 === 0 ? 0.12 : -0.12;
    group.add(bladeA);
    propellers.push(bladeA);

    const bladeB = new THREE.Mesh(new THREE.BoxGeometry(1.02, 0.02, 0.09), propMaterial);
    bladeB.position.set(spec.x, 0.245, spec.z);
    bladeB.rotation.y = Math.PI / 2 + (index % 2 === 0 ? 0.12 : -0.12);
    group.add(bladeB);
    propellers.push(bladeB);

    const light = new THREE.Mesh(
      new THREE.SphereGeometry(0.08, 10, 8),
      new THREE.MeshBasicMaterial({ color: index % 2 === 0 ? 0x7dd3fc : 0xfda4af })
    );
    light.position.set(spec.x, 0.02, spec.z);
    group.add(light);
  });

  const cameraPod = new THREE.Mesh(
    new THREE.SphereGeometry(0.17, 10, 8),
    new THREE.MeshStandardMaterial({ color: 0x0f1720, roughness: 0.42, metalness: 0.18 })
  );
  cameraPod.position.set(0, -0.46, 0.3);
  cameraPod.scale.set(1.14, 0.82, 0.98);
  group.add(cameraPod);

  const rearLights = [
    { x: -0.22, color: 0xfda4af },
    { x: 0.22, color: 0x7dd3fc },
  ];
  rearLights.forEach((lightSpec) => {
    const rearLight = new THREE.Mesh(
      new THREE.SphereGeometry(0.07, 8, 6),
      new THREE.MeshBasicMaterial({ color: lightSpec.color })
    );
    rearLight.position.set(lightSpec.x, -0.1, -0.56);
    group.add(rearLight);
  });

  const baseScale = clamp(particle.radius * 1.8, 7.4, 14.8);
  group.scale.setScalar(baseScale);
  return { group, propellers };
};

const createMountain = (radius: number, height: number, color: number) => {
  const group = new THREE.Group();

  const geo = new (THREE as any).DodecahedronGeometry(radius, 1);
  const material = new THREE.MeshStandardMaterial({
    color,
    roughness: 0.85,
    metalness: 0.05,
    flatShading: true,
    emissive: new THREE.Color(color).multiplyScalar(0.03),
  });

  const mountain = new THREE.Mesh(geo, material);
  mountain.scale.set(1.4, height * 1.0, 1.4);
  mountain.position.y = 0;
  mountain.castShadow = true;
  mountain.receiveShadow = true;
  group.add(mountain);

  const snowGeo = new (THREE as any).DodecahedronGeometry(radius * 0.3, 0);
  const snowMat = new THREE.MeshStandardMaterial({
    color: 0xf0f4f8,
    roughness: 0.7,
    metalness: 0,
    flatShading: true,
  });

  const snow = new THREE.Mesh(snowGeo, snowMat);
  snow.scale.set(0.7, height * 0.5, 0.7);
  snow.position.set(0, radius * 0.8, 0);
  snow.castShadow = true;
  group.add(snow);

  return group;
};

const createCloud = (x: number, y: number, z: number, scale: number) => {
  const group = new THREE.Group();
  const cloudMat = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.4,
  });

  const parts = [
    { x: 0, y: 0, z: 0, s: 1 },
    { x: 20, y: 3, z: -10, s: 0.7 },
    { x: -15, y: -2, z: 8, s: 0.6 },
    { x: 10, y: -5, z: 15, s: 0.5 },
    { x: -8, y: 5, z: -12, s: 0.6 },
  ];

  parts.forEach((part) => {
    const cloudPart = new THREE.Mesh(new THREE.SphereGeometry(30 * part.s, 8, 8), cloudMat);
    cloudPart.position.set(part.x, part.y, part.z);
    cloudPart.scale.set(1, 0.3, 0.6);
    group.add(cloudPart);
  });

  group.position.set(x, y, z);
  group.scale.setScalar(scale);
  return group;
};

const createProceduralTree = () => {
  const tree = new THREE.Group();

  const trunk = new THREE.Mesh(
    new THREE.BoxGeometry(2.4, 12, 2.4),
    new THREE.MeshStandardMaterial({ color: 0x6a4a2f, roughness: 1, metalness: 0 })
  );
  trunk.position.y = 6;
  trunk.castShadow = true;
  trunk.receiveShadow = true;
  tree.add(trunk);

  const foliageMaterials = [0x2d5f2d, 0x2f6b2f, 0x3a7a35].map(
    (color) => new THREE.MeshStandardMaterial({ color, roughness: 1, metalness: 0, flatShading: true })
  );

  const foliageParts = [
    { y: 13, s: 1.2, material: foliageMaterials[0] },
    { y: 17, s: 1.0, material: foliageMaterials[1] },
    { y: 20.5, s: 0.75, material: foliageMaterials[2] },
  ];

  foliageParts.forEach((part) => {
    const leaves = new THREE.Mesh(new THREE.SphereGeometry(5.5 * part.s, 10, 8), part.material);
    leaves.position.y = part.y;
    leaves.scale.set(1.2, 0.85, 1.2);
    leaves.castShadow = true;
    leaves.receiveShadow = true;
    tree.add(leaves);
  });

  return tree;
};

const createDemoFleet = (count: number, worldSize: number): ParticleSnapshot[] =>
  Array.from({ length: count }, (_, index) => {
    const angle = (index / count) * Math.PI * 2;
    const ringRadius = 110 + (index % 4) * 18;
    const worldX = worldSize / 2 + Math.cos(angle) * ringRadius;
    const worldY = worldSize / 2 + Math.sin(angle) * ringRadius;

    return {
      id: index,
      x: worldX,
      y: worldY,
      vx: 0,
      vy: 0,
      radius: 7 + (index % 3) * 0.7,
    };
  });

const buildBoundaryLine = (boundary: { x: number; y: number; w: number; h: number }, worldSize: number) => {
  const { x, y, w, h } = boundary;
  const halfWorld = worldSize / 2;
  const corners = [
    new THREE.Vector3(x - halfWorld, 1.5, y - halfWorld),
    new THREE.Vector3(x + w - halfWorld, 1.5, y - halfWorld),
    new THREE.Vector3(x + w - halfWorld, 1.5, y + h - halfWorld),
    new THREE.Vector3(x - halfWorld, 1.5, y + h - halfWorld),
    new THREE.Vector3(x - halfWorld, 1.5, y - halfWorld),
  ];

  const geometry = new THREE.BufferGeometry().setFromPoints(corners);
  const material = new THREE.LineBasicMaterial({
    color: 0x8ee9ff,
    transparent: true,
    opacity: 0.14,
  });
  
  return new THREE.Line(geometry, material);
};

const countNodes = (root: TreeSnapshot | null): number => {
  if (!root) return 0;
  return 1 + (root.children ?? []).reduce((accumulator, child) => accumulator + countNodes(child), 0);
};

const ProSimulation: React.FC = () => {
  const [worldSize, setWorldSize] = useState<number>(720);
  const hostRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const mountedRef = useRef(false);
  const dronesRef = useRef<Map<number, THREE.Object3D>>(new Map());
  const droneVisualsRef = useRef<Record<number, DroneVisual>>({});
  const swarmRef = useRef<ParticleSnapshot[]>(createDemoFleet(12, worldSize));
  const sceneStartRef = useRef<Record<number, THREE.Vector3>>({});
  const sceneTargetRef = useRef<Record<number, THREE.Vector3>>({});
  const droneBaseScaleRef = useRef<Record<number, number>>({});
  const transitionRef = useRef<DroneSceneState | null>(null);
  const quadtreeGroupRef = useRef<THREE.Group | null>(null);
  const droneAnchorsRef = useRef<Record<number, { x: number; y: number; z: number }>>({});
  const simulationFrameRef = useRef<number | null>(null);
  const runningRef = useRef(false);
  const stepInProgressRef = useRef(false);
  const previousTimestampRef = useRef<number | null>(null);
  const lastSimulationFrameTimesRef = useRef<number[]>([]);
  const lastSyncRef = useRef<Date | null>(null);
  const fpsRef = useRef({ frames: 0, lastTick: performance.now(), fps: 0 });

  const [isLive, setIsLive] = useState(false);
  const [visibleDroneCount, setVisibleDroneCount] = useState<number>(12);
  const [drones, setDrones] = useState<ParticleSnapshot[]>(() => swarmRef.current);
  const [tree, setTree] = useState<TreeSnapshot | null>(null);
  const [showGrid, setShowGrid] = useState(true);
  const [showQuadtree, setShowQuadtree] = useState(false);
  const [stats, setStats] = useState<ProStats>({
    drones: 0,
    quadtreeNodes: 0,
    frame: 0,
    comparisons: 0,
    avoided: 0,
    rebuildMs: 0,
    fps: 0,
    bruteForceComparisons: 0,
    treeNodes: 0,
    treeParticles: 0,
    lastSyncLabel: "--",
  });
  const [error, setError] = useState<string | null>(null);
  const showGridRef = useRef(showGrid);
  const showQuadtreeRef = useRef(showQuadtree);
  const fetchSnapshotRef = useRef<() => Promise<void>>(async () => {});
  const lastSnapshotRef = useRef<FlatSnapshot | null>(null);

  showGridRef.current = showGrid;
  showQuadtreeRef.current = showQuadtree;

  const resetCamera = () => {
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    if (!camera || !controls) return;

    camera.position.set(0, 90, 260);
    controls.target.set(0, 26, 0);
    controls.update();
  };

  useEffect(() => {
    if (lastSnapshotRef.current) {
      applySnapshot(lastSnapshotRef.current);
    }
  }, [visibleDroneCount]);

  const syncBoundaryOverlay = (boundaries: Array<{ x: number; y: number; w: number; h: number }>) => {
  const group = quadtreeGroupRef.current;
  if (!group) return;

  for (const child of group.children.slice()) {
    disposeObject(child);
    group.remove(child);
  }

  if (!showQuadtreeRef.current) return;

  // 🔥 PASA worldSize AL buildBoundaryLine
  for (const boundary of boundaries) {
    group.add(buildBoundaryLine(boundary, worldSize));
  }
};

  const ensureDroneMeshes = (particles: ParticleSnapshot[]) => {
    const scene = sceneRef.current;
    if (!scene) return;

    const existing = dronesRef.current;
    const incomingIds = new Set(particles.map((particle) => particle.id));

    Array.from(existing.entries()).forEach(([id, mesh]) => {
      if (!incomingIds.has(id)) {
        scene.remove(mesh);
        disposeObject(mesh);
        existing.delete(id);
        delete sceneStartRef.current[id];
        delete sceneTargetRef.current[id];
      }
    });

    for (const particle of particles) {
      if (existing.has(particle.id)) continue;
      const visual = createDroneMesh(particle);
      scene.add(visual.group);
      existing.set(particle.id, visual.group);
      droneVisualsRef.current[particle.id] = visual;
      const scenePoint = mapWorldToScene(particle.x, particle.y, worldSize);
      const height = Math.max(26, particle.radius * 3 + 16);
      visual.group.position.set(scenePoint.x, height, scenePoint.z);
      droneAnchorsRef.current[particle.id] = { x: scenePoint.x, y: height, z: scenePoint.z };
      droneBaseScaleRef.current[particle.id] = clamp(particle.radius * 1.9, 7.2, 14.5);
      sceneStartRef.current[particle.id] = visual.group.position.clone();
      sceneTargetRef.current[particle.id] = visual.group.position.clone();
    }
  };

  const applySnapshot = (snapshot: FlatSnapshot) => {
    lastSnapshotRef.current = snapshot;

    const visibleParticles = snapshot.particles.slice(0, Math.max(0, visibleDroneCount));

    ensureDroneMeshes(visibleParticles);
    syncBoundaryOverlay(snapshot.boundaries);

    const nextTargets: Record<number, THREE.Vector3> = {};
    const nextStarts: Record<number, THREE.Vector3> = {};

    for (const particle of visibleParticles) {
      const mesh = dronesRef.current.get(particle.id);
      if (!mesh) continue;

      const scenePoint = mapWorldToScene(particle.x, particle.y, worldSize);
      const targetHeight = Math.max(26, particle.radius * 3 + 16);
      const target = new THREE.Vector3(scenePoint.x, targetHeight, scenePoint.z);
      const start = mesh.position.clone();

      nextStarts[particle.id] = start;
      nextTargets[particle.id] = target;
      const baseScale = clamp(particle.radius * 1.9, 7.2, 14.5);
      droneBaseScaleRef.current[particle.id] = baseScale;
      droneAnchorsRef.current[particle.id] = { x: scenePoint.x, y: targetHeight, z: scenePoint.z };
      mesh.scale.setScalar(baseScale);
    }

    sceneStartRef.current = nextStarts;
    sceneTargetRef.current = nextTargets;
    transitionRef.current = {
      from: new Map(Object.entries(nextStarts).map(([id, vector]) => [Number(id), vector.clone()])),
      to: new Map(Object.entries(nextTargets).map(([id, vector]) => [Number(id), vector.clone()])),
      startedAt: performance.now(),
      duration: INTERPOLATION_MS,
    };

    lastSyncRef.current = new Date();
    setStats((previous) => ({
      ...previous,
      drones: visibleParticles.length,
      quadtreeNodes: snapshot.boundaries.length,
      lastSyncLabel: lastSyncRef.current ? formatTime(lastSyncRef.current) : "--",
    }));
  };

  const fetchSnapshot = async () => {
    try {
      const tree = (await getTree()) as TreeSnapshot;
      const flat = flattenTree(tree);
      applySnapshot(flat);
      setError(null);
      setStats((previous) => ({
        ...previous,
        quadtreeNodes: countNodes(tree),
      }));
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "Error desconocido";
      setError(message);
    }
  };

  fetchSnapshotRef.current = fetchSnapshot;

  const getSafetyRadius = (particle: ParticleSnapshot) => 26 + (particle.id % 6) * 2;

  const syncSwarmVisuals = (fleet: ParticleSnapshot[]) => {
    ensureDroneMeshes(fleet);

    for (const particle of fleet) {
      const visual = droneVisualsRef.current[particle.id];
      if (!visual) continue;

      const scenePoint = mapWorldToScene(particle.x, particle.y, worldSize);
      const height = Math.max(26, particle.radius * 3 + 16);
      visual.group.position.set(scenePoint.x, height, scenePoint.z);
      visual.group.rotation.y = Math.atan2(particle.vx, particle.vy);
      visual.group.rotation.x = Math.sin((particle.id + particle.x) / 80) * 0.04;
      visual.group.rotation.z = Math.cos((particle.id + particle.y) / 90) * 0.03;

      const scale = clamp(particle.radius * 1.9, 7.2, 14.5);
      visual.group.scale.setScalar(scale);
      droneAnchorsRef.current[particle.id] = { x: scenePoint.x, y: height, z: scenePoint.z };
      droneBaseScaleRef.current[particle.id] = scale;
    }
  };

  const stopSimulation = () => {
    runningRef.current = false;
    setIsLive(false);
    previousTimestampRef.current = null;
    stepInProgressRef.current = false;
    if (simulationFrameRef.current !== null) {
      cancelAnimationFrame(simulationFrameRef.current);
      simulationFrameRef.current = null;
    }
  };

  const resetFleet = async () => {
    stopSimulation();
    const freshFleet = createDemoFleet(visibleDroneCount, worldSize);
    swarmRef.current = freshFleet;
    setDrones(freshFleet);
    setError(null);
    setStats({
      drones: 0,
      quadtreeNodes: 0,
      frame: 0,
      comparisons: 0,
      avoided: 0,
      rebuildMs: 0,
      fps: 0,
      bruteForceComparisons: 0,
      treeNodes: 0,
      treeParticles: 0,
      lastSyncLabel: "--",
    });

    syncSwarmVisuals(freshFleet);

    try {
      await rebuildSimulationTree(freshFleet);
      const initialTree = (await getTree()) as TreeNodeSnapshot;
      setTree(initialTree);
      syncBoundaryOverlay(flattenTree(initialTree).boundaries);
      setStats((previous) => ({
        ...previous,
        treeNodes: countNodes(initialTree),
        treeParticles: countParticles(initialTree),
        drones: freshFleet.length,
        lastSyncLabel: "Demo",
      }));
    } catch (err) {
      const message = err instanceof Error ? err.message : "Error desconocido";
      setError(message);
    }
  };

  const startSimulation = async () => {
    if (runningRef.current) return;

    if (swarmRef.current.length === 0) {
      swarmRef.current = createDemoFleet(visibleDroneCount, worldSize);
      setDrones(swarmRef.current);
      syncSwarmVisuals(swarmRef.current);
    }

    setError(null);
    runningRef.current = true;
    setIsLive(true);
    previousTimestampRef.current = null;
    lastSimulationFrameTimesRef.current = [];

    const loop = async (timestamp: number) => {
      if (!runningRef.current) return;

      if (previousTimestampRef.current === null) {
        previousTimestampRef.current = timestamp;
      }

      const deltaSeconds = clamp((timestamp - previousTimestampRef.current) / 1000, 0.001, 0.05);
      previousTimestampRef.current = timestamp;

      if (stepInProgressRef.current) {
        simulationFrameRef.current = requestAnimationFrame(loop);
        return;
      }

      stepInProgressRef.current = true;

      try {
        const movedFleet = swarmRef.current.map((drone) => moveDrone(drone, deltaSeconds, worldSize));
        const rebuildStart = performance.now();
        await rebuildSimulationTree(movedFleet);
        const rebuildMs = performance.now() - rebuildStart;

        const [treeSnapshot, queryResults] = await Promise.all([
          getTree() as Promise<TreeNodeSnapshot>,
          Promise.all(movedFleet.map((drone) => queryTree(queryRangeForDrone(drone, worldSize)) as Promise<QueryResult>)),
        ]);

        let totalComparisons = 0;
        let avoided = 0;

        const nextFleet = movedFleet.map((drone, index) => {
          const result = queryResults[index];
          totalComparisons += result.comparisons;

          const neighbors = result.particles.filter((particle) => particle.id !== drone.id);
          let closestNeighbor: SimulationParticle | null = null;
          let closestDistance = Infinity;

          for (const neighbor of neighbors) {
            const distance = Math.hypot(drone.x - neighbor.x, drone.y - neighbor.y);
            if (distance < closestDistance) {
              closestDistance = distance;
              closestNeighbor = neighbor;
            }
          }

          if (closestNeighbor && closestDistance < getSafetyRadius(drone)) {
            avoided += 1;

            const awayX = drone.x - closestNeighbor.x;
            const awayY = drone.y - closestNeighbor.y;
            const awayLength = Math.hypot(awayX, awayY) || 1;
            const normalizedAwayX = awayX / awayLength;
            const normalizedAwayY = awayY / awayLength;
            const currentSpeed = Math.max(18, Math.hypot(drone.vx, drone.vy));
            const steer = 0.22;

            const mixX = (drone.vx / currentSpeed) * (1 - steer) + normalizedAwayX * steer;
            const mixY = (drone.vy / currentSpeed) * (1 - steer) + normalizedAwayY * steer;
            const mixLength = Math.hypot(mixX, mixY) || 1;
            const nextVX = (mixX / mixLength) * currentSpeed;
            const nextVY = (mixY / mixLength) * currentSpeed;

            return {
              ...drone,
              vx: nextVX,
              vy: nextVY,
            };
          }

          return drone;
        });

        swarmRef.current = nextFleet;
        setDrones(nextFleet);
        setTree(treeSnapshot);
        syncSwarmVisuals(nextFleet);
        syncBoundaryOverlay(flattenTree(treeSnapshot).boundaries);

        const frameTimes = [...lastSimulationFrameTimesRef.current, timestamp].slice(-30);
        lastSimulationFrameTimesRef.current = frameTimes;
        const fps =
          frameTimes.length > 1
            ? ((frameTimes.length - 1) * 1000) / (frameTimes[frameTimes.length - 1] - frameTimes[0])
            : 0;

        setStats((previous) => ({
          ...previous,
          frame: previous.frame + 1,
          comparisons: totalComparisons,
          avoided,
          rebuildMs,
          fps: Number.isFinite(fps) ? Number(fps.toFixed(1)) : 0,
          bruteForceComparisons: (nextFleet.length * (nextFleet.length - 1)) / 2,
          treeNodes: countNodes(treeSnapshot),
          treeParticles: countParticles(treeSnapshot),
          drones: nextFleet.length,
          lastSyncLabel: formatTime(new Date()),
        }));
      } catch (err) {
        const message = err instanceof Error ? err.message : "Error desconocido";
        setError(message);
        stopSimulation();
      } finally {
        stepInProgressRef.current = false;
        if (runningRef.current) {
          simulationFrameRef.current = requestAnimationFrame(loop);
        }
      }
    };

    simulationFrameRef.current = requestAnimationFrame(loop);
  };

  useEffect(() => {
    const host = hostRef.current;
    if (!host) {
      return;
    }

    mountedRef.current = true;

    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0xb7dbf2, 360, 2200);
    scene.background = null;
    sceneRef.current = scene;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = (THREE as any).PCFSoftShadowMap;
    renderer.setClearColor(0x87cfff, 1);
    renderer.domElement.className = "pro-simulation-canvas";
    rendererRef.current = renderer;
    host.appendChild(renderer.domElement);

    const camera = new THREE.PerspectiveCamera(48, 1, 0.1, 6000);
    camera.position.set(0, 100, 280);
    cameraRef.current = camera;

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.enablePan = true;
    controls.enableZoom = true;
    controls.minDistance = 90;
    controls.maxDistance = 2200;
    controls.minPolarAngle = 0.22;
    controls.maxPolarAngle = 1.28;
    controls.target.set(0, 26, 0);
    controls.update();
    controlsRef.current = controls;

    const ambient = new THREE.AmbientLight(0xd8f1ff, 1.55);
    scene.add(ambient);

    const hemi = new THREE.HemisphereLight(0xf2fbff, 0x314a34, 1.5);
    scene.add(hemi);

    const sun = new THREE.DirectionalLight(0xfff6d9, 3.0);
    sun.position.set(400, 600, 300);
    sun.castShadow = true;
    sun.shadow.mapSize.width = 2048;
    sun.shadow.mapSize.height = 2048;
    sun.shadow.camera.near = 10;
    sun.shadow.camera.far = 1200;
    sun.shadow.camera.left = -600;
    sun.shadow.camera.right = 600;
    sun.shadow.camera.top = 600;
    sun.shadow.camera.bottom = -600;
    scene.add(sun);

    void addSkyEnvironment(scene, renderer);

    const skyDome = new THREE.Mesh(
      new THREE.SphereGeometry(2200, 16, 12),
      new THREE.MeshBasicMaterial({ color: 0x87cfff, side: (THREE as any).BackSide, transparent: true, opacity: 0.14 })
    );
    scene.add(skyDome);

    const clouds = new THREE.Group();
    scene.add(clouds);

    const demoParticles = createDemoFleet(12, worldSize);
    ensureDroneMeshes(demoParticles);
    setStats((previous) => ({
      ...previous,
      drones: demoParticles.length,
      lastSyncLabel: "Demo",
    }));

    const quadtreeGroup = new THREE.Group();
    quadtreeGroup.visible = showQuadtreeRef.current;
    quadtreeGroupRef.current = quadtreeGroup;
    scene.add(quadtreeGroup);

    const resize = () => {
      const width = host.clientWidth || 1;
      const height = host.clientHeight || 1;
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };

    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(host);

    let lastFrame = performance.now();
    const renderLoop = (now: number) => {
      if (!mountedRef.current) return;

      const delta = now - lastFrame;
      lastFrame = now;
      fpsRef.current.frames += 1;

      const controls = controlsRef.current;
      const camera = cameraRef.current;
      const renderer = rendererRef.current;
      const scene = sceneRef.current;

      if (controls && camera && renderer && scene) {
        controls.update();

        renderer.setClearColor(0x87cfff, 1);

        const transition = transitionRef.current;
        const t = transition ? easeInOut((now - transition.startedAt) / transition.duration) : 1;

        dronesRef.current.forEach((mesh, id) => {
          const anchor = droneAnchorsRef.current[id] ?? {
            x: mesh.position.x,
            y: mesh.position.y,
            z: mesh.position.z,
          };
          const liveSpeed = isLive ? 0.0016 : 0.0002;
          const orbitRadius = isLive ? 20 + (id % 4) * 5 : 4 + (id % 3) * 1.5;
          const bobHeight = isLive ? 3.5 : 1.2;
          const spin = now * liveSpeed + id * 0.7;
          const nextX = anchor.x + Math.cos(spin) * orbitRadius;
          const nextZ = anchor.z + Math.sin(spin * 1.1) * orbitRadius;
          const nextY = anchor.y + Math.sin(spin * 2.2) * bobHeight;

          mesh.position.set(nextX, nextY, nextZ);

          const heading = Math.atan2(Math.cos(spin * 1.1) * orbitRadius, -Math.sin(spin) * orbitRadius);
          mesh.rotation.y = heading;
          mesh.rotation.x = Math.sin((now / 1000) * 4 + id) * 0.04;
          mesh.rotation.z = Math.cos((now / 1000) * 3 + id) * 0.03;

          const pulse = 1 + Math.sin(now / 180 + id) * 0.02;
          const baseScale = droneBaseScaleRef.current[id] ?? 10;
          mesh.scale.setScalar(baseScale * pulse);
        });

        if (transition && t >= 1) {
          transitionRef.current = null;
        }

        quadtreeGroup.visible = showQuadtreeRef.current;
        renderer.render(scene, camera);
      }

      if (delta > 0) {
        fpsRef.current.fps = Math.round((fpsRef.current.frames * 1000) / (now - fpsRef.current.lastTick));
      }

      if (now - fpsRef.current.lastTick > 1000) {
        fpsRef.current.frames = 0;
        fpsRef.current.lastTick = now;
      }

      animationFrameRef.current = requestAnimationFrame(renderLoop);
    };

    animationFrameRef.current = requestAnimationFrame(renderLoop);

    const stopPolling = () => {};

    const meshMap = dronesRef.current;

    return () => {
      mountedRef.current = false;
      observer.disconnect();
      stopPolling();
      if (animationFrameRef.current !== null) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      controls.dispose();
      renderer.dispose();
      disposeObject(scene);
      if (renderer.domElement.parentElement === host) {
        host.removeChild(renderer.domElement);
      }
      sceneRef.current = null;
      rendererRef.current = null;
      cameraRef.current = null;
      controlsRef.current = null;
      meshMap.clear();
      droneBaseScaleRef.current = {};
      quadtreeGroupRef.current = null;
    };
  }, [isLive]);

return (
    <div className="pro-simulation-page">
      <aside className="pro-simulation-sidebar">
        <div className="simulation-card hero-card">
          <div className="eyebrow">Pro Simulation</div>
          <h2>Visualización 3D del enjambre</h2>
          <p>
            Misma lógica 2D, nueva capa 3D con cámara orbital, cielo, iluminación y drones
            interpolados sobre snapshots del backend.
          </p>
        </div>

        <div className="simulation-card controls-card">
          <div className="section-title">Vista</div>
          
          <label className="count-field">
            <span>Número de drones</span>
            <input
              type="number"
              min={0}
              value={visibleDroneCount}
              onChange={(event) => setVisibleDroneCount(Math.max(0, Math.round(Number(event.target.value || 0))))}
            />
          </label>

          {/* 🔥 INPUT PARA TAMAÑO DEL MUNDO */}
          <label className="count-field" style={{ marginTop: "8px" }}>
            <span>Tamaño del mundo (N x N)</span>
            <input
              type="number"
              min={1}
              value={worldSize}
              onChange={(event) => setWorldSize(Math.max(1, Number(event.target.value || 1)))}
            />
          </label>

          {/* 🔥 BOTONES EN FILA CON FLEX */}
<div style={{ 
  display: "flex", 
  gap: "10px", 
  flexWrap: "wrap", 
  width: "100%", 
  marginTop: "8px",
  justifyContent: "flex-start",
  alignItems: "center"
}}>
  <button 
    className={isLive ? "primary-action" : "secondary-action"} 
    onClick={() => setIsLive((value) => !value)}
    style={{ 
      display: "inline-block",
      visibility: "visible",
      opacity: 1,
      minWidth: "100px",
      padding: "8px 16px"
    }}
  >
    {isLive ? "Detener" : "Iniciar"}
  </button>
  
  <button 
    className="tertiary-action" 
    onClick={resetCamera}
    style={{ 
      display: "inline-block",
      visibility: "visible",
      opacity: 1,
      minWidth: "100px",
      padding: "8px 16px"
    }}
  >
    Reset cámara
  </button>
  
  <button
    className="secondary-action"  // ← AGREGAR ESTO 
    onClick={async () => {
      try {
        await setTreeBoundary(worldSize);
        await fetchSnapshotRef.current();
        if (tree) {
          const flat = flattenTree(tree);
          syncBoundaryOverlay(flat.boundaries);
        }
      } catch (err) {
        console.error("Error al cambiar tamaño:", err);
      }
    }}
    style={{ 
      display: "inline-block",
      visibility: "visible",
      opacity: 1,
      padding: "8px 16px",
      background: "#2d8ac7",
      color: "white",
      border: "none",
      borderRadius: "6px",
      cursor: "pointer",
      fontSize: "14px",
      fontWeight: 600,
      minWidth: "120px"
    }}
  >
    🔄 Aplicar tamaño
  </button>
</div>
        </div>

        <div className="simulation-card options-card">
          <div className="section-title">Capas</div>
          <label className="toggle-item">
            <input type="checkbox" checked={showGrid} onChange={(event) => setShowGrid(event.target.checked)} />
            Mostrar paisaje
          </label>
          <label className="toggle-item">
            <input type="checkbox" checked={showQuadtree} onChange={(event) => setShowQuadtree(event.target.checked)} />
            Mostrar Quadtree
          </label>
        </div>

        <div className="simulation-card stats-card">
          <div className="section-title">Estado</div>
          <div className="stats-grid">
            <div className="stat-box"><span>Drones</span><strong>{stats.drones}</strong></div>
            <div className="stat-box"><span>Nodos</span><strong>{stats.quadtreeNodes}</strong></div>
            <div className="stat-box"><span>Última sync</span><strong>{stats.lastSyncLabel}</strong></div>
            <div className="stat-box"><span>Modo</span><strong>{isLive ? "Live" : "Pausa"}</strong></div>
          </div>
          {/* 🔥 MOSTRAR TAMAÑO ACTUAL */}
          <div className="stats-grid" style={{ marginTop: "8px" }}>
            <div className="stat-box"><span>Tamaño mundo</span><strong>{worldSize}x{worldSize}</strong></div>
          </div>
        </div>

        {error && <div className="simulation-error">⚠️ {error}</div>}
      </aside>

      <section className="pro-simulation-stage">
        <div className="stage-header">
          <div>
            <h3>Campo aéreo</h3>
            <p>Orbitación libre sobre un paisaje natural con montañas, cielo y drones más visibles.</p>
          </div>
          <div className="stage-badge">{SKY_COLOR}</div>
        </div>

        <div className="pro-stage-shell">
          <div className="pro-simulation-sky" />
          <div ref={hostRef} className="pro-simulation-host" />
        </div>
      </section>
    </div>
  );
};
export default ProSimulation;