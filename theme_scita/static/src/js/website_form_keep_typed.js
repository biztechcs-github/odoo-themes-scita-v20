import { patch } from "@web/core/utils/patch";
import lazyloader from "@web/public/lazyloader";
import { Form } from "@website/snippets/s_website_form/form";

/**
 * Odoo's form empties its fields when it starts (values left by the browser after a redirect).
 * On phones Theme Scita loads that JS at the first touch (lazyloader_deferred.js): the visitor
 * tapped the field and was typing already, the first letters were lost ("Alex" -> "x").
 * What was typed (input events, not the browser's restored values) is kept through that reset.
 */
patch(Form.prototype, {
    async willStart() {
        this.scitaKeepTyped = true;
        try {
            return await super.willStart(...arguments);
        } finally {
            this.scitaKeepTyped = false;
        }
    },

    resetForm() {
        const typedFieldEls = this.scitaKeepTyped && lazyloader.typedFieldEls;
        const typed = typedFieldEls
            ? [...this.el.querySelectorAll("input, textarea, select")]
                  .filter((el) => typedFieldEls.has(el) && el.type !== "file")
                  .map((el) => [el, ["checkbox", "radio"].includes(el.type) ? el.checked : el.value])
            : [];
        const result = super.resetForm(...arguments);
        for (const [el, value] of typed) {
            if (typeof value === "boolean") {
                el.checked = value;
            } else {
                el.value = value;
            }
        }
        return result;
    },
});
