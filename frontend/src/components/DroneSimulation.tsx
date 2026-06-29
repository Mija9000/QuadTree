import React, { useEffect, useRef, useState } from "react";
import { getTree, queryTree, setTreeBoundary } from "../services/api";
import { rebuildSimulationTree, SimulationParticle } from "../services/simulationApi";
import "../styles/DroneSimulation.css";


interface Drone extends SimulationParticle {
  safetyRadius: number;
  color: string;
  status: "safe" | "avoiding" | "alert";
  trail: Array<{ x: number; y: number }>;
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

const WORLD_SIZE = 720;
const TRAIL_LIMIT = 24;
const COLOR_PALETTE = ["#2dd4bf", "#60a5fa", "#f97316", "#f43f5e", "#a78bfa", "#34d399"];

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const randomBetween = (min: number, max: number) => min + Math.random() * (max - min);

const clampDroneCount = (value: number) => Math.max(0, Math.round(Number.isFinite(value) ? value : 0));

const createDrone = (id: number, worldSize: number): Drone => {
  const angle = randomBetween(0, Math.PI * 2);
  const speed = randomBetween(36, 62);
  const safetyRadius = randomBetween(26, 38);
  const radius = randomBetween(5, 8);

  return {
    id,
    x: randomBetween(radius + 6, worldSize - radius - 6),
    y: randomBetween(radius + 6, worldSize - radius - 6),
    vx: Math.cos(angle) * speed,
    vy: Math.sin(angle) * speed,
    radius,
    safetyRadius,
    color: COLOR_PALETTE[id % COLOR_PALETTE.length],
    status: "safe",
    trail: [],
  };
};

const createFleet = (count: number, worldSize: number) =>
  Array.from({ length: clampDroneCount(count) }, (_, index) => createDrone(index, worldSize));

const appendTrail = (trail: Array<{ x: number; y: number }>, point: { x: number; y: number }) =>
  [...trail, point].slice(-TRAIL_LIMIT);

const moveDrone = (drone: Drone, deltaSeconds: number, worldSize: number): Drone => {
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

  return {
    ...drone,
    x,
    y,
    vx,
    vy,
    status: "safe",
    trail: appendTrail(drone.trail, { x, y }),
  };
};

const queryRangeForDrone = (drone: Drone, worldSize: number) => {
  const padding = drone.safetyRadius;
  const x = clamp(drone.x - padding, 0, worldSize);
  const y = clamp(drone.y - padding, 0, worldSize);
  const w = clamp(padding * 2, 1, worldSize - x);
  const h = clamp(padding * 2, 1, worldSize - y);

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

const DroneSimulation: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const canvasWrapRef = useRef<HTMLDivElement>(null);
  const animationFrameRef = useRef<number | null>(null);
  const runningRef = useRef(false);
  const previousTimestampRef = useRef<number | null>(null);
  const lastFrameTimesRef = useRef<number[]>([]);
  const stepInProgressRef = useRef(false);

  const [droneCount, setDroneCount] = useState<number>(12);
  const [worldSize, setWorldSize] = useState<number>(720);
  const dronesRef = useRef<Drone[]>(createFleet(12, worldSize));
  const [drones, setDrones] = useState<Drone[]>(() => dronesRef.current);
  const [running, setRunning] = useState(false);
  const [tree, setTree] = useState<TreeNodeSnapshot | null>(null);
  const [showQuadtree, setShowQuadtree] = useState(true);
  const [showSafetyRings, setShowSafetyRings] = useState(true);
  const [showTrails, setShowTrails] = useState(true);
  const [canvasSize, setCanvasSize] = useState({ width: 900, height: 620 });
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

  useEffect(() => {
    const updateSize = () => {
      if (!canvasWrapRef.current) return;
      const availableWidth = Math.max(640, canvasWrapRef.current.clientWidth);
      const availableHeight = Math.max(640, window.innerHeight - 180);
      const side = Math.max(640, Math.min(availableWidth, availableHeight, 980));
      setCanvasSize({ width: side, height: side });
    };

    updateSize();
    window.addEventListener("resize", updateSize);
    return () => window.removeEventListener("resize", updateSize);
  }, []);

  useEffect(() => {
    dronesRef.current = drones;
  }, [drones]);

  const stopSimulation = () => {
    runningRef.current = false;
    setRunning(false);
    previousTimestampRef.current = null;
    if (animationFrameRef.current !== null) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
  };

  const resetSimulation = async () => {
    stopSimulation();
    const freshFleet = createFleet(droneCount, worldSize);
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

    try {
      await rebuildSimulationTree(freshFleet);
      const initialTree = (await getTree()) as TreeNodeSnapshot;
      setTree(initialTree);
      setStats((previous) => ({
        ...previous,
        treeNodes: countNodes(initialTree),
        treeParticles: countParticles(initialTree),
      }));
    } catch (err) {
      const message = err instanceof Error ? err.message : "Error desconocido";
      setError(message);
    }
  };

  const handleApplyBoundary = async () => {
  try {
    console.log("📡 Enviando setTreeBoundary con size:", worldSize);
    
    // 🔥 1. CAMBIAR EL BOUNDARY EN EL BACKEND
    const response = await setTreeBoundary(worldSize);
    console.log("✅ Respuesta del backend:", response);
    
    // 🔥 2. DETENER SIMULACIÓN
    stopSimulation();
    
    // 🔥 3. CREAR NUEVA FLOTA
    const freshFleet = createFleet(droneCount, worldSize);
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

    // 🔥 4. RECONSTRUIR EL ÁRBOL CON EL NUEVO BOUNDARY
    await rebuildSimulationTree(freshFleet);
    const initialTree = (await getTree()) as TreeNodeSnapshot;
    console.log("🌳 Árbol recibido - boundary:", initialTree.boundary);
    console.log("🌳 Árbol recibido - particles:", initialTree.particles?.length);
    
    setTree(initialTree);
    setStats((previous) => ({
      ...previous,
      treeNodes: countNodes(initialTree),
      treeParticles: countParticles(initialTree),
    }));
    
    console.log(`✅ Mundo redimensionado a ${worldSize}x${worldSize}`);
    
  } catch (err) {
    console.error("Error al cambiar tamaño:", err);
  }
};

  const startSimulation = async () => {
    if (runningRef.current) return;

    if (dronesRef.current.length === 0) {
      const freshFleet = createFleet(droneCount, worldSize);
      dronesRef.current = freshFleet;
      setDrones(freshFleet);
    }

    setError(null);
    runningRef.current = true;
    setRunning(true);
    previousTimestampRef.current = null;
    lastFrameTimesRef.current = [];

    const loop = async (timestamp: number) => {
      if (!runningRef.current) return;

      if (previousTimestampRef.current === null) {
        previousTimestampRef.current = timestamp;
      }

      const deltaSeconds = clamp((timestamp - previousTimestampRef.current) / 1000, 0.001, 0.05);
      previousTimestampRef.current = timestamp;

      if (stepInProgressRef.current) {
        animationFrameRef.current = requestAnimationFrame(loop);
        return;
      }

      stepInProgressRef.current = true;
      try {
        const movedFleet = dronesRef.current.map((drone) => moveDrone(drone, deltaSeconds, worldSize));
        const rebuildStart = performance.now();
        await rebuildSimulationTree(movedFleet.map(({ trail, status, color, safetyRadius, ...particle }) => particle));
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
        setTree(treeSnapshot);

        const frameTimes = [...lastFrameTimesRef.current, timestamp].slice(-30);
        lastFrameTimesRef.current = frameTimes;
        const fps = frameTimes.length > 1
          ? (frameTimes.length - 1) * 1000 / (frameTimes[frameTimes.length - 1] - frameTimes[0])
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
          animationFrameRef.current = requestAnimationFrame(loop);
        }
      }
    };

    animationFrameRef.current = requestAnimationFrame(loop);
  };

