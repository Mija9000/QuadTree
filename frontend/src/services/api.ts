export async function getTree() {
  try {
    const res = await fetch("http://localhost:8080/tree", {
      method: "GET",
      headers: { "Content-Type": "application/json" },
      mode: "cors",
    });

    if (!res.ok) {
      const errorText = await res.text();
      throw new Error(`Error HTTP ${res.status}: ${errorText || "Sin respuesta del servidor"}`);
    }

    const data = await res.json();
    
    // Validar estructura básica
    if (!data || typeof data !== 'object') {
      throw new Error("Respuesta inválida del servidor");
    }
    
    return data;
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error desconocido";
    console.error("Error en getTree:", message);
    throw new Error(`No se pudo conectar con el servidor: ${message}`);
  }
}

export async function insertParticle(p: { x: number; y: number }) {
  try {
    // Validar que los datos sean números válidos
    if (typeof p.x !== 'number' || typeof p.y !== 'number') {
      throw new Error("Coordenadas inválidas");
    }
    
    const res = await fetch("http://localhost:8080/insert", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      mode: "cors",
      body: JSON.stringify(p),
    });

    if (!res.ok) {
      const errorText = await res.text();
      throw new Error(`Error HTTP ${res.status}: ${errorText || "Sin respuesta del servidor"}`);
    }

    const data = await res.json();
    return data;
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error desconocido";
    console.error("Error en insertParticle:", message);
    throw new Error(`No se pudo insertar la partícula: ${message}`);
  }
}

export async function bulkInsertParticles(count: number) {
  try {
    if (!Number.isFinite(count) || count <= 0) {
      throw new Error("Cantidad inválida");
    }

    const res = await fetch("http://localhost:8080/bulk-insert", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      mode: "cors",
      body: JSON.stringify({ count }),
    });

    if (!res.ok) {
      const errorText = await res.text();
      throw new Error(`Error HTTP ${res.status}: ${errorText || "Sin respuesta del servidor"}`);
    }

    return await res.json();
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error desconocido";
    console.error("Error en bulkInsertParticles:", message);
    throw new Error(`No se pudo hacer la inserción masiva: ${message}`);
  }
}

export async function clearTree() {
  try {
    const res = await fetch("http://localhost:8080/clear", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      mode: "cors",
      body: JSON.stringify({}),
    });

    if (!res.ok) {
      const errorText = await res.text();
      throw new Error(`Error HTTP ${res.status}: ${errorText || "Sin respuesta del servidor"}`);
    }

    return await res.json();
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error desconocido";
    console.error("Error en clearTree:", message);
    throw new Error(`No se pudo limpiar el árbol: ${message}`);
  }
}

export async function setTreeBoundary(size: number) {
  try {
    const res = await fetch("http://localhost:8080/set-boundary", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      mode: "cors",
      body: JSON.stringify({ size }), // ← Solo envía { size: 1000 }
    });

    if (!res.ok) {
      const errorText = await res.text();
      throw new Error(`Error HTTP ${res.status}: ${errorText || "Sin respuesta"}`);
    }

    return await res.json();
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error desconocido";
    console.error("Error en setTreeBoundary:", message);
    throw new Error(`No se pudo cambiar el boundary: ${message}`);
  }
}

export async function queryTree(range: { x: number; y: number; w: number; h: number }) {
  try {
    const res = await fetch("http://localhost:8080/query", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      mode: "cors",
      body: JSON.stringify(range),
    });

    if (!res.ok) {
      const errorText = await res.text();
      throw new Error(`Error HTTP ${res.status}: ${errorText || "Sin respuesta del servidor"}`);
    }

    return await res.json();
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error desconocido";
    console.error("Error en queryTree:", message);
    throw new Error(`No se pudo consultar el árbol: ${message}`);
  }
}
