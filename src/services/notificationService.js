import { sendOtpEmail } from "./emailService.js";
import { sendWhatsAppOtp } from "./whatsappService.js";
import { query } from "../data/db.js";
import mjml2html from "mjml";
import nodemailer from "nodemailer";
import { env } from "../config/env.js";

async function getTransporter() {
  if (env.smtpUser && env.smtpPass) {
    return nodemailer.createTransport({
      host: env.smtpHost,
      port: env.smtpPort,
      secure: env.smtpPort === 465,
      auth: { user: env.smtpUser, pass: env.smtpPass },
    });
  }
  const testAccount = await nodemailer.createTestAccount();
  const t = nodemailer.createTransport({
    host: "smtp.ethereal.email",
    port: 587,
    auth: { user: testAccount.user, pass: testAccount.pass },
  });
  console.log("📧 Ethereal:", testAccount.user);
  return t;
}

function buildNotifEmail(title, body, ctaText, ctaUrl) {
  const { html } = mjml2html(`
    <mjml>
      <mj-head>
        <mj-attributes>
          <mj-all font-family="Inter, Arial, sans-serif" />
          <mj-text font-size="14px" line-height="1.6" color="#c2c0b6" />
        </mj-attributes>
      </mj-head>
      <mj-body background-color="#0a0a0a">
        <mj-section background-color="#111111" border-radius="12px 12px 0 0" padding="28px 40px 20px">
          <mj-column>
            <mj-text font-size="18px" font-weight="600" color="#ffffff" align="center">
              Cartezi Trade
            </mj-text>
          </mj-column>
        </mj-section>
        <mj-section background-color="#161616" padding="28px 40px">
          <mj-column>
            <mj-text font-size="17px" font-weight="600" color="#ffffff" padding-bottom="8px">
              ${title}
            </mj-text>
            <mj-text color="#888780" padding-bottom="24px">
              ${body}
            </mj-text>
            ${ctaText && ctaUrl ? `
            <mj-button background-color="#ffffff" color="#000000"
              border-radius="8px" font-weight="600"
              href="${ctaUrl}">
              ${ctaText}
            </mj-button>` : ""}
          </mj-column>
        </mj-section>
        <mj-section background-color="#111111" border-radius="0 0 12px 12px" padding="16px 40px">
          <mj-column>
            <mj-text color="#3d3d3a" font-size="12px" align="center">
              © ${new Date().getFullYear()} Cartezi Trade
            </mj-text>
          </mj-column>
        </mj-section>
      </mj-body>
    </mjml>
  `);
  return html;
}

async function sendEmail(to, subject, title, body, ctaText, ctaUrl) {
  try {
    const transport = await getTransporter();
    const info = await transport.sendMail({
      from: env.smtpFrom,
      to,
      subject,
      html: buildNotifEmail(title, body, ctaText, ctaUrl),
    });
    if (!env.smtpUser) {
      console.log("📧 Preview:", nodemailer.getTestMessageUrl(info));
    }
  } catch (err) {
    console.error("Email notification failed:", err.message);
  }
}

async function sendWhatsApp(phone, message) {
  if (!phone) return;
  try {
    await sendWhatsAppOtp(phone, null, null, message);
  } catch {
    // Non bloquant
  }
}

// Récupérer les infos d'un user pour les notifications
async function getUserInfo(userId) {
  const { rows } = await query(
    "SELECT full_name, email, phone FROM users WHERE id = $1",
    [userId]
  );
  return rows[0] || null;
}

// ─── Templates P2P ────────────────────────────────────────────────────────────

const FRONTEND = env.frontendOrigin;

export async function notifyTradeCreated(trade) {
  const [seller, buyer] = await Promise.all([
    getUserInfo(trade.seller_id),
    getUserInfo(trade.buyer_id),
  ]);
  const tradeUrl = `${FRONTEND}/p2p/trades/${trade.id}`;
  const qty = Number(trade.quantity).toFixed(6);

  if (seller) {
    await Promise.all([
      sendEmail(
        seller.email,
        "New trade request on your offer",
        "New trade request",
        `${buyer?.full_name || "A buyer"} wants to buy ${qty} ${trade.coin_id} from you. Lock the crypto in escrow to proceed.`,
        "View Trade", tradeUrl
      ),
      seller.phone && sendWhatsApp(
        seller.phone,
        `🔔 Cartezi Trade\nNew trade request!\n${buyer?.full_name} wants to buy ${qty} ${trade.coin_id}.\nLock escrow: ${tradeUrl}`
      ),
    ]);
  }

  if (buyer) {
    await Promise.all([
      sendEmail(
        buyer.email,
        "Your trade request was created",
        "Trade request sent",
        `Your request to buy ${qty} ${trade.coin_id} has been sent to the seller. Waiting for escrow lock.`,
        "View Trade", tradeUrl
      ),
      buyer.phone && sendWhatsApp(
        buyer.phone,
        `✅ Cartezi Trade\nTrade created!\nWaiting for seller to lock ${qty} ${trade.coin_id} in escrow.\n${tradeUrl}`
      ),
    ]);
  }
}

