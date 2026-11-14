
import {
  extractCompaniesFromSupplierSources as extractWithGroq,
} from "./groq.js";

import {
  extractCompaniesFromSupplierSources as extractWithGemini,
} from "./gemini.js";

// =====================================================
// AI PROVIDERS
// =====================================================

const PROVIDERS = [
  { name: "groq", extract: extractWithGroq },
  { name: "gemini", extract: extractWithGemini },
];

const BATCH_SIZE = 3;
const TIMEOUT_MS = 15000;
const MAX_RETRIES = 1;

const VALID_SUPPLIER_TYPES = [
  "manufacturer",
  "distributor",
  "wholesaler",
  "retailer",
  "marketplace",
  "unknown",
];

const VALID_SOURCE_TYPES = [
  "direct_supplier",
  "directory",
  "marketplace",
  "research",
  "social_media",
  "product_information",
  "unknown",
];

// =====================================================
// HELPERS
// =====================================================

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getErrorMessage(error) {
  return String(error?.message || error || "Unknown error");
}

function isDailyLimitError(error) {
  const message = getErrorMessage(error).toLowerCase();

  return (
    message.includes("tokens per day") ||
    message.includes("daily token limit") ||
    message.includes("tpd") ||
    message.includes("per day limit")
  );
}

function isRateLimitError(error) {
  const message = getErrorMessage(error).toLowerCase();

  return (
    message.includes("rate limit") ||
    message.includes("429") ||
    message.includes("too many requests") ||
    message.includes("tokens per minute") ||
    message.includes("tpm") ||
    message.includes("quota exceeded")
  );
}

function getRetryDelay(error) {
  const message = getErrorMessage(error);

  const match = message.match(
    /try again in\s+([\d.]+)\s*s/i
  );

  return match
    ? Math.ceil(Number(match[1]) * 1000) + 1500
    : 20000;
}

function normalizeSupplierType(value) {
  const type = String(value || "unknown")
    .toLowerCase()
    .trim()
    .replace(/[\s-]+/g, "_");

  return VALID_SUPPLIER_TYPES.includes(type)
    ? type
    : "unknown";
}

function normalizeSourceType(value) {
  const type = String(value || "unknown")
    .toLowerCase()
    .trim()
    .replace(/[\s-]+/g, "_");

  return VALID_SOURCE_TYPES.includes(type)
    ? type
    : "unknown";
}

function cleanString(value) {
  if (typeof value !== "string") return null;

  const cleaned = value.trim();

  return cleaned || null;
}

function normalizeSocials(company = {}) {
  const socials =
    company.socials ||
    company.socialLinks ||
    {};

  return {
    facebook:
      cleanString(socials.facebook) ||
      cleanString(company.facebook) ||
      cleanString(company.facebookUrl),

    linkedin:
      cleanString(socials.linkedin) ||
      cleanString(company.linkedin) ||
      cleanString(company.linkedinUrl),

    instagram:
      cleanString(socials.instagram) ||
      cleanString(company.instagram) ||
      cleanString(company.instagramUrl),

    x:
      cleanString(socials.x) ||
      cleanString(socials.twitter) ||
      cleanString(company.twitter) ||
      cleanString(company.x) ||
      cleanString(company.twitterUrl),
  };
}

// =====================================================
// PROVIDER EXECUTION WITH TIMEOUT AND RETRY
// =====================================================

async function callWithRetry(
  provider,
  sources,
  product,
  location
) {
  let retries = 0;

  while (true) {
    let timeoutId;

    try {
      const timeout = new Promise((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(
            new Error(
              `${provider.name} extraction timed out after ${TIMEOUT_MS / 1000} seconds.`
            )
          );
        }, TIMEOUT_MS);
      });

      return await Promise.race([
        provider.extract(sources, product, location),
        timeout,
      ]);
    } catch (error) {
      // Never retry an exhausted daily token allowance.
      if (isDailyLimitError(error)) {
        throw error;
      }

      // Only retry temporary rate limits.
      if (
        !isRateLimitError(error) ||
        retries >= MAX_RETRIES
      ) {
        throw error;
      }

      retries++;

      const delay = getRetryDelay(error);

      console.warn(
        `[Supplier Extractor] ${provider.name} rate limited. ` +
        `Waiting ${Math.ceil(delay / 1000)} seconds. ` +
        `Retry ${retries}/${MAX_RETRIES}.`
      );

      await sleep(delay);
    } finally {
      clearTimeout(timeoutId);
    }
  }
}

// =====================================================
// AI RESPONSE PARSING
// =====================================================

function parseResponse(response) {
  let result = response?.analysis;

  if (typeof result === "string") {
    result = result
      .trim()
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/, "");

    try {
      result = JSON.parse(result);
    } catch {
      throw new Error(
        "AI returned invalid company extraction JSON."
      );
    }
  }

  if (!result || !Array.isArray(result.sources)) {
    throw new Error(
      "Invalid company extraction response. Expected a sources array."
    );
  }

  return result.sources;
}

// =====================================================
// VALIDATE SOURCE EXTRACTION RESULTS
// =====================================================

