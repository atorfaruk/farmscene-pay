
export async function searchTavily(query) {
  const apiKey = process.env.TAVILY_API_KEY;

  if (!apiKey) {
    throw new Error("TAVILY_API_KEY is missing.");
  }

  const response = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      query,
      search_depth: "advanced",
      max_results: 10,
      include_answer: false,
    }),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(
      data.detail || data.message || `Tavily failed: ${response.status}`
    );
  }

  return (data.results || []).map((item) => ({
    title: item.title || "Supplier lead",
    url: item.url || null,
    description: item.content || "",
    provider: "Tavily",
  }));
}
