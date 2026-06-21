#include "QuadTree.h"
#include <iostream>

QuadTree::QuadTree(double xmin, double ymin, double xmax, double ymax, int cap)
    : x_min(xmin), y_min(ymin), x_max(xmax), y_max(ymax),
      capacity(cap), divided(false),
      NE(nullptr), NW(nullptr), SE(nullptr), SW(nullptr) {}

QuadTree::~QuadTree() {
    delete NE;
    delete NW;
    delete SE;
    delete SW;
}

void QuadTree::subdivide() {
    double midX = (x_min + x_max) / 2.0;
    double midY = (y_min + y_max) / 2.0;

    NW = new QuadTree(x_min, midY, midX, y_max, capacity);
    NE = new QuadTree(midX, midY, x_max, y_max, capacity);
    SW = new QuadTree(x_min, y_min, midX, midY, capacity);
    SE = new QuadTree(midX, y_min, x_max, midY, capacity);

    divided = true;

    // redistribuir objetos
    for (auto &p : objects) {
        insert(p);
    }
    objects.clear();
}

bool QuadTree::insert(const Particle& p) {
    // fuera de límites
    if (p.x < x_min || p.x > x_max || p.y < y_min || p.y > y_max) return false;

    // si hay espacio y no está subdividido
    if (!divided && (int)objects.size() < capacity) {
        objects.push_back(p);
        return true;
    }

    // subdividir si está lleno
    if (!divided) {
        subdivide();
    }

    // insertar en hijo
    if (NW->insert(p)) return true;
    if (NE->insert(p)) return true;
    if (SW->insert(p)) return true;
    if (SE->insert(p)) return true;

    return false;
}

void QuadTree::queryRange(double xmin, double ymin, double xmax, double ymax,
                          std::vector<Particle>& found) {
    // no intersecta
    if (x_max < xmin || x_min > xmax || y_max < ymin || y_min > ymax) return;

    // revisar objetos en este nodo
    for (auto &p : objects) {
        if (p.x >= xmin && p.x <= xmax && p.y >= ymin && p.y <= ymax) {
            found.push_back(p);
        }
    }

    // revisar hijos
    if (divided) {
        NW->queryRange(xmin, ymin, xmax, ymax, found);
        NE->queryRange(xmin, ymin, xmax, ymax, found);
        SW->queryRange(xmin, ymin, xmax, ymax, found);
        SE->queryRange(xmin, ymin, xmax, ymax, found);
    }
}
