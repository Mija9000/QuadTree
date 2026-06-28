export interface SimulationParticle {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
}

export async function rebuildSimulationTree(particles: SimulationParticle[]) {
  const res = await fetch("http://localhost:8080/rebuild", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    mode: "cors",
    body: JSON.stringify({ particles }),
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`No se pudo reconstruir el árbol: ${errorText || "Respuesta inválida"}`);
  }

  return res.json();
}