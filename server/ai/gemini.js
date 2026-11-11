
import { GoogleGenAI } from "@google/genai";

const MODEL = "gemini-3.8-flash";

function getAIClient() {
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not configured.");
  }

  return new GoogleGenAI({ apiKey });
}

function extractResponseText(response, errorMessage) {
  const result = response.output_text;

  if (!result) {
    throw new Error(errorMessage);
  }

  return result;
}

// =====================================================
// 1. FARMER PROCUREMENT REQUEST ANALYSIS
// =====================================================

export async function analyzeFarmerRequest(request) {
  if (typeof request !== "string" || !request.trim()) {
    throw new Error("Please provide a valid farming request.");
  }

  const ai = getAIClient();

  const prompt = [
    "You are the AI procurement assistant for FarmScene Pay.",
    "Analyze the farmer's agricultural procurement request.",
    "",
    "SUPPORTED PROCUREMENT CATEGORIES:",
    "1. Fertilizers: NPK, Urea, DAP and organic fertilizers.",
    "2. Pesticides: Insecticides and pest-control products.",
    "3. Herbicides and Fungicides: Weed and crop disease control.",
    "4. Seeds and Seedlings: Raw seeds, crop seeds, certified seeds, seedlings and planting materials.",
    "",
    "Identify the following:",
    "1. Product requested.",
    "2. Correct procurement category.",
    "3. Quantity and unit, if provided.",
    "4. Crop and intended use, if provided.",
    "5. Farm and delivery location, if provided.",
    "6. Budget and currency, if provided.",
    "7. Important missing information.",
    "8. Questions the farmer should answer before procurement.",
    "9. Relevant safety, quality and certification requirements.",
    "",
    "IMPORTANT RULES:",
    "- There is no fixed maximum quantity. Record the quantity the farmer requests.",
    "- Never invent missing quantities, supplier names, prices, stock or availability.",
    "- Clearly identify information the farmer has not provided.",
    "- For pesticides, herbicides and fungicides, flag the need to verify product registration, permitted use and safety instructions.",
    "- For seeds and seedlings, consider variety, quality and certification requirements.",
    "- Do not authorize or execute payments.",
    "- Do not claim a supplier or product is verified unless verification has actually occurred.",
    "- Use clear, practical language.",
    "- If the request is outside the four categories, identify it as an additional procurement category.",
    "",
    "FARMER REQUEST:",
    request.trim()
  ].join("\n");

  const response = await ai.interactions.create({
    model: MODEL,
    input: prompt,
  });

  return {
    provider: "gemini",
    model: MODEL,
    analysis: extractResponseText(
      response,
      "Gemini returned an empty response."
    ),
  };
}

// =====================================================
// 2. SUPPLIER CLASSIFICATION
// =====================================================

export async function classifySuppliersWithGemini(
  suppliers,
  requestedProduct,
  location
) {
  if (!Array.isArray(suppliers) || suppliers.length === 0) {
    throw new Error("No supplier records were provided for classification.");
  }

  const ai = getAIClient();

  const supplierRecords = suppliers.map((supplier, index) => ({
    id: String(supplier.id ?? supplier.url ?? `supplier-${index + 1}`),
    name: supplier.name ?? supplier.title ?? "Unknown",
    description: String(
      supplier.description ?? supplier.snippet ?? ""
    ).slice(0, 350),
    url: supplier.url ?? supplier.website ?? "",
    address: supplier.address ?? supplier.location ?? "",
    sourceProvider: supplier.sourceProvider ?? "",
    matchedProduct: supplier.matchedProduct ?? requestedProduct ?? "",
  }));

  const prompt = `
You are the supplier intelligence classifier for FarmScene Pay.

Classify supplier records using ONLY the supplied information.

REQUESTED PRODUCT:
${requestedProduct || "Not specified"}

FARMER LOCATION:
${location || "Not specified"}

SUPPLIER RECORDS:
${JSON.stringify(supplierRecords)}

For every supplier, return:
- id: original supplier ID, unchanged
- supplierType: manufacturer, distributor, wholesaler, retailer, directory, marketplace, or unknown
- productRelevance: high, medium, low, or unknown
- locationRelevance: high, medium, low, or unknown
- confidence: integer from 0 to 100
- evidenceSummary: short explanation supported by the record
- missingEvidence: array of information not established by the record

RULES:
- Return every supplied supplier exactly once.
- Preserve IDs exactly.
- Do not invent company details, products, prices, stock or availability.
- Do not infer manufacturer status without evidence.
- A directory or marketplace is not itself a manufacturer.
- A search listing is not proof of supplier legitimacy or product availability.
- Do not claim that any supplier is verified.
- Use unknown when evidence is insufficient.
- Confidence measures classification confidence, not supplier legitimacy.

Return ONLY valid JSON. Do not use Markdown fences.

Required structure:
{
  "classifications": [
    {
      "id": "original-id",
      "supplierType": "unknown",
      "productRelevance": "unknown",
      "locationRelevance": "unknown",
      "confidence": 0,
      "evidenceSummary": "",
      "missingEvidence": []
    }
  ]
}
`;

  const response = await ai.interactions.create({
    model: MODEL,
    input: prompt,
  });

  return {
    provider: "gemini",
    model: MODEL,
    analysis: extractResponseText(
      response,
      "Gemini returned an empty supplier classification."
    ),
  };
}