export async function notifyEscrowLocked(trade) {
  const buyer = await getUserInfo(trade.buyer_id);
  const tradeUrl = `${FRONTEND}/p2p/trades/${trade.id}`;
  const qty = Number(trade.quantity).toFixed(6);

  if (buyer) {
    await Promise.all([
      sendEmail(
        buyer.email,
        "Crypto locked — send payment now",
        "Crypto is in escrow",
        `${qty} ${trade.coin_id} has been locked in escrow. Please send $${Number(trade.total_fiat).toLocaleString()} ${trade.currency} via ${trade.payment_method?.replace(/_/g," ")} to the seller now.`,
        "Send Payment", tradeUrl
      ),
      buyer.phone && sendWhatsApp(
        buyer.phone,
        `🔒 Cartezi Trade\nCrypto locked in escrow!\nSend $${Number(trade.total_fiat)} ${trade.currency} via ${trade.payment_method?.replace(/_/g," ")} to seller now.\n${tradeUrl}`
      ),
    ]);
  }
}

export async function notifyPaymentSent(trade) {
  const seller = await getUserInfo(trade.seller_id);
  const tradeUrl = `${FRONTEND}/p2p/trades/${trade.id}`;

  if (seller) {
    await Promise.all([
      sendEmail(
        seller.email,
        "Buyer confirmed payment — check your account",
        "Payment sent by buyer",
        `The buyer has confirmed sending $${Number(trade.total_fiat).toLocaleString()} ${trade.currency} via ${trade.payment_method?.replace(/_/g," ")}. Check your account and release the crypto once confirmed.`,
        "Release Crypto", tradeUrl
      ),
      seller.phone && sendWhatsApp(
        seller.phone,
        `💰 Cartezi Trade\nBuyer confirmed payment!\nCheck your ${trade.payment_method?.replace(/_/g," ")} for $${Number(trade.total_fiat)} ${trade.currency}.\nRelease crypto: ${tradeUrl}`
      ),
    ]);
  }
}

export async function notifyTradeCompleted(trade) {
  const [seller, buyer] = await Promise.all([
    getUserInfo(trade.seller_id),
    getUserInfo(trade.buyer_id),
  ]);
  const tradeUrl = `${FRONTEND}/p2p/trades/${trade.id}`;
  const qty = Number(trade.quantity).toFixed(6);

  if (buyer) {
    await Promise.all([
      sendEmail(
        buyer.email,
        "Trade completed — crypto released!",
        "You received your crypto",
        `${qty} ${trade.coin_id} has been released to your wallet. Trade completed successfully.`,
        "View Trade", tradeUrl
      ),
      buyer.phone && sendWhatsApp(
        buyer.phone,
        `🎉 Cartezi Trade\nTrade completed!\n${qty} ${trade.coin_id} sent to your wallet.\n${tradeUrl}`
      ),
    ]);
  }
  if (seller) {
    await Promise.all([
      sendEmail(
        seller.email,
        "Trade completed",
        "Trade completed successfully",
        `Your trade has been completed. $${Number(trade.total_fiat).toLocaleString()} ${trade.currency} received.`,
        "View Trade", tradeUrl
      ),
      seller.phone && sendWhatsApp(
        seller.phone,
        `✅ Cartezi Trade\nTrade completed! You sold ${qty} ${trade.coin_id}.\n${tradeUrl}`
      ),
    ]);
  }
}

export async function notifyDispute(trade) {
  const [seller, buyer] = await Promise.all([
    getUserInfo(trade.seller_id),
    getUserInfo(trade.buyer_id),
  ]);
  const tradeUrl = `${FRONTEND}/p2p/trades/${trade.id}`;

  for (const user of [seller, buyer].filter(Boolean)) {
    await Promise.all([
      sendEmail(
        user.email,
        "Dispute opened on your trade",
        "A dispute has been opened",
        `A dispute was opened on your trade. Our team will review it shortly. Reason: ${trade.dispute_reason || "Not specified"}.`,
        "View Trade", tradeUrl
      ),
      user.phone && sendWhatsApp(
        user.phone,
        `⚠️ Cartezi Trade\nDispute opened on your trade.\nReason: ${trade.dispute_reason || "Not specified"}\n${tradeUrl}`
      ),
    ]);
  }
}