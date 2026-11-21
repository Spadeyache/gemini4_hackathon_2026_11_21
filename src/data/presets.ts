import type {
  GarmentTuningParams,
  InventedProductSpec,
  StoreConfig,
} from '../types/storeConfig';

export const DEFAULT_PRESET_ID = 'good-shot-club';

export const DEFAULT_TUNING_PARAMS: GarmentTuningParams = {
  cutoutTolerance: 26,
  curveDepth: 0.105,
  sleeveRelax: 0.72,
  fabricSheen: 0.18,
  normalStrength: 1.05,
  swayIntensity: 0.35,
  shellThickness: 0.018,
  renderMode: 'volumetric',
  sourceMode: 'ai_normalized',
  showCapsuleCompanions: true,
};

/* ============================================================================
   PHOTOREALISTIC STUDIO PRODUCT LINEUPS PER ARCHETYPE PRESET
   All external packshots are verified HTTP 200 Shopify CDN off-body studio
   photographs served through `/api/proxy-image?url=...` with real buyable URLs.
   ============================================================================ */

const GOOD_SHOT_PRODUCTS: InventedProductSpec[] = [
  {
    id: 'good-shot-ringer-tee',
    sku: 'UT-PNTS-GSC-01',
    title: 'Good Shot Club Ringer Tee',
    subtitle: 'Uniqlo UT × Peanuts · Heavyweight Combed Cotton Jersey',
    category: 'structured_tshirt',
    placement: 'hero_rack',
    price: 38,
    primaryColor: '#F2EEEB',
    secondaryColor: '#547049',
    accentColor: '#C5A059',
    graphicHeadline: 'GOOD SHOT CLUB',
    graphicSubtext: 'CHAMPIONSHIP LAWN & COURT',
    graphicMotif: 'monogram_crest',
    materialFinish: 'combed_cotton',
    designRationale:
      'Hero archival ringer tee preserved from real studio photo cutout with Wimbledon sage collar & cuff binding.',
    featured: true,
    customCutoutUrl: '/assets/garments/normalized-front-cutout.png',
  },
  {
    id: 'gsc-court-cap',
    sku: 'RB-CAP-04',
    title: 'Mt. Joy Baseball Hat Green',
    subtitle: 'Rowing Blazers · Wimbledon Green Cotton Twill & Embroidered Crest',
    category: 'structured_cap',
    placement: 'center_table',
    price: 24,
    primaryColor: '#234930',
    secondaryColor: '#F3EFE6',
    accentColor: '#C5A059',
    graphicHeadline: 'ROWING BLAZERS',
    graphicSubtext: 'COLLEGIATE CREST TWILL',
    graphicMotif: 'monogram_crest',
    materialFinish: 'heavy_canvas',
    designRationale:
      'Pairs Wimbledon lawn green twill and crossed-stick collegiate heraldry on the walnut merchandising table.',
    shopifyProductUrl: 'https://rowingblazers.com/products/mt-joy-baseball-hat-green',
    shopifyVariantId: '44331698749474',
    customCutoutUrl:
      '/api/proxy-image?url=https%3A%2F%2Fcdn.shopify.com%2Fs%2Ffiles%2F1%2F1770%2F6343%2Ffiles%2FRB-09SEP25_HAT_GREEN-FRONT.jpg%3Fv%3D1777670551%26width%3D1200',
  },
  {
    id: 'gsc-archive-monograph',
    sku: 'RB-BOOK-05',
    title: 'Rowing Blazers: Revised & Expanded Edition',
    subtitle: 'Rowing Blazers · Jack Carlson Regatta-Stripe Hardcover Monograph',
    category: 'hardcover_book',
    placement: 'left_pedestal',
    price: 48,
    primaryColor: '#2E6F40',
    secondaryColor: '#F5EFE2',
    accentColor: '#C5A059',
    graphicHeadline: 'ROWING BLAZERS',
    graphicSubtext: 'JACK CARLSON · EXPANDED EDITION',
    graphicMotif: 'archival_seal',
    designRationale:
      'Grounds the collegiate racquet-club flagship with Jack Carlson’s regatta-stripe cloth hardcover monograph.',
    shopifyProductUrl: 'https://rowingblazers.com/products/copy-of-rowing-blazers-2nd-edition',
    shopifyVariantId: '41612170952738',
    customCutoutUrl:
      '/api/proxy-image?url=https%3A%2F%2Fcdn.shopify.com%2Fs%2Ffiles%2F1%2F1770%2F6343%2Ffiles%2FCoverRB1_be328c5e-60a1-4764-8c4d-abbf6193f208.jpg%3Fv%3D1792672492%26width%3D1200',
  },
  {
    id: 'gsc-racquet-canvas-tote',
    sku: 'AS-TOTE-06',
    title: 'Sleepy Tote',
    subtitle: 'Actual Source · Heavyweight Ecru Duck Canvas & Lawn Olive Webbing',
    category: 'canvas_tote',
    placement: 'right_pedestal',
    price: 45,
    primaryColor: '#ECE6DA',
    secondaryColor: '#5B6236',
    accentColor: '#C5A059',
    graphicHeadline: 'ACTUAL SOURCE',
    graphicSubtext: 'HEAVY DUCK COURT CARRYALL',
    graphicMotif: 'monogram_crest',
    materialFinish: 'heavy_canvas',
    designRationale:
      'Echoes unbleached ecru cotton jersey and lawn sage trim in a structured courtside canvas boat tote.',
    shopifyProductUrl: 'https://actualsource.org/products/sleepy-tote',
    shopifyVariantId: '42966224339042',
    customCutoutUrl:
      '/api/proxy-image?url=https%3A%2F%2Fcdn.shopify.com%2Fs%2Ffiles%2F1%2F0866%2F5580%2Ffiles%2F01_0b9c4c35-03da-46d7-88f2-765becdba54e.jpg%3Fv%3D1779810227%26width%3D1200',
  },
];

