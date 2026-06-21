const nodemailer = require('nodemailer');

// Configuramos el "cartero". 
// Nota: Usaremos Gmail como ejemplo, pero necesitas una "Contraseña de aplicación", no tu clave normal.
const transporter = nodemailer.createTransport({
    service: 'gmail', 
    auth: {
        user: 'tu_correo_de_prueba@gmail.com', // Pon aquí tu correo de desarrollo
        pass: 'tu_contraseña_de_aplicacion'   // Tu contraseña especial para apps
    }
});

async function enviarCorreoVIP(correoDestino, nombreUsuario) {
    const mailOptions = {
        from: '"Equipo Tamon" <tu_correo_de_prueba@gmail.com>',
        to: correoDestino, // El correo del usuario registrado
        subject: '¡Estás en la lista VIP de Tamon Pro+! ✨',
        html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; padding: 20px; border: 1px solid #7928ca; border-radius: 10px; background-color: #f8e6f3;">
                <h2 style="color: #7928ca;">¡Hola ${nombreUsuario}! 🚀</h2>
                <p style="color: #2d1221; font-size: 16px;">Confirmamos que tu espacio ha sido reservado con éxito en nuestra fila VIP.</p>
                <p style="color: #2d1221; font-size: 16px;">La pasarela de pagos oficial está en configuración. Te avisaremos a este correo en cuanto Tamon Pro+ esté habilitado para que seas de los primeros en experimentar el poder total de nuestro motor sin límites.</p>
                <br>
                <p style="color: #2d1221; font-weight: bold;">Saludos,<br>El equipo de Tamon IA</p>
            </div>
        `
    };

    return await transporter.sendMail(mailOptions);
}

module.exports = { enviarCorreoVIP };