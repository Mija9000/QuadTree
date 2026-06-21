#include <iostream>
#include <vector>
#include <cstdlib>
#include <ctime>
#include "Particle.h"
#include "QuadTree.h"

int main() {
    srand(time(0));

    // crear QuadTree raíz
    QuadTree root(0, 0, 100, 100, 4);

    // insertar partículas aleatorias
    for (int i = 0; i < 20; i++) {
        Particle p;
        p.id = i;
        p.x = rand() % 100;
        p.y = rand() % 100;
        p.vx = 0; p.vy = 0; p.radius = 1;
        root.insert(p);
    }

    // consulta: región (20,20)-(60,60)
    std::vector<Particle> found;
    root.queryRange(20, 20, 60, 60, found);

    std::cout << "Partículas encontradas en la región (20,20)-(60,60):\n";
    for (auto &p : found) {
        std::cout << "ID=" << p.id << " Pos=(" << p.x << "," << p.y << ")\n";
    }

    return 0;
}
