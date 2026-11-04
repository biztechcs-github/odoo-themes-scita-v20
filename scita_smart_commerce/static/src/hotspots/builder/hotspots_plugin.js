import { Plugin } from "@html_editor/plugin";
import { BuilderAction } from "@html_builder/core/builder_action";
import { registry } from "@web/core/registry";
import { _t } from "@web/core/l10n/translation";
import { patch } from "@web/core/utils/patch";
import { ImageAlignClassAction } from "@html_builder/plugins/image/image_tool_option_plugin";
import {
    MediaSizeSliderAction,
    MediaSizeTextAction,
    SetMediaSizeAutoAction,
} from "@html_builder/plugins/image/media_size_option_plugin";

const SPOT = ".o_scita_hotspot";
const AREA = ".o_scita_hotspots";
// Theme Scita's "Image Transition Effect" box around an image
const EFFECT_WRAP = "sct_img_effect_wrap";
// classes describing where an image sits: they move to the wrapper so the image stays in place
const PLACEMENT_CLASSES = ["mx-auto", "d-block", "float-start", "float-end", "me-auto", "ms-auto", "w-100"];

const clamp = (value) => Math.min(98, Math.max(2, Math.round(value * 10) / 10));

// A hotspot's own position on mobile (screens under 992px, as the editor's mobile preview): two
// CSS variables used by `.o_scita_hotspot_m_pos` there (hotspots.scss), its inline left / top
// staying the desktop position.
const MOBILE_POS = "o_scita_hotspot_m_pos";
const mobileVar = (property) => `--scita-hotspot-m-${property}`;
/** Left or top (number, in %) of a hotspot: on mobile, its mobile one when it has one. */
function getSpotPosition(spot, property, isMobile) {
    const value = isMobile && spot.classList.contains(MOBILE_POS)
        ? spot.style.getPropertyValue(mobileVar(property))
        : spot.style[property];
    const number = parseFloat(value);
    return Number.isFinite(number) ? number : 50;
}
/** Move a hotspot on desktop, or on mobile only (its first mobile move copies the desktop position). */
function setSpotPosition(spot, property, percent, isMobile) {
    if (!isMobile) {
        spot.style[property] = `${percent}%`;
        return;
    }
    if (!spot.classList.contains(MOBILE_POS)) {
        for (const prop of ["left", "top"]) {
            spot.style.setProperty(mobileVar(prop), `${getSpotPosition(spot, prop, false)}%`);
        }
        spot.classList.add(MOBILE_POS);
    }
    spot.style.setProperty(mobileVar(property), `${percent}%`);
}
/** Back to the desktop position on mobile. */
function resetMobilePosition(spot) {
    spot.classList.remove(MOBILE_POS);
    spot.style.removeProperty(mobileVar("left"));
    spot.style.removeProperty(mobileVar("top"));
}

/**
 * Product hotspots on any image of any block, in the website editor.
 *
 * "Add hotspot" (image or background-image block options) shows a crosshair over the image:
 * the next click there creates a hotspot exactly at that point and selects it, so its product
 * can be picked. Hotspots can then be dragged, or positioned in % from their options.
 *
 * The hotspots live in a `.o_scita_hotspots` area: the block itself for a background image,
 * the grid cell of a grid image, or a thin wrapper put around an <img> on its first hotspot.
 */
export class ScitaHotspotsPlugin extends Plugin {
    static id = "scitaHotspots";
    static dependencies = ["history", "builderOptions"];
    static shared = ["startPlacing", "getArea"];
    /** @type {import("plugins").WebsiteResources} */
    resources = {
        builder_actions: {
            ScitaHotspotsAddAction,
            ScitaHotspotsStyleAction,
            ScitaHotspotProductAction,
            ScitaHotspotPositionAction,
            ScitaHotspotMobileResetAction,
        },
        // the hotspot options show the desktop or the mobile position: refresh them
        on_mobile_view_switched_handlers: () => {
            const target = this.dependencies.builderOptions.getTarget();
            if (target?.isConnected && target.matches(SPOT)) {
                this.dependencies.builderOptions.updateContainers(target, { forceUpdate: true });
            }
        },
        // hotspots are not text: no caret, no typing in them
        content_not_editable_selectors: SPOT,
        // the open-card state of the website page is never saved (a saved one left a dot
        // highlighted on every visit)
        clean_for_save_processors: (root) => {
            for (const spot of root.querySelectorAll(SPOT)) {
                spot.classList.remove("o_scita_hotspot_active");
                spot.removeAttribute("aria-expanded");
            }
            return root;
        },
    };

