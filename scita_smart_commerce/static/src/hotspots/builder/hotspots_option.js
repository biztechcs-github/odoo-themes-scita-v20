import { BaseOptionComponent } from "@html_builder/core/base_option_component";
import { useDomState } from "@html_builder/core/utils";
import { registry } from "@web/core/registry";

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

/** One hotspot: its product and position. */
export class ScitaHotspotOption extends BaseOptionComponent {
    static id = "scita_hotspot_option";
    static template = "scita_smart_commerce.HotspotOption";
}

registry.category("website-options")
    .add(ScitaHotspotsOption.id, ScitaHotspotsOption)
    .add(ScitaHotspotsBgOption.id, ScitaHotspotsBgOption)
    .add(ScitaHotspotOption.id, ScitaHotspotOption);
