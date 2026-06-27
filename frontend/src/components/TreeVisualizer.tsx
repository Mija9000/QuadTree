import React, { useEffect, useRef, useState } from "react";
import {
  bulkInsertParticles,
  clearTree,
  getTree,
  insertParticle,
  queryTree,
} from "../services/api";
import SvgPanZoom from "svg-pan-zoom";
import "../styles/TreeVisualizer.css";

interface Particle {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
}

interface Node {
  boundary: { x: number; y: number; w: number; h: number };
  particles: Particle[];
  children: Node[];
}

interface QueryRange {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface QueryResult {
  range: QueryRange;
  comparisons: number;
  count: number;
  particles: Particle[];
}

interface NodePosition {
  node: Node;
  x: number;
  y: number;
  depth: number;
}

const TreeVisualizer: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const canvasShellRef = useRef<HTMLDivElement>(null);
  const panZoomRef = useRef<ReturnType<typeof SvgPanZoom> | null>(null);
  const dragStateRef = useRef<{
    startX: number;
    startY: number;
    offsetX: number;
    offsetY: number;
  } | null>(null);
  const [tree, setTree] = useState<Node | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [queryRange, setQueryRange] = useState<QueryRange>({ x: 100, y: 100, w: 120, h: 120 });
  const [queryResult, setQueryResult] = useState<QueryResult | null>(null);
  const [isCanvasExpanded, setIsCanvasExpanded] = useState(false);
  const [isCanvasFullscreen, setIsCanvasFullscreen] = useState(false);
  const [canvasSize, setCanvasSize] = useState({ width: 560, height: 560 });
  const [isDragging, setIsDragging] = useState(false);

  const WORLD_SIZE = 400;
  const MIN_SCALE = 0.5;
  const MAX_SCALE = 20;
  const createCenteredCanvasView = (width: number, height: number, scale = 1.15) => ({
    scale,
    offsetX: (width - WORLD_SIZE * scale) / 2,
    offsetY: (height - WORLD_SIZE * scale) / 2,
  });
  const [canvasView, setCanvasView] = useState(createCenteredCanvasView(WORLD_SIZE, WORLD_SIZE));

  const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
  const isCanvasLarge = isCanvasExpanded || isCanvasFullscreen;

  const refreshTree = async () => {
    const data = await getTree();
    if (data) {
      setTree(data);
    }
  };

  useEffect(() => {
    const fetchTree = async () => {
      try {
        setLoading(true);
        setError(null);
        await refreshTree();
      } catch (err) {
        const message = err instanceof Error ? err.message : "Error desconocido";
        setError(message);
        console.error("Error al cargar árbol:", err);
      } finally {
        setLoading(false);
      }
    };
    fetchTree();
  }, []);

