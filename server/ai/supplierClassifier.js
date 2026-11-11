
import { classifySuppliersWithGroq } from "./groq.js";
import { classifySuppliersWithGemini } from "./gemini.js";

const PROVIDERS = [
  { name: "groq", classify: classifySuppliersWithGroq },
  { name: "gemini", classify: classifySuppliersWithGemini },
];

const TIMEOUT_MS = 12000;
const BATCH_SIZE = 4;
const MAX_RATE_LIMIT_RETRIES = 0;

const VALID_TYPES = [
  "manufacturer",
  "distributor",
  "wholesaler",
  "retailer",
  "marketplace",
  "unknown",
];

const VALID_RELEVANCE = ["high", "medium", "low", "unknown"];

function withTimeout(promise, providerName) {
  let timeoutId;

  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(
        new Error(`${providerName} timed out after ${TIMEOUT_MS / 1000} seconds.`)
      );
    }, TIMEOUT_MS);
  });

  return Promise.race([promise, timeout]).finally(() => {
    clearTimeout(timeoutId);
  });
}

function isRateLimitError(error) {
  const message = String(error?.message || error || "").toLowerCase();

  return (
    message.includes("rate limit") ||
    message.includes("tokens per minute") ||
    message.includes("tpm") ||
    message.includes("too many requests") ||
    message.includes("429")
  );
}

async function callProviderWithRetry(provider, suppliers, product, location) {
  let retries = 0;

  while (true) {
    try {
      return await withTimeout(
        provider.classify(suppliers, product, location),
        provider.name
      );
    } catch (error) {
      if (!isRateLimitError(error) || retries >= MAX_RATE_LIMIT_RETRIES) {
        throw error;
      }

      retries++;
    }
  }
}

function compactText(value, maxLength) {
  if (value === null || value === undefined) return "";
  return String(value).slice(0, maxLength);
}

function prepareSuppliers(suppliers) {
  return suppliers.map((supplier, index) => ({
    ...supplier,
    id: String(
      supplier.id ??
      supplier.url ??
      supplier.website ??
      `supplier-${index + 1}`
    ),
  }));
}

function createAIBatch(suppliers, batchNumber) {
  return suppliers.map((supplier, index) => ({
    id: `batch-${batchNumber}-supplier-${index + 1}`,
    name: compactText(supplier.name, 120),
    website: compactText(supplier.website, 180),
    url: compactText(supplier.url, 180),
    location: compactText(supplier.location, 100),
    description: compactText(supplier.description, 700),
    source: compactText(supplier.source, 180),
    matchedProduct: compactText(supplier.matchedProduct, 100),
    sourceProvider: compactText(supplier.sourceProvider, 40),
  }));
}

function parseAIResponse(response) {
  let result = response?.analysis;

  if (typeof result === "string") {
    result = result.trim()
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/, "");

    try {
      result = JSON.parse(result);
    } catch {
      throw new Error("AI provider returned invalid JSON.");
    }
  }

  if (!result || !Array.isArray(result.classifications)) {
    throw new Error("Invalid supplier classification structure.");
  }

  return result.classifications;
}

function validateClassifications(classifications, suppliers) {
  const supplierIds = new Set(suppliers.map((item) => item.id));
  const classificationMap = new Map();

  for (const item of classifications) {
    const id = String(item?.id ?? "");

    if (!supplierIds.has(id)) {
      throw new Error(`Unknown supplier ID: ${id}`);
    }

    if (classificationMap.has(id)) {
      throw new Error(`Duplicate supplier ID: ${id}`);
    }

    const supplierType = String(
      item.supplierType ?? "unknown"
    ).toLowerCase().trim();

    const productRelevance = String(
      item.productRelevance ?? "unknown"
    ).toLowerCase().trim();

    const locationRelevance = String(
      item.locationRelevance ?? "unknown"
    ).toLowerCase().trim();

    const confidence = Number(item.confidence);

    const validType = VALID_TYPES.includes(supplierType)
      ? supplierType
      : "unknown";

    classificationMap.set(id, {
      supplierType: validType,
      category: validType,
      productRelevance: VALID_RELEVANCE.includes(productRelevance)
        ? productRelevance
        : "unknown",
      locationRelevance: VALID_RELEVANCE.includes(locationRelevance)
        ? locationRelevance
        : "unknown",
      confidence: Number.isFinite(confidence)
        ? Math.max(0, Math.min(100, Math.round(confidence)))
        : 0,
      evidenceSummary:
        typeof item.evidenceSummary === "string"
          ? item.evidenceSummary.slice(0, 500)
          : "",
      missingEvidence: Array.isArray(item.missingEvidence)
        ? item.missingEvidence
            .filter((entry) => typeof entry === "string")
            .slice(0, 8)
        : [],
    });
  }

  const missingIds = suppliers
    .filter((supplier) => !classificationMap.has(supplier.id))
    .map((supplier) => supplier.id);

  if (missingIds.length) {
    throw new Error(`Missing classifications: ${missingIds.join(", ")}`);
  }

  return classificationMap;
}

