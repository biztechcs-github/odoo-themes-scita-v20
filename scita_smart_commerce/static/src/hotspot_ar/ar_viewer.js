import { _t } from "@web/core/l10n/translation";
import { renderToElement } from "@web/core/utils/render";

// Vendored @google/model-viewer (self-contained ES module, ~1 MB). Kept out of the
// asset bundles and injected on the first 3D/AR open only.
const MODEL_VIEWER_SRC = "/scita_smart_commerce/static/lib/model-viewer/model-viewer.min.js";
let modelViewerPromise = null;

export function loadModelViewer() {
    if (window.customElements.get("model-viewer")) {
        return Promise.resolve();
    }
    if (!modelViewerPromise) {
        modelViewerPromise = new Promise((resolve, reject) => {
            const script = document.createElement("script");
            script.type = "module";
            script.src = MODEL_VIEWER_SRC;
            script.dataset.scitaModelViewer = "1";
            script.onerror = () => {
                modelViewerPromise = null;
                script.remove();
                reject(new Error("model-viewer failed to load"));
            };
            document.head.appendChild(script);
            window.customElements.whenDefined("model-viewer").then(resolve);
        });
    }
    return modelViewerPromise;
}

let arSupportPromise = null;

/**
 * Best-effort "can this device place the model in the room" check, done without
 * loading model-viewer: iOS AR Quick Look (<a rel="ar">), Android (Scene Viewer
 * via intent) or a WebXR immersive-ar session.
 */
export function detectArSupport() {
    if (!arSupportPromise) {
        arSupportPromise = (async () => {
            const anchor = document.createElement("a");
            if (anchor.relList?.supports?.("ar")) {
                return true; // iOS / iPadOS Safari: AR Quick Look
            }
            if (/android/i.test(navigator.userAgent)) {
                return true; // Scene Viewer
            }
            try {
                return Boolean(await navigator.xr?.isSessionSupported?.("immersive-ar"));
            } catch {
                return false;
            }
        })();
    }
    return arSupportPromise;
}

export function arButtonLabel(arSupported) {
    return arSupported ? _t("View it in your room") : _t("View in 3D");
}

/**
 * Open the 3D / AR viewer modal.
 *
 * @param {{name: string, glb: string, usdz?: string, poster?: string}} product
 */
let viewerOpen = false;

export async function openArViewer(product) {
    if (viewerOpen) {
        return; // double click: one viewer at a time
    }
    viewerOpen = true;
    const opener = document.activeElement;
    let arSupported = false;
    try {
        arSupported = await detectArSupport();
    } catch {
        // keep the 3D viewer
    }
    const modalEl = renderToElement("scita_smart_commerce.ArViewerModal", {
        name: product.name,
        arSupported,
    });
    document.body.appendChild(modalEl);
    const modal = new window.Modal(modalEl);
    // Bootstrap only reacts to Escape on the modal element itself, and ignores
    // hide() while the opening transition runs: close it wherever the focus is
    // (once shown), and keep the key from reaching the card behind
    let shown = false;
    let closeWhenShown = false;
    const onKeydown = (ev) => {
        if (ev.key === "Escape") {
            ev.stopPropagation();
            if (shown) {
                modal.hide();
            } else {
                closeWhenShown = true;
            }
        }
    };
    document.addEventListener("keydown", onKeydown, true);
    modalEl.addEventListener("shown.bs.modal", () => {
        shown = true;
        if (closeWhenShown) {
            modal.hide();
        } else if (!modalEl.contains(document.activeElement)) {
            modalEl.querySelector(".btn-close").focus();
        }
    });
    modalEl.addEventListener("hidden.bs.modal", () => {
        viewerOpen = false;
        document.removeEventListener("keydown", onKeydown, true);
        modal.dispose();
        modalEl.remove();
        if (opener?.isConnected) {
            opener.focus();
        }
    });
    modal.show();

    const stage = modalEl.querySelector(".o_scita_ar_stage");
    const status = modalEl.querySelector(".o_scita_ar_status");
    try {
        await loadModelViewer();
    } catch {
        status.textContent = _t("The 3D viewer could not be loaded. Please try again later.");
        return;
    }
    if (!modalEl.isConnected) {
        return; // closed while loading
    }
    const viewer = document.createElement("model-viewer");
    const absolute = (url) => url && new URL(url, window.location.origin).href;
    viewer.setAttribute("src", absolute(product.glb));
    if (product.usdz) {
        viewer.setAttribute("ios-src", absolute(product.usdz));
    }
    if (product.poster) {
        viewer.setAttribute("poster", product.poster);
    }
    viewer.setAttribute("alt", product.name);
    viewer.setAttribute("camera-controls", "");
    viewer.setAttribute("auto-rotate", "");
    viewer.setAttribute("shadow-intensity", "1");
    viewer.setAttribute("touch-action", "pan-y");
    viewer.setAttribute("ar", "");
    viewer.setAttribute("ar-modes", "webxr scene-viewer quick-look");
    // real-size models (e.g. created from a photo) must not be resized by a pinch
    viewer.setAttribute("ar-scale", product.scale === "fixed" ? "fixed" : "auto");
    viewer.setAttribute("ar-placement", product.placement === "wall" ? "wall" : "floor");
    viewer.className = "o_scita_model_viewer w-100 h-100";

    const arButton = document.createElement("button");
    arButton.type = "button";
    arButton.slot = "ar-button";
    arButton.className = "btn btn-primary o_scita_ar_activate";
    arButton.textContent = _t("View it in your room");
    viewer.appendChild(arButton);

    viewer.addEventListener("load", () => {
        status.textContent = viewer.canActivateAR
            ? _t("Drag to rotate, pinch to zoom, or place it in your room.")
            : _t("Drag to rotate, pinch to zoom. AR is not available on this device.");
    });
    viewer.addEventListener("error", () => {
        status.textContent = _t("This 3D model could not be displayed.");
    });
    stage.replaceChildren(viewer);
    status.textContent = _t("Loading 3D model...");
}
