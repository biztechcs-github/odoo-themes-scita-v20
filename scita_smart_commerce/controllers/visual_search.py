"""AI Visual Search: the shopper sends a photo, the AI describes it in the catalogue's
own vocabulary, and published products are ranked by a deterministic score.

The image is only forwarded to the AI provider; it is never stored.
"""
import base64
import binascii
import io
import json
import logging
import re

from PIL import Image
from werkzeug.urls import url_encode

from odoo import _
from odoo.fields import Domain
from odoo.http import Controller, request, route
from odoo.tools.image import get_webp_size

from ..models.ai_providers import AIProviderError

_logger = logging.getLogger(__name__)

MAX_IMAGE_BYTES = 5 * 1024 * 1024
MAX_PIXELS = 25_000_000  # guard against decompression bombs
ALLOWED_FORMATS = {'JPEG': 'image/jpeg', 'PNG': 'image/png', 'WEBP': 'image/webp', 'GIF': 'image/gif'}
# weak matches (a shared colour, a parent category) are dropped below this share of the best score
MIN_SCORE_SHARE = 0.35
MAX_VOCAB_CATEGORIES = 300
MAX_VOCAB_VALUES = 400
MAX_VOCAB_TAGS = 200
MAX_QUERY_WORDS = 15
MAX_CANDIDATES = 1000
_WORD_RE = re.compile(r'[^\W_]+', re.UNICODE)

VISION_SCHEMA = {
    'type': 'object',
    'properties': {
        'product_type': {'type': 'string', 'description': 'What the main object is, e.g. "armchair"'},
        'colors': {'type': 'array', 'items': {'type': 'string'}},
        'materials': {'type': 'array', 'items': {'type': 'string'}},
        'style': {'type': 'string'},
        'keywords': {'type': 'array', 'items': {'type': 'string'}},
        'matched_categories': {'type': 'array', 'items': {'type': 'string'}},
    },
    'required': ['product_type', 'colors', 'materials', 'style', 'keywords', 'matched_categories'],
    'additionalProperties': False,
}


def _words(text):
    return {w for w in _WORD_RE.findall((text or '').lower()) if len(w) > 2}


def _singular(words):
    """Crude singular forms, enough to match "laptop" with a "Laptops" category."""
    return {w[:-1] if len(w) > 3 and w.endswith('s') and not w.endswith('ss') else w for w in words}


def _norm(text):
    return ' '.join(_WORD_RE.findall((text or '').lower()))


def _str_list(value):
    """The AI's list answer, keeping only strings (it may send anything)."""
    return [v for v in value if isinstance(v, str)] if isinstance(value, list) else []


def decode_image(image_b64, env=None):
    """Validate an uploaded base64 image. Returns (raw_bytes, media_type) or raises ValueError
    with a message in the visitor's language (`env`, the request's by default)."""
    env = env or (request.env if request else None)
    _ = env._ if env is not None else (lambda message: message)
    if not image_b64 or not isinstance(image_b64, str):
        raise ValueError(_('Please choose a photo.'))
    if ',' in image_b64[:100] and image_b64.startswith('data:'):
        image_b64 = image_b64.split(',', 1)[1]
    if len(image_b64) > MAX_IMAGE_BYTES * 4 / 3 + 4:
        raise ValueError(_('This photo is too large. Please use a photo under 5 MB.'))
    try:
        raw = base64.b64decode(image_b64, validate=True)
    except (binascii.Error, ValueError):
        raise ValueError(_('This file is not a valid image.')) from None
    if len(raw) > MAX_IMAGE_BYTES:
        raise ValueError(_('This photo is too large. Please use a photo under 5 MB.'))
    if raw[:4] == b'RIFF' and raw[8:12] == b'WEBP':
        # Odoo preloads only a minimal set of PIL plugins (no WEBP): use its own parser
        try:
            size = get_webp_size(raw)
        except Exception:  # noqa: BLE001
            size = None
        if not size:
            raise ValueError(_('This file is not a valid image.'))
        if size[0] * size[1] > MAX_PIXELS:
            raise ValueError(_('This photo is too large. Please use a smaller photo.'))
        return raw, 'image/webp'
    try:
        with Image.open(io.BytesIO(raw)) as img:
            fmt = img.format
            if img.width * img.height > MAX_PIXELS:
                raise ValueError(_('This photo is too large. Please use a smaller photo.'))
            img.verify()
    except ValueError:
        raise
    except Exception:  # noqa: BLE001 - PIL raises many types for corrupt data
        raise ValueError(_('This file is not a valid image.')) from None
    if fmt not in ALLOWED_FORMATS:
        raise ValueError(_('Please use a JPEG, PNG, WEBP or GIF photo.'))
    return raw, ALLOWED_FORMATS[fmt]