async function classifyInBatches(provider, suppliers, requestedProduct, location) {
  const allClassifications = [];

  for (let start = 0; start < suppliers.length; start += BATCH_SIZE) {
    const batchNumber = Math.floor(start / BATCH_SIZE) + 1;

    const originalBatch = suppliers.slice(start, start + BATCH_SIZE);
    const aiBatch = createAIBatch(originalBatch, batchNumber);

    console.log(
      `[Supplier Classifier] ${provider.name}: processing batch ${batchNumber} (${originalBatch.length} suppliers)...`
    );

    const response = await callProviderWithRetry(
      provider,
      aiBatch,
      compactText(requestedProduct, 200),
      compactText(location, 150)
    );

    const classifications = parseAIResponse(response);
    const classificationMap = validateClassifications(classifications, aiBatch);

    for (let index = 0; index < originalBatch.length; index++) {
      const aiId = aiBatch[index].id;

      allClassifications.push({
        supplierIndex: start + index,
        classification: classificationMap.get(aiId),
      });
    }

    console.log(
      `[Supplier Classifier] ${provider.name}: batch ${batchNumber} completed.`
    );
  }

  return allClassifications;
}

export async function classifySuppliers(suppliers, requestedProduct, location) {
  if (!Array.isArray(suppliers) || suppliers.length === 0) {
    throw new Error("No suppliers were provided for classification.");
  }

  const preparedSuppliers = prepareSuppliers(suppliers);
  const providerErrors = [];

  for (const provider of PROVIDERS) {
    try {
      console.log(`[Supplier Classifier] Trying ${provider.name}...`);

      const batchResults = await classifyInBatches(
        provider,
        preparedSuppliers,
        requestedProduct,
        location
      );

      const classificationByIndex = new Map(
        batchResults.map((item) => [
          item.supplierIndex,
          item.classification,
        ])
      );

      const classifiedSuppliers = preparedSuppliers.map((supplier, index) => {
        const aiClassification = classificationByIndex.get(index);

        return {
          ...supplier,

          // Both fields are populated because the dashboard uses category.
          supplierType: aiClassification.supplierType,
          category: aiClassification.category,

          productRelevance: aiClassification.productRelevance,
          locationRelevance: aiClassification.locationRelevance,
          aiClassification,
          verificationStatus: "unverified",
        };
      });

      console.log(
        `[Supplier Classifier] Successfully classified ${classifiedSuppliers.length} suppliers using ${provider.name}.`
      );

      return {
        provider: provider.name,
        model: "batch classification",
        suppliers: classifiedSuppliers,
        classifications: classifiedSuppliers.map((supplier) => ({
          id: supplier.id,
          ...supplier.aiClassification,
        })),
        providerErrors,
      };
    } catch (error) {
      const message = error?.message || "Unknown classification error";

      providerErrors.push({
        provider: provider.name,
        error: message,
      });

      console.error(
        `[Supplier Classifier] ${provider.name} failed: ${message}`
      );
    }
  }

  console.warn("[Supplier Classifier] All providers failed.");

  return {
    provider: null,
    model: null,
    suppliers: preparedSuppliers.map((supplier) => ({
      ...supplier,
      supplierType: "unknown",
      category: "Unknown",
      productRelevance: "unknown",
      locationRelevance: "unknown",
      aiClassification: null,
      verificationStatus: "unverified",
    })),
    classifications: [],
    providerErrors,
  };
}
