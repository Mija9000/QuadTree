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
