import React, { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader";
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

const configureDroneModel = (object: THREE.Object3D) => {
  object.traverse((child) => {
    const mesh = child as THREE.Mesh;
    mesh.castShadow = true;
    mesh.receiveShadow = true;

    const material = mesh.material as unknown as THREE.MeshStandardMaterial | THREE.MeshStandardMaterial[] | undefined;
    if (Array.isArray(material)) {
      for (const entry of material) {
        (entry as any).roughness = 0.3;
        (entry as any).metalness = 0.7;
        (entry as any).needsUpdate = true;
      }
    } else if (material) {
      (material as any).roughness = 0.3;
      (material as any).metalness = 0.7;
      (material as any).needsUpdate = true;
    }
  });
};

const fitDroneModel = (object: THREE.Object3D) => {
  const box = new (THREE as any).Box3().setFromObject(object);
  if (box.isEmpty()) {
    return { size: 1 };
  }

  const center = new THREE.Vector3();
  const size = new THREE.Vector3();
  box.getCenter(center);
  box.getSize(size);

  object.position.x -= center.x;
  object.position.y -= center.y;
  object.position.z -= center.z;
  configureDroneModel(object);

  return { size: Math.max(size.x, size.y, size.z) || 1 };
};

const cloneDroneModel = (model: THREE.Group) => {
  const clone = (model as any).clone(true) as THREE.Group;
  configureDroneModel(clone);
  return clone;
};

const createCanvasTexture = (
  draw: (context: CanvasRenderingContext2D, size: number) => void,
  size = 1024,
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
  (texture as any).anisotropy = 8;
  return texture;
};

const createSkyGradientTexture = () =>
  createCanvasTexture((context, size) => {
    const gradient = context.createLinearGradient(0, 0, 0, size);
    gradient.addColorStop(0, "#dff4ff");
    gradient.addColorStop(0.45, "#9fd4ef");
    gradient.addColorStop(0.8, "#8abfe2");
    gradient.addColorStop(1, "#d8e8ef");
    context.fillStyle = gradient;
    context.fillRect(0, 0, size, size);

    for (let index = 0; index < 180; index += 1) {
      const x = Math.random() * size;
      const y = Math.random() * size * 0.5;
      const radius = 26 + Math.random() * 70;
      const alpha = 0.08 + Math.random() * 0.12;
      const cloud = context.createRadialGradient(x, y, radius * 0.1, x, y, radius);
      cloud.addColorStop(0, `rgba(255,255,255,${alpha})`);
      cloud.addColorStop(1, "rgba(255,255,255,0)");
      context.fillStyle = cloud;
      context.beginPath();
      context.arc(x, y, radius, 0, Math.PI * 2);
      context.fill();
    }
  }, 1024, 1);

const createGroundHeightGeometry = () => {
  const groundSize = 2200;
  const segments = 160;
  const geometry = new (THREE as any).PlaneGeometry(groundSize, groundSize, segments, segments);
  const positions = geometry.attributes.position.array as Float32Array;

  for (let index = 0; index < positions.length; index += 3) {
    const x = positions[index];
    const y = positions[index + 1];
    const ridgeA = Math.sin(x * 0.0028) * Math.cos(y * 0.0024) * 32;
    const ridgeB = Math.sin(x * 0.009 + y * 0.005) * 10;
    const ridgeC = Math.cos(x * 0.016) * Math.sin(y * 0.012) * 5;
    positions[index + 2] = ridgeA + ridgeB + ridgeC;
  }

  geometry.computeVertexNormals();

  const colors = new Float32Array(positions.length);
  for (let index = 0; index < positions.length; index += 3) {
    const height = positions[index + 2];
    const blend = clamp((height + 38) / 76, 0, 1);
    colors[index] = 0.09 + blend * 0.07;
    colors[index + 1] = 0.2 + blend * 0.26;
    colors[index + 2] = 0.08 + blend * 0.06;
  }

  geometry.setAttribute("color", new (THREE as any).BufferAttribute(colors, 3));
  return geometry;
};

const createTerrain = () => {
  const geometry = createGroundHeightGeometry();
  const grassTexture = createCanvasTexture((context, size) => {
    context.fillStyle = "#3a6134";
    context.fillRect(0, 0, size, size);

    for (let index = 0; index < 12000; index += 1) {
      const x = Math.random() * size;
      const y = Math.random() * size;
      const r = 1 + Math.random() * 2.5;
      const green = 75 + Math.random() * 80;
      context.fillStyle = `rgba(${30 + Math.random() * 20}, ${green}, ${20 + Math.random() * 15}, 0.16)`;
      context.beginPath();
      context.arc(x, y, r, 0, Math.PI * 2);
      context.fill();
    }
  }, 1024, 18);

  const rockTexture = createCanvasTexture((context, size) => {
    context.fillStyle = "#74797f";
    context.fillRect(0, 0, size, size);
    for (let index = 0; index < 8000; index += 1) {
      const x = Math.random() * size;
      const y = Math.random() * size;
      const shade = 105 + Math.random() * 60;
      const alpha = 0.06 + Math.random() * 0.08;
      context.fillStyle = `rgba(${shade}, ${shade}, ${shade}, ${alpha})`;
      context.fillRect(x, y, 2 + Math.random() * 5, 1 + Math.random() * 3);
    }
  }, 1024, 6);

  const terrainMaterial = new THREE.MeshStandardMaterial({
    color: 0x557d4c,
    map: grassTexture ?? undefined,
    roughness: 1,
    metalness: 0,
    vertexColors: true,
  });

  const terrain = new THREE.Mesh(geometry, terrainMaterial);
  terrain.rotation.x = -Math.PI / 2;
  terrain.position.y = -26;
  terrain.receiveShadow = true;

  const rockBand = new THREE.Mesh(
    geometry.clone(),
    new THREE.MeshStandardMaterial({
      color: 0x67736a,
      map: rockTexture ?? undefined,
      roughness: 1,
      metalness: 0,
      vertexColors: true,
      transparent: true,
      opacity: 0.22,
    })
  );
  rockBand.rotation.x = -Math.PI / 2;
  rockBand.position.y = -14;
  rockBand.receiveShadow = true;

  const group = new THREE.Group();
  group.add(terrain);
  group.add(rockBand);
  return group;
};

const createMountain = (radius: number, height: number, color: number) => {
  const group = new THREE.Group();
  const geo = new (THREE as any).DodecahedronGeometry(radius, 1);
  const material = new THREE.MeshStandardMaterial({
    color,
    roughness: 0.9,
    metalness: 0.02,
    flatShading: true,
    emissive: new THREE.Color(color).multiplyScalar(0.03),
  });

  const mountain = new THREE.Mesh(geo, material);
  mountain.scale.set(1.5, height, 1.5);
  mountain.position.y = 0;
  mountain.castShadow = true;
  mountain.receiveShadow = true;
  group.add(mountain);

  const snowGeo = new (THREE as any).DodecahedronGeometry(radius * 0.3, 0);
  const snowMat = new THREE.MeshStandardMaterial({
    color: 0xf3f8fb,
    roughness: 0.7,
    metalness: 0,
    flatShading: true,
  });
  const snow = new THREE.Mesh(snowGeo, snowMat);
  snow.scale.set(0.72, height * 0.48, 0.72);
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
    opacity: 0.34,
  });

  const parts = [
    { x: 0, y: 0, z: 0, s: 1 },
    { x: 22, y: 4, z: -12, s: 0.72 },
    { x: -16, y: -2, z: 8, s: 0.6 },
    { x: 10, y: -6, z: 16, s: 0.54 },
    { x: -10, y: 6, z: -14, s: 0.6 },
  ];

  parts.forEach((part) => {
    const cloudPart = new THREE.Mesh(new THREE.SphereGeometry(30 * part.s, 8, 8), cloudMat);
    cloudPart.position.set(part.x, part.y, part.z);
    cloudPart.scale.set(1, 0.32, 0.62);
    group.add(cloudPart);
  });

  group.position.set(x, y, z);
  group.scale.setScalar(scale);
  return group;
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
  const droneModelRef = useRef<THREE.Group | null>(null);
  const quadtreeGroupRef = useRef<THREE.Group | null>(null);
  const lastSyncRef = useRef<Date | null>(null);

  const [droneCount, setDroneCount] = useState<number>(12);
  const [drones, setDrones] = useState<Drone[]>(() => dronesRef.current);
  const [running, setRunning] = useState(false);
  const [tree, setTree] = useState<TreeNodeSnapshot | null>(null);
  const [droneModel, setDroneModel] = useState<THREE.Group | null>(null);
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

  useEffect(() => {
    const loader = new GLTFLoader() as any;
    let cancelled = false;

    console.log("Intentando cargar modelo Spark desde /models/spark.glb...");

    loader.load(
      "/models/spark.glb",
      (gltf: any) => {
        if (cancelled) {
          return;
        }

        console.log("Modelo cargado exitosamente!", gltf);

        const model = gltf.scene as THREE.Group;
        model.visible = true;
        model.position.set(0, 30, 0);
        (model.rotation as any).x = 0;
        (model.rotation as any).y = 0;
        (model.rotation as any).z = 0;
        model.scale.set(34, 34, 34);

        model.traverse((child) => {
          const mesh = child as any;
          if (mesh && (mesh.type === "Mesh" || mesh.isMesh)) {
            mesh.castShadow = true;
            mesh.receiveShadow = true;
            mesh.frustumCulled = false;
            mesh.name = mesh.name || "spark-part";

            const material = mesh.material;
            if (Array.isArray(material)) {
              material.forEach((entry: any) => {
                if (entry) {
                  entry.roughness = 0.3;
                  entry.metalness = 0.7;
                  entry.needsUpdate = true;
                }
              });
            } else if (material) {
              (material as any).roughness = 0.3;
              (material as any).metalness = 0.7;
              (material as any).needsUpdate = true;
            }
          }
        });

        const scene = sceneRef.current;
        if (scene) {
          scene.add(model);
          console.log("Modelo agregado a la escena para prueba en (0, 30, 0)");
        }

        const fit = fitDroneModel(model);
        (model as any).userData.baseSize = fit.size;
        console.log("Posición del modelo:", model.position);
        console.log("Escala del modelo:", model.scale);
        console.log("Base size del modelo:", fit.size);
        droneModelRef.current = model;
        setDroneModel(model);
      },
      (event: any) => {
        if (event?.loaded !== undefined && event?.total) {
          const percent = ((event.loaded / event.total) * 100).toFixed(1);
          console.log(`Cargando: ${percent}%`);
        }
      },
      (error: any) => {
        if (!cancelled) {
          console.error("Error cargando modelo", error);
          setError(error instanceof Error ? error.message : "No se pudo cargar /models/spark.glb");
        }
      }
    );

    return () => {
      cancelled = true;
    };
  }, []);

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
    const model = droneModelRef.current;
    if (!scene || !model) return;

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
        const clone = cloneDroneModel(model);
        visual = { group: clone };
        droneVisualsRef.current[drone.id] = visual;
        scene.add(clone);
      }

      const sceneX = drone.x - WORLD_SIZE / 2;
      const sceneZ = drone.y - WORLD_SIZE / 2;
        const scale = 34;
        const height = 30;
      visual.group.position.set(sceneX, height, sceneZ);
      visual.group.rotation.y = Math.atan2(drone.vx, drone.vy);
      visual.group.rotation.x = Math.sin((drone.id + drone.x) / 80) * 0.04;
      visual.group.rotation.z = Math.cos((drone.id + drone.y) / 90) * 0.03;
      visual.group.scale.setScalar(scale);
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

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: "high-performance" as any });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    (renderer as any).toneMapping = (THREE as any).ACESFilmicToneMapping;
    (renderer as any).toneMappingExposure = 1.2;
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

    scene.background = new THREE.Color(0x9ed6ef);
    scene.fog = new THREE.Fog(0xc8e3ef, 380, 4200);

    const landscapeGroup = new THREE.Group();
    scene.add(landscapeGroup);

    const landscapeLoader = new GLTFLoader();
    const fitAndPlaceLandscape = async (
      url: string,
      targetSize: number,
      position: { x: number; y: number; z: number },
      rotation: { x: number; y: number; z: number }
    ) => {
      try {
        const gltf = await landscapeLoader.loadAsync(url);
        const model = gltf.scene as THREE.Group;
        const box = new (THREE as any).Box3().setFromObject(model);
        const size = new THREE.Vector3();
        const center = new THREE.Vector3();
        box.getSize(size);
        box.getCenter(center);

        model.position.x -= center.x;
        model.position.y -= center.y;
        model.position.z -= center.z;
        configureDroneModel(model);

        const longestSide = Math.max(size.x, size.y, size.z) || 1;
        const scale = targetSize / longestSide;
        model.scale.setScalar(scale);
        model.position.set(position.x, position.y, position.z);
        (model.rotation as any).x = rotation.x;
        (model.rotation as any).y = rotation.y;
        (model.rotation as any).z = rotation.z;
        landscapeGroup.add(model);

        return model;
      } catch (error) {
        console.error(`Error cargando paisaje ${url}`, error);
        return null;
      }
    };

    const placeSky = async () => {
      const sky = await fitAndPlaceLandscape("/models/sky.glb", 18000, { x: 0, y: -360, z: 0 }, { x: 0, y: 0, z: 0 });
      if (!sky) return;

      sky.scale.set(sky.scale.x * 1.8, sky.scale.y * 1.8, sky.scale.z * 1.8);
      sky.position.y = -520;
    };

    void placeSky();

    const placeField = async () => {
      console.log("Loading field.glb...");
      const field = await fitAndPlaceLandscape("/models/field.glb", 2000, { x: 0, y: -30, z: 0 }, { x: 0, y: 0, z: 0 });
      if (!field) {
        console.error("Could not load field.glb");
        return;
      }

      const maxAnisotropy = (renderer as any).capabilities?.getMaxAnisotropy?.() ?? 16;
      field.traverse((child) => {
        const mesh = child as any;
        if (!mesh || !(mesh.type === "Mesh" || mesh.isMesh)) {
          return;
        }

        mesh.castShadow = true;
        mesh.receiveShadow = true;

        const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        materials.forEach((material: any) => {
          if (!material) return;
          material.transparent = false;
          material.opacity = 1;
          material.roughness = 0.8;
          material.metalness = 0;

          const textureSlots = [
            material.map,
            material.normalMap,
            material.roughnessMap,
            material.metalnessMap,
            material.aoMap,
            material.emissiveMap,
            material.bumpMap,
            material.displacementMap,
          ];

          textureSlots.forEach((texture: any) => {
            if (!texture) return;
            texture.anisotropy = maxAnisotropy;
            texture.minFilter = (THREE as any).LinearMipmapLinearFilter;
            texture.magFilter = (THREE as any).LinearFilter;
            texture.generateMipmaps = true;
            texture.needsUpdate = true;

            console.log("Texture configured:", texture.image?.width, "x", texture.image?.height);
          });

          material.needsUpdate = true;
        });
      });

      field.rotation.x = 0;
      field.rotation.y = 0;
      field.rotation.z = 0;
      field.position.y = -300;

      console.log("Field loaded correctly");
      console.log("Position:", field.position);
      console.log("Scale:", field.scale);
      console.log("Rotation:", field.rotation);
    };

    void placeField();

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
          const scale = 34;
          const altitude = 30 + Math.sin((now / 1000) * 1.5 + drone.id) * 0.8;
          visual.group.position.set(sceneX, altitude, sceneZ);
          visual.group.rotation.y = Math.atan2(drone.vx, drone.vy);
          visual.group.rotation.x = Math.sin((now / 1000) * 3 + drone.id) * 0.03;
          visual.group.rotation.z = Math.cos((now / 1000) * 2.5 + drone.id) * 0.02;

          const propSpin = (10 + Math.hypot(drone.vx, drone.vy) * 0.12) * (delta / 1000);
          visual.group.traverse((child) => {
            const name = String((child as any).name ?? "").toLowerCase();
            if (name.startsWith("prop") || name.startsWith("blade") || name.startsWith("rotor")) {
              child.rotation.z += propSpin;
            }
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
    if (!droneModel) {
      return;
    }

    syncDroneVisuals(dronesRef.current);
  }, [droneModel]);

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
