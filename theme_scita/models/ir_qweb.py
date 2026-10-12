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
from odoo import api, models
from odoo.http import request
from odoo.tools.misc import file_path

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

        if tagName == 'div' and atts.get('id') == 'wrap' and request:
            return self._scita_wrap_classes(atts)
        if tagName == 'div' and request and 'category-slider-placeholder' in (atts.get('class') or '').split():
            request._scita_in_placeholder = True  # its image is next (_scita_placeholder_image)
            return atts
        if tagName != 'img' or not request or atts.get('data-no-post-process'):
            return atts

        # Mirror the guards core uses before it touches attributes at all, so
        # the editor, translation mode and asset bundles are left alone.
        context = self.env.context
        if (context.get('inherit_branding') or context.get('rendering_bundle')
                or context.get('edit_translations') or context.get('debug')
                or request.session.debug):
            return atts

        atts = self._scita_add_theme_image_size(atts)
        atts = self._scita_add_shop_image_sizes(atts)
        if getattr(request, '_scita_in_placeholder', False):
            request._scita_in_placeholder = False
            return self._scita_placeholder_image(atts)

        if _is_icon_sized(atts):
            return atts

        # shop listing and product page: the page's main image is known (first product card /
        # main product image), not left to the "first image" guess below (the logo got it)
        classes = (atts.get('class') or '').split()
        product_image = ('product_detail_img' in classes and 'product_detail_img'
                         or getattr(request, '_scita_shop_grid', None) is not None and 'oe_product_image_img' in classes and 'oe_product_image_img')
        if product_image:
            seen = getattr(request, '_scita_product_img_seen', 0)
            request._scita_product_img_seen = seen + 1
            # first card row on phones (2 cards), the main image of a product page
            if seen < (2 if product_image == 'oe_product_image_img' else 1):
                atts = dict(atts)
                atts['loading'] = 'eager'
                if seen == 0:
                    atts['fetchpriority'] = 'high'
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

        if getattr(request, '_scita_shop_grid', None) is not None:
            return atts  # shop listing: see above
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

    def _scita_wrap_classes(self, atts):
        """`js_sale` on the page's #wrap from the start. scita_fronted.js adds it once the page's
        JS has loaded (when no element of the page has it), and Scita's rules keyed on it (shop
        and product page titles, breadcrumbs...) then moved the page (layout shift)."""
        context = self.env.context
        if (context.get('inherit_branding') or context.get('rendering_bundle')
                or context.get('edit_translations')):
            return atts
        website = self.env.website
        if not website or not website._scita_theme_active():
            return atts
        classes = (atts.get('class') or '').split()
        # the deals page has its own js_sale block, the script leaves #wrap alone there
        if 'js_sale' in classes or request.httprequest.path.startswith('/deals-of-the-day'):
            return atts
        atts = dict(atts)
        atts['class'] = ' '.join(classes + ['js_sale'])
        return atts

    def _scita_add_shop_image_sizes(self, atts):
        """`sizes` for the product images of the shop listing. They have a srcset (128 to 1024px
        wide) but no `sizes`, so the browser takes them as wide as the screen and a phone
        downloads the 1024px file of every card shown two per row (~10 x 18 KB before the
        page's main image on a category page). Below 768px the cards are half the screen wide
        (Odoo's g-col-6) unless the "1 product per row" option is on; wider screens keep the
        browser's default (full width), as before."""
        if not getattr(request, '_scita_shop_grid', False) or not atts.get('srcset') or atts.get('sizes'):
            return atts
        classes = (atts.get('class') or '').split()
        if 'oe_product_image_img' not in classes and 'oe_product_image_img_secondary' not in classes:
            return atts
        atts = dict(atts)
        # 60vw, not 50vw: the portrait cards crop the (square) image to their height
        atts['sizes'] = '(min-width: 768px) 100vw, 60vw'
        return atts

    def _scita_placeholder_image(self, atts):
        """The sample screenshot of a dynamic block's editor placeholder, for a visitor: never
        shown (snippets.scss hides it until the block's data replaces it), but downloaded all the
        same (up to ~130 KB each, ~300 KB on a typical home page), competing with the images that
        are. An empty image of the same size takes its place: same room on the page, no download.
        Only the theme's own sample images (whose size is known) are replaced."""
        src = atts.get('src') or ''
        if not src.startswith('/theme_scita/static/') or not atts.get('width') or not atts.get('height'):
            return atts
        try:
            width, height = int(atts['width']), int(atts['height'])
        except (TypeError, ValueError):
            return atts
        atts = dict(atts)
        atts['src'] = "data:image/svg+xml,%%3Csvg xmlns='http://www.w3.org/2000/svg' width='%d' height='%d'/%%3E" % (width, height)
        atts.pop('srcset', None)
        atts.pop('loading', None)
        return atts

    # ------------------------------------------------------------------------------------------
    # Theme images without width / height: until they load they take no room, then the content
    # under them moves (the automobile banner's 540x540 picture pushed the page down ~200px on
    # a phone, Lighthouse CLS 0.17). Saved pages keep the markup of the version they were made
    # with, so the size is added when the page is rendered: the image's own size, which is what
    # the browser uses once it has loaded, so nothing changes on screen.
    # ------------------------------------------------------------------------------------------
    def _scita_add_theme_image_size(self, atts):
        src = atts.get('src')
        if not isinstance(src, str) or not src.startswith(('/theme_scita/static/', '/web/image/theme_scita.')):
            return atts
        size = self._scita_theme_image_size(src)
        if not size:
            return atts
        width, height = size
        atts = dict(atts)
        had_width = bool(atts.get('width'))
        # both attributes, in the image's proportions (the browser takes the ratio from them)
        try:
            if atts.get('width') and not atts.get('height'):
                atts['height'] = str(round(int(atts['width']) * height / width))
            elif atts.get('height') and not atts.get('width'):
                atts['width'] = str(round(int(atts['height']) * width / height))
            elif not atts.get('width'):
                atts['width'], atts['height'] = str(width), str(height)
        except (TypeError, ValueError):
            pass
        # its natural width for the global img rule (comman.scss): what `width: auto` gives once
        # the image has loaded, known before it has, so its room is kept from the start
        # (not when the markup gives a width: it is the size some blocks use on purpose)
        style = (atts.get('style') or '').strip()
        if not had_width and '--sct-w' not in style:
            atts['style'] = ('%s; ' % style.rstrip(';') if style else '') + '--sct-w: %dpx' % width
        return atts

    @api.model
    @api.ormcache('src')
    def _scita_theme_image_size(self, src):
        """(width, height) of a theme-shipped image given by URL, or None."""
        path = src.split('?', 1)[0]
        if path.startswith('/web/image/theme_scita.'):
            attachment = self.env.ref(path[len('/web/image/'):], raise_if_not_found=False)
            if not attachment or attachment._name != 'ir.attachment' or not (attachment.sudo().url or '').startswith('/theme_scita/static/'):
                return None
            path = attachment.sudo().url.split('?', 1)[0]
        if not path.lower().endswith(('.png', '.jpg', '.jpeg', '.webp', '.gif')):
            return None  # svg & co: no reliable pixel size
        try:
            full_path = file_path(path.lstrip('/'))
            if path.lower().endswith('.webp'):
                width, height = _webp_size(full_path)  # Odoo keeps PIL's WebP plugin off
            else:
                from PIL import Image
                with Image.open(full_path) as image:
                    width, height = image.size
        except Exception:  # noqa: BLE001
            return None
        return (width, height) if width and height else None


def _webp_size(path):
    """(width, height) from a WebP file's header (lossy VP8, lossless VP8L or extended VP8X)."""
    with open(path, 'rb') as f:
        data = f.read(30)
    if len(data) < 30 or data[:4] != b'RIFF' or data[8:12] != b'WEBP':
        raise ValueError('not a WebP file')
    chunk = data[12:16]
    if chunk == b'VP8 ':
        return (int.from_bytes(data[26:28], 'little') & 0x3FFF, int.from_bytes(data[28:30], 'little') & 0x3FFF)
    if chunk == b'VP8L':
        b0, b1, b2, b3 = data[21:25]
        return (1 + (((b1 & 0x3F) << 8) | b0), 1 + (((b3 & 0x0F) << 10) | (b2 << 2) | ((b1 & 0xC0) >> 6)))
    if chunk == b'VP8X':
        return (1 + int.from_bytes(data[24:27], 'little'), 1 + int.from_bytes(data[27:30], 'little'))
    raise ValueError('unknown WebP chunk')
