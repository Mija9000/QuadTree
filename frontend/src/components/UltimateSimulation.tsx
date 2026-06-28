import React, { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls";
import { getTree, queryTree } from "../services/api";
import { rebuildSimulationTree, SimulationParticle } from "../services/simulationApi";
import "../styles/ProSimulation.css";

interface Drone extends SimulationParticle {
  safetyRadius: number;
  color: string;
  status: "safe" | "avoiding" | "alert";
}

interface TreeNodeSnapshot {
  boundary: { x: number; y: number; w: number; h: number };
  particles: SimulationParticle[];
  children: TreeNodeSnapshot[];
}

interface QueryResult {
  range: { x: number; y: number; w: number; h: number };
  comparisons: number;
  count: number;
  particles: SimulationParticle[];
}

interface SimulationStats {
  frame: number;
  comparisons: number;
  avoided: number;
  rebuildMs: number;
  fps: number;
  bruteForceComparisons: number;
  treeNodes: number;
  treeParticles: number;
}

type DroneVisual = {
  group: THREE.Group;
  propellers: THREE.Object3D[];
};

const WORLD_SIZE = 720;
const COLOR_PALETTE = ["#2dd4bf", "#60a5fa", "#f97316", "#f43f5e", "#a78bfa", "#34d399"];

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const randomBetween = (min: number, max: number) => min + Math.random() * (max - min);
const clampDroneCount = (value: number) => Math.max(0, Math.round(Number.isFinite(value) ? value : 0));

const createDrone = (id: number): Drone => {
  const angle = randomBetween(0, Math.PI * 2);
  const speed = randomBetween(36, 62);
  const safetyRadius = randomBetween(26, 38);
  const radius = randomBetween(5, 8);

  return {
    id,
    x: randomBetween(radius + 6, WORLD_SIZE - radius - 6),
    y: randomBetween(radius + 6, WORLD_SIZE - radius - 6),
    vx: Math.cos(angle) * speed,
    vy: Math.sin(angle) * speed,
    radius,
    safetyRadius,
    color: COLOR_PALETTE[id % COLOR_PALETTE.length],
    status: "safe",
  };
};

const createFleet = (count: number) => Array.from({ length: clampDroneCount(count) }, (_, index) => createDrone(index));

const moveDrone = (drone: Drone, deltaSeconds: number): Drone => {
  let x = drone.x + drone.vx * deltaSeconds;
  let y = drone.y + drone.vy * deltaSeconds;
  let vx = drone.vx;
  let vy = drone.vy;

  if (x - drone.radius < 0) {
    x = drone.radius;
    vx = Math.abs(vx);
  } else if (x + drone.radius > WORLD_SIZE) {
    x = WORLD_SIZE - drone.radius;
    vx = -Math.abs(vx);
  }

  if (y - drone.radius < 0) {
    y = drone.radius;
    vy = Math.abs(vy);
  } else if (y + drone.radius > WORLD_SIZE) {
    y = WORLD_SIZE - drone.radius;
    vy = -Math.abs(vy);
  }

  return {
    ...drone,
    x,
    y,
    vx,
    vy,
    status: "safe",
  };
};

const queryRangeForDrone = (drone: Drone) => {
  const padding = drone.safetyRadius;
  const x = clamp(drone.x - padding, 0, WORLD_SIZE);
  const y = clamp(drone.y - padding, 0, WORLD_SIZE);
  const w = clamp(padding * 2, 1, WORLD_SIZE - x);
  const h = clamp(padding * 2, 1, WORLD_SIZE - y);

  return { x, y, w, h };
};

const countNodes = (node: TreeNodeSnapshot | null): number => {
  if (!node) return 0;
  let count = 1;
  for (const child of node.children ?? []) {
    count += countNodes(child);
  }
  return count;
};

const countParticles = (node: TreeNodeSnapshot | null): number => {
  if (!node) return 0;
  let count = node.particles?.length ?? 0;
  for (const child of node.children ?? []) {
    count += countParticles(child);
  }
  return count;
};

const disposeObject = (object: THREE.Object3D) => {
  object.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (mesh.geometry) {
      mesh.geometry.dispose();
    }
    const material = mesh.material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(material)) {
      for (const entry of material) entry.dispose();
    } else if (material) {
      material.dispose();
    }
  });
};

