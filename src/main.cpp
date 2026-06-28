#include "crow_all.h"
#include "QuadTree.h"
#include <nlohmann/json.hpp>
#include <random>
#include <memory>

namespace {

constexpr double kWorldX = 0.0;
constexpr double kWorldY = 0.0;
constexpr double kWorldW = 720.0;
constexpr double kWorldH = 720.0;

std::mt19937& rng() {
    static std::mt19937 generator{std::random_device{}()};
    return generator;
}

double randomDouble(double minValue, double maxValue) {
    std::uniform_real_distribution<double> distribution(minValue, maxValue);
    return distribution(rng());
}

nlohmann::json particleToJson(const Particle* p) {
    return {
        {"id", p->id},
        {"x", p->x},
        {"y", p->y},
        {"vx", p->vx},
        {"vy", p->vy},
        {"radius", p->radius}
    };
}

bool readRange(const crow::json::rvalue& body, AABB& range) {
    if (!body.has("x") || !body.has("y") || !body.has("w") || !body.has("h")) {
        return false;
    }

    range = {body["x"].d(), body["y"].d(), body["w"].d(), body["h"].d()};
    return range.w > 0.0 && range.h > 0.0;
}

} // namespace

namespace {

// Función recursiva para convertir un nodo a JSON
nlohmann::json nodeToJson(QuadNode* node) {
    nlohmann::json j;
    j["boundary"] = { {"x", node->boundary.x}, {"y", node->boundary.y},
                      {"w", node->boundary.w}, {"h", node->boundary.h} };
    j["particles"] = nlohmann::json::array();
    for (auto* p : node->particles) {
        j["particles"].push_back(particleToJson(p));
    }
    j["children"] = nlohmann::json::array();
    if (node->divided) {
        for (int i = 0; i < 4; i++) {
            j["children"].push_back(nodeToJson(node->children[i]));
        }
    }
    return j;
}

} // namespace

// Middleware CORS global
struct CORSMiddleware {
    struct context {};
    
    void before_handle(crow::request&, crow::response& res, context&) {
        res.add_header("Access-Control-Allow-Origin", "*");
        res.add_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
        res.add_header("Access-Control-Allow-Headers", "Content-Type");
        res.add_header("Access-Control-Max-Age", "86400");
    }
    
    void after_handle(crow::request&, crow::response& res, context&) {
        res.add_header("Access-Control-Allow-Origin", "*");
        res.add_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
        res.add_header("Access-Control-Allow-Headers", "Content-Type");
        res.add_header("Access-Control-Max-Age", "86400");
    }
};

