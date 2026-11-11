
import { searchSupplierWeb } from "./supplierSearch.js";
import supabase from "../supabase.js";
import { classifySuppliers } from "../ai/supplierClassifier.js";
import { extractCompaniesFromSupplierSources } from "../ai/supplierExtractor.js";

// Maximum number of supplier leads returned to the frontend.
const MAX_SUPPLIERS = 15;

// Preferred supplier order.
const SUPPLIER_PRIORITY = {
  manufacturer: 1,
  distributor: 2,
  wholesaler: 3,
  retailer: 4,
  marketplace: 5,
};

// =====================================================
// CONTACT AND SOCIAL NORMALIZATION
// =====================================================

function normalizeSocials(item = {}) {
  const socials = item.socials || item.socialLinks || {};

  return {
    facebook:
      socials.facebook ||
      item.facebook ||
      item.facebookUrl ||
      null,

    linkedin:
      socials.linkedin ||
      item.linkedin ||
      item.linkedinUrl ||
      null,

    instagram:
      socials.instagram ||
      item.instagram ||
      item.instagramUrl ||
      null,

    x:
      socials.x ||
      socials.twitter ||
      item.twitter ||
      item.x ||
      item.twitterUrl ||
      null,
  };
}

// =====================================================
// SUPPLIER NORMALIZATION
// =====================================================

function normalizeSupplier(item, requestedProduct) {
  let name = "Supplier lead";
  let website = null;
  let description = "";

  if (typeof item === "string") {
    const match = item.match(
      /\[([^\]]+)\]\((https?:\/\/[^)]+)\)/
    );

    name = match?.[1] || "Supplier lead";
    website = match?.[2] || null;
    description = item;
  } else {
    website =
      typeof item?.url === "string"
        ? item.url
        : item?.website || null;

    name = item?.title || item?.name || "Supplier lead";

    const contents = item?.contents;

    description = [
      item?.description,
      ...(Array.isArray(item?.snippets) ? item.snippets : []),
      ...(Array.isArray(item?.highlights) ? item.highlights : []),
      ...(Array.isArray(contents?.highlights)
        ? contents.highlights
        : []),
    ]
      .filter(Boolean)
      .join(" ");
  }

  const data = typeof item === "object" && item !== null
    ? item
    : {};

  return {
    id: website || `${name}-${requestedProduct}`,
    name,
    website,
    source: website,
    description,

    matchedProduct: requestedProduct,

    supplierType: "unknown",
    category: "Unknown",

    address: data.address || null,
    location: data.location || null,
    country: data.country || null,

    contactName:
      data.contactName ||
      data.contact_name ||
      null,

    contactEmail:
      data.contactEmail ||
      data.email ||
      null,

    contactPhone:
      data.contactPhone ||
      data.phone ||
      null,

    socials: normalizeSocials(data),

    verificationStatus: "unverified",

    evidence: {
      productMatch: "not_checked",
      companyIdentity: "not_checked",
      contactDetails: "not_checked",
      stockAvailability: "not_checked",
      pricing: "not_checked",
    },
  };
}

// =====================================================
// URL NORMALIZATION AND DEDUPLICATION
// =====================================================

function normalizeUrl(url) {
  if (!url) return null;

  try {
    const parsed = new URL(url);

    parsed.hash = "";

    [
      "utm_source",
      "utm_medium",
      "utm_campaign",
      "utm_term",
      "utm_content",
    ].forEach((key) => parsed.searchParams.delete(key));

    return parsed.toString().replace(/\/$/, "").toLowerCase();
  } catch {
    return url.trim().toLowerCase();
  }
}

function getSupplierKey(supplier) {
  if (supplier.website) {
    return normalizeUrl(supplier.website);
  }

  return `${supplier.name.toLowerCase().trim()}-${supplier.matchedProduct.toLowerCase()}`;
}

function getCategory(supplierType) {
  if (!supplierType || supplierType === "unknown") {
    return "Unknown";
  }

  return supplierType.charAt(0).toUpperCase() + supplierType.slice(1);
}



