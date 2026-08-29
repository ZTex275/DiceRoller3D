/* global THREE */
window.diceInterop = (function () {
    let scene, camera, renderer, diceMeshes = [], animationId = null, dotNetRef = null;

    const COLORS = [
        0xe74c3c, 0x3498db, 0x2ecc71, 0xf39c12, 0x9b59b6,
        0x1abc9c, 0xe67e22, 0x34495e, 0x16a085, 0xc0392b
    ];

    function initScene(canvas, ref) {
        dotNetRef = ref;
        const width = canvas.clientWidth || 800;
        const height = canvas.clientHeight || 500;

        scene = new THREE.Scene();
        scene.background = new THREE.Color(0x1a1a2e);
        scene.fog = new THREE.Fog(0x1a1a2e, 12, 28);

        camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 100);
        camera.position.set(0, 8, 14);
        camera.lookAt(0, 0, 0);

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
        const material = new THREE.MeshStandardMaterial({
            color: color, metalness: 0.15, roughness: 0.45, flatShading: true
        });

        let geometry;
        switch (sides) {
            case 2: geometry = new THREE.CylinderGeometry(0.55, 0.55, 0.12, 32); break;
            case 4: geometry = new THREE.TetrahedronGeometry(0.85); break;
            case 6: geometry = new THREE.BoxGeometry(1, 1, 1); break;
            case 8: geometry = new THREE.OctahedronGeometry(0.85); break;
            case 10: geometry = createD10Geometry(); break;
            case 12: geometry = new THREE.DodecahedronGeometry(0.85); break;
            case 20: geometry = new THREE.IcosahedronGeometry(0.85); break;
            default: geometry = new THREE.IcosahedronGeometry(0.85, Math.min(Math.ceil(sides / 10), 2)); break;
        }

        const mesh = new THREE.Mesh(geometry, material);
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
        const spacing = 2.2;
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
                const endRot = getRotationForValue(sides, value);

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

    function getRotationForValue(sides, value) {
        const seed = (value * 137 + sides * 17) % 360;
        return { x: (seed * 0.02 + value) * 0.4, y: (seed * 0.03 + sides) * 0.5, z: (value / sides) * Math.PI * 0.25 };
    }

    function showResult(mesh, value) {
        const existing = mesh.getObjectByName('resultLabel');
        if (existing) mesh.remove(existing);
        const c = document.createElement('canvas');
        c.width = 128; c.height = 128;
        const ctx = c.getContext('2d');
        ctx.fillStyle = 'rgba(0,0,0,0.75)';
        ctx.beginPath(); ctx.arc(64, 64, 58, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 52px Arial';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(String(value), 64, 68);
        const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), transparent: true }));
        sprite.name = 'resultLabel';
        sprite.scale.set(1.2, 1.2, 1);
        sprite.position.set(0, 1.5, 0);
        mesh.add(sprite);
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
