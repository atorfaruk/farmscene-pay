
export const AGRICULTURAL_CATEGORIES = {
  seeds: {
    label: "Seeds and planting materials",
    hsCodes: ["1209"],
    keywords: [
      "crop seeds",
      "planting seeds",
      "seeds for sowing",
      "rice seeds",
      "maize seeds",
      "wheat seeds",
      "vegetable seeds",
      "hybrid seeds",
      "planting materials",
      "seed supplier",
      "seed distributor",
    ],
  },

  fertilizers: {
    label: "Fertilizers and soil nutrients",
    hsCodes: ["3101", "3102", "3103", "3104", "3105"],
    keywords: [
      "fertilizer",
      "fertiliser",
      "organic fertilizer",
      "nitrogen fertilizer",
      "phosphate fertilizer",
      "potash",
      "soil nutrients",
      "plant nutrients",
      "soil conditioner",
    ],
  },

  pesticides: {
    label: "Pesticides and crop protection",
    hsCodes: ["3808"],
    keywords: [
      "pesticide",
      "insecticide",
      "herbicide",
      "fungicide",
      "crop protection",
      "weed control",
      "plant disease control",
      "agricultural chemicals",
    ],
  },

  machinery: {
    label: "Farm machinery and equipment",
    hsCodes: ["8432", "8433", "8434", "8435", "8436", "8437"],
    keywords: [
      "agricultural machinery",
      "farm machinery",
      "tractor",
      "harvester",
      "seed drill",
      "planter machine",
      "cultivator",
      "plough",
      "thresher",
      "combine harvester",
      "farm equipment",
    ],
  },

  tools: {
    label: "Farm tools and implements",
    hsCodes: ["8201"],
    keywords: [
      "farm tools",
      "agricultural tools",
      "hand tools for farming",
      "hoe",
      "machete",
      "sickle",
      "pruning shears",
      "spade",
      "shovel",
      "rake",
    ],
  },

  irrigation: {
    label: "Irrigation equipment and systems",
    hsCodes: ["8424", "8413", "8481"],
    keywords: [
      "irrigation equipment",
      "irrigation system",
      "drip irrigation",
      "sprinkler system",
      "irrigation pumps",
      "water pumps for irrigation",
      "irrigation pipes",
      "irrigation valves",
      "agricultural water management",
    ],
  },
};

// These codes can cover products beyond the agricultural category.
// They must never independently establish that a supplier sells
// the specific agricultural product.
const BROAD_HS_CODE_NOTES = {
  "3808": "This code covers several chemical products, not exclusively agricultural pesticides.",
  "8424": "This code covers spraying and projecting equipment beyond irrigation systems.",
  "8413": "This code covers pumps for many applications, not exclusively irrigation.",
  "8481": "This code covers valves for many applications, not exclusively irrigation.",
};

function normalizeText(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

// Only structured product fields count as direct product evidence.
// General summaries, FAQs, company names and industry descriptions
// are deliberately excluded.
const PRODUCT_FIELDS = [
  "products",
  "productNames",
  "productCategories",
  "tradeProducts",
  "productDescription",
  "productsDescription",
  "mainProducts",
  "productLines",
];

function collectProductText(source) {
  if (!source || typeof source !== "object") return [];

  const values = [];

  for (const field of PRODUCT_FIELDS) {
    const value = source[field];

    if (typeof value === "string") {
      values.push({ field, text: value });
    } else if (Array.isArray(value)) {
      for (const item of value) {
        if (typeof item === "string") {
          values.push({ field, text: item });
        } else if (item && typeof item === "object") {
          const label =
            item.name ??
            item.title ??
            item.product ??
            item.description;

          if (typeof label === "string") {
            values.push({ field, text: label });
          }
        }
      }
    }
  }

  return values;
}

function collectHsCodes(source) {
  if (!source || typeof source !== "object") return [];

  const possibleFields = [
    "hsCodes",
    "hs_codes",
    "hsCode",
    "hs_code",
    "customsCodes",
  ];

  const codes = [];

  for (const field of possibleFields) {
    const value = source[field];
    const items = Array.isArray(value) ? value : [value];

    for (const item of items) {
      let rawCode = item;

      if (item && typeof item === "object") {
        rawCode =
          item.code ??
          item.hsCode ??
          item.hs_code ??
          item.value;
      }

      if (rawCode == null) continue;

      const digits = String(rawCode).replace(/\D/g, "");

      if (digits.length >= 4) {
        codes.push(digits.slice(0, 4));
      }
    }
  }

  return [...new Set(codes)];
}

function getSupplierSources(supplier) {
  const profile = supplier?.reevolProfile ?? {};

  return [supplier, profile].filter(Boolean);
}

export function classifyAgriculturalRelevance(supplier) {
  const sources = getSupplierSources(supplier);

  const productEvidence = sources.flatMap(collectProductText);

  const hsCodes = [
    ...new Set(sources.flatMap(collectHsCodes)),
  ];

  const matchedCategories = [];

  for (const [categoryKey, category] of Object.entries(
    AGRICULTURAL_CATEGORIES
  )) {
    const keywordEvidence = [];

    for (const product of productEvidence) {
      const normalizedProduct = normalizeText(product.text);

      for (const keyword of category.keywords) {
        if (normalizedProduct.includes(normalizeText(keyword))) {
          keywordEvidence.push({
            keyword,
            sourceField: product.field,
          });
        }
      }
    }

    const hsCodeEvidence = hsCodes.filter((code) =>
      category.hsCodes.includes(code)
    );

    if (keywordEvidence.length || hsCodeEvidence.length) {
      const hasDirectEvidence = keywordEvidence.length > 0;

      const broadCodes = hsCodeEvidence.filter(
        (code) => BROAD_HS_CODE_NOTES[code]
      );

      matchedCategories.push({
        category: categoryKey,
        label: category.label,

        keywordEvidence,
        hsCodeEvidence,

        evidenceLevel: hasDirectEvidence
          ? "product_field_match"
          : "hs_code_only",

        categoryStatus: hasDirectEvidence
          ? "needs_confirmation"
          : "needs_review",

        reviewReason: hasDirectEvidence
          ? "A dedicated product field matches this category, but the supplier's actual products still require confirmation."
          : "The category is suggested by trade codes only. The actual products have not been established.",

        hsCodeLimitations: broadCodes.map((code) => ({
          code,
          note: BROAD_HS_CODE_NOTES[code],
        })),
      });
    }
  }

  const hasProductEvidence = matchedCategories.some(
    (category) => category.evidenceLevel === "product_field_match"
  );

  const hasHsEvidence = matchedCategories.some(
    (category) => category.evidenceLevel === "hs_code_only"
  );

  let agriculturalRelevance = "unrelated";

  if (hasProductEvidence) {
    agriculturalRelevance = "evidence_found";
  } else if (hasHsEvidence) {
    agriculturalRelevance = "needs_review";
  }

  return {
    ...supplier,

    agriculturalRelevance,

    agriculturalCategories: matchedCategories,

    agriculturalEvidence: {
      productFieldsChecked: [
        ...new Set(productEvidence.map((item) => item.field)),
      ],

      hsCodes,

      note:
        "Product-field matches are preliminary evidence, not independent verification. HS codes are trade classification clues and do not establish the supplier's actual products. General summaries, FAQs, company names and industry descriptions are excluded.",
    },
  };
}

export function filterAgriculturalSuppliers(suppliers = []) {
  return suppliers
    .map(classifyAgriculturalRelevance)
    .filter(
      (supplier) => supplier.agriculturalRelevance !== "unrelated"
    );
}
