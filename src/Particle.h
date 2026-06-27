#pragma once
struct Particle {
    int id;
    double x, y;
    double vx, vy;
    double radius;

    // Constructor con valores por defecto
    Particle(int id_, double x_, double y_, double vx_=0, double vy_=0, double r=1)
        : id(id_), x(x_), y(y_), vx(vx_), vy(vy_), radius(r) {}
};
