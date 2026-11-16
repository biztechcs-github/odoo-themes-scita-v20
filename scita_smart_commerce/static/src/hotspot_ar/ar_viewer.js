import { _t } from "@web/core/l10n/translation";
import { renderToElement } from "@web/core/utils/render";
import { rpc } from "@web/core/network/rpc";

// Vendored @google/model-viewer (self-contained ES module, ~1 MB). Kept out of the
// asset bundles and injected on the first 3D/AR open only.
const MODEL_VIEWER_SRC = "/scita_smart_commerce/static/lib/model-viewer/model-viewer.min.js";
// a slow network must end in a message, not in an endless "Loading..."
const MODEL_VIEWER_TIMEOUT = 30000;
const MODEL_TIMEOUT = 60000;
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
            const fail = () => {
                modelViewerPromise = null;
                script.remove();
                reject(new Error("model-viewer failed to load"));
            };
            const timeout = setTimeout(fail, MODEL_VIEWER_TIMEOUT);
            script.onerror = () => {
                clearTimeout(timeout);
                fail();
            };
            document.head.appendChild(script);
            window.customElements.whenDefined("model-viewer").then(() => {
                clearTimeout(timeout);
                resolve();
            });
        });
    }
    return modelViewerPromise;
}

function hasWebGL() {
    try {
        const canvas = document.createElement("canvas");
        const gl = canvas.getContext("webgl2") || canvas.getContext("webgl");
        gl?.getExtension("WEBGL_lose_context")?.loseContext(); // browsers limit live contexts
        return Boolean(gl);
    } catch {
        return false;
    }
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

// model-viewer's default view, written two ways: setting the camera to the value it already
// has does nothing, so "reset view" switches between them
const DEFAULT_ORBITS = ["0deg 75deg 105%", "0deg 75deg 105.001%"];

let viewerOpen = false;

/** The product's card (price, size, cart...) for the viewer's panel; null if unavailable. */
async function loadInfo(product, options) {
    if (options.info || !product.id) {
        return options.info || null;
    }
    try {
        const { products } = await rpc("/scita/hotspots/products", { product_ids: [product.id] });
        return products[product.id] || null;
    } catch {
        return null;
    }
}

/** The product page's own Add to cart, when the shopper can use it (variant available...). */
function productPageCartButton() {
    const button = document.querySelector("#product_detail [name='add_to_cart'], #product_detail #add_to_cart");
    return button && button.offsetParent && !button.disabled && !button.classList.contains("disabled")
        ? button
        : null;
}

/** QR code of the product page, opening the viewer there: to continue on a phone (AR). */
function qrCodeUrl(productUrl) {
    const target = new URL(productUrl, window.location.origin);
    target.searchParams.set("scita_3d", "1");
    return `/report/barcode/?barcode_type=QR&value=${encodeURIComponent(target.href)}&width=192&height=192`;
}

/**
 * Open the 3D / AR viewer: the model with its toolbar, and a panel with the product's price,
 * size, "view it in your room" (AR on phones, else a QR code to continue on a phone) and
 * add to cart. Full screen on phones.
 *
 * @param {{id?: number, name: string, glb: string, usdz?: string, poster?: string,
 *          placement?: string, scale?: string}} product (id: product.template)
 * @param {Object} [options]
 * @param {Object} [options.info] the product's card (/scita/hotspots/products), if the caller has it
 * @param {Function} [options.addToCart] async (button) => adds the product to the cart
 * @param {boolean} [options.onProductPage] opened on the product page: Add to cart is the
 *     page's own (chosen variant and quantity) and there is no link back to the page
 */
export async function openArViewer(product, options = {}) {
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
    const infoPromise = loadInfo(product, options);
    const modalEl = renderToElement("scita_smart_commerce.ArViewerModal", { name: product.name });
    document.body.appendChild(modalEl);
    const modal = new window.Modal(modalEl);
    const contentEl = modalEl.querySelector(".modal-content");
    const status = modalEl.querySelector(".o_scita_ar_status");
    const toolbar = modalEl.querySelector(".o_scita_ar_toolbar");
    let viewer = null;
    let initialFov = null;
    let orbitIndex = 0;
    let addToCartAfterClose = false;

    // Bootstrap only reacts to Escape on the modal element itself, and ignores
    // hide() while the opening transition runs: close it wherever the focus is
    // (once shown), and keep the key from reaching the card behind
    let shown = false;
    let closeWhenShown = false;
    const onKeydown = (ev) => {
        if (ev.key === "Escape" && !document.fullscreenElement) {
            ev.stopPropagation();
            if (shown) {
                modal.hide();
            } else {
                closeWhenShown = true;
            }
        }
    };
    const fullscreenButton = toolbar.querySelector("[data-action='fullscreen']");
    const onFullscreenChange = () => {
        const active = document.fullscreenElement === contentEl;
        fullscreenButton.setAttribute("aria-pressed", String(active));
        fullscreenButton.classList.toggle("active", active);
    };
    document.addEventListener("keydown", onKeydown, true);
    document.addEventListener("fullscreenchange", onFullscreenChange);
    modalEl.addEventListener("shown.bs.modal", () => {
        shown = true;
        if (closeWhenShown) {
            modal.hide();
        } else if (!modalEl.contains(document.activeElement)) {
            modalEl.querySelector(".o_scita_ar_close").focus();
        }
    });
    modalEl.addEventListener("hide.bs.modal", () => {
        if (document.fullscreenElement === contentEl) {
            document.exitFullscreen().catch(() => {});
        }
    });
    modalEl.addEventListener("hidden.bs.modal", () => {
        viewerOpen = false;
        document.removeEventListener("keydown", onKeydown, true);
        document.removeEventListener("fullscreenchange", onFullscreenChange);
        modal.dispose();
        modalEl.remove();
        if (addToCartAfterClose) {
            productPageCartButton()?.click(); // the page's own add to cart (chosen variant)
        } else if (opener?.isConnected) {
            opener.focus();
        }
    });
    modal.show();

    if (!document.fullscreenEnabled) {
        fullscreenButton.remove();
    }
    toolbar.addEventListener("click", (ev) => {
        const tool = ev.target.closest(".o_scita_ar_tool");
        if (!tool || !viewer) {
            return;
        }
        const action = tool.dataset.action;
        if (action === "rotate") {
            const rotate = !viewer.hasAttribute("auto-rotate");
            viewer.toggleAttribute("auto-rotate", rotate);
            tool.setAttribute("aria-pressed", String(rotate));
            tool.classList.toggle("active", rotate);
        } else if (action === "zoom-in" || action === "zoom-out") {
            viewer.zoom(action === "zoom-in" ? 1 : -1);
        } else if (action === "reset") {
            orbitIndex = 1 - orbitIndex;
            viewer.cameraOrbit = DEFAULT_ORBITS[orbitIndex];
            if (initialFov) {
                viewer.fieldOfView = `${initialFov + orbitIndex * 0.001}deg`;
            }
            viewer.resetTurntableRotation?.();
        } else if (action === "fullscreen") {
            if (document.fullscreenElement) {
                document.exitFullscreen().catch(() => {});
            } else {
                contentEl.requestFullscreen().catch(() => {});
            }
        }
    });

    // product panel: price, size, AR / QR code, add to cart
    infoPromise.then((info) => {
        if (!modalEl.isConnected) {
            return;
        }
        const cartMode = Boolean(info && !info.hide_price && (options.onProductPage
            ? productPageCartButton()
            : info.can_add_to_cart && options.addToCart));
        modalEl.querySelector(".o_scita_ar_category").textContent = info?.category || "";
        const details = renderToElement("scita_smart_commerce.ArViewerPanel", {
            info,
            arSupported,
            cartMode,
            onProductPage: Boolean(options.onProductPage),
            qrUrl: !arSupported && info?.url ? qrCodeUrl(info.url) : "",
        });
        modalEl.querySelector(".o_scita_ar_details").replaceChildren(details);
        const roomButton = details.querySelector(".o_scita_ar_room");
        if (roomButton) {
            roomButton.disabled = !viewer?.loaded;
            if (viewer?.loaded) {
                roomButton.classList.toggle("d-none", !viewer.canActivateAR);
            }
            roomButton.addEventListener("click", () => viewer?.activateAR());
        }
        details.querySelector(".o_scita_ar_cart")?.addEventListener("click", async (ev) => {
            if (options.onProductPage) {
                addToCartAfterClose = true;
                modal.hide();
            } else {
                await options.addToCart(ev.currentTarget);
            }
        });
    });

    const stage = modalEl.querySelector(".o_scita_ar_stage");
    const modelFailed = () => {
        status.textContent = _t("This 3D model could not be displayed.");
    };
    if (!hasWebGL()) {
        modelFailed();
        return;
    }
    try {
        await loadModelViewer();
    } catch {
        status.textContent = _t("The 3D viewer could not be loaded. Please try again later.");
        return;
    }
    if (!modalEl.isConnected) {
        return; // closed while loading
    }
    viewer = document.createElement("model-viewer");
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
    viewer.setAttribute("camera-orbit", DEFAULT_ORBITS[0]);
    viewer.setAttribute("auto-rotate", "");
    viewer.setAttribute("shadow-intensity", "1");
    viewer.setAttribute("touch-action", "pan-y");
    viewer.setAttribute("ar", "");
    viewer.setAttribute("ar-modes", "webxr scene-viewer quick-look");
    // real-size models (e.g. created from a photo) must not be resized by a pinch
    viewer.setAttribute("ar-scale", product.scale === "fixed" ? "fixed" : "auto");
    viewer.setAttribute("ar-placement", product.placement === "wall" ? "wall" : "floor");
    viewer.className = "o_scita_model_viewer";
    // AR starts from the panel's "View it in your room": no button of model-viewer's own
    const arSlot = document.createElement("span");
    arSlot.slot = "ar-button";
    arSlot.hidden = true;
    viewer.appendChild(arSlot);

    const modelTimeout = setTimeout(modelFailed, MODEL_TIMEOUT);
    viewer.addEventListener("load", () => {
        clearTimeout(modelTimeout);
        initialFov = viewer.getFieldOfView?.() || null;
        toolbar.classList.remove("d-none");
        status.textContent = window.matchMedia("(pointer: coarse)").matches
            ? _t("Drag to rotate · Pinch to zoom")
            : _t("Drag to rotate · Scroll to zoom");
        const roomButton = modalEl.querySelector(".o_scita_ar_room");
        if (roomButton) {
            // the device check is a guess: model-viewer knows
            roomButton.disabled = false;
            roomButton.classList.toggle("d-none", !viewer.canActivateAR);
        }
    });
    viewer.addEventListener("error", () => {
        clearTimeout(modelTimeout);
        modelFailed();
    });
    stage.replaceChildren(viewer);
    status.textContent = _t("Loading 3D model...");
}
