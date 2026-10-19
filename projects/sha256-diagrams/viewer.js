(() => {
    "use strict";

    const viewer = document.querySelector("[data-rtl-viewer]");
    if (!viewer) return;

    // Bounds and hotspots use pixels in the original, unmodified PNG exports.
    // Each view clips one diagram; no blocks, signals, or wiring are redrawn.
    const sources = {
        main: { file: "sha256-diagrams/page-1.png", width: 2541, height: 2725 },
        spi: { file: "sha256-diagrams/page-3.png", width: 1074, height: 1116 }
    };
    const views = {
        top: {
            title: "Top module", parent: null, order: "First order", source: "main",
            bounds: [-18, 62, 1430, 530],
            description: "Top module: Accelerator, Preprocessing, and Interface, connected to Hash and Round Constants and an external SPI Master.",
            children: [
                { id: "accelerator", bounds: [311, 103, 290, 288] },
                { id: "preprocessing", bounds: [701, 101.5, 130, 129] },
                { id: "interface", bounds: [891, 242, 130, 129] }
            ]
        },
        accelerator: {
            title: "Accelerator", parent: "top", order: "Second order", source: "main",
            bounds: [1135, 675, 975, 340],
            description: "Accelerator: FSM and Hash Computation with START_HASH, BLOCK_VALID, PASS_DONE, ROUND_EN, LOAD_INIT, and UPDATE_HASH signals; a 512-bit padded_text input and 256-bit digest output.",
            children: [
                { id: "fsm", bounds: [1338.75, 764, 230, 230] },
                { id: "hash", bounds: [1718.75, 764, 230, 230] }
            ]
        },
        preprocessing: {
            title: "Preprocessing", parent: "top", order: "Second order", source: "main",
            bounds: [330, 765, 555, 270],
            description: "Preprocessing: Input Buffer feeds full_text to the Padding Unit. The Padding Unit also receives length and outputs padded_text.",
            children: []
        },
        interface: {
            title: "Interface", parent: "top", order: "Second order", source: "spi",
            bounds: [0, 60, 815, 420],
            description: "Interface: SPI Interface receives digest, DIGEST_VALID, MOSI, and CS, outputs MISO, and sends a 32-bit input to a FIFO. The FIFO outputs data_in and receives pop.",
            children: [{ id: "spi", bounds: [180, 80, 220, 220] }]
        },
        fsm: {
            title: "FSM", parent: "accelerator", order: "Third order", source: "main",
            bounds: [1595, 1160, 720, 720],
            description: "FSM state diagram: IDLE to LOAD on START_HASH; LOAD to ROUND on BLOCK_VALID; ROUND to UPDATE on PASS_DONE; UPDATE to DONE; DONE returns to IDLE. State outputs show LOAD_INIT, ROUND_EN, and UPDATE_HASH.",
            children: []
        },
        hash: {
            title: "Hash Computation", parent: "accelerator", order: "Third order", source: "main",
            bounds: [225, 1474, 1125, 470],
            description: "Hash Computation: Message Scheduler, hash state mux, middle of round hash selection, Data Compression, Hash Update, Hash State Registers, and Concatenate, with the original signal widths and feedback paths.",
            children: [
                { id: "scheduler", bounds: [482.75, 1521, 112, 110] },
                { id: "compression", bounds: [641.75, 1668, 112, 110] }
            ]
        },
        spi: {
            title: "SPI Interface", parent: "interface", order: "Third order", source: "spi",
            bounds: [220, 675, 854, 441],
            description: "SPI Interface: Input Shift Register receives MOSI and outputs a 32-bit input; CS is shown separately. Output Shift Register receives a 256-bit digest and DIGEST_VALID, and outputs MISO.",
            children: []
        },
        scheduler: {
            title: "Message Scheduler", parent: "hash", order: "Fourth order", source: "main",
            bounds: [280, 2190, 1050, 535],
            description: "Message Scheduler: a 512-bit Padded Block enters the W Word Buffer. Sigma0, Sigma1, and the Schedule Adder form W[t] from W[t-16], W[t-15], W[t-7], and W[t-2], with feedback and a 32-bit output to a register.",
            children: []
        },
        compression: {
            title: "Data Compression", parent: "hash", order: "Fourth order", source: "main",
            bounds: [1510, 2255, 1031, 425],
            description: "Data Compression: k[i], W[i], and a-h feedback enter the temp adder. The a-h assignments block selects hash_init or var_next using LOAD_INIT, and drives the 256-bit register and a-h output.",
            children: []
        }
    };

    const find = (name) => viewer.querySelector(`[data-${name}]`);
    const viewport = find("viewport");
    const stage = find("stage");
    const diagram = find("diagram");
    const diagramImage = diagram.querySelector("image");
    const hotspots = find("hotspots");
    const explore = find("explore");
    const breadcrumbs = find("breadcrumbs");
    const title = find("title");
    const up = find("up");
    const zoomIn = find("zoom-in");
    const zoomOut = find("zoom-out");
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let current = "top";
    let zoom = 1;
    let transition;

    function sizeDiagram() {
        const [, , width, height] = views[current].bounds;
        const style = getComputedStyle(viewport);
        const availableWidth = viewport.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
        const availableHeight = viewport.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
        const fit = Math.min(availableWidth / width, availableHeight / height);
        stage.style.width = `${width * fit * zoom}px`;
        stage.style.height = `${height * fit * zoom}px`;
        zoomOut.disabled = zoom <= 1;
        zoomIn.disabled = zoom >= 4;
        find("zoom-label").textContent = `${Math.round(zoom * 100)}%`;
    }

    function setZoom(value) {
        const frame = viewport.getBoundingClientRect();
        const before = stage.getBoundingClientRect();
        const midpointX = frame.left + viewport.clientLeft + viewport.clientWidth / 2;
        const midpointY = frame.top + viewport.clientTop + viewport.clientHeight / 2;
        const centerX = (midpointX - before.left) / before.width;
        const centerY = (midpointY - before.top) / before.height;
        zoom = Math.max(1, Math.min(4, value));
        sizeDiagram();
        // Keep the same portion of the diagram in view when magnifying it.
        const after = stage.getBoundingClientRect();
        viewport.scrollLeft += after.left + centerX * after.width - midpointX;
        viewport.scrollTop += after.top + centerY * after.height - midpointY;
    }

    function moduleButton(id, className) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = className;
        button.dataset.module = id;
        button.setAttribute("aria-label", `Explore ${views[id].title}`);
        button.addEventListener("click", () => show(id));
        return button;
    }

    function show(id, moveFocus = true) {
        const previous = current;
        const view = views[id];
        const source = sources[view.source];
        current = id;
        zoom = 1;
        title.textContent = view.title;
        find("order").textContent = view.order;
        up.disabled = !view.parent;
        up.title = view.parent ? `Return to ${views[view.parent].title}` : "Viewing the top module";
        diagram.setAttribute("viewBox", view.bounds.join(" "));
        diagram.setAttribute("aria-label", view.description);
        diagramImage.setAttribute("href", source.file);
        diagramImage.setAttribute("width", source.width);
        diagramImage.setAttribute("height", source.height);

        const path = [];
        for (let ancestor = id; ancestor; ancestor = views[ancestor].parent) path.unshift(ancestor);
        const list = document.createElement("ol");
        for (const ancestor of path) {
            const item = document.createElement("li");
            const control = document.createElement(ancestor === id ? "span" : "button");
            control.textContent = views[ancestor].title;
            if (ancestor === id) {
                control.setAttribute("aria-current", "location");
            } else {
                control.type = "button";
                control.addEventListener("click", () => show(ancestor));
            }
            item.append(control);
            list.append(item);
        }
        breadcrumbs.replaceChildren(list);
        hotspots.replaceChildren();
        explore.replaceChildren();
        const label = document.createElement(view.children.length ? "span" : "p");
        label.textContent = view.children.length ? "Explore:" : "No further diagrams in this module.";
        explore.append(label);
        const [x, y, width, height] = view.bounds;
        for (const child of view.children) {
            const [left, top, childWidth, childHeight] = child.bounds;
            const hotspot = moduleButton(child.id, "rtl-hotspot");
            hotspot.title = `Explore ${views[child.id].title}`;
            hotspot.style.left = `${(left - x) / width * 100}%`;
            hotspot.style.top = `${(top - y) / height * 100}%`;
            hotspot.style.width = `${childWidth / width * 100}%`;
            hotspot.style.height = `${childHeight / height * 100}%`;
            hotspots.append(hotspot);

            // Equivalent text controls keep small blocks easy to reach on phones.
            const shortcut = moduleButton(child.id, "rtl-module-link");
            shortcut.textContent = `${views[child.id].title} →`;
            explore.append(shortcut);
        }
        sizeDiagram();
        viewport.scrollTop = 0;
        viewport.scrollLeft = 0;
        transition?.cancel();
        if (moveFocus) {
            if (!reducedMotion.matches) {
                transition = stage.animate([
                    { opacity: 0, transform: "translateY(5px)" },
                    { opacity: 1, transform: "translateY(0)" }
                ], { duration: 180, easing: "ease-out" });
            }
            // Returning to a parent restores focus to the block just explored.
            const returnTarget = hotspots.querySelector(`[data-module="${previous}"]`);
            (returnTarget || title).focus({ preventScroll: true });
            find("status").textContent = `${view.title}. ${view.order}. ${view.children.length ? `${view.children.length} modules to explore.` : "No further diagrams."}`;
        }
    }

    up.addEventListener("click", () => {
        if (views[current].parent) show(views[current].parent);
    });
    zoomIn.addEventListener("click", () => setZoom(zoom + 0.5));
    zoomOut.addEventListener("click", () => setZoom(zoom - 0.5));
    find("fit").addEventListener("click", () => setZoom(1));
    viewer.querySelector(".rtl-toolbar").hidden = false;
    viewer.querySelector(".rtl-zoom").hidden = false;
    explore.hidden = false;
    show("top", false);
    new ResizeObserver(sizeDiagram).observe(viewport);
})();
