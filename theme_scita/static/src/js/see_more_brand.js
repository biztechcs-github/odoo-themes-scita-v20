/** @odoo-module **/
// Odoo 20 ships no jQuery: same "load more / show less" brand list, in plain DOM.

function onReady(fn) {
    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", fn, { once: true });
    } else {
        fn();
    }
}

onReady(() => {
    const items = [...document.querySelectorAll("#myList div")];
    const loadMore = document.querySelector("a#loadMore");
    const showLess = document.querySelector("a#showLess");
    const size = items.length;
    let x = 7;

    const show = (el) => {
        el.style.display = "";
        if (getComputedStyle(el).display === "none") {
            el.style.display = "block";
        }
    };
    const hide = (el) => (el.style.display = "none");
    // jQuery :lt(n) -> index < n
    const render = (n) => items.forEach((el, i) => (i < n ? show(el) : hide(el)));

    render(x);
    if (size > 7) {
        loadMore?.classList.remove("o_hidden");
    }
    loadMore?.addEventListener("click", () => {
        x = x + 5 <= size ? x + 5 : size;
        items.slice(0, x).forEach(show);
        showLess?.classList.remove("o_hidden");
        if (x === size) {
            loadMore.classList.add("o_hidden");
        }
    });
    showLess?.addEventListener("click", () => {
        x = x - 5 < 0 ? 3 : x - 5;
        items.slice(x).forEach(hide);
        if (x <= 7) {
            showLess.classList.add("o_hidden");
            loadMore?.classList.remove("o_hidden");
            items.slice(0, 7).forEach(show);
        }
    });
});
