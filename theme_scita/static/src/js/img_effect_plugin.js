import { Plugin } from "@html_editor/plugin";
import { BuilderAction } from "@html_builder/core/builder_action";
import { BaseOptionComponent } from "@html_builder/core/base_option_component";
import { registry } from "@web/core/registry";
import { patch } from "@web/core/utils/patch";
import {
    MediaSizeSliderAction,
    MediaSizeTextAction,
    SetMediaSizeAutoAction,
} from "@html_builder/plugins/image/media_size_option_plugin";

export const IMG_EFFECTS = ["sct_img_effect1", "sct_img_effect2", "sct_img_effect3", "sct_img_effect4", "sct_img_effect5"];
const WRAP = "sct_img_effect_wrap";
// classes describing where an image sits: the span around it gets the same ones
const PLACEMENT_CLASSES = ["mx-auto", "d-block", "float-start", "float-end", "me-auto", "ms-auto", "w-100"];

/**
 * "Image Transition Effect" (Scita 17/18 option, back for the Odoo 20 editor): one of the
 * `sct_img_effect1..5` hover effects on an image or on a block with a background image.
 *
 * The effect classes need a box around the picture (their overlay is a ::before, which an
 * <img> cannot have): the grid cell of a grid image, else a thin span put around the image.
 * The span copies the image's alignment, and takes its % width (a % of the image inside the
 * span would be a % of the span): the image then fills the span, and the image "Size" option
 * reads the span's width. Both also when they change later. A promo banner keeps its effect on
 * its link (`.promo-block-main`), as in its snippet.
 */
export class ScitaImgEffectPlugin extends Plugin {
    static id = "scitaImgEffect";
    static shared = ["getBox"];
    resources = {
        builder_actions: { ScitaImgEffectAction },
        normalize_processors: (root) => {
            const wrappers = [...root.querySelectorAll(`span.${WRAP}`)];
            const parentWrapper = root.closest?.(`span.${WRAP}`);
            if (parentWrapper) {
                wrappers.push(parentWrapper);
            }
            for (const wrapper of wrappers) {
                this.syncWrapper(wrapper);
            }
            return root;
        },
    };

    /** Give the span around an image the image's alignment and (% of the parent) width. */
    syncWrapper(wrapper) {
        const img = wrapper.querySelector(":scope > img");
        if (!img) {
            // the image was deleted or replaced by an icon / a video: no effect box left
            wrapper.replaceWith(...wrapper.childNodes);
            return;
        }
        for (const className of PLACEMENT_CLASSES) {
            if (wrapper.classList.contains(className) !== img.classList.contains(className)) {
                wrapper.classList.toggle(className);
            }
        }
        const width = img.style.width;
        if (width.endsWith("%")) {
            // set by the Size option: the span gets it, the image fills the span
            wrapper.style.width = width;
            img.style.removeProperty("width");
        } else if (width) {
            // a px or auto width stays on the image, the span follows it
            wrapper.style.removeProperty("width");
        }
        // a full width image (also when a stylesheet makes it so) keeps a full width box
        const parent = wrapper.parentElement;
        const parentStyle = this.window.getComputedStyle(parent);
        const parentWidth = parent.clientWidth - parseFloat(parentStyle.paddingLeft) - parseFloat(parentStyle.paddingRight);
        const isBlock = !!wrapper.style.width || img.matches(".d-block, .w-100") || this.window.getComputedStyle(img).display === "block"
            || (parentWidth > 0 && img.getBoundingClientRect().width >= parentWidth - 1);
        if (wrapper.classList.contains(`${WRAP}_block`) !== isBlock) {
            wrapper.classList.toggle(`${WRAP}_block`);
        }
    }

    /**
     * Element carrying the effect class of `el` (an image or a background-image block).
     * @param {HTMLElement} el
     * @param {boolean} create wrap the image when it has no box yet
     */
    getBox(el, create = false) {
        if (el.tagName !== "IMG") {
            return el.querySelector(":scope > .promo-block-main") || el;
        }
        const parent = el.parentElement;
        const hasEffect = (node) => IMG_EFFECTS.some((effect) => node.classList.contains(effect));
        // Scita 17/18 put the class on the image and on its parent (any element)
        if (parent.classList.contains(WRAP) || parent.matches(".o_grid_item_image") || (hasEffect(el) && hasEffect(parent))) {
            return parent;
        }
        if (!create) {
            return null;
        }
        const wrapper = this.document.createElement("span");
        wrapper.className = WRAP;
        el.before(wrapper);
        wrapper.append(el);
        this.syncWrapper(wrapper);
        return wrapper;
    }
}

export class ScitaImgEffectAction extends BuilderAction {
    static id = "scitaImgEffect";
    static dependencies = ["scitaImgEffect"];
    apply({ editingElement, params: { mainParam: className } }) {
        const plugin = this.dependencies.scitaImgEffect;
        const box = plugin.getBox(editingElement, !!className);
        if (!box) {
            return;
        }
        box.classList.remove(...IMG_EFFECTS);
        editingElement.classList.remove(...IMG_EFFECTS);
        // Scita 17/18 image: the image keeps the same class as its parent (how it is recognised)
        const legacyImg = editingElement.tagName === "IMG" && box === editingElement.parentElement
            && !box.matches(`.${WRAP}, .o_grid_item_image`);
        if (className) {
            box.classList.add(className);
            if (legacyImg) {
                editingElement.classList.add(className);
            }
        } else if (box.classList.contains(WRAP)) {
            if (box.style.width && !editingElement.style.width) {
                editingElement.style.width = box.style.width;
            }
            box.replaceWith(...box.childNodes);
        }
    }
    isApplied({ editingElement, params: { mainParam: className } }) {
        const box = this.dependencies.scitaImgEffect.getBox(editingElement);
        const current = (box && IMG_EFFECTS.find((effect) => box.classList.contains(effect))) || "";
        return current === className;
    }
}

export class ScitaImgEffectOption extends BaseOptionComponent {
    static id = "scita_img_effect_option";
    static template = "theme_scita.ImgEffectOption";
}

/** Blocks with a background image: Zoom (effect 4) zooms an <img>, so it is not offered. */
export class ScitaImgEffectBgOption extends BaseOptionComponent {
    static id = "scita_img_effect_bg_option";
    static template = "theme_scita.ImgEffectBgOption";
}

/** The image "Size" option: an image with an effect has its % width on its span. */
const wrapperWidth = (img) => img.parentElement?.matches(`span.${WRAP}`) && img.parentElement.style.width;
for (const Action of [MediaSizeSliderAction, MediaSizeTextAction]) {
    patch(Action.prototype, {
        getValue({ editingElement }) {
            return wrapperWidth(editingElement) || super.getValue(...arguments);
        },
    });
}
patch(SetMediaSizeAutoAction.prototype, {
    isApplied({ editingElement }) {
        return !wrapperWidth(editingElement) && super.isApplied(...arguments);
    },
});

registry.category("website-plugins").add(ScitaImgEffectPlugin.id, ScitaImgEffectPlugin);
registry.category("website-options")
    .add(ScitaImgEffectOption.id, ScitaImgEffectOption)
    .add(ScitaImgEffectBgOption.id, ScitaImgEffectBgOption);