const KINETIC_CONCRETE_PRODUCTS: InventedProductSpec[] = [
  {
    id: 'kl-monolith-hoodie',
    sku: 'RC-3230-BLK',
    title: 'Dual Fleece Standard Hoodie',
    subtitle: 'Reigning Champ · Heavyweight Double-Faced Carbon Black Fleece',
    category: 'heavyweight_hoodie',
    placement: 'hero_rack',
    price: 148,
    primaryColor: '#1E2024',
    secondaryColor: '#2C2F36',
    accentColor: '#FF4D00',
    graphicHeadline: 'KINETIC // 01',
    graphicSubtext: 'REIGNING CHAMP ARCHIVE',
    graphicMotif: 'geometric_grid',
    materialFinish: 'brushed_fleece',
    designRationale:
      'Architectural raglan-sleeve double-faced black fleece engineered to mirror monolithic board-formed concrete.',
    shopifyProductUrl: 'https://reigningchamp.com/products/dual-fleece-standard-hoodie-black',
    shopifyVariantId: '45207848878262',
    featured: true,
    customCutoutUrl:
      '/api/proxy-image?url=https%3A%2F%2Fcdn.shopify.com%2Fs%2Ffiles%2F1%2F1499%2F3122%2Ffiles%2FFW26_RC-3230_BLACK_SWEATER_off_jp.jpg%3Fv%3D1788374874%26width%3D1200',
  },
  {
    id: 'kl-stadium-varsity',
    sku: 'RC-3234-HBLK',
    title: 'Wool Fleece Ridge Zip Jacket',
    subtitle: 'Reigning Champ · Heather Black Italian Wool Fleece & Chrome Zip',
    category: 'varsity_jacket',
    placement: 'capsule_rack',
    price: 325,
    primaryColor: '#25272C',
    secondaryColor: '#D8DCE0',
    accentColor: '#FF4D00',
    graphicHeadline: 'RC-3234',
    graphicSubtext: 'WOOL FLEECE OUTERWEAR',
    graphicMotif: 'orbital_rings',
    materialFinish: 'merino_knit',
    designRationale:
      'Pairs industrial two-way chrome zip hardware with tactile charcoal wool fleece.',
    shopifyProductUrl:
      'https://reigningchamp.com/products/wool-fleece-ridge-zip-jacket-heather-black',
    shopifyVariantId: '45207853039798',
    customCutoutUrl:
      '/api/proxy-image?url=https%3A%2F%2Fcdn.shopify.com%2Fs%2Ffiles%2F1%2F1499%2F3122%2Ffiles%2FFW26_RC-3234_HEATHERBLACK_SWEATER_off_jp.jpg%3Fv%3D1787778043%26width%3D1200',
  },
  {
    id: 'kl-telemetry-tee',
    sku: 'AS-LUDWIG-03',
    title: 'Ludwig Tee',
    subtitle: 'Actual Source · Heavyweight Studio Jersey & Architectural Line Study',
    category: 'structured_tshirt',
    placement: 'capsule_rack',
    price: 52,
    primaryColor: '#191C24',
    secondaryColor: '#EDEFF2',
    accentColor: '#FF4D00',
    graphicHeadline: 'LUDWIG',
    graphicSubtext: 'ACTUAL SOURCE EDITION',
    graphicMotif: 'minimal_typo',
    materialFinish: 'combed_cotton',
    designRationale:
      'Delivers stark white architectural linework on heavyweight dark studio jersey.',
    shopifyProductUrl: 'https://actualsource.org/products/ludwig-tee',
    shopifyVariantId: '43264740851810',
    customCutoutUrl:
      '/api/proxy-image?url=https%3A%2F%2Fcdn.shopify.com%2Fs%2Ffiles%2F1%2F0866%2F5580%2Ffiles%2Fweb_0d67e37a-c61c-4052-9605-28ad19eb1c53.jpg%3Fv%3D1787881932%26width%3D1200',
  },
  {
    id: 'kl-ballistic-cap',
    sku: 'RC-7606-BLK',
    title: 'New Era 9Twenty Fairway Cap',
    subtitle: 'Reigning Champ · Matte Stealth Black Twill & Embroidered Pennants',
    category: 'structured_cap',
    placement: 'center_table',
    price: 44,
    primaryColor: '#1B1C1F',
    secondaryColor: '#ECEFF4',
    accentColor: '#FF4D00',
    graphicHeadline: 'RC // 9TWENTY',
    graphicSubtext: 'STEALTH HEADWEAR',
    graphicMotif: 'geometric_grid',
    materialFinish: 'heavy_canvas',
    designRationale:
      'Structured matte black headwear piece with crimson-orange pennant embroidery on the concrete center slab.',
    shopifyProductUrl: 'https://reigningchamp.com/products/new-era-9twenty-fairway-cap-black',
    shopifyVariantId: '44363308695734',
    customCutoutUrl:
      '/api/proxy-image?url=https%3A%2F%2Fcdn.shopify.com%2Fs%2Ffiles%2F1%2F1499%2F3122%2Ffiles%2FSS26_RC-7606_BLACK_HEADWEAR_off_jp.jpg%3Fv%3D1776885189%26width%3D1200',
  },
  {
    id: 'kl-brutalist-monograph',
    sku: 'AS-RUDER-05',
    title: 'Ruder Typography Ruder Philosophy',
    subtitle: 'Actual Source · Emil Ruder Swiss Brutalist Typography Monograph',
    category: 'hardcover_book',
    placement: 'left_pedestal',
    price: 55,
    primaryColor: '#F4F4F2',
    secondaryColor: '#18191C',
    accentColor: '#FF4D00',
    graphicHeadline: 'EMIL RUDER',
    graphicSubtext: 'TYPOGRAPHY & FORM',
    graphicMotif: 'geometric_grid',
    designRationale:
      'Canonical Swiss brutalist typography treatise anchoring the left poured-concrete plinth.',
    shopifyProductUrl:
      'https://actualsource.org/products/copy-of-ruder-typography-ruder-philosophy',
    shopifyVariantId: '40347042938978',
    customCutoutUrl:
      '/api/proxy-image?url=https%3A%2F%2Fcdn.shopify.com%2Fs%2Ffiles%2F1%2F0866%2F5580%2Ffiles%2Fcover_158f6495-7cc6-48cf-bcf2-792333b700da.jpg%3Fv%3D1684274124%26width%3D1200',
  },
  {
    id: 'kl-stoneware-vessel',
    sku: 'FLW-JOEY-06',
    title: 'Joey Double Wall Ceramic Mugs',
    subtitle: 'Fellow · Matte Charcoal-Black Ceramic & Warm Copper Foot',
    category: 'ceramic_mug',
    placement: 'right_pedestal',
    price: 17.96,
    primaryColor: '#24262B',
    secondaryColor: '#C88A5B',
    accentColor: '#FF4D00',
    graphicHeadline: 'FELLOW // JOEY',
    graphicSubtext: 'MATTE CERAMIC & COPPER',
    graphicMotif: 'minimal_typo',
    materialFinish: 'matte_stoneware',
    designRationale:
      'Tactile matte black double-wall ceramic espresso vessel with a warm metallic copper base.',
    shopifyProductUrl: 'https://fellowproducts.com/products/joey-mugs',
    shopifyVariantId: '29430907961459',
    customCutoutUrl:
      '/api/proxy-image?url=https%3A%2F%2Fcdn.shopify.com%2Fs%2Ffiles%2F1%2F0057%2F6235%2F1219%2Fproducts%2FJoey-Matte-Black-Joey-01.png%3Fv%3D1757441648%26width%3D1200',
  },
];