int main() {
    crow::App<CORSMiddleware> app;

    QuadTree tree({kWorldX, kWorldY, kWorldW, kWorldH}, 4);
    std::vector<std::unique_ptr<Particle>> ownedParticles;
    int nextId = 0; // contador global de IDs



    // Endpoint para insertar partículas
    CROW_ROUTE(app, "/insert").methods("POST"_method)([&tree, &ownedParticles, &nextId](const crow::request& req){
        auto body = crow::json::load(req.body);
        if (!body) {
            crow::response res(400);
            res.set_header("Content-Type", "application/json");
            res.body = "{\"error\":\"invalid json\"}";
            return res;
        }

        double x = body["x"].d();
        double y = body["y"].d();

        ownedParticles.push_back(std::make_unique<Particle>(nextId++, x, y, 0.0, 0.0, 1.0));
        Particle* p = ownedParticles.back().get();
        tree.insert(p);

        crow::response res(200);
        res.set_header("Content-Type", "application/json");
        res.body = "{\"status\":\"ok\"}";
        return res;
    });
    CROW_ROUTE(app, "/bulk-insert").methods("POST"_method)([&tree, &ownedParticles, &nextId](const crow::request& req){
        auto body = crow::json::load(req.body);
        if (!body || !body.has("count")) {
            crow::response res(400);
            res.set_header("Content-Type", "application/json");
            res.body = "{\"error\":\"invalid json, expected count\"}";
            return res;
        }

        int count = body["count"].i();
        if (count <= 0 || count > 5000) {
            crow::response res(400);
            res.set_header("Content-Type", "application/json");
            res.body = "{\"error\":\"count must be between 1 and 5000\"}";
            return res;
        }

        for (int i = 0; i < count; ++i) {
            ownedParticles.push_back(std::make_unique<Particle>(
                nextId++,
                randomDouble(kWorldX, kWorldX + kWorldW),
                randomDouble(kWorldY, kWorldY + kWorldH),
                0.0,
                0.0,
                1.0
            ));
            auto* p = ownedParticles.back().get();
            tree.insert(p);
        }

        crow::response res(200);
        res.set_header("Content-Type", "application/json");
        res.body = std::string("{\"status\":\"ok\",\"inserted\":") + std::to_string(count) + "}";
        return res;
    });
    // Endpoint para devolver el árbol
    CROW_ROUTE(app, "/tree").methods("GET"_method)([&tree](){
        try {
            auto j = nodeToJson(tree.getRoot());
            crow::response res(200);
            res.set_header("Content-Type", "application/json");
            res.body = j.dump();
            return res;
        } catch (const std::exception& e) {
            crow::response res(500);
            res.set_header("Content-Type", "application/json");
            res.body = "{\"error\":\"" + std::string(e.what()) + "\"}";
            return res;
        }
    });

    CROW_ROUTE(app, "/query").methods("POST"_method)([&tree](const crow::request& req){
        auto body = crow::json::load(req.body);
        if (!body) {
            crow::response res(400);
            res.set_header("Content-Type", "application/json");
            res.body = "{\"error\":\"invalid json\"}";
            return res;
        }

        AABB range;
        if (!readRange(body, range)) {
            crow::response res(400);
            res.set_header("Content-Type", "application/json");
            res.body = "{\"error\":\"invalid range\"}";
            return res;
        }

        std::vector<Particle*> result;
        int comparisons = 0;
        tree.query(range, result, comparisons);

        nlohmann::json response;
        response["range"] = {
            {"x", range.x},
            {"y", range.y},
            {"w", range.w},
            {"h", range.h}
        };
        response["comparisons"] = comparisons;
        response["count"] = result.size();
        response["particles"] = nlohmann::json::array();
        for (const auto* p : result) {
            response["particles"].push_back(particleToJson(p));
        }

        crow::response res(200);
        res.set_header("Content-Type", "application/json");
        res.body = response.dump();
        return res;
    });
    // Nuevos -----------------------------------

    // Endpoint para vaciar el árbol
    CROW_ROUTE(app, "/clear").methods("POST"_method)([&tree, &ownedParticles, &nextId](){
        tree.reset();
        ownedParticles.clear();
        nextId = 0;

        crow::response res(200);
        res.set_header("Content-Type", "application/json");
        res.body = "{\"status\":\"cleared\"}";
        return res;
    });
    // Endpoint para reconstruir el árbol con un conjunto de partículas
    CROW_ROUTE(app, "/rebuild").methods("POST"_method)([&tree, &ownedParticles, &nextId](const crow::request& req){
        auto body = crow::json::load(req.body);
        if (!body || !body.has("particles")) {
            crow::response res(400);
            res.set_header("Content-Type", "application/json");
            res.body = "{\"error\":\"invalid json, expected particles array\"}";
            return res;
        }
        tree.reset();
        ownedParticles.clear();

        for (auto& pj : body["particles"]) {
            ownedParticles.push_back(std::make_unique<Particle>(
                pj["id"].i(),
                pj["x"].d(),
                pj["y"].d(),
                pj["vx"].d(),
                pj["vy"].d(),
                pj["radius"].d()
            ));
            tree.insert(ownedParticles.back().get());
        }

        nextId = 0;
        if (!ownedParticles.empty()) {
            for (const auto& particle : ownedParticles) {
                if (particle->id >= nextId) {
                    nextId = particle->id + 1;
                }
            }
        }

        crow::response res(200);
        res.set_header("Content-Type", "application/json");
        res.body = "{\"status\":\"rebuilt\",\"count\":" + std::to_string(ownedParticles.size()) + "}";
        return res;
    });


    app.port(8080).multithreaded().run();
}
