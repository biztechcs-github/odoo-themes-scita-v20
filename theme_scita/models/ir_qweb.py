# -*- coding: utf-8 -*-
"""
Stop the first images on a page from being lazy-loaded.

Odoo defaults every website <img> to loading="lazy"
(addons/website/models/ir_qweb.py, _post_processing_att). That is right for
the long tail of a page, but it also applies to whatever turns out to be the
LCP element, and Lighthouse penalises exactly that: "LCP resources should not
use loading=lazy", plus a 180ms resource load delay on the mobile run of
13 Aug 2026.

The LCP element lives in saved page content, not in a theme template, so it
cannot be tagged by hand. Counting images per request and eagerly loading the
leading ones is the general lever available server-side: the first handful of
images in document order are the above-the-fold ones on every layout this
theme ships.
"""
from odoo import models
from odoo.http import request

# Just the LCP candidate. Under Lighthouse's throttled mobile connection the
# LCP image is queue-bound (measured lcpLoadDelay 500ms / lcpLoadDuration 769ms
# for a 7 KiB file), so every extra eager image competes with it for the same
# bandwidth. Keeping this at 1 hands the connection to the one image the score
# actually depends on and leaves the rest lazy.
EAGER_IMAGE_COUNT = 1

# Below this, in either dimension, an <img> is chrome (menu/category icons
# etc.), never the LCP candidate - same threshold _scita_lcp_preload_href
# already uses when scanning view arch for the same purpose. Icons like the
# header's "All Categories" burger (18x14) render as plain <img> tags, same
# as the hero/content image, so without this they can consume the one eager
# slot before the real content image is even reached.
_ICON_MAX_SIZE = 200


def _is_icon_sized(atts):
    for key in ('width', 'height'):
        try:
            value = int(atts.get(key, 0) or 0)
        except (TypeError, ValueError):
            continue
        if 0 < value < _ICON_MAX_SIZE:
            return True
    return False


class IrQweb(models.AbstractModel):
    _inherit = 'ir.qweb'

    def _post_processing_att(self, tagName, atts):
        atts = super()._post_processing_att(tagName, atts)

        if tagName != 'img' or not request or atts.get('data-no-post-process'):
            return atts

        # Mirror the guards core uses before it touches attributes at all, so
        # the editor, translation mode and asset bundles are left alone.
        context = self.env.context
        if (context.get('inherit_branding') or context.get('rendering_bundle')
                or context.get('edit_translations') or context.get('debug')
                or request.session.debug):
            return atts

        if _is_icon_sized(atts):
            return atts

        # website.py's _scita_lcp_preload_href already ran (it's called from
        # a <head> xpath that renders before body content) and resolved a
        # definitive answer for this request. Trust it over the "first img in
        # document order" guess below: when the real LCP is a CSS
        # background (the homepage hero carousel), no <img> src will ever
        # match, and correctly none should be eager-loaded - the guess
        # below would otherwise grab an unrelated first <img> (e.g. a
        # below-the-fold carousel banner) and steal High-priority bandwidth
        # from the actual LCP resource.
        if hasattr(request, '_scita_lcp_href'):
            if atts.get('src') and atts['src'] == request._scita_lcp_href:
                atts = dict(atts)
                atts['loading'] = 'eager'
                atts['fetchpriority'] = 'high'
            return atts

        seen = getattr(request, '_scita_img_seen', 0)
        if seen >= EAGER_IMAGE_COUNT:
            return atts
        request._scita_img_seen = seen + 1

        atts = dict(atts)
        atts['loading'] = 'eager'
        if seen == 0:
            # Fallback for requests where the head xpath above didn't run
            # (e.g. no main_object). Lighthouse's lcp-discovery check wants
            # fetchpriority=high on the LCP image; being wrong here costs a
            # little bandwidth priority, not correctness.
            atts['fetchpriority'] = 'high'
        return atts