const KYOTO_ATELIER_PRODUCTS: InventedProductSpec[] = [
  {
    id: 'ah-loopwheel-tee',
    sku: 'RC-6070-SND',
    title: 'Cotton Cashmere Riviera T-Shirt',
    subtitle: 'Reigning Champ · Fine-Gauge Organic Cotton & Cashmere Knit in Sand',
    category: 'structured_tshirt',
    placement: 'hero_rack',
    price: 118,
    primaryColor: '#D6CBBF',
    secondaryColor: '#6B705C',
    accentColor: '#A9714B',
    graphicHeadline: 'ATELIER SAND',
    graphicSubtext: 'COTTON CASHMERE KNIT',
    graphicMotif: 'botanical_line',
    materialFinish: 'combed_cotton',
    designRationale:
      'Fine-gauge oatmeal sand cotton-cashmere knit echoing hand-troweled Kyoto shikkui clay plaster.',
    shopifyProductUrl: 'https://reigningchamp.com/products/cotton-cashmere-riviera-t-shirt-sand',
    shopifyVariantId: '43681461239990',
    featured: true,
    customCutoutUrl:
      '/api/proxy-image?url=https%3A%2F%2Fcdn.shopify.com%2Fs%2Ffiles%2F1%2F1499%2F3122%2Ffiles%2FSS25_RC-6070_SAND_SWEATER_off_jp.jpg%3Fv%3D1737060619%26width%3D1200',
  },
  {
    id: 'ah-moss-hoodie',
    sku: 'RC-3998-COF',
    title: 'Midweight Terry Standard Hoodie',
    subtitle: 'Reigning Champ · Roasted Coffee Earth-Tone Loopback French Terry',
    category: 'heavyweight_hoodie',
    placement: 'capsule_rack',
    price: 128,
    primaryColor: '#43362E',
    secondaryColor: '#DFD2BE',
    accentColor: '#6B705C',
    graphicHeadline: 'ROASTED EARTH',
    graphicSubtext: 'LOOPBACK FRENCH TERRY',
    graphicMotif: 'botanical_line',
    materialFinish: 'brushed_fleece',
    designRationale:
      'Deep roasted-umber loopback French terry harmonizing with blackened bronze hardware and oak joinery.',
    shopifyProductUrl: 'https://reigningchamp.com/products/midweight-terry-standard-hoodie-coffee',
    shopifyVariantId: '45207850877110',
    customCutoutUrl:
      '/api/proxy-image?url=https%3A%2F%2Fcdn.shopify.com%2Fs%2Ffiles%2F1%2F1499%2F3122%2Ffiles%2FFW26_RC-3998_COFFEE_SWEATER_off_jp.jpg%3Fv%3D1785518280%26width%3D1200',
  },
  {
    id: 'ah-linen-blouson',
    sku: 'RC-8057-OLV',
    title: 'Cotton Chino Keeper Standard Overshirt',
    subtitle: 'Reigning Champ · Smoked Dark Olive Twill Utility Chore Jacket',
    category: 'varsity_jacket',
    placement: 'capsule_rack',
    price: 158,
    primaryColor: '#4A4E3B',
    secondaryColor: '#EFE8DA',
    accentColor: '#3A3532',
    graphicHeadline: 'KEEPER · 03',
    graphicSubtext: 'DARK OLIVE UTILITY TWILL',
    graphicMotif: 'archival_seal',
    materialFinish: 'merino_knit',
    designRationale:
      'Quiet-luxury chore overshirt in smoked moss olive echoing botanical stems and white-oak louvers.',
    shopifyProductUrl:
      'https://reigningchamp.com/products/cotton-chino-keeper-standard-overshirt-dark-olive',
    shopifyVariantId: '44047460827318',
    customCutoutUrl:
      '/api/proxy-image?url=https%3A%2F%2Fcdn.shopify.com%2Fs%2Ffiles%2F1%2F1499%2F3122%2Ffiles%2FFW25_RC-8057_DARKOLIVE_SHIRTING_off_jp.jpg%3Fv%3D1756407494%26width%3D1200',
  },
  {
    id: 'ah-botanical-essence',
    sku: 'KNT-20321',
    title: 'AROMA OIL WARMER',
    subtitle: 'KINTO Japan · Brushed Copper Stand & Heat-Resistant Glass Vessel',
    category: 'apothecary_bottle',
    placement: 'center_table',
    price: 60.4,
    primaryColor: '#9E6B49',
    secondaryColor: '#F3EBD9',
    accentColor: '#3A3532',
    graphicHeadline: 'KINTO AROMA',
    graphicSubtext: 'COPPER & GLASS DIFFUSER',
    graphicMotif: 'botanical_line',
    materialFinish: 'frosted_glass',
    designRationale:
      'Authentic KINTO Japan copper-and-glass botanical oil warmer resting on the solid white-oak craft table.',
    shopifyProductUrl: 'https://kinto-usa.com/products/20321',
    shopifyVariantId: '32323136815152',
    customCutoutUrl:
      '/api/proxy-image?url=https%3A%2F%2Fcdn.shopify.com%2Fs%2Ffiles%2F1%2F0146%2F0862%2F9808%2Fproducts%2F20321.jpg%3Fv%3D1597265318%26width%3D1200',
  },
  {
    id: 'ah-kurashiki-tote',
    sku: 'KNT-24801',
    title: 'FUTO Vegetable Bag SCO 400x360mm',
    subtitle: 'KINTO Japan · Undyed Natural Woven Japanese Cotton Canvas Tote',
    category: 'canvas_tote',
    placement: 'left_pedestal',
    price: 156.3,
    primaryColor: '#E5DDD0',
    secondaryColor: '#7A5A3C',
    accentColor: '#6B705C',
    graphicHeadline: 'KINTO FUTO',
    graphicSubtext: 'NATURAL JAPANESE CANVAS',
    graphicMotif: 'botanical_line',
    materialFinish: 'heavy_canvas',
    designRationale:
      'Celebrates raw tactile Japanese FUTO cotton canvas atop the timber-and-limestone left plinth.',
    shopifyProductUrl: 'https://kinto-usa.com/products/24801',
    shopifyVariantId: '50856337932336',
    customCutoutUrl:
      '/api/proxy-image?url=https%3A%2F%2Fcdn.shopify.com%2Fs%2Ffiles%2F1%2F0146%2F0862%2F9808%2Ffiles%2F24801_t_001_1de3a0f6-7cc3-45f1-9479-f02eccd31ba1.jpg%3Fv%3D1792603703%26width%3D1200',
  },
  {
    id: 'ah-shigaraki-mug',
    sku: 'KNT-21889',
    title: 'CLK-151 cup 180ml / 6oz',
    subtitle: 'KINTO Japan · Hasami Porcelain Raw Clay Base & Matte White Glaze',
    category: 'ceramic_mug',
    placement: 'right_pedestal',
    price: 13.6,
    primaryColor: '#EAE4DA',
    secondaryColor: '#8B6F56',
    accentColor: '#3A3532',
    graphicHeadline: 'CERAMIC LAB',
    graphicSubtext: 'HASAMI STONEWARE · 180ML',
    graphicMotif: 'archival_seal',
    materialFinish: 'matte_stoneware',
    designRationale:
      'Handcrafted Nagasaki Hasami tea cup pairing unglazed terracotta-sand clay with warm ash-white glaze.',
    shopifyProductUrl: 'https://kinto-usa.com/products/21889',
    shopifyVariantId: '22206892703792',
    customCutoutUrl:
      '/api/proxy-image?url=https%3A%2F%2Fcdn.shopify.com%2Fs%2Ffiles%2F1%2F0146%2F0862%2F9808%2Fproducts%2F21889.jpg%3Fv%3D1550561998%26width%3D1200',
  },
];

