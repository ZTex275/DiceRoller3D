/* global THREE */
window.diceInterop = (function () {
    let scene, camera, renderer, diceMeshes = [], animationId = null, dotNetRef = null;
    let camDist = 16, camYaw = 0.35, camPitch = 0.48;
    let dragActive = false, lastPointerX = 0, lastPointerY = 0;
    let pinchStartDist = 0, pinchStartCamDist = 16;

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
        ctx.fillStyle = 'rgba(255,255,255,0.93)';
        ctx.beginPath();
        ctx.arc(size / 2, size / 2, size * 0.32, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#1a1a2e';
        const fontSize = number >= 100 ? size * 0.2 : number >= 10 ? size * 0.27 : size * 0.36;
        ctx.font = 'bold ' + fontSize + 'px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(number), size / 2, size / 2 + 2);
        const tex = new THREE.CanvasTexture(c);
        tex.anisotropy = 4;
        return tex;
    }

    function dieMaterial(sides, faceNum, bgHex) {
        return new THREE.MeshStandardMaterial({
            map: createNumberTexture(faceNum, bgHex),
            metalness: 0.15,
            roughness: 0.45,
            flatShading: true
        });
    }

    function ensureFaceGroups(geometry) {
        if (geometry.groups && geometry.groups.length > 1) {
            return geometry.groups.length;
        }
        geometry.clearGroups();
        const index = geometry.index;
        const faceCount = index ? index.count / 3 : geometry.attributes.position.count / 3;
        for (let i = 0; i < faceCount; i++) {
            geometry.addGroup(i * 3, 3, i);
        }
        return faceCount;
    }

    function extractFaceNormals(geometry) {
        geometry.computeVertexNormals();
        const pos = geometry.attributes.position;
        const index = geometry.index;
        const faceCount = index ? index.count / 3 : pos.count / 3;
        const normals = [];
        for (let i = 0; i < faceCount; i++) {
            const ia = index ? index.getX(i * 3) : i * 3;
            const ib = index ? index.getX(i * 3 + 1) : i * 3 + 1;
            const ic = index ? index.getX(i * 3 + 2) : i * 3 + 2;
            const vA = new THREE.Vector3().fromBufferAttribute(pos, ia);
            const vB = new THREE.Vector3().fromBufferAttribute(pos, ib);
            const vC = new THREE.Vector3().fromBufferAttribute(pos, ic);
            normals.push(vC.clone().sub(vB).cross(vA.clone().sub(vB)).normalize());
        }
        return normals;
    }

    function buildNumberedMesh(geometry, sides, color) {
        const bgHex = colorHex(color);
        const faceCount = ensureFaceGroups(geometry);
        const faceNormals = extractFaceNormals(geometry);
        const faceNumbers = [];
        const materials = [];
        for (let i = 0; i < faceCount; i++) {
            const num = (i % sides) + 1;
            faceNumbers.push(num);
            materials.push(dieMaterial(sides, num, bgHex));
        }
        const mesh = new THREE.Mesh(geometry, materials);
        mesh.userData.faceNormals = faceNormals;
        mesh.userData.faceNumbers = faceNumbers;
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
        function onPointerDown(x, y) {
            dragActive = true;
            lastPointerX = x;
            lastPointerY = y;
        }

        function onPointerMove(x, y) {
            if (!dragActive) return;
            camYaw += (x - lastPointerX) * 0.008;
            camPitch = Math.max(-0.3, Math.min(1.1, camPitch + (y - lastPointerY) * 0.005));
            lastPointerX = x;
            lastPointerY = y;
            updateCamera();
        }

        function onPointerUp() {
            dragActive = false;
        }

        canvas.addEventListener('wheel', function (e) {
            e.preventDefault();
            camDist = Math.max(6, Math.min(35, camDist + e.deltaY * 0.012));
            updateCamera();
        }, { passive: false });

        canvas.addEventListener('mousedown', function (e) {
            if (e.button === 0) onPointerDown(e.clientX, e.clientY);
        });
        window.addEventListener('mousemove', function (e) {
            onPointerMove(e.clientX, e.clientY);
        });
        window.addEventListener('mouseup', onPointerUp);

        canvas.addEventListener('touchstart', function (e) {
            if (e.touches.length === 1) {
                onPointerDown(e.touches[0].clientX, e.touches[0].clientY);
            } else if (e.touches.length === 2) {
                dragActive = false;
                const dx = e.touches[0].clientX - e.touches[1].clientX;
                const dy = e.touches[0].clientY - e.touches[1].clientY;
                pinchStartDist = Math.hypot(dx, dy);
                pinchStartCamDist = camDist;
            }
        }, { passive: true });

        canvas.addEventListener('touchmove', function (e) {
            if (e.touches.length === 1 && dragActive) {
                e.preventDefault();
                onPointerMove(e.touches[0].clientX, e.touches[0].clientY);
            } else if (e.touches.length === 2) {
                e.preventDefault();
                const dx = e.touches[0].clientX - e.touches[1].clientX;
                const dy = e.touches[0].clientY - e.touches[1].clientY;
                const dist = Math.hypot(dx, dy);
                camDist = Math.max(6, Math.min(35, pinchStartCamDist * (pinchStartDist / dist)));
                updateCamera();
            }
        }, { passive: false });

        canvas.addEventListener('touchend', onPointerUp);
    }

    function initScene(canvas, ref) {
        dotNetRef = ref;
        const width = canvas.clientWidth || 800;
        const height = canvas.clientHeight || 500;

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
        renderLoop();
    }

    function resize(canvas) {
        if (!renderer || !camera) return;
        const w = canvas.clientWidth || 800;
        const h = canvas.clientHeight || 500;
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

        if (sides === 2) {
            const geometry = new THREE.CylinderGeometry(0.55, 0.55, 0.12, 32);
            const bgHex = colorHex(color);
            mesh = new THREE.Mesh(geometry, [
                new THREE.MeshStandardMaterial({ color: color, metalness: 0.15, roughness: 0.45 }),
                dieMaterial(2, 1, bgHex),
                dieMaterial(2, 2, bgHex)
            ]);
            mesh.userData.faceNormals = [
                new THREE.Vector3(0, 1, 0),
                new THREE.Vector3(0, -1, 0)
            ];
            mesh.userData.faceNumbers = [1, 2];
            mesh.userData.materialFaceMap = [0, 1, 2];
        } else {
            let geometry;
            switch (sides) {
                case 4: geometry = new THREE.TetrahedronGeometry(0.85); break;
                case 6: geometry = new THREE.BoxGeometry(1, 1, 1); break;
                case 8: geometry = new THREE.OctahedronGeometry(0.85); break;
                case 10: geometry = createD10Geometry(); break;
                case 12: geometry = new THREE.DodecahedronGeometry(0.85); break;
                case 20: geometry = new THREE.IcosahedronGeometry(0.85); break;
                default: geometry = new THREE.IcosahedronGeometry(0.85, Math.min(Math.ceil(sides / 10), 2)); break;
            }
            mesh = buildNumberedMesh(geometry, sides, color);
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
            mesh.position.copy(positions[i]);
            mesh.position.y = 3 + Math.random() * 2;
            scene.add(mesh);
            diceMeshes.push(mesh);
            promises.push(animateDie(mesh, results[i].value, cfg.sides, i * 80));
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
        let faceIdx = -1;
        for (let i = 0; i < faceNumbers.length; i++) {
            if (faceNumbers[i] === value) { faceIdx = i; break; }
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
            if (!m.emissive) return;
            var faceNum = materialFaceMap ? materialFaceMap[i] : faceNumbers[i];
            m.emissive.setHex(faceNum === value ? 0x333333 : 0x000000);
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
