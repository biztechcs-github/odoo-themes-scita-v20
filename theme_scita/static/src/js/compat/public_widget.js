/** @odoo-module **/
/**
 * Minimal publicWidget compatibility layer for Odoo 20.
 *
 * Odoo 20 removed `@web/legacy/js/public/public_widget` (and jQuery). Scita's
 * frontend is written as publicWidget widgets, so this module provides the
 * small part of that API the theme uses (extend/include with `_super`, an
 * `events` map, `init`/`willStart`/`start`/`destroy`, `$el`/`$target`/`el`,
 * `this.$()` and `editableMode`) and runs every widget registered in
 * `publicWidget.registry` as a real Odoo 20 Interaction. The interaction
 * service therefore starts and stops them like any core interaction,
 * including when the website editor toggles edit mode.
 *
 * jQuery itself is shipped by the theme (static/lib/jquery) and must be loaded
 * before this file.
 */

import { registry } from "@web/core/registry";
import { Interaction } from "@web/public/interaction";

const $ = window.jQuery;
const EVENT_NS = ".scitaCompat";

// ---------------------------------------------------------------------------
// Legacy class system: extend / include with `this._super`
// ---------------------------------------------------------------------------

function withSuper(fn, parentFn) {
    return function (...args) {
        const previous = this._super;
        this._super = parentFn || function () {};
        try {
            return fn.apply(this, args);
        } finally {
            this._super = previous;
        }
    };
}

function assign(target, props, parentProto) {
    for (const [key, value] of Object.entries(props)) {
        const parentValue = parentProto ? parentProto[key] : undefined;
        if (typeof value === "function" && /\b_super\b/.test(value.toString())) {
            target[key] = withSuper(value, typeof parentValue === "function" ? parentValue : null);
        } else {
            target[key] = value;
        }
    }
}

function makeClass(Parent, props) {
    function LegacyClass(...args) {
        if (typeof this.init === "function") {
            this.init(...args);
        }
    }
    LegacyClass.prototype = Object.create(Parent.prototype);
    LegacyClass.prototype.constructor = LegacyClass;
    assign(LegacyClass.prototype, props || {}, Parent.prototype);
    LegacyClass.extend = (childProps) => makeClass(LegacyClass, childProps);
    LegacyClass.include = (patchProps) => {
        // patch in place: `_super` refers to the method being replaced
        const current = Object.assign({}, LegacyClass.prototype);
        for (const [key, value] of Object.entries(patchProps)) {
            const previous = LegacyClass.prototype[key] ?? current[key];
            if (typeof value === "function" && /\b_super\b/.test(value.toString())) {
                LegacyClass.prototype[key] = withSuper(value, typeof previous === "function" ? previous : null);
            } else {
                LegacyClass.prototype[key] = value;
            }
        }
        return LegacyClass;
    };
    return LegacyClass;
}

function BaseWidget() {}
BaseWidget.prototype = {
    constructor: BaseWidget,
    selector: false,
    events: {},
    disabledInEditableMode: true,
    init(parent, options) {
        this.options = options || {};
    },
    willStart() {
        return Promise.resolve();
    },
    start() {
        return Promise.resolve();
    },
    destroy() {},
    $(selector) {
        return this.$el.find(selector);
    },
    setElement(el) {
        this.el = el;
        this.$el = $(el);
        this.$target = this.$el;
        return this;
    },
};

const Widget = makeClass(BaseWidget, {});

// ---------------------------------------------------------------------------
// Bridge: every registered widget becomes an Odoo 20 Interaction
// ---------------------------------------------------------------------------

function bindEvents(widget) {
    const events = widget.events || {};
    for (const [key, handler] of Object.entries(events)) {
        const trimmed = key.trim();
        const spaceIndex = trimmed.indexOf(" ");
        const eventName = spaceIndex === -1 ? trimmed : trimmed.slice(0, spaceIndex);
        const selector = spaceIndex === -1 ? null : trimmed.slice(spaceIndex + 1).trim();
        const fn = typeof handler === "string" ? widget[handler] : handler;
        if (typeof fn !== "function") {
            console.warn(`theme_scita: event handler "${handler}" not found for "${key}"`);
            continue;
        }
        widget.$el.on(eventName + EVENT_NS, selector || null, fn.bind(widget));
    }
}

function makeInteraction(name, WidgetClass) {
    const selector = WidgetClass.prototype.selector;

    class LegacyWidgetInteraction extends Interaction {
        static selector = selector;

        setup() {
            this.widget = new WidgetClass(null);
            // Odoo services (e.g. "public.interactions" to start interactions on inserted HTML)
            this.widget.services = this.services;
            this.widget.setElement(this.el);
            this.widget.editableMode = !!this._scitaEditMode;
            bindEvents(this.widget);
        }

        async willStart() {
            await this.widget.willStart();
        }

        start() {
            const result = this.widget.start();
            if (result && typeof result.catch === "function") {
                result.catch((error) => console.error(`theme_scita: ${name} failed to start`, error));
            }
        }

        destroy() {
            this.widget.$el.off(EVENT_NS);
            try {
                this.widget.destroy();
            } catch (error) {
                console.error(`theme_scita: ${name} failed to stop`, error);
            }
        }
    }
    Object.defineProperty(LegacyWidgetInteraction, "name", { value: `Scita_${name}` });
    return LegacyWidgetInteraction;
}

function register(name, WidgetClass) {
    if (typeof WidgetClass !== "function" || !WidgetClass.prototype.selector) {
        return; // abstract widget, nothing to start
    }
    const key = `theme_scita.${name}`;
    const I = makeInteraction(name, WidgetClass);
    registry.category("public.interactions").add(key, I, { force: true });
    if (WidgetClass.prototype.disabledInEditableMode === false) {
        registry.category("public.interactions.edit").add(
            key,
            {
                Interaction: I,
                mixin: (Base) =>
                    class extends Base {
                        setup() {
                            this._scitaEditMode = true;
                            super.setup();
                        }
                    },
            },
            { force: true }
        );
    }
}

const widgetRegistry = new Proxy(
    {},
    {
        set(target, name, value) {
            target[name] = value;
            register(String(name), value);
            return true;
        },
    }
);

// ---------------------------------------------------------------------------
// Bootstrap 5 jQuery bridge for the plugins Scita calls ($.fn.modal / popover)
// ---------------------------------------------------------------------------

function bridge(pluginName, BootstrapClass) {
    if (!BootstrapClass || $.fn[pluginName]) {
        return;
    }
    $.fn[pluginName] = function (config) {
        return this.each(function () {
            // Scita replaces a modal's inner HTML before every show; a stale instance keeps a
            // reference to the old .modal-dialog and gets stuck mid-transition (close/Escape stop
            // working on the second open). Start from a fresh instance when showing a hidden one.
            const existing = BootstrapClass.getInstance && BootstrapClass.getInstance(this);
            if (existing && config === "show" && !existing._isShown) {
                existing.dispose();
            }
            const instance = BootstrapClass.getOrCreateInstance(
                this,
                typeof config === "object" ? config : {}
            );
            if (typeof config === "string") {
                instance[config]();
            }
        });
    };
}

if ($ && window.Modal) {
    bridge("modal", window.Modal);
}
if ($ && window.Popover) {
    bridge("popover", window.Popover);
}

export default { Widget, registry: widgetRegistry };