function inferSupplierType(supplier) {
  const text = [
    supplier.name,
    supplier.description,
    supplier.website,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  // Check wholesaler first to avoid misleading
  // manufacturer mentions in FAQ questions.
  if (
    /\b(wholesaler|wholesale|bulk supplier|bulk seller)\b/.test(text)
  ) {
    return "wholesaler";
  }

  if (
    /\b(manufacturer|manufacturing|factory|producer|production plant)\b/.test(text)
  ) {
    return "manufacturer";
  }

  if (
    /\b(distributor|distribution company|authorized distributor)\b/.test(text)
  ) {
    return "distributor";
  }

  if (
    /\b(retailer|retail store|shop|online store)\b/.test(text)
  ) {
    return "retailer";
  }

  if (
    /\b(marketplace|supplier directory|trade directory|b2b platform)\b/.test(text)
  ) {
    return "marketplace";
  }

  return "unknown";
}

function applyFallbackClassification(suppliers) {
  const validTypes = [
    "manufacturer",
    "distributor",
    "wholesaler",
    "retailer",
    "marketplace",
  ];

  return suppliers.map((supplier) => {
    const existingType = String(
      supplier.supplierType || ""
    ).trim().toLowerCase();

    const evidenceType = inferSupplierType(supplier);

    const supplierType =
      evidenceType !== "unknown"
        ? evidenceType
        : validTypes.includes(existingType)
          ? existingType
          : "unknown";

    return {
      ...supplier,
      supplierType,
      category: getCategory(supplierType),
      verificationStatus: "unverified",
    };
  });
}

function identifySourceType(supplier) {
  const name = String(supplier.name || "").toLowerCase();
  const description = String(supplier.description || "").toLowerCase();
  const url = String(supplier.website || "").toLowerCase();

  const text = `${name} ${description} ${url}`;

  // Buyer listings are not suppliers.
  if (
    /\/buyers?(?:\/|$)/i.test(url) ||
    /\bbuyers?\s*(?:&|and)\s*importers\b/i.test(text) ||
    /\bbuy leads?\b/i.test(text) ||
    /\blooking to buy\b/i.test(text)
  ) {
    return "buyer_listing";
  }

  // Directories and marketplaces are discovery sources,
  // not individual supplier companies.
  if (
    /\/(?:directory|database|companies\/browse|suppliers\/browse)(?:\/|[-_.?]|$)/i.test(url) ||
    /\b(global sources|go4worldbusiness)\b/i.test(text) ||
    /\b(marketplace|supplier directory|trade directory|b2b platform)\b/i.test(text) ||
    /\b(find suppliers|browse suppliers|list of suppliers|wholesale products from \d+ suppliers)\b/i.test(text) ||
    /\b(database of manufacturers|manufacturers database|company database)\b/i.test(text)
  ) {
    return "research_source";
  }

  // Research articles, rankings, reports and statistics.
  if (
    /\/(?:research|insights?|blogs?|reports?|ranking|rankings|statistics|publications?)(?:\/|[-_.?]|$)/i.test(url) ||
    /\.pdf(?:[?#]|$)/i.test(url) ||
    /\b(market research|research report|industry report|market overview|market forecast|market size|production statistics)\b/i.test(text) ||
    /\btop\s+\d+\b.{0,80}\b(companies|manufacturers|suppliers)\b/i.test(text) ||
    /\blist of\b.{0,80}\b(companies|manufacturers|suppliers)\b/i.test(text) ||
    /\b(companies ranked by|leading seed companies|economic research service|access to seeds index)\b/i.test(text) ||
    /\b(download the current view|search and filter|market capitalization|market cap)\b/i.test(text)
  ) {
    return "research_source";
  }

  return "supplier";
}


// =====================================================
// EXTRACTED COMPANY NORMALIZATION
// =====================================================

function normalizeExtractedCompany(company, requestedProduct) {
  const sourceUrl = company.source || null;

  return {
    id: company.id || `${company.name}-${requestedProduct}`,
    name: company.name || "Unnamed company",

    website:
      company.website ||
      company.officialWebsite ||
      null,

    // Original page where the company was discovered.
    source: sourceUrl,
    sourceTitle: company.sourceTitle || null,

    description: company.evidenceSummary || "",
    evidenceSummary: company.evidenceSummary || "",

    matchedProduct:
      company.matchedProduct || requestedProduct,

    supplierType: company.supplierType || "unknown",

    category: getCategory(company.supplierType),

    country: company.country || null,
    location: company.location || null,
    address: company.address || null,

    products: Array.isArray(company.products)
      ? company.products
      : [],

    contactName: company.contactName || null,
    contactEmail:
      company.contactEmail ||
      company.email ||
      null,

    contactPhone:
      company.contactPhone ||
      company.phone ||
      null,

    socials: normalizeSocials(company),

    sourceType: company.sourceType || "unknown",

    verificationStatus: "unverified",

    evidence: {
      productMatch: "not_checked",
      companyIdentity: "not_checked",
      contactDetails: "not_checked",
      stockAvailability: "not_checked",
      pricing: "not_checked",
    },
  };
}

// =====================================================
// SUPPLIER PRIORITY SORTING
// =====================================================

function getSupplierPriority(supplier) {
  const type = String(
    supplier.supplierType || "unknown"
  ).toLowerCase();

  return SUPPLIER_PRIORITY[type] || 99;
}

function rankSuppliers(suppliers) {
  return [...suppliers].sort((a, b) => {
    const priorityDifference =
      getSupplierPriority(a) - getSupplierPriority(b);

    if (priorityDifference !== 0) {
      return priorityDifference;
    }

    // Within the same category, prefer leads with more
    // available contact information.
    const aContacts = [
      a.contactPhone,
      a.contactEmail,
      a.address,
      a.website,
    ].filter(Boolean).length;

    const bContacts = [
      b.contactPhone,
      b.contactEmail,
      b.address,
      b.website,
    ].filter(Boolean).length;

    return bContacts - aContacts;
  });
}

// =====================================================
// MAIN SUPPLIER SEARCH SERVICE
// =====================================================


async function saveSuppliersToDatabase(suppliers) {
  if (!Array.isArray(suppliers) || suppliers.length === 0) {
    return { saved: 0, error: null };
  }

  const records = suppliers
    .filter((supplier) => supplier.name && supplier.website)
    .map((supplier) => ({
      company_name: supplier.name,
      products: [
        ...new Set([
          supplier.matchedProduct,
          ...(Array.isArray(supplier.products)
            ? supplier.products
            : []),
        ].filter(Boolean)),
      ],
      supplier_type: supplier.supplierType || "unknown",
      country: supplier.country || null,
      city: supplier.location || null,
      website: supplier.website,
      description: supplier.description || "",
      source_url: supplier.source || supplier.website,
      source_provider: supplier.sourceProvider || null,
      verification_status: supplier.verificationStatus || "unverified",
      updated_at: new Date().toISOString(),
    }));

  if (!records.length) {
    return { saved: 0, error: null };
  }

  const websites = records.map((record) => record.website);

  const { data: existing, error: lookupError } = await supabase
    .from("suppliers")
    .select("website")
    .in("website", websites);

  if (lookupError) {
    console.error("Supplier database lookup failed:", lookupError.message);
    return { saved: 0, error: lookupError.message };
  }

  const existingWebsites = new Set(
    (existing || []).map((item) => item.website)
  );

  const newRecords = records.filter(
    (record) => !existingWebsites.has(record.website)
  );

  if (!newRecords.length) {
    return { saved: 0, error: null };
  }

  const { data, error } = await supabase
    .from("suppliers")
    .insert(newRecords)
    .select("id");

  if (error) {
    console.error("Supplier database save failed:", error.message);
    return { saved: 0, error: error.message };
  }

  return { saved: data?.length || 0, error: null };
}


export async function searchSuppliers({ product, location }) {
  if (!location?.trim()) {
    throw new Error("A delivery location is required.");
  }

  const products = (
    Array.isArray(product) ? product : [product]
  )
    .filter(
      (item) => typeof item === "string" && item.trim()
    )
    .map((item) => item.trim());

  if (!products.length) {
    throw new Error("At least one product is required.");
  }

  // ---------------------------------------------------
  // 1. SEARCH FOR EACH REQUESTED PRODUCT
  // ---------------------------------------------------

  const searches = await Promise.all(
    products.map(async (item) => {


const query =
  `Find actual companies supplying ${item} worldwide. ` +
  `Search across all countries and regions without geographic restrictions. ` +
  `Return individual manufacturers, distributors, wholesalers and retailers ` +
  `with their own company websites and available contact details. ` +
  `Include each company's country and location. ` +
  `The buyer's delivery destination is ${location}; use this only ` +
  `for delivery relevance, never to restrict supplier discovery. ` +
  `Avoid research articles, statistics, rankings and generic directories. ` +
  `Do not invent prices, stock, certifications or shipping availability.`;

      try {
        const result = await searchSupplierWeb(query, location);

        const rawResults = Array.isArray(result?.results)
          ? result.results
          : [];

        const leads = rawResults.map((supplier) => ({
          ...normalizeSupplier(supplier, item),

          sourceProvider:
            supplier?.provider || result?.provider || null,
        }));

return {
  product: item,
  suppliers: leads,
  provider: result?.provider || null,
  providerErrors: result?.errors || [],
  strategy: result?.strategy || null,
  error: null,
};

      } catch (error) {
        console.error(
          `Supplier search failed for ${item}:`,
          error
        );

return {
  product: item,
  suppliers: [],
  provider: null,
  providerErrors: [],
  strategy: null,
  error: error?.message || "Supplier search failed.",
};

      }
    })
  );

  // ---------------------------------------------------
  // 2. COMBINE AND DEDUPLICATE SEARCH RESULTS
  // ---------------------------------------------------

  const allLeads = searches.flatMap(
    (search) => search.suppliers
  );

  const uniqueSuppliers = Array.from(
    new Map(
      allLeads.map((supplier) => [
        getSupplierKey(supplier),
        supplier,
      ])
    ).values()
  );

  // ---------------------------------------------------
  // 3. EXTRACT INDIVIDUAL COMPANIES FROM SOURCES
  // ---------------------------------------------------

  let extractedCompanies = [];
  let extractorProvider = null;
  let extractorErrors = [];

  if (uniqueSuppliers.length > 0) {
    try {
      const extractionSources = uniqueSuppliers.map(
        (supplier) => ({
          id: supplier.id,
          title: supplier.name,
          url: supplier.website,
          description: supplier.description || "",
        })
      );

      const extractionResult =
        await extractCompaniesFromSupplierSources(
          extractionSources,
          products.join(", "),
          location
        );

      extractorProvider = extractionResult?.provider || null;
      extractorErrors = extractionResult?.errors || [];

      const rawCompanies = Array.isArray(
        extractionResult?.companies
      )
        ? extractionResult.companies
        : [];

      extractedCompanies = rawCompanies
        .filter(
          (company) =>
            company &&
            typeof company.name === "string" &&
            company.name.trim()
        )
        .map((company) =>
          normalizeExtractedCompany(
            company,
            products.join(", ")
          )
        );
    } catch (error) {
      console.error("Company extraction failed:", error);

      extractorErrors.push({
        provider: "supplier-extractor",
        error:
          error?.message || "Company extraction failed.",
      });
    }
  }

  // ---------------------------------------------------
  // 4. AVOID SHOWING DIRECTORY PAGES AS SUPPLIERS
  // ---------------------------------------------------

  const sourcePagesWithExtractedCompanies = new Set(
    extractedCompanies
      .filter((company) =>
        [
          "directory",
          "marketplace",
          "research",
          "social_media",
          "product_information",
        ].includes(company.sourceType)
      )
      .map((company) => normalizeUrl(company.source))
      .filter(Boolean)
  );

  const classifiedSourceResults = uniqueSuppliers.map((supplier) => ({
  ...supplier,
  sourceType: identifySourceType(supplier),
}));

const researchSources = classifiedSourceResults.filter(
  (supplier) => supplier.sourceType === "research_source"
);

const directSupplierLeads = classifiedSourceResults.filter(
  (supplier) =>
    supplier.sourceType === "supplier" &&
    !sourcePagesWithExtractedCompanies.has(
      normalizeUrl(supplier.website)
    )
);

  // Keep original direct supplier leads and add
  // individual companies extracted from research sources.
  const eligibleExtractedCompanies = extractedCompanies.filter(
  (company) => {
    const sourceUrl = normalizeUrl(company.source);

    const hasIndependentWebsite =
      company.website &&
      normalizeUrl(company.website) !== sourceUrl;

    const cameFromResearchSource =
      researchSources.some(
        (source) =>
          normalizeUrl(source.website) === sourceUrl
      );

    return (
      hasIndependentWebsite ||
      !cameFromResearchSource
    );
  }
);

const combinedLeads = [
  ...directSupplierLeads,
];
  // Deduplicate again, preferring extracted company
  // records when the same official website appears.
  const combinedMap = new Map();

  for (const supplier of combinedLeads) {
    const key = getSupplierKey(supplier);
    const existing = combinedMap.get(key);

    if (!existing || supplier.evidenceSummary) {
      combinedMap.set(key, supplier);
    }
  }

  const leadsForClassification = Array.from(
    combinedMap.values()
  );

  // ---------------------------------------------------
  // 5. CLASSIFY SUPPLIERS USING AI
  // ---------------------------------------------------

  let classifiedSuppliers = leadsForClassification;
  let classifierProvider = null;
  let classifierModel = null;
  let classifierErrors = [];

  if (leadsForClassification.length > 0) {
    try {
      const classificationResult = await classifySuppliers(
        leadsForClassification,
        products.join(", "),
        location
        );
const aiSuppliers = Array.isArray(
  classificationResult?.suppliers
)
  ? classificationResult.suppliers
  : [];

const originalByWebsite = new Map(
  leadsForClassification
    .filter((supplier) => supplier.website)
    .map((supplier) => [
      normalizeUrl(supplier.website),
      supplier,
    ])
);

const originalByName = new Map(
  leadsForClassification.map((supplier) => [
    String(supplier.name || "").trim().toLowerCase(),
    supplier,
  ])
);

classifiedSuppliers = aiSuppliers.map((supplier) => {
  const original =
    (supplier.website &&
      originalByWebsite.get(normalizeUrl(supplier.website))) ||
    originalByName.get(
      String(supplier.name || "").trim().toLowerCase()
    );

  return {
    ...(original || {}),
    ...supplier,

    description: [
  original?.description,
  supplier.description,
]
  .filter(Boolean)
  .join(" "),

    website:
      supplier.website || original?.website || null,

    matchedProduct:
      supplier.matchedProduct ||
      original?.matchedProduct ||
      products.join(", "),

    evidence:
      supplier.evidence || original?.evidence,
  };
});

      classifierProvider =
        classificationResult.provider;

      classifierModel =
        classificationResult.model;

      classifierErrors =
        classificationResult.providerErrors || [];

      classifiedSuppliers = classifiedSuppliers.map(
        (supplier) => ({
          ...supplier,

          category: getCategory(supplier.supplierType),

          verificationStatus: "unverified",
        })
      );
    } catch (error) {
      console.error(
        "Supplier AI classification failed:",
        error
      );

      classifierErrors.push({
        provider: "supplier-classifier",
        error:
          error?.message || "AI classification failed.",
      });
    }
  }
// Always provide deterministic classification when AI
// is unavailable or returns unknown supplier types.
classifiedSuppliers = applyFallbackClassification(
  classifiedSuppliers
);
  // ---------------------------------------------------
  // 6. RANK AND LIMIT RESULTS TO 15
  // ---------------------------------------------------

  const finalSuppliers = rankSuppliers(
    classifiedSuppliers
  ).slice(0, MAX_SUPPLIERS);
let databaseSave = { saved: 0, error: null };

try {
  databaseSave = await saveSuppliersToDatabase(finalSuppliers);

  console.log(
    `Supabase saved ${databaseSave.saved} new suppliers.`
  );
} catch (error) {
  databaseSave.error = error.message;
  console.error("Supplier database save failed:", error.message);
}
  // ---------------------------------------------------
  // 7. COLLECT SEARCH AND AI ERRORS
  // ---------------------------------------------------

  const failedSearches = searches.filter(
    (search) => search.error
  );

  const providerErrors = [
    ...searches.flatMap((search) =>
      (search.providerErrors || []).map((failure) => ({
        product: search.product,
        provider: failure.provider,
        error: failure.error,
      }))
    ),

    ...extractorErrors,
    ...classifierErrors,
  ];

  // ---------------------------------------------------
  // 8. RETURN SUPPLIER DISCOVERY RESULTS
  // ---------------------------------------------------

  return {
    status: finalSuppliers.length
      ? "leads_found"
      : "no_results",

    message: finalSuppliers.length
      ? `Up to ${MAX_SUPPLIERS} supplier leads discovered through web search and AI extraction. Verify each company and offer before procurement.`
      : failedSearches.length === searches.length
        ? "All supplier searches failed. Check the search providers and server logs."
        : "No supplier leads were returned. Try refining the product description or location.",


    provider: "Multi-provider search",
database: {
  saved: databaseSave.saved,
  error: databaseSave.error,
},
    extractor: {
      provider: extractorProvider,

      status: extractorProvider
        ? "completed"
        : extractedCompanies.length
          ? "completed"
          : "unavailable",

      companiesExtracted: extractedCompanies.length,
    },

    classifier: {
      provider: classifierProvider,
      model: classifierModel,

      status: classifierProvider
        ? "completed"
        : classifiedSuppliers.length
          ? "unavailable"
          : "not_run",
    },

    searches,
    providerErrors,

    researchSources,

    totalLeadsBeforeLimit: classifiedSuppliers.length,
    totalLeadsReturned: finalSuppliers.length,

    suppliers: finalSuppliers,
  };
}
