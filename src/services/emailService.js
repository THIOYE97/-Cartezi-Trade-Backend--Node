import { Resend } from "resend";
import mjml2html from "mjml";
import { env } from "../config/env.js";

const resend = new Resend(process.env.RESEND_API_KEY);

function buildEmail(title, body, ctaText = null, ctaUrl = null) {
  const { html } = mjml2html(`
    <mjml>
      <mj-head>
        <mj-attributes>
          <mj-all font-family="Inter, Arial, sans-serif" />
          <mj-text font-size="14px" line-height="1.6" color="#c2c0b6" />
        </mj-attributes>
        <mj-style>
          .btn { background:#ffffff; color:#000000; padding:12px 24px; border-radius:8px; font-weight:600; text-decoration:none; display:inline-block; }
        </mj-style>
      </mj-head>
      <mj-body background-color="#0a0a0a">
        <mj-section background-color="#111111" border-radius="12px 12px 0 0" padding="28px 40px 20px">
          <mj-column>
            <mj-text font-size="20px" font-weight="700" color="#ffffff" align="center">
              Cartezi Trade
            </mj-text>
          </mj-column>
        </mj-section>

        <mj-section background-color="#161616" padding="32px 40px">
          <mj-column>
            <mj-text font-size="18px" font-weight="600" color="#ffffff" padding-bottom="12px">
              ${title}
            </mj-text>
            <mj-text color="#888780" padding-bottom="24px">
              ${body}
            </mj-text>
            ${ctaText && ctaUrl ? `
            <mj-button background-color="#ffffff" color="#000000"
              border-radius="8px" font-weight="600" font-size="14px"
              inner-padding="12px 28px" href="${ctaUrl}">
              ${ctaText}
            </mj-button>` : ""}
          </mj-column>
        </mj-section>

        <mj-section background-color="#111111" border-radius="0 0 12px 12px" padding="16px 40px">
          <mj-column>
            <mj-text color="#3d3d3a" font-size="12px" align="center">
              © ${new Date().getFullYear()} Cartezi Trade · You received this because you have an account on Cartezi Trade.
            </mj-text>
          </mj-column>
        </mj-section>
      </mj-body>
    </mjml>
  `);
  return html;
}

export async function sendEmail(to, subject, title, body, ctaText = null, ctaUrl = null) {
  try {
    const html = buildEmail(title, body, ctaText, ctaUrl);

    const { data, error } = await resend.emails.send({
      from:    env.emailFrom || "Cartezi Trade <noreply@cartezi.trade>",
      to:      [to],
      subject,
      html,
    });

    if (error) {
      console.error("Resend error:", error);
      return null;
    }

    console.log("✉️  Email sent to", to, "| ID:", data?.id);
    return data;
  } catch (err) {
    console.error("Email send failed:", err.message);
    return null; // Non bloquant
  }
}

// Email OTP — utilisé dans onboarding et 2FA
export async function sendOtpEmail(to, fullName, otp, type = "verification") {
  const configs = {
    verification: {
      subject: "Your Cartezi Trade verification code",
      title:   `Hi ${fullName}, verify your email`,
      body:    `Your verification code is: <strong style="font-size:28px;letter-spacing:8px;color:#ffffff;">${otp}</strong><br/><br/>This code expires in 10 minutes. Do not share it with anyone.`,
    },
    reset_password: {
      subject: "Reset your Cartezi Trade password",
      title:   "Reset your password",
      body:    `Your password reset code is: <strong style="font-size:28px;letter-spacing:8px;color:#ffffff;">${otp}</strong><br/><br/>This code expires in 10 minutes.`,
    },
    two_factor: {
      subject: "Your Cartezi Trade login code",
      title:   "Complete your login",
      body:    `Your 2FA code is: <strong style="font-size:28px;letter-spacing:8px;color:#ffffff;">${otp}</strong><br/><br/>This code expires in 10 minutes.`,
    },
  };

  const cfg = configs[type] || configs.verification;
  return sendEmail(to, cfg.subject, cfg.title, cfg.body);
}