    setup() {
        this.drag = null;
        this.draggedSpot = null;
        this.placing = null;
        this.addDomListener(this.editable, "pointerdown", this.onPointerDown);
        this.addDomListener(this.editable, "pointermove", this.onPointerMove);
        this.addDomListener(this.editable, "pointerup", this.onPointerUp);
        this.addDomListener(this.editable, "pointercancel", this.onPointerUp);
        // the click that ends a drag must not select what is under the hotspot (the image)
        this.addDomListener(this.editable, "click", this.onClickAfterDrag, true);
        this.addGlobalDomListener("keydown", (ev) => ev.key === "Escape" && this.stopPlacing());
    }

    destroy() {
        clearTimeout(this.clickTimer);
        this.stopPlacing();
        super.destroy();
    }

    // ------------------------------------------------------------ area

    /**
     * Hotspot area of an image or background-image element.
     * @param {HTMLElement} el `img` or element with a background image
     * @param {boolean} create create it (wrap the image) when missing
     */
    getArea(el, create = false) {
        if (el.matches(AREA)) {
            return el;
        }
        if (el.tagName !== "IMG") {
            if (create) {
                el.classList.add("o_scita_hotspots");
                return el;
            }
            return null;
        }
        // image with Scita's "Image Transition Effect": the area goes around the effect box (it
        // hides what overflows it: the hotspot cards)
        const effectEl = el.parentElement.matches(`span.${EFFECT_WRAP}`) ? el.parentElement : null;
        const imageEl = effectEl || el;
        // linked image: the area goes around the link, so that the hotspots are not inside it
        // (a click on a hotspot must open its card, not follow the link)
        const linkEl = imageEl.parentElement.matches("a") && this.isOnlyContent(imageEl.parentElement, imageEl)
            ? imageEl.parentElement : null;
        const box = linkEl || imageEl;
        const parent = box.parentElement;
        if (parent.matches(`span${AREA}`)) {
            return parent;
        }
        if (!linkEl && parent.matches(".o_grid_item_image")) {
            // the image fills its grid cell: the cell is the area (no wrapper in a grid)
            if (create) {
                parent.classList.add("o_scita_hotspots");
            }
            return parent.matches(AREA) ? parent : null;
        }
        if (!create) {
            return null;
        }
        const wrapper = this.document.createElement("span");
        wrapper.className = "o_scita_hotspots";
        const display = this.window.getComputedStyle(el).display;
        // full width image (also when a stylesheet gives it `width: 100%`): keep it full width
        const parentStyle = this.window.getComputedStyle(parent);
        const parentWidth = parent.clientWidth - parseFloat(parentStyle.paddingLeft) - parseFloat(parentStyle.paddingRight);
        const fillsParent = parentWidth > 0 && el.getBoundingClientRect().width >= parentWidth - 1;
        if (display === "block" || el.classList.contains("w-100") || fillsParent) {
            wrapper.classList.add("o_scita_hotspots_block");
        }
        for (const className of PLACEMENT_CLASSES) {
            if (el.classList.contains(className)) {
                el.classList.remove(className);
                effectEl?.classList.remove(className);
                wrapper.classList.add(className);
            }
        }
        for (const sizedEl of [el, effectEl]) {
            if (sizedEl?.style.width.endsWith("%")) {
                // a % width is relative to the parent: keep it on the wrapper
                wrapper.style.width = sizedEl.style.width;
                sizedEl.style.width = "100%";
            }
        }
        box.before(wrapper);
        wrapper.append(box);
        return wrapper;
    }

