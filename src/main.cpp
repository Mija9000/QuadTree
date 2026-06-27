#include "crow_all.h"
#include "QuadTree.h"
#include <nlohmann/json.hpp>
#include <fstream>

std::ofstream logFile("/tmp/quadtree.log", std::ios_base::app);

// Función recursiva para convertir un nodo a JSON
nlohmann::json nodeToJson(QuadNode* node) {
    nlohmann::json j;
    j["boundary"] = { {"x", node->boundary.x}, {"y", node->boundary.y},
                      {"w", node->boundary.w}, {"h", node->boundary.h} };
    j["particles"] = nlohmann::json::array();
    for (auto* p : node->particles) {
        j["particles"].push_back({
            {"id", p->id},
            {"x", p->x},
            {"y", p->y},
            {"vx", p->vx},
            {"vy", p->vy},
            {"radius", p->radius}
        });
    }
    j["children"] = nlohmann::json::array();
    if (node->divided) {
        for (int i = 0; i < 4; i++) {
            j["children"].push_back(nodeToJson(node->children[i]));
        }
    }
    return j;
}

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
    
    // Acceso al middleware CORS
    auto& cors = app.get_middleware<CORSMiddleware>();

    QuadTree tree({0,0,400,400}, 4);
    static int nextId = 0; // contador global de IDs



    // Endpoint para insertar partículas
    CROW_ROUTE(app, "/insert").methods("POST"_method)([&tree](const crow::request& req){
        auto body = crow::json::load(req.body);
        if (!body) {
            crow::response res(400);
            res.set_header("Content-Type", "application/json");
            res.body = "{\"error\":\"invalid json\"}";
            return res;
        }

        double x = body["x"].d();
        double y = body["y"].d();
        logFile << "[ENDPOINT] Insertando partícula en (" << x << ", " << y << ")" << std::endl;
        logFile.flush();

        Particle* p = new Particle(nextId++, x, y, 0.0, 0.0, 1.0);
        tree.insert(p);

        logFile << "[ENDPOINT] Insert completado" << std::endl;
        logFile.flush();

        crow::response res(200);
        res.set_header("Content-Type", "application/json");
        res.body = "{\"status\":\"ok\"}";
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




    app.port(8080).multithreaded().run();
}
