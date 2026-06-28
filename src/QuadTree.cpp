#include "QuadTree.h"

// Constructor O(1)
QuadTree::QuadTree(const AABB& boundary, int capacity)
    : boundary(boundary), capacity(capacity) {
    root = new QuadNode(boundary, capacity);
}

//Destructor llama a clear(O(n))
QuadTree::~QuadTree() {
    clear(root);
}

// Elimina el árbol llamando a clear(O(n))y crea uno nuevo vacío
void QuadTree::reset() {
    clear(root);
    root = new QuadNode(boundary, capacity);
}

// elimina todo el árbol completo del heap O(n) exacto
void QuadTree::clear(QuadNode* node) {
    if (!node) return;
    for (int i = 0; i < 4; i++) {
        clear(node->children[i]);
    }
    delete node;
}

// Subdividir: Divide el rectangulo, crea 4 hijos, marca como dividido, redistribuye partículas
// O(capacity) === O(1), todo constante
void QuadTree::subdivide(QuadNode* node) {
    double x = node->boundary.x;
    double y = node->boundary.y;
    double w = node->boundary.w / 2.0;
    double h = node->boundary.h / 2.0;

    node->children[NW] = new QuadNode({x, y, w, h}, node->capacity);
    node->children[NE] = new QuadNode({x + w, y, w, h}, node->capacity);
    node->children[SW] = new QuadNode({x, y + h, w, h}, node->capacity);
    node->children[SE] = new QuadNode({x + w, y + h, w, h}, node->capacity);

    node->divided = true;

    // Redistribuir partículas existentes, evita duplicados
    std::vector<Particle*> oldParticles = node->particles;
    node->particles.clear();
    
    int nw=0, ne=0, sw=0, se=0;
    for (auto* p : oldParticles) {
        if (node->children[NW]->boundary.contains(*p)) {
            node->children[NW]->particles.push_back(p);
            nw++;
        } else if (node->children[NE]->boundary.contains(*p)) {
            node->children[NE]->particles.push_back(p);
            ne++;
        } else if (node->children[SW]->boundary.contains(*p)) {
            node->children[SW]->particles.push_back(p);
            sw++;
        } else if (node->children[SE]->boundary.contains(*p)) {
            node->children[SE]->particles.push_back(p);
            se++;
        }
    }
}

// Insertar : O(log n) , caso lista enlazada O(n)
void QuadTree::insertRecursive(QuadNode* node, Particle* p) {
    
    // ¿este boundary no contiene a la particula?, no profuncidez aquí
    if (!node->boundary.contains(*p)) {
        return;
    }

    // Si no está dividido y hay espacio, agregar aquí
    if (!node->divided && node->particles.size() < (size_t)node->capacity) {
        node->particles.push_back(p);
        return;
    }

    // Si no está dividido pero está lleno, subdividir
    if (!node->divided) {
        subdivide(node);
    }

    // Ahora hay hijos, intentar insertar en el hijo correcto
    for (int i = 0; i < 4; i++) {
        if (node->children[i]->boundary.contains(*p)) {
            
            // Aquí podrían enviarse particulas duplicadas ya que puede caer en el medio de dos cuadrantes
            // pero como el bucle es de 4 fijo, solo inserta al primero que acepte 
            insertRecursive(node->children[i], p);
            return;
        }
    }
}


// Versión púplica para el usuario
void QuadTree::insert(Particle* p) {
    insertRecursive(root, p);
}


// TAL VEZ LA VUELVO RECURSIVA, DESPUES, PERO ESTA OK
// FALTA ENTENDERLA UN POCO MAS NOMAS
// recursivo empieza a fallar para 1000000 por ahi, 
// para mi est aok con mis 10000
void QuadTree::query(const AABB& range, std::vector<Particle*>& result, int& comparisons) {
    std::vector<QuadNode*> stack{root};
    while (!stack.empty()) {
        QuadNode* node = stack.back();
        stack.pop_back();

        comparisons++;
        if (!node->boundary.intersects(range)) continue;

        for (auto* p : node->particles) {
            if (range.contains(*p)) result.push_back(p);
        }

        if (node->divided) {
            for (int i = 0; i < 4; i++) {
                stack.push_back(node->children[i]);
            }
        }
    }
}


// reset = O(n)
// +
// N veces insert() = N * log n = O(n Log n) 
void QuadTree::rebuild(std::vector<Particle>& particles) {
    reset();
    for (auto& p : particles) {
        insert(&p);
    }
}


