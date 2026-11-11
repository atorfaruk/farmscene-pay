
const OPENROUTER_URL =
  "https://openrouter.ai/api/v1/chat/completions";

const MODEL = "openrouter/auto";

// =====================================================
// SHARED OPENROUTER API REQUEST
// =====================================================

async function callOpenRouter(messages, temperature = 0.2) {
  const apiKey = process.env.OPENROUTER_API_KEY;

  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY is missing from .env");
  }

  const response = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://farmscene-pay.vercel.app",
      "X-Title": "FarmScene Pay",
    },
    body: JSON.stringify({
      model: MODEL,
      messages,
      response_format: { type: "json_object" },
      temperature,
    }),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(
      data.error?.message || `OpenRouter failed: ${response.status}`
    );
  }

  const content = data.choices?.[0]?.message?.content;

  if (!content) {
    throw new Error("OpenRouter returned an empty response.");
  }

  try {
    return {
      provider: "openrouter",
      model: data.model || MODEL,
      analysis: JSON.parse(content),
    };
  } catch {
    throw new Error("OpenRouter returned invalid JSON.");
  }
}

// =====================================================
// 1. FARMER PROCUREMENT REQUEST ANALYSIS
// =====================================================

export async function askOpenRouter(prompt) {
  if (typeof prompt !== "string" || !prompt.trim()) {
    throw new Error("Please provide a valid procurement request.");
  }

  return callOpenRouter([
    {
      role: "system",
      content: `You are FarmScene Pay's agricultural procurement assistant.
Analyze farmer procurement requests.
Return ONLY valid JSON, using the same structure as a normal procurement analysis.
Never invent supplier names, prices, stock, availability or delivery terms.
Identify missing information clearly.
Do not authorize or execute payments.`,
    },
    {
      role: "user",
      content: prompt.trim(),
    },
  ]);
}

// =====================================================
// 2. SUPPLIER CLASSIFICATION
// =====================================================

export async function classifySuppliersWithOpenRouter(
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
    description: supplier.description ?? supplier.snippet ?? "",
    url: supplier.url ?? "",
    address: supplier.address ?? supplier.location ?? "",
    sourceProvider: supplier.sourceProvider ?? "",
    matchedProduct: supplier.matchedProduct ?? requestedProduct ?? "",
  }));

  const systemPrompt = `
You are the supplier intelligence classifier for FarmScene Pay.

Your job is to classify agricultural supplier search results.

Use ONLY the evidence provided in the supplier records.

For every supplier, return:

- id: original supplier ID, unchanged
- supplierType: manufacturer, distributor, wholesaler, retailer, directory, marketplace, or unknown
- productRelevance: high, medium, low, or unknown
- locationRelevance: high, medium, low, or unknown
- confidence: integer from 0 to 100
- evidenceSummary: short explanation based only on the supplied record
- missingEvidence: array of important information not established by the record

CLASSIFICATION RULES:

1. Return every supplied supplier exactly once.
2. Preserve each supplier ID exactly.
3. Never invent company details, products, prices, stock, availability or delivery terms.
4. Do not classify a company as a manufacturer without supporting evidence.
5. A directory or marketplace is not itself a manufacturer or direct supplier.
6. A search listing is not proof of supplier legitimacy or product availability.
7. Never claim a supplier has been verified.
8. Use unknown when the evidence is insufficient.
9. Confidence measures confidence in the classification, NOT supplier legitimacy.
10. Do not confuse a supplier's location with the farmer's delivery location.

Return ONLY valid JSON. Do not use Markdown code fences.

Required JSON structure:

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
${JSON.stringify(supplierRecords, null, 2)}
`;

  const result = await callOpenRouter(
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

  if (!Array.isArray(result.analysis?.classifications)) {
    throw new Error(
      "OpenRouter returned supplier data in an unexpected JSON structure."
    );
  }

  return result;
}