class ScitaVisualSearch(Controller):

    # ------------------------------------------------------------------ catalogue
    def _product_domain(self, website):
        return (Domain('is_published', '=', True) & Domain('sale_ok', '=', True)
                & website.website_domain())

    def _vocabulary(self, website):
        """Category names, attribute values and tags used by published products of this
        website. Bounded so a big catalogue keeps the prompt small: the AI only needs the
        shop's words, not every product."""
        product_domain = self._product_domain(website)
        Categories = request.env['product.public.category'].sudo()
        categories = Categories.search(
            Domain.AND([website.website_domain(), [('product_tmpl_ids', 'any', product_domain)]]),
            limit=MAX_VOCAB_CATEGORIES, order='sequence, id')
        categories |= categories.parent_id
        values = request.env['product.attribute.value'].sudo().search(
            [('pav_attribute_line_ids.product_tmpl_id', 'any', product_domain)],
            limit=MAX_VOCAB_VALUES, order='attribute_id, sequence, id')
        attributes = {}
        for value in values:
            attributes.setdefault(value.attribute_id.name, set()).add(value.name)
        tags = request.env['product.tag'].sudo().search(
            [('product_template_ids', 'any', product_domain)], limit=MAX_VOCAB_TAGS).mapped('name')
        return (sorted(set(categories.mapped('name'))),
                {k: sorted(v) for k, v in attributes.items()},
                sorted(set(tags)))

    def _search_domain(self, website):
        """The products a photo can match: services never look like a photo."""
        domain = self._product_domain(website)
        if website.scita_visual_search_exclude_services:
            domain &= Domain('type', '!=', 'service')
        return domain

    def _specific_categories(self, website, names):
        """The detected shop categories without those that are a parent of another detected one:
        for a chair the AI may answer "Chairs", "Living Room" and "Furniture", and only "Chairs"
        says what the product is (the others brought in the sofas and the tables)."""
        names = [n for n in names if n.strip()]
        if len(names) < 2:
            return names
        categories = request.env['product.public.category'].sudo().search(
            website.website_domain() & Domain.OR([Domain('name', '=ilike', n) for n in names]))
        ancestor_ids = {int(i) for c in categories for i in (c.parent_path or '').split('/')[:-2]}
        broad = {_norm(c.name) for c in categories if c.id in ancestor_ids}
        return [n for n in names if _norm(n) not in broad] or names

    def _candidates(self, website, detected, match='all'):
        """Published products that share at least one detected word, category, attribute value
        or tag (at most MAX_CANDIDATES): only those are scored, whatever the catalogue size.
        `match` is the website's "Match photos on" setting."""
        words = set()
        for text in [v for v in (detected.get('product_type'), detected.get('style')) if isinstance(v, str)] \
                + _str_list(detected.get('keywords')) \
                + _str_list(detected.get('colors')) + _str_list(detected.get('materials')):
            words |= _words(text)
        words = sorted(words, key=len, reverse=True)[:MAX_QUERY_WORDS]
        text_fields = ['name']
        if match in ('name_description', 'all'):
            text_fields.append('description_sale')
        if match == 'all':
            text_fields.append('product_tag_ids.name')
        matches = [Domain(field, 'ilike', word) for word in words for field in text_fields]
        for name in [n for n in _str_list(detected.get('matched_categories')) if n.strip()][:MAX_QUERY_WORDS]:
            matches.append(Domain('public_categ_ids.name', '=ilike', name))
        if match == 'all':
            for name in [n for n in _str_list(detected.get('colors')) + _str_list(detected.get('materials'))
                         if n.strip()][:MAX_QUERY_WORDS]:
                matches.append(Domain('attribute_line_ids.value_ids.name', '=ilike', name))
        if not matches:
            return request.env['product.template']
        return request.env['product.template'].sudo().search(
            self._search_domain(website) & Domain.OR(matches),
            limit=MAX_CANDIDATES, order='website_sequence, id')

    # ------------------------------------------------------------------ scoring
    @staticmethod
    def score_product(product, detected, match='all'):
        """Deterministic, explainable score of one product.template against detected attributes.
        `match` is the website's "Match photos on" setting. Returns (score, reasons)."""
        score, reasons = 0, []
        cat_names = {_norm(n) for n in (product.public_categ_ids | product.public_categ_ids.parent_id).mapped('name')}
        values = {_norm(v) for v in product.attribute_line_ids.value_ids.mapped('name')} if match == 'all' else set()
        name_words = _words(product.name)
        text_words = set(name_words)
        if match in ('name_description', 'all'):
            text_words |= _words(product.description_sale)
        if match == 'all':
            for tag in product.product_tag_ids.mapped('name'):
                text_words |= _words(tag)

        product_type = detected.get('product_type') if isinstance(detected.get('product_type'), str) else ''
        style = detected.get('style') if isinstance(detected.get('style'), str) else ''
        for cat in _str_list(detected.get('matched_categories')):
            if _norm(cat) in cat_names:
                score += 5
                reasons.append(cat)
        # singular forms: "chair" is the kind of a product in "Chairs" (an "Armchair" in that
        # category got no kind points and fell under MIN_SCORE_SHARE)
        ptype = _singular(_words(product_type))
        kind_words = _singular(name_words)
        for name in cat_names:
            kind_words |= _singular(_words(name))
        if ptype and ptype & kind_words:
            score += 3
            reasons.append(product_type)
        # the whole detected type in the name ("lounge chair" in "Lounge Chair") comes first, and
        # so does a product whose own category is that type ("chair": an "Armchair" in "Chairs")
        ptype_norm = ' '.join(sorted(_singular(_words(product_type))))
        if _norm(product_type) and (' %s ' % _norm(product_type) in ' %s ' % _norm(product.name)
                                    or any(ptype_norm == ' '.join(sorted(_singular(_words(c)))) for c in cat_names)):
            score += 4
        for color in _str_list(detected.get('colors')):
            if _norm(color) in values:
                score += 3
                reasons.append(color)
            elif _words(color) & text_words:
                score += 1
        for material in _str_list(detected.get('materials')):
            if _norm(material) in values:
                score += 2
                reasons.append(material)
            elif _words(material) & text_words:
                score += 1
        for word in [style] + _str_list(detected.get('keywords')):
            hits = _words(word)
            if hits & name_words:
                score += 2
            elif hits & text_words:
                score += 1
        return score, list(dict.fromkeys(r for r in reasons if r))

    @staticmethod
    def in_detected_category(product, detected):
        """Is `product` in one of the detected shop categories (or below one)?"""
        cat_names = {_norm(n) for n in (product.public_categ_ids | product.public_categ_ids.parent_id).mapped('name')}
        return any(_norm(cat) in cat_names for cat in _str_list(detected.get('matched_categories')))

    @staticmethod
    def matches_kind(product, detected):
        """Is `product` the same kind of thing as the photo: in one of the detected shop
        categories, or with the detected product type in its name or categories? Colours,
        materials and style alone don't make a match (a black shirt for a black laptop)."""
        categories = product.public_categ_ids | product.public_categ_ids.parent_id
        cat_names = {_norm(n) for n in categories.mapped('name')}
        if any(_norm(cat) in cat_names for cat in _str_list(detected.get('matched_categories'))):
            return True
        product_type = detected.get('product_type') if isinstance(detected.get('product_type'), str) else ''
        ptype = _singular(_words(product_type))
        if not ptype:
            return False
        kind_words = _singular(_words(product.name))
        for name in categories.mapped('name'):
            kind_words |= _singular(_words(name))
        return bool(ptype & kind_words)

    def _card(self, product, website):
        info = product._get_combination_info()
        monetary = request.env['ir.qweb.field.monetary']
        opts = {'display_currency': info['currency']}
        hide = info.get('hide_price') or website._scita_hide_price(product)
        compare = info.get('compare_list_price') or 0
        return {
            'id': product.id,
            'name': product.name,
            'url': product.website_url,
            'image': '/web/image/product.template/%s/image_512' % product.id,
            'price': '' if hide else monetary.value_to_html(info['price'], opts).striptags().strip(),
            'compare_price': '' if hide or compare <= info['price'] else monetary.value_to_html(compare, opts).striptags().strip(),
        }

    def _rank(self, website, detected):
        """Score and filter the products for the detected attributes, following the website's
        visual search settings. Returns the best (score, sequence, id, product, reasons)."""
        detected['matched_categories'] = self._specific_categories(
            website, _str_list(detected.get('matched_categories')))
        match, scope = website.scita_visual_search_match, website.scita_visual_search_scope
        scored = []
        for product in self._candidates(website, detected, match):
            score, reasons = self.score_product(product, detected, match)
            if score > 0:
                scored.append((score, product.website_sequence, product.id, product, reasons))
        if scope == 'category' and _str_list(detected.get('matched_categories')):
            scored = [s for s in scored if self.in_detected_category(s[3], detected)]
        elif scope in ('category', 'kind'):
            # when products of the photo's kind exist, only show those: colour or style matches
            # of other kinds (shirts for a laptop photo) would just fill the list
            same_kind = [s for s in scored if self.matches_kind(s[3], detected)]
            if same_kind or scope == 'category':
                scored = same_kind
        if scored and scope != 'similar':
            best = max(s[0] for s in scored)
            scored = [s for s in scored if s[0] >= best * MIN_SCORE_SHARE]
        scored.sort(key=lambda s: (-s[0], s[1], s[2]))
        return scored[:website.scita_visual_search_limit or 12]

    # ------------------------------------------------------------------ route
    @route('/scita/visual_search', type='jsonrpc', auth='public', website=True, methods=['POST'])
    def visual_search(self, image=None, **kwargs):
        website = request.env.website
        Ai = request.env['scita.ai']
        if not website.scita_visual_search_enabled or not website._scita_ai_ready():
            return {'error': _('Visual search is not available.')}
        try:
            raw, media_type = decode_image(image, request.env)
        except ValueError as e:
            return {'error': str(e)}
        try:
            Ai.check_rate_limit(website, 'visual_search')
        except AIProviderError as e:
            return {'error': Ai.public_error(e)}

        if not request.env['product.template'].sudo().search_count(self._product_domain(website), limit=1):
            return {'error': _('There are no products to search yet.')}
        categories, attributes, tags = self._vocabulary(website)
        vocabulary = {'categories': categories, 'attribute_values': attributes, 'tags': tags}
        system = (
            'You identify products in shoppers\' photos for the online shop "%s". '
            'Describe the main product in the photo. Use the shop vocabulary below whenever it fits: '
            'matched_categories must only contain category names from the list, and colors/materials '
            'should reuse the attribute values when they match. Keywords are short search terms. '
            'If the photo shows no product, return empty lists and an empty product_type.\n\n'
            'Shop vocabulary (JSON):\n%s' % (website.name, json.dumps(vocabulary, ensure_ascii=False))
        )
        messages = [{'role': 'user', 'content': [
            {'type': 'image', 'source': {'type': 'base64', 'media_type': media_type,
                                         'data': base64.b64encode(raw).decode()}},
            {'type': 'text', 'text': 'Which product is this? Describe it for a catalogue search.'},
        ]}]
        try:
            response = Ai.chat(website, 'visual_search', system, messages, max_tokens=4096,
                               effort='low', json_schema=VISION_SCHEMA)
        except AIProviderError as e:
            return {'error': Ai.public_error(e)}
        Ai.count_use(website, 'visual_search')
        if response.stop_reason == 'refusal':
            return {'error': _('We could not analyse this photo. Please try another one.')}
        try:
            detected = json.loads(response.text or '{}')
        except ValueError:
            _logger.warning('Visual search: invalid JSON from the AI provider')
            return {'error': _('We could not analyse this photo. Please try another one.')}
        if not isinstance(detected, dict):
            detected = {}

        scored = self._rank(website, detected)
        public_products = request.env['product.template'].browse([s[2] for s in scored])
        # re-read with the visitor's rights so prices/urls are computed for them
        visible = public_products.with_env(request.env).filtered_domain(self._product_domain(website))
        by_id = {s[2]: s for s in scored}
        cards = []
        for product in visible:
            card = self._card(product, website)
            card['reasons'] = by_id[product.id][4]
            cards.append(card)

        chips = {}
        for chip in [detected.get('product_type'), detected.get('style')] + _str_list(detected.get('colors')) \
                + _str_list(detected.get('materials')):
            if isinstance(chip, str) and chip.strip():
                chips.setdefault(chip.strip().lower(), chip.strip())
        chips = list(chips.values())[:8]
        return {
            'products': cards,
            'chips': chips,
            'search_url': self._all_results_url(website, detected, visible),
            # False when the best result is not the photo's kind (a camera photo in a shop
            # without cameras): the results are related products, not the product itself
            'exact': bool(visible) and self._is_photo_product(visible[0], detected),
        }

    @staticmethod
    def _is_photo_product(product, detected):
        """Is `product` the kind of thing in the photo, not just related to it? Its name or
        categories name the detected type ("armchair", "Chairs" for "chair"), or it is in a
        detected category without subcategories ("Phones" for a smartphone). A broad detected
        category is not enough: a camera photo matched to "Electronics" found the phones."""
        product_type = detected.get('product_type') if isinstance(detected.get('product_type'), str) else ''
        ptype = _singular(_words(product_type))
        categories = product.public_categ_ids | product.public_categ_ids.parent_id
        kind_words = _singular(_words(product.name))
        for name in categories.mapped('name'):
            kind_words |= _singular(_words(name))
        if ptype and ptype & kind_words:
            return True
        detected_cats = {_norm(c) for c in _str_list(detected.get('matched_categories'))}
        return any(_norm(c.name) in detected_cats and not c.child_id for c in product.public_categ_ids)

    def _all_results_url(self, website, detected, products):
        """"See all results": a shop category page holding the best match (`products` are in
        ranking order) and as many of the other results as possible. Taken from the detected
        categories when one holds the best match, else from the best match's own categories.
        A vase photo detected as "Home Decor" and "Living Room" (sofas, chairs) gave Living Room,
        which holds the sofa and the armchair found but not the vase. Without any category, a
        shop search for the product type's main noun: the shop search needs every word to match,
        and the type plus a colour ("lounge chair black") listed fewer products than the photo
        search itself."""
        def holds(category, product):
            return any(str(category.id) in (c.parent_path or '').split('/') for c in product.public_categ_ids)

        def held(category):
            return sum(1 for p in products if holds(category, p))

        top = products[:1]
        Category = request.env['product.public.category']
        names = [n for n in _str_list(detected.get('matched_categories')) if n.strip()]
        candidates = Category.search(website.website_domain() & Domain.OR(
            [Domain('name', '=ilike', n) for n in names])) if names else Category
        if top:
            candidates = candidates.filtered(lambda c: holds(c, top)) or top.public_categ_ids
        if candidates:
            best = max(candidates, key=lambda c: (held(c), -c.sequence, -c.id))
            return '/shop/category/%s' % request.env['ir.http']._slug(best)
        product_type = detected.get('product_type') if isinstance(detected.get('product_type'), str) else ''
        words = _WORD_RE.findall(product_type)
        return '/shop?%s' % url_encode({'search': words[-1]}) if words else '/shop'
