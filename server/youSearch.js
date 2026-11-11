import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

export async function searchYouSuppliers(query) {
  const client = new Client({
    name: "farmscene-pay",
    version: "1.0.0",
  });

  const transport = new StreamableHTTPClientTransport(
    new URL("https://api.you.com/mcp?profile=free")
  );

  try {
    await client.connect(transport);

    const result = await client.callTool({
      name: "you-search",
      arguments: {
        query,
        count: 10,
      },
    });

    console.log(
  "YOU.COM MCP RESPONSE:",
  JSON.stringify(result, null, 2).slice(0, 12000)
);

return result;
  } finally {
    await client.close();
  }
}