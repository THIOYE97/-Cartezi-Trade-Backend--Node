import crypto from "crypto";
import https from "https";

const APP_TOKEN  = process.env.SUMSUB_APP_TOKEN;
const SECRET_KEY = process.env.SUMSUB_SECRET_KEY;
const BASE_URL   = "api.sumsub.com";

function httpsRequest(method, path, body = null) {
  return new Promise((resolve, reject) => {
    const bodyStr = body ? JSON.stringify(body) : null;
    const ts = Math.floor(Date.now() / 1000);
    const toSign = String(ts) + method + path + (bodyStr || "");
    const sig = crypto.createHmac("sha256", SECRET_KEY).update(toSign).digest("hex");

    const headers = {
      "X-App-Token":      APP_TOKEN,
      "X-App-Access-Ts":  String(ts),
      "X-App-Access-Sig": sig,
      "Accept":           "application/json",
    };

    if (bodyStr) {
      headers["Content-Type"]   = "application/json";
      headers["Content-Length"] = Buffer.byteLength(bodyStr);
    } else {
      headers["Content-Length"] = 0;
    }

    const options = {
      hostname: BASE_URL,
      path,
      method,
      headers,
    };

    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => { data += chunk; });
      res.on("end", () => {
        try {
          const parsed = JSON.parse(data);
          if (res.statusCode >= 400) {
            reject(new Error(parsed.description || `HTTP ${res.statusCode}`));
          } else {
            resolve(parsed);
          }
        } catch {
          reject(new Error("Invalid JSON response"));
        }
      });
    });

    req.on("error", reject);

    if (bodyStr) {
      req.write(bodyStr);
    }

    req.end();
  });
}

export async function createApplicant(userId, email) {
  const path = "/resources/applicants?levelName=basic-kyc";
  const body = { externalUserId: userId, email, fixedInfo: { email } };
  return httpsRequest("POST", path, body);
}

export async function generateAccessToken(userId) {
  const path = `/resources/accessTokens?userId=${encodeURIComponent(userId)}&levelName=basic-kyc&ttlInSecs=600`;
  const data = await httpsRequest("POST", path, null);
  return data.token;
}

export async function getApplicantStatus(applicantId) {
  const path = `/resources/applicants/${applicantId}/requiredIdDocsStatus`;
  return httpsRequest("GET", path, null);
}
export async function getApplicantData(applicantId) {
  const path = `/resources/applicants/${applicantId}/one`;
  return httpsRequest("GET", path, null);
}