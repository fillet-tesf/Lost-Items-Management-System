const nodemailer = require("nodemailer");

function isEmailConfigured() {
  return Boolean(process.env.EMAIL_USER && process.env.EMAIL_PASS);
}

const transporter = isEmailConfigured()
  ? nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
      },
    })
  : null;

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function buildEmailHtml({
  title,
  greeting,
  intro,
  details = [],
  actionText,
  actionUrl,
}) {
  const detailRows = details.length
    ? `<div style="margin: 24px 0; padding: 18px; border-radius: 14px; background: #f8fafc; border: 1px solid #e2e8f0;">
         ${details
           .map(
             (detail) => `
               <div style="margin-bottom: 10px;">
                 <div style="font-size: 12px; text-transform: uppercase; letter-spacing: 0.08em; color: #64748b;">${escapeHtml(detail.label)}</div>
                 <div style="font-size: 15px; color: #0f172a; font-weight: 600;">${escapeHtml(detail.value)}</div>
               </div>`,
           )
           .join("")}
       </div>`
    : "";

  const actionMarkup =
    actionText && actionUrl
      ? `<div style="margin: 28px 0;">
           <a href="${escapeHtml(actionUrl)}" style="display: inline-block; background: linear-gradient(135deg, #0f766e, #2563eb); color: #ffffff; text-decoration: none; padding: 12px 20px; border-radius: 999px; font-weight: 600;">
             ${escapeHtml(actionText)}
           </a>
         </div>`
      : "";

  return `
    <div style="margin: 0; padding: 32px 16px; background: linear-gradient(180deg, #eff6ff 0%, #f8fafc 100%); font-family: Arial, sans-serif; color: #0f172a;">
      <div style="max-width: 640px; margin: 0 auto; background: #ffffff; border-radius: 24px; overflow: hidden; border: 1px solid #dbeafe; box-shadow: 0 18px 48px rgba(15, 23, 42, 0.08);">
        <div style="padding: 28px 32px; background: linear-gradient(135deg, #0f172a, #1d4ed8); color: #ffffff;">
          <div style="font-size: 13px; letter-spacing: 0.14em; text-transform: uppercase; opacity: 0.82;">${escapeHtml(process.env.EMAIL_FROM_NAME || "LIMS")}</div>
          <h1 style="margin: 10px 0 0; font-size: 28px; line-height: 1.2;">${escapeHtml(title)}</h1>
        </div>
        <div style="padding: 32px;">
          <p style="margin: 0 0 14px; font-size: 16px;">${escapeHtml(greeting || "Hello,")}</p>
          <p style="margin: 0; font-size: 15px; line-height: 1.7; color: #334155;">${escapeHtml(intro)}</p>
          ${detailRows}
          ${actionMarkup}
          <p style="margin: 24px 0 0; font-size: 14px; line-height: 1.7; color: #475569;">
            This message was sent by ${escapeHtml(process.env.EMAIL_FROM_NAME || "LIMS")}. Your in-app notifications will continue to work even if email is turned off later.
          </p>
        </div>
      </div>
    </div>
  `;
}

async function sendEmail({ to, subject, html, text }) {
  if (!isEmailConfigured() || !transporter) {
    const configError = new Error("Email service is not configured");
    configError.code = "EMAIL_NOT_CONFIGURED";
    throw configError;
  }

  return transporter.sendMail({
    from: `"${process.env.EMAIL_FROM_NAME || "LIMS"}" <${process.env.EMAIL_USER}>`,
    to,
    subject,
    html,
    text,
  });
}

module.exports = {
  buildEmailHtml,
  sendEmail,
  isEmailConfigured,
};
