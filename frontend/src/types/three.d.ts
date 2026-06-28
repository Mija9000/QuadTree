declare module "three" {
	export const SRGBColorSpace: any;
	export const PCFSoftShadowMap: any;
	export const BackSide: any;
    export const RepeatWrapping: any;
    export const EquirectangularReflectionMapping: any;

	export class Vector3 {
		constructor(x?: number, y?: number, z?: number);
		x: number;
		y: number;
		z: number;
		clone(): Vector3;
		copy(vector: Vector3): this;
		set(x: number, y: number, z: number): this;
		setScalar(value: number): this;
		lerpVectors(start: Vector3, end: Vector3, alpha: number): this;
	}

	export class Color {
		constructor(value?: any);
		setHSL(h: number, s: number, l: number): this;
		clone(): Color;
		multiplyScalar(value: number): this;
	}

	export class Object3D {
		type: string;
		visible: boolean;
		children: Object3D[];
		position: Vector3;
		rotation: { x: number; y: number; z: number };
		scale: Vector3;
		add(...objects: Object3D[]): this;
		remove(...objects: Object3D[]): this;
		traverse(callback: (object: Object3D) => void): void;
		clear(): void;
	}

	export class Scene extends Object3D {
		fog: any;
		background: any;
		environment: any;
	}

	export class Fog {
		constructor(color?: any, near?: number, far?: number);
	}

	export class Group extends Object3D {}

	export class PerspectiveCamera extends Object3D {
		aspect: number;
		constructor(fov?: number, aspect?: number, near?: number, far?: number);
		updateProjectionMatrix(): void;
	}

	export class WebGLRenderer {
		domElement: HTMLCanvasElement;
		shadowMap: { enabled: boolean; type: any };
		outputColorSpace: any;
		constructor(parameters?: any);
		setPixelRatio(pixelRatio: number): void;
		setClearColor(color: any, alpha?: number): void;
		setSize(width: number, height: number, updateStyle?: boolean): void;
		render(scene: Scene, camera: PerspectiveCamera): void;
		dispose(): void;
	}

	export class AmbientLight extends Object3D {
		constructor(color?: any, intensity?: number);
	}

	export class HemisphereLight extends Object3D {
		constructor(skyColor?: any, groundColor?: any, intensity?: number);
	}

	export class DirectionalLight extends Object3D {
		castShadow: boolean;
		shadow: {
			mapSize: { width: number; height: number };
			camera: { near: number; far: number; left: number; right: number; top: number; bottom: number };
		};
		constructor(color?: any, intensity?: number);
	}

	export class PlaneGeometry {
		constructor(width?: number, height?: number);
		dispose(): void;
	}

	export class CanvasTexture {
		constructor(image?: any);
		colorSpace: any;
		wrapS: any;
		wrapT: any;
		repeat: { set(x: number, y: number): void };
		anisotropy: number;
		dispose(): void;
	}

	export class BufferAttribute {
		constructor(array: ArrayLike<number>, itemSize: number);
	}

	export class PMREMGenerator {
		constructor(renderer: WebGLRenderer);
		fromEquirectangular(texture: any): { texture: any };
		dispose(): void;
	}

	export class ShaderMaterial {
		constructor(parameters?: any);
	}

	export class BoxGeometry {
		constructor(width?: number, height?: number, depth?: number);
		dispose(): void;
	}

	export class SphereGeometry {
		constructor(radius?: number, widthSegments?: number, heightSegments?: number);
		dispose(): void;
	}

	export class OctahedronGeometry {
		constructor(radius?: number, detail?: number);
		dispose(): void;
	}

	export class BufferGeometry {
		setFromPoints(points: Vector3[]): this;
		dispose(): void;
	}

	export class MeshBasicMaterial {
		constructor(parameters?: any);
		dispose(): void;
	}

	export class Material {
		transparent: boolean;
		opacity: number;
		dispose(): void;
	}

	export class MeshStandardMaterial {
		constructor(parameters?: any);
		dispose(): void;
	}

	export class LineBasicMaterial {
		transparent: boolean;
		opacity: number;
		constructor(parameters?: any);
		dispose(): void;
	}

	export class Mesh extends Object3D {
		geometry: any;
		material: any;
		castShadow: boolean;
		receiveShadow: boolean;
		scale: Vector3;
		constructor(geometry?: any, material?: any);
	}

	export class Line extends Object3D {
		geometry: any;
		material: any;
		constructor(geometry?: any, material?: any);
	}

	export class GridHelper extends Object3D {
		material: any;
		constructor(size?: number, divisions?: number, color1?: any, color2?: any);
	}
}

declare module "three/examples/jsm/loaders/GLTFLoader" {
	import { Object3D } from "three";

	export class GLTFLoader {
		loadAsync(url: string): Promise<{ scene: Object3D }>;
	}
}

declare module "three/examples/jsm/loaders/RGBELoader" {
	export class RGBELoader {
		loadAsync(url: string): Promise<any>;
	}
}

declare module "three/examples/jsm/controls/OrbitControls" {
	import { PerspectiveCamera, Vector3 } from "three";

	export class OrbitControls {
		constructor(camera: PerspectiveCamera, domElement: HTMLElement);
		enableDamping: boolean;
		dampingFactor: number;
		enablePan: boolean;
		enableZoom: boolean;
		minDistance: number;
		maxDistance: number;
		minPolarAngle: number;
		maxPolarAngle: number;
		target: Vector3;
		update(): void;
		dispose(): void;
	}
}