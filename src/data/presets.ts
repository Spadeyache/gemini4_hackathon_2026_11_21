import type { GarmentTuningParams, StoreConfig } from '../types/storeConfig';

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

export const STORE_PRESETS: Record<string, StoreConfig> = {
  'good-shot-club': {
    id: 'good-shot-club',
    brandName: 'GOOD SHOT CLUB',
    tagline: 'CHAMPIONSHIP LAWN & COURT ARCHIVE',
    vibe: 'Heritage Wimbledon tennis club, collegiate warm minimalism',
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
    architectNotes: [
      'Extracted Wimbledon sage (#547049) ringer binding and unbleached ecru body (#F3EFE6) into a recessed fluted timber arch alcove framed by warm Venetian limewash.',
      'Paired brushed antique brass faceout hardware (#C5A059) and sculpted American walnut hangers (#734F32) to echo vintage wooden tennis rackets.',
      'Grounded the hero rack zone with honed Roman travertine (#DDD5C7), a woven oat bouclé rug, and a fluted travertine knitwear plinth.',
      'Tuned gallery spotlighting to 3400K afternoon lawn-court sunlight with warm hidden LED cove wash so cream cotton folds read crisp without highlight clipping.',
    ],
  },

  'kinetic-concrete': {
    id: 'kinetic-concrete',
    brandName: 'KINETIC LAB',
    tagline: 'TECHNICAL ARCHIVE // MILAN · SHIBUYA',
    vibe: 'Brutalist Milan/Tokyo streetwear gallery, monolithic poured concrete & industrial chrome',
    palette: {
      wall: '#2B2C2E', // Raw board-formed poured concrete
      floor: '#1D1E20', // Dark charcoal aggregate terrazzo
      accent: '#FF4D00', // Safety international orange architectural accent
      secondaryAccent: '#3A3C40', // Cast concrete reveal trim
      rackMetal: '#D8DCE0', // Precision brushed industrial chrome
      hangerWood: '#222222', // Matte ebonized ash hanger
      plinth: '#25272A', // Monolithic dark basalt plinth
      rug: '#2D2F33', // Charcoal low-pile architectural mat
      ambientLight: '#DCE5F2', // Crisp overcast daylight fill
      spotLight: '#F4F7FF', // Cool 5000K museum halogen beam
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
            id: 'good-shot-ringer-tee',
            sku: 'KL-ARC-TEE-01',
            title: 'Archive Graphic Contrast Tee',
            subtitle: 'Kinetic Lab Capsule · 280GSM Heavyweight Jersey',
            price: 68,
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
        id: 'kinetic-capsule-rail',
        label: 'System Modular Rail 02',
        position: [-1.58, 0, -0.58],
        rotationY: 0.34,
        style: 'capsule_rail',
        items: [
          {
            id: 'companion-cardigan',
            sku: 'KL-STRUCT-02',
            title: 'Structured Gauge Knit Layer',
            subtitle: 'Heavy Tactile Stitch · Milan Studio Edition',
            price: 240,
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
            sku: 'KL-TECH-03',
            title: 'Mercerized Pique Knit Top',
            subtitle: 'High-Twist Technical Cotton · Matte Snap Placket',
            price: 135,
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
    architectNotes: [
      'Morphed spatial shell to poured concrete (#2B2C2E) and dark charcoal terrazzo (#1D1E20) to create high-contrast gallery pop behind light garments.',
      'Injected safety international orange (#FF4D00) into the recessed fluted alcove and cove light perimeter for unmistakable Tokyo/Milan drop urgency.',
      'Swapped rack metallurgy to low-roughness brushed chrome (#D8DCE0) with matte ebonized ash hangers (#222222).',
      'Shifted lighting rig to crisp cool-white museum track spots with city HDRI reflections for sharp specular edge definition.',
    ],
  },

  'kyoto-atelier': {
    id: 'kyoto-atelier',
    brandName: 'ATELIER HINOKI',
    tagline: 'ORGANIC TEXTILE STUDY // KYOTO',
    vibe: 'Quiet luxury organic linen & fragrant hinoki timber sanctuary',
    palette: {
      wall: '#EAE0D0', // Hand-troweled warm sand juraku clay plaster
      floor: '#C4A482', // Wide-plank natural Japanese cedar floor
      accent: '#6B705C', // Smoked moss olive architectural slat panel
      secondaryAccent: '#DFD2BE', // Raw shikkui earth plaster trim
      rackMetal: '#3A3532', // Hand-patinated blackened bronze rack
      hangerWood: '#C89F70', // Unfinished aromatic hinoki cypress hanger
      plinth: '#D8C8B0', // Honed Kurama sandstone & timber plinth
      rug: '#D4C7B4', // Undyed hemp & organic linen weave mat
      ambientLight: '#FFEBD2', // Diffused shoji screen amber fill
      spotLight: '#FFDCA8', // Late-afternoon Kyoto golden-hour wash
    },
    metalRoughness: 0.44,
    metalness: 0.78,
    lightingPreset: 'kyoto_golden_hour',
    textures: {},
    racks: [
      {
        id: 'hero-hinoki-faceout',
        label: 'Tokonoma Alcove Stand',
        position: [0, 0, 0],
        rotationY: 0,
        style: 'hero_faceout',
        items: [
          {
            id: 'good-shot-ringer-tee',
            sku: 'AH-KYT-TEE-01',
            title: 'Unbleached Loopwheel Ringer Tee',
            subtitle: 'Atelier Hinoki · Wakayama Slow-Knit Organic Cotton',
            price: 88,
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
        id: 'hinoki-capsule-rail',
        label: 'Seasonal Craft Rail',
        position: [-1.58, 0, -0.58],
        rotationY: 0.34,
        style: 'capsule_rail',
        items: [
          {
            id: 'companion-cardigan',
            sku: 'AH-LINEN-02',
            title: 'Hand-Framed Raw Cotton Cardigan',
            subtitle: 'Natural Ecru & Botanical Moss Dye Trim',
            price: 215,
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
            sku: 'AH-MOSS-03',
            title: 'Botanical Dyed Slub Knit Polo',
            subtitle: 'Kyoto Moss Olive · Smoked Trochus Shell Buttons',
            price: 128,
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
    architectNotes: [
      'Reinterpreted the central arch as a calm Kyoto tokonoma alcove in smoked moss olive (#6B705C) set within warm juraku sand clay plaster (#EAE0D0).',
      'Grounded the space with natural Japanese cedar flooring (#C4A482) and an undyed hemp-linen area weave (#D4C7B4).',
      'Specified hand-patinated blackened bronze rails (#3A3532) and aromatic pale hinoki cypress hangers (#C89F70) for quiet luxury tactility.',
      'Bathed the showroom in low-angle 2900K golden-hour light to emphasize natural slub cotton texture and soft shadow falloff.',
    ],
  },
};

export const STORE_PRESET_LIST: StoreConfig[] = Object.values(STORE_PRESETS);