function validateBatch(results, sources) {
  const expectedIds = new Set(
    sources.map((source) => source.id)
  );

  const receivedIds = new Set();
  const validResults = [];

  for (const result of results) {
    const sourceId = String(
      result?.sourceId ?? ""
    );

    if (!expectedIds.has(sourceId)) {
      console.warn(
        `[Supplier Extractor] Ignoring unknown source ID: ${sourceId}`
      );

      continue;
    }

    if (receivedIds.has(sourceId)) {
      console.warn(
        `[Supplier Extractor] Ignoring duplicate source: ${sourceId}`
      );

      continue;
    }

    receivedIds.add(sourceId);

    const extractedCompanies =
      Array.isArray(result?.extractedCompanies)
        ? result.extractedCompanies.filter(
            (company) =>
              company &&
              typeof company === "object" &&
              typeof company.companyName === "string" &&
              company.companyName.trim()
          )
        : [];

    validResults.push({
      sourceId,

      sourceType: normalizeSourceType(
        result?.sourceType
      ),

      extractedCompanies,
    });
  }

  // Warn about missing results without discarding
  // valid extractions from other sources.
  for (const source of sources) {
    if (!receivedIds.has(source.id)) {
      console.warn(
        `[Supplier Extractor] Missing extraction result for source: ${source.id}`
      );
    }
  }

  return validResults;
}

// =====================================================
// NORMALIZE EXTRACTED COMPANY RECORDS
// =====================================================

function normalizeCompanies(results, originalSources) {
  const sourceMap = new Map(
    originalSources.map((source) => [
      source.id,
      source,
    ])
  );

  const companies = [];

  for (const result of results) {
    const source = sourceMap.get(
      String(result.sourceId)
    );

    if (!source) continue;

    for (const company of result.extractedCompanies) {
      const companyName = cleanString(
        company.companyName
      );

      if (!companyName) continue;

      const products = Array.isArray(company.products)
        ? company.products
            .filter((item) => typeof item === "string")
            .map((item) => item.trim())
            .filter(Boolean)
        : [];

      companies.push({
        id: `${result.sourceId}-${companies.length + 1}`,

        name: companyName,

        supplierType: normalizeSupplierType(
          company.supplierType
        ),

        country: cleanString(company.country),

        location: cleanString(company.location),

        address:
          cleanString(company.address) ||
          cleanString(company.fullAddress),

        products,

        website:
          cleanString(company.officialWebsite) ||
          cleanString(company.website),

        contactName: cleanString(
          company.contactName
        ),

        contactEmail: cleanString(
          company.contactEmail
        ),

        contactPhone: cleanString(
          company.contactPhone
        ),

        socials: normalizeSocials(company),

        evidenceSummary: cleanString(
          company.evidenceSummary
        ) || "",

        sourceType: result.sourceType,

        source: source.url || null,

        sourceTitle: source.title || "",

        verificationStatus: "unverified",

        evidence: {
          productMatch: "not_checked",
          companyIdentity: "not_checked",
          contactDetails: "not_checked",
          stockAvailability: "not_checked",
          pricing: "not_checked",
        },
      });
    }
  }

  return companies;
}

// =====================================================
// MAIN COMPANY EXTRACTION SERVICE
// =====================================================

export async function extractCompaniesFromSupplierSources(
  sources,
  requestedProduct,
  location
) {
  if (!Array.isArray(sources) || sources.length === 0) {
    return {
      provider: null,
      companies: [],
      errors: [],
    };
  }

  // Prepare search sources.
  const preparedSources = sources.map(
    (source, index) => ({
      id: String(
        source.id ?? `source-${index + 1}`
      ),

      title: String(
        source.title ?? source.name ?? "Untitled source"
      ),

      url: String(
        source.url ?? source.website ?? ""
      ),

     description: String(
  source.description ?? source.snippet ?? ""
).slice(0, 1200),
    })
  );

  const errors = [];

  // Try providers in priority order.
  for (const provider of PROVIDERS) {
    try {
      console.log(
        `[Supplier Extractor] Trying ${provider.name}...`
      );

      const allResults = [];

      // Process sources in small batches.
      for (
        let start = 0;
        start < preparedSources.length;
        start += BATCH_SIZE
      ) {
        const batch = preparedSources.slice(
          start,
          start + BATCH_SIZE
        );

        const batchNumber =
          Math.floor(start / BATCH_SIZE) + 1;

        console.log(
          `[Supplier Extractor] ${provider.name}: ` +
          `batch ${batchNumber} (${batch.length} sources)...`
        );

        const response = await callWithRetry(
          provider,
          batch,
          requestedProduct,
          location
        );

        const parsedResults = parseResponse(
          response
        );

        const validResults = validateBatch(
          parsedResults,
          batch
        );

        allResults.push(...validResults);
      }

      // Convert AI extraction into structured records.
      const companies = normalizeCompanies(
        allResults,
        preparedSources
      );

      console.log(
        `[Supplier Extractor] Extracted ${companies.length} companies using ${provider.name}.`
      );

      return {
        provider: provider.name,
        companies,
        errors,
      };
    } catch (error) {
      const message = getErrorMessage(error);

      errors.push({
        provider: provider.name,
        error: message,
      });

      console.error(
        `[Supplier Extractor] ${provider.name} failed: ${message}`
      );

      // Continue to the next provider.
    }
  }

  // All configured providers failed.
  return {
    provider: null,
    companies: [],
    errors,
  };
}

// Backward-compatible export.
export {
  extractCompaniesFromSupplierSources as extractSupplierCompanies,
};
