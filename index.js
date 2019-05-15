'use strict';


(() => {
	
	const lerp1 = (a, b, t) => a + (b - a) * t;
	const lerp = (a, b, t) => a.map((c, i) => lerp1(c, b[i]));
	const length = v => Math.sqrt(v.reduce((s, c) => s + c * c, 0));
	const scale = (v, f) => v.map(c => c * f);
	const normalize = v => {
		const len = length(v);
		if (len > 0) {
			return scale(v, 1 / len);
		}
		return v.slice();
	};
	const cross = ([ax, ay, az], [bx, by, bz]) => ([
		ay * bz - az * by, az * bx - ax * bz, ax * by - ay * bx
	]);
	
	const dot = (a, b) => a.reduce((s, c, i) => s + c * b[i], 0);
	
	const add = (a, b) => a.map((c, i) => c + b[i]);
	const sub = (a, b) => a.map((c, i) => c - b[i]);
	
	const vertOrder = [[0, 0], [0, 1], [1, 0], [1, 1]];
	
	const createSide = opts => {
		
		const {
			radius, height,
			indices, resolution,
			thresholds,
			index, localUp,
			heightmap,
			vertBox, uvBox,
			onGeometry,
		} = opts;
		
		let subdivs    = null;
		let isDetailed = false;
		let isOffsite  = false;
		
		const thresholdOffset = thresholds[0] * 0.1;
		
		const {
			resolution : heightmapRes = 1,
			at         : heightmapAt = 0,
			step       : heightmapStep = 4,
			data       : heightmapData = Uint8Array.from([0]),
		} = heightmap;
		
		const avgR  = radius + height * 0.5;
		const axisA = [localUp[1], localUp[2], localUp[0]];
		const axisB = cross(localUp, axisA);
		
		const resDivisor = 1 / resolution;
		
		const vertSize = sub(vertBox[1], vertBox[0]);
		const uvSize   = sub(uvBox[1], uvBox[0]);
		const vertStep = scale(vertSize, resDivisor * 0.5);
		
		// Landscape and skirts
		const vertexNum = resolution * resolution + 2 * resolution + 1 + resolution * 4 + 4;
		
		const vertices = new Float32Array(vertexNum * 3);
		const normals  = new Float32Array(vertexNum * 3);
		const uvs      = new Float32Array(vertexNum * 2);
		
		const calcRel = (box, x, y) => [
			lerp1(box[0][0], box[1][0], x * resDivisor),
			lerp1(box[0][1], box[1][1], y * resDivisor),
		];
		
		const getHeight = ([x, y]) => {
			const iu = Math.min(heightmapRes - 1, Math.floor(x * heightmapRes));
			const iv = Math.min(heightmapRes - 1, Math.floor(y * heightmapRes));
			const idx = (iv * heightmapRes + iu) * heightmapStep + heightmapAt;
			return heightmap.data[idx] * height;
		};
		
		let occupied = 0;
		const addVert = ({ uv, norm, vert }) => {
			const current3f = occupied * 3;
			const current2f = occupied * 2;
			uvs.set(uv, current2f);
			normals.set(norm, current3f);
			vertices.set(vert, current3f);
			occupied++;
		};
		
		const calcNorm = (a, b) => normalize(
			add(add(localUp, scale(axisA, a)), scale(axisB, b))
		);
		
		for (let y = 0; y <= resolution; y++) {
			for (let x = 0; x <= resolution; x++) {
				const rvert = calcRel(vertBox, x, y);
				const uv = calcRel(uvBox, x, y);
				const norm = calcNorm(rvert[0], rvert[1]);
				const vert = scale(norm, radius + getHeight(uv));
				addVert({ uv, norm, vert });
			}
		}
		
		for (let x = 0; x <= resolution; x++) {
			const rvert0 = lerp1(vertBox[0][0], vertBox[1][0], x * resDivisor);
			const uv = calcRel(uvBox, x, 1);
			const uv0 = calcRel(uvBox, x, 0);
			const norm = calcNorm(rvert0, vertBox[0][1]);
			const vert = scale(norm, (radius + getHeight(uv0)) * (1 - vertStep[1]));
			addVert({ uv, norm, vert });
		}
		
		for (let y = 0; y <= resolution; y++) {
			const rvert1 = lerp1(vertBox[0][1], vertBox[1][1], y * resDivisor);
			const uv = calcRel(uvBox, resolution - 1, y);
			const uv0 = calcRel(uvBox, resolution, y);
			const norm = calcNorm(vertBox[1][0], rvert1);
			const vert = scale(norm, (radius + getHeight(uv0)) * (1 - vertStep[0]));
			addVert({ uv, norm, vert });
		}
		
		for (let x = resolution; x >= 0; x--) {
			const rvert0 = lerp1(vertBox[0][0], vertBox[1][0], x * resDivisor);
			const uv = calcRel(uvBox, x, resolution - 1);
			const uv0 = calcRel(uvBox, x, resolution);
			const norm = calcNorm(rvert0, vertBox[1][1]);
			const vert = scale(norm, (radius + getHeight(uv0)) * (1 - vertStep[1]));
			addVert({ uv, norm, vert });
		}
		
		for (let y = resolution; y >= 0; y--) {
			const rvert1 = lerp1(vertBox[0][1], vertBox[1][1], y * resDivisor);
			const uv = calcRel(uvBox, 1, y);
			const uv0 = calcRel(uvBox, 0, y);
			const norm = calcNorm(vertBox[0][0], rvert1);
			const vert = scale(norm, (radius + getHeight(uv0)) * (1 - vertStep[0]));
			addVert({ uv, norm, vert });
		}
		
		const vertCenter = add(vertBox[0], scale(vertSize, 0.5));
		const center = scale(
			normalize(add(
				add(localUp, scale(axisA, vertCenter[0])),
				scale(axisB, vertCenter[1])
			)),
			avgR
		);
		
		const {
			getChunkPos,
			getPlanetPos,
			getCameraPos,
			setVisible,
		} = onGeometry({ indices, vertices, normals, uvs, index, center });
		
		const getSubdivs = () => {
			
			if (subdivs) {
				return subdivs;
			}
			
			const thresholdsNew = thresholds.slice(1);
			
			const vertHalfSize = scale(vertSize, 0.5);
			const uvHalfSize = scale(uvSize, 0.5);
			
			subdivs = [
				{
					vertBox: [vertBox[0], add(vertBox[0], vertHalfSize)],
					uvBox: [uvBox[0], add(uvBox[0], uvHalfSize)],
				},
				{
					vertBox: [sub(vertBox[1], vertHalfSize), vertBox[1]],
					uvBox: [sub(uvBox[1], uvHalfSize), uvBox[1]],
				},
				{
					vertBox: [
						add(vertBox[0], [vertHalfSize[0], 0]),
						[vertBox[1][0], vertBox[0][1] + vertHalfSize[1]],
					],
					uvBox: [
						add(uvBox[0], [uvHalfSize[0], 0]),
						[uvBox[1][0], uvBox[0][1] + uvHalfSize[1]],
					],
				},
				{
					vertBox: [
						add(vertBox[0], [0, vertHalfSize[1]]),
						[vertBox[0][0] + vertHalfSize[0], vertBox[1][1]],
					],
					uvBox: [
						add(uvBox[0], [0, uvHalfSize[1]]),
						[uvBox[0][0] + uvHalfSize[0], uvBox[1][1]],
					],
				},
			].map(boxes => createSide(Object.assign({}, opts, boxes, {
				thresholds: thresholdsNew,
			})));
			
			return subdivs;
			
		};
		
		const vertMin = scale(calcNorm(vertBox[0][0], vertBox[0][1]), avgR);
		const vertMax = scale(calcNorm(vertBox[1][0], vertBox[0][1]), avgR);
		const sideStep = length(sub(vertMax, vertMin)) * 0.5;
		
		return {
			setVisible: v => {
				setVisible(v);
				if (subdivs && ! v) {
					subdivs.forEach(plane => plane.setVisible(false));
				}
			},
			update() {
				
				const [threshold] = thresholds;
				
				if ( ! threshold ) {
					return;
				}
				
				const centerPos = getChunkPos();
				const cameraPos = getCameraPos();
				const planetPos = getPlanetPos();
				
				if (vertSize[0] < 1) {
					
					const localCenter = normalize(sub(centerPos, planetPos));
					const localCamera = normalize(sub(cameraPos, planetPos));
					const d = dot(localCenter, localCamera)
					
					if (d < 0 && ! isOffsite) {
						setVisible(false);
						isOffsite = true;
						isDetailed = false;
						getSubdivs().forEach(plane => {
							plane.setVisible(false);
						});
					} else if (d > 0 && isOffsite) {
						setVisible(true);
						isOffsite = false;
					}
					
					if (isOffsite) {
						return;
					}
				}
				
				const dist = length(sub(centerPos, cameraPos)) - sideStep;
				
				if ( ! isDetailed && dist < threshold - thresholdOffset ) {
					
					setVisible(false);
					isDetailed = true;
					getSubdivs().forEach(plane => {
						plane.setVisible(true);
						plane.update();
					});
					
				} else if (isDetailed && dist > threshold + thresholdOffset) {
					
					setVisible(true);
					isDetailed = false;
					getSubdivs().forEach(plane => {
						plane.update();
						plane.setVisible(false);
					});
					
				} else if (isDetailed) {
					
					getSubdivs().forEach(plane => plane.update());
					
				}
				
			},
		};
		
	};
	
	
	const geogen = opts => {
		
		const emptyMap = { resolution: 1, data: Uint8Array.from([0]), at: 0, step: 4 };
		
		const defaultOpts = {
			radius     : 500,
			height     : 100 / 255,
			thresholds : [1300, 900, 700, 400, 200],
			resolution : 16, // int
			heightmaps : [emptyMap, emptyMap, emptyMap, emptyMap, emptyMap, emptyMap],
		};
		
		const finalOpts = Object.assign({}, defaultOpts, opts);
		
		const { resolution } = finalOpts;
		
		// 6 = a quad. res^2 quads are the surface, and res*4 are the skirts
		// const 4 extras are skirt edge duplicates, needed for correct uvs
		const indexNum = 6 * resolution * (resolution + 4) + 4;
		const indices  = new Uint16Array(indexNum);
		
		let ioccupied = 0;
		const resolution1  = resolution + 1;
		const resolution12 = resolution1 * resolution1;
		
		for (let y = 0; y < resolution; y++) {
			for (let x = 0; x < resolution; x++) {
				const i = y * resolution1 + x;
				indices[ioccupied++] = i;
				indices[ioccupied++] = i + resolution1 + 1;
				indices[ioccupied++] = i + resolution1;
				indices[ioccupied++] = i;
				indices[ioccupied++] = i + 1;
				indices[ioccupied++] = i + resolution1 + 1;
			}
		}
		
		const stripes = [
			{ b: 0, k: 1 },
			{ b: resolution, k: resolution1 },
			{ b: resolution12 - 1, k: -1 },
			{ b: resolution1 * resolution, k: -resolution1 },
		].map(({ b, k }) => {
			const stripe = [];
			for (let x = 0; x < resolution1; x++) {
				stripe.push(k * x + b);
			}
			return stripe;
		}).map((stripe, i) => {
			for (let x = 0; x < resolution1; x++) {
				stripe.push(resolution12 + i * resolution1 + x);
			}
			return stripe;
		}).forEach(stripe => {
			for (let i = 0; i < resolution; i++) {
				indices[ioccupied++] = stripe[i];
				indices[ioccupied++] = stripe[i + resolution1];
				indices[ioccupied++] = stripe[i + resolution1 + 1];
				indices[ioccupied++] = stripe[i];
				indices[ioccupied++] = stripe[i + resolution1 + 1];
				indices[ioccupied++] = stripe[i + 1];
			}
		});
		
		const planes = [
			[1, 0, 0], [-1, 0, 0],
			[0, 1, 0], [0, -1, 0],
			[0, 0, 1], [0, 0, -1],
		].map((localUp, index) => {
			const heightmap = finalOpts.heightmaps[index];
			return createSide(Object.assign({}, finalOpts, {
				index,
				indices,
				localUp,
				heightmap,
				vertBox : [[-1, -1], [1, 1]],
				uvBox   : [[0, 0], [1, 1]],
			}));
		});
		
		return {
			update() {
				planes.forEach(plane => plane.update());
			},
		};
		
	};
	
	
	if (typeof process !== 'undefined' && typeof module !== 'undefined' && module.exports) {
		module.exports = geogen;
	} else {
		window.geogen = geogen;
	}
	
})();