const LINEAR_SYSTEMS_PRODUCTS: InventedProductSpec[] = [
  {
    id: 'ln-precision-hoodie',
    sku: 'RC-3998-BLK',
    title: 'Midweight Terry Standard Hoodie',
    subtitle: 'Reigning Champ · Matte Obsidian Handcrafted Loopback Fleece',
    category: 'heavyweight_hoodie',
    placement: 'hero_rack',
    price: 128,
    primaryColor: '#191C24',
    secondaryColor: '#2B303D',
    accentColor: '#6875F5',
    graphicHeadline: 'LINEAR // OS',
    graphicSubtext: 'PRECISION FLEECE · RC-3998',
    graphicMotif: 'orbital_rings',
    materialFinish: 'brushed_fleece',
    designRationale:
      'Dark-mode obsidian loopback fleece hoodie engineered with flatlock seams and clean studio geometry.',
    shopifyProductUrl: 'https://reigningchamp.com/products/midweight-terry-standard-hoodie-black',
    shopifyVariantId: '43281947459766',
    featured: true,
    customCutoutUrl:
      '/api/proxy-image?url=https%3A%2F%2Fcdn.shopify.com%2Fs%2Ffiles%2F1%2F1499%2F3122%2Ffiles%2FFW26_RC-3998_BLACK_SWEATER_off_jp.jpg%3Fv%3D1794266414%26width%3D1200',
  },
  {
    id: 'ln-anodized-bomber',
    sku: 'RC-3227-BLK',
    title: 'Midweight Terry Standard Track Jacket',
    subtitle: 'Reigning Champ · Matte Black Stand-Collar Shell & Alloy Zip',
    category: 'varsity_jacket',
    placement: 'capsule_rack',
    price: 138,
    primaryColor: '#222630',
    secondaryColor: '#DCE1EC',
    accentColor: '#6875F5',
    graphicHeadline: 'RC-3227',
    graphicSubtext: 'ANODIZED ZIP TRACK SHELL',
    graphicMotif: 'geometric_grid',
    materialFinish: 'merino_knit',
    designRationale:
      'Mirrors bead-blasted aluminum hardware with a full-length polished metal zipper against matte black knit.',
    shopifyProductUrl:
      'https://reigningchamp.com/products/midweight-terry-standard-track-jacket-black',
    shopifyVariantId: '45207848091830',
    customCutoutUrl:
      '/api/proxy-image?url=https%3A%2F%2Fcdn.shopify.com%2Fs%2Ffiles%2F1%2F1499%2F3122%2Ffiles%2FFW26_RC-3227_BLACK_SWEATER_off_jp.jpg%3Fv%3D1785518281%26width%3D1200',
  },
  {
    id: 'ln-supima-tee',
    sku: 'RC-1724-NVY',
    title: 'Lightweight Cordura Pro Shop T-Shirt',
    subtitle: 'Reigning Champ · Abrasion-Resistant Cordura Jersey & CAD Grid Print',
    category: 'structured_tshirt',
    placement: 'capsule_rack',
    price: 58.8,
    primaryColor: '#1C2230',
    secondaryColor: '#F2F4F8',
    accentColor: '#6875F5',
    graphicHeadline: 'PRO SHOP // CAD',
    graphicSubtext: 'CORDURA TECHNICAL JERSEY',
    graphicMotif: 'minimal_typo',
    materialFinish: 'combed_cotton',
    designRationale:
      'Technical Cordura-cotton studio tee featuring a precision white wireframe grid diagram across the chest.',
    shopifyProductUrl:
      'https://reigningchamp.com/products/lightweight-cordura-pro-shop-t-shirt-navy',
    shopifyVariantId: '45233089577142',
    customCutoutUrl:
      '/api/proxy-image?url=https%3A%2F%2Fcdn.shopify.com%2Fs%2Ffiles%2F1%2F1499%2F3122%2Ffiles%2FSS26_RC-1724_NAVY_T-SHIRT_off_jp.jpg%3Fv%3D1785181806%26width%3D1200',
  },
  {
    id: 'ln-method-hardcover',
    sku: 'AS-MACH-04',
    title: 'Machines: A History of Electronic Music by Jean-Michel Jarre',
    subtitle: 'Actual Source · Synthesizer Hardware & Interface Design Monograph',
    category: 'hardcover_book',
    placement: 'center_table',
    price: 65,
    primaryColor: '#25427B',
    secondaryColor: '#EEF2FA',
    accentColor: '#6875F5',
    graphicHeadline: 'MACHINES',
    graphicSubtext: 'HARDWARE & SYNTHESIS INDEX',
    graphicMotif: 'orbital_rings',
    designRationale:
      ' Optical-spectrum hardware design monograph displayed on the cantilevered smoked-glass center table.',
    shopifyProductUrl:
      'https://actualsource.org/products/machines-a-history-of-electronic-music-by-jean-michel-jarre',
    shopifyVariantId: '51058989629538',
    customCutoutUrl:
      '/api/proxy-image?url=https%3A%2F%2Fcdn.shopify.com%2Fs%2Ffiles%2F1%2F0866%2F5580%2Ffiles%2F01_a4f9594d-0a8c-4cd0-9547-654bd8549be8.jpg%3Fv%3D1795123312%26width%3D1200',
  },
  {
    id: 'ln-stealth-cap',
    sku: 'RC-7598-WBLK',
    title: 'Cotton Chino Low Pro Monogram Strapback Cap',
    subtitle: 'Reigning Champ · Washed Obsidian Twill & Tonal Monogram Glyph',
    category: 'structured_cap',
    placement: 'left_pedestal',
    price: 28.8,
    primaryColor: '#23252C',
    secondaryColor: '#343844',
    accentColor: '#6875F5',
    graphicHeadline: 'RC // LOW PRO',
    graphicSubtext: 'TONAL MONOGRAM CAP',
    graphicMotif: 'orbital_rings',
    materialFinish: 'heavy_canvas',
    designRationale:
      'Minimalist washed-obsidian engineer cap with murdered-out tonal embroidery on the left brushed-metal drum.',
    shopifyProductUrl:
      'https://reigningchamp.com/products/cotton-chino-low-pro-monogram-strapback-cap-washed-black',
    shopifyVariantId: '44363308564662',
    customCutoutUrl:
      '/api/proxy-image?url=https%3A%2F%2Fcdn.shopify.com%2Fs%2Ffiles%2F1%2F1499%2F3122%2Ffiles%2FSS26_RC-7598_WASHEDBLACK_HEADWEAR_jp.jpg%3Fv%3D1772827874%26width%3D1200',
  },
  {
    id: 'ln-obsidian-mug',
    sku: 'FLW-CRTR-06',
    title: 'Carter Move Mug',
    subtitle: 'Fellow · Matte Black Vacuum Vessel & Ceramic Interior Coating',
    category: 'ceramic_mug',
    placement: 'right_pedestal',
    price: 23.96,
    primaryColor: '#1C1E24',
    secondaryColor: '#D6DBE5',
    accentColor: '#6875F5',
    graphicHeadline: 'CARTER MOVE',
    graphicSubtext: 'FELLOW // MATTE BLACK',
    graphicMotif: 'minimal_typo',
    materialFinish: 'matte_stoneware',
    designRationale:
      'Precision cylindrical matte-obsidian Fellow Carter vessel with machined stainless splash guard.',
    shopifyProductUrl: 'https://fellowproducts.com/products/carter-move-mug',
    shopifyVariantId: '48039286210660',
    customCutoutUrl:
      '/api/proxy-image?url=https%3A%2F%2Fcdn.shopify.com%2Fs%2Ffiles%2F1%2F0057%2F6235%2F1219%2Fproducts%2FCarter-Move-Mug-01-Matte-Black-01-16oz.png%3Fv%3D1774035928%26width%3D1200',
  },
];