  useEffect(() => {
    const updateCanvasSize = () => {
      if (typeof window === "undefined") {
        return;
      }

      if (isCanvasLarge) {
        setCanvasSize({
          width: Math.max(window.innerWidth - 48, 640),
          height: Math.max(window.innerHeight - 160, 520),
        });
      } else {
        setCanvasSize({ width: 560, height: 620 });
      }
    };

    updateCanvasSize();
    window.addEventListener("resize", updateCanvasSize);
    return () => window.removeEventListener("resize", updateCanvasSize);
  }, [isCanvasLarge]);

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsCanvasFullscreen(Boolean(document.fullscreenElement));
    };

    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", handleFullscreenChange);
  }, []);

  useEffect(() => {
    if (!svgRef.current) return;

    if (panZoomRef.current) {
      try {
        panZoomRef.current.destroy();
        panZoomRef.current = null;
      } catch (e) {
        console.error("Error destroying previous pan-zoom:", e);
      }
    }

    const timer = setTimeout(() => {
      if (!svgRef.current) return;

      try {
        panZoomRef.current = SvgPanZoom(svgRef.current, {
          zoomEnabled: true,
          controlIconsEnabled: false,
          fit: true,
          center: true,
          minZoom: 0.5,
          maxZoom: 5,
          beforeZoom: () => true,
          onZoom: () => {},
          beforePan: () => true,
          onPan: () => {},
          dblClickZoomEnabled: true,
          mouseWheelZoomEnabled: true,
          preventMouseEventsDefault: true,
        });
      } catch (e) {
        console.error("Error initializing svg-pan-zoom:", e);
      }
    }, 50);

    return () => {
      clearTimeout(timer);
      if (panZoomRef.current) {
        try {
          panZoomRef.current.destroy();
          panZoomRef.current = null;
        } catch (e) {
          console.error("Error in cleanup:", e);
        }
      }
    };
  }, [tree]);

  useEffect(() => {
    if (!tree) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const devicePixelRatio = window.devicePixelRatio || 1;
    canvas.width = Math.round(canvasSize.width * devicePixelRatio);
    canvas.height = Math.round(canvasSize.height * devicePixelRatio);
    canvas.style.width = `${canvasSize.width}px`;
    canvas.style.height = `${canvasSize.height}px`;

    try {
      ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = "#f6f8fb";
      ctx.fillRect(0, 0, canvasSize.width, canvasSize.height);

      ctx.save();
      ctx.translate(canvasView.offsetX, canvasView.offsetY);
      ctx.scale(canvasView.scale, canvasView.scale);

      ctx.strokeStyle = "#dde6f1";
      ctx.lineWidth = 1;
      for (let i = 0; i <= WORLD_SIZE; i += 50) {
        ctx.beginPath();
        ctx.moveTo(i, 0);
        ctx.lineTo(i, WORLD_SIZE);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(0, i);
        ctx.lineTo(WORLD_SIZE, i);
        ctx.stroke();
      }

      let totalParticles = 0;
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      const highlightedIds = new Set(queryResult?.particles.map((particle) => particle.id) ?? []);

      const drawNode = (node: Node, depth = 0) => {
        if (!node || !node.boundary) return;

        const { x, y, w, h } = node.boundary;
        if (typeof x !== "number" || typeof y !== "number" || typeof w !== "number" || typeof h !== "number") {
          return;
        }

        const colors = ["#263238", "#2d8ac7", "#d64541", "#b9770e"];
        ctx.strokeStyle = colors[Math.min(depth, 3)];
        ctx.lineWidth = depth === 0 ? 2.5 : 1.1;
        ctx.strokeRect(x, y, w, h);

        if (Array.isArray(node.particles) && node.particles.length > 0) {
          totalParticles += node.particles.length;
          for (let i = 0; i < node.particles.length; i++) {
            const p = node.particles[i];
            if (typeof p.x === "number" && typeof p.y === "number") {
              minX = Math.min(minX, p.x);
              maxX = Math.max(maxX, p.x);
              minY = Math.min(minY, p.y);
              maxY = Math.max(maxY, p.y);

              const isQueryHit = highlightedIds.has(p.id);
              ctx.fillStyle = isQueryHit ? "#2ecc71" : "#e74c3c";
              ctx.beginPath();
              ctx.arc(p.x, p.y, isQueryHit ? 5.5 : 4.5, 0, 2 * Math.PI);
              ctx.fill();
              ctx.strokeStyle = isQueryHit ? "#145a32" : "#000";
              ctx.lineWidth = 1.5;
              ctx.stroke();

              ctx.fillStyle = "rgba(0,0,0,0.55)";
              ctx.font = `${Math.max(8, 8 / canvasView.scale)}px monospace`;
              ctx.fillText(`${p.x.toFixed(0)},${p.y.toFixed(0)}`, p.x + 7, p.y - 5);
            }
          }
        }

        if (Array.isArray(node.children)) {
          for (const child of node.children) {
            drawNode(child, depth + 1);
          }
        }
      };

      if (queryResult) {
        const { x, y, w, h } = queryResult.range;
        ctx.save();
        ctx.fillStyle = "rgba(52, 152, 219, 0.12)";
        ctx.strokeStyle = "rgba(52, 152, 219, 0.9)";
        ctx.lineWidth = 2;
        ctx.fillRect(x, y, w, h);
        ctx.strokeRect(x, y, w, h);
        ctx.restore();
      }

      drawNode(tree);

      ctx.fillStyle = "#111";
      ctx.font = "bold 12px monospace";
      ctx.fillText(`Total Partículas: ${totalParticles}`, 5, 20);
      if (queryResult) {
        ctx.fillText(`Consulta: ${queryResult.count} / ${queryResult.comparisons} nodos`, 5, 36);
      }

      if (minX !== Infinity) {
        ctx.font = "10px monospace";
        ctx.fillText(`X: ${minX.toFixed(0)}-${maxX.toFixed(0)}`, 5, WORLD_SIZE - 10);
        ctx.fillText(`Y: ${minY.toFixed(0)}-${maxY.toFixed(0)}`, 5, WORLD_SIZE - 2);
      }

      ctx.restore();
    } catch (err) {
      console.error("Error al dibujar árbol:", err);
    }
  }, [tree, queryResult, canvasSize, canvasView]);

  useEffect(() => {
    setCanvasView((previous) => ({
      scale: previous.scale,
      offsetX: (canvasSize.width - WORLD_SIZE * previous.scale) / 2,
      offsetY: (canvasSize.height - WORLD_SIZE * previous.scale) / 2,
    }));
  }, [canvasSize.width, canvasSize.height]);

  const handleInsert = async () => {
    const p = { x: Math.random() * 400, y: Math.random() * 400 };
    try {
      setLoading(true);
      setError(null);
      console.log("Insertando partícula:", p);
      await insertParticle(p);
      await refreshTree();
      setQueryResult(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Error desconocido";
      console.error("Error al insertar:", err);
      setError(`Error al insertar: ${message}`);
    } finally {
      setTimeout(() => setLoading(false), 150);
    }
  };

  const handleBulkInsert = async (count: number) => {
    try {
      setLoading(true);
      setError(null);
      await bulkInsertParticles(count);
      await refreshTree();
      setQueryResult(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Error desconocido";
      console.error("Error en inserción masiva:", err);
      setError(`Error al insertar ${count}: ${message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleClear = async () => {
    try {
      setLoading(true);
      setError(null);
      await clearTree();
      await refreshTree();
      setQueryResult(null);
      setCanvasView(createCenteredCanvasView(canvasSize.width, canvasSize.height));
    } catch (err) {
      const message = err instanceof Error ? err.message : "Error desconocido";
      console.error("Error al limpiar:", err);
      setError(`Error al limpiar: ${message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleQuery = async (range: QueryRange) => {
    try {
      setLoading(true);
      setError(null);
      const response = await queryTree(range);
      setQueryRange(range);
      setQueryResult(response as QueryResult);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Error desconocido";
      console.error("Error al consultar:", err);
      setError(`Error al consultar: ${message}`);
    } finally {
      setLoading(false);
    }
  };

  const resetCanvasView = () => setCanvasView(createCenteredCanvasView(canvasSize.width, canvasSize.height));

  const zoomCanvas = (nextScale: number, anchorX?: number, anchorY?: number) => {
    setCanvasView((previous) => {
      const clampedScale = clamp(nextScale, MIN_SCALE, MAX_SCALE);
      if (typeof anchorX !== "number" || typeof anchorY !== "number") {
        return { ...previous, scale: clampedScale };
      }

      const worldX = (anchorX - previous.offsetX) / previous.scale;
      const worldY = (anchorY - previous.offsetY) / previous.scale;
      return {
        scale: clampedScale,
        offsetX: anchorX - worldX * clampedScale,
        offsetY: anchorY - worldY * clampedScale,
      };
    });
  };

  const toggleCanvasExpanded = () => {
    setIsCanvasExpanded((previous) => !previous);
  };

  const toggleCanvasFullscreen = async () => {
    const shell = canvasShellRef.current;

    if (!shell) return;

    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else if (shell.requestFullscreen) {
        await shell.requestFullscreen();
      } else {
        setIsCanvasExpanded(true);
      }
    } catch (err) {
      console.error("Error al cambiar pantalla completa:", err);
      setError("No se pudo activar pantalla completa");
    }
  };

  const handleCanvasWheel = (event: React.WheelEvent<HTMLCanvasElement>) => {
    event.preventDefault();
  };

  const handleCanvasMouseDown = (event: React.MouseEvent<HTMLCanvasElement>) => {
    event.preventDefault();
    dragStateRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      offsetX: canvasView.offsetX,
      offsetY: canvasView.offsetY,
    };
    setIsDragging(true);
  };

  const handleCanvasMouseMove = (event: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDragging || !dragStateRef.current) {
      return;
    }

    const deltaX = event.clientX - dragStateRef.current.startX;
    const deltaY = event.clientY - dragStateRef.current.startY;

    setCanvasView((previous) => ({
      ...previous,
      offsetX: dragStateRef.current ? dragStateRef.current.offsetX + deltaX : previous.offsetX,
      offsetY: dragStateRef.current ? dragStateRef.current.offsetY + deltaY : previous.offsetY,
    }));
  };

  const endCanvasDrag = () => {
    dragStateRef.current = null;
    setIsDragging(false);
  };

  // Contar nodos totales
  const countNodes = (node: Node | null): number => {
    if (!node) return 0;
    let count = 1;
    if (Array.isArray(node.children)) {
      for (const child of node.children) {
        count += countNodes(child);
      }
    }
    return count;
  };

  // Contar partículas totales
  const countParticles = (node: Node | null): number => {
    if (!node) return 0;
    let count = Array.isArray(node.particles) ? node.particles.length : 0;
    if (Array.isArray(node.children)) {
      for (const child of node.children) {
        count += countParticles(child);
      }
    }
    return count;
  };

  // Calcular posiciones para el árbol SVG
  const calculateNodePositions = (node: Node | null, x: number, y: number, depth: number, spacing: number): NodePosition[] => {
    if (!node) return [];
    const positions: NodePosition[] = [{node, x, y, depth}];
    const children = Array.isArray(node.children) ? node.children : [];
    const childSpacing = spacing / Math.pow(1.42, depth + 1);
    
    children.forEach((child, i) => {
      const offsetX = (i - 1.5) * childSpacing;
      const childX = x + offsetX;
      const childY = y + 112;
      positions.push(...calculateNodePositions(child, childX, childY, depth + 1, spacing));
    });
    return positions;
  };

  // Renderizar árbol como SVG
  const renderSVGTree = (node: Node | null): React.ReactNode => {
    if (!node) return null;
    const rawPositions = calculateNodePositions(node, 0, 24, 0, 1400);
    const minX = Math.min(...rawPositions.map((position) => position.x));
    const maxX = Math.max(...rawPositions.map((position) => position.x));
    const svgWidth = Math.max(1600, maxX - minX + 240);
    const offsetX = (svgWidth - (maxX - minX)) / 2 - minX;
    const positions = rawPositions.map((position) => ({ ...position, x: position.x + offsetX }));
    const maxDepth = Math.max(...positions.map(p => p.depth));
    const svgHeight = Math.max(520, 96 + maxDepth * 108 + 56);
    const positionByNode = new Map<Node, NodePosition>(positions.map((position) => [position.node, position]));
    
    // Clave única basada en la estructura del árbol
    // Cambia cuando se subdivide o se agregan partículas
    const treeKey = `tree-${countNodes(node)}-${countParticles(node)}`;

    return (
      <div className="svg-container">
        <svg 
          key={treeKey}
          ref={svgRef}
          width={svgWidth} 
          height={svgHeight} 
          className="tree-svg"
          viewBox={`0 0 ${svgWidth} ${svgHeight}`}
          style={{ border: "1px solid #ddd", background: "#fafafa" }}
        >
          {/* Líneas de conexión */}
        {positions.map((pos, idx) => {
          const children = Array.isArray(pos.node.children) ? pos.node.children : [];
          if (children.length === 0) return null;

          return children.map((child, childIdx) => {
            const childPos = positionByNode.get(child);
            if (!childPos) return null;
            return (
              <line
                key={`line-${idx}-${childIdx}`}
                x1={pos.x}
                y1={pos.y + 40}
                x2={childPos.x}
                y2={childPos.y}
                stroke="#3498db"
                strokeWidth="2.2"
              />
            );
          });
        })}
        
        {/* Nodos */}
        {positions.map((pos, idx) => {
          const particleCount = Array.isArray(pos.node.particles) ? pos.node.particles.length : 0;
          const slotSize = 16;
          const slotGap = 2;
          const totalWidth = 4 * slotSize + 3 * slotGap;
          const nodeX = pos.x - totalWidth / 2;

          return (
            <g key={`node-${idx}`}>
              {/* Fondo nodo */}
              <rect
                x={nodeX - 5}
                y={pos.y}
                width={totalWidth + 10}
                height={slotSize + 12}
                fill="#eef4fb"
                stroke="#3498db"
                strokeWidth="1.5"
                rx="4"
              />
              
              {/* 4 Slots para partículas */}
              {[0, 1, 2, 3].map((slotIdx) => (
                <rect
                  key={`slot-${idx}-${slotIdx}`}
                  x={nodeX + slotIdx * (slotSize + slotGap)}
                  y={pos.y + 5}
                  width={slotSize}
                  height={slotSize}
                  fill={slotIdx < particleCount ? "#e74c3c" : "#ecf0f1"}
                  stroke={slotIdx < particleCount ? "#c0392b" : "#95a5a6"}
                  strokeWidth="1"
                  rx="2"
                />
              ))}
              
              {/* Coordenadas */}
              <text
                x={pos.x}
                y={pos.y + slotSize + 34}
                textAnchor="middle"
                fontSize="9"
                fill="#2c3e50"
                fontFamily="monospace"
              >
                ({pos.node.boundary.x.toFixed(0)}, {pos.node.boundary.y.toFixed(0)})
              </text>
            </g>
          );
        })}
      </svg>
      </div>
    );
  };

  return (
    <div className="tree-visualizer-container">
      <div className="main-panels">
        <div className="left-panel">
          <div className="header">
            <div className="stats stats-compact">
              <div className="stat stat-compact">
                <span className="stat-label">Nodos</span>
                <span className="stat-value">{countNodes(tree)}</span>
              </div>
              <div className="stat stat-compact">
                <span className="stat-label">Partículas</span>
                <span className="stat-value">{countParticles(tree)}</span>
              </div>
            </div>
          </div>

          <div ref={canvasShellRef} className={`canvas-shell ${isCanvasLarge ? "canvas-shell-expanded" : ""}`}>
            <canvas
              ref={canvasRef}
              width={canvasSize.width}
              height={canvasSize.height}
              className={`canvas-quad ${isDragging ? "is-dragging" : ""}`}
            ></canvas>
          </div>

          <div className="control-section action-section action-section-left">
            <div className="section-title">Acciones</div>
            <div className="controls action-controls">
              <button onClick={handleInsert} className="insert-button" disabled={loading}>
                {loading ? "⏳ Insertando..." : "➕ Insertar Partícula"}
              </button>
              <button onClick={handleClear} className="insert-button danger-button" disabled={loading}>
                Limpiar
              </button>
            </div>
          </div>
        </div>

        <div className="right-panel">
          <div className="tree-structure">
            {tree ? renderSVGTree(tree) : <p className="empty-tree">Cargando...</p>}
          </div>
          <div className="bottom-actions bottom-actions-tree">
            <div className="bottom-actions-inner">
              <div className="control-section query-section">
                <div className="section-title">Consultas rápidas</div>
                <div className="controls preset-controls">
                  <button onClick={() => handleQuery({ x: 0, y: 0, w: 400, h: 400 })} className="insert-button secondary-button" disabled={loading}>
                    Todo
                  </button>
                  <button onClick={() => handleQuery({ x: 0, y: 0, w: 200, h: 200 })} className="insert-button secondary-button" disabled={loading}>
                    Superior izq.
                  </button>
                  <button onClick={() => handleQuery({ x: 200, y: 0, w: 200, h: 200 })} className="insert-button secondary-button" disabled={loading}>
                    Superior der.
                  </button>
                  <button onClick={() => handleQuery({ x: 0, y: 200, w: 200, h: 200 })} className="insert-button secondary-button" disabled={loading}>
                    Inferior izq.
                  </button>
                  <button onClick={() => handleQuery({ x: 200, y: 200, w: 200, h: 200 })} className="insert-button secondary-button" disabled={loading}>
                    Inferior der.
                  </button>
                </div>
              </div>

              <div className="query-panel query-panel-wide">
                <h3>Consultas</h3>
                <div className="query-grid">
                  <label>
                    X
                    <input
                      type="number"
                      value={queryRange.x}
                      onChange={(event) => setQueryRange((previous) => ({ ...previous, x: Number(event.target.value) }))}
                    />
                  </label>
                  <label>
                    Y
                    <input
                      type="number"
                      value={queryRange.y}
                      onChange={(event) => setQueryRange((previous) => ({ ...previous, y: Number(event.target.value) }))}
                    />
                  </label>
                  <label>
                    W
                    <input
                      type="number"
                      value={queryRange.w}
                      onChange={(event) => setQueryRange((previous) => ({ ...previous, w: Number(event.target.value) }))}
                    />
                  </label>
                  <label>
                    H
                    <input
                      type="number"
                      value={queryRange.h}
                      onChange={(event) => setQueryRange((previous) => ({ ...previous, h: Number(event.target.value) }))}
                    />
                  </label>
                </div>

                <div className="controls query-actions">
                  <button onClick={() => handleQuery(queryRange)} className="insert-button secondary-button" disabled={loading}>
                    Consultar rango
                  </button>
                </div>

                {queryResult && (
                  <div className="query-result-box">
                    <div>Encontradas: {queryResult.count}</div>
                    <div>Comparaciones: {queryResult.comparisons}</div>
                    <div className="query-result-list">
                      {queryResult.particles.slice(0, 12).map((particle) => (
                        <span key={particle.id}>#{particle.id} ({particle.x.toFixed(0)}, {particle.y.toFixed(0)})</span>
                      ))}
                      {queryResult.particles.length > 12 && <span>...y {queryResult.particles.length - 12} más</span>}
                    </div>
                  </div>
                )}
              </div>

              {error && (
                <div className="error-box">
                  ⚠️ {error}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default TreeVisualizer;
