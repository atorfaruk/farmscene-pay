
export async function searchBrightData(query, location = "") {
  const apiKey = process.env.BRIGHTDATA_API_KEY;
  const zone = process.env.BRIGHTDATA_SERP_ZONE;

  if (!apiKey) {
    throw new Error("BRIGHTDATA_API_KEY is missing.");
  }

  if (!zone) {
    throw new Error("BRIGHTDATA_SERP_ZONE is missing.");
  }

  const searchQuery = `${query} suppliers manufacturers ${location}`.trim();

  const url = new URL("https://www.google.com/search");
  url.searchParams.set("q", searchQuery);
  url.searchParams.set("brd_json", "1");

  const response = await fetch("https://api.brightdata.com/request", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      zone,
      url: url.toString(),
      format: "raw",
    }),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(
      data?.message || `Bright Data failed: ${response.status}`
    );
  }

  return (data.organic || []).map((item) => ({
    title: item.title || "Supplier lead",
    url: item.link || null,
    description: item.description || "",
    provider: "Bright Data",
  }));
}
