import React, { useEffect, useRef, useState } from "react";
import {
  bulkInsertParticles,
  clearTree,
  getTree,
  insertParticle,
  queryTree,
  setTreeBoundary,
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
  const panZoomRef = useRef<ReturnType<typeof SvgPanZoom> | null>(null);
  const [tree, setTree] = useState<Node | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [queryRange, setQueryRange] = useState<QueryRange>({ x: 100, y: 100, w: 120, h: 120 });
  const [queryResult, setQueryResult] = useState<QueryResult | null>(null);
  const [customBoundary, setCustomBoundary] = useState({ x: 0, y: 0, w: 720, h: 720 });

  const WORLD_SIZE = 400;
  const canvasSize = { width: 560, height: 560 } as const;
  const canvasView = {
    scale: 1,
    offsetX: (canvasSize.width - WORLD_SIZE) / 2,
    offsetY: (canvasSize.height - WORLD_SIZE) / 2,
  };

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

    const rootBoundary = tree.boundary;
    const worldX = rootBoundary.x;
    const worldY = rootBoundary.y;
    const worldW = rootBoundary.w;
    const worldH = rootBoundary.h;
    const canvasWidth = canvasSize.width;
    const canvasHeight = canvasSize.height;
    const scaleX = canvasWidth / worldW;
    const scaleY = canvasHeight / worldH;
    const scale = Math.min(scaleX, scaleY) * 0.95;
    const offsetX = (canvasWidth - worldW * scale) / 2 - worldX * scale;
    const offsetY = (canvasHeight - worldH * scale) / 2 - worldY * scale;

    const devicePixelRatio = window.devicePixelRatio || 1;
    canvas.width = Math.round(canvasWidth * devicePixelRatio);
    canvas.height = Math.round(canvasHeight * devicePixelRatio);
    canvas.style.width = `${canvasWidth}px`;
    canvas.style.height = `${canvasHeight}px`;

    try {
      ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = "#f6f8fb";
      ctx.fillRect(0, 0, canvasWidth, canvasHeight);

      ctx.save();
      ctx.translate(offsetX, offsetY);
      ctx.scale(scale, scale);

      // Grid del boundary de la raíz
      ctx.strokeStyle = "#dde6f1";
      ctx.lineWidth = 1 / scale;
      const gridStep = 50;
      for (let i = Math.floor(worldX / gridStep) * gridStep; i <= worldX + worldW; i += gridStep) {
        ctx.beginPath();
        ctx.moveTo(i, worldY);
        ctx.lineTo(i, worldY + worldH);
        ctx.stroke();

        ctx.beginPath();
        ctx.moveTo(worldX, i);
        ctx.lineTo(worldX + worldW, i);
        ctx.stroke();
      }

      let totalParticles = 0;
      let minX = Infinity;
      let maxX = -Infinity;
      let minY = Infinity;
      let maxY = -Infinity;
      const highlightedIds = new Set(queryResult?.particles.map((particle) => particle.id) ?? []);

      const drawNode = (node: Node, depth = 0) => {
        if (!node || !node.boundary) return;

        const { x, y, w, h } = node.boundary;

        const colors = ["#263238", "#2d8ac7", "#d64541", "#b9770e"];
        ctx.strokeStyle = colors[Math.min(depth, 3)];
        ctx.lineWidth = depth === 0 ? 2.5 / scale : 1.1 / scale;
        ctx.strokeRect(x, y, w, h);

        if (Array.isArray(node.particles) && node.particles.length > 0) {
          totalParticles += node.particles.length;
          for (const p of node.particles) {
            if (typeof p.x === "number" && typeof p.y === "number") {
              minX = Math.min(minX, p.x);
              maxX = Math.max(maxX, p.x);
              minY = Math.min(minY, p.y);
              maxY = Math.max(maxY, p.y);

              const isQueryHit = highlightedIds.has(p.id);
              ctx.fillStyle = isQueryHit ? "#2ecc71" : "#e74c3c";
              ctx.beginPath();
              ctx.arc(p.x, p.y, (isQueryHit ? 5.5 : 4.5) / scale, 0, 2 * Math.PI);
              ctx.fill();
              ctx.strokeStyle = isQueryHit ? "#145a32" : "#000";
              ctx.lineWidth = 1.5 / scale;
              ctx.stroke();

              ctx.fillStyle = "rgba(0,0,0,0.55)";
              ctx.font = `${Math.max(8, 8 / scale)}px monospace`;
              ctx.fillText(`${p.x.toFixed(0)},${p.y.toFixed(0)}`, p.x + 7 / scale, p.y - 5 / scale);
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
        ctx.lineWidth = 2 / scale;
        ctx.fillRect(x, y, w, h);
        ctx.strokeRect(x, y, w, h);
        ctx.restore();
      }

      drawNode(tree);

      ctx.fillStyle = "#111";
      ctx.font = `bold ${12 / scale}px monospace`;
      ctx.fillText(`Total Partículas: ${totalParticles}`, 5 / scale, 20 / scale);
      if (queryResult) {
        ctx.fillText(`Consulta: ${queryResult.count} / ${queryResult.comparisons} nodos`, 5 / scale, 36 / scale);
      }

      if (minX !== Infinity) {
        ctx.font = `${10 / scale}px monospace`;
        ctx.fillText(`X: ${minX.toFixed(0)}-${maxX.toFixed(0)}`, 5 / scale, (worldH - 10) / scale);
        ctx.fillText(`Y: ${minY.toFixed(0)}-${maxY.toFixed(0)}`, 5 / scale, (worldH - 2) / scale);
      }

      ctx.restore();
    } catch (err) {
      console.error("Error al dibujar árbol:", err);
    }
  }, [tree, queryResult]);

  const handleInsert = async () => {
    if (!tree) {
      console.error("No hay árbol cargado");
      setError("Primero debes cargar el árbol");
      return;
    }

    const { x, y, w, h } = tree.boundary;
    const p = {
      x: x + Math.random() * w,
      y: y + Math.random() * h,
    };
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
    if (!tree) {
      console.error("No hay árbol cargado");
      setError("Primero debes cargar el árbol");
      return;
    }

    const { x, y, w, h } = tree.boundary;
    try {
      setLoading(true);
      setError(null);

      for (let i = 0; i < count; i++) {
        const p = {
          x: x + Math.random() * w,
          y: y + Math.random() * h,
        };
        await insertParticle(p);
      }

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
    } catch (err) {
      const message = err instanceof Error ? err.message : "Error desconocido";
      console.error("Error al limpiar:", err);
      setError(`Error al limpiar: ${message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleApplyBoundary = async () => {
    try {
      setLoading(true);
      setError(null);
      await setTreeBoundary(customBoundary);
      await refreshTree();
      setQueryResult(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Error desconocido";
      console.error("Error al aplicar boundary:", err);
      setError(`Error al aplicar boundary: ${message}`);
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
    const positions: NodePosition[] = [{ node, x, y, depth }];
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

  const renderSVGTree = (node: Node | null): React.ReactNode => {
    if (!node) return null;
    const rawPositions = calculateNodePositions(node, 0, 24, 0, 980);
    const minX = Math.min(...rawPositions.map((position) => position.x));
    const maxX = Math.max(...rawPositions.map((position) => position.x));
    const svgWidth = Math.max(1100, maxX - minX + 180);
    const offsetX = (svgWidth - (maxX - minX)) / 2 - minX;
    const positions = rawPositions.map((position) => ({ ...position, x: position.x + offsetX }));
    const maxDepth = Math.max(...positions.map((position) => position.depth));
    const svgHeight = Math.max(420, 80 + maxDepth * 96 + 40);
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

          <div className="canvas-shell">
            <canvas ref={canvasRef} width={canvasSize.width} height={canvasSize.height} className="canvas-quad"></canvas>
          </div>

          <div className="control-section action-section action-section-left">
            <div className="section-title">Acciones</div>
            <div className="controls" style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "8px", width: "100%" }}>
              <label style={{ display: "flex", flexDirection: "column", gap: "4px", fontSize: "12px", fontWeight: 600 }}>
                X
                <input
                  type="number"
                  value={customBoundary.x}
                  onChange={(event) => setCustomBoundary((previous) => ({ ...previous, x: Number(event.target.value) }))}
                />
              </label>
              <label style={{ display: "flex", flexDirection: "column", gap: "4px", fontSize: "12px", fontWeight: 600 }}>
                Y
                <input
                  type="number"
                  value={customBoundary.y}
                  onChange={(event) => setCustomBoundary((previous) => ({ ...previous, y: Number(event.target.value) }))}
                />
              </label>
              <label style={{ display: "flex", flexDirection: "column", gap: "4px", fontSize: "12px", fontWeight: 600 }}>
                W
                <input
                  type="number"
                  min={1}
                  value={customBoundary.w}
                  onChange={(event) => setCustomBoundary((previous) => ({ ...previous, w: Math.max(1, Number(event.target.value)) }))}
                />
              </label>
              <label style={{ display: "flex", flexDirection: "column", gap: "4px", fontSize: "12px", fontWeight: 600 }}>
                H
                <input
                  type="number"
                  min={1}
                  value={customBoundary.h}
                  onChange={(event) => setCustomBoundary((previous) => ({ ...previous, h: Math.max(1, Number(event.target.value)) }))}
                />
              </label>
            </div>
            <div className="controls action-controls">
  <button onClick={handleApplyBoundary} className="insert-button secondary-button" disabled={loading}>
    Aplicar cuadrante
  </button>
  <button onClick={handleInsert} className="insert-button" disabled={loading}>
    {loading ? "⏳ Insertando..." : "➕ Insertar Partícula"}
  </button>
  <button onClick={handleClear} className="insert-button danger-button" disabled={loading}>
    Limpiar
  </button>
</div>
            <div style={{ marginTop: 8, fontSize: 12, color: "#4f5d75" }}>
              Área: {customBoundary.w * customBoundary.h} | X: {customBoundary.x} - {customBoundary.x + customBoundary.w} | Y: {customBoundary.y} - {customBoundary.y + customBoundary.h}
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
