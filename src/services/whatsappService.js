import { Vonage } from "@vonage/server-sdk";

const vonage = new Vonage({
  apiKey:    process.env.VONAGE_API_KEY,
  apiSecret: process.env.VONAGE_API_SECRET,
});

export async function sendWhatsApp(phone, message) {
  if (!phone || !process.env.VONAGE_API_KEY) {
    console.warn("⚠️  WhatsApp skipped — VONAGE_API_KEY not set");
    return null;
  }

  // Format : +221771234567 (sans whatsapp:)
  const to = phone.replace("whatsapp:", "").replace("+", "");

  return new Promise((resolve) => {
    vonage.channel.send(
      { type: "whatsapp", number: to },
      { type: "whatsapp", number: process.env.VONAGE_WHATSAPP_FROM },
      { content: { type: "text", text: message } },
      (err, data) => {
        if (err) {
          console.error("WhatsApp failed:", err);
          resolve(null);
        } else {
          console.log("📱 WhatsApp sent:", data?.message_uuid);
          resolve(data);
        }
      }
    );
  });
}

export async function sendWhatsAppOtp(phone, otp, fullName, customMessage = null) {
  const message = customMessage || `🔐 Cartezi Trade\n\nHi ${fullName}, your code is:\n\n*${otp}*\n\nExpires in 10 minutes.`;
  return sendWhatsApp(phone, message);
}