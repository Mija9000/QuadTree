#pragma once
#include <vector>
#include "Particle.h"
#include "AABB.h"

enum Quadrant {
    NW = 0,
    NE = 1,
    SW = 2,
    SE = 3
};

struct QuadNode {
    AABB boundary;
    int capacity; // es 4, solo dice cuantos puntos aguanta antes de subdividirse
    std::vector<Particle*> particles;  // temporalmente se guardan aquí hasta que se llene
    QuadNode* children[4]; 
    bool divided;

    QuadNode(const AABB& boundary, int capacity) {

        this->boundary = boundary;

        this->capacity = capacity;

        this->divided = false;

        for (int i = 0; i < 4; i++) {
            this->children[i] = nullptr;
        }
    }
};
