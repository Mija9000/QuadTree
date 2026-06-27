#pragma once
#include "Particle.h"

struct AABB {
    double x, y, w, h; // esquina (x,y), ancho y alto

    bool contains(const Particle& p) const {
        return (p.x >= x && p.x <= x + w &&
                p.y >= y && p.y <= y + h);
    }

    bool intersects(const AABB& range) const {
        return !(range.x > x + w ||
                 range.x + range.w < x ||
                 range.y > y + h ||
                 range.y + range.h < y);
    }
};
