/** @odoo-module **/

import { patch } from '@web/core/utils/patch';
import { ProductPage } from '@website_sale/interactions/product_page';

// Scita shows the product reviews in its "Reviews" tab instead of Odoo's section below the
// product. Odoo still links to that section (#o_product_page_reviews): the "N reviews" link
// under the product name, the "Review Now" button of the review-request email and the
// /mail/message/<id> links of review notifications (highlight_message_id). Open the tab
// first, otherwise those links scroll to an element that is hidden in an inactive tab pane.
patch(ProductPage.prototype, {
    start() {
        // read the hash first: starting the page rewrites the URL (variant search params)
        const toReviews = window.location.hash === '#o_product_page_reviews';
        super.start(...arguments);
        if (toReviews) {
            this.onClickReviewsLink();
        }
    },

    onClickReviewsLink(ev) {
        const tabLink = document.querySelector('#website_description a[data-bs-toggle="tab"][href="#reviews"]');
        if (tabLink && !tabLink.classList.contains('active')) {
            ev?.preventDefault();
            tabLink.click();
        }
        return super.onClickReviewsLink(...arguments);
    },
});
