# === ETAPA 1: COMPILACIÓN ===
FROM ubuntu:22.04 AS builder

# Instalar dependencias necesarias
RUN apt-get update && apt-get install -y \
    cmake \
    g++ \
    make \
    git \
    libasio-dev \
    libssl-dev \
    nlohmann-json3-dev \
    && rm -rf /var/lib/apt/lists/*

# Copiar el código fuente
WORKDIR /app
COPY . .

# Compilar
RUN mkdir -p build && cd build && \
    cmake .. && \
    make -j$(nproc)

# === ETAPA 2: IMAGEN FINAL ===
FROM ubuntu:22.04

# Instalar librerías necesarias para ejecutar
RUN apt-get update && apt-get install -y \
    libssl-dev \
    libasio-dev \
    && rm -rf /var/lib/apt/lists/*

# Copiar el ejecutable compilado
WORKDIR /app
COPY --from=builder /app/build/quadtree ./quadtree

# Exponer el puerto
EXPOSE 8080

# Ejecutar el servidor
CMD ["./quadtree"]