# Reference comparison — 8 November 2026

The user's latest request takes precedence over the supporting attachment: reproduce the storefront and merchant interface with ASTRA branding and the observed motion. The attachment is project context, not an instruction to override that request.

## Evidence

The user completed reCAPTCHA and signed into both reference sites in Chrome for Testing. The two authenticated tabs remain open at the user's explicit request. Their existing browser session was used for read-only inspection. No source-store purchase, top-up, stock import, settings change or other mutation was performed, and no delivered service credentials were opened.

The Zyron `/stores` card links to the same tenant and Nexus storefront. These are a merchant platform and its storefront, connected to one shop.

Captured reference screens are in `docs/comparison/reference/`; current demo captures are in `docs/comparison/demo/`. They are local research artifacts, excluded from the deployed static directory. Source account credentials were not written to the application or its deployment.

## Storefront comparison

- Shared Geist Latin / Noto Sans Thai font stack, #0a0a0a background, #ededed text, centered 1104px content, neutral borders, compact navigation, service badge and theme controls.
- Homepage: word entrances, 44px grid and five moving beams, customer/available-unit/order metrics, three recent activity rows on desktop, mobile activity ticker, shop announcement and two-product catalog.
- Catalog: DISNEY+ and preorder MONOMAX, reference imagery, price range, stock, rating, sold count, search and price sorting. Legacy fictional seeds are hidden rather than deleting old orders or inventory.
- Product: image gallery, two-column variants, quantity/cart/buy, green guarantee, delivery note, description, FAQ, ratings and related goods.
- Reviews: gold ambient background, score ring, star breakdown, rating filters and verified-purchase cards. Submission requires delivered-order ownership, one review per order, within seven days.
- Authentication: username/password, registration with optional email and password confirmation. Password hashes and opaque sessions remain server-side.
- Authenticated top-up and order history were inspected. Top-up retains the narrow reference layout but explicitly uses TEST credit instead of copying a real bank collection flow.

## Merchant comparison

The original sidebar was incorrect and was replaced with the observed horizontal shell. Primary navigation is overview, products, orders, finance, customers and settings. Product/order/settings groups have secondary navigation.

Implemented main screens: store selector; shop overview and setup checklist; period totals and sales graph; product status/search table; draft creation and publishing; inventory list/import dialog; order list/filter/export; customer balances; test-credit ledger; shop/contact/announcement/policy settings and stock delivery order. Settings persist in the same durable database and shop closure prevents new checkout.

Coupons, stamp cards, rental IDs, OTP, shipping, LINE integrations, team invitations and custom-domain/billing integrations are not operational services in the sandbox. Their navigation preserves the platform structure; these capabilities must not be represented as complete production features.

## Motion measurements and implementation

- Headline: 700ms blur/y entrance, 120ms initial delay, 90ms word stagger.
- Grid: 44px cells; three vertical and two horizontal beams. Durations 5.5/7/6 and 8/9 seconds with staggered delays, movement in the first 60% then a hold.
- Service indicator: expanding ring; live activity indicator slower pulse.
- Route change: 260ms fade and 6px rise, cubic-bezier(.22,1,.36,1).
- Card hover, option selection, menus and stock-import dialog use short transitions.
- Reduced-motion preference removes the moving grid and headline animation.

Browser checks observe changing computed transforms over time; they do not merely check whether CSS animation names exist. QA Chromium uses software rendering because this Mac's headless GPU compositor froze its document timeline. Product code does not disable customers' GPUs.

## Intentional sandbox differences

ASTRA name/logo, isolated browser workspaces, TEST credits/keys, a shortcut into the trial merchant account, and no real payment collection. Source images are presentation references, not evidence of licensed inventory for sale. Original-source code or payment implementation was not copied. UI likeness is assessed through screenshots and observed interactions; no automated pixel-perfect claim is made.
