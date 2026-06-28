import React, { useState } from "react";
import TreeVisualizer from "./components/TreeVisualizer";
import DroneSimulation from "./components/DroneSimulation";
import ProSimulation from "./components/ProSimulation";
import UltimateSimulation from "./components/UltimateSimulation";
import "./App.css";

function App() {
  const [activeView, setActiveView] = useState<"insert" | "simulation" | "pro" | "ultimate">("insert");

  return (
    <div className="app-shell">
      <header className="app-navbar">
        <div className="brand-block">
          <div className="brand-title">QuadTree</div>
          <div className="brand-subtitle">Inserción y simulación de drones</div>
        </div>

        <nav className="view-switcher" aria-label="Secciones principales">
          <button
            type="button"
            className={activeView === "insert" ? "nav-button active" : "nav-button"}
            onClick={() => setActiveView("insert")}
          >
            Inserción
          </button>
          <button
            type="button"
            className={activeView === "simulation" ? "nav-button active" : "nav-button"}
            onClick={() => setActiveView("simulation")}
          >
            Simulación
          </button>
          <button
            type="button"
            className={activeView === "pro" ? "nav-button active" : "nav-button"}
            onClick={() => setActiveView("pro")}
          >
            Pro Simulation
          </button>
          <button
            type="button"
            className={activeView === "ultimate" ? "nav-button active" : "nav-button"}
            onClick={() => setActiveView("ultimate")}
          >
            Ultimate Simulation
          </button>
        </nav>
      </header>

      <main className="app-content">
        {activeView === "insert" ? (
          <TreeVisualizer />
        ) : activeView === "simulation" ? (
          <DroneSimulation />
        ) : activeView === "pro" ? (
          <ProSimulation />
        ) : (
          <UltimateSimulation />
        )}
      </main>
    </div>
  );
}

export default App;
