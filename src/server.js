import app from "./app.js";
import { env } from "./config/env.js";

app.listen(env.port, () => {
  console.log(`Cartezi_trade Node backend running on port ${env.port}`);
});
