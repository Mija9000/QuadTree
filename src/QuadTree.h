#pragma once
#include <vector>
#include "QuadNode.h"

class QuadTree {
    QuadNode* root;
    AABB boundary;   // Guardar boundary global
    int capacity;    // Guardar capacidad global

    void subdivide(QuadNode* node);
    
    void insertRecursive(QuadNode* node, Particle* p);

public:
    QuadTree(const AABB& boundary, int capacity);
    ~QuadTree();

    void insert(Particle* p);
    void query(const AABB& range, std::vector<Particle*>& result, int& comparisons);
    void rebuild(std::vector<Particle>& particles);
    void reset();
    void reset(const AABB& newBoundary);

    void clear(QuadNode* node);

    // Getter correcto
    QuadNode* getRoot() { return root; }
};
