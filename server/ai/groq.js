
const MODEL = "openai/gpt-oss-20b";

const GROQ_API_URL =
  "https://api.groq.com/openai/v1/chat/completions";

async function callGroq(
  messages,
  temperature = 0.2,
  options = {}
) {
  const apiKey = process.env.GROQ_API_KEY;

  if (!apiKey) {
    throw new Error("GROQ_API_KEY is not configured.");
  }

  const requestBody = {
    model: MODEL,
    temperature,
    messages,
  };

  // Enable JSON mode only for extraction requests.
  if (options.jsonMode === true) {
    requestBody.response_format = {
      type: "json_object",
    };
  }

  const response = await fetch(GROQ_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(requestBody),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(
      data?.error?.message ||
      `Groq API error: ${response.status}`
    );
  }

  const content =
    data.choices?.[0]?.message?.content?.trim();

  if (!content) {
    throw new Error("Groq returned an empty response.");
  }

  return {
    provider: "groq",
    model: data.model || MODEL,
    analysis: content,
  };
}

// =====================================================
// 1. FARMER PROCUREMENT REQUEST ANALYSIS
// =====================================================

export async function analyzeFarmerRequestWithGroq(request) {
  if (typeof request !== "string" || !request.trim()) {
    throw new Error("Please provide a valid farming request.");
  }

  return callGroq([
    {
      role: "system",
      content: `You are the AI procurement assistant for FarmScene Pay.
Analyze farmer procurement requests.
Identify the farmer's needs, quantities, missing information, and safe next steps.
Never invent supplier names, prices, availability, or market facts.
Never authorize payments.
Clearly identify information that is unknown.`,
    },
    {
      role: "user",
      content: request.trim(),
    },
  ]);
}

// =====================================================
// 2. SUPPLIER CLASSIFICATION
// =====================================================

export async function classifySuppliersWithGroq(
  suppliers,
  requestedProduct,
  location
) {
  if (!Array.isArray(suppliers) || suppliers.length === 0) {
    throw new Error("No supplier records were provided for classification.");
  }

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

  const systemPrompt = `
You are the supplier intelligence classifier for FarmScene Pay.

Classify supplier records using ONLY the evidence provided.

For every supplier, return:
- id: original supplier ID, unchanged
- supplierType: manufacturer, distributor, wholesaler, retailer, directory, marketplace, or unknown
- productRelevance: high, medium, low, or unknown
- locationRelevance: high, medium, low, or unknown
- confidence: integer from 0 to 100
- evidenceSummary: short explanation based only on the supplied record
- missingEvidence: array of important information not established

RULES:
1. Return every supplied supplier exactly once.
2. Preserve IDs exactly.
3. Never invent company details, products, prices, stock, or availability.
4. Do not infer manufacturer status without supporting evidence.
5. A directory or marketplace is not itself a manufacturer or direct supplier.
6. A search listing is not proof of supplier legitimacy or product availability.
7. Never claim a supplier has been verified.
8. Use unknown when evidence is insufficient.
9. Confidence measures classification confidence, NOT supplier legitimacy.

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

  const userPrompt = `
REQUESTED PRODUCT:
${requestedProduct || "Not specified"}

FARMER LOCATION:
${location || "Not specified"}

SUPPLIER RECORDS:
${JSON.stringify(supplierRecords)}
`;

  return callGroq(
    [
      {
        role: "system",
        content: systemPrompt,
      },
      {
        role: "user",
        content: userPrompt,
      },
    ],
    0.1
  );
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

  const sourceRecords = sources.map((source, index) => ({
    id: String(source.id ?? `source-${index + 1}`),
    title: String(source.title ?? source.name ?? "Untitled source").slice(0, 180),
    url: String(source.url ?? source.website ?? "").slice(0, 250),
    description: String(
      source.description ?? source.snippet ?? ""
    ).slice(0, 2500),
  }));

  const systemPrompt = `
You are the company extraction assistant for FarmScene Pay.

Your job is to examine supplier search sources and extract real company
names explicitly mentioned in the supplied evidence.

For each source, identify its sourceType:
- direct_supplier
- directory
- marketplace
- research
- social_media
- product_information
- unknown

Extract individual companies when the evidence explicitly identifies them.

For every extracted company return:
- companyName
- supplierType: manufacturer, distributor, wholesaler, retailer, or unknown
- country
- location
- products: explicitly mentioned products only
- officialWebsite: only if explicitly provided as that company's website
- contactName: only if explicitly provided
- contactEmail: only if explicitly provided
- contactPhone: only if explicitly provided
- evidenceSummary: short explanation of the evidence

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
9. Do not claim that any company is verified.
10. Extract no more than five companies per source.
11. Do not extract buyers, unrelated organizations or individual people
    as supplier companies.
12. Keep sourceType separate from supplierType.

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
`;

  const userPrompt = `
REQUESTED PRODUCT:
${requestedProduct || "Not specified"}

FARMER DELIVERY LOCATION:
${location || "Not specified"}

SOURCE RECORDS:
${JSON.stringify(sourceRecords)}
`;

   return callGroq(
    [
      {
        role: "system",
        content: systemPrompt,
      },
      {
        role: "user",
        content: userPrompt,
      },
    ],
    0.1,
    { jsonMode: true }
  );
}
