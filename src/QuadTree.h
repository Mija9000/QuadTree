#ifndef QUADTREE_H
#define QUADTREE_H

#include <vector>
#include "Particle.h"

class QuadTree {
private:
    // límites de la región
    double x_min, y_min, x_max, y_max;
    int capacity;
    bool divided;

    // objetos en este nodo
    std::vector<Particle> objects;

    // hijos
    QuadTree* NE;
    QuadTree* NW;
    QuadTree* SE;
    QuadTree* SW;

    void subdivide();

public:
    QuadTree(double xmin, double ymin, double xmax, double ymax, int cap);
    ~QuadTree();

    bool insert(const Particle& p);
    void queryRange(double xmin, double ymin, double xmax, double ymax,
                    std::vector<Particle>& found);
};

#endif