  useEffect(() => () => stopSimulation(), []);

  useEffect(() => {
    console.log("Dibujando canvas con worldSize:", worldSize);
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const devicePixelRatio = window.devicePixelRatio || 1;
    canvas.width = Math.round(canvasSize.width * devicePixelRatio);
    canvas.height = Math.round(canvasSize.height * devicePixelRatio);
    canvas.style.width = `${canvasSize.width}px`;
    canvas.style.height = `${canvasSize.height}px`;

    ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
    ctx.clearRect(0, 0, canvasSize.width, canvasSize.height);

    // 🔥 EL TAMAÑO VISUAL ES EL worldSize PERO ESCALADO PARA QUE QUEPA
    const visualWorldSize = worldSize;
    const renderScale = Math.min(
      (canvasSize.width - 40) / visualWorldSize,
      (canvasSize.height - 40) / visualWorldSize
    );
    const renderOffsetX = (canvasSize.width - visualWorldSize * renderScale) / 2;
    const renderOffsetY = (canvasSize.height - visualWorldSize * renderScale) / 2;

    const background = ctx.createLinearGradient(0, 0, 0, canvasSize.height);
    background.addColorStop(0, "#08111f");
    background.addColorStop(1, "#111827");
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, canvasSize.width, canvasSize.height);

    ctx.save();
    ctx.translate(renderOffsetX, renderOffsetY);
    ctx.scale(renderScale, renderScale);

    // 🔥 AHORA LAS COORDENADAS VAN DE 0 A worldSize (SIN NORMALIZAR)
    // 🔥 GRID CON DENSIDAD VISUAL FIJA
    const numberOfLines = 18; // ← NÚMERO DE LÍNEAS DESEADO
    const gridStep = worldSize / numberOfLines;

    ctx.strokeStyle = "rgba(148, 163, 184, 0.12)";
    ctx.lineWidth = 1 / renderScale;
    for (let offset = 0; offset <= worldSize; offset += gridStep) {
      ctx.beginPath();
      ctx.moveTo(offset, 0);
      ctx.lineTo(offset, worldSize);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, offset);
      ctx.lineTo(worldSize, offset);
      ctx.stroke();
    }

