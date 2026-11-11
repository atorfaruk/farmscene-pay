import { NearConnector } from "@hot-labs/near-connect";

const nearConnector = new NearConnector({
  network: "testnet",
  features: {
    testnet: true,
  },
});

export default nearConnector;