    /** Whether `child` is the only content of `parentEl` (ignoring whitespace). */
    isOnlyContent(parentEl, child) {
        return [...parentEl.childNodes].every(
            (node) => node === child || (node.nodeType === Node.TEXT_NODE && !node.textContent.trim())
        );
    }

    // ------------------------------------------------------------ "Add hotspot": click to place

    startPlacing(targetEl) {
        this.stopPlacing();
        const overlay = this.document.createElement("div");
        overlay.className = "o_scita_hotspot_placer o_we_no_overlay";
        Object.assign(overlay.style, {
            position: "fixed",
            zIndex: "1050",
            cursor: "crosshair",
            outline: "3px dashed #714b67",
            outlineOffset: "-3px",
            background: "rgba(113, 75, 103, 0.08)",
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "center",
        });
        const hint = this.document.createElement("span");
        hint.textContent = _t("Click where the hotspot goes (Esc to cancel)");
        Object.assign(hint.style, {
            margin: "8px",
            padding: "4px 10px",
            borderRadius: "4px",
            background: "rgba(0, 0, 0, 0.75)",
            color: "#fff",
            font: "13px/1.4 sans-serif",
            pointerEvents: "none",
        });
        overlay.append(hint);
        this.document.body.append(overlay);
        this.placing = { targetEl, overlay };
        this.positionPlacer();
        overlay.addEventListener("click", this.onPlace.bind(this));
        this.placerListeners = ["scroll", "resize"].map((type) => {
            const fn = () => this.positionPlacer();
            this.window.addEventListener(type, fn, true);
            return () => this.window.removeEventListener(type, fn, true);
        });
    }

    positionPlacer() {
        if (!this.placing) {
            return;
        }
        const rect = this.placing.targetEl.getBoundingClientRect();
        Object.assign(this.placing.overlay.style, {
            left: `${rect.left}px`,
            top: `${rect.top}px`,
            width: `${rect.width}px`,
            height: `${rect.height}px`,
        });
    }

    stopPlacing() {
        if (!this.placing) {
            return;
        }
        this.placing.overlay.remove();
        this.placerListeners?.forEach((remove) => remove());
        this.placing = null;
    }

    onPlace(ev) {
        ev.preventDefault();
        ev.stopPropagation();
        const { targetEl } = this.placing;
        const rect = targetEl.getBoundingClientRect();
        const x = clamp(((ev.clientX - rect.left) / rect.width) * 100);
        const y = clamp(((ev.clientY - rect.top) / rect.height) * 100);
        this.stopPlacing();
        const area = this.getArea(targetEl, true);
        const spot = this.document.createElement("span");
        spot.className = "o_scita_hotspot o_not_editable";
        spot.setAttribute("role", "button");
        spot.setAttribute("tabindex", "0");
        spot.dataset.name = _t("Hotspot");
        spot.style.left = `${x}%`;
        spot.style.top = `${y}%`;
        area.append(spot);
        this.dependencies.history.commit();
        this.dependencies.builderOptions.updateContainers(spot, { forceUpdate: true });
    }

    // ------------------------------------------------------------ drag a hotspot

    onPointerDown(ev) {
        const spot = ev.target.closest?.(SPOT);
        const area = spot?.closest(AREA);
        if (!spot || !area || ev.button !== 0) {
            return;
        }
        this.drag = { spot, area, startX: ev.clientX, startY: ev.clientY, moved: false, pointerId: ev.pointerId };
    }

