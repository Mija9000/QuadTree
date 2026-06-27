import React, { useEffect, useRef, useState } from "react";
import { getTree, insertParticle } from "../services/api";
import SvgPanZoom from "svg-pan-zoom";
import "../styles/TreeVisualizer.css";

interface Particle {
  x: number;
  y: number;
}

interface Node {
  boundary: { x: number; y: number; w: number; h: number };
  particles: Particle[];
  children: Node[];
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

  useEffect(() => {
    const fetchTree = async () => {
      try {
        setLoading(true);
        setError(null);
        const data = await getTree();
        if (data) {
          setTree(data);
        }
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

  // Inicializar pan & zoom cuando el árbol o SVG cambia
  useEffect(() => {
    if (!svgRef.current) return;

    // Destruir instancia anterior si existe
    if (panZoomRef.current) {
      try {
        panZoomRef.current.destroy();
        panZoomRef.current = null;
      } catch (e) {
        console.error("Error destroying previous pan-zoom:", e);
      }
    }

    // Pequeño delay para asegurar que el SVG esté completamente renderizado
    const timer = setTimeout(() => {
      if (!svgRef.current) return;

      // Inicializar svg-pan-zoom
      try {
        panZoomRef.current = SvgPanZoom(svgRef.current, {
          zoomEnabled: true,
          controlIconsEnabled: true,
          fit: false,
          center: false,
          minZoom: 0.5,
          maxZoom: 5,
          beforeZoom: () => true,
          onZoom: () => {},
          beforePan: () => true,
          onPan: () => {},
          dblClickZoomEnabled: true,
          mouseWheelZoomEnabled: true,
          preventMouseEventsDefault: true
        });
      } catch (e) {
        console.error("Error initializing svg-pan-zoom:", e);
      }
    }, 50);

    return () => {
      clearTimeout(timer);
      // Cleanup cuando el componente se desmonta
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

    canvas.width = 400;
    canvas.height = 400;

    try {
      ctx.clearRect(0, 0, 400, 400);
      ctx.fillStyle = "#f0f0f0";
      ctx.fillRect(0, 0, 400, 400);

      // Grid para debug
      ctx.strokeStyle = "#ddd";
      ctx.lineWidth = 1;
      for (let i = 0; i <= 400; i += 100) {
        ctx.beginPath();
        ctx.moveTo(i, 0);
        ctx.lineTo(i, 400);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(0, i);
        ctx.lineTo(400, i);
        ctx.stroke();
      }

      let totalParticles = 0;
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;

      const drawNode = (node: Node, depth = 0) => {
        if (!node || !node.boundary) return;
        
        const { x, y, w, h } = node.boundary;
        
        if (typeof x !== 'number' || typeof y !== 'number' || typeof w !== 'number' || typeof h !== 'number') {
          return;
        }

        // Dibujar rectángulo del nodo
        const colors = ["#333", "#3498db", "#e74c3c", "#f39c12"];
        ctx.strokeStyle = colors[Math.min(depth, 3)];
        ctx.lineWidth = depth === 0 ? 2 : 1;
        ctx.strokeRect(x, y, w, h);

        // Dibujar partículas
        if (Array.isArray(node.particles) && node.particles.length > 0) {
          totalParticles += node.particles.length;
          for (let i = 0; i < node.particles.length; i++) {
            const p = node.particles[i];
            if (typeof p.x === 'number' && typeof p.y === 'number') {
              minX = Math.min(minX, p.x);
              maxX = Math.max(maxX, p.x);
              minY = Math.min(minY, p.y);
              maxY = Math.max(maxY, p.y);
              
              ctx.fillStyle = `hsl(${(Math.random() * 360) | 0}, 80%, 50%)`;
              ctx.beginPath();
              ctx.arc(p.x, p.y, 5, 0, 2 * Math.PI);
              ctx.fill();
              ctx.strokeStyle = "#000";
              ctx.lineWidth = 2;
              ctx.stroke();
              
              // Debug: mostrar coordenadas en canvas
              ctx.fillStyle = "rgba(0,0,0,0.5)";
              ctx.font = "8px monospace";
              ctx.fillText(`${p.x.toFixed(0)},${p.y.toFixed(0)}`, p.x + 7, p.y - 5);
            }
          }
        }

        // Dibujar nodos hijos
        if (Array.isArray(node.children)) {
          for (const child of node.children) {
            drawNode(child, depth + 1);
          }
        }
      };

      drawNode(tree);

      // Mostrar estadísticas
      ctx.fillStyle = "#000";
      ctx.font = "bold 12px monospace";
      ctx.fillText(`Total Partículas: ${totalParticles}`, 5, 20);
      
      if (minX !== Infinity) {
        ctx.font = "10px monospace";
        ctx.fillText(`X: ${minX.toFixed(0)}-${maxX.toFixed(0)}`, 5, 390);
        ctx.fillText(`Y: ${minY.toFixed(0)}-${maxY.toFixed(0)}`, 5, 398);
      }
    } catch (err) {
      console.error("Error al dibujar árbol:", err);
    }
  }, [tree]);

  const handleInsert = async () => {
    const p = { x: Math.random() * 400, y: Math.random() * 400 };
    try {
      setLoading(true);
      setError(null);
      console.log("Insertando partícula:", p);
      await insertParticle(p);
      const newTree = await getTree();
      if (newTree) {
        setTree(newTree);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Error desconocido";
      console.error("Error al insertar:", err);
      setError(`Error al insertar: ${message}`);
    } finally {
      setTimeout(() => setLoading(false), 150);
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
    const positions: NodePosition[] = [{node, x, y, depth}];
    const children = Array.isArray(node.children) ? node.children : [];
    const childSpacing = spacing / Math.pow(2, depth + 1);
    
    children.forEach((child, i) => {
      const offsetX = (i - 1.5) * childSpacing;
      const childX = x + offsetX;
      const childY = y + 80;
      positions.push(...calculateNodePositions(child, childX, childY, depth + 1, spacing));
    });
    return positions;
  };

  // Renderizar árbol como SVG
  const renderSVGTree = (node: Node | null): React.ReactNode => {
    if (!node) return null;
    const positions = calculateNodePositions(node, 400, 20, 0, 800);
    const maxDepth = Math.max(...positions.map(p => p.depth));
    const svgHeight = 80 + maxDepth * 80 + 40;
    const svgWidth = 1200; // Ancho fijo para pan/zoom
    
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
          style={{ border: "1px solid #ddd", background: "#fafafa" }}
        >
          {/* Líneas de conexión */}
        {positions.map((pos, idx) => {
          const children = Array.isArray(pos.node.children) ? pos.node.children : [];
          if (children.length === 0) return null;
          
          return children.map((child, childIdx) => {
            const childPos = positions.find(p => p.node === child);
            if (!childPos) return null;
            return (
              <line
                key={`line-${idx}-${childIdx}`}
                x1={pos.x}
                y1={pos.y + 40}
                x2={childPos.x}
                y2={childPos.y}
                stroke="#3498db"
                strokeWidth="2"
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
                height={slotSize + 10}
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
                y={pos.y + slotSize + 28}
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
      <div className="left-panel">
        <div className="header">
          <h2>QuadTree Visualizer</h2>
          <div className="stats">
            <div className="stat">
              <span className="stat-label">Nodos:</span>
              <span className="stat-value">{countNodes(tree)}</span>
            </div>
            <div className="stat">
              <span className="stat-label">Partículas:</span>
              <span className="stat-value">{countParticles(tree)}</span>
            </div>
          </div>
        </div>

        <canvas 
          ref={canvasRef} 
          width={400} 
          height={400}
          className="canvas-quad"
        ></canvas>

        <div className="controls">
          <button 
              onClick={handleInsert}
              className="insert-button"
            >
            {loading ? "⏳ Insertando..." : "➕ Insertar Partícula"}
          </button>
        </div>

        {error && (
          <div className="error-box">
            ⚠️ {error}
          </div>
        )}
      </div>

      <div className="right-panel">
        <h3>Árbol QuadTree (4 slots por nodo)</h3>
        <div className="tree-structure">
          {tree ? renderSVGTree(tree) : <p className="empty-tree">Cargando...</p>}
        </div>
      </div>
    </div>
  );
};

export default TreeVisualizer;
