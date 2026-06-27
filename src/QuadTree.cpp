#include "QuadTree.h"
#include <iostream>
#include <fstream>

extern std::ofstream logFile;

QuadTree::QuadTree(const AABB& boundary, int capacity)
    : boundary(boundary), capacity(capacity) {
    root = new QuadNode(boundary, capacity);
}

QuadTree::~QuadTree() {
    clear(root);
}

void QuadTree::clear(QuadNode* node) {
    if (!node) return;
    for (int i = 0; i < 4; i++) {
        clear(node->children[i]);
    }
    delete node;
}

void QuadTree::subdivide(QuadNode* node) {
    double x = node->boundary.x;
    double y = node->boundary.y;
    double w = node->boundary.w / 2.0;
    double h = node->boundary.h / 2.0;

    logFile << "[SUBDIVIDE] Nodo en (" << x << "," << y << ") size=" << w << "x" << h << " tiene " << node->particles.size() << " partículas" << std::endl;
    logFile.flush();

    node->children[NW] = new QuadNode({x, y, w, h}, node->capacity);
    node->children[NE] = new QuadNode({x + w, y, w, h}, node->capacity);
    node->children[SW] = new QuadNode({x, y + h, w, h}, node->capacity);
    node->children[SE] = new QuadNode({x + w, y + h, w, h}, node->capacity);

    node->divided = true;

    // Redistribuir partículas existentes
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
        } else {
            logFile << "[ERROR] Partícula en (" << p->x << "," << p->y << ") no cabe en ningún cuadrante!" << std::endl;
            logFile.flush();
        }
    }
    logFile << "[SUBDIVIDE] Distribuidas: NW=" << nw << " NE=" << ne << " SW=" << sw << " SE=" << se << std::endl;
    logFile.flush();
}


void QuadTree::insertRecursive(QuadNode* node, Particle* p) {
    if (!node->boundary.contains(*p)) {
        logFile << "[INSERT] Partícula (" << p->x << "," << p->y << ") FUERA de límites" << std::endl;
        logFile.flush();
        return;
    }

    logFile << "[INSERT] Partícula (" << p->x << "," << p->y << ") en nodo (" << node->boundary.x << "," << node->boundary.y << ") - tiene " << node->particles.size() << "/" << node->capacity << " partículas" << std::endl;
    logFile.flush();

    // Si no está dividido y hay espacio, agregar aquí
    if (!node->divided && node->particles.size() < (size_t)node->capacity) {
        node->particles.push_back(p);
        logFile << "[INSERT] Agregada al nodo actual. Total: " << node->particles.size() << std::endl;
        logFile.flush();
        return;
    }

    // Si no está dividido pero está lleno, subdividir
    if (!node->divided) {
        logFile << "[INSERT] Nodo lleno, subdividiendo..." << std::endl;
        logFile.flush();
        subdivide(node);
    }

    // Ahora hay hijos, intentar insertar en el hijo correcto
    for (int i = 0; i < 4; i++) {
        if (node->children[i]->boundary.contains(*p)) {
            logFile << "[INSERT] Insertando en hijo " << i << std::endl;
            logFile.flush();
            insertRecursive(node->children[i], p);
            return;
        }
    }
    
    logFile << "[INSERT] ERROR: Partícula no cabe en ningún cuadrante hijo" << std::endl;
    logFile.flush();
}



void QuadTree::insert(Particle* p) {
    insertRecursive(root, p);
}



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



void QuadTree::rebuild(std::vector<Particle>& particles) {
    clear(root);
    root = new QuadNode(boundary, capacity); // Usar miembros guardados
    for (auto& p : particles) {
        insert(&p);
    }
}
