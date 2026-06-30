// 🔥 CONFIGURACIÓN: URL de tu backend en AWS
const API_URL = "http://44.206.225.167:8080";

export async function getTree() {
  try {
    const res = await fetch(`${API_URL}/tree`, {
      method: "GET",
      headers: { "Content-Type": "application/json" },
      mode: "cors",
    });

    if (!res.ok) {
      const errorText = await res.text();
      throw new Error(`Error HTTP ${res.status}: ${errorText || "Sin respuesta del servidor"}`);
    }

    const data = await res.json();
    
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
    if (typeof p.x !== 'number' || typeof p.y !== 'number') {
      throw new Error("Coordenadas inválidas");
    }
    
    const res = await fetch(`${API_URL}/insert`, {
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

    const res = await fetch(`${API_URL}/bulk-insert`, {
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
    const res = await fetch(`${API_URL}/clear`, {
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
    const res = await fetch(`${API_URL}/set-boundary`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      mode: "cors",
      body: JSON.stringify({ size }),
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
    const res = await fetch(`${API_URL}/query`, {
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