const buildBoundaryLine = (boundary: { x: number; y: number; w: number; h: number }) => {
  const { x, y, w, h } = boundary;
  const corners = [
    new THREE.Vector3(x - WORLD_SIZE / 2, 0.75, y - WORLD_SIZE / 2),
    new THREE.Vector3(x + w - WORLD_SIZE / 2, 0.75, y - WORLD_SIZE / 2),
    new THREE.Vector3(x + w - WORLD_SIZE / 2, 0.75, y + h - WORLD_SIZE / 2),
    new THREE.Vector3(x - WORLD_SIZE / 2, 0.75, y + h - WORLD_SIZE / 2),
    new THREE.Vector3(x - WORLD_SIZE / 2, 0.75, y - WORLD_SIZE / 2),
  ];

  const geometry = new THREE.BufferGeometry().setFromPoints(corners);
  const material = new THREE.LineBasicMaterial({
    color: 0x8ee9ff,
    transparent: true,
    opacity: 0.14,
  });
  return new THREE.Line(geometry, material);
};

const createMavicDroneMesh = (drone: Drone): DroneVisual => {
  const group = new THREE.Group();
  const propellers: THREE.Object3D[] = [];
  const bodyMaterial = new THREE.MeshStandardMaterial({
    color: 0x1f2630,
    roughness: 0.16,
    metalness: 0.76,
    emissive: new THREE.Color(drone.color).multiplyScalar(0.06),
    emissiveIntensity: 0.55,
  });

  const shell = new THREE.Mesh(new THREE.BoxGeometry(1.82, 0.34, 1.08), bodyMaterial);
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

  const cameraPod = new THREE.Mesh(
    new THREE.SphereGeometry(0.17, 10, 8),
    new THREE.MeshStandardMaterial({ color: 0x0f1720, roughness: 0.42, metalness: 0.18 })
  );
  cameraPod.position.set(0, -0.46, 0.3);
  cameraPod.scale.set(1.14, 0.82, 0.98);
  group.add(cameraPod);

  const lens = new THREE.Mesh(new THREE.SphereGeometry(0.06, 10, 8), new THREE.MeshBasicMaterial({ color: 0x69d2ff }));
  lens.position.set(0, -0.46, 0.48);
  group.add(lens);

  const armMaterial = new THREE.MeshStandardMaterial({
    color: 0xb8c3cc,
    roughness: 0.22,
    metalness: 0.8,
  });

  const motorMaterial = new THREE.MeshStandardMaterial({
    color: 0x2a313b,
    roughness: 0.48,
    metalness: 0.5,
  });

  const propMaterial = new THREE.MeshBasicMaterial({
    color: 0xbfe7ff,
    transparent: true,
    opacity: 0.28,
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
      new THREE.SphereGeometry(0.07, 8, 6),
      new THREE.MeshBasicMaterial({ color: index % 2 === 0 ? 0x7dd3fc : 0xfda4af })
    );
    light.position.set(spec.x, 0.02, spec.z);
    group.add(light);
  });

  const rearSkidLeft = new THREE.Mesh(
    new THREE.BoxGeometry(0.12, 0.06, 0.82),
    new THREE.MeshStandardMaterial({ color: 0x4f6170, roughness: 0.36, metalness: 0.32 })
  );
  rearSkidLeft.position.set(-0.46, -0.4, -0.1);
  group.add(rearSkidLeft);

  const rearSkidRight = new THREE.Mesh(
    new THREE.BoxGeometry(0.12, 0.06, 0.82),
    new THREE.MeshStandardMaterial({ color: 0x4f6170, roughness: 0.36, metalness: 0.32 })
  );
  rearSkidRight.position.set(0.46, -0.4, -0.1);
  group.add(rearSkidRight);

  const frontLight = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6), new THREE.MeshBasicMaterial({ color: 0xf8fafc }));
  frontLight.position.set(0, 0.01, 0.62);
  group.add(frontLight);

  const scale = clamp(drone.radius * 1.8, 7.4, 14.8);
  group.scale.setScalar(scale);

  return {
    group,
    propellers,
  };
};