    onPointerMove(ev) {
        const drag = this.drag;
        if (!drag || ev.pointerId !== drag.pointerId) {
            return;
        }
        if (ev.pointerType === "mouse" && !(ev.buttons & 1)) {
            // the button was released without a pointerup reaching the page (outside the frame,
            // over the options panel...): the drag is over, the hotspot must not follow the mouse
            this.onPointerUp(ev);
            return;
        }
        if (!drag.moved && Math.hypot(ev.clientX - drag.startX, ev.clientY - drag.startY) < 4) {
            return; // a click, not a drag: let the editor select the hotspot
        }
        if (!drag.moved) {
            drag.moved = true;
            drag.spot.setPointerCapture?.(ev.pointerId);
        }
        ev.preventDefault();
        // positions are relative to the image (wrapper / cell / block); in the mobile preview,
        // the mobile position only
        const rect = drag.area.getBoundingClientRect();
        const isMobile = this.config.isMobileView(drag.spot);
        setSpotPosition(drag.spot, "left", clamp(((ev.clientX - rect.left) / rect.width) * 100), isMobile);
        setSpotPosition(drag.spot, "top", clamp(((ev.clientY - rect.top) / rect.height) * 100), isMobile);
    }

    onPointerUp(ev) {
        const drag = this.drag;
        this.drag = null;
        if (!drag || !drag.moved) {
            return;
        }
        drag.spot.releasePointerCapture?.(ev.pointerId);
        this.dependencies.history.commit();
        this.dependencies.builderOptions.updateContainers(drag.spot, { forceUpdate: true });
        this.draggedSpot = drag.spot;
        // no click follows a cancelled pointer: don't swallow an unrelated later click
        this.clickTimer = setTimeout(() => (this.draggedSpot = null), 400);
    }

    onClickAfterDrag(ev) {
        const spot = this.draggedSpot;
        if (!spot) {
            return;
        }
        this.draggedSpot = null;
        clearTimeout(this.clickTimer);
        ev.preventDefault();
        ev.stopImmediatePropagation();
        this.dependencies.builderOptions.updateContainers(spot, { forceUpdate: true });
    }
}

/** "Add hotspot": wait for a click on the image to place the hotspot there. */
export class ScitaHotspotsAddAction extends BuilderAction {
    static id = "scitaHotspotsAdd";
    static dependencies = ["scitaHotspots"];
    apply({ editingElement }) {
        this.dependencies.scitaHotspots.startPlacing(editingElement);
    }
}

/** Dot style of the hotspots of an image (class on its hotspot area). */
export class ScitaHotspotsStyleAction extends BuilderAction {
    static id = "scitaHotspotsStyle";
    static dependencies = ["scitaHotspots"];
    apply({ editingElement, params: { mainParam: className } }) {
        const area = this.dependencies.scitaHotspots.getArea(editingElement);
        area?.classList.remove("o_scita_hotspots_number", "o_scita_hotspots_dot");
        if (area && className) {
            area.classList.add(className);
        }
    }
    isApplied({ editingElement, params: { mainParam: className } }) {
        const area = this.dependencies.scitaHotspots.getArea(editingElement);
        if (!area) {
            return !className;
        }
        return className
            ? area.classList.contains(className)
            : !area.matches(".o_scita_hotspots_number, .o_scita_hotspots_dot");
    }
}

/** The product a hotspot points to (product.template), with its name as editor tooltip. */
export class ScitaHotspotProductAction extends BuilderAction {
    static id = "scitaHotspotProduct";
    apply({ editingElement, value }) {
        const { id, display_name: name } = JSON.parse(value);
        editingElement.dataset.productTemplateId = id;
        editingElement.setAttribute("title", name || "");
        editingElement.setAttribute("aria-label", name || "");
    }
    clean({ editingElement }) {
        delete editingElement.dataset.productTemplateId;
        editingElement.removeAttribute("title");
        editingElement.removeAttribute("aria-label");
    }
    getValue({ editingElement }) {
        const id = parseInt(editingElement.dataset.productTemplateId);
        return id ? JSON.stringify({ id }) : undefined;
    }
}

/**
 * Hotspot position (`left` / `top`, in % of the image). The generic styleAction reads the
 * computed value in px and converts it against the wrong box, so read the inline %.
 * In the mobile preview: the mobile position (the desktop one does not change).
 */
export class ScitaHotspotPositionAction extends BuilderAction {
    static id = "scitaHotspotPosition";
    apply({ editingElement, params: { mainParam: property }, value }) {
        const number = parseFloat(value);
        const isMobile = this.config.isMobileView(editingElement);
        setSpotPosition(editingElement, property, clamp(Number.isFinite(number) ? number : 50), isMobile);
    }
    getValue({ editingElement, params: { mainParam: property } }) {
        return String(getSpotPosition(editingElement, property, this.config.isMobileView(editingElement)));
    }
}

