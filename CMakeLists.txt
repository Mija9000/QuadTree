cmake_minimum_required(VERSION 3.10)
project(QuadTreeProject)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_FLAGS "-Wall -O2")

# Archivos fuente
set(SOURCES
    src/main.cpp
    src/QuadTree.cpp
)

add_executable(quadtree ${SOURCES})
