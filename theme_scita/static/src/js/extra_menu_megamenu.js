/** @odoo-module **/

// Scita mega menus moved into Odoo's "+" overflow menu (header autohide) open in place
// (product_card_equal_height.scss). Keep one open at a time, like an accordion: Bootstrap
// does not close sibling dropdowns nested inside another open dropdown.
document.addEventListener("show.bs.dropdown", (ev) => {
    const toggleEl = ev.target;
    const itemEl = toggleEl.closest?.(".o_extra_menu_items li.li-mega-menu");
    if (!itemEl) {
        return;
    }
    for (const openToggleEl of itemEl.parentElement.querySelectorAll(
        ":scope > li.li-mega-menu > .dropdown-toggle.show"
    )) {
        if (openToggleEl !== toggleEl) {
            openToggleEl.click(); // Bootstrap closes it
        }
    }
});

// Opening or using one of those mega menus must not close the "+" menu around it
// (Bootstrap closes an open dropdown on any click inside it).
document.addEventListener("hide.bs.dropdown", (ev) => {
    const toggleEl = ev.target;
    if (!toggleEl.matches?.(".o_extra_menu_items > .dropdown-toggle")) {
        return;
    }
    const clickedEl = ev.clickEvent?.target;
    if (clickedEl?.closest?.(".o_extra_menu_items li.li-mega-menu")) {
        ev.preventDefault();
    }
});

// The "+" list scrolls (max-height). Closing a long mega menu above the one just opened
// shrinks the list, which can leave the opened menu's name scrolled out of view.
document.addEventListener("shown.bs.dropdown", (ev) => {
    const toggleEl = ev.target;
    const itemEl = toggleEl.closest?.(".o_extra_menu_items li.li-mega-menu");
    if (!itemEl) {
        return;
    }
    const listEl = itemEl.parentElement;
    const top = toggleEl.offsetTop;
    if (top < listEl.scrollTop || top + toggleEl.offsetHeight > listEl.scrollTop + listEl.clientHeight) {
        listEl.scrollTop = top;
    }
});

// Opening or closing one of those mega menus changes the list's width (320px while one is
// open). Bootstrap only places the list when "+" opens, so it kept its old spot and ran past
// the right edge of the screen until the window was resized. Place it again.
for (const type of ["shown.bs.dropdown", "hidden.bs.dropdown"]) {
    document.addEventListener(type, (ev) => {
        const itemEl = ev.target.closest?.(".o_extra_menu_items li.li-mega-menu");
        const plusToggleEl = itemEl?.closest(".o_extra_menu_items").querySelector(":scope > .dropdown-toggle");
        if (plusToggleEl) {
            window.Dropdown?.getInstance(plusToggleEl)?.update();
        }
    });
}
