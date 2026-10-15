# Official Apple imagery

All 18 files are unmodified Apple 2x JPEGs. The links below point to the exact original image URLs. All filenames are relative to `assets/`; dimensions are pixels.

| Product | Desktop file / original URL | Desktop dimensions | Mobile file / original URL | Mobile dimensions |
| --- | --- | --- | --- | --- |
| iPhone family | [iphone-hero.jpg](https://www.apple.com/v/homepage/images/iphone-family/a/hero_iphone_family__be5jkzxszb1e_large_2x.jpg) | 6016 × 1160 | [iphone-hero-mobile.jpg](https://www.apple.com/v/homepage/images/iphone-family/a/hero_iphone_family__be5jkzxszb1e_small_2x.jpg) | 1468 × 1000 |
| MacBook Air | [macbook-air.jpg](https://www.apple.com/v/homepage/images/macbook-air-m5/a/hero_macbook_air_m5__eb1idggd120y_large_2x.jpg) | 6016 × 1160 | [macbook-air-mobile.jpg](https://www.apple.com/v/homepage/images/macbook-air-m5/a/hero_macbook_air_m5__eb1idggd120y_small_2x.jpg) | 1468 × 1000 |
| iPad Air | [ipad-air.jpg](https://www.apple.com/v/homepage/images/ipad-air-m4/a/hero_ipad_air_m4__gc1zddfs5tiu_large_2x.jpg) | 6016 × 1160 | [ipad-air-mobile.jpg](https://www.apple.com/v/homepage/images/ipad-air-m4/a/hero_ipad_air_m4__gc1zddfs5tiu_small_2x.jpg) | 1468 × 1000 |
| MacBook Pro | [macbook-pro.jpg](https://www.apple.com/v/homepage/images/macbook-pro/a/promo_macbook_pro__c9td9w1mc8ia_large_2x.jpg) | 2524 × 1160 | [macbook-pro-mobile.jpg](https://www.apple.com/v/homepage/images/macbook-pro/a/promo_macbook_pro__c9td9w1mc8ia_small_2x.jpg) | 1468 × 1000 |
| AirPods Pro 3 | [airpods-pro.jpg](https://www.apple.com/v/homepage/images/airpods-pro-3/a/promo_airpods_pro_3__e4755qofhnyq_large_2x.jpg) | 2524 × 1160 | [airpods-pro-mobile.jpg](https://www.apple.com/v/homepage/images/airpods-pro-3/a/promo_airpods_pro_3__e4755qofhnyq_small_2x.jpg) | 1468 × 1000 |
| Watch Series 11 | [watch-series-11.jpg](https://www.apple.com/v/homepage/images/apple-watch-series-11/a/promo_apple_watch_series_11__gnlwqxe1jlu2_large_2x.jpg) | 2524 × 1160 | [watch-series-11-mobile.jpg](https://www.apple.com/v/homepage/images/apple-watch-series-11/a/promo_apple_watch_series_11__gnlwqxe1jlu2_small_2x.jpg) | 1468 × 1000 |
| iPad Pro | [ipad-pro.jpg](https://www.apple.com/v/ipad-pro/aw/images/overview/hero/hero_endframe__du5kcy4qnxkm_large_2x.jpg) | 2892 × 1632 | [ipad-pro-mobile.jpg](https://www.apple.com/v/ipad-pro/aw/images/overview/hero/hero_endframe__du5kcy4qnxkm_small_2x.jpg) | 1080 × 1152 |
| Apple Trade In | [trade-in.jpg](https://www.apple.com/v/homepage/images/iphone-tradein/a/promo_iphone_tradein__e4hrjxmgmf0i_large_2x.jpg) | 2524 × 1160 | [trade-in-mobile.jpg](https://www.apple.com/v/homepage/images/iphone-tradein/a/promo_iphone_tradein__e4hrjxmgmf0i_small_2x.jpg) | 1468 × 1000 |
| Apple Card | [apple-card.jpg](https://www.apple.com/v/homepage/images/apple-card/a/promo_apple_card__d8xz4kd4evwy_large_2x.jpg) | 2524 × 1160 | [apple-card-mobile.jpg](https://www.apple.com/v/homepage/images/apple-card/a/promo_apple_card__d8xz4kd4evwy_small_2x.jpg) | 1468 × 1000 |

## Composition and cropping

For the eight homepage image pairs, start with a full-section absolute image, `object-fit: cover`, and `object-position: 50% 100%` (equivalently, background-size cover / background-position center bottom). Their upper approximately 40–50% is intentionally clear for live HTML copy. Keep the copy block in roughly the upper third, then tune against the actual section height. Use the mobile files at the Apple small breakpoint, `max-width: 734px`.

The three desktop heroes have enormous horizontal gutters by design. Center-crop those gutters while filling the section height; fitting the entire desktop image into the section width makes the devices too small. Mobile artwork is separately composed, especially iPad Air.

| Product | Visual composition / background | Positioning detail |
| --- | --- | --- |
| iPhone family | Deep-blue iPhone 17 Pro, white iPhone 17, soft-pink iPhone 17e, edge-on iPhone Air. Very light neutral gray, approximately Apple's #f5f5f7. Devices rise from the bottom center; upper roughly 45% clear. | Cover, center bottom. Phone bases are intentionally cut by the original bottom edge. |
| MacBook Air | Two sky-blue laptops make a right-pointing arrow in the lower center. Pale sky-blue-to-near-white gradient. | Cover, center bottom. Preserve both laptops; trim the very wide side gutters. |
| iPad Air | Desktop: fanned tablets in multiple finishes. Mobile: two tilted tablets, front and back. Pale cyan-blue gradient fading toward white below. | Cover, center bottom. Select the mobile variant explicitly rather than center-cropping the desktop fan on phones. |
| MacBook Pro | A dramatically lit, partly open MacBook Pro forms a V, lower center. Pure black background. | Cover, center bottom. Keep the V and lower hinge inside the tile. |
| AirPods Pro 3 | Two white earbuds face inward, lower center. Very light neutral gray. Mobile has especially generous clear space above. | Cover, center bottom. Keep both silicone tips and stems visible. |
| Watch Series 11 | Large rose-gold watch with starlight band, viewed at a shallow angle; Sleep Score face. Very light neutral gray. | Cover, center bottom. Some band cropping is intentional; keep the case and crown visible. |
| iPad Pro | Desktop: broad, shallow-angle black iPad with iridescent display highlights, centered on pure black. Mobile: tall, almost edge-on portrait iPad. | Desktop: cover, 50% 100%; allow black upper space for copy. Mobile: place the image in the lower approximately 60% of the section, use contain / center bottom, and fill the whole section black. The mobile source does not have a homepage-style clear upper copy area. |
| Apple Trade In | Hands enter from opposite sides, exchanging a blue-cased, stickered iPhone 17 Pro for a boxed burgundy iPhone 18 Pro. Very light neutral gray. | Cover, center bottom. Cropping outer forearms is expected; retain both camera clusters and the central exchange. |
| Apple Card | Floating, diagonally tilted titanium card and soft shadow, lower center. Very light neutral gray. | Cover, center bottom. Keep all four card corners and the shadow visible. |

No image contains a baked-in marketing headline or CTA. The Watch face includes its normal English UI labels, and Apple Card includes its sample cardholder name.

## Provenance and verification

- The first six image pairs were discovered in live picture/srcset markup at <https://www.apple.com/ge/>.
- iPad Pro was discovered at <https://www.apple.com/ipad-pro/>; it is a product-page fallback rather than a homepage promo.
- Trade In was discovered at <https://www.apple.com/ca/>. Its current artwork includes iPhone 18 Pro.
- Apple Card was discovered at <https://www.apple.com/>.
- `apple-assets.json` records every exact source URL, discovery page, HTTP 200 status, image/jpeg Content-Type, byte count, dimensions, and SHA-256.
- All 18 files were successfully decoded for visual inspection. JPEG signatures, frame dimensions, end markers, and recorded SHA-256 hashes also passed offline verification.
- Optional SF Pro fonts were not acquired: the official Apple font CSS endpoints checked returned HTTP 404.

From the project directory:

```powershell
node tools/fetch-assets.mjs --verify
```

The default acquisition command is `node tools/fetch-assets.mjs`. It uses four fixed official pages and discovers image URLs from HTML, with three workers, two attempts, a 25-second request timeout, a 64-request ceiling, 12 MiB per image, and 100 MiB overall. Existing differing files are refused rather than overwritten.