    const drawNode = (node: TreeNodeSnapshot) => {
      if (showQuadtree) {
        ctx.strokeStyle = "rgba(96, 165, 250, 0.45)";
        ctx.lineWidth = 1.2;
        ctx.strokeRect(node.boundary.x, node.boundary.y, node.boundary.w, node.boundary.h);
      }

      for (const child of node.children ?? []) {
        drawNode(child);
      }
    };

    if (tree && showQuadtree) {
      drawNode(tree);
    }

    if (showTrails) {
      for (const drone of drones) {
        if (drone.trail.length < 2) continue;
        ctx.beginPath();
        ctx.strokeStyle = `${drone.color}55`;
        ctx.lineWidth = 2;
        drone.trail.forEach((point, index) => {
          if (index === 0) {
            ctx.moveTo(point.x, point.y);
          } else {
            ctx.lineTo(point.x, point.y);
          }
        });
        ctx.stroke();
      }
    }

    for (const drone of drones) {
      if (showSafetyRings) {
        ctx.beginPath();
        ctx.strokeStyle = drone.status === "avoiding" ? "rgba(251, 191, 36, 0.55)" : "rgba(248, 113, 113, 0.35)";
        ctx.lineWidth = 1.2 / renderScale;
        ctx.arc(drone.x, drone.y, drone.safetyRadius, 0, Math.PI * 2);
        ctx.stroke();
      }

      ctx.beginPath();
      ctx.fillStyle = drone.status === "avoiding" ? "#facc15" : drone.status === "alert" ? "#fb7185" : drone.color;
      ctx.arc(drone.x, drone.y, drone.radius, 0, Math.PI * 2);
      ctx.fill();

      ctx.beginPath();
      ctx.strokeStyle = "rgba(15, 23, 42, 0.9)";
      ctx.lineWidth = 1.5 / renderScale;
      ctx.arc(drone.x, drone.y, drone.radius, 0, Math.PI * 2);
      ctx.stroke();

      ctx.fillStyle = "rgba(226, 232, 240, 0.9)";
      ctx.font = `${11 / renderScale}px monospace`;
      ctx.fillText(`#${drone.id}`, drone.x + 10, drone.y - 10);
    }
    ctx.restore();
}, [canvasSize, drones, showQuadtree, showSafetyRings, showTrails, tree, worldSize]);

  const simulationState = running ? "En ejecución" : "Detenida";
  const handleDroneCountChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const nextCount = clampDroneCount(Number(event.target.value || 0));
    setDroneCount(nextCount);
  };

  return (
    <div className="simulation-page">
      <aside className="simulation-sidebar">
        <div className="simulation-card hero-card">
          <div className="eyebrow">Simulación de drones</div>
          <h2>Prevención de colisiones con Quadtree</h2>
          <p>
            Drones activos, reconstrucción por frame, consultas espaciales y maniobras de evasión
            en tiempo real.
          </p>
        </div>

        <div className="simulation-card controls-card">
          <div className="section-title">Control</div>
          
          <label className="count-field">
            <span>Cantidad de drones</span>
            <input
              type="number"
              min={0}
              value={droneCount}
              onChange={handleDroneCountChange}
              style={{maxWidth:"327px"}}
            />
          </label>
          
          {/* 🔥 NUEVO: INPUT PARA TAMAÑO DEL MUNDO */}
          <label className="count-field" style={{ marginTop: "8px" }}>
            <span>Tamaño del mundo (N x N)</span>
            <input
              type="number"
              min={1}
              value={worldSize}
              onChange={(event) => setWorldSize(Math.max(1, Number(event.target.value || 1)))}
              style={{ maxWidth: "327px" }}
            />
          </label>
          
          {/* 🔥 NUEVO: BOTÓN PARA APLICAR TAMAÑO */}
          <button 
            className="primary-action" 
            onClick={handleApplyBoundary}
            style={{ marginTop: "8px", marginBottom: "16px", width: "100%", padding:"12px" }}
          >
            🔄 Redimensionar mundo
          </button>
          
          <div className="control-row">
            <button className="primary-action" onClick={startSimulation} disabled={running}>
              Iniciar
            </button>
            <button className="secondary-action" onClick={stopSimulation} disabled={!running}>
              Detener
            </button>
            <button className="tertiary-action" onClick={resetSimulation}>
              Reiniciar
            </button>
          </div>
        </div>

        <div className="simulation-card options-card">
          <div className="section-title">Opciones</div>
          <label className="toggle-item">
            <input type="checkbox" checked={showQuadtree} onChange={(event) => setShowQuadtree(event.target.checked)} />
            Mostrar Quadtree
          </label>
          <label className="toggle-item">
            <input type="checkbox" checked={showSafetyRings} onChange={(event) => setShowSafetyRings(event.target.checked)} />
            Mostrar radio de seguridad
          </label>
          <label className="toggle-item">
            <input type="checkbox" checked={showTrails} onChange={(event) => setShowTrails(event.target.checked)} />
            Mostrar trayectorias
          </label>
        </div>

        <div className="simulation-card stats-card">
          <div className="section-title">Estadísticas</div>
          <div className="stats-grid">
            <div className="stat-box"><span>Drones</span><strong>{drones.length}</strong></div>
            <div className="stat-box"><span>Nodos</span><strong>{stats.treeNodes}</strong></div>
            <div className="stat-box"><span>Partículas árbol</span><strong>{stats.treeParticles}</strong></div>
            <div className="stat-box"><span>Comparaciones</span><strong>{stats.comparisons}</strong></div>
            <div className="stat-box"><span>Evitadas</span><strong>{stats.avoided}</strong></div>
            <div className="stat-box"><span>Rebuild</span><strong>{stats.rebuildMs.toFixed(1)} ms</strong></div>
            <div className="stat-box"><span>FPS</span><strong>{stats.fps || "--"}</strong></div>
            <div className="stat-box"><span>Brute force</span><strong>{stats.bruteForceComparisons}</strong></div>
            <div className="stat-box"><span>Estado</span><strong>{simulationState}</strong></div>
          </div>
        </div>

        {error && <div className="simulation-error">⚠️ {error}</div>}
      </aside>

      <section className="simulation-stage">
        <div className="stage-header">
          <div>
            <h3>Área aérea</h3>
            <p>El Quadtree se reconstruye en cada frame y responde consultas por dron.</p>
          </div>
          <div className="stage-badge">{simulationState}</div>
        </div>

        <div className="canvas-shell" ref={canvasWrapRef}>
          <canvas ref={canvasRef} className="simulation-canvas" />
        </div>
      </section>
    </div>
  );
};

export default DroneSimulation;