/** "Same as desktop": the hotspot loses its mobile position. */
export class ScitaHotspotMobileResetAction extends BuilderAction {
    static id = "scitaHotspotMobileReset";
    apply({ editingElement }) {
        resetMobilePosition(editingElement);
    }
    isApplied() {
        return false;
    }
}

/**
 * The image "Alignment" and "Size" options of an image with hotspots: they apply to its hotspot
 * area (the image fills it). On the image, the area kept its first place and size: the image
 * moved or shrank inside it, away from its hotspots.
 */
const spanArea = (img) => (img.tagName === "IMG" && img.closest(`span${AREA}`)) || null;
const areaInnerEls = (img, area) => {
    const els = [];
    for (let el = img; el && el !== area; el = el.parentElement) {
        els.push(el);
    }
    return els;
};
patch(ImageAlignClassAction.prototype, {
    apply({ editingElement, params: { mainParam: classNames } }) {
        super.apply(...arguments);
        const area = spanArea(editingElement);
        if (!area) {
            return;
        }
        for (const el of [area, ...areaInnerEls(editingElement, area)]) {
            el.classList.remove(...PLACEMENT_CLASSES);
        }
        if (classNames) {
            area.classList.add(...classNames.split(" "));
        }
        // the editor's mark of a floated child (o-float-end-parent...), left when no longer floated
        for (const floatClass of ["float-start", "float-end"]) {
            if (!area.classList.contains(floatClass)) {
                area.parentElement.classList.remove(`o-${floatClass}-parent`);
            }
        }
    },
    isApplied({ editingElement, params: { mainParam: classNames } }) {
        const area = spanArea(editingElement);
        if (!area) {
            return super.isApplied(...arguments);
        }
        const names = classNames ? classNames.split(" ") : [];
        return names.length
            ? names.every((className) => area.classList.contains(className))
            : !["mx-auto", "float-start", "float-end"].some((className) => area.classList.contains(className));
    },
});
/** Width of the area, the image (and its effect box / link) filling it. */
function setAreaWidth(img, area, width) {
    area.style.width = width;
    for (const el of areaInnerEls(img, area)) {
        el.style.removeProperty("width");
    }
    if (width) {
        // the effect box when there is one (it would take the image's width anyway), else the image
        const innerEl = img.parentElement.matches(`span.${EFFECT_WRAP}`) ? img.parentElement : img;
        innerEl.style.width = "100%";
    }
}
for (const Action of [MediaSizeSliderAction, MediaSizeTextAction]) {
    patch(Action.prototype, {
        getValue({ editingElement }) {
            const area = spanArea(editingElement);
            // the option reads the area's width as it reads an image's (only its style.width)
            return super.getValue(area ? { editingElement: { style: { width: area.style.width } } } : arguments[0]);
        },
        apply({ editingElement, value }) {
            const area = spanArea(editingElement);
            if (!area) {
                return super.apply(...arguments);
            }
            const width = value ? `${value}`.trim() : "";
            setAreaWidth(editingElement, area, /^[\d.]+$/.test(width) ? `${width}%` : width);
        },
    });
}
patch(SetMediaSizeAutoAction.prototype, {
    isApplied({ editingElement }) {
        const area = spanArea(editingElement);
        return area ? !area.style.width || area.style.width === "auto" : super.isApplied(...arguments);
    },
    apply({ editingElement }) {
        const area = spanArea(editingElement);
        return area ? setAreaWidth(editingElement, area, "") : super.apply(...arguments);
    },
    clean({ editingElement }) {
        const area = spanArea(editingElement);
        return area ? setAreaWidth(editingElement, area, "100%") : super.clean(...arguments);
    },
});

registry.category("website-plugins").add(ScitaHotspotsPlugin.id, ScitaHotspotsPlugin);