// prompt para simulacion
/*
# Proyecto: Simulación de prevención de colisiones de drones utilizando Quadtree

## Objetivo general

Desarrollar una simulación interactiva donde un conjunto de drones se desplaza continuamente dentro de un espacio aéreo bidimensional. El propósito es demostrar cómo la estructura de datos **Quadtree** optimiza la búsqueda espacial para detectar posibles colisiones en tiempo real, reduciendo considerablemente el número de comparaciones respecto al método de fuerza bruta.

La simulación no busca representar un sistema de navegación real, sino mostrar de forma visual y didáctica la utilidad del Quadtree en un problema de ingeniería.

---

## Escenario

Existe un área aérea rectangular donde inicialmente se generan entre **10 y 20 drones**.

Cada dron posee:

* Identificador único.
* Posición (x, y).
* Velocidad (vx, vy).
* Dirección de movimiento.
* Radio de seguridad.
* Color según su estado.

Los drones permanecen activos durante toda la simulación; no se crean ni destruyen nuevos drones.

---

## Inicio de la simulación

Al presionar el botón **Iniciar**:

1. Cada dron recibe una posición inicial.
2. Cada dron recibe una velocidad y dirección aleatorias.
3. Se construye el Quadtree con las posiciones actuales.
4. Comienza la simulación en tiempo real.

---

## Flujo de cada frame

Cada iteración de la simulación debe seguir el siguiente flujo:

1. Actualizar la posición de todos los drones según su velocidad.
2. Reconstruir completamente el Quadtree mediante la operación `rebuild()`.
3. Para cada dron:

   * Crear una región de búsqueda basada en su radio de seguridad.
   * Ejecutar `query()` sobre el Quadtree.
   * Obtener únicamente los drones cercanos.
   * Calcular la distancia únicamente contra esos vecinos.
4. Si existe riesgo de colisión:

   * Modificar ligeramente la dirección del dron para simular una maniobra de evasión.
5. Dibujar nuevamente toda la escena.
6. Repetir continuamente hasta que el usuario presione **Detener**.

---

## Rol del Quadtree

El Quadtree no toma decisiones de movimiento.

Su única responsabilidad es:

* almacenar espacialmente los drones;
* reconstruirse cada iteración mediante `rebuild()`;
* responder consultas espaciales mediante `query()`;
* devolver únicamente los posibles vecinos cercanos.

La decisión de cambiar la trayectoria pertenece exclusivamente al sistema de simulación.

---

## Detección de colisiones

No se comparan todos los drones entre sí.

El procedimiento correcto es:

1. Buscar vecinos usando el Quadtree.
2. Comparar únicamente contra esos vecinos.
3. Si la distancia entre dos drones es menor que el radio de seguridad:

   * se considera un riesgo de colisión;
   * el dron modifica ligeramente su trayectoria.

El objetivo es prevenir la colisión antes de que ocurra.

---

## Interfaz propuesta

La aplicación podría mostrar:

* Área aérea principal.
* Drones animados.
* Líneas o círculos indicando el radio de seguridad.
* Divisiones del Quadtree (opcional).
* Panel lateral con estadísticas.

Información mostrada:

* Número de drones.
* Número de nodos del Quadtree.
* Comparaciones realizadas.
* Colisiones evitadas.
* Tiempo de reconstrucción del Quadtree.
* FPS.
* Estado de la simulación.

Botones:

* Iniciar.
* Detener.
* Reiniciar.

Opciones:

* Mostrar/Ocultar Quadtree.
* Mostrar radio de seguridad.
* Mostrar trayectorias.

---

## Objetivo académico

Demostrar que el uso del Quadtree reduce considerablemente el número de comparaciones necesarias para detectar posibles colisiones.

Comparación esperada:

Sin Quadtree:

* Cada dron compara contra todos los demás.
* Complejidad aproximada: O(n²).

Con Quadtree:

* Cada dron consulta únicamente los vecinos cercanos mediante `query()`.
* Complejidad promedio aproximada: O(n log n).

---

## Arquitectura propuesta

El proyecto se divide en módulos independientes:

### QuadTree

Responsabilidades:

* insert()
* insertRecursive()
* subdivide()
* query()
* clear()
* rebuild()

No contiene lógica de movimiento ni de evasión.

---

### Drone

Representa cada dron.

Contiene:

* posición;
* velocidad;
* dirección;
* radio de seguridad.

---

### Simulation

Controla toda la lógica del sistema:

* actualización de posiciones;
* reconstrucción del Quadtree;
* consultas espaciales;
* detección de riesgo;
* maniobras de evasión;
* actualización de estadísticas.

---

### Renderer

Responsable únicamente del apartado visual:

* dibujar drones;
* dibujar el Quadtree;
* mostrar estadísticas;
* actualizar la interfaz en tiempo real.

---

## Resultado esperado

La simulación debe ejecutarse de forma continua e indefinida, mostrando drones que se desplazan por el espacio, detectan riesgos de colisión mediante consultas al Quadtree y modifican suavemente su trayectoria para evitar aproximaciones peligrosas.

El usuario podrá observar visualmente cómo el Quadtree organiza el espacio y cómo esta estructura permite realizar búsquedas eficientes incluso cuando aumenta el número de drones.
*/