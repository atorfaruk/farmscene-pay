
export async function searchExa(query) {
  const apiKey = process.env.EXA_API_KEY;

  if (!apiKey) {
    throw new Error("EXA_API_KEY is missing.");
  }

  const response = await fetch("https://api.exa.ai/search", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
    },
    body: JSON.stringify({
      query,
      type: "auto",
      numResults: 10,
      contents: {
        highlights: true,
      },
    }),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(
      data.error || `Exa search failed: ${response.status}`
    );
  }

  return (data.results || []).map((item) => ({
    title: item.title || "Supplier lead",
    url: item.url || null,
    description: (item.highlights || []).join(" "),
    provider: "Exa",
  }));
}
