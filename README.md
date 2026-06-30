# QuadTree – Simulador de Partículas 2D con Evasión de Colisiones
https://main.d1euy5n5eo8sos.amplifyapp.com/

## 📌 Descripción del Proyecto

Este proyecto implementa un **QuadTree** desde cero para simular un enjambre de partículas (drones) en un espacio 2D. La simulación permite visualizar el movimiento de las partículas, detectar colisiones y evadirlas en tiempo real, comparando el rendimiento del QuadTree contra una solución de fuerza bruta.

El proyecto fue desarrollado como parte del curso **Algoritmos y Estructuras de Datos (CS2023)** y demuestra las ventajas de utilizar una estructura de datos espacial para optimizar consultas de vecindad y colisiones.

---

## 🧠 Estructura de Datos Implementada

### QuadTree

El **QuadTree** es una estructura de datos jerárquica que divide recursivamente un espacio 2D en cuatro cuadrantes (subregiones). Cada nodo del árbol almacena partículas dentro de su región y se subdivide cuando supera una capacidad máxima.

**Características principales:**
- Inserción dinámica de partículas.
- Subdivisión automática de nodos.
- Consulta por rango (región rectangular).
- Búsqueda de vecinos cercanos.
- Reconstrucción completa del árbol en cada frame (para simulación en tiempo real).

**Invariantes del QuadTree:**
- Cada nodo representa una región rectangular.
- Las partículas se almacenan en el nodo correspondiente a su ubicación.
- Los nodos se subdividen en 4 hijos cuando contienen más de `MAX_PARTICLES` partículas.
- Todas las partículas están siempre en nodos hoja.

---

## 🎯 Operaciones Implementadas

| Operación | Complejidad | Descripción |
|-----------|-------------|-------------|
| **Insertar partícula** | O(log n) | Inserta una partícula en el nodo correspondiente. |
| **Consultar región** | O(log n + k) | Retorna partículas dentro de un área rectangular. |
| **Reconstruir árbol** | O(n log n) | Reconstruye el árbol desde cero con las partículas actuales. |
| **Subdividir nodo** | O(1) | Divide un nodo en 4 hijos (constante). |
| **Limpiar árbol** | O(n) | Elimina recursivamente todos los nodos y partículas. |

> **n** = número de partículas, **k** = número de partículas encontradas en la consulta.

---

## 🚀 Comparación con Solución Ingenua (Fuerza Bruta)

| Métrica | Fuerza Bruta (O(n²)) | QuadTree (O(n log n)) | Mejora |
|---------|----------------------|----------------------|---------|
| **Comparaciones (1,000 partículas)** | 1,000,000 | ~700 | **1,428x** |
| **Comparaciones (10,000 partículas)** | 100,000,000 | ~7,000 | **14,285x** |
| **Tiempo de consulta** | Proporcional a n² | Proporcional a log n | **Exponencial** |

**Conclusión:** El QuadTree reduce drásticamente el número de comparaciones necesarias para consultas espaciales, haciéndolo ideal para simulaciones con grandes cantidades de partículas.

---

## 📊 Resultados Experimentales

| Tamaño | Fuerza Bruta (comps) | Quadtree (comps) | Mejora |
|--------|---------------------|------------------|---------|
| 100 | 10,000 | ~30 | **333x** |
| 1,000 | 1,000,000 | ~700 | **1,428x** |
| 10,000 | 100,000,000 | ~7,000 | **14,285x** |

---

## 🛠️ Tecnologías Utilizadas

| Componente | Tecnología |
|------------|------------|
| **Backend** | C++ con Crow (servidor HTTP) |
| **Frontend (2D)** | React + TypeScript + Canvas 2D |
| **Frontend (3D)** | React + TypeScript + Three.js |
| **Visualización** | HTML5 Canvas, SVG, Three.js |
| **Despliegue** | AWS Amplify (frontend) + AWS Fargate (backend) |


---

## 🔧 Instrucciones de Compilación y Ejecución

### Requisitos Previos

```bash
# Instalar dependencias necesarias
sudo apt update
sudo apt install -y cmake g++ make git

1. Compilar el Backend (C++)

# Navegar a la carpeta del proyecto
cd QuadTree

# Crear carpeta de compilación
mkdir -p build && cd build

# Generar archivos de compilación
cmake ..

# Compilar
make -j$(nproc)

# Ejecutar el servidor
./server  # o ./quadtree

El servidor correrá en: http://localhost:8080

2. Ejecutar el Frontend (React)

# Navegar a la carpeta del frontend
cd frontend

# Instalar dependencias
npm install

# Ejecutar en modo desarrollo
npm start

# O construir para producción
npm run build

El frontend correrá en: http://localhost:3000

3. Ejecutar con Docker (Opcional)

# Construir la imagen
docker build -t quadtree-server .

# Ejecutar el contenedor
docker run -p 8080:8080 quadtree-server

🌐 Despliegue en la Nube

Backend (AWS Fargate + Api-Gateway)

Frontend (AWS Amplify)

🧪 Pruebas y Demostración
Funcionalidades de la Simulación

    Inserción de partículas: Insertar partículas aleatorias en el mundo.

    Simulación en tiempo real: Los drones se mueven y evitan colisiones.

    Visualización del QuadTree: Mostrar las subdivisiones del árbol.

    Consultas por rango: Buscar partículas en una región.

    Comparación de rendimiento: Quadtree vs Fuerza Bruta.

Entornos de Visualización
Modo	Descripción
2D Canvas	Visualización clásica en 2D con Canvas.
3D Three.js	Visualización inmersiva en 3D con drones modelados.
Árbol SVG	Visualización jerárquica del QuadTree.
📊 Análisis de Complejidad
Operación	Complejidad	Explicación
Inserción	O(log n)	Recorre el árbol hasta la hoja.
Consulta por rango	O(log n + k)	Recorre el árbol (log n) y recolecta resultados (k).
Reconstrucción	O(n log n)	Inserta n partículas en el árbol.
Subdivisión	O(1)	Crea 4 hijos (constante).
Limpiar	O(n)	Recorre y elimina todos los nodos.
🎥 Demostración en Vivo

URL de la aplicación desplegada:

    Frontend: https://main.d1euy5n5eo8sos.amplifyapp.com

    Backend API: https://u9bckqdb48.execute-api.us-east-1.amazonaws.com/prod

Endpoints disponibles:

    GET /tree - Obtener el árbol completo.

    POST /insert - Insertar partícula.

    POST /query - Consultar por rango.

    POST /rebuild - Reconstruir el árbol.

    POST /clear - Limpiar el árbol.

    POST /set-boundary - Cambiar el tamaño del mundo.

🧑‍💻 Autores

    Mijail Saltzín - Implementación del Quadtree y simulación.

    Asignatura: CS2023 - Algoritmos y Estructuras de Datos

    Profesor: Ph.D. Brenner Ojeda

📄 Licencia

Este proyecto fue desarrollado con fines educativos para la asignatura CS2023.
📚 Referencias

    QuadTree - Wikipedia

    Crow C++ Microframework

    Three.js Documentation

    React Documentation

text


---

## 📦 **Archivos a incluir en el .zip**

QuadTree.zip
├── src/ # Backend C++
├── include/ # Headers
├── frontend/ # Frontend React
├── build/ # (opcional, se genera al compilar)
├── CMakeLists.txt # Compilación
├── Dockerfile # Despliegue en contenedor
├── template.yaml # Infraestructura AWS
└── README.md # Este archivo
text


---

