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

// Reset con boundary nuevo
void QuadTree::reset(const AABB& newBoundary) {
    clear(root);
    boundary = newBoundary;
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


