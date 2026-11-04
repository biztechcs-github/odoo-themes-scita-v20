import { BaseOptionComponent } from "@html_builder/core/base_option_component";
import { useDomState } from "@html_builder/core/utils";
import { registry } from "@web/core/registry";
import { useService } from "@web/core/utils/hooks";

/** "Hotspots" of an image or of a block with a background image. */
export class ScitaHotspotsOption extends BaseOptionComponent {
    static id = "scita_hotspots_option";
    static template = "scita_smart_commerce.HotspotsOption";
    static dependencies = ["scitaHotspots"];

    setup() {
        super.setup();
        this.domState = useDomState((editingElement) => {
            const area = this.dependencies.scitaHotspots.getArea(editingElement);
            return { count: area ? area.querySelectorAll(":scope > .o_scita_hotspot").length : 0 };
        });
    }
}

/** Same options for blocks with a background image (banners, carousel slides...). */
export class ScitaHotspotsBgOption extends ScitaHotspotsOption {
    static id = "scita_hotspots_bg_option";
}

/** One hotspot: its product, the devices showing it and its position (desktop / mobile). */
export class ScitaHotspotOption extends BaseOptionComponent {
    static id = "scita_hotspot_option";
    static template = "scita_smart_commerce.HotspotOption";

    setup() {
        super.setup();
        this.website = useService("website");
        // which position the Position row edits: the desktop one, or (mobile preview) the mobile one
        this.domState = useDomState((editingElement) => ({
            isMobile: this.env.editor.config.isMobileView(editingElement),
            hasMobilePosition: editingElement.classList.contains("o_scita_hotspot_m_pos"),
        }));
    }

    /** Products sold on the website being edited (another website's ones have no dot on it). */
    get productDomain() {
        const websiteId = this.website.currentWebsite?.id;
        return [
            ["is_published", "=", true],
            ["sale_ok", "=", true],
            ...(websiteId ? [["website_id", "in", [false, websiteId]]] : []),
        ];
    }
}

registry.category("website-options")
    .add(ScitaHotspotsOption.id, ScitaHotspotsOption)
    .add(ScitaHotspotsBgOption.id, ScitaHotspotsBgOption)
    .add(ScitaHotspotOption.id, ScitaHotspotOption);