/* ============================================================================
   FOUR DISTINCT MULTI-ARCHETYPE 3D BOUTIQUE PRESETS
   ============================================================================ */

export const STORE_PRESETS: Record<string, StoreConfig> = {
  'good-shot-club': {
    id: 'good-shot-club',
    brandName: 'GOOD SHOT CLUB',
    tagline: 'CHAMPIONSHIP LAWN & COURT ARCHIVE',
    vibe: 'Heritage Wimbledon tennis club, collegiate warm minimalism',
    archetype: 'heritage_arch_flagship',
    brandEthos:
      'Rooted in 1970s championship lawn tennis and collegiate racquet-club heritage—pairing unbleached combed cotton jersey with Wimbledon sage trim, brushed antique brass, and archival court typography.',
    palette: {
      wall: '#F3EFE6', // Warm Venetian limewash wall
      floor: '#DDD5C7', // Honed Roman travertine floor
      accent: '#547049', // Wimbledon sage accent
      secondaryAccent: '#EAE3D2', // Cream architectural architrave trim
      rackMetal: '#C5A059', // Brushed antique brass rack
      hangerWood: '#734F32', // Sculpted American walnut hanger
      plinth: '#E5DEC9', // Fluted Roman travertine plinth
      rug: '#CFC6B4', // Woven oat bouclé area rug
      ambientLight: '#FFF8EE', // Soft ivory daylight fill
      spotLight: '#FFF5E4', // Warm championship court sunlight
    },
    metalRoughness: 0.28,
    metalness: 0.86,
    lightingPreset: 'warm_court_sunlight',
    textures: {
      floorUrl: '/assets/textures/travertine-floor.png',
      wallUrl: '/assets/textures/limewash-wall.png',
      accentPanelUrl: '/assets/textures/sage-fluted-wood.png',
      posterUrl: '/assets/textures/club-crest-art.png',
    },
    racks: [
      {
        id: 'hero-court-faceout',
        label: 'Centre Court Hero Stand',
        position: [0, 0, 0],
        rotationY: 0,
        style: 'hero_faceout',
        items: [
          {
            id: 'good-shot-ringer-tee',
            sku: 'UT-PNTS-GSC-01',
            title: 'Good Shot Club Ringer Tee',
            subtitle: 'Uniqlo UT × Peanuts · Heavyweight Combed Cotton Jersey',
            price: 38,
            featured: true,
            rawUrl: '/assets/raw-shirt.jpg',
            frontCutoutUrl: '/assets/garments/raw-shirt-front-cutout.png',
            backCutoutUrl: '/assets/garments/raw-shirt-back-cutout.png',
            normalMapUrl: '/assets/garments/raw-shirt-normal.png',
            normalizedFrontCutoutUrl: '/assets/garments/normalized-front-cutout.png',
            normalizedBackCutoutUrl: '/assets/garments/normalized-back-cutout.png',
            normalizedNormalMapUrl: '/assets/garments/normalized-normal.png',
            dominantHex: '#F2EEEB',
          },
        ],
      },
      {
        id: 'clubhouse-capsule-rail',
        label: 'Clubhouse Capsule Rail',
        position: [-1.58, 0, -0.58],
        rotationY: 0.34,
        style: 'capsule_rail',
        items: [
          {
            id: 'companion-cardigan',
            sku: 'GSC-KNIT-02',
            title: 'Court Cable-Knit Cardigan',
            subtitle: 'Cream Merino & Wimbledon Sage Varsity Trim',
            price: 168,
            featured: false,
            rawUrl: '/assets/garments/companion-cardigan-front-cutout.png',
            frontCutoutUrl: '/assets/garments/companion-cardigan-front-cutout.png',
            backCutoutUrl: '/assets/garments/companion-cardigan-back-cutout.png',
            normalMapUrl: '/assets/garments/companion-cardigan-normal.png',
            normalizedFrontCutoutUrl: '/assets/garments/companion-cardigan-front-cutout.png',
            normalizedBackCutoutUrl: '/assets/garments/companion-cardigan-back-cutout.png',
            normalizedNormalMapUrl: '/assets/garments/companion-cardigan-normal.png',
            dominantHex: '#EFE9DC',
          },
          {
            id: 'companion-polo',
            sku: 'GSC-POLO-03',
            title: 'Club Pique Tennis Polo',
            subtitle: 'Wimbledon Lawn Sage · Mother-of-Pearl Placket',
            price: 92,
            featured: false,
            rawUrl: '/assets/garments/companion-polo-front-cutout.png',
            frontCutoutUrl: '/assets/garments/companion-polo-front-cutout.png',
            backCutoutUrl: '/assets/garments/companion-polo-back-cutout.png',
            normalMapUrl: '/assets/garments/companion-polo-normal.png',
            normalizedFrontCutoutUrl: '/assets/garments/companion-polo-front-cutout.png',
            normalizedBackCutoutUrl: '/assets/garments/companion-polo-back-cutout.png',
            normalizedNormalMapUrl: '/assets/garments/companion-polo-normal.png',
            dominantHex: '#547049',
          },
        ],
      },
    ],
    products: GOOD_SHOT_PRODUCTS,
    architectNotes: [
      'Constructed a Heritage Arch Flagship featuring a recessed semi-circular fluted sage alcove (#547049) framed by Venetian limewash (#F3EFE6).',
      'Preserved the studio photo cutouts of the Good Shot Club ringer tee, cable-knit cardigan, and pique tennis polo on brushed antique brass racks (#C5A059).',
      'Curated Rowing Blazers crest cap, Jack Carlson regatta monograph, and Actual Source canvas boat tote across Roman travertine pedestals.',
      'Tuned gallery spotlighting to 3400K afternoon lawn-court sunlight with warm hidden LED cove wash.',
    ],
  },

  'kinetic-concrete': {
    id: 'kinetic-concrete',
    brandName: 'KINETIC LAB',
    tagline: 'TECHNICAL ARCHIVE // MILAN · SHIBUYA',
    vibe: 'Brutalist Milan/Tokyo streetwear gallery, monolithic poured concrete & industrial chrome',
    archetype: 'avant_garde_concrete_loft',
    brandEthos:
      'Brutalist Milan-to-Shibuya technical apparel lab investigating monolithic cast-concrete spatial architecture, heavyweight double-faced fleece armor, industrial chrome hardware, and Swiss brutalist typography.',
    palette: {
      wall: '#2B2C2E', // Raw board-formed poured concrete
      floor: '#1D1E20', // Dark charcoal aggregate terrazzo
      accent: '#FF4D00', // Safety international orange architectural neon
      secondaryAccent: '#3A3C40', // Cast concrete reveal trim
      rackMetal: '#D8DCE0', // Precision brushed industrial chrome
      hangerWood: '#222222', // Matte ebonized ash hanger
      plinth: '#25272A', // Monolithic dark concrete cube plinth
      rug: '#2D2F33', // Charcoal low-pile architectural mat
      ambientLight: '#DCE5F2', // Crisp overcast daylight fill
      spotLight: '#F4F7FF', // Cool 5000K theatrical halogen beam
    },
    metalRoughness: 0.16,
    metalness: 0.95,
    lightingPreset: 'cool_gallery_spot',
    textures: {},
    racks: [
      {
        id: 'hero-kinetic-faceout',
        label: 'Monolith Hero Stand 01',
        position: [0, 0, 0],
        rotationY: 0,
        style: 'hero_faceout',
        items: [
          {
            id: 'kl-monolith-hoodie',
            sku: 'RC-3230-BLK',
            title: 'Dual Fleece Standard Hoodie',
            subtitle: 'Reigning Champ · Heavyweight Double-Faced Carbon Black Fleece',
            price: 148,
            featured: true,
            productSpec: KINETIC_CONCRETE_PRODUCTS[0],
            rawUrl:
              '/api/proxy-image?url=https%3A%2F%2Fcdn.shopify.com%2Fs%2Ffiles%2F1%2F1499%2F3122%2Ffiles%2FFW26_RC-3230_BLACK_SWEATER_off_jp.jpg%3Fv%3D1788374874%26width%3D1200',
            dominantHex: '#1E2024',
          },
        ],
      },
      {
        id: 'kinetic-capsule-rail',
        label: 'System Modular Rail 02',
        position: [-1.58, 0, -0.58],
        rotationY: 0.34,
        style: 'capsule_rail',
        items: [
          {
            id: 'kl-stadium-varsity',
            sku: 'RC-3234-HBLK',
            title: 'Wool Fleece Ridge Zip Jacket',
            subtitle: 'Reigning Champ · Heather Black Italian Wool Fleece & Chrome Zip',
            price: 325,
            featured: false,
            productSpec: KINETIC_CONCRETE_PRODUCTS[1],
            rawUrl:
              '/api/proxy-image?url=https%3A%2F%2Fcdn.shopify.com%2Fs%2Ffiles%2F1%2F1499%2F3122%2Ffiles%2FFW26_RC-3234_HEATHERBLACK_SWEATER_off_jp.jpg%3Fv%3D1787778043%26width%3D1200',
            dominantHex: '#25272C',
          },
          {
            id: 'kl-telemetry-tee',
            sku: 'AS-LUDWIG-03',
            title: 'Ludwig Tee',
            subtitle: 'Actual Source · Heavyweight Studio Jersey & Architectural Line Study',
            price: 52,
            featured: false,
            productSpec: KINETIC_CONCRETE_PRODUCTS[2],
            rawUrl:
              '/api/proxy-image?url=https%3A%2F%2Fcdn.shopify.com%2Fs%2Ffiles%2F1%2F0866%2F5580%2Ffiles%2Fweb_0d67e37a-c61c-4052-9605-28ad19eb1c53.jpg%3Fv%3D1787881932%26width%3D1200',
            dominantHex: '#191C24',
          },
        ],
      },
    ],
    products: KINETIC_CONCRETE_PRODUCTS,
    architectNotes: [
      'Built an Avant-Garde Concrete Loft with board-formed poured concrete monolith slabs (#2B2C2E), tie-rod cone dimples, and twin structural concrete columns.',
      'Sliced the feature wall with a vertical safety-orange (#FF4D00) architectural neon tube and raw bolted gunmetal signage.',
      'Merchandised Reigning Champ Dual Fleece & Wool Ridge outerwear alongside Actual Source graphic jersey on industrial chrome rails.',
      'Populated raw concrete cube pedestals and slab table with Reigning Champ Fairway cap, Emil Ruder typography monograph, and Fellow Joey ceramic vessel.',
    ],
  },

  'kyoto-atelier': {
    id: 'kyoto-atelier',
    brandName: 'ATELIER HINOKI',
    tagline: 'ORGANIC TEXTILE STUDY // KYOTO',
    vibe: 'Quiet luxury organic linen, rammed-earth clay & fragrant white-oak sanctuary',
    archetype: 'warm_artisanal_atelier',
    brandEthos:
      'Quiet-luxury Kyoto textile and botanical atelier celebrating fine-gauge sand cotton-cashmere, smoked moss utility twill, warm rammed-earth clay plaster, architectural oak joinery, and Hasami porcelain.',
    palette: {
      wall: '#EAE0D0', // Hand-troweled warm sand rammed-earth clay plaster
      floor: '#D8C9B4', // Warm honed Kurama limestone & travertine slabs
      accent: '#6B705C', // Smoked moss olive botanical accent
      secondaryAccent: '#DFD2BE', // Raw shikkui earth plaster trim
      rackMetal: '#3A3532', // Hand-patinated blackened bronze hardware
      hangerWood: '#B98E63', // Unfinished natural white oak & hinoki timber
      plinth: '#DDD0BC', // Honed warm limestone & oak craft plinth
      rug: '#D4C5AE', // Woven natural jute & undyed bouclé rug
      ambientLight: '#FFEBD2', // Diffused shoji skylight amber fill
      spotLight: '#FFE0B2', // Warm 3000K Kyoto golden-hour wash
    },
    metalRoughness: 0.44,
    metalness: 0.78,
    lightingPreset: 'kyoto_golden_hour',
    textures: {},
    racks: [
      {
        id: 'hero-hinoki-faceout',
        label: 'Atelier Oak Stand',
        position: [0, 0, 0],
        rotationY: 0,
        style: 'hero_faceout',
        items: [
          {
            id: 'ah-loopwheel-tee',
            sku: 'RC-6070-SND',
            title: 'Cotton Cashmere Riviera T-Shirt',
            subtitle: 'Reigning Champ · Fine-Gauge Organic Cotton & Cashmere Knit in Sand',
            price: 118,
            featured: true,
            productSpec: KYOTO_ATELIER_PRODUCTS[0],
            rawUrl:
              '/api/proxy-image?url=https%3A%2F%2Fcdn.shopify.com%2Fs%2Ffiles%2F1%2F1499%2F3122%2Ffiles%2FSS25_RC-6070_SAND_SWEATER_off_jp.jpg%3Fv%3D1737060619%26width%3D1200',
            dominantHex: '#D6CBBF',
          },
        ],
      },
      {
        id: 'hinoki-capsule-rail',
        label: 'Seasonal Craft Rail',
        position: [-1.58, 0, -0.58],
        rotationY: 0.34,
        style: 'capsule_rail',
        items: [
          {
            id: 'ah-moss-hoodie',
            sku: 'RC-3998-COF',
            title: 'Midweight Terry Standard Hoodie',
            subtitle: 'Reigning Champ · Roasted Coffee Earth-Tone Loopback French Terry',
            price: 128,
            featured: false,
            productSpec: KYOTO_ATELIER_PRODUCTS[1],
            rawUrl:
              '/api/proxy-image?url=https%3A%2F%2Fcdn.shopify.com%2Fs%2Ffiles%2F1%2F1499%2F3122%2Ffiles%2FFW26_RC-3998_COFFEE_SWEATER_off_jp.jpg%3Fv%3D1785518280%26width%3D1200',
            dominantHex: '#43362E',
          },
          {
            id: 'ah-linen-blouson',
            sku: 'RC-8057-OLV',
            title: 'Cotton Chino Keeper Standard Overshirt',
            subtitle: 'Reigning Champ · Smoked Dark Olive Twill Utility Chore Jacket',
            price: 158,
            featured: false,
            productSpec: KYOTO_ATELIER_PRODUCTS[2],
            rawUrl:
              '/api/proxy-image?url=https%3A%2F%2Fcdn.shopify.com%2Fs%2Ffiles%2F1%2F1499%2F3122%2Ffiles%2FFW25_RC-8057_DARKOLIVE_SHIRTING_off_jp.jpg%3Fv%3D1756407494%26width%3D1200',
            dominantHex: '#4A4E3B',
          },
        ],
      },
    ],
    products: KYOTO_ATELIER_PRODUCTS,
    architectNotes: [
      'Crafted a Warm Artisanal Atelier framing a wide vertical white-oak timber louver screen (#B98E63) inside hand-troweled rammed-earth plaster (#EAE0D0).',
      'Spanned warm architectural oak ceiling rafters beneath a diffused 3000K golden skylight wash.',
      'Draped sand cotton-cashmere, roasted-umber French terry, and smoked dark-olive chore twill on blackened bronze rails.',
      'Staged KINTO Japan copper aroma oil warmer, FUTO natural canvas tote, and CLK-151 Hasami tea stoneware across timber-and-stone plinths.',
    ],
  },

  'linear-systems': {
    id: 'linear-systems',
    brandName: 'LINEAR SYSTEMS',
    tagline: 'PRECISION HARDWARE & APPAREL // SF · ZURICH',
    vibe: 'Minimalist anodized aluminum & smoked-glass tech pavilion, 0.1mm design studio',
    archetype: 'minimalist_tech_pavilion',
    brandEthos:
      'Design-engineering flagship translating high-velocity software precision into matte anodized obsidian aluminum architecture, smoked optical glass, coffered daylight panels, and studio-grade objects.',
    palette: {
      wall: '#14161C', // Matte anodized obsidian aluminum panels
      floor: '#1A1D24', // Large-format rectified dark basalt slate slabs
      accent: '#6875F5', // Signature optical indigo-violet LED accent
      secondaryAccent: '#252934', // Bead-blasted space-gray aluminum reveal
      rackMetal: '#E2E6EE', // Precision anodized silver-titanium hardware
      hangerWood: '#1D2028', // Matte carbon-billet hanger
      plinth: '#20242E', // Brushed space-gray metal & obsidian drum
      rug: '#171A21', // Low-profile monochrome technical architectural mat
      ambientLight: '#E4ECFF', // Crisp coffered daylight sky wash
      spotLight: '#F5F8FF', // Pure 5400K optical studio beam
    },
    metalRoughness: 0.18,
    metalness: 0.94,
    lightingPreset: 'cool_gallery_spot',
    textures: {},
    racks: [
      {
        id: 'hero-linear-faceout',
        label: 'Precision Stand 01',
        position: [0, 0, 0],
        rotationY: 0,
        style: 'hero_faceout',
        items: [
          {
            id: 'ln-precision-hoodie',
            sku: 'RC-3998-BLK',
            title: 'Midweight Terry Standard Hoodie',
            subtitle: 'Reigning Champ · Matte Obsidian Handcrafted Loopback Fleece',
            price: 128,
            featured: true,
            productSpec: LINEAR_SYSTEMS_PRODUCTS[0],
            rawUrl:
              '/api/proxy-image?url=https%3A%2F%2Fcdn.shopify.com%2Fs%2Ffiles%2F1%2F1499%2F3122%2Ffiles%2FFW26_RC-3998_BLACK_SWEATER_off_jp.jpg%3Fv%3D1794266414%26width%3D1200',
            dominantHex: '#191C24',
          },
        ],
      },
      {
        id: 'linear-capsule-rail',
        label: 'Modular Studio Rail 02',
        position: [-1.58, 0, -0.58],
        rotationY: 0.34,
        style: 'capsule_rail',
        items: [
          {
            id: 'ln-anodized-bomber',
            sku: 'RC-3227-BLK',
            title: 'Midweight Terry Standard Track Jacket',
            subtitle: 'Reigning Champ · Matte Black Stand-Collar Shell & Alloy Zip',
            price: 138,
            featured: false,
            productSpec: LINEAR_SYSTEMS_PRODUCTS[1],
            rawUrl:
              '/api/proxy-image?url=https%3A%2F%2Fcdn.shopify.com%2Fs%2Ffiles%2F1%2F1499%2F3122%2Ffiles%2FFW26_RC-3227_BLACK_SWEATER_off_jp.jpg%3Fv%3D1785518281%26width%3D1200',
            dominantHex: '#222630',
          },
          {
            id: 'ln-supima-tee',
            sku: 'RC-1724-NVY',
            title: 'Lightweight Cordura Pro Shop T-Shirt',
            subtitle: 'Reigning Champ · Abrasion-Resistant Cordura Jersey & CAD Grid Print',
            price: 58.8,
            featured: false,
            productSpec: LINEAR_SYSTEMS_PRODUCTS[2],
            rawUrl:
              '/api/proxy-image?url=https%3A%2F%2Fcdn.shopify.com%2Fs%2Ffiles%2F1%2F1499%2F3122%2Ffiles%2FSS26_RC-1724_NAVY_T-SHIRT_off_jp.jpg%3Fv%3D1785181806%26width%3D1200',
            dominantHex: '#1C2230',
          },
        ],
      },
    ],
    products: LINEAR_SYSTEMS_PRODUCTS,
    architectNotes: [
      'Engineered a Minimalist Tech Pavilion featuring a floor-to-ceiling matte obsidian slat grid divided by vertical cool-LED channels (#6875F5).',
      'Mounted a floating backlit smoked-glass & brushed-titanium monolith sign beneath a luminous 4×3 coffered frosted daylight ceiling.',
      'Hung Reigning Champ obsidian loopback fleece, alloy-zip track shell, and CAD-grid Cordura jersey on silver-titanium rails.',
      'Curated Machines hardware monograph, washed-obsidian tonal monogram cap, and Fellow Carter Move matte black vessel across metal pedestals.',
    ],
  },
};

export const STORE_PRESET_LIST: StoreConfig[] = Object.values(STORE_PRESETS);
