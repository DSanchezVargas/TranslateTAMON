const nodemailer = require('nodemailer');

module.exports = async (req, res) => {
  // Configurar CORS básico
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { smtpUser, smtpPass, to, subject, html, token } = req.body;

  // Validación de seguridad (Token privado)
  if (token !== 'Q7mN2vL9xR4pT8kD1sF6hJ3wC0zB5yU') {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (!smtpUser || !smtpPass || !to || !subject || !html) {
    return res.status(400).json({ error: 'Missing required parameters' });
  }

  try {
    const transporter = nodemailer.createTransport({
      host: 'smtp.gmail.com',
      port: 465,
      secure: true,
      auth: { user: smtpUser, pass: smtpPass }
    });

    const info = await transporter.sendMail({
      from: `"Tamon IA" <${smtpUser}>`,
      to,
      subject,
      html
    });

    return res.status(200).json({ success: true, messageId: info.messageId });
  } catch (error) {
    console.error('SMTP proxy error:', error);
    return res.status(500).json({ error: error.message });
  }
};