const UltimateSimulation: React.FC = () => {
  const hostRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const renderFrameRef = useRef<number | null>(null);
  const simulationFrameRef = useRef<number | null>(null);
  const mountedRef = useRef(false);
  const runningRef = useRef(false);
  const stepInProgressRef = useRef(false);
  const previousTimestampRef = useRef<number | null>(null);
  const lastSimulationFrameTimesRef = useRef<number[]>([]);
  const dronesRef = useRef<Drone[]>(createFleet(12));
  const droneVisualsRef = useRef<Record<number, DroneVisual>>({});
  const quadtreeGroupRef = useRef<THREE.Group | null>(null);
  const lastSyncRef = useRef<Date | null>(null);

  const [droneCount, setDroneCount] = useState<number>(12);
  const [drones, setDrones] = useState<Drone[]>(() => dronesRef.current);
  const [running, setRunning] = useState(false);
  const [tree, setTree] = useState<TreeNodeSnapshot | null>(null);
  const [showQuadtree, setShowQuadtree] = useState(true);
  const [stats, setStats] = useState<SimulationStats>({
    frame: 0,
    comparisons: 0,
    avoided: 0,
    rebuildMs: 0,
    fps: 0,
    bruteForceComparisons: 0,
    treeNodes: 0,
    treeParticles: 0,
  });
  const [error, setError] = useState<string | null>(null);
  const showQuadtreeRef = useRef(showQuadtree);

  showQuadtreeRef.current = showQuadtree;

  const syncQuadtreeOverlay = (snapshot: TreeNodeSnapshot | null) => {
    const group = quadtreeGroupRef.current;
    if (!group) return;

    for (const child of group.children.slice()) {
      const mesh = child as THREE.Object3D & { geometry?: THREE.BufferGeometry; material?: THREE.Material | THREE.Material[] };
      disposeObject(mesh);
      group.remove(child);
    }

    if (!showQuadtreeRef.current || !snapshot) return;

    const visit = (node: TreeNodeSnapshot) => {
      group.add(buildBoundaryLine(node.boundary));
      for (const child of node.children ?? []) {
        visit(child);
      }
    };

    visit(snapshot);
  };

  const syncDroneVisuals = (fleet: Drone[]) => {
    const scene = sceneRef.current;
    if (!scene) return;

    const incomingIds = new Set(fleet.map((drone) => drone.id));
    for (const [id, visual] of Object.entries(droneVisualsRef.current).map(([key, value]) => [Number(key), value] as const)) {
      if (!incomingIds.has(id)) {
        scene.remove(visual.group);
        disposeObject(visual.group);
        delete droneVisualsRef.current[id];
      }
    }

    fleet.forEach((drone) => {
      let visual = droneVisualsRef.current[drone.id];
      if (!visual) {
        visual = createMavicDroneMesh(drone);
        droneVisualsRef.current[drone.id] = visual;
        scene.add(visual.group);
      }

      const sceneX = drone.x - WORLD_SIZE / 2;
      const sceneZ = drone.y - WORLD_SIZE / 2;
      const height = 20 + drone.radius * 1.9;
      visual.group.position.set(sceneX, height, sceneZ);
      visual.group.rotation.y = Math.atan2(drone.vx, drone.vy);
      visual.group.rotation.x = Math.sin((drone.id + drone.x) / 80) * 0.04;
      visual.group.rotation.z = Math.cos((drone.id + drone.y) / 90) * 0.03;
      visual.group.scale.setScalar(clamp(drone.radius * 1.8, 7.4, 14.8));
      visual.propellers.forEach((propeller) => {
        propeller.visible = true;
      });
    });
  };

  const updateQuadtree = async (fleet: Drone[]) => {
    await rebuildSimulationTree(fleet);
    const snapshot = (await getTree()) as TreeNodeSnapshot;
    lastSyncRef.current = new Date();
    setTree(snapshot);
    syncQuadtreeOverlay(snapshot);
    setStats((previous) => ({
      ...previous,
      treeNodes: countNodes(snapshot),
      treeParticles: countParticles(snapshot),
    }));
    return snapshot;
  };

  const stopSimulation = () => {
    runningRef.current = false;
    setRunning(false);
    previousTimestampRef.current = null;
    stepInProgressRef.current = false;
    if (simulationFrameRef.current !== null) {
      cancelAnimationFrame(simulationFrameRef.current);
      simulationFrameRef.current = null;
    }
  };

  const resetCamera = () => {
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    if (!camera || !controls) return;

    camera.position.set(0, 120, 340);
    controls.target.set(0, 24, 0);
    controls.update();
  };

  const resetFleet = async () => {
    stopSimulation();
    const freshFleet = createFleet(droneCount);
    dronesRef.current = freshFleet;
    setDrones(freshFleet);
    setTree(null);
    setError(null);
    setStats({
      frame: 0,
      comparisons: 0,
      avoided: 0,
      rebuildMs: 0,
      fps: 0,
      bruteForceComparisons: 0,
      treeNodes: 0,
      treeParticles: 0,
    });
    syncDroneVisuals(freshFleet);

    try {
      await updateQuadtree(freshFleet);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Error desconocido";
      setError(message);
    }
  };

  const startSimulation = async () => {
    if (runningRef.current) return;

    if (dronesRef.current.length === 0) {
      const freshFleet = createFleet(droneCount);
      dronesRef.current = freshFleet;
      setDrones(freshFleet);
      syncDroneVisuals(freshFleet);
    }

    setError(null);
    runningRef.current = true;
    setRunning(true);
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
        const movedFleet = dronesRef.current.map((drone) => moveDrone(drone, deltaSeconds));
        const rebuildStart = performance.now();
        await rebuildSimulationTree(movedFleet);
        const rebuildMs = performance.now() - rebuildStart;

        const [treeSnapshot, queryResults] = await Promise.all([
          getTree() as Promise<TreeNodeSnapshot>,
          Promise.all(movedFleet.map((drone) => queryTree(queryRangeForDrone(drone)) as Promise<QueryResult>)),
        ]);

        let totalComparisons = 0;
        let avoided = 0;

        const nextFleet = movedFleet.map((drone, index) => {
          const result = queryResults[index];
          totalComparisons += result.comparisons;

          const neighbors = result.particles.filter((particle: SimulationParticle) => particle.id !== drone.id);
          let closestNeighbor: SimulationParticle | null = null;
          let closestDistance = Infinity;

          for (const neighbor of neighbors) {
            const distance = Math.hypot(drone.x - neighbor.x, drone.y - neighbor.y);
            if (distance < closestDistance) {
              closestDistance = distance;
              closestNeighbor = neighbor;
            }
          }

          if (closestNeighbor && closestDistance < drone.safetyRadius) {
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
              status: "avoiding" as const,
            };
          }

          return {
            ...drone,
            status: closestNeighbor && closestDistance < drone.safetyRadius * 1.2 ? ("alert" as const) : ("safe" as const),
          };
        });

        dronesRef.current = nextFleet;
        setDrones(nextFleet);
        syncDroneVisuals(nextFleet);
        setTree(treeSnapshot);
        syncQuadtreeOverlay(treeSnapshot);

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
    if (!host) return;

    mountedRef.current = true;

    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0x87cfff, 160, 1200);
    scene.background = new THREE.Color(0x87cfff);
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

    const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 6000);
    camera.position.set(0, 120, 340);
    cameraRef.current = camera;

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.enablePan = true;
    controls.enableZoom = true;
    controls.minDistance = 150;
    controls.maxDistance = 1800;
    controls.minPolarAngle = 0.25;
    controls.maxPolarAngle = 1.35;
    controls.target.set(0, 24, 0);
    controls.update();
    controlsRef.current = controls;

    const ambient = new THREE.AmbientLight(0xddeeff, 1.45);
    scene.add(ambient);

    const hemi = new THREE.HemisphereLight(0xffffff, 0x43624f, 1.2);
    scene.add(hemi);

    const sun = new THREE.DirectionalLight(0xfff5d6, 2.8);
    sun.position.set(400, 700, 450);
    sun.castShadow = true;
    sun.shadow.mapSize.width = 2048;
    sun.shadow.mapSize.height = 2048;
    sun.shadow.camera.near = 10;
    sun.shadow.camera.far = 1500;
    sun.shadow.camera.left = -700;
    sun.shadow.camera.right = 700;
    sun.shadow.camera.top = 700;
    sun.shadow.camera.bottom = -700;
    scene.add(sun);

    const skyDome = new THREE.Mesh(
      new THREE.SphereGeometry(2400, 24, 16),
      new THREE.MeshBasicMaterial({ color: 0x87cfff, side: (THREE as any).BackSide, transparent: true, opacity: 0.12 })
    );
    scene.add(skyDome);

    const groundGeometry = new (THREE as any).PlaneGeometry(1600, 1600, 48, 48);
    const groundPositions = groundGeometry.attributes.position.array as Float32Array;
    for (let index = 0; index < groundPositions.length; index += 3) {
      const x = groundPositions[index];
      const y = groundPositions[index + 1];
      groundPositions[index + 2] = Math.sin(x * 0.01) * 2 + Math.cos(y * 0.014) * 1.4;
    }
    groundGeometry.computeVertexNormals();
    const groundMaterial = new THREE.MeshStandardMaterial({ color: 0x2f5b3e, roughness: 1, metalness: 0 });
    const ground = new THREE.Mesh(groundGeometry, groundMaterial);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -8;
    ground.receiveShadow = true;
    scene.add(ground);

    const mountains = new THREE.Group();
    for (let index = 0; index < 14; index += 1) {
      const angle = (index / 14) * Math.PI * 2;
      const radius = 240 + (index % 4) * 28;
      const peak = new THREE.Mesh(
        new THREE.OctahedronGeometry(18 + (index % 4) * 3, 1),
        new THREE.MeshStandardMaterial({
          color: index % 2 === 0 ? 0x486b57 : 0x3e5f4f,
          roughness: 0.92,
          metalness: 0,
          flatShading: true,
        })
      );
      peak.position.set(Math.cos(angle) * radius, 16 + (index % 4) * 4, Math.sin(angle) * radius);
      peak.scale.set(2.5, 2.2 + (index % 4) * 0.18, 2.5);
      peak.castShadow = true;
      peak.receiveShadow = true;
      mountains.add(peak);
    }
    scene.add(mountains);

    const quadtreeGroup = new THREE.Group();
    quadtreeGroup.visible = showQuadtreeRef.current;
    quadtreeGroupRef.current = quadtreeGroup;
    scene.add(quadtreeGroup);

    const initialFleet = createFleet(droneCount);
    dronesRef.current = initialFleet;
    setDrones(initialFleet);
    syncDroneVisuals(initialFleet);
    void updateQuadtree(initialFleet);

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

      const controls = controlsRef.current;
      const camera = cameraRef.current;
      const renderer = rendererRef.current;
      const scene = sceneRef.current;

      if (controls && camera && renderer && scene) {
        controls.update();
        renderer.setClearColor(0x87cfff, 1);

        dronesRef.current.forEach((drone) => {
          const visual = droneVisualsRef.current[drone.id];
          if (!visual) return;

          const sceneX = drone.x - WORLD_SIZE / 2;
          const sceneZ = drone.y - WORLD_SIZE / 2;
          const altitude = 22 + drone.radius * 1.7 + Math.sin((now / 1000) * 1.5 + drone.id) * 0.8;
          visual.group.position.set(sceneX, altitude, sceneZ);
          visual.group.rotation.y = Math.atan2(drone.vx, drone.vy);
          visual.group.rotation.x = Math.sin((now / 1000) * 3 + drone.id) * 0.03;
          visual.group.rotation.z = Math.cos((now / 1000) * 2.5 + drone.id) * 0.02;

          const propSpin = (10 + Math.hypot(drone.vx, drone.vy) * 0.12) * (delta / 1000);
          visual.propellers.forEach((propeller, index) => {
            propeller.rotation.y += index % 2 === 0 ? propSpin : -propSpin;
          });
        });

        quadtreeGroup.visible = showQuadtreeRef.current;
        renderer.render(scene, camera);
      }

      renderFrameRef.current = requestAnimationFrame(renderLoop);
    };

    renderFrameRef.current = requestAnimationFrame(renderLoop);

    return () => {
      mountedRef.current = false;
      observer.disconnect();
      if (renderFrameRef.current !== null) {
        cancelAnimationFrame(renderFrameRef.current);
      }
      if (simulationFrameRef.current !== null) {
        cancelAnimationFrame(simulationFrameRef.current);
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
      quadtreeGroupRef.current = null;
      droneVisualsRef.current = {};
    };
  }, []);

  useEffect(() => {
    if (runningRef.current) return;
    const freshFleet = createFleet(droneCount);
    dronesRef.current = freshFleet;
    setDrones(freshFleet);
    syncDroneVisuals(freshFleet);
  }, [droneCount]);

  useEffect(() => {
    showQuadtreeRef.current = showQuadtree;
    syncQuadtreeOverlay(tree);
  }, [showQuadtree, tree]);

  const renderStageBadge = running ? "Live" : "Pausa";

  return (
    <div className="pro-simulation-page">
      <aside className="pro-simulation-sidebar">
        <div className="simulation-card hero-card">
          <div className="eyebrow">Ultimate Simulation</div>
          <h2>Enjambre 3D tipo Mavic</h2>
          <p>
            Drones 3D con evasión basada en quadtree, el mismo comportamiento de la simulación
            clásica, pero con render Three.js completo.
          </p>
        </div>

        <div className="simulation-card controls-card">
          <div className="section-title">Vista</div>
          <label className="count-field">
            <span>Número de drones</span>
            <input
              type="number"
              min={0}
              value={droneCount}
              onChange={(event) => setDroneCount(Math.max(0, Math.round(Number(event.target.value || 0))))}
            />
          </label>
          <div className="pro-control-row">
            <button className={running ? "primary-action" : "secondary-action"} onClick={() => (running ? stopSimulation() : void startSimulation())}>
              {running ? "Detener" : "Iniciar"}
            </button>
            <button className="secondary-action" onClick={() => void resetFleet()}>
              Reiniciar
            </button>
            <button className="tertiary-action" onClick={resetCamera}>
              Reset cámara
            </button>
          </div>
        </div>

        <div className="simulation-card options-card">
          <div className="section-title">Capas</div>
          <label className="toggle-item">
            <input type="checkbox" checked={showQuadtree} onChange={(event) => setShowQuadtree(event.target.checked)} />
            Mostrar Quadtree
          </label>
        </div>

        <div className="simulation-card stats-card">
          <div className="section-title">Estado</div>
          <div className="stats-grid">
            <div className="stat-box"><span>Drones</span><strong>{drones.length}</strong></div>
            <div className="stat-box"><span>Nodos</span><strong>{stats.treeNodes}</strong></div>
            <div className="stat-box"><span>Última sync</span><strong>{lastSyncRef.current ? lastSyncRef.current.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "Demo"}</strong></div>
            <div className="stat-box"><span>Modo</span><strong>{renderStageBadge}</strong></div>
          </div>
          <div className="stats-grid" style={{ marginTop: 12 }}>
            <div className="stat-box"><span>Compar.</span><strong>{stats.comparisons}</strong></div>
            <div className="stat-box"><span>Evasiones</span><strong>{stats.avoided}</strong></div>
            <div className="stat-box"><span>Rebuild ms</span><strong>{stats.rebuildMs.toFixed(1)}</strong></div>
            <div className="stat-box"><span>FPS</span><strong>{stats.fps}</strong></div>
          </div>
        </div>

        {error && <div className="simulation-error">⚠️ {error}</div>}
      </aside>

      <section className="pro-simulation-stage">
        <div className="stage-header">
          <div>
            <h3>Ultimate 3D</h3>
            <p>Drones tipo Mavic, terreno montañoso y quadtree interactivo con la dinámica de evasión clásica.</p>
          </div>
          <div className="stage-badge">3D</div>
        </div>

        <div className="pro-stage-shell">
          <div className="pro-simulation-sky" />
          <div ref={hostRef} className="pro-simulation-host" />
        </div>
      </section>
    </div>
  );
};

export default UltimateSimulation;