// =====================================================
// 3. COMPANY EXTRACTION FROM SUPPLIER SOURCES
// =====================================================

export async function extractCompaniesFromSupplierSources(
  sources,
  requestedProduct,
  location
) {
  if (!Array.isArray(sources) || sources.length === 0) {
    throw new Error("No supplier sources were provided for extraction.");
  }

  const ai = getAIClient();

  const sourceRecords = sources.map((source, index) => ({
    id: String(source.id ?? `source-${index + 1}`),
    title: String(
      source.title ?? source.name ?? "Untitled source"
    ).slice(0, 180),
    url: String(
      source.url ?? source.website ?? ""
    ).slice(0, 250),
    description: String(
      source.description ?? source.snippet ?? ""
    ).slice(0, 2500),
  }));

  const prompt = `
You are the company extraction assistant for FarmScene Pay.

Examine supplier search sources and extract individual company names
explicitly mentioned in the supplied evidence.

For each source identify its sourceType:
- direct_supplier
- directory
- marketplace
- research
- social_media
- product_information
- unknown

Extract individual companies when explicitly identified.

For each extracted company return:
- companyName
- supplierType: manufacturer, distributor, wholesaler, retailer, or unknown
- country
- location
- products: explicitly mentioned products only
- officialWebsite: only if explicitly provided as that company's website
- contactName: only if explicitly provided
- contactEmail: only if explicitly provided
- contactPhone: only if explicitly provided
- evidenceSummary: short explanation of the supplied evidence

STRICT RULES:
1. Never invent company names.
2. Never invent websites, addresses, contact details or products.
3. Do not treat the directory or research website as every company it mentions.
4. Extract individual companies from directories and research articles.
5. Do not assume that a company manufactures a product merely because
   its name appears in a fertilizer article.
6. Use unknown when the company's business role is not established.
7. Preserve the original source ID.
8. Every extracted company must have evidence in the supplied source.
9. Never claim a company is verified.
10. Extract no more than five companies per source.
11. Do not extract buyers, unrelated organizations or individuals
    as supplier companies.
12. Keep sourceType separate from supplierType.
13. Do not invent an official website from the source domain.

Return ONLY valid JSON without Markdown fences.

Required structure:
{
  "sources": [
    {
      "sourceId": "original-source-id",
      "sourceType": "directory",
      "extractedCompanies": [
        {
          "companyName": "Company name",
          "supplierType": "unknown",
          "country": "",
          "location": "",
          "products": [],
          "officialWebsite": "",
          "contactName": "",
          "contactEmail": "",
          "contactPhone": "",
          "evidenceSummary": ""
        }
      ]
    }
  ]
}

If no companies can be extracted, return an empty extractedCompanies array.

REQUESTED PRODUCT:
${requestedProduct || "Not specified"}

FARMER DELIVERY LOCATION:
${location || "Not specified"}

SOURCE RECORDS:
${JSON.stringify(sourceRecords)}
`;

  const response = await ai.interactions.create({
    model: MODEL,
    input: prompt,
  });

  return {
    provider: "gemini",
    model: MODEL,
    analysis: extractResponseText(
      response,
      "Gemini returned an empty company extraction."
    ),
  };
}

