/* global THREE */
window.diceInterop = (function () {
    let scene, camera, renderer, diceMeshes = [], animationId = null, dotNetRef = null;
    let camDist = 16, camYaw = 0.35, camPitch = 0.48;
    let dragActive = false, lastPointerX = 0, lastPointerY = 0;
    let pinchStartDist = 0, pinchStartCamDist = 16;
    let activePointers = new Map();

    const COLORS = [
        0xe74c3c, 0x3498db, 0x2ecc71, 0xf39c12, 0x9b59b6,
        0x1abc9c, 0xe67e22, 0x34495e, 0x16a085, 0xc0392b
    ];

    function colorHex(color) {
        return '#' + color.toString(16).padStart(6, '0');
    }

    function createNumberTexture(number, bgHex) {
        const size = 256;
        const c = document.createElement('canvas');
        c.width = size;
        c.height = size;
        const ctx = c.getContext('2d');
        ctx.fillStyle = bgHex;
        ctx.fillRect(0, 0, size, size);
        ctx.fillStyle = '#ffffff';
        const fontSize = number >= 100 ? size * 0.22 : number >= 10 ? size * 0.3 : size * 0.42;
        ctx.font = 'bold ' + fontSize + 'px Arial,sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(number), size / 2, size / 2);
        const tex = new THREE.CanvasTexture(c);
        tex.anisotropy = 4;
        tex.needsUpdate = true;
        if (THREE.SRGBColorSpace) {
            tex.colorSpace = THREE.SRGBColorSpace;
        }
        return tex;
    }

    function dieMaterial(faceNum, bgHex) {
        return new THREE.MeshBasicMaterial({
            map: createNumberTexture(faceNum, bgHex)
        });
    }

    function triangleNormal(pos, triIdx) {
        const i = triIdx * 3;
        const vA = new THREE.Vector3().fromBufferAttribute(pos, i);
        const vB = new THREE.Vector3().fromBufferAttribute(pos, i + 1);
        const vC = new THREE.Vector3().fromBufferAttribute(pos, i + 2);
        return vC.clone().sub(vB).cross(vA.clone().sub(vB)).normalize();
    }

    function triangleCenter(pos, triIdx) {
        const i = triIdx * 3;
        const vA = new THREE.Vector3().fromBufferAttribute(pos, i);
        const vB = new THREE.Vector3().fromBufferAttribute(pos, i + 1);
        const vC = new THREE.Vector3().fromBufferAttribute(pos, i + 2);
        return vA.clone().add(vB).add(vC).multiplyScalar(1 / 3);
    }

    function mergeClustersToSideCount(clusters, sides) {
        if (!sides || clusters.length <= sides) return clusters;
        const slots = fibonacciNormals(sides);
        const merged = [];
        for (let s = 0; s < sides; s++) {
            merged.push({ triangles: [], normal: new THREE.Vector3(), weight: 0 });
        }
        clusters.forEach(function (c) {
            let best = 0;
            let bestDot = -Infinity;
            for (let s = 0; s < sides; s++) {
                const d = c.normal.dot(slots[s]);
                if (d > bestDot) {
                    bestDot = d;
                    best = s;
                }
            }
            merged[best].triangles.push.apply(merged[best].triangles, c.triangles);
            merged[best].normal.add(c.normal);
            merged[best].weight++;
        });
        return merged
            .filter(function (m) { return m.triangles.length > 0; })
            .map(function (m) {
                return {
                    triangles: m.triangles,
                    normal: m.normal.clone().normalize()
                };
            });
    }

    function splitGeometryForFaceTextures(geometry, targetSides) {
        const src = geometry.index !== null ? geometry.toNonIndexed() : geometry.clone();
        const pos = src.attributes.position;
        const triCount = pos.count / 3;
        const triData = [];

        for (let t = 0; t < triCount; t++) {
            triData.push({
                idx: t,
                normal: triangleNormal(pos, t),
                center: triangleCenter(pos, t)
            });
        }

        const clusters = [];
        const used = new Array(triCount).fill(false);

        for (let t = 0; t < triCount; t++) {
            if (used[t]) continue;
            const cluster = [t];
            used[t] = true;
            const ref = triData[t];
            for (let u = t + 1; u < triCount; u++) {
                if (used[u]) continue;
                const other = triData[u];
                if (ref.normal.dot(other.normal) > 0.99) {
                    const delta = other.center.clone().sub(ref.center);
                    if (Math.abs(delta.dot(ref.normal)) < 0.05) {
                        cluster.push(u);
                        used[u] = true;
                    }
                }
            }
            let normal = ref.normal.clone();
            if (normal.dot(ref.center) < 0) normal.negate();
            clusters.push({ triangles: cluster, normal: normal });
        }

        if (targetSides) {
            clusters = mergeClustersToSideCount(clusters, targetSides);
        }

        const positions = [];
        const normals = [];
        const uvs = [];
        const groups = [];
        let offset = 0;

        clusters.forEach(function (cluster, faceIdx) {
            groups.push({ start: offset, count: cluster.triangles.length * 3, materialIndex: faceIdx });

            const n = cluster.normal;
            const tangent = Math.abs(n.y) < 0.9
                ? new THREE.Vector3(0, 1, 0).cross(n).normalize()
                : new THREE.Vector3(1, 0, 0).cross(n).normalize();
            const bitangent = n.clone().cross(tangent);

            const projected = [];
            cluster.triangles.forEach(function (triIdx) {
                const base = triIdx * 3;
                for (let k = 0; k < 3; k++) {
                    const v = new THREE.Vector3(
                        pos.getX(base + k),
                        pos.getY(base + k),
                        pos.getZ(base + k)
                    );
                    projected.push({
                        v: v,
                        u: v.dot(tangent),
                        vv: v.dot(bitangent)
                    });
                }
            });

            if (projected.length === 3) {
                const triUvs = [[0.5, 0.9], [0.1, 0.15], [0.9, 0.15]];
                projected.forEach(function (p, idx) {
                    positions.push(p.v.x, p.v.y, p.v.z);
                    normals.push(n.x, n.y, n.z);
                    uvs.push(triUvs[idx][0], triUvs[idx][1]);
                    offset++;
                });
            } else {
                let centU = 0;
                let centV = 0;
                projected.forEach(function (p) {
                    centU += p.u;
                    centV += p.vv;
                });
                centU /= projected.length;
                centV /= projected.length;

                let maxExt = 0.001;
                projected.forEach(function (p) {
                    maxExt = Math.max(maxExt, Math.abs(p.u - centU), Math.abs(p.vv - centV));
                });
                const scale = 0.42 / maxExt;

                projected.forEach(function (p) {
                    positions.push(p.v.x, p.v.y, p.v.z);
                    normals.push(n.x, n.y, n.z);
                    uvs.push(0.5 + (p.u - centU) * scale, 0.5 + (p.vv - centV) * scale);
                    offset++;
                });
            }
        });

        const result = new THREE.BufferGeometry();
        result.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        result.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
        result.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
        result.clearGroups();
        groups.forEach(function (g) {
            result.addGroup(g.start, g.count, g.materialIndex);
        });

        return {
            geometry: result,
            faceCount: clusters.length,
            faceNormals: clusters.map(function (c) { return c.normal; })
        };
    }

    function icosahedronDetailForSides(sides) {
        const levels = [20, 80, 180, 260, 320];
        for (let d = 0; d < levels.length; d++) {
            if (levels[d] >= sides) return d;
        }
        return levels.length - 1;
    }

    function fibonacciNormals(count) {
        const normals = [];
        const golden = Math.PI * (3 - Math.sqrt(5));
        for (let i = 0; i < count; i++) {
            const y = 1 - (i / Math.max(count - 1, 1)) * 2;
            const r = Math.sqrt(Math.max(0, 1 - y * y));
            const theta = golden * i;
            normals.push(new THREE.Vector3(Math.cos(theta) * r, y, Math.sin(theta) * r).normalize());
        }
        return normals;
    }

    function sortBySpherical(normalEntries) {
        normalEntries.sort(function (a, b) {
            const phiA = Math.acos(Math.max(-1, Math.min(1, a.n.y)));
            const phiB = Math.acos(Math.max(-1, Math.min(1, b.n.y)));
            if (Math.abs(phiA - phiB) > 0.001) return phiA - phiB;
            const thetaA = Math.atan2(a.n.z, a.n.x);
            const thetaB = Math.atan2(b.n.z, b.n.x);
            return thetaA - thetaB;
        });
    }

    function numberForD6Normal(n) {
        const nx = n.x, ny = n.y, nz = n.z;
        if (ny > 0.5) return 1;
        if (ny < -0.5) return 6;
        if (nx > 0.5) return 2;
        if (nx < -0.5) return 5;
        if (nz > 0.5) return 3;
        if (nz < -0.5) return 4;
        return 1;
    }

    function assignFaceNumbers(faceNormals, sides) {
        const count = faceNormals.length;
        const numbers = new Array(count);

        if (sides === 6 && count === 6) {
            faceNormals.forEach(function (n, i) {
                numbers[i] = numberForD6Normal(n);
            });
            return numbers;
        }

        const indexed = faceNormals.map(function (n, i) {
            return { i: i, n: n.clone().normalize() };
        });

        if (count === sides) {
            sortBySpherical(indexed);
            indexed.forEach(function (item, rank) {
                numbers[item.i] = rank + 1;
            });
            return numbers;
        }

        if (count > sides) {
            sortBySpherical(indexed);
            indexed.forEach(function (item, rank) {
                numbers[item.i] = Math.min(rank + 1, sides);
            });
            return numbers;
        }

        sortBySpherical(indexed);
        indexed.forEach(function (item, rank) {
            numbers[item.i] = rank + 1;
        });
        return numbers;
    }

    function buildNumberedMesh(geometry, sides, color) {
        const bgHex = colorHex(color);
        const split = splitGeometryForFaceTextures(geometry, sides);
        const faceCount = split.faceCount;
        const faceNumbers = assignFaceNumbers(split.faceNormals, sides);
        const materials = [];

        for (let i = 0; i < faceCount; i++) {
            materials.push(dieMaterial(faceNumbers[i], bgHex));
        }

        const mesh = new THREE.Mesh(split.geometry, materials);
        mesh.userData.faceNormals = split.faceNormals;
        mesh.userData.faceNumbers = faceNumbers;
        return mesh;
    }

    function buildPrismMesh(segments, sides, color) {
        const bgHex = colorHex(color);
        const geometry = new THREE.CylinderGeometry(0.75, 0.75, 0.55, segments);
        const split = splitGeometryForFaceTextures(geometry);
        const sideEntries = [];
        split.faceNormals.forEach(function (n, i) {
            if (Math.abs(n.y) < 0.5) {
                sideEntries.push({ i: i, angle: Math.atan2(n.z, n.x) });
            }
        });
        sideEntries.sort(function (a, b) { return a.angle - b.angle; });
        const faceNumbers = new Array(split.faceCount).fill(0);
        sideEntries.forEach(function (entry, rank) {
            faceNumbers[entry.i] = rank + 1;
        });

        const materials = [];
        for (let i = 0; i < split.faceCount; i++) {
            if (faceNumbers[i] > 0) {
                materials.push(dieMaterial(faceNumbers[i], bgHex));
            } else {
                materials.push(new THREE.MeshStandardMaterial({ color: color, metalness: 0.15, roughness: 0.45 }));
            }
        }

        const mesh = new THREE.Mesh(split.geometry, materials);
        const numberedNormals = [];
        const numberedValues = [];
        sideEntries.forEach(function (entry, rank) {
            numberedNormals.push(split.faceNormals[entry.i].clone());
            numberedValues.push(rank + 1);
        });
        mesh.userData.faceNormals = numberedNormals;
        mesh.userData.faceNumbers = numberedValues;
        return mesh;
    }

    function createD1Mesh(color) {
        const bgHex = colorHex(color);
        const mesh = new THREE.Mesh(
            new THREE.SphereGeometry(0.85, 32, 16),
            dieMaterial(1, bgHex)
        );
        mesh.userData.faceNormals = [new THREE.Vector3(0, 1, 0)];
        mesh.userData.faceNumbers = [1];
        return mesh;
    }

    function updateCamera() {
        if (!camera) return;
        const x = camDist * Math.cos(camPitch) * Math.sin(camYaw);
        const y = camDist * Math.sin(camPitch) + 2;
        const z = camDist * Math.cos(camPitch) * Math.cos(camYaw);
        camera.position.set(x, y, z);
        camera.lookAt(0, 0.3, 0);
    }

    function setupControls(canvas) {
        canvas.style.touchAction = 'none';
        canvas.style.cursor = 'grab';

        canvas.addEventListener('wheel', function (e) {
            e.preventDefault();
            camDist = Math.max(6, Math.min(35, camDist + e.deltaY * 0.012));
            updateCamera();
        }, { passive: false });

        canvas.addEventListener('pointerdown', function (e) {
            if (e.pointerType === 'mouse' && e.button !== 0) return;
            activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
            if (activePointers.size === 1) {
                dragActive = true;
                lastPointerX = e.clientX;
                lastPointerY = e.clientY;
                canvas.setPointerCapture(e.pointerId);
                canvas.style.cursor = 'grabbing';
            } else if (activePointers.size === 2) {
                dragActive = false;
                const pts = Array.from(activePointers.values());
                pinchStartDist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
                pinchStartCamDist = camDist;
            }
        });

        canvas.addEventListener('pointermove', function (e) {
            if (!activePointers.has(e.pointerId)) return;
            activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

            if (activePointers.size === 2) {
                const pts = Array.from(activePointers.values());
                const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
                if (pinchStartDist > 0) {
                    camDist = Math.max(6, Math.min(35, pinchStartCamDist * (pinchStartDist / dist)));
                    updateCamera();
                }
                return;
            }

            if (!dragActive) return;
            camYaw += (e.clientX - lastPointerX) * 0.008;
            camPitch = Math.max(-0.3, Math.min(1.1, camPitch + (e.clientY - lastPointerY) * 0.005));
            lastPointerX = e.clientX;
            lastPointerY = e.clientY;
            updateCamera();
        });

        function endPointer(e) {
            activePointers.delete(e.pointerId);
            if (activePointers.size === 1) {
                const remaining = Array.from(activePointers.values())[0];
                dragActive = true;
                lastPointerX = remaining.x;
                lastPointerY = remaining.y;
            } else {
                dragActive = false;
            }
            if (activePointers.size === 0) {
                canvas.style.cursor = 'grab';
            }
        }

        canvas.addEventListener('pointerup', endPointer);
        canvas.addEventListener('pointercancel', endPointer);
    }

    function initScene(canvas, ref) {
        dotNetRef = ref;

        function start() {
            const width = canvas.clientWidth;
            const height = canvas.clientHeight;
            if (width < 10 || height < 10) {
                requestAnimationFrame(start);
                return;
            }

            scene = new THREE.Scene();
            scene.background = new THREE.Color(0x1a1a2e);
            scene.fog = new THREE.Fog(0x1a1a2e, 12, 28);

            camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 100);
            updateCamera();

            renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: true });
            renderer.setSize(width, height, false);
            renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
            renderer.shadowMap.enabled = true;

            scene.add(new THREE.AmbientLight(0xffffff, 0.55));
            const dir = new THREE.DirectionalLight(0xffffff, 0.9);
            dir.position.set(6, 12, 8);
            dir.castShadow = true;
            scene.add(dir);

            const floor = new THREE.Mesh(
                new THREE.PlaneGeometry(30, 30),
                new THREE.MeshStandardMaterial({ color: 0x16213e, roughness: 0.85 })
            );
            floor.rotation.x = -Math.PI / 2;
            floor.position.y = -1.2;
            floor.receiveShadow = true;
            scene.add(floor);

            setupControls(canvas);
            window.addEventListener('resize', function () { resize(canvas); });
            if (typeof ResizeObserver !== 'undefined') {
                new ResizeObserver(function () { resize(canvas); }).observe(canvas);
            }
            renderLoop();
        }

        start();
    }

    function resize(canvas) {
        if (!renderer || !camera) return;
        const w = canvas.clientWidth || 800;
        const h = canvas.clientHeight || 500;
        if (w < 1 || h < 1) return;
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        renderer.setSize(w, h, false);
    }

    function renderLoop() {
        animationId = requestAnimationFrame(renderLoop);
        if (renderer && scene && camera) renderer.render(scene, camera);
    }

    function createDieMesh(sides, colorIndex) {
        const color = COLORS[colorIndex % COLORS.length];
        let mesh;

        if (sides === 1) {
            mesh = createD1Mesh(color);
        } else if (sides === 2) {
            const geometry = new THREE.CylinderGeometry(0.55, 0.55, 0.12, 32);
            const bgHex = colorHex(color);
            mesh = new THREE.Mesh(geometry, [
                new THREE.MeshStandardMaterial({ color: color, metalness: 0.15, roughness: 0.45 }),
                dieMaterial(1, bgHex),
                dieMaterial(2, bgHex)
            ]);
            mesh.userData.faceNormals = [
                new THREE.Vector3(0, 1, 0),
                new THREE.Vector3(0, -1, 0)
            ];
            mesh.userData.faceNumbers = [1, 2];
            mesh.userData.materialFaceMap = [null, 1, 2];
        } else {
            let geometry;
            switch (sides) {
                case 3: mesh = buildPrismMesh(3, 3, color); break;
                case 4: geometry = new THREE.TetrahedronGeometry(0.85); break;
                case 5: mesh = buildPrismMesh(5, 5, color); break;
                case 6: geometry = new THREE.BoxGeometry(1, 1, 1); break;
                case 8: geometry = new THREE.OctahedronGeometry(0.85); break;
                case 10: geometry = createD10Geometry(); break;
                case 12: geometry = new THREE.DodecahedronGeometry(0.85); break;
                case 20: geometry = new THREE.IcosahedronGeometry(0.85); break;
                default: geometry = new THREE.IcosahedronGeometry(0.85, icosahedronDetailForSides(sides)); break;
            }
            if (!mesh) mesh = buildNumberedMesh(geometry, sides, color);
        }

        mesh.castShadow = true;
        mesh.userData.sides = sides;
        return mesh;
    }

    function createD10Geometry() {
        const points = [];
        for (let i = 0; i < 10; i++) {
            const angle = (i / 10) * Math.PI * 2;
            points.push(new THREE.Vector2(Math.cos(angle) * 0.7, Math.sin(angle) * 0.7));
        }
        return new THREE.LatheGeometry(points, 10);
    }

    function layoutDice(count) {
        const cols = Math.ceil(Math.sqrt(count));
        const spacing = count > 6 ? 1.8 : 2.2;
        const positions = [];
        for (let i = 0; i < count; i++) {
            const row = Math.floor(i / cols);
            const col = i % cols;
            positions.push(new THREE.Vector3(
                (col - (cols - 1) / 2) * spacing,
                0.5,
                (row - (Math.ceil(count / cols) - 1) / 2) * spacing
            ));
        }
        return positions;
    }

    function rollDice(diceConfig, results) {
        clearDice();
        const positions = layoutDice(diceConfig.length);
        const promises = [];

        diceConfig.forEach(function (cfg, i) {
            const mesh = createDieMesh(cfg.sides, i);
            const value = (results[i] && results[i].value != null) ? results[i].value : 1;
            mesh.position.copy(positions[i]);
            mesh.position.y = 3 + Math.random() * 2;
            scene.add(mesh);
            diceMeshes.push(mesh);
            promises.push(animateDie(mesh, value, cfg.sides, i * 80));
        });

        return Promise.all(promises).then(function () {
            if (dotNetRef) dotNetRef.invokeMethodAsync('OnRollAnimationComplete');
        });
    }

    function animateDie(mesh, value, sides, delay) {
        return new Promise(function (resolve) {
            setTimeout(function () {
                const duration = 1400 + Math.random() * 600;
                const start = performance.now();
                const startPos = mesh.position.clone();
                const endPos = startPos.clone();
                endPos.y = 0.5;
                const spinX = (4 + Math.random() * 6) * Math.PI * 2;
                const spinY = (4 + Math.random() * 6) * Math.PI * 2;
                const spinZ = (2 + Math.random() * 4) * Math.PI * 2;
                const endRot = getRotationForValue(mesh, value);

                function tick(now) {
                    const t = Math.min((now - start) / duration, 1);
                    const ease = 1 - Math.pow(1 - t, 3);
                    mesh.position.lerpVectors(startPos, endPos, ease);
                    mesh.position.y += Math.sin(t * Math.PI) * 2.5 * (1 - t);
                    mesh.rotation.x = spinX * (1 - ease) + endRot.x * ease;
                    mesh.rotation.y = spinY * (1 - ease) + endRot.y * ease;
                    mesh.rotation.z = spinZ * (1 - ease) + endRot.z * ease;
                    if (t < 1) requestAnimationFrame(tick);
                    else { showResult(mesh, value); resolve(); }
                }
                requestAnimationFrame(tick);
            }, delay);
        });
    }

    function getRotationForValue(mesh, value) {
        const faceNumbers = mesh.userData.faceNumbers;
        const faceNormals = mesh.userData.faceNormals;
        if (!faceNumbers || !faceNormals || faceNumbers.length === 0) {
            return { x: 0, y: 0, z: 0 };
        }
        let faceIdx = -1;
        let bestY = -Infinity;
        for (let i = 0; i < faceNumbers.length; i++) {
            if (faceNumbers[i] === value && faceNormals[i].y > bestY) {
                bestY = faceNormals[i].y;
                faceIdx = i;
            }
        }
        if (faceIdx === -1) faceIdx = (value - 1) % faceNumbers.length;

        const normal = faceNormals[faceIdx].clone();
        const up = new THREE.Vector3(0, 1, 0);
        const q = new THREE.Quaternion().setFromUnitVectors(normal, up);
        const euler = new THREE.Euler().setFromQuaternion(q, 'XYZ');
        return { x: euler.x, y: euler.y, z: euler.z };
    }

    function showResult(mesh, value) {
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        const faceNumbers = mesh.userData.faceNumbers;
        const materialFaceMap = mesh.userData.materialFaceMap;
        mats.forEach(function (m, i) {
            if (!m.map) return;
            var faceNum = materialFaceMap ? materialFaceMap[i] : faceNumbers[i];
            m.color.setHex(faceNum === value ? 0xffffff : 0xbbbbbb);
        });
    }

    function clearDice() {
        diceMeshes.forEach(function (m) { scene.remove(m); });
        diceMeshes = [];
    }

    function dispose() {
        if (animationId) cancelAnimationFrame(animationId);
        clearDice();
        if (renderer) renderer.dispose();
        scene = camera = renderer = null;
    }

    return {
        initDiceScene: initScene,
        rollDiceScene: rollDice,
        clearDiceScene: clearDice,
        disposeDiceScene: dispose
    };
})();
